'use strict';
// Menus & overlays: title (animated city backdrop), controls, settings, pause, death, victory,
// level banner, stat choice, collector, big map. Every screen is operable by mouse/touch AND
// keyboard/gamepad (spatial focus navigation driven from G.ui.update, called every fixed step).
(function () {
  const G = window.G;
  const H = () => G.hud;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sfx = (name, vol = 0.5) => { try { if (G.audio && G.audio.play) G.audio.play(name, { vol }); } catch (e) { /* audio optional */ } };
  const img = (name) => (H() && H().img ? H().img(name) : '');
  const fmt = (t) => (H() ? H().fmtTime(t) : Math.floor(t) + 's');
  const STAT_NAME = { brutality: 'Жестокость', tactics: 'Тактика', survival: 'Живучесть' };
  const STAT_K = { brutality: 'k-b', tactics: 'k-t', survival: 'k-s' };
  const STAT_WORD = { brutality: 'красного', tactics: 'фиолетового', survival: 'зелёного' };
  const STAT_HP = { brutality: 14, tactics: 14, survival: 32 };
  const mk = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const itemCanvas = (def, size = 24) => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size; cv.className = 'px';
    if (def && H()) H().paintItem(cv, def);
    return cv;
  };
  const statList = (s) => (Array.isArray(s) ? s : s ? [s] : []);
  const statColor = (s) => (H() ? H().statColor(s) : '#45466a');

  const ui = {
    el: null, layer: null, stack: [], t: 0, rep: {}, lastDev: null, bn: null,

    init() {
      this.el = document.getElementById('ui');
      this.el.innerHTML = '<div class="layer"></div><div class="banner" hidden></div>';
      this.layer = this.el.querySelector('.layer');
      this.bannerEl = this.el.querySelector('.banner');
      // we manage focus ourselves: keep native focus off buttons (prevents double activation by Enter/Space)
      this.el.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
      this.el.addEventListener('click', () => { const a = document.activeElement; if (a && a !== document.body && a.blur) a.blur(); }, true);
      this.applySettings(false);
    },

    // ---------------------------------------------------------------- screen stack & focus navigation
    top() { return this.stack[this.stack.length - 1] || null; },
    isModalOpen() { return this.stack.some((s) => s.modal); },
    push(sc) {
      const top = this.top();
      if (top && !sc.overlay) top.el.hidden = true;
      this.stack.push(sc);
      this.layer.appendChild(sc.el);
      this.el.classList.add('has-screen');
      sc.el.addEventListener('mousemove', (e) => {
        const it = e.target.closest && e.target.closest('[data-nav]');
        if (it && it !== sc.focus && sc.el.contains(it) && !it.disabled) this.setFocus(sc, it, false);
      });
      this.setFocus(sc, sc.el.querySelector('[data-focus]') || this.items(sc)[0], false);
      this.refreshHint(sc, true);
      return sc;
    },
    pop(sc) {
      sc = sc || this.top();
      const i = this.stack.indexOf(sc);
      if (i < 0) return;
      this.stack.splice(i, 1);
      sc.el.remove();
      if (sc.onClose) sc.onClose();
      const top = this.top();
      if (top) { top.el.hidden = false; this.refreshHint(top, true); }
      else this.el.classList.remove('has-screen');
    },
    closeKind(kind) { for (const s of this.stack.slice()) if (s.kind === kind || s.group === kind) this.pop(s); },
    hideAll() {
      for (const s of this.stack.slice().reverse()) { s.el.remove(); if (s.onClose) s.onClose(); }
      this.stack = [];
      if (this.el) this.el.classList.remove('has-screen');
    },
    items(sc) { return Array.from(sc.el.querySelectorAll('[data-nav]')).filter((e) => !e.disabled && e.offsetParent !== null); },
    setFocus(sc, el, auto) {
      if (sc.focus === el) return;
      if (sc.focus) sc.focus.classList.remove('focus');
      sc.focus = el || null;
      if (!el) return;
      el.classList.add('focus');
      if (auto && el.dataset.auto != null) el.click();
      const sp = el.closest('.coll-body');
      if (sp) {
        const r = el.getBoundingClientRect(), pr = sp.getBoundingClientRect();
        if (r.top < pr.top) sp.scrollTop -= pr.top - r.top + 4;
        else if (r.bottom > pr.bottom) sp.scrollTop += r.bottom - pr.bottom + 4;
      }
    },
    nav(sc, dir) {
      let f = sc.focus;
      if (f && !sc.el.contains(f)) f = sc.focus = null;
      const list = this.items(sc);
      if (!list.length) return;
      if (!f) { this.setFocus(sc, list[0], true); return; }
      if (f.dataset.slider && (dir === 'left' || dir === 'right')) { this.adjustSlider(f, dir === 'left' ? -0.1 : 0.1); return; }
      if (f.dataset.toggle && (dir === 'left' || dir === 'right')) { f.click(); return; }
      if (sc.onNav && sc.onNav(dir)) return;
      const r0 = f.getBoundingClientRect();
      const x0 = r0.left + r0.width / 2, y0 = r0.top + r0.height / 2;
      // score by edge gaps: rows spanning the current item's column win over far-away centered items
      const gapX = (r) => Math.max(0, r.left - r0.right, r0.left - r.right);
      const gapY = (r) => Math.max(0, r.top - r0.bottom, r0.top - r.bottom);
      let best = null, bs = Infinity;
      for (const e of list) {
        if (e === f) continue;
        const r = e.getBoundingClientRect();
        const dx = r.left + r.width / 2 - x0, dy = r.top + r.height / 2 - y0;
        let s;
        if (dir === 'down') { if (dy <= 3 || r.bottom <= r0.bottom) continue; s = gapY(r) + gapX(r) * 3 + Math.abs(dx) * 0.05; }
        else if (dir === 'up') { if (dy >= -3 || r.top >= r0.top) continue; s = gapY(r) + gapX(r) * 3 + Math.abs(dx) * 0.05; }
        else if (dir === 'right') { if (dx <= 3 || r.right <= r0.right) continue; s = gapX(r) + gapY(r) * 3 + Math.abs(dy) * 0.05; }
        else { if (dx >= -3 || r.left >= r0.left) continue; s = gapX(r) + gapY(r) * 3 + Math.abs(dy) * 0.05; }
        if (e.classList.contains('on')) s -= 6; // prefer the active tab
        if (s < bs) { bs = s; best = e; }
      }
      if (!best && (dir === 'up' || dir === 'down')) {
        // wrap vertically (menus): take the extreme item nearest in x
        let ext = null, ev = 0;
        for (const e of list) {
          const r = e.getBoundingClientRect();
          const v = (dir === 'down' ? -1 : 1) * (r.top + r.height / 2) * 10 - Math.abs(r.left + r.width / 2 - x0);
          if (e !== f && (ext === null || v > ev)) { ext = e; ev = v; }
        }
        best = ext;
      }
      if (best) { this.setFocus(sc, best, true); sfx('uiMove', 0.35); }
    },
    activate(sc) {
      const f = sc.focus;
      if (!f || f.disabled || !sc.el.contains(f)) return;
      if (f.dataset.slider) return;
      f.click();
    },
    consumeConfirm() { const I = G.input; I.consume('confirm'); I.consume('jump'); I.consume('attack1'); },
    consumeBack() { const I = G.input; I.consume('back'); I.consume('pause'); I.consume('interact'); },

    hintText() {
      const d = G.input.device;
      if (d === 'pad') return 'Крестовина — выбор · A — подтвердить · B — назад';
      return 'Стрелки / WASD — выбор · Enter / J — подтвердить · Esc — назад';
    },
    refreshHint(sc, force) {
      const dev = G.input.device;
      if (!force && dev === this.lastDev) return;
      this.lastDev = dev;
      const h = sc && sc.el.querySelector('.hint');
      if (h) h.innerHTML = this.hintText();
    },

    // called every fixed step (also while paused)
    update(dt) {
      this.t += dt;
      this.updateBanner(dt);
      const I = G.input;
      const sc = this.top();
      if (!sc) {
        if (G.game && G.game.state === 'play' && !G.game.paused && G.world && I.pressed('map')) { I.consume('map'); this.openMap(); }
        return;
      }
      this.refreshHint(sc, false);
      if (sc.update) sc.update(dt);
      if (sc !== this.top()) return;
      for (const d of ['up', 'down', 'left', 'right']) {
        if (I.pressed(d)) { this.nav(sc, d); this.rep[d] = 0.36; }
        else if (I.down(d)) { this.rep[d] = (this.rep[d] || 0.36) - dt; if (this.rep[d] <= 0) { this.nav(sc, d); this.rep[d] = 0.085; } }
      }
      if (sc.kind === 'map' && (I.pressed('map') || I.pressed('back') || I.pressed('confirm'))) { this.consumeBack(); this.consumeConfirm(); I.consume('map'); this.closeMap(); return; }
      if (I.pressed('confirm')) { this.consumeConfirm(); this.activate(sc); sfx('uiSelect', 0.45); }
      else if (I.pressed('back')) { this.consumeBack(); if (sc.onBack) { sc.onBack(); sfx('uiBack', 0.4); } }
    },

    // ---------------------------------------------------------------- settings helpers
    applySettings(save) {
      const S = G.settings;
      const st = document.getElementById('stage');
      if (st) st.classList.toggle('no-scanlines', S.scanlines === false);
      if (save) { try { G.saveSettings(); } catch (e) { /* storage */ } }
      try { if (G.audio && G.audio.setVolumes) G.audio.setVolumes({ music: S.music, sfx: S.sfx }); } catch (e) { /* audio optional */ }
    },
    adjustSlider(el, d) {
      const k = el.dataset.slider;
      const v = Math.round(G.clamp((G.settings[k] == null ? 0.7 : G.settings[k]) + d, 0, 1) * 10) / 10;
      G.settings[k] = v;
      this.paintSlider(el);
      this.applySettings(true);
      if (k === 'sfx') sfx('uiMove', 0.6);
    },
    paintSlider(el) {
      const v = G.settings[el.dataset.slider];
      const pct = Math.round((v == null ? 0.7 : v) * 100);
      el.querySelector('.trk i').style.width = pct + '%';
      el.querySelector('.trk b').style.left = pct + '%';
      el.querySelector('.val').textContent = pct + '%';
    },
    toggleFullscreen() {
      const d = document, el = d.documentElement;
      try {
        if (d.fullscreenElement || d.webkitFullscreenElement) { (d.exitFullscreen || d.webkitExitFullscreen).call(d); return true; }
        const req = el.requestFullscreen || el.webkitRequestFullscreen;
        if (!req) return false;
        const r = req.call(el, { navigationUI: 'hide' });
        const lock = () => { try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {}); } catch (e) { /* unsupported */ } };
        if (r && r.then) r.then(lock).catch(() => {}); else lock();
        return true;
      } catch (e) { return false; }
    },

    // ---------------------------------------------------------------- TITLE
    showTitle(onStart) {
      this.hideAll();
      this.clearBanner();
      const m = G.meta || {};
      const best = m.bestTime ? fmt(m.bestTime) : '—';
      const el = mk(`<div class="scr title enter">
        <div class="t-logo"><div class="glitch jitter" data-text="DEAD CIRCUITS">DEAD CIRCUITS</div><div class="t-sub">Нейро-рогалик</div></div>
        <div class="t-menu">
          <button class="mbtn cf primary" data-nav data-focus data-a="play">Играть</button>
          <button class="mbtn cf" data-nav data-a="controls">Управление</button>
          <button class="mbtn cf" data-nav data-a="settings">Настройки</button>
        </div>
        <div class="t-meta cf"><span>Забеги<b>${m.runs || 0}</b></span><span>Победы<b>${m.wins || 0}</b></span><span>Рекорд<b>${best}</b></span><span>Уничтожено<b>${m.kills || 0}</b></span>${(m.unlocked || []).length ? `<span>Чертежи<b>${m.unlocked.length}</b></span>` : ''}</div>
        <div class="hint"></div><div class="t-ver">v${esc(G.VERSION || '1.0')}</div></div>`);
      const sc = this.push({ el, kind: 'title' });
      el.querySelector('[data-a=play]').onclick = () => { sfx('uiSelect', 0.6); this.hideAll(); onStart(); };
      el.querySelector('[data-a=controls]').onclick = () => this.showControls();
      el.querySelector('[data-a=settings]').onclick = () => this.showSettings();
      return sc;
    },

    // ---------------------------------------------------------------- CONTROLS
    showControls(group) {
      const dev = G.input.device === 'pad' ? 'pad' : G.input.device === 'touch' || document.body.classList.contains('touch-mode') ? 'touch' : 'kb';
      const el = mk(`<div class="scr dim enter"><div class="win cf">
        <div class="win-h"><div class="ttl cy">Управление</div>
          <div class="tabs"><button class="tab cf" data-nav data-auto data-t="kb">Клавиатура</button><button class="tab cf" data-nav data-auto data-t="pad">Геймпад</button><button class="tab cf" data-nav data-auto data-t="touch">Сенсор</button></div></div>
        <div class="ctl"></div><div class="ctl-note"></div>
        <div class="rowf"><button class="mbtn cf small" data-nav data-a="back">Назад</button></div></div><div class="hint"></div></div>`);
      const AR = { '←': 'l', '→': 'r', '↑': 'u', '↓': 'd' };
      const K = (...a) => a.map((k) => `<kbd>${AR[k] ? `<i class="ar ${AR[k]}"></i>` : esc(k)}</kbd>`).join('');
      const TX = (s) => `<kbd class="t">${esc(s)}</kbd>`;
      const ROWS = {
        kb: [['Движение', K('A', 'D') + K('←', '→')], ['Прыжок / двойной', K('SPACE')], ['Кувырок', K('SHIFT') + K('L')], ['Основное оружие', K('J') + TX('ЛКМ')],
          ['Второе оружие / щит', K('K') + TX('ПКМ')], ['Навыки', K('Q') + K('E')], ['Аптечка', K('R')], ['Взаимодействие', K('F')],
          ['Лестница', K('W') + K('S')], ['Спрыгнуть вниз', K('S') + '+' + K('SPACE')], ['Удар о землю', TX('в воздухе') + K('S') + '+' + K('SPACE')], ['Карта', K('M') + K('TAB')], ['Пауза', K('ESC') + K('P')]],
        pad: [['Движение', TX('Л. стик') + TX('Крестовина')], ['Прыжок / двойной', K('A')], ['Кувырок', K('RB')], ['Основное оружие', K('X')],
          ['Второе оружие / щит', K('Y')], ['Навыки', K('LT') + K('RT')], ['Аптечка', K('LB')], ['Взаимодействие', K('B')],
          ['Лестница', K('↑') + K('↓')], ['Спрыгнуть вниз', K('↓') + '+' + K('A')], ['Удар о землю', TX('в воздухе') + K('↓') + '+' + K('A')], ['Карта', K('SELECT')], ['Пауза', K('START')]],
        touch: [['Движение', TX('джойстик слева')], ['Прыжок', TX('кнопка прыжка')], ['Кувырок', TX('кнопка кувырка')], ['Основное оружие', TX('большая кнопка')],
          ['Второе оружие', TX('кнопка над ней')], ['Навыки', TX('малые кнопки')], ['Аптечка', TX('зелёная кнопка')], ['Взаимодействие', TX('появляется у объекта')],
          ['Спрыгнуть вниз', TX('джойстик вниз + прыжок')], ['Удар о землю', TX('в воздухе: вниз + прыжок')], ['Карта', TX('миникарта')], ['Пауза', TX('кнопка II')]],
      };
      const NOTE = {
        kb: 'Кувырок даёт неуязвимость. Урон, полученный недавно, можно вернуть атаками (оранжевая часть полосы здоровья).',
        pad: 'Поддерживается стандартная раскладка Xbox / PlayStation. Кувырок даёт неуязвимость.',
        touch: 'Джойстик появляется там, где вы касаетесь левой половины экрана. Можно скользить пальцем между кнопками атаки.',
      };
      const ctl = el.querySelector('.ctl'), note = el.querySelector('.ctl-note');
      const setTab = (t) => {
        el.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
        ctl.innerHTML = ROWS[t].map(([a, k]) => `<div><span>${a}</span><span>${k}</span></div>`).join('');
        note.textContent = NOTE[t];
      };
      el.querySelectorAll('.tab').forEach((b) => (b.onclick = () => setTab(b.dataset.t)));
      setTab(dev);
      el.querySelector(`.tab[data-t=${dev}]`).setAttribute('data-focus', '');
      const sc = { el, kind: 'controls', group, onBack: () => this.pop(sc) };
      el.querySelector('[data-a=back]').onclick = () => this.pop(sc);
      return this.push(sc);
    },

    // ---------------------------------------------------------------- SETTINGS
    showSettings(group) {
      const S = G.settings;
      const el = mk(`<div class="scr dim enter"><div class="win cf">
        <div class="win-h"><div class="ttl cy">Настройки</div></div>
        <div class="set">
          <div class="row cf" data-nav data-focus data-slider="music"><span>Музыка</span><span class="slider"><span class="trk"><i></i><b></b></span><span class="val"></span></span></div>
          <div class="row cf" data-nav data-slider="sfx"><span>Звуки</span><span class="slider"><span class="trk"><i></i><b></b></span><span class="val"></span></span></div>
          <button class="row cf" data-nav data-toggle="shake"><span>Тряска экрана</span><span class="val"></span></button>
          <button class="row cf" data-nav data-toggle="scanlines"><span>Скан-линии</span><span class="val"></span></button>
          <button class="row cf" data-nav data-a="fs"><span>Полный экран</span><span class="val">&gt;</span></button>
        </div>
        <div class="rowf"><button class="mbtn cf small" data-nav data-a="back">Назад</button></div></div><div class="hint"></div></div>`);
      const paintT = (b) => { const on = S[b.dataset.toggle] !== false; const v = b.querySelector('.val'); v.textContent = on ? 'ВКЛ' : 'ВЫКЛ'; v.classList.toggle('off', !on); };
      el.querySelectorAll('[data-slider]').forEach((r) => {
        this.paintSlider(r);
        const trk = r.querySelector('.trk');
        const setFrom = (e) => {
          const b = trk.getBoundingClientRect();
          G.settings[r.dataset.slider] = Math.round(G.clamp((e.clientX - b.left) / b.width, 0, 1) * 20) / 20;
          this.paintSlider(r); this.applySettings(true);
        };
        r.addEventListener('pointerdown', (e) => {
          const b = trk.getBoundingClientRect();
          if (e.clientX < b.left - 12 || e.clientX > b.right + 12) { this.adjustSlider(r, e.clientX < b.left ? -0.1 : 0.1); return; }
          try { r.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
          r._drag = true; setFrom(e);
        });
        r.addEventListener('pointermove', (e) => { if (r._drag) setFrom(e); });
        const end = () => { if (r._drag && r.dataset.slider === 'sfx') sfx('uiMove', 0.6); r._drag = false; };
        r.addEventListener('pointerup', end); r.addEventListener('pointercancel', end);
      });
      el.querySelectorAll('[data-toggle]').forEach((b) => {
        paintT(b);
        b.onclick = () => { S[b.dataset.toggle] = S[b.dataset.toggle] === false; paintT(b); this.applySettings(true); };
      });
      const fs = el.querySelector('[data-a=fs]');
      const fsVal = fs.querySelector('.val');
      const fsPaint = () => { fsVal.textContent = document.fullscreenElement || document.webkitFullscreenElement ? 'ВКЛ' : 'ВЫКЛ'; };
      fsPaint();
      fs.onclick = () => {
        const ok = this.toggleFullscreen();
        if (!ok) { fsVal.textContent = 'НЕДОСТУПНО'; fsVal.classList.add('off'); return; }
        setTimeout(fsPaint, 400);
      };
      const sc = { el, kind: 'settings', group, onBack: () => this.pop(sc) };
      el.querySelector('[data-a=back]').onclick = () => this.pop(sc);
      return this.push(sc);
    },

    // ---------------------------------------------------------------- PAUSE
    showPause(onResume, onQuit) {
      this.closeKind('pause');
      this.closeKind('map');
      const p = G.game && G.game.player;
      const g = G.game || {};
      const run = G.RUN && G.RUN[g.stage];
      const biome = run && G.BIOMES && G.BIOMES[run.biome];
      const stageName = run ? (run.kind === 'transit' ? 'Шлюз' : biome ? biome.name : run.biome) : '';
      const el = mk(`<div class="scr dim enter"><div class="pause-grid">
        <div class="pz-left"><div class="ttl cy glitch" data-text="ПАУЗА">ПАУЗА</div>
          <button class="mbtn cf primary" data-nav data-focus data-a="resume">Продолжить</button>
          <button class="mbtn cf" data-nav data-a="settings">Настройки</button>
          <button class="mbtn cf" data-nav data-a="controls">Управление</button>
          <button class="mbtn cf danger" data-nav data-a="quit">В меню</button></div>
        <div class="pz-build cf"></div></div><div class="hint"></div></div>`);
      const build = el.querySelector('.pz-build');
      if (p) {
        const st = p.stats || {};
        build.innerHTML = `<div class="pz-stats"><b class="sB">${st.brutality || 1}</b><b class="sT">${st.tactics || 1}</b><b class="sS">${st.survival || 1}</b>
          <span style="margin-left:auto;color:var(--survival);font-family:var(--font-pixel)">${Math.ceil(p.hp)} / ${p.maxHp}</span></div>`;
        for (const [slot] of G.SLOT_BUTTONS || []) {
          const inst = p.slots[slot];
          const row = mk(`<div class="pz-item"><div class="fr cf" style="--bc:${inst ? statColor(inst.def.stat) : '#2b2a45'}"></div>
            <div class="nm"><small>${H().SLOT_NAME[slot]}</small><span class="${inst ? H().qualityClass(inst) : ''}" style="${inst ? '' : 'color:var(--dim2)'}">${inst ? esc(G.itemName(inst)) : 'пусто'}</span></div></div>`);
          if (inst) row.querySelector('.fr').appendChild(itemCanvas(inst.def));
          build.appendChild(row);
        }
        if (p.mutations && p.mutations.length) {
          build.appendChild(mk(`<div class="pz-info"><span>Импланты: ${p.mutations.map((m) => esc(H().mutName(m))).join(', ')}</span></div>`));
        }
        build.appendChild(mk(`<div class="pz-info"><span>${esc(stageName)} · ${fmt(g.runTime || 0)}</span><span>Seed ${g.seed || ''}</span></div>`));
      } else build.hidden = true;
      const sc = { el, kind: 'pause', onBack: () => onResume() };
      el.querySelector('[data-a=resume]').onclick = () => onResume();
      el.querySelector('[data-a=settings]').onclick = () => this.showSettings('pause');
      el.querySelector('[data-a=controls]').onclick = () => this.showControls('pause');
      const q = el.querySelector('[data-a=quit]');
      q.onclick = () => {
        if (!q._armed) { q._armed = true; q.textContent = 'Точно? Забег сгорит'; return; }
        this.hideAll(); onQuit();
      };
      this.push(sc);
      sfx('uiOpen', 0.4);
      if (G.touch && G.touch.releaseAll) G.touch.releaseAll();
      return sc;
    },
    hidePause() { this.closeKind('pause'); },

    // ---------------------------------------------------------------- DEATH / VICTORY
    summaryHtml(sum, win) {
      sum = sum || {};
      const stage = sum.stage != null ? sum.stage : 0;
      const run = G.RUN && G.RUN[Math.min(stage, G.RUN.length - 1)];
      const stageName = run && run.kind === 'transit' ? 'Шлюз' : sum.stageName || (run ? run.biome : '—');
      const n = (v) => Math.round(v || 0);
      const cells = win ? `<div>${img('cells')}<span>Ядра</span><b class="cy">${n(sum.cells)}</b></div>` : `<div>${img('cells')}<span>Ядра потеряны</span><b class="bad">${n(sum.cells)}</b></div>`;
      return `<div class="sum cf">
        <div>${img('clock')}<span>Время</span><b>${fmt(sum.time || 0)}</b></div>
        <div>${img('skull')}<span>Уничтожено</span><b>${n(sum.kills)}</b></div>
        <div>${img('stage')}<span>Сектор</span><b style="font-family:var(--font-pixel);font-size:calc(var(--u)*8)">${esc(stageName)} ${stage + 1}/${G.RUN ? G.RUN.length : 7}</b></div>
        ${cells}
        <div>${img('blade')}<span>Урон нанесён</span><b>${n(sum.dmgDealt)}</b></div>
        <div>${img('heart')}<span>Урон получен</span><b>${n(sum.dmgTaken)}</b></div>
        <div>${img('gold')}<span>Кредиты</span><b class="gd">${n(sum.gold)}</b></div>
        <div>${img('chip')}<span>Чипы усиления</span><b>${n(sum.scrolls)}</b></div>
        <div class="build"></div></div>`;
    },
    fillBuild(el, sum) {
      const b = el.querySelector('.build');
      if (!b) return;
      const slots = (sum && sum.slots) || {};
      for (const [slot] of G.SLOT_BUTTONS || []) {
        const inst = slots[slot];
        const fr = mk(`<div class="fr cf" style="--bc:${inst ? statColor(inst.def.stat) : '#2b2a45'}" title="${inst ? esc(G.itemName(inst)) : ''}"></div>`);
        if (inst) fr.appendChild(itemCanvas(inst.def));
        b.appendChild(fr);
      }
      const st = (sum && sum.stats) || {};
      b.appendChild(mk(`<div class="pz-stats"><b class="sB">${st.brutality || 1}</b><b class="sT">${st.tactics || 1}</b><b class="sS">${st.survival || 1}</b></div>`));
    },
    showDeath(sum, onRetry, onMenu) {
      this.hideAll();
      this.clearBanner();
      const el = mk(`<div class="scr end end-dead enter">
        <div class="ttl glitch jitter" data-text="СИСТЕМА ОТКЛЮЧЕНА">СИСТЕМА ОТКЛЮЧЕНА</div>
        <div class="sub">Сигнал потерян · нейросеть перезагружается</div>
        ${this.summaryHtml(sum, false)}
        <div class="rowf"><button class="mbtn cf primary" data-nav data-focus data-a="retry">Заново</button><button class="mbtn cf" data-nav data-a="menu">В меню</button></div>
        <div class="seed">Seed: ${esc(sum && sum.seed)}</div><div class="hint"></div></div>`);
      this.fillBuild(el, sum);
      el.querySelector('[data-a=retry]').onclick = () => { this.hideAll(); onRetry && onRetry(); };
      el.querySelector('[data-a=menu]').onclick = () => { this.hideAll(); onMenu && onMenu(); };
      const sc = this.push({ el, kind: 'end', onBack: () => { this.hideAll(); onMenu && onMenu(); } });
      if (G.touch && G.touch.releaseAll) G.touch.releaseAll();
      return sc;
    },
    showVictory(sum, onMenu) {
      this.hideAll();
      this.clearBanner();
      const m = G.meta || {};
      const rec = sum && m.bestTime != null && Math.abs(m.bestTime - (sum.time || 0)) < 0.01;
      const el = mk(`<div class="scr end end-win enter">
        <div class="ttl glitch" data-text="ЯДРО ОСВОБОЖДЕНО">ЯДРО ОСВОБОЖДЕНО</div>
        <div class="sub">Забег завершён · победа №${m.wins || 1}</div>
        ${rec ? '<div class="rec">Новый рекорд времени!</div>' : ''}
        ${this.summaryHtml(sum, true)}
        <div class="rowf"><button class="mbtn cf primary" data-nav data-focus data-a="again">Новый забег</button><button class="mbtn cf" data-nav data-a="menu">В меню</button></div>
        <div class="seed">Seed: ${esc(sum && sum.seed)}</div><div class="hint"></div></div>`);
      this.fillBuild(el, sum);
      el.querySelector('[data-a=menu]').onclick = () => { this.hideAll(); onMenu && onMenu(); };
      el.querySelector('[data-a=again]').onclick = () => { this.hideAll(); if (G.game && G.game.newRun) G.game.newRun(); else if (onMenu) onMenu(); };
      const sc = this.push({ el, kind: 'end', onBack: () => { this.hideAll(); onMenu && onMenu(); } });
      if (G.touch && G.touch.releaseAll) G.touch.releaseAll();
      return sc;
    },

    // ---------------------------------------------------------------- LEVEL BANNER (glitch decode)
    clearBanner() { this.bn = null; if (this.bannerEl) this.bannerEl.hidden = true; },
    banner(title, sub) {
      const b = this.bannerEl;
      const g = G.game || {};
      const tag = G.RUN && g.stage != null ? `ЭТАП ${g.stage + 1}/${G.RUN.length}` : '';
      b.innerHTML = `<div class="bn-tag">${esc(tag)}</div><div class="bn-title"></div><div class="bn-line"></div><div class="bn-sub">${esc(sub || '')}</div>`;
      b.classList.remove('out');
      b.hidden = false;
      this.bn = { t: 0, text: String(title || ''), el: b.querySelector('.bn-title'), last: '', life: 2.8 };
      this.updateBanner(0);
    },
    updateBanner(dt) {
      const bn = this.bn;
      if (!bn) return;
      bn.t += dt;
      const GL = '#$%&*+=?<>/\\АБВГДЖЗИКЛМНПРСТУФХЦЧШЭЮЯ01';
      const k = Math.min(1, bn.t / 0.7), n = bn.text.length;
      if (bn.t < 0.8) {
        const tick = Math.floor(bn.t * 30);
        if (tick !== bn.tick) {
          bn.tick = tick;
          let s = '';
          for (let i = 0; i < n; i++) {
            const ch = bn.text[i];
            if (ch === ' ' || i < Math.floor(k * n)) s += ch;
            else if (i < Math.floor(k * n) + 4 || bn.t > 0.05) s += GL[(Math.random() * GL.length) | 0];
          }
          bn.el.textContent = s;
        }
      } else if (bn.last !== bn.text) { bn.el.textContent = bn.text; bn.last = bn.text; }
      if (bn.t > bn.life && !bn.out) { bn.out = true; this.bannerEl.classList.add('out'); }
      if (bn.t > bn.life + 0.6) { this.bannerEl.hidden = true; this.bn = null; }
    },

    // ---------------------------------------------------------------- STAT CHOICE (power scroll)
    statCard(stat, p) {
      const lv = (p && p.stats && p.stats[stat]) || 1;
      const its = [];
      if (p) for (const k in p.slots) { const it = p.slots[k]; if (it && statList(it.def.stat).includes(stat)) its.push(it); }
      const hp = Math.round(STAT_HP[stat] * ((p && p.hpMul) || 1));
      const c = mk(`<button class="card cf ${STAT_K[stat]}" data-nav data-stat="${stat}">
        <div class="band"><span class="nm">${STAT_NAME[stat]}</span><span class="lv"><small>Уровень</small>${lv}<i class="ar r"></i>${lv + 1}</span></div>
        <ul><li>Урон <b>${STAT_WORD[stat]}</b> снаряжения <b>+14%</b></li><li>Макс. здоровье <b>+${hp}</b></li><li>Полное восстановление</li></ul>
        <div class="its"></div><div class="pick">Установить</div></button>`);
      const box = c.querySelector('.its');
      if (its.length) for (const it of its) box.appendChild(itemCanvas(it.def));
      else box.innerHTML = '<small>нет подходящего снаряжения</small>';
      return c;
    },
    chooseStat(options, cb) {
      this.closeKind('map');
      const p = G.world && G.world.player;
      const opts = (options && options.length ? options : ['brutality', 'tactics', 'survival']).filter((s) => STAT_NAME[s]);
      const el = mk(`<div class="scr dim enter stat-scr"><div class="ttl cy glitch" data-text="ЧИП УСИЛЕНИЯ">ЧИП УСИЛЕНИЯ</div>
        <div class="sub">Выберите параметр для прокачки</div><div class="cards"></div><div class="hint"></div></div>`);
      const cards = el.querySelector('.cards');
      let done = false;
      const sc = { el, kind: 'stat', modal: true, onBack: null };
      opts.forEach((s, i) => {
        const c = this.statCard(s, p);
        if (i === 0) c.setAttribute('data-focus', '');
        c.onclick = () => { if (done) return; done = true; this.pop(sc); sfx('uiSelect', 0.5); cb && cb(s); };
        cards.appendChild(c);
      });
      if (G.touch && G.touch.releaseAll) G.touch.releaseAll();
      sfx('uiOpen', 0.45);
      return this.push(sc);
    },

    // ---------------------------------------------------------------- COLLECTOR
    openCollector(world) {
      world = world || G.world;
      if (!world || this.stack.some((s) => s.kind === 'collector')) return;
      this.closeKind('map');
      const p = world.player;
      const st = (world._uiCollector = world._uiCollector || { taken: false, offer: null });
      const el = mk(`<div class="scr dim enter"><div class="win cf coll">
        <div class="win-h"><div class="ttl cy">Коллектор</div><div class="cur"><span class="cv">0</span>${img('cells')}</div></div>
        <div class="tabs"><button class="tab cf" data-nav data-auto data-focus data-t="mut">${img('implant')}Импланты</button><button class="tab cf" data-nav data-auto data-t="bp">${img('chip')}Чертежи</button><button class="tab cf" data-nav data-auto data-t="up">${img('cells')}Улучшения</button></div>
        <div class="coll-body"></div>
        <div class="coll-foot"><span class="msg"></span><button class="mbtn cf small" data-nav data-a="close">Закрыть</button></div></div><div class="hint"></div></div>`);
      const body = el.querySelector('.coll-body'), msg = el.querySelector('.msg'), cv = el.querySelector('.cur .cv');
      const sc = { el, kind: 'collector', modal: true, tab: 'mut' };
      const say = (t, cls) => { msg.textContent = t; msg.className = 'msg ' + (cls || ''); };
      const cells = () => (p ? p.cells | 0 : 0);
      const paintCur = () => { cv.textContent = cells(); };
      const cost = (n) => `<span class="cost ${cells() < n ? 'no' : ''}">${n}${img('cells')}</span>`;
      const render = () => {
        paintCur();
        el.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.t === sc.tab));
        body.innerHTML = '';
        body.scrollTop = 0;
        if (sc.tab === 'mut') renderMut(); else if (sc.tab === 'bp') renderBp(); else renderUp();
      };
      // --- implants: pick one free implant per transit (max G.MAX_MUTATIONS, replace when full)
      const mutIcon = (m, size = 16) => { const c = document.createElement('canvas'); c.width = c.height = size; c.className = 'px'; H().paintMutation(c, m); return c; };
      const install = (m, idx) => {
        let res = null;
        try { res = G.addMutation(p, m, idx); } catch (e) { console.error(e); }
        if (!res) { say('Сбой установки импланта', 'bad'); sfx('denied', 0.5); return; }
        st.taken = true; st.pending = null;
        say('Имплант установлен: ' + H().mutName(m), 'ok');
        render();
        this.setFocus(sc, el.querySelector('.tab[data-t=mut]'), false);
      };
      const renderMut = () => {
        if (!G.offerMutations || !G.addMutation) {
          body.innerHTML = '<div class="note">Имплант-модуль не отвечает. Нейро-импланты станут доступны в следующих версиях прошивки.</div>';
          return;
        }
        const mine = (p && p.mutations) || [];
        if (st.taken) {
          body.innerHTML = '<div class="note">Имплант уже установлен в этом шлюзе. Следующий — в следующем шлюзе.</div>';
          if (mine.length) {
            const list = mk('<div class="list"></div>');
            for (const m of mine) {
              const r = mk(`<div class="li cf owned"><div class="fr cf k-t" style="--bc:${statColor(m.stat)}"></div><div class="tx"><span>${esc(H().mutName(m))}</span><small>${esc(m.desc || '')}</small></div><span></span></div>`);
              r.querySelector('.fr').appendChild(mutIcon(m));
              list.appendChild(r);
            }
            body.appendChild(list);
          }
          return;
        }
        if (st.pending) { // slots full: choose which implant to replace
          const m = st.pending;
          body.appendChild(mk(`<div class="note">Все слоты имплантов заняты. Что заменить на «${esc(H().mutName(m))}»?</div>`));
          const list = mk('<div class="list"></div>');
          mine.forEach((old, i) => {
            const r = mk(`<button class="li cf" data-nav><div class="fr cf" style="--bc:${statColor(old.stat)}"></div><div class="tx"><span>${esc(H().mutName(old))}</span><small>${esc(old.desc || '')}</small></div><span class="cost no" style="font-family:var(--font-pixel)">Заменить</span></button>`);
            r.querySelector('.fr').appendChild(mutIcon(old));
            r.onclick = () => install(m, i);
            list.appendChild(r);
          });
          const cancel = mk('<button class="li cf" data-nav><div class="fr cf" style="--bc:#45466a"></div><div class="tx"><span>Отмена</span><small>Вернуться к выбору</small></div><span></span></button>');
          cancel.onclick = () => { st.pending = null; render(); };
          list.appendChild(cancel);
          body.appendChild(list);
          return;
        }
        if (!st.offer) { try { st.offer = G.offerMutations(world.rng, p, 3) || []; } catch (e) { console.error(e); st.offer = []; } }
        if (!st.offer.length) { body.innerHTML = '<div class="note">Нет доступных имплантов.</div>'; return; }
        const max = G.MAX_MUTATIONS || 3;
        body.appendChild(mk(`<div class="note">Выберите один бесплатный имплант. Он действует до конца забега. Слоты: ${mine.length} / ${max}</div>`));
        const cards = mk('<div class="cards"></div>');
        st.offer.forEach((m) => {
          const s = statList(m.stat)[0];
          const c = mk(`<button class="card cf ${STAT_K[s] || 'k-t'}" data-nav><div class="band"><span class="nm" style="padding-right:calc(var(--u)*22)">${esc(H().mutName(m))}</span><span class="lv"><small>${esc(STAT_NAME[s] || 'Имплант')}</small></span></div>
            <ul><li>${esc(m.desc || m.description || '')}</li></ul><div class="pick">${mine.length >= max ? 'Заменить…' : 'Установить'}</div></button>`);
          const icv = mutIcon(m, 24);
          icv.style.cssText = 'position:absolute;right:calc(var(--u)*6);top:calc(var(--u)*6);width:calc(var(--u)*20);height:calc(var(--u)*20)';
          c.querySelector('.band').appendChild(icv);
          c.onclick = () => {
            if (st.taken) return;
            if (mine.length >= max) { st.pending = m; render(); const it = this.items(sc).filter((e) => e.classList.contains('li')); this.setFocus(sc, it[0] || null, false); return; }
            install(m);
          };
          cards.appendChild(c);
        });
        body.appendChild(cards);
      };
      // --- blueprints: unlock items for future runs
      const renderBp = () => {
        const unlocked = (G.meta && G.meta.unlocked) || [];
        const all = Object.values(G.ITEMS || {}).filter((d) => d.blueprint);
        if (!all.length) { body.innerHTML = '<div class="note">Чертежей пока нет. Ищите их у элитных врагов.</div>'; return; }
        const locked = all.filter((d) => !unlocked.includes(d.id)), owned = all.filter((d) => unlocked.includes(d.id));
        const list = mk('<div class="list"></div>');
        for (const d of locked.concat(owned)) {
          const own = unlocked.includes(d.id);
          const price = d.unlockCost || 50;
          const r = mk(`<button class="li cf ${own ? 'owned' : ''}" data-nav><div class="fr cf" style="--bc:${statColor(d.stat)}"></div>
            <div class="tx"><span>${esc(d.name)}</span><small>${esc(H().KIND_NAME[d.kind] || '')}${d.desc ? ' · ' + esc(d.desc) : ''}</small></div>
            ${own ? '<span class="cost done">Открыт</span>' : cost(price)}</button>`);
          r.querySelector('.fr').appendChild(itemCanvas(d));
          r.onclick = () => {
            if (own) return;
            let ok = false;
            if (G.unlockBlueprint) { try { ok = G.unlockBlueprint(d.id) !== false && (G.meta.unlocked || []).includes(d.id); } catch (e) { console.error(e); } }
            else if (cells() >= price) {
              p.cells -= price;
              G.meta.unlocked = G.meta.unlocked || []; G.meta.unlocked.push(d.id);
              if (G.saveMeta) G.saveMeta();
              G.emit('unlock', { id: d.id, def: d });
              ok = true;
            }
            if (ok) { say('Чертёж открыт: ' + d.name, 'ok'); if (!G.unlockBlueprint) sfx('shopBuy', 0.6); const idx = this.items(sc).indexOf(r); render(); const it = this.items(sc); this.setFocus(sc, it[Math.min(idx, it.length - 1)] || null, false); }
            else { say('Недостаточно ядер', 'bad'); r.classList.remove('shake'); void r.offsetWidth; r.classList.add('shake'); if (!G.unlockBlueprint) sfx('denied', 0.5); }
          };
          list.appendChild(r);
        }
        body.appendChild(list);
      };
      // --- permanent upgrades
      const UP_ICON = { flask: 'flask', hp: 'heart', flaskPower: 'flask', startSkill: 'implant', startGold: 'gold', interest: 'gold', cellMagnet: 'cells' };
      const renderUp = () => {
        const ups = G.META_UPGRADES || [];
        if (!ups.length) { body.innerHTML = '<div class="note">Улучшения недоступны.</div>'; return; }
        const list = mk('<div class="list"></div>');
        for (const u of ups) {
          const lvl = ((G.meta && G.meta.upgrades) || {})[u.id] || 0;
          const max = (u.cost || []).length;
          const next = lvl < max ? u.cost[lvl] : null;
          const r = mk(`<button class="li cf ${next == null ? 'owned' : ''}" data-nav><div class="fr cf" style="--bc:var(--cells)">${img(UP_ICON[u.id] || 'chip')}</div>
            <div class="tx"><span>${esc(u.name)}</span><small>${esc(u.desc || '')}</small><div class="pips">${'<i></i>'.repeat(max)}</div></div>
            ${next == null ? '<span class="cost done">Максимум</span>' : cost(next)}</button>`);
          r.querySelectorAll('.pips i').forEach((e, i) => e.classList.toggle('on', i < lvl));
          r.onclick = () => {
            if (next == null) return;
            let ok = false;
            if (G.buyUpgrade) { try { const before = lvl; const res = G.buyUpgrade(u.id); ok = res !== false && (((G.meta.upgrades || {})[u.id] || 0) > before); } catch (e) { console.error(e); } }
            else if (cells() >= next) {
              p.cells -= next;
              G.meta.upgrades = G.meta.upgrades || {}; G.meta.upgrades[u.id] = lvl + 1;
              if (G.saveMeta) G.saveMeta();
              ok = true;
            }
            if (ok) { say(G.buyUpgrade ? 'Улучшение установлено: ' + u.name : 'Улучшение установлено (со следующего забега)', 'ok'); if (!G.buyUpgrade) sfx('shopBuy', 0.6); const idx = this.items(sc).indexOf(r); render(); const it = this.items(sc); this.setFocus(sc, it[Math.min(idx, it.length - 1)] || null, false); }
            else { say('Недостаточно ядер', 'bad'); r.classList.remove('shake'); void r.offsetWidth; r.classList.add('shake'); sfx('denied', 0.5); }
          };
          list.appendChild(r);
        }
        body.appendChild(list);
      };
      el.querySelectorAll('.tab').forEach((b) => (b.onclick = () => { if (sc.tab !== b.dataset.t) { sc.tab = b.dataset.t; say(''); render(); } }));
      const close = () => { this.pop(sc); };
      sc.onBack = close;
      el.querySelector('[data-a=close]').onclick = close;
      render();
      if (G.touch && G.touch.releaseAll) G.touch.releaseAll();
      sfx('uiOpen', 0.45);
      return this.push(sc);
    },

    // ---------------------------------------------------------------- BIG MAP
    openMap() {
      const w = G.world, hud = H();
      if (!w || !hud || !hud.map || this.stack.length) return;
      const tex = hud.map.tex;
      const maxW = 880, maxH = 400; // backing px (= 2 per game px)
      let s = Math.min(maxW / tex.width, maxH / tex.height);
      if (s >= 1) s = Math.floor(s);
      const cw = Math.max(2, Math.round(tex.width * s)), ch = Math.max(2, Math.round(tex.height * s));
      const run = G.RUN && G.game && G.RUN[G.game.stage];
      const biome = run && G.BIOMES && G.BIOMES[run.biome];
      const name = run ? (run.kind === 'transit' ? 'Шлюз' : run.kind === 'boss' ? 'Арена ядра' : biome ? biome.name : run.biome) : 'Карта';
      // explored percentage (open tiles only)
      const L = w.level;
      let open = 0, seen = 0;
      for (let i = 0; i < L.w * L.h; i++) { if (L.tiles && L.tiles[i] !== G.T.SOLID) { open++; if (L.explored[i]) seen++; } }
      const pct = open ? Math.round((100 * seen) / open) : 0;
      const C = hud.MARK_COL;
      const el = mk(`<div class="scr dim enter bigmap"><div class="win-h" style="width:calc(var(--u)*${Math.max(200, cw / 2 + 8)})"><div class="ttl cy" >${esc(name)}</div><div class="sub">Исследовано ${pct}%</div></div>
        <div class="mapbox cf"><canvas class="px" width="${cw}" height="${ch}" style="width:calc(var(--u)*${cw / 2});height:calc(var(--u)*${ch / 2})"></canvas></div>
        <div class="legend"><span><i style="background:#27f3ff"></i>Выход</span><span><i style="background:${C.chest}"></i>Контейнер</span><span><i style="background:${C.scroll}"></i>Чип</span><span><i style="background:${C.shop}"></i>Магазин</span><span><i style="background:${C.collector}"></i>Коллектор</span><span><i style="background:#fff"></i>Вы</span></div>
        <button class="mbtn cf small" data-nav data-focus data-a="close">Закрыть</button><div class="hint"></div></div>`);
      const cv = el.querySelector('canvas'), ctx = cv.getContext('2d');
      const draw = (blink) => { hud.collectMarks(w); hud.drawMapView(ctx, cw, ch, w, { center: false, blink }); };
      draw(1);
      let acc = 0, bl = 1;
      const sc = { el, kind: 'map', modal: true, onBack: () => this.closeMap(), update: (dt) => { acc += dt; if (acc > 0.35) { acc = 0; bl ^= 1; draw(bl); } } };
      el.querySelector('[data-a=close]').onclick = () => this.closeMap();
      el.querySelector('.mapbox').onclick = () => this.closeMap();
      if (G.touch && G.touch.releaseAll) G.touch.releaseAll();
      this.push(sc);
      sfx('uiOpen', 0.5);
    },
    closeMap() { this.closeKind('map'); },

    // ---------------------------------------------------------------- TITLE BACKDROP (canvas, 480×270)
    drawBackdrop(ctx, dt) {
      this.bdT = (this.bdT || 0) + (dt || 0);
      if (G.drawCityBackdrop && !this._bdFail) {
        try { G.drawCityBackdrop(ctx, this.bdT, dt); return; } catch (e) { this._bdFail = true; }
      }
      if (!this.city) this.city = buildCity();
      drawCity(ctx, this.city, this.bdT, dt || 0);
      if (G.game && G.game.vignette) ctx.drawImage(G.game.vignette, 0, 0);
    },
  };

  // ------------------------------------------------------------------ procedural neon skyline
  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function buildCity() {
    const R = new G.RNG(0xc17c17);
    const W = G.W, Hh = G.H, LW = 960;
    // sky with dithered bands
    const sky = canvas(W, Hh), g = sky.getContext('2d');
    const bands = ['#05040f', '#070517', '#0a071e', '#0e0926', '#130b2e', '#190d36', '#210f3e', '#2b1146', '#36134c', '#421451', '#4f1554', '#5c1656', '#6a1857'];
    const bh = 200 / bands.length;
    bands.forEach((c, i) => { g.fillStyle = c; g.fillRect(0, Math.floor(i * bh), W, Math.ceil(bh) + 1); });
    g.fillStyle = bands[bands.length - 1]; g.fillRect(0, 200, W, Hh - 200);
    for (let i = 1; i < bands.length; i++) {
      const y = Math.floor(i * bh);
      g.fillStyle = bands[i - 1];
      for (let x = (i & 1); x < W; x += 2) g.fillRect(x, y, 1, 1);
    }
    for (let i = 0; i < 110; i++) { g.fillStyle = R.chance(0.2) ? '#b6c2ff' : R.chance(0.5) ? '#5b5c93' : '#3a3a6a'; g.fillRect(R.int(0, W - 1), R.int(0, 120), 1, 1); }
    // striped sun
    const sx = 332, sy = 132, sr = 64;
    const cols = ['#ffe14d', '#ffc23d', '#ff9a3a', '#ff6a4a', '#ff3d6a', '#ff2a8a'];
    const glow = g.createRadialGradient(sx, sy, sr * 0.6, sx, sy, sr * 2.2);
    glow.addColorStop(0, 'rgba(255,60,140,0.35)'); glow.addColorStop(1, 'rgba(255,42,138,0)');
    g.fillStyle = glow; g.fillRect(sx - sr * 2.3, sy - sr * 2.3, sr * 4.6, sr * 4.6);
    for (let y = -sr; y <= sr; y++) {
      const yy = y + sr * 0.05;
      if (yy > 0) { const gap = 1 + Math.floor((yy / sr) * 5); if (yy % 10 < gap) continue; }
      const hw = Math.floor(Math.sqrt(sr * sr - y * y));
      g.fillStyle = cols[Math.min(cols.length - 1, Math.floor(((y + sr) / (2 * sr)) * cols.length))];
      g.fillRect(sx - hw, sy + y, hw * 2 + 1, 1);
    }
    // layers of buildings (tileable over LW)
    const blinks = [];
    const layer = (o) => {
      const c = canvas(LW, Hh), q = c.getContext('2d');
      const L = { cv: c, speed: o.speed, blinks: [] };
      let x = -10;
      while (x < LW) {
        const w = R.int(o.wMin, o.wMax), h = R.int(o.hMin, o.hMax);
        const top = Hh - h;
        const draw = (ox) => {
          q.fillStyle = o.color; q.fillRect(ox, top, w, h);
          // setback / roof detail
          if (R.chance(0.45)) { const iw = Math.max(4, Math.floor(w * R.float(0.3, 0.7))); q.fillRect(ox + Math.floor((w - iw) / 2), top - R.int(4, 14), iw, 20); }
          if (o.edge) { q.fillStyle = o.edge; q.fillRect(ox, top, w, 1); q.fillRect(ox, top, 1, h); }
          // windows
          for (let wy = top + 4; wy < Hh - 2; wy += o.wy) {
            for (let wx = ox + 2; wx < ox + w - 2; wx += o.wx) {
              if (R.chance(o.lit)) { q.fillStyle = R.pick(o.win); q.fillRect(wx, wy, o.ww, o.wh); }
            }
          }
          // neon sign
          if (o.signs && R.chance(o.signs)) {
            const c2 = R.pick(['#ff2a8a', '#27f3ff', '#ffe14d', '#b46cff', '#48ff8a']);
            q.fillStyle = c2;
            if (R.chance(0.5)) { const sh = R.int(14, 34), sx2 = ox + R.int(1, Math.max(1, w - 5)); q.fillRect(sx2, top + R.int(6, 20), 4, sh); q.fillStyle = '#05040a'; for (let k = 3; k < sh; k += 5) q.fillRect(sx2 + 1, top + 8 + k, 2, 1); }
            else { const sw = Math.min(w - 4, R.int(12, 26)); q.fillRect(ox + 2, top + R.int(8, 18), sw, 3); }
          }
          // antenna
          if (R.chance(o.ant)) {
            const ax = ox + R.int(2, w - 3), ah = R.int(8, 24);
            q.fillStyle = o.color; q.fillRect(ax, top - ah, 1, ah);
            L.blinks.push({ x: ax, y: top - ah - 1, ph: R.float(0, 6), c: R.chance(0.7) ? '#ff3348' : '#27f3ff' });
          }
        };
        draw(x);
        if (x + w > LW) draw(x - LW);
        x += w + R.int(o.gapMin, o.gapMax);
      }
      return L;
    };
    const far = layer({ speed: 5, color: '#1b1034', wMin: 18, wMax: 44, hMin: 70, hMax: 165, gapMin: -6, gapMax: 4, wx: 3, wy: 4, ww: 1, wh: 1, lit: 0.18, win: ['#3d2a73', '#5a2a6b', '#2b4a7a'], ant: 0.35, signs: 0 });
    const mid = layer({ speed: 12, color: '#110a22', edge: '#241640', wMin: 22, wMax: 56, hMin: 50, hMax: 125, gapMin: 2, gapMax: 14, wx: 4, wy: 5, ww: 2, wh: 1, lit: 0.22, win: ['#27f3ff', '#ff2a8a', '#ffe14d', '#6a4aa8', '#6a4aa8'], ant: 0.25, signs: 0.55 });
    const near = layer({ speed: 26, color: '#06040b', edge: '#1a1030', wMin: 34, wMax: 80, hMin: 22, hMax: 70, gapMin: 6, gapMax: 26, wx: 6, wy: 6, ww: 2, wh: 2, lit: 0.08, win: ['#ff2a8a', '#27f3ff', '#ffc23d'], ant: 0.3, signs: 0.35 });
    // horizon haze
    const fog = canvas(W, Hh), fg = fog.getContext('2d');
    const gr = fg.createLinearGradient(0, 150, 0, Hh);
    gr.addColorStop(0, 'rgba(255,42,138,0)'); gr.addColorStop(0.55, 'rgba(255,42,138,0.10)'); gr.addColorStop(1, 'rgba(120,30,160,0.22)');
    fg.fillStyle = gr; fg.fillRect(0, 150, W, Hh - 150);
    // rain sprites
    const drop = (len, col) => { const c = canvas(Math.ceil(len * 0.3) + 1, len); const q = c.getContext('2d'); q.fillStyle = col; for (let i = 0; i < len; i++) q.fillRect(Math.floor((len - 1 - i) * 0.3), i, 1, 1); return c; };
    const drops = [];
    for (let i = 0; i < 150; i++) drops.push({ x: R.float(0, W + 60), y: R.float(-Hh, Hh), v: R.float(280, 420), n: R.chance(0.3) ? 1 : 0 });
    return { sky, far, mid, near, fog, drops, dropS: [drop(6, 'rgba(150,170,255,0.35)'), drop(10, 'rgba(190,210,255,0.55)')], cars: [], carT: 1, R, blinks };
  }
  function drawLayer(ctx, L, t) {
    const LW = L.cv.width;
    const off = Math.floor((t * L.speed) % LW);
    ctx.drawImage(L.cv, -off, 0);
    if (LW - off < G.W) ctx.drawImage(L.cv, LW - off, 0);
    for (const b of L.blinks) {
      if (Math.sin(t * 2.2 + b.ph) < 0.3) continue;
      let x = b.x - off; if (x < -2) x += LW;
      if (x > G.W + 2) continue;
      ctx.fillStyle = b.c; ctx.fillRect(x, b.y, 1, 1);
      G.drawGlow(ctx, x, b.y, 6, b.c, 0.6);
    }
  }
  function drawCity(ctx, C, t, dt) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(C.sky, 0, 0);
    drawLayer(ctx, C.far, t);
    ctx.drawImage(C.fog, 0, 0);
    // flying cars between far & mid layers
    C.carT -= dt;
    if (C.carT <= 0) {
      C.carT = C.R.float(0.8, 2.6);
      const dir = C.R.sign();
      C.cars.push({ x: dir > 0 ? -12 : G.W + 12, y: C.R.int(46, 150), v: dir * C.R.float(40, 110), c: C.R.pick(['#27f3ff', '#ff2a8a', '#ffe14d']) });
    }
    for (let i = C.cars.length - 1; i >= 0; i--) {
      const c = C.cars[i];
      c.x += c.v * dt;
      if (c.x < -20 || c.x > G.W + 20) { C.cars.splice(i, 1); continue; }
      const x = Math.round(c.x), y = c.y, d = Math.sign(c.v);
      ctx.fillStyle = c.c; ctx.globalAlpha = 0.35; ctx.fillRect(d > 0 ? x - 9 : x + 3, y + 1, 7, 1); ctx.globalAlpha = 1;
      ctx.fillStyle = '#0b0816'; ctx.fillRect(x - 2, y, 5, 2);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(d > 0 ? x + 2 : x - 2, y, 1, 1);
      ctx.fillStyle = '#ff3348'; ctx.fillRect(d > 0 ? x - 2 : x + 2, y + 1, 1, 1);
      G.drawGlow(ctx, x, y, 8, c.c, 0.35);
    }
    drawLayer(ctx, C.mid, t);
    // searchlights
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 2; i++) {
      const a = -Math.PI / 2 + Math.sin(t * 0.35 + i * 2.1) * 0.55;
      const bx = 110 + i * 260, by = G.H;
      ctx.globalAlpha = 0.07;
      ctx.fillStyle = i ? '#ff2a8a' : '#27f3ff';
      ctx.beginPath(); ctx.moveTo(bx, by);
      ctx.lineTo(bx + Math.cos(a - 0.05) * 320, by + Math.sin(a - 0.05) * 320);
      ctx.lineTo(bx + Math.cos(a + 0.05) * 320, by + Math.sin(a + 0.05) * 320);
      ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    drawLayer(ctx, C.near, t);
    // rain
    for (const d of C.drops) {
      d.y += d.v * dt; d.x -= d.v * 0.3 * dt;
      if (d.y > G.H) { d.y = C.R.float(-30, -5); d.x = C.R.float(0, G.W + 60); }
      ctx.drawImage(C.dropS[d.n], Math.round(d.x), Math.round(d.y));
    }
  }

  G.ui = ui;
})();
