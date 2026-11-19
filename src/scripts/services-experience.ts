// Movimiento reversible: cada grupo entra al aparecer y vuelve a su estado de espera al salir
// del viewport (por arriba o por abajo), así que se repite al bajar y al subir.
// Los estados ocultos solo existen en CSS bajo prefers-reduced-motion: no-preference y con
// [data-services-ready]; sin JS o con movimiento reducido todo queda visible y completo.
export function initServicesExperience(root: HTMLElement): void {
  if (typeof IntersectionObserver === 'undefined') return;
  // El cierre compartido (ProjectCTA) también entra por piezas en estas páginas.
  for (const cta of root.querySelectorAll<HTMLElement>(':scope > .contact')) cta.setAttribute('data-service-reveal', 'stagger');
  root.setAttribute('data-services-ready', '');
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const element = entry.target as HTMLElement;
      const state = element.hasAttribute('data-service-graphic') ? 'is-illustrated' : 'is-in';
      if (entry.isIntersecting && entry.intersectionRatio >= .01) {
        // Una foto no se revela hasta tener el bitmap decodificado: la transición de 900 ms no corre sobre un hueco vacío.
        const img = element.querySelector<HTMLImageElement>(':scope > img');
        if (img && !img.complete) {
          // Una imagen diferida (loading=lazy) recortada al 100 % por el estado de espera puede no empezar a cargar nunca y decode()
          // no resolvería: ya está en pantalla, así que se pide de inmediato.
          img.loading = 'eager';
          element.dataset.serviceWant = '';
          const show = () => { if ('serviceWant' in element.dataset) element.classList.add(state); };
          img.decode().then(show, show);
        } else element.classList.add(state);
      } else if (!entry.isIntersecting) {
        delete element.dataset.serviceWant;
        // Ya fuera de vista: se rearma sin destellos y recuerda por dónde volverá a entrar.
        element.classList.remove(state);
        element.dataset.serviceFrom = entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0) ? 'above' : 'below';
      }
    }
  }, { threshold: [0, .01] });
  for (const element of root.querySelectorAll<HTMLElement>('[data-service-reveal], [data-service-graphic]')) observer.observe(element);
  // El scroll virtual de escritorio consume Espacio: el FAQ (details/summary) debe abrirse con él.
  root.addEventListener('keydown', event => {
    if ((event.key === ' ' || event.key === 'Enter') && event.target instanceof Element && event.target.closest('summary')) event.stopPropagation();
  });
}
