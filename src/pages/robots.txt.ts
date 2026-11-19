import type { APIRoute } from 'astro';
import { APP_ENV } from '../config/flags';
import { robotsTxt } from '../lib/seo';
export const prerender = false;
// Por entorno (lib/seo.ts): local y preview bloquean todo; producción permite el rastreo y apunta al sitemap.
export const GET: APIRoute = ({ url }) => new Response(robotsTxt(APP_ENV, url.origin), {
  headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
});
