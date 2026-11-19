/* Learner IDs. A child of a parent account has one (made here when the child is added); an anonymous browser
   makes its own random ID (src/lib/client/profiles.ts browserId) the first time it sends a problem report or
   an app error. 16 characters of Crockford base32, 80 random bits. It is never shown to the family, and it
   is the only key to a learner's rows, so it is never put in a URL. */
import type { D1Database, D1PreparedStatement } from './env';
import { HttpError } from './http';

export const CODE = /^[0-9A-HJKMNP-TV-Z]{16}$/;

const ABC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** A new ID in the browsers' format, for a child profile made by a parent account. */
export function newLearnerId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => ABC[b & 31]).join('');
}

/** The browser ID a request carries, or a 400. */
export function learnerId(v: unknown): string {
  if (typeof v !== 'string' || !CODE.test(v)) throw new HttpError(400, 'Invalid browser ID.');
  return v;
}

/** Adds the ID if it is new; last_seen_at moves at most once a day (D1 bills every write). */
export const touchLearner = (db: D1Database, id: string, at: string): D1PreparedStatement =>
  db.prepare(`INSERT INTO learners (id, created_at, last_seen_at) VALUES (?1, ?2, ?2)
    ON CONFLICT(id) DO UPDATE SET last_seen_at = ?2 WHERE substr(learners.last_seen_at, 1, 10) < substr(?2, 1, 10)`).bind(id, at);

/** The statements that erase everything saved under an ID, for a batch of their own or a larger one
    (deleting a parent account erases every child in one batch). */
export const eraseLearnerStatements = (db: D1Database, id: string): D1PreparedStatement[] => [
  db.prepare('DELETE FROM item_answers WHERE learner_id = ?1').bind(id),
  db.prepare('DELETE FROM test_sessions WHERE learner_id = ?1').bind(id),
  db.prepare('DELETE FROM app_progress WHERE learner_id = ?1').bind(id),
  db.prepare('DELETE FROM reports WHERE learner_id = ?1').bind(id),
  db.prepare('DELETE FROM app_errors WHERE learner_id = ?1').bind(id),
  db.prepare('DELETE FROM learners WHERE id = ?1').bind(id),
];

/** Erases everything saved under an ID, in one batch. */
export async function eraseLearner(db: D1Database, id: string) {
  await db.batch(eraseLearnerStatements(db, id));
}
