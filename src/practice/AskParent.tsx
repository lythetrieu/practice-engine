// "Ask a parent for more": on a child's own login, at a free limit (today's new lessons, or the free full tests), one
// button sends their parent a short note (POST /api/student/ask-parent/; one email a day at most). The child's screen
// never shows a price or a payment. A parent practicing as a child gets a link to the account page instead (Capped).
import { useState } from 'react';
import { config } from '../pack';
import { useApp } from './ctx';
import { useOnline, noteNetFail, noteNetOk } from './offline';

type State = 'idle' | 'busy' | 'sent' | 'already' | 'error';
const ASKED_KEY = `pe.${config.id}.asked.v1`;

export default function AskParent({ kind, className = 'pa-btn ghost' }: { kind: 'lessons' | 'tests'; className?: string }) {
  const { me, sfx } = useApp();
  const online = useOnline();
  // Sent today already (this device): say so after a reload instead of offering the button again.
  const [st, setSt] = useState<State>(() => { try { return localStorage.getItem(ASKED_KEY) === new Date().toDateString() ? 'already' : 'idle'; } catch { return 'idle'; } });
  const [err, setErr] = useState('');
  if (me.role !== 'student') return null;
  const ask = async () => {
    if (st === 'busy' || st === 'sent' || st === 'already') return;
    sfx('tap'); setSt('busy'); setErr('');
    try {
      const r = await fetch('/api/student/ask-parent/', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind }) });
      noteNetOk();
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok !== false) { try { localStorage.setItem(ASKED_KEY, new Date().toDateString()); } catch { /* storage blocked */ } setSt(d.already ? 'already' : 'sent'); return; }
      setErr(d.error || 'Could not send it. Try again later.'); setSt('error');
    } catch {
      noteNetFail();
      setErr('Could not reach the site. Check your connection.'); setSt('error');
    }
  };
  if (st === 'sent' || st === 'already') {
    return <p className="ask-done" role="status">{st === 'sent' ? 'Sent! We let your parent know.' : 'Your parent already got your note today.'}</p>;
  }
  return (
    <>
      <button type="button" className={className + ' press'} disabled={!online || st === 'busy'} onClick={ask}>
        {!online ? 'Ask a parent (needs a connection)' : st === 'busy' ? 'Sending…' : 'Ask a parent for more'}
      </button>
      {st === 'error' ? <p className="ask-err" role="alert">{err}</p> : null}
    </>
  );
}
