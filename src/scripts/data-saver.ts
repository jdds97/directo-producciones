/** «Ahorro de datos» del navegador (Chromium): los vídeos de portada no arrancan solos; el póster se ve y el botón de reproducir sigue disponible. */
export const saveData = (): boolean => (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;

/** Tras `load` y un hueco libre del hilo principal: los vídeos y pósteres secundarios no compiten con la imagen LCP. */
export function afterLoadIdle(run: () => void): void {
  const idle = () => (typeof requestIdleCallback === 'function' ? requestIdleCallback(() => run(), { timeout: 2000 }) : setTimeout(run, 200));
  if (document.readyState === 'complete') idle();
  else addEventListener('load', idle, { once: true });
}
