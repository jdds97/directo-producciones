import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePublish, mediaDenied, mediaBytesDenied, ROLE, type PolicyInput, emptyRequiredFields, slugChangeDenied, panelWriteDenied, termWriteDenied, listWouldBeEmpty, internalLinks, knownRoutes } from '../src/lib/editorial-policy.ts';
import drafts from '../seed/content-drafts.json' with { type: 'json' };
import { readFileSync } from 'node:fs';
import { approvedFact, publicContact } from '../src/lib/facts.ts';
import { reviewMarkerText, unguardedReviewMarker } from '../src/lib/content-policy.ts';

const editor = { id: 'u-editor', role: ROLE.editor };
const admin = { id: 'u-admin', role: ROLE.admin };
const base = (over: Partial<PolicyInput>): PolicyInput => ({ collection: 'page_clientes', data: { title: 'Clientes', hero_titulo_a: 'En buena' }, actor: editor, approverIds: new Set(['u-admin']), local: true, ...over });

test('texto limpio: lo publica un editor (clase A)', () => {
  const d = evaluatePublish(base({}));
  assert.equal(d.allow, true); assert.equal(d.klass, 'A');
});
test('un autor no publica páginas corporativas', () => {
  assert.equal(evaluatePublish(base({ actor: { id: 'u-a', role: ROLE.author } })).allow, false);
  assert.equal(evaluatePublish(base({ actor: undefined })).allow, false);
});
test('cifra, porcentaje, año y servicio fuera de catálogo: clase B, bloqueado para el editor', () => {
  for (const text of ['Más de 500 eventos al año', 'Ahorra un 30 % en tu campaña', 'Desde 2013 con vosotros', 'Hacemos bonding celular', 'Somos líderes del sector'.replace('líderes', 'el mejor')]) {
    const d = evaluatePublish(base({ data: { hero_titulo_a: text } }));
    assert.equal(d.klass, 'B', text); assert.equal(d.allow, false, text);
  }
});
test('clase B con admin registrado: permitido; admin sin registro: no', () => {
  const data = { hero_titulo_a: 'Desde 2013 con vosotros' };
  assert.equal(evaluatePublish(base({ data, actor: admin })).allow, true);
  assert.equal(evaluatePublish(base({ data, actor: admin, approverIds: new Set() })).allow, false);
  assert.equal(evaluatePublish(base({ data, actor: { id: 'u-admin', role: ROLE.editor } })).allow, false);
});
test('marcadores y frases prohibidas se bloquean aunque apruebe un admin', () => {
  for (const text of ['TODO revisar', 'Sin cortes garantizado', 'Los líderes del streaming', '[Fecha de actualización]', 'lorem ipsum']) {
    assert.equal(evaluatePublish(base({ data: { hero_titulo_a: text }, actor: admin })).allow, false, text);
  }
});
test('«todo» en español no es un marcador; «TODO:» sí', () => {
  assert.equal(evaluatePublish(base({ data: { hero_titulo_a: 'Capacidad operativa en todo el territorio' } })).allow, true);
  assert.equal(evaluatePublish(base({ data: { hero_titulo_a: 'TODO: revisar este titular' } })).allow, false);
});
test('hechos: token a hecho no aprobado bloquea; teclear el dato también', () => {
  assert.equal(evaluatePublish(base({ data: { hero_titulo_a: 'Llámanos {{fact:contact.public_phone}}' } })).allow, false);
  assert.equal(evaluatePublish(base({ data: { hero_titulo_a: 'Llámanos al 679 729 727' } })).allow, false);
  assert.equal(evaluatePublish(base({ data: { hero_titulo_a: 'Escríbenos a info@directoproducciones.com' } })).allow, false);
  assert.equal(evaluatePublish(base({ data: { hero_titulo_a: 'Escríbenos: {{fact:contact.form_recipient_email}}' } })).allow, true);
});
test('un hecho aprobado referenciado no cuenta como afirmación nueva', () => {
  const d = evaluatePublish(base({ data: { hero_titulo_a: 'Cobertura: {{fact:service.communication}}' } }));
  assert.equal(d.allow, true); assert.deepEqual(d.factIds, ['service.communication']);
});
test('legales: siempre clase B', () => {
  const data = { bloque_001: 'Texto jurídico validado por el titular.' };
  const d = evaluatePublish(base({ collection: 'legal_privacidad', data }));
  assert.equal(d.klass, 'B'); assert.equal(d.allow, false);
  assert.equal(evaluatePublish(base({ collection: 'legal_privacidad', data, actor: admin })).allow, true);
});
test('listas: sin derechos ni evidencia no se publica', () => {
  const logo = { name: 'Cliente', logo_ref: 'logos/remax', rights_ok: false, rights_source: '' };
  assert.equal(evaluatePublish(base({ collection: 'clients', data: logo })).allow, false);
  assert.equal(evaluatePublish(base({ collection: 'clients', data: { ...logo, rights_ok: true } })).allow, false);
  assert.equal(evaluatePublish(base({ collection: 'clients', data: { ...logo, rights_ok: true, rights_source: 'Autorización escrita 2026' } })).allow, true);
  assert.equal(evaluatePublish(base({ collection: 'clients', data: { ...logo, rights_ok: true, rights_source: 'x', logo_ref: '/otra/ruta.png' } })).allow, false);
});
test('posts: sintético local = A; real = B; imagen sin alt bloquea', () => {
  const content = [{ _type: 'block', children: [{ text: 'Cómo preparar una nota de prensa' }] }];
  const synth = { title: 'Nota', excerpt: 'Guía', content, synthetic: true };
  assert.equal(evaluatePublish(base({ collection: 'posts', data: synth, actor: { id: 'u', role: ROLE.author } })).klass, 'A');
  assert.equal(evaluatePublish(base({ collection: 'posts', data: { ...synth, synthetic: false }, actor: { id: 'u', role: ROLE.author } })).allow, false);
  assert.equal(evaluatePublish(base({ collection: 'posts', data: { ...synth, featured_image: { id: 'm' } } })).allow, false);
  assert.equal(evaluatePublish(base({ collection: 'posts', data: { ...synth, content: [{ _type: 'image' }] } })).allow, false);
  assert.equal(evaluatePublish(base({ collection: 'posts', data: synth, local: false, actor: { id: 'u', role: ROLE.author } })).allow, false);
});
test('colección sin política: denegada', () => assert.equal(evaluatePublish(base({ collection: 'otra' })).allow, false));
test('medios: solo imágenes rasterizadas y ≤ 10 MB', () => {
  assert.equal(mediaDenied({ type: 'image/webp', size: 1000, name: 'a.webp' }), null);
  assert.ok(mediaDenied({ type: 'image/svg+xml', size: 10, name: 'a.svg' }));
  assert.ok(mediaDenied({ type: 'application/pdf', size: 10, name: 'a.pdf' }));
  assert.ok(mediaDenied({ type: 'image/png', size: 11 * 1024 * 1024, name: 'a.png' }));
  assert.ok(mediaDenied({ type: 'image/png', size: 10, name: 'disfrazado.svg' }), 'extensión SVG con tipo falso');
});

