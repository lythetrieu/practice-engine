// Me: who you are and how your week is going (not a page of badges). Top to bottom: profile, this week
// with the test-day countdown, skills by mastery, a parent's reports for each child, then a compact row of badges
// (the full collection opens in a sheet). Settings starts with Account: who is signed in, how passwords work, sign
// out. Driven by the saved progress (store.ts).
import { useMemo, useState } from 'react';
import './Me.css';
import { useApp } from '../ctx';
import { BadgeArt, BADGE_BY_ID } from '../Art';
import { BADGES } from '../artdata';
import { Sheet, FLAME, STAR } from '../ui';
import { TestDaySheet } from './HomeGrade';   // grade-aware: picks the grade and that grade's test days
import { ReportSheet } from '../report';
import { streak, badgeProgress, reset, parseDay, SAMPLE_MODE, SAMPLE_SOON, TEST_DAYS, last7, practicedOn, daysBetween, today, type Progress } from '../store';
import { mastery } from '../tutor/model';
import { leaveAccount, WHO_KEY } from '../../lib/client/profiles';
import { LESSONS } from '../curriculum';
import { kidColor, initialOf } from '../family';
import { useOnline } from '../offline';
import { InstallRow, IosInstallSheet } from '../install';
import { config } from '../../pack';
import { hasPlan, limitsActive } from '../limits';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayShort = (k: string) => { const d = parseDay(k); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; };
const dayLong = (k: string) => `${dayShort(k)}, ${parseDay(k).getFullYear()}`;
const num = (n: number) => n.toLocaleString('en-US');

// Soft disc behind earned badges in the grid.
const DISC: Record<string, { bg: string; line: string }> = {
  milestone: { bg: '#FBF0CF', line: '#F6DB8E' },
  streak: { bg: '#FBE3DA', line: '#F6B9A6' },
  world: { bg: 'var(--ok-tint)', line: '#B9CFC2' },
  skill: { bg: 'color-mix(in srgb, var(--primary) 7%, #FFFFFF)', line: 'var(--sage-tint)' },
};

// "6 of 7 days": the unit shown after the counts (singular when the goal is 1).
const UNIT: Record<string, [string, string]> = {
  'first-steps': ['lesson', 'lessons'],
  'first-flame': ['day', 'days'], 'week-warrior': ['day', 'days'], 'steady-studier': ['day', 'days'],
  'park-explorer': ['level', 'levels'], 'grammar-guardian': ['level', 'levels'], 'world-traveler': ['world', 'worlds'],
  'bookworm': ['reading set', 'reading sets'], 'hot-streak': ['answer in a row', 'answers in a row'],
  'perfect-lesson': ['perfect lesson', 'perfect lessons'], 'comeback-kid': ['mistake fixed', 'mistakes fixed'],
  'test-day-ready': ['tool', 'tools'], 'xp-1000': ['XP', 'XP'], 'full-length': ['test', 'tests'],
};
// "3 more tools to try!": [singular, plural, ending].
const MORE: Record<string, [string, string, string]> = {
  'first-flame': ['day', 'days', 'to go!'], 'week-warrior': ['day', 'days', 'to go!'], 'steady-studier': ['day', 'days', 'to go!'],
  'park-explorer': ['level', 'levels', 'to go!'], 'grammar-guardian': ['level', 'levels', 'to go!'], 'world-traveler': ['world', 'worlds', 'to go!'],
  'bookworm': ['set', 'sets', 'to go!'], 'hot-streak': ['answer', 'answers', 'to go!'], 'comeback-kid': ['', '', 'to go!'],
  'test-day-ready': ['tool', 'tools', 'to try!'], 'xp-1000': ['XP', 'XP', 'to go!'],
};

interface Row {
  id: string; name: string; how: string; cat: string; earned: boolean;
  date: string; dateLong: string; pct: number; short: string; long: string; cheer: string; more: string | null;
  now: number; max: number;
}

