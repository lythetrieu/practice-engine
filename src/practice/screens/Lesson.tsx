// The lesson question loop: one question at a time with Check, a
// feedback sheet, the answer eliminator, a combo counter, a "+5 XP" float, sounds and a
// buzz. Plays a lesson, a unit check or a review round; the last answer hands everything to
// finishPlay(), which scores and saves it and shows the lesson-complete screen.
import { Fragment, useEffect, useRef, useState } from 'react';
import { useApp } from '../ctx';
import { LESSONS, XP_PER_CORRECT, parseStopId } from '../curriculum';
import { questionsFor, mistakeQuestions, dueMistakes, reviewRound, lessonState, checkState, resumable, questionById, saveInProgress, today, gradeOf, type Answer, type Progress, type InProgress } from '../store';
import { RATE_N, setHistory, placementRound, placementSubject, checkRound, skillRound, skillStop, practiceRound, fixRound, PLACEMENT_LEN, FIX_ID, PRACTICE_ID, type Round } from '../tutor/pick';
import { levelOf, levelVariant, levelFromKeys, stepById } from '../levels/index';
import type { McStep } from '../levels/types';
import { bankStatus, onAppBank, needParts, partsFor, partsReady, partsMissing, ALL_PARTS } from '../appBank';
import { useOnline } from '../offline';
import { canPlay } from '../recommend';
import { Play as LevelPlay, levelItems, type Item, type Run } from './Level';
/** A question of the old one-question loop (no pack uses it; kept for saved Review items). */
interface Question { id: string; stem: string; opts: string[]; ans: number; why?: string[]; exp: string; sample?: boolean; hint?: string }
const questionStep = (q: Question): McStep => ({ id: q.id, kind: 'mc', stage: 'practice', prompt: q.stem, opts: q.opts, ans: q.ans, why: q.why, exp: q.exp });
import { Sheet, FLAME, STAR, RowMark, Letter } from '../ui';
import { ReportSheet, FlagButton } from '../report';
import { MascotFace } from '../Mascot';
import './Lesson.css';

type Kind = 'lesson' | 'check' | 'review';
interface Setup { kind: Kind; id: string; label: string; back: string; noun: string; questions: Question[]; resume?: InProgress; sample?: boolean }
type Problem = 'unknown' | 'soon' | 'locked' | 'no-mistakes';
/** A 10-step level from the map, or Review when some missed questions are level steps (screens/Level.tsx). */
interface LevelSetup { run: Run }

/** A unit check id ("<section>-<world>-check"), as [id, section, world] like a regex match, or null. */
const CHECK_RE = { exec: (id: string): [string, string, string] | null => { const x = parseStopId(id); return x && x.rest === 'check' ? [id, x.subject, String(x.world)] : null; }, test: (id: string) => !!parseStopId(id) && parseStopId(id)!.rest === 'check' };
const LETTERS = 'ABCD';

// A half-done round with exactly these steps, to carry on from.
function resumeOf(p: Progress, id: string, items: Item[]) {
  const r = resumable(p);
  return r && r.id === id && r.qids.length === items.length && r.qids.every((q, i) => q === items[i].key) ? r : undefined;
}

/** A tutor round (tutor/pick.ts) for the id in the route, or null when the id is not one or has no questions yet. */
function tutorRun(id: string | undefined, p: Progress, grade: number | null): LevelSetup | Problem | null {
  if (!id) return null;
  setHistory(p.tutor);
  const mk = (mode: Run['mode'], r: Round | null, extra: Partial<Run> = {}): LevelSetup | Problem => {
    if (!r) return 'soon';
    // A half-done round of the same id carries on with the same questions (an adaptive one keeps choosing after them).
    const rs = resumable(p);
    if (rs && rs.id === id && rs.kind === mode && rs.qids.every((k) => stepById(k))) {
      const items = rs.qids.map((k) => ({ key: k, step: stepById(k)! }));
      return { run: { mode, id, items, resume: rs, more: r.more, core: r.core, ...extra } };
    }
    return { run: { mode, id, items: r.items, more: r.more, core: r.core, ...extra } };
  };
  const seed = Date.now() % 100000;
  const ps = placementSubject(id);
  if (ps) return mk('placement', placementRound(ps, p.tutor, grade), { expect: PLACEMENT_LEN[ps] + RATE_N[ps], grade });
  const C = CHECK_RE.exec(id);
  if (C) {
    const s = C[1], w = +C[2];
    if (checkState(p, s, w) === 'locked' && !p.lessons[id]) return 'locked';
    const r = checkRound(s, w, p.tutor, seed);
    return r ? mk('check', r, { expect: r.items.length + 2 }) : null;
  }
  const ss = skillStop(id);
  // a retry leaves out the questions missed last time (they wait in Review)
  if (ss) return p.lessons[ss] || p.tried[ss] ? mk('skill', skillRound(ss, seed, p.mistakes.filter((m) => m.qid.startsWith(ss + '/')).map((m) => m.qid))) : 'locked';
  if (id === PRACTICE_ID) return mk('practice', practiceRound(p.tutor, today(), undefined, seed));
  if (id === FIX_ID) {
    const r = fixRound([...dueMistakes(p), ...p.mistakes.filter((m) => !dueMistakes(p).includes(m))].reverse(), seed);
    return r ? { run: { mode: 'fix', id, items: r.items } } : 'no-mistakes';
  }
  return null;
}

