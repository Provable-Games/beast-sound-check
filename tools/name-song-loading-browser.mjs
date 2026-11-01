#!/usr/bin/env node
// Regression coverage for the optional Name Song loading/error UI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('/workspace/beasts-v3/node_modules/playwright');
const origin=process.env.AUDITION_URL||'http://127.0.0.1:8794/species-presets';
const checks=[],errors=[];
const pass=text=>{checks.push(text);console.log('PASS '+text)};
const browser=await chromium.launch();
const ready=page=>page.waitForFunction(()=>window.audition?.data&&document.querySelectorAll('.species-row').length===75&&!document.getElementById('play').disabled);
const png=src=>/data:image\/png;base64,[A-Za-z0-9+/=]+/.exec(Buffer.from(src.slice(src.indexOf(',')+1),'base64').toString('latin1'))?.[0];
function watch(page){page.on('pageerror',error=>errors.push(error.message))}
async function unavailableRoll(page,title){
 assert.match(await page.locator('#midi-panel h2').textContent(),title);
 assert.match(await page.locator('.midi-caption').textContent(),/unavailable/i);
 assert.equal(await page.locator('#midi-panel').getAttribute('aria-busy'),'false');
 for(const selector of ['canvas','.midi-legend','.midi-window','.midi-detail','.midi-views'])assert.equal(await page.locator('#midi-panel '+selector).isVisible(),false,selector+' must not expose old notes');
}
try {
 for(const failure of ['404','abort']) {
  const context=await browser.newContext(),page=await context.newPage();watch(page);
  await page.route('**/names/manifest.json',route=>failure==='404'?route.fulfill({status:404,body:'missing'}):route.abort());
  await page.goto(origin+(failure==='abort'?'/#name-44-0-1':'/'));await ready(page);
  assert.equal(await page.locator('.species-row [data-fx]').count(),300);
  if(failure==='404') {
   // Lazy Name metadata failure cannot block or even delay the base lab.
   assert.equal(await page.evaluate(()=>audition.kind),'check');
   await page.locator('#play').click();await page.waitForFunction(()=>audition.status==='playing');
   await page.locator('[data-kind="name"]').click();
  }
  await page.waitForFunction(()=>audition.kind==='name'&&!audition.composing&&!audition.current);
  assert.match(await page.locator('#source').textContent(),/Name Song unavailable.*Species Song and Sound Check remain available/);
  assert.match(await page.locator('#status').textContent(),/retry/i);
  assert.equal(await page.locator('#name-prefix').isDisabled(),true);
  await unavailableRoll(page,/Name #1.*Name Song/);
  for(const kind of ['song','check']) {
   await page.locator(`[data-kind="${kind}"]`).click();
   await page.locator('.presets [data-fx="1"]').click();
   await page.waitForFunction(kind=>audition.kind===kind&&audition.status==='playing'&&audition.current?.kind===kind,kind);
   assert.equal(await page.locator('#midi-panel canvas').isVisible(),true);
  }
  await page.unroute('**/names/manifest.json');await page.locator('[data-kind="name"]').click();
  await page.waitForFunction(()=>audition.kind==='name'&&audition.current?.kind==='name'&&audition.status==='playing');
  assert.equal(await page.locator('#name-prefix option').count(),69);assert.equal(await page.locator('#midi-panel canvas').isVisible(),true);
  await context.close();
  pass(`${failure} Name manifest leaves all 75 rows/600 base choices available, handles named deep links, and retries without reload`);
 }
 const context=await browser.newContext({reducedMotion:'reduce'}),page=await context.newPage();watch(page);
 await page.goto(origin+'/#check-44-0');await ready(page);
 await page.waitForFunction(()=>atob(document.getElementById('art').src.split(',')[1]).includes('data:image/png'));
 const first=png(await page.locator('#art').getAttribute('src'));assert(first);
 await page.locator('#play').click();await page.waitForFunction(()=>audition.status==='playing');
 const oldTitle=await page.locator('#midi-panel h2').textContent();assert.match(oldTitle,/Sound Check/);
 let release;const held=new Promise(resolve=>release=resolve);
 await page.route('**/names/banks-*',async route=>{await held;await route.fulfill({status:503,body:'unavailable'})});
 await page.locator('[data-kind="name"]').click();
 await page.waitForFunction(()=>audition.composing&&audition.namesManifest&&document.getElementById('midi-panel').getAttribute('aria-busy')==='true'&&atob(document.getElementById('art').src.split(',')[1]).includes('data:image/png'));
 assert.match(await page.locator('#midi-panel h2').textContent(),/Agony Bane Satori.*Name Song/);
 assert.match(await page.locator('.midi-caption').textContent(),/Composing Name Song/);
 for(const selector of ['canvas','.midi-legend','.midi-window','.midi-detail','.midi-views'])assert.equal(await page.locator('#midi-panel '+selector).isVisible(),false);
 await page.waitForTimeout(300);assert.equal(png(await page.locator('#art').getAttribute('src')),first,'pending reduced-motion image remains the exact production first-frame PNG');
 pass('delayed composition keeps the production reduced-motion first-frame still and hides the previous Sound Check roll/title/notes');
 release();await page.waitForFunction(()=>!audition.composing&&audition.status==='stopped'&&!audition.current);
 await unavailableRoll(page,/Agony Bane Satori.*Name Song/);
 assert.equal(png(await page.locator('#art').getAttribute('src')),first,'failed composition retains the first-frame PNG');
 await page.unroute('**/names/banks-*');await page.locator('#play').click();
 await page.waitForFunction(()=>audition.current?.kind==='name'&&audition.status==='playing');
 assert.equal(await page.locator('#midi-panel canvas').isVisible(),true);assert.match(await page.locator('.midi-caption').textContent(),/notes/);
 assert.equal(png(await page.locator('#art').getAttribute('src')),first);
 await context.close();pass('failed composition retains the still and an accurate unavailable roll; Play retry restores the new named notes and playback');
 assert.deepEqual(errors,[]);pass('zero JavaScript errors across optional manifest failures, pending composition and retry');
 fs.writeFileSync(new URL('../species-presets/names/loading-browser-proof.json',import.meta.url),JSON.stringify({browser:'Chromium',url:origin,checks,errors},null,2)+'\n');
}finally{await browser.close()}
