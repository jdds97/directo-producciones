// Guard de primer lanzamiento: falla con la lista concreta de lo que aún impide desplegar. No despliega ni contacta con nada.
//   npm run launch:readiness [-- --env preview]     (por defecto producción; sale con 1 si hay bloqueos)
//   npm run launch:readiness -- --closed            (D-62, producción en modo cerrado: exige lo de la fase cerrada; los bloqueos del corte
//                                                    se listan como información y no fallan)
import { readFileSync } from 'node:fs';
import { unstable_readConfig } from 'wrangler';

const env = process.argv.includes('--env') ? process.argv[process.argv.indexOf('--env') + 1] : 'production';
if (!['preview', 'production'].includes(env)) { console.error('--env debe ser preview o production'); process.exit(2); }
const closed = process.argv.includes('--closed');
if (closed && env !== 'production') { console.error('--closed solo aplica a producción'); process.exit(2); }
process.env.APP_ENV = env; // la política de hechos exige aprobar los «required_for_launch» según el entorno
const blockers: string[] = [];
const block = (text: string) => blockers.push(text);
// Bloqueos propios del corte público (hechos, hito del propietario y mapa de URLs): con --closed solo informan.
const launchInfo: string[] = [];
const blockLaunch = (text: string) => (closed ? launchInfo : blockers).push(text);

// 1 · Recursos del entorno en wrangler.jsonc (verificable sin red)
const cfg = unstable_readConfig({ config: 'wrangler.jsonc', env }, { hideWarnings: true });
const isRealId = (id?: string) => !!id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) && !/^0{8}-/.test(id);
const expectedName = env === 'production' ? 'directo-producciones' : 'directo-producciones-preview';
if (cfg.name !== expectedName) block(`wrangler.jsonc env.${env}: name debe ser ${expectedName} (es ${cfg.name}).`);
// D-25: DB (CMS) y CONTACT_DB (solicitudes) son bases distintas, con UUID real y carpeta de migraciones propia.
const d1 = Object.fromEntries((cfg.d1_databases ?? []).map((d: { binding: string; database_id?: string; migrations_dir?: string }) => [d.binding, d]));
for (const b of ['DB', 'CONTACT_DB']) {
  if (!d1[b]) block(`wrangler.jsonc env.${env}: falta el binding D1 ${b}.`);
  else if (!isRealId(d1[b].database_id)) block(`wrangler.jsonc env.${env}: database_id de ${b} sin sustituir por el UUID real.`);
}
if (d1.DB && d1.CONTACT_DB && (d1.DB.database_id === d1.CONTACT_DB.database_id || d1.DB.migrations_dir === d1.CONTACT_DB.migrations_dir)) block(`wrangler.jsonc env.${env}: DB y CONTACT_DB deben ser bases y carpetas de migraciones distintas (D-25).`);
if (cfg.vars?.CONTACT_PERSISTENCE === 'on' && !d1.CONTACT_DB) block('CONTACT_PERSISTENCE=on exige CONTACT_DB.');
// Medios: R2 con jurisdicción UE (decisión del propietario del 2026-11-05). MEDIA_KV puede seguir declarado (vuelta atrás) hasta retirarlo.
const r2Media = cfg.r2_buckets?.find((r: { binding: string; bucket_name?: string; jurisdiction?: string }) => r.binding === 'MEDIA');
if (!r2Media?.bucket_name || r2Media.bucket_name.includes('-local') || r2Media.jurisdiction !== 'eu') block(`wrangler.jsonc env.${env}: falta el bucket R2 del binding MEDIA con nombre real (sin «-local») y "jurisdiction": "eu".`);
// Correo del formulario: binding CONTACT_EMAIL de Cloudflare Email Sending, restringido al remitente CONTACT_FROM y al destinatario aprobado.
// Producción lo exige; preview solo lo admite para la prueba real temporal (RUNBOOK §5b), con las mismas restricciones.
type SendBinding = { name: string; remote?: boolean; destination_address?: string; allowed_destination_addresses?: string[]; allowed_sender_addresses?: string[] };
const sendBindings = ((cfg as { send_email?: SendBinding[] }).send_email ?? []);
const contactEmail = sendBindings.find((b) => b.name === 'CONTACT_EMAIL');
const { approvedFact } = await import('../src/lib/facts');
const recipient = approvedFact('contact.form_recipient_email')?.value;
const destinations = contactEmail ? [contactEmail.destination_address, ...(contactEmail.allowed_destination_addresses ?? [])].filter(Boolean) : [];
if (sendBindings.some((b) => b.name !== 'CONTACT_EMAIL' || b.remote)) block(`wrangler.jsonc env.${env}: el único binding send_email es CONTACT_EMAIL, sin remote.`);
if (env === 'production' && !contactEmail) block('wrangler.jsonc env.production: falta el binding send_email CONTACT_EMAIL (correo del formulario por Cloudflare Email Sending).');
if (contactEmail && JSON.stringify(contactEmail.allowed_sender_addresses) !== JSON.stringify([String(cfg.vars?.CONTACT_FROM ?? '')])) block(`wrangler.jsonc env.${env}: CONTACT_EMAIL.allowed_sender_addresses debe ser exactamente [CONTACT_FROM].`);
if (contactEmail && (destinations.length !== 1 || destinations[0] !== recipient)) block(`wrangler.jsonc env.${env}: CONTACT_EMAIL debe enviar solo al destinatario aprobado (contact.form_recipient_email).`);
if (!/^[^\s@]+@avisos\.directoproducciones\.com$/.test(String(cfg.vars?.CONTACT_FROM ?? ''))) block(`wrangler.jsonc env.${env}: CONTACT_FROM debe ser una dirección del subdominio avisos.`);
if (!cfg.ratelimits?.length) block(`wrangler.jsonc env.${env}: falta el límite de frecuencia del formulario.`);
if (!(cfg.d1_databases ?? []).every((d: { migrations_dir?: string }) => d.migrations_dir)) block(`wrangler.jsonc env.${env}: D1 sin migrations_dir.`);

