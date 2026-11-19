import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaDenied, mediaBytesDenied, mediaMaxBytes, MEDIA_LIMITS } from '../src/lib/editorial-policy.ts';
import { parseRange, serveVideo, videoKeyOf, type R2BucketLike } from '../src/cms/media-range.ts';

// ── MP4 sintéticos: solo las cajas que mira la validación ──
const box = (type: string, ...parts: Uint8Array[]) => {
  const body = Buffer.concat(parts); const out = Buffer.alloc(8 + body.length);
  out.writeUInt32BE(out.length, 0); out.write(type, 4, 'latin1'); body.copy(out, 8); return new Uint8Array(out);
};
const ftyp = (brand = 'isom') => box('ftyp', Buffer.from(brand + '\0\0\0\0isomavc1', 'latin1'));
const moov = (codec: string) => box('moov', box('trak', box('stsd', Buffer.from(`\0\0\0\0\0\0\0\x01${codec}`, 'latin1'))));
const mdat = box('mdat', new Uint8Array(64));
const cat = (...a: Uint8Array[]) => new Uint8Array(Buffer.concat(a));

test('MP4 H.264 con faststart pasa; tope 40 MiB vídeo y 10 MiB imagen', () => {
  assert.equal(mediaBytesDenied('video/mp4', cat(ftyp(), moov('avc1'), mdat)), null);
  assert.equal(mediaDenied({ type: 'video/mp4', size: 5e6, name: 'hero.mp4' }), null);
  assert.match(mediaDenied({ type: 'video/mp4', size: 41 * 1024 * 1024, name: 'hero.mp4' })!, /40 MB/);
  assert.equal(mediaDenied({ type: 'video/mp4', size: 40 * 1024 * 1024, name: 'hero.mp4' }), null);
  assert.match(mediaDenied({ type: 'image/png', size: 11 * 1024 * 1024, name: 'a.png' })!, /10 MB/);
  assert.equal(mediaMaxBytes('video/mp4'), MEDIA_LIMITS.maxVideoBytes); assert.equal(mediaMaxBytes('image/png'), MEDIA_LIMITS.maxBytes);
});
test('rechazos con mensaje claro: sin faststart, HEVC, AV1, VP9, MOV, WebM, PNG disfrazado', () => {
  assert.match(mediaBytesDenied('video/mp4', cat(ftyp(), mdat, moov('avc1')))!, /Web optimizado/);
  assert.match(mediaBytesDenied('video/mp4', cat(ftyp(), moov('hvc1'), mdat))!, /HEVC/);
  assert.match(mediaBytesDenied('video/mp4', cat(ftyp(), moov('hev1'), mdat))!, /HEVC/);
  assert.match(mediaBytesDenied('video/mp4', cat(ftyp(), moov('av01'), mdat))!, /AV1/);
  assert.match(mediaBytesDenied('video/mp4', cat(ftyp(), moov('vp09'), mdat))!, /VP9/);
  assert.match(mediaBytesDenied('video/mp4', cat(ftyp('qt  '), moov('avc1'), mdat))!, /MOV/);
  assert.match(mediaBytesDenied('video/mp4', Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]))!, /WebM/);
  assert.ok(mediaBytesDenied('video/mp4', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])), 'PNG con tipo vídeo');
  assert.ok(mediaBytesDenied('video/mp4', new Uint8Array()), 'vacío');
  assert.match(mediaBytesDenied('video/webm', cat(ftyp()))!, /no admitido/);
  assert.ok(mediaBytesDenied('image/png', cat(ftyp(), moov('avc1'), mdat)), 'MP4 declarado como imagen');
  for (const [type, name] of [['video/quicktime', 'a.mov'], ['video/webm', 'a.webm'], ['video/mp4', 'a.mov'], ['application/octet-stream', 'a.mkv']]) assert.match(mediaDenied({ type, size: 10, name })!, /no admitido/, name);
  assert.ok(mediaDenied({ type: 'image/png', size: 10, name: 'a.mp4' }), 'extensión y tipo cruzados');
});
test('el vídeo no entra por formulario multipart (se leería en memoria)', () => {
  assert.match(mediaDenied({ type: 'video/mp4', size: 10, name: 'a.mp4' }, { form: true })!, /selector/);
  assert.equal(mediaDenied({ type: 'image/webp', size: 10, name: 'a.webp' }, { form: true }), null);
});

