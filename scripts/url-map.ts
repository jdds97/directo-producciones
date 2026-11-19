// Mapa de las 59 URLs WordPress → nuevo sitio. Fuente de verdad: config/url-map.json (decisiones por URL).
//   npm run urlmap:check            valida el mapa y sus destinos contra las rutas reales (sale con 1 si hay errores); la
//                                   cobertura contra docs/url-inventory.csv solo se comprueba si el CSV existe (sin él, CI: aviso)
//   npm run urlmap:check -- --init  crea config/url-map.json desde el inventario SOLO si no existe (nunca sobrescribe decisiones)
// Reglas: se parte de las decisiones YA tomadas (D-45: conservar/adaptar contenido; excluir abonos/tienda). No se inventa
// ningún destino por parecido; lo que no tiene destino decidido queda «pendiente». Solo las filas con `aprobado_por` redirigen.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { PAGES } from '../src/lib/seo';

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += c; }
    else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  return rows.filter(r => r.length > 4);
}
// docs/ no se versiona (.gitignore): sin el CSV (CI) se valida el mapa sin cruzarlo con el inventario.
const inventory = existsSync('docs/url-inventory.csv') || process.argv.includes('--init') ? (() => {
  const [head, ...rows] = parseCsv(readFileSync('docs/url-inventory.csv', 'utf8'));
  return rows.map(r => Object.fromEntries(head.map((k, i) => [k, r[i]])) as Record<string, string>);
})() : undefined;
const pathOf = (url: string) => new URL(url).pathname;
const keptPaths = new Set(['/', '/servicios/', '/quienes-somos/', '/contacto/', '/blog/', '/aviso-legal/']);
// Páginas con función equivalente en el sitio nuevo: se PROPONEN, no se aplican hasta que alguien las apruebe.
const equivalentProposals: Record<string, string> = { '/politica-de-cookies/': '/cookies/', '/politica-de-privacidad/': '/privacidad/', '/proyectos/': '/portfolio/' };

function initialRow(r: Record<string, string>) {
  const path = pathOf(r.url), base = { url: r.url, path, tipo: r.tipo, alcance: r.alcance_migracion };
  if (r.alcance_migracion === 'excluir_migracion')
    return { ...base, accion: 'retirar', estado: 'propuesta', codigo: 410, nota: 'D-45 excluye abonos, tienda, carrito y categorías de producto. Código 410 propuesto; falta aprobación por URL (M6.02).' };
  if (keptPaths.has(path))
    return { ...base, accion: 'conservar-ruta', estado: 'vigente', nota: 'La misma ruta existe en el sitio nuevo; el host www se normaliza al apex (D-07).' };
  if (equivalentProposals[path])
    return { ...base, accion: 'redirigir', estado: 'propuesta', destino: equivalentProposals[path], codigo: 301, nota: 'Misma función que la página nueva; propuesta sin aprobar.' };
  const why = r.tipo === 'entrada' ? 'El destino depende de si la entrada se migra a /blog/{slug}/ (migración WXR pendiente, medios sujetos a permisos).'
    : r.tipo === 'categoria' || r.tipo === 'etiqueta' || r.tipo === 'autor' ? 'El destino depende de las taxonomías/autores que cree la migración; sin ellas no hay equivalente.'
    : 'Sin equivalente decidido en el sitio nuevo; contenido por adaptar (D-45). Destino pendiente de aprobación por URL.';
  return { ...base, accion: 'pendiente', estado: 'pendiente', nota: why };
}

if (process.argv.includes('--init')) {
  if (existsSync('config/url-map.json')) { console.error('config/url-map.json ya existe: no se sobrescribe.'); process.exit(1); }
  writeFileSync('config/url-map.json', JSON.stringify({ version: 1, fuente: 'docs/url-inventory.csv', rows: inventory!.map(initialRow) }, null, 1) + '\n');
  console.log(`config/url-map.json creado con ${inventory!.length} filas.`);
  process.exit(0);
}

