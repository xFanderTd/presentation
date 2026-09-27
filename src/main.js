// Движок: фон, сцены, переходы-разрезы, пост-обработка (bloom, аберрации, тряска, зерно), HUD.
const TL = window.TIMELINE;
const DUR = TL.duration;
const stage = document.getElementById('stage');
const out = stage.getContext('2d');

function mk(w = W, h = H) { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; return [cv, cv.getContext('2d')]; }
const [Lc, L] = mk();          // итоговый слой кадра
const [Sc, S] = mk();          // контент текущей сцены
const [Pc, P] = mk();          // контент предыдущей сцены (для перехода)
const [Bc, B] = mk(480, 270);  // bloom
const [B2c, B2] = mk(240, 135);
const [Tc, Tx] = mk();         // временный (хроматическая аберрация)
const SW = 192, SH = 108;
const [Mc, M] = mk(SW, SH);    // дым
const smokeImg = M.createImageData(SW, SH);

// Виньетка
const [Vc, V] = mk();
const [V2c, V2] = mk();
(() => {
  // сильная виньетка — только для фона, лёгкая — поверх всего кадра
  let g = V.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 1.0); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.8)'); V.fillStyle = g; V.fillRect(0, 0, W, H);
  g = V2.createRadialGradient(W / 2, H / 2, H * 0.55, W / 2, H / 2, H * 1.1); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.35)'); V2.fillStyle = g; V2.fillRect(0, 0, W, H);
})();

// Зерно плёнки
const GRAIN = Array.from({ length: 4 }, (_, k) => {
  const [cv, c] = mk(256, 256); const img = c.createImageData(256, 256); const r = rng(100 + k);
  for (let i = 0; i < img.data.length; i += 4) { const v = (r() * 255) | 0; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
  c.putImageData(img, 0, 0); return cv;
});

// Спрайты свечения (кэш по цвету)
const SPR = {};
function sprite(color) {
  if (SPR[color]) return SPR[color];
  const [cv, c] = mk(64, 64); const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, rgba('#ffffff', 1)); g.addColorStop(0.15, rgba(color, 0.9)); g.addColorStop(0.45, rgba(color, 0.25)); g.addColorStop(1, rgba(color, 0));
  c.fillStyle = g; c.fillRect(0, 0, 64, 64); return (SPR[color] = cv);
}
function spark(c, x, y, r, color, a) { if (a <= 0.003) return; const g = c.globalAlpha; c.globalAlpha = clamp(a) * g; c.drawImage(sprite(color), x - r, y - r, r * 2, r * 2); c.globalAlpha = g; }

// Палитры сцен для фона
const PAL = {
  intro: { smoke: [125, 12, 28], amt: 0.85, ember: '#ff4a5a' },
  world: { smoke: [70, 34, 140], amt: 0.8, ember: '#a58bff' },
  hierarchy: { smoke: [110, 72, 22], amt: 0.62, ember: '#ffcf7a' },
  grades: { smoke: [125, 18, 26], amt: 0.8, ember: '#ff5a4a' },
  pillars: { smoke: [16, 64, 125], amt: 0.72, ember: '#7fd0ff' },
  ranking: { smoke: [120, 28, 16], amt: 0.78, ember: '#ff7a4a' },
  potential: { smoke: [10, 92, 82], amt: 0.7, ember: '#6fffd9' },
  outro: { smoke: [115, 10, 26], amt: 0.9, ember: '#ff4a5a' },
};

const sceneAt = (t) => TL.scenes.find((s) => t >= s.start && t < s.end) || TL.scenes[TL.scenes.length - 1];

function paletteAt(t) {
  const sc = sceneAt(t); const cur = PAL[sc.id];
  if (sc.idx === 0) return cur;
  const prev = PAL[TL.scenes[sc.idx - 1].id];
  const k = Ease.inOutCubic(prog(t, sc.start - 0.2, 1.4));
  return { smoke: mix(prev.smoke, cur.smoke, k), amt: lerp(prev.amt, cur.amt, k), ember: k < 0.5 ? prev.ember : cur.ember };
}

// Импульсы: тряска/вспышка/аберрация
const IMP = TL.cues.filter((c) => ['impact', 'hit', 'card', 'slash'].includes(c.type)).map((c) => ({
  t: c.type === 'slash' ? c.t + 0.32 : c.t,
  p: c.type === 'impact' ? c.power : c.type === 'hit' ? c.power * 0.55 : c.type === 'card' ? 0.3 : 0.28,
  k: c.type === 'impact' ? 3.2 : 7,
  flash: c.type === 'impact' ? c.power : c.type === 'slash' ? 0.22 : 0,
}));
function impactAt(t) { let m = 0, f = 0; for (const c of IMP) { const d = t - c.t; if (d >= 0 && d < 3) { m = Math.max(m, c.p * Math.exp(-d * c.k)); f = Math.max(f, c.flash * Math.exp(-d * 14)); } } return { m, f }; }

