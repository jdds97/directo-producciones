import { existsSync } from 'node:fs';
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import { access, d1, r2 } from '@emdash-cms/cloudflare';
import { unstable_readConfig } from 'wrangler';
import blogCms from './config/blog-cms.mjs';
import { LOCAL_CMS_ORIGIN, LOCAL_REVIEW_PORT } from './config/local-review.mjs';

if (existsSync('.env')) process.loadEnvFile('.env');
if (process.env.LEADS_ENABLED === 'true' || process.env.ANALYTICS_ENABLED === 'true') {
  throw new Error('M2 local no autoriza activar leads ni analítica.');
}
// Medios subidos desde el CMS: R2 en todos los entornos (binding MEDIA; en preview/producción, bucket con jurisdicción UE declarada en
// wrangler.jsonc; decisión del propietario del 2026-11-05). Sin publicUrl: el Worker los sirve en /_emdash/api/media/file/<clave>, las mismas
// URLs que con KV. DP_MEDIA_STORAGE=kv es la palanca explícita de vuelta atrás al adaptador src/cms/storage/kv.ts (binding MEDIA_KV), que se
// retira cuando R2 esté verificado. Límite de 10 MiB por archivo en ambos casos (MEDIA_LIMITS de src/lib/editorial-policy.ts).
const appEnv = process.env.APP_ENV ?? 'local';
const mediaStorage = process.env.DP_MEDIA_STORAGE ?? 'r2';
if (!['r2', 'kv'].includes(mediaStorage)) throw new Error('DP_MEDIA_STORAGE inválido: solo r2 (por defecto) o kv (vuelta atrás).');
// Preview: el panel inicia sesión con Cloudflare Access (código por correo, sin passkey; pedido del usuario el 2026-11-04). La política
// de Access es la lista de quién entra; EmDash crea al usuario la primera vez (rol por defecto Autor 30) y un admin puede cambiarlo.
// Mismo equipo y AUD que wrangler.jsonc env.preview (única fuente, la misma que verifica la compuerta).
// Local y producción siguen con la autenticación nativa (passkeys, D-16). En producción el Worker exige además el JWT de Access en
// /_emdash/* (env-policy.ts) como capa previa a las passkeys; cambiar el modo de EmDash en producción es decisión del propietario.
const previewAccess = appEnv === 'preview' ? unstable_readConfig({ config: 'wrangler.jsonc', env: 'preview' }, { hideWarnings: true }).vars : null;
if (previewAccess && !(/\.cloudflareaccess\.com$/.test(previewAccess.ACCESS_TEAM_DOMAIN ?? '') && /^[0-9a-f]{64}$/.test(previewAccess.ACCESS_AUD ?? ''))) {
  throw new Error('Preview: ACCESS_TEAM_DOMAIN/ACCESS_AUD de wrangler.jsonc env.preview no válidos para el login del panel.');
}
const cms = blogCms({
  siteUrl: LOCAL_CMS_ORIGIN,
  database: d1({ binding: 'DB' }),
  storage: mediaStorage === 'kv' ? { entrypoint: '/src/cms/storage/kv.ts', config: { binding: 'MEDIA_KV' } } : r2({ binding: 'MEDIA' }),
  maxUploadSize: 40 * 1024 * 1024, // vídeo; el tope de imagen (10 MiB) lo aplica la política (editorial-policy MEDIA_LIMITS)
  ...(previewAccess ? { auth: access({ teamDomain: previewAccess.ACCESS_TEAM_DOMAIN, audience: previewAccess.ACCESS_AUD, defaultRole: 30 }) } : {}),
  // Local: EmDash migra al arrancar. Preview/producción: un único responsable, el job de despliegue
  // (`emdash migrate` + `wrangler d1 migrations apply`); el Worker solo comprueba y falla si hay pendientes.
  migrations: { runtime: (process.env.APP_ENV ?? 'local') === 'local' ? 'auto' : 'check', dev: 'auto' },
  admin: { logo: '/assets/m4/logo-original.jpg', siteName: 'Directo Producciones · Blog local', footerLabel: 'Directo Producciones', favicon: '/assets/m4/logo-original.jpg' },
  fonts: false, toolbar: false, mcp: false, registry: false, updateCheck: false, images: false,
});
export default defineConfig({
  site: 'https://directoproducciones.com',
  output: 'server',
  compressHTML: true,
  adapter: cloudflare({ imageService: 'passthrough' }),
  session: {
    driver: { entrypoint: new URL('./src/cms/d1-session-driver.ts', import.meta.url) },
    ttl: 60 * 60 * 24 * 7,
    cookie: { sameSite: 'lax', secure: process.env.APP_ENV !== 'local' },
  },
  server: { host: 'localhost', port: LOCAL_REVIEW_PORT },
  devToolbar: { enabled: false },
  vite: {
    build: { assetsInlineLimit: 0 },
    define: {
      'import.meta.env.EMDASH_SITE_URL': JSON.stringify(LOCAL_CMS_ORIGIN),
      // Entorno de compilación: el Worker se cierra si el entorno de ejecución (vars.APP_ENV) no coincide.
      'import.meta.env.DP_BUILD_ENV': JSON.stringify(process.env.APP_ENV ?? 'local'),
    },
  },
  integrations: [react(), cms],
});
