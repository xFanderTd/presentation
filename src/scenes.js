// Сцены ролика. Каждая сцена — функция (ctx, t, scene), где t — абсолютное время.
const TT = window.TIMELINE.T;
const pad2 = (n) => String(n).padStart(2, '0');
const since = (t, t0) => t - t0;

function fitSize(c, text, fam, size, weight, maxW, track = 0) {
  font(c, fam, size, weight);
  const w = c.measureText(text).width + track * (Array.from(text).length - 1);
  return w > maxW ? Math.floor(size * (maxW / w)) : size;
}

// ---------- Заставка главы: иероглиф-номер + название, затем номер «улетает» в HUD ----------
function chapterCard(c, t, sc) {
  const u = t - sc.start;
  if (u > 2.6) return;
  const acc = sc.accent;
  const m = Ease.inOutCubic(prog(u, 1.9, 0.6));
  const bx = 600, by = 530, hx = 144, hy = 84;
  const px = lerp(bx, hx, m), py = lerp(by, hy, m);
  const grow = Ease.outExpo(prog(u, 0.12, 0.8));
  inkBlot(c, px, py, lerp(215, 26, m), grow, sc.idx * 3 + 1, mix(acc, '#000000', 0.38), 0.95 * (1 - m));
  // кольца удара
  const rp = prog(u, 0.2, 0.9);
  if (u > 0.2) ring(c, bx, by, 180 + Ease.outExpo(rp) * 420, 2, acc, (1 - rp) * 0.8 * (1 - m));
  if (u > 0.2) ring(c, bx, by, 160 + Ease.outExpo(rp) * 260, 1, '#ffffff', (1 - rp) * 0.5 * (1 - m));
  // иероглиф
  const inP = prog(u, 0, 0.32);
  const s = 1 + (1 - Ease.outExpo(inP)) * 0.9;
  const sz = lerp(300, 34, m);
  c.save(); c.translate(px, py); c.scale(s, s);
  c.globalAlpha = clamp(inP * 2.5);
  font(c, F.brush, sz); c.textAlign = 'center'; c.textBaseline = 'middle';
  c.shadowBlur = 40 * (1 - m); c.shadowColor = '#000';
  c.fillStyle = '#fff'; c.fillText(sc.num, 0, sz * 0.04);
  c.restore();
  // текст
  const out = u - 1.8, x = 860;
  const lp = Ease.outExpo(prog(u, 0.28, 0.6));
  c.save(); c.globalAlpha = 1 - prog(u, 1.8, 0.3); c.fillStyle = acc; c.fillRect(x, 448, 56 * lp, 3); c.restore();
  animText(c, `ГЛАВА ${pad2(sc.idx)}`, x + 76, 458, { fam: F.mono, size: 20, weight: 700, color: acc, track: 6, t: u - 0.32, mode: 'scramble', dur: 0.45, stagger: 0.03, out, seed: sc.idx });
  const ts = fitSize(c, sc.title, F.disp, 80, 800, 920, 2);
  animText(c, sc.title, x, 552, { fam: F.disp, size: ts, weight: 800, track: 2, t: u - 0.38, stagger: 0.028, dur: 0.6, mode: 'mask', ease: Ease.outQuint, out });
  if (sc.sub) animText(c, sc.sub, x + 2, 612, { fam: F.body, size: 30, weight: 500, color: '#aaa6ba', t: u - 0.72, stagger: 0.012, dur: 0.5, mode: 'rise', out });
}

// Блок-заголовок раздела: метка + большой заголовок
function sectionHead(c, x, y, label, lines, t, o = {}) {
  const { acc = '#ff2e4d', out = -1, size = 64, jp = null } = o;
  const lp = Ease.outExpo(prog(t, 0, 0.6)) * (out >= 0 ? 1 - prog(out, 0, 0.3) : 1);
  c.save(); c.fillStyle = acc; c.fillRect(x, y - 7, 40 * lp, 3); c.restore();
  animText(c, label, x + 56, y, { fam: F.mono, size: 18, weight: 700, color: acc, track: 4, t: t - 0.05, mode: 'scramble', dur: 0.4, stagger: 0.02, out });
  if (jp) animText(c, jp, x + 60 + 18 * label.length * 0.75 + 30, y + 2, { fam: F.mincho, size: 24, weight: 800, color: rgba(acc, 0.9), track: 6, t: t - 0.3, mode: 'fade', out });
  lines.forEach((ln, i) => animText(c, ln, x - 4, y + 78 + i * size * 1.1, { fam: F.disp, size, weight: 800, t: t - 0.12 - i * 0.1, stagger: 0.025, dur: 0.55, mode: 'mask', ease: Ease.outQuint, out }));
  return y + 78 + (lines.length - 1) * size * 1.1;
}

// ===================== 0. ВСТУПЛЕНИЕ =====================
function sceneIntro(c, t) {
  const I = TT.intro;
  const cx = 960, cy = 450;
  const conv = Ease.inCubic(prog(t, 0.2, I.impact - 0.2));
  const bu = prog(t, I.impact, 2.8);
  // сходящиеся частицы → взрыв
  c.save(); c.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 240; i++) {
    const a0 = hash(i * 1.7) * TAU, d0 = 520 + hash(i * 2.9) * 820, sp = 0.6 + hash(i * 4.1) * 1.4;
    let ang, dist, al;
    if (t < I.impact) { ang = a0 + conv * 2.4 * sp; dist = d0 * (1 - conv * 0.95); al = (0.22 + conv * 0.7) * (0.4 + hash(i) * 0.6); }
    else { ang = a0 + 2.4 * sp + bu * 0.4; dist = 30 + Ease.outExpo(bu) * (500 + hash(i * 5.3) * 1100); al = (1 - bu) * 0.9; }
    const x = cx + Math.cos(ang) * dist * 1.25, y = cy + Math.sin(ang) * dist * 0.8;
    spark(c, x, y, 6 + hash(i * 6.1) * 10, i % 5 === 0 ? '#ffffff' : '#ff3048', al);
  }
  c.restore();
  // «глаз»: линия раскрывается в щель
  const lw = Ease.outExpo(prog(t, I.eye, 1.3)) * 620;
  const open = Ease.inOutCubic(prog(t, I.open, I.impact - I.open)) * 150;
  const fly = Ease.outExpo(prog(t, I.impact, 0.9));
  const la = 1 - prog(t, I.impact, 0.7);
  if (la > 0 && lw > 0) {
    c.save(); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
    for (const sgn of [-1, 1]) {
      const y = cy + sgn * (open + fly * 700);
      c.strokeStyle = rgba('#ff2e4d', 0.55 * la); c.lineWidth = 12; c.shadowBlur = 40; c.shadowColor = '#ff2e4d';
      c.beginPath(); c.moveTo(cx - lw, y); c.lineTo(cx + lw, y); c.stroke();
      c.strokeStyle = rgba('#ffffff', 0.95 * la); c.lineWidth = 2.5; c.shadowBlur = 8;
      c.beginPath(); c.moveTo(cx - lw, y); c.lineTo(cx + lw, y); c.stroke();
    }
    c.restore();
  }
  // клякса и ударные кольца
  const ip = prog(t, I.impact, 1.0);
  inkBlot(c, cx, cy, 330, Ease.outExpo(ip), 11, '#a0001b', 0.88 * env(t, I.impact, 0.05));
  if (t >= I.impact) for (let k = 0; k < 3; k++) { const rp = prog(t, I.impact + k * 0.08, 1.4); if (rp > 0) ring(c, cx, cy, 120 + Ease.outExpo(rp) * (700 + k * 300), 3 - k, k ? '#ffffff' : '#ff2e4d', (1 - rp) * 0.9); }
  // иероглифы в щели
  const kanjiA = env(t, I.open, 1.2);
  if (kanjiA > 0) {
    c.save();
    if (t < I.impact) { c.beginPath(); c.rect(0, cy - open, W, open * 2); c.clip(); }
    const punch = t >= I.impact ? 1 + (1 - Ease.outExpo(prog(t, I.impact, 0.7))) * 0.14 : 1.1 - conv * 0.08;
    c.translate(cx, cy); c.scale(punch, punch);
    font(c, F.brush, 228); c.textAlign = 'center'; c.textBaseline = 'middle'; c.letterSpacing = '18px';
    c.globalAlpha = kanjiA; c.shadowBlur = t >= I.impact ? 30 : 60; c.shadowColor = t >= I.impact ? 'rgba(0,0,0,0.9)' : '#ff2e4d';
    c.fillStyle = '#fff'; c.fillText('呪術廻戦', 9, 6);
    c.restore(); c.letterSpacing = '0px';
  }
  // титр
  animText(c, 'JUJUTSU KAISEN', cx, 680, { fam: F.disp, size: 56, weight: 800, track: 20, align: 'center', t: t - I.title, mode: 'mask', stagger: 0.035, dur: 0.6, ease: Ease.outQuint });
  const dp = Ease.outExpo(prog(t, I.tags - 0.3, 0.9));
  c.save(); c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(cx - 260 * dp, 718, 520 * dp, 1); c.fillStyle = '#ff2e4d'; c.fillRect(cx - 4, 715, 8, 7 * dp); c.restore();
  const tag = 'ИЕРАРХИЯ · СИЛА · ПОТЕНЦИАЛ';
  animText(c, tag, cx, 775, { fam: F.disp, size: 28, weight: 500, track: 9, align: 'center', t: t - I.tags, mode: 'scramble', dur: 0.5, stagger: 0.025, colors: Array.from(tag).map((ch) => (ch === '·' ? '#ff2e4d' : '#f2f0f7')) });
  animText(c, 'Аналитический разбор вселенной «Магической битвы»', cx, 830, { fam: F.body, size: 26, weight: 500, color: '#9d99ad', align: 'center', t: t - I.sub, mode: 'rise', stagger: 0.01 });
  // плашка о спойлерах
  const sa = env(t, I.spoiler, 0.5) * (0.75 + 0.25 * Math.sin(t * 5));
  if (sa > 0) {
    c.save(); c.globalAlpha = sa;
    const txt = 'СПОЙЛЕРЫ ДО ФИНАЛА МАНГИ · ГЛ. 271';
    font(c, F.mono, 16, 700); c.letterSpacing = '4px'; const tw = c.measureText(txt).width;
    const bw = tw + 90, bx = cx - bw / 2, by = 936;
    rrect(c, bx, by, bw, 44, 22); c.strokeStyle = 'rgba(255,46,77,0.8)'; c.lineWidth = 1.5; c.stroke();
    c.fillStyle = '#ff2e4d'; c.beginPath(); c.moveTo(bx + 30, by + 31); c.lineTo(bx + 42, by + 11); c.lineTo(bx + 54, by + 31); c.closePath(); c.fill();
    c.fillStyle = '#0a0508'; font(c, F.mono, 14, 800); c.letterSpacing = '0px'; c.textAlign = 'center'; c.fillText('!', bx + 42, by + 29);
    font(c, F.mono, 16, 700); c.letterSpacing = '4px'; c.textAlign = 'left'; c.fillStyle = '#ffd5da'; c.fillText(txt, bx + 68, by + 28);
    c.restore();
  }
}

