// The full practice test (#exam): sections one after another, as pack.yaml `fullTest` describes them. A card before
// each section, then its questions with no feedback, a question list to check before submitting, and no way back
// into a submitted section. One clock for the whole test (timing: total) or one per section (per-section); when a
// section's clock runs out it is submitted, when the test's runs out the test ends. Inside a section, Back works
// only where the pack allows it (allowBack); where it doesn't, a question must be answered to move on.
// The test is saved after every change (exam/save.ts). At the end: the score estimate, how it compares with the
// pack's benchmarks, the weakest skills with a lesson to practice each, and every miss goes to Review.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../ctx';
import { config, sectionName, sectionShort } from '../../pack';
import { compare } from '../../pack/scoring';
import { stepById, passageOf, rawBank } from '../levels/index';
import { blank, ready, type Ans } from '../levels/grade';
import { today } from '../store';
import { Activity, PassagePanel, boxHtml, chipOf } from './Level';
import { Sheet } from '../ui';
import { readSave, writeSave, clearSave, clock, type ExamSave } from '../exam/save';
import { scoreExam, addTest, estimateOfTest, weakest, type TestRec } from '../exam/results';
import { loadAppBank } from '../appBank';
import './Lesson.css';
import './Level.css';
import './Exam.css';

/** The clock turns to the warning color with 5 minutes left, or a fifth of a shorter clock. */
const lowAt = (full: number | null) => Math.min(5 * 60, Math.round((full ?? 0) / 5));

export default function Exam() {
  const { go, route, p } = useApp();
  // #exam/result/<test id>: a finished test's results again
  const past = route.args[0] === 'result' ? p.tests.find((t) => t.id === route.args[1]) : undefined;
  if (past) return <Results rec={past} />;
  return <Live />;
}

function Live() {
  const { go } = useApp();
  const [save, setSave] = useState<ExamSave | null>(readSave);
  const [rec, setRec] = useState<TestRec | null>(null);
  const [bankIn, setBankIn] = useState(() => rawBank().items.length > 0);
  useEffect(() => { if (!bankIn) void loadAppBank().then(() => setBankIn(rawBank().items.length > 0)); }, [bankIn]);
  useEffect(() => { if (!save && !rec) go('#test'); }, [save, rec, go]);
  if (rec) return <Results rec={rec} />;
  if (!save) return null;
  if (!bankIn) return <p className="pa-body ex-wait" role="status">Getting the test ready…</p>;
  return <Run save={save} setSave={setSave} onDone={setRec} />;
}

