// Вспомогательные функции: easing, шум, типографика, примитивы моушн-дизайна.
const W = 1920, H = 1080, TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const prog = (t, t0, dur) => clamp((t - t0) / dur);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

const Ease = {
  lin: (x) => x,
  inQuad: (x) => x * x,
  outQuad: (x) => 1 - (1 - x) * (1 - x),
  inCubic: (x) => x * x * x,
  outCubic: (x) => 1 - Math.pow(1 - x, 3),
  inOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  outQuart: (x) => 1 - Math.pow(1 - x, 4),
  outQuint: (x) => 1 - Math.pow(1 - x, 5),
  inOutQuint: (x) => (x < 0.5 ? 16 * x ** 5 : 1 - Math.pow(-2 * x + 2, 5) / 2),
  inExpo: (x) => (x <= 0 ? 0 : Math.pow(2, 10 * x - 10)),
  outExpo: (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  inOutExpo: (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2),
  outBack: (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
  outElastic: (x) => (x <= 0 ? 0 : x >= 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * (TAU / 3)) + 1),
};

// Плавное появление/исчезновение: 0 → 1 (in) … 1 → 0 (out)
function env(t, tIn, dIn, tOut = Infinity, dOut = 0.4, ease = Ease.outCubic) {
  const a = ease(prog(t, tIn, dIn));
  const b = tOut === Infinity ? 1 : 1 - Ease.inCubic(prog(t, tOut, dOut));
  return a * b;
}

// ---------- детерминированный шум ----------
function hash(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123; return x - Math.floor(x); }
function hash2(a, b) { return hash(a * 57.0 + b * 131.0); }
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const PERM = (() => { const r = rng(1337); const p = Array.from({ length: 256 }, (_, i) => i); for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; } const out = new Uint8Array(512); for (let i = 0; i < 512; i++) out[i] = p[i & 255]; return out; })();
const GRAD = (() => { const r = rng(7); const g = new Float32Array(256); for (let i = 0; i < 256; i++) g[i] = r(); return g; })();
function vnoise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const X = xi & 255, Y = yi & 255, Z = zi & 255;
  const g = (a, b, c) => GRAD[PERM[PERM[PERM[a] + b] + c]];
  const x0 = X, x1 = (X + 1) & 255, y0 = Y, y1 = (Y + 1) & 255, z0 = Z, z1 = (Z + 1) & 255;
  const a = lerp(g(x0, y0, z0), g(x1, y0, z0), u), b = lerp(g(x0, y1, z0), g(x1, y1, z0), u);
  const c = lerp(g(x0, y0, z1), g(x1, y0, z1), u), d = lerp(g(x0, y1, z1), g(x1, y1, z1), u);
  return lerp(lerp(a, b, v), lerp(c, d, v), w);
}
function fbm3(x, y, z, oct = 3) { let s = 0, a = 0.5, f = 1, n = 0; for (let i = 0; i < oct; i++) { s += a * vnoise3(x * f, y * f, z * f); n += a; a *= 0.5; f *= 2.03; } return s / n; }
const noise1 = (x, seed = 0) => vnoise3(x, seed * 17.3, 0.5) * 2 - 1;

// ---------- цвет ----------
function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgba(c, a = 1) { const [r, g, b] = typeof c === 'string' ? hexToRgb(c) : c; return `rgba(${r | 0},${g | 0},${b | 0},${a})`; }
function mix(c1, c2, t) { const a = typeof c1 === 'string' ? hexToRgb(c1) : c1, b = typeof c2 === 'string' ? hexToRgb(c2) : c2; return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }

// ---------- шрифты ----------
const F = { disp: 'Unbounded', body: 'Manrope', mono: 'JetBrains Mono', impact: 'Dela Gothic One', brush: 'Yuji Syuku', mincho: 'Shippori Mincho B1' };
function font(c, fam, size, weight = 400) { c.font = `${weight} ${size}px "${fam}"`; }

