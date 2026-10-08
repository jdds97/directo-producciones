const {chromium}=require('/tmp/directo-design-tools/node_modules/playwright');const fs=require('fs');const assert=require('assert');
const base='design/iteration-02',out=base+'/refinements-01/evidence';
(async()=>{
fs.mkdirSync(out,{recursive:true});const inv=JSON.parse(fs.readFileSync(base+'/suite/inventory.json'));inv.pages.push({key:'guia',themes:['light','dark'],devices:['desktop','mobile']},{key:'inicio-claro',themes:['light'],devices:['desktop','mobile']});
const facts=JSON.parse(fs.readFileSync(base+'/assets/approved-content.json'));const names=facts['social_proof.home_clients'].value.split('; ');const quotes=[...facts['social_proof.home_testimonials'].value.matchAll(/«([^»]+)»/g)].map(m=>m[1]);
const browser=await chromium.launch({executablePath:'/opt/google/chrome/chrome',headless:true,args:['--no-sandbox']});const results=[];
for(const entry of inv.pages)for(const theme of entry.themes)for(const width of [1440,390,320]){
 const device=width===1440?'desktop':'mobile';const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://mcp.figma.com/**',r=>r.abort());const url=entry.key==='inicio-claro'?'index.html':`suite/${entry.key}.html?preview=1&theme=${theme}&device=${device}`;
 await page.goto('http://127.0.0.1:4173/'+url,{waitUntil:'domcontentloaded'});await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(60);
 const r=await page.evaluate(()=>{const root=document.querySelector('.design-surface')||document.querySelector('#design-root'),rr=root.getBoundingClientRect();const visible=e=>!!(e.offsetWidth&&e.offsetHeight)&&getComputedStyle(e).display!=='none';return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:root.offsetHeight,font:document.fonts.check('800 48px Manrope'),missingImages:[...root.querySelectorAll('img')].filter(i=>!i.complete||!i.naturalWidth).map(i=>i.getAttribute('src')),overflow:[...root.querySelectorAll('h1,h2,h3,p,a,button,input,textarea,select,table,blockquote,figcaption')].filter(e=>{const b=e.getBoundingClientRect();return b.width>0&&(b.right>rr.right+1||b.left<rr.left-1||e.scrollWidth>e.clientWidth+2)}).map(e=>({tag:e.tagName,text:e.textContent.trim().slice(0,80),width:e.clientWidth,scrollWidth:e.scrollWidth})),brands:[...root.querySelectorAll('.brand')].map(n=>({visible:[...n.querySelectorAll('img')].filter(visible).map(i=>i.getAttribute('src')),background:getComputedStyle(n).backgroundColor})),avatars:[...root.querySelectorAll('.testimonial-avatar')].map(n=>{const b=n.getBoundingClientRect(),img=n.querySelector('img');return {name:img.alt,width:b.width,height:b.height,borderRadius:getComputedStyle(n).borderRadius,imageWidth:img.getBoundingClientRect().width,imageRatio:img.naturalWidth/img.naturalHeight,renderRatio:img.getBoundingClientRect().width/img.getBoundingClientRect().height}}),clientFilters:[...root.querySelectorAll('.logo-grid img,.client-directory img')].map(i=>getComputedStyle(i).filter),bannerCount:root.querySelectorAll('.stage-word').length};});
 Object.assign(r,{page:entry.key,theme,errors});
 r.brandCorrect=r.brands.every(b=>b.visible.length===1&&b.visible[0].endsWith(theme==='dark'?'logo-white.svg':'logo-original.jpg')&&(theme!=='dark'||b.background==='rgba(0, 0, 0, 0)'));
 r.avatarCorrect=r.avatars.every(a=>a.width===80&&a.height===80&&a.borderRadius==='50%'&&Math.abs(a.imageRatio-a.renderRatio)<.001);
 if(['inicio','clientes','inicio-claro'].includes(entry.key)){
 const selector=entry.key==='clientes'?'.client-directory img':'.logo-grid img';r.logoCount=await page.locator(selector).count();r.exactClients=await page.locator(selector).evaluateAll((imgs,ns)=>imgs.every((i,k)=>i.alt===ns[k]),names);r.metrics=await page.locator('.metric-value').allTextContents();r.quotes=await page.locator('.testimonial blockquote').allTextContents();r.exactQuotes=r.quotes.length===2&&r.quotes.every((q,i)=>q==='«'+quotes[i]+'»');r.approvedContent=r.logoCount===16&&r.exactClients&&r.metrics.join('/')==='2400/169/7'&&r.exactQuotes;
 }
 results.push(r);
 if(width!==320&&['inicio','inicio-claro','clientes','quienes-somos','servicios','guia'].includes(entry.key)){
 await page.locator('.design-surface,#design-root').first().screenshot({path:`${out}/${entry.key}-${theme}-${device}.png`});
 if(['inicio','inicio-claro','clientes'].includes(entry.key))await page.locator('.testimonials-grid').screenshot({path:`${out}/${entry.key}-${theme}-${device}-testimonios.png`});
 }
 await page.close();
}
fs.writeFileSync(out+'/verification.json',JSON.stringify(results,null,2));const failures=results.filter(r=>r.scrollWidth>r.width||r.overflow.length||r.missingImages.length||r.errors.length||!r.font||!r.brandCorrect||!r.avatarCorrect||r.clientFilters.some(f=>f!=='none')||r.approvedContent===false||r.bannerCount>0);
console.log(JSON.stringify({views:results.length,failures},null,2));await browser.close();if(failures.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exit(1)});
