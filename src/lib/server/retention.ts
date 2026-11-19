/* How long the server keeps things, enforced by the daily cron in src/worker.ts:
   - anonymous browser IDs (a guest who sent a problem report or an error) not seen for 12 months, with
     everything under them (ON DELETE CASCADE);
   - problem reports, answer-log rows, test sessions and the optional AI tutor's rows (ai_tutor_log, tutor_feedback) older
     than 12 months;
   - the practice app's error reports (app_errors) after 30 days, for everyone.
   Children on parent accounts keep their progress while the account is used: an account nobody has used for
   24 months (no parent sign-in, and no child signed in or practicing) is deleted with them. Expired sessions,
   sign-in codes and pending sign-ups are cleared too, as are the daily counters of sign-in emails and, after
   400 days, the tombstones of erased child IDs (erased_learners); the paid plan's handled webhook ids (90 days)
   and closed checkouts (30 days). Each run deletes in chunks within the
   Worker's query budget and leaves the rest for the next day; the result goes to meta.retention_last. */
import type { D1Database } from './env';
import { deleteAccount } from './account';

export const RETENTION_MONTHS = 12;
const CHUNK = 500;
const LIMIT = 50; // queries the Workers Free plan allows per invocation (a batch counts as one)
const BUDGET = 40; // of those, for the chunked deletes below; the rest is for the steps after them
const PER_ACCOUNT = 2; // deleteAccount: one read, then one batch
export const TOMBSTONE_DAYS = 400;

/** The oldest time still kept: 12 months before `at`. */
export function keepSince(at = new Date()): string {
  const d = new Date(at);
  d.setUTCMonth(d.getUTCMonth() - RETENTION_MONTHS);
  return d.toISOString();
}

export const ACCOUNT_IDLE_MONTHS = 24;
export const APP_ERROR_DAYS = 30;
// Rows of anonymous browsers only: a child's learner ID is in children.
const ANON = '(learner_id IS NULL OR learner_id NOT IN (SELECT learner_id FROM children))';
const STEPS: [string, string][] = [
  ['learners', 'DELETE FROM learners WHERE id IN (SELECT id FROM learners WHERE last_seen_at < ?1 AND id NOT IN (SELECT learner_id FROM children) LIMIT ?2)'],
  ['reports', `DELETE FROM reports WHERE id IN (SELECT id FROM reports WHERE created_at < ?1 AND ${ANON} LIMIT ?2)`],
  // Reports from a child's profile too, open or resolved (the admin area, migrations/0003_admin.sql): nothing in them is for the family's report.
  ['reports_children', 'DELETE FROM reports WHERE id IN (SELECT id FROM reports WHERE created_at < ?1 LIMIT ?2)'],
  // The answer log and test sessions of children too: they are for calibrating questions, not for the family's report.
  ['item_answers', 'DELETE FROM item_answers WHERE id IN (SELECT id FROM item_answers WHERE at < ?1 LIMIT ?2)'],
  ['test_sessions', 'DELETE FROM test_sessions WHERE id IN (SELECT id FROM test_sessions WHERE finished < ?1 LIMIT ?2)'],
  // The optional AI tutor (docs/pip.md): its log, with the replies, and the "does that make sense" answers. Empty tables unless it is on.
  ['ai_tutor_log', 'DELETE FROM ai_tutor_log WHERE id IN (SELECT id FROM ai_tutor_log WHERE at < ?1 LIMIT ?2)'],
  ['tutor_feedback', 'DELETE FROM tutor_feedback WHERE id IN (SELECT id FROM tutor_feedback WHERE at < ?1 LIMIT ?2)'],
];

export interface PurgeResult { at: string; keepSince: string; deleted: Record<string, number>; done: boolean }

