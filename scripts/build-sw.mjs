// Writes dist/client/app/sw.js: the practice app's service worker, so /app/ opens and works with no
// connection after one online visit.
//
// It reads the built app page (dist/client/app/index.html) and follows everything the page needs to run:
// its stylesheets and scripts, the island's component and renderer, every JS module they import, static or
// dynamic (import("./x.js")), and those modules' imports (the lazy screens and the question bank chunk
// included), the fonts in the CSS, the manifest and its icon, and /favicon.svg.
// That list is the app shell the service worker saves on install. The version is a hash of the list and
// of every listed file's content, so any change to the app ships a new service worker, and an unchanged
// build ships a byte-identical one (no download for anyone).
//
// Fonts: only each face's Latin file (woff2, the unicode-range that holds A-Z) is saved up front, about
// 150 KB; the Cyrillic, Vietnamese and Latin Extended files (about 840 KB more) are saved the first time
// the browser downloads them, when a nickname needs them. Browsers that run service workers all read
// woff2, so the .woff fallbacks are never needed.
//
// It also adds <link rel=modulepreload> for the island's scripts (the component, the renderer and the modules they import
// at start, not the lazy screens) and <link rel=preload as=font> for the Latin files of Andika 400/700 and Charis SIL 700
// to dist/client/app/index.html ("preloads" below), so the browser starts them while the page is still being parsed
// instead of after the island script has run.
//
// Runs after `astro build` in npm run build (so in npm run deploy too). Fails the build when the list is
// empty or a listed file is missing. The service worker's own code is serviceWorker() below.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = path.join(ROOT, 'dist/client');
const SHELL = '/app/';
const OUT = path.join(DIST, 'app/sw.js');

const fail = (msg) => { console.error(`build-sw: ${msg}`); process.exit(1); };
if (!existsSync(path.join(DIST, 'app/index.html'))) fail('no dist/client/app/index.html: run astro build first.');

/** The built file behind a site path: /app/ -> dist/client/app/index.html. */
const fileOf = (p) => path.join(DIST, decodeURIComponent(p.endsWith('/') ? p + 'index.html' : p));
const read = (p) => readFileSync(fileOf(p), 'utf8');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

