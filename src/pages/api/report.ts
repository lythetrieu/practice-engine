import { alertOwner } from '../../lib/server/alerts';
import { bindings, db, now } from '../../lib/server/env';
import { HttpError, int, postOnly, postRoute, str } from '../../lib/server/http';
import { learnerId, touchLearner } from '../../lib/server/learners';
import { requireHuman } from '../../lib/server/human';
import { guardLearner } from '../../lib/server/account';
import { ISSUE_REASONS, ISSUE_SCREENS, REASONS } from '../../lib/server/labels';
import { browserOf } from '../../lib/server/ua';
import { underDailyCap } from '../../lib/server/caps';

export const prerender = false;

// A reason from a fixed list, and no free text (students can't type a note), so nothing a child writes about
// themselves can reach the database. A note sent anyway is dropped.
// Where a report comes from: a question in the practice app ('app'), or a problem with the app itself ('issue').
const CONTEXTS = ['app', 'issue'];
// Reports per day across all browsers (src/lib/server/caps.ts), against floods that would use up D1's
// daily write quota and stop sign-in for everyone. Same number as app errors.
const DAILY_CAP = 2000;
let capLogged = ''; // the day the cap was last logged, so it is logged once a day (per isolate)

/** "Report a problem" on a question, or on the practice app itself. Behind the bot check. */
export const POST = postRoute(async ({ request, body }) => {
  const context = CONTEXTS.includes(String(body.context)) ? String(body.context) : 'app';
  const issue = context === 'issue';
  const reason = (issue ? ISSUE_REASONS : REASONS).includes(String(body.reason)) ? String(body.reason) : null;
  if (!reason) throw new HttpError(400, issue ? 'Choose what went wrong.' : 'Choose what is wrong with the question.');
  const item = issue ? 'app' : str(body.item, 'question id', 80, { pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ });
  const rev = issue ? null : int(body.rev, 'question revision', 1, 1_000_000, true);
  const browser = browserOf(request.headers.get('user-agent') || '');
  const meta = issue ? issueMeta(body.meta, browser) : questionMeta(body.meta, browser);
  const learner = body.learner == null ? null : learnerId(body.learner);
  if (learner) await guardLearner(db(), request, learner);
  const pass = await requireHuman(request, 'report', learner);
  const D = db(), at = now();
  // The question id is checked for its shape only: the questions live in the app's pack, not in the database.
  // Over the cap the report is dropped quietly: the student did nothing wrong and should not see an error.
  if (!(await underDailyCap(D, 'reports', DAILY_CAP, at))) {
    const today = at.slice(0, 10);
    if (capLogged !== today) { capLogged = today; console.warn('Reports: daily cap reached, new reports are dropped until 00:00 UTC', DAILY_CAP); }
    return pass ? { pass } : {};
  }
  await D.batch([
    ...(learner ? [touchLearner(D, learner, at)] : []),
    D.prepare('INSERT INTO reports (item_id, item_rev, learner_id, context, reason, meta, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
      .bind(item, rev, learner, context, reason, meta, at),
  ]);
  // The site operator hears about it right away (alerts.ts: at most one email per kind every 15 minutes).
  await alertOwner(D, issue ? 'app-problem' : 'report',
    issue ? `App problem reported: ${reason}` : `Question ${item} reported: ${reason}`,
    issue ? [`A student reported an app problem: ${reason}.`, `Where: ${context}. Time: ${at} (UTC).`]
      : [`A student reported question ${item}${rev ? ` (rev ${rev})` : ''}: ${reason}.`, `Time: ${at} (UTC).`],
    'reports');
  return pass ? { pass } : {};
}, { max: 4 * 1024, limiter: () => bindings.API_RL });

export const ALL = postOnly;

// The context the practice app attaches, rebuilt from whitelisted values only (never free text).
const obj = (raw: unknown) => (raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {});
const size = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 && (v as number) <= 10000 ? (v as number) : null);
const small = (v: unknown, max: number) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max ? (v as number) : null);
// A lesson, unit check or review round of the pack (lesson ids look like "<section>-<world>-<level>").
const LESSON_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
function env(m: Record<string, unknown>, browser: string | null) {
  return {
    device: ['phone', 'tablet', 'computer'].includes(String(m.device)) ? String(m.device) : null,
    w: size(m.w), h: size(m.h),
    ver: typeof m.ver === 'string' && /^[0-9a-z.-]{1,20}$/.test(m.ver) ? m.ver : null,
    browser,
  };
}

