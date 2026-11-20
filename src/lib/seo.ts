// Única capa de metadatos SEO. Base.astro es el ÚNICO emisor del <head>: lee de aquí título, descripción, robots,
// canonical, Open Graph/Twitter y JSON-LD. Funciones puras (el entorno entra por parámetro) para probarlas por entorno.
//  - local/preview: noindex siempre; el canonical apunta al origen que sirve la página (nunca a producción).
//  - production: indexable salvo 404, rutas internas y archivos paginados/etiquetas.
import { approvedFact } from './facts';

export type Env = 'local' | 'preview' | 'production';
export const SITE_NAME = 'Directo Producciones';
export const PRODUCTION_ORIGIN = 'https://directoproducciones.com';
// Open Graph 1200×630 generados con material ya publicado (public/og/, ver docs/seo-corte.md). Las páginas sin imagen propia usan la de Inicio.
export const DEFAULT_IMAGE = { path: '/og/home.jpg', width: 1200, height: 630, alt: 'Directo Producciones' };
const OG_BY_PATH: Record<string, string> = { '/servicios/': 'servicios', '/streaming/': 'streaming', '/comunicacion-marketing/': 'comunicacion', '/portfolio/': 'portfolio', '/clientes/': 'clientes' };
const SITE_DESCRIPTION = 'Streaming, comunicación y marketing para eventos, empresas e instituciones.';

export interface PageMeta { title: string; description: string; crumb: string; brand?: boolean; sitemap?: boolean }
// Defaults en código (reutilizan el texto de cada página; sin cifras ni promesas). La ficha SEO del CMS los sustituye.
export const PAGES: Record<string, PageMeta> = {
  '/': { title: `${SITE_NAME} · Streaming, comunicación y marketing`, brand: false, crumb: 'Inicio', sitemap: true,
    description: 'Tu evento en directo, tu marca en conversación. Streaming, comunicación y marketing para lo que quieres contar.' },
  '/quienes-somos/': { title: 'Quiénes somos', crumb: 'Quiénes somos', sitemap: true,
    description: 'El equipo de Directo Producciones une estrategia, creatividad y producción para la comunicación de tu empresa. Con sede en Sevilla.' },
  '/servicios/': { title: 'Servicios', crumb: 'Servicios', sitemap: true,
    description: 'Streaming de eventos y realización televisiva, comunicación y marketing digital para tu proyecto.' },
  '/streaming/': { title: 'Producción audiovisual', crumb: 'Producción', sitemap: true,
    description: 'Realización de eventos en directo, cobertura informativa, fotografía y vídeos corporativos para empresas, instituciones y medios.' },
  '/comunicacion-marketing/': { title: 'Comunicación y marketing', crumb: 'Comunicación y marketing', sitemap: true,
    description: 'Páginas web, redes sociales, campañas, eventos y notas de prensa: comunicación adaptada a los objetivos de tu empresa.' },
  '/portfolio/': { title: 'Portfolio', crumb: 'Portfolio', sitemap: true,
    description: 'Fragmentos de directos, rodajes y conexiones de televisión de Directo Producciones, con su contexto.' },
  '/clientes/': { title: 'Clientes', crumb: 'Clientes', sitemap: true,
    description: 'Instituciones, empresas y marcas que forman parte de la trayectoria de Directo Producciones.' },
  '/preguntas-frecuentes/': { title: 'Preguntas frecuentes', crumb: 'Preguntas frecuentes', sitemap: true,
    description: 'Dudas habituales sobre streaming y directos, producción audiovisual, comunicación y marketing, y cómo contactar con Directo Producciones.' },
  '/contacto/': { title: 'Contacto', crumb: 'Contacto', sitemap: true,
    description: 'Cuéntanos el evento o el proyecto que estás preparando: formulario, teléfono, WhatsApp y correo de Directo Producciones.' },
  '/blog/': { title: 'Blog', crumb: 'Blog', sitemap: true,
    description: 'Un espacio editorial para el streaming, la comunicación y el marketing digital.' },
  '/privacidad/': { title: 'Política de privacidad', crumb: 'Privacidad', sitemap: true,
    description: 'Cómo trata Directo Producciones los datos personales que recibe a través de su web.' },
  '/aviso-legal/': { title: 'Aviso legal', crumb: 'Aviso legal', sitemap: true,
    description: 'Información legal de la web de Directo Producciones.' },
  '/cookies/': { title: 'Política de cookies', crumb: 'Cookies', sitemap: true,
    description: 'Qué almacenamiento y cookies usa la web de Directo Producciones y cómo gestionarlos.' },
  '/condiciones/': { title: 'Condiciones del servicio', crumb: 'Condiciones', sitemap: true,
    description: 'Condiciones que se aplican a la información, los presupuestos y los encargos de servicios de Directo Producciones.' },
};

