export const APP_ENV = process.env.APP_ENV ?? import.meta.env?.APP_ENV ?? 'local';
if (!['local', 'preview', 'production'].includes(APP_ENV)) throw new Error('APP_ENV inválido');
for (const flag of ['LEADS_ENABLED', 'ANALYTICS_ENABLED']) {
  if ((process.env[flag] ?? import.meta.env?.[flag]) === 'true') {
    throw new Error(`${flag} está bloqueado en M2 local`);
  }
}
export const LEADS_ENABLED = false;
export const ANALYTICS_ENABLED = false;
export const CANONICAL_ORIGIN = 'https://directoproducciones.com';
