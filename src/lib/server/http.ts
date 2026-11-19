/* Helpers shared by the JSON API routes in src/pages/api/. Every POST is same-origin only, size-capped
   and answers {ok: true, ...} or {ok: false, error}, where error is a sentence a family can read. */
import type { APIContext, APIRoute } from 'astro';
import type { RateLimiter } from './env';

export class HttpError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
export const JSON_HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'x-robots-tag': 'noindex',
};

export const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });

/**
 * Throws away a body we won't use. A small one is read to the end so the connection stays
 * reusable (wrangler dev otherwise drops the next POST); anything over 64 KiB is cancelled.
 */
export async function drain(reader: ReadableStreamDefaultReader<Uint8Array>, seen = 0) {
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      seen += value.byteLength;
      if (seen > 65536) { await reader.cancel(); return; }
    }
  } catch {
    // the client went away
  }
}

/** Same-origin POSTs only. On a local dev server the Origin may differ by port or host spelling. */
export function allowedOrigin(origin: string | null, url: URL): boolean {
  if (!origin) return false; // browsers always send Origin on a POST
  if (origin === url.origin) return true;
  if (!LOCAL_HOSTS.has(url.hostname)) return false;
  try { return LOCAL_HOSTS.has(new URL(origin).hostname); } catch { return false; }
}

/** Reads the body, but gives up and returns null once it passes `max` bytes. */
export async function readCapped(request: Request, max: number): Promise<Uint8Array | null> {
  if (Number(request.headers.get('content-length')) > max) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await drain(reader, size); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  return bytes;
}

/** A JSON object body (or a plain form post when `form` is set). Anything else is a 400. */
export async function readBody(request: Request, max: number, form = false): Promise<Record<string, unknown>> {
  const bytes = await readCapped(request, max);
  if (!bytes) throw new HttpError(413, 'That request is too large.');
  const text = new TextDecoder().decode(bytes);
  if (form && (request.headers.get('content-type') ?? '').includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(text));
  }
  try {
    const data: unknown = JSON.parse(text);
    if (data && typeof data === 'object' && !Array.isArray(data)) return data as Record<string, unknown>;
  } catch {
    // fall through
  }
  if (form) return {};
  throw new HttpError(400, 'That request could not be read.');
}

/** The rate-limit key: the IPv4 address, or the /64 network of an IPv6 address (one home or phone gets a whole /64). */
export function limitKey(request: Request): string {
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [], t = tail ? tail.split(':') : [];
  const full = [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  return full.slice(0, 4).map((x) => x.toLowerCase().replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

/** Counts the request against a rate limit (per IP or IPv6 /64, per Cloudflare location; nothing is stored). */
export async function rateLimit(limiter: RateLimiter | undefined, request: Request) {
  if (!limiter) return;
  let allowed = true;
  try {
    ({ success: allowed } = await limiter.limit({ key: limitKey(request) }));
  } catch {
    // If the limiter itself fails, let the request through rather than block a student.
  }
  if (!allowed) throw new HttpError(429, 'Too many tries. Please wait a minute and try again.');
}

export interface PostArgs { request: Request; url: URL; body: Record<string, unknown>; locals: APIContext['locals'] }

/**
 * A POST route: checks the origin, the rate limit and the size, then runs `handler`. A plain
 * object result becomes {ok: true, ...result}; a Response is sent as is. Errors become
 * {ok: false, error} with the right status, and unexpected ones are logged (Workers observability).
 */
export function postRoute(handler: (args: PostArgs) => Promise<Record<string, unknown> | Response>, opts: { max: number; limiter?: () => RateLimiter | undefined; form?: boolean }): APIRoute {
  return async ({ request, url, locals }) => {
    let read = false;
    try {
      if (!allowedOrigin(request.headers.get('origin'), url)) throw new HttpError(403, 'Please use the site’s own address.');
      await rateLimit(opts.limiter?.(), request);
      const body = await readBody(request, opts.max, opts.form);
      read = true;
      const out = await handler({ request, url, body, locals });
      return out instanceof Response ? out : json({ ok: true, ...out });
    } catch (e) {
      if (!read && request.body && !request.body.locked) await drain(request.body.getReader());
      if (e instanceof HttpError) {
        return json({ ok: false, error: e.message, ...e.extra }, e.status, e.status === 429 ? { 'retry-after': '60' } : {});
      }
      console.error('API error', url.pathname, e);
      return json({ ok: false, error: 'Something went wrong on our side. Please try again.' }, 500);
    }
  };
}

/** Every other method on a POST-only route. */
export const postOnly: APIRoute = async ({ request }) => {
  if (request.body && !request.body.locked) await drain(request.body.getReader());
  return json({ ok: false, error: 'Method not allowed.' }, 405, { allow: 'POST' });
};

// ---------------------------------------------------------------- validation

export const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function str(v: unknown, field: string, max: number, opts: { optional?: boolean; pattern?: RegExp } = {}): string {
  if (v == null || v === '') {
    if (opts.optional) return '';
    throw new HttpError(400, `Missing ${field}.`);
  }
  if (typeof v !== 'string' || v.length > max || (opts.pattern && !opts.pattern.test(v))) throw new HttpError(400, `Invalid ${field}.`);
  return v;
}
export function int(v: unknown, field: string, min: number, max: number, optional = false): number | null {
  if (v == null && optional) return null;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new HttpError(400, `Invalid ${field}.`);
  return v;
}
/** Milliseconds spent on a question, kept within 0 to 6 hours; null when missing or not a number. */
export const msOf = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), 6 * 3_600_000) : null);
/** An ISO time within a day of now, or now. */
export function when(v: unknown): string {
  const t = typeof v === 'string' && v.length <= 40 ? Date.parse(v) : NaN;
  return Number.isFinite(t) && Math.abs(t - Date.now()) < 86_400_000 ? new Date(t).toISOString() : new Date().toISOString();
}
