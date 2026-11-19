// Prueba extremo a extremo de FOTOS y EQUIPO editables contra un Worker LOCAL con persistencia aislada y usuarios sintéticos.
//   node scripts/cms-media-e2e.mjs [--base http://localhost:4480] [--persist .wrangler/fase-07-cierre-cms]
// Requiere una persistencia recién provisionada (scripts/cms-provision.sh). Ejercita por la API nativa de EmDash lo mismo que el panel:
// subir a la biblioteca de medios, elegir la foto en un campo de imagen (mismo valor que escribe el selector del panel), alt/foco,
// publicar, revisar, retirar, restaurar, permisos, derechos y caché, y comprueba el reflejo en el HTML público.
// Escribe <persist>/media-e2e-result.json. Imágenes sintéticas generadas aquí (colores lisos); ningún dato real.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'http://localhost:4480');
const PERSIST = arg('--persist', '.wrangler/fase-07-cierre-cms');
if (!/^http:\/\/localhost:\d+$/.test(BASE)) throw new Error('Solo localhost');
const fx = JSON.parse(readFileSync(`${PERSIST}/fixture.json`, 'utf8'));
const results = [];
const api = async (who, method, path, body) => {
  const headers = { Origin: BASE, ...(who ? { Authorization: `Bearer ${fx[who].token}` } : {}), ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) };
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined, redirect: 'manual' });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text };
};
const step = async (name, fn) => {
  try { const note = await fn(); results.push({ name, ok: true, note: note ?? '' }); console.log(`PASS  ${name}${note ? ` — ${note}` : ''}`); }
  catch (e) { results.push({ name, ok: false, note: String(e.message ?? e) }); console.log(`FAIL  ${name} — ${e.message ?? e}`); }
};
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const reason = (r) => (r.json?.error?.message ?? r.text).slice(0, 160);
const page = async (path) => (await fetch(`${BASE}${path}`)).text();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const until = async (path, pred, tries = 30) => { let html = ''; for (let i = 0; i < tries; i++) { html = await page(path); if (pred(html)) return html; await sleep(100); } return html; };

// PNG liso (sin dependencias): color único, para distinguir cada foto de prueba.
const png = (w, h, rgb) => {
  const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4); d.copy(b, 8); b.writeUInt32BE(zlib.crc32(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgb).flat())]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk('IEND', Buffer.alloc(0))]);
};
const upload = async (who, name, type, buf) => { const f = new FormData(); f.set('file', new File([buf], name, { type })); return api(who, 'POST', '/_emdash/api/media', f); };
// Mismo valor que escribe el selector de imagen del panel (mediaItemToImageFieldValue de @emdash-cms/admin).
const asFieldValue = (item) => ({ id: item.id, provider: 'local', alt: item.alt || '', width: item.width, height: item.height, focalX: item.focalX ?? undefined, focalY: item.focalY ?? undefined, filename: item.filename, mimeType: item.mimeType, blurhash: item.blurhash, dominantColor: item.dominantColor, meta: { storageKey: item.storageKey } });
const entries = async (col) => (await api('admin', 'GET', `/_emdash/api/content/${col}?limit=100`)).json?.data?.items ?? [];
const entry = async (col, slug = 'main') => { const it = (await entries(col)).find(i => i.slug === slug); ok(it, `${col}/${slug} no existe`); return it; };
const put = (who, col, id, data) => api(who, 'PUT', `/_emdash/api/content/${col}/${id}`, { data });
const publish = (who, col, id) => api(who, 'POST', `/_emdash/api/content/${col}/${id}/publish`, {});
const unpublish = (who, col, id) => api(who, 'POST', `/_emdash/api/content/${col}/${id}/unpublish`, {});
const imgs = (html) => [...html.matchAll(/<img\b[^>]*>/g)].map(m => m[0]);
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
const RIGHTS = 'Prueba local sintética: imagen generada por el script, sin terceros.';

let media = {};
// ── 0. Esquema real en el Worker ───────────────────────────────────────────────────────
await step('esquema · campos de imagen y lista de equipo creados en EmDash con selectores y tipos', async () => {
  const q = await api('admin', 'GET', '/_emdash/api/schema/collections/page_quienes?includeFields=true');
  const fields = q.json?.data?.item?.fields ?? [];
  const f = (s) => fields.find(x => x.slug === s);
  ok(f('hero_foto')?.type === 'image' && f('hero_foto_ref')?.type === 'select' && f('hero_foto_alt') && f('hero_foto_decor')?.type === 'boolean' && f('media_rights_source'), `page_quienes sin campos de foto (${fields.length} campos)`);
  const t = await api('admin', 'GET', '/_emdash/api/schema/collections/team?includeFields=true');
  const tf = t.json?.data?.item?.fields ?? t.json?.data?.fields ?? [];
  const tn = ['name', 'role', 'bio', 'photo', 'photo_ref', 'photo_alt', 'photo_state', 'show_home', 'sort', 'home_sort', 'visible'];
  ok(tn.every(s => tf.some(x => x.slug === s)), `equipo sin campos: ${tn.filter(s => !tf.some(x => x.slug === s)).join(',')}`);
  ok(tf.find(x => x.slug === 'photo')?.type === 'image', 'photo no es image');
  return `page_quienes ${fields.length} campos; team ${tf.length} campos`;
});

// ── 1. Biblioteca de medios: subida y reglas de tipo/tamaño ────────────────────────────
await step('medios · el editor sube PNG a la biblioteca; SVG (también disfrazado), PDF, HTML y >10 MB se rechazan', async () => {
  const red = await upload('editor', 'prueba-roja.png', 'image/png', png(640, 480, [200, 30, 30]));
  ok([200, 201].includes(red.status), `png ${red.status} ${reason(red)}`);
  media.red = red.json.data.item;
  const svg = await upload('editor', 'x.svg', 'image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'));
  const svgPng = await upload('editor', 'x.png', 'image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'));
  const svgName = await upload('editor', 'x.svg', 'image/png', png(4, 4, [1, 2, 3]));
  const html = await upload('editor', 'x.html', 'text/html', Buffer.from('<script>alert(1)</script>'));
  const pdf = await upload('editor', 'x.pdf', 'application/pdf', Buffer.from('%PDF-1.4'));
  const big = await upload('editor', 'big.png', 'image/png', Buffer.alloc(10 * 1024 * 1024 + 10, 1));
  const anon = await upload(null, 'a.png', 'image/png', png(4, 4, [1, 2, 3]));
  ok([svg, svgPng, svgName, html, pdf, big, anon].every(r => r.status >= 400), `svg ${svg.status}, svg-tipo ${svgPng.status}, svg-nombre ${svgName.status}, html ${html.status}, pdf ${pdf.status}, grande ${big.status}, anónimo ${anon.status}`);
  const contributor = await upload('contributor', 'c.png', 'image/png', png(4, 4, [9, 9, 9]));
  return `png ${red.status}; svg ${svg.status}/${svgPng.status}/${svgName.status}, html ${html.status}, pdf ${pdf.status}, grande ${big.status}, anónimo ${anon.status}; colaborador ${contributor.status}`;
});
await step('medios · foco por la API nativa de la biblioteca y lectura del elemento', async () => {
  const set = await api('editor', 'PUT', `/_emdash/api/media/${media.red.id}`, { focalX: 0.2, focalY: 0.8, alt: 'Cuadro rojo de prueba' });
  ok(set.status === 200, `PUT media ${set.status} ${reason(set)}`);
  const got = await api('editor', 'GET', `/_emdash/api/media/${media.red.id}`);
  const item = got.json?.data?.item; ok(item?.focalX === 0.2 && item?.focalY === 0.8, `foco ${item?.focalX},${item?.focalY}`);
  media.red = item;
  const bad = await api('editor', 'PUT', `/_emdash/api/media/${media.red.id}`, { focalX: 7, focalY: 0.1 });
  ok(bad.status >= 400, `foco fuera de rango aceptado (${bad.status})`);
  return `foco 20 %/80 % guardado; fuera de rango ${bad.status}`;
});

