// Contrato de contenido editable. Única fuente de campos, límites y clasificación.
// Texto y fotos son editables: cada foto de contenido es una «ranura de imagen» (`images`) con selector de la
// biblioteca autorizada del sitio o de la biblioteca de medios de EmDash, texto alternativo y marca de decorativa.
// Estructura, maquetación, tipografía, iconos y SVG de interfaz viven en el código. Cada campo de texto conserva
// `key` (clave heredada `tNNN` de src/content/m4-draft.json) para que la migración y la capa de lectura sean 1:1.
// Los números/datos de contacto con hecho aprobado NO aparecen: son `fixed` y salen de facts.yaml.
import { mediaKeys, videoLibraryKeys, type MediaGroup } from '../lib/media-registry.ts';

export type Kind = 'page' | 'legal' | 'shared' | 'chrome';
/** Campos de imagen generados por una ranura: la foto elegida, la foto del sitio, el texto alternativo, decorativa y derechos. */
export type MediaRole = 'image' | 'ref' | 'alt' | 'decor' | 'rights' | 'video' | 'vref';
export interface FieldDef {
  key: string; slug: string; label: string; section: string; /** Bloque heredado si difiere del de la colección. */ block?: string; /** Texto inicial cuando no hay clave heredada (texto extraído del componente). */ default?: string;
  /** Tipo EmDash cuando no es texto; los campos de texto no lo declaran. */ type?: 'image' | 'file' | 'select' | 'boolean'; options?: string[]; media?: MediaRole;
}
/** Ranura de imagen: una foto de contenido de una página. `ref`/`alt` son los valores actuales del sitio (por defecto). */
export interface ImageSlotDef {
  slug: string; label: string; section: string; /** Clave de la biblioteca del sitio (src/lib/media-registry.ts). */ ref: string; alt: string;
  /** Campo de texto alternativo ya existente (clave heredada) en lugar de uno nuevo. */ altSlug?: string; altKey?: string;
  /** Decorativa por defecto (alt vacío). */ decor?: boolean; groups: MediaGroup[]; /** object-position por defecto de la foto del sitio. */ focus?: string;
}
export interface CollectionDef {
  slug: string; label: string; labelSingular: string; block: string; kind: Kind; icon: string; sortOrder: number;
  /** Rutas públicas que renderizan esta colección (el panel y el smoke las usan). */
  routes: string[]; fields: FieldDef[]; /** Fotos de contenido editables de la página. */ images?: ImageSlotDef[];
  /** Vídeos de contenido editables de la página (MP4 subido a la biblioteca de medios o vídeo del sitio). */ videos?: VideoSlotDef[];
}
/** Ranura de vídeo: un MP4 de la página. `ref` es la clave del vídeo del sitio (src/lib/media-registry.ts) que se usa mientras no se sube uno propio. */
export interface VideoSlotDef { slug: string; label: string; section: string; ref: string }
/** Claves del borrador que NO se editan desde el CMS, con motivo (el guard exige clasificar todas). */
export interface FixedDef { block: string; keys: string[]; reason: string }

// Sintaxis de fila: "t001 slug Etiqueta legible".
const sec = (section: string, prefix: string, rows: string[], block?: string): FieldDef[] =>
  rows.map(row => {
    const [key, name, ...label] = row.split(' ');
    return { key, slug: `${prefix}_${name}`, label: `${section} · ${label.join(' ')}`, section, ...(block ? { block } : {}) };
  });

/** Campos extraídos de texto que estaba escrito en el componente: sin clave heredada, con valor inicial. */
const ext = (section: string, rows: [string, string, string][]): FieldDef[] =>
  rows.map(([slug, label, def]) => ({ key: '', slug, label: `${section} · ${label}`, section, default: def }));
const CTA = ['t001 eyebrow Etiqueta', 't002 titulo_a Titular, línea 1', 't003 titulo_b Titular, línea 2', 't004 texto Texto', 't005 boton Botón'];
const heroRows = (p = 'hero') => [`t001 eyebrow Etiqueta`, `t002 titulo_a Titular, línea 1`, `t003 titulo_b Titular, línea 2`, `t004 entradilla Entradilla`];

/** Atajo de ranura: `sl('Sección', 'slug', 'Etiqueta', 'clave/de/biblioteca', 'texto alternativo', grupos, extras)`. */
const PHOTO: MediaGroup[] = ['equipo', 'servicio', 'cobertura'];
const vs = (section: string, slug: string, label: string, ref: string): VideoSlotDef => ({ slug, label, section, ref });
const sl = (section: string, slug: string, label: string, ref: string, alt: string, groups: MediaGroup[] = PHOTO, extra: Partial<ImageSlotDef> = {}): ImageSlotDef =>
  ({ slug, label, section, ref, alt, groups, ...extra });

