'use strict';
// Combat helpers: projectiles, explosions, area hits.
(function () {
  const G = window.G;

  // ---------------------------------------------------------------- Projectile
  // o: {x,y,vx,vy,r,team,dmg,info,life,pierce,grav,bounce,color,core,len,glow,
  //     onHit(target,world), onWall(world), onExpire(world), drawFn(ctx,cam,p), homing}
  class Projectile {
    constructor(o) {
      this.x = 0; this.y = 0; this.vx = 0; this.vy = 0; this.r = 2;
      this.team = 'player'; this.dmg = 5; this.info = {};
      this.life = 1.5; this.t = 0; this.pierce = 0; this.grav = 0; this.bounce = 0;
      this.color = G.PAL.cyan; this.core = '#ffffff'; this.len = 6; this.glow = 10;
      this.hitSet = new Set(); this.dead = false; this.hitsWalls = true;
      Object.assign(this, o);
    }
    targets(world) {
      if (this.team === 'player') return world.enemies;
      const list = world.player && !world.player.dead ? [world.player] : [];
      return world.allies && world.allies.length ? list.concat(world.allies) : list;
    }
    update(dt, world) {
      this.t += dt;
      if (this.t >= this.life) { this.dead = true; if (this.onExpire) this.onExpire(world); return; }
      this.vy += this.grav * dt;
      if (this.homing && this.team === 'player') {
        let best = null, bd = this.homingRange || 120;
        for (const e of world.enemies) { if (e.dying || e.dead) continue; const d = G.dist(this.x, this.y, e.cx, e.cy); if (d < bd) { bd = d; best = e; } }
        if (best) {
          const sp = Math.hypot(this.vx, this.vy);
          const a = G.angleLerp(Math.atan2(this.vy, this.vx), Math.atan2(best.cy - this.y, best.cx - this.x), Math.min(1, this.homing * dt));
          this.vx = Math.cos(a) * sp; this.vy = Math.sin(a) * sp;
        }
      }
      const dist = Math.hypot(this.vx, this.vy) * dt;
      const n = Math.max(1, Math.ceil(dist / 4));
      const L = world.level;
      for (let i = 0; i < n && !this.dead; i++) {
        const nx = this.x + (this.vx * dt) / n, ny = this.y + (this.vy * dt) / n;
        if (this.hitsWalls && L.solidAt(nx, ny)) {
          if (this.bounce > 0) {
            if (L.solidAt(nx, this.y)) this.vx *= -this.bounce; else this.vy *= -this.bounce;
            this.vx *= 0.85;
            continue;
          }
          this.x = nx; this.y = ny;
          this.dead = true;
          if (this.onWall) this.onWall(world); else world.fx.sparks(this.x, this.y, -G.sign(this.vx), 5, this.color);
          return;
        }
        this.x = nx; this.y = ny;
        for (const t of this.targets(world)) {
          if (t.dead || t.dying || this.hitSet.has(t.id)) continue;
          if (this.x + this.r > t.x && this.x - this.r < t.x + t.w && this.y + this.r > t.y && this.y - this.r < t.y + t.h) {
            if (this.hit(t, world)) return;
          }
        }
      }
    }
    // returns true when the projectile is consumed
    hit(t, world) {
      const info = Object.assign({ dir: G.sign(this.vx) || 1, source: this }, this.info);
      const dealt = t.takeDamage(this.dmg, info);
      t.lastDealt = dealt;
      if (!dealt && t.team === 'player') return false; // dodged (i-frames): keep flying
      this.hitSet.add(t.id);
      if (dealt && this.team === 'player') G.emit('enemyHit', { enemy: t, dmg: dealt, source: 'projectile', crit: info.crit });
      if (this.onHit) this.onHit(t, world);
      if (this.pierce-- <= 0) { this.dead = true; return true; }
      return false;
    }
    draw(ctx, cam) {
      if (this.drawFn) return this.drawFn(ctx, cam, this);
      const x = this.x - cam.ox, y = this.y - cam.oy;
      const sp = Math.hypot(this.vx, this.vy) || 1;
      const tx = x - (this.vx / sp) * this.len, ty = y - (this.vy / sp) * this.len;
      G.px.line(ctx, tx, ty, x, y, this.color, this.r > 2 ? 3 : 2);
      G.px.line(ctx, (tx + x) / 2, (ty + y) / 2, x, y, this.core, 1);
    }
    drawLight(ctx, cam) {
      if (this.glow) G.drawGlow(ctx, this.x - cam.ox, this.y - cam.oy, this.glow, this.color, 0.7);
    }
  }
  G.Projectile = Projectile;

  // ---------------------------------------------------------------- area damage
  // Hits every target of the opposite team overlapping box once (hitSet optional). Returns hit list.
  G.hitBox = function (world, box, team, dmg, info = {}, hitSet = null) {
    const hits = [];
    const list = team === 'player' ? world.enemies : [world.player].concat(world.allies || []);
    for (const t of list) {
      if (!t || t.dead || t.dying) continue;
      if (hitSet && hitSet.has(t.id)) continue;
      if (!G.overlap(box, t)) continue;
      const d = typeof dmg === 'function' ? dmg(t) : dmg;
      const dealt = t.takeDamage(d, Object.assign({ dir: info.dir != null ? info.dir : G.sign(t.cx - (box.x + box.w / 2)) || 1 }, info));
      t.lastDealt = dealt;
      if (hitSet && (dealt || t.team !== 'player')) hitSet.add(t.id);
      if (dealt) {
        hits.push(t);
        if (team === 'player') G.emit('enemyHit', { enemy: t, dmg: dealt, source: info.sourceKind || 'melee', crit: info.crit });
      }
    }
    return hits;
  };

  // Radial explosion with fx. o: {radius, dmg, team, info, color, noFx}
  G.explode = function (world, x, y, o = {}) {
    const r = o.radius || 32;
    const box = { x: x - r, y: y - r, w: r * 2, h: r * 2 };
    const list = (o.team || 'player') === 'player' ? world.enemies : [world.player].concat(world.allies || []);
    const hits = [];
    for (const t of list) {
      if (!t || t.dead || t.dying || !G.overlap(box, t)) continue;
      if (G.dist(x, y, t.cx, t.cy) > r + Math.max(t.w, t.h) / 2) continue;
      const dealt = t.takeDamage(o.dmg || 10, Object.assign({ dir: G.sign(t.cx - x) || 1, kb: 160, kbUp: 140, stun: 0.3 }, o.info || {}));
      t.lastDealt = dealt;
      if (dealt) { hits.push(t); if ((o.team || 'player') === 'player') G.emit('enemyHit', { enemy: t, dmg: dealt, source: 'explosion' }); }
    }
    if (!o.noFx) {
      const c = o.color || G.PAL.orange;
      world.fx.ring(x, y, 4, r, c, 0.3, 2);
      world.fx.ring(x, y, 2, r * 0.6, '#ffffff', 0.18, 1);
      world.fx.burst(x, y, 26, { speed: r * 6, speedMin: r, life: 0.45, color: [c, G.PAL.yellow, '#ffffff'], shape: 'spark', grav: 200, additive: true, glow: 0 });
      world.fx.burst(x, y, 10, { speed: 60, life: 0.9, color: ['#2a2438', '#3b3350'], size: [2, 4], grav: -40, drag: 2, shape: 'disc', shrink: true });
      world.fx.flash(c, 0.05);
      G.addLight(x, y, r * 3, c.length === 7 ? c : G.PAL.orange, 1);
      world.flashLights.push({ x, y, r: r * 3.2, color: c.length === 7 ? c : G.PAL.orange, t: 0, life: 0.25 });
      world.shake(Math.min(6, r / 8), 0.25);
      if (G.audio) G.audio.play('explosion', { vol: Math.min(1, r / 40) });
    }
    return hits;
  };
})();
