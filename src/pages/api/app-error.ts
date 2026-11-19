import { alertOwner } from '../../lib/server/alerts';
import { bindings, db, now } from '../../lib/server/env';
import { HttpError, postOnly, postRoute } from '../../lib/server/http';
import { learnerId, touchLearner } from '../../lib/server/learners';
import { guardLearner } from '../../lib/server/account';
import { browserOf } from '../../lib/server/ua';
import { underDailyCap } from '../../lib/server/caps';

export const prerender = false;

// Crashes and script errors sent by the practice app (/app/) on its own, stored in the app_errors table
// (migrations/0001_init.sql). Technical details
// only, all cut to size here: no free text from the student can reach this table.
const KINDS = ['crash', 'error', 'promise'];
const SCREENS = ['home', 'learn', 'lesson', 'complete', 'review', 'test', 'me', 'other'];
const DAILY_CAP = 2000;          // writes per day across all browsers, against floods (src/lib/server/caps.ts)
const SAME_WINDOW_MS = 10 * 60_000;

export const POST = postRoute(async ({ request, body }) => {
  const kind = KINDS.includes(String(body.kind)) ? String(body.kind) : null;
  const message = clean(body.message, 300);
  if (!kind || !message) throw new HttpError(400, 'Bad error report.');
  // The level step on screen (src/practice/errors.ts setErrorStep: "<stop>#<n>:<kind>:<id>"), kept with the stack.
  const step = typeof body.step === 'string' && /^[a-z0-9-]{3,40}#\d{1,3}:[a-z]{2,12}:[A-Za-z0-9_-]{1,40}$/.test(body.step) ? body.step : null;
  const stack = ((step ? `step ${step}\n` : '') + clean(body.stack, 1500)).slice(0, 1600) || null;
  const screen = SCREENS.includes(String(body.screen)) ? String(body.screen) : 'other';
  const device = ['phone', 'tablet', 'computer'].includes(String(body.device)) ? String(body.device) : null;
  const size = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 && (v as number) <= 10000 ? (v as number) : null);
  const ver = typeof body.ver === 'string' && /^[0-9a-z.-]{1,20}$/.test(body.ver) ? body.ver : null;
  const browser = browserOf(request.headers.get('user-agent') || '');
  const learner = body.learner == null ? null : learnerId(body.learner);
  const D = db(), at = now();
  if (learner) await guardLearner(D, request, learner);

  // Every write counts against the day's cap, the count-up of a repeated error too.
  if (!(await underDailyCap(D, 'app_errors', DAILY_CAP, at))) return {};
  // The same error from the same browser within 10 minutes only counts up.
  const since = new Date(Date.now() - SAME_WINDOW_MS).toISOString();
  const same = await D.prepare('SELECT id FROM app_errors WHERE message = ?1 AND learner_id IS ?2 AND screen = ?3 AND last_at > ?4 ORDER BY id DESC LIMIT 1')
    .bind(message, learner, screen, since).first<{ id: number }>();
  if (same) {
    await D.prepare('UPDATE app_errors SET seen = seen + 1, last_at = ?2 WHERE id = ?1').bind(same.id, at).run();
    return {};
  }
  await D.batch([
    ...(learner ? [touchLearner(D, learner, at)] : []),
    D.prepare(`INSERT INTO app_errors (learner_id, kind, message, stack, screen, device, w, h, ver, browser, created_at, last_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)`)
      .bind(learner, kind, message, stack, screen, device, size(body.w), size(body.h), ver, browser, at),
  ]);
  // A new error (not a repeat from the same browser within 10 minutes): tell the site operator (at most one email per 15 minutes).
  await alertOwner(D, 'app-error', `App error on ${screen}: ${message.slice(0, 80)}`,
    [`The practice app hit an error on the ${screen} screen.`, `Message: ${message}`, `Device: ${device ?? 'unknown'} · ${browser ?? 'unknown browser'} · app ${ver ?? '?'}. Time: ${at} (UTC).`],
    'app_errors');
  return {};
}, { max: 4 * 1024, limiter: () => bindings.API_RL });

export const ALL = postOnly;

/** Plain text, cut to `max`: no URLs' query strings or fragments, no email addresses, no long digit runs. */
function clean(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  return v
    .replace(/(https?:\/\/[^\s?#)]*)[?#][^\s)]*/g, '$1')
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email]')
    .replace(/\d[\d\s().+-]{7,}\d/g, (m) => (m.replace(/\D/g, '').length >= 9 ? '[number]' : m))
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);
}