// Посимвольная анимация строки.
// mode: rise | mask | fade | scramble | blur | slam
const SCRAMBLE = 'АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЩЭЮЯ0123456789#%&@呪術力界領域';
function animText(c, str, x, y, o = {}) {
  const {
    fam = F.body, size = 32, weight = 500, color = '#fff', align = 'left', track = 0,
    t = 99, dur = 0.5, stagger = 0.03, mode = 'rise', ease = Ease.outCubic,
    out = -1, outDur = 0.35, glow = 0, glowColor = null, alpha = 1, colors = null, seed = 0,
  } = o;
  if (t < 0 || alpha <= 0) return 0;
  font(c, fam, size, weight);
  c.letterSpacing = '0px';
  const chars = Array.from(str);
  const ws = chars.map((ch) => c.measureText(ch).width);
  const total = ws.reduce((s, w) => s + w, 0) + track * Math.max(0, chars.length - 1);
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  const outK = out >= 0 ? Ease.inCubic(clamp(out / outDur)) : 0;
  const baseA = c.globalAlpha;
  c.save();
  c.textBaseline = 'alphabetic';
  if (mode === 'mask') { c.beginPath(); c.rect(cx - 20, y - size * 1.15, total + 40, size * 1.45); c.clip(); }
  if (glow > 0) { c.shadowBlur = glow; c.shadowColor = glowColor || color; }
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const p = clamp((t - i * stagger) / dur);
    const e = ease(p);
    let dx = 0, dy = 0, a = alpha, s = 1, draw = ch;
    if (mode === 'rise') { dy = (1 - e) * size * 0.55; a *= p; }
    else if (mode === 'mask') { dy = (1 - e) * size * 1.2; }
    else if (mode === 'fade') { a *= e; }
    else if (mode === 'blur') { a *= e; s = 1 + (1 - e) * 0.4; }
    else if (mode === 'slam') { a *= clamp(p * 3); s = 1 + (1 - e) * 1.2; }
    else if (mode === 'scramble') {
      a *= clamp(p * 4);
      if (p < 1 && ch !== ' ') { const k = Math.floor((t * 24) + i * 7 + seed); draw = SCRAMBLE[Math.floor(hash(k) * SCRAMBLE.length)]; }
    }
    if (outK > 0) { a *= 1 - outK; dy -= outK * size * 0.4; }
    if (a > 0.001) {
      c.globalAlpha = clamp(a) * baseA;
      c.fillStyle = colors ? colors[i] || color : color;
      if (s !== 1) { c.save(); c.translate(cx + ws[i] / 2, y - size * 0.35); c.scale(s, s); c.fillText(draw, -ws[i] / 2, size * 0.35); c.restore(); }
      else c.fillText(draw, cx + dx, y + dy);
    }
    cx += ws[i] + track;
  }
  c.restore();
  return total;
}

// Перенос строк по ширине
function wrap(c, text, maxW) {
  const words = text.split(' ');
  const lines = []; let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (c.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

// Абзац: строки выезжают из-под маски по очереди
function animPara(c, text, x, y, o = {}) {
  const { fam = F.body, size = 28, weight = 500, color = '#c9c6d3', maxW = 600, lh = 1.4, t = 99, stagger = 0.09, dur = 0.7, out = -1, align = 'left', alpha = 1 } = o;
  font(c, fam, size, weight);
  c.letterSpacing = '0px';
  const lines = text.split('\n').flatMap((p) => wrap(c, p, maxW));
  const baseA = c.globalAlpha;
  lines.forEach((ln, i) => {
    const p = Ease.outQuart(clamp((t - i * stagger) / dur));
    const outK = out >= 0 ? Ease.inCubic(clamp((out - i * 0.04) / 0.35)) : 0;
    if (p <= 0) return;
    const ly = y + i * size * lh;
    c.save();
    const cx0 = align === 'center' ? x - maxW / 2 : align === 'right' ? x - maxW : x;
    c.beginPath(); c.rect(cx0 - 12, ly - size * 1.1, maxW + 24, size * 1.5); c.clip();
    c.globalAlpha = alpha * (1 - outK) * baseA;
    c.fillStyle = color; c.textAlign = align;
    c.fillText(ln, x, ly + (1 - p) * size * 1.2 - outK * size * 0.5);
    c.restore();
  });
  return lines.length * size * lh;
}

// ---------- геометрия ----------
function rrect(c, x, y, w, h, r) { c.beginPath(); c.roundRect(x, y, w, h, r); }

// Рамка, прорисовываемая по периметру (p: 0..1)
function strokeRectP(c, x, y, w, h, p, color, lw = 1.5, r = 0) {
  if (p <= 0) return;
  const per = 2 * (w + h);
  c.save(); c.strokeStyle = color; c.lineWidth = lw;
  c.setLineDash([per * p, per]); c.lineDashOffset = 0;
  c.beginPath(); c.moveTo(x + r, y); c.roundRect(x, y, w, h, r); c.stroke(); c.restore();
}

function lineP(c, x1, y1, x2, y2, p, color, lw = 2, glow = 0) {
  if (p <= 0) return;
  c.save(); c.strokeStyle = color; c.lineWidth = lw; c.lineCap = 'round';
  if (glow) { c.shadowBlur = glow; c.shadowColor = color; }
  c.beginPath(); c.moveTo(x1, y1); c.lineTo(lerp(x1, x2, p), lerp(y1, y2, p)); c.stroke(); c.restore();
}

function glowDot(c, x, y, r, color, a = 1) {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, a)); g.addColorStop(0.25, rgba(color, a * 0.45)); g.addColorStop(1, rgba(color, 0));
  c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
}

