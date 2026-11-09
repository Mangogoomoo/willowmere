/* Inventory-style item grids for storage and the merchant cart: drag items
   between them and your inventory, or double-click to move a whole stack
   (hold Shift while dragging to pick an amount). */
(function (G) {
  'use strict';
  const h = G.h;
  // entries: [{ id, qty, cards, refine }]; take(index, qty) moves out; put(uid, qty) moves in.
  G.itemGrid = function (game, win, o) {
    const p = game.player, b = win.body;
    b.textContent = '';
    if (o.note) b.append(h('p.hint', { text: o.note }));
    const grid = h('div.grid.ext-grid', { 'aria-label': o.label });
    o.entries.forEach((e, i) => {
      const it = G.Items.get(e.id);
      if (!it) return;
      const cell = h('div.cell.r-' + it.rarity + (G.Items.isCarded(e) ? '.carded' : ''), {
        draggable: 'true', tabindex: '0', role: 'button', 'aria-label': `${G.Items.displayName(e)}${e.qty > 1 ? ', ' + e.qty : ''}`,
        ondragstart: (ev) => { ev.dataTransfer.setData('text/x-ext', JSON.stringify({ src: o.source, i })); ev.dataTransfer.effectAllowed = 'move'; G.Tooltip.hide(); },
        ondblclick: () => o.take(i, e.qty),
        oncontextmenu: (ev) => { ev.preventDefault(); o.take(i, e.qty); },
        onkeydown: (ev) => { if (ev.key === 'Enter') o.take(i, e.qty); },
      }, h('img', { src: G.Icons.url(e.id), alt: '', draggable: 'false' }), e.qty > 1 ? h('span.qty', { text: String(e.qty) }) : null, e.refine ? h('span.refbadge', { text: '+' + e.refine }) : null);
      G.Tooltip.bind(cell, () => G.itemTooltip(e, p, { hint: 'Drag to your inventory, or double-click or right-click to take it.' }));
      grid.append(cell);
    });
    const blanks = Math.max(0, Math.ceil(Math.max(o.entries.length, 35) / 7) * 7 - o.entries.length);
    for (let k = 0; k < blanks; k++) grid.append(h('div.cell.empty'));
    b.append(grid);
    if (o.extra) b.append(o.extra);
    b.append(h('div.inv-foot.shop-foot', null, h('span.hint', { text: o.count }), h('span.hint', { text: o.weight })));
    // Items dragged in from the inventory.
    if (!win.dropBound) {
      win.dropBound = true;
      win.el.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/x-item')) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } });
      win.el.addEventListener('drop', (e) => {
        const d = e.dataTransfer.getData('text/x-item');
        if (!d) return;
        e.preventDefault();
        const { uid } = JSON.parse(d), entry = game.player.inventory.find(uid);
        if (!entry) return;
        let qty = entry.qty;
        if (e.shiftKey && qty > 1) { const n = parseInt(prompt(`How many? (1–${qty})`, String(qty)), 10); if (!n) return; qty = Math.max(1, Math.min(qty, n)); }
        win.put(uid, qty);
      });
    }
  };
  // The inventory accepts items dragged out of storage or the cart.
  G.bindInventoryDrops = function (game) {
    const el = game.inventoryWin.el;
    el.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/x-ext')) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } });
    el.addEventListener('drop', (e) => {
      const d = e.dataTransfer.getData('text/x-ext');
      if (!d) return;
      e.preventDefault();
      const { src, i } = JSON.parse(d);
      const list = src === 'storage' ? game.storage.items : game.cart.items, entry = list[i];
      if (!entry) return;
      let qty = entry.qty;
      if (e.shiftKey && qty > 1) { const n = parseInt(prompt(`How many? (1–${qty})`, String(qty)), 10); if (!n) return; qty = Math.max(1, Math.min(qty, n)); }
      if (src === 'storage') game.storage.withdraw(i, qty); else game.cart.take(i, qty);
    });
  };
})(window.G = window.G || {});
