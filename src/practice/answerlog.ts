// Answer log: every answer a signed-in learner gives in the practice app is sent to /api/me/answers,
// so the admin Insights page can see which questions are shown a lot, never shown, too easy or too hard for their level.
// Ids and numbers only: no free text is ever stored. Answers wait in an outbox in localStorage (a phone that is offline,
// or a tab closed too early, loses nothing) and go up in batches of at most 200. A guest (not signed in) gets a 401 and
// the rows are dropped; a 4xx other than 429 drops the batch, anything else is tried again on the next call.
export const OUTBOX_KEY = 'pe.answerlog.v1';
const CAP = 2000;          // rows kept in the outbox; the oldest go first
const BATCH = 200;         // rows per request (the server accepts at most 200)

export const LOG_CTX = ['lesson', 'check', 'placement', 'skill', 'practice', 'fix', 'review', 'test'] as const;
export type AnswerCtx = (typeof LOG_CTX)[number];

export interface AnswerIn { id: string; rev?: number; correct: boolean; hints?: number; ms?: number; formId?: string; /** multiple choice: the choice picked */ pick?: number }
export interface SessionIn {
  id: string; formId?: string | null; kind?: 'generated' | 'fixed'; items?: string[]; started?: string; finished?: string;
  elaRight?: number; elaTotal?: number; mathRight?: number; mathTotal?: number;
}
/** Who the answers belong to, as in cloud.ts: the signed-in student ({child: null}) or the child a parent picked. */
export interface AnswerWho { child: string | null }

interface Row { u: string; t: 'a'; id: string; rev?: number; ctx: string; form?: string; c: 0 | 1; h?: number; ms?: number; pick?: number; at: string; child?: string }
interface Ses { u: string; t: 's'; id: string; form?: string; kind?: string; items?: string[]; started?: string; finished?: string; er?: number; et?: number; mr?: number; mt?: number; at: string; child?: string }
type Entry = Row | Ses;

let defaultWho: AnswerWho | null = null;
/** The app tells the log who is practicing (the child a parent picked), for code that logs without knowing, like
    the full-test results. Call it with null for a guest. */
export function setAnswerWho(who: AnswerWho | null) { defaultWho = who; }
/** Who is practicing now (null for a guest): the AI tutor asks for the same learner (aitutor.ts). */
export const answerWho = () => defaultWho;

// A teaching step ("math-1-1-g1"), a reflect step ("reflect:...") or anything that is not shaped like a bank id.
const STEP = /^(?:math|ela)-\d+-\d+-(?:w|l|g1|g2|m)$/;
const BANK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
/** The bank question id inside an id the app uses ("<stop>/<itemId>" on the map), or null for a step that is not a bank question. */
export function bankId(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const id = raw.includes('/') ? raw.slice(raw.lastIndexOf('/') + 1) : raw;
  return BANK_ID.test(id) && !STEP.test(id) ? id : null;
}

