#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {musicClock} from '../species-presets/music-clock.mjs';
import {beatSeconds,frameUs,retimeGif,gifFrames,gifFrameAt} from '../species-presets/art-sync.mjs';
import {parseMidi} from '../species-presets/midi-roll.mjs';
import {decodeGif} from './deps/gif-decode.mjs';
const dir=new URL('../species-presets/',import.meta.url),manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',dir)));
const data=JSON.parse(gunzipSync(fs.readFileSync(new URL(manifest.data.file,dir))));
const hash=b=>createHash('sha256').update(b).digest('hex');
const provenance=JSON.parse(fs.readFileSync(new URL('art-sync-source.json',dir)));
for(const file of provenance.files)assert.equal(hash(fs.readFileSync(new URL('../'+file.file,import.meta.url))),file.sha256,`${file.file}: pinned source bytes`);
const gifOf=src=>Buffer.from(/data:image\/gif;base64,([A-Za-z0-9+/=]+)/.exec(Buffer.from(src.split(',')[1],'base64').toString('latin1'))[1],'base64');
const native=new Map(Object.entries(data.art).map(([sid,src])=>{const gif=gifOf(src);return[+sid,{gif,pixels:decodeGif(gif).frames.map(f=>hash(f.rgba))}]}));
let frames=0;
for(const s of data.samples){
 const midi=Buffer.from(s.midi_b64,'base64'),model=parseMidi(midi),beat=beatSeconds({passSeconds:model.duration,maxTick:model.endTick},midi);
 assert(Math.abs(beat-s.tempoUs/1e6)<1e-10,`${s.kind}/${s.sid}/${s.fx}: actual tempo`);
 const original=native.get(s.sid),out=retimeGif(original.gif,beat,model.duration);
 assert(out,`${s.kind}/${s.sid}/${s.fx}: readable GIF`);
 const pixels=decodeGif(out).frames.map(f=>hash(f.rgba));
 assert.deepEqual(pixels,pixels.map((_,i)=>original.pixels[i%original.pixels.length]),`${s.kind}/${s.sid}/${s.fx}: every retimed frame's pixels`);
 frames+=pixels.length;
}
assert.equal(frameUs(666667),333334);assert.equal(frameUs(400001),200001);assert.equal(frameUs(400000),200000);assert.equal(frameUs(399999),399999);assert.equal(frameUs(297857),297857);
// Uneven native delays retain whole-step proportions, with cumulative centisecond rounding.
const uneven=Uint8Array.from(native.get(1).gif),g=gifFrames(uneven);
[20,40,20,20].forEach((cs,i)=>{uneven[g.frames[i].start+4]=cs;uneven[g.frames[i].start+5]=0});
assert.deepEqual(gifFrames(retimeGif(uneven,.5,20)).frames.slice(0,4).map(f=>f.delay),[250,500,250,250]);
assert.equal(retimeGif(Uint8Array.of(1,2,3),.5,10),null);
assert.equal(beatSeconds({passSeconds:1,maxTick:10},Uint8Array.of(1)),null);
// An actual retimed species can resume on its current frame; each rotated pixel remains exact.
const original=native.get(64),rotated=retimeGif(original.gif,.342857,21.942848,.81);
assert(rotated.aligned);
const finite=Uint8Array.from(original.gif),loopTag=Buffer.from(finite).indexOf(Buffer.from('NETSCAPE2.0'));finite[loopTag+13]=1;
assert.equal(retimeGif(finite,.342857,21.942848,.81).aligned,false,'a finite GIF uses the production first-frame fallback');
const px=decodeGif(rotated).frames.map(f=>hash(f.rgba));assert.equal(px[0],original.pixels[gifFrameAt(gifFrames(retimeGif(original.gif,.342857,21.942848)).frames,810)]);
console.log(`PASS all 600 actual tempos and ${frames} retimed GIF frame pixels; strict 150 BPM boundary; uneven ratios; rotation; unreadable/unknown fallbacks`);

// Exercise public audible-position/pass semantics with a suspended/advancing audio clock.
const ctx={currentTime:0,state:'running',baseLatency:.01,outputLatency:.04,addEventListener(){},removeEventListener(){}};
const state={status:'playing',playbackStart:1,midi:{duration:2,endTick:960},synth:{getAudioContext:()=>ctx,getPlayStatus:()=>({maxTick:960,startTime:1+Math.max(0,Math.floor((ctx.currentTime-1+.1)/2))*2})}};
let now=0,id=0;const jobs=new Map();
const host={setTimeout(fn,ms){const n=++id;jobs.set(n,{fn,at:now+ms,interval:0});return n},clearTimeout(n){jobs.delete(n)},setInterval(fn,ms){const n=++id;jobs.set(n,{fn,at:now+ms,interval:ms});return n},clearInterval(n){jobs.delete(n)}};
function advance(ms){const end=now+ms;for(;;){const task=[...jobs].filter(([,v])=>v.at<=end+1e-7).sort((a,b)=>a[1].at-b[1].at)[0];if(!task)break;const[n,v]=task,delta=Math.max(0,v.at-now);if(ctx.state==='running')ctx.currentTime+=delta/1000;now+=delta;jobs.delete(n);if(v.interval)jobs.set(n,{...v,at:now+v.interval});v.fn()}if(ctx.state==='running')ctx.currentTime+=(end-now)/1000;now=end}
const clock=musicClock(state,host),passes=[],changes=[];clock.onPassStart(e=>passes.push(e));clock.onStateChange(s=>changes.push(s));clock.reset();clock.started();
advance(1030);assert.equal(passes.length,0);assert.equal(clock.getPlayStatus().positionSeconds,0);advance(25);assert.equal(passes.length,1);assert(passes[0].initial);assert(Math.abs(passes[0].audioTime-1.05)<.001);
advance(800);const before=clock.getPlayStatus().positionSeconds;state.status='paused';clock.changed();advance(20);ctx.state='suspended';clock.changed();const held=clock.getPlayStatus().positionSeconds;assert(held>before);ctx.outputLatency=.2;advance(500);assert.equal(clock.getPlayStatus().positionSeconds,held,'latency changes keep the heard suspended position');assert.equal(passes.length,1);
state.status='playing';ctx.state='running';clock.changed();assert(clock.getPlayStatus().positionSeconds<held,'resume adopts the updated browser latency');advance(1600);assert.equal(passes.length,2);assert.equal(passes[1].passIndex,1);assert(Math.abs(passes[1].audioTime-passes[1].audibleTime)<.001);
const run=clock.getPlayStatus().runId;state.status='stopped';clock.reset();advance(5000);assert.equal(passes.length,2);assert(clock.getPlayStatus().runId>run);assert.equal(clock.getPlayStatus().positionSeconds,null);assert(changes.some(s=>s.latencyRevision>=2));clock.dispose();assert.equal(jobs.size,0);
console.log('PASS audible initial/loop boundaries; pending asynchronous pause; held position through suspended latency change; resume; stop/run invalidation; timer cleanup');
