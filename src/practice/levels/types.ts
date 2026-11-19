// A level: about 10 steps, each its own kind of activity, from "understand" to "do it like the real test".
// Each activity trains one of the exam's question types (`format`), so by test day none of them is new.
// The steps come from the pack (src/pack/load.mjs turns a pack question into one of these).

/** Where a step sits in the level (the chip above the prompt). */
export type Stage = 'warmup' | 'learn' | 'guided' | 'practice' | 'mistake' | 'boss';

interface Base {
  /** The bank item's revision (bank questions only), so a report names the version the student saw. */
  rev?: number;
  /** ELA: the bank passage this step's question is about (Level.tsx shows it beside the step). */
  pid?: string;
  id: string;
  stage: Stage;
  prompt: string;
  /** Why the right answer is right (shown after Check). */
  exp: string;
  /** false: not scored (warm-ups, the speed round). Default true. */
  graded?: boolean;
  /** Revising/Editing Part B: the sentence (or short text) the question is about, shown above the choices.
      [u]...[/u] marks underlined words. */
  box?: string;
  /** A nudge that does not give the answer away (the Hint button). */
  hint?: string;
  /** Multiple choice: why each choice is wrong (null at the right one), shown after a wrong answer. */
  wrongWhy?: (string | null)[];
  /** The prompt holds the bank's few inline tags (<b> <i> <u> <sub> <sup> <br>), checked by bankcheck.js. */
  html?: boolean;
  /** A figure (one SVG, checked by bankcheck.js) and a data table shown under the prompt. */
  fig?: string;
  tbl?: { caption?: string; cols: string[]; rows: string[][] };
}

/** Slide to guess first, then see the real value. */
export interface EstimateStep extends Base { kind: 'estimate'; min: number; max: number; step: number; prefix?: string; suffix?: string; answer: number; close: number }
/** One idea, revealed a line at a time, with an optional hands-on picture. */
export interface LearnStep extends Base { kind: 'learn'; title: string; lines: string[]; visual?: { type: 'bar'; parts: number; each: number; prefix?: string } }
/** Drag (or tap) tiles into the blanks. `parts`: text, or a blank's index. */
export interface FillStep extends Base { kind: 'fill'; parts: (string | number)[]; tiles: string[]; answers: number[]; block?: boolean }
/** Type into some cells of a table. A cell is text, or an input with its answer. */
export interface TableStep extends Base { kind: 'table'; head: string[]; rows: (string | { answer: number; prefix?: string })[][] }
/** One answer out of four. `passage`: numbered sentences shown above (revising questions). */
export interface McStep extends Base { kind: 'mc'; opts: string[]; ans: number; why?: string[]; passage?: { title?: string; sentences: string[] }; long?: boolean }
/** Sort cards into buckets. */
export interface ClassifyStep extends Base { kind: 'classify'; buckets: string[]; cards: { text: string; bucket: number }[] }
/** Type the answer (numbers: fractions and decimals are compared by value). */
export interface TypedStep extends Base { kind: 'typed'; answer: number; suffix?: string; prefix?: string }
/** As many quick questions as you can in `seconds`. Not scored; your best is kept. */
export interface SprintStep extends Base { kind: 'sprint'; seconds: number; items: { q: string; opts: string[]; ans: number }[] }
/** Someone's worked solution: tap the line that goes wrong, then pick why. */
export interface MistakeStep extends Base { kind: 'mistake'; context?: string; lines: string[]; wrong: number; reasons: string[]; reason: number }
/** Put the pieces in order. `items` is the right order; `show` is the order they start in. */
export interface OrderStep extends Base { kind: 'order'; items: string[]; show: number[] }
/** Tap the sentence (Hot Text). */
export interface HotStep extends Base { kind: 'hot'; sentences: string[]; ans: number }
/** Choose from drop-down menus inside the text (Inline Choice). `parts`: text, or a menu. */
export interface InlineStep extends Base { kind: 'inline'; parts: (string | { choices: string[]; ans: number })[] }

/** Choose all the right answers; the prompt says how many (Multiple Response). */
export interface MultiStep extends Base { kind: 'multi'; opts: string[]; ans: number[] }

