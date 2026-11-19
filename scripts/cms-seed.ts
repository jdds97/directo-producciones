// Genera desde el contrato (src/cms/contract.ts) las colecciones de seed/seed.json y los borradores
// iniciales seed/content-drafts.json. Idempotente. `--check` no escribe: falla si hay deriva.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { collections, lists, SINGLETON_SLUG, type CollectionDef } from '../src/cms/contract.ts';
import { contractErrors } from '../src/cms/contract-check.ts';
import { clientSeeds, projectSeeds, teamSeeds, bandSeeds } from '../src/cms/list-seeds.ts';
import { MEDIA_LIMITS } from '../src/lib/editorial-policy.ts';

const draft = JSON.parse(readFileSync('src/content/m4-draft.json', 'utf8')) as { blocks: Record<string, Record<string, string>> };
export const defaultOf = (col: CollectionDef, f: CollectionDef['fields'][number]): string =>
  f.default ?? draft.blocks[f.block ?? col.block]?.[f.key] ?? '';
const textLike = (v: string) => v.length > 90 || v.includes('\n');
// Límite de diseño: la longitud actual más un margen; protege las composiciones sin cortar texto del editor.
const maxFor = (v: string) => Math.max(40, Math.ceil((v.length * 1.6 + 16) / 10) * 10);

export function buildSeed() {
  const errors = contractErrors(draft.blocks);
  if (errors.length) throw new Error(`Contrato inválido:\n${errors.join('\n')}`);
  const base = JSON.parse(readFileSync('seed/seed.json', 'utf8'));
  const generated = [
    ...collections.map(col => ({
      slug: col.slug, label: col.label, labelSingular: col.labelSingular, icon: col.icon, sortOrder: col.sortOrder,
      group: col.kind === 'legal' ? 'Legal' : 'Páginas', routable: false, hidden: false, titleField: 'title', editLocking: true,
      supports: ['drafts', 'revisions', 'seo'], commentsEnabled: false,
      fields: [
        { slug: 'title', label: 'Nombre interno de la página', type: 'string', required: true, validation: { maxLength: 80 } },
        ...col.fields.map(f => {
          const v = defaultOf(col, f);
          if (f.type) return { slug: f.slug, label: f.label, type: f.type, required: false, validation: f.type === 'image' ? { allowedMimeTypes: MEDIA_LIMITS.types } : f.type === 'file' ? { allowedMimeTypes: MEDIA_LIMITS.videoTypes } : f.type === 'select' ? { options: f.options } : {} };
          return { slug: f.slug, label: f.label, type: textLike(v) ? 'text' : 'string', required: false, validation: { maxLength: f.media === 'alt' ? 200 : f.media === 'rights' ? 200 : maxFor(v) } };
        }),
      ],
    })),
    ...lists.map(l => ({
      slug: l.slug, label: l.label, labelSingular: l.labelSingular, icon: l.icon, sortOrder: l.sortOrder,
      group: 'Contenido', routable: false, titleField: l.titleField, supports: ['drafts', 'revisions'], commentsEnabled: false,
      fields: l.fields.map(f => ({
        slug: f.slug, label: f.label, type: f.type, required: Boolean(f.required),
        validation: { ...(f.max ? { maxLength: f.max } : {}), ...(f.pattern ? { pattern: f.pattern } : {}), ...(f.options ? { options: f.options } : {}), ...(f.type === 'image' ? { allowedMimeTypes: MEDIA_LIMITS.types } : {}), ...(f.type === 'file' ? { allowedMimeTypes: MEDIA_LIMITS.videoTypes } : {}) },
      })),
    })),
  ];
  const posts = base.collections.filter((c: { slug: string }) => c.slug === 'posts');
  const seed = { ...base, collections: [...posts, ...generated] };
  const content: Record<string, unknown[]> = {};
  for (const col of collections) {
    content[col.slug] = [{ id: `${col.slug}:${SINGLETON_SLUG}`, slug: SINGLETON_SLUG, status: 'draft',
      data: { title: col.label, ...Object.fromEntries(col.fields.filter(f => f.type !== 'image' && f.type !== 'file').map(f => [f.slug, f.type === 'boolean' ? defaultOf(col, f) === 'true' : defaultOf(col, f)])) } }];
  }
  content.clients = clientSeeds.map((c, i) => ({ id: `clients:${i + 1}`, slug: `cliente-${i + 1}`, status: 'draft', data: { ...c, visible: true, rights_ok: false, rights_source: '' } }));
  content.band_logos = bandSeeds.map((c, i) => ({ id: `band_logos:${i + 1}`, slug: `logo-${i + 1}`, status: 'draft', data: { ...c, visible: true, rights_ok: false, rights_source: '' } }));
  content.team = teamSeeds.map(({ slug, ...c }, i) => ({ id: `team:${i + 1}`, slug, status: 'draft', data: { ...c, visible: true, rights_ok: false, rights_source: '' } }));
  content.projects = projectSeeds.map((p, i) => ({ id: `projects:${i + 1}`, slug: `proyecto-${p.video_key}`, status: 'draft', data: { ...p, visible: true, rights_ok: false, rights_source: '' } }));
  // Microcopy fijo (código): claves del borrador que el contrato no declara editables, sin bloques internos.
  const claimed = new Set(collections.flatMap(col => col.fields.map(f => `${f.block ?? col.block}.${f.key}`)));
  const microcopy: Record<string, Record<string, string>> = {};
  for (const [block, values] of Object.entries(draft.blocks)) {
    if (['Guia', 'GuiaDark', 'Testimonials'].includes(block)) continue;
    const keep = Object.entries(values).filter(([key]) => !claimed.has(`${block}.${key}`));
    if (keep.length) microcopy[block] = Object.fromEntries(keep);
  }
  return { microcopy, seed, drafts: { version: '1', meta: { name: 'Borradores iniciales de contenido corporativo', note: 'Generado por scripts/cms-seed.ts; no publicar sin revisión editorial.' }, content } };
}

if (process.argv[1]?.endsWith('cms-seed.ts')) {
  const { seed, drafts, microcopy } = buildSeed();
  const next = [['seed/seed.json', JSON.stringify(seed, null, 2) + '\n'], ['seed/content-drafts.json', JSON.stringify(drafts, null, 2) + '\n'], ['src/content/microcopy.json', JSON.stringify(microcopy, null, 1) + '\n']] as const;
  if (process.argv.includes('--check')) {
    const stale = next.filter(([file, text]) => !existsSync(file) || readFileSync(file, 'utf8') !== text).map(([file]) => file);
    if (stale.length) { console.error(`Deriva entre contrato y seed: ${stale.join(', ')}. Ejecuta npx tsx scripts/cms-seed.ts`); process.exit(1); }
    console.log('cms-seed: contrato y seed coinciden');
  } else {
    for (const [file, text] of next) writeFileSync(file, text);
    console.log(`cms-seed: ${collections.length} páginas + ${lists.length} listas, ${collections.reduce((n, c) => n + c.fields.length, 0)} campos`);
  }
}