// What to play for the id in the route (lesson id, unit check id, "review", or a tutor round).
function resolve(id: string | undefined, p: Progress, grade: number | null = null): Setup | LevelSetup | Problem {
  const tr = tutorRun(id, p, grade);
  if (tr) return tr;
  let lv = levelOf(id);
  if (lv && id) {
    const L = LESSONS[id];
    // (a stop a full test recommends may be played before the map reaches it; it counts as usual)
    if (L && !canPlay(p, id)) return 'locked';
    // A replay of a finished bank stop plays a fresh mix (or carries on the half-done one).
    const r = resumable(p);
    if (r && r.id === id) lv = levelFromKeys(lv, r.qids) ?? lv;
    else if (p.lessons[id]) lv = levelVariant(id, Date.now() % 100000) ?? lv;
    const items = levelItems(lv);
    return { run: { mode: 'lesson', id, items, resume: resumeOf(p, id, items) } };
  }
  if (id === 'review' && dueMistakes(p).some((m) => stepById(m.qid))) {
    // Some missed questions are level steps: play all due ones as steps (old questions as multiple choice).
    const items = reviewRound(p).map((m): Item | null => {
      const st = stepById(m.qid);
      if (st) return { key: m.qid, step: st };
      const q = questionById(m.qid) as Question | null;
      return q ? { key: m.qid, step: questionStep(q) } : null;
    }).filter(Boolean) as Item[];
    if (!items.length) return 'no-mistakes';
    return { run: { mode: 'review', id: 'review', items, resume: resumeOf(p, 'review', items) } };
  }
  const s = start(id, p);
  // A half-done round of the same lesson: same questions, carry on from the next unanswered one.
  const r = resumable(p);
  if (typeof s === 'string' || !r || r.id !== s.id) return s;
  const qs = r.qids.map((q) => questionById(q) as Question | null).filter(Boolean) as Question[];
  return qs.length === r.qids.length ? { ...s, questions: qs, resume: r } : s;
}

function start(id: string | undefined, p: Progress): Setup | Problem {
  if (id === 'review') {
    const questions = mistakeQuestions(p);
    return questions.length
      ? { kind: 'review', id: 'review', label: 'Review mistakes', back: '#review', noun: 'review', questions }
      : 'no-mistakes';
  }
  if (!id) return 'unknown';
  const L = LESSONS[id];
  const C = CHECK_RE.exec(id);
  if (!L && !C) return 'unknown';
  const questions = questionsFor(id);
  if (!questions.length) return 'soon';
  // Only what the map offers: the current stop or a finished one (no skipping ahead by link).
  const state = L ? lessonState(p, L) : checkState(p, C![1], +C![2]);
  if (state === 'locked' && !(L && canPlay(p, id))) return 'locked';
  // The 3 built-in questions are a labeled sample: they never mark the real level complete (store.finish, Finish.sample).
  const sample = (questions as Question[]).every((q) => q.sample);
  return L
    ? { kind: 'lesson', id, label: sample ? 'Sample lesson' : `Level ${L.level} · ${L.title}`, back: '#learn', noun: 'lesson', questions, sample }
    : { kind: 'check', id, label: sample ? 'Sample unit check' : `Unit check · World ${C![2]}`, back: '#learn', noun: 'unit check', questions, sample };
}