// ---------- фон ----------
function drawSmoke(c, t, pal) {
  const d = smokeImg.data; const col = pal.smoke; const amt = pal.amt;
  let i = 0;
  for (let y = 0; y < SH; y++) {
    for (let x = 0; x < SW; x++) {
      const nx = x * 0.028, ny = y * 0.028;
      const q = fbm3(nx + t * 0.015, ny - t * 0.01, t * 0.02, 2);
      const n = fbm3(nx * 1.25 + q * 1.8, ny * 1.25 - t * 0.03, t * 0.04 + 3.1, 3);
      const edge = 0.55 + 0.45 * Math.min(1, Math.hypot((x - SW / 2) / (SW / 2), (y - SH / 2) / (SH / 2)));
      const v = smooth(0.4, 0.82, n) * amt * edge;
      d[i] = col[0] * v; d[i + 1] = col[1] * v; d[i + 2] = col[2] * v; d[i + 3] = 255; i += 4;
    }
  }
  M.putImageData(smokeImg, 0, 0);
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  c.drawImage(Mc, 0, 0, W, H);
}

function drawEmbers(c, t, color, k = 1) {
  c.save(); c.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 110; i++) {
    const r1 = hash(i * 3.1), r2 = hash(i * 7.7 + 1), r3 = hash(i * 1.3 + 9);
    const speed = 14 + r2 * 48, span = H + 160;
    const y = H + 80 - ((t * speed + r1 * span * 9) % span);
    const x = r3 * W + Math.sin(t * (0.25 + r2 * 0.5) + i) * 46 + noise1(t * 0.2 + i, 3) * 30;
    const sz = 1.2 + Math.pow(r2, 3) * 4.5;
    const fl = 0.55 + 0.45 * Math.sin(t * (1.5 + r1 * 4) + i * 2.3);
    spark(c, x, y, sz * 5, color, (0.12 + 0.35 * fl) * k * (0.4 + r1 * 0.6));
  }
  c.restore();
}

// ---------- переход-разрез ----------
const ANG = -0.36;
const TX = Math.cos(ANG), TY = Math.sin(ANG), NX = -Math.sin(ANG), NY = Math.cos(ANG);
function halfPlane(c, side) {
  const cx = W / 2, cy = H / 2, R = 3200;
  c.beginPath();
  c.moveTo(cx - TX * R, cy - TY * R); c.lineTo(cx + TX * R, cy + TY * R);
  c.lineTo(cx + TX * R + NX * side * R, cy + TY * R + NY * side * R); c.lineTo(cx - TX * R + NX * side * R, cy - TY * R + NY * side * R);
  c.closePath();
}
function drawSliced(dst, src, d, a) {
  for (const side of [1, -1]) {
    dst.save();
    dst.translate(NX * side * d * 0.9 + TX * side * d * 0.55, NY * side * d * 0.9 + TY * side * d * 0.55);
    halfPlane(dst, side); dst.clip();
    dst.globalAlpha = a; dst.drawImage(src, 0, 0);
    dst.restore();
  }
}
function drawStreak(c, t, b) {
  const p = Ease.inOutExpo(prog(t, b - 0.3, 0.26));
  const q = Ease.inCubic(prog(t, b - 0.1, 0.45));
  if (p <= 0 || q >= 1) return;
  const cx = W / 2, cy = H / 2, R = 1250;
  const ax = cx - TX * R, ay = cy - TY * R, bx = cx + TX * R, by = cy + TY * R;
  const x1 = lerp(ax, bx, q), y1 = lerp(ay, by, q), x2 = lerp(ax, bx, p), y2 = lerp(ay, by, p);
  const fade = 1 - prog(t, b + 0.05, 0.3);
  c.save(); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
  c.strokeStyle = rgba('#ff2e4d', 0.5 * fade); c.lineWidth = 26; c.shadowBlur = 50; c.shadowColor = '#ff2e4d';
  c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
  c.shadowBlur = 12; c.shadowColor = '#fff'; c.strokeStyle = rgba('#ffffff', fade); c.lineWidth = 4;
  c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
  // искры на кончике
  for (let i = 0; i < 14; i++) {
    const r = hash(i * 9.1 + b), off = (hash(i * 3.3 + b) - 0.5) * 120;
    spark(c, x2 - TX * r * 180 + NX * off * (1 - p * 0.5), y2 - TY * r * 180 + NY * off * (1 - p * 0.5), 10 + r * 16, '#ff5a6a', 0.6 * fade);
  }
  c.restore();
}