// ── 2. Equipo: lista única, retrato, orden, visibilidad, estado sin foto ───────────────
const team = await entries('team');
const bySlug = (s) => team.find(t => t.slug === s);
const baseline = { home: await page('/'), about: await page('/quienes-somos/') };
const personNames = (html, cls) => [...html.matchAll(new RegExp(`<h3 class="${cls}">([^<]+)</h3>|<strong>([^<]+)</strong>`, 'g'))].map(m => m[1] ?? m[2]);
await step('equipo · semilla: 9 personas con el orden, nombres, cargos y fotos actuales (dos sin foto, en «pendiente»)', async () => {
  ok(team.length === 9, `${team.length} personas`);
  const sorted = [...team].sort((a, b) => a.data.sort - b.data.sort).map(t => t.slug);
  ok(sorted.join() === 'sergio-maya,antonio-de-los-reyes,david-berdugo,lucia-sanchez,curro,juan-gomez,jesus-ruiz,gonzalo-sanchez,fran-vergara', `orden ${sorted.join()}`);
  const pend = team.filter(t => t.data.photo_state === 'pendiente').map(t => t.slug).sort();
  ok(pend.join() === 'david-berdugo,gonzalo-sanchez', `pendientes ${pend}`);
  ok(bySlug('sergio-maya').data.name === 'Sergio Maya' && !bySlug('sergio-maya').data.name_home && !bySlug('sergio-maya').data.note && bySlug('curro').data.name === 'Curro de Dios' && bySlug('antonio-de-los-reyes').data.name === 'Antonio de los Reyes', 'nombres: primer apellido y compuestos');
  ok(!JSON.stringify(team).match(/Panig|Paniag/), 'queda una grafía Panigua/Paniagua en las fichas');
  const aboutFigures = (baseline.about.match(/about-page-crew-photo/g) ?? []).length;
  ok(aboutFigures === 7, `retratos en Quiénes somos: ${aboutFigures}`);
  return 'orden, nombres, estados y 7 retratos coinciden con el código anterior';
});
await step('equipo · publicar las 9 fichas no cambia ni Inicio ni Quiénes somos (misma fuente, mismo resultado)', async () => {
  for (const t of team) {
    const r = await put('editor', 'team', t.id, { rights_ok: true, rights_source: RIGHTS });
    ok(r.status === 200, `PUT ${t.slug} ${r.status} ${reason(r)}`);
    const p = await publish('editor', 'team', t.id); ok(p.status === 200, `publicar ${t.slug} ${p.status} ${reason(p)}`);
  }
  await sleep(300);
  const [home, about] = [await page('/'), await page('/quienes-somos/')];
  const key = (html) => imgs(html).map(i => [attr(i, 'src'), attr(i, 'alt')].join('|')).join('\n');
  ok(key(home) === key(baseline.home), 'Inicio cambió');
  ok(key(about) === key(baseline.about), 'Quiénes somos cambió');
  ok(personNames(about, 'about-page-crew-name').slice(0, 9).join() === personNames(baseline.about, 'about-page-crew-name').slice(0, 9).join(), 'nombres en Quiénes somos cambiaron');
  return '9 fichas publicadas; imágenes, alt y nombres idénticos';
});
await step('equipo · cambiar el retrato sin tocar código: borrador invisible; al publicar aparece en Inicio y Quiénes somos con su alt', async () => {
  const curro = bySlug('curro');
  const r = await put('editor', 'team', curro.id, { photo: asFieldValue(media.red), photo_alt: 'Curro de Dios con camisa roja (prueba)', photo_alt_home: '' });
  ok(r.status === 200, `PUT ${r.status} ${reason(r)}`);
  const key = media.red.storageKey;
  ok(!(await page('/')).includes(key) && !(await page('/quienes-somos/')).includes(key), 'el borrador se filtró');
  const p = await publish('editor', 'team', curro.id); ok(p.status === 200, `publicar ${p.status} ${reason(p)}`);
  const [home, about] = [await until('/', h => h.includes(key)), await until('/quienes-somos/', h => h.includes(key))];
  for (const [name, html] of [['Inicio', home], ['Quiénes somos', about]]) {
    const tag = imgs(html).find(i => i.includes(key)); ok(tag, `${name}: sin la foto nueva`);
    ok(attr(tag, 'alt').includes('camisa roja'), `${name}: alt ${attr(tag, 'alt')}`);
    ok(/object-position:20% 80%/.test(tag), `${name}: sin foco (${tag.slice(0, 160)})`);
  }
  ok(imgs(home).length === imgs(baseline.home).length && imgs(about).length === imgs(baseline.about).length, 'cambió el número de imágenes');
  return 'Inicio y Quiénes somos muestran la misma foto subida, con alt y foco 20 %/80 %';
});
await step('equipo · orden, visibilidad e Inicio se gobiernan desde la ficha', async () => {
  const fran = bySlug('fran-vergara'), jesus = bySlug('jesus-ruiz'), sergio = bySlug('sergio-maya');
  for (const [t, patch] of [[fran, { sort: 5 }], [jesus, { visible: false }], [sergio, { show_home: false }]]) { const a = await put('editor', 'team', t.id, patch), b = await publish('editor', 'team', t.id); ok(a.status === 200 && b.status === 200, `${t.slug}: PUT ${a.status} ${reason(a)} / publicar ${b.status} ${reason(b)}`); }
  const about = await until('/quienes-somos/', h => !h.includes('Jesús Ruiz')); const home = await until('/', h => !h.includes('<strong>Sergio Maya</strong>'));
  const order = personNames(about, 'about-page-crew-name');
  ok(order[0] === 'Fran Vergara' && !order.includes('Jesús Ruiz'), `orden/visibilidad: ${order.join(' | ')}`);
  ok(!home.includes('<strong>Sergio Maya</strong>'), 'Sergio sigue en Inicio');
  return `QS: ${order.join(' · ')}; Inicio sin Sergio`;
});
await step('equipo · restaurar: ordenar de nuevo y volver a mostrar devuelve la configuración original', async () => {
  for (const [slug, patch] of [['fran-vergara', { sort: 90 }], ['jesus-ruiz', { visible: true }], ['sergio-maya', { show_home: true }]]) { const t = bySlug(slug); await put('editor', 'team', t.id, patch); await publish('editor', 'team', t.id); }
  const about = await until('/quienes-somos/', h => h.includes('Jesús Ruiz')); const home = await until('/', h => h.includes('<strong>Sergio Maya</strong>'));
  ok(personNames(about, 'about-page-crew-name')[0] === 'Sergio Maya' && home.includes('<strong>Sergio Maya</strong>'), 'no volvió');
  return 'orden de Quiénes somos e Inicio restaurados';
});
await step('equipo · revisión: la lista de revisiones existe y la anterior se restaura (vuelve la foto de código)', async () => {
  const curro = bySlug('curro');
  const revs = await api('editor', 'GET', `/_emdash/api/content/team/${curro.id}/revisions`);
  const list = revs.json?.data?.items ?? []; ok(revs.status === 200 && list.length >= 2, `revisiones ${revs.status} (${list.length})`);
  const back = await put('editor', 'team', curro.id, { photo: null, photo_alt: 'Curro de Dios' });
  ok(back.status === 200, `PUT ${back.status} ${reason(back)}`);
  const p = await publish('editor', 'team', curro.id); ok(p.status === 200, `publicar ${p.status} ${reason(p)}`);
  const html = await until('/quienes-somos/', h => !h.includes(media.red.storageKey));
  ok(!html.includes(media.red.storageKey) && html.includes('perfiles/curro-560.webp'), 'no volvió la foto de Curro');
  return `${list.length} revisiones; foto original restaurada`;
});
await step('equipo · retirada (administrador) = valor por defecto; ocultar = ficha publicada con visible=false; restauración; el editor no puede borrar', async () => {
  const lucia = bySlug('lucia-sanchez');
  const e = await unpublish('editor', 'team', lucia.id);
  const a = await unpublish('admin', 'team', lucia.id); ok(a.status === 200, `admin retira ${a.status} ${reason(a)}`);
  // Fusión local de listas: retirar una ficha devuelve su valor por defecto (la persona sigue visible); ocultar = publicar con «Mostrar en la web» desactivado.
  const dflt = await page('/quienes-somos/'); ok(dflt.includes('Lucía Sánchez'), 'la retirada no debe ocultar a la persona: vuelve su valor por defecto');
  await put('editor', 'team', lucia.id, { visible: false }); const hide = await publish('editor', 'team', lucia.id); ok(hide.status === 200, `ocultar ${hide.status} ${reason(hide)}`);
  const gone = await until('/quienes-somos/', h => !h.includes('Lucía Sánchez')); ok(!gone.includes('Lucía Sánchez'), 'visible=false no la oculta');
  await put('editor', 'team', lucia.id, { visible: true }); const back = await publish('editor', 'team', lucia.id); ok(back.status === 200, `republicar ${back.status}`);
  const there = await until('/quienes-somos/', h => h.includes('Lucía Sánchez')); ok(there.includes('Lucía Sánchez'), 'no volvió');
  const del2 = await api('author', 'DELETE', `/_emdash/api/content/team/${lucia.id}`);
  const del3 = await api('contributor', 'DELETE', `/_emdash/api/content/team/${lucia.id}`);
  ok(del2.status >= 400 && del3.status >= 400, `autor/colaborador borraron (${del2.status}/${del3.status})`);
  const trash = await api('editor', 'DELETE', `/_emdash/api/content/team/${lucia.id}`); ok(trash.status === 200, `editor a papelera ${trash.status} ${reason(trash)}`);
  const del = trash;
  const gone2 = await page('/quienes-somos/'); ok(gone2.includes('Lucía Sánchez'), 'tras la papelera vuelve el valor por defecto');
  const rs = await api('editor', 'POST', `/_emdash/api/content/team/${lucia.id}/restore`, {}); ok(rs.status === 200, `restaurar ${rs.status} ${reason(rs)}`);
  const pub = await publish('editor', 'team', lucia.id);
  const back2 = await until('/quienes-somos/', h => h.includes('Lucía Sánchez')); ok(back2.includes('Lucía Sánchez'), `no volvió tras restaurar (publicar ${pub.status})`);
  return `editor retira ${e.status}; admin retira 200; autor/colaborador borran ${del2.status}/${del3.status}; editor→papelera ${del.status}; restaurar 200`;
});
await step('equipo · las dos personas sin foto conservan el estado «pendiente» y no exigen foto', async () => {
  const david = bySlug('david-berdugo');
  const r = await put('editor', 'team', david.id, { bio: '' }); ok(r.status === 200, `PUT ${r.status}`);
  const p = await publish('editor', 'team', david.id); ok(p.status === 200, `publicar sin foto ${p.status} ${reason(p)}`);
  const about = await page('/quienes-somos/');
  const block = about.slice(about.indexOf('David Berdugo') - 400, about.indexOf('David Berdugo'));
  ok(!/<img/.test(block.slice(block.lastIndexOf('<li'))), 'David muestra una imagen inventada');
  return 'publicable sin foto; sin imagen ni placeholder nuevo';
});
await step('equipo · biografía opcional: vacía no se muestra; con texto aparece bajo el cargo', async () => {
  const antonio = bySlug('antonio-de-los-reyes');
  await put('editor', 'team', antonio.id, { bio: 'Edita y realiza las emisiones del equipo.' }); await publish('editor', 'team', antonio.id);
  const html = await until('/quienes-somos/', h => h.includes('about-page-crew-bio'));
  ok(html.includes('Edita y realiza las emisiones del equipo.'), 'la bio no aparece');
  await put('editor', 'team', antonio.id, { bio: '' }); await publish('editor', 'team', antonio.id);
  ok(!(await until('/quienes-somos/', h => !h.includes('about-page-crew-bio'))).includes('about-page-crew-bio'), 'la bio vacía sigue');
});

