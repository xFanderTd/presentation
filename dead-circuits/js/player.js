'use strict';
// The player: "Сбой" — a nanite swarm wearing a scrapped combat chassis.
// Movement (run, jump, double jump, roll, ledge climb, ladders, slam), item use, healing,
// recovery ("rally") HP, and a procedural skeletal pixel-art renderer.
(function () {
  const G = window.G;
  const PAL = G.PAL, TS = G.TILE;

  const RUN = 138, JUMP_V = 340, DJUMP_V = 305, ROLL_V = 255, ROLL_T = 0.32, ROLL_IFRAMES = 0.27;
  const SLOT_BUTTONS = [['primary', 'attack1'], ['secondary', 'attack2'], ['skill1', 'skill1'], ['skill2', 'skill2']];
  G.SLOT_BUTTONS = SLOT_BUTTONS;

  const COL = {
    outline: '#07050d', legB: '#1a1729', leg: '#27233d', boot: '#121019', coat: '#3a2352', coatB: '#2a1a3c',
    trim: PAL.magenta, arm: '#322e4f', armB: '#221f36', hand: '#8d95c4', scarf: PAL.magenta, scarf2: '#b3125f',
  };

  class Player extends G.Actor {
    constructor(x, y) {
      super(x - 5, y - 22, 10, 22);
      this.team = 'player';
      this.stats = { brutality: 1, tactics: 1, survival: 1 };
      this.baseHp = 100;
      this.maxHp = this.hp = 100;
      this.flasks = 2; this.maxFlasks = 2; this.flaskHeal = 0.5;
      this.cells = 0; this.gold = 0; this.kills = 0;
      this.slots = { primary: null, secondary: null, skill1: null, skill2: null };
      this.mutations = [];
      this.state = 'normal'; this.stateT = 0;
      this.airJumps = 1; this.jumpsUsed = 0; this.coyote = 0; this.jumpBuf = 0;
      this.rollT = 0; this.rollCd = 0; this.landLag = 0;
      this.act = null; this.buffer = null;
      this.recoverable = 0; this.recoverT = 0;
      this.healT = 0; this.healRate = 0;
      this.cdMul = 1; this.dmgMul = 1;
      this.runPhase = 0; this.idleT = 0;
      this.ledge = null; this.ladderX = 0; this.climbPhase = 0;
      this.safe = { x: this.x, y: this.y }; this.safeT = 0;
      this.ghosts = []; this.ghostT = 0;
      this.scarf = [];
      for (let i = 0; i < 6; i++) this.scarf.push({ x: this.cx, y: this.y + 6, px: this.cx, py: this.y + 6 });
      this.focus = null;
      this.deadT = 0;
      this.recalc(true);
    }

    // ------------------------------------------------------------ stats
    statMul(stat) {
      if (!stat) return 1;
      if (Array.isArray(stat)) return Math.max(...stat.map((s) => this.statMul(s)));
      return Math.pow(1.14, (this.stats[stat] || 1) - 1);
    }
    recalc(fill) {
      const s = this.stats;
      const old = this.maxHp;
      let hp = this.baseHp + 14 * (s.brutality - 1) + 14 * (s.tactics - 1) + 32 * (s.survival - 1);
      for (const m of this.mutations) if (m.hpMul) hp *= m.hpMul;
      this.maxHp = Math.round(hp * (this.hpMul || 1));
      if (fill) this.hp = this.maxHp;
      else if (this.maxHp > old) this.hp += this.maxHp - old;
      this.hp = Math.min(this.hp, this.maxHp);
    }
    addStat(stat) {
      this.stats[stat] = (this.stats[stat] || 1) + 1;
      this.recalc(false);
      this.hp = this.maxHp; // scrolls fully heal (like Dead Cells)
    }

    // ------------------------------------------------------------ inventory
    slotFor(inst) {
      const k = inst.def.kind;
      if (k === 'skill') {
        if (!this.slots.skill1) return 'skill1';
        if (!this.slots.skill2) return 'skill2';
        return G.input.down('down') ? 'skill2' : 'skill1';
      }
      if (!this.slots.primary) return 'primary';
      if (!this.slots.secondary) return 'secondary';
      if (G.input.down('down')) return 'secondary';
      if (this.slots.primary.def.kind === k) return 'primary';
      if (this.slots.secondary.def.kind === k) return 'secondary';
      return 'primary';
    }
    // returns the item that was replaced (or null)
    equip(inst, slot) {
      slot = slot || this.slotFor(inst);
      const old = this.slots[slot];
      if (this.act && this.act.inst === old) { this.act.end(); this.act = null; }
      this.slots[slot] = inst;
      G.emit('equip', { player: this, inst, slot, old });
      return old;
    }

    // ------------------------------------------------------------ damage
    takeDamage(amount, info = {}) {
      if (this.dead || this.dying || this.state === 'dead') return 0;
      if (G.debug.god) amount = 0;
      if (this.invuln > 0 || (this.state === 'roll' && this.rollT < ROLL_IFRAMES) || this.state === 'ledge') return 0;
      if (this.act && this.act.block) {
        amount = this.act.block(amount, info, G.world);
        if (amount <= 0) return 0;
      }
      for (const m of this.mutations) if (m.onIncoming) amount = m.onIncoming(this, amount, info);
      if (amount <= 0 && !G.debug.god) return 0;
      const dealt = super.takeDamage(Math.max(G.debug.god ? 0 : 1, amount), Object.assign({}, info, { stun: 0, kb: (info.kb || 60) * 0.8, kbUp: info.kbUp || 90 }));
      if (!dealt && !G.debug.god) return 0;
      this.recoverable = Math.min(this.maxHp - this.hp, this.recoverable + dealt * 0.6);
      this.recoverT = 0;
      this.invuln = 0.6; this.hurtInvuln = true;
      if (this.state !== 'dead') { this.state = 'hurt'; this.stateT = 0; }
      if (this.act) { this.act.end(); this.act = null; }
      this.healT = 0;
      const w = G.world;
      if (w) {
        w.shake(4, 0.25); w.hitstop(0.06);
        w.fx.flash(PAL.red, 0.1);
        w.fx.splat(this.cx, this.cy, info.dir || -this.facing, 10, ['#ff2a8a', '#b3125f', '#27f3ff']);
        w.glitch = Math.max(w.glitch, 0.25);
      }
      if (G.audio) G.audio.play('playerHurt');
      G.emit('playerHurt', { dmg: dealt, info });
      return dealt;
    }
    die() {
      this.hp = 0;
      this.state = 'dead'; this.stateT = 0; this.dying = true;
      if (this.act) { this.act.end(); this.act = null; }
      const w = G.world;
      if (w) {
        w.fx.burst(this.cx, this.y + 4, 40, { speed: 200, life: 1.2, color: [PAL.cyan, '#9ffcff', PAL.magenta], shape: 'px', grav: -60, drag: 2, glow: 6, additive: true });
        w.hitstop(0.25); w.shake(6, 0.5); w.glitch = 1;
      }
      if (G.audio) { G.audio.play('death'); G.audio.duck(0.8, 2); }
      G.emit('playerDied', { player: this });
    }
    // called by weapons when damage is dealt: recovery (rally) heals part of recent damage
    onDealDamage(dealt, target, inst) {
      if (this.recoverable > 0 && dealt > 0) {
        const h = Math.min(this.recoverable, Math.max(1, dealt * 0.45));
        this.recoverable -= h;
        this.heal(h);
      }
      for (const m of this.mutations) if (m.onDealDamage) m.onDealDamage(this, dealt, target, inst);
    }

    // ------------------------------------------------------------ update
    update(dt, world) {
      const L = world.level, I = G.input;
      this.tickTimers(dt);
      this.updateStatuses(dt);
      this.stateT += dt;
      if (this.state === 'dead') {
        this.vx *= Math.pow(0.02, dt);
        this.physics(dt, L);
        this.deadT += dt;
        this.updateScarf(dt);
        return;
      }

      // timers
      for (const k in this.slots) { const it = this.slots[k]; if (it && it.cd > 0) it.cd = Math.max(0, it.cd - dt); }
      if (this.rollCd > 0) this.rollCd -= dt;
      if (this.landLag > 0) this.landLag -= dt;
      if (this.jumpBuf > 0) this.jumpBuf -= dt;
      this.recoverT += dt;
      if (this.recoverT > 2.5) this.recoverable = Math.max(0, this.recoverable - this.maxHp * 0.25 * dt);
      if (this.healT > 0) {
        this.healT -= dt;
        this.heal(this.healRate * dt);
        if (G.rand.chance(dt * 30)) world.fx.particle({ x: this.x + G.rand.float(0, this.w), y: this.y + G.rand.float(4, this.h), vy: -40, life: 0.5, color: PAL.green, glow: 5, additive: true });
      }
      if (I.pressed('jump')) this.jumpBuf = 0.13;
      for (const [slot, btn] of SLOT_BUTTONS) if (I.pressed(btn)) this.buffer = { slot, btn, t: 0.22 };
      if (this.buffer && (this.buffer.t -= dt) <= 0) this.buffer = null;
      for (const m of this.mutations) if (m.update) m.update(this, dt, world);

      const ix = (I.down('right') ? 1 : 0) - (I.down('left') ? 1 : 0);
      switch (this.state) {
        case 'normal': this.stNormal(dt, world, ix); break;
        case 'roll': this.stRoll(dt, world, ix); break;
        case 'slam': this.stSlam(dt, world); break;
        case 'ladder': this.stLadder(dt, world, ix); break;
        case 'ledge': this.stLedge(dt, world); break;
        case 'hurt':
          this.physics(dt, L);
          this.vx = G.approach(this.vx, 0, 600 * dt);
          if (this.stateT > 0.2) this.state = 'normal';
          break;
      }

      // hazards
      if (this.state !== 'dead' && this.invuln <= 0 && this.touchesHazard(L)) {
        this.takeDamage(Math.round(this.maxHp * 0.12), { kb: 0, kbUp: 330, color: PAL.red });
        this.vy = -330;
        if (G.audio) G.audio.play('spikes');
      }
      // fell out of the map
      if (this.y > L.ph + 40) {
        this.x = this.safe.x; this.y = this.safe.y; this.vx = this.vy = 0;
        this.takeDamage(Math.round(this.maxHp * 0.1), { kb: 0 });
      }
      if (this.onGround && this.state === 'normal') {
        this.safeT += dt;
        if (this.safeT > 0.4 && !this.touchesHazard(L) && L.solid(Math.floor(this.cx / TS), Math.floor((this.bottom + 2) / TS))) { this.safe.x = this.x; this.safe.y = this.y; this.safeT = 0; }
      }
      L.reveal(this.cx, this.cy, 11);

      // interactables
      this.focus = null;
      let best = 1e9;
      for (const o of world.objects) {
        if (!o.interactable || o.dead) continue;
        const r = o.interactRange || 18;
        if (Math.abs(o.cx - this.cx) < r + o.w / 2 && this.bottom > o.y - 8 && this.y < o.y + o.h + 4) {
          const d = Math.abs(o.cx - this.cx);
          if (d < best) { best = d; this.focus = o; }
        }
      }
      if (this.focus && I.pressed('interact') && this.state === 'normal') this.focus.interact(this, world);

      this._lastJ = this.joints(this.buildPose());
      this.updateScarf(dt);
      // afterimages
      this.ghostT -= dt;
      if ((this.state === 'roll' || this.state === 'slam') && this.ghostT <= 0) {
        this.ghostT = 0.03;
        this.ghosts.push({ j: this.joints(this.buildPose()), t: 0, c: this.ghosts.length % 2 ? PAL.cyan : PAL.magenta });
      }
      for (let i = this.ghosts.length - 1; i >= 0; i--) { this.ghosts[i].t += dt; if (this.ghosts[i].t > 0.18) this.ghosts.splice(i, 1); }
    }

    canUseItems() { return this.state === 'normal' && this.landLag <= 0; }

    handleItems(dt, world) {
      if (this.buffer && this.canUseItems()) {
        const { slot, btn } = this.buffer;
        const inst = this.slots[slot];
        if (!inst) this.buffer = null;
        else if (this.act && this.act.inst === inst && !this.act.done && !(this.act.cancelable && this.act.restartOnPress)) {
          this.act.press(); this.buffer = null;
        } else if (!this.act || this.act.cancelable) {
          if (inst.cd > 0) {
            this.buffer = null;
            if (G.audio) G.audio.play('denied', { vol: 0.5 });
            G.emit('denied', { slot });
          } else {
            if (this.act) this.act.end();
            this.act = inst.def.use(this, inst, world, btn);
            this.buffer = null;
            G.emit('itemUsed', { slot, inst });
          }
        }
      }
      if (this.act) {
        this.act.update(dt, world);
        if (this.act && this.act.done) { this.act.end(); this.act = null; }
      }
    }

    stNormal(dt, world, ix) {
      const L = world.level, I = G.input;
      if (this.onGround) { this.coyote = 0.1; this.jumpsUsed = 0; } else this.coyote -= dt;

      // horizontal
      let mm = 1;
      if (this.act) mm = this.onGround ? this.act.moveMul : this.act.airMoveMul;
      if (this.healT > 0) mm = Math.min(mm, 0.5);
      if (this.landLag > 0) mm = 0;
      const target = ix * RUN * this.slowMul * (this.speedMul || 1) * mm;
      const acc = this.act ? 700 : this.onGround ? (ix ? 1600 : 2200) : 1200;
      this.vx = G.approach(this.vx, target, acc * dt);
      if (ix && (!this.act || !this.act.lockFacing)) this.facing = ix;

      // ladders
      const ladTx = Math.floor(this.cx / TS);
      if (I.down('up') && !this.act) {
        for (let ty = Math.floor((this.y + 2) / TS); ty <= Math.floor((this.bottom - 2) / TS); ty++) {
          if (L.ladder(ladTx, ty)) { this.enterLadder(ladTx); return; }
        }
      }
      if (I.down('down') && this.onGround && !this.act && L.ladder(ladTx, Math.floor((this.bottom + 2) / TS)) && !I.down('jump')) {
        this.y += 3; this.enterLadder(ladTx); return;
      }

      // jump / drop / slam / double jump
      if (this.jumpBuf > 0 && this.landLag <= 0 && (!this.act || this.act.cancelable || !this.onGround)) {
        if (I.down('down') && this.onGround && this.standingOnPlatformOnly(L)) {
          this.dropThrough = 0.25; this.jumpBuf = 0; this.y += 1; this.onGround = false;
        } else if (I.down('down') && !this.onGround && this.coyote <= 0) {
          this.startSlam(world);
          return;
        } else if (this.coyote > 0) {
          this.cancelAct();
          this.vy = -JUMP_V * (this.jumpMul || 1); this.coyote = 0; this.jumpBuf = 0;
          world.fx.burst(this.cx, this.bottom, 6, { angle: -Math.PI / 2, spread: 1.2, speed: 60, life: 0.3, color: ['#4a4666', '#6f7299'], grav: 100 });
          if (G.audio) G.audio.play('jump');
        } else if (this.jumpsUsed < this.airJumps) {
          this.cancelAct();
          this.vy = -DJUMP_V * (this.jumpMul || 1); this.jumpsUsed++; this.jumpBuf = 0;
          world.fx.ring(this.cx, this.bottom, 2, 12, PAL.cyan, 0.25, 1);
          world.fx.burst(this.cx, this.bottom, 8, { angle: Math.PI / 2, spread: 1.0, speed: 90, life: 0.3, color: [PAL.cyan, PAL.magenta], grav: 0, additive: true });
          if (G.audio) G.audio.play('doublejump');
        }
      }
      if (I.released('jump') && this.vy < -120) this.vy *= 0.5;

      // roll
      if (I.pressed('roll') && this.rollCd <= 0 && this.landLag <= 0 && (!this.act || this.act.cancelable || this.act.rollCancel !== false)) {
        this.cancelAct();
        if (ix) this.facing = ix;
        this.state = 'roll'; this.stateT = 0; this.rollT = 0;
        this.vx = this.facing * ROLL_V;
        world.fx.burst(this.cx, this.bottom, 5, { angle: this.facing > 0 ? Math.PI : 0, spread: 0.6, speed: 70, life: 0.3, color: ['#4a4666'], grav: 80 });
        if (G.audio) G.audio.play('roll');
        return;
      }

      // heal
      if (I.pressed('heal') && !this.act) this.tryHeal(world);

      this.handleItems(dt, world);
      if (this.state !== 'normal') return;

      // physics
      const g0 = this.gravity;
      if (this.vy > 0) this.gravity = g0 * 1.2;
      if (this.act) this.gravity *= this.act.gravityMul;
      const vyBefore = this.vy;
      this.physics(dt, L);
      this.gravity = g0;
      if (this.onGround && !this.wasOnGround) this.onLand(vyBefore, world);

      // ledge grab
      if (!this.onGround && this.vy > -40 && ix === this.facing && !this.act) this.tryLedge(L);

      // footsteps
      if (this.onGround && Math.abs(this.vx) > 40) {
        const prev = this.runPhase;
        this.runPhase += dt * Math.abs(this.vx) / 8.5;
        if (Math.floor(prev / Math.PI) !== Math.floor(this.runPhase / Math.PI)) {
          if (G.audio) G.audio.play('step', { vol: 0.35 });
          if (G.rand.chance(0.5)) world.fx.particle({ x: this.cx - this.facing * 3, y: this.bottom - 1, vx: -this.facing * 20, vy: -15, life: 0.3, color: '#3b3753', grav: 60 });
        }
      } else this.runPhase = 0;
    }

    cancelAct() { if (this.act) { this.act.end(); this.act = null; } }

    onLand(vy, world) {
      if (vy > 200) {
        world.fx.burst(this.cx, this.bottom, vy > 380 ? 10 : 5, { angle: -Math.PI / 2, spread: 1.4, speed: 70, life: 0.35, color: ['#4a4666', '#6f7299'], grav: 150 });
        if (G.audio) G.audio.play('land', { vol: Math.min(1, vy / 430) });
      }
    }

    tryHeal(world) {
      if (this.flasks <= 0 || this.hp >= this.maxHp || this.healT > 0) {
        if (G.audio) G.audio.play('denied', { vol: 0.5 });
        return;
      }
      this.flasks--;
      const amount = this.maxHp * this.flaskHeal;
      this.healT = 0.6; this.healRate = amount / 0.6;
      this.recoverable = 0;
      world.fx.ring(this.cx, this.cy, 4, 22, PAL.green, 0.4, 1);
      if (G.audio) G.audio.play('heal');
      G.emit('heal', { amount });
    }

    enterLadder(tx) {
      this.cancelAct();
      this.state = 'ladder'; this.stateT = 0;
      this.ladderX = tx * TS + TS / 2 - this.w / 2;
      this.x = this.ladderX; this.vx = 0; this.vy = 0; this.onLadder = true; this.jumpsUsed = 0;
    }
    stLadder(dt, world, ix) {
      const L = world.level, I = G.input;
      const dir = (I.down('down') ? 1 : 0) - (I.down('up') ? 1 : 0);
      this.vy = dir * 90; this.vx = 0; this.x = this.ladderX;
      if (dir) {
        const prev = this.climbPhase;
        this.climbPhase += dt * 9;
        if (Math.floor(prev / Math.PI) !== Math.floor(this.climbPhase / Math.PI) && G.audio) G.audio.play('ladder', { vol: 0.3 });
      }
      this.noGravity = true;
      this.physics(dt, L);
      this.noGravity = false;
      const tx = Math.floor(this.cx / TS);
      let on = false;
      for (let ty = Math.floor((this.y + 6) / TS); ty <= Math.floor((this.bottom - 1) / TS); ty++) if (L.ladder(tx, ty)) on = true;
      const exit = (vy) => { this.state = 'normal'; this.onLadder = false; this.vy = vy; };
      if (this.jumpBuf > 0) { this.jumpBuf = 0; exit(-JUMP_V * 0.85); if (ix) this.facing = ix; this.vx = ix * RUN; if (G.audio) G.audio.play('jump'); return; }
      if (!on) {
        if (dir < 0) { exit(0); this.y = Math.floor(this.bottom / TS) * TS - this.h; if (L.floorAt(this.cx, this.bottom + 1)) this.onGround = true; }
        else exit(0);
        return;
      }
      if (this.onGround && dir > 0) exit(0);
    }

    tryLedge(L) {
      const d = this.facing;
      const tx = d > 0 ? Math.floor((this.x + this.w + 2) / TS) : Math.floor((this.x - 2) / TS);
      const myTx = Math.floor(this.cx / TS);
      for (let ty = Math.floor((this.y - 6) / TS); ty <= Math.floor((this.y + 12) / TS); ty++) {
        const top = ty * TS;
        if (top < this.y - 8 || top > this.y + 12) continue;
        if (L.solid(tx, ty) && !L.solid(tx, ty - 1) && !L.solid(tx, ty - 2) && !L.solid(myTx, ty - 1) && !L.solid(myTx, ty - 2)) {
          this.state = 'ledge'; this.stateT = 0;
          this.ledge = { x0: this.x, y0: this.y, x1: d > 0 ? tx * TS + 1 : (tx + 1) * TS - this.w - 1, y1: top - this.h };
          this.vx = 0; this.vy = 0; this.jumpsUsed = 0;
          if (G.audio) G.audio.play('ledge');
          return true;
        }
      }
      return false;
    }
    stLedge(dt) {
      const k = Math.min(1, this.stateT / 0.17);
      const l = this.ledge;
      // up first, then over
      const ky = G.easeOut(Math.min(1, k * 1.4)), kx = G.easeInOut(Math.max(0, (k - 0.35) / 0.65));
      this.y = G.lerp(l.y0, l.y1, ky);
      this.x = G.lerp(l.x0, l.x1, kx);
      if (k >= 1) { this.state = 'normal'; this.onGround = true; this.vy = 0; }
    }

    stRoll(dt, world, ix) {
      this.rollT += dt;
      this.vx = this.facing * ROLL_V * (this.rollT > ROLL_T * 0.75 ? 0.6 : 1) * (this.rollMul || 1);
      this.physics(dt, world.level);
      if (this.rollT >= ROLL_T) {
        this.state = 'normal'; this.rollCd = 0.1;
        for (const m of this.mutations) if (m.onRollEnd) m.onRollEnd(this, world);
      }
      // allow jumping out of a roll
      if (this.jumpBuf > 0 && this.onGround && this.rollT > 0.08) { this.state = 'normal'; this.rollCd = 0.1; }
    }

    startSlam(world) {
      this.cancelAct();
      this.state = 'slam'; this.stateT = 0; this.jumpBuf = 0;
      this.vx = 0; this.vy = -80;
      if (G.audio) G.audio.play('dash');
    }
    stSlam(dt, world) {
      if (this.stateT > 0.08) this.vy = 620;
      this.invuln = Math.max(this.invuln, 0.05);
      const mf = this.maxFall; this.maxFall = 640;
      this.physics(dt, world.level);
      this.maxFall = mf;
      if (this.onGround) {
        const best = Math.max(this.statMul('brutality'), this.statMul('tactics'), this.statMul('survival'));
        const box = { x: this.cx - 34, y: this.bottom - 18, w: 68, h: 20 };
        const hits = G.hitBox(world, box, 'player', Math.round(14 * best * (this.dmgMul || 1)), { kb: 140, kbUp: 200, stun: 1.1, sourceKind: 'slam' });
        for (const t of hits) this.onDealDamage(t.lastDealt || 1, t, null);
        world.fx.ring(this.cx, this.bottom, 4, 36, PAL.cyan, 0.35, 2);
        world.fx.burst(this.cx, this.bottom - 1, 18, { angle: -Math.PI / 2, spread: 1.4, speed: 200, life: 0.4, color: [PAL.cyan, '#ffffff', '#4a4666'], grav: 500, shape: 'spark' });
        world.shake(5, 0.25); world.hitstop(0.05);
        world.flashLights.push({ x: this.cx, y: this.bottom, r: 70, color: PAL.cyan, t: 0, life: 0.2 });
        this.state = 'normal'; this.landLag = 0.16;
        if (G.audio) G.audio.play('slam');
      }
    }

    updateScarf(dt) {
      const s = this.scarf;
      const pose = this._lastJ;
      const ax = pose ? pose.neck[0] : this.cx, ay = pose ? pose.neck[1] + 1 : this.y + 6;
      s[0].x = ax; s[0].y = ay;
      const wind = -this.vx * 0.9 - this.facing * 25;
      for (let i = 1; i < s.length; i++) {
        const p = s[i];
        const vx = (p.x - p.px) * 0.86, vy = (p.y - p.py) * 0.86;
        p.px = p.x; p.py = p.y;
        p.x += vx + wind * dt * dt * 30 + Math.sin(this.t * 7 + i) * 0.08;
        p.y += vy + 260 * dt * dt + Math.cos(this.t * 5 + i * 1.3) * 0.05;
      }
      for (let k = 0; k < 3; k++) {
        for (let i = 1; i < s.length; i++) {
          const a = s[i - 1], b = s[i];
          const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.001;
          const f = (d - 3) / d;
          b.x -= dx * f; b.y -= dy * f;
        }
      }
    }

    // ------------------------------------------------------------ pose & drawing
    buildPose() {
      const P = { lean: 0.05, bob: 0, crouch: 0, thF: 0.05, shF: -0.05, thB: -0.1, shB: -0.15, uaF: 0.25, faF: 0.55, uaB: -0.15, faB: 0.2, rot: 0, aim: null, held: null };
      const st = this.state;
      if (st === 'dead') {
        const k = Math.min(1, this.deadT / 0.5);
        P.crouch = 9 * k; P.lean = G.lerp(0.1, 1.1, k); P.thF = 1.4 * k; P.shF = -0.3; P.thB = 1.2 * k; P.shB = -0.6 * k;
        P.uaF = 0.3; P.faF = 0.2; P.uaB = 0.5; P.faB = 0.3;
        return P;
      }
      if (st === 'roll') {
        const k = this.rollT / ROLL_T;
        P.rot = k * Math.PI * 2; P.crouch = 7; P.lean = 0.9;
        P.thF = 2.0; P.shF = -0.6; P.thB = 1.7; P.shB = -0.9; P.uaF = 1.6; P.faF = 2.6; P.uaB = 1.2; P.faB = 2.3;
        return P;
      }
      if (st === 'ledge') {
        P.uaF = 2.9; P.faF = 3.0; P.uaB = 2.7; P.faB = 2.9; P.thF = 1.4; P.shF = 0.2; P.thB = 0.9; P.shB = -0.4; P.lean = 0.3; P.crouch = 3;
        return P;
      }
      if (st === 'ladder') {
        const c = Math.sin(this.climbPhase);
        P.uaF = 2.7 + c * 0.35; P.faF = 3.0 + c * 0.2; P.uaB = 2.7 - c * 0.35; P.faB = 3.0 - c * 0.2;
        P.thF = 0.5 + c * 0.5; P.shF = -0.3 + c * 0.3; P.thB = 0.5 - c * 0.5; P.shB = -0.3 - c * 0.3; P.lean = 0;
        return P;
      }
      if (st === 'slam') {
        P.thF = 1.2; P.shF = -0.2; P.thB = 0.6; P.shB = -0.8; P.uaF = 2.6; P.faF = 2.2; P.uaB = 2.4; P.faB = 2.0; P.lean = 0.3;
        return P;
      }
      if (st === 'hurt') {
        P.lean = -0.45; P.uaF = -0.9; P.faF = -0.4; P.uaB = -1.2; P.faB = -0.6; P.thF = 0.4; P.thB = -0.4;
        return P;
      }
      if (!this.onGround) {
        if (this.vy < 0) { P.thF = 1.0; P.shF = -0.3; P.thB = -0.25; P.shB = -1.1; P.uaF = 1.3; P.faF = 1.9; P.uaB = -0.8; P.faB = -0.2; P.lean = 0.15; }
        else { P.thF = 0.45; P.shF = 0.05; P.thB = -0.35; P.shB = -0.55; P.uaF = 2.0; P.faF = 2.5; P.uaB = 1.6; P.faB = 2.2; P.lean = 0.05; }
      } else if (Math.abs(this.vx) > 25) {
        const ph = this.runPhase;
        const s = Math.sin(ph);
        P.thF = s * 0.85; P.thB = -s * 0.85;
        P.shF = P.thF - 0.2 - Math.max(0, Math.cos(ph)) * 1.1;
        P.shB = P.thB - 0.2 - Math.max(0, -Math.cos(ph)) * 1.1;
        P.uaF = -s * 0.8 + 0.15; P.faF = P.uaF + 0.9; P.uaB = s * 0.8 + 0.15; P.faB = P.uaB + 0.9;
        P.lean = 0.28; P.bob = Math.abs(Math.cos(ph)) * -1.2 + 0.6;
      } else {
        P.bob = Math.sin(this.t * 2.2) * 0.6;
      }
      if (this.healT > 0) { P.uaF = 2.2; P.faF = 3.3; }
      if (this.landLag > 0) { P.crouch = 3; P.thF = 0.9; P.shF = -0.5; P.thB = 0.6; P.shB = -0.7; }
      if (this.act) this.act.pose(P);
      if (P.aim != null) {
        const la = Math.PI / 2 - P.aim;
        P.uaF = la - 0.3 * (1 - (P.recoil || 0)); P.faF = la;
        if (P.twoHand) { P.uaB = la - 0.1; P.faB = la + 0.1; }
        if (P.throwing) { P.uaF = la + 0.4; P.faF = la; }
      }
      return P;
    }
    joints(P) {
      const f = this.facing;
      const fx = Math.round(this.cx), fy = Math.round(this.bottom);
      const dir = (a, len) => [Math.sin(a) * len * f, Math.cos(a) * len];
      const TH = 6, SH = 6, TO = 8, UA = 5, FA = 5;
      // hip height so the lower foot touches the ground
      const legDrop = (th, sh) => Math.cos(th) * TH + Math.cos(sh) * SH;
      const hipH = Math.max(legDrop(P.thF, P.shF), legDrop(P.thB, P.shB), 6);
      let hip = [0, -hipH - P.crouch * 0 + P.bob];
      if (P.crouch) hip[1] += P.crouch * 0.6;
      const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
      const kneeF = add(hip, dir(P.thF, TH)), footF = add(kneeF, dir(P.shF, SH));
      const kneeB = add(hip, dir(P.thB, TH)), footB = add(kneeB, dir(P.shB, SH));
      const neck = add(hip, [Math.sin(P.lean) * TO * f, -Math.cos(P.lean) * TO]);
      const head = add(neck, [Math.sin(P.lean) * 3 * f, -3.5]);
      const sh = add(neck, [0, 1]);
      const elbowF = add(sh, dir(P.uaF, UA)), handF = add(elbowF, dir(P.faF, FA));
      const shB = add(neck, [-f, 1]);
      const elbowB = add(shB, dir(P.uaB, UA)), handB = add(elbowB, dir(P.faB, FA));
      const J = { hip, kneeF, footF, kneeB, footB, neck, head, sh, elbowF, handF, shB, elbowB, handB };
      // rotation (roll) around body center
      if (P.rot) {
        const cxr = 0, cyr = -8, c = Math.cos(P.rot * f), s = Math.sin(P.rot * f);
        for (const k in J) {
          const x = J[k][0] - cxr, y = J[k][1] - cyr;
          J[k] = [cxr + x * c - y * s, cyr + x * s + y * c];
        }
      }
      for (const k in J) J[k] = [fx + J[k][0], fy + J[k][1]];
      J.pose = P;
      return J;
    }

    draw(ctx, cam) {
      const P = this.buildPose();
      const J = this.joints(P);
      this._lastJ = J;
      const ox = cam.ox, oy = cam.oy;
      const S = (p) => [p[0] - ox, p[1] - oy];
      // ghosts
      for (const g of this.ghosts) {
        ctx.globalAlpha = 0.45 * (1 - g.t / 0.18);
        this.drawSkeleton(ctx, g.j, ox, oy, g.c);
      }
      ctx.globalAlpha = 1;
      if (this.invuln > 0 && this.hurtInvuln && this.state !== 'dead' && Math.floor(this.invuln * 20) % 2 === 0) return;
      if (this.invuln <= 0) this.hurtInvuln = false;
      // scarf (behind body)
      const sc = this.scarf;
      for (let i = 1; i < sc.length; i++) {
        G.px.line(ctx, sc[i - 1].x - ox, sc[i - 1].y - oy, sc[i].x - ox, sc[i].y - oy, COL.outline, 4);
      }
      for (let i = 1; i < sc.length; i++) {
        G.px.line(ctx, sc[i - 1].x - ox, sc[i - 1].y - oy, sc[i].x - ox, sc[i].y - oy, i < 3 ? COL.scarf : COL.scarf2, i < 4 ? 2 : 1);
      }
      const white = this.flash > 0 ? '#ffffff' : null;
      this.drawSkeleton(ctx, J, ox, oy, white, true);
      // held item
      if (this.state !== 'dead' && this.state !== 'roll' && this.state !== 'ladder' && this.state !== 'ledge') {
        let inst = this.act ? this.act.inst : null;
        let ang;
        if (inst && P.aim != null) ang = this.facing > 0 ? P.aim : Math.PI - P.aim;
        else {
          inst = this.slots.primary;
          if (inst && inst.def.kind !== 'melee') inst = null;
          const ia = this.onGround ? (Math.abs(this.vx) > 25 ? 2.55 : 2.35) : 2.7;
          ang = this.facing > 0 ? ia : Math.PI - ia;
        }
        if (inst && inst.def.drawHeld) {
          const h = S(J.handF);
          inst.def.drawHeld(ctx, h[0], h[1], ang, this, inst, 1);
        }
        // front hand over the weapon grip
        const h = S(J.handF);
        G.px.rect(ctx, h[0] - 1, h[1] - 1, 2, 2, white || COL.hand);
      }
      if (this.act && this.act.draw) this.act.draw(ctx, cam);
    }

    drawSkeleton(ctx, J, ox, oy, mono, full) {
      const S = (p) => [p[0] - ox, p[1] - oy];
      const seg = (a, b, c, t) => { const A = S(a), B = S(b); G.px.line(ctx, A[0], A[1], B[0], B[1], c, t); };
      const O = mono && !full ? mono : COL.outline;
      // outline pass
      if (full || !mono) {
        seg(J.hip, J.kneeB, O, 5); seg(J.kneeB, J.footB, O, 5);
        seg(J.shB, J.elbowB, O, 5); seg(J.elbowB, J.handB, O, 4);
        seg(J.hip, J.neck, O, 7);
        seg(J.hip, J.kneeF, O, 5); seg(J.kneeF, J.footF, O, 5);
        seg(J.sh, J.elbowF, O, 5); seg(J.elbowF, J.handF, O, 4);
        const h = S(J.head); G.px.disc(ctx, h[0], h[1], 4, O);
      }
      const c = (col) => mono || col;
      // back limbs
      seg(J.shB, J.elbowB, c(COL.armB), 3); seg(J.elbowB, J.handB, c(COL.armB), 2);
      seg(J.hip, J.kneeB, c(COL.legB), 3); seg(J.kneeB, J.footB, c(COL.legB), 3);
      const fb = S(J.footB); G.px.rect(ctx, fb[0] - 1 + (this.facing > 0 ? 0 : -1), fb[1] - 1, 3, 2, c(COL.boot));
      // torso (coat)
      seg(J.hip, J.neck, c(COL.coat), 5);
      if (!mono) {
        const a = S(J.hip), b = S(J.neck);
        G.px.line(ctx, a[0] + this.facing * 2, a[1], b[0] + this.facing * 2, b[1] + 1, COL.trim, 1);
        // coat tail
        G.px.line(ctx, a[0] - this.facing * 1, a[1], a[0] - this.facing * 4 - this.vx * 0.02, a[1] + 5, COL.coatB, 3);
        // belt + chest light
        G.px.rect(ctx, a[0] - 2, a[1] - 1, 5, 1, '#15131f');
        G.px.rect(ctx, a[0] + (this.facing > 0 ? 0 : 0), a[1] - 1, 1, 1, PAL.yellow);
        const m = [(a[0] * 0.4 + b[0] * 0.6), (a[1] * 0.4 + b[1] * 0.6)];
        G.px.rect(ctx, m[0] - (this.facing > 0 ? 0 : 1), m[1], 2, 1, '#4a4470');
        // collar (scarf origin)
        G.px.rect(ctx, b[0] - 2, b[1], 4, 2, COL.scarf);
        G.px.rect(ctx, b[0] - 2 - this.facing, b[1] + 1, 1, 1, COL.scarf2);
      }
      // front leg
      seg(J.hip, J.kneeF, c(COL.leg), 3); seg(J.kneeF, J.footF, c(COL.leg), 3);
      const ff = S(J.footF); G.px.rect(ctx, ff[0] - 1 + (this.facing > 0 ? 0 : -1), ff[1] - 1, 3, 2, c(COL.boot));
      // head: nanite flame
      const h = S(J.head);
      if (mono) G.px.disc(ctx, h[0], h[1], 3, mono);
      else this.drawFlame(ctx, h[0], h[1]);
      // front arm
      seg(J.sh, J.elbowF, c(COL.arm), 3); seg(J.elbowF, J.handF, c(COL.arm), 2);
    }

    drawFlame(ctx, x, y) {
      const t = this.t, f = this.facing;
      const lean = -f * G.clamp(Math.round(this.vx * 0.012), -2, 2);
      // skull plate
      G.px.disc(ctx, x, y, 3, '#0c3d4a');
      G.px.rect(ctx, x - 2, y - 1, 5, 3, '#15879c');
      // flame: 5 columns, tallest in the middle-back, flickering
      const base = [2, 4, 5, 4, 2];
      for (let i = 0; i < 5; i++) {
        const col = i - 2;
        const hgt = base[i] + Math.round(Math.sin(t * 14 + i * 1.7) * 1.2 + Math.sin(t * 6.1 + i * 0.6));
        for (let k = 0; k < hgt; k++) {
          const cx = x + col - f * (k > 1 ? 1 : 0) + (k > 2 ? lean : 0);
          ctx.fillStyle = k >= hgt - 1 ? PAL.magenta : k >= hgt - 2 ? '#27f3ff' : '#aefcff';
          ctx.fillRect(cx, y - 2 - k, 1, 1);
        }
      }
      // visor eye
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x + (f > 0 ? 1 : -2), y, 2, 1);
      ctx.fillStyle = PAL.magenta;
      ctx.fillRect(x + (f > 0 ? 3 : -3), y, 1, 1);
    }
    drawLight(ctx, cam) {
      const J = this._lastJ;
      if (!J || this.state === 'dead') return;
      G.drawGlow(ctx, J.head[0] - cam.ox, J.head[1] - cam.oy - 3, 16, PAL.cyan, 0.3 + Math.sin(this.t * 9) * 0.05);
      G.drawGlow(ctx, this.cx - cam.ox, this.cy - cam.oy, 70, '#2a6cff', 0.07);
    }
  }
  G.Player = Player;
})();
