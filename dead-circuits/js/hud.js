'use strict';
// In-game HUD — DOM overlay sized in game pixels (CSS var --u). G.hud.update() runs every rendered
// frame and only touches the DOM when a displayed value actually changes.
// Also owns: pixel icons (G.hud.icon), the explored-map texture + renderer shared with the big map.
(function () {
  const G = window.G;
  const T = G.T, TS = G.TILE;

  // ------------------------------------------------------------------ pixel icons
  // Pattern rows -> cached canvas / data URL. 'o' is the dark outline.
  const PIX = {
    cells: { p: { o: '#05040a', C: '#35c8ff', W: '#ffffff', D: '#1b6fa8', L: '#9be6ff' }, r: [
      '..ooooo..', '.oCCCCCo.', 'oCWLCCCCo', 'oCLCCCCCo', 'oCCCCCCCo', 'oCCCCCCDo', 'oCCCCCDDo', '.oCDDDDo.', '..ooooo..'] },
    gold: { p: { o: '#05040a', Y: '#ffc23d', W: '#fff2b0', D: '#a8741a' }, r: [
      '..ooooo..', '.oYYYYYo.', 'oYWYYYYDo', 'oYYoooYDo', 'oYYoYYYDo', 'oYYoooYDo', 'oYYYYYDDo', '.oDDDDDo.', '..ooooo..'] },
    skull: { p: { o: '#05040a', W: '#e9e6ff', D: '#8d8fb8' }, r: [
      '..ooooo..', '.oWWWWWo.', 'oWWWWWWWo', 'oWooWooWo', 'oWooWooWo', 'oWWWoWWWo', '.oDWWWDo.', '..oWoWo..', '...ooo...'] },
    clock: { p: { o: '#05040a', W: '#e9e6ff', C: '#27f3ff' }, r: [
      '..ooooo..', '.oWWWWWo.', 'oWWWCWWWo', 'oWWWCWWWo', 'oWWWCCCWo', 'oWWWWWWWo', 'oWWWWWWWo', '.oWWWWWo.', '..ooooo..'] },
    blade: { p: { o: '#05040a', W: '#e9e6ff', C: '#27f3ff', Y: '#ffe14d' }, r: [
      '......ooo', '.....oWCo', '....oWCo.', '...oWCo..', 'o.oWCo...', 'oYoCo....', '.oYo.....', 'oYooY....', 'oo..o....'] },
    heart: { p: { o: '#05040a', R: '#ff3d4f', W: '#ffb3c0', D: '#a8182a' }, r: [
      '.oo...oo.', 'oRRo.oRRo', 'oRWRoRRRo', 'oRRRRRRRo', '.oRRRRDo.', '..oRRDo..', '...oDo...', '....o....', '.........'] },
    chip: { p: { o: '#05040a', G: '#4dff7a', D: '#0f5c3a', Y: '#ffc23d' }, r: [
      '.o.o.o.o.', 'ooooooooo', 'oDDDDDDDo', 'oDGGGGGDo', 'oDGDDDGDo', 'oDGGGGGDo', 'oDDDDDDDo', 'ooooooooo', '.Y.Y.Y.Y.'] },
    stage: { p: { o: '#05040a', M: '#ff2a8a', W: '#ffd6e6' }, r: [
      '.........', 'oooo.....', 'oMMoooooo', 'oMWMMMMMo', 'oMMMMMMMo', 'oMMMMMMMo', 'oMMMMMMMo', 'ooooooooo', '.........'] },
    implant: { p: { o: '#05040a', V: '#b46cff', W: '#f0d8ff', D: '#4a2080' }, r: [
      '...ooo...', '..oVVVo..', '.oVWVVVo.', 'oVVVDVVVo', 'oVVDDDVVo', 'oVVVDVVVo', '.oVVVVVo.', '..oVVVo..', '...ooo...'] },
    flask: { p: { o: '#05040a', M: '#8d95c4', W: '#e9e6ff', G: '#4dff7a', L: '#c6ffd6', D: '#1c9a47', S: '#45466a' }, r: [
      '....oooooo....', '....oMMMMo....', '...ooMWMMoo...', '...oSSSSSSo...', '...oooooooo...', '....oGGGGo....', '....oLGGGo....', '....oLGGGo....',
      '....oGGGGo....', '....oGGGGo....', '....oDGGGo....', '....oDDGGo....', '....oDDDGo....', '....oooooo....', '.....oSSo.....', '......oo......',
      '......Mo......', '......Mo......', '.......o......'] },
    jump: { p: { o: '#05040a', W: '#ffffff', C: '#7dffb1' }, r: [
      '....oo....', '...oWWo...', '..oWWWWo..', '.oWWooWWo.', 'oWWo..oWWo', 'ooo.oo.ooo', '...oWWo...', '..oWWWWo..', '.oWWooWWo.', 'oWWo..oWWo', 'ooo....ooo'] },
    roll: { p: { o: '#05040a', W: '#ffffff' }, r: [
      '..........', 'ooo..ooo..', 'oWWo.oWWo.', '.oWWo.oWWo', '..oWWo.oWW', '..oWWo.oWW', '.oWWo.oWWo', 'oWWo.oWWo.', 'ooo..ooo..', '..........'] },
    hand: { p: { o: '#05040a', W: '#ffe9a8', D: '#c9a04a' }, r: [
      '...oo.....', '..oWWo....', '..oWWoooo.', '..oWWoWWoo', 'oooWWoWWoWo', 'oWoWWWWWWWo', 'oWWWWWWWWWo', '.oWWWWWWWDo', '..oWWWWWDo.', '...oDDDDo..', '....oooo...'] },
    pause: { p: { o: '#05040a', W: '#e9e6ff' }, r: [
      'oooo.oooo', 'oWWo.oWWo', 'oWWo.oWWo', 'oWWo.oWWo', 'oWWo.oWWo', 'oWWo.oWWo', 'oWWo.oWWo', 'oWWo.oWWo', 'oooo.oooo'] },
    map: { p: { o: '#05040a', B: '#5a7dff', W: '#b8c8ff', C: '#27f3ff' }, r: [
      'ooooooooo', 'oBBBoBBBo', 'oBWBoBBBo', 'oBBBoBCBo', 'ooooooooo', 'oBBBoBBBo', 'oBBBoWBBo', 'oBBBoBBBo', 'ooooooooo'] },
  };
  const pixCache = {};
  function pixCanvas(name) {
    if (pixCache[name]) return pixCache[name].cv;
    const d = PIX[name];
    const w = Math.max(...d.r.map((r) => r.length)), h = d.r.length;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    d.r.forEach((row, y) => { for (let x = 0; x < row.length; x++) { const c = d.p[row[x]]; if (c) { g.fillStyle = c; g.fillRect(x, y, 1, 1); } } });
    pixCache[name] = { cv, url: null };
    return cv;
  }
  function icon(name) {
    pixCanvas(name);
    const e = pixCache[name];
    if (!e.url) { try { e.url = e.cv.toDataURL(); } catch (err) { e.url = ''; } }
    return e.url;
  }
  const img = (name, cls = 'px') => `<img class="${cls}" alt="" draggable="false" src="${icon(name)}">`;

  // stat helpers shared with menus
  const STAT_NAME = { brutality: 'Жестокость', tactics: 'Тактика', survival: 'Живучесть' };
  const STAT_K = { brutality: 'k-b', tactics: 'k-t', survival: 'k-s' };
  const STAT_BG = { brutality: 'rgba(46, 10, 18, 0.88)', tactics: 'rgba(30, 14, 52, 0.88)', survival: 'rgba(10, 38, 22, 0.88)' };
  const KIND_NAME = { melee: 'Ближний бой', ranged: 'Дальний бой', shield: 'Щит', skill: 'Навык' };
  const SLOT_NAME = { primary: 'Основное', secondary: 'Второе', skill1: 'Навык 1', skill2: 'Навык 2' };
  const statList = (s) => (Array.isArray(s) ? s : s ? [s] : []);
  function statColor(stat) {
    const l = statList(stat).map((s) => G.STAT_COLOR[s]).filter(Boolean);
    if (!l.length) return '#45466a';
    if (l.length === 1) return l[0];
    return `linear-gradient(135deg, ${l[0]} 50%, ${l[1]} 50%)`;
  }
  function qualityClass(inst) { return 'q-' + (inst && inst.quality && inst.quality !== 'normal' ? inst.quality : 'normal'); }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function fmtTime(t, short) {
    t = Math.max(0, Math.floor(t || 0));
    const m = Math.floor(t / 60), s = t % 60;
    return short ? `${m}:${String(s).padStart(2, '0')}` : `${m}m ${String(s).padStart(2, '0')}s`;
  }
  // draws an item icon into a canvas element (size = backing size)
  function paintItem(cv, def) {
    const g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    if (!def) return;
    try { g.imageSmoothingEnabled = false; g.drawImage(G.itemIcon(def, 24), 0, 0, cv.width, cv.height); } catch (e) { /* icon failed */ }
  }
  function paintMutation(cv, m) {
    const g = cv.getContext('2d');
    const s = cv.width;
    g.clearRect(0, 0, s, s);
    const fn = (m && (m.drawIcon || (typeof m.icon === 'function' ? m.icon : null) || (m.def && m.def.drawIcon))) || null;
    try {
      if (m && G.mutationIcon) { g.imageSmoothingEnabled = false; g.drawImage(G.mutationIcon(m, s), 0, 0, s, s); return; }
      if (fn) { fn.call(m.def || m, g, s); return; }
      if (m && m.icon && m.icon.getContext) { g.imageSmoothingEnabled = false; g.drawImage(m.icon, 0, 0, s, s); return; }
    } catch (e) { /* fall through to generic */ }
    g.imageSmoothingEnabled = false;
    g.drawImage(pixCanvas('implant'), Math.floor((s - 9) / 2), Math.floor((s - 9) / 2));
  }
  function mutName(m) { return (m && (m.name || (m.def && m.def.name) || m.id)) || 'Имплант'; }

  // ------------------------------------------------------------------ explored map texture
  const MK = 3; // texture pixels per tile
  const MC = { air: '#16235f', edgeFill: '#26409a', edge: '#8aa8ff', core: 'rgba(12, 18, 50, 0.55)', plat: '#c6d4ff', ladder: '#7d90d6', spike: '#ff3d4f' };
  function makeMapTex(level) {
    const tex = document.createElement('canvas');
    tex.width = Math.max(1, level.w * MK); tex.height = Math.max(1, level.h * MK);
    return { level, tex, g: tex.getContext('2d'), seen: new Uint8Array(level.w * level.h), n: 0 };
  }
  function paintTile(m, x, y) {
    const L = m.level, g = m.g, X = x * MK, Y = y * MK;
    if (L.solid(x, y)) {
      const u = !L.solid(x, y - 1), d = !L.solid(x, y + 1), l = !L.solid(x - 1, y), r = !L.solid(x + 1, y);
      if (u || d || l || r) {
        g.fillStyle = MC.edgeFill; g.fillRect(X, Y, MK, MK);
        g.fillStyle = MC.edge;
        if (u) g.fillRect(X, Y, MK, 1);
        if (d) g.fillRect(X, Y + MK - 1, MK, 1);
        if (l) g.fillRect(X, Y, 1, MK);
        if (r) g.fillRect(X + MK - 1, Y, 1, MK);
      } else { g.fillStyle = MC.core; g.fillRect(X, Y, MK, MK); }
      return;
    }
    const t = L.tile(x, y);
    g.fillStyle = MC.air; g.fillRect(X, Y, MK, MK);
    if (t === T.PLATFORM) { g.fillStyle = MC.plat; g.fillRect(X, Y, MK, 1); }
    else if (t === T.LADDER) { g.fillStyle = MC.ladder; g.fillRect(X, Y, 1, MK); g.fillRect(X + MK - 1, Y, 1, MK); g.fillRect(X, Y + 1, MK, 1); }
    else if (t === T.SPIKES) { g.fillStyle = MC.spike; g.fillRect(X, Y + MK - 1, MK, 1); g.fillRect(X + 1, Y + MK - 2, 1, 1); }
  }
  function scanMapTex(m) {
    const L = m.level, E = L.explored;
    if (!E) return 0;
    const w = L.w, seen = m.seen;
    let n = 0;
    for (let i = 0, len = Math.min(E.length, seen.length); i < len; i++) {
      if (E[i] && !seen[i]) { seen[i] = 1; paintTile(m, i % w, (i / w) | 0); n++; }
    }
    m.n += n;
    return n;
  }
  // map markers: detect object kinds robustly (lead may set o.mapKind / o.kind later)
  const CTOR_KIND = { ExitDoor: 'exit', Exit: 'exit', Door: 'exit', Chest: 'chest', Scroll: 'scroll', Collector: 'collector', HealStation: 'heal', Shop: 'shop', Boss: 'boss' };
  const KNOWN = { exit: 1, chest: 1, scroll: 1, shop: 1, collector: 1, heal: 1, healstation: 1, item: 1, weapon: 1, boss: 1 };
  function objKind(o) {
    if (!o || o.dead) return null;
    if (o.mapKind) return o.mapKind;
    if (G.Currency && o instanceof G.Currency) return null;
    if (o.inst) return o.price ? 'shop' : 'item';
    if (G.Scroll && o instanceof G.Scroll) return 'scroll';
    let k = typeof o.kind === 'string' && KNOWN[o.kind] ? o.kind : null;
    if (!k && o.constructor) k = CTOR_KIND[o.constructor.name] || null;
    if (k === 'healstation') k = 'heal';
    if (k === 'weapon') k = 'item';
    if (k === 'chest' && (o.open || o.opened)) return null;
    if (k === 'heal' && o.used) return null;
    return k;
  }
  const MARK_COL = { exit: '#27f3ff', exitLocked: '#ff3348', chest: '#ffe14d', scroll: '#4dff7a', shop: '#ffc23d', item: '#ffffff', collector: '#35c8ff', heal: '#4dff7a', boss: '#ff2a8a' };
  function drawMarker(g, k, x, y, s, o, blink) {
    const f = (c, dx, dy, w, h) => { g.fillStyle = c; g.fillRect(Math.round(x + dx * s), Math.round(y + dy * s), Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))); };
    const ink = '#05040a';
    switch (k) {
      case 'exit': {
        const c = o && o.locked ? MARK_COL.exitLocked : MARK_COL.exit;
        f(ink, -3, -8, 7, 10); f(c, -2, -7, 5, 8); f('#05101a', -1, -6, 3, 7); break;
      }
      case 'chest': f(ink, -3, -4, 7, 5); f(MARK_COL.chest, -2, -3, 5, 3); break;
      case 'scroll': f(ink, -2, -5, 5, 6); f(blink ? '#b6ffcf' : MARK_COL.scroll, -1, -4, 3, 4); break;
      case 'shop': f(ink, -3, -4, 7, 5); f(MARK_COL.shop, -2, -3, 5, 3); f(ink, 0, -3, 1, 3); break;
      case 'item': {
        const c = (o && o.inst && G.STAT_COLOR[statList(o.inst.def.stat)[0]]) || MARK_COL.item;
        f(ink, -2, -4, 5, 5); f(c, -1, -3, 3, 3); break;
      }
      case 'collector': f(ink, -3, -8, 7, 9); f(MARK_COL.collector, -2, -7, 5, 7); f('#ffffff', -1, -6, 1, 1); break;
      case 'heal': f(ink, -3, -6, 7, 7); f(MARK_COL.heal, -1, -5, 1, 5); f(MARK_COL.heal, -3 + 1, -3, 5, 1); break;
      case 'boss': f(ink, -3, -6, 7, 7); f(MARK_COL.boss, -2, -5, 5, 5); break;
    }
  }

  // ------------------------------------------------------------------ HUD
  const hud = {
    el: null, visible: false, t: 0, frame: 0,
    map: null, marks: [], ppg: 2,
    icon, img, pixCanvas, statColor, statList, qualityClass, paintItem, paintMutation, mutName, fmtTime, esc, objKind, drawMarker,
    STAT_NAME, STAT_K, STAT_BG, KIND_NAME, SLOT_NAME, MARK_COL,

    init() {
      // Tiny5: pixel font with complete Cyrillic (the Google build of Pixelify Sans lacks 'О' and 'П').
      // Injected here so it never blocks rendering; the UI falls back to monospace when offline.
      if (!document.querySelector('link[data-dc-font]')) {
        const l = document.createElement('link');
        l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=Tiny5&display=swap'; l.setAttribute('data-dc-font', '');
        document.head.appendChild(l);
      }
      try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => this.measure()); } catch (e) { /* no font loading API */ }
      const el = (this.el = document.getElementById('hud'));
      el.innerHTML = `
        <div class="h-toasts"></div>
        <div class="h-boss" hidden><div class="h-boss-name"></div>
          <div class="h-boss-bar cf"><i class="trail"></i><i class="fill"></i><i class="tick" style="left:66%"></i><i class="tick" style="left:33%"></i></div></div>
        <div class="h-bl">
          <div class="h-muts"></div>
          <div class="h-slots"></div>
          <div class="h-hprow">
            <div class="h-stats"><b class="sB">1</b><b class="sT">1</b><b class="sS">1</b></div>
            <div class="h-hp cf"><i class="trail"></i><i class="rec"></i><i class="fill"></i><span class="h-hpt"></span></div>
          </div>
        </div>
        <div class="h-br">
          <div class="h-seed"></div><div class="h-time"></div>
          <div class="h-cur"><div class="h-cells"><span>0</span>${img('cells')}</div><div class="h-gold"><span>0</span>${img('gold')}</div></div>
          <div class="h-map cf" title="Карта"><canvas class="px" width="192" height="108"></canvas><span class="h-mapkey"></span></div>
        </div>
        <div class="h-anchor h-pa" hidden><div class="h-prompt cf"><span class="h-key"></span><span class="h-pt"></span></div></div>
        <div class="h-anchor h-ca" hidden><div class="h-card cf"></div></div>`;
      const q = (s) => el.querySelector(s);
      this.toastsEl = q('.h-toasts');
      this.bossEl = q('.h-boss'); this.bossName = q('.h-boss-name'); this.bossFill = q('.h-boss-bar .fill'); this.bossTrail = q('.h-boss-bar .trail');
      this.mutsEl = q('.h-muts');
      this.hpEl = q('.h-hp'); this.hpFill = q('.h-hp .fill'); this.hpRec = q('.h-hp .rec'); this.hpTrail = q('.h-hp .trail'); this.hpTxt = q('.h-hpt');
      this.statEls = { brutality: q('.sB'), tactics: q('.sT'), survival: q('.sS') };
      this.seedEl = q('.h-seed'); this.timeEl = q('.h-time');
      this.cellsEl = q('.h-cells'); this.cellsTxt = q('.h-cells span'); this.goldEl = q('.h-gold'); this.goldTxt = q('.h-gold span');
      this.mapEl = q('.h-map'); this.mapCv = q('.h-map canvas'); this.mapCtx = this.mapCv.getContext('2d'); this.mapKey = q('.h-mapkey');
      this.pa = q('.h-pa'); this.promptEl = q('.h-prompt'); this.promptKey = q('.h-prompt .h-key'); this.promptTxt = q('.h-pt');
      this.ca = q('.h-ca'); this.cardEl = q('.h-card');
      this.mapEl.addEventListener('click', () => { if (G.ui && G.ui.openMap) G.ui.openMap(); });

      // slots: heal flask + the 4 item slots
      const slotsEl = q('.h-slots');
      const fl = document.createElement('div');
      fl.className = 'h-slot h-flask';
      fl.innerHTML = `<div class="h-sf cf" style="--bc:#2f7a4a;--bg:rgba(8,26,16,0.85)"><canvas class="px" width="28" height="28"></canvas><div class="h-pips"></div><b class="h-cnt"></b></div><span class="h-key"></span>`;
      slotsEl.appendChild(fl);
      const fcv = fl.querySelector('canvas'), fg = fcv.getContext('2d');
      fg.imageSmoothingEnabled = false;
      fg.drawImage(pixCanvas('flask'), 7, 4);
      this.flask = { el: fl, pips: fl.querySelector('.h-pips'), cnt: fl.querySelector('.h-cnt'), key: fl.querySelector('.h-key'), n: -1, max: -1 };
      this.slots = {};
      for (const [slot, btn] of G.SLOT_BUTTONS || []) {
        const d = document.createElement('div');
        d.className = 'h-slot empty';
        d.innerHTML = `<div class="h-sf cf"><canvas class="px" width="24" height="24"></canvas><i class="h-cd"></i><b class="h-cdt"></b><b class="h-ammo"></b></div><span class="h-key"></span>`;
        slotsEl.appendChild(d);
        d.addEventListener('animationend', () => d.classList.remove('ready', 'denied'));
        this.slots[slot] = { el: d, sf: d.querySelector('.h-sf'), cv: d.querySelector('canvas'), cd: d.querySelector('.h-cd'), cdt: d.querySelector('.h-cdt'),
          ammo: d.querySelector('.h-ammo'), key: d.querySelector('.h-key'), btn, id: null, cdF: 0, cdT: '', am: '', peak: 1, last: 0 };
      }
      for (const b of Object.values(this.statEls)) b.addEventListener('animationend', () => b.classList.remove('pop'));
      this.reset();
      this.bindEvents();
      const rs = () => requestAnimationFrame(() => this.measure());
      window.addEventListener('resize', rs);
      window.addEventListener('orientationchange', rs);
      rs();
    },

    reset() {
      this.c = { hpF: -1, recF: -1, trF: -1, hpTxt: '', low: null, heal: null, stats: {}, time: '', cells: null, gold: null, seed: null, dev: null,
        mutN: -1, mutLast: null, boss: null, bossF: -1, bossTr: 1, focus: null, focusKey: '', px: null, py: null, mapKey: '' };
      this.trail = 1; this.trailHold = 0; this.bossTrail_ = 1; this.bossHold = 0;
      for (const k in this.slots || {}) { const s = this.slots[k]; s.id = null; s.cdF = -1; s.cdT = null; s.am = null; }
      if (this.flask) { this.flask.n = -1; this.flask.max = -1; }
    },

    measure() {
      if (!this.el) return;
      const w = this.el.clientWidth;
      if (w > 0) this.ppg = w / G.W;
      this.c.px = null; this.c.focusKey = '';
    },

    show(on) {
      if (!this.el) return;
      this.visible = !!on;
      this.el.hidden = !on;
      if (on) this.measure();
      else { this.pa.hidden = true; this.ca.hidden = true; }
    },

    onLevel(world) {
      this.map = world && world.level && world.level.w ? makeMapTex(world.level) : null;
      this.marks = [];
      this.c.focus = null; this.c.focusKey = ''; this.c.mapKey = '';
      this.c.boss = null;
      this.bossEl.hidden = true; this.bossEl.classList.remove('gone');
      this.pa.hidden = true; this.ca.hidden = true;
      this.frame = 0;
      this.measure();
    },

    // ---------------------------------------------------------------- per-frame update
    update(world, dt) {
      if (!this.el || !this.visible || !world || !world.player) return;
      const p = world.player;
      if (this.map && this.map.level !== world.level) this.onLevel(world);
      else if (!this.map && world.level && world.level.w) this.onLevel(world);
      this.t += dt; this.frame++;
      const dev = this.touchMode() ? 'touch' : G.input.device;
      const devChanged = dev !== this.c.dev;
      this.c.dev = dev;
      this.updateHp(p, dt);
      this.updateSlots(p, devChanged, dev);
      this.updateStats(p);
      if (p.mutations && (p.mutations.length !== this.c.mutN || p.mutations[p.mutations.length - 1] !== this.c.mutLast)) this.updateMuts(p);
      this.updateRight(world, p, devChanged);
      this.updateMap(world, p);
      this.updateBoss(world, dt);
      this.updateFocus(world, p, dev, devChanged);
      this.updateToasts(dt);
    },

    touchMode() { return document.body.classList.contains('touch-mode'); },

    setScale(el, v, axis = 'X') { el.style.transform = `scale${axis}(${v.toFixed(4)})`; },

    updateHp(p, dt) {
      const c = this.c;
      const max = Math.max(1, p.maxHp || 1), hp = Math.max(0, Math.min(max, p.hp || 0));
      const f = hp / max;
      if (f < c.hpF - 0.0005) this.trailHold = 0;
      if (f < this.trail) {
        this.trailHold += dt;
        if (this.trailHold > 0.4) this.trail = Math.max(f, this.trail - dt * 0.8);
      } else this.trail = f;
      const rec = Math.min(1, (hp + Math.max(0, p.recoverable || 0)) / max);
      if (Math.abs(f - c.hpF) > 0.0005) { this.setScale(this.hpFill, f); c.hpF = f; }
      if (Math.abs(rec - c.recF) > 0.0005) { this.setScale(this.hpRec, rec); c.recF = rec; }
      const tr = Math.max(this.trail, f);
      if (Math.abs(tr - c.trF) > 0.001) { this.setScale(this.hpTrail, tr); c.trF = tr; }
      const txt = Math.ceil(hp) + ' / ' + Math.round(max);
      if (txt !== c.hpTxt) { this.hpTxt.textContent = txt; c.hpTxt = txt; }
      const low = f < 0.3 && hp > 0;
      if (low !== c.low) { this.hpEl.classList.toggle('low', low); c.low = low; }
      const heal = (p.healT || 0) > 0;
      if (heal !== c.heal) { this.hpEl.classList.toggle('healing', heal); this.flask.el.classList.toggle('healing', heal); c.heal = heal; }
    },

    keyLabel(el, act, dev) {
      const l = dev === 'touch' ? '' : G.input.label(act) || '';
      el.textContent = l;
      el.className = 'h-key' + (dev === 'pad' && l.length === 1 ? ' pad-' + l : '');
    },

    updateSlots(p, devChanged, dev) {
      // flask
      const F = this.flask;
      const n = p.flasks | 0, max = p.maxFlasks | 0;
      if (max !== F.max) {
        F.pips.innerHTML = '<i></i>'.repeat(Math.max(0, Math.min(max, 6)));
        F.max = max; F.n = -1;
      }
      if (n !== F.n) {
        F.cnt.textContent = n;
        const pips = F.pips.children;
        for (let i = 0; i < pips.length; i++) pips[i].classList.toggle('off', i >= n);
        F.el.classList.toggle('empty', n <= 0);
        F.n = n;
      }
      if (devChanged) this.keyLabel(F.key, 'heal', dev);
      // item slots
      for (const slot in this.slots) {
        const s = this.slots[slot], inst = p.slots[slot];
        const id = inst ? inst.id + ':' + inst.uid + ':' + (inst.tier || 0) : '';
        if (s.id !== id) {
          s.id = id;
          paintItem(s.cv, inst && inst.def);
          s.el.classList.toggle('empty', !inst);
          s.sf.style.setProperty('--bc', inst ? statColor(inst.def.stat) : '#2b2a45');
          const st = inst ? statList(inst.def.stat)[0] : null;
          s.sf.style.setProperty('--bg', st ? STAT_BG[st] : 'rgba(8, 7, 18, 0.6)');
          s.peak = 1; s.last = 0;
        }
        // cooldown
        let frac = 0, txt = '';
        if (inst && inst.cd > 0) {
          if (inst.cd > s.last + 0.02) s.peak = inst.cd;
          const tot = inst.cdMax || (inst.def.cooldown ? inst.def.cooldown * (p.cdMul || 1) : s.peak);
          frac = Math.max(0, Math.min(1, inst.cd / Math.max(0.01, tot)));
          if (inst.cd >= 1) txt = String(Math.ceil(inst.cd));
        }
        s.last = inst ? inst.cd || 0 : 0;
        const fq = Math.ceil(frac * 60) / 60;
        if (fq !== s.cdF) {
          if (fq === 0 && s.cdF > 0) s.el.classList.add('ready');
          this.setScale(s.cd, fq, 'Y');
          s.cdF = fq;
        }
        if (txt !== s.cdT) { s.cdt.textContent = txt; s.cdT = txt; }
        const am = inst ? (inst.ammo != null ? inst.ammo : inst.charges != null ? inst.charges : '') : '';
        if (am !== s.am) { s.ammo.textContent = am; s.am = am; }
        if (devChanged) this.keyLabel(s.key, s.btn, dev);
      }
    },

    updateStats(p) {
      const st = p.stats || {};
      for (const k in this.statEls) {
        const v = st[k] || 1;
        const old = this.c.stats[k];
        if (v !== old) {
          this.statEls[k].textContent = v;
          if (old != null && v > old) this.statEls[k].classList.add('pop');
          this.c.stats[k] = v;
        }
      }
    },

    updateMuts(p) {
      const list = p.mutations || [];
      this.c.mutN = list.length; this.c.mutLast = list[list.length - 1];
      this.mutsEl.innerHTML = '';
      for (const m of list) {
        const d = document.createElement('div');
        d.className = 'h-mut cf';
        const st = m && (m.stat || (m.def && m.def.stat));
        d.style.setProperty('--bc', st ? statColor(st) : '#9b5cff');
        d.title = mutName(m);
        const cv = document.createElement('canvas');
        cv.width = cv.height = 16; cv.className = 'px';
        paintMutation(cv, m);
        d.appendChild(cv);
        this.mutsEl.appendChild(d);
      }
    },

    updateRight(world, p, devChanged) {
      const c = this.c;
      const tt = fmtTime(G.game ? G.game.runTime : 0);
      if (tt !== c.time) { this.timeEl.textContent = tt; c.time = tt; }
      const seed = G.game ? G.game.seed : 0;
      if (seed !== c.seed) { this.seedEl.textContent = 'Seed: ' + seed; c.seed = seed; }
      const cells = p.cells | 0, gold = p.gold | 0;
      if (cells !== c.cells) { this.bumpCur(this.cellsEl, this.cellsTxt, cells, c.cells); c.cells = cells; }
      if (gold !== c.gold) { this.bumpCur(this.goldEl, this.goldTxt, gold, c.gold); c.gold = gold; }
      if (devChanged) this.mapKey.textContent = c.dev === 'touch' ? '' : G.input.label('map');
    },

    bumpCur(el, txt, v, old) {
      txt.textContent = v;
      if (old == null) return;
      el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
      if (v > old) {
        const g = document.createElement('span');
        g.className = 'h-gain'; g.textContent = '+' + (v - old);
        el.appendChild(g);
        setTimeout(() => g.remove(), 950);
      }
    },

    // ---------------------------------------------------------------- minimap
    updateMap(world, p) {
      const m = this.map;
      if (!m) return;
      let changed = false;
      if (this.frame % 6 === 1 || m.n === 0) changed = scanMapTex(m) > 0;
      if (this.frame % 20 === 1) this.collectMarks(world);
      const ptx = Math.floor(p.cx / 4), pty = Math.floor(p.cy / 4);
      const blink = Math.floor(this.t * 3) % 2;
      const key = ptx + ',' + pty + ',' + blink + ',' + this.marks.length;
      if (!changed && key === this.c.mapKey) return;
      this.c.mapKey = key;
      this.drawMapView(this.mapCtx, this.mapCv.width, this.mapCv.height, world, { scale: 1, center: true, blink });
    },

    collectMarks(world) {
      const out = [];
      for (const o of world.objects) { const k = objKind(o); if (k) out.push({ o, k }); }
      if (world.boss && !world.boss.dead) out.push({ o: world.boss, k: 'boss' });
      this.marks = out;
    },

    // Renders the explored map into ctx (vw×vh backing px).
    // opts.center: follow the player at opts.scale; otherwise fit the whole level.
    drawMapView(ctx, vw, vh, world, opts = {}) {
      const m = this.map;
      ctx.clearRect(0, 0, vw, vh);
      if (!m || !world) return null;
      if (m.n === 0) scanMapTex(m);
      const p = world.player, tex = m.tex;
      let s = opts.scale || 1, ox, oy;
      if (opts.center) {
        const px = (p.cx / TS) * MK * s, py = (p.cy / TS) * MK * s;
        const tw = tex.width * s, th = tex.height * s;
        ox = tw <= vw ? (tw - vw) / 2 : G.clamp(px - vw / 2, 0, tw - vw);
        oy = th <= vh ? (th - vh) / 2 : G.clamp(py - vh / 2, 0, th - vh);
      } else {
        s = Math.min(vw / tex.width, vh / tex.height);
        if (s >= 1) s = Math.floor(s);
        ox = (tex.width * s - vw) / 2; oy = (tex.height * s - vh) / 2;
      }
      ox = Math.round(ox); oy = Math.round(oy);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tex, -ox, -oy, Math.round(tex.width * s), Math.round(tex.height * s));
      const L = m.level;
      const ms = opts.center ? 1.5 : 2;
      const toX = (wx) => (wx / TS) * MK * s - ox, toY = (wy) => (wy / TS) * MK * s - oy;
      for (const { o, k } of this.marks) {
        const tx = Math.floor(o.cx / TS), ty = Math.floor((o.y + o.h - 1) / TS);
        if (k !== 'boss' && !(L.explored && L.explored[ty * L.w + tx])) continue;
        const x = toX(o.cx), y = toY(o.y + o.h);
        if (x < -10 || y < -10 || x > vw + 10 || y > vh + 10) continue;
        drawMarker(ctx, k, x, y, ms, o, opts.blink);
      }
      // player
      const x = Math.round(toX(p.cx)), y = Math.round(toY(p.y + p.h));
      const ps = 2;
      ctx.fillStyle = '#05040a'; ctx.fillRect(x - 2 * ps, y - 6 * ps, 5 * ps, 7 * ps);
      ctx.fillStyle = opts.blink ? '#ffffff' : '#27f3ff'; ctx.fillRect(x - 1 * ps, y - 5 * ps, 3 * ps, 5 * ps);
      ctx.fillStyle = '#ff2a8a'; ctx.fillRect(x - 1 * ps, y - 5 * ps, 3 * ps, 1 * ps);
      return { s, ox, oy };
    },

    // ---------------------------------------------------------------- boss bar
    updateBoss(world, dt) {
      // world.boss (boss.js); fallback: an enemy flagged isBoss (game.js stub boss)
      if (!world.boss && this.frame % 30 === 1) this._fbBoss = world.enemies ? world.enemies.find((e) => e.isBoss && !e.dead) || null : null;
      const b = world.boss || (this._fbBoss && !this._fbBoss.dead ? this._fbBoss : null) || (this.c.boss && this.c.boss.isBoss ? this.c.boss : null);
      const alive = b && !b.dead && (b.hp > 0 || !b.dying);
      const c = this.c;
      if (b && b !== c.boss) {
        c.boss = b; c.bossF = -1; this.bossTrail_ = 1; this.bossHold = 0;
        this.bossName.textContent = b.bossName || b.name || 'Страж ядра';
        this.bossEl.hidden = false; this.bossEl.classList.remove('gone');
        clearTimeout(this._bossT);
      }
      if (!b && c.boss) { c.boss = null; this.hideBoss(); return; }
      if (!b || c.bossGone === b) return;
      const f = alive ? Math.max(0, Math.min(1, b.hp / Math.max(1, b.maxHp))) : 0;
      if (f < c.bossF - 0.0005) {
        this.bossHold = 0;
        this.bossEl.classList.remove('hit'); void this.bossEl.offsetWidth; this.bossEl.classList.add('hit');
      }
      if (f < this.bossTrail_) { this.bossHold += dt; if (this.bossHold > 0.45) this.bossTrail_ = Math.max(f, this.bossTrail_ - dt * 0.6); } else this.bossTrail_ = f;
      if (Math.abs(f - c.bossF) > 0.0005) { this.setScale(this.bossFill, f); c.bossF = f; }
      const tr = Math.max(f, this.bossTrail_);
      if (Math.abs(tr - c.bossTr) > 0.001) { this.setScale(this.bossTrail, tr); c.bossTr = tr; }
      if (!alive) { c.bossGone = b; this.hideBoss(); }
    },
    hideBoss() {
      this.bossEl.classList.add('gone');
      clearTimeout(this._bossT);
      this._bossT = setTimeout(() => { this.bossEl.hidden = true; }, 900);
    },

    // ---------------------------------------------------------------- interaction prompt / item card
    updateFocus(world, p, dev, devChanged) {
      const o = p.state !== 'dead' ? p.focus : null;
      const c = this.c;
      if (!o) {
        if (c.focus) { this.pa.hidden = true; this.ca.hidden = true; c.focus = null; c.focusKey = ''; }
        return;
      }
      const cam = world.cam;
      const isItem = !!o.inst;
      let key;
      if (isItem) {
        const inst = o.inst, slot = p.slotFor ? p.slotFor(inst) : null, old = slot ? p.slots[slot] : null;
        key = 'i|' + inst.uid + '|' + inst.id + '|' + slot + '|' + (old ? old.uid : '') + '|' + (o.price || 0) + '|' + (p.gold >= (o.price || 0)) + '|' + dev;
        if (key !== c.focusKey || o !== c.focus) {
          this.buildCard(o, inst, slot, old, p, dev);
          this.ca.hidden = false; this.pa.hidden = true;
          c.focusKey = key; c.focus = o; c.px = null;
          this.cardH = this.cardEl.offsetHeight / this.ppg;
          this.cardW = this.cardEl.offsetWidth / this.ppg;
        }
      } else {
        const txt = typeof o.prompt === 'function' ? o.prompt() : o.prompt || 'Использовать';
        key = 'p|' + txt + '|' + dev;
        if (key !== c.focusKey || o !== c.focus) {
          this.promptTxt.textContent = txt;
          this.keyLabel(this.promptKey, 'interact', dev);
          this.pa.hidden = false; this.ca.hidden = true;
          c.focusKey = key; c.focus = o; c.px = null;
          this.cardH = this.promptEl.offsetHeight / this.ppg;
          this.cardW = this.promptEl.offsetWidth / this.ppg;
        }
      }
      // anchor above the object (game px), clamped to the screen
      const sx = o.cx - cam.x, sy = o.y - cam.y;
      const W = this.cardW || 100, H = this.cardH || 20;
      const touch = dev === 'touch';
      const top = touch ? 50 : 4, bot = touch ? G.H - 4 : G.H - 72; // keep clear of the HUD bands
      let x = sx - W / 2, y = sy - H - (isItem ? 10 : 8);
      if (y < top) { // no room above: put it beside the object, on the side away from the player
        y = sy + (o.h || 16) / 2 - H / 2;
        const left = p.cx > o.cx;
        x = left ? sx - 16 - W : sx + 16;
        if (x < 4 || x + W > G.W - 4) x = left ? sx + 16 : sx - 16 - W;
      }
      x = Math.round(G.clamp(x, 4, G.W - W - 4));
      y = Math.round(G.clamp(y, top, Math.max(top, bot - H)));
      if (x !== c.px || y !== c.py) {
        (isItem ? this.ca : this.pa).style.transform = `translate(${(x * this.ppg).toFixed(1)}px, ${(y * this.ppg).toFixed(1)}px)`;
        c.px = x; c.py = y;
      }
    },

    buildCard(o, inst, slot, old, p, dev) {
      const def = inst.def;
      const q = qualityClass(inst);
      const stats = statList(def.stat);
      const sc = statColor(def.stat);
      const glow = stats.length ? G.STAT_COLOR[stats[0]] + '33' : 'rgba(39,243,255,0.18)';
      const chips = stats.map((s) => `<span class="chip" style="--chip:${G.STAT_COLOR[s]}">${STAT_NAME[s] || s}</span>`).join('');
      const aff = (inst.affixes || []).map((a) => a && (a.text || a.name || a.desc)).filter(Boolean);
      const key = dev === 'touch' ? '' : G.input.label('interact');
      let cmp = '';
      if (slot) {
        const sk = dev === 'touch' ? '' : G.input.label((G.SLOT_BUTTONS.find((s) => s[0] === slot) || [])[1] || '');
        if (old) {
          const dt = (inst.tier || 0) - (old.tier || 0);
          const arrow = dt > 0 ? `<span class="up"><i class="ar u"></i>${dt}</span>` : dt < 0 ? `<span class="dn"><i class="ar d"></i>${-dt}</span>` : '';
          cmp = `<div class="hc-cmp"><span>Заменит${sk ? ' [' + esc(sk) + ']' : ''}:</span><canvas class="px cmpi" width="24" height="24"></canvas><span class="nm ${qualityClass(old)}">${esc(G.itemName(old))}</span>${arrow}</div>`;
        } else {
          cmp = `<div class="hc-cmp"><span>Свободный слот:</span><span class="nm">${SLOT_NAME[slot] || slot}${sk ? ' [' + esc(sk) + ']' : ''}</span></div>`;
        }
      }
      let hint = '';
      if (old && def.kind !== 'skill' && p.slots.primary && p.slots.secondary) hint = dev === 'touch' ? 'Джойстик вниз — во второй слот' : 'Удерживайте «вниз» — во второй слот';
      else if (old && def.kind === 'skill' && p.slots.skill1 && p.slots.skill2) hint = dev === 'touch' ? 'Джойстик вниз — во второй навык' : 'Удерживайте «вниз» — во второй навык';
      const price = o.price ? `<span class="hc-price ${p.gold < o.price ? 'no' : ''}">${o.price}${img('gold')}</span>` : '<span></span>';
      const verb = o.price ? 'Купить' : 'Взять';
      this.cardEl.className = 'h-card cf' + (inst.quality === 'legendary' ? ' q-legendary-card' : '');
      this.cardEl.style.setProperty('--bc', sc);
      this.cardEl.style.setProperty('--glow', glow);
      this.cardEl.innerHTML = `
        <div class="hc-head"><div class="hc-icon cf" style="--bc:${sc}"><canvas class="px" width="24" height="24"></canvas></div>
          <div><div class="hc-name ${q}">${esc(def.name)}${inst.tier > 0 ? `<span class="hc-tier">+${inst.tier}</span>` : ''}</div>
          <div class="hc-meta"><span>${KIND_NAME[def.kind] || ''}</span>${chips}${def.cooldown ? `<span>${def.cooldown} с</span>` : ''}</div></div></div>
        ${def.desc ? `<div class="hc-desc">${esc(def.desc)}</div>` : ''}
        ${aff.length ? `<div class="hc-aff">${aff.map((t) => `<div>${esc(t)}</div>`).join('')}</div>` : ''}
        ${cmp}${hint ? `<div class="hc-hint">${hint}</div>` : ''}
        <div class="hc-foot"><span class="hc-act">${key ? `<span class="h-key">${esc(key)}</span>` : ''}${verb}</span>${price}</div>`;
      paintItem(this.cardEl.querySelector('.hc-icon canvas'), def);
      const ci = this.cardEl.querySelector('.cmpi');
      if (ci && old) paintItem(ci, old.def);
    },

    // ---------------------------------------------------------------- toasts
    toasts: [],
    toast(o) {
      if (!this.toastsEl) return;
      const d = document.createElement('div');
      d.className = 'h-toast cf' + (o.big ? ' big' : '');
      d.style.setProperty('--bc', o.color || 'var(--cyan)');
      let ic = '';
      if (o.icon) ic = img(o.icon);
      d.innerHTML = `${ic}<div class="tt">${o.sub ? `<small>${esc(o.sub)}</small>` : ''}<span style="${o.textColor ? 'color:' + o.textColor : ''}" class="${o.cls || ''}">${esc(o.text)}</span></div>`;
      if (o.item) {
        const cv = document.createElement('canvas');
        cv.width = cv.height = 24; cv.className = 'px';
        paintItem(cv, o.item);
        d.insertBefore(cv, d.firstChild);
      } else if (o.mutation) {
        const cv = document.createElement('canvas');
        cv.width = cv.height = 16; cv.className = 'px';
        paintMutation(cv, o.mutation);
        d.insertBefore(cv, d.firstChild);
      }
      this.toastsEl.appendChild(d);
      this.toasts.push({ el: d, t: 0, life: o.life || 3 });
      while (this.toasts.length > 4) { const x = this.toasts.shift(); x.el.remove(); }
    },
    updateToasts(dt) {
      for (let i = this.toasts.length - 1; i >= 0; i--) {
        const x = this.toasts[i];
        x.t += dt;
        if (x.t > x.life && !x.out) { x.out = true; x.el.classList.add('out'); }
        if (x.t > x.life + 0.4) { x.el.remove(); this.toasts.splice(i, 1); }
      }
    },
    clearToasts() { for (const x of this.toasts) x.el.remove(); this.toasts = []; },

    bindEvents() {
      G.on('pickup', (e) => {
        if (!e || e.kind !== 'item' || !e.inst) return;
        const inst = e.inst;
        const st = statList(inst.def.stat)[0];
        this.toast({ item: inst.def, text: G.itemName(inst), sub: 'Получено', color: statColor(inst.def.stat), cls: qualityClass(inst), textColor: st ? null : null });
      });
      G.on('scroll', (e) => {
        const st = e && e.stat;
        if (!st) return;
        this.toast({ icon: 'chip', text: `${STAT_NAME[st] || st} +1`, sub: 'Чип усиления', color: G.STAT_COLOR[st], textColor: G.STAT_COLOR[st] });
      });
      G.on('mutation', (e) => {
        const m = (e && (e.mutation || e.m || e.def)) || e;
        this.toast({ mutation: m, text: mutName(m), sub: 'Имплант установлен', color: 'var(--violet)' });
      });
      G.on('blueprint', (e) => {
        const def = e && (e.def || (e.id && G.ITEMS[e.id]));
        this.toast({ item: def || null, icon: def ? null : 'chip', text: def ? def.name : 'Чертёж', sub: 'Найден чертёж', color: 'var(--cells)' });
      });
      G.on('unlock', (e) => {
        const def = e && (e.def || (e.id && G.ITEMS[e.id]));
        if (def) this.toast({ item: def, text: def.name, sub: 'Чертёж разблокирован', color: 'var(--cells)' });
      });
      G.on('bossStart', (e) => {
        const b = (e && (e.boss || e)) || (G.world && G.world.boss);
        const name = (b && (b.bossName || b.name)) || (G.world && G.world.boss && G.world.boss.bossName) || 'Страж ядра';
        this.toast({ icon: 'skull', text: name, sub: 'Угроза обнаружена', color: 'var(--magenta)', big: true, life: 3.5 });
      });
      G.on('bossDefeated', () => this.toast({ icon: 'skull', text: 'Страж уничтожен', sub: 'Выход разблокирован', color: 'var(--cyan)', big: true, life: 4 }));
      G.on('denied', (e) => {
        const s = e && e.slot && this.slots && this.slots[e.slot];
        if (s) { s.el.classList.remove('denied'); void s.el.offsetWidth; s.el.classList.add('denied'); }
      });
      G.on('runStart', () => { this.clearToasts(); this.reset(); });
    },
  };
  G.hud = hud;
})();
