// Crea N entradas SINTÉTICAS publicadas en una persistencia local aislada (para probar filtros, sitemap y SEO del blog).
//   node scripts/blog-fixture.mjs --base http://localhost:4460 --persist .wrangler/fase-05-seo [--count 25]
// Solo localhost. Usa el token sintético de `author` del fixture; nunca contacta con nada externo.
import { readFileSync } from 'node:fs';
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('--base'), PERSIST = arg('--persist'), COUNT = Number(arg('--count', '25'));
if (!/^http:\/\/localhost:\d+$/.test(BASE ?? '') || !PERSIST) { console.error('Uso: --base http://localhost:<puerto> --persist <dir> [--count N]'); process.exit(2); }
const fx = JSON.parse(readFileSync(`${PERSIST}/fixture.json`, 'utf8'));
const call = async (method, path, body) => {
  const res = await fetch(BASE + path, { method, headers: { Origin: BASE, Authorization: `Bearer ${fx.author.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)?.slice(0, 160)}`);
  return json.data;
};
const terms = async tax => (await call('GET', `/_emdash/api/taxonomies/${tax}/terms`)).terms;
const cats = Object.fromEntries((await terms('category')).map(t => [t.slug, t.id]));
const block = (key, style, text) => ({ _type: 'block', _key: key, style, children: [{ _type: 'span', _key: `${key}s`, text }] });
let made = 0;
for (let i = 1; i <= COUNT; i++) {
  const group = i % 5 === 0 ? null : i % 2 ? 'produccion-audiovisual' : 'comunicacion-marketing'; // 1 de cada 5 sin categoría
  const slug = `prueba-filtros-${String(i).padStart(2, '0')}`;
  const data = await call('POST', '/_emdash/api/content/posts', { slug, data: {
    title: `Entrada sintética ${i}${i === 3 ? ' (destacada)' : ''}`, excerpt: `Resumen de la entrada sintética ${i} para probar filtros del blog.`, author: 'Equipo editorial',
    content: [block('a', 'h2', 'Sección de prueba'), block('b', 'normal', 'Texto sintético de prueba; no describe ningún trabajo ni cliente.')], synthetic: true, featured: i === 3,
  } });
  const id = (data.item ?? data).id;
  if (group) await call('POST', `/_emdash/api/content/posts/${id}/terms/category`, { termIds: [cats[group]] });
  await call('POST', `/_emdash/api/content/posts/${id}/publish`, {});
  made++;
}
console.log(`${made} entradas sintéticas publicadas en ${BASE}`);
