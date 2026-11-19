// Política editorial v2 (fase 03). Sin dependencias de EmDash: función pura, probada en tests/editorial-policy.test.ts.
//  Clase A: texto sin afirmaciones → lo publica un Editor tras pasar los lints.
//  Clase B: afirmaciones (cifras, años, %, servicios fuera de catálogo), textos legales y entradas reales del blog
//           → exige un Admin con correspondencia en el registro de aprobadores, o revisión exacta (digest) heredada.
//  Bloqueos duros (ni A ni B): marcadores/frases prohibidos, hechos sin aprobación, valores de hechos tecleados
//           a mano, derechos de logotipo/vídeo sin evidencia, rol insuficiente.
// Un lint por patrón no demuestra que el texto sea veraz: solo decide quién tiene que mirarlo y deja el rastro.
import { createHash } from 'node:crypto';
import { collections, lists, imageFieldSlugs, videoFieldSlugs, RIGHTS_FIELD, EMAIL_PATTERN } from '../cms/contract.ts';
import { uploadKey, videoKey, isLibraryKey } from './media.ts';
import { approvedFact, facts } from './facts.ts';
import { reviewMarkerText } from './content-policy.ts';
import { siteLinks } from './site-navigation.ts';

export interface Actor { id: string; role: number }
export interface PolicyInput {
  collection: string;
  data: Record<string, unknown>;
  actor?: Actor;
  /** Ids autorizados como aprobador (registro versionado + sintéticos locales). */
  approverIds: ReadonlySet<string>;
  /** Revisión exacta heredada (digest SHA-256 del contenido); true si existe y es válida. */
  legacyReview?: boolean;
  local: boolean;
}
export interface PolicyDecision { allow: boolean; klass: 'A' | 'B'; reasons: string[]; claims: string[]; factIds: string[]; digest: string }

export const ROLE = { contributor: 20, author: 30, editor: 40, admin: 50 } as const;
const pageSlugs = new Set(collections.filter(c => c.kind !== 'legal').map(c => c.slug));
const legalSlugs = new Set(collections.filter(c => c.kind === 'legal').map(c => c.slug));
const listSlugs = new Set(lists.map(l => l.slug));
export const managedCollections = new Set([...pageSlugs, ...legalSlugs, ...listSlugs, 'posts']);
export const singletonCollections = new Set(collections.map(c => c.slug));

const textFields = (collection: string): string[] | 'all-strings' => {
  const col = collections.find(c => c.slug === collection);
  if (col) return ['title', ...col.fields.filter(f => !f.type).map(f => f.slug)];
  const list = lists.find(l => l.slug === collection);
  if (list) return list.fields.filter(f => f.type === 'string' || f.type === 'text').map(f => f.slug).filter(s => s !== 'rights_source' && s !== 'email');
  return 'all-strings';
};
function portableText(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value.flatMap(block => {
    if (!block || typeof block !== 'object' || (block as { _type?: string })._type !== 'block') throw new Error('Medios y embeds en el cuerpo pendientes de revisión de derechos.');
    return ((block as { children?: { text?: string }[] }).children ?? []).map(span => span.text ?? '');
  }).join(' ');
}
export function collectText(collection: string, data: Record<string, unknown>): string {
  const fields = textFields(collection);
  const keys = fields === 'all-strings' ? ['title', 'excerpt'] : fields;
  const parts = keys.map(k => (typeof data[k] === 'string' ? (data[k] as string) : ''));
  if (collection === 'posts') parts.push(portableText(data.content));
  return parts.join('\n');
}
export function contentDigest(value: unknown): string {
  const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, stable(x)])) : v;
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

