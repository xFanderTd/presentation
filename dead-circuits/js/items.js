'use strict';
// DEAD CIRCUITS — loot & progression (owned by the LOOT agent).
// World objects & pickups (currency, item drops, power chips, food, containers, vending machine, collector,
// heal station), loot tables with quality tiers + affixes, mutations («Импланты»), blueprints and
// persistent meta upgrades. Level objects are created through G.OBJECTS[kind](world, spec)
// where spec = {kind, x, y, ...} (feet position).
(function () {
  const G = window.G;
  const PAL = G.PAL;
  const TAU = Math.PI * 2;
  const snd = (name, o) => { if (G.audio) G.audio.play(name, o); };
  const icon = (fn) => (g, s) => fn(G.makeIc(g, s / 24));

  G.OBJECTS = {};

  // ================================================================ base object
  class WorldObject {
    constructor(x, y, w, h) {
      this.x = x - w / 2; this.y = y - h; this.w = w; this.h = h;
      this.vx = 0; this.vy = 0; this.t = 0; this.dead = false;
      this.interactable = false;
    }
    get cx() { return this.x + this.w / 2; }
    get cy() { return this.y + this.h / 2; }
    get bottom() { return this.y + this.h; }
    update(dt, world) { this.t += dt; }
    draw(ctx, cam) {}
  }
  G.WorldObject = WorldObject;

  // simple falling body for pickups
  function fall(o, dt, L, bounce = 0.35) {
    o.vy = Math.min(420, o.vy + G.GRAVITY * dt);
    const nx = o.x + o.vx * dt;
    if (!L.solidAt(nx + o.w / 2, o.y + o.h / 2)) o.x = nx; else o.vx *= -0.5;
    const ny = o.y + o.vy * dt;
    if (o.vy > 0 && L.floorAt(o.x + o.w / 2, ny + o.h)) {
      o.y = Math.floor((ny + o.h) / G.TILE) * G.TILE - o.h;
      o.vy = Math.abs(o.vy) > 60 ? -o.vy * bounce : 0;
      o.vx *= 0.7;
      o.grounded = o.vy === 0;
    } else if (o.vy < 0 && L.solidAt(o.x + o.w / 2, ny)) { o.vy = 0; }
    else o.y = ny;
    if (o.grounded) o.vx *= Math.pow(0.001, dt);
  }
  G.fallBody = fall;
  // snap a feet position to the floor below (so objects never float / sit in walls)
  function floorY(world, x, y, max = 64) {
    const gy = world.level.groundBelow(x, y - 6, max);
    return gy == null ? y : gy;
  }

  // ================================================================ currency
  class Currency extends WorldObject {
    constructor(x, y, kind, value) {
      super(x, y, 4, 4);
      this.kind = kind; this.value = value;
      this.vx = G.rand.float(-110, 110); this.vy = G.rand.float(-260, -120);
      this.magnet = false;
    }
    update(dt, world) {
      this.t += dt;
      const p = world.player;
      if (!p || p.state === 'dead') { fall(this, dt, world.level); return; }
      const d = G.dist(this.cx, this.cy, p.cx, p.cy);
      if (this.t > 0.45 && (d < 70 || this.magnet)) this.magnet = true;
      if (this.magnet) {
        const sp = 260 + this.t * 120;
        const a = Math.atan2(p.cy - this.cy, p.cx - this.cx);
        this.x += Math.cos(a) * sp * dt; this.y += Math.sin(a) * sp * dt;
        if (d < 8) {
          this.dead = true;
          let v = this.value;
          // multipliers (mutations / meta) with a fractional carry so single coins still scale
          const mul = this.kind === 'cells' ? p.cellMul || 1 : p.goldMul || 1;
          if (mul !== 1) {
            const k = '_frac' + this.kind;
            const f = (p[k] || 0) + v * mul;
            v = Math.floor(f); p[k] = f - v;
          }
          if (this.kind === 'cells') p.cells += v; else p.gold += v;
          snd(this.kind === 'cells' ? 'pickupCell' : 'pickupGold', { vol: 0.5 });
          G.emit('pickup', { kind: this.kind, value: v });
        }
      } else fall(this, dt, world.level, 0.45);
    }
    draw(ctx, cam) {
      const x = Math.round(this.x - cam.ox), y = Math.round(this.y - cam.oy);
      if (this.kind === 'cells') {
        const b = Math.floor(this.t * 8) % 2;
        G.px.rect(ctx, x, y + 1, 4, 2, PAL.cells); G.px.rect(ctx, x + 1, y, 2, 4, PAL.cells);
        G.px.rect(ctx, x + 1, y + 1, 2, 2, b ? '#ffffff' : '#bff4ff');
      } else {
        const spin = Math.floor(this.t * 10) % 4;
        const w = spin === 1 || spin === 3 ? 2 : 4, ox = (4 - w) / 2;
        G.px.rect(ctx, x + ox, y, w, 4, '#8a5a12'); G.px.rect(ctx, x + ox, y, Math.max(1, w - 1), 3, PAL.gold);
        G.px.rect(ctx, x + ox + (w > 2 ? 1 : 0), y + 1, 1, 1, '#fff2b0');
      }
    }
    drawLight(ctx, cam) {
      G.drawGlow(ctx, this.cx - cam.ox, this.cy - cam.oy, this.kind === 'cells' ? 14 : 8, this.kind === 'cells' ? PAL.cells : PAL.gold, 0.5);
    }
  }
  G.Currency = Currency;

  // ================================================================ item on the ground / on a shop pad
  class ItemDrop extends WorldObject {
    constructor(x, y, inst, opts = {}) {
      super(x, y, 16, 16);
      this.inst = inst; this.interactable = true;
      this.vy = opts.pop ? -200 : 0; this.vx = opts.pop ? G.rand.float(-60, 60) : 0;
      this.price = opts.price || 0; this.shop = opts.shop || null;
      this.pad = !!opts.price;
      this.sparkT = 0;
    }
    get prompt() {
      const name = G.itemName(this.inst);
      const q = this.inst.quality !== 'normal' ? ' (' + (G.QUALITY_NAMES[this.inst.quality] || '') + ')' : '';
      return this.price ? `Купить: ${name}${q} — ${this.price} кр.` : `Взять: ${name}${q}`;
    }
    update(dt, world) {
      this.t += dt;
      if (!this.pad) fall(this, dt, world.level, 0.2);
      if (this.inst.quality === 'legendary') {
        this.sparkT -= dt;
        if (this.sparkT <= 0) {
          this.sparkT = 0.06;
          world.fx.particle({ x: this.x + G.rand.float(0, this.w), y: this.bottom - G.rand.float(0, 4), vx: G.rand.float(-6, 6), vy: -G.rand.float(20, 50), life: 0.8, color: G.rand.pick([PAL.gold, PAL.yellow, '#fff2b0']), additive: true, glow: 4 });
        }
      } else if (this.inst.quality === 'rare' && G.rand.chance(dt * 4)) {
        world.fx.particle({ x: this.x + G.rand.float(2, this.w - 2), y: this.y + G.rand.float(2, this.h), vy: -20, life: 0.5, color: PAL.cyan, additive: true });
      }
    }
    interact(p, world) {
      if (this.price) {
        if (p.gold < this.price) { snd('denied'); world.fx.label(this.cx, this.y - 6, 'NO $', PAL.red); return; }
        p.gold -= this.price; this.price = 0; this.pad = false;
        snd('shopBuy');
        world.fx.burst(this.cx, this.cy, 16, { speed: 120, life: 0.5, color: [PAL.gold, '#ffffff'], shape: 'spark', grav: 200, additive: true });
      }
      const old = p.equip(this.inst);
      snd('pickupItem');
      G.emit('pickup', { kind: 'item', inst: this.inst, old });
      world.fx.ring(this.cx, this.cy, 2, 16, G.statColor(this.inst.def.stat), 0.3, 1);
      if (old) { this.inst = old; this.vy = -150; this.t = 0; }
      else this.dead = true;
    }
    draw(ctx, cam) {
      const bob = Math.round(Math.sin(this.t * 3) * 1.5);
      const x = Math.round(this.x - cam.ox), y = Math.round(this.y - cam.oy) + bob - 3;
      const q = this.inst.quality, sc = G.statColors(this.inst.def.stat);
      // light pillar
      ctx.globalAlpha = 0.18 + Math.sin(this.t * 3) * 0.05;
      ctx.fillStyle = q === 'legendary' ? PAL.gold : sc[0];
      ctx.fillRect(x + 6, y - 14, 4, 30 - bob);
      ctx.globalAlpha = 1;
      if (q === 'legendary') {
        // rotating gold rays
        for (let i = 0; i < 6; i++) {
          const a = this.t * 1.2 + (i * TAU) / 6;
          ctx.globalAlpha = 0.35;
          G.px.line(ctx, x + 8 + Math.cos(a) * 6, y + 8 + Math.sin(a) * 6, x + 8 + Math.cos(a) * 13, y + 8 + Math.sin(a) * 13, PAL.gold, 1);
        }
        ctx.globalAlpha = 1;
      }
      ctx.drawImage(G.itemIcon(this.inst.def, 16), x, y);
      // quality / dual-stat pips
      if (q !== 'normal') G.px.rect(ctx, x, y, 2, 2, G.QUALITY_COLORS[q]);
      if (sc.length > 1) { G.px.rect(ctx, x + 14, y + 14, 2, 2, sc[1]); G.px.rect(ctx, x + 12, y + 14, 2, 2, sc[0]); }
      if (this.inst.tier > 0) G.font.draw(ctx, '+' + this.inst.tier, x + 16, y - 3, PAL.white, 1, 'left');
      if (this.price) G.font.draw(ctx, this.price + '$', Math.round(this.cx - cam.ox), Math.round(this.bottom - cam.oy) + 3, PAL.gold, 1, 'center');
    }
    drawLight(ctx, cam) {
      const c = this.inst.quality === 'legendary' ? PAL.gold : G.statColor(this.inst.def.stat);
      G.drawGlow(ctx, this.cx - cam.ox, this.cy - cam.oy, this.inst.quality === 'legendary' ? 40 : 24, c, 0.45 + Math.sin(this.t * 3) * 0.1);
    }
  }
  G.ItemDrop = ItemDrop;

  // ================================================================ power chip («чип усиления»)
  class Scroll extends WorldObject {
    constructor(x, y, opts = {}) {
      super(x, y, 14, 22);
      this.interactable = true; this.prompt = 'Установить чип усиления';
      this.options = opts.options || null;
    }
    update(dt, world) {
      this.t += dt;
      if (!this.options) this.options = world.rng.shuffle(['brutality', 'tactics', 'survival']).slice(0, 2);
      if (G.rand.chance(dt * 6)) {
        const c = G.STAT_COLOR[this.options[G.rand.int(0, 1)]];
        world.fx.particle({ x: this.cx + G.rand.float(-5, 5), y: this.y + 8, vy: -G.rand.float(10, 30), life: 0.7, color: c, additive: true });
      }
    }
    interact(p, world) {
      const opts = this.options || world.rng.shuffle(['brutality', 'tactics', 'survival']).slice(0, 2);
      this.dead = true;
      const apply = (stat) => {
        p.addStat(stat);
        world.fx.ring(p.cx, p.cy, 4, 30, G.STAT_COLOR[stat], 0.5, 2);
        world.fx.burst(p.cx, p.cy, 30, { speed: 120, life: 0.8, color: [G.STAT_COLOR[stat], '#ffffff'], grav: -80, additive: true });
        snd('scroll');
        G.emit('scroll', { stat });
      };
      if (G.ui && G.ui.chooseStat) G.ui.chooseStat(opts, apply);
      else apply(opts[0]);
    }
    draw(ctx, cam) {
      const x = Math.round(this.x - cam.ox), b = Math.round(this.bottom - cam.oy);
      const fy = b - 20 + Math.round(Math.sin(this.t * 2.5) * 2);
      const o = this.options || ['brutality', 'tactics'];
      const c0 = G.STAT_COLOR[o[0]], c1 = G.STAT_COLOR[o[1]];
      // pedestal
      G.px.rect(ctx, x + 1, b - 4, 12, 4, PAL.ink);
      G.px.rect(ctx, x + 2, b - 4, 10, 3, '#2b2a45');
      G.px.rect(ctx, x + 3, b - 4, 8, 1, '#45466a');
      G.px.rect(ctx, x + 4, b - 2, 2, 1, c0); G.px.rect(ctx, x + 8, b - 2, 2, 1, c1);
      // projector beam
      ctx.globalAlpha = 0.25; G.px.rect(ctx, x + 5, fy + 13, 4, b - 4 - (fy + 13), c0); ctx.globalAlpha = 1;
      // chip cartridge
      G.px.rect(ctx, x + 1, fy - 1, 12, 14, PAL.ink);
      G.px.rect(ctx, x + 2, fy, 10, 12, '#123326');
      G.px.rect(ctx, x + 2, fy, 5, 1, c0); G.px.rect(ctx, x + 7, fy, 5, 1, c1);
      G.px.rect(ctx, x + 4, fy + 3, 6, 5, '#1b1a2e');
      const pulse = Math.floor(this.t * 4) % 2;
      G.px.rect(ctx, x + 5, fy + 4, 2, 3, pulse ? c0 : '#ffffff');
      G.px.rect(ctx, x + 7, fy + 4, 2, 3, pulse ? '#ffffff' : c1);
      G.px.rect(ctx, x + 3, fy + 9, 3, 1, '#2e7a4a'); G.px.rect(ctx, x + 8, fy + 9, 3, 1, '#2e7a4a');
      for (let i = 0; i < 5; i++) G.px.rect(ctx, x + 2 + i * 2, fy + 12, 1, 2, PAL.gold);
    }
    drawLight(ctx, cam) {
      const o = this.options || ['brutality', 'tactics'];
      G.drawGlow(ctx, this.cx - 3 - cam.ox, this.y + 8 - cam.oy, 26, G.STAT_COLOR[o[0]], 0.35);
      G.drawGlow(ctx, this.cx + 3 - cam.ox, this.y + 8 - cam.oy, 26, G.STAT_COLOR[o[1]], 0.35);
    }
  }
  G.Scroll = Scroll;

  // ================================================================ food (heal on touch, or bought at the vending machine)
  const FOODS = {
    noodles: { name: 'Лапша быстрого приготовления', heal: 0.3, w: 10, h: 9 },
    stim: { name: 'Стимулятор', heal: 0.2, w: 6, h: 10 },
    burger: { name: 'Синтбургер', heal: 0.45, w: 11, h: 8 },
  };
  G.FOODS = FOODS;
  class Food extends WorldObject {
    constructor(x, y, opts = {}) {
      const type = opts.type || 'noodles', F = FOODS[type] || FOODS.noodles;
      super(x, y, F.w, F.h);
      this.type = type; this.heal = F.heal; this.price = opts.price || 0;
      this.interactable = !!this.price;
    }
    get prompt() { return `Купить: ${FOODS[this.type].name} (+${Math.round(this.heal * 100)}% ОЗ) — ${this.price} кр.`; }
    eat(p, world) {
      p.heal(p.maxHp * this.heal);
      this.dead = true;
      world.fx.burst(this.cx, this.cy, 14, { speed: 80, life: 0.6, color: [PAL.green, '#ffffff'], grav: -60, additive: true });
      world.fx.label(p.cx, p.y - 10, '+' + Math.round(p.maxHp * this.heal), PAL.green, 0.8);
      snd('heal');
    }
    interact(p, world) {
      if (p.gold < this.price) { snd('denied'); world.fx.label(this.cx, this.y - 6, 'NO $', PAL.red); return; }
      p.gold -= this.price; snd('shopBuy');
      this.eat(p, world);
    }
    update(dt, world) {
      this.t += dt;
      if (this.price) return;
      const p = world.player;
      if (p && p.state !== 'dead' && p.hp < p.maxHp && G.overlap(this, p)) this.eat(p, world);
      if (G.rand.chance(dt * 3) && this.type === 'noodles') world.fx.particle({ x: this.cx + G.rand.float(-2, 2), y: this.y, vy: -12, vx: G.rand.float(-4, 4), life: 0.9, color: '#c8c8d8', grav: -5 });
    }
    draw(ctx, cam) {
      const x = Math.round(this.x - cam.ox), y = Math.round(this.y - cam.oy) + (this.price ? Math.round(Math.sin(this.t * 3)) - 3 : 0);
      if (this.type === 'noodles') {
        G.px.rect(ctx, x, y + 1, 10, 8, PAL.ink);
        G.px.rect(ctx, x + 1, y + 2, 8, 6, '#e9e2d0');
        G.px.rect(ctx, x + 1, y + 4, 8, 2, PAL.red); G.px.rect(ctx, x + 3, y + 4, 2, 1, '#ffffff');
        G.px.rect(ctx, x + 2, y + 1, 6, 1, '#f3c56b');
        G.px.rect(ctx, x + 2, y + 7, 6, 1, '#b8b0a0');
        G.px.line(ctx, x + 6, y - 3, x + 8, y + 1, '#a07040', 1); G.px.line(ctx, x + 7, y - 3, x + 9, y + 1, '#a07040', 1);
      } else if (this.type === 'stim') {
        G.px.rect(ctx, x, y, 6, 10, PAL.ink);
        G.px.rect(ctx, x + 1, y + 3, 4, 6, '#d8f0ff');
        G.px.rect(ctx, x + 1, y + 4 + (Math.floor(this.t * 4) % 2), 4, 4, PAL.green);
        G.px.rect(ctx, x + 1, y + 1, 4, 2, '#6f7299'); G.px.rect(ctx, x + 2, y - 2, 2, 3, '#aab0d6');
        G.px.rect(ctx, x + 2, y + 5, 2, 1, '#ffffff');
      } else {
        G.px.rect(ctx, x, y, 11, 8, PAL.ink);
        G.px.rect(ctx, x + 1, y + 1, 9, 2, '#d88a3a'); G.px.rect(ctx, x + 2, y + 1, 1, 1, '#ffe0a0'); G.px.rect(ctx, x + 6, y + 1, 1, 1, '#ffe0a0');
        G.px.rect(ctx, x + 1, y + 3, 9, 1, PAL.lime); G.px.rect(ctx, x + 1, y + 4, 9, 1, '#6a2a3a');
        G.px.rect(ctx, x + 1, y + 5, 9, 1, PAL.magenta); G.px.rect(ctx, x + 1, y + 6, 9, 1, '#c07030');
      }
      if (this.price) G.font.draw(ctx, this.price + '$', Math.round(this.cx - cam.ox), Math.round(this.bottom - cam.oy) + 3, PAL.gold, 1, 'center');
    }
    drawLight(ctx, cam) { G.drawGlow(ctx, this.cx - cam.ox, this.cy - cam.oy, 14, PAL.green, 0.25); }
  }
  G.Food = Food;

  // ================================================================ container (chest) with a neon lock
  class Chest extends WorldObject {
    constructor(x, y, opts = {}) {
      super(x, y, 22, 15);
      this.interactable = true; this.prompt = 'Открыть контейнер'; this.open = false; this.openT = 0;
      this.elite = !!opts.elite;
    }
    update(dt, world) { this.t += dt; if (this.open) this.openT += dt; }
    interact(p, world) {
      if (this.open) return;
      this.open = true; this.interactable = false;
      const R = world.rng;
      const gold = Math.round(R.int(10, 25) * (1 + world.depth) * (this.elite ? 2 : 1));
      world.dropCurrency(this.cx, this.y, R.int(1, 3) + (this.elite ? 3 : 0), gold);
      const inst = G.rollLoot(world, R, null, { bonusQuality: this.elite ? 1 : 0 });
      if (inst) world.addObject(new ItemDrop(this.cx, this.y, inst, { pop: true }));
      if (R.chance(0.3)) world.addObject(Object.assign(new Food(this.cx + 8, this.y, { type: R.pick(['noodles', 'stim', 'burger']) }), { vy: -160, vx: 40 }));
      world.fx.burst(this.cx, this.y, 26, { speed: 170, life: 0.6, color: [PAL.gold, PAL.yellow, '#ffffff', PAL.cyan], shape: 'spark', grav: 300, additive: true });
      world.fx.ring(this.cx, this.cy, 3, 26, PAL.cyan, 0.3, 1);
      world.flashLights.push({ x: this.cx, y: this.y, r: 70, color: PAL.yellow, t: 0, life: 0.3 });
      world.shake(1.5, 0.1);
      snd('chest');
    }
    draw(ctx, cam) {
      const x = Math.round(this.x - cam.ox), y = Math.round(this.y - cam.oy);
      const neon = this.elite ? PAL.gold : PAL.cyan;
      // body
      G.px.rect(ctx, x, y + 4, 22, 11, PAL.ink);
      G.px.rect(ctx, x + 1, y + 5, 20, 9, '#2b2a45');
      G.px.rect(ctx, x + 1, y + 5, 20, 1, '#45466a');
      for (let i = 0; i < 5; i++) G.px.rect(ctx, x + 2 + i * 4, y + 12, 2, 2, i % 2 ? '#1b1a2e' : PAL.yellow); // hazard stripes
      G.px.rect(ctx, x + 1, y + 8, 1, 3, '#6f7299'); G.px.rect(ctx, x + 20, y + 8, 1, 3, '#6f7299');
      if (!this.open) {
        // lid
        G.px.rect(ctx, x - 1, y, 24, 6, PAL.ink);
        G.px.rect(ctx, x, y + 1, 22, 4, '#45466a');
        G.px.rect(ctx, x, y + 1, 22, 1, '#6f7299');
        G.px.rect(ctx, x + 2, y + 5, 18, 1, neon);
        // neon lock panel
        const blink = Math.floor(this.t * 2) % 2;
        G.px.rect(ctx, x + 8, y + 3, 6, 6, PAL.ink);
        G.px.rect(ctx, x + 9, y + 4, 4, 4, blink ? PAL.magenta : '#7a1450');
        G.px.rect(ctx, x + 10, y + 5, 2, 2, '#ffffff');
      } else {
        // lid flipped open behind
        const k = Math.min(1, this.openT / 0.15);
        const ly = y - Math.round(5 * k);
        G.px.rect(ctx, x, ly - 1, 22, 4, PAL.ink);
        G.px.rect(ctx, x + 1, ly, 20, 2, '#45466a');
        G.px.rect(ctx, x + 2, y + 5, 18, 2, '#0b0a14');
        G.px.rect(ctx, x + 9, y + 7, 4, 2, PAL.green); // unlocked panel
      }
    }
    drawLight(ctx, cam) {
      if (!this.open) G.drawGlow(ctx, this.cx - cam.ox, this.y + 6 - cam.oy, 20, PAL.magenta, 0.3 + (Math.floor(this.t * 2) % 2) * 0.15);
      else if (this.openT < 1.2) G.drawGlow(ctx, this.cx - cam.ox, this.y - cam.oy, 40, PAL.yellow, 0.5 * (1 - this.openT / 1.2));
      G.drawGlow(ctx, this.cx - cam.ox, this.y + 6 - cam.oy, 26, this.elite ? PAL.gold : PAL.cyan, 0.18);
    }
  }
  G.Chest = Chest;

  // ================================================================ heal station (medical pod)
  class HealStation extends WorldObject {
    constructor(x, y) { super(x, y, 18, 32); this.interactable = true; this.used = false; this.usedT = 0; }
    get prompt() { return this.used ? 'Медкапсула пуста' : 'Медкапсула: восстановить здоровье и аптечки'; }
    update(dt, world) {
      this.t += dt;
      if (this.used) { this.usedT += dt; return; }
      if (G.rand.chance(dt * 5)) world.fx.particle({ x: this.x + G.rand.float(5, 13), y: this.y + 22, vy: -G.rand.float(8, 20), life: 1.0, color: '#9dffc0', size: 1, grav: 0 });
    }
    interact(p, world) {
      if (this.used) return;
      this.used = true;
      p.hp = p.maxHp; p.flasks = p.maxFlasks; p.recoverable = 0;
      world.fx.ring(p.cx, p.cy, 4, 30, PAL.green, 0.5, 2);
      world.fx.burst(p.cx, p.cy, 30, { speed: 90, life: 0.9, color: [PAL.green, '#ffffff'], grav: -70, additive: true });
      world.flashLights.push({ x: this.cx, y: this.cy, r: 80, color: PAL.green, t: 0, life: 0.4 });
      snd('heal');
      G.emit('heal', { amount: p.maxHp, station: true });
    }
    draw(ctx, cam) {
      const x = Math.round(this.x - cam.ox), y = Math.round(this.y - cam.oy);
      G.px.rect(ctx, x, y, 18, 32, PAL.ink);
      G.px.rect(ctx, x + 1, y + 1, 16, 30, '#2b2a45');
      G.px.rect(ctx, x + 1, y + 1, 16, 2, '#45466a');
      G.px.rect(ctx, x + 1, y + 27, 16, 4, '#1b1a2e');
      // glass tube
      G.px.rect(ctx, x + 3, y + 5, 12, 20, '#0b1a14');
      const lvl = this.used ? 20 : 14 + Math.round(Math.sin(this.t * 2) * 1);
      if (!this.used) {
        G.px.rect(ctx, x + 4, y + 25 - lvl, 10, lvl, '#0f5c3a');
        G.px.rect(ctx, x + 4, y + 25 - lvl, 10, 1, '#4dff9a');
        for (let i = 0; i < 3; i++) G.px.rect(ctx, x + 5 + i * 3, y + 24 - ((Math.floor(this.t * 12) + i * 7) % lvl), 1, 1, '#9dffc0');
      }
      G.px.rect(ctx, x + 4, y + 6, 1, 18, 'rgba(255,255,255,0.18)');
      // cross sign
      const cc = this.used ? '#3a4a40' : PAL.green;
      G.px.rect(ctx, x + 7, y + 28, 4, 2, cc); G.px.rect(ctx, x + 8, y + 27, 2, 4, cc);
      // pipes
      G.px.rect(ctx, x - 2, y + 8, 2, 2, '#45466a'); G.px.rect(ctx, x + 18, y + 14, 2, 2, '#45466a');
    }
    drawLight(ctx, cam) { if (!this.used) G.drawGlow(ctx, this.cx - cam.ox, this.y + 15 - cam.oy, 40, PAL.green, 0.45 + Math.sin(this.t * 2) * 0.05); }
  }
  G.HealStation = HealStation;

  // ================================================================ the Collector (data-priest android)
  class Collector extends WorldObject {
    constructor(x, y) { super(x, y, 22, 44); this.interactable = true; this.interactRange = 22; }
    get prompt() { return 'Коллектор: импланты, чертежи, улучшения'; }
    update(dt, world) {
      this.t += dt;
      if (G.rand.chance(dt * 4)) world.fx.particle({ x: this.cx + G.rand.float(-10, 10), y: this.bottom - 2, vy: -G.rand.float(10, 30), vx: G.rand.float(-5, 5), life: 1.2, color: PAL.cells, additive: true, glow: 3 });
      const p = world.player;
      this.face = p ? G.sign(p.cx - this.cx) || 1 : 1;
    }
    interact(p, world) { if (G.ui && G.ui.openCollector) G.ui.openCollector(world); snd('uiOpen'); }
    draw(ctx, cam) {
      const hover = Math.round(Math.sin(this.t * 1.6) * 1.5);
      const x = Math.round(this.x - cam.ox), y = Math.round(this.y - cam.oy) + hover - 2, f = this.face || 1;
      const robe = '#2a1840', robeL = '#3e2560', trim = PAL.gold;
      // hover emitter shadow
      ctx.globalAlpha = 0.35; G.px.rect(ctx, x + 4, Math.round(this.bottom - cam.oy) - 1, 14, 1, PAL.cells); ctx.globalAlpha = 1;
      // cell tank on the back
      const tx = f > 0 ? x + 1 : x + 13;
      G.px.rect(ctx, tx - 1, y + 9, 10, 18, PAL.ink);
      G.px.rect(ctx, tx, y + 10, 8, 16, '#0b2030');
      const lvl = 11 + Math.round(Math.sin(this.t * 1.3) * 1);
      G.px.rect(ctx, tx + 1, y + 25 - lvl, 6, lvl, '#0e6f99');
      for (let i = 0; i < 4; i++) {
        const by = y + 24 - ((Math.floor(this.t * 9) + i * 5) % lvl);
        G.px.rect(ctx, tx + 2 + (i % 3) * 2, by, 1, 1, i % 2 ? '#bff4ff' : PAL.cells);
      }
      G.px.rect(ctx, tx, y + 9, 8, 1, '#6f7299'); G.px.rect(ctx, tx, y + 26, 8, 1, '#6f7299');
      // robe (tall, flared)
      for (let r = 0; r < 30; r++) {
        const w = 10 + Math.floor(r / 4), yy = y + 12 + r;
        const sway = r > 20 ? Math.round(Math.sin(this.t * 2 + r * 0.3) * 0.6) : 0;
        G.px.rect(ctx, x + 11 - Math.floor(w / 2) + sway - 1, yy, w + 2, 1, PAL.ink);
        G.px.rect(ctx, x + 11 - Math.floor(w / 2) + sway, yy, w, 1, r % 9 === 0 ? robeL : robe);
      }
      G.px.rect(ctx, x + 10, y + 13, 2, 28, trim); // gold seam
      G.px.rect(ctx, x + 3, y + 41, 16, 1, trim);
      // arms holding a data-tablet
      G.px.rect(ctx, x + (f > 0 ? 11 : 5), y + 22, 6, 3, robeL);
      G.px.rect(ctx, x + (f > 0 ? 15 : 1), y + 20, 6, 5, PAL.ink);
      G.px.rect(ctx, x + (f > 0 ? 16 : 2), y + 21, 4, 3, '#0e8fa6');
      G.px.rect(ctx, x + (f > 0 ? 16 : 2), y + 21 + (Math.floor(this.t * 3) % 3), 4, 1, PAL.cyan);
      // hood
      G.px.rect(ctx, x + 5, y + 1, 12, 13, PAL.ink);
      G.px.rect(ctx, x + 6, y + 2, 10, 11, robe);
      G.px.rect(ctx, x + 7, y + 1, 8, 1, robeL);
      G.px.rect(ctx, x + 7, y + 5, 8, 7, '#07050d'); // face void
      const eye = Math.floor(this.t * 0.7) % 7 === 0 && (this.t % 1) < 0.12 ? '#0b2030' : PAL.cells;
      G.px.rect(ctx, x + 11 + f * 1 - 2, y + 7, 2, 1, eye); G.px.rect(ctx, x + 11 + f * 1 + 1, y + 7, 2, 1, eye);
      G.px.rect(ctx, x + 9, y + 10, 4, 1, '#0e6f99'); // mouth grille
      // halo of data
      for (let i = 0; i < 8; i++) {
        const a = this.t * 1.5 + (i * TAU) / 8;
        const hx = x + 11 + Math.cos(a) * 9, hy = y - 2 + Math.sin(a) * 2;
        if (Math.sin(a) < 0) G.px.rect(ctx, hx, hy, 1, 1, i % 2 ? PAL.gold : PAL.cells);
      }
      for (let i = 0; i < 8; i++) {
        const a = this.t * 1.5 + (i * TAU) / 8;
        const hx = x + 11 + Math.cos(a) * 9, hy = y - 2 + Math.sin(a) * 2;
        if (Math.sin(a) >= 0) G.px.rect(ctx, hx, hy, 1, 1, i % 2 ? PAL.gold : PAL.cells);
      }
    }
    drawLight(ctx, cam) {
      G.drawGlow(ctx, this.cx - cam.ox, this.y + 18 - cam.oy, 50, PAL.cells, 0.45);
      G.drawGlow(ctx, this.cx - cam.ox, this.y + 6 - cam.oy, 14, PAL.cells, 0.6);
      G.drawGlow(ctx, this.cx - cam.ox, this.y - 2 - cam.oy, 20, PAL.gold, 0.25);
    }
  }
  G.Collector = Collector;

  // ================================================================ vending machine merchant
  class VendingMachine extends WorldObject {
    constructor(x, y) { super(x, y, 26, 42); this.interactable = false; this.msgT = 0; }
    update(dt) { this.t += dt; }
    draw(ctx, cam) {
      const x = Math.round(this.x - cam.ox), y = Math.round(this.y - cam.oy);
      G.px.rect(ctx, x, y, 26, 42, PAL.ink);
      G.px.rect(ctx, x + 1, y + 1, 24, 40, '#3a2352');
      G.px.rect(ctx, x + 1, y + 1, 24, 2, '#5a3a7a');
      // neon marquee
      const on = Math.floor(this.t * 3) % 8 !== 0;
      G.px.rect(ctx, x + 2, y + 3, 22, 7, '#12081c');
      G.font.draw(ctx, 'SHOP', x + 13, y + 3, on ? PAL.magenta : '#5a1840', 1, 'center', null);
      // display window with product rows
      G.px.rect(ctx, x + 3, y + 12, 14, 20, '#0b1a24');
      for (let r = 0; r < 3; r++) {
        G.px.rect(ctx, x + 3, y + 18 + r * 6, 14, 1, '#45466a');
        for (let i = 0; i < 3; i++) G.px.rect(ctx, x + 5 + i * 4, y + 14 + r * 6, 2, 4, [PAL.red, PAL.yellow, PAL.green, PAL.cyan, PAL.magenta][(r * 3 + i) % 5]);
      }
      G.px.rect(ctx, x + 4, y + 12, 1, 20, 'rgba(255,255,255,0.15)');
      // merchant screen face
      G.px.rect(ctx, x + 18, y + 12, 6, 8, '#0b2030');
      const blink = Math.floor(this.t * 0.8) % 5 === 0 && (this.t % 1) < 0.15;
      G.px.rect(ctx, x + 19, y + 14, 1, blink ? 1 : 2, PAL.cyan); G.px.rect(ctx, x + 22, y + 14, 1, blink ? 1 : 2, PAL.cyan);
      G.px.rect(ctx, x + 19, y + 18, 4, 1, PAL.cyan);
      // coin slot & keypad
      G.px.rect(ctx, x + 19, y + 22, 4, 1, PAL.gold);
      for (let i = 0; i < 4; i++) G.px.rect(ctx, x + 19 + (i % 2) * 2, y + 25 + Math.floor(i / 2) * 2, 1, 1, '#aab0d6');
      // pickup tray
      G.px.rect(ctx, x + 3, y + 34, 14, 4, '#07050d');
      G.px.rect(ctx, x + 1, y + 39, 24, 2, '#2b2a45');
      G.px.rect(ctx, x, y + 1, 1, 40, on ? PAL.magenta : '#5a1840');
    }
    drawLight(ctx, cam) {
      const on = Math.floor(this.t * 3) % 8 !== 0;
      G.drawGlow(ctx, this.cx - cam.ox, this.y + 6 - cam.oy, 40, PAL.magenta, on ? 0.55 : 0.2);
      G.drawGlow(ctx, this.x + 10 - cam.ox, this.y + 22 - cam.oy, 30, PAL.cyan, 0.25);
    }
  }
  G.VendingMachine = VendingMachine;
  // shop pad under items for sale
  class ShopPad extends WorldObject {
    constructor(x, y) { super(x, y, 18, 3); }
    draw(ctx, cam) {
      const x = Math.round(this.x - cam.ox), y = Math.round(this.y - cam.oy);
      G.px.rect(ctx, x, y, 18, 3, PAL.ink); G.px.rect(ctx, x + 1, y, 16, 2, '#2b2a45');
      G.px.rect(ctx, x + 2, y, 14, 1, Math.floor(this.t * 2) % 2 ? PAL.magenta : '#b3125f');
    }
    update(dt) { this.t += dt; }
    drawLight(ctx, cam) { G.drawGlow(ctx, this.cx - cam.ox, this.y - cam.oy, 16, PAL.magenta, 0.3); }
  }

  function makeShop(world, spec) {
    const R = world.rng, L = world.level;
    const vm = new VendingMachine(spec.x, floorY(world, spec.x, spec.y));
    // item slots: 3 weapons/skills + 1 food, both sides of the machine, only where there is floor & headroom
    const offsets = [-34, -58, 34, 58, -82, 82];
    const n = R.chance(0.4) ? 4 : 3;
    let placed = 0, foodDone = false;
    for (const dx of offsets) {
      if (placed >= n && foodDone) break;
      const x = spec.x + dx;
      const gy = floorY(world, x, spec.y, 40);
      if (L.solidAt(x, gy - 8) || L.solidAt(x, gy - 20) || !L.floorAt(x, gy + 2)) continue;
      world.addObject(new ShopPad(x, gy));
      if (placed < n) {
        const inst = G.rollLoot(world, R);
        if (!inst) continue;
        world.addObject(new ItemDrop(x, gy - 2, inst, { price: G.itemPrice(inst, world.depth) }));
        placed++;
      } else if (!foodDone) {
        const type = R.pick(['noodles', 'burger', 'stim']);
        world.addObject(new Food(x, gy - 2, { type, price: Math.round(((type === 'burger' ? 45 : 30) * (1 + world.depth * 0.5)) / 5) * 5 }));
        foodDone = true;
      }
    }
    return vm;
  }
  G.itemPrice = (inst, depth = 0) => Math.round(((50 + 25 * inst.tier) * (1 + depth * 0.5) * (inst.quality === 'legendary' ? 1.9 : inst.quality === 'rare' ? 1.35 : 1)) / 5) * 5;

  // ================================================================ affixes
  // {id, text(RU), kinds:[item kinds], w (weight), dmgMod(p,inst,target), onHit(p,inst,target,dealt,world),
  //  critChance, cdMul, onApply(inst), onParry(p,inst,src,world)}
  const W = ['melee', 'ranged'], WS = ['melee', 'ranged', 'skill'];
  const statusOn = (t) => !!(t && t.statuses);
  G.AFFIXES = [
    { id: 'dmg', text: '+15% урона', kinds: ['melee', 'ranged', 'skill', 'shield'], w: 3, dmgMod: () => 1.15 },
    { id: 'burnBonus', text: '+30% урона по горящим', kinds: WS, w: 2, dmgMod: (p, i, t) => (statusOn(t) && t.statuses.burn ? 1.3 : 1) },
    { id: 'shockBonus', text: '+30% урона по шокированным', kinds: WS, w: 2, dmgMod: (p, i, t) => (statusOn(t) && t.statuses.shock ? 1.3 : 1) },
    { id: 'stunBonus', text: '+35% урона по оглушённым', kinds: WS, w: 2, dmgMod: (p, i, t) => (t && t.stun > 0 ? 1.35 : 1) },
    { id: 'execute', text: '+40% урона по целям с <30% здоровья', kinds: W, w: 2, dmgMod: (p, i, t) => (t && t.maxHp && t.hp < t.maxHp * 0.3 ? 1.4 : 1) },
    { id: 'opener', text: '+30% урона по целям с полным здоровьем', kinds: W, w: 2, dmgMod: (p, i, t) => (t && t.maxHp && t.hp >= t.maxHp ? 1.3 : 1) },
    { id: 'ignite', text: 'Поджигает цель', kinds: WS, w: 3, onHit: (p, inst, t) => { if (!t.dead) t.applyStatus('burn', 2.5, G.itemDamage(p, inst, 1.5)); } },
    { id: 'shock', text: 'Бьёт током', kinds: WS, w: 3, onHit: (p, inst, t) => { if (!t.dead) t.applyStatus('shock', 2, 1); } },
    { id: 'virus', text: 'Удар накладывает Вирус', kinds: WS, w: 2, onHit: (p, inst, t) => { if (!t.dead) t.applyStatus('virus', 5, G.itemDamage(p, inst, 1.5)); } },
    { id: 'chill', text: 'Замедляет цель', kinds: W, w: 2, onHit: (p, inst, t) => { if (!t.dead) t.applyStatus('cryo', 1.5, 1); } },
    { id: 'vamp', text: 'Вампиризм 5%', kinds: W, w: 2, onHit: (p, inst, t, dealt) => { if (p && dealt > 0) p.heal(dealt * 0.05); } },
    { id: 'crit', text: '+15% шанс крита', kinds: W, w: 3, critChance: 0.15 },
    {
      id: 'killBoom', text: 'Убийство вызывает взрыв', kinds: W, w: 1,
      onHit: (p, inst, t, dealt, world) => {
        if (!(t.hp <= 0) || t._boomed) return;
        t._boomed = true;
        const hits = G.explode(world, t.cx, t.cy, { radius: 30, dmg: G.itemDamage(p, inst, 10), color: PAL.orange, info: { kb: 120, kbUp: 100, stun: 0.3 } });
        for (const h of hits) if (p) p.onDealDamage(h.lastDealt || 0, h, inst);
      },
    },
    { id: 'goldKill', text: '+5 кр. за убийство', kinds: W, w: 1, onHit: (p, inst, t, dealt, world) => { if (t.hp <= 0 && !t._goldAff) { t._goldAff = true; world.dropCurrency(t.cx, t.cy, 0, 5); } } },
    { id: 'pierce', text: 'Снаряды пробивают ещё 1 врага', kinds: ['ranged'], w: 2, onApply: (inst) => { inst.extraPierce = (inst.extraPierce || 0) + 1; } },
    { id: 'cdr', text: '-20% перезарядки', kinds: ['skill'], w: 4, cdMul: 0.8 },
    { id: 'skillDmg', text: '+25% урона навыка', kinds: ['skill'], w: 3, dmgMod: () => 1.25 },
    { id: 'parryHeal', text: 'Парирование восстанавливает 8% здоровья', kinds: ['shield'], w: 3, onParry: (p) => { p.heal(p.maxHp * 0.08); } },
    {
      id: 'parryBurn', text: 'Парирование поджигает врагов рядом', kinds: ['shield'], w: 2,
      onParry: (p, inst, src, world) => { for (const t of world.enemies) if (!t.dead && !t.dying && G.dist(t.cx, t.cy, p.cx, p.cy) < 60) t.applyStatus('burn', 3, G.itemDamage(p, inst, 2)); },
    },
    { id: 'parryCd', text: 'Парирование сокращает перезарядку навыков на 2 с', kinds: ['shield'], w: 2, onParry: (p) => { for (const s of ['skill1', 'skill2']) { const it = p.slots[s]; if (it && it.cd > 0) it.cd = Math.max(0, it.cd - 2); } } },
    { id: 'blockPlus', text: 'Блок поглощает на 15% больше урона', kinds: ['shield'], w: 3, onApply: (inst) => { inst.blockBonus = (inst.blockBonus || 0) + 0.15; } },
  ];
  const AFFIX_BY_ID = {};
  for (const a of G.AFFIXES) AFFIX_BY_ID[a.id] = a;
  G.affixById = (id) => AFFIX_BY_ID[id];

  // quality from tier (depth): rare = 1 affix, legendary = 2 affixes + gold aura + 10% damage
  G.rollAffixes = function (inst, rng = G.rand, opts = {}) {
    if (!opts.quality) {
      const t = inst.tier || 0, bonus = opts.bonusQuality || 0;
      const leg = 0.02 + 0.045 * t + 0.08 * bonus, rare = 0.2 + 0.1 * t + 0.2 * bonus;
      const r = rng.next();
      inst.quality = r < leg ? 'legendary' : r < leg + rare ? 'rare' : 'normal';
    }
    const n = inst.quality === 'legendary' ? 2 : inst.quality === 'rare' ? 1 : 0;
    inst.affixes = [];
    const pool = G.AFFIXES.filter((a) => a.kinds.includes(inst.def.kind));
    for (let i = 0; i < n && pool.length; i++) {
      const a = rng.weighted(pool.map((x) => [x, x.w || 1]));
      pool.splice(pool.indexOf(a), 1);
      inst.affixes.push(a);
      if (a.onApply) a.onApply(inst);
    }
    if (opts.affixes) for (const id of opts.affixes) { const a = AFFIX_BY_ID[id]; if (a && !inst.affixes.includes(a)) { inst.affixes.push(a); if (a.onApply) a.onApply(inst); } }
    if (inst.quality === 'legendary') inst.dmgMul = (inst.dmgMul || 1) * 1.1;
    return inst;
  };
  // human-readable item description lines for UI: [{text, color}]
  G.itemLines = function (inst) {
    const lines = [];
    const d = inst.def;
    lines.push({ text: d.desc, color: '#d8d4f0' });
    if (d.cooldown && d.kind === 'skill') lines.push({ text: 'Перезарядка: ' + d.cooldown + ' с', color: '#aab0d6' });
    for (const a of inst.affixes) lines.push({ text: a.text, color: inst.quality === 'legendary' ? PAL.gold : PAL.cyan });
    return lines;
  };

  // ================================================================ loot table
  G.isUnlocked = (id) => {
    const d = G.ITEMS[id];
    if (!d) return false;
    if (!d.blueprint) return true;
    return !!(G.meta && G.meta.unlocked && G.meta.unlocked.includes(id));
  };
  // kind: optional item kind filter; opts: {bonusQuality, tier}
  G.rollLoot = function (world, R, kind, opts = {}) {
    const pool = [];
    for (const id in G.ITEMS) {
      const d = G.ITEMS[id];
      if (!d.drop) continue;
      if (kind && d.kind !== kind) continue;
      if (!G.isUnlocked(id)) continue;
      pool.push([id, d.drop]);
    }
    if (!pool.length) return null;
    const id = R.weighted(pool);
    const tier = opts.tier != null ? opts.tier : Math.max(0, world.depth + (R.chance(0.25) ? 1 : 0));
    return G.makeItem(id, tier, R, { bonusQuality: opts.bonusQuality || 0 });
  };

  // katana + (pistol | kinetic shield). META upgrades (applied by game.js afterwards) may add a skill.
  G.startingLoadout = function (p, rng = G.rand) {
    p.equip(G.makeItem('katana', 0, rng, { quality: 'normal' }), 'primary');
    const second = rng.chance(0.5) ? 'pistol' : 'kshield';
    p.equip(G.makeItem(second, 0, rng, { quality: 'normal' }), 'secondary');
  };

  // ================================================================ blueprints & meta progression
  G.blueprintList = () => Object.values(G.ITEMS).filter((d) => d.blueprint).map((d) => ({ id: d.id, def: d, cost: d.unlockCost || 0, unlocked: G.isUnlocked(d.id) }));
  G.unlockBlueprint = function (id) {
    const def = G.ITEMS[id], p = G.world && G.world.player;
    if (!def || !def.blueprint || !p || !G.meta) return false;
    G.meta.unlocked = G.meta.unlocked || [];
    if (G.meta.unlocked.includes(id)) return false;
    const cost = def.unlockCost || 0;
    if (p.cells < cost) { snd('denied'); return false; }
    p.cells -= cost;
    G.meta.unlocked.push(id);
    G.saveMeta();
    snd('shopBuy');
    G.emit('unlock', { id, def, cost });
    return true;
  };

  // each: {id, name, desc, cost:[per level], apply(p, lvl) at run start, now(p, lvl) immediate effect when bought}
  G.META_UPGRADES = [
    {
      id: 'flask', name: 'Доп. аптечка', desc: '+1 заряд аптечки.', cost: [30, 90, 200],
      apply: (p, lvl) => { p.maxFlasks += lvl; p.flasks = p.maxFlasks; },
      now: (p) => { p.maxFlasks += 1; p.flasks += 1; },
    },
    {
      id: 'hp', name: 'Усиленный каркас', desc: '+10% максимального здоровья.', cost: [40, 110, 240],
      apply: (p, lvl) => { p.hpMul = 1 + 0.1 * lvl; p.recalc(true); },
      now: (p, lvl) => { p.hpMul = 1 + 0.1 * lvl; p.recalc(false); },
    },
    {
      id: 'flaskPower', name: 'Концентрат нанитов', desc: 'Аптечка лечит на 10% больше.', cost: [35, 100],
      apply: (p, lvl) => { p.flaskHeal += 0.1 * lvl; },
      now: (p) => { p.flaskHeal += 0.1; },
    },
    {
      id: 'startSkill', name: 'Тактический модуль', desc: 'Начинать забег со случайным навыком.', cost: [60],
      apply: (p) => {
        const R = (G.game && G.game.runRng) || G.rand;
        const pool = Object.values(G.ITEMS).filter((d) => d.kind === 'skill' && d.drop && G.isUnlocked(d.id)).map((d) => d.id);
        const slot = !p.slots.skill1 ? 'skill1' : !p.slots.skill2 ? 'skill2' : null;
        if (pool.length && slot) p.equip(G.makeItem(R.pick(pool), 0, R, { quality: 'normal' }), slot);
      },
    },
    {
      id: 'startGold', name: 'Подъёмные', desc: '+50 кредитов в начале забега.', cost: [25, 70, 150],
      apply: (p, lvl) => { p.gold += 50 * lvl; },
      now: (p) => { p.gold += 50; },
    },
    {
      id: 'interest', name: 'Банковский вклад', desc: 'В начале каждого уровня +10% к кредитам (до 100).', cost: [50, 140],
      apply: (p, lvl) => { p.interest = 0.1 * lvl; },
      now: (p, lvl) => { p.interest = 0.1 * lvl; },
    },
    {
      id: 'cellMagnet', name: 'Сборщик ядер', desc: '+20% собираемых ядер.', cost: [45, 130],
      apply: (p, lvl) => { p.cellMul = 1 + 0.2 * lvl; },
      now: (p, lvl) => { p.cellMul = 1 + 0.2 * lvl; },
    },
  ];
  G.upgradeList = () => G.META_UPGRADES.map((u) => {
    const lvl = (G.meta && G.meta.upgrades && G.meta.upgrades[u.id]) || 0;
    return { id: u.id, def: u, lvl, max: u.cost.length, cost: lvl < u.cost.length ? u.cost[lvl] : null };
  });
  G.buyUpgrade = function (id) {
    const u = G.META_UPGRADES.find((x) => x.id === id), p = G.world && G.world.player;
    if (!u || !p || !G.meta) return false;
    G.meta.upgrades = G.meta.upgrades || {};
    const lvl = G.meta.upgrades[id] || 0;
    if (lvl >= u.cost.length) return false;
    const cost = u.cost[lvl];
    if (p.cells < cost) { snd('denied'); return false; }
    p.cells -= cost;
    G.meta.upgrades[id] = lvl + 1;
    G.saveMeta();
    if (u.now) u.now(p, lvl + 1);
    snd('shopBuy');
    G.emit('upgrade', { id, def: u, lvl: lvl + 1, cost });
    return true;
  };

  // ================================================================ mutations («Импланты»)
  // def: {id, name, desc, stat, icon(ctx,size), hooks: update(p,dt,world), onIncoming(p,amount,info)->amount,
  //       onDealDamage(p,dealt,target,inst), onRollEnd(p,world), onKill(p,enemy,world), hpMul, dmgMod(p,inst,t),
  //       critChance(p,inst,t), onAdd(p), onRemove(p), onLevel(p,world)}
  // p.mutations holds per-player instances (Object.create(def)) so hooks can keep state on `this`.
  const bestStat = (p) => Math.max(p.statMul('brutality'), p.statMul('tactics'), p.statMul('survival'));
  G.MUTATIONS = [
    {
      id: 'adrenaline', name: 'Адреналин', stat: 'brutality', desc: 'Каждое убийство восстанавливает 5% здоровья.',
      onKill(p, e, world) { const h = p.heal(p.maxHp * 0.05); if (h > 0 && world) world.fx.label(p.cx, p.y - 12, '+' + Math.round(h), PAL.green, 0.6); },
      icon: icon((I) => { I.disc(12, 13, 8, '#8a1020'); I.disc(10, 11, 3, '#ff3348'); I.poly([[3, 13], [7, 13], [9, 9], [12, 18], [15, 8], [17, 13], [21, 13]], '#ffffff'); }),
    },
    {
      id: 'kinetic', name: 'Кинетический отскок', stat: 'tactics', desc: 'В конце кувырка остаётся шоковая мина (не чаще раза в 1.5 с).',
      onRollEnd(p, world) {
        if (world.time < (this.nextT || 0)) return;
        this.nextT = world.time + 1.5;
        world.addObject(new G.ShockMine(p.cx - p.facing * 4, p.bottom, { dmg: Math.round(12 * bestStat(p)) }));
      },
      icon: icon((I) => { I.rect(4, 15, 16, 5, '#2b2a45'); I.rect(7, 13, 10, 2, '#45466a'); I.rect(10, 16, 4, 2, '#27f3ff'); I.poly([[6, 11], [9, 5], [12, 9], [16, 3], [19, 8]], '#27f3ff'); I.dot(19, 8, '#ffffff'); }),
    },
    {
      id: 'berserk', name: 'Берсерк', stat: 'brutality', desc: '+40% урона, пока здоровье ниже 50%.',
      dmgMod: (p) => (p.hp < p.maxHp * 0.5 ? 1.4 : 1),
      update(p, dt, world) { if (p.hp < p.maxHp * 0.5 && G.rand.chance(dt * 8)) world.fx.particle({ x: p.x + G.rand.float(0, p.w), y: p.y + G.rand.float(0, p.h), vy: -40, life: 0.4, color: PAL.red, additive: true, glow: 4 }); },
      icon: icon((I) => { I.disc(12, 12, 8, '#3a0d18'); I.poly([[5, 8], [10, 11], [5, 14]], '#ff3348'); I.poly([[19, 8], [14, 11], [19, 14]], '#ff3348'); I.rect(8, 16, 8, 2, '#ff3348'); I.rect(9, 16, 1, 1, '#ffffff'); I.rect(14, 16, 1, 1, '#ffffff'); }),
    },
    {
      id: 'armor', name: 'Броня', stat: 'survival', desc: 'Получаемый урон снижен на 15%.',
      onIncoming: (p, a) => a * 0.85,
      icon: icon((I) => { I.rect(5, 4, 14, 10, '#45466a'); I.rect(6, 14, 12, 3, '#45466a'); I.rect(8, 17, 8, 2, '#45466a'); I.rect(10, 19, 4, 2, '#45466a'); I.rect(6, 5, 12, 1, '#aab0d6'); I.rect(11, 5, 2, 14, '#4dff7a'); }),
    },
    {
      id: 'economy', name: 'Экономия', stat: 'tactics', desc: 'Навыки перезаряжаются на 25% быстрее.',
      onAdd(p) { p.cdMul = (p.cdMul || 1) * 0.75; }, onRemove(p) { p.cdMul = (p.cdMul || 1) / 0.75; },
      icon: icon((I) => { I.ring(12, 12, 8, '#b46cff', 2); I.line(12, 12, 12, 6, '#ffffff', 1); I.line(12, 12, 16, 14, '#ffffff', 1); I.poly([[19, 3], [21, 7], [17, 7]], '#b46cff'); }),
    },
    {
      id: 'greed', name: 'Жадность', stat: 'tactics', desc: '+50% кредитов.',
      onAdd(p) { p.goldMul = (p.goldMul || 1) * 1.5; }, onRemove(p) { p.goldMul = (p.goldMul || 1) / 1.5; },
      icon: icon((I) => { I.disc(9, 14, 6, '#8a5a12'); I.disc(9, 13, 5, '#ffc23d'); I.disc(15, 9, 6, '#8a5a12'); I.disc(15, 8, 5, '#ffc23d'); I.rect(14, 5, 2, 7, '#fff2b0'); I.rect(8, 11, 2, 5, '#fff2b0'); }),
    },
    {
      id: 'secondChance', name: 'Второй шанс', stat: 'survival', desc: 'Раз за уровень смертельный удар оставляет 1 ОЗ и даёт 2 с неуязвимости.',
      onIncoming(p, amount) {
        if (this.used || amount < p.hp || G.debug.god) return amount;
        this.used = true;
        p.invuln = Math.max(p.invuln, 2);
        const w = G.world;
        if (w) {
          w.fx.ring(p.cx, p.cy, 4, 40, PAL.survival, 0.5, 2); w.fx.flash(PAL.survival, 0.12);
          w.fx.label(p.cx, p.y - 16, 'SECOND CHANCE', PAL.survival, 1.2); w.hitstop(0.15);
        }
        snd('parry', { pitch: 0.7 });
        p.hp = Math.min(p.hp, 1);
        return 0;
      },
      onLevel() { this.used = false; },
      icon: icon((I) => { I.rect(10, 3, 4, 18, '#4dff7a'); I.rect(4, 9, 16, 4, '#4dff7a'); I.rect(11, 4, 2, 16, '#c8ffd8'); I.ring(12, 12, 10, '#1f8a44'); }),
    },
    {
      id: 'acrobat', name: 'Акробат', stat: 'tactics', desc: 'Ещё один прыжок в воздухе, кувырок длиннее на 15%.',
      onAdd(p) { p.airJumps = (p.airJumps || 1) + 1; p.rollMul = (p.rollMul || 1) * 1.15; },
      onRemove(p) { p.airJumps = Math.max(1, (p.airJumps || 2) - 1); p.rollMul = (p.rollMul || 1) / 1.15; },
      icon: icon((I) => { I.poly([[4, 20], [8, 12], [12, 8], [16, 10], [20, 4]], '#b46cff'); I.ring(8, 16, 2, '#27f3ff'); I.ring(16, 8, 2, '#27f3ff'); I.dot(20, 4, '#ffffff'); }),
    },
    {
      id: 'titan', name: 'Титановый каркас', stat: 'survival', desc: '+25% максимального здоровья.',
      hpMul: 1.25,
      icon: icon((I) => { I.rect(7, 3, 10, 18, '#6f7299'); I.rect(8, 4, 8, 16, '#aab0d6'); for (let y = 6; y < 20; y += 4) I.rect(5, y, 14, 2, '#45466a'); I.rect(11, 3, 2, 18, '#4dff7a'); }),
    },
    {
      id: 'combo', name: 'Комбо-процессор', stat: 'brutality', desc: 'Каждое попадание подряд даёт +4% урона (до +40%). Сбрасывается через 1.5 с без попаданий.',
      onDealDamage(p, dealt) { if (dealt > 0) { this.stacks = Math.min(10, (this.stacks || 0) + 1); this.idle = 0; } },
      update(p, dt) { this.idle = (this.idle || 0) + dt; if (this.idle > 1.5) this.stacks = 0; },
      dmgMod() { return 1 + 0.04 * (this.stacks || 0); },
      icon: icon((I) => { for (let i = 0; i < 4; i++) I.rect(4 + i * 4, 18 - i * 4, 3, 3 + i * 4, i === 3 ? '#ffffff' : '#ff3d4f'); I.poly([[3, 6], [9, 4], [7, 9]], '#ffe14d'); }),
    },
    {
      id: 'detonator', name: 'Детонатор', stat: 'brutality', desc: 'Убитые враги взрываются, раня соседей.',
      onKill(p, e, world) {
        if (!world || !e) return;
        const hits = G.explode(world, e.cx, e.cy, { radius: 34, dmg: Math.round(10 * bestStat(p)), color: PAL.orange, info: { kb: 120, kbUp: 100, stun: 0.3 } });
        for (const h of hits) p.onDealDamage(h.lastDealt || 0, h, null);
      },
      icon: icon((I) => { I.disc(12, 13, 7, '#b34a12'); I.disc(12, 13, 4, '#ffe14d'); I.disc(12, 13, 2, '#ffffff'); for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; I.line(12 + Math.cos(a) * 8, 13 + Math.sin(a) * 8, 12 + Math.cos(a) * 11, 13 + Math.sin(a) * 11, '#ff8a2a', 1); } }),
    },
    {
      id: 'coolant', name: 'Хладагент', stat: 'tactics', desc: 'Каждое убийство сокращает перезарядку навыков на 1 с.',
      onKill(p) { for (const s of ['skill1', 'skill2']) { const it = p.slots[s]; if (it && it.cd > 0) it.cd = Math.max(0, it.cd - 1); } },
      icon: icon((I) => { I.line(12, 2, 12, 22, '#9fe8ff', 1); I.line(3, 7, 21, 17, '#9fe8ff', 1); I.line(3, 17, 21, 7, '#9fe8ff', 1); I.disc(12, 12, 3, '#3f8fc8'); I.dot(12, 12, '#ffffff'); for (const [x, y] of [[12, 4], [12, 20], [5, 8], [19, 16], [5, 16], [19, 8]]) I.dot(x, y, '#ffffff'); }),
    },
    {
      id: 'static', name: 'Статический заряд', stat: 'survival', desc: 'Удары ближнего боя с шансом 25% бьют током (+25% получаемого урона).',
      onDealDamage(p, dealt, target, inst) { if (inst && inst.def.kind === 'melee' && target && !target.dead && G.rand.chance(0.25)) target.applyStatus('shock', 2.5, 1); },
      icon: icon((I) => { I.rect(5, 16, 14, 4, '#45466a'); I.poly([[14, 2], [9, 10], [14, 10], [9, 18]], '#27f3ff'); I.poly([[15, 2], [10, 10]], '#ffffff'); I.dot(4, 6, '#27f3ff'); I.dot(20, 9, '#27f3ff'); }),
    },
    {
      id: 'nanoshield', name: 'Нанощит', stat: 'survival', desc: 'Раз в 12 с полностью поглощает один удар.',
      update(p, dt, world) {
        this.cd = Math.max(0, (this.cd || 0) - dt);
        if (this.cd <= 0 && world && G.rand.chance(dt * 6)) { const a = G.rand.float(0, TAU); world.fx.particle({ x: p.cx + Math.cos(a) * 12, y: p.cy + Math.sin(a) * 14, life: 0.3, color: PAL.cyan, additive: true }); }
      },
      onIncoming(p, amount) {
        if ((this.cd || 0) > 0 || amount <= 0) return amount;
        this.cd = 12;
        const w = G.world;
        if (w) { w.fx.ring(p.cx, p.cy, 6, 18, PAL.cyan, 0.3, 2); w.fx.label(p.cx, p.y - 12, 'ABSORB', PAL.cyan, 0.6); }
        snd('shield', { pitch: 1.4 });
        p.invuln = Math.max(p.invuln, 0.5);
        return 0;
      },
      icon: icon((I) => { for (let y = 3; y <= 21; y++) { const hw = y < 8 ? Math.round((y - 3) * 1.6) : y < 16 ? 8 : Math.round((21 - y) * 1.6); I.dot(12 - hw, y, '#27f3ff'); I.dot(12 + hw, y, '#27f3ff'); } I.rect(10, 8, 5, 8, '#0e8fa6'); I.rect(11, 9, 3, 6, '#9ffcff'); }),
    },
    {
      id: 'marksman', name: 'Снайперский модуль', stat: 'tactics', desc: '+20% шанса крита для оружия дальнего боя.',
      critChance: (p, inst) => (inst && inst.def.kind === 'ranged' ? 0.2 : 0),
      icon: icon((I) => { I.ring(12, 12, 8, '#b46cff', 1); I.ring(12, 12, 4, '#b46cff', 1); I.line(12, 1, 12, 23, '#ffffff', 1); I.line(1, 12, 23, 12, '#ffffff', 1); I.rect(11, 11, 3, 3, '#ff3348'); }),
    },
  ];
  const MUT_BY_ID = {};
  for (const m of G.MUTATIONS) MUT_BY_ID[m.id] = m;
  G.mutationById = (id) => MUT_BY_ID[id];

  const mutIconCache = new Map();
  G.mutationIcon = function (def, size = 24) {
    def = def.def || def;
    const key = def.id + '|' + size;
    let c = mutIconCache.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = size;
    try { if (def.icon) def.icon(c.getContext('2d'), size); G.outlineCanvas(c); } catch (e) { console.error('[mutation icon ' + def.id + ']', e); }
    mutIconCache.set(key, c);
    return c;
  };
  G.MAX_MUTATIONS = 3;
  // 3 random mutation defs the player doesn't own yet
  G.offerMutations = function (rng = G.rand, player, n = 3) {
    const owned = new Set((player && player.mutations ? player.mutations : []).map((m) => m.id));
    const pool = G.MUTATIONS.filter((m) => !owned.has(m.id));
    return rng.shuffle(pool.slice()).slice(0, n);
  };
  // adds a mutation (max 3). replaceIndex: slot to overwrite when full. Returns the new instance or null.
  G.addMutation = function (p, def, replaceIndex) {
    def = def && def.def ? def.def : def;
    if (!p || !def || p.mutations.some((m) => m.id === def.id)) return null;
    if (p.mutations.length >= G.MAX_MUTATIONS) {
      if (replaceIndex == null || !p.mutations[replaceIndex]) return null;
      G.removeMutation(p, replaceIndex);
    }
    const m = Object.create(def);
    m.def = def;
    if (replaceIndex != null && replaceIndex <= p.mutations.length) p.mutations.splice(replaceIndex, 0, m); else p.mutations.push(m);
    if (m.onAdd) m.onAdd(p);
    p.recalc(false);
    const w = G.world;
    if (w) {
      w.fx.ring(p.cx, p.cy, 4, 34, G.STAT_COLOR[def.stat] || PAL.cyan, 0.5, 2);
      w.fx.burst(p.cx, p.cy, 24, { speed: 110, life: 0.8, color: [G.STAT_COLOR[def.stat] || PAL.cyan, '#ffffff'], grav: -60, additive: true });
    }
    snd('scroll', { pitch: 1.2 });
    G.emit('mutation', def);
    return m;
  };
  G.removeMutation = function (p, index) {
    const m = p.mutations[index];
    if (!m) return null;
    p.mutations.splice(index, 1);
    if (m.onRemove) m.onRemove(p);
    p.recalc(false);
    return m;
  };
  // mutation-driven crit chance (read by G.rollCrit through p.critChance getter-free path)
  const baseRollCrit = G.rollCrit;
  G.rollCrit = function (p, inst, target, cond) {
    if (cond) return true;
    if (p && p.mutations) {
      let extra = 0;
      for (const m of p.mutations) if (m.critChance) extra += typeof m.critChance === 'function' ? m.critChance(p, inst, target) || 0 : m.critChance;
      if (extra > 0 && G.rand.chance(extra)) return true;
    }
    return baseRollCrit(p, inst, target, false);
  };

  // hooks driven by events
  G.on('enemyKilled', (e) => {
    const w = G.world, p = w && w.player;
    if (!p || p.state === 'dead' || !p.mutations) return;
    for (const m of p.mutations) if (m.onKill) { try { m.onKill(p, e && e.enemy, w); } catch (err) { console.error('[mutation onKill]', err); } }
  });
  G.on('levelStart', (e) => {
    const w = (e && e.world) || G.world, p = w && w.player;
    if (!p) return;
    for (const m of p.mutations || []) if (m.onLevel) m.onLevel(p, w);
    // «Банковский вклад»: interest on carried credits
    if (p.interest && p.gold > 0) {
      const gain = Math.min(100, Math.round(p.gold * p.interest));
      if (gain > 0) { p.gold += gain; if (w.fx) w.fx.label(p.cx, p.y - 14, '+' + gain + '$', PAL.gold, 1.5); }
    }
    // re-attach the overload aura if a buff carried over from the previous level
    if (p.overloadUntil && G.game && p.overloadUntil > G.game.runTime && G.Effect) {
      // aura is purely cosmetic; skip re-creating to keep it simple
    }
  });

  // ================================================================ object factories
  G.OBJECTS.chest = (w, s) => new Chest(s.x, floorY(w, s.x, s.y), s);
  G.OBJECTS.scroll = (w, s) => new Scroll(s.x, floorY(w, s.x, s.y), s);
  G.OBJECTS.food = (w, s) => new Food(s.x, floorY(w, s.x, s.y), { type: s.type || w.rng.pick(['noodles', 'noodles', 'burger', 'stim']) });
  G.OBJECTS.weapon = (w, s) => { const inst = G.rollLoot(w, w.rng, s.itemKind); return inst ? new ItemDrop(s.x, s.y, inst) : null; };
  G.OBJECTS.healstation = (w, s) => new HealStation(s.x, floorY(w, s.x, s.y));
  G.OBJECTS.collector = (w, s) => new Collector(s.x, floorY(w, s.x, s.y));
  G.OBJECTS.shop = (w, s) => makeShop(w, s);
})();
