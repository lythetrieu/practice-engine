// The optional AI tutor (docs/pip.md), under an explanation: "Does that make sense?", and the mascot as tutor when it
// does not. Yes closes it. Not yet offers buttons only (no free text, COPPA): why my answer was wrong, another way, a
// simpler example. Each tap asks the AI tutor (aitutor.ts; at most 2 asks per question here, 30 a day on the server).
// The tutor's name and face are the pack's mascot (Mascot.tsx). This screen is rendered only while the tutor is on.
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../ctx';
import { askTutor, tutorFeedback, type TutorAction, type TutorCtx, type TutorKind, type TutorStep } from '../aitutor';
import { MascotFace, mascotName } from '../Mascot';
import './TutorAsk.css';

const ASK_MAX = 2;
const LABEL: Record<TutorKind, string> = {
  why_wrong: 'Why was my answer wrong?',
  why_right: 'Why is that the answer?',
  another_way: 'Explain it another way',
  simpler: 'Show me a simpler example',
  hint: 'Give me a hint',
};
const FAIL = {
  setup: `${mascotName} can’t answer right now. The explanation above is still there to read.`,
  limit: `That’s all of ${mascotName}’s answers for today. Try again tomorrow.`,
  signin: `Sign in as a student to ask ${mascotName}.`,
  offline: `You’re offline. ${mascotName} can answer when you’re back online.`,
  error: `${mascotName} couldn’t answer that one. Try again in a moment.`,
} as const;

