export const prerender = false;
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { APP_ENV } from '../../config/flags';
import { LOCAL_CMS_ORIGIN } from '../../config/local-origin';
import { approvedFact } from '../../lib/facts';
import { MAX_BODY_BYTES, parseContact } from '../../lib/contact-mail';
import { resolveContact, submitContact, type ContactEnv } from '../../lib/contact-delivery';
import { contactDb } from '../../lib/contact-db';
import { turnstileEnabled, verifyTurnstile, type TurnstileEnv } from '../../lib/turnstile';

const STATUS: Record<string, number> = { simulada: 200, 'simulada-guardada': 200, enviada: 200, recibida: 202, invalida: 400, origen: 403, verificacion: 403, grande: 413, tipo: 415, limite: 429, tope: 429, 'sin-proveedor': 503, fallo: 502, tiempo: 504 };
const ACCEPTED = new Set(['simulada', 'simulada-guardada', 'enviada', 'recibida']);

// Límite por cliente: binding de Workers Rate Limiting si existe; si no, contador en memoria del isolate.
// ponytail: el contador en memoria es por isolate (aproximado), basta como red de seguridad local.
const recent = new Map<string, number[]>();
async function limited(key: string): Promise<boolean> {
  const binding = (env as { CONTACT_LIMITER?: { limit(o: { key: string }): Promise<{ success: boolean }> } }).CONTACT_LIMITER;
  if (binding) return !(await binding.limit({ key })).success;
  const now = Date.now();
  const hits = (recent.get(key) ?? []).filter((t) => now - t < 60_000);
  hits.push(now);
  recent.set(key, hits);
  if (recent.size > 500) for (const [k, v] of recent) if (v.every((t) => now - t >= 60_000)) recent.delete(k);
  return hits.length > 5;
}

// Lee como máximo MAX_BODY_BYTES: no se confía en Content-Length. Al pasarse, cancela el
// flujo para liberar el resto del cuerpo; un error de lectura se trata como petición inválida.
async function readBody(request: Request): Promise<string | 'grande' | 'invalida'> {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        return 'grande';
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => {});
    return 'invalida';
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) { all.set(c, offset); offset += c.byteLength; }
  return new TextDecoder().decode(all);
}

export const POST: APIRoute = async ({ request }) => {
  const wantsJson = (request.headers.get('accept') ?? '').includes('application/json');
  const respond = (code: string) => {
    const headers = { 'Cache-Control': 'no-store' };
    // Sin JS: redirección con solo un código, nunca datos personales en la URL.
    if (!wantsJson) return new Response(null, { status: 303, headers: { ...headers, Location: `/contacto/?consulta=${code}#consulta` } });
    const ok = ACCEPTED.has(code);
    const delivery = code.startsWith('simulada') ? 'simulated' : code === 'enviada' ? 'sent' : code === 'recibida' ? 'queued' : 'none';
    return Response.json({ ok, code, delivery }, { status: STATUS[code] ?? 500, headers });
  };

  // Con Referrer-Policy: no-referrer, el envío nativo sin JS llega con Origin «null»; solo se acepta
  // si el navegador marca la petición como del mismo origen (Sec-Fetch-Site no es manipulable desde una web).
  const origin = request.headers.get('origin');
  const sameOrigin = origin === LOCAL_CMS_ORIGIN || (origin === 'null' && request.headers.get('sec-fetch-site') === 'same-origin');
  if (!sameOrigin) return respond('origen');
  if (await limited(request.headers.get('cf-connecting-ip') ?? 'sin-ip')) return respond('limite');
  if (!(request.headers.get('content-type') ?? '').startsWith('application/x-www-form-urlencoded')) return respond('tipo');
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) return respond('grande');
  const raw = await readBody(request);
  if (raw === 'grande' || raw === 'invalida') return respond(raw);
  const fields = new URLSearchParams(raw);
  const input = parseContact(fields);
  if (!input) return respond('invalida');
  const bot = env as TurnstileEnv;
  if (turnstileEnabled(bot) && !(await verifyTurnstile(bot, fields.get('cf-turnstile-response'), request.headers.get('cf-connecting-ip')))) return respond('verificacion');

  // El destinatario sale solo del fact aprobado; el cliente no puede elegirlo.
  const to = approvedFact('contact.form_recipient_email')?.value;
  const cfg = resolveContact(env as ContactEnv, APP_ENV);
  if (!to || cfg.transport === 'none') return respond('sin-proveedor');

  const code = await submitContact(cfg, { db: contactDb(env, APP_ENV) }, input, to);
  return respond(code);
};

export const ALL: APIRoute = () => new Response('Método no permitido.', { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } });
