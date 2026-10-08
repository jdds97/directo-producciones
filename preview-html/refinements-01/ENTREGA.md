# Refinamiento 01 · Iteración 02 · estado real

Las correcciones están realizadas en las **fuentes locales de diseño**, sin tocar Astro, CMS ni registros M1. Se han comprobado en Chrome, escritorio/móvil y claro/oscuro. **Todavía no están aplicadas en Figma**. No se crea otro Inicio ni se emiten nuevas capturas.

- Hero: se elimina el rótulo gigante DIRECTO; título «Tu evento. En streaming.» y gráfico Evento → Realización → Emisión. Un solo gráfico en Inicio, con leyenda y etiquetas claras.
- Marca: Directo azul en claro; blanco transparente fiel al JPG en oscuro, header/footer y guía. Original intacto. [SVG fuente](../assets/logo-white.svg), [PNG transparente para importación](../assets/logo-white.png), [procedencia y método](../assets/brand-variants.json). Raster 200×200; no se presenta como logo vectorial definitivo. Las esquinas tienen alfa 0 y la tinta es blanca, sin rectángulo de fondo.
- Clientes en oscuro: franja clara uniforme para conservar colores y legibilidad; TRH blanco mantiene apoyo azul. Los 16 activos y nombres autorizados permanecen; no hay inversión de logos o fotografías.
- Avatares: círculo de 80×80 en todos los tamaños/temas. Recorte personalizado y escala óptica comparable: Rafael rostro de referencia ~34×53 px, José ~33×53 px. Medición orientativa manual complementada con revisión visual a tamaño real; retratos originales intactos. [Detalle desktop](evidence/clientes-light-desktop-testimonios.png) y [detalle móvil oscuro](evidence/clientes-dark-mobile-testimonios.png).
- Streaming: dos enlaces visibles «Ver formato». Eventos → Servicios / #servicios-streaming; TV online → Servicios / #tv-online. Explicaciones en una única página de Servicios; modo/dispositivo y fragmento conservados. Cabecera/footer de Inicio claro enlazan ya con las maquetas existentes; se elimina el aviso obsoleto de que esas páginas no están diseñadas. Son rutas probadas del prototipo local; las conexiones de prototipo Figma están pendientes de escritura.
- Quiénes somos: presentación «Un equipo. Varias formas de comunicar.» con texto sobre la productora, su equipo multidisciplinar y sus disciplinas. Composición editorial y cierre propio, sin repetir «Antes de emitir, hablemos». Texto recuperado/parafraseado de [Empresa en la web antigua](https://www.directoproducciones.com/quienes-somos/) por instrucción del propietario; borrador editorial en revisión, no validación nueva de facts ni afirmación de miembros de equipo inventados. [Procedencia y omisiones](legacy-about-source.json).

Se preservan íntegros D-42: **16 logos, 2400/169/7 y dos testimonios completos con atribuciones exactas**. D-40 mantiene aplazadas las fotos/vídeos de trabajos. No se inventan casos ni se reutilizan retratos de clientes como equipo. B5 sigue pendiente antes del lanzamiento.

## Evidencia comprobada

[Galería local de todas las vistas afectadas](index.html). Capturas reales de navegador, **no capturas Figma**: [Inicio desktop oscuro](evidence/inicio-dark-desktop.png), [Inicio móvil claro](evidence/inicio-claro-light-mobile.png), [Quiénes somos desktop claro](evidence/quienes-somos-light-desktop.png), [Quiénes somos móvil oscuro](evidence/quienes-somos-dark-mobile.png).

- 78 vistas a 1440/390/320 px: sin desbordamientos, imágenes ausentes ni errores JS; fuente Manrope cargada. Marca correcta en todas las apariciones inspeccionadas; retratos sin deformación. [Resultado](evidence/verification.json).
- 12 escenarios: ocho rutas de formato y vuelta a Inicio (ambos temas/dispositivos), cuatro de hero/menú/foco/Escape/reduced-motion. [Resultado](evidence/navigation-motion.json).
- 27 combinaciones reales de texto/superficie de los bloques afectados: mínimo 5.86:1. Los estados CTA/campos restantes conservan la comprobación anterior; no se pretende haber rehecho la auditoría integral de estados. [Contraste](evidence/contrast.json).
- Máscara de marca con original embebido idéntico byte a byte, proporción 1:1 y transparencia; ambos recortes a escala comparable. [Activos](evidence/assets-verification.json).

Motion se conserva: entrada opacity .84→1/translateY12→0, 480 ms, delays 0/80/160, cubic-bezier(.2,.8,.2,1); menú 220/180 ms con foco e inert; estados CTA 160/100 ms. «Ver formato» usa la misma flecha y transición 160 ms. Reduced-motion elimina desplazamientos y transiciones sin ocultar contenido; se comprueba el cambio de preferencia durante reproducción. Anclas sin scroll animado. Implementación solo en prototipo de diseño local CSS/WAAPI; **no implementado en Astro y no configurado/reproducido en Figma**. [Especificación conservada](../MOTION.md).

## Figma: mismos nodos, revisión pendiente

- [inicio-claro-desktop · 35:2](https://www.figma.com/design/t9eDMrakGNb7B5LbRkozeR?node-id=35-2)
- [inicio-claro-mobile · 37:2](https://www.figma.com/design/t9eDMrakGNb7B5LbRkozeR?node-id=37-2)
- [inicio-oscuro · 41:2](https://www.figma.com/design/t9eDMrakGNb7B5LbRkozeR?node-id=41-2)
- [servicios · 42:2](https://www.figma.com/design/t9eDMrakGNb7B5LbRkozeR?node-id=42-2)
- [clientes · 43:2](https://www.figma.com/design/t9eDMrakGNb7B5LbRkozeR?node-id=43-2)
- [quienes-somos · 44:2](https://www.figma.com/design/t9eDMrakGNb7B5LbRkozeR?node-id=44-2)
- [blog · 45:2](https://www.figma.com/design/t9eDMrakGNb7B5LbRkozeR?node-id=45-2)
- [articulo · 46:2](https://www.figma.com/design/t9eDMrakGNb7B5LbRkozeR?node-id=46-2)
- [contacto · 47:2](https://www.figma.com/design/t9eDMrakGNb7B5LbRkozeR?node-id=47-2)
- [404 · 48:2](https://www.figma.com/design/t9eDMrakGNb7B5LbRkozeR?node-id=48-2)
- [cookies · 49:2](https://www.figma.com/design/t9eDMrakGNb7B5LbRkozeR?node-id=49-2)
- [privacidad · 50:2](https://www.figma.com/design/t9eDMrakGNb7B5LbRkozeR?node-id=50-2)
- [aviso-legal · 51:2](https://www.figma.com/design/t9eDMrakGNb7B5LbRkozeR?node-id=51-2)
- [guia · 53:2](https://www.figma.com/design/t9eDMrakGNb7B5LbRkozeR?node-id=53-2)

Estos enlaces abren la **versión anterior** existente, no una sincronización de este refinamiento. Los IDs son contenedores reales devueltos por el importador; no se inventan IDs de sus hijos. [Plan de cambios en sitio](figma-patch-plan.json).

La operación pendiente es **actualizar los nodos existentes mediante use_figma y comprobar el resultado nativo**. La operación de escritura previa ya devolvió el límite MCP Starter antes de ejecutar código: [respuesta exacta](../evidence/cleanup-api-result.json). No se reintenta ese error para confirmarlo ni se recaptura por una vía que añadiría más frames. Captura/vídeo MCP siguen bloqueados en el estado documentado; el navegador invitado no dibuja el lienzo y Chrome limpio devolvió CloudFront 403. No se afirma revisión visual nativa ni reproducción nativa de motion.

Hace falta disponibilidad de edición/lectura MCP o una sesión Figma con edición que renderice el lienzo. La autorización del propietario ya existe; no se solicita de nuevo ni se contratan planes. Original 2:1841 y Exploraciones 01 19:2/19:3–19:8 intactos. EmDash 52:2 no se replantea. Los intermedios 28:2/30:2/31:2/34:2 continúan pendientes de limpieza por el mismo bloqueo.


Intento posterior solicitado expresamente por Jesús («dale caña y actualízalo en Figma»): se envió la actualización en sitio del titular de 35:2 mediante use_figma. Figma volvió a devolver el límite MCP Starter antes de ejecutar código. [Respuesta real](evidence/figma-inplace-attempt.json). Cero nodos modificados, cero frames nuevos. Se inspeccionó una vía distinta, la ventana externa de Brave con el archivo abierto: el automatizador expone únicamente el frame de la ventana, sin controles Figma ni soporte de screenshot/foco. No se actuó a ciegas. La entrega nativa permanece pendiente.


Reintento solicitado expresamente por Jesús («puedes volver a intentarlo?»), 2026-10-08 21:24:06 UTC: use_figma volvió a rechazar la actualización en sitio de 35:2 por límite MCP Starter, antes de ejecutar el código. Sin modificaciones ni frames nuevos. [Respuesta íntegra](evidence/figma-explicit-retry.json).


Reintento solicitado expresamente por Jesús en el nuevo día, 2026-10-08 22:02:00 UTC: use_figma volvió a rechazar la actualización en sitio de 35:2 por límite MCP Starter, antes de ejecutar código. Sin modificaciones ni frames nuevos. [Respuesta íntegra](evidence/figma-new-day-retry.json).
