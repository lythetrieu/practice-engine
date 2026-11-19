// Reads a test pack from disk, checks it, and compiles it into what the app plays.
// Used by astro.config.mjs (through the Vite plugin in vite.mjs) and by scripts/pack.mjs (validate, dev, build).
// Nothing here talks to a database: a build needs only the pack's files.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { FORMATS, configSchema, curriculumSchema, passageSchema, questionSchema, skillsSchema } from './schema.mjs';

const LETTERS = 'ABCDEF';

/** Every pack folder under packs/ (a folder with a pack.yaml). */
export function listPacks(root) {
  const dir = path.join(root, 'packs');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((d) => existsSync(path.join(dir, d, 'pack.yaml'))).sort();
}

/** The pack folder for a name ("demo-isee") or a path ("./my-pack"). */
export function packDir(root, nameOrPath) {
  const asPath = path.resolve(root, nameOrPath);
  if (existsSync(path.join(asPath, 'pack.yaml'))) return asPath;
  return path.join(root, 'packs', nameOrPath);
}

/** Loads, checks and compiles a pack. Never throws for a bad pack: problems come back in `errors`. */
export function loadPack(dir) {
  const errors = [];
  const warnings = [];
  const err = (file, where, message) => errors.push({ file, where, message });
  const warn = (file, where, message) => warnings.push({ file, where, message });
  const rel = (f) => path.relative(dir, f) || f;

  if (!existsSync(path.join(dir, 'pack.yaml'))) {
    err('pack.yaml', '', `no pack.yaml in ${dir}`);
    return { ok: false, errors, warnings };
  }

  /** Parses one YAML or JSON file (null when it cannot be read; the error is recorded). */
  const read = (file) => {
    try {
      const raw = readFileSync(file, 'utf8');
      // CORE_SCHEMA: dates such as 2026-11-14 stay strings, as the schema expects
      return file.endsWith('.json') ? JSON.parse(raw) : yaml.load(raw, { schema: yaml.CORE_SCHEMA, filename: file });
    } catch (e) {
      err(rel(file), '', String(e.message || e).split('\n')[0]);
      return null;
    }
  };
  /** Checks a value against a schema; records every issue under the file. `name` turns an array index into an id. */
  const check = (schema, value, file, name, prefix = '') => {
    const r = schema.safeParse(value);
    if (r.success) return r.data;
    for (const issue of r.error.issues) err(file, [prefix, where(issue.path, value, name)].filter(Boolean).join(' › '), issue.message);
    return null;
  };
  /** A path inside the pack, or null (and an error) when it points outside it. */
  const inside = (file, where0, p) => {
    const full = path.resolve(dir, p);
    if (full !== dir && !full.startsWith(dir + path.sep)) { err(file, where0, `path "${p}" points outside the pack`); return null; }
    return full;
  };
  const files = (sub) => {
    const d = path.join(dir, sub);
    if (!existsSync(d)) return [];
    const out = [];
    const walk = (x) => {
      for (const e of readdirSync(x).sort()) {
        const f = path.join(x, e);
        if (statSync(f).isDirectory()) walk(f);
        else if (/\.(ya?ml|json)$/.test(e)) out.push(f);
      }
    };
    walk(d);
    return out;
  };

  // ---- pack.yaml
  const config = check(configSchema, read(path.join(dir, 'pack.yaml')), 'pack.yaml');
  // ---- skills.yaml
  const skillsRaw = existsSync(path.join(dir, 'skills.yaml')) ? read(path.join(dir, 'skills.yaml')) : (err('skills.yaml', '', 'missing'), null);
  const skillList = skillsRaw ? check(skillsSchema, skillsRaw, 'skills.yaml', (i) => skillsRaw[i]?.id) || [] : [];
  // ---- curriculum.yaml
  const curRaw = existsSync(path.join(dir, 'curriculum.yaml')) ? read(path.join(dir, 'curriculum.yaml')) : (err('curriculum.yaml', '', 'missing'), null);
  // a lesson's `teach` may be a file of its own (teach: teach/unit-rates.yaml)
  for (const wd of Array.isArray(curRaw?.worlds) ? curRaw.worlds : []) {
    for (const ls of Array.isArray(wd?.lessons) ? wd.lessons : []) {
      if (typeof ls?.teach !== 'string') continue;
      const f = inside('curriculum.yaml', `${wd.name} › ${ls.title}`, ls.teach);
      if (!f) { delete ls.teach; continue; }
      if (!existsSync(f)) { err('curriculum.yaml', `${wd.name} › ${ls.title}`, `teach file not found: ${ls.teach}`); delete ls.teach; continue; }
      const t = read(f);
      if (t === null) delete ls.teach; else ls.teach = t;
    }
  }
  const curriculum = curRaw ? check(curriculumSchema, curRaw, 'curriculum.yaml') : null;
  // ---- passages/
  const passages = {};
  for (const f of files('passages')) {
    const v = read(f);
    if (v === null) continue;
    for (const [i, p] of (Array.isArray(v) ? v : [v]).entries()) {
      const ok = check(passageSchema, p, rel(f), () => (Array.isArray(v) ? p?.id ?? `#${i + 1}` : p?.id));
      if (!ok) continue;
      if (passages[ok.id]) err(rel(f), ok.id, `passage id "${ok.id}" is used twice`);
      passages[ok.id] = { ...ok, file: rel(f) };
    }
  }
  // ---- questions/
  const questions = [];
  for (const f of files('questions')) {
    const v = read(f);
    if (v === null) continue;
    const list = Array.isArray(v) ? v : Array.isArray(v?.questions) ? v.questions : null;
    if (!list) { err(rel(f), '', 'a question file holds a list of questions (or `questions:` with a list)'); continue; }
    list.forEach((item, i) => {
      const ok = check(questionSchema, item, rel(f), null, String(item?.id ?? `question #${i + 1}`));
      if (ok) questions.push({ ...ok, file: rel(f) });
    });
  }
  if (!config || !curriculum) return { ok: false, errors, warnings };

  // ---- cross-checks
  const sectionIds = new Set(config.sections.map((s) => s.id));
  const skills = {};
  for (const s of skillList) {
    if (skills[s.id]) err('skills.yaml', s.id, `skill id "${s.id}" is used twice`);
    if (!sectionIds.has(s.section)) err('skills.yaml', s.id, `section "${s.section}" is not in pack.yaml sections (${[...sectionIds].join(', ')})`);
    skills[s.id] = s;
  }
  for (const s of skillList) for (const r of s.requires) if (!skills[r]) err('skills.yaml', s.id, `requires "${r}", which is not in skills.yaml`);
  for (const s of skillList) {
    // a cycle: following `requires` from s comes back to s
    const seen = new Set(), stack = [...s.requires];
    while (stack.length) {
      const x = stack.pop();
      if (x === s.id) { err('skills.yaml', s.id, 'requires form a cycle (a skill builds on itself through others)'); break; }
      if (seen.has(x)) continue;
      seen.add(x);
      stack.push(...(skills[x]?.requires || []));
    }
  }
  const brandLogo = inside('pack.yaml', 'brand.logo', config.brand.logo);
  let logo = '';
  if (!brandLogo) { /* recorded */ } else if (!existsSync(brandLogo)) err('pack.yaml', 'brand.logo', `file not found: ${config.brand.logo}`);
  else { logo = readFileSync(brandLogo, 'utf8'); svgProblems(logo).forEach((m) => err(config.brand.logo, '', m)); }

  let mascot = '';
  if (config.mascot.image) {
    const mp = inside('pack.yaml', 'mascot.image', config.mascot.image);
    if (mp && !existsSync(mp)) err('pack.yaml', 'mascot.image', `file not found: ${config.mascot.image}`);
    else if (mp) { mascot = readFileSync(mp, 'utf8'); svgProblems(mascot).forEach((m) => err(config.mascot.image, '', m)); }
  }
  if (!config.legal) warn('pack.yaml', 'legal', 'no legal block: the privacy notice and terms show placeholders until you add operator, contactEmail and effectiveDate');
  if (config.plan && !config.plan.supportEmail && !config.legal) err('pack.yaml', 'plan.supportEmail', 'a paid plan needs a support address for refunds: set plan.supportEmail or legal.contactEmail');
  for (const t of config.fullTest.sections) {
    if (!sectionIds.has(t.section)) err('pack.yaml', `fullTest.sections.${t.section}`, `section "${t.section}" is not in sections`);
    if (config.fullTest.timing === 'per-section' && !t.minutes) err('pack.yaml', `fullTest.sections.${t.section}.minutes`, 'per-section timing needs minutes on every section');
  }
  if (config.fullTest.timing === 'total' && !config.fullTest.minutes) err('pack.yaml', 'fullTest.minutes', 'total timing needs fullTest.minutes');
  for (const k of Object.keys(config.tips)) if (!sectionIds.has(k)) err('pack.yaml', `tips.${k}`, `section "${k}" is not in sections`);
  for (const k of Object.keys(config.scoring.sections)) if (!sectionIds.has(k)) err('pack.yaml', `scoring.sections.${k}`, `section "${k}" is not in sections`);
  for (const t of config.fullTest.sections) if (!config.scoring.sections[t.section]) err('pack.yaml', `scoring.sections`, `no score scale for the test section "${t.section}"`);
  const allowed = new Set(config.formats);

  const seen = new Map();
  const steps = [];
  /** Checks one question (pack question or teaching step) and turns it into an engine step. */
  const compile = (qn, file, where0, opts = {}) => {
    const w = where0 || qn.id;
    const before = errors.length;
    const fail = (m) => err(file, w, m);
    if (!opts.teach && !allowed.has(qn.type)) fail(`type "${qn.type}" is not in this pack's formats (${config.formats.join(', ')})`);
    let section = qn.section;
    if (qn.skill && qn.skill !== '__lesson__') {
      const sk = skills[qn.skill];
      if (!sk) fail(`skill "${qn.skill}" is not in skills.yaml`);
      else if (section && section !== sk.section) fail(`section "${section}" does not match skill "${qn.skill}" (section "${sk.section}")`);
      else section = sk.section;
    }
    if (section && !sectionIds.has(section)) fail(`section "${section}" is not in pack.yaml sections`);
    if (qn.passage && !passages[qn.passage]) fail(`passage "${qn.passage}" not found in passages/`);
    let fig;
    if (qn.figure) {
      const fp = inside(file, w, qn.figure);
      if (!fp) { /* recorded */ } else if (!existsSync(fp)) fail(`figure not found: ${qn.figure}`);
      else { fig = readFileSync(fp, 'utf8'); svgProblems(fig).forEach((m) => fail(`${qn.figure}: ${m}`)); }
    }
    if (qn.html) htmlProblems(qn.prompt).forEach((m) => fail(`prompt: ${m}`));
    const step = toStep(qn, fail);
    if (errors.length > before || !step) return null;
    if (fig) step.fig = fig;
    return { step, section };
  };

  for (const qn of questions) {
    if (seen.has(qn.id)) { err(qn.file, qn.id, `question id "${qn.id}" is also used in ${seen.get(qn.id)}`); continue; }
    seen.set(qn.id, qn.file);
    const c = compile(qn, qn.file);
    if (!c) continue;
    steps.push({ id: qn.id, section: c.section, skill: qn.skill, d: qn.difficulty, ...(qn.passage ? { pid: qn.passage } : {}), step: c.step });
  }

  // ---- curriculum: worlds and lessons (ids "<section>-<world>-<level>", world numbered within its section)
  const worlds = [];
  const teach = {};
  const perSection = {};
  curriculum.worlds.forEach((wd, wi) => {
    const where = `worlds[${wi + 1}] ${wd.name}`;
    if (!sectionIds.has(wd.section)) { err('curriculum.yaml', where, `section "${wd.section}" is not in pack.yaml sections`); return; }
    const n = (perSection[wd.section] = (perSection[wd.section] || 0) + 1);
    const lessons = wd.lessons.map((ls, li) => {
      const lid = `${wd.section}-${n}-${li + 1}`;
      for (const s of ls.skills) {
        if (!skills[s]) err('curriculum.yaml', `${where} › ${ls.title}`, `skill "${s}" is not in skills.yaml`);
        else if (skills[s].section !== wd.section) err('curriculum.yaml', `${where} › ${ls.title}`, `skill "${s}" belongs to section "${skills[s].section}", not "${wd.section}"`);
      }
      const pool = steps.filter((x) => ls.skills.includes(x.skill));
      if (!pool.length) warn('curriculum.yaml', `${where} › ${ls.title}`, 'no questions for this lesson yet (it shows as "coming soon")');
      if (ls.teach) {
        const t = ls.teach;
        const one = (x, kind, i) => {
          if (!x) return undefined;
          const c = compile({ ...x, id: x.id || `${lid}-${kind}${i ?? ''}`, skill: x.skill || '__lesson__' }, 'curriculum.yaml', `${where} › ${ls.title} › teach.${kind}${i !== undefined ? `[${i + 1}]` : ''}`, { teach: true });
          if (!c) return undefined;
          const stage = kind === 'guided' ? 'guided' : kind;
          return { ...c.step, stage, ...(kind === 'warmup' && x.graded === undefined ? { graded: false } : {}) };
        };
        const learn = { id: `${lid}-learn`, kind: 'learn', stage: 'learn', graded: false, title: t.learn.title, lines: t.learn.lines, prompt: t.learn.prompt || '', exp: '' };
        const mistake = one(t.mistake, 'mistake');
        if (t.mistake && t.mistake.type !== 'mistake') err('curriculum.yaml', `${where} › ${ls.title} › teach.mistake`, 'teach.mistake must be a question of type "mistake"');
        teach[lid] = { warmup: one(t.warmup, 'warmup'), learn, guided: t.guided.map((g, i) => one(g, 'guided', i)).filter(Boolean), mistake };
      }
      return { id: lid, section: wd.section, world: n, level: li + 1, title: ls.title, skills: ls.skills, ...(ls.icon ? { icon: ls.icon } : {}) };
    });
    worlds.push({ section: wd.section, n, name: wd.name, unit: wd.unit, lessons });
  });

  // ---- full test: blueprints name skills of their own section and fit the section's size
  for (const t of config.fullTest.sections) {
    if (!t.skills) continue;
    let sum = 0;
    for (const [k, n] of Object.entries(t.skills)) {
      sum += n;
      if (!skills[k]) err('pack.yaml', `fullTest.sections.${t.section}.skills`, `skill "${k}" is not in skills.yaml`);
      else if (skills[k].section !== t.section) err('pack.yaml', `fullTest.sections.${t.section}.skills`, `skill "${k}" belongs to section "${skills[k].section}"`);
      else if (steps.filter((x) => x.skill === k && x.step.graded !== false).length < n) err('pack.yaml', `fullTest.sections.${t.section}.skills.${k}`, `asks ${n} questions but the pack has fewer`);
    }
    if (sum > t.questions) err('pack.yaml', `fullTest.sections.${t.section}.skills`, `the blueprint adds up to ${sum}, more than the section's ${t.questions} questions`);
  }
  // ---- full test: enough questions in each section
  const count = {};
  for (const s of steps) if (s.step.graded !== false) count[s.section] = (count[s.section] || 0) + 1;
  for (const t of config.fullTest.sections) {
    const have = count[t.section] || 0;
    if (have < t.questions) err('pack.yaml', `fullTest.sections.${t.section}.questions`, `the full test asks ${t.questions} ${t.section} questions but the pack has only ${have}`);
  }
  for (const s of config.sections) if (!worlds.some((w) => w.section === s.id)) warn('curriculum.yaml', '', `section "${s.id}" has no worlds (it will not show on the map)`);
  for (const sk of skillList) if (!steps.some((x) => x.skill === sk.id)) warn('skills.yaml', sk.id, 'no questions use this skill');
  for (const p of Object.values(passages)) if (!steps.some((x) => x.pid === p.id)) warn(p.file, p.id, 'no question uses this passage');

  if (errors.length) return { ok: false, errors, warnings };
  const pack = {
    config: { ...config, formats: config.formats.filter((f) => FORMATS.includes(f)) },
    logo,
    mascot,
    skills,
    worlds,
    counts: count,
  };
  const bank = {
    version: hash(JSON.stringify([steps, passages, teach])),
    items: steps,
    passages: Object.fromEntries(Object.values(passages).map((p) => [p.id, { id: p.id, title: p.title, genre: p.genre, intro: p.intro, paras: p.paragraphs, src: p.source }])),
    teach,
  };
  return { ok: true, errors, warnings, pack, bank, stats: { questions: steps.length, passages: Object.keys(passages).length, lessons: worlds.reduce((n, w) => n + w.lessons.length, 0), worlds: worlds.length } };
}

