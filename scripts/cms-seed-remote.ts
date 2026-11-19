// Siembra versionada de la D1 del CMS en preview o producción: esquema de seed/seed.json + entradas de seed/content-drafts.json.
// Sustituye a los scripts sin versionar .wrangler/preview-remote/{seed,reseed}-preview.ts: NO usarlos (y nunca contra producción).
//   npx tsx scripts/cms-seed-remote.ts --env production --confirm-d1 <database_id de DB en env.production de wrangler.jsonc> [--dry-run]
//   npx tsx scripts/cms-seed-remote.ts --env preview --confirm-d1 <id> [--publish [--review]] [--update-unedited] [--dry-run]
//   npx tsx scripts/cms-seed-remote.ts --env local --confirm-d1 <id local> --persist-to .wrangler/<copia>   (ensayo en una copia local)
// Reglas: las entradas que no existen se crean en BORRADOR con onConflict «skip» (nunca «update»: no pisa lo editado en el panel).
// En producción no hay opción de publicar: se publica desde el panel, por el hook content:beforePublish. --publish (solo preview o
// local) publica únicamente lo que un editor podría publicar desde el panel sin aprobador (evaluatePublish) y con los campos obligatorios
// llenos (emptyRequiredFields); el resto queda en borrador. Esas publicaciones no pasan por el hook: no constan en la auditoría editorial.
// Activa la captura de uso de medios antes de sembrar, como la autosiembra (que este script da por hecha): sin ella, la guarda de borrado
// de medios cuenta 0 usos. Exige que nadie escriba en el panel mientras corre (writersDrained).
// --update-unedited (solo preview o local; con --dry-run lee la D1 sin escribir): pone al día con la fuente las entradas que YA existen
// y nadie ha tocado en el panel. Se salta (nunca pisa) la que tenga una revisión con autor (guardar o restaurar en el panel firma la
// revisión con el usuario; applySeed, los scripts de siembra y este no firman), propietario asignado, estado distinto de publicada o
// borrador, o esté en borrador con revisiones anteriores (retirada del sitio: despublicar guarda una revisión sin autor y deja las
// previas). No se usa updated_at: la siembra y publicar también lo mueven. Límite: no ve escrituras que no dejen revisión (SQL directo,
// `wrangler d1 execute`) ni cambios de la ficha SEO, que no se toca; un borrador descartado en el panel cuenta como edición (se salta).
// Escribe como el panel: revisión sin autor como borrador pendiente (lo publicado no cambia) y, con --publish y la misma política que
// arriba, publish() la promueve a las columnas que lee la web; si no, queda pendiente de publicar desde el panel con su aprobación.
// Compara con el borrador pendiente o, sin él, con lo publicado: una segunda pasada no cambia nada.
// Requiere las migraciones de EmDash aplicadas (deploy.yml → scripts/emdash-migrate-ci.mjs). Solo lee IDs de wrangler.jsonc, que no
// son secretos; la autenticación remota es la de wrangler (CLOUDFLARE_API_TOKEN o login), que este script nunca lee ni imprime.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Kysely, sql } from 'kysely';
import { D1Dialect } from 'kysely-d1';
import { getPlatformProxy, unstable_readConfig } from 'wrangler';
import { applySeed } from 'emdash/seed';
import { handleMediaUsageActivationAdvance, ContentRepository, RevisionRepository } from 'emdash';
import { evaluatePublish, emptyRequiredFields, clientConfirmsReason, ROLE } from '../src/lib/editorial-policy.ts';

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 1 ? process.argv[i + 1] : undefined; };
const fail = (message: string): never => { console.error(message); process.exit(2); };
const env = arg('--env') ?? '';
const local = env === 'local';
const publish = process.argv.includes('--publish');
const dryRun = process.argv.includes('--dry-run');
const updateUnedited = process.argv.includes('--update-unedited');
// --review (solo preview y con --publish; decisión del propietario del 2026-11-05): la preview es la copia que revisa el cliente, así que
// publica también lo que la política retiene SOLO por lo que el cliente confirma al revisar (aprobación de un administrador registrado y
// confirmación de derechos). Los demás motivos (marcadores, avisos legales, hechos sin aprobar, datos tecleados, medios, campos vacíos)
// siguen bloqueando. No es una aprobación: producción sigue publicándose solo desde el panel con su aprobador.
const review = process.argv.includes('--review');
const persist = arg('--persist-to');
if (review && (env !== 'preview' || !publish)) fail('--review solo se admite con --env preview y --publish.');
if (!['local', 'preview', 'production'].includes(env)) fail('Uso: --env preview|production|local --confirm-d1 <database_id> [--dry-run] [--publish y --update-unedited (no en producción)] [--persist-to .wrangler/<copia> (solo local)]');
if (publish && env === 'production') fail('--publish no se admite en producción: allí solo se publica desde el panel (content:beforePublish).');
if (updateUnedited && env === 'production') fail('--update-unedited no se admite en producción: allí el contenido existente solo cambia desde el panel.');
if (local ? !persist || !/^\.wrangler\/[\w.-]+$/.test(persist) || /blog-muestra-editorial|m4-astro-review/.test(persist) : persist) {
  fail('--persist-to .wrangler/<copia> es obligatorio con --env local (ni la muestra editorial ni la revisión) y no se admite en remoto.');
}

