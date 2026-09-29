'use strict';
// Particles, floating damage numbers, shockwave rings, flashes and wall decals (coolant splats).
(function () {
  const G = window.G;
  const MAX_PARTS = 1400;

  class FX {
    constructor(level) {
      this.parts = [];
      this.texts = [];
      this.rings = [];
      this.slashes = [];
      this.flashT = 0; this.flashColor = '#ffffff';
      this.level = level;
      this.decals = null;
      if (level) {
        // decal layer covering the level (coolant/oil splats on back walls), 1/2 resolution to save memory
        this.decalScale = 2;
        this.decals = document.createElement('canvas');
        this.decals.width = Math.ceil(level.pw / this.decalScale);
        this.decals.height = Math.ceil(level.ph / this.decalScale);
        this.dctx = this.decals.getContext('2d');
      }
    }

    // p: {x,y,vx,vy,life,color,size,grav,drag,glow,shape:'px'|'line'|'disc'|'spark',bounce,decal,additive,shrink}
    particle(p) {
      if (this.parts.length >= MAX_PARTS) this.parts.shift();
      p.t = 0; p.life = p.life || 0.5; p.size = p.size || 1;
      p.vx = p.vx || 0; p.vy = p.vy || 0; p.grav = p.grav || 0; p.drag = p.drag == null ? 0 : p.drag;
      p.life0 = p.life;
      this.parts.push(p);
      return p;
    }
    // radial burst
    burst(x, y, n, o = {}) {
      const R = G.rand;
      for (let i = 0; i < n; i++) {
        const a = o.angle != null ? o.angle + R.float(-(o.spread || Math.PI), o.spread || Math.PI) : R.float(0, Math.PI * 2);
        const sp = R.float(o.speedMin || 30, o.speed || 160);
        this.particle({
          x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (o.up || 0),
          life: R.float((o.life || 0.5) * 0.5, o.life || 0.5), color: Array.isArray(o.color) ? R.pick(o.color) : (o.color || G.PAL.white),
          size: o.size ? (Array.isArray(o.size) ? R.int(o.size[0], o.size[1]) : o.size) : 1,
          grav: o.grav == null ? 500 : o.grav, drag: o.drag == null ? 1.5 : o.drag,
          glow: o.glow || 0, shape: o.shape || 'px', bounce: o.bounce, decal: o.decal, additive: o.additive,
        });
      }
    }
    sparks(x, y, dir, n = 8, color = G.PAL.yellow) {
      this.burst(x, y, n, { angle: dir > 0 ? 0 : Math.PI, spread: 0.9, speed: 260, speedMin: 80, life: 0.3, color: [color, G.PAL.white], shape: 'spark', grav: 300, glow: 10, additive: true });
    }
    // coolant / oil splatter that paints decals when hitting walls
    splat(x, y, dir, n = 10, colors = ['#1fd6ff', '#0b7fa8', '#6b1c3a']) {
      this.burst(x, y, n, { angle: dir > 0 ? -0.4 : Math.PI + 0.4, spread: 1.1, speed: 220, speedMin: 40, life: 0.8, color: colors, size: [1, 2], grav: 600, drag: 0.5, decal: true });
    }
    // x,y world; value; color; crit => bigger
    number(x, y, value, color = G.PAL.white, crit = false) {
      this.texts.push({ x: x + G.rand.float(-4, 4), y, vy: -70, t: 0, life: crit ? 0.9 : 0.7, text: String(value), color, scale: crit ? 2 : 1 });
      if (this.texts.length > 60) this.texts.shift();
    }
    label(x, y, text, color = G.PAL.white, life = 1.2) {
      this.texts.push({ x, y, vy: -30, t: 0, life, text: String(text), color, scale: 1 });
    }
    ring(x, y, r0, r1, color = G.PAL.cyan, life = 0.35, thick = 2) {
      this.rings.push({ x, y, r0, r1, color, life, t: 0, thick });
    }
    // arc slash trail (drawn additive): angles in radians, dir facing
    slash(x, y, radius, a0, a1, color = G.PAL.cyan, life = 0.14, width = 5) {
      this.slashes.push({ x, y, radius, a0, a1, color, life, t: 0, width });
    }
    flash(color = '#ffffff', t = 0.08) { this.flashT = Math.max(this.flashT, t); this.flashColor = color; }
    decal(x, y, r, color) {
      if (!this.dctx || !this.level) return;
      // only paint where there's a back wall (not inside solid rock)
      if (this.level.solidAt(x, y)) return;
      const s = this.decalScale;
      this.dctx.fillStyle = color;
      this.dctx.globalAlpha = 0.85;
      G.px.disc(this.dctx, x / s, y / s, Math.max(0, r / s), color);
      this.dctx.globalAlpha = 1;
    }

    update(dt) {
      const L = this.level;
      const parts = this.parts;
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.t += dt;
        if (p.t >= p.life) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
        p.vy += p.grav * dt;
        if (p.drag) { const k = Math.max(0, 1 - p.drag * dt); p.vx *= k; p.vy *= k; }
        const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt;
        if (L && (p.bounce || p.decal) && L.solidAt(nx, ny)) {
          if (p.decal) {
            this.decal(p.x, p.y, G.rand.int(1, 3), p.color);
            parts[i] = parts[parts.length - 1]; parts.pop(); continue;
          }
          if (L.solidAt(nx, p.y)) p.vx *= -p.bounce; else p.vy *= -p.bounce;
          p.vx *= 0.8;
        } else { p.x = nx; p.y = ny; }
      }
      for (let i = this.texts.length - 1; i >= 0; i--) {
        const t = this.texts[i];
        t.t += dt; t.y += t.vy * dt; t.vy *= Math.pow(0.02, dt);
        if (t.t >= t.life) this.texts.splice(i, 1);
      }
      for (let i = this.rings.length - 1; i >= 0; i--) { const r = this.rings[i]; r.t += dt; if (r.t >= r.life) this.rings.splice(i, 1); }
      for (let i = this.slashes.length - 1; i >= 0; i--) { const s = this.slashes[i]; s.t += dt; if (s.t >= s.life) this.slashes.splice(i, 1); }
      if (this.flashT > 0) this.flashT -= dt;
    }

    drawDecals(ctx, cam) {
      if (!this.decals) return;
      const s = this.decalScale;
      const sx = Math.max(0, Math.floor(cam.ox / s)), sy = Math.max(0, Math.floor(cam.oy / s));
      const sw = Math.min(this.decals.width - sx, Math.ceil(G.W / s) + 2), sh = Math.min(this.decals.height - sy, Math.ceil(G.H / s) + 2);
      if (sw <= 0 || sh <= 0) return;
      ctx.globalAlpha = 0.9;
      ctx.drawImage(this.decals, sx, sy, sw, sh, sx * s - cam.ox, sy * s - cam.oy, sw * s, sh * s);
      ctx.globalAlpha = 1;
    }

    // normal-blend particles
    draw(ctx, cam) {
      const ox = cam.ox, oy = cam.oy;
      for (const p of this.parts) {
        if (p.additive) continue;
        this.drawPart(ctx, p, ox, oy);
      }
    }
    drawPart(ctx, p, ox, oy) {
      const k = 1 - p.t / p.life;
      const x = p.x - ox, y = p.y - oy;
      if (x < -20 || y < -20 || x > G.W + 20 || y > G.H + 20) return;
      ctx.globalAlpha = p.fade === false ? 1 : Math.min(1, k * 1.6);
      if (p.shape === 'spark' || p.shape === 'line') {
        const len = p.shape === 'spark' ? 0.03 : 0.05;
        G.px.line(ctx, x, y, x - p.vx * len, y - p.vy * len, p.color, 1);
      } else if (p.shape === 'disc') {
        G.px.disc(ctx, x, y, p.size * (p.shrink ? k : 1), p.color);
      } else {
        const s = Math.max(1, Math.round(p.size * (p.shrink ? k : 1)));
        ctx.fillStyle = p.color;
        ctx.fillRect(Math.round(x - s / 2), Math.round(y - s / 2), s, s);
      }
      ctx.globalAlpha = 1;
    }
    drawTexts(ctx, cam) {
      for (const t of this.texts) {
        const k = t.t / t.life;
        ctx.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
        const pop = t.scale > 1 && t.t < 0.08 ? 1 : 0;
        G.font.draw(ctx, t.text, t.x - cam.ox, t.y - cam.oy - pop, t.color, t.scale, 'center');
      }
      ctx.globalAlpha = 1;
    }
    // additive pass (called with 'lighter')
    drawAdditive(ctx, cam) {
      const ox = cam.ox, oy = cam.oy;
      for (const p of this.parts) {
        if (p.additive) this.drawPart(ctx, p, ox, oy);
        if (p.glow) G.drawGlow(ctx, p.x - ox, p.y - oy, p.glow, p.color.length === 7 ? p.color : '#ffffff', 0.5 * (1 - p.t / p.life));
      }
      for (const r of this.rings) {
        const k = r.t / r.life;
        ctx.globalAlpha = 1 - k;
        G.px.ring(ctx, r.x - ox, r.y - oy, G.lerp(r.r0, r.r1, G.easeOut(k)), r.color, r.thick);
        ctx.globalAlpha = 1;
      }
      for (const s of this.slashes) {
        const k = s.t / s.life;
        const cx = s.x - ox, cy = s.y - oy;
        const steps = Math.max(6, Math.ceil(Math.abs(s.a1 - s.a0) * s.radius / 2));
        const w = Math.max(1, Math.round(s.width * (1 - k)));
        ctx.globalAlpha = 1 - k * 0.6;
        ctx.fillStyle = s.color;
        for (let i = 0; i <= steps; i++) {
          const f = i / steps;
          const a = G.lerp(s.a0, s.a1, f);
          const ww = Math.max(1, Math.round(w * Math.sin(f * Math.PI)));
          for (let j = 0; j < ww; j++) {
            const rr = s.radius - j;
            ctx.fillRect(Math.round(cx + Math.cos(a) * rr), Math.round(cy + Math.sin(a) * rr), 1, 1);
          }
        }
        ctx.fillStyle = '#ffffff';
        for (let i = 0; i <= steps; i++) {
          const a = G.lerp(s.a0, s.a1, i / steps);
          ctx.fillRect(Math.round(cx + Math.cos(a) * s.radius), Math.round(cy + Math.sin(a) * s.radius), 1, 1);
        }
        ctx.globalAlpha = 1;
      }
    }
  }
  G.FX = FX;
})();
