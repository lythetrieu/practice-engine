/* Bot check (Cloudflare Turnstile) for problem reports, so bots can't fill the database. And for sign-in code
   emails (POST /api/auth/code/ and the re-auth code, action "signin"), so a script can't send codes to other
   people's inboxes or use up the site's daily email cap.
   - Off until TURNSTILE_SITE_KEY and TURNSTILE_HOSTNAMES (wrangler.jsonc vars) and the TURNSTILE_SECRET
     secret are all set; until then requests are accepted without it.
   - A request without a valid pass or token gets a 403 carrying the site key ({verify}). The browser
     (src/lib/client/human.ts) then loads Turnstile, and only then, and sends the request again with the token in
     x-turnstile-token. Siteverify must answer success, the route's action and a hostname listed in
     TURNSTILE_HOSTNAMES. Cloudflare's test keys answer hostname example.com and no action, so they
     pass only where TURNSTILE_HOSTNAMES lists example.com: .dev.vars, never wrangler.jsonc.
   - A check that passes earns a pass: the browser ID and an expiry, signed with the secret, sent back
     in x-pass, so a student is checked once every PASS_HOURS rather than on every answer.
     Never for "signin": each code email needs its own token, since a pass would let a script that solved
     one check send codes for two hours.
   Deleting data never needs the check. */
import { bindings } from './env';
import { HttpError } from './http';

export type HumanAction = 'report' | 'signin';
const PASS_HOURS = 2;
const PASS_MS = PASS_HOURS * 3_600_000;
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const hostnames = () => new Set((bindings.TURNSTILE_HOSTNAMES ?? '').split(',').map((h) => h.trim()).filter(Boolean));
export const turnstileOn = () => !!(bindings.TURNSTILE_SITE_KEY && bindings.TURNSTILE_SECRET && hostnames().size);

const enc = new TextEncoder();
let cached: { secret: string; key: Promise<CryptoKey> } | null = null;
function passKey(secret: string) {
  if (cached?.secret !== secret) cached = { secret, key: crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']) };
  return cached.key;
}
const signed = (learner: string, exp: number) => enc.encode(`pe-pass-v1|${learner}|${exp}`);
const b64url = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function makePass(secret: string, learner: string) {
  const exp = Date.now() + PASS_MS;
  return `${exp}.${b64url(await crypto.subtle.sign('HMAC', await passKey(secret), signed(learner, exp)))}`;
}
async function passOk(secret: string, learner: string, pass: string | null) {
  const m = pass ? /^(\d{13})\.([A-Za-z0-9_-]{43})$/.exec(pass) : null;
  if (!m) return false;
  const exp = Number(m[1]);
  if (exp < Date.now() || exp > Date.now() + PASS_MS) return false;
  try {
    return await crypto.subtle.verify('HMAC', await passKey(secret), unb64url(m[2]), signed(learner, exp));
  } catch {
    return false;
  }
}

interface Siteverify { success?: boolean; action?: string; hostname?: string; 'error-codes'?: string[]; metadata?: { result_with_testing_key?: boolean } }

/**
 * Lets a request through when the check is off, its pass is valid or its Turnstile token passes;
 * otherwise throws a 403 with {verify: site key}. Returns a new pass for the response, or null.
 * "signin" takes no learner and never gets or accepts a pass.
 */
export async function requireHuman(request: Request, action: HumanAction, learner: string | null): Promise<string | null> {
  if (!turnstileOn()) return null;
  const secret = bindings.TURNSTILE_SECRET as string, passes = !!learner && action !== 'signin';
  if (passes && (await passOk(secret, learner as string, request.headers.get('x-pass')))) return null;
  const again = () => new HttpError(403, 'Please complete the quick check that you are not a robot, then try again.', { verify: bindings.TURNSTILE_SITE_KEY });
  const token = request.headers.get('x-turnstile-token');
  if (!token || token.length > 2048) throw again();

  const form = new URLSearchParams({ secret, response: token });
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) form.set('remoteip', ip);
  let out: Siteverify;
  try {
    const r = await fetch(SITEVERIFY, { method: 'POST', body: form, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`siteverify HTTP ${r.status}`);
    out = await r.json();
  } catch (e) {
    
    console.error('Turnstile siteverify failed', e);
    throw new HttpError(503, 'We could not finish the robot check just now. Please try again in a minute.');
  }
  const testing = out.metadata?.result_with_testing_key === true;
  const ok = out.success === true && hostnames().has(out.hostname ?? '') && (testing || out.action === action);
  if (!ok) {
    console.warn('Turnstile rejected', action, out['error-codes'] ?? [], testing ? 'testing key' : out.hostname);
    throw again();
  }
  return passes ? makePass(secret, learner as string) : null;
}
