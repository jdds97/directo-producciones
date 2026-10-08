from pathlib import Path
import re
root=Path(__file__).resolve().parents[1]
for name in ['index.html','desktop.html','mobile.html']:
 p=root/name;s=p.read_text()
 s=s.replace('href="#contacto" class="circle-link" aria-label="Consultar streaming de eventos"','href="suite/servicios.html?preview=1#servicios-streaming" class="format-detail" aria-label="Ver el formato de streaming de eventos en Servicios"')
 s=s.replace('href="#contacto" class="circle-link" aria-label="Consultar TV online"','href="suite/servicios.html?preview=1#tv-online" class="format-detail" aria-label="Ver el formato de TV online en Servicios"')
 s=re.sub(r'(<a[^>]+class="format-detail"[^>]*>)(?!Ver formato)',r'\1Ver formato ',s)
 p.write_text(s)
p=root/'suite/build-suite.py';s=p.read_text()
s=s.replace('href="#servicios-streaming">Empieza por el directo','href="#servicios-streaming">Explora el streaming')
s=s.replace("service+=metrics",'''service+='<section id="tv-online" class="tv-format service-secondary section pad info-split"><div><p class="eyebrow">Streaming / TV online</p><h2>Un canal<br>para tu contenido.</h2></div><div><h3>TV online</h3><p>En la web actual, este formato se presenta junto a la realización televisiva: un espacio para emitir contenido online.</p><p>¿Qué quieres emitir? ¿Con qué programación? ¿En qué pantallas? Estas preguntas ayudan a definir tu canal.</p><a class="text-link" href="'+link('contacto')+'">Hablemos de tu TV online '+icons['arrow']+'</a></div></section>'
service+=metrics''')
s=s.replace('class="pad section" style="padding-top:32px"><div class="client-directory"','class="pad section client-logo-band" style="padding-top:32px"><div class="client-directory"')
start=s.index("about=hero(");end=s.index("\nblog=hero(",start)
about='''about=hero('Quiénes somos','Directo<br>Producciones.','Una productora de streaming, comunicación y marketing digital.')
about+='<section class="about-editorial section pad" data-section="Quiénes somos · presentación de la productora"><div class="about-company-heading"><div><p class="eyebrow">La productora</p><h2>Un equipo.<br>Varias formas<br>de comunicar.</h2></div><div class="about-company-copy"><p class="about-lead">Somos una productora especializada en la retransmisión de eventos en streaming.</p><p>Directo Producciones reúne un equipo multidisciplinar dedicado a la comunicación y al marketing digital.</p><p>La realización televisiva, la comunicación de una organización y su presencia digital forman parte de nuestra actividad.</p></div></div><div class="about-practices"><div class="about-practices-intro"><h3>Qué hacemos<br>desde la productora.</h3><p>El streaming es el punto de partida. La comunicación y el marketing amplían las formas de trabajar el mensaje.</p><a class="text-link" href="'+link('servicios')+'">Conoce nuestros servicios '+icons['arrow']+'</a></div><div class="practice-lines"><div class="practice-line"><span>01</span><div><h3>Streaming y realización</h3><p>Retransmisión de eventos y TV online con realización televisiva.</p></div></div><div class="practice-line"><span>02</span><div><h3>Comunicación corporativa</h3><p>Comunicación de organizaciones y gabinete de prensa.</p></div></div><div class="practice-line"><span>03</span><div><h3>Marketing digital</h3><p>Redes sociales, SEO, SEM, diseño publicitario y gestión de marca.</p></div></div></div></div><p class="team-pending">Borrador editorial recuperado de la web actual para revisión. Nombres, funciones y fotografías del equipo pendientes de aprobación.</p></section>'
about+=contact.replace('De la idea a la emisión','Contacto').replace('¿Qué tienes<br>en mente?','Conversemos<br>sobre tu proyecto.').replace('Cuéntanos el evento que estás preparando.','Streaming, comunicación o marketing digital. Cuéntanos qué necesitas.')'''
s=s[:start]+about+s[end:]
s=s.replace("inner=inner.replace('src=\"assets/','src=\"../assets/')", "inner=inner.replace('src=\"assets/','src=\"../assets/').replace('href=\"suite/','href=\"')")
s=s.replace('Presentación/equipo pendientes de texto y medios autorizados.','Presentación editorial recuperada de Empresa en la web actual por instrucción del propietario, en revisión. Equipo detallado y medios pendientes de aprobación.')
s=s.replace('<link rel="stylesheet" href="../refinements-01/refinements.css"><link rel="stylesheet" href="suite.css">','<link rel="stylesheet" href="suite.css"><link rel="stylesheet" href="../refinements-01/refinements.css">')
p.write_text(s)
p=root/'suite/build-guide.py';s=p.read_text().replace('<link rel="stylesheet" href="../refinements-01/refinements.css"><link rel="stylesheet" href="suite.css">','<link rel="stylesheet" href="suite.css"><link rel="stylesheet" href="../refinements-01/refinements.css">');p.write_text(s)
p=root/'suite/suite.js';s=p.read_text().replace('a.href=url.pathname+url.search;', 'a.href=url.pathname+url.search+url.hash;')
# Cross-page fragments remain logical names; resolve them within the single selected view.
s+='''
if(document.body.classList.contains('single-view')&&location.hash){
 const logical=decodeURIComponent(location.hash.slice(1));
 const surface=document.querySelector('.design-surface');
 const target=document.getElementById(logical)||[...surface.querySelectorAll('[id]')].find(n=>n.id.endsWith('-'+logical));
 if(target)document.fonts.ready.then(()=>requestAnimationFrame(()=>target.scrollIntoView({behavior:'instant',block:'start'})));
}
'''
p.write_text(s)
