'use strict';
// DEAD CIRCUITS — audio. Everything is synthesized at runtime with the Web Audio API (no assets):
// one-shot SFX voices (limited, rate-limited, pitch-randomized) and a lookahead-scheduled
// procedural synthwave / darksynth sequencer whose layers follow a combat "intensity".
// Every public call is a silent no-op when Web Audio is missing, blocked or broken.
//
// Graph:  SFX voices ─┬─> sfxBus ─> sfxVol ─────────────┐
//                     └─> sfxVerb ─┘                     ├─> master ─> compressor ─> safety limiter ─> out
//         music tracks ─> musicBus ─> musicVol ─> duck ──┘
//         (each track: layers pad/bass/arp/lead/beat/perc ─> crossfade gain; sends ─> delay / musicVerb)
(function () {
  const G = (window.G = window.G || {});
  const AC = window.AudioContext || window.webkitAudioContext;
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;

  const MAX_VOICES = 24;   // simultaneous SFX voices
  const LOOKAHEAD = 0.15;  // s of music scheduled ahead of currentTime
  const TICK_MS = 25;      // scheduler period
  const XFADE = 1.5;       // music crossfade (s)
  const MAKEUP_TRIM = 0.898; // 1 / DynamicsCompressor makeup gain for the settings below (measured)
  const LAYERS = ['pad', 'bass', 'arp', 'lead', 'beat', 'perc'];

  // ---------------------------------------------------------------- helpers
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const hash = (s) => {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  };
  function makeRng(seed) { // mulberry32 (self-contained: audio must not depend on load order)
    let s = seed >>> 0 || 0x9e3779b9;
    const r = () => {
      let t = (s = (s + 0x6d2b79f5) >>> 0);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    r.int = (a, b) => a + Math.floor(r() * (b - a + 1));
    r.pick = (arr) => arr[Math.floor(r() * arr.length)];
    r.chance = (p) => r() < p;
    return r;
  }
  // pattern strings: x = accent, o = normal, g = ghost, anything else = rest
  const hit = (pat, st) => { const c = pat[st % pat.length]; return c === 'x' ? 1 : c === 'o' ? 0.6 : c === 'g' ? 0.3 : 0; };
  const quiet = (p) => { if (p && typeof p.catch === 'function') p.catch(() => {}); };

  // ---------------------------------------------------------------- shared tables (context-free)
  function mkCurve(fn, n = 4096) {
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) c[i] = fn((i / (n - 1)) * 2 - 1);
    return c;
  }
  const CURVES = {
    soft: mkCurve((x) => Math.tanh(x * 2) / Math.tanh(2)),
    hard: mkCurve((x) => Math.tanh(x * 7) / Math.tanh(7)),
    crush: mkCurve((x) => Math.round(x * 5) / 5),
    // safety limiter, fed at half level: transparent below 0.8 FS, soft knee above, never reaches 1.0
    limit: mkCurve((x) => {
      const s = x * 2, a = Math.abs(s);
      return a <= 0.8 ? s : Math.sign(s) * (0.8 + 0.17 * Math.tanh((a - 0.8) / 0.17));
    }),
  };
  function makeNoise(ac, sec) {
    const n = Math.floor(ac.sampleRate * sec), b = ac.createBuffer(1, n, ac.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  // Stereo reverb impulse: decaying noise that darkens over time, short pre-delay.
  function makeImpulse(ac, dur, decay) {
    const sr = ac.sampleRate, n = Math.floor(sr * dur), pre = Math.floor(sr * 0.012), b = ac.createBuffer(2, n, sr);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let lp = 0;
      for (let i = pre; i < n; i++) {
        const x = (i - pre) / (n - pre);
        lp += (Math.random() * 2 - 1 - lp) * (1 - 0.88 * x);
        d[i] = lp * Math.pow(1 - x, decay);
      }
    }
    return b;
  }

  // ================================================================ SFX
  class Voice {
    constructor(e, name, cfg, t, vol, pitch, pan) {
      const ac = e.ac;
      this.e = e; this.ac = ac; this.name = name; this.pri = cfg.pri; this.t = t; this.p = pitch; this.vol = vol;
      this.nodes = []; this.srcs = []; this.end = t + 0.05; this.tail = 0; this.dead = false;
      this.out = this.n(ac.createGain());
      this.out.gain.value = vol;
      let last = this.out;
      if (pan && ac.createStereoPanner) {
        const p = this.n(ac.createStereoPanner());
        p.pan.value = clamp(pan, -1, 1);
        last.connect(p); last = p;
      }
      last.connect(e.sfxBus);
    }
    n(x) { this.nodes.push(x); return x; }
    hz(f) { return clamp(f * this.p, 1, this.e.nyq); }
    gn(v, to) { const g = this.n(this.ac.createGain()); g.gain.value = v; g.connect(to || this.out); return g; }
    run(s, t0, t1, off) {
      if (off != null) s.start(t0, off); else s.start(t0);
      s.stop(t1);
      this.srcs.push(s);
      if (t1 > this.end) this.end = t1;
      return s;
    }
    env(p, t, a, g, d, hold) {
      p.value = 0; // GainNode defaults to 1: never let the first frame through before the envelope starts
      p.setValueAtTime(0, t);
      p.linearRampToValueAtTime(g, t + a);
      if (hold) p.setValueAtTime(g, t + a + hold);
      p.exponentialRampToValueAtTime(0.0003, t + a + (hold || 0) + d);
      return t + a + (hold || 0) + d;
    }
    // frequency automation: f -> f2 over gd (exp or lin), or a list of [dt, f] exp points
    sweep(p, t, f, o, dur) {
      p.setValueAtTime(this.hz(f), t);
      if (o.pts) for (const q of o.pts) p.exponentialRampToValueAtTime(this.hz(q[1]), t + q[0]);
      else if (o.f2) {
        const tt = t + (o.gd || dur);
        if (o.lin) p.linearRampToValueAtTime(this.hz(o.f2), tt); else p.exponentialRampToValueAtTime(this.hz(o.f2), tt);
      }
    }
    // biquad filter feeding o.to (default: voice output); returns its input
    flt(type, f, q, o = {}) {
      const fl = this.n(this.ac.createBiquadFilter());
      fl.type = type;
      fl.Q.value = q == null ? 1 : q;
      this.sweep(fl.frequency, this.t + (o.t || 0), f, o, 0.2);
      fl.connect(o.to || this.out);
      return fl;
    }
    // oscillator with AD(H) envelope. o: {t,a,hold,f2,gd,lin,pts,det,vib:[rate,hz],to,flt:[type,f,q,f2,gd]}
    o(w, f, d, g, o = {}) {
      const ac = this.ac, t = this.t + (o.t || 0), a = o.a == null ? 0.002 : o.a, hold = o.hold || 0;
      const osc = this.n(ac.createOscillator());
      osc.type = w;
      this.sweep(osc.frequency, t, f, o, a + hold + d);
      if (o.det) osc.detune.value = o.det;
      const eg = this.n(ac.createGain());
      const end = this.env(eg.gain, t, a, g, d, hold);
      if (o.vib) {
        const l = this.n(ac.createOscillator()), lg = this.n(ac.createGain());
        l.frequency.value = o.vib[0]; lg.gain.value = o.vib[1] * this.p;
        l.connect(lg); lg.connect(osc.frequency);
        this.run(l, t, end + 0.02);
      }
      osc.connect(eg);
      let dest = o.to || this.out;
      if (o.flt) dest = this.flt(o.flt[0], o.flt[1], o.flt[2], { to: dest, t: o.t, f2: o.flt[3], gd: o.flt[4] });
      eg.connect(dest);
      this.run(osc, t, end + 0.02);
      return osc;
    }
    // filtered noise burst. o: {t,a,hold,q,f2,gd,pts,to,rate}
    nz(d, g, type, f, o = {}) {
      const ac = this.ac, t = this.t + (o.t || 0), a = o.a == null ? 0.001 : o.a, hold = o.hold || 0;
      const s = this.n(ac.createBufferSource());
      s.buffer = this.e.noise; s.loop = true;
      if (o.rate) s.playbackRate.value = o.rate;
      const fl = this.n(ac.createBiquadFilter());
      fl.type = type;
      fl.Q.value = o.q == null ? (type === 'bandpass' ? 1 : 0.7) : o.q;
      this.sweep(fl.frequency, t, f, o, a + hold + d);
      const eg = this.n(ac.createGain());
      const end = this.env(eg.gain, t, a, g, d, hold);
      s.connect(fl); fl.connect(eg); eg.connect(o.to || this.out);
      this.run(s, t, end + 0.02, Math.random() * (this.e.noise.duration - 0.2));
      return fl;
    }
    // 2-operator FM. idx = modulation index (deviation = idx * modulator freq). o: {t,a,hold,idx2,w,mw,f2,gd,pts,to}
    fm(f, ratio, idx, d, g, o = {}) {
      const ac = this.ac, t = this.t + (o.t || 0), a = o.a == null ? 0.002 : o.a, hold = o.hold || 0;
      const car = this.n(ac.createOscillator()), mod = this.n(ac.createOscillator()), mg = this.n(ac.createGain());
      car.type = o.w || 'sine'; mod.type = o.mw || 'sine';
      const dur = a + hold + d;
      this.sweep(car.frequency, t, f, o, dur);
      this.sweep(mod.frequency, t, f * ratio, { f2: o.f2 && o.f2 * ratio, gd: o.gd, pts: o.pts && o.pts.map((q) => [q[0], q[1] * ratio]) }, dur);
      const dev = this.hz(f) * ratio * idx;
      mg.gain.setValueAtTime(dev, t);
      if (o.idx2 != null) mg.gain.linearRampToValueAtTime(this.hz(o.f2 || f) * ratio * o.idx2, t + dur);
      mod.connect(mg); mg.connect(car.frequency);
      const eg = this.n(ac.createGain());
      const end = this.env(eg.gain, t, a, g, d, hold);
      car.connect(eg); eg.connect(o.to || this.out);
      this.run(car, t, end + 0.02); this.run(mod, t, end + 0.02);
      return car;
    }
    // waveshaper stage: returns its input; output (scaled by post) goes to `to`
    sh(curve, drive = 1, post = 0.3, to) {
      const ws = this.n(this.ac.createWaveShaper());
      ws.curve = CURVES[curve];
      ws.connect(this.gn(post, to));
      const ig = this.n(this.ac.createGain());
      ig.gain.value = drive; ig.connect(ws);
      return ig;
    }
    // amplitude modulation stage (square = stutter/glitch); returns its input
    trem(rate, depth, d, to, w = 'square', rate2) {
      const ac = this.ac, t = this.t, g = this.gn(1 - depth / 2, to);
      const l = this.n(ac.createOscillator()), lg = this.n(ac.createGain());
      l.type = w;
      l.frequency.setValueAtTime(rate, t);
      if (rate2) l.frequency.linearRampToValueAtTime(rate2, t + d);
      lg.gain.value = depth / 2;
      l.connect(lg); lg.connect(g.gain);
      this.run(l, t, t + d + 0.05);
      return g;
    }
    // feedback echo stage; returns its input
    echo(time, fb, wet, to) {
      const ac = this.ac, inp = this.gn(1, to);
      const dl = this.n(ac.createDelay(1)), fg = this.n(ac.createGain());
      dl.delayTime.value = time; fg.gain.value = fb;
      inp.connect(dl); dl.connect(fg); fg.connect(dl);
      dl.connect(this.gn(wet, to));
      this.tail = Math.max(this.tail, time * Math.ceil(Math.log(0.01) / Math.log(clamp(fb, 0.05, 0.9))));
      return inp;
    }
    verb(amount) { const g = this.n(this.ac.createGain()); g.gain.value = amount; this.out.connect(g); g.connect(this.e.sfxVerb); }
    stop(fade = 0.05) { try { this.kill(this.e.now(), fade); } catch (err) { /* ignore */ } }
    kill(t, fade = 0.02) {
      if (this.dead) return;
      this.dead = true;
      const g = this.out.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(this.vol, t);
      g.linearRampToValueAtTime(0, t + fade);
      for (const s of this.srcs) { try { s.stop(t + fade + 0.01); } catch (err) { /* already stopped */ } }
      this.end = Math.min(this.end, t + fade + 0.02);
      this.tail = 0;
    }
    dispose() {
      for (const x of this.nodes) { try { x.disconnect(); } catch (err) { /* ignore */ } }
      this.nodes.length = 0; this.srcs.length = 0;
    }
  }

  // SFX table. cfg: g = base gain, rate = min seconds between two plays of the same name,
  // max = simultaneous voices of this name, pri = steal priority, pv = pitch-randomization scale
  // (1 = ±4%), verb = reverb send, duck = [amount, seconds] auto music duck.
  const SFX = Object.create(null);
  function S(name, cfg, fn) { SFX[name] = { c: Object.assign({ g: 1, rate: 0.03, max: 4, pri: 1, pv: 1, verb: 0, duck: null }, cfg), fn }; }

  // ---- movement
  S('jump', { g: 3.28, rate: 0.05, max: 2 }, (v) => {
    v.o('square', 150, 0.1, 0.09, { f2: 480, gd: 0.07, flt: ['lowpass', 2200, 1] });
    v.o('triangle', 300, 0.09, 0.2, { f2: 820, gd: 0.07 });
    v.nz(0.08, 0.14, 'bandpass', 1800, { f2: 5000, q: 0.8, a: 0.01 });
  });
  S('doublejump', { g: 2.63, rate: 0.05, max: 2 }, (v) => {
    v.o('triangle', 420, 0.12, 0.18, { f2: 1100, gd: 0.08 });
    v.o('sine', 840, 0.14, 0.12, { f2: 2200, gd: 0.09, t: 0.02 });
    v.o('square', 1400, 0.06, 0.035, { f2: 2800, t: 0.03, flt: ['highpass', 1500, 0.7] });
    v.nz(0.16, 0.22, 'bandpass', 1500, { f2: 6000, q: 1.2, a: 0.02 });
  });
  S('land', { g: 1.88, rate: 0.06, max: 2 }, (v) => {
    v.o('sine', 130, 0.12, 0.55, { f2: 45 });
    v.nz(0.07, 0.35, 'lowpass', 900, { f2: 300 });
    v.nz(0.03, 0.15, 'bandpass', 2500, { q: 1.5 });
  });
  S('step', { g: 1.92, rate: 0.07, max: 2, pri: 0 }, (v) => {
    v.o('sine', 95, 0.045, 0.3, { f2: 55 });
    v.nz(0.035, 0.3, 'bandpass', 1600 + Math.random() * 1200, { q: 2 });
    v.nz(0.012, 0.08, 'highpass', 5000);
  });
  S('roll', { g: 3.21, rate: 0.12, max: 2 }, (v) => {
    v.nz(0.28, 0.45, 'bandpass', 500, { f2: 2600, q: 1.1, a: 0.06, gd: 0.18 });
    v.o('sawtooth', 70, 0.22, 0.09, { f2: 150, flt: ['lowpass', 500, 1] });
    v.o('sine', 900, 0.05, 0.04, { f2: 1400, t: 0.02 });
  });
  S('ledge', { g: 2.4, rate: 0.1, max: 2 }, (v) => {
    v.fm(620, 1.41, 3, 0.1, 0.14, { idx2: 0.3 });
    v.nz(0.03, 0.25, 'highpass', 3000);
    v.o('sine', 180, 0.06, 0.15, { f2: 90 });
  });
  S('ladder', { g: 2.97, rate: 0.12, max: 2, pri: 0 }, (v) => {
    v.fm(1100, 2.1, 2, 0.05, 0.1, { idx2: 0.2 });
    v.nz(0.02, 0.2, 'bandpass', 3000, { q: 2 });
  });
  S('slam', { g: 1.09, rate: 0.15, max: 2, pri: 2, verb: 0.2 }, (v) => {
    v.o('sine', 170, 0.4, 0.7, { f2: 32, gd: 0.25 });
    v.o('square', 70, 0.18, 0.3, { f2: 35, to: v.flt('lowpass', 600, 1, { to: v.sh('hard', 1.5, 0.22) }) });
    v.nz(0.45, 0.5, 'lowpass', 2500, { f2: 150 });
    v.nz(0.04, 0.35, 'highpass', 1500);
    v.nz(0.35, 0.3, 'bandpass', 800, { q: 3, t: 0.03 });
  });

  // ---- melee
  S('slash1', { g: 2.65, rate: 0.04 }, (v) => {
    v.nz(0.1, 0.6, 'bandpass', 1200, { f2: 5500, q: 1.4, a: 0.03, hold: 0.03, gd: 0.12 });
    v.o('sawtooth', 1100, 0.07, 0.06, { f2: 320, flt: ['bandpass', 2000, 2] });
    v.nz(0.05, 0.1, 'highpass', 6000, { t: 0.02, a: 0.01 });
  });
  S('slash2', { g: 2.16, rate: 0.04 }, (v) => {
    v.nz(0.1, 0.6, 'bandpass', 4200, { f2: 1100, q: 1.6, a: 0.03, hold: 0.03, gd: 0.13 });
    v.o('sawtooth', 380, 0.08, 0.06, { f2: 1300, flt: ['bandpass', 1800, 2] });
    v.nz(0.04, 0.08, 'highpass', 5500, { t: 0.01, a: 0.01 });
  });
  S('slash3', { g: 2.29, rate: 0.05, verb: 0.08 }, (v) => {
    v.nz(0.22, 0.65, 'bandpass', 700, { f2: 5000, q: 1.2, a: 0.02, gd: 0.16 });
    v.o('sawtooth', 240, 0.2, 0.2, { f2: 90, to: v.sh('hard', 2, 0.12) });
    v.o('sine', 140, 0.2, 0.3, { f2: 60, a: 0.02 });
    v.o('square', 2600, 0.08, 0.03, { f2: 3400, t: 0.03 });
  });
  S('heavy', { g: 1.6, rate: 0.1, max: 2 }, (v) => {
    v.nz(0.42, 0.7, 'bandpass', 250, { f2: 1600, q: 1, a: 0.12, gd: 0.3 });
    v.o('sawtooth', 60, 0.35, 0.3, { f2: 42, a: 0.08, to: v.flt('lowpass', 500, 1, { to: v.sh('hard', 1.5, 0.15) }) });
    v.o('sine', 110, 0.3, 0.3, { f2: 55, a: 0.1 });
  });
  S('whip', { g: 2.74, rate: 0.06 }, (v) => {
    v.nz(0.07, 0.8, 'bandpass', 700, { f2: 3500, q: 1.3, a: 0.04, hold: 0.02 });
    v.nz(0.035, 0.35, 'highpass', 3500, { t: 0.085 });
    v.o('square', 2400, 0.05, 0.06, { f2: 500, t: 0.085, flt: ['bandpass', 2500, 1] });
    v.o('sawtooth', 3200, 0.1, 0.03, { f2: 3000, t: 0.09, flt: ['highpass', 2000, 0.7] });
  });
  S('stab', { g: 2.68, rate: 0.04 }, (v) => {
    v.nz(0.06, 0.5, 'bandpass', 3200, { f2: 1400, q: 1.8, a: 0.015, hold: 0.02 });
    v.o('sine', 520, 0.06, 0.25, { f2: 240 });
    v.o('triangle', 1800, 0.03, 0.08, { f2: 1200 });
  });

  // ---- impacts
  S('hit', { g: 1.33, rate: 0.025, max: 5, pri: 2 }, (v) => {
    v.nz(0.018, 0.3, 'highpass', 2200);
    v.o('sine', 200, 0.16, 0.55, { f2: 55, gd: 0.12, hold: 0.02 });
    v.o('square', 120, 0.08, 0.3, { f2: 50, hold: 0.02, to: v.flt('lowpass', 1800, 0.7, { to: v.sh('hard', 2.5, 0.16) }) });
    v.nz(0.1, 0.5, 'bandpass', 1100, { f2: 400, q: 1.2, hold: 0.02 });
    v.fm(1250, 2.76, 2.5, 0.07, 0.06, { idx2: 0.2 });
  });
  S('hitCrit', { g: 1.1, rate: 0.03, max: 3, pri: 2, verb: 0.1 }, (v) => {
    v.nz(0.02, 0.35, 'highpass', 2000);
    v.o('sine', 180, 0.22, 0.65, { f2: 38, gd: 0.15 });
    v.o('sawtooth', 160, 0.12, 0.3, { f2: 45, to: v.sh('hard', 3, 0.18) });
    v.nz(0.12, 0.45, 'bandpass', 900, { f2: 300, q: 1 });
    v.o('square', 1800, 0.14, 0.08, { f2: 2700, t: 0.01, flt: ['bandpass', 2500, 2] });
    v.nz(0.1, 0.25, 'bandpass', 6000, { q: 2, t: 0.02 });
    v.fm(1600, 3.1, 3, 0.18, 0.06, { idx2: 0.1, t: 0.01 });
  });
  S('hitArmor', { g: 1.97, rate: 0.04, max: 3, pri: 2 }, (v) => {
    v.nz(0.015, 0.25, 'highpass', 4000);
    v.fm(540, 3.5, 3, 0.28, 0.14, { idx2: 0.5 });
    v.fm(810, 2.13, 2, 0.2, 0.1, { idx2: 0.2 });
    v.o('sine', 260, 0.06, 0.35, { f2: 120 });
    v.o('triangle', 3200, 0.2, 0.05, { f2: 3100 });
  });
  S('playerHurt', { g: 1.96, rate: 0.1, max: 2, pri: 3 }, (v) => {
    const d = v.sh('hard', 2, 0.2, v.trem(38, 0.8, 0.22));
    v.o('sawtooth', 320, 0.2, 0.3, { f2: 110, to: d });
    v.nz(0.14, 0.45, 'bandpass', 1400, { f2: 600, q: 1.2 });
    v.o('sine', 160, 0.2, 0.5, { f2: 55 });
    v.nz(0.02, 0.2, 'highpass', 2500);
  });
  S('lowHp', { g: 1.59, rate: 0.35, max: 1, pri: 3, pv: 0.3 }, (v) => {
    v.o('sine', 72, 0.13, 0.75, { f2: 44, a: 0.008 });
    v.o('sine', 64, 0.15, 0.55, { f2: 40, a: 0.008, t: 0.2 });
    v.nz(0.05, 0.15, 'lowpass', 300);
    v.o('sine', 1760, 0.07, 0.04);
  });
  S('heal', { g: 1.5, rate: 0.3, max: 1, pri: 3, pv: 0.3, verb: 0.3 }, (v) => {
    [72, 76, 79, 84, 88].forEach((m, i) => {
      v.o('triangle', mtof(m), 0.35, 0.11, { t: i * 0.06, a: 0.01 });
      v.o('sine', mtof(m + 12), 0.25, 0.05, { t: i * 0.06 + 0.01 });
    });
    v.o('sine', 300, 0.6, 0.14, { f2: 620, a: 0.1, gd: 0.5, vib: [7, 12] });
    v.nz(0.6, 0.08, 'highpass', 7000, { a: 0.2 });
  });

  // ---- ranged / skills
  S('shoot', { g: 2.06, rate: 0.05, max: 3 }, (v) => {
    v.o('square', 1000, 0.1, 0.12, { f2: 180, a: 0.004, hold: 0.035, gd: 0.13, flt: ['lowpass', 3500, 1] });
    v.o('sawtooth', 700, 0.09, 0.1, { f2: 140, a: 0.004, hold: 0.035, gd: 0.12, to: v.sh('hard', 2, 0.1) });
    v.o('sine', 1600, 0.08, 0.1, { f2: 300, t: 0.003 });
    v.nz(0.05, 0.22, 'bandpass', 2600, { q: 1, hold: 0.02 });
    v.o('sine', 160, 0.09, 0.25, { f2: 55, t: 0.006 });
  });
  S('laser', { g: 2.49, rate: 0.08, max: 3 }, (v) => {
    v.fm(2400, 0.04, 6, 0.32, 0.25, { f2: 1500, w: 'sawtooth', to: v.flt('bandpass', 2400, 1.2) });
    v.o('sine', 3400, 0.25, 0.08, { f2: 1900 });
    v.nz(0.05, 0.15, 'highpass', 4000);
    v.o('sine', 240, 0.08, 0.2, { f2: 90 });
  });
  S('rail', { g: 1.73, rate: 0.15, max: 2, pri: 2, verb: 0.2 }, (v) => {
    v.nz(0.03, 0.35, 'highpass', 1800);
    v.o('sine', 3000, 0.4, 0.22, { f2: 70, gd: 0.35 });
    v.o('sawtooth', 5000, 0.2, 0.05, { f2: 800, flt: ['highpass', 1500, 0.7] });
    v.o('sawtooth', 110, 0.45, 0.3, { f2: 38, to: v.flt('lowpass', 700, 1, { to: v.sh('hard', 2, 0.18) }) });
    v.nz(0.35, 0.4, 'bandpass', 2000, { f2: 400, q: 0.8, t: 0.01 });
    v.fm(2600, 1.5, 4, 0.5, 0.05, { idx2: 0, t: 0.02 });
  });
  S('shotgun', { g: 0.89, rate: 0.12, max: 2, pri: 2, verb: 0.12 }, (v) => {
    v.nz(0.32, 0.8, 'lowpass', 4500, { f2: 350 });
    v.nz(0.02, 0.25, 'highpass', 2500);
    v.o('sine', 120, 0.28, 0.6, { f2: 38 });
    v.o('square', 85, 0.12, 0.3, { f2: 40, to: v.sh('hard', 3, 0.15) });
    v.nz(0.025, 0.3, 'bandpass', 3000, { q: 3, t: 0.3 });
    v.o('square', 1300, 0.015, 0.05, { t: 0.3 });
    v.nz(0.03, 0.3, 'bandpass', 2200, { q: 3, t: 0.4 });
    v.o('square', 900, 0.02, 0.05, { t: 0.4 });
  });
  S('smg', { g: 2.35, rate: 0.035, max: 4 }, (v) => {
    v.nz(0.04, 0.5, 'bandpass', 2200, { q: 0.9, hold: 0.012 });
    v.o('square', 650, 0.04, 0.1, { f2: 200, hold: 0.01, to: v.sh('hard', 2, 0.1) });
    v.o('sine', 130, 0.05, 0.3, { f2: 55 });
  });
  S('bow', { g: 1.89, rate: 0.08 }, (v) => {
    v.o('triangle', 330, 0.3, 0.3, { f2: 200, gd: 0.05 });
    v.o('sawtooth', 165, 0.18, 0.08, { f2: 110, flt: ['lowpass', 1200, 1] });
    v.o('sine', 2200, 0.14, 0.12, { f2: 500 });
    v.nz(0.1, 0.25, 'highpass', 3000, { a: 0.005 });
  });
  S('charge', { g: 1.25, rate: 0.2, max: 1 }, (v) => {
    const tr = v.trem(10, 0.5, 0.6, null, 'sine', 32);
    v.o('sawtooth', 180, 0.1, 0.2, { a: 0.05, hold: 0.45, pts: [[0.55, 1100]], to: v.flt('lowpass', 700, 3, { pts: [[0.55, 4500]], to: tr }) });
    v.o('sine', 360, 0.1, 0.1, { a: 0.05, hold: 0.45, pts: [[0.55, 2200]] });
  });
  S('explosion', { g: 0.77, rate: 0.06, max: 3, pri: 3, verb: 0.3 }, (v) => {
    v.nz(1.0, 0.8, 'lowpass', 5000, { f2: 140, gd: 0.8, to: v.sh('soft', 1.5, 0.6) });
    v.o('sine', 95, 0.7, 0.9, { f2: 28, gd: 0.5 });
    v.nz(0.03, 0.3, 'highpass', 1500);
    v.o('square', 55, 0.3, 0.3, { f2: 30, to: v.flt('lowpass', 400, 1, { to: v.sh('hard', 2, 0.15) }) });
    v.nz(0.5, 0.4, 'bandpass', 1500, { q: 1.5, t: 0.03, to: v.trem(30, 0.9, 0.55) });
  });
  S('grenade', { g: 3.51, rate: 0.1 }, (v) => {
    v.nz(0.18, 0.35, 'bandpass', 700, { f2: 2400, q: 1.2, a: 0.03 });
    v.fm(2300, 2.4, 2, 0.12, 0.08, { idx2: 0.2 });
    v.o('square', 1600, 0.012, 0.06);
  });
  S('emp', { g: 1.83, rate: 0.2, max: 2, pri: 2, verb: 0.3 }, (v) => {
    v.fm(900, 0.07, 12, 0.6, 0.2, { f2: 60, gd: 0.5 });
    v.nz(0.45, 0.4, 'bandpass', 500, { f2: 2000, q: 2, to: v.sh('crush', 2, 0.35) });
    v.o('sine', 5000, 0.35, 0.05, { f2: 900 });
    v.o('sine', 70, 0.35, 0.5, { f2: 35 });
  });
  S('shock', { g: 1.47, rate: 0.06, max: 3 }, (v) => {
    const o = v.o('sawtooth', 110, 0.2, 0.25, { a: 0.005, hold: 0.04, to: v.flt('highpass', 400, 0.7, { to: v.sh('hard', 3, 0.14) }) });
    for (let i = 1; i < 8; i++) o.frequency.setValueAtTime(v.hz(90 + Math.random() * 400), v.t + i * 0.03);
    v.nz(0.25, 0.35, 'highpass', 3500, { to: v.trem(45, 1, 0.25) });
  });
  S('burn', { g: 1.68, rate: 0.1, max: 2 }, (v) => {
    v.nz(0.45, 0.5, 'lowpass', 800, { f2: 2500, a: 0.08, gd: 0.25 });
    for (let i = 0; i < 6; i++) v.nz(0.015, 0.15 + 0.2 * Math.random(), 'highpass', 3000, { t: Math.random() * 0.4 });
    v.o('sine', 90, 0.3, 0.2, { f2: 60, a: 0.05 });
  });
  S('freeze', { g: 1.48, rate: 0.1, max: 2, verb: 0.25 }, (v) => {
    v.fm(2600, 1.5, 2, 0.45, 0.08, { idx2: 0.1 });
    v.fm(3900, 1.41, 1.5, 0.35, 0.06, { idx2: 0.1, t: 0.04 });
    v.nz(0.35, 0.2, 'highpass', 6000, { a: 0.02 });
    for (let i = 0; i < 4; i++) v.o('sine', 4200 - i * 500, 0.1, 0.05, { t: i * 0.05 });
    v.nz(0.05, 0.35, 'bandpass', 3000, { q: 2 });
  });
  S('turret', { g: 3.05, rate: 0.2 }, (v) => {
    v.o('square', 180, 0.08, 0.1, { f2: 260, flt: ['lowpass', 1200, 1] });
    v.o('square', 260, 0.08, 0.1, { f2: 400, t: 0.1, flt: ['lowpass', 1500, 1] });
    v.nz(0.02, 0.35, 'bandpass', 2500, { q: 3, t: 0.2 });
    v.o('sine', 120, 0.06, 0.35, { f2: 60, t: 0.2 });
    v.o('square', 1500, 0.05, 0.05, { t: 0.3 });
    v.o('square', 1500, 0.05, 0.05, { t: 0.4 });
  });
  S('drone', { g: 2.74, rate: 0.2 }, (v) => {
    v.o('sawtooth', 280, 0.45, 0.2, { f2: 520, a: 0.08, to: v.flt('lowpass', 1600, 2, { to: v.trem(28, 0.6, 0.55) }) });
    v.o('sine', 1200, 0.06, 0.08, { t: 0.4 });
    v.o('sine', 1800, 0.08, 0.08, { t: 0.47 });
  });
  S('shield', { g: 1.71, rate: 0.06, max: 3, pri: 2 }, (v) => {
    v.o('sine', 220, 0.1, 0.55, { f2: 110 });
    v.fm(640, 1.5, 2, 0.28, 0.15, { idx2: 0.1 });
    v.nz(0.06, 0.4, 'bandpass', 1200, { q: 1.2 });
    v.o('sawtooth', 110, 0.25, 0.08, { a: 0.01, flt: ['lowpass', 900, 1] });
  });
  S('parry', { g: 1.44, rate: 0.08, max: 2, pri: 3, pv: 0.3, verb: 0.35 }, (v) => {
    v.nz(0.015, 0.45, 'highpass', 3000);
    v.o('sine', 1760, 0.6, 0.22);
    v.o('sine', 2640, 0.45, 0.12);
    v.fm(3520, 3.01, 1.5, 0.25, 0.06, { idx2: 0 });
    v.o('triangle', 880, 0.2, 0.15);
  });
  S('dash', { g: 2.95, rate: 0.08 }, (v) => {
    v.nz(0.14, 0.5, 'bandpass', 900, { f2: 6000, q: 1.3, a: 0.01 });
    v.o('sawtooth', 220, 0.1, 0.07, { f2: 1100, flt: ['bandpass', 1500, 1] });
    v.o('sine', 180, 0.08, 0.2, { f2: 80 });
  });
  S('teleport', { g: 2.11, rate: 0.15, verb: 0.25 }, (v) => {
    const e = v.echo(0.09, 0.4, 0.5);
    v.fm(300, 2, 3, 0.25, 0.16, { f2: 2400, idx2: 0.5, to: e });
    v.nz(0.25, 0.3, 'bandpass', 1000, { f2: 8000, q: 2, to: e });
    v.o('sine', 2400, 0.2, 0.07, { t: 0.2, f2: 1200 });
  });

  // ---- enemies / boss
  S('enemyAlert', { g: 5.31, rate: 0.12, max: 2, pri: 2, pv: 0.4 }, (v) => {
    v.o('square', 880, 0.05, 0.1, { flt: ['lowpass', 3000, 1] });
    v.o('square', 1320, 0.08, 0.1, { t: 0.06, flt: ['lowpass', 3500, 1] });
    v.o('sine', 2640, 0.08, 0.05, { t: 0.06 });
  });
  S('telegraph', { g: 3.51, rate: 0.08, max: 3, pri: 2 }, (v) => {
    v.o('sawtooth', 220, 0.3, 0.2, { f2: 700, a: 0.05, to: v.flt('bandpass', 1200, 2, { to: v.trem(18, 0.5, 0.35, null, 'triangle', 36) }) });
    v.o('sine', 440, 0.3, 0.1, { f2: 1400, a: 0.08 });
    v.fm(2000, 1.5, 1, 0.12, 0.06, { t: 0.28 });
  });
  S('enemyShoot', { g: 2.75, rate: 0.05, max: 4 }, (v) => {
    v.o('square', 520, 0.12, 0.12, { f2: 110, flt: ['lowpass', 2000, 1] });
    v.nz(0.05, 0.35, 'bandpass', 1300, { q: 1 });
    v.o('sine', 140, 0.06, 0.3, { f2: 60 });
  });
  S('enemyLaser', { g: 4.02, rate: 0.1, max: 2 }, (v) => {
    v.fm(220, 1.01, 2, 0.45, 0.2, { a: 0.02, w: 'sawtooth', to: v.flt('bandpass', 900, 1.5) });
    v.o('sawtooth', 223, 0.45, 0.07, { a: 0.02, flt: ['lowpass', 1500, 1] });
    v.o('sine', 800, 0.1, 0.07, { f2: 1600 });
    v.nz(0.4, 0.15, 'bandpass', 3000, { q: 3, a: 0.02 });
  });
  S('enemyDie', { g: 1.24, rate: 0.05, max: 3, pri: 2 }, (v) => {
    v.nz(0.32, 0.6, 'lowpass', 3500, { f2: 250 });
    v.o('square', 420, 0.26, 0.25, { f2: 55, to: v.sh('hard', 2.5, 0.16) });
    v.o('sine', 160, 0.22, 0.55, { f2: 40 });
    for (let i = 0; i < 4; i++) v.nz(0.012, 0.25, 'highpass', 4000, { t: 0.04 + Math.random() * 0.25 });
  });
  S('eliteDie', { g: 0.79, rate: 0.2, max: 2, pri: 3, verb: 0.3 }, (v) => {
    v.nz(0.6, 0.7, 'lowpass', 4000, { f2: 180 });
    v.o('sine', 110, 0.5, 0.8, { f2: 30 });
    v.o('square', 500, 0.4, 0.3, { f2: 50, to: v.sh('hard', 2.5, 0.16) });
    const o = v.o('square', 900, 0.6, 0.25, { t: 0.05, to: v.sh('crush', 2, 0.2) });
    for (let i = 1; i < 10; i++) o.frequency.setValueAtTime(v.hz(900 - i * 80 + Math.random() * 200), v.t + 0.05 + i * 0.05);
    for (let i = 0; i < 6; i++) v.nz(0.015, 0.3, 'highpass', 4000, { t: 0.05 + Math.random() * 0.5 });
    v.nz(0.03, 0.5, 'highpass', 1800);
  });
  S('bossRoar', { g: 1.01, rate: 0.5, max: 1, pri: 4, verb: 0.4, duck: [0.55, 1.3] }, (v) => {
    const lp = v.flt('lowpass', 250, 4, { to: v.sh('hard', 2.5, 0.3), pts: [[0.35, 2200], [1.7, 400]] });
    for (const f of [55, 58, 82.5]) v.fm(f, 0.55, 1.2, 0.8, 0.14, { w: 'sawtooth', a: 0.15, hold: 0.8, pts: [[0.2, f * 1.1], [1.7, f * 0.8]], to: lp });
    v.nz(0.9, 0.6, 'bandpass', 600, { a: 0.12, hold: 0.7, q: 1.5, pts: [[0.3, 1400], [1.6, 400]] });
    v.o('sine', 45, 0.8, 0.55, { a: 0.1, hold: 0.8, f2: 36 });
  });
  S('bossPhase', { g: 1, rate: 0.5, max: 1, pri: 4, pv: 0, verb: 0.4, duck: [0.5, 1.2] }, (v) => {
    v.o('sine', 90, 0.9, 0.8, { f2: 28 });
    v.nz(0.8, 0.6, 'lowpass', 3500, { f2: 100 });
    v.o('sawtooth', 90, 1.0, 0.3, { f2: 1500, gd: 0.9, a: 0.05, to: v.sh('crush', 2, 0.18, v.trem(22, 0.9, 1.0, null, 'square', 40)) });
    const lp = v.flt('lowpass', 900, 2, { pts: [[0.1, 3000], [1.5, 600]] });
    for (const m of [45, 48, 52, 57]) for (const dd of [-12, 12]) v.o('sawtooth', mtof(m), 1.2, 0.06, { a: 0.02, hold: 0.3, det: dd, to: lp });
  });
  S('bossDie', { g: 1, rate: 1, max: 1, pri: 5, pv: 0, verb: 0.5, duck: [0.75, 2.5] }, (v) => {
    [0, 0.35, 0.8].forEach((dt, i) => {
      v.nz(0.7, 0.7 - i * 0.1, 'lowpass', 4000, { t: dt, f2: 150 });
      v.o('sine', 100 - i * 15, 0.6, 0.7, { t: dt, f2: 30 });
      v.nz(0.03, 0.45, 'highpass', 1500, { t: dt });
    });
    v.o('sawtooth', 1400, 2.0, 0.25, { f2: 40, gd: 2.0, a: 0.05, to: v.sh('crush', 2, 0.2) });
    v.o('sine', 60, 2.4, 0.6, { t: 1.2, f2: 25, a: 0.02 });
    v.nz(2.4, 0.6, 'lowpass', 2000, { t: 1.2, f2: 60 });
    v.fm(1200, 2.01, 1, 2.5, 0.05, { t: 1.2, idx2: 0, a: 0.3 });
  });

  // ---- pickups / world
  S('pickupCell', { g: 1.71, rate: 0.04, max: 4, pv: 0.5 }, (v) => {
    v.o('sine', 1200, 0.08, 0.25, { f2: 1900, gd: 0.04 });
    v.o('triangle', 2400, 0.1, 0.09, { t: 0.035 });
  });
  S('pickupGold', { g: 1.91, rate: 0.04, max: 4, pv: 0.25 }, (v) => {
    v.o('square', 1319, 0.05, 0.08, { hold: 0.03, flt: ['lowpass', 5000, 1] });
    v.o('square', 1760, 0.18, 0.08, { t: 0.06, flt: ['lowpass', 5000, 1] });
    v.o('sine', 3520, 0.15, 0.04, { t: 0.06 });
  });
  S('pickupItem', { g: 2.04, rate: 0.2, max: 2, pri: 3, pv: 0, verb: 0.25 }, (v) => {
    [0, 7, 12, 19].forEach((s, i) => {
      v.o('square', mtof(72 + s), 0.18, 0.07, { t: i * 0.055, flt: ['lowpass', 4000, 1] });
      v.o('triangle', mtof(84 + s), 0.3, 0.06, { t: i * 0.055 });
    });
    v.nz(0.4, 0.08, 'highpass', 8000, { a: 0.1 });
  });
  S('scroll', { g: 1.08, rate: 1, max: 1, pri: 4, pv: 0, verb: 0.5, duck: [0.45, 1.4] }, (v) => {
    // formant "choir" swell: detuned saws through vowel ("ah") band-passes
    const bus = v.gn(1, v.flt('bandpass', 750, 5));
    bus.connect(v.flt('bandpass', 1150, 6));
    bus.connect(v.flt('bandpass', 2600, 7));
    for (const m of [57, 64, 69, 73, 76]) for (const d of [-9, 9]) v.o('sawtooth', mtof(m), 1.3, 0.16, { a: 0.45, hold: 0.5, det: d, to: bus, vib: [5, 3] });
    v.o('sine', mtof(45), 1.6, 0.35, { a: 0.4, hold: 0.4 });
    [0, 4, 7, 12, 16, 19, 24, 28].forEach((s, i) => v.o('triangle', mtof(81 + s), 0.4, 0.05, { t: 0.3 + i * 0.07 }));
    v.nz(1.2, 0.12, 'highpass', 6000, { a: 0.6 });
  });
  S('door', { g: 1.43, rate: 0.3, max: 2 }, (v) => {
    v.o('sawtooth', 70, 0.2, 0.15, { f2: 95, a: 0.05, hold: 0.25, gd: 0.45, flt: ['lowpass', 500, 1] });
    v.nz(0.2, 0.3, 'bandpass', 600, { f2: 1200, q: 1.5, a: 0.05, hold: 0.2, gd: 0.45 });
    v.o('sine', 110, 0.15, 0.5, { f2: 45, t: 0.5 });
    v.nz(0.05, 0.35, 'bandpass', 1500, { q: 2, t: 0.5 });
    v.o('sine', 1000, 0.04, 0.06);
  });
  S('chest', { g: 3.72, rate: 0.3, max: 1, pri: 3, pv: 0.2, verb: 0.2 }, (v) => {
    v.nz(0.03, 0.4, 'bandpass', 2500, { q: 3 });
    v.o('square', 900, 0.02, 0.06);
    v.o('sawtooth', 140, 0.3, 0.1, { f2: 260, a: 0.05, t: 0.05, flt: ['lowpass', 900, 1] });
    v.nz(0.25, 0.2, 'bandpass', 3000, { f2: 1200, q: 2, t: 0.05 });
    [0, 4, 7, 12, 16].forEach((s, i) => v.o('triangle', mtof(79 + s), 0.25, 0.08, { t: 0.3 + i * 0.05 }));
  });
  S('shopBuy', { g: 3.39, rate: 0.15, max: 2, pri: 3, pv: 0 }, (v) => {
    v.o('square', 988, 0.06, 0.08, { flt: ['lowpass', 4000, 1] });
    v.o('square', 1319, 0.25, 0.08, { t: 0.07, flt: ['lowpass', 4000, 1] });
    for (let i = 0; i < 5; i++) v.fm(3000 + Math.random() * 1500, 2.4, 1.5, 0.08, 0.05, { t: 0.1 + i * 0.035 });
    v.nz(0.03, 0.3, 'bandpass', 2000, { q: 2 });
  });
  S('denied', { g: 1.54, rate: 0.2, max: 1, pv: 0.3 }, (v) => {
    for (const dt of [0, 0.15]) {
      v.o('square', 150, 0.05, 0.08, { t: dt, hold: 0.06, flt: ['lowpass', 1400, 1] });
      v.o('square', 157, 0.05, 0.08, { t: dt, hold: 0.06, flt: ['lowpass', 1400, 1] });
    }
  });
  S('spikes', { g: 2.23, rate: 0.1, max: 2, pri: 2 }, (v) => {
    v.fm(900, 2.3, 3, 0.18, 0.14, { idx2: 0.3 });
    v.nz(0.03, 0.25, 'highpass', 2500);
    v.o('sawtooth', 300, 0.1, 0.2, { f2: 120, to: v.sh('hard', 2, 0.12) });
    v.o('sine', 150, 0.1, 0.25, { f2: 60 });
  });
  S('breakable', { g: 1.62, rate: 0.06, max: 3 }, (v) => {
    v.nz(0.25, 0.6, 'bandpass', 1800, { f2: 600, q: 0.8 });
    v.o('sine', 140, 0.12, 0.5, { f2: 55 });
    for (let i = 0; i < 6; i++) v.fm(2000 + Math.random() * 3000, 1.3 + Math.random(), 1.5, 0.06 + Math.random() * 0.08, 0.05, { t: 0.02 + Math.random() * 0.2 });
    v.nz(0.02, 0.3, 'highpass', 3000);
  });
  S('glitch', { g: 3.46, rate: 0.06, max: 2 }, (v) => {
    const c = v.sh('crush', 2, 0.3);
    for (let i = 0; i < 7; i++) {
      v.o(Math.random() < 0.5 ? 'square' : 'sawtooth', 100 + Math.random() * 2000, 0.02 + Math.random() * 0.03, 0.2,
        { t: i * 0.03 + Math.random() * 0.01, a: 0.001, to: c });
    }
    v.nz(0.2, 0.3, 'bandpass', 3000, { q: 4, to: v.trem(60, 1, 0.2) });
  });

  // ---- stingers
  S('levelStart', { g: 1.18, rate: 1, max: 1, pri: 4, pv: 0, verb: 0.35 }, (v) => {
    v.o('sine', 75, 1.1, 0.7, { f2: 32, gd: 0.9 });
    v.nz(0.7, 0.4, 'lowpass', 2500, { f2: 90 });
    const lp = v.flt('lowpass', 300, 4, { pts: [[0.18, 3800], [1.8, 500]] });
    for (const m of [45, 52, 57, 60, 64]) for (const d of [-10, 10]) v.o('sawtooth', mtof(m), 1.5, 0.06, { a: 0.01, hold: 0.25, det: d, to: lp });
    const e = v.echo(0.14, 0.35, 0.5);
    [69, 72, 76, 81, 84].forEach((m, i) => v.o('square', mtof(m), 0.09, 0.06, { t: 0.12 + i * 0.07, to: e, flt: ['lowpass', 4000, 1] }));
  });
  S('transit', { g: 1.74, rate: 1, max: 1, pri: 3, pv: 0, verb: 0.5 }, (v) => {
    for (const m of [50, 62, 66, 69, 73, 76]) v.o('triangle', mtof(m), 1.6, 0.08, { a: 0.35, hold: 0.5 });
    [[0.25, 81], [0.55, 78], [0.85, 74], [1.15, 76]].forEach((q) => v.fm(mtof(q[1]), 3.5, 1.2, 1.1, 0.06, { t: q[0], idx2: 0 }));
    v.nz(1.5, 0.06, 'bandpass', 3000, { a: 0.5, q: 0.5 });
  });
  S('death', { g: 1.02, rate: 1, max: 1, pri: 5, pv: 0, verb: 0.4, duck: [0.85, 2.2] }, (v) => {
    const lp = v.flt('lowpass', 4000, 3, { pts: [[1.6, 150]] });
    for (const d of [-12, 0, 12]) v.o('sawtooth', 330, 1.3, 0.1, { f2: 55, gd: 1.5, det: d, to: lp, hold: 0.2 });
    v.o('sine', 90, 1.4, 0.7, { f2: 28, gd: 1.2 });
    v.nz(0.8, 0.5, 'lowpass', 3000, { f2: 100 });
    v.nz(0.6, 0.4, 'bandpass', 2000, { q: 3, to: v.sh('crush', 3, 0.3, v.trem(16, 1, 0.6)) });
    for (const m of [45, 48, 52]) v.o('triangle', mtof(m), 2.0, 0.1, { a: 0.3, t: 0.5 });
  });
  S('victory', { g: 1.96, rate: 1, max: 1, pri: 5, pv: 0, verb: 0.4, duck: [0.6, 2.0] }, (v) => {
    [60, 64, 67, 72, 76, 79].forEach((m, i) => {
      v.o('square', mtof(m), 0.25, 0.06, { t: i * 0.08, flt: ['lowpass', 3500, 1] });
      v.o('sawtooth', mtof(m + 12), 0.2, 0.035, { t: i * 0.08, det: 7 });
    });
    const lp = v.flt('lowpass', 600, 1.5, { t: 0.5, pts: [[0.8, 4000], [2.2, 1200]] });
    for (const m of [48, 60, 64, 67, 72, 74]) for (const d of [-8, 8]) v.o('sawtooth', mtof(m), 1.5, 0.05, { t: 0.5, a: 0.08, hold: 0.6, det: d, to: lp });
    v.o('sine', mtof(36), 1.8, 0.4, { t: 0.5, a: 0.02 });
    v.nz(1.5, 0.08, 'highpass', 7000, { t: 0.5, a: 0.3 });
  });

  // ---- UI
  S('uiMove', { g: 3.58, rate: 0.03, max: 2, pv: 0.25 }, (v) => {
    v.o('square', 1600, 0.025, 0.07, { flt: ['lowpass', 4500, 1] });
    v.o('sine', 3200, 0.02, 0.04);
  });
  S('uiSelect', { g: 2.24, rate: 0.06, max: 2, pri: 3, pv: 0.2 }, (v) => {
    v.o('square', 1047, 0.05, 0.08, { flt: ['lowpass', 4000, 1] });
    v.o('square', 1568, 0.1, 0.08, { t: 0.05, flt: ['lowpass', 4000, 1] });
    v.o('sine', 3136, 0.1, 0.04, { t: 0.05 });
  });
  S('uiBack', { g: 2.85, rate: 0.06, max: 2, pri: 3, pv: 0.2 }, (v) => {
    v.o('square', 1175, 0.05, 0.08, { flt: ['lowpass', 3500, 1] });
    v.o('square', 784, 0.1, 0.08, { t: 0.05, flt: ['lowpass', 3000, 1] });
  });
  S('uiOpen', { g: 2.99, rate: 0.1, max: 2, pri: 3, pv: 0.3 }, (v) => {
    v.nz(0.14, 0.2, 'bandpass', 500, { f2: 3500, q: 1.5, a: 0.03 });
    v.o('sine', 600, 0.1, 0.12, { f2: 1250, t: 0.04 });
    v.o('square', 2500, 0.03, 0.035, { t: 0.12 });
  });

  // ================================================================ MUSIC
  const SCALES = {
    minor: [0, 2, 3, 5, 7, 8, 10], phrygian: [0, 1, 3, 5, 7, 8, 10], harm: [0, 2, 3, 5, 7, 8, 11],
    major: [0, 2, 4, 5, 7, 9, 11], dorian: [0, 2, 3, 5, 7, 9, 10],
  };
  // intensity -> layer gain: number = fixed, [lo, hi, min] = min + (1-min)*smoothstep(lo, hi, x)
  const LMAP = { pad: [0, 0.3, 0.85], bass: [0, 0.35, 0.8], arp: [0.05, 0.45, 0.55], beat: [0.08, 0.45, 0.35], perc: [0.25, 0.6, 0], lead: [0.55, 0.85, 0] };
  const DEF_REV = { pad: 0.35, bass: 0, arp: 0.3, lead: 0.28, beat: 0.04, perc: 0.22 };

  class Track {
    constructor(e, name, t0, seed, fade) {
      const ac = e.ac, d = TRACKS[name];
      this.e = e; this.ac = ac; this.d = d; this.name = name;
      this.rng = makeRng((seed ^ hash(name)) >>> 0);
      this.sd = 60 / d.bpm / 4; // one 16th
      this.step = 0; this.next = t0; this.endAt = 0;
      this.root = d.root; this.scale = SCALES[d.scale];
      this.nodes = []; this.srcs = [];
      this.bar = -1; this.sec = -1; this.var = {}; this.deg = 0; this.fill = 0; this.brk = false; this.crashNow = false; this.chordStart = true;
      this.lv = {}; this.offAt = {}; this.lastLead = 0; this.lastLeadEnd = -1;
      const N = (x) => (this.nodes.push(x), x);
      const gain = (v, to) => { const g = N(ac.createGain()); g.gain.value = v; if (to) g.connect(to); return g; };
      this.gain = gain;
      const vol = d.vol || 1, tStart = t0 - 0.05;
      this.fade = gain(0, e.musicBus);
      this.fadeW = gain(0, e.musicVerb);
      for (const p of [this.fade.gain, this.fadeW.gain]) {
        p.setValueAtTime(fade ? 0 : vol, Math.max(0, tStart));
        if (fade) p.linearRampToValueAtTime(vol, t0 + XFADE);
      }
      this.fA = [tStart, fade ? 0 : vol, fade ? t0 + XFADE : tStart + 1e-3, vol];
      this.dry = gain(1, this.fade);
      this.wet = gain(1, this.fadeW);
      // tempo-synced ping delay for arp / lead
      const dd = d.delay || [3, 0.35, 0.3];
      const dl = N(ac.createDelay(2)), dlp = N(ac.createBiquadFilter()), dhp = N(ac.createBiquadFilter());
      dl.delayTime.value = Math.min(1.9, this.sd * dd[0]);
      dlp.type = 'lowpass'; dlp.frequency.value = 2600;
      dhp.type = 'highpass'; dhp.frequency.value = 280;
      this.dIn = gain(1, dl);
      const fb = gain(dd[1], dl);
      dl.connect(dlp); dlp.connect(dhp); dhp.connect(fb);
      const dOut = gain(dd[2], this.dry);
      dhp.connect(dOut); dOut.connect(gain(0.4, this.wet));
      // layers
      const rev = Object.assign({}, DEF_REV, d.rev || {}), dsend = Object.assign({ arp: 0.6, lead: 0.5 }, d.dsend || {});
      this.L = {};
      for (const k of LAYERS) {
        const g = gain(0, this.dry);
        this.L[k] = g;
        if (rev[k]) g.connect(gain(rev[k], this.wet));
        if (dsend[k]) g.connect(gain(dsend[k], this.dIn));
      }
      // pads: padIn -> lowpass (slow LFO) -> pump (kick sidechain) -> gate (trance gate) -> pad layer
      this.padIn = gain(1);
      this.padF = N(ac.createBiquadFilter());
      this.padF.type = 'lowpass'; this.padF.frequency.value = d.padCut || 1500; this.padF.Q.value = 0.8;
      this.pump = gain(1);
      this.gate = gain(1, this.L.pad);
      this.padIn.connect(this.padF); this.padF.connect(this.pump); this.pump.connect(this.gate);
      if (d.lfo) {
        const l = N(ac.createOscillator()), lg = gain(Math.min(d.lfo[1], (d.padCut || 1500) * 0.8));
        l.frequency.value = d.lfo[0];
        l.connect(lg); lg.connect(this.padF.frequency);
        l.start(Math.max(0, tStart)); this.srcs.push(l);
      }
      // distorted bass bus
      if (d.drive) {
        this.bassIn = gain(d.drive[0]);
        const ws = N(ac.createWaveShaper()), lp = N(ac.createBiquadFilter());
        ws.curve = CURVES.hard;
        lp.type = 'lowpass'; lp.frequency.value = d.drive[1]; lp.Q.value = 1;
        this.bassIn.connect(ws); ws.connect(lp); lp.connect(gain(d.drive[2], this.L.bass));
      } else this.bassIn = this.L.bass;
      // saturated kick bus
      if (d.kdrive) {
        this.kickIn = gain(1.6);
        const ws = N(ac.createWaveShaper());
        ws.curve = CURVES.soft;
        this.kickIn.connect(ws); ws.connect(gain(0.6, this.L.beat));
      } else this.kickIn = this.L.beat;
      this.applyInt(e.int, Math.max(0, tStart), true);
      if (d.lead) this.newMotifs(true);
      if (d.init) d.init(this);
    }

    // ---- scheduling
    sched(until) {
      let guard = 0;
      while (this.next < until && guard++ < 96) {
        if (this.endAt && this.next > this.endAt) break;
        const s = this.step, st = s & 15;
        let t = this.next;
        if ((s & 1) && this.d.swing) t += this.d.swing * this.sd;
        if (st === 0) this.onBar(s >> 4);
        try { this.d.step(this, st, t); } catch (err) { this.e.fault(err); }
        this.step++;
        this.next += this.sd;
      }
    }
    skipTo(now) { const k = Math.ceil((now - this.next) / this.sd); if (k > 0) { this.step += k; this.next += k * this.sd; } }
    onBar(bar) {
      const d = this.d;
      this.bar = bar;
      const sec = bar >> 3;
      if (sec !== this.sec) {
        this.sec = sec;
        if (d.lead && sec > 0) this.newMotifs(false);
        this.var = d.vary ? d.vary(this, sec, this.rng) : {};
      }
      const bi = bar & 7;
      this.fill = bi === 7 ? 2 : bi === 3 ? 1 : 0;
      this.brk = !!d.brk && (sec & 3) === 3 && bi < 4;
      this.crashNow = bi === 0 && bar > 0;
      const P = d.progs[(this.var.prog || 0) % d.progs.length], cb = d.cb || 1;
      this.chordStart = bar % cb === 0;
      this.deg = P[Math.floor(bar / cb) % P.length];
    }
    applyInt(x, now, instant) {
      const d = this.d, fl = d.floor || 0, xi = fl + (1 - fl) * x;
      for (const k of LAYERS) {
        const m = d.layers && d.layers[k] != null ? d.layers[k] : LMAP[k];
        const v = typeof m === 'number' ? m : m[2] + (1 - m[2]) * smooth(m[0], m[1], xi);
        if (v < 0.005 && (this.lv[k] || 0) >= 0.005) this.offAt[k] = now + 2.5; // keep playing while it fades
        this.lv[k] = v;
        const p = this.L[k].gain;
        if (instant) p.setValueAtTime(v, now); else p.setTargetAtTime(v, now, 0.35);
      }
    }
    on(k) { return this.lv[k] >= 0.005 || this.next < (this.offAt[k] || 0); }
    fadeVal(t) {
      const f = this.fA;
      if (t <= f[0]) return f[1];
      if (t >= f[2]) return f[3];
      return f[1] + ((f[3] - f[1]) * (t - f[0])) / (f[2] - f[0]);
    }
    fadeOut(now, dur) {
      const v = this.fadeVal(now);
      for (const p of [this.fade.gain, this.fadeW.gain]) {
        p.cancelScheduledValues(now);
        p.setValueAtTime(v, now);
        p.linearRampToValueAtTime(0, now + dur);
      }
      this.endAt = now + dur;
      for (const s of this.srcs) { try { s.stop(now + dur + 0.3); } catch (err) { /* ignore */ } }
    }
    dispose() {
      for (const s of this.srcs) { try { s.stop(); } catch (err) { /* ignore */ } }
      for (const x of this.nodes) { try { x.disconnect(); } catch (err) { /* ignore */ } }
      this.nodes.length = 0; this.srcs.length = 0;
    }

    // ---- theory
    dm(d) { const sc = this.scale, o = Math.floor(d / 7); return this.root + 12 * o + sc[((d % 7) + 7) % 7]; }
    fold(m, lo) { while (m < lo) m += 12; while (m >= lo + 12) m -= 12; return m; }
    chordNotes(deg, n, lo) {
      const out = [];
      for (let i = 0; i < n; i++) out.push(this.fold(this.dm(deg + 2 * i), lo));
      return out.sort((a, b) => a - b);
    }
    rootIn(lo) { return this.fold(this.dm(this.deg), lo); }
    arpNote(i, lo, n) { const ch = this.chordNotes(this.deg, n || 3, lo), k = ch.length; return ch[((i % k) + k) % k] + 12 * Math.floor(i / k); }

    // ---- node helpers (notes clean themselves up when their source ends)
    osc(w, f, det) {
      const o = this.ac.createOscillator();
      o.type = w; o.frequency.value = Math.min(f, this.e.nyq);
      if (det) o.detune.value = det;
      return o;
    }
    gn(v) { const g = this.ac.createGain(); g.gain.value = v; return g; }
    bq(type, f, q) {
      const b = this.ac.createBiquadFilter();
      b.type = type; b.frequency.value = Math.min(f, this.e.nyq); b.Q.value = q == null ? 0.7 : q;
      return b;
    }
    go(srcs, t0, t1, nodes) {
      for (const s of srcs) { s.start(t0); s.stop(t1); }
      if (!this.e.offline) srcs[0].onended = () => { for (const n of nodes) { try { n.disconnect(); } catch (err) { /* ignore */ } } };
    }
    noise(t, d, g, type, f, q, dest, f2) {
      const s = this.ac.createBufferSource(), b = this.bq(type, f, q), eg = this.gn(0);
      s.buffer = this.e.noise; s.loop = true;
      if (f2) { b.frequency.setValueAtTime(Math.min(f, this.e.nyq), t); b.frequency.exponentialRampToValueAtTime(Math.min(f2, this.e.nyq), t + d); }
      eg.gain.setValueAtTime(0, t);
      eg.gain.linearRampToValueAtTime(g, t + 0.001);
      eg.gain.exponentialRampToValueAtTime(0.0005, t + 0.001 + d);
      s.connect(b); b.connect(eg); eg.connect(dest);
      s.start(t, Math.random() * 1.7); s.stop(t + d + 0.02);
      if (!this.e.offline) s.onended = () => { s.disconnect(); b.disconnect(); eg.disconnect(); };
    }
    env(p, t, a, g, dec) { p.setValueAtTime(0, t); p.linearRampToValueAtTime(g, t + a); p.exponentialRampToValueAtTime(0.0005, t + a + dec); }

    // ---- drums
    kick(t, g, o = {}) {
      const f0 = o.f0 || 150, dec = o.dec || 0.32, os = this.osc('sine', f0), eg = this.gn(0);
      os.frequency.setValueAtTime(f0, t);
      os.frequency.exponentialRampToValueAtTime(o.f1 || 44, t + (o.pd || 0.1));
      this.env(eg.gain, t, 0.003, g, dec);
      os.connect(eg); eg.connect(this.kickIn);
      this.go([os], t, t + dec + 0.02, [os, eg]);
      this.noise(t, 0.012, g * (o.click == null ? 0.35 : o.click), 'highpass', 3000, 0.7, this.L.beat);
      if (this.d.pump) this.pumpAt(t);
    }
    snare(t, g, o = {}) {
      const dest = this.L.perc;
      if (o.clap) {
        for (let i = 0; i < 3; i++) this.noise(t + i * 0.011, 0.02, g * 1.4, 'bandpass', 1300, 1.3, dest);
        this.noise(t + 0.033, o.dec || 0.2, g * 1.3, 'bandpass', 1250, 1.1, dest);
      } else {
        this.noise(t, o.dec || 0.17, g * 1.3, 'bandpass', o.f || 1900, 0.8, dest);
        this.noise(t, 0.08, g * 0.6, 'highpass', 5500, 0.7, dest);
      }
      if (o.body !== 0) {
        const f = o.tone || 200, os = this.osc('triangle', f), eg = this.gn(0);
        os.frequency.setValueAtTime(f, t);
        os.frequency.exponentialRampToValueAtTime(f * 0.75, t + 0.08);
        this.env(eg.gain, t, 0.002, g * 0.8, 0.1);
        os.connect(eg); eg.connect(dest);
        this.go([os], t, t + 0.12, [os, eg]);
      }
    }
    hat(t, g, open) { this.noise(t, open ? 0.26 : 0.04, g, 'highpass', open ? 6500 : 8000, 0.8, this.L.beat); }
    crash(t, g) {
      this.noise(t, 1.6, g, 'highpass', 4500, 0.6, this.L.perc);
      this.noise(t, 0.8, g * 0.8, 'bandpass', 3000, 0.8, this.L.perc);
    }
    tom(t, g, f) {
      const os = this.osc('sine', f), eg = this.gn(0);
      os.frequency.setValueAtTime(f, t);
      os.frequency.exponentialRampToValueAtTime(f * 0.55, t + 0.25);
      this.env(eg.gain, t, 0.003, g, 0.3);
      os.connect(eg); eg.connect(this.L.perc);
      this.go([os], t, t + 0.33, [os, eg]);
      this.noise(t, 0.05, g * 0.5, 'bandpass', f * 5, 1.5, this.L.perc);
    }
    metal(t, g, f) { // industrial clank: two detuned squares through a resonant band-pass
      const a = this.osc('square', f), b = this.osc('square', f * 1.4833), bp = this.bq('bandpass', 2600, 2.5), eg = this.gn(0);
      a.connect(bp); b.connect(bp); bp.connect(eg);
      this.env(eg.gain, t, 0.001, g, 0.1);
      eg.connect(this.L.perc);
      this.go([a, b], t, t + 0.13, [a, b, bp, eg]);
    }
    fillStep(st, t, kind, g) {
      if (!this.fill) return false;
      const from = this.fill === 2 ? 8 : 12;
      if (st < from) return false;
      const k = (st - from) / (16 - from);
      if (kind === 'tom') { if (this.fill === 2 || !(st & 1)) this.tom(t, g * (0.7 + 0.3 * k), [260, 230, 200, 175, 150, 130, 110, 95][st - 8]); }
      else this.snare(t, g * (0.3 + 0.7 * k), { body: 0, dec: 0.1 });
      return true;
    }
    pumpAt(t) {
      const a = this.d.pump * Math.min(1, this.lv.beat || 0);
      if (a < 0.02) return;
      const p = this.pump.gain;
      p.setTargetAtTime(1 - a, t, 0.004);
      p.setTargetAtTime(1, t + 0.03, this.sd * 1.1);
    }
    gateAt(t, on, low) { this.gate.gain.setTargetAtTime(on ? 1 : low, t, 0.005); }

    // ---- tonal instruments
    bass(t, m, dur, g, o = {}) {
      const f = mtof(m), cut = o.cut || 600, os = this.osc(o.w || 'sawtooth', f), lp = this.bq('lowpass', cut, o.q == null ? 3 : o.q), eg = this.gn(0);
      const srcs = [os], nodes = [os, lp, eg];
      if (o.w2) { const o2 = this.osc(o.w2, f * (o.mul || 1), 7); o2.connect(lp); srcs.push(o2); nodes.push(o2); }
      if (o.env) { lp.frequency.setValueAtTime(Math.min(this.e.nyq, cut + o.env), t); lp.frequency.setTargetAtTime(cut, t + 0.004, o.dec || 0.07); }
      const a = o.a || 0.004, r = o.r || 0.05, hold = Math.max(a, dur);
      eg.gain.setValueAtTime(0, t);
      eg.gain.linearRampToValueAtTime(g, t + a);
      eg.gain.setValueAtTime(g, t + hold);
      eg.gain.linearRampToValueAtTime(0, t + hold + r);
      os.connect(lp); lp.connect(eg); eg.connect(o.dest || this.bassIn);
      this.go(srcs, t, t + hold + r + 0.02, nodes);
    }
    pluck(t, m, g, o = {}) {
      const cut = o.cut || 2500, dec = o.dec || 0.15, os = this.osc(o.w || 'square', mtof(m), o.det), lp = this.bq('lowpass', cut, o.q == null ? 2 : o.q), eg = this.gn(0);
      lp.frequency.setValueAtTime(Math.min(this.e.nyq, cut), t);
      lp.frequency.exponentialRampToValueAtTime(Math.max(200, cut * 0.25), t + dec);
      this.env(eg.gain, t, 0.003, g, dec);
      os.connect(lp); lp.connect(eg); eg.connect(o.dest || this.L.arp);
      this.go([os], t, t + dec + 0.02, [os, lp, eg]);
    }
    lead(t, m, dur, g, o) {
      const f = mtof(m), cut = o.cut || 2400, eg = this.gn(0), lp = this.bq('lowpass', cut, o.q == null ? 1.5 : o.q);
      const vib = this.osc('sine', o.vr || 5.5), vg = this.gn(0), srcs = [vib], nodes = [eg, lp, vib, vg];
      vib.connect(vg);
      vg.gain.setValueAtTime(0, t);
      vg.gain.linearRampToValueAtTime(f * (o.vd == null ? 0.006 : o.vd), t + Math.min(0.35, dur + 0.01));
      const dets = o.det || [-8, 8], ws = o.w || 'sawtooth', from = o.glideFrom;
      for (let i = 0; i < dets.length; i++) {
        const os = this.osc(Array.isArray(ws) ? ws[i % ws.length] : ws, f, dets[i]);
        if (from) { os.frequency.setValueAtTime(mtof(from), t); os.frequency.exponentialRampToValueAtTime(f, t + (o.glideTime || 0.07)); }
        vg.connect(os.frequency); os.connect(lp);
        srcs.push(os); nodes.push(os);
      }
      const a = o.a || 0.01, r = o.r || 0.12, sus = o.sus == null ? 0.75 : o.sus, hold = Math.max(a, dur);
      eg.gain.setValueAtTime(0, t);
      eg.gain.linearRampToValueAtTime(g, t + a);
      eg.gain.setTargetAtTime(g * sus, t + a, 0.12);
      eg.gain.setTargetAtTime(0, t + hold, r / 6);
      lp.frequency.setValueAtTime(Math.min(this.e.nyq, cut * 1.8), t);
      lp.frequency.setTargetAtTime(cut, t + 0.01, 0.1);
      lp.connect(eg); eg.connect(o.dest || this.L.lead);
      this.go(srcs, t, t + hold + r + 0.03, nodes);
    }
    pad(t, notes, dur, g, o = {}) {
      const a = o.a == null ? 0.5 : o.a, r = o.r == null ? 1 : o.r, det = o.det == null ? 8 : o.det, w = o.w || 'sawtooth';
      const dets = o.dets || [-det, det], hold = Math.max(a, dur), end = t + hold + r;
      for (const m of notes) {
        const eg = this.gn(0), srcs = [], nodes = [eg];
        eg.gain.setValueAtTime(0, t);
        eg.gain.linearRampToValueAtTime(g, t + a);
        eg.gain.setValueAtTime(g, t + hold);
        eg.gain.linearRampToValueAtTime(0, end);
        for (const dt of dets) { const os = this.osc(w, mtof(m), dt); os.connect(eg); srcs.push(os); nodes.push(os); }
        eg.connect(o.dest || this.padIn);
        this.go(srcs, t, end + 0.02, nodes);
      }
    }
    stab(t, notes, g, dur, o = {}) {
      const c = o.cut || 1200, lp = this.bq('lowpass', c, o.q == null ? 2 : o.q), eg = this.gn(0), srcs = [], nodes = [lp, eg];
      lp.frequency.setValueAtTime(Math.min(this.e.nyq, c * 4), t);
      lp.frequency.exponentialRampToValueAtTime(c, t + dur * 0.8);
      for (const m of notes) for (const dt of (o.det || [-10, 10])) { const os = this.osc(o.w || 'sawtooth', mtof(m), dt); os.connect(lp); srcs.push(os); nodes.push(os); }
      this.env(eg.gain, t, 0.004, g, dur);
      lp.connect(eg); eg.connect(o.dest || this.padIn);
      this.go(srcs, t, t + dur + 0.03, nodes);
    }
    bell(t, m, g, dur, o = {}) { // 2-op FM (ratio 1 = e-piano, 3.5 = bell)
      const f = mtof(m), ratio = o.ratio || 3.5, car = this.osc('sine', f), mod = this.osc('sine', f * ratio), mg = this.gn(0), eg = this.gn(0);
      mg.gain.setValueAtTime(f * ratio * (o.idx || 1.2), t);
      mg.gain.exponentialRampToValueAtTime(Math.max(1, f * ratio * 0.02), t + dur * 0.6);
      mod.connect(mg); mg.connect(car.frequency);
      this.env(eg.gain, t, o.a || 0.003, g, dur);
      car.connect(eg); eg.connect(o.dest || this.L.lead);
      this.go([car, mod], t, t + dur + 0.03, [car, mod, mg, eg]);
    }

    // ---- procedural lead motifs (relative scale degrees; they follow the chords)
    genMotif(L) {
      const r = this.rng, by = new Array(32).fill(null);
      let prev = r.pick([0, 2, 4]);
      for (let b = 0; b < 2; b++) {
        const pat = r.pick(L.rhy);
        for (let s = 0; s < 16; s++) {
          if (pat[s] !== 'x') continue;
          let len = 1;
          while (s + len < 16 && pat[s + len] === '-') len++;
          let rel = (s & 3) === 0 ? r.pick(L.strong || [0, 2, 4, 7]) : prev + r.pick([-2, -1, -1, 1, 1, 2]);
          rel = clamp(rel, L.lo == null ? -3 : L.lo, L.hi == null ? 9 : L.hi);
          by[b * 16 + s] = { len, rel };
          prev = rel;
        }
      }
      return by;
    }
    newMotifs(first) {
      const L = this.d.lead, r = this.rng;
      if (first || r.chance(0.3)) this.mA = this.genMotif(L);
      const alt = this.genMotif(L), a2 = this.mA.slice();
      for (let s = 24; s < 32; s++) a2[s] = alt[s];
      for (let s = 0; s < 24; s++) if (a2[s] && r.chance(0.2)) a2[s] = { len: a2[s].len, rel: clamp(a2[s].rel + r.pick([-1, 1, 2]), -3, 10) };
      this.mA2 = a2;
      this.mB = this.genMotif(L);
    }
    leadStep(st, t, g, o) {
      const ph = this.bar & 7, seg = ph < 4 ? this.mA : ph < 6 ? this.mA2 : this.mB;
      const n = seg && seg[((ph & 1) << 4) + st];
      if (n) this.leadNote(t, this.dm(this.deg + n.rel) + (o.oct || 24), n.len, g, o);
    }
    leadNote(t, m, len, g, o) {
      const dur = len * this.sd * (o.leg || 0.92);
      o.glideFrom = o.glide && this.lastLead && t - this.lastLeadEnd < this.sd * 1.5 && this.lastLead !== m ? this.lastLead : 0;
      this.lead(t, m, dur, g, o);
      if (o.dbl) { o.glideFrom = o.glideFrom && o.glideFrom - 12; this.lead(t, m - 12, dur, g * o.dbl, o); }
      this.lastLead = m; this.lastLeadEnd = t + dur;
    }
  }

  // ---------------------------------------------------------------- track definitions
  const ARP8 = [
    [0, 1, 2, 3, 4, 3, 2, 1],
    [0, 2, 1, 3, 2, 4, 3, 5],
    [0, 1, 2, 0, 1, 2, 0, 1],
    [4, 2, 3, 1, 2, 0, 1, -1],
    [0, -1, 2, 1, -1, 3, 2, -1],
  ];
  const RHY_DRIVE = ['x-x-x.x-x-x.x-x.', 'x..x..x.x-x.x...', 'x-.x-.x-x---x-x-', 'x.x.x-x-x-x-x...'];
  const RHY_SING = ['x-----x-x-----..', 'x--x--x-x-------', 'x---x-x-x---..x-', 'x-----..x---x-x-'];
  const RHY_LONG = ['x-------x-------', 'x-----------x---', 'x-------x---x---', 'x-----x-x-------'];
  const KICK4 = ['x...x...x...x...', 'x...x...x...x.x.', 'x..xx...x...x...', 'x...x..xx...x...'];
  const HAT16 = ['xgogxgogxgogxgog', 'gox.gox.gox.goxo', 'x.o.x.o.x.o.x.oo'];
  const SCRAP_BASS = ['x.xx.xx.x.xx.x.o', 'x.x.xxo.x.x.xxo.', 'xxo.xxo.xxo.xoxo'];
  const SCRAP_METAL = ['..x...x...x...x.', '...x..x....x..x.', '..x..x....x.x..x'];
  const SLUMS_GATE = ['x.xx.xx.x.xx.x.x', 'xx.xx.xxx.xx.x.x', 'x.x.x.x.x.x.xxxx'];
  const SLUMS_KICK = ['x.....x.x.......', 'x.......x.......', 'x.....x.x.....x.'];
  const SLUMS_HAT = ['..x...x...x...x.', 'x.o.x.o.x.o.x.o.', 'gox.gox.gox.goxo'];
  // hand-written 4-bar neon hook over Fm-Db-Ab-Eb: [step, semitones above F4, length]
  const SLUMS_HOOK = new Array(64).fill(null);
  [[0, 7, 3], [3, 12, 3], [6, 10, 2], [8, 7, 4], [12, 3, 2], [14, 5, 2], [16, 8, 3], [19, 7, 3], [22, 5, 2], [24, 3, 6], [30, 5, 2],
    [32, 7, 3], [35, 12, 3], [38, 15, 2], [40, 14, 4], [44, 12, 2], [46, 10, 2], [48, 10, 6], [54, 12, 2], [56, 7, 8]]
    .forEach((n) => { SLUMS_HOOK[n[0]] = { semi: n[1], len: n[2] }; });
  const SPIRE_ARP = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 7, 6, 5, 4, 3, 2, 1],
    [0, 2, 4, 6, 1, 3, 5, 7, 2, 4, 6, 8, 3, 5, 7, 9],
    [0, 1, 2, 3, 1, 2, 3, 4, 2, 3, 4, 5, 3, 4, 5, 6],
    [6, 5, 4, 3, 5, 4, 3, 2, 4, 3, 2, 1, 3, 2, 1, 0],
  ];
  const SPIRE_BASS = ['.xxx.xxx.xxx.xxx', 'x.xxx.xxx.xxx.xx', 'xx.xxx.xxx.xx.xo'];
  const CORE_BASS = ['x.xxx.xxx.xxx.xx', 'xoxxxoxxxoxxxoxo', 'x.x.xxx.x.x.xxox'];
  const CORE_STAB = ['x..x..x...x..x..', '..x...x...x...x.', 'x.....x.....x...'];
  const CORE_KICK = ['x...x...x...x...', 'x...x...x...x.xx', 'x.x.x...x.x.x...', 'xx..x...xx..x.x.'];
  const BOSS_STAB = ['x..x..x..x..x.x.', 'x..x..x.x..x..x.', 'x.x...x.x.x...x.'];
  const BOSS_KICK = ['x.x.x.x.x.x.x.x.', 'x...x...x...x...', 'xxx.x.x.xxx.x.xx', 'x.......x.x.....'];
  const BOSS_BASS = ['xxxxxxxxxxxxxxxx', 'x.xxx.xxx.xxx.xx', 'x.x.x.x.x.x.x.x.'];

  const TRACKS = {
    // slow, atmospheric: pads, sub, a distant echoing arp and bell phrases
    title: {
      bpm: 80, root: 45, scale: 'minor', cb: 2, vol: 0.96,
      progs: [[0, 5, 2, 6], [0, 5, 3, 4]],
      layers: { pad: 1, bass: 1, arp: 1, lead: 1, beat: 0, perc: 0 },
      padCut: 1000, lfo: [0.05, 500], delay: [3, 0.5, 0.5], rev: { pad: 0.5, arp: 0.55, lead: 0.7 },
      vary: (tr, sec, r) => ({ prog: sec & 1, arp: r.int(0, ARP8.length - 1), dens: r.pick([0.55, 0.75, 0.9]) }),
      step(tr, st, t) {
        const S = tr.sd, V = tr.var;
        if (st === 0 && tr.chordStart) {
          tr.pad(t, tr.chordNotes(tr.deg, 4, 55), S * 32, 0.045, { a: 1.6, r: 3, det: 9 });
          tr.pad(t, [tr.rootIn(33)], S * 30, 0.2, { w: 'sine', a: 1.2, r: 2, dets: [0], dest: tr.L.bass });
        }
        if (!(st & 1)) {
          const i = ARP8[V.arp][(st >> 1) & 7];
          if (i >= 0 && tr.rng() < V.dens) tr.pluck(t, tr.arpNote(i, 69, 3), 0.05, { w: 'triangle', dec: 0.5, cut: 3200 });
        }
        if ((tr.bar & 3) === 2 && st % 6 === 0) tr.bell(t, tr.arpNote([5, 4, 2][st / 6], 72, 3), 0.035, 2.4);
      },
    },

    // gritty industrial darksynth: distorted 16th bass, metal clanks, four-on-the-floor
    scrap: {
      bpm: 110, root: 40, scale: 'phrygian', cb: 1, vol: 1, pump: 0.35, brk: true,
      progs: [[0, 0, 1, 6], [0, 5, 1, 0], [0, 3, 1, 6]],
      drive: [5, 900, 0.2], padCut: 800, lfo: [0.08, 350], delay: [3, 0.35, 0.3],
      lead: { rhy: RHY_DRIVE, lo: -2, hi: 7 },
      vary: (tr, sec, r) => ({ prog: [0, 0, 1, 2][sec & 3], bass: r.int(0, 2), kick: r.int(0, 3), hat: r.int(0, 2), metal: r.int(0, 2), arp: r.int(0, 4) }),
      step(tr, st, t) {
        const S = tr.sd, V = tr.var;
        if (st === 0) {
          tr.pad(t, tr.chordNotes(tr.deg, 3, 52), S * 16, 0.035, { a: 0.3, r: 0.5, det: 14 });
          if (tr.crashNow && tr.on('perc')) tr.crash(t, 0.1);
        }
        const b = SCRAP_BASS[V.bass][st];
        if (b !== '.') tr.bass(t, tr.rootIn(28) + (b === 'o' ? 12 : 0), S * 0.85, 0.3, { cut: 380, env: 1800, dec: 0.06, q: 5 });
        if (tr.on('arp')) {
          const i = ARP8[V.arp][st & 7];
          if (i >= 0) tr.pluck(t, tr.arpNote(i, 52, 3), 0.03, { w: 'square', dec: 0.09, cut: 2000 });
        }
        if (tr.on('beat')) {
          if (!tr.brk && hit(KICK4[V.kick], st)) tr.kick(t, 0.85, { f0: 160, f1: 42, dec: 0.3 });
          const h = hit(HAT16[V.hat], st);
          if (h) tr.hat(t, 0.1 * h);
          if (st === 14 && V.hat === 1) tr.hat(t, 0.06, true);
        }
        if (tr.on('perc')) {
          if (!tr.fillStep(st, t, 'snare', 0.3) && !tr.brk && (st === 4 || st === 12)) tr.snare(t, 0.32, { clap: true });
          if (hit(SCRAP_METAL[V.metal], st)) tr.metal(t, 0.05, 320 + 40 * (st & 3));
        }
        if (tr.on('lead')) tr.leadStep(st, t, 0.045, { oct: 24, det: [-12, 0, 12], cut: 2000 });
      },
    },

    // melancholic neon synthwave: gated pads, octave bass, big snare, rain, catchy hook
    slums: {
      bpm: 96, root: 41, scale: 'minor', cb: 1, vol: 0.708, pump: 0.2, brk: true,
      progs: [[0, 5, 2, 6], [3, 5, 6, 4]],
      padCut: 1600, lfo: [0.06, 600], delay: [3, 0.42, 0.4], rev: { pad: 0.4, perc: 0.4, lead: 0.3 },
      lead: { rhy: RHY_SING, lo: -1, hi: 9 },
      init(tr) { // rain hiss bed
        const ac = tr.ac, s = ac.createBufferSource(), bp = ac.createBiquadFilter(), g = tr.gain(0.05, tr.dry);
        s.buffer = tr.e.noise; s.loop = true;
        bp.type = 'bandpass'; bp.frequency.value = 5000; bp.Q.value = 0.4;
        s.connect(bp); bp.connect(g);
        tr.nodes.push(s, bp); tr.srcs.push(s);
        s.start(Math.max(0, tr.next - 0.05));
      },
      vary: (tr, sec, r) => ({ prog: sec % 3 === 2 ? 1 : 0, gate: r.int(-1, 2), arp: r.int(0, 4), hat: r.int(0, 2), kick: r.int(0, 2), orn: r.chance(0.5) }),
      step(tr, st, t) {
        const S = tr.sd, V = tr.var;
        if (st === 0) {
          tr.pad(t, tr.chordNotes(tr.deg, 4, 53), S * 16, 0.04, { a: 0.02, r: 0.3, det: 10 });
          if (tr.crashNow && tr.on('perc')) tr.crash(t, 0.08);
        }
        tr.gateAt(t, V.gate < 0 || SLUMS_GATE[V.gate][st] === 'x', 0.12);
        if (!(st & 1)) tr.bass(t, tr.rootIn(29) + [0, 0, 12, 0, 0, 12, 0, 12][st >> 1], S * 1.6, 0.22, { w: 'sawtooth', w2: 'square', cut: 520, env: 900, dec: 0.09 });
        if (tr.on('arp')) {
          const i = ARP8[V.arp][st & 7];
          if (i >= 0) tr.pluck(t, tr.arpNote(i, 65, 3), 0.03, { w: 'triangle', dec: 0.14, cut: 3000 });
          if (tr.rng() < 0.04) tr.bell(t, tr.dm(tr.deg + tr.rng.pick([0, 2, 4, 7, 9])) + 36, 0.02, 0.7, { ratio: 2, idx: 0.6, dest: tr.L.arp });
        }
        if (tr.on('beat')) {
          if (!tr.brk && hit(SLUMS_KICK[V.kick], st)) tr.kick(t, 0.85, { f0: 130, f1: 40, dec: 0.4 });
          const h = hit(SLUMS_HAT[V.hat], st);
          if (h) tr.hat(t, 0.08 * h);
        }
        if (tr.on('perc') && !tr.fillStep(st, t, 'snare', 0.25) && !tr.brk && (st === 4 || st === 12)) tr.snare(t, 0.4, { dec: 0.25, tone: 180 });
        if (tr.on('lead')) {
          const o = { w: ['square', 'sawtooth'], det: [-6, 6], cut: 2600, glide: true, glideTime: 0.05, vd: 0.007 };
          if ((V.prog || 0) === 0) {
            const n = SLUMS_HOOK[((tr.bar & 3) << 4) + st];
            if (n) tr.leadNote(t, 65 + n.semi + (V.orn && (tr.bar & 4) && n.len <= 3 && (st & 4) ? 12 : 0), n.len, 0.05, o);
          } else tr.leadStep(st, t, 0.05, Object.assign(o, { oct: 24 }));
        }
      },
    },

    // tense and cold: fast climbing arps, rolling off-beat bass, harmonic minor
    spire: {
      bpm: 124, root: 47, scale: 'harm', cb: 2, vol: 1.109, pump: 0.3, brk: true,
      progs: [[0, 5, 3, 4], [0, 3, 5, 4], [5, 3, 0, 4]],
      padCut: 2400, lfo: [0.11, 900], delay: [3, 0.4, 0.35],
      lead: { rhy: RHY_LONG, lo: 0, hi: 9, strong: [0, 2, 4] },
      vary: (tr, sec, r) => ({ prog: [0, 0, 1, 2][sec & 3], arp: r.int(0, 3), bass: r.int(0, 2), hat: r.int(0, 1), arpLo: r.pick([59, 59, 64]) }),
      step(tr, st, t) {
        const S = tr.sd, V = tr.var;
        if (st === 0 && tr.chordStart) {
          const ch = tr.chordNotes(tr.deg, 3, 59);
          tr.pad(t, ch, S * 32, 0.025, { a: 0.8, r: 1.2, det: 6 });
          tr.pad(t, ch.map((m) => m + 12), S * 32, 0.03, { w: 'triangle', a: 1, r: 1.2, det: 4 });
        }
        if (st === 0 && tr.crashNow && tr.on('perc')) tr.crash(t, 0.08);
        if (tr.on('arp')) tr.pluck(t, tr.arpNote(SPIRE_ARP[V.arp][st], V.arpLo, 3), 0.03, { w: 'square', dec: 0.07, cut: 3800 });
        const b = SPIRE_BASS[V.bass][st];
        if (b !== '.') tr.bass(t, tr.rootIn(35) + (b === 'o' ? 12 : 0), S * 0.7, 0.26, { cut: 450, env: 1200, dec: 0.05 });
        if (tr.on('beat')) {
          if (!tr.brk && !(st & 3)) tr.kick(t, 0.85, { f0: 150, f1: 45, dec: 0.28 });
          tr.hat(t, (st & 3) === 2 ? 0.09 : 0.045);
          if (V.hat && (st & 3) === 2) tr.hat(t, 0.045, true);
        }
        if (tr.on('perc') && !tr.fillStep(st, t, 'snare', 0.28) && !tr.brk && (st === 4 || st === 12)) tr.snare(t, 0.3, { clap: true, dec: 0.16 });
        if (tr.on('lead')) {
          tr.leadStep(st, t, 0.04, { oct: 24, det: [-7, 7], cut: 3000, glide: true, a: 0.05, r: 0.3 });
          if (tr.step % 3 === 0) tr.pluck(t, tr.arpNote([0, 2, 1, 3][(tr.step / 3) & 3], 83, 3), 0.02, { w: 'triangle', dec: 0.2, cut: 5000, dest: tr.L.lead });
        }
      },
    },

    // calm lo-fi: swung FM e-piano, warm sine bass, soft drums, vinyl crackle
    transit: {
      bpm: 72, root: 50, scale: 'major', cb: 1, vol: 1.021, swing: 0.16,
      progs: [[0, 5, 1, 4], [0, 3, 5, 4]],
      layers: { pad: 1, bass: 1, arp: 1, lead: [0.2, 0.8, 0.6], beat: 0.6, perc: 0.55 },
      padCut: 3200, lfo: [0.05, 800], delay: [4, 0.35, 0.35], rev: { pad: 0.3, arp: 0.5, lead: 0.4, perc: 0.3 },
      lead: { rhy: ['x-----..x-x-----', '....x---x-----..', 'x---..x-x-------', '..x-x-----..x---'], lo: 0, hi: 9, strong: [0, 2, 4, 6] },
      init(tr) { // tape hiss bed
        const ac = tr.ac, s = ac.createBufferSource(), bp = ac.createBiquadFilter(), g = tr.gain(0.012, tr.dry);
        s.buffer = tr.e.noise; s.loop = true; s.playbackRate.value = 0.5;
        bp.type = 'lowpass'; bp.frequency.value = 4500;
        s.connect(bp); bp.connect(g);
        tr.nodes.push(s, bp); tr.srcs.push(s);
        s.start(Math.max(0, tr.next - 0.05));
      },
      vary: (tr, sec, r) => ({ prog: sec % 3 === 2 ? 1 : 0, comp: r.int(0, 1) }),
      step(tr, st, t) {
        const S = tr.sd, V = tr.var;
        const ch = tr.chordNotes(tr.deg, 4, 57);
        if (st === 0) {
          for (const m of ch) tr.bell(t, m, 0.03, 1.8, { ratio: 1, idx: 1.1, dest: tr.padIn });
          tr.pad(t, ch.slice(0, 3).map((m) => m - 12), S * 16, 0.02, { w: 'triangle', a: 0.5, r: 0.9, det: 5, dest: tr.L.pad });
        }
        if (st === (V.comp ? 7 : 10)) for (const m of ch) tr.bell(t, m, 0.018, 0.9, { ratio: 1, idx: 0.9, dest: tr.padIn });
        if (st === 0) tr.bass(t, tr.rootIn(38), S * 6, 0.3, { w: 'triangle', cut: 800, q: 0.7, r: 0.1 });
        if (st === 10) tr.bass(t, tr.fold(tr.dm(tr.deg + 4), 38), S * 4, 0.24, { w: 'triangle', cut: 800, q: 0.7, r: 0.1 });
        if (hit('x......x..x.....', st)) tr.kick(t, 0.5, { f0: 100, f1: 45, dec: 0.25, click: 0.05 });
        const h = hit('xgogxgogxgogxgog', st);
        if (h) tr.hat(t, 0.045 * h);
        if (tr.rng() < 0.35) tr.noise(t, 0.004, 0.015, 'highpass', 3000, 0.7, tr.L.beat);
        if (st === 4 || st === 12) tr.snare(t, 0.12, { f: 2600, dec: 0.06, body: 0 });
        tr.leadStep(st, t, 0.035, { oct: 12, w: 'triangle', det: [0], cut: 2200, vd: 0.004, r: 0.3 });
      },
    },

    // aggressive 140: galloping distorted bass, saw stabs, detuned saw lead, heavy drums
    core: {
      bpm: 140, root: 37, scale: 'phrygian', cb: 1, vol: 0.892, floor: 0.25, pump: 0.3, brk: true,
      progs: [[0, 0, 5, 6], [0, 1, 0, 6], [5, 6, 0, 1]],
      drive: [6, 1300, 0.18], kdrive: true, padCut: 1800, lfo: [0.2, 600], delay: [3, 0.3, 0.25],
      lead: { rhy: RHY_DRIVE, lo: -2, hi: 7 },
      vary: (tr, sec, r) => ({ prog: [0, 1, 0, 2][sec & 3], bass: r.int(0, 2), stab: r.int(0, 2), kick: r.int(0, 3), arp: r.int(0, 4) }),
      step(tr, st, t) {
        const S = tr.sd, V = tr.var;
        if (st === 0) {
          tr.pad(t, tr.chordNotes(tr.deg, 3, 49), S * 16, 0.022, { a: 0.1, r: 0.3, det: 12 });
          if (tr.crashNow && tr.on('perc')) tr.crash(t, 0.1);
        }
        if (hit(CORE_STAB[V.stab], st)) tr.stab(t, tr.chordNotes(tr.deg, 3, 61), 0.05, 0.18, { cut: 900 });
        const b = CORE_BASS[V.bass][st];
        if (b !== '.') tr.bass(t, tr.rootIn(25) + (b === 'o' ? 12 : 0), S * 0.8, 0.3, { cut: 300, env: 2200, dec: 0.05, q: 4 });
        if (tr.on('arp')) {
          const i = ARP8[V.arp][st & 7];
          if (i >= 0) tr.pluck(t, tr.arpNote(i, 61, 3), 0.022, { w: 'sawtooth', dec: 0.08, cut: 2600 });
        }
        if (tr.on('beat')) {
          if (!tr.brk && hit(CORE_KICK[V.kick], st)) tr.kick(t, 0.85, { f0: 170, f1: 45, dec: 0.26 });
          tr.hat(t, (st & 1) ? 0.05 : 0.085);
        }
        if (tr.on('perc') && !tr.fillStep(st, t, 'tom', 0.35) && !tr.brk && (st === 4 || st === 12)) tr.snare(t, 0.38, { tone: 190 });
        if (tr.on('lead')) tr.leadStep(st, t, 0.04, { oct: 24, det: [-15, 0, 15], cut: 2600, dbl: 0.5 });
      },
    },

    // boss: dotted-quarter saw stabs, siren lead with glides, double kicks, half-time drops
    boss: {
      bpm: 140, root: 45, scale: 'harm', cb: 1, vol: 0.616, floor: 0.45, pump: 0.25,
      progs: [[0, 0, 5, 4], [0, 5, 3, 4], [3, 4, 0, 0]],
      drive: [7, 1200, 0.18], kdrive: true, padCut: 1500, lfo: [0.15, 700], delay: [2, 0.3, 0.25],
      lead: { rhy: RHY_LONG.concat(['x---x---x---x---']), lo: 0, hi: 9, strong: [0, 2, 4, 7] },
      vary: (tr, sec, r) => {
        const half = (sec & 3) === 2;
        return { prog: [0, 1, 0, 2][sec & 3], half, kick: half ? 3 : r.int(0, 2), bass: half ? 2 : r.int(0, 1), stab: r.int(0, 2), arp: r.int(0, 4) };
      },
      step(tr, st, t) {
        const S = tr.sd, V = tr.var;
        if (st === 0) {
          tr.pad(t, tr.chordNotes(tr.deg, 3, 57), S * 16, 0.022, { a: 0.15, r: 0.4, det: 14 });
          if ((tr.bar & 3) === 0 && tr.bar > 0 && tr.on('perc')) tr.crash(t, 0.1);
        }
        if (hit(BOSS_STAB[V.stab], st)) tr.stab(t, tr.chordNotes(tr.deg, 4, 57), 0.04, 0.22, { cut: 1400 });
        const b = BOSS_BASS[V.bass][st];
        if (b !== '.') tr.bass(t, tr.rootIn(33) + ((st & 7) === 6 ? 7 : 0), S * 0.8, 0.28, { cut: 350, env: 2000, dec: 0.05, q: 4 });
        if (tr.on('arp')) {
          const i = ARP8[V.arp][st & 7];
          if (i >= 0) tr.pluck(t, tr.arpNote(i, 69, 3), 0.02, { w: 'square', dec: 0.07, cut: 3500 });
        }
        if (tr.on('beat')) {
          if (hit(BOSS_KICK[V.kick], st)) tr.kick(t, 0.85, { f0: 170, f1: 42, dec: 0.24 });
          tr.hat(t, (st & 1) ? 0.045 : 0.08);
        }
        if (tr.on('perc') && !tr.fillStep(st, t, 'tom', 0.35) && (V.half ? st === 8 : st === 4 || st === 12)) tr.snare(t, 0.4, { tone: 180 });
        if (tr.on('lead')) tr.leadStep(st, t, 0.045, { oct: 24, det: [-16, 0, 16], cut: 3000, glide: true, glideTime: 0.09, dbl: 0.4 });
      },
    },
  };

  // ================================================================ engine
  class Engine {
    constructor(ac, offline) {
      this.ac = ac; this.offline = !!offline; this.vnow = null; this.errors = 0;
      this.nyq = ac.sampleRate * 0.45;
      this.noise = makeNoise(ac, 2);
      const gain = (v) => { const g = ac.createGain(); g.gain.value = v; return g; };
      // master (headroom) -> compressor (catches SFX pile-ups) -> trim (cancels the compressor's
      // automatic makeup gain, so the chain is unity below threshold) -> soft safety limiter -> out
      this.master = gain(0.72);
      const c = (this.comp = ac.createDynamicsCompressor());
      c.threshold.value = -4; c.knee.value = 6; c.ratio.value = 5; c.attack.value = 0.002; c.release.value = 0.15;
      this.trim = gain(MAKEUP_TRIM);
      this.limPre = gain(0.5);
      this.lim = ac.createWaveShaper();
      this.lim.curve = CURVES.limit;
      this.master.connect(c); c.connect(this.trim); this.trim.connect(this.limPre); this.limPre.connect(this.lim); this.lim.connect(ac.destination);
      this.sfxBus = gain(1); this.sfxVol = gain(0.64);
      this.sfxBus.connect(this.sfxVol); this.sfxVol.connect(this.master);
      this.sfxVerb = ac.createConvolver();
      this.sfxVerb.buffer = makeImpulse(ac, 1.4, 3);
      this.sfxVerb.connect(this.sfxBus);
      this.musicBus = gain(0.8); this.musicVol = gain(0.36); this.duckG = gain(1);
      this.musicBus.connect(this.musicVol); this.musicVol.connect(this.duckG); this.duckG.connect(this.master);
      this.musicVerb = ac.createConvolver();
      this.musicVerb.buffer = makeImpulse(ac, 2.8, 2.6);
      this.musicVerb.connect(this.musicBus);
      this.voices = []; this.last = Object.create(null); this.tracks = []; this.cur = null; this.want = null;
      this.int = 0.5; this.intApplied = 0.5; this.intT = -1;
      this.D = null; // duck state
      this.peakVoices = 0;
    }
    now() { return this.vnow != null ? this.vnow : this.ac.currentTime; }
    fault(err) { this.errors++; if (this.errors < 4) console.warn('[audio]', err); }
    // test taps: 'comp' = skip the safety limiter, 'raw' = skip compressor and limiter
    bypass(mode) {
      if (mode === 'raw') { this.master.disconnect(); this.master.connect(this.ac.destination); }
      else { this.trim.disconnect(); this.trim.connect(this.ac.destination); }
    }
    setVolumes(m, s, tc) {
      const t = this.now();
      const set = (p, v) => { v = clamp(num(v, 1), 0, 1); v *= v; if (tc) p.setTargetAtTime(v, t, tc); else p.setValueAtTime(v, t); };
      if (m != null) set(this.musicVol.gain, m);
      if (s != null) set(this.sfxVol.gain, s);
    }
    setIntensity(x, instant) {
      this.int = clamp(num(x, 0), 0, 1);
      if (instant) { const t = this.now(); this.intApplied = this.int; this.intT = t; for (const tr of this.tracks) if (!tr.endAt) tr.applyInt(this.int, t, true); }
    }
    play(name, o) {
      const def = SFX[name];
      if (!def) return null;
      const c = def.c, t = this.now();
      const lp = this.last[name];
      if (lp != null && t >= lp && t - lp < c.rate) return null;
      this.purge(t);
      let same = 0, first = null, alive = 0;
      for (const v of this.voices) {
        if (v.dead) continue;
        alive++;
        if (v.name === name) { same++; if (!first) first = v; }
      }
      if (same >= c.max && first) { first.kill(t); alive--; }
      if (alive >= MAX_VOICES) { // steal the oldest voice with the lowest priority (never a more important one)
        let victim = null;
        for (const v of this.voices) if (!v.dead && v.pri <= c.pri && (!victim || v.pri < victim.pri)) victim = v;
        if (!victim) return null;
        victim.kill(t);
      }
      const vol = clamp(num(o.vol, 1), 0, 4) * c.g;
      if (vol <= 0.0001) return null;
      this.last[name] = t;
      const pitch = o.pitch != null ? clamp(num(o.pitch, 1), 0.25, 4) : 1 + (Math.random() * 2 - 1) * 0.04 * c.pv;
      const v = new Voice(this, name, c, t, vol, pitch, num(o.pan, 0));
      try { def.fn(v); } catch (err) { this.fault(err); v.kill(t); }
      if (c.verb) v.verb(c.verb);
      v.end += v.tail;
      this.voices.push(v);
      let n = 0;
      for (const x of this.voices) if (!x.dead) n++;
      if (n > this.peakVoices) this.peakVoices = n;
      if (c.duck) this.duck(c.duck[0], c.duck[1]);
      return v;
    }
    purge(now) {
      const vs = this.voices;
      for (let i = vs.length - 1; i >= 0; i--) {
        if (vs[i].end < now - 0.05) { if (!this.offline) vs[i].dispose(); vs.splice(i, 1); }
      }
    }
    music(name, seed, fade = true) {
      if (name === undefined) name = null;
      if (name === this.want) return;
      if (name !== null && !TRACKS[name]) return;
      this.want = name;
      const now = this.now();
      if (this.cur) { this.cur.fadeOut(now, XFADE); this.cur = null; }
      if (name) {
        const tr = new Track(this, name, now + 0.05, seed != null ? seed : (Math.random() * 4294967296) >>> 0, fade);
        this.tracks.push(tr);
        this.cur = tr;
        if (!this.offline) tr.sched(now + LOOKAHEAD);
      }
    }
    duckVal(t) {
      const D = this.D;
      if (!D || t >= D.rel) return 1;
      if (t >= D.end) return D.lvl + ((1 - D.lvl) * (t - D.end)) / (D.rel - D.end);
      if (t >= D.tA) return D.lvl;
      return D.v0 + ((D.lvl - D.v0) * (t - D.t0)) / (D.tA - D.t0);
    }
    duck(amount, time) {
      const now = this.now(), p = this.duckG.gain, D = this.D;
      const lvl = clamp(1 - num(amount, 0.5), 0, 1), hold = clamp(num(time, 0.6), 0, 30);
      const active = D && now < D.end;
      const L = active ? Math.min(lvl, D.lvl) : lvl;
      const end = Math.max(now + 0.05 + hold, active ? D.end : 0), cur = this.duckVal(now);
      p.cancelScheduledValues(now);
      p.setValueAtTime(cur, now);
      p.linearRampToValueAtTime(L, now + 0.05);
      p.setValueAtTime(L, end);
      p.linearRampToValueAtTime(1, end + 0.8);
      this.D = { lvl: L, t0: now, v0: cur, tA: now + 0.05, end, rel: end + 0.8 };
    }
    update(now) {
      if (Math.abs(this.int - this.intApplied) > 0.004 && now - this.intT >= 0.1) {
        this.intApplied = this.int; this.intT = now;
        for (const tr of this.tracks) if (!tr.endAt) tr.applyInt(this.int, now, false);
      }
      for (let i = this.tracks.length - 1; i >= 0; i--) {
        const tr = this.tracks[i];
        if (tr.endAt && now > tr.endAt + 0.25) { if (!this.offline) tr.dispose(); this.tracks.splice(i, 1); continue; }
        if (!this.offline && tr.next < now - 0.05) tr.skipTo(now); // resumed after a stall: skip, never burst
        tr.sched(now + LOOKAHEAD);
      }
      this.purge(now);
    }
    stats() {
      return { voices: this.voices.filter((v) => !v.dead).length, peakVoices: this.peakVoices, voiceNodes: this.voices.length, tracks: this.tracks.map((t) => t.name), track: this.want, intensity: this.int, errors: this.errors };
    }
  }

  // ================================================================ public API
  let eng = null, ctx = null, broken = false, timer = 0, autoSusp = false;
  const pend = { track: undefined, vol: null, int: 0.5 };

  function settingsVol() {
    const s = G.settings || {};
    return { music: clamp(num(s.music, 0.6), 0, 1), sfx: clamp(num(s.sfx, 0.8), 0, 1) };
  }
  function tick() {
    if (!eng || !ctx) return;
    try {
      if (ctx.state !== 'running' || (typeof document !== 'undefined' && document.hidden)) return;
      eng.update(ctx.currentTime);
    } catch (err) { if (eng) eng.fault(err); }
  }
  function onVisibility() {
    if (!ctx) return;
    try {
      if (document.hidden) { if (ctx.state === 'running') { autoSusp = true; quiet(ctx.suspend()); } }
      else if (autoSusp) { autoSusp = false; quiet(ctx.resume()); }
    } catch (err) { /* ignore */ }
  }
  function create() {
    try {
      try { ctx = new AC({ latencyHint: 'interactive' }); } catch (err) { ctx = new AC(); }
      eng = new Engine(ctx, false);
      const v = pend.vol || settingsVol();
      eng.setVolumes(v.music, v.sfx, 0);
      eng.setIntensity(pend.int, false);
      eng.intApplied = eng.int;
      timer = setInterval(tick, TICK_MS);
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
      // iOS unlock: a silent one-sample buffer started inside the gesture
      const b = ctx.createBuffer(1, 1, ctx.sampleRate), s = ctx.createBufferSource();
      s.buffer = b; s.connect(ctx.destination); s.start(0);
      if (pend.track !== undefined) eng.music(pend.track);
    } catch (err) {
      broken = true;
      if (timer) clearInterval(timer);
      timer = 0;
      try { if (ctx && ctx.close) quiet(ctx.close()); } catch (e2) { /* ignore */ }
      ctx = null; eng = null;
    }
  }

  const A = {
    // Create / resume the AudioContext. Call from a user gesture; idempotent and cheap.
    init() {
      if (broken || !AC) return false;
      try {
        if (!ctx) create();
        if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') { autoSusp = false; quiet(ctx.resume()); }
      } catch (err) { /* ignore */ }
      return A.ready;
    },
    // One-shot SFX. Returns a handle with stop(fade) (useful for 'charge'), or null.
    play(name, opts) {
      if (!eng) return null;
      try { return eng.play(name, opts || {}); } catch (err) { eng.fault(err); return null; }
    },
    // Music track by name, or null to stop. Crossfades; same track = no-op.
    music(track) {
      if (track === undefined) track = null;
      if (track !== null && !TRACKS[track]) return;
      pend.track = track;
      if (!eng) return;
      try { eng.music(track); } catch (err) { eng.fault(err); }
    },
    setVolumes(v) {
      if (!v) return;
      const cur = pend.vol || settingsVol();
      pend.vol = { music: v.music != null ? clamp(num(v.music, cur.music), 0, 1) : cur.music, sfx: v.sfx != null ? clamp(num(v.sfx, cur.sfx), 0, 1) : cur.sfx };
      if (eng) { try { eng.setVolumes(pend.vol.music, pend.vol.sfx, 0.03); } catch (err) { eng.fault(err); } }
    },
    // Lower the music by `amount` (0..1) for `time` seconds, then recover.
    duck(amount, time) {
      if (!eng) return;
      try { eng.duck(amount, time); } catch (err) { eng.fault(err); }
    },
    // 0..1 combat intensity; may be called every frame (applied smoothly, max 10x/s).
    intensity(x) {
      pend.int = clamp(num(x, 0), 0, 1);
      if (eng) eng.int = pend.int;
    },
    get ready() { return !!(ctx && eng && ctx.state === 'running'); },
    get current() { return pend.track === undefined ? null : pend.track; },
    names: Object.keys(SFX),
    tracks: Object.keys(TRACKS),
    stats() { return eng ? eng.stats() : null; },
    get context() { return ctx; },
    _engine() { return eng; },
    // Test helper: render music and/or SFX into an AudioBuffer with an OfflineAudioContext.
    // o: {seconds, sampleRate, track, seed, intensity, music, sfx (volumes 0..1), fade,
    //     limiter (false = compressor output without the safety limiter, 'raw' = master bus), plays: [[name, time, opts]],
    //     musicAt: [[time, track]], intensityAt: [[time, x]], duckAt: [[time, amount, secs]]}
    renderOffline(o) {
      o = o || {};
      if (!OAC) return Promise.resolve(null);
      try {
        const sr = o.sampleRate || 44100, sec = o.seconds || 4;
        const ac = new OAC(2, Math.ceil(sr * sec), sr), e = new Engine(ac, true);
        e.vnow = 0;
        if (o.limiter === false || o.limiter === 'raw') e.bypass(o.limiter === 'raw' ? 'raw' : 'comp');
        e.setVolumes(o.music != null ? o.music : 1, o.sfx != null ? o.sfx : 1, 0);
        e.setIntensity(o.intensity != null ? o.intensity : 0.5, true);
        const ev = [];
        if (o.track) ev.push([0, 'music', o.track]);
        for (const m of o.musicAt || []) ev.push([m[0], 'music', m[1]]);
        for (const p of o.plays || []) ev.push([p[1] || 0, 'play', p[0], p[2]]);
        for (const x of o.intensityAt || []) ev.push([x[0], 'int', x[1]]);
        for (const x of o.duckAt || []) ev.push([x[0], 'duck', x[1], x[2]]);
        ev.sort((a, b) => a[0] - b[0]);
        let ei = 0;
        for (let t = 0; t <= sec; t += 0.025) {
          while (ei < ev.length && ev[ei][0] <= t + 1e-9) {
            const x = ev[ei++];
            e.vnow = x[0];
            if (x[1] === 'music') e.music(x[2], o.seed != null ? o.seed : 1, o.fade != null ? o.fade : x[0] > 0);
            else if (x[1] === 'play') e.play(x[2], x[3] || {});
            else if (x[1] === 'int') e.setIntensity(x[2], false);
            else if (x[1] === 'duck') e.duck(x[2], x[3]);
          }
          e.vnow = t;
          e.update(t);
        }
        e.vnow = null;
        const pr = ac.startRendering();
        const stats = e.stats();
        return pr.then((buf) => { buf.engineStats = stats; return buf; });
      } catch (err) { return Promise.reject(err); }
    },
  };
  G.audio = A;

  // Safety net: resume/create on any user gesture even if the game forgets to call init().
  if (typeof window !== 'undefined' && window.addEventListener) {
    const onGesture = () => { if (!ctx || ctx.state !== 'running') A.init(); };
    for (const ev of ['pointerdown', 'mousedown', 'keydown', 'touchend']) window.addEventListener(ev, onGesture, { capture: true, passive: true });
  }
})();
