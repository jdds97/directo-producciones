// Caché de HTML de producción con la Cache API del Worker (caches.default: por centro de datos y solo en el dominio propio; en workers.dev
// no guarda nada). Va detrás de la compuerta de src/worker.ts y un acierto no entra en Astro ni en EmDash (ni D1 ni render).
// Se evaluó antes la caché de rutas de Astro con el proveedor de @astrojs/cloudflare (purga por etiquetas al publicar desde EmDash): depende
// de la caché de Workers (`cache.enabled` en wrangler), que miniflare no emula y cuyos aciertos no pasan por la compuerta; queda como mejora.
// Solo GET anónimos (sin Authorization ni más cookies que las propias de Cloudflare) y sin consulta, con ruta canónica (canonicalPath de
// src/config/env-policy.ts, la misma de la compuerta), fuera del panel y las API. Solo se guardan 200 HTML sin Set-Cookie ni
// Cache-Control private/no-store/no-cache (la vista previa y la barra de edición de EmDash llevan «private, no-store»). La clave lleva la
// versión del Worker (CF_VERSION_METADATA): tras desplegar no se sirve HTML que apunte a /_astro antiguos; sin versión, no se cachea.
// Retraso máximo de una publicación para visitantes anónimos: unos 5 min y medio por centro de datos (HTML_TTL + los 30 s de la caché en
// memoria de src/lib/site-content.ts en un isolate que aún no la invalidó). Con cookie de sesión (panel) siempre se ve lo último.
// ponytail: solo se ignoran las cookies de Cloudflare de CF_COOKIE; si se activa GA4 (cookies _ga*), añadirlas allí (tampoco cambian el HTML).
import { canonicalPath, PANEL_RE } from '../config/env-policy';

export const HTML_TTL = 300;
// Cookies propias de Cloudflare (Bot Fight Mode, desafíos, rate limiting, balanceo): no cambian el HTML. Lista cerrada; cualquier otra
// (sesión de Astro/EmDash, CF_Authorization, desconocidas) o un valor fuera de cookie-octet (RFC 6265: sin espacios, comas ni comillas) salta la caché.
const CF_COOKIE = /^(?:__cf_bm|cf_clearance|_cfuvid|__cflb|__cfruid)=[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*$/;

export interface HtmlCache {
  match(key: Request): Promise<Response | undefined>;
  put(key: Request, response: Response): Promise<void>;
}

export function htmlCacheKey(request: Request, version: string | undefined): Request | null {
  const url = new URL(request.url);
  const cookie = request.headers.get('Cookie');
  if (!version || request.method !== 'GET' || url.search || request.headers.has('Authorization')) return null;
  if (cookie !== null && !cookie.split(';').every((c) => CF_COOKIE.test(c.trim()))) return null;
  // Variantes no canónicas (/%62log/, //blog/, …) renderizan sin caché: ni fragmentan la clave ni la envenenan.
  if (canonicalPath(url.pathname) !== url.pathname || PANEL_RE.test(url.pathname) || /^\/api(?:\/|$)/i.test(url.pathname)) return null;
  return new Request(`${url.origin}${url.pathname}?v=${encodeURIComponent(version)}`);
}

export function storableHtml(response: Response): boolean {
  return response.status === 200 && (response.headers.get('Content-Type') ?? '').startsWith('text/html') &&
    !response.headers.has('Set-Cookie') && !/no-store|no-cache|private/i.test(response.headers.get('Cache-Control') ?? '');
}

export async function cachedHtml(request: Request, version: string | undefined, waitUntil: (task: Promise<unknown>) => void, render: () => Promise<Response>, cache?: HtmlCache): Promise<Response> {
  const key = htmlCacheKey(request, version);
  if (!key) return render();
  const store = cache ?? (globalThis as unknown as { caches: { default: HtmlCache } }).caches.default;
  const hit = await store.match(key);
  if (hit) return hit;
  const response = await render();
  if (!storableHtml(response)) return response;
  // s-maxage = caché del borde; el navegador revalida siempre (max-age=0), así el retraso no se suma al de su propia caché.
  const out = new Response(response.body, response);
  out.headers.set('Cache-Control', `public, max-age=0, s-maxage=${HTML_TTL}`);
  waitUntil(store.put(key, out.clone()).catch(() => undefined));
  return out;
}
