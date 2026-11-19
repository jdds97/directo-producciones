// Prueba del consentimiento en un Chrome real con INTERCEPCIÓN de red: ninguna petición sale a Google (se responde un
// stub local). Usa el código real de src/scripts/consent.ts empaquetado con esbuild (ya instalado) y puppeteer-core del
// directorio temporal de Lighthouse (--lh), sin tocar package.json. Uso: node scripts/consent-browser-test.mjs --lh /tmp/lh
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { join } from 'node:path';

const lh = process.argv[process.argv.indexOf('--lh') + 1];
if (!lh) { console.error('Uso: --lh <directorio con puppeteer-core>'); process.exit(2); }
const puppeteer = createRequire(join(lh, 'x.js'))('puppeteer-core');
const { bundle } = { bundle: (await build({ entryPoints: ['src/scripts/consent.ts'], bundle: true, write: false, format: 'iife', globalName: 'dpConsent', target: 'es2022' })).outputFiles[0].text };
const page = `<!doctype html><meta charset=utf-8><title>harness</title><body><main><a class="whatsapp-access" href="https://wa.me/34651341384">WhatsApp</a></main>
<footer><a href="/cookies/">Cookies</a></footer><script>addEventListener('click',e=>{if(e.target.closest('a[href^="https://wa.me/"]'))e.preventDefault()},true)</script><script src="/consent.js"></script><script>dpConsent.initConsent('G-TEST1234')</script></body>`;
const server = createServer((req, res) => {
  if (req.url === '/consent.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle); }
  else if (req.url === '/cookies/') res.end('cookies');
  else { res.setHeader('content-type', 'text/html'); res.end(page); }
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const origin = `http://127.0.0.1:${server.address().port}`;

let failed = 0;
const check = (cond, name) => { if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); };
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
const tab = await browser.newPage();
const google = [];
await tab.setRequestInterception(true);
tab.on('request', req => {
  const url = req.url();
  if (/google|gstatic|doubleclick/.test(new URL(url).hostname)) { google.push(url); req.respond({ status: 200, contentType: 'text/javascript', body: 'window.__gtagStub=(window.__gtagStub||0)+1' }); }
  else if (new URL(url).hostname === '127.0.0.1') req.continue();
  else req.abort(); // nada sale a Internet
});
const load = async () => { await tab.goto(origin, { waitUntil: 'load' }); };
const banner = () => tab.$('.consent');
const clickText = async text => { const [b] = await tab.$$(`xpath/.//button[normalize-space()="${text}"]`); await b.click(); };

await load();
check(!!(await banner()), 'primera visita: aparece el aviso (sin decisión previa)');
check(google.length === 0, 'primera visita: 0 peticiones a Google antes de decidir');
check((await tab.evaluate(() => document.activeElement === document.body)), 'el aviso inicial no roba el foco');
await clickText('Rechazar');
check(!(await banner()) && google.length === 0, 'rechazar: el aviso se cierra y sigue sin tráfico a Google');
await load();
check(!(await banner()) && google.length === 0, 'tras rechazar y recargar: no vuelve a preguntar y no hay tráfico');
await tab.click('.whatsapp-access', { button: 'right' }).catch(() => {});
check(await tab.evaluate(() => !window.dataLayer), 'rechazado: no existe dataLayer ni gtag');

await clickText('Preferencias de medición');
await clickText('Aceptar medición');
await tab.waitForFunction('window.__gtagStub === 1', { timeout: 5000 }).catch(() => {});
check(google.length === 1 && /googletagmanager\.com\/gtag\/js\?id=G-TEST1234$/.test(google[0]), `aceptar: exactamente 1 petición, a gtag.js (${google.length})`);
check(await tab.evaluate(() => document.querySelectorAll('script[src*="googletagmanager"]').length === 1), 'un solo <script> de gtag');
await tab.evaluate(() => document.querySelector('.whatsapp-access').click());
const events = () => tab.evaluate(() => (window.dataLayer ?? []).map(x => Array.from(x)).filter(x => x[0] === 'event'));
let ev = await events();
check(ev.length === 1 && ev[0][1] === 'click_whatsapp' && JSON.stringify(ev[0][2]) === '{"link_location":"flotante"}', 'clic en WhatsApp: evento secundario sin datos personales');
await tab.evaluate(() => document.dispatchEvent(new CustomEvent('dp:event', { detail: { name: 'generate_lead', params: { email: 'a@b.es', nombre: 'Ana' } } })));
ev = await events();
check(ev.length === 2 && ev[1][1] === 'generate_lead' && JSON.stringify(ev[1][2]) === '{}', 'generate_lead sin PII');
await tab.setCookie({ name: '_ga', value: 'GA1.1.1', url: origin }, { name: '_ga_TEST1234', value: 'GS1', url: origin }, { name: 'otra', value: '1', url: origin });

await load();
check(google.length === 2, `recarga con decisión guardada: se carga una sola vez más (${google.length - 1})`);
await clickText('Preferencias de medición');
await clickText('Retirar consentimiento');
const names = (await tab.cookies()).map(c => c.name);
check(!names.includes('_ga') && !names.includes('_ga_TEST1234') && names.includes('otra'), 'revocar: borra _ga* y respeta otras cookies');
const n = (await events()).length;
await tab.evaluate(() => { document.querySelector('.whatsapp-access').click(); document.dispatchEvent(new CustomEvent('dp:event', { detail: { name: 'generate_lead' } })); });
check((await events()).length === n, 'revocado: ningún evento más');
check(await tab.evaluate(() => window['ga-disable-G-TEST1234'] === true), 'ga-disable activo');
await load();
check(google.length === 2 && !(await banner()), 'tras revocar y recargar: sin tráfico y sin nuevo aviso');
console.log(`Peticiones a Google observadas en total: ${google.length} (todas interceptadas; ninguna salió a la red)`);
await browser.close(); server.close();
console.log(failed ? `\n${failed} fallos` : '\nConsentimiento correcto');
process.exit(failed ? 1 : 0);
