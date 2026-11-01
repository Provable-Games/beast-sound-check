import { createSynth, installSettings, decodeSettings } from './settings.js';
import { MidiRoll } from './midi-roll.mjs';
const $ = id => document.getElementById(id);
const modeLabels = { song:['Written','Mega','Echo','Mega + echo'], check:['Written','Mega','Portato','Mega/accent'] };
const labels = () => modeLabels[state.kind];
const title = () => state.kind === 'check' ? 'Sound Check' : 'Species Song';
const state = { kind:'check', sid: 1, fx: 0, status: 'stopped', serial: 0, synth: null, data: null, current: null, volume: 1 };
window.audition = state;
const roll = new MidiRoll($('midi-panel'));
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
  const mode = state.manifest.modes[state.kind];
  const authored = state.kind === 'song' && mode.overrides?.find(x=>x.sid===s.sid);
  $('source').textContent = state.kind === 'check' ? `Sound Check candidates · ${mode.sourceRevision.slice(0,7)} · 300 / 300 ready · Listening approval pending` : authored ? `Satori · Original lab 411 · ${authored.sourceRevision.slice(0,7)} · 4 / 4 ready` : `Casey upstream Species Songs · ${mode.sourceRevision.slice(0,7)} · Satori uses original 411 · 300 / 300 ready`;
  $('mode-note').textContent = s.fixedReference || (state.kind === 'check' ? 'Proposed warm-up · No chip echo · Pending listening approval' : 'Casey Species Song · No time drift');
  $('what').textContent = state.kind === 'check' ? 'Sound Check candidates use the implemented launch scores. Cyclops is species 64 within this same set of 75. Its four distinct performances retain the whole eight-sound original 504 sequence; Written is the exact 175 BPM reference. Checks have no chip echo.' : 'Satori uses the selected original lab411 Species Song with full Mega and Echo performances. The other74 Species Songs retain Casey’s upstream performances. All play without time drift; the regular artwork stays the same. Harpy and Pegasus use their official shared-song swap.';
  document.querySelectorAll('[data-kind]').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.kind === state.kind)));
  document.querySelectorAll('.presets [data-fx] span').forEach((span,fx)=>span.textContent=labels()[fx]);
  document.querySelectorAll('.species-row [data-fx]').forEach(button=>button.setAttribute('aria-label',`${state.data.species[+button.dataset.sid-1].name}, ${title()}, preset ${button.dataset.fx}, ${labels(+button.dataset.sid)[+button.dataset.fx]}`));
  const headers = state.kind === 'check' ? ['SPECIES','0 · Written','1 · Mega','2 · Portato','3 · Accent'] : ['SPECIES','0 · Written','1 · Mega','2 · Echo','3 · Both'];
  document.querySelectorAll('#column-head span').forEach((span,i)=>span.textContent=headers[i]);
  const art = state.data.art[s.sid];
  if ($('art').getAttribute('src') !== art) $('art').src = art;
  $('art').alt = `${s.name}, regular Beast card`;
  document.querySelectorAll('[data-fx]').forEach(button => {
    const sid = button.dataset.sid ? +button.dataset.sid : state.sid;
    button.setAttribute('aria-pressed', String(sid === state.sid && +button.dataset.fx === state.fx));
  });
  document.querySelectorAll('.species-row').forEach(row => row.classList.toggle('active', +row.dataset.sid === state.sid));
  $('play').textContent = state.status === 'playing' ? 'Pause' : state.status === 'paused' ? 'Resume' : 'Play';
  history.replaceState(null, '', state.kind === 'check' ? `#check-${state.sid}-${state.fx}` : `#${state.sid}-${state.fx}`);
}
function stop() {
  ++state.serial;
  state.synth?.stopMIDI();
  state.status = 'stopped';
  state.playbackStart = null; roll.setTick(0, false);
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
    // 600 choices reuse this one synth/context; an older request cannot start.
    const resumed = synth.resume();
    state.status = 'starting'; status('Starting…'); render();
    Promise.resolve(resumed).then(() => {
      if (request !== state.serial) return;
      synth.loadMIDI(bytes(sample.midi_b64));
      synth.setLoop(1); synth.setLoopEnd(synth.getPlayStatus().maxTick); synth.playMIDI();
      // curTick is the synth's scheduling cursor, which can lead audible notes.
      // Use its public start time and AudioContext clock so pause freezes the
      // roll and loop boundaries stay aligned with what reaches the speakers.
      state.playbackStart = synth.getPlayStatus().startTime;
      state.status = 'playing'; status(`${sample.fx} · ${labels()[sample.fx]} · Playing`); render();
    }).catch(error => failed(error, request));
  } catch (error) { failed(error, request); }
}
function failed(error, request) {
  if (request !== state.serial) return;
  state.status = 'stopped'; state.synth?.stopMIDI(); render();
  state.playbackStart = null; roll.setTick(0, false);
  status(`Tap Play to start audio: ${error.message || error}`);
}
function select(sid, fx, play = true, kind = state.kind) {
  if (!state.data) return;
  ++state.serial; state.synth?.stopMIDI(); state.status = 'stopped';
  state.kind = kind; state.sid = sid; state.fx = fx; state.current = state.lookup.get(`${kind}-${sid}-${fx}`);
  if (!state.current) throw new Error('Missing sample selection');
  state.playbackStart = null;
  state.midi = roll.setMidi(bytes(state.current.midi_b64), `${state.current.name} · ${title()} · ${labels()[fx]}`);
  $('progress').style.width = '0%'; $('time').textContent = '0:00';
  status(`${fx} · ${labels()[fx]} · Ready`); render();
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
      state.status = 'playing'; status(`${state.fx} · ${labels()[state.fx]} · Playing`); render();
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
  if (data.samples.length !== 600 || data.species.length !== 75 || new Set(data.samples.map(s=>`${s.kind}-${s.sid}-${s.fx}`)).size!==600) throw new Error('Incomplete sample set');
  state.data = data; state.manifest = manifest; state.lookup = new Map(data.samples.map(s=>[`${s.kind}-${s.sid}-${s.fx}`,s]));
  for (const species of data.species) {
    const row = document.createElement('div'); row.className = 'species-row'; row.dataset.sid = species.id; row.dataset.name = [species.name, ...species.aliases].join(' ').toLowerCase();
    const name = document.createElement('div'); name.className = 'species-name';
    const number = document.createElement('span'); number.className = 'species-number'; number.textContent = String(species.id).padStart(2, '0');
    const title = document.createElement('span'); title.className = 'species-title'; title.textContent = species.name; name.append(number, title); row.append(name);
    labels().forEach((label, fx) => { const b = document.createElement('button'); b.textContent = String(fx); b.dataset.sid = species.id; b.dataset.fx = fx; b.setAttribute('aria-label', `${species.name}, preset ${fx}, ${label}`); row.append(b); });
    $('rows').append(row);
  }
  document.querySelectorAll('button').forEach(button => { button.disabled = false; });
  document.addEventListener('click', event => {
    const button = event.target.closest('button[data-fx]');
    if (button) select(+(button.dataset.sid || state.sid), +button.dataset.fx);
    const mode = event.target.closest('button[data-kind]');
    if (mode && mode.dataset.kind !== state.kind) select(state.sid,state.fx,['playing','starting'].includes(state.status),mode.dataset.kind);
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
  function fromHash() {
    const match = /^#(?:(song|check)-)?(\d+)-([0-3])$/.exec(location.hash);
    return match && +match[2]>=1 && +match[2]<=75 ? {kind:match[1] || 'song',sid:+match[2],fx:+match[3]} : {kind:'check',sid:1,fx:0};
  }
  const initial = fromHash(); select(initial.sid,initial.fx,false,initial.kind);
  window.addEventListener('hashchange',()=>{const x=fromHash();if(x.kind!==state.kind || x.sid!==state.sid || x.fx!==state.fx)select(x.sid,x.fx,false,x.kind);});
  let lastFrame = 0;
  function animate(now) {
    requestAnimationFrame(animate);
    if (now - lastFrame < 33 || !state.synth || !['playing','paused'].includes(state.status) || state.playbackStart == null) return;
    lastFrame = now;
    const elapsed = Math.max(0, state.synth.getAudioContext().currentTime - state.playbackStart);
    const seconds = elapsed % state.midi.duration, tick = state.midi.secondsToTick(seconds);
    roll.setTick(tick, state.status === 'playing');
    $('progress').style.width = `${seconds / state.midi.duration * 100}%`; $('time').textContent = clock(seconds);
  }
  requestAnimationFrame(animate);
} catch (error) {
  status(error.message); $('source').textContent = 'Samples unavailable'; $('details').textContent = 'Reload to try again.';
}
window.addEventListener('pagehide', () => { ++state.serial; state.synth?.stopMIDI(); state.synth?.getAudioContext()?.close(); });
