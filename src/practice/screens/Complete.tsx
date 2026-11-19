// Lesson complete: confetti, medal, title, stars, count-up tiles,
// the week row, what unlocked next, saved mistakes, and the "Badge unlocked" moments.
// Reads what the lesson screen just handed to finishPlay() (ctx.last) and the saved progress.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useApp } from '../ctx';
import { BadgeArt, BADGE_BY_ID } from '../Art';
import { BADGES } from '../artdata';
import { FLAME, STAR } from '../ui';
import { LESSONS, WORLDS, SUBJECTS, worldCount, chestId, checkId, type Subject } from '../curriculum';
import { CHECK_RE } from '../tutor/pick';
import { weekRow, parseDay, today, CHECK_PASS, passNeed, type Finish, type Report } from '../store';
import { TutorCard, tutorTitle, tutorActions, Saves } from './TutorResult';
import './Complete.css';
import { Celebrate, momentOf, type Moment } from './Celebrate';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// Deterministic "random" numbers, so the confetti is the same every time.
const rnd = (i: number, s: number) => {
  const x = Math.sin((i + 1) * 12.9898 + s * 78.233) * 43758.5453;
  return x - Math.floor(x);
};
const CONFETTI_COLORS = ['var(--accent)', 'var(--sage)', 'var(--primary)', 'var(--accent)', 'var(--sage)', 'var(--primary)', '#EADFCF', '#FFFFFF'];
const piece = (i: number) => {
  const circle = rnd(i, 1) < 0.35;
  const bg = CONFETTI_COLORS[Math.floor(rnd(i, 2) * CONFETTI_COLORS.length)];
  const w = circle ? 6 + Math.round(rnd(i, 3) * 3) : 7 + Math.round(rnd(i, 3) * 6);
  const slot = (i * 7) % 30;
  return {
    left: (6 + (slot + rnd(i, 5)) * (366 / 30)) / 390 * 100,   // percent of the width
    top: Math.round(-12 + rnd(i, 6) * 84),
    w, h: circle ? w : 4 + Math.round(rnd(i, 4) * 2),
    radius: circle ? '50%' : '2px', bg, edge: bg === '#FFFFFF' ? 1 : 0,
    rot: Math.round(rnd(i, 7) * 180), delay: Math.round(rnd(i, 8) * 600), dur: Math.round(1400 + rnd(i, 9) * 800),
    dir: rnd(i, 10) < 0.5 ? 'normal' : 'reverse',
  };
};
// Phones get 30 pieces. Wider screens get more, so the confetti still fills the screen: pieces 30-59
// show from 600px wide, 60-89 from 900px (Complete.css hides them below that).
const CONFETTI = Array.from({ length: 90 }, (_, i) => ({ ...piece(i), cls: i < 30 ? '' : i < 60 ? ' cp-more' : ' cp-most' }));

