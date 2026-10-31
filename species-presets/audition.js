import { createSynth, installSettings, decodeSettings } from './settings.js';
const $ = id => document.getElementById(id);
const labels = ['Written', 'Mega', 'Echo', 'Mega + echo'];
const state = { sid: 1, fx: 0, status: 'stopped', serial: 0, synth: null, data: null, current: null, volume: 1 };
window.audition = state;
const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const bytes = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
const settingsCache = new Map();
function settings(sample) {
  if (!settingsCache.has(sample.settingsKey)) settingsCache.set(sample.settingsKey, decodeSettings(state.data.settings[sample.settingsKey]));
  return settingsCache.get(sample.settingsKey);
}
function status(text) { $('status').textContent = text; }
function render() {
  const s = state.current;
  $('name').textContent = s.name;
  $('number').textContent = `ORIGINAL ${String(s.sid).padStart(2, '0')} / 75`;
  $('details').textContent = `${s.key} · ${(60000000 / s.tempoUs).toFixed(1).replace(/\.0$/, '')} BPM · ${clock(s.seconds)}`;
  const art = state.data.art[s.sid];
  if ($('art').getAttribute('src') !== art) $('art').src = art;
  $('art').alt = `${s.name}, regular Beast card`;
  document.querySelectorAll('[data-fx]').forEach(button => {
    const sid = button.dataset.sid ? +button.dataset.sid : state.sid;
    button.setAttribute('aria-pressed', String(sid === state.sid && +button.dataset.fx === state.fx));
  });
  document.querySelectorAll('.species-row').forEach(row => row.classList.toggle('active', +row.dataset.sid === state.sid));
  $('play').textContent = state.status === 'playing' ? 'Pause' : state.status === 'paused' ? 'Resume' : 'Play';
  history.replaceState(null, '', `#${state.sid}-${state.fx}`);
}
function stop() {
  ++state.serial;
  state.synth?.stopMIDI();
  state.status = 'stopped';
  status('Stopped');
  $('progress').style.width = '0%'; $('time').textContent = '0:00';
  render();
}
function playSelected() {
  const request = ++state.serial, sample = state.current;
  try {
    const s = settings(sample);
    if (!state.synth) state.synth = createSynth(window.WebAudioTinySynth, s);
    const synth = state.synth;
    synth.stopMIDI();
    installSettings(synth, s);
    synth.setMasterVol(s.master_vol / 100 * state.volume);
    synth.prewarm();
    // Resume is called synchronously inside the actual click/key gesture. All
    // 300 choices reuse this one synth/context; an older request cannot start.
    const resumed = synth.resume();
    state.status = 'starting'; status('Starting…'); render();
    Promise.resolve(resumed).then(() => {
      if (request !== state.serial) return;
      synth.loadMIDI(bytes(sample.midi_b64));
      synth.setLoop(1); synth.setLoopEnd(synth.getPlayStatus().maxTick); synth.playMIDI();
      state.status = 'playing'; status(`${sample.fx} · ${labels[sample.fx]} · Playing`); render();
    }).catch(error => failed(error, request));
  } catch (error) { failed(error, request); }
}
function failed(error, request) {
  if (request !== state.serial) return;
  state.status = 'stopped'; state.synth?.stopMIDI(); render();
  status(`Tap Play to start audio: ${error.message || error}`);
}
function select(sid, fx, play = true) {
  if (!state.data) return;
  ++state.serial; state.synth?.stopMIDI(); state.status = 'stopped';
  state.sid = sid; state.fx = fx; state.current = state.data.samples[(sid - 1) * 4 + fx];
  $('progress').style.width = '0%'; $('time').textContent = '0:00';
  status(`${fx} · ${labels[fx]} · Ready`); render();
  if (play) playSelected();
}
function toggle() {
  if (state.status === 'playing') {
    const request = ++state.serial;
    state.status = 'paused'; status('Paused'); render();
    state.synth.getAudioContext().suspend().catch(e => failed(e, request));
  } else if (state.status === 'paused') {
    const request = ++state.serial;
    Promise.resolve(state.synth.resume()).then(() => {
      if (request !== state.serial) return;
      state.status = 'playing'; status(`${state.fx} · ${labels[state.fx]} · Playing`); render();
    }).catch(e => failed(e, request));
  } else playSelected();
}
function filter() {
  const query = $('search').value.trim().toLowerCase(); let count = 0;
  for (const row of document.querySelectorAll('.species-row')) {
    const match = row.dataset.name.includes(query) || (query !== '' && +query === +row.dataset.sid);
    row.hidden = !match; count += +match;
  }
  $('count').textContent = `${count} species · ${count * 4} samples`; $('empty').hidden = count !== 0;
}
try {
  const manifestResponse = await fetch('manifest.json'); if (!manifestResponse.ok) throw new Error('Could not load manifest');
  const manifest = await manifestResponse.json();
  const response = await fetch(manifest.data.file); if (!response.ok) throw new Error('Could not load samples');
  const packed = await response.arrayBuffer();
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', packed)), b => b.toString(16).padStart(2, '0')).join('');
  if (hash !== manifest.data.sha256) throw new Error('Sample file failed its content check');
  const data = await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
  if (data.samples.length !== 300 || data.species.length !== 75) throw new Error('Incomplete sample set');
  state.data = data;
  $('source').textContent = `Casey upstream · ${manifest.sourceRevision.slice(0, 7)} · As written · 300 / 300 ready`;
  for (const species of data.species) {
    const row = document.createElement('div'); row.className = 'species-row'; row.dataset.sid = species.id; row.dataset.name = [species.name, ...species.aliases].join(' ').toLowerCase();
    const name = document.createElement('div'); name.className = 'species-name';
    const number = document.createElement('span'); number.className = 'species-number'; number.textContent = String(species.id).padStart(2, '0');
    const title = document.createElement('span'); title.className = 'species-title'; title.textContent = species.name; name.append(number, title); row.append(name);
    labels.forEach((label, fx) => { const b = document.createElement('button'); b.textContent = String(fx); b.dataset.sid = species.id; b.dataset.fx = fx; b.setAttribute('aria-label', `${species.name}, preset ${fx}, ${label}`); row.append(b); });
    $('rows').append(row);
  }
  document.querySelectorAll('button').forEach(button => { button.disabled = false; });
  document.addEventListener('click', event => {
    const button = event.target.closest('button[data-fx]');
    if (button) select(+(button.dataset.sid || state.sid), +button.dataset.fx);
  });
  $('previous').onclick = () => select((state.sid + 73) % 75 + 1, state.fx);
  $('next').onclick = () => select(state.sid % 75 + 1, state.fx);
  $('stop').onclick = stop; $('play').onclick = toggle; $('search').oninput = filter;
  $('volume').oninput = () => { state.volume = +$('volume').value / 100; if (state.synth) state.synth.setMasterVol(settings(state.current).master_vol / 100 * state.volume); };
  document.addEventListener('keydown', event => {
    if (event.target.matches('input,textarea,select') || event.altKey || event.metaKey || event.ctrlKey) return;
    if (event.key === 'ArrowRight') select(state.sid, (state.fx + 1) % 4);
    else if (event.key === 'ArrowLeft') select(state.sid, (state.fx + 3) % 4);
    else if (event.key === 'ArrowDown') select(state.sid % 75 + 1, state.fx);
    else if (event.key === 'ArrowUp') select((state.sid + 73) % 75 + 1, state.fx);
    else if (event.code === 'Space') toggle();
    else return;
    event.preventDefault();
  });
  const match = /^#(\d+)-([0-3])$/.exec(location.hash);
  select(match && +match[1] >= 1 && +match[1] <= 75 ? +match[1] : 1, match ? +match[2] : 0, false);
  setInterval(() => {
    if (!state.synth || !['playing','paused'].includes(state.status)) return;
    const s = state.synth.getPlayStatus(), fraction = Math.min(1, Math.max(0, s.curTick / s.maxTick));
    $('progress').style.width = `${fraction * 100}%`; $('time').textContent = clock(fraction * state.current.seconds);
  }, 120);
} catch (error) {
  status(error.message); $('source').textContent = 'Samples unavailable'; $('details').textContent = 'Reload to try again.';
}
window.addEventListener('pagehide', () => { ++state.serial; state.synth?.stopMIDI(); state.synth?.getAudioContext()?.close(); });
