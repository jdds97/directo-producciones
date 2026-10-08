import { definePlugin } from 'emdash';
import type { ContentPolicyEvent } from 'emdash/plugin';
import { assertReviewed } from '../lib/editorial.ts';
import { contentErrors } from '../lib/content-policy.ts';
import { APP_ENV } from '../config/flags.ts';

function portableText(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value.flatMap(block => {
    if (!block || typeof block !== 'object' || block._type !== 'block') throw new Error('Medios y embeds pendientes de B5.');
    return Array.isArray(block.children) ? block.children.map((span: { text?: string }) => span.text ?? '') : [];
  }).join(' ');
}
export function createPlugin() {
  const gate = async (event: ContentPolicyEvent) => {
    try {
      if (event.collection !== 'posts' || !event.actor || event.origin.source !== 'api') throw new Error('Solo publicación manual autorizada del blog.');
      if (typeof event.content.slug !== 'string') throw new Error('Slug editorial inválido.');
      const data = event.content.data as Record<string, unknown>;
      // EmDash maps D1 boolean fields to 0/1 in hydrated content records.
      const syntheticLocal = APP_ENV === 'local' && (data.synthetic === true || data.synthetic === 1);
      if (!syntheticLocal) throw new Error('M2 solo autoriza publicación sintética local.');
      if (data.featured_image) throw new Error('Medios pendientes de B5.');
      // The local synthetic CMS permission exercise is not a company content approval.
      const factIds = syntheticLocal
        ? []
        : assertReviewed(event.content.slug, { data, seo: event.content.seo ?? null }, event.actor.id).factIds;
      const errors = contentErrors([data.title, data.excerpt, portableText(data.content)].join(' '), factIds);
      if (errors.length) throw new Error(errors.join(' '));
    } catch (error) {
      return { cancel: true as const, reason: error instanceof Error ? error.message : 'Publicación denegada.' };
    }
  };
  return definePlugin({
    id: 'dp-editorial-policy', version: '0.1.0',
    capabilities: ['hooks.content-policy:register', 'hooks.email-events:register'],
    hooks: {
      'content:beforePublish': { errorPolicy: 'abort', handler: gate },
      'content:beforeSchedule': async () => ({ cancel: true, reason: 'Publicación programada fuera del alcance aprobado.' }),
      'email:beforeSend': { errorPolicy: 'abort', handler: async () => false },
    },
  });
}
