// Semillas de las listas editables (clientes, banda de logos, proyectos y equipo). Reproducen el estado actual de las páginas.
// «rights_ok» queda en false: los derechos de logotipo, vídeo y retrato requieren evidencia antes de publicar cada entrada.
// Las fotos se referencian por clave de la biblioteca del sitio (src/lib/media-registry.ts), nunca por ruta tecleada.
import { m4PortfolioProjects } from '../lib/m4-portfolio-projects.ts';

export const clientSeeds = [
  { name: "Junta de Andalucía", logo_ref: 'logos/junta_andalucia-sm', logo_dark: false, sort: 10 },
  { name: "Ayuntamiento de la Puebla del Río", logo_ref: 'logos/puebla_del_rio-sm', logo_dark: false, sort: 20 },
  { name: "Turismo de Sevilla", logo_ref: 'logos/turismo_sevilla-sm', logo_dark: false, sort: 30 },
  { name: "Hermandad Matriz del Rocío", logo_ref: 'logos/hermandad_matriz', logo_dark: false, sort: 40 },
  { name: "Remax", logo_ref: 'logos/remax', logo_dark: false, sort: 50 },
  { name: "Ayuntamiento Dos Hermanas", logo_ref: 'logos/dos_hermanas', logo_dark: false, sort: 60 },
  { name: "Hermandad de la Macarena", logo_ref: 'logos/hermandad_macarena-sm', logo_dark: false, sort: 70 },
  { name: "SEAT", logo_ref: 'logos/seat-official', logo_dark: false, sort: 80 },
  { name: "Tixe", logo_ref: 'logos/tixe', logo_dark: false, sort: 90 },
  { name: "Cajasol Voley - Esquimo", logo_ref: 'logos/voley_esquimo', logo_dark: false, sort: 100 },
  { name: "Consejo de Hermandades de Sevilla", logo_ref: 'logos/consejo_hermandades', logo_dark: false, sort: 110 },
  { name: "Federación Andaluza de Fútbol", logo_ref: 'logos/rfaf', logo_dark: false, sort: 120 },
  { name: "Ayuntamiento de la Rinconada", logo_ref: 'logos/rinconada', logo_dark: false, sort: 130 },
  { name: "Hotel TRH La Motilla", logo_ref: 'logos/hotel_motilla', logo_dark: true, sort: 140 },
  { name: "Canal Sur", logo_ref: 'logos/canal-sur-sm', logo_dark: false, sort: 150 },
  { name: "Hospital San Agustín", logo_ref: 'logos/hospital_san_agustin', logo_dark: false, sort: 160 },
] as const;

export const bandSeeds = [
  { name: "RTVE", logo_ref: 'logos/tve-white', variant: 'normal', sort: 10 },
  { name: "Antena 3", logo_ref: 'logos/antena_3-white', variant: 'normal', sort: 20 },
  { name: "Cuatro", logo_ref: 'logos/cuatro', variant: 'monocromo', sort: 30 },
  { name: "Telecinco", logo_ref: 'logos/telecinco', variant: 'monocromo', sort: 40 },
  { name: "La Sexta", logo_ref: 'logos/la_sexta-white', variant: 'normal', sort: 50 },
  { name: "Telemadrid", logo_ref: 'logos/telemadrid-white', variant: 'normal', sort: 60 },
  { name: "Canal Sur", logo_ref: 'logos/canal_sur-white', variant: 'normal', sort: 70 },
  { name: "7 TV Andalucía", logo_ref: 'logos/logo_siete_andalucia-white', variant: 'normal', sort: 80 },
  { name: "101 TV", logo_ref: 'logos/101-white', variant: 'normal', sort: 90 },
  { name: "ABC", logo_ref: 'logos/abc-white', variant: 'normal', sort: 100 },
  { name: "El Correo de Andalucía", logo_ref: 'logos/correo-white', variant: 'normal', sort: 110 },
  { name: "Ayuntamiento de Sevilla", logo_ref: 'logos/ayuntamiento_de_sevilla-white', variant: 'normal', sort: 120 },
  { name: "Junta de Andalucía", logo_ref: 'logos/junta-white', variant: 'normal', sort: 130 },
  { name: "Catedral de Sevilla", logo_ref: 'logos/catedral-white', variant: 'catedral', sort: 140 },
  { name: "Consejo General de Hermandades y Cofradías", logo_ref: 'logos/consejo_hermandades-white', variant: 'normal', sort: 150 },
  { name: "Hermandad del Gran Poder", logo_ref: 'logos/gran_poder-white', variant: 'con_nombre', sort: 160 },
  { name: "Hermandad de la Macarena", logo_ref: 'logos/macarena-white', variant: 'con_nombre', sort: 170 },
  { name: "Hermandad de la Esperanza de Triana", logo_ref: 'logos/esperanza_de_triana-white', variant: 'con_nombre', sort: 180 },
  { name: "Hermandad de los Gitanos", logo_ref: 'logos/gitanos-white', variant: 'con_nombre', sort: 190 },
  { name: "Hermandad Matriz de Almonte", logo_ref: 'logos/matriz-white', variant: 'con_nombre', sort: 200 },
  { name: "Real Federación Andaluza de Fútbol", logo_ref: 'logos/federacion-white', variant: 'normal', sort: 210 },
  { name: "Sevilla FC", logo_ref: 'logos/sevilla-fc', variant: 'escudo_monocromo', sort: 220 },
  { name: "Real Betis", logo_ref: 'logos/real-betis', variant: 'escudo_monocromo', sort: 230 },
  { name: "Cajasol Voley - Esquimo", logo_ref: 'logos/esquimo-voley-white', variant: 'escudo_recorte', sort: 240 },
  { name: "Lances de Futuro", logo_ref: 'logos/logo_lances-white', variant: 'normal', sort: 250 },
] as const;