// ── R2 simulado ──
const DATA = new Uint8Array(1000).map((_, i) => i % 251);
const ETAG = '"abc123"';
const ops: string[] = [];
const bucket = (contentType = 'video/mp4'): R2BucketLike => ({
  async head(key) { ops.push(`head ${key}`); return key === 'v.mp4' ? { size: DATA.length, httpEtag: ETAG, httpMetadata: { contentType } } : null; },
  async get(key, o) {
    ops.push(`get ${key} ${JSON.stringify(o?.range ?? null)}`);
    if (key !== 'v.mp4') return null;
    const r = o?.range ?? { offset: 0, length: DATA.length };
    return { size: DATA.length, httpEtag: ETAG, httpMetadata: { contentType }, body: new Response(DATA.slice(r.offset, r.offset + r.length)).body! };
  },
});
const get = (headers: Record<string, string> = {}, method = 'GET') => serveVideo(new Request('http://x/_emdash/api/media/file/v.mp4', { method, headers }), bucket(), 'v.mp4');
const bytes = async (r: Response) => new Uint8Array(await r.arrayBuffer());

test('Range: 200 completo con Accept-Ranges, 206 parcial, sufijo, abierto', async () => {
  const full = (await get())!; assert.equal(full.status, 200);
  assert.equal(full.headers.get('Accept-Ranges'), 'bytes'); assert.equal(full.headers.get('Content-Length'), '1000'); assert.equal(full.headers.get('Content-Type'), 'video/mp4');
  assert.equal(full.headers.get('ETag'), ETAG); assert.equal(full.headers.get('X-Content-Type-Options'), 'nosniff'); assert.deepEqual(await bytes(full), DATA);
  const p = (await get({ Range: 'bytes=0-1' }))!; assert.equal(p.status, 206);
  assert.equal(p.headers.get('Content-Range'), 'bytes 0-1/1000'); assert.equal(p.headers.get('Content-Length'), '2'); assert.deepEqual(await bytes(p), DATA.slice(0, 2));
  const mid = (await get({ Range: 'bytes=100-199' }))!; assert.deepEqual(await bytes(mid), DATA.slice(100, 200));
  const open = (await get({ Range: 'bytes=990-' }))!; assert.equal(open.headers.get('Content-Range'), 'bytes 990-999/1000'); assert.equal((await bytes(open)).length, 10);
  const suffix = (await get({ Range: 'bytes=-5' }))!; assert.equal(suffix.headers.get('Content-Range'), 'bytes 995-999/1000');
  const clamp = (await get({ Range: 'bytes=900-5000' }))!; assert.equal(clamp.headers.get('Content-Range'), 'bytes 900-999/1000');
});
test('416 fuera de rango; rangos ilegibles o múltiples se ignoran (200)', async () => {
  for (const r of ['bytes=999999999-', 'bytes=1000-', 'bytes=-0']) {
    const res = (await get({ Range: r }))!; assert.equal(res.status, 416, r); assert.equal(res.headers.get('Content-Range'), 'bytes */1000');
  }
  for (const r of ['bytes=0-1,5-6', 'items=0-1', 'bytes=9-2', 'basura']) assert.equal((await get({ Range: r }))!.status, 200, r);
});
test('304 con ETag (también débil y *), If-Range distinto sirve completo, HEAD sin cuerpo', async () => {
  for (const v of [ETAG, `W/${ETAG}`, '"x", ' + ETAG, '*']) { const r = (await get({ 'If-None-Match': v }))!; assert.equal(r.status, 304, v); assert.equal(r.headers.get('ETag'), ETAG); assert.equal((await bytes(r)).length, 0); }
  assert.equal((await get({ 'If-None-Match': '"otro"' }))!.status, 200);
  assert.equal((await get({ Range: 'bytes=0-1', 'If-Range': '"otro"' }))!.status, 200);
  assert.equal((await get({ Range: 'bytes=0-1', 'If-Range': ETAG }))!.status, 206);
  ops.length = 0; const h = (await get({ Range: 'bytes=0-1' }, 'HEAD'))!;
  assert.equal(h.status, 206); assert.equal(h.headers.get('Content-Length'), '2'); assert.equal((await bytes(h)).length, 0);
  assert.deepEqual(ops, ['head v.mp4'], 'HEAD y 304 no leen el cuerpo');
});
test('lee de R2 solo el rango pedido; claves y objetos ajenos pasan a EmDash', async () => {
  ops.length = 0; await get({ Range: 'bytes=10-19' });
  assert.deepEqual(ops, ['head v.mp4', 'get v.mp4 {"offset":10,"length":10}']);
  assert.equal(await serveVideo(new Request('http://x/'), bucket(), 'no-existe.mp4'), null);
  assert.equal(await serveVideo(new Request('http://x/'), bucket('image/webp'), 'v.mp4'), null, 'no es vídeo');
  assert.equal(videoKeyOf('/_emdash/api/media/file/01HX.mp4'), '01HX.mp4');
  for (const p of ['/_emdash/api/media/file/01HX.webp', '/_emdash/api/media/file/a/b.mp4', '/_emdash/api/media/file/..mp4', '/_emdash/api/media/file/a..b.mp4', '/otra/01HX.mp4']) assert.equal(videoKeyOf(p), null, p);
  assert.equal(parseRange('bytes=0-1', 0), 'unsatisfiable');
});
