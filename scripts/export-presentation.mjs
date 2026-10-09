import { readFile, writeFile, mkdir, cp, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

// Exporta únicamente páginas renderizadas y activos del diseño. No exporta el CMS.
const origin = new URL(process.env.PRESENTATION_ORIGIN || 'http://localhost:4394');
if (!['localhost', '127.0.0.1'].includes(origin.hostname)) throw new Error('Usar el Worker local.');
const output = resolve('preview-html');
const routes = {
  '/': 'index.html', '/servicios/': 'servicios.html', '/clientes/': 'clientes.html',
  '/quienes-somos/': 'quienes-somos.html', '/streaming/': 'streaming.html',
  '/comunicacion-marketing/': 'comunicacion-marketing.html', '/blog/': 'blog.html',
  '/blog/comprobacion-local/': 'articulo-real.html', '/contacto/': 'contacto.html',
  '/cookies/': 'cookies.html', '/privacidad/': 'privacidad.html',
  '/aviso-legal/': 'aviso-legal.html', '/interno/guia/': 'guia.html',
  '/interno/articulo/': 'articulo.html', '/pagina-no-encontrada/': '404.html',
};
await mkdir(output, { recursive: true });
await cp('public/assets/m4', `${output}/assets/m4`, { recursive: true });
for (const [route, file] of Object.entries(routes)) {
  const response = await fetch(new URL(route, origin));
  if (response.status !== (file === '404.html' ? 404 : 200)) throw new Error(`${route}: ${response.status}`);
  let html = await response.text();
  // CSS y JavaScript integrados para abrir los HTML también mediante file://.
  for (const match of [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)]) {
    const css = await readFile(resolve('dist/client', match[1].slice(1)), 'utf8');
    html = html.replace(match[0], `<style>${css.replaceAll('/assets/m4/', 'assets/m4/')}</style>`);
  }
  for (const match of [...html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g)]) {
    let js = await readFile(resolve('dist/client', match[1].slice(1)), 'utf8');
    if (/\bimport\s/.test(js)) throw new Error('El script requiere módulos externos; revisar el export.');
    js = js.replace('e.href=t.pathname+t.search+t.hash', 'e.href=t.href');
    js = js.replace('history.replaceState(null,``,e.pathname+e.search+e.hash)', 'history.replaceState(null,``,e.href)');
    const theme = 'if(new URL(location.href).searchParams.get("theme")==="dark"){document.body.classList.add("theme-dark");document.querySelector(".artboard").classList.add("theme-dark");}';
    html = html.replace(match[0], `<script>${theme}${js}</script>`);
  }
  html = html.replace(/\b(href|src)="(\/[^\"]*)"/g, (_whole, attribute, raw) => {
    const url = new URL(raw.replaceAll('&amp;', '&'), origin);
    let target;
    if (url.pathname.startsWith('/assets/m4/')) target = url.pathname.slice(1);
    else if (url.pathname.startsWith('/_emdash/')) target = 'emdash.html';
    else target = routes[url.pathname];
    if (!target) throw new Error(`${route}: referencia sin exportar ${raw}`);
    return `${attribute}="${target}${url.search}${url.hash}"`;
  });
  html = html.replace('BORRADOR LOCAL · Copy en revisión editorial. Envíos y analítica desactivados.', 'PRESENTACIÓN · Copy M4 en borrador. Envíos y analítica desactivados.');
  await writeFile(`${output}/${file}`, html);
}
const cms = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex,nofollow"><title>EmDash · Presentación</title><style>body{font:18px/1.6 system-ui;max-width:760px;margin:64px auto;padding:24px;background:#f4f8fa;color:#172b34}a{color:#164e63}</style><h1>Blog con EmDash</h1><p>El CMS real está implementado en Astro y funciona en el Worker local. Esta entrega HTML es una presentación estática: no incluye cuentas, credenciales, bases de datos ni un panel simulado.</p><p><a href="http://localhost:4394/_emdash/admin/">Abrir el CMS real en este ordenador</a></p><p>La edición corporativa/global sigue pendiente. El copy de la presentación es borrador.</p><a href="index.html">Volver a Inicio</a></html>`;
await writeFile(`${output}/emdash.html`, cms);
await writeFile(`${output}/README.md`, '# Presentación M4 → Astro\n\nAbrir index.html en un navegador. Incluye todas las páginas de diseño, temas claro/oscuro, navegación, menú responsive, guía visual y plantillas. Los HTML se exportan del Worker Astro verificado; el blog es una instantánea sintética. Copy M4 en borrador, legales pendientes y formulario deshabilitado. No es un despliegue de producción. EmDash se demuestra mediante el Worker local, no mediante estos HTML.\n\nRegenerar con el Worker local activo: npm run export:presentation.\n');
const files = await readdir(output);
console.log(`Presentación exportada: ${files.filter(file => file.endsWith('.html')).length} HTML, sin estado del CMS.`);