const { rows, patrones = [] } = JSON.parse(readFileSync('config/url-map.json', 'utf8')) as { rows: Record<string, any>[]; patrones?: Record<string, any>[] };
const errors: string[] = [];
const routes = new Set(Object.keys(PAGES));
const urls = new Set(rows.map(r => r.url));
if (urls.size !== rows.length) errors.push('Hay URLs duplicadas en el mapa.');
if (inventory) {
  for (const r of inventory) if (!urls.has(r.url)) errors.push(`Falta en el mapa: ${r.url}`);
  for (const r of rows) if (!inventory.some(i => i.url === r.url)) errors.push(`Fila que no está en el inventario: ${r.url}`);
} else console.warn('docs/url-inventory.csv no disponible: no se comprueba la cobertura del inventario.');
const sources = new Set(rows.filter(r => r.accion === 'redirigir' || r.accion === 'retirar').map(r => r.path));
for (const r of rows) {
  const id = r.path;
  if (r.aprobado_por && !/^\d{4}-\d{2}-\d{2}$/.test(r.aprobado_el ?? '')) errors.push(`${id}: aprobada sin fecha.`);
  if (r.accion === 'conservar-ruta' && !routes.has(r.path)) errors.push(`${id}: marcada «conservar-ruta» pero no existe esa ruta en el sitio nuevo.`);
  if (r.accion === 'redirigir') {
    if (r.codigo !== 301) errors.push(`${id}: redirección permanente debe ser 301.`);
    if (!r.destino || !routes.has(r.destino)) errors.push(`${id}: destino «${r.destino}» no es una ruta pública existente.`);
    if (r.destino === '/' && r.path !== '/inicio/') errors.push(`${id}: destino Inicio no permitido (no se redirige «todo a Inicio»).`);
    if (r.destino === r.path) errors.push(`${id}: redirige a sí misma.`);
    if (sources.has(r.destino)) errors.push(`${id}: cadena, el destino ${r.destino} también se redirige o retira.`);
  }
  if (r.accion === 'retirar' && (r.codigo !== 410 || r.destino)) errors.push(`${id}: retirada = 410 sin destino.`);
  if (r.accion === 'pendiente' && (r.destino || r.aprobado_por)) errors.push(`${id}: pendiente no puede tener destino ni aprobación.`);
  if (!r.nota) errors.push(`${id}: falta nota.`);
}
// Propuestas (sin aprobar) de las filas pendientes y de los patrones que no están en el inventario (/feed/, sitemap_index, /wp-content/uploads/).
const extraRoutes = new Set(['/rss.xml', '/sitemap.xml']);
// Entradas nuevas del blog (content/blog/<slug>.md): un 301 a /blog/<slug>/ solo vale si el .md existe (un typo daría 301 a 404).
const blogPosts = new Set(readdirSync('content/blog').filter(f => f.endsWith('.md')).map(f => `/blog/${f.slice(0, -3)}/`));
const proposalError = (id: string, p: any) => {
  if (!['redirigir', 'retirar'].includes(p.accion)) return `${id}: propuesta con acción «${p.accion}».`;
  if (p.accion === 'retirar') return p.codigo === 410 && !p.destino ? '' : `${id}: propuesta de retirada = 410 sin destino.`;
  const ok = p.codigo === 301 && (routes.has(p.destino) || extraRoutes.has(p.destino) || blogPosts.has(p.destino));
  return ok ? '' : `${id}: propuesta 301 con destino inválido «${p.destino}».`;
};
for (const r of rows) if (r.propuesta) { if (r.aprobado_por || r.accion !== 'pendiente') errors.push(`${r.path}: la propuesta solo va en filas pendientes sin aprobar.`); else { const e = proposalError(r.path, r.propuesta); if (e) errors.push(e); } }
for (const p of patrones) {
  if (p.aprobado_por && !/^\d{4}-\d{2}-\d{2}$/.test(p.aprobado_el ?? '')) errors.push(`${p.path}: patrón aprobado sin fecha.`);
  if (p.aprobado_por && p.accion !== 'redirigir') errors.push(`${p.path}: un patrón aprobado solo puede ser «redirigir» (ruta exacta, sin prefijos).`);
  if (p.accion === 'redirigir') { const e = proposalError(p.path, p); if (e) errors.push(e); }
}
const count = (f: (r: any) => boolean) => rows.filter(f).length;
const summary = {
  total: rows.length,
  conservarRuta: count(r => r.accion === 'conservar-ruta'),
  retirarPropuesta: count(r => r.accion === 'retirar' && !r.aprobado_por),
  redirigirPropuesta: count(r => r.accion === 'redirigir' && !r.aprobado_por),
  destinoPendiente: count(r => r.accion === 'pendiente'),
  conPropuesta: count(r => Boolean(r.propuesta)), patronesPropuestos: patrones.length,
  aprobadasActivas: count(r => r.aprobado_por && (r.accion === 'redirigir' || r.accion === 'retirar')) + patrones.filter(p => p.aprobado_por).length,
};
console.log(JSON.stringify(summary));
if (process.argv.includes('--list')) for (const r of rows.filter(x => x.accion !== 'conservar-ruta')) console.log(`${r.accion.padEnd(9)} ${r.estado.padEnd(9)} ${r.path}${r.destino ? ' → ' + r.destino : ''}`);
if (errors.length) { console.error(errors.map(e => ` - ${e}`).join('\n')); process.exit(1); }
console.log(`Mapa de URLs válido (${inventory ? `${rows.length}/${inventory.length} URLs cubiertas` : `${rows.length} URLs, sin cruzar con el inventario`}, sin cadenas, bucles ni «todo a Inicio»).`);
