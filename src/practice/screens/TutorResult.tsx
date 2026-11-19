// What a tutor round found, on the round-complete screen: the unit check's skill rows and the gaps it
// added to the plan, where a placement check starts the student, whether a skill check stuck, and each practiced
// skill's next review day. Complete.tsx shows it under the streak card and takes its title and buttons from here.
import type { ReactNode } from 'react';
import { SUBJECT_NAME, SUBJECTS, LESSONS, WORLDS } from '../curriculum';
import { parseDay, type Finish, type Report, type Progress } from '../store';
import { MASTERY_LABEL, type Mastery } from '../tutor/model';
import { skillRound, skillId, FIX_ID, placementId } from '../tutor/pick';
import type { StopScore } from '../tutor/round';
import './TutorResult.css';

const title = (stop: string) => LESSONS[stop]?.title ?? stop;
const where = (stop: string) => { const l = LESSONS[stop]; return l ? `World ${l.world} · ${WORLDS[l.subject][l.world - 1]?.name ?? ''}` : ''; };
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const dayLabel = (day: string | null) => { if (!day) return ''; const d = parseDay(day); return `${DOW[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}`; };

const TUTOR_KINDS = new Set(['placement', 'skill', 'practice', 'fix']);
export const isTutorKind = (k: string) => TUTOR_KINDS.has(k);

/** Title and subtitle for a tutor round (null: Complete.tsx keeps its own). */
export function tutorTitle(f: Finish, r: Report): { title: string; sub: string; passed: boolean } | null {
  const t = r.tutor;
  if (f.kind === 'placement') return { title: 'Placement done!', sub: `${r.correct} of ${r.total} right. Here is where you start.`, passed: true };
  if (f.kind === 'skill') {
    const ok = !t?.skill?.revisit;
    return { title: ok ? 'You got it!' : 'Let’s give this another look', sub: `${title(t?.skill?.stop || '')}: ${r.correct} of ${r.total} right`, passed: ok };
  }
  if (f.kind === 'practice') return { title: 'Practice done!', sub: `${r.correct} of ${r.total} right across ${t?.practiced?.length || 0} skills`, passed: true };
  if (f.kind === 'fix') return { title: 'Review done!', sub: r.total ? `${r.correct} of ${r.total} similar questions right` : 'Thanks for looking back.', passed: true };
  return null;
}

/** The main button and any extra ones after a round. */
export function tutorActions(f: Finish, r: Report, p: Progress): { href: string; label: string; ghost?: boolean }[] {
  const t = r.tutor, out: { href: string; label: string; ghost?: boolean }[] = [];
  const wrong = r.total - r.correct;
  if (f.kind === 'lesson' && r.passed && !r.sample && LESSONS[f.id] && skillRound(f.id)) {
    out.push({ href: `#play/${skillId(f.id)}`, label: 'Quick skill check' }, { href: '#learn', label: 'Later', ghost: true });
    return out;
  }
  if (f.kind === 'placement' && t?.placement) {
    if (t.placement.start) out.push({ href: `#play/${t.placement.start}`, label: 'Start here' });
    const other = SUBJECTS.find((x) => x !== t.placement!.subject && !p.tutor.placement[x]);
    if (other) out.push({ href: `#play/${placementId(other)}`, label: `Placement check: ${SUBJECT_NAME[other]}`, ghost: true });
    out.push({ href: '#home', label: 'Home', ghost: true });
    return out;
  }
  if ((f.kind === 'check' || f.kind === 'skill') && t?.added.length) out.push({ href: `#play/${t.added[0].stop}`, label: `Go to ${title(t.added[0].stop)}` });
  if ((f.kind === 'check' || f.kind === 'skill' || f.kind === 'practice') && wrong > 0) out.push({ href: `#play/${FIX_ID}`, label: 'Look back at my mistakes', ghost: out.length > 0 });
  // a skill check that was not all right: look back at the misses, then try again with new questions
  if (f.kind === 'skill' && t?.skill && wrong > 0 && !t.skill.revisit) out.push({ href: `#play/${f.id}`, label: 'Try the skill check again', ghost: out.length > 0 });
  if (f.kind === 'skill' || f.kind === 'practice' || f.kind === 'fix') out.push({ href: '#home', label: out.length ? 'Home' : 'Continue', ghost: out.length > 0 });
  if (f.kind === 'check' && out.length) out.push({ href: '#learn', label: 'Back to the map', ghost: true });
  return out;
}

function Chip({ m }: { m: Mastery }) {
  return <span className={'tr-chip tr-' + m}>{MASTERY_LABEL[m]}</span>;
}

function Dots({ s }: { s: StopScore }) {
  return (
    <span className="tr-dots" role="img" aria-label={`${s.right} of ${s.total} right`}>
      {Array.from({ length: s.total }, (_, i) => <span key={i} className={'tr-dot' + (i < s.right ? ' ok' : '')} />)}
    </span>
  );
}

function Card({ h, children, delay = 600 }: { h: string; children: ReactNode; delay?: number }) {
  return <section className="cp-card tr-card fx-fadeup" style={{ animationDelay: delay + 'ms' }}><h2>{h}</h2>{children}</section>;
}

