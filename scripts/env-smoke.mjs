// Smoke LOCAL de la compuerta por entorno contra Workers reales (workerd vía `wrangler dev --local`), con builds y persistencia AISLADOS.
// No contacta Cloudflare (sin APIs ni red de Access): prueba el CIERRE por defecto, no un despliegue remoto ni el camino «Access válido»
// (ese se cubre en tests/env-policy.test.ts con claves RSA sintéticas).
//   node scripts/env-smoke.mjs [--no-build]
// `wrangler dev` carga el `.env` del proyecto (APP_ENV=local) por encima de vars: se fija --var APP_ENV como hace `wrangler deploy` con wrangler.jsonc.
// Puertos: local 4491 · preview 4492 · producción 4493. Salida en .wrangler/fase-09-runtime*/ (no toca dist/ ni el servidor 4470).
import http from 'node:http';
import https from 'node:https';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';

const PREVIEW_HOST = 'directo-producciones-preview.directo-producciones.workers.dev';
const PROFILES = {
  local: { dir: 'fase-09-local', env: 'local', site: 'http://localhost:4491', port: 4491 },
  preview: { dir: 'fase-09-runtime', env: 'preview', site: `https://${PREVIEW_HOST}`, port: 4492 },
  production: { dir: 'fase-09-prod', env: 'production', site: 'https://directoproducciones.com', port: 4493 },
};
const DEPLOY_REDIRECT = '.wrangler/deploy/config.json';
let passed = 0, failed = 0;
const ok = (cond, name, extra = '') => { cond ? passed++ : failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ' ' + extra}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function build(p) {
  // El build escribe .wrangler/deploy/config.json (redirección compartida de wrangler): se conserva tal cual estaba.
  const saved = existsSync(DEPLOY_REDIRECT) ? readFileSync(DEPLOY_REDIRECT) : null;
  mkdirSync(`.wrangler/${p.dir}`, { recursive: true });
  const r = spawnSync('npx', ['astro', 'build', '--outDir', `.wrangler/${p.dir}/dist`], {
    env: { ...process.env, APP_ENV: p.env, CLOUDFLARE_ENV: p.env === 'local' ? '' : p.env, EMDASH_SITE_URL: p.site, ASTRO_TELEMETRY_DISABLED: '1' }, encoding: 'utf8',
  });
  if (saved) writeFileSync(DEPLOY_REDIRECT, saved);
  if (r.status !== 0) throw new Error(`build ${p.env} falló:\n${(r.stdout + r.stderr).slice(-1500)}`);
}

