import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  DAILY_CAP, PREVIEW_REAL_CAP, DEFAULT_CONTACT_FROM, RETRY_WINDOW_MS, MAX_ATTEMPTS, RETENTION_DAYS, backoffMs, resolveContact,
  retryPending, sendViaCloudflare, submitContact, type ContactConfig, type D1Like, type D1Statement, type EmailBinding, type SendOutcome,
} from '../src/lib/contact-delivery.ts';

// Todo sintético: ningún correo real, ningún binding real, SQLite en memoria con la migración real.
const TO = 'info@directoproducciones.com';
const input = { name: 'Persona Sintética', email: 'visita@example.test', service: 'Otro proyecto', message: 'Mensaje de prueba sintético.' };
type Cloudflare = Extract<ContactConfig, { transport: 'cloudflare' }>;
type Sent = Parameters<EmailBinding['send']>[0];
// Respuesta del binding: 'ok', 'lento' (nunca responde), un código de Email Sending, 'tipo' (TypeError) o 'sin-codigo' (Error sin code).
type Plan = 'ok' | 'lento' | 'tipo' | 'sin-codigo' | `E_${string}`;

function d1(db: DatabaseSync): D1Like {
  return {
    prepare(query) {
      const st = db.prepare(query);
      const make = (values: unknown[]): D1Statement => ({
        bind: (...v: unknown[]) => make(v),
        first: async () => (st.get(...(values as never[])) as never) ?? null,
        run: async () => ({ meta: { changes: Number(st.run(...(values as never[])).changes) } }),
        all: async () => ({ results: st.all(...(values as never[])) as never[] }),
      });
      return make([]);
    },
  };
}
function fakeBinding(plans: Plan[]) {
  const calls: Sent[] = [];
  let n = 0;
  const binding: EmailBinding = {
    async send(message) {
      calls.push(message);
      const plan = plans[Math.min(n++, plans.length - 1)];
      if (plan === 'ok') return { messageId: `<prov-${n}@avisos.directoproducciones.com>` };
      if (plan === 'lento') return new Promise(() => {});
      if (plan === 'tipo') throw new TypeError('mensaje mal formado');
      if (plan === 'sin-codigo') throw new Error('fallo sin código');
      throw Object.assign(new Error('simulado'), { code: plan });
    },
  };
  return { binding, calls };
}
const cfgWith = (binding: EmailBinding) => (persistence: boolean): Cloudflare => ({ transport: 'cloudflare', persistence, binding, from: DEFAULT_CONTACT_FROM });
function setup(plans: Plan[], start = 1_000_000, daily = true) {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync('migrations/0002_contact_submissions.sql', 'utf8'));
  if (daily) db.exec(readFileSync('migrations/0003_contact_daily.sql', 'utf8'));
  const { binding, calls } = fakeBinding(plans);
  const logs: string[] = [];
  let clock = start, seq = 0;
  const deps = { db: d1(db), now: () => clock, uuid: () => `id-${++seq}`, log: (c: string) => logs.push(c) };
  return { db, deps, calls, logs, cfg: cfgWith(binding), advance: (ms: number) => (clock += ms) };
}
const rows = (db: DatabaseSync) => db.prepare('SELECT * FROM contact_submissions ORDER BY created_at, id').all() as any[];

const binding = fakeBinding(['ok']).binding;

