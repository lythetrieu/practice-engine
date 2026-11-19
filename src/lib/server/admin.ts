/* The admin role and what the admin pages (src/pages/admin/) and API (src/pages/api/admin/) read and change.
   - Who is an admin: a signed-in PARENT (the normal email-code sign-in) whose email is in the ADMIN_EMAILS var
     (wrangler.jsonc; comma-separated, case-insensitive). Empty = nobody. There is no separate admin password.
   - A visitor who is not an admin gets a plain 404 from every /admin/ page and every /api/admin/ route, the same
     answer as for a page that does not exist, so nothing says an admin area is there.
   - Changing anything (resolving a report) needs a fresh session like other account changes (auth.ts
     requireFreshParent): a sign-in or a "confirm it's you" code in the last REAUTH_MINUTES. Reading does not.
   - Only aggregate or pseudonymous data is read. No query here selects learner_id, a nickname or a parent's
     email; the pages never show them. The overview shows counts only.
   - Cost: D1 bills rows read. The overview counts rows; the question and error pages read a time window
     (30/90/365 days, default 90 for questions) so a year of answer logs is not scanned on every visit. */
import type { APIRoute } from 'astro';
import { bindings, type D1Database } from './env';
import { HttpError, allowedOrigin, drain, json, rateLimit, readBody } from './http';
import { currentUser, freshUntil, type User } from './auth';
import { SECTION_IDS, sectionName, skillName } from '../../pack';
import type { Bank } from '../../pack/types';

// ---------------------------------------------------------------- who is an admin