const claimPatterns: [RegExp, string][] = [
  [/[%€$£]/u, 'porcentaje o importe'],
  [/\+\s?\d/u, 'cifra con «+»'],
  [/\b\d[\d.,]*\s*(?:años|clientes|empresas|eventos|retransmisiones|proyectos|marcas|seguidores|espectadores|visitas|horas|cámaras|millones)\b/iu, 'cifra de actividad o alcance'],
  [/\b(?:1[89]|20)\d{2}\b/u, 'año'],
  [/bonding|starlink|congresos|traducción|\bIMAG\b/iu, 'servicio fuera del catálogo aprobado'],
  [/\b(?:líder|número uno|el mejor|única?|pioneros?|referente|premiad[oa])\b/iu, 'superlativo'],
];
// Marcadores y frases prohibidas. Distinto de facts.forbiddenText: «TODO»/«PENDING» solo cuentan en mayúsculas
// (la palabra española «todo» es texto legítimo) y el resto de frases se comparan sin distinguir mayúsculas.
const placeholderRe = /\b(?:TODO|PENDING)\b/;
const bannedPhraseRe = /\b(?:lorem|example\.com)\b|\+34-600-000-000|sin cortes|100\s*%|líderes|mejor precio|garantizamos/i;
const tokenRe = /\{\{fact:([a-z0-9_.]+)\}\}/g;

const isTrue = (v: unknown) => v === true || v === 1 || v === '1' || v === 'true';
const filled = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
/** Fotos: biblioteca de medios propia o biblioteca autorizada del sitio, con texto alternativo y derechos. Nunca URL libre. */
export function mediaReasons(collection: string, data: Record<string, unknown>): string[] {
  const out: string[] = [];
  const col = collections.find(c => c.slug === collection);
  let uploads = 0;
  // Vídeos de página: solo MP4 propio de la biblioteca de medios o pieza autorizada del sitio; el subido exige derechos.
  for (const slot of col?.videos ?? []) {
    const n = videoFieldSlugs(slot), name = `${slot.section} · ${slot.label}`, value = data[n.file], ref = data[n.ref];
    if (value !== undefined && value !== null && value !== '') { if (videoKey(value)) uploads++; else out.push(`${name}: vídeo no admitido (proveedor externo, tipo de archivo o referencia no válidos; solo MP4).`); }
    if (filled(ref) && !field(col!.fields, n.ref)?.options?.includes(ref as string)) out.push(`${name}: el vídeo del sitio no está en la biblioteca autorizada.`);
  }
  if (col?.images) {
    for (const slot of col.images) {
      const n = imageFieldSlugs(slot), name = `${slot.section} · ${slot.label}`;
      const media = data[n.image], ref = data[n.ref];
      const hasMedia = media !== undefined && media !== null && media !== '';
      if (hasMedia) { if (uploadKey(media)) uploads++; else out.push(`${name}: foto no admitida (proveedor externo, tipo de archivo o referencia no válidos).`); }
      if (filled(ref) && !(isLibraryKey(ref) && field(col.fields, n.ref)?.options?.includes(ref as string))) out.push(`${name}: la foto del sitio no está en la biblioteca autorizada.`);
      if (data[n.decor] === undefined || data[n.decor] === null ? slot.decor : isTrue(data[n.decor])) continue;
      const alt = typeof data[n.alt] === 'string' ? (data[n.alt] as string).trim() : '';
      // Sin cambiar la foto, un alt vacío cae al texto del sitio; al cambiarla hace falta uno propio que la describa.
      const changed = hasMedia || (filled(ref) && ref !== slot.ref);
      if (changed && !alt) out.push(`${name}: falta el texto alternativo (o márcala como decorativa).`);
      else if (changed && alt === slot.alt.trim()) out.push(`${name}: has cambiado la foto; escribe un texto alternativo que la describa.`);
    }
  }
  if (uploads && !filled(data[RIGHTS_FIELD])) out.push('Fotos o vídeos subidos sin evidencia de derechos (quién autoriza y cuándo).');
  const list = lists.find(l => l.slug === collection);
  if (list) {
    for (const f of list.fields.filter(x => x.media === 'image')) {
      const media = data[f.slug], ref = data[`${f.slug}_ref`], label = `${list.labelSingular} · ${f.label.split(' · ')[0]}`;
      const hasMedia = media !== undefined && media !== null && media !== '';
      if (hasMedia && !uploadKey(media)) out.push(`${label}: foto no admitida (proveedor externo, tipo de archivo o referencia no válidos).`);
      const refField = list.fields.find(x => x.slug === `${f.slug}_ref`);
      if (filled(ref) && !(isLibraryKey(ref) && refField?.options?.includes(ref as string))) out.push(`${label}: la foto del sitio no está en la biblioteca autorizada.`);
      const hasAltField = list.fields.some(x => x.slug === `${f.slug}_alt`);
      if (hasAltField && (hasMedia || filled(ref)) && !filled(data[`${f.slug}_alt`])) out.push(`${label}: falta el texto alternativo.`);
    }
    let ownVideo = false;
    for (const f of list.fields.filter(x => x.media === 'video')) {
      const value = data[f.slug], label = `${list.labelSingular} · ${f.label.split(' (')[0]}`;
      if (value === undefined || value === null || value === '') continue;
      if (videoKey(value)) ownVideo = true; else out.push(`${label}: vídeo no admitido (proveedor externo, tipo de archivo o referencia no válidos; solo MP4).`);
    }
    if (collection === 'projects') {
      const poster = filled(data.poster_ref) || (data.poster !== undefined && data.poster !== null && data.poster !== '');
      if (!ownVideo && !filled(data.video_key)) out.push('Proyecto: falta el vídeo (sube un MP4 o elige una pieza del sitio).');
      if (ownVideo && !poster) out.push('Proyecto: un vídeo propio necesita su imagen de espera (póster).');
      if (filled(data.link) && !knownRoutes.has(String(data.link).trim())) out.push('Proyecto: el enlace debe ser una ruta interna existente de la web.');
    }
    if (collection === 'team') {
      const photo = data.photo !== undefined && data.photo !== null && data.photo !== '' || filled(data.photo_ref);
      if (data.photo_state === 'pendiente' && photo) out.push('Equipo: el estado es «pendiente» pero hay foto; cambia el estado a «con_foto».');
      if (data.photo_state !== 'pendiente' && !photo) out.push('Equipo: sin foto hay que marcar el estado «pendiente» (no se publica un retrato vacío).');
    }
  }
  return out;
}
const field = <T extends { slug: string }>(fields: T[], slug: string) => fields.find(f => f.slug === slug);