test('local simula salvo CONTACT_TRANSPORT=binding con el binding (que wrangler dev simula); preview simula; producción exige el binding', () => {
  assert.equal(resolveContact({ CONTACT_EMAIL: binding }, 'local').transport, 'simulate');
  assert.equal(resolveContact({ CONTACT_TRANSPORT: 'binding' }, 'local').transport, 'simulate', 'sin binding no hay transporte');
  assert.equal(resolveContact({ CONTACT_TRANSPORT: 'mock-http', CONTACT_EMAIL: binding }, 'local').transport, 'simulate', 'el modo HTTP antiguo ya no existe');
  const local = resolveContact({ CONTACT_TRANSPORT: 'binding', CONTACT_EMAIL: binding }, 'local') as Cloudflare;
  assert.equal(local.transport, 'cloudflare'); assert.equal(local.binding, binding); assert.equal(local.cap, undefined);
  assert.equal(resolveContact({ CONTACT_EMAIL: binding, CONTACT_TRANSPORT: 'binding' }, 'preview').transport, 'simulate', 'preview nunca envía correo real');
  assert.equal(resolveContact({}, 'production').transport, 'none');
  const prod = resolveContact({ CONTACT_EMAIL: binding }, 'production') as Cloudflare;
  assert.equal(prod.transport, 'cloudflare'); assert.equal(prod.from, DEFAULT_CONTACT_FROM); assert.equal(prod.cap, undefined);
  assert.equal((resolveContact({ CONTACT_EMAIL: binding, CONTACT_FROM: 'otro@avisos.directoproducciones.com' }, 'production') as Cloudflare).from, 'otro@avisos.directoproducciones.com');
  assert.equal((resolveContact({ CONTACT_EMAIL: binding, CONTACT_FROM: 'mal formado' }, 'production') as Cloudflare).from, DEFAULT_CONTACT_FROM);
});

test('mensaje al binding: destinatario fijo, Reply-To del visitante, asunto fijo y X-Contact-Id', async () => {
  const t = setup(['ok']);
  const out = await sendViaCloudflare(t.cfg(false), input, TO, 'id-fila');
  assert.deepEqual(out, { ok: true, providerId: '<prov-1@avisos.directoproducciones.com>' });
  const [m] = t.calls;
  assert.equal(m.to, TO);
  assert.equal(m.from, DEFAULT_CONTACT_FROM);
  assert.equal(m.replyTo, input.email);
  assert.equal(m.subject, 'Nueva consulta web'); // asunto fijo: sin datos del visitante
  assert.deepEqual(m.headers, { 'X-Contact-Id': 'id-fila' });
  assert.ok(m.html.includes('Persona Sintética') && m.text.includes('Persona Sintética'));
});

test('clasificación de errores de Email Sending', async () => {
  const kinds: Array<[Plan, boolean, string]> = [
    ['E_VALIDATION_ERROR', false, 'E_VALIDATION_ERROR'], ['E_SENDER_NOT_VERIFIED', false, 'E_SENDER_NOT_VERIFIED'],
    ['E_SENDER_DOMAIN_NOT_AVAILABLE', true, 'E_SENDER_DOMAIN_NOT_AVAILABLE'], ['E_SENDER_DOMAIN_NOT_CONFIGURED', true, 'E_SENDER_DOMAIN_NOT_CONFIGURED'], ['E_RECIPIENT_NOT_ALLOWED', false, 'E_RECIPIENT_NOT_ALLOWED'],
    ['E_RECIPIENT_SUPPRESSED', false, 'E_RECIPIENT_SUPPRESSED'], ['E_ACCOUNT_SUSPENDED', false, 'E_ACCOUNT_SUSPENDED'],
    ['E_RATE_LIMIT_EXCEEDED', true, 'E_RATE_LIMIT_EXCEEDED'], ['E_DAILY_LIMIT_EXCEEDED', true, 'E_DAILY_LIMIT_EXCEEDED'],
    ['E_INTERNAL_SERVER_ERROR', true, 'E_INTERNAL_SERVER_ERROR'], ['E_EMAIL_SENDING_NOT_READY', true, 'E_EMAIL_SENDING_NOT_READY'],
    ['E_DELIVERY_FAILED', true, 'E_DELIVERY_FAILED'], ['tipo', false, 'E_PETICION'], ['sin-codigo', true, 'E_DESCONOCIDO'],
  ];
  for (const [plan, retryable, code] of kinds) {
    const out = (await sendViaCloudflare(setup([plan]).cfg(false), input, TO, 'k')) as Extract<SendOutcome, { ok: false }>;
    assert.equal(out.ok, false); assert.equal(out.retryable, retryable, code); assert.equal(out.code, code);
  }
  // Un `code` que no tiene forma de código de Email Sending no se copia a los registros.
  const weird = { send: async () => { throw Object.assign(new Error('x'), { code: 'visita@example.test' }); } };
  assert.deepEqual(await sendViaCloudflare({ ...setup(['ok']).cfg(false), binding: weird }, input, TO, 'k'), { ok: false, retryable: true, code: 'E_DESCONOCIDO' });
});

