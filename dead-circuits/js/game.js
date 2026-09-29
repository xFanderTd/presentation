'use strict';
// World container, run structure (biomes → transit → boss), main loop and rendering pipeline.
(function () {
  const G = window.G;
  const PAL = G.PAL, TS = G.TILE;

  // Run layout. depth = difficulty tier used by enemies & loot.
  G.RUN = [
    { kind: 'biome', biome: 'scrap', depth: 0 },
    { kind: 'transit', biome: 'scrap', depth: 0 },
    { kind: 'biome', biome: 'slums', depth: 1 },
    { kind: 'transit', biome: 'slums', depth: 1 },
    { kind: 'biome', biome: 'spire', depth: 2 },
    { kind: 'transit', biome: 'spire', depth: 2 },
    { kind: 'boss', biome: 'core', depth: 3 },
  ];

  // persistent meta progression
  G.meta = Object.assign({ cells: 0, unlocked: [], upgrades: {}, runs: 0, wins: 0, bestTime: null, kills: 0 }, G.store.get('meta', {}));
  G.saveMeta = () => G.store.set('meta', G.meta);

  // ---------------------------------------------------------------- exit door
  class ExitDoor extends G.WorldObject {
    constructor(x, y, opts = {}) {
      super(x, y, 24, 36);
      this.locked = !!opts.locked;
      this.interactable = !this.locked;
    }
    get prompt() { return this.locked ? 'Заблокировано' : 'Выйти'; }
    update(dt, world) {
      this.t += dt;
      if (this.locked && world.bossDefeated) { this.locked = false; this.interactable = true; world.fx.ring(this.cx, this.cy, 4, 40, PAL.cyan, 0.6, 2); }
    }
    interact(p, world) { if (!this.locked) G.game.nextStage(); }
    draw(ctx, cam) {
      const x = Math.round(this.x - cam.ox), y = Math.round(this.y - cam.oy);
      const c = this.locked ? PAL.red : PAL.cyan;
      G.px.rect(ctx, x - 3, y - 3, 30, 39, PAL.ink);
      G.px.rect(ctx, x - 2, y - 2, 28, 38, '#2b2a45');
      G.px.rect(ctx, x, y, 24, 36, '#0b0a14');
      // energy field
      for (let i = 0; i < 6; i++) {
        const yy = (Math.floor(this.t * 30) + i * 6) % 36;
        G.px.rect(ctx, x + 1, y + yy, 22, 1, this.locked ? '#5a1020' : '#0e5e70');
      }
      G.px.rect(ctx, x, y, 24, 1, c); G.px.rect(ctx, x, y, 1, 36, c); G.px.rect(ctx, x + 23, y, 1, 36, c);
      G.font.draw(ctx, this.locked ? 'LOCK' : 'EXIT', x + 12, y - 11, c, 1, 'center');
    }
    drawLight(ctx, cam) { G.drawGlow(ctx, this.cx - cam.ox, this.cy - cam.oy, 50, this.locked ? PAL.red : PAL.cyan, 0.45); }
  }
  G.OBJECTS.exit = (w, s) => new ExitDoor(s.x, s.y, s);
  G.OBJECTS.boss = (w, s) => {
    if (G.spawnBoss) G.spawnBoss(w, s.x, s.y);
    else { const e = G.spawnEnemy(w, 'grunt', s.x, s.y, { elite: true }); if (e) e.isBoss = true; }
    return null;
  };

  // ---------------------------------------------------------------- fallback level (used only if level.js is missing)
  class StubLevel extends G.TileMap {
    constructor(spec) {
      const R = new G.RNG(spec.seed);
      const kind = spec.kind;
      const w = kind === 'biome' ? 140 : kind === 'boss' ? 46 : 40, h = kind === 'biome' ? 34 : 20;
      super(w, h);
      this.biome = spec.biome;
      for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) if (x === 0 || x === w - 1 || y === 0 || y >= h - 3) this.set(x, y, G.T.SOLID);
      this.objects = []; this.enemySpawns = []; this.rooms = [];
      if (kind === 'biome') {
        for (let x = 8; x < w - 8; x += R.int(5, 9)) {
          const y = R.int(h - 10, h - 6);
          const len = R.int(3, 6);
          for (let i = 0; i < len; i++) this.set(x + i, y, R.chance(0.5) ? G.T.PLATFORM : G.T.SOLID);
          if (R.chance(0.25)) for (let yy = y - 5; yy < y; yy++) this.set(x + len + 2, yy, G.T.SOLID);
          if (R.chance(0.2)) for (let yy = y; yy < h - 3; yy++) this.set(x - 1, yy, G.T.LADDER);
          if (R.chance(0.15)) this.set(x + 2, h - 4, G.T.SPIKES);
        }
        for (let x = 20; x < w - 10; x += R.int(7, 12)) this.enemySpawns.push({ x: x * TS + 8, y: (h - 3) * TS, air: false });
        this.objects.push({ kind: 'scroll', x: 30 * TS, y: (h - 3) * TS });
        this.objects.push({ kind: 'chest', x: 50 * TS, y: (h - 3) * TS });
        this.objects.push({ kind: 'weapon', x: 12 * TS, y: (h - 3) * TS });
        this.objects.push({ kind: 'food', x: 70 * TS, y: (h - 3) * TS });
        this.objects.push({ kind: 'exit', x: (w - 4) * TS, y: (h - 3) * TS });
      } else if (kind === 'transit') {
        this.objects.push({ kind: 'healstation', x: 12 * TS, y: (h - 3) * TS });
        this.objects.push({ kind: 'collector', x: 20 * TS, y: (h - 3) * TS });
        this.objects.push({ kind: 'exit', x: (w - 4) * TS, y: (h - 3) * TS });
      } else {
        this.objects.push({ kind: 'boss', x: 30 * TS, y: (h - 3) * TS });
        this.objects.push({ kind: 'exit', x: (w - 3) * TS, y: (h - 3) * TS, locked: true });
      }
      this.spawn = { x: 4 * TS, y: (h - 3) * TS };
    }
    drawBackground(ctx, cam) { ctx.fillStyle = '#100c20'; ctx.fillRect(0, 0, G.W, G.H); }
  }

  // ---------------------------------------------------------------- World
  class World {
    constructor(spec, player) {
      this.spec = spec;
      this.depth = spec.depth;
      this.biome = spec.biome;
      this.kind = spec.kind;
      this.rng = new G.RNG((spec.seed ^ 0x5bd1e995) >>> 0);
      this.level = G.Level && G.Level.generate ? G.Level.generate(spec) : new StubLevel(spec);
      this.fx = new G.FX(this.level);
      this.cam = new G.Camera();
      this.enemies = []; this.projectiles = []; this.objects = []; this.allies = []; this.flashLights = [];
      this.time = 0; this.hitstopT = 0; this.glitch = 0; this.slowmo = 0;
      this.bossDefeated = false; this.boss = null;
      G.world = this;
      const sp = this.level.spawn;
      this.player = player;
      player.x = sp.x - player.w / 2; player.y = sp.y - player.h; player.vx = player.vy = 0;
      player.state = 'normal'; player.act = null; player.safe = { x: player.x, y: player.y };
      for (const s of player.scarf) { s.x = s.px = player.cx; s.y = s.py = player.y + 6; }
      this.cam.snap(player.cx, player.cy, this.level);
      for (const o of this.level.objects || []) this.spawnObject(o);
      const spawnR = this.rng.fork();
      for (const s of this.level.enemySpawns || []) {
        const type = G.pickEnemy(this.biome, this.depth, spawnR, s);
        if (!type) continue;
        const elite = this.kind === 'biome' && spawnR.chance(0.05 + 0.03 * this.depth);
        G.spawnEnemy(this, type, s.x, s.y, { elite, spawn: s });
      }
    }
    spawnObject(spec) {
      const f = G.OBJECTS[spec.kind];
      if (!f) return null;
      const o = f(this, spec);
      if (o) { o.mapKind = spec.kind; this.objects.push(o); }
      return o;
    }
    addObject(o) { this.objects.push(o); return o; }
    addProjectile(p) { this.projectiles.push(p); return p; }
    spawnEnemy(type, x, y, opts) { return G.spawnEnemy(this, type, x, y, opts); }
    dropCurrency(x, y, cells, gold) {
      for (let i = 0; i < cells; i++) this.objects.push(new G.Currency(x, y, 'cells', 1));
      let g = gold;
      while (g > 0) { const v = g > 30 ? 10 : g > 8 ? 3 : 1; g -= v; this.objects.push(new G.Currency(x, y, 'gold', v)); }
    }
    enemiesInBox(box) { return this.enemies.filter((e) => !e.dead && !e.dying && G.overlap(box, e)); }
    hitstop(t) { this.hitstopT = Math.max(this.hitstopT, t); }
    shake(m, t) { this.cam.shake(m, t); }

    update(dt) {
      if (this.glitch > 0) this.glitch = Math.max(0, this.glitch - dt * 2);
      if (this.hitstopT > 0) { this.hitstopT -= dt; this.cam.shakeT = Math.max(0, this.cam.shakeT - dt); return; }
      this.time += dt;
      const p = this.player;
      p.update(dt, this);
      for (const e of this.enemies) e.update(dt, this);
      for (const a of this.allies) a.update(dt, this);
      for (const pr of this.projectiles) pr.update(dt, this);
      for (const o of this.objects) o.update(dt, this);
      this.fx.update(dt);
      this.level.update(dt, this);
      for (const f of this.flashLights) f.t += dt;
      this.flashLights = this.flashLights.filter((f) => f.t < f.life);
      this.enemies = this.enemies.filter((e) => !e.dead);
      this.allies = this.allies.filter((e) => !e.dead);
      this.projectiles = this.projectiles.filter((e) => !e.dead);
      this.objects = this.objects.filter((e) => !e.dead);
      this.cam.follow(p, this.level, dt);
      // music intensity follows nearby aggro enemies
      if (G.audio && G.audio.intensity) {
        let n = 0;
        for (const e of this.enemies) if (e.aggro && !e.dying && G.dist(e.cx, e.cy, p.cx, p.cy) < 260) n++;
        this._int = G.lerp(this._int || 0, Math.min(1, n / 3 + (this.boss ? 1 : 0)), dt * 1.5);
        G.audio.intensity(this._int);
      }
    }

    draw(ctx) {
      const cam = this.cam;
      G.lights.length = 0;
      ctx.fillStyle = PAL.bg0; ctx.fillRect(0, 0, G.W, G.H);
      this.level.drawBackground(ctx, cam);
      this.fx.drawDecals(ctx, cam);
      this.level.drawTiles(ctx, cam);
      const vis = (e) => cam.visible(e.x, e.y, e.w || 8, e.h || 8, 48);
      for (const o of this.objects) if (vis(o)) o.draw(ctx, cam);
      for (const e of this.enemies) if (vis(e)) e.draw(ctx, cam);
      for (const a of this.allies) if (vis(a)) a.draw(ctx, cam);
      this.player.draw(ctx, cam);
      for (const pr of this.projectiles) pr.draw(ctx, cam);
      this.fx.draw(ctx, cam);
      this.level.drawForeground(ctx, cam);
      // additive light pass
      ctx.globalCompositeOperation = 'lighter';
      this.level.drawLights(ctx, cam);
      for (const o of this.objects) if (o.drawLight && vis(o)) o.drawLight(ctx, cam);
      for (const e of this.enemies) if (e.drawLight && vis(e)) e.drawLight(ctx, cam);
      for (const a of this.allies) if (a.drawLight && vis(a)) a.drawLight(ctx, cam);
      for (const pr of this.projectiles) if (pr.drawLight) pr.drawLight(ctx, cam);
      this.player.drawLight(ctx, cam);
      const L = G.lights;
      for (let i = 0; i < L.length; i += 5) G.drawGlow(ctx, L[i] - cam.ox, L[i + 1] - cam.oy, L[i + 2], L[i + 3], L[i + 4]);
      for (const f of this.flashLights) G.drawGlow(ctx, f.x - cam.ox, f.y - cam.oy, f.r, f.color, 1 - f.t / f.life);
      this.fx.drawAdditive(ctx, cam);
      ctx.globalCompositeOperation = 'source-over';
      // overlays that must stay readable
      for (const e of this.enemies) if (e.drawOverlayTop && vis(e)) e.drawOverlayTop(ctx, cam);
      this.fx.drawTexts(ctx, cam);
    }
  }
  G.World = World;

  // ---------------------------------------------------------------- Game (state machine + loop)
  const game = {
    state: 'boot',        // boot | title | play | dead | victory
    paused: false,
    stage: 0,
    runTime: 0,
    seed: 0,
    world: null,
    player: null,
    fade: 0, fadeDir: 0, fadeCb: null,
    stats: null,

    init() {
      this.canvas = document.getElementById('game');
      this.ctx = this.canvas.getContext('2d', { alpha: false });
      this.ctx.imageSmoothingEnabled = false;
      G.bindMouse(this.canvas);
      this.buildVignette();
      if (G.ui && G.ui.init) G.ui.init();
      if (G.hud && G.hud.init) G.hud.init();
      if (G.touch && G.touch.init) G.touch.init();
      window.addEventListener('resize', () => this.resize());
      document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'play' && !this.paused) this.togglePause(true); });
      this.resize();
      const unlockAudio = () => { if (G.audio) G.audio.init(); };
      window.addEventListener('pointerdown', unlockAudio, { capture: true });
      window.addEventListener('keydown', unlockAudio, { capture: true });
      window.addEventListener('touchstart', unlockAudio, { capture: true, passive: true });
      // test hook: advance N frames synchronously
      G.advance = (n) => { for (let i = 0; i < n; i++) { G.input.poll(); this.step(G.DT); G.input.endStep(); } this.render(G.DT); };
      if (G.params.has('play')) this.newRun();
      else this.toTitle();
      let last = performance.now(), acc = 0;
      const frame = (now) => {
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now; acc += dt;
        let steps = 0;
        if (G.params.has('manual')) acc = 0; // tests drive the simulation via G.advance()
        while (acc >= G.DT && steps < 6) { G.input.poll(); this.step(G.DT); G.input.endStep(); acc -= G.DT; steps++; }
        if (steps >= 6) acc = 0;
        this.render(dt);
        this._fpsAcc = (this._fpsAcc || 0) * 0.95 + (1 / Math.max(dt, 0.001)) * 0.05;
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    },

    resize() {
      const stage = document.getElementById('stage');
      const vw = window.innerWidth, vh = window.innerHeight;
      const s = Math.min(vw / G.W, vh / G.H);
      const w = Math.floor(G.W * s), h = Math.floor(G.H * s);
      stage.style.width = w + 'px'; stage.style.height = h + 'px';
      document.documentElement.style.setProperty('--s', (w / G.W).toFixed(4));
    },

    buildVignette() {
      const c = document.createElement('canvas');
      c.width = G.W; c.height = G.H;
      const g = c.getContext('2d');
      const grd = g.createRadialGradient(G.W / 2, G.H * 0.55, G.H * 0.35, G.W / 2, G.H / 2, G.W * 0.62);
      grd.addColorStop(0, 'rgba(5,3,12,0)');
      grd.addColorStop(1, 'rgba(5,3,12,0.72)');
      g.fillStyle = grd; g.fillRect(0, 0, G.W, G.H);
      this.vignette = c;
    },

    toTitle() {
      this.state = 'title';
      this.world = null;
      if (G.hud) G.hud.show(false);
      if (G.audio) G.audio.music('title');
      if (G.ui && G.ui.showTitle) G.ui.showTitle(() => this.newRun());
      else this.newRun();
    },

    newRun(seed) {
      const ps = parseInt(G.params.get('seed'), 10);
      this.seed = seed || (Number.isFinite(ps) ? ps : Math.floor(Math.random() * 900000) + 100000);
      this.runRng = new G.RNG(this.seed);
      this.stage = 0;
      const bp = G.params.get('biome'), kp = G.params.get('kind');
      if (bp || kp) {
        const idx = G.RUN.findIndex((r) => (!bp || r.biome === bp) && (!kp || r.kind === kp));
        if (idx >= 0) this.stage = idx;
      }
      this.runTime = 0;
      this.stats = { kills: 0, cellsTotal: 0, goldTotal: 0, dmgDealt: 0, dmgTaken: 0, scrolls: 0 };
      const p = new G.Player(0, 0);
      this.player = p;
      G.startingLoadout(p, this.runRng);
      const wp = G.params.get('weapon');
      if (wp && G.ITEMS[wp]) p.equip(G.makeItem(wp, 0), G.ITEMS[wp].kind === 'skill' ? 'skill1' : 'primary');
      for (const u of G.META_UPGRADES || []) { const lvl = (G.meta.upgrades || {})[u.id] || 0; if (lvl && u.apply) u.apply(p, lvl); }
      G.meta.runs++; G.saveMeta();
      if (G.ui && G.ui.hideAll) G.ui.hideAll();
      this.state = 'play'; this.paused = false;
      this.loadStage(this.stage);
      G.emit('runStart', { seed: this.seed });
    },

    loadStage(i) {
      const spec = Object.assign({}, G.RUN[i]);
      spec.seed = (this.seed * 31 + i * 7919) >>> 0;
      this.world = new World(spec, this.player);
      this.fade = 1; this.fadeDir = -1;
      if (G.hud) { G.hud.show(true); if (G.hud.onLevel) G.hud.onLevel(this.world); }
      const biome = G.BIOMES && G.BIOMES[spec.biome];
      if (G.audio) G.audio.music(spec.kind === 'transit' ? 'transit' : spec.kind === 'boss' ? 'boss' : (biome && biome.music) || spec.biome);
      if (G.audio) G.audio.play(spec.kind === 'transit' ? 'transit' : 'levelStart');
      const name = spec.kind === 'transit' ? 'Шлюз' : (biome ? biome.name : spec.biome);
      const sub = spec.kind === 'transit' ? 'Безопасная зона' : spec.kind === 'boss' ? 'Финальная схватка' : 'Сектор ' + (spec.depth + 1);
      if (G.ui && G.ui.banner) G.ui.banner(name, sub);
      G.emit('levelStart', { world: this.world, spec });
    },

    nextStage() {
      if (this.fadeDir === 1) return;
      this.fadeDir = 1;
      if (G.audio) G.audio.play('door');
      this.fadeCb = () => {
        this.stage++;
        if (this.stage >= G.RUN.length) this.victory();
        else this.loadStage(this.stage);
      };
    },

    victory() {
      this.state = 'victory';
      G.meta.wins++;
      if (!G.meta.bestTime || this.runTime < G.meta.bestTime) G.meta.bestTime = this.runTime;
      G.meta.kills += this.stats.kills;
      G.saveMeta();
      if (G.audio) { G.audio.music(null); G.audio.play('victory'); }
      if (G.hud) G.hud.show(false);
      G.emit('runEnd', { win: true });
      if (G.ui && G.ui.showVictory) G.ui.showVictory(this.summary(), () => this.toTitle());
    },

    onPlayerDeath() {
      this.state = 'dead';
      G.meta.kills += this.stats.kills;
      G.saveMeta();
      if (G.audio) G.audio.music(null);
      G.emit('runEnd', { win: false });
      if (G.ui && G.ui.showDeath) G.ui.showDeath(this.summary(), () => this.newRun(), () => this.toTitle());
    },

    summary() {
      const p = this.player;
      const biome = G.BIOMES && G.BIOMES[G.RUN[Math.min(this.stage, G.RUN.length - 1)].biome];
      return Object.assign({}, this.stats, {
        time: this.runTime, seed: this.seed, stage: this.stage, stageName: biome ? biome.name : '',
        cells: p.cells, gold: p.gold, stats: Object.assign({}, p.stats), slots: p.slots,
      });
    },

    togglePause(force) {
      if (this.state !== 'play') return;
      this.paused = force != null ? force : !this.paused;
      if (G.ui && G.ui.showPause) {
        if (this.paused) G.ui.showPause(() => this.togglePause(false), () => this.toTitle());
        else if (G.ui.hidePause) G.ui.hidePause();
      }
    },

    step(dt) {
      if (G.ui && G.ui.update) G.ui.update(dt);
      if (this.state !== 'play' || !this.world) return;
      if (G.input.pressed('pause') && !(G.ui && G.ui.isModalOpen && G.ui.isModalOpen())) { this.togglePause(); return; }
      const modal = G.ui && G.ui.isModalOpen && G.ui.isModalOpen();
      if (this.paused || modal) return;
      if (this.fadeDir === 1) {
        this.fade = Math.min(1, this.fade + dt * 3);
        if (this.fade >= 1) { this.fadeDir = 0; const cb = this.fadeCb; this.fadeCb = null; if (cb) cb(); }
        return;
      }
      if (this.fadeDir === -1) { this.fade = Math.max(0, this.fade - dt * 2.5); if (this.fade <= 0) this.fadeDir = 0; }
      this.runTime += dt;
      this.world.update(dt);
      const p = this.player;
      if (p.state === 'dead' && p.deadT > 1.6 && this.state === 'play') this.onPlayerDeath();
    },

    render(dt) {
      const ctx = this.ctx;
      if (!this.world) {
        if (G.ui && G.ui.drawBackdrop) G.ui.drawBackdrop(ctx, dt);
        else { ctx.fillStyle = PAL.bg0; ctx.fillRect(0, 0, G.W, G.H); }
        return;
      }
      this.world.draw(ctx);
      ctx.drawImage(this.vignette, 0, 0);
      const fx = this.world.fx;
      if (fx.flashT > 0) { ctx.globalAlpha = Math.min(0.35, fx.flashT * 3); ctx.fillStyle = fx.flashColor; ctx.fillRect(0, 0, G.W, G.H); ctx.globalAlpha = 1; }
      const p = this.player;
      if (p && p.hp < p.maxHp * 0.25 && p.state !== 'dead') {
        ctx.globalAlpha = 0.12 + Math.sin(this.world.time * 6) * 0.06; ctx.fillStyle = PAL.red;
        ctx.fillRect(0, 0, G.W, 3); ctx.fillRect(0, G.H - 3, G.W, 3); ctx.fillRect(0, 0, 3, G.H); ctx.fillRect(G.W - 3, 0, 3, G.H);
        ctx.globalAlpha = 1;
      }
      if (this.world.glitch > 0) this.glitchFx(ctx, this.world.glitch);
      if (this.fade > 0) { ctx.globalAlpha = this.fade; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, G.W, G.H); ctx.globalAlpha = 1; }
      if (G.hud && G.hud.update) G.hud.update(this.world, dt);
      if (G.debug.fps) G.font.draw(ctx, Math.round(this._fpsAcc || 0) + ' FPS', 4, 4, PAL.lime);
    },

    glitchFx(ctx, k) {
      const n = Math.ceil(k * 6);
      for (let i = 0; i < n; i++) {
        const y = G.rand.int(0, G.H - 8), h = G.rand.int(2, 10), dx = G.rand.int(-8, 8) * k;
        ctx.drawImage(this.canvas, 0, y, G.W, h, dx, y, G.W, h);
      }
      ctx.globalAlpha = 0.18 * k; ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(this.canvas, 2 * k, 0);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    },
  };
  G.game = game;

  // run stats
  G.on('enemyKilled', () => { if (game.stats) game.stats.kills++; if (game.player) game.player.kills++; });
  G.on('enemyHit', (e) => { if (game.stats) game.stats.dmgDealt += e.dmg || 0; });
  G.on('playerHurt', (e) => { if (game.stats) game.stats.dmgTaken += e.dmg || 0; });
  G.on('pickup', (e) => { if (!game.stats) return; if (e.kind === 'cells') game.stats.cellsTotal += e.value; if (e.kind === 'gold') game.stats.goldTotal += e.value; });
  G.on('scroll', () => { if (game.stats) game.stats.scrolls++; });
  G.on('bossDefeated', () => { if (game.world) game.world.bossDefeated = true; });

  window.addEventListener('load', () => game.init());
})();
