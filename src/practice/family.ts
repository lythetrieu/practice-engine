// Family profiles on a shared device. A parent signed in on this browser lets each
// child practice under their own profile without a password; the account
// itself stays protected, since every account change asks the parent to sign in again (403 {reauth}).
// The profiles themselves live in src/lib/client/profiles.ts: progress and the ID reports go under follow the
// profile picked here.

import { profile, useProfile, WHO_KEY } from '../lib/client/profiles';

/** A child on the parent's account, from GET /api/me/. The nickname is parent-typed: render as text only. */
export interface Kid { id: string; learner: string; nickname: string; grade: number | null; pro?: boolean }

interface FamilySync {
  profile: () => { id: string; nickname?: string } | null;
  useProfile: (p: { id: string; learner: string; nickname: string } | null, opts?: { separate?: boolean }) => string | null;
}

/** The profile switcher (kept async so a future one may load on demand). */
export function familySync(): Promise<FamilySync | null> {
  return Promise.resolve({ profile, useProfile: (p, opts) => { useProfile(p, opts); return p ? p.id : null; } });
}

/** Children from a parent's /api/me/ answer, kept only when well formed (at most 3 per account). */
export function kidsFrom(list: unknown): Kid[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((c) => {
    if (!c || typeof c !== 'object') return [];
    const k = c as Record<string, unknown>;
    if (typeof k.id !== 'string' || typeof k.learner !== 'string' || typeof k.nickname !== 'string' || !k.nickname.trim()) return [];
    const g = Number(k.grade);
    const pro = !!(k.pro && typeof k.pro === 'object' && (k.pro as { pro?: unknown }).pro === true);
    return [{ id: k.id, learner: k.learner, nickname: k.nickname.trim(), grade: k.grade != null && Number.isInteger(g) && g > 0 ? g : null, pro }];
  }).slice(0, 3);
}

// "Just looking around": the parent chose to explore as a guest in this browser tab (sessionStorage, so a
// new tab or a new visit asks again).
const LOOKING = 'pe.app.who.v1';
export function justLooking(): boolean {
  try { return sessionStorage.getItem(LOOKING) === 'parent'; } catch (e) { return false; }
}
export function setJustLooking(on: boolean) {
  try { if (on) sessionStorage.setItem(LOOKING, 'parent'); else sessionStorage.removeItem(LOOKING); } catch (e) { /* storage blocked */ }
}

/** The account page's hint that a parent is signed in here (WHO_KEY): the app waits for /api/me/
    before the first screen, so a child never starts a lesson under the wrong profile. */
export function parentHint(): boolean {
  try { const w = JSON.parse(localStorage.getItem(WHO_KEY) || 'null'); return !!w && w.role === 'parent'; } catch (e) { return false; }
}

/** The fixed avatar color of each child, by their order on the account. */
export const KID_COLORS: { bg: string; edge: string; ink: string }[] = [
  { bg: 'var(--primary)', edge: 'var(--primary-edge)', ink: '#FFFFFF' },
  { bg: 'var(--accent)', edge: 'var(--accent-edge)', ink: '#FFFFFF' },
  { bg: 'var(--reward)', edge: 'var(--reward-edge)', ink: '#3D2A06' },
];

/** The avatar color of the child practicing now on a parent's device, or null (student, guest). */
export function kidColor(me: { role: string | null; kids?: Kid[] | null; as?: string | null }) {
  if (me.role !== 'parent' || !me.kids || !me.as) return null;
  const i = me.kids.findIndex((k) => k.id === me.as);
  return i >= 0 ? KID_COLORS[i % KID_COLORS.length] : null;
}

/** First letter of a nickname for an avatar (whole characters, so an accented or non-Latin letter stays whole). */
export const initialOf = (name: string) => (Array.from(name.trim())[0] || '').toUpperCase();
