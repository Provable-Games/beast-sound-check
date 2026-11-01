#!/usr/bin/env node
// Native Cairo spot proof for five species and every raw sound preset.
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
const dir = path.resolve(new URL('../species-presets', import.meta.url).pathname);
// Keep the original Song capture bound to its unchanged300-sample segment.
const reference = fs.existsSync(path.join(dir, 'species-song-manifest.json')) ? 'species-song-manifest.json' : 'manifest.json';
const manifest = JSON.parse(fs.readFileSync(path.join(dir, reference)));
const cases = [1,39,40,44,68].flatMap(sid => [0,1,2,3].map(fx => ({sid,fx})));
if (process.argv[2] === 'cairo') {
  process.stdout.write(`use beast_composer::composition::generation::get_generation_inputs;
use beast_composer::composition::genesis::{genesis_swap, species_tier, species_type};
use beast_composer::inputs::{BeastMusicalIdentity, ComposerInputs, EditionCompositionConfig};
use crate::pure_composer::compose_sound;
fn hexof(bytes: @ByteArray) -> ByteArray {
    let mut hex: ByteArray = "";
    let mut i = 0;
    while i < bytes.len() {
        let x = bytes.at(i).unwrap();
        let (hi, lo) = DivRem::div_rem(x, 16);
        hex.append_byte(if hi < 10 { 48 + hi } else { 87 + hi });
        hex.append_byte(if lo < 10 { 48 + lo } else { 87 + lo });
        i += 1;
    }
    hex
}
#[inline(never)]
fn one(sid: u64, fx: u8) {
    let source = genesis_swap(sid);
    let base = get_generation_inputs(EditionCompositionConfig { composition_seed: 0 }, 0,
        BeastMusicalIdentity { species_id: source.try_into().unwrap(), name_variant_id: 0, tier: species_tier(source), family: species_type(source) });
    let sound = compose_sound(ComposerInputs::Song(base.base_song), fx);
    let mut settings = array![];
    Serde::serialize(@sound.settings, ref settings);
    println!("AUD sid={} fx={} shash={} hex={}", sid, fx, core::poseidon::poseidon_hash_span(settings.span()), hexof(@sound.midi));
}
${cases.map(({sid,fx}) => `#[test]\n#[ignore]\nfn audition_species_${sid}_${fx}() { one(${sid}, ${fx}); }`).join('\n')}
`);
} else if (process.argv[2] === 'compare') {
  const data = JSON.parse(gunzipSync(fs.readFileSync(path.join(dir, manifest.data.file))));
  const rows = fs.readFileSync(process.argv[3], 'utf8').split('\n').filter(l => l.startsWith('AUD '));
  const seen = new Set(), captures = [];
  for (const row of rows) {
    const r = Object.fromEntries(row.slice(4).split(/\s+/).map(x => x.split('=')));
    const key = `${r.sid}-${r.fx}`;
    if (seen.has(key) || !cases.some(c => c.sid === +r.sid && c.fx === +r.fx)) throw new Error('Unexpected capture ' + key);
    seen.add(key);
    const s = data.samples.find(s => s.sid === +r.sid && s.fx === +r.fx);
    if (Buffer.from(s.midi_b64, 'base64').toString('hex') !== r.hex || s.settingsHash !== r.shash) throw new Error('Cairo MIDI/settings mismatch ' + key);
    captures.push({ sid:s.sid, fx:s.fx, bytes:s.bytes, midiSha256:s.midiSha256, settingsHash:r.shash });
  }
  if (seen.size !== 20) throw new Error('Expected 20 captures, got ' + seen.size);
  fs.writeFileSync(path.join(dir, 'cairo-proof.json'), JSON.stringify({ sourceRevision:manifest.sourceRevision, samplesFileSha256:manifest.data.sha256, cases:20, result:'Exact MIDI bytes and canonical Cairo settings hashes match', covers:'Warlock, Harpy, Pegasus, Satori, Yeti; all four presets', captures:captures.sort((a,b)=>a.sid-b.sid||a.fx-b.fx) },null,2)+'\n');
  console.log('PASS 20/20 exact Cairo MIDI and settings comparisons');
} else throw new Error('Usage: species-preset-cairo.mjs cairo | compare <capture.log>');
