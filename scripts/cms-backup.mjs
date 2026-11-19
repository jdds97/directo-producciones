// Copia y restauración LOCAL de una persistencia aislada del CMS (D1 + R2 + KV), con comprobación de conteos y hashes.
//   node scripts/cms-backup.mjs backup  .wrangler/fase-03-cms  <destino>     (destino bajo .wrangler/, p. ej. .wrangler/fase-03-copia)
//   node scripts/cms-backup.mjs restore <copia> .wrangler/fase-03-restaurada
//   node scripts/cms-backup.mjs verify  <dirA> <dirB>                      (compara conteos y hashes de contenido)
// Esos tres solo tocan rutas bajo .wrangler/fase-*; no usan red, ni Cloudflare, ni wrangler.
// Copia de preview/producción (D1 DB y CONTACT_DB + medios de R2 `MEDIA` + MEDIA_KV mientras siga declarado). Solo lectura en Cloudflare,
// con la sesión de wrangler del propietario; deja en la carpeta las instrucciones de restauración (RESTAURAR.txt) y los sha256 (manifest.json):
//   node scripts/cms-backup.mjs export --env preview|production --out <carpeta nueva fuera del repo>
//   node scripts/cms-backup.mjs export --env local --out .wrangler/<carpeta>   (ensayo sin red contra .wrangler/state, el de `npm run dev`)
// Mientras dura `d1 export --remote` la D1 no atiende consultas: la copia de producción, en una franja de poco tráfico. La carpeta (0700,
// archivos 0600) es material sensible entera: usuarios, credenciales y tokens del CMS, y datos personales en CONTACT_DB.
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

const [cmd, a, b] = process.argv.slice(2);
const safe = (p) => { const r = resolve(p); if (!/\/\.wrangler\/fase-[a-z0-9-]+(\/|$)/.test(r + '/')) throw new Error(`Ruta no permitida: ${p} (solo .wrangler/fase-*)`); return r; };
const d1File = (dir) => { const d = join(dir, 'v3/d1/miniflare-D1DatabaseObject'); const f = readdirSync(d).find(x => x.endsWith('.sqlite') && x !== 'metadata.sqlite'); if (!f) throw new Error(`Sin D1 en ${dir}`); return join(d, f); };
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

function snapshot(dir) {
  const db = new DatabaseSync(d1File(dir), { readOnly: true });
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%' AND name NOT LIKE '_cf_%' ORDER BY name").all().map(r => r.name);
  const out = {};
  for (const t of tables) {
    const rows = db.prepare(`SELECT * FROM "${t}"`).all();
    const canon = rows.map(r => JSON.stringify(r, Object.keys(r).sort())).sort().join('\n');
    out[t] = { rows: rows.length, sha256: sha(canon) };
  }
  db.close();
  const blobsDir = join(dir, 'v3/r2/directo-producciones-media-local/blobs');
  const blobs = existsSync(blobsDir) ? readdirSync(blobsDir).sort().map(f => ({ f, sha256: sha(readFileSync(join(blobsDir, f))), bytes: statSync(join(blobsDir, f)).size })) : [];
  return { tables: out, r2Blobs: blobs };
}
const copyState = (from, to) => {
  rmSync(to, { recursive: true, force: true }); mkdirSync(to, { recursive: true });
  // D1 con VACUUM INTO (copia consistente aunque el Worker esté abierto); R2 y KV por copia de ficheros.
  const dstD1 = join(to, 'v3/d1/miniflare-D1DatabaseObject'); mkdirSync(dstD1, { recursive: true });
  const src = d1File(from); const db = new DatabaseSync(src, { readOnly: true }); db.exec(`VACUUM INTO '${join(dstD1, src.split('/').pop()).replace(/'/g, "''")}'`); db.close();
  if (existsSync(join(from, 'v3/d1/miniflare-D1DatabaseObject/metadata.sqlite'))) cpSync(join(from, 'v3/d1/miniflare-D1DatabaseObject/metadata.sqlite'), join(dstD1, 'metadata.sqlite'));
  for (const sub of ['r2', 'kv']) if (existsSync(join(from, 'v3', sub))) cpSync(join(from, 'v3', sub), join(to, 'v3', sub), { recursive: true });
};
const compare = (x, y) => {
  const diffs = [];
  for (const t of new Set([...Object.keys(x.tables), ...Object.keys(y.tables)])) {
    const p = x.tables[t], q = y.tables[t];
    if (!p || !q || p.rows !== q.rows || p.sha256 !== q.sha256) diffs.push(`${t}: ${p?.rows ?? '—'} ≠ ${q?.rows ?? '—'}`);
  }
  if (JSON.stringify(x.r2Blobs) !== JSON.stringify(y.r2Blobs)) diffs.push('r2: blobs distintos');
  return diffs;
};