export function evaluatePublish(input: PolicyInput): PolicyDecision {
  const { collection, data, actor } = input;
  const reasons: string[] = [];
  const claims: string[] = [];
  const digest = contentDigest({ collection, data });
  const deny = (reason: string) => reasons.push(reason);
  if (!managedCollections.has(collection)) { deny(`Colección sin política editorial: ${collection}`); return { allow: false, klass: 'B', reasons, claims, factIds: [], digest }; }
  const needRole = collection === 'posts' ? ROLE.author : ROLE.editor;
  if (!actor) deny('Publicación sin usuario identificado.');
  else if (actor.role < needRole) deny(`Rol insuficiente: ${collection} lo publica un ${collection === 'posts' ? 'autor' : 'editor'} o superior.`);

  let text: string;
  try { text = collectText(collection, data); } catch (error) { deny((error as Error).message); text = ''; }
  if (placeholderRe.test(text) || bannedPhraseRe.test(text)) deny('Texto prohibido o marcador provisional.');
  if (/\[[^\]]{2,}\]/.test(text)) deny('Marcador entre corchetes sin sustituir.');
  // Textos legales: un aviso de revisión o de texto por redactar no se publica nunca, ni con aprobación. También en local: la revisión
  // local lee el borrador semilla sin publicarlo (site-content), así que la barrera no le quita nada a <ReviewNote>.
  const legalMarker = legalSlugs.has(collection) ? text.match(reviewMarkerText)?.[0] : undefined;
  if (legalMarker) deny(`Texto legal con un aviso de revisión o por redactar («${legalMarker}»): sustitúyelo por el texto definitivo.`);
  const factIds = [...text.matchAll(tokenRe)].map(m => m[1]);
  for (const id of factIds) if (!approvedFact(id)) deny(`Hecho sin aprobación válida: ${id}`);
  const stripped = text.replace(tokenRe, ' ');
  // Los datos de contacto y de la entidad solo entran por referencia: teclear su valor los desacopla del hecho aprobado.
  for (const fact of facts) {
    if (!/^(?:contact|entity)\./.test(fact.id) || typeof fact.value !== 'string' || fact.value.length < 6) continue;
    const compact = stripped.replace(/[\s.-]/g, '');
    if (stripped.includes(fact.value) || compact.includes(fact.value.replace(/[\s.-]/g, ''))) deny(`Usa {{fact:${fact.id}}} en lugar de teclear el dato.`);
  }
  // Años o cifras que coinciden literalmente con un hecho aprobado referenciado no cuentan como afirmación nueva.
  let claimText = stripped;
  for (const id of factIds) { const v = approvedFact(id)?.value; if (v) claimText = claimText.replaceAll(v, ' '); }
  for (const [re, label] of claimPatterns) if (re.test(claimText)) claims.push(label);

  if (listSlugs.has(collection)) {
    const ok = data.rights_ok === true || data.rights_ok === 1;
    if (!ok || typeof data.rights_source !== 'string' || !data.rights_source.trim()) deny('Falta la confirmación de derechos y su evidencia.');
  }
  mediaReasons(collection, data).forEach(deny);
  // Correo del perfil: si se escribe uno propio debe ser una dirección válida y lo aprueba un administrador registrado,
  // salvo que coincida con un hecho de contacto ya aprobado (el valor por defecto sale del hecho, no del CMS).
  if (collection === 'team' && filled(data.email)) {
    const email = String(data.email).trim();
    if (!new RegExp(EMAIL_PATTERN).test(email)) deny('Correo del perfil no válido.');
    else if (!facts.some(f => /^contact\./.test(f.id) && f.value === email && approvedFact(f.id))) claims.push('dato de contacto propio (correo)');
  }
  if (collection === 'posts' && (data.featured_image && (typeof data.image_alt !== 'string' || !data.image_alt.trim()))) deny('La imagen destacada necesita texto alternativo.');

  const synthetic = collection === 'posts' && input.local && (data.synthetic === true || data.synthetic === 1);
  const needsApprover = legalSlugs.has(collection) || claims.length > 0 || (collection === 'posts' && !synthetic);
  if (needsApprover && !reasons.length) {
    const approver = actor && actor.role >= ROLE.admin && input.approverIds.has(actor.id);
    if (!approver && !input.legacyReview) deny(`Requiere aprobación de un administrador registrado${claims.length ? ` (${[...new Set(claims)].join(', ')})` : legalSlugs.has(collection) ? ' (texto legal)' : ' (entrada real)'}.`);
  }
  return { allow: reasons.length === 0, klass: needsApprover ? 'B' : 'A', reasons, claims: [...new Set(claims)], factIds, digest };
}

