// Profiles on one browser: each child of a family practices under their own profile, so a shared computer keeps
// every child's progress apart. Switching stashes the current profile's practice data (the keys in LOCAL) and
// brings back the other's. A browser with no child picked uses the "anon" profile (a guest, or a parent looking
// around). Used by the app (src/practice/family.ts) and the account and student sign-in pages.
//
// The anonymous browser ID (browserId) labels problem reports and app errors from a guest; a picked child's
// reports carry the child's learner ID instead.
import { config } from '../../pack';

const P = `pe.${config.id}.`;
const K = { child: 'pe.child.v1', stash: `${P}stash.v1.`, id: 'pe.id.v1' };
/** The keys that belong to a profile: practice progress, the full test in progress, finished tests. */
export const LOCAL = [`${P}app.v1`, `${P}testsave.v1`, `${P}tests.v1`];

export interface Profile { id: string; learner: string; nickname?: string }

const get = <T>(k: string, fallback: T): T => { try { const v = localStorage.getItem(k); return v == null ? fallback : (JSON.parse(v) as T); } catch { return fallback; } };
const put = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
const drop = (k: string) => { try { localStorage.removeItem(k); } catch { /* storage blocked */ } };

/** The child this browser practices as now, or null (the anonymous profile). */
export function profile(): Profile | null {
  const p = get<Profile | null>(K.child, null);
  return p && typeof p.id === 'string' && typeof p.learner === 'string' ? p : null;
}

/**
 * Makes `p` the profile this browser uses (null: the anonymous one). The first child picked on a browser takes over
 * what it saved before, unless `separate` (a parent's shared device, where the guest's practice stays the guest's).
 * Other tabs hear about it through the storage event on K.child.
 */
export function useProfile(p: Profile | null, opts: { separate?: boolean } = {}) {
  const cur = profile();
  const from = cur ? cur.id : 'anon', to = p ? p.id : 'anon';
  if (from === to) { if (p) put(K.child, p); return; }
  const stashed = get<{ data: unknown[] } | null>(K.stash + to, null);
  const takeOver = !cur && !!p && !stashed && !opts.separate;
  if (!takeOver) {
    put(K.stash + from, { data: LOCAL.map((k) => get(k, null)) });
    for (const k of LOCAL) drop(k);
    if (stashed) { stashed.data.forEach((v, i) => { if (v != null && LOCAL[i]) put(LOCAL[i], v); }); drop(K.stash + to); }
  }
  if (p) put(K.child, { id: p.id, learner: p.learner, nickname: p.nickname }); else drop(K.child);
}

/** Sign-out or a deleted account: back to the anonymous profile; with `forget`, every child's copy here goes too. */
export function leaveAccount(forget = false) {
  useProfile(null);
  if (!forget) return;
  try { Object.keys(localStorage).filter((k) => k.startsWith(K.stash) && k !== K.stash + 'anon').forEach((k) => localStorage.removeItem(k)); } catch { /* storage blocked */ }
}

/** A random ID for this browser (16 characters), made on first use; never shown and never linked to a person. */
export function browserId(): string {
  let v = get<string | null>(K.id, null);
  if (typeof v !== 'string' || !/^[0-9A-Z]{16}$/.test(v)) {
    const abc = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    v = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => abc[b & 31]).join('');
    put(K.id, v);
  }
  return v;
}
/** The learner ID reports go under: the picked child's, else this browser's. */
export const learnerId = () => profile()?.learner ?? browserId();

/** "Who is signed in here" hint the account pages leave for the app (role and the student's nickname). */
export const WHO_KEY = 'pe.who.v1';
