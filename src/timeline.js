// Общий таймлайн: его читают и визуальный движок (браузер), и синтезатор звука (Python).
// Темп 96 BPM → доля 0.625 c, такт 2.5 c. Все ключевые события стоят на сетке тактов/долей,
// поэтому удары, переходы и музыка совпадают по времени.
(function (root) {
  const BPM = 96;
  const BEAT = 60 / BPM; // 0.625
  const BAR = BEAT * 4; // 2.5

  const scenes = [
    { id: 'intro', start: 0, end: 10, num: '序', idx: 0, title: 'ВСТУПЛЕНИЕ', accent: '#ff2e4d' },
    { id: 'world', start: 10, end: 25, num: '壱', idx: 1, title: 'МИР ПРОКЛЯТИЙ', sub: 'откуда берётся сила', accent: '#8b6cff' },
    { id: 'hierarchy', start: 25, end: 45, num: '弐', idx: 2, title: 'ИЕРАРХИЯ', sub: 'кто правит миром магов', accent: '#e8b04a' },
    { id: 'grades', start: 45, end: 67.5, num: '参', idx: 3, title: 'СИСТЕМА РАНГОВ', sub: 'как измеряют угрозу', accent: '#ff3b4e' },
    { id: 'pillars', start: 67.5, end: 85, num: '肆', idx: 4, title: 'СЛАГАЕМЫЕ СИЛЫ', sub: 'шесть рычагов мага', accent: '#3fb6ff' },
    { id: 'ranking', start: 85, end: 120, num: '伍', idx: 5, title: 'РЕЙТИНГ СИЛЫ', sub: 'пик формы · по событиям манги', accent: '#ff4a3d' },
    { id: 'potential', start: 120, end: 142.5, num: '陸', idx: 6, title: 'ПОТЕНЦИАЛ', sub: 'кто ещё не достиг предела', accent: '#2fe0b0' },
    { id: 'outro', start: 142.5, end: 155, num: '終', idx: 7, title: 'ФИНАЛ', accent: '#ff2e4d' },
  ];

  const range = (n, t0, step) => Array.from({ length: n }, (_, i) => +(t0 + i * step).toFixed(4));

  // Ключевые моменты каждой сцены (абсолютные секунды)
  const T = {
    intro: { eye: 0.8, open: 2.5, impact: 5.0, title: 5.2, tags: 6.0, sub: 7.2, spoiler: 7.8 },
    world: { energy: 12.5, triad: 17.5, arrows: [18.75, 19.375, 20.0], caption: 22.5 },
    hier: { levels: range(6, 27.5, BEAT * 3), outside: 38.75, caption: 41.25 },
    grades: { bands: range(5, 47.5, BAR), specials: range(4, 60.625, BEAT), sorc: 60, caption: 64.375 },
    pillars: { cards: range(6, 70, BEAT * 3), caption: 81.25 },
    rank: {
      rows: range(12, 87.5, BEAT * 2), // снизу вверх: #12 … #1
      vs: 102.5,
      radar: 104.375,
      stats: range(4, 105.625, BEAT * 1.5),
      verdict: 110,
      cap1: 113.125,
      cap2: 115.625,
    },
    pot: { axes: 122.5, dots: range(12, 123.125, BEAT / 2), zone: 128.75, callouts: range(4, 132.5, BAR) },
    outro: { lines: [142.5, 145, 147.5], impact: 150, fade: 152.5 },
  };

  // Звуковые/визуальные акценты. type: impact | riser | reverse | slash | card | hit | tick | bell | blip | whoosh | glitch
  const cues = [];
  const cue = (t, type, extra = {}) => cues.push(Object.assign({ t: +t.toFixed(4), type }, extra));

  // Вступление
  cue(0.8, 'whoosh', { dur: 1.6, gain: 0.5 });
  cue(1.0, 'riser', { end: T.intro.impact, gain: 0.9 });
  cue(3.75, 'reverse', { end: T.intro.impact, gain: 0.8 });
  cue(T.intro.impact, 'impact', { power: 1.0 });
  cue(T.intro.tags, 'whoosh', { dur: 0.8, gain: 0.45 });
  cue(T.intro.sub, 'tick', { gain: 0.6 });
  cue(T.intro.spoiler, 'blip', { note: 7, gain: 0.5 });

  // Переходы-«разрезы» и заставки глав
  scenes.slice(1).forEach((s) => {
    cue(s.start - 0.32, 'slash', { gain: 1.0 });
    if (s.id !== 'outro') cue(s.start + 0.2, 'card', { power: 0.55 });
  });

  // Мир проклятий
  cue(T.world.energy, 'whoosh', { dur: 1.4, gain: 0.6 });
  cue(T.world.triad, 'bell', { note: 0, gain: 0.7 });
  T.world.arrows.forEach((t, i) => cue(t, 'tick', { gain: 0.55, note: i }));
  cue(T.world.caption, 'blip', { note: 4, gain: 0.5 });

  // Иерархия
  T.hier.levels.forEach((t, i) => cue(t, 'node', { note: i, gain: 0.7 }));
  cue(T.hier.outside, 'glitch', { gain: 0.6 });
  cue(T.hier.caption, 'bell', { note: 2, gain: 0.6 });

  // Ранги: каждая ступень — удар, особый ранг — взрыв
  cue(T.grades.bands[2], 'riser', { end: T.grades.bands[4], gain: 0.85 });
  T.grades.bands.forEach((t, i) => {
    if (i < 4) cue(t, 'hit', { power: 0.35 + i * 0.12, note: i });
    else {
      cue(t, 'impact', { power: 1.0 });
      cue(t + 0.05, 'glitch', { gain: 0.8 });
    }
  });
  cue(T.grades.sorc, 'whoosh', { dur: 1.0, gain: 0.5 });
  T.grades.specials.forEach((t, i) => cue(t, 'bell', { note: i + 1, gain: 0.6 }));
  cue(T.grades.caption, 'tick', { gain: 0.5 });

  // Слагаемые силы
  T.pillars.cards.forEach((t, i) => cue(t, 'cardlet', { note: i, gain: 0.7 }));
  cue(T.pillars.caption, 'bell', { note: 4, gain: 0.6 });

  // Рейтинг
  T.rank.rows.forEach((t, k) => {
    if (k < 10) cue(t, 'tick', { gain: 0.55 + k * 0.03, note: k });
    else if (k === 10) cue(t, 'hit', { power: 0.6, note: 3 });
    else cue(t, 'impact', { power: 0.7 });
  });
  cue(T.rank.vs - 2.5, 'riser', { end: T.rank.vs, gain: 0.9 });
  cue(T.rank.vs, 'impact', { power: 1.0 });
  cue(T.rank.radar, 'whoosh', { dur: 1.2, gain: 0.6 });
  T.rank.stats.forEach((t, i) => cue(t, 'tick', { gain: 0.5, note: i }));
  cue(T.rank.verdict - 2.5, 'riser', { end: T.rank.verdict, gain: 0.8 });
  cue(T.rank.verdict - 0.12, 'slash', { gain: 1.1 });
  cue(T.rank.verdict, 'impact', { power: 1.0 });
  cue(T.rank.cap1, 'blip', { note: 2, gain: 0.5 });
  cue(T.rank.cap2, 'blip', { note: 5, gain: 0.5 });

  // Потенциал
  cue(T.pot.axes, 'whoosh', { dur: 1.0, gain: 0.5 });
  T.pot.dots.forEach((t, i) => cue(t, 'blip', { note: i % 7, gain: 0.35 }));
  cue(T.pot.zone, 'bell', { note: 5, gain: 0.6 });
  T.pot.callouts.forEach((t, i) => cue(t, 'cardlet', { note: i + 2, gain: 0.7 }));
  cue(140, 'riser', { end: 142.5, gain: 0.7 });

  // Финал
  T.outro.lines.forEach((t, i) => cue(t, 'hit', { power: 0.45 + i * 0.1, note: i }));
  cue(T.outro.lines[2], 'riser', { end: T.outro.impact, gain: 0.9 });
  cue(T.outro.impact - 1.25, 'reverse', { end: T.outro.impact, gain: 0.8 });
  cue(T.outro.impact, 'impact', { power: 1.0, tail: 4.5 });

  cues.sort((a, b) => a.t - b.t);

  root.TIMELINE = { fps: 60, width: 1920, height: 1080, bpm: BPM, beat: BEAT, bar: BAR, duration: 155, scenes, T, cues };
})(typeof window !== 'undefined' ? window : globalThis);
