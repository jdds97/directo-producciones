// Smoke HTTP de solo lectura/rechazo: no envía ningún correo ni crea contenido. Sirve para el Worker local y para el
// despliegue en CI (misma URL base como argumento). Sale con 1 al primer fallo para disparar el rollback.
//   node scripts/smoke.mjs http://localhost:4450 [--local]    (--local: acepta noindex/no-store de los gates locales)
import { readFileSync } from 'node:fs';
const base = (process.argv[2] ?? '').replace(/\/$/, '');
const local = process.argv.includes('--local');
if (!/^https?:\/\//.test(base)) { console.error('Uso: node scripts/smoke.mjs <urlBase> [--local]'); process.exit(2); }
let failed = 0;
const check = (cond, name) => { if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); };
const get = (path, init) => fetch(base + path, { redirect: 'manual', signal: AbortSignal.timeout(15000), ...init });
// Avisos de revisión: el patrón se lee de su única fuente (src/lib/content-policy.ts) sin importar el módulo, que carga facts.ts y el
// registro generado en .emdash/ (no existe en el rollback manual de deploy.yml, que no compila).
const reviewMarkerText = (() => {
  const m = /export const reviewMarkerText = \/(.+)\/([a-z]*);/.exec(readFileSync(new URL('../src/lib/content-policy.ts', import.meta.url), 'utf8'));
  if (!m) throw new Error('reviewMarkerText no encontrado en src/lib/content-policy.ts');
  return new RegExp(m[1], m[2]);
})();

