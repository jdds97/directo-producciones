import { mkdirSync, existsSync, statSync, chmodSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
const [major, minor, patch] = process.versions.node.split('.').map(Number);
if (major !== 22 || minor < 22 || (minor === 22 && patch < 2)) {
  throw new Error('Usar Node 22.22.2 o posterior de la rama 22, indicado en .nvmrc.');
}
mkdirSync('.emdash', { recursive: true, mode: 0o700 });
const envExists = existsSync('.env');
if (!envExists || statSync('.env').size === 0) {
  let registry = resolve('content');
  if (!existsSync(resolve(registry, 'facts.yaml'))) {
    const commonDir = resolve(execFileSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim());
    const primaryRegistry = resolve(dirname(commonDir), 'content');
    if (existsSync(resolve(primaryRegistry, 'facts.yaml'))) registry = primaryRegistry;
  }
  const env = [
    'APP_ENV=local', 'LEADS_ENABLED=false', 'ANALYTICS_ENABLED=false',
    `CONTENT_REGISTRY_DIR=${JSON.stringify(registry)}`,
    `EMDASH_ENCRYPTION_KEY=emdash_enc_v1_${randomBytes(32).toString('base64url')}`, '',
  ].join('\n');
  if (envExists) chmodSync('.env', 0o600);
  writeFileSync('.env', env, { mode: 0o600, flag: envExists ? 'w' : 'wx' });
}
