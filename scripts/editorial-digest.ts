import { readFileSync, existsSync } from 'node:fs';
if (process.argv.length !== 3) throw new Error('Uso: npm run editorial:digest -- ruta-al-json-local-de-la-entrada');
if (existsSync('.env')) process.loadEnvFile('.env');
const { contentDigest } = await import('../src/lib/editorial.ts');
const payload = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const item = payload.data?.item ?? payload.item ?? payload;
if (typeof item.slug !== 'string' || !item.data || item.data.synthetic !== true) {
  throw new Error('Se requiere una entrada sintética local con slug y data.');
}
process.stdout.write(JSON.stringify({ slug: item.slug, digest: contentDigest({ data: item.data, seo: item.seo ?? null }) }) + '\n');
