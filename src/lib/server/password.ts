/* Student password hashing that fits the Workers Free plan. The Free plan stops a request at 10 ms of CPU, so OWASP's 600,000 PBKDF2 iterations
   (a few hundred ms) are out of reach. Instead:
   - the secret is first keyed with HMAC-SHA256 under PASSWORD_PEPPER, a Worker secret that is never in
     the database, so a copy of the database alone can't be used to guess passwords offline;
   - then PBKDF2-HMAC-SHA256 with PASSWORD_ITERATIONS (default 5,000, about 3 ms) and a random salt.
   Stored as "hpbkdf2-sha256$<iterations>$<salt>$<hash>" (base64url). On the Paid plan, raise
   PASSWORD_ITERATIONS (e.g. to 600000): hashes below it are redone at the next successful sign-in
   (needsRehash), so nobody has to change a password. Keep PASSWORD_PEPPER forever: changing it makes
   every student password fail until the parent resets it. */
import { bindings, pepper } from './env';

const enc = new TextEncoder();
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
export const iterations = () => Math.max(1000, Number(bindings.PASSWORD_ITERATIONS) || 5000);

let peppered: { value: string; key: Promise<CryptoKey> } | null = null;
async function keyed(secret: string): Promise<Uint8Array<ArrayBuffer>> {
  const value = pepper();
  if (peppered?.value !== value) peppered = { value, key: crypto.subtle.importKey('raw', enc.encode(value), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']) };
  return new Uint8Array(await crypto.subtle.sign('HMAC', await peppered.key, enc.encode(secret.normalize('NFKC'))));
}
async function derive(input: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>, n: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', input, 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: n }, key, 256));
}

export async function hashSecret(secret: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16)), n = iterations();
  return `hpbkdf2-sha256$${n}$${b64(salt)}$${b64(await derive(await keyed(secret), salt, n))}`;
}

const FORMAT = /^(h?pbkdf2-sha256)\$(\d{4,7})\$([\w-]+)\$([\w-]+)$/;
/** True when `secret` matches `stored`; compares every byte, so timing says nothing. Also reads the older unpeppered format. */
export async function verifySecret(secret: string, stored: string | null): Promise<boolean> {
  const m = stored ? FORMAT.exec(stored) : null;
  if (!m) return false;
  const input = m[1] === 'hpbkdf2-sha256' ? await keyed(secret) : enc.encode(secret.normalize('NFKC'));
  const want = unb64(m[4]), got = await derive(input, unb64(m[3]), Number(m[2]));
  let diff = want.length ^ got.length;
  for (let i = 0; i < want.length; i++) diff |= want[i] ^ (got[i] ?? 0);
  return diff === 0;
}

/** A stored hash below today's settings (fewer iterations, or not peppered): redo it after a good sign-in. */
export function needsRehash(stored: string | null): boolean {
  const m = stored ? FORMAT.exec(stored) : null;
  return !m || m[1] !== 'hpbkdf2-sha256' || Number(m[2]) < iterations();
}
