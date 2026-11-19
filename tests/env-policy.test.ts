// Compuerta por entorno: local, preview (Access verificado con claves RSA sintéticas) y producción (hito de lanzamiento).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { accessConfig, canonicalPath, clearAccessCache, closedDeployBlockers, decideRequest, isClosedDeploy, launchBlockers, previewBlockers, renderBlockers, verifyAccessJwt, type GateInput, type JwksFetcher, type LaunchState, type WorkerConfig } from '../src/config/env-policy.ts';

const TEAM = 'equipo-prueba.cloudflareaccess.com';
const AUD = 'c'.repeat(64);
const cfg = { teamDomain: TEAM, aud: AUD };
const PREVIEW = 'https://directo-producciones-preview.directo-producciones.workers.dev';
const NOW = 1_800_000_000_000;

const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwkOf = (kp: typeof pair, kid: string) => ({ ...(kp.publicKey.export({ format: 'jwk' }) as object), kid, alg: 'RS256', use: 'sig' });
const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function sign(claims: Record<string, unknown>, { kid = 'k1', key = pair.privateKey, alg = 'RS256' } = {}) {
  const head = b64u({ alg, kid, typ: 'JWT' });
  const body = b64u({ iss: `https://${TEAM}`, aud: [AUD], exp: NOW / 1000 + 600, ...claims });
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(key).toString('base64url');
  return `${head}.${body}.${sig}`;
}
let fetches = 0;
const fetchJwks: JwksFetcher = async () => { fetches++; return { keys: [jwkOf(pair, 'k1')] }; };
const reset = () => { clearAccessCache(); fetches = 0; };

test('accessConfig: vacío, placeholder o mal formado = sin configurar', () => {
  assert.equal(accessConfig({}), null);
  assert.equal(accessConfig({ ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '' }), null);
  assert.equal(accessConfig({ ACCESS_TEAM_DOMAIN: 'REEMPLAZAR.cloudflareaccess.com', ACCESS_AUD: 'REEMPLAZAR' }), null);
  assert.equal(accessConfig({ ACCESS_TEAM_DOMAIN: 'evil.example.com', ACCESS_AUD: AUD }), null);
  assert.equal(accessConfig({ ACCESS_TEAM_DOMAIN: `${TEAM}/x`, ACCESS_AUD: AUD }), null);
  assert.deepEqual(accessConfig({ ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD }), cfg);
});

