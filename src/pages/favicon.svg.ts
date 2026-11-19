import type { APIRoute } from 'astro';
import { pack } from '../pack';

// Built to /favicon.svg at build time: the pack's logo (pack.yaml brand.logo).
export const prerender = true;

export const GET: APIRoute = () =>
  new Response(pack.logo, { headers: { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'public, max-age=86400' } });