export async function purgeOld(db: D1Database, at = new Date()): Promise<PurgeResult> {
  const since = keepSince(at), deleted: Record<string, number> = {};
  let queries = 0, done = true;
  for (const [name, sql] of STEPS) {
    deleted[name] = 0;
    for (;;) {
      if (queries >= BUDGET) { done = false; break; }
      queries++;
      const n = (await db.prepare(sql).bind(since, CHUNK).run()).meta.changes ?? 0;
      deleted[name] += n;
      if (n < CHUNK) break;
    }
    if (!done) break;
  }
  if (done) {
    // Sign-in leftovers, then parent accounts idle for 24 months (a few per run).
    const t = at.toISOString(), dayAgo = new Date(at.getTime() - 86_400_000).toISOString();
    const [s, c, p, st, sl, mc, el] = await db.batch([
      db.prepare('DELETE FROM sessions WHERE expires_at < ?1').bind(t),
      db.prepare('DELETE FROM login_codes WHERE day_start < ?1').bind(dayAgo),
      db.prepare('DELETE FROM pending_signups WHERE expires_at < ?1').bind(t),
      db.prepare('DELETE FROM student_sessions WHERE expires_at < ?1').bind(t),
      db.prepare('DELETE FROM student_links WHERE expires_at < ?1').bind(t),
      // Daily counters of days before yesterday: sign-in emails (auth.ts MAIL_DAILY_CAP) and the write caps
      // (caps.ts). Their keys end in the date.
      db.prepare("DELETE FROM meta WHERE (key LIKE 'mail_codes_%' OR key LIKE 'cap_%') AND substr(key, -10) < ?1").bind(dayAgo.slice(0, 10)),
      db.prepare('DELETE FROM erased_learners WHERE erased_at < ?1').bind(new Date(at.getTime() - TOMBSTONE_DAYS * 86_400_000).toISOString()),
    ]);
    deleted.signin = [s, c, p, st, sl, mc].reduce((n, r) => n + (r.meta.changes ?? 0), 0);
    deleted.tombstones = el.meta.changes ?? 0;
    // App error reports: 30 days. The app sends at most 2,000 a day, so one chunk a day keeps up.
    const errCut = new Date(at.getTime() - APP_ERROR_DAYS * 86_400_000).toISOString();
    deleted.app_errors = (await db.prepare('DELETE FROM app_errors WHERE id IN (SELECT id FROM app_errors WHERE created_at < ?1 LIMIT 2500)').bind(errCut).run()).meta.changes ?? 0;
    queries += 2;
    // The paid plan (migrations/0004_paid_plan.sql): handled webhook ids after 90 days, and the checkouts this site
    // opened 30 days after their page closed. Purchases themselves stay (accounting), unlinked from deleted accounts.
    try {
      const [w, k] = await db.batch([
        db.prepare('DELETE FROM webhook_events WHERE received_at < ?1').bind(new Date(at.getTime() - 90 * 86_400_000).toISOString()),
        db.prepare('DELETE FROM plan_checkouts WHERE expires_at < ?1').bind(new Date(at.getTime() - 30 * 86_400_000).toISOString()),
      ]);
      deleted.plan = (w.meta.changes ?? 0) + (k.meta.changes ?? 0);
    } catch { deleted.plan = 0; /* before migration 0004 */ }
    queries += 1;
    // Idle accounts with the queries left, keeping one for the select and one for meta.retention_last
    // below: at most 5 a run, fewer after a heavy purge, none when nothing is left (the next day catches up).
    const room = Math.min(5, Math.floor((LIMIT - queries - 2) / PER_ACCOUNT));
    deleted.accounts = 0;
    if (room > 0) {
      const idle = new Date(at);
      idle.setUTCMonth(idle.getUTCMonth() - ACCOUNT_IDLE_MONTHS);
      // Idle means no parent use (users.seen_at, which a child's student sign-in also moves) and no child
      // practicing on the account either (its learner's last_seen_at, moved by uploads).
      const { results } = await db.prepare(`SELECT id FROM users u WHERE seen_at < ?1 AND NOT EXISTS
          (SELECT 1 FROM children c JOIN learners l ON l.id = c.learner_id WHERE c.user_id = u.id AND l.last_seen_at >= ?1) LIMIT ?2`)
        .bind(idle.toISOString(), room).all<{ id: string }>();
      for (const u of results) await deleteAccount(db, u.id);
      deleted.accounts = results.length;
    }
  }
  const out = { at: at.toISOString(), keepSince: since, deleted, done };
  await db.prepare("INSERT INTO meta (key, value) VALUES ('retention_last', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify(out)).run();
  return out;
}
