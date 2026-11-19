// Política de acceso por entorno: función pura (sin Astro ni cloudflare:workers) para poder probarla con node:test.
// Cierre por defecto en cada entorno remoto. Una sola fuente para el Worker (local-gate), el guard y launch:readiness.
//  - local:      solo loopback (comportamiento histórico).
//  - preview:    origen https exacto + Cloudflare Access verificado en el Worker (JWT firmado, iss y aud). Sin config = cerrado.
//  - production: hosts del dominio + hito de lanzamiento de config/launch.json completo. Sin hito = cerrado (503). El panel (/_emdash/*)
//                exige SIEMPRE el JWT de la app de Access de producción, antes y después del corte (salvo los medios públicos tras activar).
//                D-62: con closedDeploy=true y activated=false se compila y despliega igualmente cerrado (closedDeployBlockers).
// Referencia oficial: developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
export type Env = 'local' | 'preview' | 'production';

export const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
export const PRODUCTION_HOSTS = ['directoproducciones.com', 'www.directoproducciones.com'];
export const TEAM_DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/;
export const AUD_RE = /^[0-9a-f]{64}$/;

export interface LaunchState { activated: boolean; closedDeploy?: boolean; checklist: Record<string, boolean>; previewChecklist?: Record<string, boolean> }

/** Bloqueos del corte público. Los usa el Worker (cierra en 503), el guard y launch:readiness. */
export function launchBlockers(launch: LaunchState): string[] {
  const out = Object.entries(launch.checklist).filter(([, done]) => done !== true).map(([item]) => `config/launch.json: «${item}» sin confirmar.`);
  if (launch.activated !== true) out.push('config/launch.json: activated=false (el propietario lo activa al aprobar el corte).');
  return out;
}
/** Bloqueos de la preview protegida: no exige el corte público, sí almacenamiento de medios resuelto. */
export function previewBlockers(launch: LaunchState): string[] {
  return Object.entries(launch.previewChecklist ?? { storageReady: false }).filter(([, done]) => done !== true).map(([item]) => `config/launch.json previewChecklist: «${item}» sin confirmar.`);
}

export interface AccessVars { ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string }
export interface AccessConfig { teamDomain: string; aud: string }
/** Config explícita y bien formada, o null. Una cadena vacía o un placeholder NO cuenta como configuración. */
export function accessConfig(vars: AccessVars): AccessConfig | null {
  const teamDomain = (vars.ACCESS_TEAM_DOMAIN ?? '').trim().toLowerCase();
  const aud = (vars.ACCESS_AUD ?? '').trim().toLowerCase();
  return TEAM_DOMAIN_RE.test(teamDomain) && AUD_RE.test(aud) ? { teamDomain, aud } : null;
}

// ── Verificación del JWT de Access (RS256) con WebCrypto, válida en workerd y en Node ──────────────
type Jwk = JsonWebKey & { kid?: string };
export type JwksFetcher = (teamDomain: string) => Promise<{ keys: Jwk[] }>;
const b64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
const json = (s: string) => JSON.parse(new TextDecoder().decode(b64(s)));

const jwksCache = new Map<string, { at: number; keys: Jwk[] }>();
const JWKS_TTL_MS = 10 * 60_000;
const JWKS_MIN_REFRESH_MS = 60_000;
/** Descarga de claves públicas (el endpoint es público, no lleva credenciales). Tiempo máximo 3 s. */
export const fetchAccessJwks: JwksFetcher = async (teamDomain) => {
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`JWKS ${res.status}`);
  return res.json() as Promise<{ keys: Jwk[] }>;
};
async function keyFor(cfg: AccessConfig, kid: string, fetcher: JwksFetcher, now: number): Promise<Jwk | undefined> {
  const hit = jwksCache.get(cfg.teamDomain);
  const found = hit?.keys.find((k) => k.kid === kid);
  if (found && now - hit!.at < JWKS_TTL_MS) return found;
  // Rotación (cada 6 semanas): si el kid no está, refrescar como mucho una vez por minuto.
  if (hit && now - hit.at < JWKS_MIN_REFRESH_MS) return found;
  const fresh = await fetcher(cfg.teamDomain);
  jwksCache.set(cfg.teamDomain, { at: now, keys: fresh.keys ?? [] });
  return (fresh.keys ?? []).find((k) => k.kid === kid);
}
export const clearAccessCache = () => jwksCache.clear();

