// Comprueba contra un servidor en marcha las redirecciones APROBADAS de config/url-map.json (filas y patrones):
// código esperado, Location exacta y un solo salto (el destino no vuelve a redirigir).
//   npm run redirects:check -- [--base http://127.0.0.1:4399] [--origin https://directoproducciones.com]
//   npm run redirects:check -- --propuestas     lista lo que se probaría con las propuestas, sin tocar la red
// Las redirecciones solo se aplican en producción: contra un servidor local/preview una fila aprobada FALLARÁ (esperado).
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const base = opt('--base', 'http://127.0.0.1:4399').replace(/\/$/, '');
const origin = opt('--origin', 'https://directoproducciones.com').replace(/\/$/, '');
const proposals = args.includes('--propuestas');
const { rows, patrones = [] } = JSON.parse(readFileSync('config/url-map.json', 'utf8'));

const accionable = (r) => r.accion === 'redirigir' || r.accion === 'retirar';
const items = [...rows, ...patrones].flatMap((r) => {
  const src = proposals ? (r.propuesta ?? (r.estado === 'propuesta' ? r : null)) : r.aprobado_por && accionable(r) ? r : null;
  return src && accionable(src) ? [{ path: r.path, accion: src.accion, codigo: src.codigo, destino: src.destino }] : [];
});
const expected = (i) => (i.accion === 'retirar' ? `${i.codigo}` : `${i.codigo} -> ${origin}${i.destino}`);

if (proposals) {
  for (const i of items) console.log(`${i.path.padEnd(60)} ${expected(i)}`);
  console.log(`\n${items.length} propuestas (sin aprobar, no se piden a la red).`);
  process.exit(0);
}

const hop = (path) => fetch(base + path, { redirect: 'manual' });
const failures = [];
for (const i of items) {
  const problems = [];
  try {
    const res = await hop(i.path);
    if (res.status !== i.codigo) problems.push(`código ${res.status}, esperado ${i.codigo}`);
    if (i.accion === 'redirigir') {
      const loc = res.headers.get('location');
      if (loc !== `${origin}${i.destino}`) problems.push(`Location «${loc}», esperada «${origin}${i.destino}»`);
      else {
        const next = await hop(i.destino);
        if (next.status >= 300 && next.status < 400) problems.push(`más de un salto: el destino responde ${next.status}`);
      }
    }
  } catch (e) { problems.push(`sin respuesta (${e.message})`); }
  console.log(`${problems.length ? 'FALLO' : 'ok   '} ${i.path} ${expected(i)}${problems.length ? '\n        - ' + problems.join('\n        - ') : ''}`);
  if (problems.length) failures.push(i.path);
}
console.log(`\n${items.length} aprobadas comprobadas contra ${base}: ${failures.length} con fallos.`);
process.exit(failures.length ? 1 : 0);
