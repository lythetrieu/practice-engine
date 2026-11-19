// Goal onboarding (#start): ask only what the app does not know.
// Who is using the app is already known before this screen: the sign-in page asks "Parent or Student", and a parent
// then picks a child or "I'm the parent, just looking" (Who.tsx). A student, or a child a parent picked, gets the test
// day (skipped when known), a short "how it works", then the placement check (any section of the pack) or the map. A parent just
// looking sets the test day and days a week, then Home. Choices only (no free text). Opens once on a new device
// (Home), and any time from Me ("Set up your plan").
import { useState, type ReactNode } from 'react';
import { useApp } from '../ctx';
import { testDaysFor, TEST_DAYS, gradeOf, today } from '../store';
import { stopItems } from '../levels/index';
import { LESSONS, SUBJECTS, SUBJECT_NAME, type Subject } from '../curriculum';
import { config } from '../../pack';
import { placementId } from '../tutor/pick';
import type { Goal } from '../tutor/model';
import './Start.css';

import { markStartSeen } from '../startSeen';
export { START_SEEN, markStartSeen, startSeen } from '../startSeen';

type Step = 'test' | 'how' | 'parent';

function Choice({ on, onClick, title, sub }: { on: boolean; onClick: () => void; title: string; sub?: string }) {
  return (
    <button type="button" role="radio" aria-checked={on} className={'st-choice press' + (on ? ' on' : '')} onClick={onClick}>
      <span className="st-choice-t">{title}</span>{sub ? <span className="st-choice-s">{sub}</span> : null}
    </button>
  );
}

/** "How it works": three short cards that come in one after another (our own drawing and words). */
function How() {
  const cards: { icon: string; t: string; s: string }[] = [
    { icon: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10zM12 11a1 1 0 1 0 0 2a1 1 0 1 0 0-2z', t: 'A few quick questions', s: 'They find your starting point. No grade, no pressure.' },
    { icon: 'M5 19c3-6 5-8 7-8s4 2 7-6M5 19h.01M19 5h.01', t: 'Your plan', s: 'It changes as you practice: gaps first, then new skills.' },
    { icon: 'M5 12.5l4.5 4.5L19 7.5', t: 'Quick checks', s: 'A few questions after a lesson, and reviews a few days later, so it sticks.' },
  ];
  return (
    <ol className="st-how">
      {cards.map((c, i) => (
        <li key={c.t} className="st-how-card fx-fadeup" style={{ animationDelay: `${150 + i * 260}ms` }}>
          <span className="st-how-ic" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d={c.icon} /></svg>
          </span>
          <span><b>{c.t}</b><span>{c.s}</span></span>
        </li>
      ))}
    </ol>
  );
}

export default function Start() {
  const { p, me, update, go, sfx } = useApp();
  const parent = me.role === 'parent';
  const grade = gradeOf(p, me.grade);
  const needTest = TEST_DAYS.length > 0 && !p.testDate && !p.nextFall;
  const studentSteps: Step[] = [...(needTest ? ['test' as const] : []), 'how'];
  const [list] = useState<Step[]>(parent && !me.as ? ['parent'] : studentSteps);
  const [i, setI] = useState(0);
  const [days, setDays] = useState<3 | 5 | 7>(p.tutor.goal?.days ?? 5);
  const at = list[Math.min(i, list.length - 1)];
  const has = (s: Subject) => Object.values(LESSONS).some((l) => l.subject === s && stopItems(l.id).length > 0);

  const finish = (first: Subject, href: string) => {
    sfx('tap');
    const goal: Goal = { why: 'test', days, minutes: p.tutor.goal?.minutes ?? 20, first, by: at === 'parent' ? 'parent' : 'student', at: today() };
    update((q) => ({ ...q, tutor: { ...q.tutor, goal } }));
    markStartSeen();
    go(href);
  };
  const next = () => { sfx('tap'); setI((n) => Math.min(n + 1, list.length - 1)); };
  const back = () => { sfx('tap'); if (i === 0) { markStartSeen(); go('#home'); } else setI((n) => n - 1); };

  const testDays = testDaysFor(grade);
  const testPicker = (
    <div className="st-choices" role="radiogroup" aria-label="Test day">
      {testDays.map((d) => <Choice key={d.day} on={p.testDate === d.day} title={d.label} sub={d.who} onClick={() => { sfx('tap'); update((q) => ({ ...q, testDate: d.day, nextFall: false })); }} />)}
      <Choice on={!p.testDate} title="Not sure yet" onClick={() => { sfx('tap'); update((q) => ({ ...q, testDate: null })); }} />
    </div>
  );

  let body: ReactNode = null, cta: ReactNode = null;
  if (at === 'parent') {
    body = (
      <>
        <h1 className="st-h">Your child&apos;s plan</h1>
        {testDays.length ? <><p className="st-label">Test day</p>{testPicker}</> : null}
        <p className="st-label">Days a week</p>
        <div className="st-row" role="radiogroup" aria-label="Days a week">
          {([3, 5, 7] as const).map((d) => <Choice key={d} on={days === d} title={String(d)} sub="days" onClick={() => { sfx('tap'); setDays(d); }} />)}
        </div>
        <p className="st-sub">Short sessions on most days work better than one long one. Your parent report shows days active and skills to work on.</p>
      </>
    );
    cta = <button type="button" className="ls-cta press" onClick={() => finish(SUBJECTS[0], '#home')}>Done</button>;
  } else if (at === 'test') {
    body = (
      <>
        <h1 className="st-h">When is your test?</h1>
        <p className="st-sub">Pick your {config.exam} day. You can change it later in Settings.</p>
        {testDays.length ? testPicker : null}
      </>
    );
    cta = <button type="button" className="ls-cta press" onClick={next}>Continue</button>;
  } else {
    body = (
      <>
        <h1 className="st-h">Here&apos;s how it works</h1>
        <How />
        <h2 className="st-h2">Find your starting point</h2>
        <div className="st-choices">
          {SUBJECTS.filter(has).map((s, k) => (
            <button key={s} type="button" className={'st-choice press' + (k === 0 ? ' st-go' : '')} onClick={() => finish(s, `#play/${placementId(s)}`)}><span className="st-choice-t">Start with {SUBJECT_NAME[s]}</span><span className="st-choice-s">A few quick questions</span></button>
          ))}
        </div>
        <button type="button" className="st-skip" onClick={() => finish(SUBJECTS[0], '#learn')}>Skip for now and start at World 1</button>
      </>
    );
  }

  return (
    <div className="pa-body st">
      <header className="st-top">
        <button type="button" className="ls-icon-btn" aria-label={i === 0 ? 'Close' : 'Back'} onClick={back}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {i === 0 ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M15 6l-6 6 6 6" />}
          </svg>
        </button>
        {list.length > 1 ? (
          <div className="st-segs" role="progressbar" aria-label="Setup" aria-valuemin={1} aria-valuemax={list.length} aria-valuenow={i + 1}>
            {list.map((s, k) => <span key={s} className={'st-seg' + (k <= i ? ' on' : '')} />)}
          </div>
        ) : <span className="st-segs" />}
      </header>
      <div className="st-body fx-fadeup" key={at}>{body}</div>
      {cta ? <footer className="st-foot">{cta}</footer> : null}
    </div>
  );
}
