'use strict';
// On-screen touch controls (mobile): floating joystick on the left, Dead Cells-style action cluster on
// the right (item icons + cooldown sweeps), contextual interact button, pause/map buttons, portrait hint.
// Multi-touch safe (tracks touch identifiers), drives the game only through G.input.setVirtual().
(function () {
  const G = window.G;
  const BTNS = [
    { act: 'attack1', slot: 'primary', k: 'k-c' },
    { act: 'attack2', slot: 'secondary', k: 'k-c' },
    { act: 'jump', icon: 'jump', k: 'k-g' },
    { act: 'roll', icon: 'roll', k: 'k-v' },
    { act: 'skill1', slot: 'skill1', k: 'k-c' },
    { act: 'skill2', slot: 'skill2', k: 'k-c' },
    { act: 'heal', icon: 'flask', k: 'k-s' },
    { act: 'interact', icon: 'hand', k: 'k-y' },
  ];
  const SLIDE = { attack1: 1, attack2: 1, skill1: 1, skill2: 1, jump: 1, roll: 1 }; // a finger may slide between these
  const DIRS = ['left', 'right', 'up', 'down'];
  const STAT_K = { brutality: 'k-b', tactics: 'k-t', survival: 'k-s' };

  const touch = {
    enabled: false, visible: false,
    touches: new Map(), hold: {}, dirs: {}, stick: { id: null },
    btn: {}, b: 60,

    init() {
      let root = document.getElementById('touch');
      if (!root) { root = document.createElement('div'); root.id = 'touch'; }
      document.body.appendChild(root); // full-viewport layer: may use the pillarbox & safe areas
      root.className = 'tc';
      this.root = root;
      const icon = (n) => (G.hud && G.hud.icon ? G.hud.icon(n) : '');
      let html = `<div class="tc-zone"></div><div class="tc-stick"><i class="tc-dir l"></i><i class="tc-dir r"></i><i class="tc-dir u"></i><i class="tc-dir d"></i><div class="tc-knob"></div></div>`;
      for (const b of BTNS) {
        html += `<div class="tc-btn ${b.k}" data-act="${b.act}">` +
          (b.slot ? '<canvas width="24" height="24"></canvas><i class="cd"></i><b class="cdt"></b>' : `<img alt="" draggable="false" src="${icon(b.icon)}">`) +
          (b.act === 'heal' ? '<b class="n"></b>' : '') + (b.act === 'interact' ? '<span class="lbl"></span>' : '') + '</div>';
      }
      html += `<div class="tc-sys" data-act="map"><img alt="" src="${icon('map')}"></div><div class="tc-sys" data-act="pause"><img alt="" src="${icon('pause')}"></div>`;
      root.innerHTML = html;
      this.zone = root.querySelector('.tc-zone');
      this.stickEl = root.querySelector('.tc-stick');
      this.knob = root.querySelector('.tc-knob');
      this.dirEls = { left: root.querySelector('.tc-dir.l'), right: root.querySelector('.tc-dir.r'), up: root.querySelector('.tc-dir.u'), down: root.querySelector('.tc-dir.d') };
      for (const b of BTNS) {
        const el = root.querySelector(`.tc-btn[data-act="${b.act}"]`);
        el.addEventListener('animationend', () => el.classList.remove('ready'));
        this.btn[b.act] = { def: b, el, cv: el.querySelector('canvas'), cd: el.querySelector('.cd'), cdt: el.querySelector('.cdt'), n: el.querySelector('.n'), lbl: el.querySelector('.lbl'), id: null, p: -1, t: '', peak: 1, last: 0, k: b.k };
      }
      // portrait hint
      const rot = document.createElement('div');
      rot.className = 'tc-rotate';
      rot.innerHTML = '<div class="ph"></div><div class="big">Поверните устройство</div><div class="sm">DEAD CIRCUITS играется в горизонтальной ориентации</div><button type="button">Играть так</button>';
      rot.querySelector('button').addEventListener('click', () => document.body.classList.add('tc-rotate-off'));
      document.body.appendChild(rot);

      const opt = { passive: false };
      root.addEventListener('touchstart', (e) => this.onStart(e), opt);
      root.addEventListener('touchmove', (e) => this.onMove(e), opt);
      root.addEventListener('touchend', (e) => this.onEnd(e), opt);
      root.addEventListener('touchcancel', (e) => this.onEnd(e), opt);
      // Stop compatibility mouse events (a tap on the canvas would otherwise fire attack1 via mousedown)
      // and double-tap zoom everywhere except in menus, where taps must become clicks.
      document.addEventListener('touchstart', (e) => {
        this.enable(true);
        const t = e.target;
        if (!t || !t.closest) return;
        if (t.closest('#ui .scr, .tc-rotate, #touch')) return;
        if (t.closest('.h-map')) { if (G.ui && G.ui.openMap) G.ui.openMap(); }
        if (e.cancelable) e.preventDefault();
      }, { capture: true, passive: false });
      document.addEventListener('gesturestart', (e) => e.preventDefault());
      document.addEventListener('dblclick', (e) => e.preventDefault());
      window.addEventListener('blur', () => this.releaseAll());
      document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseAll(); });
      window.addEventListener('keydown', (e) => { if (!e.repeat && this.enabled && !G.params.has('touch')) this.enable(false); });
      const rs = () => requestAnimationFrame(() => this.layout());
      window.addEventListener('resize', rs);
      window.addEventListener('orientationchange', rs);

      let coarse = false;
      try { coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches; } catch (e) { /* old browser */ }
      if (coarse || G.params.has('touch')) this.enable(true);
      this.layout();
      const loop = () => { try { this.frame(); } catch (e) { console.error(e); } requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    },

    enable(on) {
      if (this.enabled === on) return;
      this.enabled = on;
      document.body.classList.toggle('touch-mode', on);
      if (on) G.input.device = 'touch';
      else this.releaseAll();
      if (G.hud && G.hud.measure) requestAnimationFrame(() => G.hud.measure());
      this.layout();
    },

    // geometry: button unit, idle stick position, keep the HUD minimap clear of the system buttons
    layout() {
      const vw = window.innerWidth, vh = window.innerHeight;
      this.b = Math.max(46, Math.min(86, 0.155 * Math.min(vw, vh)));
      if (this.stick.id == null) this.placeStick(null);
      const st = document.getElementById('stage');
      if (!st) return;
      const r = st.getBoundingClientRect();
      const cs = getComputedStyle(document.documentElement);
      const sar = parseFloat(cs.getPropertyValue('--sar')) || 0, sat = parseFloat(cs.getPropertyValue('--sat')) || 0;
      // system buttons live at the top-right; they only collide with the HUD when they overlap the stage
      const pillar = r.top >= sat + 54 ? 1e4 : vw - r.right;
      const narrow = pillar < 108 + sar;
      document.body.classList.toggle('tc-narrow', narrow);
      const need = (narrow ? 58 : 108) + sar;
      document.body.style.setProperty('--tc-res', Math.max(0, need - pillar) + 'px');
      document.body.classList.toggle('tc-reserve', pillar < need);
    },
    placeStick(x, y) {
      const s = this.stickEl.style;
      if (x == null) {
        const cs = getComputedStyle(document.documentElement);
        const sal = parseFloat(cs.getPropertyValue('--sal')) || 0, sab = parseFloat(cs.getPropertyValue('--sab')) || 0;
        x = sal + this.b * 1.55; y = window.innerHeight - sab - this.b * 1.45;
      }
      this.stick.bx = x; this.stick.by = y;
      s.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      this.knob.style.transform = '';
    },

    // ---------------------------------------------------------------- action holds (counted per action)
    press(act, el) {
      this.hold[act] = (this.hold[act] || 0) + 1;
      if (this.hold[act] === 1) G.input.setVirtual(act, true);
      if (el) el.classList.add('on');
    },
    release(act, el) {
      if (!this.hold[act]) return;
      this.hold[act]--;
      if (this.hold[act] <= 0) { this.hold[act] = 0; G.input.setVirtual(act, false); }
      if (el && !this.hold[act]) el.classList.remove('on');
    },
    setDir(d, on) {
      if (!!this.dirs[d] === on) return;
      this.dirs[d] = on;
      G.input.setVirtual(d, on);
      this.dirEls[d].classList.toggle('on', on);
    },
    releaseAll() {
      for (const a in this.hold) if (this.hold[a]) { this.hold[a] = 0; G.input.setVirtual(a, false); }
      for (const d of DIRS) this.setDir(d, false);
      this.touches.clear();
      if (this.root) this.root.querySelectorAll('.on').forEach((e) => e.classList.remove('on'));
      if (this.stickEl) { this.stick.id = null; this.stickEl.classList.remove('on'); this.placeStick(null); }
    },

    onStart(e) {
      if (e.cancelable) e.preventDefault();
      if (!this.visible) return;
      for (const t of e.changedTouches) {
        const tg = t.target && t.target.closest ? t.target : null;
        const b = tg && tg.closest('.tc-btn, .tc-sys');
        if (b) {
          const act = b.dataset.act;
          this.touches.set(t.identifier, { kind: 'btn', act, el: b });
          this.press(act, b);
          if (act === 'jump' || act === 'roll' || act === 'attack1') this.buzz(8);
          continue;
        }
        if (tg && tg.closest('.tc-zone') && this.stick.id == null) {
          this.stick.id = t.identifier;
          this.touches.set(t.identifier, { kind: 'stick' });
          this.placeStick(t.clientX, t.clientY);
          this.stickEl.classList.add('on');
          this.moveStick(t.clientX, t.clientY);
        }
      }
    },
    onMove(e) {
      if (e.cancelable) e.preventDefault();
      for (const t of e.changedTouches) {
        const rec = this.touches.get(t.identifier);
        if (!rec) continue;
        if (rec.kind === 'stick') { this.moveStick(t.clientX, t.clientY); continue; }
        if (!SLIDE[rec.act]) continue;
        const under = document.elementFromPoint(t.clientX, t.clientY);
        const nb = under && under.closest && under.closest('.tc-btn');
        if (nb && nb !== rec.el && SLIDE[nb.dataset.act] && this.root.contains(nb)) {
          this.release(rec.act, rec.el);
          rec.act = nb.dataset.act; rec.el = nb;
          this.press(rec.act, nb);
        }
      }
    },
    onEnd(e) {
      if (e.cancelable) e.preventDefault();
      for (const t of e.changedTouches) {
        const rec = this.touches.get(t.identifier);
        if (!rec) continue;
        this.touches.delete(t.identifier);
        if (rec.kind === 'stick') {
          this.stick.id = null;
          for (const d of DIRS) this.setDir(d, false);
          this.stickEl.classList.remove('on');
          this.placeStick(null);
        } else this.release(rec.act, rec.el);
      }
    },
    moveStick(x, y) {
      const R = this.b * 0.8;
      let dx = x - this.stick.bx, dy = y - this.stick.by;
      let d = Math.hypot(dx, dy);
      if (d > R * 1.3) { // drag the base along with the thumb
        const k = (d - R * 1.3) / d;
        this.placeStick(this.stick.bx + dx * k, this.stick.by + dy * k);
        dx = x - this.stick.bx; dy = y - this.stick.by; d = Math.hypot(dx, dy);
      }
      const kd = d > R ? R / d : 1;
      this.knob.style.transform = `translate(${(dx * kd).toFixed(1)}px, ${(dy * kd).toFixed(1)}px)`;
      const nx = dx / R, ny = dy / R, ax = Math.abs(dx), ay = Math.abs(dy);
      const D = this.dirs;
      this.setDir('left', D.left ? nx < -0.2 : nx < -0.3);
      this.setDir('right', D.right ? nx > 0.2 : nx > 0.3);
      // vertical only when clearly vertical (keeps running from triggering ladders / drops)
      this.setDir('up', ny < (D.up ? -0.4 : -0.5) && ay > ax * (D.up ? 0.85 : 1.15));
      this.setDir('down', ny > (D.down ? 0.4 : 0.5) && ay > ax * (D.down ? 0.85 : 1.15));
    },
    buzz(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* unsupported */ } },

    // ---------------------------------------------------------------- per-frame (rAF) refresh
    frame() {
      const g = G.game;
      const show = this.enabled && !!g && g.state === 'play' && !g.paused && !!G.world && !(G.ui && G.ui.stack && G.ui.stack.length);
      if (show !== this.visible) {
        this.visible = show;
        document.body.classList.toggle('tc-on', show);
        if (!show) this.releaseAll();
      }
      if (!show) return;
      if (G.input.device === 'pad') { this.enable(false); return; }
      const p = G.world.player;
      if (!p) return;
      for (const b of BTNS) {
        const B = this.btn[b.act];
        if (b.slot) this.updSlot(B, p.slots[b.slot], p);
      }
      const H = this.btn.heal;
      const n = p.flasks | 0;
      if (n !== H.p) { H.n.textContent = n; H.el.classList.toggle('empty', n <= 0); H.p = n; }
      const I = this.btn.interact;
      const f = p.state !== 'dead' ? p.focus : null;
      if (!!f !== !!I.id) { I.el.classList.toggle('show', !!f); if (!f) this.release('interact', I.el); }
      if (f) {
        let txt = typeof f.prompt === 'function' ? f.prompt() : f.prompt || '';
        txt = String(txt).split(/[:—]/)[0].trim();
        if (txt !== I.t) { I.lbl.textContent = txt; I.t = txt; }
      }
      I.id = f || null;
    },
    updSlot(B, inst, p) {
      const id = inst ? inst.id + ':' + inst.uid : '';
      if (id !== B.id) {
        B.id = id;
        const g = B.cv.getContext('2d');
        g.clearRect(0, 0, 24, 24);
        if (inst) { try { g.imageSmoothingEnabled = false; g.drawImage(G.itemIcon(inst.def, 24), 0, 0); } catch (e) { /* no icon */ } }
        B.el.classList.toggle('empty', !inst);
        const st = inst ? (Array.isArray(inst.def.stat) ? inst.def.stat[0] : inst.def.stat) : null;
        const k = STAT_K[st] || B.def.k;
        if (k !== B.k) { B.el.classList.remove(B.k); B.el.classList.add(k); B.k = k; }
        B.peak = 1; B.last = 0;
      }
      let frac = 0, txt = '';
      if (inst && inst.cd > 0) {
        if (inst.cd > B.last + 0.02) B.peak = inst.cd;
        const tot = inst.cdMax || (inst.def.cooldown ? inst.def.cooldown * (p.cdMul || 1) : B.peak);
        frac = Math.max(0, Math.min(1, inst.cd / Math.max(0.01, tot)));
        if (inst.cd >= 1) txt = String(Math.ceil(inst.cd));
      }
      B.last = inst ? inst.cd || 0 : 0;
      const q = Math.ceil(frac * 48) / 48;
      if (q !== B.p) {
        if (q === 0 && B.p > 0) B.el.classList.add('ready');
        B.cd.style.setProperty('--p', q.toFixed(3));
        B.el.classList.toggle('cooling', q > 0);
        B.p = q;
      }
      if (txt !== B.t) { B.cdt.textContent = txt; B.t = txt; }
    },
  };
  G.touch = touch;
})();
