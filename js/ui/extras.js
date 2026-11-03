/* Smaller HUD pieces: debug tools (hold-to-repeat level buttons), the
   auto-loot toggle, the trial tracker and the active-buff bar. */
(function (G) {
  'use strict';
  const h = G.h;

  const holdRepeat = G.holdRepeat;

  class Extras {
    constructor(game) {
      this.game = game;
      const prefs = G.SaveSystem.prefs();
      game.autoLoot = !!prefs.autoLoot;

      // ---- debug panel ----
      this.debugEl = document.getElementById('debug');
      const p = () => game.player;
      const baseBtn = h('button.btn.small', { type: 'button', title: 'Hold to keep levelling' }, '+1 Base level');
      const jobBtn = h('button.btn.small', { type: 'button', title: 'Hold to keep levelling' }, '+1 Job level');
      holdRepeat(baseBtn, () => { const pl = p(); if (pl.baseLevel < G.Config.MAX_LEVEL) pl.gainExp(pl.expToNext - pl.baseExp, 0); });
      holdRepeat(jobBtn, () => {
        const pl = p();
        if (pl.jobExpToNext === Infinity) { game.log.add(`Job level is already at the ${pl.jobDef.name} maximum.`, 'info'); return; }
        pl.gainExp(0, pl.jobExpToNext - pl.jobExp);
      });
      this.debugEl.append(h('span.dbg-title', { text: 'Debug' }), baseBtn, jobBtn,
        h('button.x', { type: 'button', 'aria-label': 'Hide debug tools', onclick: () => this.setDebug(false) }, '×'));
      this.setDebug(prefs.debug !== false, true);

      // ---- trial tracker & buffs ----
      this.trackerEl = document.getElementById('tracker');
      this.buffsEl = document.getElementById('buffs');
      game.events.on('questsChanged', () => this.renderTracker());
      game.events.on('statsChanged', () => this.renderTracker());
      game.events.on('buffsChanged', () => this.renderBuffs());
      this.buffT = 0;
      this.trackT = 0;
      this.renderTracker();
    }

    setDebug(on, silent) {
      this.debug = on;
      this.debugEl.hidden = !on;
      if (!silent) G.SaveSystem.setPrefs({ debug: on });
      if (this.game.optionsWin) this.game.windows.refresh('options');
    }

    setAutoLoot(on) {
      this.game.autoLoot = on;
      G.SaveSystem.setPrefs({ autoLoot: on });
      this.game.log.add(on ? 'Auto-loot on: items from your kills fly straight into your bag.' : 'Auto-loot off: click items to pick them up.', 'system');
      if (this.game.menu) this.game.menu.sync();
      this.game.windows.refresh('options');
    }

    renderTracker() {
      const Q = this.game.quests, el = this.trackerEl;
      const st = Q && Q.status();
      el.hidden = !st;
      if (!st) return;
      const job = G.Jobs.get(Q.trial.job);
      el.textContent = '';
      el.append(h('div.tr-title', { text: `${job.name} trial` }),
        ...st.lines.map((l) => h('div.tr-line' + (l.have >= l.need ? '.done' : ''), null, h('span', { text: l.label }), h('b', { text: `${l.have} / ${l.need}` }))));
      if (st.complete) el.append(h('div.tr-hint', { text: 'Return to Master Rowan in the plaza.' }));
      else if (Q.target()) {
        this.arrowEl = h('span.tr-arrow', { 'aria-hidden': 'true', text: '↑' });
        this.distEl = h('span');
        el.append(h('div.tr-dir', null, this.arrowEl, this.distEl, h('span.tr-sub', { text: 'Follow the beacon of light' })));
        this.updateArrow();
      }
    }

    renderBuffs() {
      const sys = this.game.player.skills, el = this.buffsEl;
      const key = Object.keys(sys.buffs).join(',') + (sys.playingDead ? ',pd' : '');
      if (key === this.buffKey) {
        // Same buffs: only refresh the countdowns (keeps tooltips stable).
        el.querySelectorAll('[data-buff]').forEach((n) => {
          const b = sys.buffs[n.dataset.buff];
          if (b) n.lastChild.textContent = Math.max(0, Math.ceil(b.until - this.game.time)) + 's';
        });
        return;
      }
      this.buffKey = key;
      G.Tooltip.hide();
      el.textContent = '';
      for (const id in sys.buffs) {
        const b = sys.buffs[id], left = Math.max(0, Math.ceil(b.until - this.game.time));
        const node = h('div.buff', { 'data-buff': id }, h('img', { src: G.Icons.skillUrl(id), alt: '' }), h('span', { text: left + 's' }));
        G.Tooltip.bind(node, () => `<div class="tt-name" style="color:#ffe27a">${G.esc(G.SkillSystem.BUFFS[id].name)} (level ${b.level})</div><div class="tt-desc">${G.esc(G.Skills.get(id).desc(b.level))}</div>`);
        el.append(node);
      }
      if (sys.playingDead) el.append(h('div.buff', null, h('img', { src: G.Icons.skillUrl('play_dead'), alt: '' }), h('span', { text: 'down' })));
    }

    // Point the tracker arrow at the objective, relative to the camera view.
    updateArrow() {
      const tgt = this.game.quests.target();
      if (!tgt || !this.arrowEl || !this.arrowEl.isConnected) return;
      if (tgt.map && tgt.map !== this.game.mapId) {
        this.arrowEl.style.transform = 'none';
        this.distEl.textContent = `Head to ${G.Maps[tgt.map].name}`;
        return;
      }
      const p = this.game.player.position, yaw = this.game.camera.yaw;
      const dx = tgt.x - p.x, dz = tgt.z - p.z;
      const sx = dx * Math.cos(yaw) - dz * Math.sin(yaw);       // screen right
      const sy = -dx * Math.sin(yaw) - dz * Math.cos(yaw);      // screen up (forward)
      this.arrowEl.style.transform = `rotate(${Math.atan2(sx, sy) * 180 / Math.PI}deg)`;
      this.distEl.textContent = `${Math.round(Math.hypot(dx, dz))} m away`;
    }

    update(dt) {
      this.arrowT = (this.arrowT || 0) + dt;
      if (this.arrowT > 0.1) { this.arrowT = 0; this.updateArrow(); }
      this.buffT += dt;
      if (this.buffT > 0.25) { this.buffT = 0; this.renderBuffs(); }
      this.trackT += dt;
      if (this.trackT > 1) { this.trackT = 0; if (this.game.quests.trial) this.renderTracker(); }
    }
  }

  G.Extras = Extras;
})(window.G = window.G || {});