// ---------- HUD ----------
function drawHUD(c, t) {
  const sc = sceneAt(t); const u = t - sc.start;
  if (sc.id !== 'intro' && sc.id !== 'outro') {
    const a = env(u, 2.35, 0.3) * (1 - prog(t, sc.end - 0.34, 0.25));
    if (a > 0) {
      c.save(); c.globalAlpha = a;
      c.fillStyle = sc.accent; c.fillRect(120, 60, 48, 48);
      font(c, F.brush, 34); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#fff'; c.fillText(sc.num, 144, 86);
      c.textAlign = 'left'; c.textBaseline = 'alphabetic';
      font(c, F.mono, 15, 600); c.letterSpacing = '3px'; c.fillStyle = rgba(sc.accent, 1); c.fillText(`ГЛАВА 0${sc.idx} / 06`, 186, 80);
      font(c, F.mono, 19, 700); c.fillStyle = '#eceaf2'; c.fillText(sc.title, 186, 104);
      c.restore();
    }
  }
  const ha = env(t, 7.5, 1.0) * (1 - prog(t, 150, 0.6));
  if (ha > 0) {
    c.save(); c.globalAlpha = ha * 0.75;
    font(c, F.mono, 14, 500); c.letterSpacing = '4px'; c.textAlign = 'right'; c.fillStyle = '#8e8a9c';
    c.fillText('JUJUTSU KAISEN · АНАЛИЗ', 1800, 80);
    font(c, F.mincho, 16, 800); c.letterSpacing = '6px'; c.fillStyle = '#ff2e4d'; c.fillText('呪術廻戦', 1800, 104);
    // прогресс
    c.letterSpacing = '0px';
    const y = 1034; c.fillStyle = 'rgba(255,255,255,0.08)'; c.fillRect(120, y, 1680, 2);
    const acc = sceneAt(t).accent;
    c.fillStyle = acc; c.fillRect(120, y, 1680 * (t / DUR), 2);
    TL.scenes.slice(1, 7).forEach((s) => { const x = 120 + 1680 * (s.start / DUR); c.fillStyle = t >= s.start ? acc : 'rgba(255,255,255,0.3)'; c.fillRect(x - 1, y - 5, 2, 12); });
    c.restore();
  }
}

