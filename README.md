# Directo Producciones: sitio web

**Estado:** planificación. En este repositorio **no hay todavía código del sitio nuevo ni nada publicado desde él**. El sitio actual (WordPress) sigue en producción y no se toca hasta la Fase 5 del plan.

**Alcance:** sustituir el sitio completo, con peso equilibrado entre streaming y comunicación/marketing (decisión del propietario).

## Entregable local de M3

[Contenido inicial y estructura para revisión](docs/m3-contenido-estructura.md): borradores de Inicio y de las dos líneas, ocho preguntas con respuestas, metadatos y propuesta de navegación basada en M4. Pendiente de revisión y aprobación; no modifica facts ni completa tareas de Asana.

El documento es interno y permanece excluido de Git bajo `/docs/` conforme a D-50. Los registros vigentes se consultan en el checkout principal, identificado en el propio entregable; este worktree no contiene copias actualizadas de ellos. No publicar el borrador ni sustituir esos registros por el README histórico.

## Plan vigente

El único plan vigente es [`docs/PLAN.md`](docs/PLAN.md), versión 3.2. Las decisiones y aprobaciones se registran aparte en [`docs/decisions.md`](docs/decisions.md); el plan no las sustituye.

## Jerarquía de documentos

Si dos documentos se contradicen, prevalece el de arriba.

| Documento | Función |
|---|---|
| [`docs/decisions.md`](docs/decisions.md) | Decisiones del propietario, límites de autorización y bloqueos |
| [`content/facts.yaml`](content/facts.yaml) y [`content/approvers.yaml`](content/approvers.yaml) | Claims corporativos y aprobadores autorizados por ámbito |
| [`docs/PLAN.md`](docs/PLAN.md) | Único plan: arquitectura, fases, contratos y criterios de aceptación |
| [`CONTEXT.md`](CONTEXT.md) | Guía breve de lectura y ejecución para los harnesses; no duplica el plan |
| `README.md` | Entrada al repositorio y seguimiento operativo |

Decisiones y hechos tienen ámbitos distintos; ante una contradicción se consulta su registro autorizado antes de implementar. `AGENTS.md` (Fase 1) aplicará el mismo orden. El estado de las aprobaciones está en los registros anteriores, no en las copias históricas.

## Archivos

### Existentes hoy

| Archivo | Función |
|---|---|
| `README.md` | Entrada al repositorio |
| `CONTEXT.md` | Guía vigente para harnesses |
| `docs/PLAN.md` | Plan consolidado v3.2 |
| `docs/decisions.md` | Decisiones del propietario, observaciones públicas y bloqueos |
| `content/facts.yaml` | Datos y claims con estado de publicación |
| `content/approvers.yaml` | Registro de aprobadores; Jesús De Dios Sánchez designado en `facts` y `decisions`; revisión legal y políticas siguen pendientes (B2) |
| `docs/claims-ledger.md` | Claims públicos observados y validación pendiente |
| `docs/url-inventory.csv` | 59 URLs: 57 del sitemap y dos rutas de archivo fuera de él ya revisadas; `Videoclip` responde en la web pero falta en el WXR, y `Uncategorized` está en el WXR sin productos asignados; 44 URLs de páginas/entradas/productos contrastadas; Search Console pendiente |
| `docs/assets-register.csv` | 160 registros: 19 observados en home y 141 adjuntos WXR; 19 pares comparten host/ruta y solo difieren en `http`/`https`. Quince adjuntos tienen un `post_parent` no presente en WXR (estado desconocido). Se mantienen separados por procedencia; titularidad y permisos siguen pendientes |

El inventario público no es completo ni autoriza migraciones. Las versiones anteriores, el informe original y el JSON-LD obsoleto se conservan en `docs/archive/`, fuera del conjunto vigente. No copiar sus claims, precios, arquitectura o referencias antiguas al sitio.

La consolidación conserva los registros de decisiones, hechos, URLs y activos separados por función: unificarlos no significa mezclar aprobaciones e inventarios dentro de un solo archivo.

### Previstos

| Archivo | Se crea en | Función |
|---|---|---|
| `AGENTS.md`, `.github/CODEOWNERS` | Fase 1 | Reglas para agentes y revisores obligatorios |
| Código del sitio (`src/`, configuración, tests) | Fases 1 a 4 | Implementación |

## Aprobaciones

