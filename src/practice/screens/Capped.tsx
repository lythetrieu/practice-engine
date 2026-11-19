// Shown in place of a lesson when the free plan's daily new-lesson limit is reached (limits.ts). A child never sees a
// buy button or a price here: on their own login they can ask a parent (AskParent.tsx). A parent practicing as a
// child on their own device gets one plain line about the plan and a link to the account page.
import './Capped.css';
import type { Cap } from '../limits';
import { useApp } from '../ctx';
import { parseDay } from '../store';
import { config } from '../../pack';
import AskParent from '../AskParent';

export default function Capped({ cap }: { cap: Cap }) {
  const { me, p } = useApp();
  if (cap.kind !== 'lesson') return null;
  const missed = p.mistakes.length > 0;   // "Review mistakes" only when there are some
  const day = parseDay(cap.resetsOn).toLocaleDateString('en-US', { weekday: 'long' });
  const plan = config.plan?.name ?? 'Pro';
  return (
    <div className="pa-body cap-main" role="region" aria-labelledby="cap-title">
      <h1 id="cap-title">That’s today’s {cap.perDay === 1 ? 'new lesson' : `${cap.perDay} new lessons`}</h1>
      <p>New lessons open again on {day}. Until then you can {missed ? 'review your mistakes and ' : ''}replay any lesson you’ve finished.</p>
      <p className="cap-actions">
        {missed ? <a className="pa-btn green" href="#review">Review mistakes</a> : null}
        <a className={'pa-btn ' + (missed ? 'ghost' : 'green')} href="#learn">Back to the map</a>
      </p>
      <div className="cap-ask"><AskParent kind="lessons" /></div>
      {me.role === 'parent' ? <p className="cap-parent">For parents: {plan} removes the daily limit. <a href="/account/#plan">See {plan} on your account page</a></p> : null}
    </div>
  );
}
