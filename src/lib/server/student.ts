/* Student logins. The parent gives each child a username and password; the
   child signs in by themselves on any device and sees only their own practice: no email, no payments,
   no siblings. Only the parent can set or change them, and a change signs the child out everywhere.
   - Usernames: 4 to 24 characters, a letter first, then letters, digits, dots, dashes or underscores;
     unique across the site. The parent is asked not to use the child's real name.
   - Passwords: 8 to 72 characters, not blank, not one repeated character and not one of the most common
     passwords; hashed with a keyed PBKDF2 that fits the Free plan (src/lib/server/password.ts). An older
     or weaker hash is redone at the next good sign-in, only if the password was not changed meanwhile.
   - 10 tries in a row without a good sign-in lock the username for 15 minutes (each try is spent in the
     database before the password is checked, so parallel guesses can't get past it); the per-IP limit
     STUDENT_RL applies too. It is higher than the parent sign-in limit,
     because a whole class can sign in from one school IP address.
   - Sessions: a random token in an HttpOnly, Secure, SameSite=Lax cookie (pe_student), stored
     hashed, 120 days, extended on use; GET /api/me/ sends the cookie again with a full 120 days. A
     child's use also counts as use of the parent's account (the 24-month idle deletion). Signing in as
     a student signs the parent out on that browser and ends its earlier student session on the server.
   - A new password, or a new "Scan to sign in" link, makes every earlier unused link stop working.
   - Opening a link signs in only after a click: the page first previews whose link it is (the nickname),
     so a link from another family can't sign a browser in, or its parent out, by itself. */
import { bindings, now, type D1Database } from './env';
import { HttpError } from './http';
import { clearCookie, cookie, randomToken, setCookie, sha256, STUDENT_COOKIE } from './auth';
import { hashSecret, needsRehash, verifySecret } from './password';

const DAY = 86_400_000, DAYS = 120, MAX_FAILS = 10, LOCK_MS = 15 * 60_000;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const later = (ms: number) => new Date(Date.now() + ms).toISOString();

export function cleanUsername(v: unknown): string {
  const u = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (!/^[a-z][a-z0-9._-]{3,23}$/.test(u)) throw new HttpError(400, 'Usernames are 4 to 24 letters, numbers, dots, dashes or underscores, starting with a letter.');
  return u;
}
// The passwords people pick most often (8 characters or more), which online guessing tries first.
const COMMON = new Set(('password password1 password12 password123 passw0rd 12345678 123456789 1234567890 87654321 11111111 '
  + '12341234 qwertyui qwertyuiop qwerty123 1q2w3e4r asdfghjk iloveyou iloveyou1 abcdefgh abcd1234 letmein1 letmein123 '
  + 'welcome1 sunshine princess football baseball superman trustno1 whatever').split(' '));
export function cleanPassword(v: unknown, username: string): string {
  const p = typeof v === 'string' ? v : '';
  if (p.length < 8 || p.length > 72) throw new HttpError(400, 'Passwords need 8 to 72 characters.');
  if (p.toLowerCase().includes(username)) throw new HttpError(400, 'The password should not contain the username.');
  if (!p.trim() || /^(.)\1*$/su.test(p) || COMMON.has(p.trim().toLowerCase())) throw new HttpError(400, 'That password is too easy to guess. Try three words and a number.');
  return p;
}

export interface Student {
  child_id: string; learner: string; nickname: string; grade: number | null; user_id: string; username: string;
  /** The student cookie again with a full 120 days; GET /api/me/ sends it, so the cookie slides like the session. */
  refresh: string;
}

