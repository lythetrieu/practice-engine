// Big moments: a short full-screen scene, about 2 seconds, before the round's results. Our own
// drawings in the brand's colors (deep green, sage, coral, amber, cream) with the mascot (Mascot.tsx); only CSS transforms and
// opacity, no library and no image files, so it adds a few KB and nothing to load. One moment per round, the biggest:
// a world finished, a starting point found, a skill mastered, a new streak day. Tap to skip; with motion off (Settings
// or the OS) there is no scene at all.
import { useEffect, useRef, type CSSProperties } from 'react';
import { useApp } from '../ctx';
import { FLAME, STAR } from '../ui';
import { LESSONS, WORLDS, type Subject } from '../curriculum';
import { CHECK_RE } from '../tutor/pick';
import type { Finish, Report } from '../store';
import { addDays, parseDay, today } from '../store';
import { MascotBody } from '../Mascot';
import './Celebrate.css';

export type Moment =
  | { kind: 'world'; n: number; name: string; next: string | null }
  | { kind: 'start'; world: number; name: string; skill: string }
  | { kind: 'mastered'; skill: string }
  | { kind: 'streak'; from: number; to: number };

const STOP = /^(math|ela)-(\d+)-(\d+)$/;

/** The one big moment of a finished round, or null. */
export function momentOf(f: Finish, r: Report, passedBefore: boolean): Moment | null {
  if (r.sample) return null;
  const m = f.kind === 'check' ? CHECK_RE.exec(f.id) : null;
  if (m && r.passed && !passedBefore) {
    const s = m[1] as Subject, n = +m[2];
    const w = WORLDS[s][n - 1], nx = WORLDS[s][n];
    if (w) return { kind: 'world', n, name: w.name, next: nx ? `World ${n + 1} · ${nx.name}` : null };
  }
  const pl = r.tutor?.placement;
  if (f.kind === 'placement' && pl?.start) {
    const sm = STOP.exec(pl.start);
    const w = sm ? WORLDS[sm[1] as Subject][+sm[2] - 1] : null;
    if (sm && w) return { kind: 'start', world: +sm[2], name: w.name, skill: LESSONS[pl.start]?.title || '' };
  }
  const sk = r.tutor?.skill;
  if (sk && sk.after === 'mastered' && sk.before !== 'mastered') return { kind: 'mastered', skill: LESSONS[sk.stop]?.title || 'This skill' };
  if (r.extended && r.streakAfter > 0) return { kind: 'streak', from: r.streakBefore, to: r.streakAfter };
  return null;
}

const HOLD = 2300;   // ms on screen before the results

