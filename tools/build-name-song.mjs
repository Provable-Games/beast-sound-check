#!/usr/bin/env node
// A separate, on-demand NamedSong build. Never rebuilds the 600 baseline samples.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { productionSource, sha256 } from './launch-check-reference/production-source.mjs';
process.env.BEAST ||= '/tmp/beast-cyclops-effects-size';
const source = await productionSource();
const revision = '4a16c58bf1738bcd3636f1e475a310b24ecbddc5';
if (source.revision !== revision) throw new Error('NamedSong requires qualified production source ' + revision);
const root = path.resolve(new URL('..', import.meta.url).pathname), out = path.join(root, 'species-presets/names');
const { settingsText } = await import((process.env.OMP || '/workspace/onchain-midi-player') + '/scripts/segments.mjs');
const { build } = await import(source.bs + '/node_modules/esbuild/lib/main.js');
fs.mkdirSync(out, {recursive:true});
const settings = {};
for (let type=0;type<3;type++) for (let mega=0;mega<2;mega++) for (const yeti of type===2?[0,1]:[0]) {
  const key=`song-${type}-${mega}-${yeti}`; settings[key]=settingsText(source.settings(key).value);
}
for (let fx=0;fx<4;fx++) {const key=`satori-411-${fx}`;settings[key]=settingsText(source.settings(key).value);}
const payload = zlib.gzipSync(JSON.stringify({settings}), {level:9});
const dataFile = `banks-${sha256(payload).slice(0,16)}.json.gz`;
fs.writeFileSync(path.join(out,dataFile),payload);
const imports = [['E0',source.bs+'/src/index.js'],['L',source.bs+'/src/lab.js'],['V0',source.bs+'/src/engine_v11.js'],['F',source.bs+'/src/full_midi.js'],['ED',source.bs+'/src/editions_lite.js'],['S',source.satoriPath],['A',root+'/tools/launch-check-reference/production-composer.js']].map(([name,file])=>`import * as ${name} from ${JSON.stringify(file)};`).join('\n');
const bundle=await build({stdin:{contents:`${imports}
const composer=A.createProductionComposer({E:E0.engine,L,V:V0.createEngineV11(E0.engine),F,ED,S,species:${JSON.stringify(source.species)}});
let banks;
self.onmessage=async ({data:{request,input,dataUrl}})=>{
 try {
  if(input.kind!=='name'||!Number.isInteger(input.name)||input.name<1||input.name>1242)throw new Error('Invalid named song');
  banks ||= fetch(dataUrl).then(async response=>{
   if(!response.ok)throw new Error('Could not load Name Song sounds');
   const packed=await response.arrayBuffer();
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',packed)),b=>b.toString(16).padStart(2,'0')).join('');
   if(hash!==${JSON.stringify(sha256(payload))})throw new Error('Name Song sounds failed their content check');
   return new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
  }).catch(error=>{banks=null;throw error});
  const shared=await banks,result=composer.compose(input);
  self.postMessage({request,input:result.input,midi:result.midi,settings:shared.settings[result.settingsKey],settingsKey:result.settingsKey,info:result.info},[result.midi.buffer]);
 }catch(error){self.postMessage({request,error:error.message||String(error)})}
};`,resolveDir:root,sourcefile:'name-song-worker.js'},bundle:true,write:false,platform:'browser',format:'iife',target:'es2020',minify:true,legalComments:'eof'});
const worker=bundle.outputFiles[0].contents,workerFile=`composer-${sha256(worker).slice(0,16)}.js`;
fs.writeFileSync(path.join(out,workerFile),worker);
const names={prefixes:source.TABLES.prefixes,suffixes:source.TABLES.suffixes};
if(names.prefixes.length!==69||names.suffixes.length!==18||names.prefixes[0]!=='Agony'||names.suffixes[0]!=='Bane')throw new Error('Unexpected official names');
const sourceTree=execFileSync('git',['-C',source.root,'ls-tree','-r',revision,'--','beasts/beast_composer','beasts/beast_contracts','offchain/beast-sound/src','offchain/beast-sound/onchain/tinychip'],{encoding:'utf8'});
const manifest={schema:'beast-name-song/v1',revision,adapterHash:source.adapterHash,sourceTreeSha256:sha256(sourceTree),worker:{file:workerFile,sha256:sha256(worker),bytes:worker.length},data:{file:dataFile,sha256:sha256(payload),bytes:payload.length},...names,namesSha256:sha256(JSON.stringify(names)),variants:1242,theme:'species',defaultName:1,parity:'parity.json',notes:'NamedSong from get_generation_inputs, as written. Harpy/Pegasus retain their own species; Shared Species Song alone applies the swap. Some names canonically share MIDI with the species song.'};
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
for(const file of fs.readdirSync(out))if(/^(composer-[a-f0-9]+\.js|banks-[a-f0-9]+\.json\.gz)$/.test(file)&&![workerFile,dataFile].includes(file))fs.unlinkSync(path.join(out,file));
const licenses=[source.root+'/LICENSE',...['@scure/starknet','@noble/curves','@noble/hashes'].map(p=>source.bs+'/node_modules/'+p+'/LICENSE')];
fs.writeFileSync(path.join(out,'NOTICE.txt'),'Pinned Beast Sound reference: https://github.com/caseywescott/midi_fun_contract at '+revision+'\n\n'+licenses.map(p=>p.replace(source.root+'/','')+'\n'+fs.readFileSync(p,'utf8')).join('\n\n'));
console.log(JSON.stringify({worker:worker.length,banks:payload.length,revision}));