test('sin respuesta del binding en plazo: E_TIMEOUT reintentable', async () => {
  const t0 = Date.now();
  assert.deepEqual(await sendViaCloudflare(setup(['lento']).cfg(false), input, TO, 'k', 50), { ok: false, retryable: true, code: 'E_TIMEOUT', timeout: true });
  assert.ok(Date.now() - t0 < 2000);
});

test('sin persistencia: éxito, error definitivo y timeout; sin reintentos ni almacenamiento', async () => {
  const a = setup(['ok']);
  assert.equal(await submitContact(a.cfg(false), { ...a.deps, db: undefined }, input, TO), 'enviada');
  const b = setup(['E_VALIDATION_ERROR']);
  assert.equal(await submitContact(b.cfg(false), b.deps, input, TO), 'fallo');
  assert.equal(rows(b.db).length, 0);
  const c = setup(['lento']);
  assert.equal(await submitContact(c.cfg(false), { ...c.deps, timeoutMs: 50 }, input, TO), 'tiempo');
  assert.equal(await submitContact({ transport: 'none', persistence: false }, c.deps, input, TO), 'sin-proveedor');
  assert.equal(await submitContact({ transport: 'simulate', persistence: false }, c.deps, input, TO), 'simulada');
  assert.equal(c.calls.length, 1);
});

test('persistencia: guarda antes del envío, usa su id en X-Contact-Id y queda en sent con el messageId', async () => {
  const t = setup(['ok']);
  assert.equal(await submitContact(t.cfg(true), t.deps, input, TO), 'enviada');
  const [row] = rows(t.db);
  assert.equal(row.state, 'sent'); assert.equal(row.attempts, 1); assert.equal(row.provider_id, '<prov-1@avisos.directoproducciones.com>');
  assert.equal(t.calls[0].headers['X-Contact-Id'], row.id);
});

test('fallo transitorio: queda recibida, el cron reintenta con el MISMO id tras la espera', async () => {
  const t = setup(['E_INTERNAL_SERVER_ERROR', 'ok']);
  assert.equal(await submitContact(t.cfg(true), t.deps, input, TO), 'recibida');
  assert.equal(rows(t.db)[0].state, 'failed');
  assert.deepEqual(await retryPending(t.cfg(true), t.deps, TO), { retried: 0, expired: 0, purged: 0 }); // aún en espera
  t.advance(backoffMs(1) + 31_000);
  assert.equal((await retryPending(t.cfg(true), t.deps, TO)).retried, 1);
  assert.equal(rows(t.db)[0].state, 'sent'); assert.equal(rows(t.db)[0].attempts, 2);
  assert.equal(t.calls.length, 2);
  assert.equal(t.calls[0].headers['X-Contact-Id'], t.calls[1].headers['X-Contact-Id']);
});

test('timeout con persistencia: recibida y fila failed (reintentable)', async () => {
  const t = setup(['lento']);
  assert.equal(await submitContact(t.cfg(true), { ...t.deps, timeoutMs: 50 }, input, TO), 'recibida');
  assert.equal(rows(t.db)[0].state, 'failed'); assert.equal(rows(t.db)[0].last_error, 'E_TIMEOUT');
});

test('el mismo contenido reenviado en minutos no duplica el envío ni cambia de id', async () => {
  const sent = setup(['ok']);
  await submitContact(sent.cfg(true), sent.deps, input, TO);
  assert.equal(await submitContact(sent.cfg(true), sent.deps, input, TO), 'enviada');
  assert.equal(sent.calls.length, 1); assert.equal(rows(sent.db).length, 1);
  const failing = setup(['E_RATE_LIMIT_EXCEEDED', 'ok']);
  await submitContact(failing.cfg(true), failing.deps, input, TO);
  failing.advance(31_000); // fin de la cesión; el visitante pulsa de nuevo
  assert.equal(await submitContact(failing.cfg(true), failing.deps, input, TO), 'enviada');
  assert.equal(rows(failing.db).length, 1);
  assert.equal(failing.calls[0].headers['X-Contact-Id'], failing.calls[1].headers['X-Contact-Id']);
  const other = setup(['ok']);
  await submitContact(other.cfg(true), other.deps, input, TO);
  other.advance(11 * 60_000);
  await submitContact(other.cfg(true), other.deps, input, TO); // pasada la ventana de dedupe = consulta nueva
  assert.equal(rows(other.db).length, 2);
});