// «sort» es el orden de Portfolio (el que tenía la página antes de leerlo del CMS); «home_sort», el de «Trabajos recientes» de Inicio.
const portfolioOrder = ['rugby', 'abc-galisur', 'lasexta', 'voley', 'motocross'];
export const projectSeeds = m4PortfolioProjects.map((p, i) => ({
  name: p.title, context: p.context, description: p.description, video_key: p.key, category: p.portfolioCategories[0],
  sort: (portfolioOrder.indexOf(p.key) + 1) * 10, show_home: true, home_sort: (i + 1) * 10,
  poster_ref: `coberturas/${p.poster.split('/').pop()!.replace(/\.webp$/, '')}`,
}));

// Equipo. El orden de «sort» es el de Quiénes somos; «home_sort» el de Inicio. Las dos personas sin foto conservan estado
// explícito «pendiente» (no se inventa ni se exige una foto). Nombres: nombre y primer apellido, conservando los compuestos
// (decisión del propietario, 2026-11-01); «name_home» solo existe para escribir un nombre distinto en Inicio.
const P = 'equipo/perfiles/';
export const teamSeeds = [
  { slug: 'sergio-maya', name: 'Sergio Maya', role: 'Director', photo_state: 'con_foto', photo_ref: `${P}sergio-maya`, photo_alt: 'Sergio Maya', photo_alt_home: 'Sergio Maya, director de Directo Producciones', show_home: true, home_sort: 10, sort: 10 },
  { slug: 'antonio-de-los-reyes', name: 'Antonio de los Reyes', role: 'Editor y realizador', photo_state: 'con_foto', photo_ref: `${P}antonio-de-los-reyes`, photo_alt: 'Antonio de los Reyes', show_home: false, sort: 20 },
  { slug: 'david-berdugo', name: 'David Berdugo', role: 'Operador de cámara', photo_state: 'pendiente', show_home: false, note: 'Foto pendiente: no se inventa ni se sustituye.', sort: 30 },
  { slug: 'lucia-sanchez', name: 'Lucía Sánchez', role: 'Operadora de cámara', photo_state: 'con_foto', photo_ref: `${P}lucia-sanchez-maquillaje`, photo_alt: 'Lucía Sánchez', show_home: false, sort: 40 },
  { slug: 'curro', name: 'Curro de Dios', role: 'Jefe técnico', photo_state: 'con_foto', photo_ref: `${P}curro`, photo_alt: 'Curro de Dios', photo_alt_home: 'Curro de Dios, jefe técnico de Directo Producciones', show_home: true, home_sort: 20, sort: 50 },
  { slug: 'juan-gomez', name: 'Juan Gómez', role: 'Operador de cámara', photo_state: 'con_foto', photo_ref: `${P}juan-camara`, photo_alt: 'Juan Gómez', show_home: false, sort: 60 },
  { slug: 'jesus-ruiz', name: 'Jesús Ruiz', role: 'Fotógrafo', photo_state: 'con_foto', photo_ref: `${P}jesus-ruiz`, photo_alt: 'Jesús Ruiz', show_home: false, sort: 70 },
  { slug: 'gonzalo-sanchez', name: 'Gonzalo Sánchez', role: 'Marketing', photo_state: 'pendiente', show_home: false, note: 'Foto pendiente: no se inventa ni se sustituye.', sort: 80 },
  { slug: 'fran-vergara', name: 'Fran Vergara', role: 'Jefe de proyectos', photo_state: 'con_foto', photo_ref: `${P}fran-vergara`, photo_alt: 'Fran Vergara', show_home: true, home_sort: 30, sort: 90 },
] as const;
