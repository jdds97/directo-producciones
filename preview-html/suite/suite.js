// Interacciones del prototipo de diseño; sin peticiones de leads, correo, publicación o analítica.
const qs=new URLSearchParams(location.search);
if(qs.get('preview')==='1'){
 document.body.classList.add('single-view');
 const theme=qs.get('theme')||document.querySelector('.screen-wrap')?.dataset.theme||'light';
 const device=qs.get('device')||'desktop';
 document.querySelectorAll('.screen-wrap').forEach(s=>{if(s.dataset.theme!==theme||s.dataset.device!==device)s.remove();else{s.querySelector('.artboard').style.width='100%';if(device==='mobile')s.classList.add('mobile-preview');}});
 document.querySelectorAll('.theme-row').forEach(r=>{if(!r.querySelector('.screen-wrap'))r.remove();});
 document.querySelectorAll('a[href*=".html"]').forEach(a=>{const url=new URL(a.href);url.searchParams.set('preview','1');url.searchParams.set('theme',theme);url.searchParams.set('device',device);if(theme==='light'&&url.pathname.endsWith('/suite/inicio.html'))url.pathname=url.pathname.replace(/suite\/inicio\.html$/,device==='mobile'?'mobile.html':'index.html');a.href=url.pathname+url.search+url.hash;});
}
const motionPreference=matchMedia('(prefers-reduced-motion:reduce)');
motionPreference.addEventListener('change',()=>{if(motionPreference.matches)document.getAnimations().forEach(a=>a.cancel());});
const dialog=document.querySelector('#suite-dialog');
function demo(message){dialog.querySelector('p').textContent=message;dialog.showModal();}
document.querySelectorAll('[data-demo]').forEach(b=>b.addEventListener('click',()=>demo(b.dataset.demo)));
document.querySelector('[data-close-demo]')?.addEventListener('click',()=>dialog.close());
document.querySelectorAll('[data-toggle-demo]').forEach(b=>b.addEventListener('click',()=>{const active=b.getAttribute('aria-pressed')==='true';b.setAttribute('aria-pressed',String(!active));b.classList.toggle('off',active);}));
for(const surface of document.querySelectorAll('.design-surface')){
 const menu=surface.querySelector('.suite-menu'),toggle=surface.querySelector('.menu-toggle'),close=surface.querySelector('.suite-menu-close');let lastFocus,animation,version=0;
 const reduced=()=>matchMedia('(prefers-reduced-motion:reduce)').matches;
 async function hide(){if(!menu||menu.hidden)return;const v=++version;animation?.cancel();if(!reduced()){animation=menu.animate([{opacity:1,transform:'translateX(0)'},{opacity:0,transform:'translateX(8px)'}],{duration:180,easing:'cubic-bezier(.4,0,1,1)'});try{await animation.finished;}catch{}}if(v!==version)return;menu.hidden=true;surface.querySelectorAll(':scope>header,:scope>main,:scope>footer').forEach(n=>n.inert=false);toggle.setAttribute('aria-expanded','false');lastFocus?.focus();}
 toggle?.addEventListener('click',()=>{version++;lastFocus=document.activeElement;animation?.cancel();menu.hidden=false;surface.querySelectorAll(':scope>header,:scope>main,:scope>footer').forEach(n=>n.inert=true);toggle.setAttribute('aria-expanded','true');if(!reduced())animation=menu.animate([{opacity:0,transform:'translateX(8px)'},{opacity:1,transform:'translateX(0)'}],{duration:220,easing:'cubic-bezier(.2,.8,.2,1)'});close.focus();});
 close?.addEventListener('click',hide);menu?.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();hide();}if(e.key==='Tab'){const items=[...menu.querySelectorAll('a,button')];if(e.shiftKey&&document.activeElement===items[0]){e.preventDefault();items.at(-1).focus();}else if(!e.shiftKey&&document.activeElement===items.at(-1)){e.preventDefault();items[0].focus();}}});
}
for(const form of document.querySelectorAll('[data-design-form]'))form.addEventListener('submit',e=>{
 e.preventDefault();const fields=[...form.querySelectorAll('[required]')];let first;
 for(const input of fields){const container=input.closest('.field')||input.closest('.check-label');container?.classList.remove('error');container?.querySelector('.error-message')?.remove();input.removeAttribute('aria-invalid');input.removeAttribute('aria-describedby');if(!input.checkValidity()){first??=input;input.setAttribute('aria-invalid','true');if(container){container.classList.add('error');const p=document.createElement('p');p.className='help error-message';p.id=(input.id||input.name)+'-error';p.textContent=input.type==='email'?'Revisa el formato del email.':input.type==='checkbox'?'Confirma que has leído la política de privacidad.':'Completa este campo.';container.append(p);input.setAttribute('aria-describedby',p.id);}}}
 const status=form.querySelector('.form-status');if(first){status.textContent='Revisa los campos indicados. No se ha enviado ninguna consulta.';first.focus();}else{status.textContent='Demostración completada. No se han enviado ni guardado datos.';}
});
if(document.body.classList.contains('single-view')&&!matchMedia('(prefers-reduced-motion:reduce)').matches){const nodes=[...document.querySelectorAll('[data-enter]')];window.designAnimations=nodes.map(el=>el.animate([{opacity:.84,transform:'translateY(12px)'},{opacity:1,transform:'translateY(0)'}],{duration:480,delay:Number(el.dataset.enter),easing:'cubic-bezier(.2,.8,.2,1)',fill:'backwards'}));}

if(document.body.classList.contains('single-view')&&location.hash){
 const logical=decodeURIComponent(location.hash.slice(1));
 const surface=document.querySelector('.design-surface');
 const target=document.getElementById(logical)||[...surface.querySelectorAll('[id]')].find(n=>n.id.endsWith('-'+logical));
 if(target)document.fonts.ready.then(()=>requestAnimationFrame(()=>target.scrollIntoView({behavior:'instant',block:'start'})));
}
