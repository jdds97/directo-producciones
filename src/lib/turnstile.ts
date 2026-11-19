// Cloudflare Turnstile en el formulario de contacto: verificación en el servidor (siteverify) antes de entregar la consulta.
// Activo solo si el entorno declara TURNSTILE_SITEKEY (wrangler.jsonc); entonces se exige token y se falla en cerrado.
// TURNSTILE_SECRET es un secreto del Worker; TURNSTILE_HOSTNAMES, los hostnames del formulario en ese despliegue.
export const TURNSTILE_ACTION = 'contacto';
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export interface TurnstileEnv { TURNSTILE_SITEKEY?: string; TURNSTILE_SECRET?: string; TURNSTILE_HOSTNAMES?: string }

export const turnstileEnabled = (env: TurnstileEnv) => Boolean(env.TURNSTILE_SITEKEY?.trim());

export async function verifyTurnstile(env: TurnstileEnv, token: unknown, ip: string | null, doFetch: typeof fetch = fetch): Promise<boolean> {
  const hostnames = new Set((env.TURNSTILE_HOSTNAMES ?? '').split(',').map((h) => h.trim()).filter(Boolean));
  if (typeof token !== 'string' || !token || token.length > 2048 || !env.TURNSTILE_SECRET || hostnames.size === 0) return false;
  try {
    const response = await doFetch(SITEVERIFY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, ...(ip ? { remoteip: ip } : {}) }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return false;
    const result = (await response.json()) as { success?: boolean; action?: string; hostname?: string };
    return result.success === true && result.action === TURNSTILE_ACTION && hostnames.has(result.hostname ?? '');
  } catch {
    return false; // red, tiempo o respuesta no JSON: en cerrado
  }
}
