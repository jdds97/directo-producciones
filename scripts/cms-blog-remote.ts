// Carga versionada e idempotente de las entradas del blog (content/blog/*.md) y su foto destacada en la D1 y el R2 (binding MEDIA).
//   npx tsx scripts/cms-blog-remote.ts --env production --confirm-d1 <database_id de DB en env.production de wrangler.jsonc> [--retirar-antiguas] [--dry-run]
//   npx tsx scripts/cms-blog-remote.ts --env preview --confirm-d1 <id> [--publish [--review]] [--retirar-antiguas] [--dry-run]
//   npx tsx scripts/cms-blog-remote.ts --env local --confirm-d1 <id local> --persist-to .wrangler/<copia> [--publish [--review]] [--retirar-antiguas] [--dir <carpeta>]
// Fuente: content/blog/<slug>.md (--dir <carpeta> solo para ensayos). Frontmatter YAML: title, slug, seo_title (≤60), excerpt (≤155; también es la
// meta description), category, tags, featured_image (clave de src/lib/media-registry.ts) e image_alt; cuerpo en Markdown → HTML (marked) → Portable Text.
// Reglas:
//  - Valida TODO antes de tocar nada (también en --dry-run) y muestra para cada entrada lo que decidiría evaluatePublish (la política del panel).
//  - Las entradas se crean en BORRADOR con onConflict «skip»: un slug que ya existe (también en la papelera) no se toca nunca.
//  - --publish (solo local o preview) publica las que permite evaluatePublish; --review (con --publish) publica también las retenidas solo por
//    lo que el cliente confirma al revisar (clientConfirmsReason, la misma regla que cms-seed-remote). Solo afecta a las entradas que se crean
//    en esa pasada. En producción no hay --publish: se publica desde el panel (content:beforePublish).
//  - Foto destacada: el fichero de public/ de mayor resolución de esa clave → R2 (clave <ulid><ext>, como el panel) + fila en `media`; un sha256
//    ya presente se reutiliza (si su objeto faltara en R2 se vuelve a subir). La ficha SEO (título y descripción) va a _emdash_seo.
//  - --retirar-antiguas: papelera (borrado suave del panel: handleContentDelete) de las entradas de WordPress listadas en config/url-map.json
//    (filas tipo «entrada», slug = último tramo de la ruta). Idempotente, nunca toca otras entradas ni medios; se restauran desde el panel.
//    Es de UNA vez: repetirlo vuelve a mandar a la papelera las que se hayan restaurado (para cargar más entradas, sin esta opción).
//  - Segunda pasada: 0 entradas, 0 medios, 0 fichas SEO y 0 a la papelera.
// --dry-run no se conecta a nada (qué existe ya solo se sabe al ejecutar de verdad). Solo lee IDs de wrangler.jsonc (no secretos); la
// autenticación remota es la de wrangler, que este script nunca lee ni imprime. Nadie debe escribir en el panel mientras corre.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { Kysely, sql } from 'kysely';
import { D1Dialect } from 'kysely-d1';
import { getPlatformProxy, unstable_readConfig } from 'wrangler';
import sharp from 'sharp';
import { marked } from 'marked';
import { parse as parseYaml } from 'yaml';
import { applySeed } from 'emdash/seed';
import { MediaRepository, computeContentHash, generatePlaceholder, handleContentDelete, ulid } from 'emdash';
import { htmlToPortableText } from '@emdash-cms/gutenberg-to-portable-text';
import { evaluatePublish, emptyRequiredFields, clientConfirmsReason, internalLinks, knownRoutes, MEDIA_LIMITS, POST_SLUG, ROLE } from '../src/lib/editorial-policy.ts';
import { mediaRegistry } from '../src/lib/media-registry.ts';

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 1 ? process.argv[i + 1] : undefined; };
const fail = (message: string): never => { console.error(message); process.exit(2); };
const env = arg('--env') ?? '';
const local = env === 'local';
const dryRun = process.argv.includes('--dry-run');
const publish = process.argv.includes('--publish');
const review = process.argv.includes('--review');
const retire = process.argv.includes('--retirar-antiguas');
const persist = arg('--persist-to');
if (!['local', 'preview', 'production'].includes(env)) fail('Uso: --env preview|production|local --confirm-d1 <database_id> [--dir <carpeta>] [--publish [--review]] [--retirar-antiguas] [--dry-run] [--persist-to .wrangler/<copia> (solo local)]');
if (publish && env === 'production') fail('--publish no se admite en producción: allí solo se publica desde el panel (content:beforePublish).');
if (review && !publish) fail('--review solo se admite con --publish.');
if (local ? !persist || !/^\.wrangler\/[\w.-]+$/.test(persist) || /blog-muestra-editorial|m4-astro-review/.test(persist) : persist) {
  fail('--persist-to .wrangler/<copia> es obligatorio con --env local (ni la muestra editorial ni la revisión) y no se admite en remoto.');
}
const DIR = resolve(arg('--dir') ?? 'content/blog');

