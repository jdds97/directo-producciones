# Directo Producciones · Astro local

Reproducción responsive del diseño M4 en Astro 7, con TypeScript y el blog real de EmDash 1.1.0. La versión de revisión está limitada a loopback; no despliega, no activa formularios ni analítica.

## Dos worktrees de trabajo

M3 conserva contenido y estructura editorial; M4 conserva componentes, estilos, movimiento y preparación de medios. Ambos parten de la misma base Astro. Los cambios se revisan por página y sección; no se fusionan en `main` ni se publican sin autorización.

El archivo local `.env.worktree`, excluido de Git, contiene únicamente `EMDASH_SITE_URL=http://localhost:4393` para M3 o `EMDASH_SITE_URL=http://localhost:4394` para M4. Configura el mismo origen en Astro, EmDash, gate, Worker y exportador. Sin ese archivo, el puerto predeterminado es 4394. Cada checkout conserva su propio `.env` y estado local; no compartir claves o sesiones entre agentes. Para sesiones editoriales simultáneas, usar perfiles de navegador separados: las cookies de localhost no se separan por puerto.

Las fuentes originales de diseño se conservan localmente en `design/`, excluido de Git. Los documentos editoriales y de coordinación permanecen en `docs/`, también privados. Los ZIP/HTML de presentación anteriores no son la fuente de trabajo.

## Revisión de la nueva estructura

Abrir `/interno/m3/inicio/` en el origen del worktree (M3: `http://localhost:4393`; M4: `http://localhost:4394`). Las siete entradas son Inicio, Quiénes somos, Portfolio, Comunicación, Producción, Contacto y Blog. Sus rutas bajo `/interno/m3/` son provisionales y exclusivamente locales; no fijan slugs ni redirecciones de producción. Las rutas preexistentes se conservan fuera de esta navegación.

Se aplica literalmente el hero y las dos entradas de Inicio y el bloque Eventos en streaming revisados con M3. El resto del copy M4 permanece como borrador, incluida TV online; las fichas de Portfolio siguen pendientes de contenido validado. No se usan logos de clientes como proyectos. El blog conserva el CMS nativo y el formulario sigue deshabilitado.

Con el Worker activo, `npm run export:presentation` genera HTML de revisión en `.private/review-html/`, excluidos de Git. Abrir su `index.html` sin Node ni servidor. Esta nueva revisión no está autorizada para publicación. El ZIP y `preview-html/` ya subidos a GitHub pertenecen a la entrega anterior; no representan la nueva estructura.

## Uso local

Se requiere Node 22.22.2 y npm. Las dependencias conservan las versiones del lockfile.

```sh
npm ci
npm run check
npm run build
npm run local:worker
```

El Worker usa el puerto de `.env.worktree` (4394 por defecto). El script genera un entorno con clave de sesión nueva y aplica migraciones únicamente a D1 local. No requiere login ni credenciales de Cloudflare. D1, sesiones y R2 emulados quedan en `.wrangler/m4-astro-review` dentro de cada checkout, excluidos de Git. `npm run dev` sirve el desarrollo Astro en el mismo puerto; detener un servidor antes de iniciar el otro en ese checkout.

Rutas de revisión: `/`, `/servicios/`, `/clientes/`, `/quienes-somos/`, `/streaming/`, `/comunicacion-marketing/`, `/blog/`, `/contacto/`, `/cookies/`, `/privacidad/` y `/aviso-legal/`. Una URL ausente devuelve la composición M4 con HTTP 404. La guía se revisa en `/interno/guia/` y la plantilla editorial en `/interno/articulo/`; ambas son internas y locales. El panel auténtico del blog está en `/_emdash/admin/`.

El botón de tema alterna claro/oscuro. `?theme=dark` permite abrir directamente la versión oscura y conservarla durante la navegación. El menú incluye foco, teclado y Escape; las animaciones respetan cambios de `prefers-reduced-motion`.

## Contenido y CMS

`src/content/m4-draft.json` contiene campos de copy separados del diseño fijo de `src/components/m4/`. Todo el copy M4 sigue en borrador, incluido el hero de Inicio. `config/m4-editorial.json` no registra aprobaciones de esta reproducción. El titular específico de Streaming permanece independiente. No incorporar propuestas editoriales sin autorización puntual.

Las páginas del blog consultan el CMS real; el seed no contiene artículos ni usuarios. El modelo EmDash del baseline sigue limitado al blog. La edición corporativa/global en el CMS está pendiente, sin presentar los campos de copy del repositorio como un CMS implementado. La marca del admin utiliza las opciones nativas soportadas por EmDash; conserva su editor y autenticación, sin sustituirlos por la maqueta M4. La comprobación usa un usuario sintético y una passkey virtual de navegador, no una cuenta del propietario. Para iniciar tu propio panel desde cero, detén el Worker y usa otro estado local aislado:

```sh
npx wrangler d1 migrations apply DB --local --persist-to .wrangler/m4-editorial-propia
npm run --ignore-scripts local:worker -- --persist-to .wrangler/m4-editorial-propia
```

Después abre `/_emdash/admin/` en el origen de tu worktree y sigue el alta nativa con tu passkey. El primer arranque del CMS puede tardar mientras inicializa el entorno local.

Contacto reproduce el formulario con envío deshabilitado. No serializa, persiste ni envía los campos; tampoco simula éxito. Las páginas legales son borradores pendientes de revisión y no son textos jurídicos vigentes. Los controles ilustrativos de preferencias no activan cookies ni categorías.

## Comprobaciones y restricciones

```sh
npm run guard-content
npm run check
npm run build
npm run migrate:local
```

El guard conserva la validación de facts, aprobadores y revisiones del blog. Las excepciones de diseño son exclusivamente locales: los bytes de los activos M4 están enumerados por hash en `config/m4-assets.json`, todo el copy permanece sin aprobar y el formulario debe seguir deshabilitado. Cualquier entorno distinto de `local` bloquea la reproducción. No usar este worktree para producción sin una integración editorial posterior revisada.

Las respuestas de página usan `noindex`/`no-store`, sin canonical ni datos estructurados de producción. El gate rechaza hosts ajenos a loopback, POST fuera del CMS, endpoints de bypass/reset y funciones fuera del alcance local. El login editorial usa exclusivamente el origen localhost configurado para cada worktree.

No copiar secretos, WXR, uploads, datos reales, estado local o registros internos al conjunto publicable. `.gitignore` excluye `.env`, `.emdash`, `.wrangler`, `.private`, `docs`, bases y caches. La evidencia de revisión permanece en `.private/evidence`, sin publicación.

Manrope se sirve localmente, con licencia OFL en `public/assets/m4/OFL-Manrope.txt`. Los logos y retratos se conservan sin modificar sus bytes; los recortes ópticos se aplican por CSS. Su inclusión en esta revisión local no acredita permisos adicionales ni cierra la revisión de lanzamiento.

## CI de revisión

El workflow `Baseline CI`, conservado desde `main`, comprueba las PR dirigidas a `main`: instalación desde lockfile, auditoría npm, guard editorial comparado con el commit base, check y build. Usa permisos de lectura y no despliega. CODEOWNERS no sustituye la protección remota de la rama ni la revisión del propietario.
