import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { EmDashStorageError } from 'emdash';
import { KvStorage, KV_VALUE_LIMIT, DEFAULT_MAX_BYTES, type KvLike } from '../src/cms/storage/kv-storage.ts';

// KV simulado: un almacén global + una caché por "PoP" con reloj falso. Modela lo DOCUMENTADO (una lectura,
// incluso negativa, se cachea cacheTtl s en su ubicación; la escritura se ve de inmediato solo donde se hizo
// o donde no hay caché). No mide el KV real: eso queda como prueba remota pendiente.
class World {
  now = 0;
  readonly store = new Map<string, { value: Uint8Array; metadata: unknown }>();
  puts = 0; gets = 0; lists = 0; deletes = 0;
  failPut: Error | null = null;
  view(): KvLike & { cache: Map<string, { exp: number; hit: { value: Uint8Array; metadata: unknown } | null }> } {
    const cache = new Map<string, { exp: number; hit: { value: Uint8Array; metadata: unknown } | null }>();
    const w = this;
    return {
      cache,
      async put(key, value, options) {
        if (w.failPut) throw w.failPut;
        w.puts++;
        assert.ok(value.byteLength <= KV_VALUE_LIMIT, 'valor > 25 MiB');
        assert.ok(JSON.stringify(options?.metadata ?? null).length <= 1024, 'metadato > 1024 B');
        assert.ok(new TextEncoder().encode(key).length <= 512);
        const copy = new Uint8Array(value.slice(0));
        w.store.set(key, { value: copy, metadata: options?.metadata ?? null });
        cache.set(key, { exp: w.now + 60_000, hit: { value: copy, metadata: options?.metadata ?? null } });
      },
      async getWithMetadata(key, options) {
        w.gets++;
        const ttl = (options.cacheTtl ?? 60) * 1000;
        assert.ok(options.cacheTtl === undefined || options.cacheTtl >= 30, 'cacheTtl < 30 s');
        let c = cache.get(key);
        if (!c || c.exp <= w.now) { const g = w.store.get(key); c = { exp: w.now + ttl, hit: g ?? null }; cache.set(key, c); }
        if (!c.hit) return { value: null, metadata: null };
        const v = c.hit.value;
        return { value: new ReadableStream<Uint8Array>({ start(ctl) { for (let i = 0; i < v.length; i += 65536) ctl.enqueue(v.slice(i, i + 65536)); ctl.close(); } }), metadata: c.hit.metadata };
      },
      async delete(key) { w.deletes++; w.store.delete(key); cache.delete(key); },
      async list(o = {}) {
        w.lists++;
        const all = [...w.store.keys()].filter((k) => k.startsWith(o.prefix ?? '')).sort();
        const start = o.cursor ? all.findIndex((k) => k > o.cursor!) : 0;
        const slice = start < 0 ? [] : all.slice(start, start + (o.limit ?? 1000));
        const done = start < 0 || start + slice.length >= all.length;
        return { keys: slice.map((name) => ({ name, metadata: w.store.get(name)!.metadata })), list_complete: done, cursor: done ? undefined : slice.at(-1) };
      },
    };
  }
}
const mk = (cfg = {}) => { const w = new World(); const kv = w.view(); return { w, kv, s: new KvStorage(kv, { retryDelayMs: 1, ...cfg }) }; };
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const streamOf = (b: Uint8Array, chunk = 65536) => new ReadableStream<Uint8Array>({ start(c) { for (let i = 0; i < b.length; i += chunk) c.enqueue(b.slice(i, i + chunk)); c.close(); } });
const drain = async (s: ReadableStream<Uint8Array>) => new Uint8Array(await new Response(s).arrayBuffer());
const code = (e: unknown) => (e instanceof EmDashStorageError ? e.code : `other:${String(e)}`);
const rejects = (p: Promise<unknown>, c: string) => assert.rejects(p, (e) => { assert.equal(code(e), c); return true; });

// Foto real del propio sitio (activo versionado en el repo, 977.163 bytes), no una miniatura sintética.
const PHOTO = new Uint8Array(readFileSync(new URL('../public/assets/m4/servicios/produccion-eng.jpeg', import.meta.url)));

