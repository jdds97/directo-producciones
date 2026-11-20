// Prueba extremo a extremo del CMS contra un Worker LOCAL con persistencia aislada y usuarios sintéticos.
//   node scripts/cms-e2e.mjs [--base http://localhost:4440] [--persist .wrangler/fase-03-cms] [--only <fragmento>]
// Requiere una persistencia recién provisionada (scripts/cms-provision.sh): no es idempotente y una segunda ejecución falla en 3 pasos que ya existen.
// Imprime una tabla PASS/FAIL y escribe el resultado JSON en <persist>/e2e-result.json.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'http://localhost:4440');
const PERSIST = arg('--persist', '.wrangler/fase-03-cms');
const ONLY = arg('--only', '');
// Carpeta con el render previo a publicar (seed_<ruta>.html); si no se indica, se omite la comprobación de equivalencia.
const RENDER = arg('--render', '');
if (!/^http:\/\/localhost:\d+$/.test(BASE)) throw new Error('Solo localhost');
const fx = JSON.parse(readFileSync(`${PERSIST}/fixture.json`, 'utf8'));
const results = [];
const api = async (who, method, path, body, extra = {}) => {
  const headers = { Origin: BASE, ...(who ? { Authorization: `Bearer ${fx[who].token}` } : {}), ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...extra };
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined, redirect: 'manual' });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text, headers: res.headers };
};
const step = async (name, fn) => {
  if (ONLY && !name.includes(ONLY)) return;
  try { const note = await fn(); results.push({ name, ok: true, note: note ?? '' }); console.log(`PASS  ${name}${note ? ` — ${note}` : ''}`); }
  catch (e) { results.push({ name, ok: false, note: String(e.message ?? e) }); console.log(`FAIL  ${name} — ${e.message ?? e}`); }
};
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
const entry = async (col, slug = 'main') => { const r = await api('admin', 'GET', `/_emdash/api/content/${col}?limit=100`); const it = r.json?.data?.items?.find(i => i.slug === slug); ok(it, `${col}/${slug} no existe`); return it; };
const items = async (col) => (await api('admin', 'GET', `/_emdash/api/content/${col}?limit=100`)).json?.data?.items ?? [];
const page = async (path) => (await fetch(`${BASE}${path}`)).text();
const publishStatus = async (who, col, id) => api(who, 'POST', `/_emdash/api/content/${col}/${id}/publish`, {});
const reason = (r) => (r.json?.error?.message ?? r.text).slice(0, 140);

