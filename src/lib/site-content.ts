// Capa única de lectura del contenido corporativo. Ninguna página llama a EmDash directamente.
//  - Textos editables: entrada publicada de la colección (contrato en src/cms/contract.ts).
//  - Fotos editables: pageImages/getTeam/getBandLogos/getClients/getProjects resuelven la ranura con src/lib/media.ts
//    (biblioteca de medios de EmDash o biblioteca autorizada del sitio; nunca una URL libre).
//  - Microcopy fijo: src/content/microcopy.json (código).
//  - Hechos aprobados: tokens {{fact:id}} sustituidos por approvedFact(); el CMS nunca guarda su valor.
// Sin fallback silencioso: en local, si falta una entrada publicada se usa el borrador semilla y se avisa
// en el log; en preview/producción falta de contenido = error.
import { getEmDashCollection, getEmDashEntry } from 'emdash';
import { collections, lists, SINGLETON_SLUG, imageFieldSlugs, videoFieldSlugs, teamEmailFacts, EMAIL_PATTERN, projectCategories, type CollectionDef } from '../cms/contract.ts';
import { resolveImage, resolveVideo, videoKey, MEDIA_ROUTE, type ResolvedImage } from './media';
import { blogPublishedAt } from './blog';
import type { VideoMeta } from './seo';
import drafts from '../../seed/content-drafts.json';
import microcopy from '../content/microcopy.json';
import { approvedFact } from './facts';
import { APP_ENV } from '../config/flags';
import { m4PortfolioProjects } from './m4-portfolio-projects';
import { navigationItems, type SiteLink } from './site-navigation';

type Row = Record<string, unknown>;
const TTL_MS = 30_000;
const cache = new Map<string, { at: number; row: Row[] }>();
const warned = new Set<string>();
const seedRows = (slug: string): Row[] =>
  ((drafts.content as Record<string, { slug: string; data: Row }[]>)[slug] ?? []).map(entry => ({ ...entry.data, _id: entry.slug }));

/** Se llama tras publicar/despublicar (plugin) y en pruebas; la caducidad por TTL cubre otros isolates. */
export function invalidateSiteContent(slug?: string) { if (slug) { cache.delete(slug); cache.delete(`seo:${slug}`); } else cache.clear(); }

/** `allowEmpty`: una lista sin fichas publicadas es un estado válido (p. ej. proyectos) y no es un error en preview/producción. */
async function published(slug: string, limit: number, allowEmpty = false): Promise<Row[]> {
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.row;
  let rows: Row[] = [];
  try {
    const result = await getEmDashCollection(slug, { status: 'published', limit });
    if (result.error) throw result.error;
    rows = result.entries.map(entry => ({ ...(entry.data as Row), _id: entry.id, _published: blogPublishedAt(entry) }));
  } catch (error) {
    if (APP_ENV !== 'local') throw error;
    if (!warned.has(`err:${slug}`)) { warned.add(`err:${slug}`); console.warn(`[site-content] ${slug}: lectura CMS no disponible (${(error as Error).message}); semilla local`); }
  }
  // ponytail: en local, una ficha de lista publicada sustituye a su valor por defecto (mismo id) y el resto de fichas siguen visibles;
  // sin esto, publicar una sola persona/logo ocultaría las demás. En preview/producción se exige publicar todas (sin respaldo en borrador).
  if (rows.length && APP_ENV === 'local' && lists.some(list => list.slug === slug)) {
    const have = new Set(rows.map(row => row._id));
    rows = [...rows, ...seedRows(slug).filter(row => !have.has(row._id))];
  }
  if (!rows.length) {
    if (allowEmpty && APP_ENV !== 'local') { cache.set(slug, { at: Date.now(), row: rows }); return rows; }
    if (APP_ENV !== 'local') throw new Error(`Contenido publicado ausente en «${slug}»: publica la entrada antes de desplegar.`);
    if (!warned.has(slug)) { warned.add(slug); console.warn(`[site-content] ${slug}: sin entrada publicada; se usa la semilla local (borrador)`); }
    rows = seedRows(slug);
  }
  cache.set(slug, { at: Date.now(), row: rows });
  return rows;
}

function resolveTokens(value: string, where: string): string {
  return value.replace(/\{\{fact:([a-z0-9_.]+)\}\}/g, (_, id: string) => {
    const fact = approvedFact(id);
    if (!fact) throw new Error(`${where}: el hecho «${id}» no tiene aprobación válida`);
    return fact.value;
  });
}

