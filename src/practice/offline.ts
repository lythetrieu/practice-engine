// Offline and install. Many students practice with
// no data at home or on a school Chromebook, so after one online visit the app opens and works with no
// connection: the service worker (/app/sw.js, made by scripts/build-sw.mjs) keeps the app's files, and
// progress was already kept in this browser (store.ts). Problem reports and app errors wait in an
// outbox and go when the connection is back.
// This file: registering the service worker, knowing whether we are online, asking the browser to keep
// the saved data (persistent storage), and the install prompt (Android, Chromebook) or the Home Screen
// steps (iPhone, iPad).
import { useSyncExternalStore } from 'react';
import { flush } from '../lib/client/outbox';

const isBrowser = typeof window !== 'undefined';

/** Registers the service worker once the page has loaded (production builds only: `astro dev` has no sw.js). */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !isBrowser || !('serviceWorker' in navigator)) return;
  const go = () => { navigator.serviceWorker.register('/app/sw.js', { scope: '/app/', updateViaCache: 'none' }).catch(() => { /* private mode, blocked */ }); };
  if (document.readyState === 'complete') go();
  else addEventListener('load', go, { once: true });
}

// ---------------------------------------------------------------- online or not
// navigator.onLine is false only when the device surely has no network; true can still mean dead Wi-Fi.
// So when a request to our server fails (noteNetFail: the failed-fetch signal), a small probe checks
// whether the site can be reached at all, and while it can't, the app counts as offline and probes again
// now and then. The probe is a HEAD request for the app's manifest: the service worker lets anything
// that is not a GET go to the network, and a static file costs the server nothing.
const PROBE = '/app/manifest.webmanifest';
const PROBE_EVERY = 20000;
let unreachable = false;
let probing: Promise<void> | null = null;
let probeTimer: number | undefined;
const listeners = new Set<() => void>();
let online = !isBrowser || navigator.onLine !== false;

function update() {
  const now = navigator.onLine !== false && !unreachable;
  if (now === online) return;
  online = now;
  // Back online: send the reports and app errors waiting in the outbox. lib/client/outbox.ts also does this on the
  // browser's 'online' event, but not when only the probe saw the connection come back. flush() runs once at a time.
  if (now) void flush();
  listeners.forEach((f) => f());
}

function probe(): Promise<void> {
  if (probing) return probing;
  probing = (async () => {
    const ctl = new AbortController();
    const t = window.setTimeout(() => ctl.abort(), 8000);
    // Any answer means the site can be reached (the site is HTTPS only, so a Wi-Fi sign-in page can't answer for it).
    try { await fetch(PROBE, { method: 'HEAD', cache: 'no-store', signal: ctl.signal }); unreachable = false; } catch (e) { unreachable = true; }
    window.clearTimeout(t);
    probing = null;
    update();
    window.clearTimeout(probeTimer);
    if (unreachable) probeTimer = window.setTimeout(() => { if (document.visibilityState === 'visible') probe(); else probeTimer = undefined; }, PROBE_EVERY);
  })();
  return probing;
}

/** A request to our server failed with no answer (fetch threw). */
export function noteNetFail() {
  if (!isBrowser) return;
  if (navigator.onLine === false) update();
  else probe();
}
/** A request to our server got an answer. */
export function noteNetOk() {
  if (!isBrowser || !unreachable) return;
  unreachable = false;
  window.clearTimeout(probeTimer);
  update();
}

let watching = false;
function watch() {
  if (watching || !isBrowser) return;
  watching = true;
  addEventListener('offline', update);
  addEventListener('online', () => { if (unreachable) probe(); else update(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && unreachable) probe(); });
}

/** true while the app can reach the site; false offline. Re-renders on changes. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (f) => { watch(); listeners.add(f); return () => { listeners.delete(f); }; },
    () => online,
    () => true,
  );
}

// ---------------------------------------------------------------- installed or not
/** Running as an installed app (home screen, shelf, app window), not in a browser tab. */
export function isInstalled(): boolean {
  if (!isBrowser) return false;
  try {
    return matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  } catch (e) { return false; }
}

