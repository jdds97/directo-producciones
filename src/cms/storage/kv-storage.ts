// Almacenamiento de medios EmDash sobre Workers KV (vuelta atrás con DP_MEDIA_STORAGE=kv hasta retirar KV, D-59). Lógica pura y comprobable
// con un KV simulado; el binding real se inyecta desde kv.ts. NO es R2: la consistencia es eventual.
//
// Límites oficiales Free (docs.cloudflare.com/kv/platform/limits, act. 30-oct-2026): 1 GB, valor 25 MiB,
// clave 512 B, metadato 1024 B, 100.000 lecturas/día, 1.000 escrituras/borrados/listas al día, 1 escritura/s
// por clave. Superada una cuota, KV falla esa operación hasta las 00:00 UTC: el adaptador la propaga como
// EmDashStorageError y no reintenta.
import { EmDashStorageError } from 'emdash';
import type { DownloadResult, FileInfo, ListOptions, ListResult, SignedUploadOptions, SignedUploadUrl, Storage, UploadResult } from 'emdash';

/** Subconjunto del binding KVNamespace que usa el adaptador (evita depender de @cloudflare/workers-types). */
export interface KvLike {
  put(key: string, value: ArrayBuffer, options?: { metadata?: unknown }): Promise<void>;
  getWithMetadata(key: string, options: { type: 'stream'; cacheTtl?: number }): Promise<{ value: ReadableStream<Uint8Array> | null; metadata: unknown }>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{ keys: { name: string; metadata?: unknown }[]; list_complete: boolean; cursor?: string }>;
}

export interface KvStorageConfig {
  /** Nombre del binding KV en wrangler (p. ej. MEDIA_KV). */
  binding: string;
  /** Tope por objeto de medios. Por defecto 10 MiB; nunca más de 25 MiB (límite duro de KV). */
  maxBytes?: number;
  /** cacheTtl de las lecturas (s). Mínimo de KV: 30. Acota la ventana de lectura negativa/obsoleta en otro PoP. */
  cacheTtl?: number;
  /** Reintentos de download() ante "no existe" y espera entre ellos (ms). Por defecto 0: download() sirve las imágenes públicas y
   *  cada reintento es otra lectura de KV (cuota Free); la confirmación de subida ya comprueba exists() antes de leer. */
  lookupRetries?: number;
  retryDelayMs?: number;
}

export const KV_VALUE_LIMIT = 25 * 1024 * 1024;
export const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
export const BACKUP_PREFIX = 'backups/';
const MAX_KEY_BYTES = 512;
const KEY_RE = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const CT_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;

/** Único metadato guardado: sin nombres de fichero, autor ni EXIF (eso vive en D1). */
interface ObjectMeta { v: 1; ct: string; size: number; up: string }

function isMeta(m: unknown): m is ObjectMeta {
  const o = m as ObjectMeta | null;
  return !!o && typeof o === 'object' && o.v === 1 && typeof o.ct === 'string' && Number.isSafeInteger(o.size) && o.size >= 0 && typeof o.up === 'string' && !Number.isNaN(Date.parse(o.up));
}

