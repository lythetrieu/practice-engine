/* The Worker (wrangler.jsonc "main"): Astro answers every request. The cron ("triggers"): 08:17 UTC daily deletes
   server rows past their retention (src/lib/server/retention.ts), then emails parents whose paid plan ends within two
   weeks (src/lib/server/planMail.ts; only when payments are on). */
import astro from '@astrojs/cloudflare/entrypoints/server';
import type { D1Database } from './lib/server/env';
import { purgeOld } from './lib/server/retention';
import { runPlanEnding } from './lib/server/planMail';
import { appMember, APP_SIGN_IN } from './lib/server/appAccess';

// The practice app's page (static, served from assets) is for accounts only. wrangler.jsonc sends these paths to the
// Worker first; everything else under /app/ (sw.js, the manifest) is served as before.
const APP_PAGE = new Set(['/app', '/app/', '/app/index.html']);

export default {
  async fetch(request: Request, env: { ASSETS: { fetch(r: Request): Promise<Response> } }, ctx: unknown) {
    const url = new URL(request.url);
    if (APP_PAGE.has(url.pathname) && (request.method === 'GET' || request.method === 'HEAD')) {
      // Local development (`astro dev`): a guest may open the app too, so it can be tried without signing in.
      if (!import.meta.env.DEV && !(await appMember(request))) return new Response(null, { status: 302, headers: { location: APP_SIGN_IN, 'cache-control': 'no-store' } });
      // `astro dev` has no built page in ASSETS: Astro serves it there.
      return import.meta.env.DEV ? (astro.fetch as (r: Request, e: unknown, c: unknown) => Promise<Response>)(request, env, ctx) : env.ASSETS.fetch(request);
    }
    return (astro.fetch as (r: Request, e: unknown, c: unknown) => Promise<Response>)(request, env, ctx);
  },
  async scheduled(_controller: unknown, env: { DB?: D1Database }, ctx: { waitUntil(p: Promise<unknown>): void }) {
    if (!env.DB) return;
    const D = env.DB;
    // Retention first, then the paid plan's "ends soon" emails (nothing to do unless payments are on).
    ctx.waitUntil(purgeOld(D).then((r) => console.log('retention', JSON.stringify(r)))
      .then(() => runPlanEnding(D)).then((r) => { if (r.sent) console.log('plan ending emails', r.sent); })
      .catch((e) => console.error('cron', e)));
  },
};
