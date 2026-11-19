/* Parent accounts: children and deletion.
   - A child is a nickname (24 characters at most) and an optional grade, nothing else. Its progress is
     saved under its own learner ID; the upload routes check that only its parent's session (or its own
     student session) can write to it.
   - Removing a child, or deleting the account, erases in one D1 batch (all or nothing) and leaves a
     tombstone for each child's learner ID (erased_learners): the child's devices may still hold that ID,
     and their uploads under it answer 410 {gone: true} instead of making it again. */
import { config } from '../../pack';
import { now, type D1Database, type D1PreparedStatement } from './env';
import { HttpError } from './http';
import { eraseLearnerStatements, newLearnerId } from './learners';
import { currentUser, mailboxKey, randomToken, sha256 } from './auth';
import { currentStudent, newPassword, newUsername } from './student';
import { hashSecret } from './password';

/** Children per parent account. */
export const MAX_CHILDREN = 3;

export interface Child { id: string; learner: string; nickname: string; grade: number | null; username?: string | null }
export async function childrenOf(D: D1Database, userId: string): Promise<Child[]> {
  const { results } = await D.prepare('SELECT id, learner_id AS learner, nickname, grade, username FROM children WHERE user_id = ?1 ORDER BY created_at')
    .bind(userId).all<Child>();
  return results;
}
export async function childOf(D: D1Database, userId: string, childId: unknown): Promise<Child> {
  const c = typeof childId === 'string' && childId.length <= 40
    ? await D.prepare('SELECT id, learner_id AS learner, nickname, grade, username FROM children WHERE id = ?1 AND user_id = ?2').bind(childId, userId).first<Child>()
    : null;
  if (!c) throw new HttpError(404, 'That child is not on your account.');
  return c;
}

export function cleanNickname(v: unknown): string {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  if (!s || s.length > 24 || /[<>@]|\d{3,}/.test(s)) throw new HttpError(400, 'Enter a nickname of up to 24 letters (no email or numbers).');
  return s;
}
/** The grade must be one of the pack's audience options (pack.yaml `audience`); a pack with none takes no grade. */
export function cleanGrade(v: unknown): number | null {
  if (v == null || v === '') return null;
  const g = Number(v);
  const options = config.audience?.options ?? [];
  if (!Number.isInteger(g) || !options.some((o) => o.value === g)) {
    throw new HttpError(400, options.length ? `Choose one of: ${options.map((o) => o.label).join(', ')}.` : 'This site does not ask for a grade.');
  }
  return g;
}

/**
 * Adds a child with its student login: a username from the nickname and a word password, which the
 * parent sees this once. The login is made first, then the learner ID and the child are saved in one
 * batch that writes nothing once the parent has MAX_CHILDREN, so parallel requests can't pass the limit
 * and a failure never leaves a child without a login.
 */
export async function addChild(D: D1Database, userId: string, nickname: string, grade: number | null): Promise<{ child: Child; login: { username: string; password: string } }> {
  // A quick answer for the usual case; the batch below is what enforces the limit.
  const n = await D.prepare('SELECT COUNT(*) AS n FROM children WHERE user_id = ?1').bind(userId).first<{ n: number }>();
  if ((n?.n ?? 0) >= MAX_CHILDREN) throw new HttpError(400, `An account can have up to ${MAX_CHILDREN} children.`);
  const password = newPassword(), hash = await hashSecret(password); // 503 here, before anything is saved, if logins aren't set up
  const child = { id: randomToken(12), learner: newLearnerId(), nickname, grade }, at = now();
  for (let attempt = 0; ; attempt++) {
    const username = await newUsername(D, nickname);
    try {
      const [, saved] = await D.batch([
        D.prepare('INSERT INTO learners (id, created_at, last_seen_at) SELECT ?1, ?2, ?2 WHERE (SELECT COUNT(*) FROM children WHERE user_id = ?3) < ?4')
          .bind(child.learner, at, userId, MAX_CHILDREN),
        D.prepare(`INSERT INTO children (id, user_id, learner_id, nickname, grade, created_at, username, password_hash, login_version)
            SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1 WHERE (SELECT COUNT(*) FROM children WHERE user_id = ?2) < ?9 AND EXISTS (SELECT 1 FROM learners WHERE id = ?3)`)
          .bind(child.id, userId, child.learner, nickname, grade, at, username, hash, MAX_CHILDREN),
      ]);
      if (!saved.meta.changes) throw new HttpError(400, `An account can have up to ${MAX_CHILDREN} children.`);
      return { child: { ...child, username }, login: { username, password } };
    } catch (e) {
      // Another family took the same username a moment ago (the batch saved nothing): pick another, once.
      if (attempt === 0 && /UNIQUE constraint failed: children\.username/.test(String((e as Error)?.message))) continue;
      throw e;
    }
  }
}