function checkKey(key: string): string {
  if (typeof key !== 'string' || !KEY_RE.test(key) || key.split('/').some((s) => s === '.' || s === '..') || new TextEncoder().encode(key).length > MAX_KEY_BYTES) {
    throw new EmDashStorageError(`Invalid file path: ${key}`, 'INVALID_PATH');
  }
  return key;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const notFound = (key: string) => new EmDashStorageError(`File not found: ${key}`, 'NOT_FOUND');

export class KvStorage implements Storage {
  private readonly maxBytes: number;
  private readonly cacheTtl: number;
  private readonly retries: number;
  private readonly retryDelayMs: number;

  constructor(private readonly kv: KvLike, config: Omit<KvStorageConfig, 'binding'> = {}) {
    this.maxBytes = Math.min(config.maxBytes ?? DEFAULT_MAX_BYTES, KV_VALUE_LIMIT);
    this.cacheTtl = Math.max(config.cacheTtl ?? 30, 30);
    this.retries = config.lookupRetries ?? 0;
    this.retryDelayMs = config.retryDelayMs ?? 250;
    if (!(this.maxBytes > 0)) throw new EmDashStorageError('maxBytes must be positive', 'CONFIGURATION_ERROR');
  }

  /** Los backups (JSON en memoria) pueden pasar de los 10 MiB de medios; el techo es el de KV. */
  private limitFor(key: string): number {
    return key.startsWith(BACKUP_PREFIX) ? KV_VALUE_LIMIT : this.maxBytes;
  }

  private async collect(body: Buffer | Uint8Array | ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
    if (!(body instanceof ReadableStream)) {
      if (body.byteLength > limit) throw new EmDashStorageError(`File exceeds ${limit} bytes`, 'PAYLOAD_TOO_LARGE');
      return body;
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > limit) {
          await reader.cancel().catch(() => undefined);
          throw new EmDashStorageError(`File exceeds ${limit} bytes`, 'PAYLOAD_TOO_LARGE');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.byteLength; }
    return out;
  }

  async upload(options: { key: string; body: Buffer | Uint8Array | ReadableStream<Uint8Array>; contentType: string; cacheControl?: string }): Promise<UploadResult> {
    const key = checkKey(options.key);
    if (!CT_RE.test(options.contentType)) throw new EmDashStorageError('Invalid content type', 'VALIDATION_ERROR');
    // cacheControl se ignora a propósito: la ruta de EmDash fija su propia política al servir.
    let bytes: Uint8Array;
    try {
      bytes = await this.collect(options.body, this.limitFor(key));
    } catch (error) {
      // Conserva errores del origen (p. ej. UploadBodyError de EmDash) en la cadena cause.
      if (error instanceof EmDashStorageError) throw error;
      throw new EmDashStorageError(`Failed to read upload body: ${key}`, 'UPLOAD_FAILED', error);
    }
    const meta: ObjectMeta = { v: 1, ct: options.contentType.toLowerCase(), size: bytes.byteLength, up: new Date().toISOString() };
    try {
      const buf = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? (bytes.buffer as ArrayBuffer) : (bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
      await this.kv.put(key, buf, { metadata: meta });
    } catch (error) {
      // Cuota diaria agotada (1.000 escrituras), 1 escritura/s por clave, etc.: error visible, sin reintento.
      throw new EmDashStorageError(`Failed to upload file: ${key}`, 'UPLOAD_FAILED', error);
    }
    return { key, url: this.getPublicUrl(key), size: bytes.byteLength };
  }

  private async read(key: string): Promise<{ body: ReadableStream<Uint8Array>; meta: ObjectMeta } | null> {
    const { value, metadata } = await this.kv.getWithMetadata(key, { type: 'stream', cacheTtl: this.cacheTtl });
    if (!value) return null;
    if (!isMeta(metadata)) {
      await value.cancel().catch(() => undefined);
      throw new EmDashStorageError(`Object without valid metadata: ${key}`, 'CORRUPT_OBJECT');
    }
    return { body: value, meta: metadata };
  }

  async download(key: string): Promise<DownloadResult> {
    checkKey(key);
    try {
      // Reintentos opcionales (lookupRetries): cubrirían carreras dentro del mismo PoP. NO garantizan lectura en otro PoP: una
      // lectura negativa cacheada puede durar hasta cacheTtl (≥30 s, por defecto 60 s en KV).
      for (let attempt = 0; attempt <= this.retries; attempt++) {
        const found = await this.read(key);
        if (found) return { body: found.body, contentType: found.meta.ct, size: found.meta.size };
        if (attempt < this.retries) await sleep(this.retryDelayMs);
      }
    } catch (error) {
      if (error instanceof EmDashStorageError) throw error;
      throw new EmDashStorageError(`Failed to download file: ${key}`, 'DOWNLOAD_FAILED', error);
    }
    throw notFound(key);
  }

  async exists(key: string): Promise<boolean> {
    checkKey(key);
    try {
      const found = await this.read(key);
      if (!found) return false;
      await found.body.cancel().catch(() => undefined);
      return true;
    } catch (error) {
      if (error instanceof EmDashStorageError) throw error;
      throw new EmDashStorageError(`Failed to check file existence: ${key}`, 'HEAD_FAILED', error);
    }
  }

  async delete(key: string): Promise<void> {
    checkKey(key);
    try {
      await this.kv.delete(key); // idempotente; en otros PoP puede seguir sirviéndose hasta cacheTtl
    } catch (error) {
      throw new EmDashStorageError(`Failed to delete file: ${key}`, 'DELETE_FAILED', error);
    }
  }

  async list(options: ListOptions = {}): Promise<ListResult> {
    try {
      const page = await this.kv.list({ prefix: options.prefix, limit: Math.min(Math.max(options.limit ?? 1000, 1), 1000), cursor: options.cursor });
      // Se omiten claves ajenas sin nuestro metadato; list() también es eventualmente consistente.
      const files: FileInfo[] = page.keys.flatMap((k) => (isMeta(k.metadata) ? [{ key: k.name, size: k.metadata.size, lastModified: new Date(k.metadata.up) }] : []));
      return { files, nextCursor: page.list_complete ? undefined : page.cursor };
    } catch (error) {
      throw new EmDashStorageError('Failed to list files', 'LIST_FAILED', error);
    }
  }

  async getSignedUploadUrl(_options: SignedUploadOptions): Promise<SignedUploadUrl> {
    // Igual que R2 con binding: EmDash cae a PUT /_emdash/api/media/{id}/upload a través del Worker.
    throw new EmDashStorageError('KV bindings do not support pre-signed upload URLs. Upload through the Worker.', 'NOT_SUPPORTED');
  }

  getPublicUrl(key: string): string {
    return `/_emdash/api/media/file/${key}`;
  }
}
