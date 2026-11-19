// Review tab: "Mistakes to redo" card, then one row per world ("skill")
// with levels finished out of 5. Tap a row for a sheet with the next level to practice.
import { useEffect, useState } from 'react';
import { needParts, ALL_PARTS } from '../appBank';
import './Review.css';
import { useApp } from '../ctx';
import { Sheet } from '../ui';
import { skills, lessonState, hasQuestions, dueMistakes, laterMistakes, resumable, REVIEW_ROUND, type Mistake } from '../store';
import { LESSONS, SUBJECT_NAME, SUBJECTS, parseStopId, type Subject, type Lesson } from '../curriculum';
import { rawBank } from '../levels/index';
import { sectionShort } from '../../pack';

const ARROW = 'M5 12h14M13 6l6 6-6 6';
const LOCK = 'M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2zM8 11V7a4 4 0 0 1 8 0v4';
const CHECK = 'M8 12.5l3 3 5-6';
const MAX_ROWS = 3;          // mistake rows shown on the card (the rest are summed up)
const MIN_PER_QUESTION = 1.25; // the pace used here: 4 questions = about 5 min

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Mistakes grouped by the lesson they came from, biggest group first.
function mistakeGroups(list: Mistake[]) {
  const by = new Map<string, number>();
  for (const m of list) by.set(m.lessonId, (by.get(m.lessonId) || 0) + 1);
  return [...by.entries()]
    .map(([id, count]) => {
      const lesson: Lesson | undefined = LESSONS[id];
      const at = parseStopId(id);
      const check = at && at.rest === 'check' ? at : null;
      const test = id.startsWith('test-');   // missed in a full test (exam/results.ts addTest)
      const sec = lesson?.subject ?? at?.subject ?? (test ? rawBank().items.find((x) => list.some((m) => m.lessonId === id && m.qid === x.id))?.section : undefined);
      const subject = sec ? sectionShort(sec) : '';
      const name = lesson ? lesson.title : check ? `Unit check · World ${check.world}` : test ? 'Full practice test' : 'Mixed questions';
      return { id, subject, name, count };
    })
    .sort((a, b) => b.count - a.count);
}

// "Revising & editing: grammar and punctuation" -> group "Revising & editing", name "Grammar and punctuation".
function splitUnit(unit: string) {
  const i = unit.indexOf(': ');
  return i < 0 ? { group: '', name: unit } : { group: unit.slice(0, i), name: cap(unit.slice(i + 2)) };
}

const levelText = (done: number, open: boolean, of: number) => (!open ? 'Locked' : done === 0 ? 'Not started' : `Level ${done} of ${of}`);

function Bar({ done, of, anim, delay, step, big }: { done: number; of: number; anim: string; delay: number; step: number; big?: boolean }) {
  return (
    <span className={'rv-bar' + (big ? ' big' : '')} aria-hidden="true">
      {Array.from({ length: of }, (_, k) => (
        <span key={k} className="rv-seg">
          {k < done ? <span className={'rv-fill ' + anim} style={{ animationDelay: `${delay + k * step}ms` }} /> : null}
        </span>
      ))}
    </span>
  );
}

