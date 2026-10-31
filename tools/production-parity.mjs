#!/usr/bin/env node
// Generate tests in an isolated midi_fun_contract copy; compare their actual compose_sound
// outputs with the exact adapter shipped to the sampler. See README for the refresh commands.
import fs from 'node:fs';
import path from 'node:path';
import { productionSource, sha256 } from './production-source.mjs';

import { cases } from './production-cases.mjs';
export { cases } from './production-cases.mjs';
const matrix = cases(), kinds = ['check', 'species', 'name', 'purchase', 'edition'];
const mode = process.argv[2];
if (mode === 'cairo') {
  const selected = process.env.PARITY_LIMIT ? matrix.slice(0, +process.env.PARITY_LIMIT) : matrix;
  console.log(`use beast_composer::composition::beast_v3_sound::PackableBeastV3;
use beast_composer::composition::generation::{get_generation_inputs, generate_inputs};
use beast_composer::composition::genesis::{genesis_swap, species_tier, species_type};
use beast_composer::composition::sound_check::sound_check_inputs;
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
fn one(case: u32, sid: u64, kind: u8, fx: u8, name: u16, edition: u64, seed: felt252) {
    let source = if kind == 1 { genesis_swap(sid) } else { sid };
    let identity = BeastMusicalIdentity { species_id: source.try_into().unwrap(), name_variant_id: name, tier: species_tier(source), family: species_type(source) };
    let inputs = if kind == 0 {
        let prefix = if name == 0 { 0 } else { ((name - 1) / 18 + 1).try_into().unwrap() };
        let suffix = if name == 0 { 0 } else { ((name - 1) % 18 + 1).try_into().unwrap() };
        ComposerInputs::SoundCheck(sound_check_inputs(PackableBeastV3 { id: sid, prefix, suffix, level: 50, health: 200, shiny: 0, animated: 0, tier: species_tier(sid), beast_type: species_type(sid) }))
    } else {
        let base = get_generation_inputs(EditionCompositionConfig { composition_seed: 0 }, edition, identity);
        if kind >= 3 { generate_inputs(base, edition, seed) } else { ComposerInputs::Song(base.base_song) }
    };
    let sound = compose_sound(inputs, fx);
    let mut settings = array![];
    Serde::serialize(@sound.settings, ref settings);
    println!("PT case={} shash={} hex={}", case, core::poseidon::poseidon_hash_span(settings.span()), hexof(@sound.midi));
}
${selected.map((x, i) => `#[test]\n#[ignore]\nfn production_parity_${String(i).padStart(4, '0')}() { one(${i}, ${x.sid}, ${kinds.indexOf(x.kind)}, ${x.fx}, ${x.name}, ${x.edition}, ${x.seed}); }`).join('\n')}`);
} else if (mode === 'compare') {
  const source = await productionSource();
  const lines = fs.readFileSync(process.argv[3], 'latin1').split('\n').filter(l => l.startsWith('PT '));
  const seen = new Set(), failures = [];
  for (const line of lines) {
    const c = Object.fromEntries(line.trim().split(/\s+/).slice(1).map(x => x.split('=')));
    const n = +c.case;
    if (!matrix[n] || seen.has(n)) throw new Error('Unexpected/duplicate case ' + n);
    seen.add(n);
    const r = source.composer.compose(matrix[n]), midi = Buffer.from(r.midi).toString('hex');
    if (midi !== c.hex || source.settings(r.settingsKey).hash !== c.shash) {
      let at = 0; while (at < midi.length && midi[at] === c.hex[at]) at++;
      failures.push({ case: n, ...matrix[n], midi: midi === c.hex, settings: source.settings(r.settingsKey).hash === c.shash, at: Math.floor(at / 2), js: midi.slice(Math.max(0, at - 20), at + 30), cairo: c.hex.slice(Math.max(0, at - 20), at + 30) });
    }
    if (seen.size % 200 === 0) console.log(`Compared ${seen.size}/${lines.length}`);
  }
  console.log(`${seen.size - failures.length}/${seen.size} production samples match Cairo MIDI and settings`);
  if (failures.length) console.log(JSON.stringify(failures.slice(0, 25), null, 2));
  if (failures.length || seen.size !== matrix.length) process.exitCode = 1;
  else {
    const out = process.env.PARITY_OUT || 'production/parity.json';
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({ revision: source.revision, adapterHash: source.adapterHash, casesHash: sha256(JSON.stringify(matrix)), cases: matrix.length, result: 'identical MIDI bytes and Cairo settings hashes' }, null, 2) + '\n');
  }
} else throw new Error('Usage: production-parity.mjs cairo | compare <Cairo log>');
