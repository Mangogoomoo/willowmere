/* Hotbar: nine shortcut slots (F1–F9, or 1–9). Drag an item from the
   inventory onto a slot; press the key or click the slot to use it.
   Right-click a slot to clear it. Slots store { type, id } so skills can
   share the bar in Stage 3.

   Log: the scrolling system message box (loot, level ups, warnings). */
(function (G) {
  'use strict';
  const h = G.h;

  class Hotbar {
    constructor(game) {
      this.game = game;
      this.slots = new Array(9).fill(null);
      this.el = document.getElementById('hotbar');
      this.cells = [];
      for (let i = 0; i < 9; i++) {
        const cell = h('button.hslot', {
          type: 'button', 'aria-label': `Hotbar slot ${i + 1}`,
          onclick: () => this.trigger(i),
          oncontextmenu: (e) => { e.preventDefault(); this.set(i, null); },
          ondragover: (e) => { if (e.dataTransfer.types.includes('text/x-item') || e.dataTransfer.types.includes('text/x-skill')) { e.preventDefault(); cell.classList.add('over'); } },
          ondragleave: () => cell.classList.remove('over'),
          ondrop: (e) => {
            cell.classList.remove('over');
            const sk = e.dataTransfer.getData('text/x-skill');
            const d = e.dataTransfer.getData('text/x-item');
            if (sk) { e.preventDefault(); this.set(i, { type: 'skill', id: sk }); return; }
            if (!d) return;
            e.preventDefault();
            this.set(i, { type: 'item', id: JSON.parse(d).id });
          },
        }, h('kbd', { text: 'F' + (i + 1) }), h('span.cd'));
        G.Tooltip.bind(cell, () => this.tip(i));
        this.cells.push(cell);
        this.el.append(cell);
      }
    }

    tip(i) {
      const s = this.slots[i];
      if (!s) return '<div class="tt-desc">Drag a potion, piece of gear or skill here.</div>';
      const p = this.game.player;
      if (s.type === 'skill') return G.skillTooltip(G.Skills.get(s.id), p) + `<div class="tt-hint">F${i + 1} or ${i + 1} to use. Right-click to clear.</div>`;
      const have = p.inventory.count(s.id);
      return G.itemTooltip({ id: s.id, qty: have }, p, { hint: `F${i + 1} or ${i + 1} to use. Right-click to clear.` });
    }

    set(i, entry) {
      this.slots[i] = entry;
      this.render();
      this.game.save.markDirty();
    }

    trigger(i) {
      const s = this.slots[i], p = this.game.player;
      if (!s || !p) return;
      if (s.type === 'skill') {
        if (p.skills.use(s.id)) this.flash(i);
        return;
      }
      if (s.type === 'item') {
        const e = p.inventory.firstOf(s.id);
        if (!e) { this.game.log.add(`You have no ${G.Items.get(s.id).name} left.`, 'warn'); return; }
        p.inventory.use(e.uid);
        this.flash(i);
      }
    }
    flash(i) { const c = this.cells[i]; c.classList.remove('pulse'); void c.offsetWidth; c.classList.add('pulse'); }

    render() {
      const p = this.game.player;
      this.slots.forEach((s, i) => {
        const c = this.cells[i];
        c.querySelectorAll('img,.qty,.slv').forEach((n) => n.remove());
        if (!s) { c.classList.remove('full', 'none', 'skill'); return; }
        if (s.type === 'skill') {
          const sk = G.Skills.get(s.id), lv = p ? p.skills.level(s.id) : 0, use = lv ? p.skills.useLevel(s.id) : 0;
          c.classList.add('full', 'skill');
          c.classList.toggle('none', !lv);
          c.append(h('img', { src: G.Icons.skillUrl(s.id), alt: sk.name }), h('span.slv', { text: 'Lv ' + use }));
          return;
        }
        c.classList.remove('skill');
        const n = p ? p.inventory.count(s.id) : 0;
        c.classList.add('full');
        c.classList.toggle('none', n === 0);
        c.append(h('img', { src: G.Icons.url(s.id), alt: G.Items.get(s.id).name }));
        if (G.Items.get(s.id).stack) c.append(h('span.qty', { text: String(n) }));
      });
    }

    // Per-frame: cooldown sweep and "not enough SP" dimming for skills.
    update() {
      const p = this.game.player;
      if (!p) return;
      this.slots.forEach((s, i) => {
        const c = this.cells[i];
        if (!s || s.type !== 'skill') { if (c._cd) { c.style.setProperty('--cd', '0'); c._cd = 0; } return; }
        const sk = G.Skills.get(s.id), lv = p.skills.level(s.id) ? p.skills.useLevel(s.id) : 0;
        const left = p.skills.cooldownLeft(s.id), total = Math.max(0.25, sk.cd(Math.max(1, lv)));
        const frac = Math.min(1, left / total);
        if (Math.abs(frac - (c._cd || 0)) > 0.01) { c.style.setProperty('--cd', frac.toFixed(3)); c._cd = frac; }
        const low = lv && p.sp < sk.sp(lv);
        if (low !== c._low) { c.classList.toggle('low', !!low); c._low = low; }
      });
    }

    serialize() { return this.slots.map((s) => (s ? { type: s.type, id: s.id } : null)); }
    load(data) {
      this.slots = new Array(9).fill(null);
      (data || []).forEach((s, i) => {
        if (!s || i >= 9) return;
        if ((s.type === 'item' && G.Items.get(s.id)) || (s.type === 'skill' && G.Skills.get(s.id))) this.slots[i] = s;
      });
      this.render();
    }
  }

  class Log {
    constructor() {
      this.el = document.getElementById('log');
      this.list = document.getElementById('log-list');
      this.max = 60;
    }
    add(text, kind) {
      const li = h('li.' + (kind || 'info'), { text });
      this.list.append(li);
      while (this.list.children.length > this.max) this.list.firstChild.remove();
      this.list.scrollTop = this.list.scrollHeight;
    }
  }

  G.Hotbar = Hotbar;
  G.Log = Log;
})(window.G = window.G || {});
