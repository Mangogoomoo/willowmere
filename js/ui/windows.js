/* Window manager for the classic MMO-style panels: draggable by the title
   bar, click to bring to front, Esc closes the top one, positions are
   remembered between sessions. Also hosts the shared tooltip and the item
   description builder used by every item slot in the UI. */
(function (G) {
  'use strict';

  // Tiny DOM helper: h('div.cls#id', {attrs}, children...)
  function h(tag, attrs, ...kids) {
    const m = tag.match(/^([a-z0-9]+)((?:[.#][\w-]+)*)$/i);
    const el = document.createElement(m[1]);
    (m[2].match(/[.#][\w-]+/g) || []).forEach((t) => (t[0] === '.' ? el.classList.add(t.slice(1)) : (el.id = t.slice(1))));
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const c of kids.flat()) if (c != null) el.append(c);
    return el;
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  class WindowManager {
    constructor(game) {
      this.game = game;
      this.layer = document.getElementById('windows');
      this.wins = {};
      this.z = 30;
      this.order = [];
      this.positions = (G.SaveSystem.prefs().windows) || {};
      window.addEventListener('resize', () => { for (const id in this.wins) if (this.isOpen(id)) this.clamp(this.wins[id]); });
    }

    create(id, title, opts) {
      opts = opts || {};
      const closeBtn = h('button.x', { type: 'button', 'aria-label': `Close ${title}`, onclick: () => this.close(id) }, '×');
      const head = h('header.window-title.drag', null, h('span', { text: title }), h('span.wkey', { text: opts.keyHint || '' }), closeBtn);
      const body = h('div.wbody');
      const el = h('section.window.gwin', { 'aria-label': title, hidden: true }, head, body);
      el.style.width = (opts.width || 300) + 'px';
      this.layer.append(el);
      const win = { id, el, body, head, opts, onOpen: opts.onOpen || null, render: opts.render || null };
      this.wins[id] = win;
      el.addEventListener('pointerdown', () => this.focus(id));
      this.makeDraggable(win);
      return win;
    }

    makeDraggable(win) {
      let sx, sy, ox, oy, drag = false;
      win.head.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button')) return;
        drag = true; sx = e.clientX; sy = e.clientY;
        ox = win.el.offsetLeft; oy = win.el.offsetTop;
        win.head.setPointerCapture(e.pointerId);
      });
      win.head.addEventListener('pointermove', (e) => {
        if (!drag) return;
        win.el.style.left = (ox + e.clientX - sx) + 'px';
        win.el.style.top = (oy + e.clientY - sy) + 'px';
      });
      win.head.addEventListener('pointerup', () => {
        if (!drag) return;
        drag = false;
        this.clamp(win);
        this.positions[win.id] = { x: win.el.offsetLeft, y: win.el.offsetTop };
        G.SaveSystem.setPrefs({ windows: this.positions });
      });
    }

    clamp(win) {
      const r = win.el.getBoundingClientRect();
      const x = Math.min(Math.max(0, win.el.offsetLeft), Math.max(0, window.innerWidth - r.width));
      const y = Math.min(Math.max(0, win.el.offsetTop), Math.max(0, window.innerHeight - 40));
      win.el.style.left = x + 'px'; win.el.style.top = y + 'px';
    }

    isOpen(id) { return this.wins[id] && !this.wins[id].el.hidden; }
    focus(id) {
      const w = this.wins[id];
      w.el.style.zIndex = ++this.z;
      this.order = this.order.filter((x) => x !== id).concat(id);
    }
    open(id) {
      const w = this.wins[id];
      if (!w) return;
      if (w.el.hidden) {
        w.el.hidden = false;
        const p = this.positions[id] || w.opts.pos || { x: 80, y: 90 };
        const pos = typeof p === 'function' ? p() : p;
        w.el.style.left = pos.x + 'px'; w.el.style.top = pos.y + 'px';
        this.clamp(w);
        if (w.render) w.render();
      }
      this.focus(id);
      this.game.menu && this.game.menu.sync();
    }
    close(id) {
      const w = this.wins[id];
      if (!w || w.el.hidden) return;
      w.el.hidden = true;
      this.order = this.order.filter((x) => x !== id);
      G.Tooltip.hide();
      this.game.menu && this.game.menu.sync();
    }
    toggle(id) { this.isOpen(id) ? this.close(id) : this.open(id); }
    closeTop() {
      for (let i = this.order.length - 1; i >= 0; i--) {
        if (this.isOpen(this.order[i])) { this.close(this.order[i]); return true; }
      }
      return false;
    }
    refresh(id) { const w = this.wins[id]; if (w && !w.el.hidden && w.render) w.render(); }
  }

  /* ---------------- tooltip ---------------- */
  const Tooltip = {
    el: null,
    init() { this.el = document.getElementById('tooltip'); },
    show(html, x, y) {
      const el = this.el;
      el.innerHTML = html;
      el.hidden = false;
      this.move(x, y);
    },
    move(x, y) {
      const el = this.el, r = el.getBoundingClientRect();
      let left = x + 16, top = y + 14;
      if (left + r.width > window.innerWidth - 6) left = x - r.width - 12;
      if (top + r.height > window.innerHeight - 6) top = window.innerHeight - r.height - 6;
      el.style.left = Math.max(6, left) + 'px'; el.style.top = Math.max(6, top) + 'px';
    },
    hide() { if (this.el) this.el.hidden = true; },
    // Attach to an element; html can be a string or a function returning one.
    bind(el, html) {
      el.addEventListener('pointerenter', (e) => { const s = typeof html === 'function' ? html() : html; if (s) Tooltip.show(s, e.clientX, e.clientY); });
      el.addEventListener('pointermove', (e) => { if (!Tooltip.el.hidden) Tooltip.move(e.clientX, e.clientY); });
      el.addEventListener('pointerleave', () => Tooltip.hide());
    },
  };

  /* ---------------- item descriptions ---------------- */
  const SN = () => G.Items.STAT_NAMES;
  function bonusLines(bonus, skipAtk) {
    const out = [];
    for (const k in bonus) {
      if (skipAtk && k === 'atk') continue;
      const v = bonus[k];
      out.push(`<div class="tt-bonus">${SN()[k] || k} ${v > 0 ? '+' : ''}${v}${k === 'crit' || k === 'aspd' ? '%' : ''}</div>`);
    }
    return out.join('');
  }

  function itemTooltip(entry, player, opts) {
    opts = opts || {};
    const item = G.Items.get(entry.id);
    const rarity = G.Items.RARITY[item.rarity] || G.Items.RARITY.common;
    const slots = item.slots ? ` [${item.slots}]` : '';
    let html = `<div class="tt-name" style="color:${rarity.color}">${esc(item.name)}${slots}${entry.qty > 1 ? ` <span class="tt-qty">×${entry.qty}</span>` : ''}</div>`;
    let kind = { use: 'Consumable', etc: 'Material', card: 'Card' }[item.type];
    if (item.type === 'equip') {
      const slotName = item.slot === 'acc' ? 'Accessory' : G.Items.EQUIP_SLOTS.find((s) => s.id === item.slot).name;
      kind = item.weaponType ? `Weapon, ${G.Items.WEAPON_TYPES[item.weaponType].name.toLowerCase()}` : slotName;
    }
    html += `<div class="tt-type">${kind}${item.rarity !== 'common' ? `, ${rarity.name.toLowerCase()}` : ''}</div>`;

    if (item.type === 'equip') {
      if (item.slot === 'weapon') html += `<div class="tt-main">ATK ${item.bonus.atk || 0}</div>`;
      else if (item.bonus.def) html += `<div class="tt-main">DEF ${item.bonus.def}</div>`;
      const extra = Object.assign({}, item.bonus);
      if (item.slot !== 'weapon') delete extra.def;
      html += bonusLines(extra, item.slot === 'weapon');
      if (item.slots) html += `<div class="tt-slots">Card slots: ${'◇'.repeat(item.slots)}</div>`;
      const req = [];
      const lvOk = player.baseLevel >= (item.reqLevel || 1);
      req.push(`<span class="${lvOk ? '' : 'bad'}">Base level ${item.reqLevel || 1}</span>`);
      if (item.jobs !== 'all') {
        const ok = item.jobs.includes(player.job);
        req.push(`<span class="${ok ? '' : 'bad'}">${item.jobs.map((j) => j[0].toUpperCase() + j.slice(1)).join(', ')}</span>`);
      }
      html += `<div class="tt-req">Requires ${req.join('; ')}</div>`;
      // Compare with what is currently worn in that slot.
      if (!opts.equipped) {
        const slot = item.slot === 'acc' ? 'acc1' : item.slot;
        const cur = player.equipment[slot];
        if (cur) {
          const ci = G.Items.get(cur.id);
          const keys = new Set([...Object.keys(item.bonus), ...Object.keys(ci.bonus)]);
          const diffs = [];
          keys.forEach((k) => {
            const d = (item.bonus[k] || 0) - (ci.bonus[k] || 0);
            if (d) diffs.push(`<span class="${d > 0 ? 'up' : 'down'}">${SN()[k] || k} ${d > 0 ? '+' : ''}${d}</span>`);
          });
          html += `<div class="tt-compare">Compared with ${esc(ci.name)}: ${diffs.length ? diffs.join(' ') : 'no change'}</div>`;
        }
      }
    }
    if (item.desc) html += `<div class="tt-desc">${esc(item.desc)}</div>`;
    html += `<div class="tt-foot">Weight ${item.weight}${item.price ? `<span>Sells for ${Math.floor(item.price / 2)} z</span>` : ''}</div>`;
    if (opts.hint) html += `<div class="tt-hint">${opts.hint}</div>`;
    return html;
  }

  /* Press once for one step; keep holding to repeat (after a short delay).
     Release anywhere stops it, even if the button became disabled. */
  function holdRepeat(btn, fn) {
    let timer = null, delay = null;
    const stop = () => { clearTimeout(delay); clearInterval(timer); timer = delay = null; btn.classList.remove('held'); };
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || btn.disabled) return;
      e.preventDefault();
      stop();
      btn.classList.add('held');
      fn();
      delay = setTimeout(() => { timer = setInterval(() => { if (!btn.isConnected) stop(); else fn(); }, 90); }, 350);
    });
    window.addEventListener('pointerup', stop);
    window.addEventListener('blur', stop);
    btn.addEventListener('pointercancel', stop);
    btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } });
  }

  G.holdRepeat = holdRepeat;
  G.h = h;
  G.esc = esc;
  G.WindowManager = WindowManager;
  G.Tooltip = Tooltip;
  G.itemTooltip = itemTooltip;
})(window.G = window.G || {});