/** Before Check: one hint from the tutor that never gives the answer away (the server checks it). One per question. */
export function PipHint({ item, step, ctx, onAction, similarOk = false }: { item: string; step: TutorStep; ctx?: TutorCtx; onAction?: (a: TutorAction) => void; similarOk?: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const [acts, setActs] = useState<TutorAction[]>([]);
  const [fail, setFail] = useState<keyof typeof FAIL | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    void askTutor(item, 'hint', step, undefined, ctx).then((r) => {
      if (!live) return;
      if (!r.ok) { setFail(r.why); return; }
      setText(r.text); setActs(r.actions);
      for (const a of r.actions) if (a.act !== 'similar') onAction?.(a);   // e.g. open the next hint rung
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [text, fail]);
  return (
    <div className="ta ta-hint" ref={endRef} aria-live="polite">
      <div className="ta-reply fx-fadeup">
        <span className="ta-face"><MascotFace size={34} /></span>
        {text ? (
          <div className="ta-bubble"><p className="ta-ask">{mascotName}’s hint</p>{text.split(/\n+/).map((l, j) => <p key={j}>{l}</p>)}<Similar acts={acts} onAction={onAction} ok={similarOk} /></div>
        ) : fail ? (
          <div className="ta-bubble"><p>{FAIL[fail]}</p></div>
        ) : (
          <div className="ta-bubble ta-wait" role="status"><span className="sr">{mascotName} is thinking</span><i /><i /><i /></div>
        )}
      </div>
    </div>
  );
}

/** `askN` goes up each time the sheet's "Ask <name>" button is tapped: the menu opens (and comes into view).
    `similarOk`: the app has a question of the same lesson to add ("Try one like it"). */
export function TutorAsk({ item, step, right, explanation, askN = 0, ctx, onAction, similarOk = false }: {
  item: string; step: TutorStep | null; right: boolean; explanation: string; askN?: number; ctx?: TutorCtx; onAction?: (a: TutorAction) => void; similarOk?: boolean;
}) {
  const { sfx } = useApp();
  const [phase, setPhase] = useState<'ask' | 'menu' | 'yes'>('ask');
  const [replies, setReplies] = useState<{ kind: TutorKind; text: string; acts: TutorAction[]; ask: number | null }[]>([]);
  const [busy, setBusy] = useState<TutorKind | null>(null);
  const [fail, setFail] = useState<keyof typeof FAIL | null>(null);
  const used = new Set(replies.map((r) => r.kind));
  const kinds = (right ? (['another_way', 'simpler'] as TutorKind[]) : (['why_wrong', 'another_way', 'simpler'] as TutorKind[])).filter((k) => !used.has(k));
  const canAsk = !!step && replies.length < ASK_MAX && !fail;
  useEffect(() => { if (askN) setPhase('menu'); }, [askN]);
  // the sheet scrolls: bring what just appeared (the menu, the tutor thinking, its answer) into view
  const endRef = useRef<HTMLSpanElement>(null);
  // a new reply is read from its first line: bring its top into view, not the end of the sheet (a long reply
  // lost its first line otherwise); anything else (the menu, the tutor thinking) brings the end into view
  const lastReplyRef = useRef<HTMLDivElement>(null);
  const shownReplies = useRef(0);
  useEffect(() => {
    if (phase === 'ask' && !replies.length && !busy && !fail && !askN) return;
    if (replies.length > shownReplies.current && lastReplyRef.current) lastReplyRef.current.scrollIntoView({ block: 'start', behavior: 'smooth' });
    else endRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    shownReplies.current = replies.length;
  }, [phase, replies.length, busy, fail]);

  // the answer to "Does that make sense?" is a signal (docs/pip.md): about the explanation, or the tutor's last reply
  const feedback = (sense: boolean) => {
    const last = replies[replies.length - 1];
    tutorFeedback(item, last ? 'pip' : 'exp', sense, last?.ask);
  };
  const ask = async (kind: TutorKind) => {
    if (!step || busy) return;
    sfx('tap');
    setBusy(kind);
    const prior = replies.length ? replies[replies.length - 1].text : explanation;
    const r = await askTutor(item, kind, step, kind === 'another_way' ? prior : undefined, ctx);
    setBusy(null);
    if (r.ok) {
      setReplies((x) => [...x, { kind, text: r.text, acts: r.actions, ask: r.ask }]);
      setPhase('ask');
      for (const a of r.actions) if (a.act !== 'similar') onAction?.(a);   // highlight a choice, add the skill to the plan
    } else setFail(r.why);
  };

  return (
    <div className="ta" aria-live="polite">
      {replies.map((r, k) => (
        <div key={k} className="ta-reply fx-fadeup" ref={k === replies.length - 1 ? lastReplyRef : undefined}>
          <span className="ta-face"><MascotFace size={34} /></span>
          <div className="ta-bubble">
            <p className="ta-ask">{LABEL[r.kind]}</p>
            {r.text.split(/\n+/).map((line, j) => <p key={j}>{line}</p>)}
            {r.acts.some((a) => a.act === 'review') ? <p className="ta-did">Added to your plan for another look soon.</p> : null}
            <Similar acts={r.acts} onAction={onAction} ok={similarOk} />
          </div>
        </div>
      ))}

      {busy ? (
        <div className="ta-reply">
          <span className="ta-face"><MascotFace size={34} /></span>
          <div className="ta-bubble ta-wait" role="status"><span className="sr">{mascotName} is thinking</span><i /><i /><i /></div>
        </div>
      ) : null}

      {fail ? <p className="ta-note">{FAIL[fail]}</p> : null}

      {!busy && phase === 'ask' ? (
        <div className="ta-row" role="group" aria-label="Does that make sense?">
          <span className="ta-q">Does that make sense?</span>
          <button type="button" className="ta-btn press" onClick={() => { sfx('tap'); feedback(true); setPhase('yes'); }}>Yes</button>
          <button type="button" className="ta-btn press" onClick={() => { sfx('tap'); feedback(false); setPhase('menu'); }}>Not yet</button>
        </div>
      ) : null}
      {phase === 'yes' ? <p className="ta-note ta-good">Nice. On to the next one.</p> : null}

      {!busy && phase === 'menu' ? (
        canAsk && kinds.length ? (
          <div className="ta-menu fx-fadeup" role="group" aria-label={`Ask ${mascotName}, the tutor`}>
            <p className="ta-who"><span className="ta-face sm"><MascotFace size={24} /></span>Ask {mascotName}, your tutor</p>
            {kinds.map((k) => (
              <button key={k} type="button" className="ta-opt press" onClick={() => ask(k)}>{LABEL[k]}</button>
            ))}
          </div>
        ) : (
          <p className="ta-note">{right ? 'Keep it in mind: a question like it comes back in a review soon.' : 'It’s saved to Review, so you can try it again later.'}</p>
        )
      ) : null}
      <span ref={endRef} />
    </div>
  );
}

/** "Try one like it": a question of the same lesson (the round adds it next). Shown once, then it says so. */
function Similar({ acts, onAction, ok }: { acts: TutorAction[]; onAction?: (a: TutorAction) => void; ok: boolean }) {
  const { sfx } = useApp();
  const [done, setDone] = useState(false);
  const a = acts.find((x) => x.act === 'similar');
  if (!a || !onAction || !ok) return null;
  return done
    ? <p className="ta-did">It’s next, right after this one.</p>
    : <button type="button" className="ta-opt ta-similar press" onClick={() => { sfx('tap'); onAction(a); setDone(true); }}>Try one like it</button>;
}