export default function Review() {
  const { p, sfx, update } = useApp();
  // missed questions come from every part of the bank (appBank.ts); ask for the ones not here yet
  useEffect(() => { void needParts(ALL_PARTS); }, []);
  const [subject, setSubject] = useState<Subject>(p.subject);
  const [open, setOpen] = useState<number | null>(null);

  // Due today vs coming back later: a missed question leaves Review only after it is answered right on
  // two different days (store.ts finish()).
  const due = dueMistakes(p);
  const n = Math.min(due.length, REVIEW_ROUND);   // one round redoes at most REVIEW_ROUND (store.ts)
  const later = laterMistakes(p).length;
  const reviewOpen = resumable(p)?.kind === 'review';
  const groups = mistakeGroups(due);
  const shown = groups.slice(0, MAX_ROWS);
  const more = groups.length - shown.length;
  const minutes = Math.max(1, Math.round(n * MIN_PER_QUESTION));

  const rows = skills(p, subject).map((s, i, all) => {
    const { group, name } = splitUnit(s.world.unit);
    return { ...s, i, group, name, showGroup: !!group && (i === 0 || splitUnit(all[i - 1].world.unit).group !== group) };
  });
  const sel = open !== null ? rows[open] : null;

  const pick = (s: Subject) => {
    if (s === subject) return;
    sfx('tap');
    setSubject(s);
    setOpen(null);
  };

  return (
    <div className="pa-body rv-main">
      <div className="rv-head">
        <div className="rv-titlerow">
          <h1 className="rv-h1">Review</h1>
          {p.fixed > 0 ? (
            <p className="rv-fixed">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
              You fixed {p.fixed}
            </p>
          ) : null}
        </div>
        {n > 0 ? <p className="rv-sub">Missed questions come back until you get them right on two different days.</p> : null}
      </div>

      {p.mistakes.length > 0 ? (
        <section className="rv-look fx-fadeup" aria-labelledby="rv-look-h">
          <h2 id="rv-look-h">Look back at your mistakes</h2>
          <p>Pick what tripped you up, then try a similar question.</p>
          <a href="#play/fix" className="pa-btn green press rv-look-btn" onClick={() => sfx('tap')}>
            Look back
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ARROW} /></svg>
          </a>
        </section>
      ) : null}

      {n > 0 ? (
        <section className="rv-card fx-fadeup" aria-labelledby="rv-mistakes">
          <div className="rv-card-top">
            <div className="rv-card-title">
              <span className="rv-icon" aria-hidden="true">
                <span className="rv-spin">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 12a8.5 8.5 0 1 0 2.8-6.3" /><path d="M3.5 4v5h5" /></svg>
                </span>
              </span>
              <h2 id="rv-mistakes">Mistakes to redo</h2>
            </div>
            <p className="rv-time">about {minutes} min</p>
          </div>
          <ul className="rv-mlist">
            {shown.map((g, i) => (
              <li key={g.id} className="rv-mrow fx-fadeup" style={{ animationDelay: `${300 + i * 70}ms` }}>
                <span className="rv-pill">{g.subject}</span>
                <span className="rv-mname">{g.name}</span>
                <span className="rv-count fx-pop" style={{ animationDelay: `${420 + i * 70}ms` }}>
                  <span aria-hidden="true">×{g.count}</span>
                  <span className="sr">, {g.count} {plural(g.count, 'question', 'questions')}</span>
                </span>
              </li>
            ))}
            {more > 0 ? <li className="rv-mrow rv-more"><span>and {more} more {plural(more, 'skill', 'skills')}</span></li> : null}
            {later > 0 ? <li className="rv-mrow rv-more"><span>{later} more {plural(later, 'comes', 'come')} back on a later day</span></li> : null}
          </ul>
          <div className="rv-redo-wrap fx-pulse">
            <a href="#play/review" className="rv-redo press on-dark" onClick={() => sfx('tap')}>
              {reviewOpen ? 'Resume your review' : `Redo ${n} ${plural(n, 'question', 'questions')}`}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ARROW} /></svg>
            </a>
          </div>
        </section>
      ) : (
        <section className="rv-empty fx-fadeup" aria-labelledby="rv-mistakes">
          <span className="rv-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d={CHECK} /></svg>
          </span>
          <div className="rv-empty-text">
            <h2 id="rv-mistakes">{later > 0 ? 'Nothing to redo today.' : 'No mistakes to redo.'}</h2>
            <p>{later > 0
              ? `${later} missed ${plural(later, 'question comes', 'questions come')} back on a later day. Spacing out practice helps you remember.`
              : 'Missed questions come back here until you get them right.'}</p>
          </div>
        </section>
      )}

      <section aria-labelledby="rv-skills" className="rv-skills">
        <div className="rv-skills-top">
          <h2 id="rv-skills" className="rv-h2">Skills</h2>
          <div className="rv-toggle" role="group" aria-label="Subject">
            {SUBJECTS.map((s) => (
              <button key={s} type="button" aria-pressed={subject === s} className={subject === s ? 'on' : ''} onClick={() => pick(s)}>{SUBJECT_NAME[s]}</button>
            ))}
          </div>
        </div>
        <ul className="rv-list">
          {rows.map((r) => {
            const locked = !r.open;
            return (
              <li key={subject + r.i} className={'rv-li fx-fadeup' + (locked ? ' locked' : '')} style={{ animationDelay: `${120 + r.i * 70}ms` }}>
                {r.showGroup ? <p className="rv-group">{r.group}</p> : null}
                <button type="button" className={'rv-row' + (open === r.i ? ' on' : '') + (locked ? ' locked' : '') + (r.showGroup ? ' grouped' : '')}
                  aria-haspopup="dialog" onClick={() => { sfx('tap'); setOpen(r.i); }}>
                  <span className="rv-line">
                    <span className="rv-name">{r.name}</span>
                    <span className="rv-status">
                      {locked ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={LOCK} /></svg> : null}
                      {levelText(r.done, r.open, r.world.lessons.length)}
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5C625D" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
                    </span>
                  </span>
                  <Bar done={r.done} of={r.world.lessons.length} anim="fx-fill" delay={200 + r.i * 70} step={60} />
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {sel ? <SkillSheet row={sel} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function SkillSheet({ row, onClose }: { row: ReturnType<typeof skills>[number] & { name: string }; onClose: () => void }) {
  const { p, sfx } = useApp();
  const w = row.world;
  const target = row.next ?? w.lessons[w.lessons.length - 1];
  const st = lessonState(p, target);
  const playable = st === 'current' || (st === 'done' && hasQuestions(target.id));
  const nextLabel = row.done === 0 ? 'Start with' : row.next ? 'Next up' : `All ${w.lessons.length} levels done`;
  const btn = st === 'current' ? 'Practice' : playable ? 'Practice again' : st === 'locked' ? 'Locked' : 'Coming soon';
  const note = !row.open ? `Pass the World ${w.n - 1} unit check to open this world.`
    : st === 'soon' ? 'Questions for this lesson are coming soon.' : '';
  return (
    <Sheet label={`${w.unit}, World ${w.n}`} onClose={onClose} className="rv-sheet">
      <span className="rv-handle" aria-hidden="true" />
      <p className="rv-eyebrow">World {w.n} · {w.name}</p>
      <h2 className="rv-st">{w.unit}</h2>
      <div className="rv-sbar">
        <Bar done={row.done} of={w.lessons.length} anim="fx-fill" delay={220} step={70} big />
        <p className="rv-sstatus" style={row.open && row.done > 0 ? undefined : { color: 'var(--muted)' }}>{levelText(row.done, row.open, w.lessons.length)}</p>
      </div>
      <div className="rv-next">
        <span className="rv-flag" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1D2320" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 21V4" /><path d="M6 4.5h11l-2.5 4 2.5 4H6" /></svg>
        </span>
        <p>
          <span className="rv-next-label">{nextLabel}<span className="sr">:</span></span>
          <span className="rv-next-text">Level {target.level} · {target.title}</span>
        </p>
      </div>
      {note ? <p className="rv-note">{note}</p> : null}
      {playable ? (
        <a href={'#play/' + target.id} className="pa-btn green press rv-practice" aria-label={`${btn} Level ${target.level} · ${target.title}`} onClick={() => sfx('tap')}>
          {btn}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ARROW} /></svg>
        </a>
      ) : (
        <button type="button" className="pa-btn rv-practice" aria-disabled="true">{btn}</button>
      )}
    </Sheet>
  );
}