// Destino: el DB del entorno en wrangler.jsonc, confirmado a mano (no se imprime el id para que la confirmación no sea copiar y pegar).
const cfg = unstable_readConfig({ config: 'wrangler.jsonc', env: local ? undefined : env }, { hideWarnings: true });
const d1 = (cfg.d1_databases ?? []).find((d: { binding: string }) => d.binding === 'DB') as { database_id?: string; database_name?: string } | undefined;
if (!d1?.database_id || !d1.database_name) fail(`wrangler.jsonc (${env}): falta el binding DB.`);
if (arg('--confirm-d1') !== d1!.database_id) fail(`Destino sin confirmar: --confirm-d1 debe ser el database_id de DB («${d1!.database_name}», env ${env}) en wrangler.jsonc.`);

const base = JSON.parse(readFileSync('seed/seed.json', 'utf8'));
const drafts = JSON.parse(readFileSync('seed/content-drafts.json', 'utf8')) as { content: Record<string, { id: string; slug: string; data: Record<string, unknown> }[]> };
const editor = { id: 'cms-seed-remote', role: ROLE.editor };
const held: string[] = [];
let published = 0;
const content = Object.fromEntries(Object.entries(drafts.content).map(([collection, entries]) => [collection, entries.map(entry => {
  if (!publish) return { ...entry, status: 'draft' as const };
  const decision = evaluatePublish({ collection, data: entry.data, actor: editor, approverIds: new Set(), local: false });
  const empty = emptyRequiredFields(collection, entry.data);
  if (empty.length) { decision.allow = false; decision.reasons.push(`Campos obligatorios vacíos: ${empty.join(', ')}.`); }
  if (!decision.allow && review && decision.reasons.every(r => clientConfirmsReason.test(r))) {
    published++; held.push(`  ${collection}/${entry.slug}: publicada para revisión del cliente, sin aprobar (${decision.reasons.join(' ')})`);
    return { ...entry, status: 'published' as const };
  }
  if (decision.allow) { published++; return { ...entry, status: 'published' as const }; }
  held.push(`  ${collection}/${entry.slug}: ${decision.reasons.join(' ')}`);
  return { ...entry, status: 'draft' as const };
})]));
const total = Object.values(content).reduce((n, list) => n + list.length, 0);
console.log(`destino: ${env} · D1 ${d1!.database_name}${local ? ` (local, ${persist})` : ' (remoto)'}`);
console.log(`plan: esquema de ${base.collections.length} colecciones y ${base.taxonomies?.length ?? 0} taxonomías; ${total} entradas nuevas (skip si existen): ${published} publicadas, ${total - published} en borrador`);
if (held.length) console.log(`retenidas por la política editorial${review ? ' (--review: las marcadas se publican igualmente en preview)' : ''}:\n${held.join('\n')}`);
if (dryRun && !updateUnedited) { console.log('--dry-run: sin conexión; nada escrito.'); process.exit(0); }