test('firma real del archivo: HTML o SVG con nombre .png y tipos cruzados se rechazan', () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const webp = Uint8Array.from([...'RIFF'].map(c => c.charCodeAt(0)).concat([1, 0, 0, 0], [...'WEBP'].map(c => c.charCodeAt(0))));
  const text = (t: string) => Uint8Array.from([...t].map(c => c.charCodeAt(0)));
  assert.equal(mediaBytesDenied('image/png', png), null);
  assert.equal(mediaBytesDenied('image/webp', webp), null);
  assert.equal(mediaBytesDenied('image/jpeg', Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), null);
  assert.equal(mediaBytesDenied('image/avif', text('\0\0\0\x1cftypavif')), null);
  assert.ok(mediaBytesDenied('image/png', text('<html>no soy png</html>')), 'HTML con tipo PNG');
  assert.ok(mediaBytesDenied('image/png', text('<svg xmlns="http://www.w3.org/2000/svg"/>')), 'SVG con tipo PNG');
  assert.ok(mediaBytesDenied('image/jpeg', png), 'PNG declarado como JPEG');
  assert.ok(mediaBytesDenied('image/png', new Uint8Array()), 'vacío');
});

// ── Guardas estructurales (auditoría EmDash, fase 2) ─────────────────────────────────────────────
const seedMain = (col: string) => ((drafts as { content: Record<string, { data: Record<string, unknown> }[]> }).content[col][0].data);
test('campos obligatorios: la semilla completa pasa; vaciar un texto de «Cabecera y pie» o de una página se bloquea', () => {
  for (const col of ['site_chrome', 'page_home', 'page_clientes', 'page_404']) assert.deepEqual(emptyRequiredFields(col, seedMain(col)), [], col);
  assert.equal(emptyRequiredFields('site_chrome', { ...seedMain('site_chrome'), nav_blog: '  ' }).length, 1);
  assert.equal(emptyRequiredFields('page_clientes', { ...seedMain('page_clientes'), hero_eyebrow: undefined }).length, 1);
  assert.deepEqual(emptyRequiredFields('team', {}), [], 'las listas tienen su propia validación');
});
test('slugs: páginas y fichas fijos; entradas con formato válido y fijas una vez publicadas', () => {
  assert.match(slugChangeDenied('page_404', { slug: 'main', published: true }, 'error') ?? '', /fijo/);
  assert.equal(slugChangeDenied('page_404', { slug: 'main', published: true }, 'main'), null);
  assert.match(slugChangeDenied('team', { slug: 'curro', published: true }, 'francisco') ?? '', /fijo/);
  assert.equal(slugChangeDenied('team', null, 'nueva-persona'), null);
  assert.ok(slugChangeDenied('team', null, 'Persona Ñ'));
  assert.match(slugChangeDenied('posts', { slug: 'nota', published: true }, 'nota-2') ?? '', /publicada/);
  assert.equal(slugChangeDenied('posts', { slug: 'nota', published: false }, 'nota-2'), null);
  for (const bad of ['../contacto', 'Mi Entrada Ñ', 'nota_1', '-nota', 'nota--2', '']) assert.ok(slugChangeDenied('posts', null, bad), bad);
  assert.equal(slugChangeDenied('posts', { slug: 'nota', published: true }, undefined), null, 'guardar sin tocar el slug');
});
test('panel: esquema, ajustes, menús, widgets, secciones, firmas, redirecciones y duplicar páginas son de solo lectura', () => {
  const denied = [
    ['POST', '/_emdash/api/schema/collections'], ['PUT', '/_emdash/api/schema/collections/site_chrome/fields/nav_blog'], ['DELETE', '/_emdash/api/schema/collections/page_404'],
    ['POST', '/_emdash/api/schema/block-types'], ['PUT', '/_emdash/api/settings'], ['POST', '/_emdash/api/menus'], ['POST', '/_emdash/api/widget-areas'],
    ['POST', '/_emdash/api/widget-areas/x/widgets'], ['POST', '/_emdash/api/sections'], ['POST', '/_emdash/api/admin/bylines'], ['PUT', '/_emdash/api/admin/bylines/1'],
    ['POST', '/_emdash/api/admin/byline-fields'], ['POST', '/_emdash/api/redirects'], ['DELETE', '/_emdash/api/redirects/1'], ['POST', '/_emdash/api/taxonomies'],
    ['POST', '/_emdash/api/taxonomies/bulk-tag'], ['POST', '/_emdash/api/content/page_home/01X/duplicate'], ['POST', '/_emdash/api/content/team/01X/duplicate'],
    ['POST', '/_emdash/api/content/page_home'], ['DELETE', '/_emdash/api/content/site_chrome/01X'],
  ];
  for (const [m, p] of denied) assert.ok(panelWriteDenied(m, p), `${m} ${p}`);
  const allowed = [
    ['GET', '/_emdash/api/schema/collections'], ['GET', '/_emdash/api/redirects'], ['GET', '/_emdash/api/menus'], ['POST', '/_emdash/api/content/posts/01X/duplicate'],
    ['PUT', '/_emdash/api/content/page_home/01X'], ['POST', '/_emdash/api/content/page_home/01X/publish'], ['POST', '/_emdash/api/content/team'],
    ['DELETE', '/_emdash/api/content/team/01X'], ['POST', '/_emdash/api/taxonomies/tag/terms'], ['PUT', '/_emdash/api/taxonomies/tag/terms/streaming'],
  ];
  for (const [m, p] of allowed) assert.equal(panelWriteDenied(m, p), null, `${m} ${p}`);
});
test('términos: categorías solo administración; nadie cambia el slug ni borra un término en uso', () => {
  const t = (o: Partial<Parameters<typeof termWriteDenied>[0]>) => termWriteDenied({ method: 'POST', taxonomy: 'tag', role: ROLE.editor, inUse: false, ...o });
  assert.ok(t({ taxonomy: 'category' }), 'editor crea categoría');
  assert.equal(t({ taxonomy: 'category', role: ROLE.admin }), null);
  assert.equal(t({}), null, 'editor crea etiqueta');
  assert.ok(t({ method: 'PUT', termSlug: 'streaming', bodySlug: 'stream', inUse: true }));
  assert.ok(t({ method: 'PUT', taxonomy: 'category', role: ROLE.admin, termSlug: 'produccion-audiovisual', bodySlug: 'produccion', inUse: true }), 'ni administración');
  assert.equal(t({ method: 'PUT', termSlug: 'streaming', bodySlug: 'streaming', inUse: true }), null, 'cambiar solo el nombre visible');
  assert.equal(t({ method: 'PUT', termSlug: 'nueva', bodySlug: 'nueva-2', inUse: false }), null);
  assert.ok(t({ method: 'DELETE', termSlug: 'streaming', inUse: true }));
  assert.ok(t({ method: 'DELETE', taxonomy: 'category', role: ROLE.admin, termSlug: 'x', inUse: true }));
  assert.equal(t({ method: 'DELETE', termSlug: 'sin-uso', inUse: false }), null);
});
test('listas: nunca se quedan sin fichas visibles publicadas (proyectos, equipo, clientes, banda)', () => {
  const rows = [{ id: 'a', visible: true }, { id: 'b', visible: false }];
  assert.equal(listWouldBeEmpty(rows, 'a', null), true, 'retirar la única visible');
  assert.equal(listWouldBeEmpty(rows, 'a', false), true, 'ocultar la única visible');
  assert.equal(listWouldBeEmpty(rows, 'b', null), false);
  assert.equal(listWouldBeEmpty([...rows, { id: 'c', visible: 1 }], 'a', false), false);
  assert.equal(listWouldBeEmpty([], 'nueva', true), false, 'publicar la primera ficha visible');
  assert.equal(listWouldBeEmpty([], 'nueva', false), true);
});
test('enlaces internos de las entradas: se clasifican para comprobar que existen', () => {
  const body = [{ _type: 'block', markDefs: [
    { _type: 'link', href: '/contacto/' }, { _type: 'link', href: '/no-existe' }, { _type: 'link', href: 'https://directoproducciones.com/streaming/#x' },
    { _type: 'link', href: '/blog/otra-nota/' }, { _type: 'link', href: '/blog/categoria/comunicacion-marketing/' }, { _type: 'link', href: '/blog/etiqueta/streaming/' },
    { _type: 'link', href: '/blog/?categoria=produccion-audiovisual' }, { _type: 'link', href: 'https://otra-web.example.org/' }, { _type: 'link', href: 'mailto:a@b.es' }, { _type: 'link', href: '#seccion' },
  ] }];
  const links = internalLinks(body).map(l => `${l.kind}:${l.slug}`);
  assert.deepEqual(links, ['route:/contacto/', 'route:/no-existe/', 'route:/streaming/', 'post:otra-nota', 'category:comunicacion-marketing', 'tag:streaming', 'category:produccion-audiovisual']);
  for (const r of ['/', '/contacto/', '/streaming/', '/portfolio/', '/blog/', '/quienes-somos/', '/cookies/']) assert.ok(knownRoutes.has(r), r);
  for (const r of ['/no-existe/', '/404', '/interno/guia/']) assert.ok(!knownRoutes.has(r), r);
});
test('producción: teléfono y correo solo aprobados y avisos de revisión solo dentro de <ReviewNote>', () => {
  // Sin aprobación válida el dato se omite (null), no rompe la página; local y preview siguen mostrando el hecho decidido.
  const digits = (id: string) => approvedFact(id)?.value.replace(/\D/g, '') ?? null;
  assert.equal(publicContact('production').phone?.digits ?? null, digits('contact.public_phone'));
  assert.equal(publicContact('production').email, approvedFact('contact.email')?.value ?? null);
  for (const env of ['local', 'preview'] as const) assert.deepEqual(publicContact(env), { phone: { digits: '679729727', display: '679 729 727' }, email: 'info@directoproducciones.com' }, env);
  assert.equal(unguardedReviewMarker('---\nconst a = "provisional";\n---\n<ReviewNote><p>Revisión local: se simula</p></ReviewNote><p>Hola</p><style>.maqueta{}</style>'), undefined);
  assert.equal(unguardedReviewMarker('<ReviewNote>x</ReviewNote><p>Muestra provisional</p>'), 'provisional');
  for (const name of ['ContactForm', 'Portfolio', 'Cookies']) assert.equal(unguardedReviewMarker(readFileSync(`src/components/m4/${name}.astro`, 'utf8')), undefined, name);
  assert.match(readFileSync('src/components/m4/ReviewNote.astro', 'utf8'), /\{APP_ENV !== "production" && <slot \/>\}/);
  assert.ok(reviewMarkerText.test('En esta versión local no se cargan herramientas') && !reviewMarkerText.test('Producción audiovisual y streaming'));
});
test('avisos de revisión: límites de palabra («maqueta» sí, «maquetación» no)', () => {
  for (const text of ['Los controles son una maqueta.', 'Dos maquetas', 'En esta revisión local el envío se simula.', 'Muestra provisional', 'Datos simulados',
    'El envío se simulará.', 'Los envíos se simulan', 'Se envía simuladamente',
    'Plantilla de diseño.', '[Texto legal pendiente de revisión]', 'Deben redactarse y revisarse', 'Pendiente de definir el canal', 'antes de su publicación', 'antes de publicarlos']) {
    assert.ok(reviewMarkerText.test(text), text);
  }
  for (const text of ['La estructura y la maquetación se cambian por pull request.', 'Maquetación editorial', 'Simulación de costes', 'provisionalmente', 'Revisión de derechos', 'Aviso publicado']) {
    assert.ok(!reviewMarkerText.test(text), text);
  }
});
test('legales: un aviso de revisión bloquea la publicación aunque apruebe un admin, en cualquier entorno', () => {
  const legal = (col: string, bloque_015: string, local = false) => evaluatePublish(base({ collection: col, data: { ...seedMain(col), bloque_015 }, actor: admin, local }));
  for (const local of [true, false]) {
    const d = legal('legal_cookies', 'Los controles de esta página son una maqueta y no guardan preferencias.', local);
    assert.equal(d.allow, false); assert.ok(d.reasons.some(r => /aviso de revisión.*«maqueta»/.test(r)), d.reasons.join(' '));
  }
  assert.equal(evaluatePublish(base({ collection: 'legal_aviso', data: { ...seedMain('legal_aviso'), bloque_014: 'Las condiciones deben redactarse antes de su publicación.' }, actor: admin })).allow, false);
  assert.equal(legal('legal_cookies', 'Las cookies no afectan a la maquetación de la página.').allow, true, '«maquetación» no es un aviso');
  // Los borradores semilla de los tres textos legales son publicables por un admin registrado (sin avisos, corchetes ni datos tecleados).
  for (const col of ['legal_cookies', 'legal_privacidad', 'legal_aviso']) {
    const d = evaluatePublish(base({ collection: col, data: seedMain(col), actor: admin, local: false }));
    assert.deepEqual(d.reasons, [], col); assert.equal(d.klass, 'B', col);
  }
});