/** "questions/math.yaml › m-003 › choices" style location for a schema issue. */
function where(p, value, name) {
  if (!p.length) return '';
  const parts = [...p];
  let head = '';
  if (typeof parts[0] === 'number' && name) { head = String(name(parts[0]) ?? `#${parts[0] + 1}`); parts.shift(); }
  return [head, parts.map((x) => (typeof x === 'number' ? `[${x + 1}]` : x)).join('.').replace(/\.\[/g, '[')].filter(Boolean).join(' › ');
}

const indexOf = (a, n) => (typeof a === 'number' ? a : LETTERS.indexOf(String(a).toUpperCase()));
/** A typed answer: 52, "3/4", "1 1/2", "-2.5". */
export function numberOf(v) {
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  let m = /^(-?\d+)\s+(\d+)\/(\d+)$/.exec(s);
  if (m) { const w = +m[1]; const f = +m[2] / +m[3]; return w < 0 ? w - f : w + f; }
  m = /^(-?\d*\.?\d+)\/(\d*\.?\d+)$/.exec(s);
  if (m && +m[2] !== 0) return +m[1] / +m[2];
  return /^-?(\d+\.?\d*|\.\d+)$/.test(s) ? +s : NaN;
}

/** A pack question as the engine's step (src/practice/levels/types.ts). Problems go to `fail`. */
export function toStep(q, fail) {
  const base = {
    id: q.id, stage: 'practice', prompt: q.prompt, exp: q.explanation,
    ...(q.hint ? { hint: q.hint } : {}), ...(q.html ? { html: true } : {}), ...(q.box ? { box: q.box } : {}),
    ...(q.table ? { tbl: q.table } : {}), ...(q.passage ? { pid: q.passage } : {}), ...(q.graded === false ? { graded: false } : {}),
  };
  const choice = (a, n, what = 'answer') => {
    const i = indexOf(a, n);
    if (!(i >= 0 && i < n)) fail(`${what} "${a}" is not one of the ${n} choices (${LETTERS.slice(0, n).split('').join(', ')})`);
    return i;
  };
  switch (q.type) {
    case 'mc': {
      const ans = choice(q.answer, q.choices.length);
      if (q.whyWrong) {
        if (q.whyWrong.length !== q.choices.length) fail(`whyWrong has ${q.whyWrong.length} lines for ${q.choices.length} choices (use null for the right one)`);
        else if (q.whyWrong[ans]) fail('whyWrong: the line for the right answer must be null');
      }
      return { ...base, kind: 'mc', opts: q.choices, ans, ...(q.whyWrong ? { wrongWhy: q.whyWrong.map((x) => x || null) } : {}) };
    }
    case 'multi': {
      const ans = [...new Set(q.answer.map((a) => choice(a, q.choices.length)))].sort((a, b) => a - b);
      if (ans.length === q.choices.length) fail('every choice is right: leave at least one wrong choice');
      return { ...base, kind: 'multi', opts: q.choices, ans };
    }
    case 'typed': {
      const n = numberOf(q.answer);
      if (!Number.isFinite(n)) fail(`answer "${q.answer}" is not a number (fractions like "3/4" are fine)`);
      return { ...base, kind: 'typed', answer: n, ...(q.prefix ? { prefix: q.prefix } : {}), ...(q.suffix ? { suffix: q.suffix } : {}) };
    }
    case 'inline': {
      const parts = [];
      const re = /\[\[([^\]]+)\]\]/g;
      let last = 0, m;
      const lines = (s) => s.split('\n').forEach((x, i) => { if (i) parts.push('\n'); if (x) parts.push(x); });
      while ((m = re.exec(q.text))) {
        lines(q.text.slice(last, m.index));
        const opts = m[1].split('|').map((x) => x.trim());
        const right = opts.filter((x) => x.startsWith('*'));
        if (right.length !== 1) fail(`menu [[${m[1]}]] needs exactly one choice marked with *`);
        if (opts.length < 2) fail(`menu [[${m[1]}]] needs at least two choices`);
        parts.push({ choices: opts.map((x) => x.replace(/^\*/, '')), ans: opts.findIndex((x) => x.startsWith('*')) });
        last = re.lastIndex;
      }
      lines(q.text.slice(last));
      if (!parts.some((x) => typeof x !== 'string')) fail('text has no [[...|*...]] menu');
      return { ...base, kind: 'inline', parts };
    }
    case 'fill': {
      const bits = q.text.split(/(_{3,})/);
      const parts = [];
      let k = 0;
      for (const b of bits) {
        if (/^_{3,}$/.test(b)) parts.push(k++);
        else b.split('\n').forEach((x, i) => { if (i) parts.push('\n'); if (x) parts.push(x); });
      }
      if (k !== q.answer.length) fail(`text has ${k} blanks (___) but answer lists ${q.answer.length} tiles`);
      const answers = q.answer.map((t) => {
        const i = q.tiles.indexOf(t);
        if (i < 0) fail(`answer tile "${t}" is not in tiles`);
        return i;
      });
      return { ...base, kind: 'fill', parts, tiles: q.tiles, answers };
    }
    case 'classify': {
      const cards = q.cards.map((c) => {
        const b = typeof c.bucket === 'number' ? c.bucket - 1 : q.buckets.indexOf(c.bucket);
        if (!(b >= 0 && b < q.buckets.length)) fail(`card "${c.text}": bucket "${c.bucket}" is not one of ${q.buckets.join(', ')}`);
        return { text: c.text, bucket: b };
      });
      return { ...base, kind: 'classify', buckets: q.buckets, cards };
    }
    case 'order': {
      if (new Set(q.items).size !== q.items.length) fail('items must all be different');
      return { ...base, kind: 'order', items: q.items, show: shuffleNotSame(q.items.length, q.id) };
    }
    case 'hot': {
      if (q.answer > q.sentences.length) fail(`answer ${q.answer}: there are only ${q.sentences.length} sentences (count from 1)`);
      return { ...base, kind: 'hot', sentences: q.sentences, ans: q.answer - 1 };
    }
    case 'numline': {
      if (q.max <= q.min) fail('max must be above min');
      const a = typeof q.answer === 'number' ? { value: q.answer } : q.answer;
      if (a.value < q.min || a.value > q.max) fail(`answer ${a.value} is off the line (${q.min} to ${q.max})`);
      const steps = (a.value - q.min) / q.step;
      if (Math.abs(steps - Math.round(steps)) > 1e-9) fail(`answer ${a.value} is not on a tick (min ${q.min}, step ${q.step})`);
      const mode = q.mode || (typeof q.answer === 'number' ? 'point' : 'ray');
      if (mode === 'ray' && typeof q.answer === 'number') fail('a ray needs answer: { value, closed, dir }');
      return { ...base, kind: 'numline', min: q.min, max: q.max, step: q.step, mode, answer: a };
    }
    case 'plot': {
      if (!q.points && !q.line) fail('plot needs points or line');
      const inGrid = (p) => p[0] >= q.grid.xmin && p[0] <= q.grid.xmax && p[1] >= q.grid.ymin && p[1] <= q.grid.ymax;
      for (const p of q.points || []) if (!inGrid(p)) fail(`point (${p.join(', ')}) is off the grid`);
      return { ...base, kind: 'plot', grid: q.grid, count: q.count || q.points?.length || 2, ...(q.points ? { points: q.points } : {}), ...(q.line ? { line: q.line } : {}) };
    }
    case 'mistake': {
      if (q.wrongLine > q.lines.length) fail(`wrongLine ${q.wrongLine}: there are only ${q.lines.length} lines (count from 1)`);
      return { ...base, kind: 'mistake', ...(q.context ? { context: q.context } : {}), lines: q.lines, wrong: q.wrongLine - 1, reasons: q.reasons, reason: choice(q.reason, q.reasons.length, 'reason') };
    }
    case 'table': {
      if (!q.rows.some((r) => r.some((c) => typeof c !== 'string'))) fail('table needs at least one { answer: … } cell');
      for (const [i, r] of q.rows.entries()) if (r.length !== q.head.length) fail(`row ${i + 1} has ${r.length} cells for ${q.head.length} columns`);
      return { ...base, kind: 'table', head: q.head, rows: q.rows };
    }
    case 'estimate': {
      if (q.answer < q.min || q.answer > q.max) fail(`answer ${q.answer} is outside ${q.min}–${q.max}`);
      // a guess on a slider is never right or wrong: an estimate step is not scored, so it never enters a test
      return { ...base, graded: false, kind: 'estimate', min: q.min, max: q.max, step: q.step, answer: q.answer, close: q.close, ...(q.prefix ? { prefix: q.prefix } : {}), ...(q.suffix ? { suffix: q.suffix } : {}) };
    }
  }
  fail(`unknown type "${q.type}"`);
  return null;
}

