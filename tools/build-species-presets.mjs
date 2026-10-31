#!/usr/bin/env node
// Precompute raw composer performances, independent of the manager's shared-Song policy.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { gzipSync, gunzipSync } from 'node:zlib';
import { productionSource, sha256 } from './production-source.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const out = path.join(root, 'species-presets');
const source = await productionSource();
const omp = process.env.OMP || '/workspace/onchain-midi-player';
const { settingsText } = await import(omp + '/scripts/segments.mjs');
const { checkMidi } = await import(omp + '/player/player.js');
const { summarize } = await import(omp + '/scripts/check_midi.mjs');
const { decodeSettings } = await import(omp + '/player/settings.js');
const { engineSource, engineNotice, ENGINE_PIN } = await import(omp + '/scripts/engine.mjs');
const baselineManifest = JSON.parse(fs.readFileSync(path.join(root, 'production/manifest.json'), 'utf8'));
const baselineBytes = fs.readFileSync(path.join(root, baselineManifest.data));
const baselineArt = JSON.parse(gunzipSync(baselineBytes)).art;
const namesPath = (process.env.BEASTS3 || '/workspace/beasts-v3') + '/sdk/src/tables.ts';
const namesText = fs.readFileSync(namesPath, 'utf8');
const displayNames = [...namesText.match(/ORIGINAL_SPECIES_NAMES[^=]*= \[([\s\S]*?)\] as const;/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
if (displayNames.length !== 75) throw new Error('Expected canonical display names');
const samples = [], settings = {}, art = {};
for (let sid = 1; sid <= 75; sid++) {
  const svg = baselineArt[sid + '-0'].replaceAll('__PREFIX__', '').replaceAll('__SUFFIX__', '').replaceAll('__TITLE__', displayNames[sid - 1]).replaceAll(source.TABLES.species[sid - 1], displayNames[sid - 1]);
  art[sid] = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  for (let fx = 0; fx < 4; fx++) {
    const r = source.composer.compose({ sid, kind: 'species', fx, name: 0, seed: '0' });
    const midi = Buffer.from(r.midi), timing = checkMidi(midi), summary = summarize(midi);
    if (!summary.tracks.some(t => t.notes > 0)) throw new Error('Empty score ' + sid + '/' + fx);
    const s = source.settings(r.settingsKey);
    settings[r.settingsKey] ??= settingsText(s.value);
    decodeSettings(settings[r.settingsKey]);
    const tempoAt = midi.indexOf(Buffer.from([255, 81, 3]));
    if (tempoAt < 0) throw new Error('Missing tempo ' + sid + '/' + fx);
    const tempoUs = midi.readUIntBE(tempoAt + 3, 3);
    samples.push({ sid, fx, name: displayNames[sid - 1], upstreamName: source.TABLES.species[sid - 1], nameVariant: 0,
      sourceSpecies: sid === 39 ? 40 : sid === 40 ? 39 : sid,
      midi_b64: midi.toString('base64'), bytes: midi.length, midiSha256: sha256(midi),
      settingsKey: r.settingsKey, settingsHash: s.hash, settingsSha256: sha256(settings[r.settingsKey]),
      tempoUs, seconds: timing.seconds, tracks: summary.tracks.length,
      notes: summary.tracks.reduce((n, t) => n + t.notes, 0), key: r.info.key,
      programs: [...summary.channels.entries()].map(([channel, c]) => ({ channel, programs: c.programs })) });
  }
}
if (samples.length !== 300 || new Set(samples.map(s => s.sid + '-' + s.fx)).size !== 300) throw new Error('Incomplete matrix');
for (let sid = 1; sid <= 75; sid++) {
  const four = samples.filter(s => s.sid === sid);
  if (new Set(four.map(s => s.midiSha256)).size !== 4) throw new Error('Neutralized presets at ' + sid);
  if (!(four[1].tempoUs < four[0].tempoUs && four[2].tempoUs < four[0].tempoUs && four[3].tempoUs < four[0].tempoUs)) throw new Error('Missing performance tempos');
  if (!(four[2].notes > four[0].notes && four[3].notes > four[1].notes)) throw new Error('Missing echo notes');
  if (!(four[1].settingsKey.includes('-1-') && four[3].settingsKey.includes('-1-'))) throw new Error('Missing mega settings');
}
const player = engineSource();
const settingsInstaller = fs.readFileSync(omp + '/player/settings.js');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'synth.js'), player);
fs.writeFileSync(path.join(out, 'settings.js'), settingsInstaller);
const data = { species: displayNames.map((name, i) => ({ id: i + 1, name, aliases: name === source.TABLES.species[i] ? [] : [source.TABLES.species[i]] })), samples, settings, art };
const payload = gzipSync(JSON.stringify(data), { level: 9 });
const dataFile = 'samples-' + sha256(payload).slice(0, 16) + '.json.gz';
fs.writeFileSync(path.join(out, dataFile), payload);
const sourcePaths = ['tools/production-composer.js', 'tools/production-source.mjs', 'tools/build-species-presets.mjs'];
const manifest = {
  schema: 'beast-species-preset-audition/v1', sourceRepository: 'https://github.com/caseywescott/midi_fun_contract', sourceRevision: source.revision,
  samplerRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  adapterHash: source.adapterHash, generatorHashes: Object.fromEntries(sourcePaths.map(p => [p, sha256(fs.readFileSync(path.join(root, p)))])),
  upstreamSourceHashes: Object.fromEntries(['src/lab.js','src/engine_v11.js','src/full_midi.js','onchain/tinychip/synth_settings.mjs'].map(p => [p, sha256(fs.readFileSync(path.join(source.bs, p)))])),
  player: { file: 'synth.js', sha256: sha256(player), synthVersion: '2.1.2', enginePin: ENGINE_PIN, settingsFile: 'settings.js', settingsSha256: sha256(settingsInstaller), source: 'Exact verified pocket-synth engine and canonical onchain-midi-player settings installer; one persistent context' },
  displayNamesSource: { file: 'beasts-v3/sdk/src/tables.ts', sha256: sha256(namesText) },
  artSource: { data: baselineManifest.data, sha256: sha256(baselineBytes), preset: 0 },
  data: { file: dataFile, sha256: sha256(payload), bytes: payload.length, samples: 300, species: 75, presets: [0,1,2,3] },
  scope: 'As-written canonical shared Species Song inputs, name 0, official 39/40 swap once; raw sound presets 0–3 directly through composer. Regular artwork fixed across presets. Technical default 0 does not establish artistic preference.',
  proof: { generatedMatrix: '300 complete SMFs validated with player parser; four distinct byte hashes and performance tempos for each species; echo note increases and mega settings verified', priorAdapter: JSON.parse(fs.readFileSync(path.join(root, 'production/parity.json'), 'utf8')) },
  sampleHashes: samples.map(({sid,fx,midiSha256,settingsHash,settingsSha256,bytes,tempoUs,notes,settingsKey})=>({sid,fx,midiSha256,settingsHash,settingsSha256,bytes,tempoUs,notes,settingsKey}))
};
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
fs.writeFileSync(path.join(out, 'NOTICE.txt'), fs.readFileSync(path.join(root, 'production/NOTICE.txt'), 'utf8') + '\n' + engineNotice() + '\nAudition music source: ' + source.revision + '\nPlayer: Apache-2.0, webaudio-tinysynth by Tatsuya Shinyagaito, Provable Games pocket-synth v2.1.2 and onchain-midi-player v0.12.0. See synth.js license header.\n');
for (const file of fs.readdirSync(out)) if (/^samples-.*\.json\.gz$/.test(file) && file !== dataFile) fs.unlinkSync(path.join(out, file));
console.log(JSON.stringify({ source: source.revision, samples: samples.length, gzipBytes: payload.length, satori: samples.filter(s=>s.sid===44).map(({fx,bytes,key,tempoUs,notes})=>({fx,bytes,key,tempoUs,notes})) }, null, 2));
