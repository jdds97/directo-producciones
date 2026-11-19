// Genera derivados WebP responsive junto a los originales con `sharp` (ya instalado por Astro). NUNCA borra ni modifica un original;
// no sobrescribe un derivado existente salvo con --force. Lista cerrada: solo lo que las páginas usan de verdad.
//   node scripts/media-derive.mjs [--force]      después: node scripts/media-derive.mjs --manifest   (imprime sha256 para config/m4-assets.json)
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const root = 'public/assets/m4';
// [origen relativo a root, [[sufijo, ancho máximo]], calidad]
const JOBS = JSON.parse(readFileSync('config/media-derivatives.json', 'utf8')).jobs;
const force = process.argv.includes('--force');
const out = [];
for (const [src, sizes, quality = 78] of JOBS) {
  const input = `${root}/${src}`;
  if (!existsSync(input)) { console.error(`falta ${input}`); process.exitCode = 1; continue; }
  const meta = await sharp(input).metadata();
  for (const [suffix, width] of sizes) {
    const dest = `${root}/${src.replace(/\.[^.]+$/, '')}-${suffix}.webp`;
    if (!existsSync(dest) || force) {
      await sharp(input).rotate().resize({ width: Math.min(width, meta.width), withoutEnlargement: true }).webp({ quality, effort: 5 }).toFile(dest);
    }
    const info = await sharp(dest).metadata();
    out.push({ file: dest.replace('public', ''), width: info.width, height: info.height, bytes: readFileSync(dest).length, sha256: createHash('sha256').update(readFileSync(dest)).digest('hex') });
  }
}
if (process.argv.includes('--manifest')) console.log(JSON.stringify(Object.fromEntries(out.map(o => [o.file, o.sha256])), null, 2));
else for (const o of out) console.log(`${String(o.bytes).padStart(8)} B  ${o.width}×${o.height}  ${o.file}`);
