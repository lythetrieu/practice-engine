// The full test in progress, saved on this device after every answer and every few seconds of the clock, so a
// closed tab or a dead battery never loses it. The clock only runs while the test is open.
import { config } from '../../pack';
import type { Ans } from '../levels/grade';
import type { ExamPlan } from './build';

export interface ExamSave {
  v: 1;
  plan: ExamPlan;
  /** The section on screen, and the question within it. */
  sec: number;
  q: number;
  /** 'intro': the card before a section; 'run': answering; 'review': the section's question list before submitting. */
  phase: 'intro' | 'run' | 'review';
  answers: Record<string, Ans>;
  flags: string[];
  /** Seconds left on the running clock (the section's or the test's), null with no clock. */
  left: number | null;
  /** Seconds spent per section. */
  spent: number[];
  at: number;
}

export const SAVE_KEY = `pe.${config.id}.testsave.v1`;
const MAX_AGE = 14 * 864e5;

export function readSave(): ExamSave | null {
  try {
    const v = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (!v || v.v !== 1 || !v.plan || !Array.isArray(v.plan.sections) || Date.now() - (v.at || 0) > MAX_AGE) return null;
    return v as ExamSave;
  } catch { return null; }
}
export function writeSave(s: ExamSave) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ ...s, at: Date.now() })); } catch { /* storage full or blocked */ }
}
export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* storage blocked */ }
}

/** "1:05:09" or "4:09" */
export function clock(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}
