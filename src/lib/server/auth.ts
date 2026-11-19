/* Parent sign-in: a 6-digit code sent by email. There are no passwords. Only parents have accounts; children are
   profiles inside them (src/lib/server/account.ts).
   - A sign-in that proves an email with no account yet becomes a pending sign-up: the account is made
     only after the parent confirms they are a parent or guardian (POST /api/auth/consent/).
   - Sessions: a random token in an HttpOnly, Secure, SameSite=Lax cookie; the database keeps only its
     SHA-256. 60 days, extended on use (at most one write a day); GET /api/me/ sends the cookie again
     with a full 60 days, so a session used at least every 60 days never ends. Signing in deletes this
     browser's earlier parent and student sessions on the server, not only their cookies.
   - Changing the account (every POST to /api/me/) needs a fresh session: one made in the last
     REAUTH_MINUTES. A family computer where the parent stayed signed in still shows the account, but a child
     can't delete it, reset a login or make a sign-in link. An older session confirms it's the parent with a
     new email code (POST /api/auth/reauth/), which starts a new session row; sessions.created_at is the clock.
   - Codes: 10 minutes, 5 tries (each try is spent before the code is compared, so parallel guesses
     can't share one), one a minute and 10 a day per mailbox (mailboxKey: a +tag or Gmail dots don't make
     a new one), at most MAIL_DAILY_CAP code emails a day for the whole site, plus a per-IP limit
     (AUTH_RL). Stored as an HMAC under the PASSWORD_PEPPER secret, so a copy of the database can't
     reveal a live code. */
import { bindings, now, pepper, type D1Database, type D1PreparedStatement } from './env';
import { HttpError } from './http';

const DAY = 86_400_000;
const SESSION_DAYS = 60;
// Secure, __Host- cookies everywhere except `astro dev` (plain http://localhost, where Safari drops Secure cookies).
const SECURE = !import.meta.env.DEV;
const PREFIX = SECURE ? '__Host-' : '';
export const SESSION_COOKIE = `${PREFIX}pe_session`;
const SIGNUP_COOKIE = `${PREFIX}pe_signup`;
export const STUDENT_COOKIE = `${PREFIX}pe_student`;

const enc = new TextEncoder();
export const b64url = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const randomToken = (bytes = 32) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));
const hex = (d: Uint8Array) => Array.from(d, (x) => x.toString(16).padStart(2, '0')).join('');
export async function sha256(s: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s))));
}
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const later = (ms: number) => new Date(Date.now() + ms).toISOString();

// ---------------------------------------------------------------- cookies

// Only ASCII spaces and tabs around a name or value. String.trim() also strips Unicode spaces, so a
// cookie named U+2000 + the session cookie's name, which a sibling subdomain may set, would pass as ours.
const ows = (s: string) => s.replace(/^[ \t]+|[ \t]+$/g, '');
/** A cookie's value, or null. Two cookies with the same name mean one was planted: treat it as signed out. */
export function cookie(request: Request, name: string): string | null {
  let found: string | null = null;
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && ows(part.slice(0, i)) === name) {
      if (found !== null) return null;
      found = ows(part.slice(i + 1));
    }
  }
  return found;
}
export const setCookie = (name: string, value: string, maxAge: number) =>
  `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly;${SECURE ? ' Secure;' : ''} SameSite=Lax`;
export const clearCookie = (name: string) => setCookie(name, '', 0);