// `types` son solo las imágenes (los campos de imagen del contrato las usan como allowedMimeTypes); el vídeo va aparte.
export const MEDIA_LIMITS = { maxBytes: 10 * 1024 * 1024, maxVideoBytes: 40 * 1024 * 1024, types: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'], videoTypes: ['video/mp4'], headBytes: 256 * 1024 };
const MEDIA_EXT = /\.(?:jpe?g|png|webp|avif|mp4)$/i;
const MEDIA_MB = (bytes: number) => `${bytes / 1024 / 1024} MB`;
/** Tope en bytes según el tipo declarado (vídeo 40 MiB, imagen 10 MiB). */
export const mediaMaxBytes = (type: string) => (type.startsWith('video/') ? MEDIA_LIMITS.maxVideoBytes : MEDIA_LIMITS.maxBytes);
const VIDEO_HELP = 'Expórtalo como MP4 con vídeo H.264 y la casilla «Web optimizado» (HandBrake: formato MP4, códec H.264 x264).';
/** `form: true` = subida por formulario multipart (se lee en memoria): el vídeo solo entra por el selector del panel. */
export function mediaDenied(file: { type: string; size: number; name: string }, opts: { form?: boolean } = {}): string | null {
  const name = file.name ?? '';
  if (/\.(?:mov|webm|mkv|avi|m4v|hevc|mpe?g|wmv|flv|3gp)$/i.test(name) || /^video\/(?!mp4$)/.test(file.type)) return `Formato de vídeo no admitido (${file.type || name}). ${VIDEO_HELP}`;
  if (!MEDIA_EXT.test(name)) return 'Extensión de archivo no permitida (JPEG, PNG, WebP, AVIF o vídeo MP4; los SVG no se admiten).';
  if (!MEDIA_LIMITS.types.includes(file.type) && !MEDIA_LIMITS.videoTypes.includes(file.type)) return `Tipo de archivo no permitido: ${file.type || 'desconocido'} (JPEG, PNG, WebP, AVIF o vídeo MP4).`;
  if (/\.mp4$/i.test(name) !== (file.type === 'video/mp4')) return 'La extensión y el tipo del archivo no coinciden.';
  if (file.type === 'video/mp4' && opts.form) return 'Los vídeos se suben desde el selector de medios del panel, no por formulario.';
  if (file.size > mediaMaxBytes(file.type)) return `El archivo supera los ${MEDIA_MB(mediaMaxBytes(file.type))}.${file.type === 'video/mp4' ? ' Comprímelo (recomendado: portada hasta 8 MB, trabajos hasta 3 MB).' : ''}`;
  return null;
}

/** Tipo real por la firma de los primeros bytes (JPEG, PNG, WebP, AVIF); null si no es una imagen admitida. */
export function sniffImageType(head: Uint8Array): string | null {
  const at = (i: number, text: string) => [...text].every((c, k) => head[i + k] === c.charCodeAt(0));
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head[0] === 0x89 && at(1, 'PNG') && head[4] === 0x0d && head[5] === 0x0a && head[6] === 0x1a && head[7] === 0x0a) return 'image/png';
  if (at(0, 'RIFF') && at(8, 'WEBP')) return 'image/webp';
  if (at(4, 'ftyp') && (at(8, 'avif') || at(8, 'avis'))) return 'image/avif';
  return null;
}

