'use strict';
// DEAD CIRCUITS — parallax backgrounds (drawn first each frame, behind the level's back walls).
//   new G.Background(level) → .update(dt), .draw(ctx, cam, time)
// Layers are pre-rendered once into wide canvases that tile horizontally; per frame we only blit
// them and animate cheap things (flying cars, searchlights, billboards, smoke, the reactor core).
(function () {
  const G = window.G;
  const W = G.W, H = G.H;
  const LW = 960; // layer tile width (px)

  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mix = (a, b, t) => { const A = hex(a), B = hex(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
  const rgba = (h, a) => { const c = hex(h); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; };
  const rect = (g, x, y, w, h, c) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };

  // Biome look. sky: [top, mid, horizon]; layers: far -> near
  const LOOKS = {
    slums: {
      sky: ['#07051a', '#1b0c3a', '#5a1a5e'], stars: 0, moon: null, glow: '#ff3aa0',
      layers: [
        { f: 0.06, fy: 0.07, h: 230, base: '#1e1440', win: ['#ffcf6a', '#ff6ac8', '#6ae8ff'], wd: 0.22, minW: 14, maxW: 40, minH: 90, maxH: 210, neon: 0.1, haze: '#3a1650' },
        { f: 0.16, fy: 0.15, h: 330, base: '#130c2a', win: ['#ffcf6a', '#ff5cc8', '#27f3ff', '#ffe14d'], wd: 0.28, minW: 22, maxW: 56, minH: 150, maxH: 320, neon: 0.35, haze: '#2a1040', ant: 0.5 },
        { f: 0.3, fy: 0.3, h: 420, base: '#0a0718', win: ['#ffcf6a', '#ff5cc8', '#27f3ff'], wd: 0.2, minW: 40, maxW: 90, minH: 220, maxH: 410, neon: 0.6, haze: '#1a0a30', billboard: 2, ant: 0.3 },
      ],
      cars: 16, beams: 2, beamColor: '#b8a8ff', smoke: 0,
    },
    scrap: {
      sky: ['#0b0605', '#2a1308', '#8a3a12'], stars: 0, moon: { x: 360, y: 60, r: 26, c: '#e89a5a' }, glow: '#ff6a1a',
      layers: [
        { f: 0.06, fy: 0.06, h: 200, base: '#2a1409', win: ['#ffb060'], wd: 0.05, minW: 16, maxW: 46, minH: 50, maxH: 150, industrial: 1, haze: '#5a2a10' },
        { f: 0.16, fy: 0.14, h: 280, base: '#170b06', win: ['#ffb060', '#2ee6d6'], wd: 0.08, minW: 24, maxW: 70, minH: 80, maxH: 240, industrial: 1, haze: '#3a1808', ant: 0.3 },
        { f: 0.3, fy: 0.28, h: 360, base: '#0c0605', win: ['#ff9a3a'], wd: 0.05, minW: 30, maxW: 80, minH: 120, maxH: 340, industrial: 2, haze: '#200c05' },
      ],
      cars: 4, beams: 1, beamColor: '#ffcf9a', smoke: 6,
    },
    spire: {
      sky: ['#03040f', '#0e1638', '#34469a'], stars: 150, moon: { x: 360, y: 52, r: 24, c: '#d8e6ff' }, glow: '#6a8cff',
      layers: [
        { f: 0.04, fy: 0.05, h: 140, base: '#101a3a', win: ['#9ab8ff', '#ffcf6a', '#ff6ac8'], wd: 0.5, minW: 6, maxW: 18, minH: 20, maxH: 90, haze: '#2a3a7a', low: 1 },
        { f: 0.12, fy: 0.16, h: 300, base: '#0b1230', win: ['#9ab8ff', '#5ab8ff'], wd: 0.25, minW: 16, maxW: 40, minH: 120, maxH: 290, haze: '#18245a', ant: 0.8, spires: 1, clouds: 1 },
        { f: 0.26, fy: 0.34, h: 460, base: '#060a1c', win: ['#bcd8ff', '#9b5cff'], wd: 0.18, minW: 50, maxW: 100, minH: 280, maxH: 450, haze: '#0c1238', ant: 0.6, spires: 1, billboard: 1 },
      ],
      cars: 12, beams: 0, clouds: 1, smoke: 0, twinkle: 14,
    },
    core: {
      sky: ['#0a0206', '#1e0610', '#3a0a1a'], stars: 0, moon: null, glow: '#ff2a5a', reactor: 1,
      layers: [], cars: 0, beams: 0, smoke: 0,
    },
  };

  // ---------------------------------------------------------------- generators
  function makeSky(look, rng) {
    const c = mk(W, H), g = c.getContext('2d');
    const [top, mid, hor] = look.sky;
    // banded, dithered gradient (pixel-art friendly)
    const bands = 18;
    for (let i = 0; i < bands; i++) {
      const t = i / (bands - 1);
      const col = t < 0.55 ? mix(top, mid, t / 0.55) : mix(mid, hor, (t - 0.55) / 0.45);
      const y0 = Math.floor(i * H / bands), y1 = Math.floor((i + 1) * H / bands);
      rect(g, 0, y0, W, y1 - y0, col);
      if (i < bands - 1) {
        const next = (i + 1) / (bands - 1);
        const ncol = next < 0.55 ? mix(top, mid, next / 0.55) : mix(mid, hor, (next - 0.55) / 0.45);
        g.fillStyle = ncol;
        for (let x = 0; x < W; x += 2) g.fillRect(x + ((y1 >> 0) & 1), y1 - 1, 1, 1);
      }
    }
    for (let i = 0; i < look.stars; i++) {
      const x = rng.int(0, W - 1), y = rng.int(0, H * 0.6);
      rect(g, x, y, 1, 1, rgba('#ffffff', rng.float(0.2, 0.8).toFixed(2)));
    }
    if (look.moon) {
      const m = look.moon;
      g.fillStyle = rgba(m.c, 0.07); G.px.disc(g, m.x, m.y, m.r + 14);
      g.fillStyle = rgba(m.c, 0.12); G.px.disc(g, m.x, m.y, m.r + 6);
      G.px.disc(g, m.x, m.y, m.r, m.c);
      g.fillStyle = mix(m.c, '#000000', 0.12);
      G.px.disc(g, m.x - 7, m.y - 5, 5); G.px.disc(g, m.x + 8, m.y + 6, 4); G.px.disc(g, m.x + 3, m.y - 11, 3);
      // smog bands over the moon
      for (let k = 0; k < 4; k++) rect(g, m.x - m.r - 20 + k * 7, m.y - 4 + k * 9, m.r * 2 + 30, 2, rgba(look.sky[1], 0.55));
    }
    // horizon glow
    const [r, gg, b] = hex(look.glow);
    for (let y = 0; y < 90; y++) { g.fillStyle = 'rgba(' + r + ',' + gg + ',' + b + ',' + (0.18 * (y / 90) * (y / 90)).toFixed(3) + ')'; g.fillRect(0, H - 90 + y, W, 1); }
    return c;
  }

  function makeLayer(L, look, rng, idx) {
    const c = mk(LW, L.h), g = c.getContext('2d');
    const buildings = [];
    let x = -L.maxW;
    while (x < LW + L.maxW) {
      const bw = rng.int(L.minW, L.maxW), bh = rng.int(L.minH, L.maxH);
      buildings.push({ x, w: bw, h: bh, s: rng.int(1, 1e9) });
      x += bw + rng.int(-Math.floor(bw / 4), 6);
    }
    const draw = (b, ox) => {
      const r = new G.RNG(b.s);
      const bx = b.x + ox, top = L.h - b.h;
      const col = mix(L.base, '#000000', r.float(0, 0.25));
      if (L.industrial) {
        const kind = r.int(0, 4);
        if (kind === 0) { // smokestack
          const sw = Math.max(6, Math.floor(b.w / 4));
          rect(g, bx + b.w / 2 - sw / 2, top - 30, sw, b.h + 30, col);
          rect(g, bx + b.w / 2 - sw / 2 - 1, top - 30, sw + 2, 3, col);
          for (let k = 0; k < 3; k++) rect(g, bx + b.w / 2 - sw / 2, top - 20 + k * 12, sw, 1, rgba('#ff5a2a', 0.25));
          rect(g, bx, top + b.h * 0.5, b.w, b.h * 0.5, col);
          b.stack = { x: bx + b.w / 2, y: top - 30 };
        } else if (kind === 1) { // cooling tower (hyperboloid)
          for (let yy = 0; yy < b.h * 0.8; yy++) {
            const u = yy / (b.h * 0.8), hw = b.w / 2 * (0.62 + 0.38 * Math.pow(Math.abs(u - 0.35) / 0.65, 1.6));
            rect(g, bx + b.w / 2 - hw, top + b.h * 0.2 + yy, hw * 2, 1, col);
          }
          rect(g, bx, top + b.h - 10, b.w, 10, col);
        } else if (kind === 2) { // crane
          rect(g, bx + 4, top, 4, b.h, col);
          for (let k = 0; k < b.h; k += 6) rect(g, bx + 3, top + k, 6, 1, col);
          rect(g, bx - b.w * 0.3, top, b.w * 1.4, 3, col);
          rect(g, bx + b.w * 0.9, top + 3, 1, 20 + r.int(0, 30), col);
          rect(g, bx + 5, top - 1, 2, 1, '#ff3348');
        } else { // factory hall with sawtooth roof
          rect(g, bx, top + 10, b.w, b.h - 10, col);
          for (let k = 0; k < b.w; k += 10) for (let j = 0; j < 10; j++) rect(g, bx + k + j, top + 10 - j, 1, j, col);
          for (let k = 0; k < r.int(1, 3); k++) { const px = bx + r.int(2, b.w - 4); rect(g, px, top - 20, 2, 30, col); }
        }
      } else {
        rect(g, bx, top, b.w, b.h, col);
        // setbacks / crowns
        if (r.chance(0.5)) { const sw = Math.floor(b.w * r.float(0.4, 0.7)); rect(g, bx + (b.w - sw) / 2, top - r.int(6, 24), sw, 30, col); }
        if (L.spires && r.chance(0.5)) { const sx = bx + b.w / 2; for (let k = 0; k < 30; k++) rect(g, sx - Math.max(0, (30 - k) / 6), top - 40 + k, Math.max(1, (30 - k) / 3), 1, col); b.tip = { x: sx, y: top - 40 }; }
        if (L.ant && r.chance(L.ant)) { const ax = bx + r.int(2, b.w - 3), ah = r.int(10, 36); rect(g, ax, top - ah, 1, ah, col); b.tip = b.tip || { x: ax, y: top - ah }; }
      }
      // edge highlight toward the horizon glow
      rect(g, bx, top, 1, b.h, mix(col, look.glow, 0.12));
      // windows
      const cols = L.win;
      const sx = r.int(3, 4), sy = r.int(3, 5);
      const dens = L.wd * r.float(0.5, 1.5);
      const lit = r.pick(cols);
      for (let yy = top + 4; yy < L.h - 2; yy += sy) {
        for (let xx = bx + 2; xx < bx + b.w - 2; xx += sx) {
          if (r.next() > dens) continue;
          const wc = r.chance(0.8) ? lit : r.pick(cols);
          g.fillStyle = rgba(wc, (0.35 + 0.5 * r.next() * (0.4 + idx * 0.3)).toFixed(2));
          g.fillRect(xx, yy, r.chance(0.3) ? 2 : 1, 1);
        }
      }
      // vertical neon strips / small signs
      if (L.neon && r.chance(L.neon)) {
        const nc = r.pick(['#ff2a8a', '#27f3ff', '#ffe14d', '#9b5cff']);
        const nx = r.chance(0.5) ? bx + 1 : bx + b.w - 2;
        const ny = top + r.int(10, Math.max(12, b.h / 2)), nh = r.int(20, Math.min(90, b.h - 10));
        rect(g, nx, ny, 1, nh, nc);
        if (r.chance(0.6)) { const sw = r.int(8, 20); rect(g, bx + r.int(2, Math.max(3, b.w - sw - 2)), ny + r.int(0, 30), sw, r.int(4, 7), mix(nc, '#000000', 0.2)); }
      }
      if (b.tip) rect(g, b.tip.x, b.tip.y - 1, 1, 1, '#ff3348');
    };
    for (const b of buildings) { draw(b, 0); if (b.x + b.w > LW) draw(b, -LW); if (b.x < 0) draw(b, LW); }
    // atmospheric haze toward the bottom (depth)
    const [r, gg, bb] = hex(L.haze);
    for (let y = 0; y < L.h; y++) {
      const u = y / L.h;
      const a = 0.55 * Math.pow(u, 1.5) + (L.low ? 0.1 : 0);
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = 'rgba(' + r + ',' + gg + ',' + bb + ',' + a.toFixed(3) + ')';
      g.fillRect(0, y, LW, 1);
    }
    g.globalCompositeOperation = 'source-over';
    const tips = [];
    for (const b of buildings) if (b.tip && b.tip.x >= 0 && b.tip.x < LW) tips.push(b.tip);
    const stacks = buildings.filter((b) => b.stack && b.stack.x >= 0 && b.stack.x < LW).map((b) => b.stack);
    return { c, tips, stacks, L };
  }

  function makeBillboard(rng, color) {
    // 2 frames of a big animated ad
    const w = 54, h = 72, frames = [];
    const kind = rng.int(0, 2);
    for (let f = 0; f < 2; f++) {
      const c = mk(w, h), g = c.getContext('2d');
      rect(g, 0, 0, w, h, '#05040a');
      rect(g, 2, 2, w - 4, h - 4, mix(color, '#000000', 0.8));
      g.fillStyle = mix(color, '#ffffff', 0.15);
      if (kind === 0) {
        // face in profile with blinking eye
        G.px.disc(g, 27, 26, 13); rect(g, 20, 34, 14, 18, g.fillStyle); rect(g, 14, 50, 26, 16, g.fillStyle);
        rect(g, 16, 13, 24, 6, mix(color, '#000000', 0.4));
        rect(g, 30, 24, 5, f ? 1 : 2, '#05040a');
        rect(g, 28, 36, 6, 1, '#05040a');
      } else if (kind === 1) {
        // can of drink
        rect(g, 18, 12, 18, 40, g.fillStyle); rect(g, 18, 12, 18, 3, '#ffffff'); rect(g, 20, 22 + f * 4, 14, 8, '#05040a');
        G.font.draw(g, 'NEO', 27, 56, '#ffffff', 1, 'center', null);
      } else {
        // katakana-ish column + logo
        G.px.ring(g, 27, 24, 12, g.fillStyle, 2); G.px.disc(g, 27, 24, f ? 5 : 3);
        G.font.draw(g, 'ZERO', 27, 44, '#ffffff', 1, 'center', null);
        G.font.draw(g, 'CORP', 27, 52, g.fillStyle, 1, 'center', null);
      }
      g.fillStyle = 'rgba(0,0,0,0.35)';
      for (let y = 0; y < h; y += 2) g.fillRect(0, y, w, 1);
      frames.push(c);
    }
    return frames;
  }

  function makeReactor(rng) {
    // huge reactor chamber: back wall hexes, the core, rings and cables
    const wall = mk(LW, 420), g = wall.getContext('2d');
    rect(g, 0, 0, LW, 420, '#12040a');
    for (let y = 0; y < 420; y += 12) for (let x = ((y / 12) & 1) * 10; x < LW; x += 20) {
      rect(g, x + 2, y + 2, 16, 8, '#1c0610'); rect(g, x + 2, y + 2, 16, 1, '#2a0a18');
      if (rng.chance(0.03)) rect(g, x + 6, y + 5, 8, 2, '#5a1028');
    }
    for (let x = 0; x < LW; x += 120) { rect(g, x, 0, 14, 420, '#0a0206'); rect(g, x + 13, 0, 1, 420, '#2a0a18'); }
    const cables = mk(LW, 420), cg = cables.getContext('2d');
    for (let k = 0; k < 6; k++) {
      const x0 = rng.int(0, LW), x1 = x0 + rng.int(120, 300), y0 = rng.int(-10, 60), sag = rng.int(60, 220), th = rng.int(3, 7);
      for (let x = x0; x <= x1; x++) { const u = (x - x0) / (x1 - x0), y = y0 + 4 * sag * u * (1 - u); const xx = ((x % LW) + LW) % LW; rect(cg, xx, y, 1, th, '#07020a'); rect(cg, xx, y + th, 1, 1, '#3a0a1c'); }
    }
    return { wall, cables };
  }

  // ---------------------------------------------------------------- Background
  class Background {
    constructor(level) {
      this.lv = level;
      const key = level.biome;
      this.look = LOOKS[key] || LOOKS.slums;
      this.key = key;
      const rng = new G.RNG(((level.seed >>> 0) ^ 0xb6c0de) >>> 0);
      this.sky = makeSky(this.look, rng);
      this.layers = this.look.layers.map((L, i) => makeLayer(L, this.look, rng, i));
      this.t = 0;
      this.yOff = level.kind === 'transit' ? 120 : 0;
      this.cars = [];
      for (let i = 0; i < this.look.cars; i++) {
        const li = rng.int(0, Math.max(0, this.layers.length - 1));
        this.cars.push({ li, x: rng.float(0, LW), y: rng.float(0.15, 0.6), v: rng.float(25, 70) * rng.sign(), big: rng.chance(0.25), c: rng.pick(['#ffe8b0', '#ff5cc8', '#27f3ff']) });
      }
      this.beams = [];
      for (let i = 0; i < this.look.beams; i++) this.beams.push({ x: rng.float(0, LW), ph: rng.float(0, 6), sp: rng.float(0.25, 0.5) });
      this.boards = [];
      this.layers.forEach((ly, i) => {
        const n = ly.L.billboard || 0;
        for (let k = 0; k < n; k++) this.boards.push({ li: i, x: rng.float(40, LW - 100), y: rng.float(0.12, 0.3), frames: makeBillboard(rng, rng.pick(['#ff2a8a', '#27f3ff', '#9b5cff'])), ph: rng.float(0, 10) });
      });
      this.smoke = [];
      for (let i = 0; i < (this.look.smoke || 0) * 6; i++) this.smoke.push({ si: i % 64, t: rng.float(0, 8), life: rng.float(5, 8) });
      this.clouds = this.look.clouds ? this.makeClouds(rng) : null;
      this.stars = [];
      for (let i = 0; i < (this.look.twinkle || 0); i++) this.stars.push({ x: rng.int(0, W - 1), y: rng.int(0, Math.floor(H * 0.55)), sp: rng.float(0.6, 2.2), ph: rng.float(0, 7) });
      this.reactor = this.look.reactor ? makeReactor(rng) : null;
    }
    makeClouds(rng) {
      const c = mk(LW, 90), g = c.getContext('2d');
      const puff = (x, y, r, col) => { g.fillStyle = col; G.px.disc(g, x, y, r); G.px.disc(g, x - LW, y, r); G.px.disc(g, x + LW, y, r); };
      for (let k = 0; k < 70; k++) puff(rng.int(0, LW), rng.int(40, 70), rng.int(10, 22), '#1c2656');
      for (let k = 0; k < 60; k++) puff(rng.int(0, LW), rng.int(34, 60), rng.int(7, 16), '#28346e');
      for (let k = 0; k < 40; k++) puff(rng.int(0, LW), rng.int(30, 52), rng.int(4, 10), '#3a4a8e');
      g.fillStyle = '#1c2656'; g.fillRect(0, 70, LW, 20);
      // moonlit rims
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = 'rgba(160,190,255,0.10)'; g.fillRect(0, 0, LW, 44);
      g.globalCompositeOperation = 'source-over';
      return c;
    }
    housing() {
      if (this._housing) return this._housing;
      const c = mk(140, 140), g = c.getContext('2d');
      const cx = 70, cy = 70;
      g.fillStyle = '#12040a'; G.px.disc(g, cx, cy, 68);
      g.fillStyle = '#240812'; G.px.disc(g, cx, cy, 64);
      g.fillStyle = '#2e0c18'; G.px.disc(g, cx, cy, 58);
      // radial panel seams + bolts
      for (let k = 0; k < 16; k++) {
        const a = k / 16 * Math.PI * 2;
        for (let r = 44; r < 64; r++) rect(g, cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1, 1, '#12040a');
        rect(g, cx + Math.cos(a + 0.2) * 60 - 1, cy + Math.sin(a + 0.2) * 60 - 1, 2, 2, '#5a1a2e');
      }
      // vents (glowing slits)
      for (let k = 0; k < 8; k++) {
        const a = k / 8 * Math.PI * 2 + 0.2;
        rect(g, cx + Math.cos(a) * 51 - 2, cy + Math.sin(a) * 51 - 1, 4, 2, '#ff2a5a');
      }
      // inner lip
      g.fillStyle = '#0a0206'; G.px.disc(g, cx, cy, 44);
      g.globalCompositeOperation = 'destination-out'; G.px.disc(g, cx, cy, 42); g.globalCompositeOperation = 'source-over';
      // top highlight
      for (let x = -50; x <= 50; x++) { const y = -Math.sqrt(Math.max(0, 64 * 64 - x * x)); rect(g, cx + x, cy + y, 1, 1, '#5a1a2e'); }
      this._housing = c;
      return c;
    }
    update(dt) {
      this.t += dt;
      for (const c of this.cars) { c.x += c.v * dt; if (c.x > LW) c.x -= LW; if (c.x < 0) c.x += LW; }
      for (const s of this.smoke) { s.t += dt; if (s.t > s.life) s.t -= s.life; }
    }
    // screen offset of a layer: horizontal wrap + vertical parallax relative to the level bottom
    layerPos(L, cam, lh) {
      const lv = this.lv;
      const sx = -(((cam.x * L.f) % LW) + LW) % LW;
      const below = Math.max(0, lv.ph - (cam.y + H));
      const sy = H + 24 - lh + below * L.fy + this.yOff;
      return { sx: Math.round(sx), sy: Math.round(sy) };
    }
    draw(ctx, cam) {
      const t = this.t;
      ctx.drawImage(this.sky, 0, 0);
      if (this.reactor) { this.drawReactor(ctx, cam, t); return; }
      // twinkling stars
      for (let i = 0; i < this.stars.length; i++) {
        const st = this.stars[i];
        const a = 0.5 + 0.5 * Math.sin(t * st.sp + st.ph);
        if (a < 0.3) continue;
        ctx.fillStyle = 'rgba(255,255,255,' + (a * 0.9).toFixed(2) + ')';
        ctx.fillRect(st.x, st.y, 1, 1);
        if (a > 0.9) { ctx.fillStyle = 'rgba(200,220,255,0.35)'; ctx.fillRect(st.x - 1, st.y, 3, 1); ctx.fillRect(st.x, st.y - 1, 1, 3); }
      }
      // searchlights (behind the far layer)
      if (this.beams.length) {
        const prev = ctx.globalCompositeOperation;
        ctx.globalCompositeOperation = 'lighter';
        const L0 = this.layers[0];
        const p = this.layerPos(L0.L, cam, L0.L.h);
        const [r, g, b] = hex(this.look.beamColor);
        for (const bm of this.beams) {
          const bx = ((bm.x + p.sx) % LW + LW) % LW - 100;
          const by = p.sy + L0.L.h * 0.55;
          const ang = Math.sin(t * bm.sp + bm.ph) * 0.55;
          const tn = Math.tan(ang);
          for (let k = 0; k < 150; k++) {
            const yy = by - k * 2, w = 2 + k * 0.16;
            if (yy < -4) break;
            ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + (0.07 * (1 - k / 150)).toFixed(3) + ')';
            ctx.fillRect(Math.round(bx + tn * k * 2 - w / 2), yy, Math.round(w), 2);
          }
        }
        ctx.globalCompositeOperation = prev;
      }
      this.layers.forEach((ly, i) => {
        const p = this.layerPos(ly.L, cam, ly.L.h);
        if (p.sy > H) return;
        ctx.drawImage(ly.c, p.sx, p.sy); ctx.drawImage(ly.c, p.sx + LW, p.sy);
        if (p.sy + ly.L.h < H) { ctx.fillStyle = mix(ly.L.base, ly.L.haze, 0.55); ctx.fillRect(0, p.sy + ly.L.h, W, H - p.sy - ly.L.h); }
        if (ly.L.clouds && this.clouds) {
          // sea of clouds wrapping the lower half of the towers
          const cy = Math.round(p.sy + ly.L.h * 0.5);
          if (cy < H + 10) {
            const cx = Math.round(-(((cam.x * 0.14 + t * 4) % LW) + LW) % LW);
            ctx.drawImage(this.clouds, cx, cy - 40); ctx.drawImage(this.clouds, cx + LW, cy - 40);
            ctx.fillStyle = 'rgba(40,52,110,0.55)'; ctx.fillRect(0, cy + 38, W, Math.max(0, H - cy - 38));
          }
        }
        // blinking tips
        const on = Math.sin(t * 3 + i) > 0.2;
        if (on) for (const tp of ly.tips) { const x = ((tp.x + p.sx) % LW + LW) % LW; if (x < W) { ctx.fillStyle = '#ff5a6a'; ctx.fillRect(x - 1, tp.y + p.sy - 2, 3, 3); } }
        // smoke from stacks
        if (ly.stacks.length && this.smoke.length) {
          for (const s of this.smoke) {
            const st = ly.stacks[s.si % ly.stacks.length];
            const k = s.t / s.life;
            const x = ((st.x + p.sx + k * 40) % LW + LW) % LW, y = st.y + p.sy - k * 70;
            if (x > W + 30) continue;
            ctx.fillStyle = rgba('#3a2a24', (0.35 * (1 - k)).toFixed(3));
            G.px.disc(ctx, x, y, 3 + k * 12);
            if (k < 0.15) { ctx.fillStyle = rgba('#ff8a2a', (0.6 * (1 - k / 0.15)).toFixed(2)); ctx.fillRect(Math.round(st.x + p.sx) % LW, Math.round(st.y + p.sy) - 3, 3, 3); }
          }
        }
        // billboards on this layer
        for (const bd of this.boards) {
          if (bd.li !== i) continue;
          const x = ((bd.x + p.sx) % LW + LW) % LW;
          if (x > W) continue;
          const y = p.sy + ly.L.h * bd.y;
          const fr = bd.frames[Math.floor(t * 0.8 + bd.ph) % 2];
          const flick = Math.sin(t * 13 + bd.ph) > -0.95 ? 1 : 0.3;
          ctx.globalAlpha = 0.9 * flick;
          ctx.drawImage(fr, Math.round(x), Math.round(y));
          ctx.globalAlpha = 1;
          const prev = ctx.globalCompositeOperation; ctx.globalCompositeOperation = 'lighter';
          G.drawGlow(ctx, x + 27, y + 36, 70, '#ff5cc8', 0.12 * flick);
          ctx.globalCompositeOperation = prev;
        }
        // flying cars in this layer's depth
        for (const c of this.cars) {
          if (c.li !== i) continue;
          const x = ((c.x + p.sx) % LW + LW) % LW;
          if (x > W + 4) continue;
          const y = Math.round(p.sy + ly.L.h * c.y + Math.sin(t + c.x) * 2);
          const d = c.v > 0 ? 1 : -1;
          if (c.big) {
            ctx.fillStyle = '#0a0812'; ctx.fillRect(Math.round(x) - 4, y - 1, 9, 3);
            ctx.fillStyle = c.c; ctx.fillRect(Math.round(x) + (d > 0 ? 4 : -4), y, 1, 1);
            ctx.fillStyle = '#ff3348'; ctx.fillRect(Math.round(x) + (d > 0 ? -4 : 4), y, 1, 1);
            const prev = ctx.globalCompositeOperation; ctx.globalCompositeOperation = 'lighter';
            G.drawGlow(ctx, x + d * 5, y, 10, c.c, 0.35);
            ctx.globalCompositeOperation = prev;
          } else {
            ctx.fillStyle = c.c; ctx.fillRect(Math.round(x), y, 2, 1);
            ctx.fillStyle = '#ff3348'; ctx.fillRect(Math.round(x) - d, y, 1, 1);
          }
        }
      });
    }
    drawReactor(ctx, cam, t) {
      const R = this.reactor, lv = this.lv;
      const f = 0.12, fy = 0.12;
      const sx = Math.round(-(((cam.x * f) % LW) + LW) % LW);
      const sy = Math.round(-60 - cam.y * fy);
      ctx.drawImage(R.wall, sx, sy); ctx.drawImage(R.wall, sx + LW, sy);
      const csx = Math.round(-(((cam.x * 0.18) % LW) + LW) % LW);
      ctx.drawImage(R.cables, csx, Math.round(-40 - cam.y * 0.18)); ctx.drawImage(R.cables, csx + LW, Math.round(-40 - cam.y * 0.18));
      // the core sits at the level's horizontal center
      const cx = Math.round((lv.pw / 2 - cam.x - W / 2) * 0.35 + W / 2);
      const cy = Math.round((lv.ph * 0.3 - cam.y - H / 2) * 0.35 + H * 0.36);
      const pulse = 0.5 + 0.5 * Math.sin(t * 1.7);
      const prev = ctx.globalCompositeOperation;
      ctx.globalCompositeOperation = 'lighter';
      G.drawGlow(ctx, cx, cy, 190, '#ff2a5a', 0.25 + 0.1 * pulse);
      G.drawGlow(ctx, cx, cy, 90, '#ff2ad4', 0.35 + 0.15 * pulse);
      ctx.globalCompositeOperation = prev;
      // housing: pre-rendered armored ring with panels, bolts and vents
      ctx.drawImage(this.housing(), cx - 70, cy - 70);
      ctx.fillStyle = mix('#ff2a5a', '#ffffff', 0.15 + 0.2 * pulse); G.px.disc(ctx, cx, cy, 40);
      ctx.fillStyle = mix('#ff8ac0', '#ffffff', 0.5 * pulse); G.px.disc(ctx, cx, cy, 24);
      ctx.fillStyle = '#ffffff'; G.px.disc(ctx, cx, cy, 10);
      // rotating clamps
      for (let k = 0; k < 8; k++) {
        const a = t * 0.4 + k * Math.PI / 4;
        const x = cx + Math.cos(a) * 52, y = cy + Math.sin(a) * 52;
        ctx.fillStyle = '#0a0206'; ctx.fillRect(Math.round(x) - 4, Math.round(y) - 4, 8, 8);
        ctx.fillStyle = '#ff2a5a'; ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
      }
      // orbit ring dots
      for (let k = 0; k < 48; k++) {
        const a = -t * 0.9 + k * Math.PI / 24;
        const x = cx + Math.cos(a) * 84, y = cy + Math.sin(a) * 24;
        if (Math.sin(a) < 0 && Math.abs(Math.cos(a)) < 0.45) continue;
        ctx.fillStyle = k % 6 === 0 ? '#ffffff' : '#ff2ad4'; ctx.fillRect(Math.round(x), Math.round(y), 2, 1);
      }
      // pillars supporting the core
      ctx.fillStyle = '#0c0206'; ctx.fillRect(cx - 70, cy + 40, 16, H); ctx.fillRect(cx + 54, cy + 40, 16, H);
      ctx.fillStyle = '#3a0a1c'; ctx.fillRect(cx - 70, cy + 40, 1, H); ctx.fillRect(cx + 54, cy + 40, 1, H);
    }
  }
  G.Background = Background;
})();
