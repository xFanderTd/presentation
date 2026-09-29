'use strict';
// DEAD CIRCUITS — levels.
//   * G.BIOMES: biome definitions (RU names, palettes, music, enemy density, decor sets)
//   * G.Level.generate({seed, biome, depth, kind}): deterministic procedural levels
//       - 'biome'  : big level built from a grid of rooms (main path + branches), validated with
//                    a reachability search that models the player's movement budget
//       - 'transit': small hand-authored safe room ("Шлюз")
//       - 'boss'   : hand-authored reactor arena
//   * Rendering: terrain / back walls / decor are pre-rendered lazily into 256px chunk canvases;
//     only cheap overlays (LEDs, screens, rain, neon flicker, glows) are animated per frame.
(function () {
  const G = window.G;
  const T = G.T, TS = G.TILE;

  // ================================================================ small helpers
  // Deterministic integer hash -> [0,1)
  function hash3(x, y, s) {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  const hexToRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const rgbToHex = (r, g, b) => '#' + [r, g, b].map((v) => G.clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
  // mix two #rrggbb colors
  function mix(a, b, t) {
    const A = hexToRgb(a), B = hexToRgb(b);
    return rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
  }
  const shade = (c, k) => (k >= 0 ? mix(c, '#ffffff', k) : mix(c, '#000000', -k));
  const rgba = (hex, a) => { const c = hexToRgb(hex); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; };

  // ================================================================ biomes
  // pal fields:
  //   sil      solid-mass interior (near-black silhouette)
  //   rock0-2  terrain edge band (dark -> light), top/topHi lit top surface, trim/trim2 neon trims
  //   wall0-3  back wall tones (dark -> light), wallTint (window glass tint)
  //   lamp     main light color, lamp2 secondary (screens), neon[] sign colors
  //   fog      foreground haze color, amb ambient light color baked on the back wall
  G.BIOMES = {
    scrap: {
      id: 'scrap', name: 'Утилизатор', sub: 'Перерабатывающий комплекс корпорации',
      music: 'scrap', density: 0.9, spikes: 0.5,
      grid: { gw: 8, gh: 5, cw: 22, ch: 12, dir: 'h' },
      weather: { rain: 0.12, dust: 1, embers: 1, steam: 1 },
      // room themes: plant / cells / control / furnace
      decor: ['girder', 'lamp:sodium', 'lamp:tube', 'pipe', 'window:arched', 'window:furnace', 'cage', 'conveyor', 'screen', 'hazard', 'fan', 'gear', 'chain', 'crate', 'barrel', 'neon'],
      signs: ['NO EXIT', 'DANGER', 'SECTOR 7', 'SCRAP', 'RECYCLE', 'BLOCK C', 'KEEP OUT', 'UNIT 9'],
      pal: {
        sil: '#070507', rock0: '#0e0a0c', rock1: '#181214', rock2: '#2c201c', top: '#5e4030', topHi: '#c98a45',
        trim: '#ff8a2a', trim2: '#2ee6d6', metal: '#4a4a5c', rust: '#7a3f22',
        wall0: '#111820', wall1: '#19242f', wall2: '#22323e', wall3: '#304656', wallTint: '#2a1a10',
        wallVars: ['#1a221f', '#10222c', '#26170f'],
        lamp: '#ff9a3a', lamp2: '#2ee6d6', neon: ['#ff8a2a', '#2ee6d6', '#ffcf3a', '#ff4a3a'],
        fog: '#2a140a', amb: '#ff7a2a', sky: '#1a0d08', spike: '#ff6a2a',
      },
    },
    slums: {
      id: 'slums', name: 'Неоновые трущобы', sub: 'Нижние улицы мегаполиса',
      music: 'slums', density: 1.0, spikes: 0.45, openSky: true,
      grid: { gw: 9, gh: 4, cw: 22, ch: 13, dir: 'h' },
      weather: { rain: 1, dust: 0, embers: 0, steam: 1 },
      decor: ['facade', 'awin', 'roof', 'neon', 'vsign', 'streetlamp', 'lamp:lantern', 'stall', 'ac', 'cable', 'holo', 'vending', 'trash', 'poster:graffiti', 'lanterns', 'puddle'],
      signs: ['RAMEN', 'BAR', 'HOTEL', 'OPEN', '24H', 'NOODLE', 'SUSHI', 'LOVE', 'CLUB', 'PAWN', 'KARAOKE', 'PHARMA', 'CYBER', 'NOODLE BAR', 'PACHINKO'],
      pal: {
        sil: '#06050b', rock0: '#0e0c17', rock1: '#171422', rock2: '#262239', top: '#433f60', topHi: '#8fe9ff',
        trim: '#ff2a8a', trim2: '#27f3ff', metal: '#3c3a58', rust: '#4a2a3a',
        wall0: '#170f28', wall1: '#221738', wall2: '#2f204b', wall3: '#422e64', wallTint: '#1a1040',
        lamp: '#ff5cc8', lamp2: '#27f3ff', neon: ['#ff2a8a', '#27f3ff', '#ffe14d', '#9b5cff', '#ff5c5c', '#48ff8a'],
        fog: '#1a0f35', amb: '#b44cff', sky: '#140a2a', spike: '#27f3ff',
      },
    },
    spire: {
      id: 'spire', name: 'Шпиль данных', sub: 'Корпоративная башня',
      music: 'spire', density: 1.1, spikes: 0.45,
      grid: { gw: 7, gh: 6, cw: 23, ch: 12, dir: 'v' },
      weather: { rain: 0, dust: 1, embers: 0, steam: 0, data: 1 },
      // room themes: server / office / lobby / lab
      decor: ['glass', 'strip', 'rack', 'dataslot', 'data', 'terminal', 'plant', 'neon', 'holo', 'screen', 'cable', 'pipe'],
      signs: ['OMNICORP', 'DATA', 'NODE 7', 'ACCESS', 'LEVEL 88', 'SECURE', 'SERVER', 'ARCHIVE'],
      pal: {
        sil: '#040409', rock0: '#08090f', rock1: '#0f111a', rock2: '#1c2138', top: '#34406a', topHi: '#d8ecff',
        trim: '#9b5cff', trim2: '#5ab8ff', metal: '#3a4466', rust: '#2a2a4a',
        wall0: '#0f1830', wall1: '#17244a', wall2: '#203260', wall3: '#2c447a', wallTint: '#0a1a3a',
        wallVars: ['#221a4c', '#0d2a3a', '#1c2030'],
        lamp: '#bcd8ff', lamp2: '#5ab8ff', neon: ['#9b5cff', '#5ab8ff', '#27f3ff', '#ff5cc8'],
        fog: '#0a1030', amb: '#5a7cff', sky: '#070a1a', spike: '#9b5cff',
      },
    },
    core: {
      id: 'core', name: 'Ядро', sub: 'Реакторный зал',
      music: 'core', density: 1.15, spikes: 0.55,
      grid: { gw: 8, gh: 5, cw: 22, ch: 12, dir: 'h' },
      weather: { rain: 0, dust: 0, embers: 1, steam: 1 },
      decor: ['girder', 'lamp:cage', 'pipe', 'cable', 'chain', 'beacon', 'screen', 'neon', 'window:core'],
      signs: ['CORE', 'DANGER', 'REACTOR', 'NO ENTRY', 'HOT', 'OVERLOAD'],
      pal: {
        sil: '#070205', rock0: '#10050a', rock1: '#1a0810', rock2: '#2e0e1c', top: '#58182f', topHi: '#ff6a8a',
        trim: '#ff2a5a', trim2: '#ff2ad4', metal: '#4a2238', rust: '#5a1a2a',
        wall0: '#11050a', wall1: '#1a0810', wall2: '#260c18', wall3: '#3a1226', wallTint: '#2a0610',
        lamp: '#ff3a5a', lamp2: '#ff2ad4', neon: ['#ff2a5a', '#ff2ad4', '#ff8a2a'],
        fog: '#2a0612', amb: '#ff2a5a', sky: '#12030a', spike: '#ff2ad4',
      },
    },
  };
  // Transit room look (cozy airlock between biomes), mixed with the previous biome's palette.
  const TRANSIT_PAL = {
    wall0: '#15131d', wall1: '#1d1a28', wall2: '#2a2536', wall3: '#3a3348',
    lamp: '#ffc27a', lamp2: '#48ff8a', amb: '#ffb060',
  };

  // ================================================================ Level class
  class Level extends G.TileMap {
    constructor(w, h, o) {
      super(w, h);
      this.seed = o.seed >>> 0;
      this.kind = o.kind;
      this.depth = o.depth | 0;
      this.biome = o.biome;
      const B = G.BIOMES[o.biome];
      this.B = B;
      this.pal = Object.assign({}, B.pal, o.kind === 'transit' ? TRANSIT_PAL : null);
      this.name = o.kind === 'transit' ? 'Шлюз' : B.name;
      this.music = o.kind === 'transit' ? 'transit' : o.kind === 'boss' ? 'boss' : B.music;
      this.spawn = { x: 0, y: 0 };
      this.enemySpawns = [];
      this.objects = [];
      this.rooms = [];
      this.back = new Uint8Array(w * h);  // back-wall material per tile (0 = open: parallax shows)
      this.wallVar = new Uint8Array(w * h); // back-wall color variant per tile (room themes)
      this.decor = [];                     // static decor baked into chunks
      this.anims = [];                     // animated decor drawn every frame
      this.glows = [];                     // light sources (drawLights)
      this.t = 0;
      this.meta = {};                      // generator debug info (path cells, holes …)
    }
    // tile writes after generation invalidate the pre-rendered chunk
    set(tx, ty, v) {
      super.set(tx, ty, v);
      if (this.art) this.art.invalidate(tx, ty);
    }
    update(dt, world) {
      this.t += dt;
      if (this.art) this.art.update(dt, world);
    }
    drawBackground(ctx, cam) { this.getArt().drawBackground(ctx, cam); }
    drawTiles(ctx, cam) { this.getArt().drawTiles(ctx, cam); }
    drawForeground(ctx, cam) { this.getArt().drawForeground(ctx, cam); }
    drawLights(ctx, cam) { this.getArt().drawLights(ctx, cam); }
    getArt() { if (!this.art) this.art = new LevelArt(this); return this.art; }
    // reachability of every standable cell from the spawn (Uint8Array, index ty*w+tx)
    reach() { return reachability(this, Math.floor(this.spawn.x / TS), Math.floor((this.spawn.y - 1) / TS)); }
    // sanity check: every object & the exit must be reachable from the spawn
    check() {
      const vis = this.reach();
      const bad = [];
      for (const o of this.objects) {
        if (o.kind === 'boss') continue;
        const tx = Math.floor(o.x / TS), ty = Math.floor((o.y - 1) / TS);
        if (!vis[ty * this.w + tx]) bad.push(o);
      }
      return { ok: bad.length === 0, unreachable: bad, vis };
    }
  }

  // ================================================================ reachability
  // Conservative model of the player's movement: a node is a tile cell holding the player's feet
  // (2-tile body). Moves: walk, step off ledges (fall straight down), drop through one-way
  // platforms, ladders (the top ladder tile is a one-way floor, flush with the upper floor — matches
  // physics.js/player.js), and jumps with an apex of up to JH tiles (double jump) whose horizontal
  // reach shrinks with height. Falling into spikes is never allowed. Player: jump ≈ 3.1 tiles,
  // double jump ≈ 5.6, so JH = 4 and the reach table leave a safety margin.
  const JH = 4, REACH = [0, 6, 5, 4, 3];
  function reachability(lv, sx, sy) {
    const W = lv.w, H = lv.h, tl = lv.tiles, N = W * H;
    const tAt = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? T.SOLID : tl[y * W + x]);
    const openA = new Uint8Array(N);
    for (let i = 0; i < N; i++) { const v = tl[i]; openA[i] = v !== T.SOLID && v !== T.SPIKES ? 1 : 0; }
    const open = (x, y) => x >= 0 && y >= 0 && x < W && y < H && openA[y * W + x] === 1;
    const body = (x, y) => open(x, y) && open(x, y - 1);
    const stand = new Uint8Array(N);
    const me = (x, y) => tl[y * W + x];
    for (let y = 1; y < H; y++) for (let x = 0; x < W; x++) {
      if (!body(x, y)) continue;
      const b = tAt(x, y + 1);
      if (b === T.SOLID || b === T.PLATFORM || me(x, y) === T.LADDER || (b === T.LADDER && me(x, y) !== T.LADDER)) stand[y * W + x] = 1;
    }
    // land[i] = first stand node at/below i when falling straight down (-1 = none or hazard)
    const land = new Int32Array(N).fill(-1);
    for (let x = 0; x < W; x++) {
      let cur = -1;
      for (let y = H - 1; y >= 0; y--) {
        const i = y * W + x;
        if (!body(x, y)) { cur = -1; continue; }
        if (stand[i]) cur = i;
        land[i] = cur;
      }
    }
    const vis = new Uint8Array(N);
    const q = new Int32Array(N);
    let qh = 0, qt = 0;
    const push = (i) => { if (i >= 0 && !vis[i]) { vis[i] = 1; q[qt++] = i; } };
    if (sx >= 0 && sy >= 0 && sx < W && sy < H) push(land[sy * W + sx] >= 0 ? land[sy * W + sx] : sy * W + sx);
    while (qh < qt) {
      const i = q[qh++], x = i % W, y = (i / W) | 0;
      const below = tAt(x, y + 1);
      const onLad = tl[i] === T.LADDER;
      const ladTop = below === T.LADDER && !onLad;           // standing on the top of a ladder (one-way)
      const grounded = below === T.SOLID || below === T.PLATFORM || ladTop;
      if (grounded) {
        if (body(x - 1, y)) push(land[i - 1]);
        if (body(x + 1, y)) push(land[i + 1]);
      }
      if ((below === T.PLATFORM || ladTop) && body(x, y + 1)) push(land[i + W]);   // drop through / climb down
      if (tAt(x, y - 1) === T.LADDER && body(x, y - 1)) push(i - W);
      if (onLad) {
        if (tAt(x, y + 1) === T.LADDER && body(x, y + 1)) push(i + W);
        if (tAt(x, y - 1) !== T.LADDER && y >= 2 && stand[i - W]) push(i - W);   // step off the top
      }
      for (let s = -1; s <= 1; s += 2) {
        for (let a = 1; a <= JH; a++) {
          if (!open(x, y - a - 1)) break;
          const ya = y - a;
          for (let k = 1; k <= REACH[a]; k++) {
            const nx = x + s * k;
            if (!body(nx, ya)) break;
            push(land[ya * W + nx]);
          }
        }
      }
    }
    return vis;
  }
  G.levelReach = reachability;

  // ================================================================ generation: biome levels
  const FT = 2;   // floor thickness under each grid row
  const MB = 2;   // solid border around the room grid

  function layoutBiome(o, B, rng) {
    const gc = B.grid, dir = gc.dir;
    const gw = gc.gw + (dir === 'h' ? Math.min(2, o.depth) : 0);
    const gh = gc.gh + (dir === 'v' ? Math.min(1, o.depth) : 0);
    const CW = gc.cw, CH = gc.ch;
    const W = gw * CW + 2 * MB, H = gh * CH + 2 * MB;
    const lv = new Level(W, H, o);
    lv.tiles.fill(T.SOLID);
    const put = (x, y, v) => { if (x >= 0 && y >= 0 && x < W && y < H) lv.tiles[y * W + x] = v; };
    const get = (x, y) => lv.tile(x, y);
    const fill = (x0, y0, x1, y1, v) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(x, y, v); };
    const cellX = (c) => MB + c * CW, cellY = (r) => MB + r * CH, rowS = (r) => cellY(r) + CH - FT - 1;

    // ------------------------------------------------ cells + main path
    const cells = [];
    for (let r = 0; r < gh; r++) for (let c = 0; c < gw; c++) cells.push({ c, r, on: false, path: -1, branch: 0, dead: false, room: null, L: false, R: false, U: false, D: false });
    const cell = (c, r) => (c >= 0 && r >= 0 && c < gw && r < gh ? cells[r * gw + c] : null);
    const link = (a, b) => {
      if (b.c > a.c) a.R = b.L = true; else if (b.c < a.c) a.L = b.R = true;
      else if (b.r > a.r) a.D = b.U = true; else a.U = b.D = true;
    };
    const linked = (a, b) => (b.c > a.c ? a.R : b.c < a.c ? a.L : b.r > a.r ? a.D : a.U);
    const path = [];
    const step = (c, r) => { const n = cell(c, r); if (path.length) link(path[path.length - 1], n); n.on = true; n.path = path.length; path.push(n); };
    if (dir === 'h') {
      let c = 0, r = rng.int(0, gh - 1), last = '', vrun = 0;
      step(c, r);
      while (c < gw - 1) {
        const opts = [['R', 2.6]];
        if (c > 0 && vrun < 2 && last !== 'D' && r > 0 && !cell(c, r - 1).on) opts.push(['U', 1.5]);
        if (c > 0 && vrun < 2 && last !== 'U' && r < gh - 1 && !cell(c, r + 1).on) opts.push(['D', 1.5]);
        const m = rng.weighted(opts);
        if (m === 'R') { c++; vrun = 0; } else { r += m === 'U' ? -1 : 1; vrun++; }
        step(c, r); last = m;
      }
    } else {
      let r = gh - 1, c = rng.int(1, gw - 2), last = '', hrun = 0;
      step(c, r);
      while (r > 0) {
        const opts = [['U', hrun >= 1 ? 1.1 : 0.25]];
        if (hrun < 3 && last !== 'R' && c > 0 && !cell(c - 1, r).on) opts.push(['L', 1.3]);
        if (hrun < 3 && last !== 'L' && c < gw - 1 && !cell(c + 1, r).on) opts.push(['R', 1.3]);
        const m = rng.weighted(opts);
        if (m === 'U') { r--; hrun = 0; } else { c += m === 'L' ? -1 : 1; hrun++; }
        step(c, r); last = m;
      }
      // finish with a horizontal step on the top row so the exit room is entered from the side
      const opts = [];
      if (c > 0) opts.push(-1);
      if (c < gw - 1) opts.push(1);
      const d = rng.pick(opts);
      const n = rng.int(1, 2);
      for (let i = 0; i < n && c + d >= 0 && c + d < gw; i++) { c += d; step(c, r); }
    }
    const first = path[0], lastCell = path[path.length - 1];

    // ------------------------------------------------ side branches (dead ends hold rewards)
    const nBranch = rng.int(4, 6) + (gw * gh > 45 ? 1 : 0);
    let made = 0;
    const dirs4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const pc of rng.shuffle(path.slice(1, -1))) {
      if (made >= nBranch) break;
      let cur = pc, steps = 0;
      const len = rng.int(1, 3);
      for (; steps < len; steps++) {
        const nb = dirs4.map(([dc, dr]) => cell(cur.c + dc, cur.r + dr)).filter((n) => n && !n.on);
        if (!nb.length) break;
        const n = rng.pick(nb);
        link(cur, n); n.on = true; n.branch = made + 1; cur = n;
      }
      if (steps > 0) { cur.dead = true; made++; }
    }
    // extra side rooms so the grid is ~70% used (Dead Cells levels are dense)
    const target = Math.round(gw * gh * rng.float(0.62, 0.74));
    for (let pass = 0; pass < 3; pass++) {
      for (const a of rng.shuffle(cells.filter((ce) => ce.on && ce !== first && ce !== lastCell))) {
        if (cells.filter((ce) => ce.on).length >= target) break;
        const nb = dirs4.map(([dc, dr]) => cell(a.c + dc, a.r + dr)).filter((n) => n && !n.on);
        if (!nb.length || !rng.chance(0.45)) continue;
        const n = rng.pick(nb);
        link(a, n); n.on = true; n.branch = 99;
        if (a.dead) a.dead = false;
        n.dead = true;
      }
    }
    // a few loops for alternate routes (never touching the spawn / exit cells)
    for (const a of cells) {
      if (!a.on || a === first || a === lastCell) continue;
      for (const [dc, dr] of [[1, 0], [0, 1]]) {
        const b = cell(a.c + dc, a.r + dr);
        if (b && b.on && b !== first && b !== lastCell && !linked(a, b) && rng.chance(0.14)) link(a, b);
      }
    }

    // ------------------------------------------------ rooms (merged cells)
    const rooms = [];
    const mkRoom = (c0, r0, wc, hc, kind) => {
      const R = { id: rooms.length, c0, r0, wc, hc, kind, cells: [], x: cellX(c0), y: cellY(r0), w: wc * CW, h: hc * CH,
        onPath: false, dead: false, pathIdx: 1e9, doors: [], holesUp: [], holesDown: [], ledges: [] };
      for (let r = r0; r < r0 + hc; r++) for (let c = c0; c < c0 + wc; c++) {
        const ce = cell(c, r); ce.room = R; ce.on = true; R.cells.push(ce);
        if (ce.path >= 0) { R.onPath = true; R.pathIdx = Math.min(R.pathIdx, ce.path); }
        if (ce.dead) R.dead = true;
      }
      rooms.push(R);
      return R;
    };
    const special = (ce) => ce === first || ce === lastCell;
    // arenas (2x2)
    const arenaMax = rng.int(1, 2);
    let arenas = 0;
    for (const pc of rng.shuffle(path.slice(2, -2))) {
      if (arenas >= arenaMax) break;
      for (const [dc, dr] of rng.shuffle([[0, 0], [-1, 0], [0, -1], [-1, -1]])) {
        const c0 = pc.c + dc, r0 = pc.r + dr;
        if (c0 < 0 || r0 < 0 || c0 + 1 >= gw || r0 + 1 >= gh) continue;
        const sq = [cell(c0, r0), cell(c0 + 1, r0), cell(c0, r0 + 1), cell(c0 + 1, r0 + 1)];
        if (sq.some((s) => s.room || special(s))) continue;
        if (sq.filter((s) => s.on).length < 3) continue;
        mkRoom(c0, r0, 2, 2, 'arena'); arenas++;
        break;
      }
    }
    // horizontal halls along the path
    for (let i = 0; i < path.length; i++) {
      const a = path[i];
      if (a.room) continue;
      let j = i;
      while (j + 1 < path.length && j - i < 2 && path[j + 1].r === a.r && Math.abs(path[j + 1].c - path[j].c) === 1 && !path[j + 1].room) j++;
      if (j > i && rng.chance(0.6)) {
        const len = rng.int(2, j - i + 1);
        const cs = path.slice(i, i + len).map((p) => p.c);
        mkRoom(Math.min(...cs), a.r, len, 1, 'hall');
        i += len - 1;
      }
    }
    // vertical shafts along the path (never the spawn / exit cell)
    for (let i = 1; i < path.length - 1; i++) {
      const a = path[i];
      if (a.room) continue;
      let j = i;
      while (j + 1 < path.length - 1 && j - i < 2 && path[j + 1].c === a.c && Math.abs(path[j + 1].r - path[j].r) === 1 && !path[j + 1].room) j++;
      if (j > i && rng.chance(dir === 'v' ? 0.6 : 0.45)) {
        const len = rng.int(2, j - i + 1);
        const rs = path.slice(i, i + len).map((p) => p.r);
        mkRoom(a.c, Math.min(...rs), 1, len, 'shaft');
        i += len - 1;
      }
    }
    for (const ce of cells) if (ce.on && !ce.room) {
      const links = (ce.L ? 1 : 0) + (ce.R ? 1 : 0) + (ce.U ? 1 : 0) + (ce.D ? 1 : 0);
      let kind = ce.dead && !special(ce) && rng.chance(0.5) ? 'nook' : 'room';
      if (!ce.dead && !ce.U && !ce.D && ce.L && ce.R && !special(ce) && rng.chance(0.3)) kind = 'corridor';
      if (links === 1 && !ce.dead) kind = 'nook';
      if (special(ce)) kind = 'room';
      mkRoom(ce.c, ce.r, 1, 1, kind);
    }

    // ------------------------------------------------ carve room interiors
    for (const R of rooms) {
      let wl = rng.int(1, 2), wr = rng.int(1, 2), ct = rng.int(1, R.hc > 1 ? 2 : 3);
      if (R.kind === 'nook') { wl = rng.int(2, 6); wr = rng.int(2, 6); ct = rng.int(2, 4); }
      if (R.kind === 'corridor') ct = CH - FT - 1 - rng.int(4, 5);
      // slums: rooms with nothing above them are open to the sky (alleys between skyscrapers)
      let clearAbove = true;
      for (let c = R.c0; c < R.c0 + R.wc; c++) for (let r = 0; r < R.r0; r++) if (cell(c, r).on) clearAbove = false;
      R.open = !!B.openSky && clearAbove && R.kind !== 'corridor' && R.kind !== 'nook';
      R.ix0 = R.x + wl; R.ix1 = R.x + R.w - 1 - wr;
      R.iy0 = R.open ? 0 : R.y + ct;
      R.S = rowS(R.r0 + R.hc - 1);
      fill(R.ix0, R.iy0, R.ix1, R.S, T.AIR);
      R.res = new Uint8Array(R.ix1 - R.ix0 + 1); // 1 flat floor, 2 no ceiling drop, 4 no platforms
    }
    const reserve = (R, x0, x1, flags) => { for (let x = Math.max(x0, R.ix0); x <= Math.min(x1, R.ix1); x++) R.res[x - R.ix0] |= flags; };

    // spawn & exit zones
    const R0 = first.room, RE = lastCell.room;
    let spawnT, exitT;
    if (dir === 'h') {
      spawnT = { x: R0.ix0 + 2, y: R0.S };
      reserve(R0, R0.ix0, R0.ix0 + 5, 7);
      exitT = { x: RE.ix1 - 3, y: RE.S };
      reserve(RE, RE.ix1 - 7, RE.ix1, 7);
    } else {
      const cx0 = cellX(first.c);
      const sx = G.clamp(cx0 + rng.int(6, CW - 7), R0.ix0 + 3, R0.ix1 - 3);
      spawnT = { x: sx, y: R0.S };
      reserve(R0, sx - 3, sx + 3, 7);
      const prev = path[path.length - 2];
      const fromLeft = prev.c < lastCell.c;
      exitT = { x: fromLeft ? RE.ix1 - 3 : RE.ix0 + 3, y: RE.S };
      if (fromLeft) reserve(RE, RE.ix1 - 7, RE.ix1, 7); else reserve(RE, RE.ix0, RE.ix0 + 7, 7);
    }
    const inZone = (R, x) => R.res[x - R.ix0] & 1;

    // ------------------------------------------------ doors (horizontal links) & holes (vertical links)
    const doors = [], holes = [];
    for (const a of cells) {
      if (!a.on) continue;
      if (a.R) {
        const b = cell(a.c + 1, a.r);
        const A = a.room, Bm = b.room;
        if (A !== Bm) {
          const S = rowS(a.r);
          const dh = rng.int(3, 4);
          const both = A.open && Bm.open;
          const x0 = A.ix1 + 1, x1 = Bm.ix0 - 1;
          fill(x0, both ? 0 : S - dh + 1, x1, S, T.AIR);
          const d = { x0, x1, S, top: both ? 0 : S - dh + 1, r: a.r, A, B: Bm, open: both };
          doors.push(d);
          A.doors.push({ side: 'R', S, r: a.r, d }); Bm.doors.push({ side: 'L', S, r: a.r, d });
          if (S === A.S) reserve(A, A.ix1 - 3, A.ix1, 3);
          if (S === Bm.S) reserve(Bm, Bm.ix0, Bm.ix0 + 3, 3);
        }
      }
      if (a.D) {
        const b = cell(a.c, a.r + 1);
        const U = a.room, D = b.room;
        if (U !== D) {
          const cx0 = cellX(a.c);
          const lo = Math.max(U.ix0, D.ix0, cx0) + 2, hi = Math.min(U.ix1, D.ix1, cx0 + CW - 1) - 4;
          // keep clear of the spawn / exit zones
          const cand = [];
          for (let x = lo; x <= Math.max(lo, hi); x++) {
            let ok = true;
            for (let k = -1; k <= 3; k++) if ((x + k >= U.ix0 && x + k <= U.ix1 && inZone(U, x + k)) || (x + k >= D.ix0 && x + k <= D.ix1 && inZone(D, x + k))) ok = false;
            if (ok) cand.push(x);
          }
          const hx = cand.length ? rng.pick(cand) : rng.int(lo, Math.max(lo, hi));
          const top = U.S + 1, bot = D.iy0 - 1;
          fill(hx, top, hx + 2, bot, T.AIR);
          const ho = { x: hx, top, U, D, lad: hx + 1 };
          holes.push(ho);
          U.holesDown.push(ho); D.holesUp.push(ho);
          reserve(U, hx - 1, hx + 3, 1);
          reserve(D, hx - 1, hx + 3, 7);
        }
      }
    }

    // ------------------------------------------------ multi-row rooms: ledges at upper doors + climbs
    const climbs = []; // {x, top} ladders to add at the end (cap platform at `top`)
    for (const R of rooms) {
      if (R.hc < 2) continue;
      for (let r = R.r0 + R.hc - 2; r >= R.r0; r--) {
        const S = rowS(r);
        const here = R.doors.filter((d) => d.r === r);
        const specs = here.map((d) => d.side);
        if (!here.length && rng.chance(0.65)) specs.push(rng.pick(['L', 'R', 'M']));
        for (const side of specs) {
          const lw = rng.int(4, R.wc > 1 ? 8 : 6);
          let x0, x1;
          if (side === 'L') { x0 = R.ix0; x1 = x0 + lw - 1; }
          else if (side === 'R') { x1 = R.ix1; x0 = x1 - lw + 1; }
          else { x0 = rng.int(R.ix0 + 5, R.ix1 - 5 - lw); x1 = x0 + lw - 1; }
          // don't block holes coming from above
          if (R.holesUp.some((h) => h.x <= x1 + 1 && h.x + 2 >= x0 - 1)) continue;
          if (side === 'M') {
            fill(x0, S + 1, x1, S + 1, T.PLATFORM);
          } else fill(x0, S + 1, x1, S + 2, T.SOLID);
          const L = { x0, x1, S, side };
          R.ledges.push(L);
          // climb: ladder next to the ledge edge (or under a floating platform)
          const lx = side === 'L' ? x1 + 1 : side === 'R' ? x0 - 1 : rng.chance(0.5) ? x0 : x1;
          if (side === 'M') climbs.push({ x: lx, top: S + 1, onPlat: true });
          else if (rng.chance(0.55)) climbs.push({ x: lx, top: S + 1 });
          else L.stairs = true;
          reserve(R, lx - 1, lx + 1, 5);
          if (side !== 'M') reserve(R, x0 - 1, x1 + 1, 4);
        }
      }
    }

    // ------------------------------------------------ per-room floor / ceiling / platforms
    const pitCols = [];
    for (const R of rooms) {
      const n = R.ix1 - R.ix0 + 1, res = R.res, S = R.S;
      const ih = S - R.iy0 + 1;
      const h = new Int8Array(n);
      if (R.kind !== 'corridor') {
        const maxH = R.open ? 3 : Math.max(0, Math.min(3, ih - 6));
        let i = 0, cur = 0, pits = 0;
        while (i < n) {
          let len = rng.int(3, 8), nh = 0;
          const roll = rng.next();
          if (roll < 0.16 && cur === 0 && pits < 2 && i >= 3 && i + 6 < n) { nh = -2; len = rng.int(2, 4); pits++; }
          else if (roll < 0.55 || maxH === 0) nh = 0;
          else nh = G.clamp((cur < 0 ? 0 : cur) + rng.pick([-2, -1, 1, 1, 2]), 0, maxH);
          if (cur < 0 && nh > 1) nh = 1;
          for (let k = 0; k < len && i < n; k++, i++) h[i] = nh;
          cur = nh;
        }
        // reserved columns stay flat; pits keep a margin from reserved columns and walls
        for (let k = 0; k < n; k++) if (res[k] & 1) h[k] = 0;
        for (let k = 0; k < n; k++) if (h[k] < 0) {
          let bad = k < 2 || k > n - 3;
          for (let j = k - 2; j <= k + 2; j++) if (j >= 0 && j < n && (res[j] & 1)) bad = true;
          if (bad) h[k] = 0;
        }
        // pits wider than 4 are not allowed; smooth steps to <= 2
        for (let k = 0; k < n; k++) if (h[k] < 0) { let j = k; while (j < n && h[j] < 0) j++; if (j - k > 4) for (let m = k + 4; m < j; m++) h[m] = 0; k = j; }
        for (let pass = 0; pass < 3; pass++) {
          for (let k = 1; k < n; k++) if (h[k] >= 0 && h[k - 1] >= 0 && h[k] - h[k - 1] > 2) h[k] = h[k - 1] + 2;
          for (let k = n - 2; k >= 0; k--) if (h[k] >= 0 && h[k + 1] >= 0 && h[k] - h[k + 1] > 2) h[k] = h[k + 1] + 2;
          for (let k = 0; k < n; k++) if (res[k] & 1) h[k] = 0;
        }
        // apply
        let spiky = rng.chance(B.spikes);
        for (let k = 0; k < n; k++) {
          const x = R.ix0 + k;
          if (h[k] > 0) fill(x, S - h[k] + 1, x, S, T.SOLID);
          else if (h[k] < 0) {
            fill(x, S + 1, x, S + 2, T.AIR);
            if (spiky) { put(x, S + 2, T.SPIKES); pitCols.push({ x, y: S + 2 }); }
          }
          if (k > 0 && h[k] >= 0 && h[k - 1] < 0) spiky = rng.chance(B.spikes);
        }
      }
      R.prof = h;
      // ceiling profile (hanging blocks)
      if (!R.open && R.kind !== 'corridor' && R.hc === 1 && ih >= 7) {
        let i = 0;
        while (i < n) {
          const len = rng.int(3, 7);
          const drop = rng.pick([0, 0, 0, 1, 2, 2, 3]);
          for (let k = 0; k < len && i < n; k++, i++) {
            if (res[i] & 2) continue;
            const floorTop = S - Math.max(0, h[i]);
            const d = Math.min(drop, floorTop - R.iy0 + 1 - 5);
            if (d > 0) fill(R.ix0 + i, R.iy0, R.ix0 + i, R.iy0 + d - 1, T.SOLID);
          }
        }
      }
      // one-way platforms
      const nPlat = R.kind === 'corridor' || R.kind === 'nook' ? 0 : rng.int(ih >= 9 ? 1 : 0, 2) + (R.wc - 1) + (R.kind === 'arena' ? 2 : 0) + (R.open ? 1 : 0);
      for (let p = 0; p < nPlat; p++) {
        const w = rng.int(3, 6);
        if (n < w + 4) break;
        const k0 = rng.int(2, n - w - 2);
        let ok = true, base = 0;
        for (let k = k0 - 1; k <= k0 + w; k++) if (res[k] & 4) ok = false;
        if (!ok) continue;
        for (let k = k0; k < k0 + w; k++) base = Math.max(base, h[k]);
        const P = S - base - rng.int(3, 4);   // stand row on the platform
        const pr = P + 1;
        for (let k = k0; k < k0 + w && ok; k++) for (let y = P - 2; y <= pr; y++) if (get(R.ix0 + k, y) !== T.AIR) ok = false;
        if (!ok || P - 2 < R.iy0) continue;
        fill(R.ix0 + k0, pr, R.ix0 + k0 + w - 1, pr, T.PLATFORM);
        // second tier in tall rooms
        if (P - 6 > R.iy0 + 1 && rng.chance(0.6)) {
          const w2 = rng.int(3, 5), off = rng.int(-3, 3);
          const k1 = G.clamp(k0 + off, 2, n - w2 - 2), P2 = P - rng.int(3, 4);
          let ok2 = true;
          for (let k = k1 - 1; k <= k1 + w2; k++) if (res[k] & 4) ok2 = false;
          for (let k = k1; k < k1 + w2 && ok2; k++) for (let y = P2 - 2; y <= P2 + 1; y++) if (get(R.ix0 + k, y) !== T.AIR) ok2 = false;
          if (ok2 && P2 - 2 >= R.iy0) fill(R.ix0 + k1, P2 + 1, R.ix0 + k1 + w2 - 1, P2 + 1, T.PLATFORM);
        }
      }
    }

    // ------------------------------------------------ stairs for ledges without ladders
    for (const R of rooms) for (const L of R.ledges) {
      if (!L.stairs) continue;
      // zig-zag platforms going down from the ledge edge
      const dirX = L.side === 'L' ? 1 : -1;
      const edge = L.side === 'L' ? L.x1 : L.x0;
      let P = L.S + 3, i = 0, ok = true;
      const placed = [];
      while (ok) {
        const below = land(lv, edge + dirX * 2, P);
        if (below !== null && below - P <= 3) break;      // close enough to what's below
        const off = i % 2 === 0 ? 1 : 4;
        const xa = L.side === 'L' ? edge + off : edge - off - 2;
        for (let x = xa; x < xa + 3; x++) for (let y = P - 2; y <= P + 1; y++) if (get(x, y) !== T.AIR || x <= R.ix0 || x >= R.ix1) ok = false;
        if (!ok) break;
        fill(xa, P + 1, xa + 2, P + 1, T.PLATFORM);
        placed.push(xa);
        P += 3; i++;
        if (i > 8) break;
      }
      if (!ok) {
        // fall back to a ladder
        climbs.push({ x: L.side === 'L' ? L.x1 + 1 : L.x0 - 1, top: L.S + 1 });
      }
    }

    // ------------------------------------------------ ladders (capped by a one-way platform at the top)
    // Ladder tiles run from the upper floor row (flush: the top ladder tile is a one-way floor in
    // physics.js) down to the floor below; hole ladders get one-way hatch plates on both sides.
    const addLadder = (x, top, capW) => {
      for (let cx = x - capW; cx <= x + capW; cx++) if (cx !== x && get(cx, top) === T.AIR) put(cx, top, T.PLATFORM);
      let y = top;
      while (y < H && get(x, y) !== T.SOLID && get(x, y) !== T.SPIKES) { put(x, y, T.LADDER); y++; }
    };
    for (const c of climbs) addLadder(c.x, c.top, 0);
    for (const ho of holes) addLadder(ho.lad, ho.top, 1);

    return { lv, rooms, cells, path, holes, doors, spawnT, exitT, gw, gh, CW, CH, pitCols };
  }

  // first standable row at/below (x, y) falling straight down (or null)
  function land(lv, x, y) {
    for (let yy = y; yy < lv.h; yy++) {
      const t = lv.tile(x, yy);
      if (t === T.SOLID || t === T.SPIKES) return null;
      const b = lv.tile(x, yy + 1);
      if (b === T.SOLID || b === T.PLATFORM || (b === T.LADDER && t !== T.LADDER)) return yy;
    }
    return null;
  }

  // ------------------------------------------------------------------ object & enemy placement
  function placeContent(o, B, rng, L) {
    const lv = L.lv, W = lv.w;
    const vis = reachability(lv, L.spawnT.x, L.spawnT.y);
    const exitI = L.exitT.y * W + L.exitT.x;
    if (!vis[exitI]) return false;
    const t = (x, y) => lv.tile(x, y);
    const airCol = (x, y, n) => { for (let k = 0; k < n; k++) if (t(x, y - k) !== T.AIR) return false; return true; };
    const spot = (x, y, clear, solidOnly) => {
      if (!vis[y * W + x] || !airCol(x, y, clear)) return false;
      const b = t(x, y + 1);
      return b === T.SOLID || (!solidOnly && b === T.PLATFORM);
    };
    const flat = (x, y, hw, clear) => { for (let dx = -hw; dx <= hw; dx++) if (!spot(x + dx, y, clear, true)) return false; return true; };
    const feet = (x, y) => ({ x: x * TS + TS / 2, y: (y + 1) * TS });
    lv.spawn = feet(L.spawnT.x, L.spawnT.y);
    const placed = [];
    const add = (kind, x, y, extra) => { const ob = Object.assign({ kind }, feet(x, y), extra || {}); ob.tx = x; ob.ty = y; lv.objects.push(ob); placed.push(ob); return ob; };
    add('exit', L.exitT.x, L.exitT.y);
    const far = (x, y, d) => placed.every((p) => Math.abs(p.tx - x) >= d || Math.abs(p.ty - y) >= 4);
    const distSpawn = (x, y) => Math.hypot(x - L.spawnT.x, y - L.spawnT.y);

    // candidate spots per room
    const holeCols = new Set();
    for (const h of L.holes) for (let x = h.x - 1; x <= h.x + 3; x++) holeCols.add(x);
    const spotsOf = (R, hw, clear) => {
      const out = [];
      for (let y = R.iy0 + 1; y <= R.S + 2; y++) for (let x = R.ix0 + 1; x <= R.ix1 - 1; x++) {
        if (holeCols.has(x)) continue;
        if (hw ? flat(x, y, hw, clear) : spot(x, y, clear, true)) out.push({ x, y, R });
      }
      return out;
    };
    const pathLen = L.path.length;
    const pickIn = (rooms, kind, hw, clear, minSp, extra) => {
      for (const R of rooms) {
        const sp = rng.shuffle(spotsOf(R, hw, clear)).filter((s) => distSpawn(s.x, s.y) > 10 && far(s.x, s.y, minSp));
        if (!sp.length) continue;
        // prefer spots away from the room's entrances (the far end of dead ends)
        const s = sp[0];
        return add(kind, s.x, s.y, extra);
      }
      return null;
    };
    const deadRooms = rng.shuffle(L.rooms.filter((R) => R.dead));
    const offPath = rng.shuffle(L.rooms.filter((R) => !R.onPath && !R.dead));
    const midPath = rng.shuffle(L.rooms.filter((R) => R.onPath && R.pathIdx > pathLen * 0.25 && R.pathIdx < pathLen * 0.8));
    const anyPath = rng.shuffle(L.rooms.filter((R) => R.onPath && R.pathIdx > 0));
    const all = rng.shuffle(L.rooms.slice());

    // shop (0-1): wide flat spot on the main path, middle of the level
    if (rng.chance(0.65)) pickIn(midPath, 'shop', 2, 4, 8);
    // chests 1-3: dead ends first
    const nChest = rng.int(1, 3);
    for (let i = 0; i < nChest; i++) pickIn(deadRooms.concat(offPath, anyPath), 'chest', 1, 3, 8);
    // scrolls 2-3
    const nScroll = rng.int(2, 3);
    for (let i = 0; i < nScroll; i++) pickIn(i === 0 ? deadRooms.concat(midPath, all) : rng.shuffle(midPath.concat(offPath, deadRooms, all)), 'scroll', 0, 3, 8);
    // weapons 1-2
    const nWeap = rng.int(1, 2);
    for (let i = 0; i < nWeap; i++) pickIn(rng.shuffle(anyPath.concat(offPath)), 'weapon', 0, 3, 8);
    // food 1-2
    const nFood = rng.int(1, 2);
    for (let i = 0; i < nFood; i++) pickIn(rng.shuffle(all.slice()), 'food', 0, 3, 8);

    // enemy spawns
    const want = Math.round(G.clamp((25 + o.depth * 7) * B.density * rng.float(0.95, 1.12), 25, 45));
    const ground = [];
    for (const R of L.rooms) {
      for (let y = R.iy0 + 1; y <= R.S + 2; y++) for (let x = R.ix0; x <= R.ix1; x++) {
        if (!spot(x, y, 3, false)) continue;
        if (distSpawn(x, y) < 13) continue;
        ground.push({ x, y, R });
      }
    }
    const taken = [];
    const okE = (x, y, d) => taken.every((e) => Math.abs(e.x - x) >= d || Math.abs(e.y - y) >= 3) && placed.every((p) => p.kind === 'scroll' || Math.abs(p.tx - x) >= 3 || Math.abs(p.ty - y) >= 3);
    const nAir = Math.round(want * rng.float(0.14, 0.22));
    // air spawns: open 5x5 boxes a few tiles above reachable floors
    const air = [];
    for (const g of rng.shuffle(ground.slice())) {
      if (air.length >= nAir * 3) break;
      const ay = g.y - rng.int(3, 5);
      let ok = true;
      for (let yy = ay - 3; yy <= ay + 1 && ok; yy++) for (let xx = g.x - 2; xx <= g.x + 2; xx++) if (t(xx, yy) !== T.AIR) { ok = false; break; }
      if (ok) air.push({ x: g.x, y: ay, air: true });
    }
    const ground2 = rng.shuffle(ground);
    for (const a of air) { if (taken.filter((e) => e.air).length >= nAir) break; if (okE(a.x, a.y, 6)) taken.push(a); }
    for (const g of ground2) { if (taken.length >= want) break; if (okE(g.x, g.y, 5)) taken.push({ x: g.x, y: g.y, air: false }); }
    for (const g of ground2) { if (taken.length >= want) break; if (okE(g.x, g.y, 3)) taken.push({ x: g.x, y: g.y, air: false }); }
    lv.enemySpawns = taken.map((e) => Object.assign(feet(e.x, e.y), { air: !!e.air }));
    lv._vis = vis;
    return true;
  }

  function buildBiome(o) {
    const B = G.BIOMES[o.biome];
    const base = new G.RNG(((o.seed >>> 0) ^ G.hashStr(o.biome) ^ Math.imul(o.depth + 1, 0x9e3779b1)) >>> 0);
    let L = null, attempts = 0;
    for (; attempts < 16; attempts++) {
      const rng = base.fork();
      L = layoutBiome(o, B, rng);
      if (placeContent(o, B, rng, L)) break;
      L.failed = true;
    }
    const lv = L.lv;
    if (L.failed) console.warn('[level] no traversable layout after ' + attempts + ' attempts', o);
    lv.meta = { attempts, path: L.path.map((c) => ({ c: c.c, r: c.r })), holes: L.holes.length, grid: { gw: L.gw, gh: L.gh, cw: L.CW, ch: L.CH } };
    lv.rooms = L.rooms.map((R) => ({ x: R.x, y: R.y, w: R.w, h: R.h, kind: R.kind, onPath: R.onPath, dead: R.dead, ix0: R.ix0, ix1: R.ix1, iy0: R.iy0, S: R.S, open: !!R.open }));
    lv._layout = L;
    return lv;
  }

  // ================================================================ hand-authored rooms
  // Legend: '#' solid, '.' air, '=' platform, 'H' ladder, '^' spikes,
  //         'S' spawn, 'E' exit, 'L' locked exit, 'h' healstation, 'c' collector, '$' shop, 'B' boss
  const TRANSIT_MAP_B = [
    '########################################',
    '########################################',
    '########################################',
    '########################################',
    '###########..................###########',
    '####................................####',
    '###..................................###',
    '###..................................###',
    '###..................................###',
    '###..................................###',
    '###..........h.....c....$............###',
    '###.......###################........###',
    '###..S...#####################...E...###',
    '########################################',
    '########################################',
    '########################################',
    '########################################',
  ];
  // decor anchors per transit layout (tiles)
  const TRANSIT_DECOR = [
    { win: { x: 13, y: 7, w: 6, h: 3 }, safe: { x: 6, y: 7 }, vend: { x: 22, y: 10 }, bench: { x: 8, y: 12 }, plant: { x: 31, y: 12 }, poster: { x: 20, y: 8 }, tiles: 1 },
    { win: { x: 5, y: 6, w: 4, h: 3 }, safe: { x: 30, y: 6 }, vend: { x: 30, y: 10 }, bench: { x: 3, y: 12 }, plant: { x: 11, y: 10 }, poster: { x: 16, y: 7 }, tiles: 0 },
  ];
  const TRANSIT_MAP = [
    '########################################',
    '########################################',
    '########################################',
    '########################################',
    '####################..##################',
    '######..............................####',
    '####................................####',
    '###..................................###',
    '###..................................###',
    '###..................................###',
    '###..................................###',
    '###..................................###',
    '###..S....h......c........$.......E..###',
    '########################################',
    '########################################',
    '########################################',
    '########################################',
  ];
  const BOSS_MAP = [
    '##############################################',
    '##############################################',
    '###......................................#####',
    '##........................................####',
    '##..........................................##',
    '##..........................................##',
    '##..........................................##',
    '##..........................................##',
    '##..................==========..............##',
    '##..........................................##',
    '##..........................................##',
    '##..........................................##',
    '##.....======....................======.....##',
    '##..........................................##',
    '##..........................................##',
    '##..........................................##',
    '##..S.........................B..........L..##',
    '##############################################',
    '##############################################',
    '##############################################',
  ];

  function buildFromMap(o, map) {
    const H = map.length, W = map[0].length;
    const lv = new Level(W, H, o);
    const marks = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const ch = map[y][x];
      let v = T.AIR;
      if (ch === '#') v = T.SOLID; else if (ch === '=') v = T.PLATFORM; else if (ch === 'H') v = T.LADDER; else if (ch === '^') v = T.SPIKES;
      lv.tiles[y * W + x] = v;
      if ('SELhc$B'.includes(ch)) marks.push({ ch, x, y });
    }
    const feet = (x, y) => ({ x: x * TS + TS / 2, y: (y + 1) * TS });
    for (const m of marks) {
      const f = feet(m.x, m.y);
      if (m.ch === 'S') lv.spawn = f;
      else if (m.ch === 'E') lv.objects.push(Object.assign({ kind: 'exit' }, f));
      else if (m.ch === 'L') lv.objects.push(Object.assign({ kind: 'exit', locked: true }, f));
      else if (m.ch === 'h') lv.objects.push(Object.assign({ kind: 'healstation' }, f));
      else if (m.ch === 'c') lv.objects.push(Object.assign({ kind: 'collector' }, f));
      else if (m.ch === '$') lv.objects.push(Object.assign({ kind: 'shop' }, f));
      else if (m.ch === 'B') lv.objects.push(Object.assign({ kind: 'boss' }, f));
    }
    for (const ob of lv.objects) { ob.tx = Math.floor(ob.x / TS); ob.ty = Math.floor((ob.y - 1) / TS); }
    // single room covering the interior
    let x0 = W, x1 = 0, y0 = H, y1 = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (lv.tiles[y * W + x] !== T.SOLID) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    lv.rooms = [{ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, kind: o.kind, onPath: true, ix0: x0, ix1: x1, iy0: y0, S: y1 }];
    return lv;
  }

  function buildTransit(o) {
    const variant = (o.seed >>> 0) % 2;
    const lv = buildFromMap(o, variant ? TRANSIT_MAP_B : TRANSIT_MAP);
    lv.meta = { attempts: 0, variant };
    return lv;
  }
  function buildBoss(o) {
    const lv = buildFromMap(o, BOSS_MAP);
    const floorY = lv.spawn.y;
    lv.arena = { x0: 2 * TS, x1: (lv.w - 2) * TS, floorY, ceilY: 2 * TS };
    lv.meta = { attempts: 0 };
    return lv;
  }

  // ================================================================ public API
  G.Level = {
    generate(opts) {
      const o = Object.assign({ seed: 1, biome: 'scrap', depth: 0, kind: 'biome' }, opts || {});
      o.seed = (o.seed >>> 0) || 1;
      if (!G.BIOMES[o.biome]) o.biome = 'scrap';
      if (o.kind === 'boss' && !opts.biome) o.biome = 'core';
      const t0 = performance.now();
      let lv;
      if (o.kind === 'transit') lv = buildTransit(o);
      else if (o.kind === 'boss') lv = buildBoss(o);
      else { o.kind = 'biome'; lv = buildBiome(o); }
      decorate(lv, new G.RNG((o.seed ^ 0xdec0de) >>> 0));
      lv.genMs = performance.now() - t0;
      return lv;
    },
    reach: reachability,
    Class: Level,
  };

  // ================================================================ DECOR PLACEMENT
  // Decor items use world px. `lv.decor` items are baked into back-wall chunks, `lv.anims` are
  // redrawn every frame (LEDs, screens, fans, holograms), `lv.glows` are light sources (runtime
  // flicker + optional baked light pool on the back wall), `lv.fg` are foreground silhouettes.
  function pseudoGlyph(r) {
    // 7x7 kanji-like glyph as 49-char bitstring
    const g = new Array(49).fill(0);
    const hl = (y, x0, x1) => { for (let x = x0; x <= x1; x++) g[y * 7 + x] = 1; };
    const vl = (x, y0, y1) => { for (let y = y0; y <= y1; y++) g[y * 7 + x] = 1; };
    const kind = r.int(0, 3);
    if (kind === 0) { hl(0, 0, 6); vl(3, 0, 6); hl(3, 1, 5); hl(6, 0, 6); }
    else if (kind === 1) { hl(1, 0, 6); vl(1, 1, 6); vl(5, 1, 6); hl(4, 1, 5); hl(6, 1, 5); }
    else if (kind === 2) { vl(0, 0, 6); hl(0, 0, 3); hl(3, 0, 3); vl(3, 0, 3); vl(5, 0, 6); hl(5, 4, 6); }
    else { hl(0, 1, 5); vl(3, 0, 6); hl(2, 0, 6); g[4 * 7 + 1] = g[5 * 7 + 0] = g[4 * 7 + 5] = g[5 * 7 + 6] = 1; }
    for (let i = 0; i < 3; i++) if (r.chance(0.6)) g[r.int(0, 48)] ^= 1;
    return g;
  }

  function decorate(lv, rng) {
    const W = lv.w, H = lv.h, P = lv.pal, B = lv.B;
    const tl = lv.tiles;
    const tt = (x, y) => lv.tile(x, y);
    const isSolid = (x, y) => tt(x, y) === T.SOLID;
    const occ = new Uint8Array(W * H);
    const back = lv.back;
    for (let i = 0; i < W * H; i++) back[i] = tl[i] === T.SOLID ? 0 : 1;
    const style = lv.kind === 'transit' ? 'transit' : lv.kind === 'boss' ? 'core' : lv.biome;
    lv.style = style;
    lv.fg = [];
    lv.puddles = [];
    const add = (t, x, y, w, h, extra) => {
      const it = Object.assign({ t, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), s: rng.int(1, 0x7fffffff) }, extra || {});
      lv.decor.push(it); return it;
    };
    const anim = (t, x, y, w, h, extra) => { const it = Object.assign({ t, x: Math.round(x), y: Math.round(y), w, h, s: rng.int(1, 0x7fffffff) }, extra || {}); lv.anims.push(it); return it; };
    const glow = (x, y, r, c, a, extra) => { const g = Object.assign({ x: Math.round(x), y: Math.round(y), r, c, a, fl: 0, ph: rng.float(0, 100), bake: 0 }, extra || {}); lv.glows.push(g); return g; };
    const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
    // area test in tiles: every tile non-solid (strict: AIR only), unoccupied, with a back wall
    const free = (x0, y0, x1, y1, strict = true, needWall = true) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (!inb(x, y)) return false;
        const i = y * W + x, v = tl[i];
        if (v === T.SOLID || (strict && v !== T.AIR) || occ[i] || (needWall && back[i] !== 1)) return false;
      }
      return true;
    };
    const mark = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inb(x, y)) occ[y * W + x] = 1; };
    const neon = () => rng.pick(P.neon);

    // ------------------------------------------------ open sky: facades with skyline gaps (slums)
    for (const R of lv.rooms) {
      if (!R.open) continue;
      let x = R.x - 1;
      while (x <= R.x + R.w) {
        const segW = rng.int(5, 12);
        const floorY = R.S;
        const gap = rng.chance(0.22);
        const topY = gap ? floorY - rng.int(2, 4) : Math.max(1, floorY - rng.int(7, 14));
        for (let xx = x; xx < x + segW && xx <= R.x + R.w; xx++) for (let y = 0; y < topY; y++) if (inb(xx, y) && tl[y * W + xx] !== T.SOLID) back[y * W + xx] = 0;
        if (!gap) add('roof', x * TS, topY * TS, segW * TS, TS, { top: topY });
        x += segW;
      }
    }

    // ------------------------------------------------ helpers over rooms
    const groundCells = (R) => {
      const out = [];
      for (let y = R.iy0; y <= R.S + 2; y++) for (let x = R.ix0; x <= R.ix1; x++) {
        if (tt(x, y) === T.AIR && isSolid(x, y + 1) && tt(x, y - 1) === T.AIR) out.push({ x, y });
      }
      return out;
    };
    const ceilCells = (R) => {
      const out = [];
      for (let y = R.iy0; y <= R.S; y++) for (let x = R.ix0; x <= R.ix1; x++) if (tt(x, y) === T.AIR && isSolid(x, y - 1)) out.push({ x, y });
      return out;
    };
    // place a w x h (tiles) prop standing on the ground; returns top-left tile or null
    const placeFloor = (R, w, h, tries = 12, needWall = true) => {
      const gc = rng.shuffle(groundCells(R));
      for (let i = 0; i < Math.min(tries, gc.length); i++) {
        const { x, y } = gc[i];
        const x0 = x, y0 = y - h + 1;
        let ok = free(x0, y0, x0 + w - 1, y, true, needWall);
        for (let k = 0; ok && k < w; k++) if (!isSolid(x0 + k, y + 1)) ok = false;
        if (ok) { mark(x0, y0, x0 + w - 1, y); return { x: x0, y: y0 }; }
      }
      return null;
    };
    // wall-mounted rect somewhere in the room (optionally within a row band)
    const placeWall = (R, w, h, yMin, yMax, tries = 16, strict = true) => {
      for (let i = 0; i < tries; i++) {
        const x0 = rng.int(R.ix0, Math.max(R.ix0, R.ix1 - w + 1));
        const y0 = rng.int(yMin, Math.max(yMin, yMax - h + 1));
        if (free(x0, y0, x0 + w - 1, y0 + h - 1, strict)) { mark(x0, y0, x0 + w - 1, y0 + h - 1); return { x: x0, y: y0 }; }
      }
      return null;
    };

    // ------------------------------------------------ per-style recipes
    const signs = B.signs;
    const addSign = (R, opts = {}) => {
      R.usedSigns = R.usedSigns || [];
      let text = opts.text;
      for (let k = 0; !text && k < 6; k++) { const t = rng.pick(signs); if (!R.usedSigns.includes(t)) text = t; }
      text = text || rng.pick(signs);
      R.usedSigns.push(text);
      const scale = opts.scale || (text.length <= 7 ? 2 : 1);
      const wpx = G.font.width(text, scale) + 10, hpx = 5 * scale + 10;
      const w = Math.ceil(wpx / TS), h = Math.ceil(hpx / TS);
      const p = opts.at || placeWall(R, w, h, R.iy0 + 1, Math.min(R.S - 3, R.iy0 + 6));
      if (!p) return null;
      const c = opts.c || opts.color || neon();
      const it = add('neon', p.x * TS + ((w * TS - wpx) >> 1), p.y * TS + ((h * TS - hpx) >> 1), wpx, hpx, { text, scale, c, box: opts.box != null ? opts.box : rng.chance(0.6) });
      glow(it.x + wpx / 2, it.y + hpx / 2, Math.max(36, wpx * 0.8), c, 0.3, { fl: rng.chance(0.35) ? 2 : 1, bake: 0.3, br: Math.max(60, wpx * 1.3), tube: it });
      return it;
    };
    const addVSign = (R) => {
      const n = rng.int(3, 5);
      const hpx = n * 9 + 5, wpx = 13;
      const h = Math.ceil(hpx / TS);
      const p = placeWall(R, 1, h, R.iy0, R.S - 2);
      if (!p) return null;
      const c = neon();
      const glyphs = []; for (let i = 0; i < n; i++) glyphs.push(pseudoGlyph(rng));
      const it = add('vsign', p.x * TS + 1, p.y * TS + 2, wpx, hpx, { c, glyphs });
      glow(it.x + 6, it.y + hpx / 2, 30, c, 0.3, { fl: rng.chance(0.3) ? 2 : 1, bake: 0.3, br: 64, tube: it });
      return it;
    };
    const addLamps = (R, kind, color, every) => {
      const cc = ceilCells(R).filter((c) => c.y <= R.iy0 + 3);
      let lastX = -99;
      for (const c of cc.sort((a, b) => a.x - b.x)) {
        if (c.x - lastX < every + rng.int(-2, 2)) continue;
        if (occ[c.y * W + c.x]) continue;
        // hang length: keep >= 5 tiles above the floor
        let fy = c.y; while (fy < H && !isSolid(c.x, fy + 1) && tt(c.x, fy + 1) !== T.PLATFORM) fy++;
        const room = fy - c.y;
        if (room < 5) continue;
        const len = G.clamp(rng.int(4, 26), 4, (room - 4) * TS);
        const it = add('lamp', c.x * TS + 8, c.y * TS, 16, len + 10, { kind, c: color, len });
        mark(c.x, c.y, c.x, c.y + Math.floor(len / TS));
        glow(c.x * TS + 8, c.y * TS + len + 5, 52, color, 0.38, { fl: rng.chance(0.2) ? 2 : 1, bake: 0.38, br: 110, cone: kind !== 'lantern' ? 1 : 0 });
        lastX = c.x;
      }
    };
    const addPipes = (R, n, colors) => {
      for (let k = 0; k < n; k++) {
        const y = rng.int(R.iy0, Math.max(R.iy0, R.S - 3));
        let x0 = R.ix0, x1 = R.ix1;
        // shrink to a run of free tiles
        const xs = []; for (let x = x0; x <= x1; x++) if (!isSolid(x, y) && back[y * W + x] === 1) xs.push(x);
        if (xs.length < 6) continue;
        const d = rng.pick([4, 5, 6, 8]);
        add('pipe', R.ix0 * TS - 8, y * TS + rng.int(2, 8), (R.ix1 - R.ix0 + 1) * TS + 16, d, { c: rng.pick(colors), d, flange: rng.int(28, 56) });
      }
    };
    const addCables = (R, n) => {
      for (let k = 0; k < n; k++) {
        const x0 = rng.int(R.ix0, R.ix1 - 6), x1 = Math.min(R.ix1 + 1, x0 + rng.int(6, 16));
        const y0 = R.iy0 + rng.int(0, 2), y1 = R.iy0 + rng.int(0, 2);
        const sag = rng.int(10, 30);
        add('cable', x0 * TS, Math.min(y0, y1) * TS, (x1 - x0) * TS, Math.abs(y1 - y0) * TS + sag + 4, { y0: y0 * TS, y1: y1 * TS, sag, c: rng.chance(0.3) ? neon() : null, n: rng.int(1, 3) });
      }
    };
    const addChains = (R, n) => {
      const cc = rng.shuffle(ceilCells(R));
      for (let k = 0, i = 0; k < n && i < cc.length; i++) {
        const c = cc[i];
        let fy = c.y; while (fy < H && tt(c.x, fy + 1) === T.AIR) fy++;
        if (fy - c.y < 4) continue;
        const len = rng.int(24, Math.min(110, (fy - c.y - 2) * TS));
        add('chain', c.x * TS + rng.int(4, 11), c.y * TS, 5, len + 6, { len, hook: rng.chance(0.5) });
        k++;
      }
    };
    const addWindow = (R, style) => {
      const w = rng.int(3, 5), h = rng.int(3, 4);
      const p = placeWall(R, w, h, R.iy0 + 1, R.S - 3);
      if (!p) return null;
      for (let y = p.y; y < p.y + h; y++) for (let x = p.x; x < p.x + w; x++) back[y * W + x] = 2;
      const it = add('window', p.x * TS, p.y * TS, w * TS, h * TS, { style });
      const wc = style === 'furnace' ? '#ff5a1a' : style === 'scrap' ? '#ff9a4a' : style === 'clear' ? '#c89a7a' : P.amb;
      glow(it.x + it.w / 2, it.y + it.h / 2, 70, wc, style === 'furnace' ? 0.35 : 0.18, { bake: style === 'furnace' ? 0.55 : 0.35, br: 110, shaft: 1, fl: style === 'furnace' ? 3 : 0 });
      return it;
    };
    const addGirders = (R) => {
      let x = R.ix0 + rng.int(3, 6);
      while (x < R.ix1 - 2) {
        // column from ceiling to floor, free of tiles
        let y0 = R.iy0; while (y0 < R.S && isSolid(x, y0)) y0++;
        let ok = true, y1 = y0;
        while (y1 < H && !isSolid(x, y1 + 1)) y1++;
        if (y1 - y0 < 4) ok = false;
        for (let y = y0; y <= y1 && ok; y++) if (occ[y * W + x] || back[y * W + x] !== 1) ok = false;
        if (ok) { add('girder', x * TS + 2, y0 * TS, 12, (y1 - y0 + 1) * TS, {}); for (let y = y0; y <= y1; y++) occ[y * W + x] = 1; }
        x += rng.int(8, 14);
      }
    };

    // ------------------------------------------------ object backdrops (shop kiosk, exit housing)
    for (const o of lv.objects) {
      if (o.kind === 'shop') {
        add('kiosk', o.x - 44, o.y - 58, 88, 58, { c: '#ffc23d' });
        mark(Math.floor((o.x - 48) / TS), Math.floor((o.y - 80) / TS), Math.floor((o.x + 48) / TS), Math.floor((o.y - 1) / TS));
        const it = add('neon', o.x - 17, o.y - 76, G.font.width('SHOP', 2) + 10, 20, { text: 'SHOP', scale: 2, c: '#ffc23d', box: true });
        glow(o.x, o.y - 66, 40, '#ffc23d', 0.3, { fl: 1, bake: 0.35, br: 90, tube: it });
      } else if (o.kind === 'exit') {
        add('exitframe', o.x - 22, o.y - 52, 44, 52, { c: o.locked ? '#ff3348' : '#27f3ff' });
        mark(Math.floor((o.x - 24) / TS), Math.floor((o.y - 70) / TS), Math.floor((o.x + 24) / TS), Math.floor((o.y - 1) / TS));
        glow(o.x, o.y - 30, 70, o.locked ? '#ff3348' : '#27f3ff', 0.2, { bake: 0.5, br: 120 });
      } else if (o.kind === 'healstation' || o.kind === 'collector') {
        add('tubes', o.x - 14, o.y - 64, 28, 30, { c: o.kind === 'healstation' ? '#48ff8a' : '#35c8ff' });
        mark(Math.floor((o.x - 14) / TS), Math.floor((o.y - 64) / TS), Math.floor((o.x + 14) / TS), Math.floor((o.y - 1) / TS));
      }
    }

    // ------------------------------------------------ transit / boss specific
    if (lv.kind === 'transit') {
      const R = lv.rooms[0];
      const fy = R.S;
      const D = TRANSIT_DECOR[lv.meta.variant || 0];
      if (D.tiles) add('tiles', R.ix0 * TS, (fy - 2) * TS + 8, (R.ix1 - R.ix0 + 1) * TS, 40, {});
      addLamps(R, 'bulb', '#ffc27a', 7);
      const win = D.win;
      for (let y = win.y; y < win.y + win.h; y++) for (let x = win.x; x < win.x + win.w; x++) { back[y * W + x] = 2; occ[y * W + x] = 1; }
      add('window', win.x * TS, win.y * TS, win.w * TS, win.h * TS, { style: 'transit' });
      glow((win.x + win.w / 2) * TS, (win.y + win.h / 2) * TS, 80, '#8ab4ff', 0.15, { bake: 0.3, br: 120, shaft: 1 });
      addSign(R, { text: 'SAFE', c: '#48ff8a', box: true, at: D.safe });
      vending(D.vend.x, D.vend.y);
      add('bench', D.bench.x * TS - 4, D.bench.y * TS + 4, 40, 12, {});
      add('plant', D.plant.x * TS, (D.plant.y - 1) * TS, 16, 32, {});
      add('poster', D.poster.x * TS + 4, D.poster.y * TS, 26, 26, { c: '#27f3ff', graffiti: false });
      add('pipe', 3 * TS, 5 * TS + 6, 34 * TS, 5, { c: '#4a4a5c', d: 5, flange: 40 });
    }
    if (lv.kind === 'boss') {
      const R = lv.rooms[0];
      addLamps(R, 'cage', P.lamp, 14);
      // huge viewport onto the reactor chamber (parallax background shows the core)
      const vp = { x: 7, y: 2, w: W - 14, h: 10 };
      for (let y = vp.y; y < vp.y + vp.h; y++) for (let x = vp.x; x < vp.x + vp.w; x++) back[y * W + x] = 2;
      add('window', vp.x * TS, vp.y * TS, vp.w * TS, vp.h * TS, { style: 'core' });
      for (let y = vp.y; y < vp.y + vp.h; y++) for (let x = vp.x; x < vp.x + vp.w; x++) occ[y * W + x] = 1;
      for (const x of [4, W - 5]) add('girder', x * TS + 2, 2 * TS, 12, 15 * TS, {});
      add('pipe', 2 * TS, 12 * TS + 4, (W - 4) * TS, 6, { c: '#4a1a2a', d: 6, flange: 48 });
      addChains(R, 3);
      add('neon', 5 * TS, 9 * TS, G.font.width('DANGER', 2) + 10, 20, { text: 'DANGER', scale: 2, c: P.lamp, box: true });
      glow(5 * TS + 25, 9 * TS + 10, 50, P.lamp, 0.5, { fl: 2, bake: 0.5, br: 80, tube: lv.decor[lv.decor.length - 1] });
      for (const bx of [4, 20, 36]) { const it = add('beacon', bx * TS + 3, 2 * TS + 1, 10, 8, {}); anim('beacon', it.x + 5, it.y + 3, 1, 1, { c: P.lamp }); }
      addCables(R, 3);
    }

    const setWallVar = (R, v) => {
      if (!v) return;
      for (let y = R.iy0 - 1; y <= R.S + 3; y++) for (let x = R.ix0 - 1; x <= R.ix1 + 1; x++) if (inb(x, y)) lv.wallVar[y * W + x] = v;
    };
    const screenAt = (R, c) => {
      const p = placeWall(R, 2, 2, R.iy0 + 1, R.S - 2);
      if (!p) return;
      const it = add('screen', p.x * TS + 2, p.y * TS + 4, 28, 20, { c });
      anim('screen', it.x + 3, it.y + 3, 22, 13, { c });
      glow(it.x + 14, it.y + 10, 34, c, 0.35, { fl: 1, bake: 0.35, br: 60 });
    };
    const racks = (R, rows) => {
      for (let k = rows; k > 0; k--) {
        const n = rng.int(1, 3);
        const p = placeFloor(R, 2 * n, 3);
        if (!p) continue;
        for (let j = 0; j < n; j++) { const it = add('rack', (p.x + j * 2) * TS + 2, p.y * TS, 28, 48, {}); anim('leds', it.x, it.y, 28, 48, {}); }
        glow((p.x + n) * TS, p.y * TS + 20, 26 + n * 12, P.lamp2, 0.22, { bake: 0.35, br: 50 + n * 20 });
      }
    };
    const dataStreams = (R, n) => {
      for (let k = n; k > 0; k--) {
        const p = placeWall(R, 1, 4, R.iy0, R.S - 1, 10, false);
        if (!p) continue;
        const c = rng.pick([P.lamp2, '#27f3ff', '#9b5cff', '#48ff8a']);
        add('dataslot', p.x * TS + 2, p.y * TS - 2, 12, 68, { c });
        anim('data', p.x * TS + 4, p.y * TS, 8, 64, { c });
        glow(p.x * TS + 8, p.y * TS + 32, 30, c, 0.12, { bake: 0.3, br: 50 });
      }
    };
    const terminal = (R, c) => {
      const p = placeFloor(R, 2, 2);
      if (!p) return;
      const it = add('terminal', p.x * TS, p.y * TS, 32, 32, {});
      anim('screen', it.x + 11, it.y + 5, 14, 9, { c });
      glow(it.x + 18, it.y + 10, 30, c, 0.35, { bake: 0.35, br: 56 });
    };
    const plant = (R) => { const p = placeFloor(R, 1, 2); if (p) add('plant', p.x * TS, p.y * TS, 16, 32, {}); };
    const vpipe = (R, colors) => {
      // vertical pipe from ceiling to floor, hugging a free column
      for (let tries = 0; tries < 8; tries++) {
        const x = rng.int(R.ix0, R.ix1);
        let y0 = R.iy0; while (y0 < R.S && isSolid(x, y0)) y0++;
        let y1 = y0; while (y1 < H - 1 && !isSolid(x, y1 + 1)) y1++;
        if (y1 - y0 < 6) continue;
        let ok = true;
        for (let y = y0; y <= y1 && ok; y++) if (occ[y * W + x] || back[y * W + x] !== 1) ok = false;
        if (!ok) continue;
        const d = rng.pick([5, 6, 8]);
        add('pipe', x * TS + 4, y0 * TS - 4, d, (y1 - y0 + 1) * TS + 8, { c: rng.pick(colors), d, flange: rng.int(28, 56), vert: 1 });
        for (let y = y0; y <= y1; y++) occ[y * W + x] = 1;
        return;
      }
    };
    // denser wall dressing for big rooms (shafts / arenas / tall alleys)
    const fillWall = (R) => {
      const ih = R.S - R.iy0 + 1, iw = R.ix1 - R.ix0 + 1;
      const n = Math.max(0, Math.round(iw * ih / 110) - 2);
      for (let k = 0; k < n; k++) {
        const roll = rng.next();
        if (style === 'scrap') {
          if (roll < 0.22) vpipe(R, ['#3e4a52', '#5a4a42', '#6a3a24']);
          else if (roll < 0.4) screenAt(R, P.lamp2);
          else if (roll < 0.55) addSign(R, { box: true });
          else if (roll < 0.7) addWindow(R, rng.pick(['scrap', 'clear']));
          else if (roll < 0.82) { const p = placeWall(R, 3, 2, R.iy0 + 1, R.S - 2); if (p) add('hazard', p.x * TS, p.y * TS + 4, 48, 24, {}); }
          else { const p = placeWall(R, 2, 2, R.iy0, R.S - 2); if (p) { add('fan', p.x * TS, p.y * TS, 32, 32, {}); anim('fan', p.x * TS + 16, p.y * TS + 16, 12, 12, {}); } }
        } else if (style === 'spire') {
          if (roll < 0.3) dataStreams(R, 1);
          else if (roll < 0.55) screenAt(R, rng.pick([P.lamp2, '#9b5cff']));
          else if (roll < 0.7) addSign(R, { box: false, c: rng.pick([P.trim, P.lamp2]) });
          else vpipe(R, ['#2a3456', '#1c2442']);
        } else if (style === 'slums') {
          if (roll < 0.35) addSign(R);
          else if (roll < 0.55) addVSign(R);
          else if (roll < 0.75) { const p = placeWall(R, 2, 1, R.iy0 + 1, R.S - 3); if (p) { const it = add('ac', p.x * TS + 4, p.y * TS + 2, 22, 14, {}); anim('fan', it.x + 7, it.y + 7, 5, 5, { small: 1 }); } }
          else vpipe(R, ['#2a2838', '#3a3448']);
        } else if (style === 'core') {
          if (roll < 0.35) vpipe(R, ['#4a1a2a', '#3a2a3a']);
          else if (roll < 0.6) screenAt(R, P.lamp2);
          else addSign(R, { box: true, c: rng.pick(P.neon) });
        }
      }
    };

    for (const R of lv.rooms) {
      if (lv.kind !== 'biome') break;
      decorateRoom(R);
      fillWall(R);
    }
    function decorateRoom(R) {
      const ih = R.S - R.iy0 + 1, iw = R.ix1 - R.ix0 + 1;
      const area = iw * ih;
      if (style === 'scrap') {
        // room themes: processing plant, prison cell block, control room, furnace hall
        const theme = rng.weighted([['plant', 4], ['cells', 2], ['control', 1.6], ['furnace', 1.6]]);
        setWallVar(R, { plant: 0, cells: 1, control: 2, furnace: 3 }[theme]);
        addGirders(R);
        if (theme === 'furnace') {
          for (let k = rng.int(1, 3); k > 0; k--) if (ih >= 7) addWindow(R, 'furnace');
          addLamps(R, 'cage', '#ff5a2a', rng.int(9, 13));
          addPipes(R, rng.int(1, 2), ['#6a3a24', '#5a4a42']);
          for (let k = rng.int(1, 3); k > 0; k--) { const p = placeFloor(R, 1, 1); if (p) add('barrel', p.x * TS, p.y * TS, 16, 16, { toxic: false }); }
          if (rng.chance(0.6)) addSign(R, { box: true, text: rng.pick(['HOT', 'DANGER', 'SMELTER']), c: '#ff4a2a' });
          addChains(R, rng.int(1, 3));
        } else if (theme === 'cells') {
          for (let k = rng.int(2, 3); k > 0; k--) { const p = placeFloor(R, 3, 4); if (p) add('cage', p.x * TS, p.y * TS, 48, 64, { body: rng.chance(0.5) }); }
          addLamps(R, 'tube', '#9af0e0', rng.int(8, 12));
          addChains(R, rng.int(2, 4));
          if (rng.chance(0.6)) addSign(R, { box: true, text: rng.pick(['BLOCK C', 'UNIT 9', 'CELL 42', 'NO EXIT']), c: rng.pick([P.trim2, '#ff4a3a']) });
          if (rng.chance(0.4)) { const p = placeWall(R, 3, 2, R.iy0 + 1, R.S - 2); if (p) add('hazard', p.x * TS, p.y * TS + 4, 48, 24, {}); }
        } else if (theme === 'control') {
          for (let k = rng.int(2, 4); k > 0; k--) screenAt(R, P.lamp2);
          addLamps(R, 'tube', '#9af0e0', rng.int(9, 13));
          if (rng.chance(0.5)) addWindow(R, 'scrap');
          addPipes(R, 1, ['#3e4a52']);
          if (rng.chance(0.7)) addSign(R, { box: true, text: rng.pick(['CONTROL', 'SECTOR 7', 'RECYCLE']), c: P.trim2 });
          if (rng.chance(0.5)) { const p = placeFloor(R, 2, 2); if (p) { const it = add('terminal', p.x * TS, p.y * TS, 32, 32, { scrap: 1 }); anim('screen', it.x + 11, it.y + 5, 14, 9, { c: P.lamp2 }); glow(it.x + 18, it.y + 10, 30, P.lamp2, 0.35, { bake: 0.3, br: 50 }); } }
        } else {
          if (ih >= 7 && rng.chance(0.55)) addWindow(R, rng.chance(0.5) ? 'scrap' : 'clear');
          addLamps(R, 'sodium', P.lamp, rng.int(7, 11));
          if (rng.chance(0.75)) addPipes(R, rng.int(1, 2), ['#5a4a42', '#3e4a52', '#6a3a24']);
          if (rng.chance(0.5)) addSign(R, { box: true, c: rng.pick([P.trim, P.trim2, '#ffcf3a']) });
          if (rng.chance(0.35)) screenAt(R, P.lamp2);
          if (iw >= 14 && rng.chance(0.5)) { const y = rng.int(R.iy0 + 2, R.S - 4); if (free(R.ix0 + 2, y, R.ix0 + 10, y)) { const x0 = R.ix0 + rng.int(1, 3), len = rng.int(8, Math.min(20, iw - 4)); add('conveyor', x0 * TS, y * TS + 6, len * TS, 12, {}); anim('belt', x0 * TS, y * TS + 6, len * TS, 3, {}); mark(x0, y, x0 + len, y); } }
          for (let k = rng.int(0, 3); k > 0; k--) { const p = placeFloor(R, 1, 1); if (p) add(rng.chance(0.5) ? 'crate' : 'barrel', p.x * TS, p.y * TS, 16, 16, { toxic: rng.chance(0.3) }); }
          if (rng.chance(0.4)) addChains(R, rng.int(1, 2));
          if (rng.chance(0.3)) { const p = placeWall(R, 2, 2, R.iy0, R.S - 2); if (p) { add('fan', p.x * TS, p.y * TS, 32, 32, {}); anim('fan', p.x * TS + 16, p.y * TS + 16, 12, 12, {}); } }
          if (rng.chance(0.25)) { const p = placeWall(R, 3, 2, R.iy0 + 1, R.S - 2); if (p) add('hazard', p.x * TS, p.y * TS + 4, 48, 24, {}); }
          if (rng.chance(0.15)) { const p = placeWall(R, 4, 4, R.iy0, R.S - 1, 10, false); if (p) add('gear', p.x * TS, p.y * TS, 64, 64, {}); }
        }
        // tall rooms: extra wall detail higher up
        if (ih >= 12) { addPipes(R, 1, ['#3e4a52', '#5a4a42']); if (rng.chance(0.6)) addSign(R, { box: true }); if (rng.chance(0.5)) screenAt(R, P.lamp2); }
      } else if (style === 'slums') {
        addFacade(R);
        puddles(R);
        for (let k = Math.round(area / 90) + 1; k > 0; k--) if (rng.chance(0.75)) addSign(R);
        for (let k = rng.int(0, 2); k > 0; k--) addVSign(R);
        if (!R.open) addLamps(R, rng.chance(0.5) ? 'lantern' : 'bulb', rng.pick([P.lamp, '#ffb35c', P.lamp2]), rng.int(6, 10));
        else streetLamps(R);
        if (R.open || rng.chance(0.4)) addCables(R, rng.int(1, 3));
        for (let k = rng.int(0, 2); k > 0; k--) { const p = placeWall(R, 2, 1, R.iy0 + 1, R.S - 3); if (p) { const it = add('ac', p.x * TS + 4, p.y * TS + 2, 22, 14, {}); anim('fan', it.x + 7, it.y + 7, 5, 5, { small: 1 }); } }
        if (rng.chance(0.3)) { const p = placeFloor(R, 5, 4); if (p) stall(p.x, p.y); }
        if (rng.chance(0.4)) { const p = placeFloor(R, 2, 3); if (p) vending(p.x, p.y); }
        for (let k = rng.int(0, 3); k > 0; k--) { const p = placeFloor(R, 1, 1); if (p) add('trash', p.x * TS, p.y * TS, 16, 16, {}); }
        for (let k = rng.int(0, 2); k > 0; k--) { const p = placeWall(R, 2, 2, R.S - 4, R.S - 1); if (p) add('poster', p.x * TS + 2, p.y * TS + 2, 26, 26, { graffiti: rng.chance(0.4), c: neon() }); }
        if (R.open && rng.chance(0.55)) { const p = placeWall(R, 4, 3, R.iy0 + 1, R.S - 5, 12, false); if (p) { anim('holo', p.x * TS, p.y * TS, 64, 48, { c: rng.pick([P.lamp2, P.lamp, '#48ff8a']) }); } }
        if (rng.chance(0.35)) lanternString(R);
      } else if (style === 'spire') {
        // room themes: server hall, executive office, lobby, research lab
        const theme = rng.weighted([['server', 3], ['office', 2], ['lobby', 1.6], ['lab', 2]]);
        setWallVar(R, { server: 0, office: 3, lobby: 1, lab: 2 }[theme]);
        if (theme !== 'server' || rng.chance(0.35)) glassWall(R);
        stripLights(R, { server: P.lamp, office: '#ffd49a', lobby: '#dcc4ff', lab: '#9af6ff' }[theme]);
        if (theme === 'server') {
          racks(R, rng.int(2, 4));
          dataStreams(R, rng.int(1, 3));
          if (rng.chance(0.5)) addSign(R, { text: rng.pick(['SERVER', 'NODE 7', 'ARCHIVE', 'DATA']), c: rng.pick([P.lamp2, '#48ff8a']), box: false });
          if (rng.chance(0.4)) addCables(R, rng.int(1, 2));
        } else if (theme === 'office') {
          for (let k = rng.int(1, 3); k > 0; k--) terminal(R, '#ffd9a0');
          for (let k = rng.int(1, 2); k > 0; k--) plant(R);
          if (rng.chance(0.5)) screenAt(R, P.lamp2);
          if (rng.chance(0.4)) racks(R, 1);
        } else if (theme === 'lobby') {
          addSign(R, { text: rng.pick(['OMNICORP', 'ZERO CORP', 'LEVEL 88']), c: rng.pick([P.trim, '#dcc4ff']), box: false, scale: 2 });
          if (rng.chance(0.7)) { const p = placeWall(R, 4, 3, R.iy0, R.S - 3, 10, false); if (p) anim('holo', p.x * TS, p.y * TS, 64, 48, { c: rng.pick([P.trim, P.lamp2]) }); }
          for (let k = rng.int(1, 3); k > 0; k--) plant(R);
          dataStreams(R, rng.int(0, 1));
        } else {
          for (let k = rng.int(2, 3); k > 0; k--) screenAt(R, rng.pick([P.lamp2, '#48ff8a', '#9b5cff']));
          dataStreams(R, rng.int(2, 3));
          if (rng.chance(0.5)) terminal(R, P.lamp2);
          if (rng.chance(0.5)) { const p = placeWall(R, 4, 2, R.iy0, R.S - 3, 10, false); if (p) anim('holo', p.x * TS, p.y * TS, 64, 32, { c: rng.pick([P.lamp2, '#48ff8a']) }); }
          if (rng.chance(0.4)) addCables(R, 1);
        }
        if (ih >= 12) { dataStreams(R, 1); if (rng.chance(0.5)) screenAt(R, P.lamp2); }
      } else if (style === 'core') {
        addGirders(R);
        addLamps(R, 'cage', P.lamp, rng.int(12, 16));
        addPipes(R, rng.int(1, 2), ['#4a1a2a', '#3a2a3a']);
        if (rng.chance(0.6)) addSign(R, { box: true, c: rng.pick(P.neon) });
        if (rng.chance(0.6)) addCables(R, rng.int(1, 3));
        if (rng.chance(0.5)) addChains(R, rng.int(1, 2));
        for (let k = rng.int(0, 2); k > 0; k--) { const p = placeWall(R, 1, 1, R.iy0, R.S - 3); if (p) { const it = add('beacon', p.x * TS + 3, p.y * TS + 6, 10, 8, {}); anim('beacon', it.x + 5, it.y + 3, 1, 1, { c: P.lamp }); } }
        if (rng.chance(0.4)) { const p = placeWall(R, 2, 2, R.iy0 + 1, R.S - 2); if (p) { const it = add('screen', p.x * TS + 2, p.y * TS + 4, 28, 20, { c: P.lamp2 }); anim('screen', it.x + 3, it.y + 3, 22, 13, { c: P.lamp2 }); glow(it.x + 14, it.y + 10, 36, P.lamp2, 0.4, { fl: 1, bake: 0.4, br: 60 }); } }
      }
    }

    function puddles(R) {
      // flat runs of floor get rain puddles (reflections are baked into the terrain chunk)
      let run = [];
      const flush = () => {
        if (run.length >= 3 && rng.chance(R.open ? 0.55 : 0.2)) {
          const len = Math.min(run.length, rng.int(2, 5)), st = rng.int(0, run.length - len);
          lv.puddles.push({ x: run[st].x * TS + rng.int(0, 6), y: (run[0].y + 1) * TS, w: len * TS - rng.int(4, 12), h: 3, s: rng.int(1, 1e9) });
        }
        run = [];
      };
      const gc = groundCells(R).sort((a, b) => a.y - b.y || a.x - b.x);
      for (const c of gc) { if (run.length && (c.x !== run[run.length - 1].x + 1 || c.y !== run[0].y)) flush(); run.push(c); }
      flush();
    }
    function addFacade(R) {
      // building fronts: apartment windows in a grid + ledges, AC units come later
      const x0 = R.ix0, x1 = R.ix1;
      let x = x0 + rng.int(0, 2);
      while (x < x1 - 1) {
        const bw = rng.int(4, 9);
        const rows = [];
        for (let y = R.S - 3; y > Math.max(0, R.iy0); y -= rng.int(3, 4)) rows.push(y);
        const lit = rng.pick([P.lamp, '#ffb35c', '#ffd27a', P.lamp2, '#ff7a5c']);
        for (const y of rows) {
          for (let xx = x; xx < Math.min(x + bw, x1); xx += 2) {
            if (!free(xx, y - 1, xx, y, true)) continue;
            if (rng.chance(0.35)) continue;
            const on = rng.chance(0.55);
            add('awin', xx * TS + 2, (y - 1) * TS + 4, 12, 22, { on, c: rng.chance(0.75) ? lit : neon(), blinds: rng.chance(0.4) });
            mark(xx, y - 1, xx, y);
            if (on && rng.chance(0.3)) glow(xx * TS + 8, y * TS - 2, 22, lit, 0.25, { bake: 0.25, br: 40 });
          }
        }
        x += bw + rng.int(1, 3);
      }
    }
    function streetLamps(R) {
      const gc = groundCells(R).filter((c) => c.y >= R.S - 3).sort((a, b) => a.x - b.x);
      let last = -99;
      for (const c of gc) {
        if (c.x - last < rng.int(9, 14)) continue;
        if (!free(c.x, c.y - 4, c.x, c.y, false, false)) continue;
        const col = rng.pick([P.lamp2, '#ffd27a', P.lamp]);
        add('streetlamp', c.x * TS + 6, (c.y - 4) * TS, 16, 5 * TS, { c: col, dir: rng.sign() });
        mark(c.x, c.y - 4, c.x, c.y);
        glow(c.x * TS + 8 + 0, (c.y - 4) * TS + 4, 50, col, 0.38, { fl: 1, bake: 0.4, br: 100, cone: 1 });
        last = c.x;
      }
    }
    function stall(x, y) {
      // x,y top-left tile of a 5x4 area
      const it = add('stall', x * TS, y * TS, 80, 64, { c: rng.pick(['#ff3348', '#ff8a2a', P.lamp]), text: rng.pick(['RAMEN', 'NOODLE', 'SUSHI', 'BAR']) });
      glow(it.x + 40, it.y + 22, 60, '#ffb35c', 0.35, { fl: 1, bake: 0.4, br: 100 });
      glow(it.x + 40, it.y + 4, 34, it.c, 0.35, { fl: 2, tube: null });
      lv.steam = lv.steam || []; lv.steam.push({ x: it.x + 30, y: it.y + 40 });
    }
    function vending(x, y) {
      const it = add('vending', x * TS + 2, y * TS + 5, 28, 43, { c: rng.pick(['#ff2a5a', '#2a6aff', '#e8e8f0', '#ffb31a']) });
      glow(it.x + 13, it.y + 16, 40, rng.pick(['#bfe9ff', '#fff2c8']), 0.32, { fl: 1, bake: 0.35, br: 70 });
    }
    function lanternString(R) {
      const y = R.iy0 + rng.int(1, 3);
      const x0 = rng.int(R.ix0, R.ix1 - 8), x1 = Math.min(R.ix1, x0 + rng.int(8, 16));
      if (y >= R.S - 3) return;
      const sag = rng.int(8, 20);
      const n = Math.floor((x1 - x0) * 1.2);
      const it = add('lanterns', x0 * TS, y * TS, (x1 - x0) * TS, sag + 16, { sag, n, c: rng.pick(['#ff3348', '#ff8a2a', '#ff5cc8']) });
      for (let i = 1; i < n; i += 2) {
        const u = i / n, xx = it.x + u * it.w, yy = it.y + 4 * sag * u * (1 - u) + 6;
        glow(xx, yy, 18, it.c, 0.4, { fl: 1, bake: 0.3, br: 30 });
      }
    }
    function glassWall(R) {
      // big glass panes (the city far below shows through), with mullions
      const ih = R.S - R.iy0 + 1;
      if (ih < 6) return;
      let x = R.ix0 + rng.int(1, 3);
      while (x < R.ix1 - 3) {
        const w = rng.int(4, 8), y0 = R.iy0 + rng.int(0, 1), y1 = Math.min(R.S - 2, y0 + rng.int(3, Math.max(3, ih - 3)));
        const xe = Math.min(R.ix1 - 1, x + w - 1);
        if (rng.chance(0.8) && free(x, y0, xe, y1, false)) {
          for (let yy = y0; yy <= y1; yy++) for (let xx = x; xx <= xe; xx++) if (!isSolid(xx, yy)) back[yy * W + xx] = 2;
          add('glass', x * TS, y0 * TS, (xe - x + 1) * TS, (y1 - y0 + 1) * TS, { mull: rng.pick([32, 48]) });
          mark(x, y0, xe, y1);
          glow((x + xe + 1) * TS / 2, (y0 + y1 + 1) * TS / 2, 90, '#5a7cff', 0.12, { bake: 0.25, br: 140, shaft: 1 });
        }
        x = xe + rng.int(2, 5);
      }
    }
    function stripLights(R, col) {
      col = col || P.lamp;
      const cc = ceilCells(R).filter((c) => c.y <= R.iy0 + 1).sort((a, b) => a.x - b.x);
      // continuous runs along the ceiling
      let run = [];
      const flush = () => {
        if (run.length >= 3 && rng.chance(0.7)) {
          const x0 = run[0].x, x1 = run[run.length - 1].x, y = run[0].y;
          add('strip', x0 * TS + 4, y * TS, (x1 - x0 + 1) * TS - 8, 3, { c: col });
          for (let x = x0 + 1; x <= x1; x += 3) glow(x * TS, y * TS + 3, 34, col, 0.28, { bake: 0.42, br: 70 });
        }
        run = [];
      };
      for (const c of cc) { if (run.length && (c.x !== run[run.length - 1].x + 1 || c.y !== run[0].y)) flush(); run.push(c); }
      flush();
    }

    // ------------------------------------------------ foreground silhouettes (parallax > 1)
    if (lv.kind === 'biome') {
      for (const R of lv.rooms) {
        if (R.open || R.ix1 - R.ix0 < 10) continue;
        if (rng.chance(0.45)) lv.fg.push({ t: 'fgcable', x: (R.ix0 + rng.int(2, R.ix1 - R.ix0 - 2)) * TS, y: R.iy0 * TS - 20, s: rng.int(1, 1e9) });
      }
    }
    // emissive runs / spikes / dust sources are derived by the renderer
  }

  // ================================================================ RENDERING
  const CPX = 256, CT = CPX / TS;   // chunk size (px / tiles)
  const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; };
  const R_ = (g, x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };

  // flicker: 0 steady, 1 subtle hum, 2 neon (drop-outs), 3 slow pulse
  function flick(fl, ph, t) {
    if (!fl) return 1;
    if (fl === 3) return 0.65 + 0.35 * Math.sin(t * 2.2 + ph);
    const k = Math.floor(t * 15 + ph * 13);
    const n = hash3(k, (ph * 997) | 0, 11);
    if (fl === 2) {
      const burst = hash3(Math.floor(t * 0.7 + ph), (ph * 31) | 0, 5) < 0.18; // occasional bad second
      if (burst && n < 0.5) return 0.08;
      if (n < 0.015) return 0.1;
      return 0.92 + 0.08 * n;
    }
    return 0.9 + 0.1 * n;
  }

  // ---------------------------------------------------------------- sprites cache (per color etc.)
  const spriteCache = new Map();
  function cached(key, w, h, fn) {
    let c = spriteCache.get(key);
    if (!c) { c = mkCanvas(w, h); fn(c.getContext('2d'), c); spriteCache.set(key, c); }
    return c;
  }
  // dither band (checker) along one side of a 16x16 tile
  function ditherSprite(color, dir) {
    return cached('d|' + color + dir, TS, TS, (g) => {
      g.fillStyle = color;
      for (let a = 0; a < TS; a++) for (let b = 0; b < 4; b++) {
        const on = b === 0 ? true : b === 1 ? (a + b) % 2 === 0 : b === 2 ? a % 4 === 0 : a % 8 === 4;
        if (!on) continue;
        if (dir === 'N') g.fillRect(a, b, 1, 1);
        else if (dir === 'S') g.fillRect(a, TS - 1 - b, 1, 1);
        else if (dir === 'W') g.fillRect(b, a, 1, 1);
        else g.fillRect(TS - 1 - b, a, 1, 1);
      }
    });
  }
  // light cone below a lamp (additive)
  function coneSprite(color) {
    return cached('cone|' + color, 96, 110, (g) => {
      const [r, gg, b] = hexToRgb(color);
      for (let y = 0; y < 110; y++) {
        const hw = 4 + y * 0.42;
        const a = 0.15 * (1 - y / 110) * (1 - y / 110);
        g.fillStyle = 'rgba(' + r + ',' + gg + ',' + b + ',' + a.toFixed(3) + ')';
        g.fillRect(Math.round(48 - hw), y, Math.round(hw * 2), 1);
        g.fillStyle = 'rgba(' + r + ',' + gg + ',' + b + ',' + (a * 0.6).toFixed(3) + ')';
        g.fillRect(Math.round(48 - hw * 0.45), y, Math.round(hw * 0.9), 1);
      }
    });
  }
  // slanted light shaft from a window (additive)
  function shaftSprite(color, w, h) {
    w = Math.round(w); h = Math.round(h);
    return cached('shaft|' + color + w + 'x' + h, w + h, h, (g) => {
      const [r, gg, b] = hexToRgb(color);
      for (let y = 0; y < h; y++) {
        const a = 0.13 * (1 - y / h);
        g.fillStyle = 'rgba(' + r + ',' + gg + ',' + b + ',' + a.toFixed(3) + ')';
        g.fillRect(Math.round(y * 0.6), y, w, 1);
      }
    });
  }
  // neon sign sprites: base (unlit tubes on a panel, baked) + lit (drawn additively)
  function neonSprites(it) {
    const key = 'neon|' + it.text + it.c + it.scale + (it.box ? 1 : 0);
    const w = it.w, h = it.h;
    const base = cached(key + 'b', w, h, (g) => {
      if (it.box) {
        R_(g, 0, 0, w, h, '#07060c'); R_(g, 1, 1, w - 2, h - 2, '#12101c');
        R_(g, 1, 1, w - 2, 1, '#2a2638');
        R_(g, 0, h - 1, w, 1, '#040308');
      } else {
        // bare tubes on two brackets
        R_(g, 3, 0, 2, h, '#1a1824'); R_(g, w - 5, 0, 2, h, '#1a1824');
      }
      const s = G.font.sprite(it.text, mix(it.c, '#000000', 0.55), it.scale, null);
      g.drawImage(s, Math.round((w - s.width) / 2), Math.round((h - s.height) / 2));
    });
    const lit = cached(key + 'l', w + 4, h + 4, (g) => {
      const halo = G.font.sprite(it.text, mix(it.c, '#000000', 0.55), it.scale, null);
      const core = G.font.sprite(it.text, it.c, it.scale, null);
      const hot = G.font.sprite(it.text, mix(it.c, '#ffffff', 0.55), it.scale, null);
      const x = Math.round((w + 4 - core.width) / 2), y = Math.round((h + 4 - core.height) / 2);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) g.drawImage(halo, x + dx, y + dy);
      g.drawImage(core, x, y);
      g.globalAlpha = 0.3; g.drawImage(hot, x, y); g.globalAlpha = 1;
    });
    return { base, lit };
  }
  function vsignSprites(it) {
    const key = 'vs|' + it.s;
    const draw = (g, col, bright) => {
      it.glyphs.forEach((gl, i) => {
        for (let p = 0; p < 49; p++) if (gl[p]) {
          const x = 3 + (p % 7), y = 3 + i * 9 + ((p / 7) | 0);
          R_(g, x, y, 1, 1, col);
        }
      });
    };
    const base = cached(key + 'b', it.w, it.h, (g) => {
      R_(g, 0, 0, it.w, it.h, '#08070d'); R_(g, 1, 1, it.w - 2, it.h - 2, '#141220');
      R_(g, 1, 1, 1, it.h - 2, mix(it.c, '#000000', 0.7)); R_(g, it.w - 2, 1, 1, it.h - 2, mix(it.c, '#000000', 0.7));
      draw(g, mix(it.c, '#000000', 0.55));
    });
    const lit = cached(key + 'l', it.w, it.h, (g) => {
      R_(g, 1, 1, 1, it.h - 2, mix(it.c, '#000000', 0.4)); R_(g, it.w - 2, 1, 1, it.h - 2, mix(it.c, '#000000', 0.4));
      draw(g, it.c);
    });
    return { base, lit };
  }

  // ---------------------------------------------------------------- LevelArt
  class LevelArt {
    constructor(lv) {
      this.lv = lv;
      this.P = lv.pal;
      this.style = lv.style || lv.biome;
      this.seed = lv.seed | 0;
      this.ncx = Math.ceil(lv.w / CT); this.ncy = Math.ceil(lv.h / CT);
      const n = this.ncx * this.ncy;
      this.backC = new Array(n).fill(null);
      this.tileC = new Array(n).fill(null);
      this.backDirty = new Uint8Array(n).fill(1);
      this.tileDirty = new Uint8Array(n).fill(1);
      this.memo = new Map();
      this.computeDepth();
      // derived colors
      const P = this.P;
      this.C = {
        silLine: mix(P.sil, P.rock0, 0.55),
        rim: mix(P.rock1, P.rock2, 0.6),
        under: mix(P.rock1, P.rock2, 0.35),
        lip: mix(P.top, P.rock2, 0.5),
        ao: rgba(mix(P.wall0, '#000000', 0.6), 1),
      };
      // buckets
      this.decB = this.bucketize(lv.decor, true);
      this.puddleB = this.bucketize(lv.puddles || [], true);
      this.animB = this.bucketize(lv.anims, false);
      this.glowB = this.bucketize(lv.glows.map((g) => Object.assign(g, { w: 0, h: 0 })), false);
      // spikes & emissive trims
      const spk = [];
      for (let y = 0; y < lv.h; y++) for (let x = 0; x < lv.w; x++) if (lv.tiles[y * lv.w + x] === T.SPIKES) spk.push({ x: x * TS + 8, y: y * TS + 10, w: 0, h: 0, ph: hash3(x, y, 9) * 100 });
      this.spikeB = this.bucketize(spk, false);
      this.bg = G.Background ? new G.Background(lv) : null;
      this.initWeather();
      this.lastCam = null;
      this.fgSprites = new Map();
    }
    sh(c, k) { const key = c + k; let v = this.memo.get(key); if (!v) { v = shade(c, k); this.memo.set(key, v); } return v; }
    bucketize(items, spanAll) {
      const b = [];
      for (let i = 0; i < this.ncx * this.ncy; i++) b.push([]);
      for (const it of items) {
        if (spanAll) {
          const x0 = G.clamp(Math.floor((it.x - 12) / CPX), 0, this.ncx - 1), x1 = G.clamp(Math.floor((it.x + it.w + 12) / CPX), 0, this.ncx - 1);
          const y0 = G.clamp(Math.floor((it.y - 12) / CPX), 0, this.ncy - 1), y1 = G.clamp(Math.floor((it.y + it.h + 12) / CPX), 0, this.ncy - 1);
          for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) b[y * this.ncx + x].push(it);
        } else {
          const cx = G.clamp(Math.floor((it.x + it.w / 2) / CPX), 0, this.ncx - 1), cy = G.clamp(Math.floor((it.y + it.h / 2) / CPX), 0, this.ncy - 1);
          b[cy * this.ncx + cx].push(it);
        }
      }
      return b;
    }
    computeDepth() {
      const lv = this.lv, W = lv.w, H = lv.h;
      const d = new Uint8Array(W * H).fill(9);
      const q = new Int32Array(W * H);
      let qt = 0;
      for (let i = 0; i < W * H; i++) if (lv.tiles[i] !== T.SOLID) { d[i] = 0; q[qt++] = i; }
      for (let qh = 0; qh < qt; qh++) {
        const i = q[qh], x = i % W, y = (i / W) | 0, nd = d[i] + 1;
        if (nd > 6) continue;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx;
          if (d[j] > nd) { d[j] = nd; q[qt++] = j; }
        }
      }
      this.depth = d;
    }
    dep(x, y) { const lv = this.lv; return x < 0 || y < 0 || x >= lv.w || y >= lv.h ? 9 : this.depth[y * lv.w + x]; }
    open(x, y) { const lv = this.lv; return x >= 0 && y >= 0 && x < lv.w && y < lv.h && lv.tiles[y * lv.w + x] !== T.SOLID; }
    invalidate(tx, ty) {
      // a tile changed at runtime: recompute local depth and re-render the chunks around it
      this.computeDepth();
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const cx = Math.floor((tx + dx) / CT), cy = Math.floor((ty + dy) / CT);
        if (cx < 0 || cy < 0 || cx >= this.ncx || cy >= this.ncy) continue;
        this.tileDirty[cy * this.ncx + cx] = 1; this.backDirty[cy * this.ncx + cx] = 1;
      }
    }

    // ============================================================ terrain tiles
    renderTileChunk(ci) {
      const cx = ci % this.ncx, cy = (ci / this.ncx) | 0;
      const c = this.tileC[ci] || (this.tileC[ci] = mkCanvas(CPX, CPX));
      const g = c.getContext('2d');
      g.clearRect(0, 0, CPX, CPX);
      const lv = this.lv, ox = cx * CPX, oy = cy * CPX;
      const tx0 = cx * CT - 1, ty0 = cy * CT - 1, tx1 = cx * CT + CT, ty1 = cy * CT + CT;
      for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) {
        const t = lv.tile(x, y);
        if (x < 0 || y < 0 || x >= lv.w || y >= lv.h) continue;
        const px = x * TS - ox, py = y * TS - oy;
        if (t === T.SOLID) this.solidTile(g, x, y, px, py);
        else if (t === T.PLATFORM) this.platformTile(g, x, y, px, py);
        else if (t === T.LADDER) this.ladderTile(g, x, y, px, py);
        else if (t === T.SPIKES) this.spikeTile(g, x, y, px, py);
      }
      for (const pd of this.puddleB[ci]) this.puddle(g, pd, pd.x - ox, pd.y - oy);
      this.tileDirty[ci] = 0;
      return c;
    }
    puddle(g, pd, x, y) {
      const r = new G.RNG(pd.s), P = this.P;
      R_(g, x, y, pd.w, 1, '#9fe8ff');
      R_(g, x + 1, y + 1, pd.w - 2, 2, '#141a36');
      R_(g, x + 2, y + 3, pd.w - 4, 1, '#0e1226');
      for (let k = 0; k < pd.w / 5; k++) {
        const c = r.pick(P.neon);
        R_(g, x + 2 + r.int(0, pd.w - 5), y + 1, r.int(1, 3), 1, mix(c, '#141a36', 0.35));
      }
      for (let k = 0; k < pd.w; k += r.int(3, 7)) R_(g, x + k, y, 2, 1, '#e8fbff');
    }

    solidTile(g, x, y, px, py) {
      const P = this.P, C = this.C, st = this.style;
      const d = this.dep(x, y);
      const h = hash3(x, y, this.seed);
      if (d >= 3) {
        R_(g, px, py, TS, TS, P.sil);
        // faint large-scale structure so the mass is not flat black
        if (d <= 4) {
          if (((x >> 1) + (y >> 1) * 3) % 4 === 0 && y % 2 === 1) R_(g, px, py + 15, TS, 1, C.silLine);
          if (h < 0.05) R_(g, px + 5, py + 6, 2, 1, C.silLine);
        }
        this.ditherFrom(g, x, y, px, py, d);
        return;
      }
      const base = d === 1 ? P.rock1 : P.rock0;
      R_(g, px, py, TS, TS, base);
      this.material(g, x, y, px, py, base, h, d);
      if (d === 2) { this.ditherFrom(g, x, y, px, py, d); return; }
      const up = this.open(x, y - 1), dn = this.open(x, y + 1), lf = this.open(x - 1, y), rt = this.open(x + 1, y);
      if (lf) this.sideEdge(g, x, y, px, py, -1, h);
      if (rt) this.sideEdge(g, x, y, px, py, 1, h);
      if (dn) this.bottomEdge(g, x, y, px, py, h);
      if (up) this.topEdge(g, x, y, px, py, h, lf, rt);
      // bevel outer corners
      if (up && lf) { g.clearRect(px, py, 2, 1); g.clearRect(px, py + 1, 1, 1); R_(g, px + 1, py + 1, 1, 1, P.top); }
      if (up && rt) { g.clearRect(px + 14, py, 2, 1); g.clearRect(px + 15, py + 1, 1, 1); R_(g, px + 14, py + 1, 1, 1, P.top); }
      if (dn && lf) { g.clearRect(px, py + 15, 2, 1); g.clearRect(px, py + 14, 1, 1); }
      if (dn && rt) { g.clearRect(px + 14, py + 15, 2, 1); g.clearRect(px + 15, py + 14, 1, 1); }
    }
    ditherFrom(g, x, y, px, py, d) {
      // soften the depth steps: draw the lighter neighbor color into our side
      const P = this.P;
      const col = (nd) => (nd <= 1 ? P.rock1 : nd === 2 ? P.rock0 : null);
      const n = this.dep(x, y - 1), s = this.dep(x, y + 1), w = this.dep(x - 1, y), e = this.dep(x + 1, y);
      if (n < d && n > 0 && col(n)) g.drawImage(ditherSprite(col(n), 'N'), px, py);
      if (s < d && s > 0 && col(s)) g.drawImage(ditherSprite(col(s), 'S'), px, py);
      if (w < d && w > 0 && col(w)) g.drawImage(ditherSprite(col(w), 'W'), px, py);
      if (e < d && e > 0 && col(e)) g.drawImage(ditherSprite(col(e), 'E'), px, py);
    }
    // plate layout helper: plates of pw x ph tiles, rows staggered by `stag` tiles
    plate(x, y, pw, ph, stag) {
      const row = Math.floor(y / ph);
      const xx = x + (row & 1) * stag;
      return { lx: ((xx % pw) + pw) % pw, ly: ((y % ph) + ph) % ph, id: Math.floor(xx / pw) * 7919 + row };
    }
    material(g, x, y, px, py, base, h, d) {
      // subtle surface texture on the edge band; deeper tiles only keep plate seams
      const st = this.style, P = this.P;
      const dk = this.sh(base, -0.5), lt = this.sh(base, 0.07), lt2 = this.sh(base, 0.16);
      const full = d === 1;
      if (st === 'slums') {
        // cast concrete blocks (32x16), staggered, speckle and cracks
        const pl = this.plate(x, y, 2, 1, 1);
        R_(g, px, py + 15, TS, 1, dk);
        if (pl.lx === 1) R_(g, px + 15, py, 1, TS, dk);
        R_(g, px, py + 7, TS, 1, this.sh(base, -0.2));
        if (!full) return;
        R_(g, px, py, TS, 1, lt);
        for (let k = 0; k < 3; k++) R_(g, px + ((hash3(x * 7 + k, y, 3) * 16) | 0), py + ((hash3(x, y * 5 + k, 4) * 16) | 0), 1, 1, k & 1 ? lt2 : dk);
        if (h > 0.88) { let cx = px + 3 + ((h * 50) % 8 | 0), cy = py + 1; for (let k = 0; k < 7; k++) { R_(g, cx, cy, 1, 1, dk); cy++; if (hash3(x, k, 8) < 0.5) cx++; } }
      } else if (st === 'spire') {
        const pl = this.plate(x, y, 2, 2, 0);
        if (!full) return;
        if (pl.ly === 1) R_(g, px, py + 15, TS, 1, dk);
        if (pl.lx === 1) R_(g, px + 15, py, 1, TS, dk);
        if (pl.ly === 0) R_(g, px, py, TS, 1, lt2);
        if (pl.lx === 0) R_(g, px, py, 1, TS, lt);
        if (h < 0.08) R_(g, px + 11, py + 4, 2, 1, P.trim2);
        else if (h < 0.16 && pl.ly === 1) { for (let k = 0; k < 4; k++) R_(g, px + 3 + k * 3, py + 8, 1, 4, dk); }
      } else if (st === 'core') {
        const pl = this.plate(x, y, 2, 2, 1);
        if (pl.ly === 1) R_(g, px, py + 15, TS, 1, dk);
        if (pl.lx === 1) { R_(g, px + 15, py, 1, TS, dk); if (pl.ly === 0) { R_(g, px + 12, py + 1, 3, 1, dk); R_(g, px + 13, py + 2, 2, 1, dk); R_(g, px + 14, py + 3, 1, 1, dk); } }
        if (!full) return;
        if (pl.ly === 0) R_(g, px, py, TS, 1, lt);
        if (pl.lx === 0 && pl.ly === 0) R_(g, px + 3, py + 3, 1, 1, lt2);
        if (h < 0.08) R_(g, px + 2, py + 11, 12, 1, this.sh(P.trim, -0.5));
      } else if (st === 'transit') {
        const pl = this.plate(x, y, 2, 1, 1);
        R_(g, px, py + 15, TS, 1, dk);
        if (pl.lx === 1) R_(g, px + 15, py, 1, TS, dk);
        if (full) { R_(g, px, py, TS, 1, lt); if (pl.lx === 0) R_(g, px + 3, py + 4, 1, 1, lt2); }
      } else {
        // scrap: riveted steel plates (32x16, staggered), rare grates, rust
        const pl = this.plate(x, y, 2, 1, 1);
        R_(g, px, py + 15, TS, 1, dk);
        if (pl.lx === 1) R_(g, px + 15, py, 1, TS, dk);
        if (!full) return;
        R_(g, px, py, TS, 1, lt);
        if (pl.lx === 0) { R_(g, px, py, 1, 15, lt); R_(g, px + 3, py + 3, 1, 1, lt2); R_(g, px + 3, py + 12, 1, 1, lt2); }
        else { R_(g, px + 12, py + 3, 1, 1, lt2); R_(g, px + 12, py + 12, 1, 1, lt2); }
        const ph = hash3(pl.id, 1, this.seed);
        if (ph < 0.08) { for (let k = 0; k < 3; k++) R_(g, px + (pl.lx ? 0 : 6), py + 5 + k * 3, 10, 1, dk); }
        else if (ph < 0.22) { const rc = this.sh(P.rust, -0.35); for (let k = 0; k < 4; k++) R_(g, px + ((hash3(x, y, k) * 14) | 0) + 1, py + ((hash3(y, x, k) * 14) | 0) + 1, 1 + (k & 1), 1, rc); if (pl.lx === 0) R_(g, px + 6 + ((h * 40) | 0) % 6, py + 4, 1, 5, rc); }
      }
    }
    topEdge(g, x, y, px, py, h, lf, rt) {
      const P = this.P, C = this.C, st = this.style;
      // lit lip: bright rim, surface band, dark seam
      R_(g, px, py, TS, 1, P.topHi);
      R_(g, px, py + 1, TS, 1, P.top);
      R_(g, px, py + 2, TS, 2, C.lip);
      R_(g, px, py + 4, TS, 1, this.sh(P.rock0, -0.3));
      // texture the rim
      for (let k = 0; k < 3; k++) { const hx = (hash3(x, y, 20 + k) * 16) | 0; R_(g, px + hx, py, 1 + (k & 1), 1, P.top); }
      if (st === 'scrap') {
        // hazard stripes on some runs
        if (hash3(Math.floor(x / 5), y, this.seed + 7) < 0.22) {
          for (let yy = 5; yy < 9; yy++) for (let xx = 0; xx < TS; xx++) R_(g, px + xx, py + yy, 1, 1, ((x * TS + xx + yy) & 7) < 4 ? '#b8901c' : '#17120e');
          R_(g, px, py + 9, TS, 1, this.sh(P.rock0, -0.3));
        } else {
          R_(g, px + 2, py + 2, 2, 1, P.topHi); R_(g, px + 10, py + 2, 2, 1, P.topHi);
        }
        // scrap bits on the surface
        if (h > 0.84) { R_(g, px + 4, py - 2, 3, 2, P.metal); R_(g, px + 5, py - 3, 1, 1, P.rust); }
        else if (h > 0.78) { R_(g, px + 9, py - 3, 1, 3, '#3a3040'); R_(g, px + 10, py - 4, 2, 1, '#3a3040'); }
      } else if (st === 'slums') {
        // wet sheen with neon reflections, weeds and trash
        const refl = [P.trim, P.trim2, '#ffe14d'];
        for (let k = 0; k < 2; k++) { const hx = (hash3(x, y, 40 + k) * 14) | 0; R_(g, px + hx, py + 1, 2, 1, mix(refl[(hash3(x, k, 3) * 3) | 0], P.top, 0.35)); }
        if (h > 0.88) { R_(g, px + 3, py - 3, 1, 3, '#1f4a44'); R_(g, px + 4, py - 2, 1, 2, '#2a6a5a'); R_(g, px + 2, py - 1, 1, 1, '#1f4a44'); }
        else if (h > 0.83) { R_(g, px + 8, py - 3, 3, 3, '#3a2a4a'); R_(g, px + 8, py - 3, 3, 1, '#5a4a7a'); }
      } else if (st === 'spire') {
        R_(g, px, py + 3, TS, 1, this.sh(P.trim2, -0.25));
      } else if (st === 'core') {
        if ((x & 1) === 0) R_(g, px + 4, py + 3, 3, 1, this.sh(P.trim, -0.15));
        if (h > 0.85) { R_(g, px + 6, py - 2, 1, 2, '#2a1020'); R_(g, px + 7, py - 3, 3, 1, '#2a1020'); }
      } else if (st === 'transit') {
        R_(g, px, py + 3, TS, 1, this.sh('#48ff8a', -0.6));
      }
    }
    bottomEdge(g, x, y, px, py, h) {
      const P = this.P, C = this.C, st = this.style;
      R_(g, px, py + 15, TS, 1, C.under);
      R_(g, px, py + 14, TS, 1, this.sh(P.rock1, -0.2));
      if (h < 0.1) { R_(g, px + 5, py + 16, 1, 3, P.rock1); R_(g, px + 6, py + 16, 1, 5, P.rock1); R_(g, px + 6, py + 20, 1, 1, st === 'slums' ? '#8fe9ff' : P.rock2); }
      else if (h < 0.17 && st !== 'spire') {
        // wire loop
        const c = st === 'slums' ? '#1a1826' : '#1b1418';
        R_(g, px + 3, py + 16, 1, 3, c); R_(g, px + 4, py + 19, 2, 1, c); R_(g, px + 6, py + 20, 3, 1, c); R_(g, px + 9, py + 19, 2, 1, c); R_(g, px + 11, py + 16, 1, 3, c);
      } else if (h < 0.22 && st === 'scrap') {
        R_(g, px + 7, py + 16, 2, 2, '#2a2230'); R_(g, px + 7, py + 18, 1, 4, '#3a3038'); R_(g, px + 8, py + 22, 1, 1, '#3a3038');
      } else if (h < 0.2 && st === 'spire') {
        R_(g, px + 3, py + 16, 10, 1, '#0a0e18'); R_(g, px + 4, py + 16, 8, 1, P.topHi);
      }
    }
    sideEdge(g, x, y, px, py, s, h) {
      const C = this.C, P = this.P;
      const ex = s < 0 ? px : px + 15, ix = s < 0 ? px + 1 : px + 14;
      R_(g, ex, py, 1, TS, C.rim);
      R_(g, ix, py, 1, TS, this.sh(P.rock1, 0.04));
      const bx = s < 0 ? px + 3 : px + 12;
      R_(g, bx, py + 4, 1, 1, P.rock2); R_(g, bx, py + 11, 1, 1, P.rock2);
      if (this.style === 'scrap' && h > 0.9) { R_(g, s < 0 ? px + 2 : px + 11, py, 3, TS, '#2e2428'); R_(g, s < 0 ? px + 2 : px + 11, py, 1, TS, '#4a3a3a'); }
    }
    platformTile(g, x, y, px, py) {
      const P = this.P, lv = this.lv;
      const L = lv.tile(x - 1, y), Rr = lv.tile(x + 1, y);
      const capOfLadder = lv.tile(x, y + 1) === T.LADDER || lv.tile(x - 1, y + 1) === T.LADDER || lv.tile(x + 1, y + 1) === T.LADDER;
      const m = P.metal, hi = this.sh(m, 0.35), dk = this.sh(m, -0.45), dk2 = this.sh(m, -0.65);
      // deck
      R_(g, px, py, TS, 1, hi);
      R_(g, px, py + 1, TS, 2, m);
      for (let k = 1; k < TS; k += 3) R_(g, px + k, py + 2, 1, 1, dk);
      R_(g, px, py + 3, TS, 1, dk2);
      if (capOfLadder) {
        // hatch: stripes
        for (let k = 0; k < TS; k += 4) R_(g, px + k, py + 1, 2, 1, this.style === 'scrap' ? '#b8901c' : P.trim2);
        return;
      }
      // truss
      for (let k = 0; k < TS; k++) {
        const yy = 4 + Math.abs(((x * TS + k) % 8) - 4);
        R_(g, px + k, py + yy, 1, 1, dk);
      }
      R_(g, px, py + 8, TS, 1, dk2);
      // ends / brackets
      if (L !== T.PLATFORM) {
        R_(g, px, py, 2, 10, dk); R_(g, px, py, 1, 10, m);
        if (L === T.SOLID) { for (let k = 0; k < 6; k++) R_(g, px + k, py + 4 + k, 1, 1, dk); }
      }
      if (Rr !== T.PLATFORM) {
        R_(g, px + 14, py, 2, 10, dk); R_(g, px + 15, py, 1, 10, m);
        if (Rr === T.SOLID) { for (let k = 0; k < 6; k++) R_(g, px + 15 - k, py + 4 + k, 1, 1, dk); }
      }
      // low railing (behind the player)
      let runL = 0, runR = 0;
      for (let k = 1; k < 8 && lv.tile(x - k, y) === T.PLATFORM; k++) runL++;
      for (let k = 1; k < 8 && lv.tile(x + k, y) === T.PLATFORM; k++) runR++;
      if (runL + runR >= 2 && lv.tile(x, y - 1) === T.AIR) {
        const rc = this.sh(m, -0.25);
        R_(g, px, py - 7, TS, 1, rc);
        R_(g, px, py - 4, TS, 1, this.sh(m, -0.5));
        if ((x & 1) === 0 || L !== T.PLATFORM) R_(g, px + (L !== T.PLATFORM ? 0 : 1), py - 7, 1, 7, rc);
        if (Rr !== T.PLATFORM) R_(g, px + 15, py - 7, 1, 7, rc);
      }
    }
    ladderTile(g, x, y, px, py) {
      const P = this.P;
      const m = this.sh(P.metal, -0.1), hi = this.sh(P.metal, 0.3), dk = this.sh(P.metal, -0.55);
      R_(g, px + 2, py, 2, TS, dk); R_(g, px + 12, py, 2, TS, dk);
      R_(g, px + 2, py, 1, TS, m); R_(g, px + 12, py, 1, TS, m);
      for (let k = 2; k < TS; k += 4) { R_(g, px + 4, py + k, 8, 1, hi); R_(g, px + 4, py + k + 1, 8, 1, dk); }
      if (this.lv.tile(x, y - 1) !== T.LADDER) {
        // top: a grated step flush with the floor + hand hooks
        R_(g, px, py, TS, 3, dk); R_(g, px, py, TS, 1, hi);
        R_(g, px + 2, py - 5, 2, 5, dk); R_(g, px + 12, py - 5, 2, 5, dk); R_(g, px + 2, py - 5, 1, 1, hi); R_(g, px + 12, py - 5, 1, 1, hi);
      }
      if (this.style === 'slums' && (y & 3) === 0) R_(g, px + 12, py + 6, 2, 3, '#b8901c');
    }
    spikeTile(g, x, y, px, py) {
      const P = this.P;
      const m = this.sh(P.metal, -0.2), hi = this.sh(P.metal, 0.25), dk = this.sh(P.metal, -0.6);
      R_(g, px, py + 13, TS, 3, dk); R_(g, px, py + 13, TS, 1, P.spike);
      for (const cx of [2, 7, 12]) {
        for (let r = 0; r < 9; r++) {
          const hw = r < 2 ? 0 : r < 5 ? 1 : 2;
          R_(g, px + cx - hw, py + 4 + r, hw + 1, 1, hi);
          R_(g, px + cx + 1, py + 4 + r, hw, 1, m);
        }
        R_(g, px + cx, py + 3, 1, 2, mix(P.spike, '#ffffff', 0.4));
      }
    }

    // ============================================================ back wall
    wallBase(x, y) {
      const v = this.lv.wallVar[y * this.lv.w + x];
      return v && this.P.wallVars ? this.P.wallVars[v - 1] : this.P.wall1;
    }
    hasWall(x, y) {
      const lv = this.lv;
      if (x < 0 || y < 0 || x >= lv.w || y >= lv.h) return false;
      const b = lv.back[y * lv.w + x];
      if (b === 1) return true;
      if (lv.tiles[y * lv.w + x] !== T.SOLID || this.dep(x, y) > 1) return false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < lv.w && ny < lv.h && lv.back[ny * lv.w + nx] === 1) return true;
      }
      return false;
    }
    renderBackChunk(ci) {
      const cx = ci % this.ncx, cy = (ci / this.ncx) | 0;
      const c = this.backC[ci] || (this.backC[ci] = mkCanvas(CPX, CPX));
      const g = c.getContext('2d');
      g.clearRect(0, 0, CPX, CPX);
      const lv = this.lv, ox = cx * CPX, oy = cy * CPX;
      const tx0 = cx * CT, ty0 = cy * CT;
      for (let y = ty0; y < ty0 + CT; y++) for (let x = tx0; x < tx0 + CT; x++) {
        if (this.hasWall(x, y)) this.wallTile(g, x, y, x * TS - ox, y * TS - oy);
      }
      // ambient occlusion next to terrain
      for (let y = ty0; y < ty0 + CT; y++) for (let x = tx0; x < tx0 + CT; x++) {
        if (x >= lv.w || y >= lv.h || lv.back[y * lv.w + x] !== 1) continue;
        this.aoTile(g, x, y, x * TS - ox, y * TS - oy);
      }
      // decor
      for (const it of this.decB[ci]) { const f = DECOR[it.t]; if (f) f(this, g, it, it.x - ox, it.y - oy); }
      // baked light pools (additive, only on opaque wall pixels)
      this.bakeLights(g, cx, cy, ox, oy);
      this.backDirty[ci] = 0;
      return c;
    }
    bakeLights(g, cx, cy, ox, oy) {
      const pools = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const bx = cx + dx, by = cy + dy;
        if (bx < 0 || by < 0 || bx >= this.ncx || by >= this.ncy) continue;
        for (const l of this.glowB[by * this.ncx + bx]) {
          if (!l.bake) continue;
          const r = l.br || l.r * 2;
          if (l.x + r < ox || l.x - r > ox + CPX || l.y + r < oy || l.y - r > oy + CPX) continue;
          pools.push(l);
        }
      }
      if (!pools.length) return;
      const s = LevelArt.scratch || (LevelArt.scratch = mkCanvas(CPX, CPX));
      const sg = s.getContext('2d');
      sg.globalCompositeOperation = 'source-over';
      sg.clearRect(0, 0, CPX, CPX);
      sg.globalCompositeOperation = 'lighter';
      for (const l of pools) G.drawGlow(sg, l.x - ox, l.y - oy, l.br || l.r * 2, l.c, l.bake);
      sg.globalCompositeOperation = 'destination-in';
      sg.drawImage(g.canvas, 0, 0);
      sg.globalCompositeOperation = 'source-over';
      g.globalCompositeOperation = 'lighter';
      g.drawImage(s, 0, 0);
      g.globalCompositeOperation = 'source-over';
    }
    aoTile(g, x, y, px, py) {
      const o = (a, b) => !this.open(a, b);
      const A1 = 'rgba(0,0,0,0.5)', A2 = 'rgba(0,0,0,0.28)', A3 = 'rgba(0,0,0,0.13)';
      if (o(x, y - 1)) { R_(g, px, py, TS, 2, A1); R_(g, px, py + 2, TS, 3, A2); R_(g, px, py + 5, TS, 4, A3); }
      if (o(x, y + 1)) { R_(g, px, py + 14, TS, 2, A1); R_(g, px, py + 11, TS, 3, A2); R_(g, px, py + 7, TS, 4, A3); }
      if (o(x - 1, y)) { R_(g, px, py, 2, TS, A1); R_(g, px + 2, py, 3, TS, A2); R_(g, px + 5, py, 3, TS, A3); }
      if (o(x + 1, y)) { R_(g, px + 14, py, 2, TS, A1); R_(g, px + 11, py, 3, TS, A2); R_(g, px + 8, py, 3, TS, A3); }
      // two tiles away: very light
      if (o(x, y - 2) && !o(x, y - 1)) R_(g, px, py, TS, 3, A3);
    }
    wallTile(g, x, y, px, py) {
      const P = this.P, st = this.style, lv = this.lv;
      const h = hash3(x, y, this.seed + 1);
      // distance to the floor below (for wainscots)
      let fd = 0; while (fd < 4 && this.open(x, y + fd + 1)) fd++;
      if (st === 'scrap') {
        const pid = hash3(x >> 1, y >> 1, this.seed + 2);
        const wb = this.wallBase(x, y);
        const base = pid < 0.5 ? wb : pid < 0.8 ? this.sh(wb, 0.06) : this.sh(wb, -0.2);
        R_(g, px, py, TS, TS, base);
        const dk = this.sh(base, -0.35), lt = this.sh(base, 0.1);
        if (pid > 0.62 && pid < 0.8) for (let k = 1; k < TS; k += 3) R_(g, px + k, py, 1, TS, dk); // corrugated
        if ((x & 1) === 0) R_(g, px, py, 1, TS, dk);
        if ((y & 1) === 0) { R_(g, px, py, TS, 1, dk); R_(g, px, py + 1, TS, 1, lt); }
        if ((x & 1) === 0 && (y & 1) === 0) { R_(g, px + 2, py + 3, 1, 1, this.sh(base, 0.3)); }
        if ((x & 1) === 1 && (y & 1) === 0) { R_(g, px + 13, py + 3, 1, 1, this.sh(base, 0.3)); }
        if (h < 0.12) { const rx = px + 2 + ((h * 100) | 0) % 12; R_(g, rx, py, 1, 6 + ((h * 50) | 0) % 8, rgba(P.rust, 0.5)); }
        if (fd === 0) {
          // wainscot with a hazard band on top
          R_(g, px, py + 6, TS, 10, this.sh(P.wall0, -0.1));
          for (let xx = 0; xx < TS; xx++) R_(g, px + xx, py + 6, 1, 2, ((x * TS + xx) & 7) < 4 ? '#7a6014' : '#141008');
          R_(g, px, py + 8, TS, 1, this.sh(P.wall0, -0.4));
        }
      } else if (st === 'slums') {
        // building fronts: brick with vertical building segments
        const seg = hash3(Math.floor((x + 3) / 7), 0, this.seed + 3);
        const hue = [P.wall1, mix(P.wall1, '#2a1a1a', 0.5), mix(P.wall1, '#10203a', 0.5), P.wall2][(seg * 4) | 0];
        R_(g, px, py, TS, TS, hue);
        const mort = this.sh(hue, -0.4), lt = this.sh(hue, 0.08);
        if (seg < 0.7) {
          for (let r = 0; r < 4; r++) {
            R_(g, px, py + r * 4 + 3, TS, 1, mort);
            const off = ((y * 4 + r) & 1) ? 4 : 0;
            R_(g, px + off, py + r * 4, 1, 3, mort); R_(g, px + off + 8, py + r * 4, 1, 3, mort);
            if (hash3(x * 4 + r, y, 5) < 0.15) R_(g, px + off + 1, py + r * 4, 7, 3, lt);
          }
        } else {
          R_(g, px, py + 15, TS, 1, mort); R_(g, px + 15, py, 1, TS, mort); R_(g, px, py, TS, 1, lt);
          if (h < 0.3) R_(g, px + 3, py + 3, 2, 10, this.sh(hue, -0.15));
        }
        if (y % 4 === 0 && seg < 0.5) { R_(g, px, py, TS, 2, this.sh(hue, 0.18)); R_(g, px, py + 2, TS, 1, this.sh(hue, -0.5)); }
        if (h > 0.93) R_(g, px + 5, py + 4, 1, 12, rgba('#000000', 0.25));
      } else if (st === 'spire') {
        const wb = this.wallBase(x, y);
        const base = (Math.floor(x / 3) + Math.floor(y / 2)) & 1 ? wb : this.sh(wb, 0.05);
        R_(g, px, py, TS, TS, base);
        if (x % 3 === 0) R_(g, px, py, 1, TS, this.sh(base, 0.18));
        if (y % 2 === 0) R_(g, px, py, TS, 1, this.sh(base, 0.18));
        if (x % 3 === 2) R_(g, px + 15, py, 1, TS, this.sh(base, -0.35));
        if (y % 2 === 1) R_(g, px, py + 15, TS, 1, this.sh(base, -0.35));
        if (fd === 0) { R_(g, px, py + 10, TS, 6, this.sh(P.wall0, -0.2)); R_(g, px, py + 10, TS, 1, this.sh(P.trim2, -0.5)); }
      } else if (st === 'core') {
        const pl = this.plate(x, y, 2, 2, 1);
        const pid = hash3(pl.id, 3, this.seed);
        const base = pid < 0.6 ? P.wall1 : mix(P.wall1, P.wall2, 0.35);
        R_(g, px, py, TS, TS, base);
        const dk = this.sh(base, -0.45), lt = this.sh(base, 0.15);
        if (pl.ly === 0) R_(g, px, py, TS, 1, lt);
        if (pl.lx === 0) R_(g, px, py, 1, TS, lt);
        if (pl.ly === 1) R_(g, px, py + 15, TS, 1, dk);
        if (pl.lx === 1) R_(g, px + 15, py, 1, TS, dk);
        if (pl.lx === 0 && pl.ly === 0) { R_(g, px + 2, py + 2, 2, 2, dk); R_(g, px + 2, py + 2, 1, 1, lt); }
        if (pid > 0.9 && pl.lx === 0) R_(g, px + 12, py + 2, 1, 14, this.sh(P.trim, -0.55));
        if (fd === 0) R_(g, px, py + 8, TS, 8, this.sh(P.wall0, -0.2));
      } else {
        // transit: warm painted panels
        const base = P.wall1;
        R_(g, px, py, TS, TS, base);
        R_(g, px, py + 15, TS, 1, this.sh(base, -0.3));
        if (x % 4 === 0) R_(g, px, py, 1, TS, this.sh(base, -0.25));
      }
    }

    // ============================================================ frame drawing
    ensure(kind, ci) {
      if (kind === 0) return (!this.backC[ci] || this.backDirty[ci]) ? this.renderBackChunk(ci) : this.backC[ci];
      return (!this.tileC[ci] || this.tileDirty[ci]) ? this.renderTileChunk(ci) : this.tileC[ci];
    }
    range(cam) {
      const ox = cam.ox, oy = cam.oy;
      return {
        ox, oy,
        cx0: Math.max(0, Math.floor(ox / CPX)), cy0: Math.max(0, Math.floor(oy / CPX)),
        cx1: Math.min(this.ncx - 1, Math.floor((ox + G.W - 1) / CPX)), cy1: Math.min(this.ncy - 1, Math.floor((oy + G.H - 1) / CPX)),
      };
    }
    update(dt) {
      if (this.bg && this.bg.update) this.bg.update(dt);
      // prefetch one chunk per frame around the camera to avoid hitches
      const r = this.lastRange;
      if (!r) return;
      for (let cy = r.cy0 - 1; cy <= r.cy1 + 1; cy++) for (let cx = r.cx0 - 1; cx <= r.cx1 + 1; cx++) {
        if (cx < 0 || cy < 0 || cx >= this.ncx || cy >= this.ncy) continue;
        const ci = cy * this.ncx + cx;
        if (!this.backC[ci] || this.backDirty[ci]) { this.renderBackChunk(ci); return; }
        if (!this.tileC[ci] || this.tileDirty[ci]) { this.renderTileChunk(ci); return; }
      }
    }
    drawBackground(ctx, cam) {
      const r = this.range(cam);
      this.lastRange = r;
      if (this.bg) this.bg.draw(ctx, cam, this.lv.t);
      else R_(ctx, 0, 0, G.W, G.H, this.P.sky);
      for (let cy = r.cy0; cy <= r.cy1; cy++) for (let cx = r.cx0; cx <= r.cx1; cx++) {
        ctx.drawImage(this.ensure(0, cy * this.ncx + cx), cx * CPX - r.ox, cy * CPX - r.oy);
      }
      // animated decor
      const t = this.lv.t;
      for (let cy = r.cy0 - 1; cy <= r.cy1 + 1; cy++) for (let cx = r.cx0 - 1; cx <= r.cx1 + 1; cx++) {
        if (cx < 0 || cy < 0 || cx >= this.ncx || cy >= this.ncy) continue;
        for (const a of this.animB[cy * this.ncx + cx]) {
          const sx = a.x - r.ox, sy = a.y - r.oy;
          if (sx > G.W + 40 || sy > G.H + 40 || sx + a.w < -40 || sy + a.h < -40) continue;
          const f = ANIM[a.t];
          if (f) f(this, ctx, a, sx, sy, t);
        }
      }
    }
    drawTiles(ctx, cam) {
      const r = this.range(cam);
      for (let cy = r.cy0; cy <= r.cy1; cy++) for (let cx = r.cx0; cx <= r.cx1; cx++) {
        ctx.drawImage(this.ensure(1, cy * this.ncx + cx), cx * CPX - r.ox, cy * CPX - r.oy);
      }
    }
    drawLights(ctx, cam) {
      const r = this.range(cam), t = this.lv.t;
      const vis = (x, y, rad) => x + rad > 0 && y + rad > 0 && x - rad < G.W && y - rad < G.H;
      for (let cy = r.cy0 - 1; cy <= r.cy1 + 1; cy++) for (let cx = r.cx0 - 1; cx <= r.cx1 + 1; cx++) {
        if (cx < 0 || cy < 0 || cx >= this.ncx || cy >= this.ncy) continue;
        const ci = cy * this.ncx + cx;
        for (const l of this.glowB[ci]) {
          const sx = l.x - r.ox, sy = l.y - r.oy;
          if (!vis(sx, sy, Math.max(l.r, 120))) continue;
          const f = flick(l.fl, l.ph, t);
          if (vis(sx, sy, l.r)) G.drawGlow(ctx, sx, sy, l.r, l.c, l.a * f);
          if (l.tube) {
            const tb = l.tube;
            const spr = tb.t === 'vsign' ? vsignSprites(tb).lit : neonSprites(tb).lit;
            const pa = ctx.globalAlpha; ctx.globalAlpha = pa * f * 0.8;
            ctx.drawImage(spr, tb.x - r.ox - (tb.t === 'vsign' ? 0 : 2), tb.y - r.oy - (tb.t === 'vsign' ? 0 : 2));
            ctx.globalAlpha = pa;
          }
          if (l.cone) { const s = coneSprite(l.c); const pa = ctx.globalAlpha; ctx.globalAlpha = pa * f; ctx.drawImage(s, sx - 48, sy); ctx.globalAlpha = pa; }
          if (l.shaft) { const s = shaftSprite(l.c === '#ff9a4a' ? '#ffb070' : '#9ab8ff', 48, 120); ctx.drawImage(s, sx - 30, sy - 10); }
        }
        for (const pd of this.puddleB[ci]) {
          const sx = pd.x - r.ox, sy = pd.y - r.oy;
          if (sx > G.W || sx + pd.w < 0 || sy < -4 || sy > G.H + 4) continue;
          const k = Math.floor(t * 8 + pd.s % 17);
          ctx.fillStyle = 'rgba(160,230,255,0.55)';
          for (let j = 0; j < 2; j++) ctx.fillRect(Math.round(sx + hash3(k, j, pd.s) * (pd.w - 3)), sy + 1, 2, 1);
        }
        for (const s of this.spikeB[ci]) {
          const sx = s.x - r.ox, sy = s.y - r.oy;
          if (!vis(sx, sy, 20)) continue;
          const f = 0.6 + 0.4 * Math.sin(t * 6 + s.ph);
          G.drawGlow(ctx, sx, sy, 16, this.P.spike, 0.35 * f);
          if (hash3(Math.floor(t * 12), s.ph | 0, 2) < 0.05) { R_(ctx, sx - 4 + ((s.ph * 7) % 8 | 0), sy - 6, 1, 3, '#ffffff'); }
        }
        for (const a of this.animB[ci]) {
          const f = LIGHT[a.t];
          if (!f) continue;
          const sx = a.x - r.ox, sy = a.y - r.oy;
          if (sx > G.W + 60 || sy > G.H + 60 || sx + a.w < -60 || sy + a.h < -60) continue;
          f(this, ctx, a, sx, sy, t);
        }
      }
    }

    // ============================================================ weather / foreground
    initWeather() {
      const lv = this.lv, B = lv.B;
      let w = Object.assign({ rain: 0, dust: 0, embers: 0, steam: 0, data: 0 }, B.weather);
      if (lv.kind === 'transit') w = { rain: 0, dust: 0.6, embers: 0, steam: 0, data: 0 };
      if (lv.kind === 'boss') w = { rain: 0, dust: 0, embers: 1.4, steam: 0, data: 0 };
      this.wx = w;
      const R = new G.RNG(this.seed ^ 0x5eed);
      this.drops = [];
      const nRain = Math.round(w.rain * 190);
      for (let i = 0; i < nRain; i++) this.drops.push({ x: R.float(0, G.W), y: R.float(0, G.H), z: R.float(0.55, 1.5), v: R.float(0.85, 1.15) });
      this.motes = [];
      const nM = Math.round(w.dust * 36 + w.embers * 40 + w.data * 26);
      for (let i = 0; i < nM; i++) {
        const kind = R.next() < w.embers * 40 / Math.max(1, nM) ? 'ember' : w.data && R.chance(0.5) ? 'data' : 'dust';
        this.motes.push({ x: R.float(0, G.W), y: R.float(0, G.H), z: R.float(0.5, 1.6), k: kind, ph: R.float(0, 10) });
      }
      this.splash = [];
      this.puffs = [];
      // sky column top (first solid tile from the top): rain only falls in open air
      this.skyTop = new Int16Array(lv.w);
      for (let x = 0; x < lv.w; x++) { let y = 0; while (y < lv.h && lv.tiles[y * lv.w + x] !== T.SOLID) y++; this.skyTop[x] = y; }
      this.steamSrc = (lv.steam || []).slice();
      // floor vents emit steam too
      if (w.steam) for (const it of lv.decor) if (it.t === 'fan' || it.t === 'ac') this.steamSrc.push({ x: it.x + it.w / 2, y: it.y });
      this.prevCam = null;
    }
    drawForeground(ctx, cam) {
      const lv = this.lv, t = lv.t, ox = cam.ox, oy = cam.oy;
      const dt = this.prevT == null ? 1 / 60 : G.clamp(t - this.prevT, 0, 0.1);
      this.prevT = t;
      const dcx = this.prevCam ? ox - this.prevCam.x : 0, dcy = this.prevCam ? oy - this.prevCam.y : 0;
      this.prevCam = { x: ox, y: oy };
      const jump = Math.abs(dcx) > 200 || Math.abs(dcy) > 200;
      // rain
      if (this.drops.length) {
        const W = G.W + 40, H = G.H + 40;
        for (const d of this.drops) {
          d.x += (-60 * d.z * d.v) * dt - (jump ? 0 : dcx * d.z);
          d.y += (430 * d.z * d.v) * dt - (jump ? 0 : dcy * d.z);
          if (d.y > G.H + 20) { d.y -= H; d.x = G.rand.float(-20, G.W + 20); }
          if (d.y < -20) d.y += H;
          if (d.x < -20) d.x += W; else if (d.x > G.W + 20) d.x -= W;
          const wx = d.x + ox, wy = d.y + oy;
          const col = Math.floor(wx / TS);
          if (col < 0 || col >= lv.w || wy > this.skyTop[col] * TS) {
            // hit a roof/floor: splash if it's a near drop
            if (d.z > 0.9 && col >= 0 && col < lv.w && wy < this.skyTop[col] * TS + 8 && this.splash.length < 60) this.splash.push({ x: d.x, y: this.skyTop[col] * TS - oy, t: 0 });
            if (col >= 0 && col < lv.w && wy > this.skyTop[col] * TS) { d.y -= H * 0.5 + G.rand.float(0, H * 0.5); }
            continue;
          }
          const len = Math.round(4 + d.z * 5), a = d.z > 1 ? 0.45 : 0.22;
          ctx.fillStyle = d.z > 1.2 ? 'rgba(200,225,255,' + a + ')' : 'rgba(150,175,230,' + a + ')';
          const x = Math.round(d.x), y = Math.round(d.y);
          ctx.fillRect(x, y, 1, len >> 1);
          ctx.fillRect(x - 1, y + (len >> 1), 1, len - (len >> 1));
        }
        for (let i = this.splash.length - 1; i >= 0; i--) {
          const s = this.splash[i];
          s.t += dt; s.x -= jump ? 0 : dcx; s.y -= jump ? 0 : dcy;
          if (s.t > 0.18) { this.splash.splice(i, 1); continue; }
          const k = s.t / 0.18;
          ctx.fillStyle = 'rgba(190,220,255,' + (0.6 * (1 - k)).toFixed(2) + ')';
          ctx.fillRect(Math.round(s.x - 2 - k * 3), Math.round(s.y - 2 - k * 3), 1, 1);
          ctx.fillRect(Math.round(s.x + 2 + k * 3), Math.round(s.y - 2 - k * 3), 1, 1);
          ctx.fillRect(Math.round(s.x - 1), Math.round(s.y - 1), 2, 1);
        }
      }
      // dust / embers / data motes
      for (const m of this.motes) {
        m.x -= jump ? 0 : dcx * (m.z - 1) * 0.6; m.y -= jump ? 0 : dcy * (m.z - 1) * 0.6;
        if (m.k === 'ember') { m.y -= 18 * m.z * dt; m.x += Math.sin(t * 1.3 + m.ph) * 10 * dt; }
        else if (m.k === 'data') { m.y += 12 * dt; }
        else { m.x += Math.sin(t * 0.4 + m.ph) * 4 * dt; m.y += Math.cos(t * 0.3 + m.ph) * 3 * dt; }
        if (m.x < -10) m.x += G.W + 20; if (m.x > G.W + 10) m.x -= G.W + 20;
        if (m.y < -10) m.y += G.H + 20; if (m.y > G.H + 10) m.y -= G.H + 20;
        const tw = 0.5 + 0.5 * Math.sin(t * 2 + m.ph * 3);
        if (m.k === 'ember') ctx.fillStyle = 'rgba(255,' + (120 + ((tw * 90) | 0)) + ',60,' + (0.5 + 0.4 * tw).toFixed(2) + ')';
        else if (m.k === 'data') ctx.fillStyle = 'rgba(120,200,255,' + (0.25 + 0.35 * tw).toFixed(2) + ')';
        else ctx.fillStyle = 'rgba(210,200,230,' + (0.12 + 0.18 * tw).toFixed(2) + ')';
        const s = m.z > 1.3 ? 2 : 1;
        ctx.fillRect(Math.round(m.x), Math.round(m.y), s, m.k === 'data' ? 3 : s);
      }
      // steam puffs from vents / stalls
      if (this.steamSrc.length) {
        for (const s of this.steamSrc) {
          const sx = s.x - ox, sy = s.y - oy;
          if (sx < -40 || sx > G.W + 40 || sy < -40 || sy > G.H + 60) continue;
          if (G.rand.chance(dt * 5) && this.puffs.length < 50) this.puffs.push({ x: s.x + G.rand.float(-3, 3), y: s.y, t: 0, life: G.rand.float(1.2, 2.2), r: G.rand.float(2, 4) });
        }
        for (let i = this.puffs.length - 1; i >= 0; i--) {
          const p = this.puffs[i];
          p.t += dt;
          if (p.t > p.life) { this.puffs.splice(i, 1); continue; }
          const k = p.t / p.life;
          const r = Math.round(p.r + k * 7);
          ctx.fillStyle = 'rgba(190,190,215,' + (0.16 * (1 - k)).toFixed(3) + ')';
          G.px.disc(ctx, p.x - ox + Math.sin(p.t * 2) * 3, p.y - oy - p.t * 16, r);
        }
      }
      // foreground silhouettes (parallax 1.3)
      for (const f of this.lv.fg) {
        const sx = Math.round((f.x - ox - G.W / 2) * 1.3 + G.W / 2), sy = Math.round((f.y - oy - G.H / 2) * 1.3 + G.H / 2);
        if (sx < -200 || sx > G.W + 200 || sy < -120 || sy > G.H + 120) continue;
        ctx.drawImage(this.fgSprite(f), sx - 80, sy);
      }
      // haze at the bottom of the screen
      const hz = cached('haze|' + this.P.fog, G.W, 90, (g) => {
        const [rr, gg, bb] = hexToRgb(this.P.fog);
        for (let y = 0; y < 90; y++) { g.fillStyle = 'rgba(' + rr + ',' + gg + ',' + bb + ',' + (0.3 * (y / 90) * (y / 90)).toFixed(3) + ')'; g.fillRect(0, y, G.W, 1); }
      });
      ctx.drawImage(hz, 0, G.H - 90);
    }
    fgSprite(f) {
      let s = this.fgSprites.get(f);
      if (s) return s;
      const r = new G.RNG(f.s);
      const ink = mix(this.P.sil, '#000000', 0.4), rim = mix(this.P.rock1, this.P.rock2, 0.3);
      if (f.t === 'fgcable') {
        s = mkCanvas(160, 70);
        const g = s.getContext('2d');
        for (let k = 0, n = r.int(1, 2); k < n; k++) {
          const sag = r.int(20, 50), th = 2, y0 = r.int(0, 8) + k * 5;
          for (let x = 0; x < 160; x++) { const u = x / 159, y = y0 + 4 * sag * u * (1 - u); R_(g, x, Math.round(y), 1, th, ink); R_(g, x, Math.round(y) + th, 1, 1, rim); }
        }
      } else {
        s = mkCanvas(160, 50);
        const g = s.getContext('2d');
        // junk pile / railing silhouette
        for (let k = 0; k < 7; k++) { const w = r.int(10, 34), h = r.int(8, 26), x = r.int(0, 160 - w); R_(g, x, 50 - h, w, h, ink); R_(g, x, 50 - h, w, 1, rim); }
        for (let x = 4; x < 156; x += 12) R_(g, x, 12, 2, 38, ink);
        R_(g, 0, 12, 160, 2, ink); R_(g, 0, 12, 160, 1, rim);
      }
      this.fgSprites.set(f, s);
      return s;
    }
  }

  // ================================================================ decor painters
  // Each gets (art, g, item, x, y) with x,y = item position in chunk-local px.
  function catenary(g, x0, y0, x1, y1, sag, color, th = 1) {
    const n = Math.max(1, Math.abs(x1 - x0));
    let py = null;
    for (let i = 0; i <= n; i++) {
      const u = i / n, x = Math.round(x0 + (x1 - x0) * u), y = Math.round(y0 + (y1 - y0) * u + 4 * sag * u * (1 - u));
      if (py !== null && Math.abs(y - py) > 1) R_(g, x, Math.min(y, py), th, Math.abs(y - py), color);
      else R_(g, x, y, th, th, color);
      py = y;
    }
  }
  const DECOR = {
    roof(A, g, it, x, y) {
      const P = A.P, r = new G.RNG(it.s);
      // parapet + rooftop clutter silhouettes against the sky
      const dark = mix(P.wall0, '#000000', 0.35);
      R_(g, x, y + 10, it.w, 6, dark); R_(g, x, y + 10, it.w, 1, P.wall3);
      let k = r.int(0, 2);
      if (k === 0) { const tx = x + r.int(4, Math.max(5, it.w - 30)); R_(g, tx, y - 12, 22, 22, dark); R_(g, tx - 2, y - 14, 26, 3, dark); R_(g, tx + 3, y + 2, 2, 8, dark); R_(g, tx + 17, y + 2, 2, 8, dark); R_(g, tx, y - 12, 1, 22, P.wall2); }
      else if (k === 1) { const ax = x + r.int(4, Math.max(5, it.w - 10)); R_(g, ax, y - 30, 1, 40, dark); R_(g, ax - 4, y - 22, 9, 1, dark); R_(g, ax - 3, y - 14, 7, 1, dark); R_(g, ax, y - 31, 1, 1, '#ff3348'); }
      else { const dx = x + r.int(4, Math.max(5, it.w - 20)); G.px.disc(g, dx + 8, y + 2, 7, dark); R_(g, dx + 7, y + 2, 2, 8, dark); }
    },
    neon(A, g, it, x, y) { g.drawImage(neonSprites(it).base, x, y); },
    vsign(A, g, it, x, y) {
      g.drawImage(vsignSprites(it).base, x, y);
      R_(g, x + 4, y - 3, 1, 3, '#1a1824'); R_(g, x + 8, y - 3, 1, 3, '#1a1824');
    },
    lamp(A, g, it, x, y) {
      const P = A.P, len = it.len, cx = x;
      const cable = '#0c0a12';
      if (it.kind === 'sodium') {
        for (let k = 0; k < len; k += 3) { R_(g, cx - 1, y + k, 1, 2, '#2a2430'); R_(g, cx, y + k + 1, 1, 2, '#1a1620'); }
        const by = y + len;
        R_(g, cx - 2, by - 2, 4, 2, '#2a2430');
        R_(g, cx - 6, by, 12, 2, '#3a3440'); R_(g, cx - 7, by + 2, 14, 2, '#2a2430'); R_(g, cx - 6, by, 12, 1, '#5a5460');
        R_(g, cx - 5, by + 4, 10, 1, it.c); R_(g, cx - 3, by + 5, 6, 1, mix(it.c, '#ffffff', 0.5));
      } else if (it.kind === 'lantern') {
        R_(g, cx, y, 1, len, cable);
        const by = y + len;
        R_(g, cx - 3, by, 7, 9, it.c); R_(g, cx - 2, by - 1, 5, 11, it.c);
        R_(g, cx - 3, by + 3, 7, 1, mix(it.c, '#000000', 0.4)); R_(g, cx - 3, by + 6, 7, 1, mix(it.c, '#000000', 0.4));
        R_(g, cx - 1, by + 1, 2, 7, mix(it.c, '#ffffff', 0.45));
        R_(g, cx - 1, by + 10, 3, 1, '#2a1a10'); R_(g, cx, by + 11, 1, 3, it.c);
      } else if (it.kind === 'cage') {
        R_(g, cx, y, 1, len, cable);
        const by = y + len;
        R_(g, cx - 4, by, 9, 2, '#2a1a22'); R_(g, cx - 3, by + 2, 7, 5, mix(it.c, '#ffffff', 0.3));
        for (let k = -3; k <= 3; k += 2) R_(g, cx + k, by + 2, 1, 5, '#1a0a12');
        R_(g, cx - 4, by + 7, 9, 1, '#2a1a22');
      } else if (it.kind === 'tube') {
        // fluorescent tube on two wires
        R_(g, cx - 7, y, 1, len, cable); R_(g, cx + 7, y, 1, len, cable);
        const by = y + len;
        R_(g, cx - 9, by, 19, 3, '#1e2228'); R_(g, cx - 9, by, 19, 1, '#3a4048');
        R_(g, cx - 8, by + 3, 17, 1, mix(it.c, '#ffffff', 0.6)); R_(g, cx - 8, by + 4, 17, 1, it.c);
      } else {
        // bare bulb with a small shade
        R_(g, cx, y, 1, len, cable);
        const by = y + len;
        R_(g, cx - 4, by, 9, 2, '#1e1c28'); R_(g, cx - 5, by + 2, 11, 1, '#2e2c3a');
        R_(g, cx - 1, by + 3, 3, 3, mix(it.c, '#ffffff', 0.6)); R_(g, cx, by + 6, 1, 1, it.c);
      }
    },
    pipe(A, g, it, x, y) {
      const c = it.c, d = it.d;
      const hi = mix(c, '#ffffff', 0.25), dk = mix(c, '#000000', 0.5), dk2 = mix(c, '#000000', 0.75);
      if (it.vert) {
        R_(g, x, y, d, it.h, c);
        R_(g, x, y, 1, it.h, hi); R_(g, x + 1, y, 1, it.h, mix(c, hi, 0.5));
        R_(g, x + d - 2, y, 1, it.h, dk); R_(g, x + d - 1, y, 1, it.h, dk2);
        for (let k = (it.s % it.flange); k < it.h; k += it.flange) { R_(g, x - 1, y + k, d + 2, 3, dk); R_(g, x - 1, y + k, d + 2, 1, hi); R_(g, x + d + 1, y + k + 1, 3, 1, dk2); }
        return;
      }
      R_(g, x, y, it.w, d, c);
      R_(g, x, y, it.w, 1, hi); R_(g, x, y + 1, it.w, 1, mix(c, hi, 0.5));
      R_(g, x, y + d - 2, it.w, 1, dk); R_(g, x, y + d - 1, it.w, 1, dk2);
      for (let k = (it.s % it.flange); k < it.w; k += it.flange) {
        R_(g, x + k, y - 1, 3, d + 2, dk); R_(g, x + k, y - 1, 1, d + 2, hi);
        R_(g, x + k + 1, y - 4, 1, 3, dk2);
      }
    },
    cable(A, g, it, x, y) {
      const x1 = x + it.w, y0 = it.y0 - it.y + y, y1 = it.y1 - it.y + y;
      for (let k = 0; k < it.n; k++) catenary(g, x, y0 + k * 2, x1, y1 + k * 3, it.sag - k * 3, k === 0 && it.c ? mix(it.c, '#000000', 0.2) : '#0b0912', 1);
    },
    chain(A, g, it, x, y) {
      const m = A.P.metal, hi = mix(m, '#ffffff', 0.2), dk = mix(m, '#000000', 0.5);
      for (let k = 0; k < it.len; k += 4) {
        if ((k >> 2) & 1) { R_(g, x + 1, y + k, 1, 4, hi); R_(g, x + 2, y + k, 1, 4, dk); }
        else { R_(g, x, y + k, 1, 4, hi); R_(g, x + 2, y + k, 1, 4, dk); R_(g, x + 1, y + k, 1, 1, hi); R_(g, x + 1, y + k + 3, 1, 1, dk); }
      }
      if (it.hook) { const hy = y + it.len; R_(g, x + 1, hy, 1, 4, hi); R_(g, x - 1, hy + 4, 3, 1, hi); R_(g, x - 2, hy + 1, 1, 3, hi); }
    },
    window(A, g, it, x, y) {
      const P = A.P, st = it.style;
      const fr = st === 'spire' ? '#2a3456' : st === 'transit' ? '#3a3040' : st === 'core' ? '#240a16' : '#2a2a34', frh = mix(fr, '#ffffff', 0.18), frd = mix(fr, '#000000', 0.5);
      // glass tint
      if (st === 'furnace') {
        // molten glow behind the grate
        for (let yy = 0; yy < it.h; yy++) { g.fillStyle = mix('#ff3a0a', '#ffd060', (yy / it.h) * (yy / it.h)); g.fillRect(x, y + yy, it.w, 1); }
        g.fillStyle = 'rgba(60,10,0,0.5)'; for (let k = 0; k < 6; k++) G.px.disc(g, x + ((it.s >> k) % it.w), y + it.h * 0.3 + ((it.s >> (k + 3)) % 12), 4 + (k % 3));
      } else g.fillStyle = rgba(P.wallTint, st === 'scrap' ? 0.4 : st === 'clear' ? 0.18 : 0.22), g.fillRect(x, y, it.w, it.h);
      // grime at the bottom
      if (st === 'scrap' || st === 'clear') { g.fillStyle = 'rgba(40,20,10,0.35)'; g.fillRect(x, y + it.h - 10, it.w, 10); }
      // reflections
      g.fillStyle = 'rgba(255,255,255,0.07)';
      for (let k = 0; k < it.h; k++) { g.fillRect(x + 6 + k, y + k, 3, 1); g.fillRect(x + 22 + k, y + k, 1, 1); }
      // bars / mullions
      if (st === 'scrap' || st === 'furnace') for (let xx = 6; xx < it.w - 2; xx += 6) { R_(g, x + xx, y, 2, it.h, frd); R_(g, x + xx, y, 1, it.h, fr); }
      else if (st === 'clear') { for (let xx = 16; xx < it.w; xx += 16) R_(g, x + xx - 1, y, 2, it.h, fr); for (let yy = 16; yy < it.h; yy += 16) R_(g, x, y + yy - 1, it.w, 2, fr); }
      else if (st === 'core') {
        for (let xx = 48; xx < it.w; xx += 48) { R_(g, x + xx - 3, y, 6, it.h, fr); R_(g, x + xx - 3, y, 1, it.h, frh); for (let yy = 6; yy < it.h; yy += 12) R_(g, x + xx - 1, y + yy, 2, 2, frh); }
        R_(g, x, y + it.h - 20, it.w, 3, fr); R_(g, x, y + it.h - 20, it.w, 1, frh);
      } else { for (let xx = 16; xx < it.w; xx += 16) R_(g, x + xx - 1, y, 2, it.h, fr); R_(g, x, y + (it.h >> 1), it.w, 2, fr); }
      // arched top for industrial windows (brick-factory style)
      if (st === 'scrap' || st === 'furnace' || st === 'clear') {
        const r = it.w / 2, wall = A.wallBase(Math.floor((it.x) / TS), Math.floor(it.y / TS));
        const cx = x + r;
        for (let yy = 0; yy < r; yy++) {
          const hw = Math.floor(Math.sqrt(r * r - (r - yy) * (r - yy)));
          const l = Math.round(cx - hw), rr = Math.round(cx + hw);
          R_(g, x, y + yy, l - x, 1, wall); R_(g, rr, y + yy, x + it.w - rr, 1, wall);
          R_(g, l - 2, y + yy, 2, 1, fr); R_(g, rr, y + yy, 2, 1, fr);
          if (yy === 0) R_(g, l, y, rr - l, 1, fr);
        }
        // keystone
        R_(g, Math.round(cx) - 3, y - 3, 6, 5, frh); R_(g, Math.round(cx) - 2, y - 2, 4, 3, fr);
        R_(g, x - 3, y + it.h, it.w + 6, 4, fr); R_(g, x - 3, y + it.h, it.w + 6, 1, frh);
        R_(g, x - 3, y + r, 3, it.h - r, fr); R_(g, x + it.w, y + r, 3, it.h - r, fr);
        return;
      }
      // frame
      R_(g, x - 3, y - 3, it.w + 6, 3, fr); R_(g, x - 3, y + it.h, it.w + 6, 4, fr);
      R_(g, x - 3, y, 3, it.h, fr); R_(g, x + it.w, y, 3, it.h, fr);
      R_(g, x - 3, y - 3, it.w + 6, 1, frh); R_(g, x - 3, y + it.h + 3, it.w + 6, 1, frd);
      R_(g, x - 4, y + it.h + 1, it.w + 8, 1, frh);
    },
    glass(A, g, it, x, y) {
      const P = A.P, fr = '#1c2442', frh = '#3a4a7a';
      g.fillStyle = rgba('#3a5aa8', 0.13); g.fillRect(x, y, it.w, it.h);
      g.fillStyle = 'rgba(200,220,255,0.06)';
      for (let k = 0; k < it.h; k += 1) { const xx = (k * 2) % (it.w + 40) - 20; g.fillRect(x + Math.max(0, xx), y + k, Math.max(0, Math.min(10, it.w - xx)), 1); }
      for (let xx = 0; xx <= it.w; xx += it.mull) { R_(g, x + xx - 2, y, 4, it.h, fr); R_(g, x + xx - 2, y, 1, it.h, frh); }
      R_(g, x - 2, y - 3, it.w + 4, 3, fr); R_(g, x - 2, y - 3, it.w + 4, 1, frh);
      R_(g, x - 2, y + it.h, it.w + 4, 4, fr); R_(g, x - 2, y + it.h, it.w + 4, 1, frh);
      R_(g, x, y + it.h + 1, it.w, 1, P.lamp2);
    },
    girder(A, g, it, x, y) {
      const m = mix(A.P.metal, A.P.wall0, 0.45), hi = mix(m, '#ffffff', 0.15), dk = mix(m, '#000000', 0.55);
      R_(g, x, y, 3, it.h, m); R_(g, x + 9, y, 3, it.h, m);
      R_(g, x, y, 1, it.h, hi); R_(g, x + 11, y, 1, it.h, dk);
      R_(g, x + 3, y, 6, it.h, dk);
      for (let k = 0; k < it.h - 12; k += 24) {
        for (let j = 0; j < 12; j++) { R_(g, x + 3 + (j >> 1), y + k + j, 1, 1, m); R_(g, x + 8 - (j >> 1), y + k + 12 + j, 1, 1, m); }
        R_(g, x + 1, y + k + 2, 1, 1, hi); R_(g, x + 10, y + k + 2, 1, 1, hi);
      }
    },
    screen(A, g, it, x, y) {
      R_(g, x, y, it.w, it.h, '#0a0a10'); R_(g, x + 1, y + 1, it.w - 2, it.h - 2, '#22222e');
      R_(g, x + 3, y + 3, it.w - 6, it.h - 7, mix(it.c, '#000000', 0.82));
      R_(g, x + 1, y + it.h - 3, it.w - 2, 1, '#0a0a10');
      R_(g, x + it.w - 5, y + it.h - 2, 2, 1, '#48ff8a');
      R_(g, x + (it.w >> 1) - 1, y - 6, 2, 6, '#141420');
    },
    cage(A, g, it, x, y) {
      const m = mix(A.P.metal, '#000000', 0.2), hi = mix(m, '#ffffff', 0.2);
      g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(x + 2, y + 4, it.w - 4, it.h - 6);
      if (it.body) { const bx = x + 18; R_(g, bx, y + 22, 8, 7, '#18141c'); R_(g, bx + 2, y + 29, 5, 16, '#18141c'); R_(g, bx - 2, y + 30, 3, 10, '#18141c'); R_(g, bx + 7, y + 30, 3, 10, '#18141c'); R_(g, bx + 2, y + 45, 2, 12, '#18141c'); R_(g, bx + 5, y + 45, 2, 12, '#18141c'); R_(g, bx + 5, y + 24, 2, 1, '#ff3348'); }
      for (let xx = 2; xx < it.w - 1; xx += 5) { R_(g, x + xx, y + 3, 2, it.h - 4, m); R_(g, x + xx, y + 3, 1, it.h - 4, hi); }
      R_(g, x, y, it.w, 4, m); R_(g, x, y, it.w, 1, hi); R_(g, x, y + it.h - 3, it.w, 3, m); R_(g, x, y + 18, it.w, 2, m);
      R_(g, x + it.w - 10, y + 30, 5, 6, '#3a3040'); R_(g, x + it.w - 9, y + 31, 3, 2, '#b8901c');
    },
    conveyor(A, g, it, x, y) {
      const m = '#2c2830', hi = '#4a4450', dk = '#141218';
      R_(g, x, y, it.w, 3, '#1c1a20'); R_(g, x, y + 3, it.w, 6, m); R_(g, x, y + 3, it.w, 1, hi); R_(g, x, y + 8, it.w, 1, dk);
      for (let k = 4; k < it.w; k += 10) { G.px.disc(g, x + k, y + 6, 2, dk); R_(g, x + k, y + 6, 1, 1, hi); }
      for (let k = 12; k < it.w - 8; k += 40) { R_(g, x + k, y + 9, 3, 12, dk); R_(g, x + k + 1, y + 9, 1, 12, m); }
      const r = new G.RNG(it.s);
      for (let k = 8; k < it.w - 10; k += r.int(14, 30)) { const w = r.int(5, 10), h = r.int(3, 7); R_(g, x + k, y - h, w, h, r.pick(['#3a3040', '#5a3a2a', '#2a3a3a'])); R_(g, x + k, y - h, w, 1, '#6a5a60'); }
    },
    crate(A, g, it, x, y) {
      const c = '#3a2e2a', hi = '#5a4a40', dk = '#1e1614';
      R_(g, x + 1, y + 2, 14, 14, c); R_(g, x + 1, y + 2, 14, 1, hi); R_(g, x + 1, y + 2, 1, 14, hi); R_(g, x + 14, y + 2, 1, 14, dk);
      R_(g, x + 1, y + 8, 14, 1, dk); for (let k = 0; k < 12; k++) R_(g, x + 2 + k, y + 3 + k, 1, 1, dk);
      R_(g, x + 4, y + 11, 5, 1, '#b8901c');
    },
    barrel(A, g, it, x, y) {
      const c = it.toxic ? '#2a3a22' : '#3a2a2a', hi = mix(c, '#ffffff', 0.2), dk = mix(c, '#000000', 0.5);
      R_(g, x + 3, y + 3, 10, 13, c); R_(g, x + 3, y + 3, 2, 13, hi); R_(g, x + 11, y + 3, 2, 13, dk);
      R_(g, x + 2, y + 6, 12, 1, dk); R_(g, x + 2, y + 12, 12, 1, dk);
      R_(g, x + 3, y + 2, 10, 1, hi);
      if (it.toxic) { R_(g, x + 4, y + 2, 8, 1, '#8aff4a'); R_(g, x + 6, y + 8, 4, 3, '#b8901c'); }
    },
    fan(A, g, it, x, y) {
      const m = '#24222c', hi = '#3c3a48', dk = '#0c0b10';
      R_(g, x, y, 32, 32, m); R_(g, x, y, 32, 1, hi); R_(g, x, y, 1, 32, hi); R_(g, x + 31, y, 1, 32, dk); R_(g, x, y + 31, 32, 1, dk);
      G.px.disc(g, x + 16, y + 16, 13, dk);
      for (const [a, b] of [[2, 2], [28, 2], [2, 28], [28, 28]]) R_(g, x + a, y + b, 2, 2, hi);
    },
    hazard(A, g, it, x, y) {
      R_(g, x, y, it.w, it.h, '#141008');
      for (let yy = 1; yy < it.h - 1; yy++) for (let xx = 1; xx < it.w - 1; xx++) if (((xx + yy) & 7) < 4) R_(g, x + xx, y + yy, 1, 1, '#9a7818');
      R_(g, x + 8, y + 7, it.w - 16, it.h - 14, '#141008');
      G.font.draw(g, it.w > 40 ? 'DANGER' : '!', x + it.w / 2, y + it.h / 2 - 3, '#c8a01e', 1, 'center', null);
    },
    gear(A, g, it, x, y) {
      const c = mix(A.P.metal, A.P.wall0, 0.5), dk = mix(c, '#000000', 0.5);
      const cx = x + 32, cy = y + 32;
      for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; R_(g, Math.round(cx + Math.cos(a) * 27) - 3, Math.round(cy + Math.sin(a) * 27) - 3, 6, 6, c); }
      G.px.disc(g, cx, cy, 25, c); G.px.disc(g, cx, cy, 16, dk); G.px.disc(g, cx, cy, 6, c); G.px.disc(g, cx, cy, 2, dk);
    },
    beacon(A, g, it, x, y) { R_(g, x, y + 4, 10, 4, '#1a1016'); R_(g, x + 2, y, 6, 4, mix(A.P.lamp, '#000000', 0.4)); R_(g, x + 3, y + 1, 2, 1, A.P.lamp); },
    ac(A, g, it, x, y) {
      const c = '#4a4658', hi = '#6a6680', dk = '#24222e';
      R_(g, x, y, it.w, it.h, c); R_(g, x, y, it.w, 1, hi); R_(g, x, y + it.h - 1, it.w, 1, dk);
      G.px.disc(g, x + 7, y + 7, 5, dk);
      for (let k = 0; k < 4; k++) R_(g, x + 14, y + 3 + k * 3, 6, 1, dk);
      R_(g, x + it.w - 3, y + it.h, 1, 6, '#2a2838');
      R_(g, x - 2, y + it.h, it.w + 4, 1, '#1a1822');
    },
    awin(A, g, it, x, y) {
      R_(g, x - 1, y - 1, it.w + 2, it.h + 2, '#0c0914');
      if (it.on) {
        R_(g, x, y, it.w, it.h, mix(it.c, '#000000', 0.25));
        R_(g, x, y + it.h - 6, it.w, 6, mix(it.c, '#000000', 0.45));
        if (it.blinds) for (let k = 1; k < it.h; k += 3) R_(g, x, y + k, it.w, 1, mix(it.c, '#000000', 0.55));
        else { R_(g, x + 2, y + 8, 4, 8, mix(it.c, '#000000', 0.7)); R_(g, x + 3, y + 5, 3, 3, mix(it.c, '#000000', 0.7)); }
      } else { R_(g, x, y, it.w, it.h, '#0e0c18'); R_(g, x + 1, y + 1, 3, 1, 'rgba(255,255,255,0.06)'); }
      R_(g, x + (it.w >> 1), y, 1, it.h, '#0c0914');
      R_(g, x - 2, y + it.h + 1, it.w + 4, 2, '#2a2238'); R_(g, x - 2, y + it.h + 1, it.w + 4, 1, '#3e3454');
    },
    streetlamp(A, g, it, x, y) {
      const m = '#1c1a26', hi = '#34304a';
      R_(g, x, y + 4, 2, it.h - 4, m); R_(g, x, y + 4, 1, it.h - 4, hi);
      R_(g, x - 2, y + it.h - 3, 6, 3, m);
      const d = it.dir;
      for (let k = 0; k < 8; k++) R_(g, x + d * k + (d < 0 ? 1 : 0), y + 3 - (k > 5 ? 1 : 0), 1, 2, m);
      R_(g, x + d * 8 - 3, y + 1, 7, 3, m); R_(g, x + d * 8 - 2, y + 4, 5, 1, mix(it.c, '#ffffff', 0.5));
    },
    stall(A, g, it, x, y) {
      const r = new G.RNG(it.s);
      const aw = it.c, aw2 = '#e8e0d8';
      // back wall of the stall
      R_(g, x + 4, y + 14, 72, 34, '#1a1220'); R_(g, x + 4, y + 14, 72, 1, '#2a2030');
      // shelves with bowls/bottles
      for (let k = 0; k < 9; k++) R_(g, x + 10 + k * 7, y + 22, 3, 5, r.pick(['#ff5c5c', '#ffd27a', '#48ff8a', '#27f3ff']));
      R_(g, x + 8, y + 27, 64, 1, '#3a2a40');
      // awning
      for (let k = 0; k < 80; k += 8) { R_(g, x + k, y + 8, 4, 6, aw); R_(g, x + k + 4, y + 8, 4, 6, aw2); R_(g, x + k, y + 14, 4, 2, aw); }
      R_(g, x, y + 7, 80, 1, mix(aw, '#000000', 0.5));
      // counter
      R_(g, x + 2, y + 44, 76, 4, '#5a3a2a'); R_(g, x + 2, y + 44, 76, 1, '#8a6a4a'); R_(g, x + 4, y + 48, 72, 16, '#2a1a1a');
      for (let k = 0; k < 4; k++) R_(g, x + 10 + k * 18, y + 50, 10, 1, '#4a2a2a');
      // pot
      R_(g, x + 26, y + 38, 12, 6, '#6a6a7a'); R_(g, x + 26, y + 38, 12, 1, '#9a9aaa');
      // stools
      for (const sx of [12, 36, 60]) { R_(g, x + sx, y + 52, 8, 2, '#8a2a2a'); R_(g, x + sx + 3, y + 54, 2, 10, '#2a2230'); }
      // sign
      const s = G.font.sprite(it.text, mix(it.c, '#ffffff', 0.3), 1, '#0a0810');
      R_(g, x + 40 - (s.width >> 1) - 3, y, s.width + 6, 8, '#0a0810');
      g.drawImage(s, x + 40 - (s.width >> 1), y + 1);
      // hanging lanterns
      for (const lx of [6, 72]) { R_(g, x + lx, y + 16, 1, 4, '#0a0810'); R_(g, x + lx - 2, y + 20, 5, 6, '#ff3348'); R_(g, x + lx - 1, y + 21, 2, 4, '#ffb35c'); }
    },
    vending(A, g, it, x, y) {
      const c = it.c, dk = mix(c, '#000000', 0.55), hi = mix(c, '#ffffff', 0.3);
      R_(g, x, y, it.w, it.h, c); R_(g, x, y, it.w, 1, hi); R_(g, x, y, 1, it.h, hi); R_(g, x + it.w - 1, y, 1, it.h, dk);
      R_(g, x + 3, y + 3, 16, 26, '#d8f0ff');
      const r = new G.RNG(it.s);
      for (let row = 0; row < 4; row++) { R_(g, x + 3, y + 8 + row * 6, 16, 1, '#8aa0b8'); for (let k = 0; k < 4; k++) R_(g, x + 4 + k * 4, y + 5 + row * 6, 2, 3, r.pick(['#ff3348', '#27f3ff', '#ffe14d', '#48ff8a', '#ff8a2a'])); }
      R_(g, x + 21, y + 4, 4, 8, '#1a1a24'); for (let k = 0; k < 3; k++) R_(g, x + 22, y + 14 + k * 3, 2, 2, '#ffe14d');
      R_(g, x + 3, y + 32, 16, 6, '#101018'); R_(g, x + 3, y + 32, 16, 1, '#2a2a38');
      R_(g, x + 1, y + it.h - 2, it.w - 2, 2, dk);
    },
    trash(A, g, it, x, y) {
      const c = '#1c1a28', hi = '#34304a';
      G.px.disc(g, x + 6, y + 12, 4, c); G.px.disc(g, x + 11, y + 11, 5, '#221e30'); R_(g, x + 9, y + 7, 2, 1, hi); R_(g, x + 4, y + 9, 2, 1, hi);
      R_(g, x + 2, y + 15, 13, 1, '#0e0c16');
    },
    poster(A, g, it, x, y) {
      const r = new G.RNG(it.s);
      if (it.graffiti) {
        // spray-paint tag: wobbly outlined letters with drips
        const tag = r.pick(['NEO', 'ZERO', 'FREE', 'RIOT', 'VOID', 'HACK', 'GLITCH', 'X', 'RUN', '404']);
        const spr = G.font.sprite(tag, mix(it.c, '#ffffff', 0.15), 2, mix(it.c, '#000000', 0.7));
        const ox = x + ((it.w - spr.width) >> 1), oy = y + 8;
        for (let cx = 0; cx < spr.width; cx += 2) {
          const dy = Math.round(Math.sin(cx / 5 + (it.s % 7)) * 2);
          g.drawImage(spr, cx, 0, 2, spr.height, ox + cx, oy + dy, 2, spr.height);
        }
        for (let k = 0; k < 4; k++) R_(g, ox + r.int(2, spr.width - 3), oy + spr.height - 2, 1, r.int(2, 7), mix(it.c, '#000000', 0.25));
        return;
      }
      const bg = r.pick(['#3a1a2a', '#1a2a3a', '#3a2a1a', '#2a1a3a']);
      R_(g, x, y, it.w - 6, it.h, bg);
      R_(g, x + 2, y + 2, it.w - 10, 12, mix(it.c, '#000000', 0.3));
      G.px.disc(g, x + (it.w - 6) / 2, y + 9, 4, mix(it.c, '#ffffff', 0.2));
      for (let k = 0; k < 3; k++) R_(g, x + 2, y + 17 + k * 3, r.int(8, it.w - 10), 1, '#c8c0d0');
      R_(g, x + it.w - 8, y + it.h - 5, 2, 5, 'rgba(0,0,0,0.5)');
    },
    lanterns(A, g, it, x, y) {
      catenary(g, x, y, x + it.w, y, it.sag, '#0a0810', 1);
      for (let i = 1; i < it.n; i++) {
        const u = i / it.n, lx = Math.round(x + u * it.w), ly = Math.round(y + 4 * it.sag * u * (1 - u));
        R_(g, lx, ly, 1, 3, '#0a0810');
        R_(g, lx - 2, ly + 3, 5, 6, it.c); R_(g, lx - 1, ly + 4, 2, 4, mix(it.c, '#ffffff', 0.5));
      }
    },
    rack(A, g, it, x, y) {
      R_(g, x, y, it.w, it.h, '#0a0e1a'); R_(g, x + 1, y + 1, it.w - 2, it.h - 2, '#141a2c');
      for (let k = 3; k < it.h - 4; k += 5) { R_(g, x + 2, y + k, it.w - 4, 4, '#0c1122'); R_(g, x + 2, y + k, it.w - 4, 1, '#222c48'); }
      R_(g, x, y, it.w, 1, '#2c3a60'); R_(g, x + it.w - 1, y, 1, it.h, '#05070e');
    },
    dataslot(A, g, it, x, y) {
      R_(g, x, y, it.w, it.h, '#060912'); R_(g, x + 1, y + 1, it.w - 2, it.h - 2, '#0c1224');
      R_(g, x, y, it.w, 1, '#2c3a60'); R_(g, x, y + it.h - 1, it.w, 1, '#2c3a60');
      R_(g, x + 1, y + 1, 1, it.h - 2, mix(it.c, '#000000', 0.6)); R_(g, x + it.w - 2, y + 1, 1, it.h - 2, mix(it.c, '#000000', 0.6));
    },
    strip(A, g, it, x, y) { R_(g, x - 1, y, it.w + 2, 3, '#0e1222'); R_(g, x, y + 1, it.w, 1, mix(it.c, '#ffffff', 0.5)); R_(g, x, y + 2, it.w, 1, it.c); },
    terminal(A, g, it, x, y) {
      R_(g, x, y + 18, 32, 3, '#2a3456'); R_(g, x, y + 18, 32, 1, '#4a5a8a'); R_(g, x + 3, y + 21, 3, 11, '#141a2c'); R_(g, x + 26, y + 21, 3, 11, '#141a2c');
      R_(g, x + 9, y + 3, 18, 13, '#0a0e1a'); R_(g, x + 17, y + 16, 2, 2, '#141a2c');
      R_(g, x + 6, y + 16, 12, 2, '#1c2440');
    },
    plant(A, g, it, x, y) {
      const r = new G.RNG(it.s);
      R_(g, x + 4, y + 22, 8, 10, '#2a2a3a'); R_(g, x + 4, y + 22, 8, 1, '#4a4a5a');
      for (let k = 0; k < 7; k++) { const lx = x + 8 + r.int(-6, 5), ly = y + r.int(4, 20); R_(g, lx, ly, 3, 2, r.pick(['#1f5a44', '#2a7a5a', '#164034'])); R_(g, Math.round((lx + x + 8) / 2), Math.round((ly + y + 22) / 2), 1, 2, '#164034'); }
    },
    kiosk(A, g, it, x, y) {
      // shop backdrop: shutters, counter and awning
      R_(g, x, y + 8, it.w, it.h - 8, '#161420');
      for (let k = y + 12; k < y + it.h - 14; k += 3) R_(g, x + 4, k, it.w - 8, 1, '#221f30');
      for (let k = 0; k < it.w; k += 8) { R_(g, x + k, y, 4, 8, it.c); R_(g, x + k + 4, y, 4, 8, '#2a2030'); }
      R_(g, x, y + 8, it.w, 1, '#0a0810');
      R_(g, x + 2, y + it.h - 14, it.w - 4, 3, '#4a3a2a'); R_(g, x + 2, y + it.h - 14, it.w - 4, 1, '#8a6a4a');
      R_(g, x + 4, y + it.h - 11, it.w - 8, 11, '#1e1822');
      R_(g, x - 2, y, 2, it.h, '#2a2838'); R_(g, x + it.w, y, 2, it.h, '#2a2838');
    },
    exitframe(A, g, it, x, y) {
      const m = '#1e1c2a', hi = '#3a3650', dk = '#0a0910';
      R_(g, x, y, it.w, it.h, m); R_(g, x + 7, y + 10, it.w - 14, it.h - 10, dk);
      R_(g, x, y, it.w, 1, hi); R_(g, x, y, 1, it.h, hi);
      for (let xx = 0; xx < it.w; xx++) R_(g, x + xx, y + 3, 1, 3, ((xx + (it.s & 7)) & 7) < 4 ? '#9a7818' : '#141008');
      R_(g, x + 2, y + 12, 2, it.h - 14, it.c); R_(g, x + it.w - 4, y + 12, 2, it.h - 14, it.c);
      R_(g, x + 3, y + 12, 1, it.h - 14, '#ffffff');
    },
    tubes(A, g, it, x, y) {
      for (let k = 0; k < 3; k++) { R_(g, x + 4 + k * 8, y, 4, it.h, '#1e1c28'); R_(g, x + 5 + k * 8, y, 2, it.h, mix(it.c, '#000000', 0.5)); R_(g, x + 5 + k * 8, y + ((k * 7) % 20), 2, 6, it.c); }
      R_(g, x, y - 3, it.w, 3, '#2a2838');
    },
    bench(A, g, it, x, y) { R_(g, x, y, it.w, 3, '#5a3a2a'); R_(g, x, y, it.w, 1, '#8a6a4a'); R_(g, x + 3, y + 3, 3, 9, '#2a2230'); R_(g, x + it.w - 6, y + 3, 3, 9, '#2a2230'); },
    tiles(A, g, it, x, y) {
      // transit: tiled lower wall
      for (let yy = 0; yy < it.h; yy += 8) for (let xx = 0; xx < it.w; xx += 8) { R_(g, x + xx, y + yy, 8, 8, ((xx + yy) >> 3) & 1 ? '#2a3a3a' : '#243232'); R_(g, x + xx, y + yy, 8, 1, '#3a4a4a'); R_(g, x + xx, y + yy, 1, 8, '#1a2424'); }
      R_(g, x, y - 3, it.w, 3, '#4a3a2a'); R_(g, x, y - 3, it.w, 1, '#7a5a3a');
    },
  };

  // ================================================================ per-frame animated decor
  const ANIM = {
    screen(A, ctx, a, x, y, t) {
      const r = hash3(Math.floor(t * 3), a.s, 1);
      const c = a.c;
      ctx.fillStyle = mix(c, '#000000', 0.2);
      const rows = Math.floor(a.h / 3);
      for (let k = 0; k < rows; k++) {
        const w = Math.floor(hash3(k + Math.floor(t * 4), a.s, 2) * (a.w - 2)) + 1;
        if (hash3(k, Math.floor(t * 2), a.s) < 0.8) ctx.fillRect(x + 1, y + 1 + k * 3, w, 1);
      }
      if (r < 0.5) { ctx.fillStyle = '#ffffff'; ctx.fillRect(x + 1 + ((t * 20) % (a.w - 2) | 0), y + a.h - 2, 2, 1); }
    },
    fan(A, ctx, a, x, y, t) {
      const n = a.small ? 3 : 4, rad = a.w;
      const ang = t * (a.small ? 14 : 7);
      ctx.fillStyle = a.small ? '#6a6680' : '#3a3848';
      for (let k = 0; k < n; k++) {
        const an = ang + k * Math.PI * 2 / n;
        for (let s = 2; s <= rad; s += 1) ctx.fillRect(Math.round(x + Math.cos(an) * s), Math.round(y + Math.sin(an) * s), 2, 2);
      }
      ctx.fillStyle = '#12101a'; ctx.fillRect(x - 1, y - 1, 3, 3);
    },
    belt(A, ctx, a, x, y, t) {
      ctx.fillStyle = '#3a3640';
      const off = Math.floor(t * 24) % 8;
      for (let k = off; k < a.w; k += 8) ctx.fillRect(x + k, y + 1, 3, 1);
    },
    leds(A, ctx, a, x, y, t) {
      for (let k = 3, row = 0; k < a.h - 4; k += 5, row++) {
        for (let j = 0; j < 5; j++) {
          const on = hash3(row * 7 + j, Math.floor(t * (2 + (j & 1) * 3) + a.s % 7), a.s) < 0.55;
          if (!on) continue;
          ctx.fillStyle = j === 4 ? '#ff5c5c' : (row + j) % 3 ? '#48ff8a' : '#5ab8ff';
          ctx.fillRect(x + 4 + j * 4, y + k + 2, 2, 1);
        }
      }
    },
  };
  // additive animated lights
  const LIGHT = {
    holo(A, ctx, a, x, y, t) {
      const f = flick(2, a.s % 100, t);
      const spr = cached('holo|' + a.s + a.c, a.w, a.h, (g) => {
        const r = new G.RNG(a.s), c = a.c;
        const kind = r.int(0, 2);
        g.fillStyle = rgba(c, 0.18); g.fillRect(0, 0, a.w, a.h);
        g.fillStyle = rgba(c, 0.55);
        g.fillRect(0, 0, a.w, 1); g.fillRect(0, a.h - 1, a.w, 1); g.fillRect(0, 0, 1, a.h); g.fillRect(a.w - 1, 0, 1, a.h);
        g.fillStyle = rgba(c, 0.8);
        if (kind === 0) { // face silhouette
          G.px.disc(g, a.w / 2, a.h / 2 - 4, 11); g.fillStyle = rgba('#000000', 1); g.globalCompositeOperation = 'destination-out'; g.fillRect(a.w / 2 - 6, a.h / 2 - 6, 4, 2); g.fillRect(a.w / 2 + 2, a.h / 2 - 6, 4, 2); g.globalCompositeOperation = 'source-over';
          g.fillStyle = rgba(c, 0.8); g.fillRect(a.w / 2 - 8, a.h / 2 + 8, 16, 12);
        } else if (kind === 1) { // koi
          for (let k = 0; k < 20; k++) g.fillRect(12 + k * 2, Math.round(a.h / 2 + Math.sin(k / 3) * 6), 3, 4 - Math.abs(k - 10) / 4);
        } else { // logo + text
          G.px.ring(g, a.w / 2, a.h / 2 - 6, 10, rgba(c, 0.9), 2); g.drawImage(G.font.sprite('BUY', c, 1, null), a.w / 2 - 6, a.h - 12);
        }
        g.globalCompositeOperation = 'destination-out'; g.fillStyle = 'rgba(0,0,0,0.6)';
        for (let yy = 0; yy < a.h; yy += 2) g.fillRect(0, yy, a.w, 1);
        g.globalCompositeOperation = 'source-over';
      });
      const pa = ctx.globalAlpha;
      ctx.globalAlpha = pa * 0.75 * f;
      const jit = hash3(Math.floor(t * 10), a.s, 3) < 0.08 ? 2 : 0;
      ctx.drawImage(spr, x + jit, y);
      ctx.globalAlpha = pa;
      G.drawGlow(ctx, x + a.w / 2, y + a.h / 2, a.w, a.c, 0.25 * f);
    },
    data(A, ctx, a, x, y, t) {
      const n = 10;
      for (let k = 0; k < n; k++) {
        const yy = ((t * (30 + (k % 3) * 12) + k * 23 + a.s % 50) % a.h) | 0;
        const alpha = 0.3 + 0.6 * hash3(k, Math.floor(t * 6), a.s);
        ctx.fillStyle = rgba(a.c, alpha.toFixed(2));
        ctx.fillRect(x + (k % 3) * 3, y + yy, 2, 2);
        ctx.fillStyle = rgba(a.c, (alpha * 0.3).toFixed(2));
        ctx.fillRect(x + (k % 3) * 3, y + yy - 6, 2, 5);
      }
      G.drawGlow(ctx, x + 4, y + a.h / 2, 24, a.c, 0.12);
    },
    beacon(A, ctx, a, x, y, t) {
      const ang = t * 4 + (a.s % 10);
      const on = Math.cos(ang);
      G.drawGlow(ctx, x, y, 10 + 18 * Math.max(0, on), a.c, 0.5 + 0.4 * Math.max(0, on));
      if (on > 0) { ctx.fillStyle = rgba(a.c, (0.12 * on).toFixed(2)); for (let k = 0; k < 60; k++) ctx.fillRect(Math.round(x + Math.sin(ang) * k), y + (k >> 3), 1, 2 + (k >> 3)); }
    },
    screen(A, ctx, a, x, y, t) { G.drawGlow(ctx, x + a.w / 2, y + a.h / 2, a.w, a.c, 0.15 + 0.05 * Math.sin(t * 5 + a.s)); },
  };
})();
