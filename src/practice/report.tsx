// "Report a problem": with a question (from the lesson feedback) or with the app itself (from Me >
// Settings). A reason from a fixed list, no free text (this avoids collecting personal data from children). Sent through the
// shared client helper, which adds the anonymous browser ID, runs the bot check when the
// server asks for it, and keeps the report for later when the phone is offline. Reports land in the
// admin at /admin/reports/.
import { useState } from 'react';
import { useApp } from './ctx';
import { Sheet } from './ui';
import { recentContext, likelyScreen } from './errors';
import { noteNetFail } from './offline';
import { send as sendReport } from '../lib/client/outbox';

export const APP_VERSION = '1.0.0';

const QUESTION_REASONS: [string, string][] = [
  ['wrong_key', 'The answer key is wrong'],
  ['unclear', 'The question is unclear or has two right answers'],
  ['explanation', 'The explanation is wrong or confusing'],
  ['typo', 'A typo or formatting problem'],
  ['display', 'Something does not show or work right'],
  ['other', 'Something else'],
];
const ISSUE_REASONS: [string, string][] = [
  ['broken', 'A button or link does not work'],
  ['looks_wrong', 'Something looks wrong or is cut off'],
  ['slow', 'It is slow or freezes'],
  ['sound', 'Sound or animation problem'],
  ['progress', 'My progress or rewards are wrong'],
  ['other', 'Something else'],
];
const SCREENS: [string, string][] = [
  ['home', 'Home'], ['learn', 'Learn map'], ['lesson', 'A lesson'], ['complete', 'Lesson complete'],
  ['review', 'Review'], ['test', 'Full test'], ['me', 'Me and badges'], ['other', 'Somewhere else'],
];


export function device() {
  const w = Math.min(screen.width || innerWidth, screen.height || innerHeight);
  const coarse = matchMedia('(pointer: coarse)').matches;
  return !coarse ? 'computer' : w < 600 ? 'phone' : 'tablet';
}

// What the lesson knows when a question is reported: sent with the report so editors see where the
// student was and what they had picked, even though the student only chooses a reason.
export interface QuestionContext { lesson: string; pos: number; total: number; picked: number | null; checked: boolean; correct: boolean | null }

// kind 'question' needs qid; from a question the student can switch to an app problem instead.
interface Props { kind: 'question' | 'issue'; qid?: string; rev?: number; ctx?: QuestionContext; screen?: string; onClose: () => void }

export function ReportSheet(props: Props) {
  const { sfx } = useApp();
  const [mode, setMode] = useState<'question' | 'issue'>(props.kind === 'question' && props.qid ? 'question' : 'issue');
  const issue = mode === 'issue';
  const [reason, setReason] = useState<string | null>(null);
  const [where, setWhere] = useState<string>(props.screen || (props.kind === 'question' ? 'lesson' : likelyScreen()));
  const [state, setState] = useState<{ busy: boolean; msg: string; done: boolean }>({ busy: false, msg: '', done: false });

  const send = async () => {
    if (!reason) { setState({ busy: false, msg: issue ? 'Choose what went wrong.' : 'Choose what is wrong.', done: false }); return; }
    sfx('tap');
    setState({ busy: true, msg: 'Sending…', done: false });
    const env = { device: device(), w: innerWidth, h: innerHeight, ver: APP_VERSION };
    const body: Record<string, unknown> = issue
      ? { context: 'issue', reason, meta: { screen: where, ...env, ...recentContext(), ...(props.ctx ? { lesson: props.ctx.lesson, pos: props.ctx.pos } : {}) } }
      : { context: 'app', item: props.qid, ...(props.rev ? { rev: props.rev } : {}), reason, meta: { ...env, ...(props.ctx || {}) } };
    let r: { ok?: boolean; queued?: boolean; error?: string };
    try { r = await sendReport('/api/report/', body); } catch (e) { r = { ok: false }; }
    if (r.queued && r.error === 'offline') noteNetFail();   // no answer: the offline banner may be due (offline.ts)
    if (r.ok || r.queued) {
      setState({ busy: false, done: true, msg: r.ok ? (issue ? 'Thank you! We will look into it.' : 'Thank you! Our editors will check this question.') : 'Saved. It will be sent the next time you are online.' });
      window.setTimeout(props.onClose, 1800);
    } else {
      setState({ busy: false, done: false, msg: r.error || 'Could not send the report. Please try again.' });
    }
  };

  const reasons = issue ? ISSUE_REASONS : QUESTION_REASONS;
  const title = issue ? 'Report an app problem' : 'Report a problem with this question';
  return (
    <Sheet label={title} onClose={props.onClose} className="pa-report">
      <h2 className="pa-sheet-title">{title}</h2>
      <fieldset className="pa-rp-set">
        <legend>{issue ? 'What went wrong?' : 'What is wrong?'}</legend>
        {reasons.map(([v, label]) => (
          <label key={v} className={'pa-rp-opt' + (reason === v ? ' on' : '')}>
            <input type="radio" name="pa-rp-reason" value={v} checked={reason === v} onChange={() => { setReason(v); sfx('tap'); }} disabled={state.done} />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>
      {issue ? (
        <label className="pa-rp-where">
          <span>Where did it happen?</span>
          <select value={where} onChange={(e) => setWhere(e.target.value)} disabled={state.done}>
            {SCREENS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
        </label>
      ) : null}
      <p className="pa-rp-fine">
        {issue
          ? 'We also send the screens you just opened, your device type (phone, tablet or computer), screen size and app version: no name.'
          : 'We also send which question it was, the answer you picked, your device type and screen size: no name.'}
      </p>
      {!issue && !state.done ? (
        <button type="button" className="pa-linkbtn pa-rp-switch" onClick={() => { sfx('tap'); setMode('issue'); setReason(null); setState({ busy: false, msg: '', done: false }); }}>
          Is it a problem with the app, not this question?
        </button>
      ) : null}
      <p className={'pa-rp-msg' + (state.done ? ' ok' : '')} role="status">{state.msg}</p>
      <button type="button" className="pa-btn green press" onClick={send} disabled={state.busy || state.done}>
        {state.done ? 'Sent' : 'Send report'}
      </button>
    </Sheet>
  );
}

export const FLAG = 'M5 21V4M5 4h11l-2 4 2 4H5';

// The flag button that opens the question report. With `label` it shows the word next to the flag.
export function FlagButton({ onClick, className, label }: { onClick: () => void; className?: string; label?: string }) {
  return (
    <button type="button" className={'pa-flag ' + (label ? 'with-label ' : '') + (className || '')} onClick={onClick}
      aria-label={label ? undefined : 'Report a problem with this question'}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={FLAG} />
      </svg>
      {label ? <span>{label}<span className="sr"> a problem with this question</span></span> : null}
    </button>
  );
}
