// The app's web manifest, from the pack: name, colors and icon (the pack's logo, an SVG).
import type { APIRoute } from 'astro';
import { config } from '../../pack';

export const prerender = true;

export const GET: APIRoute = () => {
  const bg = config.brand.colors.background ?? '#FBF8F3';
  const body = {
    id: '/app/',
    name: config.name,
    short_name: config.name.length > 12 ? config.exam : config.name,
    description: config.tagline,
    start_url: '/app/',
    scope: '/app/',
    display: 'standalone',
    background_color: bg,
    theme_color: bg,
    lang: 'en-US',
    icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
  return new Response(JSON.stringify(body, null, 2), { headers: { 'content-type': 'application/manifest+json; charset=utf-8' } });
};