- `facts.yaml` aprueba solo **datos y claims corporativos**: identidad, contacto, servicios, cifras, clientes y logos, testimonios, plazos, zonas. No registra decisiones técnicas, proveedores, políticas legales ni revisiones de código; eso va en `docs/decisions.md`.
- En producción solo se publica lo que esté `approved` con aprobador con nombre.
- Jesús De Dios Sánchez está designado como aprobador interno de `facts` y `decisions` en `content/approvers.yaml`. Cada aprobación requiere evidencia y registro individual; la designación no aprueba claims ni políticas y no certifica cualificación jurídica. B2 sigue abierto hasta revisar bases, conservación, políticas y contratos.

## Reglas básicas

- Captura de leads (`LEADS_ENABLED`) y analítica (`ANALYTICS_ENABLED`) apagadas hasta cerrar sus bloqueos en el plan.
- Astro + TypeScript + EmDash están aprobados exclusivamente para desarrollar el baseline local; comprobar y fijar versiones compatibles antes de instalar. Cloudflare Workers Paid + D1 + R2 está elegido como arquitectura prevista (D-20), sin autorización de contratación, provisión ni despliegue. Resend está elegido para correo transaccional, sin autorización de activación. No transferir datos ni importar el WXR bruto; B2/B3/B6a siguen abiertos.
- El baseline tendrá dos páginas de línea, streaming y comunicación/marketing, con igual peso en portada y navegación; el copy y las decisiones de migración de URLs siguen pendientes.
- EmDash se limita al blog, con pocas entradas por semana (D-15); páginas corporativas fuera del CMS. Auth nativo con passkeys para el baseline local (D-16), sin Supabase Auth. Permisos, recuperación y seguridad de producción todavía deben probarse.
- La propuesta híbrida, el flujo editorial, los límites de caché y la recuperación están en `docs/PLAN.md` §3. No se ha implementado ni probado esa arquitectura.

## Asana en omp

