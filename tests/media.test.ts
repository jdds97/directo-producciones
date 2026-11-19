import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveImage, imgAttrs, uploadKey } from '../src/lib/media.ts';
import { mediaRegistry } from '../src/lib/media-registry.ts';
import { evaluatePublish, mediaReasons, ROLE, type PolicyInput } from '../src/lib/editorial-policy.ts';
import { collections, lists, imageFieldSlugs } from '../src/cms/contract.ts';

const editor = { id: 'u-editor', role: ROLE.editor };
const names = { image: 'foto', ref: 'foto_ref', alt: 'foto_alt', decor: 'foto_decor' };
const slot = { ref: 'equipo/equipo-3', alt: 'Grupo del equipo' };
const opts = { local: false, where: 'prueba' };
const pub = (collection: string, data: Record<string, unknown>): PolicyInput => ({ collection, data, actor: editor, approverIds: new Set(), local: true });
const upload = { id: 'm1', provider: 'local', mimeType: 'image/webp', width: 800, height: 600, focalX: 0.25, focalY: 0.75, meta: { storageKey: '01HXYZ.webp' } };

test('sin edición: foto del sitio con srcset, dimensiones y alt por defecto', () => {
  const img = resolveImage({}, names, slot, opts);
  assert.equal(img.origin, 'library'); assert.equal(img.src, mediaRegistry['equipo/equipo-3'].src); assert.match(img.srcset!, /800w/);
  assert.equal(img.alt, 'Grupo del equipo'); assert.equal(img.width, 1200); assert.equal(img.height, 800);
});
test('foto de la biblioteca de medios: ruta propia, dimensiones y foco', () => {
  const img = resolveImage({ foto: upload, foto_alt: 'Plató nuevo' }, names, slot, opts);
  assert.equal(img.origin, 'upload'); assert.equal(img.src, '/_emdash/api/media/file/01HXYZ.webp'); assert.equal(img.focus, '25% 75%'); assert.equal(img.alt, 'Plató nuevo');
  assert.equal(imgAttrs(img, { sizes: '50vw' }).srcset, undefined);
  assert.equal(imgAttrs(img, { priority: true }).fetchpriority, 'high');
});
test('decorativa: alt vacío; la foto elegida del sitio sustituye a la predeterminada', () => {
  assert.equal(resolveImage({ foto_decor: true }, names, slot, opts).alt, '');
  assert.equal(resolveImage({ foto_ref: 'equipo/equipo-5' }, names, slot, opts).src, mediaRegistry['equipo/equipo-5'].src);
});
test('portadas LCP de Comunicación y Contacto con variante móvil; logos con tamaño intrínseco', () => {
  // Móvil de referencia (412 px × DPR 1,75 ≈ 721 px): debe existir una variante ≤ 800w y el src ser la más ancha.
  for (const slug of ['page_comunicacion', 'page_contacto']) {
    const hero = collections.find(c => c.slug === slug)!.images!.find(i => i.slug === 'hero_foto')!;
    const img = resolveImage({}, names, { ref: hero.ref, alt: hero.alt }, opts);
    const candidates = (img.srcset ?? '').split(',').map(c => c.trim().split(/\s+/)).map(([url, w]) => ({ url, w: Number(w?.replace('w', '')) }));
    const widest = candidates.reduce((a, b) => (b.w > a.w ? b : a));
    assert.ok(Math.min(...candidates.map(c => c.w)) <= 800, `${slug}: ${img.srcset}`);
    assert.equal(img.src, widest.url, `${slug}: el src debe ser el candidato más ancho`);
    assert.equal(img.width, widest.w);
    assert.equal(imgAttrs(img, { sizes: '100vw' }).sizes, '100vw');
  }
  // Logos (ClientBand, Clientes): todos con width/height reales en el registro y emitidos por imgAttrs; la caja la fija el CSS.
  for (const [ref, entry] of Object.entries(mediaRegistry).filter(([, e]) => e.g === 'logo')) {
    assert.ok((entry.w ?? 0) > 0 && (entry.h ?? 0) > 0, `${ref} sin width/height`);
    const logo = imgAttrs(resolveImage({}, names, { ref, alt: 'Logo' }, opts));
    assert.equal(logo.width, entry.w, ref); assert.equal(logo.height, entry.h, ref);
  }
  for (const file of ['src/components/m4/ClientBand.astro', 'src/components/m4/Clientes.astro']) {
    assert.ok(readFileSync(file, 'utf8').includes('{...imgAttrs(client.logo)}'), `${file}: logo sin opciones que oculten el tamaño`);
  }
});
test('rutas, URLs externas, SVG y proveedores ajenos no entran', () => {
  for (const bad of [{ ...upload, provider: 'unsplash' }, { ...upload, mimeType: 'image/svg+xml' }, { id: 'x', src: 'https://evil.example/a.png' }, { ...upload, meta: { storageKey: '../secreto' } }, { ...upload, meta: { storageKey: 'a/b.png' } }]) {
    assert.equal(uploadKey(bad), null);
    assert.throws(() => resolveImage({ foto: bad }, names, slot, opts));
  }
  assert.throws(() => resolveImage({ foto_ref: 'https://evil.example/a.png' }, names, slot, opts));
  assert.throws(() => resolveImage({ foto_ref: '/assets/m4/equipo/equipo-3.jpeg' }, names, slot, opts));
});
test('política: foto subida exige alt propio, evidencia de derechos y tipo admitido', () => {
  const home = collections.find(c => c.slug === 'page_home')!.images![1];
  const n = imageFieldSlugs(home);
  const base = { title: 'Inicio' };
  assert.ok(mediaReasons('page_home', { ...base, [n.image]: upload, [n.alt]: home.alt, media_rights_source: 'Autorización 2026' }).some(r => /texto alternativo/.test(r)), 'alt sin cambiar');
  assert.ok(mediaReasons('page_home', { ...base, [n.image]: upload, [n.alt]: 'Plató nuevo' }).some(r => /derechos/.test(r)), 'sin derechos');
  assert.deepEqual(mediaReasons('page_home', { ...base, [n.image]: upload, [n.alt]: 'Plató nuevo', media_rights_source: 'Autorización 2026' }), []);
  assert.ok(mediaReasons('page_home', { ...base, [n.image]: { ...upload, mimeType: 'image/svg+xml' }, [n.alt]: 'x', media_rights_source: 'y' }).length);
  assert.ok(mediaReasons('page_home', { ...base, [n.ref]: 'https://evil.example/a.png', [n.alt]: 'x' }).length);
  assert.ok(mediaReasons('page_home', { ...base, [n.ref]: 'equipo/equipo-5', [n.alt]: home.alt }).some(r => /texto alternativo/.test(r)), 'foto del sitio cambiada con el alt anterior');
  assert.equal(evaluatePublish(pub('page_home', { ...base, [n.image]: upload, [n.alt]: 'Plató nuevo' })).allow, false);
});
test('equipo: estado explícito y retrato con alt', () => {
  const person = { name: 'Ana', role: 'Cámara', rights_ok: true, rights_source: 'Consentimiento 2026', sort: 1 };
  assert.equal(evaluatePublish(pub('team', { ...person, photo_state: 'pendiente' })).allow, true);
  assert.equal(evaluatePublish(pub('team', { ...person, photo_state: 'con_foto' })).allow, false, 'con_foto sin foto');
  assert.equal(evaluatePublish(pub('team', { ...person, photo_state: 'pendiente', photo_ref: 'equipo/perfiles/curro', photo_alt: 'Ana' })).allow, false, 'pendiente con foto');
  assert.equal(evaluatePublish(pub('team', { ...person, photo_state: 'con_foto', photo_ref: 'equipo/perfiles/curro' })).allow, false, 'sin alt');
  assert.equal(evaluatePublish(pub('team', { ...person, photo_state: 'con_foto', photo_ref: 'equipo/perfiles/curro', photo_alt: 'Ana' })).allow, true);
  assert.equal(evaluatePublish(pub('team', { ...person, photo_state: 'con_foto', photo_ref: 'logos/remax', photo_alt: 'Ana' })).allow, false, 'fuera de los retratos autorizados');
  assert.equal(evaluatePublish(pub('team', { ...person, rights_ok: false, photo_state: 'pendiente' })).allow, false, 'sin derechos');
});
test('contrato: toda ranura y lista de fotos tiene selector, alt y valor por defecto en la biblioteca', () => {
  for (const col of collections) for (const s of col.images ?? []) {
    assert.ok(mediaRegistry[s.ref], `${col.slug}.${s.slug}`);
    const n = imageFieldSlugs(s);
    for (const f of [n.image, n.ref, n.alt, n.decor]) assert.ok(col.fields.some(x => x.slug === f), f);
    assert.ok(col.fields.find(x => x.slug === n.ref)!.options!.includes(s.ref), 'la foto por defecto está entre las opciones');
  }
  assert.ok(lists.find(l => l.slug === 'team')!.fields.some(f => f.slug === 'photo_state'));
});

