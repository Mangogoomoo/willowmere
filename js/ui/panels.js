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
    const TABS = [['all', 'All'], ['use', 'Items'], ['equip', 'Gear'], ['card', 'Cards'], ['etc', 'Etc']];

    // Right-click moves an item into whatever is open: the trade, storage or the cart.
    function sendElsewhere(entry) {
      const W = game.windows;
      if (W.isOpen('trade') && G.Trade && G.Trade.state) { G.Trade.offerItem(entry, entry.qty); return true; }
      if (W.isOpen('storage')) { game.storage.deposit(entry.uid, entry.qty); return true; }
      if (W.isOpen('cart') && game.cart && game.cart.has) { game.cart.put(entry.uid, entry.qty); return true; }
      return false;
    }
    function act(entry) {
      const inv = game.player.inventory;
      const item = G.Items.get(entry.id);
      if (item.type === 'card') { cardWindow(game).openFor(entry); return; }
      if (item.type === 'equip') inv.equip(entry.uid); else inv.use(entry.uid);
    }
    win.dropSelected = (uid, qty) => {
      const p = game.player, e = p.inventory.find(uid);
      if (!e) return;
      if (game.windows.isOpen('storage')) { game.log.add('Close your storage before dropping items on the ground.', 'warn'); return; }
      if (G.CustomMaps && G.CustomMaps.rule('noDrop')) { game.log.add('You can’t drop items on this map.', 'warn'); return; }
      const n = p.inventory.remove(uid, qty);
      game.loot.nextAttrs = { refine: e.refine || 0, cards: e.cards || [], forgedBy: e.forgedBy, element: e.element };
      game.loot.spawn(e.id, n, p.position.x, p.position.z);
      game.loot.nextAttrs = null;
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
        const cell = h('div.cell' + (selected === e.uid ? '.sel' : '') + '.r-' + item.rarity + (G.Items.isCarded(e) ? '.carded' : ''), {
          draggable: 'true', tabindex: '0', role: 'button', 'aria-label': `${G.Items.displayName(e)}${e.qty > 1 ? ', ' + e.qty : ''}`,
          'data-slot': item.type === 'card' ? G.Items.CARD_SLOTS[item.cardSlot].long : null,
          onclick: () => { selected = e.uid; win.render(); },
          ondblclick: () => { act(e); },
          oncontextmenu: (ev) => { ev.preventDefault(); if (!sendElsewhere(e)) act(e); },
          onkeydown: (ev) => { if (ev.key === 'Enter') act(e); },
          ondragstart: (ev) => { ev.dataTransfer.setData('text/x-item', JSON.stringify({ uid: e.uid, id: e.id })); ev.dataTransfer.effectAllowed = 'copyMove'; G.Tooltip.hide(); },
        }, h('img', { src: G.Icons.url(e.id), alt: '', draggable: 'false' }), e.qty > 1 ? h('span.qty', { text: String(e.qty) }) : null,
          item.type === 'card' ? h('span.cslot', { text: G.Items.CARD_SLOTS[item.cardSlot].tag, title: `Goes into: ${G.Items.CARD_SLOTS[item.cardSlot].long}` }) : null,
          e.refine ? h('span.refbadge', { text: '+' + e.refine }) : null);
        G.Tooltip.bind(cell, () => G.itemTooltipCompare(e, p, { hint: (game.windows.isOpen('trade') ? 'Right-click to offer it in the trade. ' : game.windows.isOpen('storage') ? 'Right-click to put it in storage. ' : game.windows.isOpen('cart') ? 'Right-click to put it in the cart. ' : '')
          + (item.type === 'equip' ? 'Double-click to equip.' : item.type === 'use' ? 'Double-click or right-click to use. Drag to the hotbar.' : item.type === 'card' ? 'Double-click to insert into equipment.' : '') }));
        grid.append(cell);
      }

      // Actions for the selected item.
      const sel = selected != null ? inv.find(selected) : null;
      const actions = h('div.actions');
      if (sel) {
        const item = G.Items.get(sel.id);
        const qty = h('input.qtyin', { type: 'number', min: '1', max: String(sel.qty), value: String(sel.qty), 'aria-label': 'Quantity to drop' });
        actions.append(
          h('span.selname' + (G.Items.isCarded(sel) ? '.carded' : ''), { text: G.Items.displayName(sel) }),
          item.type !== 'etc' ? h('button.btn.small', { type: 'button', onclick: () => act(sel) }, item.type === 'equip' ? 'Equip' : item.type === 'card' ? 'Insert' : 'Use') : null,
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

  /* ===================================================== Card insertion */
  let cardWin = null;
  function cardWindow(game) {
    if (cardWin) return cardWin;
    const W = game.windows;
    const win = W.create('cards', 'Insert card', { width: 330, pos: () => ({ x: window.innerWidth / 2 - 165, y: 140 }) });
    let cardEntry = null, armed = null;
    win.openFor = (entry) => { cardEntry = entry; armed = null; W.open('cards'); win.render(); };
    win.render = () => {
      const p = game.player, b = win.body;
      b.textContent = '';
      if (!cardEntry || !p.inventory.find(cardEntry.uid)) { b.append(h('p.hint', { text: 'Double-click a card in your inventory to insert it.' })); return; }
      const card = G.Items.get(cardEntry.id);
      b.append(h('div.card-head', null, h('img', { src: G.Icons.url(card.id), alt: '' }),
        h('div', null, h('b', { text: card.name }), h('small', { text: `Fits ${G.Items.CARD_SLOTS[card.cardSlot].name.toLowerCase()} with a free slot` }))));
      const targets = p.inventory.cardTargets(card);
      if (!targets.length) b.append(h('p.hint', { text: 'None of your gear can take this card. You need slotted equipment of the right kind, with a free card slot.' }));
      for (const t of targets) {
        const it = G.Items.get(t.entry.id), free = it.slots - (t.entry.cards || []).length;
        const btn = h('button.btn.small', { type: 'button' }, armed === t.entry ? 'Confirm' : 'Insert');
        btn.addEventListener('click', () => {
          if (armed !== t.entry) { armed = t.entry; win.render(); return; }
          if (p.inventory.insertCard(cardEntry.uid, t)) { cardEntry = null; W.close('cards'); }
        });
        const row = h('div.shop-row', null, h('img', { src: G.Icons.url(t.entry.id), alt: '' }),
          h('span.sname2' + (G.Items.isCarded(t.entry) ? '.carded' : ''), null, G.Items.displayName(t.entry), h('small', { text: t.worn ? ' (worn)' : '' })),
          h('span.sprice', { text: `${free} free` }), h('span'), btn);
        G.Tooltip.bind(row, () => G.itemTooltip(t.entry, p, { equipped: t.worn }));
        b.append(row);
      }
      b.append(h('p.hint', { text: armed ? 'Cards can’t be removed once inserted. Click Confirm to go ahead.' : 'Pick the equipment to insert the card into.' }));
    };
    cardWin = win;
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
        'aria-label': e ? `${def.name}: ${G.Items.displayName(e)}` : `${def.name}: empty`,
        ondblclick: () => { if (e) p.inventory.unequip(slotId); },
        oncontextmenu: (ev) => { ev.preventDefault(); if (e) p.inventory.unequip(slotId); },
        onkeydown: (ev) => { if (ev.key === 'Enter' && e) p.inventory.unequip(slotId); },
      },
      h('div.eicon', null, e ? h('img', { src: G.Icons.url(e.id), alt: '' }) : null),
      h('div.etext', null, h('small', { text: SHORT[slotId] || def.name }), h('span' + (G.Items.isCarded(e) ? '.carded' : ''), { text: e ? G.Items.displayName(e) : 'Empty' })));
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
          h('button.btn.small', { type: 'button', onclick: () => { game.save.save(true); game.save.enabled = false; location.reload(); } }, 'Character select'),
          h('button.btn.small', { type: 'button', onclick: () => { cam.rotSens = cam.pitchSens = cam.zoomSens = 1; cam.invertY = false; game.camera.saveSettings(); win.render(); } }, 'Default settings')),
        h('h3', { text: 'Sound' }),
        ...[['Master volume', 'master'], ['Music', 'music'], ['Sound effects', 'sfx']].map(([label, key]) => {
          const a = game.audio.settings, out = h('output', { text: Math.round(a[key] * 100) + '%' });
          return h('label.opt', null, h('span', { text: label }), h('input', {
            type: 'range', min: '0', max: '1', step: '0.05', value: String(a[key]), 'aria-label': label,
            oninput: (e) => { a[key] = parseFloat(e.target.value); out.textContent = Math.round(a[key] * 100) + '%'; game.audio.saveSettings(); },
          }), out);
        }),
        h('label.opt.check', null,
          h('input', { type: 'checkbox', checked: !!game.audio.settings.muted, onchange: (e) => { game.audio.settings.muted = e.target.checked; game.audio.saveSettings(); } }),
          h('span', { text: 'Mute all sound' })),
        h('h3', { text: 'Graphics' }),
        h('div.opt-btns', { role: 'radiogroup', 'aria-label': 'Graphics quality' }, ['high', 'medium', 'low'].map((q) => h('button.btn.small' + (game.quality === q ? '' : '.ghost'), {
          type: 'button', role: 'radio', 'aria-checked': String(game.quality === q), onclick: () => { game.setQuality(q); win.render(); },
        }, q[0].toUpperCase() + q.slice(1)))),
        h('label.opt.check', null,
          h('input', { type: 'checkbox', checked: !document.getElementById('fps').hidden, onchange: (e) => { document.getElementById('fps').hidden = !e.target.checked; G.SaveSystem.setPrefs({ fps: e.target.checked }); } }),
          h('span', { text: 'Show frames per second' })),
        h('h3', { text: 'Controls' }),
        h('div.opt-btns', null, h('button.btn.small', { type: 'button', onclick: () => keysWindow(game).open() }, 'Key bindings…'),
          h('button.btn.small', { type: 'button', onclick: () => G.PatchNotes.open() }, `Patch notes (v${G.PatchNotes.LATEST})`)),
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

  /* ===================================================== Key bindings */
  let keysWin = null;
  function keysWindow(game) {
    if (keysWin) return keysWin;
    const W = game.windows, KB = G.Keybinds;
    const win = W.create('keys', 'Key bindings', { width: 400, pos: () => ({ x: window.innerWidth / 2 - 200, y: 80 }) });
    let capture = null;   // { action, slot, btn }
    const finish = () => { capture = null; game.input.capturing = false; win.render(); game.hotbar.renderKeys(); game.menu.relabel(); };
    window.addEventListener('keydown', (e) => {
      if (!capture) return;
      e.preventDefault(); e.stopPropagation();
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;   // wait for the real key
      if (e.key === 'Escape') { finish(); return; }
      if (e.key === 'Backspace' || e.key === 'Delete') { KB.set(capture.action, capture.slot, ''); finish(); return; }
      const combo = KB.comboFromEvent(e);
      if (!combo) return;
      const stolen = KB.set(capture.action, capture.slot, combo);
      if (stolen) game.log.add(`${combo} was moved from “${KB.actionLabel(stolen)}”.`, 'info');
      finish();
    }, true);
    win.open = () => { W.open('keys'); win.render(); };
    win.render = () => {
      const b = win.body;
      b.textContent = '';
      const list = h('div.keylist');
      for (const a of KB.ACTIONS) {
        const btn = (slot) => {
          const k = KB.map[a.id][slot];
          const el = h('button.keybtn' + (capture && capture.action === a.id && capture.slot === slot ? '.listening' : ''), {
            type: 'button', 'aria-label': `${a.label}, ${slot ? 'secondary' : 'primary'} key: ${k || 'none'}`,
            onclick: () => { capture = { action: a.id, slot }; game.input.capturing = true; win.render(); },
          }, capture && capture.action === a.id && capture.slot === slot ? 'Press a key…' : (k || '—'));
          return el;
        };
        list.append(h('div.keyrow', null, h('span', { text: a.label }), btn(0), btn(1)));
      }
      b.append(list,
        h('div.opt-btns', null, h('button.btn.small.ghost', { type: 'button', onclick: () => { KB.reset(); finish(); } }, 'Reset to defaults')),
        h('p.hint', { text: 'Click a key, then press the new one (Alt and Ctrl combinations work). Backspace clears it, Esc cancels. Esc and Shift (compare gear) are fixed.' }));
    };
    keysWin = win;
    return win;
  }

  /* ===================================================== Menu bar */
  function menuBar(game) {
    const el = document.getElementById('menubar');
    const items = [
      ['status', 'Status', 'Alt+A'], ['inventory', 'Items', 'Alt+E'], ['equipment', 'Gear', 'Alt+Q'], ['skills', 'Skills', 'Alt+S'], ['quests', 'Quests', 'U'], ['party', 'Party', 'Alt+Z'], ['guild', 'Guild', 'Alt+G'], ['options', 'Options', 'O'],
    ];
    const btns = {};
    items.forEach(([id, label]) => {
      const b = h('button.mbtn', { type: 'button', 'aria-pressed': 'false', onclick: () => game.windows.toggle(id) }, label, h('kbd', { text: G.Keybinds.primary(id) }));
      btns[id] = b; el.append(b);
    });
    const loot = h('button.mbtn.toggle', { type: 'button', 'aria-pressed': String(!!game.autoLoot), onclick: () => game.extras.setAutoLoot(!game.autoLoot) }, 'Auto-loot', h('kbd', { text: G.Keybinds.primary('autoloot') }));
    el.prepend(loot);
    el.append(h('button.mbtn', { type: 'button', title: 'What changed in each update', onclick: () => G.PatchNotes.open() }, 'Patch notes', h('kbd', { text: 'v' + G.PatchNotes.LATEST })));
    el.append(h('button.mbtn', { type: 'button', title: 'Monster and item encyclopedia (opens in a new tab)', onclick: () => window.open(G.Config.DB_URL, '_blank', 'noopener') }, 'Database', h('kbd', { text: '↗' })));
    // Hide / show the whole button column (remembered).
    const collapsed = !!G.SaveSystem.prefs().menuHidden;
    const tog = h('button.mbtn.menu-toggle', { type: 'button', 'aria-expanded': String(!collapsed) }, collapsed ? '▲ Show menu' : '▼ Hide menu');
    tog.addEventListener('click', () => {
      const hide = !el.classList.contains('collapsed');
      el.classList.toggle('collapsed', hide);
      tog.textContent = hide ? '▲ Show menu' : '▼ Hide menu';
      tog.setAttribute('aria-expanded', String(!hide));
      G.SaveSystem.setPrefs({ menuHidden: hide });
    });
    el.prepend(tog);
    el.classList.toggle('collapsed', collapsed);
    el.append(h('button.mbtn', { type: 'button', onclick: () => game.save.save() }, 'Save'));
    return {
      relabel() {
        for (const id in btns) btns[id].querySelector('kbd').textContent = G.Keybinds.primary(id) || '·';
        loot.querySelector('kbd').textContent = G.Keybinds.primary('autoloot') || '·';
      },
      sync() {
        for (const id in btns) btns[id].setAttribute('aria-pressed', String(game.windows.isOpen(id)));
        loot.setAttribute('aria-pressed', String(!!game.autoLoot));
      },
    };
  }

  /* ===================================================== Quest log */
  function questsWindow(game) {
    const W = game.windows;
    let tab = 'active';
    const win = W.create('quests', 'Quest log', { width: 380, keyHint: 'U', pos: () => ({ x: window.innerWidth - 400, y: 130 }) });
    win.render = () => {
      const Q = game.questlog, b = win.body;
      b.textContent = '';
      b.append(h('div.tabs', null, [['active', 'Active'], ['available', 'Available'], ['done', 'Completed']].map(([id, label]) => h('button.tab' + (tab === id ? '.on' : ''), {
        type: 'button', onclick: () => { tab = id; win.render(); },
      }, label))));
      const list = h('div.qlist');
      const giverName = (id) => (G.NPC_DEFS.find((n) => n.id === id) || { name: '?' }).name;
      if (tab === 'active') {
        const trial = game.quests.status();
        if (trial) {
          const job = G.Jobs.get(game.quests.trial.job);
          list.append(h('div.quest', null, h('b', { text: `${job.name} trial` }), h('small', { text: 'From Master Rowan' }),
            h('p', { text: job.trial.text }),
            ...trial.lines.map((l) => h('div.tr-line' + (l.have >= l.need ? '.done' : ''), null, h('span', { text: l.label }), h('b', { text: `${l.have} / ${l.need}` })))));
        }
        const act = Q.active();
        if (!act.length && !trial) list.append(h('p.hint', { text: 'No active quests. Captain Brin of the Adventurers’ Guild, on the west street of town, has work for you.' }));
        for (const q of act) {
          const ready = Q.isComplete(q.def, q.st);
          const abandon = h('button.btn.small.ghost', { type: 'button', onclick: () => { if (abandon.dataset.armed) { Q.abandon(q.def.id); win.render(); } else { abandon.dataset.armed = '1'; abandon.textContent = 'Click again to abandon'; } } }, 'Abandon');
          list.append(h('div.quest' + (ready ? '.ready' : ''), null,
            h('b', { text: q.def.name }), h('small', { text: ready ? `Ready! Return to ${giverName(q.def.giver)}.` : `From ${giverName(q.def.giver)}` }),
            h('p', { text: q.def.text }),
            ...Q.progress(q.def, q.st).map((l) => h('div.tr-line' + (l.have >= l.need ? '.done' : ''), null, h('span', { text: l.label }), h('b', { text: `${l.have} / ${l.need}` }))),
            h('div.qreward', { text: `Rewards: ${Q.rewardText(q.def)}` }), abandon));
        }
      } else if (tab === 'available') {
        const av = Q.available();
        if (!av.length) list.append(h('p.hint', { text: 'Nothing new right now. More quests open as you level up and finish others.' }));
        for (const q of av) list.append(h('div.quest', null, h('b', { text: q.name }), h('small', { text: `Ask ${giverName(q.giver)}` }),
          h('p', { text: q.text }), h('div.qreward', { text: `Rewards: ${Q.rewardText(q)}` })));
      } else {
        const done = Q.done();
        if (!done.length) list.append(h('p.hint', { text: 'No quests completed yet.' }));
        for (const q of done) list.append(h('div.quest.finished', null, h('b', { text: `✓ ${q.name}` }), h('small', { text: Q.rewardText(q) })));
      }
      b.append(list);
    };
    game.events.on('questsChanged', () => W.refresh('quests'));
    return win;
  }

  G.Panels = { questsWindow, statusWindow, inventoryWindow, equipmentWindow, optionsWindow, menuBar };
})(window.G = window.G || {});
