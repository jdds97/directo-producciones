// Vídeo editable: lectura de un MP4 subido, respaldo en el vídeo del sitio, contrato de las ranuras y proyectos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveVideo, videoKey, uploadKey, MEDIA_ROUTE } from '../src/lib/media.ts';
import { videoRegistry } from '../src/lib/media-registry.ts';
import { collections, lists, videoFieldSlugs } from '../src/cms/contract.ts';
import { contractErrors } from '../src/cms/contract-check.ts';
import { videoObject } from '../src/lib/seo.ts';

const names = { file: 'v', ref: 'v_ref' };
const slot = { ref: 'coberturas/hero-review-desktop' };
const prod = { local: false, where: 'prueba' };
const mp4 = (extra: object = {}) => ({ id: 'x', src: `${MEDIA_ROUTE}01ABC.mp4`, mimeType: 'video/mp4', meta: { storageKey: '01ABC.mp4' }, ...extra });

test('un MP4 subido prevalece sobre el vídeo del sitio', () => {
  assert.deepEqual(resolveVideo({ v: mp4() }, names, slot, prod), { src: `${MEDIA_ROUTE}01ABC.mp4`, origin: 'upload' });
});
test('sin vídeo propio se usa el elegido o el de la ranura', () => {
  assert.equal(resolveVideo({}, names, slot, prod).src, videoRegistry['coberturas/hero-review-desktop'].src);
  assert.equal(resolveVideo({ v_ref: 'coberturas/work-rugby' }, names, slot, prod).origin, 'library');
  assert.equal(resolveVideo({ v_ref: 'coberturas/work-rugby' }, names, slot, prod).src, videoRegistry['coberturas/work-rugby'].src);
});
test('proveedor externo, tipo o extensión no válidos no se sirven como vídeo propio', () => {
  for (const bad of [mp4({ provider: 's3' }), mp4({ mimeType: 'video/webm' }), mp4({ meta: { storageKey: '01ABC.mov' }, src: '' }), { src: 'https://x.test/a.mp4' }]) {
    assert.equal(videoKey(bad), null);
    assert.equal(resolveVideo({ v: bad }, names, slot, prod).origin, 'library');
  }
  assert.equal(uploadKey(mp4()), null, 'un vídeo no es una foto');
});
test('una clave del sitio desconocida falla fuera de local', () => {
  assert.throws(() => resolveVideo({ v_ref: 'nope' }, names, slot, prod), /biblioteca autorizada/);
});
test('las ranuras de vídeo generan campo file y selector cerrado, y el contrato es coherente', () => {
  for (const col of collections.filter(c => c.videos)) for (const s of col.videos!) {
    const n = videoFieldSlugs(s);
    assert.equal(col.fields.find(f => f.slug === n.file)?.type, 'file');
    assert.ok(col.fields.find(f => f.slug === n.ref)?.options?.includes(s.ref));
  }
  assert.deepEqual(contractErrors({}).filter(e => /vídeo por defecto|duplicado|slug inválido/.test(e)), []);
});
test('projects: vídeo propio, vertical, orden, enlace y Inicio son campos del contrato', () => {
  const f = Object.fromEntries(lists.find(l => l.slug === 'projects')!.fields.map(x => [x.slug, x]));
  for (const slug of ['video', 'video_vertical']) assert.equal(f[slug].type, 'file');
  for (const slug of ['client', 'category', 'year', 'link', 'orientation', 'home_layout', 'show_home', 'home_sort', 'poster', 'video_key', 'sort']) assert.ok(f[slug], slug);
  assert.ok(!f.logo, 'los proyectos no llevan logotipo sobreimpreso');
  assert.ok(!f.video_key.required, 'video_key ya es opcional');
});
test('VideoObject solo con datos reales', () => {
  const v = { name: 'Portada', description: 'Texto', contentUrl: '/_emdash/api/media/file/a.mp4', thumbnailUrl: '/p.webp' };
  assert.equal(videoObject('https://d.test', v), null, 'sin fecha no se emite');
  const ld = videoObject('https://d.test', { ...v, uploadDate: '2026-11-01T10:00:00Z' }) as Record<string, unknown>;
  assert.equal(ld['@type'], 'VideoObject');
  assert.equal(ld.contentUrl, 'https://d.test/_emdash/api/media/file/a.mp4');
  assert.deepEqual(ld.thumbnailUrl, ['https://d.test/p.webp']);
});
test('getProjects (semilla local): el orden de Portfolio y el de Inicio se conservan y el respaldo es el vídeo del sitio', async () => {
  const { getProjects, pageVideo } = await import('../src/lib/site-content.ts');
  const portfolio = await getProjects(), home = await getProjects('home');
  assert.deepEqual(portfolio.map(p => p.key), ['rugby', 'abc-galisur', 'lasexta', 'voley', 'motocross']);
  assert.deepEqual(home.map(p => p.key), ['rugby', 'abc-galisur', 'voley', 'lasexta', 'motocross']);
  assert.ok(portfolio.every(p => p.videoSrc.startsWith('/assets/m4/coberturas/work-')));
  const hero = await pageVideo('page_home', 'hero_video', 'hero_video_movil');
  assert.equal(hero.origin, 'library');
  assert.ok(hero.mobileSrc);
});
test('buildSeo emite el VideoObject en Inicio con un vídeo propio publicado', async () => {
  const { buildSeo } = await import('../src/lib/seo.ts');
  const videos = [{ name: 'Portada', description: 'Texto', contentUrl: '/_emdash/api/media/file/a.mp4', thumbnailUrl: '/p.webp', uploadDate: '2026-11-01T10:00:00Z' }];
  const types = (v?: typeof videos) => (buildSeo({ env: 'production', requestOrigin: 'https://d.test', path: '/', videos: v }).jsonLd as { '@type': string }[]).map(x => x['@type']);
  assert.ok(types(videos).includes('VideoObject'));
  assert.ok(!types().includes('VideoObject'));
});
test('política editorial: vídeo no válido, sin derechos, sin póster o con enlace desconocido no se publica', async () => {
  const { evaluatePublish, ROLE } = await import('../src/lib/editorial-policy.ts');
  const run = (collection: string, data: Record<string, unknown>) => evaluatePublish({ collection, data, actor: { id: 'u', role: ROLE.admin }, approverIds: new Set(['u']), local: true }).reasons.join(' | ');
  const own = mp4();
  assert.match(run('page_home', { hero_video: { src: 'https://x.test/a.mp4' } }), /vídeo no admitido/);
  assert.match(run('page_home', { hero_video: own }), /sin evidencia de derechos/);
  assert.doesNotMatch(run('page_home', { hero_video: own, media_rights_source: 'Autorización 2026' }), /vídeo|derechos/);
  const project = { name: 'P', context: 'c', description: 'd', rights_ok: true, rights_source: 'x' };
  assert.match(run('projects', project), /falta el vídeo/);
  assert.match(run('projects', { ...project, video: own }), /imagen de espera/);
  assert.doesNotMatch(run('projects', { ...project, video: own, poster_ref: 'coberturas/hero-review-poster' }), /vídeo|espera/);
  assert.match(run('projects', { ...project, video_key: 'coberturas/work-rugby', link: '/no-existe/' }), /enlace/);
});
test('política: la ranura de vídeo por defecto de Inicio se admite y una clave ajena se rechaza', async () => {
  const { mediaReasons } = await import('../src/lib/editorial-policy.ts');
  const s = collections.find(c => c.slug === 'page_home')!.videos![0], n = videoFieldSlugs(s);
  assert.deepEqual(mediaReasons('page_home', { [n.ref]: s.ref }), []);
  assert.match(mediaReasons('page_home', { [n.ref]: 'nope' }).join(), /biblioteca autorizada/);
});
