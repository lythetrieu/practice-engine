// The test-pack format: what a pack's files may contain. One schema for every exam; the engine reads nothing
// else about the exam. docs/authoring-a-pack.md explains each field for authors; keep the two in step.
//
// Plain JavaScript (not TypeScript) on purpose: astro.config.mjs and scripts/pack.mjs load it in Node with no build step.
import { z } from 'zod';

/** Question types the engine can play. A pack lists the ones its exam uses in `formats`. */
export const FORMATS = ['mc', 'multi', 'typed', 'inline', 'fill', 'classify', 'order', 'hot', 'numline', 'plot', 'mistake', 'table', 'estimate'];

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'use letters, digits, ".", "-" or "_" (no spaces)');
const text = z.string().trim().min(1, 'must not be empty');
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'a color like "#1E4D3A"');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date like "2026-11-14"');
/** A choice: a letter (A, B, …) or its 0-based index. */
const letter = z.union([z.string().regex(/^[A-Fa-f]$/, 'a letter A–F'), z.number().int().min(0).max(5)]);
const pt = z.tuple([z.number(), z.number()]);
const grid = z.object({ xmin: z.number(), xmax: z.number(), ymin: z.number(), ymax: z.number() }).strict();
const dataTable = z.object({ caption: z.string().optional(), cols: z.array(z.string()).min(1), rows: z.array(z.array(z.string())).min(1) }).strict();

// ---------------------------------------------------------------- pack.yaml

const section = z.object({
  id,
  name: text,
  short: text.optional(),
  description: z.string().optional(),
}).strict();

const sectionScale = z.union([
  // percent right 0..100 maps in a straight line to min..max
  z.object({ type: z.literal('linear'), min: z.number(), max: z.number() }).strict(),
  // [percent right, score] points, in order; scores between points are read off the line between them
  z.object({ type: z.literal('table'), table: z.array(z.tuple([z.number().min(0).max(100), z.number()])).min(2) }).strict(),
]);