/** Motivo de rechazo de un MP4 por sus primeros bytes: marca ftyp, moov antes que mdat (faststart) y códec avc1/avc3. Null = válido. */
export function mp4BytesDenied(head: Uint8Array): string | null {
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const tag = (i: number) => String.fromCharCode(...head.subarray(i, i + 4));
  if (head.length >= 4 && view.getUint32(0) === 0x1a45dfa3) return `El archivo es WebM/Matroska, no MP4. ${VIDEO_HELP}`;
  if (head.length < 12 || tag(4) !== 'ftyp') return `El contenido no es un vídeo MP4 válido. ${VIDEO_HELP}`;
  const brand = tag(8);
  if (brand === 'qt  ') return `El archivo es MOV (QuickTime), no MP4. ${VIDEO_HELP}`;
  if (!['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V '].includes(brand)) return `Variante de MP4 no admitida (${brand.trim()}). ${VIDEO_HELP}`;
  // Cajas de primer nivel: tamaño (4 bytes; 1 = 64 bits tras el tipo) + tipo.
  for (let pos = view.getUint32(0); pos + 8 <= head.length;) {
    const type = tag(pos + 4);
    let size = view.getUint32(pos);
    if (size === 1 && pos + 16 <= head.length) size = Number(view.getBigUint64(pos + 8));
    if (type === 'mdat') return `El vídeo no está preparado para la web (los datos van antes que el índice). Actívalo con la casilla «Web optimizado» (HandBrake) o «-movflags +faststart» (ffmpeg).`;
    if (type === 'moov') {
      const moov = head.subarray(pos + 8, Math.min(pos + size, head.length));
      const text = new TextDecoder('latin1').decode(moov);
      // ponytail: si el moov excede la cabeza leída y no muestra códec, se acepta; el sniff cubre la inmensa mayoría de clips cortos.
      const codec = /(hvc1|hev1|av01|vp09|avc1|avc3)/.exec(text)?.[1];
      if (codec && !codec.startsWith('avc')) return `El vídeo usa el códec ${codec === 'hvc1' || codec === 'hev1' ? 'HEVC (H.265)' : codec === 'av01' ? 'AV1' : 'VP9'}, que no se reproduce en todos los navegadores. Expórtalo con H.264.`;
      if (!codec && pos + size <= head.length) return `No se reconoce el códec H.264 del vídeo. ${VIDEO_HELP}`;
      return null;
    }
    if (size < 8) break;
    pos += size;
  }
  return `No se puede comprobar que el vídeo esté preparado para la web (falta el índice al principio). ${VIDEO_HELP}`;
}