test('error definitivo: dead, sin reintentos, y el visitante ve fallo', async () => {
  const t = setup(['E_RECIPIENT_NOT_ALLOWED']);
  assert.equal(await submitContact(t.cfg(true), t.deps, input, TO), 'fallo');
  assert.equal(rows(t.db)[0].state, 'dead'); assert.equal(rows(t.db)[0].last_error, 'E_RECIPIENT_NOT_ALLOWED');
  t.advance(2 * 3600_000);
  assert.equal((await retryPending(t.cfg(true), t.deps, TO)).retried, 0);
  assert.equal(t.calls.length, 1);
});

test('pasada la ventana de reintento la consulta se cierra para revisión manual', async () => {
  const t = setup(['E_INTERNAL_SERVER_ERROR', 'ok']);
  await submitContact(t.cfg(true), t.deps, input, TO);
  t.advance(RETRY_WINDOW_MS + 1000);
  assert.deepEqual(await retryPending(t.cfg(true), t.deps, TO), { retried: 0, expired: 1, purged: 0 });
  assert.equal(rows(t.db)[0].state, 'dead'); assert.equal(rows(t.db)[0].last_error, 'ventana-reintento');
  assert.equal(t.calls.length, 1);
});

test('tope de intentos', async () => {
  const t = setup(['E_INTERNAL_SERVER_ERROR']);
  await submitContact(t.cfg(true), t.deps, input, TO);
  for (let i = 0; i < MAX_ATTEMPTS + 2; i++) { t.advance(3600_000 * 0.9); await retryPending(t.cfg(true), t.deps, TO); if (rows(t.db)[0].state === 'dead') break; }
  assert.equal(rows(t.db)[0].state, 'dead'); assert.ok(rows(t.db)[0].attempts <= MAX_ATTEMPTS);
});

test('cesión: un intento en curso no se duplica', async () => {
  const t = setup(['ok']);
  await submitContact(t.cfg(true), t.deps, input, TO); // sent
  t.db.exec(`INSERT INTO contact_submissions (id, content_hash, name, email, message, state, created_at, updated_at, claimed_until) VALUES ('x', 'h', 'n', 'e@e.test', 'm', 'received', 1000000, 1000000, 9999999999)`);
  assert.equal((await retryPending(t.cfg(true), t.deps, TO)).retried, 0);
  assert.equal(t.calls.length, 1);
});

test('retención: el cron purga lo anterior al plazo', async () => {
  const t = setup(['ok']);
  await submitContact(t.cfg(true), t.deps, input, TO);
  t.advance((RETENTION_DAYS + 1) * 86_400_000);
  assert.equal((await retryPending(t.cfg(true), t.deps, TO)).purged, 1);
  assert.equal(rows(t.db).length, 0);
});

test('simulado con persistencia: estado sent sintético y mensaje honesto', async () => {
  const t = setup(['ok']);
  assert.equal(await submitContact({ transport: 'simulate', persistence: true }, t.deps, input, TO), 'simulada-guardada');
  assert.equal(rows(t.db)[0].provider_id, 'simulado'); assert.equal(t.calls.length, 0);
});

