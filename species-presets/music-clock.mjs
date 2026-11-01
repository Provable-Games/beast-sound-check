// Audible clock and pass notifications adapted from onchain-midi-player/player/player.js
// at 38e21a1d67b4e39103341ad8f6f961ac36d5ef7a (Apache-2.0).
// The lab owns transport and its persistent synth; this observes that transport only.
// See art-sync-source.json and onchain-midi-player-LICENSE.txt.
export function musicClock(state, host = window) {
  let runId = 0, origin = null, heldPosition = null, latencySeconds = 0, latencyRevision = 0;
  let nextPass = 0, timer = 0, poll = 0, latencyPoll = 0, context = null;
  const passes = new Set(), states = new Set();
  const number = x => typeof x === 'number' && Number.isFinite(x) ? x : null;
  const audio = () => state.synth?.getAudioContext();
  const component = x => number(x) !== null && x >= 0 && x <= 1 ? x : 0;
  const estimateLatency = () => component(audio()?.outputLatency) + component(audio()?.baseLatency);
  const position = () => {
    if (origin === null) { heldPosition = null; return null; }
    const ctx = audio(), audible = Math.max(0, (number(ctx?.currentTime) ?? origin) - origin - latencySeconds);
    if (ctx?.state === 'running') { heldPosition = null; return audible; }
    return heldPosition ??= audible;
  };
  const snapshot = () => {
    const s = state.synth?.getPlayStatus();
    return { state:state.status, tick:number(s?.curTick), maxTick:number(s?.maxTick) ?? number(state.midi?.endTick),
      startTime:number(s?.startTime), originTime:origin, audioTime:number(audio()?.currentTime),
      passSeconds:number(state.midi?.duration), outputLatency:component(audio()?.outputLatency),
      baseLatency:component(audio()?.baseLatency), latencySeconds, latencyRevision,
      audioState:audio()?.state ?? null, positionSeconds:position(), runId, error:null };
  };
  const notify = () => { for (const fn of [...states]) if (states.has(fn)) fn(snapshot()); };
  const clearBoundary = () => { host.clearTimeout(timer); timer = 0; };
  const cancel = () => {
    clearBoundary(); host.clearInterval(poll); host.clearInterval(latencyPoll); poll = latencyPoll = 0;
  };
  const boundary = () => {
    const ctx = audio(), current = runId;
    if (origin === null || state.status !== 'playing' || ctx?.state !== 'running' || timer) return;
    const latest = number(state.synth.getPlayStatus().startTime), seconds = state.midi.duration;
    // Preserve the pending boundary across pause; skip missed later passes in O(1).
    if (nextPass > 0) nextPass = Math.max(nextPass, Math.ceil((ctx.currentTime - latencySeconds - origin - 1e-6) / seconds));
    const index = nextPass, start = origin + index * seconds;
    if (latest === null || start > latest + 1e-6) return;
    const delay = start + latencySeconds - ctx.currentTime;
    if (delay * 1000 > 2147483647) return;
    const dispatch = () => {
      timer = 0;
      if (current !== runId || state.status !== 'playing' || ctx.state !== 'running') return;
      const audibleTime = start + latencySeconds, remaining = audibleTime - ctx.currentTime;
      if (remaining > .001) { timer = host.setTimeout(dispatch, Math.min(2147483647, remaining * 1000)); return; }
      ++nextPass;
      if (!index || remaining > -.05) {
        const event = { runId:current, passIndex:index, initial:!index, startTime:start, audibleTime,
          audioTime:number(ctx.currentTime), outputLatency:component(ctx.outputLatency), baseLatency:component(ctx.baseLatency), latencySeconds };
        for (const fn of [...passes]) {
          if (current !== runId || state.status !== 'playing') break;
          if (passes.has(fn)) fn({ ...event });
        }
      }
      boundary();
    };
    timer = host.setTimeout(dispatch, Math.max(0, delay * 1000));
  };
  const refreshLatency = () => {
    const value = estimateLatency();
    if (Math.abs(value - latencySeconds) < .002 - 1e-9) return;
    position(); latencySeconds = value; ++latencyRevision;
    clearBoundary(); notify(); boundary();
  };
  const changed = () => {
    position(); refreshLatency();
    if (audio()?.state !== 'running' || state.status !== 'playing') clearBoundary();
    notify(); boundary();
  };
  const subscribe = (set, fn) => { set.add(fn); return () => set.delete(fn); };
  return {
    getPlayStatus:snapshot,
    onPassStart:fn => subscribe(passes, fn),
    onStateChange:fn => subscribe(states, fn),
    changed,
    reset() { cancel(); ++runId; origin = null; heldPosition = null; nextPass = 0; notify(); },
    started() {
      cancel(); origin = number(state.playbackStart); heldPosition = null; nextPass = 0;
      latencySeconds = estimateLatency(); ++latencyRevision;
      if (context !== audio()) {
        context?.removeEventListener('statechange', changed); context = audio();
        context?.addEventListener('statechange', changed);
      }
      notify(); boundary();
      poll = host.setInterval(boundary, 50); latencyPoll = host.setInterval(refreshLatency, 250);
    },
    dispose() { cancel(); context?.removeEventListener('statechange', changed); passes.clear(); states.clear(); },
  };
}