/** The child signed in on this browser, or null. */
export async function currentStudent(request: Request): Promise<Student | null> {
  const D = bindings.DB, token = cookie(request, STUDENT_COOKIE);
  if (!D || !token || !TOKEN.test(token)) return null;
  const sid = await sha256(token), at = now();
  const r = await D.prepare(`SELECT s.expires_at, s.seen_at, s.login_version AS sv, c.login_version AS cv, c.id AS child_id, c.learner_id AS learner,
      c.nickname, c.grade, c.user_id, c.username
    FROM student_sessions s JOIN children c ON c.id = s.child_id WHERE s.id = ?1`).bind(sid).first<Student & { expires_at: string; seen_at: string; sv: number; cv: number }>();
  if (!r || r.expires_at < at || r.sv !== r.cv) return null;
  if (r.seen_at.slice(0, 10) < at.slice(0, 10)) {
    await D.batch([
      D.prepare('UPDATE student_sessions SET seen_at = ?2, expires_at = ?3 WHERE id = ?1').bind(sid, at, later(DAYS * DAY)),
      // The child using the site keeps the family's account in use, so the 24-month idle deletion skips it.
      D.prepare('UPDATE users SET seen_at = ?2 WHERE id = ?1').bind(r.user_id, at),
    ]);
  }
  return { child_id: r.child_id, learner: r.learner, nickname: r.nickname, grade: r.grade, user_id: r.user_id, username: r.username,
    refresh: setCookie(STUDENT_COOKIE, token, DAYS * 86400) };
}

/** The parent sets (or resets) a child's username and password; every device the child used is signed out,
    and a sign-in link not used yet stops working. */
export async function setLogin(D: D1Database, childId: string, username: string, password: string) {
  const taken = await D.prepare('SELECT 1 AS x FROM children WHERE username = ?1 AND id != ?2').bind(username, childId).first();
  if (taken) throw new HttpError(409, 'That username is taken. Try another, for example with a number at the end.');
  const hash = await hashSecret(password);
  await D.batch([
    D.prepare('UPDATE children SET username = ?2, password_hash = ?3, login_version = login_version + 1, login_fails = 0, locked_until = NULL WHERE id = ?1')
      .bind(childId, username, hash),
    D.prepare('DELETE FROM student_sessions WHERE child_id = ?1').bind(childId),
    D.prepare('DELETE FROM student_links WHERE child_id = ?1').bind(childId),
  ]);
}

// ---------------------------------------------------------------- easy setup: generated logins and QR sign-in

// Short, common words for passwords a 13-year-old can read and type: three words and two digits
// (128 * 128 * 128 * 90, about 27 bits), behind PBKDF2, a 15-minute lock after 10 tries and a per-IP limit.
const WORDS = ('apple amber anchor arrow atlas badge bagel banjo basil beach beacon berry bison blaze bloom boat bolt brick brook cabin cactus camel candle canoe '
  + 'canyon cargo cedar cello chalk cheetah cherry chess cider cliff clover cobalt comet coral cotton crane crater crow cube daisy delta denim dingo dolphin '
  + 'dragon drum eagle echo ember falcon fern fiddle flint forest fossil fox galaxy garnet gecko glacier globe grape gravel harbor hazel heron hiking honey '
  + 'iceberg igloo indigo island ivory jade jaguar jelly jungle kayak kettle kiwi koala lagoon lantern lemon lilac lime llama lotus magnet mango maple marble '
  + 'meadow melon meteor mint moose nectar nova oasis ocean olive onyx orbit otter owl panda pebble pepper piano pixel planet plum pocket pony prism puffin quartz rabbit radar raven reef rocket saturn').split(' ');
const pick = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
export const newPassword = () => `${WORDS[pick(128)]}-${WORDS[pick(128)]}-${WORDS[pick(128)]}${10 + pick(90)}`;

/** A free username from the nickname: its letters (up to 10) and 3 to 4 digits, e.g. "mia482". */
export async function newUsername(D: D1Database, nickname: string): Promise<string> {
  const base = nickname.normalize('NFD').replace(/[^a-zA-Z]/g, '').toLowerCase().slice(0, 10);
  const stem = base.length >= 2 ? base : 'student';
  for (let i = 0; i < 8; i++) {
    const u = `${stem}${i < 4 ? 100 + pick(900) : 1000 + pick(9000)}`;
    if (!(await D.prepare('SELECT 1 AS x FROM children WHERE username = ?1').bind(u).first())) return u;
  }
  throw new HttpError(503, 'Could not pick a username. Try again.');
}

