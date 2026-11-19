// Consentimiento de analítica y ÚNICO emisor de GA4 (modo básico de Google Consent Mode).
//  - Antes de aceptar no se descarga gtag.js ni se contacta con Google (ni siquiera con el estado por defecto).
//  - Rechazar no carga nada; revocar desactiva la medición, borra las cookies _ga* y la decisión se recuerda 180 días.
//  - Los eventos pasan por un filtro: lista cerrada de nombres y sin datos personales (claves o valores que lo parezcan).
// Solo se activa cuando Base.astro publica <meta name="dp-ga4">, y Base solo lo hace con ANALYTICS_ENABLED (bloqueado en este baseline).
export const CONSENT_KEY = 'dp-consent-v1';
export const CONSENT_DAYS = 180;
const ALLOWED_EVENTS = new Set(['generate_lead', 'click_whatsapp']);
const PII_KEY = /mail|name|nombre|phone|tel|mensaje|message|address|direcci|dni|nif/i;
const PII_VALUE = /[^\s@]+@[^\s@]+|\+?\d[\d\s().-]{7,}/;
export type ConsentState = 'unset' | 'accepted' | 'rejected';

interface Env {
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  doc: Document;
  win: Window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void; [flag: string]: unknown };
  now?: () => number;
}

/** Elimina cualquier propiedad personal de los parámetros de un evento y recorta URLs a origen+ruta. */
export function cleanParams(params: Record<string, unknown> = {}): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(params)) {
    if (PII_KEY.test(key)) continue;
    if (typeof value === 'number' || typeof value === 'boolean') { out[key] = value; continue; }
    if (typeof value !== 'string') continue;
    const text = value.startsWith('http') ? value.split(/[?#]/)[0] : value;
    if (PII_VALUE.test(text)) continue;
    out[key] = text.slice(0, 100);
  }
  return out;
}

export function createConsent(measurementId: string, env: Env) {
  const { storage, doc, win } = env;
  const now = env.now ?? Date.now;
  let memory: ConsentState = 'unset';
  let loaded = false;
  const listeners = new Set<(state: ConsentState) => void>();

  function read(): ConsentState {
    try {
      const raw = JSON.parse(storage.getItem(CONSENT_KEY) ?? 'null') as { s?: string; t?: number } | null;
      if (raw && (raw.s === 'accepted' || raw.s === 'rejected') && typeof raw.t === 'number' && now() - raw.t < CONSENT_DAYS * 864e5) return raw.s;
    } catch { /* almacenamiento bloqueado: se usa la memoria de la página */ }
    return memory;
  }
  function write(state: ConsentState) {
    memory = state;
    try { storage.setItem(CONSENT_KEY, JSON.stringify({ s: state, t: now() })); } catch { /* sin persistencia */ }
    for (const fn of listeners) fn(state);
  }
  function load() {
    if (loaded) return;
    loaded = true;
    delete win[`ga-disable-${measurementId}`];
    win.dataLayer = win.dataLayer ?? [];
    win.gtag = function gtag() { win.dataLayer!.push(arguments); }; // gtag.js exige el objeto `arguments`
    win.gtag('consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
    win.gtag('js', new Date(now()));
    win.gtag('config', measurementId, { allow_google_signals: false, allow_ad_personalization_signals: false });
    const script = doc.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    doc.head.appendChild(script);
  }
  function clearCookies() {
    const host = win.location.hostname, parts = host.split('.');
    const domains = ['', host, ...(parts.length > 2 ? [`.${parts.slice(-2).join('.')}`] : [`.${host}`])];
    for (const item of doc.cookie.split(';')) {
      const name = item.split('=')[0].trim();
      if (!/^_ga(_|$)/.test(name)) continue;
      for (const domain of domains) doc.cookie = `${name}=; Max-Age=0; path=/${domain ? `; domain=${domain}` : ''}`;
    }
  }
  return {
    state: read,
    accept() { write('accepted'); load(); },
    reject() {
      const wasAccepted = loaded;
      write('rejected');
      if (wasAccepted) {
        win[`ga-disable-${measurementId}`] = true;
        win.gtag?.('consent', 'update', { analytics_storage: 'denied' });
        clearCookies();
      }
    },
    /** Al cargar la página: si ya se aceptó (y no ha caducado) se carga una sola vez; en cualquier otro caso no se hace nada. */
    restore() { if (read() === 'accepted') load(); return read(); },
    track(name: string, params?: Record<string, unknown>) {
      if (read() !== 'accepted' || !loaded || !ALLOWED_EVENTS.has(name)) return false;
      win.gtag!('event', name, cleanParams(params));
      return true;
    },
    onChange(fn: (state: ConsentState) => void) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

const TEXT = {
  title: 'Medición de visitas',
  body: 'Si lo aceptas, usamos Google Analytics para saber qué páginas se visitan y mejorar la web. No se activa hasta que aceptes, no recoge nombres, correos ni lo que escribes en los formularios, y puedes cambiar de decisión cuando quieras.',
  accept: 'Aceptar medición', reject: 'Rechazar', more: 'Política de cookies',
  open: 'Preferencias de medición', withdraw: 'Retirar consentimiento', close: 'Cerrar',
};

/** Banner accesible (no modal, sin trampa de foco) y botón «Preferencias» junto al enlace a Cookies del pie. */
export function initConsent(measurementId: string, env: Env = { storage: localStorage, doc: document, win: window as never }) {
  if (!/^G-[A-Z0-9]{4,}$/.test(measurementId)) return null;
  const consent = createConsent(measurementId, env);
  const { doc } = env;
  let panel: HTMLElement | null = null;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {}) => {
    const node = doc.createElement(tag);
    const { class: cls, ...rest } = props;
    if (cls) node.className = cls;
    return Object.assign(node, rest);
  };
  function close(restoreFocus?: HTMLElement | null) { panel?.remove(); panel = null; restoreFocus?.focus(); }
  function open(fromButton?: HTMLElement) {
    if (panel) return;
    const state = consent.state();
    const title = el('h2', { textContent: TEXT.title, id: 'dp-consent-title' });
    const actions = el('div', { class: 'consent__actions' });
    const primary = el('button', { type: 'button', class: 'consent__button', textContent: state === 'accepted' ? TEXT.close : TEXT.accept });
    const secondary = el('button', { type: 'button', class: 'consent__button', textContent: state === 'accepted' ? TEXT.withdraw : TEXT.reject });
    primary.addEventListener('click', () => { if (state !== 'accepted') consent.accept(); close(fromButton); });
    secondary.addEventListener('click', () => { consent.reject(); close(fromButton); });
    actions.append(primary, secondary);
    panel = el('div', { class: 'consent', role: 'dialog' });
    panel.setAttribute('aria-labelledby', 'dp-consent-title');
    panel.append(title, el('p', { textContent: TEXT.body }), el('a', { href: '/cookies/', textContent: TEXT.more, class: 'consent__link' }), actions);
    doc.body.append(panel);
    if (fromButton) primary.focus(); // reabierto a petición: se mueve el foco; el aviso inicial no lo roba
  }
  // Eventos de la web → medición: la web solo emite «dp:event»; este módulo decide (consentimiento + filtro) si sale algo.
  doc.addEventListener('dp:event', event => { const d = (event as CustomEvent<{ name: string; params?: Record<string, unknown> }>).detail; consent.track(d.name, d.params); });
  doc.addEventListener('click', event => {
    const link = (event.target as Element | null)?.closest?.('a[href^="https://wa.me/"]');
    if (link) consent.track('click_whatsapp', { link_location: link.classList.contains('whatsapp-access') ? 'flotante' : 'contenido' });
  });
  consent.restore();
  if (consent.state() === 'unset') open();
  const cookiesLink = doc.querySelector<HTMLAnchorElement>('footer a[href="/cookies/"]');
  if (cookiesLink && !doc.querySelector('[data-consent-open]')) {
    const button = el('button', { type: 'button', class: 'consent__open', textContent: TEXT.open });
    button.setAttribute('data-consent-open', '');
    button.addEventListener('click', () => open(button));
    cookiesLink.after(button);
  }
  return consent;
}