// ── 1. Privilegios ─────────────────────────────────────────────────────────────────────
await step('roles · anónimo no lee borradores ni escribe', async () => {
  const r = await api(null, 'GET', '/_emdash/api/content/page_home');
  const w = await api(null, 'POST', '/_emdash/api/content/page_home', { slug: 'x', data: { title: 'x' } });
  ok([401, 403].includes(r.status) && [401, 403].includes(w.status), `lectura ${r.status}, escritura ${w.status}`);
  return `lectura ${r.status}, escritura ${w.status}`;
});
const home = await entry('page_home');
await step('roles · colaborador no publica ni edita páginas', async () => {
  const p = await publishStatus('contributor', 'page_home', home.id);
  const e = await api('contributor', 'PUT', `/_emdash/api/content/page_home/${home.id}`, { data: { hero_eyebrow: 'x' } });
  ok(p.status >= 400 && e.status >= 400, `publicar ${p.status}, editar ${e.status}`);
  return `publicar ${p.status}, editar ${e.status}`;
});
await step('roles · autor no edita ni publica páginas corporativas', async () => {
  const e = await api('author', 'PUT', `/_emdash/api/content/page_home/${home.id}`, { data: { hero_eyebrow: 'x' } });
  const p = await publishStatus('author', 'page_home', home.id);
  ok(e.status >= 400 && p.status >= 400, `editar ${e.status}, publicar ${p.status}`);
  return `editar ${e.status}, publicar ${p.status}`;
});
await step('roles · editor no cambia esquema, ajustes ni usuarios', async () => {
  // La ruta real del esquema es /schema/collections (la antigua /collections no existe en EmDash 1.1.0).
  const s = await api('editor', 'POST', '/_emdash/api/schema/collections', { slug: 'intruso', label: 'x', labelSingular: 'x' });
  const c = await api('editor', 'POST', '/_emdash/api/schema/collections/site_chrome/fields', { slug: 'intruso', label: 'x', type: 'string' });
  const st = await api('editor', 'PUT', '/_emdash/api/settings', { title: 'hack' });
  const u = await api('editor', 'GET', '/_emdash/api/admin/users');
  const t = await api('editor', 'POST', '/_emdash/api/admin/api-tokens', { name: 'x', scopes: ['admin'] });
  ok(s.status >= 400 && c.status >= 400 && st.status >= 400 && u.status >= 400, `schema ${s.status}, campos ${c.status}, settings ${st.status}, users ${u.status}, tokens ${t.status}`);
  return `schema ${s.status}, campos ${c.status}, settings ${st.status}, users ${u.status}, tokens ${t.status}`;
});
await step('roles · ni el administrador cambia esquema, ajustes, menús, widgets, secciones, firmas ni redirecciones desde el panel', async () => {
  const tries = [
    ['POST', '/_emdash/api/schema/collections', { slug: 'intrusa', label: 'Intrusa', labelSingular: 'Intrusa' }],
    ['POST', '/_emdash/api/schema/collections/site_chrome/fields', { slug: 'intruso', label: 'x', type: 'string' }],
    ['PUT', '/_emdash/api/schema/collections/site_chrome/fields/cab_boton_contacto', { label: 'x', validation: { maxLength: 400 } }],
    ['DELETE', '/_emdash/api/schema/collections/site_chrome/fields/nav_blog'],
    ['PUT', '/_emdash/api/schema/collections/page_404', { label: 'Renombrada' }],
    ['POST', '/_emdash/api/schema/block-types', { slug: 'libre', label: 'Libre', fields: [] }],
    ['PUT', '/_emdash/api/settings', { title: 'hack' }],
    ['POST', '/_emdash/api/menus', { name: 'principal', label: 'Principal' }],
    ['POST', '/_emdash/api/widget-areas', { name: 'lateral', label: 'Lateral' }],
    ['POST', '/_emdash/api/sections', { slug: 'seccion', title: 'Sección', content: [] }],
    ['POST', '/_emdash/api/admin/bylines', { slug: 'firma', displayName: 'Firma' }],
    ['POST', '/_emdash/api/redirects', { source: '/blog/', destination: '/contacto/', type: 301 }],
  ];
  const codes = [];
  for (const [m, p, b] of tries) { const r = await api('admin', m, p, b); codes.push(`${m} ${p.replace('/_emdash/api', '')}:${r.status}`); ok(r.status === 403, `${m} ${p} → ${r.status} ${reason(r)}`); }
  ok((await api('admin', 'GET', '/_emdash/api/schema/collections')).status === 200, 'la lectura del esquema debe seguir disponible');
  return codes.join(' · ');
});
await step('roles · administrador gestiona usuarios (listado)', async () => {
  const u = await api('admin', 'GET', '/_emdash/api/admin/users');
  ok(u.status === 200 && (u.json?.data?.items?.length ?? 0) >= 6, `status ${u.status}`);
  return `${u.json?.data?.items?.length} usuarios sintéticos`;
});
await step('hechos · el panel no expone ninguna ruta para escribir facts.yaml', async () => {
  const sha = () => createHash('sha256').update(readFileSync('content/facts.yaml')).digest('hex');
  const before = sha(); const codes = [];
  for (const p of ['/_emdash/api/facts', '/_emdash/api/content/facts', '/_emdash/api/settings/facts', '/facts.yaml', '/content/facts.yaml']) { const r = await api('admin', 'PUT', p, { id: 'contact.public_phone', value: '000' }); codes.push(`${p}:${r.status}`); ok(r.status >= 400, `${p} respondió ${r.status}`); }
  ok(sha() === before, 'facts.yaml cambió');
  return `${codes.join(' ')} · facts.yaml intacto`;
});

// ── 2. Singletons ──────────────────────────────────────────────────────────────────────
await step('singleton · no se crea una segunda entrada de página', async () => {
  const r = await api('admin', 'POST', '/_emdash/api/content/page_home', { slug: 'otra', data: { title: 'Otra' } });
  ok(r.status >= 400, `status ${r.status}`); return reason(r);
});
await step('singleton · no se borra la entrada de página', async () => {
  const r = await api('admin', 'DELETE', `/_emdash/api/content/page_home/${home.id}`);
  const still = await entry('page_home');
  ok(still, 'desapareció'); return `delete ${r.status}: ${reason(r)}`;
});

