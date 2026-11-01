#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createRequire} from 'node:module';
import {parseMidi} from '../species-presets/midi-roll.mjs';

const dir = new URL('../species-presets/', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', dir)));
const data = JSON.parse(gunzipSync(fs.readFileSync(new URL(manifest.data.file, dir))));
for (const sample of data.samples) {
  const midi = parseMidi(Buffer.from(sample.midi_b64, 'base64'));
  assert.equal(midi.notes.length, sample.notes, `${sample.kind}/${sample.sid}/${sample.fx} notes`);
  assert(Math.abs(midi.duration - sample.seconds) < .00001);
  assert(midi.notes.every(n => n.end >= n.start && n.velocity > 0 && n.velocity < 128));
  assert(Math.abs(midi.secondsToTick(midi.tickToSeconds(midi.endTick / 2)) - midi.endTick / 2) < .00001);
}
// Format 0: running note-on status, velocity-zero note-off, two tempos.
const track = Buffer.from([0,0xff,0x51,3,7,0xa1,0x20, 0,0xc0,34, 0,0x90,60,90, 48,64,70, 48,60,0, 0,0xff,0x51,3,15,0x42,0x40, 96,0x80,64,0, 0,0xff,0x2f,0]);
const header = Buffer.from([77,84,104,100,0,0,0,6,0,0,0,1,0,96,77,84,114,107,0,0,0,track.length]);
const fixture = parseMidi(Buffer.concat([header,track]));
assert.equal(fixture.duration,1.5); assert.equal(fixture.secondsToTick(1),144);
assert.deepEqual(fixture.notes.map(n=>[n.pitch,n.start,n.end,n.program]),[[60,0,96,34],[64,48,192,34]]);
console.log('PASS all600 exact note counts/durations; running status, velocity-zero release and tempo changes');

const {chromium} = createRequire(import.meta.url)('/workspace/beasts-v3/node_modules/playwright');
const origin = process.env.AUDITION_URL || 'http://127.0.0.1:8791';
const browser = await chromium.launch(), page = await browser.newPage({viewport:{width:1280,height:900}}), errors=[];
page.on('pageerror',e=>errors.push(e.message));
try {
  await page.goto(`${origin}/?v=midi-roll#check-64-0`);
  await page.waitForFunction(()=>window.audition?.midi?.notes.length===72);
  assert.equal(await page.locator('.midi-legend span').count(),8);
  await page.locator('#play').click(); await page.waitForFunction(()=>audition.status==='playing');
  await page.waitForTimeout(1200);
  const tick = () => page.locator('canvas').getAttribute('data-tick').then(Number);
  assert(await tick()>0);
  await page.locator('#play').click(); await page.waitForFunction(()=>audition.synth.getAudioContext().state==='suspended');
  await page.waitForTimeout(100); const paused = await tick(); await page.waitForTimeout(200); assert.equal(await tick(),paused);
  await page.locator('#play').click(); await page.waitForFunction(()=>audition.status==='playing');
  await page.waitForTimeout(300); assert(await tick()>paused);
  await page.locator('[data-roll="full"]').click(); assert.equal(await page.locator('.midi-window').textContent(),'Full track');
  await page.locator('[data-kind="song"]').click();
  await page.waitForFunction(()=>audition.status==='playing' && audition.midi.notes.length===audition.current.notes);
  assert.match(await page.locator('.midi-heading h2').textContent(),/Species Song/);
  assert(await page.evaluate(()=>audition.midi.notes.some(n=>n.channel===9)));
  await page.locator('#stop').click(); assert.equal(await tick(),0);
  await page.locator('[data-kind="check"]').click(); await page.locator('#play').click();
  await page.waitForFunction(()=>audition.status==='playing');
  // Observe a real complete loop, including the synth's look-ahead scheduling.
  await page.waitForFunction(()=>audition.synth.getAudioContext().currentTime-audition.playbackStart>audition.midi.duration+.2,{},{timeout:35000});
  assert(await tick() < await page.evaluate(()=>audition.midi.ppq*4));
  const drift = await page.evaluate(()=>Math.abs(audition.synth.getPlayStatus().startTime-audition.playbackStart-audition.midi.duration));
  assert(drift<.001,`loop epoch drift ${drift}`);
  await page.locator('[data-roll="follow"]').click();
  await page.locator('canvas').hover();
  assert(await page.evaluate(()=>{const c=document.querySelector('canvas'),p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;return p.some((v,i)=>i%4===3&&v>0)}));
  await page.screenshot({path:'/tmp/beast-midi-desktop.png'});
  await page.setViewportSize({width:390,height:844}); await page.locator('#midi-panel').scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const box = await page.locator('canvas').boundingBox(); assert(box.width>250 && box.height>200);
  await page.screenshot({path:'/tmp/beast-midi-mobile.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS actual audio-clock cursor; pause/resume/stop; full view; Song/Check switching; real loop; desktop/mobile canvas; no browser errors');
} finally { await browser.close(); }
