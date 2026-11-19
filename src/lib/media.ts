// Capa única de lectura de imágenes. Funciones puras (sin EmDash ni Astro): las usan site-content, la política de
// publicación y las pruebas. Una imagen editable se resuelve de dos orígenes cerrados, nunca de una URL libre:
//  1. «upload»: elemento de la biblioteca de medios de EmDash (almacenamiento propio, ruta /_emdash/api/media/file/<clave>).
//  2. «library»: clave de la biblioteca autorizada del sitio (src/lib/media-registry.ts), con su srcset y dimensiones.
// Prevalece la foto de la biblioteca de medios si existe. Ningún borrador entra aquí: el llamador lee solo contenido publicado.
import { mediaRegistry, videoRegistry, type MediaEntry } from './media-registry';

export const UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
export const VIDEO_TYPES = ['video/mp4'];
export const MEDIA_ROUTE = '/_emdash/api/media/file/';
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;

export interface ResolvedImage {
  src: string; srcset?: string; width?: number; height?: number; alt: string;
  /** object-position (porcentajes) del foco; vacío si no hay foco definido. */
  focus?: string; origin: 'library' | 'upload'; ref?: string;
}
export interface SlotDefaults { ref: string; alt: string; decor?: boolean; focus?: string }
type Row = Record<string, unknown>;

const isTrue = (v: unknown) => v === true || v === 1 || v === '1' || v === 'true';
const pct = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1 ? Math.round(n * 10_000) / 100 : null);
export const focusOf = (x: unknown, y: unknown): string | undefined => {
  const fx = pct(x), fy = pct(y);
  return fx === null || fy === null ? undefined : `${fx}% ${fy}%`;
};

/** Clave de almacenamiento de un valor de medio de EmDash (imagen o archivo), o null si no es del tipo admitido. */
function storageKey(value: unknown, types: string[]): string | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as { provider?: unknown; mimeType?: unknown; src?: unknown; meta?: { storageKey?: unknown } };
  if (v.provider !== undefined && v.provider !== null && v.provider !== 'local') return null; // sin proveedores externos
  if (typeof v.mimeType === 'string' && !types.includes(v.mimeType)) return null; // sin SVG ni otros tipos
  const fromSrc = typeof v.src === 'string' && v.src.startsWith(MEDIA_ROUTE) ? v.src.slice(MEDIA_ROUTE.length) : undefined;
  const key = typeof v.meta?.storageKey === 'string' ? v.meta.storageKey : fromSrc;
  return key && KEY_RE.test(key) && !key.includes('..') ? key : null;
}
/** Clave de almacenamiento de un valor de imagen de EmDash, o null si no es una foto propia admitida. */
export const uploadKey = (value: unknown): string | null => storageKey(value, UPLOAD_TYPES);
/** Ídem para un vídeo subido: solo MP4 (la ruta con Range del Worker sirve claves .mp4). */
export function videoKey(value: unknown): string | null {
  const key = storageKey(value, VIDEO_TYPES);
  return key && /\.mp4$/i.test(key) ? key : null;
}

export function isLibraryKey(key: unknown): key is string {
  return typeof key === 'string' && Object.hasOwn(mediaRegistry, key);
}