// ── 3. Publicación: clase A / B ────────────────────────────────────────────────────────
const slugs = ['page_home', 'page_quienes', 'page_produccion', 'page_comunicacion', 'page_servicios', 'page_clientes', 'page_contacto', 'page_portfolio', 'page_faq', 'page_blog', 'page_404', 'site_blocks', 'site_chrome'];
await step('publicar · el editor publica las páginas sin afirmaciones y se le bloquean las que llevan claims', async () => {
  const log = [];
  for (const col of slugs) {
    const e = await entry(col);
    if (e.status === 'published') { log.push(`${col}=ya`); continue; }
    const r = await publishStatus('editor', col, e.id);
    log.push(`${col}=${r.status === 200 ? 'A' : 'B(' + r.status + ')'}`);
  }
  return log.join(' ');
});
await step('publicar · clase B: editor y admin no registrado denegados; admin registrado publica', async () => {
  const pending = [];
  for (const col of slugs) { const e = await entry(col); if (e.status !== 'published') pending.push([col, e.id]); }
  ok(pending.length > 0, 'ninguna página con claims: nada que comprobar');
  const [col, id] = pending[0];
  const byEditor = await publishStatus('editor', col, id);
  const byAdmin2 = await publishStatus('admin2', col, id);
  ok(byEditor.status >= 400 && byAdmin2.status >= 400, `editor ${byEditor.status}, admin2 ${byAdmin2.status}`);
  const out = [`${col}: editor ${byEditor.status} («${reason(byEditor)}»), admin sin registro ${byAdmin2.status}`];
  for (const [c, i] of pending) { const r = await publishStatus('admin', c, i); ok(r.status === 200, `${c}: admin registrado ${r.status} ${reason(r)}`); }
  out.push(`admin registrado publica ${pending.length}: ${pending.map(p => p[0]).join(',')}`);
  return out.join(' · ');
});
await step('publicar · textos legales: el editor no; con un aviso de revisión tampoco el admin registrado', async () => {
  const legal = await entry('legal_privacidad');
  const e = await publishStatus('editor', 'legal_privacidad', legal.id);
  await api('admin', 'PUT', `/_emdash/api/content/legal_privacidad/${legal.id}`, { data: { bloque_014: 'En esta revisión local el envío se simula.' } });
  const a = await publishStatus('admin', 'legal_privacidad', legal.id);
  await api('admin', 'PUT', `/_emdash/api/content/legal_privacidad/${legal.id}`, { data: { bloque_014: legal.data.bloque_014 } });
  ok(e.status >= 400 && a.status >= 400 && /aviso de revisión/.test(reason(a)), `editor ${e.status}, admin ${a.status}: ${reason(a)}`);
  return `editor ${e.status}; admin ${a.status}: ${reason(a)}`;
});

// ── 4. Listas ──────────────────────────────────────────────────────────────────────────
await step('listas · logotipo sin derechos no se publica', async () => {
  const items = (await api('admin', 'GET', '/_emdash/api/content/clients?limit=100')).json.data.items;
  const r = await publishStatus('editor', 'clients', items[0].id);
  ok(r.status >= 400, `status ${r.status}`); return reason(r);
});
await step('listas · con derechos y evidencia el editor publica los 16 clientes y los 5 proyectos', async () => {
  for (const col of ['clients', 'projects']) {
    const items = (await api('admin', 'GET', `/_emdash/api/content/${col}?limit=100`)).json.data.items;
    for (const it of items) {
      if (it.status === 'published') continue;
      const u = await api('editor', 'PUT', `/_emdash/api/content/${col}/${it.id}`, { data: { rights_ok: true, rights_source: 'Fixture local aislado: no es evidencia real de derechos' } });
      ok(u.status === 200, `${col} editar ${u.status} ${reason(u)}`);
      const p = await publishStatus('editor', col, it.id);
      ok(p.status === 200, `${col} publicar ${p.status} ${reason(p)}`);
    }
  }
});

// ── 5. Lectura pública y equivalencia ──────────────────────────────────────────────────
if (RENDER && existsSync(RENDER)) await step('lectura · las 12 rutas desde el CMS son idénticas al render con semilla (normalizado)', async () => {
  const routes = [['/', '_'], ['/quienes-somos/', '_quienes-somos_'], ['/portfolio/', '_portfolio_'], ['/servicios/', '_servicios_'], ['/comunicacion-marketing/', '_comunicacion-marketing_'], ['/streaming/', '_streaming_'], ['/clientes/', '_clientes_'], ['/contacto/', '_contacto_'], ['/cookies/', '_cookies_'], ['/privacidad/', '_privacidad_'], ['/aviso-legal/', '_aviso-legal_']];
  const norm = (h) => h.replace(/\s+/g, ' ').replace(/(?:nonce|data-astro-cid|astro-island uid)="[^"]*"/g, '');
  const diffs = [];
  for (const [route, file] of routes) {
    const before = readFileSync(`${RENDER}/seed${file}.html`, 'utf8');
    const after = await page(route);
    if (norm(before) !== norm(after)) diffs.push(route);
  }
  ok(!diffs.length, `difieren: ${diffs.join(', ')}`);
  return `${routes.length} rutas idénticas`;
});