function read(): Entry[] {
  try { const v = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function write(list: Entry[]) {
  try {
    if (list.length) localStorage.setItem(OUTBOX_KEY, JSON.stringify(list.slice(-CAP)));
    else localStorage.removeItem(OUTBOX_KEY);
  } catch { /* storage full or blocked: this device just does not keep the log */ }
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const int = (n: unknown, max: number): number | undefined => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) && v >= 0 ? Math.min(v, max) : undefined;
};

/** Adds answers to the outbox and sends them soon. `ctx` is one of lesson, check, placement, skill, practice, fix, review, test. */
export function logAnswers(ctx: string, answers: AnswerIn[], who?: AnswerWho | null): void {
  if (typeof localStorage === 'undefined' || !(LOG_CTX as readonly string[]).includes(ctx)) return;
  const w = who === undefined ? defaultWho : who;
  const at = new Date().toISOString(), rows: Row[] = [];
  for (const a of answers || []) {
    const id = bankId(a?.id);
    if (!id) continue;
    const row: Row = { u: uid(), t: 'a', id, ctx, c: a.correct ? 1 : 0, at };
    const rev = int(a.rev, 1e6), h = int(a.hints, 99), ms = int(a.ms, 36e5);
    if (rev) row.rev = rev;
    if (h) row.h = h;
    if (ms != null) row.ms = ms;
    const pk = int(a.pick, 5);
    if (pk != null) row.pick = pk;
    if (typeof a.formId === 'string' && /^[A-Za-z0-9._-]{1,40}$/.test(a.formId)) row.form = a.formId;
    if (w?.child) row.child = w.child;
    rows.push(row);
  }
  if (!rows.length) return;
  write([...read(), ...rows]);
  soon();
}

/** Adds one finished full test to the outbox. */
export function logTestSession(s: SessionIn, who?: AnswerWho | null): void {
  if (typeof localStorage === 'undefined' || !s || typeof s.id !== 'string' || !/^[A-Za-z0-9._:-]{1,80}$/.test(s.id)) return;
  const w = who === undefined ? defaultWho : who;
  const e: Ses = { u: uid(), t: 's', id: s.id, at: new Date().toISOString() };
  if (s.formId && /^[A-Za-z0-9._-]{1,40}$/.test(s.formId)) e.form = s.formId;
  if (s.kind === 'generated' || s.kind === 'fixed') e.kind = s.kind;
  if (Array.isArray(s.items)) e.items = s.items.map(bankId).filter((x): x is string => !!x).slice(0, 400);
  if (s.started) e.started = String(s.started).slice(0, 40);
  if (s.finished) e.finished = String(s.finished).slice(0, 40);
  e.er = int(s.elaRight, 999); e.et = int(s.elaTotal, 999); e.mr = int(s.mathRight, 999); e.mt = int(s.mathTotal, 999);
  if (w?.child) e.child = w.child;
  write([...read().filter((x) => !(x.t === 's' && x.id === s.id)), e]);
  soon();
}

let timer: ReturnType<typeof setTimeout> | undefined;
let busy: Promise<void> | null = null;
let pauseUntil = 0;       // after a 401: wait before asking again (a guest has no account to log to)
const soon = () => { if (timer) return; timer = setTimeout(() => { timer = undefined; void flushAnswers(); }, 3000); };

/** Sends what is waiting in the outbox. Safe to call at any time; one run at a time. */
export function flushAnswers(keepalive = false): Promise<void> {
  if (busy) return busy;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.resolve();
  if (Date.now() < pauseUntil) return Promise.resolve();
  const run = (async () => {
    for (let guard = 0; guard < 20; guard++) {
      const all = read();
      if (!all.length) return;
      // one request per child: the first entry's child, then up to BATCH entries of the same child
      const child = all[0].child ?? null;
      const mine = all.filter((e) => (e.child ?? null) === child).slice(0, BATCH);
      const rows = mine.filter((e): e is Row => e.t === 'a').map((r) => ({ id: r.id, rev: r.rev, ctx: r.ctx, form: r.form, c: r.c, h: r.h, ms: r.ms, pick: r.pick, at: r.at }));
      const sessions = mine.filter((e): e is Ses => e.t === 's').map((s) => ({ id: s.id, form: s.form, kind: s.kind, items: s.items, started: s.started, finished: s.finished, er: s.er, et: s.et, mr: s.mr, mt: s.mt }));
      let res: Response;
      try {
        res = await fetch('/api/me/answers/' + (child ? `?child=${encodeURIComponent(child)}` : ''), {
          method: 'POST', credentials: 'same-origin', keepalive,
          headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rows, sessions }),
        });
      } catch { return; }   // offline or the network dropped: try again on the next call
      const drop = () => { const gone = new Set(mine.map((e) => e.u)); write(read().filter((e) => !gone.has(e.u))); };
      if (res.ok) { drop(); continue; }
      if (res.status === 429 || res.status >= 500) return;
      if (res.status === 401) pauseUntil = Date.now() + 10 * 60 * 1000;
      drop();               // any other 4xx: this batch will never be accepted
      if (res.status === 401) return;
    }
  })();
  busy = run.finally(() => { busy = null; });
  return busy;
}

if (typeof window !== 'undefined') {
  addEventListener('online', () => { pauseUntil = 0; void flushAnswers(); });
  addEventListener('pagehide', () => { void flushAnswers(true); });
  // anything left from an earlier visit goes up shortly after the app opens
  setTimeout(() => { void flushAnswers(); }, 5000);
}