// Destino: DB y MEDIA del entorno en wrangler.jsonc; el database_id se confirma a mano (no se imprime, para que no sea copiar y pegar).
const cfg = unstable_readConfig({ config: 'wrangler.jsonc', env: local ? undefined : env }, { hideWarnings: true });
const d1 = (cfg.d1_databases ?? []).find((d: { binding: string }) => d.binding === 'DB') as { database_id?: string; database_name?: string } | undefined;
const r2 = (cfg.r2_buckets ?? []).find((b: { binding: string }) => b.binding === 'MEDIA') as { bucket_name?: string; jurisdiction?: string } | undefined;
if (!d1?.database_id || !d1.database_name) fail(`wrangler.jsonc (${env}): falta el binding DB.`);
if (!r2?.bucket_name) fail(`wrangler.jsonc (${env}): falta el binding R2 MEDIA.`);
if (arg('--confirm-d1') !== d1!.database_id) fail(`Destino sin confirmar: --confirm-d1 debe ser el database_id de DB («${d1!.database_name}», env ${env}) en wrangler.jsonc.`);

const MEDIA_ROUTE = '/_emdash/api/media/file/';
const AUTHOR = 'Directo Producciones'; // firma colectiva, no es un usuario del panel
const TYPE: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const EXT: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const base = JSON.parse(readFileSync('seed/seed.json', 'utf8'));
const terms = (name: string): Set<string> => new Set(base.taxonomies.find((t: { name: string }) => t.name === name).terms.map((t: { slug: string }) => t.slug));
const categories = terms('category'), tags = terms('tag');

