import { existsSync } from 'node:fs';

// Untracked worktree settings keep the shared source identical for M3 and M4.
if (existsSync('.env.worktree')) process.loadEnvFile('.env.worktree');
const origin = new URL(process.env.EMDASH_SITE_URL || 'http://localhost:4394');
const port = Number(origin.port);
if (origin.protocol !== 'http:' || origin.hostname !== 'localhost' ||
    origin.username || origin.password || origin.pathname !== '/' ||
    origin.search || origin.hash || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('La revisión requiere http://localhost:<puerto> en EMDASH_SITE_URL.');
}
export const LOCAL_CMS_ORIGIN = origin.origin;
export const LOCAL_REVIEW_PORT = port;
