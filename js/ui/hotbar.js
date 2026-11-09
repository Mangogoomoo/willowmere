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
          ondragover: (e) => {
            const t = e.dataTransfer.types;
            if (t.includes('text/x-item') || t.includes('text/x-skill') || t.includes('text/x-hotslot')) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; cell.classList.add('over'); }
          },
          ondragstart: (e) => {
            if (!this.slots[i]) { e.preventDefault(); return; }
            e.dataTransfer.setData('text/x-hotslot', String(i));
            e.dataTransfer.effectAllowed = 'move';
            this.dragFrom = i; this.dropped = false;
            G.Tooltip.hide();
          },
          // Dropped anywhere that isn't a hotbar slot: take it off the bar.
          ondragend: () => {
            if (this.dragFrom != null && !this.dropped) { this.set(this.dragFrom, null); this.game.sfx('click'); }
            this.dragFrom = null;
          },
          ondragleave: () => cell.classList.remove('over'),
          ondrop: (e) => {
            cell.classList.remove('over');
            const from = e.dataTransfer.getData('text/x-hotslot');
            if (from !== '') {
              // Move between slots (swap if the target is taken).
              e.preventDefault();
              this.dropped = true;
              const a = parseInt(from, 10);
              if (a !== i) { const tmp = this.slots[i]; this.slots[i] = this.slots[a]; this.slots[a] = tmp; this.render(); this.game.save.markDirty(); }
              return;
            }
            const sk = e.dataTransfer.getData('text/x-skill');
            const d = e.dataTransfer.getData('text/x-item');
            if (sk) {
              e.preventDefault();
              if (G.Skills.get(sk).type === 'passive') { this.game.log.add(`${G.Skills.get(sk).name} is passive and always on, so it can't go on the action bar.`, 'warn'); return; }
              // A lower level picked in the skills window stays with this slot; the highest level follows new levels.
              const lv = parseInt(e.dataTransfer.getData('text/x-skill-lv'), 10), max = this.game.player.skills.level(sk);
              this.set(i, lv && lv < max ? { type: 'skill', id: sk, lv } : { type: 'skill', id: sk }); return;
            }
            if (!d) return;
            e.preventDefault();
            this.set(i, { type: 'item', id: JSON.parse(d).id });
          },
        }, h('kbd'), h('span.cd'));
        G.Tooltip.bind(cell, () => this.tip(i));
        this.cells.push(cell);
        this.el.append(cell);
      }
    }

    tip(i) {
      const s = this.slots[i];
      if (!s) return '<div class="tt-desc">Drag a potion, piece of gear or skill here.</div>';
      const p = this.game.player;
      if (s.type === 'skill') return G.skillTooltip(G.Skills.get(s.id), p, this.slotLevel(s)) + `<div class="tt-hint">${this.keyLabel(i)} to use at level ${this.slotLevel(s)}. Drag to another slot to move it, or off the bar to remove it. For another level, pick it in the skills window and drag the skill here again.</div>`;
      const have = p.inventory.count(s.id);
      return G.itemTooltip({ id: s.id, qty: have }, p, { hint: `${this.keyLabel(i)} to use. Drag to another slot to move it, or off the bar to remove it.` });
    }

    // The level a skill slot casts at: its own, or the highest learned.
    slotLevel(s) { const max = this.game.player ? this.game.player.skills.level(s.id) : 0; return max ? Math.max(1, Math.min(max, s.lv || max)) : 0; }
    keyLabel(i) { return G.Keybinds.label('hot' + (i + 1)); }
    // Slot labels follow the current key bindings.
    renderKeys() { this.cells.forEach((c, i) => { c.querySelector('kbd').textContent = G.Keybinds.primary('hot' + (i + 1)) || '·'; }); }

    set(i, entry) {
      if (entry && entry.type === 'skill' && (!G.Skills.get(entry.id) || G.Skills.get(entry.id).type === 'passive')) entry = null;
      this.slots[i] = entry;
      this.render();
      this.game.save.markDirty();
    }

    trigger(i) {
      const s = this.slots[i], p = this.game.player;
      if (!s || !p) return;
      if (s.type === 'skill') {
        if (p.skills.use(s.id, undefined, this.slotLevel(s))) this.flash(i);
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
      this.renderKeys();
      this.slots.forEach((s, i) => {
        const c = this.cells[i];
        c.querySelectorAll('img,.qty,.slv').forEach((n) => n.remove());
        c.draggable = !!s;
        if (!s) { c.classList.remove('full', 'none', 'skill'); return; }
        if (s.type === 'skill') {
          const sk = G.Skills.get(s.id), lv = p ? p.skills.level(s.id) : 0, use = this.slotLevel(s);
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
        const sk = G.Skills.get(s.id), lv = this.slotLevel(s);
        const left = p.skills.cooldownLeft(s.id), total = Math.max(0.25, sk.cd(Math.max(1, lv)));
        const frac = Math.min(1, left / total);
        if (Math.abs(frac - (c._cd || 0)) > 0.01) { c.style.setProperty('--cd', frac.toFixed(3)); c._cd = frac; }
        const low = lv && p.sp < sk.sp(lv);
        if (low !== c._low) { c.classList.toggle('low', !!low); c._low = low; }
      });
    }

    serialize() { return this.slots.map((s) => (s ? Object.assign({ type: s.type, id: s.id }, s.lv ? { lv: s.lv } : null) : null)); }
    load(data) {
      this.slots = new Array(9).fill(null);
      (data || []).forEach((s, i) => {
        if (!s || i >= 9) return;
        const job = this.game.player ? this.game.player.job : 'novice';
        if ((s.type === 'item' && G.Items.get(s.id)) || (s.type === 'skill' && G.Skills.get(s.id) && G.Skills.allowed(s.id, job))) this.slots[i] = s;
        // Slots saved before they had their own level keep the level picked in the skills window.
        const sys = this.game.player && this.game.player.skills;
        if (this.slots[i] && s.type === 'skill' && !s.lv && sys && sys.selected[s.id]) this.slots[i] = Object.assign({}, s, { lv: sys.selected[s.id] });
      });
      this.render();
      // Passive skills never belong on the bar (older saves might have one).
      this.slots = this.slots.map((sl) => (sl && sl.type === 'skill' && (!G.Skills.get(sl.id) || G.Skills.get(sl.id).type === 'passive') ? null : sl));
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
