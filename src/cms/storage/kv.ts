// Entrypoint de runtime para `storage` de EmDash (se importa solo en el Worker, nunca en config).
// Cableado (lo hace el runtime en astro.config.mjs, no este archivo):
//   storage: { entrypoint: '/src/cms/storage/kv.ts', config: { binding: 'MEDIA_KV' } }
//   emdash({ maxUploadSize: 10 * 1024 * 1024 })
//   wrangler: "kv_namespaces": [{ "binding": "MEDIA_KV", "id": "<id por entorno>" }]
import { env } from 'cloudflare:workers';
import { EmDashStorageError } from 'emdash';
import type { Storage } from 'emdash';
import { KvStorage, type KvLike, type KvStorageConfig } from './kv-storage.ts';

export type { KvStorageConfig } from './kv-storage.ts';

export function createStorage(config: Record<string, unknown>): Storage {
  const binding = typeof config.binding === 'string' ? config.binding : '';
  if (!binding) throw new EmDashStorageError('KV binding name is required in storage config.', 'BINDING_NOT_FOUND');
  const kv = (env as Record<string, unknown>)[binding] as KvLike | undefined;
  if (!kv) throw new EmDashStorageError(`KV binding "${binding}" not found. Declare it under kv_namespaces in wrangler.jsonc.`, 'BINDING_NOT_FOUND');
  const num = (k: keyof KvStorageConfig) => (typeof config[k] === 'number' ? (config[k] as number) : undefined);
  return new KvStorage(kv, { maxBytes: num('maxBytes'), cacheTtl: num('cacheTtl'), lookupRetries: num('lookupRetries'), retryDelayMs: num('retryDelayMs') });
}
