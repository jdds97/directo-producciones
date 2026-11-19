import { defineMiddleware } from 'astro:middleware';
import { isCmsPath, isPanelPath } from './scope.ts';
import { MEDIA_ROUTE } from '../lib/media';
import { siteLinks } from '../lib/site-navigation';
import { panelWriteDenied } from '../lib/editorial-policy';

import { LOCAL_CMS_ORIGIN } from '../config/local-origin';
import { APP_ENV } from '../config/flags';
import { decideRequest, denyResponse, launchBlockers, type AccessVars } from '../config/env-policy';
import launch from '../../config/launch.json' with { type: 'json' };
// Compuerta ÚNICA de entorno (nombre histórico). local = solo loopback; preview = origen exacto + Access verificado;
// producción = dominio + hito de lanzamiento, y /_emdash/* siempre con Access de producción verificado. Las reglas de abajo (APIs auxiliares, escrituras, origen CMS) valen para los tres.
const developmentConnections = APP_ENV === 'local' ? `${LOCAL_CMS_ORIGIN.replace('http:', 'ws:')} ${LOCAL_CMS_ORIGIN.replace('http:', 'ws:').replace('localhost', '127.0.0.1')}` : '';
// Única captura pública autorizada: el formulario de contacto por correo.
const CONTACT_ENDPOINT = '/api/contacto';
const formPages = new Set(['/', '/contacto/']);
const allowedRoot = new Set([
  '/', '/streaming/', '/comunicacion-marketing/', '/contacto/', '/servicios/', '/clientes/',
  '/quienes-somos/', '/cookies/', '/privacidad/', '/aviso-legal/', '/interno/guia/',
  '/interno/articulo/', '/404', '/404/', '/robots.txt', '/sitemap.xml', '/rss.xml', '/llms.txt', CONTACT_ENDPOINT,
  ...siteLinks.flatMap((link) => [link.href, ...(link.relatedPaths ?? [])]),
]);

export const onRequest = defineMiddleware(async (context, next) => {
  const { url, request } = context;
  // Prerendering is internal; browser requests must pass the gate of their environment (loopback / Access / launch).
  let accessVars: AccessVars = {};
  if (APP_ENV !== 'local' && !context.isPrerendered) {
    const { env } = await import('cloudflare:workers');
    accessVars = env as unknown as AccessVars;
  }
  // URL cruda (no context.url, que Astro ya decodificó): decideRequest la canoniza igual que el Worker y responde 400 a las variantes
  // ambiguas (`%5C`, `%252e%252e`) también en local, donde no hay compuerta de Worker.
  const decision = await decideRequest({
    env: APP_ENV as 'local' | 'preview' | 'production', runtimeEnv: (accessVars as { APP_ENV?: string }).APP_ENV, url: new URL(request.url), expectedOrigin: LOCAL_CMS_ORIGIN,
    prerendered: context.isPrerendered, accessToken: request.headers.get('Cf-Access-Jwt-Assertion'), cookie: request.headers.get('Cookie'), vars: accessVars, launch,
  });
  if (!decision.ok) return decision.status === 403 && APP_ENV === 'local' ? new Response(decision.message, { status: 403 }) : denyResponse(decision, APP_ENV as 'local' | 'preview' | 'production');
  context.locals.dpAccessVerified = decision.access;
  if (isCmsPath(url.pathname) && url.origin !== LOCAL_CMS_ORIGIN) {
    return context.redirect(`${LOCAL_CMS_ORIGIN}${url.pathname}${url.search}`, 307);
  }
  // Disable auxiliary public APIs injected by EmDash, signup and integrations.
  const cms = isCmsPath(url.pathname);
  if (!cms && !allowedRoot.has(url.pathname) && !url.pathname.startsWith('/_astro/') && !url.pathname.startsWith('/@') && !url.pathname.startsWith('/src/') && !url.pathname.startsWith('/node_modules/') && /^\/(?:api|sitemap|feed|rss|search|wp-|llms|_image)/.test(url.pathname)) {
    return new Response('No encontrado', { status: 404, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
  }
  const ownPluginRoute = url.pathname === '/_emdash/api/plugins/dp-editorial-policy/admin';
  if (url.pathname.startsWith('/_emdash/') && !ownPluginRoute && /\/(signup|comments|plugins|registry|marketplace|mcp|import|export|transfer|ai|oauth|cron|dev-bypass|dev-reset)(\/|$)/i.test(url.pathname)) {
    return new Response('Función fuera del alcance local aprobado.', { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  // Estructura fuera del panel para TODOS los roles (también administración): esquema, ajustes, menús, widgets, secciones,
  // firmas, redirecciones, definiciones de taxonomía, duplicar/crear/borrar páginas. Los términos del blog siguen en write-guard.ts.
  const structural = panelWriteDenied(request.method, url.pathname);
  if (structural) return new Response(JSON.stringify({ success: false, error: { code: 'EDITORIAL_GUARD', message: structural } }), { status: 403, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  if (!['GET', 'HEAD'].includes(request.method) && !url.pathname.startsWith('/_emdash/') && !(request.method === 'POST' && url.pathname === CONTACT_ENDPOINT)) {
    return new Response('Captura de solicitudes desactivada.', { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  const internalTypegen = url.origin === LOCAL_CMS_ORIGIN &&
    url.pathname === '/_emdash/api/typegen' && request.method === 'POST' &&
    request.headers.get('origin') === null;
  if (cms && !['GET', 'HEAD'].includes(request.method) &&
      request.headers.get('origin') !== LOCAL_CMS_ORIGIN && !internalTypegen) {
    return new Response('Origen no permitido.', { status: 403 });
  }
  if ((url.pathname.startsWith('/blog') || url.pathname.startsWith('/interno/m3/blog')) && (url.searchParams.has('_preview') || url.searchParams.has('_edit'))) {
    return new Response('Usa el panel editorial para revisar borradores.', { status: 403 });
  }
  const response = await next();
  // Producción indexable: robots lo decide middleware.ts. Sin caché solo el panel y sus APIs; los medios conservan la política de EmDash
  // solo tras el corte (antes exigen Access y sirven borradores: no-store), y el blog es HTML público como el resto (caché de src/worker.ts).
  // Local y preview, siempre sin caché.
  const panel = isPanelPath(url.pathname);
  if (APP_ENV !== 'production') {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    response.headers.set('Cache-Control', 'no-store');
  } else if (panel && (!url.pathname.startsWith(MEDIA_ROUTE) || launchBlockers(launch).length > 0)) response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  // CSP del sitio también en el blog; el panel y los medios llevan la suya (EmDash).
  if (!panel) response.headers.set('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'${developmentConnections ? ` ${developmentConnections}` : ''}; frame-src 'none'; form-action ${formPages.has(url.pathname) ? "'self'" : "'none'"}; base-uri 'none'; object-src 'none'`);
  return response;
});
