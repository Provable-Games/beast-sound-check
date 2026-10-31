import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createProductionComposer } from './production-composer.js';

export const sha256 = x => crypto.createHash('sha256').update(x).digest('hex');
export async function productionSource() {
  const root = process.env.BEAST || '/workspace/midi_fun_contract';
  const bs = path.join(root, 'offchain/beast-sound');
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  const paths = ['beasts/beast_composer', 'beasts/beast_contracts', 'offchain/beast-sound/src', 'offchain/beast-sound/onchain/tinychip', 'Scarb.toml', 'Scarb.lock'];
  if (git('status', '--porcelain', '--', ...paths)) throw new Error('Production composer checkout has local changes');
  const idx = await import(bs + '/src/index.js'), L = await import(bs + '/src/lab.js');
  const V = (await import(bs + '/src/engine_v11.js')).createEngineV11(idx.engine);
  const F = await import(bs + '/src/full_midi.js'), ED = await import(bs + '/src/editions_lite.js');
  const SS = await import(bs + '/onchain/tinychip/synth_settings.mjs');
  const satoriPath = path.join(bs, 'src/satori411.js');
  const S = fs.existsSync(satoriPath) ? await import(satoriPath) : undefined;
  // Read the actual generated Cairo table: six signed degree nibbles and tonic per species.
  const cairo = fs.readFileSync(root + '/beasts/beast_composer/src/composition/editions_data.cairo', 'utf8');
  const packed = cairo.match(/pub const SPECIES:[^=]+?=\s*\[([\s\S]*?)\];/)[1].match(/0x[0-9a-f]+/gi).map(BigInt);
  if (packed.length !== 75) throw new Error('Expected 75 production edition species');
  const species = packed.map((v, i) => ({ id: i + 1, tier: L.speciesTier(i + 1), type: L.speciesType(i + 1), tonicPc: Number(v & 15n), degrees: Array.from({ length: 6 }, (_, k) => Number((v >> BigInt(4 + k * 4)) & 15n) - 8) }));
  const composer = createProductionComposer({ E: idx.engine, L, V, F, ED, S, species });
  const settingsCache = new Map();
  let editionData;
  function settings(key) {
    if (!settingsCache.has(key)) {
      const a = key.split('-'); let s;
      if (key === 'cyclops-check') {
        if (!SS.cyclopsSoundCheckSynthSettings) throw new Error('Composer does not provide Cyclops reference settings');
        s = SS.cyclopsSoundCheckSynthSettings();
      } else if (key === 'satori-411') {
        if (!SS.satori411SynthSettings) throw new Error('Composer does not provide Satori reference settings');
        s = SS.satori411SynthSettings();
      } else if (a[0] === 'edition') s = SS.editionSynthSettings(+a[1], +a[2], !!+a[3], editionData ||= SS.editionData());
      else s = SS.beastSynthSettings(undefined, SS.variantPrograms({ type: +a[1], mega: !!+a[2], yeti: !!+a[3] }));
      let hash;
      settingsCache.set(key, { value: s, get hash() { return hash ||= idx.poseidonHashMany(SS.serializeSettings(s)).toString(); } });
    }
    return settingsCache.get(key);
  }
  const extraSettingsKeys = [
    ...(SS.cyclopsSoundCheckSynthSettings ? ['cyclops-check'] : []),
    ...(S && SS.satori411SynthSettings ? ['satori-411'] : []),
  ];
  return { root, bs, extraSettingsKeys, satoriPath: S ? satoriPath : null, revision: git('rev-parse', 'HEAD'), adapterHash: sha256(fs.readFileSync(new URL('./production-composer.js', import.meta.url))), composer, settings, species, TABLES: idx.TABLES, styles: ED.STYLES.map((s, i) => ({ index: i, key: s.key, label: s.label, description: s.desc })) };
}