// 2 · Controles por entorno (sin condición «local» permanente): el copy de revisión sigue siendo solo local; el resto lo decide src/config/env-policy.ts
if (!readFileSync('src/lib/m4-draft.ts', 'utf8').includes("APP_ENV !== 'local'")) block('src/lib/m4-draft.ts: el copy en revisión debe seguir siendo exclusivo de local (no es fallback de preview ni producción).');
if (cfg.vars?.APP_ENV !== env) block(`wrangler.jsonc env.${env}: vars.APP_ENV debe ser «${env}».`);
const { closedDeployBlockers, launchBlockers, previewBlockers, previewProtectionBlockers, productionAccessBlockers } = await import('../src/config/env-policy');
const launch = JSON.parse(readFileSync('config/launch.json', 'utf8')) as { activated: boolean; closedDeploy?: boolean; checklist: Record<string, boolean>; previewChecklist?: Record<string, boolean> };
// Producción admite además, SOLO con el lanzamiento activado, la lista exacta que deja los estáticos del build a Static Assets (sin Worker).
// Antes del corte, `true`: la compuerta ata /_astro y /assets al JWT de Access y public/assets lleva medios sin aprobar.
const staticBypass = JSON.stringify(['/*', '!/_astro/*', '!/assets/*', '!/page-transition.js']);
const runWorkerFirst = JSON.stringify((cfg as { assets?: { run_worker_first?: unknown } }).assets?.run_worker_first);
if (runWorkerFirst !== 'true' && !(env === 'production' && runWorkerFirst === staticBypass && launchBlockers(launch).length === 0)) block(`wrangler.jsonc env.${env}: assets.run_worker_first=true${env === 'production' ? ` (${staticBypass} solo tras activar el lanzamiento)` : ''} (la compuerta debe ver HTML, medios y API).`);
const exposed = (cfg as { workers_dev?: boolean; preview_urls?: boolean });
if (env === 'preview') {
  // Preview protegida: recursos + Access real + almacenamiento resuelto + sin correo real. No exige el corte público ni las redirecciones.
  for (const b of previewProtectionBlockers(cfg as never)) block(b);
  for (const b of previewBlockers(launch)) block(b);
  if (cfg.vars?.CONTACT_TRANSPORT) block('wrangler.jsonc env.preview: CONTACT_TRANSPORT solo es para pruebas locales.');
} else if (exposed.workers_dev || exposed.preview_urls) block('wrangler.jsonc env.production: workers_dev/preview_urls deben seguir apagados (el tráfico llega por el dominio tras el corte).');
// Panel de producción: sin la app de Access (equipo + AUD) el Worker cierra /_emdash/* con 503 y nadie puede entrar al CMS; con la AUD de
// la preview, cualquiera de su política entraría en el panel de producción.
const previewVars = unstable_readConfig({ config: 'wrangler.jsonc', env: 'preview' }, { hideWarnings: true }).vars;
if (env === 'production') for (const b of productionAccessBlockers(cfg.vars, previewVars)) block(b);
if (env === 'preview' && (exposed.workers_dev || exposed.preview_urls) && previewProtectionBlockers(cfg as never).length) block('wrangler.jsonc env.preview: workers_dev/preview_urls activos sin protección Access válida.');