// ---------- Lectura y validación (sin tocar nada) ----------
type Post = { file: string; slug: string; title: string; seoTitle: string; excerpt: string; category: string; tags: string[]; imageKey: string; imagePath: string; alt: string; content: unknown[] };
const errors: string[] = [];
const files = existsSync(DIR) ? readdirSync(DIR).filter(f => f.endsWith('.md')).sort() : [];
if (!files.length) fail(`No hay ficheros .md en ${DIR}.`);
const largest = (key: string) => { // la variante de mayor anchura del srcset, o src
  const e = mediaRegistry[key];
  const best = (e.srcset ?? '').split(',').map(s => s.trim().split(/\s+/)).filter(p => p[1]).sort((a, b) => parseInt(b[1]) - parseInt(a[1]))[0]?.[0];
  return resolve('public', (best ?? e.src).replace(/^\//, ''));
};
const posts: Post[] = [];
for (const file of files) {
  const raw = readFileSync(`${DIR}/${file}`, 'utf8').replace(/^﻿/, '');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  const err = (msg: string) => errors.push(`${file}: ${msg}`);
  if (!m) { err('falta el frontmatter (--- … ---).'); continue; }
  let fm: Record<string, unknown>;
  try { fm = parseYaml(m[1]) ?? {}; } catch (e) { err(`frontmatter YAML no válido (${(e as Error).message.split('\n')[0]}).`); continue; }
  const str = (k: string) => (typeof fm[k] === 'string' ? (fm[k] as string).trim() : '');
  for (const k of ['title', 'slug', 'seo_title', 'excerpt', 'category', 'featured_image', 'image_alt']) if (!str(k)) err(`falta ${k}.`);
  const slug = str('slug');
  if (slug && !POST_SLUG.test(slug)) err('slug no válido (a-z, 0-9 y guiones).');
  if (slug && file !== `${slug}.md`) err(`el fichero debe llamarse ${slug}.md.`);
  if (str('seo_title').length > 60) err(`seo_title de ${str('seo_title').length} caracteres (máx. 60).`);
  if (str('excerpt').length > 155) err(`excerpt de ${str('excerpt').length} caracteres (máx. 155).`);
  if (str('category') && !categories.has(str('category'))) err(`category «${str('category')}» no existe en seed/seed.json.`);
  const tg = fm.tags;
  if (!Array.isArray(tg) || !tg.length) err('tags debe ser una lista no vacía.');
  else for (const t of tg) if (!tags.has(String(t))) err(`tag «${t}» no existe en seed/seed.json.`);
  const key = str('featured_image');
  let imagePath = '';
  if (key && !mediaRegistry[key]) err(`featured_image «${key}» no está en src/lib/media-registry.ts.`);
  else if (key) {
    imagePath = largest(key);
    if (!existsSync(imagePath)) err(`falta el fichero ${imagePath}.`);
    else if (!TYPE[extname(imagePath).toLowerCase()]) err(`tipo de imagen no admitido (${extname(imagePath)}).`);
  }
  if (!m[2].trim()) err('cuerpo vacío.');
  const content = htmlToPortableText(marked.parse(m[2], { async: false }) as string) as unknown as { _type: string; children?: { text?: string }[] }[];
  posts.push({ file, slug, title: str('title'), seoTitle: str('seo_title'), excerpt: str('excerpt'), category: str('category'), tags: Array.isArray(tg) ? tg.map(String) : [], imageKey: key, imagePath, alt: str('image_alt'), content });
}
// Slugs únicos y sin chocar con las entradas antiguas que se retiran (una nueva con ese slug se saltaría o se retiraría).
const oldSlugs: string[] = JSON.parse(readFileSync('config/url-map.json', 'utf8')).rows.filter((r: { tipo: string }) => r.tipo === 'entrada')
  .map((r: { path: string }) => r.path.replace(/\/+$/, '').split('/').pop()!);
const seen = new Set<string>();
for (const p of posts) {
  if (seen.has(p.slug)) errors.push(`${p.file}: slug duplicado «${p.slug}».`);
  seen.add(p.slug);
  if (oldSlugs.includes(p.slug)) errors.push(`${p.file}: el slug «${p.slug}» es el de una entrada antigua de WordPress.`);
}
// Enlaces internos: como el panel al publicar («Enlace interno roto»), contra rutas conocidas, este lote y los términos de la semilla.
for (const p of posts) for (const l of internalLinks(p.content)) {
  const ok = l.kind === 'route' ? knownRoutes.has(l.slug) : l.kind === 'post' ? seen.has(l.slug) : (l.kind === 'category' ? categories : tags).has(l.slug);
  if (!ok) errors.push(`${p.file}: enlace interno roto ${l.href}`);
}
if (errors.length) fail(`Validación fallida (nada escrito):\n  ${errors.join('\n  ')}`);

type Media = { id: string; storageKey: string; width?: number; height?: number; mimeType: string; filename: string; blurhash?: string; dominantColor?: string };
const buildEntry = (p: Post, m: Media) => ({
  id: ulid(), slug: p.slug, status: 'draft' as 'draft' | 'published',
  data: {
    title: p.title, excerpt: p.excerpt, author: AUTHOR, content: p.content, synthetic: false, featured: false, image_alt: p.alt,
    featured_image: { id: m.id, provider: 'local', alt: p.alt, width: m.width, height: m.height, filename: m.filename, mimeType: m.mimeType, ...(m.blurhash ? { blurhash: m.blurhash } : {}), ...(m.dominantColor ? { dominantColor: m.dominantColor } : {}), meta: { storageKey: m.storageKey } },
  },
  taxonomies: { category: [p.category], tag: p.tags },
});
// Decisión de la política del panel por entrada (como cms-seed-remote). Sin aprobador: lo que exige uno queda retenido (y --review lo suelta).
const editor = { id: 'cms-blog-remote', role: ROLE.editor };
const decide = (p: Post, data: Record<string, unknown>) => {
  const d = evaluatePublish({ collection: 'posts', data, actor: editor, approverIds: new Set(), local: false });
  const empty = emptyRequiredFields('posts', data);
  if (empty.length) { d.allow = false; d.reasons.push(`Campos obligatorios vacíos: ${empty.join(', ')}.`); }
  const byReview = !d.allow && review && d.reasons.every(r => clientConfirmsReason.test(r));
  return { ...d, go: d.allow || byReview, byReview };
};
const verdict = (p: Post, d: ReturnType<typeof decide>) => `  ${p.slug} [${p.category}] → ${d.allow ? 'publicable' : d.byReview ? 'publicable solo con --review' : 'retenida'}${d.reasons.length ? `: ${d.reasons.join(' ')}` : ''}${d.claims.length ? ` · afirmaciones: ${d.claims.join(', ')}` : ''}`;

console.log(`destino: ${env} · D1 ${d1!.database_name} · R2 ${r2!.bucket_name}${r2!.jurisdiction ? ` (${r2!.jurisdiction})` : ''}${local ? ` (local, ${persist})` : ' (remoto)'}`);
console.log(`origen: ${posts.length} entradas en ${DIR}; validación correcta.`);
const sim: Media = { id: 'dry', storageKey: 'dry.jpg', mimeType: 'image/jpeg', filename: 'dry.jpg' };
console.log(`evaluatePublish (editor sin aprobador, fuera de local):\n${posts.map(p => verdict(p, decide(p, buildEntry(p, sim).data))).join('\n')}`);
if (dryRun) {
  const bytes = new Set(posts.map(p => p.imagePath)).size;
  console.log(`plan: ${posts.length} entradas en ${publish ? 'borrador o publicadas según la política' : 'borrador'} (skip si el slug existe), ${bytes} foto(s) destacada(s) distinta(s) a R2.`);
  if (retire) console.log(`a la papelera (si existen y no están ya en ella): ${oldSlugs.length}\n  ${oldSlugs.join('\n  ')}`);
  console.log('--dry-run: sin conexión; nada escrito.');
  process.exit(0);
}

// Config mínima generada (solo DB y MEDIA, `remote` en preview/producción) en .wrangler/tmp, ignorado: wrangler.jsonc no lleva bindings remotos.
const configPath = '.wrangler/tmp/cms-blog-remote.json';
mkdirSync('.wrangler/tmp', { recursive: true });
writeFileSync(configPath, JSON.stringify({ name: 'cms-blog-remote', compatibility_date: cfg.compatibility_date, compatibility_flags: ['nodejs_compat'],
  d1_databases: [{ binding: 'DB', database_name: d1!.database_name, database_id: d1!.database_id, remote: !local }],
  r2_buckets: [{ binding: 'MEDIA', bucket_name: r2!.bucket_name, ...(r2!.jurisdiction ? { jurisdiction: r2!.jurisdiction } : {}), remote: !local }] }));
const proxy = await getPlatformProxy<{ DB: ConstructorParameters<typeof D1Dialect>[0]['database']; MEDIA: { put(...a: any[]): Promise<unknown>; head(k: string): Promise<unknown>; delete(k: string): Promise<unknown> } }>({ configPath, persist: local ? { path: `${persist}/v3` } : false, remoteBindings: !local });
const db = new Kysely<any>({ dialect: new D1Dialect({ database: proxy.env.DB }) });
const bucket = proxy.env.MEDIA;
try {
  if (!(await sql`select count(*) as n from _emdash_collections where slug = 'posts'`.execute(db).then(r => (r.rows[0] as { n: number }).n).catch(() => 0))) {
    throw new Error('Falta la colección posts: aplica antes las migraciones (scripts/emdash-migrate-ci.mjs <env>) y scripts/cms-seed-remote.ts.');
  }
  // Slugs que ya existen (incluida la papelera): no se tocan ni se les suben medios.
  const existing = new Set((await sql<{ slug: string }>`select slug from ec_posts`.execute(db)).rows.map(r => r.slug));
  const pending = posts.filter(p => !existing.has(p.slug));
  console.log(`entradas: ${posts.length} en el origen, ${posts.length - pending.length} ya existen (se saltan), ${pending.length} por crear`);

  // 1. Fotos destacadas de las entradas por crear: R2 + fila en `media` (dedupe por hash; objeto huérfano borrado si falla la fila).
  const n = { nuevos: 0, reutilizados: 0, resubidos: 0 };
  const repo = new MediaRepository(db);
  const byPath = new Map<string, Media>();
  const upload = async (p: Post): Promise<Media> => {
    const done = byPath.get(p.imagePath);
    if (done) return done;
    const bytes = new Uint8Array(readFileSync(p.imagePath));
    if (bytes.byteLength > MEDIA_LIMITS.maxBytes) throw new Error(`${p.imageKey}: supera 10 MB`);
    const mime = TYPE[extname(p.imagePath).toLowerCase()];
    const hash = await computeContentHash(bytes);
    const found = await repo.findByContentHash(hash);
    let media: Media;
    if (found) {
      if (!(await bucket.head(found.storageKey))) { await bucket.put(found.storageKey, bytes, { httpMetadata: { contentType: found.mimeType } }); n.resubidos++; }
      media = { id: found.id, storageKey: found.storageKey, width: found.width ?? undefined, height: found.height ?? undefined, mimeType: found.mimeType, filename: found.filename, blurhash: found.blurhash ?? undefined, dominantColor: found.dominantColor ?? undefined };
      n.reutilizados++;
    } else {
      const meta = await sharp(bytes).metadata();
      const swap = (meta.orientation ?? 1) >= 5; // como el navegador: dimensiones con la orientación EXIF aplicada
      const width = swap ? meta.height : meta.width, height = swap ? meta.width : meta.height;
      const filename = basename(p.imagePath);
      const storageKey = `${ulid()}${EXT[mime]}`;
      const ph = await generatePlaceholder(bytes, mime, meta.width && meta.height ? { width: meta.width, height: meta.height } : undefined);
      await bucket.put(storageKey, bytes, { httpMetadata: { contentType: mime } });
      try {
        const item = await repo.create({ filename, mimeType: mime, size: bytes.byteLength, width, height, alt: p.alt, storageKey, contentHash: hash, blurhash: ph?.blurhash, dominantColor: ph?.dominantColor, status: 'ready' });
        media = { id: item.id, storageKey, width, height, mimeType: mime, filename, blurhash: ph?.blurhash, dominantColor: ph?.dominantColor };
        n.nuevos++;
      } catch (e) { await bucket.delete(storageKey).catch(() => undefined); throw e; }
    }
    byPath.set(p.imagePath, media);
    return media;
  };

  // 2. Entradas nuevas con onConflict «skip» (un slug creado entre medias tampoco se pisa) y su ficha SEO.
  if (pending.length) {
    const held: string[] = [];
    let go = 0;
    const content = [];
    for (const p of pending) {
      const entry = buildEntry(p, await upload(p));
      if (publish) {
        const d = decide(p, entry.data);
        if (d.go) { entry.status = 'published'; go++; held.push(`  ${p.slug}: publicada${d.byReview ? ' para revisión del cliente, sin aprobar' : ''}`); }
        else held.push(`  ${p.slug}: retenida en borrador (${d.reasons.join(' ')})`);
      }
      content.push(entry);
    }
    console.log(`medios: ${JSON.stringify(n)}`);
    const result = await applySeed(db, { version: '1', taxonomies: base.taxonomies, content: { posts: content } } as any, { includeContent: true, onConflict: 'skip' });
    console.log(`hecho: ${JSON.stringify({ content: result.content, taxonomies: result.taxonomies })}`);
    if (publish) console.log(`publicación (${go} publicadas, ${pending.length - go} en borrador):\n${held.join('\n')}`);
  } else console.log(`medios: ${JSON.stringify(n)}`);

  // Ficha SEO (título y descripción) en _emdash_seo, como SeoRepository.upsert, solo si la entrada viva aún no la tiene (no pisa el panel).
  // Recorre todo el origen, no solo lo creado ahora: así una pasada cortada entre la creación y este paso se completa al repetirla.
  const now = new Date().toISOString();
  let seoNew = 0;
  for (const p of posts) {
    const row = (await sql<{ id: string; seo: number }>`select e.id, (select count(*) from _emdash_seo s where s.collection = 'posts' and s.content_id = e.id) as seo
      from ec_posts e where e.slug = ${p.slug} and e.deleted_at is null`.execute(db)).rows[0];
    if (!row || Number(row.seo)) continue;
    await sql`insert into _emdash_seo (collection, content_id, seo_title, seo_description, seo_no_index, created_at, updated_at)
      values ('posts', ${row.id}, ${p.seoTitle}, ${p.excerpt}, 0, ${now}, ${now}) on conflict (collection, content_id) do nothing`.execute(db);
    seoNew++;
  }
  console.log(`fichas SEO nuevas: ${seoNew}`);

  // 3. Papelera de las entradas antiguas (borrado suave del panel); idempotente: las que ya están en ella o no existen no cuentan.
  if (retire) {
    const rows = (await sql<{ id: string; slug: string; deleted_at: string | null }>`select id, slug, deleted_at from ec_posts`.execute(db)).rows.filter(r => oldSlugs.includes(r.slug));
    const live = rows.filter(r => !r.deleted_at);
    for (const r of live) {
      const res = await handleContentDelete(db, 'posts', r.id);
      if (!res.success) throw new Error(`No se pudo mandar a la papelera ${r.slug}: ${res.error.code}`);
    }
    console.log(`papelera: ${live.length} enviadas ahora, ${rows.length - live.length} ya estaban en ella, ${oldSlugs.length - rows.length} no existen (de ${oldSlugs.length} antiguas)`);
  }
  const after = await sql`select status, deleted_at is not null as papelera, count(*) as n from ec_posts group by status, papelera`.execute(db);
  console.log(`ec_posts: ${JSON.stringify(after.rows)} · medios totales: ${JSON.stringify((await sql`select count(*) as n from media`.execute(db)).rows)}`);
} finally {
  await db.destroy();
  await proxy.dispose();
}
