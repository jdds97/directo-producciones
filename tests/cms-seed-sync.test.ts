// Ensayo de `scripts/cms-seed-remote.ts --update-unedited` en una D1 local nueva (.wrangler/seed-sync-test-<pid>): se siembra una versión
// antigua publicada (como .wrangler/preview-remote/seed-preview.ts), se simula el panel (guardar y publicar con autor; retirar una ficha)
// y se comprueba que: el dry-run no escribe, las no editadas pasan a la fuente (publicadas si la política lo permite; si no, borrador
// pendiente sin tocar lo publicado), las editadas se saltan y la segunda pasada no cambia nada. Todo sintético y local.
// Tarda unos 2,5 min (workerd, migraciones y tres pasadas del script): fuera de `npm run test:cms` salvo con SEED_SYNC_E2E=1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { Kysely, sql } from 'kysely';
import { D1Dialect } from 'kysely-d1';
import { getPlatformProxy, unstable_readConfig } from 'wrangler';
import { applySeed } from 'emdash/seed';
import { runMigrations } from 'emdash/db';
import { ContentRepository, RevisionRepository } from 'emdash';
import { evaluatePublish, emptyRequiredFields, ROLE } from '../src/lib/editorial-policy.ts';

type Entry = { id: string; slug: string; status?: string; data: Record<string, unknown> };
const PERSIST = `.wrangler/seed-sync-test-${process.pid}`; // propia de cada ejecución: dos ejecuciones a la vez no se pisan
const base = JSON.parse(readFileSync('seed/seed.json', 'utf8'));
const drafts = JSON.parse(readFileSync('seed/content-drafts.json', 'utf8')) as { content: Record<string, Entry[]> };
const d1 = (unstable_readConfig({ config: 'wrangler.jsonc' }, { hideWarnings: true }).d1_databases ?? []).find((d: { binding: string }) => d.binding === 'DB') as { database_id: string; database_name: string };
const allowed = (collection: string, data: Record<string, unknown>) =>
  evaluatePublish({ collection, data, actor: { id: 'cms-seed-remote', role: ROLE.editor }, approverIds: new Set(), local: false }).allow && !emptyRequiredFields(collection, data).length;
const textField = (data: Record<string, unknown>) => Object.keys(data).find(k => typeof data[k] === 'string' && (data[k] as string).trim() && !(data[k] as string).includes('{{'))!;

// Entradas del ensayo: publicable sin aprobador (A), editada en el panel (E), retenida por la política (H) y ficha retirada (U).
const singletons = Object.keys(drafts.content).filter(c => drafts.content[c].length === 1);
const [A, E] = singletons.filter(c => allowed(c, drafts.content[c][0].data));
const H = singletons.find(c => c.startsWith('legal_'))!;
const U = Object.keys(drafts.content).find(c => drafts.content[c].length > 1)!;
// H: la versión antigua publicada deja vacío un campo obligatorio (como un campo nuevo del contrato): el script debe avisar.
const requiredField = (c: string, data: Record<string, unknown>) => Object.keys(data).find(k => emptyRequiredFields(c, { ...data, [k]: '' }).length)!;
const cases = [A, E, H, U].map(collection => {
  const entry = drafts.content[collection][0], field = collection === H ? requiredField(H, entry.data) : textField(entry.data), now = entry.data[field];
  return { collection, slug: entry.slug, field, now, old: collection === H ? '' : `${now} · versión antigua` };
});
const PANEL = 'Texto guardado en el panel';

// D1 no admite el `pragma_table_info` cruzado del introspector de Kysely; el Migrator solo necesita saber qué tablas existen
// (EmDash usa su propio introspector, que no exporta).
class MigrationD1Dialect extends D1Dialect {
  createIntrospector(db: Kysely<any>) {
    const getTables = async () => (await sql<{ name: string }>`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '_cf_%'`.execute(db)).rows
      .map(({ name }) => ({ name, isView: false, isForeign: false, columns: [] }));
    return { getSchemas: async () => [], getTables, getMetadata: async () => ({ tables: await getTables() }) };
  }
}
async function open() {
  mkdirSync(PERSIST, { recursive: true });
  writeFileSync(`${PERSIST}/wrangler.json`, JSON.stringify({ name: 'seed-sync-test', compatibility_date: '2025-01-01', d1_databases: [{ binding: 'DB', database_name: d1.database_name, database_id: d1.database_id }] }));
  const proxy = await getPlatformProxy<{ DB: ConstructorParameters<typeof D1Dialect>[0]['database'] }>({ configPath: `${PERSIST}/wrangler.json`, persist: { path: `${PERSIST}/v3` } });
  const db = new Kysely<any>({ dialect: new MigrationD1Dialect({ database: proxy.env.DB }) });
  return { db, close: async () => { await db.destroy(); await proxy.dispose(); } };
}
// Lo que lee la web (site-content → getEmDashCollection status «published»: columnas de ec_*) y los punteros de revisión.
async function snapshot() {
  const { db, close } = await open();
  try {
    const rows = [];
    for (const c of cases) {
      const row = (await sql<Record<string, unknown>>`select status, live_revision_id, draft_revision_id, ${sql.ref(c.field)} as value from ${sql.ref(`ec_${c.collection}`)} where slug = ${c.slug}`.execute(db)).rows[0];
      const draft = row.draft_revision_id ? JSON.parse((await sql<{ data: string }>`select data from revisions where id = ${row.draft_revision_id}`.execute(db)).rows[0].data)[c.field] : null;
      rows.push({ ...c, status: row.status, live: Boolean(row.live_revision_id), value: row.value, draft });
    }
    const revisions = Number((await sql<{ n: number }>`select count(*) as n from revisions`.execute(db)).rows[0].n);
    let versions = 0; // toda escritura de EmDash sube la versión de la fila
    for (const c of Object.keys(drafts.content)) versions += Number((await sql<{ v: number }>`select sum(version) as v from ${sql.ref(`ec_${c}`)}`.execute(db)).rows[0].v);
    return { rows: Object.fromEntries(rows.map(r => [r.collection, r])), revisions, versions };
  } finally { await close(); }
}
// Solo las líneas de la sincronización (la lista de retenidas por la política es larga).
const show = (out: string) => out.split('\n').filter(line => /→|se salta|^existentes|^hecho/.test(line)).join('\n');
const sync = (...flags: string[]) => execFileSync('npx', ['tsx', 'scripts/cms-seed-remote.ts', '--env', 'local', '--confirm-d1', d1.database_id, '--persist-to', PERSIST, '--update-unedited', '--publish', ...flags], { encoding: 'utf8' });

