#!/usr/bin/env node
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { card } from './art.mjs';
import { largePanel, withCardStats } from './card-stats.mjs';
const values = [0,1,2,3,4,5,6,7,8,9,10,11,19,20,99,100,101,111,200,250,999,1000,9999,10000,65535];
if (process.argv[2] === 'cairo') {
  console.log(`use beasts_nft::beast_manager::BeastAttributes;
use beasts_nft::beast_svg::{BeastSvgTrait, CLASSIC_RAINBOW_PRESETS};
use beasts_nft::encoding::bytes_base64_encode;
fn one(id: u32, value: u16, visual: u8) {
let attrs = BeastAttributes { beast_type: 'Magic', tier: 1, level: 50, health: value, visual_effects: visual, sound_effects: visual, transfer_damage_chance: 0, power: value };
let svg = BeastSvgTrait::generate_svg(0, 0, 'Warlock', 0, attrs, "RASTER", CLASSIC_RAINBOW_PRESETS);
println!("STATS case={} svg={}", id, bytes_base64_encode(svg));
}
${values.flatMap((v,i)=>[0,1].map(s=>`#[test]\nfn stats_${i}_${s}(){one(${i*2+s},${v},${s});}`)).join('\n')}`);
} else {
  const seen = new Set();
  for (const line of fs.readFileSync(process.argv[3], 'utf8').split('\n').filter(l=>l.startsWith('STATS '))) {
    const [,id,b64] = /^STATS case=(\d+) svg=(\S+)$/.exec(line), value = values[Math.floor(+id/2)];
    assert.ok(value !== undefined && !seen.has(+id)); seen.add(+id);
    const svg = Buffer.from(b64, 'base64').toString();
    for (const health of [false,true]) assert.ok(svg.includes(largePanel(value,health)), `Cairo mismatch ${id}`);
    assert.equal(withCardStats(svg,{power:value,health:value}),svg);
    const adapted = withCardStats(card({ beast: { shiny: +id % 2, tier: 1, level: 50, health: value, rank: 0 },
      art: { animated: true, gifUri: 'RASTER' }, tempoUs: 500000, mode: 'gif',
      strings: { name: 'Warlock', type: 'Magic' }, mediaTitle: 'Warlock' }), { power: value, health: value });
    // Only normalize fixture formatting, the equivalent anchor quote and injected art.
    // Compare every remaining SVG byte: fonts, chrome, labels, stats, icons and animations.
    const normalize = s => s.replace(/\r?\n\s*/g, '').replace('data-play-anchor="235 54 24 top-right"', "data-play-anchor='235 54 24 top-right'").replace(/<foreignObject[\s\S]*?<\/foreignObject>/, 'RASTER');
    assert.equal(normalize(adapted), normalize(svg), 'Full card chrome mismatch ' + id);
  }
  assert.equal(seen.size, values.length*2);
  console.log(`Exact Cairo panel and full card chrome parity: ${seen.size} regular/shiny cards, ${seen.size*2} panels.`);
}
