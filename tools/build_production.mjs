#!/usr/bin/env node
// Builds the browser composer and shared art/settings once, without RPC or a runtime service.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { productionSource, sha256 } from './production-source.mjs';
import * as ART from './art.mjs';
import { cases } from './production-cases.mjs';

const source = await productionSource();
const OMP = process.env.OMP || '/workspace/onchain-midi-player';
const { settingsText } = await import(OMP + '/scripts/segments.mjs');
const { build } = await import(source.bs + '/node_modules/esbuild/lib/main.js');
const here = path.dirname(new URL(import.meta.url).pathname), root = path.dirname(here);
const candidate = process.argv.includes('--candidate');
const outputDir = candidate ? 'candidate' : 'production';
const out = path.join(root, outputDir);
fs.mkdirSync(out, { recursive: true });
// Candidate auditions are isolated from the qualified production build and never claim parity.
const parity = candidate ? { cases: 0, result: 'Candidate audition; Cairo parity pending' } : JSON.parse(fs.readFileSync(path.join(out, 'parity.json'), 'utf8'));
if (!candidate && (parity.revision !== source.revision || parity.adapterHash !== source.adapterHash || parity.casesHash !== sha256(JSON.stringify(cases())))) throw new Error('Run production-parity.mjs against this source and adapter before building');

const settings = {};
for (let type = 0; type < 3; type++) for (const mega of [0, 1]) {
  for (const yeti of type === 2 ? [0, 1] : [0]) {
    const key = `song-${type}-${mega}-${yeti}`;
    settings[key] = settingsText(source.settings(key).value);
  }
  for (let style = 0; style < source.styles.length; style++) {
    const key = `edition-${style}-${type}-${mega}`;
    settings[key] = settingsText(source.settings(key).value);
  }
}
for (const key of source.extraSettingsKeys) settings[key] = settingsText(source.settings(key).value);
const art = {};
for (let id = 1; id <= 75; id++) for (const shiny of [0, 1]) {
  const beast = { id, prefix: 1, suffix: 1, level: 50, health: 200, rank: 0, tier: Math.floor((id - 1) % 25 / 5) + 1, beast_type: Math.floor((id - 1) / 25), shiny, animated: 1 };
  art[id + '-' + shiny] = ART.card({ beast, art: ART.speciesArt(id, !!shiny), tempoUs: 500000, mode: 'gif', strings: { name: source.TABLES.species[id - 1], type: ['Magic', 'Hunter', 'Brute'][beast.beast_type], prefix: '__PREFIX__', suffix: '__SUFFIX__' }, mediaTitle: '__TITLE__' });
}
const payload = zlib.gzipSync(JSON.stringify({ settings, art }), { level: 9 });
const dataFile = 'data-' + sha256(payload).slice(0, 16) + '.json.gz';
fs.writeFileSync(path.join(out, dataFile), payload);
const imports = [
  ['E0', source.bs + '/src/index.js'], ['L', source.bs + '/src/lab.js'],
  ['V0', source.bs + '/src/engine_v11.js'], ['F', source.bs + '/src/full_midi.js'],
  ['ED', source.bs + '/src/editions_lite.js'], ['A', here + '/production-composer.js'],
  ...(source.satoriPath ? [['S', source.satoriPath]] : []),
].map(([name, file]) => `import * as ${name} from ${JSON.stringify(file)};`).join('\n');
const bundle = await build({ stdin: { contents: `${imports}
const composer = A.createProductionComposer({ E: E0.engine, L, V: V0.createEngineV11(E0.engine), F, ED, S: ${source.satoriPath ? 'S' : 'undefined'}, species: ${JSON.stringify(source.species)} });
const table = ${JSON.stringify(source.TABLES)};
let data;
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
self.onmessage = async event => {
  const { request, input } = event.data;
  try {
    data ||= fetch(new URL(${JSON.stringify(dataFile)}, self.location.href)).then(async r => {
      if (!r.ok) throw new Error('Could not load the sample sounds (HTTP ' + r.status + ')');
      const bytes = await r.arrayBuffer();
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2,'0')).join('');
      if (hash !== ${JSON.stringify(sha256(payload))}) throw new Error('Sample sounds failed their SHA-256 check');
      return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
    }).catch(e => { data = null; throw e; });
    const shared = await data, result = composer.compose(input), x = result.input;
    const nm = L.nameFromVariant(x.name), title = table.species[x.sid - 1];
    let svg = shared.art[x.sid + '-' + (x.fx & 1)]
      .replaceAll('__PREFIX__', esc(nm.prefix ? table.prefixes[nm.prefix - 1] : ''))
      .replaceAll('__SUFFIX__', esc(nm.suffix ? table.suffixes[nm.suffix - 1] : ''))
      .replaceAll('__TITLE__', esc(title));
    // Keep the renderer's inert notes marker on the card. The page includes the notes module
    // only when the visual preset supports it, according to the Sepolia rendition manifest.
    self.postMessage({ request, input: x, midi: result.midi, settings: shared.settings[result.settingsKey], svg, info: result.info }, [result.midi.buffer]);
  } catch(e) { self.postMessage({ request, error: e.message || String(e) }); }
};`, resolveDir: root, sourcefile: 'production-worker.js' }, bundle: true, write: false, platform: 'browser', format: 'iife', target: 'es2020', minify: true, legalComments: 'eof' });
const js = bundle.outputFiles[0].contents;
const workerFile = 'composer-' + sha256(js).slice(0, 16) + '.js';
fs.writeFileSync(path.join(out, workerFile), js);
const manifest = {
  schema: 'beast-production-sampler/v1', revision: source.revision, adapterHash: source.adapterHash,
  candidate,
  features: { cyclopsCheck: source.extraSettingsKeys.includes('cyclops-check'), satori411: source.extraSettingsKeys.includes('satori-411') },
  worker: outputDir + '/' + workerFile, data: outputDir + '/' + dataFile,
  identity: (candidate ? 'candidate-' : '') + sha256(source.revision + source.adapterHash + sha256(js) + sha256(payload)).slice(0, 20),
  species: source.TABLES.species.map((name, i) => ({ id: i + 1, name })),
  prefixes: source.TABLES.prefixes, suffixes: source.TABLES.suffixes, styles: source.styles,
  parity, workerBytes: js.length, dataBytes: payload.length,
};
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
// Old content-addressed builds can be removed: the current site references this build only.
for (const file of fs.readdirSync(out)) if (/^(?:composer-[a-f0-9]+\.js|data-[a-f0-9]+\.json\.gz)$/.test(file) && ![workerFile, dataFile].includes(file)) fs.unlinkSync(path.join(out, file));
const licenses = [source.root + '/LICENSE', ...['@scure/starknet', '@noble/curves', '@noble/hashes'].map(p => source.bs + '/node_modules/' + p + '/LICENSE')];
fs.writeFileSync(path.join(out, 'NOTICE.txt'), 'Beast Sound reference engine: https://github.com/caseywescott/midi_fun_contract at ' + source.revision + '\n\n' + licenses.map((p, i) => (i ? p.split('/').slice(-3).join('/') : 'midi_fun_contract/LICENSE') + '\n' + fs.readFileSync(p, 'utf8')).join('\n\n'));
console.log(`${candidate ? 'Candidate audition' : 'Production sampler'}: ${source.revision.slice(0, 7)}, ${source.styles.length} styles; worker ${js.length} B, shared data ${payload.length} B; ${parity.cases} Cairo parity cases`);