if (cmd === 'backup') {
  const from = safe(a), to = safe(b); copyState(from, to);
  const snap = snapshot(from); writeFileSync(join(to, 'manifest.json'), JSON.stringify({ at: new Date().toISOString(), ...snap }, null, 1));
  const diffs = compare(snap, snapshot(to));
  console.log(`copia → ${b}: ${Object.keys(snap.tables).length} tablas, ${Object.values(snap.tables).reduce((n, t) => n + t.rows, 0)} filas, ${snap.r2Blobs.length} medios`);
  if (diffs.length) { console.error('DIFERENCIAS', diffs); process.exit(1); }
} else if (cmd === 'restore') {
  const from = safe(a), to = safe(b); copyState(from, to);
  const manifest = JSON.parse(readFileSync(join(from, 'manifest.json'), 'utf8'));
  const diffs = compare(manifest, snapshot(to));
  console.log(`restaurado → ${b}: ${diffs.length ? 'DIFERENCIAS' : 'conteos y hashes idénticos al manifiesto'}`);
  if (diffs.length) { console.error(diffs); process.exit(1); }
} else if (cmd === 'verify') {
  const diffs = compare(snapshot(safe(a)), snapshot(safe(b))); console.log(diffs.length ? diffs.join('\n') : 'idénticas'); process.exit(diffs.length ? 1 : 0);
} else if (cmd === 'export') {
  const opt = (name) => { const i = process.argv.indexOf(name); return i > 2 ? process.argv[i + 1] : undefined; };
  const env = opt('--env'), out = resolve(opt('--out') ?? '.'), repo = resolve('.');
  if (!['local', 'preview', 'production'].includes(env) || !opt('--out')) { console.error('uso: export --env preview|production|local --out <carpeta>'); process.exit(2); }
  // CONTACT_DB lleva datos personales: nunca dentro del repositorio salvo bajo .wrangler/ (ignorado).
  if (`${out}/`.startsWith(`${repo}/`) && !`${out}/`.startsWith(`${repo}/.wrangler/`)) throw new Error('--out: fuera del repositorio o bajo .wrangler/');
  if (existsSync(out) && readdirSync(out).length) throw new Error(`--out no está vacía: ${out}`);
  mkdirSync(out, { recursive: true, mode: 0o700 }); chmodSync(out, 0o700);
  const { unstable_readConfig } = await import('wrangler');
  const cfg = unstable_readConfig({ config: 'wrangler.jsonc', env: env === 'local' ? undefined : env }, { hideWarnings: true });
  const where = env === 'local' ? ['--local'] : ['--env', env, '--remote'];
  const wrangler = (...args) => execFileSync('npx', ['wrangler', ...args, ...where], { maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'inherit'] });
  const json = (buf) => { const text = buf.toString(); return JSON.parse(text.slice(text.search(/[[{]/))); };
  const files = {};
  const save = (name, data) => { writeFileSync(join(out, name), data, { mode: 0o600 }); files[name] = sha(readFileSync(join(out, name))); };
  // Tablas efímeras (sesiones, retos y enlaces de acceso, contadores): solo su esquema; no se copian identificadores de sesión en claro.
  const ephemeral = new Set(['dp_astro_sessions', 'auth_challenges', 'auth_tokens', '_emdash_rate_limits']);
  for (const { binding, database_name: name } of cfg.d1_databases ?? []) {
    const objects = json(wrangler('d1', 'execute', name, '--json', '--command', 'SELECT type, name, tbl_name, sql FROM sqlite_master'))[0].results;
    // D1 no exporta una base con tablas virtuales (el FTS5 del buscador de EmDash, que EmDash rehace en la primera búsqueda): se
    // exportan los datos de las demás tablas y el esquema sale de sqlite_master, en el orden que admite una base nueva: tablas →
    // datos → índices y disparadores (así ni las claves ajenas ni los disparadores actúan durante la carga).
    const virtual = objects.filter(o => /^CREATE VIRTUAL TABLE/i.test(o.sql ?? '')).map(o => o.name);
    const skip = (n) => /^(?:sqlite_|_cf_)/.test(n) || virtual.some(v => n === v || n.startsWith(`${v}_`));
    const ddl = (types) => objects.filter(o => types.includes(o.type) && o.sql && !skip(o.name) && !skip(o.tbl_name)).map(o => `${o.sql};\n`).join('');
    const data = join(out, `${binding}.datos.tmp`);
    wrangler('d1', 'export', name, '--no-schema', '--skip-confirmation', '--output', data, ...objects.filter(o => o.type === 'table' && !skip(o.name) && !ephemeral.has(o.name)).flatMap(o => ['--table', o.name]));
    save(`${binding}.sql`, ddl(['table']) + readFileSync(data, 'utf8') + ddl(['index', 'trigger']));
    rmSync(data);
  }
  // MEDIA (R2): `wrangler r2 object` no lista, así que las claves salen de la tabla `media` de la D1 del CMS (storage_key de EmDash 1.1.0,
  // que es la clave del objeto). Cada objeto va a MEDIA/<n> con su Content-Type (media.mime_type) y se comprueba frente a media.size y al
  // content_hash de EmDash (sha1:…). Las subidas sin confirmar (status ≠ ready) no se copian: el cron de EmDash las limpia.
  const bucket = cfg.r2_buckets?.find(r => r.binding === 'MEDIA');
  const jurisdiction = bucket?.jurisdiction ? ['--jurisdiction', bucket.jurisdiction] : [];
  const media = [], mediaErrors = [];
  if (bucket) {
    const cms = (cfg.d1_databases ?? []).find(d => d.binding === 'DB');
    const rows = json(wrangler('d1', 'execute', cms.database_name, '--json', '--command', "SELECT storage_key, mime_type, size, content_hash FROM media WHERE status = 'ready' ORDER BY storage_key"))[0].results;
    mkdirSync(join(out, 'MEDIA'), { mode: 0o700 });
    rows.forEach((r, i) => {
      const file = `MEDIA/${String(i + 1).padStart(5, '0')}`; // nombre propio: la clave no se usa como ruta local
      try { wrangler('r2', 'object', 'get', `${bucket.bucket_name}/${r.storage_key}`, '--file', join(out, file), ...jurisdiction); }
      catch { rmSync(join(out, file), { force: true }); mediaErrors.push(`${r.storage_key}: no se pudo descargar`); return; }
      chmodSync(join(out, file), 0o600);
      const buf = readFileSync(join(out, file));
      const sha1 = `sha1:${createHash('sha1').update(buf).digest('hex')}`;
      if (r.size != null && r.size !== buf.length) mediaErrors.push(`${r.storage_key}: ${buf.length} bytes, la D1 dice ${r.size}`);
      if (r.content_hash?.startsWith('sha1:') && r.content_hash !== sha1) mediaErrors.push(`${r.storage_key}: hash ${sha1} ≠ ${r.content_hash}`);
      files[file] = sha(buf);
      media.push({ key: r.storage_key, file, contentType: r.mime_type, bytes: buf.length, sha256: files[file] });
    });
    save('MEDIA.json', JSON.stringify({ bucket: bucket.bucket_name, jurisdiction: bucket.jurisdiction ?? null, objects: media }, null, 1));
  }
  // MEDIA_KV (mientras siga declarado) clave a clave, en el formato de `wrangler kv bulk put` (valor en base64 y metadatos), en archivos de
  // ≤ 50 MB (máx. 100 MB).
  const hasKv = (cfg.kv_namespaces ?? []).some(k => k.binding === 'MEDIA_KV');
  const keys = hasKv ? json(wrangler('kv', 'key', 'list', '--binding', 'MEDIA_KV')) : [];
  const chunks = [[]];
  let size = 0;
  for (const k of keys) {
    const value = wrangler('kv', 'key', 'get', k.name, '--binding', 'MEDIA_KV').toString('base64');
    if (size + value.length > 50e6 && chunks.at(-1).length) { chunks.push([]); size = 0; }
    chunks.at(-1).push({ key: k.name, value, base64: true, ...(k.metadata ? { metadata: k.metadata } : {}), ...(k.expiration ? { expiration: k.expiration } : {}) });
    size += value.length;
  }
  const kvFiles = hasKv ? chunks.map((c, i) => { const f = `MEDIA_KV-${String(i + 1).padStart(3, '0')}.json`; save(f, JSON.stringify(c)); return f; }) : [];
  const q = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;
  const at = new Date().toISOString(), envFlag = env === 'local' ? '' : ` --env ${env}`;
  writeFileSync(join(out, 'manifest.json'), JSON.stringify({ at, env, d1: (cfg.d1_databases ?? []).map(d => d.database_name), mediaR2: bucket ? { bucket: bucket.bucket_name, objects: media.length, bytes: media.reduce((n, m) => n + m.bytes, 0), errors: mediaErrors } : null, mediaKvKeys: hasKv ? keys.length : null, sha256: files }, null, 1), { mode: 0o600 });
  writeFileSync(join(out, 'RESTAURAR.txt'), [
    `Copia ${env} del ${at}. Antes de restaurar, comprueba los sha256 de manifest.json (sha256sum <archivo>).`,
    'TODA esta carpeta es material sensible: guárdala cifrada y fuera de Cloudflare. DB.sql lleva usuarios, credenciales de acceso y',
    'tokens de API/OAuth del CMS (sin sesiones ni retos de acceso, que solo llevan esquema); CONTACT_DB, datos personales de consultas.',
    'D1, volver atrás en la MISMA base (hasta 30 días): Time Travel, sin usar esta copia.',
    ...(cfg.d1_databases ?? []).map(d => `  npx wrangler d1 time-travel restore ${d.database_name}${envFlag} --timestamp <ISO-8601>`),
    'D1 desde esta copia: en una base NUEVA y vacía (el .sql crea las tablas; sobre una base con datos falla); después, apuntar su',
    'database_id en wrangler.jsonc por pull request.',
    ...(cfg.d1_databases ?? []).map(d => `  npx wrangler d1 execute <base-nueva>${envFlag} --remote --file ${d.binding}.sql`),
    'El buscador del blog (FTS5) no se copia: EmDash lo reconstruye en la primera búsqueda.',
    ...(bucket ? [
      `MEDIA (R2 ${bucket.bucket_name}${bucket.jurisdiction ? `, jurisdicción ${bucket.jurisdiction}` : ''}): misma clave y Content-Type, un comando por objeto (lista en MEDIA.json).`,
      'Se restauran en el bucket del entorno (o en uno nuevo con la misma jurisdicción, apuntado en wrangler.jsonc por pull request):',
      ...media.map(m => `  npx wrangler r2 object put ${q(`${bucket.bucket_name}/${m.key}`)} --file ${m.file} --content-type ${q(m.contentType)}${bucket.jurisdiction ? ` --jurisdiction ${bucket.jurisdiction}` : ''}${envFlag} --remote`),
      ...(mediaErrors.length ? ['ATENCIÓN, objetos que no cuadran con la D1 o no se pudieron descargar:', ...mediaErrors.map(e => `  ${e}`)] : []),
    ] : []),
    ...(hasKv ? ['MEDIA_KV (claves, valores y metadatos), un comando por archivo:', ...kvFiles.map(f => `  npx wrangler kv bulk put ${f} --binding MEDIA_KV${envFlag} --remote`)] : []),
    'Ensayo sin red: los mismos comandos con el nombre de la base del entorno y --local --persist-to .wrangler/fase-restaurada-<fecha> en vez de --remote.',
    'CONTACT_DB contiene datos personales de consultas: bórrala según la retención (OPERACION-INFRA.md).',
  ].join('\n') + '\n', { mode: 0o600 });
  console.log(`copia ${env} → ${out}: ${(cfg.d1_databases ?? []).length} bases D1, ${bucket ? `${media.length} objetos de R2 MEDIA` : 'sin R2 MEDIA'}, ${hasKv ? `${keys.length} claves de MEDIA_KV` : 'sin MEDIA_KV'}; ver RESTAURAR.txt`);
  if (mediaErrors.length) { console.error('MEDIOS CON DIFERENCIAS (ver RESTAURAR.txt):', mediaErrors); process.exit(1); }
} else { console.error('uso: backup|restore|verify|export'); process.exit(2); }
