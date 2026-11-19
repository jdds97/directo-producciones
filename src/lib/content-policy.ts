import { approvedFact, forbiddenText } from './facts';
// Avisos de revisión, de maqueta o de texto por redactar: solo pueden ir dentro de <ReviewNote>, que no pinta nada en producción.
// Con límites de palabra: «maqueta» es un aviso; «maquetación» (diseño de página) no.
export const reviewMarkerText = /\b(?:revisi[oó]n local|versi[oó]n local|vista previa privada|provisional(?:es)?|maquetas?|se simula(?:n|r[aá]?n?)?|simulad(?:[oa]s?|amente)|plantilla de dise[nñ]o|pendientes? de (?:revisi[oó]n|redactar|definir|identificar|documentar)|deben? (?:redactarse|revisarse|validarse)|falta documentar|antes de (?:su )?publica(?:r(?:l[oa]s?)?|ci[oó]n))\b/i;
/** Primer aviso de revisión del marcado de un .astro (sin frontmatter ni estilos) que queda fuera de <ReviewNote>. */
export function unguardedReviewMarker(source: string): string | undefined {
  return source.replace(/^---[\s\S]*?---/, '').replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<ReviewNote\b[^>]*>[\s\S]*?<\/ReviewNote>/g, '').match(reviewMarkerText)?.[0];
}
export function contentErrors(text: string, references: string[]): string[] {
  const errors: string[] = [];
  if (forbiddenText.test(text)) errors.push('Texto prohibido o marcador provisional.');
  for (const id of references) if (!approvedFact(id)) errors.push(`Fact sin aprobación válida: ${id}`);
  const approvedValues = references.map(id => approvedFact(id)?.value ?? '').filter(Boolean);
  let unreferenced = text;
  for (const value of approvedValues) unreferenced = unreferenced.replaceAll(value, '');
  if (/\d|[%€$£]/u.test(unreferenced)) errors.push('Cifra, año, porcentaje o precio sin referencia literal aprobada.');
  const productionScope = approvedFact('service.production_scope_review');
  const imagIsInApprovedScope = references.includes('service.production_scope_review') &&
    Boolean(productionScope?.value && /\bIMAG\b/i.test(productionScope.value));
  if (/bonding|starlink|congresos|traducción/i.test(text) ||
      (/\bIMAG\b/i.test(text) && !imagIsInApprovedScope)) {
    errors.push('Servicio o garantía fuera del catálogo local autorizado.');
  }
  return errors;
}
