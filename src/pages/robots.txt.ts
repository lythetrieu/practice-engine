import type { APIRoute } from 'astro';

// Built to /robots.txt at build time. The Sitemap line follows `site` in astro.config.mjs (pack.yaml site.url).
// The home page is open to every crawler. The app, the sign-in pages and the API have nothing to index.
export const prerender = true;

export const GET: APIRoute = ({ site }) => {
  const body = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /app/',
    'Disallow: /account/',
    'Disallow: /student/',
    '',
    ...(site ? [`Sitemap: ${new URL('/sitemap-index.xml', site).href}`, ''] : []),
  ].join('\n');
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
};