await step('equipo · correos de Inicio: hecho aprobado por defecto (por id de ficha), mailto, edición del campo con aprobación de administrador y retorno', async () => {
  const mails = (h) => [...h.matchAll(/<a class="home-person-email" href="mailto:([^"]+)"[^>]*>/g)].map(m => m[1]).sort();
  const expected = ['fdedios@directoproducciones.com', 'fvergara@directoproducciones.com', 'smaya@directoproducciones.com'];
  const home = await until('/', h => mails(h).length === 3);
  ok(mails(home).join() === expected.join(), `correos en Inicio: ${mails(home)}`);
  ok(/data-fact-id="contact\.team_sergio_email"/.test(home) && /data-fact-id="contact\.team_fran_email"/.test(home) && /data-fact-id="contact\.team_francisco_email"/.test(home), 'faltan data-fact-id');
  const qs = await page('/quienes-somos/'); ok(!/mailto:/.test(qs.replace(/mailto:info@[^"]*/g, '')), 'correo de perfil fuera de Inicio');
  // El mapeo es por ficha: renombrar a Sergio no mueve su correo ni se lo da a otra persona.
  const sergio = bySlug('sergio-maya'); const fran = bySlug('fran-vergara');
  await put('editor', 'team', sergio.id, { name_home: 'Otro Nombre' }); await publish('editor', 'team', sergio.id);
  const renamed = await until('/', h => h.includes('Otro Nombre'));
  ok(renamed.includes('mailto:smaya@directoproducciones.com') && mails(renamed).length === 3, 'el correo no sigue a la ficha');
  await put('editor', 'team', sergio.id, { name_home: '' }); await publish('editor', 'team', sergio.id);
  // Correo propio: formato, aprobación de administrador y vuelta al hecho aprobado.
  const bad = await put('editor', 'team', fran.id, { email: 'no-es-un-correo' }); const badPub = bad.status === 200 ? await publish('editor', 'team', fran.id) : bad;
  ok(badPub.status >= 400, `correo inválido ${bad.status}/${badPub.status}`);
  await put('editor', 'team', fran.id, { email: 'otro@directoproducciones.com' });
  const ed = await publish('editor', 'team', fran.id); ok(ed.status === 422, `editor publica correo propio ${ed.status}`);
  const ad = await publish('admin', 'team', fran.id); ok(ad.status === 200, `admin publica correo propio ${ad.status} ${reason(ad)}`);
  const custom = await until('/', h => h.includes('mailto:otro@directoproducciones.com')); ok(custom.includes('mailto:otro@directoproducciones.com') && !custom.includes('mailto:fvergara@'), 'no se refleja el correo propio');
  await put('editor', 'team', fran.id, { email: null }); const back = await publish('editor', 'team', fran.id); ok(back.status === 200, `vaciar ${back.status} ${reason(back)}`);
  const def = await until('/', h => h.includes('mailto:fvergara@directoproducciones.com')); ok(def.includes('mailto:fvergara@directoproducciones.com') && !def.includes('otro@directoproducciones'), 'no volvió al hecho aprobado');
  ok(!/mailto:[^"]*(david|gonzalo|lucia|juan|jesus|antonio)/i.test(def), 'correo inventado para otra persona');
  return '3 correos desde hechos aprobados (por id de ficha); inválido rechazado; propio solo con administrador; vaciar vuelve al hecho';
});

// ── 3. Fotos de página: todas las ranuras ──────────────────────────────────────────────
const slotsByPage = {
  page_home: { route: '/', slots: ['serv_1_foto', 'serv_2_foto', 'serv_3_foto', 'serv_4_foto', 'hero_poster'] },
  page_quienes: { route: '/quienes-somos/', slots: ['hero_foto', 'escena_grupo', 'escena_control', 'escena_cobertura', 'accion_1', 'accion_2', 'accion_3', 'colabora_foto'] },
  page_produccion: { route: '/streaming/', slots: ['hero_foto', 'tv_foto', 'directos_grafico', 'recursos_foto'] },
  page_comunicacion: { route: '/comunicacion-marketing/', slots: ['hero_foto', 'eventos_foto'] },
  page_portfolio: { route: '/portfolio/', slots: ['hero_poster', 'hero_poster_movil'] },
};
const COLORS = [[20, 160, 60], [30, 60, 200], [220, 150, 0], [150, 30, 170], [0, 150, 160]];
let colorIdx = 0;
// Clase B (cifras/años en el texto de la página): la publica el administrador registrado; el resto, el editor.
const whoPublishes = { page_quienes: 'admin', page_produccion: 'admin' };
const slotDefault = { page_home: 'servicios/streaming-realizacion', page_quienes: 'equipo/equipo-10-sin-botella', page_produccion: 'servicios/directos-7', page_comunicacion: 'servicios/directos-11', page_portfolio: 'coberturas/portfolio-reel' };
for (const [col, { route, slots }] of Object.entries(slotsByPage)) {
  await step(`fotos · ${col}: cada ranura (${slots.length}) cambia por foto subida y por foto del sitio, y vuelve al original`, async () => {
    const it = await entry(col); const who = whoPublishes[col] ?? 'editor';
    const dec = (s) => ['hero_poster', 'hero_poster_movil'].includes(s);
    const altOf = (s) => ({ accion_1: 'foto_alt_operador', accion_2: 'foto_alt_cobertura', accion_3: 'foto_alt_control' })[s] ?? `${s}_alt`;
    const shot = []; // [slot, storageKey]
    const data = {};
    for (const s of slots) {
      const up = await upload('editor', `${col}-${s}.png`, 'image/png', png(320 + colorIdx * 8, 240, COLORS[colorIdx++ % COLORS.length]));
      ok(up.status === 201, `subida ${s} ${up.status}`);
      data[s] = asFieldValue(up.json.data.item); data[altOf(s)] = `Foto de prueba ${s}`; if (dec(s)) data[`${s}_decor`] = true;
      shot.push([s, up.json.data.item.storageKey]);
    }
    const noRights = await put(who, col, it.id, data); ok(noRights.status === 200, `PUT ${noRights.status} ${reason(noRights)}`);
    const denied = await publish(who, col, it.id); ok(denied.status >= 400 && /derechos/i.test(reason(denied)), `sin evidencia de derechos: ${denied.status} ${reason(denied)}`);
    await put(who, col, it.id, { media_rights_source: RIGHTS });
    const p = await publish(who, col, it.id); ok(p.status === 200, `publicar ${p.status} ${reason(p)}`);
    const html = await until(route, h => shot.every(([, k]) => h.includes(k)));
    const missing = shot.filter(([, k]) => !html.includes(k)).map(([s]) => s);
    ok(!missing.length, `sin reflejo en ${route}: ${missing.join(',')}`);
    // foto del sitio elegida en el selector cerrado
    const swap = { ...Object.fromEntries(slots.map(s => [s, null])), [`${slots[0]}_ref`]: 'servicios/directos-4', [altOf(slots[0])]: 'Otra foto del sitio', media_rights_source: '' };
    await put(who, col, it.id, swap); const p2 = await publish(who, col, it.id); ok(p2.status === 200, `publicar foto del sitio ${p2.status} ${reason(p2)}`);
    const html2 = await until(route, h => h.includes('directos-4-1200.webp')); ok(html2.includes('directos-4-1200.webp') || html2.includes('directos-4.webp'), 'no aparece la foto del sitio elegida');
    // volver al original
    const restore = Object.fromEntries(slots.map(s => [`${s}_ref`, slots[0] === s ? slotDefault[col] : undefined]).filter(([, v]) => v)); await put(who, col, it.id, restore); await publish(who, col, it.id);
    return `${slots.length} ranuras: subida→derechos exigidos→publicada y visible; foto del sitio elegible; restaurada`;
  });
}
await step('fotos · portada de Quiénes somos: la precarga <link rel=preload> sigue la foto publicada', async () => {
  const it = await entry('page_quienes');
  const up = await upload('editor', 'hero-qs.png', 'image/png', png(1536, 1024, [10, 10, 10]));
  ok((await put('admin', 'page_quienes', it.id, { hero_foto: asFieldValue(up.json.data.item), hero_foto_alt: 'Portada de prueba', media_rights_source: RIGHTS })).status === 200, 'PUT');
  const pq = await publish('admin', 'page_quienes', it.id); ok(pq.status === 200, `publicar ${pq.status} ${reason(pq)}`);
  const html = await until('/quienes-somos/', h => h.includes(up.json.data.item.storageKey));
  ok(new RegExp(`rel="preload" as="image" href="/_emdash/api/media/file/${up.json.data.item.storageKey}"`).test(html) || new RegExp(`href="/_emdash/api/media/file/${up.json.data.item.storageKey}"[^>]*as="image"|as="image"[^>]*href="/_emdash/api/media/file/${up.json.data.item.storageKey}"`).test(html), 'precarga no actualizada');
  await put('admin', 'page_quienes', it.id, { hero_foto: null, media_rights_source: '' }); await publish('admin', 'page_quienes', it.id);
  const back = await until('/quienes-somos/', h => h.includes('equipo-10-sin-botella.webp') && !h.includes(up.json.data.item.storageKey));
  ok(back.includes('as="image"') && back.includes('equipo-10-sin-botella.webp'), 'no volvió la precarga original');
  return 'precarga y <img> de la portada coinciden con la foto publicada';
});

// ── 4. Logotipos y pósters (listas) ────────────────────────────────────────────────────
for (const [col, route, field] of [['clients', '/clientes/', 'logo'], ['band_logos', '/', 'logo'], ['projects', '/portfolio/', 'poster']]) {
  await step(`listas · ${col}: logotipo/póster por selector (foto subida), derechos, visibilidad y orden`, async () => {
    const items = await entries(col); ok(items.length >= 5, `${items.length} entradas`);
    for (const t of items) { await put('editor', col, t.id, { rights_ok: true, rights_source: RIGHTS }); const p = await publish('editor', col, t.id); ok(p.status === 200, `publicar ${t.slug} ${p.status} ${reason(p)}`); }
    const first = [...items].sort((a, b) => a.data.sort - b.data.sort)[0];
    const up = await upload('editor', `${col}.png`, 'image/png', png(300, 100, COLORS[(colorIdx++) % 5]));
    const data = { [field]: asFieldValue(up.json.data.item) };
    ok((await put('editor', col, first.id, data)).status === 200, 'PUT');
    ok((await publish('editor', col, first.id)).status === 200, 'publicar');
    const html = await until(route, h => h.includes(up.json.data.item.storageKey)); ok(html.includes(up.json.data.item.storageKey), `no aparece en ${route}`);
    await put('editor', col, first.id, { visible: false }); await publish('editor', col, first.id);
    const hidden = await until(route, h => !h.includes(up.json.data.item.storageKey)); ok(!hidden.includes(up.json.data.item.storageKey), 'visible=false no la oculta');
    await put('editor', col, first.id, { visible: true, [field]: null }); await publish('editor', col, first.id);
    return `${items.length} entradas publicadas; foto subida visible, ocultable y restaurable`;
  });
}
await step('listas · proyecto: video_key solo admite piezas del sitio y el vídeo no entra por formulario multipart', async () => {
  const proj = (await entries('projects'))[0];
  const bad = await put('editor', 'projects', proj.id, { video_key: 'https://evil.example/x.mp4' });
  const vid = await upload('editor', 'v.mp4', 'video/mp4', Buffer.from('0000'));
  ok(bad.status >= 400 || (await publish('editor', 'projects', proj.id)).status >= 400, 'video_key libre aceptado');
  ok(vid.status >= 400, `vídeo por multipart (${vid.status})`);
  return `video_key libre ${bad.status}; vídeo por multipart ${vid.status}`;
});


// ── 4b. Vídeo editable: subida por el camino del panel, Range y rechazos ──────────────
// MP4 sintético de 2 s con ffmpeg (testsrc, H.264, sin audio). Si no hay ffmpeg, MP4 mínimo hecho a mano (ftyp + moov con avc1 + mdat).
const box = (type, ...parts) => { const body = Buffer.concat(parts); const out = Buffer.alloc(8 + body.length); out.writeUInt32BE(out.length, 0); out.write(type, 4, 'latin1'); body.copy(out, 8); return out; };
const handMade = (codec = 'avc1', brand = 'isom') => Buffer.concat([box('ftyp', Buffer.from(brand + '\0\0\0\0isomavc1', 'latin1')), box('moov', box('trak', box('stsd', Buffer.from(`\0\0\0\0\0\0\0\x01${codec}`, 'latin1')))), box('mdat', Buffer.alloc(4096, 7))]);
const ffmpegMp4 = (faststart) => {
  const dir = mkdtempSync(join(tmpdir(), 'dp-e2e-')); const out = join(dir, 'v.mp4');
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=15', '-t', '2', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', ...(faststart ? ['-movflags', '+faststart'] : []), out]);
    return readFileSync(out);
  } catch { return null; } finally { rmSync(dir, { recursive: true, force: true }); }
};
const good = ffmpegMp4(true) ?? handMade();
// Sustituye 4 bytes: la primera aparición (marca ftyp) o la última (etiqueta del códec en stsd; avc1 también figura en las marcas compatibles).
const patch = (buf, from, to, last = false) => { const out = Buffer.from(buf); const at = last ? out.lastIndexOf(from, undefined, 'latin1') : out.indexOf(from, 0, 'latin1'); out.write(to, at, 'latin1'); return out; };
const mp4 = { good, noFast: (() => { const f = ffmpegMp4(false); return f && f.indexOf('moov') > f.indexOf('mdat') ? f : Buffer.concat([box('ftyp', Buffer.from('isom\0\0\0\0isomavc1', 'latin1')), box('mdat', Buffer.alloc(4096, 7)), box('moov', box('trak', box('stsd', Buffer.from('\0\0\0\0\0\0\0\x01avc1', 'latin1'))))]); })(),
  // HEVC/MOV: se parchea el mismo MP4 válido (la validación mira la marca ftyp y la etiqueta del códec en stsd).
  hevc: patch(good, 'avc1', 'hvc1', true), mov: patch(good, 'isom', 'qt  ') };
// Subida como el panel: upload-url → PUT (cuerpo crudo con su Content-Length) → confirm.
const videoUpload = async (who, filename, buf, { type = 'video/mp4', declared = buf.length } = {}) => {
  const u = await api(who, 'POST', '/_emdash/api/media/upload-url', { filename, contentType: type, size: declared });
  if (u.status !== 200) return { stage: 'upload-url', status: u.status, text: reason(u) };
  const d = u.json.data;
  const put = await fetch(`${BASE}${d.uploadUrl}`, { method: 'PUT', headers: { Origin: BASE, Authorization: `Bearer ${fx[who].token}`, 'Content-Type': type, ...(d.headers ?? {}) }, body: buf, redirect: 'manual' });
  const text = await put.text();
  if (put.status >= 300) { await api(who, 'DELETE', `/_emdash/api/media/${d.mediaId}`); return { stage: 'put', status: put.status, text: text.slice(0, 200) }; }
  const c = await api(who, 'POST', `/_emdash/api/media/${d.mediaId}/confirm`, { size: buf.length });
  return c.status === 200 ? { stage: 'ok', status: 200, item: c.json.data.item } : { stage: 'confirm', status: c.status, text: reason(c) };
};
await step('vídeo · rechazos: sin faststart, HEVC, MOV, WebM, vídeo disfrazado de PNG, extensión .mov y exceso de tamaño', async () => {
  const bad = { 'sin faststart': await videoUpload('editor', 'a.mp4', mp4.noFast), HEVC: await videoUpload('editor', 'b.mp4', mp4.hevc), 'MOV (ftyp qt)': await videoUpload('editor', 'c.mp4', mp4.mov),
    WebM: await videoUpload('editor', 'd.mp4', Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])), 'PNG como mp4': await videoUpload('editor', 'e.mp4', png(8, 8, [1, 2, 3])),
    '.mov': await videoUpload('editor', 'f.mov', mp4.good, { type: 'video/quicktime' }), '41 MB declarados': await videoUpload('editor', 'g.mp4', mp4.good, { declared: 41 * 1024 * 1024 }) };
  for (const [name, r] of Object.entries(bad)) ok(r.stage !== 'ok' && r.status >= 400 && r.status < 500, `${name} aceptado (${r.stage} ${r.status})`);
  ok(/Web optimizado/.test(bad['sin faststart'].text) && /HEVC/.test(bad.HEVC.text), `mensajes poco claros: ${bad['sin faststart'].text} | ${bad.HEVC.text}`);
  ok(bad['41 MB declarados'].status === 413, `exceso → ${bad['41 MB declarados'].status}`);
  ok((await api('editor', 'GET', '/_emdash/api/media?limit=100')).json?.data?.items?.every?.(i => !/^(a|b|c|d|e|f|g)\.(mp4|mov)$/.test(i.filename)) ?? true, 'quedó algún vídeo rechazado en la biblioteca');
  return `7 rechazos (${Object.values(bad).map(r => `${r.stage}:${r.status}`).join(', ')})`;
});
await step('vídeo · el editor sube un MP4 válido, lo publica en Inicio y el Worker lo sirve con Range (206/416/304/HEAD)', async () => {
  const up = await videoUpload('editor', 'prueba-portada.mp4', mp4.good); ok(up.stage === 'ok', `subida ${up.stage} ${up.status} ${up.text ?? ''}`);
  const item = up.item, key = item.storageKey; ok(/\.mp4$/i.test(key), `clave ${key}`);
  const home = await entry('page_home'); const before = { rights: home.data.media_rights_source ?? '' };
  const fv = asFieldValue(item); delete fv.width; delete fv.height;
  const r = await put('editor', 'page_home', home.id, { hero_video: fv, media_rights_source: RIGHTS }); ok(r.status === 200, `PUT ${r.status} ${reason(r)}`);
  const pub = await publish('editor', 'page_home', home.id); ok(pub.status === 200, `publicar ${pub.status} ${reason(pub)}`);
  const html = await until('/', h => h.includes(key)); ok(new RegExp(`data-home-video-src="[^"]*${key.replace(/\./g, '\\.')}`).test(html), 'Inicio no usa el vídeo subido');
  const url = `${BASE}/_emdash/api/media/file/${key}`; const size = good.length;
  const r1 = await fetch(url, { headers: { Range: 'bytes=0-1' } }); const body = Buffer.from(await r1.arrayBuffer());
  ok(r1.status === 206 && r1.headers.get('content-range') === `bytes 0-1/${size}` && r1.headers.get('accept-ranges') === 'bytes' && body.length === 2 && r1.headers.get('content-type') === 'video/mp4', `206 esperado: ${r1.status} ${r1.headers.get('content-range')} ${r1.headers.get('content-type')}`);
  ok(body.equals(good.subarray(0, 2)), 'los bytes 0-1 no coinciden');
  const r2 = await fetch(url, { headers: { Range: 'bytes=999999999-' } }); await r2.arrayBuffer(); ok(r2.status === 416 && r2.headers.get('content-range') === `bytes */${size}`, `416 esperado: ${r2.status}`);
  const etag = r1.headers.get('etag'); ok(etag, 'sin ETag');
  const r3 = await fetch(url, { headers: { 'If-None-Match': etag } }); await r3.arrayBuffer(); ok(r3.status === 304, `304 esperado: ${r3.status}`);
  const r4 = await fetch(url, { method: 'HEAD' }); ok(r4.status === 200 && Number(r4.headers.get('content-length')) === size, `HEAD ${r4.status} ${r4.headers.get('content-length')}`);
  const r5 = await fetch(url); const full = Buffer.from(await r5.arrayBuffer()); ok(r5.status === 200 && full.equals(good), `GET completo ${r5.status} ${full.length}/${size}`);
  // En uso no se borra; al quitarlo, Inicio vuelve al vídeo del sitio y el medio ya se puede borrar.
  const inUse = await api('editor', 'DELETE', `/_emdash/api/media/${item.id}`); ok(inUse.status >= 400, `borrado en uso permitido (${inUse.status})`);
  await put('editor', 'page_home', home.id, { hero_video: null, media_rights_source: before.rights }); await publish('editor', 'page_home', home.id);
  const after = await until('/', h => !h.includes(key)); ok(!after.includes(key) && /data-home-video-src="\/assets\/m4\/coberturas\/hero-review-desktop/.test(after), 'tras quitar el vídeo Inicio no vuelve al del sitio');
  const del = await api('admin', 'DELETE', `/_emdash/api/media/${item.id}`); ok(del.status < 300, `borrado ${del.status} ${reason(del)}`);
  return `${size} B; 206/416/304/HEAD correctos; en uso 409-like (${inUse.status}); al quitarlo vuelve al vídeo del sitio`;
});
await step('formularios · Inicio y Contacto llevan el formulario real y, con el proveedor simulado, el envío se acepta sin correo', async () => {
  for (const path of ['/', '/contacto/']) { const h = await page(path); ok(/<form\b[^>]*data-contact-form/.test(h) && /action="\/api\/contacto"/.test(h), `${path} sin formulario`); }
  const post = (extra = {}) => fetch(`${BASE}/api/contacto`, { method: 'POST', headers: { Origin: BASE, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ name: 'Prueba local', email: 'prueba@example.com', service: 'Otro proyecto', message: 'Mensaje sintético del e2e.', ...extra }).toString() }).then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) }));
  const a = await post(); if (a.json.code === 'origen') return 'omitido: el origen del build no es este puerto (EMDASH_SITE_URL)';
  const b = await post(); const bot = await post({ website: 'spam' });
  ok(a.status === 200 && a.json.delivery === 'simulated' && b.status === 200 && b.json.delivery === 'simulated', `envío ${a.status}/${b.status} ${a.json.code}`);
  ok(bot.status === 400, `honeypot ${bot.status}`);
  return `simulado ${a.json.code}; honeypot ${bot.status}`;
});