export const collections: CollectionDef[] = [
  { slug: 'page_home', label: 'Inicio', labelSingular: 'Página Inicio', block: 'Home', kind: 'page', icon: 'house', sortOrder: 10, routes: ['/'], images: [
      sl('Portada', 'hero_poster', 'Imagen de espera del vídeo de portada', 'coberturas/hero-review-poster', '', PHOTO, { decor: true }),
      sl('Servicio 1', 'serv_1_foto', 'Foto', 'servicios/streaming-realizacion', 'Dos operadores trabajando en una mesa de realización de un evento'),
      sl('Servicio 2', 'serv_2_foto', 'Foto', 'servicios/directos-1', 'Dos cámaras de vídeo sobre trípodes frente a una pista deportiva cubierta'),
      sl('Servicio 3', 'serv_3_foto', 'Foto', 'servicios/programas-entrevista', 'Set de entrevista con dos participantes, micrófonos y dos cámaras'),
      sl('Servicio 4', 'serv_4_foto', 'Foto', 'servicios/directos-8', 'Grabación de una entrevista a un futbolista junto al campo, con cámara y micrófono'),
    ],
    videos: [
      vs('Portada', 'hero_video', 'Vídeo de portada (escritorio)', 'coberturas/hero-review-desktop'),
      vs('Portada', 'hero_video_movil', 'Vídeo de portada (móvil, opcional: vacío = el de escritorio)', 'coberturas/hero-review-mobile'),
    ],
    fields: [
      { key: '', slug: "hero_eyebrow", label: "Portada · Etiqueta", section: "Portada", default: "Streaming · Comunicación · Marketing" },
      { key: '', slug: "hero_linea_1", label: "Portada · Titular, línea 1", section: "Portada", default: "Que se vea." },
      { key: '', slug: "hero_linea_2", label: "Portada · Titular, línea 2", section: "Portada", default: "Que se escuche." },
      { key: '', slug: "hero_linea_3", label: "Portada · Titular, línea 3", section: "Portada", default: "Que importe." },
      { key: '', slug: "hero_entradilla", label: "Portada · Entradilla", section: "Portada", default: "Tu evento en directo. Tu marca en conversación. Streaming, comunicación y marketing para lo que quieres contar." },
      { key: '', slug: "hero_cta_prod", label: "Portada · Enlace a Producción", section: "Portada", default: "Explorar streaming" },
      { key: '', slug: "hero_cta_com", label: "Portada · Enlace a Comunicación", section: "Portada", default: "Explorar comunicación y marketing" },
      { key: '', slug: "pres_eyebrow", label: "Presentación · Etiqueta", section: "Presentación", default: "Presentación" },
      { key: '', slug: "pres_titulo", label: "Presentación · Título", section: "Presentación", default: "Somos Directo Producciones." },
      { key: '', slug: "pres_entradilla", label: "Presentación · Entradilla", section: "Presentación", default: "Unimos estrategia, creatividad y producción para conectar con tu público." },
      { key: '', slug: "pres_perfiles", label: "Presentación · Texto sobre los perfiles", section: "Presentación", default: "Reunimos los perfiles que necesita cada proyecto." },
      { key: '', slug: "pres_enlace", label: "Presentación · Enlace", section: "Presentación", default: "Conoce Directo" },
      { key: '', slug: "port_eyebrow", label: "Portfolio · Etiqueta", section: "Portfolio", default: "Portfolio" },
      { key: '', slug: "port_titulo", label: "Portfolio · Título", section: "Portfolio", default: "Trabajos recientes" },
      { key: '', slug: "port_entradilla", label: "Portfolio · Entradilla", section: "Portfolio", default: "Una selección de nuestros proyectos audiovisuales." },
      { key: '', slug: "port_ver_todos", label: "Portfolio · Enlace a todos los proyectos", section: "Portfolio", default: "Ver todos los proyectos" },
      { key: '', slug: "port_ver_servicios", label: "Portfolio · Enlace a servicios", section: "Portfolio", default: "Consultar servicios" },
      { key: '', slug: "serv_eyebrow", label: "Servicios · Etiqueta", section: "Servicios", default: "Qué hacemos" },
      { key: '', slug: "serv_titulo", label: "Servicios · Título", section: "Servicios", default: "Servicios" },
      { key: '', slug: "serv_entradilla", label: "Servicios · Entradilla", section: "Servicios", default: "Producción audiovisual, comunicación y marketing digital para lo que quieres contar." },
      { key: '', slug: "serv_1_titulo", label: "Servicio 1 · Título", section: "Servicio 1", default: "Streaming de eventos" },
      { key: '', slug: "serv_1_texto", label: "Servicio 1 · Texto", section: "Servicio 1", default: "Retransmisión de eventos en directo con realización televisiva y proyectos de televisión online." },
      { key: '', slug: "serv_2_titulo", label: "Servicio 2 · Título", section: "Servicio 2", default: "Producción audiovisual" },
      { key: '', slug: "serv_2_texto", label: "Servicio 2 · Texto", section: "Servicio 2", default: "Cobertura informativa con cámaras ENG, sesiones fotográficas y vídeos corporativos para empresas, instituciones y medios de comunicación." },
      { key: '', slug: "serv_3_titulo", label: "Servicio 3 · Título", section: "Servicio 3", default: "Programas de televisión" },
      { key: '', slug: "serv_3_texto", label: "Servicio 3 · Texto", section: "Servicio 3", default: "Producción y realización de programas de televisión, desarrollando proyectos audiovisuales desde la planificación y grabación hasta la edición y postproducción." },
      { key: '', slug: "serv_4_titulo", label: "Servicio 4 · Título", section: "Servicio 4", default: "Comunicación integral" },
      { key: '', slug: "serv_4_texto", label: "Servicio 4 · Texto", section: "Servicio 4", default: "Soluciones de comunicación adaptadas: diseño y desarrollo de páginas web, gestión de redes sociales, campañas publicitarias, organización de eventos y difusión de notas de prensa." },
      { key: '', slug: "cont_eyebrow", label: "Contacto · Etiqueta", section: "Contacto", default: "Contacto" },
      { key: '', slug: "cont_titulo", label: "Contacto · Título", section: "Contacto", default: "Hablemos de tu proyecto" },
    ] },
  { slug: 'page_quienes', label: 'Quiénes somos', labelSingular: 'Página Quiénes somos', block: 'QuienesSomos', kind: 'page', icon: 'users', sortOrder: 20, routes: ['/quienes-somos/'], images: [
      sl('Portada', 'hero_foto', 'Foto de portada', 'equipo/equipo-10-sin-botella', 'Equipo de Directo Producciones con auriculares trabajando en un puesto de realización.'),
      sl('Equipo', 'escena_grupo', 'Foto de grupo', 'equipo/equipo-3', 'Foto colectiva del equipo de Directo Producciones tras una cobertura.'),
      sl('Equipo', 'escena_control', 'Foto de control', 'equipo/equipo-2', 'Tres integrantes del equipo con auriculares en un puesto de realización.'),
      sl('Equipo', 'escena_cobertura', 'Foto de cobertura', 'equipo/equipo-8', 'Dos integrantes del equipo con una cámara fotográfica entre los asistentes a un acto.'),
      sl('Fotografías', 'accion_1', 'Foto 1: operador con auriculares', 'equipo/equipo-12', 'Operador con auriculares junto a una cámara de vídeo en el interior de una iglesia.', PHOTO, { altSlug: 'foto_alt_operador', altKey: 't045' }),
      sl('Fotografías', 'accion_2', 'Foto 2: cobertura', 'equipo/equipo-7', 'Operación de cámara durante una cobertura audiovisual.', PHOTO, { altSlug: 'foto_alt_cobertura', altKey: 't047' }),
      sl('Fotografías', 'accion_3', 'Foto 3: control', 'equipo/equipo-9', 'Integrante del equipo con auriculares trabajando frente a una pantalla y una mesa de control.', PHOTO, { altSlug: 'foto_alt_control', altKey: 't049' }),
      sl('Cómo colaboramos', 'colabora_foto', 'Foto', 'equipo/equipo-5', 'Dos compañeros con auriculares siguiendo el desarrollo de una cobertura audiovisual.'),
    ],
    fields: [
      ...sec('Portada', 'hero', ['t001 eyebrow Etiqueta', 't002 titulo Titular', 't004 entradilla Entradilla']),
      ...sec('Historia', 'historia', ['t005 titulo Título', 't007 parrafo_1 Párrafo 1', 't008 parrafo_2 Párrafo 2']),
      ...sec('Cómo colaboramos', 'colabora', ['t010 eyebrow Etiqueta', 't011 titulo Título', 't012 entradilla Entradilla', 't013 linea_produccion Etiqueta de producción', 't014 linea_comunicacion Etiqueta de comunicación']),
      ...sec('Equipo', 'equipo', ['t018 eyebrow Etiqueta', 't019 titulo Título', 't021 entradilla Entradilla']),
      ...sec('Fotografías', 'foto', ['t043 pie_accion Pie: el equipo en acción', 't044 titulo_terreno Título: trabajo sobre el terreno']),
      ...sec('Bloques de texto', 'bloque', ['t052 com_titulo Comunicación, título', 't053 com_texto Comunicación, texto', 't054 prod_titulo Producción, título', 't055 prod_texto Producción, texto', 't056 antes_titulo Antes de empezar, título', 't057 antes_texto Antes de empezar, texto', 't058 durante_titulo Durante el proyecto, título', 't059 durante_texto Durante el proyecto, texto', ]),
    ] },
  { slug: 'page_produccion', label: 'Producción', labelSingular: 'Página Producción', block: 'StreamingLine', kind: 'page', icon: 'video', sortOrder: 30, routes: ['/streaming/'], images: [
      sl('Portada', 'hero_foto', 'Foto de portada', 'servicios/directos-4', 'Cámara de vídeo profesional en la cabina de un campo de fútbol durante un calentamiento.'),
      sl('Contenidos', 'tv_foto', 'Foto de programas de televisión', 'equipo/equipo-14', 'Operador con auriculares junto a una cámara de vídeo sobre trípode en el graderío de un auditorio.'),
      sl('Cobertura y directos', 'directos_grafico', 'Composición conceptual de directos', 'grafismos/directos-television-v2', 'Composición editorial con el cuerpo de una cámara de televisión y una mesa de realización con monitor, sobre fondo petróleo.'),
      sl('Edición y recursos', 'recursos_foto', 'Foto de equipo y recursos', 'equipo/equipo-8', 'Un fotógrafo con teleobjetivo y un compañero del equipo entre el público de un acto.'),
    ],
    fields: [
      ...sec('Portada', 'hero', ['t001 eyebrow Etiqueta', 't002 titulo_a Titular, línea 1', 't003 titulo_b Titular, línea 2', 't004 entradilla Entradilla']),
      ...sec('Streaming', 'stream', ['t006 titulo_a Titular, línea 1', 't007 titulo_b Titular, línea 2', 't008 descripcion Descripción', 't011 cta Botón']),
      ...sec('Recorrido de la señal', 'senal', []),
      ...sec('TV online', 'tv', ['t027 chip Etiqueta', 't028 descripcion Descripción', 't029 preguntas Preguntas guía', ]),
      ...sec('Contenidos', 'cont', ['t032 titulo Título', 't033 prepro_titulo Preproducción, título', 't034 prepro_texto Preproducción, texto', 't035 prod_titulo Grabación, título', 't036 prod_texto Grabación, texto', 't037 f1 Formato 1', 't038 f2 Formato 2', 't039 f3 Formato 3', 't040 f4 Formato 4', 't041 f5 Formato 5', 't042 f6 Formato 6', 't043 f7 Formato 7']),
      ...sec('Cobertura y directos', 'directos', ['t045 texto Texto', 't046 s1 Servicio 1', 't047 s2 Servicio 2', 't048 s3 Servicio 3', 't049 s4 Servicio 4', 't050 s5 Servicio 5', 't051 s6 Servicio 6']),
      ...sec('Edición y recursos', 'edicion', ['t054 edicion_titulo Edición, título', 't055 edicion_texto Edición, texto', 't056 equipo_titulo Equipo, título', 't057 equipo_texto Equipo, texto', 't058 r1 Recurso 1', 't060 r2 Recurso 2', 't061 r3 Recurso 3', 't062 r4 Recurso 4']),
      ...sec('Aplicaciones', 'apl', ['t065 texto Texto', 't066 c1 Contexto 1', 't067 c2 Contexto 2', 't068 c3 Contexto 3', 't069 c4 Contexto 4', 't070 tv_titulo Programas de TV, título', 't071 tv_texto Programas de TV, texto']),
      ...sec('Preguntas frecuentes', 'faq', ['t072 p1 Pregunta 1', 't073 r1 Respuesta 1', 't074 p2 Pregunta 2', 't075 r2 Respuesta 2', 't076 p3 Pregunta 3', 't077 r3 Respuesta 3', 't078 p4 Pregunta 4', 't079 r4 Respuesta 4']),
    ] },
  { slug: 'page_comunicacion', label: 'Comunicación y marketing', labelSingular: 'Página Comunicación', block: 'CommunicationLine', kind: 'page', icon: 'megaphone', sortOrder: 40, routes: ['/comunicacion-marketing/'], images: [
      sl('Portada', 'hero_foto', 'Foto de portada', 'servicios/comunicacion-marketing-hero', 'Rueda de prensa con una pantalla al fondo y periodistas con portátiles en primer término.'),
      sl('Eventos', 'eventos_foto', 'Foto de eventos', 'servicios/directos-11', 'Declaración ante la prensa frente a un edificio histórico, con cámaras de televisión y micrófonos delante del portavoz.', PHOTO, { focus: '50% 62%' }),
    ],
    fields: [
      ...sec('Portada', 'hero', ['t001 eyebrow Etiqueta', 't002 titulo_a Titular, línea 1', 't003 titulo_b Titular, línea 2', 't004 entradilla Entradilla']),
      ...sec('Servicios', 'serv', []),
      ...sec('Estrategia', 'estr', ['t009 etiqueta Etiqueta', 't010 titulo Título', 't011 texto Texto', 't012 punto_1 Punto 1', 't013 punto_2 Punto 2']),
      ...sec('Prensa', 'prensa', ['t014 etiqueta Etiqueta', 't015 titulo Título', 't016 texto Texto', 't017 punto_1 Punto 1', 't018 punto_2 Punto 2']),
      ...sec('Redes', 'redes', ['t019 etiqueta Etiqueta', 't020 titulo Título', 't021 texto Texto', 't022 punto_1 Punto 1', 't023 punto_2 Punto 2']),
      ...sec('Web', 'web', ['t024 etiqueta Etiqueta', 't025 titulo Título', 't026 texto Texto', 't027 punto_1 Punto 1', 't028 punto_2 Punto 2']),
      ...sec('Buscadores', 'buscadores', ['t029 etiqueta Etiqueta', 't030 titulo Título', 't031 texto Texto', 't032 punto_1 Punto 1', 't033 punto_2 Punto 2']),
      ...sec('Eventos', 'eventos', ['t035 etiqueta Etiqueta', 't036 titulo Título', 't037 texto Texto', 't038 punto_1 Punto 1', 't039 punto_2 Punto 2']),
      ...sec('Cierre', 'cta', ['t008 texto Texto', ]),
      ...sec('Producción audiovisual', 'prod', ['t040 titulo Título', 't041 texto Texto', 't042 enlace Texto del enlace']),
      ...sec('Preguntas frecuentes', 'faq', ['t043 p1 Pregunta 1', 't044 r1 Respuesta 1', 't045 p2 Pregunta 2', 't046 r2 Respuesta 2', 't047 p3 Pregunta 3', 't048 r3 Respuesta 3', 't049 p4 Pregunta 4', 't050 r4 Respuesta 4']),
    ] },
  { slug: 'page_servicios', label: 'Servicios', labelSingular: 'Página Servicios', block: 'Servicios', kind: 'page', icon: 'list', sortOrder: 50, routes: ['/servicios/'],
    fields: [
      ...sec('Portada', 'hero', ['t001 eyebrow Etiqueta', 't002 titulo_a Titular, línea 1', 't003 titulo_b Titular, línea 2', 't004 entradilla Entradilla', 't005 cta Botón']),
      ...sec('Índice', 'indice', ['t006 aria Texto accesible del índice', 't007 enlace_1 Enlace 1', 't008 enlace_2 Enlace 2', 't009 enlace_3 Enlace 3']),
      ...sec('Streaming', 'stream', ['t010 eyebrow Etiqueta', 't011 titulo_a Titular, línea 1', 't012 titulo_b Titular, línea 2', 't013 descripcion Descripción', 't014 chip_1 Etiqueta 1', 't015 chip_2 Etiqueta 2', 't016 cta Botón']),
      ...sec('Recorrido de la señal', 'senal', ['t017 aria Texto accesible del gráfico', 't018 eyebrow Etiqueta', 't019 titulo Título', 't020 num_1 Número 1', 't021 paso_1 Paso 1', 't022 desc_1 Descripción 1', 't023 num_2 Número 2', 't024 paso_2 Paso 2', 't025 desc_2 Descripción 2', 't026 num_3 Número 3', 't027 paso_3 Paso 3', 't028 desc_3 Descripción 3']),
      ...sec('TV online', 'tv', ['t029 eyebrow Etiqueta', 't030 titulo_a Titular, línea 1', 't031 titulo_b Titular, línea 2', 't032 chip Etiqueta', 't033 descripcion Descripción', 't034 preguntas Preguntas guía', 't035 cta Botón']),
      ...sec('Comunicación', 'comm', ['t036 eyebrow Etiqueta', 't037 titulo_a Titular, línea 1', 't038 titulo_b Titular, línea 2', 't039 chip_1 Etiqueta 1', 't040 descripcion Descripción', 't041 chip_2 Etiqueta 2', 't042 chip_3 Etiqueta 3', 't043 cta Botón']),
      ...sec('Marketing digital', 'mkt', ['t044 eyebrow Etiqueta', 't045 titulo_a Titular, línea 1', 't046 titulo_b Titular, línea 2', 't047 chip_1 Etiqueta 1', 't048 descripcion Descripción', 't049 chip_2 Etiqueta 2', 't050 chip_3 Etiqueta 3', 't051 cta Botón']),
    ] },
  { slug: 'page_clientes', label: 'Clientes', labelSingular: 'Página Clientes', block: 'Clientes', kind: 'page', icon: 'building', sortOrder: 60, routes: ['/clientes/'],
    fields: sec('Portada', 'hero', heroRows()) },
  { slug: 'page_contacto', label: 'Contacto', labelSingular: 'Página Contacto', block: 'Contacto', kind: 'page', icon: 'mail', sortOrder: 70, routes: ['/contacto/'], images: [
      // Solo la portada: los contactos directos usan las fotos de la lista «team» (getTeam('home')).
      sl('Portada', 'hero_foto', 'Foto de portada', 'equipo/juan-camara', 'Operador de cámara sonriente con una cámara de vídeo junto a un arco monumental.'),
    ],
    fields: [
      ...sec('Portada', 'hero', heroRows()),
      ...sec('Vías de contacto', 'vias', ['t005 telefono_rotulo Rótulo del teléfono', 't009 email_rotulo Rótulo del correo']),
      ...ext('Formulario', [
        ['form_titulo', 'Título (página de contacto)', 'Escríbenos'], ['form_titulo_home', 'Título (formulario de Inicio)', 'Cuéntanos tu proyecto'],
        ['form_nombre_rotulo', 'Rótulo del nombre', 'Nombre'], ['form_email_rotulo', 'Rótulo del correo', 'Correo para responderte'],
        ['form_servicio_rotulo', 'Rótulo del servicio', '¿Qué necesitas? (opcional)'], ['form_servicio_vacio', 'Opción vacía del servicio', 'Elige un servicio'],
        ['form_mensaje_rotulo', 'Rótulo del mensaje', 'Mensaje'],
      ]),
    ] },
  { slug: 'page_portfolio', label: 'Portfolio', labelSingular: 'Página Portfolio', block: 'Portfolio', kind: 'page', icon: 'film', sortOrder: 80, routes: ['/portfolio/'], images: [
      sl('Portada', 'hero_poster', 'Imagen de espera del vídeo de portada', 'coberturas/portfolio-reel', '', PHOTO, { decor: true }),
      sl('Portada', 'hero_poster_movil', 'Imagen de espera del vídeo (móvil)', 'coberturas/portfolio-reel-mobile', '', PHOTO, { decor: true }),
    ],
    fields: [
      ...sec('Portada', 'hero', ['t001 eyebrow Etiqueta', 't002 titulo Titular', 't003 entradilla Entradilla']),
      ...ext('Selección', [['vacio_texto', 'Texto cuando no hay proyectos publicados', 'Próximamente, nuevos trabajos.']]),
    ] },
  // Preguntas frecuentes: diseño fijo (grupos y orden en código); añadir o quitar una pregunta es un cambio de contrato.
  { slug: 'page_faq', label: 'Preguntas frecuentes', labelSingular: 'Página Preguntas frecuentes', block: 'PreguntasFrecuentes', kind: 'page', icon: 'list', sortOrder: 85, routes: ['/preguntas-frecuentes/'],
    fields: [
      ...sec('Portada', 'hero', heroRows()),
      ...sec('Streaming y producción', 'g1', ['t005 titulo Título', 't006 p1 Pregunta 1', 't007 r1 Respuesta 1', 't008 p2 Pregunta 2', 't009 r2 Respuesta 2',
        't010 p3 Pregunta 3', 't011 r3 Respuesta 3', 't012 p4 Pregunta 4', 't013 r4 Respuesta 4', 't014 enlace Texto del enlace a Producción']),
      ...sec('Comunicación y marketing', 'g2', ['t015 titulo Título', 't016 p1 Pregunta 1', 't017 r1 Respuesta 1', 't018 enlace Texto del enlace a Comunicación']),
      ...sec('Contratación y contacto', 'g3', ['t019 titulo Título', 't020 p1 Pregunta 1', 't021 r1 Respuesta 1', 't022 p2 Pregunta 2', 't023 r2 Respuesta 2',
        't024 p3 Pregunta 3', 't025 r3 Respuesta 3', 't026 p4 Pregunta 4', 't027 r4 Respuesta 4', 't028 enlace Texto del enlace a Quiénes somos']),
    ] },
  { slug: 'page_blog', label: 'Portada del blog', labelSingular: 'Portada del blog', block: 'Blog', kind: 'page', icon: 'newspaper', sortOrder: 90, routes: ['/blog/'], images: [
      sl('Portada', 'hero_foto', 'Foto de portada', 'servicios/produccion-eng', 'Un cámara graba desde la grada un partido de fútbol al atardecer.'),
    ],
    fields: sec('Portada', 'hero', heroRows()) },
  { slug: 'page_404', label: 'Error 404', labelSingular: 'Página 404', block: '404', kind: 'page', icon: 'warning', sortOrder: 95, routes: ['/404'],
    fields: sec('Contenido', 'err', ['t001 eyebrow Etiqueta', 't002 codigo Código', 't003 titulo_a Titular, línea 1', 't004 titulo_b Titular, línea 2', 't005 texto Texto', 't006 boton_inicio Botón a Inicio', 't007 boton_contacto Botón a Contacto']) },
  { slug: 'site_blocks', label: 'Bloques compartidos', labelSingular: 'Bloques compartidos', block: '*', kind: 'shared', icon: 'layers', sortOrder: 100, routes: ['/', '/servicios/', '/clientes/', '/streaming/', '/comunicacion-marketing/', '/quienes-somos/', '/preguntas-frecuentes/'], images: [
      sl('Banda de clientes', 'banda_poster', 'Imagen de espera del vídeo de fondo', 'coberturas/hero-review-poster', '', PHOTO, { decor: true }),
    ],
    videos: [
      vs('Banda de clientes', 'banda_video', 'Vídeo de fondo (escritorio)', 'coberturas/hero-review-desktop'),
      vs('Banda de clientes', 'banda_video_movil', 'Vídeo de fondo (móvil, opcional: vacío = el de escritorio)', 'coberturas/hero-review-mobile'),
    ],
    fields: [
      ...sec('Cierre general', 'cta_general', CTA, 'ProjectCTA'),
      ...sec('Cierre de Comunicación', 'cta_comm', CTA, 'CommunicationCTA'),
      ...sec('Cierre de Producción', 'cta_prod', CTA, 'ProductionCTA'),
      ...sec('Cierre de Quiénes somos', 'cta_about', CTA, 'AboutCTA'),
      ...sec('Cifras', 'cifras', ['t001 titulo_a Titular, línea 1', 't002 titulo_b Titular, línea 2', 't003 entradilla Entradilla'], 'Metrics'),
      ...sec('Banda de clientes', 'banda', [], 'ClientBand'),
    ] },
  { slug: 'site_chrome', label: 'Cabecera y pie', labelSingular: 'Cabecera y pie', block: 'Header+Footer', kind: 'chrome', icon: 'layout', sortOrder: 110, routes: ['/'],
    fields: [
      ...sec('Cabecera', 'cab', ['t010 boton_contacto Botón «Hablemos»'], 'Header'),
      ...sec('Pie', 'pie', ['t004 linea_1 Línea 1', 't005 linea_2 Línea 2', 't006 linea_3 Línea 3'], 'Footer'),
      // Etiquetas del menú; la estructura, el orden y los enlaces siguen en src/lib/site-navigation.ts.
      ...ext('Menú', [['nav_inicio', 'Inicio', 'Inicio'], ['nav_quienes-somos', 'Quiénes somos', 'Quiénes somos'], ['nav_portfolio', 'Portfolio', 'Portfolio'], ['nav_comunicacion', 'Comunicación', 'Comunicación'], ['nav_produccion', 'Producción', 'Producción'], ['nav_contacto', 'Contacto', 'Contacto'], ['nav_blog', 'Blog', 'Blog']]).map(f => ({ ...f, slug: f.slug.replace('-', '_'), block: 'Nav' })),
    ] },
  { slug: 'legal_cookies', label: 'Legal · Cookies', labelSingular: 'Política de cookies', block: 'Cookies', kind: 'legal', icon: 'shield', sortOrder: 120, routes: ['/cookies/'], fields: [] },
  { slug: 'legal_privacidad', label: 'Legal · Privacidad', labelSingular: 'Política de privacidad', block: 'Privacidad', kind: 'legal', icon: 'shield', sortOrder: 121, routes: ['/privacidad/'], fields: [] },
  { slug: 'legal_aviso', label: 'Legal · Aviso legal', labelSingular: 'Aviso legal', block: 'AvisoLegal', kind: 'legal', icon: 'shield', sortOrder: 122, routes: ['/aviso-legal/'], fields: [] },
  { slug: 'legal_condiciones', label: 'Legal · Condiciones', labelSingular: 'Condiciones del servicio', block: 'Condiciones', kind: 'legal', icon: 'shield', sortOrder: 123, routes: ['/condiciones/'], fields: [] },
];
// Los textos legales son una secuencia de unidades (título, párrafo, columna de tabla): campos numerados.
for (const col of collections.filter(c => c.kind === 'legal')) {
  col.fields = Array.from({ length: ({ Cookies: 29, Condiciones: 24 } as Record<string, number>)[col.block] ?? 18 }, (_, i) => {
    const n = String(i + 1).padStart(3, '0');
    return { key: `t${n}`, slug: `bloque_${n}`, label: `Bloque legal ${n}`, section: 'Texto legal' };
  });
}