const fixedFor = (block: string): Record<string, string> => (microcopy as Record<string, Record<string, string>>)[block] ?? {};
function fieldsFor(block: string): { col: CollectionDef; f: CollectionDef['fields'][number] }[] {
  return collections.flatMap(col => col.fields.filter(f => (f.block ?? col.block) === block).map(f => ({ col, f })));
}

/** Texto de un bloque: microcopy fijo + campos editables con claves heredadas (tNNN) y semánticas (slug). */
export async function pageCopy(block: string): Promise<Record<string, string>> {
  const out: Record<string, string> = { ...fixedFor(block) };
  const fields = fieldsFor(block);
  const rows = new Map<string, Row>();
  for (const slug of new Set(fields.map(item => item.col.slug))) rows.set(slug, (await published(slug, 1))[0] ?? {});
  for (const { col, f } of fields) {
    if (f.media) continue; // fotos, alt, decorativa y derechos: los lee pageImages, no son texto de la página
    let value = rows.get(col.slug)![f.slug];
    if (typeof value !== 'string' || !value.trim()) {
      if (APP_ENV !== 'local') throw new Error(`${col.slug}.${f.slug}: campo obligatorio vacío`);
      value = (seedRows(col.slug)[0] ?? {})[f.slug];
    }
    const text = resolveTokens(String(value ?? ''), `${col.slug}.${f.slug}`);
    out[f.slug] = text;
    out[f.key] = text;
  }
  return out;
}

const local = APP_ENV === 'local';
// La preview es revisión privada (Cloudflare Access + JWT verificado en el Worker): muestra lo mismo que local. Solo producción exige
// derechos confirmados (rights_ok) en cada ficha con foto/logo/vídeo.
const rightsOk = (row: Row) => APP_ENV !== 'production' || row.rights_ok === true || row.rights_ok === 1;
const shown = (row: Row) => row.visible !== false && row.visible !== 0 && rightsOk(row);
const bySort = (key = 'sort') => (a: Row, b: Row) => Number(a[key]) - Number(b[key]);
const names = (prefix: string) => ({ image: prefix, ref: `${prefix}_ref`, alt: `${prefix}_alt`, decor: `${prefix}_decor` });
const listImage = (row: Row, prefix: string, where: string, alt: string, ref?: string) =>
  resolveImage(row, names(prefix), { ref: ref ?? String(row[`${prefix}_ref`] ?? ''), alt }, { local, where });

/** Fotos editables de una página (colección con ranuras en el contrato), por nombre de ranura. */
export async function pageImages(collection: string): Promise<Record<string, ResolvedImage>> {
  const col = collections.find(c => c.slug === collection);
  if (!col?.images) throw new Error(`«${collection}» no declara fotos editables.`);
  const row = (await published(collection, 1))[0] ?? {};
  return Object.fromEntries(col.images.map(slot => [slot.slug, resolveImage(row, imageFieldSlugs(slot), slot, { local, where: `${collection}.${slot.slug}` })]));
}

export interface ClientItem { name: string; logo: ResolvedImage; dark: boolean }
export async function getClients(): Promise<ClientItem[]> {
  return (await published('clients', 200)).filter(shown).sort(bySort())
    .map(row => ({ name: String(row.name), logo: listImage(row, 'logo', `clients.${row._id}`, String(row.name)), dark: row.logo_dark === true || row.logo_dark === 1 }));
}

export type BandVariant = 'normal' | 'monocromo' | 'escudo_monocromo' | 'escudo_recorte' | 'catedral' | 'con_nombre';
export interface BandLogo { name: string; logo: ResolvedImage; variant: BandVariant }
export async function getBandLogos(): Promise<BandLogo[]> {
  return (await published('band_logos', 100)).filter(shown).sort(bySort())
    .map(row => ({ name: String(row.name), variant: String(row.variant || 'normal') as BandVariant, logo: listImage(row, 'logo', `band_logos.${row._id}`, row.variant === 'con_nombre' ? '' : String(row.name)) }));
}