// ── 5. Negativas: alt, derechos, URL externa, hechos, privilegios ──────────────────────
await step('negativas · alt ausente o sin actualizar, derechos ausentes, URL externa, ruta tecleada, proveedor ajeno y SVG', async () => {
  const it = await entry('page_comunicacion'); const up = await upload('editor', 'neg.png', 'image/png', png(64, 64, [5, 5, 5])); const v = asFieldValue(up.json.data.item);
  const t = async (data, re, label) => { await put('editor', 'page_comunicacion', it.id, data); const r = await publish('editor', 'page_comunicacion', it.id); ok(r.status >= 400 && re.test(reason(r)), `${label}: ${r.status} ${reason(r)}`); return `${label} → ${r.status}`; };
  const out = [];
  out.push(await t({ hero_foto: v, hero_foto_alt: '', media_rights_source: RIGHTS }, /alternativo/i, 'sin alt'));
  out.push(await t({ hero_foto: v, hero_foto_alt: 'Un operador de cámara graba una declaración ante un edificio histórico, con varios micrófonos delante del interlocutor.', media_rights_source: RIGHTS }, /alternativo/i, 'alt sin actualizar'));
  out.push(await t({ hero_foto: v, hero_foto_alt: 'Descripción nueva', media_rights_source: '' }, /derechos/i, 'sin derechos'));
  out.push(await t({ hero_foto: { id: 'x', src: 'https://evil.example/a.png' }, hero_foto_alt: 'Externa', media_rights_source: RIGHTS }, /no admitida|válid/i, 'URL externa'));
  out.push(await t({ hero_foto: { ...v, provider: 'unsplash' }, hero_foto_alt: 'Proveedor ajeno', media_rights_source: RIGHTS }, /no admitida|válid/i, 'proveedor ajeno'));
  out.push(await t({ hero_foto: { ...v, mimeType: 'image/svg+xml' }, hero_foto_alt: 'SVG', media_rights_source: RIGHTS }, /no admitida|válid/i, 'SVG'));
  out.push(await t({ hero_foto: 'https://evil.example/a.png', hero_foto_alt: 'Cadena', media_rights_source: RIGHTS }, /no admitida|válid/i, 'URL como cadena'));
  const ref = await put('editor', 'page_comunicacion', it.id, { hero_foto: null, hero_foto_ref: '/assets/m4/equipo/equipo-3.jpeg', hero_foto_alt: 'Ruta' });
  const refPub = ref.status >= 400 ? ref : await publish('editor', 'page_comunicacion', it.id); ok(refPub.status >= 400, `ruta tecleada aceptada (${refPub.status})`);
  out.push(`ruta tecleada → ${refPub.status}`);
  await put('editor', 'page_comunicacion', it.id, { hero_foto: null, hero_foto_ref: null, hero_foto_alt: '', media_rights_source: '' });
  return out.join('; ');
});
await step('negativas · retrato: sin alt, estado incoherente, foto fuera de los retratos autorizados y sin derechos', async () => {
  const gon = bySlug('gonzalo-sanchez'); const outs = [];
  const t = async (data, re, label) => { const w = await put('editor', 'team', gon.id, data); const r = w.status >= 400 ? w : await publish('editor', 'team', gon.id); ok(r.status >= 400 && re.test(reason(r)), `${label}: ${r.status} ${reason(r)}`); outs.push(`${label} ${r.status}`); };
  await t({ photo_state: 'con_foto' }, /foto|pendiente/i, 'con_foto sin foto');
  await t({ photo_state: 'pendiente', photo_ref: 'equipo/perfiles/curro', photo_alt: 'x' }, /pendiente/i, 'pendiente con foto');
  await t({ photo_state: 'con_foto', photo_ref: 'equipo/perfiles/curro', photo_alt: '' }, /alternativo/i, 'sin alt');
  await t({ photo_state: 'con_foto', photo_ref: 'logos/remax', photo_alt: 'x' }, /biblioteca|valor|válid|option|opci/i, 'fuera de retratos');
  await t({ photo_state: 'pendiente', photo_ref: null, photo_alt: '', rights_ok: false }, /derechos/i, 'sin derechos');
  await put('editor', 'team', gon.id, { photo_state: 'pendiente', photo_ref: null, photo_alt: '', rights_ok: true, rights_source: RIGHTS });
  ok((await publish('editor', 'team', gon.id)).status === 200, 'no se restauró');
  return outs.join('; ');
});
await step('negativas · hechos: el editor no publica un dato de contacto tecleado; facts.yaml sigue intacto', async () => {
  const sha = () => createHash('sha256').update(readFileSync('content/facts.yaml')).digest('hex'); const before = sha();
  const c = await entry('page_contacto');
  await put('editor', 'page_contacto', c.id, { hero_entradilla: 'Llámanos al 679 729 727' });
  const r = await publish('editor', 'page_contacto', c.id); ok(r.status >= 400, `se publicó (${r.status})`);
  await put('editor', 'page_contacto', c.id, { hero_entradilla: c.data.hero_entradilla });
  const w = await api('admin', 'PUT', '/_emdash/api/facts', { id: 'contact.public_phone', value: '000' });
  ok(sha() === before, 'facts.yaml cambió'); return `publicar dato tecleado ${r.status}; PUT /facts ${w.status}; facts.yaml intacto`;
});
await step('negativas · privilegios: colaborador/autor no editan ni publican fotos; el editor no cambia esquema, usuarios ni facts', async () => {
  const it = await entry('page_home'); const t = (await entries('team'))[0];
  const a = await put('contributor', 'page_home', it.id, { serv_1_foto_alt: 'x' }); const b = await put('author', 'team', t.id, { role: 'x' });
  const c = await publish('author', 'team', t.id); const d = await publish('contributor', 'page_home', it.id);
  const e = await api('editor', 'POST', '/_emdash/api/schema/collections/team/fields', { slug: 'intruso', label: 'x', type: 'string' });
  const f = await api('editor', 'DELETE', '/_emdash/api/schema/collections/team?includeFields=true');
  const g = await api('editor', 'GET', '/_emdash/api/admin/users'); const h = await api('editor', 'POST', '/_emdash/api/admin/api-tokens', { name: 'x', scopes: ['admin'] });
  ok([a, b, c, d, e, f, g, h].every(r => r.status >= 400), `contrib ${a.status}/${d.status}, autor ${b.status}/${c.status}, esquema ${e.status}/${f.status}, usuarios ${g.status}, tokens ${h.status}`);
  const x = await upload('contributor', 'c.png', 'image/png', png(8, 8, [1, 1, 1]));
  return `colaborador edita ${a.status}/publica ${d.status}; autor edita ${b.status}/publica ${c.status}; editor esquema ${e.status}/${f.status}, usuarios ${g.status}, tokens ${h.status}; colaborador sube ${x.status}`;
});
await step('medios · un medio sin publicar no aparece en ninguna página pública', async () => {
  const up = await upload('editor', 'huerfana.png', 'image/png', png(50, 50, [77, 88, 99])); const key = up.json.data.item.storageKey;
  const pages = ['/', '/quienes-somos/', '/streaming/', '/comunicacion-marketing/', '/contacto/', '/portfolio/', '/clientes/', '/servicios/', '/blog/'];
  for (const p of pages) ok(!(await page(p)).includes(key), `${p} lo muestra`);
  const direct = await fetch(`${BASE}/_emdash/api/media/file/${key}`);
  return `no referenciada en ${pages.length} páginas; GET directo por clave aleatoria: ${direct.status} (limitación EmDash 1.1.0: el fichero es público por clave)`;
});
await step('medios · borrar un medio EN USO por una entrada publicada', async () => {
  const it = await entry('page_comunicacion'); const up = await upload('editor', 'enuso.png', 'image/png', png(60, 60, [11, 120, 33]));
  await put('editor', 'page_comunicacion', it.id, { eventos_foto: asFieldValue(up.json.data.item), eventos_foto_alt: 'En uso (prueba)', media_rights_source: RIGHTS });
  ok((await publish('editor', 'page_comunicacion', it.id)).status === 200, 'publicar');
  const usage = await api('editor', 'GET', `/_emdash/api/media/${up.json.data.item.id}/usage`);
  const del = await api('editor', 'DELETE', `/_emdash/api/media/${up.json.data.item.id}`);
  const used = usage.json?.data?.summary ?? usage.json?.data;
  const html = await page('/comunicacion-marketing/');
  const broken = html.includes(up.json.data.item.storageKey) && (await fetch(`${BASE}/_emdash/api/media/file/${up.json.data.item.storageKey}`)).status === 404;
  await put('editor', 'page_comunicacion', it.id, { eventos_foto: null, media_rights_source: '' }); await publish('editor', 'page_comunicacion', it.id);
  ok(del.status >= 400 && !broken, `el borrado de un medio en uso se permitió (${del.status}); imagen rota en la web: ${broken}. Uso: ${JSON.stringify(used).slice(0, 120)}`);
  return `borrado denegado (${del.status}) mientras está en uso`;
});
await step('caché · publicar/retirar/restaurar refleja foto, alt y foco en < 2 s', async () => {
  const it = await entry('page_comunicacion'); const up = await upload('editor', 'cache.png', 'image/png', png(90, 60, [200, 200, 20]));
  await api('editor', 'PUT', `/_emdash/api/media/${up.json.data.item.id}`, { focalX: 0.9, focalY: 0.1 });
  const item = (await api('editor', 'GET', `/_emdash/api/media/${up.json.data.item.id}`)).json.data.item; const key = item.storageKey;
  await put('editor', 'page_comunicacion', it.id, { eventos_foto: asFieldValue(item), eventos_foto_alt: 'Alt de caché', media_rights_source: RIGHTS });
  const t0 = Date.now(); await publish('editor', 'page_comunicacion', it.id);
  const html = await until('/comunicacion-marketing/', h => h.includes(key)); const ms = Date.now() - t0;
  const tag = imgs(html).find(i => i.includes(key)); ok(tag && attr(tag, 'alt') === 'Alt de caché' && /object-position:90% 10%/.test(tag), `etiqueta ${tag}`);
  ok(ms < 2000, `${ms} ms`);
  await put('editor', 'page_comunicacion', it.id, { eventos_foto_alt: 'Alt de caché 2' }); await publish('editor', 'page_comunicacion', it.id);
  const h2 = await until('/comunicacion-marketing/', h => h.includes('Alt de caché 2')); ok(h2.includes('Alt de caché 2'), 'el alt nuevo no llegó');
  // Las páginas del sitio no se retiran (ni el administrador): la foto se quita editando y publicando.
  const un = await unpublish('admin', 'page_comunicacion', it.id); ok(un.status >= 400, `retirar una página debería denegarse (${un.status})`);
  await put('editor', 'page_comunicacion', it.id, { eventos_foto: null, media_rights_source: '', eventos_foto_alt: '' }); await publish('editor', 'page_comunicacion', it.id);
  const after = await until('/comunicacion-marketing/', h => !h.includes(key)); ok(!after.includes(key), 'tras quitar la foto la web sigue sirviéndola');
  return `reflejo en ${ms} ms; alt nuevo visible; retirar la página denegado (${un.status}); al quitar la foto y publicar desaparece`;
});

// ── Resumen ───────────────────────────────────────────────────────────────────────────
const pass = results.filter(r => r.ok).length;
writeFileSync(`${PERSIST}/media-e2e-result.json`, JSON.stringify({ base: BASE, at: new Date().toISOString(), pass, total: results.length, results }, null, 1));
console.log(`\n${pass}/${results.length} pasos correctos`);
process.exitCode = pass === results.length ? 0 : 1;