/** Nombres de los campos que genera una ranura: el contrato, la semilla, la lectura y la política los comparten. */
export const imageFieldSlugs = (slot: { slug: string; altSlug?: string }) => ({ image: slot.slug, ref: `${slot.slug}_ref`, alt: slot.altSlug ?? `${slot.slug}_alt`, decor: `${slot.slug}_decor` });
/** Campos que genera una ranura de vídeo: el MP4 subido y la clave del vídeo del sitio. */
export const videoFieldSlugs = (slot: { slug: string }) => ({ file: slot.slug, ref: `${slot.slug}_ref` });
export const RIGHTS_FIELD = 'media_rights_source';
// Cada ranura añade: foto del sitio (selector cerrado), foto de la biblioteca de medios, texto alternativo y «decorativa».
for (const col of collections) {
  if (!col.images?.length) continue;
  for (const slot of col.videos ?? []) {
    const n = videoFieldSlugs(slot), name = `${slot.section} · ${slot.label}`;
    col.fields.push(
      { key: '', slug: n.ref, label: `${name} · Vídeo del sitio`, section: slot.section, type: 'select', options: videoLibraryKeys(), media: 'vref', default: slot.ref },
      { key: '', slug: n.file, label: `${name} · Vídeo MP4 de la biblioteca de medios (sustituye al del sitio)`, section: slot.section, type: 'file', media: 'video', default: '' },
    );
  }
  for (const slot of col.images) {
    const n = imageFieldSlugs(slot), name = `${slot.section} · ${slot.label}`;
    col.fields.push(
      { key: '', slug: n.ref, label: `${name} · Foto del sitio`, section: slot.section, type: 'select', options: mediaKeys(...slot.groups), media: 'ref', default: slot.ref },
      { key: '', slug: n.image, label: `${name} · Foto de la biblioteca de medios (sustituye a la del sitio)`, section: slot.section, type: 'image', media: 'image', default: '' },
      slot.altKey
        ? { key: slot.altKey, slug: n.alt, label: `${name} · Texto alternativo`, section: slot.section, media: 'alt' }
        : { key: '', slug: n.alt, label: `${name} · Texto alternativo`, section: slot.section, media: 'alt', default: slot.alt },
      { key: '', slug: n.decor, label: `${name} · Decorativa (sin texto alternativo)`, section: slot.section, type: 'boolean', media: 'decor', default: slot.decor ? 'true' : 'false' },
    );
  }
  col.fields.push({ key: '', slug: RIGHTS_FIELD, label: 'Fotos y vídeos · Derechos de los archivos subidos (quién autoriza y cuándo)', section: 'Fotos', media: 'rights', default: '' });
}

