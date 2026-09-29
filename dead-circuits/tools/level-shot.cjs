#!/usr/bin/env node
// Level tooling via headless Chromium (Playwright).
//   node tools/level-shot.cjs test [n]                       -> batch-validate n seeds per biome
//   node tools/level-shot.cjs shot <outdir> "name|query" ... -> screenshots of tools/level-viewer.html
//        query example: "biome=slums&seed=5&x=40&y=30&t=2"   (add &ov for the overview canvas)
'use strict';
const path = require('path');
let pw;
try { pw = require('playwright'); } catch (e) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const root = path.resolve(__dirname, '..');
const url = (file, q) => 'file://' + path.join(root, 'tools', file) + (q ? '?' + q : '');

(async () => {
  const [cmd, ...args] = process.argv.slice(2);
  const browser = await pw.chromium.launch({ args: ['--allow-file-access-from-files'] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  if (cmd === 'test') {
    const n = args[0] || 50;
    await page.goto(url('level-test.html', 'n=' + n + (args[1] ? '&biomes=' + args[1] : '')));
    await page.waitForFunction('window.done === true', null, { timeout: 600000 });
    const res = await page.evaluate('window.results');
    console.log(JSON.stringify(res.summary, null, 1));
    console.log('FAILS: ' + res.fails.length);
    for (const f of res.fails.slice(0, 40)) console.log(JSON.stringify(f));
  } else if (cmd === 'shot') {
    const outdir = args[0];
    for (const spec of args.slice(1)) {
      const [name, q] = spec.split('|');
      await page.goto(url('level-viewer.html', q + (q.includes('sheet') ? '' : '&still')));
      await page.waitForFunction('window.viewer && window.viewer.ready', null, { timeout: 60000 });
      const info = await page.evaluate('({info: window.viewer.info, ms: window.viewer.lastMs, sheet: window.viewer.sheetInfo})');
      const sel = q.includes('sheet') ? '#sheet' : q.includes('ov') ? '#ov' : '#c';
      await page.locator(sel).screenshot({ path: path.join(outdir, name + '.png') });
      console.log(name, JSON.stringify(info));
    }
  }
  if (errors.length) console.log('CONSOLE:\n' + errors.slice(0, 20).join('\n'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
