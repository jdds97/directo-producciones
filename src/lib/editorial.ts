import { createHash } from 'node:crypto';
import { assertApprovedReferences, factsApprovers } from './facts.ts';
import registryData from '../../.emdash/content-registry.json' with { type: 'json' };

interface Publisher { userId: string; approver: string }
interface Review { slug: string; digest: string; approvedBy: string; approvedAt: string; evidence: string; factIds: string[]; rightsEvidence: string }
interface Registry { publishers: Publisher[]; reviews: Review[] }
export function contentDigest(value: unknown): string {
  const stable = (item: unknown): unknown => Array.isArray(item) ? item.map(stable) : item && typeof item === 'object' ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)])) : item;
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}
export function assertReviewed(slug: string, data: unknown, actorId?: string): Review {
  const registry = registryData.editorialReview as Registry;
  const names = factsApprovers();
  const review = registry.reviews.find(r => r.slug === slug && r.digest === contentDigest(data));
  if (!review || !names.includes(review.approvedBy) || !review.evidence?.trim() || !review.rightsEvidence?.trim() || !Number.isFinite(Date.parse(review.approvedAt)) || Date.parse(review.approvedAt) > Date.now()) throw new Error('Falta revisión autorizada del contenido exacto y sus derechos.');
  if (actorId && !registry.publishers.some(p => p.userId === actorId && p.approver === review.approvedBy && names.includes(p.approver))) throw new Error('Usuario editorial sin correspondencia autorizada con el aprobador.');
  if (!Array.isArray(review.factIds)) throw new Error('La revisión debe declarar las referencias a hechos, incluso si no contiene claims.');
  assertApprovedReferences(review.factIds);
  return review;
}
