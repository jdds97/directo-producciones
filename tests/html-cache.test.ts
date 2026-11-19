// Caché de HTML de producción (src/lib/html-cache.ts) con una Cache API simulada en memoria.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cachedHtml, htmlCacheKey, HTML_TTL, type HtmlCache } from '../src/lib/html-cache.ts';

test('caché de HTML: solo GET anónimo sin consulta fuera del panel/API, 200 HTML sin cookies ni no-store, clave por versión', async () => {
  const store = new Map<string, Response>();
  const cache: HtmlCache = { match: async (k) => store.get(k.url)?.clone(), put: async (k, r) => void store.set(k.url, r) };
  const tasks: Promise<unknown>[] = [];
  let renders = 0;
  const page = (headers: Record<string, string> = {}, status = 200) => async () => { renders++; return new Response('<p>hola</p>', { status, headers: { 'Content-Type': 'text/html', ...headers } }); };
  const get = async (path: string, init: RequestInit = {}, render = page(), version = 'v1') => {
    const r = await cachedHtml(new Request(`https://directoproducciones.com${path}`, init), version, (t) => tasks.push(t), render, cache);
    await Promise.all(tasks);
    return r;
  };

  const miss = await get('/blog/');
  assert.equal(miss.headers.get('Cache-Control'), `public, max-age=0, s-maxage=${HTML_TTL}`);
  assert.equal(await (await get('/blog/')).text(), '<p>hola</p>');
  assert.equal(renders, 1, 'el segundo GET sale de la caché sin renderizar');
  await get('/blog/', { headers: { Cookie: '__cf_bm=abc.def-1700000000-1.0.1.1-x_Y; _cfuvid=a.b-1700000000000-0.0.1.1-604800000' } });
  assert.equal(renders, 1, 'con solo cookies propias de Cloudflare también sale de la caché');
  await get('/blog/', {}, page(), 'v2');
  assert.equal(renders, 2, 'otra versión del Worker no reutiliza el HTML anterior');
  await get('/blog/', {}, page(), ''); // binding CF_VERSION_METADATA ausente
  assert.equal(renders, 3, 'sin versión no se cachea');

  // Peticiones que nunca leen ni escriben la caché.
  for (const [path, init] of [
    ['/blog/', { headers: { Cookie: 'astro-session=x' } }], ['/blog/', { headers: { Authorization: 'Bearer x' } }],
    ['/blog/?_preview=x', {}], ['/blog/', { method: 'HEAD' }], ['/_emdash/admin/', {}], ['/api/contacto', {}],
  ] as const) {
    const before: number = renders;
    await get(path, init);
    assert.equal(renders, before + 1, `${init.method ?? 'GET'} ${path} ${JSON.stringify(init.headers ?? {})} renderiza siempre`);
  }
  assert.equal(store.size, 2, 'solo /blog/ en v1 y v2');

  // Respuestas que no se guardan: Set-Cookie, private/no-store, errores y no HTML.
  for (const [i, render] of [page({ 'Set-Cookie': 'a=b' }), page({ 'Cache-Control': 'private, no-store' }), page({}, 500), page({}, 404), page({ 'Content-Type': 'application/json' })].entries()) {
    const kept = await get(`/p${i}/`, {}, render);
    assert.notEqual(kept.headers.get('Cache-Control'), `public, max-age=0, s-maxage=${HTML_TTL}`);
  }
  assert.equal(store.size, 2);
});

test('caché de HTML: se ignoran solo las cookies propias de Cloudflare; rutas no canónicas sin caché', () => {
  const key = (path: string, cookie?: string) => htmlCacheKey(new Request(`https://directoproducciones.com${path}`, cookie === undefined ? {} : { headers: { Cookie: cookie } }), 'v1')?.url ?? null;
  const cf = '__cf_bm=a.b-1700000000-1.0.1.1-x_y; cf_clearance=Kj3-1700000000-0-1-a.b.c-150-0.2; _cfuvid=abc.def-1700000000000-0.0.1.1-604800000; __cflb=0H28vgHxwvgAQ; __cfruid=0123abcd-1700000000';
  for (const c of [cf, '__cf_bm=x', 'cf_clearance=y', '_cfuvid=', ' __cflb=z ']) assert.equal(key('/blog/', c), 'https://directoproducciones.com/blog/?v=v1', `cacheable: ${c}`);
  // Cloudflare + cualquier otra (sesión, Access, analítica, desconocida) o cabecera mal formada: siempre render.
  for (const c of [`${cf}; astro-session=x`, `CF_Authorization=x; ${cf}`, '__cf_bm=x; emdash-session=y', '_ga=GA1.1.1', 'a=b', '__CF_BM=x', '__cf_bm',
    '__cf_bm=a b', '__cf_bm=x, astro-session=y', '__cf_bm=x;', '__cf_bm=x;;_cfuvid=y', ';', '', '=x', '__cf_bm=x\\y']) assert.equal(key('/blog/', c), null, `no cacheable: ${JSON.stringify(c)}`);
  // La ruta de la clave es la canónica de la compuerta: variantes codificadas o con barras repetidas no leen ni escriben la caché.
  for (const p of ['/%62log/', '//blog/', '/blog//', '/blog/caf%C3%A9/', '/%5Femdash/admin/', '/%61pi/contacto', '/_emdash%5Cadmin/', '/x/%252e%252e/blog/', '/a%zz']) assert.equal(key(p), null, p);
  assert.equal(key('/x/../blog/'), 'https://directoproducciones.com/blog/?v=v1', 'el parser URL ya resuelve ..');
});
