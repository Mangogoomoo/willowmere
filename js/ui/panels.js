/* Game windows: Status (stat allocation), Inventory, Equipment, Options,
   and the menu bar that opens them. Every button here does something. */
(function (G) {
  'use strict';
  const h = G.h;

  const STAT_INFO = {
    str: 'Strength: physical attack and how much you can carry.',
    agi: 'Agility: attack speed and FLEE (dodging).',
    vit: 'Vitality: max HP, defence against hits, HP recovery and potion strength.',
    int: 'Intelligence: max SP, magic attack, magic defence and SP recovery.',
    dex: 'Dexterity: HIT (accuracy) and steadier damage. Main damage stat for bows.',
    luk: 'Luck: critical hits, plus a little ATK, HIT and FLEE.',
  };

  /* ===================================================== Status */
  function statusWindow(game) {
    const W = game.windows;
    let resetArmed = 0, built = false;
    const win = W.create('status', 'Status', { width: 440, keyHint: 'Alt+A', pos: { x: 16, y: 200 } });
    const refs = { rows: {}, derived: {} };

    function build() {
      const p = game.player, b = win.body;
      b.textContent = '';
      const rows = h('div.stat-grid');
      for (const k of G.Stats.KEYS) {
        const label = h('span.sname', { text: k.toUpperCase() });
        G.Tooltip.bind(label, `<div class="tt-desc">${STAT_INFO[k]}</div><div class="tt-hint">Hold + to keep raising.</div>`);
        const val = h('span.sval'), bonus = h('span.sbonus');
        const plus = h('button.plus', { type: 'button', 'aria-label': `Raise ${k.toUpperCase()}` }, '+');
        G.holdRepeat(plus, () => p.raiseStat(k));
        const cost = h('span.scost');
        rows.append(h('div.srow', null, label, h('span', null, val, bonus), plus, cost));
        refs.rows[k] = { val, bonus, plus, cost };
      }
      const derived = h('div.derived');
      for (const n of ['ATK', 'MATK', 'HIT', 'FLEE', 'DEF', 'MDEF', 'CRIT', 'ASPD']) {
        const v = h('b');
        derived.append(h('div.drow', null, h('span', { text: n }), v));
        refs.derived[n] = v;
      }
      const resetBtn = h('button.btn.small', {
        type: 'button',
        onclick: () => {
          if (Date.now() - resetArmed < 4000) { p.resetStats(); resetArmed = 0; resetBtn.textContent = 'Reset stats'; }
          else { resetArmed = Date.now(); resetBtn.textContent = 'Click again to reset'; setTimeout(() => { if (resetBtn.isConnected) resetBtn.textContent = 'Reset stats'; }, 4000); }
        },
      }, 'Reset stats');
      refs.head = h('span');
      refs.points = h('b.points');
      b.append(
        h('div.status-head', null, h('span', { text: p.name }), refs.head),
        h('div.status-cols', null, rows, derived),
        h('div.status-foot', null, h('span', null, 'Stat points ', refs.points), resetBtn),
        h('p.hint', { text: 'The small number is the point cost of the next raise. Hold + to keep raising.' }));
      built = true;
    }

    function update() {
      const p = game.player, D = p.derived;
      refs.head.textContent = `${p.jobDef.name}, Base Level ${p.baseLevel}, Job Level ${p.jobLevel}`;
      for (const k of G.Stats.KEYS) {
        const r = refs.rows[k], base = p.stats[k], bonus = D.total[k] - base, cost = G.Stats.cost(base);
        r.val.textContent = String(base);
        r.bonus.textContent = bonus ? ` +${bonus}` : '';
        r.plus.disabled = !(p.statPoints >= cost && base < G.Stats.MAX_STAT);
        r.cost.textContent = base < G.Stats.MAX_STAT ? String(cost) : 'max';
      }
      const v = {
        ATK: `${D.statusAtk} + ${D.weaponAtk + D.atkBonus}`, MATK: `${D.matkMin} ~ ${D.matkMax}`, HIT: D.hit, FLEE: D.flee,
        DEF: `${D.def} + ${D.softDef}`, MDEF: `${D.mdef} + ${D.softMdef}`, CRIT: D.crit, ASPD: D.aspd,
      };
      for (const n in v) refs.derived[n].textContent = String(v[n]);
      refs.points.textContent = String(p.statPoints);
    }

    win.render = () => { if (!built) build(); update(); };
    game.events.on('statsChanged', () => { if (built && W.isOpen('status')) update(); });
    game.events.on('levelChanged', () => { if (built && W.isOpen('status')) update(); });
    return win;
  }

  /* ===================================================== Inventory */
  function inventoryWindow(game) {
    const W = game.windows;
    let tab = 'all', selected = null;
    const win = W.create('inventory', 'Inventory', { width: 372, keyHint: 'Alt+E', pos: () => ({ x: window.innerWidth - 392, y: 120 }) });
    const TABS = [['all', 'All'], ['use', 'Items'], ['equip', 'Gear'], ['etc', 'Etc']];

    function act(entry) {
      const inv = game.player.inventory;
      const item = G.Items.get(entry.id);
      if (item.type === 'equip') inv.equip(entry.uid); else inv.use(entry.uid);
    }
    win.dropSelected = (uid, qty) => {
      const p = game.player, e = p.inventory.find(uid);
      if (!e) return;
      const n = p.inventory.remove(uid, qty);
      game.loot.spawn(e.id, n, p.position.x, p.position.z);
      game.log.add(`Dropped ${G.Items.get(e.id).name}${n > 1 ? ' ×' + n : ''}.`, 'info');
      if (!p.inventory.find(uid)) selected = null;
    };

    win.render = () => {
      const p = game.player, inv = p.inventory, b = win.body;
      b.textContent = '';
      const tabs = h('div.tabs', { role: 'tablist' }, TABS.map(([id, label]) => h('button.tab' + (tab === id ? '.on' : ''), {
        type: 'button', role: 'tab', 'aria-selected': String(tab === id), onclick: () => { tab = id; win.render(); },
      }, label)));
      const grid = h('div.grid');
      const list = inv.items.filter((e) => tab === 'all' || G.Items.get(e.id).type === tab);
      const cells = Math.max(35, Math.ceil(list.length / 7) * 7);
      for (let i = 0; i < cells; i++) {
        const e = list[i];
        if (!e) { grid.append(h('div.cell.empty')); continue; }
        const item = G.Items.get(e.id);
        const cell = h('div.cell' + (selected === e.uid ? '.sel' : '') + '.r-' + item.rarity, {
          draggable: 'true', tabindex: '0', role: 'button', 'aria-label': `${item.name}${e.qty > 1 ? ', ' + e.qty : ''}`,
          onclick: () => { selected = e.uid; win.render(); },
          ondblclick: () => { act(e); },
          oncontextmenu: (ev) => { ev.preventDefault(); act(e); },
          onkeydown: (ev) => { if (ev.key === 'Enter') act(e); },
          ondragstart: (ev) => { ev.dataTransfer.setData('text/x-item', JSON.stringify({ uid: e.uid, id: e.id })); ev.dataTransfer.effectAllowed = 'copyMove'; G.Tooltip.hide(); },
        }, h('img', { src: G.Icons.url(e.id), alt: '', draggable: 'false' }), e.qty > 1 ? h('span.qty', { text: String(e.qty) }) : null);
        G.Tooltip.bind(cell, () => G.itemTooltip(e, p, { hint: item.type === 'equip' ? 'Double-click to equip.' : item.type === 'use' ? 'Double-click or right-click to use. Drag to the hotbar.' : '' }));
        grid.append(cell);
      }

      // Actions for the selected item.
      const sel = selected != null ? inv.find(selected) : null;
      const actions = h('div.actions');
      if (sel) {
        const item = G.Items.get(sel.id);
        const qty = h('input.qtyin', { type: 'number', min: '1', max: String(sel.qty), value: String(sel.qty), 'aria-label': 'Quantity to drop' });
        actions.append(
          h('span.selname', { text: item.name }),
          item.type !== 'etc' ? h('button.btn.small', { type: 'button', onclick: () => act(sel) }, item.type === 'equip' ? 'Equip' : 'Use') : null,
          sel.qty > 1 ? qty : null,
          h('button.btn.small.ghost', { type: 'button', onclick: () => win.dropSelected(sel.uid, sel.qty > 1 ? Math.max(1, Math.min(sel.qty, parseInt(qty.value, 10) || 1)) : 1) }, 'Drop'));
      } else {
        actions.append(h('span.hint', { text: 'Select an item for actions. Drag items onto the hotbar or the ground.' }));
      }

      const w = inv.weight(), max = p.derived.maxWeight, pct = w / max;
      b.append(tabs, grid, actions,
        h('div.inv-foot', null,
          h('div.wbar' + (pct >= 0.9 ? '.heavy' : ''), { title: 'Over 90% stops natural HP and SP recovery.' },
            h('i', { style: `transform:scaleX(${Math.min(1, pct)})` }), h('b', { text: `Weight ${w} / ${max}` })),
          h('span.zeny', null, h('img', { src: G.Icons.url('zeny'), alt: '' }), `${p.zeny.toLocaleString()} z`),
          h('button.btn.small.ghost', { type: 'button', onclick: () => inv.sort() }, 'Sort')));
    };
    return win;
  }

  /* ===================================================== Equipment */
  function equipmentWindow(game) {
    const W = game.windows;
    const win = W.create('equipment', 'Equipment', { width: 420, keyHint: 'Alt+Q', pos: () => ({ x: window.innerWidth - 822, y: 120 }) });
    const LEFT = ['headTop', 'headMid', 'headLow', 'armor', 'acc1'];
    const RIGHT = ['weapon', 'shield', 'garment', 'shoes', 'acc2'];
    win.el.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/x-item')) e.preventDefault(); });
    win.el.addEventListener('drop', (e) => {
      const d = e.dataTransfer.getData('text/x-item');
      if (!d) return;
      e.preventDefault();
      const { uid } = JSON.parse(d);
      if (uid) game.player.inventory.equip(uid);
    });

    function slotEl(slotId) {
      const p = game.player, e = p.equipment[slotId];
      const def = G.Items.EQUIP_SLOTS.find((s) => s.id === slotId);
      const SHORT = { headTop: 'Upper head', headMid: 'Middle head', headLow: 'Lower head' };
      const item = e && G.Items.get(e.id);
      const el = h('div.eslot' + (e ? '.full' : ''), {
        tabindex: e ? '0' : null, role: e ? 'button' : null,
        'aria-label': e ? `${def.name}: ${item.name}` : `${def.name}: empty`,
        ondblclick: () => { if (e) p.inventory.unequip(slotId); },
        oncontextmenu: (ev) => { ev.preventDefault(); if (e) p.inventory.unequip(slotId); },
        onkeydown: (ev) => { if (ev.key === 'Enter' && e) p.inventory.unequip(slotId); },
      },
      h('div.eicon', null, e ? h('img', { src: G.Icons.url(e.id), alt: '' }) : null),
      h('div.etext', null, h('small', { text: SHORT[slotId] || def.name }), h('span', { text: e ? item.name : 'Empty' })));
      if (e) G.Tooltip.bind(el, () => G.itemTooltip(e, p, { equipped: true, hint: 'Double-click to remove.' }));
      return el;
    }

    win.render = () => {
      const p = game.player, D = p.derived, b = win.body;
      b.textContent = '';
      const portrait = h('canvas.portrait', { width: '120', height: '150', 'aria-hidden': 'true' });
      const sheet = p.sprite.sheet, cx = portrait.getContext('2d');
      const a = sheet.anims.idle, cell = a.start; // front-facing, first idle frame
      const col = cell % sheet.cols, row = (cell / sheet.cols) | 0;
      cx.drawImage(sheet.canvas, col * sheet.frameW + 10, row * sheet.frameH, sheet.frameW - 20, sheet.frameH, -5, 0, 130, 150);
      b.append(
        h('div.paperdoll', null,
          h('div.ecol', null, LEFT.map(slotEl)),
          h('div.pcenter', null, portrait),
          h('div.ecol', null, RIGHT.map(slotEl))),
        h('div.esum', null,
          h('span', null, 'ATK ', h('b', { text: `${D.statusAtk + D.weaponAtk + D.atkBonus}` })),
          h('span', null, 'DEF ', h('b', { text: `${D.def}` })),
          h('span', null, 'MATK ', h('b', { text: `${D.matkMax}` })),
          h('span', null, 'MDEF ', h('b', { text: `${D.mdef}` })),
          h('span', null, 'ASPD ', h('b', { text: `${D.aspd}` }))),
        h('p.hint', { text: 'Drag gear here or double-click it in your inventory to equip. Double-click a slot to remove.' }));
    };
    return win;
  }

  /* ===================================================== Options */
  function optionsWindow(game) {
    const W = game.windows;
    let delArmed = 0;
    const win = W.create('options', 'Options', { width: 320, keyHint: 'O', pos: () => ({ x: window.innerWidth / 2 - 160, y: 140 }) });
    win.render = () => {
      const cam = game.camera.settings, b = win.body;
      b.textContent = '';
      const slider = (label, key, min, max) => {
        const out = h('output', { text: cam[key].toFixed(2) });
        const input = h('input', {
          type: 'range', min: String(min), max: String(max), step: '0.05', value: String(cam[key]), 'aria-label': label,
          oninput: (e) => { cam[key] = parseFloat(e.target.value); out.textContent = cam[key].toFixed(2); game.camera.saveSettings(); },
        });
        return h('label.opt', null, h('span', { text: label }), input, out);
      };
      const del = h('button.btn.small.danger', {
        type: 'button',
        onclick: () => {
          if (Date.now() - delArmed < 4000) { game.save.enabled = false; G.SaveSystem.clear(); location.reload(); }
          else { delArmed = Date.now(); del.textContent = 'Click again to delete for good'; setTimeout(() => { if (del.isConnected) del.textContent = 'Delete character'; }, 4000); }
        },
      }, 'Delete character');
      b.append(
        h('h3', { text: 'Camera' }),
        slider('Rotation sensitivity', 'rotSens', 0.3, 2.5),
        slider('Vertical sensitivity', 'pitchSens', 0.3, 2.5),
        slider('Zoom sensitivity', 'zoomSens', 0.3, 2.5),
        h('label.opt.check', null,
          h('input', { type: 'checkbox', checked: cam.invertY, onchange: (e) => { cam.invertY = e.target.checked; game.camera.saveSettings(); } }),
          h('span', { text: 'Invert vertical camera movement' })),
        h('div.opt-btns', null,
          h('button.btn.small', { type: 'button', onclick: () => game.camera.reset() }, 'Reset camera'),
          h('button.btn.small', { type: 'button', onclick: () => { cam.rotSens = cam.pitchSens = cam.zoomSens = 1; cam.invertY = false; game.camera.saveSettings(); win.render(); } }, 'Default settings')),
        h('h3', { text: 'Game' }),
        h('label.opt.check', null,
          h('input', { type: 'checkbox', checked: !!game.autoLoot, onchange: (e) => game.extras.setAutoLoot(e.target.checked) }),
          h('span', { text: 'Auto-loot: items from your kills go straight to your bag (L)' })),
        h('label.opt.check', null,
          h('input', { type: 'checkbox', checked: !!(game.extras && game.extras.debug), onchange: (e) => game.extras.setDebug(e.target.checked) }),
          h('span', { text: 'Show debug tools (level-up buttons, ` key)' })),
        h('div.opt-btns', null,
          h('button.btn.small', { type: 'button', onclick: () => game.save.save() }, 'Save now'),
          del),
        h('p.hint', { text: 'Your progress also saves automatically every 30 seconds and when you close the tab.' }));
    };
    return win;
  }

  /* ===================================================== Menu bar */
  function menuBar(game) {
    const el = document.getElementById('menubar');
    const items = [
      ['status', 'Status', 'Alt+A'], ['inventory', 'Items', 'Alt+E'], ['equipment', 'Gear', 'Alt+Q'], ['skills', 'Skills', 'Alt+S'], ['options', 'Options', 'O'],
    ];
    const btns = {};
    items.forEach(([id, label, key]) => {
      const b = h('button.mbtn', { type: 'button', 'aria-pressed': 'false', onclick: () => game.windows.toggle(id) }, label, h('kbd', { text: key }));
      btns[id] = b; el.append(b);
    });
    const loot = h('button.mbtn.toggle', { type: 'button', 'aria-pressed': String(!!game.autoLoot), onclick: () => game.extras.setAutoLoot(!game.autoLoot) }, 'Auto-loot', h('kbd', { text: 'L' }));
    el.prepend(loot);
    el.append(h('button.mbtn', { type: 'button', onclick: () => game.save.save() }, 'Save'));
    return {
      sync() {
        for (const id in btns) btns[id].setAttribute('aria-pressed', String(game.windows.isOpen(id)));
        loot.setAttribute('aria-pressed', String(!!game.autoLoot));
      },
    };
  }

  G.Panels = { statusWindow, inventoryWindow, equipmentWindow, optionsWindow, menuBar };
})(window.G = window.G || {});
