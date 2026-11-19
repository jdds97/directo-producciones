// Identidades SINTÉTICAS para probar roles en una persistencia aislada (nunca usuarios reales).
//   npx tsx scripts/cms-fixture.ts --persist-to .wrangler/fase-03-cms   (Worker detenido)
// Escribe <persist>/fixture.json (tokens de prueba) y <persist>/fixture.env (aprobador sintético local).
import { writeFileSync } from 'node:fs';
import { Kysely } from 'kysely';
import { D1Dialect } from 'kysely-d1';
import { getPlatformProxy } from 'wrangler';
import { generatePrefixedToken } from '@emdash-cms/auth';
import { ulid } from 'ulidx';

const persist = process.argv[process.argv.indexOf('--persist-to') + 1];
if (!persist || !/^\.wrangler\/fase-[\w.-]+$/.test(persist)) { console.error('Uso: --persist-to .wrangler/fase-<nombre> (persistencia aislada de pruebas)'); process.exit(2); }
const people = [
  { key: 'admin', role: 50 }, { key: 'admin2', role: 50 }, { key: 'editor', role: 40 }, { key: 'author', role: 30 }, { key: 'author2', role: 30 }, { key: 'contributor', role: 20 },
] as const;
const proxy = await getPlatformProxy<{ DB: ConstructorParameters<typeof D1Dialect>[0]['database'] }>({ configPath: 'wrangler.jsonc', persist: { path: `${persist}/v3` } });
const db = new Kysely<any>({ dialect: new D1Dialect({ database: proxy.env.DB }) });
const out: Record<string, { id: string; role: number; email: string; token: string }> = {};
try {
  for (const p of people) {
    const email = `${p.key}@fixture.invalid`;
    const existing = await db.selectFrom('users').select('id').where('email', '=', email).executeTakeFirst();
    const id = existing?.id ?? ulid();
    if (!existing) await db.insertInto('users').values({ id, email, name: `Sintético ${p.key}`, role: p.role, email_verified: 1 }).execute();
    await db.deleteFrom('_emdash_api_tokens').where('user_id', '=', id).execute();
    const { raw, hash, prefix } = generatePrefixedToken('ec_pat_');
    await db.insertInto('_emdash_api_tokens').values({ id: ulid(), name: 'fixture', token_hash: hash, prefix, user_id: id, scopes: JSON.stringify(['content:read', 'content:write', 'media:read', 'media:write', 'schema:read', 'schema:write', 'taxonomies:manage', 'menus:manage', 'settings:read', 'settings:manage', 'admin']), expires_at: new Date(Date.now() + 7 * 864e5).toISOString() }).execute();
    out[p.key] = { id, role: p.role, email, token: raw };
  }
  writeFileSync(`${persist}/fixture.json`, JSON.stringify(out, null, 1), { mode: 0o600 });
  writeFileSync(`${persist}/fixture.env`, `DP_SYNTHETIC_PUBLISHERS=${out.admin.id}\n`, { mode: 0o600 });
  console.log('Usuarios sintéticos:', Object.entries(out).map(([k, v]) => `${k}(${v.role})`).join(', '));
} finally { await db.destroy(); await proxy.dispose(); }
