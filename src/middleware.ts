import { defineMiddleware } from 'astro:middleware';
// EmDash permite crear/actualizar status=published sin pasar por beforePublish.
// Obligar a guardar borrador y usar la acción publish que sí aplica revisión.
export const onRequest = defineMiddleware(async ({ url, request }, next) => {
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
  return next();
});
