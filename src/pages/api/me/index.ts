import type { APIRoute } from 'astro';
import { renderSVG } from 'uqr';
import { bindings, db } from '../../../lib/server/env';
import { HttpError, json, postOnly, postRoute } from '../../../lib/server/http';
import { currentUser, endSession, freshUntil, pendingSignup, requireFreshParent, withCookies } from '../../../lib/server/auth';
import { addChild, childOf, childrenOf, cleanGrade, cleanNickname, deleteAccount, removeChild } from '../../../lib/server/account';
import { pipOn, mockOn } from '../../../lib/server/aitutor';
import { cleanPassword, cleanUsername, createSignInLink, currentStudent, newPassword, newUsername, setLogin } from '../../../lib/server/student';
import { sendChildLogin } from '../../../lib/server/mail';
import { hasParentPassword, setParentPassword } from '../../../lib/server/parentPassword';
import { PLAN, familyPlans, hasPurchases, limitsNow, paymentsOn, planOf } from '../../../lib/server/plan';
import { offer } from '../../../lib/server/polar';

// The parent hears about every child login made or changed (mail.ts sendChildLogin: the username, never the
// password); a failed email never undoes the change.
const tellParent = async (...a: Parameters<typeof sendChildLogin>) => {
  try { if (a[0]) await sendChildLogin(...a); } catch (e) { console.error('child login mail', e instanceof Error ? e.message : e); }
};

export const prerender = false;

/**
 * Who is using this browser, for the account page and the practice app:
 * - role "student": a child signed in with their own login; only their own profile.
 *   { ok, signedIn: true, role: 'student', child: { id, learner, nickname, grade, username } }
 * - role "parent": the parent and every child.
 *   { ok, signedIn: true, role: 'parent', email, children: [{ id, learner, nickname, grade, username }], fresh, freshUntil }
 *   `fresh`: whether this session may change the account now (see POST), so the page can ask "confirm it's you" first.
 * - signed out, possibly in the middle of a sign-up: { ok, signedIn: false, pending: email | null }
 * `emailCode` says whether sign-in emails are really sent; false means the code is printed in the server console.
 * The optional paid plan (src/lib/server/plan.ts), only when pack.yaml has a `plan` block:
 * - student: `plan: {pro, until}` for this child; `limits`: whether the free limits apply to this site now.
 * - parent: each child's `pro: {pro, until}`, `askedAt`/`askedKind` (the child's last "Ask a parent for more");
 *   `payments` (checkout works), `price: {amount, currency}` (read from Polar; null keeps checkout closed),
 *   `receipts` (a purchase to show in Polar's portal), `limits`, `freeUntil`.
 * `password` (parent): whether the account has a password (parentPassword.ts).
 * `pip` says whether the optional AI tutor is on for this browser (docs/pip.md): true only when PIP_ENABLED=1 and an OpenRouter
 * key are set (or `astro dev` with AI_TUTOR_MOCK=1), and the visitor can use it (signed in, or the dev mock). The app shows
 * no tutor button unless it is true.
 * A signed-in answer sends the session cookie again with its full lifetime (60 days for a parent, 120 for
 * a child), so the cookie slides with the session and someone who keeps using the site stays signed in.
 */