La conexión MCP nativa está definida en `.omp/mcp.json`, con transporte HTTP al [servidor oficial de Asana V2](https://developers.asana.com/docs/connecting-mcp-clients-to-asanas-v2-server). No requiere el plugin de Claude Code ni un proxy externo.

Estado: conexión autenticada y comprobada con la cuenta Jesús De Dios Sánchez, en «Mi espacio de trabajo». Proyecto de destino: [Directo Producciones](https://app.asana.com/1/1219137616145822/project/1219148016454235) (`1219148016454235`). Estructura registrada: ocho milestones, 31 tareas anidadas y 19 subtareas de detalle. Las seis tareas de ejemplo se eliminaron por petición del propietario. El proyecto sigue privado; no añadir miembros ni notificar a Sergio por registrar tareas de coordinación.

### Kanban freelance

Columnas, en orden: **📋 Pendiente → 🟢 Listo para trabajar → 🛠️ En curso → ⏳ Esperando cliente / terceros → 🔎 Revisión y validación → 🏁 Completado**. Los emoticonos se usan solo en las secciones. El tablero muestra ocho milestones; las 31 tareas están anidadas bajo ellos y conservan sus 19 subtareas de detalle. Las tareas internas no tienen pertenencia directa al proyecto para evitar tarjetas duplicadas, pero siguen accesibles desde su milestone y conservan sus dependencias.

- **Pendiente:** requisitos o dependencias todavía sin resolver.
- **Listo para trabajar:** requisitos de arranque disponibles. Revisar las tareas internas para iniciar trabajo parcial; no dar por listo un milestone completo si aún tiene dependencias pendientes.
- **En curso:** trabajo realmente iniciado; máximo recomendado de 2–3 tareas.
- **Esperando cliente / terceros:** registrar qué se pidió, a quién y qué falta; no usar como sustituto de una dependencia interna.
- **Revisión y validación:** resultado preparado, pendiente de verificar o aprobar.
- **Completado:** resultado verificado y aceptado; marcar también la tarea como completada en Asana.

No mover tareas por el mero avance de una fase ni marcar milestones completos sin comprobar sus criterios. Los títulos describen resultados comprensibles; los detalles técnicos y criterios de aceptación van en las descripciones.

La jerarquía organiza el trabajo, pero no sustituye las dependencias ni las aprobaciones. Completar una tarea interna no completa automáticamente su milestone; comprobar todos los criterios antes de cerrar el hito.

Las tareas se numeran como `M1.01 [P0] — Título` y sus subtareas como `M1.01.01 [P0] — Título`. **P0:** bloqueo/aprobación/seguridad; **P1:** ejecución necesaria; **P2:** seguimiento posterior acordado, no opcional. El listado completo y las excepciones de orden están en [`docs/PLAN.md`](docs/PLAN.md), §4 «Orden operativo por milestone». La numeración no cambia dependencias, estados ni autorizaciones.

Empezar por M1.01 y avanzar aprobación por aprobación. Search Console (M1.06.02) sigue aplazado; M6.01 debe adelantarse antes de provisionar proveedores y antes de datos reales en M5, aunque forme parte de la aceptación de lanzamiento.

### Registro de horas por milestone

Registrar en las **Notas de la tarea milestone correspondiente en Asana** el tiempo activo de cada bloque de trabajo, con fecha UTC, tarea relacionada, duración en minutos redondeada al minuto más cercano y una descripción breve. Al cerrar el bloque, sumar esos minutos al acumulado del milestone y mostrarlo también como horas:minutos; no duplicar tiempo entre milestones. Excluir esperas de respuesta del usuario o terceros. Si el trabajo afecta varios milestones, repartirlo solo si cada duración se midió; de lo contrario, atribuirlo al entregable principal. Registrar duración medida o declarada por la persona que trabajó; nunca inventar ni reconstruir horas anteriores sin evidencia. El tiempo previo a esta regla queda como **no medido**, no como cero.

### Milestones por entregable

1. M1 — Alcance y planificación acordados.
2. M2 — Base técnica preparada.
3. M3 — Estructura y diseño base validados internamente.
4. M4 — Baseline funcional listo para validar.
5. M5 — Captación y atención de presupuestos verificadas.
6. M6 — Lanzamiento autorizado.
7. M7 — Web publicada y migración comprobada.
8. M8 — Entrega al cliente y revisión posterior completadas.

M3 valida la estructura y la adaptación visual mínima del baseline. M4 construye primero el sitio funcional para trabajar desde esa base. Una tarea separada realiza después el UX/UI integral con diseñador y aplica el facelift tras aprobación; otra recoge la primera iteración de contenido y estrategia futura con Sergio Maya, después de la revisión interna y del diseño. La cadena diseño → contenido/estrategia debe completarse antes de iniciar M5 y autorizar M6: el baseline por sí solo no queda aprobado para el primer lanzamiento. Los claims y assets siguen sujetos a B2/B5. La autorización de lanzamiento exige auditoría, redirecciones y rollback comprobados y aprobación escrita. La entrega al cliente y revisión posterior cierran el seguimiento freelance.


### Autenticación de la conexión Asana

1. Crear o usar una aplicación MCP propia en la [consola de Asana](https://app.asana.com/0/my-apps) y registrar exactamente `http://localhost:3334/oauth/callback`.
2. Proporcionar `ASANA_CLIENT_ID` y `ASANA_CLIENT_SECRET` al proceso de omp mediante el entorno o un gestor de secretos. No pegarlos en el chat, no guardarlos en este repositorio ni poner sus valores en comandos del historial.
3. Iniciar omp con esas variables disponibles; ejecutar `/mcp reload` y `/mcp reauth asana` para autorizar la cuenta en el navegador.
4. Comprobar `/mcp list` y `/mcp test asana`; después listar los workspaces mediante las herramientas Asana y confirmar que la cuenta y el destino son los esperados antes de crear tareas.

La configuración solo contiene referencias a variables. omp mantiene las credenciales OAuth en el almacenamiento de autenticación del perfil; no deben copiarse de otro proyecto. La conexión no limita por sí sola el acceso a un proyecto de Asana: antes de escribir se debe confirmar el proyecto de destino.

## Modelos de omp

`gpt-6-luna` usa effort **`max`** por defecto en todos sus roles (`smol`, `task` y `commit`). Un esfuerzo diferente requiere justificación explícita para la tarea concreta; el nombre del rol o que el trabajo sea mecánico no justifican una reducción automática. La preferencia está guardada en la configuración global de omp.

Los roles de OpenAI se conservan. En la configuración global, `vision`, `tiny`, `memory` y `judge` usan `google-antigravity/gemini-3.8-flash`; `advisor` usa `google-antigravity/claude-sonnet-4-6`. Gemini 3.8 Flash, Sonnet 4.6 y Opus 4.6 respondieron a pruebas aisladas; las otras ocho variantes Claude consultadas devolvieron `404 NOT_FOUND`. Los overrides de `scout`/`reviewer` y las cadenas de fallback no cambiaron porque sus aprobaciones caducaron; Opus sigue disponible, pero no asignado.