/** A coordinate grid: whole-number points from (xmin, ymin) to (xmax, ymax). */
export interface Grid { xmin: number; xmax: number; ymin: number; ymax: number }
export type Pt = [number, number];

/** Tap a spot on a number line; for a ray, also pick an open or closed circle and a direction. */
export interface NumLineStep extends Base {
  kind: 'numline'; min: number; max: number; step: number; mode: 'point' | 'ray';
  answer: { value: number; closed?: boolean; dir?: 'left' | 'right' };
}
/** Plot points on a grid (Point Graph). `points`: these exact points; `line`: any two points on y = mx + b. */
export interface PlotStep extends Base { kind: 'plot'; grid: Grid; count: number; points?: Pt[]; line?: { m: number; b: number } }
/** Tap the right spot in a picture (Hot Spot): labeled points on a grid, one of them right. */
export interface SpotStep extends Base { kind: 'spot'; grid: Grid; marks: { at: Pt; label: string }[]; spots: { at: Pt; label: string }[]; ans: number }
/** Move, flip or turn a shape on a grid (Shape Transformation). `answer[i]` is where vertex i must end up. */
export interface TransformStep extends Base { kind: 'transform'; grid: Grid; shape: Pt[]; labels: string[]; answer: Pt[] }
/** Grade 9 (Solution Set): graph two lines, pick solid or dashed for each, then pick the region that solves both.
    `side`: 1 = the solutions are above the line (y > mx + b), -1 = below. */
export interface SolSetStep extends Base { kind: 'solset'; grid: Grid; lines: { m: number; b: number; solid: boolean; side: 1 | -1; name: string }[] }

/** Guided mistake review (tutor/pick.ts fixRound): a missed question shown again with its answer, then "what tripped you
    up?" (choices only, never free text). Not scored; the pick's tip shows after Check and the reason is counted. */
export interface ReflectStep extends Base { kind: 'reflect'; of: Step; opts: string[]; tips: string[]; slips: string[] }

/** Placement's opening cards (tutor/pick.ts): a real question shown as a picture, and "Could you solve this?" with
    No / Maybe / Yes. Not scored and nothing to solve; the answer only tells the placement where to look first. */
export interface RateStep extends Base { kind: 'rate'; of: Step }

export type Step = EstimateStep | LearnStep | FillStep | TableStep | McStep | ClassifyStep | TypedStep | SprintStep | MistakeStep | OrderStep | HotStep | InlineStep
  | MultiStep | NumLineStep | PlotStep | SpotStep | TransformStep | SolSetStep | ReflectStep | RateStep;

export interface Level {
  id: string;
  subject: string;
  world: string;
  title: string;
  /** The standards it teaches (internal). */
  stds: string[];
  steps: Step[];
}

/** The question type each activity trains, as an author would name it. */
export const FORMAT: Record<Step['kind'], string> = {
  estimate: 'Estimate first',
  learn: 'Learn',
  fill: 'Drag and drop',
  table: 'Table grid',
  mc: 'Multiple choice',
  classify: 'Drag and drop: sort',
  typed: 'Fill in the blank',
  sprint: 'Speed round',
  mistake: 'Spot the error (not a test question type)',
  order: 'Drag and drop: order',
  hot: 'Hot text',
  inline: 'Inline choice (drop-down)',
  multi: 'Multiple response',
  numline: 'Number line',
  plot: 'Point graph',
  spot: 'Hot spot',
  transform: 'Shape transformation',
  solset: 'Solution set',
  reflect: 'Look back (not a test question type)',
  rate: 'Self-rating (not a test question type)',
};

/** What the chip above a step says to a student: plain names for the activities the test names in code words. */
export const CHIP: Partial<Record<Step['kind'], string>> = {
  mistake: 'Find the mistake',
  inline: 'Pick the word',
  table: 'Fill in the table',
  classify: 'Sort the cards',
  fill: 'Drag into the blanks',
  order: 'Put in order',
  hot: 'Tap the sentence',
  multi: 'Choose all that apply',
  reflect: 'Look back',
  rate: 'Quick question',
};

export const STAGE_LABEL: Record<Stage, string> = {
  warmup: 'Warm-up',
  learn: 'Learn',
  guided: 'Guided',
  practice: 'Practice',
  mistake: 'Find the mistake',
  boss: 'Boss question',
};
