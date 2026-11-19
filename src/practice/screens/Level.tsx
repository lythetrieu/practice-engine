// A level of about 10 steps, each its own activity: warm-up,
// learn card, guided steps, varied practice, find the mistake, and a boss question in test mode. Each
// activity trains one of the computer test's item types.
// Three ways to play it:
// - from the map (#play/<lesson id>, levels/index.ts LEVEL_OF): saves the place after every step, and the end
//   goes through the store's finish() like any lesson (XP, stars, streak, mistakes to Review);
// - in Review: the missed steps that are due, one after another;
// - the sample list (#level, dev only): nothing is saved, with its own summary.
import { useEffect, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import { useApp } from '../ctx';
import { config } from '../../pack';
import { LESSONS } from '../curriculum';
import { stepKey, LEVEL_OF, passageOf, stepById, stopItems } from '../levels/index';
import type { BankPassage } from '../levels/fromBank';
import { saveInProgress, today, passNeed, type Answer, type InProgress } from '../store';
import { NumberLine, PlotGrid, SpotGrid, TransformGrid, SolutionSet } from './LevelGraph';
import { hintBudget, stopOfKey, mastery, rawId, addToPlan } from '../tutor/model';
import type { More } from '../tutor/pick';
import { FORMAT, CHIP, STAGE_LABEL, type RateStep, type ReflectStep, type MultiStep, type Level as L, type Step, type FillStep, type TableStep, type McStep, type ClassifyStep, type TypedStep, type SprintStep, type MistakeStep, type OrderStep, type HotStep, type InlineStep, type EstimateStep, type LearnStep } from '../levels/types';
import { blank, ready, grade, num, tableInputs, type Ans } from '../levels/grade';
import { Sheet, STAR, FLAME, RowMark, Letter, focusSoon } from '../ui';
import { ReportSheet, FlagButton, type QuestionContext } from '../report';
import { setErrorStep } from '../errors';
import { TutorAsk, PipHint } from './TutorAsk';
import { MascotFace, mascotName } from '../Mascot';
import { plainText, pipEnabled, type TutorStep, type TutorCtx, type TutorAction } from '../aitutor';
import './Lesson.css';
import './Level.css';

const LETTERS = 'ABCDEF';
const XP_STEP = 5;
const XP_FINISH = 10;
/** The boss question's pace: the pack's full test time per question (90 s when the test is untimed). */
const PACE_S = (() => {
  const t = config.fullTest, n = t.sections.reduce((a, s) => a + s.questions, 0);
  const min = t.timing === 'total' ? t.minutes || 0 : t.sections.reduce((a, s) => a + (s.minutes || 0), 0);
  return n && min ? Math.round((min * 60) / n) : 90;
})();

/** One step to play, with the id it is saved under ("<level id>/<step id>"). `tag` names why a tutor round asks it
    ("Building block", "Try a similar one"), shown in place of the stage chip. */
export interface Item { key: string; step: Step; tag?: string }
/** demo: the sample list; lesson: a map lesson; review: missed steps; the rest are tutor rounds (tutor/pick.ts). */
export type Mode = 'demo' | 'lesson' | 'review' | 'check' | 'placement' | 'skill' | 'practice' | 'fix';
export interface Run {
  mode: Mode; id: string; items: Item[]; resume?: InProgress;
  /** Adaptive rounds: asked for the next questions after the last one; none = the round is over. */
  more?: More;
  /** About how many questions the round has (for the progress bar while `more` can still add some). */
  expect?: number;
  /** Unit check: the keys of the world's own questions (they decide the pass). */
  core?: string[];
  grade?: number | null;
}
/** Rounds that are checks: no hints, like the test. */
const TEST_MODES = new Set<Mode>(['check', 'placement', 'skill']);
const MODE: Record<Mode, { noun: string; chip: string; back: string; end: string }> = {
  demo: { noun: 'level', chip: '', back: '#level', end: 'Finish level' },
  lesson: { noun: 'level', chip: '', back: '#learn', end: 'Finish level' },
  review: { noun: 'review', chip: 'Review', back: '#review', end: 'Finish review' },
  check: { noun: 'unit check', chip: 'Unit check', back: '#learn', end: 'See my results' },
  placement: { noun: 'placement check', chip: 'Placement check', back: '#home', end: 'See my results' },
  skill: { noun: 'skill check', chip: 'Skill check', back: '#home', end: 'See my results' },
  practice: { noun: 'practice set', chip: 'Practice', back: '#home', end: 'Finish practice' },
  fix: { noun: 'review', chip: 'Review', back: '#review', end: 'Finish review' },
};

export const levelItems = (lv: L): Item[] => lv.steps.map((s) => ({ key: stepKey(lv, s), step: s }));

export default function LevelScreen() {
  const { route } = useApp();
  const [run, setRun] = useState(0);
  const lv = import.meta.env.DEV ? LEVEL_OF[route.args[0]] : undefined; // dev only: #level/<lesson id> plays a lesson unsaved
  if (!lv) return <LevelList />;
  return <Play key={lv.id + '/' + run} lv={lv} run={{ mode: 'demo', id: lv.id, items: levelItems(lv) }} onAgain={() => setRun((n) => n + 1)} />;
}

function LevelList() {
  const { sfx } = useApp();
  const list = Object.values(LEVEL_OF);
  return (
    <div className="pa-body lv-list">
      <p className="lv-kicker">Dev only · nothing is saved</p>
      <h1>Every lesson of this pack</h1>
      {list.map((l) => (
        <a key={l.id} className="lv-card press" href={`#level/${l.id}`} onClick={() => sfx('tap')}>
          <span className="lv-card-world">{l.subject} · world {l.world}</span>
          <span className="lv-card-title">{l.title}</span>
          <span className="lv-card-formats">{[...new Set(l.steps.map((s) => FORMAT[s.kind]))].join(' · ')}</span>
        </a>
      ))}
      <a className="pa-btn ghost lv-back" href="#home" onClick={() => sfx('tap')}>Back to Home</a>
    </div>
  );
}

interface Result { id: string; right: boolean; graded: boolean }

export function Play({ lv, run, onAgain }: { lv?: L; run: Run; onAgain?: () => void }) {
  const { p, me, sfx, buzz, go, update, finishPlay } = useApp();
  // The steps are fixed when the level starts: a bank that lands later never rebuilds them under the student. An
  // adaptive round adds the next question after the last one (run.more).
  const [items, setItems] = useState(() => run.items);
  const total = items.length;
  const shownTotal = Math.max(total, run.more ? run.expect || 0 : 0);
  const saving = run.mode !== 'demo';
  // Dev only: ?step=N opens step N (1-based) of a sample level, to look at one activity without playing up to it.
  const devStep = import.meta.env.DEV && !saving ? Number(new URLSearchParams(location.search).get('step')) - 1 : -1;
  const start = run.resume ? Math.min(run.resume.answers.length, total - 1) : devStep > 0 ? Math.min(devStep, total - 1) : 0;
  const [i, setI] = useState(start);
  const [ans, setAns] = useState<Ans>(() => blank(items[start].step));
  const [checked, setChecked] = useState(false);
  const [right, setRight] = useState(false);
  const [elim, setElim] = useState(false);
  const [quit, setQuit] = useState(false);
  const [done, setDone] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(true);   // the feedback sheet can be folded away to see the answer
  const [hintsShown, setHintsShown] = useState(0);   // the hint ladder: how many hints are open on this step
  const [askN, setAskN] = useState(0);               // taps on the answer sheet's ask button (opens the tutor's menu)
  const [pipHint, setPipHint] = useState(false);     // the tutor's hint asked for before Check (one per question)
  // a lesson's general lines (its learn card, the kind's strategy) are each shown once per round, not on every question
  const genericSeen = useRef(new Set<string>());
  const stepHints = useRef<{ key: string; list: string[]; generic: Set<string> } | null>(null);
  // right answers in a row in this round; a burst marks every third one (no penalty or reset message on a miss)
  const runRef = useRef(0);
  const [burst, setBurst] = useState(0);
  const slips = useRef<string[]>([]);
  const whys = useRef(0);   // "Why?" opened after a right answer
  // every step so far, in order (ungraded steps count as right): what is saved and what finish() scores
  const answers = useRef<Answer[]>(run.resume ? run.resume.answers.slice(0, start) : []);
  const seconds = useRef(run.resume?.seconds ?? 0);
  const stepStart = useRef(Date.now());
  const finishing = useRef(false);
  const promptRef = useRef<HTMLHeadingElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const first = useRef(true);
  const dragY = useRef<number | null>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const [mainScrolls, setMainScrolls] = useState(false);   // when the question area scrolls, a keyboard can reach it
  const [sheetH, setSheetH] = useState(0);   // on a wide screen the passage panel stops above the feedback sheet

  const { key, step: S } = items[i];
  const graded = S.graded !== false;
  const isLast = i === total - 1 && !run.more;
  const isReplay = !!p.lessons[run.id];
  const { back, noun } = MODE[run.mode];
  const endLabel = MODE[run.mode].end;

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    promptRef.current?.focus({ preventScroll: true });
  }, [i]);
  useEffect(() => { if (checked) nextRef.current?.focus({ preventScroll: true }); }, [checked]);
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const measure = () => setMainScrolls(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [key, checked, sheetOpen, sheetH]);
  // The sheet takes up to 40% of a phone screen: bring the student's answer (or what was wrong) back into view above it.
  useEffect(() => {
    const id = window.requestAnimationFrame(() => setSheetH(checked ? sheetRef.current?.offsetHeight ?? 0 : 0));
    return () => window.cancelAnimationFrame(id);
  }, [checked, sheetOpen, i]);
  useEffect(() => {
    if (!checked) return;
    const t = window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>('.lv-main .is-wrong, .lv-main .is-picked, .lv-main .is-right');
      el?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    }, 60);
    return () => window.clearTimeout(t);
  }, [checked, i]);
  // Report a problem with the step on screen (so reports arrive quickly). qid = the bank item id, or the
  // teaching step's own id (e.g. math-1-1-g1). The error log carries the same step.
  const [report, setReport] = useState(false);
  useEffect(() => { setErrorStep(`${run.id}#${i + 1}:${S.kind}:${S.id}`); return () => setErrorStep(null); }, [run.id, i, S.kind, S.id]);

  // Save the place after each step, so leaving (or the phone dying) never loses the level.
  const record = (correct: boolean) => {
    answers.current.push({ qid: key, correct, kind: S.kind, ...(hintsShown ? { hints: hintsShown } : {}),
      // the choice picked on a multiple choice question: the answer log counts which wrong choice draws students
      ...(S.kind === 'mc' && ans.kind === 'mc' && ans.v !== null ? { pick: ans.v } : {}) });
    seconds.current += Math.min(300, Math.max(0, (Date.now() - stepStart.current) / 1000));
    if (!saving) return;
    // a guided review's look-back steps are not saved steps: it starts over if left
    if (run.mode === 'fix') return;
    const saved: InProgress = { id: run.id, kind: run.mode === 'demo' ? 'lesson' : run.mode, qids: items.map((x) => x.key), answers: answers.current.slice(), seconds: Math.round(seconds.current), at: today() };
    update((x) => saveInProgress(x, saved));
  };

  const check = () => {
    if (checked || !ready(S, ans)) return;
    const ok = grade(S, ans);
    record(ok);
    if (graded) {
      runRef.current = ok ? runRef.current + 1 : 0;
      if (ok && runRef.current >= 3 && runRef.current % 3 === 0) setBurst(runRef.current);
    }
    // Right: the explanation waits behind "Why?". Wrong or not scored: it opens at once.
    setSheetOpen(!ok || !graded);
    if (S.kind === 'reflect' && ans.kind === 'reflect' && ans.v !== null) slips.current.push(S.slips[ans.v]);
    setRight(ok);
    setChecked(true);
    setElim(false);
    if (!graded) sfx('go');
    else if (ok) { sfx('correct'); buzz(15); }
    else { sfx('wrong'); buzz([40, 40, 40]); }
  };

  const finish = () => {
    if (finishing.current) return;
    finishing.current = true;
    if (!saving) { setDone(true); sfx('fanfare'); return; }
    // Only scored steps count toward XP, stars, the daily goal and Review (warm-ups, learn cards and the
    // speed round are not questions).
    const scored = answers.current.filter((a) => items.find((x) => x.key === a.qid)?.step.graded !== false);
    const right = scored.filter((a) => a.correct).length;
    const acc = scored.length ? right / scored.length : 1;
    const boss = items.find((x) => x.step.stage === 'boss');
    const bossRight = !!boss && scored.some((a) => a.qid === boss.key && a.correct);
    const stars = 1 + (acc >= 0.8 ? 1 : 0) + (acc >= 0.8 && bossRight ? 1 : 0);
    // A level needs at least half of its scored questions right to open the next one.
    const pass = run.mode !== 'lesson' || !scored.length || right >= passNeed(scored.length);
    const probes = [...new Set(items.filter((x) => x.tag === 'Building block').map((x) => stopOfKey(x.key)).filter(Boolean) as string[])];
    finishPlay({ id: run.id, kind: run.mode === 'demo' ? 'lesson' : run.mode, answers: scored, seconds: Math.round(seconds.current), stars, pass,
      ...(run.core ? { core: run.core, probes } : {}), ...(slips.current.length ? { slips: slips.current } : {}), ...(whys.current ? { whys: whys.current } : {}), ...(run.grade !== undefined ? { grade: run.grade } : {}) });
  };

  const next = () => {
    sfx('tap');
    let list = items;
    if (i === total - 1 && run.more && saving) {
      // An adaptive round: the next question depends on every answer so far.
      const add = run.more(answers.current, items).filter((x) => !items.some((y) => y.key === x.key));
      if (add.length) { list = [...items, ...add]; setItems(list); }
    }
    if (i >= list.length - 1) { finish(); return; }
    const n = i + 1;
    setI(n);
    setAns(blank(list[n].step));
    setChecked(false);
    setRight(false);
    setElim(false);
    setSheetOpen(true);
    setBurst(0);
    setHintsShown(0);
    setAskN(0);
    setPipHint(false);
    stepStart.current = Date.now();
  };

  // A learn card moves on without a Check sheet of its own.
  const skipLearn = () => { record(true); next(); };
  // A self-rating card (placement): one tap is the answer, and the next question comes at once.
  const rate = (v: number) => {
    answers.current.push({ qid: key, correct: true, kind: 'rate', v });
    seconds.current += Math.min(300, Math.max(0, (Date.now() - stepStart.current) / 1000));
    next();
  };

  if (done && lv) return <Summary lv={lv} results={answers.current.map((a) => ({ id: a.qid, right: a.correct, graded: items.find((x) => x.key === a.qid)?.step.graded !== false }))} onAgain={onAgain || (() => go('#level'))} />;

  const finished = i + (checked ? 1 : 0);
  const canCheck = ready(S, ans);
  // The hint ladder: up to 3 hints, fewer as the skill grows; none in checks.
  const stop = stopOfKey(key) || run.id;
  // the step's ladder is fixed when the step opens (a general line seen now still shows while this step is open)
  if (stepHints.current?.key !== key) stepHints.current = { key, ...hintsFor(S, key, genericSeen.current) };
  const ladder = graded && !TEST_MODES.has(run.mode) && (S.stage === 'practice' || S.stage === 'guided') && !['learn', 'sprint', 'estimate', 'reflect'].includes(S.kind)
    ? stepHints.current.list.slice(0, run.mode === 'demo' ? 3 : hintBudget(p.tutor.skills[stop])) : [];
  const hint = ladder.length ? ladder : null;
  const openHint = () => {
    sfx('tap');
    const n = Math.min(ladder.length, hintsShown + 1);
    setHintsShown(n);
    for (const h of ladder.slice(0, n)) if (stepHints.current?.generic.has(h)) genericSeen.current.add(h);
    window.setTimeout(() => document.getElementById('lv-hint')?.lastElementChild?.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 60);
    // the cross-out rung of a multiple choice ladder (always its last) strikes that wrong answer
    if (S.kind === 'mc' && ans.kind === 'mc' && ladder[n - 1]?.startsWith('It’s not choice')) {
      const k = elimChoice(S);
      if (k !== null && !ans.struck.includes(k)) setAns({ ...ans, v: ans.v === k ? null : ans.v, struck: [...ans.struck, k] });
    }
  };

  // The optional AI tutor (TutorAsk.tsx, docs/pip.md): after Check on any scored step outside the checks, and for a hint before
  // Check where the hint ladder is offered. Only steps with one short answer it can talk about. With the tutor off for the
  // site (aitutor.ts pipEnabled) there is no AI button anywhere: the pack's reviewed hints and explanations only.
  const tutorOn = graded && !TEST_MODES.has(run.mode) && S.kind !== 'reflect' && S.kind !== 'rate' && S.kind !== 'learn' && S.kind !== 'sprint';
  const tStep = tutorOn && pipEnabled() ? tutorStep(S, ans) : null;
  const pipBefore = !!tStep && ladder.length > 0;
  const lessonStop = stop in LESSONS ? stop : undefined;
  // What the tutor knows about the student: the lesson, the weakest lessons, slips, this question's history (ids and numbers).
  const tCtx: TutorCtx | undefined = tStep ? (() => {
    const weak = Object.entries(p.tutor.skills).filter(([id, r]) => id in LESSONS && r.n > 0 && ['gap', 'learning'].includes(mastery(r))).sort((a, b) => a[1].k - b[1].k).slice(0, 5).map(([id]) => id);
    const seen = p.tutor.seen[rawId(key)];
    return { ...(lessonStop ? { stop: lessonStop } : {}), ...(weak.length ? { weak } : {}), ...(Object.keys(p.tutor.slips).length ? { slips: p.tutor.slips as Record<string, number> } : {}),
      ...(seen ? { tries: Math.min(9, seen[0]), missedBefore: seen[0] > seen[1] } : {}), ...(hintsShown ? { hints: hintsShown } : {}), ...(me.grade ? { grade: me.grade } : {}) };
  })() : undefined;
  // "Try one like it": a question of the same lesson that is not in this round yet, the closest in difficulty. The app picks
  // it from its own copy of the pack; the tutor only says it would help.
  const similarKey = tStep && lessonStop && ['lesson', 'practice', 'review', 'fix'].includes(run.mode) ? (() => {
    const pool = stopItems(lessonStop), d0 = pool.find((x) => x.key === key)?.d ?? 3;
    return pool.filter((x) => x.key !== key && !items.some((y) => y.key === x.key)).sort((a, b) => Math.abs(a.d - d0) - Math.abs(b.d - d0))[0]?.key ?? null;
  })() : null;
  // What the tutor may do here: point at a choice, open the next hint, add a question like this one next, put the lesson on
  // the plan. Tests and placement never get here (tutorOn).
  const pipAct = (a: TutorAction) => {
    if (a.act === 'highlight') {
      const k = LETTERS.indexOf(a.choice);
      const el = document.querySelectorAll<HTMLElement>('.lv-main .ls-choice')[k];
      if (el) { el.classList.add('is-pip'); window.setTimeout(() => el.classList.remove('is-pip'), 3000); el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    } else if (a.act === 'hint') {
      if (ladder.length && hintsShown < ladder.length) openHint();
    } else if (a.act === 'review') {
      if (lessonStop) update((q) => ({ ...q, tutor: addToPlan(q.tutor, [{ stop: lessonStop, why: 'revisit' }], today()) }));
    } else if (a.act === 'similar') {
      const st = similarKey ? stepById(similarKey) : null;
      if (st && similarKey) setItems((list) => list.some((x) => x.key === similarKey) ? list : [...list.slice(0, i + 1), { key: similarKey, step: st, tag: 'One like it' }, ...list.slice(i + 1)]);
    }
  };

  return (
    <>
      <header className="ls-head">
        <button type="button" className="ls-icon-btn" aria-label={`Quit ${noun}`} onClick={() => { sfx('tap'); setQuit(true); }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        <div className="ls-track">
          <div className="ls-bar" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={shownTotal} aria-valuenow={finished}>
            <div className="ls-fill" style={{ width: `${(finished / shownTotal) * 100}%` }}><span className="ls-gloss" aria-hidden="true" /></div>
          </div>
        </div>
        <p className="ls-count">{i + 1}/{shownTotal}</p>
        <FlagButton className="ls-icon-btn ls-flag-top" onClick={() => { sfx('tap'); setReport(true); }} />
      </header>

      {S.pid && passageOf(S.pid) ? <PassagePanel p={passageOf(S.pid)!} key={'p-' + S.pid} bottom={sheetH} /> : null}
      {/* the whole screen takes the answer's color: a frame and a glow above the sheet (green right, amber not yet) */}
      <div className={'lv-state' + (checked && graded ? (right ? ' is-right' : ' is-wrong') : '')} aria-hidden="true" />
      {burst ? <p className="lv-burst fx-popA" key={'b' + burst} aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="var(--accent)" stroke="var(--accent-ink)" strokeWidth="1.6" strokeLinejoin="round"><path d={FLAME} /></svg>
        {burst} in a row!
      </p> : null}
      <div ref={mainRef} className={'pa-body ls-main lv-main' + (S.stage === 'boss' ? ' is-boss' : '') + (S.pid && passageOf(S.pid) ? ' has-passage' : '') + (visualStep(S) ? ' is-visual' : '') + (checked ? ' is-checked' : '')} key={key}
        {...(mainScrolls ? { tabIndex: 0, role: 'region', 'aria-label': 'Question (scrolls)' } : {})}>
        {S.stage === 'boss' ? <BossBar /> : null}
        <div className="lv-chips fx-fadeupA">
          <p className={'ls-chip lv-stage-' + S.stage + (items[i].tag ? ' lv-tag' : '')}>{items[i].tag || MODE[run.mode].chip || STAGE_LABEL[S.stage]}</p>
          {S.kind !== 'learn' && S.kind !== 'reflect' && S.kind !== 'rate' && chipOf(S) ? <p className="lv-format">{chipOf(S)}</p> : null}
        </div>
        {S.box ? <div className="lv-box-text" role="group" aria-label="The sentence" dangerouslySetInnerHTML={{ __html: boxHtml(S.box) }} /> : null}
        {S.kind === 'learn' ? <h1 ref={promptRef} tabIndex={-1} className="ls-prompt lv-learn-title">{S.title}</h1> : (
          S.html
            ? <h1 ref={promptRef} tabIndex={-1} className="ls-prompt" dangerouslySetInnerHTML={{ __html: S.prompt }} />
            : <h1 ref={promptRef} tabIndex={-1} className="ls-prompt">{S.prompt}</h1>
        )}
        {S.fig ? <div className="lv-fig" dangerouslySetInnerHTML={{ __html: S.fig }} /> : null}
        {S.tbl ? (
          <div className="lv-tbl" tabIndex={0} role="region" aria-label={S.tbl.caption || 'Table'}><table>
            {S.tbl.caption ? <caption>{S.tbl.caption}</caption> : null}
            <thead><tr>{S.tbl.cols.map((c, k) => <th key={k} scope="col">{c}</th>)}</tr></thead>
            <tbody>{S.tbl.rows.map((r, ri) => <tr key={ri}>{r.map((c, k) => <td key={k}>{c}</td>)}</tr>)}</tbody>
          </table></div>
        ) : null}
        <Activity s={S} a={ans} set={setAns} checked={checked} elim={elim} />
        {/* always in the page, so the hint is read out when it fills in */}
        <div id="lv-hint" aria-live="polite">{hintsShown && hint && !checked ? (
          // the pack's reviewed hints, said by the mascot one at a time
          <div className="ta lv-pip-hints"><div className="ta-reply">
            {pipEnabled() ? <span className="ta-face"><MascotFace size={34} /></span> : null}
            <div className="ta-bubble lv-hints">
              {hintsShown > 1 ? (
                <details className="lv-hints-old"><summary>Earlier hint{hintsShown > 2 ? 's' : ''} ({hintsShown - 1})</summary>
                  <ol>{hint.slice(0, hintsShown - 1).map((h, k) => <li key={k} className="lv-hint"><b>Hint {k + 1}:</b> {h}</li>)}</ol>
                </details>
              ) : null}
              <p className="lv-hint fx-fadeup" key={hintsShown}><b>Hint {hintsShown}:</b> {hint[hintsShown - 1]}</p>
            </div>
          </div></div>
        ) : null}
        {pipHint && tStep && !checked ? <PipHint key={key} item={S.id} step={{ ...tStep, chosen: undefined, note: undefined }} ctx={tCtx} onAction={pipAct} similarOk={!!similarKey} /> : null}</div>
        {TEST_MODES.has(run.mode) && i === items.findIndex((x) => x.step.kind !== 'rate') && !checked ? <p className="lv-testnote">Like the real test: no hints here. Do your best on each one.</p> : null}
      </div>

      {S.kind === 'rate' ? (
        <footer className="ls-foot lv-rate-foot" role="group" aria-label="Could you solve it?">
          {['No', 'Maybe', 'Yes'].map((t, v) => <button key={t} type="button" className="lv-rate-btn press" onClick={() => rate(v)}>{t}</button>)}
        </footer>
      ) : S.kind === 'learn' ? (
        <footer className="ls-foot lv-foot">
          <button type="button" className="pa-btn ghost press lv-skip" onClick={skipLearn}>I know this</button>
          {ans.kind === 'learn' && ans.shown < S.lines.length
            ? <button type="button" className="ls-cta press" onClick={() => { sfx('tap'); setAns({ ...ans, shown: ans.shown + 1 }); }}>Show more</button>
            : <button type="button" className="ls-cta press" onClick={skipLearn}>{isLast ? 'Finish level' : 'Continue'}</button>}
        </footer>
      ) : S.kind === 'sprint' && !checked ? (
        <footer className="ls-foot">
          <button type="button" className="ls-cta press" disabled={!canCheck} onClick={check}>See my score</button>
        </footer>
      ) : !checked ? (
        <footer className="ls-foot lv-foot">
          {(S.kind === 'mc' && graded) || hint || pipBefore ? (
            <div className="ls-tools">
              {S.kind === 'mc' && graded ? (
                <button type="button" className={'ls-tool' + (elim ? ' on' : '')} aria-pressed={elim} onClick={() => { sfx('tap'); setElim((v) => !v); }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 12h16" /><path d="M7 7h10M7 17h6" /></svg>
                  {elim ? 'Eliminate: on' : 'Eliminate'}
                </button>
              ) : null}
              {hint ? (() => {
                // One button: the reviewed hints one by one (the last one may cross out a wrong choice). With the tutor on it is
                // the mascot's button ("Ask Pip"), and once the reviewed hints are used up, one more tap asks the AI tutor once.
                const more = hintsShown >= hint.length;
                const done = more && (!pipBefore || pipHint);
                const hintIcon = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" /></svg>;
                return pipEnabled() ? (
                  <button type="button" className={'ls-tool lv-pip-tool' + (hintsShown ? ' on' : '')} aria-controls="lv-hint" disabled={done}
                    onClick={() => { if (!more) openHint(); else { sfx('tap'); setPipHint(true); } }}
                    aria-label={done ? 'No more hints' : more ? `Ask ${mascotName} for more help` : `Ask ${mascotName}: hint ${hintsShown + 1} of ${hint.length}`}>
                    <span className="lv-pip-face" aria-hidden="true"><MascotFace size={22} /></span>
                    {more && pipBefore ? `Ask ${mascotName} for more` : hint.length > 1 ? `Ask ${mascotName} ${Math.min(hintsShown + 1, hint.length)}/${hint.length}` : `Ask ${mascotName}`}
                  </button>
                ) : (
                  <button type="button" className={'ls-tool' + (hintsShown ? ' on' : '')} aria-controls="lv-hint" disabled={more}
                    onClick={openHint} aria-label={more ? 'No more hints' : `Hint ${hintsShown + 1} of ${hint.length}`}>
                    {hintIcon}
                    {hint.length > 1 ? `Hint ${Math.min(hintsShown + 1, hint.length)}/${hint.length}` : 'Hint'}
                  </button>
                );
              })() : null}
            </div>
          ) : null}
          <button type="button" className={'ls-cta press' + (canCheck ? ' fx-pop' : '')} disabled={!canCheck} onClick={check}>Check</button>
        </footer>
      ) : null}

      <div role="status" aria-live="polite" className="ls-live">
        {checked ? (
          <footer ref={sheetRef} className={'ls-sheet lv-sheet fx-slideup ' + (right ? 'ok' : 'no') + (sheetOpen ? '' : ' is-folded')}>
            <div className="lv-sheet-top"
              onPointerDown={(e) => { dragY.current = e.clientY; }}
              onPointerUp={(e) => { if (dragY.current !== null && Math.abs(e.clientY - dragY.current) > 24) setSheetOpen(e.clientY < dragY.current); dragY.current = null; }}>
              <span className={'lv-verdict-icon fx-popA ' + (right || !graded ? 'ok' : 'no')} aria-hidden="true">
                {right || !graded
                  ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                  : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" /></svg>}
              </span>
              <p className={right ? 'ls-verdict' : 'ls-nq'}>{!graded ? verdictFor(S, ans) : right ? 'Correct!' : 'Not quite.'}</p>
              {graded && right && saving && run.mode !== 'placement' && !(run.mode === 'lesson' && isReplay) ? <span className="lv-xp fx-popA">+{XP_STEP} XP</span> : null}
              {tStep ? (
                <button type="button" className="lv-pip-btn press" aria-label={`Ask ${mascotName}, your tutor`} onClick={() => { sfx('tap'); setSheetOpen(true); setAskN((n) => n + 1); }}>
                  <span className="lv-pip-face" aria-hidden="true"><MascotFace size={24} /></span><span className="lv-pip-t">Ask {mascotName}</span>
                </button>
              ) : null}
              <button type="button" className={'lv-why' + (sheetOpen ? ' on' : '')} aria-expanded={sheetOpen} aria-controls="lv-sheet-body"
                onClick={() => { sfx('tap'); if (!sheetOpen && right && graded) whys.current += 1; setSheetOpen((v) => !v); }}>
                {sheetOpen ? 'Hide' : right ? 'Why?' : 'Explain'}
              </button>
            </div>
            <div className="lv-sheet-body" id="lv-sheet-body" hidden={!sheetOpen}>
              {graded && !right && S.kind === 'mc' ? <p className="lv-rightis"><b>Correct answer: {LETTERS[S.ans]}</b></p> : null}
              {wrongNote(S, ans, right) ? <p className="lv-wrong"><b>Why not that one:</b> {wrongNote(S, ans, right)}</p> : null}
              <Explain key={key} text={explainFor(S, ans, right)} />
              {graded && !right && run.mode !== 'demo' && run.mode !== 'placement' ? <p className="ls-saved lv-saved">{run.mode === 'review' ? 'Still in Review' : 'Saved to Review'}</p> : null}
              {tStep ? (
                <TutorAsk key={key} item={S.id} step={tStep} right={right} explanation={explainFor(S, ans, right)} askN={askN} ctx={tCtx} onAction={pipAct} similarOk={!!similarKey} />
              ) : null}
              <FlagButton className="ls-flag" onClick={() => { sfx('tap'); setReport(true); }} />
            </div>
            <button type="button" ref={nextRef} className="ls-cta green press" onClick={next}>{isLast ? endLabel : right || !graded ? 'Continue' : 'Got it'}</button>
          </footer>
        ) : null}
      </div>

      {report ? (
        // No free text (COPPA): the stop, the step number and kind, and the answer the student gave.
        <ReportSheet kind="question" qid={S.id} rev={S.rev} onClose={() => setReport(false)}
          ctx={{ lesson: run.id, pos: i + 1, total, picked: null, checked, correct: checked && graded ? right : null, step: { index: i + 1, kind: S.kind, stage: S.stage }, answer: answerOf(ans) } as unknown as QuestionContext} />
      ) : null}

      {quit ? (
        <Sheet label={`Leave this ${noun}?`} onClose={() => setQuit(false)}>
          <h2 className="pa-sheet-title">Leave this {noun}?</h2>
          <p className="pa-sheet-sub">
            {!saving ? 'Sample levels don’t save your place. You can start again any time.'
              : answers.current.length > 0 ? `Your place is saved. Pick up at step ${answers.current.length + 1} from Home or the map.` : 'You can start it again any time.'}
          </p>
          <div className="ls-quit">
            <button type="button" className="pa-btn green press" onClick={() => { sfx('tap'); setQuit(false); }}>Keep going</button>
            <button type="button" className="pa-btn ghost press" onClick={() => { sfx('tap'); go(back); }}>Leave</button>
          </div>
        </Sheet>
      ) : null}
    </>
  );
}

/** The answer on screen as plain data for a report (choice indexes, typed numbers, placed tiles); never free text. */
function answerOf(a: Ans): unknown {
  const { kind, ...rest } = a as Ans & Record<string, unknown>;
  const out: Record<string, unknown> = { kind };
  for (const [k, v] of Object.entries(rest)) if (typeof v === 'number' || typeof v === 'boolean' || v === null || Array.isArray(v) || (typeof v === 'string' && v.length <= 24)) out[k] = v;
  return out;
}

/** The passage of an ELA step, as on the test: title, intro, numbered paragraphs (Part A passages carry their
    numbered sentences in the text), poems with every line numbered from 1 and every fifth number shown.
    On a wide screen it sits beside the question; on a phone it folds behind "Read the passage". */
export function PassagePanel({ p, bottom = 0 }: { p: BankPassage; bottom?: number }) {
  const [open, setOpen] = useState(false);
  const poem = p.genre === 'poem';
  let line = 0;
  const paras = p.paras || [];
  return (
    <aside className={'lv-passage' + (open ? ' open' : '')} style={bottom ? ({ '--lv-bottom': `${bottom + 8}px` } as CSSProperties) : undefined} aria-label={p.title ? `Passage: ${p.title}` : 'Passage'}>
      <button type="button" className="lv-passage-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide the passage' : 'Read the passage'}
      </button>
      <div className="lv-passage-body" tabIndex={0} role="region" aria-label={p.title ? `Passage text: ${p.title}` : 'Passage text'}>
        {p.title ? <h2 className="lv-passage-title">{p.title}</h2> : null}
        {p.intro ? <p className="lv-passage-intro"><i>{p.intro}</i></p> : null}
        {poem
          ? paras.map((st, si) => (
            <div key={si} className="lv-stanza">
              {st.split('\n').map((ln, li) => { line += 1; return (
                <div key={li} className="lv-line"><span className="lv-ln" aria-hidden={line % 5 !== 0}>{line % 5 === 0 ? line : ''}</span><span>{ln}</span></div>
              ); })}
            </div>
          ))
          : paras.map((t, k) => (
            <div key={k}>
              <p className="lv-para">{p.kind === 'ra' ? null : <span className="lv-pn">{k + 1}</span>}<span>{t}</span></p>
              {p.tbl && p.tblAfter === k + 1 ? (
                <div className="lv-tbl" tabIndex={0} role="region" aria-label={p.tbl.caption || 'Table'}><table>
                  {p.tbl.caption ? <caption>{p.tbl.caption}</caption> : null}
                  <thead><tr>{p.tbl.cols.map((c, j) => <th key={j} scope="col">{c}</th>)}</tr></thead>
                  <tbody>{p.tbl.rows.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
                </table></div>
              ) : null}
            </div>
          ))}
        {p.src ? <p className="lv-passage-src">{p.src}</p> : null}
      </div>
    </aside>
  );
}

/** What the chip above a step says (student words; the test's own type names where they are real). */
export function chipOf(s: Step): string | null {
  if (s.kind === 'mistake') return null;               // the stage chip already says "Find the mistake"
  return CHIP[s.kind] ?? FORMAT[s.kind];
}

/** The Part B sentence box: text is escaped, [u]..[/u] is underlined (as in the test engine). */
export function boxHtml(t: string): string {
  const esc = t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<p>${esc.replace(/\[u\]/g, '<u>').replace(/\[\/u\]/g, '</u>')}</p>`;
}

/** Explanations written for the drag-in blanks say "box 0": the student sees blanks, not numbered boxes. */
const ORD = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];
const BLANKS = new Set(['fill', 'inline', 'tiles']);
export const plainExp = (t: string, s?: Step) => !s || !BLANKS.has(s.kind) ? t : t.replace(/\bbox (\d)\b/gi, (_, n: string) => `the ${ORD[+n] ?? 'next'} blank`).replace(/\bthe the\b/gi, 'the').replace(/\bboxes\b/gi, 'blanks');

const short = (line: string) => (line.length > 160 ? line.slice(0, 157).replace(/\s+\S*$/, '') + '…' : line);
/** How to attack a step of this kind when it has no hint of its own (our own wording). */
const STRATEGY: Partial<Record<Step['kind'], string>> = {
  mc: 'Work it out before you look at the choices, then find the choice that matches.',
  typed: 'Write down what you know and what you need. Then find the rule that links them.',
  multi: 'Check each choice on its own: is it true or not? More than one can be right.',
  inline: 'Read the whole sentence with each choice in place, then pick the one that fits.',
  fill: 'Start with the blank you are most sure about, then fill the rest.',
  classify: 'Sort the easy cards first. The last few are easier once the rest are sorted.',
  numline: 'Find the number first. Then pick an open or closed circle, and the way the arrow points.',
  hot: 'Look for the sentence that does exactly what the question asks, not just one on the topic.',
  plot: 'Find each point by going across first (x), then up or down (y).',
};
/** The hint ladder for a step. 1: a nudge (its own hint, else the Learn card's first line).
    2: the idea (the Learn card's next line, else a strategy for this kind of step). 3: multiple choice only, one wrong
    choice crossed out. It never shows the answer. */
/** The hint ladder of a step: the question's own hint first; a general line of the lesson (its learn card, else the
    strategy for this kind of step) only when the question has none, and only one not shown yet this round, marked as a
    reminder (otherwise the same definition came up on every question, fitting few of them); on multiple
    choice, a last rung that crosses out one wrong answer with its "why not" note. `generic` lists the general rungs. */
function hintsFor(s: Step, key: string, seen: Set<string>): { list: string[]; generic: Set<string> } {
  const learn = LEVEL_OF[key.split('/')[0]]?.steps.find((x): x is LearnStep => x.kind === 'learn');
  const list: string[] = [], generic = new Set<string>();
  if (s.hint) list.push(short(s.hint));
  else {
    const pool = [...(s.stage !== 'guided' ? learn?.lines ?? [] : []), STRATEGY[s.kind]].filter((x): x is string => !!x).map((l) => `Remember: ${short(l)}`);
    const fresh = pool.find((l) => !seen.has(l));
    if (fresh) { list.push(fresh); generic.add(fresh); }
  }
  if (s.kind === 'mc') {
    const k = elimChoice(s);
    if (k !== null) list.push(`It’s not choice ${LETTERS[k]}.${s.wrongWhy?.[k] ? ' ' + s.wrongWhy[k] : ''}`);
  }
  return { list, generic };
}
/** The wrong choice the last hint crosses out: the first one with a "why not" note, else the first wrong one. */
function elimChoice(s: McStep): number | null {
  const wrong = s.opts.map((_, k) => k).filter((k) => k !== s.ans);
  return wrong.find((k) => s.wrongWhy?.[k]) ?? wrong[0] ?? null;
}

/** The explanation on the answer sheet, short first (too much text at once is hard to read): its first sentence, and
    the rest behind "Show the full explanation" when there is more than a line or two. A decimal point (2.15) is not the
    end of a sentence. */
function Explain({ text }: { text: string }) {
  const [more, setMore] = useState(false);
  const cut = text.search(/[.!?](?=\s+[A-Z0-9(“"])/);
  const first = cut > 0 ? text.slice(0, cut + 1) : text, rest = cut > 0 ? text.slice(cut + 1).trim() : '';
  const long = rest.split(/\s+/).length > 8;
  if (!long) return <p className="ls-explain">{text}</p>;
  return (
    <div className="lv-explain">
      <p className="ls-explain">{first}{more ? <> {rest}</> : null}</p>
      <button type="button" className="lv-more" aria-expanded={more} onClick={() => setMore((m) => !m)}>{more ? 'Show less' : 'Show the full explanation'}</button>
    </div>
  );
}

/** After a wrong multiple-choice answer: why that choice is wrong, when the bank has it. */
function wrongNote(s: Step, a: Ans, right: boolean): string | null {
  if (right || s.kind !== 'mc' || a.kind !== 'mc' || a.v === null) return null;
  return s.wrongWhy?.[a.v] || null;
}

function verdictFor(s: Step, a: Ans): string {
  if (s.kind === 'reflect') return 'Good to know';
  if (s.kind === 'estimate' && a.kind === 'estimate' && a.v !== null) return Math.abs(a.v - s.answer) <= s.close ? 'Great estimate!' : 'Here’s the real answer';
  if (s.kind === 'sprint' && a.kind === 'sprint') return `${a.right} of ${a.tried} right`;
  return 'Here’s the idea';
}

function explainFor(s: Step, a: Ans, right: boolean): string {
  if (s.kind === 'reflect' && a.kind === 'reflect' && a.v !== null) return s.tips[a.v];
  if (s.kind === 'estimate' && a.kind === 'estimate') return `You guessed ${s.prefix || ''}${a.v}${s.suffix || ''}. The answer is ${s.prefix || ''}${s.answer}${s.suffix || ''}. ${s.exp}`;
  if (s.kind === 'mc' && !right && a.kind === 'mc' && a.v !== null && s.why?.[a.v] && !s.wrongWhy?.[a.v]) return plainExp(`${s.why[a.v]} ${s.exp}`, s);
  return plainExp(s.exp, s);
}

function BossBar() {
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setT((x) => x + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  const mmss = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
  return (
    <div className="lv-boss" role="note">
      <span className="lv-boss-tag">Test mode</span>
      <span className="lv-boss-text">Like the real test.</span>
      <span className={'lv-boss-clock' + (t > PACE_S ? ' is-over' : '')} role="timer"><span className="sr">Time </span>{mmss(t)} <small><span aria-hidden="true">/ aim </span><span className="sr">, aim for </span>{mmss(PACE_S)}</small></span>
    </div>
  );
}

// ---------------------------------------------------------------- activities

type ActProps<S extends Step> = { s: S; a: Ans; set: (a: Ans) => void; checked: boolean; elim?: boolean };

export function Activity(p: { s: Step; a: Ans; set: (a: Ans) => void; checked: boolean; elim: boolean }) {
  const { s } = p;
  switch (s.kind) {
    case 'estimate': return <Estimate {...p} s={s} />;
    case 'learn': return <Learn {...p} s={s} />;
    case 'fill': return <Fill {...p} s={s} />;
    case 'table': return <Table {...p} s={s} />;
    case 'mc': return <Mc {...p} s={s} />;
    case 'classify': return <Classify {...p} s={s} />;
    case 'typed': return <Typed {...p} s={s} />;
    case 'sprint': return <Sprint {...p} s={s} />;
    case 'mistake': return <Mistake {...p} s={s} />;
    case 'order': return <Order {...p} s={s} />;
    case 'hot': return <Hot {...p} s={s} />;
    case 'inline': return <Inline {...p} s={s} />;
    case 'multi': return <Multi {...p} s={s} />;
    case 'numline': return <NumberLine {...p} s={s} />;
    case 'plot': return <PlotGrid {...p} s={s} />;
    case 'spot': return <SpotGrid {...p} s={s} />;
    case 'transform': return <TransformGrid {...p} s={s} />;
    case 'solset': return <SolutionSet {...p} s={s} />;
    case 'reflect': return <Reflect {...p} s={s} />;
    case 'rate': return <RatePreview s={s} />;
  }
}

/** Steps where a picture or a hands-on activity carries the question: the prompt steps back (smaller) and the activity
    sits in the middle of the screen. */
const VISUAL = new Set<Step['kind']>(['estimate', 'fill', 'table', 'classify', 'order', 'numline', 'plot', 'spot', 'transform', 'solset', 'inline']);
const visualStep = (s: Step) => !s.pid && (VISUAL.has(s.kind) || !!s.fig || !!s.tbl);
/** Short choices sit two by two, like a keypad; long ones, passages and "Paragraph A" answers stay one per row. */
export const gridChoices = (opts: string[], long?: boolean) => !long && (opts.length === 4 || opts.length === 2) && opts.every((o) => o.length <= 22);

/** A typed answer is sent to the tutor only when it is a number (digits and math signs, 24 characters at most): a box a child
    could type a name into never reaches the model. */
const numericOnly = (v: string) => { const t = v.trim(); return t.length <= 24 && /^[\d\s.,/%$()\-−+]+$/.test(t) ? t : undefined; };

/** What the AI tutor gets to see of a step (TutorAsk.tsx), or null when it has no one short answer to talk about. */
function tutorStep(s: Step, a: Ans): TutorStep | null {
  const answer = answerText(s);
  if (!answer) return null;
  const opts = s.kind === 'mc' || s.kind === 'multi' ? s.opts.map((o) => plainText(o)) : undefined;
  const chosen = s.kind === 'mc' && a.kind === 'mc' && a.v !== null ? `${LETTERS[a.v]}. ${plainText(s.opts[a.v])}`
    : s.kind === 'typed' && a.kind === 'typed' ? numericOnly(a.v)
    : s.kind === 'numline' && a.kind === 'numline' && a.value !== null ? String(a.value) : undefined;
  const pas = s.kind === 'mc' && s.passage ? s.passage.sentences.map((t, k) => `(${k + 1}) ${t}`).join(' ') : undefined;
  const note = s.kind === 'mc' && a.kind === 'mc' && a.v !== null ? s.wrongWhy?.[a.v] || undefined : undefined;
  return { stem: plainText(s.prompt), answer: plainText(answer), ...(opts ? { opts } : {}), ...(chosen ? { chosen } : {}), exp: plainText(s.exp || ''), ...(note ? { note } : {}), ...(pas ? { passage: plainText(pas) } : {}) };
}

function answerText(s: Step): string | null {
  switch (s.kind) {
    case 'mc': return `${LETTERS[s.ans]}. ${s.opts[s.ans]}`;
    case 'multi': return s.ans.map((k) => `${LETTERS[k]}. ${s.opts[k]}`).join('; ');
    case 'typed': return `${s.prefix || ''}${s.answer}${s.suffix || ''}`;
    case 'hot': return s.sentences[s.ans];
    case 'inline': return (s.parts.filter((x) => typeof x !== 'string') as { choices: string[]; ans: number }[]).map((m) => m.choices[m.ans]).join(' / ');
    case 'numline': return String(s.answer.value);
    default: return null;
  }
}

/** A placement self-rating: the question as a picture (nothing to tap), so the student can say if they could solve it. */
function RatePreview({ s }: { s: RateStep }) {
  const o = s.of;
  const opts = o.kind === 'mc' || o.kind === 'multi' ? o.opts : null;
  return (
    <div className="lv-ratecard" aria-label="The question">
      {o.box ? <div className="lv-box-text" dangerouslySetInnerHTML={{ __html: boxHtml(o.box) }} /> : null}
      {o.html ? <p className="lv-ratecard-q" dangerouslySetInnerHTML={{ __html: o.prompt }} /> : <p className="lv-ratecard-q">{o.prompt}</p>}
      {o.fig ? <div className="lv-fig" dangerouslySetInnerHTML={{ __html: o.fig }} /> : null}
      {opts ? <ol className="lv-ratecard-opts">{opts.map((t, k) => <li key={k}><span>{LETTERS[k]}</span>{t}</li>)}</ol> : null}
      <p className="lv-ratecard-note">No need to solve it. Just say if you could.</p>
    </div>
  );
}

/** Guided review: the missed question again with its answer and why, then "what tripped you up?" (choices only). */
function Reflect({ s, a, set, checked }: ActProps<ReflectStep>) {
  const { sfx } = useApp();
  if (a.kind !== 'reflect') return null;
  const o = s.of, ans = answerText(o);
  return (
    <>
      <div className="lv-lookback">
        <p className="lv-lookback-label">The question you missed</p>
        {o.box ? <div className="lv-box-text" dangerouslySetInnerHTML={{ __html: boxHtml(o.box) }} /> : null}
        {o.html ? <p className="lv-lookback-q" dangerouslySetInnerHTML={{ __html: o.prompt }} /> : <p className="lv-lookback-q">{o.prompt}</p>}
        {o.fig ? <div className="lv-fig" dangerouslySetInnerHTML={{ __html: o.fig }} /> : null}
        {ans ? <p className="lv-lookback-ans"><b>Answer:</b> {ans}</p> : null}
        <p className="lv-lookback-why">{plainExp(o.exp, o)}</p>
      </div>
      <div className="ls-choices lv-reflect" role="group" aria-label="What tripped you up?">
        {s.opts.map((t, k) => (
          <button key={k} type="button" aria-pressed={a.v === k} aria-disabled={checked}
            className={'ls-choice press' + (a.v === k ? ' is-picked' : '') + (checked ? ' is-locked' : '')}
            onClick={() => { if (!checked) { set({ kind: 'reflect', v: k }); sfx('tap'); } }}>
            <span className="ls-opt">{t}</span>
          </button>
        ))}
      </div>
    </>
  );
}

/** Choose all the right answers (Multiple Response). The prompt and a counter say how many. */
function Multi({ s, a, set, checked }: ActProps<MultiStep>) {
  const { sfx } = useApp();
  if (a.kind !== 'multi') return null;
  const need = s.ans.length;
  const tap = (k: number) => {
    if (checked) return;
    const on = a.v.includes(k);
    if (!on && a.v.length >= need) { sfx('wrong'); return; }
    set({ kind: 'multi', v: on ? a.v.filter((x) => x !== k) : [...a.v, k] });
    sfx('tap');
  };
  return (
    <>
      <p className="lv-note lv-multi-count" aria-live="polite">Choose {need}. Chosen: {a.v.length} of {need}</p>
      <div className={'ls-choices' + (!s.pid && gridChoices(s.opts) ? ' is-grid' : '') + (checked ? ' is-checked' : '')} role="group" aria-label="Answer choices">
        {s.opts.map((t, k) => {
          const on = a.v.includes(k);
          const isAns = checked && s.ans.includes(k);
          const isNo = checked && on && !s.ans.includes(k);
          return (
            <button key={k} type="button" aria-pressed={on} aria-disabled={checked}
              className={'ls-choice press lv-multi' + (isAns ? ' is-right' : isNo ? ' is-wrong' : on ? ' is-picked' : '') + (checked ? ' is-locked' : '')} onClick={() => tap(k)}>
              <span className="lv-box" aria-hidden="true">{on || isAns ? '✓' : ''}</span>
              <span className="ls-opt">{t}</span>
              {isAns ? <RowMark ok /> : isNo ? <RowMark ok={false} /> : null}
            </button>
          );
        })}
      </div>
    </>
  );
}

function Estimate({ s, a, set, checked }: ActProps<EstimateStep>) {
  const { sfx } = useApp();
  if (a.kind !== 'estimate') return null;
  const v = a.v ?? Math.round((s.min + s.max) / 2 / s.step) * s.step;
  const pct = (x: number) => ((x - s.min) / (s.max - s.min)) * 100;
  return (
    <div className="lv-est">
      <p className="lv-est-val" aria-hidden="true">{s.prefix}{v}{s.suffix}</p>
      <div className="lv-est-track">
        <input type="range" min={s.min} max={s.max} step={s.step} value={v} disabled={checked}
          aria-label="Your guess" aria-valuetext={`${s.prefix || ''}${v}${s.suffix || ''}`}
          onChange={(e) => set({ kind: 'estimate', v: +e.target.value })} onPointerDown={() => a.v === null && sfx('tap')} />
        {checked ? <span className="lv-est-real fx-pop" style={{ left: `${pct(s.answer)}%` }}>{s.prefix}{s.answer}{s.suffix}</span> : null}
      </div>
      <div className="lv-est-ends" aria-hidden="true"><span>{s.prefix}{s.min}</span><span>{s.prefix}{s.max}</span></div>
      {a.v === null ? <p className="lv-note">Move the slider to make your guess.</p> : null}
      {checked && a.v !== null && Math.abs(a.v - s.answer) > s.close ? (
        <p className="lv-run">Your guess: {s.prefix}{a.v}{s.suffix}. The answer: {s.prefix}{s.answer}{s.suffix}, {s.prefix}{Math.abs(+(s.answer - a.v).toFixed(4))}{s.suffix} {s.answer > a.v ? 'more' : 'less'} than your guess.</p>
      ) : null}
    </div>
  );
}

function Learn({ s, a, set }: ActProps<LearnStep>) {
  const { sfx } = useApp();
  if (a.kind !== 'learn') return null;
  const vis = s.visual;
  return (
    <div className="lv-learn">
      {vis ? (
        <div className="lv-bar-wrap">
          <p className="lv-note">{s.prompt}</p>
          <div className="lv-bar" role="group" aria-label="The price in 4 equal parts">
            {Array.from({ length: vis.parts }, (_, k) => {
              const off = k < a.bar;
              return (
                <button key={k} type="button" className={'lv-bar-part press' + (off ? ' is-off' : '')} aria-pressed={off}
                  onClick={() => { sfx('tap'); set({ ...a, bar: off ? k : k + 1 }); }}>
                  <span>{vis.prefix}{vis.each}</span><small>{100 / vis.parts}%</small>
                </button>
              );
            })}
          </div>
          <p className="lv-bar-say" aria-live="polite">
            {a.bar === 0 ? `Full price: ${vis.prefix}${vis.parts * vis.each}` : `${a.bar * (100 / vis.parts)}% off → you pay ${100 - a.bar * (100 / vis.parts)}% = ${vis.prefix}${(vis.parts - a.bar) * vis.each}`}
          </p>
        </div>
      ) : null}
      <ol className="lv-learn-lines">
        {s.lines.slice(0, a.shown).map((t, k) => <li key={k} className="fx-fadeupA">{t}</li>)}
      </ol>
    </div>
  );
}

/** Tap a tile, then tap a blank (or drag the tile with a mouse). Tap a filled blank to empty it. */
function Fill({ s, a, set, checked }: ActProps<FillStep>) {
  const { sfx } = useApp();
  const [held, setHeld] = useState<number | null>(null);
  if (a.kind !== 'fill') return null;
  const used = new Set(a.v.filter((x) => x !== null) as number[]);
  const put = (blankIx: number, tile: number) => {
    const v = a.v.map((x) => (x === tile ? null : x));
    v[blankIx] = tile;
    set({ kind: 'fill', v });
    setHeld(null);
    sfx('tap');
    // the tile is used up (and may be gone): carry on with the next tile, or Check when every blank is filled
    focusSoon('.lv-tiles button:not(:disabled)', '.ls-foot .ls-cta:not(:disabled)', '.lv-slot');
  };
  const tapTile = (t: number) => {
    if (checked) return;
    if (a.v.length === 1) { put(0, t); return; }               // one blank: a tap places it
    setHeld((h) => (h === t ? null : t));
    sfx('tap');
    // a tile is held: go to the first empty blank, so the next key press places it
    if (held !== t) focusSoon('.lv-slot:not(.is-full)', '.lv-slot');
  };
  const tapBlank = (b: number) => {
    if (checked) return;
    if (held !== null) { put(b, held); return; }
    if (a.v[b] !== null) { const v = a.v.slice(); v[b] = null; set({ kind: 'fill', v }); sfx('tap'); }
  };
  const onDrop = (b: number) => (e: DragEvent) => { e.preventDefault(); const t = +e.dataTransfer.getData('text/plain'); if (!Number.isNaN(t)) put(b, t); };
  return (
    <div className={'lv-fill' + (s.block ? ' is-block' : '')}>
      <p className="lv-fill-text">
        {s.parts.map((part, k) => {
          if (part === '\n') return <br key={k} />; // a new line of the question (bank items)
          if (typeof part === 'string') return <span key={k}>{part}</span>;
          const t = a.v[part];
          const ok = checked && t === s.answers[part];
          return (
            <button key={k} type="button" className={'lv-slot' + (t !== null ? ' is-full' : '') + (checked ? (ok ? ' is-right' : ' is-wrong') : '') + (held !== null ? ' is-ready' : '')}
              aria-label={t !== null ? `Blank: ${s.tiles[t]}. Tap to empty it.` : 'Empty blank'}
              onClick={() => tapBlank(part)} onDragOver={(e) => e.preventDefault()} onDrop={onDrop(part)}>
              {t !== null ? s.tiles[t] : ' '}
            </button>
          );
        })}
      </p>
      {checked && !s.answers.every((t, k) => a.v[k] === t) ? (
        <p className="lv-correct">Answer: {s.answers.map((t, k) => (s.answers.length > 1 ? `blank ${k + 1}: ${s.tiles[t]}` : s.tiles[t])).join(' · ')}</p>
      ) : null}
      <div className="lv-tiles" role="group" aria-label="Tiles">
        {s.tiles.map((t, k) => (
          <button key={k} type="button" draggable={!checked && !used.has(k)} aria-pressed={held === k}
            className={'lv-tile press' + (used.has(k) ? ' is-used' : '') + (held === k ? ' is-held' : '')}
            disabled={checked || used.has(k)} onClick={() => tapTile(k)}
            onDragStart={(e) => e.dataTransfer.setData('text/plain', String(k))}>{t}</button>
        ))}
      </div>
    </div>
  );
}

function Table({ s, a, set, checked }: ActProps<TableStep>) {
  if (a.kind !== 'table') return null;
  return (
    <div className="lv-table-wrap">
      <table className="lv-table">
        <thead><tr>{s.head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
        <tbody>
          {s.rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((c, ci) => {
                if (typeof c === 'string') return ci === 0 ? <th key={ci} scope="row">{c}</th> : <td key={ci}>{c}</td>;
                const key = `${ri}-${ci}`;
                const v = a.v[key] || '';
                const ok = checked && num(v) !== null && Math.abs((num(v) as number) - c.answer) < 1e-6;
                return (
                  <td key={ci}>
                    <span className={'lv-cell' + (checked ? (ok ? ' is-right' : ' is-wrong') : '')}>
                      {c.prefix ? <span aria-hidden="true">{c.prefix}</span> : null}
                      <input inputMode="decimal" autoComplete="off" value={v} disabled={checked} aria-label={`${s.head[ci]}, ${r[0]}`}
                        onChange={(e) => set({ kind: 'table', v: { ...a.v, [key]: c.prefix ? e.target.value.replace(c.prefix, '') : e.target.value } })} />
                    </span>
                    {checked && !ok ? <small className="lv-cell-ans">{c.prefix}{c.answer}</small> : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {!checked && tableInputs(s).some((x) => !(a.v[x.key] || '').trim()) ? <p className="lv-note">Fill in every empty box.</p> : null}
    </div>
  );
}

function Passage({ p }: { p: NonNullable<McStep['passage']> }) {
  return (
    <div className="lv-passage">
      {p.title ? <p className="lv-passage-title">{p.title}</p> : null}
      <p>{p.sentences.map((t, k) => <span key={k}><sup>({k + 1})</sup> {t} </span>)}</p>
    </div>
  );
}

/** Tap an answer to choose it. Eliminate (the real test's Answer Eliminator) is a mode: while it is on,
    tapping an answer crosses it out (or brings it back), to rule out answers you know are wrong. Turn it off
    to choose. Choosing a crossed-out answer brings it back. */
function Mc({ s, a, set, checked, elim }: ActProps<McStep>) {
  const { sfx } = useApp();
  if (a.kind !== 'mc') return null;
  const graded = s.graded !== false;
  const tap = (k: number) => {
    if (checked) return;
    if (elim) {
      const on = !a.struck.includes(k);
      set({ kind: 'mc', v: on && a.v === k ? null : a.v, struck: on ? [...a.struck, k] : a.struck.filter((x) => x !== k) });
    } else set({ ...a, v: k, struck: a.struck.filter((x) => x !== k) });
    sfx('tap');
  };
  return (
    <>
      {s.passage ? <Passage p={s.passage} /> : null}
      {elim && !checked ? <p className="lv-elim-on" role="status">Eliminate is on: tap the answers you are sure are wrong to cross them out. Tap Eliminate again to choose your answer.</p> : null}
      <div className={'ls-choices' + (s.long ? ' lv-long' : '') + (elim ? ' is-elim' : '') + (!s.pid && !s.passage && gridChoices(s.opts, s.long) ? ' is-grid' : '') + (checked ? ' is-checked' : '')} role="group" aria-label="Answer choices">
        {s.opts.map((t, k) => {
          const picked = a.v === k;
          const struck = a.struck.includes(k);
          const isAns = checked && k === s.ans;
          const isNo = checked && picked && k !== s.ans && graded;
          const tone = isAns ? ' is-right' : isNo ? ' is-wrong' : picked ? ' is-picked' : '';
          return (
            <button key={k} type="button" aria-pressed={elim ? struck : picked} aria-disabled={checked}
              className={'ls-choice press' + tone + (struck ? ' is-struck' : '') + (checked ? ' is-locked' : '')} onClick={() => tap(k)}>
              <Letter i={k} />
              <span className="ls-opt">{s.long ? <><b className="lv-long-label">Paragraph {LETTERS[k]}</b>{t}</> : t}</span>
              {struck && !checked ? <span className="ls-elim-tag">crossed out</span> : null}
              {isAns && graded ? <RowMark ok /> : isNo ? <RowMark ok={false} /> : null}
            </button>
          );
        })}
      </div>
    </>
  );
}

/** Tap a card, then a bucket. Tap a sorted card to send it back. */
function Classify({ s, a, set, checked }: ActProps<ClassifyStep>) {
  const { sfx } = useApp();
  const [held, setHeld] = useState<number | null>(null);
  if (a.kind !== 'classify') return null;
  const place = (b: number) => {
    if (held === null || checked) return;
    const v = a.v.slice(); v[held] = b; set({ kind: 'classify', v }); setHeld(null); sfx('tap');
    // the card has moved into the box: carry on with the next card, or Check when none is left
    focusSoon('.lv-sort-pool button', '.ls-foot .ls-cta:not(:disabled)', '.lv-bucket-cards button');
  };
  const back = (c: number) => { if (checked) return; const v = a.v.slice(); v[c] = null; set({ kind: 'classify', v }); sfx('tap'); };
  const card = (c: number, inBucket: boolean) => {
    const ok = checked && a.v[c] === s.cards[c].bucket;
    return (
      <button key={c} type="button" draggable={!checked} aria-pressed={held === c}
        className={'lv-card-chip press' + (held === c ? ' is-held' : '') + (checked ? (ok ? ' is-right' : ' is-wrong') : '')}
        onClick={() => (inBucket ? back(c) : (setHeld((h) => (h === c ? null : c)), sfx('tap'), held !== c && focusSoon('.lv-bucket-head:not(:disabled)')))}
        onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(c)); setHeld(c); }}>
        {s.cards[c].text}
        {checked && !ok ? <small> → {s.buckets[s.cards[c].bucket]}</small> : null}
      </button>
    );
  };
  const loose = s.cards.map((_, c) => c).filter((c) => a.v[c] === null);
  return (
    <div className="lv-sort">
      {loose.length ? <div className="lv-sort-pool" role="group" aria-label="Cards to sort">{loose.map((c) => card(c, false))}</div> : null}
      {held !== null ? <p className="lv-note">Now tap a box to put the card in it.</p> : loose.length ? <p className="lv-note">Tap a card, then tap a box.</p> : null}
      <div className="lv-buckets">
        {s.buckets.map((b, bi) => (
          <div key={bi} className={'lv-bucket' + (held !== null ? ' is-ready' : '')} onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const c = +e.dataTransfer.getData('text/plain'); if (!Number.isNaN(c)) { const v = a.v.slice(); v[c] = bi; set({ kind: 'classify', v }); setHeld(null); } }}>
            <button type="button" className="lv-bucket-head" onClick={() => place(bi)} disabled={held === null || checked}>{b}</button>
            <div className="lv-bucket-cards">{s.cards.map((_, c) => c).filter((c) => a.v[c] === bi).map((c) => card(c, true))}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A fraction or mixed-number answer: the keypad adds a space key (for "3 1/2"), next to "/". */
const fractionLike = (s: TypedStep) => /fraction|mixed number|\d\s*\/\s*\d|[¼½¾⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/i.test(s.prompt) || Math.abs(s.answer * 100 - Math.round(s.answer * 100)) > 1e-6;

function Typed({ s, a, set, checked }: ActProps<TypedStep>) {
  if (a.kind !== 'typed') return null;
  const frac = fractionLike(s);
  const ok = checked && num(a.v) !== null && Math.abs((num(a.v) as number) - s.answer) < 1e-6;
  return (
    <div className="lv-typed">
      <label className={'lv-typed-box' + (checked ? (ok ? ' is-right' : ' is-wrong') : '')}>
        <span className="sr">Your answer</span>
        {s.prefix ? <span aria-hidden="true">{s.prefix}</span> : null}
        <input inputMode="decimal" autoComplete="off" value={a.v} disabled={checked} placeholder="Type your answer"
          onChange={(e) => set({ kind: 'typed', v: e.target.value })} />
        {s.suffix ? <span aria-hidden="true">{s.suffix}</span> : null}
      </label>
      <div className="lv-keys" aria-label="Keys">
        {['/', ...(frac ? ['space'] : []), '.', '−'].map((k) => (
          <button key={k} type="button" className={'lv-key press' + (k === 'space' ? ' lv-key-wide' : '')} disabled={checked}
            aria-label={k === 'space' ? 'Space, for a mixed number like 3 1/2' : k === '/' ? 'Fraction bar' : undefined}
            onClick={() => set({ kind: 'typed', v: a.v + (k === '−' ? '-' : k === 'space' ? ' ' : k) })}>{k}</button>
        ))}
        <button type="button" className="lv-key press" disabled={checked} onClick={() => set({ kind: 'typed', v: a.v.slice(0, -1) })} aria-label="Delete">⌫</button>
      </div>
      {checked && !ok ? (num(a.v) !== null
        ? <p className="lv-run">You wrote {s.prefix}{a.v.trim()}{s.suffix}{/\//.test(a.v) ? ` (= ${+(num(a.v) as number).toFixed(4)})` : ''}, which is too {(num(a.v) as number) < s.answer ? 'small' : 'big'}. The answer: <b>{s.prefix}{s.answer}{s.suffix}</b>.</p>
        : <p className="lv-correct">Answer: {s.prefix}{s.answer}{s.suffix}</p>) : null}
    </div>
  );
}

function Sprint({ s, a, set, checked }: ActProps<SprintStep>) {
  const { sfx, buzz } = useApp();
  const [left, setLeft] = useState(s.seconds);
  const [k, setK] = useState(0);
  const [flash, setFlash] = useState<'ok' | 'no' | null>(null);
  const live = useRef(a);
  live.current = a;
  const bestKey = 'pe.app.sprint.' + s.id;
  const [best] = useState(() => { try { return +(localStorage.getItem(bestKey) || 0); } catch (e) { return 0; } });
  const started = a.kind === 'sprint' && a.started;
  const over = a.kind === 'sprint' && a.done;
  useEffect(() => {
    if (!started || over) return;
    const id = window.setInterval(() => setLeft((x) => x - 1), 1000);
    return () => window.clearInterval(id);
  }, [started, over]);
  useEffect(() => {
    const cur = live.current;
    if (cur.kind === 'sprint' && cur.started && !cur.done && left <= 0) end(cur.right, cur.tried);
    else if (cur.kind === 'sprint' && cur.started && left <= 5 && left > 0) sfx('tick');
  }, [left]); // eslint-disable-line react-hooks/exhaustive-deps
  if (a.kind !== 'sprint') return null;
  function end(r: number, t: number) {
    set({ kind: 'sprint', started: true, done: true, right: r, tried: t });
    focusSoon('.ls-foot .ls-cta:not(:disabled)');   // the answer buttons are gone: move to "See my score"
    try { if (r > best) localStorage.setItem(bestKey, String(r)); } catch (e) { /* private mode */ }
  }
  const answer = (o: number) => {
    const it = s.items[k];
    const ok = o === it.ans;
    const r = a.right + (ok ? 1 : 0), t = a.tried + 1;
    setFlash(ok ? 'ok' : 'no');
    if (ok) sfx('correct'); else { sfx('wrong'); buzz(30); }
    if (k + 1 >= s.items.length) { end(r, t); return; }
    set({ ...a, right: r, tried: t });
    setK(k + 1);
  };
  // What a screen reader hears after each answer: right or not, then the next question (the buttons keep their place).
  const it = s.items[Math.min(k, s.items.length - 1)];
  const say = !started || over || checked ? '' : `${flash === 'ok' ? 'Right. ' : flash === 'no' ? 'Not right. ' : ''}Question ${k + 1} of ${s.items.length}: ${it.q}`;
  const sayEl = <p key="say" className="sr" role="status">{say}</p>;
  if (!started) {
    return (
      <div className="lv-sprint">
        {sayEl}
        <p className="lv-sprint-rule">{s.items.length} quick questions · {s.seconds} seconds · no penalty for wrong answers</p>
        {best ? <p className="lv-note">Your best: {best} right</p> : null}
        <button type="button" className="pa-btn coral press lv-sprint-go" onClick={() => { sfx('go'); set({ ...a, started: true }); focusSoon('.lv-sprint-opt'); }}>Start</button>
      </div>
    );
  }
  if (over || checked) {
    return (
      <div className="lv-sprint">
        {sayEl}
        <p className="lv-sprint-score">{a.right}<small> / {a.tried} right</small></p>
        <p className="lv-note">{a.right > best ? (best ? 'New personal best!' : 'That’s your first score. Beat it next time!') : `Your best: ${best}`}</p>
      </div>
    );
  }
  return (
    <div className="lv-sprint">
      {sayEl}
      <div className="lv-sprint-time" role="timer" aria-label={`${left} seconds left`}><span style={{ width: `${(left / s.seconds) * 100}%` }} /></div>
      <p className="lv-sprint-meta"><span>{left}s</span><span>{a.right} right</span></p>
      <p key={k} className={'lv-sprint-q fx-popA' + (flash ? ' was-' + flash : '')}>{it.q}</p>
      <div className="lv-sprint-opts">
        {it.opts.map((o, j) => <button key={j} type="button" className="lv-sprint-opt press" onClick={() => answer(j)}>{o}</button>)}
      </div>
    </div>
  );
}

function Mistake({ s, a, set, checked }: ActProps<MistakeStep>) {
  const { sfx } = useApp();
  if (a.kind !== 'mistake') return null;
  return (
    <div className="lv-mistake">
      {s.context ? <p className="lv-context">{s.context}</p> : null}
      <p className="lv-step-h"><span>Step 1</span> Tap the wrong line.</p>
      <ul className="lv-work" aria-label="The work">
        {s.lines.map((t, k) => {
          const picked = a.line === k;
          const mark = checked && (k === s.wrong ? ' is-right' : picked ? ' is-wrong' : '');
          return (
            <li key={k}>
              <button type="button" aria-pressed={picked} className={'lv-work-line press' + (picked ? ' is-picked' : '') + (mark || '')}
                onClick={() => { if (!checked) { set({ ...a, line: k }); sfx('tap'); } }}>
                <span className="lv-work-n" aria-hidden="true">{k + 1}</span>{t}
              </button>
            </li>
          );
        })}
      </ul>
      {a.line !== null ? (
        <fieldset className="lv-reasons fx-fadeupA">
          <legend className="lv-step-h"><span>Step 2</span> Why is it wrong?</legend>
          {s.reasons.map((r, k) => {
            const mark = checked ? (k === s.reason ? ' is-right' : a.reason === k ? ' is-wrong' : '') : '';
            return (
              <button key={k} type="button" aria-pressed={a.reason === k} className={'lv-reason press' + (a.reason === k ? ' is-picked' : '') + mark}
                onClick={() => { if (!checked) { set({ ...a, reason: k }); sfx('tap'); } }}>{r}</button>
            );
          })}
        </fieldset>
      ) : <p className="lv-step-h is-later"><span>Step 2</span> Why is it wrong? (after Step 1)</p>}
    </div>
  );
}

/** Tap the pieces in order; tap a placed piece to take it (and the ones after it) back. */
function Order({ s, a, set, checked }: ActProps<OrderStep>) {
  const { sfx } = useApp();
  if (a.kind !== 'order') return null;
  const left = s.show.filter((x) => !a.v.includes(x));
  return (
    <div className="lv-order">
      <ol className="lv-order-placed" aria-label="Your order">
        {s.items.map((_, slot) => {
          const it = a.v[slot];
          const mark = checked && it !== undefined ? (it === slot ? ' is-right' : ' is-wrong') : '';
          return (
            <li key={slot} className={'lv-order-slot' + (it !== undefined ? ' is-full' : '') + mark}>
              <span className="lv-work-n" aria-hidden="true">{slot + 1}</span>
              {it !== undefined ? (
                <button type="button" className="lv-order-take" disabled={checked} onClick={() => { set({ kind: 'order', v: a.v.slice(0, slot) }); sfx('tap'); focusSoon('.lv-order-pool button', '.lv-order-take'); }}
                  aria-label={`${s.items[it]}. Tap to take it back.`}>{s.items[it]}</button>
              ) : <span className="lv-order-empty">&nbsp;</span>}
            </li>
          );
        })}
      </ol>
      {left.length ? (
        <div className="lv-order-pool" role="group" aria-label="Sentences to place">
          {left.map((x) => <button key={x} type="button" className="lv-card-chip press" onClick={() => { set({ kind: 'order', v: [...a.v, x] }); sfx('tap'); focusSoon('.lv-order-pool button', '.ls-foot .ls-cta:not(:disabled)', '.lv-order-take'); }}>{s.items[x]}</button>)}
        </div>
      ) : null}
      {checked && !a.v.every((x, k) => x === k) ? (
        <ol className="lv-order-key">{s.items.map((t, k) => <li key={k}>{t}</li>)}</ol>
      ) : null}
    </div>
  );
}

function Hot({ s, a, set, checked }: ActProps<HotStep>) {
  const { sfx } = useApp();
  if (a.kind !== 'hot') return null;
  return (
    <p className="lv-hot">
      {s.sentences.map((t, k) => {
        const picked = a.v === k;
        const mark = checked ? (k === s.ans ? ' is-right' : picked ? ' is-wrong' : '') : '';
        return (
          <button key={k} type="button" aria-pressed={picked} className={'lv-hot-s' + (picked ? ' is-picked' : '') + mark}
            onClick={() => { if (!checked) { set({ kind: 'hot', v: k }); sfx('tap'); } }}>
            <sup>({k + 1})</sup> {t}
          </button>
        );
      })}
    </p>
  );
}

function Inline({ s, a, set, checked }: ActProps<InlineStep>) {
  if (a.kind !== 'inline') return null;
  let m = -1;
  return (
    <p className="lv-inline">
      {s.parts.map((part, k) => {
        if (part === '\n') return <br key={k} />; // a new line of the question (bank items)
        if (typeof part === 'string') return <span key={k}>{part}</span>;
        m += 1;
        const mi = m;
        const v = a.v[mi];
        const mark = checked ? (v === part.ans ? ' is-right' : ' is-wrong') : '';
        return (
          <span key={k} className={'lv-menu-wrap' + mark}>
            <select className={'lv-menu' + mark} value={v === null ? '' : String(v)} disabled={checked} aria-label={`Blank ${mi + 1}${mark ? (v === part.ans ? ', correct' : ', not correct') : ''}`}
              onChange={(e) => { const nv = a.v.slice(); nv[mi] = e.target.value === '' ? null : +e.target.value; set({ kind: 'inline', v: nv }); }}>
              <option value="">Choose…</option>
              {part.choices.map((c, ci) => <option key={ci} value={ci}>{c}</option>)}
            </select>
            {checked && v !== part.ans ? <small className="lv-cell-ans">→ {part.choices[part.ans]}</small> : null}
          </span>
        );
      })}
    </p>
  );
}

// ---------------------------------------------------------------- summary

function Summary({ lv, results, onAgain }: { lv: L; results: Result[]; onAgain: () => void }) {
  const { sfx } = useApp();
  const g = results.filter((r) => r.graded);
  const right = g.filter((r) => r.right).length;
  const acc = g.length ? right / g.length : 1;
  const boss = results.find((r) => lv.steps.find((s) => stepKey(lv, s) === r.id)?.stage === 'boss');
  const stars = 1 + (acc >= 0.8 ? 1 : 0) + (acc >= 0.8 && boss?.right ? 1 : 0);
  const xp = right * XP_STEP + XP_FINISH;
  const formats = [...new Set(lv.steps.map((s) => FORMAT[s.kind]))];
  return (
    <div className="pa-body lv-done">
      <p className="lv-kicker">{lv.world}</p>
      <h1>Level complete!</h1>
      <p className="lv-list-sub">{lv.title}</p>
      <div className="lv-stars" aria-label={`${stars} of 3 stars`}>
        {[0, 1, 2].map((k) => (
          <svg key={k} className={k < stars ? 'fx-pop' : ''} style={{ animationDelay: `${150 + k * 180}ms` }} width="56" height="56" viewBox="0 0 24 24"
            fill={k < stars ? 'var(--reward)' : '#E9E2D6'} stroke={k < stars ? 'var(--reward-edge)' : '#D3C9B9'} strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true"><path d={STAR} /></svg>
        ))}
      </div>
      <div className="lv-stats">
        <p><b>{right}/{g.length}</b><span>right</span></p>
        <p><b>+{xp}</b><span>XP</span></p>
        <p><b>{boss?.right ? 'Beat' : 'Missed'}</b><span>boss question</span></p>
      </div>
      <p className="lv-star-rule">1 star: finish · 2 stars: 80% right · 3 stars: 80% right and beat the boss question</p>
      <div className="lv-formats">
        <p className="lv-formats-h">Test question types you practiced</p>
        <ul>{formats.map((f) => <li key={f}>{f}</li>)}</ul>
      </div>
      <div className="lv-done-btns">
        <button type="button" className="pa-btn green press" onClick={() => { sfx('tap'); onAgain(); }}>Play again</button>
        <a className="pa-btn ghost press" href="#level" onClick={() => sfx('tap')}>Back to sample levels</a>
      </div>
    </div>
  );
}
