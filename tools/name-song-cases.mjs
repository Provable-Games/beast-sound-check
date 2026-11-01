import fs from 'node:fs';
const names=JSON.parse(fs.readFileSync(new URL('../species-presets/names/manifest.json',import.meta.url)));
export function officialVariant(prefix,suffix){
 const p=names.prefixes.indexOf(prefix),s=names.suffixes.indexOf(suffix);
 if(p<0||s<0)throw new Error('Unknown official name '+prefix+' '+suffix);
 return p*names.suffixes.length+s+1;
}
export function namedCases(){
 const out=new Map(),add=(sid,name,fx)=>{const x={sid,kind:'name',fx,name,edition:0,seed:'1'};out.set(`${sid}-${name}-${fx}`,x)};
 for(let sid=1;sid<=75;sid++)for(let fx=0;fx<4;fx++)add(sid,1+sid*17%1242,fx);
 for(const [sid,name] of [[1,officialVariant('Agony','Bane')],[1,officialVariant('Blood','Shadow')],[44,1],[44,officialVariant('Blood','Shadow')],[39,1],[40,1],[68,1],[75,1242]])for(let fx=0;fx<4;fx++)add(sid,name,fx);
 return [...out.values()];
}
