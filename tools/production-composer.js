// Adapter for the pinned midi_fun_contract reference modules. Musical algorithms stay upstream;
// this resolves the manager's purchased-song shape and performance before those algorithms run.
export function createProductionComposer({ E, L, V, F, ED, species }) {
  const FIELD = (1n << 251n) + 17n * (1n << 192n) + 1n;
  function normalize(x) {
    const integer = (v, lo, hi, label) => {
      const n = Number(v);
      if (!Number.isSafeInteger(n) || n < lo || n > hi) throw new Error('Invalid ' + label);
      return n;
    };
    const sid = integer(x.sid, 1, 75, 'species');
    if (!['check', 'species', 'name', 'purchase', 'edition'].includes(x.kind)) throw new Error('Invalid track type');
    const fx = integer(x.fx, 0, 3, 'sound effects');
    const name = x.kind === 'species' ? 0 : integer(x.name ?? 0, 0, 1242, 'special name');
    const edition = x.kind === 'edition' ? integer(x.edition, 1, 4294967295, 'edition') : 0;
    const text = String(x.seed ?? '1').trim();
    if (!/^(?:[0-9]+|0x[0-9a-f]+)$/i.test(text)) throw new Error('Seed must be a decimal or hexadecimal integer');
    const seed = x.kind === 'purchase' || x.kind === 'edition' ? BigInt(text) : 0n;
    if (seed < 0n || seed >= FIELD) throw new Error('Seed must fit a Starknet felt');
    return { sid, kind: x.kind, fx, name, edition, seed: seed.toString() };
  }
  function beast(id, name, mega) {
    return { id, ...L.nameFromVariant(name), level: 50, health: 200, shiny: +mega, animated: 0, tier: L.speciesTier(id), beast_type: L.speciesType(id) };
  }
  // Like genesis.cairo::song_pick, including purchases that remove a canon voice or countersubject.
  function pickChannels(r, count, seed) {
    const p = r.params, stats = {};
    for (const e of r.form.events) {
      const s = stats[e.voice_id] ||= { sum: 0, n: 0 }; s.sum += e.pitch; s.n++;
    }
    const canon = Object.keys(stats).map(Number).filter(v => v < p.voice_count).sort((a, b) => a - b);
    const low = canon.reduce((a, b) => stats[b].sum * stats[a].n < stats[a].sum * stats[b].n ? b : a);
    let rest = canon.filter(v => v !== 0 && v !== low);
    if (seed === null) rest = ['drums', ...(p.use_countersubject ? [p.voice_count] : []), ...rest];
    else {
      if (p.use_countersubject) rest.push(p.voice_count);
      rest.push('drums');
      for (let i = rest.length - 1, h = L.H('BEAST_CHANNEL_ORDER', seed); i > 0; i--, h /= 7n) {
        const j = Number(h % BigInt(i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]];
      }
    }
    return [...new Set([0, low]), ...rest].slice(0, count);
  }
  function song(x, id, name, purchased) {
    const seed = purchased ? BigInt(x.seed) : null, mega = !!(x.fx & 1);
    const b = beast(id, name, mega);
    let resolved;
    // Capture the lab's canonical theme/key/treatment options before its legacy channel filter.
    const stop = {};
    try {
      L.sampleTrackMidi(b, { species_count: 1 }, { ...L.GENESIS_DEFAULTS, name, seed: seed ?? 0n }, E, {
        render(cb, live, opts) { resolved = { cb, live, opts }; throw stop; },
      });
    } catch (e) { if (e !== stop) throw e; }
    const { cb, live, opts } = resolved;
    if (purchased && seed === 0n) {
      const t = L.trackTreatment(seed);
      Object.assign(opts.override, { sections: t.sections, rhythmSeed: t.rhythmSeed, flipSide: t.flipSide, tr: { ...opts.override.tr, development: t.development, direction: t.direction, spacing: t.spacing } });
    }
    const base = V.render(cb, live, opts);
    const p = { ...base.params }, tr = { ...base.v11.trajectory };
    if (purchased) {
      const shape = Number(L.H('BEAST_SAMPLE_SHAPE_V1', seed) % 512n);
      p.stretto_lag = 1 + (p.stretto_lag - 1 + shape % 4) % 4;
      p.use_inversion = p.use_inversion !== !!(shape & 4);
      p.ornament_density = (p.ornament_density + (shape >> 3) % 8) % 8;
      tr.trill = tr.trill !== !!(shape & 64);
      if (p.voice_count > 2) p.voice_count -= (shape >> 7) % 2;
      p.use_countersubject = p.use_countersubject && !(shape & 256);
    }
    const faster = [0, 25000, 30000, 45000][x.fx];
    p.tempo_us = Math.max(1, p.tempo_us - faster);
    p.velocity_ceiling = Math.min(127, p.velocity_ceiling + [0, 12, 8, 15][x.fx]);
    if (x.fx) p.articulation_profile = [0, 2, 5, 3][x.fx];
    let r = V.render(cb, live, { ...opts, override: { ...opts.override, params: p, voice_count: p.voice_count, tempo_us: p.tempo_us, tr } });
    const count = Math.min(L.channelCount(seed, b.tier), p.voice_count + +p.use_countersubject + 1);
    const playing = pickChannels(r, count, seed);
    r = { ...r, beast: b, form: { ...r.form, events: r.form.events.filter(e => playing.includes(e.voice_id)) } };
    r = { ...r, form: L.tieRepeats(r.form, 'weak').form };
    let drums = playing.includes('drums') ? null : false, extra = {};
    if (id === 68) {
      const ys = { ...r, yetiScale: opts.override.scale || null };
      let events = L.yetiOrnaments(r.form.events.map(e => ({ ...e })), ys, b, E, false, true);
      events = L.yetiAvalanche(events, ys, E, L.YETI_AVALANCHE_VOICE);
      events.sort((a, c) => a.voice_id - c.voice_id || a.time - c.time);
      r = { ...r, form: { ...r.form, events } };
      if (drums !== false) drums = L.rockDrums;
      extra = { programs: { [L.YETI_AVALANCHE_VOICE]: 13 }, notLead: [L.YETI_AVALANCHE_VOICE] };
    }
    const midi = F.beastFullMidi(r, E.formLength, { ...(mega ? F.MEGA_ALL : {}), echo: x.fx >= 2 }, { instruments: 'beast', drums, mix: 'balanced', topLead: true, ...extra });
    return { midi, info: { key: L.keyName(r.params), channels: playing.length }, settingsKey: `song-${L.speciesType(id)}-${+mega}-${+(id === 68)}` };
  }
  function compose(input) {
    const x = normalize(input), mega = !!(x.fx & 1);
    if (x.kind === 'edition') {
      const result = ED.editionMidi(species[x.sid - 1], mega, x.edition, BigInt(x.seed) & 0xffffffffffffffffn, null, x.fx >= 2);
      return { ...result, input: x, settingsKey: `edition-${(x.edition - 1) % ED.STYLES.length}-${L.speciesType(x.sid)}-${+mega}` };
    }
    if (x.kind === 'check') {
      const result = L.soundCheckMidi(beast(x.sid, x.name, mega), E);
      return { ...result, midi: performCheck(result.midi, x.fx), input: x, settingsKey: `song-${L.speciesType(x.sid)}-${+mega}-0` };
    }
    const id = x.kind === 'species' ? L.GENESIS_SWAPS[x.sid] || x.sid : x.sid;
    return { ...song(x, id, x.name, x.kind === 'purchase'), input: x };
  }
  return { compose, normalize };
}