function buildRows(p: Progress): Row[] {
  const prog = badgeProgress(p);
  return BADGES.map((b) => {
    const g = prog[b.id] ?? { now: 0, max: 1 };
    const got = p.badges[b.id];
    const earned = !!got;
    const unit = UNIT[b.id] ?? ['', ''];
    const best = g.note ? /(\d+) of (\d+)/.exec(g.note) : null;     // "Best: 2 of 3" (Perfect Lesson)
    const bestN = best ? +best[1] : 0, bestOf = best ? +best[2] : 0;
    const pct = earned ? 100
      : best && bestOf ? Math.round((bestN / bestOf) * 1000) / 10
      : g.max ? Math.min(100, Math.round((g.now / g.max) * 1000) / 10) : 0;
    const left = Math.max(0, g.max - g.now);
    const m = MORE[b.id];
    const phrase = (tail: boolean) => m ? `${left} more${(left === 1 ? m[0] : m[1]) ? ' ' + (left === 1 ? m[0] : m[1]) : ''}${tail ? ' ' + m[2] : '!'}` : '';
    const short = b.id === 'xp-1000' ? `${num(g.now)}/${num(g.max)}` : best ? `Best ${bestN}/${bestOf}` : `${g.now}/${g.max}`;
    const long = best ? `Best so far: ${bestN} of ${bestOf}` : `${num(g.now)} of ${num(g.max)} ${g.max === 1 ? unit[0] : unit[1]}`.trim();
    let cheer: string;
    let more: string | null = null;
    if (SAMPLE_SOON.has(b.id)) {
      cheer = b.id === 'full-length' ? 'Take a full-length practice test on the Full test tab.' : 'Questions for this badge are coming soon.';
    } else if (b.id === 'first-steps') cheer = 'Finish a lesson to earn it!';
    else if (b.id === 'full-length') cheer = 'Finish a full-length practice test to earn it!';
    else if (b.id === 'perfect-lesson') {
      cheer = best && bestOf - bestN === 1 ? 'Just 1 away from perfect!' : 'Get every question right in one lesson!';
      if (best && bestOf - bestN === 1) more = 'Just 1 away!';
    } else {
      cheer = left > 0 ? phrase(true) : 'So close!';
      if (g.now > 0 && left > 0) more = phrase(false);
    }
    return {
      id: b.id, name: b.name, how: b.how, cat: b.category, earned,
      date: got ? dayShort(got) : '', dateLong: got ? dayLong(got) : '',
      pct, short, long, cheer, more, now: g.now, max: g.max,
    };
  });
}

function Lock({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <circle cx="12" cy="12" r="11" fill="#FFFFFF" stroke="#D3C9B9" strokeWidth="2" />
      <rect x="7.5" y="11" width="9" height="7" rx="1.5" fill="none" stroke="#6F746F" strokeWidth="2" />
      <path d="M9.5 11V9a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="#6F746F" strokeWidth="2" />
    </svg>
  );
}

const SPARKS: [x: number, y: number, size: number, delay: number][] = [[14, 30, 18, 0], [166, 16, 14, 300], [180, 94, 18, 600], [156, 168, 14, 900], [22, 160, 16, 1200], [2, 92, 12, 450]];
const RAYS = 'M100 100L87.2 2.8L112.8 2.8ZM100 100L137.5 9.5L159.7 22.3ZM100 100L177.7 40.3L190.5 62.5ZM100 100L197.2 87.2L197.2 112.8ZM100 100L190.5 137.5L177.7 159.7ZM100 100L159.7 177.7L137.5 190.5ZM100 100L112.8 197.2L87.2 197.2ZM100 100L62.5 190.5L40.3 177.7ZM100 100L22.3 159.7L9.5 137.5ZM100 100L2.8 112.8L2.8 87.2ZM100 100L9.5 62.5L22.3 40.3ZM100 100L40.3 22.3L62.5 9.5Z';

// The badge detail sheet: big badge (rays + twinkles when earned), how to earn it, date or progress.
function BadgeSheet({ r, onClose }: { r: Row; onClose: () => void }) {
  const pal = BADGE_BY_ID[r.id].palette;
  return (
    <Sheet label={r.name} onClose={onClose} className="me-sheet">
      <span className="me-handle" aria-hidden="true" />
      <div className="me-stage">
        {r.earned ? (
          <>
            <span className="me-rays" aria-hidden="true">
              <svg width="200" height="200" viewBox="0 0 200 200">
                <circle cx="100" cy="100" r="76" fill={pal.light} opacity=".35" />
                <path d={RAYS} fill={pal.light} opacity=".5" />
              </svg>
            </span>
            {SPARKS.map(([x, y, size, delay], i) => (
              <span key={i} className="me-twinkle" aria-hidden="true" style={{ left: x, top: y, width: size, height: size, animationDelay: `${delay}ms` }}>
                <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block' }}>
                  <path d="M12 1.5l2.6 7.9 7.9 2.6-7.9 2.6-2.6 7.9-2.6-7.9L1.5 12l7.9-2.6z" fill={i % 2 ? pal.edge : pal.main} />
                </svg>
              </span>
            ))}
          </>
        ) : null}
        <span className="me-bigart fx-pop" style={{ animationDelay: '140ms' }}>
          <BadgeArt id={r.id} earned={r.earned} size={140} />
          {!r.earned ? <Lock size={36} className="me-biglock" /> : null}
        </span>
      </div>
      <h2 className="me-sheet-name">{r.name}</h2>
      <p className="me-sheet-how">{r.how}</p>
      {r.earned ? (
        <p className="me-earned-pill">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
          Earned on {r.dateLong}
        </p>
      ) : (
        <div className="me-prog">
          <p className="me-prog-top"><span>Progress</span><span>{r.long}</span></p>
          <span className="me-bar" aria-hidden="true"><span className="me-fill" style={{ width: `${r.pct}%`, animationDelay: '260ms' }} /></span>
          <p className="me-cheer">{r.cheer}</p>
        </div>
      )}
      <button type="button" className="me-cta press" onClick={onClose}>{r.earned ? 'Nice!' : 'Keep going'}</button>
    </Sheet>
  );
}

