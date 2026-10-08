import { fileURLToPath } from 'node:url';
import emdash from 'emdash/astro';

// EmDash 1.1.0 initializes its database even for corporate routes. Scope every
// injected middleware, including setup/auth, instead of relying on prerendering.
export default function blogCms(options) {
  const integration = emdash({ ...options, plugins: [{
    id: 'dp-editorial-policy', version: '0.1.0', format: 'native',
    entrypoint: fileURLToPath(new URL('../src/cms/editorial-plugin.ts', import.meta.url)),
  }] });
  const original = integration.hooks['astro:config:setup'];
  const wrappers = {
    'emdash/middleware': 'runtime',
    'emdash/internal/middleware/redirect': 'redirect',
    'emdash/internal/middleware/setup': 'setup',
    'emdash/internal/middleware/auth': 'auth',
    'emdash/internal/middleware/media-usage-write-fence': 'media',
    'emdash/internal/middleware/request-context': 'context',
  };
  integration.hooks['astro:config:setup'] = async function (context) {
    context.addMiddleware({
      entrypoint: fileURLToPath(new URL('../src/cms/local-gate.ts', import.meta.url)), order: 'pre',
    });
    return original.call(this, { ...context, addMiddleware(entry) {
      const name = wrappers[entry.entrypoint];
      if (!name) throw new Error(`Middleware EmDash sin alcance revisado: ${entry.entrypoint}`);
      context.addMiddleware({ ...entry, entrypoint: fileURLToPath(new URL(`../src/cms/middleware/${name}.ts`, import.meta.url)) });
    } });
  };
  return integration;
}