/** A JSON answer that also sets cookies. */
export function withCookies(body: unknown, cookies: string[], status = 200): Response {
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' });
  for (const c of cookies) headers.append('set-cookie', c);
  return new Response(JSON.stringify(body), { status, headers });
}
/** Only a path on this site, never another host. */
export function safeReturn(v: unknown): string {
  if (typeof v !== 'string' || v.length > 200 || !/^\/(?![/\\])[\w\-./?=&%#]*$/.test(v)) return '/account/';
  // No "." or ".." segments (also when written %2e): "/.//evil.com" resolves to the path "//evil.com",
  // which a redirect anywhere down the line could read as another host.
  if (v.split(/[?#]/)[0].split('/').some((s) => /^(?:\.|%2e){1,2}$/i.test(s))) return '/account/';
  try {
    const u = new URL(v, 'https://x.invalid');
    if (u.origin !== 'https://x.invalid' || u.pathname.startsWith('//')) return '/account/';
  } catch {
    return '/account/';
  }
  return v;
}

// ---------------------------------------------------------------- emails

export function normEmail(v: unknown): string {
  const e = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (e.length < 6 || e.length > 254 || !/^[^\s@<>()",;]+@[^\s@<>()",;]+\.[a-z]{2,}$/.test(e)) throw new HttpError(400, 'Enter a valid email address.');
  return e;
}

/**
 * The inbox an address delivers to, for the per-email code limits: lowercase, without a +tag, and for
 * Gmail without dots (googlemail.com is gmail.com). Otherwise jane+1@, jane+2@ ... or j.ane@gmail.com
 * would each get their own 10 codes a day, all landing in one inbox. Codes still go to the address as typed.
 */
export function mailboxKey(email: string): string {
  const at = email.lastIndexOf('@');
  let local = email.slice(0, at).toLowerCase(), domain = email.slice(at + 1).toLowerCase();
  const plus = local.indexOf('+');
  if (plus > 0) local = local.slice(0, plus);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return `${local}@${domain}`;
}

// ---------------------------------------------------------------- sessions

export interface User {
  id: string; email: string; consent_at: string; created_at: string; seen_at: string;
  /** This browser's session (hashed token). */
  sid: string;
  /** When this session started (a sign-in, a sign-up or a re-auth): the clock for a fresh session. */
  session_at: string;
  /** The session cookie again with a full 60 days; GET /api/me/ sends it, so the cookie slides like the session. */
  refresh: string;
}

/** The signed-in parent, or null. Extends the session at most once a day. */
export async function currentUser(request: Request): Promise<User | null> {
  const D = bindings.DB, token = cookie(request, SESSION_COOKIE);
  if (!D || !token || !TOKEN.test(token)) return null;
  const sid = await sha256(token), at = now();
  const row = await D.prepare(`SELECT s.expires_at AS s_expires, s.seen_at AS s_seen, s.created_at AS session_at, u.id, u.email, u.consent_at, u.created_at, u.seen_at
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?1`).bind(sid).first<Omit<User, 'sid' | 'refresh'> & { s_expires: string; s_seen: string }>();
  if (!row || row.s_expires < at) return null;
  if (row.s_seen.slice(0, 10) < at.slice(0, 10)) {
    await D.batch([
      D.prepare('UPDATE sessions SET seen_at = ?2, expires_at = ?3 WHERE id = ?1').bind(sid, at, later(SESSION_DAYS * DAY)),
      D.prepare('UPDATE users SET seen_at = ?2 WHERE id = ?1').bind(row.id, at),
    ]);
  }
  const { s_expires: _e, s_seen: _s, ...user } = row;
  return { ...user, sid, refresh: setCookie(SESSION_COOKIE, token, SESSION_DAYS * 86400) };
}

export async function requireUser(request: Request): Promise<User> {
  const user = await currentUser(request);
  if (!user) throw new HttpError(401, 'Please sign in again.');
  return user;
}

/** The signed-in parent (a child signed in with a student login is never a parent: 401). */
export const requireParent = requireUser;

/** Minutes after a sign-in (or a re-auth) during which the parent may change the account. */
export const REAUTH_MINUTES = 15;
/** Until when a session that started at `sessionAt` may change the account (ISO), or null once that has passed. */
export function freshUntil(sessionAt: string): string | null {
  const until = Date.parse(sessionAt) + REAUTH_MINUTES * 60_000;
  return until > Date.now() ? new Date(until).toISOString() : null;
}
/**
 * The signed-in parent, with a session started in the last REAUTH_MINUTES. Otherwise a 403 with
 * {reauth: true}: the page asks for a new email code, then sends the change again.
 */
export async function requireFreshParent(request: Request): Promise<User> {
  const user = await requireParent(request);
  if (!freshUntil(user.session_at)) throw new HttpError(403, 'Please confirm it’s you first.', { reauth: true });
  return user;
}

/**
 * Starts a session for `userId`; returns its Set-Cookie value. The parent or student session this
 * browser had before is deleted on the server in the same step, so a replaced cookie leaves nothing alive.
 */
export async function startSession(D: D1Database, request: Request, userId: string): Promise<string> {
  const token = randomToken(), at = now(), earlier: D1PreparedStatement[] = [];
  const parent = cookie(request, SESSION_COOKIE), student = cookie(request, STUDENT_COOKIE);
  if (parent && TOKEN.test(parent)) earlier.push(D.prepare('DELETE FROM sessions WHERE id = ?1').bind(await sha256(parent)));
  if (student && TOKEN.test(student)) earlier.push(D.prepare('DELETE FROM student_sessions WHERE id = ?1').bind(await sha256(student)));
  await D.batch([
    ...earlier,
    D.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, seen_at) VALUES (?1, ?2, ?3, ?4, ?3)').bind(await sha256(token), userId, at, later(SESSION_DAYS * DAY)),
    D.prepare('UPDATE users SET seen_at = ?2 WHERE id = ?1').bind(userId, at),
  ]);
  return setCookie(SESSION_COOKIE, token, SESSION_DAYS * 86400);
}

/** Ends this browser's session; returns the cookie that clears it. */
export async function endSession(D: D1Database, request: Request): Promise<string> {
  const token = cookie(request, SESSION_COOKIE);
  if (token && TOKEN.test(token)) await D.prepare('DELETE FROM sessions WHERE id = ?1').bind(await sha256(token)).run();
  return clearCookie(SESSION_COOKIE);
}

// ---------------------------------------------------------------- 6-digit codes

/** Sign-in code emails the whole site sends in a day (UTC). It protects the sending domain's reputation
    and the email quota if someone scripts code requests to many addresses. */
export const MAIL_DAILY_CAP = 500;

// Keyed with the PASSWORD_PEPPER secret (as student passwords are), so a database copy can't be used to
// find a live code.
let codeKey: { value: string; key: Promise<CryptoKey> } | null = null;
async function codeHash(email: string, code: string): Promise<string> {
  const value = pepper();
  if (codeKey?.value !== value) codeKey = { value, key: crypto.subtle.importKey('raw', enc.encode(value), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']) };
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', await codeKey.key, enc.encode(`pe-code-v1|${email}|${code}`))));
}

/**
 * A new code for `email` (replacing any earlier one). At most one a minute and 10 a day per mailbox, and
 * MAIL_DAILY_CAP a day in all. The checks and the counting are one write, so parallel requests can't
 * all pass a check before any of them counts.
 */
export async function issueCode(D: D1Database, email: string): Promise<string> {
  let v: number;
  const buf = new Uint32Array(1);
  do v = crypto.getRandomValues(buf)[0]; while (v >= 4_294_000_000); // unbiased 0..999999
  const code = String(v % 1_000_000).padStart(6, '0');
  const key = mailboxKey(email), hash = await codeHash(email, code), at = now(), t = Date.now();
  const minuteAgo = new Date(t - 60_000).toISOString(), dayAgo = new Date(t - DAY).toISOString(), capKey = `mail_codes_${at.slice(0, 10)}`;
  // One transaction: the code row is written only when the mailbox's limits and the site's cap allow it
  // (RETURNING gives a row only then), and the day's counter goes up only when that write happened.
  const [saved] = await D.batch<{ sends: number }>([
    D.prepare(`INSERT INTO login_codes (email, code_hash, tries, sent_at, expires_at, sends, day_start)
        SELECT ?1, ?2, 0, ?3, ?4, 1, ?3 WHERE COALESCE((SELECT CAST(value AS INTEGER) FROM meta WHERE key = ?7), 0) < ?8
      ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, tries = 0, sent_at = excluded.sent_at, expires_at = excluded.expires_at,
        sends = CASE WHEN login_codes.day_start > ?5 THEN login_codes.sends + 1 ELSE 1 END,
        day_start = CASE WHEN login_codes.day_start > ?5 THEN login_codes.day_start ELSE excluded.day_start END
      WHERE login_codes.sent_at <= ?6 AND (login_codes.day_start <= ?5 OR login_codes.sends < 10)
      RETURNING sends`).bind(key, hash, at, later(10 * 60_000), dayAgo, minuteAgo, capKey, MAIL_DAILY_CAP),
    D.prepare(`INSERT INTO meta (key, value) SELECT ?1, 1 WHERE EXISTS (SELECT 1 FROM login_codes WHERE email = ?2 AND code_hash = ?3 AND sent_at = ?4)
      ON CONFLICT(key) DO UPDATE SET value = CAST(meta.value AS INTEGER) + 1`).bind(capKey, key, hash, at),
  ]);
  if (saved.results.length) return code;
  // Refused: one more read, only to say why.
  const prev = await D.prepare('SELECT sent_at, sends, day_start FROM login_codes WHERE email = ?1').bind(key).first<{ sent_at: string; sends: number; day_start: string }>();
  if (prev && prev.sent_at > minuteAgo) throw new HttpError(429, 'We just sent a code. Wait a minute before asking for another.');
  if (prev && prev.day_start > dayAgo && prev.sends >= 10) throw new HttpError(429, 'Too many codes for this email today. Try again tomorrow.');
  throw new HttpError(429, 'We are sending too many sign-in emails right now. Please try again tomorrow.');
}

/** Accepts the code once. Every check spends a try first, right or wrong. */
export async function checkCode(D: D1Database, email: string, code: unknown): Promise<void> {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) throw new HttpError(400, 'Enter the 6-digit code from the email.');
  const key = mailboxKey(email), at = now();
  // The try is counted in the same statement that checks the limit, so parallel guesses can't share one.
  const row = await D.prepare('UPDATE login_codes SET tries = tries + 1 WHERE email = ?1 AND tries < 5 AND expires_at > ?2 RETURNING code_hash')
    .bind(key, at).first<{ code_hash: string }>();
  if (!row) {
    const r = await D.prepare('SELECT tries, expires_at FROM login_codes WHERE email = ?1').bind(key).first<{ tries: number; expires_at: string }>();
    if (r && r.expires_at > at && r.tries >= 5) throw new HttpError(429, 'Too many wrong codes. Ask for a new one.');
    throw new HttpError(400, 'That code has expired. Ask for a new one.');
  }
  // The hash covers the address as typed, so a code sent to jane+1@ can't sign in jane@ (same mailbox key).
  const hash = await codeHash(email, code.trim());
  if (row.code_hash !== hash) throw new HttpError(400, 'That code is not right. Check the latest email and try again.');
  // Spent: the code can't be used again, but the day's send count stays. Only one request can spend it.
  const spent = await D.prepare("UPDATE login_codes SET code_hash = '', expires_at = sent_at WHERE email = ?1 AND code_hash = ?2").bind(key, hash).run();
  if (spent.meta.changes !== 1) throw new HttpError(400, 'That code has expired. Ask for a new one.');
}

// ---------------------------------------------------------------- accounts

/**
 * After the email is proven by its code: signs in an existing parent, or starts a pending sign-up. Returns
 * the cookies to set and whether the parent still has to confirm.
 */
export async function signIn(D: D1Database, request: Request, email: string): Promise<{ cookies: string[]; pending: boolean }> {
  const user = await D.prepare('SELECT id FROM users WHERE email = ?1').bind(email).first<{ id: string }>();
  if (user) return { cookies: [await startSession(D, request, user.id), clearCookie(SIGNUP_COOKIE), clearCookie(STUDENT_COOKIE)], pending: false };
  const token = randomToken();
  await D.prepare('INSERT INTO pending_signups (id, email, expires_at) VALUES (?1, ?2, ?3)')
    .bind(await sha256(token), email, later(15 * 60_000)).run();
  return { cookies: [setCookie(SIGNUP_COOKIE, token, 15 * 60)], pending: true };
}

/** The pending sign-up in this browser, if any. */
export async function pendingSignup(request: Request): Promise<{ id: string; email: string } | null> {
  const D = bindings.DB, token = cookie(request, SIGNUP_COOKIE);
  if (!D || !token || !TOKEN.test(token)) return null;
  const id = await sha256(token);
  const row = await D.prepare('SELECT email, expires_at FROM pending_signups WHERE id = ?1').bind(id).first<{ email: string; expires_at: string }>();
  if (!row || row.expires_at < now()) return null;
  return { id, email: row.email };
}

/**
 * Makes the account for this browser's pending sign-up and signs it in. If an account with that email
 * was made meanwhile (another tab or device), it signs in to that one: the email code proved the mailbox.
 */
export async function completeSignup(D: D1Database, request: Request): Promise<{ cookies: string[]; email: string }> {
  const p = await pendingSignup(request);
  if (!p) throw new HttpError(400, 'That sign-up has expired. Start again.');
  const id = randomToken(16), at = now();
  await D.batch([
    D.prepare('INSERT INTO users (id, email, consent_at, created_at, seen_at) VALUES (?1, ?2, ?3, ?3, ?3) ON CONFLICT(email) DO NOTHING').bind(id, p.email, at),
    D.prepare('DELETE FROM pending_signups WHERE id = ?1').bind(p.id),
  ]);
  const user = await D.prepare('SELECT id FROM users WHERE email = ?1').bind(p.email).first<{ id: string }>();
  if (!user) throw new HttpError(500, 'Could not create the account.');
  return { cookies: [await startSession(D, request, user.id), clearCookie(SIGNUP_COOKIE), clearCookie(STUDENT_COOKIE)], email: p.email };
}
