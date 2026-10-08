from pathlib import Path
import json,re,html,hashlib
base=Path('/home/jesus/Workspace/_Proyectos-Trabajo/directo_producciones_landing_page_1.0');out=Path('design/iteration-02')
facts={};current=None
for line in (base/'content/facts.yaml').read_text().splitlines():
 if line.startswith('- id: '):current=line[6:].strip();facts[current]={}
 elif current and line.startswith('  '):
  k,_,v=line.strip().partition(': ')
  if k in ['value','status','source','evidence','approved_by','approved_at']:
   facts[current][k]=json.loads(v) if v.startswith('"') else v
for id in ['social_proof.home_clients','social_proof.home_metrics','social_proof.home_testimonials']:assert facts[id]['status']=='approved'
names=facts['social_proof.home_clients']['value'].split('; ')
files=['junta_andalucia.png','puebla_del_rio.png','turismo_sevilla.jpg','hermandad_matriz.png','remax.png','dos_hermanas.png','hermandad_macarena.png','seat-official.jpg','tixe.png','voley_esquimo.jpg','consejo_hermandades.jpg','rfaf.png','rinconada.jpg','hotel_motilla.svg','canal-sur.jpg','hospital_san_agustin.png']
boxes=[(120,64),(64,72),(152,64),(128,64),(64,80),(120,64),(128,64),(112,72),(112,64),(112,64),(112,64),(112,64),(112,64),(128,64),(128,72),(136,64)]
assert len(names)==len(files)==16
trust='<section class="trust pad" id="colaboraciones" data-section="Clientes · 16 logos aprobados"><div class="trust-caption"><h2>Clientes</h2><p>Instituciones, empresas y marcas.</p></div><div class="logo-grid">'+''.join(f'<div class="logo-cell {"logo-dark" if f=="hotel_motilla.svg" else ""}"><img src="assets/logos/{f}" alt="{html.escape(n)}" style="width:{w}px;height:{h}px" loading="eager"></div>' for n,f,(w,h) in zip(names,files,boxes))+'</div></section>'
metrics=facts['social_proof.home_metrics']['value'].split('; ')
metric_html='<section class="metrics section pad" id="cifras" data-section="Cifras · 2400 / 169 / 7"><div class="metrics-heading"><h2>Directo<br>en cifras.</h2><p>Streaming, empresas y marcas.</p></div><div class="metrics-list">'+''.join('<div class="metric"><p class="metric-value">'+m.split(' ',1)[0]+'</p><p class="metric-meaning">'+html.escape(m.split(' ',1)[1])+'.</p></div>' for m in metrics)+'</div></section>'
value=facts['social_proof.home_testimonials']['value']
people=re.findall(r'([^«]+): «([^»]+)»',value)
assert len(people)==2
portraits=['rafael_gonzalez.jpg','jose_luis_contreras.jpg']
testimonials='<section class="testimonials section pad" id="testimonios" data-section="Testimonios · textos completos aprobados"><p class="eyebrow">03 / En sus palabras</p><h2>El directo,<br>desde el otro lado.</h2><div class="testimonials-grid">'
for (person,quote),portrait in zip(people,portraits):
 name,role=person.strip().split(' — ',1)
 testimonials+='<figure class="testimonial"><blockquote>«'+html.escape(quote)+'»</blockquote><figcaption><img src="assets/portraits/'+portrait+'" alt="'+html.escape(name)+'"><div><p class="person-name">'+html.escape(name)+'</p><p class="person-role">'+html.escape(role)+'</p></div></figcaption></figure>'
testimonials+='</div></section>'
s=(out/'index.html').read_text()
a=s.index('<section class="trust');b=s.index('<section class="streaming',a);s=s[:a]+trust+'\n'+s[b:]
a=s.index('<section class="metrics');b=s.index('<section class="process',a);s=s[:a]+metric_html+'\n'+s[b:]
if '<section class="testimonials' in s:
 a=s.index('<section class="testimonials');b=s.index('<section class="communication',a);s=s[:a]+testimonials+'\n'+s[b:]
else:
 a=s.index('<section class="communication');s=s[:a]+testimonials+'\n'+s[a:]
s=s.replace('03 / Comunicación &amp; marketing','04 / Comunicación &amp; marketing').replace('03 / Comunicación & marketing','04 / Comunicación & marketing')
if '<aside class="review-appendix' in s:
 a=s.index('<aside class="review-appendix');b=s.index('<div class="menu-backdrop',a);s=s[:a]+s[b:]
s=s.replace('Textos y servicios pendientes de aprobación.','Prueba social aprobada en D-42; servicios en revisión.')
(out/'index.html').write_text(s)
(out/'desktop.html').write_text(s.replace('<body>','<body class="desktop">').replace('Inicio · Desktop','Inicio completo · Desktop · D-42'))
(out/'mobile.html').write_text(s.replace('Inicio · Desktop','Inicio completo · Mobile · D-42').replace('<body>','<body class="mobile">'))
manifest=json.loads((out/'assets/manifest.json').read_text())
for a,name,box in zip(manifest,names,boxes):
 a['name']=name;a['display_box']=box;a['publication']='Aprobación interna D-42; revisión final B5 antes del lanzamiento';a['fact_id']='social_proof.home_clients';a['approval']=facts['social_proof.home_clients'];a['design_authorization']='D-42, aprobador Jesús De Dios Sánchez, 2026-10-08'
(out/'assets/manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
(out/'assets/approved-content.json').write_text(json.dumps({k:facts[k] for k in ['social_proof.home_clients','social_proof.home_metrics','social_proof.home_testimonials']},ensure_ascii=False,indent=2))
sync={'source':'Registros vigentes del repo principal leídos por M4; actualización explícita del propietario','decisions':{'D-38':'Logo y portada corporativos autorizados','D-40':'Fotos y vídeos de trabajos aplazados','D-41':'Métricas modulares; actualizado por D-42','D-42':'16 clientes/logos, 2 testimonios completos/retratos, métricas exactas aprobados para diseño; revisión final B5 antes de lanzamiento'},'facts':{k:facts[k] for k in ['social_proof.home_clients','social_proof.home_metrics','social_proof.home_testimonials']},'integration':{'clients_count':16,'testimonials_count':2,'metrics':[2400,169,7],'canal_sur_sha256':hashlib.sha256((out/'assets/logos/canal-sur.jpg').read_bytes()).hexdigest(),'SEAT':'Logo real de web oficial; seat.jpg descartado por contener fotografía de coche','Turismo de Sevilla':'Nombre aprobado conservado; activo visible Prodetur/Turismo de la Provincia/Diputación de Sevilla según inventario. Sin inventar nuevo cliente.'}}
(out/'M1-DECISIONS-SYNC.json').write_text(json.dumps(sync,ensure_ascii=False,indent=2))
print('D-42 aplicado: 16 nombres exactos, 3 cifras exactas, 2 citas completas dentro de Inicio.')