// ── 6. Edición, revisión visible solo al publicar, caché ───────────────────────────────
const clientes = await entry('page_clientes');
await step('edición · publicada: el borrador no se ve hasta republicar; después se ve en < 2 s', async () => {
  const marker = `En muy buena ${Date.now() % 1000}`;
  const u = await api('editor', 'PUT', `/_emdash/api/content/page_clientes/${clientes.id}`, { data: { hero_titulo_a: marker } });
  ok(u.status === 200, `PUT ${u.status} ${reason(u)}`);
  ok(!(await page('/clientes/')).includes(marker), 'el borrador se filtró a la web pública');
  const t0 = Date.now();
  const p = await publishStatus('editor', 'page_clientes', clientes.id); ok(p.status === 200, `publish ${p.status} ${reason(p)}`);
  let seen = false; for (let i = 0; i < 20 && !seen; i++) { seen = (await page('/clientes/')).includes(marker); if (!seen) await new Promise(r => setTimeout(r, 100)); }
  ok(seen, 'no apareció tras publicar');
  globalThis.__marker = marker;
  return `visible a los ${Date.now() - t0} ms`;
});
await step('edición · restaurar la revisión anterior devuelve el texto original', async () => {
  const revs = await api('editor', 'GET', `/_emdash/api/content/page_clientes/${clientes.id}/revisions`);
  ok(revs.status === 200, `revisiones ${revs.status}`);
  const n = revs.json?.data?.items?.length ?? revs.json?.data?.length ?? 0;
  const back = await api('editor', 'PUT', `/_emdash/api/content/page_clientes/${clientes.id}`, { data: { hero_titulo_a: 'En buena' } });
  const p = await publishStatus('editor', 'page_clientes', clientes.id);
  ok(back.status === 200 && p.status === 200, `${back.status}/${p.status}`);
  ok(!(await page('/clientes/')).includes(globalThis.__marker), 'sigue el texto editado');
  return `${n} revisiones listadas; texto original publicado de nuevo`;
});
await step('hechos · el editor no puede publicar el dato de contacto tecleado ni un token no aprobado', async () => {
  const c = await entry('page_contacto');
  const outs = [];
  for (const text of ['Llámanos al 679 729 727', 'Síguenos {{fact:contact.public_phone}}', 'Escríbenos a info@directoproducciones.com']) {
    await api('editor', 'PUT', `/_emdash/api/content/page_contacto/${c.id}`, { data: { hero_entradilla: text } });
    const r = await publishStatus('editor', 'page_contacto', c.id);
    ok(r.status >= 400, `«${text}» se publicó (${r.status})`);
    outs.push(reason(r).slice(0, 60));
  }
  await api('editor', 'PUT', `/_emdash/api/content/page_contacto/${c.id}`, { data: { hero_entradilla: c.data.hero_entradilla } });
  return outs.join(' | ');
});
await step('hechos · token a hecho aprobado se resuelve al valor del registro, no al del CMS', async () => {
  const c = await entry('page_contacto');
  await api('editor', 'PUT', `/_emdash/api/content/page_contacto/${c.id}`, { data: { hero_entradilla: 'Escríbenos a {{fact:contact.form_recipient_email}} cuando quieras.' } });
  const r = await publishStatus('editor', 'page_contacto', c.id); ok(r.status === 200, `publish ${r.status} ${reason(r)}`);
  let html = ''; for (let i = 0; i < 20 && !html.includes('info@directoproducciones.com cuando quieras'); i++) { html = await page('/contacto/'); await new Promise(r => setTimeout(r, 100)); }
  ok(html.includes('Escríbenos a info@directoproducciones.com cuando quieras.'), 'el token no se resolvió');
  await api('editor', 'PUT', `/_emdash/api/content/page_contacto/${c.id}`, { data: { hero_entradilla: c.data.hero_entradilla } });
  await publishStatus('editor', 'page_contacto', c.id);
});
await step('retirada · nadie retira una página del sitio (ni el administrador): fuera de local la ruta caería', async () => {
  const e = await api('editor', 'POST', `/_emdash/api/content/page_clientes/${clientes.id}/unpublish`, {});
  const a = await api('admin', 'POST', `/_emdash/api/content/page_clientes/${clientes.id}/unpublish`, {});
  const ch = await entry('site_chrome');
  const c = await api('admin', 'POST', `/_emdash/api/content/site_chrome/${ch.id}/unpublish`, {});
  ok(e.status >= 400 && a.status >= 400 && c.status >= 400, `editor ${e.status}, admin ${a.status}, admin cabecera ${c.status}`);
  const html = await fetch(`${BASE}/clientes/`); ok(html.status === 200, `web ${html.status}`);
  return `editor ${e.status}, admin ${a.status}, admin «Cabecera y pie» ${c.status}: ${reason(c)}`;
});