export interface PageVideo { src: string; /** Versión vertical para móvil; ausente = se usa `src`. */ mobileSrc?: string; origin: 'library' | 'upload'; /** Fecha de publicación de la ficha, solo si el vídeo es propio (VideoObject). */ uploadedAt?: string }
/** Vídeo de una página con su versión móvil opcional: `desktop` y `mobile` son ranuras de vídeo del contrato. */
export async function pageVideo(collection: string, desktop: string, mobile: string): Promise<PageVideo> {
  const slots = collections.find(c => c.slug === collection)?.videos ?? [];
  const d = slots.find(slot => slot.slug === desktop), m = slots.find(slot => slot.slug === mobile);
  if (!d || !m) throw new Error(`«${collection}» no declara las ranuras de vídeo ${desktop} y ${mobile}.`);
  const row = (await published(collection, 1))[0] ?? {};
  const main = resolveVideo(row, videoFieldSlugs(d), d, { local, where: `${collection}.${desktop}` });
  const alt = resolveVideo(row, videoFieldSlugs(m), m, { local, where: `${collection}.${mobile}` });
  // Con vídeo de escritorio propio y sin móvil propio, el móvil usa el de escritorio (no el vertical del sitio, que sería otro contenido).
  const mobileSrc = alt.origin === 'upload' || main.origin === 'library' ? alt.src : undefined;
  return { src: main.src, ...(mobileSrc ? { mobileSrc } : {}), origin: main.origin, ...(main.origin === 'upload' && row._published ? { uploadedAt: String(row._published) } : {}) };
}

export interface Project { key: string; title: string; context: string; description: string; videoSrc: string; mobileVideoSrc?: string; poster: string; posterImage: ResolvedImage; width: number; height: number;
  portfolioCategories: readonly string[]; homeKind: string; homeSize: string; client: string; year?: number; link?: string; uploadedAt?: string }
const toNumber = (v: unknown) => (v === undefined || v === null || v === '' ? NaN : Number(v));
/** Orden finito: el primer valor numérico válido (el 0 cuenta); sin ninguno, al final. */
const order = (...values: unknown[]) => values.map(toNumber).find(Number.isFinite) ?? Number.MAX_SAFE_INTEGER;
/**
 * Proyectos publicados. «portfolio»: todos por `sort`. «home»: los marcados para «Trabajos recientes» por `home_sort`
 * (una ficha sin marcar nunca se muestra; solo una casilla desmarcada expresamente la oculta). Puede devolver una lista vacía.
 * Vídeo: el MP4 subido (+ vertical opcional para móvil) o, si no hay, la pieza del sitio elegida en `video_key`.
 */
export async function getProjects(context: 'portfolio' | 'home' = 'portfolio'): Promise<Project[]> {
  const home = context === 'home';
  const rows = (await published('projects', 50, true)).filter(shown)
    .filter(row => !home || !(row.show_home === false || row.show_home === 0 || row.show_home === '0'))
    .sort((a, b) => (home ? order(a.home_sort, a.sort) - order(b.home_sort, b.sort) : order(a.sort) - order(b.sort)));
  return rows.flatMap(row => {
    const where = `projects.${row._id}`;
    const media = m4PortfolioProjects.find(project => project.key === row.video_key);
    const main = videoKey(row.video), vertical = videoKey(row.video_vertical);
    if ((row.video && !main) || (row.video_vertical && !vertical)) console.warn(`[media] ${where}: vídeo no admitido (proveedor, tipo o clave no válidos); se usa el vídeo del sitio`);
    const own = main ?? vertical;
    if (!own && !media) { console.warn(`[site-content] ${where}: sin vídeo propio ni pieza del sitio; no se muestra`); return []; }
    const orientation = row.orientation === 'horizontal' || row.orientation === 'vertical' ? row.orientation : own || !media ? 'vertical' : media.width > media.height ? 'horizontal' : 'vertical';
    const sized = own || row.orientation;
    const [width, height] = !sized && media ? [media.width, media.height] : orientation === 'horizontal' ? [960, 540] : [720, 1280];
    const layout = row.home_layout === 'grande' ? ['cover', 'w618'] : row.home_layout === 'pila' ? ['stacked', 'w350'] : !own && media ? [media.homeKind, media.homeSize] : orientation === 'horizontal' ? ['cover', 'w618'] : ['stacked', 'w350'];
    const defaultPoster = media ? `coberturas/${media.poster.split('/').pop()!.replace(/\.webp$/, '')}` : 'coberturas/hero-review-poster';
    if (!media && !row.poster_ref && !row.poster) console.warn(`[site-content] ${where}: vídeo propio sin imagen de espera; se usa la de portada del sitio`);
    const posterImage = listImage(row, 'poster', `${where}.poster`, '', defaultPoster);
    const client = typeof row.client === 'string' ? row.client.trim() : '';
    const year = toNumber(row.year);
    const link = typeof row.link === 'string' && /^\/[A-Za-z0-9/_-]*$/.test(row.link.trim()) ? row.link.trim() : undefined;
    return [{
      key: media?.key ?? String(row._id), title: String(row.name), context: String(row.context), description: String(row.description),
      videoSrc: own ? `${MEDIA_ROUTE}${own}` : media!.videoSrc, ...(main && vertical ? { mobileVideoSrc: `${MEDIA_ROUTE}${vertical}` } : {}),
      poster: posterImage.src, posterImage, width, height,
      portfolioCategories: projectCategories.includes(String(row.category)) ? [String(row.category)] : media?.portfolioCategories ?? [],
      homeKind: layout[0], homeSize: layout[1], client,
      ...(Number.isInteger(year) && year >= 1990 && year <= 2100 ? { year } : {}), ...(link ? { link } : {}),
      ...(own && row._published ? { uploadedAt: String(row._published) } : {}),
    }];
  });
}

