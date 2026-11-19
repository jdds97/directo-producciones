// Medición reproducible con Lighthouse FIJADO e instalado FUERA del proyecto (no toca package.json ni el lockfile):
//   mkdir -p /tmp/lh && cd /tmp/lh && npm init -y && npm i lighthouse@13.5.0
//   node scripts/lighthouse-runs.mjs --lh /tmp/lh --base http://localhost:4460 --out .private/.../lighthouse/base \
//        [--runs 5] [--profiles mobile,desktop] [--routes /,/servicios/]
// Caché fría (perfil Chrome nuevo en cada corrida), una corrida cada vez. Guarda un resumen por corrida y la mediana con rango.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const lh = arg('lh'), base = (arg('base') ?? '').replace(/\/$/, ''), out = arg('out') && resolve(arg('out'));
if (!lh || !base || !out) { console.error('Uso: --lh <dir> --base <url> --out <dir> [--runs 5] [--profiles mobile,desktop] [--routes a,b]'); process.exit(2); }
const runs = Number(arg('runs', '5'));
const profiles = arg('profiles', 'mobile,desktop').split(',');
const routes = arg('routes', '/,/quienes-somos/,/streaming/,/comunicacion-marketing/,/portfolio/,/contacto/,/blog/').split(',');
mkdirSync(out, { recursive: true });
const med = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const results = [];
for (const route of routes) for (const profile of profiles) {
  const rows = [];
  for (let i = 1; i <= runs; i++) {
    const file = join(out, `tmp-${Date.now()}.json`);
    const args = ['lighthouse', base + route, '--output=json', `--output-path=${file}`, '--quiet',
      '--only-categories=performance,accessibility,best-practices,seo',
      '--chrome-flags=--headless=new --no-sandbox --disable-gpu', ...(profile === 'desktop' ? ['--preset=desktop'] : [])];
    const r = spawnSync('npx', args, { cwd: lh, encoding: 'utf8', timeout: 180000 });
    let j; try { j = JSON.parse(readFileSync(file, 'utf8')); } catch { console.error(`FALLO ${route} ${profile} #${i}: ${(r.stderr ?? '').trim().split('\n')[0].slice(0, 200)}`); continue; } finally { rmSync(file, { force: true }); }
    const a = j.audits, c = j.categories;
    rows.push({
      perf: Math.round(c.performance.score * 100), a11y: Math.round(c.accessibility.score * 100),
      bp: Math.round(c['best-practices'].score * 100), seo: Math.round(c.seo.score * 100),
      fcp: a['first-contentful-paint'].numericValue, lcp: a['largest-contentful-paint'].numericValue,
      tbt: a['total-blocking-time'].numericValue, cls: a['cumulative-layout-shift'].numericValue, si: a['speed-index'].numericValue,
      bytes: a['total-byte-weight'].numericValue, requests: a['network-requests'].details.items.length,
      lcpEl: a['largest-contentful-paint-element']?.details?.items?.[0]?.items?.[0]?.node?.snippet?.slice(0, 120) ?? null,
      failed: Object.values(j.audits).filter(x => x.score !== null && x.score < 1 && x.scoreDisplayMode !== 'informative' && x.scoreDisplayMode !== 'notApplicable' && x.scoreDisplayMode !== 'manual').map(x => x.id),
      lhVersion: j.lighthouseVersion, chrome: j.environment.hostUserAgent,
    });
    console.log(`${profile.padEnd(7)} ${route.padEnd(26)} #${i} perf ${rows.at(-1).perf} a11y ${rows.at(-1).a11y} bp ${rows.at(-1).bp} seo ${rows.at(-1).seo} LCP ${Math.round(rows.at(-1).lcp)} TBT ${Math.round(rows.at(-1).tbt)} CLS ${rows.at(-1).cls.toFixed(3)}`);
  }
  if (!rows.length) continue;
  const k = key => ({ median: med(rows.map(x => x[key])), min: Math.min(...rows.map(x => x[key])), max: Math.max(...rows.map(x => x[key])) });
  results.push({ route, profile, n: rows.length, perf: k('perf'), a11y: k('a11y'), bp: k('bp'), seo: k('seo'),
    fcp: k('fcp'), lcp: k('lcp'), tbt: k('tbt'), cls: k('cls'), si: k('si'), bytes: k('bytes'), requests: k('requests'),
    lcpEl: rows[0].lcpEl, failed: [...new Set(rows.flatMap(x => x.failed))], rows });
  writeFileSync(join(out, 'runs.json'), JSON.stringify({ base, runs, lh: rows[0].lhVersion, chrome: rows[0].chrome, results }, null, 1));
}
console.log('\nruta | perfil | n | perf (mediana, rango) | a11y | bp | seo | LCP ms | TBT ms | CLS | KiB | peticiones');
for (const r of results) console.log([r.route, r.profile, r.n, `${r.perf.median} (${r.perf.min}-${r.perf.max})`, r.a11y.median, r.bp.median, r.seo.median,
  Math.round(r.lcp.median), Math.round(r.tbt.median), r.cls.median.toFixed(3), Math.round(r.bytes.median / 1024), r.requests.median].join(' | '));
