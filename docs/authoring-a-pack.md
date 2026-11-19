# Authoring a test pack

This guide is for you if you want to make practice for a new exam. You do not change the engine. You write a folder of text files, called a **test pack**. The engine reads the pack and turns it into a full practice app: a landing page, a lesson map, a timed practice test, and a score estimate.

The pack format is defined in two files. They are the source of truth if this guide ever disagrees with them:

- `src/pack/schema.mjs` says which fields a file may have.
- `src/pack/load.mjs` runs the extra checks and turns the pack into what the app plays.

## Contents

1. [What a pack is](#1-what-a-pack-is)
2. [pack.yaml](#2-packyaml)
3. [skills.yaml](#3-skillsyaml)
4. [curriculum.yaml](#4-curriculumyaml)
5. [How a lesson and a full test are put together](#5-how-a-lesson-and-a-full-test-are-put-together)
6. [Questions](#6-questions)
7. [Passages](#7-passages)
8. [Validation](#8-validation)
9. [Content rules for authors](#9-content-rules-for-authors)

---

## 1. What a pack is

A pack is one folder under `packs/`. One pack is one exam.

```
packs/my-exam/
├── pack.yaml          the exam: name, sections, timing, scoring, colors, landing page
├── skills.yaml        the skills, and which skill builds on which
├── curriculum.yaml    the lesson map: worlds and lessons
├── brand/
│   └── logo.svg       one SVG file
├── questions/         one or more files, each a list of questions
│   ├── math.yaml
│   └── reading.yaml
├── passages/          reading passages that questions point to (optional)
│   └── bee-dance.yaml
├── teach/             teaching steps for a lesson (optional)
│   └── unit-rates.yaml
└── figures/           SVG pictures that questions use (optional, any folder name)
    └── triangle.svg
```

Only `pack.yaml`, `skills.yaml`, `curriculum.yaml` and the logo are required. The rest depends on your exam. File names inside `questions/` and `passages/` are yours to choose. Subfolders are fine. The engine reads every `.yaml`, `.yml` and `.json` file it finds there.

### Start from a sample pack

Copy a sample, then change it:

```bash
cp -r packs/demo-isee packs/my-exam
```

Two samples ship with the engine:

- `packs/shsat-sample` shows every question type, a passage-based ELA section, teaching steps, a choose-your-first-section test with one total clock, and a table score scale.
- `packs/demo-isee` is smaller. It has four sections, a separate clock for each, multiple choice only, and a linear score scale with no total.

After you copy a pack, change `id`, `name`, `exam` and the `site` text in `pack.yaml` first. The copy still says it is the old exam until you do. The folder name and the `id` do not have to match, but keeping them the same avoids confusion.

Then check it and run it:

```bash
npm run validate -- --pack my-exam
npm run dev -- --pack my-exam
```

Both commands also take a path, such as `--pack ./somewhere/my-exam`. `npm run validate -- --all` checks every pack in `packs/`. If you leave `--pack` out, the engine uses the `PACK` environment variable, then `shsat-sample`. `npm run dev` checks the pack first and stops if it has errors. `npm run build -- --pack my-exam` makes the Cloudflare Workers build.

The validator is your best friend. Run it after every few questions. Section 8 explains what it checks.

### Rules for every file

- Files are YAML. JSON also works. Dates stay as text, so `2026-11-14` is a string, not a date.
- **Unknown keys are errors.** If you misspell a field (`difficult:` instead of `difficulty:`), the validator tells you. It does not ignore it.
- An `id` (for a pack, section, skill, question, passage or time option) uses letters, digits, `.`, `-` and `_`. It must start with a letter or digit. No spaces.
- Text fields must not be empty.
- **Quote anything risky.** Put quotes around a value that starts with `#`, `[`, `{`, `*`, `&`, `!`, `@` or a backtick, or that contains `: ` or ` #`. Colors always need quotes, because `#` starts a comment in YAML. See the [comma gotcha](#the-yaml-comma-gotcha) in section 8.

---

## 2. pack.yaml

This file describes the exam. Below, **required** means the validator fails without it. Defaults are the values used when you leave the field out.

### Identity

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | A short id for the pack, such as `my-exam`. |
| `name` | yes | The app's name, such as `SHSAT Practice`. |
| `exam` | yes | The exam's short name, used in sentences such as "When is your SHSAT?". |
| `examFull` | no | The full name, such as `Specialized High Schools Admissions Test`. |
| `tagline` | yes | One sentence under the name. |

```yaml
id: my-exam
name: Alpha Test Practice
exam: Alpha Test
examFull: The Alpha Admissions Test
tagline: Daily practice for the Alpha Test, one short level at a time.
```

### audience (optional)

Use this when the exam depends on the student's grade or age group. The student picks one option. The same list is used when a parent adds a child.

| Field | Required | Meaning |
|---|---|---|
| `label` | no, default `Grade` | The question, such as `Grade` or `Applying for`. |
| `options` | yes, at least 1 | Each option has an integer `value` and a `label`. |

```yaml
audience:
  label: Grade
  options:
    - { value: 8, label: 8th grade }
    - { value: 9, label: 9th grade }
```

If you leave `audience` out, the app asks for no grade. The `value` numbers are what `testDates[].grades` points to.

### sections

The parts of the exam. At least one. Each section has:

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Used everywhere else, such as `math`. Keep it short and lowercase. |
| `name` | yes | The full name, such as `Mathematics`. |
| `short` | no | A short name for buttons and chips, such as `Math`. Defaults to `name`. |
| `description` | no | A line about what the section covers. |

```yaml
sections:
  - { id: ela, name: English Language Arts, short: ELA, description: "Revising and editing, and reading" }
  - { id: math, name: Mathematics, short: Math, description: Word problems and computation }
```

### formats

The question types your exam uses. At least one. The allowed values are:

`mc`, `multi`, `typed`, `inline`, `fill`, `classify`, `order`, `hot`, `numline`, `plot`, `mistake`, `table`, `estimate`

```yaml
formats: [mc]                       # an exam that is all multiple choice
```

**The validator rejects any question in `questions/` whose type is not listed here.** An ISEE pack lists only `mc`. If you later write a `typed` question for it, validation fails until you add `typed` to this list too. This keeps a pack honest about how the real exam looks. The check covers the files in `questions/`. It does not cover teaching steps in `curriculum.yaml` or `teach/` files, which may use any type.

### practice

How daily practice behaves. The whole block is optional.

| Field | Default | Range | Meaning |
|---|---|---|---|
| `dailyGoal` | 20 | whole number, at least 1 | Questions a student answers per day to meet the daily goal. |
| `lessonQuestions` | 10 | 1 to 30 | How many steps a lesson aims for. |
| `reviewRound` | 8 | 1 to 30 | How many earlier mistakes one Review round brings back. |
| `checkPass` | 0.7 | 0 to 1 | The share of a unit check a student must get right to open the next world. |

A unit check always has 10 questions. That number is fixed in the engine. A small `lessonQuestions` helps when your pack has few questions. A lesson uses fewer steps if its skills have fewer questions than that.

```yaml
practice:
  dailyGoal: 15
  lessonQuestions: 6
  reviewRound: 6
  checkPass: 0.6
```

### fullTest

The timed practice test. This block is required.

| Field | Required | Default | Meaning |
|---|---|---|---|
| `title` | yes | | The test's name on screen. |
| `intro` | no | empty | A line on the start screen. |
| `timing` | yes | | `total` (one clock for the whole test) or `per-section` (each section has its own clock). |
| `minutes` | when `timing: total` | | The total minutes. Ignored for `per-section`. |
| `sectionOrder` | no | `fixed` | `fixed`: sections run in the order listed. `choose`: the student picks which section comes first. The others follow in the listed order. |
| `sections` | yes, at least 1 | | The test's sections (below). |
| `timeOptions` | no | one option, `standard`, factor 1 | The clock choices (below). |
| `rules` | no | none | Short lines shown before the test starts. |

Each entry in `fullTest.sections`:

| Field | Required | Default | Meaning |
|---|---|---|---|
| `section` | yes | | A section id from `sections`. |
| `questions` | yes | | How many questions this section asks. |
| `minutes` | when `timing: per-section` | | That section's minutes. Ignored for `total`. |
| `allowBack` | no | `true` | Whether the student can go back to earlier questions in this section. |
| `skills` | no | none | A **blueprint**: how many questions each skill gets. See below. |

**Time options** let students pick a clock. Each has an `id`, a `label`, an optional `note`, and a `factor`. The factor multiplies every clock. `factor: 1` is standard time and `factor: 2` is double time. **`factor: null` means no clock at all** (untimed practice). The factor must be above zero if it is a number.

```yaml
fullTest:
  title: Full-length practice test
  intro: The same rules as the real test, at sample size.
  timing: total
  minutes: 36
  sectionOrder: choose
  sections:
    - { section: ela, questions: 10, allowBack: true }
    - { section: math, questions: 10, allowBack: false }
  timeOptions:
    - { id: standard, label: Standard, factor: 1 }
    - { id: extended, label: Extended, note: "ELL, IEP or 504", factor: 2 }
    - { id: untimed, label: Untimed practice, note: No clock, factor: null }
  rules:
    - Answer each question to move on.
    - Once you submit a section, you can't return to it.
```

A per-section version, where each section has its own clock:

```yaml
  timing: per-section
  sectionOrder: fixed
  sections:
    - { section: verbal, questions: 40, minutes: 20 }
    - { section: quant, questions: 37, minutes: 35 }
```

**A blueprint** sets how many questions come from each skill. The skills must belong to that section, and the numbers must add up to no more than `questions`. If they add up to less, the engine fills the rest. Without a blueprint, each skill gets a share in proportion to how many questions the pack has for it.

```yaml
    - section: math
      questions: 10
      skills: { m.ratio: 3, m.percent: 2, m.equation: 3, m.geometry: 2 }
```

The validator also checks that the pack has enough scored questions to build the test (section 5 explains what "scored" means). If the test asks for 57 math questions and the pack has 40, validation fails. The same check runs for each skill in a blueprint.

### scoring

How a practice test becomes a score estimate. This block is required.

> **This is an estimate, and you must say so honestly.** Most exams do not publish how a raw score turns into a reported score. The engine only draws a line (or a table) that you choose. Your numbers are a guess. The `disclaimer` is required, and the engine shows it every time a score appears. Write one that says what the number is and what it is not. Do not promise a result. Do not call the number "your score" if it is not official. Do not suggest that a student will or will not get into a school.

| Field | Required | Default | Meaning |
|---|---|---|---|
| `label` | no | `Estimated score` | The name of the number on screen. |
| `disclaimer` | yes | | The honest note shown with every estimate. |
| `sections` | yes | | A score scale for each test section (below). |
| `composite` | no | `sum` | How section scores combine: `sum`, `average`, or `none`. |
| `compositeLabel` | no | `Total` | The name of the combined number, such as `Composite`. |
| `margin` | no | 0 | A plus-or-minus range shown with each estimate. |
| `round` | no | 1 | Round scores to the nearest multiple of this number. Use 5 for an exam that scores in steps of 5. |
| `benchmarks` | no | none | Named reference scores, such as school cutoffs. |

**Score scales.** Every section in `fullTest.sections` must have a scale. A scale starts from the percent right on that section (0 to 100).

- `linear` draws a straight line from `min` (0% right) to `max` (100% right).
- `table` lists `[percent right, score]` points. Between two points, the score is read off the straight line joining them. Below the first point the score is the first score. Above the last point it is the last score. Use at least two points. Percents go from 0 to 100.

```yaml
scoring:
  label: Estimated score
  disclaimer: Our estimate from this practice test, not an official score. The test maker does not publish how raw scores turn into scaled scores.
  sections:
    ela:  { type: table, table: [[0, 200], [50, 270], [80, 310], [100, 350]] }
    math: { type: linear, min: 200, max: 350 }
  composite: sum
  compositeLabel: Composite
  margin: 40
  round: 5
  benchmarks:
    - { label: School A, score: 506 }
    - { label: School B, score: 561 }
```

**How the numbers are worked out:**

1. Each section's percent right is `right / total * 100`. The scale turns it into a section score, which is rounded to `round`.
2. The range for each section is the score plus or minus `margin`. It is kept inside the scale's lowest and highest score.
3. The composite exists only when `composite` is not `none` and at least two sections were scored. `sum` adds the rounded section scores. `average` divides that sum by the number of sections. Its range is `sqrt(number of sections) * margin` (divided by the number of sections for `average`), not the plain sum of the margins.
4. The **headline** number is the composite. If there is no composite, it is the only section's score when one section was scored. If there is neither, there is no headline.
5. A benchmark is compared with the headline range. The student is shown "above" if the whole range is over the benchmark, "near" if the benchmark falls inside it, and "below" otherwise. The app never says pass or fail. So benchmarks only show up when a pack has a composite (or a one-section test). The ISEE sample uses `composite: none`, so it has no benchmarks.

### testDates

Dates the exam is given. Optional. Shown on the home screen so students can count down.

| Field | Required | Meaning |
|---|---|---|
| `date` | yes | `YYYY-MM-DD`. Put quotes around it. |
| `label` | yes | What the student sees, such as `Sat, Nov 14`. |
| `who` | no | A note, such as `8th grade, at a test site`. |
| `grades` | no | A list of `audience` values. If present, only students of those grades see this date. |

```yaml
testDates:
  - { date: "2026-11-14", label: "Sat, Nov 14", who: "8th grade, at a test site", grades: [8] }
  - { date: "2026-11-21", label: "Sat, Nov 21", who: 9th grade, grades: [9] }
```

A date with no `grades` shows for everyone. Students whose grade is not known see every date. The landing page lists only dates that are today or later. Leave `testDates` out for an exam with no fixed dates.

### mascot

The guide on the map, in the celebrations, and the face of the AI tutor when the site turns it on. Optional.

| Field | Required | Default | What it does |
|---|---|---|---|
| `name` | no | `Pip` | The name shown on buttons ("Ask Pip"), tips and labels. |
| `image` | no | the engine's bird | An `.svg` file in the pack. One drawing, no scripts or event handlers. It is shown from about 24 to 90 pixels, so keep it simple and readable small. |

```yaml
mascot:
  name: Zed
  image: brand/mascot.svg
```

### legal

Who runs the site. The privacy notice (`/privacy/`) and the terms (`/terms/`) are filled from it. Optional, but without it
both pages show placeholders and a "This is a template" banner, and the validator warns.

| Field | Required | What it does |
|---|---|---|
| `operator` | yes | The person or company that runs the site. |
| `contactEmail` | yes | Where parents write to see or delete their family's data. |
| `address` | no | A postal address, if the law where you are asks for one. |
| `governingLaw` | no | For example "the State of New York, USA". |
| `effectiveDate` | yes | A date like `"2026-10-28"` (quoted). |

The two pages are a starting point that matches what the engine collects, not legal advice. Have them reviewed.

### plan (optional)

A paid plan that parents can buy for one child at a time, through Polar. **It does nothing on its own:** checkout, prices
and the free limits turn on only when the server also has the `POLAR_*` settings ([payments.md](payments.md)). Without
this block, or without those settings, the app works exactly as it does with no plan at all.

| Field | Required | Default | What it does |
|---|---|---|---|
| `name` | no | `Pro` | The plan's name: "Get Pro for Mia". |
| `priceLabel` | no | none | For the terms page only, e.g. `"$49"`. The app always shows the price Polar charges. |
| `months` | no | 12 | How long one payment lasts. It never renews. |
| `refundDays` | no | 14 | The refund window shown to parents and in the emails. `0` hides the refund line. |
| `supportEmail` | no | `legal.contactEmail` | Where refund questions go. One of the two is required. |
| `freeUntil` | no | none | A day (`"2027-01-01"`): before it, nobody has free limits. Checkout still works. |
| `limits.freeDays` | no | 0 | No lesson limit in a learner's first N days. |
| `limits.newLessonsPerDay` | no | no limit | New map lessons a learner without the plan can start each day. |
| `limits.fullTests` | no | no limit | Full practice tests a learner without the plan can take. |
| `benefits` | no | none | Up to 6 short lines on the parent's plan card. |

```yaml
plan:
  name: Plus
  priceLabel: "$49"
  months: 12
  refundDays: 14
  limits: { freeDays: 7, newLessonsPerDay: 2, fullTests: 1 }
  benefits: [No daily lesson limit, Every full practice test]
```

Children never see a price: at a limit, a child signed in with their own login can tap "Ask a parent for more", which
emails the parent (once a day at most). Replaying lessons, review and finishing a test already started are never limited.

### tips

Short advice the map guide gives when a student taps the mascot. One list per section. Each tip is one line of plain advice. The keys must be section ids. Sections without tips get a few general tips that fit any exam.

```yaml
tips:
  math:
    - Write each step on scrap paper. Do not do it all in your head.
    - Check your answer by putting it back into the problem.
  ela:
    - Read the question first, then find the answer in the passage.
```

### brand

How the app looks.

```yaml
brand:
  logo: brand/logo.svg
  colors:
    primary: "#1E4D3A"
    primaryDark: "#143728"
    accent: "#E8704F"
    reward: "#E3A72F"
    background: "#FBF8F3"
    frame: "#E6EFE1"
```

There are six color fields. Only `primary` and `accent` are required. Write each color as six hex digits inside quotes, such as `"#1E4D3A"`.

| Color | Required | Default | Used for |
|---|---|---|---|
| `primary` | yes | | Buttons, links, the map path, done levels. |
| `primaryDark` | no | same as `primary` | The darker edge under buttons. Pick a darker shade of `primary` so buttons look raised. |
| `accent` | yes | | Wrong answers, warnings, the current level. |
| `reward` | no | `#E3A72F` (gold) | Stars, streaks, XP. |
| `background` | no | `#FBF8F3` (warm white) | The page background. |
| `frame` | no | `#E6EFE1` (pale green) | The area around the app on wide screens. |

The engine derives the rest from these. Light tints, borders, pressed-button shades, and the "done" and "locked" colors on the map are mixed from `primary`, `accent`, `reward` and `background`. You do not set them. Pick colors with good contrast against white text on `primary`, and check that text is readable on `background`.

**Logo rules.** The logo is one SVG file inside the pack. The file must be a single `<svg>` element. It must not contain `<script>`, `<foreignObject>`, `<iframe>`, `<object>` or `<embed>`. It must not contain event handlers such as `onclick=` or `onload=`. It must not contain `javascript:` links. The same rules apply to every figure. The validator checks them because the engine puts the SVG straight into the page. A square logo of about 64 by 64 units with rounded corners works well.

### site

The public landing page and its search-engine text. This block is required.

| Field | Required | Meaning |
|---|---|---|
| `url` | no | The public address, such as `https://practice.example.com`. Used for canonical links and the sitemap. Without it, the engine uses `http://localhost:4321`. |
| `title` | yes | The page title and search result title. |
| `description` | yes | The search result description. |
| `heroTitle` | yes | The big headline. |
| `heroText` | yes | The paragraph under the headline. |
| `features` | no | A list of `{ title, text }` cards. |
| `faq` | no | A list of `{ q, a }` questions and answers. |
| `disclaimer` | no | A footer line. For example, say you are not affiliated with the test maker. |

```yaml
site:
  url: https://practice.example.com
  title: Alpha Test Practice — free daily practice
  description: Short daily practice levels, a timed practice test with a score estimate, and a progress report for parents.
  heroTitle: Alpha Test practice that fits in 10 minutes a day
  heroText: Short levels, a timed practice test, and a parent report.
  features:
    - { title: Learn by doing, text: "Each level teaches one skill, then practices it." }
  faq:
    - { q: Is this the official test?, a: "No. The questions are original and written for this site." }
  disclaimer: Not affiliated with or endorsed by the makers of the Alpha Test.
```

---

## 3. skills.yaml

A skill is one thing a student can learn, such as "Percents" or "Main idea". Every question belongs to exactly one skill. Lessons draw their questions by skill. Reports group by skill.

The file is a list. Each skill has:

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Your choice. Students never see it. A pattern such as `m.percent` or `e.grammar` helps. |
| `name` | yes | The name students and parents see in reports. |
| `section` | yes | A section id. The validator checks it exists. |
| `requires` | no | A list of skill ids this skill builds on. |

```yaml
- { id: m.fractions, name: Fractions, section: math }
- { id: m.ratio,     name: Ratios and rates, section: math, requires: [m.fractions] }
- { id: m.percent,   name: Percents,         section: math, requires: [m.ratio] }
```

`requires` is the **prerequisite graph** for the adaptive tutor. When a student keeps missing a skill, the tutor follows `requires` to find the earlier skill that may be the real gap. Say "Percents builds on Ratios, and Ratios builds on Fractions", and the tutor can send a student back to Fractions.

Rules:

- Every id in `requires` must exist in the file.
- **No cycles.** A skill cannot build on itself, directly or through others. If A requires B and B requires A, validation fails. Each skill in the cycle gets its own error.
- `requires` may point to a skill in another section. Most graphs stay inside one section.
- Skill ids are used in saved progress and reports. Do not rename them after students have used the app.

Warning only: a skill with no questions gets a warning. It is not an error.

---

## 4. curriculum.yaml

This file is the lesson map. A **world** is a group of lessons in one section. The student sees worlds as places on the map. After the lessons, each world has a reward chest and a unit check.

```yaml
worlds:
  - section: math
    name: Ratio Park
    unit: Ratios, rates and percents
    lessons:
      - title: Unit rates
        skills: [m.ratio]
        icon: unit-rates
        teach: teach/unit-rates.yaml
      - title: Percents
        skills: [m.percent]
```

World fields:

| Field | Required | Meaning |
|---|---|---|
| `section` | yes | A section id. |
| `name` | yes | The world's name. |
| `unit` | no | A line under the name, such as the topic of the unit. |
| `lessons` | yes, 1 to 5 | The lessons, in order. |

Lesson fields:

| Field | Required | Meaning |
|---|---|---|
| `title` | yes | The lesson's name. |
| `skills` | yes, at least 1 | Skill ids the lesson draws questions from. Each skill must exist and belong to the world's section. |
| `icon` | no | A picture on the map token. If you leave it out, the token shows the level number. |
| `teach` | no | Teaching steps that open the lesson. Inline, or a path to a file. |

**A world holds at most 5 lessons.** The map has room for 5 lessons plus a chest and a unit check. If you have more, split them into two worlds.

A world is opened when the student passes the previous world's unit check in the same section. The first world of each section is always open.

### Lesson ids and why they must stay stable

The engine gives every lesson an id: `<section>-<world>-<level>`.

- `<world>` counts the worlds **within that section**, in the order they appear in the file, starting at 1.
- `<level>` counts the lessons in the world, starting at 1.

So the second lesson of the first math world is `math-1-2`. The chest is `math-1-chest` and the check is `math-1-check`.

**Saved progress uses these ids.** Stars, passed checks, and streaks are all saved under them. If you put a new world *before* an existing one, or move a lesson up the list, every id after it shifts, and students' progress lands on the wrong lessons. Once students have used a pack:

- Add new worlds at the end of a section.
- Add new lessons at the end of a world.
- Do not reorder or delete worlds or lessons. If you retire a lesson, keep its place and change its content.
- Also keep question ids and skill ids the same. Saved mistakes refer to them.

### Icon names

`icon` must be one of these names, which are the keys of `NODES` in `src/practice/artdata.ts` (all except `chest` and `unit-check`, which the engine uses itself):

`unit-rates`, `equivalent-ratios`, `ratio-word`, `proportional-graphs`, `multi-step`, `integers`, `order-of-operations`, `commas`, `pronouns`, `subject-verb`, `combining`, `run-ons`, `main-idea`, `transitions`, `num`

`num` is the plain coin with the level number. A missing or unknown icon name is also shown as `num`. The validator does not check icon names, so a typo is silent. Look at the map to confirm.

### Teaching steps

A lesson with `teach` opens with teaching steps. Then the pack's questions fill the rest. A lesson without `teach` is only practice questions.

`teach` is either inline in `curriculum.yaml` or a path to a file inside the pack, such as `teach: teach/commas.yaml`. A teach file holds the same four parts:

| Part | Required | Meaning |
|---|---|---|
| `warmup` | no | One question to ease in. It is not scored unless you set `graded: true`. |
| `learn` | yes | A card: `title`, `lines` (a list of at least 1; shown one at a time) and an optional `prompt`. |
| `guided` | no | A list of questions the student answers with help. |
| `mistake` | no | One question, and it **must be type `mistake`**. |

`warmup`, `guided` and `mistake` entries are full questions (section 6), but `id` and `skill` may be left out. The engine fills them in. They are not checked against `formats`, and they are not part of the pool for practice or the full test.

```yaml
# teach/unit-rates.yaml
warmup:
  type: estimate
  prompt: A cyclist rides 30 miles in 2 hours. About how many miles is that in one hour?
  min: 0
  max: 30
  step: 1
  answer: 15
  close: 1
  suffix: miles
  explanation: "30 miles in 2 hours is 15 miles in 1 hour, because 30 ÷ 2 = 15."

learn:
  title: A unit rate is the amount for 1
  lines:
    - "A rate compares two different things, like miles and hours."
    - "A unit rate tells how much for just 1."
    - "To find a unit rate, divide: the total amount ÷ the number of units."

guided:
  - type: mc
    prompt: A tap fills a 36-liter tub in 9 minutes. How many liters does it pour each minute?
    choices: ["3", "4", "9", "27"]
    answer: B
    explanation: "Divide the liters by the minutes. 36 ÷ 9 = 4."

mistake:
  type: mistake
  prompt: Find the mistake in this solution.
  context: "A van drives 150 miles in 3 hours. How far does it drive in 5 hours at the same speed?"
  lines:
    - "Find the unit rate: 150 ÷ 3 = 50 miles per hour."
    - "Use it for 5 hours: 50 + 5 = 55."
    - "The van drives 55 miles."
  wrongLine: 2
  reasons:
    - "The unit rate should be 3 ÷ 150."
    - "To find the distance for 5 hours, you multiply: 50 × 5, not 50 + 5."
    - "The number 150 should be added to 5."
  reason: B
  explanation: "50 miles for each hour means 50 × 5 = 250 miles for 5 hours."
```

Warnings (not errors): a lesson whose skills have no questions yet shows as "coming soon"; a section with no worlds does not appear on the map.

---

## 5. How a lesson and a full test are put together

Knowing this helps you decide how many questions to write and how to tag difficulty.

First, **scored questions**. A question counts as scored unless it says `graded: false`. Lessons and full tests use only scored questions. A question in `questions/` with `graded: false` is left out of both. The flag is for teaching steps (a `warmup` is unscored by default).

### A lesson

The engine builds a lesson from the scored questions of the lesson's skills. The steps run in this order:

1. If the lesson has teaching steps: the `warmup`, then the `learn` card, then the `guided` steps.
2. Practice questions, easy to hard.
3. If there is a `mistake` step, it comes after the practice questions and before the last one.
4. The hardest question comes last, as the **boss**.

How the practice questions are picked:

- The lesson aims for `practice.lessonQuestions` steps. Teaching steps use up part of that, so a lesson with teaching steps asks for fewer practice questions. There are at least 2.
- Questions are sorted from easy to hard by `difficulty`, then by id.
- **Variety comes first.** About 60% of the practice slots go to questions that are not multiple choice, with one of each type before any type repeats. The hardest question is always included. Multiple choice fills the rest.
- **A reading lesson stays with one passage.** If any question in the lesson has a `passage`, the engine picks one passage, so the student reads it once and answers several questions about it. It prefers the shortest passage that has enough questions. If no passage has enough, it uses the passage with the most questions, then the next, then questions without a passage.
- Replaying a lesson reshuffles which questions it uses, in a repeatable way. This works best when the lesson's skills have about twice as many questions as one lesson needs. With a small bank, replays look alike.

What this means for you: write at least 10 questions for every lesson (more for lessons with passages). Mix question types and spread difficulty from 1 to 5. Make the hardest question a real challenge, because it is always the boss.

### A full test

For each entry in `fullTest.sections`, the engine picks `questions` scored questions whose section matches. The test is seeded. The same seed gives the same test, and a saved test can be rebuilt.

1. **Units.** Questions that share a `passage` form one unit, so a passage is read once. Every other question is its own unit.
2. **Freshness.** A question the student answered right before "costs" 2. One they saw before costs 1. A new one costs 0. Units are shuffled, then the freshest come first. Each test is built from what the student has seen least.
3. **Skill quotas.** Each skill gets a quota. With a blueprint (`fullTest.sections[].skills`), the quotas are your numbers. Without one, each skill's quota is its share of the section, in proportion to how many questions the pack has for it. A unit is taken while it fits the space left and helps a quota that is still open. With a blueprint, an open quota may be met by part of a passage.
4. **Fill.** If the quotas leave space, the freshest remaining units fill it. If a passage does not fit, the engine takes as many of its questions as fit, easy to hard.
5. **Order.** Stand-alone questions come first, easy to hard. The passage sets come after.

What this means for you: have more questions than the test needs, so every test can be different. A bank two to three times the test size is a good goal. Give passages two to five questions. Use a blueprint if the real exam has a known mix of topics.

The clock: with `timing: total`, the clock is `minutes * 60 * factor` seconds. With `per-section`, each section's clock is its `minutes * 60 * factor`. A `factor` of `null` means no clock.

---

## 6. Questions

Questions live in `questions/`. A file is either a list of questions or a mapping with a `questions:` key that holds the list. You can have as many files as you like.

### Fields every question has

| Field | Required | Default | Meaning |
|---|---|---|---|
| `id` | yes | | Unique in the whole pack, not just the file. |
| `skill` | yes | | A skill id from `skills.yaml`. |
| `type` | yes | | One of the 13 types below. It must be listed in `formats`. |
| `section` | no | from the skill | If you write it, it must match the skill's section. Usually leave it out. |
| `difficulty` | no | 3 | A whole number from 1 (easy) to 5 (hard). |
| `prompt` | yes | | The question text. |
| `explanation` | yes | | Why the right answer is right. Shown after the student checks. Write it for a child. |
| `hint` | no | none | A nudge that does not give the answer away. |
| `passage` | no | none | The id of a passage in `passages/`. |
| `box` | no | none | A sentence or short text shown above the choices. `[u]…[/u]` underlines words. |
| `figure` | no | none | A path to an `.svg` file inside the pack, shown under the prompt. |
| `table` | no | none | A data table shown under the prompt (see below). |
| `html` | no | false | `true` lets the prompt use a few tags (see below). |
| `graded` | no | true | `false` means not scored. See section 5. |

Only the fields listed for a type are allowed on that type. Anything else is an error.

**`box`** puts a sentence above the choices, for a "which word fits the blank?" question. Only `[u]` and `[/u]` are special. Other characters, including `<` and `>`, show as plain text.

```yaml
  box: "(1) Many people think a bat is a bird. (2) [u]________[/u] a bat is a mammal."
```

**`table`** is a read-only data table. It is separate from the `table` question type, where the student fills in cells.

```yaml
  table:
    caption: Cookies sold
    cols: ["Day", "Cookies"]
    rows:
      - ["Monday", "12"]
      - ["Tuesday", "18"]
```

All values are strings. Quote numbers.

**`html: true`** lets the **prompt** use these tags only: `<b>`, `<i>`, `<u>`, `<em>`, `<strong>`, `<sub>`, `<sup>`, `<br>`. No attributes (no `class=`, no `style=`). Any other tag, or any attribute, is an error. Everything else, including choices, is plain text. Use it for exponents and chemical formulas:

```yaml
  html: true
  prompt: "What is the value of x<sup>2</sup> when x = 3?"
```

**`figure`** points to an SVG file. It follows the same safety rules as the logo (no scripts, no event handlers). Draw it to fit about 300 pixels wide.

```yaml
  figure: figures/triangle.svg
```

**`passage`** shows the passage next to the question. See section 7.

**Letters and numbers.** Everywhere a choice is named, use a letter from `A` to `F`. `A` is the first choice. A whole number also works (`0` is the first choice), but that is zero-based and easy to get wrong, so use letters. Where a sentence or line is named (`hot`, `mistake`), use a number that **starts at 1**. Don't mix the two up.

Below, each type has a complete example, then its rules. To save space, `explanation` stays short in the examples. In your pack, make it a real explanation.

### mc: multiple choice

One right answer out of 2 to 6 choices.

```yaml
- id: m-ratio-1
  skill: m.ratio
  difficulty: 1
  type: mc
  prompt: A bakery bakes 48 muffins in 4 hours at a steady rate. How many muffins does it bake each hour?
  choices: ["8", "12", "44", "192"]
  answer: B
  whyWrong:
    - "8 does not work: 8 muffins an hour for 4 hours is only 32 muffins."
    - null
    - "44 comes from subtracting 4. A rate needs division, not subtraction."
    - "192 is 48 × 4. Multiplying gives a much bigger number."
  explanation: "Divide the total by the hours. 48 ÷ 4 = 12."
  hint: "A rate for one hour means splitting the muffins evenly across the hours."
```

- `choices`: 2 to 6 items. The right answer is any position. Do not always put it in B or C.
- `answer`: a letter A to F. It must be one of the choices (with 3 choices, only A, B or C).
- `whyWrong` (optional): one line per choice, in the same order. **Put `null` at the right answer's line.** The list must be exactly as long as `choices`. If the right answer's line is not `null`, or the count is off, the validator says so. The student sees the line for the choice they picked, after a wrong answer. Writing a `whyWrong` for every mc question is the best thing you can do for learning.

### multi: choose all that apply

More than one right answer. The student must pick exactly as many choices as there are right answers.

```yaml
- id: e-grammar-2
  skill: e.grammar
  difficulty: 4
  type: multi
  prompt: Which TWO sentences use commas correctly? Choose two answers.
  choices:
    - "Ravi packed apples, bread, and cheese for the trip."
    - "The boy who won the race, got a ribbon."
    - "Before we left, Mom checked the doors."
    - "Please bring a pencil, and a ruler to class."
  answer: [A, C]
  explanation: "A separates items in a list. C puts a comma after an opening phrase."
```

- `choices`: 2 to 6.
- `answer`: a list of letters, at least one. Repeats are ignored.
- At least one choice must be wrong. If every choice is right, validation fails.
- **Say how many to choose in the prompt** ("Choose two answers"). The student can't check until they have picked that many. There is no `whyWrong` on this type.

### typed: type a number

The student types a number.

```yaml
- id: m-ratio-2
  skill: m.ratio
  difficulty: 4
  type: typed
  prompt: Rosa walks 3 miles in 45 minutes. She keeps the same pace. How many miles does she walk in 2 hours?
  answer: 8
  suffix: miles
  explanation: "45 minutes is 3 miles, so 15 minutes is 1 mile. 2 hours is 120 minutes. 120 ÷ 15 = 8."
```

- `answer`: a number, or a string that holds one. Fractions and mixed numbers are fine: `"3/4"`, `"1 1/2"`, `"-2.5"`. Numbers are compared by value, so a student who types `0.75` is right when the answer is `"3/4"`. If the answer is not a number, validation fails.
- `prefix` and `suffix` (optional): text shown before or after the box, such as `$` or `miles`. They do not have to be typed.
- The answer must be a single number. Questions that need a word or a sentence as the answer do not belong in this engine (see section 9).

### inline: pick from menus inside the text

Menus sit inside a sentence.

```yaml
- id: e-grammar-1
  skill: e.grammar
  difficulty: 1
  type: inline
  prompt: Choose the word in each menu that makes the sentences correct.
  text: |
    Maya and her brothers [[walks|*walk|walking]] to school together.
    Each of them [[carry|*carries|carrying]] a lunch box.
  explanation: "Maya and her brothers is more than one person, so the verb is walk. Each of them means one at a time, so carries."
```

- `text`: the sentence. Write each menu as `[[choice|choice|choice]]`. **Put `*` in front of the one right choice.** Every menu needs at least two choices and exactly one `*`.
- Line breaks in `text` are kept. Use the `|` block style for more than one line.
- Choices can't contain `|` or `]`. Spaces around choices are trimmed.
- There must be at least one menu.

### fill: drag tiles into blanks

The student drags (or taps) tiles into blanks.

```yaml
- id: m-equation-2
  skill: m.equation
  difficulty: 3
  type: fill
  prompt: Drag a tile into each blank to finish solving the equation.
  text: |
    Solve 5n − 7 = 28.
    Add 7 to both sides: 5n = ___
    Divide both sides by 5: n = ___
  tiles: ["21", "35", "7", "5"]
  answer: ["35", "7"]
  explanation: "28 + 7 = 35, so 5n = 35. Then 35 ÷ 5 = 7."
```

- `text`: write each blank as `___` (three or more underscores). Line breaks are kept.
- `tiles`: at least 2. Include wrong tiles to make it a real choice.
- `answer`: the correct tile for each blank, **in the order the blanks appear**. Each entry must be written exactly as it appears in `tiles`.
- **The number of blanks must equal the number of entries in `answer`.** The validator counts both.
- Give each tile its own text. If two blanks have the same answer, the checker can only match the first tile with that text.

### classify: sort cards into buckets

```yaml
- id: e-grammar-3
  skill: e.grammar
  difficulty: 3
  type: classify
  prompt: Sort each sentence by the job its comma does.
  buckets: ["Separates items in a list", "Follows an opening word or phrase", "Joins two full sentences"]
  cards:
    - { text: "We packed apples, bread, and cheese.", bucket: "Separates items in a list" }
    - { text: "After lunch, we walked to the park.", bucket: "Follows an opening word or phrase" }
    - { text: "Maya likes soccer, but Leo likes chess.", bucket: "Joins two full sentences" }
  explanation: "A list needs commas between its items. A comma follows an opening phrase. A comma plus but joins two full sentences."
```

- `buckets`: at least 2 names.
- `cards`: at least 2. Each has `text` and `bucket`. `bucket` is either the bucket's name, written exactly as in `buckets`, or its **number counting from 1** (`bucket: 2` is the second bucket).
- **Quote card text that contains a comma** (see the [comma gotcha](#the-yaml-comma-gotcha)). It is the most common mistake on this type.

### order: put items in order

```yaml
- id: e-story-2
  skill: e.story
  difficulty: 2
  type: order
  passage: kite-day
  prompt: Put these events from the story in the order they happen.
  items:
    - "The kite spins into the ground twice."
    - "The kite catches on a branch of the oak tree."
    - "Lupe says the kite needs a tail."
    - "Tomas ties strips of his scarf to the kite."
    - "The kite climbs higher than the school roof."
  explanation: "First the kite spins down. Then it snags in the oak. Lupe says it needs a tail. Tomas adds the strips. Then it climbs."
```

- `items`: at least 3. **Write them in the right order.** The app shuffles them for the student. The shuffle is the same every time and is never the right order.
- Items must all be different.

### hot: tap the sentence

"Hot text": the student taps one sentence.

```yaml
- id: e-info-2
  skill: e.info
  difficulty: 3
  type: hot
  passage: bee-dance
  prompt: "Tap the sentence from the third paragraph that best supports this claim: The dance gives bees information about distance."
  sentences:
    - "The waggle run holds the message."
    - "Its angle shows which way the flowers lie compared to the sun."
    - "A bee that waggles straight up is pointing toward the sun."
    - "A longer waggle run means the flowers are farther away."
  answer: 4
  explanation: "Only sentence 4 is about how far away the flowers are."
```

- `sentences`: at least 2. They are shown for the student to tap.
- `answer`: the right sentence's **number, counting from 1**. With 4 sentences, the answer is 1 to 4.
- The sentences usually come from a passage, so repeat them exactly.

### numline: mark a spot on a number line

For a single point, or for a ray (an inequality).

```yaml
- id: m-inequality-1
  skill: m.inequality
  difficulty: 3
  type: numline
  prompt: "Graph all the values of x that make this true: 2x − 3 > 5"
  min: 0
  max: 8
  step: 1
  answer: { value: 4, closed: false, dir: right }
  explanation: "2x > 8, so x > 4. The number 4 does not work, so use an open circle at 4 and shade to the right."
```

- `min`, `max`, `step`: the line's range and the spacing of the ticks. `max` must be above `min`. `step` must be above zero.
- `mode`: `point` (mark one spot) or `ray` (mark a spot, open or closed, and a direction). If you leave it out, a plain number answer means `point` and an `{ ... }` answer means `ray`.
- `answer` for a point: a number, such as `answer: 3`.
- `answer` for a ray: `{ value, closed, dir }`. `closed: true` is a filled circle (`≤` or `≥`). `dir` is `left` or `right`.
- The answer's `value` must be on the line and exactly on a tick (from `min`, in steps of `step`). A ray with a plain number answer is an error.

### plot: plot points on a grid

```yaml
- id: m-geometry-2
  skill: m.geometry
  difficulty: 3
  type: plot
  prompt: The bottom side of a square runs from (1, 1) to (4, 1). Plot the two top corners of the square.
  grid: { xmin: 0, xmax: 6, ymin: 0, ymax: 6 }
  points: [[1, 4], [4, 4]]
  explanation: "The bottom side is 3 units long. A square has equal sides, so the top corners are 3 units up: (1, 4) and (4, 4)."
```

- `grid`: all four of `xmin`, `xmax`, `ymin`, `ymax`. Points are whole numbers.
- Give **either** `points` or `line`:
  - `points`: the exact points the student must plot, as `[x, y]` pairs. Order does not matter. Each must be inside the grid.
  - `line`: `{ m: 2, b: 1 }` means the line y = 2x + 1. The student plots any points on that line. Put in `count: 2` or more to say how many.
- `count`: how many points the student places. It defaults to the number of `points`, or 2 for a `line`.
- Do not give both `points` and `line`. If you do, only `line` is used to check the answer.

### mistake: find the mistake

The student sees a worked solution, taps the line that goes wrong, then picks why it is wrong. Both must be right.

```yaml
- id: m-mistake-1
  skill: m.ratio
  difficulty: 3
  type: mistake
  prompt: Find the mistake in this solution.
  context: "A van drives 150 miles in 3 hours. How far does it drive in 5 hours at the same speed?"
  lines:
    - "Find the unit rate: 150 ÷ 3 = 50 miles per hour."
    - "Use it for 5 hours: 50 + 5 = 55."
    - "The van drives 55 miles."
  wrongLine: 2
  reasons:
    - "The unit rate should be 3 ÷ 150."
    - "To find the distance for 5 hours, you multiply: 50 × 5, not 50 + 5."
    - "The number 150 should be added to 5."
  reason: B
  explanation: "50 miles for each hour means 50 × 5 = 250 miles for 5 hours."
```

- `context` (optional): the problem the solution answers.
- `lines`: at least 2 lines of the solution.
- `wrongLine`: the wrong line's **number, counting from 1**.
- `reasons`: at least 2 reasons. `reason` is a **letter** for the right one. Reasons are lettered A to F, like choices.
- This type is also what the `mistake` slot of a teach file uses.

### table: fill in a table

The student types numbers into some cells.

```yaml
- id: m-table-1
  skill: m.ratio
  difficulty: 2
  type: table
  prompt: "Pens are sold at a steady price: 4 pens cost $8. Fill in the table."
  head: ["Pens", "Cost"]
  rows:
    - ["4", "$8"]
    - ["1", { answer: 2, prefix: "$" }]
    - ["3", { answer: 6, prefix: "$" }]
    - ["10", { answer: 20, prefix: "$" }]
  explanation: "$8 ÷ 4 = $2 for one pen. Then 3 pens cost $6 and 10 pens cost $20."
```

- `head`: the column titles. At least 2.
- `rows`: at least 1. Every row must have as many cells as `head` has columns.
- A cell is either a **string** (fixed text the student reads) or an **answer cell**: `{ answer: 6 }`, with an optional `prefix` shown before the box. Answers are numbers.
- At least one cell must be an answer cell.

### estimate: guess first, then see the answer

The student slides to a guess, then sees the real answer.

```yaml
- id: m-estimate-1
  skill: m.ratio
  difficulty: 1
  type: estimate
  prompt: A cyclist rides 30 miles in 2 hours. About how many miles is that in one hour?
  min: 0
  max: 30
  step: 1
  answer: 15
  close: 1
  suffix: miles
  explanation: "30 miles in 2 hours is 15 miles in 1 hour, because 30 ÷ 2 = 15."
```

- `min`, `max`, `step`: the slider's range and spacing. `answer` must lie within `min` to `max`.
- `close`: how far from `answer` still counts as a "Great estimate!". It only changes the message.
- `prefix` and `suffix` (optional): text before or after the number.
- **It is never scored.** Any guess is fine: the step builds a feel for numbers and does not measure a skill. So an `estimate` never enters a lesson's practice steps or a full test. Use it as a lesson's warm-up or guided step (`teach`).

### Which types to use

You do not have to use all 13. Pick the ones the real exam has. If the real exam is only multiple choice, use `mc` only and set `formats: [mc]`. If the real test is on a computer with drag-and-drop and drop-down items, include the matching types so students are not surprised on test day. The lesson builder mixes types, so a pack with more types has more variety.

---

## 7. Passages

A passage is text that several questions can point to. Questions point to it with `passage: <id>`.

```yaml
# passages/bee-dance.yaml
id: bee-dance
title: How Honeybees Give Directions
genre: informational
intro: Read the passage. Then answer the questions.
paragraphs:
  - "A honeybee that finds a good patch of flowers does not keep the news to herself."
  - "The dance takes place on the upright wall of the honeycomb, inside the dark hive."
source: Written for this pack.
```

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Unique across passages. Questions refer to it. |
| `title` | no | Shown above the text. |
| `genre` | no | Free text, such as `literary`, `informational`, `poem`, `argument`. |
| `intro` | no | A line before the text. |
| `paragraphs` | yes, at least 1 | The text, one entry per paragraph. |
| `source` | no | A credit line. Write `Written for this pack.` for your own text. |

A passage file may hold one passage (as above) or a list of passages. Each passage must have a unique id. A question that points to a passage that does not exist is an error. A passage that no question uses is a warning.

Tips:

- Paragraph numbers matter when a question says "the third paragraph". Keep paragraphs in order and refer to them correctly.
- A question's `passage` is not checked against its section. Keep ELA passages with ELA questions.
- A passage with two to five questions works best in lessons and in the full test (section 5).

---

## 8. Validation

Run `npm run validate -- --pack my-exam`. It exits with code 1 if there are errors, and 0 if there are none. It prints a one-line summary when the pack is clean:

```
✓ packs/demo-isee: ISEE Prep Demo — 10 questions, 1 passages, 4 worlds, 7 lessons
```

### What it checks

**Files and format**
- Every file is valid YAML (or JSON) and every field has the right type and range.
- No unknown keys, anywhere.
- Ids use only letters, digits, `.`, `-` and `_`. Colors are `#RRGGBB`. Dates are `YYYY-MM-DD`.
- A world has 1 to 5 lessons. A question has the fields its type needs.

**pack.yaml**
- Each section named in `fullTest`, `tips` and `scoring` exists in `sections`.
- `timing: total` has `minutes`. `timing: per-section` gives `minutes` on every section.
- Every test section has a score scale.
- The logo file exists and is a safe SVG.
- Each test section has enough scored questions for what it asks. Blueprint skills belong to that section, have enough questions, and add up to no more than the section's size.

**skills.yaml**
- Skill ids are unique. Each skill's section exists. Every `requires` id exists. There are no cycles.

**Each question**
- The id is unique across all question files.
- The type is in `formats`.
- The skill exists, `section` (if written) matches it, and `passage` exists.
- A `figure` file exists and is a safe SVG. With `html: true`, the prompt uses only allowed tags.
- The type's own rules hold: an answer letter is one of the choices, `whyWrong` matches `choices` and has `null` at the right answer, an inline menu has exactly one `*`, the blanks in a fill match its answers, a card's bucket exists, a hot or mistake line number is in range, a numline answer sits on a tick, plot points are inside the grid, a table row has the right number of cells, and so on.

**curriculum.yaml**
- Each world's section exists. Each lesson's skills exist and belong to the world's section.
- A `teach` file exists. Its steps pass the same question checks. `teach.mistake` has type `mistake`.

**Warnings** (the pack still passes): a lesson with no questions yet, a section with no worlds, a skill with no questions, a passage no question uses.

### How errors look

Each problem is one line: the file, then where in it, then what is wrong. Warnings are printed first, then errors. Here is the real output for a pack that is wrong on purpose. It lives at `tests/fixtures/broken-pack`, and the tests use it:

```
$ node scripts/pack.mjs validate tests/fixtures/broken-pack
tests/fixtures/broken-pack: 4 warning(s)
  ! curriculum.yaml › worlds[2] Math Land › Skill A: no questions for this lesson yet (it shows as "coming soon")
  ! curriculum.yaml › worlds[2] Math Land › Skill B: no questions for this lesson yet (it shows as "coming soon")
  ! skills.yaml › m.a: no questions use this skill
  ! skills.yaml › m.b: no questions use this skill
✗ tests/fixtures/broken-pack: 12 problem(s)
  ✗ skills.yaml › m.a: requires form a cycle (a skill builds on itself through others)
  ✗ skills.yaml › m.b: requires form a cycle (a skill builds on itself through others)
  ✗ brand/logo.svg: must not contain event handlers (onclick=…)
  ✗ questions/broken.yaml › b-format: type "typed" is not in this pack's formats (mc, inline, fill)
  ✗ questions/broken.yaml › b-answer-range: answer "D" is not one of the 3 choices (A, B, C)
  ✗ questions/broken.yaml › b-whywrong: whyWrong: the line for the right answer must be null
  ✗ questions/broken.yaml › b-skill: skill "m.nope" is not in skills.yaml
  ✗ questions/broken.yaml › b-dup: question id "b-dup" is also used in questions/broken.yaml
  ✗ questions/broken.yaml › b-inline: menu [[run|runs|running]] needs exactly one choice marked with *
  ✗ questions/broken.yaml › b-fill: text has 2 blanks (___) but answer lists 1 tiles
  ✗ questions/broken.yaml › b-passage: passage "no-such-passage" not found in passages/
  ✗ pack.yaml › fullTest.sections.math.questions: the full test asks 50 math questions but the pack has only 0
```

(The logo in that pack has an `onload=` handler. The message says `onclick=` as an example of any handler.)

Read an error like this:

- `questions/broken.yaml › b-fill` is the file and the question id.
- `worlds[2] Math Land › Skill A` is the second world, then the lesson.
- `[2]` in a path counts from 1.

Every error names the question by its id, after the file. Errors from the basic format check (a missing `explanation`, a misspelled key, too few `choices`) then name the field:

```
  ✗ questions/math.yaml › m-rate-2 › explanation: Invalid input: expected string, received undefined
  ✗ questions/math.yaml › m-rate-3 › choices: Too small: expected array to have >=2 items
```

Fix the errors from the top, and run the validator again. One mistake can cause others. For example, a question that fails its checks is left out, so a full test can then look short of questions.

### The YAML comma gotcha

Many examples use short `{ ... }` maps on one line. In a `{ ... }` map, an unquoted value cannot hold a comma, because the comma ends the value. The rest of the sentence becomes a new key, and the validator reports an "Unrecognized key".

Wrong:

```yaml
cards:
  - { text: After lunch, we left., bucket: Opening phrase }
```

```
  ✗ questions/math.yaml › cards[1]: Unrecognized key: "we left."
```

Right: quote the value.

```yaml
cards:
  - { text: "After lunch, we left.", bucket: Opening phrase }
```

The same thing happens in `choices: [a, b]` style lists, in `testDates`, `features`, `faq` and `scoring.benchmarks`. The simplest rule: **quote every text value that has a comma, a colon, or a leading symbol**. If a pack passes the validator but a sentence is cut short on screen, look for a missing quote.

Another trap: an unquoted color such as `primary: #1E4D3A` is read as an empty value with a comment. The error says "expected string, received null". Quote it: `primary: "#1E4D3A"`.

### Run the tests

The repository tests check both sample packs and a set of deliberately broken packs:

```bash
npm test
```

---

## 9. Content rules for authors

These rules are not all things a program can check. You are responsible for them.

**Write original questions.**
- Write every question yourself. Do not copy official or copyrighted test items, and do not reword them. Changing the numbers in an official item is still copying.
- Write your own passages. Do not paste text from books, articles or websites unless you have the right to use it. Public-domain texts are fine. Credit the source in `source`.
- Write questions *in the style of* the exam. Match the question types, the reading level, and the kind of thinking the exam asks for. Do not reproduce its items.
- Say in `site.disclaimer` that you are not affiliated with the test maker. Do not use the test maker's logo or name as your brand.

**Check your facts.** A wrong answer key hurts a student who gets the right answer and is told they are wrong.
- Solve every math problem yourself. Check units, rounding and the wording.
- Read every choice. In `mc`, make sure exactly one choice is right and the others are wrong for a reason a student could fall for.
- Make sure a passage supports every reading answer. A reading question must be answerable from the text, not from outside knowledge.
- Have a second person check the key. Read the `explanation` as a child would.

**Keep it kid-safe.**
- The students are children. Use plain language and an encouraging tone.
- No violence, scary topics, insults, adult themes, brands, politics or religion in questions, passages or tips.
- Don't use real children's names, or real people's private details. Use made-up names. Don't ask a student to describe their own family, address or school.
- Keep `explanation`, `hint` and `whyWrong` kind. Say what is wrong with the thinking, not what is wrong with the student.

**Follow the privacy defaults (COPPA).** The engine is built so children give away as little as possible. Your content must keep it that way.
- Students only **tap, choose, drag, slide, or type a number**. There are no free-text answers. Do not write questions that need a student to type a word, name or sentence. Use `mc`, `multi`, `inline`, `fill`, `classify`, `order` or `hot` for questions that are about words. Use `typed` and `table` only for numbers.
- Do not ask for personal information in a question, passage, tip or rule. Do not ask for a name, an email address, a school, a birthday or a location.
- **No prices on child-facing screens.** The lessons, questions, tips, rules and test screens are for children. Do not mention what the app or a plan costs, or ask a child to buy or upgrade anything there. Dollar amounts inside math problems are fine ("a jacket costs $80"). The landing page (`site`) is for parents, but keep its text honest and clear too.
- Do not link children to other websites from a question, tip or passage.

**Be honest about scores.** The score is an estimate. The `scoring.disclaimer` must say that, and it should say the exam maker does not publish the conversion if that is true. Don't promise admission, and don't set `benchmarks` as if they were official cutoffs unless the exam maker publishes them. Label them as examples.
