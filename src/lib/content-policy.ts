import { approvedFact, forbiddenText } from './facts';
export function contentErrors(text: string, references: string[]): string[] {
  const errors: string[] = [];
  if (forbiddenText.test(text)) errors.push('Texto prohibido o marcador provisional.');
  for (const id of references) if (!approvedFact(id)) errors.push(`Fact sin aprobación válida: ${id}`);
  const approvedValues = references.map(id => approvedFact(id)?.value ?? '').filter(Boolean);
  let unreferenced = text;
  for (const value of approvedValues) unreferenced = unreferenced.replaceAll(value, '');
  if (/\d|[%€$£]/u.test(unreferenced)) errors.push('Cifra, año, porcentaje o precio sin referencia literal aprobada.');
  if (/bonding|starlink|congresos|\bIMAG\b|traducción/i.test(text)) errors.push('Servicio o garantía fuera del catálogo local autorizado.');
  return errors;
}