function Switch({ name, sub, on, onToggle }: { name: string; sub?: string; on: boolean; onToggle: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="me-row" onClick={onToggle}>
      <span className="me-row-text"><span className="me-row-name">{name}</span>{sub ? <span className="me-row-sub">{sub}</span> : null}</span>
      <span className="me-row-val">{on ? 'On' : 'Off'}</span>
      <span className={'me-switch' + (on ? ' on' : '')} aria-hidden="true"><span className="me-knob" /></span>
    </button>
  );
}

const CHEVRON = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5C625D" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>;

/** Signs out like /account/ does (the same endpoints, then the browser goes back to its own profile), and goes to the account page. */
async function signOut(role: 'student' | 'parent') {
  try {
    await fetch(role === 'student' ? '/api/student/logout/' : '/api/auth/signout/', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', credentials: 'same-origin',
    });
  } catch { /* offline: the cookie stays, the account page says so */ }
  try { leaveAccount(false); localStorage.removeItem(WHO_KEY); } catch { /* storage blocked */ }
  location.href = '/account/';
}

/** The paid plan (pack.yaml `plan`) for whoever is practicing: "On · until Nov 16, 2027" or "Not on". Never a price
    or a buy button: a child's screen. Nothing when the pack has no plan. */
function PlanRow() {
  const { me } = useApp();
  if (!config.plan || (me.role !== 'student' && !(me.role === 'parent' && me.as))) return null;
  const on = hasPlan(me), name = config.plan.name;
  const until = me.role === 'student' && me.proUntil ? me.proUntil.slice(0, 10) : null;
  const val = on ? (until ? `On · until ${dayLong(until)}` : 'On') : 'Not on';
  const sub = on ? 'No free limits.' : me.role === 'student' ? (limitsActive() ? `Want more? Ask a parent about ${name}.` : 'Everything is open right now.') : 'Your account page shows it.';
  return (
    <div className="me-row is-info">
      <span className="me-row-text"><span className="me-row-name">{name}</span><span className="me-row-sub">{sub}</span></span>
      <span className="me-row-val">{val}</span>
    </div>
  );
}

/** Account, first in Settings: who is signed in, how passwords work (students: a parent makes a new one; parents sign
    in with a code, or a password they added), the paid plan when the pack has one, and sign out. Site pages need a
    connection (not kept offline). */
