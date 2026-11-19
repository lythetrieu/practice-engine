// Tests for the pack validator (src/pack/load.mjs). Run with `npm test` (node --test tests/).
// The two shipped packs must load clean; tests/fixtures/broken-pack must be rejected for each of its mistakes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatProblems, htmlProblems, loadPack, numberOf, packDir, svgProblems } from '../src/pack/load.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (name) => loadPack(packDir(ROOT, name));
const fixture = (name) => path.join(ROOT, 'tests', 'fixtures', name);

// ---------------------------------------------------------------- the shipped packs

test('packs/shsat-sample loads with no errors', () => {
  const r = load('shsat-sample');
  assert.equal(r.ok, true, formatProblems(r.errors));
  assert.equal(r.errors.length, 0);
  assert.equal(r.stats.questions, 20);
  assert.equal(r.stats.passages, 2);
  assert.equal(r.stats.worlds, 5);
  assert.equal(r.stats.lessons, 10);
  assert.deepEqual(r.pack.counts, { ela: 10, math: 10 });
  // the two lessons with teaching steps
  assert.deepEqual(Object.keys(r.bank.teach).sort(), ['ela-1-1', 'math-1-1']);
  assert.equal(r.pack.config.fullTest.sections.length, 2);
});

test('packs/demo-isee loads with no errors', () => {
  const r = load('demo-isee');
  assert.equal(r.ok, true, formatProblems(r.errors));
  assert.equal(r.errors.length, 0);
  assert.equal(r.stats.questions, 10);
  assert.equal(r.stats.passages, 1);
  assert.equal(r.stats.worlds, 4);
  assert.deepEqual(r.pack.config.formats, ['mc']);
  assert.deepEqual(r.pack.counts, { verbal: 3, quant: 3, reading: 2, math: 2 });
});

test('the same pack compiles to the same bank version every time', () => {
  assert.equal(load('demo-isee').bank.version, load('demo-isee').bank.version);
});

test('the small valid fixture loads', () => {
  const r = loadPack(fixture('valid-pack'));
  assert.equal(r.ok, true, formatProblems(r.errors));
  assert.equal(r.stats.questions, 3);
  assert.equal(r.stats.lessons, 2);
});

test('a folder with no pack.yaml is reported, not thrown', () => {
  const r = loadPack(path.join(ROOT, 'tests', 'fixtures'));
  assert.equal(r.ok, false);
  assert.match(r.errors[0].message, /no pack\.yaml/);
});

// ---------------------------------------------------------------- the broken pack

const broken = loadPack(fixture('broken-pack'));
const messages = broken.errors.map((e) => e.message);
/** The error whose message matches, or a failure that lists what was reported. */
const find = (re) => {
  const hit = broken.errors.find((e) => re.test(e.message));
  assert.ok(hit, `no error matching ${re}. Got:\n${formatProblems(broken.errors)}`);
  return hit;
};

test('broken pack is rejected', () => {
  assert.equal(broken.ok, false);
  assert.ok(broken.errors.length >= 10, `expected 10 or more problems, got ${broken.errors.length}`);
  assert.equal(broken.pack, undefined);
});

