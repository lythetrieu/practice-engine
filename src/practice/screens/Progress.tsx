// Progress tab: one scrolling screen that repeats nothing Home shows: Score → Your week → Skills → Practice → Awards;
// each card or row opens one sheet (at most 2 taps from here). Full tests are the finished tests in progress (p.tests,
// exam/results.ts); the score is the pack's estimate (pack.yaml scoring), with its range, and a goal from the pack's
// benchmarks is only ever "above", "within reach" or "below", never pass/fail.
import { useState } from 'react';
import './Progress.css';
import { useApp } from '../ctx';
import { Sheet } from '../ui';
import { BadgeArt } from '../Art';
import { BADGES } from '../artdata';
import { dueMistakes, skills, today, addDays, parseDay, last7, practicedOn, type Progress } from '../store';
import { SUBJECTS, SUBJECT_NAME, WORLDS, LESSONS, type Subject } from '../curriculum';
import { mastery, MASTERY_LABEL, dueSkills, traitsBetween } from '../tutor/model';
import { placementId } from '../tutor/pick';
import { dayLabel } from './TutorResult';
import './TutorResult.css';
import { pickStop } from '../recommend';
import { config, sectionShort, skillName } from '../../pack';
import { compare } from '../../pack/scoring';
import { estimateOfTest, type TestRec } from '../exam/results';

type SheetName = { name: 'tests' | 'skills' | 'practice' | 'awards' | 'target' } | { name: 'area'; area: string } | null;
const S = config.scoring;

// Weak / OK / strong from the share right, with its uncertainty (Wilson interval, z = 1.0):
// weak when even the hopeful end is under 70%, strong when even the cautious end is over 85%, too few under 6.
type Label = 'weak' | 'ok' | 'strong' | 'few';
function label(c: number, n: number): Label {
  if (n < 6) return 'few';
  const z = 1, p = c / n, d = 1 + (z * z) / n, mid = (p + (z * z) / (2 * n)) / d, half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return mid + half < 0.7 ? 'weak' : mid - half > 0.85 ? 'strong' : 'ok';
}
const LABEL_TEXT: Record<Label, string> = { weak: 'Weak spot', ok: 'OK', strong: 'Strong', few: 'Not enough yet' };