function request(p, { host, path = '/', method = 'GET', headers = {} }) {
  const mod = new URL(p.site).protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request({ host: '127.0.0.1', port: p.port, path, method, headers: { host, ...headers }, rejectUnauthorized: false, servername: host.split(':')[0] }, (res) => {
      let body = ''; res.on('data', (c) => (body += c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject); req.setTimeout(15000, () => req.destroy(new Error('timeout')));
    if (method === 'POST') req.write('name=Prueba'); req.end();
  });
}

async function withWorker(p, vars, fn) {
  const state = `.wrangler/${p.dir}/state`;
  rmSync(state, { recursive: true, force: true });
  const args = ['exec', '--', 'wrangler', 'dev', '--config', `.wrangler/${p.dir}/dist/server/wrangler.json`, '--local', '--ip', '127.0.0.1', '--port', String(p.port), '--inspector-port', '0', '--persist-to', state,
    ...(p.env === 'local' ? [] : ['--local-protocol', 'https']), ...Object.entries({ ...(p.env === 'local' ? {} : { APP_ENV: p.env }), ...vars }).flatMap(([k, v]) => ['--var', `${k}:${v}`])];
  const child = spawn('npm', args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  let out = ''; child.stdout.on('data', (c) => (out += c)); child.stderr.on('data', (c) => (out += c));
  try {
    const host = p.env === 'local' ? `localhost:${p.port}` : new URL(p.site).host;
    let up = false;
    for (let i = 0; i < 60 && !up; i++) { try { await request(p, { host, path: '/robots.txt' }); up = true; } catch { await sleep(1000); } }
    if (!up) throw new Error(`Worker ${p.env} no arrancó:\n${out.slice(-1200)}`);
    await fn(host);
  } finally { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* ya terminado */ } await sleep(2000); }
}

const noJwt = (r) => r.status === 403 || r.status === 503;
if (!process.argv.includes('--no-build')) for (const p of Object.values(PROFILES)) build(p);
const assetFile = (p) => `/_astro/${readdirSync(`.wrangler/${p.dir}/dist/client/_astro`).find((f) => f.endsWith('.css'))}`;
const AUD = 'a'.repeat(64);
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const forged = `${b64u({ alg: 'RS256', kid: 'x' })}.${b64u({ iss: 'https://e2e.cloudflareaccess.com', aud: ['b'.repeat(64)], exp: Math.floor(Date.now() / 1000) + 600 })}.${Buffer.from('firma').toString('base64url')}`;

// ── LOCAL: mismos límites de siempre ───────────────────────────────────────────────────────────────
{
  const p = PROFILES.local;
  await withWorker(p, {}, async (host) => {
    const home = await request(p, { host, path: '/robots.txt' });
    ok(home.status === 200 && /noindex/.test(home.headers['x-robots-tag'] ?? ''), 'local: localhost sirve y lleva noindex', `${home.status}`);
    const alien = await request(p, { host: 'example.com', path: '/robots.txt' });
    ok(alien.status === 403 && /exclusivamente en local/.test(alien.body), 'local: host no loopback → 403', `${alien.status}`);
    const post = await request(p, { host, path: '/otra-ruta', method: 'POST' });
    ok(post.status === 403, 'local: POST fuera de contacto → 403', `${post.status}`);
  });
}
// ── PREVIEW sin Access configurado: todo 503 (cerrada), incluido estáticos y medios ──────────────────────
{
  const p = PROFILES.preview;
  const paths = ['/', '/blog/', '/robots.txt', '/assets/m4/logo-original.jpg', assetFile(p), '/_emdash/admin', '/interno/guia/'];
  await withWorker(p, { ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '' }, async (host) => {
    for (const path of paths) {
      const r = await request(p, { host, path });
      ok(r.status === 503 && /sin configurar/.test(r.body) && /noindex/.test(r.headers['x-robots-tag'] ?? ''), `preview sin Access: ${path} → 503 cerrada + noindex`, `${r.status} ${r.body.slice(0, 60)}`);
    }
    const post = await request(p, { host, path: '/api/contacto', method: 'POST', headers: { origin: p.site, 'content-type': 'application/x-www-form-urlencoded' } });
    ok(post.status === 503, 'preview sin Access: POST /api/contacto → 503', `${post.status}`);
    const alien = await request(p, { host: 'directo-producciones-preview-alias.workers.dev', path: '/assets/m4/logo-original.jpg' });
    ok(alien.status === 403, 'preview: host alternativo (alias/versión) → 403 aunque no haya Access', `${alien.status}`);
    const spoof = await request(p, { host, path: '/', headers: { 'cf-access-authenticated-user-email': 'info@directoproducciones.com' } });
    ok(spoof.status === 503, 'preview: cabecera de identidad falsificada no abre nada', `${spoof.status}`);
  });
  // La prueba real temporal (CONTACT_PREVIEW_REAL; el binding CONTACT_EMAIL no se declara en preview) no abre nada por sí sola: la compuerta va antes.
  await withWorker(p, { ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '', CONTACT_PREVIEW_REAL: 'on' }, async (host) => {
    const post = await request(p, { host, path: '/api/contacto', method: 'POST', headers: { origin: p.site, 'content-type': 'application/x-www-form-urlencoded' } });
    ok(post.status === 503, 'preview con interruptores de prueba real pero sin Access: POST /api/contacto → 503', `${post.status}`);
  });
  // ── PREVIEW con Access configurado pero sin JWT válido: 403 ──
  await withWorker(p, { ACCESS_TEAM_DOMAIN: 'e2e.cloudflareaccess.com', ACCESS_AUD: AUD }, async (host) => {
    for (const path of paths) {
      const r = await request(p, { host, path });
      ok(r.status === 403 && /no autorizado/i.test(r.body), `preview con Access, sin JWT: ${path} → 403`, `${r.status}`);
    }
    const bad = await request(p, { host, path: '/', headers: { 'cf-access-jwt-assertion': 'no.es.jwt' } });
    ok(bad.status === 403, 'preview: JWT mal formado → 403', `${bad.status}`);
    const fake = await request(p, { host, path: '/assets/m4/logo-original.jpg', headers: { 'cf-access-jwt-assertion': forged, 'cf-access-authenticated-user-email': 'info@directoproducciones.com' } });
    ok(fake.status === 403, 'preview: JWT con aud ajeno + cabecera de identidad → 403', `${fake.status}`);
  });
  // ── Incoherencia build/ejecución ──
  await withWorker(p, { APP_ENV: 'production' }, async (host) => {
    const r = await request(p, { host, path: '/' });
    ok(r.status === 503 && /incoherente/.test(r.body), 'bundle de preview ejecutado como production → 503 incoherente', `${r.status} ${r.body.slice(0, 60)}`);
  });
}
// ── PRODUCCIÓN sin hito de lanzamiento: 503 a todo; hosts ajenos 403 ──────────────────────────────────
{
  const p = PROFILES.production;
  await withWorker(p, {}, async (host) => {
    for (const path of ['/', '/blog/', '/robots.txt', '/assets/m4/logo-original.jpg', assetFile(p), '/_emdash/admin']) {
      const r = await request(p, { host, path });
      ok(r.status === 503 && !r.headers['x-robots-tag'] && /no disponible/.test(r.body), `producción sin hito: ${path} → 503`, `${r.status}`);
    }
    const www = await request(p, { host: `www.${host}`, path: '/' });
    ok(www.status === 503, 'producción sin hito: www también cerrada (sin redirección previa al corte)', `${www.status}`);
    const alien = await request(p, { host: 'directo-producciones.workers.dev', path: '/' });
    ok(alien.status === 403, 'producción: host ajeno → 403', `${alien.status}`);
  });
}
console.log(`\n${passed} correctas, ${failed} fallidas`);
process.exit(failed ? 1 : 0);
