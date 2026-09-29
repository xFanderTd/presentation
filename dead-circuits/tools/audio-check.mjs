// Automated audio checks in headless Chromium (Playwright).
//   node tools/audio-check.mjs            -> realtime + offline checks, exit code 1 on failure
//   node tools/audio-check.mjs --json out.json   (also dump the full report)
// Realtime: init via a real click, every SFX plays without exceptions, stress/voice limiting,
// track switching/crossfades, live output level via an AnalyserNode.
// Offline: tools/audio-test.html's AT.runChecks() (OfflineAudioContext renders, numeric levels).
// Robustness: no-WebAudio page and a sandboxed srcdoc iframe must not throw.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';

const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;

const fails = [];
const fail = (m) => { fails.push(m); console.log('  FAIL ' + m); };
const ok = (m) => console.log('  ok   ' + m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const report = {};
try {
  // ------------------------------------------------------------ main bench page
  const page = await browser.newPage();
  const errors = [], warnings = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); else if (m.type() === 'warning') warnings.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(pathToFileURL(path.join(root, 'tools', 'audio-test.html')).href);

  console.log('realtime');
  const pre = await page.evaluate(() => ({ ready: G.audio.ready, play: G.audio.play('hit'), stats: G.audio.stats() }));
  if (pre.ready || pre.play !== null || pre.stats !== null) fail('API before init should be an inert no-op'); else ok('API is a no-op before init');
  await page.evaluate(() => { G.audio.music('slums'); G.audio.intensity(0.4); }); // queued before init
  await page.click('#init'); // real user gesture
  await page.waitForFunction(() => G.audio.ready, null, { timeout: 5000 }).catch(() => {});
  const st0 = await page.evaluate(() => ({ ready: G.audio.ready, sr: G.audio.context && G.audio.context.sampleRate, stats: G.audio.stats(), again: G.audio.init() }));
  if (!st0.ready) fail('AudioContext not running after click'); else ok(`AudioContext running @ ${st0.sr} Hz, init() idempotent -> ${st0.again}`);
  if (!st0.stats || st0.stats.track !== 'slums') fail('music queued before init did not start'); else ok('music queued before init started on init');

  // every SFX, one after another
  const names = await page.evaluate(() => G.audio.names);
  const res = await page.evaluate(async (names) => {
    const out = { thrown: [], nulls: [] };
    for (const n of names) {
      try { const h = G.audio.play(n); if (!h) out.nulls.push(n); } catch (e) { out.thrown.push(n + ': ' + e.message); }
      await new Promise((r) => setTimeout(r, 45));
    }
    try { G.audio.play('doesNotExist'); G.audio.play(); G.audio.play(null, null); G.audio.play('hit', { vol: NaN, pitch: 'x', pan: 9 }); } catch (e) { out.thrown.push('bad args: ' + e.message); }
    return out;
  }, names);
  if (res.thrown.length) fail('SFX threw: ' + res.thrown.join('; ')); else ok(`${names.length} SFX played without exceptions`);
  if (res.nulls.length) fail('SFX refused to start: ' + res.nulls.join(', '));
  report.sfxNames = names;

  // stress / voice limiting
  await sleep(2500);
  const stress = await page.evaluate(() => {
    let hits = 0;
    for (let i = 0; i < 20; i++) if (G.audio.play('hit')) hits++;
    let mixed = 0;
    for (let i = 0; i < 80; i++) if (G.audio.play(G.audio.names[i % G.audio.names.length], { pitch: 1 + (i % 5) * 0.01 })) mixed++;
    return { hits, mixed, stats: G.audio.stats() };
  });
  if (stress.hits !== 1) fail(`rate limit: ${stress.hits} of 20 same-frame hits started`); else ok('rate limit: 1 of 20 same-frame hits started');
  if (stress.stats.voices > 24 || stress.stats.peakVoices > 24) fail(`voice limit exceeded: ${stress.stats.voices}/${stress.stats.peakVoices}`);
  else ok(`voice limit: ${stress.stats.voices} alive after an 80-play burst (peak ${stress.stats.peakVoices}, max 24)`);
  await sleep(4500);
  const drained = await page.evaluate(() => G.audio.stats());
  if (drained.voiceNodes > 3) fail(`voices not released: ${drained.voiceNodes}`); else ok(`voices released after burst (${drained.voiceNodes} left)`);

  // track switching
  const tracks = await page.evaluate(() => G.audio.tracks);
  for (const t of tracks) {
    await page.evaluate((t) => { G.audio.music(t); G.audio.music(t); }, t);
    await sleep(900);
    const s = await page.evaluate(() => G.audio.stats());
    if (s.track !== t || !s.tracks.includes(t) || s.tracks.length > 3) fail(`switch to ${t}: ${JSON.stringify(s.tracks)}`);
  }
  await sleep(2200);
  let s1 = await page.evaluate(() => G.audio.stats());
  if (s1.tracks.length !== 1 || s1.tracks[0] !== tracks[tracks.length - 1]) fail('after crossfades: ' + JSON.stringify(s1.tracks)); else ok(`switched through ${tracks.length} tracks, crossfades cleaned up -> [${s1.tracks}]`);
  await page.evaluate(() => { for (const t of ['scrap', 'core', 'scrap', 'boss', 'spire', 'title', 'nope']) G.audio.music(t); });
  await sleep(2200);
  s1 = await page.evaluate(() => G.audio.stats());
  if (s1.tracks.length !== 1 || s1.track !== 'title') fail('rapid switching: ' + JSON.stringify(s1)); else ok('rapid switching (incl. unknown name) settles on one track');
  await page.evaluate(() => G.audio.music(null));
  await sleep(2000);
  s1 = await page.evaluate(() => G.audio.stats());
  if (s1.tracks.length !== 0) fail('music(null) left tracks: ' + JSON.stringify(s1.tracks)); else ok('music(null) stops and disposes');

  // live output levels through an AnalyserNode on the master output
  const live = await page.evaluate(async () => {
    const eng = G.audio._engine(), an = eng.ac.createAnalyser();
    an.fftSize = 4096; eng.lim.connect(an);
    const d = new Float32Array(an.fftSize);
    const measure = async (ms) => {
      let pk = 0, sum = 0, n = 0;
      const end = performance.now() + ms;
      while (performance.now() < end) {
        an.getFloatTimeDomainData(d);
        for (const v of d) { pk = Math.max(pk, Math.abs(v)); sum += v * v; n++; }
        await new Promise((r) => setTimeout(r, 40));
      }
      return { peak: pk, rmsDb: 20 * Math.log10(Math.sqrt(sum / n) || 1e-9) };
    };
    G.audio.setVolumes({ music: 0.6, sfx: 0.8 });
    G.audio.intensity(0.8);
    G.audio.music('core');
    await new Promise((r) => setTimeout(r, 2000));
    const music = await measure(2500);
    const iv = setInterval(() => { G.audio.play('hit'); G.audio.play('slash' + (1 + Math.floor(Math.random() * 3))); }, 120);
    const combat = await measure(2000);
    clearInterval(iv);
    G.audio.setVolumes({ music: 0, sfx: 0 });
    await new Promise((r) => setTimeout(r, 400));
    const muted = await measure(600);
    G.audio.setVolumes({ music: 0.6, sfx: 0.8 });
    G.audio.duck(0.7, 1);
    G.audio.music(null);
    return { music, combat, muted, stats: G.audio.stats() };
  });
  report.live = live;
  const fmt = (x) => `peak ${x.peak.toFixed(3)} rms ${x.rmsDb.toFixed(1)} dB`;
  if (!(live.music.rmsDb > -45)) fail('live music silent: ' + fmt(live.music)); else ok('live music: ' + fmt(live.music));
  if (!(live.combat.peak < 1)) fail('live combat clipping: ' + fmt(live.combat)); else ok('live music+combat: ' + fmt(live.combat));
  if (!(live.muted.rmsDb < -70)) fail('volume 0 not silent: ' + fmt(live.muted)); else ok('setVolumes(0,0) silences output');
  if (live.stats.errors) fail('engine errors: ' + live.stats.errors);

  // ------------------------------------------------------------ offline renders
  console.log('offline renders');
  const t0 = Date.now();
  const off = await page.evaluate(() => AT.runChecks((l) => console.log('[check] ' + l)));
  report.offline = off;
  const trackRows = Object.entries(off.tracks).map(([k, v]) => `    ${k.padEnd(14)} ${String(v.lufs).padStart(6)} LUFS  rms ${String(v.rmsDb).padStart(6)} dB  peak ${String(v.peakDb).padStart(6)} dB  min400 ${String(v.min400Db).padStart(6)}`);
  console.log(trackRows.join('\n'));
  const sfxRows = Object.entries(off.sfx).map(([k, v]) => `${k}:${v.peakDb}/${v.loud}`);
  console.log("    sfx peak dBFS / loudness LUFS(100ms): " + sfxRows.join("  "));
  console.log('    balance vs music (dB): ' + JSON.stringify(off.balance));
  console.log('    barrage: ' + JSON.stringify(off.misc.barrageRaw) + ' limited ' + JSON.stringify(off.misc.barrageLimited));
  console.log('    intensity: ' + JSON.stringify(off.misc.intensity) + '  duck: ' + JSON.stringify(off.misc.duck));
  for (const f of off.fails) fail('offline: ' + f);
  if (!off.fails.length) ok(`all offline checks passed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);

  const realErrors = errors.filter((e) => !/favicon/i.test(e));
  if (realErrors.length) fail('console errors: ' + realErrors.join(' | ')); else ok('no console errors');
  const audioWarn = warnings.filter((w) => /audio|AudioParam|Biquad|\[audio\]/i.test(w));
  if (audioWarn.length) fail('audio warnings: ' + [...new Set(audioWarn)].slice(0, 5).join(' | ')); else ok('no Web Audio warnings');
  await page.close();

  // ------------------------------------------------------------ no Web Audio at all
  console.log('robustness');
  const p2 = await browser.newPage();
  const e2 = [];
  p2.on('pageerror', (e) => e2.push(e.message));
  p2.on('console', (m) => { if (m.type() === 'error') e2.push(m.text()); });
  await p2.addInitScript(() => { delete window.AudioContext; delete window.webkitAudioContext; delete window.OfflineAudioContext; delete window.webkitOfflineAudioContext; });
  await p2.goto(pathToFileURL(path.join(root, 'tools', 'audio-test.html')).href);
  const na = await p2.evaluate(() => {
    const A = G.audio;
    const r = [A.init(), A.init(), A.play('hit'), A.music('scrap'), A.setVolumes({ music: 1 }), A.duck(1, 1), A.intensity(1), A.ready, A.stats()];
    return r.map((x) => (x === undefined ? 'undef' : x));
  });
  await p2.click('#sfx button');
  await sleep(200);
  if (e2.length) fail('no-WebAudio page errors: ' + e2.join(' | ')); else ok('without Web Audio every call is a silent no-op: ' + JSON.stringify(na));
  await p2.close();

  // ------------------------------------------------------------ sandboxed iframe (opaque origin, no storage)
  const p3 = await browser.newPage();
  const e3 = [];
  p3.on('pageerror', (e) => e3.push(e.message));
  p3.on('console', (m) => { if (m.type() === 'error') e3.push(m.text()); });
  const inline = (f) => fs.readFileSync(path.join(root, f), 'utf8').replace(/<\/script/gi, '<\\/script');
  const doc = `<!doctype html><meta charset="utf-8"><body><script>${inline('js/core.js')}<\/script><script>${inline('js/audio.js')}<\/script><script>
    let log = [];
    try {
      G.audio.music('spire');
      log.push('init:' + G.audio.init());
      for (const n of G.audio.names) G.audio.play(n, { vol: 0.2 });
      G.audio.intensity(1);
    } catch (e) { log.push('THROW ' + e.message); }
    setTimeout(() => parent.postMessage({ log, ready: G.audio.ready, stats: G.audio.stats() }, '*'), 1200);
  <\/script>`;
  await p3.setContent('<iframe sandbox="allow-scripts" id="f"></iframe>');
  const msg = p3.evaluate(() => new Promise((r) => window.addEventListener('message', (e) => r(e.data), { once: true })));
  await p3.evaluate((d) => { document.getElementById('f').srcdoc = d; }, doc);
  const sb = await Promise.race([msg, sleep(8000).then(() => null)]);
  if (!sb) fail('sandboxed iframe: no response');
  else if (sb.log.some((l) => l.startsWith('THROW')) || e3.length) fail('sandboxed iframe: ' + JSON.stringify(sb.log) + ' ' + e3.join(' | '));
  else ok(`sandboxed iframe: ready=${sb.ready}, track=${sb.stats && sb.stats.tracks}, errors=${sb.stats && sb.stats.errors}`);
  await p3.close();
} catch (err) {
  fail('harness: ' + (err && err.stack || err));
} finally {
  await browser.close();
}
report.fails = fails;
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 1));
console.log(fails.length ? `\n${fails.length} FAILURE(S)` : '\nALL AUDIO CHECKS PASSED');
process.exit(fails.length ? 1 : 0);
