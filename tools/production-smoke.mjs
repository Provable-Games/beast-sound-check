#!/usr/bin/env node
// Browser coverage for sampling, exact worker output, selection races and saved provenance.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { productionSource } from './production-source.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const pw = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE || '/workspace/beasts-v3/node_modules/playwright');
const browserName = process.env.PLAYWRIGHT_BROWSER || 'chromium';
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + new URL(req.url, 'http://local').pathname.replace(/\/$/, '/index.html'));
  if (!file.startsWith(root + '/') || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : file.endsWith('.gz') ? 'application/gzip' : 'application/json' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await pw[browserName].launch({ ...(process.env.PLAYWRIGHT_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE } : {}) });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(() => {
  const AC = window.AudioContext;
  if (AC) window.AudioContext = new Proxy(AC, { construct(target, args) { const c = new target(...args); window.__audioContext = c; return c; } });
});
const page = await context.newPage(), errors = [], external = [];
page.on('pageerror', e => errors.push(e.message));
context.on('request', r => { if (/^https?:/.test(r.url()) && !r.url().startsWith(origin + '/')) external.push(r.url()); });
const ready = async (text) => {
  await page.waitForFunction(() => !document.getElementById('bp').disabled && !!document.querySelector('#pw iframe') && document.getElementById('sample-now').textContent.startsWith('Now sampling:'), null, { timeout: 60000 });
  if (text) assert.match(await page.locator('#ttl').textContent(), text);
};
const frame = () => page.frames().find(f => f !== page.mainFrame());
const source = await productionSource();
const built = JSON.parse(fs.readFileSync(path.join(root, 'index.html'), 'utf8').match(/<script[^>]+id="data"[^>]*>([\s\S]*?)<\/script>/)[1]);
const rendition = JSON.parse(fs.readFileSync(path.join(root, 'renditions', built.sepolia.sets[0].dir, 'manifest.json'), 'utf8'));
async function notesVisible() {
  await page.locator('#pw').scrollIntoViewIfNeeded();
  await frame().waitForSelector('#play:not([disabled])');
  const preset = +await page.locator('#sample-fx').inputValue();
  const expected = !!((rendition.renderer.notesPresets >> preset) & 1);
  assert.equal(await frame().locator('script#beast-notes').count(), +expected);
  if (!expected) {
    assert.equal(await frame().locator('canvas').count(), 0);
    return;
  }
  await frame().waitForFunction(() => {
    const c = document.querySelector('canvas');
    if (!c || !c.width || !c.height) return false;
    const p = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < p.length; i += 4) if (p[i + 3] && Math.max(p[i], p[i + 1], p[i + 2]) - Math.min(p[i], p[i + 1], p[i + 2]) > 10) return true;
    return false;
  }, null, { timeout: 15000 });
  assert.equal(await frame().locator('#beast-art').evaluate(e => e.localName), 'img');
  assert.equal(await frame().locator('canvas').count(), 1);
}
const notesPixels = () => frame().evaluate(() => {
  const c = document.querySelector('canvas'), pixels = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let hash = 2166136261;
  for (const byte of pixels) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  return hash;
});
async function matches() {
  const input = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('beast-sound-check-')))).sample);
  const expected = Buffer.from(source.composer.compose(input).midi).toString('base64');
  assert.equal(await frame().locator('#onchain-midi-data').textContent(), expected);
  return input;
}
try {
  await page.goto(origin + '/'); await ready(/Warlock/);
  assert.equal(await page.locator('#sample-species option').count(), 75);
  assert.equal(await page.locator('#sample-style option').count(), 23);
  assert.equal(await page.locator('#sample-prefix option').count(), 70);
  assert.equal(await page.locator('#sample-suffix option').count(), 18);
  assert.equal(await page.locator('iframe').count(), 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await matches();
  await notesVisible();
  console.log('PASS default sampler, all species/styles/names, one player, phone layout');

  for (const kind of ['check', 'name', 'purchase', 'edition']) {
    await page.selectOption('#sample-kind', kind); await ready();
    if (kind !== 'check') { await page.selectOption('#sample-prefix', '69'); await ready(); await page.selectOption('#sample-suffix', '18'); await ready(); }
    for (const fx of ['0', '1', '2', '3']) { await page.selectOption('#sample-fx', fx); await ready(); await matches(); await notesVisible(); }
  }
  console.log('PASS all official track types and sound effects match the production adapter');

  await page.selectOption('#sample-species', '68'); await ready(/Yeti/);
  await page.locator('#sample-seed').fill('0xffffffffffffffff'); await page.locator('#sample-seed').dispatchEvent('change'); await ready();
  for (let i = 0; i < 23; i++) { await page.selectOption('#sample-style', String(i)); await ready(); await matches(); }
  await page.locator('#sample-edition').fill('47'); await page.locator('#sample-edition').dispatchEvent('change'); await ready();
  const selection = await matches(); assert.equal(selection.edition, 47); assert.equal(selection.seed, '18446744073709551615');
  await page.click('#sample-next'); await ready();
  assert.equal(await page.locator('#sample-species').inputValue(), '69');
  assert.equal(await page.locator('#sample-edition').inputValue(), '47');
  assert.equal(await page.locator('#sample-seed').inputValue(), selection.seed);
  console.log('PASS all 23 styles, later editions, exact 64-bit seeds and comparison settings preserved');

  await page.locator('#pw').scrollIntoViewIfNeeded();
  await frame().waitForSelector('#play:not([disabled])', { timeout: 20000 });
  await frame().locator('#play').click();
  await frame().waitForFunction(() => window.__audioContext?.state === 'running', null, { timeout: 15000 });
  const playingNotes = await notesPixels();
  await page.waitForTimeout(350);
  assert.notEqual(await notesPixels(), playingNotes);
  await page.locator('#pw').screenshot({ path: '/tmp/beast-sound-midi-preview-' + browserName + '.png' });
  await frame().locator('#play').click();
  await frame().waitForFunction(() => window.OnchainMidiPlayer.getPlayStatus().state === 'paused');
  await page.waitForTimeout(100);
  const pausedNotes = await notesPixels();
  await page.waitForTimeout(350);
  assert.equal(await notesPixels(), pausedNotes);
  console.log('PASS Sepolia visual notes mask: no notes for 0/1, scrolling and pause-freeze for 2/3');
  await page.click('#bf'); await page.locator('#note').fill('Sampler regression note'); await page.locator('#note').blur();
  const ratedUrl = page.url();
  await page.click('#sample-next-seed'); await ready();
  assert.equal(await page.locator('#bf').getAttribute('aria-pressed'), 'false');
  await page.goto(ratedUrl); await page.reload(); await ready();
  assert.equal(await page.locator('#bf').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#note').inputValue(), 'Sampler regression note');
  const summary = await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('beast-sound-check-'))));
    return Object.values(store.r).find(r => r.production && r.s === 'fail');
  });
  assert.equal(summary.production.input.edition, 47); assert.equal(summary.production.input.seed, selection.seed);
  assert.equal(summary.production.revision, source.revision);
  console.log('PASS audible playback, pause, per-sample ratings, reload and exact provenance');

  const before = await frame().locator('#onchain-midi-data').textContent();
  await page.locator('#sample-seed').fill('-1'); await page.locator('#sample-seed').dispatchEvent('change');
  assert.equal(await page.locator('#sample-error').isVisible(), true);
  assert.equal(await frame().locator('#onchain-midi-data').textContent(), before);
  await page.locator('#sample-seed').fill('1'); await page.locator('#sample-seed').dispatchEvent('change');
  await page.selectOption('#sample-species', '53'); await page.selectOption('#sample-species', '2'); await ready(/Typhon/);
  assert.equal((await matches()).sid, 2);
  console.log('PASS invalid input leaves the current sample intact; rapid changes show the latest sample');

  await page.goto(origin + '/#beast-01-genesis');
  await page.waitForFunction(() => document.querySelector('#pw iframe') && document.getElementById('kick').textContent.includes('Beasts on Sepolia'), null, { timeout: 30000 });
  assert.equal(await page.locator('#bp').isDisabled(), false);
  await page.selectOption('#sample-kind', 'species'); await ready();
  assert.equal(await page.locator('iframe').count(), 1);
  await page.screenshot({ path: '/tmp/beast-sound-sampler-' + browserName + '.png', fullPage: false });
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('PASS deployed references remain available, returning to the sampler, no page errors or external services');
} catch (error) {
  console.error('Page errors:', errors);
  console.error('Player:', await frame()?.evaluate(() => ({ play: document.getElementById('play')?.outerHTML, style: document.getElementById('play') && getComputedStyle(document.getElementById('play')).cssText, art: document.getElementById('beast-art') && { loaded: document.getElementById('beast-art').complete, width: document.getElementById('beast-art').naturalWidth }, text: document.body.innerText.slice(-1000) })).catch(() => null));
  await page.screenshot({ path: '/tmp/beast-sound-sampler-error.png' });
  throw error;
} finally { await browser.close(); server.close(); }
