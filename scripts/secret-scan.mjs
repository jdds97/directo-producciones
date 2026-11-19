// Escáner de secretos y archivos privados SIN dependencias. Revisa lo que `git add .` metería (rastreado + no ignorado).
// Nunca imprime el contenido coincidente: solo ruta, línea y regla. Sale con 1 si hay hallazgos.
//   node scripts/secret-scan.mjs                 (árbol de trabajo)
//   node scripts/secret-scan.mjs --files a b     (lista explícita, para pruebas)
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const NAME_RULES = [
  [/(^|\/)\.env(\.|$)(?!example$|local\.example$)/, 'archivo .env'],
  [/(^|\/)\.dev\.vars/, '.dev.vars de Wrangler'],
  [/(^|\/)client_secret[^/]*\.json$/i, 'credencial OAuth de Google'],
  [/\.(pem|key|p12|pfx|apk|sqlite3?|db|db-wal|db-shm)$/i, 'clave, base de datos o paquete binario'],
  [/(^|\/)\.mcp\.json$/, 'configuración local de MCP'],
  [/\.WordPress\..*\.xml$/i, 'exportación WXR de WordPress'],
  [/(^|\/)(\.private|\.claude|\.wrangler|\.playwright-mcp)\//, 'estado local o documentación privada'],
  [/(^|\/)[^/]*\.log$/, 'registro (.log)'],
];
const CONTENT_RULES = [
  [/\bre_[A-Za-z0-9]{20,}\b/, 'clave de Resend'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'clave privada'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'clave de acceso AWS'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/, 'token de GitHub'],
  [/\bec_pat_[A-Za-z0-9_-]{20,}/, 'token personal de EmDash'],
  [/"client_secret"\s*:\s*"/, 'client_secret de OAuth'],
  [/\b(?:CLOUDFLARE_API_TOKEN|RESEND_API_KEY|EMDASH_ENCRYPTION_KEY|TURNSTILE_SECRET_KEY)\s*[=:]\s*['"]?[A-Za-z0-9_\-]{16,}/, 'asignación de secreto con valor'],
];
const BINARY = /\.(png|jpe?g|webp|avif|gif|ico|mp4|webm|mov|woff2?|ttf|otf|pdf|zip|gz|wasm)$/i;
const SELF = new Set(['scripts/secret-scan.mjs', 'tests/secret-scan.test.ts']);

export function scan(files) {
  const findings = [];
  for (const file of files) {
    if (SELF.has(file)) continue;
    for (const [re, rule] of NAME_RULES) if (re.test(file)) findings.push({ file, line: 0, rule });
    if (BINARY.test(file)) continue;
    let text;
    try { if (statSync(file).size > 2_000_000) continue; text = readFileSync(file, 'utf8'); } catch { continue; }
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) for (const [re, rule] of CONTENT_RULES) if (re.test(lines[i])) findings.push({ file, line: i + 1, rule });
  }
  return findings;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const explicit = process.argv.indexOf('--files');
  const files = explicit >= 0
    ? process.argv.slice(explicit + 1)
    : execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { maxBuffer: 64 << 20 }).toString().split('\0').filter(Boolean);
  const findings = scan(files);
  for (const f of findings) console.error(`${f.file}${f.line ? ':' + f.line : ''} · ${f.rule}`);
  console.log(findings.length ? `\n${findings.length} hallazgos en ${files.length} archivos.` : `Sin hallazgos en ${files.length} archivos.`);
  process.exit(findings.length ? 1 : 0);
}
