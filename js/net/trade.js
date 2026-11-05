/* Right-click menu on other players, gear inspection, and classic trading:
   both players put up to 10 items and some Zeny on the table, press OK to
   lock their offer, then both press Trade to swap. */
(function (G) {
  'use strict';
  const h = G.h;
  const Trade = {
    init(game) {
      if (this.game) return;
      this.game = game;
      const W = game.windows;
      this.inspectWin = W.create('inspect', 'Equipment', { width: 420, pos: () => ({ x: window.innerWidth / 2 - 210, y: 90 }) });
      this.tradeWin = W.create('trade', 'Trade', { width: 640, pos: () => ({ x: Math.max(16, Math.min(window.innerWidth / 2 - 320, window.innerWidth - 1090)), y: 100 }) });   // leaves room for the inventory on the right
      this.tradeWin.render = () => this.renderTrade();
      this.menu = h('div.ctx-menu', { hidden: true, role: 'menu' });
      document.body.append(this.menu);
      document.addEventListener('pointerdown', (e) => { if (!this.menu.hidden && !this.menu.contains(e.target)) this.menu.hidden = true; });
      // Right-click (without dragging the camera) on another player opens the menu.
      const canvas = game.renderer.domElement;
      let down = null;
      canvas.addEventListener('pointerdown', (e) => { if (e.button === 2) down = { x: e.clientX, y: e.clientY }; });
      canvas.addEventListener('pointerup', (e) => {
        if (e.button !== 2 || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
        const r = this.pick(e);
        if (r) this.openMenu(r, e.clientX, e.clientY);
      });
      // Drop items from the inventory onto your side of the trade window.
      this.tradeWin.el.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/x-item')) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } });
      this.tradeWin.el.addEventListener('drop', (e) => {
        const d = e.dataTransfer.getData('text/x-item'); if (!d) return;
        e.preventDefault();
        const it = game.player.inventory.find(JSON.parse(d).uid); if (!it) return;
        let qty = it.qty;
        if (e.shiftKey && qty > 1) { const n = parseInt(prompt(`How many? (1–${qty})`, String(qty)), 10); if (!n) return; qty = Math.max(1, Math.min(qty, n)); }
        this.offerItem(it, qty);
      });
    },
    pick(e) {
      if (!G.Net || !G.Net.players.size) return null;
      const rect = this.game.renderer.domElement.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), this.game.camera3);
      return this.game.input.pickRemote(ray.ray);
    },
    openMenu(r, x, y) {
      const S = G.Social, me = G.Net.charId;
      const canGuild = S.guild && (S.guild.master === me || ((S.guild.members.find((m) => m.id === me) || {}).rank <= 1));
      const items = [
        ['Invite to party', S.party && S.party.leader === me, () => G.Net.send({ t: 'party_invite', name: r.name })],
        ['Invite to guild', !!canGuild, () => G.Net.send({ t: 'guild_invite', name: r.name })],
        ['Inspect gear', true, () => G.Net.send({ t: 'inspect_req', to: r.id })],
        ['Trade', true, () => G.Net.send({ t: 'trade_request', to: r.id })],
      ];
      this.menu.textContent = '';
      this.menu.append(h('div.ctx-title', { text: r.name }), ...items.map(([label, ok, go]) => h('button.ctx-item', {
        type: 'button', role: 'menuitem', disabled: !ok, title: ok ? '' : (label.includes('party') ? 'Only a party leader can invite' : 'Only the Guild Leader and Officers can invite'),
        onclick: () => { this.menu.hidden = true; go(); },
      }, label)));
      this.menu.hidden = false;
      this.menu.style.left = Math.min(x, window.innerWidth - 190) + 'px';
      this.menu.style.top = Math.min(y, window.innerHeight - 170) + 'px';
      const first = this.menu.querySelector('.ctx-item:not([disabled])'); if (first) first.focus();
    },

    handle(m) {
      const game = this.game, p = game.player;
      if (m.t === 'inspect_req') {
        // Someone inspects us: send what we wear (names, refines, cards).
        const equip = Object.entries(p.equipment).filter(([, e]) => e).map(([slot, e]) => ({ slot, id: e.id, refine: e.refine || 0, cards: e.cards || [], forgedBy: e.forgedBy, element: e.element }));
        const D = p.derived;
        const stats = { base: p.stats, total: D.total, atk: D.statusAtk + D.weaponAtk + D.atkBonus, matk: D.matkMax, def: D.def, mdef: D.mdef, aspd: D.aspd,
          hit: D.hit, flee: D.flee, crit: D.crit, maxHp: p.maxHp, maxSp: p.maxSp, jobLevel: p.jobLevel };
        G.Net.send({ t: 'inspect_res', to: m.from, job: p.job, level: p.baseLevel, equip, stats, look: G.Net.myLook() });
      } else if (m.t === 'inspect_res') this.showInspect(m);
      else if (m.t === 'trade_ask') this.ask(m);
      else if (m.t === 'trade_open') { this.state = { mine: { items: [], zeny: 0 }, theirs: { items: [], zeny: 0 } }; this.partner = m.with; game.windows.open('trade'); game.windows.open('inventory'); this.renderTrade(); game.sfx('talk'); }
      else if (m.t === 'trade_state') { this.state = m; this.renderTrade(); }
      else if (m.t === 'trade_closed') { this.state = null; game.windows.close('trade'); game.log.add(m.text, 'warn'); }
      else if (m.t === 'trade_done') this.finish(m);
    },
    ask(m) {
      const W = this.game.windows;
      const w = this.askWin || (this.askWin = W.create('trade_ask', 'Trade request', { width: 280, pos: () => ({ x: window.innerWidth / 2 - 140, y: 170 }) }));
      const answer = (yes) => { G.Net.send({ t: 'trade_reply', accept: yes }); W.close('trade_ask'); };
      w.render = () => { w.body.textContent = ''; w.body.append(h('p', { text: `${m.from} wants to trade with you.` }), h('div.opt-btns', null, h('button.btn.small', { type: 'button', onclick: () => answer(true) }, 'Trade'), h('button.btn.small.ghost', { type: 'button', onclick: () => answer(false) }, 'Decline'))); };
      W.open('trade_ask'); w.render(); this.game.sfx('talk');
    },
    // Inspecting another player: the same layout as your own Equipment window,
    // plus their stats.
    showInspect(m) {
      const w = this.inspectWin, me = this.game.player, st = m.stats || {}, job = G.Jobs.get(m.job);
      w.head.firstChild.textContent = `${m.name}’s equipment`;
      w.body.textContent = '';
      const eq = {}; for (const e of m.equip) eq[e.slot] = Object.assign({ qty: 1 }, e);
      const SHORT = { headTop: 'Upper head', headMid: 'Middle head', headLow: 'Lower head' };
      const slotEl = (slotId) => {
        const e = eq[slotId], def = G.Items.EQUIP_SLOTS.find((s) => s.id === slotId);
        const el = h('div.eslot' + (e ? '.full' : ''), { tabindex: e ? '0' : null, 'aria-label': e ? `${def.name}: ${G.Items.displayName(e)}` : `${def.name}: empty` },
          h('div.eicon', null, e ? h('img', { src: G.Icons.url(e.id), alt: '' }) : null),
          h('div.etext', null, h('small', { text: SHORT[slotId] || def.name }), h('span' + (G.Items.isCarded(e) ? '.carded' : ''), { text: e ? G.Items.displayName(e) : 'Empty' })));
        if (e) G.Tooltip.bind(el, () => G.itemTooltip(e, me, { equipped: true }));
        return el;
      };
      // Their character, drawn from their look.
      const portrait = h('canvas.portrait', { width: '120', height: '150', 'aria-hidden': 'true' });
      const l = m.look || {};
      const sheet = G.SpriteFactory.humanoid(l.appearance || {}, { job: l.job || m.job, weapon: l.weapon || 'dagger', unarmed: !l.weapon || l.weapon === 'none', head: l.head || {}, mount: l.mount || null, falcon: !!l.falcon });
      const cell = sheet.anims.idle.start, col = cell % sheet.cols, row = (cell / sheet.cols) | 0;
      portrait.getContext('2d').drawImage(sheet.canvas, col * sheet.frameW + 10, row * sheet.frameH, sheet.frameW - 20, sheet.frameH, -5, 0, 130, 150);
      const v = (x) => (x === undefined || x === null ? '?' : String(x));
      const stat = (k) => { const b = (st.base || {})[k] || 0, t = (st.total || {})[k] || b; return h('div.istat', null, h('span', { text: k.toUpperCase() }), h('b', { text: String(b) }), t !== b ? h('small', { text: `+${t - b}` }) : h('small')); };
      w.body.append(
        h('p.hint.inspect-who', { text: `${job ? job.name : m.job}, base level ${m.level}${st.jobLevel ? `, job level ${st.jobLevel}` : ''}` }),
        h('div.paperdoll', null,
          h('div.ecol', null, ['headTop', 'headMid', 'headLow', 'armor', 'acc1'].map(slotEl)),
          h('div.pcenter', null, portrait),
          h('div.ecol', null, ['weapon', 'shield', 'garment', 'shoes', 'acc2'].map(slotEl))),
        h('div.esum', null,
          h('span', null, 'ATK ', h('b', { text: v(st.atk) })), h('span', null, 'DEF ', h('b', { text: v(st.def) })),
          h('span', null, 'MATK ', h('b', { text: v(st.matk) })), h('span', null, 'MDEF ', h('b', { text: v(st.mdef) })),
          h('span', null, 'ASPD ', h('b', { text: v(st.aspd) }))),
        h('div.istats', null, ...['str', 'agi', 'vit', 'int', 'dex', 'luk'].map(stat)),
        h('div.esum', null,
          h('span', null, 'HIT ', h('b', { text: v(st.hit) })), h('span', null, 'FLEE ', h('b', { text: v(st.flee) })),
          h('span', null, 'CRIT ', h('b', { text: v(st.crit) })), h('span', null, 'HP ', h('b', { text: v(st.maxHp) })),
          h('span', null, 'SP ', h('b', { text: v(st.maxSp) }))));
      this.game.windows.open('inspect');
    },

    offerItem(it, qty) {
      if (!this.state || this.state.mine.locked) return;
      const item = G.Items.get(it.id);
      if (item.type === 'card' && false) return;
      G.Net.send({ t: 'trade_add', item: { uid: it.uid, id: it.id, qty, refine: it.refine || 0, cards: it.cards || [], forgedBy: it.forgedBy, element: it.element } });
    },
    renderTrade() {
      const b = this.tradeWin.body, st = this.state, p = this.game.player;
      if (!b) return;
      b.textContent = '';
      if (!st) return;
      this.tradeWin.head.firstChild.textContent = `Trade with ${this.partner || ''}`;
      const side = (title, off, mine) => {
        const grid = h('div.trade-grid');
        for (const e of off.items) {
          const cell = h('div.cell', { tabindex: '0', 'aria-label': `${G.Items.displayName(e)} ×${e.qty}` }, h('img', { src: G.Icons.url(e.id), alt: '' }), e.qty > 1 ? h('span.qty', { text: String(e.qty) }) : null, e.refine ? h('span.refbadge', { text: '+' + e.refine }) : null);
          G.Tooltip.bind(cell, () => G.itemTooltip(e, p));
          grid.append(cell);
        }
        for (let k = off.items.length; k < 10; k++) grid.append(h('div.cell.empty'));
        const zeny = mine && !off.locked
          ? h('input.soc-in', { type: 'number', min: '0', max: String(p.zeny), value: String(off.zeny || 0), 'aria-label': 'Zeny to offer', onchange: (e) => G.Net.send({ t: 'trade_zeny', amount: Math.min(p.zeny, Math.max(0, parseInt(e.target.value, 10) || 0)) }), onkeydown: (e) => e.stopPropagation() })
          : h('b', { text: `${(off.zeny || 0).toLocaleString()} z` });
        return h('div.trade-side' + (off.locked ? '.locked' : ''), null, h('div.trade-head', null, h('b', { text: title }), h('span', { text: off.ok ? 'Ready to trade' : off.locked ? 'Locked (OK)' : 'Choosing…' })), grid, h('label.trade-zeny', null, h('span', { text: 'Zeny' }), zeny));
      };
      const both = st.mine.locked && st.theirs.locked;
      b.append(h('div.trade-cols', null, side('You', st.mine, true), side(this.partner || 'Them', st.theirs, false)),
        h('p.hint', { text: st.mine.locked ? (both ? 'Both offers are locked. Press Trade to swap.' : `Waiting for ${this.partner} to press OK.`) : 'Drag items from your inventory onto this window (Shift to choose an amount), set your Zeny, then press OK to lock your offer.' }),
        h('div.opt-btns', null,
          h('button.btn.small', { type: 'button', disabled: st.mine.locked, onclick: () => G.Net.send({ t: 'trade_lock' }) }, 'OK'),
          h('button.btn.small', { type: 'button', disabled: !both || st.mine.ok, onclick: () => G.Net.send({ t: 'trade_ok' }) }, 'Trade'),
          h('button.btn.small.ghost', { type: 'button', onclick: () => G.Net.send({ t: 'trade_cancel' }) }, 'Cancel')));
    },
    // Both pressed Trade: hand over our offer and take theirs.
    finish(m) {
      const game = this.game, p = game.player, inv = p.inventory;
      for (const it of m.give.items) { const e = inv.find(it.uid); if (e) inv.remove(e.uid, Math.min(e.qty, it.qty)); }
      p.zeny = Math.max(0, p.zeny - (m.give.zeny || 0)) + (m.get.zeny || 0);
      for (const it of m.get.items) {
        inv.add(it.id, it.qty, { cards: it.cards, refine: it.refine, ignoreWeight: true });
        const e = inv.items[inv.items.length - 1];
        if (e && e.id === it.id && it.forgedBy) { e.forgedBy = it.forgedBy; e.element = it.element; }
      }
      inv.changed();
      this.state = null; game.windows.close('trade');
      game.sfx('zeny'); game.hud.toast('Trade complete!');
      game.log.add(`Trade with ${this.partner} complete.`, 'level');
      game.save.save(true);
    },
  };
  G.Trade = Trade;
})(window.G = window.G || {});
