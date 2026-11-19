// Peso real por página y tipo de recurso en un Chrome (puppeteer-core del directorio temporal de Lighthouse, --lh).
// Dos fases por ruta: carga inicial y tras recorrer la página hasta el final (activa lazy-loading y vídeos al entrar en pantalla).
//   node scripts/asset-weights.mjs --lh /tmp/lh --base http://localhost:4460 [--out resumen.json]
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const lh = arg('lh'), base = (arg('base') ?? '').replace(/\/$/, '');
if (!lh || !base) { console.error('Uso: --lh <dir> --base <url> [--out f.json]'); process.exit(2); }
const puppeteer = createRequire(join(lh, 'x.js'))('puppeteer-core');
const routes = (arg('routes', '/,/quienes-somos/,/streaming/,/comunicacion-marketing/,/portfolio/,/clientes/,/contacto/,/blog/,/servicios/')).split(',');
const profiles = { mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, desktop: { width: 1440, height: 900 } };
const kind = (url, type) => /\.(woff2?|ttf)$/.test(url) ? 'font' : type === 'image' || /\.(png|jpe?g|webp|avif|svg|gif)$/.test(url) ? 'image' : type === 'media' || /\.(mp4|webm)$/.test(url) ? 'video' : type === 'script' ? 'script' : type === 'stylesheet' ? 'css' : type === 'document' ? 'html' : 'other';
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
const out = [];
for (const [profile, vp] of Object.entries(profiles)) for (const route of routes) {
  const tab = await browser.newPage(); await tab.setViewport(vp);
  const seen = new Map();
  const cdp = await tab.createCDPSession(); await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  cdp.on('Network.responseReceived', e => seen.set(e.requestId, { url: e.response.url, type: e.type.toLowerCase(), status: e.response.status }));
  cdp.on('Network.loadingFinished', e => { const r = seen.get(e.requestId); if (r) r.bytes = e.encodedDataLength; });
  const snapshot = () => { const o = {}; let total = 0; const items = []; for (const r of seen.values()) { if (!r.bytes) continue; const k = kind(r.url, r.type); o[k] = (o[k] ?? 0) + r.bytes; total += r.bytes; items.push([r.bytes, r.url.replace(base, '')]); } return { total, kinds: o, requests: items.length, top: items.sort((a, b) => b[0] - a[0]).slice(0, 6) }; };
  await tab.goto(base + route, { waitUntil: 'networkidle0', timeout: 60000 });
  const initial = snapshot();
  await tab.evaluate(async () => { for (let y = 0; y < document.documentElement.scrollHeight + 2000; y += 500) { window.scrollTo(0, y); document.querySelector('#scroll-container')?.dispatchEvent(new Event('scroll')); await new Promise(r => setTimeout(r, 120)); } });
  await new Promise(r => setTimeout(r, 1500));
  const full = snapshot();
  out.push({ profile, route, initial, full });
  console.log(`${profile.padEnd(7)} ${route.padEnd(26)} inicial ${(initial.total / 1024).toFixed(0).padStart(6)} KiB (${initial.requests} peticiones) · tras recorrer ${(full.total / 1024).toFixed(0).padStart(6)} KiB (${full.requests})  img ${((full.kinds.image ?? 0) / 1024).toFixed(0)} vid ${((full.kinds.video ?? 0) / 1024).toFixed(0)} font ${((full.kinds.font ?? 0) / 1024).toFixed(0)} js ${((full.kinds.script ?? 0) / 1024).toFixed(0)} css ${((full.kinds.css ?? 0) / 1024).toFixed(0)}`);
  await tab.close();
}
await browser.close();
if (arg('out')) writeFileSync(arg('out'), JSON.stringify(out, null, 1));