// ===================== 1. МИР ПРОКЛЯТИЙ =====================
const NODES = {
  people: { x: 1130, y: 320, jp: '人', label: 'ЛЮДИ', col: '#d9d6e6', above: true },
  curse: { x: 1610, y: 560, jp: '呪', label: 'ПРОКЛЯТИЯ', col: '#ff3b5c' },
  mage: { x: 1130, y: 800, jp: '術', label: 'МАГИ', col: '#8b6cff' },
};
function curveArrow(c, a, b, bend, p, color, label, lt, dashed = false) {
  if (p <= 0) return;
  const mx = (a.x + b.x) / 2 + (b.y - a.y) * bend, my = (a.y + b.y) / 2 - (b.x - a.x) * bend;
  const r0 = 84, r1 = 92;
  const d0 = Math.hypot(mx - a.x, my - a.y), d1 = Math.hypot(mx - b.x, my - b.y);
  const sx = a.x + (mx - a.x) / d0 * r0, sy = a.y + (my - a.y) / d0 * r0;
  const ex = b.x + (mx - b.x) / d1 * r1, ey = b.y + (my - b.y) / d1 * r1;
  const N = 48; const pts = [];
  for (let i = 0; i <= N; i++) { const u = i / N; pts.push([(1 - u) ** 2 * sx + 2 * (1 - u) * u * mx + u * u * ex, (1 - u) ** 2 * sy + 2 * (1 - u) * u * my + u * u * ey]); }
  const k = Math.max(1, Math.floor(N * p));
  c.save(); c.strokeStyle = color; c.lineWidth = 2; c.shadowBlur = 14; c.shadowColor = color; if (dashed) c.setLineDash([8, 10]);
  c.beginPath(); pts.slice(0, k + 1).forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke(); c.setLineDash([]);
  const [hx, hy] = pts[k], [qx, qy] = pts[Math.max(0, k - 3)];
  const ang = Math.atan2(hy - qy, hx - qx);
  c.fillStyle = color; c.beginPath(); c.moveTo(hx, hy); c.lineTo(hx - Math.cos(ang - 0.45) * 16, hy - Math.sin(ang - 0.45) * 16); c.lineTo(hx - Math.cos(ang + 0.45) * 16, hy - Math.sin(ang + 0.45) * 16); c.closePath(); c.fill();
  c.restore();
  // бегущий импульс
  if (p >= 1) { const u = (lt * 0.6) % 1; const [px, py] = pts[Math.floor(u * N)]; spark(c, px, py, 16, color, 0.9); }
  const [lx, ly] = pts[N >> 1];
  animText(c, label, lx + (bend > 0 ? 18 : -18), ly + 6, { fam: F.mono, size: 16, weight: 700, color: '#e9e6f2', track: 3, align: bend > 0 ? 'left' : 'right', t: lt - 0.3, mode: 'scramble', dur: 0.4 });
}
function drawNode(c, n, a, t, glow = 0) {
  if (a <= 0) return;
  const s = 0.7 + 0.3 * Ease.outBack(clamp(a));
  c.save(); c.translate(n.x, n.y); c.scale(s, s); c.globalAlpha = clamp(a);
  glowDot(c, 0, 0, 150, n.col, 0.18 + glow * 0.2);
  c.fillStyle = 'rgba(8,6,12,0.85)'; c.beginPath(); c.arc(0, 0, 66, 0, TAU); c.fill();
  c.strokeStyle = n.col; c.lineWidth = 2; c.shadowBlur = 20; c.shadowColor = n.col; c.beginPath(); c.arc(0, 0, 66, 0, TAU); c.stroke(); c.shadowBlur = 0;
  c.strokeStyle = rgba(n.col, 0.35); c.setLineDash([3, 7]); c.lineDashOffset = -t * 20; c.beginPath(); c.arc(0, 0, 80, 0, TAU); c.stroke(); c.setLineDash([]);
  font(c, F.mincho, 58, 800); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#fff'; c.fillText(n.jp, 0, 3);
  font(c, F.disp, 20, 700); c.letterSpacing = '4px'; c.textBaseline = 'alphabetic'; c.fillStyle = n.col; c.fillText(n.label, 0, n.above ? -106 : 124);
  c.restore(); c.letterSpacing = '0px';
}
function sceneWorld(c, t, sc) {
  chapterCard(c, t, sc);
  const X = TT.world;
  const u1 = t - X.energy, u2 = t - X.triad;
  if (u1 < 0) return;
  const out1 = u2 >= 0 ? u2 : -1;
  // левый текст
  if (u2 < 0.6) {
    const y = sectionHead(c, 160, 330, '01 — ИСТОЧНИК', ['ПРОКЛЯТАЯ', 'ЭНЕРГИЯ'], u1, { acc: sc.accent, out: out1, jp: '呪力' });
    animPara(c, 'Рождается из негативных эмоций людей — страха, ненависти, зависти, отчаяния.', 160, y + 90, { size: 30, maxW: 640, t: u1 - 0.5, out: out1 });
  }
  if (u2 >= 0) {
    const y = sectionHead(c, 160, 330, '02 — ТРИ СТОРОНЫ', ['КРУГ', 'ПРОКЛЯТИЙ'], u2 - 0.25, { acc: sc.accent });
    animPara(c, 'Маги управляют этой энергией и изгоняют проклятия. Обычные люди невольно их порождают.', 160, y + 90, { size: 30, maxW: 640, t: u2 - 0.7 });
  }
  // правая часть: толпа → потоки → сфера
  const orb0 = { x: 1330, y: 440 };
  const m = Ease.inOutCubic(prog(u2, 0, 1.0));
  const ox = lerp(orb0.x, NODES.curse.x, m), oy = lerp(orb0.y, NODES.curse.y, m);
  const grow = Ease.outCubic(prog(u1, 0.3, 4.5));
  const crowd = 46;
  c.save(); c.globalCompositeOperation = 'lighter';
  for (let i = 0; i < crowd; i++) {
    const hx = 1000 + hash(i * 3.7) * 640, hy = 770 + hash(i * 5.1) * 110;
    const appear = env(u1, 0.1 + hash(i) * 0.8, 0.5);
    const tx = NODES.people.x + Math.cos(i * 2.4) * 30 * (1 - m), ty = NODES.people.y + Math.sin(i * 2.4) * 30 * (1 - m);
    const mm = Ease.inOutCubic(prog(u2, hash(i * 9.1) * 0.4, 0.9));
    const px = lerp(hx, tx, mm), py = lerp(hy, ty, mm);
    spark(c, px, py, 12, '#d6d0ff', appear * (1 - mm * 0.9) * 0.9);
    // поток к сфере
    const sa = appear * (1 - m) * env(u1, 0.8 + hash(i * 2.2) * 1.2, 0.6);
    if (sa > 0.01) {
      c.strokeStyle = rgba('#b28cff', 0.16 * sa); c.lineWidth = 1.2;
      const cx1 = (px + ox) / 2 + noise1(i + t * 0.3, 4) * 140, cy1 = (py + oy) / 2 + noise1(i + t * 0.3, 5) * 90;
      c.beginPath(); c.moveTo(px, py); c.quadraticCurveTo(cx1, cy1, ox, oy); c.stroke();
      const q = ((t * (0.35 + hash(i) * 0.35)) + hash(i * 7)) % 1;
      const bx = (1 - q) ** 2 * px + 2 * (1 - q) * q * cx1 + q * q * ox, by = (1 - q) ** 2 * py + 2 * (1 - q) * q * cy1 + q * q * oy;
      spark(c, bx, by, 10, '#ff5a8a', sa * 0.8);
    }
  }
  c.restore();
  // сфера проклятой энергии
  const oa = env(u1, 0.4, 0.8);
  if (oa > 0 && m < 1) {
    const R = (30 + grow * 70) * (1 - m * 0.4);
    c.save(); c.globalCompositeOperation = 'lighter';
    glowDot(c, ox, oy, R * 3.2, '#ff2e6d', 0.35 * oa * (1 - m));
    glowDot(c, ox, oy, R * 1.6, '#9b5cff', 0.6 * oa * (1 - m));
    for (let k = 0; k < 3; k++) {
      c.beginPath();
      for (let i = 0; i <= 90; i++) { const a = (i / 90) * TAU; const rr = R * (1 + 0.18 * fbm3(Math.cos(a) * 1.5, Math.sin(a) * 1.5, t * 0.8 + k * 3, 2)); i ? c.lineTo(ox + Math.cos(a) * rr, oy + Math.sin(a) * rr) : c.moveTo(ox + Math.cos(a) * rr, oy + Math.sin(a) * rr); }
      c.strokeStyle = rgba(k ? '#ff6b9a' : '#ffffff', oa * (1 - m) * (k ? 0.35 : 0.7)); c.lineWidth = k ? 1 : 1.8; c.stroke();
    }
    c.restore();
    // эмоции
    [['страх', 1060, 620], ['гнев', 1560, 660], ['зависть', 1180, 520], ['отчаяние', 1490, 540]].forEach(([w, x, y], i) => {
      const a = env(u1, 1.2 + i * 0.5, 0.6) * (1 - m);
      if (a <= 0) return;
      animText(c, w, x, y - (u1 - 1.2 - i * 0.5) * 12, { fam: F.body, size: 24, weight: 700, color: '#ff8fb0', align: 'center', alpha: a * 0.9, t: 9, mode: 'fade' });
    });
  }
  // триада
  if (u2 >= 0) {
    drawNode(c, NODES.people, prog(u2, 0.5, 0.6), t);
    drawNode(c, NODES.curse, prog(u2, 0.6, 0.6), t, 0.5 + 0.5 * Math.sin(t * 3));
    drawNode(c, NODES.mage, prog(u2, 0.15, 0.6), t);
    const A = X.arrows;
    curveArrow(c, NODES.people, NODES.curse, 0.18, Ease.outCubic(prog(t, A[0], 0.7)), '#ff5577', 'ПОРОЖДАЮТ', t - A[0]);
    curveArrow(c, NODES.mage, NODES.curse, -0.18, Ease.outCubic(prog(t, A[1], 0.7)), '#a58bff', 'ИЗГОНЯЮТ', t - A[1]);
    curveArrow(c, NODES.mage, NODES.people, 0.22, Ease.outCubic(prog(t, A[2], 0.7)), '#8e8aa0', 'ЗАЩИЩАЮТ', t - A[2], true);
  }
  // итоговая мысль
  const cu = t - X.caption;
  if (cu >= 0) {
    const txt = 'Чем сильнее страх перед чем-то — тем сильнее рождённое им проклятие.';
    font(c, F.body, 30, 600);
    animText(c, txt, 960, 985, { fam: F.body, size: 30, weight: 600, align: 'center', color: '#fff', t: cu, mode: 'rise', stagger: 0.008, dur: 0.45 });
  }
}