function AccountRows() {
  const { me, sfx } = useApp();
  const online = useOnline();
  const [leaving, setLeaving] = useState(false);
  if (me.role !== 'student' && me.role !== 'parent') {
    return (
      <a className="me-row" href={online ? '/account/' : undefined} aria-disabled={!online} onClick={() => sfx('tap')}>
        <span className="me-row-text"><span className="me-row-name">Sign in</span><span className="me-row-sub">Save your progress on every device.</span></span>
        {CHEVRON}
      </a>
    );
  }
  const site = (href: string, name: string, sub: string) => (
    <a className={'me-row' + (online ? '' : ' is-off')} href={online ? href : undefined} aria-disabled={!online} onClick={() => sfx('tap')}>
      <span className="me-row-text"><span className="me-row-name">{name}</span><span className="me-row-sub">{online ? sub : 'Needs a connection.'}</span></span>
      {CHEVRON}
    </a>
  );
  return (
    <>
      <p className="me-group">Account</p>
      {me.role === 'student' ? (
        <>
          <div className="me-row is-info">
            <span className="me-row-text"><span className="me-row-name">Signed in as {me.name || 'you'}</span>
              {me.username ? <span className="me-row-sub">Username: <b>{me.username}</b></span> : null}</span>
          </div>
          <div className="me-row is-info">
            <span className="me-row-text"><span className="me-row-name">Password</span>
              <span className="me-row-sub">Forgot it, or want a new one? Ask a parent. On their account page they press New password next to your name.</span></span>
          </div>
          <PlanRow />
        </>
      ) : (
        <>
          <div className="me-row is-info">
            <span className="me-row-text"><span className="me-row-name">Signed in as</span>
              <span className="me-row-sub">{me.email ? <b>{me.email}</b> : 'Your parent account'}. You sign in with a code we email you, or with a password if you added one on your account page.</span></span>
          </div>
          <PlanRow />
          {site('/account/#kids', 'Children and their logins', 'Add a child, make a new password, show a sign-in code.')}
          {site('/account/#reports', 'Reports', 'What each child practiced, strong skills and skills to work on.')}
          {config.plan ? site('/account/#plan', `${config.plan.name} and receipts`, `${config.plan.name} for each child, receipts and invoices.`) : null}
          {site('/account/#password', 'Password', 'Add or change a password for your account.')}
        </>
      )}
      <button type="button" className="me-row" disabled={leaving || !online} onClick={() => { sfx('tap'); setLeaving(true); void signOut(me.role as 'student' | 'parent'); }}>
        <span className="me-row-text"><span className="me-row-name">{leaving ? 'Signing out…' : 'Sign out'}</span>
          <span className="me-row-sub">{online ? (me.role === 'student' ? 'Your progress stays saved.' : 'On this device.') : 'Needs a connection.'}</span></span>
      </button>
    </>
  );
}

function SettingsSheet({ onClose, onTestDay, onReport, onInstall }: { onClose: () => void; onTestDay: () => void; onReport: () => void; onInstall: () => void }) {
  const { p, update, sfx, motion } = useApp();
  const [confirm, setConfirm] = useState(false);
  const picked = p.testDate ? (TEST_DAYS.find((d) => d.day === p.testDate)?.label ?? dayShort(p.testDate)) : 'Not set';
  const osStill = p.motion && !motion;     // the device asks for reduced motion
  const wipe = 'Clears the progress saved on this device.';
  return (
    <Sheet label="Settings" onClose={onClose} className="me-settings">
      <h2 className="pa-sheet-title">Settings</h2>
      <div className="me-rows">
        <AccountRows />
        <p className="me-group">Practice</p>
        {TEST_DAYS.length ? (
        <button type="button" className="me-row" onClick={() => { sfx('tap'); onTestDay(); }} aria-haspopup="dialog">
            <span className="me-row-text"><span className="me-row-name">Test day</span></span>
            <span className="me-row-val">{picked}</span>
            {CHEVRON}
          </button>
        ) : null}
        <a className="me-row" href="#start" onClick={() => sfx('tap')}>
          <span className="me-row-text"><span className="me-row-name">My plan</span><span className="me-row-sub">Goal, days a week, placement check</span></span>
          <span className="me-row-val">{p.tutor.goal ? `${p.tutor.goal.days} days · ${p.tutor.goal.minutes} min` : 'Not set'}</span>
          {CHEVRON}
        </a>
        <p className="me-group">App</p>
        <Switch name="Sound" sub="Sound effects and buzz" on={p.sound}
          onToggle={() => { update((q) => ({ ...q, sound: !q.sound })); sfx('tap'); }} />
        <Switch name="Motion" sub={osStill ? 'Your device asks for less motion, so animations stay off.' : 'Animations and effects'} on={p.motion}
          onToggle={() => { update((q) => ({ ...q, motion: !q.motion })); sfx('tap'); }} />
        <InstallRow onIos={onInstall} />
        <p className="me-group">Help</p>
        <button type="button" className="me-row" onClick={() => { sfx('tap'); onReport(); }} aria-haspopup="dialog">
          <span className="me-row-text">
            <span className="me-row-name">Report an app problem</span>
            <span className="me-row-sub">Something broken or looks wrong? Tell us.</span>
          </span>
          {CHEVRON}
        </button>
        <p className="me-links"><a href="/privacy/">Privacy Policy</a> · <a href="/terms/">Terms</a></p>
        {confirm ? (
          <div className="me-confirm" role="group" aria-label="Start over">
            <p className="me-confirm-title">Start over?</p>
            <p className="me-confirm-text">{wipe} This can&rsquo;t be undone.</p>
            <div className="me-confirm-btns">
              <button type="button" className="pa-btn coral press" onClick={() => { reset(); location.reload(); }}>Yes, start over</button>
              <button type="button" className="pa-btn ghost press" onClick={() => { sfx('tap'); setConfirm(false); }}>Keep my progress</button>
            </div>
          </div>
        ) : (
          <button type="button" className="me-row me-danger" onClick={() => { sfx('tap'); setConfirm(true); }}>
            <span className="me-row-text">
              <span className="me-row-name">Start over</span>
              <span className="me-row-sub">{wipe}</span>
            </span>
          </button>
        )}
      </div>
    </Sheet>
  );
}

const WEEKDAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** The full collection, filtered (all, earned, locked), in a sheet: on Me itself only a short row. */
function BadgesSheet({ rows, onOpen, onClose }: { rows: Row[]; onOpen: (id: string) => void; onClose: () => void }) {
  const { sfx } = useApp();
  const [filter, setFilter] = useState<'all' | 'earned' | 'locked'>('all');
  const [filterN, setFilterN] = useState(0);
  const ordered = [...rows.filter((r) => r.earned), ...rows.filter((r) => !r.earned)];
  const nEarned = rows.filter((r) => r.earned).length;
  const shown = ordered.filter((r) => (filter === 'earned' ? r.earned : filter === 'locked' ? !r.earned : true));
  const popCls = filterN === 0 ? 'fx-pop' : filterN % 2 ? 'fx-popA' : 'fx-popB';
  const ringCls = filterN === 0 ? 'me-ringSm' : filterN % 2 ? 'me-ringSmA' : 'me-ringSmB';
  const firstDelay = filterN === 0 ? 120 : 0;
  const C = 169.6;                               // ring circumference at r 27
  const pick = (f: 'all' | 'earned' | 'locked') => { if (f === filter) return; sfx('tap'); setFilter(f); setFilterN((n) => n + 1); };
  const chips: { key: 'all' | 'earned' | 'locked'; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: rows.length }, { key: 'earned', label: 'Earned', count: nEarned }, { key: 'locked', label: 'Locked', count: rows.length - nEarned },
  ];
  const setOpen = onOpen;
  return (
    <Sheet label="Badges" onClose={onClose} className="me-sheet me-badges-sheet">
      <span className="me-handle" aria-hidden="true" />
      <div className="me-badges-head">
        <h2 className="pa-sheet-title">Badges</h2>
        <div role="group" aria-label="Show badges" className="me-chips">
            {chips.map((c) => {
              const on = filter === c.key;
              return (
                <button key={c.key} type="button" className={'me-chip' + (on ? ' on' : '')} aria-pressed={on} onClick={() => pick(c.key)}>
                  <span>{c.label}</span>
                  <span className="me-chip-n">{c.count}</span>
                </button>
              );
            })}
          </div>
      </div>
      <ul role="list" aria-label={filter === 'earned' ? 'Earned badges' : filter === 'locked' ? 'Locked badges' : 'All badges'} className="me-grid">
          {shown.length === 0 ? (
            <li className="me-empty">{filter === 'earned' ? 'No badges yet. Finish a lesson to earn your first one.' : 'You have every badge. Amazing!'}</li>
          ) : null}
          {shown.map((r, i) => {
            const d = DISC[r.cat] ?? DISC.skill;
            return (
              <li key={r.id} className={popCls} style={{ animationDelay: `${firstDelay + i * 40}ms` }}>
                <button type="button" className="me-cell" aria-haspopup="dialog"
                  aria-label={r.earned ? `${r.name}, earned ${r.date}` : `${r.name}, locked, ${r.long}`}
                  onClick={() => { sfx('tap'); setOpen(r.id); }}>
                  <span className="me-art">
                    {r.earned ? (
                      <>
                        <span className="me-disc" aria-hidden="true" style={{ background: d.bg, boxShadow: `inset 0 0 0 2.5px ${d.line}` }} />
                        <BadgeArt id={r.id} earned size={52} className="me-abs me-art-e" />
                      </>
                    ) : (
                      <>
                        <svg width="58" height="58" viewBox="0 0 58 58" aria-hidden="true" className="me-abs me-ringbox" style={{ left: 0, top: 0 }}>
                          <circle cx="29" cy="29" r="27" fill="#FFFFFF" stroke="#EAE3D7" strokeWidth="3.5" />
                          <circle className={ringCls} cx="29" cy="29" r="27" fill="none" stroke="var(--accent)" strokeWidth="3.5" strokeLinecap="round"
                            strokeDasharray={C} strokeDashoffset={Math.round(C * (1 - r.pct / 100) * 10) / 10} opacity={r.pct > 0 ? 1 : 0}
                            transform="rotate(-90 29 29)" style={{ animationDelay: `${firstDelay + i * 40 + 220}ms` }} />
                        </svg>
                        <BadgeArt id={r.id} earned={false} size={42} className="me-abs me-art-l" />
                        <Lock size={20} className="me-lock" />
                      </>
                    )}
                  </span>
                  <span className="me-name" style={{ color: r.earned ? '#1D2320' : '#5C625D' }}>{r.name}</span>
                  {r.earned ? (
                    <span className="me-date">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                      {r.date}
                    </span>
                  ) : (
                    <span className="me-short">{r.short}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
    </Sheet>
  );
}

/** One small badge in the row on Me: earned ones in their disc, the next one with its progress ring. */
function MiniBadge({ r, onOpen }: { r: Row; onOpen: () => void }) {
  const d = DISC[r.cat] ?? DISC.skill, C = 169.6;
  return (
    <button type="button" className="me-mini" aria-haspopup="dialog" aria-label={r.earned ? `${r.name}, earned ${r.date}` : `${r.name}, ${r.long}`} onClick={onOpen}>
      <span className="me-art">
        {r.earned ? (
          <><span className="me-disc" aria-hidden="true" style={{ background: d.bg, boxShadow: `inset 0 0 0 2.5px ${d.line}` }} /><BadgeArt id={r.id} earned size={52} className="me-abs me-art-e" /></>
        ) : (
          <>
            <svg width="58" height="58" viewBox="0 0 58 58" aria-hidden="true" className="me-abs me-ringbox" style={{ left: 0, top: 0 }}>
              <circle cx="29" cy="29" r="27" fill="#FFFFFF" stroke="#EAE3D7" strokeWidth="3.5" />
              <circle cx="29" cy="29" r="27" fill="none" stroke="var(--accent)" strokeWidth="3.5" strokeLinecap="round" strokeDasharray={C}
                strokeDashoffset={Math.round(C * (1 - r.pct / 100) * 10) / 10} opacity={r.pct > 0 ? 1 : 0} transform="rotate(-90 29 29)" />
            </svg>
            <BadgeArt id={r.id} earned={false} size={42} className="me-abs me-art-l" />
          </>
        )}
      </span>
      <span className="me-name">{r.name}</span>
      <span className={r.earned ? 'me-date' : 'me-short'}>{r.earned ? r.date : r.more || r.short}</span>
    </button>
  );
}

export default function Me() {
  const { p, me, sfx, switchWho } = useApp();
  const [open, setOpen] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'settings' | 'testday' | 'report' | 'install' | 'badges' | null>(null);
  const online = useOnline();

  const rows = useMemo(() => buildRows(p), [p]);
  const nEarned = rows.filter((r) => r.earned).length;
  const s = streak(p);
  const lessons = Object.keys(p.lessons).filter((k) => LESSONS[k]).length;

  // "Almost there": the locked badge closest to done; none started: the first locked one.
  const almost = useMemo(() => {
    const locked = rows.filter((r) => !r.earned);
    const pool = SAMPLE_MODE && locked.some((r) => !SAMPLE_SOON.has(r.id)) ? locked.filter((r) => !SAMPLE_SOON.has(r.id)) : locked;
    const started = pool.filter((r) => r.pct > 0 && r.pct < 100).sort((a, b) => b.pct - a.pct)[0];
    return started ?? pool[0] ?? null;
  }, [rows]);
  // The row on Me: the newest earned badges (up to 3), then the one closest to done.
  const row = useMemo(() => {
    const got = rows.filter((r) => r.earned).sort((a, b) => (p.badges[b.id] || '').localeCompare(p.badges[a.id] || '')).slice(0, almost ? 3 : 4);
    return almost ? [...got, almost] : got;
  }, [rows, almost, p.badges]);

  // This week: the last 7 days (as Home and Progress count them), questions and minutes in them.
  const t = today();
  const week = last7(t);
  const wDays = week.filter((d) => practicedOn(p, d)).length;
  const wQ = week.reduce((n, d) => n + (p.qDays[d] || 0), 0);
  const wMin = Math.round(week.reduce((n, d) => n + (p.secDays[d] || 0), 0) / 60);
  const left = p.testDate ? daysBetween(t, p.testDate) : null;
  const testLabel = p.testDate ? (TEST_DAYS.find((d) => d.day === p.testDate)?.label ?? dayShort(p.testDate)) : null;

  // Skills by mastery (the tutor's own words), weakest first in the bar.
  const sk = { gap: 0, learning: 0, solid: 0, mastered: 0 };
  for (const r of Object.values(p.tutor.skills)) { const m = mastery(r); if (m !== 'new') sk[m]++; }
  const skTotal = sk.gap + sk.learning + sk.solid + sk.mastered;
  const SK: { key: keyof typeof sk; label: string; cls: string }[] = [
    { key: 'mastered', label: 'Mastered', cls: 'm' }, { key: 'solid', label: 'Solid', cls: 's' },
    { key: 'learning', label: 'Learning', cls: 'l' }, { key: 'gap', label: 'Needs work', cls: 'g' },
  ];

  const sel = open ? rows.find((r) => r.id === open) ?? null : null;
  // a parent just looking around (no child picked): their reports matter, not a guest's empty practice
  const parentLooking = me.role === 'parent' && !me.as;
  const practiced = Object.keys(p.qDays).length > 0 || p.xp > 0;
  const name = parentLooking ? 'Parent' : me.name || 'Guest';
  // A parent's session on this device: who is practicing now, and Switch (students never see it).
  // No connection now, or the children not known here (me.kidsUnknown: no usable answer from /api/me/ yet,
  // for example a busy server while online): Switch is off, and the note says which.
  const kids = me.role === 'parent' ? me.kids : null;
  const kidAs = kids && me.as ? kids.find((k) => k.id === me.as) ?? null : null;
  const asName = kidAs ? kidAs.nickname : me.role === 'parent' && me.kidsUnknown && me.as ? me.name : null;
  const canSwitch = online && !me.kidsUnknown && !!kids && kids.length > 0;
  const color = kidColor(me);
  const sub = parentLooking ? (me.email || 'Your parent account')
    : [me.name && me.grade ? `Grade ${me.grade}` : me.name ? null : 'Progress is saved on this device', `${num(p.xp)} XP`, `${lessons} lesson${lessons === 1 ? '' : 's'}`].filter(Boolean).join(' · ');

  return (
    <>
    <div className="pa-body me-main">
      <header className="me-head fx-fadeup">
        <span className="me-avatar" aria-hidden="true" style={color ? { background: color.bg, color: color.ink, boxShadow: `0 3px 0 ${color.edge}` } : undefined}>
          {me.name ? initialOf(me.name) : (
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>
          )}
        </span>
        <div className="me-who">
          <h1>{name}</h1>
          <p>{sub}</p>
        </div>
        <button type="button" className="me-gear press" aria-label="Settings" aria-haspopup="dialog" onClick={() => { sfx('tap'); setSheet('settings'); }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        {(kids && kids.length) || (me.role === 'parent' && me.kidsUnknown) ? (
          <div className={'me-as' + (canSwitch ? '' : ' off')}>
            <p className="me-as-t" id="me-as-t">{asName ? <>Practicing as <b>{asName}</b></> : 'Just looking around'}</p>
            <button type="button" className="me-swap" aria-describedby={canSwitch ? 'me-as-t' : 'me-as-t me-as-off'} disabled={!canSwitch}
              onClick={() => { sfx('tap'); switchWho(); }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5" /></svg>
              Switch
            </button>
            {!canSwitch ? <p className="me-as-off" id="me-as-off">{online ? 'Switching isn\u2019t available right now.' : 'Switching needs a connection.'}</p> : null}
          </div>
        ) : kids ? (
          // /account/ is a site page the service worker does not keep: offline, plain text and a note instead of a link
          <p className="me-hint">
            Add your child on your {online ? <a href="/account/">account page</a> : 'account page'} to keep their progress separate.
            {online ? null : <> Adding a child needs a connection.</>}
          </p>
        ) : null}
      </header>

      {me.role === 'parent' && kids && kids.length ? (
        <section aria-labelledby="me-reports-h" className="me-card me-reports fx-fadeup" style={{ animationDelay: '140ms' }}>
          <div className="me-card-top"><h2 id="me-reports-h">Your children’s reports</h2></div>
          <ul role="list">
            {kids.map((k) => (
              <li key={k.id}>
                <span className="me-kid-i" aria-hidden="true" style={(() => { const c = kidColor({ role: me.role, kids, as: k.id }); return c ? { background: c.bg, color: c.ink } : undefined; })()}>{initialOf(k.nickname)}</span>
                <span className="me-kid-n">{k.nickname}{k.grade ? <small>Grade {k.grade}</small> : null}</span>
                {online ? <a className="pa-btn ghost press me-kid-go" href={`/my-progress/?child=${encodeURIComponent(k.id)}`} onClick={() => sfx('tap')}>Open report</a>
                  : <span className="me-card-note">Needs a connection</span>}
              </li>
            ))}
          </ul>
          <p className="me-card-note">Each report shows practice days, skills, the plan and what to do tonight, in 9 languages. A weekly email is on your <a href="/account/#weekly">account page</a>.</p>
        </section>
      ) : null}

      {!parentLooking || practiced ? (<>
      <section aria-labelledby="me-week-h" className="me-card me-week fx-fadeup" style={{ animationDelay: '60ms' }}>
        <div className="me-card-top">
          <h2 id="me-week-h">This week</h2>
          <span className="me-streak" style={{ color: s.n ? 'var(--accent-ink)' : '#5C625D' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill={s.n ? 'var(--accent)' : '#D3C9B9'} stroke={s.n ? 'var(--accent-ink)' : '#9A9386'} strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true"><path d={FLAME} /></svg>
            {s.n} day streak
          </span>
        </div>
        <ol className="me-days" aria-label={`Practiced ${wDays} of the last 7 days`}>
          {week.map((d) => (
            <li key={d} className={(practicedOn(p, d) ? 'on' : '') + (d === t ? ' today' : '')} aria-hidden="true">
              <i />{WEEKDAY[parseDay(d).getDay()]}
            </li>
          ))}
        </ol>
        <p className="me-week-n"><b>{num(wQ)}</b> question{wQ === 1 ? '' : 's'} · <b>{num(wMin)}</b> min · <b>{wDays}</b> of 7 days</p>
        {TEST_DAYS.length ? (
        <button type="button" className="me-test press" aria-haspopup="dialog" onClick={() => { sfx('tap'); setSheet('testday'); }}>
            {left !== null && testLabel ? (
              <span><b>{left > 1 ? `${left} days` : left === 1 ? '1 day' : left === 0 ? 'Today' : 'Done'}</b>{left >= 0 ? ` to test day · ${testLabel}` : ` · test day was ${testLabel}`}</span>
            ) : <span><b>Set your test day</b> for a countdown</span>}
            {CHEVRON}
          </button>
        ) : null}
      </section>

      <section aria-labelledby="me-skills-h" className="me-card me-skills fx-fadeup" style={{ animationDelay: '100ms' }}>
        <div className="me-card-top">
          <h2 id="me-skills-h">Skills</h2>
          <a className="me-card-link" href="#progress" onClick={() => sfx('tap')}>See all</a>
        </div>
        {skTotal ? (
          <>
            <span className="me-skbar" aria-hidden="true">
              {SK.map((x) => sk[x.key] ? <span key={x.key} className={'me-sk-' + x.cls} style={{ flexGrow: sk[x.key] }} /> : null)}
            </span>
            <ul className="me-sklegend" role="list">
              {SK.map((x) => <li key={x.key}><i className={'me-sk-' + x.cls} aria-hidden="true" /><b>{sk[x.key]}</b> {x.label}</li>)}
            </ul>
          </>
        ) : <p className="me-card-note">Your skills fill in as you practice. Start a lesson on the map.</p>}
      </section>


      </>) : null}

      {!parentLooking || practiced ? (
      <section aria-labelledby="me-badges-h" className="me-card me-badges fx-fadeup" style={{ animationDelay: '180ms' }}>
        <div className="me-card-top">
          <h2 id="me-badges-h">Badges <span className="me-count">{nEarned}/{rows.length}</span></h2>
          <button type="button" className="me-card-link" aria-haspopup="dialog" onClick={() => { sfx('tap'); setSheet('badges'); }}>See all</button>
        </div>
        <div className="me-minis">{row.map((r) => <MiniBadge key={r.id} r={r} onOpen={() => { sfx('tap'); setOpen(r.id); }} />)}</div>
      </section>
      ) : null}
    </div>
    {sheet === 'badges' ? <BadgesSheet rows={rows} onOpen={(id) => setOpen(id)} onClose={() => setSheet(null)} /> : null}
    {sel ? <BadgeSheet key={sel.id} r={sel} onClose={() => setOpen(null)} /> : null}
    {sheet === 'settings' ? <SettingsSheet onClose={() => setSheet(null)} onTestDay={() => setSheet('testday')} onReport={() => setSheet('report')} onInstall={() => setSheet('install')} /> : null}
    {sheet === 'testday' ? <TestDaySheet onClose={() => setSheet(null)} /> : null}
    {sheet === 'report' ? <ReportSheet kind="issue" onClose={() => setSheet('settings')} /> : null}
    {sheet === 'install' ? <IosInstallSheet onClose={() => setSheet('settings')} /> : null}
    </>
  );
}
