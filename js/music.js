/* Synthesised music. A lookahead scheduler walks a 16-step bar and lays
   notes onto the shared AudioContext a fraction ahead of time, which is
   what keeps the beat steady when a heavy frame lands.

   Intensity (0..1) is fed in from the simulation each frame: tempo rises
   with it and layers switch on as the hoard grows, so the music tells you
   how bad things are getting before the screen does. */
'use strict';

const MUSIC_LOOKAHEAD = 0.14;     // seconds scheduled ahead of the clock
const MUSIC_TICK = 30;            // ms between scheduler passes

/* Root notes for a four-bar minor progression, then a pentatonic ladder
   above each for the arpeggio. */
const MUSIC_ROOTS = [110.00, 87.31, 130.81, 98.00];        // A2 F2 C3 G2
const MUSIC_LADDER = [1, 1.2, 1.5, 1.782, 2, 2.4, 3];        // minor pentatonic ratios

class Music {
  constructor(audio) {
    this.audio = audio;
    this.enabled = true;
    this.volume = 0.5;
    this.mode = 'title';
    this.intensity = 0;
    this.ducked = false;
    this.timer = null;
    this.step = 0;
    this.bar = 0;
    this.nextTime = 0;
    this.arpIndex = 0;
    this.gain = null;

    try {
      const saved = JSON.parse(localStorage.getItem('hoard.music') || 'null');
      if (saved) {
        this.enabled = saved.enabled !== false;
        this.volume = typeof saved.volume === 'number' ? saved.volume : 0.5;
      }
    } catch (e) { /* defaults are fine */ }
  }

  save() {
    try { localStorage.setItem('hoard.music', JSON.stringify({ enabled: this.enabled, volume: this.volume })); }
    catch (e) { /* ignore */ }
  }

  get ctx() { return this.audio.ctx; }

  ensureGain() {
    if (this.gain || !this.ctx) return;
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(this.ctx.destination);
  }

  targetGain() {
    if (!this.enabled) return 0;
    return this.volume * (this.ducked ? 0.28 : 1);
  }

  refreshGain() {
    if (!this.gain) return;
    this.gain.gain.setTargetAtTime(this.targetGain(), this.ctx.currentTime, 0.12);
  }

  setEnabled(on) { this.enabled = on; this.save(); this.refreshGain(); }
  setVolume(v) { this.volume = clamp(v, 0, 1); this.save(); this.refreshGain(); }
  setDucked(d) { if (this.ducked !== d) { this.ducked = d; this.refreshGain(); } }

  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.step = 0;
    this.bar = 0;
  }

  /* Needs an unlocked AudioContext - call after the first gesture. */
  start() {
    if (this.timer || !this.ctx) return;
    this.ensureGain();
    this.nextTime = this.ctx.currentTime + 0.05;
    this.refreshGain();
    this.timer = setInterval(() => this.schedule(), MUSIC_TICK);
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    if (this.gain) this.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
  }

  bpm() {
    if (this.mode === 'title') return 88;
    return 112 + this.intensity * 46;
  }

  schedule() {
    const ctx = this.ctx;
    while (this.nextTime < ctx.currentTime + MUSIC_LOOKAHEAD) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += 60 / this.bpm() / 4;      // one sixteenth
      this.step = (this.step + 1) % 16;
      if (this.step === 0) this.bar = (this.bar + 1) % MUSIC_ROOTS.length;
    }
  }

  playStep(step, t) {
    const root = MUSIC_ROOTS[this.bar];
    const heat = this.intensity;

    if (this.mode === 'title') {
      // Sparse and low: a drone on the downbeat, a lone arp note every other beat.
      if (step === 0) this.note(t, root, 1.9, 'triangle', 0.16);
      if (step % 8 === 4) this.note(t, root * MUSIC_LADDER[(this.bar * 2 + 3) % MUSIC_LADDER.length] * 2, 0.5, 'sine', 0.05);
      return;
    }

    // Kick on the beat, doubled up when things get hot.
    if (step % 4 === 0 || (heat > 0.6 && step === 10)) this.kick(t);

    // Hats on the offbeats once the crowd is real.
    if (heat > 0.22 && step % 2 === 1) this.hat(t, heat > 0.7 && step % 4 === 3 ? 0.07 : 0.04);

    // Bass walks eighths on the root, dropping the fifth in on the back half.
    if (step % 2 === 0) {
      const freq = step >= 8 && step % 4 === 2 ? root * 1.5 : root;
      this.note(t, freq, 0.16, 'sawtooth', 0.11, 320 + heat * 900);
    }

    // Arpeggio climbs the ladder; a second octave stacks on top when intense.
    if (heat > 0.42 && step % 2 === 0) {
      this.arpIndex = (this.arpIndex + (step % 8 === 0 ? 2 : 1)) % MUSIC_LADDER.length;
      const freq = root * 2 * MUSIC_LADDER[this.arpIndex];
      this.note(t, freq, 0.12, 'square', 0.045, 2400);
      if (heat > 0.8) this.note(t + 0.02, freq * 2, 0.08, 'triangle', 0.03);
    }
  }

  note(t, freq, dur, type, gain, cutoff) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let tail = g;
    if (cutoff) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = cutoff;
      osc.connect(f);
      f.connect(g);
    } else {
      osc.connect(g);
    }
    tail.connect(this.gain);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  kick(t) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.32, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    osc.connect(g);
    g.connect(this.gain);
    osc.start(t);
    osc.stop(t + 0.26);
  }

  hat(t, gain) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.audio.noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 6500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(f);
    f.connect(g);
    g.connect(this.gain);
    src.start(t);
    src.stop(t + 0.06);
  }
}
