// Filtros internos de /blog/: las categorías muestran u ocultan tarjetas sin cambiar de página ni abrir archivos.
// Sin JS funcionan como enlaces a /blog/?categoria=… (el servidor ya pinta ese estado). Con JS: sin recarga, historial
// (atrás/adelante), contador anunciado a lectores de pantalla y estado vacío.
export function initBlogFilter(root: HTMLElement): () => void {
  const filterBar = root.querySelector<HTMLElement>('[data-blog-filter]');
  if (!filterBar) return () => {};
  const bar: HTMLElement = filterBar;
  const links = [...document.querySelectorAll<HTMLAnchorElement>('[data-filter]')];
  const cards = [...root.querySelectorAll<HTMLElement>('[data-blog-card]')];
  const archive = root.querySelector<HTMLElement>('[data-blog-archive]');
  const lead = root.querySelector<HTMLElement>('[data-blog-lead]');
  const archiveTitle = archive?.querySelector('h2');
  const empty = root.querySelector<HTMLElement>('[data-blog-filter-empty]');
  const count = root.querySelector<HTMLElement>('[data-blog-count]');
  const known = new Set(links.map(link => link.dataset.filter).filter(Boolean));
  const labels = new Map(links.map(link => [link.dataset.filter ?? '', link.dataset.label ?? link.textContent ?? '']));

  function apply(slug: string) {
    if (slug && !known.has(slug)) slug = '';
    // La entrada de portada cuenta siempre, pero en «Todas» se ve arriba y su tarjeta no se repite en la lista.
    let shown = 0, listed = 0;
    for (const card of cards) {
      const match = !slug || (card.dataset.categories ?? '').split(' ').includes(slug);
      if (match) shown++;
      card.hidden = !match || (!slug && card.hasAttribute('data-blog-lead-card'));
      if (!card.hidden) listed++;
    }
    if (lead) lead.hidden = Boolean(slug);
    if (archive) archive.hidden = listed === 0;
    if (archiveTitle) archiveTitle.textContent = slug ? labels.get(slug) ?? '' : 'Más publicaciones';
    if (empty) empty.hidden = shown > 0;
    if (count) count.textContent = `${shown} ${shown === 1 ? 'entrada' : 'entradas'}${slug ? ` en ${labels.get(slug)}` : ''}`;
    for (const link of links) {
      if (!bar.contains(link)) continue;
      if ((link.dataset.filter ?? '') === slug) link.setAttribute('aria-current', 'true'); else link.removeAttribute('aria-current');
    }
  }
  const fromUrl = () => new URL(location.href).searchParams.get('categoria') ?? '';
  const onClick = (event: MouseEvent) => {
    const link = (event.target as Element).closest<HTMLAnchorElement>('[data-filter]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const slug = link.dataset.filter ?? '';
    history.pushState(null, '', slug ? `/blog/?categoria=${encodeURIComponent(slug)}` : '/blog/');
    apply(slug);
    // El foco se queda en el control pulsado; si era el enlace del estado vacío (que se oculta), pasa a «Todas».
    if (link.closest('[data-blog-filter-empty]')) bar.querySelector<HTMLAnchorElement>('[data-filter=""]')?.focus();
  };
  const onPop = () => apply(fromUrl());
  root.addEventListener('click', onClick);
  addEventListener('popstate', onPop);
  apply(fromUrl());
  return () => { root.removeEventListener('click', onClick); removeEventListener('popstate', onPop); };
}