/** true solo con firma válida (claves de Access), iss = equipo, aud = aplicación y vigencia. Cualquier error = false. */
export async function verifyAccessJwt(token: string | null | undefined, cfg: AccessConfig, fetcher: JwksFetcher = fetchAccessJwks, nowMs = Date.now()): Promise<boolean> {
  try {
    if (!token || token.length > 8192) return false;
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const header = json(parts[0]);
    const payload = json(parts[1]);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') return false;
    const now = Math.floor(nowMs / 1000);
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (payload.iss !== `https://${cfg.teamDomain}` || !aud.includes(cfg.aud)) return false;
    if (typeof payload.exp !== 'number' || payload.exp + 30 < now) return false;
    if (payload.nbf !== undefined && (typeof payload.nbf !== 'number' || payload.nbf - 30 > now)) return false;
    const jwk = await keyFor(cfg, header.kid, fetcher, nowMs);
    if (!jwk || jwk.kty !== 'RSA') return false;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  } catch { return false; }
}

// ── Ruta canónica (única para la compuerta y la caché de HTML) ───────────────────────────────────────
/** Ruta tal como la enruta Astro 7 (FetchState/matchRequest: decodeURI repetido y barras repetidas colapsadas; el parser URL de workerd
 *  y Node ya convirtió `\` en `/` y resolvió `..`/`%2e%2e`). null = 400: codificación inválida (`%zz`, `%` suelto), anidada más de 10
 *  veces, o variantes en las que el router y context.url verían rutas distintas (`%5C`, `%252e%252e`, `%09`): un navegador no las envía.
 *  `%2F` sigue codificado, como en Astro (no separa segmentos ni enruta al panel). */
export function canonicalPath(pathname: string): string | null {
  try {
    let path = pathname;
    for (let i = 0; decodeURI(path) !== path; i++) {
      if (i === 10) return null;
      path = decodeURI(path);
    }
    path = path.replace(/\/{2,}/g, '/');
    const probe = new URL('http://n');
    probe.pathname = path;
    return decodeURI(probe.pathname) === path ? path : null;
  } catch { return null; }
}
// Panel de EmDash. Más amplio que el router (también mayúsculas y %2F tras el prefijo): como mucho exige el JWT de más, nunca de menos.
export const PANEL_RE = /^\/_emdash(?:\/|%2f|$)/i;

// ── Decisión por petición ────────────────────────────────────────────────────────────────────────────
export interface GateInput {
  env: Env;
  /** vars.APP_ENV del Worker en ejecución. Si no coincide con el entorno compilado, el Worker se cierra (en remoto es obligatorio). */
  runtimeEnv?: string;
  url: URL;
  /** Origen https exacto del entorno (EMDASH_SITE_URL validado al compilar). */
  expectedOrigin: string;
  prerendered: boolean;
  accessToken?: string | null;
  /** Cabecera Cookie. Solo producción la usa: CF_Authorization lleva el mismo JWT en rutas que Access no cubre (estáticos del panel). */
  cookie?: string | null;
  vars: AccessVars;
  launch: LaunchState;
  fetchJwks?: JwksFetcher;
  now?: number;
}
export type Decision = { ok: true; access: boolean } | { ok: false; status: 400 | 403 | 404 | 503; message: string; reason: string };
const deny = (status: 400 | 403 | 404 | 503, message: string, reason: string): Decision => ({ ok: false, status, message, reason });

