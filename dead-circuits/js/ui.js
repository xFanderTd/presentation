'use strict';
// Menus & overlays (title, pause, death, victory, stat choice, banners). Minimal version.
(function () {
  const G = window.G;
  const ui = {
    el: null, modal: null,
    init() {
      this.el = document.getElementById('ui');
      this.el.innerHTML = `<style>
        #ui .scr{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:calc(var(--s)*6px);background:#05040acc;pointer-events:auto;font-size:calc(var(--s)*8px);text-align:center}
        #ui h1{font-family:var(--font-display);font-size:calc(var(--s)*20px);color:var(--cyan);text-shadow:0 0 calc(var(--s)*6px) var(--magenta);margin:0}
        #ui button{font:inherit;color:var(--text);background:#120f22;border:calc(var(--s)*1px) solid var(--cyan);padding:calc(var(--s)*3px) calc(var(--s)*8px);cursor:pointer}
        #ui .banner{position:absolute;left:0;right:0;top:calc(var(--s)*60px);text-align:center;font-family:var(--font-display);font-size:calc(var(--s)*12px);color:#fff;text-shadow:0 0 calc(var(--s)*4px) var(--magenta);transition:opacity .6s}
      </style><div class="layer"></div><div class="banner" hidden></div>`;
      this.layer = this.el.querySelector('.layer');
      this.bannerEl = this.el.querySelector('.banner');
    },
    screen(html) {
      this.layer.innerHTML = `<div class="scr">${html}</div>`;
      return this.layer.firstChild;
    },
    hideAll() { this.layer.innerHTML = ''; this.modal = null; },
    isModalOpen() { return !!this.modal; },
    showTitle(onStart) {
      const s = this.screen(`<h1>DEAD CIRCUITS</h1><div>Нажмите, чтобы начать</div><button>Играть</button>`);
      const go = () => { window.removeEventListener('keydown', key); this.hideAll(); onStart(); };
      const key = (e) => { if (e.code === 'Enter' || e.code === 'Space') go(); };
      s.querySelector('button').onclick = go;
      window.addEventListener('keydown', key);
    },
    showPause(onResume, onQuit) {
      const s = this.screen(`<h1>ПАУЗА</h1><button class="r">Продолжить</button><button class="q">В меню</button>`);
      s.querySelector('.r').onclick = onResume;
      s.querySelector('.q').onclick = () => { this.hideAll(); onQuit(); };
    },
    hidePause() { this.hideAll(); },
    showDeath(sum, onRetry, onMenu) {
      const s = this.screen(`<h1 style="color:var(--magenta)">СИСТЕМА ОТКЛЮЧЕНА</h1><div>Убито врагов: ${sum.kills} · Время: ${Math.floor(sum.time)} c</div><button class="r">Заново</button>`);
      s.querySelector('.r').onclick = () => { this.hideAll(); onRetry(); };
    },
    showVictory(sum, onMenu) {
      const s = this.screen(`<h1>ПОБЕДА</h1><div>Время: ${Math.floor(sum.time)} c</div><button class="r">В меню</button>`);
      s.querySelector('.r').onclick = () => { this.hideAll(); onMenu(); };
    },
    banner(title, sub) {
      const b = this.bannerEl;
      b.innerHTML = `${title}<div style="font-size:calc(var(--s)*6px);color:var(--dim)">${sub || ''}</div>`;
      b.hidden = false; b.style.opacity = 1;
      clearTimeout(this._bt);
      this._bt = setTimeout(() => { b.style.opacity = 0; }, 2200);
    },
    chooseStat(opts, cb) {
      const names = { brutality: 'Жестокость', tactics: 'Тактика', survival: 'Живучесть' };
      const s = this.screen(`<h1>ЧИП УСИЛЕНИЯ</h1>` + opts.map((o) => `<button data-s="${o}" style="border-color:var(--${o});color:var(--${o})">${names[o]}</button>`).join(''));
      this.modal = 'stat';
      s.querySelectorAll('button').forEach((b) => (b.onclick = () => { this.hideAll(); cb(b.dataset.s); }));
    },
    openCollector(world) {
      const s = this.screen(`<h1>КОЛЛЕКТОР</h1><div>Скоро…</div><button>Закрыть</button>`);
      this.modal = 'collector';
      s.querySelector('button').onclick = () => this.hideAll();
    },
    update(dt) {},
  };
  G.ui = ui;
})();
