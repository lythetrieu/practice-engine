// Home: greeting + HUD, the Continue card (or Resume for a half-done lesson), daily quests, then
// "Redo mistakes" when some are due (else the one badge closest to being earned), and the test countdown.
// From the second day of practice, one dismissible card suggests installing the app (../install.tsx).
// Every number comes from the saved progress.
import { useEffect, useRef, useState } from 'react';
import './Home.css';
import { useApp } from '../ctx';
import { Hud, daysToTest } from '../ui';
import { TestDaySheet } from './HomeGrade';
import { BadgeArt, BADGE_BY_ID } from '../Art';
import { TEST_DAYS,
  SAMPLE_MODE, CHEST_XP, today, parseDay, nextUp, quests, claimQuest, badgeProgress, questionsFor, questionCount,
  resumable, SAMPLE_SOON, lostStreak, gradeOf, streak,
} from '../store';
import { kidColor, initialOf } from '../family';
import { InstallCard, IosInstallSheet } from '../install';
import { DAILY_GOAL, QUEST_XP, XP_PER_CORRECT, LESSONS, WORLDS, SUBJECTS, checkId, type Subject } from '../curriculum';
import { config } from '../../pack';
import { isBankLevel } from '../levels/index';
import { bankStatus, onAppBank } from '../appBank';
import { TutorPlan, planRows } from './TutorPlan';
import { startSeen } from '../startSeen';

const ARROW = 'M5 12h14M13 6l6 6-6 6';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const QUEST_LOOK: Record<string, { icon: string; bg: string; ink: string }> = {
  answer: { icon: 'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16zM12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8zM12 11.2a.8.8 0 1 0 0 1.6a.8.8 0 1 0 0-1.6z', bg: 'var(--accent-tint)', ink: 'var(--accent-ink)' },
  run: { icon: 'M13.5 2.5L5 13.5h6l-1 8 8.5-11h-6z', bg: '#F2ECE2', ink: '#1D2320' },
  time: { icon: 'M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17zM12 7.5V12l3 2', bg: 'var(--ok-tint)', ink: 'var(--primary)' },
};

const CHEST_PENDING = { body: '#E9E2D6', edge: '#A9A296', band: '#D3C9B9', latch: '#A9A296' };
const CHEST_READY = { body: 'var(--primary)', edge: 'var(--primary-edge)', band: 'var(--sage)', latch: 'var(--accent)' };

// 6 sparkles fanning up and out of the chest (the lid center is about x 30, y 12 in the 60 px button)
const SPARKS = [-80, -48, -16, 16, 48, 80].map((angle, i) => {
  const size = i % 2 ? 9 : 12;
  return { angle, size, left: 30 - size / 2, top: 12 - size / 2, color: i % 2 ? 'var(--sage)' : 'var(--accent)', delay: 80 + (i % 3) * 40 };
});

const RING = 2 * Math.PI * 15;      // daily-goal ring (r 15)
const ARC = 2 * Math.PI * 27;       // badge progress ring (r 27)
const DL = { cont: 0, quests: 80, badges: 160, test: 240, ring: 260, pulse: 900 };

function Sample() {
  return <span className="hm-sample">Sample</span>;
}

