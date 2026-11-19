import { execFileSync } from 'node:child_process';
import { LOCAL_REVIEW_PORT } from '../config/local-review.mjs';

// Pass an explicit persistence only once; Wrangler rejects duplicate flags.
const extraArgs = process.argv.slice(2);
const hasPersistence = extraArgs.some(arg => arg === '--persist-to' || arg.startsWith('--persist-to='));

// DP_WORKER_CONFIG permite servir un build alternativo (p. ej. .wrangler/<carpeta>/dist/server/wrangler.json) sin tocar el dist/ compartido.
// Sin la variable, el comportamiento es el de siempre: dist/server/wrangler.json.
const workerConfig = process.env.DP_WORKER_CONFIG || 'dist/server/wrangler.json';
if (!/^(?:dist|\.wrangler\/[\w.-]+\/dist)\/server\/wrangler\.json$/.test(workerConfig)) throw new Error('DP_WORKER_CONFIG debe apuntar a dist/server/wrangler.json o .wrangler/<carpeta>/dist/server/wrangler.json');

// Use the installed Wrangler and isolated persistence within this checkout.
execFileSync('npm', ['exec', '--', 'wrangler', 'dev',
  '--config', workerConfig, '--local', '--test-scheduled',
  '--ip', '127.0.0.1', '--port', String(LOCAL_REVIEW_PORT), '--inspector-port', '0',
  ...(!hasPersistence ? ['--persist-to', '.wrangler/m4-astro-review'] : []),
  '--env-file', '.env', ...extraArgs,
], { stdio: 'inherit' });
