export type SitePage = 'inicio' | 'quienes-somos' | 'portfolio' | 'comunicacion' | 'produccion' | 'contacto' | 'blog';
export interface SiteLink { key: SitePage; label: string; href: string; relatedPaths?: string[] }

// Contrato M3: destinos provisionales de preview. No fija slugs ni redirects de producción.
export const siteLinks: SiteLink[] = [
  { key: 'inicio', label: 'Inicio', href: '/interno/m3/inicio/', relatedPaths: ['/'] },
  { key: 'quienes-somos', label: 'Quiénes somos', href: '/interno/m3/quienes-somos/', relatedPaths: ['/quienes-somos/'] },
  { key: 'portfolio', label: 'Portfolio', href: '/interno/m3/portfolio/' },
  { key: 'comunicacion', label: 'Comunicación', href: '/interno/m3/comunicacion/', relatedPaths: ['/comunicacion-marketing/'] },
  { key: 'produccion', label: 'Producción', href: '/interno/m3/produccion/', relatedPaths: ['/streaming/'] },
  { key: 'contacto', label: 'Contacto', href: '/interno/m3/contacto/', relatedPaths: ['/contacto/'] },
  { key: 'blog', label: 'Blog', href: '/interno/m3/blog/', relatedPaths: ['/blog/'] },
];
export function pageHref(key: SitePage): string {
  return siteLinks.find(link => link.key === key)!.href;
}
export function isCurrentPage(pathname: string, link: SiteLink) {
  return pathname === link.href || pathname.startsWith(link.href) ||
    Boolean(link.relatedPaths?.some(path => pathname === path || (path !== '/' && pathname.startsWith(path))));
}