function Chest({ ready, open, opening, w, h }: { ready: boolean; open?: boolean; opening?: boolean; w: number; h: number }) {
  const c = ready ? CHEST_READY : CHEST_PENDING;
  return (
    <svg className="hm-chest" width={w} height={h} viewBox="0 0 44 40" aria-hidden="true">
      <path d="M9 37a13 2.4 0 1 0 26 0a13 2.4 0 1 0-26 0z" fill={ready ? 'rgba(29,35,32,.16)' : 'rgba(29,35,32,.12)'} />
      <path d="M7 19h30v14a3 3 0 0 1-3 3H10a3 3 0 0 1-3-3z" fill={c.body} stroke={c.edge} strokeWidth="2" strokeLinejoin="round" />
      {ready ? <path d="M9 19.5a13 2.4 0 1 0 26 0a13 2.4 0 1 0-26 0z" fill="var(--primary-edge)" opacity={open ? 1 : 0} /> : null}
      <path d="M15 20v15M29 20v15" fill="none" stroke={c.band} strokeWidth="3" />
      <path d="M19.5 18h5v5.5a2.5 2.5 0 0 1-5 0z" fill={c.latch} />
      <g className={'hm-lid' + (open ? ' is-open' : '') + (opening ? ' opening' : '')}>
        <path d="M7 19v-3.5A8.5 8.5 0 0 1 15.5 7h13A8.5 8.5 0 0 1 37 15.5V19z" fill={c.body} stroke={c.edge} strokeWidth="2" strokeLinejoin="round" />
        <path d="M15 8v10M29 8v10" fill="none" stroke={c.band} strokeWidth="3" />
      </g>
    </svg>
  );
}

// ---- Continue card ----

type Hero =
  | { kind: 'lesson'; subject: Subject; worldN: number; worldName: string; title: string; href: string | null; levelDone: boolean[]; current: number; sub: string; sample: boolean; label: string; resume?: boolean }
  | { kind: 'chest'; subject: Subject; worldN: number; worldName: string; title: string; href: string; levelDone: boolean[]; current: number; sub: string; sample: boolean; label: string }
  | { kind: 'check'; subject: Subject; worldN: number; worldName: string; title: string; href: string | null; levelDone: boolean[]; current: number; sub: string; sample: boolean; label: string; resume?: boolean }
  | { kind: 'none' };

function useHero(): Hero {
  const { p } = useApp();
  // A lesson or unit check left part-way comes first: pick up where you left off.
  const r = resumable(p);
  const rc = r ? /^(math|ela)-([1-6])-check$/.exec(r.id) : null;
  const rl = r ? LESSONS[r.id] : undefined;
  if (r && (rl || rc)) {
    const subject = (rl ? rl.subject : rc![1]) as Subject;
    const world = WORLDS[subject][(rl ? rl.world : +rc![2]) - 1];
    const n = r.answers.length + 1, total = r.qids.length;
    return {
      kind: rl ? 'lesson' : 'check', subject, worldN: world.n, worldName: world.name, resume: true,
      levelDone: world.lessons.map((l) => !!p.lessons[l.id]), current: rl ? rl.level - 1 : -1,
      title: rl ? `Level ${rl.level} · ${rl.title}` : 'Unit check', href: `#play/${r.id}`,
      sub: `Question ${n} of ${total} · saved`, sample: SAMPLE_MODE && !isBankLevel(r.id),
      label: `Resume ${rl ? `Level ${rl.level} · ${rl.title}` : 'the unit check'} at question ${n} of ${total}`,
    };
  }
  // the student's section, or the first other section with something to play
  let subject: Subject = p.subject;
  if (!nextUp(p, p.subject)?.playable) subject = SUBJECTS.find((x) => x !== p.subject && nextUp(p, x)?.playable) ?? p.subject;
  const ns = nextUp(p, subject);
  if (!ns) return { kind: 'none' };
  const world = ns.world;
  const levelDone = world.lessons.map((l) => !!p.lessons[l.id]);
  const base = { subject, worldN: world.n, worldName: world.name, levelDone };
  const xpText = (n: number) => `${n} question${n === 1 ? '' : 's'} · up to +${n * XP_PER_CORRECT} XP the first time`;
  if (ns.kind === 'lesson') {
    const l = ns.lesson;
    const n = questionCount(l.id);
    return {
      ...base, kind: 'lesson', title: `Level ${l.level} · ${l.title}`, current: l.level - 1,
      href: ns.playable ? `#play/${l.id}` : null,
      sub: ns.playable ? xpText(n) : 'Questions coming soon',
      sample: ns.playable && SAMPLE_MODE && !isBankLevel(l.id), label: `Start Level ${l.level} · ${l.title}`,
    };
  }
  if (ns.kind === 'chest') {
    return {
      ...base, kind: 'chest', title: 'Reward chest ready!', current: -1, href: `#learn/${subject}/${world.n}`,
      sub: `+${CHEST_XP} XP inside`, sample: false, label: 'Go to the reward chest',
    };
  }
  const id = checkId(subject, world.n);
  const n = questionCount(id);
  return {
    ...base, kind: 'check', title: 'Unit check', current: -1, href: ns.playable ? `#play/${id}` : null,
    sub: ns.playable ? xpText(n) : 'Questions coming soon', sample: ns.playable && SAMPLE_MODE && !isBankLevel(id),
    label: `Start the World ${world.n} unit check`,
  };
}

