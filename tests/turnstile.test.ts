import test from 'node:test';
import assert from 'node:assert/strict';
import { TURNSTILE_ACTION, turnstileEnabled, verifyTurnstile } from '../src/lib/turnstile.ts';

// Siteverify simulado: nunca se llama a la red.
const env = { TURNSTILE_SITEKEY: '0xSINTETICA0000', TURNSTILE_SECRET: 'secreto-sintetico', TURNSTILE_HOSTNAMES: 'directoproducciones.com' };
const reply = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const ok = { success: true, action: TURNSTILE_ACTION, hostname: 'directoproducciones.com' };

test('Turnstile: solo se exige con sitekey', () => {
  assert.equal(turnstileEnabled({}), false);
  assert.equal(turnstileEnabled({ TURNSTILE_SITEKEY: '  ' }), false);
  assert.equal(turnstileEnabled(env), true);
});

test('Turnstile: acepta solo éxito con la acción y el hostname esperados', async () => {
  let sent: URLSearchParams | undefined;
  const capture = (async (_url: string, init: RequestInit) => { sent = init.body as URLSearchParams; return new Response(JSON.stringify(ok)); }) as unknown as typeof fetch;
  assert.equal(await verifyTurnstile(env, 'token', '203.0.113.7', capture), true);
  assert.equal(sent?.get('secret'), 'secreto-sintetico');
  assert.equal(sent?.get('remoteip'), '203.0.113.7');
  assert.equal(await verifyTurnstile(env, 'token', null, reply({ ...ok, success: false })), false);
  assert.equal(await verifyTurnstile(env, 'token', null, reply({ ...ok, action: 'otra' })), false);
  assert.equal(await verifyTurnstile(env, 'token', null, reply({ ...ok, hostname: 'localhost' })), false);
});

test('Turnstile: falla en cerrado', async () => {
  const boom = (async () => { throw new Error('red'); }) as unknown as typeof fetch;
  assert.equal(await verifyTurnstile(env, 'token', null, boom), false, 'error de red');
  assert.equal(await verifyTurnstile(env, 'token', null, reply(ok, 500)), false, 'siteverify no 2xx');
  assert.equal(await verifyTurnstile(env, 'token', null, (async () => new Response('no json')) as unknown as typeof fetch), false, 'no JSON');
  assert.equal(await verifyTurnstile(env, '', null, reply(ok)), false, 'sin token');
  assert.equal(await verifyTurnstile(env, 'x'.repeat(2049), null, reply(ok)), false, 'token demasiado largo');
  assert.equal(await verifyTurnstile({ ...env, TURNSTILE_SECRET: '' }, 'token', null, reply(ok)), false, 'sin secreto');
  assert.equal(await verifyTurnstile({ ...env, TURNSTILE_HOSTNAMES: '' }, 'token', null, reply(ok)), false, 'sin hostnames');
});
