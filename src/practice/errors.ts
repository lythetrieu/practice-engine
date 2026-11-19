// The app reports its own crashes and script errors to /api/app-error/,
// shown at /admin/errors/. Technical details only: the error text and code location, the screen, the
// device type, the screen size and the app version. At most 5 different errors per page load.
import { APP_VERSION, device } from './report';
import { send } from '../lib/client/outbox';

let screenNow = 'other';
const sentKeys = new Set<string>();
// The last screens opened in this visit and the last error sent, attached to "Report an app problem"
// so a report says where the student had been even when they pick "Somewhere else".
const trail: { s: string; at: number }[] = [];
let lastError: { message: string; at: number } | null = null;
const MAX_PER_LOAD = 5;

/** Which screen is showing (set by the shell on every route change). */
export function setErrorScreen(route: string) {
  screenNow = route === 'play' ? 'lesson' : route === 'done' ? 'complete' : ['home', 'learn', 'review', 'test', 'me'].includes(route) ? route : 'other';
  if (trail[trail.length - 1]?.s !== screenNow) trail.push({ s: screenNow, at: Date.now() });
  if (trail.length > 8) trail.shift();
}

let stepNow: string | null = null;
/** The level step on screen (set by screens/Level.tsx): "<stop id>#<step number>:<kind>:<question or step id>", or null. */
export function setErrorStep(step: string | null) {
  stepNow = step;
  if (step) { trail.push({ s: 'step ' + step, at: Date.now() }); if (trail.length > 8) trail.shift(); }
}

/** Screens opened before now, oldest first, with seconds ago; and the last app error (seconds ago). */
export function recentContext() {
  const now = Date.now();
  return {
    trail: trail.map((x) => ({ s: x.s, ago: Math.round((now - x.at) / 1000) })),
    step: stepNow,
    lastError: lastError ? { message: lastError.message.slice(0, 200), ago: Math.round((now - lastError.at) / 1000) } : null,
  };
}

/** The screen the student most likely means: the last one before Me (where the report button is). */
export function likelyScreen() {
  for (let i = trail.length - 1; i >= 0; i--) if (trail[i].s !== 'me') return trail[i].s;
  return 'other';
}

function textOf(err: unknown): { message: string; stack: string } {
  if (err instanceof Error) return { message: `${err.name}: ${err.message}`, stack: err.stack || '' };
  if (typeof err === 'string') return { message: err, stack: '' };
  try { return { message: JSON.stringify(err).slice(0, 300), stack: '' }; } catch (e) { return { message: String(err), stack: '' }; }
}

export function sendAppError(kind: 'crash' | 'error' | 'promise', err: unknown, extraStack = '') {
  try {
    const { message, stack } = textOf(err);
    if (!message || /^Script error\.?$/.test(message) || /ResizeObserver loop/.test(message)) return;
    const key = kind + '|' + message;
    if (sentKeys.has(key) || sentKeys.size >= MAX_PER_LOAD) return;
    sentKeys.add(key);
    lastError = { message, at: Date.now() };
    const body = {
      kind, message: message.slice(0, 300),
      stack: (stack + (extraStack ? '\n--- component ---' + extraStack : '')).split(location.origin).join('').slice(0, 1500),
      screen: screenNow, ...(stepNow ? { step: stepNow } : {}), device: device(), w: innerWidth, h: innerHeight, ver: APP_VERSION,
    };
    send('/api/app-error/', body).catch(() => {});
  } catch (e) { /* reporting must never break the app */ }
}

/** Listen for errors outside React's render (event handlers, timers, promises). Returns the cleanup. */
export function watchErrors() {
  const onError = (e: ErrorEvent) => {
    // errors from browser extensions or other sites' scripts are not ours
    if (e.filename && !e.filename.startsWith(location.origin)) return;
    sendAppError('error', e.error ?? e.message);
  };
  const onRejection = (e: PromiseRejectionEvent) => sendAppError('promise', e.reason);
  addEventListener('error', onError);
  addEventListener('unhandledrejection', onRejection);
  return () => { removeEventListener('error', onError); removeEventListener('unhandledrejection', onRejection); };
}
