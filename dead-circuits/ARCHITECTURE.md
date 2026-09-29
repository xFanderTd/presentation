# DEAD CIRCUITS — architecture & module contracts

Cyberpunk action-roguelite in the spirit of Dead Cells. Pure browser game: HTML5 Canvas 2D,
vanilla JS, **no build step, no dependencies, no ES modules** (must run from `file://` and as a
single inlined HTML page). Every file is an IIFE that attaches to the global `window.G`.

UI language: **Russian** (all player-facing text). Code/comments: English.

## Rendering

* Internal resolution **480×270** (`G.W`, `G.H`), tile size **16 px** (`G.TILE`).
  The canvas is CSS-scaled with `image-rendering: pixelated`. Everything drawn on the game canvas
  must look like pixel art: integer coordinates, `G.px.*` helpers, no anti-aliased strokes.
  Use `ctx.fillRect` / `G.px.line` / `G.px.disc` / pre-rendered offscreen canvases.
* Additive neon light: `G.addLight(x, y, radius, '#rrggbb', alpha)` with **world** coordinates
  queues a glow for this frame; the game draws all glows with `'lighter'` after the world.
  `G.drawGlow(ctx, x, y, r, color, alpha)` draws one immediately (screen coords).
* Camera: `cam.ox`, `cam.oy` = integer world→screen offset (already includes shake).
  Screen x = worldX − cam.ox. `cam.visible(x, y, w, h)` for culling.
* Bitmap font 3×5 (digits, Latin A–Z, `!?+-/%:.#$<>=*`): `G.font.draw(ctx, text, x, y, color, scale, align)`.
  Cyrillic text goes into the DOM UI, never on the canvas.
* Palette: `G.PAL` (neon cyan/magenta/violet/yellow, steel greys with blue bias).
  Stat colors: `G.PAL.brutality` (red), `G.PAL.tactics` (violet), `G.PAL.survival` (green).

Draw order each frame (game.js):
```
level.drawBackground(ctx, cam)   // parallax city + interior back walls + decor
level.drawTiles(ctx, cam)        // terrain
world.objects  (doors, chests, shops, pickups …)
world.enemies
world.player
world.projectiles
world.fx (particles, numbers)
level.drawForeground(ctx, cam)   // rain, fog, foreground silhouettes
ctx.globalCompositeOperation='lighter': G.lights queue + level.drawLights(ctx, cam) + fx additive
post: vignette, scanlines, glitch
```

## Core (`js/core.js`) — owned by lead

`G.clamp lerp approach sign dist overlap easeOut easeIn easeInOut angleLerp hashStr`,
`G.RNG(seed)` → `.next() .float(a,b) .int(a,b) .chance(p) .pick(arr) .sign() .weighted([[item,w]…]) .shuffle() .fork()`,
`G.rand` (cosmetic RNG), `G.PAL`, `G.px`, `G.font`, `G.on/off/emit` (event bus),
`G.input` (`down(a) pressed(a) released(a) label(a) setVirtual(a,on) device`),
`G.Camera`, `G.store.get/set` (localStorage, safe), `G.settings`, `G.params` (URL flags).

Input actions: `left right up down jump roll attack1 attack2 skill1 skill2 heal interact pause map confirm back`.

## Physics (`js/physics.js`) — owned by lead

`G.TileMap(w, h)` — base class of every level. Tile codes `G.T = {AIR:0, SOLID:1, PLATFORM:2, LADDER:3, SPIKES:4}`.
Methods: `tile(tx,ty)` (OOB = SOLID), `set`, `solid`, `platform`, `ladder`, `hazard`, `solidAt(px,py)`,
`floorAt(px,py)`, `lineClear(x0,y0,x1,y1)`, `raycast(...)→{x,y,hit}`, `groundBelow(x,y,max)`, `reveal(px,py,r)`,
`explored` (Uint8Array, minimap fog). Draw hooks to override:
`update(dt, world)`, `drawBackground(ctx,cam)`, `drawTiles(ctx,cam)`, `drawForeground(ctx,cam)`, `drawLights(ctx,cam)`.

`G.Actor(x,y,w,h)` — AABB entity: `vx vy facing onGround hp maxHp team dead dying flash invuln stun statuses`,
`physics(dt, level)`, `takeDamage(amount, info)`, `heal(n)`, `applyStatus(name,dur,power)`, `updateStatuses(dt)`, `tickTimers(dt)`.
Damage `info`: `{dir, kb, kbUp, stun, crit, color, status:{name,dur,power}, source, silent}`.
Statuses: `burn`, `virus` (stacking), `shock` (+25% dmg taken), `cryo` (slow).

## Player movement budget (for level design)

Hitbox 10×22 px. Run 135 px/s. Jump ≈ 3 tiles high; with double jump ≈ 5.5 tiles.
Horizontal gap it can cross with a run + double jump ≈ 7 tiles. Corridors need ≥ 2 tiles of headroom
(3 recommended). It can: drop through one-way platforms (down+jump), climb ladders (up/down), auto-grab
ledges, dodge-roll, ground-slam. Anything higher than 5 tiles needs a ladder or stepped platforms.