/** A fixed shuffle of 0..n-1 (from the question id), never the right order. */
function shuffleNotSame(n, seedText) {
  let x = parseInt(hash(seedText), 16) || 1;
  const out = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; const j = (x >>> 0) % (i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  if (out.every((v, i) => v === i)) out.push(out.shift());
  return out;
}

/** A short stable hash (FNV-1a, hex). */
export function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** A pack is trusted content, but a figure is put on the page as markup: keep scripts and event handlers out. */
export function svgProblems(svg) {
  const out = [];
  if (!/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(svg)) out.push('must be one <svg> element');
  if (/<script|<foreignObject|<iframe|<object|<embed/i.test(svg)) out.push('must not contain script, foreignObject, iframe, object or embed');
  if (/\son[a-z]+\s*=/i.test(svg)) out.push('must not contain event handlers (onclick=…)');
  if (/javascript:/i.test(svg)) out.push('must not contain javascript: links');
  return out;
}
const TAGS = /^(b|i|u|em|strong|sub|sup|br)$/i;
/** Prompts marked html: true may use only a few inline tags. */
export function htmlProblems(s) {
  const out = [];
  for (const m of s.matchAll(/<\/?([a-z0-9]+)([^>]*)>/gi)) {
    if (!TAGS.test(m[1])) out.push(`tag <${m[1]}> is not allowed (use b, i, u, em, strong, sub, sup, br)`);
    else if (m[2].trim() && m[2].trim() !== '/') out.push(`tag <${m[1]}> must not have attributes`);
  }
  return out;
}

/** Problems as lines for a terminal. */
export function formatProblems(list, kind = 'error') {
  return list.map((p) => `  ${kind === 'error' ? '✗' : '!'} ${p.file}${p.where ? ` › ${p.where}` : ''}: ${p.message}`).join('\n');
}
