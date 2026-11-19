// Único migrador de EmDash en preview/producción (el Worker solo comprueba, ver astro.config.mjs). Falla cerrado.
// `emdash migrate` exige CLOUDFLARE_API_TOKEN y cuenta reales, y con --wrangler-env también la ruta de la config de Wrangler (si falta,
// falla: «A Wrangler environment requires an explicit Wrangler configuration path»). --status probado contra preview el 2026-11-05.
// Uso: node scripts/emdash-migrate-ci.mjs <preview|production>
import { execFileSync } from 'node:child_process';

const env = process.argv[2];
if (!['preview', 'production'].includes(env)) { console.error('Uso: node scripts/emdash-migrate-ci.mjs <preview|production>'); process.exit(2); }
const base = ['emdash', 'migrate', '--from-config', '--wrangler-config', 'wrangler.jsonc', '--wrangler-env', env];
const out = execFileSync('npx', [...base, '--status', '--json'], { encoding: 'utf8' });
const status = JSON.parse(out.slice(out.indexOf('{')));
const findFingerprint = (node) => {
  for (const [key, value] of Object.entries(node ?? {})) {
    if (/fingerprint/i.test(key) && typeof value === 'string') return value;
    if (value && typeof value === 'object') { const inner = findFingerprint(value); if (inner) return inner; }
  }
};
const fingerprint = findFingerprint(status);
if (!fingerprint) { console.error('emdash migrate --status no devolvió «target fingerprint»: no se aplica nada.'); process.exit(1); }
execFileSync('npx', [...base, '--expected-target-fingerprint', fingerprint], { stdio: 'inherit' });
execFileSync('npx', [...base, '--check'], { stdio: 'inherit' });