test('verifyAccessJwt: acepta solo firma de Access, iss, aud y vigencia', async () => {
  reset();
  assert.equal(await verifyAccessJwt(sign({}), cfg, fetchJwks, NOW), true);
  assert.equal(await verifyAccessJwt(sign({ aud: [AUD, 'z'.repeat(64)] }), cfg, fetchJwks, NOW), true);
  assert.equal(await verifyAccessJwt(sign({ aud: 'z'.repeat(64) }), cfg, fetchJwks, NOW), false, 'aud ajeno');
  assert.equal(await verifyAccessJwt(sign({ iss: 'https://otro.cloudflareaccess.com' }), cfg, fetchJwks, NOW), false, 'iss ajeno');
  assert.equal(await verifyAccessJwt(sign({ exp: NOW / 1000 - 3600 }), cfg, fetchJwks, NOW), false, 'caducado');
  assert.equal(await verifyAccessJwt(sign({ exp: undefined }), cfg, fetchJwks, NOW), false, 'sin exp');
  assert.equal(await verifyAccessJwt(sign({ nbf: NOW / 1000 + 3600 }), cfg, fetchJwks, NOW), false, 'aún no válido');
  assert.equal(await verifyAccessJwt(sign({}, { key: other.privateKey }), cfg, fetchJwks, NOW), false, 'firmado con otra clave');
  assert.equal(await verifyAccessJwt(sign({}, { alg: 'none' }), cfg, fetchJwks, NOW), false, 'alg none');
  assert.equal(await verifyAccessJwt(sign({}, { kid: 'desconocido' }), cfg, fetchJwks, NOW), false, 'kid desconocido');
  const [h, , s] = sign({}).split('.');
  assert.equal(await verifyAccessJwt(`${h}.${b64u({ iss: `https://${TEAM}`, aud: [AUD], exp: NOW / 1000 + 600, admin: true })}.${s}`, cfg, fetchJwks, NOW), false, 'payload alterado');
  for (const bad of [undefined, null, '', 'a.b', 'a.b.c', 'x'.repeat(9000)]) assert.equal(await verifyAccessJwt(bad, cfg, fetchJwks, NOW), false);
});

test('verifyAccessJwt: caché de claves, refresco por rotación y fallo de red = cerrado', async () => {
  reset();
  await verifyAccessJwt(sign({}), cfg, fetchJwks, NOW);
  await verifyAccessJwt(sign({}), cfg, fetchJwks, NOW + 1000);
  assert.equal(fetches, 1, 'segunda verificación sin nueva descarga');
  const rotated = { ...pair, privateKey: other.privateKey };
  const fetchRotated: JwksFetcher = async () => { fetches++; return { keys: [jwkOf(pair, 'k1'), jwkOf(other, 'k2')] }; };
  assert.equal(await verifyAccessJwt(sign({}, { kid: 'k2', key: rotated.privateKey }), cfg, fetchRotated, NOW + 2000), false, 'kid nuevo dentro del minuto: sin refresco');
  assert.equal(await verifyAccessJwt(sign({}, { kid: 'k2', key: rotated.privateKey }), cfg, fetchRotated, NOW + 120_000), true, 'kid nuevo tras un minuto: refresca');
  reset();
  assert.equal(await verifyAccessJwt(sign({}), cfg, async () => { throw new Error('red'); }, NOW), false);
});

const base = (over: Partial<GateInput>): GateInput => ({
  env: 'preview', runtimeEnv: 'preview', url: new URL(`${PREVIEW}/`), expectedOrigin: PREVIEW, prerendered: false,
  vars: { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD }, launch: { activated: false, checklist: { a: false } }, fetchJwks, now: NOW, ...over,
});
const status = async (over: Partial<GateInput>) => { const d = await decideRequest(base(over)); return d.ok ? 200 : d.status; };

test('preview: cerrada sin config, sin JWT o con JWT ajeno; abierta solo con JWT válido', async () => {
  reset();
  assert.equal(await status({ vars: {} }), 503, 'sin configurar');
  assert.equal(await status({ vars: { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: 'placeholder' } }), 503, 'placeholder');
  assert.equal(await status({}), 403, 'sin JWT');
  assert.equal(await status({ accessToken: sign({ aud: ['z'.repeat(64)] }) }), 403, 'aud ajeno');
  assert.equal(await status({ accessToken: sign({}) }), 200, 'JWT válido');
  const ok = await decideRequest(base({ accessToken: sign({}) }));
  assert.deepEqual(ok, { ok: true, access: true });
});

test('preview: host exacto; hosts alternativos y puertos se rechazan aunque el JWT sea válido', async () => {
  reset();
  const token = sign({});
  for (const u of ['https://directo-producciones-preview.directo-producciones.workers.dev:8443/',
    'https://abc123-directo-producciones-preview.directo-producciones.workers.dev/', 'https://directo-producciones.workers.dev/', 'https://directoproducciones.com/']) {
    assert.equal(await status({ url: new URL(u), accessToken: token }), 403, u);
  }
  assert.equal(await status({ url: new URL(`${PREVIEW}/assets/m4/logo-original.jpg`), accessToken: token }), 200, 'estáticos pasan por la misma compuerta');
  assert.equal(await status({ url: new URL(`${PREVIEW}/assets/m4/logo-original.jpg`) }), 403, 'estáticos sin JWT');
  assert.equal(await status({ url: new URL(`${PREVIEW}/interno/guia/`), accessToken: token }), 404, 'rutas de revisión local no existen fuera de local');
});

test('producción: cerrada hasta completar el hito de config/launch.json; sin condición local permanente', async () => {
  const prod = (launch: GateInput['launch'], url = 'https://directoproducciones.com/') => status({ env: 'production', runtimeEnv: 'production', url: new URL(url), launch });
  const done = { activated: true, checklist: { a: true, b: true } };
  assert.equal(await prod({ activated: false, checklist: { a: true } }), 503, 'sin activar');
  assert.equal(await prod({ activated: true, checklist: { a: true, b: false } }), 503, 'checklist incompleta');
  assert.equal(await prod(done), 200);
  assert.equal(await prod(done, 'https://www.directoproducciones.com/x'), 200, 'www pasa para que middleware.ts redirija');
  assert.equal(await prod(done, 'https://directo-producciones.workers.dev/'), 403, 'workers.dev no es producción');
  assert.equal(await prod(done, 'https://directoproducciones.com:8443/'), 403, 'con puerto');
  assert.equal(await prod(done, 'https://directoproducciones.com/interno/guia/'), 404);
  assert.equal(launchBlockers(done).length, 0);
  assert.equal(launchBlockers({ activated: true, checklist: { legalApproved: false } }).length, 1);
});

test('producción: panel /_emdash/* solo con JWT de Access, antes y después del corte; medios públicos solo con el sitio activado', async () => {
  reset();
  const closed = { activated: false, checklist: { a: true } };
  const done = { activated: true, checklist: { a: true } };
  const prod = (path: string, launch: GateInput['launch'], over: Partial<GateInput> = {}) => status({ env: 'production', runtimeEnv: 'production', url: new URL(`https://directoproducciones.com${path}`), launch, ...over });
  const token = sign({});
  for (const launch of [closed, done]) {
    const when = launch.activated ? 'activado' : 'antes del corte';
    for (const path of ['/_emdash', '/_emdash/admin/', '/_emdash/admin/setup', '/_emdash/api/setup', '/_emdash/api/setup/admin', '/_emdash/api/content/page_home']) {
      assert.equal(await prod(path, launch), 403, `${when}, sin JWT: ${path}`);
      assert.equal(await prod(path, launch, { accessToken: sign({ aud: ['z'.repeat(64)] }) }), 403, `${when}, JWT de otra app: ${path}`);
      assert.equal(await prod(path, launch, { accessToken: token }), 200, `${when}, JWT válido: ${path}`);
      assert.equal(await prod(path, launch, { vars: {}, accessToken: token }), 503, `${when}, sin config de Access el panel queda cerrado: ${path}`);
    }
  }
  assert.deepEqual(await decideRequest(base({ env: 'production', runtimeEnv: 'production', url: new URL('https://directoproducciones.com/_emdash/admin/'), launch: closed, accessToken: token })), { ok: true, access: true });
  assert.equal(await prod('/_emdash/api/media/file/foto.jpg', done), 200, 'medios del blog públicos con el sitio activado');
  assert.equal(await prod('/_emdash/api/media/file/foto.jpg', done, { vars: {} }), 200, 'medios públicos aunque falte la config de Access');
  assert.equal(await prod('/_emdash/api/media/file/foto.jpg', closed), 403, 'antes del corte, medios solo con Access');
  assert.equal(await prod('/', closed, { accessToken: token }), 503, 'Access no abre las páginas antes del corte');
  assert.equal(await prod('/_astro/admin.css', closed), 503, 'estáticos cerrados antes del corte');
  assert.equal(await prod('/_astro/admin.css', closed, { cookie: `a=1; CF_Authorization=${token}` }), 200, 'estáticos del panel con la cookie de Access');
  assert.equal(await prod('/_astro/admin.css', closed, { cookie: `CF_Authorization=${sign({}, { key: other.privateKey })}` }), 503, 'cookie con firma ajena');
  assert.equal(await prod('/_emdash/admin/', done, { cookie: `CF_Authorization=${token}` }), 200, 'el panel acepta también la cookie de Access');
  assert.equal(await prod('/_astro/admin.css', done), 200);
  // Esa compuerta de estáticos solo se alcanza si el Worker ve /_astro y /assets: run_worker_first=true en producción hasta el corte.
  const { unstable_readConfig } = await import('wrangler');
  const prodCfg = unstable_readConfig({ config: 'wrangler.jsonc', env: 'production' }, { hideWarnings: true }) as { assets?: { run_worker_first?: unknown } };
  if (launchBlockers(JSON.parse(readFileSync('config/launch.json', 'utf8'))).length) assert.equal(prodCfg.assets?.run_worker_first, true, 'wrangler env.production: run_worker_first=true antes del corte');
  assert.equal(await status({ url: new URL(`${PREVIEW}/_emdash/admin/`), cookie: `CF_Authorization=${token}` }), 403, 'preview sigue exigiendo la cabecera de Access');
});

test('ruta canónica: las variantes codificadas del panel son el panel; las ambiguas o inválidas, 400 en todos los entornos', async () => {
  reset();
  const token = sign({});
  const done = { activated: true, checklist: { a: true } };
  const prod = (path: string, over: Partial<GateInput> = {}) => status({ env: 'production', runtimeEnv: 'production', url: new URL(`https://directoproducciones.com${path}`), launch: done, ...over });
  // Mismas rutas que enruta Astro (decodeURI repetido + barras colapsadas) o que el parser URL ya normaliza (`\`, `..`, `%2e%2e`).
  const panel = ['/%5Femdash/admin/', '/%5femdash/admin/', '/%255Femdash/admin/', '/%5Femdash/api/setup/status', '/_emd%61sh/api/setup/admin',
    '//_emdash/admin/', '///_emdash//admin/', '/_emdash\\admin/', '/x/../_emdash/admin/', '/x/%2e%2e/_emdash/admin/', '/x/%2E%2E/_emdash/admin/', '//%5Femdash',
    // Astro no las enruta al panel, pero se tratan como tal (solo exige el JWT de más).
    '/_EMDASH/admin/', '/_Emdash/api/setup', '/_emdash%2Fadmin/', '/_emdash%2fapi%2fsetup', '/_emdash%252Fadmin/'];
  for (const p of panel) {
    assert.equal(await prod(p), 403, `sin JWT: ${p}`);
    assert.equal(await prod(p, { vars: {} }), 503, `sin config de Access: ${p}`);
    assert.equal(await prod(p, { accessToken: token }), 200, `JWT válido: ${p}`);
  }
  // Ambiguas (router y context.url verían rutas distintas) o mal codificadas: 400 aunque haya JWT.
  const bad = ['/_emdash%5Cadmin/', '/_emdash%5cadmin/', '/x/%252e%252e/_emdash/admin/', '/_emdash/admin/%252e%252e/%252e%252e/x', '/_em%09dash/admin',
    '/a%zz', '/a%', '/a%25', `/%${'25'.repeat(12)}5Femdash/`, '/_emdash/api/media/file/%252e%252e/%252e%252e/admin/'];
  for (const p of bad) {
    assert.equal(await prod(p, { accessToken: token }), 400, `producción: ${p}`);
    assert.equal(await status({ url: new URL(`${PREVIEW}${p}`), accessToken: token }), 400, `preview: ${p}`);
  }
  assert.equal(await status({ env: 'local', runtimeEnv: undefined, url: new URL('http://localhost:4394/a%zz'), expectedOrigin: 'http://localhost:4394' }), 400, 'local');
  // Excepciones por ruta con la ruta canónica: medios públicos tras el corte, /interno/ cerrado, rutas legítimas codificadas.
  assert.equal(await prod('/%5Femdash/api/media/file/foto.jpg'), 200, 'medios con prefijo codificado');
  assert.equal(await prod('/_EMDASH/api/media/file/foto.jpg'), 403, 'la excepción de medios es exacta');
  for (const p of ['/%69nterno/guia/', '//interno/guia/', '/x/../interno/guia/']) {
    assert.equal(await prod(p), 404, `producción: ${p}`);
    assert.equal(await status({ url: new URL(`${PREVIEW}${p}`), accessToken: token }), 404, `preview: ${p}`);
  }
  assert.equal(await prod('/blog/caf%C3%A9/'), 200, 'ruta no ASCII legítima');
  assert.equal(canonicalPath('/%255Femdash//admin/'), '/_emdash/admin/');
  assert.equal(canonicalPath('/blog/caf%C3%A9/'), '/blog/café/');
  assert.equal(canonicalPath('/_emdash%2Fadmin/'), '/_emdash%2Fadmin/', '%2F sigue codificado, como en Astro');
});

test('local: solo loopback; entorno compilado distinto del de ejecución cierra; prerender no recibe tráfico', async () => {
  const local = (url: string, over: Partial<GateInput> = {}) => status({ env: 'local', runtimeEnv: undefined, url: new URL(url), expectedOrigin: 'http://localhost:4394', ...over });
  for (const u of ['http://localhost:4394/', 'http://127.0.0.1:4394/', 'http://[::1]:4394/']) assert.equal(await local(u), 200, u);
  for (const u of ['http://192.168.1.5:4394/', 'https://directoproducciones.com/', 'http://evil.localhost.example/']) assert.equal(await local(u), 403, u);
  assert.equal(await local('http://192.168.1.5:4394/', { prerendered: true }), 200);
  assert.equal(await status({ runtimeEnv: 'local' }), 503, 'bundle de preview ejecutado con vars.APP_ENV=local');
  assert.equal(await status({ runtimeEnv: undefined }), 503, 'remoto sin vars.APP_ENV = cerrado');
  assert.equal(await status({ env: 'production', runtimeEnv: 'preview', url: new URL('https://directoproducciones.com/') }), 503);
  assert.equal(await local('http://localhost:4394/', { runtimeEnv: 'production' }), 503, 'local con vars.APP_ENV ajeno');
});

test('renderBlockers y previewBlockers', () => {
  const closed = { activated: false, checklist: { a: false } };
  assert.deepEqual(renderBlockers('local', { accessVerified: false, launch: closed }), []);
  assert.equal(renderBlockers('preview', { accessVerified: false, launch: closed }).length, 1);
  assert.deepEqual(renderBlockers('preview', { accessVerified: true, launch: closed }), []);
  assert.ok(renderBlockers('production', { accessVerified: true, launch: closed }).length > 0, 'Access no abre producción');
  assert.equal(previewBlockers({ ...closed }).length, 1, 'sin previewChecklist: almacenamiento sin resolver');
  assert.equal(previewBlockers({ ...closed, previewChecklist: { storageReady: true } }).length, 0);
});

test('D-62 modo cerrado: closedDeploy × activated, Access del panel, leads/analítica y público en 503', async () => {
  const state = (closedDeploy: boolean, activated: boolean) => ({ activated, closedDeploy, checklist: { legalApproved: false } });
  const prod = { vars: { APP_ENV: 'production', ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD }, assets: { run_worker_first: true } };
  const preview = { vars: { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: 'e'.repeat(64) } };
  const off = { LEADS_ENABLED: false, ANALYTICS_ENABLED: false };
  const closed = (over: { launch?: LaunchState; prod?: WorkerConfig; preview?: WorkerConfig; flags?: typeof off } = {}) =>
    closedDeployBlockers(over.launch ?? state(true, false), over.prod ?? prod, over.preview ?? preview, over.flags ?? off);
  // Solo closedDeploy=true con activated=false es modo cerrado. Con activated=true no cambia nada: aplican todos los bloqueos del corte.
  assert.equal(isClosedDeploy(state(false, false)), false);
  assert.equal(isClosedDeploy(state(false, true)), false);
  assert.equal(isClosedDeploy(state(true, false)), true);
  assert.equal(isClosedDeploy(state(true, true)), false);
  assert.equal(isClosedDeploy({ activated: false, checklist: {} }), false, 'sin la clave = desactivado');
  for (const [c, a] of [[false, false], [false, true], [true, true]] as const) {
    assert.deepEqual(await closed({ launch: state(c, a) }), ['config/launch.json: el modo cerrado exige closedDeploy=true y activated=false.'], `closedDeploy=${c} activated=${a}`);
  }
  assert.ok(launchBlockers(state(true, true)).length > 0, 'activado con la checklist incompleta: el corte sigue bloqueado');
  assert.deepEqual(await closed(), [], 'fase cerrada segura');
  // closedDeploy no abre nada en el Worker: el público (páginas y estáticos sin Access) sigue en 503 mientras activated=false.
  for (const path of ['/', '/assets/m4/logo-original.jpg']) {
    assert.equal(await status({ env: 'production', runtimeEnv: 'production', url: new URL(`https://directoproducciones.com${path}`), launch: state(true, false) }), 503, path);
  }
  assert.deepEqual(await closed({ launch: { activated: false, closedDeploy: true, checklist: { legalApproved: true } } }), [], 'checklist completa sin activar: sigue cerrada');
  assert.equal(await status({ env: 'production', runtimeEnv: 'production', url: new URL('https://directoproducciones.com/'), launch: { activated: true, closedDeploy: true, checklist: { legalApproved: true } } }), 200, 'activado con la checklist completa: closedDeploy ya no cierra');
  // Access del panel vacío, placeholder o con la AUD de la preview: no se despliega.
  for (const vars of [{ ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '' }, { ACCESS_TEAM_DOMAIN: 'REEMPLAZAR.cloudflareaccess.com', ACCESS_AUD: 'REEMPLAZAR' }, {}]) {
    assert.ok((await closed({ prod: { ...prod, vars: { APP_ENV: 'production', ...vars } } })).some((b) => b.includes('ACCESS_TEAM_DOMAIN/ACCESS_AUD')), JSON.stringify(vars));
  }
  assert.ok((await closed({ preview: { vars: { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD } } })).some((b) => b.includes('AUD es la de la app de la preview')));
  // Leads y analítica apagados.
  for (const flags of [{ LEADS_ENABLED: true, ANALYTICS_ENABLED: false }, { LEADS_ENABLED: false, ANALYTICS_ENABLED: true }]) {
    assert.ok((await closed({ flags })).some((b) => b.includes('LEADS_ENABLED y ANALYTICS_ENABLED')), JSON.stringify(flags));
  }
  // La compuerta debe ver todo (estáticos incluidos) y el entorno de ejecución debe ser producción.
  assert.ok((await closed({ prod: { ...prod, assets: { run_worker_first: ['/*', '!/_astro/*'] } } })).some((b) => b.includes('run_worker_first')));
  assert.ok((await closed({ prod: { ...prod, vars: { ...prod.vars, APP_ENV: 'preview' } } })).some((b) => b.includes('vars.APP_ENV')));
});
