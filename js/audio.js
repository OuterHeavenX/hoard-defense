/* Synthesised sound effects. Everything is generated with oscillators and
   noise buffers, so the repo carries no audio files and nothing has to load.

   The throttling matters as much as the synthesis here: a busy late-stage
   frame kills dozens of enemies, and one voice per kill would both clip the
   output and tank the frame. Each cue has a minimum interval, and a global
   voice cap drops anything over budget. */
'use strict';

class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.volume = 0.6;
    this.voices = 0;
    this.lastPlayed = {};
    this.maxVoices = 18;
    this.suspended = false;   // battle cues off while the title screen plays

    try {
      const saved = localStorage.getItem('hoard.audio');
      if (saved !== null) {
        const s = JSON.parse(saved);
        this.enabled = s.enabled !== false;
        this.volume = typeof s.volume === 'number' ? s.volume : 0.6;
      }
    } catch (e) { /* private mode - defaults are fine */ }
  }

  save() {
    try {
      localStorage.setItem('hoard.audio', JSON.stringify({ enabled: this.enabled, volume: this.volume }));
    } catch (e) { /* not worth failing a sound over */ }
  }

  /* Browsers only allow audio after a gesture, so this runs off the first click. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? this.volume : 0;
    this.master.connect(this.ctx.destination);

    // One shared noise buffer for every percussive cue.
    const len = this.ctx.sampleRate * 0.5;
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? this.volume : 0;
    this.save();
  }

  setVolume(v) {
    this.volume = clamp(v, 0, 1);
    if (this.master && this.enabled) this.master.gain.value = this.volume;
    this.save();
  }

  /* True when this cue is allowed to sound right now. */
  ready(key, minInterval) {
    if (!this.ctx || !this.enabled) return false;
    if (this.suspended && key !== 'click') return false;
    if (this.voices >= this.maxVoices) return false;
    const now = this.ctx.currentTime;
    const last = this.lastPlayed[key] || -1;
    if (now - last < minInterval) return false;
    this.lastPlayed[key] = now;
    return true;
  }

  track(node, duration) {
    this.voices++;
    node.onended = () => { this.voices--; };
    node.stop(this.ctx.currentTime + duration);
  }

  tone(o) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.sweepTo), t + o.dur);

    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(o.gain, t + Math.min(0.01, o.dur * 0.3));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);

    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t + (o.delay || 0));
    this.track(osc, o.dur + (o.delay || 0) + 0.02);
  }

  noise(o) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = o.filter || 'bandpass';
    filter.frequency.setValueAtTime(o.freq, t);
    if (o.sweepTo) filter.frequency.exponentialRampToValueAtTime(Math.max(1, o.sweepTo), t + o.dur);
    filter.Q.value = o.q || 1;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(o.gain, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start(t);
    this.track(src, o.dur + 0.02);
  }

  // ------------------------------------------------------------------ cues

  shoot() {
    if (!this.ready('shoot', 0.05)) return;
    this.tone({ freq: 720, sweepTo: 240, dur: 0.06, gain: 0.05, type: 'square' });
  }

  turretShoot() {
    if (!this.ready('turret', 0.07)) return;
    this.tone({ freq: 380, sweepTo: 150, dur: 0.08, gain: 0.045, type: 'sawtooth' });
  }

  gatling() {
    if (!this.ready('gatling', 0.05)) return;
    this.noise({ freq: 1400, sweepTo: 500, dur: 0.05, gain: 0.06, q: 1.2 });
    this.tone({ freq: 300, sweepTo: 140, dur: 0.045, gain: 0.03, type: 'square' });
  }

  hit() {
    if (!this.ready('hit', 0.045)) return;
    this.noise({ freq: 2200, sweepTo: 900, dur: 0.045, gain: 0.05, q: 1.4 });
  }

  kill() {
    if (!this.ready('kill', 0.06)) return;
    this.noise({ freq: 700, sweepTo: 180, dur: 0.11, gain: 0.07, q: 0.9 });
  }

  bruteKill() {
    if (!this.ready('bruteKill', 0.2)) return;
    this.noise({ freq: 320, sweepTo: 70, dur: 0.38, gain: 0.22, q: 0.7, filter: 'lowpass' });
    this.tone({ freq: 110, sweepTo: 42, dur: 0.34, gain: 0.16, type: 'triangle' });
  }

  coin() {
    if (!this.ready('coin', 0.055)) return;
    this.tone({ freq: 1180, dur: 0.05, gain: 0.05, type: 'triangle' });
    this.tone({ freq: 1760, dur: 0.06, gain: 0.035, type: 'triangle', delay: 0.035 });
  }

  deposit() {
    if (!this.ready('deposit', 0.08)) return;
    this.tone({ freq: 440 + Math.random() * 180, dur: 0.07, gain: 0.05, type: 'triangle' });
  }

  upgrade() {
    if (!this.ready('upgrade', 0.25)) return;
    [523, 659, 784, 1047].forEach((f, i) => {
      this.tone({ freq: f, dur: 0.16, gain: 0.1, type: 'triangle', delay: i * 0.055 });
    });
  }

  hurt() {
    if (!this.ready('hurt', 0.22)) return;
    this.tone({ freq: 210, sweepTo: 70, dur: 0.22, gain: 0.16, type: 'sawtooth' });
    this.noise({ freq: 500, sweepTo: 160, dur: 0.16, gain: 0.12, filter: 'lowpass' });
  }

  dash() {
    if (!this.ready('dash', 0.15)) return;
    this.noise({ freq: 400, sweepTo: 2600, dur: 0.2, gain: 0.09, q: 0.8 });
  }

  horde() {
    if (!this.ready('horde', 1)) return;
    this.tone({ freq: 150, sweepTo: 96, dur: 0.75, gain: 0.16, type: 'sawtooth' });
    this.tone({ freq: 226, sweepTo: 146, dur: 0.75, gain: 0.1, type: 'sawtooth', delay: 0.06 });
  }

  click() {
    if (!this.ready('click', 0.04)) return;
    this.tone({ freq: 880, dur: 0.04, gain: 0.07, type: 'square' });
  }

  victory() {
    if (!this.ready('end', 0.5)) return;
    [523, 659, 784, 1047, 1319].forEach((f, i) => {
      this.tone({ freq: f, dur: 0.5, gain: 0.13, type: 'triangle', delay: i * 0.12 });
    });
  }

  defeat() {
    if (!this.ready('end', 0.5)) return;
    [392, 330, 262, 196].forEach((f, i) => {
      this.tone({ freq: f, dur: 0.6, gain: 0.14, type: 'sawtooth', delay: i * 0.16 });
    });
  }
}
