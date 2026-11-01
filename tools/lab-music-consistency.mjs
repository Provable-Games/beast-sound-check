#!/usr/bin/env node
// Compare the actual shipped homepage worker and embedded songs with the listening
// page's approved bytes. No composer checkout or second JS implementation is used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const hash = value => createHash('sha256').update(value).digest('hex');
const manifest = read('species-presets/manifest.json');
const packed = fs.readFileSync(path.join(root, 'species-presets', manifest.data.file));
assert.equal(hash(packed), manifest.data.sha256);
const data = JSON.parse(gunzipSync(packed));
const built = JSON.parse(fs.readFileSync(path.join(root, 'index.html'), 'utf8').match(/<script[^>]+id="data"[^>]*>([\s\S]*?)<\/script>/)[1]);
assert.equal(data.samples.length, 600);
assert.equal(new Set(data.samples.map(s => `${s.kind}-${s.sid}-${s.fx}`)).size, 600);
const sample = (sid, fx, kind = 'song') => data.samples.find(s => s.sid === sid && s.fx === fx && s.kind === kind);
const midi = s => Buffer.from(s.midi_b64, 'base64');
for (const s of data.samples) {
  assert.equal(hash(midi(s)), s.midiSha256);
  assert.equal(hash(data.settings[s.settingsKey]), s.settingsSha256);
}
for (let sid = 1; sid <= 75; sid++) {
  const t = built.tracks.find(t => String(t.id) === String(600 + sid));
  assert(t, `Missing embedded Species Song ${sid}`);
  const extract = id => t.d.match(new RegExp(`<script[^>]+id="${id}"[^>]*>([\\s\\S]*?)<\\/script>`))[1];
  assert.equal(hash(Buffer.from(extract('onchain-midi-data'), 'base64')), sample(sid, 0).midiSha256, `Embedded Species MIDI ${sid}`);
  assert.equal(hash(extract('onchain-midi-settings')), sample(sid, 0).settingsSha256, `Embedded Species settings ${sid}`);
}
console.log('PASS all 75 embedded Species Songs match the listening page MIDI/settings');

// Serve under the actual GitHub Pages project prefix to exercise relative assets.
const prefix = '/beast-sound-check/';
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://local').pathname;
  if (!pathname.startsWith(prefix)) { res.writeHead(404).end(); return; }
  const file = path.resolve(root, pathname.slice(prefix.length).replace(/\/$/, '/index.html') || 'index.html');
  if (!file.startsWith(root + '/') || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.gz': 'application/gzip' };
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE || '/workspace/beasts-v3/node_modules/playwright');
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [], external = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (/^https?:/.test(r.url()) && !r.url().startsWith(origin + '/')) external.push(r.url()); });
  await page.goto(origin + prefix + '#sample-44-species-0-0-0-0');
  const ready = () => page.waitForFunction(() => document.querySelector('#pw iframe') && !document.getElementById('bp').disabled, null, { timeout: 60000 });
  await ready();
  async function displayed() {
    const iframe = page.frames().find(f => f !== page.mainFrame());
    await iframe.waitForSelector('#onchain-midi-data', { state: 'attached' });
    return { midi: await iframe.locator('#onchain-midi-data').textContent(), settings: await iframe.locator('#onchain-midi-settings').textContent() };
  }
  let shown = await displayed();
  assert.equal(hash(Buffer.from(shown.midi, 'base64')), sample(44, 0).midiSha256);
  assert.equal(hash(shown.settings), sample(44, 0).settingsSha256);
  assert.equal(hash(Buffer.from(shown.midi, 'base64')), '4b2a582e3c83736b7beaaac19fa44421735006a618c525409d88beb2f2b28aaf');
  console.log('PASS the reported #sample-44-species-0-0-0-0 URL plays exact original #411');

  const nameProofPath = process.env.NAME_PROOF || path.join(root, 'species-presets/names/parity.json');
  const names = fs.existsSync(nameProofPath) ? JSON.parse(fs.readFileSync(nameProofPath, 'utf8')) : null;
  if (names) assert.equal(names.revision, built.production.revision);
  const matrix = data.samples.map(s => ({ sid: s.sid, fx: s.fx, kind: s.kind === 'song' ? 'species' : 'check', name: 0, edition: 0, seed: '0' }));
  if (names) matrix.push(...names.captures.map(s => ({ sid: s.sid, fx: s.fx, kind: 'name', name: s.name, edition: 0, seed: '0' })));
  const observed = await page.evaluate(async ({ matrix, workerURL }) => {
    const worker = new Worker(new URL(workerURL, location.href)), out = [];
    const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', value)), b => b.toString(16).padStart(2, '0')).join('');
    try {
      for (let i = 0; i < matrix.length; i++) {
        const result = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Worker timeout at ' + i)), 30000);
          worker.onmessage = ({ data }) => { clearTimeout(timer); data.error ? reject(new Error(data.error)) : resolve(data); };
          worker.onerror = e => { clearTimeout(timer); reject(new Error(e.message)); };
          worker.postMessage({ request: i, input: matrix[i] });
        });
        if (typeof result.settings !== 'string') throw new Error('Missing settings at ' + i);
        out.push({ midi: await digest(result.midi), settings: await digest(new TextEncoder().encode(result.settings)) });
      }
    } finally { worker.terminate(); }
    return out;
  }, { matrix, workerURL: built.production.worker });
  const expected = [...data.samples, ...(names?.captures || [])];
  for (let i = 0; i < expected.length; i++) {
    const label = JSON.stringify(matrix[i]);
    assert.equal(observed[i].midi, expected[i].midiSha256, 'Homepage MIDI ' + label);
    assert.equal(observed[i].settings, expected[i].settingsSha256, 'Homepage settings ' + label);
  }
  console.log('PASS all 300 Species Songs and 300 Sound Checks match across both pages');
  if (names) console.log(`PASS ${names.captures.length} homepage Name Songs match the listening-page Cairo captures`);
  await page.goto(origin + prefix + '#644');
  await ready();
  shown = await displayed();
  assert.equal(hash(Buffer.from(shown.midi, 'base64')), sample(44, 0).midiSha256);
  assert.equal(hash(shown.settings), sample(44, 0).settingsSha256);
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log('PASS Satori #644 player uses the same #411 score/settings; no page errors or external requests');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
