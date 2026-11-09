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
      this.assignSlots();
      for (const m of this.list) m.syncVisuals(dt, camPos);
    }

    /* Give every monster that is fighting the player its own spot around
       them. Spots follow the direction each monster comes from: a few
       attackers fan out on that side, a crowd forms a full ring, and any
       overflow waits in a second ring further out. Monsters don't collide
       with each other otherwise. */
    assignSlots() {
      const player = this.game.player, nav = this.game.nav;
      for (const m of this.list) m.slot = null;
      if (!player || !player.alive) return;
      const P = player.position;
      const fighters = this.list.filter((m) => m.alive && !m.def.noAttack && m.aggro === player && (m.state === 'chase' || m.state === 'attack'));
      if (!fighters.length) return;
      const ang = (m) => Math.atan2(m.position.x - P.x, m.position.z - P.z);
      fighters.sort((a, b) => ang(a) - ang(b));
      const ring = (list, radius) => {
        const n = list.length;
        if (!n) return;
        const spacing = n === 1 ? 0 : Math.min((Math.PI * 2) / n, 0.95);
        // Rotate the fan so monsters move as little as possible (circular mean).
        let sx = 0, sy = 0;
        list.forEach((m, i) => { const v = ang(m) - i * spacing; sx += Math.sin(v); sy += Math.cos(v); });
        const base = Math.atan2(sx, sy);
        list.forEach((m, i) => {
          const r = radius + m.def.radius;
          const a = base + i * spacing;
          let x = P.x + Math.sin(a) * r, z = P.z + Math.cos(a) * r;
          if (!nav.walkable(x, z)) { const w = nav.nearestWalkable(x, z, 1.5); if (!w) return; x = w.x; z = w.z; }
          m.slot = { x, z };
        });
      };
      const inner = player.radius + 0.4;
      const capacity = Math.max(1, Math.floor((Math.PI * 2 * (inner + 0.55)) / 1.15));
      ring(fighters.slice(0, capacity), inner);
      ring(fighters.slice(capacity), inner + 1.3);
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

    // A miss on a monster (online, everyone on the map sees it: js/net/mobsync.js).
    shown() {},

    /* Physical hit from the player. opts: mult (skill %), hitBonus (% added
       to hit chance), element, ranged. Criticals only on normal attacks. */
    physical(player, mon, opts) {
      opts = opts || {};
      const D = player.derived, d = mon.def, game = player.game, U = G.Utils;
      const at = mon.position.clone(); at.y += d.height * 0.55;
      const crit = !opts.mult && Math.random() * 100 < D.crit;
      const hitPct = U.clamp(80 + D.hit - d.flee + (opts.hitBonus || 0), 5, 100);
      // Pneuma: ranged physical attacks can't reach anyone standing inside it.
      const ranged = opts.ranged || (!opts.mult && D.weaponType === 'bow') || (opts.mult && D.weaponType === 'bow' && opts.ranged !== false && opts.skill && /strafe|shower|arrow|repel|blitz|musical|throw/.test(opts.skill));
      if (ranged && game.fields && game.fields.list.some((f) => f.kind === 'pneuma' && Math.hypot(mon.position.x - f.x, mon.position.z - f.z) <= f.r)) {
        game.overlay.addText(at, 'Pneuma', 'miss'); Combat.shown(mon, 'Pneuma'); return 0;
      }
      if (!crit && !opts.noMiss && Math.random() * 100 >= hitPct) { game.overlay.addText(at, 'Miss', 'miss'); game.sfx('miss', at); Combat.shown(mon, 'Miss'); return 0; }
      const prov = mon.provoke && mon.provoke.until > game.time ? mon.provoke : null;
      const def = d.def * (prov ? 1 - prov.defDown : 1);
      let dmg;
      if (crit) dmg = (D.statusAtk + D.weaponAtk + D.atkBonus) * 1.4;
      else {
        const weapon = D.weaponAtk * U.randRange(Math.random, D.weaponMinFrac, 1);
        const st = mon.status || {};
        const defMult = (st.signum ? 0.8 : 1) * (st.strip_shield ? 0.85 : 1) * (st.strip_armor ? 0.6 : 1);
        const hard = opts.ignoreDef ? 0 : Math.min(def * defMult, 90), soft = opts.ignoreDef ? 0 : (d.softDef || 0) * defMult;
        const X = D.extra || {}, mel = mon.elementOverride || d.element || 'neutral';
        if (X.demonBane && /shadow|ghost|undead/.test(mel)) opts.flat = (opts.flat || 0) + X.demonBane;
        if (opts.skill === 'sonic_blow' && X.sonicAccel) opts.mult = (opts.mult || 1) * 1.5;
        dmg = ((D.statusAtk + weapon + D.atkBonus) * (opts.mult || 1) + (opts.flat || 0)) * (1 - hard / 100) - soft;
      }
      dmg *= 1 + (D.atkPct || 0) / 100;
      dmg *= Combat.element(opts.element || D.weaponElement || 'neutral', mon.elementOverride || d.element || 'neutral');
      dmg = Math.max(1, Math.round(dmg));
      game.effects.hit(at, crit);
      game.sfx(crit ? 'crit' : 'hit', at);
      mon.hitKind = crit ? 'crit' : opts.mult ? 'skilldmg' : 'dmg';
      game.overlay.addText(at, String(dmg), mon.hitKind);
      mon.takeDamage(dmg, player);
      // Enchant Poison: a chance to poison on every hit.
      if (mon.alive && D.poisonChance && Math.random() * 100 < D.poisonChance && !mon.status.poisoned) {
        mon.addStatus('poisoned', 10, { dps: Math.max(1, Math.round(D.statusAtk / 8)) });
        game.overlay.addText(at, 'Poisoned', 'debuff');
      }
      return dmg;
    },

    /* Magic always hits; MATK roll x element, reduced by MDEF. */
    magic(player, mon, opts) {
      const D = player.derived, d = mon.def, game = player.game, U = G.Utils;
      const at = mon.position.clone(); at.y += d.height * 0.55;
      const matk = U.randRange(Math.random, D.matkMin, Math.max(D.matkMin, D.matkMax));
      const el = Combat.element(opts.element, d.element || 'neutral');
      const dmg = Math.max(1, Math.round(matk * (opts.mult || 1) * el * (1 - (d.mdef || 0) / 100)));
      mon.hitKind = el > 1 ? 'crit' : 'magic';
      game.overlay.addText(at, String(dmg), mon.hitKind);
      game.sfx({ fire: 'fire', water: 'ice', wind: 'zap', holy: 'holy', ghost: 'ice' }[opts.element] || 'hit', at);
      mon.takeDamage(dmg, player);
      return dmg;
    },

    // Normal attack, including the Thief's Double Attack proc.
    playerAttack(player, mon) {
      const D = player.derived;
      // Monk's Raging Trifecta Blow: sometimes a normal attack becomes a 3-hit combo.
      if (D.tripleAttack && Math.random() < 0.2) {
        for (let i = 0; i < 3; i++) player.game.after(i * 0.1, () => { if (mon.alive) Combat.physical(player, mon, { mult: 1 + 0.2 * D.tripleAttack }); });
        player.game.overlay.addText(player.position, 'Trifecta!', 'skill');
        return;
      }
      Combat.physical(player, mon);
      // Rogue's Snatcher: sometimes steal on hit.
      if (D.snatcher && mon.alive && !mon.stolen && Math.random() * 100 < D.snatcher) {
        const table = mon.def.drops || [];
        const pick = table.filter((x) => !/^card_/.test(x.id))[Math.floor(Math.random() * Math.max(1, table.length - 1))];
        if (pick && player.inventory.add(pick.id, 1).added) { mon.stolen = true; player.game.log.add(`Snatched ${G.Items.get(pick.id).name}!`, 'loot'); }
      }
      if (mon.alive && player.derived.doubleAttack && Math.random() * 100 < player.derived.doubleAttack) {
        player.game.after(0.12, () => { if (mon.alive) Combat.physical(player, mon); });
      }
    },

    /* Monster -> player. Hard DEF reduces by percent, VIT soft DEF subtracts. */
    monsterAttack(mon, player) {
      const D = player.derived, d = mon.def, game = mon.game, U = G.Utils;
      const at = player.position.clone(); at.y += 1.3;
      const st = mon.status || {};
      const hitPct = U.clamp((80 + d.hit - D.flee) * (st.blinded ? 0.75 : 1) * (st.strip_helm ? 0.85 : 1), 5, 95);
      if (Math.random() * 100 >= hitPct) { game.overlay.addText(at, 'Miss', 'miss'); game.sfx('miss', at); return; }
      if (Combat.preHit) { const why = Combat.preHit(player, mon); if (why) { game.overlay.addText(at, why, 'miss'); game.sfx('miss', at); return; } }
      if (D.block && Math.random() * 100 < D.block) { game.overlay.addText(at, 'Blocked', 'miss'); game.sfx('miss', at); return; }
      const prov = mon.provoke && mon.provoke.until > game.time ? mon.provoke : null;
      const raw = U.randInt(Math.random, d.atk[0], d.atk[1]) * (prov ? 1 + prov.atkUp : 1) * (mon.status && mon.status.disarmed ? 0.75 : 1);
      let dmg = Math.max(1, Math.round(raw * (1 - Math.min(D.def, 90) / 100) - D.softDef));
      if (Combat.modHit) dmg = Combat.modHit(player, mon, dmg);
      game.effects.hit(at, false);
      game.overlay.addText(at, String(dmg), 'hurt');
      game.sfx('hurt');
      player.takeDamage(dmg, mon);
      if (Combat.postHit) Combat.postHit(player, mon, dmg);
    },
  };

  G.MonsterManager = MonsterManager;
  G.Combat = Combat;
})(window.G = window.G || {});
