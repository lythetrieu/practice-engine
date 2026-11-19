// Learn: the world map. One world per screen, 7 stops on a zigzag road,
// world paging with a slide, popovers under the stops, the chest-open moment, fog on closed worlds,
// and the mascot (Pip, unless the pack names its own) in a corner. Driven by the saved progress (store.ts); nothing here keeps its own score.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { needParts } from '../appBank';
import './Learn.css';
import { useApp } from '../ctx';
import { Hud, STAR } from '../ui';
import { Token, type TokenState } from '../Art';
import { NODES, NODE_PALETTES, type Part } from '../artdata';
import { WORLDS, SUBJECTS, SUBJECT_NAME, isSubject, worldCount, chestId, checkId, CHECK_QUESTIONS, XP_PER_CORRECT, type Subject } from '../curriculum';
import { config } from '../../pack';
import { MascotBody, mascotName } from '../Mascot';
import {
  SAMPLE_MODE, CHEST_XP, CHECK_PASS, lessonState, chestState, checkState, worldOpen, worldDone, nextUp, hasQuestions,
  questionsFor, questionCount, openChest, resumable, today, type StopState,
} from '../store';
import { isBankLevel, stopItems } from '../levels';
import { mastery, MASTERY_LABEL, openPlan } from '../tutor/model';
import { skillRound, skillId, placementId } from '../tutor/pick';
import { dayLabel } from './TutorResult';
import { ParkMap, BridgeMap, FogClouds, PARK_SPOTS, BRIDGE_SPOTS, trailPath } from './LearnMaps';

const MAP_W = 390;
const MAP_H = 696;

// Wider screens (the `pa` container width, same breakpoints as the @container rules in Learn.css):
// - phone (< 600): the map as designed, scaled down on a narrower phone, never up;
// - mid (600-899): one centered map column, scaled to fit the height, at most 520 px wide;
// - wide (>= 900): the map scaled to the height beside a side panel (world banner, progress, list of stops).
// On wider screens the map only grows to fit the height, never shrinks below full size: a scale under 1
// would shrink its 44 px buttons and 12 / 15 px text. When the drawing is taller than
// the window (a short laptop window, a phone in landscape) the body scrolls instead.
const MID_W = 600;
const WIDE_W = 900;   // 900, not 960: a 1024 px tablet in landscape (928 px beside the rail) gets two columns
const BIG_W = 1400;   // @container pa (min-width: 1400px) in Learn.css: wider side panel and gap
const MIN_K = 1;
const MID_MAX_K = 520 / MAP_W;
const WIDE_MAX_K = 1.25;   // on a big screen the map stops growing here, so it stays in scale with the side panel
const SIDE_W = 360;   // .ln-cols in Learn.css: side panel width, column gap (900-1399), side padding
const GAP_W = 48;
const SIDE_W_BIG = 380;   // the same at >= 1400
const GAP_W_BIG = 56;
const PAD_W = 24;
const HEAD_MIN = 300;   // the header controls (subject toggle + HUD) need about this much width
type Mode = 'phone' | 'mid' | 'wide';
const CQ = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('container-type: inline-size');
// fit-to-height scale, capped; full size when the drawing would not fit even at MIN_K
const fitK = (kh: number, cap: number) => (kh < MIN_K ? Math.min(1, cap) : Math.min(kh, cap));

// The guide's tips, shown only after a tap: the pack's own (pack.yaml `tips`), else a few that fit any exam.
const DEFAULT_TIPS = [
  'Read the whole question before you look at the choices.',
  'Stuck? Cross out the choices you know are wrong first.',
  'A little every day beats a lot once a week.',
];
const tipsFor = (s: Subject) => (config.tips[s]?.length ? config.tips[s] : DEFAULT_TIPS);

const ICON = {
  chest: 'M4 10h16v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 10a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5M4 13.5h16M10.5 12h3v3.5h-3z',
  trophy: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H5.5a3 3 0 0 0 2.8 4M16 6h2.5a3 3 0 0 1-2.8 4M12 13v4M8.5 20h7M10 17h4v3h-4z',
  lock: 'M7 11h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2zM8 11V8a4 4 0 0 1 8 0v3',
};

// where the check / lock chip sits on each token silhouette (art units, 120 box)
const CHIP_AT = { lesson: [95, 83], chest: [104, 90], check: [98, 84] } as const;

type Kind = 'lesson' | 'chest' | 'check';
interface Stop {
  i: number; kind: Kind; id: string; state: StopState; look: TokenState;
  level: number; name: string; art: string; stars: number;
  size: number; cx: number; cy: number; left: number; top: number;
  playable: boolean; questions: number;
}

interface PopInfo {
  kicker?: string; title: string; line: string; icon?: string;
  xp?: number; sample?: boolean;
  action?: { kind: 'link'; href: string; label: string; tone: 'coral' | 'green' } | { kind: 'chest' };
  /** What the tutor knows about the skill (label and next review, or why it is on the plan). */
  tutor?: string;
  /** A second, quieter button (the skill check). */
  extra?: { href: string; label: string };
}

const PLAN_WHY: Record<string, string> = { gap: 'On your plan: a unit check found this gap.', placement: 'On your plan: your starting point.', revisit: 'On your plan: your skill check said to try it again.' };

const FIXED: Record<string, string> = { white: '#FFFFFF', shadow: 'rgba(29,35,32,.16)', none: 'none' };

function Sample() {
  return <span className="ln-sample">SAMPLE</span>;
}

