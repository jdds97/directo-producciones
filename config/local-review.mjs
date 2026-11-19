import { existsSync } from 'node:fs';

// Untracked worktree settings keep the shared source identical for M3 and M4.
if (existsSync('.env.worktree')) process.loadEnvFile('.env.worktree');
const appEnv = process.env.APP_ENV ?? 'local';
// Preview/producción: origen https exacto del entorno (sin comodines); local: http://localhost:<puerto>.
const REMOTE_HOSTS = { preview: 'directo-producciones-preview.directo-producciones.workers.dev', production: 'directoproducciones.com' };
const origin = new URL(process.env.EMDASH_SITE_URL || (appEnv === 'local' ? 'http://localhost:4394' : `https://${REMOTE_HOSTS[appEnv]}`));
const port = appEnv === 'local' ? Number(origin.port) : 4394; // el puerto solo importa al servidor de desarrollo
const okOrigin = appEnv === 'local'
  ? origin.protocol === 'http:' && origin.hostname === 'localhost' && Number.isInteger(port) && port >= 1 && port <= 65535
  : origin.protocol === 'https:' && origin.hostname === REMOTE_HOSTS[appEnv] && !origin.port;
if (!okOrigin || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
  throw new Error(appEnv === 'local' ? 'La revisión requiere http://localhost:<puerto> en EMDASH_SITE_URL.' : `APP_ENV=${appEnv} requiere el origen https://${REMOTE_HOSTS[appEnv]} (EMDASH_SITE_URL).`);
}
export const LOCAL_CMS_ORIGIN = origin.origin;
export const LOCAL_REVIEW_PORT = port;
