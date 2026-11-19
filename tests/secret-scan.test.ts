import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scan } from '../scripts/secret-scan.mjs';

// Valores sintéticos construidos en tiempo de ejecución: este archivo no contiene ningún secreto literal.
const resendLike = 're_' + 'a1B2'.repeat(6);
const dir = mkdtempSync(join(tmpdir(), 'scan-'));
const put = (name: string, text: string) => { const f = join(dir, name); writeFileSync(f, text); return f; };

test('detecta archivos privados por nombre y secretos por contenido, sin revelar el valor', () => {
  const files = [
    put('.env', 'APP_ENV=local\n'),
    put('client_secret_123.json', '{}'),
    put('notas.txt', `clave: ${resendLike}\n`),
    put('clave.txt', '-----BEGIN ' + 'PRIVATE KEY-----\n'),
    put('ci.yml', 'CLOUDFLARE_API_TOKEN: ' + 'abcd'.repeat(10) + '\n'),
  ];
  const found = scan(files) as Array<{ file: string; line: number; rule: string }>;
  const rules = found.map((f) => f.rule);
  for (const r of ['archivo .env', 'credencial OAuth de Google', 'clave de Resend', 'clave privada', 'asignación de secreto con valor']) assert.ok(rules.includes(r), r);
  assert.ok(!JSON.stringify(found).includes(resendLike), 'el hallazgo no incluye el valor');
});

test('lo legítimo no da falso positivo: ejemplos de entorno, nombres de secretos sin valor y código', () => {
  const files = [
    put('.env.example', 'APP_ENV=local\n'),
    put('doc.md', 'Secretos de runtime: RESEND_API_KEY (se fija con wrangler secret put).\n'),
    put('codigo.ts', 'const key = env.RESEND_API_KEY; // nunca se imprime\n'),
  ];
  assert.deepEqual(scan(files), []);
});