test('broken pack: a question type that is not in formats', () => {
  const e = find(/type "typed" is not in this pack's formats/);
  assert.equal(e.where, 'b-format');
  assert.match(e.message, /\(mc, inline, fill\)/);
});

test('broken pack: an mc answer letter out of range', () => {
  const e = find(/answer "D" is not one of the 3 choices \(A, B, C\)/);
  assert.equal(e.where, 'b-answer-range');
});

test('broken pack: a whyWrong line at the right answer', () => {
  const e = find(/whyWrong: the line for the right answer must be null/);
  assert.equal(e.where, 'b-whywrong');
});

test('broken pack: an unknown skill', () => {
  const e = find(/skill "m\.nope" is not in skills\.yaml/);
  assert.equal(e.where, 'b-skill');
});

test('broken pack: a duplicate question id', () => {
  const e = find(/question id "b-dup" is also used in/);
  assert.equal(e.where, 'b-dup');
});

test('broken pack: an inline menu without exactly one *', () => {
  const e = find(/needs exactly one choice marked with \*/);
  assert.equal(e.where, 'b-inline');
  assert.match(e.message, /\[\[run\|runs\|running\]\]/);
});

test('broken pack: a fill whose blanks and answers do not match', () => {
  const e = find(/text has 2 blanks \(___\) but answer lists 1 tiles/);
  assert.equal(e.where, 'b-fill');
});

test('broken pack: a missing passage', () => {
  const e = find(/passage "no-such-passage" not found in passages\//);
  assert.equal(e.where, 'b-passage');
});

test('broken pack: a full test that asks for more questions than the pack has', () => {
  const e = find(/the full test asks 50 math questions but the pack has only \d+/);
  assert.equal(e.file, 'pack.yaml');
  assert.match(e.where, /fullTest\.sections\.math\.questions/);
});

test('broken pack: a logo SVG with an onload handler', () => {
  const e = find(/must not contain event handlers/);
  assert.equal(e.file, 'brand/logo.svg');
});

test('broken pack: a requires cycle in skills.yaml', () => {
  const hits = broken.errors.filter((e) => /requires form a cycle/.test(e.message));
  assert.deepEqual(hits.map((e) => e.where).sort(), ['m.a', 'm.b']);
  assert.ok(hits.every((e) => e.file === 'skills.yaml'));
});

test('broken pack: every problem names a file and prints on one line', () => {
  for (const e of broken.errors) assert.ok(e.file, `no file on: ${e.message}`);
  const lines = formatProblems(broken.errors).split('\n');
  assert.equal(lines.length, broken.errors.length);
  assert.ok(lines.every((l) => l.startsWith('  ✗ ')));
  assert.ok(messages.length > 0);
});

// ---------------------------------------------------------------- single-mistake variants of the valid fixture

/** Copies the valid fixture to a temp folder, lets `edit(dir)` change it, loads it, and cleans up. */
function mutate(edit) {
  const dir = mkdtempSync(path.join(tmpdir(), 'pack-test-'));
  try {
    cpSync(fixture('valid-pack'), dir, { recursive: true });
    edit(dir);
    return loadPack(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const rewrite = (dir, file, fn) => writeFileSync(path.join(dir, file), fn(readFileSync(path.join(dir, file), 'utf8')));

test('an unknown key in pack.yaml is rejected', () => {
  const r = mutate((d) => rewrite(d, 'pack.yaml', (s) => s + '\nsurprise: true\n'));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /Unrecognized key/.test(e.message)), formatProblems(r.errors));
});

test('per-section timing needs minutes on every section', () => {
  const r = mutate((d) => rewrite(d, 'pack.yaml', (s) => s.replace('timing: total\n  minutes: 5', 'timing: per-section')));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /per-section timing needs minutes/.test(e.message)), formatProblems(r.errors));
});

test('a scored test section needs a score scale', () => {
  const r = mutate((d) => rewrite(d, 'pack.yaml', (s) => s.replace('    math: { type: linear, min: 100, max: 200 }', '    other: { type: linear, min: 100, max: 200 }')));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /no score scale for the test section "math"/.test(e.message)), formatProblems(r.errors));
});

test('a blueprint cannot add up to more than the section size', () => {
  const r = mutate((d) => rewrite(d, 'pack.yaml', (s) => s.replace('{ section: math, questions: 2 }', '{ section: math, questions: 2, skills: { m.add: 2, m.times: 1 } }')));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /the blueprint adds up to 3, more than the section's 2 questions/.test(e.message)), formatProblems(r.errors));
});

test('a world holds at most 5 lessons', () => {
  const r = mutate((d) => rewrite(d, 'curriculum.yaml', (s) => s + [3, 4, 5, 6].map((n) => `      - { title: Extra ${n}, skills: [m.add] }\n`).join('')));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /at most 5 lessons/.test(e.message)), formatProblems(r.errors));
});