const shortDay = (key: string) => parseDay(key).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const pct = (c: number, n: number) => (n ? Math.round((100 * c) / n) : 0);
const minutes = (sec: number) => { const m = Math.round(sec / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} m` : `${m} min`; };
const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
const testRight = (t: TestRec) => t.sections.reduce((a, s) => a + s.right, 0);
const testTotal = (t: TestRec) => t.sections.reduce((a, s) => a + s.total, 0);
const headlineOf = (t: TestRec) => { const e = estimateOfTest(t); return e?.composite ?? (e && e.sections.length === 1 ? e.sections[0] : null); };

/** Right and missed per skill over every full test; ranked by questions lost per test (the weakness measure). */
function areas(tests: TestRec[]) {
  const sum: Record<string, { n: number; c: number; sec: string }> = {};
  for (const t of tests) for (const it of t.items) {
    if (!it.skill) continue;
    const x = (sum[it.skill] ||= { n: 0, c: 0, sec: it.sec });
    x.n += 1; if (it.c) x.c += 1;
  }
  const per = Math.max(1, tests.length);
  return Object.entries(sum)
    .map(([skill, v]) => ({ name: skill, title: skillName(skill), ...v, missed: v.n - v.c, lost: (v.n - v.c) / per, label: label(v.c, v.n) }))
    .sort((a, b) => b.lost - a.lost || a.title.localeCompare(b.title));
}

/** The lessons that teach a skill, with the best try at each (practice is counted apart from tests). */
function lessonsOfSkill(skill: string, lessons: Record<string, { best: number; of: number }>) {
  return Object.values(LESSONS).filter((l) => l.skills.includes(skill)).map((l) => ({ id: l.id, title: l.title, best: lessons[l.id] }));
}

function Spark({ values, label: aria, fromZero = true }: { values: number[]; label: string; fromZero?: boolean }) {
  // Counts start at 0; scores use their own range, so a 30-point change is visible on a 200-800 scale.
  const lo = fromZero ? 0 : Math.min(...values) - 10, hi = Math.max(lo + 1, ...values), w = 104, h = 26, step = values.length > 1 ? w / (values.length - 1) : 0;
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - 2 - ((v - lo) / (hi - lo)) * (h - 4)).toFixed(1)}`).join(' ');
  return (
    <svg className="pg-spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={aria}>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const delta = (now: number, before: number, unit: (v: number) => string) =>
  now === before ? 'same as the week before' : `${now > before ? '▲' : '▼'} ${unit(Math.abs(now - before))} vs the week before`;

function Bar({ c, n, max }: { c: number; n: number; max: number }) {
  return (
    <span className="pg-bar" style={{ width: `${Math.max(8, (n / max) * 100)}%` }} aria-hidden="true">
      <span className="ok" style={{ flexGrow: c }} />
      <span className="miss" style={{ flexGrow: n - c }} />
    </span>
  );
}

const Tag = ({ l }: { l: Label }) => <span className={'pg-tag ' + l}>{LABEL_TEXT[l]}</span>;

// The tutor's skills (merged into the Skills card). The card lists at most FOCUS_N to work on: due for
// review first, then the least known. Every skill, world by world, is in the Skills sheet (SkillsByWorld).
const FOCUS_N = 5;
const LESSON_BY_ID = new Map(SUBJECTS.flatMap((s) => WORLDS[s]).flatMap((w) => w.lessons.map((l) => [l.id, l.title] as const)));
function focusSkills(p: Progress, t: string) {
  return Object.entries(p.tutor.skills)
    .filter(([id, r]) => LESSON_BY_ID.has(id) && r.n > 0 && ((r.due && r.due <= t) || mastery(r) === 'gap' || mastery(r) === 'learning'))
    .sort(([, a], [, b]) => Number(!!b.due && b.due <= t) - Number(!!a.due && a.due <= t) || a.k - b.k)
    .slice(0, FOCUS_N)
    .map(([id, r]) => ({ id, title: LESSON_BY_ID.get(id)!, m: mastery(r) }));
}

function SkillFocus() {
  const { p, sfx } = useApp();
  const t = today();
  const dueN = dueSkills(p.tutor, t).length;
  const rows = focusSkills(p, t);
  const unplaced = SUBJECTS.filter((s) => !p.tutor.placement[s]);
  return (
    <>
      {dueN > 0 ? (
        <a className="pa-btn green pg-ys-review" href="#play/practice" onClick={() => sfx('tap')}>Review {dueN} {dueN === 1 ? 'skill' : 'skills'} due</a>
      ) : null}
      {rows.length ? (
        <>
          <h3>To work on</h3>
          <ul className="pg-ys-list">
            {rows.map((r) => (
              <li key={r.id}>
                <span className="pg-ys-name">{r.title}</span>
                <span className={'tr-chip tr-' + r.m}>{MASTERY_LABEL[r.m]}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {unplaced.map((s) => (
        <a key={s} className="pg-ys-place" href={'#play/' + placementId(s)} onClick={() => sfx('tap')}>Take the {SUBJECT_NAME[s]} placement check</a>
      ))}
    </>
  );
}

// The Skills sheet: each world with its levels done, then every skill in it with how well the tutor thinks the student
// knows it and when it comes back. Worlds with no skill on record show only their row.
function SkillsByWorld({ s }: { s: Subject }) {
  const { p } = useApp();
  const t = today();
  return (
    <div>
      <h3>{SUBJECT_NAME[s]}</h3>
      {skills(p, s).map(({ world, done, open: o }) => {
        const any = world.lessons.some((l) => p.tutor.skills[l.id]?.n);
        return (
          <div key={world.n} className="pg-ys-world">
            <div className="pg-ys-whead">
              <span>{world.name}</span>
              <span className="pg-acount">{o ? `${done} of ${world.lessons.length} levels` : 'Locked'}</span>
              <span className="pg-wbar" aria-hidden="true"><span style={{ width: `${(done / world.lessons.length) * 100}%` }} /></span>
            </div>
            {any ? (
              <ul className="pg-ys-list">
                {world.lessons.map((l) => {
                  const r = p.tutor.skills[l.id];
                  const m = mastery(r);
                  return (
                    <li key={l.id}>
                      <span className="pg-ys-name">{l.title}
                        {r?.due ? <small>{r.due <= t ? 'Due today' : `Next review: ${dayLabel(r.due)}`}</small> : null}
                      </span>
                      <span className={'tr-chip tr-' + m}>{MASTERY_LABEL[m]}</span>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// "Your week": the last 7 days (store.ts last7, the same week as Home and the Practice card), in plain sentences from
// the saved data. Effort is framed as good; a line with no data is skipped.
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
function YourWeek() {
  const { p } = useApp();
  const t = today();
  const days = last7(t), from = days[0];
  const practiced = days.filter((d) => practicedOn(p, d)).length;
  const qs = days.reduce((n, d) => n + (p.qDays[d] || 0), 0);
  const levels = Object.values(p.lessons).filter((l) => l.at >= from && l.at <= t).length;
  const hints = days.reduce((n, d) => n + (p.tutor.hints[d] || 0), 0);
  const tr = traitsBetween(p.tutor, from, t);
  const lines: React.ReactNode[] = [];
  if (practiced > 0) lines.push(`In the last 7 days you practiced on ${plural(practiced, 'day')} and answered ${plural(qs, 'question')}.`);
  if (levels > 0) lines.push(`You finished ${levels} new ${levels === 1 ? 'level' : 'levels'}.`);
  if (hints > 0) lines.push(`You opened ${plural(hints, 'hint')}. Asking for help is part of learning.`);
  else if (tr.b > 0) lines.push(`You got ${plural(tr.b, 'question')} right right after a miss.`);
  const chips = [
    { k: 'w', n: tr.w, name: 'Curiosity', icon: <><circle cx="11" cy="11" r="6" /><path d="M16 16l5 5" /></> },
    { k: 'b', n: tr.b, name: 'Bouncing back', icon: <path d="M4 18l5-9 4 5 3-4 4 8" /> },
    { k: 's', n: tr.s, name: 'Sticking with it', icon: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /> },
  ].filter((c) => c.n > 0);
  return (
    <section className="pg-card" aria-labelledby="pg-wk-h">
      <h2 id="pg-wk-h">Your week</h2>
      {lines.length ? (
        <ul className="pg-wk-list">{lines.slice(0, 4).map((l, i) => <li key={i}>{l}</li>)}</ul>
      ) : <p className="pg-muted">Nothing in the last 7 days. Do one level to get started.</p>}
      <h3>Your strengths</h3>
      {chips.length ? (
        <ul className="pg-wk-chips">
          {chips.map((c) => (
            <li key={c.k} className="pg-wk-chip">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">{c.icon}</svg>
              <span>{c.name}</span><b>+{c.n}</b>
            </li>
          ))}
        </ul>
      ) : <p className="pg-muted">Strengths show up as you practice: open Why? after a right answer, keep going after a miss.</p>}
    </section>
  );
}

export default function ProgressScreen() {
  const { p, me, update } = useApp();
  const [sheet, setSheet] = useState<SheetName>(null);
  const t = today();

  const all = p.tests;
  const scored = all.filter((x) => headlineOf(x));
  const last = all[all.length - 1];
  const lastH = last ? headlineOf(last) : null;
  const prevScored = scored.length > 1 ? scored[scored.length - 2] : null;
  const prevH = prevScored ? headlineOf(prevScored) : null;
  const lastEst = last ? estimateOfTest(last) : null;
  const ar = areas(all);
  const maxN = Math.max(1, ...ar.map((a) => a.n));
  const strong = ar.filter((a) => a.label === 'strong').map((a) => a.title);
  const target = S.benchmarks.find((b) => b.label === p.target) || null;
  const vs = lastH && target ? compare(lastH, target.score) : null;
  const untimed = (x: TestRec) => config.fullTest.timeOptions.find((o) => o.id === x.mode)?.factor === null;
  const usedSec = last ? last.sections.reduce((a, s) => a + s.seconds, 0) : 0;
  const perQ = last && !untimed(last) && testTotal(last) ? usedSec / testTotal(last) : null;

  // practice: the last 8 weeks, this week = the last 7 days
  const weeks = Array.from({ length: 8 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(t, -(7 * (7 - w)) - (6 - d))));
  const sumDays = (map: Record<string, number>, days: string[]) => days.reduce((n, d) => n + (map[d] || 0), 0);
  const thisWeek = weeks[7];
  const weekQ = sumDays(p.qDays, thisWeek), weekSec = sumDays(p.secDays, thisWeek);
  const weekDays = thisWeek.filter((d) => practicedOn(p, d)).length;
  const due = dueMistakes(p, t).length;
  const earned = BADGES.filter((b) => p.badges[b.id]);
  const name = me.name ? `${me.name} · ` : '';
  const open = (s: SheetName) => setSheet(s);
  const vsText = (c: 'above' | 'near' | 'below') => (c === 'above' ? 'Above it' : c === 'near' ? 'Within reach' : 'Below it');
  const vsTone = (c: 'above' | 'near' | 'below') => (c === 'above' ? 'up' : c === 'near' ? 'mid' : 'down');

  return (
    <div className="pa-body pg-main" role="region" aria-labelledby="pg-title">
      <header className="pg-head">
        <h1 id="pg-title">Progress</h1>
        <p className="pg-sub">{name}{all.length} full test{all.length === 1 ? '' : 's'} · {Object.keys(p.lessons).length} level{Object.keys(p.lessons).length === 1 ? '' : 's'} done</p>
      </header>

      {/* ---- score ---- */}
      <section className="pg-card pg-score" aria-labelledby="pg-score-h">
        <div className="pg-rowa">
          <h2 id="pg-score-h">{S.label}</h2>
          {S.benchmarks.length ? <button type="button" className="pg-chip" onClick={() => open({ name: 'target' })}>{target ? `Goal: ${target.label}` : 'Pick a goal'}</button> : null}
        </div>
        {last && lastH ? (
          <>
            <div className="pg-phi">
              <div>
                <p className="pg-big">≈{lastH.score} <small>{S.margin ? `±${S.margin}` : 'estimate'}</small></p>
                <p className="pg-range">{S.margin ? `${lastH.lo}–${lastH.hi} · ` : ''}{shortDay(last.at)}</p>
              </div>
              <div className="pg-trend">
                {scored.length > 1 ? <Spark values={scored.slice(-8).map((r) => headlineOf(r)!.score)} label="Estimate across your full tests" fromZero={false} /> : null}
                {prevH && prevScored ? <p className="pg-change">{lastH.score - prevH.score >= 0 ? '+' : ''}{lastH.score - prevH.score} since {shortDay(prevScored.at)}{Math.abs(lastH.score - prevH.score) <= lastH.hi - lastH.score ? ', within the range' : ''}</p> : null}
              </div>
            </div>
            {target && vs ? (
              <button type="button" className={'pg-vs ' + vsTone(vs)} onClick={() => open({ name: 'target' })}>
                <span>{target.label}: {target.score}</span>
                <b>{vsText(vs)}</b>
              </button>
            ) : null}
            <dl className="pg-secs">
              {last.sections.map((x) => {
                const e = lastEst?.sections.find((y) => y.id === x.id);
                return <div key={x.id}><dt>{sectionShort(x.id)}</dt><dd>{x.right} of {x.total} right{e ? ` · ${e.score}` : ''}</dd></div>;
              })}
            </dl>
            <p className="pg-fine">{S.disclaimer}{untimed(last) ? ' This run had no clock, so test-day timing may be harder.' : ''}</p>
          </>
        ) : last ? (
          <>
            <p className="pg-mid">Full test · {shortDay(last.at)}</p>
            <dl className="pg-secs">{last.sections.map((x) => <div key={x.id}><dt>{sectionShort(x.id)}</dt><dd>{x.right} of {x.total} right</dd></div>)}</dl>
          </>
        ) : (
          <div className="pg-empty">
            <p>No full test yet. One full test gives an estimate and shows which skills cost the most questions.</p>
            <a className="pa-btn green" href="#test">Take a full test</a>
          </div>
        )}
        {perQ && last ? <p className="pg-muted">Time on the last test: {minutes(usedSec)} · {mmss(perQ)} per question</p> : null}
        {all.length ? <button type="button" className="pg-more" onClick={() => open({ name: 'tests' })}>All {all.length} test{all.length === 1 ? '' : 's'}</button> : null}
      </section>

      <YourWeek />

      {/* ---- skills ---- */}
      <section className="pg-card" aria-labelledby="pg-skills-h">
        <h2 id="pg-skills-h">Skills</h2>
        {ar.length ? (
          <>
            <p className="pg-muted">From your full tests. First: the skills that cost the most questions per test. Tap one to practice it.</p>
            <ul className="pg-areas">
              {ar.slice(0, 4).map((a) => (
                <li key={a.name}>
                  <button type="button" className="pg-arow" onClick={() => open({ name: 'area', area: a.name })}>
                    <span className="pg-aname">{a.title}{SUBJECTS.length > 1 ? <i>{sectionShort(a.sec)}</i> : null}</span>
                    <span className="pg-acount">{pct(a.c, a.n)}% right · <b>~{a.lost.toFixed(1)}</b> lost per test <Tag l={a.label} /></span>
                    <Bar c={a.c} n={a.n} max={maxN} />
                  </button>
                </li>
              ))}
            </ul>
            {strong.length ? <p className="pg-muted">Strong: {strong.join(', ')}.</p> : null}
          </>
        ) : null}
        <SkillFocus />
        {!ar.length ? <p className="pg-muted">A full test adds which skills cost the most questions.</p> : null}
        <button type="button" className="pg-more" onClick={() => open({ name: 'skills' })}>All skills</button>
      </section>

      {/* ---- practice ---- */}
      <section className="pg-card" aria-labelledby="pg-prac-h">
        <div className="pg-rowa"><h2 id="pg-prac-h">Practice</h2><span className="pg-muted">Last 7 days</span></div>
        <div className="pg-tiles">
          <div className="pg-tile"><b>{weekQ}</b><span>questions</span>
            <em className="pg-avg">{weekDays ? `≈${Math.round(weekQ / weekDays)} a day` : 'no practice yet'}</em>
            <em className="pg-delta">{delta(weekQ, sumDays(p.qDays, weeks[6]), (v) => String(v))}</em>
          </div>
          <div className="pg-tile"><b>{minutes(weekSec)}</b><span>practiced</span>
            <em className="pg-avg">{weekDays ? `≈${Math.round(weekSec / 60 / weekDays)} min a day` : 'no practice yet'}</em>
            <em className="pg-delta">{delta(Math.round(weekSec / 60), Math.round(sumDays(p.secDays, weeks[6]) / 60), (v) => `${v} min`)}</em>
          </div>
          <div className="pg-tile"><b>{weekDays} of 7</b><span>days practiced</span>
            <span className="pg-days7" aria-hidden="true">{thisWeek.map((d) => (
              <span key={d}><i className={(p.qDays[d] || 0) > 0 ? 'on' : ''} />{parseDay(d).toLocaleDateString('en-US', { weekday: 'narrow' })}</span>
            ))}</span>
            <em className="pg-delta">Week before: {weeks[6].filter((d) => practicedOn(p, d)).length} of 7</em>
          </div>
        </div>
        <p className="pg-muted">{due ? <><b>{due}</b> missed question{due === 1 ? '' : 's'} to redo. <a href="#review">Redo</a> · </> : null}{p.fixed} fixed so far</p>
        <button type="button" className="pg-more" onClick={() => open({ name: 'practice' })}>Last 8 weeks</button>
      </section>

      {/* ---- awards ---- */}
      <section className="pg-card" aria-labelledby="pg-aw-h">
        <h2 id="pg-aw-h">Awards</h2>
        <div className="pg-badges-row">
          {(earned.length ? earned : BADGES.slice(0, 4)).slice(0, 6).map((b) => <BadgeArt key={b.id} id={b.id} earned={!!p.badges[b.id]} size={52} />)}
        </div>
        <p className="pg-muted"><b>{earned.length}</b> of {BADGES.length} earned · best run {p.bestRun} right in a row</p>
        <button type="button" className="pg-more" onClick={() => open({ name: 'awards' })}>All awards</button>
      </section>

      {/* ---- sheets ---- */}
      {sheet?.name === 'area' ? (() => {
        const a = ar.find((x) => x.name === sheet.area);
        const rows = lessonsOfSkill(sheet.area, p.lessons);
        const stop = pickStop(p, sheet.area);
        return (
          <Sheet label={skillName(sheet.area)} onClose={() => setSheet(null)}>
            <h3>{skillName(sheet.area)}</h3>
            {a ? <p className="pg-muted">Full tests: {a.c} of {a.n} right ({pct(a.c, a.n)}%) · ~{a.lost.toFixed(1)} lost per test <Tag l={a.label} /></p> : null}
            {rows.length ? (
              <ul className="pg-skills">
                {rows.map((r) => (
                  <li key={r.id}>
                    <span className="pg-aname">{r.title}</span>
                    <span className="pg-acount">{r.best ? `Practice: ${pct(r.best.best, r.best.of)}% best` : 'Not practiced yet'}</span>
                    {stop === r.id || (!stop && r === rows[0]) ? <a className="pg-go" href={`#play/${r.id}`} aria-label={`Practice ${r.title}`}>Practice</a> : null}
                  </li>
                ))}
              </ul>
            ) : <p className="pg-muted">No lesson teaches this skill yet.</p>}
            <p className="pg-fine">Tests and practice are counted apart: practice uses each level’s best try.</p>
          </Sheet>
        );
      })() : null}

      {sheet?.name === 'target' ? (
        <Sheet label="Goal" onClose={() => setSheet(null)}>
          <p className="pg-muted">Pick a score to aim for. {lastH ? 'Your latest estimate sits where the marker is.' : ''}</p>
          <ul className="pg-ladder">
            {[...S.benchmarks].sort((x, y) => y.score - x.score).map((b, i, list) => {
              const here = lastH && lastH.score >= b.score && (i === 0 || lastH.score < list[i - 1].score);
              return (
                <li key={b.label}>
                  {here ? <span className="pg-marker">≈{lastH!.score} you</span> : null}
                  <button type="button" className={'pg-school' + (p.target === b.label ? ' on' : '')} aria-pressed={p.target === b.label}
                    onClick={() => { update((q) => ({ ...q, target: b.label })); setSheet(null); }}>
                    <span>{b.label}</span><b>{b.score}</b>
                  </button>
                </li>
              );
            })}
          </ul>
          {p.target ? <button type="button" className="pg-more" onClick={() => { update((q) => ({ ...q, target: null })); setSheet(null); }}>Clear goal</button> : null}
        </Sheet>
      ) : null}

      {sheet?.name === 'tests' ? (
        <Sheet label="Full tests" onClose={() => setSheet(null)}>
          <p className="pg-muted">Newest first. {S.disclaimer}</p>
          <ul className="pg-list">
            {[...all].reverse().map((r) => {
              const h = headlineOf(r);
              return (
                <li key={r.id}>
                  <a href={'#exam/result/' + encodeURIComponent(r.id)}><b>{h ? `≈${h.score}` : `${testRight(r)} of ${testTotal(r)} right`}</b> · {shortDay(r.at)} · {minutes(r.sections.reduce((a, x) => a + x.seconds, 0))}</a>
                  <span>{r.sections.map((x) => `${sectionShort(x.id)} ${x.right}/${x.total} (${pct(x.right, x.total)}%)`).join(' · ')}</span>
                </li>
              );
            })}
          </ul>
        </Sheet>
      ) : null}

      {sheet?.name === 'skills' ? (
        <Sheet label="Skills" onClose={() => setSheet(null)}>
          {ar.length ? (
            <>
              <h3>From your full tests</h3>
              <ul className="pg-areas">
                {ar.map((a) => (
                  <li key={a.name}>
                    <button type="button" className="pg-arow" onClick={() => open({ name: 'area', area: a.name })}>
                      <span className="pg-aname">{a.title}</span>
                      <span className="pg-acount">{a.c} of {a.n} right · {pct(a.c, a.n)}% <Tag l={a.label} /></span>
                      <Bar c={a.c} n={a.n} max={maxN} />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <p className="pg-muted">Skills you get right come back less often. Skills you miss come back sooner.</p>
          {[p.subject, ...SUBJECTS.filter((x) => x !== p.subject)].filter((x) => SUBJECTS.includes(x)).map((x) => <SkillsByWorld key={x} s={x} />)}
        </Sheet>
      ) : null}

      {sheet?.name === 'practice' ? (
        <Sheet label="Practice" onClose={() => setSheet(null)}>
          <ul className="pg-list">
            {[...weeks].reverse().map((w) => (
              <li key={w[0]}>
                <span><b>Week of {shortDay(w[0])}</b></span>
                <span>{sumDays(p.qDays, w)} questions · {minutes(sumDays(p.secDays, w))} · {w.filter((d) => (p.qDays[d] || 0) > 0).length} days</span>
              </li>
            ))}
          </ul>
        </Sheet>
      ) : null}

      {sheet?.name === 'awards' ? (
        <Sheet label="Awards" onClose={() => setSheet(null)}>
          <ul className="pg-agrid">
            {BADGES.map((b) => (
              <li key={b.id} className={p.badges[b.id] ? 'got' : 'todo'}>
                <BadgeArt id={b.id} earned={!!p.badges[b.id]} size={64} />
                <b>{b.name}</b>
                <span>{p.badges[b.id] ? `Earned ${shortDay(p.badges[b.id])}` : b.how}</span>
              </li>
            ))}
          </ul>
        </Sheet>
      ) : null}
    </div>
  );
}
