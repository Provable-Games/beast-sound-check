import { createSynth, installSettings, decodeSettings } from './settings.js';
import { MidiRoll, parseMidi } from './midi-roll.mjs';
import { NameSongs } from './name-song.mjs';
import { musicClock } from './music-clock.mjs';
import { syncSvgToMusic, restartImgOnPass, beatSeconds } from './art-sync.mjs';
const $ = id => document.getElementById(id);
const modeLabels = { song:['Written','Mega','Echo','Mega + echo'], check:['Written','Mega','Portato','Mega/accent'], name:['Written','Mega','Echo','Mega + echo'] };
const labels = () => modeLabels[state.kind];
const title = () => state.kind === 'check' ? 'Sound Check' : state.kind === 'name' ? 'Name Song' : 'Species Song';
const state = { kind:'check', sid: 1, fx: 0, status: 'stopped', serial: 0, synth: null, data: null, current: null, volume: 1, nameVariant:1, selection:0, composing:false };
window.audition = state;
const timing = musicClock(state);
state.timing = timing;
let artControls = null, artSync = null, artSelection = 0;
function mountArt() {
  // A helper captures its original source. Recreate it for every selection so a
  // pending image/still from an older species or performance cannot replace it.
  artSync?.dispose(); artControls?.();
  const img = $('art');
  // Namespace each helper's r=N URLs across selections, including a return to
  // the same species/tempo. Only the media type changes; the SVG bytes do not.
  img.src = state.data.art[state.sid].replace(';base64,', `;selection=${++artSelection};base64,`);
  img.alt = `${selectedTitle()}, regular Beast card`;
  const midi = state.current ? bytes(state.current.midi_b64) : null;
  artControls = restartImgOnPass(img, timing, { beat:s => midi ? beatSeconds(s, midi) : null });
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduced) artControls.pause();
  artSync = syncSvgToMusic(null, timing, { img:reduced ? null : artControls });
}
const roll = new MidiRoll($('midi-panel'));
const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const bytes = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
const settingsCache = new Map();
function settings(sample) {
  // Named banks are pinned separately; their keys cannot alias the older Song banks.
  const key = sample.kind === 'name' ? `name/${sample.settingsKey}` : sample.settingsKey;
  if (!settingsCache.has(key)) settingsCache.set(key, decodeSettings(sample.settingsText ?? state.data.settings[sample.settingsKey]));
  return settingsCache.get(key);
}
function selectedName() {
  if(!state.namesManifest)return `Name #${state.nameVariant}`;
  const n=state.nameVariant-1;
  return `${state.namesManifest.prefixes[Math.floor(n/18)]} ${state.namesManifest.suffixes[n%18]}`;
}
function selectedTitle() { return `${state.kind==='name' ? selectedName()+' ' : ''}${state.data.species[state.sid-1].name}`; }
// Name Song is optional: load its metadata only when selected. Failure resets
// this promise so Play can retry while the 600 baseline choices remain usable.
let namesLoading;
function ensureNames() {
  if(!namesLoading) namesLoading=(async()=>{
    const response=await fetch('names/manifest.json');
    if(!response.ok)throw new Error('Could not load Name Song manifest');
    const manifest=await response.json();
    state.namesManifest=manifest;state.names=new NameSongs(manifest);
    for(const [id,values] of [['name-prefix',manifest.prefixes],['name-suffix',manifest.suffixes]]) {
      const control=$(id);control.replaceChildren();
      values.forEach((value,i)=>{const option=document.createElement('option');option.value=i+1;option.textContent=value;control.append(option)});
      control.disabled=false;
    }
  })().catch(error=>{namesLoading=null;throw error});
  return namesLoading;
}

