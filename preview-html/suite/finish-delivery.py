from pathlib import Path
import json,datetime
root=Path(__file__).resolve().parent.parent;ledger=json.loads((root/'suite/capture-ledger.json').read_text());inv=json.loads((root/'suite/inventory.json').read_text());names={p['key']:p['name']for p in inv['pages']};names['guia']='Guía de estilos';s=json.loads((root/'state.json').read_text());s['suiteFrames']={k:{'nodeId':v['nodeId'],'url':v['url'],'status':v['status']}for k,v in ledger['captures'].items()};s['localQA']={'views':75,'horizontalOverflowFailures':0,'missingImages':0,'fonts':'Manrope en todas las vistas','contrastPairs':36,'minTextContrast':5.39,'interactionScenarios':5,'approvedHomeContent':'16 logos / 2400,169,7 / 2 testimonios exactos','evidence':['evidence/suite-verification.json','evidence/suite-contrast.json','evidence/suite-interactions.json']};s['nativeReview']={'status':'blocked','MCP':'Cuota Starter agotada comunicada en iteración01; no se repiten use_figma/get_screenshot/export_video fallidos','Orca':'Figma design cargado como invitado; Page.captureScreenshot devuelve timeout porque no se dibuja un frame. Cambio de zoom tampoco restaura render. Canvas exportado resulta negro, no se cuenta como revisión. Controles de inspección/edición muestran registro de cuenta.','cleanHeadlessBrowser':'Respuesta CloudFront HTTP 403 al abrir el archivo Figma. No se elude ni se reutilizan credenciales.','nativeContentAssertions':'16 logos / 2 citas / 2400-169-7 comprobados en entrada de captura, todavía sin lectura visual/estructural final del resultado Figma','requirement':'Acceso de lectura/captura MCP disponible o navegador Figma que dibuje el lienzo; sesión con edición o use_figma disponible para limpiar IDs y completar variables/componentes/motion.'};s['completion']='Diseños añadidos a Figma; revisión nativa, componentización, motion nativo y limpieza de 4 intermedios pendientes. No se declara el encargo nativo totalmente terminado.';(root/'state.json').write_text(json.dumps(s,ensure_ascii=False,indent=2))
intro='''# Entrega M4 · Iteración 02 · páginas y guía

Alcance ampliado por Jesús: todas las páginas acordadas, claro/oscuro, escritorio/móvil y guía de estilos. Dirección común **La señal**, streaming protagonista, comunicación/marketing presentes. El baseline Astro/EmDash y los registros M1 no se modifican. No se publica ni se activa captación o analítica.

Las nuevas composiciones están **añadidas al archivo existente**. Lo acredita la respuesta de finalización de `generate_figma_design` con cada ID; no se toma un HTTP 200 ni el HTML local como prueba de revisión Figma. **La revisión visual/estructural final dentro de Figma sigue bloqueada**. Se conservan los originales y Exploraciones 01. Captura HTML semántica con texto, formas e imágenes discretas; ningún screenshot completo se importa como interfaz aplanada. La herramienta advierte que son raw frames, sin componentes/variables de biblioteca vinculados; su editabilidad y fuente nativas no se han auditado finalmente por el bloqueo.

Inicio claro definitivo: [Escritorio 35:2](https://www.figma.com/design/t9eDMrakGNb7B5LbRkozeR?node-id=35-2) · [Móvil 37:2](https://www.figma.com/design/t9eDMrakGNb7B5LbRkozeR?node-id=37-2). No se vuelve a importar. Los conjuntos siguientes llevan rótulos explícitos de tema/dispositivo: cada página nueva tiene claro/oscuro × escritorio 1440/móvil 390; Inicio aquí solo oscuro. 48 vistas de página en total contando los dos Inicio claros ya existentes, más 4 vistas de guía.

| Diseño | ID del conjunto y enlace | Vistas |
|---|---|---|
'''
for k,v in ledger['captures'].items():intro+=f'| {names[k]} | [{v["nodeId"]}]({v["url"]}) | '+('Oscuro · escritorio/móvil'if k=='inicio'else'Claro/oscuro · escritorio/móvil')+' |\n'
intro+='''
Los IDs de la tabla son los contenedores devueltos por captura. No se inventan IDs de sus hijos. Registro de fuente/hash/resultado y correspondencia única: `suite/capture-ledger.json`. No se ha vuelto a capturar ninguna página definitiva tras la importación.

## Contenido y activos

D-38: logo original 200×200 y portada corporativa, completos y sin recoloración. D-42/facts aprobados: 16 logos en la franja inmediatamente debajo del hero, cifras exactas **2400 retransmisiones en streaming / 169 empresas han confiado en nuestros servicios / 7 marcas creadas**, dos testimonios completos y sus imágenes. Esos datos están dentro de los diseños de Inicio y Clientes, no en un apéndice. Se comprobaron en las fuentes de captura; la comprobación final del resultado Figma aún falta.

SEAT: el JPG de staging muestra un coche; se usa el logo real de [SEAT oficial](https://www.seat.es/content/dam/countries/es/seat-website/homepage/open-graph-generico/logo-seat.jpg), con procedencia en manifest. Canal Sur está integrado y coincide con SHA256 69055b32fff6ab2a60229453635918328a9714abae8f2d5e8191fc4804046e10. Turismo de Sevilla mantiene su nombre aprobado; el activo visible corresponde a Turismo de la Provincia/Diputación de Sevilla/Prodetur según inventario. TRH conserva su SVG blanco sobre apoyo azul. En modo oscuro los logos mantienen sus colores con apoyo blanco o azul según activo.

D-40 mantiene fotos/vídeos de trabajos aplazados. Se usan diagramas de señal; no se inventan casos ni trabajos. Blog/artículo, equipo y legales son plantillas con campos pendientes, no contenido factual/jurídico aprobado. Servicios aún `published_by_company`; contactos `decided`: textos de diseño pendientes de revisión de publicación. Contacto contempla teléfono, WhatsApp, email y formulario según D-23. EmDash es propuesta visual para el blog, no implementación del CMS.

## Guía y motion

Guía visual añadida: color claro/oscuro, tokens locales, Manrope y escala tipográfica, espaciado 4–96, layout responsive, botones default/hover/focus/pressed/disabled/loading, campos/error/checkbox/select/textarea, navegación activa/menú, iconos lineales, marca, componentes editoriales y motion. Contrato en `suite/tokens.json`. Las variables con modos, componentes/variantes vinculados, bindings y estilos nativos de la ampliación **no están configurados**; los existentes de Exploraciones 01 se preservan.

Motion CSS/WAAPI reproducido en el prototipo local y especificado en la guía y `MOTION.md`: triggers, propiedades, origen/destino, ms, delays, easing, orden, responsive y reduced-motion. Los tracks/transiciones nativos de esta iteración **no están configurados ni reproducidos**. La captura estática no transfiere estas animaciones. No se añaden librerías al futuro Astro ni se implementa ahora el sitio.

## Verificación y límites exactos

Chrome local: 75 vistas (1440/390/320, temas aplicables), sin scroll horizontal, imágenes rotas ni errores; Manrope cargada. Prueba social completa y exacta en Inicio oscuro/Clientes de ambos modos; Inicio claro tiene su QA previo. 36 combinaciones de contraste pasan: mínimo texto 5.39:1. Cinco escenarios de interacción pasan: menú/foco/Escape/inert, errores y estado de formulario sin envío, reduced-motion y cambio de preferencia durante entrada. Evidencia: `evidence/suite-verification.json`, `suite-contrast.json`, `suite-interactions.json` y 50 capturas **locales**, claramente diferenciadas de Figma.

Figma MCP: se respeta el bloqueo de cuota previamente comunicado para `use_figma`, `get_screenshot` y reproducción; no se repiten sus errores. La escritura por captura sí funciona y devolvió los 13 IDs. La [documentación de acceso](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/) distingue límites de lectura y herramientas exentas; no se presupone exención de `use_figma`.

Figma en Orca carga el archivo como invitado, pero `Page.captureScreenshot` falla: “Screenshot timed out — the browser page did not draw a frame.” Cambiar zoom no lo restauró. La exportación del canvas es negra; no cuenta como evidencia de diseño. La alternativa Chrome limpio devolvió **CloudFront 403**, conservado como evidencia de error (`figma-access-headless-403.png`), no captura final. La sesión invitada pide registro para inspección/edición. No se copian credenciales ni se eluden límites.

Falta comprobar visualmente los frames finales de escritorio/móvil y su contenido real dentro de Figma. Requisito: lectura/captura MCP disponible o navegador que dibuje el lienzo. Para completar biblioteca nativa, tracks y limpieza hace falta `use_figma` disponible o sesión Figma con edición. No se contratan planes ni se fuerza autenticación mientras el propietario está fuera.

## Duplicados conocidos

El usuario detectó correctamente cuatro capturas intermedias de Inicio: **28:2, 30:2, 31:2, 34:2**. Siguen pendientes de eliminación; no son finales. El importador añade frames y no ofrece eliminar o renombrar. `cleanup-intermediates.js` está preparado con esos cuatro IDs y **no se ha ejecutado**. Preserva original 2:1841, Exploraciones 01 19:2 y finales 35:2/37:2. No se repite Inicio claro ni se crean tres webs largas. Los cuatro temas/dispositivos de cada página nueva son las variantes expresamente solicitadas.

## Referencias aplicadas

[La Huella de Armstrong](https://lahuelladearmstrongestudio.com/productora-de-streaming-profesional-en-espana-emision-multicamara/) y [Dale al REC](https://dalealrec.com/directos-y-streaming/) se analizaron visualmente como referencias de streaming; [MEDIAPRO Broadcast](https://mediapro.tv/es/broadcast_media_services), como aspiracional de mayor escala. Se aplican streaming claro, prueba de confianza próxima y ritmo de bandas amplias; se evitan sus mezclas tipográficas, widgets flotantes, contadores, claims de infraestructura y bucles. No se copian activos. MEDIAPRO Events solo se pudo observar parcialmente y no se presenta como estudio visual completo. Capturas y observaciones en `RESEARCH.md`/`research/`.
'''
(root/'ENTREGA.md').write_text(intro)
# Índice local con enlaces reales de Figma, sin nuevas capturas del índice.
p=root/'suite/index.html';old=p.read_text();links='<section style="margin-top:48px"><h2 style="font-size:28px">Conjuntos añadidos a Figma</h2><p>Revisión nativa pendiente; los renders locales no la sustituyen. Inicio claro 35:2 / 37:2. Cuatro intermedios pendientes de limpieza.</p><nav>'+''.join(f'<a href="{v["url"]}" target="_blank" rel="noopener">{names[k]} · {v["nodeId"]}</a>'for k,v in ledger['captures'].items())+'</nav></section>';p.write_text(old.replace('</div></body>',links+'</div></body>'))
print('Documentación, estado y enlaces reales actualizados; revisión nativa marcada pendiente.')