## Level (`js/level.js`, `js/background.js`) — owned by LEVEL agent

```
G.BIOMES = { scrap:{…}, slums:{…}, spire:{…}, core:{…} }   // name (RU), palette, music, enemy density, etc.
G.Level.generate({ seed, biome, depth, kind })  → instance extending G.TileMap
    kind: 'biome' (big procedural level) | 'transit' (small safe room between biomes) | 'boss' (arena)
level.biome          // biome id string
level.spawn          // {x, y}  player feet position (px)
level.enemySpawns    // [{x, y, air:bool}]  feet positions (px); enemy agent chooses types
level.objects        // [{kind, x, y, ...}]  feet positions (px)
                     // kinds: 'exit' (door to next level; boss arena: locked:true),
                     //        'chest','scroll','weapon','food','shop','collector','healstation','boss'
level.rooms          // [{x,y,w,h}] in tiles (optional, for minimap/debug)
level.update / drawBackground / drawTiles / drawForeground / drawLights  (see TileMap)
```

## Audio (`js/audio.js`) — owned by AUDIO agent

```
G.audio.init()                    // on first user gesture (game calls it; must be idempotent)
G.audio.play(name, {vol, pitch, pan})   // unknown names are ignored silently
G.audio.music(track)              // 'title','scrap','slums','spire','core','boss','transit', null = stop (crossfade)
G.audio.setVolumes({music, sfx})  // 0..1, persisted by game via G.settings
```

## World / game (`js/game.js`) — owned by lead

`G.world` — the active World:
`level player enemies[] projectiles[] objects[] fx cam time rng depth`,
`spawnEnemy(type,x,y,opts)`, `addProjectile(p)`, `addObject(o)`, `dropCurrency(x,y,cells,gold)`,
`enemiesInBox(box)`, `hitstop(t)`, `shake(mag,t)`.
Every entity in these arrays implements `update(dt, world)` and `draw(ctx, cam)`, optionally `drawLight(ctx,cam)`;
it is removed when `dead === true`.

Events on `G.emit`: `enemyHit`, `enemyKilled`, `playerHurt`, `playerDied`, `pickup`, `levelStart`,
`bossStart`, `bossDefeated`, `runEnd`.

## Testing

`node tools/shot.mjs "<url params>" out.png [frames]` — loads the game in headless Chromium,
runs N frames, saves a screenshot and prints console errors. URL flags:
`?play` (skip title) `&biome=slums` `&kind=biome|transit|boss` `&seed=123` `&god` `&weapon=<id>` `&fps`.

---

# Gameplay APIs (implemented — build on these)

## Player (`js/player.js`, lead) — `G.Player extends G.Actor`
* `p.stats = {brutality, tactics, survival}` (start 1 each), `p.statMul(stat|[stats])` → damage multiplier (1.14^(lvl-1)),
  `p.addStat(stat)` (power scroll: +HP, full heal), `p.recalc(fill)`, `p.maxHp`, `p.hpMul`, `p.baseHp`.
* `p.slots = {primary, secondary, skill1, skill2}` of item instances; `p.equip(inst, slot?) → old inst`; `p.slotFor(inst)`.
* `p.flasks / p.maxFlasks / p.flaskHeal`, `p.cells`, `p.gold`, `p.kills`, `p.mutations[]`.
* Modifiers read by the player: `p.dmgMul`, `p.cdMul` (skill cooldown multiplier), `p.speedMul`, `p.jumpMul`, `p.rollMul`, `p.airJumps`.
* `p.act` — current Action (see weapons). `p.act.block(amount, info, world) → remaining damage` is called on incoming damage (shields/parry).
* Mutations (`p.mutations` entries) may implement: `update(p,dt,world)`, `onIncoming(p,amount,info)→amount`,
  `onDealDamage(p,dealt,target,inst)`, `onRollEnd(p,world)`, `onKill(p,enemy)`, `hpMul`.
* States: `normal roll slam ladder ledge hurt dead`. `p.focus` = interactable object in range (HUD prompt).
* Recovery ("rally"): `p.recoverable` HP regained by dealing damage shortly after being hit (orange part of the HP bar).
* `p.onDealDamage(dealt, target, inst)` — call it whenever the player deals damage outside the helpers.

