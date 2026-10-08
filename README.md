# Directo Producciones

Baseline local de Astro, TypeScript y EmDash para streaming y comunicación/marketing. WordPress sigue siendo el sitio de producción: este repositorio no despliega ni modifica DNS.

## Requisitos

- Node.js 22.22.2 (`.nvmrc`) y npm.
- Dependencias fijadas en `package-lock.json`.
- Versiones verificadas en esta revisión: Astro 7.3.8, adaptador Cloudflare 14.3.4, integración React 7.0.1, EmDash 1.1.0 y Wrangler 4.149.0. La actualización sigue la [migración oficial a Astro 7](https://docs.astro.build/en/guides/upgrade-to/v7/); `compressHTML: true` conserva el comportamiento de espacios anterior.

```sh
npm ci
npm run check
npm run build
npm run local:worker
```

`local:worker` construye el Worker, aplica migraciones D1 **locales** y escucha en `http://127.0.0.1:4321`. Para el panel EmDash se utiliza `http://localhost:4321/_emdash/admin/`; el gate redirige las rutas CMS a ese origen. El estado emulado queda en `.wrangler/m2-local`, excluido de Git. Los hooks generan un secreto de sesión local si falta `.env`; no se necesitan credenciales Cloudflare.

`npm run dev` inicia el servidor de desarrollo Astro. Los endpoints administrativos `dev-bypass` y `dev-reset` están bloqueados tanto por GET como por POST; no se usan como sustituto del login. Para comprobar autenticación editorial se usa el Worker construido.

## Alcance y límites

- Páginas de inicio, streaming y comunicación/marketing; blog y panel editorial local.
- D1 local para CMS y sesiones, R2 local y seed únicamente del modelo del blog, sin entradas ni usuarios.
- Leads y analítica desactivados. Rutas limitadas a loopback, con `noindex` y `no-store`.
- Claims corporativos controlados mediante `content/facts.yaml` y aprobadores de `content/approvers.yaml`. Un dato observado o decidido no equivale a autorización para publicarlo; el guard valida estados y cambios de aprobación.
- Solo el logotipo y la portada corporativa autorizados se incluyen en `public/assets/`. No se publican copias de medios históricos ni retratos en staging.
- El baseline actual limita el CMS al blog. La ampliación a contenido corporativo/global editable está acordada, pero pendiente de implementar; diseño y componentes seguirán fijos en Astro.
- Página dedicada `/preguntas-frecuentes/` planificada: requiere aprobar el contenido y diseñar agrupaciones por líneas de negocio, responsive y accesibles; todavía no implementada. No implica activar marcado `FAQPage`.
- No demuestra seguridad de producción, recuperación de cuentas, backups/restauración, medios R2, entrega de correo ni publicación programada. No se ha importado contenido real desde WordPress.

## GitHub Actions

`Baseline CI` se ejecuta automáticamente en pull requests dirigidas a `main`: instalación desde lockfile, auditoría npm, `guard-content`, `check` y `build`. Vulnerabilidades altas/críticas bloquean CI. Compara cambios de aprobación contra el SHA base de la PR. También admite ejecución manual con `base_ref` explícito, una vez disponible el workflow en la rama predeterminada.

El workflow usa runners efímeros de GitHub, acciones fijadas por SHA, permisos `contents: read` y checkout sin credenciales persistentes. No tiene pasos de despliegue, bindings remotos, secretos de proveedores ni subida de artefactos. El repositorio y los logs de Actions son públicos: no introducir información interna en código, commits, PRs o logs.

CODEOWNERS identifica al revisor de rutas sensibles; por sí solo no impide merges. La protección remota de `main` y los checks obligatorios deben configurarse expresamente antes de considerar la revisión exigible.

## Información excluida

`.gitignore` excluye `.env` reales, WXR, bases de datos, cachés, estado local, `.omp/`, `CONTEXT.md`, `docs/`, staging de medios y `.private/`. Los registros de cuentas, decisiones, procedimientos operativos y planes comerciales se conservan localmente y no forman parte de esta publicación. `.env.example` y `.env.local.example` contienen únicamente configuración de ejemplo.

## Verificación

```sh
npm run guard-content
npm run check
npm run build
npm run migrate:local
```

Con el Worker activo, comprobar `/`, `/streaming/`, `/comunicacion-marketing/` y `/blog/`, sus cabeceras `X-Robots-Tag`/`Cache-Control`, las imágenes corporativas y el rechazo de peticiones con un host ajeno a loopback. Esta revisión local no autoriza un lanzamiento ni sustituye una prueba de producción.

### Evidencia local de esta revisión

- Instalación desde lockfile y `guard-content` desde registry ausente: generación automática y validación correctas. El refuerzo de facts rechaza placeholders/claims prohibidos en aprobación, render y validación; los fixtures de comprobación permanecieron solo en memoria.
- `astro check`: 34 archivos, cero errores, warnings o hints de diagnósticos. Build del Worker completado. Persisten avisos de `punycode`, paquetes de autenticación deprecated y chunks grandes; no se ocultaron.
- `npm audit --audit-level=high`: cero vulnerabilidades conocidas en el lockfile revisado. Esto no demuestra ausencia de vulnerabilidades ni seguridad de producción.
- Worker con D1/R2 emulados: inicio y páginas de línea responden HTTP 200 con canonical apex, noindex y no-store; blog responde 200. CMS sin inicializar redirige al setup; API de contenido anónima devuelve 401.
- Host ajeno a loopback y endpoints administrativos DEV devuelven 403. `/404` devuelve HTTP 404 y omite canonical y JSON-LD institucional; no se ha completado el rediseño de la página de error.
- Chromium a 1440 y 375 px: imágenes corporativas decodificadas, navegación funcional y sin scroll horizontal; no se observaron recursos externos en el inicio.

No se repitió el flujo editorial completo con passkeys/publicación en esta revisión; la comprobación anterior no certifica esa regresión en Astro 7. No se conectaron recursos Cloudflare remotos.