/** Claves del borrador no editables desde el CMS. */
export const fixedKeys: FixedDef[] = [
  { block: 'Contacto', keys: ['t007', 't027', 't028', 't029', 't031'], reason: 't007 y el acceso WhatsApp salen de WhatsAppAccess; t027–t029 y t031 son microcopy legal del consentimiento del formulario (teléfono y correo: publicContact() de facts.ts, nunca texto escrito a mano)' },
  { block: 'Blog', keys: ['t005', 't006', 't007', 't008', 't009', 't010', 't011', 't012', 't013', 't014', 't015', 't016', 't017', 't018', 't019', 't020', 't021', 't022'], reason: 'plantilla de diseño: las entradas reales salen de EmDash (posts)' },
  { block: 'Articulo', keys: Array.from({ length: 26 }, (_, i) => `t${String(i + 1).padStart(3, '0')}`), reason: 'plantilla de artículo: el contenido sale de la colección posts' },
  { block: 'Metrics', keys: ['t004', 't005', 't006', 't007', 't008', 't009'], reason: 'cifras 2400/169/7: hechos con aprobación independiente; CMS no las escribe' },
  { block: 'Home', keys: Array.from({ length: 45 }, (_, i) => `t${String(i + 1).padStart(3, '0')}`), reason: 'borrador anterior de Inicio: el componente actual lo sustituyó (campos extraídos en page_home)' },
  { block: 'QuienesSomos', keys: ['t024', 't025', 't026', 't027', 't028', 't029', 't030', 't031', 't032', 't033', 't034', 't035', 't036', 't037', 't038', 't039', 't040', 't041'], reason: 'nombres y cargos del equipo: pasan a la lista «team» (una fuente para Inicio y Quiénes somos); la semilla está en list-seeds.ts' },
  { block: "QuienesSomos", keys: ['t042', 't046', 't048', 't050', 't051', 't060', 't061', 't062', 't063'], reason: 'texto heredado sin uso: el componente actual lo sustituyó o lo escribe en código' },
  { block: "StreamingLine", keys: ['t005', 't009', 't010', 't012', 't013', 't014', 't015', 't016', 't017', 't018', 't019', 't020', 't021', 't022', 't023', 't024', 't025', 't026', 't030', 't031', 't044', 't052', 't053', 't063', 't064'], reason: 'texto heredado sin uso: el componente actual lo sustituyó o lo escribe en código' },
  { block: "CommunicationLine", keys: ['t005', 't006', 't007', 't034'], reason: 'texto heredado sin uso: el componente actual lo sustituyó o lo escribe en código' },
  { block: "ClientBand", keys: ['t001', 't002'], reason: 'texto heredado sin uso: el componente actual lo sustituyó o lo escribe en código' },
  { block: 'Contacto', keys: ['t011', 't012', 't013', 't014', 't015', 't016', 't017', 't018', 't019', 't020', 't021', 't022', 't023', 't024', 't025', 't026', 't030'], reason: 'texto heredado sin uso: el formulario real (ContactForm) usa los campos extraídos de page_contacto' },
  { block: 'Portfolio', keys: ['t004'], reason: 'mensaje de accesibilidad del reproductor' },
  { block: 'Testimonials', keys: Array.from({ length: 11 }, (_, i) => `t${String(i + 1).padStart(3, '0')}`), reason: 'testimonios retirados por decisión del propietario' },
  { block: 'Header', keys: Array.from({ length: 13 }, (_, i) => `t${String(i + 1).padStart(3, '0')}`).filter(k => k !== 't010'), reason: 'accesibilidad e interfaz: se mantienen en código (la etiqueta del botón «Hablemos» sí es editable)' },
  { block: 'Footer', keys: Array.from({ length: 18 }, (_, i) => `t${String(i + 1).padStart(3, '0')}`).filter(k => !['t004', 't005', 't006'].includes(k)), reason: 'navegación, aria y legales: derivan de site-navigation y del código' },
  { block: 'SignalFlow', keys: Array.from({ length: 12 }, (_, i) => `t${String(i + 1).padStart(3, '0')}`), reason: 'duplicado de los textos de recorrido de señal de Producción/Servicios; se edita allí' },
  { block: 'ClientBand', keys: Array.from({ length: 27 }, (_, i) => `t${String(i + 1).padStart(3, '0')}`).filter(k => !['t001', 't002'].includes(k)), reason: 'nombres de logos de la banda: pasan a la lista «band_logos» (logo, nombre, variante, orden y visibilidad)' },
  { block: 'Clientes', keys: Array.from({ length: 32 }, (_, i) => `t${String(i + 5).padStart(3, '0')}`), reason: 'directorio de clientes: pasa a la colección «clients»' },
  { block: 'StreamingLine', keys: ['t059'], reason: 'timelapse retirado de la presentación pública por decisión del cliente' },
  { block: 'Guia', keys: Array.from({ length: 170 }, (_, i) => `t${String(i + 1).padStart(3, '0')}`), reason: 'guía interna de estilos' },
  { block: 'GuiaDark', keys: ['background', 'surface', 'tint', 'text', 'muted', 'action', 'actionText', 'line', 'controlLine', 'focus', 'error', 'errorSurface'], reason: 'tokens de la guía interna' },
  ];