export default function Lesson() {
  const { p, route } = useApp();
  const id = route.args[0];
  const status = useBankStatus();
  const [sampleNow, setSampleNow] = useState(false);
  // The first visit is still downloading the questions: wait for them instead of playing the sample as if it were
  // the level. Review waits too when its missed steps are level steps not loaded yet.
  const stop = !!id && (!!LESSONS[id] || CHECK_RE.test(id));
  const reviewWaits = id === 'review' && dueMistakes(p).some((m) => !stepById(m.qid) && !questionById(m.qid));
  // The bank comes in parts (appBank.ts): a round waits for the parts it plays from (its subject, or all of them).
  const parts = partsFor(id);
  const partsIn = partsReady(parts);
  useEffect(() => { if (!partsIn) void needParts(parts); }, [partsIn]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (partsIn && partsMissing(parts).length && !levelOf(id) && !sampleNow) return <Getting offline />;
  if ((status === 'loading' || !partsIn) && !sampleNow && !levelOf(id) && (stop || reviewWaits || !partsIn)) return <Getting />;
  return <Resolved key={id} id={id} />;
}

function useBankStatus() {
  const [, bump] = useState(0);
  useEffect(() => { const off = onAppBank(() => bump((n) => n + 1)); return () => { off(); }; }, []);
  return bankStatus();
}

/** Shown while the question bank downloads on a first visit. After a while it offers the labeled sample lesson. */
function Getting({ onSample, offline: failed }: { onSample?: () => void; offline?: boolean }) {
  const { sfx } = useApp();
  // a part that could not download: offline says so; online (the server failed) offers to try again
  const online = useOnline();
  const offline = failed && !online;
  const retry = failed && online;
  const [slow, setSlow] = useState(false);
  useEffect(() => { const t = window.setTimeout(() => setSlow(true), 10000); return () => window.clearTimeout(t); }, []);
  return (
    <div className="pa-body ls-notice" role="status">
      <h1>{offline ? 'These questions need a connection first' : retry ? 'These questions didn’t load' : 'Getting your questions ready…'}</h1>
      {retry ? <button type="button" className="pa-btn green ls-notice-btn" onClick={() => { sfx('tap'); void needParts(ALL_PARTS); }}>Try again</button> : null}
      <p>{offline ? 'They download the first time you’re online, then work offline too. Questions you’ve already opened still play.' : retry ? 'Something went wrong on our side. Try again in a moment.' : slow ? 'This is taking a while on a slow connection. You can keep waiting, or try a short sample lesson.' : 'This only takes a moment the first time.'}</p>
      <a className="pa-btn ghost ls-notice-btn" href="#learn" onClick={() => sfx('tap')}>Back to the map</a>
      {(slow || offline) && onSample ? <button type="button" className="pa-btn ghost ls-notice-btn" onClick={() => { sfx('tap'); onSample(); }}>Try the sample lesson</button> : null}
    </div>
  );
}

function Resolved({ id }: { id: string | undefined }) {
  const { p, me } = useApp();
  // Decide once, so the screen does not flip when progress is saved at the end.
  const [setup] = useState(() => resolve(id, p, gradeOf(p, me.grade)));
  if (typeof setup === 'string') return <Notice problem={setup} />;
  if ('run' in setup) return <LevelPlay run={setup.run} />;
  return <Play s={setup} />;
}

function Notice({ problem }: { problem: Problem }) {
  const { sfx } = useApp();
  const text = {
    unknown: { h: 'We can’t find that level', t: 'Pick a level on the map to start.' },
    soon: { h: 'Questions coming soon', t: 'Questions for this lesson are coming soon.' },
    locked: { h: 'This level is locked', t: 'Finish the levels before it on the map first.' },
    'no-mistakes': { h: 'Nothing to redo', t: 'No mistakes to redo. Missed questions come back here until you get them right.' },
  }[problem];
  const back = problem === 'no-mistakes' ? { href: '#review', label: 'Back to Review' } : { href: '#learn', label: 'Back to Learn' };
  return (
    <div className="pa-body ls-notice">
      <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3.5 12a8.5 8.5 0 1 0 2.8-6.3" /><path d="M3.5 4v5h5" /><path d="M9 12.5l2.2 2.2L15.5 10" />
      </svg>
      <h1>{text.h}</h1>
      <p>{text.t}</p>
      <a className="pa-btn green ls-notice-btn" href={back.href} onClick={() => sfx('tap')}>{back.label}</a>
    </div>
  );
}

const Check = ({ size, w }: { size: number; w: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);
const Cross = ({ size, w }: { size: number; w: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth={w} strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
);

function Play({ s }: { s: Setup }) {
  const { p, update, go, sfx, buzz, finishPlay } = useApp();
  const { questions } = s;
  const total = questions.length;

  const [q, setQ] = useState(() => s.resume?.answers.length ?? 0);
  const [picked, setPicked] = useState<number | null>(null);
  const [struck, setStruck] = useState<number[]>([]);
  const [checked, setChecked] = useState(false);
  const [elim, setElim] = useState(false);
  const [tapN, setTapN] = useState(0);
  const [combo, setCombo] = useState(() => p.run);        // answers right in a row, carried over from before this lesson
  const [quit, setQuit] = useState(false);
  const [report, setReport] = useState(false);

  const answers = useRef<Answer[]>(s.resume ? s.resume.answers.slice() : []);
  const seconds = useRef(s.resume?.seconds ?? 0);          // time on this screen, max 300 s per question
  const qStart = useRef(Date.now());
  const comboT = useRef<number | undefined>(undefined);
  const finishing = useRef(false);
  const promptRef = useRef<HTMLHeadingElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const firstQ = useRef(true);

  useEffect(() => () => window.clearTimeout(comboT.current), []);

  // After Check the Check button is gone: focus the sheet's button. After Continue: focus the new prompt.
  useEffect(() => { if (checked) nextRef.current?.focus({ preventScroll: true }); }, [checked]);
  useEffect(() => {
    if (firstQ.current) { firstQ.current = false; return; }
    promptRef.current?.focus({ preventScroll: true });
  }, [q]);

  const Q = questions[q];
  const isLast = q === total - 1;
  const finished = q + (checked ? 1 : 0);
  const isRight = checked && picked === Q.ans;
  const isWrong = checked && picked !== null && picked !== Q.ans;
  const muted = !p.sound;
  const enter = q % 2 ? 'fx-fadeupB' : 'fx-fadeupA';
  const hint = Q.hint || 'Work it out here.';

  const pick = (i: number) => {
    if (checked) return;
    if (elim) {
      setStruck((st) => (st.includes(i) ? st.filter((x) => x !== i) : [...st, i]));
      if (picked === i) setPicked(null);
      sfx('tap');
    } else if (!struck.includes(i)) {
      setPicked(i);
      setTapN((n) => n + 1);
      sfx('tap');
    }
  };

  const check = () => {
    if (picked === null || checked) return;
    const right = picked === Q.ans;
    const nextCombo = right ? combo + 1 : 0;
    answers.current.push({ qid: Q.id, correct: right });
    seconds.current += Math.min(300, Math.max(0, (Date.now() - qStart.current) / 1000));
    // Save after every answer, so leaving (or the phone dying) never loses the round.
    const saved: InProgress = { id: s.id, kind: s.kind, qids: questions.map((x) => x.id), answers: answers.current.slice(), seconds: Math.round(seconds.current), at: today() };
    update((x) => saveInProgress(x, saved));
    setChecked(true);
    setElim(false);
    setCombo(nextCombo);
    if (right) {
      sfx('correct');
      buzz(15);
      if (nextCombo >= 3) {
        window.clearTimeout(comboT.current);
        comboT.current = window.setTimeout(() => sfx('combo'), 250);
      }
    } else {
      sfx('wrong');
      buzz([40, 40, 40]);
    }
  };

  const next = () => {
    if (!checked || isLast) return;
    sfx('tap');
    setQ(q + 1);
    setPicked(null);
    setStruck([]);
    setElim(false);
    setChecked(false);
    qStart.current = Date.now();
  };

  const finish = () => {
    if (!checked || !isLast || finishing.current) return;
    finishing.current = true;
    finishPlay({ id: s.id, kind: s.kind, answers: answers.current, seconds: Math.round(seconds.current), ...(s.sample ? { sample: true } : {}) });
  };

  const wrongText = isWrong ? (Q.why?.[picked!] ? Q.why[picked!] + ' ' : '') + Q.exp : '';
  const finishLabel = s.kind === 'lesson' ? 'Finish lesson' : s.kind === 'check' ? 'Finish unit check' : 'Finish review';

  return (
    <>
      {s.sample ? <p className="pa-sample"><b>SAMPLE</b> A short sample lesson. It does not count as the real level.</p> : null}
      <header className="ls-head">
        <button type="button" className="ls-icon-btn" aria-label={`Quit ${s.noun}`} onClick={() => { sfx('tap'); setQuit(true); }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        <div className="ls-track">
          <div className="ls-bar" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={finished}>
            <div className="ls-fill" style={{ width: `${(finished / total) * 100}%` }}>
              <span className="ls-gloss" aria-hidden="true" />
              <span className={'ls-shine' + (finished === 0 ? '' : finished % 2 ? ' ls-shineA' : ' ls-shineB')} aria-hidden="true" />
            </div>
          </div>
          {combo >= 3 ? (
            <p className={'ls-combo ' + (combo % 2 ? 'fx-popA' : 'fx-popB')}>
              <svg className="fx-flicker" width="14" height="14" viewBox="0 0 24 24" fill="#FFFFFF" stroke="#1D2320" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d={FLAME} /></svg>
              {combo} in a row!
            </p>
          ) : null}
          {isRight ? (
            <p key={q} className="ls-xp fx-float" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--sage)" stroke="var(--primary)" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true"><path d={STAR} /></svg>
              +{XP_PER_CORRECT} XP
            </p>
          ) : null}
        </div>
        <p className="ls-count">{q + 1}/{total}</p>
        <FlagButton className="ls-icon-btn ls-flag-top" onClick={() => { sfx('tap'); setReport(true); }} />
        <button type="button" className={'ls-icon-btn' + (muted ? ' is-muted' : '')} aria-pressed={muted} aria-label="Mute sounds"
          onClick={() => update((x) => ({ ...x, sound: !x.sound }))}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
            <path d={muted ? 'M16 9.5l5 5M21 9.5l-5 5' : 'M15.5 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11'} />
          </svg>
        </button>
      </header>

      <div className="pa-body ls-main">
        <Fragment key={q}>
          <div className={'ls-prompt-wrap ' + enter}>
            <p className="ls-chip">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 19h5v-5h5V9h5V4h3" /></svg>
              {s.label}
            </p>
            <h1 ref={promptRef} tabIndex={-1} className="ls-prompt">{Q.stem}</h1>
          </div>


          <div className="ls-choices" role="group" aria-label="Answer choices">
            {Q.opts.map((text, i) => {
              const isPicked = picked === i;
              const isStruck = struck.includes(i);
              const isAns = checked && i === Q.ans;
              const isNo = checked && isPicked && i !== Q.ans;
              const tone = isAns ? ' is-right' : isNo ? ' is-wrong' : isPicked ? ' is-picked' : '';
              let react = '';
              if (checked && isPicked) react = i === Q.ans ? ' fx-pop' : q % 2 ? ' fx-shakeB' : ' fx-shakeA';
              else if (isPicked) react = tapN % 2 ? ' fx-tapA' : ' fx-tapB';
              return (
                <div key={i} className={enter} style={{ animationDelay: `${120 + i * 60}ms` }}>
                  <button type="button" aria-pressed={isPicked} aria-disabled={checked}
                    className={'ls-choice press' + tone + (isStruck ? ' is-struck' : '') + (checked ? ' is-locked' : '') + react}
                    onClick={() => pick(i)}>
                    <Letter i={i} />
                    <span className="ls-opt">{text}</span>
                    {isStruck && !isAns && !isNo ? <span className="ls-elim-tag">eliminated</span> : null}
                    {isAns ? <RowMark ok /> : isNo ? <RowMark ok={false} /> : null}
                  </button>
                </div>
              );
            })}
          </div>
        </Fragment>
      </div>

      {!checked ? (
        <footer className="ls-foot">
          <div role="group" aria-label="Tools" className="ls-tools">
            <button type="button" className={'ls-tool' + (elim ? ' on' : '')} aria-pressed={elim} onClick={() => setElim((v) => !v)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 12h16" /><path d="M7 7h10M7 17h6" /></svg>
              Eliminate
            </button>
          </div>
          <button type="button" className={'ls-cta press' + (picked !== null ? ' fx-pop' : '')} disabled={picked === null} onClick={check}>Check</button>
        </footer>
      ) : null}

      <div role="status" aria-live="polite" className="ls-live">
        {isRight ? (
          <footer className="ls-sheet ok fx-slideup">
            <div className="ls-sheet-top">
              <span className="ls-pip fx-pop" aria-hidden="true"><MascotFace /></span>
              <p className="ls-say fx-pop">
                <svg width="8" height="14" viewBox="0 0 8 14" aria-hidden="true"><path d="M8 0L0 7 8 14Z" fill="#FFFFFF" /><path d="M8 1L1 7 8 13" fill="none" stroke="var(--sage-tint)" strokeWidth="2" /></svg>
                Nice!
              </p>
              <FlagButton className="ls-flag" onClick={() => { sfx('tap'); setReport(true); }} />
            </div>
            <p className="ls-verdict">
              <span className="ls-verdict-icon ok fx-pop"><Check size={17} w={3.4} /></span>
              Correct
            </p>
            <p className="ls-explain">{Q.exp}</p>
            {isLast
              ? <button type="button" ref={nextRef} className="ls-cta green press" onClick={finish}>{finishLabel}</button>
              : <button type="button" ref={nextRef} className="ls-cta green press" onClick={next}>Continue</button>}
          </footer>
        ) : null}

        {isWrong ? (
          <footer className="ls-sheet no fx-slideup">
            <div className="ls-sheet-top">
              <span className="ls-pip fx-pop" aria-hidden="true"><MascotFace /></span>
              <p className="ls-say fx-pop">
                <svg width="8" height="14" viewBox="0 0 8 14" aria-hidden="true"><path d="M8 0L0 7 8 14Z" fill="#FFFFFF" /><path d="M8 1L1 7 8 13" fill="none" stroke="#F3CDBF" strokeWidth="2" /></svg>
                Let’s fix this one.
              </p>
              <p className="ls-saved fx-pop">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3.5 12a8.5 8.5 0 1 0 2.8-6.3" /><path d="M3.5 4v5h5" /></svg>
                {s.kind === 'review' ? 'Still in Review' : 'Saved to Review'}
              </p>
              <FlagButton className="ls-flag" onClick={() => { sfx('tap'); setReport(true); }} />
            </div>
            <div className="ls-sheet-mid">
              <span className="ls-verdict-icon no fx-pop" aria-hidden="true"><Cross size={13} w={3.6} /></span>
              <p className="ls-nq">Not quite.</p>
              <p className="ls-answer fx-pop">
                <span className="ls-answer-dot" aria-hidden="true"><Check size={12} w={3.6} /></span>
                <span>Answer: <b>{LETTERS[Q.ans]}</b></span>
              </p>
            </div>
            <p className="ls-explain">{wrongText}</p>
            {isLast
              ? <button type="button" ref={nextRef} className="ls-cta green press" onClick={finish}>{finishLabel}</button>
              : <button type="button" ref={nextRef} className="ls-cta green press" onClick={next}>Got it</button>}
          </footer>
        ) : null}
      </div>

      {report ? (
        <ReportSheet kind="question" qid={Q.id} onClose={() => setReport(false)}
          ctx={{ lesson: s.id, pos: q + 1, total, picked, checked, correct: checked && picked !== null ? picked === Q.ans : null }} />
      ) : null}

      {quit ? (
        <Sheet label={`Leave this ${s.noun}?`} onClose={() => setQuit(false)}>
          <h2 className="pa-sheet-title">Leave this {s.noun}?</h2>
          <p className="pa-sheet-sub">
            {answers.current.length > 0 && answers.current.length < total
              ? `Your answers are saved. Pick up at question ${answers.current.length + 1} from Home or the map.`
              : 'You can start it again any time.'}
          </p>
          <div className="ls-quit">
            <button type="button" className="pa-btn green press" onClick={() => { sfx('tap'); setQuit(false); }}>Keep going</button>
            <button type="button" className="pa-btn ghost press" onClick={() => { sfx('tap'); go(s.back); }}>Leave</button>
          </div>
        </Sheet>
      ) : null}
    </>
  );
}