test('tope diario global: sin persistencia no llama al proveedor; con persistencia guarda y el cron envía al día siguiente', async () => {
  assert.equal(readFileSync('migrations-solicitudes/0002_contact_daily.sql', 'utf8'), readFileSync('migrations/0003_contact_daily.sql', 'utf8'));
  const fill = (t: ReturnType<typeof setup>, n: number) => t.db.prepare('INSERT INTO contact_daily (day, sends) VALUES (?, ?)').run('1970-01-01', n);
  const a = setup(['ok']);
  fill(a, DAILY_CAP - 1);
  assert.equal(await submitContact(a.cfg(false), a.deps, input, TO), 'enviada'); // el último del cupo sale
  assert.equal(await submitContact(a.cfg(false), a.deps, input, TO), 'tope');
  assert.equal(a.calls.length, 1);
  assert.equal(await submitContact({ transport: 'simulate', persistence: false }, a.deps, input, TO), 'simulada'); // lo simulado no gasta cupo
  const b = setup(['ok']);
  fill(b, DAILY_CAP);
  assert.equal(await submitContact(b.cfg(true), b.deps, input, TO), 'recibida');
  assert.equal(rows(b.db)[0].state, 'received'); assert.equal(rows(b.db)[0].attempts, 0); assert.equal(b.calls.length, 0);
  b.advance(3600_000);
  assert.equal((await retryPending(b.cfg(true), b.deps, TO)).retried, 0); // mismo día UTC: sigue guardada
  b.advance(86_400_000);
  assert.equal((await retryPending(b.cfg(true), b.deps, TO)).retried, 1);
  assert.equal(rows(b.db)[0].state, 'sent'); assert.equal(b.calls.length, 1);
  const c = setup(['ok'], 1_000_000, false); // sin la tabla (migración sin aplicar): no bloquea y deja un código
  assert.equal(await submitContact(c.cfg(false), c.deps, input, TO), 'enviada');
  assert.deepEqual(c.logs, ['E_TOPE_NO_DISPONIBLE']);
});

test('los registros de error solo llevan códigos, nunca datos personales', async () => {
  const t = setup(['E_INTERNAL_SERVER_ERROR', 'sin-codigo', 'E_VALIDATION_ERROR']);
  await submitContact(t.cfg(true), t.deps, input, TO);
  t.advance(10 * 60_000 + 1);
  await submitContact(t.cfg(true), t.deps, { ...input, message: 'otro' }, TO);
  assert.ok(t.logs.length >= 2);
  for (const line of t.logs) assert.match(line, /^E_[A-Z0-9_]+$/);
});

test('preview: simula salvo doble interruptor; con él, envía real con tope estricto que cierra sin D1', async () => {
  for (const env of [{ CONTACT_EMAIL: binding }, { CONTACT_PREVIEW_REAL: 'on' }, { CONTACT_EMAIL: binding, CONTACT_PREVIEW_REAL: 'true' }, { CONTACT_EMAIL: binding, CONTACT_PREVIEW_REAL: 'off' }]) {
    assert.equal(resolveContact(env, 'preview').transport, 'simulate');
  }
  assert.equal(resolveContact({ CONTACT_PREVIEW_REAL: 'on', CONTACT_EMAIL: binding }, 'local').transport, 'simulate', 'local no se ve afectado');
  const s = setup(['ok']);
  const real = resolveContact({ CONTACT_EMAIL: (s.cfg(false) as Cloudflare).binding, CONTACT_PREVIEW_REAL: 'on' }, 'preview') as Cloudflare;
  assert.equal(real.transport, 'cloudflare');
  assert.equal(real.cap, PREVIEW_REAL_CAP);
  assert.ok(PREVIEW_REAL_CAP < DAILY_CAP);
  // Sin D1 (sin contador) el tope estricto cierra y no llama al proveedor.
  assert.equal(await submitContact({ ...real, persistence: false }, {}, input, TO), 'tope');
  assert.equal(s.calls.length, 0);
  // Con D1: PREVIEW_REAL_CAP envíos pasan y el siguiente se rechaza.
  const cap = { ...real, persistence: false };
  for (let i = 0; i < PREVIEW_REAL_CAP; i++) assert.equal(await submitContact(cap, s.deps, input, TO), 'enviada');
  assert.equal(await submitContact(cap, s.deps, input, TO), 'tope');
  assert.equal(s.calls.length, PREVIEW_REAL_CAP);
  assert.ok(s.calls.every((m) => m.to === TO));
  // Contador roto: también cierra.
  const broken = { ...s.deps, db: { prepare: () => { throw new Error('d1'); } } as unknown as D1Like };
  assert.equal(await submitContact(cap, broken, input, TO), 'tope');
});
