/* Inventory: the player's items (stacked where allowed), weight limit,
   sorting, using consumables, and equipping/unequipping gear.
   Equipped items move out of the bag into player.equipment[slot]. */
(function (G) {
  'use strict';
  const TYPE_ORDER = { use: 0, equip: 1, card: 2, etc: 3 };

  class Inventory {
    constructor(player) {
      this.player = player;
      this.items = [];        // { uid, id, qty, cards: [] }
      this.max = 100;         // distinct entries
      this.nextUid = 1;
      this.listeners = [];
      this.useCd = 0;
    }

    onChange(fn) { this.listeners.push(fn); }
    changed() { this.player.recalc(); for (const fn of this.listeners) fn(); }

    weight() {
      let w = 0;
      for (const e of this.items) w += (G.Items.get(e.id).weight || 0) * e.qty;
      for (const s in this.player.equipment) { const e = this.player.equipment[s]; if (e) w += G.Items.get(e.id).weight || 0; }
      return w;
    }
    weightPct() { return this.weight() / this.player.derived.maxWeight; }

    find(uid) { return this.items.find((e) => e.uid === uid) || null; }
    firstOf(id) { return this.items.find((e) => e.id === id) || null; }
    count(id) { let n = 0; for (const e of this.items) if (e.id === id) n += e.qty; return n; }

    /* Returns { added, reason }. Never partially adds a stack.
       opts: ignoreWeight, cards, refine, forgedBy, element. Online, the
       server is told (G.Ledger) unless it made the change itself. */
    add(id, qty, opts) {
      opts = opts || {};
      const item = G.Items.get(id);
      if (!item || qty <= 0) return { added: 0, reason: 'unknown' };
      const w = (item.weight || 0) * qty;
      if (!opts.ignoreWeight && this.weight() + w > this.player.derived.maxWeight) return { added: 0, reason: 'weight' };
      if (item.stack) {
        const e = this.firstOf(id);
        if (e) { e.qty = Math.min(30000, e.qty + qty); this.changed(); return { added: qty }; }
        if (this.items.length >= this.max) return { added: 0, reason: 'full' };
        this.items.push({ uid: this.nextUid++, id, qty, cards: [] });
      } else {
        if (this.items.length + qty > this.max) return { added: 0, reason: 'full' };
        for (let i = 0; i < qty; i++) this.items.push({ uid: this.nextUid++, id, qty: 1, cards: (opts.cards || []).slice(), refine: opts.refine || 0, forgedBy: opts.forgedBy, element: opts.element });
      }
      if (G.Ledger) G.Ledger.gained(id, qty, opts);
      this.changed();
      return { added: qty };
    }

    remove(uid, qty) {
      const e = this.find(uid);
      if (!e) return 0;
      const n = Math.min(qty == null ? e.qty : qty, e.qty);
      e.qty -= n;
      if (e.qty <= 0) this.items.splice(this.items.indexOf(e), 1);
      if (G.Ledger) G.Ledger.removed(uid, n);
      this.changed();
      return n;
    }

    sort() {
      this.items.sort((a, b) => {
        const ia = G.Items.get(a.id), ib = G.Items.get(b.id);
        return (TYPE_ORDER[ia.type] - TYPE_ORDER[ib.type]) || ia.name.localeCompare(ib.name) || a.uid - b.uid;
      });
      if (G.Ledger) G.Ledger.op('order', { uids: this.items.map((e) => e.uid) });
      this.changed();
    }

    /* ---------- using ---------- */
    use(uid) {
      const e = this.find(uid);
      if (!e) return false;
      const item = G.Items.get(e.id);
      if (item.type === 'equip') return this.equip(uid);
      if (item.type !== 'use') { this.player.game.log.add(`${item.name} can’t be used directly.`, 'info'); return false; }
      if (this.useCd > 0 || !this.player.alive) return false;
      if (!this.player.applyItem(item)) return false;
      this.useCd = 0.25;
      this.remove(uid, 1);
      return true;
    }
    useFirst(id) { const e = this.firstOf(id); return e ? this.use(e.uid) : false; }

    /* ---------- equipment ---------- */
    canEquip(item) {
      const p = this.player;
      if (item.type !== 'equip') return { ok: false, reason: 'That can’t be equipped.' };
      if (p.baseLevel < (item.reqLevel || 1)) return { ok: false, reason: `Requires base level ${item.reqLevel}.` };
      if (!G.Jobs.canUse(item.jobs, p.job)) return { ok: false, reason: `Your job can’t equip ${item.name}.` };
      if (item.slot === 'weapon') {
        const job = G.Jobs.get(p.job);
        if (!job.weapons.includes(item.weaponType)) return { ok: false, reason: `A ${G.Jobs.get(p.job).name} can’t use ${G.Items.WEAPON_TYPES[item.weaponType].name.toLowerCase()}s.` };
      }
      if (item.slot === 'shield') {
        const w = p.equipment.weapon && G.Items.get(p.equipment.weapon.id);
        if (w && G.Items.WEAPON_TYPES[w.weaponType].twoHanded) return { ok: false, reason: 'Your weapon needs both hands.' };
      }
      return { ok: true };
    }

    slotFor(item) {
      if (item.slot !== 'acc') return item.slot;
      const eq = this.player.equipment;
      return !eq.acc1 ? 'acc1' : !eq.acc2 ? 'acc2' : 'acc1';
    }

    equip(uid) {
      const e = this.find(uid);
      if (!e) return false;
      const item = G.Items.get(e.id);
      const check = this.canEquip(item);
      if (!check.ok) { this.player.game.log.add(check.reason, 'warn'); return false; }
      const slot = this.slotFor(item);
      const eq = this.player.equipment;
      // Move the entry out of the bag first so swapping never overflows it.
      this.items.splice(this.items.indexOf(e), 1);
      if (eq[slot]) this.items.push(eq[slot]);
      if (item.weaponType && G.Items.WEAPON_TYPES[item.weaponType].twoHanded && eq.shield) { this.items.push(eq.shield); eq.shield = null; }
      eq[slot] = e;
      if (G.Ledger) G.Ledger.op('equip', { uid: e.uid });
      this.changed();
      this.player.game.log.add(`Equipped ${G.Items.displayName(e)}.`, 'info');
      return true;
    }

    unequip(slot) {
      const e = this.player.equipment[slot];
      if (!e) return false;
      if (this.items.length >= this.max) { this.player.game.log.add('Your inventory is full.', 'warn'); return false; }
      this.player.equipment[slot] = null;
      this.items.push(e);
      if (G.Ledger) G.Ledger.op('unequip', { slot });
      this.changed();
      this.player.game.log.add(`Removed ${G.Items.displayName(e)}.`, 'info');
      return true;
    }

    /* ---------- cards ---------- */
    // Equipment (bagged or worn) that this card fits and that has a free slot.
    cardTargets(cardItem) {
      const allowed = G.Items.CARD_SLOTS[cardItem.cardSlot].slots;
      const fits = (e) => { const it = G.Items.get(e.id); return it.type === 'equip' && allowed.includes(it.slot) && (it.slots || 0) > (e.cards || []).length; };
      const out = [];
      for (const slot in this.player.equipment) { const e = this.player.equipment[slot]; if (e && fits(e)) out.push({ entry: e, worn: true }); }
      for (const e of this.items) if (fits(e)) out.push({ entry: e, worn: false });
      return out;
    }
    // Cards can't be removed once inserted (classic rule).
    insertCard(cardUid, target) {
      const c = this.find(cardUid);
      if (!c) return false;
      const card = G.Items.get(c.id), item = G.Items.get(target.entry.id);
      if (!this.cardTargets(card).some((t) => t.entry === target.entry)) return false;
      if (G.Ledger) { if (G.Ledger.blocked(this.player.game)) return false; G.Ledger.op('card', { card: cardUid, target: target.entry.uid }); G.Ledger.quiet(() => this.remove(cardUid, 1)); } else this.remove(cardUid, 1);
      (target.entry.cards = target.entry.cards || []).push(card.id);
      this.changed();
      this.player.game.log.add(`${card.name} inserted into ${item.name}.`, 'rare');
      this.player.game.effects.sparkle(this.player.position, [1, 0.85, 0.3], 24);
      return true;
    }

    update(dt) { if (this.useCd > 0) this.useCd -= dt; }

    serialize() { return { items: this.items.map((e) => ({ id: e.id, qty: e.qty, cards: e.cards, refine: e.refine || 0, forgedBy: e.forgedBy, element: e.element })), nextUid: this.nextUid }; }
    load(data) {
      this.items = [];
      this.nextUid = 1;
      for (const e of (data && data.items) || []) {
        if (!G.Items.get(e.id)) continue;
        this.items.push({ uid: this.nextUid++, id: e.id, qty: e.qty, cards: e.cards || [], refine: e.refine || 0, forgedBy: e.forgedBy, element: e.element });
      }
    }
  }

  G.Inventory = Inventory;
})(window.G = window.G || {});