/** A one-time sign-in link for a child (15 minutes), shown to the parent as a QR code. Only the newest
    link works: making one ends the child's earlier unused links. */
export async function createSignInLink(D: D1Database, childId: string, origin: string): Promise<{ url: string; expires: string }> {
  const token = randomToken(), expires = later(15 * 60_000);
  await D.batch([
    D.prepare('DELETE FROM student_links WHERE child_id = ?1 AND used_at IS NULL').bind(childId),
    D.prepare('INSERT INTO student_links (id, child_id, expires_at) VALUES (?1, ?2, ?3)').bind(await sha256(token), childId, expires),
  ]);
  return { url: `${origin}/student/?t=${token}`, expires };
}

const LINK_INVALID = 'This sign-in code is not valid. Ask your parent for a new one.';
const LINK_USED = 'This sign-in code has expired or was already used. Ask your parent for a new one.';

/** Whose link this is (only the nickname), for "Sign in as Mia?" before it is used. Reads only: the link still works once. */
export async function previewSignInLink(D: D1Database, token: unknown): Promise<{ nickname: string }> {
  if (typeof token !== 'string' || !TOKEN.test(token)) throw new HttpError(400, LINK_INVALID);
  const c = await D.prepare('SELECT c.nickname FROM student_links l JOIN children c ON c.id = l.child_id WHERE l.id = ?1 AND l.used_at IS NULL AND l.expires_at > ?2')
    .bind(await sha256(token), now()).first<{ nickname: string }>();
  if (!c) throw new HttpError(400, LINK_USED);
  return { nickname: c.nickname };
}

/** The child's phone opened the link and the child said yes: sign it in once. */
export async function redeemSignInLink(D: D1Database, request: Request, token: unknown) {
  if (typeof token !== 'string' || !TOKEN.test(token)) throw new HttpError(400, LINK_INVALID);
  const id = await sha256(token), at = now();
  const used = await D.prepare('UPDATE student_links SET used_at = ?2 WHERE id = ?1 AND used_at IS NULL AND expires_at > ?2').bind(id, at).run();
  if (!used.meta.changes) throw new HttpError(400, LINK_USED);
  const c = await D.prepare('SELECT c.id, c.learner_id, c.nickname, c.grade, c.login_version FROM student_links l JOIN children c ON c.id = l.child_id WHERE l.id = ?1')
    .bind(id).first<{ id: string; learner_id: string; nickname: string; grade: number | null; login_version: number }>();
  if (!c) throw new HttpError(400, LINK_INVALID);
  return { cookie: await startStudentSession(D, request, c.id, c.login_version), child: { id: c.id, learner: c.learner_id, nickname: c.nickname, grade: c.grade } };
}

/** A new student session; this browser's earlier student session is deleted on the server, not only replaced in the cookie. */
async function startStudentSession(D: D1Database, request: Request, childId: string, version: number): Promise<string> {
  const token = randomToken(), at = now(), old = cookie(request, STUDENT_COOKIE);
  await D.batch([
    ...(old && TOKEN.test(old) ? [D.prepare('DELETE FROM student_sessions WHERE id = ?1').bind(await sha256(old))] : []),
    D.prepare('INSERT INTO student_sessions (id, child_id, login_version, created_at, expires_at, seen_at) VALUES (?1, ?2, ?3, ?4, ?5, ?4)')
      .bind(await sha256(token), childId, version, at, later(DAYS * DAY)),
  ]);
  return setCookie(STUDENT_COOKIE, token, DAYS * 86400);
}