test('a lesson skill must belong to the world\'s section', () => {
  const r = mutate((d) => {
    rewrite(d, 'pack.yaml', (s) => s.replace('sections:\n  - { id: math, name: Mathematics, short: Math }', 'sections:\n  - { id: math, name: Mathematics, short: Math }\n  - { id: ela, name: English }'));
    rewrite(d, 'curriculum.yaml', (s) => s.replace('section: math', 'section: ela'));
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /belongs to section "math", not "ela"/.test(e.message)), formatProblems(r.errors));
});

test('html: true allows only a few inline tags', () => {
  const r = mutate((d) => rewrite(d, 'questions/math.yaml', (s) => s.replace('prompt: What is 10 + 15?', 'html: true\n  prompt: "What is <script>10</script> + <b onclick=\\"x()\\">15</b>?"')));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /tag <script> is not allowed/.test(e.message)), formatProblems(r.errors));
  assert.ok(r.errors.some((e) => /tag <b> must not have attributes/.test(e.message)), formatProblems(r.errors));
});

test('a teach file that does not exist is reported', () => {
  const r = mutate((d) => rewrite(d, 'curriculum.yaml', (s) => s.replace('{ title: Adding, skills: [m.add] }', '{ title: Adding, skills: [m.add], teach: teach/missing.yaml }')));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /teach file not found: teach\/missing\.yaml/.test(e.message)), formatProblems(r.errors));
});

test('YAML gotcha: an unquoted comma inside { ... } splits the value and gives "Unrecognized key"', () => {
  const r = mutate((d) => {
    rewrite(d, 'pack.yaml', (s) => s.replace('formats: [mc, typed, inline]', 'formats: [mc, typed, inline, classify]'));
    rewrite(d, 'questions/math.yaml', (s) => s + `
- id: t-sort-1
  skill: m.add
  type: classify
  prompt: Sort the sentences.
  buckets: [Opening phrase, List]
  cards:
    - { text: After lunch, we left., bucket: Opening phrase }
    - { text: "We bought milk, eggs, and bread.", bucket: List }
  explanation: A test.
`);
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /Unrecognized key: "we left\."/.test(e.message)), formatProblems(r.errors));
});

test('an unquoted # color is a YAML comment, so the color is missing', () => {
  const r = mutate((d) => rewrite(d, 'pack.yaml', (s) => s.replace('primary: "#1E4D3A"', 'primary: #1E4D3A')));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.where === 'brand.colors.primary'), formatProblems(r.errors));
});

// ---------------------------------------------------------------- helpers

test('numberOf reads whole numbers, decimals, fractions and mixed numbers', () => {
  assert.equal(numberOf(52), 52);
  assert.equal(numberOf('-2.5'), -2.5);
  assert.equal(numberOf('3/4'), 0.75);
  assert.equal(numberOf('1 1/2'), 1.5);
  assert.equal(numberOf('-1 1/2'), -1.5);
  assert.ok(Number.isNaN(numberOf('abc')));
  assert.ok(Number.isNaN(numberOf('1/0')));
});

test('svgProblems rejects scripts and event handlers, accepts a plain svg', () => {
  assert.deepEqual(svgProblems('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'), []);
  assert.ok(svgProblems('<svg><script>x()</script></svg>').length > 0);
  assert.ok(svgProblems('<svg><rect onclick="x()"/></svg>').length > 0);
  assert.ok(svgProblems('<svg><a href="javascript:x()"/></svg>').length > 0);
  assert.ok(svgProblems('<div></div>').length > 0);
});

test('htmlProblems allows b i u em strong sub sup br only', () => {
  assert.deepEqual(htmlProblems('x<sup>2</sup> + <b>y</b><br>and <em>z</em>'), []);
  assert.ok(htmlProblems('<a href="x">link</a>').length > 0);
  assert.ok(htmlProblems('<b class="big">x</b>').length > 0);
});
