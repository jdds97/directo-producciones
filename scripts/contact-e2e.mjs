// E2E del formulario contra el Worker local REAL (wrangler dev) con el binding send_email CONTACT_EMAIL SIMULADO por wrangler.
// No envía correo: sin `remote: true` (lo prohíbe el guard), wrangler dev registra cada envío y guarda texto y HTML en .wrangler/tmp/email.
//   EMDASH_SITE_URL=http://localhost:4450 npm run build && node scripts/contact-e2e.mjs
// Requiere el build previo con el mismo puerto. Persistencia aislada .wrangler/fase-04-correo (se recrea).
// Los fallos del proveedor que el simulador no reproduce (códigos de Email Sending, tiempo agotado) se prueban en tests/contact-delivery.test.ts.
import { spawn, execFileSync } from 'node:child_process';
import { rmSync, readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const PORT = Number(process.env.E2E_PORT ?? 4450);
const BASE = `http://localhost:${PORT}`;
const DIR = '.wrangler/fase-04-correo';
const TO = 'info@directoproducciones.com';
const FROM = 'formulario@avisos.directoproducciones.com';
const ALIEN_FROM = 'otro@avisos.directoproducciones.com'; // fuera de allowed_sender_addresses: el binding lo rechaza
let passed = 0, failed = 0;
const ok = (cond, name, extra = '') => { cond ? passed++ : failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ' ' + extra}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Envíos registrados por el simulador de wrangler ──────────────────────────────────────────────────────
// Formato: «send_email binding called with MessageBuilder:\nFrom: …\nTo: …\nSubject: …\n\nText: <ruta>».
let all = '';
const sent = () => [...all.matchAll(/send_email binding called with MessageBuilder:\s*From: (\S+)\s*To: (\S+)\s*Subject: ([^\n]+)\s*Text: (\S+)/g)]
  .map(([, from, to, subject, text]) => ({ from, to, subject: subject.trim(), text }));

// ── Worker local ──────────────────────────────────────────────────────────────────────────────────────────
let child, output = '', bindingLine = '';
async function startWorker(vars) {
  output = '';
  const args = ['scripts/local-worker.mjs', '--persist-to', DIR, ...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`])];
  child = spawn('node', args, { env: { ...process.env, EMDASH_SITE_URL: BASE }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (c) => { output += c; all += c; });
  child.stderr.on('data', (c) => { output += c; all += c; });
  for (let i = 0; i < 90; i++) {
    try { if ((await fetch(`${BASE}/contacto/`)).ok) { bindingLine = output.split('\n').find((l) => l.includes('env.CONTACT_EMAIL')) ?? ''; return; } } catch { /* aún arrancando */ }
    await sleep(1000);
  }
  throw new Error('El Worker local no arrancó:\n' + output.slice(-1500));
}
async function stopWorker() {
  if (!child) return;
  try { process.kill(-child.pid, 'SIGTERM'); } catch { /* ya terminado */ }
  await sleep(2500);
  child = undefined;
}

// ── Utilidades de prueba ──────────────────────────────────────────────────────────────────────────────────
let ipSeq = 0;
const form = (fields) => new URLSearchParams({ name: 'Persona Sintética', email: 'visita@example.test', service: 'Otro proyecto', message: 'Mensaje sintético', website: '', ...fields }).toString();
async function post(fields, { json = true, ip = `203.0.113.${++ipSeq}`, headers = {}, body } = {}) {
  const res = await fetch(`${BASE}/api/contacto`, {
    method: 'POST', redirect: 'manual',
    headers: { Origin: BASE, 'Content-Type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': ip, ...(json ? { Accept: 'application/json' } : {}), ...headers },
    body: body ?? form(fields),
  });
  const text = await res.text();
  return { status: res.status, location: res.headers.get('location'), json: json && text ? JSON.parse(text) : null, cache: res.headers.get('cache-control') };
}
const dbFile = () => `${DIR}/v3/d1/miniflare-D1DatabaseObject/${readdirSync(`${DIR}/v3/d1/miniflare-D1DatabaseObject`).find((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite')}`;
const rows = () => { const db = new DatabaseSync(dbFile(), { readOnly: true }); try { return db.prepare('SELECT * FROM contact_submissions ORDER BY created_at').all(); } finally { db.close(); } };
const tick = async () => (await fetch(`${BASE}/cdn-cgi/handler/scheduled`)).status;

try {
  rmSync(DIR, { recursive: true, force: true });
  execFileSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', DIR], { stdio: 'ignore' });

  // 1 · Perfil por defecto: transporte simulado, sin persistencia, nunca contacta con nada.
  await startWorker({});
  let r = await post({ message: 'defecto' });
  ok(r.status === 200 && r.json.code === 'simulada' && r.json.delivery === 'simulated', 'defecto: simulada, entrega «simulated»', JSON.stringify(r));
  ok(sent().length === 0 && rows().length === 0, 'defecto: no llama al binding ni guarda nada');
  ok(r.cache === 'no-store', 'respuesta no-store');
  r = await post({ message: 'sin js' }, { json: false });
  ok(r.status === 303 && r.location === '/contacto/?consulta=simulada#consulta', 'sin JS: 303 con solo un código', r.location);
  const page = await (await fetch(`${BASE}${r.location.split('#')[0]}`)).text();
  ok(page.includes('envío está simulado') && !page.includes('visita@example.test'), 'sin JS: la página muestra el resultado sin datos personales');
  r = await post({ to: 'otro@example.test' });
  ok(r.status === 200 && sent().length === 0, 'campo «to» del cliente ignorado');

  // 2 · Validaciones y antiabuso del servidor
  ok((await post({ name: '' })).status === 400, 'nombre vacío → 400');
  ok((await post({ email: 'no-es-correo' })).status === 400, 'correo inválido → 400');
  ok((await post({ service: 'Inexistente' })).status === 400, 'servicio fuera de lista → 400');
  ok((await post({ website: 'http://spam.test' })).status === 400, 'honeypot → rechazada');
  ok((await post({}, { headers: { Origin: 'https://otro.example' } })).status === 403, 'origen ajeno → 403');
  ok((await post({}, { headers: { 'Content-Type': 'application/json' } })).status === 415, 'content-type JSON → 415');
  ok((await post({ message: 'x'.repeat(9000) })).status === 413, 'cuerpo > 8 KB → 413');
  r = await fetch(`${BASE}/api/contacto`);
  ok(r.status === 405 && r.headers.get('allow') === 'POST', 'GET → 405');
  const burst = [];
  for (let i = 0; i < 7; i++) burst.push((await post({ message: `ráfaga ${i}` }, { ip: '198.51.100.9' })).status);
  ok(burst.slice(0, 5).every((s) => s === 200) && burst.slice(5).every((s) => s === 429), 'límite de frecuencia: 5 pasan, el resto 429', burst.join());
  await stopWorker();

  // 3 · Binding simulado SIN persistencia (perfil de producción previsto)
  await startWorker({ CONTACT_TRANSPORT: 'binding' });
  ok(/Send Email\s+local\s*$/.test(bindingLine) && bindingLine.includes(TO) && bindingLine.includes(FROM), 'binding CONTACT_EMAIL en modo local, restringido al remitente y al destinatario', bindingLine);
  all = '';
  r = await post({ message: 'sin persistencia', email: 'reply-1@example.test' });
  await sleep(300);
  ok(r.status === 200 && r.json.code === 'enviada' && r.json.delivery === 'sent', 'binding: enviada', JSON.stringify(r));
  const [m] = sent();
  ok(m?.from === FROM && m.to === TO && m.subject === 'Nueva consulta web', 'remitente de avisos, destinatario fijo y asunto fijo', JSON.stringify(m));
  const body = m ? readFileSync(m.text, 'utf8') : '';
  ok(body.includes('Correo de respuesta: reply-1@example.test') && body.includes('sin persistencia'), 'el texto lleva el correo de respuesta y el mensaje');
  ok(sent().length === 1 && rows().length === 0, 'sin persistencia no se guarda ninguna fila');
  await stopWorker();
  await startWorker({ CONTACT_TRANSPORT: 'binding', CONTACT_FROM: ALIEN_FROM });
  all = '';
  r = await post({ message: 'remitente ajeno' });
  ok(r.status === 502 && r.json.code === 'fallo' && !r.json.ok && sent().length === 0, 'remitente fuera de la restricción del binding → fallo 502, nada enviado', JSON.stringify(r));
  await stopWorker();

  // 4 · Persistencia sintética + reintento por cron con el mismo id
  await startWorker({ CONTACT_TRANSPORT: 'binding', CONTACT_PERSISTENCE: 'on' });
  all = '';
  r = await post({ message: 'persistida', email: 'p1@example.test' });
  let list = rows();
  ok(r.json.code === 'enviada' && list.length === 1 && list[0].state === 'sent' && /@avisos\.directoproducciones\.com>$/.test(list[0].provider_id ?? ''), 'persistida: fila en estado sent con el messageId', JSON.stringify(list));
  r = await post({ message: 'persistida', email: 'p1@example.test' });
  ok(r.json.code === 'enviada' && sent().length === 1 && rows().length === 1, 'reenvío idéntico: sin segundo envío ni segunda fila');
  await stopWorker();

  // Fallo del binding con persistencia: queda guardada y el cron la entrega cuando el envío vuelve a funcionar.
  await startWorker({ CONTACT_TRANSPORT: 'binding', CONTACT_PERSISTENCE: 'on', CONTACT_FROM: ALIEN_FROM });
  r = await post({ message: 'reintento', email: 'p2@example.test' });
  list = rows().filter((x) => x.email === 'p2@example.test');
  ok(r.status === 202 && r.json.code === 'recibida' && r.json.delivery === 'queued' && list[0]?.state === 'failed', 'fallo del binding → 202 recibida, fila failed', JSON.stringify([r, list]));
  const failedId = list[0]?.id;
  await stopWorker();
  await startWorker({ CONTACT_TRANSPORT: 'binding', CONTACT_PERSISTENCE: 'on' });
  all = '';
  ok((await tick()) === 200 && sent().length === 0, 'cron antes de la espera no reintenta');
  console.log('… esperando 65 s de espera mínima antes del reintento');
  await sleep(65_000);
  ok((await tick()) === 200, 'cron programado responde 200');
  await sleep(1500);
  const after = rows().find((x) => x.id === failedId);
  ok(after?.state === 'sent' && after.attempts === 2 && sent().length === 1, 'el cron reintenta y deja sent (2 intentos, un solo envío)', JSON.stringify(after));
  ok(sent()[0] && readFileSync(sent()[0].text, 'utf8').includes('p2@example.test'), 'el reintento envía la consulta guardada');

  // 5 · Sin PII en los registros del Worker
  ok(!/example\.test|Persona Sintética|Mensaje sintético/.test(output), 'registros del Worker sin datos personales');
  ok(!/Send Email\s+remote/.test(all), 'el binding nunca se usa en modo remoto');
} catch (error) {
  failed++; console.error('ERROR', error);
} finally {
  await stopWorker();
}
console.log(`\n${passed} correctas, ${failed} fallidas`);
process.exit(failed ? 1 : 0);
