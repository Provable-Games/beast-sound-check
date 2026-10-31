import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductionComposer } from './production-composer.js';

const vlq = n => { const b = [n & 127]; while ((n = Math.floor(n / 128))) b.unshift((n & 127) | 128); return b; };
const track = body => [77,84,114,107,0,0,0,body.length,...body];
function fixture(duration = 40, tempo = 666667) {
  return Uint8Array.from([77,84,104,100,0,0,0,6,0,1,0,2,1,224,
    ...track([0,255,81,3,tempo >> 16,(tempo >> 8) & 255,tempo & 255,0,255,47,0]),
    ...track([0,192,7,0,144,60,100,...vlq(duration),128,60,0,...vlq(480-duration),255,47,0])]);
}
function events(midi) {
  const out = []; let at = 14;
  while (at < midi.length) {
    const len = (midi[at+4]*0x1000000)+(midi[at+5]<<16)+(midi[at+6]<<8)+midi[at+7]; at += 8;
    const end = at + len; let tick = 0, status = 0;
    const read = () => { let n=0,b; do {b=midi[at++];n=n*128+(b&127);}while(b&128);return n; };
    while (at < end) {
      tick += read(); if (midi[at]>=128)status=midi[at++];
      if(status===255){const meta=midi[at++],n=read(),data=Array.from(midi.slice(at,at+n));at+=n;out.push({tick,meta,data});}
      else{const n=(status&240)===192||(status&240)===208?1:2;out.push({tick,status,data:Array.from(midi.slice(at,at+n))});at+=n;}
    }
  }
  return out;
}
function composer(result) {
  const L = { nameFromVariant: n => ({prefix:n?1:0,suffix:n?1:0}),speciesTier:()=>1,speciesType:()=>0,soundCheckMidi:()=>result };
  return createProductionComposer({ E:{}, L, V:{}, F:{}, ED:{}, species:[] });
}
const input = {sid:1,kind:'check',fx:0,name:0};
test('check adapter performs the source tempo and does not lengthen 40-tick blips',()=>{
  const c=composer({midi:fixture(),info:{curated:true}});
  const r=c.compose({...input,fx:2}),e=events(r.midi);
  assert.equal(e.find(x=>x.meta===81).data.reduce((n,b)=>n*256+b,0),636667);
  assert.equal(e.find(x=>x.status===128).tick,40);
  assert.equal(e.find(x=>x.meta===47 && x.tick===480).tick,480);
});
test('normal portato still shortens longer notes and keeps initial normalization',()=>{
  const c=composer({midi:fixture(420),info:{}}),r=c.compose({...input,fx:2});
  assert.equal(events(r.midi).find(x=>x.status===128).tick,315);
  assert.deepEqual(r.input,{sid:1,kind:'check',fx:2,name:0,edition:0,seed:'0'});
});
test('authored Cyclops keeps all reference bytes across effects and names',()=>{
  const original=fixture(40,342857),c=composer({midi:original,info:{authored:true}});
  for(const fx of [0,1,2,3])for(const name of [0,1,1242]){
    const r=c.compose({...input,sid:64,fx,name});
    assert.deepEqual(r.midi,original);assert.equal(r.settingsKey,'cyclops-check');
  }
});
test('authored-looking metadata cannot disable other species performance',()=>{
  const c=composer({midi:fixture(),info:{authored:true}}),r=c.compose({...input,fx:1});
  assert.equal(events(r.midi).find(x=>x.meta===81).data.reduce((n,b)=>n*256+b,0),641667);
  assert.equal(r.settingsKey,'song-0-1-0');
});

test('Satori species and Agony Bane route through the upstream authored helper',()=>{
  const calls=[],original=fixture(40,500000),L={nameFromVariant:()=>({}),speciesTier:()=>4,speciesType:()=>1,keyName:()=> 'A Aeolian',GENESIS_SWAPS:{}};
  const S={satori411SongInputs:name=>({score:{},name}),satori411PurchasedInputs:(recipe,seed)=>({...recipe,seed}),satori411PerformanceMidi:(name,fx,seed)=>{calls.push({name,fx,seed});return original;}};
  const c=createProductionComposer({E:{},L,V:{},F:{},ED:{},S,species:[]});
  for(const kind of ['species','name','purchase']){
    const r=c.compose({sid:44,kind,name:1,fx:3,seed:'0'});
    assert.deepEqual(r.midi,original);assert.equal(r.settingsKey,'satori-411');
    assert.deepEqual(calls.at(-1),{name:kind==='species'?0:1,fx:3,seed:kind==='purchase'?0n:null});
  }
});