// Las 12 rutas que leen contenido del CMS (src/cms/scope.ts) y el blog: un contenido ausente da 500 y debe revertir el despliegue.
for (const path of ['/', '/quienes-somos/', '/portfolio/', '/servicios/', '/comunicacion-marketing/', '/streaming/', '/clientes/', '/contacto/', '/cookies/', '/privacidad/', '/aviso-legal/', '/blog/']) {
  const r = await get(path);
  check(r.status === 200, `GET ${path} → 200 (${r.status})`);
  // Fuera de local, los textos legales publicados no llevan avisos de revisión (en local <ReviewNote> los muestra a propósito).
  if (!local && ['/cookies/', '/privacidad/', '/aviso-legal/'].includes(path) && r.status === 200) {
    const marker = (await r.text()).replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]*>/g, ' ').match(reviewMarkerText)?.[0];
    check(!marker, `${path} sin avisos de revisión${marker ? ` («${marker}»)` : ''}`);
  }
}
const notFound = await get('/404');
check(notFound.status === 404, `GET /404 → 404 (${notFound.status})`);
// Una entrada del blog si el sitemap la lista (sin entradas publicadas no hay nada que comprobar).
const post = ((await (await get('/sitemap.xml')).text()).match(/<loc>([^<]*\/blog\/[^<\/]+\/?)<\/loc>/) ?? [])[1];
if (post) {
  const r = await get(new URL(post).pathname);
  check(r.status === 200, `GET ${new URL(post).pathname} (entrada del sitemap) → 200 (${r.status})`);
} else console.log('--   sin entradas del blog en el sitemap');
const home = await get('/');
check((home.headers.get('content-type') ?? '').startsWith('text/html'), 'portada es HTML');
check(home.headers.get('x-content-type-options') === 'nosniff', 'X-Content-Type-Options: nosniff');
const robots = await get('/robots.txt');
check(robots.status === 200, `robots.txt → 200 (${robots.status})`);
// El formulario solo acepta POST del mismo origen: estas dos peticiones se rechazan antes de tocar ningún proveedor.
const wrongMethod = await get('/api/contacto');
check(wrongMethod.status === 405, `GET /api/contacto → 405 (${wrongMethod.status})`);
const foreign = await get('/api/contacto', { method: 'POST', headers: { Origin: 'https://otro.invalid', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=x' });
check(foreign.status === 403 || foreign.status === 303, `POST con origen ajeno rechazado (${foreign.status})`);
if (foreign.status === 303) check(/consulta=origen/.test(foreign.headers.get('location') ?? ''), 'rechazo de origen sin datos en la URL');
// Vídeo de portada con Range (Safari/iOS exige 206 + Content-Range). El subido por el panel (/_emdash/api/media/file/*.mp4) lo sirve el
// Worker desde R2 y debe dar 206/416/304; el del sitio (/assets/...) lo sirve Worker Assets: solo se exige que responda 200 o 206.
const videoSrc = (await home.clone().text()).match(/data-home-video-src="([^"]+)"/)?.[1];
if (videoSrc) {
  const own = videoSrc.startsWith('/_emdash/api/media/file/');
  const r = await get(videoSrc, { headers: { Range: 'bytes=0-1' } });
  if (own) {
    check(r.status === 206 && /^bytes 0-1\/\d+$/.test(r.headers.get('content-range') ?? '') && r.headers.get('accept-ranges') === 'bytes', `vídeo subido: Range 0-1 → 206 con Content-Range (${r.status} ${r.headers.get('content-range')})`);
    const etag = r.headers.get('etag') ?? '';
    check((await get(videoSrc, { headers: { Range: 'bytes=999999999-' } })).status === 416, 'vídeo subido: Range fuera de rango → 416');
    check(!etag || (await get(videoSrc, { headers: { 'If-None-Match': etag } })).status === 304, 'vídeo subido: If-None-Match → 304');
    check((await get(videoSrc, { method: 'HEAD' })).status === 200, 'vídeo subido: HEAD → 200');
  } else check([200, 206].includes(r.status), `vídeo del sitio ${videoSrc}: Range 0-1 → ${r.status}${r.status === 206 ? '' : ' (sin 206: Safari/iOS puede no reproducirlo; comprobar en la preview)'}`);
  await r.arrayBuffer();
} else console.log('--   sin data-home-video-src en la portada');
// Formularios de Inicio y Contacto: mismo endpoint y campos. El envío solo se ejercita con --local (allí el proveedor es simulado; en preview
// también, pero en producción mandaría un correo real a la bandeja del cliente).
const form = { name: 'Prueba local', email: 'prueba@example.com', service: 'Otro proyecto', message: 'Mensaje sintético del smoke; no es una consulta real.' };
for (const path of ['/', '/contacto/']) {
  const html = await (await get(path)).text();
  const tag = html.match(/<form\b[^>]*data-contact-form[^>]*>/)?.[0] ?? '';
  check(/action="\/api\/contacto"/.test(tag) && /method="post"/i.test(tag) && ['name', 'email', 'message', 'website'].every(n => html.includes(`name="${n}"`)), `formulario de ${path} apunta a /api/contacto con sus campos`);
  if (!local) continue;
  const sent = await get('/api/contacto', { method: 'POST', headers: { Origin: base, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });
  const out = await sent.json().catch(() => ({}));
  check(sent.status === 200 && out.ok === true && out.delivery === 'simulated', `${path}: envío simulado aceptado, sin correo real (${sent.status} ${out.code ?? ''})`);
}
if (local) {
  const bot = await get('/api/contacto', { method: 'POST', headers: { Origin: base, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...form, website: 'spam' }).toString() });
  check(bot.status === 400, `honeypot relleno rechazado (${bot.status})`);
}
const admin = await get('/_emdash/admin/');
const adminTo = admin.headers.get('location') ?? '';
check(admin.status !== 200 || (admin.headers.get('content-type') ?? '').includes('html') && !!(await admin.text()).match(/login|iniciar|sign/i), `/_emdash/admin/ no es público sin sesión (${admin.status})`);
// Una redirección al asistente significa CMS sin configurar con el alta al alcance de quien llegue primero. En local (persistencia
// nueva sin asistente completado) es normal: solo se avisa. En remoto la compuerta o Access responden antes que EmDash (siguiente check).
const toSetup = /\/_emdash\/admin\/setup/.test(adminTo);
if (local && toSetup) console.log(`--   /_emdash/admin/ redirige al alta inicial (${adminTo}): completa el asistente local`);
else check(!toSetup, `/_emdash/admin/ no redirige al alta inicial (${adminTo || 'sin redirección'})`);
// Producción: el panel solo detrás de Cloudflare Access (redirección a su login en el borde, o 403/503 de la compuerta del Worker).
if (!local) check([403, 503].includes(admin.status) || /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com\//.test(adminTo), `/_emdash/admin/ cerrado sin Cloudflare Access (${admin.status} ${adminTo})`);
const api = await get('/_emdash/api/content/page_home');
check([301, 302, 303, 307, 401, 403, 503].includes(api.status), `API de contenido exige sesión (${api.status})`);
const robotsHeader = home.headers.get('x-robots-tag') ?? '';
check(local ? /noindex/.test(robotsHeader) : !/noindex/.test(robotsHeader), local ? 'local: noindex activo' : 'producción: sin noindex en la portada');
console.log(failed ? `\n${failed} comprobaciones fallidas` : '\nSmoke correcto');
process.exit(failed ? 1 : 0);
