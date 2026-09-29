// Headless test driver.
//   node tools/shot.mjs "<url params>" out.png [script]
// script: comma-separated steps, e.g. "wait:30,hold:right:40,press:jump,wait:10,press:attack1,wait:20"
//   wait:N          advance N frames
//   hold:ACT:N      hold action for N frames
//   press:ACT       press+release action (1 frame)
//   down:ACT / up:ACT   hold / release action
//   shot:NAME       save an extra screenshot NAME.png next to out.png
//   eval:JS         run JS in page
// Prints console errors/warnings and a JSON summary of player state.
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const [params = 'play', out = 'shot.png', script = 'wait:60'] = process.argv.slice(2);
const url = 'file://' + root + '/index.html?manual&' + params.replace(/^\?/, '');
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + (e.stack || e.message)));
await page.goto(url);
await page.waitForFunction(() => window.G && G.game && G.advance, null, { timeout: 10000 });
await page.waitForTimeout(300);
const outDir = path.dirname(path.resolve(out));
for (const step of script.split(script.includes('|') ? '|' : ',').map((s) => s.trim()).filter(Boolean)) {
  const [cmd, a, b] = step.split(':');
  if (cmd === 'wait') await page.evaluate((n) => G.advance(n), +a);
  else if (cmd === 'hold') await page.evaluate(([act, n]) => { G.input.setVirtual(act, true); G.advance(n); G.input.setVirtual(act, false); G.advance(1); }, [a, +b]);
  else if (cmd === 'press') await page.evaluate((act) => { G.input.setVirtual(act, true); G.advance(1); G.input.setVirtual(act, false); G.advance(1); }, a);
  else if (cmd === 'down') await page.evaluate((act) => G.input.setVirtual(act, true), a);
  else if (cmd === 'up') await page.evaluate((act) => G.input.setVirtual(act, false), a);
  else if (cmd === 'shot') await page.screenshot({ path: path.join(outDir, a + '.png') });
  else if (cmd === 'eval') await page.evaluate(step.slice(5));
  else if (cmd === 'crop') {
    // crop:NAME:x:y:w:h  (game pixels; x,y may be 'p' = centered on player) scaled x6
    const [, name, cx, cy, cw, ch] = step.split(':');
    const data = await page.evaluate(([cx, cy, cw, ch]) => {
      const src = document.getElementById('game');
      let x = cx, y = cy;
      const p = G.world && G.world.player;
      if (cx === 'p') x = Math.round(p.cx - G.world.cam.ox - cw / 2);
      if (cy === 'p') y = Math.round(p.cy - G.world.cam.oy - ch / 2);
      const c = document.createElement('canvas'); c.width = cw * 6; c.height = ch * 6;
      const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
      g.drawImage(src, +x, +y, cw, ch, 0, 0, cw * 6, ch * 6);
      return c.toDataURL('image/png');
    }, [cx, cy, +cw, +ch]);
    (await import('fs')).writeFileSync(path.join(outDir, name + '.png'), Buffer.from(data.split(',')[1], 'base64'));
  }
}
await page.screenshot({ path: out });
const info = await page.evaluate(() => {
  const w = G.world, p = w && w.player;
  return p ? { state: G.game.state, stage: G.game.stage, px: Math.round(p.x), py: Math.round(p.y), hp: p.hp, pstate: p.state, enemies: w.enemies.length, objects: w.objects.length, level: [w.level.w, w.level.h] } : { state: G.game.state };
});
console.log(JSON.stringify(info));
if (errors.length) console.log(errors.slice(0, 30).join('\n'));
await browser.close();
