// The compiled pack as the app receives it (src/pack/load.mjs builds it; src/pack/vite.mjs serves it as
// `virtual:pack` and `virtual:pack-bank`). The pack's own file format is in src/pack/schema.mjs.
import type { Step, LearnStep } from '../practice/levels/types';

export interface PackSection { id: string; name: string; short?: string; description?: string }
export type SectionScale = { type: 'linear'; min: number; max: number } | { type: 'table'; table: [number, number][] };
export interface PackConfig {
  id: string; name: string; exam: string; examFull?: string; tagline: string;
  audience?: { label: string; options: { value: number; label: string }[] };
  brand: { logo: string; colors: { primary: string; primaryDark?: string; accent: string; reward?: string; background?: string; frame?: string } };
  mascot: { name: string; image?: string };
  legal?: { operator: string; contactEmail: string; address?: string; governingLaw?: string; effectiveDate: string };
  sections: PackSection[];
  formats: string[];
  practice: { dailyGoal: number; lessonQuestions: number; reviewRound: number; checkPass: number };
  fullTest: {
    title: string; intro: string; timing: 'total' | 'per-section'; minutes?: number; sectionOrder: 'choose' | 'fixed';
    sections: { section: string; questions: number; minutes?: number; allowBack: boolean; skills?: Record<string, number> }[];
    timeOptions: { id: string; label: string; note?: string; factor: number | null }[];
    rules: string[];
  };
  scoring: {
    label: string; disclaimer: string; sections: Record<string, SectionScale>;
    composite: 'sum' | 'average' | 'none'; compositeLabel: string; margin: number; round: number;
    benchmarks: { label: string; score: number }[];
  };
  tips: Record<string, string[]>;
  testDates: { date: string; label: string; who?: string; grades?: number[] }[];
  site: { url?: string; title: string; description: string; heroTitle: string; heroText: string; features: { title: string; text: string }[]; faq: { q: string; a: string }[]; disclaimer: string };
}
export interface PackLesson { id: string; section: string; world: number; level: number; title: string; skills: string[]; icon?: string }
export interface PackWorld { section: string; n: number; name: string; unit: string; lessons: PackLesson[] }
export interface Pack {
  config: PackConfig;
  /** The logo, an SVG document checked by the validator. */
  logo: string;
  /** The mascot, an SVG document ('' = the engine's own bird). */
  mascot: string;
  skills: Record<string, { id: string; name: string; section: string; requires: string[] }>;
  worlds: PackWorld[];
  /** Scored questions per section. */
  counts: Record<string, number>;
}

/** A question of the pack, compiled to the step the engine plays. */
export interface BankItem { id: string; section: string; skill: string; d: number; pid?: string; step: Step }
export interface BankPassage { id: string; title?: string; genre?: string; kind?: string; intro?: string; paras?: string[]; src?: string; tbl?: { caption?: string; cols: string[]; rows: string[][] }; tblAfter?: number }
export interface Teach { warmup?: Step; learn: LearnStep; guided: Step[]; mistake?: Step }
export interface Bank { version: string; items: BankItem[]; passages: Record<string, BankPassage>; teach: Record<string, Teach> }
