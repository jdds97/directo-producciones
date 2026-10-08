import { APP_ENV } from '../config/flags';
import registryData from '../../.emdash/content-registry.json' with { type: 'json' };

export interface Fact {
  id: string;
  value: string;
  status: 'approved' | 'decided' | 'published_by_company' | 'pending' | 'rejected';
  source: string;
  evidence: string | null;
  approved_by: string | null;
  approved_at: string | null;
  required_for_launch: boolean;
}
interface Approver { nombre: string; ambito: string }
const registry = registryData as { facts?: Fact[]; approvers?: { approvers: Approver[] } };
export const facts = registry.facts ?? [];
export const approvers = registry.approvers?.approvers ?? [];
export const forbiddenText = /\b(?:TODO|PENDING|lorem|example\.com)\b|\+34-600-000-000|sin cortes|100\s*%|líderes|mejor precio|garantizamos/i;
function validApprovalDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value && timestamp <= Date.now();
}
function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
export function isApproved(fact: Fact): boolean {
  return fact.status === 'approved' && typeof fact.value === 'string' && nonEmptyString(fact.source) &&
    !forbiddenText.test(fact.value) &&
    nonEmptyString(fact.evidence) && validApprovalDate(fact.approved_at) &&
    typeof fact.approved_by === 'string' && approvers.some(person => person.nombre === fact.approved_by && person.ambito === 'facts');
}
export function approvedFact(id: string): Fact | undefined {
  return facts.find(fact => fact.id === id && isApproved(fact));
}
export function visibleFact(id: string): Fact | undefined {
  const fact = facts.find(item => item.id === id);
  if (!fact) return undefined;
  if (typeof fact.value !== 'string' || forbiddenText.test(fact.value)) return undefined;
  if (isApproved(fact)) return fact;
  if (APP_ENV === 'preview' && (fact.status === 'decided' || fact.status === 'published_by_company') &&
      !id.startsWith('social_proof.') && !id.startsWith('sla.')) return fact;
  return undefined;
}
export function validateFacts(): string[] {
  const errors: string[] = [];
  if (!facts.length || !approvers.length) errors.push('Faltan facts.yaml/approvers.yaml vigentes para integrar el guard.');
  const validStatuses = new Set(['approved', 'decided', 'published_by_company', 'pending', 'rejected']);
  const ids = new Set<string>();
  for (const fact of facts) {
    if (!fact || typeof fact !== 'object') {
      errors.push('Cada fact debe ser un registro.');
      continue;
    }
    if (!fact.id || ids.has(fact.id)) errors.push(`Fact ID ausente o duplicado: ${fact.id}`);
    ids.add(fact.id);
    if (!validStatuses.has(fact.status)) errors.push(`Estado de fact inválido: ${fact.id}`);
    const previewVisible = APP_ENV === 'preview' &&
      (fact.status === 'decided' || fact.status === 'published_by_company') &&
      !fact.id.startsWith('social_proof.') && !fact.id.startsWith('sla.');
    if ((fact.status === 'approved' || previewVisible) &&
        typeof fact.value === 'string' && forbiddenText.test(fact.value)) {
      errors.push(`Placeholder o claim prohibido en fact visible: ${fact.id}`);
    }
    if (fact.status === 'approved' && !isApproved(fact)) errors.push(`Aprobación inválida: ${fact.id}`);
    if (fact.status !== 'approved' && (fact.approved_by != null || fact.approved_at != null)) errors.push(`Aprobación residual en fact no aprobado: ${fact.id}`);
    if (APP_ENV === 'production' && fact.required_for_launch && !isApproved(fact)) errors.push(`Necesario para lanzamiento sin aprobar: ${fact.id}`);
  }
  return errors;
}
export function factsApprovers(): string[] {
  return approvers.filter(person => person.ambito === 'facts').map(person => person.nombre);
}
export function assertApprovedReferences(ids: string[]): void {
  for (const id of ids) if (!approvedFact(id)) throw new Error(`Fact sin aprobación válida: ${id}`);
}