// ---------------------------------------------------------------- preloads
// <link rel="modulepreload"> for what the island imports as it starts (a client:only island is only discovered by its
// inline script), and <link rel="preload" as="font"> for the three Latin woff2 files the first screen draws with.
// Rewritten in place (links made here carry data-pa-preload), so running this script again is fine.
{
  let html = read(SHELL).replace(/<link\b[^>]*\sdata-pa-preload[^>]*>/gi, '');
  const staticDeps = (entry) => {
    const seen = new Set();
    const walk = (p) => {
      if (seen.has(p) || !existsSync(fileOf(p))) return;
      seen.add(p);
      const js = read(p);
      // static imports and re-exports only: import x from"./a.js", import"./a.js", export{x}from"./a.js"; not import("./lazy.js")
      for (const [, u] of js.matchAll(/(?:\bfrom|\bimport)\s*["']([^"']+\.m?js)["']/g)) { const q = sitePath(u, p); if (q) walk(q); }
    };
    walk(entry);
    return [...seen];
  };
  const entries = [...html.matchAll(/\s(?:component-url|renderer-url)=["']([^"']+)["']/gi)].map((m) => sitePath(m[1], SHELL)).filter(Boolean);
  const modules = [...new Set(entries.flatMap(staticDeps))];
  // Latin woff2 files by face, from the page's stylesheets.
  const wanted = [['andika', 400], ['andika', 700], ['charis sil', 700]];
  const fonts = [];
  const sheets = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).filter((t) => /\srel=["']stylesheet["']/i.test(t)).map((t) => /\shref=["']([^"']+)["']/i.exec(t)?.[1]);
  for (const href of sheets) {
    const cssPath = sitePath(href, SHELL);
    if (!cssPath || !existsSync(fileOf(cssPath))) continue;
    for (const [, body] of read(cssPath).matchAll(/@font-face\s*{([^}]*)}/gi)) {
      const family = /font-family\s*:\s*['"]?([^;'"}]+)/i.exec(body)?.[1]?.trim().toLowerCase();
      const weight = Number(/font-weight\s*:\s*(\d+)/i.exec(body)?.[1]);
      const style = /font-style\s*:\s*(\w+)/i.exec(body)?.[1] || 'normal';
      if (style !== 'normal' || !wanted.some(([f, w]) => f === family && w === weight)) continue;
      if (!rangeHas(/unicode-range\s*:\s*([^;}]+)/i.exec(body)?.[1], 0x41)) continue;   // the Latin file
      const url = [...body.matchAll(/url\(\s*['"]?([^'")]+\.woff2)['"]?\s*\)/gi)][0]?.[1];
      const p = url && sitePath(url, cssPath);
      if (p && existsSync(fileOf(p)) && !fonts.includes(p)) fonts.push(p);
    }
  }
  const tags = [
    ...fonts.map((p) => `<link rel="preload" as="font" type="font/woff2" href="${p}" crossorigin data-pa-preload>`),
    ...modules.map((p) => `<link rel="modulepreload" href="${p}" data-pa-preload>`),
  ].join('');
  if (!modules.length) fail('no island script found to preload in dist/client/app/index.html.');
  if (fonts.length < wanted.length) console.warn(`build-sw: preloading only ${fonts.length} of ${wanted.length} font files (Andika 400/700, Charis SIL 700 Latin).`);
  // After the stylesheets (they block the first paint and are asked for first), before </head>.
  html = html.replace('</head>', tags + '</head>');
  writeFileSync(fileOf(SHELL), html);
  console.log(`build-sw: preloads: ${modules.length} scripts, ${fonts.length} fonts.`);
}

/** A same-origin reference as a site path, or null (another site, data:, a page anchor). */
function sitePath(ref, from) {
  if (!ref || /^(data|blob|mailto|tel|javascript):/i.test(ref) || ref.startsWith('#')) return null;
  if (/^\/api\//.test(ref)) return null;   // the API is never saved in the shell
  let url;
  try { url = new URL(ref.replace(/&amp;/g, '&'), 'https://site.invalid' + from); } catch { return null; }
  return url.origin === 'https://site.invalid' ? url.pathname : null;
}

// ---------------------------------------------------------------- what the app needs
const list = new Set([SHELL]);
const missing = [];
const queue = [];
const add = (p, from) => {
  if (!p || list.has(p)) return;
  list.add(p);
  const f = fileOf(p);
  if (!existsSync(f) || !statSync(f).isFile()) { missing.push(`${p} (from ${from})`); return; }
  queue.push(p);
};

/** Whether an @font-face unicode-range covers the code point `cp` (no range: every code point). */
function rangeHas(range, cp) {
  if (!range) return true;
  return range.split(',').some((part) => {
    const m = /U\+([0-9A-F?]+)(?:-([0-9A-F]+))?/i.exec(part.trim());
    if (!m) return false;
    const lo = parseInt(m[1].replace(/\?/g, '0'), 16);
    const hi = m[2] ? parseInt(m[2], 16) : parseInt(m[1].replace(/\?/g, 'F'), 16);
    return cp >= lo && cp <= hi;
  });
}

function scanCss(css, from) {
  // Fonts: the woff2 of each face whose unicode-range covers Latin (U+0041 'A').
  const faces = [...css.matchAll(/@font-face\s*{([^}]*)}/gi)];
  for (const [, body] of faces) {
    const range = /unicode-range\s*:\s*([^;}]+)/i.exec(body)?.[1];
    if (!rangeHas(range, 0x41)) continue;
    const srcs = [...body.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)\s*(?:format\(\s*['"]?([\w-]+)['"]?\s*\))?/gi)];
    const pick = srcs.find(([, u, f]) => f === 'woff2' || /\.woff2$/i.test(u)) || srcs[0];
    if (pick) add(sitePath(pick[1], from), from);
  }
  // Everything else the CSS loads (background images, @import), outside @font-face.
  const rest = css.replace(/@font-face\s*{[^}]*}/gi, '');
  for (const [, u] of rest.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) add(sitePath(u, from), from);
  for (const [, u] of rest.matchAll(/@import\s+['"]([^'"]+)['"]/gi)) add(sitePath(u, from), from);
}

function scanJs(js, from) {
  // Static and dynamic imports (import x from"./a.js", import"./a.js", import("./a.js") or import(`./a.js`), the
  // form Vite writes for the lazy screens and the question bank) and the file lists Vite's preload helper keeps
  // ("/_astro/a.js", "_astro/a.css").
  for (const [, u] of js.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["'`]([^"'`]+\.(?:m?js|css))["'`]/g)) add(sitePath(u, from), from);
  for (const [, u] of js.matchAll(/["'](\/?_astro\/[^"'\s]+\.(?:m?js|css|woff2?|png|svg|webp|jpe?g))["']/g)) add(sitePath(u.startsWith('/') ? u : '/' + u, from), from);
  // Lazy chunks name each other and their CSS relative to themselves ("./Learn.abc.js", "../_astro/x.css", in the preload
  // helper's list): resolved against the importing file's folder. Only files that exist are taken (any string can look like a path).
  for (const [, u] of js.matchAll(/["'`](\.{1,2}\/[^"'`\s]+\.(?:m?js|css))["'`]/g)) {
    const p = sitePath(u, from);
    if (p && existsSync(fileOf(p)) && statSync(fileOf(p)).isFile()) add(p, from);
  }
}

function scanHtml(html, from) {
  for (const [tag] of html.matchAll(/<(?:link|script|img|source|astro-island)\b[^>]*>/gi)) {
    const name = /^<([\w-]+)/.exec(tag)[1].toLowerCase();
    if (name === 'link') {
      const rel = (/\srel=["']([^"']+)["']/i.exec(tag)?.[1] || '').toLowerCase().split(/\s+/);
      if (!rel.some((r) => ['stylesheet', 'icon', 'apple-touch-icon', 'manifest', 'modulepreload', 'preload'].includes(r))) continue;
    }
    for (const [, attr, u] of tag.matchAll(/\s(href|src|component-url|renderer-url|before-hydration-url)=["']([^"']+)["']/gi)) {
      if (name === 'link' || attr !== 'href') add(sitePath(u, from), from);
    }
  }
  for (const [, body] of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) scanCss(body, from);
  for (const [, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/type=["']module["']/i.test(attrs)) scanJs(body, from);
  }
}

function crawl() {
  while (queue.length) {
    const p = queue.shift();
    if (/\.css$/i.test(p)) scanCss(read(p), p);
    else if (/\.m?js$/i.test(p)) scanJs(read(p), p);
    else if (/\.webmanifest$|manifest\.json$/i.test(p)) {
      let m;
      try { m = JSON.parse(read(p)); } catch (e) { fail(`${p} is not valid JSON: ${e.message}`); }
      for (const icon of m.icons || []) add(sitePath(icon.src, p), p);
    }
  }
}
scanHtml(read(SHELL), SHELL);
crawl();
if (missing.length) fail(`listed file(s) missing from dist/client:\n  ${missing.join('\n  ')}`);
const order = (a, b) => (a === SHELL ? -1 : b === SHELL ? 1 : a.localeCompare(b));
const files = [...list].sort(order);
for (const need of ['/app/manifest.webmanifest', '/favicon.svg']) if (!list.has(need)) fail(`${need} is not in the app shell: is it still linked from src/pages/app/index.astro?`);
if (!files.some((p) => /^\/_astro\/.+\.js$/.test(p))) fail('no /_astro/ script in the app shell: did the app page lose its island?');
if (files.length < 5) fail(`only ${files.length} files in the app shell: something is wrong with dist/client/app/index.html.`);

// ---------------------------------------------------------------- version and output
let bytes = 0;
const version = sha(files.map((p) => {
  const buf = readFileSync(fileOf(p));
  bytes += buf.length;
  return `${p}\t${sha(buf)}`;
}).join('\n')).slice(0, 12);

/**
 * The service worker. Printed into dist/client/app/sw.js as is, with VERSION and PRECACHE filled in; it runs
 * in the browser's service worker scope (self, caches, fetch), never in Node. Scope /app/: it controls the
 * practice app only, never another page of the site.
 * - install: saves the app shell (PRECACHE) in this version's cache. A content-hashed /_astro/ file that an
 *   earlier version already saved is copied over instead of downloaded again (each deploy downloads only
 *   what changed: data plans are small). Then skipWaiting: the new version becomes active as soon as it is
 *   installed, and (Service Worker spec, Activate) every /app/ page already open is handed to it at once:
 *   their later requests go through the new version, whose activate has deleted the old version's cache.
 *   No page is reloaded. The activate step also calls clients.claim(), so the very first visit is controlled
 *   by the worker too (a screen opened offline right after it needs no reload). Lazy screen chunks (the app
 *   loads its screens with dynamic imports) are part of the shell, and the activate step keeps the cache of the
 *   version just before this one, so a page left open across a deploy still finds its own lazy chunks.
 * - activate: deletes the caches of older versions (except the one just before).
 * - fetch:
 *   - opening /app/ (any #route): the network first, for at most NET_TIMEOUT; no answer, no connection or a
 *     server error: the saved shell. The saved shell is only replaced by the next version's install, so it
 *     always matches the saved scripts (a newer page from the network could ask for scripts not saved yet).
 *   - /_astro/ files and fonts: the saved copy first (their names change with their content).
 *   - the other listed files (the icon, the manifest, /favicon.svg): the saved copy, refreshed in the
 *     background for next time (stale-while-revalidate).
 *   - /api/*, anything not GET, other sites, other pages: untouched, straight to the network as if there
 *     were no service worker.
 */
function serviceWorker(VERSION, PRECACHE) {
  'use strict';
  const PREFIX = 'practice-app-';
  const CACHE = PREFIX + VERSION;
  const SHELL = '/app/';
  const NET_TIMEOUT = 3000;
  const LISTED = new Set(PRECACHE);
  const hashed = (path) => path.startsWith('/_astro/');
  const isFont = (path) => /\.(woff2?|ttf|otf)$/i.test(path);

  /** A response the Cache API and a navigation accept: a redirected one is copied without its redirect flag. */
  async function plain(res) {
    if (!res.redirected) return res;
    return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
  }

  self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(PRECACHE.map(async (path) => {
        if (await cache.match(path)) return; // an install that was interrupted and runs again
        let res = hashed(path) ? await caches.match(path) : undefined;
        if (!res) {
          res = await fetch(path, { cache: hashed(path) ? 'default' : 'no-cache', credentials: 'same-origin' });
          if (!res.ok) throw new Error(`app shell: ${path} answered ${res.status}`);
        }
        await cache.put(path, await plain(res));
      }));
      await self.skipWaiting();
    })());
  });

  self.addEventListener('activate', (event) => {
    // clients.claim(): the page that registered this worker on a first visit is controlled at once, so its later
    // requests are served from the saved shell without a reload.
    // The cache of the version just before this one stays until the next activation: a page left open across a deploy
    // can still ask for a lazy screen chunk of its own version (the lookup for /_astro/ files reads every cache).
    event.waitUntil(caches.keys().then((keys) => {
      const mine = keys.indexOf(CACHE);
      return Promise.all(keys.filter((k, i) => k.startsWith(PREFIX) && k !== CACHE && i !== mine - 1).map((k) => caches.delete(k)));
    }).then(() => self.clients.claim()));
  });

  self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;
    const path = url.pathname;
    if (path.startsWith('/api/')) return;
    if (req.mode === 'navigate') {
      if (path === SHELL) event.respondWith(page(req));
      return;
    }
    if (hashed(path) || isFont(path)) event.respondWith(cacheFirst(event, req, path));
    else if (LISTED.has(path)) event.respondWith(staleWhileRevalidate(event, req, path));
  });

  /** The network's answer if it comes within NET_TIMEOUT and `good` accepts it; otherwise `saved`. */
  function networkOr(req, saved, good) {
    if (self.navigator.onLine === false) return Promise.resolve(saved);
    return new Promise((resolve) => {
      let done = false;
      const use = (res) => { if (!done) { done = true; clearTimeout(timer); resolve(res); } };
      const timer = setTimeout(() => use(saved), NET_TIMEOUT);
      fetch(req).then((res) => use(good(res) ? res : saved), () => use(saved));
    });
  }

  async function page(req) {
    const cached = await (await caches.open(CACHE)).match(SHELL);
    if (!cached) return fetch(req);
    return networkOr(req, cached, (res) => res.status < 500);
  }

  async function cacheFirst(event, req, path) {
    // any version's copy will do (the name changes with the content); the query is ignored (Astro retries
    // a failed island import with ?astro-retry=...)
    const hit = await caches.match(path);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') {
      const copy = res.clone();
      event.waitUntil(caches.open(CACHE).then((c) => c.put(path, copy)).catch(() => {}));
    }
    return res;
  }

  async function staleWhileRevalidate(event, req, path) {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(path);
    const fresh = fetch(req).then(async (res) => {
      if (res.ok && res.type === 'basic' && !res.redirected) await cache.put(path, res.clone());
      return res;
    });
    if (!hit) return fresh;
    event.waitUntil(fresh.catch(() => {}));
    return hit;
  }
}

const head = `/* The practice app's service worker (scope /app/). Generated by scripts/build-sw.mjs at build time: edit that file, not this one.
   Version ${version}: ${files.length} files, ${Math.round(bytes / 1024)} KB in the shell. */\n`;
writeFileSync(OUT, `${head}(${serviceWorker.toString()})(${JSON.stringify(version)}, ${JSON.stringify(files, null, 1)});\n`);
console.log(`build-sw: app/sw.js version ${version}, ${files.length} files, ${Math.round(bytes / 1024)} KB in the app shell.`);
