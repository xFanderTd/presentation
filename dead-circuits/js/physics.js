'use strict';
// Tile map base class + Actor (AABB physics against tiles, HP, statuses, damage).
(function () {
  const G = window.G;
  const T = G.T, TS = G.TILE;

  // ---------------------------------------------------------------- TileMap
  // Level classes extend this. Stores tile codes; out-of-bounds counts as SOLID.
  class TileMap {
    constructor(w, h) {
      this.w = w; this.h = h;
      this.pw = w * TS; this.ph = h * TS;
      this.tiles = new Uint8Array(w * h);
      this.explored = new Uint8Array(w * h); // minimap fog of war
    }
    inside(tx, ty) { return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h; }
    tile(tx, ty) { return this.inside(tx, ty) ? this.tiles[ty * this.w + tx] : T.SOLID; }
    set(tx, ty, v) { if (this.inside(tx, ty)) this.tiles[ty * this.w + tx] = v; }
    solid(tx, ty) { return this.tile(tx, ty) === T.SOLID; }
    platform(tx, ty) { return this.tile(tx, ty) === T.PLATFORM; }
    ladder(tx, ty) { return this.tile(tx, ty) === T.LADDER; }
    hazard(tx, ty) { return this.tile(tx, ty) === T.SPIKES; }
    solidAt(px, py) { return this.solid(Math.floor(px / TS), Math.floor(py / TS)); }
    // standable = solid or one-way platform
    floorAt(px, py) {
      const tx = Math.floor(px / TS), ty = Math.floor(py / TS), t = this.tile(tx, ty);
      return t === T.SOLID || t === T.PLATFORM || (t === T.LADDER && this.tile(tx, ty - 1) !== T.LADDER);
    }
    // true when the segment does not cross a solid tile
    lineClear(x0, y0, x1, y1) {
      const d = Math.hypot(x1 - x0, y1 - y0);
      const steps = Math.ceil(d / 6);
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        if (this.solidAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
      }
      return true;
    }
    // first solid hit along a segment: {x,y,hit}
    raycast(x0, y0, x1, y1) {
      const d = Math.hypot(x1 - x0, y1 - y0);
      const steps = Math.max(1, Math.ceil(d / 3));
      let px = x0, py = y0;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
        if (this.solidAt(x, y)) return { x: px, y: py, hit: true };
        px = x; py = y;
      }
      return { x: x1, y: y1, hit: false };
    }
    // y (px) of the ground surface below (x, y) within maxDist, or null
    groundBelow(x, y, maxDist = 400) {
      let ty = Math.floor(y / TS);
      const tx = Math.floor(x / TS);
      const end = Math.floor((y + maxDist) / TS);
      for (; ty <= end; ty++) {
        const t = this.tile(tx, ty);
        if (t === T.SOLID || t === T.PLATFORM) return ty * TS;
      }
      return null;
    }
    reveal(px, py, radiusTiles) {
      const cx = Math.floor(px / TS), cy = Math.floor(py / TS);
      const r = radiusTiles, r2 = r * r;
      for (let y = cy - r; y <= cy + r; y++) {
        if (y < 0 || y >= this.h) continue;
        for (let x = cx - r; x <= cx + r; x++) {
          if (x < 0 || x >= this.w) continue;
          if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r2) this.explored[y * this.w + x] = 1;
        }
      }
    }
    // overridable hooks for the level implementation
    update(dt, world) {}
    drawBackground(ctx, cam) {}
    drawTiles(ctx, cam) {
      const ox = cam.ox, oy = cam.oy;
      const x0 = Math.max(0, Math.floor(ox / TS)), y0 = Math.max(0, Math.floor(oy / TS));
      const x1 = Math.min(this.w - 1, Math.floor((ox + G.W) / TS)), y1 = Math.min(this.h - 1, Math.floor((oy + G.H) / TS));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const t = this.tiles[y * this.w + x];
        if (t === T.SOLID) G.px.rect(ctx, x * TS - ox, y * TS - oy, TS, TS, G.PAL.steel1);
        else if (t === T.PLATFORM) G.px.rect(ctx, x * TS - ox, y * TS - oy, TS, 3, G.PAL.steel3);
        else if (t === T.LADDER) G.px.rect(ctx, x * TS - ox + 6, y * TS - oy, 4, TS, G.PAL.steel2);
        else if (t === T.SPIKES) G.px.rect(ctx, x * TS - ox, y * TS - oy + 10, TS, 6, G.PAL.red);
      }
    }
    drawForeground(ctx, cam) {}
    drawLights(ctx, cam) {}
  }
  G.TileMap = TileMap;

  // ---------------------------------------------------------------- Actor
  // x,y = top-left of the AABB in world px. Feet = (x + w/2, y + h).
  let nextId = 1;
  class Actor {
    constructor(x, y, w, h) {
      this.id = nextId++;
      this.x = x; this.y = y; this.w = w; this.h = h;
      this.vx = 0; this.vy = 0;
      this.facing = 1;
      this.onGround = false; this.wasOnGround = false;
      this.hitWall = 0; this.hitCeil = false;
      this.gravity = G.GRAVITY; this.maxFall = 430;
      this.dropThrough = 0;          // seconds: ignore one-way platforms
      this.noGravity = false;
      this.hp = 10; this.maxHp = 10;
      this.team = 'neutral';
      this.dead = false;             // remove from world when true
      this.dying = false;            // death animation in progress
      this.flash = 0;                // white hit flash timer
      this.invuln = 0;               // i-frames
      this.stun = 0;                 // cannot act
      this.kbRes = 0;                // 0..1 knockback resistance
      this.stunRes = 0;              // 0..1
      this.dmgTakenMul = 1;
      this.statuses = {};            // name -> {t, power, stacks, tick}
      this.t = 0;                    // lifetime
    }
    get cx() { return this.x + this.w / 2; }
    get cy() { return this.y + this.h / 2; }
    get bottom() { return this.y + this.h; }
    get box() { return this; }

    physics(dt, level) {
      this.wasOnGround = this.onGround;
      if (!this.noGravity) this.vy = Math.min(this.maxFall, this.vy + this.gravity * dt);
      if (this.dropThrough > 0) this.dropThrough -= dt;
      this.hitWall = 0; this.hitCeil = false;
      this.moveX(this.vx * dt, level);
      this.onGround = false;
      this.moveY(this.vy * dt, level);
    }
    moveX(dx, level) {
      if (!dx) return;
      this.x += dx;
      const y0 = Math.floor(this.y / TS), y1 = Math.floor((this.y + this.h - 0.01) / TS);
      if (dx > 0) {
        const tx = Math.floor((this.x + this.w - 0.01) / TS);
        for (let ty = y0; ty <= y1; ty++) if (level.solid(tx, ty)) { this.x = tx * TS - this.w; this.vx = 0; this.hitWall = 1; return; }
      } else {
        const tx = Math.floor(this.x / TS);
        for (let ty = y0; ty <= y1; ty++) if (level.solid(tx, ty)) { this.x = (tx + 1) * TS; this.vx = 0; this.hitWall = -1; return; }
      }
    }
    moveY(dy, level) {
      if (!dy) return;
      const prevBottom = this.y + this.h;
      this.y += dy;
      const x0 = Math.floor(this.x / TS), x1 = Math.floor((this.x + this.w - 0.01) / TS);
      if (dy > 0) {
        const bottom = this.y + this.h;
        const ty = Math.floor((bottom - 0.01) / TS);
        for (let tx = x0; tx <= x1; tx++) {
          const t = level.tile(tx, ty);
          const oneWay = t === T.PLATFORM || (t === T.LADDER && level.tile(tx, ty - 1) !== T.LADDER && !this.onLadder);
          if (t === T.SOLID || (oneWay && this.dropThrough <= 0 && !this.ignorePlatforms && prevBottom <= ty * TS + 0.5)) {
            this.y = ty * TS - this.h; this.vy = 0; this.onGround = true; return;
          }
        }
      } else {
        const ty = Math.floor(this.y / TS);
        for (let tx = x0; tx <= x1; tx++) if (level.solid(tx, ty)) { this.y = (ty + 1) * TS; this.vy = 0; this.hitCeil = true; return; }
      }
    }
    // is there floor under the given x offset from our feet (for ledge checks)
    groundAt(level, dx) {
      const px = dx > 0 ? this.x + this.w + dx : this.x + dx;
      return level.floorAt(px, this.y + this.h + 2);
    }
    standingOnPlatformOnly(level) {
      const ty = Math.floor((this.y + this.h + 1) / TS);
      const x0 = Math.floor(this.x / TS), x1 = Math.floor((this.x + this.w - 0.01) / TS);
      let plat = false;
      for (let tx = x0; tx <= x1; tx++) { const t = level.tile(tx, ty); if (t === T.SOLID) return false; if (t === T.PLATFORM || t === T.LADDER) plat = true; }
      return plat;
    }
    touchesHazard(level) {
      const x0 = Math.floor((this.x + 2) / TS), x1 = Math.floor((this.x + this.w - 2) / TS);
      const y0 = Math.floor((this.y + 4) / TS), y1 = Math.floor((this.y + this.h - 1) / TS);
      for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (level.hazard(tx, ty)) return true;
      return false;
    }

    // info: {dir, kb, kbUp, stun, crit, color, status:{name,dur,power}, source, silent, noFlash}
    takeDamage(amount, info = {}) {
      if (this.dead || this.dying || this.invuln > 0) return 0;
      let dmg = Math.max(1, Math.round(amount * this.dmgTakenMul));
      if (this.statuses.shock) dmg = Math.round(dmg * 1.25);
      this.hp -= dmg;
      if (!info.noFlash) this.flash = 0.1;
      const dir = info.dir != null ? info.dir : (info.source ? G.sign(this.cx - info.source.cx) || 1 : 0);
      if (info.kb) {
        const k = info.kb * (1 - this.kbRes);
        this.vx = dir * k;
        if (info.kbUp) this.vy = Math.min(this.vy, -info.kbUp * (1 - this.kbRes));
      }
      if (info.stun) this.stun = Math.max(this.stun, info.stun * (1 - this.stunRes));
      if (info.status) this.applyStatus(info.status.name, info.status.dur, info.status.power);
      if (!info.silent && G.world) G.world.fx.number(this.cx, this.y - 4, dmg, info.crit ? G.PAL.yellow : (info.color || (this.team === 'player' ? G.PAL.red : G.PAL.white)), info.crit);
      this.onHurt(dmg, info);
      if (this.hp <= 0) { this.hp = 0; this.die(info); }
      return dmg;
    }
    heal(n) {
      if (this.dead) return;
      const before = this.hp;
      this.hp = Math.min(this.maxHp, this.hp + n);
      return this.hp - before;
    }
    onHurt(dmg, info) {}
    die(info) { this.dead = true; }

    // Statuses: burn (DoT), virus (stacking DoT), shock (x1.25 dmg taken, sparks), cryo (slow), stunlock handled by `stun`
    applyStatus(name, dur, power = 1) {
      if (this.statusImmune && this.statusImmune[name]) return;
      const s = this.statuses[name];
      if (s) {
        s.t = Math.max(s.t, dur);
        if (name === 'virus') s.stacks = Math.min(10, (s.stacks || 1) + 1);
        s.power = Math.max(s.power, power);
      } else {
        this.statuses[name] = { t: dur, power, stacks: 1, tick: 0 };
      }
    }
    updateStatuses(dt) {
      for (const name in this.statuses) {
        const s = this.statuses[name];
        s.t -= dt; s.tick += dt;
        if ((name === 'burn' || name === 'virus') && s.tick >= 0.5) {
          s.tick -= 0.5;
          const d = name === 'burn' ? s.power : s.power * s.stacks * 0.5;
          this.takeDamage(Math.max(1, d), { color: name === 'burn' ? G.PAL.orange : G.PAL.lime, noFlash: true });
        }
        if (G.world && G.rand.chance(dt * 14)) {
          const col = { burn: G.PAL.orange, virus: G.PAL.lime, shock: G.PAL.cyan, cryo: '#9fe8ff' }[name] || G.PAL.white;
          G.world.fx.particle({
            x: this.x + G.rand.float(0, this.w), y: this.y + G.rand.float(0, this.h),
            vx: G.rand.float(-10, 10), vy: name === 'burn' ? -40 : G.rand.float(-20, 20), life: 0.4, color: col, size: 1, glow: 6,
          });
        }
        if (s.t <= 0) delete this.statuses[name];
      }
    }
    get slowMul() { return this.statuses.cryo ? 0.45 : 1; }
    tickTimers(dt) {
      this.t += dt;
      if (this.flash > 0) this.flash -= dt;
      if (this.invuln > 0) this.invuln -= dt;
      if (this.stun > 0) this.stun -= dt;
    }
  }
  G.Actor = Actor;
})();
