import { defineMiddleware } from 'astro:middleware';
import { onRequest as cmsMiddleware } from 'emdash/internal/middleware/media-usage-write-fence';
import { isCmsPath } from '../scope.ts';
import { MEDIA_LIMITS, mediaBytesDenied, mediaDenied, mediaMaxBytes } from '../../lib/editorial-policy.ts';
import { serveVideo, videoKeyOf } from '../media-range.ts';

// EmDash 1.1.0 permite borrar un medio aunque una entrada lo use (la web mostraría una imagen rota).
// Este cierre local lo impide mientras el índice de uso nativo de EmDash lo cuente; si no puede comprobarlo, deniega.
const MEDIA_ITEM = /^\/_emdash\/api\/media\/([A-Za-z0-9]+)\/?$/;
const UPLOAD_URL = /^\/_emdash\/api\/media\/upload-url\/?$/;
const UPLOAD_PUT = /^\/_emdash\/api\/media\/[A-Za-z0-9]+\/upload\/?$/;
const UPLOAD_POST = /^\/_emdash\/api\/media\/?$/;
// Reemplazar el archivo de un medio (también en uso) aplica las mismas reglas que una subida nueva.
const REPLACE = /^\/_emdash\/api\/media\/[A-Za-z0-9]+\/replace\/?$/;
// Margen del multipart (cabeceras y límites) sobre el máximo de la imagen.
const MULTIPART_SLACK = 64 * 1024;
const json = (status: number, code: string, message: string) =>
  new Response(JSON.stringify({ success: false, error: { code, message } }), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const refuse = (status: number, message: string) => json(status, 'MEDIA_IN_USE', message);
const rejected = (status: number, message: string) => json(status, 'MEDIA_REJECTED', message);

// El panel sube por upload-url → PUT → confirm, y ese camino no pasa por el hook media:beforeUpload del plugin:
// aquí se aplican las mismas reglas (tipo, extensión, 10 MB imagen / 40 MB vídeo) y además la firma real del contenido.
// El vídeo solo entra por este camino (streaming a R2): el multipart se lee entero en memoria y no admite vídeo.
async function headOf(body: ReadableStream<Uint8Array> | null, bytes: number): Promise<Uint8Array> {
  const reader = body?.getReader();
  if (!reader) return new Uint8Array();
  const out = new Uint8Array(bytes); let n = 0;
  while (n < out.length) {
    const { value, done } = await reader.read();
    if (done || !value) break;
    out.set(value.subarray(0, out.length - n), n); n += Math.min(value.length, out.length - n);
  }
  await reader.cancel().catch(() => undefined);
  return out.subarray(0, n);
}
const contentLength = (request: Request) => Number(request.headers.get('content-length') ?? NaN);

async function uploadGuard(context: Parameters<Parameters<typeof defineMiddleware>[0]>[0]): Promise<Response | null> {
  const { request, url } = context;
  if (request.method === 'POST' && UPLOAD_URL.test(url.pathname)) {
    const body = await request.clone().json().catch(() => null) as { filename?: unknown; contentType?: unknown; size?: unknown } | null;
    if (!body || typeof body.filename !== 'string' || typeof body.size !== 'number') return rejected(400, 'Solicitud de subida no válida.');
    const denied = mediaDenied({ name: body.filename, type: String(body.contentType ?? ''), size: body.size });
    return denied ? rejected(body.size > mediaMaxBytes(String(body.contentType ?? '')) ? 413 : 400, denied) : null;
  }
  if (request.method === 'PUT' && UPLOAD_PUT.test(url.pathname)) {
    const length = contentLength(request);
    // Sin longitud declarada no se puede acotar el cuerpo: se rechaza.
    if (!Number.isFinite(length)) return rejected(411, 'Falta la longitud del archivo.');
    const type = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const max = mediaMaxBytes(type);
    if (length > max) return rejected(413, `El archivo supera los ${max / 1024 / 1024} MB.`);
    // Se lee solo la cabeza del clon (el resto del cuerpo sigue su camino a R2 sin pasar por memoria).
    const denied = mediaBytesDenied(type, await headOf(request.clone().body, type.startsWith('video/') ? MEDIA_LIMITS.headBytes : 16));
    return denied ? rejected(400, denied) : null;
  }
  if (((request.method === 'POST' && UPLOAD_POST.test(url.pathname)) || (request.method === 'PUT' && REPLACE.test(url.pathname))) && (request.headers.get('content-type') ?? '').startsWith('multipart/form-data')) {
    const length = contentLength(request);
    if (!Number.isFinite(length)) return rejected(411, 'Falta la longitud del archivo.');
    if (length > MEDIA_LIMITS.maxBytes + MULTIPART_SLACK) return rejected(413, 'El archivo supera los 10 MB.');
    const file = (await request.clone().formData().catch(() => null))?.get('file');
    if (!(file instanceof File)) return null; // EmDash responde NO_FILE
    const denied = mediaDenied(file, { form: true }) ?? mediaBytesDenied(file.type, new Uint8Array(await file.slice(0, 16).arrayBuffer()));
    return denied ? rejected(file.size > MEDIA_LIMITS.maxBytes ? 413 : 400, denied) : null;
  }
  return null;
}

export const onRequest = defineMiddleware(async (context, next) => {
  if (!isCmsPath(context.url.pathname)) return next();
  const blocked = await uploadGuard(context);
  if (blocked) return blocked;
  // Vídeo con Range/ETag desde R2 (EmDash sirve siempre 200 completo). La compuerta de entorno ya se ha aplicado antes (local-gate).
  const videoKey = ['GET', 'HEAD'].includes(context.request.method) ? videoKeyOf(context.url.pathname) : null;
  if (videoKey) {
    const { env } = await import('cloudflare:workers');
    // Con DP_MEDIA_STORAGE=kv no hay binding MEDIA: sin Range, sirve EmDash como hasta ahora.
    if (env.MEDIA) { const served = await serveVideo(context.request, env.MEDIA, videoKey); if (served) return served; }
  }
  const target = context.request.method === 'DELETE' ? MEDIA_ITEM.exec(context.url.pathname) : null;
  if (target) {
    // Kysely de EmDash (sin dependencia nueva): se usa el constructor de consultas de la propia instancia.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (context.locals as { emdash?: { db?: any } }).emdash?.db;
    if (!db) return refuse(409, 'No se puede comprobar si el medio está en uso; no se borra.');
    const row = await db.selectFrom('_emdash_media_usage_sources as s')
      .innerJoin('_emdash_media_usage as u', (join: any) => join.onRef('u.source_key', '=', 's.source_key').onRef('u.generation', '=', 's.current_generation'))
      .select((eb: any) => eb.fn.countAll().as('n')).where('u.media_id', '=', target[1]).executeTakeFirst();
    const uses = Number(row?.n ?? 0);
    if (uses > 0) return refuse(409, `El medio está en uso en ${uses} lugar(es) del contenido; quítalo de las páginas antes de borrarlo.`);
  }
  return (await cmsMiddleware(context, next)) as Response;
});