// 3 · Hechos necesarios para el lanzamiento (política de facts, mismos criterios que el guard)
const { validateFacts } = await import('../src/lib/facts');
for (const e of validateFacts().filter((x) => x.startsWith('Necesario para lanzamiento'))) blockLaunch(e);

// 4 · Hito del propietario: atestaciones que no se pueden comprobar offline (solo el corte de producción; preview privada no lo exige)
if (env === 'production') for (const b of launchBlockers(launch)) blockLaunch(b);
if (cfg.vars?.CONTACT_PERSISTENCE === 'on' && !launch.checklist.privacyContractApproved) block('CONTACT_PERSISTENCE=on exige privacyContractApproved (texto de privacidad y retención aprobados).');

// 5 · Mapa de las 59 URLs antiguas: cada una necesita destino/código aprobado (o ser «conservar-ruta») antes del corte
const urlMap = JSON.parse(readFileSync('config/url-map.json', 'utf8')) as { rows: { path: string; accion: string; aprobado_por?: string }[] };
const unresolved = urlMap.rows.filter((r) => r.accion !== 'conservar-ruta' && !r.aprobado_por);
if (env === 'production' && unresolved.length) blockLaunch(`config/url-map.json: ${unresolved.length} de ${urlMap.rows.length} URLs antiguas sin destino/código aprobado (npm run urlmap:check -- --list).`);

// 6 · D-62 · fase cerrada: Access del panel, todo por la compuerta, leads y analítica apagados y público en 503 (src/config/env-policy.ts)
if (closed) {
  const { LEADS_ENABLED, ANALYTICS_ENABLED } = await import('../src/config/flags');
  for (const b of await closedDeployBlockers(launch, cfg as never, { vars: previewVars }, { LEADS_ENABLED, ANALYTICS_ENABLED })) if (!blockers.includes(b)) block(b);
  console.log(`Bloqueos del lanzamiento (informativos; la fase cerrada no los exige: ${launchInfo.length}):`);
  for (const b of launchInfo) console.log(` - ${b}`);
}
const what = closed ? 'Despliegue cerrado' : 'Lanzamiento';
if (blockers.length) {
  console.error(`${what} NO listo para «${env}» (${blockers.length} bloqueos):`);
  for (const b of blockers) console.error(` - ${b}`);
  process.exit(1);
}
console.log(closed ? 'Despliegue cerrado listo para «production»: el público sigue en 503 y el panel tras Access hasta activar el lanzamiento.' : `Lanzamiento listo para «${env}».`);