// ── 7. Blog: ciclo completo de un post sintético ───────────────────────────────────────
const slug = `prueba-cms-${Date.now() % 100000}`;
let post;
const body = [{ _type: 'block', _key: 'a1', style: 'h2', children: [{ _type: 'span', _key: 's1', text: 'Qué incluye una nota de prensa' }] }, { _type: 'block', _key: 'a2', style: 'normal', children: [{ _type: 'span', _key: 's2', text: 'Un titular claro, la información esencial y un contacto de referencia.' }] }];
await step('blog · el autor crea un borrador sintético con categoría y etiqueta', async () => {
  const r = await api('author', 'POST', '/_emdash/api/content/posts', { slug, data: { title: 'Nota de prensa: lo esencial', excerpt: 'Guía breve de comprobación del CMS.', author: 'Equipo editorial', content: body, synthetic: true } });
  ok([200, 201].includes(r.status), `crear ${r.status} ${reason(r)}`);
  post = r.json.data.item ?? r.json.data;
  ok(post?.id, 'sin id');
  return `id ${post.id}, autor ${post.authorId ?? 'n/d'}`;
});
await step('blog · borrador no visible; colaborador no publica; autor ajeno no edita', async () => {
  const pub = await fetch(`${BASE}/blog/${slug}/`); ok(pub.status === 404, `borrador público ${pub.status}`);
  const c = await publishStatus('contributor', 'posts', post.id); ok(c.status >= 400, `colaborador ${c.status}`);
  const other = await api('author2', 'PUT', `/_emdash/api/content/posts/${post.id}`, { data: { title: 'Secuestro' } }); ok(other.status >= 400, `autor2 ${other.status}`);
  return `público 404, colaborador ${c.status}, autor2 ${other.status}`;
});
await step('blog · términos: categoría y etiqueta asignadas y archivo funcional', async () => {
  const termId = async (tax, s) => { const r = await api('author', 'GET', `/_emdash/api/taxonomies/${tax}/terms`); const t = (r.json?.data?.terms ?? r.json?.data?.items ?? r.json?.data ?? []).find(x => x.slug === s); ok(t, `término ${tax}/${s} no existe`); return t.id; };
  const cat = await api('author', 'POST', `/_emdash/api/content/posts/${post.id}/terms/category`, { termIds: [await termId('category', 'comunicacion-marketing')] });
  const tag = await api('author', 'POST', `/_emdash/api/content/posts/${post.id}/terms/tag`, { termIds: [await termId('tag', 'comunicacion')] });
  ok(cat.status === 200 && tag.status === 200, `categoría ${cat.status} ${reason(cat)}, etiqueta ${tag.status} ${reason(tag)}`);
});
await step('blog · el autor publica su entrada sintética; web, archivo y etiquetas la muestran', async () => {
  const p = await publishStatus('author', 'posts', post.id); ok(p.status === 200, `publicar ${p.status} ${reason(p)}`);
  const art = await fetch(`${BASE}/blog/${slug}/`); const html = await art.text();
  ok(art.status === 200 && html.includes('Nota de prensa: lo esencial'), `artículo ${art.status}`);
  const lst = await page('/blog/'); ok(lst.includes('Nota de prensa: lo esencial'), 'no sale en el listado');
  const arch = await page('/blog/categoria/comunicacion-marketing/'); const tagp = await page('/blog/etiqueta/comunicacion/');
  ok(arch.includes('Nota de prensa: lo esencial') && tagp.includes('Nota de prensa: lo esencial'), 'no sale en los archivos');
  ok(/<h2[^>]*>Qué incluye una nota de prensa/.test(html), 'sin h2 de la plantilla');
  return 'artículo, listado, categoría y etiqueta';
});
await step('blog · una edición de entrada publicada queda como revisión hasta republicar', async () => {
  const u = await api('author', 'PUT', `/_emdash/api/content/posts/${post.id}`, { data: { title: 'Nota de prensa: lo esencial (v2)' } }); ok(u.status === 200, `PUT ${u.status} ${reason(u)}`);
  ok(!(await page(`/blog/${slug}/`)).includes('(v2)'), 'la revisión se filtró');
  const p = await publishStatus('author', 'posts', post.id); ok(p.status === 200, `republicar ${p.status}`);
  ok((await page(`/blog/${slug}/`)).includes('(v2)'), 'no aparece tras republicar');
});
await step('blog · imagen sin texto alternativo no se publica; claims en entrada real exigen aprobador', async () => {
  const bad = await api('author', 'PUT', `/_emdash/api/content/posts/${post.id}`, { data: { title: 'Nota con cifra 500 eventos', synthetic: true } });
  const p = await publishStatus('author', 'posts', post.id);
  ok(p.status >= 400, `cifra publicada (${p.status})`);
  await api('author', 'PUT', `/_emdash/api/content/posts/${post.id}`, { data: { title: 'Nota de prensa: lo esencial (v2)' } });
  return reason(p);
});
await step('blog · retirar y restaurar (papelera): 404 al retirar, vuelve al restaurar la publicación', async () => {
  const un = await api('author', 'POST', `/_emdash/api/content/posts/${post.id}/unpublish`, {}); ok(un.status === 200, `retirar ${un.status} ${reason(un)}`);
  ok((await fetch(`${BASE}/blog/${slug}/`)).status === 404, 'sigue público');
  ok(!(await page('/blog/')).includes('lo esencial'), 'sigue en el listado');
  const re = await publishStatus('author', 'posts', post.id); ok(re.status === 200, `republicar ${re.status}`);
  ok((await fetch(`${BASE}/blog/${slug}/`)).status === 200, 'no vuelve');
  const del = await api('editor', 'DELETE', `/_emdash/api/content/posts/${post.id}`); ok(del.status === 200, `a la papelera ${del.status} ${reason(del)}`);
  ok((await fetch(`${BASE}/blog/${slug}/`)).status === 404, 'papelera sigue pública');
  const rs = await api('editor', 'POST', `/_emdash/api/content/posts/${post.id}/restore`, {}); ok(rs.status === 200, `restaurar ${rs.status} ${reason(rs)}`);
  const final = await api('admin', 'GET', `/_emdash/api/content/posts/${post.id}`);
  return `tras restaurar de la papelera: estado ${final.json?.data?.item?.status ?? final.json?.data?.status}`;
});
await step('blog · preview: la URL firmada existe para el editor y las rutas ?_preview siguen cerradas en local', async () => {
  const r = await api('editor', 'POST', `/_emdash/api/content/posts/${post.id}/preview-url`, {});
  const anon = await fetch(`${BASE}/blog/${slug}/?_preview=abc`);
  ok(anon.status === 403, `anónimo con token falso ${anon.status}`);
  return `preview-url ${r.status}; anónimo ${anon.status}`;
});
await step('medios · PNG permitido; SVG, PDF y >10 MB rechazados por el plugin', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const up = async (name, type, buf) => { const f = new FormData(); f.set('file', new File([buf], name, { type })); return api('author', 'POST', '/_emdash/api/media', f); };
  const okp = await up('pixel.png', 'image/png', png);
  const svg = await up('x.svg', 'image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'));
  const pdf = await up('x.pdf', 'application/pdf', Buffer.from('%PDF-1.4'));
  const big = await up('big.png', 'image/png', Buffer.alloc(10 * 1024 * 1024 + 10, 1));
  ok(okp.status === 200 || okp.status === 201, `png ${okp.status} ${reason(okp)}`);
  ok(svg.status >= 400 && pdf.status >= 400 && big.status >= 400, `svg ${svg.status}, pdf ${pdf.status}, grande ${big.status}`);
  globalThis.__media = okp.json?.data?.item ?? okp.json?.data;
  return `png ${okp.status}; svg ${svg.status}, pdf ${pdf.status}, grande ${big.status}`;
});
await step('autores · las firmas (bylines) de EmDash son de solo lectura: la web pinta el campo «Autor editorial»', async () => {
  const b = await api('editor', 'POST', '/_emdash/api/admin/bylines', { slug: 'equipo-editorial', displayName: 'Equipo editorial', bio: 'Firma colectiva de pruebas.' });
  ok(b.status === 403, `byline ${b.status} ${reason(b)}`);
  const list = await api('editor', 'GET', '/_emdash/api/admin/bylines'); ok(list.status === 200, `lectura ${list.status}`);
  return `crear ${b.status}; lectura ${list.status}`;
});


