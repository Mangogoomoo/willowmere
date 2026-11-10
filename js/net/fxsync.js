/* Spell visuals, mirrored. Every visual effect your game plays (auras, rings,
   bolts, orbs, arrows, beams, impacts, cast circles, level-up beams, boss
   warnings) is also sent to the other players on your map, who replay the
   very same call on the same characters, monsters or spots. So everyone sees
   exactly what the caster sees. */
(function (G) {
  'use strict';
  const FNS = {
    spells: ['aura', 'ring', 'bolt', 'orb', 'arrow', 'beam', 'impact', 'castCircle', 'endCastCircle', 'warning', 'buff', 'notes'],
    effects: ['levelUp'],
    overlay: ['levelUp'],
  };
  const FxSync = {
    depth: 0, replaying: false,
    install(game) {
      if (this.game === game) return;
      this.game = game;
      for (const ns in FNS) for (const fn of FNS[ns]) {
        const obj = game[ns];
        if (!obj || typeof obj[fn] !== 'function') continue;
        const orig = obj[fn].bind(obj);
        obj[fn] = (...args) => {
          // Only the outermost call is shared (an aura's own ring isn't sent twice).
          const share = this.depth === 0 && !this.replaying;
          this.depth++;
          try { return orig(...args); } finally {
            this.depth--;
            if (share && G.Net && G.Net.ws && G.Net.ws.readyState === 1) this.share(ns, fn, args);
          }
        };
      }
    },
    ref(v) {
      const game = this.game;
      if (v === undefined || v === null) return null;
      if (typeof v === 'function') return { f: 1 };
      if (typeof v !== 'object') return v;
      if (v === game.player) return { p: G.Net.charId };
      if (v.isRemote) return { p: v.id };
      if (v.def && v.id != null && game.monsters && game.monsters.list.includes(v)) return { m: v.id };
      const pos = v.position || v;
      if (typeof pos.x === 'number' && typeof pos.z === 'number') return { v: [+pos.x.toFixed(2), +(pos.y || 0).toFixed(2), +pos.z.toFixed(2)] };
      return null;
    },
    share(ns, fn, args) {
      G.Net.send({ t: 'fx', k: 'v', ns, fn, a: args.slice(0, 5).map((v) => this.ref(v)) });
    },
    resolve(v) {
      const game = this.game;
      if (v === null || typeof v !== 'object') return { ok: true, v };
      if (v.f) return { ok: true, v: () => {} };
      if (v.p != null) { const e = v.p === G.Net.charId ? game.player : G.Net.players.get(v.p); return { ok: !!e, v: e }; }
      if (v.m != null) { const e = game.monsters && game.monsters.list.find((x) => x.id === v.m); return { ok: !!e, v: e }; }
      if (v.v) { const [x, y, z] = v.v; const pos = new THREE.Vector3(x, y, z); return { ok: true, v: { position: pos, x, y, z, def: { height: 1 }, alive: true } }; }
      return { ok: true, v: null };
    },
    replay(m) {
      const game = this.game;
      if (!FNS[m.ns] || !FNS[m.ns].includes(m.fn)) return;
      const args = [];
      for (const a of m.a || []) { const r = this.resolve(a); if (!r.ok) return; args.push(r.v); }
      // Positions for ring/warning are plain points.
      if ((m.fn === 'ring' || m.fn === 'warning') && args[0] && args[0].position) args[0] = args[0].position;
      if (m.fn === 'castCircle') args[2] = 12;   // someone else's circle never outlives 12 s
      this.replaying = true;
      try { game[m.ns][m.fn](...args); } catch (e) { /* a visual that can't be shown here */ } finally { this.replaying = false; }
    },
  };
  G.FxSync = FxSync;
})(window.G = window.G || {});
