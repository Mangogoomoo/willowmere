/* Dialog box for NPC conversations, and the NPC shop window. */
(function (G) {
  'use strict';
  const h = G.h;
  const ABORT = { abort: true };

  class Dialog {
    constructor(game) {
      this.game = game;
      this.el = document.getElementById('dialog');
      this.nameEl = this.el.querySelector('.dlg-name');
      this.textEl = this.el.querySelector('.dlg-text');
      this.btnEl = this.el.querySelector('.dlg-buttons');
      this.el.querySelector('.dlg-close').addEventListener('click', () => this.close());
      this.npc = null;
      this.pending = null;
      this.token = 0;
    }
    get isOpen() { return !!this.npc; }

    open(npc) {
      if (this.npc) this.close();
      this.npc = npc;
      npc.talking = true;
      this.game.sfx('talk');
      this.el.hidden = false;
      this.nameEl.textContent = '';
      this.nameEl.append(h('b', { text: npc.name }), npc.title ? h('span', { text: npc.title }) : null);
      const token = ++this.token;
      Promise.resolve()
        .then(() => npc.script(this, this.game))
        .catch((e) => { if (e !== ABORT) console.error(e); })
        .finally(() => { if (this.token === token) this.close(); });
    }

    wait(text, buttons) {
      this.textEl.textContent = '';
      String(text).split('\n').forEach((line) => this.textEl.append(h('p', { text: line })));
      this.btnEl.textContent = '';
      return new Promise((resolve, reject) => {
        this.pending = { resolve, reject };
        buttons.forEach((label, i) => {
          const b = h('button.btn' + (buttons.length > 2 ? '.choice' : ''), {
            type: 'button',
            onclick: () => { this.pending = null; resolve(i); },
          }, label);
          this.btnEl.append(b);
        });
        const first = this.btnEl.querySelector('button');
        if (first) first.focus({ preventScroll: true });
      });
    }
    say(text) { return this.wait(text, ['Next']); }
    choose(text, options) { return this.wait(text, options); }

    close() {
      if (!this.npc) return;
      if (this.pending) { const p = this.pending; this.pending = null; p.reject(ABORT); }
      this.npc.talking = false;
      this.npc = null;
      this.el.hidden = true;
    }

    update() {
      if (this.npc && this.game.player.distanceTo(this.npc) > 6) this.close();
    }
  }

  /* ---------------- Shop ---------------- */
  class Shop {
    constructor(game) {
      this.game = game;
      this.mode = 'buy';
      this.def = G.SHOPS.tools;
      this.win = game.windows.create('shop', 'Shop', { width: 400, pos: () => ({ x: window.innerWidth / 2 - 200, y: 110 }) });
      this.win.render = () => this.render();
    }
    // shopId: key of G.SHOPS (tools, weapons, armor).
    open(mode, shopId) {
      this.mode = mode;
      this.shopId = shopId || 'tools';
      this.def = G.SHOPS[this.shopId];
      this.win.head.firstChild.textContent = this.def.name;
      this.game.windows.open('shop');
      this.render();
    }

    buyPrice(item) { return Math.max(1, Math.ceil(item.price * (1 - this.game.player.derived.discount / 100))); }
    sellPrice(item) { return Math.round(item.price / 2 * (1 + this.game.player.derived.overcharge / 100)); }

    buy(id, qty) {
      const p = this.game.player, item = G.Items.get(id), cost = this.buyPrice(item) * qty;
      if (p.zeny < cost) { this.game.log.add('You don’t have enough Zeny.', 'warn'); return; }
      if (G.Ledger.blocked(this.game)) return;
      // Online the server sells it to you (and corrects the price if needed); the rest is shown at once.
      const r = G.Ledger.quiet(() => p.inventory.add(id, qty));
      if (!r.added) { this.game.log.add(r.reason === 'weight' ? 'That would be too heavy to carry.' : 'Your inventory is full.', 'warn'); return; }
      G.Ledger.op('buy', { shop: this.shopId, id, qty });
      G.Ledger.quiet(() => { p.zeny -= cost; });
      this.game.log.add(`Bought ${item.name}${qty > 1 ? ' ×' + qty : ''} for ${cost.toLocaleString()} z.`, 'loot');
      this.render();
    }
    sell(uid, qty) {
      const p = this.game.player, e = p.inventory.find(uid);
      if (!e) return;
      const item = G.Items.get(e.id);
      if (G.Ledger.blocked(this.game)) return;
      G.Ledger.op('sell', { uid, qty });
      const n = G.Ledger.quiet(() => p.inventory.remove(uid, qty)), gain = this.sellPrice(item) * n;
      G.Ledger.quiet(() => { p.zeny += gain; });
      this.game.log.add(`Sold ${item.name}${n > 1 ? ' ×' + n : ''} for ${gain.toLocaleString()} z.`, 'loot');
      this.render();
    }

    render() {
      if (!this.game.windows.isOpen('shop')) return;
      const p = this.game.player, b = this.win.body;
      // Keep the list where it was after buying or selling (a new tab starts at the top).
      const old = b.querySelector('.shop-list'), scroll = old && this.scrollMode === this.mode ? old.scrollTop : 0;
      this.scrollMode = this.mode;
      b.textContent = '';
      const tabs = h('div.tabs', null, [['buy', 'Buy'], ['sell', 'Sell']].map(([id, label]) => h('button.tab' + (this.mode === id ? '.on' : ''), {
        type: 'button', onclick: () => { this.mode = id; this.render(); },
      }, label)));
      const list = h('div.shop-list');
      const row = (id, entry, priceText, max, onGo, goLabel, onAll) => {
        const qty = h('input.qtyin', { type: 'number', min: '1', max: String(max), value: '1', 'aria-label': 'Quantity' });
        const r = h('div.shop-row' + (onAll ? '.sell' : ''), null,
          h('img', { src: G.Icons.url(id), alt: '' }),
          h('span.sname2' + (entry && G.Items.isCarded(entry) ? '.carded' : ''), null, entry ? G.Items.displayName(entry) : G.Items.get(id).name, entry && entry.qty > 1 ? h('small', { text: ` ×${entry.qty}` }) : null),
          h('span.sprice', { text: priceText }),
          G.Items.get(id).stack ? qty : h('span'),
          h('button.btn.small', { type: 'button', onclick: () => onGo(Math.max(1, Math.min(max, parseInt(qty.value, 10) || 1))) }, goLabel),
          onAll ? h('button.btn.small.ghost', { type: 'button', title: `Sell all ${entry.qty} for ${(this.sellPrice(G.Items.get(id)) * entry.qty).toLocaleString()} z`, onclick: onAll }, 'Sell all') : null);
        G.Tooltip.bind(r, () => G.itemTooltipCompare(entry || { id, qty: 1 }, p));
        list.append(r);
      };
      if (this.mode === 'buy') {
        for (const id of this.def.stock) {
          const item = G.Items.get(id), price = this.buyPrice(item);
          row(id, null, `${price.toLocaleString()} z`, 99, (n) => this.buy(id, n), 'Buy');
        }
      } else {
        const sellable = p.inventory.items.filter((e) => G.Items.get(e.id).price > 0);
        if (!sellable.length) list.append(h('p.hint', { text: 'You have nothing to sell. Equipped gear can’t be sold until you remove it.' }));
        for (const e of sellable) {
          const item = G.Items.get(e.id);
          row(e.id, e, `${this.sellPrice(item).toLocaleString()} z each`, e.qty, (n) => this.sell(e.uid, n), 'Sell', () => this.sell(e.uid, e.qty));
        }
      }
      const D = p.derived;
      const perk = this.mode === 'buy' && D.discount ? `Discount saves you ${D.discount}%.` : this.mode === 'sell' && D.overcharge ? `Overcharge adds ${D.overcharge}%.` : '';
      b.append(tabs, list, h('div.inv-foot.shop-foot', null,
        h('span.hint', { text: perk }),
        h('span.zeny', null, h('img', { src: G.Icons.url('zeny'), alt: '' }), `${p.zeny.toLocaleString()} z`)));
      list.scrollTop = scroll;
    }

    update() {
      // Close when the player walks away from the shopkeeper.
      if (!this.game.windows.isOpen('shop')) return;
      const dealer = this.game.npcs.list.find((n) => n.id === this.def.npc);
      if (!dealer || this.game.player.distanceTo(dealer) > 8) this.game.windows.close('shop');
    }
  }

  /* ---------------- Refining (Bram) ---------------- */
  class RefineWindow {
    constructor(game) {
      this.game = game;
      this.armed = null;
      this.win = game.windows.create('refine', 'Bram’s Forge: refining', { width: 430, pos: () => ({ x: window.innerWidth / 2 - 215, y: 100 }) });
      this.win.render = () => this.render();
    }
    open() { this.armed = null; this.game.windows.open('refine'); this.render(); }

    targets() {
      const p = this.game.player, out = [];
      for (const slot in p.equipment) { const e = p.equipment[slot]; if (e && G.Refine.canRefine(e)) out.push({ e, worn: true }); }
      for (const e of p.inventory.items) if (G.Refine.canRefine(e)) out.push({ e, worn: false });
      return out;
    }

    async doRefine(e) {
      const game = this.game, p = game.player, before = G.Items.displayName(e);
      let res;
      if (G.Ledger.enabled) {
        // Online the server rolls the dice; its corrected character arrives first.
        if (G.Ledger.blocked(game) || this.busy) return;
        this.busy = true;
        const r = await G.Ledger.request('refine', { uid: e.uid });
        this.busy = false;
        res = r.result;
        if (r.item) e = r.item;
      } else res = G.Refine.attempt(p, e);
      this.armed = null;
      if (res === 'success') {
        game.sfx('levelup'); game.effects.levelUp(p);
        game.log.add(`Success! ${before} became ${G.Items.displayName(e)}.`, 'level');
        game.hud.toast(`Refine succeeded: ${G.Items.displayName(e)}`);
      } else if (res === 'broke') {
        game.sfx('slam'); game.effects.death({ x: p.position.x, y: p.position.y + 0.5, z: p.position.z }, [0.6, 0.6, 0.65]);
        game.log.add(`The refine failed and ${before} broke…`, 'warn');
        game.hud.toast(`Refine failed. ${before} broke.`);
      } else game.log.add(res, 'warn');
      this.render();
    }

    render() {
      if (!this.game.windows.isOpen('refine')) return;
      const p = this.game.player, b = this.win.body;
      const old = b.querySelector('.shop-list'), scroll = old ? old.scrollTop : 0;   // keep the list where it was
      b.textContent = '';
      const list = h('div.shop-list');
      const items = this.targets();
      if (!items.length) list.append(h('p.hint', { text: 'You have nothing that can be refined. Weapons, armour, shields, garments, shoes and upper headgear can be.' }));
      for (const { e, worn } of items) {
        const item = G.Items.get(e.id), t = G.Refine.table(item), r = e.refine || 0;
        const max = r >= G.Refine.MAX, chance = G.Refine.nextChance(e);
        const mat = G.Items.get(t.mat), have = p.inventory.count(t.mat);
        const risky = !max && chance < 100;
        const btn = h('button.btn.small' + (risky ? '.danger' : ''), { type: 'button', disabled: max },
          max ? 'Max' : this.armed === e ? 'Confirm' : 'Refine');
        btn.addEventListener('click', () => {
          if (risky && this.armed !== e) { this.armed = e; this.render(); return; }
          this.doRefine(e);
        });
        const row = h('div.refine-row', null,
          h('img', { src: G.Icons.url(e.id), alt: '' }),
          h('div.rinfo', null,
            h('span.sname2' + (G.Items.isCarded(e) ? '.carded' : ''), null, G.Items.displayName(e), worn ? h('small', { text: ' (worn)' }) : null),
            h('small', { text: max ? 'Fully refined.' : `+${r} → +${r + 1}: ${mat.name} (${have} owned), ${t.zeny.toLocaleString()} z` })),
          h('span.rchance' + (max ? '' : chance >= 100 ? '.safe' : chance >= 40 ? '.mid' : '.low'), { text: max ? '' : `${chance}%` }),
          btn);
        G.Tooltip.bind(row, () => G.itemTooltip(e, p, { equipped: worn }));
        list.append(row);
      }
      b.append(list,
        h('p.hint' + (this.armed ? '.warnhint' : ''), { text: this.armed
          ? `Above the safe limit a failed refine destroys ${G.Items.displayName(this.armed)} and any cards in it. Click Confirm to try.`
          : 'Refining up to the safe limit always works. Beyond it, failure destroys the item. Maximum +10.' }),
        h('div.inv-foot.shop-foot', null, h('span.hint', { text: 'Bram sells Phracon and Emveretarcon. Elunium and Oridecon come from monsters.' }),
          h('span.zeny', null, h('img', { src: G.Icons.url('zeny'), alt: '' }), `${p.zeny.toLocaleString()} z`)));
      list.scrollTop = scroll;
    }

    update() {
      if (!this.game.windows.isOpen('refine')) return;
      const n = this.game.npcs.list.find((x) => x.id === 'refiner');
      if (!n || this.game.player.distanceTo(n) > 8) this.game.windows.close('refine');
    }
  }

  G.RefineWindow = RefineWindow;
  G.Dialog = Dialog;
  G.Shop = Shop;
})(window.G = window.G || {});