/** The admin emails from ADMIN_EMAILS: trimmed, lowercase. */
export function adminEmails(): Set<string> {
  return new Set((bindings.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
}
export const isAdminEmail = (email: string) => adminEmails().has(email.trim().toLowerCase());

/** The signed-in parent when they are an admin; otherwise a 404 (a signed-out visitor and a parent who is not an admin look the same). */
export async function requireAdmin(request: Request): Promise<User> {
  const user = await currentUser(request);
  if (!user || !isAdminEmail(user.email)) throw new HttpError(404, 'Not found.');
  return user;
}
/** An admin with a session started in the last REAUTH_MINUTES; otherwise 403 {reauth: true} (only admins ever see this). */
export async function requireFreshAdmin(request: Request): Promise<User> {
  const user = await requireAdmin(request);
  if (!freshUntil(user.session_at)) throw new HttpError(403, 'Please confirm it’s you first.', { reauth: true });
  return user;
}

const NOT_FOUND = () => json({ ok: false, error: 'Not found.' }, 404);

/**
 * A POST route under /api/admin/. Order: the rate limit (API_RL), then admin or 404, then the same-origin check, a
 * fresh session, and the body (size-capped). A plain object result becomes {ok: true, ...result}.
 */
export function adminPost(handler: (a: { request: Request; url: URL; body: Record<string, unknown>; user: User }) => Promise<Record<string, unknown>>, max = 2048): APIRoute {
  return async ({ request, url }) => {
    try {
      await rateLimit(bindings.API_RL, request);
      await requireAdmin(request);
      if (!allowedOrigin(request.headers.get('origin'), url)) throw new HttpError(403, 'Please use the site’s own address.');
      const user = await requireFreshAdmin(request);
      const body = await readBody(request, max);
      return json({ ok: true, ...(await handler({ request, url, body, user })) });
    } catch (e) {
      if (request.body && !request.body.locked) await drain(request.body.getReader());
      if (e instanceof HttpError) return json({ ok: false, error: e.message, ...e.extra }, e.status, e.status === 429 ? { 'retry-after': '60' } : {});
      console.error('admin API error', url.pathname, e);
      return json({ ok: false, error: 'Something went wrong on our side. Please try again.' }, 500);
    }
  };
}
/** Every other method on an /api/admin/ route: 404, like any address that is not there. */
export const adminNotFound: APIRoute = async ({ request }) => {
  if (request.body && !request.body.locked) await drain(request.body.getReader());
  return NOT_FOUND();
};

interface PageContext {
  request: Request;
  response: { headers: Headers };
  rewrite(path: string): Promise<Response>;
}
/**
 * The gate at the top of every /admin/ page: the admin, or a Response to return (the site's own 404 for everyone
 * else: src/pages/admin/[...rest].astro). Sets the headers an admin page needs: never cached, never indexed, not framed. Pages are server-rendered
 * (`prerender = false`), so no static-assets rule (public/_headers) applies to them.
 */
export async function adminGate(ctx: PageContext): Promise<User | Response> {
  const h = ctx.response.headers;
  h.set('cache-control', 'no-store');
  h.set('x-robots-tag', 'noindex, nofollow');
  h.set('x-frame-options', 'DENY');
  h.set('referrer-policy', 'no-referrer');
  h.set('content-security-policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'");
  let user: User;
  try {
    user = await requireAdmin(ctx.request);
  } catch (e) {
    if (e instanceof HttpError) {
      const r = await ctx.rewrite('/admin/not-found/');
      r.headers.set('cache-control', 'no-store');
      r.headers.set('x-robots-tag', 'noindex');
      return r;
    }
    throw e;
  }
  try {
    await rateLimit(bindings.API_RL, ctx.request);
  } catch {
    return new Response('Too many requests. Wait a minute and reload.', { status: 429, headers: { 'retry-after': '60', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'content-type': 'text/plain; charset=utf-8' } });
  }
  return user;
}

// ---------------------------------------------------------------- the pack's questions, for the pages

/** The compiled question bank (src/pack/vite.mjs `virtual:pack-bank`), loaded only when an admin page needs it. */
export async function packBank(): Promise<Bank> {
  return (await import('virtual:pack-bank')).default as Bank;
}

const strip = (s: string) => s.replace(/<[^>]*>/g, '').replace(/\[\/?u\]/g, '').replace(/\s+/g, ' ').trim();
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export interface QInfo { id: string; section: string; sectionName: string; skill: string; skillName: string; d: number; prompt: string; kind: string; opts: string[] | null; key: number | null }
/** What the pages show about a question of the pack, by id. */
export function questionIndex(bank: Bank): Map<string, QInfo> {
  const out = new Map<string, QInfo>();
  for (const it of bank.items) {
    const s = it.step as { kind: string; prompt?: string; opts?: unknown; ans?: unknown };
    const opts = s.kind === 'mc' && Array.isArray(s.opts) ? s.opts.map((o) => cut(strip(String(o)), 80)) : null;
    out.set(it.id, {
      id: it.id, section: it.section, sectionName: sectionName(it.section), skill: it.skill, skillName: skillName(it.skill), d: it.d,
      prompt: cut(strip(String(s.prompt ?? '')), 180), kind: s.kind, opts, key: s.kind === 'mc' && typeof s.ans === 'number' ? s.ans : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------- overview

const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

export interface Overview { parents: number; children: number; active7: number; active30: number; answers: number; answers7: number; openReports: number; errors7: number; errorKinds7: number }
export async function overview(D: D1Database): Promise<Overview> {
  const t7 = ago(7), t30 = ago(30);
  const [p, c, a7, a30, ans, ans7, rep, err] = await D.batch<Record<string, number>>([
    D.prepare('SELECT COUNT(*) AS n FROM users'),
    D.prepare('SELECT COUNT(*) AS n FROM children'),
    // A child's learner row moves once a day when they practice (learners.ts touchLearner).
    D.prepare('SELECT COUNT(*) AS n FROM learners WHERE last_seen_at >= ?1 AND id IN (SELECT learner_id FROM children)').bind(t7),
    D.prepare('SELECT COUNT(*) AS n FROM learners WHERE last_seen_at >= ?1 AND id IN (SELECT learner_id FROM children)').bind(t30),
    D.prepare('SELECT COUNT(*) AS n FROM item_answers'),
    D.prepare('SELECT COUNT(*) AS n FROM item_answers WHERE at >= ?1').bind(t7),
    D.prepare('SELECT COUNT(*) AS n FROM reports WHERE resolved_at IS NULL'),
    D.prepare('SELECT COALESCE(SUM(seen), 0) AS n, COUNT(*) AS k FROM app_errors WHERE last_at >= ?1').bind(t7),
  ]);
  const n = (r: { results: Record<string, number>[] }) => r.results[0]?.n ?? 0;
  return { parents: n(p), children: n(c), active7: n(a7), active30: n(a30), answers: n(ans), answers7: n(ans7), openReports: n(rep), errors7: n(err), errorKinds7: err.results[0]?.k ?? 0 };
}

// ---------------------------------------------------------------- problem reports

export const REPORT_REASON: Record<string, string> = {
  wrong_key: 'The marked answer looks wrong', unclear: 'The question is unclear', explanation: 'The explanation is wrong or unclear',
  typo: 'A typo', display: 'It does not display well',
  broken: 'Something is broken', looks_wrong: 'Looks wrong', slow: 'Slow', sound: 'Sound', progress: 'Progress went missing', other: 'Other',
};
export type ReportStatus = 'open' | 'resolved' | 'all';
export const REPORT_PAGE = 40;

export interface ReportRow {
  id: number; item_id: string; item_rev: number | null; context: string; reason: string; created_at: string; resolved_at: string | null;
  meta: Record<string, unknown> | null;
  /** All reports on the same question, and how many of them are still open. */
  same: number; sameOpen: number;
}
export async function listReports(D: D1Database, status: ReportStatus, page: number): Promise<{ rows: ReportRow[]; more: boolean }> {
  const where = status === 'open' ? 'WHERE r.resolved_at IS NULL' : status === 'resolved' ? 'WHERE r.resolved_at IS NOT NULL' : '';
  // No learner_id: a report is shown without who sent it.
  const { results } = await D.prepare(`SELECT r.id, r.item_id, r.item_rev, r.context, r.reason, r.meta, r.created_at, r.resolved_at,
      CASE WHEN r.context = 'app' THEN (SELECT COUNT(*) FROM reports x WHERE x.item_id = r.item_id AND x.context = 'app') ELSE 0 END AS same,
      CASE WHEN r.context = 'app' THEN (SELECT COUNT(*) FROM reports x WHERE x.item_id = r.item_id AND x.context = 'app' AND x.resolved_at IS NULL) ELSE 0 END AS sameOpen
    FROM reports r ${where} ORDER BY r.created_at DESC, r.id DESC LIMIT ?1 OFFSET ?2`)
    .bind(REPORT_PAGE + 1, page * REPORT_PAGE).all<Omit<ReportRow, 'meta'> & { meta: string | null }>();
  const rows = results.slice(0, REPORT_PAGE).map((r) => {
    let meta: Record<string, unknown> | null = null;
    try { const m = r.meta ? JSON.parse(r.meta) : null; if (m && typeof m === 'object' && !Array.isArray(m)) meta = m as Record<string, unknown>; } catch { /* keep null */ }
    return { ...r, meta };
  });
  return { rows, more: results.length > REPORT_PAGE };
}
export async function reportCounts(D: D1Database): Promise<{ open: number; resolved: number }> {
  const r = await D.prepare('SELECT COALESCE(SUM(resolved_at IS NULL), 0) AS open, COALESCE(SUM(resolved_at IS NOT NULL), 0) AS resolved FROM reports').first<{ open: number; resolved: number }>();
  return { open: r?.open ?? 0, resolved: r?.resolved ?? 0 };
}
/** Resolves or reopens one report (`id`) or every report on one question (`item`). Resolving keeps the first time. Returns rows changed. */
export async function setReportsResolved(D: D1Database, target: { id: number } | { item: string }, resolved: boolean): Promise<number> {
  // Reopening writes NULL, so it binds no time; a bound value the statement does not use is an error in D1.
  const set = resolved ? 'resolved_at = COALESCE(resolved_at, ?2)' : 'resolved_at = NULL';
  const extra = resolved ? [new Date().toISOString()] : [];
  const st = 'id' in target
    ? D.prepare(`UPDATE reports SET ${set} WHERE id = ?1`).bind(target.id, ...extra)
    : D.prepare(`UPDATE reports SET ${set} WHERE item_id = ?1 AND context = 'app'`).bind(target.item, ...extra);
  return (await st.run()).meta.changes ?? 0;
}

// ---------------------------------------------------------------- app errors

export interface ErrorGroup { message: string; kinds: string; rows: number; total: number; first_at: string; last_at: string; screens: string; browsers: string; devices: string; vers: string; stack: string | null }
export async function errorGroups(D: D1Database, days: number): Promise<ErrorGroup[]> {
  const { results } = await D.prepare(`SELECT e.message, GROUP_CONCAT(DISTINCT e.kind) AS kinds, COUNT(*) AS rows, SUM(e.seen) AS total,
      MIN(e.created_at) AS first_at, MAX(e.last_at) AS last_at, GROUP_CONCAT(DISTINCT e.screen) AS screens, GROUP_CONCAT(DISTINCT e.browser) AS browsers,
      GROUP_CONCAT(DISTINCT e.device) AS devices, GROUP_CONCAT(DISTINCT e.ver) AS vers,
      (SELECT x.stack FROM app_errors x WHERE x.message = e.message ORDER BY x.id DESC LIMIT 1) AS stack
    FROM app_errors e WHERE e.last_at >= ?1 GROUP BY e.message ORDER BY last_at DESC LIMIT 100`).bind(ago(days)).all<ErrorGroup>();
  return results;
}

// ---------------------------------------------------------------- question statistics

/** Tries needed before a question is flagged: a few answers say nothing. */
export const MIN_TRIES = 30;
export const EASY_AT = 0.95, HARD_AT = 0.25;
export type QFlag = 'easy' | 'hard' | 'check';
export const FLAG_LABEL: Record<QFlag, string> = { easy: 'Too easy', hard: 'Too hard', check: 'Check this' };

export interface QRow {
  id: string; inPack: boolean; section: string; sectionName: string; skill: string; skillName: string; d: number | null; prompt: string; kind: string;
  tries: number; right: number; pct: number | null; hints: number | null;
  /** The key (multiple choice) and the most-picked wrong choice, when the answer log has picks. */
  key: number | null; keyText: string | null;
  wrong: { idx: number; text: string | null; n: number; share: number } | null;
  flags: QFlag[];
}
export interface QTable { rows: QRow[]; bankSize: number; answered: number; never: number; unknown: number; flagged: number; tries: number }

/** Per question: tries, % right, average hints and the picks, over the last `days` days, joined with the pack's questions. */
export async function questionTable(D: D1Database, bank: Bank, days: number): Promise<QTable> {
  const idx = questionIndex(bank);
  // One pass over the window: a row per question and pick (pick is NULL for questions that are not multiple choice).
  const { results } = await D.prepare(`SELECT item_id, pick, COUNT(*) AS n, SUM(correct) AS r, SUM(hints) AS h
    FROM item_answers WHERE at >= ?1 GROUP BY item_id, pick`).bind(ago(days)).all<{ item_id: string; pick: number | null; n: number; r: number; h: number }>();
  const by = new Map<string, { tries: number; right: number; hints: number; picks: { pick: number; n: number; r: number }[] }>();
  for (const x of results) {
    const s = by.get(x.item_id) ?? { tries: 0, right: 0, hints: 0, picks: [] };
    s.tries += x.n; s.right += x.r; s.hints += x.h ?? 0;
    if (x.pick != null) s.picks.push({ pick: x.pick, n: x.n, r: x.r });
    by.set(x.item_id, s);
  }
  const rows: QRow[] = [];
  const make = (id: string, q: QInfo | undefined): QRow => {
    const s = by.get(id);
    const tries = s?.tries ?? 0, right = s?.right ?? 0;
    const pct = tries ? right / tries : null;
    // The most-picked wrong choice, and how many picks were the right one.
    let wrong: QRow['wrong'] = null, rightPicks = 0;
    for (const p of s?.picks ?? []) {
      rightPicks += p.r;
      const wn = p.n - p.r;
      if (wn > 0 && (!wrong || wn > wrong.n)) wrong = { idx: p.pick, text: q?.opts?.[p.pick] ?? null, n: wn, share: tries ? wn / tries : 0 };
    }
    const flags: QFlag[] = [];
    if (pct != null && tries >= MIN_TRIES) {
      if (wrong && wrong.n > rightPicks) flags.push('check');
      if (pct <= HARD_AT) flags.push('hard');
      if (pct >= EASY_AT) flags.push('easy');
    }
    return {
      id, inPack: !!q, section: q?.section ?? '', sectionName: q?.sectionName ?? 'Not in this pack', skill: q?.skill ?? '', skillName: q?.skillName ?? '',
      d: q?.d ?? null, prompt: q?.prompt ?? '(no longer in the pack)', kind: q?.kind ?? '', tries, right, pct,
      hints: tries ? (s?.hints ?? 0) / tries : null, key: q?.key ?? null, keyText: q?.key != null ? q.opts?.[q.key] ?? null : null, wrong, flags,
    };
  };
  for (const [id, q] of idx) rows.push(make(id, q));
  let unknown = 0;
  for (const id of by.keys()) if (!idx.has(id)) { rows.push(make(id, undefined)); unknown++; }
  return {
    rows, bankSize: idx.size, answered: rows.filter((r) => r.tries > 0 && r.inPack).length, never: rows.filter((r) => r.tries === 0).length, unknown,
    flagged: rows.filter((r) => r.flags.length).length, tries: rows.reduce((n, r) => n + r.tries, 0),
  };
}

const FLAG_RANK: Record<QFlag, number> = { check: 3, hard: 2, easy: 1 };
const sectionRank = (id: string) => { const i = SECTION_IDS.indexOf(id); return i < 0 ? 999 : i; };
export const SORTS = ['flag', 'section', 'skill', 'right', 'tries', 'hints', 'd'] as const;
export type QSort = (typeof SORTS)[number];
/** Sorts a copy of the rows. `flag` always puts the worst first; the others sort ascending unless `desc`. Rows with no
    value (no tries) go last either way. */
export function sortQuestions(rows: QRow[], by: QSort, desc: boolean): QRow[] {
  const dir = desc ? -1 : 1;
  const num = (get: (r: QRow) => number | null) => (a: QRow, b: QRow) => {
    const x = get(a), y = get(b);
    return x == null && y == null ? 0 : x == null ? 1 : y == null ? -1 : (x - y) * dir;
  };
  const cmp: Record<QSort, (a: QRow, b: QRow) => number> = {
    flag: (a, b) => (Math.max(0, ...b.flags.map((f) => FLAG_RANK[f])) - Math.max(0, ...a.flags.map((f) => FLAG_RANK[f]))) || b.tries - a.tries,
    section: (a, b) => (sectionRank(a.section) - sectionRank(b.section) || a.skillName.localeCompare(b.skillName)) * dir,
    skill: (a, b) => a.skillName.localeCompare(b.skillName) * dir,
    right: num((r) => r.pct),
    tries: num((r) => r.tries),
    hints: num((r) => r.hints),
    d: num((r) => r.d),
  };
  return [...rows].sort((a, b) => cmp[by](a, b) || a.id.localeCompare(b.id));
}
