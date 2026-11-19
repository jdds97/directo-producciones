// Auditoría SEO técnica de solo lectura sobre un Worker en marcha (local por defecto). No envía formularios ni contacta con terceros.
//   node scripts/seo-audit.mjs http://localhost:4460            local: espera noindex y canonical del propio origen
// Comprueba por plantilla: estado, <title>/descripción únicos, un solo <h1>, orden de encabezados, un solo emisor de cada etiqueta
// (title/description/robots/canonical), canonical absoluto = URL, Open Graph + imagen accesible, JSON-LD válido, imágenes con alt y
// dimensiones, enlaces internos y anclas, 404 real, robots.txt, sitemap.xml (cada URL responde 200 y su canonical es ella misma)
// y llms.txt. Ningún rastro de Google (gtag, analytics) en el HTML mientras la analítica está apagada.
const base = (process.argv[2] ?? '').replace(/\/$/, '');
if (!/^https?:\/\//.test(base)) { console.error('Uso: node scripts/seo-audit.mjs <urlBase>'); process.exit(2); }
let failed = 0, warned = 0;
const check = (cond, name) => { if (!cond) failed++; if (!cond) console.log(`FAIL ${name}`); return cond; };
const warn = (cond, name) => { if (!cond) { warned++; console.log(`AVISO ${name}`); } };
const get = (path, init) => fetch(base + path, { redirect: 'manual', signal: AbortSignal.timeout(20000), ...init });
const tags = (html, re) => [...html.matchAll(re)].map(m => m[1] ?? m[0]);
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}=("([^"]*)"|'([^']*)')`))?.slice(2).find(x => x !== undefined);
const decode = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

