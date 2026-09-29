'use strict';
// DEAD CIRCUITS — item system & arsenal (owned by the LOOT agent).
// * registry / instances / damage + crit pipeline (G.itemDamage, G.weaponHit, G.rollCrit)
// * player Actions: melee combos, charged heavies, whips, ranged (charge / auto / queue), channelled
//   flamethrower, shields with block + parry, skills, dashes
// * rotated + outlined pixel-art held sprites (cached), 24 px icons (auto-outlined)
// * combat effects (beams, bolts, ground waves, muzzle flashes), player allies (turret, drone, decoy),
//   ground zones (fire, traps) and the full roster.
(function () {
  const G = window.G;
  const PAL = G.PAL;
  const TAU = Math.PI * 2;
  const snd = (name, o) => { if (G.audio) G.audio.play(name, o); };
  const inputX = () => (G.input.down('right') ? 1 : 0) - (G.input.down('left') ? 1 : 0);
  const ACTION_BY_KIND = {};

  // ================================================================ stats / colours
  const STATS = ['brutality', 'tactics', 'survival'];
  // dual-stat items store stat as an array; make G.STAT_COLOR[array] resolve to the first stat colour
  for (const a of STATS) for (const b of STATS) if (a !== b) G.STAT_COLOR[a + ',' + b] = G.STAT_COLOR[a];
  G.statColors = (stat) => (Array.isArray(stat) ? stat : [stat]).map((s) => G.STAT_COLOR[s] || PAL.cyan);
  G.statColor = (stat) => G.statColors(stat)[0];
  G.STAT_NAMES = { brutality: 'Жестокость', tactics: 'Тактика', survival: 'Живучесть' };
  G.KIND_NAMES = { melee: 'Ближний бой', ranged: 'Дальний бой', shield: 'Щит', skill: 'Навык' };
  G.QUALITY_NAMES = { normal: 'Обычное', rare: 'Редкое', legendary: 'Легендарное' };
  G.QUALITY_COLORS = { normal: '#aab0d6', rare: '#27f3ff', legendary: '#ffc23d' };

  // ================================================================ registry & instances
  G.ITEMS = {};
  // def: {id, name(RU), desc(RU), kind:'melee'|'ranged'|'shield'|'skill', stat (string or array),
  //       drop (weight, 0 = never), blueprint, unlockCost, cooldown (s), use(p, inst, world, button) -> Action,
  //       drawHeld(ctx, x, y, ang, p, inst, scale), drawIcon(ctx, size), ...}
  G.defineItem = function (def) {
    def.drop = def.drop == null ? 1 : def.drop;
    if (!def.use) def.use = (p, inst, world, button) => new (def.action || ACTION_BY_KIND[def.kind] || Action)(p, inst, button);
    G.ITEMS[def.id] = def;
    return def;
  };
  G.itemsOfKind = (kind) => Object.values(G.ITEMS).filter((d) => !kind || d.kind === kind);

  // tier: 0.. (shown as "+N"); opts.quality forces 'normal'|'rare'|'legendary' (otherwise rolled from tier)
  G.makeItem = function (id, tier = 0, rng = G.rand, opts = {}) {
    const def = G.ITEMS[id];
    if (!def) throw new Error('Unknown item ' + id);
    const inst = { id, def, tier, cd: 0, cdMax: 0, affixes: [], quality: opts.quality || 'normal', uid: Math.floor(rng.next() * 1e9) };
    if (G.rollAffixes) G.rollAffixes(inst, rng, opts);
    return inst;
  };
  G.itemName = (inst) => inst.def.name + (inst.tier > 0 ? ' +' + inst.tier : '');

  // Damage scaling: base * tier * stat scrolls * item / player / affix / mutation / buff multipliers
  G.itemDamage = function (p, inst, base, target) {
    let d = base * (1 + 0.22 * (inst.tier || 0)) * (p ? p.statMul(inst.def.stat) : 1);
    if (inst.dmgMul) d *= inst.dmgMul;
    if (p) {
      if (p.dmgMul) d *= p.dmgMul;
      if (p.overloadUntil && G.game && G.game.runTime < p.overloadUntil) d *= 1.5; // «Перегрузка»
      for (const m of p.mutations || []) if (m.dmgMod) d *= m.dmgMod(p, inst, target) || 1;
    }
    for (const a of inst.affixes) if (a.dmgMod) d *= a.dmgMod(p, inst, target) || 1;
    return Math.max(1, Math.round(d));
  };

  // crit = weapon condition OR random crit chance (affixes / mutations: p.critChance, inst.critChance)
  G.rollCrit = function (p, inst, target, cond) {
    if (cond) return true;
    let ch = (p && p.critChance) || 0;
    if (inst) {
      if (inst.critChance) ch += inst.critChance;
      for (const a of inst.affixes) if (a.critChance) ch += a.critChance;
    }
    return ch > 0 && G.rand.chance(ch);
  };

  // Called by weapons when they damage something (affixes, mutations & recovery hook here)
  G.onItemHit = function (p, inst, target, dealt, world) {
    for (const a of inst.affixes) if (a.onHit) a.onHit(p, inst, target, dealt, world);
    if (p) p.onDealDamage(dealt, target, inst);
  };

  // Deal item damage to ONE target with a per-target crit. Returns damage dealt.
  // o: {crit, critMul, dir, kb, kbUp, stun, status:{name,dur,power}, color, kind, silent, noLabel}
  G.weaponHit = function (world, p, inst, t, base, o = {}) {
    if (!t || t.dead || t.dying) return 0;
    const crit = G.rollCrit(p, inst, t, o.crit);
    const mul = crit ? (o.critMul || inst.def.critMul || 1.75) : 1;
    const dmg = G.itemDamage(p, inst, base * mul, t);
    const info = {
      dir: o.dir != null ? o.dir : (G.sign(t.cx - (p ? p.cx : t.cx)) || 1),
      kb: o.kb == null ? 80 : o.kb, kbUp: o.kbUp || 0, stun: o.stun == null ? 0.1 : o.stun,
      crit, color: o.color, source: p, silent: o.silent,
    };
    if (o.status) info.status = o.status;
    const dealt = t.takeDamage(dmg, info);
    t.lastDealt = dealt;
    if (dealt) {
      G.emit('enemyHit', { enemy: t, dmg: dealt, source: o.kind || inst.def.kind, crit });
      G.onItemHit(p, inst, t, dealt, world);
      if (crit && !o.noLabel) world.fx.label(t.cx, t.y - 16, 'CRIT', PAL.yellow, 0.45);
    }
    return dealt;
  };

  // cooldown helpers (inst.cdMax lets the HUD draw an exact bar)
  G.cdMulOf = (p, inst) => {
    let m = (p && p.cdMul) || 1;
    for (const a of inst.affixes) if (a.cdMul) m *= a.cdMul;
    return m;
  };
  G.startCooldown = function (p, inst, base) {
    base = base == null ? inst.def.cooldown || 0 : base;
    inst.cdMax = base * G.cdMulOf(p, inst);
    inst.cd = inst.cdMax;
  };

  // status helpers (power of damaging statuses scales like item damage)
  G.ST = {
    burn: (p, inst, dur = 3, base = 2) => ({ name: 'burn', dur, power: p && inst ? G.itemDamage(p, inst, base) : base }),
    virus: (p, inst, dur = 6, base = 3) => ({ name: 'virus', dur, power: p && inst ? G.itemDamage(p, inst, base) : base }),
    shock: (dur = 3) => ({ name: 'shock', dur, power: 1 }),
    cryo: (dur = 2) => ({ name: 'cryo', dur, power: 1 }),
  };
  const isStunned = (t) => t.stun > 0.25;
  const isFrozen = (t) => !!(t._frozenUntil && G.world && t._frozenUntil > G.world.time && t.stun > 0);
  G.isStunned = isStunned; G.isFrozen = isFrozen;
  // freeze = long stun + cryo + an ice shell drawn around the target
  G.freeze = function (world, t, dur) {
    if (!t || t.dead || t.dying) return;
    const d = dur * (1 - (t.stunRes || 0) * 0.6);
    t.stun = Math.max(t.stun, d);
    t.applyStatus('cryo', d + 1.5, 1);
    t._frozenUntil = world.time + d;
    world.projectiles.push(new IceShell(t, d));
    world.fx.burst(t.cx, t.cy, 14, { speed: 90, life: 0.5, color: ['#9fe8ff', '#ffffff', '#3f8fc8'], grav: 200, shape: 'px' });
    snd('freeze');
  };

  // ================================================================ held sprites (rotated pixel art)
  // Sprites point RIGHT (+x = weapon direction); pivot = the pixel held by the hand.
  // Rotation is nearest-neighbour per destination pixel (connected lines), cached per 64 angles and
  // mirrored for left-facing, with an automatic 1 px dark outline.
  const SPAL = {
    k: '#07050d', d: '#1b1a2e', m: '#2b2a45', n: '#45466a', l: '#6f7299', w: '#aab0d6', W: '#f4f1ff',
    b: '#9fb3c8', B: '#d4e2f0', u: '#8a4a2a', U: '#5a2e1a', h: '#3a2352', H: '#241634',
    c: '#27f3ff', C: '#0e8fa6', e: '#9ffcff', p: '#ff2a8a', P: '#ff5cc8', q: '#b3125f', v: '#9b5cff', V: '#5a2fa0',
    y: '#ffe14d', o: '#ff8a2a', O: '#b34a12', r: '#ff3348', R: '#8a1020', g: '#48ff8a', j: '#b6ff3b',
    i: '#9fe8ff', I: '#3f8fc8', t: '#c79a3a', s: '#58597e', x: '#3d3a5c',
  };
  const hexRGB = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const SPRITES = {};
  G.SPRITES = SPRITES;
  G.defSprite = function (id, rows, pivot, pal) {
    const h = rows.length, w = Math.max(...rows.map((r) => r.length));
    const P = Object.assign({}, SPAL, pal || {});
    const pix = new Array(w * h).fill(null);
    for (let y = 0; y < h; y++) for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x];
      if (ch !== ' ' && ch !== '.') pix[y * w + x] = hexRGB(P[ch] || '#ff00ff');
    }
    let rmax = 0;
    for (const [cx, cy] of [[0, 0], [w, 0], [0, h], [w, h]]) rmax = Math.max(rmax, Math.hypot(cx - pivot[0] - 0.5, cy - pivot[1] - 0.5));
    return (SPRITES[id] = { id, w, h, pix, px: pivot[0], py: pivot[1], R: Math.ceil(rmax) + 1, cache: new Map() });
  };
  const NANG = 64;
  const OUTLINE = [7, 5, 13];
  function rotSprite(spr, ang, flip, scale) {
    let ai = Math.round((ang / TAU) * NANG) % NANG;
    if (ai < 0) ai += NANG;
    const key = ai + (flip ? 'f' : '') + (scale !== 1 ? 's' + scale : '');
    let r = spr.cache.get(key);
    if (r) return r;
    const a = (ai / NANG) * TAU, ca = Math.cos(a), sa = Math.sin(a);
    const R = Math.ceil(spr.R * scale) + 1, S = R * 2 + 1, CW = S + 2;
    const c = document.createElement('canvas');
    c.width = c.height = CW;
    const g = c.getContext('2d');
    const im = g.createImageData(CW, CW), d = im.data;
    const on = new Uint8Array(CW * CW);
    for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
      const u = (ca * i + sa * j) / scale;
      let v = (-sa * i + ca * j) / scale;
      if (flip) v = -v;
      const sx = Math.floor(spr.px + 0.5 + u), sy = Math.floor(spr.py + 0.5 + v);
      if (sx < 0 || sy < 0 || sx >= spr.w || sy >= spr.h) continue;
      const col = spr.pix[sy * spr.w + sx];
      if (!col) continue;
      const idx = (j + R + 1) * CW + (i + R + 1);
      on[idx] = 1;
      d[idx * 4] = col[0]; d[idx * 4 + 1] = col[1]; d[idx * 4 + 2] = col[2]; d[idx * 4 + 3] = 255;
    }
    for (let y = 0; y < CW; y++) for (let x = 0; x < CW; x++) {
      const i = y * CW + x;
      if (on[i]) continue;
      if ((x > 0 && on[i - 1]) || (x < CW - 1 && on[i + 1]) || (y > 0 && on[i - CW]) || (y < CW - 1 && on[i + CW])) {
        d[i * 4] = OUTLINE[0]; d[i * 4 + 1] = OUTLINE[1]; d[i * 4 + 2] = OUTLINE[2]; d[i * 4 + 3] = 235;
      }
    }
    g.putImageData(im, 0, 0);
    r = { c, o: R + 1 };
    spr.cache.set(key, r);
    return r;
  }
  // draw sprite `id` so its pivot sits on (x, y) (screen px), rotated by `ang` (world radians)
  G.drawSprite = function (ctx, id, x, y, ang, flip = false, scale = 1) {
    const spr = SPRITES[id];
    if (!spr) return;
    const r = rotSprite(spr, ang, flip, scale || 1);
    ctx.drawImage(r.c, Math.round(x) - r.o, Math.round(y) - r.o);
  };
  const flipOf = (p) => !!(p && p.facing < 0);
  const spriteHeld = (id) => function (ctx, x, y, ang, p, inst, sc = 1) { G.drawSprite(ctx, id, x, y, ang, flipOf(p), sc); };
  // add a light at a point along the held weapon (drawHeld works in screen space)
  function heldLight(x, y, ang, dist, r, color, a) {
    const cam = G.world && G.world.cam;
    if (!cam) return;
    G.addLight(x + Math.cos(ang) * dist + cam.x, y + Math.sin(ang) * dist + cam.y, r, color, a);
  }

  // legacy line helpers (kept for other modules)
  G.drawBlade = function (ctx, x, y, ang, o) {
    const c = Math.cos(ang), s = Math.sin(ang);
    const hl = o.handle || 3, bl = o.len || 12;
    G.px.line(ctx, x - c * 2, y - s * 2, x + c * hl, y + s * hl, o.handleColor || PAL.steel0, 2);
    if (o.guard) G.px.line(ctx, x + c * hl - s * 2, y + s * hl + c * 2, x + c * hl + s * 2, y + s * hl - c * 2, o.guard, 1);
    const bx = x + c * hl, by = y + s * hl;
    G.px.line(ctx, bx, by, bx + c * bl, by + s * bl, o.blade || PAL.steel4, o.width || 2);
    if (o.edge) G.px.line(ctx, bx + c, by + s, bx + c * (bl - 1), by + s * (bl - 1), o.edge, 1);
  };
  G.drawGun = function (ctx, x, y, ang, o) {
    const c = Math.cos(ang), s = Math.sin(ang);
    const len = o.len || 8;
    G.px.line(ctx, x - c * 1, y - s * 1, x + c * len, y + s * len, o.body || PAL.steel2, o.width || 3);
    G.px.line(ctx, x + c * 2, y + s * 2, x + c * (len + (o.barrel || 2)), y + s * (len + (o.barrel || 2)), o.barrelColor || PAL.steel3, 1);
    G.px.line(ctx, x + s * 1, y - c * -1, x + s * 3 - c, y + c * 3 - s, o.grip || PAL.steel0, 2);
    if (o.light) { ctx.fillStyle = o.light; ctx.fillRect(Math.round(x + c * (len - 2)), Math.round(y + s * (len - 2)) - 1, 1, 1); }
  };

  // ---------------------------------------------------------------- sprites
  G.defSprite('katana', [
    '    y              ',
    'hHhHybBbbubbbbbbbbW',
    '    ycccccccccccce ',
  ], [1, 1]);
  G.defSprite('whip', [
    ' nl  ',
    'hHnlc',
    ' nl  ',
  ], [1, 1]);
  G.defSprite('fist', [
    'nlwl',
    'npPw',
    'nlwl',
    ' nn ',
  ], [0, 1]);
  G.defSprite('fistB', [
    'mnln',
    'mqpl',
    'mnln',
    ' mm ',
  ], [0, 1]);
  G.defSprite('hammer', [
    '             lwwwwwl',
    '             nlllllm',
    '             nCcCcCm',
    '             nlllllm',
    'dmdmdmdmdmlllnwllllmW',
    '             nlllllm',
    '             nCcCcCm',
    '             nlllllm',
    '             lwwwwwl',
  ], [2, 4]);
  G.defSprite('dagger', [
    '   v     ',
    'hHhvbBbbW',
    '   v ccc ',
  ], [1, 1]);
  G.defSprite('spear', [
    '                        l  cc  ',
    'dmdmdmdmdmdmdmdmdmdmdmdmlwceWWe',
    '                        l  cc  ',
  ], [7, 1]);
  G.defSprite('axe', [
    '            nnnl     ',
    'hHhHhHhHhHhnnnnnl    ',
    '           nnOooyyo  ',
    '            nOoyWWyo ',
    '            nOoyWWyyo',
    '             OooyWWyo',
    '              OooyWyo',
    '               Oooyo ',
    '                ooo  ',
  ], [1, 1]);
  G.defSprite('zwei', [
    '     n                    ',
    'hHhHhnlBBBBBBBBBBBBBBBBBBW',
    'hHhHhnbbbbbbbbbbbbbbbbbbw ',
    '     nppppppppppppppppppP ',
    '     n                    ',
  ], [2, 1]);
  G.defSprite('baton', [
    '          c  c ',
    'hHhHnlllllllllc',
    '          c  c ',
  ], [1, 1]);
  G.defSprite('pistol', [
    ' nnnnnnl ',
    ' xmmmpplw',
    '  dd n   ',
    '  dd     ',
  ], [2, 2]);
  G.defSprite('railgun', [
    '   lllllllllllllc  ',
    ' nnmmmmmmmccccccW  ',
    'dnnnnnnnlllllllllc ',
    'dd  dd             ',
    '    dd             ',
  ], [4, 3]);
  G.defSprite('shotgun', [
    '  nnnnnnnnnnnnll',
    'UuunnmmmmmmmmmmW',
    'Uu  dd  OOOO    ',
    '    dd          ',
  ], [4, 2]);
  G.defSprite('smg', [
    '  nnnnnnnlw',
    ' mnmmmmmnn ',
    '   dd n    ',
    '   dd t    ',
    '      t    ',
  ], [3, 2]);
  G.defSprite('flamer', [
    '  RrrR         ',
    '  rrrr         ',
    '  nnnnnnnnnnlll',
    'nnnnnnnnnnnnlol',
    '   dd    l     ',
    '   dd          ',
  ], [3, 4]);
  G.defSprite('cryo', [
    '  iIi    ',
    ' nnnnnliW',
    '  ddnI   ',
    '  dd     ',
  ], [2, 2]);
  G.defSprite('kshield', [
    '   nn ',
    '  lwwn',
    '  lwwn',
    '  lccn',
    '  lwwn',
    '  lwwn',
    '  lccn',
    'ddlwwn',
    '  lwwn',
    '  lccn',
    '  lwwn',
    '  lwwn',
    '  lccn',
    '  lwwn',
    '   nn ',
  ], [0, 7]);
  G.defSprite('grenade', [' ll ', 'nmmn', 'mmom', ' mm '], [1, 2]);

  // ================================================================ icons (24 px design grid)
  function makeIc(g, k) {
    const R = (v) => Math.round(v * k);
    return {
      rect(x, y, w, h, c) { g.fillStyle = c; g.fillRect(R(x), R(y), Math.max(1, R(x + w) - R(x)), Math.max(1, R(y + h) - R(y))); },
      line(x0, y0, x1, y1, c, t = 1) { G.px.line(g, x0 * k, y0 * k, x1 * k, y1 * k, c, Math.max(1, Math.round(t * k))); },
      disc(x, y, r, c) { G.px.disc(g, x * k, y * k, r * k, c); },
      ring(x, y, r, c, t = 1) { G.px.ring(g, x * k, y * k, r * k, c, Math.max(1, Math.round(t * k))); },
      dot(x, y, c) { g.fillStyle = c; g.fillRect(R(x), R(y), Math.max(1, R(x + 1) - R(x)), Math.max(1, R(y + 1) - R(y))); },
      poly(pts, c) { for (let i = 1; i < pts.length; i++) G.px.line(g, pts[i - 1][0] * k, pts[i - 1][1] * k, pts[i][0] * k, pts[i][1] * k, c, 1); },
      g, k,
    };
  }
  const icon = (fn) => (g, s) => fn(makeIc(g, s / 24));
  G.makeIc = makeIc;
  // outline pass for icons: every transparent pixel touching an opaque one becomes ink
  G.outlineCanvas = function (c) {
    const g = c.getContext('2d'), W = c.width, H = c.height;
    const im = g.getImageData(0, 0, W, H), d = im.data;
    const on = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) on[i] = d[i * 4 + 3] > 60 ? 1 : 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (on[i]) continue;
      if ((x > 0 && on[i - 1]) || (x < W - 1 && on[i + 1]) || (y > 0 && on[i - W]) || (y < H - 1 && on[i + W])) {
        d[i * 4] = OUTLINE[0]; d[i * 4 + 1] = OUTLINE[1]; d[i * 4 + 2] = OUTLINE[2]; d[i * 4 + 3] = 255;
      }
    }
    g.putImageData(im, 0, 0);
  };
  const iconCache = new Map();
  G.itemIcon = function (def, size = 24) {
    const key = def.id + '|' + size;
    let c = iconCache.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    try {
      if (def.drawIcon) def.drawIcon(g, size);
      else if (def.drawHeld) def.drawHeld(g, size * 0.22, size * 0.78, -Math.PI / 4, null, null, 1.6);
      G.outlineCanvas(c);
    } catch (e) { console.error('[icon ' + def.id + ']', e); }
    iconCache.set(key, c);
    return c;
  };

  // ================================================================ effects
  // Generic short-lived effect pushed into world.projectiles (drawn above actors, never hits anything).
  class Effect {
    constructor(o) {
      this.t = 0; this.life = 0.2; this.dead = false; this.team = 'fx'; this.isEffect = true;
      this.x = 0; this.y = 0; this.vx = 0; this.vy = 0; this.r = 0; this.dmg = 0;
      this.hitSet = new Set();
      Object.assign(this, o);
    }
    update(dt, world) { this.t += dt; if (this.tick) this.tick(dt, world); if (this.t >= this.life) this.dead = true; }
    draw(ctx, cam) { if (this.drawFn) this.drawFn(ctx, cam, this); }
    drawLight(ctx, cam) { if (this.lightFn) this.lightFn(ctx, cam, this); }
  }
  G.Effect = Effect;
  G.addEffect = (world, o) => world.projectiles.push(new Effect(o));

  function muzzleFlash(world, x, y, dir, color, size = 1) {
    world.fx.burst(x, y, Math.round(4 * size), { angle: dir > 0 ? 0 : Math.PI, spread: 0.5, speed: 130 * size, life: 0.12, color: [color, '#ffffff'], shape: 'spark', grav: 0, additive: true });
    world.flashLights.push({ x, y, r: 26 * size, color, t: 0, life: 0.07 });
    world.projectiles.push(new Effect({
      x, y, dir, life: 0.05, color, size,
      drawFn(ctx, cam, e) {
        const X = Math.round(e.x - cam.ox), Y = Math.round(e.y - cam.oy), L = Math.round(4 * e.size);
        ctx.fillStyle = e.color;
        ctx.fillRect(e.dir > 0 ? X : X - L, Y - 1, L, 3);
        ctx.fillRect(X + e.dir * Math.round(L * 0.4) - 1, Y - 2, 2, 5);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(e.dir > 0 ? X : X - L + 1, Y, L - 1, 1);
      },
    }));
  }
  G.muzzleFlash = muzzleFlash;
  function shell(world, x, y, dir, color = '#c79a3a') {
    world.fx.particle({ x, y, vx: -dir * G.rand.float(30, 80), vy: -G.rand.float(80, 150), grav: 700, color, life: 0.7, size: 1, bounce: 0.4, drag: 0.5 });
  }
  // straight beam (railgun, drone laser)
  function addBeam(world, x0, y0, x1, y1, o = {}) {
    world.projectiles.push(new Effect({
      x: x0, y: y0, x1, y1, life: o.life || 0.18, color: o.color || PAL.cyan, core: o.core || '#ffffff', width: o.width || 3,
      drawFn(ctx, cam, e) {
        const k = 1 - e.t / e.life;
        const w = Math.max(1, Math.round(e.width * k));
        const ax = e.x - cam.ox, ay = e.y - cam.oy, bx = e.x1 - cam.ox, by = e.y1 - cam.oy;
        G.px.line(ctx, ax, ay, bx, by, e.color, w + 1);
        G.px.line(ctx, ax, ay, bx, by, e.core, Math.max(1, w - 1));
      },
      lightFn(ctx, cam, e) {
        const k = 1 - e.t / e.life, len = G.dist(e.x, e.y, e.x1, e.y1), n = Math.max(1, Math.round(len / 22));
        for (let i = 0; i <= n; i++) {
          const u = i / n;
          G.drawGlow(ctx, G.lerp(e.x, e.x1, u) - cam.ox, G.lerp(e.y, e.y1, u) - cam.oy, 10 + e.width * 3, e.color, 0.55 * k);
        }
      },
    }));
  }
  G.addBeam = addBeam;
  // jagged lightning between successive nodes [[x,y],...]
  function jag(x0, y0, x1, y1, amp) {
    const n = Math.max(3, Math.round(G.dist(x0, y0, x1, y1) / 7));
    const nx = -(y1 - y0), ny = x1 - x0, L = Math.hypot(nx, ny) || 1;
    const pts = [[x0, y0]];
    for (let i = 1; i < n; i++) {
      const u = i / n, off = G.rand.float(-amp, amp) * Math.sin(u * Math.PI);
      pts.push([x0 + (x1 - x0) * u + (nx / L) * off, y0 + (y1 - y0) * u + (ny / L) * off]);
    }
    pts.push([x1, y1]);
    return pts;
  }
  function addBolt(world, nodes, o = {}) {
    world.projectiles.push(new Effect({
      nodes, life: o.life || 0.25, color: o.color || PAL.cyan, amp: o.amp || 5, jt: 0, segs: null,
      tick(dt) {
        this.jt -= dt;
        if (this.jt <= 0 || !this.segs) {
          this.jt = 0.035; this.segs = [];
          for (let i = 1; i < this.nodes.length; i++) {
            const a = this.nodes[i - 1], b = this.nodes[i];
            this.segs.push(jag(a[0], a[1], b[0], b[1], this.amp));
          }
        }
      },
      drawFn(ctx, cam, e) {
        if (!e.segs) e.tick(0);
        const k = 1 - e.t / e.life;
        ctx.globalAlpha = Math.min(1, k * 2);
        for (const s of e.segs) for (let i = 1; i < s.length; i++) G.px.line(ctx, s[i - 1][0] - cam.ox, s[i - 1][1] - cam.oy, s[i][0] - cam.ox, s[i][1] - cam.oy, e.color, 2);
        for (const s of e.segs) for (let i = 1; i < s.length; i++) G.px.line(ctx, s[i - 1][0] - cam.ox, s[i - 1][1] - cam.oy, s[i][0] - cam.ox, s[i][1] - cam.oy, '#ffffff', 1);
        ctx.globalAlpha = 1;
      },
      lightFn(ctx, cam, e) {
        const k = 1 - e.t / e.life;
        for (const n of e.nodes) G.drawGlow(ctx, n[0] - cam.ox, n[1] - cam.oy, 26, e.color, 0.7 * k);
      },
    }));
  }
  G.addBolt = addBolt;
  // thrust streak (spears, daggers, dash)
  function addStreak(world, x0, y, x1, color, life = 0.12, w = 3) {
    world.projectiles.push(new Effect({
      x: x0, y, x1, color, life, w,
      drawFn(ctx, cam, e) {
        const k = 1 - e.t / e.life, len = (e.x1 - e.x);
        const head = e.x + len * Math.min(1, e.t / (e.life * 0.4));
        const tail = e.x + len * Math.max(0, (e.t / e.life) * 1.2 - 0.2);
        const ww = Math.max(1, Math.round(e.w * k));
        G.px.line(ctx, tail - cam.ox, e.y - cam.oy, head - cam.ox, e.y - cam.oy, e.color, ww);
        G.px.line(ctx, (tail + head) / 2 - cam.ox, e.y - cam.oy, head - cam.ox, e.y - cam.oy, '#ffffff', 1);
      },
      lightFn(ctx, cam, e) { G.drawGlow(ctx, e.x1 - cam.ox, e.y - cam.oy, 18, e.color, 0.5 * (1 - e.t / e.life)); },
    }));
  }
  // ice shell around a frozen target
  class IceShell extends Effect {
    constructor(t, dur) { super({ target: t, life: dur }); }
    update(dt, world) {
      this.t += dt;
      const t = this.target;
      if (this.t >= this.life || t.dead || t.dying || !isFrozen(t)) {
        this.dead = true;
        world.fx.burst(t.cx, t.cy, 10, { speed: 110, life: 0.4, color: ['#9fe8ff', '#ffffff'], grav: 400, shape: 'px' });
      }
    }
    draw(ctx, cam) {
      const t = this.target;
      const x = Math.round(t.x - cam.ox) - 2, y = Math.round(t.y - cam.oy) - 2, w = t.w + 4, h = t.h + 3;
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = '#9fe8ff'; ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#e8fbff'; ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y, 1, h);
      ctx.fillStyle = '#3f8fc8'; ctx.fillRect(x, y + h - 1, w, 1); ctx.fillRect(x + w - 1, y, 1, h);
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 3; i++) ctx.fillRect(x + 2 + i * Math.floor(w / 3), y + 2 + ((i * 5) % Math.max(1, h - 4)), 1, 2);
      ctx.globalAlpha = 1;
    }
    drawLight(ctx, cam) { const t = this.target; G.drawGlow(ctx, t.cx - cam.ox, t.cy - cam.oy, 26, '#9fe8ff', 0.35); }
  }

  // Player projectile that routes damage through G.weaponHit (per-target crit, affixes, statuses).
  // Extra fields: p, inst, base, crit | critFn(target, proj), critMul, hitOpts, statusFn(target), onHitT(target, world, dealt, crit), spark
  class WProj extends G.Projectile {
    constructor(o) {
      super(Object.assign({ team: 'player' }, o));
      this.x0 = this.x; this.y0 = this.y;
      if (this.p && this.inst) {
        this.dmg = G.itemDamage(this.p, this.inst, this.base || 1);
        if (this.inst.extraPierce) this.pierce += this.inst.extraPierce;
      }
    }
    hit(t, world) {
      if (this.team !== 'player' || !this.p) return super.hit(t, world);
      const crit = this.critFn ? this.critFn(t, this) : !!this.crit;
      const o = Object.assign({ dir: G.sign(this.vx) || this.p.facing, crit, critMul: this.critMul, kind: 'projectile', noLabel: this.noLabel }, this.hitOpts || {});
      if (this.statusFn) o.status = this.statusFn(t, this);
      const dealt = G.weaponHit(world, this.p, this.inst, t, this.base, o);
      this.hitSet.add(t.id);
      if (dealt) {
        if (this.onHitT) this.onHitT(t, world, dealt, crit);
        else world.fx.sparks(this.x, this.y, -G.sign(this.vx), 5, this.spark || this.color);
        snd('hit', { vol: 0.45 });
      }
      if (this.pierce-- <= 0) { this.dead = true; if (this.onEnd) this.onEnd(world); return true; }
      return false;
    }
  }
  G.WProj = WProj;
  const shoot = (world, p, inst, o) => world.addProjectile(new WProj(Object.assign({ p, inst }, o)));

  // ================================================================ Actions
  class Action {
    constructor(p, inst, button) {
      this.p = p; this.inst = inst; this.def = inst.def; this.button = button;
      this.t = 0; this.done = false;
      this.cancelable = false;   // may be interrupted by roll / other items
      this.moveMul = 0.2;        // horizontal control while acting (ground)
      this.airMoveMul = 0.7;
      this.lockFacing = true;
      this.gravityMul = 1;
    }
    update(dt, world) { this.t += dt; }
    press() {}                   // same button pressed again during the action
    pose(pose) {}                // override arm/weapon angles
    end() {}
    get held() { return G.input.down(this.button); }
  }
  G.Action = Action;

  // ---------------------------------------------------------------- melee combos
  // step: {wind, active, rec, dmg, reach, h, yOff, arc:[a0,a1] (0 = forward, -PI/2 = up), lunge, lungeUp,
  //        kb, kbUp, stun, sfx, pitch, trail, trailW, noSlash, streak, crit(p,t,i,act), critMul, shake, hitstop,
  //        box(p,act), status (obj | fn(p,inst)), onStart(act,world), onHit(act,t,world,crit), moveMul}
  class MeleeAction extends Action {
    constructor(p, inst, button) {
      super(p, inst, button);
      this.steps = this.def.combo;
      this.i = 0; this.queued = false; this.chain = 0;
      this.startStep(0);
    }
    startStep(i, step) {
      this.i = i; this.t = 0; this.phase = 'wind'; this.hitSet = new Set(); this.queued = false; this.hitAny = false;
      const s = step || this.steps[i];
      this.s = s; this.cancelable = false; this.chain++;
      const ix = inputX();
      if (ix) this.p.facing = ix;
      this.moveMul = s.moveMul != null ? s.moveMul : this.def.moveMul != null ? this.def.moveMul : 0.2;
      if (s.sfx !== false) snd(s.sfx || 'slash' + ((i % 3) + 1), { pitch: s.pitch });
    }
    press() { if (this.phase !== 'wind') this.queued = true; }
    hitbox(s) {
      const p = this.p;
      if (s.box) return s.box(p, this);
      return { x: p.facing > 0 ? p.x + p.w - 6 : p.x + 6 - s.reach, y: p.y + (s.yOff || 0), w: s.reach, h: s.h || 20 };
    }
    critFor(t) { const s = this.s, d = this.def; return s.crit ? s.crit(this.p, t, this.i, this) : d.crit ? d.crit(this.p, t, this.i, this) : false; }
    dmgFor() { return this.s.dmg; }
    statusFor() {
      const s = this.s, d = this.def;
      const st = s.status !== undefined ? s.status : d.status;
      return typeof st === 'function' ? st(this.p, this.inst) : st || null;
    }
    onActiveStart(world) {
      const p = this.p, s = this.s;
      if (s.lunge) p.vx = p.facing * s.lunge;
      if (s.lungeUp) p.vy = -s.lungeUp;
      const color = s.trail || this.def.trail || PAL.cyan;
      if (!s.noSlash && !this.def.noSlash) {
        const cx = p.cx + p.facing * 4, cy = p.y + (s.yOff || 0) + (s.h || 20) / 2;
        const toW = (a) => (p.facing > 0 ? a : Math.PI - a);
        world.fx.slash(cx, cy, s.reach * 0.85, toW(s.arc[0]), toW(s.arc[1]), color, s.active + 0.1, s.trailW || 5);
      }
      if (s.streak) {
        const y = p.y + (s.yOff || 0) + (s.h || 20) / 2;
        addStreak(world, p.cx + p.facing * 6, y, p.cx + p.facing * (s.reach + 2), color, s.active + 0.08, s.streak);
      }
      if (s.onStart) s.onStart(this, world);
    }
    update(dt, world) {
      const p = this.p, s = this.s;
      this.t += dt;
      if (this.phase === 'wind' && this.t >= s.wind) { this.phase = 'active'; this.t = 0; this.onActiveStart(world); }
      if (this.phase === 'active') {
        const box = this.hitbox(s);
        for (const t of world.enemies) {
          if (t.dead || t.dying || this.hitSet.has(t.id) || !G.overlap(box, t)) continue;
          this.hitSet.add(t.id);
          const crit = this.critFor(t);
          const dealt = G.weaponHit(world, p, this.inst, t, this.dmgFor(t), {
            crit, critMul: s.critMul, dir: p.facing, kb: s.kb == null ? 90 : s.kb, kbUp: s.kbUp || 0,
            stun: s.stun == null ? 0.12 : s.stun, status: this.statusFor(), kind: 'melee',
          });
          if (!dealt) continue;
          this.hitAny = true;
          this.hitFx(t, crit, world);
          if (s.onHit) s.onHit(this, t, world, crit);
          if (this.def.onHit) this.def.onHit(this, t, world, crit);
        }
        if (this.t >= s.active) { this.phase = 'rec'; this.t = 0; }
      }
      if (this.phase === 'rec') {
        this.cancelable = this.t > s.rec * 0.25;
        if (this.queued && this.t >= s.rec * 0.3) { this.next(); return; }
        if (this.t >= s.rec) this.done = true;
      }
    }
    next() { this.startStep((this.i + 1) % this.steps.length); }
    hitFx(t, crit, world) {
      const p = this.p, s = this.s, color = s.trail || this.def.trail || PAL.cyan;
      world.fx.sparks(t.cx - p.facing * 3, Math.min(t.cy, p.y + 12), p.facing, crit ? 12 : 7, color);
      world.fx.splat(t.cx, t.cy, p.facing, crit ? 10 : 6, t.bloodColors);
      if (crit) world.fx.ring(t.cx, t.cy, 2, 14, PAL.yellow, 0.2, 1);
      world.hitstop(s.hitstop != null ? s.hitstop * (crit ? 1.3 : 1) : crit ? 0.09 : 0.05);
      world.shake(s.shake ? s.shake * (crit ? 1.3 : 1) : crit ? 3 : 1.5, 0.12);
      snd(crit ? 'hitCrit' : 'hit');
    }
    // weapon angle through the swing
    pose(pose) {
      const s = this.s;
      let a;
      if (this.phase === 'wind') a = G.lerp(s.arc[0] - (s.windBack == null ? 0.35 : s.windBack), s.arc[0], G.easeOut(Math.min(1, this.t / Math.max(0.001, s.wind))));
      else if (this.phase === 'active') a = G.lerp(s.arc[0], s.arc[1], G.easeOut(Math.min(1, this.t / s.active)));
      else a = G.lerp(s.arc[1], s.arc[1] + (s.follow == null ? 0.25 : s.follow), Math.min(1, this.t / s.rec));
      pose.aim = a; // 0 forward, -PI/2 up, PI/2 down
      pose.lean = this.phase === 'active' ? 0.35 : this.phase === 'wind' ? -0.1 : 0.15;
      pose.twoHand = !!(s.twoHand != null ? s.twoHand : this.def.twoHand);
      pose.thrust = s.streak ? (this.phase === 'active' ? 1 : 0) : 0;
      if (s.recoilPose && this.phase === 'wind') pose.recoil = 0; // bent arm on wind
      if (s.punch) pose.recoil = this.phase === 'wind' ? 0 : this.phase === 'active' ? 1 : Math.max(0, 1 - this.t / s.rec);
    }
  }
  G.MeleeAction = MeleeAction;

  // whip: a monomolecular filament drawn from the hand to the tip
  class WhipAction extends MeleeAction {
    draw(ctx, cam) {
      const p = this.p, J = p._lastJ, s = this.s;
      if (!J) return;
      const f = p.facing;
      let ext;
      if (this.phase === 'wind') ext = 0.12 * (this.t / Math.max(0.001, s.wind));
      else if (this.phase === 'active') ext = G.easeOut(Math.min(1, this.t / s.active));
      else ext = Math.max(0, 1 - this.t / (s.rec * 0.55));
      if (ext <= 0.02) return;
      const ox = cam.x, oy = cam.y;
      const hx = J.handF[0] + f * 3, hy = J.handF[1];
      const tx = p.cx + f * (s.reach + 2) * (0.2 + 0.8 * ext), ty = p.y + (s.yOff || 0) + (s.h || 12) / 2 + (1 - ext) * 10;
      const N = 14;
      let px0 = hx, py0 = hy;
      const wave = this.phase === 'active' ? 1 - ext : 0.4;
      for (let i = 1; i <= N; i++) {
        const u = i / N;
        const x = G.lerp(hx, tx, u), y = G.lerp(hy, ty, u) + Math.sin(u * Math.PI * 2 + this.t * 40) * 3 * wave * (1 - u * 0.5) + (this.phase === 'rec' ? u * u * 6 * (1 - ext) : 0);
        G.px.line(ctx, px0 - ox, py0 - oy, x - ox, y - oy, i > N - 3 ? '#ffffff' : PAL.cyan, 1);
        px0 = x; py0 = y;
      }
      if (this.phase === 'active' && this.t < s.active * 0.6) {
        ctx.fillStyle = '#ffffff';
        const X = Math.round(tx - ox), Y = Math.round(ty - oy);
        ctx.fillRect(X - 2, Y, 5, 1); ctx.fillRect(X, Y - 2, 1, 5);
      }
      G.addLight(tx, ty, 14, PAL.cyan, 0.6 * ext);
      G.addLight((hx + tx) / 2, (hy + ty) / 2, 22, PAL.cyan, 0.25 * ext);
    }
  }

  // two-handed blade: tap = heavy combo, hold = charged slash (full charge crits)
  class HeavyAction extends MeleeAction {
    constructor(p, inst, button) { super(p, inst, button); this.charge = 0; this.charging = false; this.heavy = false; this.full = false; }
    update(dt, world) {
      const d = this.def, p = this.p;
      if (!this.held) this.letGo = true;
      if (this.chain === 1 && this.phase === 'wind' && !this.heavy) {
        if (!this.charging && !this.letGo && this.held && this.t + dt >= d.chargeDelay) { this.charging = true; this.ct = 0; snd('charge', { vol: 0.7 }); }
        if (this.charging) {
          this.ct += dt;
          this.charge = Math.min(1, this.ct / d.chargeTime);
          this.moveMul = 0.12;
          if (this.charge >= 1 && !this.full) {
            this.full = true;
            world.fx.ring(p.cx - p.facing * 4, p.y + 2, 2, 16, d.trail, 0.25, 1);
            world.flashLights.push({ x: p.cx, y: p.y, r: 50, color: d.trail, t: 0, life: 0.15 });
            snd('charge', { pitch: 1.6, vol: 0.6 });
          }
          if (G.rand.chance(dt * (20 + 40 * this.charge))) {
            const a = G.rand.float(0, TAU), r = 18;
            world.fx.particle({ x: p.cx - p.facing * 8 + Math.cos(a) * r, y: p.y - 4 + Math.sin(a) * r, vx: -Math.cos(a) * 60, vy: -Math.sin(a) * 60, life: 0.3, color: G.rand.pick([d.trail, '#ffffff']), additive: true, glow: 4 });
          }
          if (this.letGo || this.ct > d.chargeTime + 1.2) {
            this.charging = false; this.heavy = true;
            const s = d.heavy;
            this.s = s; this.phase = 'wind'; this.t = s.wind; this.hitSet = new Set();
            snd(s.sfx || 'heavy', { pitch: this.full ? 0.8 : 1 });
          } else { this.t = Math.min(this.t, d.chargeDelay); return; }
        }
      }
      super.update(dt, world);
    }
    critFor(t) { return this.heavy ? this.full || G.rollCrit(this.p, this.inst, t, false) : super.critFor(t); }
    dmgFor() { return this.heavy ? this.s.dmg * (0.5 + 0.5 * this.charge) : this.s.dmg; }
    next() { if (this.heavy) { this.heavy = false; this.startStep(0); } else super.next(); }
    onActiveStart(world) {
      super.onActiveStart(world);
      if (this.heavy && this.full) { world.shake(4, 0.2); world.flashLights.push({ x: this.p.cx + this.p.facing * 20, y: this.p.cy, r: 80, color: this.def.trail, t: 0, life: 0.2 }); }
    }
    pose(P) {
      if (this.charging) { P.aim = -2.5 + Math.sin(this.ct * 50) * 0.04 * this.charge; P.lean = -0.25; P.twoHand = true; return; }
      super.pose(P);
    }
    draw(ctx, cam) {
      if (!this.charging) return;
      const J = this.p._lastJ;
      if (!J) return;
      const a = this.p.facing > 0 ? -2.5 : Math.PI + 2.5;
      G.addLight(J.handF[0] + Math.cos(a) * 14, J.handF[1] + Math.sin(a) * 14, 14 + 20 * this.charge, this.def.trail, 0.3 + 0.6 * this.charge);
    }
  }

  // ---------------------------------------------------------------- ranged
  // def: {wind, rec, fire(p, inst, world, charge, act), charge:{time, min, hold}, auto, recoil, aim, moveMul,
  //       chargeColor, muzzle:[fwd, up]}
  class RangedAction extends Action {
    constructor(p, inst, button) {
      super(p, inst, button);
      const d = this.def;
      this.phase = 'wind'; this.charge = 0; this.queued = false;
      this.moveMul = d.moveMul == null ? 0.35 : d.moveMul;
      this.airMoveMul = d.airMoveMul == null ? 0.7 : d.airMoveMul;
      this.face();
      if (d.charge) snd('charge', { vol: 0.5 });
    }
    face() { const ix = inputX(); if (ix) this.p.facing = ix; }
    press() { if (this.phase === 'rec') this.queued = true; }
    update(dt, world) {
      const d = this.def;
      this.t += dt;
      if (this.phase === 'wind') {
        if (d.charge) {
          this.charge = Math.min(1, this.t / d.charge.time);
          if (this.charge >= 1 && !this._full) {
            this._full = true;
            const m = this.muzzle();
            world.fx.ring(m.x, m.y, 2, 12, d.chargeColor || d.trail || PAL.cyan, 0.2, 1);
            world.flashLights.push({ x: m.x, y: m.y, r: 30, color: d.chargeColor || PAL.cyan, t: 0, life: 0.12 });
            snd('charge', { pitch: 1.7, vol: 0.5 });
          }
          if (G.rand.chance(dt * (15 + 45 * this.charge))) {
            const m = this.muzzle(), a = G.rand.float(0, TAU), r = 10 + 6 * (1 - this.charge);
            world.fx.particle({ x: m.x + Math.cos(a) * r, y: m.y + Math.sin(a) * r, vx: -Math.cos(a) * r * 5, vy: -Math.sin(a) * r * 5, life: 0.2, color: G.rand.pick([d.chargeColor || PAL.cyan, '#ffffff']), additive: true });
          }
          if (!this.held && this.t >= (d.charge.min || 0.1)) this.fire(world);
          else if (this.t > d.charge.time + (d.charge.hold || 1.5)) this.fire(world);
        } else if (this.t >= d.wind) this.fire(world);
      } else if (this.phase === 'rec') {
        this.cancelable = true;
        if (this.t >= d.rec) {
          if (d.auto && this.held) { this.face(); this.phase = 'wind'; this.t = d.wind; this.fire(world); }
          else if (this.queued) {
            this.queued = false; this.face();
            this.phase = 'wind'; this.t = 0; this.charge = 0; this._full = false;
            if (d.charge) snd('charge', { vol: 0.5 });
          } else this.done = true;
        }
      }
    }
    muzzle() { const m = this.def.muzzle || [13, 9]; return { x: this.p.cx + this.p.facing * m[0], y: this.p.y + m[1] }; }
    fire(world) {
      const d = this.def;
      this.phase = 'rec'; this.t = 0; this.cancelable = true;
      d.fire(this.p, this.inst, world, this.charge, this);
      this.p.vx -= this.p.facing * (d.recoil || 0) * (d.charge ? 0.3 + 0.7 * this.charge : 1);
    }
    pose(pose) {
      const d = this.def;
      pose.aim = d.aim || 0;
      pose.lean = 0.05;
      pose.recoil = this.phase === 'rec' ? Math.max(0, 1 - this.t / 0.12) : 0;
      pose.twoHand = !!d.twoHand;
      pose.charge = this.charge;
    }
    draw(ctx, cam) {
      const d = this.def;
      if (d.charge && this.phase === 'wind') {
        const m = this.muzzle();
        G.addLight(m.x, m.y, 8 + 22 * this.charge, d.chargeColor || PAL.cyan, 0.25 + 0.6 * this.charge);
        if (this.charge >= 1 && Math.floor(this.t * 16) % 2) {
          ctx.fillStyle = '#ffffff';
          const X = Math.round(m.x - cam.x), Y = Math.round(m.y - cam.y);
          ctx.fillRect(X - 1, Y, 3, 1); ctx.fillRect(X, Y - 1, 1, 3);
        }
      }
      if (d.drawAct) d.drawAct(ctx, cam, this);
    }
  }
  G.RangedAction = RangedAction;

  // hold to channel (flamethrower): def.tickRate, channelTick(p,inst,world,act), channelFrame, maxChannel, heatCd(t)
  class ChannelAction extends Action {
    constructor(p, inst, button) {
      super(p, inst, button);
      const d = this.def;
      this.moveMul = d.moveMul == null ? 0.3 : d.moveMul;
      this.tick = 0; this.cancelable = true; this.ended = false;
      const ix = inputX(); if (ix) p.facing = ix;
    }
    update(dt, world) {
      const d = this.def;
      this.t += dt;
      if ((!this.held && this.t > 0.12) || this.t >= d.maxChannel) { this.done = true; return; }
      this.tick -= dt;
      if (this.tick <= 0) { this.tick += d.tickRate; d.channelTick(this.p, this.inst, world, this); }
      if (d.channelFrame) d.channelFrame(this.p, this.inst, world, this, dt);
    }
    end() { if (this.ended) return; this.ended = true; G.startCooldown(this.p, this.inst, this.def.heatCd(this.t)); }
    pose(P) { P.aim = 0; P.lean = 0.02; P.twoHand = true; P.recoil = 0.15 + Math.sin(this.t * 60) * 0.1; }
    draw(ctx, cam) { if (this.def.drawAct) this.def.drawAct(ctx, cam, this); }
  }

  // ---------------------------------------------------------------- shields
  // hold to block (front only): damage * (1 - blockPct); raise right before a hit = PARRY
  // (negates, stuns the attacker, reflects projectiles). def.onParry(p, inst, src, info, world, act)
  function chipDamage(p, amount, info, world) {
    if (G.debug.god) amount = 0;
    for (const m of p.mutations) if (m.onIncoming) amount = m.onIncoming(p, amount, info);
    amount = Math.round(amount);
    if (amount <= 0) return;
    p.hp -= amount;
    p.recoverable = Math.min(p.maxHp - Math.max(0, p.hp), (p.recoverable || 0) + amount * 0.6);
    p.recoverT = 0;
    p.flash = 0.06;
    world.fx.number(p.cx, p.y - 4, amount, PAL.red);
    snd('playerHurt', { vol: 0.5 });
    G.emit('playerHurt', { dmg: amount, info, blocked: true });
    if (p.hp <= 0) { p.hp = 0; p.die(); }
  }
  const isProjectile = (s) => !!s && (s instanceof G.Projectile || s.isProjectile === true);
  // enemy bolts put their shooter into info.source: find the projectile that is touching the player
  function incomingProjectile(p, info, world) {
    if (isProjectile(info.source)) return info.source;
    let best = null, bd = 1e9;
    for (const pr of world.projectiles) {
      if (pr.dead || pr.team !== 'enemy' || !isProjectile(pr)) continue;
      const r = (pr.r || 2) + 6;
      if (pr.x + r < p.x || pr.x - r > p.x + p.w || pr.y + r < p.y || pr.y - r > p.y + p.h) continue;
      const d = G.dist(pr.x, pr.y, p.cx, p.cy);
      if (d < bd) { bd = d; best = pr; }
    }
    return best;
  }
  class ShieldAction extends Action {
    constructor(p, inst, button) {
      super(p, inst, button);
      this.moveMul = 0.3; this.airMoveMul = 0.5;
      this.parryWin = this.def.parryWindow || 0.2;
      this.parries = 0; this.blocks = 0; this.fxT = 0; this.fxKind = null;
      const ix = inputX(); if (ix) p.facing = ix;
      snd('shield', { vol: 0.6 });
    }
    get parrying() { return this.t < this.parryWin; }
    update(dt, world) {
      this.t += dt;
      if (this.fxT > 0) this.fxT -= dt;
      this.cancelable = this.t > 0.06;
      if (!this.held && this.t >= 0.22) this.done = true;
    }
    fromFront(info) {
      const p = this.p, src = info.source;
      const sx = src ? (src.cx != null ? src.cx : src.x) : null;
      if (sx != null) return Math.abs(sx - p.cx) < 3 || G.sign(sx - p.cx) === p.facing;
      // no source and no direction (spikes, falling out of the map): not blockable
      return info.dir != null && info.dir !== 0 ? info.dir === -p.facing : false;
    }
    block(amount, info, world) {
      if (this.done || !this.fromFront(info)) return amount;
      const p = this.p, d = this.def;
      world = world || G.world;
      const proj = incomingProjectile(p, info, world);
      const src = proj || info.source; // melee attacker, or the projectile itself
      if (this.parrying) {
        this.parries++; this.fxT = 0.25; this.fxKind = 'parry';
        p.invuln = Math.max(p.invuln, 0.35);
        if (proj) reflectProjectile(proj, p, this.inst, d.reflectMul || 2, !!d.reflectHoming);
        d.onParry(p, this.inst, src, info, world, this);
        for (const a of this.inst.affixes) if (a.onParry) a.onParry(p, this.inst, src, world);
        // shared parry juice
        const x = p.cx + p.facing * 9, y = p.y + 9;
        world.fx.ring(x, y, 3, 30, '#ffffff', 0.3, 2);
        world.fx.ring(x, y, 2, 18, d.trail || PAL.cyan, 0.22, 1);
        world.fx.burst(x, y, 22, { speed: 260, speedMin: 80, life: 0.35, color: [d.trail || PAL.cyan, '#ffffff', PAL.yellow], shape: 'spark', grav: 150, additive: true });
        world.fx.flash('#ffffff', 0.03);
        world.flashLights.push({ x, y, r: 46, color: d.trail || PAL.cyan, t: 0, life: 0.3 });
        world.fx.label(p.cx, p.y - 22, 'PARRY', PAL.yellow, 0.8);
        world.hitstop(0.12); world.shake(4, 0.2);
        snd('parry');
        G.emit('parry', { player: p, source: src });
        return 0;
      }
      this.blocks++; this.fxT = 0.12; this.fxKind = 'block';
      const chip = amount * (1 - Math.min(0.95, (d.blockPct || 0.7) + (this.inst.blockBonus || 0)));
      p.invuln = Math.max(p.invuln, 0.25);
      p.vx = -p.facing * 70;
      world.fx.sparks(p.cx + p.facing * 8, p.y + 8, -p.facing, 8, PAL.yellow);
      world.shake(2, 0.1);
      snd('shield', { vol: 0.8, pitch: 0.8 });
      if (proj) { proj.dead = true; }
      if (d.onBlock) d.onBlock(p, this.inst, src, info, world, this);
      chipDamage(p, chip, info, world);
      return 0;
    }
    pose(P) { P.aim = -0.05; P.lean = -0.05; P.recoil = this.fxT > 0 ? 0.6 : 0; }
    draw(ctx, cam) {
      const p = this.p, J = p._lastJ;
      if (!J) return;
      const x = J.handF[0] + p.facing * 4, y = J.handF[1];
      if (this.parrying) G.addLight(x, y, 26, '#ffffff', 0.35);
      if (this.fxT > 0) G.addLight(x, y, this.fxKind === 'parry' ? 60 : 30, this.def.trail || PAL.cyan, this.fxT * 4);
      if (this.def.drawAct) this.def.drawAct(ctx, cam, this);
    }
  }
  G.ShieldAction = ShieldAction;
  function reflectProjectile(pr, p, inst, mul, homing) {
    pr.team = 'player';
    const sp = Math.max(260, Math.hypot(pr.vx, pr.vy) * 1.3);
    let a = Math.atan2(pr.vy, pr.vx) + Math.PI;
    if (G.sign(Math.cos(a)) !== p.facing) a = p.facing > 0 ? 0 : Math.PI;
    pr.vx = Math.cos(a) * sp; pr.vy = Math.sin(a) * sp;
    pr.grav = 0; pr.t = 0; pr.life = Math.max(pr.life || 1, 1.2);
    pr.hitSet = new Set();
    pr.dmg = Math.max(1, Math.round((pr.dmg || 5) * mul * p.statMul(inst.def.stat)));
    pr.info = Object.assign({}, pr.info || {}, { crit: true, kb: 120, stun: 0.6, color: PAL.yellow });
    pr.color = PAL.yellow;
    pr.reflected = true;
    pr.homeTime = -1; pr.turn = 0; // stop enemy-side homing (e.g. virus orbs)
    if (homing) { pr.homing = 8; pr.homingRange = 200; }
  }

  // ---------------------------------------------------------------- skills
  class SkillAction extends Action {
    constructor(p, inst, button) {
      super(p, inst, button);
      this.moveMul = this.def.castMove == null ? 0.6 : this.def.castMove;
      this.dur = this.def.castTime || 0.18; this.fired = false;
      const ix = inputX(); if (ix) p.facing = ix;
    }
    update(dt, world) {
      this.t += dt;
      if (!this.fired && this.t >= this.dur * 0.4) {
        this.fired = true;
        this.def.activate(this.p, this.inst, world, this);
        G.startCooldown(this.p, this.inst);
      }
      if (this.t >= this.dur) this.done = true;
      this.cancelable = this.fired;
    }
    pose(pose) {
      if (this.def.pose) return this.def.pose(pose, this);
      pose.aim = G.lerp(-2.2, 0.3, Math.min(1, this.t / this.dur)); pose.lean = 0.1; pose.throwing = true;
    }
  }
  G.SkillAction = SkillAction;

  // dash-punch («Силовой удар»)
  class DashAction extends Action {
    constructor(p, inst, button) {
      super(p, inst, button);
      this.moveMul = 0; this.airMoveMul = 0; this.gravityMul = 0;
      this.phase = 'wind'; this.hitSet = new Set(); this.ghostT = 0;
      const ix = inputX(); if (ix) p.facing = ix;
      p.vy = Math.min(p.vy, 0) * 0.3;
      snd('charge', { vol: 0.4, pitch: 1.8 });
    }
    update(dt, world) {
      const p = this.p, d = this.def;
      this.t += dt;
      if (this.phase === 'wind') {
        p.vx *= 0.5; p.vy = 0;
        if (this.t >= 0.07) {
          this.phase = 'dash'; this.t = 0;
          G.startCooldown(p, this.inst);
          p.invuln = Math.max(p.invuln, d.dashTime + 0.1);
          snd('dash');
          world.fx.ring(p.cx - p.facing * 6, p.cy, 2, 14, d.trail, 0.2, 1);
        }
      }
      if (this.phase === 'dash') {
        p.vx = p.facing * d.dashSpeed; p.vy = 0;
        this.ghostT -= dt;
        if (this.ghostT <= 0 && p.ghosts && p.joints && p.buildPose) {
          this.ghostT = 0.025;
          p.ghosts.push({ j: p.joints(p.buildPose()), t: 0, c: this.ghosts++ % 2 ? d.trail : '#ffffff' });
        }
        if (G.rand.chance(0.7)) world.fx.particle({ x: p.cx - p.facing * 6, y: p.y + G.rand.float(2, p.h - 2), vx: -p.facing * 120, life: 0.18, color: d.trail, shape: 'line', additive: true });
        const box = { x: p.facing > 0 ? p.cx - 4 : p.cx - 22, y: p.y, w: 26, h: p.h };
        for (const t of world.enemies) {
          if (t.dead || t.dying || this.hitSet.has(t.id) || !G.overlap(box, t)) continue;
          this.hitSet.add(t.id);
          const crit = isStunned(t);
          const dealt = G.weaponHit(world, p, this.inst, t, d.dmg, { crit, dir: p.facing, kb: 300, kbUp: 120, stun: 1.1, kind: 'skill' });
          if (!dealt) continue;
          world.fx.ring(t.cx, t.cy, 3, 26, d.trail, 0.25, 2);
          world.fx.sparks(t.cx, t.cy, p.facing, 14, d.trail);
          world.fx.splat(t.cx, t.cy, p.facing, 10, t.bloodColors);
          world.flashLights.push({ x: t.cx, y: t.cy, r: 60, color: d.trail, t: 0, life: 0.15 });
          world.hitstop(crit ? 0.12 : 0.08); world.shake(crit ? 5 : 4, 0.2);
          snd('heavy'); snd(crit ? 'hitCrit' : 'hit');
        }
        if (this.t >= d.dashTime || (p.hitWall && this.t > 0.04)) { this.phase = 'rec'; this.t = 0; p.vx *= 0.25; }
      }
      if (this.phase === 'rec') { this.cancelable = this.t > 0.06; if (this.t >= 0.16) this.done = true; }
    }
    get ghosts() { return this._g || 0; }
    set ghosts(v) { this._g = v; }
    pose(P) { P.aim = this.phase === 'wind' ? 0.3 : 0; P.lean = this.phase === 'dash' ? 0.6 : 0.2; P.recoil = this.phase === 'wind' ? 0 : 1; }
    draw(ctx, cam) {
      const J = this.p._lastJ;
      if (!J || this.phase === 'rec') return;
      G.addLight(J.handF[0], J.handF[1], this.phase === 'dash' ? 30 : 14, this.def.trail, 0.8);
      if (this.phase === 'dash') {
        const X = Math.round(J.handF[0] - cam.x), Y = Math.round(J.handF[1] - cam.y);
        ctx.fillStyle = this.def.trail; ctx.fillRect(X - 2, Y - 2, 5, 5);
        ctx.fillStyle = '#ffffff'; ctx.fillRect(X - 1, Y - 1, 3, 3);
      }
    }
  }

  ACTION_BY_KIND.melee = MeleeAction;
  ACTION_BY_KIND.ranged = RangedAction;
  ACTION_BY_KIND.shield = ShieldAction;
  ACTION_BY_KIND.skill = SkillAction;
  G.WhipAction = WhipAction; G.HeavyAction = HeavyAction; G.ChannelAction = ChannelAction; G.DashAction = DashAction;

  // ================================================================ ground entities (world.objects)
  // Standalone (G.WorldObject lives in items.js, loaded later). Positions are top-left AABB.
  class GroundThing {
    constructor(x, y, w, h) { this.x = x - w / 2; this.y = y - h; this.w = w; this.h = h; this.t = 0; this.dead = false; this.interactable = false; this.isHazardFx = true; }
    get cx() { return this.x + this.w / 2; }
    get cy() { return this.y + this.h / 2; }
    get bottom() { return this.y + this.h; }
    update(dt) { this.t += dt; }
    draw() {}
  }
  function groundY(world, x, y) {
    const gy = world.level.groundBelow(x, y - 4, 160);
    return gy == null ? y : gy;
  }

  // burning ground («Зажигательная граната»)
  class FireZone extends GroundThing {
    constructor(x, y, p, inst, o = {}) {
      super(x, y, o.w || 72, 14);
      this.p = p; this.inst = inst; this.life = o.life || 5; this.tickT = 0; this.base = o.base || 3;
      this.hitSet = new Set();
    }
    update(dt, world) {
      this.t += dt;
      if (this.t >= this.life) { this.dead = true; return; }
      this.tickT -= dt;
      if (this.tickT <= 0) {
        this.tickT = 0.4;
        const box = { x: this.x, y: this.y - 10, w: this.w, h: this.h + 12 };
        for (const t of world.enemies) {
          if (t.dead || t.dying || !G.overlap(box, t)) continue;
          G.weaponHit(world, this.p, this.inst, t, this.base, { kb: 0, stun: 0, status: G.ST.burn(this.p, this.inst, 3, 2), kind: 'zone', noLabel: true, crit: false });
        }
      }
      const k = Math.min(1, (this.life - this.t) / 0.8);
      const n = Math.round(dt * 90 * k);
      for (let i = 0; i < n; i++) {
        world.fx.particle({
          x: this.x + G.rand.float(2, this.w - 2), y: this.bottom - 1, vx: G.rand.float(-10, 10), vy: -G.rand.float(30, 90) * (0.6 + 0.4 * k),
          life: G.rand.float(0.2, 0.55), color: G.rand.pick([PAL.orange, PAL.yellow, '#ff5a1f', PAL.red]), size: G.rand.int(1, 2), grav: -40, drag: 1, additive: true,
        });
      }
    }
    draw(ctx, cam) {
      const x = Math.round(this.x - cam.ox), y = Math.round(this.bottom - cam.oy);
      const k = Math.min(1, (this.life - this.t) / 0.8);
      ctx.globalAlpha = 0.9 * k;
      for (let i = 0; i < this.w; i += 2) {
        const h = 1 + Math.round((Math.sin(i * 1.7 + this.t * 14) * 0.5 + 0.5) * 3 * k);
        ctx.fillStyle = i % 4 ? '#ff5a1f' : PAL.yellow;
        ctx.fillRect(x + i, y - h, 2, h);
      }
      ctx.fillStyle = '#3a0d08'; ctx.fillRect(x, y - 1, this.w, 1);
      ctx.globalAlpha = 1;
    }
    drawLight(ctx, cam) {
      const k = Math.min(1, (this.life - this.t) / 0.8);
      for (let i = 0; i <= 3; i++) G.drawGlow(ctx, this.x + (this.w * i) / 3 - cam.ox, this.bottom - 6 - cam.oy, 34, PAL.orange, (0.45 + Math.sin(this.t * 20 + i) * 0.08) * k);
    }
  }
  G.FireZone = FireZone;

  // bear trap («Ловушка-капкан»)
  class Trap extends GroundThing {
    constructor(x, y, p, inst) {
      super(x, y, 16, 6);
      this.p = p; this.inst = inst; this.armed = false; this.snapT = 0; this.life = 40; this.victim = null;
    }
    update(dt, world) {
      this.t += dt;
      if (this.t > this.life) { this.dead = true; return; }
      if (this.snapT > 0) {
        this.snapT += dt;
        if (this.victim && !this.victim.dead) { this.victim.vx = 0; }
        if (this.snapT > 2.6) { this.dead = true; world.fx.burst(this.cx, this.cy, 8, { speed: 60, life: 0.4, color: ['#6f7299', '#45466a'], grav: 300 }); }
        return;
      }
      if (!this.armed) { if (this.t > 0.35) { this.armed = true; } return; }
      const box = { x: this.x + 2, y: this.y - 4, w: this.w - 4, h: this.h + 4 };
      for (const t of world.enemies) {
        if (t.dead || t.dying || !G.overlap(box, t)) continue;
        this.snapT = 0.001; this.victim = t;
        const dealt = G.weaponHit(world, this.p, this.inst, t, this.inst.def.dmg, { crit: isStunned(t), kb: 0, kbUp: 0, stun: 2.4, kind: 'trap' });
        if (dealt) {
          world.fx.sparks(this.cx, this.y, 1, 8, PAL.yellow); world.fx.sparks(this.cx, this.y, -1, 8, PAL.yellow);
          world.fx.splat(t.cx, t.bottom - 4, 1, 10, t.bloodColors);
          world.shake(3, 0.15); world.hitstop(0.06);
          world.fx.label(t.cx, t.y - 10, 'SNAP', PAL.red, 0.6);
        }
        snd('heavy', { pitch: 1.4 });
        break;
      }
    }
    draw(ctx, cam) {
      const x = Math.round(this.x - cam.ox), y = Math.round(this.bottom - cam.oy);
      const closed = this.snapT > 0;
      G.px.rect(ctx, x + 1, y - 2, 14, 2, '#2b2a45');
      G.px.rect(ctx, x + 5, y - 3, 6, 1, '#45466a');
      if (closed) {
        for (let i = 0; i < 6; i++) G.px.rect(ctx, x + 2 + i * 2, y - 7 + (i % 2), 1, 5, i % 2 ? '#aab0d6' : '#6f7299');
        G.px.rect(ctx, x + 2, y - 8, 12, 1, '#6f7299');
      } else {
        G.px.rect(ctx, x, y - 3, 3, 1, '#6f7299'); G.px.rect(ctx, x + 13, y - 3, 3, 1, '#6f7299');
        for (let i = 0; i < 3; i++) { G.px.rect(ctx, x + i, y - 5 - i, 1, 2, '#aab0d6'); G.px.rect(ctx, x + 15 - i, y - 5 - i, 1, 2, '#aab0d6'); }
      }
      const blink = !closed && this.armed && Math.floor(this.t * 3) % 2 === 0;
      G.px.rect(ctx, x + 7, y - 4, 2, 1, blink ? PAL.red : '#5a1020');
    }
    drawLight(ctx, cam) { if (this.armed && this.snapT === 0) G.drawGlow(ctx, this.cx - cam.ox, this.bottom - 4 - cam.oy, 10, PAL.red, 0.4 + 0.3 * (Math.floor(this.t * 3) % 2)); }
  }
  G.Trap = Trap;

  // generic proximity mine (used by the «Кинетический отскок» mutation)
  class ShockMine extends GroundThing {
    constructor(x, y, o = {}) {
      super(x, y, 8, 4);
      this.dmg = o.dmg || 12; this.life = o.life || 8; this.radius = o.radius || 30; this.color = o.color || PAL.cyan;
    }
    update(dt, world) {
      this.t += dt;
      if (this.t > this.life) { this.dead = true; return; }
      if (this.t < 0.25) return;
      const box = { x: this.x - 4, y: this.y - 8, w: this.w + 8, h: this.h + 10 };
      for (const t of world.enemies) {
        if (t.dead || t.dying || !G.overlap(box, t)) continue;
        this.dead = true;
        const hits = G.explode(world, this.cx, this.cy - 4, { radius: this.radius, dmg: this.dmg, color: this.color, info: { kb: 90, kbUp: 120, stun: 0.6, status: G.ST.shock(3) } });
        const p = world.player;
        if (p) for (const h of hits) p.onDealDamage(h.lastDealt || 0, h, null);
        snd('shock');
        break;
      }
    }
    draw(ctx, cam) {
      const x = Math.round(this.x - cam.ox), y = Math.round(this.y - cam.oy);
      G.px.rect(ctx, x, y + 1, 8, 3, '#2b2a45');
      G.px.rect(ctx, x + 2, y, 4, 1, '#45466a');
      G.px.rect(ctx, x + 3, y + 1, 2, 1, Math.floor(this.t * 6) % 2 ? this.color : '#0e8fa6');
    }
    drawLight(ctx, cam) { G.drawGlow(ctx, this.cx - cam.ox, this.cy - cam.oy, 12, this.color, 0.4); }
  }
  G.ShockMine = ShockMine;

  // ================================================================ allies (world.allies)
  class Ally extends G.Actor {
    constructor(x, y, w, h, o) {
      super(x - w / 2, y - h, w, h);
      this.team = 'player'; this.isAlly = true; this.kbRes = 1; this.stunRes = 1;
      this.life = 20; this.age = 0;
      Object.assign(this, o);
      this.maxHp = this.hp;
    }
    takeDamage(amount, info = {}) {
      const d = super.takeDamage(amount, Object.assign({}, info, { kb: 0, kbUp: 0, stun: 0, status: null }));
      if (d) snd('hitArmor', { vol: 0.4 });
      return d;
    }
    die() { if (this.dead) return; this.dead = true; this.boom(G.world, true); }
    boom(world, destroyed) {
      if (!world) return;
      world.fx.burst(this.cx, this.cy, destroyed ? 18 : 10, { speed: 120, life: 0.45, color: [this.color || PAL.cyan, '#ffffff', '#45466a'], shape: 'spark', grav: 300, additive: true });
      world.fx.burst(this.cx, this.cy, 6, { speed: 60, life: 0.7, color: ['#2a2438', '#3b3350'], size: [1, 3], grav: -30, drag: 2, shape: 'disc', shrink: true });
      world.flashLights.push({ x: this.cx, y: this.cy, r: 40, color: this.color || PAL.cyan, t: 0, life: 0.15 });
      if (destroyed) snd('explosion', { vol: 0.35, pitch: 1.4 });
    }
    update(dt, world) {
      this.tickTimers(dt);
      this.age += dt;
      if (this.age >= this.life) { this.dead = true; this.onExpire(world); return; }
      this.think(dt, world);
    }
    onExpire(world) { this.boom(world, false); }
    think() {}
    nearestEnemy(world, range, x = this.cx, y = this.cy, los = true) {
      let best = null, bd = range;
      for (const e of world.enemies) {
        if (e.dead || e.dying) continue;
        const d = G.dist(x, y, e.cx, e.cy);
        if (d >= bd) continue;
        if (los && !world.level.lineClear(x, y, e.cx, e.cy)) continue;
        bd = d; best = e;
      }
      return best;
    }
    drawHp(ctx, cam) {
      if (this.hp >= this.maxHp) return;
      const x = Math.round(this.cx - 7 - cam.ox), y = Math.round(this.y - 5 - cam.oy);
      G.px.rect(ctx, x - 1, y - 1, 16, 3, PAL.ink);
      G.px.rect(ctx, x, y, Math.max(1, Math.round(14 * this.hp / this.maxHp)), 1, PAL.green);
    }
  }
  G.Ally = Ally;

  class Turret extends Ally {
    constructor(x, y, o) {
      super(x, y, 12, 13, Object.assign({ color: PAL.cyan }, o));
      this.aim = o.p.facing > 0 ? 0 : Math.PI; this.cool = 0.5; this.deployT = 0; this.recoil = 0; this.target = null;
    }
    think(dt, world) {
      this.physics(dt, world.level); this.vx = 0;
      this.deployT += dt;
      if (this.recoil > 0) this.recoil -= dt * 8;
      if (this.deployT < 0.35) return;
      this.cool -= dt;
      const mx = this.cx, my = this.y + 4;
      const tgt = this.nearestEnemy(world, 190, mx, my);
      this.target = tgt;
      if (tgt) {
        const a = Math.atan2(tgt.cy - my, tgt.cx - mx);
        this.aim = G.angleLerp(this.aim, a, Math.min(1, dt * 14));
        let diff = Math.abs(((a - this.aim + Math.PI * 3) % TAU) - Math.PI);
        if (this.cool <= 0 && diff < 0.25) {
          this.cool = 0.5; this.recoil = 1;
          const c = Math.cos(this.aim), s = Math.sin(this.aim);
          const x = mx + c * 9, y = my + s * 9;
          shoot(world, this.p, this.inst, { x, y, vx: c * 400, vy: s * 400, r: 2, life: 0.7, color: PAL.cyan, len: 6, base: this.inst.def.dmg, noLabel: true, hitOpts: { kb: 30, stun: 0 } });
          muzzleFlash(world, x, y, G.sign(c) || 1, PAL.cyan, 0.7);
          snd('turret', { vol: 0.6 });
        }
      } else {
        const base = this.p.facing > 0 ? 0 : Math.PI;
        this.aim = G.angleLerp(this.aim, base + Math.sin(this.age * 1.5) * 0.5, Math.min(1, dt * 3));
      }
    }
    draw(ctx, cam) {
      const x = Math.round(this.x - cam.ox), y = Math.round(this.y - cam.oy);
      const k = Math.min(1, this.deployT / 0.35);
      const w = this.flash > 0 ? '#ffffff' : null;
      // tripod
      G.px.line(ctx, x + 6, y + 8, x + 1, y + 13, w || '#2b2a45', 2);
      G.px.line(ctx, x + 6, y + 8, x + 11, y + 13, w || '#2b2a45', 2);
      G.px.rect(ctx, x + 5, y + 7, 3, 6, w || '#45466a');
      // head
      const hy = y + Math.round(8 - 7 * k);
      G.px.rect(ctx, x + 1, hy - 1, 10, 7, PAL.ink);
      G.px.rect(ctx, x + 2, hy, 8, 5, w || '#45466a');
      G.px.rect(ctx, x + 2, hy, 8, 1, w || '#6f7299');
      const c = Math.cos(this.aim), s = Math.sin(this.aim), bl = 7 - Math.round(this.recoil * 2);
      G.px.line(ctx, x + 6, hy + 2, x + 6 + c * bl, hy + 2 + s * bl, w || '#aab0d6', 2);
      const eye = this.target ? PAL.red : PAL.cyan;
      G.px.rect(ctx, x + 6 + (c > 0 ? 1 : -3), hy + 1, 2, 2, eye);
      this.drawHp(ctx, cam);
      // remaining life bar
      G.px.rect(ctx, x + 2, y + 14, Math.max(0, Math.round(8 * (1 - this.age / this.life))), 1, PAL.cyan);
    }
    drawLight(ctx, cam) { G.drawGlow(ctx, this.cx - cam.ox, this.y + 3 - cam.oy, 18, this.target ? PAL.red : PAL.cyan, 0.45); }
  }
  G.AllyTurret = Turret;

  class Drone extends Ally {
    constructor(x, y, o) {
      super(x, y, 8, 6, Object.assign({ color: PAL.magenta }, o));
      this.noGravity = true; this.ang = G.rand.float(0, TAU); this.cool = 0.4; this.target = null; this.beamT = 0;
    }
    think(dt, world) {
      const p = this.p;
      this.ang += dt * 2.4;
      const tx = p.cx + Math.cos(this.ang) * 22 - this.w / 2, ty = p.y - 14 + Math.sin(this.ang * 2) * 4 - this.h / 2;
      this.x = G.lerp(this.x, tx, Math.min(1, dt * 5)); this.y = G.lerp(this.y, ty, Math.min(1, dt * 5));
      this.cool -= dt; if (this.beamT > 0) this.beamT -= dt;
      const tgt = this.nearestEnemy(world, 150);
      this.target = tgt;
      if (tgt && this.cool <= 0) {
        this.cool = 0.6; this.beamT = 0.1;
        const dealt = G.weaponHit(world, p, this.inst, tgt, this.inst.def.dmg, { kb: 20, stun: 0.08, kind: 'skill', noLabel: true, dir: G.sign(tgt.cx - this.cx) || 1 });
        addBeam(world, this.cx, this.cy + 1, tgt.cx, tgt.cy, { color: PAL.magenta, width: 2, life: 0.12 });
        if (dealt) world.fx.sparks(tgt.cx, tgt.cy, G.sign(tgt.cx - this.cx) || 1, 5, PAL.magenta);
        snd('laser', { vol: 0.4, pitch: 1.5 });
      }
      if (G.rand.chance(dt * 10)) world.fx.particle({ x: this.cx, y: this.bottom, vy: 40, life: 0.25, color: PAL.magenta, additive: true });
    }
    draw(ctx, cam) {
      const x = Math.round(this.x - cam.ox), y = Math.round(this.y - cam.oy);
      const w = this.flash > 0 ? '#ffffff' : null, blink = Math.floor(this.age * 20) % 2;
      G.px.rect(ctx, x - 1, y, 10, 5, PAL.ink);
      G.px.rect(ctx, x, y + 1, 8, 3, w || '#45466a');
      G.px.rect(ctx, x + 1, y + 1, 6, 1, w || '#6f7299');
      G.px.rect(ctx, x - 3, y - 1, 5, 1, blink ? '#aab0d6' : '#45466a');
      G.px.rect(ctx, x + 6, y - 1, 5, 1, blink ? '#45466a' : '#aab0d6');
      G.px.rect(ctx, x + 3, y + 3, 2, 2, this.target ? PAL.red : PAL.magenta);
      this.drawHp(ctx, cam);
    }
    drawLight(ctx, cam) { G.drawGlow(ctx, this.cx - cam.ox, this.cy + 2 - cam.oy, 18, PAL.magenta, 0.5 + (this.beamT > 0 ? 0.4 : 0)); }
  }
  G.AllyDrone = Drone;

  // hologram double: stuns nearby enemies on spawn, sets world.decoy (enemies may target it), bursts on expiry
  class Decoy extends Ally {
    constructor(x, y, o) {
      super(x, y, 10, 22, Object.assign({ color: PAL.cyan }, o));
      this.facing = o.p.facing;
      const p = o.p;
      this.J = null;
      if (p.joints && p.buildPose) {
        const J = p.joints(p.buildPose()), dx = this.cx - p.cx, dy = this.bottom - p.bottom;
        this.J = {};
        for (const k in J) if (Array.isArray(J[k])) this.J[k] = [J[k][0] + dx, J[k][1] + dy];
      }
    }
    think(dt, world) {
      this.physics(dt, world.level); this.vx = 0;
      world.decoy = this;
      if (G.rand.chance(dt * 12)) world.fx.particle({ x: this.x + G.rand.float(0, this.w), y: this.y + G.rand.float(0, this.h), vy: -30, life: 0.4, color: PAL.cyan, additive: true });
    }
    burst(world) {
      if (world.decoy === this) world.decoy = null;
      const hits = [];
      for (const t of world.enemies) {
        if (t.dead || t.dying || G.dist(t.cx, t.cy, this.cx, this.cy) > 56) continue;
        if (G.weaponHit(world, this.p, this.inst, t, this.inst.def.dmg, { kb: 160, kbUp: 100, stun: 0.6, status: G.ST.shock(4), kind: 'skill' })) hits.push(t);
      }
      world.fx.ring(this.cx, this.cy, 4, 56, PAL.cyan, 0.35, 2);
      world.fx.burst(this.cx, this.cy, 30, { speed: 220, life: 0.5, color: [PAL.cyan, PAL.violet, '#ffffff'], shape: 'spark', grav: 0, additive: true });
      world.flashLights.push({ x: this.cx, y: this.cy, r: 100, color: PAL.cyan, t: 0, life: 0.25 });
      world.shake(3, 0.2);
      snd('emp', { vol: 0.7 });
    }
    onExpire(world) { this.burst(world); }
    die() { if (this.dead) return; this.dead = true; if (G.world) this.burst(G.world); }
    draw(ctx, cam) {
      const p = this.p, a = 0.45 + Math.sin(this.age * 30) * 0.1 + (G.rand.chance(0.08) ? 0.3 : 0);
      ctx.globalAlpha = Math.max(0.15, a);
      const glitch = G.rand.chance(0.1) ? G.rand.int(-2, 2) : 0;
      if (this.J && p.drawSkeleton) {
        const pf = p.facing;
        p.facing = this.facing;
        p.drawSkeleton(ctx, this.J, cam.ox - glitch, cam.oy, this.flash > 0 ? '#ffffff' : PAL.cyan, false);
        p.facing = pf;
      } else G.px.rect(ctx, this.x - cam.ox, this.y - cam.oy, this.w, this.h, PAL.cyan);
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = PAL.ink;
      const x = Math.round(this.x - cam.ox) - 4, y = Math.round(this.y - cam.oy) - 6;
      for (let yy = (Math.floor(this.age * 20) % 3); yy < this.h + 8; yy += 3) ctx.fillRect(x, y + yy, this.w + 8, 1);
      ctx.globalAlpha = 1;
      this.drawHp(ctx, cam);
    }
    drawLight(ctx, cam) { G.drawGlow(ctx, this.cx - cam.ox, this.cy - cam.oy, 30, PAL.cyan, 0.35); }
  }
  G.AllyDecoy = Decoy;

  // overload aura that follows the player while the buff lasts
  class Aura extends Effect {
    update(dt, world) {
      this.t += dt;
      const p = this.p;
      if (this.t >= this.life || !p || p.state === 'dead' || !(p.overloadUntil > G.game.runTime)) { this.dead = true; return; }
      this.x = p.cx; this.y = p.cy;
      if (G.rand.chance(dt * 40)) world.fx.particle({ x: p.x + G.rand.float(-2, p.w + 2), y: p.bottom - G.rand.float(0, p.h), vx: G.rand.float(-10, 10), vy: -G.rand.float(30, 70), life: 0.35, color: G.rand.pick([PAL.red, PAL.magenta, '#ffffff']), additive: true, glow: 4 });
    }
    draw(ctx, cam) {
      if (Math.floor(this.t * 12) % 3) return;
      const p = this.p, x = Math.round(p.cx - cam.ox), y = Math.round(p.cy - cam.oy);
      G.px.ring(ctx, x, y, 13 + Math.round(Math.sin(this.t * 9) * 1.5), PAL.red, 1);
    }
    drawLight(ctx, cam) { G.drawGlow(ctx, this.x - cam.ox, this.y - cam.oy, 40, PAL.red, 0.35 + Math.sin(this.t * 10) * 0.08); }
  }

  // virus spreads from dying hosts to enemies nearby (any source of virus)
  G.on('enemyKilled', (e) => {
    const en = e && e.enemy, w = G.world;
    if (!en || !w || !en.statuses) return;
    const v = en.statuses.virus;
    if (!v) return;
    const nodes = [];
    for (const o of w.enemies) {
      if (o === en || o.dying || o.dead || G.dist(o.cx, o.cy, en.cx, en.cy) > 90) continue;
      o.applyStatus('virus', Math.max(4, v.t + 2), v.power);
      const s = o.statuses.virus;
      if (s) s.stacks = Math.max(s.stacks || 1, Math.max(1, (v.stacks || 1) - 1));
      nodes.push(o);
    }
    for (const o of nodes) addBolt(w, [[en.cx, en.cy], [o.cx, o.cy]], { color: PAL.lime, amp: 3, life: 0.3 });
    if (nodes.length) w.fx.burst(en.cx, en.cy, 16, { speed: 90, life: 0.6, color: [PAL.lime, '#1a7a2a'], grav: 0, additive: true });
  });

  // ================================================================ helpers used by the roster
  const TOW = (p, a) => (p.facing > 0 ? a : Math.PI - a);
  const fwdDist = (p, t) => (p.facing > 0 ? t.x - p.cx : p.cx - (t.x + t.w)); // distance to the target's near edge
  const behind = (p, t) => t.facing === p.facing && G.sign(t.cx - p.cx) === p.facing;

  function throwGrenade(world, p, inst, o) {
    const x = p.cx + p.facing * 6, y = p.y + 4;
    world.addProjectile(new G.Projectile(Object.assign({
      x, y, vx: p.facing * (o.speed || 190) + p.vx * 0.4, vy: o.vy || -170, grav: o.grav || 700, r: 3, life: o.fuse || 2.2, team: 'player',
      color: o.color || PAL.orange, dmg: 0, pierce: 99, bounce: o.bounce || 0, spin: 0,
      drawFn(ctx, cam, pr) {
        pr.spin += 0.3;
        G.drawSprite(ctx, 'grenade', pr.x - cam.ox, pr.y - cam.oy, pr.spin, false, 1);
        const blink = (pr.t * (8 + pr.t * 12) | 0) % 2;
        ctx.fillStyle = blink ? pr.color : '#ffffff';
        ctx.fillRect(Math.round(pr.x - cam.ox), Math.round(pr.y - cam.oy) - 2, 1, 1);
      },
      drawLight(ctx, cam) { G.drawGlow(ctx, this.x - cam.ox, this.y - cam.oy, 10, this.color, 0.6); },
      hit(t, w) { this.boom(w); return true; },
      boom(w) { if (this.done) return; this.done = true; this.dead = true; o.boom(w, this.x, this.y, this); },
      onWall(w) { if (this.bounce) return; this.boom(w); },
      onExpire(w) { this.boom(w); },
    }, o.extra || {})));
    snd('grenade');
  }
  // world position of the player's hand (from the last rendered pose)
  const handPos = (p) => (p._lastJ ? { x: p._lastJ.handF[0], y: p._lastJ.handF[1] } : { x: p.cx + p.facing * 7, y: p.y + 10 });

  // ================================================================ ROSTER
  // DPS targets (tier 0, 1 stat): melee ~45–55 base, ranged ~35–45 base; crit conditions add +40–80 %.

  // ---------------------------------------------------------------- MELEE
  G.defineItem({
    id: 'katana', name: 'Ржавая катана', kind: 'melee', stat: 'brutality', start: true, drop: 0.6,
    desc: 'Три быстрых удара. Третий удар всегда критический.', trail: PAL.cyan,
    combo: [
      { wind: 0.07, active: 0.08, rec: 0.2, dmg: 10, reach: 27, h: 20, yOff: -2, arc: [-1.6, 0.9], lunge: 70, kb: 70, sfx: 'slash1' },
      { wind: 0.07, active: 0.08, rec: 0.2, dmg: 11, reach: 27, h: 20, yOff: -2, arc: [1.0, -1.4], lunge: 70, kb: 70, sfx: 'slash2' },
      { wind: 0.11, active: 0.09, rec: 0.32, dmg: 15, reach: 31, h: 24, yOff: -4, arc: [-2.0, 1.2], lunge: 120, kb: 170, stun: 0.3, sfx: 'slash3', trailW: 7, crit: () => true, shake: 3 },
    ],
    drawHeld: spriteHeld('katana'),
    drawIcon: icon((I) => {
      I.line(2, 22, 6, 18, '#3a2352', 2); I.dot(3, 20, '#6a4a8a'); I.dot(5, 18, '#6a4a8a');
      I.line(5, 15, 9, 19, '#ffe14d', 1); I.line(6, 15, 9, 18, '#b38a1a', 1);
      I.line(8, 15, 20, 3, '#d4e2f0', 1); I.line(8, 16, 21, 3, '#9fb3c8', 1); I.line(9, 16, 21, 4, '#27f3ff', 1);
      I.dot(12, 12, '#8a4a2a'); I.dot(15, 9, '#8a4a2a'); I.dot(13, 11, '#5a2e1a'); I.dot(21, 3, '#ffffff');
    }),
  });

  G.defineItem({
    id: 'whip', name: 'Мономолекулярная нить', kind: 'melee', stat: 'tactics', drop: 1,
    desc: 'Очень длинные хлёсткие удары. Попадание кончиком нити — критическое (x2).', trail: PAL.cyan, critMul: 2,
    action: WhipAction, noSlash: true,
    combo: [
      { wind: 0.1, active: 0.08, rec: 0.25, dmg: 12, reach: 62, h: 14, yOff: 3, arc: [-0.6, 0.05], lunge: 20, kb: 60, stun: 0.15, sfx: 'whip' },
      { wind: 0.1, active: 0.08, rec: 0.25, dmg: 12, reach: 62, h: 14, yOff: 3, arc: [0.5, -0.05], lunge: 20, kb: 60, stun: 0.15, sfx: 'whip', pitch: 1.15 },
    ],
    crit: (p, t) => fwdDist(p, t) > 34,
    onHit(act, t, world, crit) { if (crit) { world.fx.ring(t.cx, t.cy, 2, 12, PAL.cyan, 0.2, 1); } },
    drawHeld(ctx, x, y, ang, p, inst, sc = 1) {
      G.drawSprite(ctx, 'whip', x, y, ang, flipOf(p), sc);
      if (p && !(p.act && p.act.inst === inst)) {
        // idle: the filament hangs coiled from the emitter
        const c = Math.cos(ang), s = Math.sin(ang), ex = x + c * 4, ey = y + s * 4;
        for (let i = 0; i < 6; i++) { ctx.fillStyle = i % 2 ? PAL.cyan : '#0e8fa6'; ctx.fillRect(Math.round(ex + Math.sin(i + p.t * 3) * 1.5), Math.round(ey + i), 1, 1); }
      }
      heldLight(x, y, ang, 4, 10, PAL.cyan, 0.4);
    },
    drawIcon: icon((I) => {
      I.line(3, 21, 7, 17, '#3a2352', 2); I.rect(7, 15, 3, 3, '#6f7299'); I.dot(9, 15, '#27f3ff');
      I.poly([[10, 15], [12, 9], [16, 5], [20, 5], [21, 9], [18, 13], [14, 14], [12, 18], [14, 21]], '#27f3ff');
      I.poly([[11, 12], [13, 8]], '#ffffff'); I.dot(14, 21, '#ffffff'); I.dot(15, 20, '#9ffcff');
    }),
  });

  G.defineItem({
    id: 'fists', name: 'Кибер-кастеты', kind: 'melee', stat: 'brutality', drop: 1,
    desc: 'Молниеносная серия из пяти ударов. Апперкот оглушает; удары по оглушённым — критические.', trail: PAL.magenta, critMul: 1.9,
    noSlash: true,
    combo: [
      { wind: 0.03, active: 0.05, rec: 0.12, dmg: 6, reach: 25, h: 14, yOff: 3, arc: [0.05, 0], lunge: 40, kb: 35, stun: 0, sfx: 'stab', pitch: 1.3, punch: true, streak: 2 },
      { wind: 0.03, active: 0.05, rec: 0.12, dmg: 6, reach: 25, h: 14, yOff: 2, arc: [-0.1, -0.1], lunge: 40, kb: 35, stun: 0, sfx: 'stab', pitch: 1.45, punch: true, streak: 2, twoHand: true },
      { wind: 0.03, active: 0.05, rec: 0.12, dmg: 6, reach: 25, h: 14, yOff: 3, arc: [0.05, 0], lunge: 40, kb: 35, stun: 0, sfx: 'stab', pitch: 1.3, punch: true, streak: 2 },
      { wind: 0.03, active: 0.05, rec: 0.12, dmg: 7, reach: 25, h: 14, yOff: 2, arc: [-0.1, -0.1], lunge: 40, kb: 35, stun: 0, sfx: 'stab', pitch: 1.45, punch: true, streak: 2, twoHand: true },
      { wind: 0.09, active: 0.07, rec: 0.32, dmg: 12, reach: 27, h: 22, yOff: -4, arc: [0.9, -1.3], lunge: 110, lungeUp: 60, kb: 190, kbUp: 170, stun: 1.2, sfx: 'heavy', shake: 3.5, hitstop: 0.08, noSlash: false, trailW: 4, windBack: 0.2 },
    ],
    crit: (p, t) => isStunned(t),
    onHit(act, t, world) { world.fx.ring(t.cx - act.p.facing * 4, act.p.y + 9, 1, act.i === 4 ? 16 : 7, PAL.magenta, 0.15, 1); },
    drawHeld(ctx, x, y, ang, p, inst, sc = 1) {
      const J = p && p._lastJ;
      if (J) G.drawSprite(ctx, 'fistB', J.handB[0] + (x - J.handF[0]), J.handB[1] + (y - J.handF[1]), ang, flipOf(p), sc);
      G.drawSprite(ctx, 'fist', x, y, ang, flipOf(p), sc);
      heldLight(x, y, ang, 2, 8, PAL.magenta, 0.35);
    },
    drawIcon: icon((I) => {
      I.rect(7, 17, 10, 5, '#2b2a45'); I.rect(7, 18, 10, 1, '#ff2a8a');
      I.rect(4, 8, 16, 10, '#45466a'); I.rect(5, 9, 14, 1, '#6f7299'); I.rect(3, 11, 4, 5, '#6f7299');
      for (let i = 0; i < 4; i++) { I.rect(5 + i * 4, 4, 3, 5, '#aab0d6'); I.rect(6 + i * 4, 5, 1, 3, '#ff2a8a'); }
      I.rect(8, 13, 9, 1, '#2b2a45');
    }),
  });

  G.defineItem({
    id: 'hammer', name: 'Гидромолот', kind: 'melee', stat: ['brutality', 'survival'], drop: 0.8, blueprint: true, unlockCost: 30,
    desc: 'Медленные сокрушительные удары с ударной волной по земле. Критический урон по оглушённым.', trail: PAL.yellow, twoHand: true,
    combo: [
      { wind: 0.3, active: 0.1, rec: 0.45, dmg: 22, reach: 32, h: 30, yOff: -8, arc: [-2.5, 1.25], lunge: 40, kb: 150, kbUp: 60, stun: 0.9, sfx: 'heavy', trailW: 8, shake: 4, hitstop: 0.08, windBack: 0.5, onStart: hammerWave },
      { wind: 0.27, active: 0.1, rec: 0.5, dmg: 26, reach: 32, h: 30, yOff: -8, arc: [-2.5, 1.25], lunge: 50, kb: 180, kbUp: 90, stun: 0.9, sfx: 'heavy', pitch: 0.85, trailW: 8, shake: 4.5, hitstop: 0.09, windBack: 0.5, onStart: hammerWave },
    ],
    crit: (p, t) => isStunned(t),
    drawHeld(ctx, x, y, ang, p, inst, sc = 1) { G.drawSprite(ctx, 'hammer', x, y, ang, flipOf(p), sc); heldLight(x, y, ang, 16, 10, PAL.cyan, 0.35); },
    drawIcon: icon((I) => {
      I.rect(11, 10, 3, 13, '#2b2a45'); I.rect(11, 16, 3, 1, '#6f7299'); I.rect(11, 19, 3, 1, '#6f7299'); I.rect(12, 10, 1, 13, '#45466a');
      I.rect(3, 3, 18, 8, '#45466a'); I.rect(3, 3, 18, 1, '#aab0d6'); I.rect(3, 3, 3, 8, '#6f7299'); I.rect(18, 3, 3, 8, '#6f7299');
      I.rect(8, 5, 8, 4, '#0e8fa6'); I.rect(9, 6, 6, 2, '#27f3ff'); I.rect(3, 10, 18, 1, '#2b2a45');
      I.rect(7, 11, 1, 3, '#6f7299'); I.rect(16, 11, 1, 3, '#6f7299');
    }),
  });
  function hammerWave(act, world) {
    const p = act.p, x = p.cx + p.facing * 24;
    const gy = world.level.groundBelow(x, p.y + 4, 40);
    if (gy == null) return;
    world.projectiles.push(new GroundWave({ x, y: gy, dir: p.facing, p, inst: act.inst, base: 9, hitSet: act.hitSet }));
    world.fx.ring(x, gy, 3, 26, PAL.yellow, 0.25, 1);
    world.fx.burst(x, gy - 1, 14, { angle: -Math.PI / 2, spread: 1.2, speed: 160, life: 0.4, color: ['#6f7299', '#aab0d6', PAL.yellow], grav: 500 });
    world.flashLights.push({ x, y: gy, r: 60, color: PAL.yellow, t: 0, life: 0.18 });
  }
  // shockwave travelling along the floor; shares the swing's hitSet
  class GroundWave extends Effect {
    constructor(o) { super(Object.assign({ life: 0.42, speed: 250, h: 14, team: 'player' }, o)); }
    update(dt, world) {
      this.t += dt;
      if (this.t >= this.life) { this.dead = true; return; }
      const L = world.level;
      const nx = this.x + this.dir * this.speed * dt;
      const gy = L.groundBelow(nx, this.y - 10, 24);
      if (gy == null || L.solidAt(nx, this.y - 6)) { this.dead = true; return; }
      this.x = nx; this.y = gy;
      const box = { x: this.x - 6, y: this.y - this.h, w: 12, h: this.h };
      for (const t of world.enemies) {
        if (t.dead || t.dying || this.hitSet.has(t.id) || !G.overlap(box, t)) continue;
        this.hitSet.add(t.id);
        G.weaponHit(world, this.p, this.inst, t, this.base, { dir: this.dir, kb: 60, kbUp: 170, stun: 0.45, crit: isStunned(t), kind: 'wave' });
      }
      if (G.rand.chance(0.8)) world.fx.particle({ x: this.x + G.rand.float(-3, 3), y: this.y - 1, vx: G.rand.float(-20, 20), vy: -G.rand.float(40, 120), life: 0.3, color: G.rand.pick([PAL.yellow, '#ffffff', '#6f7299']), grav: 300, additive: true });
    }
    draw(ctx, cam) {
      const k = 1 - this.t / this.life, x = Math.round(this.x - cam.ox), y = Math.round(this.y - cam.oy);
      for (let i = -2; i <= 2; i++) {
        const h = Math.max(1, Math.round((this.h - Math.abs(i) * 4) * k));
        ctx.fillStyle = i === 0 ? '#ffffff' : PAL.yellow;
        ctx.fillRect(x + i * 2 - this.dir * 2, y - h, 1, h);
      }
    }
    drawLight(ctx, cam) { G.drawGlow(ctx, this.x - cam.ox, this.y - 6 - cam.oy, 22, PAL.yellow, 0.6 * (1 - this.t / this.life)); }
  }

  G.defineItem({
    id: 'daggers', name: 'Парные ножи', kind: 'melee', stat: 'tactics', drop: 1,
    desc: 'Быстрые уколы двумя клинками. Удар в спину — критический (x2.2).', trail: PAL.violet, critMul: 2.2,
    combo: [
      { wind: 0.04, active: 0.05, rec: 0.14, dmg: 6, reach: 26, h: 16, yOff: 2, arc: [-0.35, 0.25], lunge: 60, kb: 30, stun: 0.1, sfx: 'stab', streak: 2, noSlash: true },
      { wind: 0.04, active: 0.05, rec: 0.14, dmg: 6, reach: 26, h: 16, yOff: 2, arc: [0.3, -0.2], lunge: 60, kb: 30, stun: 0.1, sfx: 'stab', pitch: 1.2, streak: 2, noSlash: true },
      { wind: 0.04, active: 0.05, rec: 0.14, dmg: 6, reach: 26, h: 16, yOff: 2, arc: [-0.35, 0.25], lunge: 60, kb: 30, stun: 0.1, sfx: 'stab', streak: 2, noSlash: true },
      { wind: 0.06, active: 0.06, rec: 0.22, dmg: 10, reach: 28, h: 20, yOff: -1, arc: [-1.3, 0.8], lunge: 100, kb: 90, stun: 0.25, sfx: 'slash2', trailW: 4 },
    ],
    crit: (p, t) => behind(p, t),
    onHit(act, t, world, crit) { if (crit) world.fx.label(t.cx, t.y - 24, 'BACKSTAB', PAL.violet, 0.5); },
    drawHeld(ctx, x, y, ang, p, inst, sc = 1) {
      const J = p && p._lastJ;
      if (J) G.drawSprite(ctx, 'dagger', J.handB[0] + (x - J.handF[0]), J.handB[1] + (y - J.handF[1]), ang + (p.facing > 0 ? 0.6 : -0.6), flipOf(p), sc);
      G.drawSprite(ctx, 'dagger', x, y, ang, flipOf(p), sc);
    },
    drawIcon: icon((I) => {
      I.line(3, 21, 6, 18, '#3a2352', 2); I.line(4, 15, 9, 20, '#9b5cff', 1); I.line(7, 16, 17, 6, '#d4e2f0', 1); I.line(8, 16, 18, 6, '#9fb3c8', 1); I.line(9, 16, 18, 7, '#9b5cff', 1);
      I.line(21, 21, 18, 18, '#3a2352', 2); I.line(20, 15, 15, 20, '#9b5cff', 1); I.line(16, 16, 6, 6, '#d4e2f0', 1); I.line(16, 17, 6, 7, '#9fb3c8', 1);
      I.dot(18, 6, '#ffffff'); I.dot(6, 6, '#ffffff');
    }),
  });

  G.defineItem({
    id: 'spear', name: 'Энергокопьё', kind: 'melee', stat: ['brutality', 'tactics'], drop: 1,
    desc: 'Длинные выпады на безопасной дистанции. Третий выпад — критический.', trail: PAL.cyan,
    noSlash: true,
    combo: [
      { wind: 0.1, active: 0.07, rec: 0.2, dmg: 11, reach: 46, h: 10, yOff: 6, arc: [0.08, 0], lunge: 50, kb: 60, stun: 0.12, sfx: 'stab', streak: 3, windBack: -0.2 },
      { wind: 0.1, active: 0.07, rec: 0.2, dmg: 11, reach: 46, h: 10, yOff: 4, arc: [-0.05, -0.08], lunge: 50, kb: 60, stun: 0.12, sfx: 'stab', pitch: 1.15, streak: 3, windBack: -0.2 },
      { wind: 0.16, active: 0.09, rec: 0.35, dmg: 18, reach: 54, h: 12, yOff: 5, arc: [0.05, 0], lunge: 150, kb: 190, stun: 0.4, sfx: 'stab', pitch: 0.8, streak: 5, crit: () => true, shake: 3, windBack: -0.3 },
    ],
    drawHeld(ctx, x, y, ang, p, inst, sc = 1) {
      let dx = 0;
      if (p && p.act && p.act.inst === inst && p.act.phase === 'active') dx = 4;
      G.drawSprite(ctx, 'spear', x + Math.cos(ang) * dx, y + Math.sin(ang) * dx, ang, flipOf(p), sc);
      heldLight(x, y, ang, 21 + dx, 12, PAL.cyan, 0.5);
    },
    drawIcon: icon((I) => {
      I.line(2, 22, 15, 9, '#2b2a45', 2); I.line(3, 22, 15, 10, '#45466a', 1);
      I.line(13, 9, 16, 12, '#6f7299', 1); I.dot(15, 9, '#aab0d6');
      I.disc(19, 5, 3, '#27f3ff'); I.line(16, 8, 22, 2, '#ffffff', 1); I.dot(19, 5, '#ffffff'); I.dot(21, 7, '#9ffcff'); I.dot(17, 3, '#9ffcff');
    }),
  });

  G.defineItem({
    id: 'axe', name: 'Плазменный топор', kind: 'melee', stat: 'brutality', drop: 0.8, blueprint: true, unlockCost: 25,
    desc: 'Тяжёлые удары поджигают. Второй удар по горящей цели — критический.', trail: PAL.orange,
    status: (p, inst) => G.ST.burn(p, inst, 3, 2),
    combo: [
      { wind: 0.14, active: 0.08, rec: 0.3, dmg: 14, reach: 30, h: 24, yOff: -4, arc: [-2.2, 1.0], lunge: 60, kb: 100, stun: 0.25, sfx: 'heavy', pitch: 1.2, trailW: 6, shake: 2 },
      { wind: 0.2, active: 0.1, rec: 0.4, dmg: 20, reach: 32, h: 26, yOff: -6, arc: [1.2, -1.8], lunge: 80, kb: 150, kbUp: 80, stun: 0.35, sfx: 'heavy', trailW: 7, shake: 3, crit: (p, t) => !!t.statuses.burn },
    ],
    onHit(act, t, world) { world.fx.burst(t.cx, t.cy, 8, { speed: 90, life: 0.4, color: [PAL.orange, PAL.yellow], grav: -80, additive: true }); snd('burn', { vol: 0.5 }); },
    drawHeld(ctx, x, y, ang, p, inst, sc = 1) { G.drawSprite(ctx, 'axe', x, y, ang, flipOf(p), sc); heldLight(x, y, ang, 14, 12, PAL.orange, 0.55); },
    drawIcon: icon((I) => {
      I.rect(9, 4, 2, 19, '#3a2352'); I.rect(9, 17, 2, 1, '#6a4a8a'); I.rect(9, 20, 2, 1, '#6a4a8a'); I.rect(8, 3, 4, 2, '#6f7299');
      I.rect(11, 4, 3, 8, '#45466a'); I.rect(11, 4, 3, 1, '#6f7299');
      for (let y = 2; y <= 14; y++) {
        const w = 3 + Math.round(6 * Math.sin((Math.PI * (y - 2)) / 12));
        I.rect(14, y, w, 1, '#ff8a2a'); I.dot(14 + w - 1, y, '#ffe14d'); if (w > 4) I.dot(15, y, '#b34a12');
      }
      I.dot(19, 8, '#ffffff');
    }),
  });

  G.defineItem({
    id: 'zwei', name: 'Вибро-меч', kind: 'melee', stat: ['brutality', 'survival'], drop: 0.7, blueprint: true, unlockCost: 45,
    desc: 'Тяжёлые рубящие удары. Удерживайте атаку, чтобы зарядить сокрушительный удар — полный заряд критический.',
    trail: PAL.magenta, twoHand: true, action: HeavyAction, chargeDelay: 0.16, chargeTime: 0.5,
    combo: [
      { wind: 0.2, active: 0.1, rec: 0.4, dmg: 18, reach: 36, h: 28, yOff: -6, arc: [-2.3, 1.1], lunge: 60, kb: 120, stun: 0.3, sfx: 'heavy', trailW: 7, shake: 2.5 },
      { wind: 0.2, active: 0.1, rec: 0.4, dmg: 22, reach: 36, h: 28, yOff: -6, arc: [1.1, -2.0], lunge: 60, kb: 140, stun: 0.3, sfx: 'heavy', pitch: 1.1, trailW: 7, shake: 2.5 },
    ],
    heavy: { wind: 0, active: 0.12, rec: 0.38, dmg: 50, reach: 46, h: 36, yOff: -10, arc: [-2.8, 1.4], lunge: 170, kb: 260, kbUp: 120, stun: 0.8, sfx: 'heavy', trailW: 11, shake: 5, hitstop: 0.12 },
    drawHeld(ctx, x, y, ang, p, inst, sc = 1) {
      G.drawSprite(ctx, 'zwei', x, y, ang, flipOf(p), sc);
      const ch = p && p.act && p.act.inst === inst ? p.act.charge || 0 : 0;
      heldLight(x, y, ang, 14, 12 + ch * 14, PAL.magenta, 0.3 + ch * 0.5);
    },
    drawIcon: icon((I) => {
      I.line(2, 22, 5, 19, '#3a2352', 2); I.line(3, 16, 8, 21, '#6f7299', 2);
      I.line(6, 16, 20, 2, '#d4e2f0', 1); I.line(6, 17, 21, 2, '#9fb3c8', 1); I.line(7, 17, 21, 3, '#9fb3c8', 1); I.line(8, 17, 22, 3, '#ff2a8a', 1);
      I.dot(21, 2, '#ffffff'); I.dot(12, 12, '#ff5cc8'); I.dot(16, 8, '#ff5cc8');
    }),
  });

  G.defineItem({
    id: 'baton', name: 'Шокер-дубинка', kind: 'melee', stat: 'survival', drop: 1,
    desc: 'Каждый удар бьёт током (+25% получаемого урона). Третий удар по шокированной цели — критический.', trail: PAL.cyan,
    status: () => G.ST.shock(2.5),
    combo: [
      { wind: 0.07, active: 0.07, rec: 0.2, dmg: 8, reach: 25, h: 20, yOff: -1, arc: [-1.5, 0.8], lunge: 50, kb: 60, stun: 0.2, sfx: 'slash1', pitch: 1.2 },
      { wind: 0.07, active: 0.07, rec: 0.2, dmg: 8, reach: 25, h: 20, yOff: -1, arc: [0.9, -1.2], lunge: 50, kb: 60, stun: 0.2, sfx: 'slash2', pitch: 1.2 },
      { wind: 0.1, active: 0.08, rec: 0.3, dmg: 13, reach: 27, h: 22, yOff: -3, arc: [-2.0, 1.0], lunge: 80, kb: 140, stun: 0.5, sfx: 'slash3', trailW: 6, shake: 2.5, crit: (p, t) => !!t.statuses.shock },
    ],
    onHit(act, t, world, crit) {
      const p = act.p, h = handPos(p);
      addBolt(world, [[h.x + p.facing * 10, h.y], [t.cx, t.cy]], { color: PAL.cyan, amp: 3, life: 0.12 });
      if (crit) { world.fx.burst(t.cx, t.cy, 14, { speed: 160, life: 0.3, color: [PAL.cyan, '#ffffff'], shape: 'spark', grav: 0, additive: true }); snd('shock', { vol: 0.7 }); }
    },
    drawHeld(ctx, x, y, ang, p, inst, sc = 1) {
      G.drawSprite(ctx, 'baton', x, y, ang, flipOf(p), sc);
      if (G.rand.chance(0.3)) {
        const c = Math.cos(ang), s = Math.sin(ang), tx = x + c * 13, ty = y + s * 13;
        ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(tx + G.rand.int(-1, 1)), Math.round(ty + G.rand.int(-1, 1)), 1, 1);
      }
      heldLight(x, y, ang, 13, 10, PAL.cyan, 0.45);
    },
    drawIcon: icon((I) => {
      I.line(3, 21, 7, 17, '#3a2352', 2); I.rect(6, 16, 3, 3, '#45466a');
      I.line(8, 16, 17, 7, '#6f7299', 2); I.line(9, 16, 17, 8, '#45466a', 1);
      I.line(16, 5, 19, 2, '#27f3ff', 1); I.line(19, 8, 22, 5, '#27f3ff', 1);
      I.poly([[18, 3], [20, 5], [19, 5], [21, 7]], '#ffffff'); I.dot(14, 11, '#27f3ff');
    }),
  });

  // ---------------------------------------------------------------- RANGED
  G.defineItem({
    id: 'pistol', name: 'Плазменный пистолет', kind: 'ranged', stat: 'tactics', start: true, drop: 0.6,
    desc: 'Быстрые плазменные заряды. Каждый третий выстрел в серии — критический.',
    wind: 0.06, rec: 0.2, recoil: 20, trail: PAL.magenta,
    fire(p, inst, world) {
      inst.streak = inst.lastShot != null && world.time - inst.lastShot < 0.75 && world.time >= inst.lastShot ? (inst.streak || 0) + 1 : 0;
      inst.lastShot = world.time;
      const crit = inst.streak % 3 === 2;
      const x = p.cx + p.facing * 13, y = p.y + 9;
      shoot(world, p, inst, { x, y, vx: p.facing * 430, vy: 0, r: 2, life: 0.8, color: PAL.magenta, len: crit ? 11 : 7, base: 10, crit, hitOpts: { kb: 40, stun: 0.06 }, spark: PAL.magenta });
      muzzleFlash(world, x, y, p.facing, crit ? PAL.yellow : PAL.magenta, crit ? 1.4 : 1);
      snd('shoot', { pitch: crit ? 0.8 : 1 });
    },
    drawHeld(ctx, x, y, ang, p, inst, sc = 1) { G.drawSprite(ctx, 'pistol', x, y, ang, flipOf(p), sc); heldLight(x, y, ang, 5, 8, PAL.magenta, 0.4); },
    drawIcon: icon((I) => {
      I.rect(3, 7, 15, 2, '#45466a'); I.rect(3, 9, 15, 4, '#3d3a5c'); I.rect(18, 9, 3, 2, '#6f7299');
      I.rect(5, 10, 10, 1, '#ff2a8a'); I.dot(16, 10, '#ffffff');
      I.rect(5, 13, 4, 3, '#1b1a2e'); I.rect(4, 15, 4, 5, '#1b1a2e'); I.rect(9, 13, 3, 1, '#2b2a45'); I.rect(11, 13, 1, 3, '#2b2a45');
    }),
  });

  G.defineItem({
    id: 'railgun', name: 'Рельсотрон', kind: 'ranged', stat: 'tactics', drop: 0.7, blueprint: true, unlockCost: 50,
    desc: 'Удерживайте для зарядки. Пробивающий луч насквозь; полный заряд — критический.',
    charge: { time: 0.9, min: 0.12, hold: 2 }, rec: 0.35, recoil: 140, trail: PAL.cyan, chargeColor: PAL.cyan, muzzle: [16, 8], moveMul: 0.25, twoHand: true,
    fire(p, inst, world, charge) {
      const full = charge >= 1;
      const x0 = p.cx + p.facing * 16, y0 = p.y + 8;
      const end = world.level.raycast(x0, y0, x0 + p.facing * 340, y0);
      const base = G.lerp(14, 52, charge);
      const box = { x: Math.min(x0, end.x), y: y0 - 4, w: Math.abs(end.x - x0), h: 8 };
      for (const t of world.enemies) {
        if (t.dead || t.dying || !G.overlap(box, t)) continue;
        const d = G.weaponHit(world, p, inst, t, base, { crit: full, dir: p.facing, kb: full ? 160 : 60, stun: full ? 0.4 : 0.1, kind: 'projectile' });
        if (d) { world.fx.sparks(t.cx, y0, p.facing, 10, PAL.cyan); world.fx.splat(t.cx, t.cy, p.facing, 8, t.bloodColors); }
      }
      addBeam(world, x0, y0, end.x, end.y, { color: full ? PAL.cyan : '#0e8fa6', width: full ? 5 : 2, life: full ? 0.24 : 0.14 });
      world.fx.sparks(end.x, end.y, -p.facing, 10, PAL.cyan);
      muzzleFlash(world, x0, y0, p.facing, PAL.cyan, full ? 2 : 1);
      if (full) { world.shake(4, 0.2); world.hitstop(0.04); world.fx.flash(PAL.cyan, 0.04); }
      snd(full ? 'rail' : 'laser');
    },
    drawHeld(ctx, x, y, ang, p, inst, sc = 1) {
      G.drawSprite(ctx, 'railgun', x, y, ang, flipOf(p), sc);
      const ch = p && p.act && p.act.inst === inst ? p.act.charge || 0 : 0;
      heldLight(x, y, ang, 10, 8 + 8 * ch, PAL.cyan, 0.3 + 0.5 * ch);
    },
    drawIcon: icon((I) => {
      I.rect(1, 10, 21, 4, '#45466a'); I.rect(1, 12, 4, 4, '#2b2a45'); I.rect(6, 7, 16, 1, '#27f3ff'); I.rect(6, 15, 16, 1, '#27f3ff');
      I.rect(6, 8, 16, 1, '#6f7299'); I.rect(6, 14, 16, 1, '#6f7299'); I.rect(10, 11, 7, 2, '#0e8fa6'); I.rect(11, 11, 5, 1, '#27f3ff');
      I.rect(8, 14, 3, 5, '#1b1a2e'); I.dot(22, 11, '#ffffff'); I.dot(22, 12, '#9ffcff');
    }),
  });

  G.defineItem({
    id: 'shotgun', name: 'Дробовик', kind: 'ranged', stat: 'brutality', drop: 1,
    desc: 'Веер из пяти зарядов с мощной отдачей. Выстрел в упор — критический.',
    wind: 0.08, rec: 0.55, recoil: 90, trail: PAL.orange, muzzle: [14, 9], twoHand: true,
    fire(p, inst, world) {
      const x = p.cx + p.facing * 14, y = p.y + 9;
      for (let i = 0; i < 5; i++) {
        const a = (i - 2) * 0.085 + G.rand.float(-0.04, 0.04);
        const sp = G.rand.float(380, 460);
        shoot(world, p, inst, {
          x, y, vx: Math.cos(a) * sp * p.facing, vy: Math.sin(a) * sp, r: 2, life: 0.34, color: PAL.orange, core: PAL.yellow, len: 5, glow: 6,
          base: 5, noLabel: true, critFn: (t, pr) => G.dist(pr.x0, pr.y0, pr.x, pr.y) < 50, hitOpts: { kb: 110, stun: 0.12 },
        });
      }
      muzzleFlash(world, x, y, p.facing, PAL.orange, 2);
      world.fx.burst(x + p.facing * 4, y, 8, { angle: p.facing > 0 ? 0 : Math.PI, spread: 0.6, speed: 60, life: 0.6, color: ['#3b3350', '#57507a'], size: [1, 2], grav: -30, drag: 3, shape: 'disc', shrink: true });
      shell(world, p.cx, y, p.facing, PAL.red);
      world.shake(2.5, 0.12);
      snd('shotgun');
    },
    drawHeld(ctx, x, y, ang, p, inst, sc = 1) { G.drawSprite(ctx, 'shotgun', x, y, ang, flipOf(p), sc); },
    drawIcon: icon((I) => {
      I.rect(1, 10, 6, 4, '#8a4a2a'); I.rect(1, 13, 3, 3, '#5a2e1a'); I.rect(7, 9, 7, 4, '#45466a'); I.rect(7, 9, 7, 1, '#6f7299');
      I.rect(14, 9, 9, 2, '#6f7299'); I.rect(14, 11, 9, 1, '#45466a'); I.rect(14, 12, 6, 2, '#b34a12'); I.rect(8, 13, 3, 4, '#1b1a2e');
      I.dot(22, 9, '#aab0d6');
    }),
  });

  G.defineItem({
    id: 'bow', name: 'Энерголук', kind: 'ranged', stat: 'tactics', drop: 1,
    desc: 'Удерживайте для натяжения. Полностью заряженная стрела пробивает врагов; попадание издалека — критическое.',
    charge: { time: 0.5, min: 0.08, hold: 3 }, rec: 0.22, recoil: 0, trail: PAL.violet, chargeColor: PAL.pink, muzzle: [10, 8], twoHand: true, moveMul: 0.4,
    fire(p, inst, world, charge) {
      const full = charge >= 1;
      const x = p.cx + p.facing * 10, y = p.y + 8;
      shoot(world, p, inst, {
        x, y, vx: p.facing * (280 + 260 * charge), vy: -30 * (1 - charge), grav: 320 * (1 - charge * 0.7), r: 2, life: 1.3,
        color: full ? PAL.pink : PAL.violet, core: '#ffffff', len: full ? 12 : 8, glow: full ? 14 : 8, pierce: full ? 2 : 0,
        base: G.lerp(8, 27, charge), critFn: (t) => full && G.dist(p.cx, p.cy, t.cx, t.cy) > 90, hitOpts: { kb: full ? 120 : 50, stun: 0.12 },
        drawFn(ctx, cam, pr) {
          const X = pr.x - cam.ox, Y = pr.y - cam.oy, sp = Math.hypot(pr.vx, pr.vy) || 1, dx = pr.vx / sp, dy = pr.vy / sp;
          G.px.line(ctx, X - dx * pr.len, Y - dy * pr.len, X, Y, pr.color, 1);
          G.px.line(ctx, X - dx * 3, Y - dy * 3, X, Y, '#ffffff', 2);
          G.px.line(ctx, X - dx * pr.len, Y - dy * pr.len - 1, X - dx * (pr.len - 2), Y - dy * (pr.len - 2) - 1, pr.color, 1);
        },
      });
      world.flashLights.push({ x, y, r: 26, color: PAL.violet, t: 0, life: 0.08 });
      snd('bow', { pitch: 0.8 + charge * 0.4 });
    },
    drawHeld(ctx, x, y, ang, p, inst) {
      const ch = p && p.act && p.act.inst === inst && p.act.phase === 'wind' ? p.act.charge || 0 : 0;
      const c = Math.cos(ang), s = Math.sin(ang), nx = -s, ny = c;
      const pts = [];
      for (let i = -9; i <= 9; i += 3) { const b = 4 - (i * i) / 20; pts.push([x + c * b + nx * i, y + s * b + ny * i]); }
      for (let i = 1; i < pts.length; i++) G.px.line(ctx, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], i === 3 || i === 4 ? '#45466a' : '#9b5cff', 2);
      const top = pts[0], bot = pts[pts.length - 1], pull = -1 - ch * 6;
      const nock = [x + c * pull, y + s * pull];
      G.px.line(ctx, top[0], top[1], nock[0], nock[1], '#ff5cc8', 1);
      G.px.line(ctx, bot[0], bot[1], nock[0], nock[1], '#ff5cc8', 1);
      if (p && p.act && p.act.inst === inst && p.act.phase === 'wind') {
        G.px.line(ctx, nock[0], nock[1], x + c * 9, y + s * 9, ch >= 1 ? '#ffffff' : PAL.pink, 1);
        heldLight(x, y, ang, 8, 10 + ch * 10, PAL.pink, 0.3 + ch * 0.5);
      }
    },
    drawIcon: icon((I) => {
      for (let y = 2; y <= 22; y++) { const x = 8 + Math.round(8 * Math.sin((Math.PI * (y - 2)) / 20)); I.rect(x, y, 2, 1, y > 10 && y < 14 ? '#45466a' : '#9b5cff'); }
      I.line(8, 2, 8, 22, '#ff5cc8', 1);
      I.line(4, 12, 21, 12, '#ff2a8a', 1); I.line(19, 10, 22, 12, '#ffffff', 1); I.line(19, 14, 22, 12, '#ffffff', 1); I.rect(3, 11, 2, 3, '#9b5cff');
    }),
  });

  G.defineItem({
    id: 'smg', name: 'Пистолет-пулемёт', kind: 'ranged', stat: 'tactics', drop: 1,
    desc: 'Автоматический огонь, пока зажата кнопка. После 1.2 с непрерывной стрельбы пули становятся критическими.',
    wind: 0.03, rec: 0.085, auto: true, recoil: 6, trail: PAL.yellow, moveMul: 0.45,
    fire(p, inst, world) {
      const now = world.time;
      inst.spray = inst.lastShot != null && now - inst.lastShot < 0.2 && now >= inst.lastShot ? (inst.spray || 0) + (now - inst.lastShot) : 0;
      inst.lastShot = now;
      const crit = inst.spray >= 1.2;
      const x = p.cx + p.facing * 13, y = p.y + 9 + G.rand.int(-1, 0);
      const a = G.rand.float(-0.07, 0.07);
      shoot(world, p, inst, { x, y, vx: Math.cos(a) * 480 * p.facing, vy: Math.sin(a) * 480, r: 1, life: 0.6, color: crit ? PAL.yellow : '#ffcf7a', len: 5, glow: 5, base: 3.4, crit, noLabel: true, hitOpts: { kb: 15, stun: 0 } });
      muzzleFlash(world, x, y, p.facing, crit ? PAL.orange : PAL.yellow, 0.7);
      shell(world, p.cx + p.facing * 4, y - 1, p.facing);
      snd('smg', { vol: 0.7 });
    },
    drawHeld(ctx, x, y, ang, p, inst, sc = 1) {
      G.drawSprite(ctx, 'smg', x, y, ang, flipOf(p), sc);
      if (inst && inst.spray >= 1.2 && p && p.act && p.act.inst === inst) heldLight(x, y, ang, 9, 10, PAL.orange, 0.6);
    },
    drawIcon: icon((I) => {
      I.rect(0, 9, 3, 1, '#6f7299'); I.rect(0, 12, 3, 1, '#6f7299'); I.rect(0, 9, 1, 4, '#6f7299');
      I.rect(3, 8, 14, 5, '#45466a'); I.rect(3, 8, 14, 1, '#6f7299'); I.rect(17, 9, 5, 2, '#aab0d6');
      I.rect(10, 13, 3, 8, '#2b2a45'); I.rect(10, 14, 3, 1, '#ffe14d'); I.rect(5, 13, 3, 5, '#1b1a2e'); I.dot(15, 10, '#ffe14d');
    }),
  });

  G.defineItem({
    id: 'flamer', name: 'Огнемёт', kind: 'ranged', stat: 'brutality', drop: 0.8, blueprint: true, unlockCost: 40,
    desc: 'Удерживайте, чтобы поливать огнём короткий конус. Поджигает; цели вплотную получают критический урон. Перегревается.',
    action: ChannelAction, tickRate: 0.09, maxChannel: 3, cooldown: 1.2, moveMul: 0.3, trail: PAL.orange, twoHand: true,
    heatCd: (t) => Math.min(1.2, 0.25 + t * 0.32),
    channelTick(p, inst, world, act) {
      const x0 = p.cx + p.facing * 12, y0 = p.y + 9;
      const box = { x: p.facing > 0 ? x0 : x0 - 54, y: y0 - 12, w: 54, h: 22 };
      for (const t of world.enemies) {
        if (t.dead || t.dying || !G.overlap(box, t)) continue;
        if (!world.level.lineClear(x0, y0, t.cx, t.cy)) continue;
        G.weaponHit(world, p, inst, t, 4, { crit: fwdDist(p, t) < 20, dir: p.facing, kb: 25, stun: 0, status: G.ST.burn(p, inst, 2.5, 1.5), kind: 'ranged', noLabel: true });
      }
      if ((act.sndT = (act.sndT || 0) - 1) <= 0) { act.sndT = 3; snd('burn', { vol: 0.6 }); }
    },
    channelFrame(p, inst, world, act, dt) {
      const x0 = p.cx + p.facing * 13, y0 = p.y + 9;
      for (let i = 0; i < 5; i++) {
        const a = (p.facing > 0 ? 0 : Math.PI) + G.rand.float(-0.25, 0.25), sp = G.rand.float(160, 260);
        world.fx.particle({ x: x0, y: y0, vx: Math.cos(a) * sp + p.vx * 0.5, vy: Math.sin(a) * sp, life: G.rand.float(0.16, 0.26), color: G.rand.pick([PAL.yellow, PAL.orange, '#ff5a1f', '#ffffff']), size: G.rand.int(1, 3), grav: -160, drag: 3, additive: true, shape: 'disc', shrink: true });
      }
      if (G.rand.chance(0.3)) world.fx.particle({ x: x0 + p.facing * 40, y: y0 - 4, vx: p.facing * 30, vy: -30, life: 0.6, color: '#3b3350', size: 2, grav: -40, drag: 2, shape: 'disc', shrink: true });
      G.addLight(x0 + p.facing * 24, y0, 48, PAL.orange, 0.7);
      world.shake(0.8, 0.05);
    },
    drawHeld(ctx, x, y, ang, p, inst, sc = 1) {
      G.drawSprite(ctx, 'flamer', x, y, ang, flipOf(p), sc);
      const c = Math.cos(ang), s = Math.sin(ang);
      ctx.fillStyle = Math.floor((p ? p.t : 0) * 12) % 2 ? PAL.orange : PAL.yellow;
      ctx.fillRect(Math.round(x + c * 12 - s * -1), Math.round(y + s * 12 + c * -1), 1, 1);
    },
    drawIcon: icon((I) => {
      I.rect(1, 12, 15, 4, '#45466a'); I.rect(1, 12, 15, 1, '#6f7299'); I.rect(4, 6, 7, 6, '#8a1020'); I.rect(5, 6, 5, 1, '#ff3348'); I.rect(5, 7, 1, 4, '#ff3348');
      I.rect(16, 11, 3, 6, '#6f7299'); I.rect(3, 16, 3, 5, '#1b1a2e');
      I.rect(19, 12, 2, 4, '#ffe14d'); I.rect(21, 11, 2, 6, '#ff8a2a'); I.rect(22, 9, 1, 2, '#ff8a2a'); I.rect(20, 13, 2, 2, '#ffffff');
    }),
  });

  G.defineItem({
    id: 'cryo', name: 'Криобластер', kind: 'ranged', stat: ['tactics', 'survival'], drop: 0.8, blueprint: true, unlockCost: 35,
    desc: 'Ледяные осколки замедляют. Третье попадание замораживает цель; по замороженным — критический урон (x2).',
    wind: 0.08, rec: 0.3, recoil: 25, trail: '#9fe8ff', critMul: 2,
    fire(p, inst, world) {
      const x = p.cx + p.facing * 12, y = p.y + 9;
      shoot(world, p, inst, {
        x, y, vx: p.facing * 340, vy: 0, r: 2, life: 0.9, color: '#9fe8ff', core: '#ffffff', len: 6, glow: 10, base: 13,
        critFn: (t) => isFrozen(t), statusFn: () => G.ST.cryo(2.5), hitOpts: { kb: 20, stun: 0.05 },
        onHitT(t, w) {
          w.fx.burst(this.x, this.y, 8, { speed: 80, life: 0.35, color: ['#9fe8ff', '#ffffff'], grav: 200 });
          if (isFrozen(t)) return;
          t._chill = (t._chillT && w.time - t._chillT < 3 ? t._chill || 0 : 0) + 1;
          t._chillT = w.time;
          if (t._chill >= 3) { t._chill = 0; G.freeze(w, t, 1.6); }
        },
        drawFn(ctx, cam, pr) {
          const X = Math.round(pr.x - cam.ox), Y = Math.round(pr.y - cam.oy), f = G.sign(pr.vx) || 1;
          G.px.line(ctx, X - f * 6, Y, X, Y, '#3f8fc8', 1);
          ctx.fillStyle = '#9fe8ff'; ctx.fillRect(X - 1, Y - 1, 3, 3);
          ctx.fillStyle = '#ffffff'; ctx.fillRect(X, Y - 2, 1, 5); ctx.fillRect(X + f, Y, 1, 1);
        },
      });
      muzzleFlash(world, x, y, p.facing, '#9fe8ff', 0.9);
      snd('freeze', { vol: 0.5, pitch: 1.5 });
    },
    drawHeld(ctx, x, y, ang, p, inst, sc = 1) { G.drawSprite(ctx, 'cryo', x, y, ang, flipOf(p), sc); heldLight(x, y, ang, 4, 8, '#9fe8ff', 0.4); },
    drawIcon: icon((I) => {
      I.rect(2, 10, 14, 5, '#45466a'); I.rect(2, 10, 14, 1, '#6f7299'); I.rect(5, 7, 8, 3, '#3f8fc8'); I.rect(6, 8, 6, 1, '#9fe8ff');
      I.rect(16, 11, 3, 3, '#6f7299'); I.rect(4, 15, 3, 5, '#1b1a2e');
      I.line(21, 8, 21, 16, '#9fe8ff', 1); I.line(17, 12, 25, 12, '#9fe8ff', 1); I.line(19, 10, 23, 14, '#ffffff', 1); I.line(23, 10, 19, 14, '#ffffff', 1);
    }),
  });

  // ---------------------------------------------------------------- SHIELDS
  G.defineItem({
    id: 'kshield', name: 'Кинетический щит', kind: 'shield', stat: 'survival', start: true, drop: 0.8,
    desc: 'Удерживайте, чтобы блокировать 75% урона спереди. Поднимите щит в момент удара — парирование: оглушает врага, отражает снаряды и бьёт в ответ.',
    blockPct: 0.75, parryWindow: 0.2, trail: PAL.cyan, reflectMul: 2.2, counter: 20,
    onParry(p, inst, src, info, world) {
      if (src && !isProjectile(src) && src.takeDamage && src.team === 'enemy') {
        G.weaponHit(world, p, inst, src, this.counter, { crit: true, dir: p.facing, kb: 240, kbUp: 80, stun: 1.8, kind: 'parry', noLabel: true });
        world.fx.sparks(src.cx, src.cy, p.facing, 14, PAL.cyan);
      }
    },
    drawHeld(ctx, x, y, ang, p, inst, sc = 1) {
      G.drawSprite(ctx, 'kshield', x, y, ang, flipOf(p), sc);
      const act = p && p.act && p.act.inst === inst ? p.act : null;
      if (act && act.parrying) {
        const c = Math.cos(ang), s = Math.sin(ang);
        ctx.globalAlpha = 0.7; ctx.fillStyle = '#ffffff';
        for (let j = -6; j <= 6; j++) ctx.fillRect(Math.round(x + c * 5 - s * j), Math.round(y + s * 5 + c * j), 1, 1);
        ctx.globalAlpha = 1;
      }
      heldLight(x, y, ang, 4, 12, PAL.cyan, act ? 0.5 : 0.25);
    },
    drawIcon: icon((I) => {
      I.rect(6, 3, 12, 18, '#45466a'); I.rect(7, 2, 10, 20, '#45466a'); I.rect(8, 4, 8, 16, '#6f7299'); I.rect(8, 4, 1, 16, '#aab0d6');
      I.rect(8, 7, 8, 1, '#27f3ff'); I.rect(8, 12, 8, 1, '#27f3ff'); I.rect(8, 17, 8, 1, '#27f3ff');
      I.dot(10, 5, '#2b2a45'); I.dot(14, 5, '#2b2a45'); I.dot(10, 19, '#2b2a45'); I.dot(14, 19, '#2b2a45');
    }),
  });

  G.defineItem({
    id: 'hshield', name: 'Голощит', kind: 'shield', stat: ['tactics', 'survival'], drop: 0.7, blueprint: true, unlockCost: 40,
    desc: 'Блокирует 60% урона. Широкое окно парирования; парирование высвобождает электроимпульс вокруг и отправляет снаряды обратно самонаводящимися.',
    blockPct: 0.6, parryWindow: 0.28, trail: PAL.violet, reflectMul: 2.6, reflectHoming: true, burst: 14,
    onParry(p, inst, src, info, world) {
      const x = p.cx + p.facing * 8, y = p.cy;
      for (const t of world.enemies) {
        if (t.dead || t.dying || G.dist(t.cx, t.cy, x, y) > 50) continue;
        G.weaponHit(world, p, inst, t, this.burst, { crit: t === src, dir: G.sign(t.cx - p.cx) || p.facing, kb: 150, stun: t === src ? 1.5 : 0.6, status: G.ST.shock(4), kind: 'parry', noLabel: true });
        addBolt(world, [[x, y], [t.cx, t.cy]], { color: PAL.violet, amp: 4, life: 0.2 });
      }
      world.fx.ring(x, y, 4, 50, PAL.violet, 0.3, 2);
      snd('emp', { vol: 0.5 });
    },
    drawHeld(ctx, x, y, ang, p, inst) {
      const c = Math.cos(ang), s = Math.sin(ang);
      const act = p && p.act && p.act.inst === inst ? p.act : null;
      G.px.rect(ctx, x - 1, y - 2, 3, 4, '#45466a');
      ctx.fillStyle = '#b46cff'; ctx.fillRect(Math.round(x), Math.round(y) - 1, 1, 2);
      if (!act && p) return;
      const a = act && act.parrying ? 0.95 : 0.6, t = p ? p.t : 0;
      ctx.globalAlpha = a;
      for (let j = -10; j <= 10; j++) {
        const hw = Math.abs(j) > 8 ? 1 : Math.abs(j) > 5 ? 2 : 3, bright = (j + Math.floor(t * 20)) % 3 === 0;
        for (let i = 0; i < hw; i++) {
          ctx.fillStyle = Math.abs(j) === 10 || i === hw - 1 ? '#27f3ff' : bright ? '#b46cff' : '#5a2fa0';
          ctx.fillRect(Math.round(x + c * (5 + i) - s * j), Math.round(y + s * (5 + i) + c * j), 1, 1);
        }
      }
      ctx.globalAlpha = 1;
      heldLight(x, y, ang, 6, 22, PAL.violet, act && act.parrying ? 0.7 : 0.4);
    },
    drawIcon: icon((I) => {
      for (let y = 2; y <= 22; y++) {
        const hw = y < 7 ? Math.round(((y - 2) * 7) / 5) : y <= 17 ? 7 : Math.round(((22 - y) * 7) / 5);
        I.rect(12 - hw, y, hw * 2 + 1, 1, y % 3 === 0 ? '#9b5cff' : '#5a2fa0');
        I.dot(12 - hw, y, '#27f3ff'); I.dot(12 + hw, y, '#27f3ff');
      }
      I.rect(9, 10, 7, 5, '#b46cff'); I.rect(11, 9, 3, 7, '#b46cff'); I.dot(12, 12, '#ffffff');
    }),
  });

  // ---------------------------------------------------------------- SKILLS
  G.defineItem({
    id: 'frag', name: 'Осколочная граната', kind: 'skill', stat: 'brutality', drop: 1, cooldown: 7,
    desc: 'Бросает гранату, взрывающуюся при касании.',
    activate(p, inst, world) {
      throwGrenade(world, p, inst, {
        color: PAL.orange,
        boom(w, x, y) { const hits = G.explode(w, x, y, { radius: 38, dmg: G.itemDamage(p, inst, 34), info: { kb: 180, kbUp: 160, stun: 0.6 }, color: PAL.orange }); for (const t of hits) G.onItemHit(p, inst, t, t.lastDealt || 0, w); },
      });
    },
    drawIcon: icon((I) => {
      I.disc(12, 14, 7, '#3b3a50'); I.disc(10, 12, 3, '#57567a'); I.dot(9, 11, '#aab0d6');
      I.rect(5, 14, 15, 1, '#2b2a45'); I.rect(12, 7, 1, 15, '#2b2a45');
      I.rect(10, 4, 5, 4, '#6f7299'); I.rect(15, 4, 4, 2, '#ff8a2a'); I.ring(18, 3, 2, '#ffe14d');
    }),
  });

  G.defineItem({
    id: 'emp', name: 'ЭМИ-граната', kind: 'skill', stat: 'tactics', drop: 1, cooldown: 10,
    desc: 'Отскакивающая граната: электроимпульс надолго оглушает врагов и накладывает шок.',
    activate(p, inst, world) {
      throwGrenade(world, p, inst, {
        color: PAL.cyan, bounce: 0.45, fuse: 1.0, speed: 210, vy: -150,
        extra: { hit(t, w) { this.boom(w); return true; } },
        boom(w, x, y) {
          for (const t of w.enemies) {
            if (t.dead || t.dying || G.dist(t.cx, t.cy, x, y) > 58) continue;
            G.weaponHit(w, p, inst, t, 8, { kb: 40, kbUp: 60, stun: 2.2, status: G.ST.shock(5), kind: 'skill', dir: G.sign(t.cx - x) || 1 });
            addBolt(w, [[x, y], [t.cx, t.cy]], { color: PAL.cyan, amp: 5, life: 0.3 });
          }
          w.fx.ring(x, y, 4, 58, PAL.cyan, 0.4, 2); w.fx.ring(x, y, 2, 40, '#ffffff', 0.25, 1);
          w.fx.burst(x, y, 30, { speed: 240, life: 0.4, color: [PAL.cyan, '#ffffff', PAL.violet], shape: 'spark', grav: 0, additive: true });
          w.fx.flash(PAL.cyan, 0.06); w.flashLights.push({ x, y, r: 120, color: PAL.cyan, t: 0, life: 0.3 });
          w.shake(3, 0.2); snd('emp');
        },
      });
    },
    drawIcon: icon((I) => {
      I.disc(12, 14, 7, '#16303e'); I.ring(12, 14, 7, '#27f3ff'); I.rect(10, 4, 5, 4, '#6f7299'); I.rect(11, 3, 3, 1, '#27f3ff');
      I.poly([[13, 9], [10, 14], [14, 14], [11, 19]], '#ffe14d'); I.poly([[12, 9], [9, 14]], '#ffffff');
    }),
  });

  G.defineItem({
    id: 'incendiary', name: 'Зажигательная граната', kind: 'skill', stat: ['brutality', 'survival'], drop: 0.8, cooldown: 10, blueprint: true, unlockCost: 25,
    desc: 'Разбивается и оставляет на земле горящую лужу: всё, что в ней, горит.',
    activate(p, inst, world) {
      throwGrenade(world, p, inst, {
        color: PAL.red, speed: 170,
        boom(w, x, y) {
          const gy = groundY(w, x, y);
          w.addObject(new FireZone(x, gy, p, inst, { w: 76, life: 5, base: 3 }));
          G.explode(w, x, y, { radius: 22, dmg: G.itemDamage(p, inst, 6), color: PAL.orange, info: { kb: 60, kbUp: 80, stun: 0.2, status: G.ST.burn(p, inst, 3, 2) } });
          snd('burn');
        },
      });
    },
    drawIcon: icon((I) => {
      I.rect(8, 10, 8, 12, '#8a1020'); I.rect(9, 11, 2, 9, '#ff3348'); I.rect(10, 7, 4, 3, '#45466a'); I.rect(8, 15, 8, 2, '#ffe14d');
      I.rect(10, 4, 4, 3, '#ff8a2a'); I.rect(11, 2, 2, 2, '#ffe14d'); I.dot(9, 3, '#ff8a2a'); I.dot(14, 3, '#ffe14d'); I.dot(11, 1, '#ffffff');
    }),
  });

  G.defineItem({
    id: 'turret', name: 'Турель', kind: 'skill', stat: ['tactics', 'survival'], drop: 1, cooldown: 14, dmg: 6,
    desc: 'Разворачивает автоматическую турель, стреляющую по ближайшим врагам 20 с. Враги могут её уничтожить.',
    castTime: 0.25,
    activate(p, inst, world) {
      const x = p.cx + p.facing * 16;
      const gy = world.level.solidAt(x, p.y + 10) ? p.bottom : groundY(world, x, p.bottom);
      const tx = world.level.solidAt(x, p.y + 10) ? p.cx : x;
      const mine = world.allies.filter((a) => a instanceof Turret && a.p === p);
      if (mine.length >= 2) { mine[0].dead = true; mine[0].boom(world, false); }
      const hp = Math.round(40 * p.statMul(inst.def.stat) * (1 + 0.25 * inst.tier));
      world.allies.push(new Turret(tx, gy, { p, inst, hp, life: 20 }));
      world.fx.burst(tx, gy - 4, 10, { speed: 80, life: 0.4, color: [PAL.cyan, '#ffffff'], grav: 200, additive: true });
      snd('turret', { pitch: 0.6 });
    },
    pose(P, act) { P.aim = 0.9; P.lean = 0.3; P.crouch = 3; },
    drawIcon: icon((I) => {
      I.line(6, 22, 10, 15, '#2b2a45', 2); I.line(18, 22, 14, 15, '#2b2a45', 2); I.rect(11, 14, 3, 8, '#45466a');
      I.rect(6, 7, 11, 8, '#45466a'); I.rect(6, 7, 11, 1, '#6f7299'); I.rect(17, 9, 6, 3, '#aab0d6'); I.rect(8, 9, 3, 3, '#27f3ff'); I.dot(9, 10, '#ffffff');
    }),
  });

  G.defineItem({
    id: 'drone', name: 'Боевой дрон', kind: 'skill', stat: 'tactics', drop: 0.8, cooldown: 20, dmg: 5, blueprint: true, unlockCost: 45,
    desc: 'Выпускает дрона, который кружит рядом 24 с и стреляет лазером по врагам.',
    activate(p, inst, world) {
      for (const a of world.allies) if (a instanceof Drone && a.p === p) { a.dead = true; a.boom(world, false); }
      const hp = Math.round(25 * p.statMul(inst.def.stat) * (1 + 0.25 * inst.tier));
      world.allies.push(new Drone(p.cx, p.y - 4, { p, inst, hp, life: 24 }));
      world.fx.ring(p.cx, p.y - 8, 2, 14, PAL.magenta, 0.25, 1);
      snd('drone');
    },
    drawIcon: icon((I) => {
      I.rect(7, 10, 10, 5, '#45466a'); I.rect(8, 10, 8, 1, '#6f7299'); I.line(3, 8, 21, 8, '#2b2a45', 1);
      I.rect(1, 6, 6, 1, '#aab0d6'); I.rect(17, 6, 6, 1, '#aab0d6'); I.rect(3, 7, 1, 2, '#6f7299'); I.rect(20, 7, 1, 2, '#6f7299');
      I.rect(11, 13, 2, 2, '#ff2a8a'); I.line(12, 15, 19, 22, '#ff2a8a', 1); I.dot(19, 22, '#ffffff');
    }),
  });

  G.defineItem({
    id: 'decoy', name: 'Голо-двойник', kind: 'skill', stat: ['tactics', 'survival'], drop: 0.8, cooldown: 16, dmg: 20, blueprint: true, unlockCost: 35,
    desc: 'Оставляет голограмму: враги рядом дезориентированы, а через 6 с (или при уничтожении) она взрывается импульсом.',
    activate(p, inst, world) {
      if (world.decoy && !world.decoy.dead) { world.decoy.dead = true; world.decoy.burst(world); }
      const hp = Math.round(50 * p.statMul(inst.def.stat) * (1 + 0.25 * inst.tier));
      const d = new Decoy(p.cx, p.bottom, { p, inst, hp, life: 6 });
      world.allies.push(d); world.decoy = d;
      for (const t of world.enemies) {
        if (t.dead || t.dying || G.dist(t.cx, t.cy, p.cx, p.cy) > 120) continue;
        t.stun = Math.max(t.stun, 1.0 * (1 - (t.stunRes || 0))); t.aggro = false;
        world.fx.label(t.cx, t.y - 12, '?', PAL.cyan, 0.8);
      }
      p.vx = -p.facing * 180;
      world.fx.burst(p.cx, p.cy, 16, { speed: 120, life: 0.4, color: [PAL.cyan, PAL.violet], shape: 'spark', grav: 0, additive: true });
      world.glitch = Math.max(world.glitch || 0, 0.3);
      snd('teleport');
    },
    drawIcon: icon((I) => {
      // hologram (behind, right) and the real body (front, left)
      const fig = (x, c, c2) => {
        I.disc(x + 3, 5, 3, c); I.rect(x + 1, 9, 5, 7, c); I.line(x + 1, 10, x - 1, 15, c, 1); I.line(x + 5, 10, x + 7, 15, c, 1);
        I.rect(x + 1, 16, 2, 6, c2); I.rect(x + 4, 16, 2, 6, c2);
      };
      fig(13, '#27f3ff', '#0e8fa6');
      for (let y = 3; y < 23; y += 3) I.rect(11, y, 11, 1, '#07050d');
      I.dot(17, 5, '#ffffff');
      fig(3, '#45466a', '#27233d'); I.rect(4, 9, 5, 1, '#ff2a8a'); I.dot(7, 5, '#27f3ff');
    }),
  });

  G.defineItem({
    id: 'powerstrike', name: 'Силовой удар', kind: 'skill', stat: 'brutality', drop: 1, cooldown: 6, dmg: 30,
    desc: 'Мгновенный рывок с ударом кулака: неуязвимость во время рывка, сильно отбрасывает и оглушает. Крит по оглушённым.',
    action: DashAction, dashSpeed: 430, dashTime: 0.19, trail: PAL.red,
    drawIcon: icon((I) => {
      I.rect(1, 8, 7, 1, '#ff3d4f'); I.rect(3, 12, 6, 1, '#ffffff'); I.rect(0, 16, 8, 1, '#ff3d4f');
      I.rect(10, 6, 11, 11, '#45466a'); I.rect(11, 7, 9, 1, '#6f7299'); I.rect(19, 7, 3, 9, '#aab0d6');
      I.rect(20, 8, 1, 7, '#ff3d4f'); I.rect(9, 11, 3, 4, '#6f7299'); I.rect(11, 17, 7, 4, '#2b2a45'); I.rect(11, 18, 7, 1, '#ff3d4f');
    }),
  });

  G.defineItem({
    id: 'chain', name: 'Разряд', kind: 'skill', stat: 'tactics', drop: 1, cooldown: 8, dmg: 14,
    desc: 'Цепная молния поражает до 5 врагов подряд, оглушая их и накладывая шок.',
    castTime: 0.2,
    pose(P, act) { P.aim = -0.1; P.lean = 0.1; P.recoil = act.fired ? 1 : 0; },
    activate(p, inst, world) {
      const h = handPos(p), x0 = h.x + p.facing * 4, y0 = h.y;
      const hitList = [], nodes = [[x0, y0]];
      let cur = { cx: x0, cy: y0 }, range = 160;
      for (let n = 0; n < 5; n++) {
        let best = null, bd = range;
        for (const e of world.enemies) {
          if (e.dead || e.dying || hitList.includes(e)) continue;
          const d = G.dist(cur.cx, cur.cy, e.cx, e.cy) + (n === 0 && G.sign(e.cx - p.cx) !== p.facing ? 60 : 0);
          if (d < bd && world.level.lineClear(cur.cx, cur.cy, e.cx, e.cy)) { bd = d; best = e; }
        }
        if (!best) break;
        hitList.push(best); nodes.push([best.cx, best.cy]); cur = best; range = 95;
      }
      if (!hitList.length) { nodes.push([x0 + p.facing * 60, y0 + G.rand.float(-10, 10)]); }
      addBolt(world, nodes, { color: PAL.cyan, amp: 6, life: 0.3 });
      for (const t of hitList) {
        G.weaponHit(world, p, inst, t, this.dmg, { kb: 50, stun: 0.5, status: G.ST.shock(4), kind: 'skill', dir: G.sign(t.cx - p.cx) || p.facing });
        world.fx.burst(t.cx, t.cy, 10, { speed: 140, life: 0.3, color: [PAL.cyan, '#ffffff'], shape: 'spark', grav: 0, additive: true });
      }
      world.flashLights.push({ x: x0, y: y0, r: 60, color: PAL.cyan, t: 0, life: 0.15 });
      world.shake(2, 0.12); snd('shock');
    },
    drawIcon: icon((I) => {
      I.poly([[15, 1], [8, 11], [13, 11], [6, 23]], '#27f3ff'); I.poly([[16, 1], [9, 11], [14, 11], [7, 23]], '#27f3ff');
      I.poly([[15, 2], [9, 10]], '#ffffff'); I.poly([[13, 12], [18, 14], [21, 19]], '#0e8fa6'); I.poly([[10, 6], [4, 7]], '#0e8fa6');
      I.dot(21, 19, '#ffffff'); I.dot(4, 7, '#ffffff');
    }),
  });

  G.defineItem({
    id: 'trap', name: 'Ловушка-капкан', kind: 'skill', stat: 'survival', drop: 1, cooldown: 10, dmg: 22,
    desc: 'Ставит капкан (до 3 шт.): первый наступивший враг получает урон и обездвижен на 2.4 с.',
    castTime: 0.22,
    pose(P) { P.aim = 1.3; P.lean = 0.5; P.crouch = 4; },
    activate(p, inst, world) {
      const x = p.cx + p.facing * 14;
      const gy = groundY(world, x, p.bottom);
      const mine = world.objects.filter((o) => o instanceof Trap && o.p === p && o.snapT === 0);
      if (mine.length >= 3) mine[0].dead = true;
      world.addObject(new Trap(x, gy, p, inst));
      snd('shield', { pitch: 1.6, vol: 0.5 });
    },
    drawIcon: icon((I) => {
      I.rect(3, 17, 18, 3, '#2b2a45'); I.rect(3, 17, 18, 1, '#45466a');
      for (let i = 0; i < 8; i++) { I.rect(4 + i * 2, 10 + (i % 2) * 2, 1, 7 - (i % 2) * 2, i % 2 ? '#6f7299' : '#aab0d6'); }
      I.rect(3, 9, 1, 8, '#6f7299'); I.rect(20, 9, 1, 8, '#6f7299'); I.rect(11, 20, 3, 2, '#45466a'); I.rect(11, 18, 2, 1, '#ff3348');
    }),
  });

  G.defineItem({
    id: 'virus', name: 'Вирус', kind: 'skill', stat: 'tactics', drop: 0.8, cooldown: 9, blueprint: true, unlockCost: 30,
    desc: 'Дротик заражает цель вирусом (3 стака, урон со временем). При смерти носителя вирус перекидывается на соседей.',
    activate(p, inst, world) {
      // thrown from chest height with a slight auto-aim toward the closest enemy in front
      const x = p.cx + p.facing * 8, y = p.y + 8;
      let ang = p.facing > 0 ? 0 : Math.PI, bd = 220;
      for (const e of world.enemies) {
        if (e.dead || e.dying || G.sign(e.cx - p.cx) !== p.facing) continue;
        const d = G.dist(x, y, e.cx, e.cy), a = Math.atan2(e.cy - y, e.cx - x);
        if (d < bd && Math.abs(Math.sin(a)) < 0.45 && world.level.lineClear(x, y, e.cx, e.cy)) { bd = d; ang = a; }
      }
      shoot(world, p, inst, {
        x, y, vx: Math.cos(ang) * 420, vy: Math.sin(ang) * 420, grav: 0, r: 2, life: 0.9, color: PAL.lime, core: '#ffffff', len: 6, glow: 10, base: 5, noLabel: true,
        hitOpts: { kb: 20, stun: 0.1 },
        onHitT(t, w) {
          const st = G.ST.virus(p, inst, 7, 3);
          t.applyStatus('virus', st.dur, st.power);
          if (t.statuses.virus) t.statuses.virus.stacks = Math.min(10, Math.max(3, (t.statuses.virus.stacks || 1) + 2));
          w.fx.burst(t.cx, t.cy, 14, { speed: 80, life: 0.6, color: [PAL.lime, '#1a7a2a', '#ffffff'], grav: -30, additive: true });
          w.fx.label(t.cx, t.y - 14, 'VIRUS', PAL.lime, 0.6);
        },
      });
      snd('shoot', { pitch: 1.6, vol: 0.6 });
    },
    drawIcon: icon((I) => {
      for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; I.line(12, 12, 12 + Math.cos(a) * 9, 12 + Math.sin(a) * 9, '#1a7a2a', 1); I.disc(12 + Math.cos(a) * 9, 12 + Math.sin(a) * 9, 1, '#b6ff3b'); }
      I.disc(12, 12, 6, '#48ff8a'); I.disc(12, 12, 4, '#1a7a2a'); I.disc(11, 11, 2, '#b6ff3b'); I.dot(10, 10, '#ffffff');
    }),
  });

  G.defineItem({
    id: 'overload', name: 'Перегрузка', kind: 'skill', stat: 'brutality', drop: 0.7, cooldown: 24, blueprint: true, unlockCost: 55,
    desc: 'Разгоняет системы: +50% ко всему урону оружия на 6 с.',
    castTime: 0.3,
    pose(P, act) { P.aim = -1.5; P.lean = -0.2; P.twoHand = true; },
    activate(p, inst, world) {
      const dur = 6 * (1 + 0.1 * inst.tier);
      p.overloadUntil = G.game.runTime + dur;
      world.projectiles.push(new Aura({ p, life: dur + 0.1 }));
      world.fx.ring(p.cx, p.cy, 4, 34, PAL.red, 0.4, 2);
      world.fx.burst(p.cx, p.cy, 24, { speed: 160, life: 0.5, color: [PAL.red, PAL.magenta, '#ffffff'], shape: 'spark', grav: 0, additive: true });
      world.flashLights.push({ x: p.cx, y: p.cy, r: 90, color: PAL.red, t: 0, life: 0.3 });
      world.fx.label(p.cx, p.y - 18, 'OVERLOAD', PAL.red, 1);
      world.shake(3, 0.2); snd('charge', { pitch: 0.7 }); snd('shock', { vol: 0.6 });
    },
    drawIcon: icon((I) => {
      I.rect(6, 4, 12, 18, '#2b2a45'); I.rect(9, 2, 6, 2, '#6f7299'); I.rect(7, 5, 10, 16, '#1b1a2e');
      I.rect(7, 12, 10, 9, '#8a1020'); I.rect(7, 12, 10, 1, '#ff3348');
      I.poly([[13, 5], [9, 12], [14, 12], [10, 20]], '#ffe14d'); I.poly([[12, 5], [8, 12]], '#ffffff');
    }),
  });

  // re-render icons when the page's pixel font / canvases are ready is not needed: icons are cached lazily.
  G.handPos = handPos;
})();