function Run({ save, setSave, onDone }: { save: ExamSave; setSave: (s: ExamSave | null) => void; onDone: (r: TestRec) => void }) {
  const { sfx, update, go } = useApp();
  const { plan } = save;
  const sec = plan.sections[save.sec];
  const per = plan.timing === 'per-section';
  const [leave, setLeave] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [notice, setNotice] = useState('');
  const ref = useRef(save);
  ref.current = save;

  const put = useCallback((s: ExamSave) => { ref.current = s; writeSave(s); setSave(s); }, [setSave]);

  const finish = useCallback((s: ExamSave) => {
    const skillOf = (id: string) => rawBank().items.find((x) => x.id === id)?.skill ?? '';
    const r = scoreExam(s.plan, s.answers, s.spent, skillOf, today());
    update((p) => addTest(p, r));
    clearSave();
    sfx('fanfare');
    onDone(r);
  }, [update, sfx, onDone]);

  /** Submits the section on screen: the next section's card, or the end of the test. */
  const submit = useCallback((s: ExamSave, why = '') => {
    setConfirm(false);
    if (s.sec >= s.plan.sections.length - 1) { finish(s); return; }
    const next = s.plan.sections[s.sec + 1];
    setNotice(why);
    put({ ...s, sec: s.sec + 1, q: 0, phase: 'intro', left: per ? next.seconds : s.left });
  }, [finish, put, per]);

  // The clock: runs while answering or checking the list, never on a section's card.
  const running = save.phase !== 'intro' && save.left !== null;
  useEffect(() => {
    if (!running) return;
    let n = 0;
    const id = window.setInterval(() => {
      const s = ref.current;
      if (s.left === null) return;
      const left = s.left - 1;
      const spent = [...s.spent]; spent[s.sec] = (spent[s.sec] || 0) + 1;
      const nx = { ...s, left, spent };
      if (left <= 0) {
        if (per) submit({ ...nx, left: 0 }, `Time was up for ${sectionName(s.plan.sections[s.sec].id)}, so it was submitted.`);
        else finish({ ...nx, left: 0 });
        return;
      }
      ref.current = nx;
      setSave(nx);
      if (++n % 5 === 0) writeSave(nx);
    }, 1000);
    return () => window.clearInterval(id);
  }, [running, per, submit, finish, setSave]);
  // An untimed test still counts the time spent per section.
  useEffect(() => {
    if (save.phase === 'intro' || save.left !== null) return;
    const id = window.setInterval(() => {
      const s = ref.current; const spent = [...s.spent]; spent[s.sec] = (spent[s.sec] || 0) + 1;
      ref.current = { ...s, spent };
    }, 1000);
    return () => { window.clearInterval(id); writeSave(ref.current); };
  }, [save.phase, save.left, save.sec]);
  useEffect(() => { const on = () => writeSave(ref.current); addEventListener('pagehide', on); return () => removeEventListener('pagehide', on); }, []);

  const head = (
    <header className="ls-head ex-head">
      <button type="button" className="ls-icon-btn" aria-label="Leave the test" onClick={() => { sfx('tap'); setLeave(true); }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
      <p className="ex-where"><b>{sectionName(sec.id)}</b><span>Section {save.sec + 1} of {plan.sections.length}</span></p>
      {save.left !== null && save.phase !== 'intro'
        ? <p className={'ex-clock' + (save.left <= lowAt(per ? sec.seconds : plan.totalSeconds) ? ' is-low' : '')} role="timer" aria-live="off"><span className="sr">Time left </span>{clock(save.left)}</p>
        : save.left === null ? <p className="ex-clock is-off">No clock</p> : null}
    </header>
  );
  const leaveSheet = leave ? (
    <Sheet label="Leave the test?" onClose={() => setLeave(false)}>
      <h2 className="ex-sheet-h">Leave the test?</h2>
      <p className="ex-sheet-p">It is saved on this device{save.left !== null ? ' and the clock stops' : ''}. Pick it up from the Full test tab.</p>
      <div className="ls-quit">
        <button type="button" className="pa-btn green press" onClick={() => { sfx('tap'); setLeave(false); }}>Keep going</button>
        <button type="button" className="pa-btn ghost press" onClick={() => { writeSave(ref.current); go('#test'); }}>Leave</button>
      </div>
    </Sheet>
  ) : null;

  if (save.phase === 'intro') {
    const minutes = per ? (sec.seconds !== null ? Math.round(sec.seconds / 60) : null) : null;
    return (
      <>
        {head}
        <div className="pa-body ex-intro">
          {notice ? <p className="ex-notice" role="status">{notice}</p> : null}
          <p className="ex-kicker">Section {save.sec + 1} of {plan.sections.length}</p>
          <h1>{sectionName(sec.id)}</h1>
          <ul className="ex-facts">
            <li><b>{sec.items.length}</b> questions</li>
            {minutes !== null ? <li><b>{minutes}</b> minutes</li> : plan.totalSeconds !== null && save.left !== null ? <li><b>{clock(save.left)}</b> left for the test</li> : <li>No clock</li>}
            <li>{sec.allowBack ? 'You can go back inside this section' : 'No going back: answer each question to move on'}</li>
          </ul>
          <p className="ex-sheet-p">Once you submit this section, you can’t return to it.</p>
        </div>
        <footer className="ls-foot"><button type="button" className="ls-cta press" autoFocus onClick={() => { sfx('go'); setNotice(''); put({ ...save, phase: 'run', q: 0 }); }}>Start section {save.sec + 1}</button></footer>
        {leaveSheet}
      </>
    );
  }

  if (save.phase === 'review') {
    const blanks = sec.items.filter((id) => !save.answers[id]).length;
    return (
      <>
        {head}
        <div className="pa-body ex-review">
          <h1>Check your answers</h1>
          <p className="ex-sheet-p">{blanks ? `${blanks} question${blanks > 1 ? 's are' : ' is'} still blank.` : 'Every question has an answer.'}{sec.allowBack ? ' Tap a number to go back to it.' : ''}</p>
          <ol className="ex-grid">
            {sec.items.map((id, k) => {
              const st = save.answers[id] ? 'is-done' : 'is-blank', fl = save.flags.includes(id) ? ' is-flag' : '';
              return (
                <li key={id}>
                  <button type="button" className={'ex-num ' + st + fl} disabled={!sec.allowBack} aria-label={`Question ${k + 1}${save.answers[id] ? ', answered' : ', blank'}${fl ? ', flagged' : ''}`}
                    onClick={() => { sfx('tap'); put({ ...save, phase: 'run', q: k }); }}>{k + 1}</button>
                </li>
              );
            })}
          </ol>
        </div>
        <footer className="ls-foot">
          {sec.allowBack ? <button type="button" className="pa-btn ghost press ex-back" onClick={() => { sfx('tap'); put({ ...save, phase: 'run', q: sec.items.length - 1 }); }}>Back</button> : null}
          <button type="button" className="ls-cta press" onClick={() => { sfx('tap'); setConfirm(true); }}>Submit section</button>
        </footer>
        {confirm ? (
          <Sheet label="Submit this section?" onClose={() => setConfirm(false)}>
            <h2 className="ex-sheet-h">Submit {sectionName(sec.id)}?</h2>
            <p className="ex-sheet-p">You can’t come back to this section after you submit it.{blanks ? ` ${blanks} blank question${blanks > 1 ? 's count' : ' counts'} as missed.` : ''}</p>
            <div className="ls-quit">
              <button type="button" className="pa-btn green press" autoFocus onClick={() => submit(ref.current)}>Submit</button>
              <button type="button" className="pa-btn ghost press" onClick={() => setConfirm(false)}>Not yet</button>
            </div>
          </Sheet>
        ) : null}
        {leaveSheet}
      </>
    );
  }

  return <Question save={save} put={put} head={head} leaveSheet={leaveSheet} />;
}

function Question({ save, put, head, leaveSheet }: { save: ExamSave; put: (s: ExamSave) => void; head: React.ReactNode; leaveSheet: React.ReactNode }) {
  const { sfx } = useApp();
  const sec = save.plan.sections[save.sec];
  const id = sec.items[save.q];
  const S = stepById(id);
  const ans: Ans = save.answers[id] ?? (S ? blank(S) : { kind: 'mc', v: null, struck: [] });
  const promptRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { promptRef.current?.focus({ preventScroll: true }); }, [id]);
  if (!S) return <>{head}<p className="pa-body ex-wait">This question is missing from the pack.</p></>;
  const answered = ready(S, ans);
  const last = save.q >= sec.items.length - 1;
  const setAns = (a: Ans) => put({ ...save, answers: { ...save.answers, [id]: a } });
  const flagged = save.flags.includes(id);
  const move = (q: number) => { sfx('tap'); put({ ...save, q }); };
  const passage = S.pid ? passageOf(S.pid) : undefined;
  return (
    <>
      {head}
      <div className="ex-bar" aria-hidden="true"><span style={{ width: `${((save.q + 1) / sec.items.length) * 100}%` }} /></div>
      {passage ? <PassagePanel p={passage} key={'p-' + S.pid} /> : null}
      <div className={'pa-body ls-main lv-main ex-main' + (passage ? ' has-passage' : '')} key={id}>
        <div className="lv-chips">
          <p className="ls-chip">Question {save.q + 1} of {sec.items.length}</p>
          {chipOf(S) ? <p className="lv-format">{chipOf(S)}</p> : null}
        </div>
        {S.box ? <div className="lv-box-text" role="group" aria-label="The sentence" dangerouslySetInnerHTML={{ __html: boxHtml(S.box) }} /> : null}
        {S.html
          ? <h1 ref={promptRef} tabIndex={-1} className="ls-prompt" dangerouslySetInnerHTML={{ __html: S.prompt }} />
          : <h1 ref={promptRef} tabIndex={-1} className="ls-prompt">{S.prompt}</h1>}
        {S.fig ? <div className="lv-fig" dangerouslySetInnerHTML={{ __html: S.fig }} /> : null}
        {S.tbl ? (
          <div className="lv-tbl" tabIndex={0} role="region" aria-label={S.tbl.caption || 'Table'}><table>
            {S.tbl.caption ? <caption>{S.tbl.caption}</caption> : null}
            <thead><tr>{S.tbl.cols.map((c, k) => <th key={k} scope="col">{c}</th>)}</tr></thead>
            <tbody>{S.tbl.rows.map((r, ri) => <tr key={ri}>{r.map((c, k) => <td key={k}>{c}</td>)}</tr>)}</tbody>
          </table></div>
        ) : null}
        <Activity s={S} a={ans} set={setAns} checked={false} elim={false} />
      </div>
      <footer className="ls-foot ex-foot">
        {sec.allowBack ? <button type="button" className="pa-btn ghost press ex-back" disabled={save.q === 0} onClick={() => move(save.q - 1)}>Back</button> : null}
        <button type="button" className={'ls-tool ex-flag' + (flagged ? ' on' : '')} aria-pressed={flagged}
          onClick={() => { sfx('tap'); put({ ...save, flags: flagged ? save.flags.filter((x) => x !== id) : [...save.flags, id] }); }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill={flagged ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><path d="M5 21V4h11l-2 4 2 4H5" /></svg>
          {flagged ? 'Flagged' : 'Flag'}
        </button>
        <button type="button" className="ls-cta press" disabled={!sec.allowBack && !answered}
          onClick={() => { if (last) { sfx('tap'); put({ ...save, phase: 'review' }); } else move(save.q + 1); }}>
          {last ? 'Check answers' : 'Next'}
        </button>
      </footer>
      {leaveSheet}
    </>
  );
}

function Results({ rec }: { rec: TestRec }) {
  const { sfx } = useApp();
  const est = useMemo(() => estimateOfTest(rec), [rec]);
  const weak = useMemo(() => weakest(rec), [rec]);
  const S = config.scoring;
  const top = est?.composite ?? (est && est.sections.length === 1 ? est.sections[0] : null);
  const right = rec.sections.reduce((a, s) => a + s.right, 0), total = rec.sections.reduce((a, s) => a + s.total, 0);
  const minutes = Math.round(rec.sections.reduce((a, s) => a + s.seconds, 0) / 60);
  const untimed = config.fullTest.timeOptions.find((o) => o.id === rec.mode)?.factor === null;
  return (
    <div className="pa-body ex-results">
      <p className="ex-kicker">{config.fullTest.title} · finished</p>
      <h1>{right} of {total} right</h1>
      <p className="ex-sub">{minutes} min{untimed ? ' · untimed' : ''}</p>
      {top ? (
        <section className="ex-card ex-score" aria-labelledby="ex-score-h">
          <h2 id="ex-score-h">{S.label}{est?.composite ? ` · ${S.compositeLabel}` : ''}</h2>
          <p className="ex-big">{top.score}</p>
          {S.margin ? <p className="ex-range">Likely between {top.lo} and {top.hi}</p> : null}
          {S.benchmarks.length ? (
            <ul className="ex-bench">
              {S.benchmarks.map((b) => {
                const c = compare(top, b.score);
                return <li key={b.label} className={'is-' + c}><span>{b.label}</span><b>{b.score}</b><em>{c === 'above' ? 'above' : c === 'near' ? 'within reach' : 'below'}</em></li>;
              })}
            </ul>
          ) : null}
        </section>
      ) : null}
      <section className="ex-card" aria-labelledby="ex-sec-h">
        <h2 id="ex-sec-h">{top ? 'By section' : `${S.label} by section`}</h2>
        <ul className="ex-secs">
          {rec.sections.map((s) => {
            const e = est?.sections.find((x) => x.id === s.id);
            return (
              <li key={s.id}>
                <span className="ex-sec-name">{sectionShort(s.id)}</span>
                <span className="ex-sec-bar" aria-hidden="true"><span style={{ width: `${s.total ? (100 * s.right) / s.total : 0}%` }} /></span>
                <span className="ex-sec-num">{s.right}/{s.total}{e ? <small> · {e.score}</small> : null}</span>
              </li>
            );
          })}
        </ul>
      </section>
      {weak.length ? (
        <section className="ex-card" aria-labelledby="ex-weak-h">
          <h2 id="ex-weak-h">Practice next</h2>
          <ul className="ex-weak">
            {weak.map((w) => (
              <li key={w.skill}>
                <span><b>{w.name}</b><small>{w.missed} of {w.of} missed</small></span>
                {w.lesson ? <a className="pa-btn green press" href={'#play/' + w.lesson} onClick={() => sfx('tap')}>Practice</a> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <p className="ex-fine">{S.disclaimer}{untimed ? ' This run had no clock, so test-day timing may be harder.' : ''}</p>
      <div className="ex-acts">
        {right < total ? <a className="pa-btn coral press" href="#review" onClick={() => sfx('tap')}>Redo my mistakes</a> : null}
        <a className="pa-btn ghost press" href="#test" onClick={() => sfx('tap')}>Back to Full test</a>
      </div>
    </div>
  );
}
