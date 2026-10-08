# Directo Producciones · Astro local

Reproducción responsive del diseño M4 en Astro 7, con TypeScript y el blog real de EmDash 1.1.0. La versión de revisión está limitada a loopback; no despliega, no activa formularios ni analítica.

## Uso local

Se requiere Node 22.22.2 y npm. Las dependencias conservan las versiones del lockfile.

```sh
npm ci
npm run check
npm run build
npm run local:worker
```

El Worker escucha en `http://localhost:4394`. El script genera un entorno con clave de sesión nueva y aplica migraciones únicamente a D1 local. No requiere login ni credenciales de Cloudflare. D1, sesiones y R2 emulados quedan en `.wrangler/m4-local`, excluido de Git. `npm run dev` sirve el desarrollo Astro en el mismo puerto; detener un servidor antes de iniciar el otro.

Rutas de revisión: `/`, `/servicios/`, `/clientes/`, `/quienes-somos/`, `/streaming/`, `/comunicacion-marketing/`, `/blog/`, `/contacto/`, `/cookies/`, `/privacidad/` y `/aviso-legal/`. Una URL ausente devuelve la composición M4 con HTTP 404. La guía se revisa en `/interno/guia/` y la plantilla editorial en `/interno/articulo/`; ambas son internas y locales. El panel auténtico del blog está en `/_emdash/admin/`.

El botón de tema alterna claro/oscuro. `?theme=dark` permite abrir directamente la versión oscura y conservarla durante la navegación. El menú incluye foco, teclado y Escape; las animaciones respetan cambios de `prefers-reduced-motion`.

## Contenido y CMS

`src/content/m4-draft.json` contiene campos de copy separados del diseño fijo de `src/components/m4/`. Todo sigue en borrador salvo el lote del hero de Inicio registrado en `config/m4-editorial.json`; esa aprobación no aprueba facts ni publicación. El titular específico de Streaming permanece independiente. No incorporar propuestas editoriales sin autorización puntual.

Las páginas del blog consultan el CMS real; el seed no contiene artículos ni usuarios. El modelo EmDash del baseline sigue limitado al blog. La edición corporativa/global en el CMS está pendiente, sin presentar los campos de copy del repositorio como un CMS implementado. La marca del admin utiliza las opciones nativas soportadas por EmDash; conserva su editor y autenticación, sin sustituirlos por la maqueta M4.

Contacto reproduce el formulario con envío deshabilitado. No serializa, persiste ni envía los campos; tampoco simula éxito. Las páginas legales son borradores pendientes de revisión y no son textos jurídicos vigentes. Los controles ilustrativos de preferencias no activan cookies ni categorías.

## Comprobaciones y restricciones

```sh
npm run guard-content
npm run check
npm run build
npm run migrate:local
```

El guard conserva la validación de facts, aprobadores y revisiones del blog. Las excepciones de diseño son exclusivamente locales: los bytes de los activos M4 están enumerados por hash en `config/m4-assets.json`, la aprobación editorial se limita al hero de Inicio y el formulario debe seguir deshabilitado. Cualquier entorno distinto de `local` bloquea la reproducción. No usar este worktree para producción sin una integración editorial posterior revisada.

Las respuestas de página usan `noindex`/`no-store`, sin canonical ni datos estructurados de producción. El gate rechaza hosts ajenos a loopback, POST fuera del CMS, endpoints de bypass/reset y funciones fuera del alcance local. El login editorial usa exclusivamente `localhost:4394`.

No copiar secretos, WXR, uploads, datos reales, estado local o registros internos al conjunto publicable. `.gitignore` excluye `.env`, `.emdash`, `.wrangler`, `.private`, `docs`, bases y caches. La evidencia de revisión permanece en `.private/evidence`, sin publicación.

Manrope se sirve localmente, con licencia OFL en `public/assets/m4/OFL-Manrope.txt`. Los logos y retratos se conservan sin modificar sus bytes; los recortes ópticos se aplican por CSS. Su inclusión en esta revisión local no acredita permisos adicionales ni cierra la revisión de lanzamiento.
