// The optional AI tutor (docs/pip.md): after Check, a student who says an explanation did not click can ask for another one
// by tapping a button. No free text (COPPA): the student only taps, and the server (src/pages/api/me/tutor.ts) builds the
// model's question from the step the app sends. 30 asks a day per learner, and a site-wide cap.
import { answerWho } from './answerlog';

// Whether the site has the tutor switched on (/api/me/ `pip`: PIP_ENABLED=1 and an OpenRouter key): off until /api/me/ says
// so, and while offline (the tutor needs the network). Off, the app shows the pack's reviewed hints and explanations only,
// no AI buttons.
let pipOn = false;
export const pipEnabled = () => pipOn;
export const setPipEnabled = (v: boolean) => { pipOn = v; };

export type TutorKind = 'why_wrong' | 'why_right' | 'another_way' | 'simpler' | 'hint';
export interface TutorStep { stem: string; opts?: string[]; answer: string; chosen?: string; exp?: string; note?: string; passage?: string }
/** What the app tells the tutor about the student: lesson ids and numbers only, never a name. */
export interface TutorCtx {
  stop?: string; weak?: string[]; slips?: Record<string, number>; tries?: number; missedBefore?: boolean; hints?: number; grade?: number;
}
/** What the tutor may do in the app; the server has checked each one. `similar` is resolved by the app (a question of the
    same lesson it has in its copy of the pack). */
export type TutorAction =
  | { act: 'highlight'; choice: string }
  | { act: 'hint' }
  | { act: 'similar' }
  | { act: 'review' };
export type TutorReply =
  | { ok: true; text: string; left: number | null; actions: TutorAction[]; ask: number | null }
  | { ok: false; why: 'setup' | 'limit' | 'signin' | 'offline' | 'error' };

/** Plain text from the app's step HTML (bold, italics, line breaks), for the model. */
export const plainText = (html: string) => html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

export async function askTutor(item: string, kind: TutorKind, step: TutorStep, prior?: string, ctx?: TutorCtx): Promise<TutorReply> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { ok: false, why: 'offline' };
  const who = answerWho();
  const url = '/api/me/tutor/' + (who?.child ? `?child=${encodeURIComponent(who.child)}` : '');
  try {
    const r = await fetch(url, {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item, kind, step, ...(prior ? { prior: prior.slice(0, 900) } : {}), ...(ctx ? { ctx } : {}) }),
    });
    if (r.ok) {
      const d = await r.json() as { text?: unknown; left?: unknown; actions?: unknown; ask?: unknown };
      return typeof d.text === 'string' && d.text.trim()
        ? { ok: true, text: d.text.trim(), left: typeof d.left === 'number' ? d.left : null, actions: actionsOf(d.actions), ask: typeof d.ask === 'number' ? d.ask : null }
        : { ok: false, why: 'error' };
    }
    if (r.status === 401 || r.status === 404) return { ok: false, why: 'signin' };   // signed out, or a parent with no child picked
    if (r.status === 429) return { ok: false, why: 'limit' };
    if (r.status === 503) { if (((await r.json().catch(() => ({}))) as { off?: boolean }).off) pipOn = false; return { ok: false, why: 'setup' }; }
    return { ok: false, why: 'error' };
  } catch {
    return { ok: false, why: navigator.onLine === false ? 'offline' : 'error' };
  }
}

/** Only the actions the app knows, in the shape it expects (the server checked them; this is a second look). */
function actionsOf(v: unknown): TutorAction[] {
  if (!Array.isArray(v)) return [];
  const out: TutorAction[] = [];
  for (const a of v.slice(0, 2)) {
    const x = a as Record<string, unknown>;
    if (x?.act === 'highlight' && typeof x.choice === 'string' && /^[A-F]$/.test(x.choice)) out.push({ act: 'highlight', choice: x.choice });
    else if (x?.act === 'hint' || x?.act === 'review' || x?.act === 'similar') out.push({ act: x.act });
  }
  return out;
}

/** "Does that make sense?" answered: about the pack's explanation or about the tutor's reply. Fire and forget: a lost one
    only means one signal fewer. Signed-out visitors send nothing. */
export function tutorFeedback(item: string, about: 'exp' | 'pip', sense: boolean, ask?: number | null): void {
  const who = answerWho();
  if (!who || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
  const url = '/api/me/tutor/feedback/' + (who.child ? `?child=${encodeURIComponent(who.child)}` : '');
  void fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item, about, sense, ...(ask ? { ask } : {}) }) }).catch(() => { /* offline or busy: skipped */ });
}
