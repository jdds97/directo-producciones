import type { APIRoute } from 'astro';
import { APP_ENV } from '../config/flags';
import { getBlogPage } from '../lib/blog-feed';
import { blogPostHref, blogPublishedAt } from '../lib/blog';
import { rssXml, type FeedItem } from '../lib/seo';
export const prerender = false;

// RSS del blog (sustituye al /feed/ de WordPress). Como el sitemap: 404 en preview; las 50 entradas más recientes.
export const GET: APIRoute = async ({ url }) => {
  if (APP_ENV === 'preview') return new Response('No encontrado', { status: 404 });
  const page = await getBlogPage(undefined, undefined, undefined, 50);
  const items: FeedItem[] = page.entries.map(post => ({
    title: post.data.title, path: blogPostHref(post.id), description: post.data.excerpt, pubDate: blogPublishedAt(post),
  }));
  return new Response(rssXml(APP_ENV, url.origin, items), {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  });
};