function status(text) { $('status').textContent = text; }
function render() {
  const s = state.current || {sid:state.sid};
  $('name').textContent = selectedTitle();
  $('number').textContent = `ORIGINAL ${String(s.sid).padStart(2, '0')} / 75`;
  $('details').textContent = !state.current ? (state.composing ? 'Composing on your device…' : 'Name Song unavailable · Tap Play to retry') : `${s.key} · ${(60000000 / s.tempoUs).toFixed(1).replace(/\.0$/, '')} BPM · ${clock(s.seconds)}`;
  const mode = state.kind==='name' ? state.namesManifest : state.manifest.modes[state.kind];
  const authored = state.kind === 'song' && mode.overrides?.find(x=>x.sid===s.sid);
  $('source').textContent = state.kind === 'name' ? (mode ? `Production Name Songs · ${mode.revision.slice(0,7)} · 1,242 official names · Composed locally` : state.composing ? 'Loading Name Song names…' : 'Name Song unavailable · Tap Play to retry; Species Song and Sound Check remain available') : state.kind === 'check' ? `Sound Check candidates · ${mode.sourceRevision.slice(0,7)} · 300 / 300 ready · Listening approval pending` : authored ? `Satori · Original lab 411 · ${authored.sourceRevision.slice(0,7)} · 4 / 4 ready` : `Casey upstream Species Songs · ${mode.sourceRevision.slice(0,7)} · Satori uses original 411 · 300 / 300 ready`;
  $('mode-note').textContent = s.fixedReference || (state.kind==='name' ? 'Canonical species theme · Official name’s key and style · No time drift' : state.kind === 'check' ? 'Proposed warm-up · No chip echo · Pending listening approval' : 'Casey Species Song · No time drift');
  $('what').textContent = state.kind==='name' ? 'Name Songs use the production NamedSong recipe: the species’ theme in the official name’s key and style. Some names share the Species Song’s notes. Satori’s Agony Bane uses the derived C-Aeolian arrangement; Yeti keeps its special arrangement. Harpy and Pegasus use their own species here. The regular artwork stays the same.' : state.kind === 'check' ? 'Sound Check candidates use the implemented launch scores. Cyclops is species 64 within this same set of 75. Its four distinct performances retain the whole eight-sound original 504 sequence; Written is the exact 175 BPM reference. Checks have no chip echo.' : 'Satori uses the selected original lab411 Species Song with full Mega and Echo performances. The other74 Species Songs retain Casey’s upstream performances. All play without time drift; the regular artwork stays the same. Harpy and Pegasus use their official shared-song swap.';
  // Keep the previous roll model private while its replacement is pending or
  // unavailable; setMidi restores all note metadata when composition succeeds.
  const panel=$('midi-panel');panel.dataset.pending=String(!state.current);
  panel.setAttribute('aria-busy',String(!state.current&&state.composing));
  if(!state.current) {
    panel.querySelector('h2').textContent=`${selectedTitle()} · ${title()} · MIDI`;
    panel.querySelector('.midi-caption').textContent=state.composing ? 'Composing Name Song…' : 'Name Song unavailable. Tap Play to retry.';
  }
  $('name-controls').hidden=state.kind!=='name';
  $('name-prefix').value=Math.floor((state.nameVariant-1)/18)+1;
  $('name-suffix').value=(state.nameVariant-1)%18+1;
  document.querySelectorAll('[data-kind]').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.kind === state.kind)));
  document.querySelectorAll('.presets [data-fx] span').forEach((span,fx)=>span.textContent=labels()[fx]);
  document.querySelectorAll('.species-row [data-fx]').forEach(button=>button.setAttribute('aria-label',`${state.data.species[+button.dataset.sid-1].name}, ${title()}, preset ${button.dataset.fx}, ${labels(+button.dataset.sid)[+button.dataset.fx]}`));
  const headers = state.kind === 'check' ? ['SPECIES','0 · Written','1 · Mega','2 · Portato','3 · Accent'] : ['SPECIES','0 · Written','1 · Mega','2 · Echo','3 · Both'];
  document.querySelectorAll('#column-head span').forEach((span,i)=>span.textContent=headers[i]);
  document.querySelectorAll('[data-fx]').forEach(button => {
    const sid = button.dataset.sid ? +button.dataset.sid : state.sid;
    button.setAttribute('aria-pressed', String(sid === state.sid && +button.dataset.fx === state.fx));
  });
  document.querySelectorAll('.species-row').forEach(row => row.classList.toggle('active', +row.dataset.sid === state.sid));
  $('play').textContent = state.status === 'playing' ? 'Pause' : state.status === 'paused' ? 'Resume' : 'Play';
  history.replaceState(null, '', state.kind==='name' ? `#name-${state.sid}-${state.fx}-${state.nameVariant}` : state.kind === 'check' ? `#check-${state.sid}-${state.fx}` : `#${state.sid}-${state.fx}`);
}
function stop() {
  ++state.serial;
  state.synth?.stopMIDI();
  state.status = 'stopped';
  timing.reset();
  state.playbackStart = null; roll.setTick(0, false);
  status('Stopped');
  $('progress').style.width = '0%'; $('time').textContent = '0:00';
  render();
}
function prepareAudio() {
  // This is deliberately synchronous within click/change/key handlers, even
  // before the worker is ready. A first-ever Name Song needs only one gesture.
  const sample=state.current || state.lookup.get('check-1-0'), s=settings(sample);
  if (!state.synth) state.synth=createSynth(window.WebAudioTinySynth,s);
  state.synth.stopMIDI();
  return state.synth.resume();
}
function playSelected() {
  const request=++state.serial;
  try {
    const resumed=prepareAudio();
    state.status='starting';timing.reset();timing.changed();status(state.composing?'Composing…':'Starting…');render();
    Promise.all([resumed,state.ready]).then(([,sample])=>{
      if(request!==state.serial)return;
      const synth=state.synth,s=settings(sample);
      installSettings(synth,s);synth.setMasterVol(s.master_vol/100*state.volume);synth.prewarm();
      synth.loadMIDI(bytes(sample.midi_b64));
      synth.setLoop(1);synth.setLoopEnd(synth.getPlayStatus().maxTick);synth.playMIDI();
      state.playbackStart=synth.getPlayStatus().startTime;
      state.status='playing';timing.started();status(`${sample.fx} · ${labels()[sample.fx]} · Playing`);render();
    }).catch(error=>failed(error,request));
  }catch(error){failed(error,request)}
}
function failed(error, request) {
  if (request !== state.serial) return;
  state.status = 'stopped'; state.synth?.stopMIDI(); timing.reset(); render();
  state.playbackStart = null; roll.setTick(0, false);
  status(state.kind==='name'&&!state.current ? `Name Song unavailable: ${error.message || error}. Tap Play to retry.` : `Tap Play to start audio: ${error.message || error}`);
}
function select(sid, fx, play = true, kind = state.kind, nameVariant=state.nameVariant) {
  if(!state.data)return;
  const selection=++state.selection;
  ++state.serial;state.synth?.stopMIDI();state.status='stopped';timing.reset();
  state.kind=kind;state.sid=sid;state.fx=fx;state.nameVariant=nameVariant;state.current=null;state.playbackStart=null;
  state.composing=kind==='name';
  $('progress').style.width='0%';$('time').textContent='0:00';
  function apply(sample) {
    if(selection!==state.selection)return sample;
    state.current=sample;state.composing=false;$('midi-panel').setAttribute('aria-busy','false');
    state.midi=roll.setMidi(bytes(sample.midi_b64),`${sample.name} · ${title()} · ${labels()[fx]}`);
    mountArt();
    if(state.status==='stopped')status(`${fx} · ${labels()[fx]} · Ready`);
    render();return sample;
  }
  if(kind==='name') {
    mountArt();roll.setTick(0,false);status('Composing…');render();
    state.ready=ensureNames().then(()=>{if(selection===state.selection)render();return state.names.compose(sid,fx,nameVariant)}).then(result=>{
      const midi=result.midi,model=parseMidi(midi);
      let tempoUs=500000;
      for(let i=0;i<midi.length-5;i++)if(midi[i]===255&&midi[i+1]===81&&midi[i+2]===3){tempoUs=midi[i+3]*65536+midi[i+4]*256+midi[i+5];break}
      let text='';for(let i=0;i<midi.length;i+=8192)text+=String.fromCharCode(...midi.subarray(i,i+8192));
      return apply({kind:'name',sid,fx,nameVariant,name:`${state.namesManifest.prefixes[Math.floor((nameVariant-1)/18)]} ${state.namesManifest.suffixes[(nameVariant-1)%18]} ${state.data.species[sid-1].name}`,key:result.info.key,tempoUs,seconds:model.duration,midi_b64:btoa(text),settingsKey:result.settingsKey,settingsText:result.settings});
    });
    state.ready.catch(error=>{
      if(selection!==state.selection)return;
      state.composing=false;$('midi-panel').setAttribute('aria-busy','false');
      if(state.status!=='starting'){status(`Name Song unavailable: ${error.message}. Tap Play to retry.`);render()}
    });
  }else {
    const sample=state.lookup.get(`${kind}-${sid}-${fx}`);if(!sample)throw new Error('Missing sample selection');
    apply(sample);state.ready=Promise.resolve(sample);
  }
  if(play)playSelected();
}
function toggle() {
  if (state.status === 'playing') {
    const request = ++state.serial;
    state.status = 'paused'; timing.changed(); status('Paused'); render();
    state.synth.getAudioContext().suspend().catch(e => failed(e, request));
  } else if (state.status === 'paused') {
    const request = ++state.serial;
    Promise.resolve(state.synth.resume()).then(() => {
      if (request !== state.serial) return;
      state.status = 'playing'; timing.changed(); status(`${state.fx} · ${labels()[state.fx]} · Playing`); render();
    }).catch(e => failed(e, request));
  } else if(state.kind==='name'&&!state.current&&!state.composing)select(state.sid,state.fx,true);
  else playSelected();
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
  function changeName(){select(state.sid,state.fx,true,'name',(+ $('name-prefix').value-1)*18+ +$('name-suffix').value)}
  $('name-prefix').onchange=changeName;$('name-suffix').onchange=changeName;
  $('previous').onclick = () => select((state.sid + 73) % 75 + 1, state.fx);
  $('next').onclick = () => select(state.sid % 75 + 1, state.fx);
  $('stop').onclick = stop; $('play').onclick = toggle; $('search').oninput = filter;
  $('volume').oninput = () => { state.volume = +$('volume').value / 100; if (state.synth && state.current) state.synth.setMasterVol(settings(state.current).master_vol / 100 * state.volume); };
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
    const named=/^#name-(\d+)-([0-3])-(\d+)$/.exec(location.hash);
    if(named&&+named[1]>=1&&+named[1]<=75&&+named[3]>=1&&+named[3]<=1242)return {kind:'name',sid:+named[1],fx:+named[2],nameVariant:+named[3]};
    const match = /^#(?:(song|check)-)?(\d+)-([0-3])$/.exec(location.hash);
    return match && +match[2]>=1 && +match[2]<=75 ? {kind:match[1] || 'song',sid:+match[2],fx:+match[3]} : {kind:'check',sid:1,fx:0};
  }
  const initial = fromHash(); select(initial.sid,initial.fx,false,initial.kind,initial.nameVariant||1);
  window.addEventListener('hashchange',()=>{const x=fromHash();if(x.kind!==state.kind || x.sid!==state.sid || x.fx!==state.fx || x.kind==='name'&&x.nameVariant!==state.nameVariant)select(x.sid,x.fx,false,x.kind,x.nameVariant||state.nameVariant);else render();});
  let lastFrame = 0;
  function animate(now) {
    requestAnimationFrame(animate);
    if (now - lastFrame < 33 || !state.synth || !['playing','paused'].includes(state.status) || state.playbackStart == null) return;
    lastFrame = now;
    const elapsed = timing.getPlayStatus().positionSeconds ?? 0;
    const seconds = elapsed % state.midi.duration, tick = state.midi.secondsToTick(seconds);
    roll.setTick(tick, state.status === 'playing');
    $('progress').style.width = `${seconds / state.midi.duration * 100}%`; $('time').textContent = clock(seconds);
  }
  requestAnimationFrame(animate);
} catch (error) {
  status(error.message); $('source').textContent = 'Samples unavailable'; $('details').textContent = 'Reload to try again.';
}
window.addEventListener('pagehide', () => { ++state.serial; ++state.selection; state.names?.dispose(); artSync?.dispose(); artControls?.(); timing.dispose(); state.synth?.stopMIDI(); state.synth?.getAudioContext()?.close(); });