/** iPhone, iPad (iPadOS asks for desktop pages, so a "Mac" with a touch screen is an iPad), or neither. */
export function appleDevice(): 'iPhone' | 'iPad' | null {
  if (!isBrowser) return null;
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/iPhone|iPod/.test(ua)) return 'iPhone';
  return null;
}

// ---------------------------------------------------------------- persistent storage
// Browsers may clear a site's saved data when the device runs low on space (and Safari after about 7 days
// without a visit). navigator.storage.persist() asks to keep it. Chrome and Safari decide on their own,
// without asking the user (Chrome: an installed app or a site used often; Safari: "based on heuristics
// like whether the website is opened as a Home Screen Web App", https://webkit.org/blog/14403/updates-to-storage-policy/).
// Firefox shows a permission prompt instead, so it is not asked. Asked once in the browser after a few
// days of practice (never on the first open), and once more when the app runs installed.
const PERSIST_KEY = 'pe.app.persist.v1';
const PERSIST_AFTER_DAYS = 3;
export function maybePersist(practiceDays: number) {
  if (!isBrowser) return;
  const st = navigator.storage;
  if (!st || typeof st.persist !== 'function' || typeof st.persisted !== 'function') return;
  if (/Firefox\//.test(navigator.userAgent)) return;
  const app = isInstalled();
  if (!app && practiceDays < PERSIST_AFTER_DAYS) return;
  let asked: string | null = null;
  try { asked = localStorage.getItem(PERSIST_KEY); } catch (e) { return; }
  if (asked === 'app' || (asked === 'browser' && !app)) return;
  try { localStorage.setItem(PERSIST_KEY, app ? 'app' : 'browser'); } catch (e) { return; }
  st.persisted().then((yes) => (yes ? true : st.persist())).catch(() => { /* ignore */ });
}

// ---------------------------------------------------------------- install
// Android and Chromebook (Chrome, Edge): the browser's install prompt, kept for the app's own "Install the
// app" button. The page's inline script (src/pages/app/index.astro) catches it if it comes before this
// module loads; both stop Chrome's own mini-infobar, which could pop up in the middle of a lesson.
// iPhone and iPad: no prompt to keep; the button shows the Share > Add to Home Screen steps instead.
interface InstallPrompt extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
type Win = Window & { __installPrompt?: InstallPrompt | null };
let deferred: InstallPrompt | null = isBrowser ? ((window as Win).__installPrompt ?? null) : null;
let installedNow = false;
const installListeners = new Set<() => void>();
const installChanged = () => installListeners.forEach((f) => f());
if (isBrowser) {
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as InstallPrompt; installChanged(); });
  addEventListener('appinstalled', () => { deferred = null; (window as Win).__installPrompt = null; installedNow = true; installChanged(); });
}

/** How this device can install the app: the browser's prompt, the iPhone/iPad steps, or not at all (already
    installed, or a browser with neither, such as Firefox on a computer). */
export type InstallWay = 'prompt' | 'ios' | null;
function installWay(): InstallWay {
  if (!isBrowser || installedNow || isInstalled()) return null;
  if (deferred) return 'prompt';
  return appleDevice() ? 'ios' : null;
}
export function useInstallWay(): InstallWay {
  return useSyncExternalStore(
    (f) => { installListeners.add(f); return () => { installListeners.delete(f); }; },
    installWay,
    () => null,
  );
}

/** Shows the browser's install prompt (it can be shown once; the browser offers a new one on a later visit). */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const e = deferred;
  if (!e) return 'unavailable';
  deferred = null;
  (window as Win).__installPrompt = null;
  installChanged();
  try {
    await e.prompt();
    return (await e.userChoice).outcome;
  } catch (err) { return 'unavailable'; }
}

// The Home card that suggests installing (screens/Home.tsx): from the second day of practice, until it is
// dismissed or used. One flag for this device, whoever is practicing.
const CARD_KEY = 'pe.app.install.v1';
export function installCardDismissed(): boolean {
  try { return localStorage.getItem(CARD_KEY) === 'done'; } catch (e) { return true; }
}
export function dismissInstallCard() {
  try { localStorage.setItem(CARD_KEY, 'done'); } catch (e) { /* storage blocked */ }
}
