#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {retimeGif,beatSeconds,artTime,gifFrames} from '../species-presets/art-sync.mjs';
import {decodeGif} from './deps/gif-decode.mjs';
const {chromium}=createRequire(import.meta.url)('/workspace/beasts-v3/node_modules/playwright');
const origin=process.env.AUDITION_URL||'http://127.0.0.1:8793';
const dir=new URL('../species-presets/',import.meta.url),manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',dir)));
const data=JSON.parse(gunzipSync(fs.readFileSync(new URL(manifest.data.file,dir))));
const svg=src=>Buffer.from(src.slice(src.indexOf(',')+1),'base64').toString('latin1');
const gif=text=>Buffer.from(/data:image\/gif;base64,([A-Za-z0-9+/=]+)/.exec(text)[1],'base64');
const strip=text=>text.replace(/data:image\/(gif|png);base64,[A-Za-z0-9+/=]+/,'RASTER');
const hash=x=>createHash('sha256').update(x).digest('hex');
const checks=[],errors=[],external=[];
const pass=s=>{checks.push(s);console.log('PASS '+s)};
const browser=await chromium.launch(),context=await browser.newContext({viewport:{width:1280,height:900}});
await context.addInitScript(()=>{
 const A=window.AudioContext;window.AudioContext=new Proxy(A,{construct(t,args){const c=new t(...args);(window.__contexts||=[]).push(c);return c}});
 const src=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');window.__artWrites=[];window.__artPending=[];
 Object.defineProperty(HTMLImageElement.prototype,'src',{get:src.get,set(value){
  if(value.startsWith('data:image/svg+xml;')&&value.slice(0,value.indexOf(',')).includes(';r=')){
   window.__artWrites.push({src:value,at:performance.now(),status:window.audition?.timing.getPlayStatus()});
   if(window.__deferArt){window.__artPending.push(()=>src.set.call(this,value));return;}
  }
  src.set.call(this,value);
 }});
});
context.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(origin+'/'))external.push(r.url())});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
const ready=async p=>{await p.waitForFunction(()=>window.audition?.data&&window.audition.midi);await p.locator('#art').evaluate(img=>img.decode())};
const current=()=>page.evaluate(()=>({src:document.getElementById('art').src,sid:audition.sid,fx:audition.fx,status:audition.timing.getPlayStatus(),writes:window.__artWrites}));
async function retimed(){await page.waitForFunction(()=>document.getElementById('art').src.includes(';r=')&&atob(document.getElementById('art').src.split(',')[1]).includes('data:image/gif'));await page.locator('#art').evaluate(img=>img.decode());return current()}
function checkRetimed(c,at=null){
 const sample=data.samples.find(s=>s.kind===c.status.kind&&s.sid===c.sid&&s.fx===c.fx)||data.samples.find(s=>s.kind==='check'&&s.sid===c.sid&&s.fx===c.fx);
 const native=svg(data.art[c.sid]),text=svg(c.src),write=c.writes.findLast(w=>w.src===c.src);
 assert(write,'shown image has a recorded fresh decode');
 const expected=retimeGif(gif(native),beatSeconds(write.status,Buffer.from(sample.midi_b64,'base64')),write.status.passSeconds,at===true?artTime(write.status):at);
 assert.deepEqual(gif(text),Buffer.from(expected),'shown GIF is the pinned production retiming/phase');
 assert.equal(strip(text),strip(native),'SVG and ambient SMIL outside the first raster remain byte-identical');
 return write;
}
try{
 await page.goto(origin+'/#check-72-0');await ready(page);assert.equal(svg((await current()).src),svg(data.art[72]));
 await page.locator('#play').click();let c=await retimed();checkRetimed(c);assert.equal(gifFrames(gif(svg(c.src))).frames[0].delay,330);
 await page.locator('.presets [data-fx="1"]').click();await page.waitForFunction(()=>audition.fx===1&&audition.status==='playing');c=await retimed();checkRetimed(c);assert.equal(c.sid,72);assert.notEqual(gif(svg(c.src)).toString('base64'),gif(svg(data.art[72])).toString('base64'));
 await page.locator('.species-row[data-sid="68"] [data-fx="3"]').click();await page.waitForFunction(()=>audition.sid===68&&audition.status==='playing');c=await retimed();checkRetimed(c);assert.equal(gifFrames(gif(svg(c.src))).frames[0].delay,300);
 // Return to a previous species, then restart its identical performance.
 await page.locator('.species-row[data-sid="72"] [data-fx="0"]').click();await page.waitForFunction(()=>audition.sid===72&&audition.status==='playing');const repeated=await retimed();checkRetimed(repeated);
 const sameTempoNode=await page.locator('#art').elementHandle(),priorWrite=repeated.writes.findLast(w=>w.src===repeated.src);
 await page.locator('.presets [data-fx="0"]').click();await page.waitForFunction(()=>audition.fx===0&&audition.status==='playing');const sameTempo=await retimed();const freshWrite=checkRetimed(sameTempo);
 assert.deepEqual(gif(svg(repeated.src)),gif(svg(sameTempo.src)),'reselecting the same performance has identical GIF bytes');assert.notEqual(repeated.src,sameTempo.src);assert(freshWrite.at>priorWrite.at);assert.equal(await sameTempoNode.evaluate(img=>img.isConnected),false,'a newly decoded image instance replaces the earlier clock');
 const seen=await page.evaluate(()=>window.__artWrites.map(w=>w.src));assert.equal(new Set(seen).size,seen.length,'restart URLs never repeat across helper mounts');
 await page.locator('.species-row[data-sid="68"] [data-fx="3"]').click();await page.waitForFunction(()=>audition.sid===68&&audition.status==='playing');c=await retimed();checkRetimed(c);
 pass('real low/high BPM and FX changes use production beat timing and the same regular card; surrounding SVG/SMIL bytes preserved');
 await page.waitForTimeout(460);await page.locator('#play').click();await page.waitForFunction(()=>audition.synth.getAudioContext().state==='suspended'&&atob(document.getElementById('art').src.split(',')[1]).includes('data:image/png'));
 const paused=await current(),position=paused.status.positionSeconds;assert.equal(strip(svg(paused.src)),strip(svg(data.art[68])));await page.waitForTimeout(250);assert.equal((await current()).src,paused.src);assert.equal((await current()).status.positionSeconds,position);
 await page.locator('#play').click();c=await retimed();checkRetimed(c,true);
 pass('pause freezes only the GIF on its shown frame; audible clock holds; resume uses a shortened current frame and preserves ambient SMIL');
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.__hidden??false});window.__hidden=true;document.dispatchEvent(new Event('visibilitychange'))});
 await page.waitForTimeout(420);const beforeVisible=(await current()).src;
 await page.evaluate(()=>{window.__hidden=false;document.dispatchEvent(new Event('visibilitychange'))});
 await page.waitForFunction(src=>document.getElementById('art').src!==src,beforeVisible);c=await retimed();checkRetimed(c,true);
 pass('visibility restoration rebuilds the retimed GIF at the audible musical phase');
 // Hold image loads to force older species and older pause results to arrive last.
 await page.evaluate(()=>{window.__deferArt=true;window.__artPending=[]});
 for(const [sid,fx]of[[1,0],[44,1],[64,3]]){
  await page.locator(`.species-row[data-sid="${sid}"] [data-fx="${fx}"]`).click();await page.waitForFunction(sid=>audition.sid===sid&&audition.status==='playing',sid);
  await page.waitForFunction(()=>window.__artPending.length>0);await page.waitForTimeout(230);
 }
 await page.evaluate(()=>{window.__deferArt=false;for(const load of window.__artPending.splice(0).reverse())load()});
 c=await retimed();assert.equal(c.sid,64);checkRetimed(c);await page.waitForTimeout(150);assert.equal(strip(svg((await current()).src)),strip(svg(data.art[64])));
 await page.evaluate(()=>{window.__deferArt=true;window.__artPending=[]});await page.locator('#play').click();await page.waitForFunction(()=>window.__artPending.length>0&&audition.synth.getAudioContext().state==='suspended');
 await page.locator('#play').click();await page.waitForFunction(()=>window.__artPending.length>=2&&audition.status==='playing');
 await page.evaluate(()=>{window.__deferArt=false;for(const load of window.__artPending.splice(0).reverse())load()});c=await retimed();checkRetimed(c,true);assert(!svg(c.src).includes('data:image/png'));
 assert.equal(await page.evaluate(()=>window.__contexts.length),1);
 pass('out-of-order species images and a delayed pause still cannot replace the latest performance/resume; one AudioContext');
 // Observe the real synth crossing a full musical pass, including its look-ahead scheduler.
 await page.evaluate(()=>{window.__passes=[];audition.timing.onPassStart(e=>window.__passes.push(e))});
 await page.locator('.species-row[data-sid="68"] [data-fx="3"]').click();await page.waitForFunction(()=>audition.sid===68&&audition.status==='playing');await retimed();
 await page.waitForFunction(()=>window.__passes.some(e=>e.passIndex===1),{},{timeout:18000});c=await retimed();checkRetimed(c);
 const loop=await page.evaluate(()=>window.__passes.find(e=>e.passIndex===1));assert(Math.abs(loop.audioTime-loop.audibleTime)<.05);
 pass('a real full musical loop restarts the GIF from frame zero at the latency-compensated audible boundary');
 await page.locator('#stop').click();await page.locator('#art').evaluate(img=>img.decode());assert.equal((await current()).status.positionSeconds,null);
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(100);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));let box=await page.locator('#art').boundingBox();assert(box.width>80&&box.height>100);await page.screenshot({path:'/tmp/beast-art-sync-mobile.png'});
 await page.setViewportSize({width:1280,height:900});await page.screenshot({path:'/tmp/beast-art-sync-desktop.png'});
 pass('image load/decode, stop, artwork resize and 390px mobile layout remain usable');
 const reduced=await browser.newContext({reducedMotion:'reduce'}),rp=await reduced.newPage();reduced.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(origin+'/'))external.push(r.url())});rp.on('pageerror',e=>errors.push(e.message));
 await rp.goto(origin+'/#check-64-0');await ready(rp);await rp.waitForFunction(()=>atob(document.getElementById('art').src.split(',')[1]).includes('data:image/png'));
 const first=await rp.locator('#art').getAttribute('src');
 const pngHash=await rp.evaluate(async()=>{const text=atob(document.getElementById('art').src.split(',')[1]),png=/data:image\/png;base64,[A-Za-z0-9+/=]+/.exec(text)[0],img=new Image();img.src=png;await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const g=c.getContext('2d');g.drawImage(img,0,0);return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',g.getImageData(0,0,c.width,c.height).data)),b=>b.toString(16).padStart(2,'0')).join('')});
 assert.equal(pngHash,hash(decodeGif(gif(svg(data.art[64]))).frames[0].rgba));
 await rp.locator('#play').click();await rp.waitForFunction(()=>audition.status==='playing');await rp.waitForTimeout(700);assert.equal(await rp.locator('#art').getAttribute('src'),first);
 await rp.locator('#play').click();await rp.locator('#play').click();await rp.waitForTimeout(150);assert.equal(await rp.locator('#art').getAttribute('src'),first);await reduced.close();
 pass('prefers-reduced-motion keeps the exact first-frame pixels during play/pause/resume');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);pass('zero browser errors and zero external requests');
 console.log(JSON.stringify({url:origin,checks,javascriptErrors:errors,externalRequests:external,screenshots:['/tmp/beast-art-sync-desktop.png','/tmp/beast-art-sync-mobile.png']},null,2));
}finally{await browser.close()}
