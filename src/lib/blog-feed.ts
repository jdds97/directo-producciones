import { getEmDashCollection } from 'emdash';
import type { BlogPost } from './blog';

// Run this in route frontmatter, before Base starts streaming the document.
export async function getBlogPage(cursor?: string, taxonomy?: 'category' | 'tag', slug?: string, limit = 20) {
  const result = await getEmDashCollection<'posts', BlogPost>('posts', {
    status: 'published', orderBy: { published_at: 'desc' }, limit,
    ...(cursor ? { cursor } : {}),
    ...(taxonomy && slug ? { where: { [taxonomy]: slug } } : {}),
  });
  if (result.error) throw result.error;
  return result;
}
export type BlogPage = Awaited<ReturnType<typeof getBlogPage>>;

export function isInvalidBlogCursor(error: unknown): boolean {
  // Astro wraps loader errors; keep infrastructure failures distinct.
  let cause = error;
  for (let depth = 0; depth < 5 && cause instanceof Error; depth++) {
    if (cause.name === 'InvalidCursorError' || /Invalid pagination cursor:/.test(cause.message)) return true;
    cause = cause.cause;
  }
  return false;
}

/** /blog/ reúne TODAS las entradas publicadas (los filtros son internos, sin segunda página). La destacada (`featured`) va la primera; el resto, por fecha.
 *  `lead` (la primera: la destacada o, sin ninguna, la más reciente) se muestra en la portada; en «Todas» no se repite en la lista. */
export async function getBlogLanding() {
  const entries: Awaited<ReturnType<typeof getBlogPage>>['entries'] = [];
  let cursor: string | undefined;
  // Tope de seguridad (2.000 entradas): si se alcanzara, habría que volver a paginar con carga progresiva.
  for (let i = 0; i < 20; i++) {
    const page = await getBlogPage(cursor, undefined, undefined, 100);
    entries.push(...page.entries);
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  // Orden estable: las destacadas primero y, dentro de cada grupo, el orden por fecha de la consulta.
  const ordered = [...entries.filter(post => post.data.featured), ...entries.filter(post => !post.data.featured)];
  return { entries: ordered, lead: ordered[0] };
}
export type BlogLandingData = Awaited<ReturnType<typeof getBlogLanding>>;
