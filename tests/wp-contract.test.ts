import test from 'node:test';
import assert from 'node:assert/strict';
import { mapWpPost, readyForReview, originalPath } from '../src/cms/wp-contract.ts';

const post = { id: 1, slug: 'Cómo-retransmitir un evento', title: 'Cómo retransmitir', contentHtml: '<p>Texto sintético</p>', date: '2020-01-01', link: 'https://www.directoproducciones.com/2020/01/01/como-retransmitir-un-evento/', status: 'publish', categories: ['Streaming', 'streaming'], tags: ['Realización'], authorDisplayName: 'Equipo' };
test('todo entra como borrador, con redirección y taxonomías normalizadas', () => {
  const m = mapWpPost(post);
  assert.equal(m.status, 'draft'); assert.equal(m.slug, 'como-retransmitir-un-evento');
  assert.deepEqual(m.taxonomies.category, ['streaming']); assert.equal(m.redirect.to, '/blog/como-retransmitir-un-evento/'); assert.equal(readyForReview(m), true);
});
test('imagen sin alt, correo y shortcodes bloquean el paso a revisión', () => {
  assert.equal(readyForReview(mapWpPost({ ...post, featuredImage: { url: 'x.jpg' } })), false);
  assert.equal(readyForReview(mapWpPost({ ...post, contentHtml: 'escribe a a@b.es' })), false);
  assert.equal(readyForReview(mapWpPost({ ...post, contentHtml: '[gallery ids="1"]' })), false);
});
test('un post no publicado en origen queda en borrador y avisa', () => {
  const m = mapWpPost({ ...post, status: 'private' }); assert.equal(m.status, 'draft'); assert.ok(m.issues[0].startsWith('Estado origen'));
});
test('la redirección usa la ruta original con fecha, no /slug/', () => {
  const m = mapWpPost({ ...post, slug: 'macarena-tv', link: 'https://www.directoproducciones.com/2019/07/24/macarena-tv/' });
  assert.equal(m.redirect.from, '/2019/07/24/macarena-tv/'); assert.equal(m.redirect.to, '/blog/macarena-tv/'); assert.equal(readyForReview(m), true);
  assert.equal(originalPath('/2019/07/24/macarena-tv'), '/2019/07/24/macarena-tv/'); assert.equal(originalPath('https://x.es/macarena-tv/'), null); assert.equal(readyForReview(mapWpPost({ ...post, link: undefined })), false);
});
