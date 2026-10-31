#!/usr/bin/env node
// Combine the immutable upstream Song audition with the implemented launch checks.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { productionSource, sha256 } from './launch-check-reference/production-source.mjs';
import { cases } from './launch-check-reference/production-cases.mjs';
const root = path.resolve(new URL('..', import.meta.url).pathname), out = path.join(root, 'species-presets');
const original = JSON.parse(fs.readFileSync(path.join(out, 'species-song-manifest.json')));
const originalPayload = fs.readFileSync(path.join(out, original.data.file));
if (sha256(originalPayload) !== original.data.sha256) throw new Error('Original Song segment changed');
const songs = JSON.parse(gunzipSync(originalPayload));
if (songs.samples.length !== 300 || songs.species.length !== 75) throw new Error('Incomplete original Songs');
const previousBeast = process.env.BEAST;
process.env.BEAST = process.env.CHECK_BEAST || '/tmp/midi-fun-sound-check-staging';
const source = await productionSource();
if (previousBeast === undefined) delete process.env.BEAST; else process.env.BEAST = previousBeast;
if (!process.env.CHECK_REVISION || source.revision !== process.env.CHECK_REVISION) throw new Error('CHECK_REVISION must pin the exact reviewed Sound Check source');
const omp = process.env.OMP || '/workspace/onchain-midi-player';
const { settingsText } = await import(omp + '/scripts/segments.mjs');
const { checkMidi } = await import(omp + '/player/player.js');
const { summarize } = await import(omp + '/scripts/check_midi.mjs');
const { decodeSettings } = await import(omp + '/player/settings.js');
const sample = (r, sid, fx) => {
  const midi = Buffer.from(r.midi), timing = checkMidi(midi), summary = summarize(midi);
  if (!summary.tracks.some(t => t.notes > 0)) throw new Error('Empty check ' + sid + '/' + fx);
  const s = source.settings(r.settingsKey), text = settingsText(s.value), key = 'check/' + r.settingsKey;
  if (settings[key] && settings[key] !== text) throw new Error('Settings collision');
  settings[key] = text; decodeSettings(text);
  const at = midi.indexOf(Buffer.from([255,81,3]));
  if (at < 0) throw new Error('Missing tempo');
  return { kind:'check', sid, fx, name:songs.species[sid-1].name, nameVariant:0, sourceSpecies:sid,
    midi_b64:midi.toString('base64'), bytes:midi.length, midiSha256:sha256(midi),
    settingsKey:key, sourceSettingsKey:r.settingsKey, settingsHash:s.hash, settingsSha256:sha256(text),
    tempoUs:midi.readUIntBE(at+3,3), seconds:timing.seconds, tracks:summary.tracks.length,
    notes:summary.tracks.reduce((n,t)=>n+t.notes,0), key:r.info.key,
    programs:[...summary.channels.entries()].map(([channel,c])=>({channel,programs:c.programs})),
    fixedReference:sid===64 ? [
      'Original lab 504 · All eight sounds · Exact 175 BPM reference',
      'Original lab 504 · All eight sounds · Faster performance, original timbres',
      'Original lab 504 · All eight sounds · Shorter note gates',
      'Original lab 504 · All eight sounds · Faster performance + downbeat accents'
    ][fx] : null };
};
const settings = {...songs.settings}, checks=[];
for(let sid=1;sid<=75;sid++)for(let fx=0;fx<4;fx++)checks.push(sample(source.composer.compose({sid,kind:'check',fx,name:0}),sid,fx));
const samples=[...songs.samples.map(s=>({...s,kind:'song'})),...checks];
if(samples.length!==600||new Set(samples.map(s=>`${s.kind}-${s.sid}-${s.fx}`)).size!==600)throw new Error('Expected600 unique mode/species/preset selections');
for(const s of samples){checkMidi(Buffer.from(s.midi_b64,'base64'));decodeSettings(settings[s.settingsKey]);}
const cyclops=JSON.parse(fs.readFileSync(path.join(source.bs,'test/fixtures/cyclops-504.json')));
for(const s of checks.filter(s=>s.sid===64 && s.fx===0)){
  if(Buffer.from(s.midi_b64,'base64').toString('hex')!==cyclops.midi_hex||s.bytes!==735||s.tempoUs!==342857)throw new Error('Cyclops504 sequence changed');
  assert.deepEqual(source.settings(s.sourceSettingsKey).value,cyclops.settings,'Cyclops504 settings changed');
}
assert.equal(new Set(checks.filter(s=>s.sid===64).map(s=>s.midiSha256)).size,4,'Cyclops must have four distinct performances');
for(const s of checks.filter(s=>s.sid===64))assert.deepEqual(s.programs,[{channel:0,programs:[34,35,36,37,38,39,40,41]}],'Cyclops must retain all eight sounds');
const oldProof=JSON.parse(fs.readFileSync(path.join(out,'cairo-proof.json')));
if(oldProof.samplesFileSha256!==original.data.sha256||oldProof.sourceRevision!==original.sourceRevision)throw new Error('Original Song proof binding changed');
for(const c of oldProof.captures){const s=songs.samples.find(s=>s.sid===c.sid&&s.fx===c.fx);if(s.midiSha256!==c.midiSha256||s.settingsHash!==c.settingsHash)throw new Error('Original Song capture mismatch');}
const proofPath=process.env.CHECK_PROOF||'/tmp/beast-sound-check-parity.json';
const fullProof=JSON.parse(fs.readFileSync(proofPath));
const matrix=cases().filter(x=>x.kind==='check'&&x.name===0);
if(fullProof.matrix!=='shared-sound-checks-v1'||fullProof.revision!==source.revision||fullProof.adapterHash!==source.adapterHash||fullProof.cases!==matrix.length||fullProof.casesHash!==sha256(JSON.stringify(matrix)))throw new Error('Check source/adapter/matrix proof mismatch');
const capturePath=process.env.CHECK_CAIRO_LOG;
if(!capturePath)throw new Error('CHECK_CAIRO_LOG must identify the matching actual Cairo capture');
const lines=fs.readFileSync(capturePath,'latin1').split('\n').filter(l=>l.startsWith('PT ')), seen=new Set(), captures=[];
for(const line of lines){
  const c=Object.fromEntries(line.trim().split(/\s+/).slice(1).map(x=>x.split('='))), index=+c.case;
  if(!matrix[index]||seen.has(index))throw new Error('Unexpected/duplicate Cairo case'); seen.add(index);
  const x=matrix[index];if(x.kind!=='check'||x.name!==0)continue;
  const s=checks.find(s=>s.sid===x.sid&&s.fx===x.fx);
  if(Buffer.from(s.midi_b64,'base64').toString('hex')!==c.hex||s.settingsHash!==c.shash)throw new Error(`Check Cairo mismatch ${s.sid}/${s.fx}`);
  captures.push({sid:s.sid,fx:s.fx,bytes:s.bytes,midiSha256:s.midiSha256,settingsHash:s.settingsHash});
}
if(seen.size!==fullProof.cases||captures.length!==300||new Set(captures.map(s=>s.sid+'-'+s.fx)).size!==300)throw new Error('Incomplete check Cairo proof');
const data={species:songs.species,samples,settings,art:songs.art};
const payload=gzipSync(JSON.stringify(data),{level:9}),file='samples-'+sha256(payload).slice(0,16)+'.json.gz';fs.writeFileSync(path.join(out,file),payload);
const manifest={schema:'beast-song-check-audition/v2',
  modes:{song:{label:'Species Song',sourceRepository:original.sourceRepository,sourceRevision:original.sourceRevision,samples:300,referenceManifest:'species-song-manifest.json',referenceData:original.data,cairoProof:'cairo-proof.json',scope:original.scope},
    check:{label:'Sound Check',sourceRepository:'https://github.com/loothero/midi_fun_contract',sourceRevision:source.revision,samples:300,adapterHash:source.adapterHash,cairoProof:'check-cairo-proof.json',scope:'75 implemented Sound Check candidates, four raw token sound presets each. Cyclops64 is the whole original504 sequence and is included in the75; musical approval pending. No chip echo.'}},
  data:{file,sha256:sha256(payload),bytes:payload.length,samples:600,species:75,presets:[0,1,2,3]},
  player:original.player,artSource:original.artSource,displayNamesSource:original.displayNamesSource,
  generatorHashes:Object.fromEntries(['tools/build-species-presets.mjs','tools/sound-check-parity.mjs','tools/launch-check-reference/production-composer.js','tools/launch-check-reference/production-source.mjs','tools/launch-check-reference/production-cases.mjs'].map(p=>[p,sha256(fs.readFileSync(path.join(root,p)))])),
  sampleHashes:samples.map(({kind,sid,fx,midiSha256,settingsHash,settingsSha256,bytes,tempoUs,notes,settingsKey})=>({kind,sid,fx,midiSha256,settingsHash,settingsSha256,bytes,tempoUs,notes,settingsKey}))};
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
fs.writeFileSync(path.join(out,'check-cairo-proof.json'),JSON.stringify({sourceRevision:source.revision,adapterHash:source.adapterHash,samplesFileSha256:manifest.data.sha256,kind:'check',cases:300,fullMatrix:fullProof,captureLogSha256:sha256(fs.readFileSync(capturePath)),result:'300/300 Sound Check MIDI bytes and canonical Cairo settings hashes match actual captures',captures},null,2)+'\n');
const notice=fs.readFileSync(path.join(out,'NOTICE.txt'),'utf8');
if(!notice.includes(source.revision))fs.appendFileSync(path.join(out,'NOTICE.txt'),'\nImplemented Sound Check candidate source: https://github.com/loothero/midi_fun_contract at '+source.revision+'\n'+fs.readFileSync(path.join(source.root,'LICENSE'),'utf8'));
for(const old of fs.readdirSync(out))if(/^samples-[a-f0-9]+\.json\.gz$/.test(old)&&![original.data.file,file].includes(old))fs.unlinkSync(path.join(out,old));
console.log(`Built 600 samples: 300 unchanged Species Songs + 300 Cairo-verified Sound Checks; 75 species per mode, Cyclops included at 64. Gzip ${payload.length} B`);
