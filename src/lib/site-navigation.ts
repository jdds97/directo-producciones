export type SitePage = 'inicio' | 'quienes-somos' | 'portfolio' | 'servicios' | 'comunicacion' | 'produccion' | 'contacto' | 'blog';
export interface SiteLink { key: SitePage; label: string; href: string; relatedPaths?: string[] }

// La navegación normal usa las rutas públicas que ya sirven las páginas M4.
// Las rutas /interno/m3/ se conservan para revisión, fuera del menú del sitio.
export const siteLinks: SiteLink[] = [
  { key: 'inicio', label: 'Inicio', href: '/', relatedPaths: ['/interno/m3/inicio/'] },
  { key: 'quienes-somos', label: 'Quiénes somos', href: '/quienes-somos/', relatedPaths: ['/interno/m3/quienes-somos/'] },
  { key: 'portfolio', label: 'Portfolio', href: '/portfolio/', relatedPaths: ['/interno/m3/portfolio/'] },
  { key: 'servicios', label: 'Servicios', href: '/servicios/' },
  { key: 'comunicacion', label: 'Comunicación', href: '/comunicacion-marketing/', relatedPaths: ['/interno/m3/comunicacion/'] },
  { key: 'produccion', label: 'Producción', href: '/streaming/', relatedPaths: ['/interno/m3/produccion/'] },
  { key: 'contacto', label: 'Contacto', href: '/contacto/', relatedPaths: ['/interno/m3/contacto/'] },
  { key: 'blog', label: 'Blog', href: '/blog/', relatedPaths: ['/interno/m3/blog/'] },
];

const link = (key: SitePage) => siteLinks.find(item => item.key === key)!;
export const navigationItems = siteLinks.filter(item => item.key !== 'servicios');

export function pageHref(key: SitePage): string {
  return link(key).href;
}

export function isCurrentPage(pathname: string, item: SiteLink) {
  const matches = (path: string) => path === '/'
    ? pathname === '/'
    : pathname === path || pathname.startsWith(path);
  return matches(item.href) || Boolean(item.relatedPaths?.some(matches));
}
