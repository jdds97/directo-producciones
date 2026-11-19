// Migración idempotente del contenido corporativo a borradores de EmDash, en una persistencia local aislada.
//   npx tsx scripts/cms-migrate.ts --persist-to .wrangler/fase-03-cms   (con el Worker detenido)
// Crea solo entradas que no existen (onConflict: skip); nunca publica, nunca sobrescribe lo editado en el panel.
// Esquema: las colecciones nuevas (team, band_logos…) se crean enteras y a las existentes se les AÑADEN los campos nuevos
// (fotos, alt, estado…) con onConflict «update» solo sobre el modelo; ninguna entrada existente se toca.
import { readFileSync } from 'node:fs';
import { Kysely, sql } from 'kysely';
import { D1Dialect } from 'kysely-d1';
import { getPlatformProxy } from 'wrangler';
import { applySeed } from 'emdash/seed';
import { mediaRegistry } from '../src/lib/media-registry.ts';

const arg = (name: string) => process.argv[process.argv.indexOf(name) + 1];
const persist = arg('--persist-to');
if (!persist || !/^\.wrangler\/[\w.-]+$/.test(persist) || /blog-muestra-editorial|m4-astro-review/.test(persist)) {
  console.error('Uso: --persist-to .wrangler/<carpeta-aislada>. No se admite la muestra editorial ni la persistencia de revisión.');
  process.exit(2);
}
const proxy = await getPlatformProxy<{ DB: ConstructorParameters<typeof D1Dialect>[0]['database'] }>({ configPath: 'wrangler.jsonc', persist: { path: `${persist}/v3` } });
const db = new Kysely<any>({ dialect: new D1Dialect({ database: proxy.env.DB }) });
try {
  // Las migraciones de EmDash las aplica el runtime del Worker al primer arranque (migrations.runtime: auto).
  const initialised = await sql<{ n: number }>`select count(*) as n from _emdash_collections`.execute(db).catch(() => null);
  if (!initialised?.rows[0]?.n) throw new Error('Persistencia sin inicializar: arranca el Worker una vez con esta persistencia y repite.');
  const base = JSON.parse(readFileSync('seed/seed.json', 'utf8'));
  const drafts = JSON.parse(readFileSync('seed/content-drafts.json', 'utf8'));
  // Esquema (idempotente) + borradores. includeContent solo aplica las entradas del fichero de borradores.
  await applySeed(db, { ...base, content: undefined }, { includeContent: false, onConflict: 'skip' });
  const contract = { ...base, content: undefined, taxonomies: undefined, settings: undefined, collections: base.collections.filter((c: { slug: string }) => c.slug !== 'posts') };
  const schema = await applySeed(db, contract, { includeContent: false, onConflict: 'update' });
  // Campo heredado: la ruta tecleada del logotipo de «clients» ya no existe en el contrato (se elige la foto con un selector).
  await sql`update _emdash_fields set required = 0 where slug = 'logo_path' and collection_id in (select id from _emdash_collections where slug = 'clients')`.execute(db).catch(() => {});
  // Filas heredadas: el logotipo se guardaba como ruta tecleada. Se traduce a la clave autorizada equivalente (solo si coincide
  // exactamente con una foto del registro y la fila aún no tiene selección); nunca se reescribe lo ya elegido.
  const pending = async () => Number((await sql<{ n: number }>`select count(*) as n from ec_clients where logo_ref is null or logo_ref = ''`.execute(db).catch(() => null))?.rows[0]?.n ?? 0);
  const before = await pending();
  for (const [key, entry] of Object.entries(mediaRegistry)) {
    await sql`update ec_clients set logo_ref = ${key} where (logo_ref is null or logo_ref = '') and logo_path = ${entry.src}`.execute(db).catch(() => null);
  }
  const relinked = before - (await pending());
  if (relinked) console.log(`clients: ${relinked} logotipos heredados vinculados a su clave autorizada`);
  // Nombres y textos por defecto anteriores del equipo (decisión del propietario, 2026-11-01: nombre y primer apellido, sin la
  // cuestión Panigua/Paniagua). Solo se sustituye un valor que sea EXACTAMENTE el obsoleto; una edición hecha en el CMS no se toca.
  const obsolete: [string, string, string, string | null][] = [
    ['sergio-maya', 'name', 'Sergio Maya Panigua', 'Sergio Maya'],
    ['sergio-maya', 'name_home', 'Sergio Maya Paniagua', null],
    ['sergio-maya', 'photo_alt', 'Sergio Maya Panigua', 'Sergio Maya'],
    ['sergio-maya', 'photo_alt_home', 'Sergio Maya Paniagua, Director de Directo Producciones', 'Sergio Maya, Director de Directo Producciones'],
    ['sergio-maya', 'note', 'Grafía pendiente de confirmar: «Panigua» en Quiénes somos, «Paniagua» en Inicio. No unificar sin evidencia.', null],
    ['curro', 'name', 'Francisco de Dios Sánchez', 'Curro de Dios'],
    ['curro', 'photo_alt', 'Francisco de Dios Sánchez', 'Curro de Dios'],
    // Decisión del propietario (2026-11-02): se muestra como «Curro de Dios».
    ['curro', 'name', 'Francisco de Dios', 'Curro de Dios'],
    ['curro', 'photo_alt', 'Francisco de Dios', 'Curro de Dios'],
    ['curro', 'photo_alt_home', 'Francisco de Dios, Jefe técnico de Directo Producciones', 'Curro de Dios, Jefe técnico de Directo Producciones'],
  ];
  let renamed = 0;
  for (const [slug, column, from, to] of obsolete) {
    const found = await sql<{ n: number }>`select count(*) as n from ec_team where slug = ${slug} and ${sql.ref(column)} = ${from}`.execute(db).catch(() => null);
    if (!Number(found?.rows[0]?.n)) continue;
    await sql`update ec_team set ${sql.ref(column)} = ${to} where slug = ${slug} and ${sql.ref(column)} = ${from}`.execute(db);
    renamed++;
  }
  if (renamed) console.log(`team: ${renamed} valores obsoletos actualizados (solo los idénticos a la versión anterior)`);
  console.log(`schema: +${schema.fields?.created ?? 0} campos, ${schema.collections?.created ?? 0} colecciones nuevas`);
  const result = await applySeed(db, { version: '1', taxonomies: base.taxonomies, content: drafts.content }, { includeContent: true, onConflict: 'skip' });
  console.log(JSON.stringify(result.content ?? result, null, 1));
} finally {
  await db.destroy();
  await proxy.dispose();
}