/** Re-renders when the question bank finishes loading (or fails to). */
function useBankLoading(): boolean {
  const [, bump] = useState(0);
  useEffect(() => { const off = onAppBank(() => bump((n) => n + 1)); return () => { off(); }; }, []);
  return bankStatus() === 'loading';
}

function Continue() {
  const { p, me } = useApp();
  const hero = useHero();
  const loading = useBankLoading();
  const t = today();
  // A streak that ended is said out loud once, kindly, instead of the number just dropping to 0.
  const lost = lostStreak(p, t);
  const streakNote = lost
    ? lost.today ? `Your ${lost.was}-day streak ended. Today is day 1 of a new one.` : `Your ${lost.was}-day streak restarted. Practice today and it is day 1 again.`
    : streak(p, t).n === 0 && p.days.length > 0 ? 'Your streak restarted. Practice today to start a new one.' : null;
  const now = Math.min(p.qDays[t] || 0, DAILY_GOAL);
  const left = DAILY_GOAL - now;
  const goalLabel = left > 0
    ? `Daily goal: ${now} of ${DAILY_GOAL} questions answered today, ${left} more to go`
    : `Daily goal: ${DAILY_GOAL} of ${DAILY_GOAL} questions answered today, goal reached`;

  if (hero.kind === 'none') {
    return (
      <section className="hm-hero fx-fadeup" aria-labelledby="home-continue" style={{ animationDelay: DL.cont + 'ms' }}>
        <p className="hm-label">Continue</p>
        <h2 id="home-continue" className="hm-title">You finished every world!</h2>
        <div className="hm-cta">
          <a href="#learn" className="hm-start press on-dark">Back to the map</a>
        </div>
      </section>
    );
  }

  const done = hero.levelDone.filter(Boolean).length;
  const dotsLabel = `${hero.worldName} levels: ${done} of ${hero.levelDone.length} done` + (hero.current >= 0 ? `, level ${hero.current + 1} is next` : '');
  const titleLong = hero.title.length > 31;
  // Until the first download ends, the card must not offer the 3-question sample as if it were the level.
  const waiting = loading && hero.sample;
  return (
    <section className="hm-hero fx-fadeup" aria-labelledby="home-continue" style={{ animationDelay: DL.cont + 'ms' }}>
      <div className="hm-hero-top">
        <div className="hm-hero-l">
          <div className="hm-label-row">
            <p className="hm-label">{'resume' in hero && hero.resume ? 'Keep going' : 'Continue'}</p>
            {hero.sample && !loading ? <Sample /> : null}
          </div>
          <p className="hm-world">World {hero.worldN} · {hero.worldName}</p>
        </div>
        <div className="hm-goal" role="img" aria-label={goalLabel}>
          <svg width="38" height="38" viewBox="0 0 38 38" aria-hidden="true">
            <circle cx="19" cy="19" r="15" fill="none" stroke="#45705D" strokeWidth="5" />
            {now > 0 ? (
              <circle className="hm-ring-draw" cx="19" cy="19" r="15" fill="none" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round"
                strokeDasharray={RING.toFixed(1)} strokeDashoffset={(RING * (1 - now / DAILY_GOAL)).toFixed(1)} transform="rotate(-90 19 19)"
                style={{ animationDelay: DL.ring + 'ms' }} />
            ) : null}
            <path d="M19 13.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 1 0 0-11z" fill="none" stroke="#FFFFFF" strokeWidth="2" />
            <path d="M19 17.4a1.6 1.6 0 1 0 0 3.2a1.6 1.6 0 1 0 0-3.2z" fill="#FFFFFF" />
          </svg>
          <div aria-hidden="true">
            <p className="hm-goal-l">Daily goal</p>
            <p className="hm-goal-n"><strong>{now}/{DAILY_GOAL}</strong> today</p>
          </div>
        </div>
      </div>
      <h2 id="home-continue" className={'hm-title' + (titleLong ? ' long' : '')}>{hero.title}</h2>
      <div className="hm-hero-row">
        <div className="hm-dots" role="img" aria-label={dotsLabel}>
          <span className="hm-track" aria-hidden="true" />
          {hero.levelDone.map((d, i) => {
            const st = d ? 'done' : i === hero.current ? 'current' : 'locked';
            return (
              <span key={i} className={'hm-dot ' + st} aria-hidden="true">
                {d ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                ) : null}
              </span>
            );
          })}
        </div>
        <p className="hm-sub">{waiting ? 'Getting your questions ready…' : hero.sub}</p>
      </div>
      {streakNote ? <p className="hm-streak-note">{streakNote}</p> : null}
      {hero.href ? (
        <div className="hm-cta fx-pulse" style={{ animationDelay: DL.pulse + 'ms' }}>
          <a href={hero.href} className="hm-start press on-dark" aria-label={hero.label}>
            {hero.kind === 'chest' ? 'Go to the chest' : 'resume' in hero && hero.resume ? 'Resume' : 'Start'}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ARROW} /></svg>
          </a>
        </div>
      ) : (
        <div className="hm-cta">
          <button type="button" className="hm-start off" aria-disabled="true">Coming soon</button>
        </div>
      )}
    </section>
  );
}

// ---- Daily quests ----

function Quests() {
  const { p, update, sfx, buzz, motion } = useApp();
  const list = quests(p);
  const [burst, setBurst] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  // Phones: one short row (three small meters) that opens to the list; it opens by itself when a chest is ready.
  const ready = list.some((q) => q.done && !q.claimed);
  const [openList, setOpenList] = useState(ready);
  useEffect(() => { if (ready) setOpenList(true); }, [ready]);
  const claimed = list.filter((q) => q.claimed).length;
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const open = (id: string) => {
    const q = list.find((x) => x.id === id);
    if (!q || !q.done || q.claimed) return;
    // re-check against the saved state (e.g. after midnight the quest list may be stale)
    let got = 0;
    update((s) => { const r = claimQuest(s, id); got = r.xp; return r.p; });
    if (!got) return;
    sfx('chest');
    buzz(20);
    setMsg(`Quest reward claimed: +${QUEST_XP} XP.`);
    window.clearTimeout(timer.current);
    if (motion) {
      setBurst(id);
      timer.current = window.setTimeout(() => setBurst(null), 1300);
    } else {
      setBurst(null);
    }
  };

  return (
    <section className={'hm-sec hm-s-quests fx-fadeup' + (openList ? ' is-open' : '')} aria-labelledby="home-quests" style={{ animationDelay: DL.quests + 'ms' }}>
      <div className="hm-head">
        <h2 id="home-quests" className="hm-h2">Daily quests</h2>
        <p className="hm-note">Resets at midnight</p>
      </div>
      <button type="button" className="hm-qstrip press" aria-expanded={openList} aria-controls="hm-qlist" onClick={() => { sfx('tap'); setOpenList((v) => !v); }}>
        {list.map((q) => {
          const look = QUEST_LOOK[q.id], r = 13, c = 2 * Math.PI * r;
          return (
            <span key={q.id} className={'hm-qmini' + (q.done ? ' ok' : '')} aria-hidden="true">
              <svg width="34" height="34" viewBox="0 0 34 34">
                <circle cx="17" cy="17" r={r} fill={look.bg} stroke="#EAE3D7" strokeWidth="3.5" />
                <circle cx="17" cy="17" r={r} fill="none" stroke={q.done ? 'var(--primary)' : 'var(--accent)'} strokeWidth="3.5" strokeLinecap="round"
                  strokeDasharray={c.toFixed(1)} strokeDashoffset={(c * (1 - q.now / q.max)).toFixed(1)} transform="rotate(-90 17 17)" />
                <path d={look.icon} transform="translate(9 9) scale(.6667)" fill="none" stroke={look.ink} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          );
        })}
        <span className="hm-qstrip-t">{ready ? 'A reward is ready' : `${claimed} of ${list.length} claimed`}</span>
        <svg className="hm-qstrip-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      <ul className="hm-qlist" id="hm-qlist">
        {list.map((q, i) => {
          const look = QUEST_LOOK[q.id];
          const pct = Math.round((q.now / q.max) * 100);
          const bursting = q.claimed && burst === q.id;
          return (
            <li key={q.id} className="hm-q">
              <span className="hm-qtile" aria-hidden="true" style={{ background: look.bg }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={look.ink} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={look.icon} /></svg>
              </span>
              <div className="hm-qmain">
                <p className="hm-qname">{q.name}</p>
                <div className="hm-qbarrow">
                  <div className="hm-bar" role="progressbar" aria-label={q.name} aria-valuemin={0} aria-valuemax={q.max} aria-valuenow={q.now}
                    aria-valuetext={`${q.now} of ${q.max}` + (q.done ? ', complete' : '')}>
                    <div className={'hm-fill fx-fill' + (q.done ? ' ok' : '')} style={{ width: pct + '%', animationDelay: DL.quests + 300 + i * 120 + 'ms' }} />
                  </div>
                  <span className={'hm-qcount' + (q.done ? ' ok' : '')} aria-hidden="true">
                    {q.now}/{q.max}
                    {q.done ? (
                      <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0z" fill="var(--primary)" /><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#FFFFFF" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    ) : null}
                  </span>
                </div>
              </div>
              <div className="hm-qside">
                {!q.done ? (
                  <span className="hm-qwait">
                    <Chest ready={false} w={34} h={31} />
                    <span className="sr">Reward chest opens when this quest is done</span>
                  </span>
                ) : (
                  <button type="button" className={'hm-qopen' + (q.claimed ? ' got' : ' press')} onClick={() => open(q.id)}
                    aria-disabled={q.claimed} aria-label={q.claimed ? `Claimed: +${QUEST_XP} XP` : `Open reward chest: ${q.name}`}>
                    <Chest ready open={q.claimed} opening={bursting} w={31} h={28} />
                    <span>{q.claimed ? 'Claimed' : 'Open'}</span>
                    {bursting ? (
                      <span className="hm-burst" aria-hidden="true">
                        {SPARKS.map((s, k) => (
                          <span key={k} className="hm-spark" style={{ left: s.left, top: s.top, width: s.size, height: s.size, transform: `rotate(${s.angle}deg)` }}>
                            <span className="hm-spark-fly" style={{ width: s.size, height: s.size, animationDelay: s.delay + 'ms' }}>
                              <svg width={s.size} height={s.size} viewBox="0 0 10 10" aria-hidden="true"><path d="M5 0L6.2 3.8L10 5L6.2 6.2L5 10L3.8 6.2L0 5L3.8 3.8Z" fill={s.color} /></svg>
                            </span>
                          </span>
                        ))}
                        <span className="hm-plus"><span className="fx-float">+{QUEST_XP} XP</span></span>
                      </span>
                    ) : null}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="sr" role="status">{msg}</p>
    </section>
  );
}

// ---- The badge closest to being earned (shown when Your plan has nothing; missed questions are a plan row) ----
// Missed questions due today come first (retesting errors with feedback is what helps most: Pashler et al.
// 2005; learners rarely start it on their own: Karpicke 2009). With nothing due, one "almost there" badge
// (goal-gradient: Kivetz et al. 2006). The full badge collection is on Me.

function NearBadge() {
  const { p } = useApp();
  const ids = Object.keys(BADGE_BY_ID);
  const prog = badgeProgress(p);
  const earnedN = ids.filter((id) => p.badges[id]).length;
  const locked = ids.filter((id) => !p.badges[id] && prog[id].max > 0 && !SAMPLE_SOON.has(id));
  locked.sort((a, b) => prog[b].now / prog[b].max - prog[a].now / prog[a].max);
  const id = locked[0];
  return (
    <section className="hm-sec hm-s-next fx-fadeup" aria-labelledby="home-badges" style={{ animationDelay: DL.badges + 'ms' }}>
      <div className="hm-head hm-head-badges">
        <div className="hm-headl">
          <h2 id="home-badges" className="hm-h2">{id ? 'Almost there' : 'Badges'}</h2>
          <p className="hm-note">{earnedN} of {ids.length} earned</p>
        </div>
        <a href="#me" className="hm-seeall">
          See all
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
        </a>
      </div>
      {id ? (() => {
        const b = prog[id], art = BADGE_BY_ID[id];
        const left = b.max - b.now;
        return (
          <a href="#me" className="hm-near press" aria-label={`${art.name}: ${b.now} of ${b.max}. ${art.how}`}>
            <span className="hm-lpop">
              <svg className="hm-lring" width="58" height="58" viewBox="0 0 60 60" aria-hidden="true">
                <circle cx="30" cy="30" r="27" fill="none" stroke="#EAE3D7" strokeWidth="4" />
                {b.now > 0 ? (
                  <circle className="hm-arc-draw" cx="30" cy="30" r="27" fill="none" stroke="var(--accent)" strokeWidth="4" strokeLinecap="round"
                    strokeDasharray={ARC.toFixed(1)} strokeDashoffset={(ARC * (1 - b.now / b.max)).toFixed(1)} transform="rotate(-90 30 30)" />
                ) : null}
              </svg>
              <BadgeArt id={id} earned={false} size={40} className="hm-lart" />
            </span>
            <span className="hm-near-text" aria-hidden="true">
              <b>{art.name}</b>
              <span>{art.how}</span>
            </span>
            <span className="hm-near-n" aria-hidden="true">{b.now}/{compact(b.max)}{left > 0 && left <= 2 ? <small>{left} to go!</small> : null}</span>
          </a>
        );
      })() : <p className="hm-note">Every badge earned. Amazing!</p>}
    </section>
  );
}

const compact = (n: number) => (n >= 1000 && n % 1000 === 0 ? n / 1000 + 'K' : String(n));

// ---- Test countdown ----

function TestRow({ onAsk }: { onAsk: () => void }) {
  const { p } = useApp();
  const { me } = useApp();
  const n = daysToTest(p.testDate);
  const grade = gradeOf(p, me.grade);
  if (p.nextFall && !p.testDate) {
    return (
      <section className="hm-sec hm-s-test fx-fadeup" aria-labelledby="home-test" style={{ animationDelay: DL.test + 'ms' }}>
        <button type="button" className="hm-test press" onClick={onAsk}>
          <span className="hm-cal" aria-hidden="true">
            <span className="hm-cal-m">LATER</span>
            <span className="hm-cal-d">?</span>
          </span>
          <span className="hm-test-t">
            <span id="home-test" className="hm-test-h">Your test day is not set yet</span>
            <span className="hm-test-s">Pick it when you know it</span>
          </span>
        </button>
      </section>
    );
  }
  if (!p.testDate || n === null) {
    return (
      <section className="hm-sec hm-s-test fx-fadeup" aria-labelledby="home-test" style={{ animationDelay: DL.test + 'ms' }}>
        <button type="button" className="hm-test press" onClick={onAsk}>
          <span className="hm-cal" aria-hidden="true">
            <span className="hm-cal-m">TEST</span>
            <span className="hm-cal-d">?</span>
          </span>
          <span className="hm-test-t">
            <span id="home-test" className="hm-test-h">{grade === null && config.audience ? `${config.audience.label}?` : `When is your ${config.exam}?`}</span>
            <span className="hm-test-s">{grade === null ? 'Then pick your test day' : 'Pick your day for a countdown'}</span>
          </span>
          <span className="hm-go" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ARROW} /></svg>
          </span>
        </button>
      </section>
    );
  }
  const d = parseDay(p.testDate);
  const title = n > 1 ? `${n} days to test day` : n === 1 ? '1 day to test day' : n === 0 ? 'Test day is today' : 'Test day has passed';
  const full = `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return (
    <section className="hm-sec hm-s-test fx-fadeup" aria-labelledby="home-test" style={{ animationDelay: DL.test + 'ms' }}>
      <a href="#test" className="hm-test press">
        <span className="hm-cal" aria-hidden="true">
          <span className="hm-cal-m">{MONTHS[d.getMonth()].slice(0, 3).toUpperCase()}</span>
          <span className="hm-cal-d">{d.getDate()}</span>
        </span>
        <span className="hm-test-t">
          <h2 id="home-test" className="hm-test-h">{title}<span className="sr">, {full}</span></h2>
          <span className="hm-test-s">See the full-length test</span>
        </span>
        <span className="hm-go" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ARROW} /></svg>
        </span>
      </a>
    </section>
  );
}

// ---- screen ----

export default function Home() {
  const { p, me, sfx, go } = useApp();
  // A brand-new device starts with the goal questions once (Start.tsx); Skip or Close never brings them back here.
  useEffect(() => {
    if (!p.tutor.goal && !p.days.length && !Object.keys(p.lessons).length && !startSeen()) go('#start');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [ask, setAsk] = useState(false);
  const [iosSteps, setIosSteps] = useState(false);
  const iosDone = useRef<(() => void) | null>(null);   // the install card's own close, run when its steps sheet closes
  const hiRef = useRef<HTMLHeadingElement>(null);      // where focus goes when the install card goes
  const initial = me.name ? initialOf(me.name) : '';
  const color = kidColor(me);   // a child picked on a parent's device: their color from Who's practicing
  return (
    <>
      <header className="hm-top">
        <div className="hm-who">
          <a href="#me" className="hm-avatar press" aria-label="Me: badges and profile"
            style={color ? { background: color.bg, color: color.ink, boxShadow: `0 3px 0 ${color.edge}` } : undefined}>
            {initial ? initial : (
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>
            )}
          </a>
          <h1 className="hm-hi" ref={hiRef} tabIndex={-1}>{me.name ? <>Hi, <span className="hm-hi-name">{me.name}!</span></> : 'Hi there!'}</h1>
        </div>
        <Hud />
      </header>
      <div className="pa-body hm-main">
        <Continue />
        <TutorPlan delay={DL.quests} />
        <Quests />
        {/* missed questions are a row of Your plan; with nothing planned, the badge closest to being earned */}
        {planRows(p).rows.length ? null : <NearBadge />}
        {TEST_DAYS.length ? <TestRow onAsk={() => { sfx('tap'); setAsk(true); }} /> : null}
        <InstallCard onIos={(done) => { iosDone.current = done; setIosSteps(true); }} focusAfter={() => hiRef.current?.focus({ preventScroll: true })} />
      </div>
      {ask ? <TestDaySheet onClose={() => setAsk(false)} /> : null}
      {iosSteps ? <IosInstallSheet onClose={() => { setIosSteps(false); iosDone.current?.(); iosDone.current = null; }} /> : null}
    </>
  );
}
