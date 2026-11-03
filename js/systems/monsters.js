/* MonsterManager: owns all monsters, spawns them from the config, keeps them
   from overlapping and resolves mouse picking against them. */
(function (G) {
  'use strict';
  const C = G.Config;
  const _oc = new THREE.Vector3();

  class MonsterManager {
    constructor(game, spawns) {
      this.game = game;
      this.list = [];
      let id = 0;
      for (const s of spawns) {
        for (let i = 0; i < s.count; i++) this.list.push(new G.Monster(game, s.type, s, id++));
      }
    }

    dispose() { for (const m of this.list) m.dispose(); this.list = []; }

    update(dt, camPos) {
      const player = this.game.player;
      for (const m of this.list) {
        // Far-away monsters think less often to save CPU.
        const far = Math.hypot(m.position.x - player.position.x, m.position.z - player.position.z) > 70;
        if (!far || m.state !== 'idle' || (this.game.frame + m.id) % 4 === 0) m.update(far && m.state === 'idle' ? dt * 4 : dt);
      }
      this.separate();
      for (const m of this.list) m.syncVisuals(dt, camPos);
    }

    separate() {
      const L = this.list, nav = this.game.nav;
      for (let i = 0; i < L.length; i++) {
        const a = L[i];
        if (!a.alive) continue;
        for (let j = i + 1; j < L.length; j++) {
          const b = L[j];
          if (!b.alive) continue;
          const dx = b.position.x - a.position.x, dz = b.position.z - a.position.z;
          const min = a.radius + b.radius;
          const d2 = dx * dx + dz * dz;
          if (d2 > 0.0001 && d2 < min * min) {
            const d = Math.sqrt(d2), push = (min - d) * 0.5;
            const ux = dx / d, uz = dz / d;
            if (nav.walkable(a.position.x - ux * push, a.position.z - uz * push)) a.setPosition(a.position.x - ux * push, a.position.z - uz * push);
            if (nav.walkable(b.position.x + ux * push, b.position.z + uz * push)) b.setPosition(b.position.x + ux * push, b.position.z + uz * push);
          }
        }
      }
    }

    /* Ray vs. a sphere around each living monster's body. Generous radius so
       small creatures are easy to click from any camera angle or distance. */
    pick(ray, maxT) {
      let best = null, bestT = maxT == null ? Infinity : maxT;
      const camDist = this.game.camera.effDist || 15;
      const grow = 1 + Math.max(0, camDist - 12) * 0.025;
      for (const m of this.list) {
        if (!m.alive) continue;
        const h = m.def.height;
        _oc.set(m.position.x, m.position.y + h * 0.5, m.position.z).sub(ray.origin);
        const r = Math.max(m.def.hitRadius, h * 0.55) * grow;
        const tca = _oc.dot(ray.direction);
        if (tca < 0) continue;
        const d2 = _oc.lengthSq() - tca * tca;
        if (d2 > r * r) continue;
        const t = tca - Math.sqrt(r * r - d2);
        if (t < bestT) { bestT = t; best = m; }
      }
      return best;
    }
  }

  /* Combat resolution. Kept separate so later stages can swap in full stat
     formulas (STR/AGI/DEX, equipment, cards) without touching AI code. */
  const Combat = {
    element(atk, def) {
      const t = G.Config.ELEMENTS[atk];
      return t && t[def] != null ? t[def] : 1;
    },

    /* Physical hit from the player. opts: mult (skill %), hitBonus (% added
       to hit chance), element, ranged. Criticals only on normal attacks. */
    physical(player, mon, opts) {
      opts = opts || {};
      const D = player.derived, d = mon.def, game = player.game, U = G.Utils;
      const at = mon.position.clone(); at.y += d.height * 0.55;
      const crit = !opts.mult && Math.random() * 100 < D.crit;
      const hitPct = U.clamp(80 + D.hit - d.flee + (opts.hitBonus || 0), 5, 100);
      if (!crit && Math.random() * 100 >= hitPct) { game.overlay.addText(at, 'Miss', 'miss'); return 0; }
      const prov = mon.provoke && mon.provoke.until > game.time ? mon.provoke : null;
      const def = d.def * (prov ? 1 - prov.defDown : 1);
      let dmg;
      if (crit) dmg = (D.statusAtk + D.weaponAtk + D.atkBonus) * 1.4;
      else {
        const weapon = D.weaponAtk * U.randRange(Math.random, D.weaponMinFrac, 1);
        dmg = ((D.statusAtk + weapon + D.atkBonus) * (opts.mult || 1) + (opts.flat || 0)) * (1 - Math.min(def, 90) / 100) - (d.softDef || 0);
      }
      dmg *= Combat.element(opts.element || 'neutral', d.element || 'neutral');
      dmg = Math.max(1, Math.round(dmg));
      game.effects.hit(at, crit);
      game.overlay.addText(at, String(dmg), crit ? 'crit' : opts.mult ? 'skilldmg' : 'dmg');
      mon.takeDamage(dmg, player);
      return dmg;
    },

    /* Magic always hits; MATK roll x element, reduced by MDEF. */
    magic(player, mon, opts) {
      const D = player.derived, d = mon.def, game = player.game, U = G.Utils;
      const at = mon.position.clone(); at.y += d.height * 0.55;
      const matk = U.randRange(Math.random, D.matkMin, Math.max(D.matkMin, D.matkMax));
      const el = Combat.element(opts.element, d.element || 'neutral');
      const dmg = Math.max(1, Math.round(matk * (opts.mult || 1) * el * (1 - (d.mdef || 0) / 100)));
      game.overlay.addText(at, String(dmg), el > 1 ? 'crit' : 'magic');
      mon.takeDamage(dmg, player);
      return dmg;
    },

    // Normal attack, including the Thief's Double Attack proc.
    playerAttack(player, mon) {
      Combat.physical(player, mon);
      if (mon.alive && player.derived.doubleAttack && Math.random() * 100 < player.derived.doubleAttack) {
        player.game.after(0.12, () => { if (mon.alive) Combat.physical(player, mon); });
      }
    },

    /* Monster -> player. Hard DEF reduces by percent, VIT soft DEF subtracts. */
    monsterAttack(mon, player) {
      const D = player.derived, d = mon.def, game = mon.game, U = G.Utils;
      const at = player.position.clone(); at.y += 1.3;
      const hitPct = U.clamp(80 + d.hit - D.flee, 5, 95);
      if (Math.random() * 100 >= hitPct) { game.overlay.addText(at, 'Miss', 'miss'); return; }
      const prov = mon.provoke && mon.provoke.until > game.time ? mon.provoke : null;
      const raw = U.randInt(Math.random, d.atk[0], d.atk[1]) * (prov ? 1 + prov.atkUp : 1);
      const dmg = Math.max(1, Math.round(raw * (1 - Math.min(D.def, 90) / 100) - D.softDef));
      game.effects.hit(at, false);
      game.overlay.addText(at, String(dmg), 'hurt');
      player.takeDamage(dmg, mon);
    },
  };

  G.MonsterManager = MonsterManager;
  G.Combat = Combat;
})(window.G = window.G || {});
