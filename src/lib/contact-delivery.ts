// Entrega de consultas: Cloudflare Email Sending por el binding `send_email` del Worker (CONTACT_EMAIL) y persistencia/reintento opcionales.
// Sin dependencias ni acceso a `cloudflare:workers`: todo entra por parámetros para poder probarlo con dobles y SQLite.
// Sin clave ni secreto: el binding solo existe donde wrangler.jsonc lo declara, restringido a un remitente y un destinatario.
import { buildMail, type ContactInput } from './contact-mail';

export const SEND_TIMEOUT_MS = 8000;
// El binding no admite clave de idempotencia: el id de la fila viaja en X-Contact-Id para reconocer un aviso duplicado.
// Una consulta sin aviso confirmado en 23 h se cierra (dead) para revisión manual: el compromiso de respuesta es de 24 h.
export const RETRY_WINDOW_MS = 23 * 3600_000;
export const DEDUPE_WINDOW_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 5;
export const RETENTION_DAYS = 90; // propuesta pendiente de aprobación legal; ver OPERACION-INFRA.md
// Tope diario global (todas las IP juntas) de intentos de envío al proveedor, además del límite por IP. Workers Paid incluye
// 3.000 correos al mes y las cuentas nuevas empiezan con un cupo diario prudente: 80 al día deja margen para reintentos.
export const DAILY_CAP = 80;
// Prueba real en preview (temporal): tope diario ESTRICTO, mucho menor que DAILY_CAP. Sin D1 o con fallo de D1 se cierra (no hay cupo que contar).
export const PREVIEW_REAL_CAP = 4;
const CLAIM_MS = 30_000;
const RETRY_BATCH = 20;
// Se envía desde el subdominio de avisos, dado de alta en Email Sending (aísla la reputación y el DMARC del correo humano de info@).
export const DEFAULT_CONTACT_FROM = 'formulario@avisos.directoproducciones.com';

// Subconjunto del binding `send_email` (API estructurada) que usa el formulario.
export interface EmailBinding {
  send(message: { from: string; to: string; subject: string; text: string; html: string; replyTo: string; headers: Record<string, string> }): Promise<{ messageId?: string }>;
}

export interface ContactEnv {
  CONTACT_EMAIL?: EmailBinding;
  CONTACT_FROM?: string;
  CONTACT_TRANSPORT?: string;
  CONTACT_PERSISTENCE?: string;
  // Doble interruptor de la prueba real en preview: esta var ('on') + el binding CONTACT_EMAIL declarado en env.preview. Ver RUNBOOK §5b.
  CONTACT_PREVIEW_REAL?: string;
}

export type ContactConfig =
  | { transport: 'none'; persistence: boolean }
  | { transport: 'simulate'; persistence: boolean }
  | { transport: 'cloudflare'; persistence: boolean; binding: EmailBinding; from: string; cap?: number };

const validFrom = (value: string | undefined) => (value && /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(value) ? value : undefined);

// Local simula por defecto; con CONTACT_TRANSPORT=binding usa el binding, que `wrangler dev` simula sin enviar nada (el guard prohíbe
// `remote: true`). Preview también simula. Producción exige el binding: sin él, el formulario no ofrece envío.
export function resolveContact(env: ContactEnv, appEnv: string): ContactConfig {
  const persistence = env.CONTACT_PERSISTENCE === 'on';
  const binding = env.CONTACT_EMAIL;
  const from = validFrom(env.CONTACT_FROM) ?? DEFAULT_CONTACT_FROM;
  if (appEnv === 'local') {
    if (env.CONTACT_TRANSPORT === 'binding' && binding) return { transport: 'cloudflare', persistence, binding, from };
    return { transport: 'simulate', persistence };
  }
  // Preview protegida: simula SIEMPRE salvo prueba real temporal con doble interruptor (var exacta 'on' Y binding declarado) y tope estricto.
  // El destinatario sigue fijado por el fact aprobado en api/contacto.ts; sin ambos interruptores, nada cambia.
  if (appEnv === 'preview') {
    if (env.CONTACT_PREVIEW_REAL === 'on' && binding) return { transport: 'cloudflare', persistence, binding, from, cap: PREVIEW_REAL_CAP };
    return { transport: 'simulate', persistence };
  }
  if (!binding) return { transport: 'none', persistence };
  return { transport: 'cloudflare', persistence, binding, from };
}