/** A question report: which lesson and question number, what was picked and whether it was right. */
function questionMeta(raw: unknown, browser: string | null): string {
  const m = obj(raw);
  const st = obj(m.step);
  return JSON.stringify({
    lesson: typeof m.lesson === 'string' && LESSON_ID.test(m.lesson) ? m.lesson : null,
    pos: small(m.pos, 200), total: small(m.total, 200),
    picked: small(m.picked, 9), checked: m.checked === true, correct: typeof m.correct === 'boolean' ? m.correct : null,
    // A level step (screens/Level.tsx): its number, kind and stage from fixed lists, and the answer on screen.
    step: m.step ? { index: small(st.index, 50), kind: STEP_KIND.test(String(st.kind)) ? String(st.kind) : null, stage: STEP_STAGES.includes(String(st.stage)) ? String(st.stage) : null } : null,
    answer: answerMeta(m.answer),
    ...env(m, browser),
  });
}

// src/practice/levels/types.ts: the step kinds are the pack's question formats plus a few of the app's own, all lowercase words.
const STEP_KIND = /^[a-z]{2,12}$/;
const STEP_STAGES = ['warmup', 'learn', 'guided', 'practice', 'mistake', 'boss', 'review'];
/** The answer a student gave on a level step, as plain data only: choice indexes, numbers, true/false, and short
    math-looking strings (digits, letters x/y/n, signs). A word or a name can't pass, so no free text reaches us (COPPA). */
const MATHY = /^[0-9a-dnxy .,+\-*/^()=<>≤≥√π%]{1,24}$/i;
function answerMeta(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const ok = (v: unknown): unknown =>
    typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'boolean' || v === null ? v
      : typeof v === 'string' && MATHY.test(v) ? v : undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 12)) {
    if (!/^[a-z]{1,12}$/i.test(k)) continue;
    if (Array.isArray(v)) out[k] = v.slice(0, 20).map((x) => (Array.isArray(x) ? x.slice(0, 20).map(ok).filter((y) => y !== undefined) : ok(x))).filter((y) => y !== undefined);
    else { const x = ok(v); if (x !== undefined) out[k] = x; }
  }
  return JSON.stringify(out).length <= 600 ? out : null;
}

/** An app-problem report: the screen picked, the screens opened just before, and the last app error. */
function issueMeta(raw: unknown, browser: string | null): string {
  const m = obj(raw);
  const screen = ISSUE_SCREENS.includes(String(m.screen)) ? String(m.screen) : 'other';
  const trail = (Array.isArray(m.trail) ? m.trail : []).slice(-8).map(obj)
    .filter((x) => ISSUE_SCREENS.includes(String(x.s)))
    .map((x) => ({ s: String(x.s), ago: small(x.ago, 86_400) }));
  const le = obj(m.lastError);
  const lastError = typeof le.message === 'string' && le.message
    ? { message: le.message.replace(/[^\x20-\x7E]/g, ' ').replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email]').replace(/\d{9,}/g, '[number]').slice(0, 200), ago: small(le.ago, 86_400) }
    : null;
  const step = typeof m.step === 'string' && /^[a-z0-9-]{3,40}#\d{1,3}:[a-z]{2,12}:[A-Za-z0-9_-]{1,40}$/.test(m.step) ? m.step : null;
  return JSON.stringify({
    screen, trail, lastError, step,
    lesson: typeof m.lesson === 'string' && LESSON_ID.test(m.lesson) ? m.lesson : null,
    ...env(m, browser),
  });
}
