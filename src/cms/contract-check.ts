import { collections, lists, fixedKeys } from './contract.ts';
import { videoRegistry } from '../lib/media-registry.ts';

/** Devuelve los errores del contrato frente al borrador: claves sin clasificar, duplicadas o inexistentes. */
export function contractErrors(blocks: Record<string, Record<string, string>>): string[] {
  const errors: string[] = [];
  const seen = new Map<string, string>();
  const slugs = new Set<string>();
  const claim = (block: string, key: string, owner: string) => {
    if (!(block in blocks) || !(key in blocks[block])) { errors.push(`${owner}: ${block}.${key} no existe en el borrador`); return; }
    const id = `${block}.${key}`;
    if (seen.has(id)) errors.push(`${id} tiene dos fuentes: ${seen.get(id)} y ${owner}`);
    seen.set(id, owner);
  };
  for (const col of collections) {
    if (slugs.has(col.slug)) errors.push(`Colección duplicada: ${col.slug}`);
    slugs.add(col.slug);
    const fieldSlugs = new Set<string>();
    for (const f of col.fields) {
      if (!/^[a-z][a-z0-9_]*$/.test(f.slug) || ['title', 'slug', 'id', 'status', 'content'].includes(f.slug)) errors.push(`${col.slug}.${f.slug}: slug inválido`);
      if (fieldSlugs.has(f.slug)) errors.push(`${col.slug}.${f.slug} duplicado`);
      fieldSlugs.add(f.slug);
      if (f.default === undefined) claim(f.block ?? col.block, f.key, `${col.slug}.${f.slug}`);
    }
  }
  for (const col of collections) for (const slot of col.videos ?? []) {
    if (!Object.hasOwn(videoRegistry, slot.ref)) errors.push(`${col.slug}.${slot.slug}: el vídeo por defecto «${slot.ref}» no está en la biblioteca de vídeos`);
  }
  for (const list of lists) {
    const seen = new Set<string>();
    for (const f of list.fields) {
      if (!/^[a-z][a-z0-9_]*$/.test(f.slug) || ['title', 'slug', 'id', 'status', 'content'].includes(f.slug)) errors.push(`${list.slug}.${f.slug}: slug inválido`);
      if (seen.has(f.slug)) errors.push(`${list.slug}.${f.slug} duplicado`);
      seen.add(f.slug);
    }
  }
  for (const fx of fixedKeys) for (const key of fx.keys) claim(fx.block, key, 'fijo');
  for (const [block, values] of Object.entries(blocks)) for (const key of Object.keys(values)) {
    if (!seen.has(`${block}.${key}`)) errors.push(`${block}.${key} sin clasificar (ni editable ni fijo)`);
  }
  return errors;
}
