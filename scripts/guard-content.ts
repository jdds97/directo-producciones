import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { experimental_readRawConfig } from 'wrangler';
import { createHash } from 'node:crypto';
import { parse } from 'yaml';
import { m4PortfolioProjects } from '../src/lib/m4-portfolio-projects';
import { collections as contractCollections, lists as contractLists } from '../src/cms/contract';
import { mediaRegistry, videoRegistry } from '../src/lib/media-registry';
if (existsSync('.env')) process.loadEnvFile('.env');
// Dynamic imports required so process.loadEnvFile('.env') executes before flags module reads process.env.
const { APP_ENV, CANONICAL_ORIGIN } = await import('../src/config/flags');
const { facts, isApproved, approvedFact, validateFacts, forbiddenText } = await import('../src/lib/facts');
const { contentErrors, reviewMarkerText, unguardedReviewMarker } = await import('../src/lib/content-policy');

function listFiles(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? listFiles(join(dir, e.name)) : [join(dir, e.name)]) : [];
}
const errors = validateFacts();
// Fuera de local el cierre depende de los controles reales (no de una condición local permanente): hito de lanzamiento en producción,
// almacenamiento de medios resuelto en preview. Los controles de medios D-36/M2 de más abajo siguen aplicando en cualquier entorno.
{
  const { launchBlockers, previewBlockers } = await import('../src/config/env-policy');
  const launchState = JSON.parse(readFileSync('config/launch.json', 'utf8'));
  if (APP_ENV === 'production') errors.push(...launchBlockers(launchState));
  if (APP_ENV === 'preview') errors.push(...previewBlockers(launchState));
}
// Revisión privada: local, o preview con protección real en wrangler (Access + compuerta delante de TODO). Aplica los mismos controles de
// medios D-36/M2 (manifiesto, hash, procedencia, alt) que local; NO es una aprobación de derechos ni de publicación pública. Producción no entra.
let reviewEnv = APP_ENV === 'local';
if (APP_ENV === 'preview') {
  const { previewProtectionBlockers } = await import('../src/config/env-policy');
  const { unstable_readConfig } = await import('wrangler');
  const previewCfg = unstable_readConfig({ config: 'wrangler.jsonc', env: 'preview' }, { hideWarnings: true }) as { vars?: Record<string, unknown>; assets?: { run_worker_first?: unknown } };
  const protection = previewProtectionBlockers(previewCfg);
  errors.push(...protection);
  reviewEnv = protection.length === 0;
}
const recipientFact = approvedFact('contact.form_recipient_email');
const contactScript = existsSync('src/scripts/contact-form.ts') ? readFileSync('src/scripts/contact-form.ts', 'utf8') : '';
// Única captura pública autorizada: formulario POST a /api/contacto, dirigido al destinatario aprobado.
const isConfiguredContactForm = (page: string, rendered = false) => {
  const markup = page.match(/<form\b[\s\S]*?<\/form>/i)?.[0] ?? '';
  const formTag = markup.match(/<form\b[^>]*>/i)?.[0] ?? '';
  const factBound = rendered
    ? formTag.includes(`data-fact-id="${recipientFact?.id}"`)
    : formTag.includes('data-fact-id={recipient?.id}') && page.includes('contact.form_recipient_email');
  return Boolean(recipientFact) && formTag.includes('data-contact-form') &&
    /\smethod="post"/i.test(formTag) && /\saction="\/api\/contacto"/i.test(formTag) && factBound &&
    /<button\b[^>]*type="submit"/i.test(markup) && !/<button\b[^>]*disabled/i.test(markup) &&
    markup.includes('name="name"') && markup.includes('name="email"') && markup.includes('name="message"') &&
    markup.includes('name="website"') && markup.includes('contact-form-privacy') &&
    !/\bname="to"|wa\.me|data-whatsapp/i.test(markup) &&
    !/wa\.me/.test(contactScript) && contactScript.includes('form.action');
};
// Endpoint y transporte: el destinatario sale del fact, nunca del cuerpo; el envío es Cloudflare Email Sending por el binding
// `send_email` (sin clave), y cada binding queda restringido a un remitente y a destinatarios fijos. Nunca `remote: true`.
const endpoint = existsSync('src/pages/api/contacto.ts') ? readFileSync('src/pages/api/contacto.ts', 'utf8') : '';
if (!endpoint.includes("approvedFact('contact.form_recipient_email')") || /get\(['"]to['"]\)|\.to\b\s*=\s*(?:body|fields|input)/.test(endpoint)) {
  errors.push('src/pages/api/contacto.ts: el destinatario debe salir solo del fact aprobado contact.form_recipient_email.');
}
const wrangler = readFileSync('wrangler.jsonc', 'utf8');
if (/"remote"\s*:\s*true/.test(wrangler)) errors.push('wrangler.jsonc: sin bindings remote (desde local enviarían correo real o tocarían recursos remotos).');
// Lectura estructurada (JSONC con comentarios) de todos los bloques send_email: el nivel superior y cada entorno.
const { rawConfig } = experimental_readRawConfig({ config: 'wrangler.jsonc' });
const recipient = approvedFact('contact.form_recipient_email')?.value;
const sendBindings = [rawConfig, ...Object.values(rawConfig.env ?? {})].flatMap((c) => (c as { send_email?: Record<string, unknown>[] }).send_email ?? []);
const one = (v: unknown) => (Array.isArray(v) && v.length === 1 ? v[0] : undefined);
if (sendBindings.some((b) => b.name !== 'CONTACT_EMAIL' || !/^[^"@\s]+@avisos\.directoproducciones\.com$/.test(String(one(b.allowed_sender_addresses))) ||
  (one(b.allowed_destination_addresses) ?? b.destination_address) !== recipient || (b.allowed_destination_addresses && b.destination_address))) {
  errors.push('wrangler.jsonc: cada binding send_email debe llamarse CONTACT_EMAIL, enviar solo desde una dirección de avisos.directoproducciones.com y solo al destinatario aprobado (contact.form_recipient_email).');
}
if (!/"ratelimits"/.test(wrangler)) errors.push('wrangler.jsonc: falta el binding de límite de frecuencia del formulario (ratelimits).');
if (/"(?:\w*(?:KEY|SECRET|TOKEN|PASSWORD)\w*)"\s*:\s*"/i.test(wrangler.replace(/"\$schema"[^\n]*/, ''))) errors.push('wrangler.jsonc: no declarar secretos en vars; se fijan como secretos del Worker.');
for (const file of [...listFiles('src/scripts'), ...listFiles('src/components'), ...listFiles('src/pages').filter(f => !f.endsWith('api/contacto.ts'))]) {
  if (/RESEND_API_KEY|api\.resend\.com|\bre_[A-Za-z0-9]{16,}/.test(readFileSync(file, 'utf8'))) errors.push(`${file}: el transporte y la clave de correo solo viven en código de servidor.`);
}
const m4Assets = JSON.parse(readFileSync('config/m4-assets.json', 'utf8')) as Record<string, string>;
const draft = JSON.parse(readFileSync('src/content/m4-draft.json', 'utf8'));
if (draft.status !== 'draft') errors.push('El copy M4 debe conservarse como borrador.');
const draftGate = readFileSync('src/lib/m4-draft.ts', 'utf8');
if (!draftGate.includes("APP_ENV !== 'local'")) errors.push('Falta el gate local del copy M4.');
for (const formPath of ['src/components/m4/Contacto.astro', 'src/components/m4/Home.astro', 'src/components/m4/ContactForm.astro']) {
  if (!existsSync(formPath)) continue;
  const formSource = readFileSync(formPath, 'utf8');
  if (/<form\b/i.test(formSource)) {
    const permittedDraftForm = formSource.includes('data-disabled-form') &&
      !/<form[^>]*(?:action|method)=/i.test(formSource) &&
      !/<button[^>]*type="submit"/i.test(formSource) && /<button[^>]*disabled/.test(formSource);
    const permittedMailForm = formPath.endsWith('/ContactForm.astro') && isConfiguredContactForm(formSource);
    if (!permittedDraftForm && !permittedMailForm) {
      errors.push(`${formPath}: debe conservar el envío deshabilitado, con data-disabled-form y sin submit activo.`);
    }
  }
}
const editorial = JSON.parse(readFileSync('config/m4-editorial.json', 'utf8'));
if (editorial.status !== 'draft' || editorial.approved.length !== 0 || editorial.publicationAuthorized !== false) {
  errors.push('Esta reproducción conserva TODO el copy M4 como borrador sin aprobar ni autorizar publicación.');
}
const m3Review = JSON.parse(readFileSync('src/content/m3-review.json', 'utf8'));
const m3Contract = JSON.parse(readFileSync('config/m3-reviewed-texts.json', 'utf8'));
if (m3Review.status !== 'local-review' || m3Contract.publicationAuthorized !== false) errors.push('M3 solo autoriza revisión local sin publicación.');
for (const [field, digest] of Object.entries(m3Contract.sha256)) {
  const [block, key] = field.split('.');
  const value = m3Review[block]?.[key];
  if (typeof value !== 'string' || createHash('sha256').update(value).digest('hex') !== digest) errors.push(`Texto M3 distinto del contrato revisado: ${field}.`);
}
const routesRequiringLocalGate = new Set([
  ...['inicio', 'quienes-somos', 'portfolio', 'comunicacion', 'produccion', 'contacto', 'blog'].map(page => `src/pages/interno/m3/${page}.astro`),
  'src/pages/index.astro',
  'src/pages/streaming.astro',
  'src/pages/comunicacion-marketing.astro',
]);
// D-36 autoriza estas dos entregas en local, no cualquier archivo con el mismo nombre.
const localImages: Record<string, string> = {
  ...(reviewEnv ? m4Assets : {}),
  '/assets/logo.jpg': '05a81cfb1c107d94c3e888888e49fcb65d27d4f13643c75b65680ebd161a38c7',
  '/assets/portada-facebook.jpg': '83f283cc053e555a5ac961a09c58a68f1c6fa589512f5b083b53a620cb90f794',
};
// Medios autorizados exclusivamente para revisión local de Inicio y Portfolio
const homeMediaReviewPath = 'config/home-media-review.json';
const homeMediaReview = existsSync(homeMediaReviewPath)
  ? JSON.parse(readFileSync(homeMediaReviewPath, 'utf8'))
  : null;
if (homeMediaReview && homeMediaReview.publicationAuthorized !== false) {
  errors.push('config/home-media-review.json: debe mantener publicationAuthorized en false.');
}

const AUTHORIZED_REVIEW_VIDEO_POSTERS: Record<string, string> = Object.fromEntries([
  ...(homeMediaReview?.hero?.src ? [homeMediaReview.hero] : []),
  ...(homeMediaReview?.inlineVideos ?? []),
  ...(homeMediaReview?.workVideos ?? []),
  ...(homeMediaReview?.clientsVideo ? [homeMediaReview.clientsVideo] : []),
  ...(homeMediaReview?.portfolioHero ? [homeMediaReview.portfolioHero] : []),
].map((media: { src: string; poster: string }) => [media.src, media.poster]));
// Versión vertical registrada de cada vídeo de Inicio (data-home-video-mobile-src): misma revisión local y hash.
const AUTHORIZED_REVIEW_MOBILE_SOURCES: Record<string, string> = Object.fromEntries(
  [homeMediaReview?.hero, homeMediaReview?.clientsVideo].filter((media): media is { src: string; mobileSrc: string } => Boolean(media?.mobileSrc)).map(media => [media.src, media.mobileSrc]));
const workVideoPosters = new Map<string, string>();
for (const media of homeMediaReview?.workVideos ?? []) {
  workVideoPosters.set(media.src, media.poster);
}
// Cinco muestras actuales o la selección de doce solicitada por el propietario.
// Cada vídeo sigue necesitando registro explícito, portada y hash local.
const portfolioProjectCount: number = m4PortfolioProjects.length;
let portfolioMediaIsAuthorized = [5, 12].includes(portfolioProjectCount) &&
  homeMediaReview?.workVideos?.length === portfolioProjectCount &&
  workVideoPosters.size === portfolioProjectCount;
const portfolioVideoSources = new Set<string>();
for (const project of m4PortfolioProjects) {
  if (portfolioVideoSources.has(project.videoSrc) ||
      workVideoPosters.get(project.videoSrc) !== project.poster ||
      !Object.hasOwn(localImages, project.videoSrc) ||
      !Object.hasOwn(localImages, project.poster)) {
    portfolioMediaIsAuthorized = false;
    break;
  }
  portfolioVideoSources.add(project.videoSrc);
}
const portfolioTextItems: string[] = [];
for (const project of m4PortfolioProjects) {
  portfolioTextItems.push(project.title, project.context, project.description);
}
if (![5, 12].includes(portfolioProjectCount) || portfolioTextItems.length !== portfolioProjectCount * 3) {
  errors.push('src/lib/m4-portfolio-projects.ts: se esperan las cinco muestras actuales o la selección de doce, cada una con título, contexto y descripción.');
}
for (const text of portfolioTextItems) {
  for (const error of contentErrors(text, [])) {
    errors.push(`src/lib/m4-portfolio-projects.ts: ${error}`);
  }
}

const PHOTO_COLLECTION: Record<string, string> = { 'src/components/m4/Home.astro': 'page_home', 'src/components/m4/ClientBand.astro': 'site_blocks', 'src/components/m4/Portfolio.astro': 'page_portfolio' };
const ALLOWED_VIDEO_COMPONENTS: Record<string, true> = {
  'src/components/m4/Home.astro': true,
  'src/components/m4/ClientBand.astro': true,
  'src/components/m4/Portfolio.astro': true,
};

const ALLOWED_FORM_PATHS: Record<string, true> = {
  'src/components/m4/Contacto.astro': true,
  'src/components/m4/Home.astro': true,
  'src/components/m4/ContactForm.astro': true,
};
for (const [url, digest] of Object.entries(localImages)) {
  const path = join('public', url.slice(1));
  if (!existsSync(path) || createHash('sha256').update(readFileSync(path)).digest('hex') !== digest) {
    errors.push(`${path}: archivo distinto de la entrega autorizada en D-36.`);
  }
}
function files(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}
for (const path of files('src')) {
  if (!path.endsWith('.astro')) continue;
  const source = readFileSync(path, 'utf8');
  const markup = source.replace(/^---[\s\S]*?---/, '').replace(/<style[\s\S]*?<\/style>/g, '');
  // Excepción estricta: SOLO índices UI estáticos decorativos 01..09 (o 01/..), sin omitir claims numéricos
  let sanitizedMarkup = markup
    .replace(/<(?:span|p)\b[^>]*\baria-hidden=["']true["'][^>]*>\s*\(?0[1-9]\)?(?:\s*\/)?\s*<\/(?:span|p)>/gi, '')
    .replace(/<span\b[^>]*class=["'][^"']*\b(?:home-gallery-index|home-service-number)\b[^"']*["'][^>]*>\s*\(?0[1-9]\)?\s*<\/span>/gi, '')
    .replace(/(<button\b[^>]*data-home-service\b[^>]*>\s*)<span>\s*\(?0[1-9]\)?\s*<\/span>/gi, '$1');

  // Contacto comercial directo: verificar que el address no contenga claims publicitarios y aislarlo
  const addressMatch = sanitizedMarkup.match(/<address\b[^>]*>([\s\S]*?)<\/address>/i);
  if (addressMatch) {
    const addressContent = addressMatch[1];
    if (forbiddenText.test(addressContent) || /bonding|starlink|congresos|\bIMAG\b|traducción/i.test(addressContent)) {
      errors.push(`${path}: claim no permitido en bloque de contacto.`);
    }
    sanitizedMarkup = sanitizedMarkup.replace(addressMatch[0], '');
  }

  const referencedFactIds = [
    ...source.matchAll(/['"]((?:service|social_proof|contact|entity|sla)\.[^'"]+)['"]/g),
    ...source.matchAll(/data-fact-id=['"]([^'"]+)['"]/g),
  ].map(match => match[1]);

  let literalText = [...sanitizedMarkup.matchAll(/>([^<>{]+)</g)].map(match => match[1]).join(' ');

  // Factores aprobados compuestos (p. ej. métricas separadas por punto y coma)
  for (const factId of referencedFactIds) {
    const fact = approvedFact?.(factId);
    if (!fact) continue;
    const clauses = fact.value.split(/\s*;\s*/).filter(Boolean);
    for (const clause of clauses) {
      literalText = literalText.replaceAll(clause, '');
    }
  }

  errors.push(...contentErrors(literalText, referencedFactIds).map(error => `${path}: ${error}`));
  // <source> solo como variante de una foto editable dentro de <picture> (srcset={photo.<ranura>.src}, sin src ni type de vídeo).
  const sourcelessMarkup = markup.replace(/<picture\b[^>]*>[\s\S]*?<\/picture>/gi, picture =>
    picture.replace(/<source\b(?![^>]*\s(?:src\s*=|type\s*=\s*['"]?video))[^>]*\ssrcset=\{photo\.\w+\.src\}[^>]*>/gi, ''));
  if (/<iframe\b|<source\b/i.test(sourcelessMarkup) || (/<form\b/i.test(markup) && !ALLOWED_FORM_PATHS[path])) {
    errors.push(`${path}: formulario o medio no autorizado en M2.`);
  }
  if (/<form\b/i.test(markup)) {
    const permittedDraftForm = markup.includes('data-disabled-form') &&
      !/<form[^>]*(?:action|method)=/i.test(markup) &&
      /<button[^>]*disabled/i.test(markup) && !/<button[^>]*type="submit"/i.test(markup);
    const permittedMailForm = path === 'src/components/m4/ContactForm.astro' && isConfiguredContactForm(source);
    if (!permittedDraftForm && !permittedMailForm) {
      errors.push(`${path}: formulario debe conservar el envío deshabilitado, sin action/method, con data-disabled-form y botón disabled sin type="submit".`);
    }
  }
  const videos = [...markup.matchAll(/<video\b[^>]*>/gi)];
  for (const [rawVideo] of videos) {
    // Imagen de espera editable: `poster={photo.<ranura>.src}` se valida con la foto por defecto de la ranura (manifiesto y revisión local).
    const video = rawVideo.replace(/\b(poster|data-portfolio-mobile-poster)=\{photo\.(\w+)\.src\}/g, (whole, attr: string, slotName: string) => {
      const slot = contractCollections.find(c => c.slug === PHOTO_COLLECTION[path])?.images?.find(item => item.slug === slotName);
      return slot && Object.hasOwn(mediaRegistry, slot.ref) ? `${attr}="${mediaRegistry[slot.ref].src}"` : whole;
    });
    const attribute = (name: string) => video.match(new RegExp(`\\s${name}\\s*=\\s*(['"])(.*?)\\1`, 'i'))?.[2];
    // Presencia del atributo con cualquier valor (también {expresión}); \s delante excluye data-poster al buscar poster.
    const hasAttribute = (name: string) => new RegExp(`\\s${name}\\s*=`, 'i').test(video);
    const videoSrc = attribute('data-home-video-src');
    const mobileVideoSrc = attribute('data-home-video-mobile-src');
    const poster = attribute('poster');
    const preload = attribute('preload');
    const usesAuthorizedVideoSrc = videoSrc && AUTHORIZED_REVIEW_VIDEO_POSTERS[videoSrc];
    const usesAuthorizedPoster = poster &&
      poster === AUTHORIZED_REVIEW_VIDEO_POSTERS[videoSrc ?? ''];
    const usesSharedProjectData =
      /import \{[^}]*\bgetProjects\b[^}]*\} from "\.\.\/\.\.\/lib\/site-content"/.test(source) &&
      source.includes('m4PortfolioProjects.map(');
    const isSharedHomeVideo = path === 'src/components/m4/Home.astro' &&
      usesSharedProjectData &&
      /data-home-video-src=\{project\.videoSrc\}/i.test(video) &&
      /\sdata-poster=\{project\.poster\}/i.test(video);
    const isPortfolioPlayer = path === 'src/components/m4/Portfolio.astro' &&
      usesSharedProjectData &&
      /\ssrc=\{project\.videoSrc\}/i.test(video) &&
      /\sdata-poster=\{project\.poster\}/i.test(video) &&
      /\scontrols(?:\s|>|=)/i.test(video);
    // Vídeo de una ranura editable (portada de Inicio, fondo de la banda de clientes): el origen es el MP4 subido o el vídeo del sitio
    // resuelto por pageVideo(); el vídeo por defecto de cada ranura se valida abajo contra el manifiesto. Aquí solo se exige el montaje.
    const slotVar = path === 'src/components/m4/Home.astro' ? 'hero' : path === 'src/components/m4/ClientBand.astro' ? 'band' : '';
    const isSlotVideo = Boolean(slotVar) && new RegExp(`\\sdata-home-video-src=\\{${slotVar}\\.src\\}`).test(video);
    // Versión vertical dinámica: de la ranura (`<var>.mobileSrc`) o del proyecto subido (`project.mobileVideoSrc`).
    const dynamicMobile = new RegExp(`\\sdata-home-video-mobile-src=\\{(?:${slotVar || 'hero'}\\.mobileSrc|project\\.mobileVideoSrc)\\}`).test(video);
    if (isSlotVideo) {
      const slotPoster = attribute('poster');
      if (!ALLOWED_VIDEO_COMPONENTS[path] || preload !== 'none' || !slotPoster || !Object.hasOwn(m4Assets, slotPoster) ||
          (hasAttribute('data-home-video-mobile-src') && !dynamicMobile) ||
          !/\smuted(?:\s|>)/i.test(video) || !/\splaysinline(?:\s|>)/i.test(video) || /\s(?:src|autoplay)\b/i.test(video)) {
        errors.push(`${path}: vídeo de ranura editable fuera del montaje autorizado.`);
      }
      continue;
    }
    // Versión vertical: solo literal, la registrada para el mismo vídeo de Inicio y en el manifiesto (galería y Portfolio no la llevan).
    if (hasAttribute('data-home-video-mobile-src') && !dynamicMobile &&
        (!mobileVideoSrc || mobileVideoSrc !== AUTHORIZED_REVIEW_MOBILE_SOURCES[videoSrc ?? ''] || !Object.hasOwn(localImages, mobileVideoSrc))) {
      errors.push(`${path}: data-home-video-mobile-src fuera de la versión vertical registrada.`);
    }

    if (/\sdata-portfolio-hero-video(?:\s|>)/i.test(video)) {
      const mobileSrc = attribute('data-portfolio-mobile-src');
      // Sin póster en el vídeo: la imagen de espera es el <picture> de las ranuras editables hero_poster y hero_poster_movil.
      if (path !== 'src/components/m4/Portfolio.astro' || !reviewEnv ||
          videoSrc !== homeMediaReview?.portfolioHero?.src ||
          mobileSrc !== homeMediaReview?.portfolioHero?.mobileSrc ||
          !videoSrc || !mobileSrc || hasAttribute('poster') || preload !== 'none' ||
          !/\smuted(?:\s|>)/i.test(video) || !/\splaysinline(?:\s|>)/i.test(video) || /\s(?:src|autoplay)\b/i.test(video) ||
          !Object.hasOwn(localImages, videoSrc) || !Object.hasOwn(localImages, mobileSrc)) {
        errors.push(`${path}: montaje del hero de Portfolio fuera de la revisión local registrada.`);
      }
      continue;
    }

    if (isSharedHomeVideo) {
      if (!reviewEnv || !ALLOWED_VIDEO_COMPONENTS[path] ||
          !portfolioMediaIsAuthorized || preload !== 'none' || hasAttribute('poster') ||
          !/\smuted(?:\s|>)/i.test(video) || !/\splaysinline(?:\s|>)/i.test(video) ||
          /\s(?:src|autoplay)\b/i.test(video)) {
        errors.push(`${path}: vídeo fuera del montaje autorizado para revisión local.`);
      }
      continue;
    }
    if (isPortfolioPlayer) {
      if (!reviewEnv || !ALLOWED_VIDEO_COMPONENTS[path] ||
          !portfolioMediaIsAuthorized || preload !== 'none' || hasAttribute('poster') ||
          !/\splaysinline(?:\s|>)/i.test(video) || /\sautoplay\b/i.test(video)) {
        errors.push(`${path}: vídeo fuera del montaje autorizado para revisión local.`);
      }
      continue;
    }

    if (!reviewEnv || !ALLOWED_VIDEO_COMPONENTS[path] ||
        !usesAuthorizedVideoSrc || !usesAuthorizedPoster || preload !== 'none' ||
        !/\smuted(?:\s|>)/i.test(video) || !/\splaysinline(?:\s|>)/i.test(video) ||
        /\s(?:src|autoplay)\b/i.test(video) ||
        (videoSrc && !Object.hasOwn(localImages, videoSrc)) ||
        (poster && !Object.hasOwn(localImages, poster))) {
      errors.push(`${path}: vídeo fuera del montaje autorizado para revisión local.`);
    }
  }
  const clientBandLogos = path === 'src/components/m4/ClientBand.astro'
    ? [...source.matchAll(/\bsrc:\s*(['"])(.*?)\1/g)].map(m => m[2])
    : [];
  if (path === 'src/components/m4/ClientBand.astro') {
    for (const logoUrl of clientBandLogos) {
      if (!Object.hasOwn(localImages, logoUrl)) {
        errors.push(`${path}: logo ${logoUrl} fuera de las entregas locales autorizadas.`);
      }
    }
  }
  for (const image of markup.matchAll(/<img\b[^>]*>/gi)) {
    const literalSrc = image[0].match(/\bsrc\s*=\s*(['"])(.*?)\1/i)?.[2];
    const dynamicSrc = image[0].match(/\bsrc\s*=\s*\{([^}]+)\}/i)?.[1];
    // Responsive derivatives must stay literal, registered and hash-checked above.
    const hasSrcset = /\bsrcset\s*=/i.test(image[0]);
    const literalSrcset = image[0].match(/\bsrcset\s*=\s*(['"])(.*?)\1/i)?.[2];
    const authorizedSrcset = !hasSrcset || Boolean(literalSrcset && literalSrcset.split(',').every(candidate => {
      const parts = candidate.trim().match(/^(\S+)\s+([1-9]\d*)w$/);
      return parts && Object.hasOwn(localImages, parts[1]);
    }));
    // Foto editable: el resolver (src/lib/media.ts) solo emite la biblioteca autorizada o la biblioteca de medios propia.
    const resolved = /^<img\b[^>]*\{\.\.\.imgAttrs\((?:photo\.\w+|client\.logo|person\.photo)\b/.test(image[0]) && /import \{[^}]*\bimgAttrs\b[^}]*\} from "\.\.\/\.\.\/lib\/media"/.test(source);
    if (resolved) continue;
    if (!reviewEnv || /\.mp4$/i.test(image[0]) || !authorizedSrcset) {
      errors.push(`${path}: imagen fuera de las entregas locales autorizadas en D-36.`);
      continue;
    }
    if (literalSrc) {
      if (!Object.hasOwn(localImages, literalSrc)) {
        errors.push(`${path}: imagen ${literalSrc} fuera de las entregas locales autorizadas en D-36.`);
      }
    } else if (dynamicSrc && path === 'src/components/m4/Home.astro' &&
        dynamicSrc.trim() === 'project.poster' &&
        /import \{[^}]*\bgetProjects\b[^}]*\} from "\.\.\/\.\.\/lib\/site-content"/.test(source) &&
        source.includes('m4PortfolioProjects.map(')) {
      if (!portfolioMediaIsAuthorized) {
        errors.push(`${path}: imagen sin src autorizado en D-36.`);
      }
    } else if (dynamicSrc && path === 'src/components/m4/Clientes.astro' && dynamicSrc.trim() === 'client.logo' &&
        source.includes('getClients') && source.includes('clients.map(')) {
      // El logotipo sale de la colección «clients»; su ruta se valida contra el manifiesto más abajo.
    } else if (dynamicSrc && path === 'src/components/blog/BlogVisual.astro' &&
        dynamicSrc.trim() === 'src' && source.includes('/_emdash/api/media/file/')) {
      // Blog media comes from the editorial CMS, whose publish gate already requires alt text.
      // The optimizer route (/_image) stays blocked by local-gate, so this is the only served path.
    } else if (dynamicSrc && path === 'src/components/m4/ClientBand.astro' &&
        dynamicSrc.trim() === 'client.src') {
      if (clientBandLogos.length === 0) {
        errors.push(`${path}: lista de clientes vacía o no reconocida.`);
      }
    } else {
      errors.push(`${path}: imagen sin src autorizado en D-36.`);
    }
  }
  let hasAllowedPortfolioVideoKeyScript = false;
  if (path === 'src/components/m4/Portfolio.astro') {
    const scriptBlocks = [...markup.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi)];
    const scriptSource = scriptBlocks[0]?.[0] ?? '';
    hasAllowedPortfolioVideoKeyScript = scriptBlocks.length === 1 &&
      /^<script>\s*const MEDIA_KEYS = new Set\(\[' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'\]\);\s*for \(const video of document\.querySelectorAll<HTMLVideoElement>\('\.portfolio-project-video'\)\) \{\s*video\.addEventListener\('keydown', \(event\) => \{\s*if \(MEDIA_KEYS\.has\(event\.key\)\) event\.stopPropagation\(\);\s*\}\);\s*\}\s*<\/script>$/.test(scriptSource);
  }
  if (/<script\b/i.test(markup) && path !== 'src/layouts/Base.astro' &&
      !hasAllowedPortfolioVideoKeyScript) {
    errors.push(`${path}: script fuera del generador JSON-LD.`);
  }
  if (/application\/ld\+json/.test(source) && path !== 'src/layouts/Base.astro') errors.push(`${path}: JSON-LD fuera del generador autorizado.`);
  if (routesRequiringLocalGate.has(path) && /export\s+const\s+prerender\s*=\s*true\b/.test(source)) {
    errors.push(`${path}: una ruta prerenderizada puede omitir local-gate y exponer la preview fuera de loopback.`);
  }
  if (/(?:https?:)?\/\/(?!(?:directoproducciones\.com|wa\.me)(?:[/'"]|$))/.test(markup)) {
    errors.push(`${path}: recurso externo no autorizado.`);
  }
  if (/FAQPage|priceRange|openingHoursSpecification/.test(source)) errors.push(`${path}: marcado fuera del alcance aprobado.`);
  for (const match of source.matchAll(/['"]((?:service|social_proof|contact|entity|sla)\.[^'"]+)['"]/g)) {
    if (!facts.some(fact => fact.id === match[1])) errors.push(`${path}: referencia a fact inexistente: ${match[1]}`);
  }
  if (!path.includes('/blog/') && /(?:getEmDash|emdash\/runtime|Astro\.locals\.emdash)/.test(source)) errors.push(`${path}: página corporativa dependiente del CMS.`);
}
for (const path of files('public/assets')) {
  if (!Object.hasOwn(localImages, '/' + path.slice('public/'.length))) {
    errors.push(`${path}: asset público no autorizado en M2.`);
  }
}
for (const fact of facts.filter(isApproved)) {
  errors.push(...contentErrors(fact.value, [fact.id]).map(error => `content/facts.yaml (${fact.id}): ${error}`));
}
const schema = readFileSync('src/lib/schema.ts', 'utf8');
if (!schema.includes(CANONICAL_ORIGIN) && !schema.includes('CANONICAL_ORIGIN')) errors.push('JSON-LD sin dominio canónico autorizado.');
if (/FAQPage|priceRange|openingHoursSpecification|areaServed|geo|sameAs|logo/.test(schema)) errors.push('Propiedad JSON-LD fuera de la lista autorizada M2.');
// Fase 03: contrato CMS. Una sola fuente por campo, seed generado sin deriva, nada de borrador directo en producción.
const { contractErrors } = await import('../src/cms/contract-check');
const { buildSeed } = await import('./cms-seed');
errors.push(...contractErrors(draft.blocks));
const seed = JSON.parse(readFileSync('seed/seed.json', 'utf8'));
const contractSlugs = new Set(['posts', ...contractCollections.map(c => c.slug), ...contractLists.map(l => l.slug)]);
for (const collection of seed.collections as { slug: string; commentsEnabled?: boolean }[]) {
  if (!contractSlugs.has(collection.slug) || collection.commentsEnabled !== false) errors.push(`Modelo CMS fuera del contrato o comentarios activos: ${collection.slug}`);
}
if (Object.keys(seed.content ?? {}).length) errors.push('seed/seed.json no puede llevar contenido; los borradores van en seed/content-drafts.json.');
const generated = buildSeed();
for (const [file, value] of [['seed/seed.json', generated.seed], ['seed/content-drafts.json', generated.drafts], ['src/content/microcopy.json', generated.microcopy]] as const) {
  const expected = file.endsWith('microcopy.json') ? JSON.stringify(value, null, 1) + '\n' : JSON.stringify(value, null, 2) + '\n';
  if (!existsSync(file) || readFileSync(file, 'utf8') !== expected) errors.push(`${file}: deriva respecto al contrato; ejecuta npx tsx scripts/cms-seed.ts`);
}
for (const entries of Object.values(generated.drafts.content) as { status?: string; data: Record<string, unknown> }[][]) {
  for (const entry of entries) {
    if (entry.status !== 'draft') errors.push('Los borradores iniciales deben estar en estado draft.');
    for (const [name, value] of Object.entries(entry.data)) {
      if (name.endsWith('_ref') && typeof value === 'string' && value && !Object.hasOwn(mediaRegistry, value) && !Object.hasOwn(videoRegistry, value)) errors.push(`Foto o vídeo del sitio fuera de la biblioteca autorizada: ${name}=${value}`);
    }
  }
}
// Campos editables que ningún componente imprime serían una promesa falsa al editor.
const componentSources = files('src/components').filter(path => path.endsWith('.astro')).map(path => [path, readFileSync(path, 'utf8')] as const);
for (const col of contractCollections) {
  for (const f of col.fields) {
    const block = f.block ?? col.block;
    if (f.media) continue; // fotos: se comprueban abajo contra el uso real de cada ranura
    if (block === 'Nav') continue; // las etiquetas del menú las imprime getNavigation(); se verifica abajo
    const users = componentSources.filter(([, text]) => new RegExp(`pageCopy\\([^)]*["'\\\`]${block}["']`).test(text) || (block.endsWith('CTA') && text.includes(block)) || (block === 'Header+Footer'));
    const reads = f.default ? `\\b${f.slug}\\b` : `\\b${f.key}\\b`;
    if (!users.some(([, text]) => new RegExp(reads).test(text))) errors.push(`${col.slug}.${f.slug}: ningún componente de ${block} imprime este campo.`);
  }
}
// Fotos (alcance «texto + fotos + equipo»): cada ranura y cada campo de imagen de lista deben estar en uso real;
// la biblioteca autorizada solo contiene ficheros del manifiesto; ningún bitmap queda escrito en el código sin clasificar.
for (const [key, entry] of Object.entries(mediaRegistry) as [string, { src: string; srcset?: string }][]) {
  for (const path of [entry.src, ...(entry.srcset ?? '').split(',').map(part => part.trim().split(/\s+/)[0]).filter(Boolean)]) {
    if (!Object.hasOwn(localImages, path)) errors.push(`media-registry ${key}: ${path} no está en el manifiesto autorizado.`);
    if (!existsSync(`public${path}`)) errors.push(`media-registry ${key}: falta public${path}.`);
  }
}
for (const col of contractCollections) for (const slot of col.images ?? []) {
  if (!Object.hasOwn(mediaRegistry, slot.ref)) errors.push(`${col.slug}.${slot.slug}: la foto por defecto «${slot.ref}» no está en la biblioteca autorizada.`);
  const users = componentSources.filter(([, text]) => new RegExp(`pageImages\\(["'](?:${col.slug})["']\\)`).test(text) && new RegExp(`\\.${slot.slug}\\b`).test(text));
  const layout = readFileSync('src/layouts/Base.astro', 'utf8');
  if (!users.length && !(new RegExp(`pageImages\\(['"]${col.slug}['"]\\)`).test(layout) && layout.includes(slot.slug))) errors.push(`${col.slug}.${slot.slug}: ningún componente muestra esta foto.`);
}
// Vídeos: la biblioteca de vídeos solo contiene ficheros del manifiesto y cada ranura de vídeo editable tiene un vídeo por defecto autorizado y un lector.
for (const [key, entry] of Object.entries(videoRegistry)) {
  if (!Object.hasOwn(m4Assets, entry.src)) errors.push(`videoRegistry ${key}: ${entry.src} no está en el manifiesto autorizado.`);
  if (!existsSync(`public${entry.src}`)) errors.push(`videoRegistry ${key}: falta public${entry.src}.`);
}
for (const col of contractCollections) for (const slot of col.videos ?? []) {
  if (!Object.hasOwn(videoRegistry, slot.ref)) errors.push(`${col.slug}.${slot.slug}: el vídeo por defecto «${slot.ref}» no está en la biblioteca de vídeos.`);
  const users = componentSources.filter(([, text]) => new RegExp(`pageVideo\\(["']${col.slug}["'][^)]*["']${slot.slug}["']`).test(text));
  if (!users.length) errors.push(`${col.slug}.${slot.slug}: ningún componente muestra este vídeo.`);
}
const siteSource = readFileSync('src/lib/site-content.ts', 'utf8');
for (const [list, readers] of Object.entries({ clients: ['getClients'], band_logos: ['getBandLogos'], projects: ['getProjects'], team: ['getTeam'] })) {
  if (!contractLists.some(l => l.slug === list)) errors.push(`Lista de fotos ausente del contrato: ${list}`);
  for (const reader of readers) if (!componentSources.some(([, text]) => text.includes(`${reader}(`))) errors.push(`${list}: ningún componente llama a ${reader}().`);
  if (!siteSource.includes(`published('${list}'`)) errors.push(`${list}: site-content no lee la lista.`);
}
const technical = JSON.parse(readFileSync('config/media-technical.json', 'utf8')) as { paths: string[]; where: string[]; reason: string }[];
const classified = new Set(technical.flatMap(item => item.paths));
for (const item of technical) if (!item.reason || item.reason.length < 20 || !item.where.length) errors.push(`config/media-technical.json: clasificación sin motivo o sin lugar: ${item.paths.join(', ')}`);
for (const path of [...files('src'), 'astro.config.mjs'].filter(path => /\.(astro|ts|css|mjs)$/.test(path))) {
  if (/src\/(lib\/media-registry|cms\/list-seeds)\.ts$/.test(path)) continue;
  for (const match of readFileSync(path, 'utf8').matchAll(/\/assets\/[A-Za-z0-9_./-]+\.(?:webp|jpe?g|png|avif|svg|mp4|woff2)/g)) {
    if (!classified.has(match[0])) errors.push(`${path}: ${match[0]} escrito en el código sin clasificar (editable en el CMS o motivo técnico en config/media-technical.json).`);
  }
}
for (const need of ['Header', 'Menu', 'Footer']) {
  if (!/getNavigation\(\)/.test(readFileSync(`src/components/m4/${need}.astro`, 'utf8'))) errors.push(`${need}.astro debe leer las etiquetas con getNavigation().`);
}
for (const [path, text] of componentSources) {
  if (/m4-draft/.test(text) && !path.endsWith('Guia.astro')) errors.push(`${path}: lee el borrador directamente; usa src/lib/site-content.`);
}
if (/draftCopy|m4-draft/.test(readFileSync('src/lib/site-content.ts', 'utf8'))) errors.push('site-content.ts no puede leer m4-draft: sin fallback silencioso al borrador.');
// Cambiar el valor de un fact aprobado exige primero retirar su aprobación.
// GUARD_BASE_FACTS permite verificar transiciones con fixtures locales; CI usa GUARD_BASE_REF.
const base = process.env.GUARD_BASE_REF;
const localBaseFactsPath = process.env.GUARD_BASE_FACTS;
if (localBaseFactsPath && APP_ENV !== 'local') errors.push('GUARD_BASE_FACTS solo está permitido para fixtures locales.');
const baseFactsPath = base ? undefined : APP_ENV === 'local' ? localBaseFactsPath : undefined;
let previous: typeof facts | undefined;
if (baseFactsPath) {
  if (!existsSync(baseFactsPath)) errors.push(`Archivo base de facts inexistente: ${baseFactsPath}`);
  else previous = parse(readFileSync(baseFactsPath, 'utf8')) as typeof facts;
} else if (base) {
  execFileSync('git', ['rev-parse', '--verify', `${base}^{commit}`], { stdio: 'ignore' });
  try {
    execFileSync('git', ['cat-file', '-e', `${base}:content/facts.yaml`], { stdio: 'ignore' });
    previous = parse(execFileSync('git', ['show', `${base}:content/facts.yaml`], { encoding: 'utf8' })) as typeof facts;
  } catch {
    previous = [];
  }
} else if (APP_ENV === 'production') errors.push('Producción exige GUARD_BASE_REF para validar cambios de aprobación.');
if (previous) {
  for (const old of previous.filter(fact => fact.status === 'approved')) {
    const current = facts.find(fact => fact.id === old.id);
    if (current && current.value !== old.value &&
        (current.status !== 'pending' || current.approved_by !== null || current.approved_at !== null || current.evidence !== null)) {
      errors.push(`Cambiar el valor aprobado invalida su aprobación: ${old.id}. Primero pásalo a pending y limpia evidence/approved_by/approved_at; la aprobación posterior debe revisarse en un cambio separado.`);
    }
  }
}
// Producción: ningún aviso de revisión o maqueta («Revisión local», «provisional», «maqueta», «se simula»…) en el texto fijo
// (microcopy) ni en el marcado de los .astro fuera de <ReviewNote>, que solo pinta en local y preview. Local y preview no cambian.
if (APP_ENV === 'production') {
  for (const [block, values] of Object.entries(generated.microcopy as Record<string, Record<string, string>>)) {
    if (block === 'Articulo') continue; // plantilla de /interno/articulo/, que fuera de local responde 404
    for (const [key, value] of Object.entries(values)) if (reviewMarkerText.test(value)) errors.push(`src/content/microcopy.json ${block}.${key}: aviso de revisión o maqueta en producción.`);
  }
  for (const path of files('src').filter(path => path.endsWith('.astro') && !path.startsWith(join('src', 'pages', 'interno')))) {
    const marker = unguardedReviewMarker(readFileSync(path, 'utf8'));
    if (marker) errors.push(`${path}: «${marker}» fuera de <ReviewNote>: aviso de revisión o maqueta en producción.`);
  }
}
// Inspección de HTML existente para integración, sin generar un build.
const htmlRoot = process.env.GUARD_HTML_DIR;
if (htmlRoot) {
  if (!existsSync(htmlRoot)) errors.push(`Directorio HTML inexistente: ${htmlRoot}`);
  for (const path of files(resolve(htmlRoot)).filter(path => path.endsWith('.html'))) {
    const html = readFileSync(path, 'utf8');
    if (forbiddenText.test(html)) errors.push(`${path}: marcador o frase prohibida.`);
    if (/<iframe\b|<script[^>]+src\s*=/i.test(html)) errors.push(`${path}: iframe o script no autorizado.`);
    if (/<form\b/i.test(html)) {
      const permittedDraftForm = html.includes('data-disabled-form') &&
        !/<form[^>]*(?:action|method)=/i.test(html) &&
        /<button[^>]*disabled/i.test(html) && !/<button[^>]*type="submit"/i.test(html);
      if (!permittedDraftForm && !isConfiguredContactForm(html, true)) {
        errors.push(`${path}: formulario no autorizado o con envío activo.`);
      }
    }
    for (const match of html.matchAll(/data-fact-id="([^"]+)"/g)) {
      if (!facts.some(fact => fact.id === match[1] && isApproved(fact))) errors.push(`${path}: fact no aprobado: ${match[1]}`);
    }
    const canonical = html.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/);
    if (!canonical || new URL(canonical[1]).origin !== CANONICAL_ORIGIN) errors.push(`${path}: canonical inválido.`);
    const visibleText = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]*>/g, ' ');
    if (APP_ENV === 'production' && reviewMarkerText.test(visibleText)) errors.push(`${path}: aviso de revisión o maqueta en producción («${visibleText.match(reviewMarkerText)?.[0]}»).`);
    const references = [...html.matchAll(/data-fact-id="([^"]+)"/g)].map(match => match[1]);
    errors.push(...contentErrors(visibleText, references).map(error => `${path}: ${error}`));
  }
}
if (errors.length) {
  process.stderr.write(errors.join('\n') + '\n');
  process.exitCode = 1;
} else process.stdout.write('Facts y política editorial conservados; reproducción local, con formulario de contacto limitado a un POST propio hacia el destinatario aprobado.\n');
