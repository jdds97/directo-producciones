export {};
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const isCms = location.pathname.startsWith('/_emdash');
const homeRoot = document.querySelector<HTMLElement>('[data-home-experience]');
const aboutRoot = document.querySelector<HTMLElement>('[data-about-experience]');
const portfolioRoot = document.querySelector<HTMLElement>('[data-portfolio-experience]');
// El revelado de ida y vuelta de las líneas de servicio también anima en Inicio Qué hacemos, el equipo y los clientes.
const servicesRoot = document.querySelector<HTMLElement>('[data-services-experience]') ?? homeRoot;
if (servicesRoot && !isCms) {
  void import('./services-experience').then(({ initServicesExperience }) => {
    if (servicesRoot.isConnected) initServicesExperience(servicesRoot);
  }).catch(error => console.error('No se pudo inicializar la página de servicios.', error));
}
if (!isCms) {
  void import('./section-motion').then(({ initSectionMotion }) => initSectionMotion(reduced))
    .catch(error => console.error('No se pudo inicializar el movimiento entre secciones.', error));
}

// Header scroll state is synchronized with the active scroll engine below.
const header = document.querySelector<HTMLElement>('.header');


document.querySelectorAll<HTMLButtonElement>('[data-client-toggle]').forEach(control => {
  const viewport = control.closest('.trust')!.querySelector<HTMLElement>('.logo-marquee-viewport')!;
  control.hidden = reduced.matches;
  control.addEventListener('click', () => {
    const paused = viewport.toggleAttribute('data-client-paused');
    control.setAttribute('aria-pressed', String(paused));
    control.textContent = paused ? 'Reanudar carrusel' : 'Detener carrusel';
  });
  reduced.addEventListener('change', () => { control.hidden = reduced.matches; });
});
const toggle = document.querySelector<HTMLButtonElement>('.menu-toggle')!;
const menu = document.querySelector<HTMLElement>('#mobile-menu')!;
const closeButton = document.querySelector<HTMLButtonElement>('.menu-close')!;
const backdrop = document.querySelector<HTMLElement>('.menu-backdrop')!;
const board = document.querySelector<HTMLElement>('.artboard')!;
let previousFocus: HTMLElement | null = null;
let menuAnimation: Animation | undefined;
let closeVersion = 0;
async function closeMenu(restoreFocus = true) {
  if (menu.hidden) return;
  const version = ++closeVersion;
  menuAnimation?.cancel();
  if (!reduced.matches) {
    menuAnimation = menu.animate([{opacity: 1, transform: 'translateX(0)'}, {opacity: 0, transform: 'translateX(8px)'}], {duration: 180, easing: 'cubic-bezier(.4,0,1,1)'});
    try { await menuAnimation.finished; } catch { /* Preference changes/cancellation complete closure immediately. */ }
  }
  if (version !== closeVersion) return;
  menu.hidden = true;
  backdrop.hidden = true;
  toggle.setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
  board.inert = false;
  if (restoreFocus) previousFocus?.focus();
}
toggle.addEventListener('click', () => {
  closeVersion++;
  previousFocus = document.activeElement as HTMLElement;
  menuAnimation?.cancel();
  menu.hidden = false;
  backdrop.hidden = false;
  toggle.setAttribute('aria-expanded', 'true');
  document.body.style.overflow = 'hidden';
  board.inert = true;
  if (!reduced.matches) menuAnimation = menu.animate([{opacity: 0, transform: 'translateX(8px)'}, {opacity: 1, transform: 'translateX(0)'}], {duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)'});
  closeButton.focus();
});
closeButton.addEventListener('click', () => { void closeMenu(); });
backdrop.addEventListener('click', () => { void closeMenu(); });
menu.addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); void closeMenu(); }
  if (event.key === 'Tab') {
    const items = [...menu.querySelectorAll<HTMLElement>('a,button')];
    const first = items[0], last = items.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last.focus();}
    if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first.focus();}
  }
});
reduced.addEventListener('change', () => { if (reduced.matches) menuAnimation?.cancel(); });
// Resize while open must release inert and scroll when desktop navigation appears.
matchMedia('(min-width: 1280px)').addEventListener('change', event => { if (event.matches) void closeMenu(); });
const themeToggle = document.querySelector<HTMLButtonElement>('.theme-toggle');
let dark = document.body.classList.contains('theme-dark');
function applyTheme() {
  document.body.classList.toggle('theme-dark', dark);
  board.classList.toggle('theme-dark', dark);
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', dark ? 'dark' : 'light');
  if (themeToggle) {
    themeToggle.setAttribute('aria-pressed', String(dark));
    themeToggle.setAttribute('aria-label', dark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro');
  }
  document.querySelectorAll<HTMLElement>('[data-guide-color]').forEach(swatch => {
    const value = (dark ? swatch.dataset.dark : swatch.dataset.light)!;
    swatch.querySelector<HTMLElement>('.swatch-color')!.style.background = value;
    swatch.querySelector<HTMLElement>('.swatch-value')!.textContent = value;
  });
  document.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(anchor => {
    const url = new URL(anchor.href);
    if (url.origin !== location.origin || url.pathname.startsWith('/_emdash/')) return;
    if (dark) url.searchParams.set('theme', 'dark'); else url.searchParams.delete('theme');
    anchor.href = url.pathname + url.search + url.hash;
  });
}
applyTheme();
if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    dark = !dark;
    const url = new URL(location.href);
    if (dark) url.searchParams.set('theme', 'dark'); else url.searchParams.delete('theme');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
    applyTheme();
  });
}
// No submit, serialization, persistence, success simulation or provider requests.
document.querySelectorAll('form[data-disabled-form]').forEach(form => form.addEventListener('submit', event => event.preventDefault()));

