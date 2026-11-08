/* The server owns your character online (Stage 9). Your game still plays
   everything out straight away, exactly as offline, but each change to your
   items, Zeny, EXP, levels, job or stats is sent to the server as an
   operation ("buy this", "equip that", "drop this"). The server checks it
   against its own copy and sends back the corrected character, which replaces
   the local one. Offline (a file, the published page) none of this runs. */
(function (G) {
  'use strict';
  const LOCAL_UID = 1000000;   // items the server hasn't numbered yet

  const Ledger = {
    seq: 0, quietN: 0, why: null, ready: false, waits: new Map(), syncT: null,

    // Online at all, and connected with the server's copy loaded.
    get enabled() { return !!(G.Online && G.Online.enabled && G.Net && G.Net.charId); },
    get connected() { return this.enabled && !!G.Net.ws && G.Net.ws.readyState === 1 && this.ready; },
    // Online but cut off: actions that need the server wait (returns true if blocked).
    blocked(game) {
      if (!this.enabled || this.connected) return false;
      game.log.add('Not connected to the server. Try again in a moment.', 'warn');
      return true;
    },
    // Run local changes the server makes by itself (a buy, a trade): no extra reports.
    quiet(fn) { this.quietN++; try { return fn(); } finally { this.quietN--; } },
    // Debug tools: the server only accepts these from admins.
    debug(fn) { const w = this.why; this.why = 'debug'; try { return fn(); } finally { this.why = w; } },

    op(k, data) {
      if (!this.connected) return 0;
      G.Net.send(Object.assign({ t: 'op', k, seq: ++this.seq }, data, this.why ? { why: this.why } : null));
      return this.seq;
    },
    // An operation whose answer we wait for (the refine roll).
    request(k, data) {
      const seq = this.op(k, data);
      if (!seq) return Promise.resolve({ result: 'Not connected to the server. Try again in a moment.' });
      return new Promise((resolve) => {
        const t = setTimeout(() => { this.waits.delete(seq); resolve({ result: 'The server didn’t answer. Try again.' }); }, 10000);
        this.waits.set(seq, (r) => { clearTimeout(t); resolve(r); });
      });
    },

    /* ---- reports from the inventory and the player ---- */
    get reporting() { return this.connected && !this.quietN; },
    gained(id, qty, opts) {
      if (!this.reporting) return;
      opts = opts || {};
      this.op('gain', { id, qty, refine: opts.refine || 0, cards: opts.cards || [], forgedBy: opts.forgedBy, element: opts.element });
    },
    removed(uid, qty) { if (this.reporting && qty > 0) this.op('take', { uid, qty }); },
    zeny(d) { if (this.reporting && d) this.op('zeny', { d }); },
    exp(base, job) { if (this.reporting && (base > 0 || job > 0)) this.op('exp', { base: Math.round(base), job: Math.round(job || 0) }); },

    /* ---- messages from the server ---- */
    handle(m) {
      if (m.t === 'op_res') { const w = this.waits.get(m.seq); if (w) { this.waits.delete(m.seq); w(m); } return; }
      if (m.t !== 'char') return;
      // Our newer changes are still on their way: ask again once they've arrived.
      if (this.ready && m.s.seq < this.seq) {
        if (m.text) G.Net.game.log.add(m.text, 'warn');
        if (!this.syncT) this.syncT = setTimeout(() => { this.syncT = null; this.op('sync'); }, 250);
        return;
      }
      this.apply(m.s);
      if (m.text) G.Net.game.log.add(m.text, 'warn');
      this.ready = true;
    },
    // Replace the local character with the server's.
    apply(s) {
      const game = G.Net.game, p = game && game.player;
      if (!p) return;
      const mk = (e) => ({ uid: e.uid, id: e.id, qty: e.qty, cards: e.cards || [], refine: e.refine || 0, forgedBy: e.forgedBy, element: e.element });
      const known = (e) => !!G.Items.get(e.id);
      this.quiet(() => {
        const inv = p.inventory;
        // Keep the player's own bag order; anything new goes at the end.
        const key = (e) => `${e.uid}:${e.id}`, pos = new Map(inv.items.map((e, i) => [key(e), i]));
        const bag = s.bag.filter(known).map(mk).map((e, i) => ({ e, k: pos.has(key(e)) ? pos.get(key(e)) : 1e6 + i }));
        inv.items = bag.sort((a, b) => a.k - b.k).map((x) => x.e);
        inv.nextUid = Math.max(inv.nextUid, LOCAL_UID);
        for (const slot in p.equipment) { const e = s.equip[slot]; p.equipment[slot] = e && known(e) ? mk(e) : null; }
        p.extra.cart = (s.cart || []).filter(known).map(mk);
        if (s.storage) p.storage = s.storage.filter(known).map(mk);
        const levels = p.baseLevel !== s.baseLevel || p.jobLevel !== s.jobLevel || p.job !== s.job || p.statPoints !== s.statPoints;
        p.job = s.job; p.baseLevel = s.baseLevel; p.jobLevel = s.jobLevel; p.baseExp = s.baseExp; p.jobExp = s.jobExp;
        p.stats = Object.assign({}, p.stats, s.stats); p.statPoints = s.statPoints;
        p.zeny = s.zeny;
        inv.changed();
        if (levels) game.events.emit('levelChanged');
        for (const w of ['storage', 'cart', 'shop', 'refine', 'trade']) game.windows.refresh(w);
      });
    },
  };

  G.Ledger = Ledger;
})(window.G = window.G || {});
