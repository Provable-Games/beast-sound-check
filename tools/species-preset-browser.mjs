#!/usr/bin/env node
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('/workspace/beasts-v3/node_modules/playwright');
const origin = process.env.AUDITION_URL || 'http://127.0.0.1:8791';
const root = path.resolve(new URL('..', import.meta.url).pathname);
const browser = await chromium.launch();
const context = await browser.newContext({ viewport:{width:1280,height:900} });
await context.addInitScript(() => {
  const A = window.AudioContext;
  window.AudioContext = new Proxy(A, { construct(t,args) { const c = new t(...args); (window.__contexts ||= []).push(c); return c; } });
});
const page = await context.newPage(), errors = [], external = [];
page.on('pageerror', e=>errors.push(e.message));
context.on('request', r=>{if (/^https?:/.test(r.url()) && !r.url().startsWith(origin+'/')) external.push(r.url());});
const checks = [], pass = s=>{checks.push(s);console.log('PASS '+s);};
async function ready() {
  await page.waitForFunction(()=>window.audition?.data?.samples.length===300 && !document.getElementById('play').disabled);
  await page.locator('#art').evaluate(img=>img.decode());
}
async function audible(sid,fx) {
  await page.locator(`.species-row[data-sid="${sid}"] button[data-fx="${fx}"]`).click();
  await page.waitForFunction(({sid,fx})=>window.audition.sid===sid&&window.audition.fx===fx&&window.audition.status==='playing'&&window.audition.synth.getAudioContext().state==='running',{sid,fx});
  const peak = await page.evaluate(async()=>{
    const s=window.audition.synth,c=s.getAudioContext();
    if(!window.__analyser){const a=c.createAnalyser(),g=c.createGain();g.gain.value=0;s.out.connect(a);a.connect(g);g.connect(c.destination);window.__analyser=a;}
    const a=window.__analyser,b=new Float32Array(a.fftSize);let peak=0;
    for(let i=0;i<60;i++){a.getFloatTimeDomainData(b);for(const v of b)peak=Math.max(peak,Math.abs(v));if(peak>0.00001)break;await new Promise(r=>setTimeout(r,25));}
    return peak;
  });
  assert(peak>0.00001,`silent ${sid}/${fx}: ${peak}`);
  assert.equal(await page.evaluate(()=>window.__contexts.length),1);
  return peak;
}
try {
  await page.goto(origin+'/');await ready();
  assert.equal(await page.locator('.species-row').count(),75);
  assert.equal(await page.locator('.species-row button[data-fx]').count(),300);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal(await page.locator('iframe').count(),0);
  pass('75 species, 300 preset buttons, no external player or horizontal overflow');
  const peaks=[];
  for(const [sid,fx] of [[1,0],[1,1],[1,2],[1,3],[44,0],[44,3],[68,3],[39,2],[40,1]]) peaks.push({sid,fx,peak:await audible(sid,fx)});
  pass('nine parent-button selections produce non-silent audio, all four presets, one AudioContext');
  const art=await page.locator('#art').getAttribute('src');
  await audible(40,3);assert.equal(await page.locator('#art').getAttribute('src'),art);
  await page.evaluate(()=>{for(const fx of [0,1,2,3])document.querySelector(`.species-row[data-sid="44"] button[data-fx="${fx}"]`).click();});
  await page.waitForFunction(()=>window.audition.sid===44&&window.audition.fx===3&&window.audition.status==='playing');
  assert.equal(await page.evaluate(()=>window.__contexts.length),1);
  await page.locator('#stop').click();
  assert.equal(await page.evaluate(()=>window.audition.synth.getPlayStatus().play),0);
  assert.equal(await page.evaluate(()=>window.audition.synth.notetab.length),0);
  pass('fixed regular art, rapid switching settles latest selection; Stop clears every old note');
  await page.locator('#play').click();await page.waitForFunction(()=>window.audition.status==='playing');
  await page.locator('#play').click();await page.waitForFunction(()=>window.audition.synth.getAudioContext().state==='suspended');
  await page.locator('#play').click();await page.waitForFunction(()=>window.audition.status==='playing'&&window.audition.synth.getAudioContext().state==='running');
  pass('pause/resume retains the primed context');
  await page.locator('#search').fill('Balrog');assert.equal(await page.locator('.species-row:visible').count(),1);assert.equal(await page.locator('.species-row:visible .species-title').textContent(),'Asag');
  await page.locator('#search').fill('Ent');assert.equal(await page.locator('.species-row[data-sid="70"]').isVisible(),true);
  await page.locator('#search').fill('Satori');assert.equal(await page.locator('.species-row:visible').count(),1);
  await page.locator('#search').fill('');
  await page.locator('#next').click();assert.equal(await page.evaluate(()=>window.audition.sid),45);assert.equal(await page.evaluate(()=>window.audition.fx),3);
  await page.locator('#previous').click();await page.keyboard.press('ArrowLeft');assert.equal(await page.evaluate(()=>window.audition.sid),44);assert.equal(await page.evaluate(()=>window.audition.fx),2);
  pass('name/alias search, species stepping preserves preset, keyboard preset changes preserve species');
  await page.goto(origin+'/#1-0');await page.reload();await ready();await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(150);
  await page.screenshot({path:'/tmp/beast-species-presets-desktop.png',fullPage:false});
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal(await page.locator('.species-row button[data-fx]').count(),300);
  await page.locator('[data-sid="1"][data-fx="3"]').click();await page.waitForFunction(()=>window.audition.status==='playing');
  await page.locator('#stop').click();await page.evaluate(()=>scrollTo(0,0));await page.locator('#art').evaluate(img=>img.decode());
  await page.screenshot({path:'/tmp/beast-species-presets-mobile.png',fullPage:false});
  pass('390px mobile layout and preset control; screenshots wait for decoded art and enabled controls');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  pass('zero browser JavaScript errors and zero external network requests');
  fs.writeFileSync(path.join(root,'species-presets/browser-proof.json'),JSON.stringify({browser:'Chromium',url:origin,checks,peaks,screenshots:['/tmp/beast-species-presets-desktop.png','/tmp/beast-species-presets-mobile.png'],javascriptErrors:errors,externalRequests:external},null,2)+'\n');
} finally {await browser.close();}