// --update-unedited (ver cabecera). Solo imprime colección/slug y nombres de campo: ni ids ni valores.
const same = (a: unknown, b: unknown) => {
  const norm = (v: unknown) => v == null ? null : typeof v === 'boolean' ? Number(v) : typeof v === 'object' ? JSON.stringify(v) : v;
  return norm(a) === norm(b);
};
async function updateUneditedEntries(db: Kysely<any>) {
  const repo = new ContentRepository(db), revisions = new RevisionRepository(db);
  const n = { changed: 0, published: 0, skipped: 0 };
  for (const [collection, entries] of Object.entries(content)) for (const entry of entries) {
    const name = `${collection}/${entry.slug}`;
    const item = await repo.findBySlug(collection, entry.slug).catch(() => null);
    if (!item) { console.log(`  ${name}: no existe (la crea la siembra salvo que esté en la papelera)`); continue; }
    const revs = (await sql<{ id: string; author_id: string | null }>`select id, author_id from revisions where collection = ${collection} and entry_id = ${item.id}`.execute(db)).rows;
    const edited = revs.some(r => r.author_id) ? 'revisión guardada desde el panel'
      : item.authorId ? 'propietario asignado en el panel'
      : !['published', 'draft'].includes(item.status) ? `estado «${item.status}»`
      : item.status === 'draft' && revs.some(r => r.id !== item.draftRevisionId) ? 'retirada del sitio en el panel' : '';
    // Lo que siga publicado con campos obligatorios vacíos (p. ej. campos nuevos del contrato) hace fallar la página fuera de local.
    const gaps = item.status === 'published' ? emptyRequiredFields(collection, item.data) : [];
    const warn = gaps.length ? ` · AVISO: lo publicado deja vacíos ${gaps.join(', ')}: la página falla fuera de local hasta publicarla desde el panel` : '';
    if (edited) { n.skipped++; console.log(`  ${name}: se salta, editada (${edited})${warn}`); continue; }
    const draft = item.draftRevisionId ? await revisions.findById(item.draftRevisionId) : null;
    const current = draft?.data ?? item.data;
    const fields = Object.keys(entry.data).filter(key => !same(current[key], entry.data[key]));
    const goLive = entry.status === 'published' && (fields.length > 0 || item.status !== 'published' || draft !== null);
    if (!fields.length && !goLive) continue;
    n.changed++;
    if (goLive) n.published++;
    console.log(`  ${name}: ${fields.length ? fields.join(', ') : 'sin cambios de texto'} → ${goLive ? 'publicada' : `borrador pendiente (lo publicado no cambia)${warn}`}`);
    if (dryRun) continue;
    if (fields.length) {
      const staged = await revisions.create({ collection, entryId: item.id, data: { ...current, ...entry.data } });
      await repo.setDraftRevision(collection, item.id, staged.id);
      if (draft) await revisions.deleteIfUnreferenced(collection, item.id, draft.id);
    }
    if (goLive) await repo.publish(collection, item.id);
  }
  console.log(`existentes${dryRun ? ' (--dry-run: nada escrito)' : ''}: ${n.changed} con cambios, ${n.published} de ellas publicadas; ${n.skipped} saltadas por editadas en el panel`);
}

// Config mínima generada (solo el DB, `remote` en preview/producción) en .wrangler/tmp, ignorado: wrangler.jsonc no lleva bindings remotos.
const configPath = '.wrangler/tmp/cms-seed-remote.json';
mkdirSync('.wrangler/tmp', { recursive: true });
writeFileSync(configPath, JSON.stringify({ name: 'cms-seed-remote', compatibility_date: cfg.compatibility_date, compatibility_flags: ['nodejs_compat'],
  d1_databases: [{ binding: 'DB', database_name: d1!.database_name, database_id: d1!.database_id, remote: !local }] }));
const proxy = await getPlatformProxy<{ DB: ConstructorParameters<typeof D1Dialect>[0]['database'] }>({ configPath, persist: local ? { path: `${persist}/v3` } : false, remoteBindings: !local });
const db = new Kysely<any>({ dialect: new D1Dialect({ database: proxy.env.DB }) });
try {
  if (!(await sql`select count(*) as n from _emdash_collections`.execute(db).catch(() => null))) throw new Error('D1 sin las migraciones de EmDash: aplica antes node scripts/emdash-migrate-ci.mjs <env>.');
  if (dryRun) await updateUneditedEntries(db);
  else {
    // Como la autosiembra de EmDash (emdash-runtime, «Fresh-site media usage activation»): activar la captura ANTES de crear colecciones y
    // entradas, para que el registro instale los disparadores de cada colección nueva. Avanza una colección por llamada.
    for (let calls = 0; ; calls++) {
      const step = await handleMediaUsageActivationAdvance(db, { writersDrained: true });
      if (step.success && step.data.outcome === 'active') break;
      if (!step.success || calls > 200) {
        throw new Error(`Captura de uso de medios sin activar (${step.success ? step.data.outcome : step.error.code}). Sin ella se pueden borrar imágenes publicadas. `
          + 'Repite el script o, como administrador, POST /_emdash/api/admin/media-usage/activation con {"writersDrained": true} hasta «active».');
      }
    }
    // Esquema como scripts/cms-migrate.ts: alta idempotente y, solo sobre el modelo de las colecciones del contrato, «update».
    await applySeed(db, { ...base, content: undefined }, { includeContent: false, onConflict: 'skip' });
    const contract = { ...base, content: undefined, taxonomies: undefined, settings: undefined, collections: base.collections.filter((c: { slug: string }) => c.slug !== 'posts') };
    await applySeed(db, contract, { includeContent: false, onConflict: 'update' });
    const result = await applySeed(db, { version: '1', taxonomies: base.taxonomies, content }, { includeContent: true, onConflict: 'skip' });
    // La autosiembra de EmDash aplica esta misma semilla (package.json → seed/seed.json) en la primera petición en frío, que ya falló
    // en preview por límite de peticiones: queda marcada como hecha.
    await sql`insert into options (name, value) values ('emdash:seed_complete', 'true') on conflict (name) do nothing`.execute(db);
    console.log(`hecho: ${JSON.stringify(result.content ?? result)}`);
    if (updateUnedited) await updateUneditedEntries(db);
  }
} finally {
  await db.destroy();
  await proxy.dispose();
}
