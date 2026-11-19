import type { APIRoute } from 'astro';
import { bindings, type D1Database } from '../../../lib/server/env';
import { HttpError, json, readBody, allowedOrigin, rateLimit } from '../../../lib/server/http';
import { underDailyCap } from '../../../lib/server/caps';
import { currentUser } from '../../../lib/server/auth';
import { childOf } from '../../../lib/server/account';
import { currentStudent } from '../../../lib/server/student';
import { KINDS, DAILY_LIMIT, DAILY_ROWS, DEFAULT_MODEL, ITEM_RE, CAPS, type Kind, type Action, askModel, clean, cleanCtx, dayOf, logAsk, messages, mockOn, mockReply, parseReply, pipOn, studentNotes, stepFromClient, usedToday, hintLeaks, HINT_FALLBACK } from '../../../lib/server/aitutor';

export const prerender = false;

// The optional AI tutor (see src/lib/server/aitutor.ts and docs/pip.md). A signed-in child (or a parent for one of their
// children, ?child=<id>) taps a button after a question; the model's short reply comes back as plain text. No free text.
// Body: { item, kind: 'why_wrong' | 'why_right' | 'another_way' | 'simpler' | 'hint' (before Check: never the answer),
// step: { stem, opts?, answer, chosen?, exp?, note?, passage? }, prior?, ctx? } (ctx: lesson id, weakest lessons, slips,
// tries, hints, grade; every field is checked against the pack and a bad one is dropped).
// Answers { ok: true, text, actions, ask, left } (actions: highlight / hint / similar / review; ask = ai_tutor_log id)
// or { ok: false, error, ... }: 401 sign in, 429 { limit: 30 }, 503 { off: true } (the tutor is off) or { setup: false }.
const MAX_BODY = 24 * 1024;

/** Who is asking: a signed-in child, or a parent for one of their children. In `astro dev` with AI_TUTOR_MOCK=1 a signed-out
    browser may ask too (the canned reply, nothing logged), so a pack author can try the buttons without making an account. */
async function whose(D: D1Database, request: Request, want: string | null): Promise<{ learner: string | null }> {
  const student = await currentStudent(request);
  if (student && (!want || student.child_id === want)) return { learner: student.learner };
  const user = await currentUser(request);
  if (!user) {
    if (mockOn(bindings)) return { learner: null };
    throw new HttpError(401, 'Please sign in again.');
  }
  if (!want && mockOn(bindings)) return { learner: null };   // a parent just looking around, with the dev mock on
  return { learner: (await childOf(D, user.id, want)).learner };
}

export const POST: APIRoute = async ({ request, url }) => {
  try {
    if (!allowedOrigin(request.headers.get('origin'), url)) throw new HttpError(403, 'Not allowed.');
    await rateLimit(bindings.API_RL, request);
    // The switch (env PIP_ENABLED=1 and OPENROUTER_API_KEY; default off): off answers 503 { off: true } and the app hides the AI buttons.
    if (!pipOn(bindings)) throw new HttpError(503, 'The tutor is not on.', { off: true });
    const D = bindings.DB;
    if (!D) throw new HttpError(503, 'We could not reach our database. Please try again later.');
    const who = await whose(D, request, url.searchParams.get('child'));
    const body = await readBody(request, MAX_BODY);

    const item = typeof body.item === 'string' ? body.item : '';
    if (!ITEM_RE.test(item)) throw new HttpError(400, 'That question could not be read.');
    const kind = body.kind as Kind;
    if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) throw new HttpError(400, 'That request could not be read.');
    const raw = body.step;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, 'That question could not be read.');
    const step = stepFromClient(raw as Record<string, unknown>);
    if (!step.stem || !step.answer) throw new HttpError(400, 'That question could not be read.');
    const prior = clean(body.prior, CAPS.prior);
    const ctx = cleanCtx(body.ctx);

    const day = dayOf();
    let used = { ok: 0, rows: 0 };
    if (who.learner) {
      used = await usedToday(D, who.learner, day);
      if (used.ok >= DAILY_LIMIT || used.rows >= DAILY_ROWS) throw new HttpError(429, 'You have used all of your tutor questions for today. Come back tomorrow!', { limit: DAILY_LIMIT, left: 0 });
    }
    // A ceiling for the whole site (env PIP_DAILY_CAP, default 3000 asks a day), on top of 30 per learner: the cost cap.
    const siteCap = Number(bindings.PIP_DAILY_CAP);
    if (!(await underDailyCap(D, 'pip_asks', Number.isInteger(siteCap) && siteCap > 0 ? siteCap : 3000, new Date().toISOString()))) {
      throw new HttpError(429, 'The tutor is resting for today. Try again tomorrow!', { limit: DAILY_LIMIT, left: 0, site: true });
    }

    const env = bindings;
    let text: string, actions: Action[], model: string, ms: number | null = null, tin: number | null = null, tout: number | null = null;
    const student = studentNotes(ctx);
    if (!env.OPENROUTER_API_KEY || /^replace-with/i.test(env.OPENROUTER_API_KEY.trim())) {
      // pipOn() let us in without a key, so this is the mock (AI_TUTOR_MOCK=1, `astro dev` only)
      ({ text, actions } = parseReply(mockReply(kind, step), kind, step)); model = 'mock';
    } else {
      try {
        const r = await askModel(env, url.origin, messages(kind, step, prior, { student }), kind, step);
        ({ text, actions, model, ms, tokensIn: tin, tokensOut: tout } = r);
      } catch (e) {
        const x = e as { ms?: number; model?: string };
        if (who.learner) await logAsk(D, { learner: who.learner, day, item, kind, model: x.model ?? env.OPENROUTER_MODEL ?? DEFAULT_MODEL, ok: false, ms: x.ms ?? null, tin: null, tout: null, reply: null }).catch(() => {});
        throw e;
      }
    }
    if (kind === 'hint' && hintLeaks(text, step)) text = HINT_FALLBACK;   // a hint before Check never gives the answer away
    const ask = who.learner ? await logAsk(D, { learner: who.learner, day, item, kind, model, ok: true, ms, tin, tout, reply: text }) : null;
    return json({ ok: true, text, actions, ask, left: Math.max(0, DAILY_LIMIT - used.ok - 1) });
  } catch (e) {
    if (e instanceof HttpError) return json({ ok: false, error: e.message, ...e.extra }, e.status);
    console.error('tutor', e instanceof Error ? e.message : 'failed');
    return json({ ok: false, error: 'Something went wrong on our side. Please try again.' }, 500);
  }
};