/** Motivo de rechazo si el contenido no es el archivo que declara el tipo; null si coincide. */
export function mediaBytesDenied(declaredType: string, head: Uint8Array): string | null {
  if (declaredType.startsWith('video/')) return declaredType === 'video/mp4' ? mp4BytesDenied(head) : `Formato de vídeo no admitido (${declaredType}). ${VIDEO_HELP}`;
  const real = sniffImageType(head);
  if (!real) return 'El contenido no es una imagen JPEG, PNG, WebP o AVIF válida.';
  if (real !== declaredType) return `El contenido es ${real}, pero el archivo declara ${declaredType || 'ningún tipo'}.`;
  return null;
}

// ── Guardas estructurales (fase 2 de la auditoría EmDash, 3-11-2026) ─────────────────────────────────────
// Los editores cambian contenido, no estructura: nada de lo que sigue depende del texto, solo de la forma.

/** Campos de texto de una página que la web exige (site-content.pageCopy lanza un error fuera de local si falta uno). */
export function emptyRequiredFields(collection: string, data: Record<string, unknown>): string[] {
  const col = collections.find(c => c.slug === collection);
  if (!col) return [];
  return col.fields.filter(f => !f.type && !f.media && !(typeof data[f.slug] === 'string' && (data[f.slug] as string).trim())).map(f => f.label);
}

/** Motivos de retención que solo confirma el cliente al revisar (scripts de siembra y carga con --review). Los demás siguen bloqueando. */
export const clientConfirmsReason = /^(?:Requiere aprobación de un administrador registrado(?: \(.*\))?\.|Falta la confirmación de derechos y su evidencia\.)$/;
export const POST_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Cambio de slug (identificador de la URL). Páginas y fichas: fijo. Entradas: formato válido y fijo una vez publicadas. */
export function slugChangeDenied(collection: string, current: { slug: string | null; published: boolean } | null, next: unknown): string | null {
  if (next === undefined || next === null || (current && next === current.slug)) return null;
  if (singletonCollections.has(collection)) return 'El identificador de una página es fijo («main»).';
  if (listSlugs.has(collection)) {
    if (current) return 'El identificador de una ficha es fijo: la web enlaza datos aprobados por él.';
    return typeof next === 'string' && POST_SLUG.test(next) ? null : 'Identificador no válido: solo minúsculas, números y guiones (sin acentos ni espacios).';
  }
  if (collection === 'posts') {
    if (current?.published) return 'Una entrada publicada no cambia de URL: los enlaces existentes se romperían.';
    return typeof next === 'string' && POST_SLUG.test(next) ? null : 'Slug no válido: solo minúsculas, números y guiones (sin acentos ni espacios).';
  }
  return null;
}

