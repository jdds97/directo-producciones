// Entrega de vídeo desde R2 con soporte de Range. La ruta nativa de EmDash 1.1.0 (/_emdash/api/media/file/<clave>) responde siempre 200 con el
// cuerpo completo: sin 206 Safari/iOS no reproduce <video> y ningún navegador puede saltar a otro punto. Lógica pura sobre un R2 simulable
// (sin Astro ni cloudflare:workers) para probarla con node:test. Solo atiende claves .mp4; las imágenes siguen por EmDash.
export interface R2ObjectLike { size: number; httpEtag: string; httpMetadata?: { contentType?: string } }
export interface R2BucketLike {
  head(key: string): Promise<R2ObjectLike | null>;
  get(key: string, options?: { range?: { offset: number; length: number } }): Promise<(R2ObjectLike & { body: ReadableStream<Uint8Array> }) | null>;
}

const VIDEO_KEY = /^\/_emdash\/api\/media\/file\/([A-Za-z0-9][A-Za-z0-9._-]{0,200}\.mp4)$/i;
/** Clave de vídeo de una ruta de medios; null si no lo es (se deja pasar a EmDash). */
export const videoKeyOf = (pathname: string): string | null => {
  const key = VIDEO_KEY.exec(pathname)?.[1];
  return key && !key.includes('..') ? key : null;
};

/** Un solo rango `bytes=a-b | a- | -n`. null = ausente o ilegible (se sirve completo, como permite RFC 9110); 'unsatisfiable' = 416. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec((header ?? '').trim());
  if (!m || (!m[1] && !m[2])) return null; // varios rangos u otra unidad: respuesta completa
  let start: number; let end: number;
  if (!m[1]) { const n = Number(m[2]); if (n === 0) return 'unsatisfiable'; start = Math.max(0, size - n); end = size - 1; }
  else { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1; if (m[2] && Number(m[2]) < start) return null; }
  return start >= size ? 'unsatisfiable' : { start, end };
}

const tag = (v: string) => v.trim().replace(/^W\//, '');
const matches = (list: string, etag: string) => list.trim() === '*' || list.split(',').some(t => tag(t) === tag(etag));

/** Responde GET/HEAD de un vídeo con 200/206/304/416; null si la clave no existe o no es vídeo (que siga EmDash). */
export async function serveVideo(request: Request, bucket: R2BucketLike, key: string): Promise<Response | null> {
  const head = await bucket.head(key);
  if (!head || head.httpMetadata?.contentType !== 'video/mp4') return null;
  const etag = head.httpEtag;
  const base: Record<string, string> = { 'Accept-Ranges': 'bytes', ETag: etag, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Content-Type': 'video/mp4' };
  const inm = request.headers.get('If-None-Match');
  if (inm && matches(inm, etag)) return new Response(null, { status: 304, headers: { 'Accept-Ranges': 'bytes', ETag: etag, 'Cache-Control': base['Cache-Control'] } });
  const ifRange = request.headers.get('If-Range');
  const range = ifRange && tag(ifRange) !== tag(etag) ? null : parseRange(request.headers.get('Range'), head.size);
  if (range === 'unsatisfiable') return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${head.size}`, 'Content-Length': '0' } });
  const part = range ?? { start: 0, end: head.size - 1 };
  const length = head.size === 0 ? 0 : part.end - part.start + 1;
  const headers = { ...base, 'Content-Length': String(length), ...(range ? { 'Content-Range': `bytes ${part.start}-${part.end}/${head.size}` } : {}) };
  const status = range ? 206 : 200;
  if (request.method === 'HEAD' || length === 0) return new Response(null, { status, headers });
  const object = await bucket.get(key, range ? { range: { offset: part.start, length } } : undefined);
  return object ? new Response(object.body, { status, headers }) : null;
}