// ---------- кадр ----------
function renderScene(ctx, sc, t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const u = t - sc.start, d = sc.end - sc.start;
  const z = 1 + 0.025 * Ease.inOutCubic(clamp(u / d)); // медленный «наезд камеры»
  ctx.setTransform(z, 0, 0, z, W / 2 * (1 - z), H / 2 * (1 - z));
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.shadowBlur = 0; ctx.filter = 'none';
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.letterSpacing = '0px';
  SCENES[sc.id](ctx, t, sc);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function renderFrame(t) {
  const sc = sceneAt(t);
  const pal = paletteAt(t);
  // фон
  L.setTransform(1, 0, 0, 1, 0, 0); L.globalAlpha = 1; L.globalCompositeOperation = 'source-over'; L.filter = 'none';
  L.fillStyle = '#050407'; L.fillRect(0, 0, W, H);
  drawSmoke(L, t, pal);
  drawEmbers(L, t, pal.ember, sc.id === 'intro' ? env(t, 5, 1) : 1);
  L.drawImage(Vc, 0, 0);

  // контент
  renderScene(S, sc, t);
  const prev = sc.idx > 0 ? TL.scenes[sc.idx - 1] : null;
  const since = t - sc.start;
  if (prev && since < 0.7) {
    L.drawImage(Sc, 0, 0);
    renderScene(P, prev, t);
    const d = Ease.outExpo(prog(since, 0, 0.7)) * 150;
    drawSliced(L, Pc, d, 1 - Ease.inQuad(prog(since, 0.05, 0.5)));
  } else L.drawImage(Sc, 0, 0);
  const next = TL.scenes[sc.idx + 1];
  if (next) drawStreak(L, t, next.start);
  if (prev) drawStreak(L, t, sc.start);
  if (SCENES.overlay) SCENES.overlay(L, t);

  // пост-обработка
  const { m, f } = impactAt(t);
  B.globalCompositeOperation = 'copy'; B.filter = 'contrast(1.7) brightness(0.95) blur(5px)'; B.drawImage(Lc, 0, 0, 480, 270); B.filter = 'none';
  B2.globalCompositeOperation = 'copy'; B2.filter = 'blur(6px)'; B2.drawImage(Bc, 0, 0, 240, 135); B2.filter = 'none';

  out.setTransform(1, 0, 0, 1, 0, 0); out.globalAlpha = 1; out.globalCompositeOperation = 'source-over';
  out.fillStyle = '#000'; out.fillRect(0, 0, W, H);
  const sx = noise1(t * 38, 1) * m * 26, sy = noise1(t * 38, 2) * m * 18, rot = noise1(t * 30, 3) * m * 0.006;
  const zs = 1 + m * 0.035;
  out.setTransform(zs * Math.cos(rot), zs * Math.sin(rot), -zs * Math.sin(rot), zs * Math.cos(rot), W / 2 + sx - (W / 2) * zs, H / 2 + sy - (H / 2) * zs);
  const ca = m * 12;
  if (ca > 0.6) {
    const chans = [['#ff0000', -ca], ['#00ff00', 0], ['#0000ff', ca]];
    out.globalCompositeOperation = 'lighter';
    for (const [col, dx] of chans) {
      Tx.globalCompositeOperation = 'copy'; Tx.drawImage(Lc, 0, 0);
      Tx.globalCompositeOperation = 'multiply'; Tx.fillStyle = col; Tx.fillRect(0, 0, W, H);
      out.drawImage(Tc, dx, dx * 0.3);
    }
    out.globalCompositeOperation = 'source-over';
  } else out.drawImage(Lc, 0, 0);
  // bloom
  out.globalCompositeOperation = 'screen';
  out.globalAlpha = 0.55 + m * 0.25; out.drawImage(Bc, 0, 0, W, H);
  out.globalAlpha = 0.45 + m * 0.3; out.drawImage(B2c, 0, 0, W, H);
  out.setTransform(1, 0, 0, 1, 0, 0);
  out.globalAlpha = 1; out.globalCompositeOperation = 'source-over';
  out.drawImage(V2c, 0, 0);
  if (f > 0.01) { out.globalCompositeOperation = 'lighter'; out.fillStyle = rgba('#ffc2cb', f * 0.32); out.fillRect(0, 0, W, H); out.globalCompositeOperation = 'source-over'; }
  drawHUD(out, t);
  // зерно (меняется 12 раз в секунду)
  const gf = Math.floor(t * 12);
  out.globalCompositeOperation = 'overlay'; out.globalAlpha = 0.07;
  const g = GRAIN[gf % 4], ox = Math.floor(hash(gf) * 256), oy = Math.floor(hash(gf + 0.5) * 256);
  for (let y = -oy; y < H; y += 256) for (let x = -ox; x < W; x += 256) out.drawImage(g, x, y);
  out.globalAlpha = 1; out.globalCompositeOperation = 'source-over';
  // затемнение в начале и в конце
  const fade = Math.max(1 - prog(t, 0, 0.6), Ease.inOutCubic(prog(t, TL.T.outro.fade + 0.3, DUR - TL.T.outro.fade - 0.4)));
  if (fade > 0) { out.fillStyle = rgba('#000000', fade); out.fillRect(0, 0, W, H); }
}

// ---------- загрузка шрифтов и режимы ----------
window.renderFrame = renderFrame;
window.ready = (async () => {
  const fams = [`800 40px "${F.disp}"`, `500 40px "${F.disp}"`, `500 40px "${F.body}"`, `700 40px "${F.body}"`, `600 40px "${F.mono}"`,
    `400 40px "${F.impact}"`, `400 40px "${F.brush}"`, `800 40px "${F.mincho}"`];
  await Promise.all(fams.map((f) => document.fonts.load(f, 'АЯяzZ呪術廻戦')));
  await document.fonts.ready;
  return true;
})();

const params = new URLSearchParams(location.search);
if (!params.has('render')) {
  // Интерактивный предпросмотр: пробел — пауза, клик по полосе — перемотка
  document.body.classList.add('preview');
  const audio = new Audio('../out/soundtrack.m4a');
  const bar = document.getElementById('bar'), fill = document.getElementById('fill'), tc = document.getElementById('tc');
  let playing = false, t0 = 0, base = params.has('t') ? +params.get('t') : 0;
  const now = () => (playing ? (audio.readyState > 2 && !audio.paused ? audio.currentTime : base + (performance.now() - t0) / 1000) : base);
  const toggle = () => {
    if (playing) { base = now(); playing = false; audio.pause(); }
    else { playing = true; t0 = performance.now(); audio.currentTime = base; audio.play().catch(() => {}); }
  };
  document.addEventListener('keydown', (e) => { if (e.code === 'Space') { e.preventDefault(); toggle(); } });
  stage.addEventListener('click', toggle);
  bar.addEventListener('click', (e) => { const r = bar.getBoundingClientRect(); base = ((e.clientX - r.left) / r.width) * DUR; t0 = performance.now(); audio.currentTime = base; });
  window.ready.then(() => {
    const loop = () => {
      let t = now(); if (t >= DUR) { t = DUR - 0.001; if (playing) toggle(); base = 0; }
      renderFrame(t); fill.style.width = `${(t / DUR) * 100}%`;
      tc.textContent = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')} / 2:35 — пробел: пуск/пауза`;
      requestAnimationFrame(loop);
    };
    loop();
  });
}