// The reward chest token. Same drawing as <Token art="chest">, but the lid parts (9-12) are their own group
// so the lid can tilt open on its back-left hinge.
function ChestToken({ look, size, open, opening }: { look: TokenState; size: number; open: boolean; opening: boolean }) {
  const parts: Part[] = NODES.chest;
  const pal = NODE_PALETTES[look];
  const col = (t: string) => FIXED[t] ?? pal[t] ?? 'none';
  const path = ([d, fill, stroke, sw, op]: Part, i: number) => (
    <path key={i} d={d} fill={col(fill)} stroke={col(stroke)} strokeWidth={sw} opacity={op} strokeLinecap="round" strokeLinejoin="round" />
  );
  return (
    <svg className="ln-chest" width={size} height={size} viewBox="0 0 120 120" aria-hidden="true">
      {parts.slice(0, 9).map((pt, i) => path(pt, i))}
      <g className={'ln-lid' + (open ? ' is-open' : '') + (opening ? ' opening' : '')}>{parts.slice(9, 13).map((pt, i) => path(pt, i + 9))}</g>
      {parts.slice(13).map((pt, i) => path(pt, i + 13))}
    </svg>
  );
}

const SPARKS = [-80, -48, -16, 16, 48, 80].map((angle, i) => ({
  angle, size: i % 2 ? 9 : 12, color: i % 2 ? 'var(--sage)' : 'var(--accent)', delay: 60 + (i % 3) * 40,
}));

