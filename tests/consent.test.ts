import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanParams, createConsent, CONSENT_DAYS } from '../src/scripts/consent';

const ID = 'G-TEST1234';
function fakeEnv(initial: Record<string, string> = {}, startAt = 1_000_000) {
  const store = new Map(Object.entries(initial)), scripts: { src: string; async: boolean }[] = [], cookieWrites: string[] = [];
  let clock = startAt;
  const win: any = { location: { hostname: 'www.directoproducciones.com' } };
  const doc: any = {
    head: { appendChild: (s: { src: string; async: boolean }) => scripts.push(s) },
    createElement: () => ({}),
    get cookie() { return '_ga=GA1.1.1; _ga_TEST1234=GS1; sesion=1'; },
    set cookie(value: string) { cookieWrites.push(value); },
  };
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  return { env: { storage, doc, win, now: () => clock }, scripts, win, cookieWrites, store, advance: (ms: number) => { clock += ms; } };
}

test('antes de decidir no se carga nada y los eventos se descartan', () => {
  const t = fakeEnv(); const c = createConsent(ID, t.env as never);
  assert.equal(c.restore(), 'unset');
  assert.equal(t.scripts.length, 0);
  assert.equal(t.win.dataLayer, undefined);
  assert.equal(c.track('generate_lead'), false);
});
test('rechazar no carga nada y se recuerda', () => {
  const t = fakeEnv(); const c = createConsent(ID, t.env as never);
  c.reject();
  assert.equal(c.state(), 'rejected'); assert.equal(t.scripts.length, 0); assert.equal(t.win.gtag, undefined);
  assert.equal(c.track('click_whatsapp'), false);
  assert.equal(createConsent(ID, t.env as never).restore(), 'rejected');
  assert.equal(t.scripts.length, 0);
});
test('aceptar carga gtag.js una sola vez, aunque se acepte o se restaure varias veces', () => {
  const t = fakeEnv(); const c = createConsent(ID, t.env as never);
  c.accept(); c.accept(); c.restore();
  assert.equal(t.scripts.length, 1);
  assert.equal(t.scripts[0].src, `https://www.googletagmanager.com/gtag/js?id=${ID}`);
  const calls = t.win.dataLayer.map((x: ArrayLike<unknown>) => Array.from(x));
  assert.deepEqual(calls.map((x: unknown[]) => x[0]), ['consent', 'js', 'config']);
  assert.deepEqual(calls[0][2], { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
  assert.equal(calls[2][2].allow_google_signals, false);
  // Una segunda página con la decisión guardada: carga una vez y sin volver a preguntar.
  const next = fakeEnv(Object.fromEntries(t.store)); createConsent(ID, next.env as never).restore();
  assert.equal(next.scripts.length, 1);
});
test('revocar tras aceptar desactiva la medición, borra cookies _ga* y no envía más eventos', () => {
  const t = fakeEnv(); const c = createConsent(ID, t.env as never);
  c.accept();
  assert.equal(c.track('click_whatsapp', { link_location: 'flotante' }), true);
  const before = t.win.dataLayer.length;
  c.reject();
  assert.equal(c.state(), 'rejected');
  assert.equal(t.win[`ga-disable-${ID}`], true);
  assert.deepEqual(Array.from(t.win.dataLayer.at(-1)), ['consent', 'update', { analytics_storage: 'denied' }]);
  assert.ok(t.cookieWrites.some(w => w.startsWith('_ga=;') && w.includes('Max-Age=0')));
  assert.ok(t.cookieWrites.some(w => w.startsWith('_ga_TEST1234=;')));
  assert.ok(!t.cookieWrites.some(w => w.startsWith('sesion=')), 'no toca cookies ajenas');
  assert.equal(c.track('click_whatsapp'), false);
  assert.equal(t.win.dataLayer.length, before + 1);
  assert.equal(t.scripts.length, 1);
});
test('la decisión caduca a los 180 días', () => {
  const t = fakeEnv(); createConsent(ID, t.env as never).accept();
  t.advance((CONSENT_DAYS - 1) * 864e5); assert.equal(createConsent(ID, t.env as never).state(), 'accepted');
  t.advance(2 * 864e5); assert.equal(createConsent(ID, t.env as never).state(), 'unset');
});
test('solo eventos de la lista y sin datos personales', () => {
  const t = fakeEnv(); const c = createConsent(ID, t.env as never);
  c.accept();
  assert.equal(c.track('page_secret', {}), false);
  assert.equal(c.track('generate_lead', { email: 'a@b.es', nombre: 'Ana', page_location: 'https://directoproducciones.com/contacto/?utm=1&email=a@b.es', contacto: 'ana@correo.es', tel: '679729727', value_text: '651 341 384', ok: true }), true);
  const sent = Array.from(t.win.dataLayer.at(-1)) as [string, string, Record<string, unknown>];
  assert.deepEqual(sent.slice(0, 2), ['event', 'generate_lead']);
  assert.deepEqual(sent[2], { page_location: 'https://directoproducciones.com/contacto/', ok: true });
  assert.deepEqual(cleanParams({ message: 'hola', x: { a: 1 }, n: 3 }), { n: 3 });
});
test('almacenamiento bloqueado: funciona en memoria sin lanzar', () => {
  const t = fakeEnv(); t.env.storage = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); }, removeItem() {} } as never;
  const c = createConsent(ID, t.env as never);
  assert.doesNotThrow(() => c.accept());
  assert.equal(c.state(), 'accepted'); assert.equal(t.scripts.length, 1);
});