// ===================== 2. ИЕРАРХИЯ =====================
const HIER = [
  { jp: '天元', name: 'ТЭНГЭН', desc: 'бессмертный хранитель барьеров всей Японии', special: true },
  { jp: '上層部', name: 'ВЫСШЕЕ РУКОВОДСТВО', desc: 'старейшины: законы, приговоры, миссии' },
  { jp: '御三家', name: 'ТРИ ВЕЛИКИХ КЛАНА', desc: 'кровь, техники и политический вес', chips: [['五条', 'ГОДЗЁ'], ['禅院', 'ДЗЭНИН'], ['加茂', 'КАМО']] },
  { jp: '高専', name: 'КОЛЛЕДЖИ МАГИИ', desc: 'обучают магов и раздают задания', chips: [['東京', 'ТОКИО'], ['京都', 'КИОТО']] },
  { jp: '術師', name: 'МАГИ', desc: 'боевая сила, ранги — от 4-го до особого', grades: true },
  { jp: '補助', name: 'ПОДДЕРЖКА', desc: '«окна» видят проклятия, помощники ставят завесы' },
];
function sceneHierarchy(c, t, sc) {
  chapterCard(c, t, sc);
  const X = TT.hier; const acc = sc.accent;
  const u0 = t - X.levels[0];
  if (u0 < 0) return;
  const y0 = 205, dy = 118, bx = 330;
  // треугольник власти слева
  const tp = Ease.outCubic(prog(u0, 0, 1.2));
  c.save();
  const g = c.createLinearGradient(0, 200, 0, 880); g.addColorStop(0, rgba(acc, 0.55)); g.addColorStop(1, rgba(acc, 0.02));
  c.globalAlpha = tp; c.fillStyle = g;
  c.beginPath(); c.moveTo(200, 200); c.lineTo(200 + 70 * tp, 200 + 680 * tp); c.lineTo(200 - 70 * tp, 200 + 680 * tp); c.closePath(); c.fill();
  c.strokeStyle = rgba(acc, 0.6); c.lineWidth = 1; c.stroke();
  font(c, F.mono, 13, 700); c.letterSpacing = '5px'; c.fillStyle = rgba(acc, 0.95);
  c.translate(104, 540); c.rotate(-Math.PI / 2); c.textAlign = 'center';
  c.fillText('← ЧИСЛЕННОСТЬ          ВЛАСТЬ →', 0, 0);
  c.restore(); c.letterSpacing = '0px';
  // хребет
  const built = X.levels.reduce((n, lt) => n + (t >= lt ? 1 : 0), 0);
  const lastT = X.levels[built - 1];
  const spineTo = y0 + 42 + (built - 1 - 1 + Ease.outCubic(prog(t, lastT, 0.5))) * dy;
  if (built > 1) lineP(c, bx + 42, y0 + 42, bx + 42, spineTo, 1, rgba(acc, 0.55), 2, 8);
  if (t > X.levels[5] + 0.6) { const q = ((t - X.levels[5]) * 0.45) % 1; spark(c, bx + 42, y0 + 42 + q * dy * 5, 22, acc, 0.9); }
  HIER.forEach((lv, i) => {
    const u = t - X.levels[i];
    if (u < 0) return;
    const y = y0 + i * dy;
    const a = Ease.outCubic(prog(u, 0, 0.5));
    // горизонтальная полоса
    c.save(); c.globalAlpha = a;
    const gw = Ease.outExpo(prog(u, 0.05, 0.9)) * 900;
    const gg = c.createLinearGradient(bx, 0, bx + gw, 0); gg.addColorStop(0, rgba(acc, 0.16)); gg.addColorStop(1, rgba(acc, 0));
    c.fillStyle = gg; c.fillRect(bx, y, gw, 84);
    c.restore();
    // квадрат с иероглифами
    const s = 0.6 + 0.4 * Ease.outBack(prog(u, 0, 0.45));
    c.save(); c.translate(bx + 42, y + 42); c.scale(s, s); c.globalAlpha = a;
    c.fillStyle = lv.special ? acc : '#120e14'; c.fillRect(-42, -42, 84, 84);
    c.strokeStyle = acc; c.lineWidth = 2; c.strokeRect(-42, -42, 84, 84);
    const js = lv.jp.length > 2 ? 24 : 32;
    font(c, F.mincho, js, 800); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = lv.special ? '#140d02' : '#fff';
    c.fillText(lv.jp, 0, 2);
    c.restore();
    if (lv.special) { const rp = (t * 0.5) % 1; ring(c, bx + 42, y + 42, 50 + rp * 60, 1.5, acc, (1 - rp) * 0.7 * a); }
    animText(c, lv.name, bx + 116, y + 40, { fam: F.disp, size: 28, weight: 700, t: u - 0.08, mode: 'mask', stagger: 0.02, dur: 0.5, ease: Ease.outQuint });
    animText(c, lv.desc, bx + 116, y + 72, { fam: F.body, size: 21, weight: 500, color: '#a8a4b6', t: u - 0.25, mode: 'rise', stagger: 0.006, dur: 0.4 });
    // «фишки»
    if (lv.chips) lv.chips.forEach(([jp, nm], k) => {
      const ca = Ease.outBack(prog(u, 0.35 + k * 0.1, 0.5));
      if (ca <= 0) return;
      const cw = lv.chips.length === 3 ? 96 : 132, cx0 = 1000 + k * (cw + 10);
      c.save(); c.globalAlpha = clamp(ca); c.translate(cx0, y + 10 + (1 - ca) * 20);
      rrect(c, 0, 0, cw, 64, 6); c.fillStyle = 'rgba(255,255,255,0.04)'; c.fill(); c.strokeStyle = rgba(acc, 0.6); c.lineWidth = 1; c.stroke();
      font(c, F.mincho, 22, 800); c.textAlign = 'center'; c.fillStyle = '#fff'; c.fillText(jp, cw / 2, 28);
      font(c, F.mono, 13, 700); c.letterSpacing = '2px'; c.fillStyle = acc; c.fillText(nm, cw / 2, 51);
      c.restore(); c.letterSpacing = '0px';
    });
    if (lv.grades) ['特', '1', '2', '3', '4'].forEach((gname, k) => {
      const ca = Ease.outBack(prog(u, 0.3 + k * 0.07, 0.45));
      if (ca <= 0) return;
      const cols = ['#ffc94d', '#ff3b4e', '#9b5cff', '#4d8dff', '#8d93a3'];
      c.save(); c.globalAlpha = clamp(ca); c.translate(1000 + k * 56, y + 18 + (1 - ca) * 16);
      c.fillStyle = rgba(cols[k], 0.18); c.fillRect(0, 0, 46, 46); c.strokeStyle = cols[k]; c.lineWidth = 1.5; c.strokeRect(0, 0, 46, 46);
      font(c, k ? F.disp : F.mincho, k ? 20 : 24, 800); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#fff'; c.fillText(gname, 23, 25);
      c.restore();
    });
  });
  // вне системы
  const uo = t - X.outside;
  if (uo >= 0) {
    const px = 1390, py = 205, pw = 410, ph = 530;
    const ga = Ease.outCubic(prog(uo, 0, 0.3));
    const jit = uo < 0.35 ? (hash(Math.floor(t * 40)) - 0.5) * 16 : 0;
    c.save(); c.translate(jit, 0); c.globalAlpha = ga;
    c.fillStyle = 'rgba(40,4,10,0.35)'; c.fillRect(px, py, pw, ph);
    c.setLineDash([10, 8]); c.lineDashOffset = -t * 30; strokeRectP(c, px, py, pw, ph, Ease.outCubic(prog(uo, 0, 0.8)), '#ff3b4e', 1.5); c.setLineDash([]);
    c.restore();
    animText(c, 'ВНЕ СИСТЕМЫ', px + 30, py + 50, { fam: F.mono, size: 18, weight: 800, color: '#ff3b4e', track: 6, t: uo, mode: 'scramble', dur: 0.5 });
    [['呪詛師', 'ПРОКЛЯТЫЕ МАГИ', 'маги-отступники вне закона: Гэто, Кэндзяку'], ['呪霊', 'ПРОКЛЯТИЯ', 'главная угроза — от 4-го ранга до особого']].forEach(([jp, nm, ds], k) => {
      const yy = py + 120 + k * 200, uu = uo - 0.25 - k * 0.3;
      animText(c, jp, px + 30, yy, { fam: F.mincho, size: 44, weight: 800, color: '#ff6b7a', t: uu, mode: 'blur', stagger: 0.06 });
      animText(c, nm, px + 30, yy + 52, { fam: F.disp, size: 24, weight: 700, t: uu - 0.1, mode: 'mask', stagger: 0.02 });
      animPara(c, ds, px + 30, yy + 90, { size: 21, maxW: 350, t: uu - 0.25, color: '#b6a9ad' });
    });
  }
  // итог
  const cu = t - X.caption;
  if (cu >= 0) {
    const a1 = 'Власть — у кланов и старейшин.', a2 = 'Настоящая сила — у единиц.';
    font(c, F.disp, 34, 700); const w1 = c.measureText(a1).width, w2 = c.measureText(a2).width; const gap = 26;
    const x0 = 960 - (w1 + gap + w2) / 2;
    animText(c, a1, x0, 985, { fam: F.disp, size: 34, weight: 700, color: '#f4efe4', t: cu, mode: 'mask', stagger: 0.015 });
    animText(c, a2, x0 + w1 + gap, 985, { fam: F.disp, size: 34, weight: 700, color: acc, t: cu - 0.6, mode: 'mask', stagger: 0.015 });
  }
}

