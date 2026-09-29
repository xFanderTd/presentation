'use strict';
// Enemy base class + registry + pixel-art sprite toolkit + the full roster.
//
// Art pipeline: every enemy look is a set of procedurally drawn raw frames (rig-based humanoids or
// custom drawings) that are baked once into offscreen canvases with a directional neon rim outline
// (bright on top/front, dim on bottom/back) plus an inner rim light. Flipped / white-flash / elite
// (bigger, gold rim) variants are baked lazily and cached. Deaths dissolve the last drawn frame
// row by row into glowing pixel dust with glitch slicing.
(function () {
  const G = window.G;
  const PAL = G.PAL, TS = G.TILE;
  const TAU = Math.PI * 2;
  const ELITE_SCALE = 1.25;
  const snd = (name, o) => { if (G.audio) G.audio.play(name, o); };

  // ================================================================ registry
  G.ENEMIES = {};
  // Register an enemy class: G.defineEnemy('husk', class extends G.Enemy {...}, {biomes:['scrap'], weight:3, minDepth:0, air:false})
  // `weight` may also be a per-biome map: {scrap: 4, slums: 1}.
  G.defineEnemy = function (type, cls, meta = {}) {
    cls.prototype.type = type;
    if (meta.displayName) cls.prototype.displayName = meta.displayName;
    G.ENEMIES[type] = { cls, meta };
    return cls;
  };
  // Pick an enemy type for a level spawn point. Returns a type id or null.
  G.pickEnemy = function (biome, depth, rng, spawn = {}) {
    const list = [];
    for (const type in G.ENEMIES) {
      const m = G.ENEMIES[type].meta;
      if (m.boss || m.noSpawn) continue;
      if (m.biomes && !m.biomes.includes(biome)) continue;
      if ((m.minDepth || 0) > depth) continue;
      if (!!m.air !== !!spawn.air) continue;
      const w = m.weight && typeof m.weight === 'object' ? (m.weight[biome] || 0) : (m.weight || 1);
      if (w > 0) list.push([type, w]);
    }
    return list.length ? rng.weighted(list) : null;
  };
  G.spawnEnemy = function (world, type, x, y, opts = {}) {
    const e = G.ENEMIES[type];
    if (!e) { console.warn('unknown enemy', type); return null; }
    const en = new e.cls(x, y, Object.assign({ depth: world.depth, world }, opts));
    world.enemies.push(en);
    return en;
  };

  // ================================================================ pixel-art toolkit
  const Art = (G.EArt = {});
  Art.canvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
  Art.hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const h2 = (v) => v.toString(16).padStart(2, '0');
  Art.rgb = (r, g, b) => '#' + h2(r) + h2(g) + h2(b);
  Art.mix = (a, b, t) => { const A = Art.hex(a), B = Art.hex(b); return Art.rgb(...A.map((v, i) => Math.round(v + (B[i] - v) * t))); };
  Art.rect = (g, x, y, w, h, c) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
  Art.px = (g, x, y, c) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), 1, 1); };
  Art.line = (g, x0, y0, x1, y1, c, t = 1) => G.px.line(g, x0, y0, x1, y1, c, t);
  Art.disc = (g, x, y, r, c) => G.px.disc(g, x, y, r, c);
  Art.ellipse = (g, cx, cy, rx, ry, c) => {
    g.fillStyle = c;
    ry = Math.max(0.5, ry);
    for (let y = -Math.floor(ry); y <= Math.floor(ry); y++) {
      const hw = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry))));
      g.fillRect(Math.round(cx - hw), Math.round(cy + y), hw * 2 + 1, 1);
    }
  };
  // half disc: side 'top' | 'bottom'
  Art.halfDisc = (g, cx, cy, r, c, side = 'top') => {
    g.fillStyle = c;
    for (let y = -r; y <= r; y++) {
      if (side === 'top' ? y > 0 : y < 0) continue;
      const hw = Math.floor(Math.sqrt(r * r - y * y) + 0.5);
      g.fillRect(Math.round(cx - hw), Math.round(cy + y), hw * 2 + 1, 1);
    }
  };
  // scanline polygon fill (crisp, no anti-aliasing)
  Art.poly = (g, pts, c) => {
    g.fillStyle = c;
    let y0 = Infinity, y1 = -Infinity;
    for (const p of pts) { if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
    const n = pts.length;
    for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
      const sy = y + 0.5, xs = [];
      for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % n];
        if ((a[1] <= sy && b[1] > sy) || (b[1] <= sy && a[1] > sy)) xs.push(a[0] + ((sy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
      xs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const xa = Math.round(xs[i]), xb = Math.round(xs[i + 1]);
        if (xb > xa) g.fillRect(xa, y, xb - xa, 1);
      }
    }
  };
  // tapered thick line
  Art.limb = (g, x0, y0, x1, y1, t0, t1, c) => {
    g.fillStyle = c;
    const d = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(d * 1.5));
    for (let i = 0; i <= n; i++) {
      const k = i / n, t = Math.max(1, Math.round(G.lerp(t0, t1, k)));
      g.fillRect(Math.round(x0 + (x1 - x0) * k - t / 2), Math.round(y0 + (y1 - y0) * k - t / 2), t, t);
    }
  };
  Art.scaleNN = (src, s) => {
    const c = Art.canvas(src.width * s, src.height * s), g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(src, 0, 0, c.width, c.height);
    return c;
  };
  Art.flip = (src) => {
    const c = Art.canvas(src.width, src.height), g = c.getContext('2d');
    g.translate(src.width, 0); g.scale(-1, 1); g.drawImage(src, 0, 0);
    return c;
  };
  Art.tint = (src, color) => {
    const c = Art.canvas(src.width, src.height), g = c.getContext('2d');
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color; g.fillRect(0, 0, c.width, c.height);
    return c;
  };
  Art.white = (src) => Art.tint(src, '#ffffff');
  // Adds a 1px directional neon rim around the silhouette (+ optional 2nd ring) and an inner rim light.
  Art.outline = (src, rim, dim, pad = 1, ring2 = null, inner = 0.35) => {
    const w = src.width + pad * 2, h = src.height + pad * 2;
    const c = Art.canvas(w, h), g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(src, pad, pad);
    const img = g.getImageData(0, 0, w, h), d = img.data, N = w * h;
    const A = new Uint8Array(N);
    for (let j = 0; j < N; j++) {
      if (d[j * 4 + 3] >= 110) { A[j] = 1; d[j * 4 + 3] = 255; } else { d[j * 4] = d[j * 4 + 1] = d[j * 4 + 2] = d[j * 4 + 3] = 0; }
    }
    const RC = Art.hex(rim), DC = Art.hex(dim);
    const set = (j, C) => { d[j * 4] = C[0]; d[j * 4 + 1] = C[1]; d[j * 4 + 2] = C[2]; d[j * 4 + 3] = 255; };
    const ring = new Uint8Array(N);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const j = y * w + x;
      if (A[j]) continue;
      const below = y + 1 < h && A[j + w], left = x > 0 && A[j - 1], above = y > 0 && A[j - w], right = x + 1 < w && A[j + 1];
      if (below || left) { set(j, RC); ring[j] = 1; } else if (above || right) { set(j, DC); ring[j] = 1; }
    }
    if (inner > 0) {
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const j = y * w + x;
        if (!A[j] || !(ring[j - w] || ring[j + 1])) continue;
        const i = j * 4, lum = d[i] * 0.3 + d[i + 1] * 0.55 + d[i + 2] * 0.15;
        if (lum > 150) continue; // keep emissive details (eyes, blades)
        d[i] = Math.round(d[i] + (RC[0] - d[i]) * inner); d[i + 1] = Math.round(d[i + 1] + (RC[1] - d[i + 1]) * inner); d[i + 2] = Math.round(d[i + 2] + (RC[2] - d[i + 2]) * inner);
      }
    }
    if (ring2) {
      const C2 = Art.hex(ring2);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const j = y * w + x;
        if (A[j] || ring[j]) continue;
        if ((y + 1 < h && ring[j + w]) || (x > 0 && ring[j - 1]) || (y > 0 && ring[j - w]) || (x + 1 < w && ring[j + 1])) set(j, C2);
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  };
  // draw a canvas sliced into 2px strips with random horizontal jitter (glitch)
  Art.glitchDraw = (ctx, c, sx, sy, amt, skip = 0) => {
    const R = G.rand;
    for (let y = 0; y < c.height; y += 2) {
      if (skip && R.next() < skip) continue;
      const hh = Math.min(2, c.height - y);
      const off = R.next() < amt ? R.int(-3, 3) * Math.max(1, Math.round(amt * 2)) : 0;
      ctx.drawImage(c, 0, y, c.width, hh, sx + off, sy + y, c.width, hh);
    }
  };
  // segment vs AABB (Liang–Barsky)
  Art.segBox = (x0, y0, x1, y1, b, pad = 0) => {
    let t0 = 0, t1 = 1;
    const dx = x1 - x0, dy = y1 - y0;
    const clip = (p, q) => {
      if (p === 0) return q >= 0;
      const r = q / p;
      if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
      return true;
    };
    return clip(-dx, x0 - (b.x - pad)) && clip(dx, b.x + b.w + pad - x0) && clip(-dy, y0 - (b.y - pad)) && clip(dy, b.y + b.h + pad - y0);
  };
  // neon beam in screen coords (call inside the additive light pass)
  Art.beam = (ctx, x0, y0, x1, y1, color, core, width, alpha = 1) => {
    const pa = ctx.globalAlpha;
    ctx.globalAlpha = pa * 0.35 * alpha; G.px.line(ctx, x0, y0, x1, y1, color, width + 4);
    ctx.globalAlpha = pa * 0.8 * alpha; G.px.line(ctx, x0, y0, x1, y1, color, width + 1);
    ctx.globalAlpha = pa * alpha; G.px.line(ctx, x0, y0, x1, y1, core, Math.max(1, width - 1));
    ctx.globalAlpha = pa;
    const len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(len / 36));
    for (let i = 0; i <= n; i++) G.drawGlow(ctx, G.lerp(x0, x1, i / n), G.lerp(y0, y1, i / n), 12 + width * 2, color, 0.22 * alpha);
  };
  // thin solid telegraph line (additive pass)
  Art.tline = (ctx, x0, y0, x1, y1, color, width, alpha) => {
    const pa = ctx.globalAlpha;
    ctx.globalAlpha = pa * alpha; G.px.line(ctx, x0, y0, x1, y1, color, width);
    ctx.globalAlpha = pa;
    const len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(len / 48));
    for (let i = 0; i <= n; i++) G.drawGlow(ctx, G.lerp(x0, x1, i / n), G.lerp(y0, y1, i / n), 10 + width * 4, color, 0.12 * alpha);
  };
  // dotted aiming line (additive pass)
  Art.sight = (ctx, x0, y0, x1, y1, color, alpha = 1, gap = 3, t = 0) => {
    const len = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / (len || 1), uy = (y1 - y0) / (len || 1);
    const pa = ctx.globalAlpha;
    ctx.globalAlpha = pa * alpha; ctx.fillStyle = color;
    const o = (t * 40) % gap;
    for (let d = o; d < len; d += gap) ctx.fillRect(Math.round(x0 + ux * d), Math.round(y0 + uy * d), 1, 1);
    ctx.globalAlpha = pa;
  };

  // ---------------------------------------------------------------- humanoid rig
  // Angles: 0 = pointing down, +PI/2 = forward (facing right in raw frames), PI = up.
  const P0 = { tb: 0, lean: 0.05, head: 0, thF: 0.08, shF: -0.02, thB: -0.1, shB: -0.12, uaF: 0.15, faF: 0.35, uaB: -0.1, faB: 0.15 };
  const pz = (o) => Object.assign({}, P0, o);
  Art.pz = pz;
  // walk cycle helper (frame f of n)
  const walkLegs = (f, n, amp = 0.75, lift = 1.0) => {
    const ph = (f / n) * TAU, s = Math.sin(ph), c = Math.cos(ph);
    return { thF: s * amp, thB: -s * amp, shF: s * amp - 0.15 - Math.max(0, c) * lift, shB: -s * amp - 0.15 - Math.max(0, -c) * lift, s, c };
  };
  Art.walkLegs = walkLegs;
  Art.J = (P, B) => {
    const dv = (a, l) => [Math.sin(a) * l, Math.cos(a) * l];
    const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
    const drop = (th, sh) => Math.cos(th) * B.TH + Math.cos(sh) * B.SH;
    const hipH = Math.max(drop(P.thF, P.shF), drop(P.thB, P.shB), 3);
    const hip = [B.ox + (P.hx || 0), B.oy - hipH];
    const kneeF = add(hip, dv(P.thF, B.TH)), footF = add(kneeF, dv(P.shF, B.SH));
    const kneeB = add(hip, dv(P.thB, B.TH)), footB = add(kneeB, dv(P.shB, B.SH));
    const l = P.lean || 0;
    const neck = add(hip, [Math.sin(l) * B.TO, -Math.cos(l) * B.TO + (P.tb || 0)]);
    const hl = l + (P.head || 0);
    const head = add(neck, [Math.sin(hl) * B.HN, -Math.cos(hl) * B.HN]);
    const sx = B.shX || 1;
    const shF = add(neck, [Math.cos(l) * sx, Math.sin(l) * sx + 1]);
    const shB = add(neck, [-Math.cos(l) * sx, -Math.sin(l) * sx + 1]);
    const elbowF = add(shF, dv(P.uaF, B.UA)), handF = add(elbowF, dv(P.faF, B.FA));
    const elbowB = add(shB, dv(P.uaB, B.UA)), handB = add(elbowB, dv(P.faB, B.FA));
    return { hip, kneeF, footF, kneeB, footB, neck, head, shF, shB, elbowF, handF, elbowB, handB, lean: l, P };
  };
  // limb with a dark separator stroke (reads over the torso) and a 1px highlight on the lit side
  Art.limbS = (g, a, b, t0, t1, c, sep, hl) => {
    if (sep) Art.limb(g, a[0], a[1], b[0], b[1], t0 + 2, t1 + 2, sep);
    Art.limb(g, a[0], a[1], b[0], b[1], t0, t1, c);
    if (hl && t0 >= 2) {
      const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1;
      let nx = -dy / d, ny = dx / d;
      if (nx - ny < 0) { nx = -nx; ny = -ny; }
      const o0 = (t0 - 1) / 2, o1 = (t1 - 1) / 2;
      Art.line(g, a[0] + nx * o0, a[1] + ny * o0, b[0] + nx * o1, b[1] + ny * o1, hl, 1);
    }
  };
  Art.foot = (g, p, c, w = 4) => { g.fillStyle = c; g.fillRect(Math.round(p[0]) - 1, Math.round(p[1]) - 2, w, 2); };
  // default torso: trapezoid hip->neck with front highlight / back shade
  Art.torso = (g, J, P, B, cMain, cLight, cDark) => {
    const C = B.col, l = J.lean, nx = Math.cos(l), ny = Math.sin(l);
    const hw = B.hipW / 2, sw = B.shW / 2, h = J.hip, n = J.neck;
    const pts = [[h[0] - nx * hw, h[1] - ny * hw], [h[0] + nx * hw, h[1] + ny * hw], [n[0] + nx * sw, n[1] + ny * sw], [n[0] - nx * sw, n[1] - ny * sw]];
    Art.poly(g, pts, cMain || C.main);
    Art.line(g, pts[1][0] - nx * 0.8, pts[1][1] - ny * 0.8, pts[2][0] - nx * 0.8, pts[2][1] - ny * 0.8, cLight || C.light, 1);
    Art.line(g, pts[0][0] + nx * 0.6, pts[0][1] + ny * 0.6, pts[3][0] + nx * 0.6, pts[3][1] + ny * 0.6, cDark || C.dark, 1);
    return pts;
  };
  // point along the spine (k: 0 hip → 1 neck) offset `o` px toward the front
  Art.spine = (J, k, o = 0) => {
    const nx = Math.cos(J.lean), ny = Math.sin(J.lean);
    return [G.lerp(J.hip[0], J.neck[0], k) + nx * o, G.lerp(J.hip[1], J.neck[1], k) + ny * o];
  };
  Art.rig = (g, P, B) => {
    const J = Art.J(P, B), C = B.col;
    const L = (a, b, t0, t1, c) => Art.limb(g, a[0], a[1], b[0], b[1], t0, t1, c);
    const aw = B.armW || 2, lw = B.legW || 3;
    if (B.behind) B.behind(g, J, P, B);
    if (!B.noArmB) {
      L(J.shB, J.elbowB, aw, aw, C.armD || C.dark); L(J.elbowB, J.handB, aw, Math.max(1, aw - 1), C.armD || C.dark);
    }
    if (B.handB) B.handB(g, J, P, B);
    L(J.hip, J.kneeB, lw, lw, C.legD || C.dark); L(J.kneeB, J.footB, Math.max(1, lw - 1), Math.max(1, lw - 1), C.legD || C.dark);
    Art.foot(g, J.footB, C.footD || C.dark, B.footW || 4);
    if (B.torso) B.torso(g, J, P, B); else Art.torso(g, J, P, B);
    const sep = C.sep || '#140a1c';
    const LS = (a, b, t0, t1, c, hl) => Art.limbS(g, a, b, t0, t1, c, sep, hl);
    LS(J.hip, J.kneeF, lw, lw, C.leg || C.main, C.legL || C.light); L(J.kneeF, J.footF, Math.max(1, lw - 1), Math.max(1, lw - 1), C.leg || C.main);
    Art.foot(g, J.footF, C.foot || C.metal || C.dark, B.footW || 4);
    if (B.head) B.head(g, J, P, B);
    if (B.armF) B.armF(g, J, P, B);
    else { LS(J.shF, J.elbowF, aw, aw, C.arm || C.main, C.light); LS(J.elbowF, J.handF, aw, Math.max(1, aw - 1), C.arm || C.main, C.light); }
    if (B.handF) B.handF(g, J, P, B);
    return J;
  };
  // Look spec for rig characters. o: {w, h, ox, B, pose(anim,f), anims, rim, dim, after(g,J,P,anim,f)}
  const rigSpec = (o) => {
    o.B.ox = o.ox; o.B.oy = o.h;
    return {
      w: o.w, h: o.h, ox: o.ox, oy: o.h, rim: o.rim, dim: o.dim, anims: o.anims,
      draw(g, anim, f) { const P = o.pose(anim, f); const J = Art.rig(g, P, o.B); if (o.after) o.after(g, J, P, anim, f); },
      joints(anim, f) { return Art.J(o.pose(anim, f), o.B); },
    };
  };
  Art.rigSpec = rigSpec;

  // ---------------------------------------------------------------- Look (baked, cached frames)
  class Look {
    // spec: {w, h, ox, oy, rim, dim, anims:{name:frames}, draw(g, anim, f), joints?(anim,f)}
    constructor(spec, elite) {
      this.s = spec; this.elite = !!elite;
      this.S = elite ? ELITE_SCALE : 1;
      this.pad = elite ? 2 : 1;
      this.cache = new Map(); this.jc = new Map();
    }
    get(anim, f, flip, white) {
      const key = anim + '|' + f + (flip ? 'L' : 'R') + (white ? 'w' : '');
      let c = this.cache.get(key);
      if (c) return c;
      if (white) c = Art.white(this.get(anim, f, flip, false));
      else if (flip) c = Art.flip(this.get(anim, f, false, false));
      else {
        const s = this.s;
        let raw = Art.canvas(s.w, s.h);
        s.draw(raw.getContext('2d'), anim, f, this);
        if (this.S !== 1) raw = Art.scaleNN(raw, this.S);
        c = this.elite ? Art.outline(raw, '#fff3a6', '#ffb62e', 2, '#a8620a', 0.3) : Art.outline(raw, s.rim, s.dim, 1);
      }
      this.cache.set(key, c);
      return c;
    }
    anchor(c, flip) {
      const ax = Math.round(this.s.ox * this.S) + this.pad, ay = Math.round(this.s.oy * this.S) + this.pad;
      return [flip ? c.width - ax : ax, ay];
    }
    joints(anim, f) {
      const key = anim + '|' + f;
      let j = this.jc.get(key);
      if (!j && this.s.joints) { j = this.s.joints(anim, f); this.jc.set(key, j); }
      return j;
    }
  }
  G.ELook = Look;

  // ================================================================ enemy projectiles
  // plasma bolt drawFn (bright head, hot core, short trail)
  const boltDraw = (ctx, cam, p) => {
    const x = Math.round(p.x - cam.ox), y = Math.round(p.y - cam.oy);
    const sp = Math.hypot(p.vx, p.vy) || 1, ux = p.vx / sp, uy = p.vy / sp;
    G.px.line(ctx, x - ux * p.len, y - uy * p.len, x, y, p.color, 2);
    G.px.line(ctx, x - ux * p.len * 0.5, y - uy * p.len * 0.5, x, y, p.core, 1);
    G.px.disc(ctx, x, y, p.r, p.color);
    ctx.fillStyle = p.core; ctx.fillRect(x - 1, y - 1, 2, 2);
  };
  G.enemyBoltDraw = boltDraw;
  const fireBolt = (world, owner, x, y, ang, o = {}) => world.addProjectile(new G.Projectile(Object.assign({
    x, y, vx: Math.cos(ang) * (o.speed || 240), vy: Math.sin(ang) * (o.speed || 240), r: 2, team: 'enemy', dmg: owner.dmg, life: 2.2,
    color: PAL.red, core: '#ffe0e6', len: 8, glow: 16, drawFn: boltDraw,
    info: { kb: 110, kbUp: 80, source: owner },
    onWall(w) { w.fx.sparks(this.x, this.y, -G.sign(this.vx), 6, this.color); w.fx.ring(this.x, this.y, 1, 6, this.color, 0.15, 1); },
  }, o)));

  // homing orb (virus): steers toward the player for `homeTime` seconds
  class HomingOrb extends G.Projectile {
    update(dt, world) {
      let p = world.player;
      const dc = world.decoy;
      if (dc && !dc.dead && (!p || p.dead || G.dist(this.x, this.y, dc.cx, dc.cy) < G.dist(this.x, this.y, p.cx, p.cy))) p = dc;
      if (p && !p.dead && this.t < (this.homeTime || 3)) {
        const sp = Math.hypot(this.vx, this.vy) || 1;
        const cur = Math.atan2(this.vy, this.vx), want = Math.atan2(p.cy - this.y, p.cx - this.x);
        let d = ((want - cur + Math.PI * 3) % TAU) - Math.PI;
        const maxT = (this.turn || 1.8) * dt;
        const a = cur + G.clamp(d, -maxT, maxT);
        this.vx = Math.cos(a) * sp; this.vy = Math.sin(a) * sp;
      }
      if (G.rand.chance(dt * 25)) world.fx.particle({ x: this.x + G.rand.float(-2, 2), y: this.y + G.rand.float(-2, 2), vx: -this.vx * 0.2, vy: -this.vy * 0.2, life: 0.4, color: this.color, size: 1, additive: true });
      super.update(dt, world);
    }
    draw(ctx, cam) {
      const x = Math.round(this.x - cam.ox), y = Math.round(this.y - cam.oy);
      const pulse = Math.floor(this.t * 10) % 2;
      G.px.disc(ctx, x, y, 4, '#0d2a08');
      G.px.disc(ctx, x, y, 3, this.color);
      G.px.disc(ctx, x, y, 1 + pulse, '#f0ffd0');
      for (let i = 0; i < 3; i++) {
        const a = this.t * 6 + (i * TAU) / 3;
        ctx.fillStyle = i ? this.color : '#ffffff';
        ctx.fillRect(Math.round(x + Math.cos(a) * 6), Math.round(y + Math.sin(a) * 6), 1, 1);
      }
    }
    drawLight(ctx, cam) { G.drawGlow(ctx, this.x - cam.ox, this.y - cam.oy, 24, this.color, 0.7); }
  }
  G.HomingOrb = HomingOrb;

  // ground shockwave: travels along the floor, must be jumped over
  class GroundWave {
    constructor(o) {
      this.x = o.x; this.y = o.y; this.dir = o.dir; this.speed = o.speed || 170; this.life = o.life || 0.9;
      this.dmg = o.dmg || 10; this.h = o.h || 11; this.color = o.color || PAL.cyan; this.owner = o.owner || null;
      this.t = 0; this.dead = false; this.hit = false; this.team = 'enemy';
    }
    update(dt, world) {
      this.t += dt;
      if (this.t >= this.life) { this.dead = true; return; }
      const L = world.level;
      this.x += this.dir * this.speed * dt;
      if (L.solidAt(this.x + this.dir * 3, this.y - 4) || !L.floorAt(this.x, this.y + 2)) {
        this.dead = true; world.fx.sparks(this.x, this.y - 4, -this.dir, 6, this.color); return;
      }
      const hgt = this.h * this.fade;
      const box = { x: this.x - 4, y: this.y - hgt, w: 8, h: hgt };
      for (const v of [world.player, world.decoy]) {
        if (this.hit || !v || v.dead || !v.takeDamage || !G.overlap(box, v)) continue;
        if (v.takeDamage(this.dmg, { dir: this.dir, kb: 130, kbUp: 230, source: this.owner || this })) this.hit = true;
      }
      if (G.rand.chance(dt * 40)) world.fx.particle({ x: this.x + G.rand.float(-3, 3), y: this.y - 1, vx: this.dir * G.rand.float(10, 60), vy: -G.rand.float(40, 140), life: 0.35, color: G.rand.chance(0.5) ? this.color : '#ffffff', grav: 500, additive: true });
    }
    get fade() { return Math.min(1, (this.life - this.t) / 0.25 + 0.3); }
    draw(ctx, cam) {
      const x = Math.round(this.x - cam.ox), y = Math.round(this.y - cam.oy);
      const hgt = this.h * this.fade;
      for (let i = -4; i <= 4; i++) {
        const k = 1 - Math.abs(i + this.dir) / 5;
        const hh = Math.max(1, Math.round(hgt * k * (0.8 + 0.2 * Math.sin(this.t * 40 + i))));
        ctx.fillStyle = this.color; ctx.fillRect(x + i, y - hh, 1, hh);
        ctx.fillStyle = '#ffffff'; ctx.fillRect(x + i, y - hh, 1, Math.min(2, hh));
      }
    }
    drawLight(ctx, cam) { G.drawGlow(ctx, this.x - cam.ox, this.y - 5 - cam.oy, 26, this.color, 0.7 * this.fade); }
  }
  G.GroundWave = GroundWave;

  // ================================================================ Enemy base
  // Constructed with FEET position (x, y). Subclasses set size/stats in constructor via this.setup({...}),
  // draw via `drawBody(ctx, cam)` (preferred; base handles death dissolve + overlays) or override draw().
  class Enemy extends G.Actor {
    constructor(x, y, o = {}) {
      super(x - 6, y - 20, 12, 20);
      this.team = 'enemy';
      this.depth = o.depth || 0;
      this.elite = !!o.elite;
      this.opts = o;
      this.S = this.elite ? ELITE_SCALE : 1;
      this.state = 'idle'; this.stateT = 0;
      this.aggro = false; this.alertT = 0; this.teleT = 0; this.teleMax = 0;
      this.sight = 170; this.loseSight = 320;
      this.speed = 50; this.dmg = 10;
      this.cells = [0, 1]; this.gold = [1, 4];
      this.bloodColors = ['#1fd6ff', '#0b7fa8', '#16f0c0'];
      this.rim = PAL.cyan;
      this.deathT = 0; this.deathDur = 0.6; this.deathDir = 1;
      this.home = x; this.patrolDir = G.rand.sign(); this.patrolT = G.rand.float(1, 3);
      this.cooldown = 0;
      this.flying = false;
      this.hpBarT = 0;
      this.showHp = true;
      this.variant = 0;
      this.walkPh = 0; this.walkRate = 0.09;
      this.superArmor = false; this.untargetable = false; this.immobile = false;
      this.poise = 3; this.flinchN = 0; this.flinchT = 0; this.poiseT = 0;
      this.swingHit = false;
    }
    // stats: {w,h,hp,dmg,speed,sight,cells,gold,kbRes,stunRes,flying,poise}
    setup(s) {
      const feetX = this.cx, feetY = this.bottom;
      if (s.w) this.w = Math.round(s.w * this.S);
      if (s.h) this.h = Math.round(s.h * this.S);
      this.x = feetX - this.w / 2; this.y = feetY - this.h;
      const hpMul = (1 + 0.65 * this.depth) * (this.elite ? 3.2 : 1);
      const dmgMul = (1 + 0.35 * this.depth) * (this.elite ? 1.3 : 1);
      if (s.hp) this.maxHp = this.hp = Math.round(s.hp * hpMul);
      if (s.dmg) this.dmg = Math.round(s.dmg * dmgMul);
      for (const k of ['speed', 'sight', 'cells', 'gold', 'kbRes', 'stunRes', 'flying', 'poise']) if (s[k] != null) this[k] = s[k];
      if (this.elite) { this.kbRes = Math.max(this.kbRes, 0.6); this.stunRes = Math.max(this.stunRes, 0.5); this.cells = [this.cells[0] + 3, this.cells[1] + 6]; this.gold = [this.gold[0] + 4, this.gold[1] + 10]; }
      if (this.flying) this.noGravity = true;
    }
    // scaled damage of a secondary attack relative to base setup dmg
    scaled(base) { return Math.round(base * (1 + 0.35 * this.depth) * (this.elite ? 1.3 : 1)); }
    setState(s) { this.state = s; this.stateT = 0; }
    get player() { return G.world && G.world.player; }
    // what the AI chases/aims at: the hologram decoy (world.decoy) when alive and closer than the player
    get target() {
      const w = G.world;
      if (!w) return null;
      const p = w.player, d = w.decoy;
      if (d && !d.dead && !d.dying) {
        if (!p || p.dead || p.state === 'dead' || G.dist(this.cx, this.cy, d.cx, d.cy) < G.dist(this.cx, this.cy, p.cx, p.cy)) return d;
      }
      return p;
    }
    // every hittable on the player's side overlapping a test: the player and the decoy
    victims() {
      const w = G.world, out = [];
      if (w.player && !w.player.dead) out.push(w.player);
      if (w.decoy && !w.decoy.dead && !w.decoy.dying && w.decoy.takeDamage) out.push(w.decoy);
      return out;
    }
    distToPlayer() { const p = this.target; return p ? G.dist(this.cx, this.cy, p.cx, p.cy) : 1e9; }
    dxToPlayer() { const p = this.target; return p ? p.cx - this.cx : 0; }
    canSee(range = this.sight) {
      const p = this.target;
      if (!p || p.dead || p.state === 'dead') return false;
      const d = G.dist(this.cx, this.cy, p.cx, p.cy);
      if (d > range) return false;
      if (Math.abs(p.cy - this.cy) > 90 && !this.flying) return false;
      return G.world.level.lineClear(this.cx, this.y + 6, p.cx, p.y + 6);
    }
    onScreen(pad = 0) {
      const c = G.world.cam;
      return this.x + this.w > c.x - pad && this.x < c.x + c.w + pad && this.y + this.h > c.y - pad && this.y < c.y + c.h + pad;
    }
    facePlayer() { const dx = this.dxToPlayer(); if (dx) this.facing = G.sign(dx); }
    // is there floor ahead so we don't walk off ledges
    ledgeAhead(dir = this.facing) { return !this.groundAt(G.world.level, dir * 2); }
    wallAhead(dir = this.facing) {
      const L = G.world.level;
      const tx = Math.floor((dir > 0 ? this.x + this.w + 2 : this.x - 2) / TS);
      return L.solid(tx, Math.floor((this.bottom - 4) / TS)) || L.solid(tx, Math.floor((this.y + 2) / TS));
    }
    // continuous floor and no wall for `dist` px ahead
    pathClear(dist, dir = this.facing) {
      const L = G.world.level;
      for (let d = 3; d <= dist; d += 5) {
        const x = dir > 0 ? this.x + this.w + d : this.x - d;
        if (!L.floorAt(x, this.bottom + 2)) return false;
        if (L.solidAt(x, this.bottom - 4) || L.solidAt(x, this.y + 3)) return false;
      }
      return true;
    }
    // yellow "!" wind-up telegraph for `dur` seconds
    telegraph(dur) { this.teleT = this.teleMax = dur; snd('telegraph', { vol: 0.5 }); }
    notice() {
      if (this.aggro) return;
      this.aggro = true; this.alertT = 0.5;
      snd('enemyAlert', { vol: 0.4 });
    }
    // melee box in front: hits player
    meleeBox(reach, h = this.h, yOff = 0) {
      return { x: this.facing > 0 ? this.x + this.w - 2 : this.x + 2 - reach, y: this.y + yOff, w: reach, h };
    }
    // swing box from inside the body to `reach` past the front edge (robust when the player is close/overlapping)
    swingBox(reach, h = this.h, yOff = 0) {
      const back = this.w / 2 + 2;
      const w = this.w / 2 + back + reach - 2;
      return { x: this.facing > 0 ? this.cx - back : this.cx + back - w, y: this.y + yOff, w, h };
    }
    // stop a melee lunge before sliding through the player
    holdGap(gap = 5) {
      const p = this.target;
      if (!p) return;
      const dx = p.cx - this.cx, min = (this.w + p.w) / 2 + gap;
      if (Math.abs(dx) < min && G.sign(this.vx) === G.sign(dx)) this.vx = 0;
    }
    // box covering the body plus `reach` in front (for lunges/charges)
    frontBox(reach, yOff = 2, h = this.h - 4) {
      return { x: this.facing > 0 ? this.x : this.x - reach, y: this.y + yOff, w: this.w + reach, h };
    }
    hitPlayer(box, dmg = this.dmg, info = {}) {
      let best = 0;
      for (const v of this.victims()) {
        if (!G.overlap(box, v)) continue;
        const d = v.takeDamage(dmg, Object.assign({ dir: this.facing, kb: 120, kbUp: 100, source: this }, info));
        if (d > best) best = d;
      }
      return best;
    }
    // like hitPlayer but lands at most once per attack (reset swingHit when the attack starts)
    hitOnce(box, dmg = this.dmg, info = {}) {
      if (this.swingHit) return 0;
      const d = this.hitPlayer(box, dmg, info);
      if (d) this.swingHit = true;
      return d;
    }
    // hitscan segment vs player
    beamHit(x0, y0, x1, y1, pad, dmg, info = {}) {
      let best = 0;
      for (const v of this.victims()) {
        if (!Art.segBox(x0, y0, x1, y1, v, pad)) continue;
        const d = v.takeDamage(dmg, Object.assign({ dir: G.sign(x1 - x0) || this.facing, kb: 120, kbUp: 100, source: this }, info));
        if (d > best) best = d;
      }
      return best;
    }
    patrol(dt, speed = this.speed * 0.5) {
      this.patrolT -= dt;
      if (this.patrolT <= 0) { this.patrolT = G.rand.float(1.5, 3.5); this.patrolDir = G.rand.chance(0.3) ? 0 : G.rand.sign(); }
      if (this.patrolDir && (this.ledgeAhead(this.patrolDir) || this.wallAhead(this.patrolDir))) this.patrolDir *= -1;
      this.vx = G.approach(this.vx, this.patrolDir * speed * this.slowMul, 400 * dt);
      if (this.patrolDir) this.facing = this.patrolDir;
    }
    chase(dt, speed = this.speed, stopDist = 14) {
      const dx = this.dxToPlayer();
      const dir = Math.abs(dx) > stopDist ? G.sign(dx) : 0;
      if (dir) this.facing = dir;
      const blocked = dir && (this.ledgeAhead(dir) && !this.flying);
      this.vx = G.approach(this.vx, blocked ? 0 : dir * speed * this.slowMul, 600 * dt);
    }
    // ground: move away from the player (returns false when cornered)
    retreat(dt, speed) {
      const dir = -G.sign(this.dxToPlayer() || this.facing);
      const blocked = this.ledgeAhead(dir) || this.wallAhead(dir);
      this.vx = G.approach(this.vx, blocked ? 0 : dir * speed * this.slowMul, 600 * dt);
      this.facePlayer();
      return !blocked;
    }
    // flying: steer toward a world point
    fly(dt, tx, ty, speed, acc = 320) {
      const dx = tx - this.cx, dy = ty - this.cy, d = Math.hypot(dx, dy) || 1;
      const sp = speed * Math.min(1, d / 28) * this.slowMul;
      this.vx = G.approach(this.vx, (dx / d) * sp, acc * dt);
      this.vy = G.approach(this.vy, (dy / d) * sp, acc * dt);
      if (this.hitWall) this.vy = G.approach(this.vy, -speed, acc * dt * 2);
    }
    // flyers: stay inside open air (push away from nearby solids)
    avoidWalls(dt) {
      const L = G.world.level, r = Math.max(this.w, this.h) * 0.5 + 6;
      let px = 0, py = 0;
      for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (L.solidAt(this.cx + ax * r, this.cy + ay * r)) { px -= ax; py -= ay; }
      this.vx += px * 260 * dt; this.vy += py * 260 * dt;
    }

    takeDamage(amount, info = {}) {
      if (this.untargetable || this.dying || this.dead) return 0;
      if (this.filterHit) {
        const r = this.filterHit(amount, info);
        if (!r) return 0;
        amount = r.amount; info = r.info;
      }
      if (info.stun || info.kb) {
        let stun = info.stun || 0, kb = info.kb || 0;
        if (this.superArmor) { stun = 0; kb *= 0.25; }
        else if (stun && this.poise) {
          // poise: after `poise` quick flinches the enemy shrugs off stagger for a moment and retaliates
          if (this.poiseT > 0) { stun = 0; kb *= 0.4; }
          else {
            this.flinchN = this.flinchT > 0 ? this.flinchN + 1 : 1;
            this.flinchT = 1.1;
            if (this.flinchN >= this.poise) { this.poiseT = 1.2; this.flinchN = 0; }
          }
        }
        if (stun !== info.stun || kb !== info.kb) info = Object.assign({}, info, { stun, kb, kbUp: this.superArmor ? 0 : info.kbUp });
      }
      const was = this.state;
      const d = super.takeDamage(amount, info);
      if (d && this.stun > 0 && was !== 'stunned' && this.onInterrupt) this.onInterrupt(was);
      return d;
    }

    update(dt, world) {
      this.tickTimers(dt);
      this.updateStatuses(dt);
      if (this.hpBarT > 0) this.hpBarT -= dt;
      if (this.dying) { this.updateDeath(dt, world); return; }
      this.stateT += dt;
      if (this.alertT > 0) this.alertT -= dt;
      if (this.teleT > 0) this.teleT -= dt;
      if (this.cooldown > 0) this.cooldown -= dt;
      if (this.flinchT > 0) this.flinchT -= dt;
      if (this.poiseT > 0) this.poiseT -= dt;
      if (!this.aggro && this.canSee()) this.notice();
      if (this.aggro && this.distToPlayer() > this.loseSight) this.aggro = false;
      if (this.stun > 0) {
        this.teleT = 0;
        if (this.state !== 'stunned') this.setState('stunned');
        this.vx = G.approach(this.vx, 0, 500 * dt);
        if (this.flying) this.vy = G.approach(this.vy, 0, 500 * dt);
      } else {
        if (this.state === 'stunned') this.setState(this.aggro ? 'chase' : 'idle');
        this.ai(dt, world);
      }
      if (!this.noPhysics) this.physics(dt, world.level);
      if (!this.flying && this.onGround && this.stun > 0) this.vx *= Math.pow(0.02, dt);
      if (this.onGround || this.flying) this.walkPh += Math.abs(this.vx) * dt * this.walkRate;
      if (!this.flying && !this.immobile) this.separate(world, dt);
      if (this.y > world.level.ph + 50) { this.dead = true; }
    }
    ai(dt, world) {}
    // gentle push apart so groups don't stack into one sprite
    separate(world, dt) {
      if (this.state !== 'chase' && this.state !== 'idle') return;
      for (const o of world.enemies) {
        if (o === this || o.dying || o.flying || o.immobile) continue;
        const dx = this.cx - o.cx, dy = this.bottom - o.bottom;
        if (Math.abs(dy) > 8) continue;
        const min = (this.w + o.w) * 0.45;
        if (Math.abs(dx) < min) {
          const push = (dx === 0 ? (this.id < o.id ? -1 : 1) : G.sign(dx)) * 70 * dt * (1 - Math.abs(dx) / min);
          if (!(push > 0 ? this.wallAhead(1) || this.ledgeAhead(1) : this.wallAhead(-1) || this.ledgeAhead(-1))) this.x += push;
        }
      }
    }

    onHurt(dmg, info) {
      this.hpBarT = 3;
      if (!this.aggro) this.notice();
    }
    die(info) {
      if (this.dying) return;
      this.dying = true; this.deathT = 0; this.teleT = 0;
      this.untargetable = false;
      const w = G.world;
      const R = w.rng;
      this.deathDir = info && info.dir ? info.dir : -this.facing;
      if (this.flying) { this.noGravity = false; this.flying = false; this.vy = Math.min(this.vy, -60); }
      if (!this.immobile) this.vx = this.deathDir * 90 * (1 - this.kbRes * 0.7);
      const cells = R.int(this.cells[0], this.cells[1]);
      const gold = R.int(this.gold[0], this.gold[1]) * (1 + this.depth);
      w.dropCurrency(this.cx, this.cy, cells, gold);
      w.fx.burst(this.cx, this.cy, 22, { speed: 180, life: 0.6, color: this.bloodColors, size: [1, 2], grav: 500, decal: true });
      w.fx.burst(this.cx, this.cy, 10, { speed: 140, life: 0.35, color: [PAL.yellow, '#ffffff'], shape: 'spark', grav: 200, additive: true });
      w.fx.ring(this.cx, this.cy, 3, 20 * this.S, this.elite ? PAL.yellow : this.rim, 0.3, 1);
      w.shake(this.elite ? 5 : 2, 0.2);
      w.glitch = Math.max(w.glitch || 0, this.elite ? 0.5 : 0.12);
      this.prepareDissolve();
      if (this.elite && this.onEliteDeath) this.onEliteDeath(w);
      snd(this.elite ? 'eliteDie' : 'enemyDie');
      snd('glitch', { vol: 0.35 });
      G.emit('enemyKilled', { enemy: this, info });
    }
    // elites always drop an item
    onEliteDeath(world) {
      if (G.ItemDrop && G.rollLoot) {
        const inst = G.rollLoot(world, world.rng);
        if (inst) world.addObject(new G.ItemDrop(this.cx, this.y, inst, { pop: true }));
      }
      world.fx.flash(PAL.yellow, 0.08);
      world.hitstop(0.1);
      world.fx.ring(this.cx, this.cy, 4, 44, PAL.yellow, 0.45, 2);
    }
    // capture the last drawn frame's pixels for the glitch dissolve
    prepareDissolve() {
      const s = this._lastSpr;
      if (!s) return;
      const w = s.c.width, h = s.c.height;
      const tmp = Art.canvas(w, h), g = tmp.getContext('2d', { willReadFrequently: true });
      g.drawImage(s.c, 0, 0);
      const d = g.getImageData(0, 0, w, h).data;
      const rows = [];
      for (let y = 0; y < h; y++) {
        const r = [];
        for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; if (d[i + 3] > 0) r.push(x, Art.rgb(d[i], d[i + 1], d[i + 2])); }
        rows.push(r);
      }
      this.dis = { c: s.c, white: Art.white(s.c), tint: Art.tint(s.c, this.rim), dx: s.dx, dy: s.dy, w, h, rows, row: 0, t0: this.deathT };
    }
    // 0..1 progress of the pixel dissolve
    dissolveK() { return Math.min(1, Math.max(0, this.deathT - 0.08) / (this.deathDur * 0.8)); }
    updateDeath(dt, world) {
      this.deathT += dt;
      this.vx *= Math.pow(0.02, dt);
      if (!this.immobile) this.physics(dt, world.level);
      this.dissolveStep(world);
      if (this.deathT > this.deathDur) this.dead = true;
    }
    // emit glowing pixel dust from the rows the dissolve front has passed
    dissolveStep(world) {
      const D = this.dis;
      if (!D) return;
      const target = Math.floor(this.dissolveK() * D.h), rate = this.dissolveRate || 0.6;
      const bx = this.cx + D.dx, by = this.bottom + D.dy;
      while (D.row < target && D.row < D.h) {
        const r = D.rows[D.row];
        for (let i = 0; i < r.length; i += 2) {
          if (G.rand.next() > rate) continue;
          const up = G.rand.chance(0.6);
          world.fx.particle({
            x: bx + r[i], y: by + D.row, vx: G.rand.float(-22, 22) + this.deathDir * G.rand.float(5, 45), vy: up ? G.rand.float(-80, -20) : G.rand.float(-30, 10),
            life: G.rand.float(0.35, 0.85), color: r[i + 1], size: 1, grav: up ? -35 : 260, drag: up ? 2.2 : 0.8, additive: G.rand.chance(0.35),
          });
        }
        D.row++;
      }
    }

    // ---------------------------------------------------------------- drawing
    look() {
      const C = this.constructor;
      if (!Object.prototype.hasOwnProperty.call(C, '_looks')) C._looks = {};
      const key = (this.variant || 0) + (this.elite ? 'e' : '');
      return C._looks[key] || (C._looks[key] = C.makeLook(this.variant || 0, this.elite));
    }
    // draw a baked frame anchored at the feet; o: {dx, dy, glitch, skip, white, alpha}
    drawSpr(ctx, cam, anim, f, o = {}) {
      const L = this.look();
      const flip = this.facing < 0;
      const white = this.flash > 0 || o.white;
      const c = L.get(anim, f, flip, white);
      const [ax, ay] = L.anchor(c, flip);
      const sx = Math.round(this.cx - cam.ox) - ax + Math.round((o.dx || 0) * this.facing);
      const sy = Math.round(this.bottom - cam.oy) - ay + Math.round(o.dy || 0);
      if (o.alpha != null) ctx.globalAlpha = o.alpha;
      if (o.glitch) Art.glitchDraw(ctx, c, sx, sy, o.glitch, o.skip || 0);
      else ctx.drawImage(c, sx, sy);
      ctx.globalAlpha = 1;
      if (!white) this._lastSpr = { c, dx: sx + cam.ox - this.cx, dy: sy + cam.oy - this.bottom };
      return { c, sx, sy };
    }
    // world position of a rig joint for the current frame
    jointAt(anim, f, name) {
      const L = this.look(), J = L.joints(anim, f);
      if (!J) return [this.cx, this.cy];
      const p = J[name], s = L.s;
      return [this.cx + (p[0] - s.ox) * L.S * this.facing, this.bottom + (p[1] - s.oy) * L.S];
    }
    drawDissolve(ctx, cam) {
      const D = this.dis;
      const k = this.dissolveK();
      const bx = Math.round(this.cx + D.dx - cam.ox), by = Math.round(this.bottom + D.dy - cam.oy);
      const front = Math.floor(k * D.h);
      const src = this.deathT - (D.t0 || 0) < 0.08 ? D.white : D.c;
      const R = G.rand;
      for (let y = front; y < D.h; y += 2) {
        const hh = Math.min(2, D.h - y);
        const off = R.next() < 0.2 + k * 0.6 ? R.int(-2, 2) * (1 + Math.round(k * 2)) : 0;
        ctx.drawImage(src, 0, y, D.w, hh, bx + off, by + y, D.w, hh);
      }
      // chromatic ghost + hot scanline at the dissolve front
      if (front < D.h) {
        ctx.globalAlpha = 0.45 * (1 - k);
        ctx.drawImage(D.tint, 0, front, D.w, D.h - front, bx + 2, by + front, D.w, D.h - front);
        ctx.globalAlpha = 1;
        ctx.drawImage(D.white, 0, front, D.w, 1, bx, by + front, D.w, 1);
        ctx.drawImage(D.tint, 0, Math.min(D.h - 1, front + 1), D.w, 1, bx + R.int(-1, 1), by + front + 1, D.w, 1);
      }
    }
    // Legacy placeholder look (subclasses implement drawBody instead).
    drawPlaceholder(ctx, cam) {
      const x = Math.round(this.x - cam.ox), y = Math.round(this.y - cam.oy);
      G.px.rect(ctx, x - 1, y - 1, this.w + 2, this.h + 2, PAL.ink);
      G.px.rect(ctx, x, y, this.w, this.h, this.col('#4a3a5e'));
      G.px.rect(ctx, x + (this.facing > 0 ? this.w - 4 : 1), y + 4, 3, 2, this.col(PAL.red));
    }
    draw(ctx, cam0) {
      // freeze the (shaking) camera offset for this draw call
      const cam = { ox: cam0.ox, oy: cam0.oy, x: cam0.x, y: cam0.y, w: cam0.w, h: cam0.h };
      if (this.dying) {
        if (this.dis) this.drawDissolve(ctx, cam);
        else {
          ctx.globalAlpha = Math.max(0, 1 - this.deathT / this.deathDur);
          if (this.drawBody) this.drawBody(ctx, cam); else this.drawPlaceholder(ctx, cam);
          ctx.globalAlpha = 1;
        }
        return;
      }
      if (this.drawBody) this.drawBody(ctx, cam); else this.drawPlaceholder(ctx, cam);
      this.drawOverlay(ctx, cam);
    }
    // default body: baked frame chosen by frame() → [anim, f]
    drawBody(ctx, cam) {
      if (!this.frame || !this.constructor.makeLook) return this.drawPlaceholder(ctx, cam);
      const [a, f] = this.frame();
      this.drawSpr(ctx, cam, a, f);
    }
    idleF(n = 4, fps = 4) { return Math.floor(this.t * fps + this.id * 0.37) % n; }
    walkF(n = 6) { return Math.floor(this.walkPh) % n; }

    // helpers for draw overlays
    drawHpBar(ctx, cam) {
      if (this.hpBarT <= 0 || this.dying || this.hp >= this.maxHp || !this.showHp) return;
      const w = Math.max(14, Math.min(30, this.w + 6));
      const x = Math.round(this.cx - w / 2 - cam.ox), y = Math.round(this.y - 7 - cam.oy);
      G.px.rect(ctx, x - 1, y - 1, w + 2, 4, PAL.ink);
      G.px.rect(ctx, x, y, w, 2, '#3a1020');
      G.px.rect(ctx, x, y, Math.max(1, Math.round(w * this.hp / this.maxHp)), 2, this.elite ? PAL.yellow : PAL.red);
    }
    // big pixel "!" with a shrinking timing ring (drawn on top of the light pass)
    drawTelegraph(ctx, cam) {
      if (this.dying) return;
      const x = Math.round(this.cx - cam.ox), y = Math.round(this.y - cam.oy) - 17;
      if (this.teleT > 0) {
        const k = 1 - this.teleT / (this.teleMax || 1);
        const pop = k < 0.12 ? Math.round((1 - k / 0.12) * 3) : 0;
        const late = k > 0.7;
        const col = late ? (Math.floor(this.teleT * 24) % 2 ? '#ffffff' : PAL.yellow) : PAL.yellow;
        const yy = y - pop;
        ctx.fillStyle = PAL.ink;
        ctx.fillRect(x - 2, yy - 1, 5, 8); ctx.fillRect(x - 2, yy + 7, 5, 4);
        ctx.fillStyle = col;
        ctx.fillRect(x - 1, yy, 3, 5); ctx.fillRect(x, yy + 5, 1, 1); ctx.fillRect(x - 1, yy + 8, 3, 2);
        ctx.fillStyle = late ? PAL.orange : '#fff7c0'; ctx.fillRect(x - 1, yy, 1, 2);
        const r = Math.round(4 + 10 * (1 - k));
        ctx.globalAlpha = 0.55 + 0.45 * k;
        G.px.ring(ctx, x, yy + 5, r, late ? PAL.orange : PAL.yellow, 1);
        ctx.globalAlpha = 1;
      } else if (this.alertT > 0) {
        G.font.draw(ctx, '!', x + 1, y + 4 + Math.round(this.alertT * 6), PAL.white, 1, 'center');
      }
    }
    drawStatus(ctx, cam) {
      let i = 0;
      for (const n in this.statuses) {
        const c = { burn: PAL.orange, virus: PAL.lime, shock: PAL.cyan, cryo: '#9fe8ff' }[n];
        if (!c) continue;
        G.px.rect(ctx, Math.round(this.cx - cam.ox) - 6 + i * 4, Math.round(this.y - 11 - cam.oy), 3, 3, c);
        i++;
      }
    }
    // tint used when flashing
    col(c) { return this.flash > 0 ? '#ffffff' : c; }
    drawOverlay(ctx, cam) { this.drawHpBar(ctx, cam); this.drawStatus(ctx, cam); }
    drawOverlayTop(ctx, cam0) { this.drawTelegraph(ctx, { ox: cam0.ox, oy: cam0.oy }); }
    // eye position (world) for the glow; override per enemy
    eyePos() { return null; }
    drawLight(ctx, cam) {
      const ox = cam.ox, oy = cam.oy;
      if (this.dying) {
        const k = 1 - this.deathT / this.deathDur;
        if (k > 0) G.drawGlow(ctx, this.cx - ox, this.cy - oy, 30 * this.S, this.rim, 0.5 * k);
        return;
      }
      const r = Math.max(this.w, this.h);
      G.drawGlow(ctx, this.cx - ox, this.cy - oy, r * 1.7, this.rim, this.haloA != null ? this.haloA : 0.16);
      if (this.elite) G.drawGlow(ctx, this.cx - ox, this.cy - oy, r * 2.4, PAL.gold, 0.26 + Math.sin(this.t * 5) * 0.06);
      const e = this.eyePos();
      if (e) G.drawGlow(ctx, e[0] - ox, e[1] - oy, 6 * this.S, this.eyeCol || this.rim, 0.45);
      if (this.teleT > 0) {
        G.drawGlow(ctx, this.cx - ox, this.y - 12 - oy, 14, PAL.yellow, 0.45);
        G.drawGlow(ctx, this.cx - ox, this.cy - oy, r * 1.2, PAL.orange, 0.06 + 0.1 * (1 - this.teleT / (this.teleMax || 1)));
      }
    }
  }
  G.Enemy = Enemy;

  // ================================================================ ROSTER
  // Stats are depth-0 base values (setup scales: hp ×(1+0.65·depth), dmg ×(1+0.35·depth); elites ×3.2 hp).

  // ---------------------------------------------------------------- «Оболочка» husk (shambling cyborg zombie)
  const HUSK_COL = [
    { main: '#a3203f', light: '#ff7598', dark: '#5a0f27', metal: '#3c3658', metalL: '#8f8bbd', eye: '#eaff5a', jaw: '#6e1331', tooth: '#ffe0e8', mouth: '#1a0610', rim: '#ff4f7e', dim: '#a0143f' },
    { main: '#2e8a2a', light: '#bfff6a', dark: '#154716', metal: '#3c3658', metalL: '#8f8bbd', eye: '#ff5ae6', jaw: '#1c561c', tooth: '#eaffd0', mouth: '#06140a', rim: '#a4ff45', dim: '#2e8a1c' },
  ];
  const huskSpec = (v) => {
    const C = HUSK_COL[v];
    const B = {
      TH: 5, SH: 5, TO: 7, HN: 3, UA: 5, FA: 5, legW: 3, armW: 2, hipW: 5, shW: 8, shX: 2, col: C,
      torso(g, J, P, B) {
        Art.torso(g, J, P, B);
        for (let i = 0; i <= 4; i++) {
          const p = Art.spine(J, i / 4, -(G.lerp(B.hipW, B.shW, i / 4) / 2 - 0.5));
          Art.px(g, p[0], p[1], i % 2 ? C.metalL : C.metal);
        }
        for (let i = 0; i < 3; i++) { const p = Art.spine(J, 0.45 + i * 0.17, 0.5); Art.line(g, p[0], p[1], p[0] + Math.cos(J.lean) * 2, p[1] + Math.sin(J.lean) * 2, C.light); }
        const b = Art.spine(J, 0.2, -2.5);
        Art.line(g, b[0], b[1], b[0] - 2, b[1] + 3, C.metal); // dangling cable
      },
      head(g, J, P) {
        const [x, y] = J.head, jo = P.jaw || 0;
        if (jo) Art.rect(g, x, y + 1, 4, jo + 1, C.mouth);
        Art.rect(g, x, y + 1 + jo, 4, 2, C.jaw);
        Art.px(g, x + 1, y + 1 + jo, C.tooth); Art.px(g, x + 3, y + 1 + jo, C.tooth);
        Art.disc(g, x, y - 0.5, 3, C.main);
        Art.rect(g, x - 3, y - 2, 3, 3, C.metal); Art.px(g, x - 2, y - 3, C.metalL); Art.px(g, x - 3, y, C.metalL);
        Art.rect(g, x - 1, y - 4, 3, 1, C.light);
        Art.rect(g, x + 1, y - 1, 2, 1, C.eye);
      },
      handF(g, J) { const [x, y] = J.handF; Art.px(g, x + 1, y + 1, C.light); Art.px(g, x - 1, y + 1, C.light); },
    };
    return rigSpec({
      w: 32, h: 27, ox: 14, B, rim: C.rim, dim: C.dim,
      anims: { idle: 4, walk: 6, wind: 2, atk: 1, rec: 1, hurt: 1 },
      pose(anim, f) {
        if (anim === 'idle') { const s = Math.sin((f / 4) * TAU); return pz({ lean: 0.55, tb: f === 1 || f === 2 ? 1 : 0, head: 0.2 * s, uaF: 0.55 + 0.15 * s, faF: 0.25 + 0.12 * s, uaB: 0.3 - 0.1 * s, faB: 0.15, thF: 0.15, shF: -0.05, thB: -0.2, shB: -0.3, jaw: f === 2 ? 1 : 0 }); }
        if (anim === 'walk') { const W = walkLegs(f, 6, 0.5, 0.8); return pz(Object.assign(W, { lean: 0.6 + 0.1 * Math.sin((f / 6) * 2 * TAU), uaF: 0.75 + 0.3 * W.s, faF: 0.45 + 0.25 * W.s, uaB: 0.4 - 0.3 * W.s, faB: 0.3, head: -0.1 + 0.15 * W.c, jaw: f % 3 === 0 ? 1 : 0 })); }
        if (anim === 'wind') return pz({ lean: f ? -0.35 : -0.2, head: -0.45, uaF: 2.75, faF: 2.35, uaB: 2.95, faB: 2.6, thF: 0.65, shF: 0.0, thB: -0.45, shB: -0.9, jaw: 2 + f });
        if (anim === 'atk') return pz({ lean: 1.15, head: -0.35, uaF: 1.6, faF: 1.65, uaB: 1.35, faB: 1.5, thF: 0.95, shF: 0.35, thB: -1.1, shB: -0.6, jaw: 3 });
        if (anim === 'rec') return pz({ lean: 0.95, head: 0.25, uaF: 0.35, faF: 0.1, uaB: 0.2, faB: 0.05, thF: 0.55, shF: -0.35, thB: -0.35, shB: -0.5, jaw: 1 });
        return pz({ lean: 0.05, head: -0.6, uaF: -0.9, faF: -0.4, uaB: -1.3, faB: -0.7, thF: 0.35, shF: 0, thB: -0.35, shB: -0.3, jaw: 2 });
      },
    });
  };
  class Husk extends Enemy {
    constructor(x, y, o) {
      super(x, y, o);
      this.variant = G.rand.chance(0.35) ? 1 : 0;
      this.setup({ w: 12, h: 20, hp: 45, dmg: 11, speed: 34, sight: 150, cells: [0, 1], gold: [1, 3] });
      const C = HUSK_COL[this.variant];
      this.rim = C.rim; this.eyeCol = C.eye;
      this.bloodColors = this.variant ? ['#8cff3a', '#2e8a2a', '#16f0c0'] : ['#ff4f7e', '#8a1030', '#1fd6ff'];
      this.walkRate = 0.1;
    }
    static makeLook(v, elite) { return new Look(huskSpec(v), elite); }
    ai(dt) {
      const p = this.target;
      switch (this.state) {
        case 'idle': this.patrol(dt, 14); if (this.aggro) this.setState('chase'); break;
        case 'chase': {
          if (!this.aggro) { this.setState('idle'); break; }
          const lurch = 0.5 + 0.8 * Math.max(0, Math.sin(this.t * 4.2));
          this.chase(dt, this.speed * lurch, 18);
          const dx = Math.abs(this.dxToPlayer()), dy = p.bottom - this.bottom;
          if (dx < 58 * this.S && Math.abs(dy) < 20 && this.cooldown <= 0 && this.pathClear(Math.max(8, dx - 8))) {
            this.facePlayer(); this.setState('wind'); this.telegraph(0.55);
          }
          break;
        }
        case 'wind':
          this.vx = G.approach(this.vx, -this.facing * 14, 400 * dt);
          if (this.stateT >= 0.55) {
            this.setState('lunge'); this.vx = this.facing * 225; this.vy = -140; this.swingHit = false;
            snd('slash1', { pitch: 0.55, vol: 0.6 });
          }
          break;
        case 'lunge':
          this.hitOnce(this.frontBox(8 * this.S, 3, this.h - 6), this.dmg, { kb: 150, kbUp: 110 });
          if ((this.onGround && this.stateT > 0.1) || this.stateT > 0.8) this.setState('rec');
          break;
        case 'rec':
          this.vx = G.approach(this.vx, 0, 700 * dt);
          if (this.stateT >= 0.6) { this.cooldown = 1.0; this.setState('chase'); }
          break;
      }
    }
    frame() {
      switch (this.state) {
        case 'wind': return ['wind', this.stateT > 0.3 ? 1 : 0];
        case 'lunge': return ['atk', 0];
        case 'rec': return ['rec', 0];
        case 'stunned': return ['hurt', 0];
      }
      return Math.abs(this.vx) > 6 ? ['walk', this.walkF(6)] : ['idle', this.idleF(4, 3)];
    }
    eyePos() { const [x, y] = this.jointAt(...this.frame(), 'head'); return [x + this.facing * 2, y - 1]; }
  }
  G.defineEnemy('husk', Husk, { displayName: 'Оболочка', biomes: ['scrap', 'slums'], weight: { scrap: 4, slums: 1.3 } });

  // ---------------------------------------------------------------- «Утильщик» scrapper (buzzsaw charger)
  const SCR = { main: '#9a5214', light: '#ffb452', dark: '#4e2808', metal: '#3c3658', metalL: '#8f8bbd', visor: '#ffd43a', stripe: '#ffe14d', ink: '#1a1020', tank: '#c0342c', leg: '#6e3a10', rim: '#ffa640', dim: '#a8520e' };
  const scrapperSpec = () => {
    const C = SCR;
    const B = {
      TH: 5, SH: 5, TO: 8, HN: 4, UA: 5, FA: 5, legW: 4, armW: 3, hipW: 8, shW: 11, shX: 2, col: Object.assign({ leg: SCR.leg, foot: SCR.metal, footD: '#241f36' }, C),
      behind(g, J) {
        // gas tank on the back
        const a = Art.spine(J, 0.35, -5), b = Art.spine(J, 0.95, -5);
        Art.limb(g, a[0], a[1], b[0], b[1], 4, 4, C.tank);
        Art.line(g, a[0] - 1, a[1], b[0] - 1, b[1], '#ff7a5a');
        Art.px(g, b[0], b[1] - 2, C.metalL);
      },
      torso(g, J, P, B) {
        Art.torso(g, J, P, B);
        for (let i = 0; i < 5; i++) { const p = Art.spine(J, 0.55 + (i % 2) * 0.08, -3 + i * 1.5); Art.px(g, p[0], p[1], i % 2 ? C.ink : C.stripe); }
        const belt = Art.spine(J, 0.12, -4), belt2 = Art.spine(J, 0.12, 4);
        Art.line(g, belt[0], belt[1], belt2[0], belt2[1], C.dark);
      },
      head(g, J) {
        const [x, y] = J.head;
        Art.rect(g, x - 3, y - 3, 7, 6, C.metal);
        Art.rect(g, x - 2, y - 4, 5, 1, C.metal);
        Art.rect(g, x - 2, y - 3, 4, 1, C.metalL);
        Art.rect(g, x, y - 1, 4, 2, C.visor);
        Art.px(g, x + 3, y - 1, '#fff6c0');
        Art.rect(g, x - 3, y + 2, 5, 1, '#241f36');
      },
      armF(g, J) {
        Art.limb(g, J.shF[0], J.shF[1], J.elbowF[0], J.elbowF[1], 4, 3, C.metal);
        Art.limb(g, J.elbowF[0], J.elbowF[1], J.handF[0], J.handF[1], 3, 2, C.metalL);
        Art.rect(g, J.elbowF[0] - 1, J.elbowF[1] - 1, 2, 2, C.ink);
      },
    };
    return rigSpec({
      w: 34, h: 28, ox: 14, B, rim: C.rim, dim: C.dim,
      anims: { idle: 4, walk: 6, wind: 2, charge: 2, swingW: 1, swing: 1, rec: 1, hurt: 1 },
      pose(anim, f) {
        if (anim === 'idle') return pz({ lean: 0.2, tb: f === 1 || f === 2 ? 1 : 0, uaF: 0.9, faF: 1.5, uaB: -0.2, faB: 0.2, thF: 0.25, shF: -0.1, thB: -0.25, shB: -0.25 });
        if (anim === 'walk') { const W = walkLegs(f, 6, 0.6, 0.9); return pz(Object.assign(W, { lean: 0.28, uaF: 0.9, faF: 1.5 + 0.1 * W.s, uaB: 0.3 * W.s, faB: 0.4 + 0.3 * W.s })); }
        if (anim === 'wind') return pz({ lean: 0.45, head: -0.2, uaF: 1.9 - f * 0.1, faF: 1.7, uaB: -0.6, faB: -0.2, thF: 0.8, shF: -0.1, thB: -0.6, shB: -0.9 });
        if (anim === 'charge') { const s = f ? 1 : -1; return pz({ lean: 0.75, head: -0.4, uaF: 1.3, faF: 1.45, uaB: -0.9, faB: -0.5, thF: 0.5 + 0.4 * s, shF: 0.1 * s - 0.4, thB: -0.5 + 0.4 * s, shB: -0.9 }); }
        if (anim === 'swingW') return pz({ lean: -0.15, uaF: -2.6, faF: -2.9, uaB: 0.5, faB: 1.2, thF: 0.4, shF: 0, thB: -0.4, shB: -0.5 });
        if (anim === 'swing') return pz({ lean: 0.55, uaF: 1.3, faF: 0.9, uaB: -0.8, faB: -0.3, thF: 0.8, shF: 0.1, thB: -0.6, shB: -0.7 });
        if (anim === 'rec') return pz({ lean: -0.1, head: 0.5, uaF: 0.3, faF: 0.5, uaB: -0.3, faB: 0.0, thF: 0.3, shF: -0.1, thB: -0.3, shB: -0.3 });
        return pz({ lean: -0.3, head: -0.5, uaF: -0.4, faF: 0.2, uaB: -1.1, faB: -0.6, thF: 0.3, thB: -0.3 });
      },
    });
  };
  class Scrapper extends Enemy {
    constructor(x, y, o) {
      super(x, y, o);
      this.setup({ w: 14, h: 22, hp: 62, dmg: 14, speed: 42, sight: 180, cells: [1, 2], gold: [2, 4], kbRes: 0.35, stunRes: 0.2 });
      this.rim = SCR.rim; this.eyeCol = SCR.visor;
      this.bloodColors = ['#ffa640', '#6e3a10', '#1fd6ff'];
      this.saw = 0; this.sawV = 12;
    }
    static makeLook(v, elite) { return new Look(scrapperSpec(), elite); }
    onInterrupt() { this.superArmor = false; }
    ai(dt, world) {
      const p = this.target;
      const dx = Math.abs(this.dxToPlayer()), dy = p.bottom - this.bottom;
      switch (this.state) {
        case 'idle': this.patrol(dt, 18); if (this.aggro) this.setState('chase'); break;
        case 'chase':
          if (!this.aggro) { this.setState('idle'); break; }
          this.chase(dt, this.speed, 20);
          if (this.cooldown <= 0 && Math.abs(dy) < 18) {
            if (dx < 30 * this.S) { this.facePlayer(); this.setState('swingW'); this.telegraph(0.45); }
            else if (dx > 50 && dx < 170 && this.onScreen(-10) && this.pathClear(40)) { this.facePlayer(); this.setState('rev'); this.telegraph(0.75); snd('drone', { pitch: 1.6, vol: 0.5 }); }
          }
          break;
        case 'rev':
          this.vx = G.approach(this.vx, -this.facing * 20, 500 * dt);
          if (G.rand.chance(dt * 30)) { const s = this.sawPos(); world.fx.sparks(s[0], s[1] + 3, this.facing, 2, PAL.yellow); }
          if (this.stateT >= 0.75) { this.setState('charge'); this.swingHit = false; this.superArmor = true; snd('dash', { pitch: 0.7 }); }
          break;
        case 'charge': {
          this.vx = this.facing * 250;
          this.hitOnce(this.frontBox(10 * this.S, 4, this.h - 6), this.dmg, { kb: 230, kbUp: 150 });
          if (G.rand.chance(dt * 40)) world.fx.particle({ x: this.cx - this.facing * 6, y: this.bottom - 1, vx: -this.facing * 60, vy: -30, life: 0.3, color: '#6f6b8a', grav: 100 });
          if (this.wallAhead() || this.hitWall) {
            this.superArmor = false; this.setState('dazed'); this.vx = -this.facing * 80;
            const s = this.sawPos(); world.fx.sparks(s[0], s[1], -this.facing, 14, PAL.yellow); world.shake(4, 0.2); snd('hitArmor');
          } else if (this.ledgeAhead() || this.stateT > 0.95) { this.superArmor = false; this.setState('skid'); }
          break;
        }
        case 'skid':
          this.vx = G.approach(this.vx, 0, 700 * dt);
          if (this.stateT >= 0.45) { this.cooldown = 1.3; this.setState('chase'); }
          break;
        case 'dazed':
          this.vx = G.approach(this.vx, 0, 400 * dt);
          if (this.stateT >= 1.1) { this.cooldown = 1.0; this.setState('chase'); }
          break;
        case 'swingW':
          this.vx = G.approach(this.vx, 0, 600 * dt);
          if (this.stateT >= 0.45) { this.setState('swing'); this.swingHit = false; this.vx = this.facing * 90; snd('slash2', { pitch: 0.7 }); }
          break;
        case 'swing':
          if (this.stateT < 0.14) this.hitOnce(this.swingBox(20 * this.S, this.h, 0), this.scaled(12), { kb: 170, kbUp: 120 });
          this.vx = G.approach(this.vx, 0, 600 * dt); this.holdGap();
          if (this.stateT >= 0.55) { this.cooldown = 0.9; this.setState('chase'); }
          break;
      }
      const want = this.state === 'rev' ? 60 : this.state === 'charge' || this.state === 'swing' ? 45 : 12;
      this.sawV = G.approach(this.sawV, want, 90 * dt);
      this.saw += this.sawV * dt;
    }
    frame() {
      switch (this.state) {
        case 'rev': return ['wind', Math.floor(this.stateT * 12) % 2];
        case 'charge': return ['charge', Math.floor(this.stateT * 14) % 2];
        case 'skid': return ['wind', 0];
        case 'swingW': return ['swingW', 0];
        case 'swing': return ['swing', 0];
        case 'dazed': return ['rec', 0];
        case 'stunned': return ['hurt', 0];
      }
      return Math.abs(this.vx) > 6 ? ['walk', this.walkF(6)] : ['idle', this.idleF(4, 3)];
    }
    sawPos() { const [a, f] = this.frame(); return this.jointAt(a, f, 'handF'); }
    drawBody(ctx, cam) {
      const [a, f] = this.frame();
      this.drawSpr(ctx, cam, a, f, { dx: this.state === 'rev' ? G.rand.int(-1, 1) * 0.5 : 0 });
      // spinning buzzsaw at the mechanical hand
      const [wx, wy] = this.jointAt(a, f, 'handF');
      const x = Math.round(wx - cam.ox + this.facing * 2 * this.S), y = Math.round(wy - cam.oy);
      const r = Math.round(5 * this.S), hot = this.sawV > 30;
      const white = this.flash > 0;
      G.px.disc(ctx, x, y, r + 1, white ? '#fff' : '#120c1c');
      G.px.disc(ctx, x, y, r, white ? '#fff' : '#7d82a8');
      G.px.disc(ctx, x, y, r - 2, white ? '#fff' : '#b8bedf');
      ctx.fillStyle = white ? '#fff' : hot ? PAL.yellow : '#d8dcf5';
      for (let i = 0; i < 8; i++) {
        const an = this.saw + (i * TAU) / 8;
        ctx.fillRect(Math.round(x + Math.cos(an) * (r + 1)), Math.round(y + Math.sin(an) * (r + 1)), 1, 1);
      }
      ctx.fillStyle = white ? '#fff' : '#3c3658';
      for (let i = 0; i < 3; i++) { const an = this.saw * 0.5 + (i * TAU) / 3; ctx.fillRect(Math.round(x + Math.cos(an) * 2), Math.round(y + Math.sin(an) * 2), 1, 1); }
      G.px.rect(ctx, x - 1, y - 1, 2, 2, white ? '#fff' : SCR.stripe);
    }
    drawLight(ctx, cam) {
      super.drawLight(ctx, cam);
      if (this.dying) return;
      const [x, y] = this.sawPos();
      const hot = G.clamp((this.sawV - 12) / 48, 0, 1);
      G.drawGlow(ctx, x - cam.ox, y - cam.oy, 10 + hot * 12, hot > 0.3 ? PAL.orange : '#9aa0d0', 0.15 + hot * 0.3);
    }
    eyePos() { const [x, y] = this.jointAt(...this.frame(), 'head'); return [x + this.facing * 2, y]; }
  }
  G.defineEnemy('scrapper', Scrapper, { displayName: 'Утильщик', biomes: ['scrap'], weight: 2.2 });

  // ---------------------------------------------------------------- «Стрелок» gunner (laser-sighted plasma rifle)
  const GUN = { main: '#3b4f94', light: '#93adff', dark: '#1c2448', metal: '#4d4c78', metalL: '#b4bae8', accent: '#ff3348', visor: '#ff5a6a', gun: '#23213c', gunL: '#8a90c4', leg: '#2c3a70', legL: '#6a80d0', rim: '#ff5068', dim: '#8f1a36' };
  const GUN_AIMS = [-1.05, -0.52, 0, 0.52, 1.05];
  const gunnerSpec = () => {
    const C = GUN;
    const B = {
      TH: 5, SH: 6, TO: 8, HN: 3, UA: 4, FA: 5, legW: 3, armW: 2, hipW: 5, shW: 8, shX: 1, col: Object.assign({ leg: C.leg, foot: '#1b1a2e' }, C),
      torso(g, J, P, B) {
        Art.torso(g, J, P, B);
        const a = Art.spine(J, 0.3, 1.5), b = Art.spine(J, 0.85, 1.5);
        Art.line(g, a[0], a[1], b[0], b[1], C.accent);
        const s = Art.spine(J, 0.95, -1);
        Art.rect(g, s[0] - 2, s[1] - 1, 4, 2, C.metalL);
      },
      head(g, J) {
        const [x, y] = J.head;
        Art.disc(g, x, y, 3, C.main);
        Art.rect(g, x - 2, y - 3, 4, 1, C.light);
        Art.rect(g, x - 3, y - 1, 2, 3, C.dark);
        Art.rect(g, x - 1, y - 1, 5, 2, '#140a1c');
        Art.rect(g, x, y - 1, 4, 1, C.visor);
        Art.px(g, x + 3, y - 1, '#ffe0e4');
        Art.rect(g, x - 1, y + 2, 4, 1, C.metalL);
      },
      handF(g, J, P) {
        const a = P.aim != null ? P.aim : 0.9;
        const ux = Math.cos(a), uy = Math.sin(a), [hx, hy] = J.handF;
        const rb = P.rb || 0;
        Art.line(g, hx - ux * (4 + rb), hy - uy * (4 + rb), hx + ux * (11 - rb), hy + uy * (11 - rb), C.gun, 2);
        Art.line(g, hx + ux * 2, hy + uy * 2 - 1, hx + ux * (12 - rb), hy + uy * (12 - rb) - 1, C.gunL, 1);
        Art.px(g, hx + ux * (12 - rb), hy + uy * (12 - rb), C.accent);
        Art.px(g, hx + ux * 4, hy + uy * 4 - 2, C.accent);
        Art.rect(g, hx - 1, hy - 1, 2, 2, C.metalL);
      },
    };
    const aimPose = (a, rec) => {
      const la = Math.PI / 2 - a;
      return pz({ lean: 0.05 - (rec ? 0.12 : 0), aim: a, rb: rec ? 2 : 0, head: -a * 0.3, uaF: la - 0.9, faF: la, uaB: la - 0.35, faB: la + 0.15, thF: 0.35, shF: -0.1, thB: -0.3, shB: -0.3 });
    };
    return rigSpec({
      w: 40, h: 28, ox: 16, B, rim: C.rim, dim: C.dim,
      anims: { idle: 4, walk: 6, aim: 5, fire: 5, hurt: 1 },
      pose(anim, f) {
        if (anim === 'idle') return pz({ lean: 0.08, tb: f === 1 || f === 2 ? 1 : 0, aim: -0.95, uaF: 0.5, faF: 2.3, uaB: 0.9, faB: 2.2, thF: 0.2, shF: -0.1, thB: -0.2, shB: -0.2 });
        if (anim === 'walk') { const W = walkLegs(f, 6, 0.65, 0.9); return pz(Object.assign(W, { lean: 0.2, aim: -0.8, uaF: 0.55, faF: 2.2, uaB: 0.95, faB: 2.1 })); }
        if (anim === 'aim') return aimPose(GUN_AIMS[f], false);
        if (anim === 'fire') return aimPose(GUN_AIMS[f], true);
        return pz({ lean: -0.35, head: -0.4, aim: -0.6, uaF: -0.3, faF: 0.9, uaB: -1.0, faB: -0.4, thF: 0.3, thB: -0.3 });
      },
    });
  };
  class Gunner extends Enemy {
    constructor(x, y, o) {
      super(x, y, o);
      this.setup({ w: 12, h: 21, hp: 38, dmg: 11, speed: 46, sight: 210, cells: [0, 2], gold: [1, 4] });
      this.rim = GUN.rim; this.eyeCol = GUN.visor;
      this.aimA = 0; this.lockA = 0;
      this.bloodColors = ['#ff5068', '#2e3c6c', '#1fd6ff'];
    }
    static makeLook(v, elite) { return new Look(gunnerSpec(), elite); }
    muzzle(a = this.aimA) {
      const [hx, hy] = this.jointAt('aim', this.aimBucket(a), 'handF');
      const wa = this.worldAng(a);
      return [hx + Math.cos(wa) * 12 * this.S, hy + Math.sin(wa) * 12 * this.S];
    }
    // local aim (forward-relative) → world angle
    worldAng(a) { return this.facing > 0 ? a : Math.PI - a; }
    aimBucket(a) { let b = 0, bd = 9; GUN_AIMS.forEach((v, i) => { if (Math.abs(v - a) < bd) { bd = Math.abs(v - a); b = i; } }); return b; }
    trackAim() {
      const p = this.target;
      this.facePlayer();
      const [hx, hy] = this.jointAt('aim', 2, 'handF');
      const dx = Math.abs(p.cx - hx), dy = p.y + 10 - hy;
      return G.clamp(Math.atan2(dy, Math.max(4, dx)), -1.05, 1.05);
    }
    ai(dt, world) {
      const p = this.target;
      const dx = Math.abs(this.dxToPlayer());
      switch (this.state) {
        case 'idle': this.patrol(dt, 18); if (this.aggro) this.setState('chase'); break;
        case 'chase': {
          if (!this.aggro) { this.setState('idle'); break; }
          if (dx < 72) this.retreat(dt, this.speed);
          else if (dx > 165 || !this.canSee(this.sight + 40)) this.chase(dt, this.speed, 20);
          else { this.vx = G.approach(this.vx, 0, 500 * dt); this.facePlayer(); }
          if (this.cooldown <= 0 && dx < 220 && this.canSee(240) && this.onScreen(-8)) {
            this.setState('aim'); this.telegraph(0.9); this.aimA = this.trackAim();
          }
          break;
        }
        case 'aim':
          this.vx = G.approach(this.vx, 0, 600 * dt);
          if (this.stateT < 0.58) { this.aimA = G.lerp(this.aimA, this.trackAim(), Math.min(1, dt * 10)); this.lockA = this.aimA; }
          if (this.stateT >= 0.9) {
            this.setState('fire');
            const [mx, my] = this.muzzle(this.lockA);
            fireBolt(world, this, mx, my, this.worldAng(this.lockA), { speed: 250 });
            world.fx.burst(mx, my, 6, { angle: this.worldAng(this.lockA), spread: 0.5, speed: 140, life: 0.15, color: [PAL.red, '#ffffff'], shape: 'spark', grav: 0, additive: true });
            world.flashLights.push({ x: mx, y: my, r: 30, color: PAL.red, t: 0, life: 0.08 });
            this.vx = -this.facing * 40;
            snd('enemyShoot');
          }
          break;
        case 'fire':
          this.vx = G.approach(this.vx, 0, 500 * dt);
          if (this.stateT >= 0.35) { this.cooldown = 1.5 + G.rand.float(0, 0.5); this.setState('chase'); }
          break;
      }
    }
    frame() {
      switch (this.state) {
        case 'aim': return ['aim', this.aimBucket(this.aimA)];
        case 'fire': return [this.stateT < 0.12 ? 'fire' : 'aim', this.aimBucket(this.lockA)];
        case 'stunned': return ['hurt', 0];
      }
      return Math.abs(this.vx) > 6 ? ['walk', this.walkF(6)] : ['idle', this.idleF(4, 3)];
    }
    drawLight(ctx, cam) {
      super.drawLight(ctx, cam);
      if (this.dying || this.state !== 'aim') return;
      const L = G.world.level;
      const [mx, my] = this.muzzle(this.aimA), wa = this.worldAng(this.aimA);
      const hit = L.raycast(mx, my, mx + Math.cos(wa) * 320, my + Math.sin(wa) * 320);
      const locked = this.stateT >= 0.58;
      const blink = locked && Math.floor(this.stateT * 20) % 2 === 0;
      const sx = mx - cam.ox, sy = my - cam.oy, ex = hit.x - cam.ox, ey = hit.y - cam.oy;
      if (locked) Art.tline(ctx, sx, sy, ex, ey, blink ? '#ff8090' : PAL.red, 1, blink ? 0.95 : 0.55);
      else Art.sight(ctx, sx, sy, ex, ey, PAL.red, 0.7, 2, this.t);
      G.drawGlow(ctx, ex, ey, 8, PAL.red, 0.7);
    }
    eyePos() { const [x, y] = this.jointAt(...this.frame(), 'head'); return [x + this.facing * 2, y - 1]; }
  }
  G.defineEnemy('gunner', Gunner, { displayName: 'Стрелок', biomes: ['scrap', 'slums'], weight: { scrap: 2.4, slums: 1 } });

  // ---------------------------------------------------------------- «Мина-дрон» kamikaze mine drone (air)
  const MINE = { body: '#2c2a42', bodyL: '#6f6b9a', dark: '#15131f', stripe: '#ffe14d', ink: '#15131f', led: '#ff3348', ledHot: '#ffd0d6', rotor: '#aab0d6', rim: '#ffe14d', dim: '#9a7a10' };
  const mineSpec = () => ({
    w: 18, h: 17, ox: 9, oy: 17, rim: MINE.rim, dim: MINE.dim, anims: { idle: 4, armed: 4, hurt: 1 },
    draw(g, anim, f) {
      const C = MINE, cx = 9, cy = 10, armed = anim === 'armed';
      // rotor mast + blades
      Art.rect(g, cx, 2, 1, 3, C.dark);
      const bw = [7, 4, 1, 4][f % 4];
      Art.rect(g, cx - bw + 1, 1, bw * 2 - 1, 1, C.rotor);
      if (armed) { Art.px(g, cx, 16, C.stripe); Art.px(g, cx - 7, cy, C.stripe); Art.px(g, cx + 7, cy, C.stripe); Art.px(g, cx, 3, C.stripe); }
      Art.disc(g, cx, cy, 6, C.dark);
      Art.disc(g, cx, cy, 5, C.body);
      Art.rect(g, cx - 3, cy - 5, 4, 1, C.bodyL); Art.rect(g, cx - 4, cy - 4, 2, 2, C.bodyL);
      for (let x = -5; x <= 5; x++) Art.px(g, cx + x, cy + 1, (x + 10) % 3 === 0 ? C.ink : C.stripe);
      for (let x = -4; x <= 4; x++) Art.px(g, cx + x, cy + 2, (x + 11) % 3 === 0 ? C.ink : '#c8a810');
      // side fins
      Art.rect(g, cx - 7, cy - 1, 2, 3, C.dark); Art.rect(g, cx + 6, cy - 1, 2, 3, C.dark);
      // LED eye (front)
      const lit = armed || f % 2 === 0;
      Art.rect(g, cx + 2, cy - 2, 3, 2, lit ? C.led : '#5a1420');
      if (lit) Art.px(g, cx + 3, cy - 2, C.ledHot);
      if (anim === 'hurt') Art.rect(g, cx - 1, cy - 3, 3, 1, '#ffffff');
    },
  });
  class MineDrone extends Enemy {
    constructor(x, y, o) {
      super(x, y, o);
      this.setup({ w: 12, h: 12, hp: 14, dmg: 16, speed: 85, sight: 170, cells: [0, 1], gold: [1, 2], flying: true, poise: 0 });
      this.rim = MINE.rim; this.eyeCol = PAL.red;
      this.homeY = this.cy; this.home = this.cx;
      this.beep = 0; this.diveA = 0;
      this.bloodColors = ['#ffe14d', '#2c2a42', '#ff8a2a'];
    }
    static makeLook(v, elite) { return new Look(mineSpec(), elite); }
    explode(world) {
      if (this.dying || this.dead) return;
      G.explode(world, this.cx, this.cy, { radius: 26 * this.S, dmg: this.dmg, team: 'enemy', color: PAL.orange, info: { kb: 200, kbUp: 170, source: this } });
      world.fx.burst(this.cx, this.cy, 12, { speed: 160, life: 0.6, color: ['#2c2a42', '#6f6b9a', PAL.yellow], size: [1, 2], grav: 500 });
      this.dead = true;
    }
    ai(dt, world) {
      const p = this.target;
      const bob = Math.sin(this.t * 3 + this.id) * 6;
      switch (this.state) {
        case 'idle':
          this.fly(dt, this.home + Math.sin(this.t * 0.7 + this.id) * 20, this.homeY + bob, 30, 120);
          if (this.aggro) this.setState('chase');
          break;
        case 'chase': {
          if (!this.aggro) { this.setState('idle'); break; }
          const side = G.sign(this.cx - p.cx) || 1;
          this.fly(dt, p.cx + side * 34, p.y - 44 + bob, this.speed, 260);
          this.facing = -side;
          if (this.distToPlayer() < 85 && this.cooldown <= 0 && this.canSee(120)) { this.setState('arm'); this.telegraph(0.6); }
          break;
        }
        case 'arm': {
          this.vx *= Math.pow(0.02, dt); this.vy = G.approach(this.vy, -12, 200 * dt);
          this.facePlayer();
          this.beep -= dt;
          if (this.beep <= 0) { this.beep = 0.1; snd('telegraph', { pitch: 1.8, vol: 0.25 }); }
          if (this.stateT >= 0.6) {
            this.diveA = Math.atan2(p.cy - this.cy, p.cx - this.cx);
            this.setState('dive'); snd('dash', { pitch: 1.4 });
          }
          break;
        }
        case 'dive': {
          const sp = 300;
          this.vx = Math.cos(this.diveA) * sp; this.vy = Math.sin(this.diveA) * sp;
          if (G.rand.chance(dt * 50)) world.fx.particle({ x: this.cx, y: this.cy, vx: -this.vx * 0.2, vy: -this.vy * 0.2, life: 0.25, color: G.rand.chance(0.5) ? PAL.orange : PAL.yellow, additive: true });
          const box = { x: this.x - 2, y: this.y - 2, w: this.w + 4, h: this.h + 4 };
          if (this.victims().some((v) => G.overlap(box, v)) || this.hitWall || this.onGround || this.hitCeil || this.stateT > 0.9) this.explode(world);
          break;
        }
      }
      if (this.state !== 'dive') this.avoidWalls(dt);
    }
    frame() {
      if (this.state === 'stunned') return ['hurt', 0];
      return [this.state === 'arm' || this.state === 'dive' ? 'armed' : 'idle', Math.floor(this.t * 20) % 4];
    }
    drawBody(ctx, cam) {
      const [a, f] = this.frame();
      this.drawSpr(ctx, cam, a, f, { dx: this.state === 'arm' ? G.rand.int(-1, 1) : 0 });
    }
    eyePos() { return [this.cx + this.facing * 3, this.cy - 1]; }
    drawLight(ctx, cam) {
      super.drawLight(ctx, cam);
      if (this.dying) return;
      if (this.state === 'arm' || this.state === 'dive') G.drawGlow(ctx, this.cx - cam.ox, this.cy - cam.oy, 34, PAL.red, 0.35 + 0.3 * (Math.floor(this.t * 12) % 2));
    }
  }
  G.defineEnemy('minedrone', MineDrone, { displayName: 'Мина-дрон', biomes: ['scrap', 'slums'], weight: { scrap: 3, slums: 1.5 }, air: true });

  // ---------------------------------------------------------------- «Крысобот» rat-bot swarm crawler
  const RAT = { body: '#2f3b4e', bodyL: '#7390b8', dark: '#161c28', eye: '#c4ff3b', spine: '#58ff8f', tooth: '#e0ffe8', rim: '#5dff8f', dim: '#1e8a45' };
  const ratSpec = () => ({
    w: 24, h: 11, ox: 12, oy: 11, rim: RAT.rim, dim: RAT.dim, anims: { idle: 2, run: 4, wind: 1, bite: 1, hurt: 1 },
    draw(g, anim, f) {
      const C = RAT;
      const run = anim === 'run', wind = anim === 'wind', bite = anim === 'bite';
      const by = wind ? 6 : 7, lift = run && (f % 2) ? 1 : 0;
      // tail cable
      const tw = [0, 1, 0, -1][f % 4];
      Art.line(g, 7, by, 4, by - 1 + tw, C.dark); Art.line(g, 4, by - 1 + tw, 1, by - 3 - tw, C.dark);
      Art.px(g, 1, by - 3 - tw, C.spine);
      // legs
      const lp = run ? [[0, -1], [-1, 1], [1, 0], [0, 1]][f % 4] : [0, 0];
      for (const [lx, o] of [[9, lp[0]], [15, lp[1]]]) Art.rect(g, lx + o, by + 2, 1, 11 - (by + 2), C.dark);
      // body
      Art.ellipse(g, 12 - (bite ? -1 : 0), by - lift, wind ? 5 : 6, 3, C.body);
      Art.rect(g, 9, by - 3 - lift, 6, 1, C.bodyL);
      for (let i = 0; i < 3; i++) Art.px(g, 9 + i * 2, by - 3 - lift, C.spine);
      // head wedge
      const hx = bite ? 19 : 17, hy = wind ? by - 3 : by - 1 - lift;
      Art.poly(g, [[hx - 3, hy - 2], [hx + 3, hy + 1], [hx - 3, hy + 3]], C.body);
      Art.px(g, hx - 2, hy - 3, C.bodyL); // ear
      Art.px(g, hx, hy - 1 + (wind ? 0 : 0), C.eye);
      if (bite || wind) { Art.rect(g, hx - 1, hy + 2, 4, 1, '#0a0e14'); Art.px(g, hx + 1, hy + 3, C.tooth); Art.px(g, hx + 2, hy + 1, C.tooth); }
      for (const [lx, o] of [[11, lp[1]], [17, lp[0]]]) Art.rect(g, lx + o, by + 2, 1, 11 - (by + 2), C.bodyL);
      if (anim === 'hurt') Art.rect(g, 10, by - 1, 4, 1, '#ffffff');
    },
  });
  class RatBot extends Enemy {
    constructor(x, y, o) {
      super(x, y, o);
      this.setup({ w: 12, h: 8, hp: 16, dmg: 6, speed: 92, sight: 140, cells: [0, 1], gold: [0, 2], poise: 0 });
      this.rim = RAT.rim; this.eyeCol = RAT.eye;
      this.bloodColors = ['#5dff8f', '#2f3b4e', '#1fd6ff'];
      this.dash = G.rand.float(0.2, 1); this.walkRate = 0.12;
    }
    static makeLook(v, elite) { return new Look(ratSpec(), elite); }
    ai(dt, world) {
      // spawn the rest of the pack next to a level-placed rat
      if (!this.packDone) {
        this.packDone = true;
        if (this.opts.spawn && !this.opts.packChild && !this.elite) {
          for (const off of [-16, 18]) {
            const x = this.cx + off;
            if (world.level.floorAt(x, this.bottom + 2) && !world.level.solidAt(x, this.bottom - 4)) G.spawnEnemy(world, 'rat', x, this.bottom, { packChild: true });
          }
        }
      }
      const p = this.target;
      switch (this.state) {
        case 'idle': this.patrol(dt, 30); if (this.aggro) this.setState('chase'); break;
        case 'chase': {
          if (!this.aggro) { this.setState('idle'); break; }
          this.dash -= dt;
          const go = this.dash > 0 ? 1 : 0.15;
          if (this.dash < -0.25) this.dash = G.rand.float(0.4, 1.1);
          this.chase(dt, this.speed * go, 10);
          const dx = Math.abs(this.dxToPlayer());
          if (dx < 34 * this.S && Math.abs(p.bottom - this.bottom) < 14 && this.cooldown <= 0) { this.facePlayer(); this.setState('wind'); this.telegraph(0.32); }
          break;
        }
        case 'wind':
          this.vx = G.approach(this.vx, 0, 800 * dt);
          if (this.stateT >= 0.32) { this.setState('bite'); this.vx = this.facing * 175; this.vy = -150; this.swingHit = false; snd('slash1', { pitch: 1.8, vol: 0.4 }); }
          break;
        case 'bite':
          this.hitOnce(this.frontBox(6, 0, this.h), this.dmg, { kb: 90, kbUp: 60 });
          if ((this.onGround && this.stateT > 0.08) || this.stateT > 0.7) this.setState('rec');
          break;
        case 'rec':
          this.vx = G.approach(this.vx, 0, 700 * dt);
          if (this.stateT >= 0.4) { this.cooldown = 0.7 + G.rand.float(0, 0.5); this.setState('chase'); }
          break;
      }
    }
    frame() {
      switch (this.state) {
        case 'wind': return ['wind', 0];
        case 'bite': return ['bite', 0];
        case 'stunned': return ['hurt', 0];
      }
      return Math.abs(this.vx) > 8 ? ['run', this.walkF(4)] : ['idle', this.idleF(2, 3)];
    }
    eyePos() { return [this.cx + this.facing * 5, this.y + 1]; }
  }
  G.defineEnemy('rat', RatBot, { displayName: 'Крысобот', biomes: ['scrap', 'slums'], weight: { scrap: 1.0, slums: 0.5 } });

  // ---------------------------------------------------------------- «Панк» punk (knife double-slash + backstep)
  const PUNK = { main: '#3f2160', light: '#9a64e0', dark: '#1f0f32', leg: '#262640', legD: '#15152a', skin: '#e0a0b0', mask: '#1b1426', hawk: '#ff2a8a', hawkL: '#ffb8e0', trim: '#27f3ff', blade: '#c8feff', bladeE: '#27f3ff', visor: '#27f3ff', rim: '#ff4dab', dim: '#9a1a60' };
  const punkSpec = () => {
    const C = PUNK;
    const B = {
      TH: 6, SH: 6, TO: 8, HN: 3, UA: 5, FA: 5, legW: 3, armW: 2, hipW: 5, shW: 8, shX: 1, col: Object.assign({ foot: '#0f0d18', footD: '#0f0d18' }, C),
      torso(g, J, P, B) {
        Art.torso(g, J, P, B);
        const a = Art.spine(J, 0.1, 1.5), b = Art.spine(J, 0.9, 1.5);
        Art.line(g, a[0], a[1], b[0], b[1], C.trim);
        const s = Art.spine(J, 1, -2);
        Art.px(g, s[0], s[1] - 1, C.hawkL); Art.px(g, s[0] - 1, s[1], C.light);
      },
      head(g, J, P) {
        const [x, y] = J.head;
        Art.disc(g, x, y, 3, C.skin);
        Art.rect(g, x - 1, y + 1, 5, 2, C.mask);
        Art.rect(g, x, y - 1, 4, 1, C.visor);
        Art.rect(g, x - 3, y - 2, 2, 3, C.mask);
        const sw = P.hawk || 0;
        for (let i = 0; i < 5; i++) {
          const hx = x - 2 + i, hh = [2, 4, 5, 4, 3][i];
          Art.rect(g, hx - sw * (i < 3 ? 1 : 0), y - 3 - hh, 1, hh, i % 2 ? C.hawk : '#e0207a');
          Art.px(g, hx - sw * (i < 3 ? 1 : 0), y - 3 - hh, C.hawkL);
        }
      },
      handF(g, J, P) {
        const [ex, ey] = J.elbowF, [hx, hy] = J.handF;
        const d = Math.hypot(hx - ex, hy - ey) || 1, ux = (hx - ex) / d, uy = (hy - ey) / d;
        const rev = P.rev ? -1 : 1;
        Art.line(g, hx, hy, hx + ux * 6 * rev, hy + uy * 6 * rev, C.bladeE, 2);
        Art.line(g, hx + ux * rev, hy + uy * rev, hx + ux * 6 * rev, hy + uy * 6 * rev, C.blade, 1);
        Art.rect(g, hx - 1, hy - 1, 2, 2, C.skin);
      },
    };
    return rigSpec({
      w: 34, h: 30, ox: 14, B, rim: C.rim, dim: C.dim,
      anims: { idle: 4, run: 6, wind: 1, slash: 2, dodge: 1, hurt: 1 },
      pose(anim, f) {
        if (anim === 'idle') { const b = f === 1 || f === 2 ? 1 : 0; return pz({ lean: 0.18, tb: b, uaF: 1.0, faF: 2.1, uaB: 0.8, faB: 2.3, thF: 0.35, shF: -0.25, thB: -0.3, shB: -0.4, hawk: b }); }
        if (anim === 'run') { const W = walkLegs(f, 6, 0.95, 1.2); return pz(Object.assign(W, { lean: 0.42, uaF: 0.4 - 0.7 * W.s, faF: 1.6 - 0.5 * W.s, uaB: 0.4 + 0.7 * W.s, faB: 1.6 + 0.5 * W.s, hawk: 1 })); }
        if (anim === 'wind') return pz({ lean: -0.1, head: 0.1, uaF: -1.6, faF: -2.3, uaB: 1.0, faB: 1.8, thF: 0.7, shF: -0.1, thB: -0.6, shB: -0.9, hawk: 1 });
        if (anim === 'slash') return f === 0
          ? pz({ lean: 0.55, uaF: 1.65, faF: 1.3, uaB: -0.9, faB: -0.3, thF: 1.0, shF: 0.3, thB: -0.8, shB: -0.5, hawk: 2 })
          : pz({ lean: 0.45, uaF: 2.3, faF: 2.8, rev: 1, uaB: -0.6, faB: 0.1, thF: 0.9, shF: 0.2, thB: -0.7, shB: -0.5, hawk: 2 });
        if (anim === 'dodge') return pz({ lean: -0.45, head: -0.2, uaF: 1.4, faF: 2.4, uaB: -1.6, faB: -1.2, thF: 1.3, shF: -0.4, thB: 0.6, shB: -1.2, hawk: -1 });
        return pz({ lean: -0.35, head: -0.45, uaF: -0.2, faF: 0.9, uaB: -1.2, faB: -0.5, thF: 0.3, thB: -0.3 });
      },
    });
  };
  class Punk extends Enemy {
    constructor(x, y, o) {
      super(x, y, o);
      this.setup({ w: 11, h: 22, hp: 36, dmg: 8, speed: 95, sight: 180, cells: [0, 2], gold: [1, 4] });
      this.rim = PUNK.rim; this.eyeCol = PUNK.visor;
      this.bloodColors = ['#ff4dab', '#3f2160', '#1fd6ff'];
      this.dodgeCd = 0; this.walkRate = 0.075;
    }
    static makeLook(v, elite) { return new Look(punkSpec(), elite); }
    onHurt(dmg, info) {
      super.onHurt(dmg, info);
      if (this.dodgeCd <= 0 && this.hp > 0 && this.hp < this.maxHp * 0.75 && G.rand.chance(0.35)) this.wantDodge = true;
    }
    startDodge() {
      this.facePlayer(); this.setState('dodge'); this.wantDodge = false; this.dodgeCd = 2.2;
      this.vx = -this.facing * 175; this.vy = -190; this.invuln = 0.18;
      snd('dash', { pitch: 1.2, vol: 0.5 });
    }
    ai(dt, world) {
      const p = this.target;
      if (this.dodgeCd > 0) this.dodgeCd -= dt;
      const dx = Math.abs(this.dxToPlayer());
      if (this.wantDodge && this.onGround && this.state !== 'dodge' && !this.ledgeAhead(-G.sign(this.dxToPlayer() || 1))) { this.startDodge(); return; }
      switch (this.state) {
        case 'idle': this.patrol(dt, 30); if (this.aggro) this.setState('chase'); break;
        case 'chase':
          if (!this.aggro) { this.setState('idle'); break; }
          this.chase(dt, this.speed, 16);
          if (dx < 38 * this.S && Math.abs(p.bottom - this.bottom) < 20 && this.cooldown <= 0) { this.facePlayer(); this.setState('wind'); this.telegraph(0.4); }
          break;
        case 'wind':
          this.vx = G.approach(this.vx, 0, 700 * dt);
          if (this.stateT >= 0.4) { this.setState('s1'); this.swingHit = false; this.vx = this.facing * 150; snd('slash1', { pitch: 1.2 }); }
          break;
        case 's1':
          if (this.stateT < 0.12) this.hitOnce(this.swingBox(19 * this.S, 14, 4), this.dmg, { kb: 70 });
          this.vx = G.approach(this.vx, 0, 900 * dt); this.holdGap();
          if (this.stateT >= 0.3) { this.setState('s2'); this.swingHit = false; this.facePlayer(); this.vx = this.facing * 170; snd('slash2', { pitch: 1.3 }); }
          break;
        case 's2':
          if (this.stateT < 0.12) this.hitOnce(this.swingBox(20 * this.S, 18, 0), this.dmg, { kb: 150, kbUp: 90 });
          this.vx = G.approach(this.vx, 0, 900 * dt); this.holdGap();
          if (this.stateT >= 0.3) {
            this.cooldown = 1.0;
            if (this.dodgeCd <= 0 && G.rand.chance(0.55) && !this.ledgeAhead(-this.facing)) this.startDodge();
            else this.setState('rec');
          }
          break;
        case 'rec':
          this.vx = G.approach(this.vx, 0, 700 * dt);
          if (this.stateT >= 0.35) this.setState('chase');
          break;
        case 'dodge':
          if (this.onGround && this.stateT > 0.1) { this.vx = 0; this.setState('chase'); this.cooldown = Math.max(this.cooldown, 0.5); }
          break;
      }
    }
    frame() {
      switch (this.state) {
        case 'wind': return ['wind', 0];
        case 's1': return ['slash', 0];
        case 's2': return ['slash', 1];
        case 'rec': return ['slash', 1];
        case 'dodge': return ['dodge', 0];
        case 'stunned': return ['hurt', 0];
      }
      return Math.abs(this.vx) > 8 ? ['run', this.walkF(6)] : ['idle', this.idleF(4, 5)];
    }
    drawBody(ctx, cam) {
      const [a, f] = this.frame();
      this.drawSpr(ctx, cam, a, f);
      if ((this.state === 's1' || this.state === 's2') && this.stateT < 0.1 && !this.swingHit) {
        // blade arc
        const cx = this.cx + this.facing * 8 - cam.ox, cy = this.y + (this.state === 's1' ? 12 : 8) - cam.oy;
        ctx.fillStyle = PUNK.blade;
        for (let i = 0; i < 9; i++) {
          const an = (this.state === 's1' ? -1.2 + i * 0.3 : 1.2 - i * 0.3);
          const r = 12 * this.S;
          ctx.fillRect(Math.round(cx + Math.cos(an) * r * this.facing), Math.round(cy + Math.sin(an) * r), 2, 1);
        }
      }
    }
    eyePos() { const [x, y] = this.jointAt(...this.frame(), 'head'); return [x + this.facing * 2, y - 1]; }
  }
  G.defineEnemy('punk', Punk, { displayName: 'Панк', biomes: ['slums', 'spire'], weight: { slums: 3.5, spire: 1 } });

  // ---------------------------------------------------------------- «Громила» bruiser (riot shield brute)
  const BRU = { main: '#30365e', light: '#8290e6', dark: '#171a33', armor: '#474f88', armorL: '#b0bcff', visor: '#ff3348', glove: '#5a5f94', gloveL: '#a0a8e0', shield: '#10324a', grid: '#1f86a8', edge: '#6ff8ff', stripe: '#ffe14d', leg: '#262a4a', rim: '#8f9bff', dim: '#3a3f8f' };
  const drawShield = (g, cx, cy, ang, C) => {
    // riot shield: 7x22 rotated by ang (0 = upright)
    const c = Math.cos(ang), s = Math.sin(ang);
    const pt = (u, v) => [cx + u * c - v * s, cy + u * s + v * c];
    const w = 3.5, hh = 11;
    Art.poly(g, [pt(-w, -hh), pt(w, -hh), pt(w, hh), pt(-w, hh)], C.shield);
    for (let v = -hh + 3; v < hh; v += 4) { const a = pt(-w + 1, v), b = pt(w - 1, v); Art.line(g, a[0], a[1], b[0], b[1], C.grid); }
    const m0 = pt(-w + 1, -2), m1 = pt(w - 1, -2);
    Art.line(g, m0[0], m0[1], m1[0], m1[1], C.stripe);
    const e0 = pt(w, -hh), e1 = pt(w, hh), e2 = pt(-w, -hh);
    Art.line(g, e0[0], e0[1], e1[0], e1[1], C.edge);
    Art.line(g, e2[0], e2[1], e0[0], e0[1], C.edge);
  };
  const bruiserSpec = () => {
    const C = BRU;
    const B = {
      TH: 7, SH: 7, TO: 11, HN: 4, UA: 7, FA: 7, legW: 5, armW: 4, hipW: 10, shW: 16, shX: 3, footW: 6,
      col: Object.assign({ leg: C.leg, legD: '#15172a', foot: '#1b1d33', footD: '#101122', armD: '#1d2140' }, C),
      handB(g, J) { const [x, y] = J.handB; Art.disc(g, x, y, 3, C.glove); Art.px(g, x - 1, y - 2, C.gloveL); },
      torso(g, J, P, B) {
        const pts = Art.torso(g, J, P, B);
        const a = Art.spine(J, 0.45, 0), b = Art.spine(J, 0.95, 0);
        const nx = Math.cos(J.lean), ny = Math.sin(J.lean);
        Art.poly(g, [[a[0] - nx * 4, a[1] - ny * 4], [a[0] + nx * 5, a[1] + ny * 5], [b[0] + nx * 7, b[1] + ny * 7], [b[0] - nx * 6, b[1] - ny * 6]], C.armor);
        Art.line(g, b[0] - nx * 5, b[1] - ny * 5 + 1, b[0] + nx * 6, b[1] + ny * 6 + 1, C.armorL);
        Art.px(g, a[0] + nx * 3, a[1] + ny * 3 - 2, C.visor);
        return pts;
      },
      head(g, J) {
        const [x, y] = J.head;
        Art.rect(g, x - 3, y - 3, 7, 6, C.armor);
        Art.rect(g, x - 2, y - 4, 5, 1, C.armorL);
        Art.px(g, x - 2, y - 5, '#ff4050'); Art.px(g, x - 1, y - 5, '#5a8aff');
        Art.rect(g, x, y - 1, 4, 1, C.visor);
        Art.px(g, x + 3, y - 1, '#ffd0d6');
        Art.rect(g, x - 3, y + 2, 7, 1, C.dark);
      },
      armF(g, J) {
        Art.limb(g, J.shF[0], J.shF[1], J.elbowF[0], J.elbowF[1], 5, 4, C.main);
        Art.limb(g, J.elbowF[0], J.elbowF[1], J.handF[0], J.handF[1], 4, 3, C.main);
        Art.disc(g, J.shF[0], J.shF[1], 3, C.armor); Art.px(g, J.shF[0], J.shF[1] - 3, C.armorL);
      },
      handF(g, J, P) {
        const [hx, hy] = J.handF;
        const a = P.shA || 0;
        drawShield(g, hx + 3 * Math.cos(a) + (P.shO || 0), hy - 3 * Math.cos(a) + (P.shV || 0), a, C);
      },
    };
    return rigSpec({
      w: 46, h: 38, ox: 19, B, rim: C.rim, dim: C.dim,
      anims: { idle: 4, walk: 6, slamW: 2, slam: 1, bashW: 1, bash: 1, rec: 1, hurt: 1 },
      pose(anim, f) {
        if (anim === 'idle') return pz({ lean: 0.12, tb: f === 1 || f === 2 ? 1 : 0, uaF: 0.7, faF: 1.1, uaB: 0.2, faB: 0.6, thF: 0.3, shF: -0.15, thB: -0.3, shB: -0.3 });
        if (anim === 'walk') { const W = walkLegs(f, 6, 0.45, 0.7); return pz(Object.assign(W, { lean: 0.18, tb: Math.abs(W.c) > 0.7 ? 1 : 0, uaF: 0.7, faF: 1.1, uaB: 0.2 + 0.25 * W.s, faB: 0.6 + 0.2 * W.s })); }
        if (anim === 'slamW') return pz({ lean: -0.2 - f * 0.08, head: -0.2, uaF: 2.7, faF: 2.9, shA: Math.PI / 2, shO: -2, shV: -2, uaB: -2.6, faB: -2.9, thF: 0.5, shF: -0.1, thB: -0.45, shB: -0.6 });
        if (anim === 'slam') return pz({ lean: 0.6, head: 0.1, uaF: 1.2, faF: 0.6, shV: 1, uaB: 1.0, faB: 0.7, thF: 0.9, shF: 0.0, thB: -0.7, shB: -0.9 });
        if (anim === 'bashW') return pz({ lean: -0.12, uaF: 0.1, faF: 0.8, shO: -2, uaB: 0.1, faB: 0.4, thF: 0.4, shF: -0.1, thB: -0.4, shB: -0.5 });
        if (anim === 'bash') return pz({ lean: 0.42, uaF: 1.4, faF: 1.5, shO: 2, uaB: -0.5, faB: -0.1, thF: 0.8, shF: 0.1, thB: -0.8, shB: -0.5 });
        if (anim === 'rec') return pz({ lean: 0.7, head: 0.3, uaF: 0.8, faF: 0.5, shV: 2, uaB: 0.3, faB: 0.2, thF: 0.7, shF: -0.3, thB: -0.5, shB: -0.7 });
        return pz({ lean: -0.3, head: -0.4, uaF: 0.3, faF: 0.8, uaB: -1.0, faB: -0.5, thF: 0.3, thB: -0.3 });
      },
    });
  };
  class Bruiser extends Enemy {
    constructor(x, y, o) {
      super(x, y, o);
      this.setup({ w: 18, h: 30, hp: 90, dmg: 16, speed: 30, sight: 170, cells: [2, 3], gold: [3, 6], kbRes: 0.9, stunRes: 0.85, poise: 1 });
      this.rim = BRU.rim; this.eyeCol = BRU.visor;
      this.bloodColors = ['#8f9bff', '#30365e', '#1fd6ff'];
      this.behindT = 0; this.shieldFlash = 0; this.walkRate = 0.07;
    }
    static makeLook(v, elite) { return new Look(bruiserSpec(), elite); }
    get guarding() { return !['slamW', 'slam', 'slamRec', 'stunned'].includes(this.state) && !this.dying; }
    // the riot shield soaks frontal hits (roll through / flank, or punish the open slam)
    filterHit(amount, info) {
      if (this.guarding && info.dir && info.dir === -this.facing) {
        this.shieldFlash = 0.15;
        const w = G.world;
        const sx = this.cx + this.facing * (this.w / 2 + 3), sy = this.cy - 2;
        w.fx.sparks(sx, sy, this.facing, 9, PAL.cyan);
        w.fx.ring(sx, sy, 2, 10, PAL.cyan, 0.15, 1);
        snd('shield', { vol: 0.7 });
        return { amount: amount * 0.2, info: Object.assign({}, info, { stun: 0, kb: 0, kbUp: 0, color: '#8a92c8', noFlash: true }) };
      }
      return { amount, info };
    }
    ai(dt, world) {
      const p = this.target;
      if (this.shieldFlash > 0) this.shieldFlash -= dt;
      const rdx = this.dxToPlayer(), dx = Math.abs(rdx);
      // slow to turn around: flanking is rewarded
      if (this.aggro && G.sign(rdx) !== this.facing && dx > 4) {
        this.behindT += dt;
        if (this.behindT > 0.65 && ['chase', 'idle'].includes(this.state)) { this.facing = G.sign(rdx); this.behindT = 0; world.fx.burst(this.cx, this.bottom, 4, { speed: 40, life: 0.3, color: ['#4a4666'], grav: 100 }); }
      } else this.behindT = 0;
      switch (this.state) {
        case 'idle': this.patrol(dt, 14); if (this.aggro) this.setState('chase'); break;
        case 'chase': {
          if (!this.aggro) { this.setState('idle'); break; }
          const front = G.sign(rdx) === this.facing;
          const dir = front && dx > 26 ? this.facing : 0;
          this.vx = G.approach(this.vx, dir && !this.ledgeAhead(dir) ? dir * this.speed * this.slowMul : 0, 300 * dt);
          if (front && this.cooldown <= 0 && Math.abs(p.bottom - this.bottom) < 24) {
            if (dx < 26 * this.S) { this.setState('bashW'); this.telegraph(0.45); }
            else if (dx < 60 * this.S) { this.setState('slamW'); this.telegraph(0.85); snd('heavy', { vol: 0.5, pitch: 0.7 }); }
          }
          break;
        }
        case 'slamW':
          this.vx = G.approach(this.vx, 0, 500 * dt);
          if (this.stateT >= 0.85) {
            this.setState('slam'); this.swingHit = false;
            const gx = this.cx + this.facing * 16 * this.S, gy = this.bottom;
            this.hitOnce({ x: gx - 20, y: gy - 26, w: 40, h: 26 }, this.dmg, { kb: 200, kbUp: 200 });
            for (const d of [-1, 1]) world.addProjectile(new GroundWave({ x: gx + d * 8, y: gy, dir: d, speed: 175, life: 0.85, dmg: this.scaled(10), h: 11, color: PAL.cyan, owner: this }));
            world.fx.ring(gx, gy, 4, 34, PAL.cyan, 0.3, 2);
            world.fx.burst(gx, gy - 2, 16, { angle: -Math.PI / 2, spread: 1.3, speed: 190, life: 0.45, color: ['#6f6b8a', PAL.cyan, '#ffffff'], grav: 600 });
            world.shake(5, 0.3); world.hitstop(0.04);
            world.flashLights.push({ x: gx, y: gy, r: 70, color: PAL.cyan, t: 0, life: 0.2 });
            snd('heavy'); snd('explosion', { vol: 0.35, pitch: 1.5 });
          }
          break;
        case 'slam':
          if (this.stateT >= 0.12) this.setState('slamRec');
          break;
        case 'slamRec':
          if (this.stateT >= 1.0) { this.cooldown = 1.4; this.setState('chase'); }
          break;
        case 'bashW':
          this.vx = G.approach(this.vx, 0, 500 * dt);
          if (this.stateT >= 0.45) { this.setState('bash'); this.swingHit = false; this.vx = this.facing * 150; snd('shield', { pitch: 0.7 }); }
          break;
        case 'bash':
          if (this.stateT < 0.15) this.hitOnce(this.frontBox(10 * this.S, 0, this.h), this.scaled(8), { kb: 280, kbUp: 140 });
          this.vx = G.approach(this.vx, 0, 700 * dt); this.holdGap(2);
          if (this.stateT >= 0.55) { this.cooldown = 1.0; this.setState('chase'); }
          break;
      }
    }
    frame() {
      switch (this.state) {
        case 'slamW': return ['slamW', this.stateT > 0.5 ? 1 : 0];
        case 'slam': return ['slam', 0];
        case 'slamRec': return [this.stateT < 0.7 ? 'slam' : 'rec', 0];
        case 'bashW': return ['bashW', 0];
        case 'bash': return ['bash', 0];
        case 'stunned': return ['hurt', 0];
      }
      return Math.abs(this.vx) > 5 ? ['walk', this.walkF(6)] : ['idle', this.idleF(4, 2)];
    }
    drawLight(ctx, cam) {
      super.drawLight(ctx, cam);
      if (this.dying) return;
      // riot siren on the helmet
      const [sx, sy] = this.jointAt(...this.frame(), 'head');
      const blue = Math.floor(this.t * 5) % 2 === 0;
      G.drawGlow(ctx, sx - this.facing * 2 - cam.ox, sy - 5 - cam.oy, 12, blue ? '#3d6bff' : PAL.red, 0.55);
      if (this.guarding) {
        const [hx, hy] = this.jointAt(...this.frame(), 'handF');
        G.drawGlow(ctx, hx + this.facing * 4 - cam.ox, hy - 3 - cam.oy, this.shieldFlash > 0 ? 40 : 20, PAL.cyan, this.shieldFlash > 0 ? 0.9 : 0.3);
      }
    }
    eyePos() { const [x, y] = this.jointAt(...this.frame(), 'head'); return [x + this.facing * 2, y - 1]; }
  }
  G.defineEnemy('bruiser', Bruiser, { displayName: 'Громила', biomes: ['slums', 'spire'], weight: { slums: 1.5, spire: 1 } });

  // ---------------------------------------------------------------- «Снайпер» sniper (telegraphed beam)
  const SNI = { main: '#143f4c', light: '#3fc0d4', dark: '#0a2029', coat: '#0f303b', inner: '#1d2b3a', lens: '#7dff9a', rifle: '#2e2c48', rifleL: '#6f7299', scope: '#27f3ff', leg: '#1a2432', rim: '#3df2ff', dim: '#0f6b80' };
  const SNI_AIMS = [-1.0, -0.5, 0, 0.5, 1.0];
  const sniperSpec = () => {
    const C = SNI;
    const B = {
      TH: 7, SH: 7, TO: 9, HN: 3, UA: 5, FA: 5, legW: 3, armW: 2, hipW: 5, shW: 7, shX: 1, col: Object.assign({ leg: C.leg, legD: '#101822', foot: '#0c0f18', footD: '#0c0f18' }, C),
      behind(g, J, P) {
        // long coat tail flowing behind the legs
        const h = J.hip, n = J.neck, fl = P.flap || 0;
        Art.poly(g, [[n[0] - 3, n[1] + 1], [n[0] + 2, n[1] + 1], [h[0] + 1, h[1] + 2], [h[0] - 5 - fl, h[1] + 9], [h[0] - 8 - fl, h[1] + 7]], C.coat);
        Art.line(g, h[0] - 5 - fl, h[1] + 9, h[0] - 8 - fl, h[1] + 7, C.light);
      },
      head(g, J) {
        const [x, y] = J.head;
        Art.disc(g, x, y, 3, C.dark);
        Art.rect(g, x - 3, y - 4, 5, 2, C.main);
        Art.rect(g, x - 4, y - 2, 2, 5, C.main);
        Art.rect(g, x, y - 1, 4, 3, '#05090c');
        Art.px(g, x + 1, y - 1, C.lens); Art.px(g, x + 3, y - 1, C.lens); Art.px(g, x + 2, y + 1, C.lens);
        Art.px(g, x - 1, y - 4, C.light);
      },
      handF(g, J, P) {
        const a = P.aim != null ? P.aim : 1.1;
        const ux = Math.cos(a), uy = Math.sin(a), [hx, hy] = J.handF, rb = P.rb || 0;
        Art.line(g, hx - ux * (5 + rb), hy - uy * (5 + rb), hx + ux * (18 - rb), hy + uy * (18 - rb), C.rifle, 2);
        Art.line(g, hx + ux * 4, hy + uy * 4, hx + ux * (20 - rb), hy + uy * (20 - rb), C.rifleL, 1);
        const sx = hx + ux * 3 + uy * 2, sy = hy + uy * 3 - ux * 2;
        Art.line(g, sx, sy, sx + ux * 5, sy + uy * 5, C.dark, 2);
        Art.px(g, sx + ux * 5, sy + uy * 5, C.scope);
        Art.px(g, hx + ux * (20 - rb), hy + uy * (20 - rb), C.scope);
      },
    };
    const aimPose = (a, rec) => {
      const la = Math.PI / 2 - a;
      return pz({ lean: 0.02 - (rec ? 0.15 : 0), aim: a, rb: rec ? 2 : 0, head: -a * 0.3, uaF: la - 0.95, faF: la, uaB: la - 0.3, faB: la + 0.1, thF: 0.45, shF: -0.15, thB: -0.35, shB: -0.35, flap: rec ? 2 : 0 });
    };
    return rigSpec({
      w: 46, h: 32, ox: 16, B, rim: C.rim, dim: C.dim,
      anims: { idle: 4, walk: 6, aim: 5, fire: 5, jump: 1, hurt: 1 },
      pose(anim, f) {
        if (anim === 'idle') return pz({ lean: 0.05, tb: f === 1 || f === 2 ? 1 : 0, aim: 1.25, uaF: 0.2, faF: 0.9, uaB: 0.3, faB: 1.2, flap: f % 2 });
        if (anim === 'walk') { const W = walkLegs(f, 6, 0.6, 0.9); return pz(Object.assign(W, { lean: 0.12, aim: 1.2, uaF: 0.25, faF: 0.9, uaB: 0.35, faB: 1.2, flap: 1 + (f % 2) })); }
        if (anim === 'aim') return aimPose(SNI_AIMS[f], false);
        if (anim === 'fire') return aimPose(SNI_AIMS[f], true);
        if (anim === 'jump') return pz({ lean: -0.4, aim: -0.4, uaF: 0.3, faF: 1.4, uaB: -0.8, faB: -0.2, thF: 1.2, shF: -0.3, thB: 0.4, shB: -1.0, flap: 3 });
        return pz({ lean: -0.35, head: -0.4, aim: 0.9, uaF: -0.2, faF: 0.7, uaB: -1.0, faB: -0.4, thF: 0.3, thB: -0.3, flap: 2 });
      },
    });
  };
  class Sniper extends Enemy {
    constructor(x, y, o) {
      super(x, y, o);
      this.setup({ w: 11, h: 25, hp: 32, dmg: 18, speed: 38, sight: 260, cells: [1, 2], gold: [2, 5] });
      this.loseSight = 380;
      this.rim = SNI.rim; this.eyeCol = SNI.lens;
      this.bloodColors = ['#3df2ff', '#143f4c', '#7dff9a'];
      this.aimA = 0; this.lockA = 0; this.hopCd = 0; this.beamEnd = null; this.beamT = 0;
    }
    static makeLook(v, elite) { return new Look(sniperSpec(), elite); }
    worldAng(a) { return this.facing > 0 ? a : Math.PI - a; }
    aimBucket(a) { let b = 0, bd = 9; SNI_AIMS.forEach((v, i) => { if (Math.abs(v - a) < bd) { bd = Math.abs(v - a); b = i; } }); return b; }
    muzzle(a = this.aimA) {
      const [hx, hy] = this.jointAt('aim', this.aimBucket(a), 'handF');
      const wa = this.worldAng(a);
      return [hx + Math.cos(wa) * 20 * this.S, hy + Math.sin(wa) * 20 * this.S];
    }
    trackAim() {
      const p = this.target;
      this.facePlayer();
      const [hx, hy] = this.jointAt('aim', 2, 'handF');
      return G.clamp(Math.atan2(p.cy - hy, Math.max(6, Math.abs(p.cx - hx))), -1.0, 1.0);
    }
    beamLine(a) {
      const [mx, my] = this.muzzle(a), wa = this.worldAng(a);
      const h = G.world.level.raycast(mx, my, mx + Math.cos(wa) * 360, my + Math.sin(wa) * 360);
      return [mx, my, h.x, h.y];
    }
    ai(dt, world) {
      const p = this.target;
      const dx = Math.abs(this.dxToPlayer());
      if (this.hopCd > 0) this.hopCd -= dt;
      if (this.beamT > 0) this.beamT -= dt;
      switch (this.state) {
        case 'idle': this.patrol(dt, 14); if (this.aggro) this.setState('chase'); break;
        case 'chase':
          if (!this.aggro) { this.setState('idle'); break; }
          if (dx < 64 && this.hopCd <= 0 && this.onGround && !this.ledgeAhead(-G.sign(this.dxToPlayer() || 1)) && !this.wallAhead(-G.sign(this.dxToPlayer() || 1))) {
            this.facePlayer(); this.setState('hop'); this.vx = -this.facing * 160; this.vy = -260; this.hopCd = 3; snd('dash', { vol: 0.4 });
            break;
          }
          if (!this.canSee(this.sight + 60)) this.chase(dt, this.speed, 40);
          else { this.vx = G.approach(this.vx, 0, 500 * dt); this.facePlayer(); }
          if (this.cooldown <= 0 && this.canSee(300) && this.onScreen(-6) && dx > 40) { this.setState('aim'); this.telegraph(1.4); this.aimA = this.trackAim(); snd('charge', { vol: 0.5, pitch: 0.6 }); }
          break;
        case 'hop':
          if (this.onGround && this.stateT > 0.1) { this.vx = 0; this.setState('chase'); }
          break;
        case 'aim':
          this.vx = G.approach(this.vx, 0, 600 * dt);
          if (this.stateT < 1.0) { this.aimA = G.lerp(this.aimA, this.trackAim(), Math.min(1, dt * 7)); this.lockA = this.aimA; }
          if (this.stateT >= 1.4) {
            this.setState('fire'); this.swingHit = false;
            const [x0, y0, x1, y1] = this.beamLine(this.lockA);
            this.beamEnd = [x0, y0, x1, y1]; this.beamT = 0.18;
            if (this.beamHit(x0, y0, x1, y1, 2, this.dmg, { kb: 200, kbUp: 120 })) this.swingHit = true;
            world.fx.sparks(x1, y1, -G.sign(x1 - x0), 10, PAL.cyan);
            world.fx.burst(x0, y0, 8, { angle: this.worldAng(this.lockA), spread: 0.4, speed: 200, life: 0.2, color: [PAL.cyan, '#ffffff'], shape: 'spark', grav: 0, additive: true });
            world.flashLights.push({ x: x0, y: y0, r: 50, color: PAL.cyan, t: 0, life: 0.12 });
            world.flashLights.push({ x: x1, y: y1, r: 40, color: PAL.cyan, t: 0, life: 0.2 });
            world.shake(2, 0.12);
            this.vx = -this.facing * 60;
            snd('enemyLaser');
          }
          break;
        case 'fire':
          if (!this.swingHit && this.stateT < 0.08 && this.beamEnd) { const b = this.beamEnd; if (this.beamHit(b[0], b[1], b[2], b[3], 2, this.dmg, { kb: 200, kbUp: 120 })) this.swingHit = true; }
          this.vx = G.approach(this.vx, 0, 500 * dt);
          if (this.stateT >= 0.6) { this.cooldown = 2.0 + G.rand.float(0, 0.6); this.setState('chase'); }
          break;
      }
    }
    frame() {
      switch (this.state) {
        case 'aim': return ['aim', this.aimBucket(this.aimA)];
        case 'fire': return [this.stateT < 0.15 ? 'fire' : 'aim', this.aimBucket(this.lockA)];
        case 'hop': return ['jump', 0];
        case 'stunned': return ['hurt', 0];
      }
      return Math.abs(this.vx) > 6 ? ['walk', this.walkF(6)] : ['idle', this.idleF(4, 2)];
    }
    drawLight(ctx, cam) {
      super.drawLight(ctx, cam);
      if (this.dying) return;
      const ox = cam.ox, oy = cam.oy;
      if (this.state === 'aim') {
        const [x0, y0, x1, y1] = this.beamLine(this.aimA);
        const k = this.stateT;
        if (k < 1.0) Art.sight(ctx, x0 - ox, y0 - oy, x1 - ox, y1 - oy, PAL.cyan, 0.5 + 0.3 * (k / 1.0), 2, this.t);
        else {
          const kk = (k - 1.0) / 0.4, blink = Math.floor(k * 22) % 2 === 0;
          Art.tline(ctx, x0 - ox, y0 - oy, x1 - ox, y1 - oy, blink ? '#c8feff' : PAL.cyan, 1 + Math.round(kk), 0.5 + kk * 0.45);
        }
        G.drawGlow(ctx, x1 - ox, y1 - oy, 12, PAL.cyan, 0.8);
      }
      if (this.beamT > 0 && this.beamEnd) {
        const b = this.beamEnd, k = this.beamT / 0.18;
        Art.beam(ctx, b[0] - ox, b[1] - oy, b[2] - ox, b[3] - oy, PAL.cyan, '#ffffff', Math.round(1 + 4 * k), k);
      }
    }
    eyePos() { const [x, y] = this.jointAt(...this.frame(), 'head'); return [x + this.facing * 2, y]; }
  }
  G.defineEnemy('sniper', Sniper, { displayName: 'Снайпер', biomes: ['slums', 'spire'], weight: { slums: 2, spire: 1.2 } });

  // ---------------------------------------------------------------- «Хак-дрон» hacker drone (virus orbs, air)
  const HACK = { shell: '#2f3a52', shellL: '#7a92b8', dark: '#151b28', screen: '#061206', glyph: '#b6ff3b', glyphD: '#3a8a10', rotor: '#aab0d6', rim: '#b6ff3b', dim: '#4a8a10' };
  const HACK_GLYPHS = [
    ['0110', '1001', '1111', '0110'],
    ['0110', '1111', '1001', '0110'],
    ['1001', '0110', '0110', '1001'],
    ['0110', '1011', '1101', '0110'],
  ];
  const hackSpec = () => ({
    w: 22, h: 20, ox: 11, oy: 20, rim: HACK.rim, dim: HACK.dim, anims: { idle: 4, cast: 2, hurt: 1 },
    draw(g, anim, f) {
      const C = HACK, cast = anim === 'cast';
      // antenna
      Art.line(g, 12, 5, 14, 1, C.dark);
      Art.px(g, 14, 0, (f % 2 || cast) ? C.glyph : C.glyphD);
      // side rotors
      const bw = [4, 2, 1, 2][f % 4];
      Art.rect(g, 3 - bw, 6, bw * 2 + 1, 1, C.rotor); Art.rect(g, 18 - bw, 6, bw * 2 + 1, 1, C.rotor);
      Art.rect(g, 3, 7, 1, 2, C.dark); Art.rect(g, 18, 7, 1, 2, C.dark);
      // body
      Art.rect(g, 4, 5, 14, 11, C.dark);
      Art.rect(g, 5, 4, 12, 1, C.dark); Art.rect(g, 5, 16, 12, 1, C.dark);
      Art.rect(g, 5, 5, 12, 10, C.shell);
      Art.rect(g, 5, 5, 12, 1, C.shellL); Art.rect(g, 5, 5, 1, 4, C.shellL);
      // screen
      Art.rect(g, 7, 7, 9, 6, C.screen);
      const gl = HACK_GLYPHS[cast ? 3 : f % 4];
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (gl[y][x] === '1') Art.px(g, 9 + x + (x > 1 ? 1 : 0), 8 + y, cast ? '#eaffc0' : C.glyph);
      if (f % 2 && !cast) Art.rect(g, 7, 9 + (f % 3), 9, 1, C.glyphD);
      // emitter
      Art.rect(g, 9, 16, 4, 2, C.dark);
      Art.rect(g, 10, 17, 2, 1, cast ? '#eaffc0' : C.glyphD);
      if (anim === 'hurt') Art.rect(g, 7, 10, 9, 1, '#ffffff');
    },
  });
  class HackDrone extends Enemy {
    constructor(x, y, o) {
      super(x, y, o);
      this.setup({ w: 14, h: 14, hp: 26, dmg: 6, speed: 60, sight: 200, cells: [1, 2], gold: [1, 4], flying: true });
      this.rim = HACK.rim; this.eyeCol = HACK.glyph;
      this.homeY = this.cy; this.home = this.cx;
      this.orbs = []; this.side = G.rand.sign();
      this.bloodColors = ['#b6ff3b', '#2f3a52', '#1fd6ff'];
    }
    static makeLook(v, elite) { return new Look(hackSpec(), elite); }
    ai(dt, world) {
      const p = this.target;
      const bob = Math.sin(this.t * 2.2 + this.id) * 5;
      this.orbs = this.orbs.filter((o) => !o.dead);
      switch (this.state) {
        case 'idle':
          this.fly(dt, this.home + Math.sin(this.t * 0.5 + this.id) * 24, this.homeY + bob, 25, 100);
          if (this.aggro) this.setState('chase');
          break;
        case 'chase': {
          if (!this.aggro) { this.setState('idle'); break; }
          if (Math.abs(p.cx - this.cx) < 50) this.side = G.sign(this.cx - p.cx) || this.side;
          this.fly(dt, p.cx + this.side * 95, p.y - 50 + bob, this.speed, 150);
          this.facePlayer();
          if (this.cooldown <= 0 && this.orbs.length < 2 && this.canSee(230) && this.onScreen(-6)) { this.setState('cast'); this.telegraph(0.65); snd('glitch', { vol: 0.4, pitch: 1.5 }); }
          break;
        }
        case 'cast':
          this.vx *= Math.pow(0.05, dt); this.vy *= Math.pow(0.05, dt);
          this.facePlayer();
          if (this.stateT >= 0.65) {
            const x = this.cx, y = this.bottom - 2;
            const a = Math.atan2(p.cy - y, p.cx - x);
            const orb = world.addProjectile(new HomingOrb({
              x, y, vx: Math.cos(a) * 62, vy: Math.sin(a) * 62, r: 3, team: 'enemy', dmg: this.dmg, life: 4.2, homeTime: 3.2, turn: 1.7,
              color: PAL.lime, glow: 0, info: { kb: 60, kbUp: 60, status: { name: 'virus', dur: 4, power: 2 }, color: PAL.lime, source: this },
              onWall(w) { w.fx.burst(this.x, this.y, 8, { speed: 80, life: 0.3, color: [PAL.lime, '#ffffff'], additive: true, grav: 0 }); },
              onExpire(w) { w.fx.burst(this.x, this.y, 8, { speed: 60, life: 0.3, color: [PAL.lime], additive: true, grav: 0 }); },
            }));
            this.orbs.push(orb);
            world.fx.ring(x, y, 2, 12, PAL.lime, 0.25, 1);
            snd('enemyShoot', { pitch: 0.6 });
            this.setState('recoil');
          }
          break;
        case 'recoil':
          this.vy = G.approach(this.vy, -20, 200 * dt);
          if (this.stateT >= 0.5) { this.cooldown = 2.4 + G.rand.float(0, 0.8); this.setState('chase'); }
          break;
      }
      this.avoidWalls(dt);
    }
    frame() {
      if (this.state === 'stunned') return ['hurt', 0];
      if (this.state === 'cast') return ['cast', Math.floor(this.t * 12) % 2];
      return ['idle', Math.floor(this.t * 14) % 4];
    }
    eyePos() { return [this.cx, this.cy]; }
  }
  G.defineEnemy('hackdrone', HackDrone, { displayName: 'Хак-дрон', biomes: ['slums', 'spire'], weight: { slums: 2, spire: 1.2 }, air: true });

  // ---------------------------------------------------------------- «Страж» secbot (armored 3-hit baton combo, shock)
  const SEC = { main: '#3a4684', light: '#b0c0ff', dark: '#1b2148', plate: '#dfe6ff', plateD: '#8c98d0', visor: '#27f3ff', baton: '#27f3ff', batonC: '#e6ffff', emblem: '#ffe14d', leg: '#2a3366', rim: '#9fd0ff', dim: '#2f5aa0' };
  const secbotSpec = () => {
    const C = SEC;
    const B = {
      TH: 6, SH: 6, TO: 9, HN: 4, UA: 5, FA: 5, legW: 4, armW: 3, hipW: 7, shW: 12, shX: 2, col: Object.assign({ leg: C.leg, legD: '#151a3a', foot: C.plateD, footD: '#4a5488', armD: '#232a58' }, C),
      torso(g, J, P, B) {
        Art.torso(g, J, P, B);
        const nx = Math.cos(J.lean), ny = Math.sin(J.lean);
        const a = Art.spine(J, 0.5, 0), b = Art.spine(J, 0.95, 0);
        Art.poly(g, [[a[0] - nx, a[1] - ny], [a[0] + nx * 4, a[1] + ny * 4], [b[0] + nx * 5, b[1] + ny * 5], [b[0] - nx * 2, b[1] - ny * 2]], C.plate);
        Art.line(g, a[0] - nx, a[1] - ny, a[0] + nx * 4, a[1] + ny * 4, C.plateD);
        const e = Art.spine(J, 0.72, 2); Art.px(g, e[0], e[1], C.emblem);
        const s = Art.spine(J, 1, -1); Art.rect(g, s[0] - 3, s[1] - 1, 5, 3, C.plateD); Art.rect(g, s[0] - 3, s[1] - 1, 5, 1, C.plate);
      },
      head(g, J) {
        const [x, y] = J.head;
        Art.rect(g, x - 3, y - 3, 7, 6, C.main);
        Art.rect(g, x - 2, y - 4, 5, 2, C.plate);
        Art.rect(g, x - 1, y - 1, 5, 2, C.visor);
        Art.px(g, x + 3, y - 1, '#ffffff');
        Art.rect(g, x - 3, y + 2, 6, 1, C.dark);
      },
      armF(g, J) {
        Art.limb(g, J.shF[0], J.shF[1], J.elbowF[0], J.elbowF[1], 3, 3, C.main);
        Art.limb(g, J.elbowF[0], J.elbowF[1], J.handF[0], J.handF[1], 3, 2, C.plateD);
        Art.disc(g, J.shF[0], J.shF[1], 2, C.plate);
      },
      handF(g, J, P) {
        const [ex, ey] = J.elbowF, [hx, hy] = J.handF;
        const d = Math.hypot(hx - ex, hy - ey) || 1;
        let ux = (hx - ex) / d, uy = (hy - ey) / d;
        if (P.bRot) { const c = Math.cos(P.bRot), s = Math.sin(P.bRot); [ux, uy] = [ux * c - uy * s, ux * s + uy * c]; }
        Art.line(g, hx - ux * 2, hy - uy * 2, hx + ux * 9, hy + uy * 9, '#0e5e70', 3);
        Art.line(g, hx, hy, hx + ux * 9, hy + uy * 9, C.baton, 2);
        Art.line(g, hx + ux * 2, hy + uy * 2, hx + ux * 8, hy + uy * 8, C.batonC, 1);
        Art.rect(g, hx - 1, hy - 1, 2, 2, C.plateD);
      },
    };
    return rigSpec({
      w: 40, h: 32, ox: 17, B, rim: C.rim, dim: C.dim,
      anims: { idle: 4, walk: 6, w1: 1, h1: 1, w2: 1, h2: 1, w3: 1, h3: 1, hurt: 1 },
      pose(anim, f) {
        if (anim === 'idle') return pz({ lean: 0.08, tb: f === 1 || f === 2 ? 1 : 0, uaF: 0.5, faF: 1.3, uaB: 0.1, faB: 0.4, thF: 0.3, shF: -0.15, thB: -0.3, shB: -0.3 });
        if (anim === 'walk') { const W = walkLegs(f, 6, 0.6, 0.9); return pz(Object.assign(W, { lean: 0.15, uaF: 0.5, faF: 1.3, uaB: 0.3 * W.s, faB: 0.5 + 0.3 * W.s })); }
        if (anim === 'w1') return pz({ lean: -0.05, uaF: -1.4, faF: -2.0, uaB: 0.6, faB: 1.2, thF: 0.5, shF: -0.1, thB: -0.45, shB: -0.6 });
        if (anim === 'h1') return pz({ lean: 0.35, uaF: 1.5, faF: 1.3, uaB: -0.6, faB: -0.2, thF: 0.8, shF: 0.1, thB: -0.6, shB: -0.6 });
        if (anim === 'w2') return pz({ lean: 0.3, uaF: 0.9, faF: -0.4, bRot: 0, uaB: -0.4, faB: 0.1, thF: 0.7, shF: 0.0, thB: -0.5, shB: -0.6 });
        if (anim === 'h2') return pz({ lean: 0.4, uaF: 2.2, faF: 2.7, uaB: -0.8, faB: -0.3, thF: 0.9, shF: 0.1, thB: -0.7, shB: -0.6 });
        if (anim === 'w3') return pz({ lean: -0.25, head: -0.2, uaF: 2.9, faF: -2.9, uaB: 2.6, faB: 3.0, thF: 0.55, shF: -0.1, thB: -0.5, shB: -0.7 });
        if (anim === 'h3') return pz({ lean: 0.55, head: 0.2, uaF: 1.4, faF: 0.8, uaB: 1.1, faB: 0.8, thF: 1.0, shF: 0.2, thB: -0.8, shB: -0.7 });
        return pz({ lean: -0.3, head: -0.4, uaF: -0.2, faF: 0.6, uaB: -1.0, faB: -0.4, thF: 0.3, thB: -0.3 });
      },
    });
  };
  class Secbot extends Enemy {
    constructor(x, y, o) {
      super(x, y, o);
      this.setup({ w: 14, h: 25, hp: 50, dmg: 8, speed: 56, sight: 180, cells: [1, 3], gold: [2, 5], kbRes: 0.5, stunRes: 0.4 });
      this.dmgTakenMul = 0.85; this.haloA = 0.07;
      this.rim = SEC.rim; this.eyeCol = SEC.visor;
      this.bloodColors = ['#9fd0ff', '#3a4684', '#27f3ff'];
      this.walkRate = 0.085;
    }
    static makeLook(v, elite) { return new Look(secbotSpec(), elite); }
    ai(dt, world) {
      const p = this.target;
      const dx = Math.abs(this.dxToPlayer());
      const inRange = dx < 44 * this.S && Math.abs(p.bottom - this.bottom) < 24;
      const hit = (dmg, info) => this.hitOnce(this.swingBox(24 * this.S, this.h + 2, -4), dmg, info);
      if (/^h\d$/.test(this.state)) this.holdGap();
      const swing = (st, lunge, sfx) => { this.setState(st); this.swingHit = false; this.facePlayer(); this.vx = this.facing * lunge; snd(sfx, { pitch: 0.8 }); snd('shock', { vol: 0.3 }); };
      switch (this.state) {
        case 'idle': this.patrol(dt, 22); if (this.aggro) this.setState('chase'); break;
        case 'chase':
          if (!this.aggro) { this.setState('idle'); break; }
          this.chase(dt, this.speed, 20);
          if (dx < 34 * this.S && Math.abs(p.bottom - this.bottom) < 20 && this.cooldown <= 0) { this.facePlayer(); this.setState('w1'); this.telegraph(0.45); }
          break;
        case 'w1': this.vx = G.approach(this.vx, 0, 600 * dt); if (this.stateT >= 0.45) swing('h1', 90, 'slash1'); break;
        case 'h1':
          if (this.stateT < 0.1) hit(this.dmg, { kb: 80 });
          this.vx = G.approach(this.vx, 0, 700 * dt);
          if (this.stateT >= 0.22) { if (!inRange) { this.setState('rec'); break; } this.setState('w2'); this.telegraph(0.2); }
          break;
        case 'w2': this.vx = G.approach(this.vx, 0, 600 * dt); if (this.stateT >= 0.2) swing('h2', 100, 'slash2'); break;
        case 'h2':
          if (this.stateT < 0.1) hit(this.dmg, { kb: 90 });
          this.vx = G.approach(this.vx, 0, 700 * dt);
          if (this.stateT >= 0.22) { if (!inRange) { this.setState('rec'); break; } this.setState('w3'); this.telegraph(0.38); }
          break;
        case 'w3': this.vx = G.approach(this.vx, 0, 600 * dt); if (this.stateT >= 0.38) swing('h3', 130, 'slash3'); break;
        case 'h3':
          if (this.stateT < 0.12 && hit(this.scaled(11), { kb: 190, kbUp: 150, status: { name: 'shock', dur: 3, power: 1 } })) world.fx.burst(p.cx, p.cy, 10, { speed: 120, life: 0.3, color: [PAL.cyan, '#ffffff'], shape: 'spark', grav: 0, additive: true });
          if (this.stateT < 0.03) { const [bx, by] = this.jointAt('h3', 0, 'handF'); world.fx.sparks(bx + this.facing * 8, by + 6, this.facing, 8, PAL.cyan); world.flashLights.push({ x: bx, y: by, r: 40, color: PAL.cyan, t: 0, life: 0.12 }); }
          this.vx = G.approach(this.vx, 0, 700 * dt);
          if (this.stateT >= 0.35) this.setState('rec');
          break;
        case 'rec':
          this.vx = G.approach(this.vx, 0, 600 * dt);
          if (this.stateT >= 0.7) { this.cooldown = 1.2; this.setState('chase'); }
          break;
      }
    }
    frame() {
      const s = this.state;
      if (['w1', 'h1', 'w2', 'h2', 'w3', 'h3'].includes(s)) return [s, 0];
      if (s === 'rec') return ['h3', 0];
      if (s === 'stunned') return ['hurt', 0];
      return Math.abs(this.vx) > 6 ? ['walk', this.walkF(6)] : ['idle', this.idleF(4, 3)];
    }
    drawLight(ctx, cam) {
      super.drawLight(ctx, cam);
      if (this.dying) return;
      const [a, f] = this.frame();
      const [hx, hy] = this.jointAt(a, f, 'handF');
      const active = /^[wh]\d$/.test(this.state);
      G.drawGlow(ctx, hx - cam.ox, hy - cam.oy, active ? 14 : 10, PAL.cyan, active ? 0.35 + 0.15 * (Math.floor(this.t * 20) % 2) : 0.25);
    }
    eyePos() { const [x, y] = this.jointAt(...this.frame(), 'head'); return [x + this.facing * 1, y]; }
  }
  G.defineEnemy('secbot', Secbot, { displayName: 'Страж', biomes: ['spire'], weight: 3 });

  // ---------------------------------------------------------------- «Турель» turret (armored until it opens)
  const TUR = { steel: '#3a3f63', steelL: '#8a92c8', dark: '#1b1d33', core: '#ff3348', coreL: '#ffb8c0', barrel: '#5a5f8a', barrelL: '#aab0d6', stripe: '#ffe14d', ink: '#15131f', rim: '#ff6070', dim: '#7a1a2a' };
  const turretSpec = () => ({
    w: 24, h: 20, ox: 12, oy: 20, rim: TUR.rim, dim: TUR.dim, anims: { closed: 2, open: 3, aim: 7 },
    draw(g, anim, f) {
      const C = TUR, cx = 12;
      const open = anim === 'aim' ? 1 : anim === 'open' ? (f + 1) / 4 : 0;
      const hy = 12 - Math.round(open * 4);
      const ang = anim === 'aim' ? (-f * Math.PI) / 12 : 0;
      // pivot post + armored ball head
      Art.rect(g, cx - 2, hy + 2, 4, 16 - hy, C.dark);
      Art.rect(g, cx - 1, hy + 2, 1, 16 - hy, C.steel);
      Art.disc(g, cx, hy, 6, C.dark);
      Art.disc(g, cx, hy, 5, C.steel);
      Art.rect(g, cx - 3, hy - 5, 5, 1, C.steelL); Art.px(g, cx - 4, hy - 4, C.steelL); Art.px(g, cx - 5, hy - 3, C.steelL);
      Art.rect(g, cx - 7, hy - 2, 2, 5, C.dark); Art.rect(g, cx - 6, hy - 1, 1, 3, C.steelL);
      // shutter / eye socket
      const sh = Math.round(open * 2);
      Art.rect(g, cx - 2, hy - 1 - sh, 6, 1 + sh * 2, '#0a0914');
      if (open > 0) {
        const ux = Math.cos(ang), uy = Math.sin(ang), L = 3 + Math.round(6 * open);
        const bx = cx + 1, by = hy + 1;
        for (const o of [-1.5, 1.5]) Art.line(g, bx - uy * o, by + ux * o, bx + ux * L - uy * o, by + uy * L + ux * o, C.ink, 3);
        for (const o of [-1.5, 1.5]) Art.line(g, bx + ux * 2 - uy * o, by + uy * 2 + ux * o, bx + ux * L - uy * o, by + uy * L + ux * o, C.barrel, 1);
        Art.line(g, bx + ux * 3, by + uy * 3, bx + ux * L, by + uy * L, C.barrelL, 1);
        Art.rect(g, cx, hy - 2, 3, 2, C.core); Art.px(g, cx + 2, hy - 2, C.coreL);
      } else Art.rect(g, cx - 1, hy - 1, 4, 1, f ? '#8a1a2a' : C.core);
      // base
      Art.poly(g, [[1, 20], [23, 20], [20, 14], [4, 14]], C.dark);
      Art.poly(g, [[2, 20], [22, 20], [19, 15], [5, 15]], C.steel);
      Art.rect(g, 5, 15, 14, 1, C.steelL);
      for (let x = 3; x < 21; x++) { Art.px(g, x, 17, ((x >> 1) % 2) ? C.stripe : C.ink); Art.px(g, x, 18, (((x + 1) >> 1) % 2) ? C.stripe : C.ink); }
      Art.px(g, 6, 16, C.steelL); Art.px(g, 17, 16, C.steelL);
      Art.rect(g, cx - 3, 14, 6, 1, C.ink);
    },
  });
  class Turret extends Enemy {
    constructor(x, y, o) {
      super(x, y, o);
      this.setup({ w: 20, h: 14, hp: 40, dmg: 5, speed: 0, sight: 230, cells: [1, 3], gold: [2, 5], kbRes: 1, stunRes: 0.85, poise: 1 });
      this.immobile = true; this.loseSight = 300;
      this.rim = TUR.rim; this.eyeCol = TUR.core;
      this.bloodColors = ['#ff6070', '#3a3f63', '#ffe14d'];
      this.aimA = 0; this.shots = 0; this.shotT = 0; this.muzT = 0;
      this.state = 'closed';
    }
    static makeLook(v, elite) { return new Look(turretSpec(), elite); }
    get armored() { return ['closed', 'opening', 'closing', 'idle', 'chase'].includes(this.state); }
    filterHit(amount, info) {
      if (this.armored) {
        const w = G.world;
        w.fx.sparks(this.cx, this.y + 4, -(info.dir || 1), 7, PAL.yellow);
        snd('hitArmor', { vol: 0.6 });
        return { amount: amount * 0.15, info: Object.assign({}, info, { stun: 0, kb: 0, kbUp: 0, color: '#8a92c8' }) };
      }
      return { amount, info: Object.assign({}, info, { kb: 0, kbUp: 0 }) };
    }
    onInterrupt() { this.setState('linger'); }
    trackAim() {
      const p = this.target;
      this.facePlayer();
      const px = this.cx, py = this.bottom - 11 * this.S;
      const a = Math.atan2(p.cy - py, Math.max(1, Math.abs(p.cx - px)));
      return G.clamp(a, -Math.PI / 2, 0.15);
    }
    ai(dt, world) {
      this.vx = 0;
      if (this.muzT > 0) this.muzT -= dt;
      switch (this.state) {
        case 'idle': case 'chase': this.setState('closed'); break;
        case 'closed':
          if (this.aggro && this.cooldown <= 0 && this.canSee(this.sight) && this.onScreen(-4)) { this.setState('opening'); this.telegraph(0.8); this.aimA = this.trackAim(); snd('dash', { pitch: 0.5, vol: 0.4 }); }
          break;
        case 'opening':
          this.aimA = G.lerp(this.aimA, this.trackAim(), Math.min(1, dt * 6));
          if (this.stateT >= 0.8) { this.setState('burst'); this.shots = 0; this.shotT = 0; }
          break;
        case 'burst':
          this.shotT -= dt;
          if (this.shotT <= 0) {
            if (this.shots >= 4) { this.setState('linger'); break; }
            this.shots++; this.shotT = 0.13;
            const wa = this.facing > 0 ? this.aimA : Math.PI - this.aimA;
            const px = this.cx + Math.cos(wa) * 10 * this.S, py = this.bottom - 11 * this.S + Math.sin(wa) * 10 * this.S;
            fireBolt(world, this, px, py, wa + G.rand.float(-0.04, 0.04), { speed: 280, r: 1, len: 5, color: PAL.orange, core: '#fff0c0', glow: 10, dmg: this.dmg, info: { kb: 60, kbUp: 40, source: this } });
            this.muzT = 0.06;
            world.flashLights.push({ x: px, y: py, r: 24, color: PAL.orange, t: 0, life: 0.06 });
            snd('enemyShoot', { pitch: 1.4, vol: 0.6 });
          }
          break;
        case 'linger':
          if (this.stateT >= 1.2) { this.setState('closing'); }
          break;
        case 'closing':
          if (this.stateT >= 0.3) { this.setState('closed'); this.cooldown = 1.4; }
          break;
      }
    }
    frame() {
      switch (this.state) {
        case 'opening': return this.stateT < 0.45 ? ['open', Math.min(2, Math.floor(this.stateT / 0.15))] : ['aim', this.aimFrame()];
        case 'burst': case 'linger': case 'stunned': return ['aim', this.aimFrame()];
        case 'closing': return ['open', 2 - Math.min(2, Math.floor(this.stateT / 0.1))];
      }
      return ['closed', Math.floor(this.t * 2) % 2];
    }
    aimFrame() { return G.clamp(Math.round(-this.aimA / (Math.PI / 12)), 0, 6); }
    drawBody(ctx, cam) {
      const [a, f] = this.frame();
      this.drawSpr(ctx, cam, a, f);
      if (this.muzT > 0) {
        const wa = this.facing > 0 ? this.aimA : Math.PI - this.aimA;
        const x = this.cx + Math.cos(wa) * 11 * this.S - cam.ox, y = this.bottom - 11 * this.S + Math.sin(wa) * 11 * this.S - cam.oy;
        G.px.disc(ctx, x, y, 2, '#fff0c0');
      }
    }
    eyePos() { return this.armored ? null : [this.cx + this.facing * 1, this.bottom - 13 * this.S]; }
    drawLight(ctx, cam) {
      super.drawLight(ctx, cam);
      if (this.dying) return;
      if (this.state === 'opening' && this.stateT > 0.3) {
        const wa = this.facing > 0 ? this.aimA : Math.PI - this.aimA;
        const x0 = this.cx + Math.cos(wa) * 10 * this.S, y0 = this.bottom - 11 * this.S + Math.sin(wa) * 10 * this.S;
        const h = G.world.level.raycast(x0, y0, x0 + Math.cos(wa) * 260, y0 + Math.sin(wa) * 260);
        Art.sight(ctx, x0 - cam.ox, y0 - cam.oy, h.x - cam.ox, h.y - cam.oy, PAL.orange, 0.6, 3, this.t);
      }
    }
  }
  G.defineEnemy('turret', Turret, { displayName: 'Турель', biomes: ['spire'], weight: 1.5 });

  // ---------------------------------------------------------------- «Фантом» phantom (teleporting assassin)
  const PHA = { main: '#3a1a6e', light: '#b98aff', dark: '#1a0a36', cloak: '#26104c', cloakL: '#7a4ae0', mask: '#efe6ff', maskD: '#a89ad0', slit: '#ff3dd0', blade: '#ff7ad8', bladeC: '#fff0fa', leg: '#2a1454', rim: '#c68aff', dim: '#5a2a9a' };
  const phantomSpec = () => {
    const C = PHA;
    const B = {
      TH: 6, SH: 6, TO: 8, HN: 3, UA: 5, FA: 5, legW: 2, armW: 2, hipW: 5, shW: 7, shX: 1, col: Object.assign({ leg: C.leg, legD: '#140828', foot: '#140828', footD: '#0c0418' }, C),
      behind(g, J, P) {
        const n = J.neck, h = J.hip, fl = P.flap || 0;
        const pts = [[n[0] - 2, n[1]], [n[0] + 1, n[1] + 1], [h[0] - 1, h[1] + 3], [h[0] - 4 - fl, h[1] + 10], [h[0] - 7 - fl, h[1] + 8], [h[0] - 9 - fl, h[1] + 10], [h[0] - 8 - fl * 1.3, h[1] + 3]];
        Art.poly(g, pts, C.cloak);
        Art.px(g, h[0] - 7 - fl, h[1] + 8, C.cloakL); Art.px(g, h[0] - 4 - fl, h[1] + 9, C.cloakL);
      },
      head(g, J) {
        const [x, y] = J.head;
        Art.disc(g, x - 1, y, 4, C.cloak);
        Art.ellipse(g, x + 1, y + 0.5, 2, 3, C.mask);
        Art.px(g, x, y + 3, C.maskD);
        Art.rect(g, x + 1, y - 1, 3, 1, C.slit);
        Art.px(g, x - 2, y - 4, C.cloakL);
      },
      handF(g, J, P) {
        const [ex, ey] = J.elbowF, [hx, hy] = J.handF;
        const d = Math.hypot(hx - ex, hy - ey) || 1, ux = (hx - ex) / d, uy = (hy - ey) / d;
        const L = P.bl || 11;
        Art.line(g, hx, hy, hx + ux * L, hy + uy * L, C.blade, 2);
        Art.line(g, hx + ux, hy + uy, hx + ux * (L - 1), hy + uy * (L - 1), C.bladeC, 1);
      },
    };
    return rigSpec({
      w: 40, h: 32, ox: 17, B, rim: C.rim, dim: C.dim,
      anims: { idle: 4, walk: 6, wind: 1, slash: 2, rec: 1, hurt: 1 },
      pose(anim, f) {
        if (anim === 'idle') return pz({ lean: 0.2, tb: f === 1 || f === 2 ? 1 : 0, uaF: 0.6, faF: 0.9, bl: 9, uaB: -0.3, faB: -0.1, thF: 0.25, shF: -0.3, thB: -0.2, shB: -0.4, flap: f % 2 });
        if (anim === 'walk') { const W = walkLegs(f, 6, 0.55, 0.8); return pz(Object.assign(W, { lean: 0.35, uaF: 0.7, faF: 1.0, bl: 9, uaB: -0.5, faB: -0.3, flap: 1 + (f % 3) })); }
        if (anim === 'wind') return pz({ lean: -0.15, head: 0.25, uaF: -2.0, faF: -2.6, bl: 12, uaB: 1.2, faB: 1.7, thF: 0.9, shF: -0.1, thB: -0.6, shB: -1.1, flap: 2 });
        if (anim === 'slash') return f === 0
          ? pz({ lean: 0.65, uaF: 1.7, faF: 1.55, bl: 13, uaB: -1.2, faB: -0.8, thF: 1.1, shF: 0.3, thB: -0.9, shB: -0.4, flap: 4 })
          : pz({ lean: 0.55, uaF: 1.2, faF: 0.5, bl: 12, uaB: -1.0, faB: -0.6, thF: 1.0, shF: 0.2, thB: -0.8, shB: -0.5, flap: 3 });
        if (anim === 'rec') return pz({ lean: 0.5, head: 0.3, uaF: 0.5, faF: 0.2, bl: 9, uaB: -0.2, faB: 0, thF: 0.6, shF: -0.3, thB: -0.4, shB: -0.6, flap: 1 });
        return pz({ lean: -0.35, head: -0.4, uaF: -0.2, faF: 0.5, bl: 9, uaB: -1.0, faB: -0.4, thF: 0.3, thB: -0.3, flap: 2 });
      },
    });
  };
  class Phantom extends Enemy {
    constructor(x, y, o) {
      super(x, y, o);
      this.setup({ w: 11, h: 22, hp: 34, dmg: 11, speed: 48, sight: 190, cells: [1, 3], gold: [2, 5] });
      this.rim = PHA.rim; this.eyeCol = PHA.slit;
      this.bloodColors = ['#c68aff', '#3a1a6e', '#ff3dd0'];
      this.tpCd = G.rand.float(0.8, 1.6); this.dest = null;
    }
    static makeLook(v, elite) { return new Look(phantomSpec(), elite); }
    onInterrupt() { this.untargetable = false; this.dest = null; }
    // feet position behind the player (or in front if blocked), or null
    findSpot() {
      const p = this.target, L = G.world.level;
      for (const side of [-p.facing, p.facing]) {
        for (const d of [30, 24, 38]) {
          const x = p.cx + side * d, y = p.bottom;
          if (!L.floorAt(x, y + 2)) continue;
          let ok = true;
          for (const dx of [-5, 5]) for (const dy of [4, 12, 20]) if (L.solidAt(x + dx, y - dy)) ok = false;
          if (ok && L.lineClear(p.cx, p.cy, x, y - 10)) return [x, y];
        }
      }
      return null;
    }
    ai(dt, world) {
      const p = this.target;
      const dx = Math.abs(this.dxToPlayer());
      if (this.tpCd > 0) this.tpCd -= dt;
      switch (this.state) {
        case 'idle': this.patrol(dt, 20); if (this.aggro) this.setState('chase'); break;
        case 'chase':
          if (!this.aggro) { this.setState('idle'); break; }
          this.chase(dt, this.speed, 18);
          if (this.cooldown <= 0 && dx < 30 * this.S && Math.abs(p.bottom - this.bottom) < 20) { this.facePlayer(); this.setState('wind'); this.telegraph(0.5); }
          else if (this.tpCd <= 0 && (dx > 34 || this.wantTp) && this.distToPlayer() < 200 && this.onScreen(-10) && p.onGround) {
            const s = this.findSpot();
            if (s) { this.dest = s; this.wantTp = false; this.setState('vanish'); snd('glitch', { vol: 0.6 }); }
            else this.tpCd = 0.8;
          }
          break;
        case 'vanish':
          this.vx = 0;
          if (this.stateT > 0.12) this.untargetable = true;
          if (this.stateT >= 0.35) this.setState('hidden');
          break;
        case 'hidden':
          this.untargetable = true;
          if (this.stateT >= 0.42) {
            const s = this.dest || [this.cx, this.bottom];
            this.x = s[0] - this.w / 2; this.y = s[1] - this.h; this.vx = this.vy = 0;
            this.facePlayer(); this.untargetable = false;
            world.fx.burst(this.cx, this.cy, 14, { speed: 90, life: 0.35, color: [PHA.rim, PHA.slit, '#ffffff'], grav: 0, additive: true });
            snd('teleport');
            this.setState('wind'); this.telegraph(0.55);
          }
          break;
        case 'wind':
          this.vx = G.approach(this.vx, 0, 700 * dt);
          if (this.stateT >= this.teleMax) { this.setState('slash'); this.swingHit = false; this.vx = this.facing * 170; snd('slash3', { pitch: 1.3 }); }
          break;
        case 'slash':
          if (this.stateT < 0.13) this.hitOnce(this.swingBox(24 * this.S, this.h, 0), this.dmg, { kb: 170, kbUp: 100 });
          this.vx = G.approach(this.vx, 0, 900 * dt); this.holdGap();
          if (this.stateT >= 0.25) this.setState('rec');
          break;
        case 'rec':
          this.vx = G.approach(this.vx, 0, 700 * dt);
          if (this.stateT >= 0.8) {
            this.cooldown = 0.9; this.wantTp = G.rand.chance(0.5);
            this.tpCd = this.wantTp ? 0.25 : G.rand.float(1.8, 2.8); this.setState('chase');
          }
          break;
      }
    }
    frame() {
      switch (this.state) {
        case 'wind': return ['wind', 0];
        case 'slash': return ['slash', this.stateT < 0.1 ? 0 : 1];
        case 'rec': return ['rec', 0];
        case 'vanish': case 'hidden': return ['idle', 0];
        case 'stunned': return ['hurt', 0];
      }
      return Math.abs(this.vx) > 6 ? ['walk', this.walkF(6)] : ['idle', this.idleF(4, 3)];
    }
    drawBody(ctx, cam) {
      const [a, f] = this.frame();
      if (this.state === 'hidden') return;
      if (this.state === 'vanish') { const k = this.stateT / 0.35; this.drawSpr(ctx, cam, a, f, { glitch: 0.4 + k, skip: k * 0.9 }); return; }
      if (this.state === 'wind' && this.stateT < 0.2) { this.drawSpr(ctx, cam, a, f, { glitch: 1 - this.stateT / 0.2, skip: 0.5 * (1 - this.stateT / 0.2) }); return; }
      // idle shimmer
      if (G.rand.chance(0.04)) this.drawSpr(ctx, cam, a, f, { glitch: 0.5 });
      else this.drawSpr(ctx, cam, a, f);
      if (this.state === 'slash' && this.stateT < 0.12) {
        const cx = this.cx + this.facing * 6 - cam.ox, cy = this.y + 10 - cam.oy;
        ctx.fillStyle = PHA.blade;
        for (let i = 0; i < 12; i++) { const an = -1.1 + i * 0.2; ctx.fillRect(Math.round(cx + Math.cos(an) * 16 * this.facing), Math.round(cy + Math.sin(an) * 14), 2, 1); }
      }
    }
    drawLight(ctx, cam) {
      if (this.state === 'hidden' && this.dest) {
        // destination marker: glitch sigil where the phantom will appear
        const k = this.stateT / 0.42, x = this.dest[0] - cam.ox, y = this.dest[1] - 11 - cam.oy;
        G.drawGlow(ctx, x, y, 26, PHA.slit, 0.35 + 0.5 * k);
        ctx.fillStyle = PHA.rim;
        for (let i = 0; i < 6; i++) ctx.fillRect(Math.round(x + G.rand.int(-5, 5)), Math.round(y + G.rand.int(-10, 10)), G.rand.int(1, 4), 1);
        return;
      }
      if (this.state === 'vanish' && this.stateT > 0.2) return;
      super.drawLight(ctx, cam);
    }
    eyePos() { if (this.state === 'hidden') return null; const [x, y] = this.jointAt(...this.frame(), 'head'); return [x + this.facing * 2, y - 1]; }
  }
  G.defineEnemy('phantom', Phantom, { displayName: 'Фантом', biomes: ['spire'], weight: 2.2 });

  // ---------------------------------------------------------------- «Часовой» sentinel drone (laser sweep, air)
  const SEN = { shell: '#343a62', shellL: '#9aa4e0', dark: '#161a30', lens: '#0a0f1e', iris: '#27f3ff', irisR: '#ff3348', core: '#e6ffff', coreR: '#ffe0e4', flame: '#ff8a2a', flameL: '#ffe14d', rim: '#7fe9ff', dim: '#1f6a8a' };
  const sentinelSpec = () => ({
    w: 26, h: 24, ox: 13, oy: 24, rim: SEN.rim, dim: SEN.dim, anims: { idle: 4, charge: 2, fire: 2, hurt: 1 },
    draw(g, anim, f) {
      const C = SEN, cx = 13, cy = 11, red = anim === 'charge' || anim === 'fire';
      // thrusters + flames
      for (const s of [-1, 1]) {
        Art.rect(g, cx + s * 9 - 1, cy + 3, 3, 4, C.dark);
        Art.rect(g, cx + s * 9 - 1, cy + 3, 3, 1, C.shellL);
        const fl = [3, 5, 4, 6][(f + (s > 0 ? 1 : 0)) % 4];
        Art.rect(g, cx + s * 9, cy + 7, 1, fl, C.flame);
        Art.px(g, cx + s * 9, cy + 7, C.flameL);
      }
      // fins
      Art.poly(g, [[cx - 4, cy - 8], [cx - 1, cy - 11], [cx + 1, cy - 11], [cx + 4, cy - 8]], C.dark);
      Art.rect(g, cx - 1, cy - 11, 2, 1, C.shellL);
      // octagon shell
      const R = 8, pts = [];
      for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + Math.PI / 8; pts.push([cx + Math.cos(a) * R, cy + Math.sin(a) * R]); }
      Art.poly(g, pts, C.shell);
      Art.line(g, pts[5][0], pts[5][1] + 1, pts[6][0], pts[6][1] + 1, C.shellL);
      Art.line(g, pts[4][0] + 1, pts[4][1], pts[5][0], pts[5][1] + 1, C.shellL);
      Art.line(g, pts[1][0], pts[1][1] - 1, pts[2][0], pts[2][1] - 1, C.dark);
      // lens
      Art.disc(g, cx, cy, 5, C.dark);
      Art.disc(g, cx, cy, 4, C.lens);
      G.px.ring(g, cx, cy, 3, red ? C.irisR : C.iris, 1);
      if (anim === 'fire') Art.disc(g, cx, cy, 2, f ? C.coreR : '#ffffff');
      if (anim === 'hurt') Art.rect(g, cx - 4, cy, 9, 1, '#ffffff');
    },
  });
  class Sentinel extends Enemy {
    constructor(x, y, o) {
      super(x, y, o);
      this.setup({ w: 16, h: 16, hp: 30, dmg: 10, speed: 58, sight: 220, cells: [1, 3], gold: [2, 5], flying: true, kbRes: 0.3 });
      this.rim = SEN.rim; this.eyeCol = SEN.iris;
      this.homeY = this.cy; this.home = this.cx;
      this.a0 = 0; this.a1 = 0; this.ang = 0; this.side = G.rand.sign();
      this.bloodColors = ['#7fe9ff', '#343a62', '#ff8a2a'];
    }
    static makeLook(v, elite) { return new Look(sentinelSpec(), elite); }
    eye() { return [this.cx, this.bottom - 13 * this.S]; }
    beamEnd(a) { const [x, y] = this.eye(); const h = G.world.level.raycast(x, y, x + Math.cos(a) * 300, y + Math.sin(a) * 300); return [h.x, h.y]; }
    ai(dt, world) {
      const p = this.target;
      const bob = Math.sin(this.t * 2 + this.id) * 4;
      switch (this.state) {
        case 'idle':
          this.fly(dt, this.home + Math.sin(this.t * 0.4 + this.id) * 30, this.homeY + bob, 25, 100);
          if (this.aggro) this.setState('chase');
          break;
        case 'chase': {
          if (!this.aggro) { this.setState('idle'); break; }
          if (Math.abs(p.cx - this.cx) < 40) this.side = G.sign(this.cx - p.cx) || this.side;
          this.fly(dt, p.cx + this.side * 90, p.y - 55 + bob, this.speed, 160);
          this.facePlayer();
          if (this.cooldown <= 0 && this.canSee(220) && this.onScreen(-8)) {
            const [ex, ey] = this.eye();
            const ap = Math.atan2(p.cy - ey, p.cx - ex);
            // sweep from beyond the player toward the sentinel's own side (you roll through it)
            const dir = p.cx > this.cx ? 1 : -1;
            this.a0 = ap - dir * 0.75; this.a1 = ap + dir * 0.75; this.ang = this.a0;
            this.setState('charge'); this.telegraph(0.85); snd('charge', { vol: 0.5, pitch: 1.2 });
          }
          break;
        }
        case 'charge':
          this.vx *= Math.pow(0.03, dt); this.vy *= Math.pow(0.03, dt);
          if (G.rand.chance(dt * 30)) { const [ex, ey] = this.eye(); const a = G.rand.float(0, TAU); world.fx.particle({ x: ex + Math.cos(a) * 14, y: ey + Math.sin(a) * 14, vx: -Math.cos(a) * 50, vy: -Math.sin(a) * 50, life: 0.28, color: PAL.red, additive: true }); }
          if (this.stateT >= 0.85) { this.setState('sweep'); this.swingHit = false; snd('enemyLaser', { vol: 0.8 }); }
          break;
        case 'sweep': {
          this.vx *= Math.pow(0.03, dt); this.vy *= Math.pow(0.03, dt);
          const k = Math.min(1, this.stateT / 0.95);
          this.ang = G.lerp(this.a0, this.a1, G.easeInOut(k));
          const [ex, ey] = this.eye(), [bx, by] = this.beamEnd(this.ang);
          if (!this.swingHit && this.beamHit(ex, ey, bx, by, 1, this.dmg, { kb: 150, kbUp: 120, dir: G.sign(bx - ex) || 1 })) this.swingHit = true;
          if (G.rand.chance(dt * 40)) world.fx.sparks(bx, by, -G.sign(bx - ex) || 1, 2, PAL.red);
          if (k >= 1) { this.setState('cool'); }
          break;
        }
        case 'cool':
          if (this.stateT >= 0.6) { this.cooldown = 2.2 + G.rand.float(0, 0.8); this.setState('chase'); }
          break;
      }
      this.avoidWalls(dt);
    }
    frame() {
      if (this.state === 'stunned') return ['hurt', 0];
      if (this.state === 'charge') return ['charge', Math.floor(this.t * 10) % 2];
      if (this.state === 'sweep') return ['fire', Math.floor(this.t * 20) % 2];
      return ['idle', Math.floor(this.t * 12) % 4];
    }
    drawBody(ctx, cam) {
      const [a, f] = this.frame();
      this.drawSpr(ctx, cam, a, f);
      // pupil looks toward the player / beam
      const p = this.target;
      const [ex, ey] = this.eye();
      const la = this.state === 'sweep' || this.state === 'charge' ? this.ang : (p ? Math.atan2(p.cy - ey, p.cx - ex) : 0);
      const x = Math.round(ex - cam.ox + Math.cos(la) * 2), y = Math.round(ey - cam.oy + Math.sin(la) * 2);
      G.px.rect(ctx, x - 1, y - 1, 2, 2, this.flash > 0 ? '#ffffff' : (this.state === 'idle' || this.state === 'chase' || this.state === 'cool') ? '#ffffff' : '#ffe0e4');
    }
    eyePos() { return this.eye(); }
    drawLight(ctx, cam) {
      this.eyeCol = this.state === 'charge' || this.state === 'sweep' ? PAL.red : SEN.iris;
      super.drawLight(ctx, cam);
      if (this.dying) return;
      const [ex, ey] = this.eye();
      if (this.state === 'charge') {
        const [bx, by] = this.beamEnd(this.a0);
        Art.sight(ctx, ex - cam.ox, ey - cam.oy, bx - cam.ox, by - cam.oy, PAL.red, 0.4 + 0.5 * (this.stateT / 0.85), 2, this.t);
        G.drawGlow(ctx, ex - cam.ox, ey - cam.oy, 20 + this.stateT * 20, PAL.red, 0.6);
      }
      if (this.state === 'sweep') {
        const [bx, by] = this.beamEnd(this.ang);
        Art.beam(ctx, ex - cam.ox, ey - cam.oy, bx - cam.ox, by - cam.oy, PAL.red, '#ffffff', 3, 1);
        G.drawGlow(ctx, bx - cam.ox, by - cam.oy, 20, PAL.orange, 0.9);
      }
    }
  }
  G.defineEnemy('sentinel', Sentinel, { displayName: 'Часовой', biomes: ['spire'], weight: 1.6, air: true });

  // ---------------------------------------------------------------- legacy sample grunt (not spawned by levels)
  class Grunt extends Enemy {
    constructor(x, y, o) {
      super(x, y, o);
      this.setup({ w: 12, h: 21, hp: 42, dmg: 12, speed: 58, cells: [0, 1], gold: [1, 3] });
    }
    static makeLook(v, elite) { return new Look(huskSpec(0), elite); }
    ai(dt, world) {
      const p = this.target;
      switch (this.state) {
        case 'idle': this.patrol(dt); if (this.aggro) this.setState('chase'); break;
        case 'chase': {
          if (!this.aggro) { this.setState('idle'); break; }
          this.chase(dt, this.speed, 16);
          const dx = Math.abs(this.dxToPlayer()), dy = Math.abs(p.cy - this.cy);
          if (dx < 26 && dy < 24 && this.cooldown <= 0) { this.setState('wind'); this.telegraph(0.45); this.facePlayer(); }
          break;
        }
        case 'wind':
          this.vx = G.approach(this.vx, 0, 600 * dt);
          if (this.stateT >= 0.45) { this.setState('strike'); this.swingHit = false; this.vx = this.facing * 120; snd('slash1', { pitch: 0.7, vol: 0.6 }); }
          break;
        case 'strike':
          if (this.stateT < 0.12) this.hitOnce(this.swingBox(20, 16, 3)); this.holdGap();
          this.vx = G.approach(this.vx, 0, 700 * dt);
          if (this.stateT >= 0.45) { this.cooldown = 0.8; this.setState('chase'); }
          break;
      }
    }
    frame() {
      if (this.state === 'wind') return ['wind', 1];
      if (this.state === 'strike') return ['atk', 0];
      if (this.state === 'stunned') return ['hurt', 0];
      return Math.abs(this.vx) > 6 ? ['walk', this.walkF(6)] : ['idle', this.idleF(4, 3)];
    }
  }
  G.defineEnemy('grunt', Grunt, { displayName: 'Болванка', noSpawn: true });
})();