export async function decideRequest(i: GateInput): Promise<Decision> {
  // El prerenderizado ocurre al compilar, no recibe tráfico.
  if (i.prerendered) return { ok: true, access: false };
  if ((i.env !== 'local' || i.runtimeEnv !== undefined) && i.runtimeEnv !== i.env) return deny(503, 'Entorno incoherente: la compilación no corresponde a este despliegue.', 'build-env-mismatch');
  // Todas las decisiones por ruta usan la misma ruta que enruta Astro: /%5Femdash/ o //_emdash/ son el panel también aquí.
  const path = canonicalPath(i.url.pathname);
  if (path === null) return deny(400, 'Ruta no válida.', 'ruta-no-canonica');
  if (i.env === 'local') {
    return LOOPBACK_HOSTS.includes(i.url.hostname) ? { ok: true, access: false } : deny(403, 'Baseline disponible exclusivamente en local.', 'host-no-local');
  }
  if (i.env === 'preview') {
    // Host exacto (nombre + sin puerto): excluye URLs alternativas (versiones, aliases, otros hosts) aunque Access las cubra. El esquema no se
    // compara: workerd detrás del proxy https de `wrangler dev` ve http y workers.dev/zona solo sirven https; la identidad la da el JWT.
    if (i.url.host !== new URL(i.expectedOrigin).host) return deny(403, 'Host no permitido.', 'origen-no-exacto');
    const cfg = accessConfig(i.vars);
    if (!cfg) return deny(503, 'Preview cerrada: protección de acceso sin configurar.', 'access-sin-configurar');
    if (!(await verifyAccessJwt(i.accessToken, cfg, i.fetchJwks, i.now))) return deny(403, 'Acceso no autorizado.', 'access-jwt-invalido');
    return path.startsWith('/interno/') ? deny(404, 'No encontrado', 'interno-fuera-de-local') : { ok: true, access: true };
  }
  if (!PRODUCTION_HOSTS.includes(i.url.hostname) || i.url.port) return deny(403, 'Host no permitido.', 'host-no-produccion');
  const launched = launchBlockers(i.launch).length === 0;
  const token = i.accessToken || /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(i.cookie ?? '')?.[1];
  // Panel: solo con Access de producción verificado, como capa previa a las passkeys de EmDash, también antes del corte (asistente y
  // alta del primer administrador con passkey, carga de contenido) con el resto en 503. Sin config válida, cerrado: el asistente nunca
  // queda abierto. Los medios del blog (MEDIA_ROUTE de src/lib/media.ts) son públicos solo con el sitio activado.
  if (PANEL_RE.test(path) && !(launched && path.startsWith('/_emdash/api/media/file/'))) {
    const cfg = accessConfig(i.vars);
    if (!cfg) return deny(503, 'Panel no disponible: protección de acceso sin configurar.', 'access-sin-configurar');
    return (await verifyAccessJwt(token, cfg, i.fetchJwks, i.now)) ? { ok: true, access: true } : deny(403, 'Acceso no autorizado.', 'access-jwt-invalido');
  }
  if (!launched) {
    // Antes del corte, los estáticos que carga el panel (CSS/JS de /_astro, logo de /assets) solo para quien ya entró por Access.
    const cfg = /^\/(?:_astro|assets)\//.test(path) ? accessConfig(i.vars) : null;
    return cfg && (await verifyAccessJwt(token, cfg, i.fetchJwks, i.now)) ? { ok: true, access: true } : deny(503, 'Sitio no disponible.', 'lanzamiento-no-activado');
  }
  return path.startsWith('/interno/') ? deny(404, 'No encontrado', 'interno-fuera-de-local') : { ok: true, access: false };
}

/** Condiciones de renderizado de páginas (defensa en profundidad dentro de Base.astro). Lista vacía = se puede renderizar. */
export function renderBlockers(env: Env, ctx: { accessVerified: boolean; launch: LaunchState }): string[] {
  if (env === 'local') return [];
  if (env === 'preview') return ctx.accessVerified ? [] : ['preview sin acceso verificado por Cloudflare Access'];
  return launchBlockers(ctx.launch);
}

/** Protección de la preview que debe existir en la configuración del Worker (no basta una cabecera declarativa). Lista vacía = protegida. */
export function previewProtectionBlockers(cfg: { vars?: Record<string, unknown>; assets?: { run_worker_first?: unknown } | null }): string[] {
  const out: string[] = [];
  if (cfg.vars?.APP_ENV !== 'preview') out.push('wrangler env.preview: vars.APP_ENV debe ser «preview» (el Worker compara entorno compilado y de ejecución).');
  if (!accessConfig({ ACCESS_TEAM_DOMAIN: String(cfg.vars?.ACCESS_TEAM_DOMAIN ?? ''), ACCESS_AUD: String(cfg.vars?.ACCESS_AUD ?? '') })) out.push('wrangler env.preview: ACCESS_TEAM_DOMAIN (<equipo>.cloudflareaccess.com) y ACCESS_AUD (64 hex) válidos; los vacíos o placeholders no cuentan.');
  if (cfg.assets?.run_worker_first !== true) out.push('wrangler env.preview: assets.run_worker_first=true (sin él HTML estático, medios y /_astro saltan la compuerta).');
  return out;
}