// =======================================================================================
// Smooth Scrollbar inercial idéntico a Videology (damping: 0.05)
// Excluido en móviles/táctiles y con prefers-reduced-motion
// =======================================================================================
interface SmoothScrollbarInstance {
  offset: { x: number; y: number };
  scrollIntoView(target: Element, options?: { offsetTop?: number; onlyScrollIfNeeded?: boolean }): void;
  scrollTo(x: number, y: number, duration?: number): void;
  setPosition(x: number, y: number, options?: { withoutCallbacks?: boolean }): void;
  addListener(listener: (status: { offset: { x: number; y: number } }) => void): void;
  destroy(): void;
}

interface SmoothScrollbarLibrary {
  init(element: HTMLElement, options?: Record<string, unknown>): SmoothScrollbarInstance;
}

interface HomeExperienceController {
  updateScroll(offsetY: number, virtual: boolean): void;
  setMode(virtual: boolean): void;
}

declare global {
  interface Window {
    Scrollbar?: SmoothScrollbarLibrary;
    bodyScrollBar?: SmoothScrollbarInstance;
  }
}

const scrollContainer = document.getElementById('scroll-container');
let scrollbarInstance: SmoothScrollbarInstance | null = null;
let virtualMode = false;
let scrollOffsetY = window.scrollY;
let modeRequest = 0;
let scrollbarImportPending = false;
let homeExperience: HomeExperienceController | null = null;
let updateAboutScroll: ((offsetY: number) => void) | null = null;

// En Inicio la portada oculta la cabecera solo a la vista (opacidad y puntero en home-experience.css), nunca con inert
// ni aria-hidden: VoiceOver/TalkBack y el teclado encuentran la navegación desde la carga.
function syncHeaderHeroVisibility() {
  if (!header) return;
  const visible = !homeRoot || reduced.matches || homeRoot.dataset.homeHeaderVisible === 'true';
  header.classList.toggle('header--hero-hidden', !visible);
}

function syncScrollState(offsetY: number, isVirtual: boolean) {
  scrollOffsetY = offsetY;
  if (homeRoot) header?.classList.remove('is-scrolled');
  else header?.classList.toggle('is-scrolled', offsetY > 20);
  homeExperience?.updateScroll(offsetY, isVirtual);
  updateAboutScroll?.(offsetY);
  syncHeaderHeroVisibility();
}
reduced.addEventListener('change', () => {
  homeExperience?.updateScroll(scrollOffsetY, virtualMode);
  syncHeaderHeroVisibility();
});
syncHeaderHeroVisibility();
window.addEventListener('scroll', () => {
  if (!virtualMode) syncScrollState(window.scrollY, false);
}, { passive: true });
syncScrollState(scrollOffsetY, false);

