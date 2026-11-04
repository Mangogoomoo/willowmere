/* Refining, after the classic rules:
   - Weapons have a level (1-4); armour, shields, garments, shoes and upper
     headgear count as "armour". Accessories and lower/middle headgear can't
     be refined.
   - Every refine costs a material and some Zeny. Up to the safe limit it
     always works; beyond it each attempt can fail, and a failed refine
     destroys the item (and any cards in it). Maximum +10.
   - Weapons gain ATK per level, plus extra for over-safe refines; armour
     gains DEF. */
(function (G) {
  'use strict';
  const T = {
    1: { safe: 7, rates: [100, 100, 100, 100, 100, 100, 100, 60, 40, 19], atk: 2, over: 3, mat: 'phracon', zeny: 50 },
    2: { safe: 6, rates: [100, 100, 100, 100, 100, 100, 60, 40, 20, 19], atk: 3, over: 5, mat: 'emveretarcon', zeny: 200 },
    3: { safe: 5, rates: [100, 100, 100, 100, 100, 60, 50, 20, 20, 19], atk: 5, over: 8, mat: 'oridecon', zeny: 5000 },
    4: { safe: 4, rates: [100, 100, 100, 100, 60, 40, 40, 20, 20, 9], atk: 7, over: 13, mat: 'oridecon', zeny: 20000 },
    armor: { safe: 4, rates: [100, 100, 100, 100, 60, 40, 40, 20, 20, 9], def: 1, mat: 'elunium', zeny: 2000 },
  };
  const ARMOR_SLOTS = ['armor', 'shield', 'garment', 'shoes', 'headTop'];
  const MAX = 10;

  const Refine = {
    MAX,
    table(item) {
      if (!item || item.type !== 'equip') return null;
      if (item.slot === 'weapon') return T[item.wlv || 1];
      return ARMOR_SLOTS.includes(item.slot) ? T.armor : null;
    },
    canRefine(entry) { return !!Refine.table(G.Items.get(entry.id)); },
    nextChance(entry) {
      const t = Refine.table(G.Items.get(entry.id)), r = entry.refine || 0;
      return r >= MAX ? 0 : t.rates[r];
    },
    // Stat bonus from the refine level (used by the stats engine and tooltips).
    bonus(entry) {
      const item = G.Items.get(entry.id), t = Refine.table(item), r = entry.refine || 0;
      if (!t || !r) return {};
      if (item.slot === 'weapon') {
        const over = Math.max(0, r - t.safe);
        return { atk: r * t.atk + Math.round(over * (t.over + 1) / 2) };
      }
      return { def: r * t.def };
    },
    /* Attempt a refine. Returns 'success' | 'broke' | an error message. */
    attempt(player, entry) {
      const item = G.Items.get(entry.id), t = Refine.table(item);
      if (!t) return 'That item can’t be refined.';
      const r = entry.refine || 0;
      if (r >= MAX) return `${G.Items.displayName(entry)} is already at +${MAX}.`;
      const mat = player.inventory.firstOf(t.mat);
      if (!mat) return `You need a ${G.Items.get(t.mat).name}.`;
      if (player.zeny < t.zeny) return `You need ${t.zeny.toLocaleString()} Zeny.`;
      player.inventory.remove(mat.uid, 1);
      player.zeny -= t.zeny;
      if (Math.random() * 100 < t.rates[r]) {
        entry.refine = r + 1;
        player.inventory.changed();
        return 'success';
      }
      // Failure: the item is destroyed.
      const slot = Object.keys(player.equipment).find((k) => player.equipment[k] === entry);
      if (slot) player.equipment[slot] = null;
      else { const i = player.inventory.items.indexOf(entry); if (i >= 0) player.inventory.items.splice(i, 1); }
      player.inventory.changed();
      return 'broke';
    },
  };

  G.Refine = Refine;
})(window.G = window.G || {});
