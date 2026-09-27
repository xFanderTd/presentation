// Рендер кадров через headless Chromium (Playwright).
//   node render/render.cjs stills 5.2 12 30      → build/stills/*.jpg (проверка отдельных кадров)
//   node render/render.cjs frames [workers]      → build/frames/f_00000.jpg … (все кадры, параллельно)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const BUILD = path.join(ROOT, 'build');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = path.join(SRC, decodeURIComponent(req.url.split('?')[0]));
      if (!p.startsWith(SRC) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

async function openPage(browser, port) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('pageerror:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error('console:', m.text()); });
  await page.goto(`http://127.0.0.1:${port}/index.html?render`);
  await page.evaluate(() => window.ready);
  return page;
}

async function grab(page, t, q = 0.94) {
  const data = await page.evaluate(([t, q]) => { window.renderFrame(t); return document.getElementById('stage').toDataURL('image/jpeg', q); }, [t, q]);
  return Buffer.from(data.split(',')[1], 'base64');
}

(async () => {
  const [mode = 'stills', ...rest] = process.argv.slice(2);
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch({ args: ['--disable-gpu-vsync', '--disable-lcd-text', '--font-render-hinting=none'] });
  try {
    if (mode === 'stills') {
      const dir = path.join(BUILD, 'stills'); fs.mkdirSync(dir, { recursive: true });
      const page = await openPage(browser, port);
      for (const s of rest) {
        const t = parseFloat(s); const t0 = Date.now();
        const buf = await grab(page, t, 0.9);
        const f = path.join(dir, `t_${t.toFixed(2).padStart(7, '0')}.jpg`);
        fs.writeFileSync(f, buf); console.log(f, `${Date.now() - t0}ms`);
      }
    } else if (mode === 'frames') {
      const workers = parseInt(rest[0] || '4', 10);
      const fps = parseInt(rest[1] || '60', 10);
      const only = rest[2] ? rest[2].split('-').map(Number) : null; // диапазон секунд, напр. 40-70
      const dir = path.join(BUILD, 'frames'); fs.mkdirSync(dir, { recursive: true });
      const dur = await (async () => { const p = await openPage(browser, port); const d = await p.evaluate(() => window.TIMELINE.duration); await p.close(); return d; })();
      const total = Math.round(dur * fps);
      const from = only ? Math.round(only[0] * fps) : 0, to = only ? Math.round(only[1] * fps) : total;
      let next = from, done = 0; const t0 = Date.now();
      await Promise.all(Array.from({ length: workers }, async () => {
        const page = await openPage(browser, port);
        while (next < to) {
          const i = next++;
          const f = path.join(dir, `f_${String(i).padStart(5, '0')}.jpg`);
          if (fs.existsSync(f)) { done++; continue; }
          fs.writeFileSync(f, await grab(page, i / fps));
          if (++done % 300 === 0) { const el = (Date.now() - t0) / 1000; console.log(`${done}/${to - from} кадров, ${(done / el).toFixed(1)} к/с, осталось ~${Math.round(((to - from - done) / done) * el)} с`); }
        }
        await page.close();
      }));
      console.log(`готово: ${done} кадров за ${((Date.now() - t0) / 1000).toFixed(0)} с`);
    }
  } finally {
    await browser.close(); srv.close();
  }
})();
