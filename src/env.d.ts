declare module 'cloudflare:workers' {
  export const env: {
    DB: import('./lib/contact-delivery').D1Like;
    // Bucket R2 de medios (r2({ binding: 'MEDIA' })); ausente con DP_MEDIA_STORAGE=kv. Solo lo usa la entrega de vídeo con Range.
    MEDIA?: import('./cms/media-range').R2BucketLike;
    // D1 de solicitudes (D-25), separada de la del CMS. Solo en local se admite el respaldo a DB.
    CONTACT_DB?: import('./lib/contact-delivery').D1Like;
    // Cloudflare Access (variables NO secretas del Worker): dominio del equipo y AUD de la aplicación. Vacías = preview cerrada; en producción, panel cerrado.
    ACCESS_TEAM_DOMAIN?: string;
    ACCESS_AUD?: string;
    // Binding `send_email` de Cloudflare Email Sending, restringido en wrangler.jsonc a un remitente y un destinatario. Sin clave ni secreto.
    CONTACT_EMAIL?: import('./lib/contact-delivery').EmailBinding;
    // Remitente del subdominio de avisos dado de alta en Email Sending (variable no secreta).
    CONTACT_FROM?: string;
    // Solo local: `binding` usa CONTACT_EMAIL, que `wrangler dev` simula sin enviar (guarda el correo en .wrangler/tmp/email).
    CONTACT_TRANSPORT?: string;
    // `on` guarda las consultas en D1 con reintento. Hoy solo en local y con datos sintéticos.
    CONTACT_PERSISTENCE?: string;
    // Binding opcional de Workers Rate Limiting (wrangler.jsonc `ratelimits`).
    CONTACT_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
    // Solo pruebas locales: ids sintéticos de aprobador (fixture.env); se ignora fuera de APP_ENV=local.
    DP_SYNTHETIC_PUBLISHERS?: string;
  };
}

declare namespace App {
  interface Locals {
    /** true solo si local-gate verificó el JWT de Cloudflare Access de esta petición (preview; en producción, el panel). */
    dpAccessVerified?: boolean;
  }
}
interface ImportMetaEnv { readonly DP_BUILD_ENV?: string }
