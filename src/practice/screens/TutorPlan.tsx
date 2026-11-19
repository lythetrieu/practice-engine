// "Your plan" on Home: what the tutor suggests next, in order. Set a goal, find a starting point
// (placement check), close the gaps checks found, then the skills due for review. Every row is one tap to play.
import { useApp } from '../ctx';
import { SUBJECT_NAME, SUBJECTS, LESSONS, type Subject } from '../curriculum';
import { today, last7, practicedOn, dueMistakes, resumable, REVIEW_ROUND, type Progress } from '../store';
import { stopItems } from '../levels/index';
import { dueSkills, openPlan, type PlanItem } from '../tutor/model';
import { PLACEMENT_LEN, placementId, practicePlan, PRACTICE_ID } from '../tutor/pick';
import { dayLabel } from './TutorResult';
import './TutorPlan.css';

interface Row { href: string; title: string; sub: string; tone: 'goal' | 'place' | 'gap' | 'due'; go: string }

const REASON: Record<PlanItem['why'], string> = {
  gap: 'Found in a unit check',
  placement: 'Your starting point',
  revisit: 'Your skill check said to try it again',
};


const ICON: Record<Row['tone'], string> = {
  goal: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10zM12 11a1 1 0 1 0 0 2a1 1 0 1 0 0-2z',
  place: 'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11zM12 7.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5z',
  gap: 'M4 17l5-5 4 4 7-8M14 8h6v6',
  due: 'M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4M12 8v4l3 2',
};

/** What Home suggests, in order, at most 3: a review left half-done, the goal, a starting point, plan gaps, missed
    questions to redo, skills due for review. */
export function planRows(p: Progress): { rows: Row[]; upcoming: string | undefined } {
  const t = p.tutor, day = today();
  const rows: Row[] = [];
  const ip = resumable(p);
  if (ip && ip.kind === 'review') rows.push({ href: '#play/review', title: 'Finish your review', sub: `Question ${ip.answers.length + 1} of ${ip.qids.length} · answers saved`, tone: 'due', go: 'Resume' });
  const has = (s: Subject) => Object.values(LESSONS).some((l) => l.subject === s && stopItems(l.id).length > 0);
  if (!t.goal) rows.push({ href: '#start', title: 'Make your plan', sub: 'Your test day and goal · 1 minute', tone: 'goal', go: 'Start' });
  const first: Subject = t.goal?.first && SUBJECTS.includes(t.goal.first) ? t.goal.first : SUBJECTS[0];
  for (const s of [first, ...SUBJECTS.filter((x) => x !== first)]) {
    if (!t.placement[s] && has(s) && rows.length < 2) {
      rows.push({ href: `#play/${placementId(s)}`, title: `Find your ${SUBJECT_NAME[s]} starting point`, sub: `Placement check · up to ${PLACEMENT_LEN[s]} questions`, tone: 'place', go: 'Start' });
      break;
    }
  }
  for (const x of openPlan(t).slice(-2)) {
    if (!LESSONS[x.stop]) continue;
    rows.push({ href: `#play/${x.stop}`, title: LESSONS[x.stop].title, sub: x.from && LESSONS[x.from] ? `${REASON[x.why]} · Helps with ${LESSONS[x.from].title}` : REASON[x.why], tone: 'gap', go: 'Practice' });
  }
  const missed = dueMistakes(p, day).length;
  if (missed && !(ip && ip.kind === 'review')) {
    const n = Math.min(missed, REVIEW_ROUND);
    rows.push({ href: '#play/review', title: `Redo ${n} ${n === 1 ? 'mistake' : 'mistakes'}`, sub: missed > n ? `A short round · ${missed - n} more next time` : 'Try the questions you missed again', tone: 'due', go: 'Redo' });
  }
  const due = dueSkills(t, day).filter((s) => LESSONS[s]);
  if (due.length) {
    const n = practicePlan(t, day).length;
    rows.push({ href: `#play/${PRACTICE_ID}`, title: `Review ${due.length} ${due.length === 1 ? 'skill' : 'skills'}`, sub: `Due now · ${n * 2} mixed questions`, tone: 'due', go: 'Review' });
  }
  const upcoming = Object.values(t.skills).map((r) => r.due).filter((d): d is string => !!d && d > day).sort()[0];
  return { rows: rows.slice(0, 3), upcoming };
}

export function TutorPlan({ delay = 0 }: { delay?: number }) {
  const { p } = useApp();
  const t = p.tutor, day = today();
  const { rows, upcoming } = planRows(p);
  if (!rows.length && !upcoming) return null;
  const goal = t.goal;
  const done = last7(day).filter((d) => practicedOn(p, d)).length;
  return (
    <section className="hm-sec tp fx-fadeup" aria-labelledby="home-plan" style={{ animationDelay: delay + 'ms' }}>
      <div className="hm-head">
        <h2 id="home-plan" className="hm-h2">Your plan</h2>
        {goal ? <p className="hm-note">Last 7 days: {Math.min(done, goal.days)} of {goal.days} days</p> : null}
      </div>
      {rows.length ? (
        <ol className="tp-list">
          {rows.map((r) => (
            <li key={r.href + r.title}>
              <a href={r.href} className={'tp-row press tp-' + r.tone}>
                <span className="tp-ic" aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d={ICON[r.tone]} /></svg>
                </span>
                <span className="tp-text"><b>{r.title}</b><span>{r.sub}</span></span>
                <span className="tp-go" aria-hidden="true">{r.go}</span>
              </a>
            </li>
          ))}
        </ol>
      ) : <p className="tp-calm">Nothing due today. Next review: <b>{dayLabel(upcoming!)}</b>.</p>}
    </section>
  );
}
