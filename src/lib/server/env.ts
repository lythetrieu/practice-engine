/* Cloudflare bindings (wrangler.jsonc), typed here so the code doesn't depend on generated types. */
import { env as cloudflareEnv } from 'cloudflare:workers';
import { HttpError } from './http';

export interface D1Meta { changes?: number; last_row_id?: number; rows_read?: number; rows_written?: number; duration?: number }
export interface D1Result<T = Record<string, unknown>> { results: T[]; success: boolean; meta: D1Meta }
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}
export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}
export interface RateLimiter { limit(options: { key: string }): Promise<{ success: boolean }> }
/** Cloudflare Email Service (send_email binding). */
export interface EmailBinding {
  send(message: { to: string | { email: string; name?: string }; from: string | { email: string; name?: string }; subject: string; text?: string; html?: string; replyTo?: string; headers?: Record<string, string> }): Promise<{ messageId: string }>;
}

export interface Bindings {
  DB?: D1Database;
  /** Rate limits (wrangler.jsonc "ratelimits"): the API in general, parent sign-in, and student logins (higher: a class can share one IP). */
  API_RL?: RateLimiter;
  AUTH_RL?: RateLimiter;
  STUDENT_RL?: RateLimiter;
  /** Bot check (src/lib/server/human.ts): the public site key, the hostnames a token may come from, and the secret
      (wrangler secret; .dev.vars locally). Off while TURNSTILE_SECRET is empty. */
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_HOSTNAMES?: string;
  TURNSTILE_SECRET?: string;
  /** Sign-in emails through Cloudflare Email Service (src/lib/server/mail.ts). Without the binding (and always in
      `astro dev`) the code is printed in the server console instead. MAIL_FROM is the sender address. */
  EMAIL?: EmailBinding;
  MAIL_FROM?: string;
  /** Operator alerts on new problem reports and new app errors (lib/server/alerts.ts); comma-separated; empty = off. */
  ALERT_EMAIL?: string;
  /** Student passwords and sign-in codes (src/lib/server/password.ts): the HMAC key (a secret) and PBKDF2 iterations. */
  PASSWORD_PEPPER?: string;
  PASSWORD_ITERATIONS?: string;
  /** Admins (src/lib/server/admin.ts): parent-account emails, comma-separated, that may open /admin/. Empty = no admin. */
  ADMIN_EMAILS?: string;
  /** The optional AI tutor (src/lib/server/aitutor.ts). Off unless PIP_ENABLED is '1' and OPENROUTER_API_KEY is set (a
      secret; .dev.vars locally). OPENROUTER_MODEL and OPENROUTER_FALLBACKS (comma-separated, tried in order) pick the
      models; PIP_DAILY_CAP caps the whole site's tutor requests a day (default 3000, on top of 30 per learner).
      AI_TUTOR_MOCK=1 answers with a canned reply and no key (local testing only). */
  PIP_ENABLED?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  OPENROUTER_FALLBACKS?: string;
  PIP_DAILY_CAP?: string;
  AI_TUTOR_MOCK?: string;
  /** Answer-log rows the whole site may save a day (default 15000; src/pages/api/me/answers.ts). */
  ANSWERS_DAILY_CAP?: string;
  /** The optional paid plan (src/lib/server/polar.ts, docs/payments.md). Off unless pack.yaml has a `plan` block and
      POLAR_PRODUCT_ID (a var) plus the POLAR_ACCESS_TOKEN and POLAR_WEBHOOK_SECRET secrets are all set.
      POLAR_SERVER: "sandbox" for Polar's test server, anything else for production. */
  POLAR_PRODUCT_ID?: string;
  POLAR_ACCESS_TOKEN?: string;
  POLAR_WEBHOOK_SECRET?: string;
  POLAR_SERVER?: string;
  /** The site's own address (https://...), for links in emails the cron sends (no request to read it from). Falls
      back to pack.yaml site.url. */
  SITE_URL?: string;
}
export const bindings = cloudflareEnv as unknown as Bindings;

/** The database, or a 503 the visitor can understand. */
export function db(): D1Database {
  if (!bindings.DB) throw new HttpError(503, 'We could not reach our database. Please try again later.');
  return bindings.DB;
}

export const now = () => new Date().toISOString();

/** The HMAC key behind student passwords and sign-in codes. Without it nothing can be signed in safely, so say so plainly. */
export function pepper(): string {
  const v = bindings.PASSWORD_PEPPER;
  if (!v) {
    console.error('PASSWORD_PEPPER is not set. Locally: copy .dev.vars.example to .dev.vars. On Cloudflare: wrangler secret put PASSWORD_PEPPER.');
    throw new HttpError(503, 'Sign-in is not set up on this server yet (PASSWORD_PEPPER is missing). The site operator needs to set it.');
  }
  return v;
}