// ── Correo del equipo: hecho aprobado por id de ficha; correo propio = administrador ──
import { evaluatePublish as evalPublish, ROLE as R } from '../src/lib/editorial-policy.ts';
import { teamEmailFacts } from '../src/cms/contract.ts';
import { approvedFact } from '../src/lib/facts.ts';
test('equipo: los tres correos salen de hechos aprobados, mapeados por ficha (no por nombre)', () => {
  assert.deepEqual(Object.keys(teamEmailFacts).sort(), ['curro', 'fran-vergara', 'sergio-maya']);
  for (const id of Object.values(teamEmailFacts)) assert.ok(approvedFact(id), `${id} sin aprobar`);
  assert.equal(approvedFact(teamEmailFacts['sergio-maya'])?.value, 'smaya@directoproducciones.com');
});
test('equipo: correo propio válido exige administrador registrado; inválido se rechaza; el aprobado no pide aprobación', () => {
  const team = { name: 'X', role: 'Y', photo_state: 'pendiente', visible: true, rights_ok: true, rights_source: 'ok', sort: 1 };
  const run = (email: string | undefined, role: number) => evalPublish({ collection: 'team', data: { ...team, ...(email === undefined ? {} : { email }) }, actor: { id: 'u-admin', role }, approverIds: new Set(['u-admin']), local: true });
  assert.equal(run(undefined, R.editor).allow, true);
  assert.equal(run('smaya@directoproducciones.com', R.editor).allow, true, 'valor del hecho aprobado');
  assert.equal(run('otro@directoproducciones.com', R.editor).allow, false);
  assert.equal(run('otro@directoproducciones.com', R.admin).allow, true);
  assert.equal(run('no-es-correo', R.admin).allow, false);
});
