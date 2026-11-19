/* An optional password for a parent account, next to the emailed code, never instead of it.
   - Set or change: on the account page, in a fresh session (requireFreshParent: signed in or confirmed in the last
     15 minutes). Every other session of the account ends, and the parent gets a "password changed" email.
   - Sign in: email + password (POST /api/auth/password/). The same answer for an unknown email, an account with no
     password and a wrong password, so the form can't be used to find out who has an account. 10 wrong passwords in a
     row pause password sign-in for that account for 15 minutes (the emailed code still works); a connection gets
     PER_CONNECTION tries a day; the bot check (human.ts) runs when it is on; and AUTH_RL limits per IP.
   - Forgotten: sign in with an emailed code, then make a new one on the account page.
   Hashing: hashSecret (password.ts), HMAC with the PASSWORD_PEPPER secret, then PBKDF2, like student passwords. A copy
   of the database alone can't be used to test guesses without the secret. */
import { now, type D1Database } from './env';
import { HttpError, limitKey } from './http';
import { underDailyCap } from './caps';
import { hashSecret, needsRehash, verifySecret } from './password';
import { normEmail, sha256, startSession, type User } from './auth';
import { sendPasswordSet } from './mail';

export const PARENT_PW_MIN = 10, PARENT_PW_MAX = 72;
const MAX_FAILS = 10, LOCK_MS = 15 * 60_000, PER_CONNECTION = 50;
const WRONG = 'That email and password don’t match. Check them, or sign in with a code sent to your email.';
// A real hash to check against when there is no account or no password, so every answer takes about as long.
let dummy: Promise<string> | null = null;

/** A usable new password, or a 400 saying what is wrong. */
export function cleanParentPassword(v: unknown, email: string): string {
  if (typeof v !== 'string') throw new HttpError(400, 'Enter a password.');
  const p = v.normalize('NFKC');
  if ([...p].length < PARENT_PW_MIN) throw new HttpError(400, `Use at least ${PARENT_PW_MIN} characters.`);
  if (new TextEncoder().encode(p).length > PARENT_PW_MAX) throw new HttpError(400, 'That password is too long. Use a shorter one.');
  const low = p.toLowerCase(), local = email.split('@')[0].toLowerCase();
  if (low === email.toLowerCase() || (local.length >= 4 && low.includes(local))) throw new HttpError(400, 'Don’t use your email address in the password.');
  if (/^(.)\1+$/.test(p) || /^(0123456789|1234567890|password\d*|qwertyuiop)$/i.test(p)) throw new HttpError(400, 'That password is too easy to guess. Try a short sentence you will remember.');
  return p;
}

/** Whether this account has a password (the account page shows "Add" or "Change"). */
export async function hasParentPassword(D: D1Database, userId: string): Promise<boolean> {
  try { return !!(await D.prepare('SELECT password_hash AS h FROM users WHERE id = ?1').bind(userId).first<{ h: string | null }>())?.h; }
  catch { return false; }   // before migration 0005
}

/** Sets or changes the password of a fresh session's parent; ends the account's other sessions; emails the parent. */
export async function setParentPassword(D: D1Database, user: User, raw: unknown, origin: string): Promise<{ changed: boolean }> {
  const password = cleanParentPassword(raw, user.email);
  const had = await hasParentPassword(D, user.id), hash = await hashSecret(password), at = now();
  await D.batch([
    D.prepare('UPDATE users SET password_hash = ?2, password_at = ?3, pw_fails = 0, pw_locked_until = NULL WHERE id = ?1').bind(user.id, hash, at),
    D.prepare('DELETE FROM sessions WHERE user_id = ?1 AND id != ?2').bind(user.id, user.sid),
  ]);
  try { await sendPasswordSet(user.email, had, origin); } catch (e) { console.error('password mail', e instanceof Error ? e.message : e); }
  return { changed: had };
}

/** Email + password sign-in: the session cookie, or a 400/429 that never says whether the email has an account. */
export async function passwordSignIn(D: D1Database, request: Request, emailIn: unknown, raw: unknown): Promise<string> {
  const email = normEmail(emailIn);
  if (typeof raw !== 'string' || !raw || raw.length > 200) throw new HttpError(400, 'Enter your password.');
  const password = raw.normalize('NFKC'), at = now();
  if (!(await underDailyCap(D, `pw_from_${await sha256(limitKey(request))}`, PER_CONNECTION, at)))
    throw new HttpError(429, 'Too many sign-in tries from this connection today. Sign in with a code sent to your email.');
  const u = await D.prepare('SELECT id, password_hash AS h, pw_locked_until AS locked FROM users WHERE email = ?1').bind(email)
    .first<{ id: string; h: string | null; locked: string | null }>();
  if (!u?.h) { await verifySecret(password, await (dummy ??= hashSecret('not-a-password-' + crypto.randomUUID()))); throw new HttpError(400, WRONG); }
  if (u.locked && u.locked > at) throw new HttpError(429, 'Too many wrong passwords. Wait 15 minutes, or sign in with a code sent to your email.');
  if (!(await verifySecret(password, u.h))) {
    // The count and the pause are one write, so parallel guesses can't each see a count under the limit.
    await D.prepare(`UPDATE users SET pw_fails = CASE WHEN pw_fails + 1 >= ?2 THEN 0 ELSE pw_fails + 1 END,
        pw_locked_until = CASE WHEN pw_fails + 1 >= ?2 THEN ?3 ELSE pw_locked_until END WHERE id = ?1`)
      .bind(u.id, MAX_FAILS, new Date(Date.now() + LOCK_MS).toISOString()).run();
    throw new HttpError(400, WRONG);
  }
  await D.prepare('UPDATE users SET pw_fails = 0, pw_locked_until = NULL WHERE id = ?1').bind(u.id).run();
  if (needsRehash(u.h)) await D.prepare('UPDATE users SET password_hash = ?2 WHERE id = ?1 AND password_hash = ?3').bind(u.id, await hashSecret(password), u.h).run();
  return startSession(D, request, u.id);
}
