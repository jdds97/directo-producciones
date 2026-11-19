// Entorno AUTORITATIVO = el de la compilación (DP_BUILD_ENV, fijado en astro.config.mjs). En workerd `process.env` está vacío al evaluar el módulo
// y `import.meta.env.APP_ENV` puede venir de un `.env` local, así que un bundle remoto nunca debe deducir su entorno de ahí.
// Los scripts de Node (tsx) no tienen DP_BUILD_ENV y usan process.env.
const BUILD_ENV = typeof import.meta.env === 'object' ? (import.meta.env as Record<string, string | undefined>).DP_BUILD_ENV : undefined;
export const APP_ENV = (BUILD_ENV ?? process.env.APP_ENV ?? 'local') as 'local' | 'preview' | 'production';
if (!['local', 'preview', 'production'].includes(APP_ENV)) throw new Error('APP_ENV inválido');
for (const flag of ['LEADS_ENABLED', 'ANALYTICS_ENABLED']) {
  if ((process.env[flag] ?? import.meta.env?.[flag]) === 'true') {
    throw new Error(`${flag} está bloqueado en M2 local`);
  }
}
export const LEADS_ENABLED = false;
export const ANALYTICS_ENABLED = false;
// ID de medición GA4 (no es secreto). Vacío hasta que el propietario cree/confirme la propiedad; con ANALYTICS_ENABLED=false no se emite nada.
export const GA4_MEASUREMENT_ID = '';
export const CANONICAL_ORIGIN = 'https://directoproducciones.com';
