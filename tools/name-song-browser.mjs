#!/usr/bin/env node
// Browser outputs are checked against the fingerprints captured from actual Cairo,
// rather than a second invocation of the JavaScript composition engine.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {gunzipSync} from 'node:zlib';
import {officialVariant,namedCases} from './name-song-cases.mjs';
import {parseMidi} from '../species-presets/midi-roll.mjs';
import {beatSeconds,retimeGif} from '../species-presets/art-sync.mjs';
const {chromium}=createRequire(import.meta.url)('/workspace/beasts-v3/node_modules/playwright');
const origin=process.env.AUDITION_URL||'http://127.0.0.1:8794';
const dir=new URL('../species-presets/',import.meta.url),manifest=JSON.parse(fs.readFileSync(new URL('names/manifest.json',dir))),proof=JSON.parse(fs.readFileSync(new URL('names/parity.json',dir))),baseline=JSON.parse(fs.readFileSync(new URL('manifest.json',dir))),data=JSON.parse(gunzipSync(fs.readFileSync(new URL(baseline.data.file,dir))));
const hash=x=>createHash('sha256').update(x).digest('hex');
assert.equal(proof.revision,manifest.revision);assert.equal(proof.adapterHash,manifest.adapterHash);assert.equal(proof.casesHash,hash(JSON.stringify(namedCases())));assert.deepEqual(proof.sourceManifest,manifest);
const checks=[],errors=[],external=[],peaks=[];
const pass=s=>{checks.push(s);console.log('PASS '+s)};
const browser=await chromium.launch({args:['--autoplay-policy=user-gesture-required']});
const context=await browser.newContext({viewport:{width:1280,height:900}});
await context.addInitScript(()=>{
 const A=window.AudioContext;window.__contexts=[];window.__resume=[];
 window.AudioContext=new Proxy(A,{construct(t,args){window.__resume.push({active:navigator.userActivation.isActive,at:performance.now(),operation:'create'});const c=new t(...args),resume=c.resume.bind(c);c.resume=()=>{window.__resume.push({active:navigator.userActivation.isActive,at:performance.now()});return resume()};window.__contexts.push(c);return c}});
 const W=window.Worker;window.__workers=[];window.__workerResults=[];
 window.Worker=new Proxy(W,{construct(t,args){const w=new t(...args);w.addEventListener('message',e=>{window.__workerResults.push({at:performance.now(),input:e.data.input})});window.__workers.push(w);return w}});
 const src=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');window.__artWrites=[];window.__artPending=[];
 Object.defineProperty(HTMLImageElement.prototype,'src',{get:src.get,set(value){
  if(value.startsWith('data:image/svg+xml;')&&value.slice(0,value.indexOf(',')).includes(';r=')){
   window.__artWrites.push({src:value,at:performance.now(),status:window.audition?.timing.getPlayStatus()});
   if(window.__deferArt){window.__artPending.push(()=>src.set.call(this,value));return}
  }
  src.set.call(this,value);
 }});
});
context.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(origin+'/'))external.push(r.url())});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
const ready=async()=>page.waitForFunction(()=>window.audition?.data&&!document.getElementById('play').disabled);
const namedReady=async()=>page.waitForFunction(()=>audition.kind==='name'&&audition.current?.kind==='name'&&!audition.composing);
async function audible(sid,fx){
 await page.locator(`.species-row[data-sid="${sid}"] [data-fx="${fx}"]`).click();
 await page.waitForFunction(({sid,fx})=>audition.sid===sid&&audition.fx===fx&&audition.kind==='name'&&audition.status==='playing',{sid,fx});
 const peak=await page.evaluate(async()=>{
  const s=audition.synth,c=s.getAudioContext();
  if(!window.__analyser){const a=c.createAnalyser(),g=c.createGain();g.gain.value=0;s.out.connect(a);a.connect(g);g.connect(c.destination);window.__analyser=a}
  const a=window.__analyser,b=new Float32Array(a.fftSize);let peak=0;
  for(let i=0;i<100;i++){a.getFloatTimeDomainData(b);for(const v of b)peak=Math.max(peak,Math.abs(v));if(peak>.00001)break;await new Promise(r=>setTimeout(r,25))}
  return peak;
 });
 assert(peak>.00001,`Silent named ${sid}/${fx}`);assert.equal(await page.evaluate(()=>window.__contexts.length),1);peaks.push({sid,fx,peak});
}
try{
 // Hold local banks so the first click must resume audio before composition can finish.
 let releaseBanks;const banksHeld=new Promise(resolve=>releaseBanks=resolve);
 await page.route('**/names/banks-*',async route=>{await banksHeld;await route.continue()});
 await page.goto(origin+'/#name-44-0-1');await ready();
 assert.equal(await page.evaluate(()=>window.__contexts.length),0);
 await page.locator('#play').click();
 await page.waitForFunction(()=>window.__contexts.length===1&&window.__contexts[0].state==='running'&&audition.composing);
 assert.equal(await page.evaluate(()=>window.__resume[0].active),true);
 releaseBanks();await page.waitForFunction(()=>audition.status==='playing'&&audition.current?.kind==='name');
 assert.equal(await page.locator('#name').textContent(),'Agony Bane Satori');
 assert.equal(await page.evaluate(()=>audition.current.key),'C Aeolian');
 assert.equal(await page.evaluate(()=>window.__workers.length),1);
 const gesture=await page.evaluate(()=>({resume:window.__resume[0].at,result:window.__workerResults[0].at}));assert(gesture.resume<gesture.result);
 pass('first-ever Name Song resumes one persistent AudioContext synchronously in one click while the worker is delayed');
 await page.unroute('**/names/banks-*');
 await page.locator('#stop').click();
 const observed=await page.evaluate(async matrix=>{
  const out=[],digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  for(const x of matrix){const r=await audition.names.compose(x.sid,x.fx,x.name);out.push({input:r.input,midiSha256:await digest(r.midi),settingsSha256:await digest(new TextEncoder().encode(r.settings)),settingsKey:r.settingsKey})}
  return out;
 },namedCases());
 assert.equal(observed.length,proof.cases);
 for(let i=0;i<observed.length;i++){
  assert.equal(observed[i].midiSha256,proof.captures[i].midiSha256,`Cairo MIDI case ${i}`);
  assert.equal(observed[i].settingsSha256,proof.captures[i].settingsSha256,`Cairo settings case ${i}`);
  assert.equal(observed[i].settingsKey,proof.captures[i].settingsKey);
 }
 assert.equal(await page.evaluate(()=>window.__workers.length),1);assert(await page.evaluate(()=>audition.names.cache.size<=24));
 pass(`${proof.cases} actual browser-worker MIDI/settings outputs match the Cairo captures; all 75 species/four FX and named boundaries; one worker/bounded cache`);
 const ab=officialVariant('Agony','Bane'),bs=officialVariant('Blood','Shadow');
 const sampleHash=(sid,name,fx)=>proof.captures.find(x=>x.sid===sid&&x.name===name&&x.fx===fx).midiSha256;
 for(let fx=0;fx<4;fx++)assert.notEqual(sampleHash(1,ab,fx),sampleHash(1,bs,fx));
 for(let fx=0;fx<4;fx++)assert.notEqual(sampleHash(44,ab,fx),data.samples.find(x=>x.kind==='song'&&x.sid===44&&x.fx===fx).midiSha256);
 assert.equal(new Set(proof.captures.filter(x=>x.sid===44&&x.name===ab).map(x=>x.settingsKey)).size,4);
 pass('official Agony Bane and Blood Shadow Warlocks differ; Satori name 1 differs from its Species Song and uses all four full banks');
 // Every named UI route also flows through the real MIDI roll, not only the worker API.
 for(const x of namedCases().slice(0,300)){
  await page.evaluate(x=>{location.hash=`name-${x.sid}-${x.fx}-${x.name}`},x);await namedReady();
  await page.waitForFunction(x=>audition.sid===x.sid&&audition.fx===x.fx&&audition.nameVariant===x.name&&audition.current?.nameVariant===x.name,x);
  const got=await page.evaluate(()=>({b64:audition.current.midi_b64,seconds:audition.current.seconds,rollDuration:audition.midi.duration,notes:audition.midi.notes.length}));
  assert.equal(hash(Buffer.from(got.b64,'base64')),sampleHash(x.sid,x.name,x.fx));assert.equal(got.seconds,got.rollDuration);assert(got.notes>0);
 }
 assert.equal(await page.locator('.species-row').count(),75);assert.equal(await page.locator('.species-row [data-fx]').count(),300);
 assert.equal(await page.locator('#name-prefix option').count(),69);assert.equal(await page.locator('#name-suffix option').count(),18);
 pass('all 300 stratified named routes populate the actual piano roll using generated duration/header; 75 rows and official 69 × 18 controls');
 await page.evaluate(()=>location.hash='name-1-0-1');await namedReady();
 await page.locator('#name-prefix').selectOption(String(manifest.prefixes.indexOf('Blood')+1));
 await page.locator('#name-suffix').selectOption(String(manifest.suffixes.indexOf('Shadow')+1));
 await page.waitForFunction(bs=>audition.current?.nameVariant===bs&&audition.status==='playing',bs);
 assert.equal(await page.locator('#name').textContent(),'Blood Shadow Warlock');assert.equal(await page.evaluate(()=>location.hash),`#name-1-0-${bs}`);
 await page.locator('#next').click();await page.waitForFunction(()=>audition.sid===2&&audition.status==='playing');assert.equal(await page.evaluate(()=>audition.nameVariant),bs);
 for(const kind of ['check','song','name']){
  await page.locator(`[data-kind="${kind}"]`).click();await page.waitForFunction(kind=>audition.kind===kind&&audition.status==='playing',kind);assert.equal(await page.evaluate(()=>audition.nameVariant),bs);
  assert.equal(await page.evaluate(()=>audition.current.kind),kind);
 }
 pass('both official selectors update the full name/shareable hash; chosen name survives Beast, FX and mode changes; static modes remain independent');
 await page.evaluate(()=>location.hash='name-44-0-1');await namedReady();
 for(const [sid,fx]of [[1,0],[1,1],[1,2],[1,3],[44,0],[44,1],[44,2],[44,3],[39,2],[40,3],[68,0],[68,3],[75,1]])await audible(sid,fx);
 pass('actual Name Song playback is non-silent across four FX, Satori banks, swap boundary, Yeti and Brute family');
 await page.locator('#play').click();await page.waitForFunction(()=>audition.status==='paused'&&audition.synth.getAudioContext().state==='suspended');
 const held=await page.evaluate(()=>audition.timing.getPlayStatus().positionSeconds);await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>audition.timing.getPlayStatus().positionSeconds),held);
 await page.locator('#play').click();await page.waitForFunction(()=>audition.status==='playing');
 await page.locator('#volume').fill('27');assert.equal(await page.evaluate(()=>audition.volume),.27);
 await page.locator('#stop').click();assert.equal(await page.evaluate(()=>audition.synth.getPlayStatus().play),0);assert.equal(await page.evaluate(()=>audition.synth.notetab.length),0);
 pass('Name Song pause/resume holds the audible clock; volume and stop use the same synth and clear voices');
 // Delay actual worker-bank fetch in a fresh worker to force out-of-order requests.
 await page.evaluate(()=>{audition.names.dispose();audition.names.cache.clear()});
 let releaseRace;const raceHeld=new Promise(resolve=>releaseRace=resolve);
 await page.route('**/names/banks-*',async route=>{await raceHeld;await route.continue()});
 await page.locator('.species-row[data-sid="1"] [data-fx="0"]').click();
 await page.locator('.species-row[data-sid="44"] [data-fx="1"]').click();
 await page.locator('.species-row[data-sid="68"] [data-fx="3"]').click();
 await page.locator('[data-kind="check"]').click();
 await page.waitForFunction(()=>audition.kind==='check'&&audition.sid===68&&audition.status==='playing');
 const staticSerial=await page.evaluate(()=>audition.serial);releaseRace();await page.waitForTimeout(350);
 assert.equal(await page.evaluate(()=>audition.kind),'check');assert.equal(await page.evaluate(()=>audition.serial),staticSerial);assert.equal(await page.evaluate(()=>audition.current.kind),'check');
 await page.unroute('**/names/banks-*');
 await page.locator('[data-kind="name"]').click();await page.waitForFunction(()=>audition.kind==='name'&&audition.status==='playing');
 await page.evaluate(()=>{document.querySelector('.species-row[data-sid="1"] [data-fx="1"]').click();document.querySelector('.species-row[data-sid="44"] [data-fx="2"]').click();document.querySelector('.species-row[data-sid="40"] [data-fx="3"]').click()});
 await page.waitForFunction(()=>audition.kind==='name'&&audition.sid===40&&audition.fx===3&&audition.current?.sid===40&&audition.status==='playing');assert.equal(await page.evaluate(()=>window.__contexts.length),1);
 pass('delayed worker results cannot replace a newer static selection or autoplay; rapid named changes finish on the newest selection with one context');
 await page.evaluate(()=>{document.querySelector('.species-row[data-sid="2"] [data-fx="1"]').click();document.getElementById('stop').click()});
 await page.waitForFunction(()=>audition.current?.sid===2&&!audition.composing);assert.equal(await page.evaluate(()=>audition.status),'stopped');assert.equal(await page.evaluate(()=>audition.synth.notetab.length),0);
 // Hold the resume promise after the actual gesture has resumed the context.
 await page.evaluate(()=>{const s=audition.synth,resume=s.resume;let release;window.__resumeGate=new Promise(r=>release=r);window.__releaseResume=release;s.resume=function(){s.resume=resume;return Promise.resolve(resume()).then(()=>window.__resumeGate)}});
 await page.locator('.species-row[data-sid="44"] [data-fx="1"]').click();
 await page.locator('[data-kind="check"]').click();await page.waitForFunction(()=>audition.kind==='check'&&audition.status==='playing');
 const afterResume=await page.evaluate(()=>({serial:audition.serial,midi:audition.current.midi_b64}));await page.evaluate(()=>window.__releaseResume());await page.waitForTimeout(80);
 assert.deepEqual(await page.evaluate(()=>({serial:audition.serial,midi:audition.current.midi_b64})),afterResume);assert.equal(await page.evaluate(()=>audition.status),'playing');
 await page.locator('[data-kind="name"]').click();await page.waitForFunction(()=>audition.kind==='name'&&audition.status==='playing');
 pass('Stop cancels pending named autoplay; an older delayed resume cannot restart or replace the newer static performance');
 // A real transport error does not poison the original 600 samples or future retries.
 await page.locator('#stop').click();await page.evaluate(()=>{audition.names.dispose();audition.names.cache.clear()});
 await page.route('**/names/banks-*',route=>route.fulfill({status:503,body:'unavailable'}));
 await page.locator('.species-row[data-sid="44"] [data-fx="0"]').click();await page.waitForFunction(()=>!audition.composing&&audition.status==='stopped'&&!audition.current);
 assert.match(await page.locator('#status').textContent(),/could not load/i);
 await page.locator('[data-kind="check"]').click();await page.locator('#play').click();await page.waitForFunction(()=>audition.kind==='check'&&audition.status==='playing');
 await page.unroute('**/names/banks-*');await page.locator('[data-kind="name"]').click();await page.waitForFunction(()=>audition.kind==='name'&&audition.status==='playing');
 pass('worker bank errors show an actionable retry; static samples keep playing and Name Songs recover without reload');
 // Generated MIDI drives the exact production art helper, with regular art fixed.
 await page.waitForFunction(()=>document.getElementById('art').src.includes(';r=')&&atob(document.getElementById('art').src.split(',')[1]).includes('data:image/gif'));
 let art=await page.evaluate(()=>({src:document.getElementById('art').src,midi:audition.current.midi_b64,sid:audition.sid,writes:window.__artWrites}));
 const svg=src=>Buffer.from(src.slice(src.indexOf(',')+1),'base64').toString('latin1'),gif=text=>Buffer.from(/data:image\/gif;base64,([A-Za-z0-9+/=]+)/.exec(text)[1],'base64'),strip=text=>text.replace(/data:image\/(gif|png);base64,[A-Za-z0-9+/=]+/,'RASTER');
 let write=art.writes.findLast(w=>w.src===art.src);assert(write);
 assert.deepEqual(gif(svg(art.src)),Buffer.from(retimeGif(gif(svg(data.art[art.sid])),beatSeconds(write.status,Buffer.from(art.midi,'base64')),write.status.passSeconds)));
 assert.equal(strip(svg(art.src)),strip(svg(data.art[art.sid])));
 await page.locator('#play').click();await page.waitForFunction(()=>audition.status==='paused'&&atob(document.getElementById('art').src.split(',')[1]).includes('data:image/png'));
 const paused=await page.locator('#art').getAttribute('src');await page.waitForTimeout(100);assert.equal(await page.locator('#art').getAttribute('src'),paused);
 await page.locator('#play').click();await page.waitForFunction(()=>audition.status==='playing'&&atob(document.getElementById('art').src.split(',')[1]).includes('data:image/gif'));
 // Force older image completions to arrive after a newer named species.
 await page.evaluate(()=>{window.__deferArt=true;window.__artPending=[]});
 for(const sid of [1,68]){await page.locator(`.species-row[data-sid="${sid}"] [data-fx="3"]`).click();await page.waitForFunction(sid=>audition.sid===sid&&audition.status==='playing',sid);await page.waitForFunction(()=>window.__artPending.length>0)}
 await page.evaluate(()=>{window.__deferArt=false;for(const load of window.__artPending.splice(0).reverse())load()});await page.waitForTimeout(150);
 assert.equal(strip(svg(await page.locator('#art').getAttribute('src'))),strip(svg(data.art[68])));
 pass('generated tempo drives exact production GIF retiming; pause/resume and delayed image completions preserve the selected regular art');
 await page.evaluate(()=>location.hash='name-68-3-1157');await namedReady();await page.waitForFunction(()=>audition.nameVariant===1157&&audition.current?.nameVariant===1157);
 await page.evaluate(()=>{window.__passes=[];audition.timing.onPassStart(e=>window.__passes.push(e))});await page.locator('#play').click();await page.waitForFunction(()=>audition.status==='playing');
 const duration=await page.evaluate(()=>audition.midi.duration);assert(duration>18&&duration<20);
 await page.waitForFunction(()=>window.__passes.some(e=>e.passIndex===1),{},{timeout:25000});
 const loop=await page.evaluate(()=>window.__passes.find(e=>e.passIndex===1));assert(Math.abs(loop.audioTime-loop.audibleTime)<.05);
 await page.waitForFunction(runId=>window.__artWrites.some(w=>w.status?.runId===runId&&w.status?.positionSeconds>18.9),loop.runId);
 assert.equal(await page.evaluate(()=>window.__contexts.length),1);
 pass('a real full 19-second named Yeti loop restarts the regular artwork at the latency-compensated audible boundary');
 await page.locator('#stop').click();
 for(const invalid of ['#name-0-0-1','#name-76-0-1','#name-44-4-1','#name-44-0-0','#name-44-0-1243','#bad']){await page.evaluate(x=>location.hash=x,invalid);await page.waitForFunction(()=>audition.kind==='check'&&audition.sid===1&&audition.fx===0&&location.hash==='#check-1-0');assert.equal(await page.evaluate(()=>location.hash),'#check-1-0')}
 await page.evaluate(()=>location.hash='name-75-3-1242');await namedReady();assert.equal(await page.evaluate(()=>audition.nameVariant),1242);await page.reload();await ready();await namedReady();assert.equal(await page.evaluate(()=>audition.nameVariant),1242);assert.equal(await page.evaluate(()=>audition.status),'stopped');
 pass('last official name and share/reload work; invalid named URLs fall back to the original default without autoplay');
 await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'/tmp/beast-name-song-desktop.png'});
 await page.setViewportSize({width:390,height:844});await page.locator('#art').evaluate(img=>img.decode());await page.evaluate(()=>scrollTo(0,0));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'/tmp/beast-name-song-mobile.png'});
 assert(await page.locator('#name-prefix').isVisible());assert(await page.locator('#name-suffix').isVisible());
 const reduced=await browser.newContext({reducedMotion:'reduce'}),rp=await reduced.newPage();rp.on('pageerror',e=>errors.push(e.message));
 await rp.goto(origin+'/#name-44-3-1');await rp.waitForFunction(()=>audition.current?.kind==='name'&&atob(document.getElementById('art').src.split(',')[1]).includes('data:image/png'));const still=await rp.locator('#art').getAttribute('src');await rp.locator('#play').click();await rp.waitForFunction(()=>audition.status==='playing');await rp.waitForTimeout(180);assert.equal(await rp.locator('#art').getAttribute('src'),still);await reduced.close();
 pass('390px controls fit without overflow; reduced motion keeps the regular first-frame still during Name Song playback');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);pass('zero JavaScript errors and zero external network requests; every shipped asset resolves relatively');
 fs.writeFileSync(new URL('names/browser-proof.json',dir),JSON.stringify({browser:'Chromium',url:origin,revision:manifest.revision,workerSha256:manifest.worker.sha256,dataSha256:manifest.data.sha256,cairoProofSha256:hash(fs.readFileSync(new URL('names/parity.json',dir))),cases:observed.length,checks,peaks,gesture,loop,errors,external,screenshots:['/tmp/beast-name-song-desktop.png','/tmp/beast-name-song-mobile.png']},null,2)+'\n');
}finally{await browser.close()}