/** Resuelve una ranura. `names` = nombres de campo (ver imageFieldSlugs en el contrato). */
export function resolveImage(row: Row, names: { image: string; ref: string; alt: string; decor: string }, slot: SlotDefaults, opts: { local: boolean; where: string }): ResolvedImage {
  const decorValue = row[names.decor];
  const decorative = decorValue === undefined || decorValue === null ? Boolean(slot.decor) : isTrue(decorValue);
  const altValue = row[names.alt];
  const alt = decorative ? '' : typeof altValue === 'string' && altValue.trim() ? altValue.trim() : slot.alt;
  const value = row[names.image] as { width?: number; height?: number; focalX?: unknown; focalY?: unknown } | null | undefined;
  const key = uploadKey(value);
  if (value && !key) {
    if (!opts.local) throw new Error(`${opts.where}: foto de la biblioteca de medios no admitida (proveedor externo, tipo o clave no válidos).`);
    console.warn(`[media] ${opts.where}: foto no admitida; se usa la foto del sitio`);
  }
  if (key) {
    const out: ResolvedImage = { src: `${MEDIA_ROUTE}${key}`, alt, origin: 'upload' };
    if (typeof value!.width === 'number' && typeof value!.height === 'number') { out.width = value!.width; out.height = value!.height; }
    const focus = focusOf(value!.focalX, value!.focalY);
    if (focus) out.focus = focus;
    return out;
  }
  const wanted = row[names.ref];
  let ref = typeof wanted === 'string' && wanted ? wanted : slot.ref;
  if (!isLibraryKey(ref)) {
    if (!opts.local) throw new Error(`${opts.where}: la foto del sitio «${String(ref)}» no está en la biblioteca autorizada.`);
    console.warn(`[media] ${opts.where}: foto del sitio desconocida «${String(ref)}»; se usa la predeterminada`);
    ref = slot.ref;
  }
  const entry: MediaEntry = mediaRegistry[ref];
  return { src: entry.src, ...(entry.srcset ? { srcset: entry.srcset } : {}), ...(entry.w ? { width: entry.w, height: entry.h } : {}), alt, ...(slot.focus && ref === slot.ref ? { focus: slot.focus } : {}), origin: 'library', ref };
}

export interface ImgOptions {
  sizes?: string; loading?: 'lazy' | 'eager'; priority?: boolean; width?: number; height?: number; decoding?: 'async' | 'sync' | 'auto';
}
/** Atributos <img> con dimensiones, relación de aspecto, foco, carga y prioridad coherentes. */
export function imgAttrs(image: ResolvedImage, o: ImgOptions = {}): Record<string, string | number | undefined> {
  const width = o.width ?? image.width, height = o.height ?? image.height;
  return {
    src: image.src,
    ...(image.srcset ? { srcset: image.srcset, sizes: o.sizes } : {}),
    alt: image.alt, width, height,
    loading: o.loading ?? (o.priority ? 'eager' : 'lazy'),
    fetchpriority: o.priority ? 'high' : undefined,
    decoding: o.decoding ?? 'async',
    style: image.focus ? `object-position:${image.focus}` : undefined,
  };
}

export interface ResolvedVideo { src: string; origin: 'library' | 'upload'; ref?: string }
/** Vídeo de una ranura: el subido a la biblioteca de medios prevalece; si no, la clave del sitio (o la de la ranura). `names` = { file, ref }. */
export function resolveVideo(row: Row, names: { file: string; ref: string }, slot: { ref: string }, opts: { local: boolean; where: string }): ResolvedVideo {
  const value = row[names.file];
  const key = videoKey(value);
  if (key) return { src: `${MEDIA_ROUTE}${key}`, origin: 'upload' };
  // ponytail: un vídeo no admitido no tumba la página (a diferencia de una foto): se avisa y se usa el material del sitio. La política editorial lo bloquea al publicar.
  if (value) console.warn(`[media] ${opts.where}: vídeo no admitido (proveedor, tipo o clave no válidos); se usa el vídeo del sitio`);
  const wanted = row[names.ref];
  let ref = typeof wanted === 'string' && wanted ? wanted : slot.ref;
  if (!Object.hasOwn(videoRegistry, ref)) {
    if (!opts.local) throw new Error(`${opts.where}: el vídeo del sitio «${ref}» no está en la biblioteca autorizada.`);
    console.warn(`[media] ${opts.where}: vídeo del sitio desconocido «${ref}»; se usa el predeterminado`);
    ref = slot.ref;
  }
  return { src: videoRegistry[ref].src, origin: 'library', ref };
}
