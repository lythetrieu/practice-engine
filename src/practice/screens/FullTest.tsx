// Full test tab: the pack's practice test (pack.yaml `fullTest`) before it starts. The numbers (questions, minutes,
// sections), the rules and the time options all come from the pack. Before a test: which section first (when the pack
// lets the student choose) and the time option. A test left part-way shows Resume (exam/save.ts); finished tests are
// listed with their score estimate (exam/results.ts) and open again at #exam/result/<id>.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import './FullTest.css';
import { useApp } from '../ctx';
import { config, sectionName, sectionShort } from '../../pack';
import { loadAppBank } from '../appBank';
import { rawBank } from '../levels/index';
import { buildExam, examSize } from '../exam/build';
import { readSave, writeSave, clearSave, clock } from '../exam/save';
import { headlineOfTest, seenIn } from '../exam/results';
import { dayLabelShort } from '../ui';
import { testCap } from '../limits';
import AskParent from '../AskParent';
import './Capped.css';

const T = config.fullTest;
const RULE_ICONS = [
  'M5 12h14M13 6l6 6-6 6',
  'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  'M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2zM8 11V7a4 4 0 0 1 8 0v4',
  'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4zM14 6l3 3',
];

/** A radio group of cards (arrow keys move the choice, like native radios). */
function Choice<T extends string>({ legend, id, options, value, onPick }: { legend: string; id: string; options: { id: T; title: string; sub?: string }[]; value: T; onPick: (v: T) => void }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = options[(i + d + options.length) % options.length];
    onPick(next.id);
    refs.current[next.id]?.focus();
  };
  return (
    <fieldset className="ft-pick" role="radiogroup" aria-labelledby={id}>
      <legend id={id}>{legend}</legend>
      <div className={'ft-opts' + (options.length > 2 ? ' ft-times' : '')}>
        {options.map((o, i) => {
          const on = value === o.id;
          return (
            <button key={o.id} ref={(el) => { refs.current[o.id] = el; }} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1}
              className={'ft-opt press' + (on ? ' on' : '')} onClick={() => onPick(o.id)} onKeyDown={(e) => onKey(e, i)}>
              <span className="ft-opt-title"><span className="ft-radio" aria-hidden="true"><span /></span>{o.title}</span>
              {o.sub ? <span className="ft-opt-sub">{o.sub}</span> : null}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export default function FullTest() {
  const { p, sfx, go, me } = useApp();
  const parentLooking = me.role === 'parent' && !me.as;
  const [first, setFirst] = useState(T.sections[0].section);
  const [mode, setMode] = useState(T.timeOptions[0].id);
  const [saved, setSaved] = useState(readSave);
  const [confirmOver, setConfirmOver] = useState(false);
  const [bankIn, setBankIn] = useState(() => rawBank().items.length > 0);
  useEffect(() => { if (!bankIn) void loadAppBank().then(() => setBankIn(rawBank().items.length > 0)); }, [bankIn]);

  const size = examSize(mode);
  const minutesText = (m: number | null) => (m === null ? 'No clock' : m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim() : `${m} min`);
  const timeOptions = T.timeOptions.map((o) => ({ id: o.id, title: o.label, sub: [minutesText(examSize(o.id).minutes), o.note].filter(Boolean).join(' · ') }));
  const sectionOptions = T.sections.map((s) => ({ id: s.section, title: sectionName(s.section), sub: config.sections.find((x) => x.id === s.section)?.description }));

  // the paid plan's free full tests (limits.ts; never while payments are off). A test already started can be finished.
  const cap = testCap(p, me);
  const begin = () => {
    if (!bankIn || cap) return;
    if (saved && !window.confirm('Start a new test? Your saved test will be deleted.')) return;
    sfx('go');
    const seed = (Date.now() % 2147483647) | 0;
    const plan = buildExam(rawBank().items, { seed, mode, first, seen: seenIn(p.tests), id: `T${p.tests.length + 1}-${seed.toString(36)}` });
    const s = { v: 1 as const, plan, sec: 0, q: 0, phase: 'intro' as const, answers: {}, flags: [], left: plan.timing === 'total' ? plan.totalSeconds : plan.sections[0].seconds, spent: plan.sections.map(() => 0), at: Date.now() };
    writeSave(s);
    setSaved(s);
    go('#exam');
  };
  const startOver = () => { sfx('tap'); setConfirmOver(false); clearSave(); setSaved(null); };
  const where = saved ? `${sectionShort(saved.plan.sections[saved.sec].id)}, ${saved.phase === 'intro' ? 'start of the section' : `question ${saved.q + 1}`}${saved.left !== null ? ` · ${clock(saved.left)} left` : ''}` : '';
  const past = [...p.tests].reverse();

  return (
    <div className="ft-screen">
      <div className="pa-body ft-main">
        <header className="ft-head">
          <h1>{T.title}</h1>
          {T.intro ? <p>{T.intro}</p> : null}
        </header>

        <div className="ft-col ft-a">
          <div className="ft-stats">
            <div className="fx-fadeup"><p className="ft-num">{size.questions}</p><p className="ft-lab">questions</p></div>
            <div className="fx-fadeup" style={{ animationDelay: '80ms' }}><p className="ft-num">{size.minutes ?? '—'}</p><p className="ft-lab">{size.minutes === null ? 'no clock' : 'minutes'}</p></div>
            <div className="fx-fadeup" style={{ animationDelay: '160ms' }}><p className="ft-num">{T.sections.length}</p><p className="ft-lab">{T.sections.length === 1 ? 'section' : 'sections'}</p></div>
          </div>
          <ul className="ft-sections" aria-label="Sections">
            {T.sections.map((s) => (
              <li key={s.section}><b>{sectionName(s.section)}</b><span>{s.questions} questions{T.timing === 'per-section' && s.minutes ? ` · ${s.minutes} min` : ''}</span></li>
            ))}
          </ul>
          {T.rules.length ? (
            <section className="ft-rules fx-fadeup" style={{ animationDelay: '240ms' }}>
              <h2>Same rules as test day</h2>
              <ul>
                {T.rules.map((r, i) => (
                  <li key={i}>
                    <span className="ft-chip" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d={RULE_ICONS[i % RULE_ICONS.length]} /></svg></span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <div className="ft-col ft-b">
          {saved ? (
            <section className="ft-resume" aria-labelledby="ft-resume-h">
              <h2 id="ft-resume-h">Pick up where you left off</h2>
              <p>{where}</p>
              <div className="ft-resume-acts">
                <button type="button" className="pa-btn coral" onClick={() => { sfx('tap'); go('#exam'); }}>Resume the test</button>
                {confirmOver ? (
                  <span className="ft-confirm" role="group" aria-label="Confirm start over">
                    <span>Delete this saved test?</span>
                    <button type="button" className="ft-link" autoFocus onClick={() => { sfx('tap'); setConfirmOver(false); }}>Keep it</button>
                    <button type="button" className="ft-link ft-danger" onClick={startOver}>Yes, delete it</button>
                  </span>
                ) : <button type="button" className="ft-link" onClick={() => { sfx('tap'); setConfirmOver(true); }}>Start over</button>}
              </div>
            </section>
          ) : null}
          {T.sectionOrder === 'choose' && T.sections.length > 1
            ? <Choice legend="Which section first?" id="ft-first" options={sectionOptions} value={first} onPick={(v) => { sfx('tap'); setFirst(v); }} />
            : null}
          {T.timeOptions.length > 1 ? <Choice legend="Time" id="ft-time" options={timeOptions} value={mode} onPick={(v) => { sfx('tap'); setMode(v); }} /> : null}

          {past.length ? (
            <section className="ft-tests" aria-labelledby="ft-past-h">
              <h2 id="ft-past-h">Your tests</h2>
              <ul className="ft-past">
                {past.map((t, k) => {
                  const h = headlineOfTest(t);
                  const right = t.sections.reduce((a, s) => a + s.right, 0), total = t.sections.reduce((a, s) => a + s.total, 0);
                  return (
                    <li key={t.id}>
                      <a href={'#exam/result/' + encodeURIComponent(t.id)} className="ft-past-row press" onClick={() => sfx('tap')}>
                        <span><b>Test {past.length - k}</b><small>{dayLabelShort(t.at)}</small></span>
                        <span className="ft-past-num">{h ? <b>{h.score}</b> : null}<small>{right}/{total} right</small></span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
          <p className="ft-note">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
            <span>Every test is new, made from the questions you have seen least. {config.scoring.disclaimer} Your test is saved on this device as you go, and the clock stops when you leave.</span>
          </p>
        </div>
      </div>

      <footer className="ft-foot">
        {cap && cap.kind === 'test' ? (
          <div className="cap-ask" role="status">
            <p>You’ve taken the {cap.allowed === 1 ? 'free full test' : `${cap.allowed} free full tests`}. You can still {saved ? 'finish your saved test, ' : ''}review your past tests and keep practicing lessons.</p>
            <AskParent kind="tests" />
            {me.role === 'parent' ? <p className="cap-parent">For parents: {config.plan?.name ?? 'Pro'} opens more full tests. <a href="/account/#plan">See it on your account page</a></p> : null}
          </div>
        ) : (
          <button type="button" className="pa-btn coral ft-start" disabled={!bankIn} onClick={begin}>
            {!bankIn ? 'Getting the test ready…' : T.sectionOrder === 'choose' && T.sections.length > 1 ? `Start with ${sectionShort(first)}` : 'Start the test'}
          </button>
        )}
        {parentLooking ? <p className="ft-paused">You’re looking around as a parent: a test taken now is not saved to a child.</p> : null}
      </footer>
    </div>
  );
}
