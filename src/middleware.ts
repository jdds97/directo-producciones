import { defineMiddleware } from 'astro:middleware';
import { APP_ENV } from './config/flags';
import { resolveRedirect, robotsHeader } from './lib/redirects';
// EmDash permite crear/actualizar status=published sin pasar por beforePublish.
// Obligar a guardar borrador y usar la acción publish que sí aplica revisión.
export const onRequest = defineMiddleware(async ({ url, request }, next) => {
  // Host (www→apex, D-07) y mapa de URLs antiguas: un único mecanismo, solo en producción.
  const moved = ['GET', 'HEAD'].includes(request.method) ? resolveRedirect(url, APP_ENV) : null;
  if (moved?.status === 301) return new Response(null, { status: 301, headers: { Location: moved.location, 'Cache-Control': 'public, max-age=3600' } });
  if (moved?.status === 410) {
    // Plantilla de error (pages/410.astro: estado 410, noindex, enlaces a Inicio, Blog y Contacto).
    const gone = await next('/410/');
    if (gone.status === 410) gone.headers.set('Cache-Control', 'public, max-age=3600');
    return gone;
  }
  if (!['GET', 'HEAD', 'DELETE'].includes(request.method) &&
      /^\/_emdash\/api\/content\//.test(url.pathname) && !/\/(publish|unpublish|trash|restore|lock)(\/|$)/.test(url.pathname)) {
    let body: Record<string, unknown>;
    try { body = await request.clone().json(); } catch { return next(); }
    if (body.status && body.status !== 'draft') {
      return new Response('Guardar borrador y solicitar publicación con revisión individual.', {
        status: 403, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'private, no-store' },
      });
    }
  }
  const response = await next();
  const robots = robotsHeader(APP_ENV, url.pathname);
  if (robots && !response.headers.has('X-Robots-Tag')) response.headers.set('X-Robots-Tag', robots);
  return response;
});