## Items (`js/weapons.js`, `js/items.js`)
```
G.defineItem({ id, name(RU), desc(RU), kind:'melee'|'ranged'|'shield'|'skill', stat:'brutality'|'tactics'|'survival' (or array),
               drop: weight (0 = never drops), blueprint:true (must be unlocked at the Collector), unlockCost,
               cooldown (skills, seconds), use(p, inst, world, button) → Action,
               drawHeld(ctx, x, y, angle, p, inst, scale), drawIcon(ctx, size), ... })
G.makeItem(id, tier, rng) → inst {id, def, tier, cd, affixes[], quality, uid};   G.itemName(inst)
G.itemDamage(p, inst, base, target) → scaled damage;   G.onItemHit(p, inst, target, dealt, world)  (affixes, recovery)
G.rollAffixes(inst, rng)   // optional hook, called by makeItem
Action classes: G.Action (base), G.MeleeAction (def.combo steps), G.RangedAction (def.fire, def.wind/rec, def.charge, def.auto),
                G.SkillAction (def.activate, def.castTime).  Action fields: done, cancelable, moveMul, airMoveMul, lockFacing,
                gravityMul, press(), update(dt, world), pose(P) (sets P.aim radians: 0 forward, -π/2 up), end(), draw(ctx,cam), block().
G.drawBlade(ctx,x,y,ang,{len,handle,blade,edge,guard,width}), G.drawGun(ctx,x,y,ang,{len,body,barrelColor,width,light}), G.itemIcon(def,size)
G.Projectile({x,y,vx,vy,r,team,dmg,info,life,pierce,grav,bounce,color,core,len,glow,homing,onHit,onWall,onExpire,drawFn})
G.hitBox(world, box, team, dmg|fn(target), info, hitSet) → hit targets (each gets t.lastDealt)
G.explode(world, x, y, {radius, dmg, team, info, color, noFx})
```
World objects (`G.WorldObject(x,y,w,h)` with feet position) created by `G.OBJECTS[kind](world, spec)`;
interactables set `interactable = true`, a `prompt` (RU string/getter) and `interact(p, world)`.
Existing: `G.Currency`, `G.ItemDrop(x,y,inst,{pop,price})`, `G.Scroll`, chest, food, shop, collector, healstation, `G.fallBody(o,dt,level)`.
`G.rollLoot(world, rng, kind?) → inst`, `G.startingLoadout(p, rng)`, `G.META_UPGRADES[] = {id,name,desc,cost:[..per level],apply(p,lvl)}`.
Persistent meta: `G.meta = {cells, unlocked:[itemIds], upgrades:{id:lvl}, runs, wins, bestTime, kills}`, `G.saveMeta()`.

## Enemies (`js/enemies.js`, `js/boss.js`)
```
G.defineEnemy(type, class extends G.Enemy, {biomes:[...], weight, minDepth, air:bool, boss:bool, noSpawn:bool})
G.pickEnemy(biome, depth, rng, spawn) → type | null        // used by World for level.enemySpawns
G.spawnEnemy(world, type, x, y, {elite, depth})            // x,y feet position
G.spawnBoss(world, x, y)                                     // boss.js: creates the boss, sets world.boss; emit 'bossStart'
                                                             // on death: G.emit('bossDefeated') (unlocks the exit)
G.Enemy: setup({w,h,hp,dmg,speed,sight,cells,gold,kbRes,stunRes,flying}), state/setState, stateT, aggro, notice(),
         canSee(range), facePlayer(), dxToPlayer(), distToPlayer(), ledgeAhead(dir), wallAhead(dir), patrol(dt), chase(dt,speed,stop),
         telegraph(dur) (yellow "!" wind-up), meleeBox(reach,h,yOff), hitPlayer(box,dmg,info), cooldown, elite, depth,
         ai(dt, world) (override), draw(ctx,cam) (override; call this.drawOverlay(ctx,cam) at the end), drawLight(ctx,cam),
         col(c) (white when hit-flashing), bloodColors, die(info), onEliteDeath(world)
```
HP/damage scale with `depth` (0..3) and `elite` automatically in `setup`.

## World (`js/game.js`, lead)
`G.world`: `level player enemies projectiles objects allies (player-side summons: turrets/drones, hit by enemy projectiles)
flashLights fx cam rng depth biome kind time boss bossDefeated glitch`,
`spawnObject(spec) addObject(o) addProjectile(p) spawnEnemy(type,x,y,opts) dropCurrency(x,y,cells,gold) enemiesInBox(box)
hitstop(t) shake(mag,t)`. `world.flashLights.push({x,y,r,color,t:0,life})` = short light flash.
`G.game`: `state ('title'|'play'|'dead'|'victory') paused stage runTime seed player world stats newRun() toTitle() nextStage() togglePause()`.
`G.RUN` = stage list `[{kind, biome, depth}]`.

## UI (`js/hud.js`, `js/ui.js`, `js/touch.js`) — contract used by game.js / items
```
G.hud.init() G.hud.show(bool) G.hud.update(world, dt) (every rendered frame — keep it cheap, diff DOM) G.hud.onLevel(world)
G.ui.init() G.ui.update(dt) G.ui.hideAll() G.ui.isModalOpen() (world freezes while true)
G.ui.showTitle(onStart) G.ui.showPause(onResume, onQuit) G.ui.hidePause()
G.ui.showDeath(summary, onRetry, onMenu) G.ui.showVictory(summary, onMenu) G.ui.banner(title, subtitle)
G.ui.chooseStat(options[], cb(stat)) G.ui.openCollector(world) G.ui.drawBackdrop(ctx, dt) (title screen canvas art, optional)
G.touch.init()   // on-screen controls → G.input.setVirtual(action, on)
```
