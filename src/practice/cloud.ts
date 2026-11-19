// The practice app's progress follows a signed-in child to every device through /api/me/app-progress (and the
// parent report reads it there). The browser copy stays the working copy (the app works offline); this file pulls
// the profile's copy, merges the two and pushes the result. The merge keeps the better of both sides, so practising
// on two devices loses nothing. Full test results are part of the progress (p.tests), merged by test id.
import { type Progress, type LessonRec, type Mistake } from './store';
import { mergeTutor, cleanTutor } from './tutor/model';


const later = (a?: string, b?: string) => ((a || '') >= (b || '') ? a : b);
const union = (a: string[] = [], b: string[] = []) => [...new Set([...a, ...b])].sort();
const maxDays = (a: Record<string, number> = {}, b: Record<string, number> = {}) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = Math.max(out[k] || 0, v || 0);
  return out;
};

/** A lesson or unit check left part-way is dropped once that lesson was finished on either side on or after the day it
    was started (`at` is a calendar day), so a finished level never comes back as "Resume" from an older copy. A replay
    started on a later day than the lesson's first finish still counts as in progress. */
export function staleDropped(ip: Progress['inProgress'] | undefined, lessons: Record<string, LessonRec>): Progress['inProgress'] {
  if (!ip) return null;
  if (ip.kind === 'review') return ip;
  const r = lessons[ip.id];              // a passed unit check is stored in `lessons` too
  return r && (r.last || r.at || '') >= (ip.at || '') ? null : ip;
}

/** Both copies merged: the better result of every lesson, every day practised, every badge and mistake. */
export function mergeProgress(local: Progress, remote: Progress): Progress {
  const lessons: Record<string, LessonRec> = { ...remote.lessons };
  for (const [id, l] of Object.entries(local.lessons || {})) {
    const r = lessons[id];
    lessons[id] = !r ? l : { stars: Math.max(l.stars, r.stars), best: Math.max(l.best, r.best), of: Math.max(l.of, r.of), at: later(l.at, r.at) || l.at,
      last: [l.last, r.last, l.at, r.at].filter(Boolean).sort().pop() };
  }
  const checks = { ...remote.checks };
  for (const [id, v] of Object.entries(local.checks || {})) checks[id] = Math.max(v, checks[id] || 0);
  const badges = { ...remote.badges };
  for (const [id, day] of Object.entries(local.badges || {})) badges[id] = !badges[id] || day < badges[id] ? day : badges[id];
  // Mistakes from both devices, the copy with the most progress (good, then later due) per question. A mistake
  // fixed on one device can come back once from the other; redoing it once more is the safe side.
  const byQ = new Map<string, Mistake>();
  for (const m of [...(remote.mistakes || []), ...(local.mistakes || [])]) {
    const o = byQ.get(m.qid);
    if (!o || (m.good || 0) > (o.good || 0) || ((m.good || 0) === (o.good || 0) && (m.due || '') > (o.due || ''))) byQ.set(m.qid, m);
  }
  const quests = local.quests?.day === remote.quests?.day
    ? { day: local.quests.day, claimed: union(local.quests.claimed, remote.quests.claimed) }
    : (local.quests?.day || '') >= (remote.quests?.day || '') ? local.quests : remote.quests;
  const ip = staleDropped(
    local.inProgress && remote.inProgress ? ((local.inProgress.at || '') >= (remote.inProgress.at || '') ? local.inProgress : remote.inProgress) : local.inProgress || remote.inProgress,
    lessons);
  return {
    ...remote,
    ...local,                               // settings (sound, motion, test day, subject) follow this device
    started: (local.started || '') < (remote.started || '') && local.started ? local.started : remote.started || local.started,
    xp: Math.max(local.xp || 0, remote.xp || 0),
    xpDays: maxDays(local.xpDays, remote.xpDays),
    qDays: maxDays(local.qDays, remote.qDays),
    secDays: maxDays(local.secDays, remote.secDays),
    days: union(local.days, remote.days),
    lessons, checks,
    tried: { ...remote.tried, ...local.tried },
    chests: union(local.chests, remote.chests),
    bestRun: Math.max(local.bestRun || 0, remote.bestRun || 0),
    dayRun: (local.dayRun?.day || '') === (remote.dayRun?.day || '') ? { day: local.dayRun.day, best: Math.max(local.dayRun.best, remote.dayRun.best) } : local.dayRun,
    mistakes: [...byQ.values()],
    fixed: Math.max(local.fixed || 0, remote.fixed || 0),
    quests, badges,
    reading: Math.max(local.reading || 0, remote.reading || 0),
    tools: union(local.tools, remote.tools),
    fullTests: Math.max(local.fullTests || 0, remote.fullTests || 0),
    tests: [...new Map([...(remote.tests || []), ...(local.tests || [])].map((t) => [t.id, t])).values()].sort((a, b) => a.at.localeCompare(b.at)).slice(-20),
    inProgress: ip ?? null,
    grade: local.grade ?? remote.grade ?? null,   // a grade picked on either device
    nextFall: local.grade != null ? !!local.nextFall : !!remote.nextFall,
    tutor: mergeTutor(cleanTutor(local.tutor), cleanTutor(remote.tutor)),
  };
}

/** Who the progress belongs to: the signed-in student (no child id needed) or the child a parent picked. */
export interface CloudWho { child: string | null }
const url = (who: CloudWho) => '/api/me/app-progress/' + (who.child ? `?child=${encodeURIComponent(who.child)}` : '');

let base = 0;                 // the rev this device last read or wrote
let off = false;              // 401 or 404: stop trying until the profile changes
let busy: Promise<unknown> | null = null;

export function resetCloud() { base = 0; off = false; }

/** Pulls the profile's copy and merges it into `local`. Returns the merged progress, or null when nothing changed
    or sync is not available (signed out, offline). */
export async function pullProgress(who: CloudWho, local: Progress): Promise<Progress | null> {
  if (off) return null;
  try {
    const r = await fetch(url(who), { credentials: 'same-origin', cache: 'no-store' });
    if (r.status === 402 || r.status === 401 || r.status === 404) { off = true; return null; }
    if (!r.ok) return null;
    const d = (await r.json()) as { data: Progress | null; rev: number };
    base = d.rev || 0;
    return d.data ? mergeProgress(local, d.data) : null;
  } catch { return null; }
}

/** Pushes `p`. On a conflict (another device saved first) it merges with the
    server copy and tries once more; returns the merged progress then, so the app can show it. */
export async function pushProgress(who: CloudWho, p: Progress, keepalive = false): Promise<Progress | null> {
  if (off) return null;
  if (busy) await busy.catch(() => {});
  const send = (data: Progress) => fetch(url(who), {
    method: 'PUT', credentials: 'same-origin', keepalive,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data, base }),
  });
  const run = (async () => {
    try {
      let r = await send(p);
      if (r.status === 402 || r.status === 401 || r.status === 404) { off = true; return null; }
      if (r.status === 409) {
        const d = (await r.json()) as { data: Progress | null; rev: number };
        base = d.rev || 0;
            const merged = d.data ? mergeProgress(p, d.data) : p;
        r = await send(merged);
        if (r.ok) { base = ((await r.json()) as { rev: number }).rev; return merged; }
        return merged;
      }
      if (r.ok) base = ((await r.json()) as { rev: number }).rev;
      return null;
    } catch { return null; }
  })();
  busy = run;
  try { return await run; } finally { if (busy === run) busy = null; }
}