const sm = await get('/sitemap.xml');
check(sm.status === 200 && (sm.headers.get('content-type') ?? '').includes('xml'), `sitemap.xml → 200 XML (${sm.status})`);
const smXml = await sm.text();
const locs = tags(smXml, /<loc>([^<]+)<\/loc>/g).map(decode);
check(locs.length >= 10 && new Set(locs).size === locs.length, `sitemap: ${locs.length} URLs únicas`);
check(!/\?|#/.test(locs.join('')), 'sitemap sin query ni fragmentos');
const paths = locs.map(l => new URL(l).pathname);
const extra = ['/blog/'];
const pages = [...new Set([...paths, ...extra])];

const seenTitles = new Map(), seenDesc = new Map(), internal = new Map();
for (const path of pages) {
  const r = await get(path);
  const html = await r.text();
  const id = path.padEnd(28);
  if (!check(r.status === 200, `${path} → 200 (${r.status})`)) continue;
  check(/<html lang="es"/.test(html), `${id} <html lang="es">`);
  const titles = tags(html, /<title>([^<]*)<\/title>/g);
  check(titles.length === 1, `${id} un único <title> (${titles.length})`);
  const title = decode(titles[0] ?? '');
  warn(title.length >= 10 && title.length <= 75, `${id} longitud del título ${title.length}`);
  (seenTitles.get(title) ?? seenTitles.set(title, []).get(title)).push(path);
  const metas = tags(html, /<meta\b[^>]*>/g);
  const named = name => metas.filter(m => attr(m, 'name') === name);
  const prop = name => metas.filter(m => attr(m, 'property') === name);
  const desc = named('description');
  check(desc.length === 1, `${id} una única meta description (${desc.length})`);
  const d = decode(attr(desc[0] ?? '', 'content') ?? '');
  check(d.length >= 50 && d.length <= 200 && !/Revisión local/.test(d), `${id} descripción útil (${d.length} car.)`);
  (seenDesc.get(d) ?? seenDesc.set(d, []).get(d)).push(path);
  const robots = named('robots');
  check(robots.length === 1 && /noindex/.test(attr(robots[0], 'content') ?? ''), `${id} un único meta robots con noindex en local`);
  const canon = tags(html, /<link\b[^>]*rel="canonical"[^>]*>/g);
  check(canon.length === 1, `${id} un único canonical (${canon.length})`);
  const href = attr(canon[0] ?? '', 'href');
  check(href === `${base}${path}`, `${id} canonical = su propia URL (${href})`);
  for (const p of ['og:title', 'og:description', 'og:url', 'og:image', 'og:type', 'og:site_name']) check(prop(p).length === 1, `${id} ${p} único`);
  check(attr(prop('og:url')[0] ?? '', 'content') === href, `${id} og:url = canonical`);
  const h1 = tags(html, /<h1\b/g);
  check(h1.length === 1, `${id} un único <h1> (${h1.length})`);
  const levels = tags(html, /<h([1-6])\b/g).map(Number);
  warn(levels.every((l, i) => i === 0 || l - levels[i - 1] <= 1), `${id} saltos de nivel en encabezados: ${levels.join('')}`);
  // JSON-LD
  const ld = tags(html, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
  for (const block of ld) { try { const j = JSON.parse(block); check(j['@context'] === 'https://schema.org', `${id} JSON-LD con @context`); } catch { check(false, `${id} JSON-LD inválido`); } }
  check(path === '/' ? ld.length === 2 : ld.length >= 1, `${id} JSON-LD presente (${ld.length})`);
  check(!/FAQPage|AggregateRating|"Review"/.test(ld.join('')), `${id} sin schema fuera de alcance`);
  // imágenes
  const imgs = tags(html, /<img\b[^>]*>/g);
  check(imgs.every(i => /\balt(=|\s|>)/.test(i)), `${id} todas las <img> con alt (${imgs.length})`);
  warn(imgs.every(i => /\bwidth=/.test(i) && /\bheight=/.test(i)), `${id} <img> sin width/height: ${imgs.filter(i => !/\bwidth=/.test(i)).length}`);
  check(!/googletagmanager|google-analytics|gtag\(|dp-ga4/.test(html), `${id} sin rastro de Google/analítica`);
  // enlaces
  for (const a of tags(html, /<a\b[^>]*>/g)) {
    const h = decode(attr(a, 'href') ?? ''); if (!h || /^(mailto:|tel:|javascript:)/.test(h)) continue;
    if (h.startsWith('#')) { check(h === '#' || new RegExp(`\\bid=["']${h.slice(1)}["']`).test(html), `${id} ancla ${h} existe`); continue; }
    if (/^https?:\/\//.test(h) && !h.startsWith(base)) { check(/^https:\/\//.test(h), `${id} enlace externo con https: ${h}`); continue; }
    const p = h.replace(base, '').split('#')[0]; if (p) internal.set(p, path);
  }
}
for (const [t, ps] of seenTitles) check(ps.length === 1, `título duplicado «${t}» en ${ps.join(', ')}`);
for (const [, ps] of seenDesc) check(ps.length === 1, `descripción duplicada en ${ps.join(', ')}`);
for (const [p, from] of internal) {
  const r = await get(p, { method: 'HEAD' });
  check(r.status >= 200 && r.status < 400, `enlace interno ${p} (desde ${from}) → ${r.status}`);
}
// og:image accesible
const home = await (await get('/')).text();
const ogImg = decode(attr(tags(home, /<meta\b[^>]*og:image"[^>]*>/g)[0] ?? '', 'content') ?? '');
const imgRes = ogImg ? await fetch(ogImg.replace(/^https?:\/\/[^/]+/, base), { redirect: 'manual' }) : null;
check(imgRes?.status === 200 && (imgRes.headers.get('content-type') ?? '').startsWith('image/'), `og:image accesible (${imgRes?.status})`);
// 404 real
for (const bad of ['/no-existe/', '/blog/no-existe-este-articulo/', '/blog/categoria/no-existe/']) {
  const r = await get(bad); const html = await r.text();
  check(r.status === 404, `${bad} → 404 real (${r.status})`);
  check(!/rel="canonical"/.test(html) && /noindex/.test(html), `${bad} sin canonical y con noindex`);
}
// robots.txt, llms.txt, cabeceras
const rb = await (await get('/robots.txt')).text();
check(/^User-agent: \*\nDisallow: \/\n$/.test(rb), 'robots.txt (local) = Disallow: /');
const llms = await get('/llms.txt'); const llmsText = await llms.text();
check(llms.status === 200 && /^# Directo Producciones\n/.test(llmsText), `llms.txt → 200 con H1 (${llms.status})`);
for (const l of tags(llmsText, /\]\(([^)]+)\)/g)) { const r = await get(new URL(l).pathname, { method: 'HEAD' }); check(r.status === 200, `llms.txt enlace ${l} → ${r.status}`); }
const hh = await get('/');
check(/noindex/.test(hh.headers.get('x-robots-tag') ?? ''), 'X-Robots-Tag noindex en local');
// cada URL del sitemap se declara a sí misma canónica (coherencia sitemap ↔ canonical)
console.log(`\nURLs auditadas: ${pages.length} · enlaces internos únicos: ${internal.size} · avisos: ${warned} · fallos: ${failed}`);
process.exit(failed ? 1 : 0);
