// Coste de la lectura CMS en local: TTFB en caliente (caché de 30 s) y en frío (tras publicar, que invalida).
//   node scripts/cms-cache-cost.mjs [--base http://localhost:4440] [--persist .wrangler/fase-03-cms]
import { readFileSync } from 'node:fs';
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'http://localhost:4440'), fx = JSON.parse(readFileSync(`${arg('--persist', '.wrangler/fase-03-cms')}/fixture.json`, 'utf8'));
if (!/^http:\/\/localhost:\d+$/.test(BASE)) throw new Error('Solo localhost');
const H = { Authorization: `Bearer ${fx.editor.token}`, Origin: BASE, 'Content-Type': 'application/json' };
const ttfb = async (p) => { const t = performance.now(); const r = await fetch(BASE + p); await r.arrayBuffer(); return performance.now() - t; };
const stat = (a) => { const s = [...a].sort((x, y) => x - y); return { n: s.length, p50: +s[Math.floor(s.length / 2)].toFixed(1), max: +s.at(-1).toFixed(1) }; };
const list = await (await fetch(`${BASE}/_emdash/api/content/page_servicios`, { headers: H })).json(); const it = list.data.items[0];
const warm = [], cold = [];
await ttfb('/servicios/');
for (let i = 0; i < 20; i++) warm.push(await ttfb('/servicios/'));
for (let i = 0; i < 10; i++) {
  const pub = await fetch(`${BASE}/_emdash/api/content/page_servicios/${it.id}/publish`, { method: 'POST', headers: H, body: '{}' });
  if (!pub.ok) throw new Error(`publicar ${pub.status}`);
  cold.push(await ttfb('/servicios/'));
}
console.log(JSON.stringify({ ruta: '/servicios/', caliente: stat(warm), frio_tras_publicar: stat(cold), ttl_s: 30, kv: 'no añadido: lectura D1 local < decenas de ms; reevaluar con métricas reales en Cloudflare' }, null, 1));
