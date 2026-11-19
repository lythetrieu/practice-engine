// The practice app (hidden route /app/): one React island, hash routes, progress in this browser.
// Works offline after one online visit (offline.ts, the service worker from scripts/build-sw.mjs).
import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import './app.css';
import { Ctx, type AppCtx, type Me, type Route, type Tab } from './ctx';
import { load, save, reset, finish, useSaves, STORAGE_KEY, type Progress, type Finish, type Report } from './store';
import { sfx as playSfx, buzz as doBuzz, reducedMotion, type Sfx } from './fx';
import { BadgeArt, BADGE_BY_ID } from './Art';
import Nav from './Nav';
import { ReportSheet } from './report';
import { sendAppError, setErrorScreen, watchErrors } from './errors';
import Home from './screens/Home';
// Screens other than Home and Who load on first use (their own JS and CSS chunks), then all of them load while the
// browser is idle, so a tap still opens at once (the one 414 KB chunk was most of a phone's load time).
const screens = {
  learn: () => import('./screens/Learn'),
  lesson: () => import('./screens/Lesson'),
  complete: () => import('./screens/Complete'),
  review: () => import('./screens/Review'),
  progress: () => import('./screens/Progress'),
  test: () => import('./screens/FullTest'),
  exam: () => import('./screens/Exam'),
  me: () => import('./screens/Me'),
  level: () => import('./screens/Level'),
  start: () => import('./screens/Start'),
};
const Learn = lazy(screens.learn);
const Lesson = lazy(screens.lesson);
const Complete = lazy(screens.complete);
const Review = lazy(screens.review);
const ProgressScreen = lazy(screens.progress);
import { LESSONS } from './curriculum';
const FullTest = lazy(screens.test);
const Exam = lazy(screens.exam);
const MeScreen = lazy(screens.me);
import Who from './screens/Who';
import { startSeen } from './startSeen';
const LevelScreen = lazy(screens.level);
const Start = lazy(screens.start);
import { familySync, kidsFrom, justLooking, setJustLooking, parentHint, type Kid } from './family';
import { registerServiceWorker, useOnline, noteNetFail, noteNetOk, maybePersist } from './offline';
import { loadAppBank, onAppBank } from './appBank';
import { pullProgress, pushProgress, resetCloud, type CloudWho } from './cloud';
import { logAnswers, setAnswerWho } from './answerlog';
import { setPipEnabled } from './aitutor';
import { WHO_KEY, profile as currentProfile } from '../lib/client/profiles';
import { config, brandVars } from '../pack';

// the pack's brand colors on .pa, which also carries the app's default tokens (app.css)
const BRAND = brandVars() as React.CSSProperties;

const TABS: Tab[] = ['home', 'learn', 'progress', 'review', 'test', 'me'];   // 'review' has no nav item; Progress links to it

/** The goal questions have not been seen and nothing has been practiced on this device yet. */
const onboardingDue = (p: Progress) => !p.tutor.goal && !p.days.length && !Object.keys(p.lessons).length && !startSeen();

function parse(hash: string): Route {
  let parts: string[];
  try { parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent); } catch (e) { return { name: 'home', args: [] }; }
  const name = parts[0] || 'home';
  if ((TABS as string[]).includes(name) || name === 'play' || name === 'done' || name === 'start' || name === 'exam' || (name === 'level' && import.meta.env.DEV)) return { name: name as Route['name'], args: parts.slice(1) };
  return { name: 'home', args: [] };
}

/** The role in the site's "who is signed in" hint (WHO_KEY, saved by /account/), or null. */
function readHint(): string | null {
  try { const w = JSON.parse(localStorage.getItem(WHO_KEY) || 'null'); return w && typeof w.role === 'string' ? w.role : null; } catch (e) { return null; }
}

function readWho(): Me {
  try {
    const w = JSON.parse(localStorage.getItem(WHO_KEY) || 'null');
    if (w && w.role === 'student' && typeof w.name === 'string') return { role: 'student', name: w.name, grade: null };
  } catch (e) { /* ignore */ }
  return { role: null, name: null, grade: null };
}

