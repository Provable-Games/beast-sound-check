#!/usr/bin/env node
import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const {chromium}=createRequire(import.meta.url)('/workspace/beasts-v3/node_modules/playwright');
const origin=process.env.AUDITION_URL||'http://127.0.0.1:8791';
const root=path.resolve(new URL('..',import.meta.url).pathname),dir=path.join(root,'species-presets');
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));
const data=JSON.parse(gunzipSync(fs.readFileSync(path.join(dir,manifest.data.file))));
const original=JSON.parse(fs.readFileSync(path.join(dir,'species-song-manifest.json')));
const oldData=JSON.parse(gunzipSync(fs.readFileSync(path.join(dir,original.data.file))));
const hash=x=>createHash('sha256').update(x).digest('hex');
// Retiming/stilling changes only the embedded GIF/PNG, preserving card identity.
const cardIdentity=src=>Buffer.from(src.slice(src.indexOf(',')+1),'base64').toString('latin1').replace(/data:image\/(?:gif|png);base64,[A-Za-z0-9+/=]+/,'RASTER');
assert.equal(data.samples.length,600);
assert.deepEqual(data.art,oldData.art);assert.deepEqual(data.species,oldData.species);
const satoriProof=JSON.parse(fs.readFileSync(path.join(dir,'satori-song-cairo-proof.json')));
for(const s of data.samples.filter(s=>s.kind==='song')){
 if(s.sid===44){const c=satoriProof.captures.find(x=>x.fx===s.fx);assert.equal(s.midiSha256,c.midiSha256);assert.equal(s.settingsHash,c.settingsHash);assert.equal(s.key,'A Aeolian');continue;}
 const {kind,...rest}=s;assert.deepEqual(rest,oldData.samples.find(x=>x.sid===s.sid&&x.fx===s.fx));assert.equal(data.settings[s.settingsKey],oldData.settings[s.settingsKey]);
}
const browser=await chromium.launch(),context=await browser.newContext({viewport:{width:1280,height:900}});
await context.addInitScript(()=>{const A=window.AudioContext;window.AudioContext=new Proxy(A,{construct(t,args){const c=new t(...args);(window.__contexts||=[]).push(c);return c}})});
const page=await context.newPage(),errors=[],external=[],checks=[],peaks=[];
page.on('pageerror',e=>errors.push(e.message));context.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(origin+'/'))external.push(r.url())});
const pass=s=>{checks.push(s);console.log('PASS '+s)};
const ready=async()=>{await page.waitForFunction(()=>window.audition?.data?.samples.length===600&&!document.getElementById('play').disabled);await page.locator('#art').evaluate(img=>img.decode())};
async function audible(kind,sid,fx){
 if(await page.evaluate(()=>window.audition.kind)!==kind)await page.locator(`[data-kind="${kind}"]`).click();
 await page.locator(`.species-row[data-sid="${sid}"] button[data-fx="${fx}"]`).click();
 await page.waitForFunction(({kind,sid,fx})=>window.audition.kind===kind&&window.audition.sid===sid&&window.audition.fx===fx&&window.audition.status==='playing'&&window.audition.synth.getAudioContext().state==='running',{kind,sid,fx});
 const peak=await page.evaluate(async()=>{const s=window.audition.synth,c=s.getAudioContext();if(!window.__analyser){const a=c.createAnalyser(),g=c.createGain();g.gain.value=0;s.out.connect(a);a.connect(g);g.connect(c.destination);window.__analyser=a}const a=window.__analyser,b=new Float32Array(a.fftSize);let peak=0;for(let i=0;i<80;i++){a.getFloatTimeDomainData(b);for(const v of b)peak=Math.max(peak,Math.abs(v));if(peak>.00001)break;await new Promise(r=>setTimeout(r,25))}return peak});
 assert(peak>.00001,`silent${kind}/${sid}/${fx}`);assert.equal(await page.evaluate(()=>window.__contexts.length),1);peaks.push({kind,sid,fx,peak});
}
try{
 await page.goto(origin+'/');await ready();assert.equal(await page.evaluate(()=>window.audition.kind),'check');
 assert.equal(await page.locator('.species-row').count(),75);assert.equal(await page.locator('.species-row button[data-fx]').count(),300);
 assert.equal(await page.locator('.species-row[data-sid="64"]').count(),1);
 assert.match(await page.locator('#source').textContent(),/Sound Check candidates/);
 assert.match(await page.locator('.presets [data-fx="2"]').textContent(),/Portato/);
 assert.doesNotMatch(await page.locator('#column-head').textContent(),/Echo/);
 await audible('check',1,0);
 const selections=await page.evaluate(async()=>{const a=window.audition,load=a.synth.loadMIDI; a.synth.loadMIDI=function(bytes){window.__lastLoaded=btoa(String.fromCharCode(...bytes));return load.call(this,bytes)};const out=[];for(const kind of ['song','check']){document.querySelector(`[data-kind="${kind}"]`).click();for(const button of document.querySelectorAll('.species-row [data-fx]')){button.click();const s=a.current;out.push({kind:a.kind,sid:s.sid,fx:s.fx,midi:s.midi_b64,settings:a.data.settings[s.settingsKey]})}}return out});
 assert.equal(selections.length,600);assert.equal(new Set(selections.map(s=>`${s.kind}-${s.sid}-${s.fx}`)).size,600);
 for(const s of selections){const expected=data.samples.find(x=>x.kind===s.kind&&x.sid===s.sid&&x.fx===s.fx);assert.equal(hash(Buffer.from(s.midi,'base64')),expected.midiSha256);assert.equal(hash(s.settings),expected.settingsSha256)}
 await page.waitForFunction(()=>window.audition.sid===75&&window.audition.fx===3&&window.audition.kind==='check'&&window.audition.status==='playing');
 assert.equal(await page.evaluate(()=>window.__lastLoaded),data.samples.find(s=>s.kind==='check'&&s.sid===75&&s.fx===3).midi_b64);
 assert.equal(await page.evaluate(()=>window.__contexts.length),1);
 pass('all600 UI selections resolve exact MIDI/settings;75rows/300buttons per mode;one Cyclops row;one context and latest request wins');
 for(const [kind,sid,fx]of [['song',1,0],['song',1,1],['song',1,2],['song',1,3],['song',44,0],['song',44,1],['song',44,2],['song',44,3],['check',64,0],['check',64,1],['check',64,2],['check',64,3],['check',2,2],['check',44,1]])await audible(kind,sid,fx);
 pass('both modes and all Song presets produce non-silent audio; Cyclops complete504 and another portato Check play through the persistent synth');
 const current=await page.evaluate(()=>({sid:audition.sid,fx:audition.fx,art:audition.data.art[audition.sid]}));
 await page.locator('[data-kind="song"]').click();assert.equal(await page.evaluate(()=>audition.sid),current.sid);assert.equal(await page.evaluate(()=>audition.fx),current.fx);assert.equal(cardIdentity(await page.locator('#art').getAttribute('src')),cardIdentity(current.art));
 assert.match(await page.locator('.presets [data-fx="2"]').textContent(),/Echo/);
 await page.locator('[data-kind="check"]').click();assert.equal(await page.evaluate(()=>audition.sid),current.sid);assert.equal(await page.evaluate(()=>audition.fx),current.fx);assert.match(await page.locator('.presets [data-fx="2"]').textContent(),/Portato/);
 pass('mode switches preserve species/preset/fixed art and use accurate Song echo vs Check portato labels');
 await page.locator('#stop').click();assert.equal(await page.evaluate(()=>audition.synth.getPlayStatus().play),0);assert.equal(await page.evaluate(()=>audition.synth.notetab.length),0);
 await page.locator('#play').click();await page.waitForFunction(()=>audition.status==='playing');await page.locator('#play').click();await page.waitForFunction(()=>audition.synth.getAudioContext().state==='suspended');await page.locator('#play').click();await page.waitForFunction(()=>audition.status==='playing'&&audition.synth.getAudioContext().state==='running');assert.equal(await page.evaluate(()=>window.__contexts.length),1);
 pass('Stop clears old notes; pause/resume reuses the same context without overlap');
 await page.locator('#search').fill('Balrog');assert.equal(await page.locator('.species-row:visible .species-title').textContent(),'Asag');await page.locator('#search').fill('Ent');assert.equal(await page.locator('.species-row[data-sid="70"]').isVisible(),true);await page.locator('#search').fill('');
 await page.locator('#next').click();assert.equal(await page.evaluate(()=>audition.sid),45);assert.equal(await page.evaluate(()=>audition.fx),1);await page.locator('#previous').click();await page.keyboard.press('ArrowLeft');assert.equal(await page.evaluate(()=>audition.sid),44);assert.equal(await page.evaluate(()=>audition.fx),0);
 await page.goto(origin+'/#64-0');await ready();assert.equal(await page.evaluate(()=>audition.kind),'song');assert.equal(await page.evaluate(()=>audition.sid),64);
 await page.goto(origin+'/#check-64-3');await ready();assert.equal(await page.evaluate(()=>audition.kind),'check');assert.equal(await page.evaluate(()=>audition.fx),3);assert.match(await page.locator('#mode-note').textContent(),/eight sounds|eight-sound/);assert.match(await page.locator('.presets [data-fx="3"]').textContent(),/Mega\/accent/);assert.doesNotMatch(await page.locator('.presets').textContent(),/Fixed504/);
 assert.equal(new Set(data.samples.filter(s=>s.kind==='check'&&s.sid===64).map(s=>s.midiSha256)).size,4);
 pass('search/aliases/keyboard remain available; legacy#64-0 is Song and#check-64-3 is the included Cyclops candidate');
 await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'/tmp/beast-song-check-desktop.png'});
 await page.setViewportSize({width:390,height:844});await page.locator('#art').evaluate(img=>img.decode());await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);const box=await page.locator('#art').boundingBox();assert(box.width>80&&box.height>100);await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'/tmp/beast-song-check-mobile.png'});
 await page.locator('[data-kind="song"]').click();await page.locator('#art').evaluate(img=>img.decode());assert.equal(await page.locator('.species-row button[data-fx]').count(),300);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 pass('390px mobile layout fits both modes; art decoded and visible before screenshots');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);pass('zero browser errors and zero external network requests');
 fs.writeFileSync(path.join(dir,'browser-proof.json'),JSON.stringify({browser:'Chromium',url:origin,dataSha256:manifest.data.sha256,samples:600,modes:['song','check'],checks,peaks,screenshots:['/tmp/beast-song-check-desktop.png','/tmp/beast-song-check-mobile.png'],javascriptErrors:errors,externalRequests:external},null,2)+'\n');
}finally{await browser.close()}