/** Access del panel de producción: app propia con equipo y AUD válidos, distinta de la de la preview (con su AUD, cualquiera de la política
 *  de preview entraría en el panel de producción). La usan launch:readiness y el modo cerrado. Lista vacía = configurada. */
export function productionAccessBlockers(prodVars?: Record<string, unknown>, previewVars?: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (!accessConfig({ ACCESS_TEAM_DOMAIN: String(prodVars?.ACCESS_TEAM_DOMAIN ?? ''), ACCESS_AUD: String(prodVars?.ACCESS_AUD ?? '') })) out.push('wrangler.jsonc env.production: ACCESS_TEAM_DOMAIN/ACCESS_AUD de la app de Access del panel (/_emdash/*) sin rellenar o no válidos.');
  const audOf = (vars?: Record<string, unknown>) => String(vars?.ACCESS_AUD ?? '').trim().toLowerCase();
  if (audOf(prodVars) && audOf(prodVars) === audOf(previewVars)) out.push('wrangler.jsonc env.production: ACCESS_AUD es la de la app de la preview; usa la AUD de la app de Access del panel de producción.');
  return out;
}

/** D-62 · modo cerrado: config/launch.json con closedDeploy=true (solo por PR del propietario) y el lanzamiento sin activar. */
export const isClosedDeploy = (launch: LaunchState) => launch.closedDeploy === true && launch.activated !== true;

export type WorkerConfig = { vars?: Record<string, unknown>; assets?: { run_worker_first?: unknown } | null };
/** Requisitos para compilar y desplegar producción en modo cerrado (sin los bloqueos del corte). Lista vacía = la fase cerrada es segura:
 *  panel tras su app de Access, todo por la compuerta, leads y analítica apagados y el público en 503 por decideRequest. */
export async function closedDeployBlockers(launch: LaunchState, prod: WorkerConfig, preview: WorkerConfig, flags: { LEADS_ENABLED: boolean; ANALYTICS_ENABLED: boolean }): Promise<string[]> {
  if (!isClosedDeploy(launch)) return ['config/launch.json: el modo cerrado exige closedDeploy=true y activated=false.'];
  const out = productionAccessBlockers(prod.vars, preview.vars);
  if (prod.vars?.APP_ENV !== 'production') out.push('wrangler.jsonc env.production: vars.APP_ENV debe ser «production».');
  if (prod.assets?.run_worker_first !== true) out.push('wrangler.jsonc env.production: assets.run_worker_first=true en la fase cerrada (la compuerta debe ver HTML, medios y estáticos).');
  if (flags.LEADS_ENABLED || flags.ANALYTICS_ENABLED) out.push('src/config/flags.ts: LEADS_ENABLED y ANALYTICS_ENABLED deben seguir apagados en la fase cerrada.');
  const origin = `https://${PRODUCTION_HOSTS[0]}`;
  const vars = { ACCESS_TEAM_DOMAIN: String(prod.vars?.ACCESS_TEAM_DOMAIN ?? ''), ACCESS_AUD: String(prod.vars?.ACCESS_AUD ?? '') };
  for (const path of ['/', '/assets/m4/logo-original.jpg']) {
    const d = await decideRequest({ env: 'production', runtimeEnv: 'production', url: new URL(path, origin), expectedOrigin: origin, prerendered: false, vars, launch });
    if (d.ok || d.status !== 503) out.push(`src/config/env-policy.ts: en la fase cerrada ${path} sin Access debe responder 503 (responde ${d.ok ? 200 : d.status}).`);
  }
  return out;
}

/** Respuesta de cierre común al Worker y al middleware. Preview/local llevan noindex; producción no (se cierra sin tocar indexación). */
export function denyResponse(d: Extract<Decision, { ok: false }>, env: Env): Response {
  return new Response(d.message, { status: d.status, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8', ...(env !== 'production' ? { 'X-Robots-Tag': 'noindex, nofollow' } : {}) } });
}
