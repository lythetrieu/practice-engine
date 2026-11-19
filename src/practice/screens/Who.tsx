// "Who's practicing?": on a device where a parent is signed in, each child picks their
// own profile with one tap, no password (family.ts). PracticeApp shows it in place of the screen, without
// the tab bar: when the app opens (never in the middle of a lesson) and from Me > Switch.
// Nicknames are typed by the parent: they are rendered as text only.
import { useEffect, useRef, type CSSProperties } from 'react';
import './Who.css';
import { useApp } from '../ctx';
import { KID_COLORS, initialOf, type Kid } from '../family';

export default function Who({ kids, current, onPick, onGuest }: { kids: Kid[]; current: string | null; onPick: (k: Kid) => void; onGuest: () => void }) {
  const { sfx } = useApp();
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => { first.current?.focus({ preventScroll: true }); }, []);
  return (
    <div className={'pa-body wh-main wh-n' + Math.min(kids.length, 3)}>
      {/* a named group, so a screen reader landing on the first child (focused on show) also reads the
          question and the line under it */}
      <div className="wh-col" role="group" aria-labelledby="wh-h" aria-describedby="wh-sub">
        <img className="wh-logo fx-pop" src="/favicon.svg" width="56" height="56" alt="" />
        <h1 id="wh-h" className="wh-h fx-fadeup" style={{ animationDelay: '60ms' }}>Who&rsquo;s practicing?</h1>
        <p id="wh-sub" className="wh-sub fx-fadeup" style={{ animationDelay: '100ms' }}>Each of your children keeps their own progress on this device.</p>
        <ul className="wh-kids" role="list" aria-label="Your children">
          {kids.map((k, i) => {
            const c = KID_COLORS[i % KID_COLORS.length];
            const now = k.id === current;
            return (
              <li key={k.id} className="fx-fadeup" style={{ animationDelay: `${160 + i * 70}ms` }}>
                <button ref={i === 0 ? first : undefined} type="button" className={'wh-kid' + (now ? ' now' : '')} onClick={() => { sfx('tap'); onPick(k); }}>
                  <span className="wh-av" aria-hidden="true" style={{ background: c.bg, color: c.ink, '--edge': c.edge } as CSSProperties}>{initialOf(k.nickname)}</span>
                  <span className="wh-t">
                    <span className="wh-name">{k.nickname}</span>
                    {k.grade ? <span className="wh-grade">Grade {k.grade}</span> : null}
                  </span>
                  {now ? <span className="wh-now">Now<span className="sr">, practicing</span></span> : null}
                  <svg className="wh-go" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" className="wh-guest fx-fadeup" style={{ animationDelay: `${200 + kids.length * 70}ms` }} onClick={() => { sfx('tap'); onGuest(); }}>
          I&rsquo;m the parent, just looking
        </button>
      </div>
    </div>
  );
}
