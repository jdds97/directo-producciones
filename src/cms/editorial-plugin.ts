import { definePlugin, getEmDashCollection, getEmDashEntry, getTerm } from 'emdash';
import type { ContentPolicyEvent, PluginContext } from 'emdash/plugin';
import { assertReviewed } from '../lib/editorial.ts';
import { evaluatePublish, mediaDenied, managedCollections, singletonCollections, emptyRequiredFields, internalLinks, knownRoutes, listWouldBeEmpty, POST_SLUG } from '../lib/editorial-policy.ts';
import { invalidateSiteContent } from '../lib/site-content.ts';
import { SINGLETON_SLUG, collections, lists } from './contract.ts';
import { facts, isApproved } from '../lib/facts.ts';
import { env } from 'cloudflare:workers';
import { APP_ENV } from '../config/flags.ts';
import registryData from '../../.emdash/content-registry.json' with { type: 'json' };

// Aprobadores: usuarios versionados en el registro. Solo en local, ids sintéticos de una persistencia de pruebas
// (DP_SYNTHETIC_PUBLISHERS); en preview/producción esa variable se ignora.
function approverIds(): Set<string> {
  const ids = new Set(((registryData.editorialReview as { publishers: { userId: string }[] }).publishers).map(p => p.userId));
  if (APP_ENV === 'local') for (const id of ((env as unknown as Record<string, string | undefined>).DP_SYNTHETIC_PUBLISHERS ?? process.env.DP_SYNTHETIC_PUBLISHERS ?? '').split(',').map(s => s.trim()).filter(Boolean)) ids.add(id);
  return ids;
}
const stamp = () => new Date().toISOString();
async function record(ctx: PluginContext, event: ContentPolicyEvent, action: string, extra: Record<string, unknown>) {
  const id = String(event.content.id ?? event.content.slug ?? '');
  const entry = { at: stamp(), action, collection: event.collection, id, slug: event.content.slug ?? null, actor: event.actor?.id ?? null, role: event.actor?.role ?? null, ...extra };
  await ctx.kv.set(`decision:${entry.at}:${event.collection}:${id}`, entry);
  ctx.log.info(`[dp-editorial] ${action} ${event.collection}/${id}`, entry);
}


