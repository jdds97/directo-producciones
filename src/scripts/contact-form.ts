import { RESULT_MESSAGES as MESSAGES } from "../lib/contact-mail";

// Turnstile (si el formulario trae sitekey): api.js se carga solo cuando el formulario se acerca a la pantalla o recibe el foco,
// para no penalizar la carga de Inicio. Render explícito: la página sigue viva tras enviar y el token es de un solo uso (reset).
type Turnstile = { render(el: HTMLElement, options: Record<string, unknown>): string; reset(id: string): void; getResponse(id: string): string | undefined };
const tsWindow = window as Window & { turnstile?: Turnstile; dpTurnstileReady?: () => void };
let turnstileLoad: Promise<Turnstile> | undefined;
const loadTurnstile = () => (turnstileLoad ??= new Promise<Turnstile>((resolve, reject) => {
  tsWindow.dpTurnstileReady = () => resolve(tsWindow.turnstile!);
  const script = document.createElement("script");
  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=dpTurnstileReady";
  script.async = true;
  script.onerror = () => { turnstileLoad = undefined; script.remove(); reject(new Error("turnstile")); };
  document.head.append(script);
}));

const forms = document.querySelectorAll<HTMLFormElement>("form[data-contact-form]");
for (const form of forms) {
  const status = form.querySelector<HTMLElement>("[role='status']")!;
  const submit = form.querySelector<HTMLButtonElement>("button[type='submit']")!;
  const box = form.querySelector<HTMLElement>("[data-turnstile-sitekey]");
  let widgetId: string | undefined;
  if (box) {
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      observer.disconnect();
      loadTurnstile()
        .then((turnstile) => { widgetId = turnstile.render(box, { sitekey: box.dataset.turnstileSitekey, action: box.dataset.turnstileAction, theme: "light", size: "flexible" }); })
        .catch(() => { started = false; }); // se reintenta en el siguiente foco
    };
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) start(); }, { rootMargin: "600px 0px" });
    observer.observe(form);
    form.addEventListener("focusin", start);
  }
  const show = (text: string, state: "ok" | "error") => {
    status.textContent = text;
    status.dataset.state = state;
    status.focus();
  };
  form.addEventListener("input", (event) => {
    const field = event.target;
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) field.setCustomValidity("");
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    // aria-disabled (no disabled) mantiene el foco y evita el doble envío.
    if (submit.getAttribute("aria-disabled") === "true") return;
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    const message = String(data.get("message") ?? "").trim();
    const nameInput = form.elements.namedItem("name") as HTMLInputElement;
    const messageInput = form.elements.namedItem("message") as HTMLTextAreaElement;
    nameInput.setCustomValidity(name ? "" : "Escribe tu nombre.");
    messageInput.setCustomValidity(message ? "" : "Escribe un mensaje sobre tu proyecto.");
    if (!form.reportValidity()) {
      show("Completa tu nombre, un correo válido y el mensaje sobre tu proyecto.", "error");
      (form.querySelector(":invalid") as HTMLElement | null)?.focus();
      return;
    }
    if (box && !(widgetId !== undefined && tsWindow.turnstile?.getResponse(widgetId))) {
      show("Espera a que termine la verificación antiabuso, encima del botón, y vuelve a enviar.", "error");
      return;
    }

    submit.setAttribute("aria-disabled", "true");
    form.setAttribute("aria-busy", "true");
    status.dataset.state = "";
    status.textContent = "Enviando la consulta…";
    try {
      const response = await fetch(form.action, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(data as unknown as Record<string, string>),
        // Más que el tope del servidor (8 s): si la red no responde, no queda «Enviando…» indefinido.
        signal: AbortSignal.timeout(15000),
      });
      const result = (await response.json()) as { ok?: boolean; code?: string };
      show(MESSAGES[result.code ?? ""] ?? MESSAGES.fallo, result.ok ? "ok" : "error");
      if (result.ok) {
        // Solo recepción real (correo aceptado o consulta guardada); la simulación local nunca cuenta como consulta.
        if (result.code === "enviada" || result.code === "recibida") document.dispatchEvent(new CustomEvent("dp:event", { detail: { name: "generate_lead" } }));
        form.reset();
      } // en error se conservan los campos
    } catch {
      // Sin reintento automático: no hay confirmación y reenviar podría duplicar la consulta.
      show(MESSAGES.tiempo, "error");
    } finally {
      if (widgetId !== undefined) tsWindow.turnstile?.reset(widgetId); // el token ya se ha gastado, haya ido bien o mal
      submit.removeAttribute("aria-disabled");
      form.removeAttribute("aria-busy");
    }
  });
}