// Count-up progress 0 -> 1 (after a short wait). Jumps straight to 1 when motion is off.
function useCountUp(motion: boolean, delay = 350, dur = 800) {
  const [v, setV] = useState(motion ? 0 : 1);
  useEffect(() => {
    if (!motion) { setV(1); return; }
    let raf = 0;
    const t0 = performance.now() + delay;
    const tick = (now: number) => {
      const x = clamp01((now - t0) / dur);
      setV(x);
      if (x < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [motion, delay, dur]);
  return v;
}

const DEV_MOMENTS: Record<string, Moment> = {
  streak: { kind: 'streak', from: 6, to: 7 },
  world: { kind: 'world', n: 2, name: 'Number Bridge', next: 'World 3 · Equation Falls' },
  start: { kind: 'start', world: 2, name: 'Number Bridge', skill: 'Integers and rational numbers' },
  mastered: { kind: 'mastered', skill: 'Equivalent ratios' },
};
const celebrated = new WeakSet<object>();   // rounds whose big moment has played (coming back here skips it)

export default function Complete() {
  const { last, p, motion } = useApp();
  // a big moment first (Celebrate.tsx), once per finished round; motion off skips it
  const [moment, setMoment] = useState<Moment | null>(() => {
    if (!last || !motion || celebrated.has(last)) return null;
    celebrated.add(last);
    const passedBefore = last.f.kind === 'check' && !last.r.passed && !!p.lessons[last.f.id];
    return momentOf(last.f, last.r, passedBefore);
  });
  // dev only: /app/?moment=world#done shows a scene on its own, to look at it (tree-shaken from the build)
  const devM = import.meta.env.DEV ? new URLSearchParams(location.search).get('moment') : null;
  if (devM) return <Celebrate key={devM} m={DEV_MOMENTS[devM] || DEV_MOMENTS.streak} onDone={() => { /* stays for a look */ }} />;
  if (!last) return null;   // the shell shows Home when there is nothing to show
  if (moment) return <Celebrate m={moment} onDone={() => setMoment(null)} />;
  return <Done f={last.f} r={last.r} />;
}

function Done({ f, r }: { f: Finish; r: Report }) {
  const { p, sfx, buzz, motion } = useApp();

  const isLesson = f.kind === 'lesson';
  const isCheck = f.kind === 'check';
  const isReview = f.kind === 'review';
  // a replay of a check passed before keeps the next world open, whatever the new score
  const passedBefore = isCheck && !r.passed && !!p.lessons[f.id];
  const sample = !!r.sample;
  const tt = tutorTitle(f, r);
  const passed = tt ? tt.passed : sample ? true : isLesson ? r.passed : !isCheck || r.passed || passedBefore;
  const retry = isLesson && !sample && !r.passed;            // under half right: the level stays to try again
  const needN = passNeed(r.total);
  // a unit check passes on the world's own questions; building-block questions only inform the tutor
  const core = r.tutor?.core ?? { right: r.correct, total: r.total };
  const need = Math.ceil(CHECK_PASS * core.total - 1e-9);
  const wrong = r.total - r.correct;

  const L = isLesson ? LESSONS[f.id] : null;
  const checkM = isCheck ? CHECK_RE.exec(f.id) : null;
  const checkSubject = (checkM?.[1] as Subject | undefined) ?? SUBJECTS[0];
  const checkWorld = checkM ? +checkM[2] : 1;

  const title = tt ? tt.title : sample ? 'Sample done!' : retry ? 'Almost! Try this level again' : isLesson ? 'Lesson complete!' : isCheck ? (r.passed ? 'Unit check passed!' : passedBefore ? 'Unit check done!' : 'Almost there!') : 'Review done!';
  const subtitle = tt ? tt.sub : sample ? 'This was only a sample, so Level 1 is not marked complete. The real level plays once your questions have downloaded.'
    : retry ? (p.lessons[f.id] ? `Try again to beat your best. You got ${r.correct} of ${r.total} this time.` : `You need ${needN} of ${r.total} right to open the next level. You got ${r.correct}.`)
    : isLesson
    ? (L ? `Level ${L.level} · ${L.title}` : '')
    : isCheck
      ? (r.passed || passedBefore ? `World ${checkWorld} · ${WORLDS[checkSubject][checkWorld - 1].name}` : `You need ${need} of ${core.total} on this world’s skills to pass. You got ${core.right} right.`)
      : `${r.correct} of ${r.total} ${r.total === 1 ? 'mistake' : 'mistakes'} fixed`;

  // count-ups and the Time tile
  const v = useCountUp(motion);
  const eased = 1 - Math.pow(1 - v, 3);
  const secs = Math.max(0, Math.round(f.seconds));
  const time = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const bump = motion && v >= 1 ? ' cnt-bump' : '';

  // sound: the fanfare once when we arrive (not for a check that was not passed)
  const fanfared = useRef(false);
  useEffect(() => {
    if (fanfared.current) return;
    fanfared.current = true;
    if (passed) sfx('fanfare');
  }, [passed, sfx]);

  // ---- badge unlocks, one after another ----
  const [shown, setShown] = useState(-1);          // index in r.badges of the open unlock, -1 = none
  const timers = useRef<number[]>([]);
  const continueRef = useRef<HTMLAnchorElement>(null);
  const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); };
  const openBadge = (i: number, lead: number) => {
    setShown(i);
    buzz(20);
    if (lead) later(() => sfx('combo'), lead); else sfx('combo');
    later(() => sfx('correct'), lead + 260);
  };
  useEffect(() => {
    if (!r.badges.length) return;
    // Motion on: after the celebration (about 1.9 s). Motion off: at once, after the fanfare.
    if (motion) later(() => openBadge(0, 0), 1900);
    else openBadge(0, 760);
    return () => { timers.current.forEach((t) => window.clearTimeout(t)); timers.current = []; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const closeBadge = () => {
    const nxt = shown + 1;
    if (nxt < r.badges.length) {
      setShown(-1);
      later(() => openBadge(nxt, 0), 320);
    } else {
      setShown(-1);
      continueRef.current?.focus({ preventScroll: true });
    }
  };

  // ---- the week row ----
  const week = weekRow(p);

  // ---- skill card (lessons) / world card (checks) ----
  let skill: ReactNode = null;
  if (sample) {
    skill = null;
  } else if (L && retry) {
    const world = WORLDS[L.subject][L.world - 1];
    skill = (
      <section className="cp-card cp-skill fx-fadeup" style={{ animationDelay: '600ms' }}>
        <h2>{world.unit}</h2>
        <p className="cp-note fx-pop" style={{ animationDelay: '1000ms' }}>Read the explanations in Review, then play Level {L.level} again. {r.correct > 0 ? 'Your right answers are not lost.' : ''}</p>
      </section>
    );
  } else if (L) {
    const world = WORLDS[L.subject][L.world - 1];
    const done = world.lessons.map((l) => !!p.lessons[l.id]);
    const doneN = done.filter(Boolean).length;
    const nextI = done.indexOf(false);
    const fresh = p.lessons[L.id]?.at === today();           // first time this lesson was finished
    const allDone = nextI < 0;
    const chestOpen = p.chests.includes(chestId(L.subject, world.n));
    const passedCheck = !!p.lessons[checkId(L.subject, world.n)];
    let note: ReactNode;
    if (allDone) {
      note = !chestOpen ? <><b>World {world.n} complete!</b> Open your reward chest on the map.</>
        : !passedCheck ? <><b>World {world.n} lessons done.</b> Next up: the unit check.</>
        : <><b>World {world.n} complete.</b></>;
    } else {
      const nx = world.lessons[nextI];
      note = fresh ? <><b>Level {nx.level} unlocked.</b> Next lesson: {nx.title}.</> : <>Next up: Level {nx.level} · {nx.title}.</>;
    }
    skill = (
      <section className="cp-card cp-skill fx-fadeup" style={{ animationDelay: '600ms' }}>
        <h2>{world.unit}</h2>
        <div className="cp-segs" role="img" aria-label={`Skill level ${doneN} of 5${fresh && !allDone ? `, level ${nextI + 1} unlocked` : ''}`}>
          {done.map((on, i) => (
            <div key={i} className={'cp-seg' + (on ? ' on' : '')}>
              {!on && fresh && i === nextI ? <div className="cp-seg-fill fx-fill" style={{ animationDelay: '1000ms' }} /> : null}
            </div>
          ))}
        </div>
        <p className="cp-note fx-pop" style={{ animationDelay: '1300ms' }}>{note}</p>
      </section>
    );
  } else if (isCheck && r.passed) {
    const world = WORLDS[checkSubject][checkWorld - 1];
    const nextWorld = checkWorld < worldCount(checkSubject) ? WORLDS[checkSubject][checkWorld] : null;
    skill = (
      <section className="cp-card cp-skill fx-fadeup" style={{ animationDelay: '600ms' }}>
        <h2>{world.unit}</h2>
        <p className="cp-note fx-pop" style={{ animationDelay: '1000ms' }}>
          {nextWorld ? <><b>World {nextWorld.n} unlocked.</b> Next up: {nextWorld.name}.</> : <><b>All {worldCount(checkSubject)} worlds done.</b></>}
        </p>
      </section>
    );
  }

  // ---- mistakes card ----
  const left = p.mistakes.length;
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
  let mistakes: ReactNode = null;
  if (isReview) {
    mistakes = left > 0
      ? <MistakeCard text={`${left} ${plural(left, 'mistake is', 'mistakes are')} still waiting in Review.`} link="Review mistakes" />
      : <MistakeCard text="No mistakes left to redo. Nice work!" />;
  } else if (wrong > 0 && f.kind !== 'placement') {
    mistakes = <MistakeCard text={`${wrong} ${plural(wrong, 'mistake', 'mistakes')} saved. ${plural(wrong, 'It comes', 'They come')} back in Review.`} link="Review mistakes" />;
  }

  const next = isReview ? '#review' : tt ? '#home' : '#learn';
  const actions = tutorActions(f, r, p);
  const hasStars = isLesson && !sample && !retry;
  const unlock = shown >= 0 ? r.badges[shown] : null;

  return (
    <>
      {motion && passed ? (
        <div className="cp-confetti" aria-hidden="true">
          {CONFETTI.map((c, i) => (
            <span key={i} className={'cp-fall' + c.cls} style={{ left: `${c.left}%`, top: c.top, animationDuration: `${c.dur}ms`, animationDelay: `${c.delay}ms` }}>
              <span className="cp-spin" style={{ animationDuration: `${c.dur}ms`, animationDelay: `${c.delay}ms`, animationDirection: c.dir }}>
                <span className="cp-piece" style={{ width: c.w, height: c.h, borderRadius: c.radius, background: c.bg, borderWidth: c.edge, transform: `rotate(${c.rot}deg)` }} />
              </span>
            </span>
          ))}
        </div>
      ) : null}

      <div className="pa-body cp-main">
        <div className={'cp-hero' + (hasStars ? ' has-stars' : '')}>
          {passed ? <svg className="cp-burst cp-burstin" width="354" height="112" viewBox="0 -8 354 112" aria-hidden="true" style={{ animationDelay: '120ms' }}>
            <rect x="40" y="18" width="12" height="6" rx="2" fill="var(--accent)" transform="rotate(-24 46 21)" />
            <rect x="92" y="54" width="10" height="5" rx="2" fill="var(--sage)" transform="rotate(30 97 56)" />
            <circle cx="132" cy="22" r="4" fill="var(--primary)" />
            <rect x="230" y="14" width="12" height="6" rx="2" fill="var(--sage)" transform="rotate(18 236 17)" />
            <circle cx="270" cy="58" r="5" fill="var(--accent)" />
            <rect x="306" y="28" width="10" height="5" rx="2" fill="var(--primary)" transform="rotate(-36 311 30)" />
            <circle cx="62" cy="70" r="3.5" fill="var(--accent)" />
            <circle cx="214" cy="76" r="3.5" fill="var(--primary)" />
          </svg> : null}
          <svg className="cp-medal" width="84" height="84" viewBox="143 14 68 68" aria-hidden="true">
            <circle cx="177" cy="48" r="34" fill={passed ? 'var(--ok-tint)' : 'var(--accent-tint)'} />
            <circle cx="177" cy="48" r="31.5" fill="none" stroke={passed ? 'var(--sage-tint)' : '#F3CDBF'} strokeWidth="3" />
            {passed
              ? <path className="cp-draw" d="M161 49l11 11 22-24" fill="none" stroke="var(--primary)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="50" style={{ animationDelay: '300ms' }} />
              : <g fill="none" stroke="var(--accent-ink)" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round"><path d="M193 37a17 17 0 1 0 3.2 11" /><path d="M194 28v10h-10" /></g>}
          </svg>
          {hasStars ? (
            <div className="cp-stars" role="img" aria-label={`${r.stars} of 3 stars`}>
              {[0, 1, 2].map((i) => (
                <svg key={i} className="cp-star fx-pop" style={{ animationDelay: `${520 + i * 140}ms` }} width="30" height="30" viewBox="0 0 24 24" aria-hidden="true"
                  fill={i < r.stars ? 'var(--reward)' : '#EAE3D7'} stroke={i < r.stars ? 'var(--reward-edge)' : '#D3C9B9'} strokeWidth="1.5" strokeLinejoin="round"><path d={STAR} /></svg>
              ))}
            </div>
          ) : null}
        </div>

        <div className="cp-title fx-fadeup" style={{ animationDelay: '150ms' }}>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>

        <div className="cp-tiles">
          <div className="cp-tile xp fx-pop" style={{ animationDelay: '300ms' }}>
            <p className="cp-tile-h">XP earned</p>
            <p className="cp-tile-v"><span aria-hidden="true" className={'cp-num' + bump}>+{Math.round(r.xp * eased)}</span><span className="sr">+{r.xp}</span></p>
            {r.replay ? <p className="cp-tile-n">Replay: no new XP</p> : retry || sample ? <p className="cp-tile-n">No XP yet</p> : null}
          </div>
          <div className="cp-tile ok fx-pop" style={{ animationDelay: '420ms' }}>
            <p className="cp-tile-h">Correct</p>
            <p className="cp-tile-v"><span aria-hidden="true" className={'cp-num' + bump}>{Math.round(r.correct * eased)} of {r.total}</span><span className="sr">{r.correct} of {r.total}</span></p>
          </div>
          <div className="cp-tile time fx-pop" style={{ animationDelay: '540ms' }}>
            <p className="cp-tile-h">Time</p>
            <p className="cp-tile-v">{time}</p>
          </div>
        </div>

        <section className="cp-card cp-streak fx-fadeup" style={{ animationDelay: '480ms' }}>
          <h2>
            <svg className="fx-flicker" width="22" height="22" viewBox="0 0 24 24" fill="var(--accent)" stroke="var(--accent-ink)" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true"><path d={FLAME} /></svg>
            <span className={r.extended ? 'cp-bump' : undefined} style={{ animationDelay: '900ms' }}>{r.streakAfter}-day streak</span>
            <Saves n={p.tutor.saves} />
          </h2>
          {r.saveEarned ? <p className="tr-earned fx-pop" style={{ animationDelay: '1100ms' }}>You earned a streak save. It covers a day you miss.</p> : null}
          <ol aria-label="Last 7 days">
            {week.map((d) => {
              const name = DAY_NAMES[parseDay(d.day).getDay()];
              return (
                <li key={d.day}>
                  <span aria-hidden="true" className={d.isToday ? 'cp-today' : undefined}>{d.letter}</span>
                  <span className="cp-dotbox">
                    {!d.on && d.saved ? <svg className="tr-shield" viewBox="0 0 20 22" aria-hidden="true"><path d="M10 1.5 2.5 4.5v6c0 4.6 3.2 8.4 7.5 10 4.3-1.6 7.5-5.4 7.5-10v-6z" fill="var(--sage-tint)" stroke="#4F7A66" strokeWidth="1.6" strokeLinejoin="round" /></svg> : null}
                    {d.on ? (
                      <span className={'cp-dot' + (d.isToday ? ' today fx-pop fx-ring' : '')} style={d.isToday ? { animationDelay: '700ms' } : undefined}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                      </span>
                    ) : null}
                  </span>
                  <span className="sr">{name}{d.isToday ? ', today' : ''}: {d.on ? 'practiced' : d.saved ? 'covered by a streak save' : 'not practiced'}</span>
                </li>
              );
            })}
          </ol>
        </section>

        {skill}
        {sample ? null : <TutorCard f={f} r={r} p={p} />}
        {mistakes}
      </div>

      <footer className="cp-foot">
        {retry ? (
          <div className="cp-retry">
            <a href={`#play/${f.id}`} id="cp-continue" ref={continueRef} className="cp-cta press" onClick={() => sfx('tap')}>Retry this level</a>
            {wrong > 0 ? <a href="#review" className="cp-cta cp-ghost press" onClick={() => sfx('tap')}>Review mistakes</a> : null}
            <a href="#learn" className="cp-back" onClick={() => sfx('tap')}>Back to the map</a>
          </div>
        ) : actions.length ? (
          <div className="cp-retry tr-actions">
            {actions.map((a, k) => a.ghost && k === actions.length - 1 && actions.length > 1
              ? <a key={a.href + k} href={a.href} className="cp-back" onClick={() => sfx('tap')}>{a.label}</a>
              : <a key={a.href + k} href={a.href} {...(k === 0 ? { id: 'cp-continue', ref: continueRef } : {})} className={'cp-cta press' + (a.ghost ? ' cp-ghost' : '')} onClick={() => sfx('tap')}>{a.label}</a>)}
          </div>
        ) : (
          <div className="fx-pulse cp-pulse" style={{ animationDelay: '1600ms' }}>
            <a href={next} id="cp-continue" ref={continueRef} className="cp-cta press" onClick={() => sfx('tap')}>Continue</a>
          </div>
        )}
      </footer>

      {unlock ? <Unlock key={unlock} id={unlock} onClose={closeBadge} onSee={() => sfx('tap')} /> : null}
    </>
  );
}

function MistakeCard({ text, link }: { text: string; link?: string }) {
  const { sfx } = useApp();
  return (
    <section className="cp-card cp-mist fx-fadeup" style={{ animationDelay: '720ms' }}>
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3.5 12a8.5 8.5 0 1 0 2.8-6.3" /><path d="M3.5 4v5h5" /></svg>
      <p>{text}</p>
      {link ? <a href="#review" onClick={() => sfx('tap')}>{link}</a> : null}
    </section>
  );
}

// "Badge unlocked": dim, a card with the badge scaling in over a slow sunburst, sparkles flying out.
function Unlock({ id, onClose, onSee }: { id: string; onClose: () => void; onSee: () => void }) {
  const info = BADGE_BY_ID[id];
  const pal = BADGES.find((b) => b.id === id)?.palette;
  const okRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => { okRef.current?.focus({ preventScroll: true }); }, []);
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); onClose(); return; }
    if (e.key !== 'Tab') return;
    const els = Array.from(boxRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? []);
    if (!els.length) return;
    const i = els.indexOf(document.activeElement as HTMLElement);
    const n = e.shiftKey ? (i <= 0 ? els.length - 1 : i - 1) : (i < 0 || i >= els.length - 1 ? 0 : i + 1);
    e.preventDefault();
    els[n].focus({ preventScroll: true });
  };
  if (!info) return null;
  const light = pal?.light ?? '#F6B9A6';
  return (
    <div ref={boxRef} className="cp-unlock" role="dialog" aria-modal="true" aria-labelledby="cp-badge-title" aria-describedby="cp-badge-desc" tabIndex={-1} onKeyDown={key}>
      <div className="cp-dim" aria-hidden="true" />
      <div className="cp-ucard fx-pop">
        <div className="cp-stage">
          <span className="cp-rays-wrap cp-burstin" aria-hidden="true" style={{ animationDelay: '120ms' }}>
            <span className="cp-rays">
              <svg width="210" height="210" viewBox="0 0 200 200" style={{ display: 'block' }}>
                <circle cx="100" cy="100" r="66" fill={light} opacity=".4" />
                <path d="M100 100L87.2 2.8L112.8 2.8ZM100 100L137.5 9.5L159.7 22.3ZM100 100L177.7 40.3L190.5 62.5ZM100 100L197.2 87.2L197.2 112.8ZM100 100L190.5 137.5L177.7 159.7ZM100 100L159.7 177.7L137.5 190.5ZM100 100L112.8 197.2L87.2 197.2ZM100 100L62.5 190.5L40.3 177.7ZM100 100L22.3 159.7L9.5 137.5ZM100 100L2.8 112.8L2.8 87.2ZM100 100L9.5 62.5L22.3 40.3ZM100 100L40.3 22.3L62.5 9.5Z" fill={light} opacity=".55" />
              </svg>
            </span>
          </span>
          <span className="cp-ubadge" style={{ animationDelay: '200ms' }}><BadgeArt id={id} earned size={150} /></span>
          {Array.from({ length: 8 }, (_, i) => {
            const size = i % 2 ? 12 : 16;
            const R = i % 2 ? 84 : 94;
            return (
              <span key={i} className="cp-pivot" aria-hidden="true" style={{ transform: `rotate(${22.5 + i * 45}deg)` }}>
                <span className="cp-spark" style={{ animationDelay: `${240 + (i % 3) * 30}ms` }}>
                  <span className="cp-twinkle" style={{ left: -size / 2, top: -R - size / 2, width: size, height: size, animationDelay: `${1000 + i * 170}ms` }}>
                    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block' }}><path d="M12 1.5l2.6 7.9 7.9 2.6-7.9 2.6-2.6 7.9-2.6-7.9L1.5 12l7.9-2.6z" fill={i % 2 ? 'var(--sage)' : 'var(--accent)'} /></svg>
                  </span>
                </span>
              </span>
            );
          })}
        </div>
        <h2 id="cp-badge-title" className="cp-utext fx-fadeup" style={{ animationDelay: '380ms' }}>Badge unlocked!</h2>
        <p className="cp-uname cp-utext fx-fadeup" style={{ animationDelay: '440ms' }}>{info.name}</p>
        <p id="cp-badge-desc" className="cp-udesc cp-utext fx-fadeup" style={{ animationDelay: '500ms' }}>{info.how}</p>
        <div className="cp-uact cp-utext fx-fadeup" style={{ animationDelay: '560ms' }}>
          <button type="button" ref={okRef} className="cp-cta press" onClick={onClose}>Awesome!</button>
          <a href="#me" onClick={onSee}>See all badges</a>
        </div>
      </div>
    </div>
  );
}
