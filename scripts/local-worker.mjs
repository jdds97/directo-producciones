import { execFileSync } from 'node:child_process';
import { LOCAL_REVIEW_PORT } from '../config/local-review.mjs';

// Use the installed Wrangler and isolated persistence within this checkout.
execFileSync('npm', ['exec', '--', 'wrangler', 'dev',
  '--config', 'dist/server/wrangler.json', '--local', '--test-scheduled',
  '--ip', '127.0.0.1', '--port', String(LOCAL_REVIEW_PORT), '--inspector-port', '0',
  '--persist-to', '.wrangler/m4-astro-review', '--env-file', '.env',
  ...process.argv.slice(2),
], { stdio: 'inherit' });
