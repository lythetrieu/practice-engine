// The Turnstile bot check in the browser (the server side is src/lib/server/human.ts). The server answers 403
// {verify: <site key>} when it wants a check; `humanToken` runs Turnstile (its script loads only then) and gives back a
// token, and the request goes again with the token in the x-turnstile-token header. `postChecked` does all of that.
// Off by default: with no TURNSTILE_SECRET the server never asks.

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  remove(id: string): void;
}
type W = Window & { turnstile?: TurnstileApi; __peTurnstile?: () => void };

let loading: Promise<TurnstileApi> | null = null;
function turnstile(): Promise<TurnstileApi> {
  const w = window as W;
  if (w.turnstile) return Promise.resolve(w.turnstile);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      w.__peTurnstile = () => resolve(w.turnstile as TurnstileApi);
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__peTurnstile';
      s.async = true;
      s.onerror = () => { loading = null; s.remove(); reject(new Error('Turnstile did not load')); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

const ASK: Record<string, string> = { signin: 'One quick check before we email your code.', report: 'One quick check before we send your report.' };

/** A Turnstile token for `action`. The check runs out of sight; for the rare browser Turnstile wants to ask, a small
    box shows in the corner (inside an open dialog when there is one, since the rest of the page can't be clicked then). */
export async function humanToken(siteKey: string, action: string): Promise<string> {
  const ts = await turnstile();
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483002;max-width:calc(100vw - 24px);border-radius:10px;font:14px/1.4 system-ui,sans-serif;color:#2e3136';
  box.innerHTML = '<p style="display:none;margin:0 0 8px"></p><div></div>';
  (box.firstChild as HTMLElement).textContent = ASK[action] || 'One quick check first.';
  let modal: Element | null = null;
  try { modal = document.querySelector('dialog:modal'); } catch { modal = document.querySelector('dialog[open]'); }
  (modal || document.body).appendChild(box);
  const ask = (on: boolean) => {
    box.style.background = on ? '#fff' : '';
    box.style.padding = on ? '12px' : '';
    box.style.boxShadow = on ? '0 4px 18px rgba(0,0,0,.25)' : '';
    (box.firstChild as HTMLElement).style.display = on ? 'block' : 'none';
  };
  let id: string | null = null;
  try {
    return await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), 120_000);
      const fail = (why?: unknown) => { clearTimeout(timer); reject(new Error(String(why))); };
      id = ts.render(box.lastChild as HTMLElement, {
        sitekey: siteKey, action, appearance: 'interaction-only',
        callback: (token: string) => { clearTimeout(timer); resolve(token); },
        'error-callback': (code?: unknown) => { fail(code || 'error'); return true; },
        'expired-callback': () => fail('expired'),
        'timeout-callback': () => fail('timeout'),
        'unsupported-callback': () => fail('unsupported'),
        'before-interactive-callback': () => ask(true),
        'after-interactive-callback': () => ask(false),
      });
    });
  } finally {
    try { if (id != null) ts.remove(id); } catch { /* already gone */ }
    box.remove();
  }
}

export interface ApiReply { ok?: boolean; error?: string; verify?: string; [k: string]: unknown }

/** POSTs JSON; when the server asks for the bot check, runs it and sends the request once more with the token. */
export async function postChecked(path: string, body: unknown, action: string, headers: Record<string, string> = {}): Promise<ApiReply> {
  const post = async (extra: Record<string, string>): Promise<ApiReply> => {
    try {
      const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers, ...extra }, body: JSON.stringify(body ?? {}), credentials: 'same-origin' });
      return (await r.json().catch(() => ({ ok: false, error: 'HTTP ' + r.status }))) as ApiReply;
    } catch {
      return { ok: false, error: 'Could not reach the site. Check your connection and try again.' };
    }
  };
  const first = await post({});
  if (!first.verify) return first;
  let token: string | null = null;
  try { token = await humanToken(first.verify, action); } catch { /* blocked script or no answer: the server's message stands */ }
  return token ? post({ 'x-turnstile-token': token }) : first;
}
