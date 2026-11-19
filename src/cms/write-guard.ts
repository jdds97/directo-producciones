// Guardas del panel que necesitan el usuario autenticado o la base de datos (corre tras el middleware de auth de EmDash).
// EmDash 1.1.0 no ofrece hooks para slugs ni términos: content:beforeSave solo recibe `data` (sin slug) y no hay hooks de taxonomía.
// Las reglas son funciones puras de src/lib/editorial-policy.ts (probadas en tests/editorial-policy.test.ts).
import type { APIContext } from 'astro';
import { managedCollections, slugChangeDenied, termWriteDenied } from '../lib/editorial-policy.ts';

const CONTENT = /^\/_emdash\/api\/content\/([a-z][a-z0-9_]*)(?:\/([^/]+))?\/?$/;
const TERM = /^\/_emdash\/api\/taxonomies\/(category|tag)\/terms(?:\/([^/]+))?\/?$/;
const deny = (status: number, message: string) =>
  new Response(JSON.stringify({ success: false, error: { code: 'EDITORIAL_GUARD', message } }), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function cmsWriteGuard(context: APIContext): Promise<Response | null> {
  const { request, url } = context;
  if (request.method === 'GET' || request.method === 'HEAD') return null;
  const content = (request.method === 'PUT' || request.method === 'POST') ? CONTENT.exec(url.pathname) : null;
  const term = TERM.exec(url.pathname);
  if (!(content && managedCollections.has(content[1])) && !term) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = (context.locals as { emdash?: { db?: any } }).emdash?.db;
  if (!db) return deny(503, 'No se puede comprobar el cambio; inténtalo de nuevo.');

  if (content) {
    const body = await request.clone().json().catch(() => null) as { slug?: unknown } | null;
    if (!body || body.slug === undefined) return null;
    const [, collection, id] = content;
    let current: { slug: string | null; published: boolean } | null = null;
    if (id) {
      const row = await db.selectFrom(`ec_${collection}`).select(['slug', 'status']).where((eb: any) => eb.or([eb('id', '=', id), eb('slug', '=', id)])).where('deleted_at', 'is', null).executeTakeFirst();
      if (!row) return null; // EmDash responde 404
      current = { slug: row.slug, published: row.status === 'published' || row.status === 'scheduled' };
    }
    const denied = slugChangeDenied(collection, current, body.slug);
    return denied ? deny(422, denied) : null;
  }

  const [, taxonomy, rawSlug] = term!;
  const termSlug = rawSlug ? decodeURIComponent(rawSlug) : undefined;
  const body = request.method === 'PUT' ? await request.clone().json().catch(() => null) as { slug?: unknown } | null : null;
  let inUse = false;
  if (termSlug && (request.method === 'DELETE' || (typeof body?.slug === 'string' && body.slug !== termSlug))) {
    const row = await db.selectFrom('content_taxonomies as ct').innerJoin('taxonomies as t', 't.translation_group', 'ct.taxonomy_id')
      .select((eb: any) => eb.fn.countAll().as('n')).where('t.name', '=', taxonomy).where('t.slug', '=', termSlug).executeTakeFirst();
    inUse = Number(row?.n ?? 0) > 0;
  }
  const role = (context.locals as { user?: { role?: number } }).user?.role ?? 0;
  const denied = termWriteDenied({ method: request.method, taxonomy, termSlug, bodySlug: body?.slug, role, inUse });
  return denied ? deny(inUse && !(taxonomy === 'category' && role < 50) ? 409 : 403, denied) : null;
}