type Sync = Awaited<ReturnType<typeof familySync>>;
// "Who's practicing?" (family.ts, screens/Who.tsx) on a parent's device:
// hold: a parent's hint is here, so the first screen waits for /api/me/ (at most HOLD_MS);
// pick: the picker shows in place of the screen; later: it shows once the lesson in progress is over.
type WhoState = 'hold' | 'pick' | 'later' | null;
const HOLD_MS = 4000;

export default function PracticeApp() {
  const [boot] = useState(() => {
    // a streak save covers missed days as soon as the app opens
    return { p: useSaves(load()), last: null };
  });
  const [p, setP] = useState<Progress>(boot.p);
  // A brand-new device opens on the goal questions (Start.tsx) from the first frame, so Home and its nav never flash
  // first (that was a layout shift); Home's own check stays for a device that becomes new later.
  const [route, setRoute] = useState<Route>(() => {
    const r = parse(location.hash);
    if (r.name !== 'home' || !onboardingDue(boot.p)) return r;
    try { history.replaceState(null, '', '#start'); } catch (e) { /* the hash stays as it is */ }
    return { name: 'start', args: [] };
  });
  const [me, setMe] = useState<Me>(() => readWho());
  const [who, setWho] = useState<WhoState>(() => (parentHint() ? 'hold' : null));
  const sync = useRef<Sync>(null);
  const routeRef = useRef(route);
  routeRef.current = route;
  const [last, setLast] = useState<{ f: Finish; r: Report } | null>(boot.last);
  const [toastMsg, setToastMsg] = useState<{ text: string; badge?: string; n: number } | null>(null);
  // The questions come from the one question bank (/api/app-bank/, saved for offline): load once, re-render when a
  // newer copy arrives so the map and the full tests pick it up.
  const [, setBankV] = useState('');
  useEffect(() => {
    const off = onAppBank((b) => setBankV(b?.version || ''));
    void loadAppBank();
    return () => { off(); };
  }, []);

  // Signed in: progress follows the child to every device (cloud.ts, /api/me/app-progress). The signed-in student, or
  // the child a parent picked here; a guest or a parent just looking around stays on this browser only.
  const cloudWho: CloudWho | null = me.role === 'student' ? { child: null } : me.role === 'parent' && me.as ? { child: me.as } : null;
  const cloudKey = cloudWho ? cloudWho.child || 'student' : '';
  // Every signed-in learner's answers go to the question report (answerlog.ts, /admin/insights/): ids and right/wrong only.
  useEffect(() => { setAnswerWho(cloudWho); }, [cloudKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // once the first screen is up, fetch the other screens while the browser is idle (they are cached for offline too)
  useEffect(() => {
    const warm = () => { for (const f of Object.values(screens)) f().catch(() => { /* offline: loads on first use */ }); };
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(warm, { timeout: 4000 }); else window.setTimeout(warm, 2500);
  }, []);
  useEffect(() => {
    if (!cloudWho) return;
    let gone = false;
    resetCloud();
    void (async () => {
      const merged = await pullProgress(cloudWho, pRef.current);
      if (gone) return;
      if (merged) { setP(merged); save(merged); }
      const again = await pushProgress(cloudWho, merged || pRef.current);
      if (!gone && again) { setP(again); save(again); }
    })();
    const leave = () => { void pushProgress(cloudWho, pRef.current, true); };
    addEventListener('pagehide', leave);
    return () => { gone = true; removeEventListener('pagehide', leave); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudKey]);
  // Every change goes up a few seconds later (one save per burst of answers).
  useEffect(() => {
    if (!cloudWho) return;
    const t = setTimeout(async () => {
      const merged = await pushProgress(cloudWho, pRef.current);
      if (merged) { setP(merged); save(merged); }
    }, 4000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, cloudKey]);
  const pRef = useRef(p);
  pRef.current = p;
  const toastT = useRef<number | undefined>(undefined);

  useEffect(() => {
    const on = () => setRoute(parse(location.hash));
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);

  // The app's own crashes and script errors go to /admin/errors/ (errors.ts).
  useEffect(() => watchErrors(), []);

  // Offline: the service worker keeps the app's files after this visit (offline.ts registers it after load).
  useEffect(() => registerServiceWorker(), []);
  const online = useOnline();
  // Ask the browser to keep this device's progress (quietly, after a few days of practice or once installed).
  useEffect(() => {
    const t = window.setTimeout(() => maybePersist(p.days.length), 4000);
    return () => window.clearTimeout(t);
  }, [p.days.length]);

  // Another tab saved progress: take it, so this tab never writes back an older copy. Also a profile
  // switch (profiles.ts useProfile, in this tab or another): the progress keys now hold that profile's copy.
  useEffect(() => {
    const on = (e: StorageEvent) => {
      if (e.key === 'pe.child.v1') {
        // A lesson in progress belongs to the profile it started in (its answers and saved place): when
        // another tab switches profiles (a picked child, a sign-in or sign-out there), stop the lesson here
        // instead of saving the rest of it into the new profile. Its place so far stays with the old one.
        const idOf = (v: string | null) => { try { const o = JSON.parse(v || 'null'); return o && typeof o.id === 'string' ? o.id : null; } catch (err) { return null; } };
        if (idOf(e.oldValue) !== idOf(e.newValue) && routeRef.current.name === 'play') {
          history.replaceState(null, '', '#home');
          setRoute(parse('#home'));
          toast('This device switched profiles, so the lesson stopped.');
        }
        // another tab switched this device to another child (or back to the guest): follow it
        const cur = currentProfile();
        setMe((m) => {
          // the children are not known here (no answer from /api/me/): follow the profile's own nickname
          if (m.role === 'parent' && m.kidsUnknown) return { ...m, name: cur?.nickname ?? null, as: cur?.id ?? null };
          if (m.role !== 'parent' || !m.kids || !m.kids.length) return m;
          const k = cur ? m.kids.find((x) => x.id === cur.id) : undefined;
          return k ? { ...m, name: k.nickname, grade: k.grade, as: k.id } : { ...m, name: null, grade: null, as: null };
        });
        return;
      }
      if (e.key !== STORAGE_KEY) return;
      const n = load();
      pRef.current = n;
      setP(n);
    };
    addEventListener('storage', on);
    return () => removeEventListener('storage', on);
  }, []);

  // The lesson-complete screen shows once: leaving it forgets the result (no replayed unlocks).
  useEffect(() => {
    if (route.name !== 'done' && last) setLast(null);
  }, [route.name, last]);

  // Who is signed in: a student is greeted by nickname. A parent with children gets "Who's practicing?",
  // so each child practices under their own profile on this device (profiles.ts: progress, and the
  // browser ID that reports and app errors are sent with). Progress itself stays in this browser.
  // No usable answer: keep going with the profile this device already uses (profiles.ts profile(): the child
  // picked here before, or none), with no "Who's practicing?"; Me shows Switch turned off (kidsUnknown).
  // That is no answer within HOLD_MS (the failed-fetch signal then checks the connection: dead Wi-Fi or a
  // cut data plan can leave a request hanging long after the service worker served the saved app), no
  // answer at all (offline), or an error answer (a 429 from the rate limit on a shared school address, a
  // 5xx). Then ask again (meTry): at once when the connection comes back, and after a growing delay.
  const [meTry, setMeTry] = useState(0);
  const meOpen = useRef(false);    // no usable answer yet
  const meFails = useRef(0);       // failed answers in a row (the retry delay grows with them)
  useEffect(() => { if (online && meOpen.current) setMeTry((n) => n + 1); }, [online]);
  useEffect(() => {
    let live = true;
    let retry: number | undefined;
    const release = () => setWho((w) => (w === 'hold' ? null : w));
    const keepGoing = async (failed: boolean) => {
      meOpen.current = true;
      if (failed) {
        meFails.current += 1;
        window.clearTimeout(retry);
        // (with no network at all, the 'online' event asks instead)
        retry = window.setTimeout(() => { if (live && navigator.onLine !== false) setMeTry((n) => n + 1); }, Math.min(15000 * 2 ** (meFails.current - 1), 300000));
      }
      if (parentHint()) {
        const s = await familySync();
        if (!live) return;
        const cur = s ? s.profile() : null;
        // a parent's session known from an earlier answer keeps its children (Switch waits for the connection)
        setMe((m) => (m.role === 'parent' && m.kids ? m : { role: 'parent', name: cur?.nickname ?? null, grade: null, kids: null, as: cur?.id ?? null, kidsUnknown: true }));
      }
      release();
    };
    const timer = window.setTimeout(() => { if (live) { noteNetFail(); keepGoing(false); } }, HOLD_MS);   // no answer yet
    (async () => {
      let d: Record<string, any> | null = null;
      try {
        const r = await fetch('/api/me/', { credentials: 'same-origin' });
        noteNetOk();
        d = r.ok ? await r.json() : null;
      } catch (e) {
        if (e instanceof TypeError) noteNetFail();   // no answer: offline, or the site can't be reached
        d = null;
      }
      if (!live) return;
      window.clearTimeout(timer);
      if (!d || !d.ok) { await keepGoing(true); return; }
      meOpen.current = false;
      meFails.current = 0;
      setPipEnabled(d.pip === true);
      if (d.signedIn && d.role === 'student' && d.child) { setMe({ role: 'student', name: d.child.nickname || null, grade: d.child.grade ?? null, pro: d.plan?.pro === true, proUntil: typeof d.plan?.until === 'string' ? d.plan.until : null, username: typeof d.child.username === 'string' ? d.child.username : null }); release(); return; }
      // Signed out, or a parent: the student hint is stale (session ended), so stop greeting by it and forget
      // it, as /account/ does; signed out, the parent hint is stale too (as My Progress does).
      try { const h = readHint(); if (h === 'student' || (h === 'parent' && !d.signedIn)) localStorage.removeItem(WHO_KEY); } catch (e) { /* ignore */ }
      if (!(d.signedIn && d.role === 'parent')) { setMe({ role: null, name: null, grade: null }); release(); return; }
      const kids = kidsFrom(d.children);
      const email = typeof d.email === 'string' ? d.email : null;
      const s = kids.length ? await familySync() : null;
      if (!live) return;
      // No children yet (Me suggests adding one), or no profile switcher (no profiles to switch): a guest.
      if (!s) { setMe({ role: 'parent', name: null, grade: null, kids: kids.length ? null : [], as: null, email }); release(); return; }
      sync.current = s;
      const cur = s.profile();
      const kid = cur ? kids.find((k) => k.id === cur.id) : undefined;
      if (kid) {
        // This device is already practicing as one of the children: keep going (the nickname may have changed).
        s.useProfile(kid, { separate: true });
        setMe({ role: 'parent', name: kid.nickname, grade: kid.grade, kids, as: kid.id, email });
        release();
        return;
      }
      setMe({ role: 'parent', name: null, grade: null, kids, as: null, email });
      if (justLooking()) {
        // The parent chose "Just looking around" earlier in this tab: the browser's own (anonymous) profile.
        if (cur) { s.useProfile(null); reloadProgress(); }
        release();
        return;
      }
      // Before any other screen; never in the middle of a lesson (a slow answer after the first screen).
      const r = routeRef.current;
      setWho((w) => (w === 'hold' || (r.name !== 'play' && r.name !== 'done') ? 'pick' : 'later'));
    })();
    return () => { live = false; window.clearTimeout(timer); window.clearTimeout(retry); };
  }, [meTry]);

  // The picker held back by a lesson in progress shows once the lesson and its result screen are over.
  useEffect(() => {
    if (who === 'later' && route.name !== 'play' && route.name !== 'done') setWho('pick');
  }, [who, route.name]);

  const motion = p.motion && !reducedMotion();
  const sfx = useCallback((k: Sfx) => playSfx(k, pRef.current.sound), []);
  const buzz = useCallback((ms: number | number[]) => doBuzz(ms, pRef.current.sound), []);
  const go = useCallback((hash: string) => {
    const h = hash.startsWith('#') ? hash : '#' + hash;
    if (location.hash === h) setRoute(parse(h));
    else location.hash = h;
  }, []);

  const toast = useCallback((text: string, badge?: string) => {
    window.clearTimeout(toastT.current);
    setToastMsg((t) => ({ text, badge, n: (t?.n || 0) + 1 }));
    toastT.current = window.setTimeout(() => setToastMsg(null), 3200);
  }, []);
  useEffect(() => () => window.clearTimeout(toastT.current), []);

  const update = useCallback((fn: (p: Progress) => Progress) => {
    const before = pRef.current;
    const next = fn(before);
    if (next === before) return;
    pRef.current = next;
    setP(next);
    save(next);
    const fresh = Object.keys(next.badges).filter((id) => !before.badges[id]);
    if (fresh.length) {
      const b = BADGE_BY_ID[fresh[0]];
      if (b) { toast(`Badge unlocked: ${b.name}`, b.id); playSfx('fanfare', next.sound); }
    }
  }, [toast]);

  const finishPlay = useCallback((f: Finish) => {
    if (!f.sample) logAnswers(f.kind, f.answers.map((a) => ({ id: a.qid, correct: a.correct, ...(a.hints ? { hints: a.hints } : {}), ...(a.pick !== undefined ? { pick: a.pick } : {}) })));
    const { p: next, r } = finish(pRef.current, f);
    pRef.current = next;
    setP(next);
    save(next);
    setLast({ f, r });
    // Replace the lesson in history, so Back from the complete screen does not restart the lesson.
    history.replaceState(null, '', '#done');
    setRoute(parse('#done'));
  }, []);

  // The progress keys now hold another profile's copy (profiles.ts also tells this tab with a storage event).
  const reloadProgress = useCallback(() => {
    const n = load();
    pRef.current = n;
    setP(n);
  }, []);

  // "Who's practicing?": a child. Their own progress comes in (profiles.ts keeps each profile's copy apart).
  const pickKid = useCallback((k: Kid) => {
    const s = sync.current;
    if (!s) return;
    setJustLooking(false);
    s.useProfile({ id: k.id, learner: k.learner, nickname: k.nickname }, { separate: true });
    reloadProgress();
    setLast(null);
    setMe((m) => ({ ...m, role: 'parent', name: k.nickname, grade: k.grade, as: k.id }));
    setWho(null);
    go('#home');
  }, [go, reloadProgress]);

  // "Just looking around": the parent explores as a guest, so nothing is added to a child's progress.
  const lookAround = useCallback(() => {
    const s = sync.current;
    setJustLooking(true);
    if (s && s.profile()) { s.useProfile(null); reloadProgress(); setLast(null); }
    setMe((m) => ({ ...m, name: null, grade: null, as: null }));
    setWho(null);
  }, [reloadProgress]);

  const switchWho = useCallback(() => setWho('pick'), []);

  const ctx: AppCtx = useMemo(() => ({ p, update, route, go, sfx, buzz, motion, me, toast, finishPlay, last, switchWho }),
    [p, update, route, go, sfx, buzz, motion, me, toast, finishPlay, last, switchWho]);

  const picking = who === 'pick' && !!me.kids && me.kids.length > 0;
  const view = who === 'hold' ? 'hold' : picking ? 'who' : route.name;
  useEffect(() => setErrorScreen(view), [view]);

  // A new screen is announced and named: the page title changes, a polite message says where we are, and the
  // focus goes to the screen's heading (or the screen itself), so keyboard and screen reader users start at the top
  // of it instead of on a link that is gone. Not on the first screen of a visit.
  const title = screenTitle(view, route);
  const [said, setSaid] = useState('');
  const firstView = useRef(true);
  useEffect(() => {
    document.title = title + ' | ' + config.name;
    if (firstView.current) { firstView.current = false; return; }
    setSaid(title);
    const t = window.setTimeout(() => {
      const scr = document.querySelector<HTMLElement>('.pa-screen');
      // a screen that already moved the focus into itself (a lesson step, a dialog) keeps it
      if (document.activeElement && document.activeElement !== document.body && scr?.contains(document.activeElement)) return;
      const h = scr?.querySelector<HTMLElement>('h1');
      const target = h || scr;
      if (!target) return;
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    }, 60);
    return () => window.clearTimeout(t);
  }, [title]);

  let screen;
  let tab: Tab | null = null;
  if (who === 'hold') screen = <p className="pa-body wh-wait" role="status">Loading your practice…</p>;
  else if (picking) screen = <Who kids={me.kids!} current={me.as ?? null} onPick={pickKid} onGuest={lookAround} />;
  else switch (route.name) {
    case 'learn': screen = <Learn />; tab = 'learn'; break;
    case 'progress': screen = <ProgressScreen />; tab = 'progress'; break;
    case 'review': screen = <Review />; tab = 'progress'; break;
    case 'test': screen = <FullTest />; tab = 'test'; break;
    case 'exam': screen = <Exam key={route.args.join('/')} />; break;
    case 'me': screen = <MeScreen />; tab = 'me'; break;
    case 'play': {
      screen = <Lesson key={route.args.join('/')} />; break;
    }
    case 'level': screen = <LevelScreen key={route.args.join('/')} />; break;
    case 'start': screen = <Start />; break;
    case 'done': {
      const on = !!last || (import.meta.env.DEV && location.search.includes('moment='));   // dev: a big moment on its own
      screen = on ? <Complete /> : <Home />; tab = on ? null : 'home'; break;
    }
    default: screen = <Home />; tab = 'home';
  }

  return (
    <Ctx.Provider value={ctx}>
      <div className={'pa' + (motion ? '' : ' still')} style={BRAND}>
        <div className={'pa-shell' + (tab ? ' has-nav' : ' no-nav')}>
          {tab ? <button type="button" className="pa-skip" onClick={() => document.querySelector<HTMLElement>('.pa-nav a[aria-current="page"], .pa-nav a.pa-nav-item')?.focus()}>Skip to the menu</button> : null}
          <div className="pa-stage">
            {!online ? (
              <p className="pa-offline" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 3l18 18M8.5 8.6A5 5 0 0 0 7 17h10.5M19.8 16.2A3.5 3.5 0 0 0 17 10h-.6A6 6 0 0 0 11 6.1" />
                </svg>
                <span>You&rsquo;re offline. Your practice is saved on this device.</span>
              </p>
            ) : null}
            <main className="pa-screen" key={view}>
              <Boundary key={view + '/' + route.args.join('/')}><Suspense fallback={<div className="pa-body" aria-busy="true" />}>{screen}</Suspense></Boundary>
            </main>
          </div>
          {/* after the content in the DOM (keyboard and screen readers reach the screen first); the grid
              places it at the bottom on phones and on the left from 600px */}
          {tab ? <Nav active={tab} /> : null}
          <p className="sr" role="status" aria-live="polite">{said}</p>
          <p className="sr" role="status">{toastMsg ? toastMsg.text : ''}</p>
          <p className="sr" role="status">{online ? '' : 'You\u2019re offline. Your practice is saved on this device.'}</p>
          {toastMsg ? (
            <div className="pa-toast fx-popA" key={toastMsg.n} aria-hidden="true">
              {toastMsg.badge ? <BadgeArt id={toastMsg.badge} earned size={40} /> : null}
              <span>{toastMsg.text}</span>
            </div>
          ) : null}
        </div>
      </div>
    </Ctx.Provider>
  );
}

/** The name of the screen on show, for the page title and the route announcement. */
function screenTitle(view: string, route: Route): string {
  switch (view) {
    case 'hold': return 'Loading your practice';
    case 'who': return 'Who is practicing?';
    case 'learn': return 'Learn';
    case 'progress': return 'Progress';
    case 'review': return 'Review mistakes';
    case 'test': return 'Full test';
    case 'exam': return config.fullTest.title;
    case 'me': return 'Me';
    case 'done': return 'Results';
    case 'level': return 'Lesson preview';
    case 'start': return 'Make your plan';
    case 'play': {
      const L = LESSONS[route.args[0] || ''];
      return L ? `Level ${L.level}: ${L.title}` : route.args[0] === 'review' ? 'Review round' : 'Practice';
    }
    default: return 'Home';
  }
}

// If a screen crashes (for example on damaged saved data), offer a way out instead of a blank page.
class Boundary extends Component<{ children: ReactNode }, { failed: boolean; reporting: boolean }> {
  state = { failed: false, reporting: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown, info: { componentStack?: string | null }) { sendAppError('crash', error, info.componentStack || ''); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="pa-body pa-crash" role="alert">
        <h1>Something went wrong</h1>
        <p>Try going back to Home. If it keeps happening, start over on this device.</p>
        <a className="pa-btn green" href="#home" onClick={() => this.setState({ failed: false })}>Back to Home</a>
        <button type="button" className="pa-btn ghost" onClick={() => this.setState({ reporting: true })}>Report this problem</button>
        <button type="button" className="pa-linkbtn" onClick={() => { reset(); location.hash = '#home'; location.reload(); }}>Start over on this device</button>
        {this.state.reporting ? <ReportSheet kind="issue" onClose={() => this.setState({ reporting: false })} /> : null}
      </div>
    );
  }
}
