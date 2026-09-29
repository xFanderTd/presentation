'use strict';
// DEAD CIRCUITS — core: namespace, math, RNG, palette, pixel drawing, bitmap font,
// input (keyboard / mouse / gamepad / touch), camera, event bus.
(function () {
  const G = (window.G = window.G || {});
  G.VERSION = '0.9';
  G.W = 480;           // internal render width (px)
  G.H = 270;           // internal render height (px)
  G.TILE = 16;         // tile size (px)
  G.DT = 1 / 60;       // fixed simulation step
  G.GRAVITY = 1150;    // px/s^2

  // Tile codes (see ARCHITECTURE.md)
  G.T = { AIR: 0, SOLID: 1, PLATFORM: 2, LADDER: 3, SPIKES: 4 };

  // ---------------------------------------------------------------- math
  G.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  G.lerp = (a, b, t) => a + (b - a) * t;
  G.approach = (v, t, d) => (v < t ? Math.min(v + d, t) : Math.max(v - d, t));
  G.sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
  G.dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
  G.overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  G.easeOut = (t) => 1 - (1 - t) * (1 - t) * (1 - t);
  G.easeIn = (t) => t * t * t;
  G.easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  G.angleLerp = (a, b, t) => {
    let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  };
  G.hashStr = (s) => {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  };

  // ---------------------------------------------------------------- RNG (mulberry32)
  class RNG {
    constructor(seed) { this.s = (seed >>> 0) || 0x9e3779b9; }
    next() {
      let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    float(a = 0, b = 1) { return a + (b - a) * this.next(); }
    int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); } // inclusive
    chance(p) { return this.next() < p; }
    pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
    sign() { return this.next() < 0.5 ? -1 : 1; }
    // list of [item, weight]
    weighted(list) {
      let total = 0;
      for (const e of list) total += e[1];
      let r = this.next() * total;
      for (const e of list) { r -= e[1]; if (r <= 0) return e[0]; }
      return list[list.length - 1][0];
    }
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(this.next() * (i + 1));
        const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    }
    fork() { return new RNG(Math.floor(this.next() * 4294967296)); }
  }
  G.RNG = RNG;
  G.rand = new RNG((Math.random() * 4294967296) >>> 0); // cosmetic randomness only

  // ---------------------------------------------------------------- palette
  G.PAL = {
    ink: '#05040a', outline: '#0b0814', bg0: '#07060d', bg1: '#0e0b1c', bg2: '#171330',
    steel0: '#1b1a2e', steel1: '#2b2a45', steel2: '#45466a', steel3: '#6f7299', steel4: '#aab0d6',
    cyan: '#27f3ff', cyanDim: '#0e8fa6', magenta: '#ff2a8a', pink: '#ff5cc8', violet: '#9b5cff',
    yellow: '#ffe14d', orange: '#ff8a2a', red: '#ff3348', green: '#48ff8a', lime: '#b6ff3b',
    white: '#f4f1ff', skin: '#c9a48c',
    brutality: '#ff3d4f', tactics: '#b46cff', survival: '#4dff7a',
    cells: '#35c8ff', gold: '#ffc23d',
  };
  G.STAT_COLOR = { brutality: G.PAL.brutality, tactics: G.PAL.tactics, survival: G.PAL.survival };

  // ---------------------------------------------------------------- pixel drawing
  // All coordinates are rounded so primitives stay on the pixel grid.
  G.px = {
    rect(ctx, x, y, w, h, c) {
      if (c) ctx.fillStyle = c;
      ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    },
    // Bresenham line with a square brush of size t
    line(ctx, x0, y0, x1, y1, c, t = 1) {
      if (c) ctx.fillStyle = c;
      x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
      const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      const o = (t / 2) | 0;
      for (let guard = 0; guard < 2000; guard++) {
        ctx.fillRect(x0 - o, y0 - o, t, t);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
      }
    },
    disc(ctx, cx, cy, r, c) {
      if (c) ctx.fillStyle = c;
      cx = Math.round(cx); cy = Math.round(cy); r = Math.max(0, Math.round(r));
      for (let y = -r; y <= r; y++) {
        const hw = Math.floor(Math.sqrt(r * r - y * y) + 0.5);
        ctx.fillRect(cx - hw, cy + y, hw * 2 + 1, 1);
      }
    },
    ring(ctx, cx, cy, r, c, t = 1) {
      if (c) ctx.fillStyle = c;
      cx = Math.round(cx); cy = Math.round(cy); r = Math.round(r);
      const steps = Math.max(12, Math.floor(r * 6.3));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        ctx.fillRect(Math.round(cx + Math.cos(a) * r) - (t >> 1), Math.round(cy + Math.sin(a) * r) - (t >> 1), t, t);
      }
    },
  };

  // Cached radial-gradient sprites for additive glows.
  const glowCache = new Map();
  G.glowSprite = function (color, r) {
    r = Math.max(2, Math.round(r / 2) * 2);
    const key = color + '|' + r;
    let c = glowCache.get(key);
    if (!c) {
      c = document.createElement('canvas');
      c.width = c.height = r * 2;
      const g = c.getContext('2d');
      const grd = g.createRadialGradient(r, r, 0, r, r, r);
      grd.addColorStop(0, color);
      grd.addColorStop(0.25, color + 'aa');
      grd.addColorStop(0.6, color + '33');
      grd.addColorStop(1, color + '00');
      g.fillStyle = grd;
      g.fillRect(0, 0, r * 2, r * 2);
      glowCache.set(key, c);
    }
    return c;
  };
  // Colors passed to glow must be #rrggbb.
  G.drawGlow = function (ctx, x, y, r, color, alpha = 1) {
    if (alpha <= 0.01 || r < 1) return;
    const s = G.glowSprite(color, r);
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = prev * Math.min(1, alpha);
    ctx.drawImage(s, Math.round(x - s.width / 2), Math.round(y - s.height / 2));
    ctx.globalAlpha = prev;
  };

  // Lights collected each frame, drawn additively after the world.
  G.lights = [];
  G.addLight = function (x, y, r, color, a = 0.6) { G.lights.push(x, y, r, color, a); };

  // ---------------------------------------------------------------- 3x5 bitmap font
  const GLYPHS = {
    '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111',
    '4': '101101111001001', '5': '111100111001111', '6': '111100111101111', '7': '111001010010010',
    '8': '111101111101111', '9': '111101111001111', '!': '010010010000010', '+': '000010111010000',
    '-': '000000111000000', '?': '111001011000010', '/': '001001010100100', 'x': '000101010101000',
    '.': '000000000000010', '%': '101001010100101', ':': '000010000010000', ' ': '000000000000000',
    'A': '010101111101101', 'B': '110101110101110', 'C': '011100100100011', 'D': '110101101101110',
    'E': '111100110100111', 'F': '111100110100100', 'G': '011100101101011', 'H': '101101111101101',
    'I': '111010010010111', 'J': '001001001101010', 'K': '101101110101101', 'L': '100100100100111',
    'M': '101111111101101', 'N': '110101101101101', 'O': '010101101101010', 'P': '110101110100100',
    'Q': '010101101110011', 'R': '110101110101101', 'S': '011100010001110', 'T': '111010010010010',
    'U': '101101101101111', 'V': '101101101101010', 'W': '101101111111101', 'X': '101101010101101',
    'Y': '101101010010010', 'Z': '111001010100111', '#': '101111101111101', '$': '011110010011110',
    '<': '001010100010001', '>': '100010001010100', '=': '000111000111000', '*': '101010101000000',
  };
  const textCache = new Map();
  G.font = {
    width(text, scale = 1) { return text.length ? (text.length * 4 - 1) * scale : 0; },
    // Pre-rendered, outlined text sprite (cached)
    sprite(text, color, scale = 1, outline = G.PAL.ink) {
      text = String(text).toUpperCase();
      const key = text + '|' + color + '|' + scale + '|' + outline;
      let c = textCache.get(key);
      if (c) return c;
      if (textCache.size > 600) textCache.clear();
      const w = G.font.width(text, scale) + 2 * scale, h = 7 * scale;
      c = document.createElement('canvas');
      c.width = Math.max(1, w); c.height = h;
      const g = c.getContext('2d');
      const plot = (ox, oy, col) => {
        g.fillStyle = col;
        for (let i = 0; i < text.length; i++) {
          const gl = GLYPHS[text[i]] || GLYPHS['?'];
          for (let p = 0; p < 15; p++) {
            if (gl[p] === '1') g.fillRect(ox + (i * 4 + (p % 3)) * scale, oy + ((p / 3) | 0) * scale, scale, scale);
          }
        }
      };
      if (outline) {
        for (const [dx, dy] of [[0, 1], [2, 1], [1, 0], [1, 2], [0, 0], [2, 2], [0, 2], [2, 0]]) plot(dx * scale, dy * scale, outline);
      }
      plot(scale, scale, color);
      textCache.set(key, c);
      return c;
    },
    // align: 'left' | 'center' | 'right'
    draw(ctx, text, x, y, color = G.PAL.white, scale = 1, align = 'left', outline = G.PAL.ink) {
      const s = G.font.sprite(text, color, scale, outline);
      let ox = x;
      if (align === 'center') ox = x - s.width / 2;
      else if (align === 'right') ox = x - s.width;
      ctx.drawImage(s, Math.round(ox), Math.round(y));
    },
  };

  // ---------------------------------------------------------------- event bus
  const listeners = {};
  G.on = (evt, fn) => { (listeners[evt] = listeners[evt] || []).push(fn); return fn; };
  G.off = (evt, fn) => { const l = listeners[evt]; if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } };
  G.emit = (evt, data) => {
    const l = listeners[evt];
    if (!l) return;
    for (const fn of l.slice()) { try { fn(data); } catch (e) { console.error('[event ' + evt + ']', e); } }
  };

  // ---------------------------------------------------------------- input
  // Actions: left right up down jump roll attack1 attack2 skill1 skill2 heal interact pause map
  const KEYMAP = {
    left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'],
    jump: ['Space'], roll: ['ShiftLeft', 'ShiftRight', 'KeyL'],
    attack1: ['KeyJ'], attack2: ['KeyK'], skill1: ['KeyQ', 'KeyU'], skill2: ['KeyE', 'KeyI'],
    heal: ['KeyR', 'KeyH'], interact: ['KeyF'], pause: ['Escape', 'KeyP'], map: ['Tab', 'KeyM'],
    confirm: ['Enter', 'Space', 'KeyJ'], back: ['Escape', 'Backspace'],
  };
  // Standard gamepad mapping
  const PADMAP = {
    jump: [0], interact: [1], attack1: [2], attack2: [3], heal: [4], roll: [5, 10],
    skill1: [6], skill2: [7], map: [8], pause: [9], up: [12], down: [13], left: [14], right: [15],
    confirm: [0], back: [1],
  };
  const LABELS = {
    kb: { attack1: 'J', attack2: 'K', skill1: 'Q', skill2: 'E', heal: 'R', interact: 'F', roll: 'SHIFT', jump: 'SPACE', map: 'M', pause: 'ESC' },
    pad: { attack1: 'X', attack2: 'Y', skill1: 'LT', skill2: 'RT', heal: 'LB', interact: 'B', roll: 'RB', jump: 'A', map: 'SELECT', pause: 'START' },
    touch: { attack1: '', attack2: '', skill1: '', skill2: '', heal: '', interact: '', roll: '', jump: '', map: '', pause: '' },
  };
  const ACTIONS = Object.keys(KEYMAP);
  const keyToActions = {};
  for (const a of ACTIONS) for (const k of KEYMAP[a]) (keyToActions[k] = keyToActions[k] || []).push(a);

  const input = {
    device: 'kb',
    held: {},       // action -> bool (combined)
    _kb: {},        // action -> count of held keys
    _mouse: {},     // action -> bool
    _virt: {},      // action -> bool (touch)
    _pad: {},       // action -> bool
    _pressed: {},   // edges queued since last step
    _released: {},
    axisX: 0, axisY: 0,
    enabled: true,
    down(a) { return !!this.held[a]; },
    pressed(a) { return !!this._pressed[a]; },
    released(a) { return !!this._released[a]; },
    consume(a) { this._pressed[a] = false; },
    label(a) { return (LABELS[this.device] || LABELS.kb)[a] || ''; },
    _recompute(a) {
      const was = !!this.held[a];
      const now = (this._kb[a] || 0) > 0 || !!this._mouse[a] || !!this._virt[a] || !!this._pad[a];
      this.held[a] = now;
      if (now && !was) this._pressed[a] = true;
      if (!now && was) this._released[a] = true;
    },
    setVirtual(a, on) {
      if (!!this._virt[a] === !!on) return;
      this._virt[a] = !!on;
      this.device = 'touch';
      this._recompute(a);
    },
    clearAll() {
      for (const a of ACTIONS) { this._kb[a] = 0; this._mouse[a] = false; this._virt[a] = false; this._pad[a] = false; this.held[a] = false; }
      this._pressed = {}; this._released = {};
    },
    // called once per fixed step, before the simulation
    poll() {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      let pad = null;
      for (const p of pads) if (p && p.connected) { pad = p; break; }
      this.axisX = 0; this.axisY = 0;
      if (pad) {
        const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
        const btn = (i) => { const b = pad.buttons[i]; return !!b && (b.pressed || b.value > 0.5); };
        let any = Math.abs(ax) > 0.35 || Math.abs(ay) > 0.35;
        for (const a in PADMAP) {
          let on = false;
          for (const i of PADMAP[a]) if (btn(i)) on = true;
          if (a === 'left' && ax < -0.35) on = true;
          if (a === 'right' && ax > 0.35) on = true;
          if (a === 'up' && ay < -0.5) on = true;
          if (a === 'down' && ay > 0.5) on = true;
          if (on) any = true;
          if (on !== !!this._pad[a]) { this._pad[a] = on; this._recompute(a); }
        }
        if (any) this.device = 'pad';
        if (Math.abs(ax) > 0.2) this.axisX = ax;
        if (Math.abs(ay) > 0.2) this.axisY = ay;
      }
    },
    // called after each fixed step
    endStep() { this._pressed = {}; this._released = {}; },
  };
  G.input = input;

  const GAME_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    input.device = 'kb';
    if (e.repeat) return;
    const acts = keyToActions[e.code];
    if (!acts) return;
    for (const a of acts) { input._kb[a] = (input._kb[a] || 0) + 1; input._recompute(a); }
    G.emit('key', e.code);
  });
  window.addEventListener('keyup', (e) => {
    const acts = keyToActions[e.code];
    if (!acts) return;
    for (const a of acts) { input._kb[a] = Math.max(0, (input._kb[a] || 0) - 1); input._recompute(a); }
  });
  window.addEventListener('blur', () => input.clearAll());
  G.bindMouse = function (el) {
    el.addEventListener('mousedown', (e) => {
      const a = e.button === 0 ? 'attack1' : e.button === 2 ? 'attack2' : null;
      if (!a) return;
      input.device = 'kb';
      input._mouse[a] = true; input._recompute(a);
    });
    window.addEventListener('mouseup', (e) => {
      const a = e.button === 0 ? 'attack1' : e.button === 2 ? 'attack2' : null;
      if (!a) return;
      input._mouse[a] = false; input._recompute(a);
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  };

  // ---------------------------------------------------------------- camera
  class Camera {
    constructor() {
      this.x = 0; this.y = 0; this.w = G.W; this.h = G.H;
      this.shakeT = 0; this.shakeMag = 0; this.kx = 0; this.ky = 0;
      this.look = 0; this.zoomPunch = 0;
    }
    snap(tx, ty, level) { this.x = tx - this.w / 2; this.y = ty - this.h * 0.58; this.clamp(level); }
    follow(target, level, dt) {
      this.look = G.lerp(this.look, target.facing * 38 + target.vx * 0.12, Math.min(1, dt * 2.2));
      const tx = target.x + target.w / 2 + this.look - this.w / 2;
      const ty = target.y + target.h / 2 - this.h * 0.56;
      this.x = G.lerp(this.x, tx, Math.min(1, dt * 7));
      const fy = target.vy > 250 ? 10 : 5;
      this.y = G.lerp(this.y, ty, Math.min(1, dt * fy));
      this.clamp(level);
      if (this.shakeT > 0) this.shakeT -= dt; else this.shakeMag = 0;
      this.kx *= Math.pow(0.0005, dt); this.ky *= Math.pow(0.0005, dt);
    }
    clamp(level) {
      if (!level) return;
      this.x = G.clamp(this.x, 0, Math.max(0, level.pw - this.w));
      this.y = G.clamp(this.y, 0, Math.max(0, level.ph - this.h));
    }
    shake(mag, time = 0.2) {
      if (G.settings && G.settings.shake === false) return;
      this.shakeMag = Math.max(this.shakeMag, mag); this.shakeT = Math.max(this.shakeT, time);
    }
    kick(dx, dy) { this.kx += dx; this.ky += dy; }
    // pick this frame's shake offset once (called at the start of each world draw)
    beginFrame() {
      this.sx = this.shakeT > 0 ? (Math.random() * 2 - 1) * this.shakeMag : 0;
      this.sy = this.shakeT > 0 ? (Math.random() * 2 - 1) * this.shakeMag : 0;
    }
    // integer draw offset (world -> screen = world - ox), stable within a frame
    get ox() { return Math.round(this.x + this.kx + (this.sx || 0)); }
    get oy() { return Math.round(this.y + this.ky + (this.sy || 0)); }
    visible(x, y, w, h, pad = 32) {
      return x + w > this.x - pad && x < this.x + this.w + pad && y + h > this.y - pad && y < this.y + this.h + pad;
    }
  }
  G.Camera = Camera;

  // ---------------------------------------------------------------- persistence
  G.store = {
    get(key, def) {
      try { const v = localStorage.getItem('deadcircuits.' + key); return v == null ? def : JSON.parse(v); } catch (e) { return def; }
    },
    set(key, val) {
      try { localStorage.setItem('deadcircuits.' + key, JSON.stringify(val)); } catch (e) { /* storage unavailable */ }
    },
  };
  G.settings = Object.assign({ shake: true, music: 0.6, sfx: 0.8, scanlines: true }, G.store.get('settings', {}));
  G.saveSettings = () => G.store.set('settings', G.settings);

  // URL debug flags: ?play&biome=slums&seed=123&god&weapon=katana
  G.params = new URLSearchParams(location.search);
  G.debug = { god: G.params.has('god'), fps: G.params.has('fps') };
})();