export type SendOutcome =
  | { ok: true; providerId: string }
  | { ok: false; retryable: boolean; code: string; timeout?: boolean };

// Códigos de Email Sending que no dicen nada del contenido: se reintentan. E_DELIVERY_FAILED también, porque el destinatario es el
// buzón propio (info@) y una caída de su servidor es transitoria; y el estado del dominio de envío (alta sin terminar o inactiva), que se
// arregla en el panel sin redesplegar. El resto (validación, restricciones del binding, supresión, suspensión) es definitivo.
const RETRYABLE = new Set(['E_RATE_LIMIT_EXCEEDED', 'E_DAILY_LIMIT_EXCEEDED', 'E_INTERNAL_SERVER_ERROR', 'E_EMAIL_SENDING_NOT_READY', 'E_DELIVERY_FAILED',
  'E_SENDER_DOMAIN_NOT_AVAILABLE', 'E_SENDER_DOMAIN_NOT_CONFIGURED']);

// Un único intento. El código devuelto nunca contiene el cuerpo ni datos personales.
export async function sendViaCloudflare(
  cfg: Extract<ContactConfig, { transport: 'cloudflare' }>,
  input: ContactInput,
  to: string,
  contactId: string,
  timeoutMs = SEND_TIMEOUT_MS,
): Promise<SendOutcome> {
  const mail = buildMail(input, to, cfg.from);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<'tiempo'>((resolve) => { timer = setTimeout(() => resolve('tiempo'), timeoutMs); });
  try {
    const sent = cfg.binding.send({ from: mail.from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html, replyTo: mail.replyTo, headers: { 'X-Contact-Id': contactId } });
    const result = await Promise.race([sent, expired]);
    // Sin confirmación en plazo el resultado es incierto: se reintenta (puede duplicar el aviso; X-Contact-Id permite reconocerlo).
    if (result === 'tiempo') return { ok: false, retryable: true, code: 'E_TIMEOUT', timeout: true };
    return { ok: true, providerId: typeof result?.messageId === 'string' && result.messageId ? result.messageId : 'sin-id' };
  } catch (error) {
    // Argumento mal formado (sin `code`): defecto nuestro, no se reintenta.
    if (error instanceof TypeError) return { ok: false, retryable: false, code: 'E_PETICION' };
    const raw = (error as { code?: unknown } | null)?.code;
    const code = typeof raw === 'string' && /^E_[A-Z0-9_]+$/.test(raw) ? raw : 'E_DESCONOCIDO';
    // Un error sin código reconocible no prueba que el aviso se haya perdido para siempre: se reintenta.
    return { ok: false, retryable: code === 'E_DESCONOCIDO' || RETRYABLE.has(code), code };
  } finally {
    clearTimeout(timer);
  }
}

// ── Persistencia sintética (solo con CONTACT_PERSISTENCE=on) ───────────────────────────────────────────────────

export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta?: { changes?: number } }>;
  all<T>(): Promise<{ results: T[] }>;
}
export interface D1Like { prepare(query: string): D1Statement }
export interface Deps {
  db?: D1Like;
  now?: () => number;
  uuid?: () => string;
  log?: (code: string) => void;
  timeoutMs?: number;
}
const dep = (d: Deps) => ({
  now: d.now ?? Date.now,
  uuid: d.uuid ?? (() => crypto.randomUUID()),
  log: d.log ?? ((code: string) => console.error('contacto: envío fallido', code)),
  timeoutMs: d.timeoutMs ?? SEND_TIMEOUT_MS,
});

export type DeliveryCode = 'enviada' | 'simulada' | 'simulada-guardada' | 'recibida' | 'fallo' | 'tiempo' | 'sin-proveedor' | 'tope';

