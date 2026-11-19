// The questions the app plays: the pack's compiled bank (questions as steps, passages, lessons' teaching steps).
// It comes in its own JavaScript chunk (virtual:pack-bank, src/pack/vite.mjs), loaded after the first screen, and
// the service worker keeps it for offline play. bankStatus() tells a screen whether to wait for it.
//
// The bank is one part. The part-based calls (needParts, partsReady, partsMissing) are kept so a pack could later be
// split into parts that load on demand.
import type { Bank } from '../pack/types';

export type AppBankData = Bank;
export type BankPart = 'bank';
export const ALL_PARTS: BankPart[] = ['bank'];

let current: Bank | null = null;
const listeners = new Set<(b: Bank | null) => void>();
/** loading: not here yet; ready: here; failed: it could not load (offline on a first visit). */
export type BankStatus = 'loading' | 'ready' | 'failed';
let status: BankStatus = 'loading';
let pending: Promise<Bank | null> | null = null;

/** The bank, or null before it has loaded. */
export const appBank = () => current;
export const hasAppBank = () => !!current && current.items.length > 0;
export const bankStatus = () => status;
export const bankSettled = () => status !== 'loading';
export function onAppBank(fn: (b: Bank | null) => void) { listeners.add(fn); return () => listeners.delete(fn); }

/** Loads the bank once (later calls share the first load; a failed load is tried again). */
export function loadAppBank(): Promise<Bank | null> {
  if (current) return Promise.resolve(current);
  if (pending) return pending;
  pending = import('virtual:pack-bank')
    .then((m) => {
      current = m.default;
      status = 'ready';
      for (const fn of listeners) fn(current);
      return current;
    })
    .catch(() => {
      status = 'failed';
      pending = null;
      for (const fn of listeners) fn(null);
      return null;
    });
  return pending;
}

export const needParts = (_parts: BankPart[] = ALL_PARTS): Promise<void> => loadAppBank().then(() => undefined);
export const partsReady = (_parts: BankPart[] = ALL_PARTS) => status !== 'loading';
export const partsMissing = (_parts: BankPart[] = ALL_PARTS): BankPart[] => (status === 'failed' ? ['bank'] : []);
export const partsFor = (_id?: string): BankPart[] => ALL_PARTS;

if (typeof window !== 'undefined') window.addEventListener('online', () => { if (status === 'failed') void loadAppBank(); });
