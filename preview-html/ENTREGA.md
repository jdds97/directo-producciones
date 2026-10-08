# Entrega M4 · Iteración 02 · páginas y guía

> **Refinamiento posterior — 8 de octubre:** cuatro correcciones y último feedback resueltos en las fuentes de diseño locales, con 78 vistas y rutas/motion comprobados. **No aplicados aún en Figma**: se mantienen los mismos IDs, sin nuevas capturas ni duplicados. Estado, evidencia y operación exacta pendiente en [refinements-01/ENTREGA.md](refinements-01/ENTREGA.md). La sección de importación siguiente describe la versión anterior añadida al archivo, no estas correcciones.

Alcance ampliado por Jesús: todas las páginas acordadas, claro/oscuro, escritorio/móvil y guía de estilos. Dirección común **La señal**, streaming protagonista, comunicación/marketing presentes. El baseline Astro/EmDash y los registros M1 no se modifican. No se publica ni se activa captación o analítica.

Las nuevas composiciones están **añadidas al archivo existente**. Lo acredita la respuesta de finalización de `generate_figma_design` con cada ID; no se toma un HTTP 200 ni el HTML local como prueba de revisión Figma. **La revisión visual/estructural final dentro de Figma sigue bloqueada**. Se conservan los originales y Exploraciones 01. Captura HTML semántica con texto, formas e imágenes discretas; ningún screenshot completo se importa como interfaz aplanada. La herramienta advierte que son raw frames, sin componentes/variables de biblioteca vinculados; su editabilidad y fuente nativas no se han auditado finalmente por el bloqueo.

