import { approvedFact } from './facts';
import { CANONICAL_ORIGIN } from '../config/flags';
export function organizationSchema(): Record<string, unknown> {
  const organization: Record<string, unknown> = {
    '@type': 'Organization', '@id': `${CANONICAL_ORIGIN}/#organization`,
    url: `${CANONICAL_ORIGIN}/`,
  };
  const legalName = approvedFact('entity.legal_name');
  if (legalName) organization.legalName = legalName.value;
  for (const [id, property] of [['contact.email', 'email'], ['contact.public_phone', 'telephone'], ['entity.tax_id', 'taxID']]) {
    const fact = approvedFact(id);
    if (fact) organization[property] = fact.value;
  }
  return { '@context': 'https://schema.org', '@graph': [organization] };
}
export function serializeSchema(schema: Record<string, unknown>): string {
  return JSON.stringify(schema).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
