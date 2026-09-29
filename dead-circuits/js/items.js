'use strict';
// World objects & pickups: currency, item drops, power scrolls, food, chests, shop, collector, heal station.
// Level objects are created through G.OBJECTS[kind](world, spec) where spec = {kind, x, y, ...} (feet position).
(function () {
  const G = window.G;
  const PAL = G.PAL;

  G.OBJECTS = {};

  // ---------------------------------------------------------------- base object
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

  // ---------------------------------------------------------------- currency
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
          if (this.kind === 'cells') p.cells += this.value; else p.gold += this.value;
          if (G.audio) G.audio.play(this.kind === 'cells' ? 'pickupCell' : 'pickupGold', { vol: 0.5 });
          G.emit('pickup', { kind: this.kind, value: this.value });
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
        G.px.rect(ctx, x, y, 4, 4, '#8a5a12'); G.px.rect(ctx, x, y, 3, 3, PAL.gold);
        G.px.rect(ctx, x + 1, y + 1, 1, 1, '#fff2b0');
      }
    }
    drawLight(ctx, cam) {
      G.drawGlow(ctx, this.cx - cam.ox, this.cy - cam.oy, this.kind === 'cells' ? 14 : 8, this.kind === 'cells' ? PAL.cells : PAL.gold, 0.5);
    }
  }
  G.Currency = Currency;

  // ---------------------------------------------------------------- item on the ground
  class ItemDrop extends WorldObject {
    constructor(x, y, inst, opts = {}) {
      super(x, y, 16, 16);
      this.inst = inst; this.interactable = true;
      this.vy = opts.pop ? -200 : 0; this.vx = opts.pop ? G.rand.float(-60, 60) : 0;
      this.price = opts.price || 0; this.shop = opts.shop || null;
    }
    get prompt() {
      const name = G.itemName(this.inst);
      return this.price ? `Купить: ${name} — ${this.price} кр.` : `Взять: ${name}`;
    }
    update(dt, world) { this.t += dt; fall(this, dt, world.level, 0.2); }
    interact(p, world) {
      if (this.price) {
        if (p.gold < this.price) { if (G.audio) G.audio.play('denied'); world.fx.label(this.cx, this.y - 6, 'NO $', PAL.red); return; }
        p.gold -= this.price; this.price = 0;
        if (G.audio) G.audio.play('shopBuy');
      }
      const old = p.equip(this.inst);
      if (G.audio) G.audio.play('pickupItem');
      G.emit('pickup', { kind: 'item', inst: this.inst });
      if (old) { this.inst = old; this.vy = -150; this.t = 0; }
      else this.dead = true;
      world.fx.ring(this.cx, this.cy, 2, 16, G.STAT_COLOR[(this.inst.def.stat || 'tactics')] || PAL.cyan, 0.3, 1);
    }
    draw(ctx, cam) {
      const bob = Math.round(Math.sin(this.t * 3) * 1.5);
      const icon = G.itemIcon(this.inst.def, 16);
      const x = Math.round(this.x - cam.ox), y = Math.round(this.y - cam.oy) + bob - 2;
      ctx.drawImage(icon, x, y);
      if (this.price) G.font.draw(ctx, this.price + '$', Math.round(this.cx - cam.ox), Math.round(this.bottom - cam.oy) + 2, PAL.gold, 1, 'center');
    }
    drawLight(ctx, cam) {
      const c = G.STAT_COLOR[this.inst.def.stat] || PAL.cyan;
      G.drawGlow(ctx, this.cx - cam.ox, this.cy - cam.oy, 22, c, 0.45 + Math.sin(this.t * 3) * 0.1);
    }
  }
  G.ItemDrop = ItemDrop;

  // ---------------------------------------------------------------- power scroll ("чип усиления")
  class Scroll extends WorldObject {
    constructor(x, y, opts = {}) {
      super(x, y, 12, 14);
      this.interactable = true; this.prompt = 'Установить чип усиления';
      this.options = opts.options || null;
    }
    update(dt, world) { this.t += dt; }
    interact(p, world) {
      const R = world.rng;
      const all = ['brutality', 'tactics', 'survival'];
      const opts = this.options || R.shuffle(all.slice()).slice(0, 2);
      this.dead = true;
      const apply = (stat) => {
        p.addStat(stat);
        world.fx.ring(p.cx, p.cy, 4, 30, G.STAT_COLOR[stat], 0.5, 2);
        world.fx.burst(p.cx, p.cy, 30, { speed: 120, life: 0.8, color: [G.STAT_COLOR[stat], '#ffffff'], grav: -80, additive: true });
        if (G.audio) G.audio.play('scroll');
        G.emit('scroll', { stat });
      };
      if (G.ui && G.ui.chooseStat) G.ui.chooseStat(opts, apply);
      else apply(opts[0]);
    }
    draw(ctx, cam) {
      const x = Math.round(this.x - cam.ox), y = Math.round(this.y - cam.oy) + Math.round(Math.sin(this.t * 2.5) * 2);
      G.px.rect(ctx, x + 1, y, 10, 13, PAL.ink);
      G.px.rect(ctx, x + 2, y + 1, 8, 11, '#1d3b2c');
      const c = [PAL.brutality, PAL.tactics, PAL.survival][Math.floor(this.t * 2) % 3];
      G.px.rect(ctx, x + 3, y + 2, 6, 1, c); G.px.rect(ctx, x + 3, y + 5, 4, 1, c); G.px.rect(ctx, x + 3, y + 8, 6, 1, c);
      for (let i = 0; i < 4; i++) G.px.rect(ctx, x + 2 + i * 2, y + 12, 1, 2, PAL.gold);
    }
    drawLight(ctx, cam) { G.drawGlow(ctx, this.cx - cam.ox, this.cy - cam.oy, 30, PAL.survival, 0.4); }
  }
  G.Scroll = Scroll;

  // ---------------------------------------------------------------- food (heal on touch)
  class Food extends WorldObject {
    constructor(x, y) { super(x, y, 10, 8); this.heal = 0.3; }
    update(dt, world) {
      this.t += dt;
      const p = world.player;
      if (p && p.state !== 'dead' && p.hp < p.maxHp && G.overlap(this, p)) {
        p.heal(p.maxHp * this.heal);
        this.dead = true;
        world.fx.burst(this.cx, this.cy, 14, { speed: 80, life: 0.6, color: [PAL.green, '#ffffff'], grav: -60, additive: true });
        if (G.audio) G.audio.play('heal');
      }
    }
    draw(ctx, cam) {
      const x = Math.round(this.x - cam.ox), y = Math.round(this.y - cam.oy);
      // noodle cup
      G.px.rect(ctx, x, y, 10, 8, PAL.ink);
      G.px.rect(ctx, x + 1, y + 2, 8, 6, '#e9e2d0');
      G.px.rect(ctx, x + 1, y + 4, 8, 1, PAL.red);
      G.px.rect(ctx, x + 2, y + 1, 6, 1, '#f3c56b');
      G.px.line(ctx, x + 6, y - 3, x + 8, y + 1, '#a07040', 1);
    }
  }

  // ---------------------------------------------------------------- chest
  class Chest extends WorldObject {
    constructor(x, y, opts = {}) {
      super(x, y, 20, 13);
      this.interactable = true; this.prompt = 'Открыть контейнер'; this.open = false;
    }
    interact(p, world) {
      if (this.open) return;
      this.open = true; this.interactable = false;
      const R = world.rng;
      world.dropCurrency(this.cx, this.y, R.int(1, 3), R.int(10, 25) * (1 + world.depth));
      const inst = G.rollLoot(world, R);
      if (inst) world.addObject(new ItemDrop(this.cx, this.y, inst, { pop: true }));
      world.fx.burst(this.cx, this.y, 20, { speed: 150, life: 0.5, color: [PAL.gold, PAL.yellow, '#ffffff'], shape: 'spark', grav: 300, additive: true });
      if (G.audio) G.audio.play('chest');
    }
    draw(ctx, cam) {
      const x = Math.round(this.x - cam.ox), y = Math.round(this.y - cam.oy);
      G.px.rect(ctx, x, y + (this.open ? 4 : 0), 20, this.open ? 9 : 13, PAL.ink);
      G.px.rect(ctx, x + 1, y + 5, 18, 7, '#34334f');
      if (!this.open) { G.px.rect(ctx, x + 1, y + 1, 18, 4, '#45466a'); G.px.rect(ctx, x + 8, y + 3, 4, 4, PAL.yellow); }
      G.px.rect(ctx, x + 1, y + 11, 18, 1, PAL.cyan);
    }
    drawLight(ctx, cam) { if (!this.open) G.drawGlow(ctx, this.cx - cam.ox, this.cy - cam.oy, 22, PAL.yellow, 0.3); }
  }

  // ---------------------------------------------------------------- heal station (transit)
  class HealStation extends WorldObject {
    constructor(x, y) { super(x, y, 16, 30); this.interactable = true; this.used = false; }
    get prompt() { return this.used ? 'Станция пуста' : 'Восстановить здоровье и аптечки'; }
    interact(p, world) {
      if (this.used) return;
      this.used = true;
      p.hp = p.maxHp; p.flasks = p.maxFlasks; p.recoverable = 0;
      world.fx.ring(p.cx, p.cy, 4, 30, PAL.green, 0.5, 2);
      if (G.audio) G.audio.play('heal');
    }
    draw(ctx, cam) {
      const x = Math.round(this.x - cam.ox), y = Math.round(this.y - cam.oy);
      G.px.rect(ctx, x, y, 16, 30, PAL.ink);
      G.px.rect(ctx, x + 1, y + 1, 14, 28, '#2b2a45');
      G.px.rect(ctx, x + 3, y + 4, 10, 12, this.used ? '#1a2a22' : '#0f5c3a');
      if (!this.used) { G.px.rect(ctx, x + 7, y + 6, 2, 8, PAL.green); G.px.rect(ctx, x + 4, y + 9, 8, 2, PAL.green); }
    }
    drawLight(ctx, cam) { if (!this.used) G.drawGlow(ctx, this.cx - cam.ox, this.y + 10 - cam.oy, 34, PAL.green, 0.45); }
  }

  // ---------------------------------------------------------------- collector (spend cells)
  class Collector extends WorldObject {
    constructor(x, y) { super(x, y, 20, 34); this.interactable = true; this.prompt = 'Коллектор: потратить ядра'; }
    interact(p, world) { if (G.ui && G.ui.openCollector) G.ui.openCollector(world); }
    draw(ctx, cam) {
      const x = Math.round(this.x - cam.ox), y = Math.round(this.y - cam.oy);
      G.px.rect(ctx, x + 2, y, 16, 34, PAL.ink);
      G.px.rect(ctx, x + 3, y + 1, 14, 32, '#3a2352');
      G.px.rect(ctx, x + 6, y + 5, 8, 6, PAL.cells);
      G.px.rect(ctx, x + 8, y + 7, 2, 2, '#ffffff');
    }
    drawLight(ctx, cam) { G.drawGlow(ctx, this.cx - cam.ox, this.y + 8 - cam.oy, 40, PAL.cells, 0.5); }
  }

  // ---------------------------------------------------------------- shop (items for gold)
  function makeShop(world, spec) {
    const R = world.rng;
    for (let i = 0; i < 3; i++) {
      const inst = G.rollLoot(world, R);
      if (!inst) continue;
      const price = Math.round((60 + 30 * inst.tier) * (1 + world.depth * 0.8));
      world.addObject(new ItemDrop(spec.x + (i - 1) * 26, spec.y, inst, { price }));
    }
    return null;
  }

  // ---------------------------------------------------------------- loot table
  G.rollLoot = function (world, R, kind) {
    const pool = [];
    const unlocked = (G.meta && G.meta.unlocked) || null;
    for (const id in G.ITEMS) {
      const d = G.ITEMS[id];
      if (!d.drop) continue;
      if (kind && d.kind !== kind) continue;
      if (d.blueprint && unlocked && !unlocked.includes(id)) continue;
      pool.push([id, d.drop]);
    }
    if (!pool.length) return null;
    const id = R.weighted(pool);
    const tier = Math.max(0, world.depth + (R.chance(0.25) ? 1 : 0));
    return G.makeItem(id, tier, R);
  };

  G.startingLoadout = function (p) {
    p.equip(G.makeItem('katana', 0), 'primary');
    p.equip(G.makeItem('pistol', 0), 'secondary');
  };

  // meta upgrades bought at the collector with cells (persist between runs)
  G.META_UPGRADES = [
    { id: 'flask', name: 'Доп. аптечка', desc: '+1 заряд аптечки', cost: [40, 120, 300], apply: (p, lvl) => { p.maxFlasks += lvl; p.flasks = p.maxFlasks; } },
    { id: 'hp', name: 'Усиленный каркас', desc: '+10% макс. здоровья', cost: [60, 160, 360], apply: (p, lvl) => { p.hpMul = 1 + 0.1 * lvl; p.recalc(true); } },
  ];

  G.OBJECTS.chest = (w, s) => new Chest(s.x, s.y, s);
  G.OBJECTS.scroll = (w, s) => new Scroll(s.x, s.y, s);
  G.OBJECTS.food = (w, s) => new Food(s.x, s.y);
  G.OBJECTS.weapon = (w, s) => { const inst = G.rollLoot(w, w.rng); return inst ? new ItemDrop(s.x, s.y, inst) : null; };
  G.OBJECTS.healstation = (w, s) => new HealStation(s.x, s.y);
  G.OBJECTS.collector = (w, s) => new Collector(s.x, s.y);
  G.OBJECTS.shop = (w, s) => makeShop(w, s);
})();
