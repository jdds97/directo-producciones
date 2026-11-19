import { RESULT_MESSAGES as MESSAGES } from "../lib/contact-mail";

const forms = document.querySelectorAll<HTMLFormElement>("form[data-contact-form]");
for (const form of forms) {
  const status = form.querySelector<HTMLElement>("[role='status']")!;
  const submit = form.querySelector<HTMLButtonElement>("button[type='submit']")!;
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
      submit.removeAttribute("aria-disabled");
      form.removeAttribute("aria-busy");
    }
  });
}
