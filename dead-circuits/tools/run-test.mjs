// End-to-end smoke test: plays through every stage of a run by fighting a bit,
// then teleporting to the exit door; kills the boss via eval. Reports errors & timings.
//   node tools/run-test.mjs [seed]
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const seed = process.argv[2] || '4242';
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND|ERR_CERT|ERR_NAME|net::/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + (e.stack || e.message).split('\n').slice(0, 4).join(' | ')));
await page.goto(`file://${root}/index.html?manual&play&god&seed=${seed}`);
await page.waitForFunction(() => window.G && G.advance && G.world, null, { timeout: 15000 });
const t0 = Date.now();
for (let guard = 0; guard < 12; guard++) {
  const st = await page.evaluate(() => ({ state: G.game.state, stage: G.game.stage, kind: G.world && G.world.kind, biome: G.world && G.world.biome }));
  if (st.state !== 'play') { console.log('end state', st); break; }
  const info = await page.evaluate(() => {
    const w = G.world, p = w.player, L = w.level;
    const t = performance.now();
    // fight: mash attacks while walking right for 6 s
    for (let i = 0; i < 360; i++) {
      G.input.setVirtual('right', i % 120 < 90); G.input.setVirtual('attack1', i % 8 < 4);
      if (i % 45 === 0) G.input.setVirtual('jump', true); if (i % 45 === 5) G.input.setVirtual('jump', false);
      G.advance(1);
    }
    G.input.clearAll(); G.advance(1);
    const ms = (performance.now() - t) / 361;
    const exit = w.objects.find((o) => o.constructor && o.prompt !== undefined && /Выйти|Заблок/.test(o.prompt));
    const r = { stage: G.game.stage, kind: w.kind, biome: w.biome, size: [L.w, L.h], enemies: w.enemies.length, objects: w.objects.length, kills: G.game.stats.kills, hp: Math.round(p.hp), msPerFrame: +ms.toFixed(2) };
    if (w.kind === 'boss') {
      const b = w.boss || w.enemies.find((e) => e.isBoss);
      r.boss = !!b;
      if (b) {
        for (let k = 0; k < 40 && !b.dying && !b.dead; k++) { b.invuln = 0; b.takeDamage(Math.ceil(b.maxHp / 12), { dir: 1 }); G.advance(30); }
        for (let k = 0; k < 900 && !w.bossDefeated; k++) G.advance(1);
        r.bossDefeated = w.bossDefeated;
      }
    }
    return r;
  });
  console.log(JSON.stringify(info));
  // go to exit and use it
  await page.evaluate(() => {
    const w = G.world, p = w.player;
    const exit = w.objects.find((o) => o.interactable !== undefined && /Выйти/.test(o.prompt || ''));
    if (!exit) { console.error('no usable exit on stage ' + G.game.stage); return; }
    p.x = exit.cx - p.w / 2; p.y = exit.bottom - p.h - 1; p.vx = p.vy = 0; p.state = 'normal'; p.act = null;
    G.advance(3);
    G.input.setVirtual('interact', true); G.advance(1); G.input.setVirtual('interact', false);
    G.advance(60);
  });
}
const fin = await page.evaluate(() => ({ state: G.game.state, stage: G.game.stage }));
console.log('final', JSON.stringify(fin), 'wall', ((Date.now() - t0) / 1000).toFixed(1) + 's');
console.log(errors.length ? 'ERRORS:\n' + [...new Set(errors)].slice(0, 20).join('\n') : 'no errors');
await browser.close();