/** A tombstone for an erased child's learner ID (only its SHA-256), in the same batch as the erase. */
async function tombstone(D: D1Database, learner: string, at: string): Promise<D1PreparedStatement> {
  return D.prepare('INSERT INTO erased_learners (id_hash, erased_at) VALUES (?1, ?2) ON CONFLICT(id_hash) DO NOTHING').bind(await sha256(learner), at);
}

/** The optional AI tutor's rows for a learner (migrations/0002_ai_tutor.sql): its log and the "does that make sense" answers.
    They also go with the learner row (ON DELETE CASCADE); listing them keeps the erase explicit. */
const tutorErase = (D: D1Database, learner: string): D1PreparedStatement[] => [
  D.prepare('DELETE FROM tutor_feedback WHERE learner = ?1').bind(learner),
  D.prepare('DELETE FROM ai_tutor_log WHERE learner = ?1').bind(learner),
];

/** Deletes a child's profile with every answer, progress copy, tutor row and report saved under it. */
export async function removeChild(D: D1Database, userId: string, childId: unknown) {
  const c = await childOf(D, userId, childId);
  // The children row goes with the learner (ON DELETE CASCADE), and with it the child's sessions and links.
  await D.batch([...tutorErase(D, c.learner), ...eraseLearnerStatements(D, c.learner), await tombstone(D, c.learner, now())]);
}

/** The parent account a learner ID belongs to, or null for an anonymous browser. */
export async function learnerOwner(D: D1Database, learner: string): Promise<string | null> {
  const r = await D.prepare('SELECT user_id FROM children WHERE learner_id = ?1').bind(learner).first<{ user_id: string }>();
  return r?.user_id ?? null;
}

/**
 * Uploads under a child's learner ID need that child's student session or its parent's session;
 * anonymous IDs need nothing. An erased child's ID is refused for good (410, gone: true), so its rows
 * never come back; the browser then drops what it still had queued for it.
 */
export async function guardLearner(D: D1Database, request: Request, learner: string) {
  const r = await D.prepare('SELECT (SELECT user_id FROM children WHERE learner_id = ?1) AS owner, EXISTS (SELECT 1 FROM erased_learners WHERE id_hash = ?2) AS gone')
    .bind(learner, await sha256(learner)).first<{ owner: string | null; gone: number }>();
  if (r?.gone) throw new HttpError(410, 'This profile was removed. Sign in again to keep practicing.', { gone: true });
  const owner = r?.owner ?? null;
  if (!owner) return;
  const student = await currentStudent(request);
  if (student && student.learner === learner) return;
  const user = await currentUser(request);
  if (!user || user.id !== owner) throw new HttpError(401, 'Sign in again to save this to your account.');
}

/**
 * Deletes the account: every child's data (with a tombstone each), sessions, the email's sign-in codes
 * and pending sign-ups. One read, then one batch: all or nothing.
 */
export async function deleteAccount(D: D1Database, userId: string) {
  const { results } = await D.prepare('SELECT u.email, c.learner_id AS learner FROM users u LEFT JOIN children c ON c.user_id = u.id WHERE u.id = ?1')
    .bind(userId).all<{ email: string; learner: string | null }>();
  if (!results.length) return; // already gone
  const email = results[0].email, learners = results.flatMap((r) => (r.learner ? [r.learner] : [])), at = now();
  await D.batch([
    ...learners.flatMap((l) => [...tutorErase(D, l), ...eraseLearnerStatements(D, l)]),
    ...(await Promise.all(learners.map((l) => tombstone(D, l, at)))),
    // Codes are kept under the mailbox key.
    D.prepare('DELETE FROM login_codes WHERE email IN (?1, ?2)').bind(email, mailboxKey(email)),
    D.prepare('DELETE FROM pending_signups WHERE email = ?1').bind(email),
    D.prepare('DELETE FROM users WHERE id = ?1').bind(userId),
  ]);
}