export const GET: APIRoute = async ({ request }) => {
  if (!bindings.DB) return json({ ok: false, error: 'We could not reach our database. Please try again later.' }, 503);
  const D = bindings.DB, ways = { emailCode: !!bindings.EMAIL && !import.meta.env.DEV }, pip = pipOn(bindings);
  const student = await currentStudent(request);
  if (student) {
    const paid = PLAN ? await planOf(D, student.user_id, student.child_id) : null;
    const planInfo = paid ? { plan: { pro: paid.on, until: paid.until }, limits: await limitsNow() } : {};
    return json({ ok: true, signedIn: true, role: 'student', child: { id: student.child_id, learner: student.learner, nickname: student.nickname, grade: student.grade, username: student.username }, ...planInfo, ...ways, pip },
      200, { 'set-cookie': student.refresh });
  }
  const user = await currentUser(request);
  if (!user) {
    const p = await pendingSignup(request);
    return json({ ok: true, signedIn: false, pending: p ? p.email : null, ...ways, pip: pip && mockOn(bindings) });
  }
  const [kids, password] = await Promise.all([childrenOf(D, user.id), hasParentPassword(D, user.id)]);
  const until = freshUntil(user.session_at);
  let children: unknown[] = kids, planInfo = {};
  if (PLAN) {
    const on = paymentsOn();
    const [plans, receipts, price] = await Promise.all([familyPlans(D, user.id), on ? hasPurchases(D, user.id) : false, on ? offer().catch(() => null) : null]);
    children = kids.map((c) => { const p = plans[c.id]; return { ...c, pro: { pro: !!p?.plan.on, until: p?.plan.until ?? null }, askedAt: p?.askedAt ?? null, askedKind: p?.askedKind ?? null }; });
    planInfo = { payments: on && !!price, price, receipts: on && receipts, limits: on && !!price && (await limitsNow()), freeUntil: PLAN.freeUntil ?? null };
  }
  return json({ ok: true, signedIn: true, role: 'parent', email: user.email, since: user.created_at, children, password, ...planInfo, fresh: !!until, freshUntil: until, ...ways, pip }, 200, { 'set-cookie': user.refresh });
};

/**
 * Changes to the account, by the signed-in parent. Every one needs a session started in the last
 * REAUTH_MINUTES (auth.ts); an older one gets a 403 with {reauth: true} and nothing changes, so a child
 * on a computer where the parent stayed signed in can't delete the account, reset a login, make a sign-in
 * link or type a nickname. The page then asks for a new email code (POST /api/auth/reauth/).
 */
export const POST = postRoute(async ({ request, body, url }) => {
  const D = db();
  const user = await requireFreshParent(request);
  switch (body.action) {
    case 'add_child': {
      // One step: the child, and a student login made for them (a username from the nickname, a word
      // password), saved together. The password is shown to the parent this once; a reset makes a new one.
      const { child, login } = await addChild(D, user.id, cleanNickname(body.nickname), cleanGrade(body.grade));
      await tellParent(user.email, child.nickname, login.username, 'made', url.origin);
      return { child, login };
    }
    case 'new_password': {
      const c = await childOf(D, user.id, body.child);
      const username = c.username || (await newUsername(D, c.nickname)), password = newPassword();
      await setLogin(D, c.id, username, password);
      await tellParent(user.email, c.nickname, username, c.username ? 'reset' : 'made', url.origin);
      return { login: { username, password } };
    }
    case 'sign_in_link': {
      // "Scan to sign in": a one-time link (15 minutes) as a QR code for the child's phone.
      const c = await childOf(D, user.id, body.child);
      const link = await createSignInLink(D, c.id, url.origin);
      return { ...link, svg: renderSVG(link.url, { border: 2, pixelSize: 6 }) };
    }
    case 'edit_child': {
      const c = await childOf(D, user.id, body.child);
      await D.prepare('UPDATE children SET nickname = ?2, grade = ?3 WHERE id = ?1').bind(c.id, cleanNickname(body.nickname), cleanGrade(body.grade)).run();
      return {};
    }
    case 'remove_child':
      await removeChild(D, user.id, body.child);
      return {};
    case 'set_login': {
      const c = await childOf(D, user.id, body.child);
      const username = cleanUsername(body.username);
      await setLogin(D, c.id, username, cleanPassword(body.password, username));
      await tellParent(user.email, c.nickname, username, c.username ? 'changed' : 'made', url.origin);
      return { username };
    }
    case 'set_password':
      // Add or change the parent's own password (parentPassword.ts). Fresh session only (requireFreshParent above);
      // every other session of the account ends, and the parent gets an email.
      return await setParentPassword(D, user, body.password, url.origin);
    case 'delete_account': {
      if (body.confirm !== 'DELETE') throw new HttpError(400, 'Type DELETE to confirm.');
      await deleteAccount(D, user.id);
      return withCookies({ ok: true }, [await endSession(D, request)]);
    }
    default:
      throw new HttpError(400, 'Unknown action.');
  }
}, { max: 2048, limiter: () => bindings.API_RL });

export const ALL = postOnly;
