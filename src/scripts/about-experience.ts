const easing = 'cubic-bezier(.2,.8,.2,1)';

export function initAboutExperience(root: HTMLElement, reduced: MediaQueryList): ((offsetY: number) => void) | null {
  if (reduced.matches || typeof IntersectionObserver === 'undefined' || typeof Element.prototype.animate === 'undefined') return null;

  const active = new Map<HTMLElement, Animation>();
  const armed = new Set<HTMLElement>();
  const scrollViewport = document.getElementById('scroll-container');
  const hero = root.querySelector<HTMLElement>('[data-about-hero]');
  const photos = Array.from(root.querySelectorAll<HTMLElement>('[data-about-parallax]'), image => ({
    image,
    frame: image.parentElement!,
    top: 0,
    height: 0,
    progress: -1,
  }));
  const revealFrames: Keyframe[] = [
    { opacity: 0, transform: 'translateY(40px)' },
    { opacity: 1, transform: 'translateY(0)' },
  ];
  const photoFrames: Keyframe[] = [
    { opacity: 0, transform: 'translateY(40px) scale(1.08)' },
    { opacity: 1, transform: 'translateY(0) scale(1)' },
  ];
  const photoLeftFrames: Keyframe[] = [
    { opacity: 0, transform: 'translateX(-60px) scale(1.04)' },
    { opacity: 1, transform: 'translateX(0) scale(1)' },
  ];
  const photoRightFrames: Keyframe[] = [
    { opacity: 0, transform: 'translateX(60px) scale(1.04)' },
    { opacity: 1, transform: 'translateX(0) scale(1)' },
  ];
  const revealFromAboveFrames: Keyframe[] = [
    { opacity: 0, transform: 'translateY(-40px)' },
    { opacity: 1, transform: 'translateY(0)' },
  ];
  const photoFromAboveFrames: Keyframe[] = [
    { opacity: 0, transform: 'translateY(-40px) scale(1.08)' },
    { opacity: 1, transform: 'translateY(0) scale(1)' },
  ];
  let stopped = false;
  let pendingFrame = 0;
  let offsetY = 0;
  let metricsDirty = true;
  let viewportHeight = 0;
  let desktop = false;

  const clamp = (value: number): number => Math.max(0, Math.min(1, value));

  function framesFor(target: HTMLElement, fromAbove = false): Keyframe[] {
    const kind = target.dataset.aboutReveal;
    if (kind === 'photo-left') return photoLeftFrames;
    if (kind === 'photo-right') return photoRightFrames;
    if (kind === 'photo') return fromAbove ? photoFromAboveFrames : photoFrames;
    return fromAbove ? revealFromAboveFrames : revealFrames;
  }

  function layoutTop(element: HTMLElement): number {
    let top = 0;
    let current: HTMLElement | null = element;
    while (current) {
      top += current.offsetTop;
      current = current.offsetParent as HTMLElement | null;
    }
    return top;
  }

  function measure(): void {
    viewportHeight = window.innerHeight;
    desktop = window.innerWidth >= 768;
    for (const photo of photos) {
      photo.top = layoutTop(photo.frame);
      photo.height = photo.frame.offsetHeight;
      photo.progress = -1;
    }
    metricsDirty = false;
  }

  function render(): void {
    pendingFrame = 0;
    if (stopped || reduced.matches) return;
    if (metricsDirty) measure();

    for (const photo of photos) {
      if (!desktop) {
        if (photo.progress !== 0) {
          photo.image.style.removeProperty('transform');
          photo.progress = 0;
        }
        continue;
      }
      const progress = clamp((offsetY + viewportHeight - photo.top) / (viewportHeight + photo.height));
      if (progress === photo.progress) continue;
      photo.progress = progress;
      const shift = (0.5 - progress) * photo.height * 0.12;
      photo.image.style.transform = `translate3d(0,${shift}px,0) scale(1.14)`;
    }
  }

  function updateScroll(nextOffsetY: number): void {
    if (stopped || (nextOffsetY === offsetY && !metricsDirty)) return;
    offsetY = nextOffsetY;
    if (pendingFrame) cancelAnimationFrame(pendingFrame);
    render();
  }

  function invalidateMetrics(): void {
    metricsDirty = true;
    if (!stopped && !pendingFrame) pendingFrame = requestAnimationFrame(render);
  }

  function prepare(target: HTMLElement, frames: Keyframe[], duration: number, delay = 0): Animation {
    const animation = target.animate(frames, { duration, delay, easing, fill: 'both' });
    animation.pause();
    animation.currentTime = 0;
    active.set(target, animation);
    animation.addEventListener('finish', () => {
      if (animation.playState === 'finished') animation.pause();
    });
    return animation;
  }

  const observer = new IntersectionObserver(entries => {
    let personOrder = 0;
    for (const entry of entries) {
      if (!entry.isIntersecting || !armed.has(entry.target as HTMLElement)) continue;
      const target = entry.target as HTMLElement;
      const animation = active.get(target);
      if (!animation || stopped || reduced.matches) continue;
      armed.delete(target);
      if (target.contains(document.activeElement)) {
        animation.finish();
        continue;
      }
      if (target.dataset.aboutReveal === 'person') {
        animation.effect?.updateTiming({ delay: Math.min(personOrder++, 3) * 70 });
      }
      animation.play();
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -24px 0px' });

  function armOutside(target: HTMLElement, bounds: DOMRectReadOnly): void {
    if (stopped || target.contains(document.activeElement)) return;
    const visibleTop = document.documentElement.classList.contains('has-smooth-scrollbar')
      ? Math.max(0, scrollViewport?.getBoundingClientRect().top ?? 0)
      : 0;
    const fromAbove = bounds.bottom <= visibleTop;
    if (!fromAbove && bounds.top < window.innerHeight) return;
    const animation = active.get(target);
    if (!animation) return;
    animation.pause();
    (animation.effect as KeyframeEffect).setKeyframes(framesFor(target, fromAbove));
    animation.currentTime = 0;
    armed.add(target);
  }

  // Rearm beyond the visible viewport, not when a reveal threshold flickers.
  const exitObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) armOutside(entry.target as HTMLElement, entry.boundingClientRect);
    }
  }, { threshold: 0, rootMargin: '80px 0px 80px 0px' });

  function finishFocusedTarget(event: FocusEvent): void {
    if (!(event.target instanceof Element)) return;
    const target = event.target.closest<HTMLElement>('[data-about-reveal]');
    if (!target || !root.contains(target)) return;
    armed.delete(target);
    active.get(target)?.finish();
  }

  function rearmAfterFocus(event: FocusEvent): void {
    if (!(event.target instanceof Element)) return;
    const target = event.target.closest<HTMLElement>('[data-about-reveal]');
    if (!target || (event.relatedTarget instanceof Node && target.contains(event.relatedTarget))) return;
    queueMicrotask(() => armOutside(target, target.getBoundingClientRect()));
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(pendingFrame);
    observer.disconnect();
    exitObserver.disconnect();
    resizeObserver?.disconnect();
    for (const animation of active.values()) animation.cancel();
    active.clear();
    armed.clear();
    for (const photo of photos) photo.image.style.removeProperty('transform');
    reduced.removeEventListener('change', onPreferenceChange);
    root.removeEventListener('focusin', finishFocusedTarget);
    root.removeEventListener('focusout', rearmAfterFocus);
    window.removeEventListener('resize', invalidateMetrics);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
  }

  function onPreferenceChange(): void {
    // Leave the final static composition in place; do not replay it on restore.
    if (reduced.matches) stop();
  }

  function onPageHide(event: PageTransitionEvent): void {
    // BFCache freezes the live document; keep its observers and progress intact.
    if (!event.persisted) stop();
  }

  function onPageShow(event: PageTransitionEvent): void {
    if (event.persisted) invalidateMetrics();
  }

  const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(invalidateMetrics);
  resizeObserver?.observe(root);
  root.querySelectorAll<HTMLElement>('[data-about-reveal]').forEach(target => {
    const kind = target.dataset.aboutReveal;
    const isHero = Boolean(hero?.contains(target));
    const frames = framesFor(target);
    const duration = kind?.startsWith('photo') ? 1100 : kind === 'person' ? 720 : 1000;
    prepare(target, frames, duration, isHero ? (kind === 'title' ? 80 : 180) : 0);
    armed.add(target);
    observer.observe(target);
    exitObserver.observe(target);
  });
  root.addEventListener('focusin', finishFocusedTarget);
  root.addEventListener('focusout', rearmAfterFocus);
  reduced.addEventListener('change', onPreferenceChange);
  window.addEventListener('resize', invalidateMetrics, { passive: true });
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
  void document.fonts.ready.then(() => { if (!stopped) invalidateMetrics(); });
  return updateScroll;
}
