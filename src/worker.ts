import handler, { createScheduledHandler, PluginBridge } from '@emdash-cms/cloudflare/worker';
import { APP_ENV } from './config/flags';
import { approvedFact } from './lib/facts';
import type { ExecutionContext, ScheduledController } from '@cloudflare/workers-types';
import { resolveContact, retryPending, type ContactEnv, type D1Like } from './lib/contact-delivery';
import { contactDb } from './lib/contact-db';
import { decideRequest, denyResponse, type AccessVars } from './config/env-policy';
import { LOCAL_CMS_ORIGIN } from './config/local-origin';
import { cachedHtml } from './lib/html-cache';
import launch from '../config/launch.json' with { type: 'json' };

export { PluginBridge };

const emdashScheduled = createScheduledHandler();

// Compuerta de entrada de los entornos REMOTOS: va antes de Astro y del servidor de estáticos, de modo que HTML, medios, /_astro y
// cualquier URL alternativa pasan por ella (con `assets.run_worker_first`, Astro aún sirve ciertos estáticos sin ejecutar su middleware).
// Excepción: en producción, tras el corte, wrangler.jsonc puede dejar /_astro, /assets y page-transition.js a Static Assets.
// Local no se toca: conserva su compuerta de middleware (local-gate.ts).
async function remoteGate(request: Request, env: AccessVars & { APP_ENV?: string }): Promise<Response | null> {
  if (APP_ENV === 'local') return null;
  const decision = await decideRequest({
    env: APP_ENV as 'preview' | 'production', runtimeEnv: env.APP_ENV, url: new URL(request.url), expectedOrigin: LOCAL_CMS_ORIGIN,
    prerendered: false, accessToken: request.headers.get('Cf-Access-Jwt-Assertion'), cookie: request.headers.get('Cookie'), vars: env, launch,
  });
  return decision.ok ? null : denyResponse(decision, APP_ENV as 'preview' | 'production');
}

export default {
  ...handler,
  async fetch(request: Request, env: never, ctx: ExecutionContext) {
    const denied = await remoteGate(request, env);
    if (denied) return denied;
    const render = () => (handler.fetch as (r: Request, e: never, c: ExecutionContext) => Promise<Response>)(request, env, ctx);
    // Producción: HTML anónimo desde la Cache API (src/lib/html-cache.ts). Preview y local, siempre render (sin caché).
    if (APP_ENV !== 'production') return render();
    const version = (env as { CF_VERSION_METADATA?: { id?: string } }).CF_VERSION_METADATA?.id;
    return cachedHtml(request, version, (task) => ctx.waitUntil(task), render);
  },
  // Cron único: tareas de EmDash y, solo con CONTACT_PERSISTENCE=on, reintento/purga de consultas.
  async scheduled(controller: ScheduledController, env: ContactEnv & { DB: D1Like; CONTACT_DB?: D1Like }, ctx: ExecutionContext) {
    await emdashScheduled(controller, env as never, ctx);
    const to = approvedFact('contact.form_recipient_email')?.value;
    if (to) await retryPending(resolveContact(env, APP_ENV), { db: contactDb(env, APP_ENV) }, to).catch((e) => console.error('contacto: cron', (e as Error).name));
  },
};
