import { afterLoadIdle, saveData } from './data-saver';
const easing = 'cubic-bezier(.2,.8,.2,1)';
const hiddenOffset = 54;

type RevealKind = 'heading' | 'caption' | 'media';
type MotionDirection = 'above' | 'below';
type MotionTarget = 'hidden' | 'visible';
type MotionItem = {
  element: HTMLElement;
  kind: RevealKind;
  animation: Animation | null;
};
type MotionGroup = {
  wrapper: HTMLElement;
  project: ProjectState | null;
  items: MotionItem[];
  target: MotionTarget;
  direction: MotionDirection;
  hasEnteredExitBand: boolean;
};
type ProjectState = {
  article: HTMLElement;
  video: HTMLVideoElement;
  playButton: HTMLButtonElement | null;
  title: string;
  generation: number;
  manualOwned: boolean;
  attempts: Set<PreviewAttempt>;
  group: MotionGroup | null;
};
type PreviewAttempt = {
  project: ProjectState;
  generation: number;
  previousMuted: boolean;
  releasedVersion: number | null;
  started: boolean;
};
type ViewportBands = {
  top: number;
  bottom: number;
  entryTop: number;
  entryBottom: number;
  exitTop: number;
  exitBottom: number;
  entryRootMargin: string;
  exitRootMargin: string;
};

function kindFor(element: HTMLElement): RevealKind | null {
  const kind = element.dataset.portfolioReveal;
  return kind === 'heading' || kind === 'caption' || kind === 'media' ? kind : null;
}

function visibleFrame(kind: RevealKind): Keyframe {
  return kind === 'caption'
    ? { opacity: 1 }
    : { opacity: 1, transform: 'none', clipPath: 'inset(0)' };
}

function hiddenFrame(kind: RevealKind, direction: MotionDirection): Keyframe {
  if (kind === 'caption') return { opacity: 0 };
  // Las piezas del mosaico no se desplazan (abrirían huecos): se descubren en el sentido del recorrido.
  if (kind === 'media') {
    return { opacity: 0, transform: 'none', clipPath: direction === 'below' ? 'inset(100% 0 0 0)' : 'inset(0 0 100% 0)' };
  }
  const offset = direction === 'below' ? hiddenOffset : -hiddenOffset;
  const clipPath = direction === 'below' ? 'inset(16% 0 0 0)' : 'inset(0 0 16% 0)';
  return { opacity: 0, transform: `translateY(${offset}px)`, clipPath };
}

const staticTiming: OptionalEffectTiming = {
  duration: 1,
  delay: 0,
  easing,
  fill: 'both',
};

