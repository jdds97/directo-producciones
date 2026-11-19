// Prueba en Chrome real de los filtros internos de /blog/ (requiere el fixture: scripts/blog-fixture.mjs, 25 entradas,
// la destacada es la nº 3 de «Producción audiovisual», y una categoría vacía «categoria-vacia-prueba»).
//   node scripts/blog-filter-test.mjs --lh <dir con puppeteer-core> [--base http://localhost:4460]
import { createRequire } from 'node:module';
import { join } from 'node:path';
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const lh = arg('--lh'), BASE = arg('--base', 'http://localhost:4460');
if (!lh) { console.error('Uso: --lh <directorio con puppeteer-core>'); process.exit(2); }
const puppeteer = createRequire(join(lh, 'x.js'))('puppeteer-core');
let failed = 0;
const check = (cond, name, extra = '') => { if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ` ${extra}`}`); };
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
const tab = await browser.newPage();
await tab.setViewport({ width: 1280, height: 900 });
const state = () => tab.evaluate(() => {
  const vis = el => !el.hidden && !el.closest('[hidden]');
  const cards = [...document.querySelectorAll('[data-blog-card]')].filter(vis);
  const hrefs = cards.map(c => c.querySelector('a[href^="/blog/prueba-"]')?.getAttribute('href'));
  return {
    path: location.pathname + location.search, marker: window.__marker, cards: cards.length, unique: new Set(hrefs).size,
    first: hrefs[0],
    empty: Boolean(document.querySelector('[data-blog-filter-empty]') && vis(document.querySelector('[data-blog-filter-empty]'))),
    count: document.querySelector('[data-blog-count]')?.textContent, current: [...document.querySelectorAll('[data-blog-filter] [aria-current]')].map(a => a.dataset.filter),
    pagination: Boolean(document.querySelector('a[rel=next], [href*="cursor"], [href*="/page/"]')),
  };
});

// 1. Sin JS: el servidor ya pinta el estado (enlaces reales).
await tab.setJavaScriptEnabled(false);
await tab.goto(`${BASE}/blog/?categoria=comunicacion-marketing`, { waitUntil: 'load' });
let s = await state();
check(s.cards === 10, 'sin JS: ?categoria= pinta 10 entradas', JSON.stringify(s));
await tab.setJavaScriptEnabled(true);

// 2. «Todas»: la destacada en la portada (a la derecha) y las otras 24 en la lista, sin duplicados ni paginación.
await tab.goto(`${BASE}/blog/`, { waitUntil: 'networkidle0' });
await tab.evaluate(() => { window.__marker = 'sin-recarga'; });
s = await state();
const leadHref = () => tab.evaluate(() => { const l = document.querySelector('[data-blog-lead]'); return l && !l.hidden ? l.querySelector('h2 a')?.getAttribute('href') : null; });
check(s.cards === 24 && s.unique === 24, 'Todas: 24 tarjetas en la lista (la destacada va en la portada), sin duplicados', JSON.stringify(s));
check(await leadHref() === '/blog/prueba-filtros-03/' && s.first !== '/blog/prueba-filtros-03/', 'Todas: la destacada en la portada y no repetida en la lista', s.first);
check(/^25 entradas/.test(s.count ?? ''), 'Todas: contador "25 entradas"', s.count);
check(!s.pagination, 'sin enlaces de paginación ni cursor');

// 3. Clic en categoría: sin navegar, sin recarga, URL con ?categoria=, sin duplicados.
await tab.click('[data-blog-filter] [data-filter="produccion-audiovisual"]');
s = await state();
check(s.path === '/blog/?categoria=produccion-audiovisual' && s.marker === 'sin-recarga', 'clic: misma página, sin recarga', JSON.stringify(s));
check(s.cards === 10 && s.unique === 10, 'clic: 10 entradas, sin duplicados', JSON.stringify(s));
check(s.first === '/blog/prueba-filtros-03/' && await leadHref() === null, 'clic: la portada se oculta y la destacada va primera en su categoría', s.first);
check(s.current.join() === 'produccion-audiovisual', 'clic: aria-current en la categoría activa', s.current.join());
check(/^10 entradas en Producción audiovisual/.test(s.count ?? ''), 'clic: contador anunciado', s.count);

// 4. Atrás / adelante.
await tab.goBack(); await new Promise(r => setTimeout(r, 200));
s = await state();
check(s.path === '/blog/' && s.cards === 24 && await leadHref() === '/blog/prueba-filtros-03/' && s.marker === 'sin-recarga', 'atrás: vuelve a Todas (con portada) sin recargar', JSON.stringify(s));
await tab.goForward(); await new Promise(r => setTimeout(r, 200));
s = await state();
check(s.cards === 10, 'adelante: vuelve a la categoría', JSON.stringify(s));

// 5. Teclado: Tab hasta el filtro y Enter.
await tab.goto(`${BASE}/blog/`, { waitUntil: 'networkidle0' });
await tab.focus('[data-blog-filter] [data-filter="comunicacion-marketing"]');
await tab.keyboard.press('Enter');
s = await state();
const focused = await tab.evaluate(() => document.activeElement?.dataset?.filter);
check(s.cards === 10 && focused === 'comunicacion-marketing', 'teclado: Enter filtra y conserva el foco', `${JSON.stringify(s)} foco=${focused}`);

// 6. Categoría existente pero vacía (sólo se ofrece al pedirla por URL): estado vacío con salida a «Todas» y foco movido.
await tab.goto(`${BASE}/blog/?categoria=categoria-vacia-prueba`, { waitUntil: 'networkidle0' });
s = await state();
check(s.empty && s.cards === 0 && /^0 entradas/.test(s.count ?? '') && s.current.join() === 'categoria-vacia-prueba', 'vacío: mensaje, 0 entradas y chip activo', JSON.stringify(s));
await tab.click('[data-blog-filter-empty] [data-filter=""]');
s = await state();
const f = await tab.evaluate(() => document.activeElement?.dataset?.filter);
check(!s.empty && s.cards === 24 && f === '', 'vacío → «Todas»: lista completa y foco en «Todas»', `${JSON.stringify(s)} foco=${f}`);
// 7. Categoría inexistente: vuelve a Todas sin romper.
await tab.goto(`${BASE}/blog/?categoria=no-existe`, { waitUntil: 'networkidle0' });
s = await state();
check(s.cards === 24, 'categoría desconocida: se muestra Todas (la destacada en la portada)', JSON.stringify(s));
// 8. Los artículos conservan su URL.
const hrefs = await tab.evaluate(() => [...document.querySelectorAll('[data-blog-card] a[href^="/blog/prueba-"]')].map(a => a.getAttribute('href')));
check(hrefs.every(h => /^\/blog\/prueba-filtros-\d\d\/$/.test(h)), 'URLs de artículo /blog/<slug>/ intactas', hrefs[0]);
await browser.close();
console.log(failed ? `\n${failed} fallo(s)` : '\nTodo correcto');
process.exit(failed ? 1 : 0);
