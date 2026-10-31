// Inlined by build_site.mjs inside the site's existing player/controller scope.
var audition = { active: false, input: null, html: '', request: 0, worker: null, error: '', busy: false };
var PROD = D.production;
var SAMPLE_KINDS = { check: 'Sound Check', species: 'Species Song', name: 'Name Song', purchase: 'Custom canon', edition: 'Edition track' };
function productionActive() { return !!audition && audition.active; }
function sampleKey(x) { return ['sample', x.sid, x.kind, x.fx, x.name, x.edition, x.seed].join('-'); }
function parseSampleKey(k) {
  var m = /^sample-(\d+)-(check|species|name|purchase|edition)-([0-3])-(\d+)-(\d+)-(\d+)$/.exec(k || '');
  return m ? { sid: +m[1], kind: m[2], fx: +m[3], name: +m[4], edition: +m[5], seed: m[6] } : null;
}
function sampleRatingKey(x) { return 'production/' + PROD.identity + '/' + sampleKey(x); }
function sampleName(x) {
  var n = x.name - 1;
  return x.name ? PROD.prefixes[Math.floor(n / 18)] + ' ' + PROD.suffixes[n % 18] : 'No special name';
}
function sampleTitle(x) {
  return PROD.species[x.sid - 1].name + ' · ' + (x.kind === 'edition' ? PROD.styles[(x.edition - 1) % PROD.styles.length].label : SAMPLE_KINDS[x.kind]);
}
function sampleRead() {
  var kind = $('sample-kind').value, prefix = +$('sample-prefix').value;
  return { sid: +$('sample-species').value, kind: kind, fx: +$('sample-fx').value,
    name: kind === 'species' || !prefix ? 0 : (prefix - 1) * 18 + +$('sample-suffix').value,
    edition: kind === 'edition' ? +$('sample-edition').value : 0,
    seed: kind === 'purchase' || kind === 'edition' ? $('sample-seed').value.trim() : '0' };
}
function sampleControls(x) {
  $('sample-species').value = x.sid; $('sample-kind').value = x.kind; $('sample-fx').value = x.fx;
  $('sample-prefix').value = x.name ? Math.floor((x.name - 1) / 18) + 1 : 0;
  $('sample-suffix').value = x.name ? (x.name - 1) % 18 + 1 : 1;
  if (x.edition) $('sample-edition').value = x.edition;
  if (x.kind === 'purchase' || x.kind === 'edition') $('sample-seed').value = x.seed;
  sampleFields();
}
function sampleFields() {
  var kind = $('sample-kind').value, named = kind !== 'species', seeded = kind === 'purchase' || kind === 'edition';
  $('sample-name-row').hidden = !named;
  $('sample-suffix').disabled = !$('sample-prefix').value || $('sample-prefix').value === '0';
  $('sample-edition-row').hidden = kind !== 'edition'; $('sample-seed-row').hidden = !seeded;
  $('sample-fx').options[2].textContent = kind === 'check' ? '2 · Portato' : '2 · Chip echo / portato';
  $('sample-fx').options[3].textContent = kind === 'check' ? '3 · Mega + accent' : '3 · Mega + chip echo / accent';
  var edition = +$('sample-edition').value;
  if (Number.isInteger(edition) && edition >= 1) $('sample-style').value = (edition - 1) % PROD.styles.length;
  $('sample-hint').textContent = kind === 'check' ? 'A short test of this Beast’s own sound. The same name keeps its key and preset as you compare effects.'
    : kind === 'species' ? 'The shared song as written. Harpy and Pegasus use their official song swap.'
    : kind === 'name' ? 'The species’ theme in the special name’s key and style. With no name, this uses the species’ own unswapped song.'
    : kind === 'purchase' ? 'A generated edition 0 purchase: the seed varies the arrangement and shape of this Beast’s song.'
    : 'All 23 styles are available. Later editions cycle through them with new mode and tempo choices. Edition tracks use the seed’s low 64 bits; the name does not change their music.';
}
function sampleError(message) {
  audition.busy = false; audition.error = message; audition.html = '';
  $('sample-error').hidden = false; $('sample-error').textContent = message;
  $('bp').disabled = $('bf').disabled = $('note').disabled = true;
  pwMsg(message, true);
}
function leaveSample() {
  if (!audition) return;
  audition.active = false; audition.request++;
  $('bp').disabled = $('bf').disabled = $('note').disabled = false;
  document.querySelector('.speed').hidden = false;
  $('sample-now').textContent = '';
}
function sampleWorker() {
  if (audition.worker) return audition.worker;
  var worker = new Worker(PROD.worker);
  worker.onmessage = function (event) {
    var r = event.data;
    if (!audition.active || r.request !== audition.request) return;
    if (r.error) { sampleError(r.error); return; }
    audition.input = r.input; audition.busy = false; audition.error = '';
    sampleControls(r.input);
    var midi = r.midi, tempo = 500000;
    for (var i = 0; i < midi.length - 5; i++) if (midi[i] === 255 && midi[i + 1] === 81 && midi[i + 2] === 3) { tempo = midi[i + 3] * 65536 + midi[i + 4] * 256 + midi[i + 5]; break; }
    var b64 = function (bytes) { var s = ''; for (var j = 0; j < bytes.length; j += 8192) s += String.fromCharCode.apply(null, bytes.subarray(j, j + 8192)); return btoa(s); };
    var svg = b64(new TextEncoder().encode(r.svg)), data = '<script type="text/plain" id="onchain-midi-settings">' + r.settings + '</scr' + 'ipt><script type="text/plain" id="onchain-midi-data">' + b64(midi) + '</scr' + 'ipt>';
    var page = PROD.page.fragments;
    // Sampler presets pair the visual and sound effects, as the Sepolia rendition tokens do.
    var notesOn = !!((PROD.notesPresets >> r.input.fx) & 1);
    audition.html = page.head + F.gunzip + F.player + page.body + '<img id="beast-art" alt="" src="data:image/svg+xml;base64,' + svg + '">' + data + (notesOn ? page.notes : '') + page.footer;
    $('ttl').textContent = sampleTitle(r.input);
    $('sample-now').textContent = 'Now sampling: ' + sampleTitle(r.input) + ' · effects ' + r.input.fx;
    $('artinfo').textContent = (60000000 / tempo).toFixed(1).replace(/\.0$/, '') + ' BPM · ' + midi.length + ' MIDI bytes · ' + (r.input.fx & 1 ? 'Shiny' : 'Regular') + ' Beast · Visual preset ' + r.input.fx + ': MIDI notes ' + (notesOn ? 'on' : 'off');
    $('blurb').textContent = sampleDescription(r.input);
    $('bp').disabled = $('bf').disabled = $('note').disabled = false;
    rateUi(store.r[sampleRatingKey(r.input)]);
    mountHtml(audition.html, sampleTitle(r.input));
    store.last = sampleKey(r.input); store.sample = r.input; save();
    try { history.replaceState(null, '', '#' + sampleKey(r.input)); } catch (e) {}
    paintPos();
  };
  worker.onerror = function () { if (audition.active) sampleError('The sample composer could not start. Reload the page to try again.'); worker.terminate(); audition.worker = null; };
  audition.worker = worker;
  return worker;
}
function sampleDescription(x) {
  if (PROD.features && PROD.features.cyclopsCheck && x.sid === 64 && x.kind === 'check') {
    return 'Original lab 504: the whole eight-sound Arp/FX sequence at 175 BPM. Its audio stays fixed across names and effects; the visual preset follows effects ' + x.fx + '. Candidate audio for listening review.';
  }
  if (PROD.features && PROD.features.satori411 && x.sid === 44 && (x.kind === 'species' || ((x.kind === 'name' || x.kind === 'purchase') && (x.name === 0 || x.name === 1)))) {
    return (x.kind === 'purchase' ? 'Seed ' + x.seed + ' varies the key and pace of the authored Satori arrangement.' : 'Original lab 411: the 72-second Satori arrangement, also the base for Agony Bane.') + ' Its triangle, bass, harp and drums retain the original mix. Effects ' + x.fx + ' change expression without replacing the instrument palette. Candidate audio for listening review.';
  }
  var effects = x.kind === 'check' ? ['as written', 'mega', 'portato', 'mega + accent'] : ['as written', 'mega', 'chip echo / portato', 'mega + chip echo / accent'];
  var a = [SAMPLE_KINDS[x.kind], 'effects ' + x.fx + ' (' + effects[x.fx] + ')'];
  if (x.kind !== 'species') a.push(sampleName(x));
  if (x.kind === 'purchase' || x.kind === 'edition') a.push('seed ' + x.seed);
  if (x.kind === 'edition') a.push('edition ' + x.edition);
  return a.join(' · ') + '. Proposed audio, composed locally as written; this is a preview, not an owned or purchased track.';
}
function showSample(input) {
  if (!PROD) return false;
  // Validate before replacing the current selection, keeping large integers as strings.
  try {
    if (!PROD.species[input.sid - 1] || !SAMPLE_KINDS[input.kind] || !Number.isInteger(input.name) || input.name < 0 || input.name > 1242) throw new Error('Invalid sample selection');
    if (!/^(?:[0-9]+|0x[0-9a-f]+)$/i.test(input.seed)) throw new Error('Seed must be a decimal or hexadecimal integer');
    var seed = BigInt(input.seed);
    if (seed < 0n || seed >= (1n << 251n) + 17n * (1n << 192n) + 1n) throw new Error('Seed must fit a Starknet felt');
    if (input.kind === 'edition' && (!Number.isInteger(input.edition) || input.edition < 1 || input.edition > 4294967295)) throw new Error('Edition must be between 1 and 4294967295');
    input = Object.assign({}, input, { seed: seed.toString() });
  } catch (e) { $('sample-error').hidden = false; $('sample-error').textContent = e.message; return true; }
  cur = null; mountSeq++; audition.active = true; audition.input = input; audition.html = ''; audition.busy = true; audition.error = '';
  var request = ++audition.request;
  sampleControls(input); panels(false);
  $("sepolia").open = false;
  $('realctl').hidden = $('engctl').hidden = $('engctl2').hidden = $('lab').hidden = $('labbadge').hidden = true;
  $('ftbadge').hidden = true; $('facts').hidden = true; document.querySelector('.speed').hidden = true;
  $('sample-error').hidden = true;
  $('kick').textContent = (PROD.candidate ? 'Candidate audition · midi_fun_contract ' : 'Proposed Beast sound · midi_fun_contract ') + PROD.revision.slice(0, 7);
  $('ttl').textContent = sampleTitle(input); $('blurb').textContent = sampleDescription(input); $('artinfo').textContent = '';
  $('sample-now').textContent = 'Composing ' + sampleTitle(input) + '…';
  $('checks').textContent = '';
  ['Compare the character of the sound, melody and arrangement across species, names and effects.', 'Listen for balanced voices, clear drums, and an even loop without clicks or stuck notes.', 'Pass, Fail and notes are saved for this exact sample; exported results include the seed, name, edition and source.'].forEach(function (text) { $('checks').appendChild(el('li', '', text)); });
  rateUi(store.r[sampleRatingKey(input)]);
  $('bp').disabled = $('bf').disabled = $('note').disabled = true;
  Object.keys(rows).forEach(function (id) { rows[id].b.classList.remove('cur'); });
  paintRealRows(); paintPicker(); paintPos();
  pwMsg('Composing this Beast’s sample…');
  try { sampleWorker().postMessage({ request: request, input: input }); } catch (e) { sampleError(e.message); }
  return true;
}
function sampleStep(delta) {
  var x = Object.assign({}, audition.input || sampleRead());
  x.sid = ((x.sid - 1 + delta + 75) % 75) + 1; showSample(x);
}
function sampleRecord() {
  var x = audition.input, k = sampleRatingKey(x), r = store.r[k] || (store.r[k] = {});
  r.production = { input: x, title: sampleTitle(x), revision: PROD.revision, identity: PROD.identity, player: D.meta.playerVersion };
  return r;
}
function sampleSummary() {
  var records = Object.keys(store.r).map(function (k) { return store.r[k]; }).filter(function (r) { return r.production && (r.s || r.n); });
  records.sort(function (a, b) { return (a.s === 'fail' ? 0 : 1) - (b.s === 'fail' ? 0 : 1) || a.production.input.sid - b.production.input.sid; });
  return ['Proposed Beast sound samples', 'Source midi_fun_contract ' + PROD.revision + '; adapter ' + PROD.adapterHash + '; ' + (PROD.candidate ? (PROD.parity.cases ? PROD.parity.cases + ' Cairo parity cases; musical approval pending' : 'candidate audition; Cairo parity pending') : PROD.parity.cases + ' Cairo parity cases'), 'Rated/noted samples: ' + records.length].concat(records.map(function (r) {
    var p = r.production;
    return (r.s ? r.s.toUpperCase() : 'NOTE') + ' ' + p.title + ' ' + JSON.stringify(p.input) + ' [source ' + p.revision + ', build ' + p.identity + ', player ' + p.player + ']' + (r.n ? ' - ' + r.n.replace(/\s+/g, ' ') : '');
  }));
}
function initSampler() {
  if (!PROD) { $('sampler').hidden = true; return; }
  function options(id, entries) { var select = $(id); entries.forEach(function (x) { var o = el('option', '', x.label); o.value = x.value; select.appendChild(o); }); }
  options('sample-species', PROD.species.map(function (s) { return { value: s.id, label: s.id + ' ' + s.name }; }));
  options('sample-prefix', [{ value: 0, label: 'No special name' }].concat(PROD.prefixes.map(function (s, i) { return { value: i + 1, label: s }; })));
  options('sample-suffix', PROD.suffixes.map(function (s, i) { return { value: i + 1, label: s }; }));
  options('sample-style', PROD.styles.map(function (s) { return { value: s.index, label: s.label }; }));
  ['sample-species', 'sample-kind', 'sample-fx', 'sample-prefix', 'sample-suffix', 'sample-edition', 'sample-seed'].forEach(function (id) { $(id).addEventListener('change', function () { sampleFields(); showSample(sampleRead()); }); });
  $('sample-style').addEventListener('change', function () { var e = Math.max(1, +$('sample-edition').value || 1); $('sample-edition').value = Math.floor((e - 1) / PROD.styles.length) * PROD.styles.length + +this.value + 1; showSample(sampleRead()); });
  $('sample-play').addEventListener('click', function () { showSample(sampleRead()); });
  $('sample-random').addEventListener('click', function () { var n = new Uint32Array(2); crypto.getRandomValues(n); $('sample-seed').value = ((BigInt(n[0]) << 32n) | BigInt(n[1])).toString(); showSample(sampleRead()); });
  $('sample-prev').addEventListener('click', function () { sampleStep(-1); });
  $('sample-next').addEventListener('click', function () { sampleStep(1); });
  $('sample-next-seed').addEventListener('click', function () { try { var n = BigInt($('sample-seed').value); $('sample-seed').value = (n + 1n).toString(); showSample(sampleRead()); } catch (e) { $('sample-error').hidden = false; $('sample-error').textContent = 'Enter a decimal or hexadecimal seed first.'; } });
  sampleControls(store.sample || { sid: 1, kind: 'species', fx: 0, name: 0, edition: 1, seed: '1' });
  $('sample-source').textContent = 'Reference engine ' + PROD.revision.slice(0, 7) + ' · ' + (PROD.candidate ? (PROD.parity.cases ? PROD.parity.cases + ' samples checked against Cairo; musical approval pending' : 'candidate audition; Cairo parity pending') : PROD.parity.cases + ' samples checked against Cairo') + ' · TinySynth ' + D.meta.playerVersion + '. Audio is generated on your device, with no wallet or purchase.';
}
initSampler();
window.addEventListener('hashchange', function () {
  var key = location.hash.slice(1);
  if (key && key !== curKey()) go(key);
});
