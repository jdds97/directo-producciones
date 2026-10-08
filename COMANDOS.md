# Comandos para reanudar y levantar el proyecto

> **Tranquilidad con `main`:** `main` está 100 % intacta y protegida. Los cambios están en ramas de trabajo independientes (`jdds97/M4-Astro-Integracion` y `jdds97/M3-Contenido-Inicial-y-Estructura-sitio`). Nada se mezcla en `main` sin un Pull Request y revisión previa.

---

## Opción A. Levantar el proyecto Astro en local (Recomendada)

Entra en la carpeta del worktree de Astro:

```bash
cd /home/jesus/orca/workspaces/directo_producciones_landing_page_1.0/M4-Astro-Integracion
```

### 1. Servidor de desarrollo estándar (Astro dev)
Ideal para seguir editando o revisando en caliente:
```bash
npm run dev
```
Abre en tu navegador: **`http://localhost:4321`**

---

### 2. Emulador local de Cloudflare Workers (Idéntico a producción)
Levanta el runtime real de Cloudflare Workers con la base de datos D1 local:
```bash
npm run build
npm run local:worker
```
Abre en tu navegador: **`http://localhost:4321`**

---

## Opción B. Generar un enlace temporal para verlo en el móvil

Si tienes el servidor corriendo (por ejemplo en el puerto `4321` o `4394`) y quieres abrirlo en el móvil al momento:

```bash
npx untun@latest tunnel http://localhost:4321
```

Te devolverá una URL pública temporal `https://<id>.trycloudflare.com` para abrir en cualquier dispositivo mientras tu equipo esté encendido.

---

## Opción C. Ver el prototipo estático original de M4

Si quieres contrastar con el prototipo de diseño inicial:

```bash
cd /home/jesus/orca/workspaces/directo_producciones_landing_page_1.0/M4-Diseño/design/iteration-02
python3 -m http.server 4173
```
Abre en tu navegador: **`http://localhost:4173/desktop.html`**
