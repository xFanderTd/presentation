'use strict';
// Enemy base class + registry. The full roster lives here too (see ENEMIES section).
(function () {
  const G = window.G;
  const PAL = G.PAL, TS = G.TILE;

  G.ENEMIES = {};
  // Register an enemy class: G.defineEnemy('grunt', class extends G.Enemy {...}, {biomes:['scrap'], weight:3, minDepth:0, air:false})
  G.defineEnemy = function (type, cls, meta = {}) {
    cls.prototype.type = type;
    G.ENEMIES[type] = { cls, meta };
    return cls;
  };
  // Pick an enemy type for a level spawn point. Returns a type id or null.
  G.pickEnemy = function (biome, depth, rng, spawn) {
    const list = [];
    for (const type in G.ENEMIES) {
      const m = G.ENEMIES[type].meta;
      if (m.boss || m.noSpawn) continue;
      if (m.biomes && !m.biomes.includes(biome)) continue;
      if ((m.minDepth || 0) > depth) continue;
      if (!!m.air !== !!spawn.air) continue;
      list.push([type, m.weight || 1]);
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

  // ---------------------------------------------------------------- Enemy base
  // Constructed with FEET position (x, y). Subclasses set size/stats in constructor via this.setup({...}).
  class Enemy extends G.Actor {
    constructor(x, y, o = {}) {
      super(x - 6, y - 20, 12, 20);
      this.team = 'enemy';
      this.depth = o.depth || 0;
      this.elite = !!o.elite;
      this.state = 'idle'; this.stateT = 0;
      this.aggro = false; this.alertT = 0; this.teleT = 0; this.teleMax = 0;
      this.sight = 170; this.loseSight = 320;
      this.speed = 50; this.dmg = 10;
      this.cells = [0, 1]; this.gold = [1, 4];
      this.bloodColors = ['#1fd6ff', '#0b7fa8', '#16f0c0'];
      this.deathT = 0;
      this.home = x; this.patrolDir = G.rand.sign(); this.patrolT = G.rand.float(1, 3);
      this.cooldown = 0;
      this.flying = false;
      this.hpBarT = 0;
      this.showHp = true;
    }
    // stats: {w,h,hp,dmg,speed,sight,cells,gold,kbRes,stunRes}
    setup(s) {
      const feetX = this.cx, feetY = this.bottom;
      if (s.w) this.w = s.w;
      if (s.h) this.h = s.h;
      this.x = feetX - this.w / 2; this.y = feetY - this.h;
      const hpMul = (1 + 0.65 * this.depth) * (this.elite ? 3.2 : 1);
      const dmgMul = (1 + 0.35 * this.depth) * (this.elite ? 1.3 : 1);
      if (s.hp) this.maxHp = this.hp = Math.round(s.hp * hpMul);
      if (s.dmg) this.dmg = Math.round(s.dmg * dmgMul);
      for (const k of ['speed', 'sight', 'cells', 'gold', 'kbRes', 'stunRes', 'flying']) if (s[k] != null) this[k] = s[k];
      if (this.elite) { this.kbRes = Math.max(this.kbRes, 0.6); this.stunRes = Math.max(this.stunRes, 0.5); this.cells = [this.cells[0] + 3, this.cells[1] + 6]; }
      if (this.flying) this.noGravity = true;
    }
    setState(s) { this.state = s; this.stateT = 0; }
    get player() { return G.world && G.world.player; }
    distToPlayer() { const p = this.player; return p ? G.dist(this.cx, this.cy, p.cx, p.cy) : 1e9; }
    dxToPlayer() { const p = this.player; return p ? p.cx - this.cx : 0; }
    canSee(range = this.sight) {
      const p = this.player;
      if (!p || p.dead || p.state === 'dead') return false;
      const d = G.dist(this.cx, this.cy, p.cx, p.cy);
      if (d > range) return false;
      if (Math.abs(p.cy - this.cy) > 90 && !this.flying) return false;
      return G.world.level.lineClear(this.cx, this.y + 6, p.cx, p.y + 6);
    }
    facePlayer() { const dx = this.dxToPlayer(); if (dx) this.facing = G.sign(dx); }
    // is there floor ahead so we don't walk off ledges
    ledgeAhead(dir = this.facing) { return !this.groundAt(G.world.level, dir * 2); }
    wallAhead(dir = this.facing) {
      const L = G.world.level;
      const tx = Math.floor((dir > 0 ? this.x + this.w + 2 : this.x - 2) / TS);
      return L.solid(tx, Math.floor((this.bottom - 4) / TS)) || L.solid(tx, Math.floor((this.y + 2) / TS));
    }
    // yellow "!" wind-up telegraph for `dur` seconds
    telegraph(dur) { this.teleT = this.teleMax = dur; if (G.audio) G.audio.play('telegraph', { vol: 0.5 }); }
    notice() {
      if (this.aggro) return;
      this.aggro = true; this.alertT = 0.5;
      if (G.audio) G.audio.play('enemyAlert', { vol: 0.4 });
    }
    // melee box in front: hits player
    meleeBox(reach, h = this.h, yOff = 0) {
      return { x: this.facing > 0 ? this.x + this.w - 2 : this.x + 2 - reach, y: this.y + yOff, w: reach, h };
    }
    hitPlayer(box, dmg = this.dmg, info = {}) {
      const p = this.player;
      if (!p || !G.overlap(box, p)) return 0;
      return p.takeDamage(dmg, Object.assign({ dir: this.facing, kb: 120, kbUp: 100, source: this }, info));
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

    update(dt, world) {
      this.tickTimers(dt);
      this.updateStatuses(dt);
      if (this.hpBarT > 0) this.hpBarT -= dt;
      if (this.dying) {
        this.deathT += dt;
        this.vx *= Math.pow(0.01, dt);
        this.physics(dt, world.level);
        if (this.deathT > 0.35) this.dead = true;
        return;
      }
      this.stateT += dt;
      if (this.alertT > 0) this.alertT -= dt;
      if (this.teleT > 0) this.teleT -= dt;
      if (this.cooldown > 0) this.cooldown -= dt;
      if (!this.aggro && this.canSee()) this.notice();
      if (this.aggro && this.distToPlayer() > this.loseSight) this.aggro = false;
      if (this.stun > 0) {
        this.teleT = 0;
        if (this.state !== 'stunned') this.setState('stunned');
        this.vx = G.approach(this.vx, 0, 500 * dt);
      } else {
        if (this.state === 'stunned') this.setState(this.aggro ? 'chase' : 'idle');
        this.ai(dt, world);
      }
      if (!this.noPhysics) this.physics(dt, world.level);
      if (!this.flying && this.onGround && this.stun > 0) this.vx *= Math.pow(0.02, dt);
      if (this.y > world.level.ph + 50) { this.dead = true; }
    }
    ai(dt, world) {}

    onHurt(dmg, info) {
      this.hpBarT = 3;
      if (!this.aggro) this.notice();
      if (G.audio && this.hp > 0) G.audio.play('hit', { vol: 0.4 });
    }
    die(info) {
      if (this.dying) return;
      this.dying = true; this.deathT = 0;
      const w = G.world;
      const R = w.rng;
      const cells = R.int(this.cells[0], this.cells[1]);
      const gold = R.int(this.gold[0], this.gold[1]) * (1 + this.depth);
      w.dropCurrency(this.cx, this.cy, cells, gold);
      w.fx.burst(this.cx, this.cy, 22, { speed: 180, life: 0.6, color: this.bloodColors, size: [1, 2], grav: 500, decal: true });
      w.fx.burst(this.cx, this.cy, 10, { speed: 140, life: 0.35, color: [PAL.yellow, '#ffffff'], shape: 'spark', grav: 200, additive: true });
      w.fx.ring(this.cx, this.cy, 3, 20, this.elite ? PAL.yellow : PAL.cyan, 0.3, 1);
      w.shake(this.elite ? 5 : 2, 0.2);
      if (this.elite && this.onEliteDeath) this.onEliteDeath(w);
      if (G.audio) G.audio.play(this.elite ? 'eliteDie' : 'enemyDie');
      G.emit('enemyKilled', { enemy: this, info });
    }

    // helpers for subclasses' draw()
    drawHpBar(ctx, cam) {
      if (this.hpBarT <= 0 || this.dying || this.hp >= this.maxHp) return;
      const w = Math.max(14, Math.min(30, this.w + 6));
      const x = Math.round(this.cx - w / 2 - cam.ox), y = Math.round(this.y - 7 - cam.oy);
      G.px.rect(ctx, x - 1, y - 1, w + 2, 4, PAL.ink);
      G.px.rect(ctx, x, y, w, 2, '#3a1020');
      G.px.rect(ctx, x, y, Math.max(1, Math.round(w * this.hp / this.maxHp)), 2, this.elite ? PAL.yellow : PAL.red);
    }
    drawTelegraph(ctx, cam) {
      const x = Math.round(this.cx - cam.ox), y = Math.round(this.y - 14 - cam.oy);
      if (this.teleT > 0) {
        const blink = Math.floor(this.teleT * 20) % 2 === 0;
        G.font.draw(ctx, '!', x + 1, y - 2, blink ? PAL.yellow : PAL.orange, 2, 'center');
      } else if (this.alertT > 0) {
        G.font.draw(ctx, '!', x + 1, y + Math.round(this.alertT * 6), PAL.white, 1, 'center');
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
    drawOverlay(ctx, cam) { this.drawHpBar(ctx, cam); this.drawStatus(ctx, cam); this.drawTelegraph(ctx, cam); }
    draw(ctx, cam) {
      const x = Math.round(this.x - cam.ox), y = Math.round(this.y - cam.oy);
      const k = this.dying ? 1 - this.deathT / 0.35 : 1;
      ctx.globalAlpha = k;
      G.px.rect(ctx, x - 1, y - 1, this.w + 2, this.h + 2, PAL.ink);
      G.px.rect(ctx, x, y, this.w, this.h, this.col('#4a3a5e'));
      G.px.rect(ctx, x + (this.facing > 0 ? this.w - 4 : 1), y + 4, 3, 2, this.col(PAL.red));
      ctx.globalAlpha = 1;
      this.drawOverlay(ctx, cam);
    }
    drawLight(ctx, cam) {
      if (this.elite && !this.dying) G.drawGlow(ctx, this.cx - cam.ox, this.cy - cam.oy, 40, PAL.yellow, 0.25);
    }
  }
  G.Enemy = Enemy;

  // ================================================================ ENEMIES
  // Sample grunt (placeholder until the full roster lands).
  class Grunt extends Enemy {
    constructor(x, y, o) {
      super(x, y, o);
      this.setup({ w: 12, h: 21, hp: 42, dmg: 12, speed: 58, cells: [0, 1], gold: [1, 3] });
    }
    ai(dt, world) {
      const p = this.player;
      switch (this.state) {
        case 'idle':
          this.patrol(dt);
          if (this.aggro) this.setState('chase');
          break;
        case 'chase': {
          if (!this.aggro) { this.setState('idle'); break; }
          this.chase(dt, this.speed, 16);
          const dx = Math.abs(this.dxToPlayer()), dy = Math.abs(p.cy - this.cy);
          if (dx < 26 && dy < 24 && this.cooldown <= 0) { this.setState('wind'); this.telegraph(0.45); this.facePlayer(); }
          break;
        }
        case 'wind':
          this.vx = G.approach(this.vx, 0, 600 * dt);
          if (this.stateT >= 0.45) { this.setState('strike'); this.vx = this.facing * 120; if (G.audio) G.audio.play('slash1', { pitch: 0.7, vol: 0.6 }); }
          break;
        case 'strike':
          if (this.stateT < 0.12) this.hitPlayer(this.meleeBox(20, 16, 3));
          this.vx = G.approach(this.vx, 0, 700 * dt);
          if (this.stateT >= 0.45) { this.cooldown = 0.8; this.setState('chase'); }
          break;
      }
    }
  }
  G.defineEnemy('grunt', Grunt, { weight: 3 });
})();
