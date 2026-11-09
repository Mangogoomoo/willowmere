/* Vending (online only). A merchant with the Vending skill sets out items
   from their cart at a price each; everyone on the map sees a little shop
   sign over their head (like a Ragnarok Online chat box) and can click it to
   buy. The server keeps the shop and moves the Zeny (server/server.js: Vend).
   One open shop per account. Leaving (Character Selection, logging out)
   keeps the shop open; logging back into that character closes it. */
(function (G) {
  'use strict';
  const h = G.h;
  const MAX_PRICE = 1000000000;

  const Vending = {
    game: null, mine: null, view: null, picks: {}, title: '', lv: 1, signs: new Map(),

    install(game) {
      this.game = game;
      const W = game.windows;
      this.setupWin = W.create('vend', 'Vending', { width: 470, pos: () => ({ x: window.innerWidth / 2 - 235, y: 90 }) });
      this.setupWin.render = () => this.renderSetup();
      this.shopWin = W.create('vendshop', 'My shop', { width: 380, pos: () => ({ x: window.innerWidth - 400, y: 110 }) });
      this.shopWin.render = () => this.renderMine();
      this.viewWin = W.create('vendview', 'Shop', { width: 430, pos: () => ({ x: window.innerWidth / 2 - 215, y: 110 }) });
      this.viewWin.render = () => this.renderView();
      // Signs sit over the world but under the HUD and windows (like RO).
      this.layer = h('div#vend-signs', { 'aria-label': 'Shops nearby' });
      const hud = document.getElementById('hud');
      if (hud) hud.before(this.layer); else document.body.append(this.layer);
    },
    online() { return !!(G.Online && G.Online.enabled && G.Net && G.Net.ws && G.Net.ws.readyState === 1); },
    say(text, kind) { this.game.log.add(text, kind || 'info'); },

    /* ---------------- opening a shop ---------------- */
    // The Vending skill: choose cart items and prices.
    openSetup(lv) {
      if (!this.online()) { this.say('Vending needs online play: other players buy from your shop.', 'warn'); return; }
      if (this.mine) { this.game.windows.open('vendshop'); this.renderMine(); return; }
      const p = this.game.player;
      this.lv = lv; this.picks = {};
      this.title = this.title || `${p.name}’s shop`;
      this.game.windows.open('vend');
      this.renderSetup();
    },
    max() { return 2 + this.lv; },   // Vending Lv 1: 3 kinds of items ... Lv 10: 12
    renderSetup() {
      if (!this.game.windows.isOpen('vend')) return;
      const p = this.game.player, b = this.setupWin.body, cart = (p.extra.cart || []);
      b.textContent = '';
      const picked = Object.keys(this.picks).length;
      b.append(h('label.opt', null, h('span', { text: 'Shop title' }),
        h('input.soc-in', { type: 'text', maxlength: '40', value: this.title, 'aria-label': 'Shop title', oninput: (e) => { this.title = e.target.value; } })));
      b.append(h('p.hint', { text: `Pick up to ${this.max()} items from your cart (Vending level ${this.lv}). Prices are per single item.` }));
      const list = h('div.shop-list.vend-list');
      cart.forEach((e, i) => {
        const it = G.Items.get(e.id), pick = this.picks[i];
        const full = !pick && picked >= this.max();
        const row = h('div.vend-row' + (pick ? '.on' : ''), null,
          h('input', { type: 'checkbox', checked: !!pick, disabled: full, 'aria-label': `Sell ${it.name}`, onchange: (ev) => {
            if (ev.target.checked) this.picks[i] = { id: e.id, qty: e.qty, price: Math.max(1, it.price || 1) }; else delete this.picks[i];
            this.renderSetup();
          } }),
          h('img', { src: G.Icons.url(e.id), alt: '' }),
          h('span.sname2', null, G.Items.displayName(e), h('small', { text: ` (you have ${e.qty})` })),
          h('label.vend-num', null, h('small', { text: 'Amount' }), h('input', { type: 'number', min: '1', max: String(e.qty), value: String(pick ? pick.qty : e.qty), disabled: !pick, 'aria-label': `How many ${it.name} to sell`,
            onchange: (ev) => { if (pick) { pick.qty = Math.max(1, Math.min(e.qty, Math.floor(Number(ev.target.value) || 1))); ev.target.value = pick.qty; } } })),
          h('label.vend-num.price', null, h('small', { text: 'Price each' }), h('input', { type: 'number', min: '1', max: String(MAX_PRICE), value: String(pick ? pick.price : Math.max(1, it.price || 1)), disabled: !pick, 'aria-label': `Price of one ${it.name}`,
            onchange: (ev) => { if (pick) { pick.price = Math.max(1, Math.min(MAX_PRICE, Math.floor(Number(ev.target.value) || 1))); ev.target.value = pick.price; } } })));
        G.Tooltip.bind(row.querySelector('img'), () => G.itemTooltip(e, p));
        list.append(row);
      });
      if (!cart.length) list.append(h('p.hint', { text: 'Your cart is empty. Put the things you want to sell in your cart first (Alt+W).' }));
      b.append(list,
        h('div.vend-foot', null, h('span.hint', { text: `${picked} / ${this.max()} picked` }),
          h('button.btn.small', { type: 'button', disabled: !picked, onclick: () => this.start() }, 'OK'),
          h('button.btn.small.ghost', { type: 'button', onclick: () => this.game.windows.close('vend') }, 'Cancel')));
    },
    async start() {
      const items = Object.entries(this.picks).map(([i, x]) => ({ i: Number(i), id: x.id, qty: x.qty, price: x.price }));
      if (!items.length) return;
      if (!this.title.trim()) { this.say('Give your shop a title.', 'warn'); return; }
      // The server checks your Vending level from your last save, so save first.
      const saved = this.game.save.save(true);
      if (saved && saved.then) await saved;
      G.Net.send({ t: 'vend_open', title: this.title.trim(), items });
    },

    /* ---------------- my open shop ---------------- */
    renderMine() {
      if (!this.game.windows.isOpen('vendshop')) return;
      const b = this.shopWin.body, s = this.mine, p = this.game.player;
      b.textContent = '';
      if (!s) { b.append(h('p.hint', { text: 'Your shop is closed.' })); return; }
      b.append(h('div.vend-title', { text: s.title }));
      const list = h('div.shop-list');
      for (const it of s.items) {
        const row = h('div.shop-row', null, h('img', { src: G.Icons.url(it.id), alt: '' }),
          h('span.sname2', null, G.Items.displayName(it), h('small', { text: ` ×${it.qty} left` })),
          h('span.sprice', { text: `${it.price.toLocaleString()} z each` }));
        G.Tooltip.bind(row, () => G.itemTooltip(it, p));
        list.append(row);
      }
      b.append(list);
      if (s.sales.length) {
        const total = s.sales.reduce((n, x) => n + x.zeny, 0);
        b.append(h('p.hint', { text: `Sold so far: ${total.toLocaleString()} Zeny. Latest: ${s.sales.slice(-3).reverse().map((x) => `${x.buyer} bought ${x.qty} ${G.Items.get(x.id).name}`).join('; ')}.` }));
      }
      b.append(h('p.hint', { text: 'Your shop stays open while you play another character, and closes when you log back in on this one.' }),
        h('div.vend-foot', null,
          h('button.btn.small', { type: 'button', onclick: () => G.toCharSelect(this.game) }, 'Keep shop open'),
          h('button.btn.small.ghost', { type: 'button', onclick: () => G.Net.send({ t: 'vend_close' }) }, 'Close shop')));
    },

    /* ---------------- someone else's shop ---------------- */
    renderView() {
      if (!this.game.windows.isOpen('vendview')) return;
      const b = this.viewWin.body, v = this.view, p = this.game.player;
      b.textContent = '';
      if (!v) return;
      this.viewWin.head.firstChild.textContent = v.title || 'Shop';
      b.append(h('p.hint', { text: `${v.name}’s shop. Prices are per item.` }));
      const list = h('div.shop-list');
      for (const it of v.items) {
        const qty = h('input', { type: 'number', min: '1', max: String(it.qty), value: '1', 'aria-label': `How many ${G.Items.get(it.id).name} to buy` });
        const row = h('div.shop-row.vend-buy', null, h('img', { src: G.Icons.url(it.id), alt: '' }),
          h('span.sname2', null, G.Items.displayName(it), h('small', { text: ` ×${it.qty}` })),
          h('span.sprice', { text: `${it.price.toLocaleString()} z` }), qty,
          h('button.btn.small', { type: 'button', onclick: () => {
            const n = Math.max(1, Math.min(it.qty, Math.floor(Number(qty.value) || 1)));
            G.Net.send({ t: 'vend_buy', id: v.id, k: it.k, qty: n });
          } }, 'Buy'));
        G.Tooltip.bind(row.querySelector('img'), () => G.itemTooltip(it, p));
        list.append(row);
      }
      if (!v.items.length) list.append(h('p.hint', { text: 'Nothing left for sale.' }));
      b.append(list, h('div.inv-foot.shop-foot', null, h('span.hint', { text: 'Your Zeny' }),
        h('span.zeny', null, h('img', { src: G.Icons.url('zeny'), alt: '' }), `${p.zeny.toLocaleString()} z`)));
    },

    /* ---------------- messages from the server ---------------- */
    handle(m) {
      const game = this.game, W = game.windows, p = game.player;
      if (m.t === 'vend_mine') {
        const first = !this.mine;
        this.mine = { title: m.title, items: m.items, sales: m.sales || [] };
        p.vending = true; p.path = null; p.attacking = false;
        if (first) { W.close('vend'); W.open('vendshop'); this.say(`Your shop “${m.title}” is open.`, 'level'); }
        if (m.text) this.say(m.text, 'loot');
        this.renderMine();
      } else if (m.t === 'vend_fail') this.say(m.text, 'warn');
      else if (m.t === 'vend_closed') {
        this.mine = null; p.vending = false;
        W.close('vendshop');
        if (m.text) this.say(m.text, 'info');
      } else if (m.t === 'vend') {
        const r = G.Net.players.get(m.id);
        if (r) r.vend = m.title || null;
        if (!m.title && this.view && this.view.id === m.id) { this.view = null; W.close('vendview'); }
      } else if (m.t === 'vend_view') {
        if (m.closed) { this.view = null; W.close('vendview'); if (m.text) this.say(m.text, 'warn'); return; }
        this.view = m;
        W.open('vendview'); this.renderView();
        if (m.text) this.say(m.text, /^Bought/.test(m.text) ? 'loot' : 'warn');
      }
    },

    /* ---------------- shop signs (a chat-box style sign over each shopkeeper) ---------------- */
    update() {
      const game = this.game, p = game.player;
      if (!this.layer || !p) return;
      const want = new Map();
      if (this.mine) want.set('me', { who: p, title: this.mine.title });
      if (G.Net && G.Net.players) for (const r of G.Net.players.values()) if (r.vend) want.set(r.id, { who: r, title: r.vend });
      for (const [id, el] of this.signs) if (!want.has(id)) { el.remove(); this.signs.delete(id); }
      for (const [id, { who, title }] of want) {
        let el = this.signs.get(id);
        if (!el) {
          el = h('button.vend-sign', { type: 'button', onclick: () => { if (id === 'me') { game.windows.open('vendshop'); this.renderMine(); } else G.Net.send({ t: 'vend_view', id }); } },
            h('img', { src: G.Icons.url('zeny'), alt: '' }), h('span'));
          this.layer.append(el); this.signs.set(id, el);
        }
        if (el.dataset.title !== title) { el.dataset.title = title; el.querySelector('span').textContent = title; el.title = `${title} — click to see the shop`; el.setAttribute('aria-label', `Shop: ${title}`); }
        const q = who.distanceTo(p) < 40 && game.overlay.project(who.position.x, who.position.y + 2.7, who.position.z);
        el.hidden = !q;
        if (q) el.style.transform = `translate(${Math.round(q.x)}px, ${Math.round(q.y)}px) translate(-50%, -100%)`;
      }
    },
  };

  // Back to the character screen (saving first). A shop you have open stays open.
  G.toCharSelect = async (game) => {
    const r = game.save.save(true);
    if (r && r.then) await r.catch(() => {});
    location.reload();
  };
  G.Vending = Vending;
})(window.G = window.G || {});
