// The practice app's map, from the pack's curriculum.yaml: for each section, its worlds; for each world, its
// lessons, then a reward chest and a unit check. Lesson ids are "<section>-<world>-<level>" (world numbered within
// its section), the keys saved progress uses.

/** A section of the test (the pack's sections[].id). Called "subject" in the app's code and saved progress. */
export type Subject = string;
export type StopKind = 'lesson' | 'chest' | 'check';

import { pack, config, sectionShort } from '../pack';
import { ICONS } from './artdata';

export interface Lesson {
  id: string;          // stable key in saved progress: "math-1-3"
  subject: Subject;
  world: number;       // 1..n within the section
  level: number;       // 1..n within the world
  title: string;
  art: string;         // the token drawing (artdata.ts); 'num' = a plain coin with the level number
  skills: string[];    // the pack's skill ids the lesson draws its questions from
}

export interface World {
  subject: Subject;
  n: number;
  name: string;
  unit: string;        // shown under the world name
  lessons: Lesson[];
}

/** Sections that have worlds on the map, in the pack's order. */
export const SUBJECTS: Subject[] = config.sections.map((s) => s.id).filter((id) => pack.worlds.some((w) => w.section === id));
export const WORLDS: Record<Subject, World[]> = Object.fromEntries(SUBJECTS.map((s) => [s, [] as World[]]));
export const LESSONS: Record<string, Lesson> = {};

for (const w of pack.worlds) {
  const lessons = w.lessons.map((l) => {
    const art = l.icon && ICONS.includes(l.icon) ? l.icon : 'num';
    const lesson: Lesson = { id: l.id, subject: w.section, world: w.n, level: l.level, title: l.title, art, skills: l.skills };
    LESSONS[lesson.id] = lesson;
    return lesson;
  });
  WORLDS[w.section].push({ subject: w.section, n: w.n, name: w.name, unit: w.unit, lessons });
}

export const worldCount = (s: Subject) => WORLDS[s]?.length ?? 0;
/** Lessons in a world (worlds may differ). */
export const lessonsIn = (s: Subject, w: number) => WORLDS[s]?.[w - 1]?.lessons.length ?? 0;
export const CHECK_QUESTIONS = 10;      // a unit check
export const LESSON_QUESTIONS = config.practice.lessonQuestions;
export const XP_PER_CORRECT = 5;
export const DAILY_GOAL = config.practice.dailyGoal;   // questions answered per day
export const QUEST_XP = 15;             // reward when a daily quest's chest is opened

export const chestId = (s: Subject, w: number) => `${s}-${w}-chest`;
export const checkId = (s: Subject, w: number) => `${s}-${w}-check`;
export const isSubject = (s: unknown): s is Subject => typeof s === 'string' && SUBJECTS.includes(s);
/** The short name shown on toggles and chips ("Math", "Verbal"). */
export const SUBJECT_NAME: Record<Subject, string> = Object.fromEntries(SUBJECTS.map((s) => [s, sectionShort(s)]));
/** Lesson, chest or check id -> its section, world (and level for a lesson). */
export function parseStopId(id: string): { subject: Subject; world: number; rest: string } | null {
  for (const s of SUBJECTS) {
    if (!id.startsWith(s + '-')) continue;
    const m = /^(\d+)-(.+)$/.exec(id.slice(s.length + 1));
    if (m) return { subject: s, world: +m[1], rest: m[2] };
  }
  return null;
}

const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SUBJ = `(?:${SUBJECTS.map(esc).join('|') || '_'})`;
/** A lesson id ("math-1-3"), checked against the pack's sections. */
export const LESSON_ID_RE = new RegExp(`^${SUBJ}-\\d+-\\d+$`);
/** A saved question key that starts with its lesson ("math-1-3/item-id"). */
export const LESSON_KEY_RE = new RegExp(`^${SUBJ}-\\d+-\\d+\\/`);
export const isLessonId = (x: unknown): x is string => typeof x === 'string' && LESSON_ID_RE.test(x);