// ── Listas editables (una entrada por elemento) ─────────────────────────────────────────────
export interface ListField { slug: string; label: string; type: 'string' | 'text' | 'boolean' | 'integer' | 'select' | 'image' | 'file'; required?: boolean; max?: number; pattern?: string; options?: string[]; /** Valor inicial de las entradas nuevas. */ media?: MediaRole }
export interface ListDef { slug: string; label: string; labelSingular: string; icon: string; sortOrder: number; routes: string[]; titleField: string; fields: ListField[] }
export const videoKeys = ['rugby', 'abc-galisur', 'voley', 'lasexta', 'motocross'];
export const projectOrientations = ['vertical', 'horizontal'];
export const projectLayouts = ['grande', 'pila'];
export const projectCategories = ['directo', 'grabacion', 'deporte', 'comunicacion', 'otro'];
/** Tope de proyectos visibles en Portfolio (aviso, no bloqueo). */
export const PORTFOLIO_MAX = 12;
const rights: ListField[] = [
  { slug: 'visible', label: 'Mostrar en la web', type: 'boolean' },
  { slug: 'rights_ok', label: 'Derechos de uso confirmados', type: 'boolean' },
  { slug: 'rights_source', label: 'Evidencia de los derechos (quién autoriza y cuándo)', type: 'string', max: 200 },
  { slug: 'sort', label: 'Orden (menor primero)', type: 'integer', required: true },
];
/** Foto de una lista: selector de la biblioteca del sitio + foto de la biblioteca de medios (+ alt opcional). */
export const listImage = (prefix: string, label: string, groups: MediaGroup[], alt: boolean): ListField[] => [
  { slug: `${prefix}_ref`, label: `${label} · Foto del sitio`, type: 'select', options: mediaKeys(...groups), media: 'ref' },
  { slug: prefix, label: `${label} · Foto de la biblioteca de medios (sustituye a la del sitio)`, type: 'image', media: 'image' },
  ...(alt ? [{ slug: `${prefix}_alt`, label: `${label} · Texto alternativo`, type: 'string' as const, max: 160, media: 'alt' as const }] : []),
];
export const teamStates = ['con_foto', 'pendiente'];
/** Correo público aprobado de cada persona, por IDENTIFICADOR de la ficha (slug), nunca por el nombre visible. */
export const teamEmailFacts: Record<string, string> = {
  curro: 'contact.team_francisco_email', 'sergio-maya': 'contact.team_sergio_email', 'fran-vergara': 'contact.team_fran_email',
};
export const EMAIL_PATTERN = '^[^\\s@]+@[^\\s@]+\\.[A-Za-z]{2,}$';
export const bandVariants = ['normal', 'monocromo', 'escudo_monocromo', 'escudo_recorte', 'catedral', 'con_nombre'];
export const lists: ListDef[] = [
  { slug: 'clients', label: 'Clientes', labelSingular: 'Cliente', icon: 'building', sortOrder: 61, routes: ['/clientes/'], titleField: 'name',
    fields: [
      { slug: 'name', label: 'Nombre', type: 'string', required: true, max: 60 },
      ...listImage('logo', 'Logotipo', ['logo'], false),
      { slug: 'logo_dark', label: 'Logotipo claro sobre fondo oscuro', type: 'boolean' },
      ...rights,
    ] },
  { slug: 'band_logos', label: 'Banda de clientes (Inicio)', labelSingular: 'Logotipo de la banda', icon: 'building', sortOrder: 62, routes: ['/'], titleField: 'name',
    fields: [
      { slug: 'name', label: 'Nombre (texto alternativo)', type: 'string', required: true, max: 60 },
      ...listImage('logo', 'Logotipo', ['logo'], false),
      { slug: 'variant', label: 'Tratamiento del logotipo', type: 'select', required: true, options: bandVariants },
      ...rights,
    ] },
  { slug: 'projects', label: 'Proyectos', labelSingular: 'Proyecto', icon: 'film', sortOrder: 81, routes: ['/', '/portfolio/'], titleField: 'name',
    fields: [
      { slug: 'name', label: 'Título', type: 'string', required: true, max: 60 },
      { slug: 'context', label: 'Contexto', type: 'string', required: true, max: 70 },
      { slug: 'description', label: 'Descripción', type: 'text', required: true, max: 220 },
      { slug: 'client', label: 'Cliente (nombre visible junto al logotipo)', type: 'string', max: 60 },
      { slug: 'category', label: 'Categoría', type: 'select', options: projectCategories },
      { slug: 'year', label: 'Año del trabajo (opcional)', type: 'integer' },
      { slug: 'link', label: 'Enlace del título (ruta interna de la web, p. ej. /blog/; vacío = sin enlace)', type: 'string', max: 120, pattern: '^/[A-Za-z0-9/_-]*$' },
      { slug: 'video_key', label: 'Vídeo del sitio (pieza ya incorporada; se usa si no subes un MP4 propio)', type: 'select', options: videoKeys },
      { slug: 'video', label: 'Vídeo MP4 de la biblioteca de medios (sustituye al del sitio)', type: 'file', media: 'video' },
      { slug: 'video_vertical', label: 'Versión vertical del vídeo para móvil (opcional, MP4)', type: 'file', media: 'video' },
      { slug: 'orientation', label: 'Orientación del vídeo (vacío = la del vídeo del sitio o, con vídeo propio, vertical)', type: 'select', options: projectOrientations },
      { slug: 'home_layout', label: 'Tamaño en Inicio (vacío = según la orientación)', type: 'select', options: projectLayouts },
      ...listImage('poster', 'Imagen de espera del vídeo (obligatoria con vídeo propio)', ['cobertura'], false),
      { slug: 'show_home', label: 'Mostrar en «Trabajos recientes» de Inicio (sin marcar nunca = se muestra)', type: 'boolean' },
      { slug: 'home_sort', label: 'Orden en Inicio (menor primero; vacío = el orden de Portfolio)', type: 'integer' },
      ...rights,
    ] },
  { slug: 'team', label: 'Equipo', labelSingular: 'Persona del equipo', icon: 'users', sortOrder: 21, routes: ['/', '/quienes-somos/'], titleField: 'name',
    fields: [
      { slug: 'name', label: 'Nombre (en Quiénes somos)', type: 'string', required: true, max: 60 },
      { slug: 'name_home', label: 'Nombre en Inicio (solo si se escribe distinto)', type: 'string', max: 60 },
      { slug: 'role', label: 'Cargo', type: 'string', required: true, max: 60 },
      { slug: 'bio', label: 'Presentación breve (opcional; se muestra bajo el cargo)', type: 'text', max: 400 },
      { slug: 'email', label: 'Correo público bajo el perfil en Inicio (vacío = el correo aprobado de la ficha; otro valor lo aprueba un administrador)', type: 'string', max: 80, pattern: EMAIL_PATTERN },
      { slug: 'photo_state', label: 'Estado de la foto', type: 'select', required: true, options: teamStates },
      ...listImage('photo', 'Retrato', ['perfil'], true),
      { slug: 'photo_alt_home', label: 'Retrato · Texto alternativo en Inicio (si es distinto)', type: 'string', max: 160 },
      { slug: 'show_home', label: 'Mostrar en Inicio', type: 'boolean' },
      { slug: 'home_sort', label: 'Orden en Inicio (menor primero)', type: 'integer' },
      { slug: 'note', label: 'Nota editorial interna (no se publica)', type: 'string', max: 200 },
      ...rights,
    ] },
];
export const SINGLETON_SLUG = 'main';
export const singletonSlugs = new Set(collections.map(c => c.slug));
