// Small pieces shared by several screens: the streak/XP HUD, a bottom sheet, the test-day picker.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useApp } from './ctx';
import { streak, weekXp, today, daysBetween } from './store';

export const FLAME = 'M12 2.5c.7 3.4 5 5 5 10a5 5 0 0 1-10 0c0-2.1 1-3.5 2.2-4.4.1 1.8.9 2.9 2 3.3-.8-3.2.1-6.2.8-8.9z';
export const STAR = 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4l-5.3 3 1.2-6-4.5-4.1 6-.7z';

// Streak and weekly-XP badges with a tap-for-tooltip (Home/Learn header).
export function Hud() {
  const { p, sfx } = useApp();
  const [tip, setTip] = useState<{ which: 'streak' | 'xp'; n: number } | null>(null);
  const s = streak(p);
  const xp = weekXp(p);
  const toggle = (which: 'streak' | 'xp') => {
    sfx('tap');
    setTip((t) => (t && t.which === which ? null : { which, n: (t?.n || 0) + 1 }));
  };
  useEffect(() => {
    if (!tip) return;
    const close = (e: Event) => { if (!(e.target as Element).closest?.('.pa-hud')) setTip(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setTip(null); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [tip]);
  // A day counts after a lesson or 3 questions; extra practice on a counted day earns a save (up to 2).
  const saves = p.tutor.saves;
  const savesText = saves ? ` ${saves} streak ${saves === 1 ? 'save' : 'saves'} ready.` : ' Do extra practice on a counted day to earn a streak save.';
  const streakText = s.n === 0
    ? 'Finish a lesson or answer 3 questions today to start a streak!'
    : (s.doneToday ? `${s.n}-day streak. You practiced today!` : `${s.n}-day streak. Practice today to keep it going!`) + savesText;
  return (
    <div className="pa-hud">
      <button type="button" className="pa-hud-btn" onClick={() => toggle('streak')} aria-expanded={tip?.which === 'streak'}>
        <span className="pa-hud-badge streak">
          <svg className={s.n ? 'fx-flicker' : undefined} width="20" height="20" viewBox="0 0 24 24" fill={s.n ? 'var(--accent)' : '#D3C9B9'} stroke={s.n ? 'var(--accent-ink)' : '#9A9386'} strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true"><path d={FLAME} /></svg>
          {s.n}<span className="sr"> day streak</span>
        </span>
      </button>
      <button type="button" className="pa-hud-btn" onClick={() => toggle('xp')} aria-expanded={tip?.which === 'xp'}>
        <span className="pa-hud-badge xp">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--sage)" stroke="var(--primary)" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true"><path d={STAR} /></svg>
          {xp}<span className="sr"> XP this week</span>
        </span>
      </button>
      <span className="sr" role="status">{tip ? (tip.which === 'xp' ? `${xp} XP this week` : streakText) : ''}</span>
      {tip ? (
        <div className={'pa-hud-tip ' + (tip.n % 2 ? 'fx-popA' : 'fx-popB') + (tip.which === 'xp' ? ' at-xp' : ' at-streak')} aria-hidden="true">
          <svg className="caret" width="22" height="10" viewBox="0 0 22 10" aria-hidden="true"><path d="M1 10L11 1L21 10Z" fill="#FFFFFF" /><path d="M1 9L11 1L21 9" fill="none" stroke="#EADFCF" strokeWidth="2" strokeLinejoin="round" /></svg>
          {tip.which === 'xp' ? `${xp} XP this week` : streakText}
        </div>
      ) : null}
    </div>
  );
}

// A bottom sheet over the current screen. Closes on the scrim, the close button or Escape;
// moves focus into the sheet and back to where it was.
export function Sheet({ label, onClose, children, className }: { label: string; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    // first control after the close button, else the sheet itself
    const first = ref.current?.querySelectorAll<HTMLElement>('button, a, input, select, textarea')[1];
    (first || ref.current)?.focus({ preventScroll: true });
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close.current(); return; }
      if (e.key !== 'Tab' || !ref.current) return;
      // keep Tab inside the sheet
      const items = [...ref.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')];
      if (!items.length) return;
      const firstEl = items[0], lastEl = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === firstEl || document.activeElement === ref.current)) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
    };
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('keydown', esc); back?.focus?.({ preventScroll: true }); };
  }, []);
  return (
    <div className="pa-scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={'pa-sheet fx-slideup ' + (className || '')} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
        <button type="button" className="pa-sheet-x" onClick={onClose} aria-label="Close">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        {children}
      </div>
    </div>
  );
}

// Move the focus after the next render, to the first element matching one of the selectors (never leave it on the page body).
// A button that unmounts or becomes disabled when the student acts (a placed tile, an answer in the speed round)
// would otherwise drop the focus to the top of the page.
export function focusSoon(...selectors: string[]) {
  window.requestAnimationFrame(() => {
    for (const sel of selectors) {
      const el = document.querySelector<HTMLElement>(sel);
      if (el && !(el as HTMLButtonElement).disabled) { el.focus({ preventScroll: true }); return; }
    }
  });
}

const MARK_OK = 'M5 12.5l4.5 4.5L19 7.5';
const MARK_NO = 'M6 6l12 12M18 6L6 18';
/** Right or wrong on an answer row, never by color alone: a round icon and a word, which a screen reader reads too. */
export function RowMark({ ok }: { ok: boolean }) {
  return (
    <>
      <span className={'ls-mark ' + (ok ? 'ok' : 'no') + ' fx-pop'} aria-hidden="true">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round"><path d={ok ? MARK_OK : MARK_NO} /></svg>
      </span>
      <span className={'ls-tag ' + (ok ? 'ok' : 'no')}>{ok ? 'Correct' : 'Not correct'}</span>
    </>
  );
}

/** The letter of an answer choice: shown as A-D, read as "Choice A:" so explanations that say "Choice C" make sense. */
export function Letter({ i }: { i: number }) {
  const l = 'ABCD'[i];
  return <span className="ls-letter"><span aria-hidden="true">{l}</span><span className="sr">Choice {l}: </span></span>;
}

// Days left to the student's test day, or null when not set. Negative once it has passed.
export function daysToTest(testDate: string | null) {
  return testDate ? daysBetween(today(), testDate) : null;
}


/** "Oct 28" for a saved day (YYYY-MM-DD). */
export function dayLabelShort(day: string) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
