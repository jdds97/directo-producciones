import { existsSync } from 'node:fs';
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import { d1, r2 } from '@emdash-cms/cloudflare';
import blogCms from './config/blog-cms.mjs';

if (existsSync('.env')) process.loadEnvFile('.env');
if (process.env.LEADS_ENABLED === 'true' || process.env.ANALYTICS_ENABLED === 'true') {
  throw new Error('M2 local no autoriza activar leads ni analítica.');
}
const cms = blogCms({
  siteUrl: 'http://localhost:4394',
  database: d1({ binding: 'DB' }),
  storage: r2({ binding: 'MEDIA' }),
  migrations: { runtime: 'auto', dev: 'auto' },
  admin: { logo: '/assets/m4/logo-original.jpg', siteName: 'Directo · Blog local', footerLabel: 'Directo Producciones', favicon: '/assets/m4/logo-original.jpg' },
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
  server: { host: 'localhost', port: 4394 },
  devToolbar: { enabled: false },
  vite: { build: { assetsInlineLimit: 0 } },
  integrations: [react(), cms],
});