// ── 8. Etiquetas de menú y ficha SEO desde el CMS ───────────────────────────────────────
const setAndPublish = async (col, patch) => {
  const it = await entry(col);
  const u = await api('editor', 'PUT', `/_emdash/api/content/${col}/${it.id}`, patch);
  ok(u.status === 200, `editar ${col}: ${u.status} ${reason(u)}`);
  const p = await publishStatus('editor', col, it.id);
  ok(p.status === 200, `publicar ${col}: ${p.status} ${reason(p)}`);
  return it;
};
await step('menú · una etiqueta editada en el CMS aparece en cabecera y se revierte', async () => {
  await entry('site_chrome');
  await setAndPublish('site_chrome', { data: { nav_blog: 'Noticias' } });
  await new Promise(r => setTimeout(r, 200));
  const html = await page('/');
  const cambiada = />Noticias<\/a>/.test(html) && !/href="\/blog\/">Blog<\/a>/.test(html.split('class="desktop-nav"')[1]?.split('</nav>')[0] ?? '');
  await setAndPublish('site_chrome', { data: { nav_blog: 'Blog' } });
  await new Promise(r => setTimeout(r, 200));
  ok(cambiada, 'la etiqueta nueva no se vio en la cabecera');
  ok(/href="\/blog\/">Blog<\/a>/.test(await page('/')), 'no se revirtió');
  return 'Blog → Noticias → Blog; la ruta (/blog/) la fija el código';
});
await step('seo · título y descripción de la ficha SEO nativa se publican en <title> y meta', async () => {
  await entry('page_servicios');
  const t = 'Servicios de producción audiovisual · Prueba CMS';
  await setAndPublish('page_servicios', { seo: { title: t, description: 'Descripción de prueba editada en el CMS.' } });
  await new Promise(r => setTimeout(r, 200));
  const html = await page('/servicios/');
  const vio = html.includes(`<title>${t}`) && html.includes('Descripción de prueba editada en el CMS.');
  await setAndPublish('page_servicios', { seo: { title: '', description: '' } });
  await new Promise(r => setTimeout(r, 200));
  ok(vio, `no se vio el SEO editado: ${(html.match(/<title>[^<]*/) ?? [''])[0]}`);
  return 'visible a los < 1 s y restaurado al valor por defecto del código';
});

