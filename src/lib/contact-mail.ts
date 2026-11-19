// Validación y composición de la consulta de contacto. El destinatario nunca viene del cliente.
// También la importa el script del navegador: sin imports. facts.ts metería el registro de hechos en el JS público, y flags.ts
// lee `process` al cargarse, que en `npm run dev` Vite no sustituye en el cliente (ReferenceError y el formulario sin JS).
type AppEnv = 'local' | 'preview' | 'production';
// Mismo orden que APP_ENV de flags.ts: DP_BUILD_ENV (astro.config.mjs) llega también al cliente, en dev y en build; tsx usa process.env.
const ENV = (import.meta.env?.DP_BUILD_ENV ?? globalThis.process?.env?.APP_ENV ?? 'local') as AppEnv;

export const SERVICES = ['Producción audiovisual', 'Comunicación y marketing', 'Otro proyecto'] as const;
export const MAX_BODY_BYTES = 8192;

// Solo se remite a WhatsApp: contact.whatsapp_secondary_phone es required_for_launch (producción no valida sin aprobarlo) y
// WhatsAppAccess lo pinta en todas las páginas. El teléfono y el correo públicos no salen en producción sin aprobar (publicContact).
export function resultMessages(env: AppEnv): Record<string, string> {
  // Producción nunca simula (resolveContact): sin estas claves, un ?consulta=simulada escrito a mano no pinta nada.
  const review = env === 'production' ? null : env === 'local' ? 'Revisión local' : 'Vista previa privada';
  return {
    ...(review && {
      simulada: `${review}: la consulta se ha procesado, pero el envío está simulado. No se ha entregado ningún correo real ni se ha guardado el mensaje.`,
      'simulada-guardada': `${review}: envío simulado. No se ha entregado ningún correo real; el mensaje se ha guardado en la base de pruebas de este entorno.`,
    }),
    enviada: 'Consulta enviada. Gracias por escribirnos.',
    recibida: 'Hemos recibido tu consulta, pero el aviso por correo aún no se ha confirmado. Volveremos a intentarlo; si es urgente, usa WhatsApp.',
    limite: 'Has enviado varias consultas seguidas. Espera un minuto antes de volver a intentarlo. No se ha enviado nada.',
    tope: 'Hoy ya no podemos recibir más consultas por la web; el formulario vuelve a estar disponible mañana. No se ha enviado nada: usa WhatsApp.',
    invalida: 'Revisa el nombre, el correo de respuesta y el mensaje. No se ha enviado nada.',
    origen: 'Esta petición no procede de la propia web. No se ha enviado nada.',
    verificacion: 'No hemos podido completar la verificación antiabuso. No se ha enviado nada: recarga la página e inténtalo de nuevo, o usa WhatsApp.',
    grande: 'El mensaje es demasiado largo. No se ha enviado nada.',
    'sin-proveedor': 'El envío por correo todavía no está disponible. No se ha enviado nada; usa WhatsApp.',
    fallo: 'No se ha podido confirmar el envío de la consulta. Inténtalo más tarde o usa WhatsApp.',
    tiempo: 'El envío ha tardado demasiado y no hay confirmación. Puede que no haya llegado; usa WhatsApp si es urgente.',
  };
}
export const RESULT_MESSAGES = resultMessages(ENV);

export interface ContactInput { name: string; email: string; service: string; message: string }

const CONTROL = /[\u0000-\u001f\u007f\u2028\u2029]/;
const EMAIL = /^[^\s@<>"',;:()[\]\\]+@[^\s@<>"',;:()[\]\\]+\.[^\s@<>"',;:()[\]\\]{2,}$/;

export function parseContact(fields: URLSearchParams): ContactInput | null {
  if ((fields.get('website') ?? '') !== '') return null; // honeypot
  const name = (fields.get('name') ?? '').trim();
  const email = (fields.get('email') ?? '').trim();
  const service = (fields.get('service') ?? '').trim();
  const message = (fields.get('message') ?? '').replace(/\r\n?/g, '\n').trim();
  if (!name || name.length > 100 || CONTROL.test(name)) return null;
  if (!email || email.length > 254 || !EMAIL.test(email)) return null;
  if (service && !(SERVICES as readonly string[]).includes(service)) return null;
  // El mensaje admite saltos de línea; el resto de controles no.
  if (!message || message.length > 2000 || CONTROL.test(message.replace(/\n/g, ''))) return null;
  return { name, email, service, message };
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function buildMail(input: ContactInput, to: string, from: string) {
  const service = input.service || 'Sin especificar';
  const text = `Nueva consulta desde el formulario web\n\nNombre: ${input.name}\nCorreo de respuesta: ${input.email}\nServicio: ${service}\n\n${input.message}\n`;
  const html = `<p><strong>Nueva consulta desde el formulario web</strong></p><p>Nombre: ${escapeHtml(input.name)}<br>Correo de respuesta: ${escapeHtml(input.email)}<br>Servicio: ${escapeHtml(service)}</p><p>${escapeHtml(input.message).replace(/\n/g, '<br>')}</p>`;
  // Asunto fijo: no incluye datos del visitante, así no puede inyectar cabeceras.
  return { to, from, subject: 'Nueva consulta web', text, html, replyTo: input.email };
}