export default function Learn() {
  const { p, update, route, go, sfx, buzz, motion } = useApp();

  // ---- what is on screen: subject + world (from the route, else where the student is up to) ----
  const routeSubj = isSubject(route.args[0]) ? route.args[0] : null;
  const routeWorldN = Number(route.args[1]);
  const routeWorld = Number.isInteger(routeWorldN) && routeWorldN >= 1 && routeWorldN <= worldCount(routeSubj ?? SUBJECTS[0]) ? routeWorldN : null;
  const routeKey = route.args.join('/');
  const [view, setView] = useState<{ subj: Subject; world: number }>(() => {
    const s = routeSubj ?? p.subject;
    return { subj: s, world: routeWorld ?? nextUp(p, s)?.world.n ?? 1 };
  });
  const { subj, world } = view;
  const prevKey = useRef(routeKey);

  // both subjects' map stops (the bank comes in parts, appBank.ts; the other subject may still be on its way)
  useEffect(() => { void needParts(); }, []);
  useEffect(() => {
    if (prevKey.current !== routeKey) {
      prevKey.current = routeKey;
      const s = routeSubj ?? p.subject;
      setView({ subj: s, world: routeWorld ?? nextUp(p, s)?.world.n ?? 1 });
      setPop(null); setTipOpen(false); setMore(false);
      if (s !== p.subject) update((q) => (q.subject === s ? q : { ...q, subject: s }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);
  // the route can name a subject other than the saved one: remember it as the last subject shown
  useEffect(() => {
    if (view.subj !== p.subject) update((q) => (q.subject === view.subj ? q : { ...q, subject: view.subj }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- local UI state ----
  const [pop, setPop] = useState<{ i: number; n: number } | null>(null);
  const [react, setReact] = useState<{ i: number; n: number } | null>(null);   // locked stop that shakes
  const [tipOpen, setTipOpen] = useState(false);                               // Pip's tip bubble
  const [tipIdx, setTipIdx] = useState(0);
  const [tipN, setTipN] = useState(0);
  const [hopN, setHopN] = useState(0);
  const [more, setMore] = useState(false);                                      // "last world" note on the next arrow
  const [burst, setBurst] = useState<{ i: number; n: number; phase: 0 | 1 } | null>(null); // chest-open moment (phase 0: lid still opening)
  const [chestNote, setChestNote] = useState(false);                            // screen-reader line after opening a chest
  const [entry, setEntry] = useState<{ pop: 'fx-pop' | 'fx-popA' | 'fx-popB' | ''; slide: '' | 'ln-next' | 'ln-prev'; n: number }>({ pop: 'fx-pop', slide: '', n: 0 });
  const [seenTip, setSeenTip] = useState(false);

  const mapRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLElement>(null);
  const bannerRef = useRef<HTMLElement>(null);
  const [fit, setFit] = useState<{ mode: Mode; k: number; h: number; big: boolean }>({ mode: 'phone', k: 1, h: 0, big: false });
  const { mode, k } = fit;

  // Phone: fit the 390 px map into a narrower phone (never scale up). Wider: scale the whole map frame
  // uniformly to the height it gets (see MID_W / WIDE_W above).
  useLayoutEffect(() => {
    const el = bodyRef.current;
    const scr = el?.parentElement;   // .pa-screen, the `pa` size container
    if (!el || !scr) return;
    const measure = () => {
      // Browsers without CSS container queries get none of the wide CSS, so they keep the phone layout.
      const w = CQ ? scr.getBoundingClientRect().width : Math.min(scr.getBoundingClientRect().width, MID_W - 1);
      const h = el.clientHeight;
      const big = w >= BIG_W;
      let next: { mode: Mode; k: number; h: number; big: boolean };
      if (w < MID_W) next = { mode: 'phone', k: Math.min(1, el.clientWidth / MAP_W) || 1, h, big };
      else if (w < WIDE_W) next = { mode: 'mid', k: fitK(h / MAP_H, MID_MAX_K), h, big };
      else {
        const room = (w - 2 * PAD_W - (big ? GAP_W_BIG + SIDE_W_BIG : GAP_W + SIDE_W)) / MAP_W;
        next = { mode: 'wide', k: fitK(h / MAP_H, Math.min(room, WIDE_MAX_K)), h, big };
      }
      setFit((f) => (f.mode === next.mode && Math.abs(f.k - next.k) < 0.001 && f.h === next.h && f.big === next.big ? f : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(scr);
    return () => ro.disconnect();
  }, []);

  // Crossing a layout width re-mounts the world banner (over the map vs in the side panel). Remember the
  // last focused control with a data-fk key and give focus back to its twin in the new layout.
  const lastFk = useRef<string | null>(null);
  useEffect(() => {
    const scr = bodyRef.current?.parentElement;
    if (!scr) return;
    const on = (e: FocusEvent) => { const fk = (e.target as HTMLElement | null)?.closest?.('[data-fk]')?.getAttribute('data-fk'); lastFk.current = fk || null; };
    scr.addEventListener('focusin', on);
    return () => scr.removeEventListener('focusin', on);
  }, []);
  const prevMode = useRef(mode);
  useLayoutEffect(() => {
    if (prevMode.current === mode) return;
    prevMode.current = mode;
    const a = document.activeElement;
    if (lastFk.current && (!a || a === document.body || !a.isConnected)) {
      bodyRef.current?.parentElement?.querySelector<HTMLElement>(`[data-fk="${lastFk.current}"]`)?.focus({ preventScroll: true });
    }
  }, [mode]);

  // ---- the 7 stops of this world, from the saved progress ----
  const wd = WORLDS[subj][world - 1];
  const wOpen = worldOpen(p, subj, world);
  const park = world % 2 === 1;
  // The drawn road has 7 spots; a world with fewer stops spreads them along it (first and last spot always used).
  const allSpots = park ? PARK_SPOTS : BRIDGE_SPOTS;
  const nStops = WORLDS[subj][world - 1].lessons.length + 2;
  const spotAt = (i: number) => (nStops >= allSpots.length ? i : Math.round((i * (allSpots.length - 1)) / (nStops - 1)));
  const spots = Array.from({ length: nStops }, (_, i) => allSpots[spotAt(i)]);
  const check = checkId(subj, world);
  const checkN = hasQuestions(check) ? questionCount(check) : CHECK_QUESTIONS;

  const rows: { kind: Kind; id: string; level: number; name: string; art: string; state: StopState }[] = [
    ...wd.lessons.map((l) => ({ kind: 'lesson' as Kind, id: l.id, level: l.level, name: l.title, art: l.art, state: lessonState(p, l) })),
    { kind: 'chest', id: chestId(subj, world), level: 0, name: 'Reward chest', art: 'chest', state: chestState(p, subj, world) },
    { kind: 'check', id: check, level: 0, name: 'Unit check', art: 'unit-check', state: checkState(p, subj, world) },
  ];
  const stops: Stop[] = rows.map((r, i) => {
    const look: TokenState = r.state === 'done' ? 'done' : r.state === 'current' ? 'current' : 'locked';
    const size = r.kind === 'check' ? 84 : look === 'current' ? 88 : 76;
    const [cx, cy] = spots[i];
    const rec = p.lessons[r.id];
    return {
      i, kind: r.kind, id: r.id, state: r.state, look, level: r.level, name: r.name, art: r.art,
      stars: r.kind === 'chest' ? 0 : rec?.stars ?? 0,
      size, cx, cy, left: cx - size / 2, top: cy - size / 2,
      playable: r.kind !== 'chest' && hasQuestions(r.id), questions: r.kind === 'chest' ? 0 : questionCount(r.id),
    };
  });
  const firstOpen = stops.findIndex((s) => s.state !== 'done');
  const doneCount = stops.filter((s) => s.state === 'done').length;
  const trail = wOpen && doneCount > 0 ? trailPath(park, spotAt(firstOpen < 0 ? nStops - 1 : firstOpen)) : '';
  const mapBg = park ? 'var(--frame)' : wOpen ? '#E1E5DC' : '#E9ECE5';

  // ---- closing things ----
  const closeAll = useCallback(() => { setPop(null); setTipOpen(false); setMore(false); }, []);
  const anyOpen = !!pop || tipOpen || more;
  const popIdx = pop?.i ?? -1;
  useEffect(() => {
    if (!anyOpen) return;
    // a press outside the map (header, nav) closes a card or tip; Escape closes and returns focus to the stop.
    // The world banner counts as part of the map (on wide screens it sits in the side panel).
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!mapRef.current?.contains(t) && !bannerRef.current?.contains(t)) closeAll();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      closeAll();
      if (popIdx >= 0) mapRef.current?.querySelector<HTMLElement>(`.ln-node[data-i="${popIdx}"]`)?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', esc); };
  }, [anyOpen, popIdx, closeAll]);

  // move focus into a card when it opens (keyboard and screen-reader users land on it; mouse taps show no ring)
  // (on a short screen, such as a small phone or a phone in landscape, the body scrolls: bring the card into view;
  // when the whole map is on screen this does nothing)
  useEffect(() => {
    const el = popRef.current;
    if (!pop || !el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: motion ? 'smooth' : 'auto' });
  }, [pop?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  // the chest burst: the token turns green once the lid is open, then the sparkles clear by themselves
  const burstN = burst?.n;
  useEffect(() => {
    if (burstN === undefined) return;
    const t1 = window.setTimeout(() => setBurst((b) => (b && b.n === burstN ? { ...b, phase: 1 } : b)), 450);
    const t2 = window.setTimeout(() => setBurst(null), 1400);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
  }, [burstN]);

  // ---- actions ----
  const pickSubject = (s: Subject) => {
    sfx('tap');
    closeAll();
    if (s === subj) return;
    setView({ subj: s, world: nextUp(p, s)?.world.n ?? 1 });
    setEntry((e) => ({ pop: e.n % 2 ? 'fx-popB' : 'fx-popA', slide: '', n: e.n + 1 }));
    setSeenTip(false); setTipIdx(0);
    setReact(null); setBurst(null); setChestNote(false);
    update((q) => (q.subject === s ? q : { ...q, subject: s }));
  };

  const goWorld = (dir: 1 | -1) => {
    const w = world + dir;
    if (w < 1 || w > worldCount(subj)) {
      sfx('tap');
      if (dir > 0) { setPop(null); setTipOpen(false); setMore((m) => !m); } else closeAll();
      return;
    }
    sfx('tap');
    closeAll();
    setReact(null); setBurst(null); setChestNote(false);
    setView({ subj, world: w });
    setEntry((e) => ({ pop: '', slide: dir > 0 ? 'ln-next' : 'ln-prev', n: e.n + 1 }));
  };

  const tapStop = (s: Stop) => {
    sfx('tap');
    setTipOpen(false); setMore(false);
    const same = pop?.i === s.i;
    setPop(same ? null : { i: s.i, n: (pop?.n ?? 0) + 1 });
    if (s.look === 'locked') {
      buzz(12);
      setReact({ i: s.i, n: (react?.n ?? 0) + 1 });
    }
  };

  const tapPip = () => {
    sfx('tap');
    setPop(null); setMore(false);
    setTipIdx((i) => (seenTip ? (i + 1) % 3 : i));
    setTipN((n) => n + 1);
    setTipOpen(true);
    setSeenTip(true);
    setHopN((n) => n + 1);
  };

  const openTheChest = (s: Stop) => {
    sfx('chest');
    buzz(20);
    setPop(null);
    if (motion) setBurst({ i: s.i, n: (burst?.n ?? 0) + 1, phase: 0 });
    setChestNote(true);
    update((q) => openChest(q, subj, world).p);
    // the button that opened it goes away: move focus to the chest itself
    requestAnimationFrame(() => {
      const a = document.activeElement;
      if (!a || a === document.body || !a.isConnected) mapRef.current?.querySelector<HTMLElement>(`.ln-node[data-i="${s.i}"]`)?.focus({ preventScroll: true });
    });
  };

  // ---- the card under a tapped stop ----
  // A small mark on a stop: on the tutor's plan (coral "!"), or due for review (green arrow), never both.
  const planned = new Set(openPlan(p.tutor).map((x) => x.stop));
  const tutorMark = (id: string): 'plan' | 'due' | null => (planned.has(id) ? 'plan' : (p.tutor.skills[id]?.due || '9') <= today() ? 'due' : null);
  const info = (s: Stop): PopInfo => {
    const sampleTag = SAMPLE_MODE && s.playable && !isBankLevel(s.id);
    if (s.kind === 'chest') {
      if (s.state === 'done') return { title: 'Reward chest', line: `Opened. You collected +${CHEST_XP}\u00a0XP.`, icon: ICON.chest };
      if (s.state === 'current') return { title: 'Reward chest', line: `You finished all 5 levels. Open it to collect +${CHEST_XP}\u00a0XP.`, icon: ICON.chest, action: { kind: 'chest' } };
      return { title: 'Reward chest', line: wOpen ? 'Finish Level 5 to open it.' : `Finish Level 5 in World ${world} to open it.`, icon: ICON.chest };
    }
    if (s.kind === 'check') {
      const rec = p.lessons[s.id];
      const next = world < worldCount(subj) ? `Pass it to open World ${world + 1}.` : 'Pass it to finish the last world.';
      if (s.state === 'done') return { title: 'Unit check', line: `Passed${rec ? ` · ${rec.best} of ${rec.of} right` : ''}.`, icon: ICON.trophy, sample: sampleTag, action: s.playable ? { kind: 'link', href: '#play/' + s.id, label: 'Try it again', tone: 'green' } : undefined };
      if (s.state === 'current') {
        return {
          title: 'Unit check', line: `${s.questions} questions on everything in World ${world}. ${next}`, icon: ICON.trophy,
          xp: s.questions * XP_PER_CORRECT, sample: sampleTag, action: { kind: 'link', href: '#play/' + s.id, label: 'Start', tone: 'coral' },
        };
      }
      if (s.state === 'soon') return { title: 'Unit check', line: 'Questions for this unit check are coming soon.', icon: ICON.trophy };
      if (!wOpen) return { title: 'Unit check', line: `Pass the World ${world - 1} unit check to open this world.`, icon: ICON.trophy };
      const first = worldDone(p, subj, world) ? 'Open the reward chest first.' : 'Finish Level 5 first.';
      return { title: 'Unit check', line: `${checkN} questions on everything in World ${world}. ${next} ${first}`, icon: ICON.trophy };
    }
    // lesson
    if (s.state === 'current') {
      return {
        title: s.name, line: `Level ${s.level} · ${s.questions} question${s.questions === 1 ? '' : 's'}`, xp: s.questions * XP_PER_CORRECT,
        sample: sampleTag, action: { kind: 'link', href: '#play/' + s.id, label: 'Start', tone: 'coral' },
      };
    }
    const planItem = openPlan(p.tutor).find((x) => x.stop === s.id);
    const rec = p.tutor.skills[s.id];
    if (s.state === 'done') {
      const due = rec?.due;
      const when = due ? (due <= today() ? 'Due for review today' : `Next review: ${dayLabel(due)}`) : '';
      return {
        title: s.name, line: `Completed · ${s.stars} of 3 stars`, sample: sampleTag,
        tutor: planItem ? PLAN_WHY[planItem.why] : rec ? `${MASTERY_LABEL[mastery(rec)]}${when ? ' · ' + when : ''}` : undefined,
        action: s.playable ? { kind: 'link', href: '#play/' + s.id, label: 'Practice again', tone: 'green' } : undefined,
        extra: skillRound(s.id) ? { href: '#play/' + skillId(s.id), label: 'Quick skill check' } : undefined,
      };
    }
    if (planItem && s.playable) {
      // a stop the tutor put on the plan opens before the map reaches it
      return {
        kicker: (world > 1 ? `World ${world} · ` : '') + `Level ${s.level}`, title: s.name, line: `${s.questions} question${s.questions === 1 ? '' : 's'}`,
        tutor: PLAN_WHY[planItem.why], action: { kind: 'link', href: '#play/' + s.id, label: 'Start', tone: 'coral' },
      };
    }
    const kicker = (world > 1 ? `World ${world} · ` : '') + `Level ${s.level} · ${s.name}`;
    if (s.state === 'soon') return { kicker, title: 'Coming soon', line: 'Questions for this lesson are coming soon.', icon: ICON.lock };
    return {
      kicker, title: 'Locked', icon: ICON.lock,
      line: !wOpen ? `Pass the World ${world - 1} unit check to open this world.` : `Finish Level ${s.level - 1} first.`,
    };
  };

  const ps = popIdx >= 0 && popIdx < stops.length ? stops[popIdx] : null;
  const mapBoxH = mode === 'phone' ? (k === 1 ? Math.max(MAP_H, fit.h) : MAP_H) : Math.max(MAP_H * k, fit.h) / k;
  let popPos: { left: number; top?: number; bottom?: number; origin: string; caretLeft: number; above: boolean } | null = null;
  let pinfo: PopInfo | null = null;
  if (ps) {
    pinfo = info(ps);
    // rough card height (px) to decide below / above
    const lines = (txt: string, per: number) => Math.max(1, Math.ceil((txt || '').length / per));
    const h = 34 + (pinfo.kicker ? lines(pinfo.kicker, 27) * 17 + 4 : 0) + lines(pinfo.title, 18) * 23 + 6 + lines(pinfo.line, 27) * 21 +
      (pinfo.xp !== undefined ? 36 : 0) + (pinfo.action ? 62 : 0) + (pinfo.tutor ? lines(pinfo.tutor, 30) * 20 + 8 : 0) + (pinfo.extra ? 52 : 0);
    const hasStars = ps.state === 'done' && ps.kind !== 'chest';
    const below = ps.top + (hasStars ? ps.size + 12 : Math.round(ps.size * 0.9)) + 12;
    const floor = wOpen ? MAP_H - 6 : 580;   // a closed world also keeps clear of the "Jump ahead" card
    const above = below + h > floor;
    const left = Math.min(130, Math.max(12, ps.cx - 124));
    popPos = {
      left, above, origin: above ? '50% 100%' : '50% 0',
      top: above ? undefined : below,
      // .ln-map can be taller than the 696-unit drawing (it runs on to the bottom of the body), so measure
      // `bottom` from its real height in map units.
      bottom: above ? mapBoxH - ps.top - Math.round(ps.size * 0.06) + 12 : undefined,
      caretLeft: Math.min(212, Math.max(14, ps.cx - left - 11)),
    };
  }

  // ---- render ----
  const first = entry.n === 0;
  // "Jump ahead": the placement check finds the starting point and opens the worlds up to it (tutor/pick.ts).
  const jumpHref: string | null = WORLDS[subj].some((w) => w.lessons.some((l) => stopItems(l.id).length > 0)) ? '#play/' + placementId(subj) : null;
  const ab = (n: number, a: string, b: string) => (n % 2 ? a : b);
  const slideCls = entry.slide ? entry.slide + ' ' + ab(entry.n, 'a', 'b') : '';
  const bannerCls = first ? '' : ab(entry.n, 'fx-fadeupA', 'fx-fadeupB');
  const lastWorld = world === worldCount(subj);
  const tipText = tipsFor(subj)[tipIdx % tipsFor(subj).length];
  const burstStop = burst ? stops[burst.i] : null;
  const wide = mode === 'wide';

  // the map frame: as designed on a phone; on wider screens scaled by k and as tall as the body
  // (the road and the scenery run on below the 696 px drawing)
  let fitCls = 'ln-fit';
  let fitStyle: CSSProperties | undefined;
  let mapStyle: CSSProperties | undefined;
  if (mode === 'phone') {
    if (k === 1) fitCls += ' grow';
    else { fitStyle = { width: MAP_W * k, height: MAP_H * k }; mapStyle = { transform: `scale(${k})` }; }
  } else {
    const frameH = Math.max(MAP_H * k, fit.h);
    fitStyle = { width: MAP_W * k, height: frameH };
    mapStyle = { transform: `scale(${k})`, height: frameH / k };
  }
  // header controls line up with the world banner (mid: the map column less the banner's 16 px insets, as on
  // the phone) or with map + side panel (wide); see .ln-head in Learn.css
  const colW = mode === 'wide'
    ? MAP_W * k + (fit.big ? GAP_W_BIG + SIDE_W_BIG : GAP_W + SIDE_W)
    : Math.max((MAP_W - 32) * k, HEAD_MIN);
  const headStyle = mode === 'phone' ? undefined : ({ '--ln-col': `${Math.round(colW)}px` } as CSSProperties);

  const banner = (
    <section className="ln-banner" ref={bannerRef} aria-label={`World ${world} of ${worldCount(subj)}: ${wd.name}`}>
      <div className="ln-banner-row">
        <div className={'ln-banner-txt ' + bannerCls} key={subj + world}>
          <p className="ln-eyebrow">World {world} of {worldCount(subj)}</p>
          <h1>{wd.name}</h1>
        </div>
        <div role="group" aria-label="Worlds" className="ln-pager">
          <button type="button" className="ln-wbtn on-dark" data-fk="prev" aria-label="Previous world" aria-disabled={world === 1} onClick={() => goWorld(-1)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <button type="button" className="ln-wbtn on-dark" data-fk="next" aria-label={lastWorld ? 'Next world: this is the last world' : 'Next world'} aria-disabled={lastWorld} aria-expanded={lastWorld ? more : undefined} onClick={() => goWorld(1)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>
      </div>
      <p className={'ln-unit ' + bannerCls} key={'u' + subj + world}>{wd.unit}</p>
      {more ? (
        <div className={'ln-more ' + ab(entry.n + 1, 'fx-popA', 'fx-popB')} role="status">
          <svg className="caret" width="22" height="10" viewBox="0 0 22 10" aria-hidden="true"><path d="M1 10L11 1L21 10Z" fill="#FFFFFF" /><path d="M1 9L11 1L21 9" fill="none" stroke="#EADFCF" strokeWidth="2" strokeLinejoin="round" /></svg>
          World {worldCount(subj)} is the last world.
        </div>
      ) : null}
    </section>
  );

  // ---- wide screens: the side panel (banner, the world's progress, a plain list of the 7 stops) ----
  let side: ReactNode = null;
  if (wide) {
    const lessonsN = wd.lessons.length;
    const levelsDone = stops.filter((s) => s.kind === 'lesson' && s.state === 'done').length;
    const chestS = stops[lessonsN];
    const checkS = stops[lessonsN + 1];
    const pillCls = (s: Stop) => 'ln-pill' + (s.state === 'done' ? ' done' : s.state === 'current' ? ' ready' : '');
    const chestTxt = chestS.state === 'done' ? 'opened' : chestS.state === 'current' ? 'ready' : 'locked';
    const checkTxt = checkS.state === 'done' ? 'passed' : checkS.state === 'current' ? 'ready' : checkS.state === 'soon' ? 'coming soon' : 'locked';
    const resumeId = resumable(p)?.id;
    const cardCls = first ? '' : ' ' + ab(entry.n, 'fx-fadeupA', 'fx-fadeupB');
    const lockIcon = (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
    );
    side = (
      <aside className="ln-side" aria-label={`World ${world} progress`}>
        {banner}
        <section className={'ln-card ln-prog' + cardCls} key={'p' + subj + world}>
          <h2 className="ln-prog-n"><b>{levelsDone}</b> of {lessonsN} levels done</h2>
          <div className="ln-segs" aria-hidden="true">
            {wd.lessons.map((l, i) => <span key={l.id} className={i < levelsDone ? 'on' : ''} />)}
          </div>
          <p className="ln-pills">
            <span className={pillCls(chestS)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICON.chest} /></svg>
              Chest {chestTxt}
            </span>
            <span className={pillCls(checkS)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICON.trophy} /></svg>
              Unit check {checkTxt}
            </span>
          </p>
        </section>
        <section className={'ln-card ln-list' + cardCls} key={'l' + subj + world}>
          <h2 className="ln-cardh">Stops in World {world}</h2>
          <ol>
            {stops.map((s) => {
              const name = s.kind === 'lesson' ? `Level ${s.level} · ${s.name}` : s.name;
              let status: ReactNode;
              let action: ReactNode = null;
              if (s.state === 'done') {
                if (s.kind === 'chest') status = `Opened · +${CHEST_XP} XP`;
                else if (s.kind === 'check') {
                  const rec = p.lessons[s.id];
                  status = rec ? `Passed · ${rec.best} of ${rec.of} right` : 'Passed';
                } else {
                  status = (
                    <>
                      <span className="ln-row-stars" aria-hidden="true">
                        {[1, 2, 3].map((n) => (
                          <svg key={n} width="15" height="15" viewBox="0 0 24 24"><path d={STAR} fill={n <= s.stars ? 'var(--accent)' : '#D9D1C3'} stroke={n <= s.stars ? 'var(--accent-ink)' : '#C4BAA9'} strokeWidth="1.5" strokeLinejoin="round" /></svg>
                        ))}
                      </span>
                      <span>Completed<span className="sr">, {s.stars} of 3 stars</span></span>
                    </>
                  );
                }
              } else if (s.state === 'current') {
                if (s.kind === 'chest') {
                  status = `Ready · +${CHEST_XP} XP`;
                  action = <button type="button" className="ln-rowbtn press" onClick={() => openTheChest(s)} aria-label="Open the reward chest">Open</button>;
                } else {
                  const verb = resumeId === s.id ? 'Resume' : 'Start';
                  status = (
                    <>
                      <span>{s.questions} question{s.questions === 1 ? '' : 's'}</span>
                      {SAMPLE_MODE && s.playable && !isBankLevel(s.id) ? <Sample /> : null}
                    </>
                  );
                  action = (
                    <a className="ln-rowbtn press" href={'#play/' + s.id} onClick={() => sfx('go')}
                      aria-label={`${verb} ${s.kind === 'lesson' ? `Level ${s.level}: ${s.name}` : 'the unit check'}`}>{verb}</a>
                  );
                }
              } else if (s.state === 'soon') status = 'Coming soon';
              else status = <>{lockIcon}<span>Locked</span></>;
              return (
                <li key={s.i} className={'ln-row ' + s.state} aria-current={s.state === 'current' ? 'step' : undefined}>
                  <span className="ln-row-tok" aria-hidden="true">
                    {s.kind === 'chest'
                      ? <ChestToken look={s.look} size={40} open={s.state === 'done'} opening={false} />
                      : <Token art={s.art} state={s.look} size={40} level={s.level} />}
                  </span>
                  <span className="ln-row-txt">
                    <span className="ln-row-name">{name}</span>
                    <span className="ln-row-st">{status}</span>
                  </span>
                  {action}
                </li>
              );
            })}
          </ol>
        </section>
      </aside>
    );
  }

  return (
    <>
      <header className="ln-head" style={headStyle}>
        <div role="group" aria-label="Subject" className="ln-toggle">
          {SUBJECTS.map((s) => <button key={s} type="button" aria-pressed={subj === s} className={subj === s ? 'on' : ''} onClick={() => pickSubject(s)}>{SUBJECT_NAME[s]}</button>)}
        </div>
        <Hud />
      </header>

      <div className={'pa-body ln-body ln-' + mode} ref={bodyRef} style={{ background: mapBg }}>
        <div className="ln-cols">
          <div className={fitCls} style={fitStyle}>
            <div className="ln-map" ref={mapRef} style={mapStyle}>

              {wide ? null : banner}

              <div className={'ln-page ' + slideCls} key={subj + '-' + world}>
                {park ? <ParkMap trail={trail} /> : <BridgeMap fog={!wOpen} trail={trail} />}

                {anyOpen ? (
                  <button type="button" tabIndex={-1} className="ln-scrim" onClick={closeAll} aria-label={pop ? 'Close card' : 'Close tip'} />
                ) : null}

                {stops.map((s) => {
                  const opening = burst?.i === s.i && burst.phase === 0;     // chest lid still opening: keep the "ready" look
                  const look: TokenState = opening ? 'current' : s.look;
                  const locked = look === 'locked';
                  const k2 = s.size / 120;
                  const chip = CHIP_AT[s.kind];
                  const chipL = Math.round(chip[0] * k2 - 12);
                  const chipT = Math.round(chip[1] * k2 - 12);
                  const reactCls = locked && react?.i === s.i
                    ? (s.kind === 'chest' ? ab(react.n, 'fx-wiggle', 'fx-wiggleB') : ab(react.n, 'fx-shakeA', 'fx-shakeB')) : '';
                  const status = s.state === 'done'
                    ? (s.kind === 'chest' ? ', opened' : s.kind === 'check' ? ', passed' : `, completed, ${s.stars} of 3 stars`)
                    : s.state === 'current' ? (s.kind === 'chest' ? ', ready to open' : ', start')
                    : s.state === 'soon' ? ', coming soon' : ', locked';
                  const mark = tutorMark(s.id);
                  const label = `World ${world}, ${s.kind === 'lesson' ? `Level ${s.level}: ${s.name}` : s.name}${status}${mark === 'plan' ? ', on your plan' : mark === 'due' ? ', due for review' : ''}`;
                  const showSample = SAMPLE_MODE && s.playable && s.kind !== 'chest' && !isBankLevel(s.id);
                  const resuming = resumable(p)?.id === s.id;
                  const go1 = resuming ? 'Resume' : 'Start';
                  const bubbleText = s.kind === 'lesson' ? `Level ${s.level} · ${go1}` : s.kind === 'chest' ? 'Open chest' : go1;
                  // The bubble over the current stop is a real button: one tap starts the next level (or opens the
                  // chest). Tapping any stop itself still opens its preview card first.
                  const bubbleGo = () => {
                    if (s.kind === 'chest') { openTheChest(s); return; }
                    sfx('go');
                    go('#play/' + s.id);
                  };
                  const bubbleLabel = s.kind === 'chest' ? 'Open the reward chest' : `${go1} ${s.kind === 'lesson' ? `Level ${s.level}: ${s.name}` : 'the unit check'}`;
                  const side = s.i === 0;   // the first stop sits right under the banner: its bubble goes beside it
                  return (
                    <div key={s.i} className={'ln-stop ' + entry.pop} style={{ left: s.left, top: s.top, width: s.size, animationDelay: s.i * 70 + 'ms' }}>
                      {s.state === 'current' ? (
                        <div className={'ln-bubble' + (side ? ' side' : '')}>
                          <p className="fx-bob">
                            <button type="button" className="ln-bubble-go" onClick={bubbleGo} aria-label={bubbleLabel} />
                            <span>{bubbleText}</span>
                            {showSample && s.kind === 'lesson' ? <Sample /> : null}
                            {side ? (
                              <svg className="caret" width="9" height="18" viewBox="0 0 9 18" aria-hidden="true"><path d="M9 0V18L0 9Z" fill="#EADFCF" /><path d="M9 2V16L2.5 9Z" fill="#FFFFFF" /></svg>
                            ) : (
                              <svg className="caret" width="18" height="9" viewBox="0 0 18 9" aria-hidden="true"><path d="M0 0H18L9 9Z" fill="#EADFCF" /><path d="M2 0H16L9 6.5Z" fill="#FFFFFF" /></svg>
                            )}
                          </p>
                        </div>
                      ) : null}
                      <div className={reactCls} style={{ opacity: wOpen ? 1 : 0.92 }}>
                        <button
                          type="button" className="ln-node" data-i={s.i} onClick={() => tapStop(s)} aria-label={label}
                          aria-expanded={popIdx === s.i} aria-disabled={locked || undefined} aria-current={s.state === 'current' ? 'step' : undefined}
                          style={{ width: s.size, height: s.size }}
                        >
                          {s.state === 'current' ? (
                            <span className="fx-ring ln-ring" aria-hidden="true" style={{ left: Math.round(13 * k2), top: Math.round(11 * k2), width: Math.round(94 * k2), height: Math.round(90 * k2) }} />
                          ) : null}
                          {s.kind === 'chest'
                            ? <ChestToken look={look} size={s.size} open={s.state === 'done'} opening={!!burst && burst.i === s.i} />
                            : <Token art={s.art} state={look} size={s.size} level={s.level} />}
                          {s.state === 'done' && !opening ? (
                            <span className="ln-chip done" aria-hidden="true" style={{ left: chipL, top: chipT }}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                            </span>
                          ) : null}
                          {tutorMark(s.id) ? (
                            <span className={'ln-tmark ' + tutorMark(s.id)} aria-hidden="true">
                              {tutorMark(s.id) === 'plan'
                                ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3.4" strokeLinecap="round"><path d="M12 5v9M12 19v.5" /></svg>
                                : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" /></svg>}
                            </span>
                          ) : null}
                          {locked ? (
                            <span className="ln-chip lock" aria-hidden="true" style={{ left: chipL, top: chipT }}>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#6F746F" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
                            </span>
                          ) : null}
                        </button>
                      </div>
                      {s.state === 'done' && s.kind !== 'chest' ? (
                        <div className="ln-stars" aria-hidden="true">
                          {[1, 2, 3].map((n) => (
                            <svg key={n} width="17" height="17" viewBox="0 0 24 24"><path d={STAR} fill={n <= s.stars ? 'var(--accent)' : '#D9D1C3'} stroke={n <= s.stars ? 'var(--accent-ink)' : '#C4BAA9'} strokeWidth="1.5" strokeLinejoin="round" /></svg>
                          ))}
                        </div>
                      ) : null}
                      {burstStop && burstStop.i === s.i && motion ? (
                        <span className="ln-burst" key={burst!.n} aria-hidden="true" style={{ left: s.size / 2, top: Math.round(s.size * 0.32) }}>
                          {SPARKS.map((sp, j) => (
                            <span key={j} className="ln-spark" style={{ transform: `rotate(${sp.angle}deg)`, width: sp.size, height: sp.size, left: -sp.size / 2, top: -sp.size / 2 }}>
                              <span className="ln-spark-fly" style={{ width: sp.size, height: sp.size, animationDelay: sp.delay + 'ms' }}>
                                <svg width={sp.size} height={sp.size} viewBox="0 0 10 10" style={{ display: 'block' }}><path d="M5 0L6.2 3.8L10 5L6.2 6.2L5 10L3.8 6.2L0 5L3.8 3.8Z" fill={sp.color} /></svg>
                              </span>
                            </span>
                          ))}
                          <span className="ln-xpfloat"><span className="fx-float">+{CHEST_XP} XP</span></span>
                        </span>
                      ) : null}
                    </div>
                  );
                })}

                {!wOpen ? (
                  <>
                    <div className="ln-fog fog-drift" aria-hidden="true"><FogClouds /></div>
                    <div className={'ln-jump' + (park ? ' compact' : '') + ' ' + (first ? 'fx-fadeup' : ab(entry.n, 'fx-fadeupA', 'fx-fadeupB'))} style={{ animationDelay: (entry.slide ? 320 : 7 * 70 + 20) + 'ms' }}>
                      <p className="ln-eyebrow dark">Already know this world?</p>
                      {jumpHref ? (
                        <a className="ln-jumpbtn press" href={jumpHref}>
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6l7 6-7 6zM13 6l7 6-7 6z" /></svg>
                          <span>Jump ahead with a quick check</span>
                        </a>
                      ) : (
                        <button type="button" className="ln-jumpbtn" disabled>
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6l7 6-7 6zM13 6l7 6-7 6z" /></svg>
                          <span>Jump ahead with a quick check<small>Coming soon</small></span>
                        </button>
                      )}
                    </div>
                  </>
                ) : null}
              </div>

              <button type="button" className="ln-pip" onClick={tapPip} aria-label={`${mascotName}, your guide: next tip`} aria-expanded={tipOpen}>
                <span className="fx-bob ln-pip-bob">
                  <span className={'ln-pip-hop ' + (hopN === 0 ? '' : ab(hopN, 'fx-hopA', 'fx-hopB'))}>
                    <MascotBody size={58} blink />
                  </span>
                </span>
              </button>
              <div className="ln-tipwrap" aria-live="polite">
                {tipOpen ? (
                  <div className={'ln-tip ' + ab(tipN, 'fx-popA', 'fx-popB')}>
                    <svg className="caret" width="22" height="10" viewBox="0 0 22 10" aria-hidden="true"><path d="M1 10L11 1L21 10Z" fill="#FFFFFF" /><path d="M1 9L11 1L21 9" fill="none" stroke="#EADFCF" strokeWidth="2" strokeLinejoin="round" /></svg>
                    <p><span className="ln-eyebrow coral">{mascotName}’s tip {(tipIdx % tipsFor(subj).length) + 1} of {tipsFor(subj).length}</span>{tipText}</p>
                  </div>
                ) : null}
              </div>

              {ps && pinfo && popPos ? (
                <section
                  ref={popRef} tabIndex={-1} key={pop!.n}
                  className={'ln-pop ' + ab(pop!.n, 'fx-popA', 'fx-popB')}
                  aria-label={pinfo.kicker ? `${pinfo.title}: ${pinfo.kicker}` : pinfo.title}
                  style={{ left: popPos.left, top: popPos.top, bottom: popPos.bottom, transformOrigin: popPos.origin }}
                >
                  {popPos.above ? (
                    <svg className="caret down" width="22" height="10" viewBox="0 0 22 10" aria-hidden="true" style={{ left: popPos.caretLeft }}><path d="M1 0L11 9L21 0Z" fill="#FFFFFF" /><path d="M1 1L11 9L21 1" fill="none" stroke="#EADFCF" strokeWidth="2" strokeLinejoin="round" /></svg>
                  ) : (
                    <svg className="caret up" width="22" height="10" viewBox="0 0 22 10" aria-hidden="true" style={{ left: popPos.caretLeft }}><path d="M1 10L11 1L21 10Z" fill="#FFFFFF" /><path d="M1 9L11 1L21 9" fill="none" stroke="#EADFCF" strokeWidth="2" strokeLinejoin="round" /></svg>
                  )}
                  <button
                    type="button" className="ln-popx" aria-label="Close"
                    onClick={() => { sfx('tap'); closeAll(); mapRef.current?.querySelector<HTMLElement>(`.ln-node[data-i="${ps.i}"]`)?.focus({ preventScroll: true }); }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                  </button>
                  {pinfo.kicker ? <p className="ln-kicker">{pinfo.kicker}</p> : null}
                  <h2>
                    {pinfo.icon ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5C625D" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={pinfo.icon} /></svg> : null}
                    <span>{pinfo.title}</span>
                  </h2>
                  <p className="ln-line">{pinfo.line}</p>
                  {pinfo.tutor ? <p className="ln-tutor">{pinfo.tutor}</p> : null}
                  {pinfo.xp !== undefined || pinfo.sample ? (
                    <p className="ln-chips">
                      {pinfo.xp !== undefined ? (
                        <span className="ln-xp">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--sage)" stroke="var(--primary)" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true"><path d={STAR} /></svg>
                          Up to +{pinfo.xp} XP
                        </span>
                      ) : null}
                      {pinfo.sample ? <Sample /> : null}
                    </p>
                  ) : null}
                  {pinfo.action?.kind === 'link' ? (
                    <a href={pinfo.action.href} className={'ln-act press ' + pinfo.action.tone} onClick={() => sfx('go')}>{pinfo.action.label}</a>
                  ) : null}
                  {pinfo.extra ? <a href={pinfo.extra.href} className="ln-act2 press" onClick={() => sfx('go')}>{pinfo.extra.label}</a> : null}
                  {pinfo.action?.kind === 'chest' ? (
                    <button type="button" className="ln-act press coral" onClick={() => openTheChest(ps)}>Open chest</button>
                  ) : null}
                </section>
              ) : null}

              <p className="sr" role="status">{chestNote ? `Chest opened. You earned ${CHEST_XP} XP.` : ''}</p>
            </div>
          </div>
          {side}
        </div>
      </div>
    </>
  );
}
