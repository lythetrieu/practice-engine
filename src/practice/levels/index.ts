// The map lessons' levels, built from the pack's questions (fromBank.ts), and every step by its saved key.
// The bank loads after the first screen (../appBank.ts): until then no lesson has a level, and the screens wait.
import { LESSONS } from '../curriculum';
import type { Level, Step } from './types';
import { buildLevel, stopPool, type BankItem, type BankPassage, type Teach } from './fromBank';
import { appBank, onAppBank } from '../appBank';

let POOL: BankItem[] = [];
let PASSAGES: Record<string, BankPassage> = {};
let TEACH: Record<string, Teach> = {};
const BANK_LEVELS: Record<string, Level> = {};
/** The raw bank (every question and passage), for generated full tests (tutor/testgen.ts). */
export const rawBank = (): { items: BankItem[]; passages: Record<string, BankPassage> } => ({ items: POOL, passages: PASSAGES });
/** A passage by id (reading steps show it beside the question). */
export const passageOf = (pid: string | undefined) => (pid ? PASSAGES[pid] : undefined);
/** True when a map stop plays a level built from the pack. */
export const isBankLevel = (lessonId: string) => lessonId in BANK_LEVELS;

/** Lesson id -> its level. One object, refilled in place when the bank arrives, so importers keep their reference. */
export const LEVEL_OF: Record<string, Level> = {};
export const levelOf = (lessonId: string | undefined) => (lessonId ? LEVEL_OF[lessonId] : undefined);

const STEPS: Record<string, Step> = {};

function rebuild() {
  const b = appBank();
  POOL = b?.items || [];
  PASSAGES = b?.passages || {};
  TEACH = b?.teach || {};
  for (const k of Object.keys(BANK_LEVELS)) delete BANK_LEVELS[k];
  for (const l of Object.values(LESSONS)) { const lv = buildLevel(l, POOL, TEACH[l.id], undefined, PASSAGES); if (lv) BANK_LEVELS[l.id] = lv; }
  for (const k of Object.keys(LEVEL_OF)) delete LEVEL_OF[k];
  Object.assign(LEVEL_OF, BANK_LEVELS);
  // Steps by key (mistakes and half-done rounds are saved as "<level id>/<step id>"); keys from an older pack stay.
  for (const lv of Object.values(LEVEL_OF)) for (const s of lv.steps) STEPS[`${lv.id}/${s.id}`] = s;
  for (const k of Object.keys(POOLS)) delete POOLS[k];
  for (const l of Object.values(LESSONS)) {
    POOLS[l.id] = stopPool(l, POOL).map((x) => ({ key: `${l.id}/${x.step.id}`, step: x.step, d: x.it.d, pid: x.it.pid, own: true }));
    // also by the bare question id: a full test serves questions under it, and Review replays its misses
    for (const x of POOLS[l.id]) { STEPS[x.key] ??= x.step; STEPS[x.step.id] ??= x.step; }
  }
  for (const it of POOL) STEPS[it.id] ??= it.step;
}

/** A question a stop can use, with its saved key ("<stop id>/<item id>"), level (1 easy .. 5 hard) and passage. */
export interface PoolItem { key: string; step: Step; d: number; pid?: string; own: boolean }
const POOLS: Record<string, PoolItem[]> = {};
/** Every question of a stop (empty while the bank has none for it). */
export const stopItems = (stop: string): PoolItem[] => POOLS[stop] || [];
rebuild();
onAppBank(rebuild);

/** A replay of a lesson the student already finished: a different mix of its questions when it has more than one
    level's worth. Same steps for the same seed; undefined for other stops. */
export function levelVariant(lessonId: string, seed: number): Level | undefined {
  const l = LESSONS[lessonId];
  if (!l || !BANK_LEVELS[lessonId]) return undefined;
  return buildLevel(l, POOL, TEACH[lessonId], seed, PASSAGES);
}
/** A level made of saved step keys (to resume a half-done replay). */
export function levelFromKeys(base: Level, keys: string[]): Level | undefined {
  const steps = keys.map((k) => STEPS[k]);
  return steps.every(Boolean) ? { ...base, steps: steps as Step[] } : undefined;
}

/** A level step's id as saved in progress (mistakes, a half-done level): "<level id>/<step id>". */
export const stepKey = (lv: Level, s: Step) => `${lv.id}/${s.id}`;
export const stepById = (key: string): Step | undefined => STEPS[key];
