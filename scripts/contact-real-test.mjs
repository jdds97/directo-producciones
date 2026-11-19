// Prueba de entrega DIRECTA por la API REST de Cloudflare Email Sending (un único correo), con el mismo remitente y destinatario que el Worker.
// Solo se ejecuta a mano, tras dar de alta avisos.directoproducciones.com en Email Sending. Por defecto NO envía (simulacro); hace falta --enviar.
//   read -rs CLOUDFLARE_API_TOKEN; export CLOUDFLARE_API_TOKEN   # token con permiso de envío de Email Sending; se teclea, nunca como argumento
//   export CLOUDFLARE_ACCOUNT_ID=<id de la cuenta>
//   node scripts/contact-real-test.mjs [--enviar] [--reply-to correo@del-propietario]
// El destinatario sale del fact aprobado contact.form_recipient_email; el token solo se lee del entorno y no se imprime.
import { readFileSync } from 'node:fs';

const DEFAULT_FROM = 'formulario@avisos.directoproducciones.com'; // = DEFAULT_CONTACT_FROM de src/lib/contact-delivery.ts
const args = process.argv.slice(2);
const send = args.includes('--enviar');
const ri = args.indexOf('--reply-to');
const replyTo = ri >= 0 ? args[ri + 1] : undefined;
if (args.some((a) => /^[A-Za-z0-9_-]{35,}$/.test(a))) { console.error('Error: el token no se pasa por argumentos. Usa la variable CLOUDFLARE_API_TOKEN.'); process.exit(2); }
if (replyTo && !/^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(replyTo)) { console.error('Error: --reply-to no es un correo válido.'); process.exit(2); }

// Destinatario: valor del fact, que debe constar `status: approved`. Lectura textual para no depender de un parser YAML.
const facts = readFileSync(new URL('../content/facts.yaml', import.meta.url), 'utf8');
const block = facts.split(/\n(?=\s*- id: )/).find((b) => /id:\s*contact\.form_recipient_email\b/.test(b));
const to = !/status:\s*approved\b/.test(block ?? '') ? undefined : block?.match(/value:\s*"?([^\s"#]+@[^\s"#]+)"?/)?.[1];
if (!to) { console.error('Error: no se encuentra contact.form_recipient_email en content/facts.yaml.'); process.exit(2); }
const from = process.env.CONTACT_FROM || DEFAULT_FROM;
const payload = {
  from, to, subject: 'Nueva consulta web',
  text: 'Prueba de entrega autorizada, sin datos personales.', ...(replyTo ? { reply_to: replyTo } : {}),
};
console.log(`Remitente: ${from}\nDestinatario: ${to}\nReply-To: ${replyTo ?? '(ninguno)'}`);
if (!send) { console.log('Simulacro: no se envía nada. Añade --enviar para el envío real (1 correo).'); process.exit(0); }
const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !/^[0-9a-f]{32}$/.test(account ?? '')) { console.error('Error: faltan CLOUDFLARE_API_TOKEN o CLOUDFLARE_ACCOUNT_ID (32 hex) en el entorno.'); process.exit(2); }
const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/email/sending/send`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(payload), signal: AbortSignal.timeout(15000),
}).catch((e) => { console.error(`Error de red: ${e.name}`); process.exit(1); });
const body = await res.json().catch(() => ({}));
// Solo estado, id y códigos de error: nunca el token ni cabeceras de petición.
const r = body.result ?? {};
console.log(body.success
  ? `Enviado. id=${r.message_id ?? 'sin-id'} entregado=${(r.delivered ?? []).length} en cola=${(r.queued ?? []).length} rebotes=${(r.permanent_bounces ?? []).length}`
  : `Rechazado: HTTP ${res.status} ${(body.errors ?? []).map((e) => `${e.code} ${e.message}`).join('; ')}`.trim());
process.exit(body.success && !(r.permanent_bounces ?? []).length ? 0 : 1);
