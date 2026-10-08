export {};
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const animations: Animation[] = [];
if (!reduced.matches) {
  document.querySelectorAll<HTMLElement>('[data-enter]').forEach(element => {
    animations.push(element.animate([{opacity: .84, transform: 'translateY(12px)'}, {opacity: 1, transform: 'translateY(0)'}], {
      duration: 480, delay: Number(element.dataset.enter), easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards',
    }));
  });
}
const toggle = document.querySelector<HTMLButtonElement>('.menu-toggle')!;
const menu = document.querySelector<HTMLElement>('#mobile-menu')!;
const closeButton = document.querySelector<HTMLButtonElement>('.menu-close')!;
const backdrop = document.querySelector<HTMLElement>('.menu-backdrop')!;
const board = document.querySelector<HTMLElement>('.artboard')!;
let previousFocus: HTMLElement | null = null;
let menuAnimation: Animation | undefined;
let closeVersion = 0;
async function closeMenu() {
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
  previousFocus?.focus();
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
menu.querySelectorAll('a').forEach(anchor => anchor.addEventListener('click', () => { void closeMenu(); }));
reduced.addEventListener('change', () => {
  if (reduced.matches) { animations.forEach(animation => animation.cancel()); menuAnimation?.cancel(); }
});
// Resize while open must release inert and scroll when desktop navigation appears.
matchMedia('(min-width: 1101px)').addEventListener('change', event => { if (event.matches) void closeMenu(); });
const themeToggle = document.querySelector<HTMLButtonElement>('.theme-toggle')!;
let dark = document.body.classList.contains('theme-dark');
function applyTheme() {
  document.body.classList.toggle('theme-dark', dark);
  board.classList.toggle('theme-dark', dark);
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', dark ? 'dark' : 'light');
  themeToggle.setAttribute('aria-pressed', String(dark));
  themeToggle.setAttribute('aria-label', dark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro');
  document.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(anchor => {
    const url = new URL(anchor.href);
    if (url.origin !== location.origin || url.pathname.startsWith('/_emdash/')) return;
    if (dark) url.searchParams.set('theme', 'dark'); else url.searchParams.delete('theme');
    anchor.href = url.pathname + url.search + url.hash;
  });
}
applyTheme();
themeToggle.addEventListener('click', () => {
  dark = !dark;
  const url = new URL(location.href);
  if (dark) url.searchParams.set('theme', 'dark'); else url.searchParams.delete('theme');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
  applyTheme();
});
// No submit, serialization, persistence, success simulation or provider requests.
document.querySelectorAll('form[data-disabled-form]').forEach(form => form.addEventListener('submit', event => event.preventDefault()));