// ===================== 3. СИСТЕМА РАНГОВ =====================
const GRADES = [
  { jp: '四級', name: 'РАНГ 4', eq: 'деревянная бита', seg: 2, col: '#8d93a3' },
  { jp: '三級', name: 'РАНГ 3', eq: 'пистолет', seg: 4, col: '#4d8dff' },
  { jp: '二級', name: 'РАНГ 2', eq: 'дробовик', seg: 7, col: '#9b5cff' },
  { jp: '一級', name: 'РАНГ 1', eq: 'может не хватить и танка', seg: 11, col: '#ff3b4e' },
  { jp: '特級', name: 'ОСОБЫЙ', eq: 'ковровая бомбардировка', seg: 16, col: '#ffc94d' },
];
const SPECIALS = [
  { name: 'САТОРУ ГОДЗЁ', jp: '五条悟', tech: 'Безграничность · Шесть глаз', motif: 'gojo' },
  { name: 'ЮТА ОККОЦУ', jp: '乙骨憂太', tech: 'Копирование · Рика', motif: 'yuta' },
  { name: 'ЮКИ ЦУКУМО', jp: '九十九由基', tech: 'Звёздная ярость', motif: 'yuki' },
  { name: 'СУГУРУ ГЭТО', jp: '夏油傑', tech: 'Власть над проклятиями', motif: 'geto', rogue: true },
];
function emblem(c, x, y, r, motif, t, a) {
  if (a <= 0) return;
  c.save(); c.globalAlpha = clamp(a) * c.globalAlpha;
  c.beginPath(); c.arc(x, y, r, 0, TAU); c.fillStyle = 'rgba(6,5,10,0.9)'; c.fill();
  c.save(); c.clip(); c.globalCompositeOperation = 'lighter';
  if (motif === 'gojo') {
    const ph = t * 1.4, d = r * 0.42 * (0.55 + 0.45 * Math.cos(t * 0.9));
    glowDot(c, x + Math.cos(ph) * d, y + Math.sin(ph) * d, r * 0.75, '#3d7bff', 0.9);
    glowDot(c, x - Math.cos(ph) * d, y - Math.sin(ph) * d, r * 0.75, '#ff3050', 0.9);
    glowDot(c, x, y, r * (0.5 + 0.4 * (1 - d / (r * 0.42))), '#a24bff', 0.8);
    for (let i = 0; i < 3; i++) ring(c, x, y, r * (0.3 + i * 0.22) + Math.sin(t * 2 + i) * 4, 1, '#9fc0ff', 0.25);
  } else if (motif === 'yuta') {
    c.strokeStyle = '#e8e6ff'; c.lineWidth = 7; c.shadowBlur = 24; c.shadowColor = '#b7a6ff';
    c.beginPath(); c.ellipse(x, y + 8, r * 0.5, r * 0.5 * (0.35 + 0.1 * Math.sin(t * 1.3)), 0, 0, TAU); c.stroke();
    c.shadowBlur = 0;
    glowDot(c, x, y + 8 - r * 0.5 * (0.35 + 0.1 * Math.sin(t * 1.3)), r * 0.35, '#e7ddff', 0.9);
    for (let i = 0; i < 4; i++) { const k = ((t * 0.4 + i / 4) % 1); ring(c, x, y + 8, r * 0.5 * (1 + k * 0.9), 1, '#b7a6ff', (1 - k) * 0.35); }
  } else if (motif === 'yuki') {
    c.save(); c.translate(x, y); c.rotate(-0.35 + Math.sin(t * 0.6) * 0.08); c.scale(1, 0.32);
    const g = c.createRadialGradient(0, 0, r * 0.22, 0, 0, r * 0.95); g.addColorStop(0, 'rgba(255,220,150,0.95)'); g.addColorStop(0.3, 'rgba(255,150,40,0.85)'); g.addColorStop(1, 'rgba(255,60,20,0)');
    c.fillStyle = g; c.beginPath(); c.arc(0, 0, r * 0.95, 0, TAU); c.fill(); c.restore();
    glowDot(c, x, y, r * 0.55, '#ff9a3c', 0.5);
    c.globalCompositeOperation = 'source-over'; c.fillStyle = '#000'; c.beginPath(); c.arc(x, y, r * 0.26, 0, TAU); c.fill();
    c.globalCompositeOperation = 'lighter'; ring(c, x, y, r * 0.27, 2, '#ffd08a', 0.9);
  } else if (motif === 'geto') {
    c.strokeStyle = '#8a5cff'; c.lineWidth = 2.2; c.shadowBlur = 10; c.shadowColor = '#6a3cff';
    for (let arm = 0; arm < 3; arm++) {
      c.beginPath();
      for (let i = 0; i < 120; i++) { const u = i / 120; const ang = -t * 1.2 + arm * (TAU / 3) + u * 9; const rr = r * 0.95 * Math.pow(u, 1.3); const px = x + Math.cos(ang) * rr, py = y + Math.sin(ang) * rr; i ? c.lineTo(px, py) : c.moveTo(px, py); }
      c.stroke();
    }
    glowDot(c, x, y, r * 0.4, '#5b2cff', 0.8);
  }
  c.restore();
  c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 1.5; c.beginPath(); c.arc(x, y, r, 0, TAU); c.stroke();
  c.restore();
}
function sceneGrades(c, t, sc) {
  chapterCard(c, t, sc);
  const X = TT.grades;
  const u0 = t - X.bands[0];
  if (u0 < -0.3) return;
  const sOut = t - X.sorc; // переход ко второй части
  const ladderOut = Ease.inOutCubic(prog(sOut, 0, 0.8));
  if (ladderOut < 1) {
    c.save(); c.globalAlpha = 1 - ladderOut; c.translate(0, -ladderOut * 120);
    animText(c, 'ПРОКЛЯТИЯ · ШКАЛА УГРОЗЫ', 160, 205, { fam: F.mono, size: 18, weight: 700, color: sc.accent, track: 5, t: u0 + 0.3, mode: 'scramble' });
    animText(c, 'эквиваленты — по объяснениям в манге', 1760, 205, { fam: F.body, size: 20, weight: 500, color: '#8f8a9e', align: 'right', t: u0, mode: 'rise', stagger: 0.008 });
    GRADES.forEach((g, i) => {
      const u = t - X.bands[i];
      if (u < 0) return;
      const y = 730 - i * 120, x = 160, w = 1600, h = 104;
      const special = i === 4;
      const wipe = Ease.outExpo(prog(u, 0, 0.7));
      const shake = special ? Math.exp(-u * 3) * (hash(Math.floor(t * 50)) - 0.5) * 14 : 0;
      c.save(); c.translate(shake, 0);
      c.beginPath(); c.rect(x, y - 4, w * wipe + 4, h + 8); c.clip();
      const bg = c.createLinearGradient(x, 0, x + w, 0);
      bg.addColorStop(0, rgba(g.col, special ? 0.42 : 0.2)); bg.addColorStop(0.55, rgba(g.col, special ? 0.14 : 0.05)); bg.addColorStop(1, rgba(g.col, special ? 0.3 : 0.02));
      c.fillStyle = bg; c.fillRect(x, y, w, h);
      c.fillStyle = g.col; c.fillRect(x, y, 6, h);
      c.strokeStyle = rgba(g.col, 0.5); c.lineWidth = 1; c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      c.restore();
      c.save(); c.translate(shake, 0);
      animText(c, g.jp, x + 40, y + 70, { fam: F.mincho, size: 50, weight: 800, color: '#fff', t: u - 0.05, mode: 'slam', stagger: 0.06, dur: 0.35, glow: special ? 30 : 0, glowColor: g.col });
      animText(c, g.name, x + 190, y + 66, { fam: F.disp, size: 34, weight: 800, color: special ? g.col : '#f1eff6', t: u - 0.12, mode: 'mask', stagger: 0.03 });
      animText(c, 'ЭКВИВАЛЕНТ', x + 560, y + 42, { fam: F.mono, size: 14, weight: 700, color: rgba(g.col, 0.9), track: 4, t: u - 0.2, mode: 'fade' });
      animText(c, g.eq, x + 560, y + 78, { fam: F.body, size: 30, weight: 700, color: '#fff', t: u - 0.25, mode: 'rise', stagger: 0.012 });
      // шкала сегментов
      const segN = 16, sx0 = 1180, sw = 30, sg = 5;
      for (let k = 0; k < segN; k++) {
        const lit = k < g.seg && u > 0.3 + k * 0.035;
        c.fillStyle = lit ? g.col : 'rgba(255,255,255,0.07)';
        if (lit && special) { c.shadowBlur = 18; c.shadowColor = g.col; }
        c.fillRect(sx0 + k * (sw + sg), y + 38, sw, 28); c.shadowBlur = 0;
      }
      if (special && u > 0.9) {
        // сегменты «вне шкалы»
        for (let k = 0; k < 8; k++) { const fl = hash(Math.floor(t * 20) + k) > 0.3; if (fl) { c.fillStyle = rgba('#ffe7a3', 0.9 - k * 0.1); c.fillRect(sx0 + (segN + k) * (sw + sg), y + 38, sw, 28); } }
        const gt = u - 0.9;
        animText(c, 'ВНЕ ШКАЛЫ', sx0 + 4, y + 26, { fam: F.mono, size: 15, weight: 800, color: '#ffe7a3', track: 6, t: gt, mode: 'scramble', dur: 0.6 });
      }
      c.restore();
      if (special) {
        const rp = prog(u, 0, 1.2);
        for (let k = 0; k < 2; k++) ring(c, 1180 + 280, y + 52, 40 + Ease.outExpo(rp) * (500 + k * 300), 2, k ? '#fff' : g.col, (1 - rp) * 0.8);
      }
    });
    c.restore();
  }
  if (sOut < 0) return;
  // вторая часть: маги особого ранга
  const u2 = sOut - 0.3;
  animText(c, 'МАГИ · ПУТЬ ОТ 4-ГО РАНГА ДО ОСОБОГО', 960, 218, { fam: F.mono, size: 18, weight: 700, color: sc.accent, track: 5, align: 'center', t: u2, mode: 'scramble' });
  const steps = ['4', '3', 'ПОЛУ-2', '2', 'ПОЛУ-1', '1', 'ОСОБЫЙ'];
  font(c, F.disp, 18, 700);
  const sws = steps.map((s) => c.measureText(s).width + 36); const tot = sws.reduce((a, b) => a + b, 0) + 34 * (steps.length - 1);
  let sx = 960 - tot / 2;
  steps.forEach((s, k) => {
    const a = Ease.outBack(prog(u2, 0.15 + k * 0.08, 0.45));
    if (a > 0) {
      const last = k === steps.length - 1;
      c.save(); c.globalAlpha = clamp(a); c.translate(sx, 250 + (1 - a) * 16);
      rrect(c, 0, 0, sws[k], 40, 20); c.fillStyle = last ? '#ffc94d' : 'rgba(255,255,255,0.05)'; c.fill(); c.strokeStyle = last ? '#ffc94d' : 'rgba(255,255,255,0.3)'; c.lineWidth = 1; c.stroke();
      font(c, F.disp, 18, 700); c.fillStyle = last ? '#1a1204' : '#e6e3ee'; c.textAlign = 'center'; c.fillText(s, sws[k] / 2, 27);
      if (!last) { c.fillStyle = 'rgba(255,255,255,0.4)'; c.fillText('›', sws[k] + 17, 27); }
      c.restore();
    }
    sx += sws[k] + 34;
  });
  SPECIALS.forEach((sp, k) => {
    const u = t - X.specials[k];
    if (u < 0) return;
    const x = 390 + k * 380, y = 540;
    const a = Ease.outBack(prog(u, 0, 0.6));
    const cp = Ease.outCubic(prog(u, 0, 0.7));
    c.save(); c.translate(x, y); c.scale(0.6 + 0.4 * a, 0.6 + 0.4 * a); c.translate(-x, -y);
    emblem(c, x, y, 110, sp.motif, t, clamp(a * 1.4));
    c.restore();
    c.save(); c.strokeStyle = sp.rogue ? '#ff3b4e' : '#ffc94d'; c.lineWidth = 2; c.shadowBlur = 16; c.shadowColor = c.strokeStyle;
    c.beginPath(); c.arc(x, y, 124, -Math.PI / 2, -Math.PI / 2 + TAU * cp); c.stroke(); c.restore();
    animText(c, sp.name, x, 720, { fam: F.disp, size: 27, weight: 800, align: 'center', t: u - 0.15, mode: 'mask', stagger: 0.02 });
    animText(c, sp.jp, x, 760, { fam: F.mincho, size: 24, weight: 800, color: '#a9a4b8', align: 'center', track: 6, t: u - 0.25, mode: 'fade', stagger: 0.05 });
    animText(c, sp.tech, x, 800, { fam: F.body, size: 21, weight: 600, color: '#ffc94d', align: 'center', t: u - 0.35, mode: 'rise', stagger: 0.01 });
    if (sp.rogue) {
      const ra = env(u, 0.9, 0.3);
      if (ra > 0) { c.save(); c.globalAlpha = ra; c.translate(x + 80, y - 95); c.rotate(0.12); rrect(c, -62, -16, 124, 32, 4); c.fillStyle = '#ff3b4e'; c.fill(); font(c, F.mono, 14, 800); c.letterSpacing = '3px'; c.textAlign = 'center'; c.fillStyle = '#16060a'; c.fillText('ОТСТУПНИК', 0, 6); c.restore(); c.letterSpacing = '0px'; }
    }
  });
  const cu = t - X.caption;
  if (cu >= 0) animText(c, 'Четыре мага особого ранга на всю Японию — и один из них стал врагом.', 960, 960, { fam: F.body, size: 30, weight: 600, align: 'center', t: cu, mode: 'rise', stagger: 0.008 });
}

