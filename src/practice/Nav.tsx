// The bottom nav: 5 tabs.
import type { ReactNode } from 'react';
import type { Tab } from './ctx';
import { useApp } from './ctx';
import { dueMistakes } from './store';
import { pack, config } from '../pack';

const ITEMS: { tab: Tab; label: string; icon: ReactNode }[] = [
  { tab: 'home', label: 'Home', icon: <path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" /> },
  { tab: 'learn', label: 'Learn', icon: <><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="6" r="2.5" /><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5" /></> },
  { tab: 'progress', label: 'Progress', icon: <><path d="M4 20V11M10 20V5M16 20v-7M22 20H2" /></> },
  { tab: 'test', label: 'Full test', icon: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V3h6v1" /><path d="M9 10h6M9 14h6M9 18h3" /></> },
  { tab: 'me', label: 'Me', icon: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></> },
];

export default function Nav({ active }: { active: Tab }) {
  const { p, sfx } = useApp();
  const due = dueMistakes(p).length;   // missed questions to redo today, as a count on the Review tab
  return (
    <nav className="pa-nav" aria-label="Main">
      <a className="pa-nav-brand" href="#home" aria-label={`${config.name}: Home`}>
        <span className="pa-nav-logo" aria-hidden="true" dangerouslySetInnerHTML={{ __html: pack.logo }} />
        <span>{config.name}</span>
      </a>
      {ITEMS.map((it) => (
        <a key={it.tab} className="pa-nav-item" href={'#' + it.tab} aria-current={it.tab === active ? 'page' : undefined} onClick={() => sfx('tap')}>
          <span className="pa-nav-ic">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{it.icon}</svg>
            {it.tab === 'progress' && due > 0 ? <b className="pa-nav-count" aria-hidden="true">{due > 9 ? '9+' : due}</b> : null}
          </span>
          {it.label}
          {it.tab === 'progress' && due > 0 ? <span className="sr">, {due} to redo</span> : null}
        </a>
      ))}
    </nav>
  );
}
