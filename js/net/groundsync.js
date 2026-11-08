/* Items on the ground, shared (online). Instead of placing loot only in your
   own game, your game asks the server to put it on the map; everyone on the
   map then sees the same item in the same spot. Picking up asks the server
   first, and only the player it confirms gets the item. Monster drops are the
   killer's (and their party's) for 5 seconds, then free for all; anything
   left lies there for a minute. Offline, loot works as before. */
(function (G) {
  'use strict';
  const GS = {
    install(game) {
      if (this.game === game) return;
      this.game = game;
      const L = game.loot, TR = G.Terrain;
      const spawn = L.spawn.bind(L), pickUp = L.pickUp.bind(L);
      this.spawnLocal = spawn;
      const online = () => G.Net && G.Net.ws && G.Net.ws.readyState === 1;

      L.spawn = (id, qty, x, z, auto) => {
        if (!online() || this.adding) return spawn(id, qty, x, z, auto);
        const S = G.Social;
        // Party Share hands kill drops straight to a member; that stays as it is.
        if (S && S.rolling && id !== 'zeny' && S.party && S.party.itemShare === 'party') return spawn(id, qty, x, z, auto);
        let tx = x, tz = z;
        for (let i = 0; i < 8; i++) {
          const a = Math.random() * Math.PI * 2, r = 0.5 + Math.random() * 1.1, nx = x + Math.cos(a) * r, nz = z + Math.sin(a) * r;
          if (game.nav.walkable(nx, nz)) { tx = nx; tz = nz; break; }
        }
        const extra = L.nextAttrs || {}; L.nextAttrs = null;   // refine / cards of a dropped piece of gear
        G.Net.send(Object.assign({ t: 'drop_spawn', map: game.mapId, id, qty, x: +tx.toFixed(2), z: +tz.toFixed(2), fx: +x.toFixed(2), fz: +z.toFixed(2), kill: !!(S && S.rolling) }, extra));
        return null;
      };

      L.pickUp = (loot) => {
        if (!online() || loot.gid == null) return pickUp(loot);
        if (loot.pending) return true;
        // Don't take it off the ground if we couldn't carry it.
        if (loot.id !== 'zeny') {
          const it = G.Items.get(loot.id), p = game.player;
          if (it && p.inventory.weight() + it.weight * loot.qty > p.derived.maxWeight) { game.log.add('You’re carrying too much to pick that up.', 'warn'); return false; }
        }
        loot.pending = true;
        G.Net.send({ t: 'pickup', gid: loot.gid, auto: !!loot.auto });
        return true;
      };
    },

    // Show an item the server put on the ground.
    add(it, fresh) {
      const game = this.game, L = game.loot, me = G.Net.charId;
      if (L.items.some((l) => l.gid === it.gid)) return;
      const mine = it.owner === me || (it.party && G.Social.party && it.party === G.Social.party.id);
      this.adding = true;
      let loot;
      try { loot = this.spawnLocal(it.id, it.qty, fresh ? it.fx : it.x, fresh ? it.fz : it.z, !!(fresh && it.kill && it.owner === me && game.autoLoot)); } finally { this.adding = false; }
      if (!loot) return;
      Object.assign(loot, { gid: it.gid, x: it.x, z: it.z, y: G.Terrain.surfaceHeight(it.x, it.z), refine: it.refine, cards: it.cards, forgedBy: it.forgedBy, element: it.element, owner: it.owner, ownerName: it.ownerName });
      if (!fresh) { loot.t = 1; loot.age = it.age || 0; loot.from = { x: it.x, y: loot.y + 0.8, z: it.z }; }
      if (it.refine || (it.cards && it.cards.length)) loot.name = G.Items.displayName({ id: it.id, refine: it.refine, cards: it.cards, forgedBy: it.forgedBy, element: it.element });
      loot.notMine = !mine && it.priority > 0 ? game.time + it.priority / 1000 : 0;
    },

    handle(m) {
      const game = this.game, L = game.loot, find = (gid) => L.items.find((l) => l.gid === gid);
      if (m.map && m.map !== game.mapId) return;
      if (m.t === 'ground_add') this.add(m.item, true);
      else if (m.t === 'ground_remove') { const l = find(m.gid); if (l) L.remove(l); }
      else if (m.t === 'ground_deny') {
        const l = find(m.gid); if (l) { l.pending = false; l.auto = false; l.fly = 0; }
        game.log.add(m.text, 'warn');
      } else if (m.t === 'ground_take') {
        // The server says it's ours (and has already put it in its copy of our character).
        const it = m.item, p = game.player, l = find(m.gid);
        if (it.id === 'zeny') {
          G.Ledger.quiet(() => { p.zeny += it.qty; }); game.sfx('zeny'); game.log.add(`Picked up ${it.qty} Zeny.`, 'loot');
          game.overlay.addText(p.position, `+${it.qty} z`, 'zeny');
        } else {
          const r = G.Ledger.quiet(() => p.inventory.add(it.id, it.qty, { cards: it.cards, refine: it.refine, forgedBy: it.forgedBy, element: it.element, ignoreWeight: true }));
          const name = G.Items.displayName({ id: it.id, refine: it.refine, cards: it.cards, forgedBy: it.forgedBy, element: it.element });
          game.log.add(`Picked up ${it.qty > 1 ? `${name} ×${it.qty}` : name}.`, 'loot'); game.sfx('pickup');
          if (!r.added) game.log.add('Your bag overflowed!', 'warn');
        }
        if (l) { game.effects.sparkle({ x: l.x, y: l.y - 0.4, z: l.z }, [1, 0.95, 0.6], 8); L.remove(l); }
        game.save.markDirty();
      }
    },
    // Everything already lying on a map we just arrived on.
    load(list, map) {
      if (!list || (map && map !== this.game.mapId)) return;
      for (const l of this.game.loot.items.slice()) if (l.gid != null) this.game.loot.remove(l);
      for (const it of list) this.add(it, false);
    },
  };
  G.GroundSync = GS;
})(window.G = window.G || {});