function timingFor(
  group: MotionGroup,
  item: MotionItem,
  target: MotionTarget,
  stagger: number,
): OptionalEffectTiming {
  const duration = item.kind === 'caption' ? 560 : 900;
  if (target === 'hidden') return { duration, delay: 0, easing, fill: 'both' };

  if (item.kind === 'heading') return { duration, delay: 0, easing, fill: 'both' };
  const delay = item.kind === 'caption' ? (group.project ? stagger + 160 : 180) : stagger;
  return { duration, delay, easing, fill: 'both' };
}
function initPortfolioHero(root: HTMLElement, reduced: MediaQueryList, signal: AbortSignal): () => void {
  const video = root.querySelector<HTMLVideoElement>('[data-portfolio-hero-video]');
  const button = root.querySelector<HTMLButtonElement>('[data-portfolio-hero-toggle]');
  if (!video || !button) return () => {};
  // El póster lo pinta el <picture> de Portfolio.astro (sin JS); aquí solo se elige la fuente.
  const desktopSource = video.dataset.homeVideoSrc;
  const mobile = matchMedia('(max-width: 767px)');
  // Sin fuente hasta load + idle (salvo que se pulse reproducir): la imagen de portada (LCP) carga sola.
  let mediaReady = false;
  let visible = false;
  let intent: boolean | null = null;
  let assignedSource = '';
  let request = 0;
  video.muted = true;
  video.defaultMuted = true;

  const updateControl = () => {
    const playing = !video.paused;
    button.setAttribute('aria-pressed', String(playing));
    const label = button.querySelector('span');
    if (label) label.textContent = playing ? 'Pausar vídeo' : 'Reproducir vídeo';
  };
  const sync = () => {
    const version = ++request;
    const source = mobile.matches ? video.dataset.portfolioMobileSrc : desktopSource;
    if (!(intent ?? !(reduced.matches || saveData())) || !visible || document.hidden || !source || (!mediaReady && intent === null)) {
      video.pause();
      return;
    }
    if (assignedSource !== source) {
      assignedSource = source;
      video.src = source;
    }
    void video.play().catch((error: unknown) => {
      if (version !== request || signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
      intent = false;
      updateControl();
    });
  };
  const observer = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(entries => {
    visible = entries.some(entry => entry.isIntersecting);
    sync();
  }, { threshold: 0 }) : null;
  if (observer) observer.observe(video);
  else visible = true;
  button.addEventListener('click', () => {
    intent = video.paused;
    sync();
  }, { signal });
  video.addEventListener('playing', updateControl, { signal });
  video.addEventListener('pause', updateControl, { signal });
  video.addEventListener('error', () => {
    intent = false;
    video.pause();
    video.removeAttribute('src');
    assignedSource = '';
    video.load();
    updateControl();
  }, { signal });
  reduced.addEventListener('change', () => { intent = null; sync(); }, { signal });
  mobile.addEventListener('change', sync, { signal });
  document.addEventListener('visibilitychange', sync, { signal });
  window.addEventListener('pageshow', sync, { signal });
  button.hidden = false;
  sync();
  afterLoadIdle(() => { mediaReady = true; if (!signal.aborted) sync(); });
  return () => { request += 1; observer?.disconnect(); video.pause(); };
}

export function initPortfolioExperience(root: HTMLElement, reduced: MediaQueryList): void {
  const controller = new AbortController();
  const signal = controller.signal;
  const disposeHero = initPortfolioHero(root, reduced, signal);
  // Pósteres de las tarjetas (data-poster) tras load + idle: no compiten con la imagen de portada (LCP).
  afterLoadIdle(() => {
    if (!signal.aborted) root.querySelectorAll<HTMLVideoElement>('video[data-poster]').forEach(video => { video.poster = video.dataset.poster ?? ''; });
  });
  const scrollViewport = document.getElementById('scroll-container');
  const header = document.querySelector<HTMLElement>('.header');

  const projects: ProjectState[] = [];
  const groups = new Map<HTMLElement, MotionGroup>();
  let activePreview: PreviewAttempt | null = null;
  let disposed = false;
  const intersectionAvailable = typeof IntersectionObserver !== 'undefined';
  const motionSupported = intersectionAvailable && typeof Element.prototype.animate === 'function';
  let motionStopped = !motionSupported || reduced.matches;
  let entryObserver: IntersectionObserver | null = null;
  let exitObserver: IntersectionObserver | null = null;
  let viewportClassObserver: MutationObserver | null = null;
  let observedVirtualMode = document.documentElement.classList.contains('has-smooth-scrollbar');

  function viewportBounds(): { top: number; bottom: number } {
    const height = window.innerHeight;
    let top = 0;
    let bottom = height;

    if (observedVirtualMode && scrollViewport) {
      const clipping = scrollViewport.getBoundingClientRect();
      top = Math.max(top, clipping.top);
      bottom = Math.min(bottom, clipping.bottom);
    }

    if (header) {
      const style = getComputedStyle(header);
      if (style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity) > 0
        && !header.classList.contains('header--hero-hidden')) {
        const bounds = header.getBoundingClientRect();
        if (bounds.top <= top + 1 && bounds.bottom > top) {
          top = Math.min(bottom, bounds.bottom);
        }
      }
    }

    return bottom > top ? { top, bottom } : { top: 0, bottom: height };
  }

  function viewportBands(): ViewportBands {
    const { top, bottom } = viewportBounds();
    const height = Math.max(1, bottom - top);
    const entryInset = Math.min(24, Math.max(0, (height - 1) / 2));
    const entryTop = top + entryInset;
    const entryBottom = bottom - entryInset;
    const exitTop = top;
    const exitBottom = bottom;
    const windowHeight = window.innerHeight;
    return {
      top,
      bottom,
      entryTop,
      entryBottom,
      exitTop,
      exitBottom,
      entryRootMargin: `${-Math.round(entryTop)}px 0px ${-Math.round(windowHeight - entryBottom)}px 0px`,
      exitRootMargin: `${-Math.round(exitTop)}px 0px ${-Math.round(windowHeight - exitBottom)}px 0px`,
    };
  }

  function intersectsVerticalBand(bounds: DOMRectReadOnly, top: number, bottom: number): boolean {
    return bounds.bottom > top
      && bounds.top < bottom
      && bounds.right > 0
      && bounds.left < window.innerWidth;
  }

  function insideVisibleArea(bounds: DOMRectReadOnly, bands = viewportBands()): boolean {
    return intersectsVerticalBand(bounds, bands.top, bands.bottom);
  }

  function outsideVisibleArea(bounds: DOMRectReadOnly, bands = viewportBands()): boolean {
    return !insideVisibleArea(bounds, bands);
  }

  function directionForBounds(
    bounds: DOMRectReadOnly,
    bands: ViewportBands,
    fallback: MotionDirection,
  ): MotionDirection {
    if (bounds.bottom <= bands.exitTop) return 'above';
    if (bounds.top >= bands.exitBottom) return 'below';
    return fallback;
  }

  function projectStagger(group: MotionGroup): number {
    const project = group.project;
    if (!project) return 0;
    let column = 0;
    for (const candidate of projects) {
      if (candidate === project) break;
      if (!candidate.article.hidden
        && candidate.article.offsetParent === project.article.offsetParent
        && Math.abs(candidate.article.offsetTop - project.article.offsetTop) < 1) {
        column += 1;
      }
    }
    return column * 100;
  }

  function isManualPlayback(project: ProjectState | null): boolean {
    return project !== null
      && project.manualOwned
      && !project.video.paused
      && activePreview?.project !== project;
  }

  function cancelGroup(group: MotionGroup): void {
    for (const item of group.items) {
      item.animation?.cancel();
      item.animation = null;
    }
  }

  function finishGroup(group: MotionGroup): void {
    cancelGroup(group);
    group.target = 'visible';
    const bands = viewportBands();
    group.hasEnteredExitBand = !group.wrapper.hidden
      && intersectsVerticalBand(group.wrapper.getBoundingClientRect(), bands.exitTop, bands.exitBottom);
  }

  function frameFromCurrentStyle(item: MotionItem): Keyframe {
    const style = getComputedStyle(item.element);
    if (item.kind === 'caption') return { opacity: Number(style.opacity) };
    return {
      opacity: Number(style.opacity),
      transform: style.transform,
      clipPath: style.clipPath,
    };
  }

  function applyItemFrames(
    item: MotionItem,
    frames: Keyframe[],
    timing: OptionalEffectTiming,
    play: boolean,
  ): void {
    let animation = item.animation;
    if (animation) {
      animation.cancel();
      const effect = animation.effect as KeyframeEffect | null;
      if (effect) {
        effect.setKeyframes(frames);
        effect.updateTiming(timing);
        animation.pause();
        animation.currentTime = 0;
        if (play) animation.play();
        return;
      }
      item.animation = null;
    }

    animation = item.element.animate(frames, timing);
    item.animation = animation;
    animation.addEventListener('finish', () => {
      if (item.animation === animation && animation.playState === 'finished') animation.pause();
    }, { signal });
    if (!play) {
      animation.pause();
      animation.currentTime = 0;
    }
  }

  function setHiddenStatic(group: MotionGroup, direction: MotionDirection): void {
    if (motionStopped || group.wrapper.hidden) {
      finishGroup(group);
      return;
    }
    if (group.target === 'hidden' && group.direction === direction) return;
    group.target = 'hidden';
    group.direction = direction;
    for (const item of group.items) {
      const frame = hiddenFrame(item.kind, direction);
      applyItemFrames(item, [frame, frame], staticTiming, false);
    }
  }

  function transitionGroup(
    group: MotionGroup,
    target: MotionTarget,
    direction: MotionDirection = group.direction,
  ): void {
    if (group.wrapper.hidden) {
      finishGroup(group);
      return;
    }
    if (motionStopped || !motionSupported) {
      finishGroup(group);
      return;
    }
    if (group.wrapper.contains(document.activeElement)
      || isManualPlayback(group.project)
      || activePreview?.project === group.project) {
      finishGroup(group);
      return;
    }
    if (target === 'visible') group.hasEnteredExitBand = true;
    else group.hasEnteredExitBand = false;
    if (group.target === target) {
      if (target === 'hidden' && direction !== group.direction
        && outsideVisibleArea(group.wrapper.getBoundingClientRect())) {
        setHiddenStatic(group, direction);
      }
      return;
    }

    group.target = target;
    group.direction = direction;
    const stagger = target === 'visible' ? projectStagger(group) : 0;
    for (const item of group.items) {
      const current = frameFromCurrentStyle(item);
      const next = target === 'visible' ? visibleFrame(item.kind) : hiddenFrame(item.kind, direction);
      applyItemFrames(item, [current, next], timingFor(group, item, target, stagger), true);
    }
  }

  function armOutside(group: MotionGroup): void {
    if (motionStopped || group.wrapper.hidden || activePreview?.project === group.project) return;
    const bounds = group.wrapper.getBoundingClientRect();
    const bands = viewportBands();
    if (group.wrapper.contains(document.activeElement) || isManualPlayback(group.project)) return;
    if (intersectsVerticalBand(bounds, bands.exitTop, bands.exitBottom)) {
      group.hasEnteredExitBand = true;
      return;
    }
    transitionGroup(group, 'hidden', directionForBounds(bounds, bands, group.direction));
  }

  function syncObservers(): void {
    entryObserver?.disconnect();
    exitObserver?.disconnect();
    entryObserver = null;
    exitObserver = null;
    if (motionStopped || !motionSupported || disposed) {
      return;
    }

    const bands = viewportBands();
    entryObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const group = groups.get(entry.target as HTMLElement);
        if (!group || group.wrapper.hidden) continue;
        const bounds = group.wrapper.getBoundingClientRect();
        if (!entry.isIntersecting
          || !intersectsVerticalBand(bounds, bands.entryTop, bands.entryBottom)) continue;
        group.hasEnteredExitBand = true;
        if (group.wrapper.contains(document.activeElement) || isManualPlayback(group.project)) {
          finishGroup(group);
          continue;
        }
        transitionGroup(group, 'visible');
      }
    }, { threshold: 0, rootMargin: bands.entryRootMargin });
    exitObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const group = groups.get(entry.target as HTMLElement);
        if (!group || group.wrapper.hidden) continue;
        const bounds = group.wrapper.getBoundingClientRect();
        if (intersectsVerticalBand(bounds, bands.exitTop, bands.exitBottom)) {
          group.hasEnteredExitBand = true;
          continue;
        }
        if (entry.isIntersecting) continue;
        if (!group.hasEnteredExitBand) continue;
        group.hasEnteredExitBand = false;
        if (activePreview?.project === group.project && outsideVisibleArea(bounds, bands)) stopPreview();
        if (group.wrapper.contains(document.activeElement) || isManualPlayback(group.project)) {
          finishGroup(group);
          continue;
        }
        transitionGroup(group, 'hidden', directionForBounds(bounds, bands, group.direction));
      }
    }, {
      threshold: 0,
      rootMargin: bands.exitRootMargin,
    });

    for (const group of groups.values()) {
      if (group.items.length === 0 || group.wrapper.hidden) continue;
      entryObserver.observe(group.wrapper);
      exitObserver.observe(group.wrapper);
    }
  }

  function resetPreviewFrame(video: HTMLVideoElement): void {
    if (video.readyState === 0 || !Number.isFinite(video.duration) || video.duration <= 0) return;
    try {
      video.currentTime = 0;
    } catch {
      // Some media sources cannot seek back to their first frame.
    }
  }
  function updatePlayButton(project: ProjectState): void {
    if (!project.playButton) return;
    const isPlayingManual = !project.video.paused && project.manualOwned && activePreview?.project !== project;
    project.playButton.setAttribute('aria-pressed', isPlayingManual ? 'true' : 'false');
    const label = project.playButton.querySelector('[data-portfolio-play-label]');
    if (label) label.textContent = isPlayingManual ? 'Pausar' : activePreview?.project === project ? 'Ver vídeo' : 'Reproducir';
    const baseLabel = project.title ? `muestra de ${project.title}` : 'vídeo';
    project.playButton.setAttribute(
      'aria-label',
      isPlayingManual ? `Pausar ${baseLabel}` : `Reproducir ${baseLabel}`
    );
  }

  function toggleManualPlay(project: ProjectState): void {
    project.video.controls = true;
    if (activePreview) {
      const isCurrentPreview = activePreview.project === project;
      if (isCurrentPreview) {
        const attempt = activePreview;
        activePreview = null;
        attempt.releasedVersion = ++project.generation;
        const generation = project.generation;
        project.article.classList.remove('is-previewing');
        project.manualOwned = true;
        project.video.muted = false;
        if (project.video.paused) {
          void project.video.play().catch(() => {
            if (disposed || project.generation !== generation) return;
            project.manualOwned = false;
            updatePlayButton(project);
          });
        }
        updatePlayButton(project);
        if (project.group) finishGroup(project.group);
        return;
      }
      stopPreview();
    }

    if (!project.video.paused && project.manualOwned) {
      project.generation += 1;
      project.video.pause();
      project.manualOwned = false;
    } else {
      const generation = ++project.generation;
      project.manualOwned = true;
      project.video.muted = false;
      void project.video.play().catch(() => {
        if (disposed || project.generation !== generation) return;
        project.manualOwned = false;
        updatePlayButton(project);
      });
    }
    updatePlayButton(project);
    if (project.group) finishGroup(project.group);
  }

  function pauseStaleAttempt(attempt: PreviewAttempt): void {
    const project = attempt.project;
    if (attempt.releasedVersion === null
      || project.generation !== attempt.releasedVersion
      || project.manualOwned
      || activePreview?.project === project
      || project.video.paused) return;
    project.video.pause();
    resetPreviewFrame(project.video);
  }

  function releasePreview(attempt: PreviewAttempt, pauseVideo: boolean, returnToStart = pauseVideo): void {
    if (activePreview !== attempt) return;
    activePreview = null;
    attempt.releasedVersion = ++attempt.project.generation;
    attempt.project.article.classList.remove('is-previewing');
    if (pauseVideo && !attempt.project.video.paused) attempt.project.video.pause();
    attempt.project.video.muted = attempt.previousMuted;
    if (returnToStart && attempt.project.video.paused) resetPreviewFrame(attempt.project.video);
    updatePlayButton(attempt.project);
  }

  function settlePreview(attempt: PreviewAttempt, played: boolean): void {
    const project = attempt.project;
    project.attempts.delete(attempt);
    if (activePreview === attempt && project.generation === attempt.generation) {
      if (played && !project.video.paused) {
        attempt.started = true;
        project.article.classList.add('is-previewing');
        updatePlayButton(project);
      } else {
        releasePreview(attempt, true);
      }
      return;
    }
    if (played) pauseStaleAttempt(attempt);
  }

  function stopPreview(): void {
    if (activePreview) releasePreview(activePreview, true);
  }

  function startPreview(project: ProjectState): void {
    if (disposed || reduced.matches || !intersectionAvailable) return;
    if (activePreview?.project === project) return;
    stopPreview();

    if (!project.video.paused) {
      project.manualOwned = true;
      return;
    }

    project.manualOwned = false;
    const attempt: PreviewAttempt = {
      project,
      generation: ++project.generation,
      previousMuted: project.video.muted,
      releasedVersion: null,
      started: false,
    };
    project.attempts.add(attempt);
    activePreview = attempt;
    project.video.muted = true;

    let playback: Promise<void>;
    try {
      playback = project.video.play();
    } catch {
      settlePreview(attempt, false);
      return;
    }
    void playback.then(
      () => settlePreview(attempt, true),
      () => settlePreview(attempt, false),
    );
  }


  function onVideoPlay(project: ProjectState): void {
    if (activePreview?.project === project) return;
    let staleAttempt = false;
    for (const attempt of project.attempts) {
      if (attempt.releasedVersion !== null && attempt.releasedVersion === project.generation) {
        staleAttempt = true;
        break;
      }
    }
    if (staleAttempt && !project.manualOwned) {
      if (!project.video.paused) {
        project.video.pause();
        resetPreviewFrame(project.video);
      }
      return;
    }
    project.manualOwned = true;
    updatePlayButton(project);
  }

  function onVideoPause(project: ProjectState): void {
    if (!project.video.paused) return;
    const attempt = activePreview?.project === project ? activePreview : null;
    if (attempt && !attempt.started) return;
    if (attempt) releasePreview(attempt, false, true);
    project.manualOwned = false;
    if (project.group) armOutside(project.group);
    updatePlayButton(project);
  }

  function onVideoEnded(project: ProjectState): void {
    if (!project.video.ended) return;
    if (activePreview?.project === project) releasePreview(activePreview, false, true);
    project.manualOwned = false;
    if (project.group) armOutside(project.group);
    updatePlayButton(project);
  }

  function onFocusIn(event: FocusEvent): void {
    if (!(event.target instanceof Element)) return;
    const wrapper = event.target.closest<HTMLElement>('[data-portfolio-motion]');
    const group = wrapper ? groups.get(wrapper) : undefined;
    if (group && root.contains(wrapper)) {
      finishGroup(group);
    }

    const button = event.target.closest<HTMLButtonElement>('[data-portfolio-play]');
    if (button?.matches(':focus-visible')) {
      for (const project of projects) {
        if (project.playButton === button && activePreview?.project === project) {
          stopPreview();
          break;
        }
      }
    }
  }

  function onFocusOut(event: FocusEvent): void {
    if (!(event.target instanceof Element)) return;
    const wrapper = event.target.closest<HTMLElement>('[data-portfolio-motion]');
    const group = wrapper ? groups.get(wrapper) : undefined;
    if (!group || (event.relatedTarget instanceof Node && wrapper?.contains(event.relatedTarget))) return;
    queueMicrotask(() => armOutside(group));
  }

  function seedInitialMotionGroups(): void {
    if (motionStopped || !motionSupported) return;
    const bands = viewportBands();
    for (const group of groups.values()) {
      if (group.items.length === 0) continue;
      if (group.wrapper.hidden) {
        finishGroup(group);
        continue;
      }

      const bounds = group.wrapper.getBoundingClientRect();
      const direction = directionForBounds(bounds, bands, 'below');
      group.hasEnteredExitBand = intersectsVerticalBand(bounds, bands.exitTop, bands.exitBottom);
      if (group.wrapper.contains(document.activeElement)
        || isManualPlayback(group.project)
        || activePreview?.project === group.project) {
        finishGroup(group);
        continue;
      }

      if (insideVisibleArea(bounds, bands)) {
        setHiddenStatic(group, direction);
        group.hasEnteredExitBand = true;
        transitionGroup(group, 'visible', direction);
      } else {
        setHiddenStatic(group, direction);
      }
    }
  }

  function seedRestoredMotionGroups(): void {
    if (motionStopped || !motionSupported) return;
    const bands = viewportBands();
    for (const group of groups.values()) {
      if (group.items.length === 0) continue;
      if (group.wrapper.hidden) {
        finishGroup(group);
        continue;
      }

      const bounds = group.wrapper.getBoundingClientRect();
      const visible = insideVisibleArea(bounds, bands);
      const focused = group.wrapper.contains(document.activeElement);
      const inUse = isManualPlayback(group.project) || activePreview?.project === group.project;
      if (visible || focused || inUse) {
        finishGroup(group);
        continue;
      }
      setHiddenStatic(group, directionForBounds(bounds, bands, group.direction));
    }
  }

  function onPreferenceChange(): void {
    stopPreview();
    if (reduced.matches) {
      motionStopped = true;
      syncObservers();
      for (const group of groups.values()) finishGroup(group);
      return;
    }
    if (!motionSupported) return;
    motionStopped = false;
    seedRestoredMotionGroups();
    syncObservers();
  }

  function onViewportResize(): void {
    syncObservers();
  }

  function onViewportModeChange(): void {
    const nextVirtualMode = document.documentElement.classList.contains('has-smooth-scrollbar');
    if (nextVirtualMode === observedVirtualMode) return;
    observedVirtualMode = nextVirtualMode;
    syncObservers();
  }

  function onPageHide(event: PageTransitionEvent): void {
    stopPreview();
    if (!event.persisted) dispose();
  }


  function dispose(): void {
    if (disposed) return;
    disposed = true;
    disposeHero();
    stopPreview();
    entryObserver?.disconnect();
    exitObserver?.disconnect();
    viewportClassObserver?.disconnect();
    for (const group of groups.values()) cancelGroup(group);
    for (const project of projects) {
      project.video.controls = true;
      if (project.playButton) project.playButton.hidden = true;
    }
    root.classList.remove('portfolio-enhanced');
    controller.abort();
  }

  for (const article of root.querySelectorAll<HTMLElement>('[data-portfolio-project]')) {
    const media = article.querySelector<HTMLElement>('.portfolio-project-media[data-portfolio-reveal="media"]');
    const video = media?.querySelector<HTMLVideoElement>('.portfolio-project-video');
    if (!media || !video) continue;
    const playButton = media.querySelector<HTMLButtonElement>('[data-portfolio-play]');
    const title = article.querySelector<HTMLElement>('h2, [data-portfolio-reveal="heading"]')?.textContent?.trim() ?? '';

    video.controls = false;
    if (playButton) {
      playButton.hidden = false;
      playButton.setAttribute('aria-pressed', 'false');
      const baseLabel = title ? `muestra de ${title}` : 'vídeo';
      playButton.setAttribute('aria-label', `Reproducir ${baseLabel}`);
    }

    projects.push({
      article,
      video,
      playButton,
      title,
      generation: 0,
      manualOwned: false,
      attempts: new Set(),
      group: null,
    });
  }

  const projectByArticle = new Map<HTMLElement, ProjectState>();
  for (const project of projects) projectByArticle.set(project.article, project);
  for (const wrapper of root.querySelectorAll<HTMLElement>('[data-portfolio-motion]')) {
    const project = projectByArticle.get(wrapper) ?? null;
    const items: MotionItem[] = [];
    for (const element of wrapper.querySelectorAll<HTMLElement>('[data-portfolio-reveal]')) {
      const kind = kindFor(element);
      if (!kind) continue;
      items.push({ element, kind, animation: null });
    }
    const group: MotionGroup = {
      wrapper,
      project,
      items,
      target: 'visible',
      direction: 'below',
      hasEnteredExitBand: false,
    };
    groups.set(wrapper, group);
    if (project) project.group = group;
  }

  root.addEventListener('focusin', onFocusIn, { signal });
  root.addEventListener('focusout', onFocusOut, { signal });
  reduced.addEventListener('change', onPreferenceChange, { signal });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stopPreview();
  }, { signal });
  window.addEventListener('blur', stopPreview, { signal });
  window.addEventListener('pagehide', onPageHide, { signal });
  window.addEventListener('resize', onViewportResize, { signal });

  if (motionSupported && typeof MutationObserver !== 'undefined') {
    viewportClassObserver = new MutationObserver(onViewportModeChange);
    viewportClassObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  }

  for (const project of projects) {
    project.article.addEventListener('pointerenter', event => {
      if (event.pointerType !== 'mouse' || reduced.matches || disposed || !intersectionAvailable) return;

      startPreview(project);
    }, { signal });
    project.article.addEventListener('pointerleave', event => {
      if (event.pointerType !== 'mouse' || activePreview?.project !== project) return;
      releasePreview(activePreview, true);
    }, { signal });
    if (project.playButton) {
      project.playButton.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        toggleManualPlay(project);
      }, { signal });
      project.playButton.addEventListener('keydown', event => {
        if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
      }, { signal });
    }
    project.video.addEventListener('play', () => onVideoPlay(project), { signal });
    project.video.addEventListener('pause', () => onVideoPause(project), { signal });
    project.video.addEventListener('ended', () => onVideoEnded(project), { signal });
  }

  seedInitialMotionGroups();
  syncObservers();


  root.classList.add('portfolio-enhanced');
}
