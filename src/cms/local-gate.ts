import { defineMiddleware } from 'astro:middleware';
import { isCmsPath } from './scope.ts';

const LOCAL_CMS_ORIGIN = 'http://localhost:4321';

export const onRequest = defineMiddleware(async (context, next) => {
  const { url, request } = context;
  // Prerendering is internal; browser requests must use the loopback origin.
  if (!context.isPrerendered && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    return new Response('Baseline disponible exclusivamente en local.', { status: 403 });
  }
  if (isCmsPath(url.pathname) && url.origin !== LOCAL_CMS_ORIGIN) {
    return context.redirect(`${LOCAL_CMS_ORIGIN}${url.pathname}${url.search}`, 307);
  }
  // Disable auxiliary public APIs injected by EmDash, signup and integrations.
  const allowedRoot = ['/', '/streaming/', '/comunicacion-marketing/', '/contacto/', '/404', '/404/', '/robots.txt'];
  const cms = isCmsPath(url.pathname);
  if (!cms && !allowedRoot.includes(url.pathname) && !url.pathname.startsWith('/_astro/') && !url.pathname.startsWith('/@') && !url.pathname.startsWith('/src/') && !url.pathname.startsWith('/node_modules/')) {
    return new Response('No encontrado', { status: 404, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
  }
  if (cms && /\/(signup|comments|plugins|registry|marketplace|mcp|import|export|transfer|ai|oauth|cron|dev-bypass|dev-reset)(\/|$)/i.test(url.pathname)) {
    return new Response('Función fuera del alcance local aprobado.', { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  if (!['GET', 'HEAD'].includes(request.method) && /^\/_emdash\/api\/(settings|collections|taxonomies|menus|widgets)(\/|$)/.test(url.pathname)) {
    return new Response('Modelo y configuración versionados fuera del panel.', { status: 403 });
  }
  if (!['GET', 'HEAD'].includes(request.method) && !url.pathname.startsWith('/_emdash/')) {
    return new Response('Captura de solicitudes desactivada.', { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  const internalTypegen = url.origin === LOCAL_CMS_ORIGIN &&
    url.pathname === '/_emdash/api/typegen' && request.method === 'POST' &&
    request.headers.get('origin') === null;
  if (cms && !['GET', 'HEAD'].includes(request.method) &&
      request.headers.get('origin') !== LOCAL_CMS_ORIGIN && !internalTypegen) {
    return new Response('Origen no permitido.', { status: 403 });
  }
  if (url.pathname.startsWith('/blog') && (url.searchParams.has('_preview') || url.searchParams.has('_edit'))) {
    return new Response('Usa el panel editorial para revisar borradores.', { status: 403 });
  }
  const response = await next();
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  if (!cms) response.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://localhost:4321 ws://127.0.0.1:4321; frame-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'");
  return response;
});
