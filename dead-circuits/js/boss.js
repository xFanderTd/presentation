'use strict';
// «Смотритель» (The Overseer) — final boss: a corporate security mech built around a caged AI core.
// ~80 px tall reverse-jointed walker, drawn procedurally every frame (IK arms, smoothed poses) into an
// offscreen canvas and given a phase-colored neon rim via tinted-silhouette compositing.
//
// Phase 1 (100–66%): fist slam + ground shockwaves (jump), chest-laser floor sweep (roll), close swipe.
// Phase 2 (66–33%):  + double slam, missile barrage with floor markers, summons 2 mine-drones.
// Phase 3 (33–0%):   + thruster charge across the arena, back-and-forth laser, bigger barrages, faster.
// Transitions: roar (bossRoar), shake, glitch, push-back. Death: explosion chain → flash → pixel dissolve
// → G.emit('bossDefeated').
(function () {
  const G = window.G;
  const PAL = G.PAL, Art = G.EArt, TAU = Math.PI * 2;
  const snd = (n, o) => { if (G.audio) G.audio.play(n, o); };

  const BOSS_HP = 1400;
  const PHASE = [
    { core: '#27f3ff', coreL: '#e0ffff', coreD: '#0c4a5c', rim: '#7fe9ff', dim: '#1f5a8a' },
    { core: '#ff2a8a', coreL: '#ffe0f0', coreD: '#5c0c34', rim: '#ff70cc', dim: '#8a1a5a' },
    { core: '#ff3348', coreL: '#fff0e0', coreD: '#5c0c16', rim: '#ff6a5a', dim: '#8a1a22' },
  ];
  const C = {
    ink: '#0b0814', dark: '#1d2040', mid: '#363d6c', mid2: '#4a5390', light: '#8a96dc', hi: '#c8d0ff',
    back: '#161830', backM: '#252a4e', backL: '#3c4478', stripe: '#ffe14d', steel: '#5a6090', vent: '#ff8a2a',
  };
  // raw canvas & feet anchor (facing right)
  const CW = 190, CH = 152, OX = 88, OY = 148;
  const TH = 19, SH = 20, UA = 21, FA = 21;

  // two-bone IK: returns [upperAngle, lowerAngle] (0 = down, +PI/2 = forward)
  function ik(sh, t, L1, L2, bend) {
    let dx = t[0] - sh[0], dy = t[1] - sh[1];
    let d = Math.hypot(dx, dy);
    const max = L1 + L2 - 0.5;
    if (d > max) { dx *= max / d; dy *= max / d; d = max; }
    d = Math.max(d, Math.abs(L1 - L2) + 1);
    const th = Math.atan2(dx, dy);
    const a = Math.acos(G.clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
    const ua = th + bend * a;
    const el = [sh[0] + Math.sin(ua) * L1, sh[1] + Math.cos(ua) * L1];
    return [ua, Math.atan2(sh[0] + dx - el[0], sh[1] + dy - el[1])];
  }
  // skeleton from a pose (raw coords)
  function skel(P) {
    const d = (a, l) => [Math.sin(a) * l, Math.cos(a) * l];
    const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
    const drop = (th, sh) => Math.cos(th) * TH + Math.cos(sh) * SH;
    const hipH = Math.max(drop(P.thF, P.shF), drop(P.thB, P.shB));
    const hip = [OX + (P.hx || 0), OY - 5 - hipH + P.bob];
    const kneeF = add(hip, d(P.thF, TH)), ankF = add(kneeF, d(P.shF, SH));
    const hipB = add(hip, [-6, -1]);
    const kneeB = add(hipB, d(P.thB, TH)), ankB = add(kneeB, d(P.shB, SH));
    const l = P.lean, ux = Math.sin(l), uy = -Math.cos(l), px = Math.cos(l), py = Math.sin(l);
    const sp = (k, o) => [hip[0] + ux * k + px * o, hip[1] + uy * k + py * o];
    const shF = sp(36, 14), shB = sp(37, -15);
    return { hip, hipB, kneeF, ankF, kneeB, ankB, sp, shF, shB, eye: sp(22, 8), head: sp(47, 5), pod: sp(44, -17), thr: sp(20, -21), hatch: sp(10, 7), lean: l, px, py, ux, uy };
  }
  function arms(J, P) {
    const fF = [J.shF[0] + P.fFx, J.shF[1] + P.fFy], fB = [J.shB[0] + P.fBx, J.shB[1] + P.fBy];
    const [a1, a2] = ik(J.shF, fF, UA, FA, -1), [b1, b2] = ik(J.shB, fB, UA, FA, -1);
    const d = (a, l) => [Math.sin(a) * l, Math.cos(a) * l];
    J.elF = [J.shF[0] + d(a1, UA)[0], J.shF[1] + d(a1, UA)[1]]; J.haF = [J.elF[0] + d(a2, FA)[0], J.elF[1] + d(a2, FA)[1]]; J.faF = a2;
    J.elB = [J.shB[0] + d(b1, UA)[0], J.shB[1] + d(b1, UA)[1]]; J.haB = [J.elB[0] + d(b2, FA)[0], J.elB[1] + d(b2, FA)[1]]; J.faB = b2;
    return J;
  }

  // ---------------------------------------------------------------- drawing parts
  function fist(g, h, a, back, P) {
    const ux = Math.sin(a), uy = Math.cos(a), px = uy, py = -ux;
    const c = [h[0] + ux * 3, h[1] + uy * 3];
    const pt = (u, v) => [c[0] + ux * u + px * v, c[1] + uy * u + py * v];
    Art.poly(g, [pt(-7, -8), pt(-7, 8), pt(8, 8), pt(8, -8)], C.ink);
    Art.poly(g, [pt(-6, -7), pt(-6, 7), pt(7, 7), pt(7, -7)], back ? C.backM : C.mid2);
    if (!back) {
      const k0 = pt(6, -6), k1 = pt(6, 6);
      Art.line(g, k0[0], k0[1], k1[0], k1[1], C.hi);
      for (let v = -6; v <= 6; v += 4) { const a0 = pt(3, v), a1 = pt(7, v); Art.line(g, a0[0], a0[1], a1[0], a1[1], C.ink); }
      for (let v = -6; v <= 6; v++) { const s = pt(-4, v); Art.px(g, s[0], s[1], ((v + 8) >> 1) % 2 ? C.stripe : C.ink); }
    } else {
      const k0 = pt(6, -6), k1 = pt(6, 6);
      Art.line(g, k0[0], k0[1], k1[0], k1[1], C.backL);
    }
  }
  function foot(g, a, back) {
    const x = a[0], y = a[1];
    Art.poly(g, [[x - 9, y + 6], [x + 13, y + 6], [x + 11, y - 1], [x - 6, y - 1]], C.ink);
    Art.poly(g, [[x - 8, y + 5], [x + 12, y + 5], [x + 10, y], [x - 5, y]], back ? C.backM : C.mid);
    if (!back) { Art.rect(g, x - 4, y, 13, 1, C.light); for (let i = 0; i < 5; i++) Art.px(g, x - 6 + i * 4, y + 4, i % 2 ? C.ink : C.stripe); Art.rect(g, x + 11, y + 4, 3, 2, C.hi); }
    else Art.rect(g, x + 11, y + 4, 2, 2, C.backL);
  }
  function drawBoss(g, J, P, pc, b) {
    const L = (a, c, t0, t1, col) => Art.limb(g, a[0], a[1], c[0], c[1], t0, t1, col);
    const LS = (a, c, t0, t1, col, hl) => Art.limbS(g, a, c, t0, t1, col, C.ink, hl);
    // back arm
    LS(J.shB, J.elB, 8, 7, C.back, C.backL); LS(J.elB, J.haB, 9, 10, C.backM, C.backL);
    fist(g, J.haB, J.faB, true, P);
    // back leg
    LS(J.hipB, J.kneeB, 9, 8, C.back, C.backL); Art.disc(g, J.kneeB[0], J.kneeB[1], 4, C.ink); Art.disc(g, J.kneeB[0], J.kneeB[1], 3, C.backM);
    LS(J.kneeB, J.ankB, 7, 5, C.backM, C.backL);
    foot(g, J.ankB, true);
    // missile pod on the back shoulder
    const po = J.pod;
    Art.rect(g, po[0] - 10, po[1] - 8, 20, 15, C.ink);
    Art.rect(g, po[0] - 9, po[1] - 7, 18, 13, C.dark);
    Art.rect(g, po[0] - 9, po[1] - 7, 18, 1, C.light);
    for (let r = 0; r < 2; r++) for (let i = 0; i < 3; i++) {
      const hx = po[0] - 7 + i * 5, hy = po[1] - 4 + r * 5;
      if (P.pods > 0.5) { Art.rect(g, hx, hy, 4, 4, C.ink); Art.rect(g, hx + 1, hy + 1, 2, 2, PAL.red); Art.px(g, hx + 1, hy + 1, '#ffd0d6'); }
      else { Art.rect(g, hx, hy, 4, 4, C.mid); Art.rect(g, hx, hy, 4, 1, C.light); }
    }
    // back thruster nozzles
    const t = J.thr;
    Art.rect(g, t[0] - 5, t[1] - 6, 8, 13, C.ink);
    Art.rect(g, t[0] - 4, t[1] - 5, 6, 11, C.backM);
    Art.rect(g, t[0] - 4, t[1] + 3, 6, 2, P.thrust > 0.1 ? PAL.orange : C.back);
    // pelvis
    const hp = J.hip;
    Art.rect(g, hp[0] - 13, hp[1] - 5, 26, 10, C.ink);
    Art.rect(g, hp[0] - 12, hp[1] - 4, 24, 8, C.dark);
    Art.rect(g, hp[0] - 12, hp[1] - 4, 24, 1, C.mid2);
    // front leg
    LS(J.hip, J.kneeF, 10, 9, C.mid, C.light);
    Art.disc(g, J.kneeF[0], J.kneeF[1], 5, C.ink); Art.disc(g, J.kneeF[0], J.kneeF[1], 4, C.mid2); Art.px(g, J.kneeF[0] - 1, J.kneeF[1] - 2, C.hi);
    Art.line(g, G.lerp(J.hip[0], J.kneeF[0], 0.3) + 2, G.lerp(J.hip[1], J.kneeF[1], 0.3), G.lerp(J.hip[0], J.kneeF[0], 0.75) + 2, G.lerp(J.hip[1], J.kneeF[1], 0.75), P.eyeOn > 0.3 ? pc.core : pc.coreD, 1);
    LS(J.kneeF, J.ankF, 7, 6, C.mid2, C.light);
    Art.line(g, J.kneeF[0] + 2, J.kneeF[1] + 3, J.ankF[0] + 2, J.ankF[1] - 2, C.steel);
    foot(g, J.ankF, false);
    // torso
    const sp = J.sp;
    const body = [sp(3, -13), sp(3, 13), sp(16, 16), sp(30, 23), sp(41, 20), sp(43, 10), sp(43, -12), sp(41, -20), sp(30, -22), sp(16, -16)];
    Art.poly(g, body.map((q) => q), C.ink);
    Art.poly(g, [sp(4, -12), sp(4, 12), sp(16, 15), sp(30, 22), sp(40, 19), sp(42, 10), sp(42, -11), sp(40, -19), sp(30, -21), sp(16, -15)], C.mid);
    Art.poly(g, [sp(27, -18), sp(27, 20), sp(39, 18), sp(41, 10), sp(41, -10), sp(39, -17)], C.mid2);
    let a = sp(40, -16), c = sp(40, 17); Art.line(g, a[0], a[1], c[0], c[1], C.hi);
    a = sp(27, -18); c = sp(27, 20); Art.line(g, a[0], a[1], c[0], c[1], C.ink);
    for (const k of [8, 13]) { a = sp(k, -11); c = sp(k, 12); Art.line(g, a[0], a[1], c[0], c[1], C.dark); }
    for (let i = 0; i < 9; i++) { const q = sp(41, -8 + i * 2); Art.px(g, q[0], q[1] - 1, i % 2 ? C.ink : C.stripe); }
    // glowing circuit traces from the core
    const tc = P.eyeOn > 0.3 ? pc.core : pc.coreD;
    a = sp(22, -3); c = sp(22, -14); Art.line(g, a[0], a[1], c[0], c[1], tc); a = sp(31, -14); Art.line(g, c[0], c[1], a[0], a[1], tc);
    a = sp(14, 8); c = sp(5, 8); Art.line(g, a[0], a[1], c[0], c[1], tc); a = sp(5, 3); Art.line(g, c[0], c[1], a[0], a[1], tc);
    // side vents
    for (let i = 0; i < 3; i++) { const q = sp(12 + i * 4, -13); Art.rect(g, q[0] - 1, q[1], 4, 2, P.vent > 0.5 ? C.vent : C.ink); }
    // corporate emblem
    const e = sp(34, -9); Art.poly(g, [[e[0] - 3, e[1] + 2], [e[0] + 3, e[1] + 2], [e[0], e[1] - 3]], C.stripe); Art.px(g, e[0], e[1], C.ink);
    // head
    const h = J.head;
    Art.rect(g, h[0] - 9, h[1] - 6, 17, 11, C.ink);
    Art.rect(g, h[0] - 8, h[1] - 5, 15, 9, C.mid);
    Art.rect(g, h[0] - 8, h[1] - 5, 15, 1, C.light);
    Art.rect(g, h[0] - 2, h[1] - 2, 9, 3, C.ink);
    Art.rect(g, h[0] - 1, h[1] - 1, 7, 1, P.eyeOn > 0.3 ? pc.core : pc.coreD);
    Art.rect(g, h[0] - 7, h[1] - 9, 2, 4, C.dark); Art.rect(g, h[0] - 4, h[1] - 11, 2, 6, C.dark); Art.px(g, h[0] - 4, h[1] - 11, pc.core);
    // belly hatch (drone bay)
    const hh = J.hatch, ho = Math.round(P.hatch * 4);
    Art.rect(g, hh[0] - 7, hh[1] - 3, 14, 7, C.ink);
    if (ho > 0) { Art.rect(g, hh[0] - 6, hh[1] - 2, 12, 5, '#05030a'); Art.px(g, hh[0], hh[1], pc.core); }
    Art.rect(g, hh[0] - 6 - ho, hh[1] - 2, 6, 5, C.dark); Art.rect(g, hh[0] + ho, hh[1] - 2, 6, 5, C.dark);
    // AI core (chest eye) in its cage
    const ey = J.eye, on = P.eyeOn;
    Art.disc(g, ey[0], ey[1], 11, C.ink);
    Art.disc(g, ey[0], ey[1], 10, C.dark);
    G.px.ring(g, ey[0], ey[1], 9, C.light, 1);
    Art.disc(g, ey[0], ey[1], 7, '#05030a');
    if (on > 0.05) {
      G.px.ring(g, ey[0], ey[1], 6, on > 0.5 ? pc.core : pc.coreD, 1);
      Art.disc(g, ey[0], ey[1], 4, pc.coreD);
      const lx = Math.cos(P.look) * 2.5, ly = Math.sin(P.look) * 2.5;
      const r = 2 + Math.round(P.charge * 2);
      Art.disc(g, ey[0] + lx, ey[1] + ly, r, pc.core);
      Art.disc(g, ey[0] + lx, ey[1] + ly, Math.max(1, r - 2), pc.coreL);
    }
    for (let i = 0; i < 4; i++) { const an = (i / 4) * TAU + Math.PI / 4; Art.line(g, ey[0] + Math.cos(an) * 6, ey[1] + Math.sin(an) * 6, ey[0] + Math.cos(an) * 10, ey[1] + Math.sin(an) * 10, C.mid2, 2); }
    // front arm: pauldron, piston arm, fist
    LS(J.shF, J.elF, 8, 8, C.mid, C.light);
    Art.disc(g, J.elF[0], J.elF[1], 4, C.ink); Art.disc(g, J.elF[0], J.elF[1], 3, C.mid2);
    LS(J.elF, J.haF, 9, 11, C.mid2, C.light);
    Art.line(g, G.lerp(J.elF[0], J.haF[0], 0.2), G.lerp(J.elF[1], J.haF[1], 0.2), G.lerp(J.elF[0], J.haF[0], 0.7), G.lerp(J.elF[1], J.haF[1], 0.7), P.eyeOn > 0.3 ? pc.core : pc.coreD, 1);
    fist(g, J.haF, J.faF, false, P);
    Art.disc(g, J.shF[0], J.shF[1] - 1, 9, C.ink);
    Art.disc(g, J.shF[0], J.shF[1] - 1, 8, C.mid);
    Art.halfDisc(g, J.shF[0], J.shF[1] - 1, 7, C.mid2, 'top');
    Art.rect(g, J.shF[0] - 5, J.shF[1] - 9, 9, 1, C.hi);
    for (let i = 0; i < 4; i++) Art.px(g, J.shF[0] - 4 + i * 3, J.shF[1] + 3, C.stripe);
  }

  // ---------------------------------------------------------------- missile (rises, marks the floor, drops)
  class Missile {
    constructor(o) {
      Object.assign(this, o);
      this.t = 0; this.phase = 'up'; this.dead = false; this.team = 'enemy';
      this.vy = -260; this.w = 4; this.h = 8;
    }
    update(dt, world) {
      this.t += dt;
      if (this.phase === 'up') {
        this.vy -= 500 * dt; this.x += this.vx * dt; this.y += this.vy * dt; this.vx *= Math.pow(0.2, dt);
        this.trail(world, 1);
        if (this.y < world.cam.y - 30 || this.t > 0.8) { this.phase = 'mark'; this.t = 0; }
      } else if (this.phase === 'mark') {
        if (this.t >= this.delay) { this.phase = 'down'; this.t = 0; this.x = this.tx; this.y = Math.min(world.cam.y - 24, this.floorY - 200); snd('drone', { pitch: 2, vol: 0.25 }); }
      } else {
        this.y += 480 * dt;
        this.trail(world, -1);
        if (this.y >= this.floorY - 3) {
          this.dead = true;
          G.explode(world, this.tx, this.floorY - 6, { radius: 24, dmg: this.dmg, team: 'enemy', color: PAL.orange, info: { kb: 160, kbUp: 200, source: this.owner } });
          world.fx.burst(this.tx, this.floorY - 1, 10, { angle: -Math.PI / 2, spread: 1.2, speed: 160, life: 0.5, color: ['#3b3350', '#6f6b8a'], grav: 600, size: [1, 2] });
        }
      }
    }
    trail(world, dir) {
      if (G.rand.chance(0.8)) world.fx.particle({ x: this.x + G.rand.float(-1, 1), y: this.y + dir * 5, vx: G.rand.float(-15, 15), vy: dir * 40, life: 0.35, color: G.rand.chance(0.5) ? PAL.orange : PAL.yellow, additive: true, size: 1 });
      if (G.rand.chance(0.4)) world.fx.particle({ x: this.x, y: this.y + dir * 6, vx: G.rand.float(-10, 10), vy: -10, life: 0.8, color: '#3b3350', size: 2, shape: 'disc', drag: 2, grav: -20 });
    }
    draw(ctx, cam) {
      const ox = cam.ox, oy = cam.oy;
      if (this.phase !== 'up') {
        // floor marker: crosshair + closing ring = timing
        const k = this.phase === 'mark' ? this.t / this.delay : 1;
        const x = Math.round(this.tx - ox), y = Math.round(this.floorY - oy) - 1;
        const blink = Math.floor((this.t + this.delay) * 12) % 2 === 0;
        const col = k > 0.7 && blink ? '#ffffff' : PAL.red;
        ctx.fillStyle = col;
        ctx.fillRect(x - 8, y, 5, 1); ctx.fillRect(x + 4, y, 5, 1); ctx.fillRect(x, y - 5, 1, 3);
        ctx.fillRect(x - 1, y - 1, 3, 1);
        const r = Math.round(G.lerp(22, 5, Math.min(1, k)));
        ctx.globalAlpha = 0.8;
        for (let i = -r; i <= r; i += 2) ctx.fillRect(x + i, y + 1, 1, 1);
        ctx.fillRect(x - r, y - 2, 1, 3); ctx.fillRect(x + r, y - 2, 1, 3);
        ctx.globalAlpha = 1;
      }
      if (this.phase === 'mark') return;
      const x = Math.round(this.x - ox), y = Math.round(this.y - oy), up = this.phase === 'up';
      G.px.rect(ctx, x - 2, y - 5, 5, 11, C.ink);
      G.px.rect(ctx, x - 1, y - 4, 3, 9, '#6f6b9a');
      G.px.rect(ctx, x - 1, up ? y - 4 : y + 3, 3, 2, PAL.red);
      ctx.fillStyle = PAL.yellow; ctx.fillRect(x, up ? y + 5 : y - 7, 1, 2);
    }
    drawLight(ctx, cam) {
      if (this.phase !== 'mark') G.drawGlow(ctx, this.x - cam.ox, this.y - cam.oy, 16, PAL.orange, 0.8);
      if (this.phase !== 'up') {
        const k = this.phase === 'mark' ? this.t / this.delay : 1;
        G.drawGlow(ctx, this.tx - cam.ox, this.floorY - 2 - cam.oy, 18 + 10 * k, PAL.red, 0.4 + 0.4 * k);
      }
    }
  }
  G.BossMissile = Missile;

  // ---------------------------------------------------------------- the boss
  const BASE_POSE = { bob: 0, lean: 0.06, thF: 0.55, shF: -0.55, thB: 0.4, shB: -0.72, fFx: 10, fFy: 34, fBx: 3, fBy: 35, look: 0.3, charge: 0, eyeOn: 1, pods: 0, hatch: 0, thrust: 0, vent: 0 };

  class Overseer extends G.Enemy {
    constructor(x, y, o) {
      super(x, y, o);
      this.setup({ w: 46, h: 80, hp: BOSS_HP, dmg: 24, speed: 36, sight: 999, cells: [0, 0], gold: [0, 0], kbRes: 1, stunRes: 1, poise: 0 });
      this.maxHp = this.hp = BOSS_HP; this.dmg = 24;
      this.bossName = 'Смотритель'; this.isBoss = true; this.showHp = false;
      this.loseSight = 1e9; this.superArmor = true; this.untargetable = true;
      this.state = 'dormant'; this.phase = 0; this.nextT = 1; this.turnT = 0;
      this.P = Object.assign({}, BASE_POSE, { bob: 12, lean: 0.4, fFx: 14, fFy: 46, fBx: 8, fBy: 46, eyeOn: 0 });
      this.T = Object.assign({}, this.P);
      this.rim = PHASE[0].rim; this.bloodColors = ['#7fe9ff', '#363d6c', '#ff8a2a'];
      this.deathDur = 4.4; this.dissolveRate = 0.14; this.boomT = 0;
      this.drones = []; this.summonCd = 0; this.last = null; this.walkRate = 0.07;
      this.ang = 0; this.a0 = 0; this.a1 = 0; this.snap = 0;
      this.raw = Art.canvas(CW, CH); this.rg = this.raw.getContext('2d');
      this.out = Art.canvas(CW, CH); this.og = this.out.getContext('2d');
      this.tB = Art.canvas(CW, CH); this.tD = Art.canvas(CW, CH);
    }
    separate() {}
    get pc() { return PHASE[this.phase]; }
    // local (facing-right) angle → world
    wa(a) { return this.facing > 0 ? a : Math.PI - a; }
    toWorld(p) { return [this.cx + (p[0] - OX) * this.facing, this.bottom + (p[1] - OY)]; }
    joints() { return arms(skel(this.P), this.P); }
    eyeWorld() { return this.toWorld(skel(this.P).eye); }
    arena() {
      const L = G.world.level;
      return L.arena || { x0: 2 * G.TILE, x1: L.pw - 2 * G.TILE, floorY: this.bottom, ceilY: 2 * G.TILE };
    }

    // ------------------------------------------------------------ damage & phases
    filterHit(amount, info) {
      if (this.state === 'roar' || this.state === 'intro') return null;
      return { amount, info: Object.assign({}, info, { kb: 0, kbUp: 0, stun: 0 }) };
    }
    onHurt(dmg, info) {
      this.hpBarT = 3;
      if (G.audio && this.hp > 0) G.audio.play('hitArmor', { vol: 0.35 });
      const th = [0.66, 0.33];
      if (this.phase < 2 && this.hp > 0 && this.hp <= this.maxHp * th[this.phase]) {
        this.phase++;
        this.endAttack();
        this.setState('roar'); this.roared = false; this.untargetable = true; this.teleT = 0;
        this.rim = this.pc.rim;
      }
    }
    endAttack() {
      Object.assign(this.T, { pods: 0, hatch: 0, thrust: 0, charge: 0 });
      this.teleT = 0; this.vx = 0;
    }
    toIdle(delay) {
      this.endAttack();
      this.setState('idle');
      this.nextT = delay != null ? delay : [0.95, 0.75, 0.5][this.phase];
    }
    roar(world, big) {
      snd('bossRoar'); if (big) snd('bossPhase');
      world.shake(big ? 7 : 5, big ? 1.3 : 0.9);
      world.glitch = 1;
      const [ex, ey] = this.eyeWorld();
      world.fx.ring(ex, ey, 6, 120, this.pc.core, 0.7, 3);
      world.fx.ring(ex, ey, 4, 70, '#ffffff', 0.4, 1);
      world.fx.burst(ex, ey, 30, { speed: 260, life: 0.6, color: [this.pc.core, '#ffffff'], shape: 'spark', grav: 0, additive: true });
      world.flashLights.push({ x: ex, y: ey, r: 220, color: this.pc.core, t: 0, life: 0.6 });
      const p = this.player;
      if (big && p && Math.abs(p.cx - this.cx) < 150 && Math.abs(p.cy - this.cy) < 120) { p.vx = G.sign(p.cx - this.cx || 1) * 320; p.vy = Math.min(p.vy, -200); }
    }

    // ------------------------------------------------------------ AI
    ai(dt, world) {
      const p = this.player;
      const dx = this.dxToPlayer(), adx = Math.abs(dx);
      const T = this.T;
      Object.assign(T, BASE_POSE, { pods: T.pods, hatch: T.hatch, thrust: T.thrust, charge: T.charge });
      T.eyeOn = 1; T.vent = this.phase >= 2 ? 1 : 0;
      T.look = p ? Math.atan2(p.cy - this.eyeWorld()[1], Math.abs(dx)) : 0.3;
      if (this.summonCd > 0) this.summonCd -= dt;
      const A = this.arena();
      switch (this.state) {
        case 'dormant':
          Object.assign(T, { bob: 12, lean: 0.4, fFx: 14, fFy: 46, fBx: 8, fBy: 46, eyeOn: G.rand.chance(0.02) ? 0.4 : 0 });
          this.vx = 0; this.untargetable = true;
          if (p && adx < 330 && Math.abs(p.bottom - this.bottom) < 220) {
            this.facePlayer(); this.setState('intro');
            G.emit('bossStart', { boss: this });
            snd('glitch');
          }
          break;
        case 'intro': {
          const k = this.stateT;
          const flick = k < 0.9 ? (G.rand.chance(0.4) ? 1 : 0) : 1;
          Object.assign(T, k < 0.9 ? { bob: 12, lean: 0.4, fFx: 14, fFy: 46, fBx: 8, fBy: 46, eyeOn: flick } : { bob: 2, lean: -0.3, fFx: 26, fFy: -18, fBx: -24, fBy: -18, eyeOn: 1, look: -0.6 });
          if (k > 0.9 && !this.roared) { this.roared = true; this.roar(world, false); }
          if (k >= 2.3) { this.untargetable = false; this.toIdle(0.6); }
          break;
        }
        case 'roar': {
          Object.assign(T, { bob: 2, lean: -0.32, fFx: 26, fFy: -20, fBx: -26, fBy: -20, look: -0.7, charge: 1 });
          this.vx = G.approach(this.vx, 0, 600 * dt);
          if (this.stateT > 0.35 && !this.roared) { this.roared = true; this.roar(world, true); }
          if (this.stateT >= 1.9) { this.untargetable = false; this.toIdle(0.4); }
          break;
        }
        case 'idle': {
          // slow to turn: attacking from behind is the reward for rolling through
          if (G.sign(dx) !== this.facing && adx > 12) { this.turnT += dt; if (this.turnT > 0.4) { this.facing = G.sign(dx); this.turnT = 0; } }
          else this.turnT = 0;
          const sp = [34, 42, 52][this.phase];
          const want = G.sign(dx) === this.facing && adx > 95 ? this.facing : 0;
          this.vx = G.approach(this.vx, want * sp, 200 * dt);
          if (Math.abs(this.vx) > 4) {
            const ph = this.walkPh, s = Math.sin(ph), c = Math.cos(ph);
            Object.assign(T, { thF: 0.45 + 0.4 * s, shF: -0.55 - 0.45 * Math.max(0, c), thB: 0.45 - 0.4 * s, shB: -0.6 - 0.45 * Math.max(0, -c), bob: Math.round(Math.abs(c) * 2), fFx: 10 - 7 * s, fBx: 3 + 7 * s });
          } else { T.bob = Math.round(Math.sin(this.t * 2) + 1) * 0.5; }
          this.nextT -= dt;
          if (this.nextT <= 0 && p && !p.dead) this.pickAttack(world, adx);
          break;
        }
        // ---- fist slam → shockwaves
        case 'slamW': case 'slamW2':
          this.vx = G.approach(this.vx, 0, 500 * dt);
          Object.assign(T, { bob: 4, lean: -0.14, fFx: -4, fFy: -36, fBx: -12, fBy: 22, thF: 0.75, shF: -0.8 });
          if (this.stateT >= this.windDur) { this.setState('slam'); this.slam(world); }
          break;
        case 'slam': {
          const J = skel(Object.assign({}, T, { bob: 10, lean: 0.5 }));
          const tgt = [OX + 52, OY - 9];
          Object.assign(T, { bob: 10, lean: 0.5, fFx: tgt[0] - J.shF[0], fFy: tgt[1] - J.shF[1], fBx: -16, fBy: 26, thF: 0.9, shF: -0.5, thB: 0.1, shB: -0.9 });
          if (this.stateT >= 0.3 && this.phase >= 1 && !this.didSecond) { this.didSecond = true; this.setState('slamW2'); this.windDur = 0.5; this.telegraph(0.5); break; }
          if (this.stateT >= 0.95) this.toIdle();
          break;
        }
        // ---- close swipe
        case 'swW':
          this.vx = G.approach(this.vx, 0, 500 * dt);
          Object.assign(T, { bob: 3, lean: -0.12, fFx: -30, fFy: 22, thF: 0.7, shF: -0.7 });
          if (this.stateT >= 0.55) { this.setState('sw'); this.swingHit = false; this.snap = 0.1; this.vx = this.facing * 90; snd('heavy', { pitch: 0.8 }); snd('slash3', { pitch: 0.5 }); }
          break;
        case 'sw':
          Object.assign(T, { bob: 5, lean: 0.4, fFx: 44, fFy: 34, fBx: -20, fBy: 20, thF: 0.9, shF: -0.4 });
          if (this.stateT < 0.16) this.hitOnce(this.meleeBox(56, 46, this.h - 46), 18, { kb: 280, kbUp: 170 });
          if (this.stateT < 0.1) { const [fx, fy] = this.toWorld(this.joints().haF); world.fx.slash(fx - this.facing * 20, fy - 10, 30, this.wa(-1.4), this.wa(0.9), this.pc.core, 0.15, 6); }
          this.vx = G.approach(this.vx, 0, 500 * dt);
          if (this.stateT >= 0.7) this.toIdle();
          break;
        // ---- chest laser floor sweep
        case 'laserW': {
          this.vx = G.approach(this.vx, 0, 500 * dt);
          const k = this.stateT / this.windDur;
          Object.assign(T, { bob: 5, lean: -0.05, fFx: 18, fFy: 28, fBx: -14, fBy: 30, thF: 0.75, shF: -0.8, charge: k, look: this.a0 });
          if (G.rand.chance(dt * 40)) { const [ex, ey] = this.eyeWorld(), an = G.rand.float(0, TAU); world.fx.particle({ x: ex + Math.cos(an) * 22, y: ey + Math.sin(an) * 22, vx: -Math.cos(an) * 70, vy: -Math.sin(an) * 70, life: 0.3, color: this.pc.core, additive: true }); }
          if (this.stateT >= this.windDur) { this.setState('laser'); this.sweepI = 0; this.swingHit = false; snd('enemyLaser'); snd('laser', { vol: 0.8 }); }
          break;
        }
        case 'laser': {
          const dur = [1.1, 0.95, 0.8][this.phase];
          const k = Math.min(1, this.stateT / dur);
          this.ang = this.sweepI % 2 === 0 ? G.lerp(this.a0, this.a1, G.easeInOut(k)) : G.lerp(this.a1, this.a0, G.easeInOut(k));
          Object.assign(T, { bob: 5, lean: -0.05 - k * 0.05, fFx: 18, fFy: 28, fBx: -14, fBy: 30, thF: 0.75, shF: -0.8, charge: 1, look: this.ang });
          const [ex, ey] = this.eyeWorld(), w = this.wa(this.ang);
          const h = world.level.raycast(ex, ey, ex + Math.cos(w) * 800, ey + Math.sin(w) * 800);
          this.beam = [ex, ey, h.x, h.y];
          if (!this.swingHit && this.beamHit(ex, ey, h.x, h.y, 3, 22, { kb: 180, kbUp: 150, dir: this.facing })) this.swingHit = true;
          if (G.rand.chance(dt * 50)) { world.fx.sparks(h.x, h.y - 1, -this.facing, 3, this.pc.core); world.fx.particle({ x: h.x, y: h.y - 2, vx: G.rand.float(-20, 20), vy: -40, life: 0.6, color: '#3b3350', size: 2, shape: 'disc', grav: -30, drag: 2 }); }
          world.shake(1.5, 0.05);
          if (k >= 1) {
            this.sweepI++;
            if (this.sweepI >= (this.phase >= 2 ? 2 : 1)) { this.beam = null; this.setState('laserEnd'); }
            else { this.stateT = 0; this.swingHit = false; snd('enemyLaser', { pitch: 1.2 }); }
          }
          break;
        }
        case 'laserEnd':
          Object.assign(T, { bob: 3, lean: 0.1, charge: 0 });
          if (G.rand.chance(dt * 20)) { const [ex, ey] = this.eyeWorld(); world.fx.particle({ x: ex, y: ey, vx: G.rand.float(-20, 20), vy: -50, life: 0.8, color: '#4a4666', size: 2, shape: 'disc', grav: -30, drag: 2 }); }
          if (this.stateT >= 0.7) this.toIdle();
          break;
        // ---- missile barrage
        case 'missW':
          this.vx = G.approach(this.vx, 0, 500 * dt);
          Object.assign(T, { bob: 4, lean: -0.18, pods: 1, fBx: -20, fBy: 10, thF: 0.7, shF: -0.75 });
          if (this.stateT >= 0.7) { this.setState('miss'); this.misI = 0; this.misT = 0; }
          break;
        case 'miss': {
          Object.assign(T, { bob: 4, lean: -0.22, pods: 1, fBx: -20, fBy: 10, thF: 0.7, shF: -0.75 });
          this.misT -= dt;
          if (this.misT <= 0 && this.misI < this.targets.length) {
            const tg = this.targets[this.misI];
            const [mx, my] = this.toWorld(skel(this.P).pod);
            world.addProjectile(new Missile({ x: mx + G.rand.float(-6, 6), y: my - 6, vx: -this.facing * G.rand.float(10, 60), tx: tg[0], floorY: tg[1], delay: 0.55 + this.misI * 0.09, dmg: 16, owner: this }));
            world.fx.burst(mx, my - 6, 6, { angle: -Math.PI / 2, spread: 0.6, speed: 120, life: 0.25, color: [PAL.orange, PAL.yellow, '#ffffff'], additive: true, grav: 0 });
            world.flashLights.push({ x: mx, y: my, r: 30, color: PAL.orange, t: 0, life: 0.08 });
            snd('enemyShoot', { pitch: 0.7, vol: 0.6 });
            this.misI++; this.misT = 0.1;
          }
          if (this.misI >= this.targets.length && this.stateT > this.targets.length * 0.1 + 0.6) this.toIdle();
          break;
        }
        // ---- drone bay
        case 'sumW':
          this.vx = G.approach(this.vx, 0, 500 * dt);
          Object.assign(T, { bob: 2, lean: -0.2, hatch: 1, fFx: 22, fFy: 14, fBx: -22, fBy: 14 });
          if (this.stateT >= 0.65) {
            const [hx, hy] = this.toWorld(skel(this.P).hatch);
            for (let i = this.drones.length; i < 2; i++) {
              const d = G.spawnEnemy(world, 'minedrone', hx + this.facing * 6, hy + 10, { depth: 1 });
              if (!d) continue;
              d.aggro = true; d.setState('chase'); d.cells = [0, 0]; d.gold = [0, 0]; d.summoned = true;
              d.vx = this.facing * (60 + i * 70); d.vy = -160 - i * 40; d.home = hx; d.homeY = hy - 50; d.cooldown = 1.2 + i * 0.6;
              this.drones.push(d);
            }
            world.fx.burst(hx, hy, 12, { speed: 100, life: 0.4, color: [this.pc.core, '#ffffff'], additive: true, grav: 0 });
            snd('drone', { vol: 0.7 });
            this.summonCd = 9; this.setState('sum');
          }
          break;
        case 'sum':
          Object.assign(T, { bob: 2, lean: -0.1, hatch: 1 });
          if (this.stateT >= 0.7) this.toIdle();
          break;
        // ---- thruster charge across the arena
        case 'chgW': {
          this.vx = G.approach(this.vx, 0, 500 * dt);
          const k = this.stateT / 1.0;
          Object.assign(T, { bob: 9, lean: 0.45, fFx: 22, fFy: 26, fBx: -26, fBy: 18, thF: 1.0, shF: -0.5, thB: 0.1, shB: -1.0, thrust: 0.3 + k * 0.7 });
          if (G.rand.chance(dt * 30)) { const [tx, ty] = this.toWorld(skel(this.P).thr); world.fx.sparks(tx, ty + 6, -this.facing, 2, PAL.orange); }
          if (this.stateT >= 1.0) { this.setState('chg'); this.swingHit = false; snd('dash', { pitch: 0.5 }); snd('explosion', { vol: 0.3, pitch: 1.6 }); }
          break;
        }
        case 'chg': {
          this.vx = this.facing * 400;
          const ph = this.t * 22, s = Math.sin(ph);
          Object.assign(T, { bob: 6, lean: 0.55, thF: 0.8 + 0.4 * s, shF: -0.4, thB: 0.2 - 0.4 * s, shB: -0.9, fFx: 24, fFy: 22, fBx: -28, fBy: 12, thrust: 1 });
          this.hitOnce(this.frontBox(10, 8, this.h - 8), 28, { kb: 320, kbUp: 230 });
          if (G.rand.chance(dt * 60)) world.fx.particle({ x: this.cx - this.facing * 20, y: this.bottom - 2, vx: -this.facing * G.rand.float(40, 120), vy: -G.rand.float(10, 60), life: 0.4, color: '#4a4666', size: 2, shape: 'disc', grav: 200 });
          const edge = this.facing > 0 ? A.x1 - this.x - this.w : this.x - A.x0;
          if (this.hitWall || edge < 8 || this.stateT > 2.2) {
            this.setState('chgHit'); this.vx = -this.facing * 60;
            const wx = this.cx + this.facing * this.w / 2, wy = this.cy;
            world.fx.sparks(wx, wy, -this.facing, 20, PAL.yellow);
            world.fx.burst(wx, wy - 20, 18, { speed: 200, life: 0.8, color: ['#3b3350', '#6f6b8a', PAL.orange], size: [1, 3], grav: 700 });
            world.shake(9, 0.5); world.hitstop(0.06);
            world.flashLights.push({ x: wx, y: wy, r: 120, color: PAL.orange, t: 0, life: 0.25 });
            snd('explosion', { vol: 0.8, pitch: 0.7 }); snd('heavy');
          }
          break;
        }
        case 'chgHit':
          this.vx = G.approach(this.vx, 0, 300 * dt);
          Object.assign(T, { bob: 7, lean: -0.2, fFx: 8, fFy: 38, fBx: 0, fBy: 38, thrust: 0, eyeOn: G.rand.chance(0.3) ? 0.3 : 1 });
          if (this.stateT >= 1.15) { this.facePlayer(); this.toIdle(0.3); }
          break;
      }
    }
    pickAttack(world, adx) {
      const opts = [];
      const add = (k, w) => opts.push([k, this.last === k ? w * 0.25 : w]);
      if (adx < 70) add('swipe', 3.2);
      add('slam', adx < 200 ? 3 : 1.2);
      add('laser', adx > 55 ? 2.8 : 1);
      if (this.phase >= 1) {
        add('missiles', 2.4);
        this.drones = this.drones.filter((d) => !d.dead && !d.dying);
        if (this.drones.length < 2 && this.summonCd <= 0) add('summon', 2);
      }
      if (this.phase >= 2 && adx > 80) {
        const A = this.arena(), room = this.facing > 0 ? A.x1 - this.x - this.w : this.x - A.x0;
        const toward = G.sign(this.dxToPlayer()) === this.facing;
        if (toward && room > 140) add('charge', 3);
      }
      const k = G.world.rng.weighted(opts);
      this.last = k;
      this.facePlayer(); this.turnT = 0;
      switch (k) {
        case 'swipe': this.setState('swW'); this.telegraph(0.55); snd('heavy', { vol: 0.4, pitch: 0.6 }); break;
        case 'slam': this.windDur = [0.9, 0.8, 0.7][this.phase]; this.didSecond = false; this.setState('slamW'); this.telegraph(this.windDur); break;
        case 'laser': {
          this.windDur = [1.05, 0.95, 0.85][this.phase];
          const A = this.arena();
          const [ex, ey] = this.eyeWorld();
          this.a0 = Math.atan2(A.floorY - ey, 14);   // floor right at its feet
          this.a1 = -0.06;                          // out to the far wall
          this.setState('laserW'); this.telegraph(this.windDur); snd('charge', { pitch: 0.5 });
          break;
        }
        case 'missiles': {
          const p = this.player, A = this.arena(), L = world.level;
          const n = this.phase >= 2 ? 8 : 5;
          const xs = [];
          const lead = p.cx + p.vx * 0.5;
          for (let i = 0; i < n; i++) {
            let x = i < 3 ? lead + (i - 1) * 34 : G.rand.float(A.x0 + 20, A.x1 - 20);
            x = G.clamp(x + G.rand.float(-6, 6), A.x0 + 10, A.x1 - 10);
            const fy = L.groundBelow(x, A.ceilY + 18, 600);
            if (fy != null) xs.push([x, fy]);
          }
          this.targets = xs;
          this.setState('missW'); this.telegraph(0.7); snd('dash', { pitch: 0.4, vol: 0.5 });
          break;
        }
        case 'summon': this.setState('sumW'); this.telegraph(0.65); break;
        case 'charge': this.setState('chgW'); this.telegraph(1.0); snd('charge', { pitch: 0.4 }); break;
      }
    }
    slam(world) {
      const gx = this.cx + this.facing * 50, gy = this.bottom;
      this.snap = 0.08; this.swingHit = false;
      this.hitOnce({ x: gx - 26, y: gy - 36, w: 52, h: 36 }, 24, { kb: 230, kbUp: 220 });
      const sp = [190, 215, 240][this.phase];
      for (const d of [-1, 1]) world.addProjectile(new G.GroundWave({ x: gx + d * 10, y: gy, dir: d, speed: sp, life: 3, dmg: 16, h: 14, color: this.pc.core, owner: this }));
      world.fx.ring(gx, gy, 4, 50, this.pc.core, 0.35, 2);
      world.fx.burst(gx, gy - 2, 26, { angle: -Math.PI / 2, spread: 1.3, speed: 240, life: 0.6, color: ['#3b3350', '#6f6b8a', this.pc.core, '#ffffff'], grav: 700, size: [1, 2] });
      world.shake(7, 0.35); world.hitstop(0.05);
      world.flashLights.push({ x: gx, y: gy, r: 110, color: this.pc.core, t: 0, life: 0.25 });
      snd('heavy'); snd('explosion', { vol: 0.5, pitch: 1.3 });
    }

    // ------------------------------------------------------------ update: pose smoothing
    update(dt, world) {
      super.update(dt, world);
      if (this.dead) return;
      const rate = this.snap > 0 ? 45 : this.state === 'sw' || this.state === 'slam' ? 26 : 11;
      if (this.snap > 0) this.snap -= dt;
      const k = 1 - Math.exp(-rate * dt);
      for (const key in this.T) this.P[key] = G.lerp(this.P[key], this.T[key], key === 'look' ? Math.min(1, k * 1.5) : k);
    }

    // ------------------------------------------------------------ death
    die(info) {
      if (this.dying) return;
      this.dying = true; this.deathT = 0; this.state = 'death'; this.untargetable = true; this.teleT = 0; this.beam = null;
      this.vx = 0; this.deathDir = -this.facing;
      const w = G.world;
      w.hitstop(0.35); w.fx.flash('#ffffff', 0.3); w.shake(8, 0.8); w.glitch = 1;
      snd('bossDie');
      for (const d of this.drones) if (!d.dead && !d.dying) d.die({});
      for (const pr of w.projectiles) if (pr.team === 'enemy') pr.dead = true;
      G.emit('enemyKilled', { enemy: this, info });
    }
    boom(world, x, y, r) {
      world.fx.ring(x, y, 2, r, G.rand.chance(0.5) ? PAL.orange : this.pc.core, 0.3, 2);
      world.fx.burst(x, y, 14, { speed: r * 6, speedMin: r, life: 0.45, color: [PAL.orange, PAL.yellow, '#ffffff', this.pc.core], shape: 'spark', grav: 200, additive: true });
      world.fx.burst(x, y, 5, { speed: 60, life: 0.9, color: ['#2a2438', '#3b3350'], size: [2, 4], grav: -40, drag: 2, shape: 'disc', shrink: true });
      world.flashLights.push({ x, y, r: r * 3, color: PAL.orange, t: 0, life: 0.2 });
      world.shake(3, 0.2);
      snd('explosion', { vol: 0.45, pitch: G.rand.float(0.8, 1.3) });
    }
    dissolveK() { return G.clamp((this.deathT - 2.7) / 1.4, 0, 1); }
    updateDeath(dt, world) {
      this.deathT += dt;
      this.physics(dt, world.level);
      const T = this.T, k = Math.min(1, this.deathT / 2.7);
      Object.assign(T, { bob: 4 + k * 14, lean: 0.1 + k * 0.5, fFx: 16, fFy: 40, fBx: 4, fBy: 42, charge: 0, eyeOn: G.rand.chance(0.5) ? 1 : 0, pods: 0, hatch: 0, thrust: 0, thF: 0.9, shF: -0.3, thB: 0.6, shB: -0.9 });
      const kk = 1 - Math.exp(-6 * dt);
      for (const key in T) this.P[key] = G.lerp(this.P[key], T[key], kk);
      if (this.deathT < 2.7) {
        this.boomT -= dt;
        if (this.boomT <= 0) {
          this.boomT = G.rand.float(0.07, 0.2);
          this.boom(world, this.x + G.rand.float(0, this.w), this.y + G.rand.float(8, this.h - 8), G.rand.float(10, 22));
        }
        if (G.rand.chance(dt * 20)) world.fx.sparks(this.cx + G.rand.float(-20, 20), this.cy + G.rand.float(-30, 30), G.rand.sign(), 4, this.pc.core);
      } else if (!this.finalBoom) {
        this.finalBoom = true;
        const [ex, ey] = this.eyeWorld();
        this.boom(world, ex, ey, 40);
        world.fx.ring(ex, ey, 10, 260, '#ffffff', 0.9, 3);
        world.fx.ring(ex, ey, 6, 180, this.pc.core, 0.7, 2);
        world.fx.burst(ex, ey, 60, { speed: 360, life: 1.0, color: [this.pc.core, '#ffffff', PAL.yellow], shape: 'spark', grav: 100, additive: true });
        world.fx.flash('#ffffff', 0.35); world.shake(12, 0.9); world.hitstop(0.18); world.glitch = 1;
        world.flashLights.push({ x: ex, y: ey, r: 360, color: this.pc.core, t: 0, life: 0.9 });
        snd('explosion', { vol: 1, pitch: 0.6 }); snd('eliteDie');
        world.dropCurrency(this.cx, this.cy - 20, 40, 60);
        // snapshot the final frame for the pixel dissolve
        this.render();
        const c = this.facing > 0 ? this.out : Art.flip(this.out);
        const ax = this.facing > 0 ? OX : CW - OX;
        this._lastSpr = { c: Art.canvas(CW, CH), dx: -ax, dy: -OY };
        this._lastSpr.c.getContext('2d').drawImage(c, 0, 0);
        this.prepareDissolve();
      }
      this.dissolveStep(world);
      if (this.deathT >= this.deathDur && !this.defeated) {
        this.defeated = true; this.dead = true;
        if (world.boss === this) world.boss = null;
        G.emit('bossDefeated', { boss: this });
      }
    }

    // ------------------------------------------------------------ drawing
    render() {
      const J = this.joints(), pc = this.pc;
      const g = this.rg;
      g.clearRect(0, 0, CW, CH);
      drawBoss(g, J, this.P, pc, this);
      for (const [cv, col] of [[this.tB, pc.rim], [this.tD, pc.dim]]) {
        const tg = cv.getContext('2d');
        tg.globalCompositeOperation = 'copy'; tg.drawImage(this.raw, 0, 0);
        tg.globalCompositeOperation = 'source-in'; tg.fillStyle = col; tg.fillRect(0, 0, CW, CH);
        tg.globalCompositeOperation = 'source-over';
      }
      const o = this.og;
      o.clearRect(0, 0, CW, CH);
      o.drawImage(this.tD, -1, 0); o.drawImage(this.tD, 0, 1);
      o.drawImage(this.tB, 1, 0); o.drawImage(this.tB, 0, -1);
      o.drawImage(this.raw, 0, 0);
      if (this.flash > 0.05 || (this.state === 'death' && G.rand.chance(0.25))) {
        o.globalCompositeOperation = 'source-atop'; o.globalAlpha = this.state === 'death' ? 0.6 : 0.32; o.fillStyle = '#ffffff'; o.fillRect(0, 0, CW, CH);
        o.globalCompositeOperation = 'source-over'; o.globalAlpha = 1;
      }
      return J;
    }
    draw(ctx, cam0) {
      const cam = { ox: cam0.ox, oy: cam0.oy, x: cam0.x, y: cam0.y, w: cam0.w, h: cam0.h };
      if (this.dying && this.dis) { this.drawDissolve(ctx, cam); return; }
      this.render();
      const flip = this.facing < 0;
      let sx = Math.round(this.cx - cam.ox) - (flip ? CW - OX : OX), sy = Math.round(this.bottom - cam.oy) - OY;
      if (this.dying || this.state === 'chgHit' && this.stateT < 0.3) { sx += G.rand.int(-2, 2); sy += G.rand.int(-1, 1); }
      if (flip) { ctx.save(); ctx.translate(sx + CW, sy); ctx.scale(-1, 1); ctx.drawImage(this.out, 0, 0); ctx.restore(); }
      else ctx.drawImage(this.out, sx, sy);
      if ((this.state === 'intro' && this.stateT < 0.9) || this.state === 'roar' && this.stateT < 0.6) {
        ctx.globalAlpha = 0.5;
        if (flip) { ctx.save(); ctx.translate(sx + CW + G.rand.int(-4, 4), sy); ctx.scale(-1, 1); Art.glitchDraw(ctx, this.out, 0, 0, 0.6, 0.6); ctx.restore(); }
        else Art.glitchDraw(ctx, this.out, sx + G.rand.int(-4, 4), sy, 0.6, 0.6);
        ctx.globalAlpha = 1;
      }
      this.drawStatus(ctx, cam);
    }
    drawLight(ctx, cam) {
      const ox = cam.ox, oy = cam.oy, pc = this.pc;
      if (this.dying && this.dis) { const k = 1 - this.dissolveK(); G.drawGlow(ctx, this.cx - ox, this.cy - oy, 90, pc.core, 0.4 * k); return; }
      const [ex, ey] = this.eyeWorld();
      const on = this.P.eyeOn;
      G.drawGlow(ctx, this.cx - ox, this.cy - oy, 110, pc.rim, 0.05 * on + 0.03);
      G.drawGlow(ctx, ex - ox, ey - oy, 20 + this.P.charge * 16, pc.core, (0.3 + this.P.charge * 0.3) * on);
      const hd = this.toWorld(skel(this.P).head);
      G.drawGlow(ctx, hd[0] + this.facing * 2 - ox, hd[1] - oy, 12, pc.core, 0.5 * on);
      // thruster flames
      if (this.P.thrust > 0.05) {
        const [tx, ty] = this.toWorld(skel(this.P).thr);
        const len = Math.round(6 + this.P.thrust * 18 + G.rand.int(0, 5));
        const x = Math.round(tx - ox - this.facing * 4), y = Math.round(ty - oy);
        for (let i = 0; i < len; i++) {
          ctx.fillStyle = i < len * 0.3 ? '#ffffff' : i < len * 0.6 ? PAL.yellow : PAL.orange;
          const wdt = Math.max(1, Math.round(4 * (1 - i / len)));
          ctx.fillRect(x - this.facing * i - (this.facing < 0 ? 0 : 0), y - (wdt >> 1), 1, wdt);
        }
        G.drawGlow(ctx, tx - this.facing * 12 - ox, ty - oy, 30 + this.P.thrust * 20, PAL.orange, 0.7 * this.P.thrust);
      }
      // laser guide & beam
      if (this.state === 'laserW') {
        const w = this.wa(this.a0);
        const h = G.world.level.raycast(ex, ey, ex + Math.cos(w) * 800, ey + Math.sin(w) * 800);
        Art.sight(ctx, ex - ox, ey - oy, h.x - ox, h.y - oy, pc.core, 0.4 + 0.5 * (this.stateT / this.windDur), 2, this.t);
        // show the sweep arc on the floor
        const w1 = this.wa(this.a1);
        const h1 = G.world.level.raycast(ex, ey, ex + Math.cos(w1) * 800, ey + Math.sin(w1) * 800);
        Art.sight(ctx, ex - ox, ey - oy, h1.x - ox, h1.y - oy, pc.core, 0.18, 4, -this.t);
      }
      if (this.state === 'laser' && this.beam) {
        const b = this.beam;
        Art.beam(ctx, b[0] - ox, b[1] - oy, b[2] - ox, b[3] - oy, pc.core, '#ffffff', 5, 0.9);
        G.drawGlow(ctx, b[2] - ox, b[3] - oy, 34, pc.core, 0.8);
        G.drawGlow(ctx, b[0] - ox, b[1] - oy, 26, pc.core, 0.5);
      }
      if (this.state === 'missW' || this.state === 'miss') {
        const [px, py] = this.toWorld(skel(this.P).pod);
        G.drawGlow(ctx, px - ox, py - oy, 24, PAL.red, 0.5);
      }
      if (this.teleT > 0) G.drawGlow(ctx, this.cx - ox, this.y - 12 - oy, 16, PAL.yellow, 0.5);
    }
  }
  G.defineEnemy('overseer', Overseer, { displayName: 'Смотритель', boss: true, noSpawn: true });
  G.Overseer = Overseer;

  // Creates the boss at a feet position, registers it as world.boss. 'bossStart' fires when the player approaches.
  G.spawnBoss = function (world, x, y) {
    const b = G.spawnEnemy(world, 'overseer', x, y, { depth: world.depth });
    if (!b) return null;
    world.boss = b;
    if (world.player) b.facing = world.player.cx < b.cx ? -1 : 1;
    return b;
  };
})();
