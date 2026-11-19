import type { D1Like } from './contact-delivery';

// D-25: las solicitudes viven en CONTACT_DB (D1 propia). Solo en local, sin ese binding, se reutiliza DB (la persistencia local de pruebas).
// En preview/producción nunca hay respaldo: sin CONTACT_DB no hay persistencia (queda undefined) en lugar de escribir en la base del CMS.
export function contactDb(env: { DB?: D1Like; CONTACT_DB?: D1Like }, appEnv: string): D1Like | undefined {
  return env.CONTACT_DB ?? (appEnv === 'local' ? env.DB : undefined);
}
