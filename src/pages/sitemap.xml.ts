import type { APIRoute } from 'astro';
import { APP_ENV } from '../config/flags';
import { getBlogPage } from '../lib/blog-feed';
import { blogPostHref, blogPublishedAt, blogUpdatedAt } from '../lib/blog';
import { sitemapXml, staticSitemapPaths, type SitemapEntry } from '../lib/seo';
export const prerender = false;

// Dinámico: páginas corporativas + entradas publicadas. Categorías y etiquetas son filtros internos de /blog/ (sus archivos
// históricos siguen existiendo con noindex) y no entran en el sitemap.
// `lastmod` solo cuando hay fecha real (publicación/modificación de la entrada); las páginas corporativas no lo llevan.
export const GET: APIRoute = async ({ url }) => {
  if (APP_ENV === 'preview') return new Response('No encontrado', { status: 404 });
  const entries: SitemapEntry[] = staticSitemapPaths();
  let cursor: string | undefined;
  do {
    const page = await getBlogPage(cursor, undefined, undefined, 100);
    for (const post of page.entries) {
      const lastmod = blogUpdatedAt(post) ?? blogPublishedAt(post);
      entries.push({ path: blogPostHref(post.id), lastmod });
    }
    cursor = page.nextCursor;
  } while (cursor);
  return new Response(sitemapXml(APP_ENV, url.origin, entries), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  });
};