export interface VideoMeta { name: string; description: string; contentUrl: string; thumbnailUrl: string; uploadDate?: string }
export interface SeoInput {
  env: Env;
  requestOrigin: string;      // origen que sirve la página (local/preview)
  path: string;               // pathname de la petición
  search?: string;
  title?: string;             // título de la página (sin marca) o título completo de la ficha SEO
  description?: string;
  image?: { src: string; width?: number; height?: number; alt?: string };
  type?: 'website' | 'article';
  article?: { publishedTime?: string; modifiedTime?: string; author?: string; section?: string };
  crumbs?: { name: string; path: string }[];
  index?: boolean;            // false: la plantilla no debe indexarse (404, etiquetas, interno)
  notFound?: boolean;
  /** Vídeos propios publicados de la página (solo Inicio los usa): salen como VideoObject. */
  videos?: VideoMeta[];
}
export interface SeoHead {
  title: string; description: string; robots: string; canonical: string | null;
  og: Record<string, string>; twitter: Record<string, string>; jsonLd: object[];
}

export const originFor = (env: Env, requestOrigin: string) => (env === 'production' ? PRODUCTION_ORIGIN : requestOrigin.replace(/\/$/, ''));
export function normalizePath(path: string): string {
  const p = path.split(/[?#]/)[0] || '/';
  if (p === '/' || p.endsWith('/') || /\.[a-z0-9]+$/i.test(p)) return p;
  return `${p}/`;
}
const absolute = (origin: string, src: string) => (/^https?:\/\//.test(src) ? src : `${origin}${src.startsWith('/') ? '' : '/'}${src}`);
const clip = (text: string, max: number) => {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
};
/** Clave para comparar nombres: sin mayúsculas, espacios sobrantes, punto o coma final ni sufijo societario («S.L.», «SL», «S.L.U.»). */
const nameKey = (name: string) => name.toLocaleLowerCase('es').replace(/\s+/g, ' ').trim().replace(/[.,]$/, '').replace(/[\s,]+s\.?\s?l\.?(?:u\.?)?$/, '');

/** Datos de la organización solo desde hechos APROBADOS; con el estado actual de facts.yaml no hay teléfono, correo ni redes. */
export function organization(origin: string): Record<string, unknown> {
  const phone = approvedFact('contact.public_phone')?.value;
  const email = approvedFact('contact.email')?.value;
  const sameAs = ['contact.social_instagram', 'contact.social_facebook', 'contact.social_x']
    .map(id => approvedFact(id)?.value).filter((v): v is string => Boolean(v && /^https:\/\//.test(v)));
  // Sede aprobada «Ciudad (barrio)»: solo la localidad, sin calle (no hay dirección postal aprobada).
  const city = approvedFact('entity.headquarters')?.value?.split('(')[0].trim();
  return {
    '@type': 'Organization', '@id': `${origin}/#organization`, name: SITE_NAME, url: `${origin}/`,
    logo: { '@type': 'ImageObject', url: `${origin}/assets/logo.jpg`, width: 200, height: 200 },
    ...(phone || email ? { contactPoint: { '@type': 'ContactPoint', contactType: 'customer service', areaServed: 'ES', availableLanguage: 'es',
      ...(phone ? { telephone: phone } : {}), ...(email ? { email } : {}) } } : {}),
    ...(sameAs.length ? { sameAs } : {}),
    ...(city ? { address: { '@type': 'PostalAddress', addressLocality: city, addressCountry: 'ES' } } : {}),
  };
}

export function buildSeo(input: SeoInput): SeoHead {
  const { env } = input;
  const origin = originFor(env, input.requestOrigin);
  const path = normalizePath(input.path);
  const defaults = PAGES[path];
  const paginated = new URLSearchParams(input.search ?? '').has('cursor');
  const indexable = env === 'production' && input.index !== false && !input.notFound && !paginated;
  const robots = env !== 'production' ? 'noindex, nofollow, noarchive'
    : indexable ? 'index, follow, max-image-preview:large' : 'noindex, follow';
  const brandless = defaults?.brand === false;
  const base = clip(input.title?.trim() || defaults?.title || SITE_NAME, 70);
  // La marca solo se añade si el título sigue cabiendo en 60 caracteres (lo que muestra Google); un título largo (entradas) va solo.
  const branded = `${base} · ${SITE_NAME}`;
  const full = brandless || base.includes(SITE_NAME) || branded.length > 60 ? base : branded;
  const title = env === 'production' ? full : `${full} · Borrador`;
  const description = clip(input.description?.trim() || defaults?.description || SITE_DESCRIPTION, 200);
  const canonical = input.notFound ? null : `${origin}${path}`;
  const image = input.image ?? { src: OG_BY_PATH[path] ? `/og/${OG_BY_PATH[path]}.jpg` : DEFAULT_IMAGE.path, width: DEFAULT_IMAGE.width, height: DEFAULT_IMAGE.height, alt: DEFAULT_IMAGE.alt };
  const imageUrl = absolute(origin, image.src);
  const og: Record<string, string> = {
    'og:type': input.type ?? 'website', 'og:site_name': SITE_NAME, 'og:locale': 'es_ES', 'og:title': title.replace(/ · Borrador$/, ''),
    'og:description': description, ...(canonical ? { 'og:url': canonical } : {}), 'og:image': imageUrl,
    ...(image.width && image.height ? { 'og:image:width': String(image.width), 'og:image:height': String(image.height) } : {}),
    ...(image.alt ? { 'og:image:alt': image.alt } : {}),
    ...(input.type === 'article' && input.article?.publishedTime ? { 'article:published_time': input.article.publishedTime } : {}),
    ...(input.type === 'article' && input.article?.modifiedTime ? { 'article:modified_time': input.article.modifiedTime } : {}),
    ...(input.type === 'article' && input.article?.section ? { 'article:section': input.article.section } : {}),
  };
  const twitter = { 'twitter:card': 'summary_large_image', 'twitter:title': og['og:title'], 'twitter:description': description, 'twitter:image': imageUrl };

  const jsonLd: object[] = [];
  if (!input.notFound && input.index !== false) {
    if (path === '/') {
      jsonLd.push({ '@context': 'https://schema.org', ...organization(origin) });
      jsonLd.push({ '@context': 'https://schema.org', '@type': 'WebSite', '@id': `${origin}/#website`, url: `${origin}/`, name: SITE_NAME, inLanguage: 'es', publisher: { '@id': `${origin}/#organization` } });
      for (const video of input.videos ?? []) { const data = videoObject(origin, video); if (data) jsonLd.push(data); }
    } else {
      const crumbs = input.crumbs ?? [{ name: 'Inicio', path: '/' }, { name: defaults?.crumb ?? base, path }];
      jsonLd.push({ '@context': 'https://schema.org', '@type': 'BreadcrumbList',
        itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: `${origin}${normalizePath(c.path)}` })) });
    }
    if (input.type === 'article' && canonical) {
      // La empresa firma como Organization (no como Person): autor vacío o igual al nombre del sitio (ver nameKey).
      const author = input.article?.author?.trim();
      jsonLd.push({ '@context': 'https://schema.org', '@type': 'BlogPosting', mainEntityOfPage: canonical, headline: clip(base, 110), description,
        ...(input.image ? { image: [imageUrl] } : {}),
        ...(input.article?.publishedTime ? { datePublished: input.article.publishedTime } : {}),
        ...((input.article?.modifiedTime ?? input.article?.publishedTime) ? { dateModified: input.article?.modifiedTime ?? input.article?.publishedTime } : {}),
        author: author && nameKey(author) !== nameKey(SITE_NAME) ? { '@type': 'Person', name: author }
          : { '@type': 'Organization', '@id': `${origin}/#organization`, name: SITE_NAME, url: `${origin}/` },
        publisher: organization(origin), inLanguage: 'es' });
    }
  }
  return { title, description, robots, canonical, og, twitter, jsonLd };
}

/** VideoObject de un vídeo propio publicado. Devuelve null si falta un dato obligatorio real (nunca se inventa la fecha ni la miniatura). */
export function videoObject(origin: string, v: VideoMeta): object | null {
  if (!v.name.trim() || !v.description.trim() || !v.uploadDate || Number.isNaN(Date.parse(v.uploadDate))) return null;
  return { '@context': 'https://schema.org', '@type': 'VideoObject', name: clip(v.name.trim(), 110), description: clip(v.description.trim(), 300),
    contentUrl: absolute(origin, v.contentUrl), thumbnailUrl: [absolute(origin, v.thumbnailUrl)], uploadDate: new Date(v.uploadDate).toISOString(), inLanguage: 'es' };
}

/** Los `<` se escapan para que el JSON nunca pueda cerrar el <script> que lo contiene. */
export const jsonLdScript = (data: object) => JSON.stringify(data).replace(/</g, '\\u003c');

// ---------- robots.txt, sitemap.xml, llms.txt ----------
export function robotsTxt(env: Env, requestOrigin: string): string {
  if (env !== 'production') return 'User-agent: *\nDisallow: /\n';
  const origin = originFor(env, requestOrigin);
  // Los medios del blog viven bajo /_emdash/api/media/: no se bloquean. robots.txt no es control de acceso.
  return `User-agent: *\nAllow: /\nDisallow: /_emdash/admin/\nDisallow: /api/\nDisallow: /interno/\n\nSitemap: ${origin}/sitemap.xml\n`;
}
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export interface SitemapEntry { path: string; lastmod?: string }
export const staticSitemapPaths = (): SitemapEntry[] => Object.entries(PAGES).filter(([, m]) => m.sitemap).map(([path]) => ({ path }));
export function sitemapXml(env: Env, requestOrigin: string, entries: SitemapEntry[]): string {
  const origin = originFor(env, requestOrigin);
  const seen = new Set<string>();
  const urls = entries.filter(e => { const p = normalizePath(e.path); if (seen.has(p)) return false; seen.add(p); return true; })
    .map(e => `  <url><loc>${xml(origin + normalizePath(e.path))}</loc>${e.lastmod ? `<lastmod>${xml(e.lastmod)}</lastmod>` : ''}</url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}
/** RSS 2.0 del blog: solo entradas publicadas, con URL canónica y fecha real (`pubDate` ISO). La descripción es el extracto, nunca el cuerpo. */
export interface FeedItem { title: string; path: string; description?: string; pubDate?: string }
export function rssXml(env: Env, requestOrigin: string, items: FeedItem[]): string {
  const origin = originFor(env, requestOrigin);
  const lastBuild = items.map(i => i.pubDate).filter(Boolean).sort().at(-1);
  const rows = items.map(i => `    <item><title>${xml(i.title)}</title><link>${xml(origin + normalizePath(i.path))}</link><guid isPermaLink="true">${xml(origin + normalizePath(i.path))}</guid>`
    + `${i.pubDate ? `<pubDate>${new Date(i.pubDate).toUTCString()}</pubDate>` : ''}${i.description ? `<description>${xml(clip(i.description, 300))}</description>` : ''}</item>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n  <channel>\n    <title>Blog de ${SITE_NAME}</title>\n    <link>${origin}/blog/</link>\n`
    + `    <description>${xml(PAGES['/blog/'].description)}</description>\n    <language>es-ES</language>\n    <atom:link href="${origin}/rss.xml" rel="self" type="application/rss+xml"/>\n`
    + `${lastBuild ? `    <lastBuildDate>${new Date(lastBuild).toUTCString()}</lastBuildDate>\n` : ''}${rows.join('\n')}\n  </channel>\n</rss>\n`;
}
/** Índice Markdown curado (D-44): solo páginas públicas con URL canónica. No garantiza citas ni regula el entrenamiento. */
export function llmsTxt(env: Env, requestOrigin: string): string {
  const origin = originFor(env, requestOrigin);
  const lines = Object.entries(PAGES).filter(([p, m]) => m.sitemap && p !== '/' && !/\/(privacidad|aviso-legal|cookies|condiciones)\/$/.test(p))
    .map(([p, m]) => `- [${m.crumb}](${origin}${p}): ${m.description}`);
  return `# ${SITE_NAME}\n\n> ${SITE_DESCRIPTION}\n\n## Páginas\n\n${lines.join('\n')}\n`;
}