// Contador atómico por día UTC en la D1 de solicitudes (contact_daily). Cuenta intentos con transporte real, también los rechazados por
// el tope (suma antes de comparar); lo simulado no gasta cupo.
// Si la tabla falta o D1 falla, no bloquea: sigue el límite por IP y un formulario caído es peor que agotar el cupo.
async function overDailyCap(cfg: ContactConfig, d: Deps): Promise<boolean> {
  if (cfg.transport !== 'cloudflare') return false;
  if (!d.db) return cfg.cap !== undefined; // tope estricto: sin D1 no se puede contar, se cierra
  const x = dep(d);
  try {
    const row = await d.db.prepare('INSERT INTO contact_daily (day, sends) VALUES (?1, 1) ON CONFLICT(day) DO UPDATE SET sends = sends + 1 RETURNING sends')
      .bind(new Date(x.now()).toISOString().slice(0, 10)).first<{ sends: number }>();
    return Number(row?.sends) > (cfg.cap ?? DAILY_CAP);
  } catch {
    x.log('E_TOPE_NO_DISPONIBLE');
    return cfg.cap !== undefined; // tope estricto: sin contador, se cierra
  }
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function contentHash(input: ContactInput, to: string) {
  const data = new TextEncoder().encode(JSON.stringify([input.name, input.email, input.service, input.message, to]));
  return hex(await crypto.subtle.digest('SHA-256', data));
}

interface Row { id: string; name: string; email: string; service: string; message: string; state: string; attempts: number; first_attempt_at: number | null }
export const backoffMs = (attempts: number) => Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 3600_000);

// Reclama la fila con una cesión corta (evita que POST y cron envíen a la vez) e intenta el envío con SU id.
async function attempt(cfg: ContactConfig, d: Deps, id: string, to: string): Promise<SendOutcome | 'ocupada' | 'cerrada' | 'tope'> {
  if (await overDailyCap(cfg, d)) return 'tope'; // sin reclamar la fila: queda pendiente para el día siguiente
  const x = dep(d), db = d.db!;
  const now = x.now();
  const claim = await db.prepare(
    `UPDATE contact_submissions SET claimed_until = ?2, attempts = attempts + 1, first_attempt_at = COALESCE(first_attempt_at, ?3), updated_at = ?3
     WHERE id = ?1 AND state IN ('received', 'failed') AND claimed_until < ?3`,
  ).bind(id, now + CLAIM_MS, now).run();
  if (claim.meta?.changes !== 1) return 'ocupada';
  const row = await db.prepare('SELECT id, name, email, service, message, state, attempts, first_attempt_at FROM contact_submissions WHERE id = ?1').bind(id).first<Row>();
  if (!row) return 'cerrada';
  let outcome: SendOutcome;
  if (cfg.transport === 'cloudflare') outcome = await sendViaCloudflare(cfg, { name: row.name, email: row.email, service: row.service, message: row.message }, to, row.id, x.timeoutMs);
  else outcome = cfg.transport === 'simulate' ? { ok: true, providerId: 'simulado' } : { ok: false, retryable: false, code: 'E_SIN_PROVEEDOR' };
  const t = x.now();
  if (outcome.ok) {
    await db.prepare(`UPDATE contact_submissions SET state = 'sent', provider_id = ?2, last_error = NULL, claimed_until = 0, updated_at = ?3 WHERE id = ?1`).bind(id, outcome.providerId, t).run();
  } else {
    x.log(outcome.code);
    const state = outcome.retryable && row.attempts < MAX_ATTEMPTS ? 'failed' : 'dead';
    await db.prepare(`UPDATE contact_submissions SET state = ?2, last_error = ?3, claimed_until = 0, updated_at = ?4 WHERE id = ?1`).bind(id, state, outcome.code, t).run();
  }
  return outcome;
}

