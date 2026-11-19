// Contrato de migración WordPress → EmDash (blog). SOLO contrato y validación: no lee WXR, ni medios, ni datos personales.
// Quien ejecute la migración real deberá alimentar `mapWpPost` con registros ya extraídos por un importador autorizado.
// Reglas: todo entra como BORRADOR; nada se publica sin pasar por la política editorial (clase B: es contenido real);
// no se importan comentarios, emails ni logins de autores (PII); los medios exigen alt y origen.

export type WpPost = {
  id: number; slug: string; title: string; excerpt?: string; contentHtml: string; date: string; status: string;
  categories: string[]; tags: string[]; authorDisplayName?: string; featuredImage?: { url: string; alt?: string };
  /** Enlace permanente original (URL completa o ruta): las entradas reales llevan fecha, /AAAA/MM/DD/slug/. */
  link?: string;
};
export type MappedPost = {
  collection: 'posts'; slug: string; status: 'draft';
  data: { title: string; excerpt: string; content_html: string; author: string; image_alt: string };
  taxonomies: { category: string[]; tag: string[] };
  byline: string | null; featuredImageSource: string | null;
  redirect: { from: string; to: string };
  issues: string[];
};
export const WP_FIELD_MAP = {
  post_title: 'data.title', post_excerpt: 'data.excerpt', post_content: 'data.content (HTML → Portable Text por el importador de EmDash)',
  post_name: 'slug', post_date: 'publishedAt (solo informativo; el estado inicial es draft)', category: 'taxonomía category', post_tag: 'taxonomía tag',
  author_display_name: 'byline (nunca usuario)', _thumbnail_id: 'featured_image + image_alt', comments: 'NO se importan', author_email: 'NO se importa', author_login: 'NO se importa',
} as const;

const slugify = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
/** Ruta original de una entrada de WordPress con fecha; null si el enlace no la tiene. */
export function originalPath(link?: string): string | null {
  const m = /\/(\d{4})\/(\d{2})\/(\d{2})\/([^/?#]+)\/?(?:[?#].*)?$/.exec(link ?? '');
  return m ? `/${m[1]}/${m[2]}/${m[3]}/${m[4]}/` : null;
}
export function mapWpPost(p: WpPost): MappedPost {
  const issues: string[] = [];
  const slug = slugify(p.slug || p.title);
  if (!slug) issues.push('Sin slug utilizable.');
  if (!p.title?.trim()) issues.push('Sin título.');
  if (p.featuredImage && !p.featuredImage.alt?.trim()) issues.push('Imagen destacada sin texto alternativo: añadirlo antes de publicar.');
  if (/@[\w.-]+\.\w{2,}/.test(`${p.contentHtml} ${p.authorDisplayName ?? ''}`)) issues.push('Posible dato personal (correo) en el contenido: revisar antes de publicar.');
  if (/\[(?:gallery|caption|embed|contact-form)[^\]]*\]/i.test(p.contentHtml)) issues.push('Shortcode de WordPress sin equivalente: revisar a mano.');
  const from = originalPath(p.link);
  if (p.status !== 'publish') issues.push(`Estado origen «${p.status}»: se importa como borrador y no se incluye en redirecciones.`);
  if (!from) issues.push('Sin ruta original con fecha (/AAAA/MM/DD/slug/): la redirección usa /slug/ y no casará; revisar.');
  return {
    collection: 'posts', slug, status: 'draft',
    data: { title: p.title?.trim() ?? '', excerpt: (p.excerpt ?? '').trim(), content_html: p.contentHtml, author: '', image_alt: p.featuredImage?.alt?.trim() ?? '' },
    taxonomies: { category: [...new Set(p.categories.map(slugify).filter(Boolean))], tag: [...new Set(p.tags.map(slugify).filter(Boolean))] },
    byline: p.authorDisplayName?.trim() || null, featuredImageSource: p.featuredImage?.url ?? null,
    redirect: { from: from ?? `/${slug}/`, to: `/blog/${slug}/` }, issues,
  };
}
/** Los mapeados que pueden pasar a revisión editorial: sin incidencias bloqueantes. */
export const readyForReview = (m: MappedPost) => m.issues.every(i => i.startsWith('Estado origen'));