Inicio claro definitivo: [Escritorio 35:2](https://www.figma.com/design/t9eDMrakGNb7B5LbRkozeR?node-id=35-2) · [Móvil 37:2](https://www.figma.com/design/t9eDMrakGNb7B5LbRkozeR?node-id=37-2). No se vuelve a importar. Los conjuntos siguientes llevan rótulos explícitos de tema/dispositivo: cada página nueva tiene claro/oscuro × escritorio 1440/móvil 390; Inicio aquí solo oscuro. 48 vistas de página en total contando los dos Inicio claros ya existentes, más 4 vistas de guía.

| Diseño | ID del conjunto y enlace | Vistas |
|---|---|---|
| Inicio | [41:2](https://www.figma.com/design/t9eDMrakGNb7B5LbRkozeR?node-id=41-2) | Oscuro · escritorio/móvil |
| Servicios | [42:2](https://www.figma.com/design/t9eDMrakGNb7B5LbRkozeR?node-id=42-2) | Claro/oscuro · escritorio/móvil |
| Clientes | [43:2](https://www.figma.com/design/t9eDMrakGNb7B5LbRkozeR?node-id=43-2) | Claro/oscuro · escritorio/móvil |
| Quiénes somos | [44:2](https://www.figma.com/design/t9eDMrakGNb7B5LbRkozeR?node-id=44-2) | Claro/oscuro · escritorio/móvil |
| Blog | [45:2](https://www.figma.com/design/t9eDMrakGNb7B5LbRkozeR?node-id=45-2) | Claro/oscuro · escritorio/móvil |
| Artículo | [46:2](https://www.figma.com/design/t9eDMrakGNb7B5LbRkozeR?node-id=46-2) | Claro/oscuro · escritorio/móvil |
| Contacto | [47:2](https://www.figma.com/design/t9eDMrakGNb7B5LbRkozeR?node-id=47-2) | Claro/oscuro · escritorio/móvil |
| 404 | [48:2](https://www.figma.com/design/t9eDMrakGNb7B5LbRkozeR?node-id=48-2) | Claro/oscuro · escritorio/móvil |
| Cookies | [49:2](https://www.figma.com/design/t9eDMrakGNb7B5LbRkozeR?node-id=49-2) | Claro/oscuro · escritorio/móvil |
| Privacidad | [50:2](https://www.figma.com/design/t9eDMrakGNb7B5LbRkozeR?node-id=50-2) | Claro/oscuro · escritorio/móvil |
| Aviso legal | [51:2](https://www.figma.com/design/t9eDMrakGNb7B5LbRkozeR?node-id=51-2) | Claro/oscuro · escritorio/móvil |
| EmDash interno | [52:2](https://www.figma.com/design/t9eDMrakGNb7B5LbRkozeR?node-id=52-2) | Claro/oscuro · escritorio/móvil |
| Guía de estilos | [53:2](https://www.figma.com/design/t9eDMrakGNb7B5LbRkozeR?node-id=53-2) | Claro/oscuro · escritorio/móvil |

Los IDs de la tabla son los contenedores devueltos por captura. No se inventan IDs de sus hijos. Registro de fuente/hash/resultado y correspondencia única: `suite/capture-ledger.json`. No se ha vuelto a capturar ninguna página definitiva tras la importación.

## Contenido y activos

D-38: logo original 200×200 y portada corporativa completos. En la versión previamente importada conservan el color original; el feedback posterior autoriza la variante blanca de Directo, preparada y comprobada en el refinamiento local pendiente de escritura Figma. D-42/facts aprobados: 16 logos en la franja inmediatamente debajo del hero, cifras exactas **2400 retransmisiones en streaming / 169 empresas han confiado en nuestros servicios / 7 marcas creadas**, dos testimonios completos y sus imágenes. Esos datos están dentro de los diseños de Inicio y Clientes, no en un apéndice. Se comprobaron en las fuentes de captura; la comprobación final del resultado Figma aún falta.

SEAT: el JPG de staging muestra un coche; se usa el logo real de [SEAT oficial](https://www.seat.es/content/dam/countries/es/seat-website/homepage/open-graph-generico/logo-seat.jpg), con procedencia en manifest. Canal Sur está integrado y coincide con SHA256 69055b32fff6ab2a60229453635918328a9714abae8f2d5e8191fc4804046e10. Turismo de Sevilla mantiene su nombre aprobado; el activo visible corresponde a Turismo de la Provincia/Diputación de Sevilla/Prodetur según inventario. TRH conserva su SVG blanco sobre apoyo azul. En modo oscuro los logos mantienen sus colores con apoyo blanco o azul según activo.

D-40 mantiene fotos/vídeos de trabajos aplazados. Se usan diagramas de señal; no se inventan casos ni trabajos. Blog/artículo, equipo y legales son plantillas con campos pendientes, no contenido factual/jurídico aprobado. Servicios aún `published_by_company`; contactos `decided`: textos de diseño pendientes de revisión de publicación. Contacto contempla teléfono, WhatsApp, email y formulario según D-23. EmDash es propuesta visual para el blog, no implementación del CMS.

## Guía y motion

Guía visual añadida: color claro/oscuro, tokens locales, Manrope y escala tipográfica, espaciado 4–96, layout responsive, botones default/hover/focus/pressed/disabled/loading, campos/error/checkbox/select/textarea, navegación activa/menú, iconos lineales, marca, componentes editoriales y motion. Contrato en `suite/tokens.json`. Las variables con modos, componentes/variantes vinculados, bindings y estilos nativos de la ampliación **no están configurados**; los existentes de Exploraciones 01 se preservan.

Motion CSS/WAAPI reproducido en el prototipo local y especificado en la guía y `MOTION.md`: triggers, propiedades, origen/destino, ms, delays, easing, orden, responsive y reduced-motion. Los tracks/transiciones nativos de esta iteración **no están configurados ni reproducidos**. La captura estática no transfiere estas animaciones. No se añaden librerías al futuro Astro ni se implementa ahora el sitio.

## Verificación y límites exactos

Chrome local: 75 vistas (1440/390/320, temas aplicables), sin scroll horizontal, imágenes rotas ni errores; Manrope cargada. Prueba social completa y exacta en Inicio oscuro/Clientes de ambos modos; Inicio claro tiene su QA previo. 36 combinaciones de contraste pasan: mínimo texto 5.39:1. Cinco escenarios de interacción y cuatro de CTA pasan: menú/foco/Escape/inert, errores y estado de formulario sin envío, reduced-motion y cambio de preferencia durante entrada. Evidencia: `evidence/suite-verification.json`, `suite-contrast.json`, `suite-interactions.json` y 50 capturas **locales**, claramente diferenciadas de Figma.

Figma MCP: no se repiten las llamadas de captura/vídeo que ya fallaron. Se intentó una operación distinta y necesaria: eliminar solo los cuatro intermedios por `use_figma`. También fue rechazada con “You've reached the Figma MCP tool call limit on the Starter plan”; respuesta guardada en `evidence/cleanup-api-result.json`. No hubo eliminación ni se reintentó. La escritura por captura sí funciona y devolvió los 13 IDs. La [documentación de acceso](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/) distingue límites de lectura y herramientas exentas; no se presupone exención de `use_figma`.

Figma en Orca carga el archivo como invitado, pero `Page.captureScreenshot` falla: “Screenshot timed out — the browser page did not draw a frame.” Cambiar zoom no lo restauró. Después de cerrar las pestañas consumidas y navegar a la guía 53:2, el mismo fallo impidió su revisión (`native-guide-review-result.json`). La exportación del canvas es negra; no cuenta como evidencia de diseño. La alternativa Chrome limpio devolvió **CloudFront 403**, conservado como evidencia de error (`figma-access-headless-403.png`), no captura final. La sesión invitada pide registro para inspección/edición. No se copian credenciales ni se eluden límites.

Falta comprobar visualmente los frames finales de escritorio/móvil y su contenido real dentro de Figma. Requisito: lectura/captura MCP disponible o navegador que dibuje el lienzo. Para completar biblioteca nativa, tracks y limpieza hace falta `use_figma` disponible o sesión Figma con edición. No se contratan planes ni se fuerza autenticación mientras el propietario está fuera.

## Duplicados conocidos

El usuario detectó correctamente cuatro capturas intermedias de Inicio: **28:2, 30:2, 31:2, 34:2**. Siguen pendientes de eliminación; no son finales. El importador añade frames y no ofrece eliminar o renombrar. `cleanup-intermediates.js` contiene esos cuatro IDs; se envió a la herramienta una vez, pero el bloqueo impidió ejecutarlo. Preserva original 2:1841, Exploraciones 01 19:2 y finales 35:2/37:2. No se repite Inicio claro ni se crean tres webs largas. Los cuatro temas/dispositivos de cada página nueva son las variantes expresamente solicitadas.

## Referencias aplicadas

[La Huella de Armstrong](https://lahuelladearmstrongestudio.com/productora-de-streaming-profesional-en-espana-emision-multicamara/) y [Dale al REC](https://dalealrec.com/directos-y-streaming/) se analizaron visualmente como referencias de streaming; [MEDIAPRO Broadcast](https://mediapro.tv/es/broadcast_media_services), como aspiracional de mayor escala. Se aplican streaming claro, prueba de confianza próxima y ritmo de bandas amplias; se evitan sus mezclas tipográficas, widgets flotantes, contadores, claims de infraestructura y bucles. No se copian activos. MEDIAPRO Events solo se pudo observar parcialmente y no se presenta como estudio visual completo. Capturas y observaciones en `RESEARCH.md`/`research/`.
