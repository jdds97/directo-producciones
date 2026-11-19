// Mecanismo ÚNICO de normalización de host y de redirecciones del Worker (no hay _redirects ni reglas de zona paralelas;
// en el corte, la zona solo hace HTTPS). La tabla es config/url-map.json: solo se aplican las filas y patrones con `aprobado_por`.
// Una fila sin aprobar (propuesta o pendiente) NUNCA redirige. Nada se envía a Inicio por defecto.
import urlMap from '../../config/url-map.json' with { type: 'json' };
import { PRODUCTION_ORIGIN, normalizePath, type Env } from './seo';

export interface UrlMapRow {
  url: string; path: string; tipo: string; alcance: string;
  accion: 'conservar-ruta' | 'redirigir' | 'retirar' | 'pendiente';
  estado: 'vigente' | 'propuesta' | 'decidida' | 'pendiente';
  destino?: string; codigo?: 301 | 410; nota: string; aprobado_por?: string; aprobado_el?: string;
}
export const urlMapRows = (urlMap as { rows: UrlMapRow[] }).rows;
export const urlMapPatterns = (urlMap as { patrones?: Partial<UrlMapRow>[] }).patrones ?? [];
const WWW_HOST = `www.${new URL(PRODUCTION_ORIGIN).hostname}`;
// Los patrones aprobados son rutas EXACTAS (/feed/, /sitemap_index.xml); no hay prefijos (/wp-content/uploads/ queda en 404 natural).
export const buildApproved = (all: Partial<UrlMapRow>[]) => new Map(all.filter(r => r.aprobado_por && r.aprobado_el && (r.accion === 'redirigir' || r.accion === 'retirar')).map(r => [normalizePath(r.path!), r as UrlMapRow]));
const approved = buildApproved([...urlMapRows, ...urlMapPatterns]);

export type RedirectResult = { status: 301; location: string } | { status: 410 } | null;
/** Solo en producción. www→apex y, si la ruta antigua tiene fila aprobada, redirección directa al destino final (un solo salto). */
export function resolveRedirect(url: URL, env: Env, rows = approved): RedirectResult {
  if (env !== 'production') return null;
  const path = normalizePath(url.pathname);
  const row = rows.get(path);
  if (row?.accion === 'retirar') return { status: 410 };
  if (row?.accion === 'redirigir' && row.destino) return { status: 301, location: `${PRODUCTION_ORIGIN}${row.destino}` };
  if (url.hostname === WWW_HOST) return { status: 301, location: `${PRODUCTION_ORIGIN}${url.pathname}${url.search}` };
  return null;
}

/** X-Robots-Tag por entorno (el HTML lleva además su <meta robots> desde lib/seo.ts). */
export function robotsHeader(env: Env, pathname: string): string | null {
  if (env !== 'production') return 'noindex, nofollow';
  return /^\/(?:_emdash\/(?:admin|api\/(?!media\/))|api\/|interno\/)/.test(pathname) ? 'noindex, nofollow' : null;
}