/** Escrituras del panel bloqueadas para todos los roles: lo que el sitio no usa o se versiona en código. Null = sin objeción. */
export function panelWriteDenied(method: string, path: string): string | null {
  if (method === 'GET' || method === 'HEAD') return null;
  if (/^\/_emdash\/api\/(?:schema|collections|settings|menus|widgets|widget-areas|sections)(?:\/|$)/.test(path)) return 'Esquema, ajustes, menús, widgets y secciones se versionan en el código: solo lectura en el panel.';
  if (/^\/_emdash\/api\/redirects(?:\/|$)/.test(path)) return 'Las redirecciones se gestionan en config/url-map.json (pull request): solo lectura en el panel.';
  if (/^\/_emdash\/api\/admin\/(?:bylines|byline-fields)(?:\/|$)/.test(path)) return 'Las firmas de EmDash no se usan en la web: la autoría es el campo «Autor editorial» de la entrada.';
  if (/^\/_emdash\/api\/taxonomies(?:\/|$)/.test(path) && !/^\/_emdash\/api\/taxonomies\/(?:category|tag)\/terms(?:\/[^/]+)?\/?$/.test(path)) return 'Las taxonomías se versionan en el código.';
  const item = /^\/_emdash\/api\/content\/([^/]+)(?:\/([^/]+)(\/duplicate)?)?\/?$/.exec(path);
  if (item && item[3] && item[1] !== 'posts') return 'Duplicar solo está disponible para entradas del blog.';
  if (item && singletonCollections.has(item[1])) {
    if (method === 'POST' && !item[2]) return 'Esta página ya existe: edítala en lugar de crear otra.';
    if (method === 'DELETE' && item[2]) return 'Las páginas del sitio no se borran: edita su contenido.';
  }
  return null;
}

/** Términos del blog. Categorías: cerradas (solo administración crea, edita o borra). Nadie cambia el slug ni borra un término en uso. */
export function termWriteDenied(i: { method: string; taxonomy: string; termSlug?: string; bodySlug?: unknown; role: number; inUse: boolean }): string | null {
  if (i.method === 'GET' || i.method === 'HEAD') return null;
  if (i.taxonomy === 'category' && i.role < ROLE.admin) return 'Las categorías del blog son fijas: solo un administrador las gestiona.';
  if (i.method === 'PUT' && typeof i.bodySlug === 'string' && i.bodySlug !== i.termSlug && i.inUse) return 'Este término tiene entradas: cambiar su slug rompería sus enlaces.';
  if (i.method === 'DELETE' && i.inUse) return 'Este término tiene entradas: quítalo de ellas antes de borrarlo.';
  return null;
}

/** Fichas de lista que la web pinta: nunca puede quedar ninguna (la página caería o mostraría huecos). */
export function listWouldBeEmpty(rows: { id: string; visible?: unknown }[], target: string, nextVisible: boolean | null): boolean {
  // nextVisible: true = la ficha queda publicada y visible; false = publicada oculta; null = retirada o en la papelera.
  return nextVisible !== true && !rows.some(r => r.id !== target && r.visible !== false && r.visible !== 0);
}

// Enlaces internos de las entradas: deben llevar a algo que existe.
const ownOrigin = /^https?:\/\/(?:www\.)?directoproducciones\.com(?=\/|$)/i;
export const knownRoutes = new Set([
  ...collections.flatMap(c => c.routes), ...lists.flatMap(l => l.routes), ...siteLinks.map(l => l.href), '/blog/',
].filter(r => r !== '/404'));
export type InternalLink = { href: string; kind: 'route' | 'post' | 'category' | 'tag'; slug: string };
/** Enlaces internos (relativos o al dominio propio) del cuerpo Portable Text de una entrada. */
export function internalLinks(content: unknown): InternalLink[] {
  const out: InternalLink[] = [];
  for (const block of Array.isArray(content) ? content : []) {
    for (const def of ((block as { markDefs?: { href?: unknown }[] })?.markDefs ?? [])) {
      if (typeof def?.href !== 'string') continue;
      const raw = def.href.trim().replace(ownOrigin, '');
      if (!raw.startsWith('/') || raw.startsWith('//')) continue;
      const url = new URL(raw, 'https://x.invalid');
      const path = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
      const m = /^\/blog\/(?:(categoria|etiqueta)\/)?([^/]+)\/$/.exec(path);
      const cat = path === '/blog/' ? url.searchParams.get('categoria') : null;
      if (cat) out.push({ href: def.href, kind: 'category', slug: cat });
      else if (m) out.push({ href: def.href, kind: m[1] === 'categoria' ? 'category' : m[1] === 'etiqueta' ? 'tag' : 'post', slug: decodeURIComponent(m[2]) });
      else out.push({ href: def.href, kind: 'route', slug: path });
    }
  }
  return out;
}
