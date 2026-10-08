from pathlib import Path
import re
root=Path(__file__).resolve().parents[1]
pages={'Quiénes somos':'quienes-somos','Blog':'blog','Contacto':'contacto','Aviso legal':'aviso-legal','Privacidad':'privacidad','Cookies':'cookies'}
for name in ['index.html','desktop.html','mobile.html']:
 p=root/name;s=p.read_text()
 def anchor(m):
  attributes=m.group(1)+m.group(3)
  return '<a'+attributes+' href="suite/'+pages[m.group(2)]+'.html?preview=1">'+m.group(4)+'</a>'
 s=re.sub(r'<button([^>]*?) data-destination="([^"]+)"([^>]*)>(.*?)</button>',anchor,s,flags=re.S)
 s=s.replace('Esta iteración diseña únicamente Inicio. No se envían datos ni se abre captación.','Prototipo de diseño de las páginas acordadas. No se envían datos ni se abre captación.')
 p.write_text(s)
p=root/'prototype.js';s=p.read_text().replace('Esa página no se diseña en esta iteración.','La página correspondiente está disponible en la suite de revisión.');p.write_text(s)
p=root/'refinements-01/refinements.css';s=p.read_text();s+='\n.footer-bottom a { display:inline-flex; align-items:center; min-height:44px; }\n';p.write_text(s)