test('foto real: subida por Uint8Array y por stream, lectura byte a byte, metadato mínimo', async () => {
  assert.ok(PHOTO.length > 900_000 && PHOTO[0] === 0xff && PHOTO[1] === 0xd8);
  const { w, s } = mk();
  const up1 = await s.upload({ key: '01HXAAAAAAAAAAAAAAAAAAAAAA.jpeg', body: PHOTO, contentType: 'image/jpeg' });
  const up2 = await s.upload({ key: '01HXBBBBBBBBBBBBBBBBBBBBBB.jpeg', body: streamOf(PHOTO), contentType: 'IMAGE/JPEG' });
  assert.equal(up1.size, PHOTO.length); assert.equal(up2.size, PHOTO.length);
  assert.equal(up1.url, '/_emdash/api/media/file/01HXAAAAAAAAAAAAAAAAAAAAAA.jpeg');
  for (const k of ['01HXAAAAAAAAAAAAAAAAAAAAAA.jpeg', '01HXBBBBBBBBBBBBBBBBBBBBBB.jpeg']) {
    const d = await s.download(k);
    assert.equal(d.contentType, 'image/jpeg'); assert.equal(d.size, PHOTO.length);
    assert.equal(sha(await drain(d.body)), sha(PHOTO));
  }
  assert.equal(w.puts, 2);
  const meta = w.store.get('01HXAAAAAAAAAAAAAAAAAAAAAA.jpeg')!.metadata as Record<string, unknown>;
  assert.deepEqual(Object.keys(meta).sort(), ['ct', 'size', 'up', 'v']); // sin nombre de fichero, autor ni EXIF
  assert.equal(await s.exists('01HXAAAAAAAAAAAAAAAAAAAAAA.jpeg'), true);
  assert.equal(await s.exists('01HXCCCCCCCCCCCCCCCCCCCCCC.jpeg'), false);
});

test('límite 10 MiB: exacto pasa; +1 byte falla antes de escribir (array y stream); backups hasta 25 MiB', async () => {
  const { w, s } = mk();
  assert.equal(DEFAULT_MAX_BYTES, 10 * 1024 * 1024);
  await s.upload({ key: 'ok.bin', body: new Uint8Array(DEFAULT_MAX_BYTES), contentType: 'application/octet-stream' });
  await rejects(s.upload({ key: 'big.bin', body: new Uint8Array(DEFAULT_MAX_BYTES + 1), contentType: 'image/png' }), 'PAYLOAD_TOO_LARGE');
  let pulled = 0;
  const endless = new ReadableStream<Uint8Array>({ pull(c) { pulled += 1 << 20; c.enqueue(new Uint8Array(1 << 20)); } });
  await rejects(s.upload({ key: 'big2.bin', body: endless, contentType: 'image/png' }), 'PAYLOAD_TOO_LARGE');
  assert.ok(pulled <= DEFAULT_MAX_BYTES + (2 << 20), 'debe cortar la lectura al pasar el tope');
  assert.equal(w.puts, 1);
  await s.upload({ key: 'backups/emdash-backup-2026-11-01T00-00-00-1a2b3c4d.json', body: new Uint8Array(20 * 1024 * 1024), contentType: 'application/json' });
  await rejects(s.upload({ key: 'backups/x.json', body: new Uint8Array(KV_VALUE_LIMIT + 1), contentType: 'application/json' }), 'PAYLOAD_TOO_LARGE');
  assert.equal(new KvStorage(w.view(), { maxBytes: 99 * 1024 * 1024 })['maxBytes' as never], KV_VALUE_LIMIT); // nunca > 25 MiB
});