export const configSchema = z.object({
  id,
  name: text,                                   // the app's name, e.g. "SAT Prep"
  exam: text,                                   // the exam's short name in copy: "Practice for the {exam}"
  examFull: z.string().optional(),
  tagline: text,
  audience: z.object({
    label: text.default('Grade'),
    options: z.array(z.object({ value: z.number().int(), label: text }).strict()).min(1),
  }).strict().optional(),
  brand: z.object({
    logo: text,                                 // path inside the pack, an .svg file
    colors: z.object({
      primary: color, primaryDark: color.optional(),
      accent: color, reward: color.optional(),
      background: color.optional(), frame: color.optional(),
    }).strict(),
  }).strict(),
  // The guide on the map, the celebrations and (when it is switched on) the AI tutor. Optional: the engine's own
  // bird, called Pip, when left out.
  mascot: z.object({
    name: text.default('Pip'),
    image: z.string().optional(),               // an .svg file inside the pack; shown at 24–90 px, so keep it simple
  }).strict().default({}),
  // Who runs the site, for the privacy notice and the terms (/privacy/, /terms/). Fill it in before you go live.
  legal: z.object({
    operator: text,                             // the person or company that runs the site
    contactEmail: z.string().email(),
    address: z.string().optional(),             // a postal address, if the law where you are asks for one
    governingLaw: z.string().optional(),        // e.g. "the State of New York, USA"
    effectiveDate: day,
  }).strict().optional(),
  // An optional paid plan, sold to parents through Polar (docs/payments.md). It does nothing until the POLAR_* settings
  // are set on the server too: without them there is no checkout, no price anywhere and no free limits.
  plan: z.object({
    name: text.default('Pro'),                  // "Get Pro for Mia"
    priceLabel: z.string().optional(),          // e.g. "$49": for the terms page only; the app shows the price Polar charges
    months: z.number().int().min(1).max(36).default(12),   // one payment, this many months, never renews
    refundDays: z.number().int().min(0).max(365).default(14),
    supportEmail: z.string().email().optional(),           // default: legal.contactEmail
    freeUntil: day.optional(),                  // no free limits before this day (YYYY-MM-DD), for everyone
    // What the free plan allows while payments are on. Leave out a number for no limit on that.
    limits: z.object({
      freeDays: z.number().int().min(0).default(0),        // no lesson limit in a learner's first N days
      newLessonsPerDay: z.number().int().min(1).optional(),
      fullTests: z.number().int().min(0).optional(),
    }).strict().default({}),
    benefits: z.array(text).max(6).default([]),   // short lines on the parent's plan card
  }).strict().optional(),
  sections: z.array(section).min(1),
  formats: z.array(z.enum(FORMATS)).min(1),
  practice: z.object({
    dailyGoal: z.number().int().min(1).default(20),
    lessonQuestions: z.number().int().min(1).max(30).default(10),
    reviewRound: z.number().int().min(1).max(30).default(8),
    checkPass: z.number().min(0).max(1).default(0.7),
  }).strict().default({}),
  fullTest: z.object({
    title: text,
    intro: z.string().default(''),
    timing: z.enum(['total', 'per-section']),
    minutes: z.number().positive().optional(),  // timing: total
    sectionOrder: z.enum(['choose', 'fixed']).default('fixed'),
    sections: z.array(z.object({
      section: id,
      questions: z.number().int().min(1),
      minutes: z.number().positive().optional(),  // timing: per-section
      allowBack: z.boolean().default(true),
      skills: z.record(z.string(), z.number().int().min(0)).optional(),   // a blueprint: questions per skill
    }).strict()).min(1),
    timeOptions: z.array(z.object({ id, label: text, note: z.string().optional(), factor: z.number().positive().nullable() }).strict())
      .min(1).default([{ id: 'standard', label: 'Standard', factor: 1 }]),
    rules: z.array(text).default([]),
  }).strict(),
  scoring: z.object({
    label: text.default('Estimated score'),
    disclaimer: text,
    sections: z.record(z.string(), sectionScale),
    composite: z.enum(['sum', 'average', 'none']).default('sum'),
    compositeLabel: text.default('Total'),
    margin: z.number().min(0).default(0),        // ± shown with the estimate
    round: z.number().int().min(1).default(1),
    benchmarks: z.array(z.object({ label: text, score: z.number() }).strict()).default([]),
  }).strict(),
  // Short tips the map's guide gives, per section (tap the mascot). Plain advice, one line each.
  tips: z.record(z.string(), z.array(text).min(1)).default({}),
  testDates: z.array(z.object({ date: day, label: text, who: z.string().optional(), grades: z.array(z.number().int()).optional() }).strict()).default([]),
  site: z.object({
    url: z.string().url().optional(),
    title: text,
    description: text,
    heroTitle: text,
    heroText: text,
    features: z.array(z.object({ title: text, text }).strict()).default([]),
    faq: z.array(z.object({ q: text, a: text }).strict()).default([]),
    disclaimer: z.string().default(''),
  }).strict(),
}).strict();

// ---------------------------------------------------------------- skills.yaml, curriculum.yaml, passages

// `requires`: the skills this one builds on (the adaptive tutor looks there for gaps). Must not form a cycle.
export const skillsSchema = z.array(z.object({ id, name: text, section: id, requires: z.array(id).default([]) }).strict()).min(1);

export const passageSchema = z.object({
  id,
  title: z.string().optional(),
  genre: z.string().optional(),               // e.g. literary, informational, poem, argument
  intro: z.string().optional(),
  paragraphs: z.array(text).min(1),
  source: z.string().optional(),              // a credit line ("Written for this pack.")
}).strict();

// ---------------------------------------------------------------- questions