// ===================== 4. СЛАГАЕМЫЕ СИЛЫ =====================
const PILLARS = [
  { jp: '呪力', name: 'ПРОКЛЯТАЯ ЭНЕРГИЯ', desc: 'Топливо любой техники. Решают объём запаса и точность контроля.', m: 'energy' },
  { jp: '術式', name: 'ВРОЖДЁННАЯ ТЕХНИКА', desc: 'Уникальный дар, «записанный» в теле мага с рождения.', m: 'seal' },
  { jp: '領域展開', name: 'РАСШИРЕНИЕ ТЕРРИТОРИИ', desc: 'Вершина магии: личный мир, где техника бьёт без промаха.', m: 'domain' },
  { jp: '反転術式', name: 'ОБРАТНАЯ ТЕХНИКА', desc: 'Позитивная энергия лечит даже смертельные раны.', m: 'reverse' },
  { jp: '黒閃', name: 'ЧЁРНАЯ ВСПЫШКА', desc: 'Искажение пространства: сила удара — в степени 2,5.', m: 'flash' },
  { jp: '縛り', name: 'ОБЕТЫ И ОГРАНИЧЕНИЯ', desc: 'Цена за силу: отказавшись от чего-то, получаешь больше.', m: 'vow' },
];
function pillarMotif(c, m, x, y, t, a, acc) {
  c.save(); c.globalAlpha = a; c.strokeStyle = acc; c.fillStyle = acc; c.lineWidth = 1.6; c.shadowBlur = 12; c.shadowColor = acc;
  if (m === 'energy') {
    for (let k = 0; k < 4; k++) { c.beginPath(); for (let i = 0; i <= 60; i++) { const u = i / 60; const px = x - 90 + u * 180, py = y + Math.sin(u * 9 + t * 3 + k * 0.9) * (18 + k * 7) * Math.sin(u * Math.PI); i ? c.lineTo(px, py) : c.moveTo(px, py); } c.globalAlpha = a * (1 - k * 0.2); c.stroke(); }
  } else if (m === 'seal') {
    ring(c, x, y, 72, 1.5, acc, a); ring(c, x, y, 58, 1, acc, a * 0.6);
    for (let i = 0; i < 24; i++) { const ang = (i / 24) * TAU + t * 0.4; c.beginPath(); c.moveTo(x + Math.cos(ang) * 60, y + Math.sin(ang) * 60); c.lineTo(x + Math.cos(ang) * (i % 3 ? 66 : 72), y + Math.sin(ang) * (i % 3 ? 66 : 72)); c.stroke(); }
    for (const [n, dir] of [[3, 1], [4, -1]]) { c.beginPath(); for (let i = 0; i <= n; i++) { const ang = (i / n) * TAU + t * 0.8 * dir; const px = x + Math.cos(ang) * 50, py = y + Math.sin(ang) * 50; i ? c.lineTo(px, py) : c.moveTo(px, py); } c.stroke(); }
  } else if (m === 'domain') {
    for (let k = 0; k < 5; k++) { const q = ((t * 0.5 + k / 5) % 1); const s = 10 + q * 90; c.globalAlpha = a * (1 - q); c.strokeRect(x - s, y - s * 0.62, s * 2, s * 1.24); }
    c.globalAlpha = a; glowDot(c, x, y, 26, acc, 0.9);
  } else if (m === 'reverse') {
    c.lineWidth = 3;
    for (const d of [0, Math.PI]) { const a0 = t * 1.5 + d; c.beginPath(); c.arc(x, y, 60, a0, a0 + 2.3); c.stroke(); const ex = x + Math.cos(a0 + 2.3) * 60, ey = y + Math.sin(a0 + 2.3) * 60, ta = a0 + 2.3 + Math.PI / 2; c.beginPath(); c.moveTo(ex + Math.cos(ta) * 12, ey + Math.sin(ta) * 12); c.lineTo(ex + Math.cos(ta + 2.4) * 12, ey + Math.sin(ta + 2.4) * 12); c.lineTo(ex + Math.cos(ta - 2.4) * 12, ey + Math.sin(ta - 2.4) * 12); c.fill(); }
    c.fillRect(x - 4, y - 18, 8, 36); c.fillRect(x - 18, y - 4, 36, 8);
  } else if (m === 'flash') {
    const seed = Math.floor(t * 8);
    for (let k = 0; k < 2; k++) {
      c.beginPath(); let px = x - 90, py = y + (hash(seed + k) - 0.5) * 30; c.moveTo(px, py);
      for (let i = 1; i <= 9; i++) { px = x - 90 + i * 20; py = y + (hash(seed * 3 + i + k * 17) - 0.5) * 80; c.lineTo(px, py); }
      c.lineWidth = k ? 1.5 : 7; c.strokeStyle = k ? acc : '#050505'; c.shadowColor = '#ff2e4d'; c.shadowBlur = k ? 12 : 24; c.stroke();
    }
    for (let i = 0; i < 6; i++) spark(c, x - 80 + hash(seed + i * 5) * 160, y + (hash(seed + i * 9) - 0.5) * 90, 10, '#ff2e4d', 0.8 * a);
  } else if (m === 'vow') {
    c.lineWidth = 5;
    for (let k = 0; k < 3; k++) { const px = x - 60 + k * 60, rot = Math.sin(t * 1.2 + k) * 0.25; c.save(); c.translate(px, y); c.rotate(rot + (k % 2 ? Math.PI / 2 : 0)); c.beginPath(); c.ellipse(0, 0, 38, 20, 0, 0, TAU); c.stroke(); c.restore(); }
  }
  c.restore();
}
function scenePillars(c, t, sc) {
  chapterCard(c, t, sc);
  const X = TT.pillars; const acc = sc.accent;
  if (t < X.cards[0]) return;
  const cw = 500, ch = 290, gap = 40, x0 = 170, ys = [215, 545];
  PILLARS.forEach((p, i) => {
    const u = t - X.cards[i];
    if (u < 0) return;
    const x = x0 + (i % 3) * (cw + gap), y = ys[Math.floor(i / 3)];
    const next = X.cards[i + 1] ?? X.caption;
    const active = t < next ? 1 : 0;
    const act = Math.max(active * env(u, 0, 0.3), 0) + (t >= X.caption ? 0.5 + 0.5 * Math.sin((t - X.caption) * 4 - i * 0.7) : 0) * 0.6;
    const a = Ease.outCubic(prog(u, 0, 0.5));
    const lift = (1 - Ease.outBack(prog(u, 0, 0.6))) * 40;
    c.save(); c.translate(0, lift); c.globalAlpha = a;
    rrect(c, x, y, cw, ch, 10); c.fillStyle = `rgba(14,18,28,${0.75})`; c.fill();
    const gg = c.createLinearGradient(x, y, x + cw, y + ch); gg.addColorStop(0, rgba(acc, 0.1 + act * 0.12)); gg.addColorStop(1, rgba(acc, 0)); c.fillStyle = gg; c.fill();
    c.restore();
    c.save(); c.translate(0, lift);
    if (act > 0.05) { c.shadowBlur = 30 * act; c.shadowColor = acc; }
    strokeRectP(c, x, y, cw, ch, Ease.outCubic(prog(u, 0, 0.8)), rgba(acc, 0.35 + act * 0.6), 1.5, 10);
    c.restore();
    c.save(); c.translate(0, lift);
    c.save(); c.translate(x + cw - 105, y + 92); c.scale(0.74, 0.74);
    pillarMotif(c, p.m, 0, 0, t, env(u, 0.2, 0.6) * (0.55 + act * 0.45), acc);
    c.restore();
    animText(c, pad2(i + 1), x + 30, y + 46, { fam: F.mono, size: 18, weight: 700, color: acc, track: 3, t: u - 0.1, mode: 'scramble' });
    const js = p.jp.length > 2 ? 44 : 56;
    animText(c, p.jp, x + 28, y + 118, { fam: F.mincho, size: js, weight: 800, color: '#fff', t: u - 0.1, mode: 'blur', stagger: 0.06, dur: 0.5 });
    const ns = fitSize(c, p.name, F.disp, 25, 700, cw - 60);
    animText(c, p.name, x + 30, y + 178, { fam: F.disp, size: ns, weight: 700, t: u - 0.2, mode: 'mask', stagger: 0.015 });
    animPara(c, p.desc, x + 30, y + 218, { size: 21, maxW: cw - 60, t: u - 0.35, color: '#aeb3c2', lh: 1.35 });
    c.restore();
  });
  const cu = t - X.caption;
  if (cu >= 0) {
    const a1 = 'У сильнейших', a2 = 'работают все шесть рычагов сразу.';
    font(c, F.disp, 34, 700); const w1 = c.measureText(a1).width, w2 = c.measureText(a2).width;
    const x0b = 960 - (w1 + 22 + w2) / 2;
    animText(c, a1, x0b, 960, { fam: F.disp, size: 34, weight: 700, color: acc, t: cu, mode: 'mask', stagger: 0.02 });
    animText(c, a2, x0b + w1 + 22, 960, { fam: F.disp, size: 34, weight: 700, t: cu - 0.3, mode: 'mask', stagger: 0.015 });
  }
}