/** Datos de VideoObject de Inicio: solo los vídeos propios publicados (portada y trabajos recientes); los del sitio no llevan marcado. */
export async function homeVideoMeta(): Promise<VideoMeta[]> {
  const [hero, copy, photo, projects] = await Promise.all([pageVideo('page_home', 'hero_video', 'hero_video_movil'), pageCopy('Home'), pageImages('page_home'), getProjects('home')]);
  return [
    ...(hero.origin === 'upload' ? [{ name: 'Directo Producciones: vídeo de portada', description: copy.hero_entradilla, contentUrl: hero.src, thumbnailUrl: photo.hero_poster.src, uploadDate: hero.uploadedAt }] : []),
    ...projects.filter(project => project.uploadedAt).map(project => ({ name: project.title, description: project.description, contentUrl: project.videoSrc, thumbnailUrl: project.poster, uploadDate: project.uploadedAt })),
  ];
}

export interface TeamMember { id: string; name: string; role: string; bio: string; photo: ResolvedImage | null; pending: boolean; sort: number; email: string; emailFact?: string }
/** Equipo para «about» (orden y nombre de Quiénes somos) o «home» (solo los marcados, orden y nombre de Inicio). */
export async function getTeam(context: 'about' | 'home'): Promise<TeamMember[]> {
  const rows = (await published('team', 100)).filter(shown).filter(row => context === 'about' || row.show_home === true || row.show_home === 1);
  return rows.sort(bySort(context === 'home' ? 'home_sort' : 'sort')).map(row => {
    const home = context === 'home';
    const name = String((home && row.name_home) || row.name);
    const hasPhoto = row.photo_state !== 'pendiente' && Boolean(row.photo_ref || row.photo);
    // En Inicio el texto alternativo de la foto puede ser propio (photo_alt_home); si no, el de la ficha.
    const view = home && row.photo_alt_home ? { ...row, photo_alt: row.photo_alt_home } : row;
    // Correo bajo el perfil: el de la ficha si está escrito y es válido; si no, el hecho aprobado de ESA ficha (por id, no por nombre).
    const typed = typeof row.email === 'string' ? row.email.trim() : '';
    const factId = teamEmailFacts[String(row._id)];
    const fact = !typed && factId ? approvedFact(factId) : undefined;
    const email = new RegExp(EMAIL_PATTERN).test(typed) ? typed : fact?.value ?? '';
    return { id: String(row._id), email, ...(fact ? { emailFact: fact.id } : {}), name, role: String(row.role), bio: String(row.bio ?? ''), pending: !hasPhoto, sort: Number(row.sort),
      photo: hasPhoto ? resolveImage(view, names('photo'), { ref: String(row.photo_ref ?? ''), alt: String(row.photo_alt || name) }, { local, where: `team.${row._id}` }) : null };
  });
}

/** Colecciones con contrato; el guard y el panel las usan. */
export const contractSlugs = [...collections.map(c => c.slug), ...lists.map(l => l.slug)];

/** Etiquetas del menú editables; estructura, orden y rutas siguen en site-navigation.ts. */
export async function getNavigation(): Promise<SiteLink[]> {
  const copy = await pageCopy('Nav');
  return navigationItems.map(item => ({ ...item, label: copy[`nav_${item.key.replace('-', '_')}`] || item.label }));
}

/** Título y descripción SEO de una página, de la ficha SEO nativa de EmDash; vacío si no se ha rellenado. */
export async function pageSeo(collection: string): Promise<{ title?: string; description?: string }> {
  // getEmDashCollection no hidrata la ficha SEO; la lectura por entrada sí (y respeta publicado/borrador).
  const key = `seo:${collection}`, hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return (hit.row[0] ?? {}) as { title?: string; description?: string };
  let seo: { title?: string | null; description?: string | null } | undefined;
  try { seo = (await getEmDashEntry(collection, SINGLETON_SLUG)).entry?.data?.seo as typeof seo; } catch { /* sin ficha: valores del código */ }
  const out = { title: seo?.title?.trim() || undefined, description: seo?.description?.trim() || undefined };
  cache.set(key, { at: Date.now(), row: [out] });
  return out;
}