export function Celebrate({ m, onDone }: { m: Moment; onDone: () => void }) {
  const { sfx, buzz } = useApp();
  const done = useRef(false);
  const end = () => { if (!done.current) { done.current = true; onDone(); } };
  useEffect(() => {
    const a = window.setTimeout(() => { sfx('combo'); buzz(20); }, 420);
    const b = window.setTimeout(end, HOLD);
    return () => { window.clearTimeout(a); window.clearTimeout(b); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className={'cb cb-' + m.kind} role="dialog" aria-modal="true" aria-label={said(m)} onClick={end}
      onKeyDown={(e) => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') end(); }} tabIndex={-1}
      ref={(el) => el?.focus({ preventScroll: true })}>
      <div className="cb-rays" aria-hidden="true" />
      <Bits />
      <div className="cb-stage" aria-hidden="true">{art(m)}</div>
      <p className="cb-title">{title(m)}</p>
      <p className="cb-sub">{sub(m)}</p>
      <span className="cb-skip">Tap to continue</span>
    </div>
  );
}

const said = (m: Moment) => `${title(m)} ${sub(m)}`;
function title(m: Moment) {
  switch (m.kind) {
    case 'world': return `World ${m.n} complete!`;
    case 'start': return 'Found your starting point';
    case 'mastered': return 'Skill mastered!';
    case 'streak': return `${m.to}-day streak!`;
  }
}
function sub(m: Moment) {
  switch (m.kind) {
    case 'world': return m.next ? `${m.name} is done. Next up: ${m.next}.` : `${m.name} is done.`;
    case 'start': return `World ${m.world} · ${m.name}${m.skill ? ` · ${m.skill}` : ''}`;
    case 'mastered': return m.skill;
    case 'streak': return m.to === 1 ? 'Day one. Come back tomorrow to keep it going.' : 'Come back tomorrow to keep it going.';
  }
}

/** Little brand-colored pieces that fly out from the middle (stars, leaves, dots). */
function Bits() {
  const colors = ['var(--accent)', 'var(--reward)', 'var(--sage)', '#FFFFFF', 'var(--primary)'];
  return (
    <div className="cb-bits" aria-hidden="true">
      {Array.from({ length: 14 }, (_, i) => {
        const a = (i / 14) * Math.PI * 2 + (i % 2 ? 0.2 : -0.1), d = 120 + (i % 3) * 46;
        const style = { '--x': `${Math.round(Math.cos(a) * d)}px`, '--y': `${Math.round(Math.sin(a) * d * 0.8)}px`, '--r': `${(i * 67) % 360}deg`, animationDelay: `${380 + (i % 4) * 40}ms` } as CSSProperties;
        return i % 3 === 0
          ? <svg key={i} className="cb-bit" style={style} width="16" height="16" viewBox="0 0 24 24"><path d={STAR} fill={colors[i % colors.length]} /></svg>
          : <span key={i} className={'cb-bit ' + (i % 3 === 1 ? 'leaf' : 'dot')} style={{ ...style, background: colors[i % colors.length] }} />;
      })}
    </div>
  );
}

function art(m: Moment) {
  switch (m.kind) {
    case 'streak': {
      const t = today();
      const days = [0, 1, 2].map((k) => parseDay(addDays(t, k)).toLocaleDateString('en-US', { weekday: 'short' }));
      return (
        <>
          <div className="cb-flame">
            <svg width="120" height="120" viewBox="0 0 24 24"><path d={FLAME} fill="var(--accent)" stroke="var(--accent-ink)" strokeWidth=".9" strokeLinejoin="round" />
              <path d="M12 9.5c.4 2 2.6 2.9 2.6 5.3a2.6 2.6 0 0 1-5.2 0c0-1.1.5-1.9 1.2-2.4.1.9.5 1.5 1 1.7-.4-1.6.1-3.2.4-4.6z" fill="#F6C66B" /></svg>
          </div>
          <div className="cb-roll"><span className="cb-from">{m.from}</span><span className="cb-to">{m.to}</span></div>
          <ol className="cb-days">
            {days.map((d, k) => <li key={d} className={k === 0 ? 'on' : ''} style={{ animationDelay: `${900 + k * 120}ms` }}><span>{k === 0 ? '✓' : ''}</span>{k === 0 ? 'Today' : d}</li>)}
          </ol>
        </>
      );
    }
    case 'world':
      return (
        <>
          <svg className="cb-crest" width="132" height="150" viewBox="0 0 132 150">
            <path d="M66 6l54 18v42c0 38-24 64-54 78C36 130 12 104 12 66V24z" fill="#FBF7F0" stroke="var(--reward)" strokeWidth="6" />
            <path d="M66 22l40 13v31c0 28-17 47-40 58-23-11-40-30-40-58V35z" fill="var(--primary)" />
            <text x="66" y="92" textAnchor="middle" fontSize="48" fontWeight="800" fill="#FBF7F0" fontFamily="Georgia, serif">{m.n}</text>
          </svg>
          <div className="cb-stars">{[0, 1, 2].map((k) => <svg key={k} width="34" height="34" viewBox="0 0 24 24" style={{ animationDelay: `${700 + k * 150}ms` }}><path d={STAR} fill="var(--reward)" stroke="#8A5A0B" strokeWidth="1.2" strokeLinejoin="round" /></svg>)}</div>
          <span className="cb-pip"><MascotBody size={86} wings /></span>
        </>
      );
    case 'start':
      return (
        <>
          <svg className="cb-path" width="220" height="110" viewBox="0 0 220 110">
            <path d="M10 92C60 92 50 30 110 30S170 92 210 70" fill="none" stroke="#E2D9CB" strokeWidth="14" strokeLinecap="round" />
            <path className="cb-path-run" d="M10 92C60 92 50 30 110 30S170 92 210 70" fill="none" stroke="var(--sage)" strokeWidth="5" strokeLinecap="round" strokeDasharray="6 10" />
            {[[10, 92], [110, 30], [210, 70]].map(([x, y], k) => <circle key={k} cx={x} cy={y} r={k === 1 ? 13 : 9} fill={k === 1 ? 'var(--primary)' : '#FBF7F0'} stroke="var(--primary)" strokeWidth="3" />)}
          </svg>
          <svg className="cb-pin" width="44" height="56" viewBox="0 0 44 56"><path d="M22 54S4 34 4 21a18 18 0 0 1 36 0c0 13-18 33-18 33z" fill="var(--accent)" stroke="var(--accent-ink)" strokeWidth="2.5" /><circle cx="22" cy="21" r="7" fill="#FBF7F0" /></svg>
          <span className="cb-pip sm"><MascotBody size={64} /></span>
        </>
      );
    case 'mastered':
      return (
        <>
          <svg className="cb-medal" width="132" height="132" viewBox="0 0 132 132">
            <circle cx="66" cy="66" r="58" fill="var(--primary)" />
            <circle cx="66" cy="66" r="46" fill="none" stroke="var(--reward)" strokeWidth="6" className="cb-ring" strokeDasharray="290" />
            <path d={STAR} transform="translate(36 36) scale(2.5)" fill="var(--reward)" />
          </svg>
          <span className="cb-pip"><MascotBody size={76} wings /></span>
        </>
      );
  }
}