// Sound Check performance changes durations/accents and tempo, preserving the upstream SMF's
// event encoding (including running status). Its notes do not overlap within each channel.
function performCheck(midi, fx) {
  if (!fx) return midi;
  const bytes = Array.from(midi), out = bytes.slice(0, 14);
  const vlq = n => { const b = [n & 127]; while ((n = Math.floor(n / 128))) b.unshift((n & 127) | 128); return b; };
  let at = 14;
  while (at < bytes.length) {
    const end = at + 8 + ((bytes[at + 4] * 0x1000000) + (bytes[at + 5] << 16) + (bytes[at + 6] << 8) + bytes[at + 7]);
    at += 8;
    let time = 0, status = 0; const events = [], ons = {};
    const read = () => { let n = 0, b; do { b = bytes[at++]; n = n * 128 + (b & 127); } while (b & 128); return n; };
    while (at < end) {
      time += read(); const start = at;
      const explicit = bytes[at] >= 128;
      if (explicit) status = bytes[at++];
      if (status === 255) {
        const type = bytes[at++], len = read(), payload = bytes.slice(at, at + len); at += len;
        if (type === 81) {
          const tempo = Math.max(1, payload[0] * 65536 + payload[1] * 256 + payload[2] - [0, 25000, 30000, 45000][fx]);
          events.push({ time, data: [255, 81, 3, tempo >> 16, (tempo >> 8) & 255, tempo & 255] });
        } else events.push({ time: type === 47 && Object.keys(ons).length ? events[events.length - 1].time : time, data: bytes.slice(start, at) });
      } else {
        const n = (status & 240) === 192 || (status & 240) === 208 ? 1 : 2;
        const originalTime = time, key = bytes[at], velocity = bytes[at + 1], type = status & 240, k = (status & 15) + ':' + key;
        at += n; const data = bytes.slice(start, at);
        if (type === 144 && velocity) {
          ons[k] = time;
          if (fx === 3 && time % 1920 === 0) data[data.length - 1] = Math.min(115, velocity + 8);
        } else if ((type === 128 || type === 144 && !velocity) && ons[k] !== undefined && fx === 2) {
          time = ons[k] + Math.max(60, Math.floor((time - ons[k]) * 3 / 4));
        }
        events.push({ time, data });
        // Deltas in the source remain relative to the original time, not the shortened note-off.
        time = originalTime;
      }
    }
    const body = []; let prev = 0;
    for (const e of events) { body.push(...vlq(e.time - prev), ...e.data); prev = e.time; }
    out.push(77, 84, 114, 107, (body.length >>> 24) & 255, (body.length >>> 16) & 255, (body.length >>> 8) & 255, body.length & 255, ...body);
  }
  return Uint8Array.from(out);
}
