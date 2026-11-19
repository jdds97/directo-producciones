// Continuidad entre secciones, ligada al desplazamiento real: cada sección expone `--sp` (0..1) según dónde está su borde
// superior en pantalla, así que subir deshace exactamente lo que bajar hizo (a diferencia de una entrada que se dispara
// una vez). Un único bucle rAF, activo solo mientras algún bloque es visible. Los estados "ocultos" solo existen en
// m4-transitions.css bajo html[data-m-ready] y prefers-reduced-motion: no-preference; sin JS, con movimiento reducido o
// tras un fallo el contenido queda completo y visible (--sp vale 1 por defecto).
// Las páginas con experiencia propia (Inicio, Quiénes somos, Portfolio, líneas de servicio) solo reciben lo que no
// pisa su coreografía: pie y cierre CTA.
type Mode = 'hero' | 'section' | 'cta' | 'footer';
interface Target { el: HTMLElement; mode: Mode }

const clamp = (n: number) => Math.min(1, Math.max(0, n));

function collect(): Target[] {
  const root = document.getElementById('contenido');
  if (!root) return [];
  const own = Boolean(root.querySelector('[data-home-experience], [data-about-experience], [data-portfolio-experience]'));
  const line = Boolean(root.querySelector('[data-services-experience]'));
  const targets: Target[] = [];
  const main = root.querySelector<HTMLElement>(':scope > main');
  if (main && !own) {
    const blocks = [...main.children].filter((el): el is HTMLElement => el instanceof HTMLElement && !el.matches('nav, script, noscript, style'));
    blocks.forEach((el, index) => {
      if (el.matches('.contact')) targets.push({ el, mode: 'cta' });
      else if (line) return;
      else if (index === 0) { if (el.querySelector('h1')) targets.push({ el, mode: 'hero' }); }
      else targets.push({ el, mode: 'section' });
    });
  }
  const footer = document.querySelector<HTMLElement>('#scroll-container > .footer, #scroll-container > footer');
  if (footer && !document.body.classList.contains('has-home-experience')) targets.push({ el: footer, mode: 'footer' });
  return targets;
}

function tag({ el, mode }: Target) {
  el.dataset.m = mode;
  if (mode === 'hero') {
    // El texto se despega suavemente de la foto/retícula al bajar; el fondo de la portada no se mueve.
    const copy = el.querySelector('h1')?.parentElement;
    if (copy && copy !== el) copy.dataset.mHero = '';
    return;
  }
  if (mode === 'cta') return;
  let list: Element[] = [...el.children];
  if (list.length === 1 && list[0].children.length > 1) list = [...list[0].children];
  list.filter((c): c is HTMLElement => c instanceof HTMLElement && !c.matches('script, style')).slice(0, 6)
    .forEach((c, i) => { c.dataset.mItem = ''; c.style.setProperty('--i', String(i)); });
}

function progress({ el, mode }: Target, vh: number): number {
  const rect = el.getBoundingClientRect();
  if (mode === 'hero') return clamp(-rect.top / Math.max(rect.height, 1));
  return clamp((vh * .96 - rect.top) / (vh * (mode === 'cta' ? .5 : mode === 'footer' ? .2 : .34)));
}

export function initSectionMotion(reduced: MediaQueryList): void {
  if (typeof IntersectionObserver === 'undefined') return;
  const targets = collect();
  if (!targets.length) return;
  let io: IntersectionObserver | null = null;
  let frame = 0;
  const visible = new Set<Target>();
  const byEl = new Map(targets.map(t => [t.el, t]));
  const write = (t: Target, vh: number) => {
    const value = progress(t, vh).toFixed(3);
    if (t.el.style.getPropertyValue('--sp') !== value) t.el.style.setProperty('--sp', value);
  };
  const tick = () => {
    frame = 0;
    const vh = innerHeight;
    for (const t of visible) write(t, vh);
    if (visible.size) frame = requestAnimationFrame(tick);
  };
  const start = () => {
    if (io || reduced.matches) return;
    try {
      targets.forEach(tag);
      const vh = innerHeight;
      targets.forEach(t => write(t, vh)); // estado correcto de todo (también lo que queda fuera de vista) antes de ocultar nada
      io = new IntersectionObserver(entries => {
        for (const entry of entries) {
          const t = byEl.get(entry.target as HTMLElement);
          if (!t) continue;
          if (entry.isIntersecting) visible.add(t);
          else { visible.delete(t); t.el.style.setProperty('--sp', entry.boundingClientRect.top < 0 ? '1' : '0'); } // al salir queda en su valor final: 1 por arriba, 0 por abajo
        }
        if (visible.size && !frame) frame = requestAnimationFrame(tick);
      });
      targets.forEach(t => io!.observe(t.el));
      document.documentElement.setAttribute('data-m-ready', '');
    } catch (error) {
      console.error('Movimiento entre secciones desactivado.', error);
      stop();
    }
  };
  const stop = () => {
    io?.disconnect();
    io = null;
    visible.clear();
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    document.documentElement.removeAttribute('data-m-ready');
    for (const t of targets) t.el.style.removeProperty('--sp');
  };
  start();
  reduced.addEventListener('change', () => (reduced.matches ? stop() : start()));
  // bfcache: la página congelada se reanuda con sus observadores; solo se rearma si se había parado.
  addEventListener('pageshow', event => { if (event.persisted && !io) start(); });
}