function ring(c, x, y, r, lw, color, a = 1) {
  if (a <= 0 || r <= 0) return;
  c.save(); c.globalAlpha = a * c.globalAlpha; c.strokeStyle = color; c.lineWidth = lw; c.beginPath(); c.arc(x, y, r, 0, TAU); c.stroke(); c.restore();
}

// Чернильная клякса (растущая, с брызгами)
function inkBlot(c, x, y, r, grow, seed, color, a = 1) {
  if (grow <= 0 || a <= 0) return;
  c.save(); c.globalAlpha = a * c.globalAlpha; c.fillStyle = color;
  c.beginPath();
  const N = 140;
  for (let i = 0; i <= N; i++) {
    const ang = (i / N) * TAU;
    const n = fbm3(Math.cos(ang) * 1.6 + seed, Math.sin(ang) * 1.6, seed * 0.7, 4);
    const spike = Math.pow(vnoise3(Math.cos(ang) * 7 + seed, Math.sin(ang) * 7, seed * 1.3), 5) * 0.9;
    const rr = r * grow * (0.72 + n * 0.55 + spike * grow);
    const px = x + Math.cos(ang) * rr, py = y + Math.sin(ang) * rr * 0.92;
    i ? c.lineTo(px, py) : c.moveTo(px, py);
  }
  c.closePath(); c.fill();
  // брызги
  const R = rng(seed * 991 + 3);
  for (let i = 0; i < 26; i++) {
    const ang = R() * TAU, d = r * (1.0 + R() * 0.9) * Ease.outExpo(grow), s = (2 + R() * 9) * grow;
    c.beginPath(); c.arc(x + Math.cos(ang) * d, y + Math.sin(ang) * d, s, 0, TAU); c.fill();
  }
  c.restore();
}

// Радарная диаграмма
function radar(c, cx, cy, r, labels, sets, t, o = {}) {
  const n = labels.length;
  const ang = (i) => -Math.PI / 2 + (i / n) * TAU;
  const gridA = env(t, 0, 0.6);
  const baseA = c.globalAlpha;
  c.save();
  // сетка
  for (let k = 1; k <= 5; k++) {
    const rr = (r * k) / 5 * Ease.outCubic(prog(t, k * 0.05, 0.6));
    c.beginPath();
    for (let i = 0; i <= n; i++) { const a = ang(i % n); const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr; i ? c.lineTo(px, py) : c.moveTo(px, py); }
    c.strokeStyle = rgba('#ffffff', 0.09 * gridA + (k === 5 ? 0.08 * gridA : 0)); c.lineWidth = 1; c.stroke();
  }
  for (let i = 0; i < n; i++) {
    const a = ang(i); const p = Ease.outCubic(prog(t, 0.1 + i * 0.05, 0.5));
    lineP(c, cx, cy, cx + Math.cos(a) * r, cy + Math.sin(a) * r, p, rgba('#ffffff', 0.12), 1);
    const lx = cx + Math.cos(a) * (r + 34), ly = cy + Math.sin(a) * (r + 34);
    font(c, F.mono, 17, 600); c.textAlign = Math.abs(Math.cos(a)) < 0.2 ? 'center' : Math.cos(a) > 0 ? 'left' : 'right';
    c.globalAlpha = env(t, 0.3 + i * 0.06, 0.4) * baseA; c.fillStyle = '#b9b6c4'; c.letterSpacing = '2px';
    c.fillText(labels[i], lx, ly + 6); c.globalAlpha = baseA; c.letterSpacing = '0px';
  }
  c.textAlign = 'left';
  sets.forEach((s, si) => {
    const p = Ease.outBack(prog(t, s.delay ?? 0.6 + si * 0.25, 1.0));
    if (p <= 0) return;
    c.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = ang(i % n); const v = s.values[i % n] / 10;
      const wob = 1 + Math.sin(t * 2.2 + i * 1.7 + si) * 0.012;
      const rr = r * v * p * wob; const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
      i ? c.lineTo(px, py) : c.moveTo(px, py);
    }
    c.fillStyle = rgba(s.color, 0.16); c.fill();
    c.strokeStyle = rgba(s.color, 0.95); c.lineWidth = 2.5; c.shadowBlur = 18; c.shadowColor = s.color; c.stroke(); c.shadowBlur = 0;
    for (let i = 0; i < n; i++) { const a = ang(i); const rr = r * (s.values[i] / 10) * p; glowDot(c, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 10, s.color, 0.9); }
  });
  c.restore();
}

// Счётчик числа
const countUp = (v, p) => Math.round(v * Ease.outExpo(p));
