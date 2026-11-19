import type { ImageValue, PortableTextBlock } from 'emdash';
export interface BlogTag { slug: string; label: string }
export interface BlogPost {
  title: string;
  excerpt?: string;
  author?: string;
  publishedAt?: string;
  content: PortableTextBlock[];
  terms?: Record<string, BlogTag[]>;
  featured?: boolean;
  featured_image?: ImageValue | string;
  image_alt?: string;
  synthetic?: boolean;
}
export const blogPostHref = (slug: string) => `/blog/${encodeURIComponent(slug)}/`;
/** Las categorías se filtran dentro de /blog/ (sin navegar a un archivo); la query solo preselecciona el filtro. */
export const blogFilterHref = (slug: string) => `/blog/?categoria=${encodeURIComponent(slug)}`;
export const blogTermHref = (taxonomy: 'tag' | 'category', slug: string) =>
  `/blog/${taxonomy === 'tag' ? 'etiqueta' : 'categoria'}/${encodeURIComponent(slug)}/`;
/** Normalize both fresh Date values and cached strings from EmDash. */
export function blogIsoDate(value: unknown): string | undefined {
  if (!(value instanceof Date) && typeof value !== 'string') return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
// EmDash deja las fechas en la raíz de la entrada o en entry.data (updatedAt solo en data): se mira en los dos sitios.
function entryDate(entry: unknown, key: 'publishedAt' | 'updatedAt'): string | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  const post = entry as Record<string, unknown> & { data?: Record<string, unknown> };
  return blogIsoDate(post[key]) ?? blogIsoDate(post.data?.[key]);
}
export const blogPublishedAt = (entry: unknown) => entryDate(entry, 'publishedAt');
export const blogUpdatedAt = (entry: unknown) => entryDate(entry, 'updatedAt');
export function blogDate(value?: string): string | undefined {
  const iso = blogIsoDate(value);
  if (!iso) return undefined;
  return new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' }).format(new Date(iso));
}

type Block = { _type?: string; _key?: string; style?: string; children?: { text?: string }[] };
/** Plain text of a Portable Text block; non-text blocks give an empty string. */
export const blogBlockText = (block: unknown): string =>
  Array.isArray((block as Block)?.children) ? (block as Block).children!.map(span => span.text ?? '').join('') : '';
/** Stable anchor for a heading: the same function renders the id and builds the outline. */
export const blogHeadingId = (block: unknown): string =>
  blogBlockText(block).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export interface BlogOutlineItem { id: string; text: string; children: { id: string; text: string }[] }
/** h2 sections with their h3 children; ponytail: duplicated heading text would share an id. */
export function blogOutline(content: unknown): BlogOutlineItem[] {
  const outline: BlogOutlineItem[] = [];
  for (const block of Array.isArray(content) ? content : []) {
    const style = (block as Block)?.style;
    if (style !== 'h2' && style !== 'h3') continue;
    const item = { id: blogHeadingId(block), text: blogBlockText(block) };
    if (!item.id) continue;
    if (style === 'h2') outline.push({ ...item, children: [] });
    else outline.at(-1)?.children.push(item);
  }
  return outline;
}
/** Reading time at about two hundred words per minute, never below one minute. */
export function blogReadingMinutes(content: unknown): number {
  const words = (Array.isArray(content) ? content : []).map(blogBlockText).join(' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}