// ===================== 5. РЕЙТИНГ СИЛЫ =====================
const TIERC = { 'S+': '#ffcc4d', S: '#ff4a3d', 'A+': '#b06bff', A: '#4d9bff' };
const RANK = [
  { name: 'РЁМЭН СУКУНА', jp: '両面宿儺', v: 100, tier: 'S+' },
  { name: 'САТОРУ ГОДЗЁ', jp: '五条悟', v: 98, tier: 'S+' },
  { name: 'ЮТА ОККОЦУ', jp: '乙骨憂太', v: 91, tier: 'S' },
  { name: 'КЭНДЗЯКУ', jp: '羂索', v: 90, tier: 'S' },
  { name: 'ЮДЗИ ИТАДОРИ', jp: '虎杖悠仁', v: 89, tier: 'S', note: 'финал' },
  { name: 'ЮКИ ЦУКУМО', jp: '九十九由基', v: 86, tier: 'S' },
  { name: 'МАКИ ДЗЭНИН', jp: '禅院真希', v: 84, tier: 'A+' },
  { name: 'ТОДЗИ ФУСИГУРО', jp: '伏黒甚爾', v: 84, tier: 'A+' },
  { name: 'ХАДЗИМЭ КАСИМО', jp: '鹿紫雲一', v: 83, tier: 'A+' },
  { name: 'КИНЗИ ХАКАРИ', jp: '秤金次', v: 82, tier: 'A+' },
  { name: 'ХИРОМИ ХИГУРУМА', jp: '日車寛見', v: 78, tier: 'A' },
  { name: 'ТЁСО', jp: '脹相', v: 76, tier: 'A' },
];
const RADAR_AX = ['ЭНЕРГИЯ', 'ТЕХНИКА', 'ЗАЩИТА', 'ТЕРРИТОРИЯ', 'ТЕЛО', 'ОПЫТ'];
const GOJO = { color: '#3d8bff', values: [10, 10, 10, 10, 8, 7] };
const SUKUNA = { color: '#ff3b3b', values: [10, 10, 8, 10, 9, 10] };
const VS_L = ['Шесть глаз + Безграничность', 'Территория: «Необъятная бездна»', 'Приём: «Пустотный фиолетовый»', 'Бесконечность — его не коснуться'];
const VS_R = ['Святилище: Расщепление и Рассечение', 'Территория: «Злобное святилище»', 'Божественное пламя', 'Тысяча лет опыта · 20 пальцев'];

