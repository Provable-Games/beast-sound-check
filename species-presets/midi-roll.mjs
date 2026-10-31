// Read the actual SMF used by the player; no reconstructed score or audio analysis.
export function parseMidi(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at, length) => String.fromCharCode(...bytes.subarray(at, at + length));
  if (text(0, 4) !== 'MThd' || view.getUint16(8) > 1) throw new Error('Unsupported MIDI header');
  const ppq = view.getUint16(12), trackCount = view.getUint16(10);
  if (!ppq || ppq & 0x8000) throw new Error('Unsupported MIDI timing');
  const events = [], tempos = [{ tick:0, us:500000 }];
  let offset = 8 + view.getUint32(4), endTick = 0;
  for (let track = 0; track < trackCount; track++) {
    if (text(offset, 4) !== 'MTrk') throw new Error('Missing MIDI track');
    const end = offset + 8 + view.getUint32(offset + 4);
    let at = offset + 8, tick = 0, running = 0;
    const read = () => { if (at >= end || at >= bytes.length) throw new Error('Truncated MIDI event'); return bytes[at++]; };
    const variable = () => { let value = 0; for (let i = 0; i < 4; i++) { const b = read(); value = value * 128 + (b & 127); if (!(b & 128)) return value; } throw new Error('Invalid MIDI delta'); };
    while (at < end) {
      tick += variable(); endTick = Math.max(endTick, tick);
      let status = read();
      if (status < 128) { at--; status = running; if (!status) throw new Error('Missing MIDI status'); }
      if (status === 0xff) {
        const type = read(), length = variable();
        if (type === 0x51 && length === 3) tempos.push({ tick, us:read() * 65536 + read() * 256 + read() });
        else { for (let i = 0; i < length; i++) read(); }
        if (type === 0x2f) break;
      } else if (status === 0xf0 || status === 0xf7) {
        running = 0; const length = variable(); for (let i = 0; i < length; i++) read();
      } else {
        if (status >= 0xf0) throw new Error('Unsupported MIDI event');
        running = status;
        const type = status >> 4, a = read(), b = type === 0xc || type === 0xd ? 0 : read();
        events.push({ tick, track, channel:status & 15, type, a, b });
      }
    }
    offset = end;
  }
  events.sort((a,b) => a.tick - b.tick || a.track - b.track);
  const notes = [], open = new Map(), programs = Array(16).fill(0);
  for (const e of events) {
    const key = e.channel * 128 + e.a;
    if (e.type === 0xc) programs[e.channel] = e.a;
    else if (e.type === 9 && e.b) {
      const note = { start:e.tick, end:endTick, pitch:e.a, velocity:e.b, channel:e.channel, program:programs[e.channel] };
      notes.push(note); if (!open.has(key)) open.set(key, []); open.get(key).push(note);
    } else if (e.type === 8 || (e.type === 9 && !e.b)) {
      const queue = open.get(key); if (queue?.length) queue.shift().end = e.tick;
    }
  }
  tempos.sort((a,b) => a.tick - b.tick);
  let priorTick = 0, seconds = 0, us = 500000;
  const map = tempos.map(t => { seconds += (t.tick - priorTick) * us / ppq / 1e6; priorTick = t.tick; us = t.us; return { ...t, seconds }; });
  const tickToSeconds = tick => { let t = map[0]; for (const next of map) { if (next.tick > tick) break; t = next; } return t.seconds + (tick - t.tick) * t.us / ppq / 1e6; };
  const secondsToTick = seconds => { let t = map[0]; for (const next of map) { if (next.seconds > seconds) break; t = next; } return t.tick + (seconds - t.seconds) * ppq * 1e6 / t.us; };
  return { notes, ppq, endTick, duration:tickToSeconds(endTick), tickToSeconds, secondsToTick };
}

const palette = ['#d4e6a3','#84cfd1','#d8a0df','#efbc7c','#aab9f1','#e794a0','#9ed9b7','#d6ce7c'];
const pitchName = pitch => ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][pitch % 12] + (Math.floor(pitch / 12) - 1);
const drumNames = { 35:'Kick',36:'Kick',38:'Snare',40:'Snare',42:'Hat',46:'Open hat',49:'Crash' };