// Portada «Directo» del panel: estado del contenido y datos aprobados (solo lectura). EmDash 1.1.0 no permite tema propio:
// esto es lo máximo soportado sin tocar el núcleo (marca nativa en astro.config + página y widget de plugin en Block Kit).
async function panelBlocks(ctx: PluginContext, page: string) {
  const rows: { nombre: string; estado: string; edita: string }[] = [];
  for (const def of [...collections, ...lists]) {
    const list = await ctx.content?.list(def.slug, { limit: 100 }).catch(() => null);
    const items = (list?.items ?? []) as { status?: string; updatedAt?: string }[];
    const published = items.filter(i => i.status === 'published').length;
    rows.push({ nombre: def.label, estado: items.length ? `${published}/${items.length} publicadas` : 'sin entradas', edita: items.length ? 'Panel › Contenido' : '—' });
  }
  const pending = rows.filter(r => /^0\//.test(r.estado)).length;
  const approved = facts.filter(isApproved);
  const blocks: unknown[] = [
    { type: 'header', text: 'Directo Producciones · Inicio del equipo' },
    { type: 'context', text: 'Aquí se editan los textos, las fotos (portadas, secciones, retratos, logotipos y pósters) y el equipo. La estructura, la maquetación, los vídeos, la marca y los datos aprobados se cambian por pull request.' },
    { type: 'stats', items: [{ label: 'Páginas y listas', value: String(rows.length) }, { label: 'Sin publicar', value: String(pending) }, { label: 'Hechos aprobados', value: `${approved.length}/${facts.length}` }] },
    { type: 'table', columns: [{ key: 'nombre', label: 'Contenido' }, { key: 'estado', label: 'Estado' }, { key: 'edita', label: 'Dónde editar' }], rows, page_action_id: 'noop', empty_text: 'Sin contenido' },
  ];
  if (page.includes('inicio')) {
    blocks.push({ type: 'divider' }, { type: 'header', text: 'Datos aprobados (solo lectura)' },
      { type: 'table', columns: [{ key: 'id', label: 'Hecho' }, { key: 'estado', label: 'Estado' }], rows: facts.map(f => ({ id: f.id, estado: isApproved(f) ? 'Aprobado' : f.status })), page_action_id: 'noop', empty_text: '—' },
      { type: 'context', text: 'Para cambiar un dato aprobado: retirar su aprobación en content/facts.yaml, cambiarlo y aprobarlo de nuevo por una persona distinta (pull request). El panel no puede escribirlo.' });
  }
  return { blocks };
}

const listSlugs = new Set(lists.map(l => l.slug));
// Fichas publicadas tal y como las lee la web (site-content): sin respaldo de semilla.
async function publishedRows(collection: string): Promise<{ id: string; visible?: unknown }[]> {
  const result = await getEmDashCollection(collection, { status: 'published', limit: 500 });
  if (result.error) throw result.error;
  return result.entries.map(e => ({ id: String(e.id), visible: (e.data as Record<string, unknown>).visible }));
}
const emptyListReason = (collection: string) => `«${lists.find(l => l.slug === collection)?.label ?? collection}» no puede quedarse sin fichas visibles: la página se quedaría vacía o caería. Edita la ficha en lugar de retirarla.`;
/** Reglas estructurales al publicar (además de evaluatePublish): una sola entrada por página, campos llenos, slugs, enlaces y listas. */
async function structuralReasons(event: ContentPolicyEvent, data: Record<string, unknown>): Promise<string[]> {
  const reasons: string[] = [];
  const slug = typeof event.content.slug === 'string' ? event.content.slug : '';
  if (singletonCollections.has(event.collection)) {
    if (slug !== SINGLETON_SLUG) reasons.push(`Solo se publica la entrada «${SINGLETON_SLUG}» de cada página.`);
    const empty = emptyRequiredFields(event.collection, data);
    if (empty.length) reasons.push(`Campos obligatorios vacíos (la página dejaría de funcionar): ${empty.join(', ')}.`);
  }
  if (event.collection === 'posts') {
    if (!POST_SLUG.test(slug)) reasons.push('Slug no válido: solo minúsculas, números y guiones (sin acentos ni espacios).');
    for (const link of internalLinks(data.content)) {
      const ok = link.kind === 'route' ? knownRoutes.has(link.slug)
        : link.kind === 'post' ? link.slug === slug || Boolean(await getEmDashEntry('posts', link.slug).then(r => r.entry && !r.isPreview).catch(() => false))
        : Boolean(await getTerm(link.kind, link.slug).catch(() => null));
      if (!ok) reasons.push(`Enlace interno roto: ${link.href}`);
    }
  }
  if (listSlugs.has(event.collection)) {
    const visible = data.visible !== false && data.visible !== 0;
    if (listWouldBeEmpty(await publishedRows(event.collection), slug, visible)) reasons.push(emptyListReason(event.collection));
  }
  return reasons;
}

export function createPlugin() {
  const gate = async (event: ContentPolicyEvent, ctx: PluginContext) => {
    try {
      if (!event.actor || event.origin.source !== 'api') throw new Error('Solo publicación manual desde el panel o la API autenticada.');
      const data = event.content.data as Record<string, unknown> | undefined ?? (event.content as Record<string, unknown>);
      let legacyReview = false;
      try { if (typeof event.content.slug === 'string') legacyReview = Boolean(assertReviewed(event.content.slug, { data, seo: event.content.seo ?? null }, event.actor.id)); } catch { /* sin revisión heredada */ }
      const decision = evaluatePublish({ collection: event.collection, data, actor: event.actor, approverIds: approverIds(), legacyReview, local: APP_ENV === 'local' });
      const structural = await structuralReasons(event, data);
      if (structural.length) { decision.allow = false; decision.reasons.push(...structural); }
      if (!decision.allow) { await record(ctx, event, 'publish-denied', { reasons: decision.reasons }).catch(() => {}); return { cancel: true as const, reason: decision.reasons.join(' ') }; }
      await record(ctx, event, 'publish-allowed', { klass: decision.klass, claims: decision.claims, factIds: decision.factIds, digest: decision.digest });
    } catch (error) {
      return { cancel: true as const, reason: error instanceof Error ? error.message : 'Publicación denegada.' };
    }
  };
  const refresh = async (event: { collection: string }) => { invalidateSiteContent(event.collection); };
  return definePlugin({
    id: 'dp-editorial-policy', version: '0.3.0',
    // content:read/write y media:write son los requisitos de EmDash para registrar estos hooks; el plugin no usa ctx.content ni ctx.media.
    capabilities: ['hooks.content-policy:register', 'hooks.email-events:register', 'content:read', 'content:write', 'media:write'],
    admin: { pages: [{ path: '/inicio', label: 'Inicio del equipo', icon: 'house' }], widgets: [{ id: 'estado', title: 'Estado del contenido', size: 'full' }] },
    routes: { admin: { permission: 'content:read_drafts', handler: async (rc) => panelBlocks(rc, (rc.input as { page?: string } | undefined)?.page ?? 'widget') } },
    hooks: {
      'content:beforePublish': { errorPolicy: 'abort', handler: gate },
      'content:beforeUnpublish': { errorPolicy: 'abort', handler: async (event: ContentPolicyEvent, ctx: PluginContext) => {
        // Retirar una página del sitio la deja sin contenido (fuera de local, error en esa ruta o en toda la web): nadie, tampoco administración.
        if (singletonCollections.has(event.collection)) {
          await record(ctx, event, 'unpublish-denied', {}).catch(() => {});
          return { cancel: true as const, reason: 'Las páginas del sitio no se retiran: edita su contenido y publica.' };
        }
        if (listSlugs.has(event.collection) && listWouldBeEmpty(await publishedRows(event.collection), String(event.content.slug ?? ''), null)) {
          await record(ctx, event, 'unpublish-denied', {}).catch(() => {});
          return { cancel: true as const, reason: emptyListReason(event.collection) };
        }
        if (managedCollections.has(event.collection)) await record(ctx, event, 'unpublish', {}).catch(() => {});
      } },
      'content:beforeSchedule': async () => ({ cancel: true, reason: 'Publicación programada fuera del alcance aprobado.' }),
      // Colecciones de una sola entrada: la semilla crea «main»; no se admiten más ni se pueden borrar.
      'content:beforeSave': { errorPolicy: 'abort', handler: async (event: { collection: string; isNew: boolean; content: Record<string, unknown> }) => {
        // `content` es solo `data` (sin slug): la semilla crea «main» sin hooks, así que cualquier alta por la API es una segunda entrada.
        if (singletonCollections.has(event.collection) && event.isNew) throw new Error(`«${event.collection}» admite una sola entrada («${SINGLETON_SLUG}»).`);
      } },
      'content:beforeDelete': { errorPolicy: 'abort', handler: async (event: { id: string; collection: string }, ctx: PluginContext) => {
        if (singletonCollections.has(event.collection)) return false;
        if (!listSlugs.has(event.collection)) return undefined;
        // Papelera de una ficha: la lista no puede quedarse sin fichas visibles publicadas.
        const item = await ctx.content?.get(event.collection, event.id).catch(() => null);
        return item?.status === 'published' && listWouldBeEmpty(await publishedRows(event.collection), String(item.slug ?? ''), null) ? false : undefined;
      } },
      'content:afterPublish': refresh, 'content:afterUnpublish': refresh, 'content:afterRestore': refresh, 'content:afterDelete': refresh,
      'media:beforeUpload': { errorPolicy: 'abort', handler: async (event: { file: { name: string; type: string; size: number } }) => {
        const denied = mediaDenied(event.file);
        if (denied) throw new Error(denied);
      } },
      'email:beforeSend': { errorPolicy: 'abort', handler: async () => false },
    },
  });
}