function sceneRanking(c, t, sc) {
  chapterCard(c, t, sc);
  const X = TT.rank;
  const u0 = t - X.rows[0];
  const vs = t - X.vs;
  if (u0 < -0.3) return;
  // --- таблица ---
  if (vs < 0.25) {
    const ta = 1 - prog(vs, -0.05, 0.25);
    c.save(); c.globalAlpha = ta;
    animText(c, 'ИНДЕКС СИЛЫ · 0–100', 170, 172, { fam: F.mono, size: 18, weight: 700, color: sc.accent, track: 5, t: u0 + 0.4, mode: 'scramble' });
    animText(c, 'пиковая форма по событиям манги · субъективная оценка', 1750, 172, { fam: F.body, size: 20, weight: 500, color: '#8f8a9e', align: 'right', t: u0 + 0.2, mode: 'rise', stagger: 0.006 });
    // легенда тиров
    RANK.forEach((r, i) => {
      const k = RANK.length - 1 - i; // порядок появления (снизу)
      const u = t - X.rows[k];
      if (u < 0) return;
      const y = 212 + i * 63;
      const a = Ease.outCubic(prog(u, 0, 0.4));
      const col = TIERC[r.tier];
      const top = i < 2;
      c.save(); c.globalAlpha = a; c.translate((1 - a) * -40, 0);
      if (top) { const gl = c.createLinearGradient(160, 0, 1760, 0); gl.addColorStop(0, rgba(col, 0.16)); gl.addColorStop(1, rgba(col, 0)); c.fillStyle = gl; c.fillRect(160, y, 1600, 56); }
      else { c.fillStyle = i % 2 ? 'rgba(255,255,255,0.018)' : 'rgba(255,255,255,0.035)'; c.fillRect(160, y, 1600, 56); }
      font(c, F.mono, 22, 700); c.fillStyle = top ? col : '#77727f'; c.fillText(`#${pad2(i + 1)}`, 180, y + 37);
      font(c, F.disp, 23, 700); c.fillStyle = '#fff'; c.fillText(r.name, 262, y + 37);
      const nw = c.measureText(r.name).width;
      font(c, F.mincho, 19, 800); c.fillStyle = '#8d889a'; c.fillText(r.jp, 262 + nw + 16, y + 36);
      if (r.note) { const jw = c.measureText(r.jp).width; font(c, F.mono, 13, 700); c.fillStyle = rgba(col, 0.9); c.fillText(`(${r.note.toUpperCase()})`, 262 + nw + 16 + jw + 12, y + 35); }
      // бейдж тира
      rrect(c, 830, y + 13, 58, 30, 5); c.fillStyle = col; c.fill();
      font(c, F.disp, 16, 800); c.fillStyle = '#12090a'; c.textAlign = 'center'; c.fillText(r.tier, 859, y + 34); c.textAlign = 'left';
      // полоса
      const bp = Ease.outExpo(prog(u, 0.08, 1.0));
      c.fillStyle = 'rgba(255,255,255,0.05)'; c.fillRect(910, y + 20, 760, 16);
      const bw = 760 * (r.v / 100) * bp;
      const bg = c.createLinearGradient(910, 0, 910 + bw, 0); bg.addColorStop(0, rgba(col, 0.35)); bg.addColorStop(1, col);
      c.fillStyle = bg; if (top) { c.shadowBlur = 22; c.shadowColor = col; } c.fillRect(910, y + 20, bw, 16); c.shadowBlur = 0;
      c.fillStyle = '#fff'; c.fillRect(910 + bw - 3, y + 16, 3, 24);
      font(c, F.mono, 22, 800); c.fillStyle = top ? col : '#e7e4ee'; c.fillText(String(countUp(r.v, prog(u, 0.08, 1.0))), 1690, y + 37);
      c.restore();
      if (top && u > 0) { c.save(); c.globalCompositeOperation = 'lighter'; for (let s = 0; s < 6; s++) { const q = ((t * 0.7 + s / 6) % 1); spark(c, 910 + bw * bp - q * 200, y + 28 + Math.sin(q * 20 + s) * 10, 12, col, (1 - q) * 0.7 * a); } c.restore(); }
    });
    c.restore();
  }
  if (vs < 0) return;
  // --- ГОДЗЁ vs СУКУНА ---
  const verdict = t - X.verdict;
  const enter = Ease.outExpo(prog(vs, 0, 0.7));
  const red = Ease.inOutExpo(prog(verdict, 0, 0.6)); // красная сторона поглощает экран
  const dx0 = 1060, dx1 = 860; // диагональ
  const shiftL = -(1 - enter) * 900, shiftR = (1 - enter) * 900;
  const redShift = red * -1400;
  // панели
  c.save();
  c.beginPath(); c.moveTo(0, 0); c.lineTo(dx0 + redShift, 0); c.lineTo(dx1 + redShift, H); c.lineTo(0, H); c.closePath(); c.translate(shiftL, 0);
  const gl = c.createLinearGradient(0, 0, 1000, 0); gl.addColorStop(0, 'rgba(20,50,140,0.55)'); gl.addColorStop(1, 'rgba(20,50,140,0.08)'); c.fillStyle = gl; c.fill();
  c.restore();
  c.save();
  c.beginPath(); c.moveTo(dx0 + redShift, 0); c.lineTo(W, 0); c.lineTo(W, H); c.lineTo(dx1 + redShift, H); c.closePath(); c.translate(shiftR, 0);
  const gr = c.createLinearGradient(W, 0, 900, 0); gr.addColorStop(0, 'rgba(150,15,20,0.6)'); gr.addColorStop(1, 'rgba(150,15,20,0.1)'); c.fillStyle = gr; c.fill();
  c.restore();
  // диагональ
  const la = enter * (1 - prog(verdict, 0.4, 0.4));
  if (la > 0) {
    const jit = verdict > -1.5 && verdict < 0 ? (hash(Math.floor(t * 30)) - 0.5) * 10 * prog(verdict, -1.5, 1.5) : 0;
    c.save(); c.globalCompositeOperation = 'lighter'; c.strokeStyle = rgba('#ffffff', 0.9 * la); c.lineWidth = 3; c.shadowBlur = 30; c.shadowColor = '#fff';
    c.beginPath(); c.moveTo(dx0 + redShift + jit, -10); c.lineTo(dx1 + redShift - jit, H + 10); c.stroke(); c.restore();
  }
  const pa = 1 - prog(verdict, -0.05, 0.3); // контент дуэли
  if (pa > 0) {
    c.save(); c.globalAlpha = pa;
    // фоновые иероглифы
    c.save(); c.globalAlpha = pa * 0.13 * enter; font(c, F.brush, 190); c.fillStyle = '#9cc0ff'; c.textAlign = 'left'; c.fillText('五条悟', 80 + shiftL, 1000); c.fillStyle = '#ff8a8a'; c.textAlign = 'right'; c.fillText('両面宿儺', 1860 + shiftR, 1000); c.restore();
    // имена
    animText(c, 'СИЛЬНЕЙШИЙ СОВРЕМЕННОСТИ', 140, 250, { fam: F.mono, size: 17, weight: 700, color: '#6fa8ff', track: 4, t: vs - 0.2, mode: 'scramble' });
    animText(c, 'САТОРУ', 136, 330, { fam: F.disp, size: 64, weight: 800, t: vs - 0.1, mode: 'mask', stagger: 0.03 });
    animText(c, 'ГОДЗЁ', 136, 402, { fam: F.disp, size: 64, weight: 800, color: '#8fb8ff', t: vs - 0.2, mode: 'mask', stagger: 0.03 });
    animText(c, 'СИЛЬНЕЙШИЙ В ИСТОРИИ', 1780, 250, { fam: F.mono, size: 17, weight: 700, color: '#ff6f6f', track: 4, align: 'right', t: vs - 0.2, mode: 'scramble' });
    animText(c, 'РЁМЭН', 1784, 330, { fam: F.disp, size: 64, weight: 800, align: 'right', t: vs - 0.1, mode: 'mask', stagger: 0.03 });
    animText(c, 'СУКУНА', 1784, 402, { fam: F.disp, size: 64, weight: 800, color: '#ff8f8f', align: 'right', t: vs - 0.2, mode: 'mask', stagger: 0.03 });
    // VS
    const rv = t - X.radar;
    const vm = Ease.inOutCubic(prog(rv, -0.3, 0.7));
    const vsz = lerp(200, 70, vm), vy = lerp(600, 190, vm);
    const vp = prog(vs, 0, 0.35);
    c.save(); c.translate(960, vy); const vsS = 1 + (1 - Ease.outExpo(vp)) * 1.5; c.scale(vsS, vsS);
    c.globalAlpha = pa * clamp(vp * 3); font(c, F.impact, vsz); c.textAlign = 'center'; c.textBaseline = 'middle';
    c.shadowBlur = 40; c.shadowColor = '#ff2e4d'; c.fillStyle = '#fff'; c.fillText('VS', 0, 0); c.restore();
    // радар
    if (rv >= 0) {
      radar(c, 960, 610, 190, RADAR_AX, [Object.assign({ delay: 0.5 }, GOJO), Object.assign({ delay: 0.8 }, SUKUNA)], rv);
    }
    // характеристики
    X.stats.forEach((st, i) => {
      const u = t - st;
      if (u < 0) return;
      const y = 520 + i * 92;
      c.fillStyle = rgba('#3d8bff', env(u, 0, 0.3)); c.fillRect(140, y - 22, 3, 30);
      animPara(c, VS_L[i], 158, y, { size: 22, weight: 600, maxW: 420, color: '#dfe8ff', t: u });
      c.fillStyle = rgba('#ff3b3b', env(u, 0.1, 0.3)); c.fillRect(1777, y - 22, 3, 30);
      animPara(c, VS_R[i], 1762, y, { size: 22, weight: 600, maxW: 420, color: '#ffdede', t: u - 0.1, align: 'right' });
    });
    c.restore();
  }
  // вердикт
  if (verdict >= 0) {
    const c1 = t - X.cap1;
    const up = Ease.inOutCubic(prog(c1, 0, 0.6));
    c.save(); c.translate(0, -up * 150); c.globalAlpha = 1 - up * 0.68;
    animText(c, 'ГЛАВА 236', 960, 400, { fam: F.mono, size: 20, weight: 700, color: '#ffb3b3', track: 8, align: 'center', t: verdict - 0.2, mode: 'scramble' });
    animText(c, 'ПОБЕДА СУКУНЫ', 960, 500, { fam: F.disp, size: 84, weight: 900, align: 'center', t: verdict - 0.05, mode: 'slam', stagger: 0.035, dur: 0.35, glow: 30, glowColor: '#ff2e2e' });
    animText(c, 'Разрез, рассекающий сам мир, прошёл сквозь Бесконечность.', 960, 570, { fam: F.body, size: 30, weight: 600, color: '#ffe1e1', align: 'center', t: verdict - 0.6, mode: 'rise', stagger: 0.008 });
    c.restore();
    // разрез
    const sp = Ease.outExpo(prog(verdict, -0.05, 0.4));
    if (sp > 0 && verdict < 1.2) { c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = 1 - prog(verdict, 0.3, 0.8); c.strokeStyle = '#fff'; c.lineWidth = 3; c.shadowBlur = 30; c.shadowColor = '#ff2e4d'; c.beginPath(); c.moveTo(-50, 780 + 50); c.lineTo(-50 + sp * 2100, 780 - sp * 520); c.stroke(); c.restore(); }
    if (c1 >= 0) {
      animText(c, 'Но финал решила не одиночная сила.', 960, 560, { fam: F.disp, size: 44, weight: 700, align: 'center', t: c1 - 0.3, mode: 'mask', stagger: 0.018 });
      const c2 = t - X.cap2;
      if (c2 >= 0) {
        const s1 = 'Короля проклятий одолели ', s2 = 'Юдзи и все, кто остался рядом.';
        font(c, F.body, 34, 600); const w1 = c.measureText(s1).width, w2 = c.measureText(s2).width; const xx = 960 - (w1 + w2) / 2;
        animText(c, s1, xx, 640, { fam: F.body, size: 34, weight: 600, color: '#d8d3e3', t: c2, mode: 'rise', stagger: 0.012 });
        animText(c, s2, xx + w1, 640, { fam: F.body, size: 34, weight: 800, color: '#2fe0b0', t: c2 - 0.3, mode: 'rise', stagger: 0.012 });
      }
    }
  }
}

