import type { APIRoute } from 'astro';
import { APP_ENV } from '../config/flags';
import { llmsTxt } from '../lib/seo';
export const prerender = false;
// D-44: índice Markdown curado de páginas públicas canónicas. Nunca en preview; en local solo para revisión.
export const GET: APIRoute = ({ url }) => APP_ENV === 'preview'
  ? new Response('No encontrado', { status: 404 })
  : new Response(llmsTxt(APP_ENV, url.origin), { headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