let dummy: Promise<string> | null = null;
/** Signs a child in; returns the cookie and the child's profile for this browser. */
export async function studentLogin(D: D1Database, request: Request, usernameIn: unknown, passwordIn: unknown) {
  const username = typeof usernameIn === 'string' ? usernameIn.trim().toLowerCase() : '';
  const password = typeof passwordIn === 'string' ? passwordIn : '';
  if (!username || !password || username.length > 24 || password.length > 72) throw new HttpError(400, 'Enter your username and password.');
  const c = await D.prepare('SELECT id, learner_id, nickname, grade, password_hash, login_version, login_fails, locked_until FROM children WHERE username = ?1')
    .bind(username).first<{ id: string; learner_id: string; nickname: string; grade: number | null; password_hash: string | null; login_version: number; login_fails: number; locked_until: string | null }>();
  const locked = 'Too many wrong passwords. Try again in 15 minutes, or ask your parent to reset it.';
  if (c?.locked_until && c.locked_until > now()) throw new HttpError(429, locked);
  if (!c?.password_hash) {
    // Without the username, still spend the same time hashing, so timing doesn't reveal which usernames exist.
    await verifySecret(password, await (dummy ??= hashSecret(randomToken())));
    throw new HttpError(400, 'Wrong username or password.');
  }
  // Every try is spent BEFORE the password is checked, in one statement, so tries sent in parallel can't
  // get past the lock (as checkCode does for email codes): the 10th try in a row sets the 15-minute lock,
  // and a try that finds the lock on gets no check at all. An expired lock starts the count again. Only
  // for the login that was read: a parent's reset in the meantime (a new login_version) spends nothing.
  const t = now();
  const spent = await D.prepare(`UPDATE children
      SET login_fails = CASE WHEN locked_until <= ?3 THEN 1 ELSE login_fails + 1 END,
        locked_until = CASE WHEN (CASE WHEN locked_until <= ?3 THEN 1 ELSE login_fails + 1 END) >= ?4 THEN ?5
          WHEN locked_until <= ?3 THEN NULL ELSE locked_until END
    WHERE id = ?1 AND login_version = ?2 AND (locked_until IS NULL OR locked_until <= ?3) RETURNING login_fails`)
    .bind(c.id, c.login_version, t, MAX_FAILS, later(LOCK_MS)).first<{ login_fails: number }>();
  if (!spent) {
    const now2 = await D.prepare('SELECT locked_until FROM children WHERE id = ?1').bind(c.id).first<{ locked_until: string | null }>();
    if (now2?.locked_until && now2.locked_until > t) throw new HttpError(429, locked);
    throw new HttpError(400, 'Wrong username or password.'); // the parent changed the login meanwhile
  }
  if (!(await verifySecret(password, c.password_hash))) throw new HttpError(400, 'Wrong username or password.');
  // Clear the count, and redo an old-style hash, only if the parent has not reset the login since it was
  // read; otherwise this sign-in would put the old password back over the new one.
  const hash = c.password_hash as string;
  const [reset] = await D.batch([
    D.prepare('UPDATE children SET login_fails = 0, locked_until = NULL WHERE id = ?1 AND login_version = ?2').bind(c.id, c.login_version),
    ...(needsRehash(hash) ? [D.prepare('UPDATE children SET password_hash = ?3 WHERE id = ?1 AND password_hash = ?2').bind(c.id, hash, await hashSecret(password))] : []),
  ]);
  // The parent changed the login while this password was checked: the old one no longer works.
  if (!reset.meta.changes) throw new HttpError(400, 'Wrong username or password.');
  return { cookie: await startStudentSession(D, request, c.id, c.login_version), child: { id: c.id, learner: c.learner_id, nickname: c.nickname, grade: c.grade } };
}

export async function studentLogout(D: D1Database, request: Request): Promise<string> {
  const token = cookie(request, STUDENT_COOKIE);
  if (token && TOKEN.test(token)) await D.prepare('DELETE FROM student_sessions WHERE id = ?1').bind(await sha256(token)).run();
  return clearCookie(STUDENT_COOKIE);
}
