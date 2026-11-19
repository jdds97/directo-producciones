import { afterLoadIdle, saveData } from './data-saver';
type HomeExperienceController = {
  updateScroll(offsetY: number, virtual: boolean): void;
  setMode(virtual: boolean): void;
};

type ServiceEntry = { control: HTMLButtonElement; panel: HTMLElement };
type ServiceScrollAnimation = {
  frame: number;
  from: number;
  target: number;
  startedAt: number;
  duration: number;
};
type ServiceMomentumScroller = { setMomentum(x: number, y: number): void };
const serviceScrollKeys: Record<string, true> = {
  ArrowDown: true,
  ArrowUp: true,
  PageDown: true,
  PageUp: true,
  Home: true,
  End: true,
  ' ': true,
};
type QuoteEntry = { control: HTMLButtonElement; quote: HTMLElement };
type VideoGroup = {
  container: HTMLElement;
  control?: HTMLButtonElement;
  videos: HTMLVideoElement[];
  synchronizers: Array<() => void>;
  userIntent: boolean | null;
  unavailableVideos: Set<HTMLVideoElement>;
};

type CameraMeterChannel = {
  bars: SVGRectElement[];
  level: number;
  target: number;
  phase: number;
  targetAt: number;
  peak: number;
  peakHoldUntil: number;
  peakSteppedAt: number;
};

