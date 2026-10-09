# Directo Producciones · Astro local

Reproducción responsive del diseño M4 en Astro 7, con TypeScript y el blog real de EmDash 1.1.0. La versión de revisión está limitada a loopback; no despliega, no activa formularios ni analítica.

## Presentación sin Node

Descargar `directo-preview.zip`, extraerlo y abrir `preview-html/index.html` en un navegador. Los 16 HTML actualizados se exportan del Worker Astro: incluyen navegación entre páginas, claro/oscuro, menú móvil, fuentes y activos locales. También están disponibles directamente en `preview-html/`.

El copy M4 continúa en borrador. El blog es una instantánea sintética; la guía y las plantillas se incluyen como vistas de presentación. EmDash requiere el Worker local y conserva su autenticación real: el paquete HTML no incluye cuentas, bases de datos ni una simulación del admin. La subida a GitHub comparte fuentes y esta presentación; no activa una web de producción.

Con el Worker activo, `npm run export:presentation` regenera los HTML. Las comprobaciones locales cubren 90 vistas del runtime, 66 comparaciones con M4 y el flujo editorial nativo; la presentación HTML se comprueba también mediante apertura directa de archivos.

## Uso local

Se requiere Node 22.22.2 y npm. Las dependencias conservan las versiones del lockfile.

```sh
npm ci
npm run check
npm run build
npm run local:worker
```

El Worker escucha en `http://localhost:4394`. El script genera un entorno con clave de sesión nueva y aplica migraciones únicamente a D1 local. No requiere login ni credenciales de Cloudflare. D1, sesiones y R2 emulados quedan en `.wrangler/m4-astro-review`, excluido de Git. `npm run dev` sirve el desarrollo Astro en el mismo puerto; detener un servidor antes de iniciar el otro.

Rutas de revisión: `/`, `/servicios/`, `/clientes/`, `/quienes-somos/`, `/streaming/`, `/comunicacion-marketing/`, `/blog/`, `/contacto/`, `/cookies/`, `/privacidad/` y `/aviso-legal/`. Una URL ausente devuelve la composición M4 con HTTP 404. La guía se revisa en `/interno/guia/` y la plantilla editorial en `/interno/articulo/`; ambas son internas y locales. El panel auténtico del blog está en `/_emdash/admin/`.

El botón de tema alterna claro/oscuro. `?theme=dark` permite abrir directamente la versión oscura y conservarla durante la navegación. El menú incluye foco, teclado y Escape; las animaciones respetan cambios de `prefers-reduced-motion`.

## Contenido y CMS

`src/content/m4-draft.json` contiene campos de copy separados del diseño fijo de `src/components/m4/`. Todo el copy M4 sigue en borrador, incluido el hero de Inicio. `config/m4-editorial.json` no registra aprobaciones de esta reproducción. El titular específico de Streaming permanece independiente. No incorporar propuestas editoriales sin autorización puntual.

Las páginas del blog consultan el CMS real; el seed no contiene artículos ni usuarios. El modelo EmDash del baseline sigue limitado al blog. La edición corporativa/global en el CMS está pendiente, sin presentar los campos de copy del repositorio como un CMS implementado. La marca del admin utiliza las opciones nativas soportadas por EmDash; conserva su editor y autenticación, sin sustituirlos por la maqueta M4. La comprobación usa un usuario sintético y una passkey virtual de navegador, no una cuenta del propietario. Para iniciar tu propio panel desde cero, detén el Worker y usa otro estado local aislado:

```sh
npx wrangler d1 migrations apply DB --local --persist-to .wrangler/m4-editorial-propia
npm run --ignore-scripts local:worker -- --persist-to .wrangler/m4-editorial-propia
```

Después abre `http://localhost:4394/_emdash/admin/` y sigue el alta nativa con tu passkey. El primer arranque del CMS puede tardar mientras inicializa el entorno local.

Contacto reproduce el formulario con envío deshabilitado. No serializa, persiste ni envía los campos; tampoco simula éxito. Las páginas legales son borradores pendientes de revisión y no son textos jurídicos vigentes. Los controles ilustrativos de preferencias no activan cookies ni categorías.

## Comprobaciones y restricciones

```sh
npm run guard-content
npm run check
npm run build
npm run migrate:local
```

El guard conserva la validación de facts, aprobadores y revisiones del blog. Las excepciones de diseño son exclusivamente locales: los bytes de los activos M4 están enumerados por hash en `config/m4-assets.json`, todo el copy permanece sin aprobar y el formulario debe seguir deshabilitado. Cualquier entorno distinto de `local` bloquea la reproducción. No usar este worktree para producción sin una integración editorial posterior revisada.

Las respuestas de página usan `noindex`/`no-store`, sin canonical ni datos estructurados de producción. El gate rechaza hosts ajenos a loopback, POST fuera del CMS, endpoints de bypass/reset y funciones fuera del alcance local. El login editorial usa exclusivamente `localhost:4394`.

No copiar secretos, WXR, uploads, datos reales, estado local o registros internos al conjunto publicable. `.gitignore` excluye `.env`, `.emdash`, `.wrangler`, `.private`, `docs`, bases y caches. La evidencia de revisión permanece en `.private/evidence`, sin publicación.

Manrope se sirve localmente, con licencia OFL en `public/assets/m4/OFL-Manrope.txt`. Los logos y retratos se conservan sin modificar sus bytes; los recortes ópticos se aplican por CSS. Su inclusión en esta revisión local no acredita permisos adicionales ni cierra la revisión de lanzamiento.
