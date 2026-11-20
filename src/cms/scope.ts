export function isCmsPath(path: string): boolean {
  return path === '/interno/m3/blog' || path.startsWith('/interno/m3/blog/') || path === '/blog' || path.startsWith('/blog/') || isPanelPath(path);
}
// Panel y API de EmDash (incluidos sus medios): sin la CSP del sitio y, en producción, sin caché salvo los medios públicos.
// El blog también es isCmsPath (runtime y sesión de EmDash), pero es HTML público: lleva la CSP y la caché de las demás páginas.
export function isPanelPath(path: string): boolean {
  return path === '/_emdash' || path.startsWith('/_emdash/');
}
// Rutas corporativas que leen contenido de EmDash (fase 03). Solo reciben el runtime de lectura y el
// contexto de petición; setup, auth, redirecciones y medios de EmDash siguen limitados a isCmsPath.
const contentRoutes = new Set([
  '/', '/quienes-somos', '/portfolio', '/servicios', '/comunicacion-marketing', '/streaming', '/clientes',
  '/contacto', '/404', '/cookies', '/privacidad', '/aviso-legal', '/preguntas-frecuentes',
]);
export function isContentPath(path: string): boolean {
  if (path.startsWith('/interno/')) return true; // páginas de revisión local: mismo Base, misma lectura
  return contentRoutes.has(path === '/' ? path : path.replace(/\/$/, ''));
}
