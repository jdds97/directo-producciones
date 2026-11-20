import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { buildSeo, jsonLdScript, llmsTxt, normalizePath, organization, PAGES, robotsTxt, rssXml, sitemapXml, staticSitemapPaths } from '../src/lib/seo';
import { resolveRedirect, robotsHeader, urlMapRows, type UrlMapRow } from '../src/lib/redirects';
import { blogUpdatedAt } from '../src/lib/blog';

const local = 'http://localhost:4460';
const page = (env: 'local' | 'preview' | 'production', path = '/servicios/', extra = {}) => buildSeo({ env, requestOrigin: local, path, ...extra });

test('local y preview: noindex y canonical del propio origen, nunca de producción', () => {
  for (const env of ['local', 'preview'] as const) {
    const seo = page(env);
    assert.equal(seo.robots, 'noindex, nofollow, noarchive');
    assert.equal(seo.canonical, `${local}/servicios/`);
    assert.match(seo.title, / · Borrador$/);
  }
});
test('producción: indexable, canonical en el apex sin query, título sin «Borrador»', () => {
  const seo = buildSeo({ env: 'production', requestOrigin: 'https://www.directoproducciones.com', path: '/servicios', search: '?utm_source=x' });
  assert.equal(seo.robots, 'index, follow, max-image-preview:large');
  assert.equal(seo.canonical, 'https://directoproducciones.com/servicios/');
  assert.equal(seo.title, 'Servicios · Directo Producciones');
  // Un título que con la marca pasaría de 60 caracteres (ficha SEO de una entrada) va sin ella.
  const long = 'Streaming de eventos en Sevilla: guía para tu directo';
  assert.equal(buildSeo({ env: 'production', requestOrigin: 'https://directoproducciones.com', path: '/blog/x/', title: long }).title, long);
  assert.equal(seo.og['og:url'], seo.canonical);
  assert.match(seo.og['og:image'], /^https:\/\/directoproducciones\.com\/og\//);
});
test('404, interno, etiquetas y archivos paginados no se indexan; el 404 no tiene canonical', () => {
  assert.equal(page('production', '/nada/', { notFound: true }).canonical, null);
  assert.equal(page('production', '/nada/', { notFound: true }).robots, 'noindex, follow');
  assert.equal(page('production', '/interno/guia/', { index: false }).robots, 'noindex, follow');
  assert.equal(page('production', '/blog/', { search: '?cursor=abc' }).robots, 'noindex, follow');
  assert.equal(page('production', '/blog/', { search: '?cursor=abc' }).canonical, 'https://directoproducciones.com/blog/');
});
test('toda página pública tiene título y descripción propios y distintos, sin texto de relleno', () => {
  const descriptions = new Set<string>(), titles = new Set<string>();
  for (const path of Object.keys(PAGES)) {
    const seo = buildSeo({ env: 'production', requestOrigin: local, path });
    assert.ok(seo.title.length <= 75 && seo.title.includes('Directo Producciones'), `${path}: título`);
    assert.ok(seo.description.length >= 40 && seo.description.length <= 200, `${path}: descripción ${seo.description.length}`);
    assert.doesNotMatch(seo.description + seo.title, /Revisión local|lorem|TODO|garantizamos|líderes|100\s*%/i);
    descriptions.add(seo.description); titles.add(seo.title);
  }
  assert.equal(descriptions.size, Object.keys(PAGES).length);
  assert.equal(titles.size, Object.keys(PAGES).length);
});
test('la ficha SEO del CMS sustituye al default y no duplica la marca', () => {
  const seo = page('production', '/servicios/', { title: 'Directo Producciones: servicios', description: 'Descripción editada.' });
  assert.equal(seo.title, 'Directo Producciones: servicios');
  assert.equal(seo.description, 'Descripción editada.');
});
test('JSON-LD: Organization solo con hechos aprobados (redes y localidad de la sede sí; sin teléfono/correo/calle mientras no estén aprobados)', () => {
  const home = page('production', '/');
  assert.deepEqual(home.jsonLd.map(d => (d as { '@type': string })['@type']), ['Organization', 'WebSite']);
  const org = organization('https://directoproducciones.com');
  assert.equal(org.name, 'Directo Producciones');
  assert.deepEqual(org.sameAs, ['https://www.instagram.com/directoproducciones/', 'https://www.facebook.com/directoproducciones/', 'https://twitter.com/directoprodu']);
  assert.deepEqual(org.address, { '@type': 'PostalAddress', addressLocality: 'Sevilla', addressCountry: 'ES' });
  for (const key of ['telephone', 'email', 'contactPoint', 'aggregateRating'] as const) assert.ok(!(key in org), key);
});
test('JSON-LD: breadcrumb en interiores y BlogPosting con fechas reales; sin FAQPage ni reseñas', () => {
  const inner = page('production', '/clientes/').jsonLd[0] as { itemListElement: { position: number; item: string }[] };
  assert.equal(inner.itemListElement.length, 2);
  assert.equal(inner.itemListElement[1].item, 'https://directoproducciones.com/clientes/');
  const post = page('production', '/blog/mi-entrada/', { type: 'article', title: 'Mi entrada', description: 'Resumen de la entrada.',
    article: { publishedTime: '2026-10-01T10:00:00.000Z', modifiedTime: '2026-10-02T10:00:00.000Z', author: 'Ana', section: 'Streaming' },
    crumbs: [{ name: 'Inicio', path: '/' }, { name: 'Blog', path: '/blog/' }, { name: 'Mi entrada', path: '/blog/mi-entrada/' }] });
  const article = post.jsonLd.find(d => (d as { '@type': string })['@type'] === 'BlogPosting') as Record<string, unknown>;
  assert.equal(article.datePublished, '2026-10-01T10:00:00.000Z');
  assert.equal(article.dateModified, '2026-10-02T10:00:00.000Z');
  assert.deepEqual(article.author, { '@type': 'Person', name: 'Ana' });
  // La normalización no absorbe nombres que solo se parecen.
  const other = page('production', '/blog/mi-entrada/', { type: 'article', title: 'Mi entrada', article: { author: 'Directo Producciones Sevilla' } });
  assert.deepEqual((other.jsonLd.find(d => (d as { '@type': string })['@type'] === 'BlogPosting') as Record<string, unknown>).author,
    { '@type': 'Person', name: 'Directo Producciones Sevilla' });
  // La empresa como autora (o sin autor) es la Organization del sitio, nunca una Person.
  for (const author of ['Directo Producciones', 'directo  producciones', ' DIRECTO PRODUCCIONES S.L. ', 'Directo Producciones, SL', 'Directo Producciones.', ' ', undefined]) {
    const own = page('production', '/blog/mi-entrada/', { type: 'article', title: 'Mi entrada', article: { author } });
    const posting = own.jsonLd.find(d => (d as { '@type': string })['@type'] === 'BlogPosting') as Record<string, unknown>;
    assert.deepEqual(posting.author, { '@type': 'Organization', '@id': 'https://directoproducciones.com/#organization', name: 'Directo Producciones', url: 'https://directoproducciones.com/' });
  }
  // lastmod/dateModified: EmDash deja updatedAt en entry.data, no en la raíz de la entrada.
  assert.equal(blogUpdatedAt({ id: 'x', data: { updatedAt: new Date('2026-10-05T08:00:00Z'), publishedAt: '2026-10-01T10:00:00.000Z' } }), '2026-10-05T08:00:00.000Z');
  assert.equal(blogUpdatedAt({ id: 'x', data: {} }), undefined);
  assert.equal(post.og['article:published_time'], '2026-10-01T10:00:00.000Z');
  assert.doesNotMatch(JSON.stringify(post.jsonLd), /FAQPage|AggregateRating|Review/);
  assert.equal(page('production', '/nada/', { notFound: true }).jsonLd.length, 0);
});
test('jsonLdScript no puede cerrar el <script>', () => {
  assert.doesNotMatch(jsonLdScript({ a: '</script><b>' }), /</);
});
test('robots.txt por entorno; sitemap con URLs canónicas únicas y escapadas', () => {
  assert.equal(robotsTxt('local', local), 'User-agent: *\nDisallow: /\n');
  assert.equal(robotsTxt('preview', local), 'User-agent: *\nDisallow: /\n');
  const prod = robotsTxt('production', local);
  assert.match(prod, /^User-agent: \*\nAllow: \/\n/);
  assert.match(prod, /Sitemap: https:\/\/directoproducciones\.com\/sitemap\.xml/);
  assert.doesNotMatch(prod, /Disallow: \/_emdash\/\n|Disallow: \/\n/); // los medios del blog (/_emdash/api/media/) deben poder rastrearse
  const xml = sitemapXml('production', local, [...staticSitemapPaths(), { path: '/blog/a&b', lastmod: '2026-10-01T00:00:00.000Z' }, { path: '/servicios' }]);
  assert.equal((xml.match(/<loc>/g) ?? []).length, Object.keys(PAGES).length + 1);
  assert.match(xml, /<loc>https:\/\/directoproducciones\.com\/blog\/a&amp;b\/<\/loc><lastmod>2026-10-01/);
  assert.doesNotMatch(xml, /localhost|\/interno\/|\/_emdash\/|<loc>[^<]*\?/);
});
test('llms.txt solo enlaza páginas públicas canónicas (sin legales)', () => {
  const text = llmsTxt('production', local);
  assert.match(text, /^# Directo Producciones\n\n> /);
  assert.match(text, /\(https:\/\/directoproducciones\.com\/streaming\/\)/);
  assert.match(text, /\(https:\/\/directoproducciones\.com\/preguntas-frecuentes\/\)/);
  assert.doesNotMatch(text, /privacidad|aviso-legal|cookies|condiciones|localhost|_emdash/);
});
test('normalizePath', () => {
  assert.equal(normalizePath('/servicios'), '/servicios/');
  assert.equal(normalizePath('/sitemap.xml'), '/sitemap.xml');
  assert.equal(normalizePath('/blog/?cursor=1'), '/blog/');
});

// ---- redirecciones ----
const approvedRows = (rows: Partial<UrlMapRow>[]) => new Map(rows.map(r => [normalizePath(r.path!), r as UrlMapRow]));
test('mapa real: nada se redirige mientras no haya filas aprobadas, solo www→apex en producción', () => {
  assert.equal(resolveRedirect(new URL('https://directoproducciones.com/carrito/'), 'production'), null);
  assert.equal(resolveRedirect(new URL('https://www.directoproducciones.com/carrito/'), 'production')?.status, 301);
  assert.deepEqual(resolveRedirect(new URL('https://www.directoproducciones.com/quienes-somos/?a=1'), 'production'),
    { status: 301, location: 'https://directoproducciones.com/quienes-somos/?a=1' });
  assert.equal(resolveRedirect(new URL('http://localhost:4460/'), 'local'), null);
  assert.equal(resolveRedirect(new URL('https://www.directoproducciones.com/'), 'preview'), null);
  assert.equal(urlMapRows.filter(r => r.aprobado_por).length, 0);
});
test('fila aprobada: un solo salto al destino final, 410 para retiradas, también desde www', () => {
  const rows = approvedRows([{ path: '/politica-de-cookies/', accion: 'redirigir', destino: '/cookies/' }, { path: '/shop/', accion: 'retirar' }]);
  assert.deepEqual(resolveRedirect(new URL('https://www.directoproducciones.com/politica-de-cookies'), 'production', rows),
    { status: 301, location: 'https://directoproducciones.com/cookies/' });
  assert.deepEqual(resolveRedirect(new URL('https://directoproducciones.com/shop/'), 'production', rows), { status: 410 });
});
test('X-Robots-Tag por entorno: producción solo protege admin/API/interno (los medios del blog quedan rastreables)', () => {
  assert.equal(robotsHeader('local', '/'), 'noindex, nofollow');
  assert.equal(robotsHeader('preview', '/blog/'), 'noindex, nofollow');
  assert.equal(robotsHeader('production', '/blog/'), null);
  assert.equal(robotsHeader('production', '/_emdash/admin/'), 'noindex, nofollow');
  assert.equal(robotsHeader('production', '/_emdash/api/content/posts'), 'noindex, nofollow');
  assert.equal(robotsHeader('production', '/_emdash/api/media/file/abc'), null);
  assert.equal(robotsHeader('production', '/api/contacto'), 'noindex, nofollow');
});

test('Open Graph: 1200×630 propio por página con foto y el de Inicio por defecto; la imagen de la entrada manda', () => {
  for (const path of ['/', '/servicios/', '/streaming/', '/comunicacion-marketing/', '/portfolio/', '/clientes/', '/contacto/', '/blog/']) {
    const seo = buildSeo({ env: 'production', requestOrigin: local, path });
    assert.equal(seo.og['og:image:width'], '1200'); assert.equal(seo.og['og:image:height'], '630');
    const file = new URL(seo.og['og:image']).pathname;
    assert.ok(existsSync(`public${file}`), `${path}: falta public${file}`);
  }
  assert.match(buildSeo({ env: 'production', requestOrigin: local, path: '/portfolio/' }).og['og:image'], /\/og\/portfolio\.jpg$/);
  assert.match(buildSeo({ env: 'production', requestOrigin: local, path: '/contacto/' }).og['og:image'], /\/og\/home\.jpg$/);
  assert.match(buildSeo({ env: 'production', requestOrigin: local, path: '/blog/x/', image: { src: '/m.jpg' } }).og['og:image'], /\/m\.jpg$/);
});
test('iconos y manifest existen y Base.astro los enlaza', () => {
  const base = readFileSync('src/layouts/Base.astro', 'utf8');
  for (const f of ['favicon.ico', 'favicon-32.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'site.webmanifest']) {
    assert.ok(existsSync(`public/${f}`), f); assert.ok(base.includes(`/${f}`) || f.startsWith('icon-'), `Base no enlaza ${f}`);
  }
  const manifest = JSON.parse(readFileSync('public/site.webmanifest', 'utf8'));
  for (const icon of manifest.icons) assert.ok(existsSync(`public${icon.src}`));
  assert.match(base, /name="theme-color"/);
});
test('RSS: URLs canónicas del apex, fechas RFC 822, texto escapado y sin cuerpo completo', () => {
  const feed = rssXml('production', local, [{ title: 'A & B <1>', path: '/blog/a-b', description: 'Extracto', pubDate: '2026-10-01T10:00:00.000Z' }, { title: 'Sin fecha', path: '/blog/c/' }]);
  assert.match(feed, /<link>https:\/\/directoproducciones\.com\/blog\/a-b\/<\/link>/);
  assert.match(feed, /<title>A &amp; B &lt;1&gt;<\/title>/);
  assert.match(feed, /<pubDate>Thu, 01 Oct 2026 10:00:00 GMT<\/pubDate>/);
  assert.match(feed, /<atom:link href="https:\/\/directoproducciones\.com\/rss\.xml"/);
  assert.doesNotMatch(feed, /localhost/);
});
test('mapa de URLs: las 53 filas sin resolver llevan propuesta, ninguna aprobada ni aplicada; patrones propuestos aparte', () => {
  const map = JSON.parse(readFileSync('config/url-map.json', 'utf8')) as { rows: (UrlMapRow & { propuesta?: object })[]; patrones: { path: string; aprobado_por?: string }[] };
  const open = map.rows.filter(r => r.accion !== 'conservar-ruta');
  assert.equal(open.length, 53);
  assert.ok(open.every(r => r.accion !== 'pendiente' || r.propuesta));
  assert.deepEqual(map.patrones.map(p => p.path), ['/feed/', '/sitemap_index.xml', '/wp-content/uploads/']);
  assert.ok(map.patrones.every(p => !p.aprobado_por));
  assert.equal(resolveRedirect(new URL('https://directoproducciones.com/galeria/'), 'production'), null);
  assert.equal(resolveRedirect(new URL('https://directoproducciones.com/feed/'), 'production'), null);
});
test('local-gate deja pasar /rss.xml (no lo bloquea la regex de feeds)', () => {
  const src = readFileSync('src/cms/local-gate.ts', 'utf8');
  assert.match(src.slice(src.indexOf('const allowedRoot'), src.indexOf('export const onRequest')), /'\/rss\.xml'/);
});
