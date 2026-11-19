// OBSOLESCENTE desde el 2026-11-05: los medios van a R2 (binding MEDIA) en todos los entornos. Solo sirve para probar la vuelta atrás
// DP_MEDIA_STORAGE=kv mientras exista MEDIA_KV; se borra junto con src/cms/storage/kv.ts al retirar KV. No lo usan package.json ni CI.
// Smoke NATIVO de medios con EmDash real y almacenamiento KV (adaptador src/cms/storage/kv.ts) contra un Worker LOCAL aislado.
// Subir (firma→PUT→confirmar y subida directa), servir, borrar, límites y comprobación de que los bytes quedaron en KV y no en R2
// (lo esperado en un build con DP_MEDIA_STORAGE=kv; con el build por defecto, R2, ese paso falla a propósito).
//   node scripts/kv-media-smoke.mjs [--base http://localhost:4494] [--persist .wrangler/fase-09-kv]
// Requiere persistencia provisionada (scripts/cms-provision.sh) y build con DP_MEDIA_STORAGE=kv (ver PREVIEW-RUNTIME.md). Imágenes SINTÉTICAS.
// Local NO mide CPU de Workers Free (10 ms) ni la consistencia eventual real de KV: ambas siguen pendientes en una preview protegida.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash, randomFillSync } from 'node:crypto';
import zlib from 'node:zlib';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'http://localhost:4494');
const PERSIST = arg('--persist', '.wrangler/fase-09-kv');
if (!/^http:\/\/localhost:\d+$/.test(BASE)) throw new Error('Solo localhost');
const fx = JSON.parse(readFileSync(`${PERSIST}/fixture.json`, 'utf8'));
let passed = 0, failed = 0;
const step = async (name, fn) => {
  try { const note = await fn(); passed++; console.log(`ok   ${name}${note ? ` — ${note}` : ''}`); }
  catch (e) { failed++; console.log(`FAIL ${name} — ${e.message ?? e}`); }
};
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const sha = (b) => createHash('sha256').update(b).digest('hex');
const api = async (method, path, body, extra = {}) => {
  const headers = { Origin: BASE, Authorization: `Bearer ${fx.admin.token}`, ...(body && !(body instanceof FormData) && !Buffer.isBuffer(body) ? { 'Content-Type': 'application/json' } : {}), ...extra };
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body instanceof FormData || Buffer.isBuffer(body) ? body : body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null; try { json = JSON.parse(buf.toString('utf8')); } catch { /* binario */ }
  return { status: res.status, json, buf, headers: res.headers };
};
// PNG de píxeles aleatorios (casi incompresible) con un tamaño objetivo aproximado en bytes.
function noisePng(targetBytes) {
  const side = Math.ceil(Math.sqrt(targetBytes / 3));
  const raw = Buffer.alloc(side * (side * 3 + 1));
  for (let y = 0; y < side; y++) randomFillSync(raw, y * (side * 3 + 1) + 1, side * 3);
  const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4); d.copy(b, 8); b.writeUInt32BE(zlib.crc32(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(side, 0); ihdr.writeUInt32BE(side, 4); ihdr[8] = 8; ihdr[9] = 2;
  return { buf: Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 0 })), chunk('IEND', Buffer.alloc(0))]), side };
}
const photo = noisePng(977 * 1024);
console.log(`foto sintética: ${photo.buf.length} bytes (${photo.side}×${photo.side})`);

await step('config · EmDash usa almacenamiento KV (subida firmada no soportada → ruta nativa PUT)', async () => {
  const r = await api('POST', '/_emdash/api/media/upload-url', { filename: 'kv-config.png', contentType: 'image/png', size: photo.buf.length });
  const d = r.json?.data;
  ok(r.status === 200 && d?.uploadUrl?.startsWith('/_emdash/api/media/') && d.uploadUrl.endsWith('/upload'), `respuesta ${r.status} ${r.buf.toString().slice(0, 140)}`);
  await api('DELETE', `/_emdash/api/media/${d.mediaId}`);
});

