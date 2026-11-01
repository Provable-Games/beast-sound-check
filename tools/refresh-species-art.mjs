#!/usr/bin/env node
// Refresh only current display art. Keep the previous payload and its Cairo proofs intact.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { speciesCardArt, speciesCardArtSource } from './species-card-art.mjs';
const root = path.resolve(new URL('..', import.meta.url).pathname), dir = path.join(root, 'species-presets');
const hash = x => createHash('sha256').update(x).digest('hex');
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json')));
const previous = { ...manifest.data }, raw = fs.readFileSync(path.join(dir, previous.file));
assert.equal(hash(raw), previous.sha256);
const data = JSON.parse(gunzipSync(raw)), art = speciesCardArt(data.species);
if (JSON.stringify(art) === JSON.stringify(data.art)) throw new Error('Current art already matches');
const payload = gzipSync(JSON.stringify({ ...data, art }), { level: 9 });
const file = 'samples-' + hash(payload).slice(0, 16) + '.json.gz';
fs.writeFileSync(path.join(dir, file), payload);
manifest.data = { ...previous, file, sha256: hash(payload), bytes: payload.length };
manifest.artSource = speciesCardArtSource();
manifest.artPreservationProof = 'art-preservation-proof.json';
manifest.generatorHashes['tools/build-species-presets.mjs'] = hash(fs.readFileSync(path.join(root, 'tools/build-species-presets.mjs')));
const proof = { scope: 'Display art only; all 600 samples, settings and species are byte-for-byte unchanged after JSON serialization. Prior payload and Cairo proofs remain immutable.',
  previousData: previous, currentData: manifest.data,
  unchanged: Object.fromEntries(['samples', 'settings', 'species'].map(k => [k, hash(JSON.stringify(data[k]))])),
  generators: Object.fromEntries(['tools/art.mjs', 'tools/card-header.mjs', 'tools/card-stats.mjs', 'tools/species-card-art.mjs'].map(p => [p, hash(fs.readFileSync(path.join(root, p)))])) };
fs.writeFileSync(path.join(dir, manifest.artPreservationProof), JSON.stringify(proof, null, 2) + '\n');
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('Refreshed75 current cards; retained ' + previous.file);