// ===================== 6. ПОТЕНЦИАЛ =====================
const SCATTER = [
  { n: 'СУКУНА', p: 100, g: 8, side: 'r' }, { n: 'ГОДЗЁ', p: 97.5, g: 13, side: 'l' }, { n: 'КЭНДЗЯКУ', p: 90, g: 9, side: 'l' },
  { n: 'ЮТА', p: 91, g: 70, side: 'r' }, { n: 'ЮДЗИ', p: 89, g: 95, side: 'r', id: 0 }, { n: 'МАКИ', p: 84, g: 36, side: 'r' },
  { n: 'ХАКАРИ', p: 82, g: 80, side: 'r', id: 2 }, { n: 'ХИГУРУМА', p: 78, g: 83, side: 'l', id: 3 }, { n: 'ТЁСО', p: 76, g: 30, side: 'l' },
  { n: 'ТОДО', p: 74, g: 50, side: 'l' }, { n: 'МЭГУМИ', p: 72, g: 90, side: 'l', id: 1 }, { n: 'НОБАРА', p: 60, g: 64, side: 'r' },
];
const CALLOUTS = [
  { name: 'ЮДЗИ ИТАДОРИ', jp: '虎杖悠仁', pot: 95, pts: ['Тело, созданное как сосуд для Сукуны', 'Техника Святилища отпечаталась в нём', 'Серии Чёрных вспышек и своя территория'] },
  { name: 'МЭГУМИ ФУСИГУРО', jp: '伏黒恵', pot: 90, pts: ['Десять теней — ровня Шести глазам', 'Махорага адаптируется к чему угодно', 'Сукуна выбрал его тело не случайно'] },
  { name: 'КИНЗИ ХАКАРИ', jp: '秤金次', pot: 85, pts: ['Джекпот: бессмертие на 4 мин 11 с', 'Годзё считал, что Хакари может его превзойти'] },
  { name: 'ХИРОМИ ХИГУРУМА', jp: '日車寛見', pot: 88, pts: ['Пробудился как маг уже взрослым', 'Освоил территорию меньше чем за 12 дней', 'Чистый талант без клана и школы'] },
];
const PX = (p) => 200 + ((p - 55) / 47) * 880, PY = (g) => 880 - (g / 100) * 640;
function scenePotential(c, t, sc) {
  chapterCard(c, t, sc);
  const X = TT.pot; const acc = sc.accent;
  const ua = t - X.axes;
  if (ua < 0) return;
  // оси
  const ap = Ease.outExpo(prog(ua, 0, 1.0));
  lineP(c, 200, 880, 1090, 880, ap, 'rgba(255,255,255,0.55)', 1.5);
  lineP(c, 200, 880, 200, 225, ap, 'rgba(255,255,255,0.55)', 1.5);
  for (let k = 1; k <= 4; k++) { c.save(); c.globalAlpha = ap * 0.07; c.strokeStyle = '#fff'; c.beginPath(); c.moveTo(200, 880 - k * 160); c.lineTo(1090, 880 - k * 160); c.moveTo(200 + k * 220, 880); c.lineTo(200 + k * 220, 240); c.stroke(); c.restore(); }
  animText(c, 'ТЕКУЩАЯ СИЛА →', 1090, 925, { fam: F.mono, size: 16, weight: 700, color: '#bdb8c9', track: 4, align: 'right', t: ua - 0.3, mode: 'scramble' });
  animText(c, '↑ ПОТЕНЦИАЛ РОСТА', 200, 205, { fam: F.mono, size: 16, weight: 700, color: '#bdb8c9', track: 4, t: ua - 0.3, mode: 'scramble' });
  // зоны
  const uz = t - X.zone;
  if (uz >= 0) {
    const zp = Ease.outCubic(prog(uz, 0, 0.8));
    c.save(); c.globalAlpha = zp;
    c.fillStyle = rgba(acc, 0.07 + 0.03 * Math.sin(t * 3)); c.fillRect(470, 240, 610, 290);
    c.setLineDash([6, 6]); strokeRectP(c, 470, 240, 610, 290, zp, rgba(acc, 0.8), 1.2); c.setLineDash([]);
    c.fillStyle = 'rgba(255,59,78,0.07)'; c.fillRect(820, 760, 260, 118);
    c.restore();
    animText(c, 'ЗОНА РОСТА', 486, 268, { fam: F.mono, size: 16, weight: 800, color: acc, track: 5, t: uz, mode: 'scramble' });
    animText(c, 'ПИК ДОСТИГНУТ', 1072, 752, { fam: F.mono, size: 14, weight: 800, color: '#ff6b78', track: 4, align: 'right', t: uz - 0.3, mode: 'scramble' });
  }
  // точки
  const cur = X.callouts.reduce((k, ct, i) => (t >= ct ? i : k), -1);
  SCATTER.forEach((d, i) => {
    const u = t - X.dots[i];
    if (u < 0) return;
    const x = PX(d.p), y = PY(d.g);
    const col = d.g >= 70 ? acc : d.g <= 40 ? '#ff4a5a' : '#b3a6ff';
    const pp = Ease.outBack(prog(u, 0, 0.5));
    const fx = lerp(x, x, pp), fy = lerp(y + 60, y, Ease.outExpo(prog(u, 0, 0.6)));
    const focus = d.id !== undefined && d.id === cur;
    c.save(); c.globalCompositeOperation = 'lighter'; spark(c, fx, fy, 28 + (focus ? 20 : 0), col, clamp(pp) * 0.9); c.restore();
    c.fillStyle = '#fff'; c.beginPath(); c.arc(fx, fy, 5 * clamp(pp), 0, TAU); c.fill();
    if (focus) { const q = ((t - X.callouts[cur]) * 1.2) % 1; ring(c, fx, fy, 10 + q * 40, 2, col, 1 - q); }
    animText(c, d.n, fx + (d.side === 'r' ? 16 : -16), fy + 6, { fam: F.mono, size: 16, weight: 700, color: focus ? '#fff' : rgba(col, 0.95), track: 2, align: d.side === 'r' ? 'left' : 'right', t: u - 0.15, mode: 'scramble', dur: 0.35 });
  });
  // правая панель
  const PXL = 1220;
  const firstC = t - X.callouts[0];
  if (firstC < 0.3) {
    const out = firstC >= 0 ? firstC : -1;
    animText(c, 'ЧТО ТАКОЕ ПОТЕНЦИАЛ', PXL, 300, { fam: F.mono, size: 18, weight: 700, color: acc, track: 5, t: ua - 0.4, mode: 'scramble', out });
    animPara(c, 'Запас роста: нераскрытые грани техники, талант и скорость прогресса.', PXL, 370, { size: 34, weight: 700, color: '#fff', maxW: 540, t: ua - 0.6, out, lh: 1.3 });
    if (uz >= 0) animPara(c, 'Сукуна и Годзё уже на пике. Самое интересное — в зоне роста.', PXL, 600, { size: 26, color: '#b9b4c6', maxW: 520, t: uz - 0.3, out });
  }
  if (cur >= 0) {
    for (let k = Math.max(0, cur - 1); k <= cur; k++) {
      const cc = CALLOUTS[k]; const u = t - X.callouts[k];
      const outU = k < cur ? t - X.callouts[cur] : -1;
      if (outU > 0.5) continue;
      const a = Ease.outCubic(prog(u, 0, 0.45)) * (outU >= 0 ? 1 - Ease.inCubic(prog(outU, 0, 0.35)) : 1);
      const yo = (1 - Ease.outExpo(prog(u, 0, 0.6))) * 40 - (outU >= 0 ? Ease.inCubic(prog(outU, 0, 0.35)) * 40 : 0);
      const bx = PXL - 30, by = 250 + yo, bw = 600, bh = 250 + cc.pts.length * 80;
      c.save(); c.globalAlpha = a;
      rrect(c, bx, by, bw, bh, 12); c.fillStyle = 'rgba(8,24,22,0.72)'; c.fill();
      c.restore();
      c.save(); c.globalAlpha = a; strokeRectP(c, bx, by, bw, bh, Ease.outCubic(prog(u, 0, 0.7)), rgba(acc, 0.7), 1.5, 12); c.restore();
      // соединитель к точке
      const d = SCATTER.find((s) => s.id === k);
      if (d && outU < 0) { const lp = Ease.outCubic(prog(u, 0.1, 0.5)); c.save(); c.setLineDash([4, 6]); lineP(c, PX(d.p), PY(d.g), bx, by + 60, lp, rgba(acc, 0.6), 1.2); c.restore(); }
      c.save(); c.globalAlpha = a; c.translate(0, yo);
      animText(c, `ПОТЕНЦИАЛ #${k + 1}`, PXL, 300, { fam: F.mono, size: 16, weight: 700, color: acc, track: 5, t: u, mode: 'scramble' });
      const ns = fitSize(c, cc.name, F.disp, 40, 800, 540);
      animText(c, cc.name, PXL, 362, { fam: F.disp, size: ns, weight: 800, t: u - 0.05, mode: 'mask', stagger: 0.02 });
      animText(c, cc.jp, PXL, 408, { fam: F.mincho, size: 26, weight: 800, color: '#9fd9c8', track: 8, t: u - 0.15, mode: 'fade', stagger: 0.05 });
      // шкала потенциала
      const mp = Ease.outExpo(prog(u, 0.2, 1.0));
      c.fillStyle = 'rgba(255,255,255,0.07)'; c.fillRect(PXL, 440, 440, 12);
      const mg = c.createLinearGradient(PXL, 0, PXL + 440, 0); mg.addColorStop(0, rgba(acc, 0.3)); mg.addColorStop(1, acc);
      c.fillStyle = mg; c.shadowBlur = 16; c.shadowColor = acc; c.fillRect(PXL, 440, 440 * (cc.pot / 100) * mp, 12); c.shadowBlur = 0;
      font(c, F.mono, 26, 800); c.fillStyle = acc; c.fillText(`${countUp(cc.pot, prog(u, 0.2, 1.0))}%`, PXL + 456, 455);
      cc.pts.forEach((p, j) => {
        const uu = u - 0.35 - j * 0.18;
        c.fillStyle = rgba(acc, env(uu, 0, 0.3)); c.fillRect(PXL, 510 + j * 72 - 16, 8, 8);
        animPara(c, p, PXL + 24, 510 + j * 72, { size: 24, weight: 600, color: '#e6f2ee', maxW: 500, t: uu, lh: 1.25 });
      });
      c.restore();
    }
  }
}

// ===================== 7. ФИНАЛ =====================
const OUTRO = [
  ['ИЕРАРХИЯ', 'решает, кто отдаёт приказы.', '#e8b04a'],
  ['СИЛА', 'решает, кто выживет.', '#ff3b4e'],
  ['ПОТЕНЦИАЛ', 'решает, кто изменит мир.', '#2fe0b0'],
];
function sceneOutro(c, t) {
  const X = TT.outro;
  const ui = t - X.impact;
  const vis = X.lines.reduce((n, lt) => n + (t >= lt ? 1 : 0), 0);
  const la = 1 - Ease.inCubic(prog(ui, -0.1, 0.35));
  if (la > 0) {
    OUTRO.forEach(([kw, rest, col], i) => {
      const u = t - X.lines[i];
      if (u < 0) return;
      // позиция: новая строка по центру, предыдущие уезжают вверх
      let y = 560;
      for (let j = i + 1; j < vis; j++) y -= 120 * Ease.inOutCubic(prog(t, X.lines[j], 0.6));
      font(c, F.disp, 60, 800); const w1 = c.measureText(kw).width;
      font(c, F.body, 44, 600); const w2 = c.measureText(rest).width;
      const x0 = 960 - (w1 + 26 + w2) / 2;
      const aa = la * (i < vis - 1 ? lerp(1, 0.4, Ease.inOutCubic(prog(t, X.lines[i + 1], 0.6))) : 1);
      animText(c, kw, x0, y, { fam: F.disp, size: 60, weight: 800, color: col, t: u, mode: 'slam', stagger: 0.035, dur: 0.3, glow: 24, glowColor: col, alpha: aa });
      animText(c, rest, x0 + w1 + 26, y, { fam: F.body, size: 44, weight: 600, color: '#f1eef6', t: u - 0.3, mode: 'rise', stagger: 0.015, alpha: aa });
    });
  }
  if (ui < 0) return;
  const cx = 960, cy = 450;
  inkBlot(c, cx, cy, 330, Ease.outExpo(prog(ui, 0, 1.1)), 29, '#a0001a', 0.92);
  for (let k = 0; k < 3; k++) { const rp = prog(ui, k * 0.08, 1.6); if (rp > 0) ring(c, cx, cy, 100 + Ease.outExpo(rp) * (800 + k * 300), 3 - k, k ? '#fff' : '#ff2e4d', (1 - rp) * 0.9); }
  c.save(); c.translate(cx, cy); const s = 1 + (1 - Ease.outExpo(prog(ui, 0, 0.8))) * 0.3; c.scale(s, s);
  font(c, F.brush, 210); c.textAlign = 'center'; c.textBaseline = 'middle'; c.letterSpacing = '16px';
  c.globalAlpha = clamp(ui * 4); c.shadowBlur = 30; c.shadowColor = 'rgba(0,0,0,0.9)'; c.fillStyle = '#fff'; c.fillText('呪術廻戦', 8, 6);
  c.restore(); c.letterSpacing = '0px';
  animText(c, 'JUJUTSU KAISEN', cx, 680, { fam: F.disp, size: 46, weight: 800, track: 18, align: 'center', t: ui - 0.35, mode: 'mask', stagger: 0.03 });
  animText(c, 'ИЕРАРХИЯ · СИЛА · ПОТЕНЦИАЛ', cx, 740, { fam: F.mono, size: 20, weight: 700, color: '#ffe3e7', track: 8, align: 'center', t: ui - 0.6, mode: 'scramble' });
  animText(c, 'По манге Гэгэ Акутами (2018–2024). Оценки силы — авторский анализ.', cx, 980, { fam: F.body, size: 20, weight: 500, color: '#8a8597', align: 'center', t: ui - 0.9, mode: 'rise', stagger: 0.005 });
}

const SCENES = {
  intro: sceneIntro, world: sceneWorld, hierarchy: sceneHierarchy, grades: sceneGrades,
  pillars: scenePillars, ranking: sceneRanking, potential: scenePotential, outro: sceneOutro,
};
