import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RESULT_MESSAGES, resultMessages } from '../src/lib/contact-mail.ts';
import { facts } from '../src/lib/facts.ts';

test('mensajes del formulario: prefijo de la simulación según el entorno y ninguno en producción', () => {
  assert.match(resultMessages('local').simulada, /^Revisión local: .*envío está simulado/);
  assert.match(resultMessages('local')['simulada-guardada'], /^Revisión local: /);
  assert.match(resultMessages('preview').simulada, /^Vista previa privada: .*envío está simulado/);
  assert.match(resultMessages('preview')['simulada-guardada'], /^Vista previa privada: /);
  assert.equal(resultMessages('production').simulada, undefined);
  assert.equal(resultMessages('production')['simulada-guardada'], undefined);
  for (const [code, text] of Object.entries(resultMessages('preview'))) assert.doesNotMatch(text, /revisi[oó]n local/i, code);
});

test('mensajes del formulario: solo remiten a WhatsApp, el canal que se muestra en todos los entornos', () => {
  for (const env of ['local', 'preview', 'production'] as const) {
    for (const [code, text] of Object.entries(resultMessages(env))) assert.doesNotMatch(text, /tel[eé]fono|llama/i, `${env} ${code}`);
    for (const code of ['recibida', 'tope', 'sin-proveedor', 'fallo', 'tiempo']) assert.match(resultMessages(env)[code], /WhatsApp/, `${env} ${code}`);
  }
  // La redacción depende de que producción no valide sin WhatsApp aprobado y de que se pinte en todas las páginas.
  assert.equal(facts.find((f) => f.id === 'contact.whatsapp_secondary_phone')?.required_for_launch, true);
  assert.match(readFileSync('src/components/m4/WhatsAppAccess.astro', 'utf8'), /approvedFact\("contact\.whatsapp_secondary_phone"\)/);
  assert.match(readFileSync('src/layouts/Base.astro', 'utf8'), /<WhatsAppAccess \/>/);
});

test('mensajes del formulario: el módulo no importa nada (el navegador lo carga en dev sin `process`) y sigue a APP_ENV', () => {
  assert.doesNotMatch(readFileSync('src/lib/contact-mail.ts', 'utf8'), /^\s*import\s+(?!type\b)/m);
  assert.deepEqual(RESULT_MESSAGES, resultMessages((process.env.APP_ENV ?? 'local') as 'local' | 'preview' | 'production'));
});
