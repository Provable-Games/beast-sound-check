#!/usr/bin/env node
// Emit a test into an isolated Beasts-dependent Cairo harness, then compare its actual
// renderer headers with both the shared browser helper and the regular/shiny art adapter.
// See README for the small harness and commands; no RPC or source checkout edits needed.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { cardHeader, previewRank, withCardHeader } from './card-header.mjs';
import * as ART from './art.mjs';

const cases = [];
for (const rank of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 19, 20, 99, 100, 999, 1000, 1242, 9999, 10000, 65535]) {
  for (const shiny of [0, 1]) for (const names of [
    { name: 'Warlock', prefix: '', suffix: '' },
    { name: 'Chupacabra', prefix: 'Apocalypse', suffix: 'Enlightenment' },
    { name: 'ABCDEFGHIJKLMNOPQRSTUVWXYZABCDE', prefix: 'ABCDEFGHIJKLMNOPQRSTUVWXYZABCDE', suffix: 'ABCDEFGHIJKLMNOPQRSTUVWXYZABCDE' },
    { name: 'Chupacabra', prefix: 'Kraken', suffix: '' },
    { name: 'Chupacabra', prefix: '', suffix: 'Glow' },
  ]) cases.push({ rank, shiny, ...names });
}
const felt = text => text ? "'" + text + "'" : '0';
if (process.argv[2] === 'cairo') {
  process.stdout.write(`use beasts_nft::beast_manager::BeastAttributes;
use beasts_nft::beast_svg::{BeastSvgTrait, CLASSIC_RAINBOW_PRESETS};
use beasts_nft::encoding::bytes_base64_encode;
fn one(id: u32, rank: u16, visual: u8, name: felt252, prefix: felt252, suffix: felt252) {
    let attrs = BeastAttributes { beast_type: 'Magic', tier: 1, level: 50, health: 200, visual_effects: visual, sound_effects: visual, transfer_damage_chance: 0, power: 250 };
    let svg = BeastSvgTrait::generate_svg(prefix, suffix, name, rank, attrs, "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==", CLASSIC_RAINBOW_PRESETS);
    println!("HEADER case={} svg={}", id, bytes_base64_encode(svg));
}
${cases.map((x, i) => `#[test]\nfn header_check_${String(i).padStart(3, '0')}() { one(${i}, ${x.rank}, ${x.shiny}, ${felt(x.name)}, ${felt(x.prefix)}, ${felt(x.suffix)}); }`).join('\n')}
`);
} else if (process.argv[2] === 'compare') {
  const seen = new Set();
  for (const line of fs.readFileSync(process.argv[3], 'utf8').split('\n').filter(l => l.startsWith('HEADER '))) {
    const [, id, b64] = /^HEADER case=(\d+) svg=(\S+)$/.exec(line) || [];
    assert.ok(cases[+id] && !seen.has(+id), 'Unexpected/duplicate Cairo header case ' + id);
    seen.add(+id);
    const x = cases[+id], svg = Buffer.from(b64, 'base64').toString('utf8');
    assert.ok(svg.includes(cardHeader(x)), 'Cairo header differs for case ' + id);
    assert.equal(withCardHeader(svg, x), svg, 'Replacement must preserve canonical header ' + id);
    const beast = { id: 1, prefix: +!!x.prefix, suffix: +!!x.suffix, rank: x.rank, shiny: x.shiny, tier: 1, level: 50, health: 200 };
    const adapted = ART.card({ beast, art: ART.speciesArt(1, !!x.shiny), tempoUs: 500000, mode: 'gif', strings: { ...x, type: 'Magic' } });
    assert.ok(adapted.includes(cardHeader(x)), 'Art adapter header differs for case ' + id);
    if (!x.prefix && !x.suffix) assert.doesNotMatch(cardHeader(x), /"/);
  }
  assert.equal(seen.size, cases.length, 'Missing Cairo header cases');
  const ranks = Array.from({ length: 75 }, (_, i) => previewRank(i + 1));
  assert.equal(new Set(ranks).size, 75);
  assert.ok(ranks.every(rank => rank >= 1 && rank <= 1242));
  console.log(`${seen.size} actual Cairo headers match the shared helper and both art templates; 75 stable unique preview ranks`);
} else throw new Error('Usage: card-header-check.mjs cairo | compare <Cairo log>');