/** The fields every question has. In a lesson's teaching steps, `id` and `skill` may be left out. */
const common = (teach) => ({
  id: teach ? id.optional() : id,
  section: id.optional(),                     // taken from the skill when left out
  skill: teach ? id.optional() : id,
  difficulty: z.number().int().min(1).max(5).default(3),
  prompt: text,
  explanation: text,
  hint: z.string().optional(),
  passage: id.optional(),
  box: z.string().optional(),                 // a sentence shown above the choices; [u]…[/u] underlines
  figure: z.string().optional(),              // an .svg file inside the pack
  table: dataTable.optional(),
  html: z.boolean().optional(),               // the prompt uses <b> <i> <u> <sub> <sup> <br>
  graded: z.boolean().optional(),             // false: not scored (warm-ups)
});

const SHAPES = {
  mc: { choices: z.array(text).min(2).max(6), answer: letter, whyWrong: z.array(z.string().nullable()).optional() },
  multi: { choices: z.array(text).min(2).max(6), answer: z.array(letter).min(1) },
  typed: { answer: z.union([z.number(), z.string()]), prefix: z.string().optional(), suffix: z.string().optional() },
  inline: { text },                           // "The dog [[run|*runs|running]] home." (* marks the right word)
  fill: { text, tiles: z.array(text).min(2), answer: z.array(text).min(1) },   // "{1} × {2} = 12"
  classify: { buckets: z.array(text).min(2), cards: z.array(z.object({ text, bucket: z.union([z.string(), z.number().int()]) }).strict()).min(2) },
  order: { items: z.array(text).min(3) },     // in the right order; the app shuffles them
  hot: { sentences: z.array(text).min(2), answer: z.number().int().min(1) },   // sentence number, from 1
  numline: {
    min: z.number(), max: z.number(), step: z.number().positive(), mode: z.enum(['point', 'ray']).optional(),
    answer: z.union([z.number(), z.object({ value: z.number(), closed: z.boolean(), dir: z.enum(['left', 'right']) }).strict()]),
  },
  plot: { grid, points: z.array(pt).min(1).optional(), line: z.object({ m: z.number(), b: z.number() }).strict().optional(), count: z.number().int().min(1).optional() },
  mistake: { context: z.string().optional(), lines: z.array(text).min(2), wrongLine: z.number().int().min(1), reasons: z.array(text).min(2), reason: letter },
  table: { head: z.array(z.string()).min(2), rows: z.array(z.array(z.union([z.string(), z.object({ answer: z.number(), prefix: z.string().optional() }).strict()]))).min(1) },
  estimate: { min: z.number(), max: z.number(), step: z.number().positive(), answer: z.number(), close: z.number().min(0), prefix: z.string().optional(), suffix: z.string().optional() },
};
const union = (teach) => z.discriminatedUnion('type',
  FORMATS.map((t) => z.object({ ...common(teach), type: z.literal(t), ...SHAPES[t] }).strict()));

export const questionSchema = union(false);
const teachQuestion = union(true);

// A lesson's teaching steps (optional): they open the lesson, and the pack's questions fill the rest.
export const teachSchema = z.object({
  warmup: teachQuestion.optional(),
  learn: z.object({ title: text, lines: z.array(text).min(1), prompt: z.string().optional() }).strict(),
  guided: z.array(teachQuestion).default([]),
  mistake: teachQuestion.optional(),
}).strict();

export const curriculumSchema = z.object({
  worlds: z.array(z.object({
    section: id,
    name: text,
    unit: z.string().default(''),
    lessons: z.array(z.object({
      title: text,
      skills: z.array(id).min(1),
      icon: z.string().optional(),            // a token drawing name from src/practice/artdata.ts (default: the level number)
      teach: teachSchema.optional(),
    }).strict()).min(1).max(5, 'a world holds at most 5 lessons (the map has room for 5 plus a chest and a unit check): split it into two worlds'),
  }).strict()).min(1),
}).strict();
