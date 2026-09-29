'use strict';
// In-game HUD (DOM overlay sized in game pixels via --s). Minimal version.
(function () {
  const G = window.G;
  const hud = {
    el: null,
    init() {
      this.el = document.getElementById('hud');
      this.el.innerHTML = `
        <style>
          #hud .hp{position:absolute;left:calc(var(--s)*12px);bottom:calc(var(--s)*8px);width:calc(var(--s)*180px);height:calc(var(--s)*7px);background:#1a0d18;border:calc(var(--s)*1px) solid #05040a}
          #hud .hp i{position:absolute;left:0;top:0;bottom:0}
          #hud .hp b{position:absolute;inset:0;text-align:center;font-size:calc(var(--s)*6px);line-height:calc(var(--s)*7px);color:#fff;font-weight:600}
          #hud .slots{position:absolute;left:calc(var(--s)*12px);bottom:calc(var(--s)*20px);display:flex;gap:calc(var(--s)*4px)}
          #hud .slot{position:relative;width:calc(var(--s)*24px);height:calc(var(--s)*24px);background:#0b0a16cc;border:calc(var(--s)*1px) solid #45466a}
          #hud .slot canvas{width:100%;height:100%;image-rendering:pixelated}
          #hud .slot .cd{position:absolute;left:0;right:0;bottom:0;background:#000a}
          #hud .slot .k{position:absolute;left:50%;bottom:calc(var(--s)*-7px);transform:translateX(-50%);font-size:calc(var(--s)*5px);color:#aab0d6}
          #hud .top{position:absolute;right:calc(var(--s)*10px);bottom:calc(var(--s)*8px);text-align:right;font-size:calc(var(--s)*7px)}
          #hud .prompt{position:absolute;left:50%;top:calc(var(--s)*40px);transform:translateX(-50%);font-size:calc(var(--s)*7px);background:#05040acc;padding:calc(var(--s)*2px) calc(var(--s)*5px);border:calc(var(--s)*1px) solid #27f3ff}
          #hud .stats{position:absolute;left:calc(var(--s)*196px);bottom:calc(var(--s)*8px);font-size:calc(var(--s)*7px);display:flex;gap:calc(var(--s)*5px)}
        </style>
        <div class="slots"></div>
        <div class="hp"><i class="rec" style="background:#ff8a2a"></i><i class="cur" style="background:linear-gradient(#6dff9a,#1fbf5a)"></i><b></b></div>
        <div class="stats"></div>
        <div class="top"></div>
        <div class="prompt" hidden></div>`;
      this.slotsEl = this.el.querySelector('.slots');
      this.slotEls = {};
      for (const [slot, btn] of G.SLOT_BUTTONS) {
        const d = document.createElement('div');
        d.className = 'slot';
        d.innerHTML = `<canvas width="24" height="24"></canvas><div class="cd"></div><div class="k"></div>`;
        this.slotsEl.appendChild(d);
        this.slotEls[slot] = { el: d, cv: d.querySelector('canvas'), cd: d.querySelector('.cd'), k: d.querySelector('.k'), btn, id: null };
      }
      this.hpCur = this.el.querySelector('.hp .cur');
      this.hpRec = this.el.querySelector('.hp .rec');
      this.hpTxt = this.el.querySelector('.hp b');
      this.top = this.el.querySelector('.top');
      this.statsEl = this.el.querySelector('.stats');
      this.prompt = this.el.querySelector('.prompt');
    },
    show(on) { if (this.el) this.el.hidden = !on; },
    update(world, dt) {
      if (!this.el || this.el.hidden) return;
      const p = world.player;
      this.hpCur.style.width = (100 * p.hp / p.maxHp) + '%';
      this.hpRec.style.width = (100 * Math.min(p.maxHp, p.hp + p.recoverable) / p.maxHp) + '%';
      this.hpTxt.textContent = Math.ceil(p.hp) + ' / ' + p.maxHp;
      for (const slot in this.slotEls) {
        const s = this.slotEls[slot], inst = p.slots[slot];
        const id = inst ? inst.uid : null;
        if (s.id !== id) {
          s.id = id;
          const g = s.cv.getContext('2d');
          g.clearRect(0, 0, 24, 24);
          if (inst) g.drawImage(G.itemIcon(inst.def, 24), 0, 0);
          s.el.style.borderColor = inst ? (G.STAT_COLOR[inst.def.stat] || '#45466a') : '#45466a';
        }
        s.cd.style.height = inst && inst.cd > 0 ? (100 * inst.cd / (inst.def.cooldown * p.cdMul || 1)) + '%' : '0';
        s.k.textContent = G.input.label(s.btn);
      }
      const t = G.game.runTime;
      this.top.innerHTML = `${Math.floor(t / 60)}m ${String(Math.floor(t % 60)).padStart(2, '0')}s<br><span style="color:var(--cells)">${p.cells} ядер</span><br><span style="color:var(--gold)">${p.gold} кр.</span><br>аптечки: ${p.flasks}/${p.maxFlasks}`;
      this.statsEl.innerHTML = `<span style="color:var(--brutality)">${p.stats.brutality}</span><span style="color:var(--tactics)">${p.stats.tactics}</span><span style="color:var(--survival)">${p.stats.survival}</span>`;
      if (p.focus) { this.prompt.hidden = false; this.prompt.textContent = `[${G.input.label('interact')}] ${p.focus.prompt}`; }
      else this.prompt.hidden = true;
    },
  };
  G.hud = hud;
})();