function createCameraMeterSimulation(root: HTMLElement, reduced: MediaQueryList) {
  const channels: CameraMeterChannel[] = Array.from(root.querySelectorAll<SVGSVGElement>('.home-camera-meter'))
    .map((meter, index) => {
      const initialLevel = 8 + index;
      const bars = Array.from(meter.querySelectorAll<SVGRectElement>('.home-camera-meter-bar'));
      bars.forEach((bar, barIndex) => {
        bar.dataset.active = String(barIndex < initialLevel);
        bar.dataset.peak = 'false';
      });
      return {
        bars,
        level: initialLevel,
        target: initialLevel,
        phase: index * 1.47,
        targetAt: 0,
        peak: initialLevel,
        peakHoldUntil: 0,
        peakSteppedAt: 0,
      };
    })
    .filter(channel => channel.bars.length > 0);

  let frame: number | null = null;
  let lastFrameAt = 0;
  let enabled = false;

  const tick = (now: number) => {
    if (!enabled || reduced.matches || document.hidden || channels.length === 0) {
      frame = null;
      return;
    }

    if (now - lastFrameAt >= 32) {
      const elapsed = Math.min(64, Math.max(1, now - lastFrameAt));
      lastFrameAt = now;

      channels.forEach(channel => {
        if (now >= channel.targetAt) {
          const wave = 8 + 3.5 * Math.sin(now / 270 + channel.phase) +
            2.4 * Math.sin(now / 87 + channel.phase * 2);
          const noise = (Math.random() - 0.5) * 3;
          channel.target = Math.max(2, Math.min(channel.bars.length - 1, Math.round(wave + noise)));
          channel.targetAt = now + 80 + Math.random() * 100;
        }

        const rising = channel.target > channel.level;
        const response = 1 - Math.exp(-elapsed / (rising ? 48 : 108));
        channel.level += (channel.target - channel.level) * response;
        const activeCount = Math.max(0, Math.min(channel.bars.length, Math.round(channel.level)));

        if (activeCount > channel.peak) {
          channel.peak = activeCount;
          channel.peakHoldUntil = now + 260;
          channel.peakSteppedAt = now;
        } else if (now > channel.peakHoldUntil && now - channel.peakSteppedAt >= 120) {
          channel.peak = Math.max(activeCount, channel.peak - 1);
          channel.peakSteppedAt = now;
        }

        channel.bars.forEach((bar, index) => {
          const active = index < activeCount;
          const peak = !active && index === channel.peak - 1;
          const activeValue = String(active);
          const peakValue = String(peak);
          if (bar.dataset.active !== activeValue) bar.dataset.active = activeValue;
          if (bar.dataset.peak !== peakValue) bar.dataset.peak = peakValue;
        });
      });
    }

    frame = requestAnimationFrame(tick);
  };

  const start = () => {
    enabled = true;
    if (frame !== null || reduced.matches || document.hidden || channels.length === 0) return;
    lastFrameAt = performance.now();
    frame = requestAnimationFrame(tick);
  };

  const stop = () => {
    enabled = false;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    lastFrameAt = 0;
  };

  const onVisibilityChange = () => {
    if (document.hidden) {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    } else if (enabled) start();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  return {
    start,
    stop,
    dispose() {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    },
  };
}

export function initHomeExperience(root: HTMLElement): HomeExperienceController {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const cameraMeterSimulation = createCameraMeterSimulation(root, reduced);
  const hero = root.querySelector<HTMLElement>('[data-home-hero]');
  const heroStage = hero?.querySelector<HTMLElement>('[data-home-hero-stage]');
  const servicesSec = root.querySelector<HTMLElement>('[data-home-services]');
  const servicesStage = servicesSec?.querySelector<HTMLElement>('[data-home-services-stage]');
  const servicesIntro = servicesSec?.querySelector<HTMLElement>('.home-services-intro');
  const servicesLayout = servicesSec?.querySelector<HTMLElement>('.home-services-layout');
  const servicesPinMedia = matchMedia(
    '(min-width: 1025px) and (min-height: 800px) and (prefers-reduced-motion: no-preference)',
  );
  const header = document.querySelector<HTMLElement>('.header');
  let keyboardNavigation = false;
  // La cabecera y las acciones de la portada están siempre en el árbol de accesibilidad (sin inert ni aria-hidden):
  // el foco de teclado o de un lector que entra en ellas las muestra, sin esperar a la tecla Tab.
  const onKeyboardNavigation = (event: FocusEvent) => {
    const target = event.target;
    if (keyboardNavigation || !(target instanceof Element) || !(header?.contains(target) || hero?.contains(target)) || !target.matches(':focus-visible')) return;
    keyboardNavigation = true;
    updateHomeHeaderState(lastProgress);
    header?.classList.remove('header--hero-hidden');
  };
  document.addEventListener('focusin', onKeyboardNavigation);
  const gallery = root.querySelector<HTMLElement>('[data-home-gallery], .home-gallery');
  const galleryViewport = gallery?.querySelector<HTMLElement>('[data-home-gallery-viewport]');
  const galleryTrack = gallery?.querySelector<HTMLElement>('[data-home-gallery-track]');
  const responsiveRoot = root.closest<HTMLElement>('.artboard') ?? root;
  const scrollContainer = document.getElementById('scroll-container');
  let homeExperienceDisposed = false;
  type EffectiveRect = { left: number; top: number; right: number; bottom: number };
  const getEffectiveViewport = (): EffectiveRect => {
    const viewport: EffectiveRect = {
      left: 0,
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
    };
    if (header) {
      const headerRect = header.getBoundingClientRect();
      if (
        headerRect.top <= viewport.top &&
        headerRect.bottom > viewport.top &&
        headerRect.right > viewport.left &&
        headerRect.left < viewport.right
      ) {
        viewport.top = Math.min(viewport.bottom, headerRect.bottom);
      }
    }
    const artboardRect = responsiveRoot.getBoundingClientRect();
    viewport.left = Math.max(viewport.left, artboardRect.left);
    viewport.top = Math.max(viewport.top, artboardRect.top);
    viewport.right = Math.min(viewport.right, artboardRect.right);
    viewport.bottom = Math.min(viewport.bottom, artboardRect.bottom);
    const rootRect = root.getBoundingClientRect();
    viewport.left = Math.max(viewport.left, rootRect.left);
    viewport.top = Math.max(viewport.top, rootRect.top);
    viewport.right = Math.min(viewport.right, rootRect.right);
    viewport.bottom = Math.min(viewport.bottom, rootRect.bottom);
    if (virtualMode && scrollContainer) {
      const scrollRect = scrollContainer.getBoundingClientRect();
      viewport.left = Math.max(viewport.left, scrollRect.left);
      viewport.top = Math.max(viewport.top, scrollRect.top);
      viewport.right = Math.min(viewport.right, scrollRect.right);
      viewport.bottom = Math.min(viewport.bottom, scrollRect.bottom);
    }
    return viewport;
  };
  const isRectEffectivelyVisible = (
    rect: DOMRectReadOnly,
    viewport: EffectiveRect = getEffectiveViewport(),
    nestedClip?: DOMRectReadOnly,
    minimumVisibleWidth = 0,
  ) => {
    const left = Math.max(rect.left, viewport.left, nestedClip?.left ?? -Infinity);
    const top = Math.max(rect.top, viewport.top, nestedClip?.top ?? -Infinity);
    const right = Math.min(rect.right, viewport.right, nestedClip?.right ?? Infinity);
    const bottom = Math.min(rect.bottom, viewport.bottom, nestedClip?.bottom ?? Infinity);
    return right - left > minimumVisibleWidth && bottom - top > 0;
  };
  const effectiveIntersectionRatio = (target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    const viewport = getEffectiveViewport();
    const left = Math.max(rect.left, viewport.left);
    const top = Math.max(rect.top, viewport.top);
    const right = Math.min(rect.right, viewport.right);
    const bottom = Math.min(rect.bottom, viewport.bottom);
    const area = rect.width * rect.height;
    return area > 0 ? Math.max(0, right - left) * Math.max(0, bottom - top) / area : 0;
  };
  let scrollOffset = window.scrollY;
  let virtualMode = false;
  let heroTop = 0;
  let heroHeight = 0;
  let headerHeight = 0;
  let heroRange = 0;
  let heroRevealRange = 1;
  let viewportHeight = window.innerHeight;
  let servicesTop = 0;
  let servicesRange = 0;
  let lastServicesPinY = -1;
  let servicesPinned = false;
  let serviceScrollAnimation: ServiceScrollAnimation | null = null;
  let measuredVirtualMode = false;
  let lastProgress = -1;
  let lastPinY = -1;
  const videoSynchronizers: Array<() => void> = [];
  const videoVisibility = new WeakMap<HTMLVideoElement, (visible: boolean) => void>();

  const measureHero = () => {
    viewportHeight = window.innerHeight;
    headerHeight = header?.offsetHeight ?? 0;
    measuredVirtualMode = virtualMode;
    if (!hero) return;
    const currentOffset = virtualMode ? scrollOffset : window.scrollY;
    heroTop = hero ? hero.getBoundingClientRect().top + currentOffset : 0;
    heroHeight = hero?.offsetHeight ?? 0;
    heroRange = Math.max(1, heroHeight - viewportHeight);
    // Mantener el frame completo un momento antes de liberar el hero.
    heroRevealRange = Math.max(1, heroRange - viewportHeight * 0.5);

    if (servicesSec && servicesStage) {
      servicesTop = servicesSec.getBoundingClientRect().top + currentOffset;
      servicesRange = Math.max(1, servicesSec.offsetHeight - viewportHeight);
    }
  };

  const publishHomeHeaderState = (
    target: HTMLElement,
    visible: boolean,
    interactive: boolean,
    logoVisible: boolean,
    tone: 'video' | 'page',
    opacity: string,
  ) => {
    const visibleValue = String(visible);
    const interactiveValue = String(interactive);
    const logoValue = String(logoVisible);
    if (target.dataset.homeHeaderVisible !== visibleValue) target.dataset.homeHeaderVisible = visibleValue;
    if (target.dataset.homeHeaderInteractive !== interactiveValue) target.dataset.homeHeaderInteractive = interactiveValue;
    if (target.dataset.homeHeaderLogoVisible !== logoValue) target.dataset.homeHeaderLogoVisible = logoValue;
    if (target.dataset.homeHeaderTone !== tone) target.dataset.homeHeaderTone = tone;
    if (target.style.getPropertyValue('--home-header-opacity') !== opacity) {
      target.style.setProperty('--home-header-opacity', opacity);
    }
  };

  const updateHomeHeaderState = (progress: number) => {
    const visible = keyboardNavigation || reduced.matches || progress > 0.7;
    const interactive = keyboardNavigation || reduced.matches || progress >= 0.8;
    const logoVisible = keyboardNavigation || reduced.matches || progress >= 0.98;
    // El hero se libera al terminar el pin, no cuando su borde alcanza la cabecera.
    // Dos píxeles de histéresis evitan alternar de tono por jitter al volver al hero.
    const heroExitOffset = heroTop + Math.max(0, heroHeight - viewportHeight);
    const exitThreshold = Math.max(heroTop, heroExitOffset - (root.dataset.homeHeaderTone === 'page' ? 2 : 0));
    const tone: 'video' | 'page' = (keyboardNavigation && progress < 0.8) || !hero || heroHeight <= 0 || scrollOffset > exitThreshold
      ? 'page'
      : 'video';
    const opacity = keyboardNavigation || reduced.matches
      ? '1'
      : String(Math.min(1, Math.max(0, (progress - 0.7) / 0.1)));
    publishHomeHeaderState(root, visible, interactive, logoVisible, tone, opacity);
    publishHomeHeaderState(document.body, visible, interactive, logoVisible, tone, opacity);
  };

  let reducedStateInitialized = false;
  const setReducedState = () => {
    if (homeExperienceDisposed) return;
    root.toggleAttribute('data-home-reduced-motion', reduced.matches);
    cameraMeterSimulation.stop();
    if (reduced.matches) {
      revealObserver?.disconnect();
      revealAnimations.forEach(animation => animation.cancel());
      revealAnimations.clear();
      activeReveals.clear();
      if (galleryTransition) finishGalleryTransition();
      cancelGalleryGesture();
      finishGalleryReveals();
      galleryFirstRevealDone = true;
    } else if (reducedStateInitialized) {
      finishGalleryReveals();
    }
    videoSynchronizers.forEach(sync => sync());
    configureServicesPin();
    measureHero();
    if (servicesPinned) updateActiveService(serviceIndexAtOffset(scrollOffset));
    updateServices();
    if (reducedStateInitialized || reduced.matches) syncRevealVisibility(true);
    refreshRevealObserver();
    reducedStateInitialized = true;
    refreshGalleryObservers();
    updateScroll(scrollOffset, virtualMode);
    syncGalleryMotion();
  };

  const revealTargets = Array.from(root.querySelectorAll<HTMLElement>('[data-home-reveal]'))
    .filter(target => !target.parentElement?.closest('[data-home-reveal]'));
  const revealTargetsInView = new Set<HTMLElement>();
  const revealTargetsInitialized = new Set<HTMLElement>();
  const activeReveals = new Set<Animation>();
  const revealAnimations = new Map<HTMLElement, Animation>();
  let revealObserver: IntersectionObserver | null = null;

  const syncRevealVisibility = (initializeAll = false) => {
    revealTargets.forEach(target => {
      if (!initializeAll && !revealTargetsInitialized.has(target)) return;
      revealTargetsInitialized.add(target);
      if (isRectEffectivelyVisible(target.getBoundingClientRect(), getEffectiveViewport())) {
        revealTargetsInView.add(target);
      } else {
        revealTargetsInView.delete(target);
      }
    });
  };

  const animateReveal = (target: HTMLElement, entersFromAbove: boolean) => {
    let fromOpacity: string | number = 0.94;
    let fromTransform = entersFromAbove ? 'translateY(-8px)' : 'translateY(8px)';
    if (target.matches('.home-communication-mark')) {
      if (target.dataset.introduced) {
        target.getAnimations({ subtree: true }).forEach(animation => {
          if (animation instanceof CSSAnimation && animation.animationName.startsWith('home-communication-')) {
            animation.currentTime = 0;
            animation.play();
          }
        });
      } else {
        target.dataset.introduced = 'true';
      }
    }
    const previousAnimation = revealAnimations.get(target);
    if (previousAnimation) {
      const currentStyle = getComputedStyle(target);
      fromOpacity = currentStyle.opacity;
      fromTransform = currentStyle.transform === 'none'
        ? 'translateY(0)'
        : currentStyle.transform;
      previousAnimation.cancel();
      revealAnimations.delete(target);
      activeReveals.delete(previousAnimation);
    }
    const animation = target.animate(
      [
        { opacity: fromOpacity, transform: fromTransform },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      {
        duration: 460,
        delay: Math.max(0, Number(target.dataset.homeRevealDelay) || 0),
        easing: 'cubic-bezier(.2,.8,.2,1)',
        fill: 'both',
      },
    );
    revealAnimations.set(target, animation);
    activeReveals.add(animation);
    animation.addEventListener('finish', () => {
      if (revealAnimations.get(target) !== animation) return;
      animation.cancel();
      revealAnimations.delete(target);
      activeReveals.delete(animation);
    }, { once: true });
  };

  const connectRevealObserver = () => {
    if (
      homeExperienceDisposed ||
      reduced.matches ||
      typeof IntersectionObserver === 'undefined' ||
      typeof Element.prototype.animate !== 'function'
    ) return;
    const thresholds = new Set([0, 0.05, 0.55]);
    revealTargets.forEach(target => {
      const height = target.getBoundingClientRect().height;
      if (height > 0) thresholds.add(Math.min(1, 0.05 + 24 / height));
    });
    revealObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const target = entry.target as HTMLElement;
        const targetRect = target.getBoundingClientRect();
        const effectiveViewport = getEffectiveViewport();
        revealTargetsInitialized.add(target);
        const isVisible = entry.isIntersecting &&
          isRectEffectivelyVisible(targetRect, effectiveViewport);
        if (!isVisible) {
          revealTargetsInView.delete(target);
          return;
        }
        if (revealTargetsInView.has(target) || reduced.matches) return;
        const entersFromAbove = targetRect.top < effectiveViewport.top;
        const minimumRatio = target.matches('.home-communication-mark')
          ? 0.55
          : entersFromAbove ? 0.05 : Math.min(1, 0.05 + 24 / targetRect.height);
        if (entry.intersectionRatio < minimumRatio) return;
        revealTargetsInView.add(target);
        animateReveal(target, entersFromAbove);
      });
    }, {
      threshold: Array.from(thresholds).sort((a, b) => a - b),
      rootMargin: `-${headerHeight}px 0px 0px 0px`,
    });
    revealTargets.forEach(target => revealObserver?.observe(target));
  };

  function refreshRevealObserver() {
    revealObserver?.disconnect();
    revealObserver = null;
    connectRevealObserver();
  }

  const serviceNav = root.querySelector<HTMLElement>('[data-home-service-controls], .home-service-controls');
  const serviceControls = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-home-service]'));
  const services: ServiceEntry[] = serviceControls.flatMap(control => {
    const id = control.getAttribute('aria-controls');
    const panel = id ? document.getElementById(id) : null;
    return panel && root.contains(panel) ? [{ control, panel }] : [];
  });
  let activeService = Math.max(0, services.findIndex(entry => entry.control.getAttribute('aria-pressed') === 'true'));

  const serviceIndexAtOffset = (offsetY: number) => {
    if (!services.length || servicesRange <= 0) return 0;
    const progress = Math.min(1, Math.max(0, (offsetY - servicesTop) / servicesRange));
    return Math.min(services.length - 1, Math.floor(progress * services.length));
  };
  const updateServices = () => {
    if (serviceNav) serviceNav.hidden = !servicesPinned;
    services.forEach((entry, index) => {
      const active = !servicesPinned || index === activeService;
      entry.control.hidden = !servicesPinned;
      entry.control.setAttribute('aria-pressed', String(index === activeService));
      entry.panel.dataset.homeServiceActive = String(active);
      entry.panel.inert = !active;
      if (active) entry.panel.removeAttribute('aria-hidden');
      else entry.panel.setAttribute('aria-hidden', 'true');
    });
  };
  const stopServiceScrollAnimation = () => {
    if (serviceScrollAnimation) cancelAnimationFrame(serviceScrollAnimation.frame);
    serviceScrollAnimation = null;
  };
  const clearServicesStagePosition = () => {
    if (!servicesStage) return;
    servicesStage.style.position = '';
    servicesStage.style.top = '';
    servicesStage.style.left = '';
    servicesStage.style.width = '';
    servicesStage.style.transform = '';
    lastServicesPinY = -1;
  };
  const focusServicePanel = (index: number) => {
    const heading = services[index]?.panel.querySelector<HTMLElement>('h3');
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  };
  const updateActiveService = (index: number) => {
    if (!servicesPinned) return;
    if (index !== activeService && services[activeService]?.panel.contains(document.activeElement)) return;
    if (index === activeService) return;
    activeService = index;
    updateServices();
  };
  const configureServicesPin = () => {
    const canPin = Boolean(
      servicesSec &&
      servicesStage &&
      services.length > 1 &&
      servicesPinMedia.matches &&
      responsiveRoot.clientWidth > 1024 &&
      !reduced.matches,
    );
    if (canPin && servicesSec && servicesStage) {
      servicesSec.dataset.homeServicesPinned = 'true';
      const stageStyle = getComputedStyle(servicesStage);
      const stageRect = servicesStage.getBoundingClientRect();
      const introRect = servicesIntro?.getBoundingClientRect();
      const layoutRect = servicesLayout?.getBoundingClientRect();
      const contentTop = stageRect.top + (Number.parseFloat(stageStyle.paddingTop) || 0);
      const contentBottom = stageRect.bottom - (Number.parseFloat(stageStyle.paddingBottom) || 0);
      const fits = Boolean(
        stageRect.height > 0 &&
        introRect &&
        layoutRect &&
        introRect.top >= contentTop - 1 &&
        layoutRect.bottom <= contentBottom + 1,
      );
      if (!fits) servicesSec.removeAttribute('data-home-services-pinned');
    } else {
      servicesSec?.removeAttribute('data-home-services-pinned');
    }

    const nextPinned = servicesSec?.dataset.homeServicesPinned === 'true';
    if (nextPinned === servicesPinned) return;
    const focusedControlIndex = services.findIndex(entry => entry.control === document.activeElement);
    const focusedPanelIndex = services.findIndex(entry => entry.panel.contains(document.activeElement));
    servicesPinned = nextPinned;
    stopServiceScrollAnimation();
    lastServicesPinY = -1;
    if (servicesPinned) {
      activeService = focusedPanelIndex >= 0
        ? focusedPanelIndex
        : serviceIndexAtOffset(scrollOffset);
    } else {
      clearServicesStagePosition();
      if (focusedControlIndex >= 0) focusServicePanel(focusedControlIndex);
    }
  };
  const setServiceScrollPosition = (position: number) => {
    const scrollbar = window.bodyScrollBar;
    if (virtualMode && scrollbar) {
      scrollbar.setPosition(0, position);
    } else {
      window.scrollTo({ top: position, behavior: 'instant' });
    }
  };
  const scrollToService = (index: number) => {
    if (!servicesPinned || !servicesSec || services.length < 2 || servicesRange <= 0) return;
    const scrollbar = virtualMode ? window.bodyScrollBar : undefined;
    const from = scrollbar?.offset.y ?? window.scrollY;
    const target = servicesTop + ((index + 0.5) / services.length) * servicesRange;
    const distance = target - from;
    if (scrollbar) {
      (scrollbar as typeof scrollbar & ServiceMomentumScroller).setMomentum(0, 0);
    }
    if (Math.abs(distance) < 1) return;
    const animation: ServiceScrollAnimation = {
      frame: 0,
      from,
      target,
      startedAt: performance.now(),
      duration: Math.min(800, Math.max(300, Math.abs(distance) * 0.4)),
    };
    serviceScrollAnimation = animation;
    const step = (now: number) => {
      if (serviceScrollAnimation !== animation) return;
      const progress = Math.min(1, (now - animation.startedAt) / animation.duration);
      const eased = progress < 0.5
        ? 4 * progress ** 3
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      setServiceScrollPosition(animation.from + distance * eased);
      if (progress >= 1) {
        serviceScrollAnimation = null;
        setServiceScrollPosition(animation.target);
        return;
      }
      animation.frame = requestAnimationFrame(step);
    };
    animation.frame = requestAnimationFrame(step);
  };

  if (services.length) {
    services.forEach((entry, index) => {
      entry.control.addEventListener('click', () => scrollToService(index));
    });
    servicesStage?.addEventListener('focusout', () => {
      queueMicrotask(() => updateActiveService(serviceIndexAtOffset(scrollOffset)));
    });
    const cancelServiceScrollFromGesture = () => stopServiceScrollAnimation();
    window.addEventListener('wheel', cancelServiceScrollFromGesture, { capture: true, passive: true });
    window.addEventListener('touchstart', cancelServiceScrollFromGesture, { capture: true, passive: true });
    window.addEventListener('pointerdown', cancelServiceScrollFromGesture, { capture: true, passive: true });
    window.addEventListener('keydown', event => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.matches('input, textarea, select'))
      ) return;
      if (serviceScrollKeys[event.key]) stopServiceScrollAnimation();
    }, true);
  }

  const quoteNav = root.querySelector<HTMLElement>('.home-quote-controls');
  const quoteControls = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-home-quote-control]'));
  const quotes: QuoteEntry[] = quoteControls.flatMap(control => {
    const id = control.getAttribute('aria-controls');
    const quote = id ? document.getElementById(id) : null;
    return quote && root.contains(quote) ? [{ control, quote }] : [];
  });
  let activeQuote = Math.max(0, quotes.findIndex(entry => entry.control.getAttribute('aria-pressed') === 'true'));

  const updateQuotes = () => {
    quotes.forEach((entry, index) => {
      const active = index === activeQuote;
      entry.control.setAttribute('aria-pressed', String(active));
      entry.quote.dataset.homeQuoteActive = String(active);
      entry.quote.inert = !active;
      if (active) entry.quote.removeAttribute('aria-hidden');
      else entry.quote.setAttribute('aria-hidden', 'true');
    });
  };

  if (quotes.length) {
    if (quoteNav) quoteNav.hidden = false;
    quotes.forEach((entry, index) => {
      entry.control.hidden = false;
      entry.control.addEventListener('click', () => {
        activeQuote = index;
        updateQuotes();
      });
    });
    updateQuotes();
  }

  const galleryScroller = galleryViewport ?? galleryTrack;
  const galleryPanels = galleryTrack
    ? Array.from(galleryTrack.querySelectorAll<HTMLElement>('[data-home-gallery-panel]'))
    : [];
  const galleryPrev = gallery?.querySelector<HTMLButtonElement>('[data-home-gallery-prev]');
  const galleryNext = gallery?.querySelector<HTMLButtonElement>('[data-home-gallery-next]');
  const galleryToggle = gallery?.querySelector<HTMLButtonElement>('[data-home-gallery-toggle]');
  const activeGalleryAnimations = new Set<Animation>();
  const galleryMaskAnimations = new WeakMap<HTMLElement, Animation>();
  const galleryPendingReveals = new Set<HTMLElement>();
  const galleryInitialRevealPanels = new Set<HTMLElement>();
  let galleryRevealFrame: number | null = null;
  let gallerySectionObserver: IntersectionObserver | null = null;
  let galleryVisibilityObserver: IntersectionObserver | null = null;
  let galleryTimer: number | null = null;
  let galleryTransition: { frame: number; target: number; finish: () => void } | null = null;
  let galleryFocusWithin = false;
  let galleryDragging = false;
  let galleryUserPaused = false;
  let galleryInView = false;
  let galleryFirstRevealDone = false;
  let galleryFirstRevealStarted = false;
  let galleryEnhanced = false;
  let galleryGesture: {
    pointerId: number;
    startX: number;
    startY: number;
    deltaX: number;
    nextDistance: number;
    axis: 'pending' | 'horizontal' | 'vertical';
    previousPanel: HTMLElement | null;
    previousDistance: number;
  } | null = null;

  const galleryIsReady = Boolean(gallery && galleryScroller && galleryTrack && galleryPanels.length > 1);
  const galleryGap = () => {
    if (!galleryTrack) return 0;
    const value = Number.parseFloat(getComputedStyle(galleryTrack).columnGap);
    return Number.isFinite(value) ? value : 0;
  };
  const galleryNextDistance = () => {
    const first = galleryTrack?.firstElementChild;
    const second = first?.nextElementSibling;
    return first instanceof HTMLElement && second instanceof HTMLElement
      ? second.getBoundingClientRect().left - first.getBoundingClientRect().left
      : 0;
  };
  const galleryPreviousDistance = (panel: HTMLElement) => panel.getBoundingClientRect().width + galleryGap();

  const clearGalleryTimer = () => {
    if (galleryTimer === null) return;
    window.clearTimeout(galleryTimer);
    galleryTimer = null;
  };

  const galleryCanAutoplay = () => (
    galleryEnhanced &&
    !reduced.matches &&
    galleryFirstRevealDone &&
    galleryPendingReveals.size === 0 &&
    galleryInitialRevealPanels.size === 0 &&
    activeGalleryAnimations.size === 0 &&
    !galleryUserPaused &&
    !galleryFocusWithin &&
    !galleryDragging &&
    galleryInView &&
    !document.hidden
  );

  function syncGalleryMotion() {
    const ready = galleryIsReady;
    galleryEnhanced = Boolean(
      ready &&
      galleryToggle &&
      galleryPrev &&
      galleryNext &&
      !reduced.matches &&
      typeof IntersectionObserver !== 'undefined' &&
      typeof Element.prototype.animate === 'function',
    );
    if (gallery) {
      if (galleryEnhanced) gallery.dataset.homeGalleryEnhanced = 'true';
      else delete gallery.dataset.homeGalleryEnhanced;
    }
    if (galleryPrev) galleryPrev.hidden = !ready;
    if (galleryNext) galleryNext.hidden = !ready;
    if (galleryToggle) {
      galleryToggle.hidden = !galleryEnhanced;
      const label = galleryUserPaused ? 'Reanudar movimiento' : 'Pausar movimiento';
      galleryToggle.setAttribute('aria-label', label);
      galleryToggle.setAttribute('aria-pressed', String(galleryUserPaused));
      galleryToggle.title = label;
      galleryToggle.querySelector<SVGPathElement>('[data-home-gallery-toggle-icon] path')?.setAttribute('d', galleryUserPaused ? 'm9 5 10 7-10 7Z' : 'M8 5v14M16 5v14');
    }

    if (!galleryCanAutoplay() || galleryTransition) {
      clearGalleryTimer();
      return;
    }
    if (galleryTimer !== null) return;
    galleryTimer = window.setTimeout(() => {
      galleryTimer = null;
      moveGallery('next');
    }, 1200);
  }

  function finishGalleryTransition() {
    const transition = galleryTransition;
    if (!transition || !galleryScroller) return;
    cancelAnimationFrame(transition.frame);
    galleryTransition = null;
    galleryScroller.scrollLeft = transition.target;
    transition.finish();
    syncGalleryMotion();
  }

  function animateGalleryScroll(target: number, finish: () => void) {
    if (!galleryScroller) return;
    clearGalleryTimer();
    const from = galleryScroller.scrollLeft;
    if (reduced.matches || Math.abs(target - from) < 1) {
      galleryScroller.scrollLeft = target;
      finish();
      queueVisibleGalleryPanels();
      syncGalleryMotion();
      return;
    }

    const startedAt = performance.now();
    const transition = {
      frame: 0,
      target,
      finish,
    };
    galleryTransition = transition;
    const step = (now: number) => {
      if (galleryTransition !== transition || !galleryScroller) return;
      const progress = Math.min(1, (now - startedAt) / 1800);
      const eased = 1 - Math.pow(1 - progress, 3);
      galleryScroller.scrollLeft = from + (target - from) * eased;
      queueVisibleGalleryPanels();
      if (progress >= 1) {
        galleryTransition = null;
        galleryScroller.scrollLeft = target;
        transition.finish();
        queueVisibleGalleryPanels();
        syncGalleryMotion();
        return;
      }
      transition.frame = requestAnimationFrame(step);
    };
    transition.frame = requestAnimationFrame(step);
  }
  function cancelGalleryGesture() {
    const gesture = galleryGesture;
    if (!gesture) return;
    galleryGesture = null;
    galleryDragging = false;
    if (gesture.previousPanel) galleryTrack?.append(gesture.previousPanel);
    if (galleryScroller) galleryScroller.scrollLeft = 0;
    queueVisibleGalleryPanels();
    if (galleryViewport?.hasPointerCapture(gesture.pointerId)) {
      galleryViewport.releasePointerCapture(gesture.pointerId);
    }
  }

  function moveGallery(direction: 'previous' | 'next') {
    if (!galleryIsReady || !galleryTrack || !galleryScroller) return;
    clearGalleryTimer();
    if (galleryTransition) finishGalleryTransition();

    if (direction === 'next') {
      const first = galleryTrack.firstElementChild;
      const distance = galleryNextDistance();
      if (!(first instanceof HTMLElement) || distance <= 0) return;
      animateGalleryScroll(distance, () => {
        galleryTrack.append(first);
        galleryScroller.scrollLeft = 0;
      });
      return;
    }

    const first = galleryTrack.firstElementChild;
    const last = galleryTrack.lastElementChild;
    if (!(first instanceof HTMLElement) || !(last instanceof HTMLElement)) return;
    const distance = galleryPreviousDistance(last);
    if (distance <= 0) return;
    galleryTrack.insertBefore(last, first);
    galleryScroller.scrollLeft += distance;
    animateGalleryScroll(0, () => {
      galleryScroller.scrollLeft = 0;
    });
  }

  function finishGalleryReveals() {
    if (galleryRevealFrame !== null) {
      cancelAnimationFrame(galleryRevealFrame);
      galleryRevealFrame = null;
    }
    galleryPendingReveals.clear();
    galleryPanels.forEach(panel => {
      const mask = panel.querySelector<HTMLElement>('[data-home-gallery-mask]');
      if (!mask) return;
      galleryMaskAnimations.delete(mask);
    });
    activeGalleryAnimations.forEach(animation => animation.cancel());
    activeGalleryAnimations.clear();
    const effectiveViewport = getEffectiveViewport();
    const galleryRect = galleryViewport?.getBoundingClientRect();
    galleryPanels.forEach(panel => {
      const mask = panel.querySelector<HTMLElement>('[data-home-gallery-mask]');
      if (!mask) return;
      if (
        galleryPanelIsVisible(panel, effectiveViewport, galleryRect) ||
        panel.contains(document.activeElement)
      ) {
        panel.dataset.homeGalleryVisible = 'true';
        mask.style.transform = 'translateX(-101%)';
      } else if (!galleryDragging) {
        delete panel.dataset.homeGalleryVisible;
        mask.style.removeProperty('transform');
      }
    });
    galleryInitialRevealPanels.clear();
    if (galleryFirstRevealStarted) galleryFirstRevealDone = true;
  }

  const animateGalleryMask = (mask: HTMLElement, delay: number, onFinish: () => void) => {
    const target = 'translateX(-101%)';
    if (!galleryEnhanced || reduced.matches || typeof mask.animate !== 'function') {
      mask.style.transform = target;
      onFinish();
      return;
    }
    const animation = mask.animate(
      [{ transform: 'translateX(0%)' }, { transform: target }],
      {
        duration: 1400,
        delay,
        easing: 'cubic-bezier(.2,.8,.2,1)',
        fill: 'forwards',
      },
    );
    galleryMaskAnimations.set(mask, animation);
    activeGalleryAnimations.add(animation);
    animation.addEventListener('finish', () => {
      if (galleryMaskAnimations.get(mask) !== animation) return;
      mask.style.transform = target;
      galleryMaskAnimations.delete(mask);
      activeGalleryAnimations.delete(animation);
      animation.cancel();
      onFinish();
    }, { once: true });
  };

  function completeGalleryPanelReveal(panel: HTMLElement) {
    if (
      galleryInitialRevealPanels.delete(panel) &&
      galleryInitialRevealPanels.size === 0
    ) {
      galleryFirstRevealDone = true;
    }
    syncGalleryMotion();
  }

  function galleryPanelIsVisible(
    panel: HTMLElement,
    effectiveViewport: EffectiveRect = getEffectiveViewport(),
    galleryRect: DOMRectReadOnly | undefined = galleryViewport?.getBoundingClientRect(),
    minimumVisibleWidth = 0,
  ) {
    return Boolean(
      galleryRect &&
      isRectEffectivelyVisible(
        panel.getBoundingClientRect(),
        effectiveViewport,
        galleryRect,
        minimumVisibleWidth,
      ),
    );
  }

  function cancelGalleryPanelAnimation(panel: HTMLElement) {
    const mask = panel.querySelector<HTMLElement>('[data-home-gallery-mask]');
    const animation = mask ? galleryMaskAnimations.get(mask) : undefined;
    if (!mask || !animation) return false;
    galleryMaskAnimations.delete(mask);
    activeGalleryAnimations.delete(animation);
    animation.cancel();
    return true;
  }

  function resetGalleryPanel(panel: HTMLElement, effectiveViewport: EffectiveRect, galleryRect: DOMRectReadOnly | undefined) {
    if (
      galleryDragging ||
      panel.contains(document.activeElement) ||
      galleryPanelIsVisible(panel, effectiveViewport, galleryRect)
    ) return;
    const wasVisible = panel.dataset.homeGalleryVisible === 'true';
    const wasPending = galleryPendingReveals.delete(panel);
    const wasAnimating = cancelGalleryPanelAnimation(panel);
    const wasInitialReveal = galleryInitialRevealPanels.delete(panel);
    delete panel.dataset.homeGalleryVisible;
    panel.querySelector<HTMLElement>('[data-home-gallery-mask]')?.style.removeProperty('transform');
    if (wasInitialReveal && galleryInitialRevealPanels.size === 0) {
      galleryFirstRevealDone = true;
    }
    if (wasVisible || wasPending || wasAnimating || wasInitialReveal) syncGalleryMotion();
  }

  function markGalleryPanelVisible(panel: HTMLElement) {
    const wasVisible = panel.dataset.homeGalleryVisible === 'true';
    const wasPending = galleryPendingReveals.delete(panel);
    const mask = panel.querySelector<HTMLElement>('[data-home-gallery-mask]');
    const animation = mask ? galleryMaskAnimations.get(mask) : undefined;
    if (animation) {
      galleryMaskAnimations.delete(mask!);
      activeGalleryAnimations.delete(animation);
      animation.cancel();
    }
    panel.dataset.homeGalleryVisible = 'true';
    if (mask) mask.style.transform = 'translateX(-101%)';
    const wasInitialReveal = galleryInitialRevealPanels.delete(panel);
    if (wasInitialReveal && galleryInitialRevealPanels.size === 0) {
      galleryFirstRevealDone = true;
    }
    if (!wasVisible || wasPending || animation || wasInitialReveal) syncGalleryMotion();
  }

  function queueGalleryReveal(panel: HTMLElement) {
    if (panel.dataset.homeGalleryVisible === 'true' || galleryPendingReveals.has(panel)) return;
    galleryPendingReveals.add(panel);
    if (!galleryFirstRevealDone) {
      galleryFirstRevealStarted = true;
      galleryInitialRevealPanels.add(panel);
    }
    if (galleryRevealFrame === null) {
      galleryRevealFrame = requestAnimationFrame(flushGalleryRevealQueue);
    }
    syncGalleryMotion();
  }
  function queueVisibleGalleryPanels() {
    const effectiveViewport = getEffectiveViewport();
    const galleryRect = galleryViewport?.getBoundingClientRect();
    galleryPanels.forEach(panel => {
      if (!galleryPanelIsVisible(panel, effectiveViewport, galleryRect)) {
        resetGalleryPanel(panel, effectiveViewport, galleryRect);
        return;
      }
      if (galleryDragging || panel.contains(document.activeElement)) {
        markGalleryPanelVisible(panel);
        return;
      }
      if (
        !galleryInView ||
        !galleryPanelIsVisible(panel, effectiveViewport, galleryRect, 1) ||
        panel.dataset.homeGalleryVisible === 'true' ||
        galleryPendingReveals.has(panel)
      ) return;
      queueGalleryReveal(panel);
    });
  }

  function flushGalleryRevealQueue() {
    galleryRevealFrame = null;
    if (!galleryInView) {
      const effectiveViewport = getEffectiveViewport();
      const galleryRect = galleryViewport?.getBoundingClientRect();
      galleryPendingReveals.forEach(panel => resetGalleryPanel(panel, effectiveViewport, galleryRect));
      galleryPendingReveals.clear();
      return;
    }
    const orderedPanels = Array.from(galleryPendingReveals).sort(
      (a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left,
    );
    const visiblePanels: HTMLElement[] = [];
    const effectiveViewport = getEffectiveViewport();
    const galleryRect = galleryViewport?.getBoundingClientRect();
    orderedPanels.forEach(panel => {
      galleryPendingReveals.delete(panel);
      if (!galleryPanelIsVisible(panel, effectiveViewport, galleryRect, 1)) {
        resetGalleryPanel(panel, effectiveViewport, galleryRect);
        return;
      }
      if (galleryDragging || panel.contains(document.activeElement)) {
        markGalleryPanelVisible(panel);
        return;
      }
      panel.dataset.homeGalleryVisible = 'true';
      visiblePanels.push(panel);
    });
    visiblePanels.forEach((panel, index) => {
      const mask = panel.querySelector<HTMLElement>('[data-home-gallery-mask]');
      if (!mask) {
        completeGalleryPanelReveal(panel);
        return;
      }
      animateGalleryMask(mask, index * 140, () => completeGalleryPanelReveal(panel));
    });
    syncGalleryMotion();
  }

  if (galleryIsReady && galleryViewport && galleryTrack && gallery) {
    galleryViewport.scrollLeft = 0;
    galleryFocusWithin = gallery.contains(document.activeElement);
    if (!galleryViewport.hasAttribute('tabindex')) galleryViewport.tabIndex = 0;
    if (!galleryViewport.hasAttribute('role')) galleryViewport.setAttribute('role', 'region');
    if (!galleryViewport.hasAttribute('aria-label')) {
      const heading = gallery.querySelector('h2')?.textContent?.trim();
      if (heading) galleryViewport.setAttribute('aria-label', `${heading}: trabajos audiovisuales`);
    }
    galleryTrack.removeAttribute('tabindex');
    galleryTrack.removeAttribute('role');

    galleryViewport.addEventListener('keydown', event => {
      if (event.target !== galleryViewport || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
      event.preventDefault();
      moveGallery(event.key === 'ArrowRight' ? 'next' : 'previous');
    });
    galleryPrev?.addEventListener('click', () => moveGallery('previous'));
    galleryNext?.addEventListener('click', () => moveGallery('next'));
    galleryToggle?.addEventListener('click', () => {
      galleryUserPaused = !galleryUserPaused;
      if (galleryUserPaused && galleryTransition) finishGalleryTransition();
      syncGalleryMotion();
      videoSynchronizers.forEach(sync => sync());
    });

    gallery.addEventListener('focusin', event => {
      galleryFocusWithin = true;
      if (event.target instanceof Element) {
        const panel = event.target.closest<HTMLElement>('[data-home-gallery-panel]');
        if (panel && galleryPanels.includes(panel)) markGalleryPanelVisible(panel);
      }
      if (galleryTransition) finishGalleryTransition();
      syncGalleryMotion();
    });
    gallery.addEventListener('focusout', () => {
      queueMicrotask(() => {
        galleryFocusWithin = gallery.contains(document.activeElement);
        queueVisibleGalleryPanels();
        syncGalleryMotion();
      });
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (galleryTransition) finishGalleryTransition();
        finishGalleryReveals();
      }
      syncGalleryMotion();
    });

    galleryViewport.addEventListener('pointerdown', event => {
      if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
      if (event.target instanceof Element && event.target.closest('a, button, input, select, textarea, [contenteditable="true"]')) return;
      if (galleryTransition) finishGalleryTransition();
      galleryGesture = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        deltaX: 0,
        nextDistance: galleryNextDistance(),
        axis: 'pending',
        previousPanel: null,
        previousDistance: 0,
      };
      galleryViewport.setPointerCapture(event.pointerId);
    });
    galleryViewport.addEventListener('pointermove', event => {
      const gesture = galleryGesture;
      if (!gesture || gesture.pointerId !== event.pointerId || !galleryScroller || !galleryTrack) return;
      const deltaX = event.clientX - gesture.startX;
      const deltaY = event.clientY - gesture.startY;
      if (gesture.axis === 'pending') {
        if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < 8) return;
        gesture.axis = Math.abs(deltaX) > Math.abs(deltaY) * 1.15 ? 'horizontal' : 'vertical';
        if (gesture.axis === 'vertical') return;
        galleryDragging = true;
        clearGalleryTimer();
        queueVisibleGalleryPanels();
      }
      if (gesture.axis !== 'horizontal') return;
      event.preventDefault();
      gesture.deltaX = deltaX;
      if (deltaX > 0) {
        if (!gesture.previousPanel) {
          const first = galleryTrack.firstElementChild;
          const last = galleryTrack.lastElementChild;
          if (!(first instanceof HTMLElement) || !(last instanceof HTMLElement)) return;
          gesture.previousPanel = last;
          gesture.previousDistance = galleryPreviousDistance(last);
          galleryTrack.insertBefore(last, first);
          galleryScroller.scrollLeft += gesture.previousDistance;
        }
        galleryScroller.scrollLeft = Math.max(
          0,
          gesture.previousDistance - Math.min(deltaX, gesture.previousDistance),
        );
        queueVisibleGalleryPanels();
        return;
      }
      if (gesture.previousPanel) {
        galleryTrack.append(gesture.previousPanel);
        gesture.previousPanel = null;
        galleryScroller.scrollLeft = 0;
      }
      galleryScroller.scrollLeft = Math.min(-deltaX, gesture.nextDistance);
      queueVisibleGalleryPanels();
    });
    galleryViewport.addEventListener('dragstart', event => {
      if (event.target instanceof Element && event.target.closest('[data-home-gallery-panel]')) {
        event.preventDefault();
      }
    });

    const finishGalleryGesture = (event: PointerEvent, canceled: boolean) => {
      const gesture = galleryGesture;
      if (!gesture || gesture.pointerId !== event.pointerId || !galleryScroller || !galleryTrack) return;
      galleryGesture = null;
      galleryDragging = false;
      queueVisibleGalleryPanels();
      const threshold = Math.min(72, Math.max(36, galleryScroller.clientWidth * 0.08));
      if (!canceled && gesture.axis === 'horizontal' && gesture.deltaX <= -threshold) {
        const first = galleryTrack.firstElementChild;
        if (first instanceof HTMLElement && gesture.nextDistance > 0) {
          animateGalleryScroll(gesture.nextDistance, () => {
            galleryTrack.append(first);
            galleryScroller.scrollLeft = 0;
          });
          return;
        }
      }
      if (!canceled && gesture.axis === 'horizontal' && gesture.deltaX >= threshold && gesture.previousPanel) {
        animateGalleryScroll(0, () => {
          galleryScroller.scrollLeft = 0;
        });
        return;
      }
      if (gesture.previousPanel) {
        const previousPanel = gesture.previousPanel;
        animateGalleryScroll(gesture.previousDistance, () => {
          galleryTrack.append(previousPanel);
          galleryScroller.scrollLeft = 0;
        });
      } else if (galleryScroller.scrollLeft > 0) {
        animateGalleryScroll(0, () => {
          galleryScroller.scrollLeft = 0;
        });
      } else {
        syncGalleryMotion();
      }
    };
    galleryViewport.addEventListener('pointerup', event => finishGalleryGesture(event, false));
    galleryViewport.addEventListener('pointercancel', event => finishGalleryGesture(event, true));
    galleryViewport.addEventListener('lostpointercapture', event => finishGalleryGesture(event, true));


    if (typeof IntersectionObserver !== 'undefined') {
      refreshGalleryObservers();
    } else {
      galleryPanels.forEach(panel => panel.dataset.homeGalleryVisible = 'true');
      galleryFirstRevealDone = true;
    }
  } else if (galleryTrack) {
    if (!galleryTrack.hasAttribute('tabindex')) galleryTrack.tabIndex = 0;
  }
  function refreshGalleryObservers() {
    if (
      homeExperienceDisposed ||
      !galleryIsReady ||
      !galleryViewport ||
      !gallery ||
      typeof IntersectionObserver === 'undefined'
    ) return;
    galleryVisibilityObserver?.disconnect();
    gallerySectionObserver?.disconnect();
    galleryVisibilityObserver = new IntersectionObserver(entries => {
      if (homeExperienceDisposed) return;
      entries.forEach(entry => {
        const panel = entry.target as HTMLElement;
        const effectiveViewport = getEffectiveViewport();
        const galleryRect = galleryViewport.getBoundingClientRect();
        if (!galleryPanelIsVisible(panel, effectiveViewport, galleryRect)) {
          resetGalleryPanel(panel, effectiveViewport, galleryRect);
          return;
        }
        if (galleryDragging || panel.contains(document.activeElement)) {
          markGalleryPanelVisible(panel);
          return;
        }
        if (galleryInView && entry.intersectionRatio >= 0.1) queueGalleryReveal(panel);
      });
    }, { root: galleryViewport, threshold: 0.1 });
    galleryPanels.forEach(panel => galleryVisibilityObserver?.observe(panel));
    gallerySectionObserver = new IntersectionObserver(entries => {
      if (homeExperienceDisposed) return;
      entries.forEach(entry => {
        if (entry.target === gallery) {
          if (!entry.isIntersecting || !isRectEffectivelyVisible(
            gallery.getBoundingClientRect(),
            getEffectiveViewport(),
          )) {
            const effectiveViewport = getEffectiveViewport();
            const galleryRect = galleryViewport.getBoundingClientRect();
            galleryPanels.forEach(panel => resetGalleryPanel(panel, effectiveViewport, galleryRect));
          }
          return;
        }
        if (entry.target !== galleryViewport) return;
        const effectiveViewport = getEffectiveViewport();
        const viewportRect = galleryViewport.getBoundingClientRect();
        if (!isRectEffectivelyVisible(viewportRect, effectiveViewport)) {
          galleryPanels.forEach(panel => resetGalleryPanel(panel, effectiveViewport, viewportRect));
        }
        galleryInView = entry.isIntersecting &&
          entry.intersectionRatio >= 0.15 &&
          effectiveIntersectionRatio(galleryViewport) >= 0.15;
        if (galleryInView) queueVisibleGalleryPanels();
        if (!galleryInView && galleryTransition) finishGalleryTransition();
        syncGalleryMotion();
      });
    }, { threshold: [0, 0.15], rootMargin: `-${headerHeight}px 0px 0px 0px` });
    gallerySectionObserver.observe(gallery);
    gallerySectionObserver.observe(galleryViewport);
    galleryInView = effectiveIntersectionRatio(galleryViewport) >= 0.15;
    queueVisibleGalleryPanels();
  }

  function onGalleryResize() {
    cancelGalleryGesture();
    if (galleryTransition) finishGalleryTransition();
    if (galleryScroller) galleryScroller.scrollLeft = 0;
    queueVisibleGalleryPanels();
    syncGalleryMotion();
  }

  if (galleryPrev || galleryNext) syncGalleryMotion();


  const videoButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-home-video-toggle]'));
  const homeVideos = Array.from(root.querySelectorAll<HTMLVideoElement>('video[data-home-video][data-home-video-src]'));
  const videoGroups = new Map<HTMLElement, VideoGroup>();
  let videoObserver: IntersectionObserver | null = null;
  // Móvil: versión vertical (data-home-video-mobile-src), como el hero de Portfolio.
  const mobileVideo = matchMedia('(max-width: 767px)');
  // Hasta load + idle ningún vídeo pide su fuente ni la galería sus pósteres (data-poster): el póster de portada (LCP) va solo.
  let mediaReady = false;

  if (homeVideos.length && typeof IntersectionObserver !== 'undefined') {
    videoObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const sync = videoVisibility.get(entry.target as HTMLVideoElement);
        if (sync) sync(entry.isIntersecting);
      });
    }, { threshold: 0.1 });
  }

  const setGroupControlState = (group: VideoGroup) => {
    const playing = group.videos.some(video => !video.paused && !video.ended);
    const unavailable = group.videos.length > 0 && group.unavailableVideos.size === group.videos.length;
    group.container.dataset.homeVideoState = unavailable ? 'poster' : playing ? 'playing' : 'paused';
    if (hero?.contains(group.container)) {
      const moving = playing && !reduced.matches && !document.hidden;
      root.dataset.homeRecordingMotion = String(moving);
      if (moving) cameraMeterSimulation.start();
      else cameraMeterSimulation.stop();
    }
    if (!group.control) return;
    // El nombre accesible debe contener el texto visible del botón (WCAG 2.5.3): «Vídeo de portada» → «Pausar vídeo de portada».
    const visible = group.control.querySelector('span')?.textContent?.trim().toLowerCase();
    const noun = visible && visible.startsWith('vídeo') ? visible : 'vídeo';
    const label = playing ? `Pausar ${noun}` : unavailable ? 'Vídeo no disponible' : `Reproducir ${noun}`;
    group.control.hidden = false;
    group.control.disabled = unavailable;
    group.control.setAttribute('aria-label', label);
    group.control.setAttribute('aria-pressed', String(playing));
    group.control.title = label;
    group.control.querySelector<SVGPathElement>('svg path')?.setAttribute('d', playing ? 'M8 5v14M16 5v14' : 'm9 5 10 7-10 7Z');
  };

  homeVideos.forEach(video => {
    const source = video.dataset.homeVideoSrc;
    if (!source) return;
    const inGallery = Boolean(gallery?.contains(video));
    const control = videoButtons.find(button => {
      const id = button.getAttribute('aria-controls');
      const controlledContainer = id ? document.getElementById(id) : null;
      return controlledContainer !== null && root.contains(controlledContainer) && controlledContainer.contains(video);
    });
    const controlledContainer = control?.getAttribute('aria-controls')
      ? document.getElementById(control.getAttribute('aria-controls')!)
      : video.closest<HTMLElement>('[id]');
    const container = controlledContainer && root.contains(controlledContainer) ? controlledContainer : root;
    let group = videoGroups.get(container);
    if (!group) {
      group = {
        container,
        control,
        videos: [],
        synchronizers: [],
        userIntent: null,
        unavailableVideos: new Set<HTMLVideoElement>(),
      };
      videoGroups.set(container, group);
    }
    const videoGroup = group;
    videoGroup.videos.push(video);
    let inView = !videoObserver;
    let assignedSource = '';
    let playRequest = 0;

    video.muted = true;
    video.defaultMuted = true;
    video.setAttribute('muted', '');
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.loop = true;
    video.preload = 'none';

    const sync = () => {
      const request = ++playRequest;
      const shouldPlay = (reduced.matches || saveData() ? videoGroup.userIntent === true : videoGroup.userIntent ?? true) &&
        (!inGallery || !galleryUserPaused);
      if (!shouldPlay || !inView || document.hidden || videoGroup.unavailableVideos.has(video) || (!mediaReady && videoGroup.userIntent === null)) {
        video.pause();
        setGroupControlState(videoGroup);
        return;
      }
      const wanted = (mobileVideo.matches && video.dataset.homeVideoMobileSrc) || source;
      if (assignedSource !== wanted) {
        video.src = wanted;
        assignedSource = wanted;
      }
      void video.play().catch((error: unknown) => {
        if (request !== playRequest || (error instanceof DOMException && error.name === 'AbortError')) return;
        videoGroup.userIntent = false;
        videoGroup.synchronizers.forEach(syncVideo => syncVideo());
      });
    };

    videoVisibility.set(video, visible => {
      inView = visible;
      sync();
    });
    video.addEventListener('playing', () => setGroupControlState(videoGroup));
    video.addEventListener('pause', () => setGroupControlState(videoGroup));
    video.addEventListener('ended', () => setGroupControlState(videoGroup));
    video.addEventListener('error', () => {
      videoGroup.unavailableVideos.add(video);
      setGroupControlState(videoGroup);
    });
    reduced.addEventListener('change', sync);
    mobileVideo.addEventListener('change', sync);
    document.addEventListener('visibilitychange', sync);
    videoGroup.synchronizers.push(sync);
    videoSynchronizers.push(sync);
    if (videoObserver) videoObserver.observe(video);
    else sync();
  });

  videoGroups.forEach(group => {
    group.control?.addEventListener('click', () => {
      // Según el estado real, como Portfolio: antes de load + idle el vídeo aún no suena y pulsar debe reproducirlo.
      group.userIntent = !group.videos.some(video => !video.paused && !video.ended);
      group.synchronizers.forEach(sync => sync());
    });
    setGroupControlState(group);
  });
  afterLoadIdle(() => {
    if (homeExperienceDisposed) return;
    mediaReady = true;
    homeVideos.forEach(video => { if (video.dataset.poster) video.poster = video.dataset.poster; });
    videoSynchronizers.forEach(sync => sync());
  });

  root.dataset.homeEnhanced = 'true';
  root.dataset.homeScrollMode = 'native';
  root.toggleAttribute('data-home-reduced-motion', reduced.matches);

  function updateScroll(offsetY: number, virtual: boolean) {
    if (homeExperienceDisposed) return;
    scrollOffset = offsetY;
    const measurementModeChanged = measuredVirtualMode !== virtual;
    if (virtualMode !== virtual) setMode(virtual);
    if (measurementModeChanged) measureHero();
    const motionAllowed = !reduced.matches;
    const range = hero && heroStage && motionAllowed ? heroRange : 0;
    const pinY = Math.min(range, Math.max(0, offsetY - heroTop));
    const progress = range > 0 ? Math.min(1, pinY / heroRevealRange) : 1;
    if (progress !== lastProgress) {
      root.style.setProperty('--home-hero-progress', String(progress));
      lastProgress = progress;
    }
    updateHomeHeaderState(progress);
    if (hero && heroStage) {
      if (virtualMode && motionAllowed) {
        if (heroStage.style.position !== 'absolute') {
          heroStage.style.position = 'absolute';
          heroStage.style.top = '0';
          heroStage.style.left = '0';
          heroStage.style.width = '100%';
        }
        if (pinY !== lastPinY) {
          heroStage.style.transform = `translate3d(0, ${pinY}px, 0)`;
          heroStage.style.setProperty('--home-hero-pin-y', `${pinY}px`);
          lastPinY = pinY;
        }
      } else if (heroStage.style.position || heroStage.style.transform || lastPinY !== -1) {
        heroStage.style.position = '';
        heroStage.style.top = '';
        heroStage.style.left = '';
        heroStage.style.width = '';
        heroStage.style.transform = '';
        heroStage.style.removeProperty('--home-hero-pin-y');
        lastPinY = -1;
      }
    }

    // Sincronización de Servicios con Scroll
    if (servicesSec && servicesStage && servicesPinned && services.length > 1 && motionAllowed && servicesRange > 0) {
      const sPinY = Math.min(servicesRange, Math.max(0, offsetY - servicesTop));
      const serviceIndex = Math.min(services.length - 1, Math.floor((sPinY / servicesRange) * services.length));
      updateActiveService(serviceIndex);

      if (virtualMode) {
        // Reserve the header offset only once the section reaches it.
        const servicesStageTop = `${Math.min(headerHeight, Math.max(0, offsetY - servicesTop + headerHeight))}px`;
        if (servicesStage.style.position !== 'absolute') {
          servicesStage.style.position = 'absolute';
          servicesStage.style.left = '0';
          servicesStage.style.width = '100%';
        }
        if (servicesStage.style.top !== servicesStageTop) servicesStage.style.top = servicesStageTop;
        if (sPinY !== lastServicesPinY) {
          servicesStage.style.transform = `translate3d(0, ${sPinY}px, 0)`;
          lastServicesPinY = sPinY;
        }
      } else if (
        servicesStage.style.position ||
        servicesStage.style.transform ||
        lastServicesPinY !== -1
      ) {
        clearServicesStagePosition();
      }
    } else {
      clearServicesStagePosition();
    }
  }

  function setMode(virtual: boolean) {
    if (homeExperienceDisposed) return;
    const modeChanged = virtualMode !== virtual;
    if (modeChanged) {
      stopServiceScrollAnimation();
      virtualMode = virtual;
      configureServicesPin();
      updateServices();
    } else {
      virtualMode = virtual;
    }
    root.dataset.homeScrollMode = virtual ? 'virtual' : 'native';
    if (!virtual && heroStage) {
      heroStage.style.position = '';
      heroStage.style.top = '';
      heroStage.style.left = '';
      heroStage.style.width = '';
      heroStage.style.transform = '';
      heroStage.style.removeProperty('--home-hero-pin-y');
      lastPinY = -1;
    }
    if (!virtual) clearServicesStagePosition();
    if (modeChanged) {
      syncRevealVisibility();
      refreshRevealObserver();
      refreshGalleryObservers();
    }
  }

  const onResize = () => {
    if (homeExperienceDisposed) return;
    onGalleryResize();
    configureServicesPin();
    measureHero();
    if (servicesPinned) updateActiveService(serviceIndexAtOffset(scrollOffset));
    updateServices();
    syncRevealVisibility();
    refreshRevealObserver();
    refreshGalleryObservers();
    updateScroll(scrollOffset, virtualMode);
  };
  window.addEventListener('resize', onResize, { passive: true });
  let resizeObserver: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(responsiveRoot);
    if (hero) resizeObserver.observe(hero);
    if (galleryViewport) resizeObserver.observe(galleryViewport);
    if (servicesStage) resizeObserver.observe(servicesStage);
    if (servicesIntro) resizeObserver.observe(servicesIntro);
    if (servicesLayout) resizeObserver.observe(servicesLayout);
  }
  const onPageHide = (event: PageTransitionEvent) => {
    if (event.persisted) return;
    homeExperienceDisposed = true;
    revealObserver?.disconnect();
    gallerySectionObserver?.disconnect();
    galleryVisibilityObserver?.disconnect();
    videoObserver?.disconnect();
    resizeObserver?.disconnect();
    cameraMeterSimulation.dispose();
    document.removeEventListener('focusin', onKeyboardNavigation);
    window.removeEventListener('resize', onResize);
    reduced.removeEventListener('change', setReducedState);
    window.removeEventListener('pagehide', onPageHide);
    clearGalleryTimer();
    if (galleryRevealFrame !== null) cancelAnimationFrame(galleryRevealFrame);
    galleryRevealFrame = null;
    if (galleryTransition) cancelAnimationFrame(galleryTransition.frame);
    galleryTransition = null;
    activeReveals.forEach(animation => animation.cancel());
    revealAnimations.clear();
    activeReveals.clear();
    activeGalleryAnimations.forEach(animation => animation.cancel());
    activeGalleryAnimations.clear();
    galleryPendingReveals.clear();
  };
  window.addEventListener('pagehide', onPageHide);
  reduced.addEventListener('change', setReducedState);
  
  setReducedState();

  return { updateScroll, setMode };
}
