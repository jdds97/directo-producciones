import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parse } from 'yaml';
if (existsSync('.env')) process.loadEnvFile('.env');
const { APP_ENV, CANONICAL_ORIGIN } = await import('../src/config/flags');
const { facts, isApproved, validateFacts, forbiddenText } = await import('../src/lib/facts');
const { contentErrors } = await import('../src/lib/content-policy');

const errors = validateFacts();
if (APP_ENV !== 'local') errors.push('La integración M4 solo autoriza runtime local; no publicar copy en revisión.');
const m4Assets = JSON.parse(readFileSync('config/m4-assets.json', 'utf8')) as Record<string, string>;
const draft = JSON.parse(readFileSync('src/content/m4-draft.json', 'utf8'));
if (draft.status !== 'draft') errors.push('El copy M4 debe conservarse como borrador.');
const draftGate = readFileSync('src/lib/m4-draft.ts', 'utf8');
if (!draftGate.includes("APP_ENV !== 'local'")) errors.push('Falta el gate local del copy M4.');
const contactSource = readFileSync('src/components/m4/Contacto.astro', 'utf8');
if (/<form[^>]*(?:action|method)=/i.test(contactSource) || !contactSource.includes('data-disabled-form') ||
    /<button[^>]*type="submit"/i.test(contactSource) || !/<button[^>]*disabled/.test(contactSource)) {
  errors.push('Contacto debe conservar el envío deshabilitado y sin destino.');
}
const editorial = JSON.parse(readFileSync('config/m4-editorial.json', 'utf8'));
const approvedHeroFields: Record<string, string> = {
  'Inicio/hero/rótulo': draft.blocks.Home.t001,
  'Inicio/H1': [draft.blocks.Home.t002, draft.blocks.Home.t003, draft.blocks.Home.homeH1Line3].join(' '),
  'Inicio/hero/párrafo': draft.blocks.Home.t004,
  'Inicio/hero/CTA/streaming': draft.blocks.Home.t005,
  'Inicio/hero/CTA/comunicación-marketing': draft.blocks.Home.t006,
};
if (editorial.approved.length !== Object.keys(approvedHeroFields).length ||
    editorial.approved.some((item: { scope: string; text: string; factsApproval: boolean; publicationAuthorized: boolean }) =>
      item.text !== approvedHeroFields[item.scope] || item.factsApproval !== false || item.publicationAuthorized !== false)) {
  errors.push('La aprobación editorial se limita a los campos exactos del hero de Inicio.');
}
const routesRequiringLocalGate = new Set([
  'src/pages/index.astro',
  'src/pages/streaming.astro',
  'src/pages/comunicacion-marketing.astro',
]);
// D-36 autoriza estas dos entregas en local, no cualquier archivo con el mismo nombre.
const localImages: Record<string, string> = {
  ...(APP_ENV === 'local' ? m4Assets : {}),
  '/assets/logo.jpg': '05a81cfb1c107d94c3e888888e49fcb65d27d4f13643c75b65680ebd161a38c7',
  '/assets/portada-facebook.jpg': '83f283cc053e555a5ac961a09c58a68f1c6fa589512f5b083b53a620cb90f794',
};
for (const [url, digest] of Object.entries(localImages)) {
  const path = join('public', url.slice(1));
  if (!existsSync(path) || createHash('sha256').update(readFileSync(path)).digest('hex') !== digest) {
    errors.push(`${path}: archivo distinto de la entrega autorizada en D-36.`);
  }
}
function files(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}
for (const path of files('src')) {
  if (!path.endsWith('.astro')) continue;
  const source = readFileSync(path, 'utf8');
  const markup = source.replace(/^---[\s\S]*?---/, '').replace(/<style[\s\S]*?<\/style>/g, '');
  const literalText = [...markup.matchAll(/>([^<>{]+)</g)].map(match => match[1]).join(' ');
  errors.push(...contentErrors(literalText, []).map(error => `${path}: ${error}`));
  if (/<iframe\b|<video\b/i.test(markup) || (/<form\b/i.test(markup) && path !== 'src/components/m4/Contacto.astro')) errors.push(`${path}: formulario o medio no autorizado en M2.`);
  for (const image of markup.matchAll(/<img\b[^>]*>/gi)) {
    const src = image[0].match(/\bsrc\s*=\s*(['"])(.*?)\1/i)?.[2];
    if (APP_ENV !== 'local' || !Object.hasOwn(localImages, src ?? '') || /\bsrcset\s*=/i.test(image[0])) {
      errors.push(`${path}: imagen fuera de las entregas locales autorizadas en D-36.`);
    }
  }
  if (/<script\b/i.test(markup) && path !== 'src/layouts/Base.astro') errors.push(`${path}: script fuera del generador JSON-LD.`);
  if (/application\/ld\+json/.test(source) && path !== 'src/layouts/Base.astro') errors.push(`${path}: JSON-LD fuera del generador autorizado.`);
  if (routesRequiringLocalGate.has(path) && /export\s+const\s+prerender\s*=\s*true\b/.test(source)) {
    errors.push(`${path}: una ruta prerenderizada puede omitir local-gate y exponer la preview fuera de loopback.`);
  }
  if (/(?:https?:)?\/\/(?!directoproducciones\.com(?:[/'"]|$))/.test(markup)) errors.push(`${path}: recurso externo no autorizado.`);
  if (/FAQPage|priceRange|openingHoursSpecification/.test(source)) errors.push(`${path}: marcado fuera del alcance aprobado.`);
  for (const match of source.matchAll(/['"]((?:service|social_proof|contact|entity|sla)\.[^'"]+)['"]/g)) {
    if (!facts.some(fact => fact.id === match[1])) errors.push(`${path}: referencia a fact inexistente: ${match[1]}`);
  }
  if (!path.includes('/blog/') && /(?:getEmDash|emdash\/runtime|Astro\.locals\.emdash)/.test(source)) errors.push(`${path}: página corporativa dependiente del CMS.`);
}
for (const path of files('public/assets')) {
  if (!Object.hasOwn(localImages, '/' + path.slice('public/'.length))) {
    errors.push(`${path}: asset público no autorizado en M2.`);
  }
}
for (const fact of facts.filter(isApproved)) {
  errors.push(...contentErrors(fact.value, [fact.id]).map(error => `content/facts.yaml (${fact.id}): ${error}`));
}
const schema = readFileSync('src/lib/schema.ts', 'utf8');
if (!schema.includes(CANONICAL_ORIGIN) && !schema.includes('CANONICAL_ORIGIN')) errors.push('JSON-LD sin dominio canónico autorizado.');
if (/FAQPage|priceRange|openingHoursSpecification|areaServed|geo|sameAs|logo/.test(schema)) errors.push('Propiedad JSON-LD fuera de la lista autorizada M2.');
const seed = JSON.parse(readFileSync('seed/seed.json', 'utf8'));
if (seed.collections.length !== 1 || seed.collections[0].slug !== 'posts' || seed.collections[0].commentsEnabled !== false) errors.push('Modelo CMS fuera del blog o comentarios activos.');
for (const entries of Object.values(seed.content ?? {}) as { status?: string; data?: { synthetic?: boolean } }[][]) {
  if (entries.some(entry => entry.status !== 'draft' || entry.data?.synthetic !== true)) errors.push('El seed solo puede crear borradores sintéticos.');
}
// Cambiar el valor de un fact aprobado exige primero retirar su aprobación.
// GUARD_BASE_FACTS permite verificar transiciones con fixtures locales; CI usa GUARD_BASE_REF.
const base = process.env.GUARD_BASE_REF;
const localBaseFactsPath = process.env.GUARD_BASE_FACTS;
if (localBaseFactsPath && APP_ENV !== 'local') errors.push('GUARD_BASE_FACTS solo está permitido para fixtures locales.');
const baseFactsPath = base ? undefined : APP_ENV === 'local' ? localBaseFactsPath : undefined;
let previous: typeof facts | undefined;
if (baseFactsPath) {
  if (!existsSync(baseFactsPath)) errors.push(`Archivo base de facts inexistente: ${baseFactsPath}`);
  else previous = parse(readFileSync(baseFactsPath, 'utf8')) as typeof facts;
} else if (base) {
  execFileSync('git', ['rev-parse', '--verify', `${base}^{commit}`], { stdio: 'ignore' });
  try {
    execFileSync('git', ['cat-file', '-e', `${base}:content/facts.yaml`], { stdio: 'ignore' });
    previous = parse(execFileSync('git', ['show', `${base}:content/facts.yaml`], { encoding: 'utf8' })) as typeof facts;
  } catch {
    previous = [];
  }
} else if (APP_ENV === 'production') errors.push('Producción exige GUARD_BASE_REF para validar cambios de aprobación.');
if (previous) {
  for (const old of previous.filter(fact => fact.status === 'approved')) {
    const current = facts.find(fact => fact.id === old.id);
    if (current && current.value !== old.value &&
        (current.status !== 'pending' || current.approved_by !== null || current.approved_at !== null || current.evidence !== null)) {
      errors.push(`Cambiar el valor aprobado invalida su aprobación: ${old.id}. Primero pásalo a pending y limpia evidence/approved_by/approved_at; la aprobación posterior debe revisarse en un cambio separado.`);
    }
  }
}
// Inspección de HTML existente para integración, sin generar un build.
const htmlRoot = process.env.GUARD_HTML_DIR;
if (htmlRoot) {
  if (!existsSync(htmlRoot)) errors.push(`Directorio HTML inexistente: ${htmlRoot}`);
  for (const path of files(resolve(htmlRoot)).filter(path => path.endsWith('.html'))) {
    const html = readFileSync(path, 'utf8');
    if (forbiddenText.test(html)) errors.push(`${path}: marcador o frase prohibida.`);
    if (/<form\b|<iframe\b|<script[^>]+src\s*=/i.test(html)) errors.push(`${path}: formulario, iframe o script no autorizado.`);
    for (const match of html.matchAll(/data-fact-id="([^"]+)"/g)) {
      if (!facts.some(fact => fact.id === match[1] && isApproved(fact))) errors.push(`${path}: fact no aprobado: ${match[1]}`);
    }
    const canonical = html.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/);
    if (!canonical || new URL(canonical[1]).origin !== CANONICAL_ORIGIN) errors.push(`${path}: canonical inválido.`);
    const visibleText = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]*>/g, ' ');
    const references = [...html.matchAll(/data-fact-id="([^"]+)"/g)].map(match => match[1]);
    errors.push(...contentErrors(visibleText, references).map(error => `${path}: ${error}`));
  }
}
if (errors.length) {
  process.stderr.write(errors.join('\n') + '\n');
  process.exitCode = 1;
} else process.stdout.write('Facts y política editorial conservados; reproducción M4 exclusivamente local, con envío deshabilitado.\n');