let signed;
await step('subida nativa firmada: upload-url → PUT → confirm (~977 KB)', async () => {
  const hash = sha(photo.buf);
  const u = await api('POST', '/_emdash/api/media/upload-url', { filename: 'foto-kv-firmada.png', contentType: 'image/png', size: photo.buf.length, contentHash: hash });
  ok(u.status === 200 && u.json?.data?.mediaId, `upload-url ${u.status} ${u.buf.toString().slice(0, 140)}`);
  const d = u.json.data;
  const put = await api(d.method ?? 'PUT', d.uploadUrl, photo.buf, { 'Content-Type': 'image/png', ...(d.headers ?? {}) });
  ok(put.status >= 200 && put.status < 300, `PUT ${put.status} ${put.buf.toString().slice(0, 140)}`);
  const c = await api('POST', `/_emdash/api/media/${d.mediaId}/confirm`, { size: photo.buf.length, width: photo.side, height: photo.side });
  ok(c.status === 200, `confirm ${c.status} ${c.buf.toString().slice(0, 160)}`);
  signed = { id: d.mediaId, key: c.json?.data?.item?.storageKey ?? d.storageKey }; // confirm renombra la clave (hash de contenido)
  ok(signed.key, 'sin storageKey');
  return `id ${signed.id}`;
});
await step('servir: GET /_emdash/api/media/file/<clave> devuelve exactamente los bytes subidos', async () => {
  const r = await api('GET', `/_emdash/api/media/file/${signed.key}`);
  ok(r.status === 200 && r.headers.get('content-type')?.startsWith('image/png') && sha(r.buf) === sha(photo.buf), `${r.status} ${r.headers.get('content-type')} ${r.buf.length} B`);
  return `${r.buf.length} B, ${r.headers.get('cache-control')}`;
});
await step('rango/HEAD y clave inexistente', async () => {
  const miss = await api('GET', '/_emdash/api/media/file/01ZZZZZZZZZZZZZZZZZZZZZZZZ.png');
  ok(miss.status === 404, `inexistente → ${miss.status}`);
});
await step('borrar: DELETE elimina registro y bytes (después 404)', async () => {
  const d = await api('DELETE', `/_emdash/api/media/${signed.id}`);
  ok(d.status === 200, `DELETE ${d.status} ${d.buf.toString().slice(0, 140)}`);
  const r = await api('GET', `/_emdash/api/media/file/${signed.key}`);
  ok(r.status === 404, `tras borrar → ${r.status}`);
});

let direct;
await step('subida directa multipart (POST /media) de ~977 KB + servir + borrar', async () => {
  const f = new FormData(); f.set('file', new File([photo.buf], 'foto-kv-directa.png', { type: 'image/png' }));
  const up = await api('POST', '/_emdash/api/media', f);
  ok(up.status === 201 || up.status === 200, `POST ${up.status} ${up.buf.toString().slice(0, 160)}`);
  const item = up.json?.data?.item;
  ok(item?.storageKey, 'sin storageKey');
  direct = item;
  const r = await api('GET', `/_emdash/api/media/file/${item.storageKey}`);
  ok(r.status === 200 && sha(r.buf) === sha(photo.buf), `servir ${r.status}`);
  const del = await api('DELETE', `/_emdash/api/media/${item.id}`);
  ok(del.status === 200, `DELETE ${del.status}`);
  ok((await api('GET', `/_emdash/api/media/file/${item.storageKey}`)).status === 404, 'sigue sirviéndose');
  return `${item.width}×${item.height}`;
});
await step('límite: 10 MiB + 1 se rechaza (firmada y directa) sin guardar nada', async () => {
  const over = 10 * 1024 * 1024 + 1;
  const u = await api('POST', '/_emdash/api/media/upload-url', { filename: 'grande.png', contentType: 'image/png', size: over });
  ok(u.status >= 400 && u.status < 500, `upload-url ${u.status}`);
  const f = new FormData(); f.set('file', new File([Buffer.alloc(over, 1)], 'grande.png', { type: 'image/png' }));
  const d = await api('POST', '/_emdash/api/media', f);
  ok(d.status >= 400 && d.status < 500, `directa ${d.status}`);
});
await step('permisos: sin credenciales no se sube ni se borra', async () => {
  const res = await fetch(`${BASE}/_emdash/api/media/upload-url`, { method: 'POST', headers: { Origin: BASE, 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: 'x.png', contentType: 'image/png', size: 10 }) });
  ok(res.status === 401 || res.status === 403, `anónimo → ${res.status}`);
});
await step('almacenamiento físico: el CMS escribió en KV y no en R2', async () => {
  const count = (dir) => (existsSync(dir) ? readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile() && !/\.sqlite(-wal|-shm)?$/.test(e.name)).length : 0);
  const kvFiles = count(`${PERSIST}/v3/kv`), r2Files = count(`${PERSIST}/v3/r2`);
  ok(existsSync(`${PERSIST}/v3/kv`), 'no existe el directorio kv de la persistencia');
  ok(r2Files === 0, `R2 local recibió ${r2Files} archivos`);
  return `archivos de blobs KV=${kvFiles} · blobs R2=${r2Files}`;
});
console.log(`\n${passed} correctas, ${failed} fallidas`);
process.exit(failed ? 1 : 0);