if (homeRoot && !isCms) {
  void import('./home-experience').then(({ initHomeExperience }) => {
    if (!homeRoot.isConnected) return;
    homeExperience = initHomeExperience(homeRoot);
    homeExperience.setMode(virtualMode);
    homeExperience.updateScroll(scrollOffsetY, virtualMode);
    syncHeaderHeroVisibility();
  }).catch((error: unknown) => {
    console.error('No se pudo inicializar la experiencia de Inicio.', error);
  });
}

if (aboutRoot && !isCms) {
  void import('./about-experience').then(({ initAboutExperience }) => {
    if (!aboutRoot.isConnected) return;
    updateAboutScroll = initAboutExperience(aboutRoot, reduced);
    updateAboutScroll?.(scrollOffsetY);
  }).catch((error: unknown) => {
    console.error('No se pudo inicializar la experiencia de Quiénes somos.', error);
  });
}

if (portfolioRoot && !isCms) {
  void import('./portfolio-experience').then(({ initPortfolioExperience }) => {
    if (!portfolioRoot.isConnected) return;
    initPortfolioExperience(portfolioRoot, reduced);
  }).catch((error: unknown) => {
    console.error('No se pudo inicializar la experiencia de Portfolio.', error);
  });
}

function shouldUseVirtualScroll() {
  return Boolean(
    scrollContainer &&
    !isCms &&
    !reduced.matches &&
    !matchMedia('(max-width: 1024px)').matches &&
    !('ontouchstart' in window)
  );
}

// Montar o desmontar el scroll virtual mueve el contenido de nodo y el navegador retira el foco:
// se devuelve al mismo elemento sin desplazar (p. ej. al cambiar reduced-motion en vivo).
function keepFocus<T>(move: () => T): T {
  const focused = document.activeElement;
  const result = move();
  if (focused instanceof HTMLElement && focused !== document.body && focused.isConnected && document.activeElement !== focused) {
    focused.focus({ preventScroll: true });
  }
  return result;
}

function disableVirtualScroll() {
  const instance = scrollbarInstance;
  if (!instance) return;
  const position = instance.offset.y;
  scrollbarInstance = null;
  keepFocus(() => instance.destroy());
  window.bodyScrollBar = undefined;
  document.documentElement.classList.remove('has-smooth-scrollbar');
  virtualMode = false;
  window.scrollTo({ left: 0, top: position, behavior: 'instant' });
  const nativePosition = window.scrollY;
  homeExperience?.setMode(false);
  syncScrollState(nativePosition, false);
}

function reconcileScrollMode() {
  const wantsVirtual = shouldUseVirtualScroll();
  if (!wantsVirtual) {
    if (scrollbarImportPending) {
      modeRequest += 1;
      scrollbarImportPending = false;
    }
    if (scrollbarInstance) {
      modeRequest += 1;
      disableVirtualScroll();
    }
    return;
  }
  if (scrollbarInstance || scrollbarImportPending) return;

  const request = ++modeRequest;
  scrollbarImportPending = true;
  void import('./smooth-scrollbar.js').then(() => {
    if (request !== modeRequest) return;
    scrollbarImportPending = false;
    if (!shouldUseVirtualScroll() || !scrollContainer) return;
    const Scrollbar = window.Scrollbar;
    if (!Scrollbar) return;

    const position = window.scrollY;
    document.documentElement.classList.add('has-smooth-scrollbar');
    let instance: SmoothScrollbarInstance;
    try {
      const container = scrollContainer;
      instance = keepFocus(() => Scrollbar.init(container, {
        damping: 0.05,
        renderByPixels: true,
        continuousScrolling: true,
        alwaysShowTracks: false,
      }));
    } catch {
      document.documentElement.classList.remove('has-smooth-scrollbar');
      window.scrollTo({ left: 0, top: position, behavior: 'instant' });
      syncScrollState(window.scrollY, false);
      return;
    }

    scrollbarInstance = instance;
    window.bodyScrollBar = instance;
    virtualMode = true;
    homeExperience?.setMode(true);
    let userMovedSinceInitialization = false;
    instance.setPosition(0, position, { withoutCallbacks: true });
    syncScrollState(position, true);
    instance.addListener(({ offset }) => {
      if (Math.abs(offset.y - position) > 1) userMovedSinceInitialization = true;
      syncScrollState(offset.y, true);
    });
    requestAnimationFrame(() => {
      if (scrollbarInstance !== instance || !virtualMode || request !== modeRequest || userMovedSinceInitialization) return;
      if (Math.abs(instance.offset.y - position) > 1) {
        instance.setPosition(0, position, { withoutCallbacks: true });
        syncScrollState(instance.offset.y, true);
      }
    });
  }).catch(() => {
    if (request === modeRequest) scrollbarImportPending = false;
    // Fallback silencioso a scroll nativo.
  });
}