export class MidiRoll {
  constructor(root) {
    this.root = root; this.canvas = root.querySelector('canvas'); this.ctx = this.canvas.getContext('2d');
    this.legend = root.querySelector('.midi-legend'); this.caption = root.querySelector('.midi-caption');
    this.detail = root.querySelector('.midi-detail'); this.windowLabel = root.querySelector('.midi-window');
    this.mode = 'follow'; this.tick = 0; this.model = null;
    root.querySelectorAll('[data-roll]').forEach(button => button.addEventListener('click', () => {
      this.mode = button.dataset.roll;
      root.querySelectorAll('[data-roll]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
      this.draw();
    }));
    this.canvas.addEventListener('pointermove', event => {
      const box = this.canvas.getBoundingClientRect(), x = event.clientX - box.left, y = event.clientY - box.top;
      const hit = this.rects?.findLast(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
      this.detail.textContent = hit ? this.describe(hit.note) : 'Hover a note for pitch, velocity and length.';
    });
    this.canvas.addEventListener('pointerleave', () => { this.detail.textContent = 'Hover a note for pitch, velocity and length.'; });
    new ResizeObserver(() => this.draw()).observe(this.canvas);
  }
  setMidi(bytes, label) {
    this.model = parseMidi(bytes); this.tick = 0; this.active = false;
    const melodic = this.model.notes.filter(n => n.channel !== 9), pitches = melodic.map(n => n.pitch);
    this.low = Math.max(0, Math.min(...pitches, 60) - 2); this.high = Math.min(127, Math.max(...pitches, 71) + 2);
    this.drums = [...new Set(this.model.notes.filter(n => n.channel === 9).map(n => n.pitch))].sort((a,b) => b-a);
    const groups = [...new Set(this.model.notes.map(n => this.group(n)))];
    this.colors = new Map(groups.map((key, i) => [key, key === 'drums' ? '#dcaa90' : palette[i % palette.length]]));
    this.legend.replaceChildren(...groups.map(key => {
      const span = document.createElement('span'), swatch = document.createElement('i'); swatch.style.background = this.colors.get(key);
      span.append(swatch, key === 'drums' ? 'Drums' : `Ch ${+key.split(':')[0] + 1} · P${key.split(':')[1]}`);
      span.title = key === 'drums' ? 'MIDI percussion, shown separately below the pitched notes' : 'MIDI channel (1-based) and synth program (0-based)';
      return span;
    }));
    this.caption.textContent = `${this.model.notes.length.toLocaleString()} notes · ${melodic.length ? `${pitchName(Math.min(...pitches))}–${pitchName(Math.max(...pitches))}` : 'Percussion'} · color by channel / program`;
    this.canvas.setAttribute('aria-label', `${label}. MIDI piano roll with ${this.model.notes.length} notes. ${this.caption.textContent}. Time runs left to right; higher notes appear higher.`);
    this.root.querySelector('h2').textContent = `${label} · MIDI`;
    this.detail.textContent = 'Hover a note for pitch, velocity and length.';
    this.draw();
    return this.model;
  }
  group(note) { return note.channel === 9 ? 'drums' : `${note.channel}:${note.program}`; }
  describe(n) { return `${n.channel === 9 ? `${drumNames[n.pitch] || 'Drum'} ${n.pitch}` : pitchName(n.pitch)} · Ch ${n.channel + 1} · ${n.channel === 9 ? 'Drums' : `P${n.program}`} · velocity ${n.velocity} · ${+((n.end - n.start) / this.model.ppq).toFixed(2)} beats`; }
  setTick(tick, active) {
    if (!this.model) return;
    this.tick = Math.max(0, Math.min(this.model.endTick, tick)); this.active = active;
    this.canvas.dataset.tick = this.tick.toFixed(2);
    this.draw();
  }
  draw() {
    if (!this.model) return;
    const width = this.canvas.clientWidth;
    if (!width) return;
    const rowCount = this.high - this.low + 1;
    const pitchHeight = Math.max(200, Math.min(330, rowCount * 7));
    const drumHeight = this.drums.length * 13, height = 30 + pitchHeight + (drumHeight ? 15 + drumHeight : 0) + 12;
    const dpr = window.devicePixelRatio || 1;
    if (this.canvas.width !== Math.round(width * dpr) || this.canvas.height !== Math.round(height * dpr)) {
      this.canvas.width = Math.round(width * dpr); this.canvas.height = Math.round(height * dpr); this.canvas.style.height = `${height}px`;
    }
    const c = this.ctx; c.setTransform(dpr,0,0,dpr,0,0); c.clearRect(0,0,width,height);
    const left = 45, top = 27, plotWidth = width - left - 10, m = this.model, rowHeight = pitchHeight / rowCount;
    const span = this.mode === 'full' ? m.endTick : Math.min(m.endTick, m.ppq * (width < 500 ? 8 : 16));
    const start = this.mode === 'full' ? 0 : Math.floor(this.tick / span) * span;
    const end = Math.min(m.endTick, start + span), xOf = tick => left + (tick - start) / span * plotWidth;
    this.windowLabel.textContent = this.mode === 'full' ? 'Full track' : `Beats ${Math.floor(start / m.ppq) + 1}–${Math.ceil(end / m.ppq)}`;
    c.font = '9px ui-monospace, monospace'; c.textBaseline = 'middle';
    for (let pitch = this.low; pitch <= this.high; pitch++) {
      const y = top + (this.high - pitch) * rowHeight, black = [1,3,6,8,10].includes(pitch % 12);
      c.fillStyle = black ? '#161e18' : '#202a21'; c.fillRect(left,y,plotWidth,rowHeight);
      c.fillStyle = black ? '#263128' : '#424f3d'; c.fillRect(0,y,left-5,rowHeight-.5);
      if (pitch % 12 === 0 || rowHeight >= 11) { c.fillStyle = '#bec9b2'; c.textAlign = 'right'; c.fillText(pitchName(pitch),left-9,y+rowHeight/2); }
    }
    const step = this.mode === 'full' ? Math.max(1, Math.ceil(m.endTick / m.ppq / (plotWidth / 45))) : 1;
    for (let beat = Math.ceil(start / m.ppq / step) * step; beat * m.ppq <= end; beat += step) {
      const x = xOf(beat * m.ppq); c.strokeStyle = beat % 4 === 0 ? '#47553e' : '#2e3a2d';
      c.beginPath(); c.moveTo(x,top); c.lineTo(x,height-10); c.stroke();
      c.fillStyle = '#9eae94'; c.textAlign = 'left'; c.fillText(String(beat+1),x+3,13);
    }
    const drumTop = top + pitchHeight + 15;
    this.drums.forEach((pitch,i) => { const y = drumTop + i*13; c.fillStyle = i%2 ? '#1a221b' : '#222a20'; c.fillRect(left,y,plotWidth,12); c.fillStyle = '#b2a99a'; c.textAlign = 'right'; c.fillText(drumNames[pitch] || String(pitch),left-7,y+6); });
    this.rects = [];
    for (const note of m.notes) {
      if (note.end < start || note.start > end) continue;
      const drum = note.channel === 9;
      const x = xOf(Math.max(start,note.start)), y = drum ? drumTop + this.drums.indexOf(note.pitch)*13+2 : top + (this.high-note.pitch)*rowHeight+1;
      const w = Math.min(width-10-x, Math.max(2,xOf(Math.min(end,note.end))-x)), h = drum ? 9 : Math.max(2,rowHeight-1.5);
      const sounding = this.active && note.start <= this.tick && note.end > this.tick;
      c.globalAlpha = sounding ? 1 : .4 + note.velocity / 127 * .5;
      c.fillStyle = this.colors.get(this.group(note)); c.fillRect(x,y,w,h); c.globalAlpha = 1;
      if (sounding) { c.strokeStyle = '#ffffff'; c.strokeRect(x-.5,y-.5,w+1,h+1); }
      this.rects.push({ x,y,w,h,note });
    }
    const cursor = Math.max(left, Math.min(width-10,xOf(this.tick)));
    c.strokeStyle = '#f6f8d9'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(cursor,top-7); c.lineTo(cursor,height-10); c.stroke(); c.lineWidth = 1;
    c.fillStyle = '#f6f8d9'; c.beginPath(); c.moveTo(cursor-4,top-8); c.lineTo(cursor+4,top-8); c.lineTo(cursor,top-3); c.fill();
  }
}
