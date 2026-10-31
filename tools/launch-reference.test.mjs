import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { productionSource } from './production-source.mjs';

const source = process.env.BEAST ? await productionSource() : null;
const options = { skip: source ? false : 'Set BEAST to a clean integrated launch-music checkout' };
test('sampler Cyclops route preserves original504 bytes/settings across names and effects', options, () => {
  const original = JSON.parse(fs.readFileSync(path.join(source.bs, 'test/fixtures/cyclops-504.json')));
  for (const name of [0, 1, 1242]) for (const fx of [0, 1, 2, 3]) {
    const result = source.composer.compose({ sid: 64, kind: 'check', name, fx });
    assert.equal(Buffer.from(result.midi).toString('hex'), original.midi_hex);
    assert.deepEqual(source.settings(result.settingsKey).value, original.settings);
  }
});
test('sampler Satori Species Song and Agony Bane preserve exact411 bytes and original balance', options, () => {
  const refs = path.join(source.root, 'docs/sound-check-scale-plan/satori-411');
  const midi = fs.readFileSync(path.join(refs, 'track-411.mid'));
  const settings = JSON.parse(fs.readFileSync(path.join(refs, 'track-411.settings.json')));
  for (const kind of ['species', 'name']) {
    const result = source.composer.compose({ sid: 44, kind, name: 1, fx: 0 });
    assert.deepEqual(Buffer.from(result.midi), midi);
    assert.deepEqual(source.settings(result.settingsKey).value, settings);
  }
});
test('sampler leaves other named Satori and edition tracks on their existing paths', options, () => {
  const named = source.composer.compose({ sid: 44, kind: 'name', name: 2, fx: 0 });
  assert.equal(named.settingsKey, 'song-1-0-0');
  const edition = source.composer.compose({ sid: 44, kind: 'edition', name: 1, fx: 0, edition: 1, seed: '0' });
  assert.match(edition.settingsKey, /^edition-/);
});

test('sampler labels use the curated catalogue canonical names', options, () => {
  assert.equal(source.TABLES.species[52], 'Asag');
  assert.equal(source.TABLES.species[69], 'Metsavana');
});