test('claves y tipos inválidos se rechazan; getSignedUploadUrl = NOT_SUPPORTED como R2', async () => {
  const { s } = mk();
  for (const key of ['', '.', '..', '../x', '/x', 'a//b', 'a/../b', 'a b.png', 'ñ.png', 'x'.repeat(513)]) {
    await rejects(s.upload({ key, body: new Uint8Array(1), contentType: 'image/png' }), 'INVALID_PATH');
    await rejects(s.download(key), 'INVALID_PATH');
  }
  await rejects(s.upload({ key: 'a.png', body: new Uint8Array(1), contentType: 'image/png; x\r\nSet-Cookie: a' }), 'VALIDATION_ERROR');
  await rejects(s.getSignedUploadUrl({ key: 'a.png', contentType: 'image/png' }), 'NOT_SUPPORTED');
});

test('subida de claves nuevas: lectura inmediata en el mismo PoP; sobrescritura sigue vigente en otro hasta cacheTtl', async () => {
  const { w, kv, s } = mk();
  const other = new KvStorage(w.view(), { retryDelayMs: 1 }); // otro PoP
  await s.upload({ key: 'new.jpeg', body: PHOTO, contentType: 'image/jpeg' });
  assert.equal(sha(await drain((await s.download('new.jpeg')).body)), sha(PHOTO)); // mismo PoP: inmediato
  // Otro PoP que nunca había leído la clave la ve (sin lectura negativa previa).
  assert.equal(await other.exists('new.jpeg'), true);
  // Sobrescribir la MISMA clave (Replace original): el otro PoP sigue con la versión vieja hasta expirar su caché.
  const v2 = PHOTO.slice(0, 1000);
  await s.upload({ key: 'new.jpeg', body: v2, contentType: 'image/jpeg' });
  assert.equal((await other.download('new.jpeg')).size, PHOTO.length);
  w.now += 61_000;
  assert.equal((await other.download('new.jpeg')).size, 1000);
  assert.ok(kv.cache.size > 0);
});

test('lectura negativa cacheada en otro PoP: NOT_FOUND hasta que expira; los reintentos no la saltan', async () => {
  const { w, s } = mk({ lookupRetries: 2 });
  const reader = new KvStorage(w.view(), { retryDelayMs: 1, lookupRetries: 2 });
  await rejects(reader.download('late.jpeg'), 'NOT_FOUND'); // el PoP B consulta antes de existir y cachea el vacío
  const getsAfterMiss = w.gets;
  assert.equal(getsAfterMiss, 3); // 1 + 2 reintentos
  await s.upload({ key: 'late.jpeg', body: PHOTO, contentType: 'image/jpeg' }); // escribe otro PoP
  await rejects(reader.download('late.jpeg'), 'NOT_FOUND'); // aún negativo cacheado en B
  assert.equal(await reader.exists('late.jpeg'), false);
  w.now += 31_000; // cacheTtl por defecto del adaptador = 30 s
  assert.equal(await reader.exists('late.jpeg'), true);
});

test('borrado: idempotente; el otro PoP puede seguir sirviendo hasta cacheTtl', async () => {
  const { w, s } = mk();
  const other = new KvStorage(w.view(), { retryDelayMs: 1, lookupRetries: 0 });
  await s.upload({ key: 'gone.jpeg', body: PHOTO.slice(0, 5000), contentType: 'image/jpeg' });
  assert.equal(await other.exists('gone.jpeg'), true); // B cachea positivo
  await s.delete('gone.jpeg'); await s.delete('gone.jpeg'); await s.delete('nunca-existio.jpeg');
  await rejects(s.download('gone.jpeg'), 'NOT_FOUND');
  assert.equal(await other.exists('gone.jpeg'), true); // consistencia eventual explícita
  w.now += 61_000;
  assert.equal(await other.exists('gone.jpeg'), false);
});

test('list: prefijo, paginación por cursor y metadatos; se omiten claves ajenas', async () => {
  const { w, s } = mk();
  for (let i = 0; i < 5; i++) await s.upload({ key: `m/${i}.jpeg`, body: new Uint8Array(10 + i), contentType: 'image/jpeg' });
  await s.upload({ key: 'otro.jpeg', body: new Uint8Array(3), contentType: 'image/jpeg' });
  w.store.set('m/ajena', { value: new Uint8Array(1), metadata: { x: 1 } });
  const seen: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await s.list({ prefix: 'm/', limit: 2, cursor });
    assert.ok(page.files.length <= 2);
    for (const f of page.files) { seen.push(f.key); assert.equal(f.size, 10 + Number(f.key.match(/\d/)![0])); assert.ok(f.lastModified instanceof Date && f.lastModified.getTime() > 0); }
    cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(seen, ['m/0.jpeg', 'm/1.jpeg', 'm/2.jpeg', 'm/3.jpeg', 'm/4.jpeg']);
  assert.equal((await s.list({ limit: 5000 })).files.length, 6);
});

