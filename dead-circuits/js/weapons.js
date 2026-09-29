'use strict';
// Item system: definitions, instances, player actions (melee combos, ranged, skills), held-weapon drawing.
(function () {
  const G = window.G;
  const PAL = G.PAL;

  G.ITEMS = {};
  // def: {id, name, desc, kind:'melee'|'ranged'|'shield'|'skill', stat:'brutality'|'tactics'|'survival',
  //       rarity weight `drop` (0 = never drops), `start` (starter only), use(p, inst, world, button) -> Action,
  //       drawHeld(ctx, x, y, ang, p, inst), drawIcon(ctx, size), cooldown (skills), ...}
  G.defineItem = function (def) {
    def.drop = def.drop == null ? 1 : def.drop;
    G.ITEMS[def.id] = def;
    return def;
  };

  // tier: 0.. (shown as "+N"), quality 'normal'|'rare'|'legendary'
  G.makeItem = function (id, tier = 0, rng = G.rand, opts = {}) {
    const def = G.ITEMS[id];
    if (!def) throw new Error('Unknown item ' + id);
    const inst = { id, def, tier, cd: 0, affixes: [], quality: opts.quality || 'normal', uid: Math.floor(rng.next() * 1e9) };
    if (G.rollAffixes) G.rollAffixes(inst, rng);
    return inst;
  };
  G.itemName = (inst) => inst.def.name + (inst.tier > 0 ? ' +' + inst.tier : '');

  // Damage scaling: base * tier * stat scrolls * affix multipliers
  G.itemDamage = function (p, inst, base, target) {
    let d = base * (1 + 0.22 * inst.tier) * p.statMul(inst.def.stat);
    if (inst.dmgMul) d *= inst.dmgMul;
    if (p.dmgMul) d *= p.dmgMul;
    for (const a of inst.affixes) if (a.dmgMod) d *= a.dmgMod(p, inst, target) || 1;
    return Math.max(1, Math.round(d));
  };

  // Called by weapons when they damage something (affixes / mutations hook here)
  G.onItemHit = function (p, inst, target, dealt, world) {
    for (const a of inst.affixes) if (a.onHit) a.onHit(p, inst, target, dealt, world);
    p.onDealDamage(dealt, target, inst);
  };

  // ---------------------------------------------------------------- Action base
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

  // ---------------------------------------------------------------- Melee combos
  // step: {wind, active, rec, dmg, reach, h, yOff, arc:[a0,a1] (radians, 0 = forward, -PI/2 = up),
  //        lunge, kb, kbUp, stun, sfx, trail, crit:(p,target,stepIndex)=>bool, shake, hitstop, box(p)->{x,y,w,h}, status}
  class MeleeAction extends Action {
    constructor(p, inst, button) {
      super(p, inst, button);
      this.steps = this.def.combo;
      this.i = 0; this.queued = false;
      this.startStep(0);
    }
    startStep(i) {
      this.i = i; this.t = 0; this.phase = 'wind'; this.hitSet = new Set(); this.queued = false; this.hitAny = false;
      const s = this.steps[i];
      this.s = s;
      this.cancelable = false;
      // turn to the input direction at the start of each swing
      const ix = (G.input.down('right') ? 1 : 0) - (G.input.down('left') ? 1 : 0);
      if (ix) this.p.facing = ix;
      if (G.audio) G.audio.play(s.sfx || 'slash' + ((i % 3) + 1), { pitch: s.pitch });
    }
    press() { if (this.phase !== 'wind') this.queued = true; }
    update(dt, world) {
      const p = this.p, s = this.s;
      this.t += dt;
      if (this.phase === 'wind' && this.t >= s.wind) {
        this.phase = 'active'; this.t = 0;
        if (s.lunge) p.vx = p.facing * s.lunge;
        if (s.lungeUp) p.vy = -s.lungeUp;
        const cx = p.cx + p.facing * 4, cy = p.y + (s.yOff || 0) + (s.h || 20) / 2;
        const a0 = s.arc[0], a1 = s.arc[1];
        const toWorld = (a) => (p.facing > 0 ? a : Math.PI - a);
        world.fx.slash(cx, cy, s.reach * 0.85, toWorld(a0), toWorld(a1), s.trail || this.def.trail || PAL.cyan, s.active + 0.1, s.trailW || 5);
      }
      if (this.phase === 'active') {
        const box = s.box ? s.box(p) : {
          x: p.facing > 0 ? p.x + p.w - 6 : p.x + 6 - s.reach, y: p.y + (s.yOff || 0), w: s.reach, h: s.h || 20,
        };
        const def = this.def, inst = this.inst, idx = this.i;
        const hits = G.hitBox(world, box, 'player', (t) => {
          const crit = s.crit ? s.crit(p, t, idx) : (def.crit ? def.crit(p, t, idx) : false);
          t._pendingCrit = crit;
          return G.itemDamage(p, inst, s.dmg * (crit ? (def.critMul || 1.75) : 1), t);
        }, { dir: p.facing, kb: s.kb == null ? 90 : s.kb, kbUp: s.kbUp || 0, stun: s.stun == null ? 0.12 : s.stun, status: s.status, source: p }, this.hitSet);
        for (const t of hits) {
          this.hitAny = true;
          if (t._pendingCrit) { world.fx.number(t.cx, t.y - 12, 'CRIT', PAL.yellow); }
          G.onItemHit(p, inst, t, t.lastDealt || 0, world);
          world.fx.sparks(t.cx - p.facing * 3, p.y + 10, p.facing, 7, s.trail || this.def.trail || PAL.cyan);
          world.fx.splat(t.cx, t.cy, p.facing, 6, t.bloodColors);
          world.hitstop(s.hitstop != null ? s.hitstop : (t._pendingCrit ? 0.09 : 0.05));
          world.shake(s.shake || (t._pendingCrit ? 3 : 1.5), 0.12);
          if (G.audio) G.audio.play(t._pendingCrit ? 'hitCrit' : 'hit');
        }
        if (this.t >= s.active) { this.phase = 'rec'; this.t = 0; }
      }
      if (this.phase === 'rec') {
        this.cancelable = this.t > s.rec * 0.25;
        if (this.queued && this.t >= s.rec * 0.3) {
          this.startStep((this.i + 1) % this.steps.length);
          return;
        }
        if (this.t >= s.rec) this.done = true;
      }
    }
    // weapon angle through the swing
    pose(pose) {
      const s = this.s;
      let a;
      if (this.phase === 'wind') a = G.lerp(s.arc[0] - (s.windBack || 0.35), s.arc[0], G.easeOut(Math.min(1, this.t / s.wind)));
      else if (this.phase === 'active') a = G.lerp(s.arc[0], s.arc[1], G.easeOut(Math.min(1, this.t / s.active)));
      else a = G.lerp(s.arc[1], s.arc[1] + 0.25, Math.min(1, this.t / s.rec));
      pose.aim = a; // 0 forward, -PI/2 up, PI/2 down
      pose.lean = this.phase === 'active' ? 0.35 : this.phase === 'wind' ? -0.1 : 0.15;
      pose.twoHand = !!this.def.twoHand;
      pose.thrust = s.thrust ? (this.phase === 'active' ? 1 : 0) : 0;
    }
  }
  G.MeleeAction = MeleeAction;

  // ---------------------------------------------------------------- Ranged
  // def: {wind, rec, fire(p, inst, world, charge)->void, charge:{min,max} (hold to charge), aim}
  class RangedAction extends Action {
    constructor(p, inst, button) {
      super(p, inst, button);
      this.phase = 'wind'; this.charge = 0; this.moveMul = this.def.moveMul == null ? 0.35 : this.def.moveMul;
      const ix = (G.input.down('right') ? 1 : 0) - (G.input.down('left') ? 1 : 0);
      if (ix) p.facing = ix;
      if (this.def.charge && G.audio) G.audio.play('charge');
    }
    update(dt, world) {
      const d = this.def;
      this.t += dt;
      if (this.phase === 'wind') {
        if (d.charge) {
          this.charge = Math.min(1, this.t / d.charge.time);
          if (this.charge >= 1 && !this._full) { this._full = true; world.fx.ring(this.p.cx + this.p.facing * 10, this.p.y + 8, 2, 10, d.trail || PAL.cyan, 0.2, 1); }
          if (!this.held && this.t >= (d.charge.min || 0.1)) this.fire(world);
          else if (this.t > d.charge.time + 1.5) this.fire(world);
        } else if (this.t >= d.wind) this.fire(world);
      } else if (this.phase === 'rec') {
        this.cancelable = true;
        if (this.t >= d.rec) {
          if (d.auto && this.held) { this.phase = 'wind'; this.t = d.wind; this.fire(world); }
          else this.done = true;
        }
      }
    }
    fire(world) {
      this.phase = 'rec'; this.t = 0;
      this.def.fire(this.p, this.inst, world, this.charge);
      this.p.vx -= this.p.facing * (this.def.recoil || 0);
    }
    pose(pose) {
      pose.aim = this.def.aimUp ? -0.35 : 0;
      pose.lean = 0.05;
      pose.recoil = this.phase === 'rec' ? Math.max(0, 1 - this.t / 0.12) : 0;
      pose.twoHand = !!this.def.twoHand;
      pose.charge = this.charge;
    }
  }
  G.RangedAction = RangedAction;

  // ---------------------------------------------------------------- Skill (instant use with short throw pose)
  class SkillAction extends Action {
    constructor(p, inst, button) {
      super(p, inst, button);
      this.moveMul = 0.6; this.dur = this.def.castTime || 0.18; this.fired = false;
    }
    update(dt, world) {
      this.t += dt;
      if (!this.fired && this.t >= this.dur * 0.4) {
        this.fired = true;
        this.def.activate(this.p, this.inst, world);
        this.inst.cd = this.def.cooldown * this.p.cdMul;
      }
      if (this.t >= this.dur) this.done = true;
      this.cancelable = this.fired;
    }
    pose(pose) { pose.aim = G.lerp(-2.2, 0.3, Math.min(1, this.t / this.dur)); pose.lean = 0.1; pose.throwing = true; }
  }
  G.SkillAction = SkillAction;

  // ---------------------------------------------------------------- drawing helpers
  // Draws a blade/bar along angle `ang` from (x,y): handle then blade. colors: {handle, blade, edge}
  G.drawBlade = function (ctx, x, y, ang, o) {
    const c = Math.cos(ang), s = Math.sin(ang);
    const hl = o.handle || 3, bl = o.len || 12;
    const hx = x - c * 2, hy = y - s * 2;
    G.px.line(ctx, hx, hy, x + c * hl, y + s * hl, o.handleColor || PAL.steel0, 2);
    if (o.guard) G.px.line(ctx, x + c * hl - s * 2, y + s * hl + c * 2, x + c * hl + s * 2, y + s * hl - c * 2, o.guard, 1);
    const bx = x + c * hl, by = y + s * hl;
    G.px.line(ctx, bx, by, bx + c * bl, by + s * bl, o.blade || PAL.steel4, o.width || 2);
    if (o.edge) G.px.line(ctx, bx + c, by + s, bx + c * (bl - 1), by + s * (bl - 1), o.edge, 1);
  };
  // gun body along angle
  G.drawGun = function (ctx, x, y, ang, o) {
    const c = Math.cos(ang), s = Math.sin(ang);
    const len = o.len || 8;
    G.px.line(ctx, x - c * 1, y - s * 1, x + c * len, y + s * len, o.body || PAL.steel2, o.width || 3);
    G.px.line(ctx, x + c * 2, y + s * 2, x + c * (len + (o.barrel || 2)), y + s * (len + (o.barrel || 2)), o.barrelColor || PAL.steel3, 1);
    G.px.line(ctx, x + s * 1, y - c * -1, x + s * 3 - c, y + c * 3 - s, o.grip || PAL.steel0, 2);
    if (o.light) ctx.fillStyle = o.light, ctx.fillRect(Math.round(x + c * (len - 2)), Math.round(y + s * (len - 2)) - 1, 1, 1);
  };

  // Icons: cached canvases produced by def.drawIcon(ctx, size) or the held sprite scaled up.
  const iconCache = new Map();
  G.itemIcon = function (def, size = 24) {
    const key = def.id + '|' + size;
    let c = iconCache.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    if (def.drawIcon) def.drawIcon(g, size);
    else if (def.drawHeld) {
      g.save(); g.translate(0, 0);
      def.drawHeld(g, size * 0.22, size * 0.78, -Math.PI / 4, null, null, 1.6);
      g.restore();
    }
    iconCache.set(key, c);
    return c;
  };

  // ---------------------------------------------------------------- starter items
  G.defineItem({
    id: 'katana', name: 'Ржавая катана', kind: 'melee', stat: 'brutality', start: true, drop: 0.6,
    desc: 'Три быстрых удара. Третий удар — критический.', trail: PAL.cyan,
    combo: [
      { wind: 0.07, active: 0.08, rec: 0.2, dmg: 10, reach: 26, h: 20, yOff: -2, arc: [-1.6, 0.9], lunge: 70, kb: 70, sfx: 'slash1' },
      { wind: 0.07, active: 0.08, rec: 0.2, dmg: 11, reach: 26, h: 20, yOff: -2, arc: [1.0, -1.4], lunge: 70, kb: 70, sfx: 'slash2' },
      { wind: 0.11, active: 0.09, rec: 0.32, dmg: 16, reach: 30, h: 24, yOff: -4, arc: [-2.0, 1.2], lunge: 120, kb: 170, stun: 0.3, sfx: 'slash3', trailW: 7, crit: () => true, shake: 3 },
    ],
    use(p, inst, world, button) { return new MeleeAction(p, inst, button); },
    drawHeld(ctx, x, y, ang, p, inst, sc = 1) {
      G.drawBlade(ctx, x, y, ang, { len: Math.round(13 * sc), handle: Math.round(3 * sc), blade: '#9fb3c8', edge: PAL.cyan, guard: PAL.yellow, width: Math.max(1, Math.round(sc)) });
    },
  });

  G.defineItem({
    id: 'pistol', name: 'Плазменный пистолет', kind: 'ranged', stat: 'tactics', start: true, drop: 0.6,
    desc: 'Быстрые плазменные заряды. Третий выстрел подряд — критический.',
    wind: 0.06, rec: 0.2, recoil: 20, trail: PAL.magenta,
    fire(p, inst, world) {
      inst.streak = (inst.lastShot && world.time - inst.lastShot < 0.7) ? (inst.streak || 0) + 1 : 0;
      inst.lastShot = world.time;
      const crit = inst.streak % 3 === 2;
      const x = p.cx + p.facing * 12, y = p.y + 9;
      world.addProjectile(new G.Projectile({
        x, y, vx: p.facing * 420, vy: 0, r: 2, team: 'player', life: 0.8, color: PAL.magenta, len: crit ? 10 : 7,
        dmg: G.itemDamage(p, inst, crit ? 13 : 7), info: { kb: 40, stun: 0.05, crit, color: crit ? PAL.yellow : null },
        onHit(t, w) { G.onItemHit(p, inst, t, t.lastDealt || 0, w); w.fx.sparks(this.x, this.y, -p.facing, 5, PAL.magenta); if (G.audio) G.audio.play('hit', { vol: 0.6 }); },
      }));
      world.fx.burst(x, y, 4, { angle: p.facing > 0 ? 0 : Math.PI, spread: 0.5, speed: 120, life: 0.12, color: [PAL.magenta, '#ffffff'], shape: 'spark', grav: 0, additive: true });
      world.flashLights.push({ x, y, r: 26, color: PAL.magenta, t: 0, life: 0.07 });
      if (G.audio) G.audio.play('shoot');
    },
    use(p, inst, world, button) { return new RangedAction(p, inst, button); },
    drawHeld(ctx, x, y, ang, p, inst, sc = 1) {
      G.drawGun(ctx, x, y, ang, { len: Math.round(6 * sc), body: '#3d3a5c', barrelColor: PAL.magenta, width: Math.max(2, Math.round(3 * sc)), light: PAL.magenta });
    },
  });

  G.defineItem({
    id: 'frag', name: 'Осколочная граната', kind: 'skill', stat: 'tactics', drop: 1, cooldown: 7,
    desc: 'Бросает гранату, взрывающуюся при касании.',
    activate(p, inst, world) {
      world.addProjectile(new G.Projectile({
        x: p.cx + p.facing * 6, y: p.y + 4, vx: p.facing * 190 + p.vx * 0.4, vy: -170, grav: 700, r: 3, life: 2.2, team: 'player',
        color: PAL.orange, dmg: 0, pierce: 99,
        drawFn(ctx, cam, pr) { G.px.disc(ctx, pr.x - cam.ox, pr.y - cam.oy, 2, '#3b3a50'); ctx.fillStyle = (pr.t * 10 | 0) % 2 ? PAL.red : PAL.yellow; ctx.fillRect(Math.round(pr.x - cam.ox), Math.round(pr.y - cam.oy) - 2, 1, 1); },
        boom(w) { this.dead = true; G.explode(w, this.x, this.y, { radius: 36, dmg: G.itemDamage(p, inst, 34), info: { kb: 180, kbUp: 160, stun: 0.6 }, color: PAL.orange }); },
        onWall(w) { this.boom(w); }, onExpire(w) { this.boom(w); },
        onHit(t, w) { this.boom(w); },
      }));
      if (G.audio) G.audio.play('grenade');
    },
    use(p, inst, world, button) { return new SkillAction(p, inst, button); },
    drawIcon(ctx, s) {
      G.px.disc(ctx, s / 2, s / 2 + 2, s * 0.3, '#3b3a50');
      G.px.disc(ctx, s / 2 - 2, s / 2, s * 0.12, '#6f7299');
      G.px.rect(ctx, s / 2 - 2, s * 0.14, 4, 4, PAL.steel3);
      G.px.rect(ctx, s / 2 + 2, s * 0.12, 3, 2, PAL.orange);
    },
  });
})();
