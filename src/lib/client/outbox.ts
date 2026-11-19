// Sends a problem report or an app error, with the learner ID it belongs to (lib/client/profiles.ts). With no
// connection the send waits in an outbox on this device and goes out when the browser is back online (or on the
// next visit). The server's bot check, when it asks for one, runs through lib/client/human.ts.
import { learnerId } from './profiles';
import { postChecked } from './human';

const KEY = 'pe.outbox.v1';
const MAX = 20;
type Entry = { path: string; body: Record<string, unknown>; at: number };
export interface SendReply { ok?: boolean; queued?: boolean; error?: string }

const read = (): Entry[] => { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const write = (v: Entry[]) => { try { if (v.length) localStorage.setItem(KEY, JSON.stringify(v.slice(-MAX))); else localStorage.removeItem(KEY); } catch { /* storage blocked */ } };
const offline = (e?: string) => typeof navigator !== 'undefined' && navigator.onLine === false || /reach the site/i.test(e || '');

export async function send(path: string, body: Record<string, unknown>): Promise<SendReply> {
  const full = { ...body, learner: learnerId() };
  const r = await postChecked(path, full, 'report');
  if (r.ok) return { ok: true };
  if (offline(r.error)) { write([...read(), { path, body: full, at: Date.now() }]); return { queued: true, error: 'offline' }; }
  return { ok: false, error: r.error };
}

let flushing = false;
/** Sends what waits in the outbox (oldest first); stops at the first one that still cannot go. */
export async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    let list = read();
    while (list.length) {
      const r = await postChecked(list[0].path, list[0].body, 'report');
      if (!r.ok && offline(r.error)) break;
      list = list.slice(1);   // sent, or refused for good (no point in sending it again)
      write(list);
    }
  } finally { flushing = false; }
}

if (typeof window !== 'undefined') {
  addEventListener('online', () => { void flush(); });
  if (read().length) window.setTimeout(() => { void flush(); }, 5000);
}