test('backup/restauración con el mismo patrón de EmDash: upload JSON, list con prefijo, poda y restauración', async () => {
  const { w, s } = mk();
  const names: string[] = [];
  const snapshot = (n: number) => JSON.stringify({ format: 'emdash-backup', formatVersion: 1, tables: { media: Array.from({ length: 8000 }, (_, i) => ({ id: `${n}-${i}`, nota: 'ñ ó € ' + 'x'.repeat(200) })) } });
  for (let n = 0; n < 4; n++) {
    const name = `emdash-backup-2026-11-0${n + 1}T03-00-00-${(0xa0 + n).toString(16).repeat(4)}.json`;
    names.push(name);
    await s.upload({ key: `backups/${name}`, body: new TextEncoder().encode(snapshot(n)), contentType: 'application/json' });
  }
  const listed = await s.list({ prefix: 'backups/emdash-backup-', limit: 100 });
  assert.equal(listed.files.length, 4);
  assert.ok(listed.files.every((f) => f.size > 1_000_000));
  // poda (retención 2): conserva las 2 más nuevas
  for (const f of listed.files.toSorted((a, b) => (a.key < b.key ? 1 : -1)).slice(2)) await s.delete(f.key);
  assert.deepEqual((await s.list({ prefix: 'backups/' })).files.map((f) => f.key.slice(8)), names.slice(2));
  // restauración: el JSON descargado es idéntico al original
  const d = await s.download(`backups/${names[3]}`);
  assert.equal(d.contentType, 'application/json');
  assert.equal(new TextDecoder().decode(await drain(d.body)), snapshot(3));
  assert.equal(w.puts, 4);
});

test('errores de KV: cuota/límite por clave, origen del stream y objeto sin metadato', async () => {
  const { w, s } = mk();
  w.failPut = new Error('KV PUT failed: 429 Too Many Requests');
  await assert.rejects(s.upload({ key: 'q.jpeg', body: PHOTO.slice(0, 100), contentType: 'image/jpeg' }), (e) => { assert.equal(code(e), 'UPLOAD_FAILED'); assert.match(String((e as Error).cause), /429/); return true; });
  w.failPut = null;
  // el error del cuerpo (UploadBodyError de EmDash, tamaño no coincide) se conserva en la cadena cause
  const boom = Object.assign(new Error('size'), { code: 'UPLOAD_SIZE_MISMATCH' });
  const bad = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(3)); c.error(boom); } });
  await assert.rejects(s.upload({ key: 's.jpeg', body: bad, contentType: 'image/jpeg' }), (e) => { assert.equal(code(e), 'UPLOAD_FAILED'); assert.equal((e as Error).cause, boom); return true; });
  assert.equal(w.store.size, 0);
  w.store.set('raw.jpeg', { value: new Uint8Array(4), metadata: null });
  await rejects(s.download('raw.jpeg'), 'CORRUPT_OBJECT');
  const broken: KvLike = { ...w.view(), getWithMetadata: async () => { throw new Error('KV GET failed: 500'); }, list: async () => { throw new Error('KV LIST failed: 429'); }, delete: async () => { throw new Error('KV DELETE failed: 429'); } };
  const sb = new KvStorage(broken, { retryDelayMs: 1 });
  await rejects(sb.download('a.jpeg'), 'DOWNLOAD_FAILED'); await rejects(sb.exists('a.jpeg'), 'HEAD_FAILED');
  await rejects(sb.list(), 'LIST_FAILED'); await rejects(sb.delete('a.jpeg'), 'DELETE_FAILED');
});