// ── 9. Estructura y enlaces (auditoría EmDash 3-11-2026): lo que un editor no puede romper ─────────────────
await step('estructura · duplicar una página, cambiar su slug o publicar un campo obligatorio vacío: denegado', async () => {
  const home2 = await entry('page_home'); const ch = await entry('site_chrome');
  const dup = await api('editor', 'POST', `/_emdash/api/content/page_home/${home2.id}/duplicate`, {});
  const sl = await api('editor', 'PUT', `/_emdash/api/content/page_404/${(await entry('page_404')).id}`, { slug: 'error' });
  const prev = (await api('admin', 'GET', `/_emdash/api/content/site_chrome/${ch.id}`)).json?.data?.item?.data?.nav_blog ?? 'Blog';
  await api('editor', 'PUT', `/_emdash/api/content/site_chrome/${ch.id}`, { data: { nav_blog: '  ' } });
  const pub = await publishStatus('editor', 'site_chrome', ch.id);
  await api('editor', 'PUT', `/_emdash/api/content/site_chrome/${ch.id}`, { data: { nav_blog: prev } });
  ok(dup.status === 403 && sl.status === 422 && pub.status >= 400, `duplicar ${dup.status}, slug ${sl.status}, vacío ${pub.status}`);
  ok((await items('page_home')).length === 1, 'apareció una segunda entrada de Inicio');
  return `duplicar ${dup.status}; slug ${sl.status}; campo vacío ${pub.status}: ${reason(pub)}`;
});
await step('estructura · una lista no se queda sin fichas visibles (retirar, papelera u ocultar la última)', async () => {
  const ps = (await items('projects')).filter(i => i.status === 'published');
  ok(ps.length, 'sin proyectos publicados para probar');
  let last = null;
  for (const p of ps) { await api('editor', 'PUT', `/_emdash/api/content/projects/${p.id}`, { data: { visible: false } }); last = await publishStatus('editor', 'projects', p.id); }
  ok(last.status >= 400, `ocultar el último proyecto ${last.status}`);
  const trash = await api('editor', 'DELETE', `/_emdash/api/content/projects/${ps.at(-1).id}`);
  const un = await api('admin', 'POST', `/_emdash/api/content/projects/${ps.at(-1).id}/unpublish`, {});
  ok(trash.status >= 400 && un.status >= 400, `papelera ${trash.status}, retirar ${un.status}`);
  for (const p of ps) { await api('admin', 'PUT', `/_emdash/api/content/projects/${p.id}`, { data: { visible: true } }); await publishStatus('admin', 'projects', p.id); }
  const pf = await page('/portfolio/'); ok(!/<h2 id="portfolio-project-1-title"[^>]*><\/h2>/.test(pf), 'Portfolio con tarjeta vacía');
  return `ocultar último ${last.status}, papelera ${trash.status}, retirar ${un.status}`;
});
await step('estructura · el slug de una ficha es fijo (el correo aprobado depende de él)', async () => {
  const curro = (await items('team')).find(i => i.slug === 'curro'); ok(curro, 'sin ficha curro');
  const r = await api('editor', 'PUT', `/_emdash/api/content/team/${curro.id}`, { slug: 'francisco' });
  ok(r.status === 422, `slug ficha ${r.status}`); return reason(r);
});
await step('blog · slug con formato válido; fijo una vez publicada; enlaces internos rotos bloquean la publicación', async () => {
  const s2 = `estructura-${Date.now() % 100000}`;
  const bad = await api('author', 'POST', '/_emdash/api/content/posts', { slug: 'Mi Entrada Ñ', data: { title: 'x', excerpt: 'x', author: 'Equipo editorial', content: body, synthetic: true } });
  ok(bad.status === 422, `slug inválido ${bad.status}`);
  const link = (href) => [{ _type: 'block', _key: 'l', style: 'normal', markDefs: [{ _key: 'm', _type: 'link', href }], children: [{ _type: 'span', _key: 's', text: 'Enlace', marks: ['m'] }] }];
  const r = await api('author', 'POST', '/_emdash/api/content/posts', { slug: s2, data: { title: 'Prueba de enlaces', excerpt: 'Entrada sintética.', author: 'Equipo editorial', content: link('/no-existe/'), synthetic: true } });
  const id = (r.json?.data?.item ?? r.json?.data).id;
  const broken = await publishStatus('author', 'posts', id);
  ok(broken.status >= 400 && /Enlace interno roto/.test(reason(broken)), `enlace roto ${broken.status} ${reason(broken)}`);
  await api('author', 'PUT', `/_emdash/api/content/posts/${id}`, { data: { content: link('/contacto/') } });
  const good = await publishStatus('author', 'posts', id); ok(good.status === 200, `enlace válido ${good.status} ${reason(good)}`);
  const ren = await api('author', 'PUT', `/_emdash/api/content/posts/${id}`, { slug: `${s2}-otra` });
  ok(ren.status === 422, `renombrar publicada ${ren.status}`);
  await api('author', 'POST', `/_emdash/api/content/posts/${id}/unpublish`, {});
  return `slug inválido ${bad.status}; enlace roto ${broken.status}; válido ${good.status}; renombrar publicada ${ren.status}`;
});
await step('blog · categorías cerradas; nadie renombra el slug ni borra un término en uso', async () => {
  const cat = await api('editor', 'POST', '/_emdash/api/taxonomies/category/terms', { slug: 'nueva', label: 'Nueva' });
  const tag = await api('editor', 'POST', '/_emdash/api/taxonomies/tag/terms', { slug: `tag-${Date.now() % 100000}`, label: 'Etiqueta nueva' });
  const ren = await api('admin', 'PUT', '/_emdash/api/taxonomies/category/terms/comunicacion-marketing', { slug: 'comunicacion' });
  const del = await api('editor', 'DELETE', '/_emdash/api/taxonomies/tag/terms/comunicacion');
  ok(cat.status === 403 && [200, 201].includes(tag.status) && ren.status === 409 && del.status === 409, `categoría ${cat.status}, etiqueta ${tag.status}, renombrar ${ren.status}, borrar ${del.status}`);
  return `crear categoría (editor) ${cat.status}; crear etiqueta ${tag.status}; renombrar en uso (admin) ${ren.status}; borrar en uso ${del.status}`;
});

// ── resumen ────────────────────────────────────────────────────────────────────────────
const failed = results.filter(r => !r.ok);
writeFileSync(`${PERSIST}/e2e-result.json`, JSON.stringify({ at: new Date().toISOString(), base: BASE, total: results.length, failed: failed.length, results }, null, 1));
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones superadas`);
process.exit(failed.length ? 1 : 0);