window.addEventListener('resize', reconcileScrollMode, { passive: true });
reduced.addEventListener('change', reconcileScrollMode);

// Con scroll virtual el navegador no desplaza el contenedor fijo al enfocar con teclado: se lleva el foco a la vista
// (bajo la cabecera sticky). Con scroll nativo ya lo hace el navegador.
document.addEventListener('focusin', event => {
  const target = event.target;
  if (!virtualMode || !scrollbarInstance || !(target instanceof HTMLElement) || !scrollContainer?.contains(target)) return;
  // Posición respecto al contenido (no a la pantalla): el navegador puede haber desplazado ya el contenedor nativamente.
  const content = scrollContainer.firstElementChild ?? scrollContainer;
  const inContent = target.getBoundingClientRect().top - content.getBoundingClientRect().top;
  const onScreen = inContent - scrollbarInstance.offset.y;
  if (onScreen < 124 || onScreen > innerHeight - 96) scrollbarInstance.scrollTo(0, Math.max(0, inContent - 160), reduced.matches ? 0 : 300);
});

document.addEventListener('click', event => {
  if (!(event.target instanceof Element)) return;
  const anchor = event.target.closest<HTMLAnchorElement>('a[href]');
  if (
    !anchor ||
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    (anchor.target && anchor.target !== '_self') ||
    anchor.hasAttribute('download')
  ) return;

  const url = new URL(anchor.href, location.href);
  const inMobileMenu = menu.contains(anchor);
  if (url.origin !== location.origin || url.pathname !== location.pathname || url.hash.length < 2) {
    if (inMobileMenu) void closeMenu();
    return;
  }

  let targetId: string;
  try {
    targetId = decodeURIComponent(url.hash.slice(1));
  } catch {
    if (inMobileMenu) void closeMenu();
    return;
  }
  const target = document.getElementById(targetId);
  if (!target) {
    if (inMobileMenu) void closeMenu();
    return;
  }

  event.preventDefault();
  history.pushState(null, '', `${url.pathname}${url.search}${url.hash}`);
  const closingMenu = inMobileMenu ? closeMenu(false) : null;
  if (virtualMode && scrollbarInstance) {
    scrollbarInstance.scrollIntoView(target, { offsetTop: 96, onlyScrollIfNeeded: false });
  } else {
    target.scrollIntoView({ behavior: reduced.matches ? 'auto' : 'smooth', block: 'start' });
  }
  if (anchor.matches('.skip-link')) target.focus({ preventScroll: true });
  if (closingMenu) {
    void closingMenu.then(() => {
      if (target.tabIndex >= 0) target.focus({ preventScroll: true });
      else toggle.focus({ preventScroll: true });
    });
  }
});

reconcileScrollMode();

// Medición: solo si Base publica el ID (analítica activada). Importación diferida: sin ID no se descarga nada.
const ga4Id = document.querySelector<HTMLMetaElement>('meta[name="dp-ga4"]')?.content;
if (ga4Id) void import('./consent').then(module => module.initConsent(ga4Id));

// Filtros internos del blog (solo en /blog/): importación diferida, una única suscripción.
const blogIndex = document.querySelector<HTMLElement>('[data-blog-index]');
if (blogIndex) void import('./blog-filter').then(module => module.initBlogFilter(blogIndex));