test('--update-unedited: pone al día lo no editado, salta lo editado en el panel, dry-run sin escrituras e idempotente', { timeout: 600_000, skip: !process.env.SEED_SYNC_E2E && 'ensayo lento: SEED_SYNC_E2E=1 APP_ENV=local npx tsx --test tests/cms-seed-sync.test.ts' }, async t => {
  assert.ok(A && E && H && U, 'faltan entradas de ensayo en la semilla');
  t.after(() => rmSync(PERSIST, { recursive: true, force: true }));
  const { db, close } = await open();
  try {
    await runMigrations(db);
    // Versión antigua: cada caso con su texto cambiado y todo publicado, como hicieron los scripts antiguos de la preview.
    const content = Object.fromEntries(Object.entries(drafts.content).map(([collection, entries]) => [collection, entries.map(entry => {
      const c = cases.find(x => x.collection === collection && x.slug === entry.slug);
      return { ...entry, status: 'published' as const, data: c ? { ...entry.data, [c.field]: c.old } : entry.data };
    })]));
    await applySeed(db, { ...base, content: undefined }, { includeContent: false, onConflict: 'skip' });
    await applySeed(db, { ...base, content: undefined, taxonomies: undefined, settings: undefined, collections: base.collections.filter((c: { slug: string }) => c.slug !== 'posts') }, { includeContent: false, onConflict: 'update' });
    await applySeed(db, { version: '1', taxonomies: base.taxonomies, content }, { includeContent: true, onConflict: 'skip' });
    // Panel, como emdash-runtime.handleContentUpdate en una colección con revisiones: revisión con autor como borrador y publicar.
    const repo = new ContentRepository(db), revisions = new RevisionRepository(db);
    const e = (await repo.findBySlug(E, 'main'))!, field = cases[1].field;
    const saved = await revisions.create({ collection: E, entryId: e.id, data: { ...e.data, [field]: PANEL }, authorId: 'editor-sintetico' });
    await repo.setDraftRevision(E, e.id, saved.id);
    await repo.publish(E, e.id);
    // Retirar una ficha en el panel (despublicar): revisión sin autor como borrador y la ficha en borrador.
    await repo.unpublish(U, (await repo.findBySlug(U, cases[3].slug))!.id);
  } finally { await close(); }

  const before = await snapshot();
  const dry = sync('--dry-run');
  t.diagnostic(show(dry));
  assert.deepEqual(await snapshot(), before, 'el dry-run no debe escribir');
  assert.match(dry, new RegExp(`${A}/main: ${cases[0].field} → publicada`));
  assert.match(dry, new RegExp(`${E}/main: se salta, editada \\(revisión guardada desde el panel\\)`));
  assert.match(dry, new RegExp(`${H}/main: ${cases[2].field} → borrador pendiente \\(lo publicado no cambia\\) · AVISO: lo publicado deja vacíos`));
  assert.match(dry, new RegExp(`${U}/${cases[3].slug}: se salta, editada \\(retirada del sitio en el panel\\)`));
  assert.match(dry, /existentes \(--dry-run: nada escrito\): 2 con cambios, 1 de ellas publicadas; 2 saltadas/);

  t.diagnostic(show(sync()));
  const after = await snapshot();
  const [a, ed, h, u] = cases.map(c => after.rows[c.collection]);
  assert.deepEqual([a.status, a.live, a.value, a.draft], ['published', true, cases[0].now, null], 'A: versión nueva publicada');
  assert.deepEqual([ed.status, ed.value, ed.draft], ['published', PANEL, null], 'E: lo del panel intacto');
  assert.deepEqual([h.status, h.value, h.draft], ['published', cases[2].old, cases[2].now], 'H: lo publicado no cambia; versión nueva pendiente');
  assert.deepEqual([u.status, u.live], ['draft', false], 'U: sigue retirada');

  const again = sync();
  t.diagnostic(show(again));
  assert.match(again, /existentes: 0 con cambios, 0 de ellas publicadas; 2 saltadas/);
  assert.deepEqual(await snapshot(), after, 'la segunda pasada no escribe');
});