// Punto de entrada del formulario. `to` es siempre el destinatario aprobado (fact), nunca un dato del cliente.
export async function submitContact(cfg: ContactConfig, d: Deps, input: ContactInput, to: string): Promise<DeliveryCode> {
  if (cfg.transport === 'none') return 'sin-proveedor';
  const x = dep(d);
  const okCode = (stored: boolean): DeliveryCode => (cfg.transport === 'simulate' ? (stored ? 'simulada-guardada' : 'simulada') : 'enviada');
  const fail = (o: Extract<SendOutcome, { ok: false }>, stored: boolean): DeliveryCode =>
    stored && o.retryable ? 'recibida' : o.timeout ? 'tiempo' : 'fallo';

  if (!cfg.persistence || !d.db) {
    // Sin persistencia: el id se crea antes del intento, pero no hay dónde reutilizarlo; no hay reintentos.
    if (cfg.transport === 'simulate') return 'simulada';
    if (await overDailyCap(cfg, d)) return 'tope';
    const outcome = await sendViaCloudflare(cfg, input, to, x.uuid(), x.timeoutMs);
    if (outcome.ok) return 'enviada';
    x.log(outcome.code);
    return fail(outcome, false);
  }

  const db = d.db, now = x.now(), hash = await contentHash(input, to);
  // Reenvío del mismo contenido en pocos minutos = misma consulta: se reutiliza la fila y no se duplica.
  const prior = await db.prepare('SELECT id, state FROM contact_submissions WHERE content_hash = ?1 AND created_at > ?2 ORDER BY created_at DESC LIMIT 1').bind(hash, now - DEDUPE_WINDOW_MS).first<{ id: string; state: string }>();
  if (prior?.state === 'sent') return okCode(true);
  // Una consulta cerrada (dead) no se reabre: reenviarla es una decisión nueva del visitante y lleva id nuevo.
  let id = prior && (prior.state === 'received' || prior.state === 'failed') ? prior.id : undefined;
  if (!id) {
    id = x.uuid();
    await db.prepare(`INSERT INTO contact_submissions (id, content_hash, name, email, service, message, state, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'received', ?7, ?7)`)
      .bind(id, hash, input.name, input.email, input.service, input.message, now).run();
  }
  const outcome = await attempt(cfg, d, id, to);
  if (outcome === 'ocupada' || outcome === 'tope') return 'recibida'; // otro intento en curso, o tope del día: guardada para el cron
  if (outcome === 'cerrada') return 'fallo';
  return outcome.ok ? okCode(true) : fail(outcome, true);
}

// Cron: reintenta pendientes con espera creciente, cierra las que superan intentos o la ventana de reintento y purga por retención.
export async function retryPending(cfg: ContactConfig, d: Deps, to: string): Promise<{ retried: number; expired: number; purged: number }> {
  const x = dep(d), db = d.db;
  const stats = { retried: 0, expired: 0, purged: 0 };
  if (!db || !cfg.persistence) return stats;
  const now = x.now();
  const due = await db.prepare(
    `SELECT id, state, attempts, first_attempt_at, updated_at FROM contact_submissions
     WHERE state IN ('received', 'failed') AND claimed_until < ?1 ORDER BY updated_at LIMIT ?2`,
  ).bind(now, RETRY_BATCH).all<Row & { updated_at: number }>();
  for (const row of due.results) {
    if (row.first_attempt_at !== null && now - row.first_attempt_at >= RETRY_WINDOW_MS) {
      await db.prepare(`UPDATE contact_submissions SET state = 'dead', last_error = 'ventana-reintento', updated_at = ?2 WHERE id = ?1`).bind(row.id, now).run();
      stats.expired++;
      continue;
    }
    if (row.attempts > 0 && now < row.updated_at + backoffMs(row.attempts)) continue;
    if ((await attempt(cfg, d, row.id, to)) === 'tope') break; // el resto espera al día siguiente
    stats.retried++;
  }
  const purged = await db.prepare('DELETE FROM contact_submissions WHERE created_at < ?1').bind(now - RETENTION_DAYS * 86_400_000).run();
  stats.purged = purged.meta?.changes ?? 0;
  return stats;
}