/** The plan rows a round added, with why. */
function Added({ added, why }: { added: { stop: string; from?: string }[]; why: string }) {
  if (!added.length) return null;
  return (
    <div className="tr-added">
      <p className="tr-added-h">Added to your plan</p>
      <ul>
        {added.map((a) => (
          <li key={a.stop}>
            <a href={`#play/${a.stop}`}><b>{title(a.stop)}</b></a>
            <span>{a.from ? `Helps with ${title(a.from)}.` : why}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TutorCard({ f, r, p }: { f: Finish; r: Report; p: Progress }) {
  const t = r.tutor;
  if (!t) return null;
  if (f.kind === 'check' && t.world) {
    const probed = t.probed || [];
    return (
      <Card h="Skill by skill">
        <ul className="tr-rows">
          {t.world.map((s) => <li key={s.stop}><span className="tr-name">{title(s.stop)}</span><Dots s={s} /></li>)}
        </ul>
        {probed.length ? (
          <>
            <p className="tr-sub">We also checked the building blocks under the skills you missed:</p>
            <ul className="tr-rows tr-probed">
              {probed.map((s) => <li key={s.stop}><span className="tr-name">{title(s.stop)}</span><Dots s={s} /></li>)}
            </ul>
          </>
        ) : null}
        {t.added.length ? <Added added={t.added} why="Practice it again." />
          : <p className="tr-note">{r.passed ? 'No gaps found. Nice work!' : 'No gaps found. Practice the levels above, then try again.'}</p>}
      </Card>
    );
  }
  if (f.kind === 'placement' && t.placement) {
    const pl = t.placement;
    const known = pl.known.slice(0, 4), gaps = pl.gaps.slice(0, 4);
    return (
      <Card h={`Your ${SUBJECT_NAME[pl.subject] ?? ''} starting point`}>
        {pl.start ? (
          <a className="tr-start press" href={`#play/${pl.start}`}>
            <span className="tr-start-w">{where(pl.start)}</span>
            <span className="tr-start-t">{title(pl.start)}</span>
          </a>
        ) : <p className="tr-note">You already know a lot here. Start with the unit checks to prove it.</p>}
        {known.length ? <><p className="tr-sub">Looks strong</p><ul className="tr-tags">{known.map((s) => <li key={s} className="ok">{title(s)}</li>)}</ul></> : null}
        {gaps.length ? <><p className="tr-sub">To work on</p><ul className="tr-tags">{gaps.map((s) => <li key={s}>{title(s)}</li>)}</ul></> : null}
        <p className="tr-note">A short check is only a first guess. Your plan changes as you practice.</p>
      </Card>
    );
  }
  if (f.kind === 'skill' && t.skill) {
    const s = t.skill;
    return (
      <Card h={title(s.stop)}>
        <p className="tr-score" role="img" aria-label={`${r.correct} of ${r.total} right`}>
          {f.answers.map((a, k) => <span key={k} className={'tr-dot big' + (a.correct ? ' ok' : '')} />)}
          <b>{r.correct}<small>/{r.total}</small></b>
        </p>
        <p className="tr-move"><Chip m={s.before} /><span aria-hidden="true">→</span><Chip m={s.after} /></p>
        {s.revisit ? <Added added={[{ stop: s.revisit, from: s.revisit === s.stop ? undefined : s.stop }]} why="Play the level again with the hints on." />
          : <p className="tr-note">Next review: <b>{dayLabel(s.due)}</b>. Coming back after a few days helps it last.</p>}
      </Card>
    );
  }
  if (f.kind === 'practice' && t.practiced) {
    return (
      <Card h="Your skills now">
        <ul className="tr-rows">
          {t.practiced.map((s) => (
            <li key={s.stop}><span className="tr-name">{title(s.stop)}</span><span className="tr-right"><Chip m={s.after} /><small>Next: {dayLabel(s.due)}</small></span></li>
          ))}
        </ul>
        <p className="tr-note">Skills you get right come back less often. Skills you miss come back sooner.</p>
      </Card>
    );
  }
  if (f.kind === 'fix') {
    const top = Object.entries(p.tutor.slips).sort(([, a], [, b]) => (b || 0) - (a || 0))[0];
    const TIP: Record<string, string> = {
      misread: 'Your most common mistake is misreading. Slow down on the question, not the math.',
      slip: 'Your most common mistake is a small one. Check each step and put your answer back into the problem.',
      start: 'You most often get stuck at the start. The hints help most there.',
      evidence: 'You most often skip the text. Point to the proof before you pick.',
      guess: 'You guess most often. Try one step at a time before you guess.',
    };
    return top ? <Card h="What we noticed"><p className="tr-note">{TIP[top[0]]}</p></Card> : null;
  }
  return null;
}


/** Streak saves banked: small shields, filled when banked. */
export function Saves({ n, max = 2 }: { n: number; max?: number }) {
  return (
    <span className="tr-saves" role="img" aria-label={`${n} of ${max} streak saves`}>
      {Array.from({ length: max }, (_, i) => (
        <svg key={i} className="tr-shield" viewBox="0 0 20 22" aria-hidden="true">
          <path d="M10 1.5 2.5 4.5v6c0 4.6 3.2 8.4 7.5 10 4.3-1.6 7.5-5.4 7.5-10v-6z" fill={i < n ? 'var(--sage)' : '#F2ECE2'} stroke={i < n ? '#4F7A66' : '#D3C9B9'} strokeWidth="1.6" strokeLinejoin="round" />
          {i < n ? <path d="M6.5 11l2.4 2.4 4.6-5" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /> : null}
        </svg>
      ))}
    </span>
  );
}
