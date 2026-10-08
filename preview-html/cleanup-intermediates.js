// Preparado; NO EJECUTADO. Solo borra IDs devueltos por las capturas de esta ejecución.
// Requiere use_figma restablecido, skillNames figma-use,figma-generate-design.
const ids=['28:2','30:2','31:2','34:2'];
const nodes=(await Promise.all(ids.map(id=>figma.getNodeByIdAsync(id)))).filter(Boolean);
const pageIds=[...new Set(nodes.map(n=>n.parent?.id))];
if(pageIds.length!==1) return {deleted:[],reason:'Inspeccionar páginas antes de continuar'};
const page=nodes[0].parent;
if(page.type!=='PAGE') return {deleted:[],reason:'Se esperaba captura raíz en PAGE'};
await figma.setCurrentPageAsync(page);
const fonts=new Map();
for(const node of nodes){if('findAllWithCriteria' in node){for(const text of node.findAllWithCriteria({types:['TEXT']})){for(const s of text.getStyledTextSegments(['fontName']))fonts.set(JSON.stringify(s.fontName),s.fontName);}}}
await Promise.all([...fonts.values()].map(f=>figma.loadFontAsync(f)));
for(const node of nodes)node.remove();
return {deleted:ids,preserved:['2:1841','19:2','35:2','37:2']};
