/* Stats: turns base stats + levels + equipment (+ later cards, skills and
   buffs) into the derived numbers combat uses. Bonus sources are pluggable:
   push a function onto G.Stats.sources and it is included automatically.

   STR  physical attack, carrying capacity
   AGI  attack speed, FLEE
   VIT  max HP, soft defence, HP recovery
   INT  max SP, magic attack, magic defence, SP recovery
   DEX  HIT, attack consistency, (later) cast speed and ranged damage
   LUK  critical chance, small ATK/HIT/FLEE bonus                       */
(function (G) {
  'use strict';
  const KEYS = ['str', 'agi', 'vit', 'int', 'dex', 'luk'];
  const MAX_STAT = 99;

  const Stats = {
    KEYS, MAX_STAT,
    // Cost to raise a stat from its current value by one (classic curve).
    cost(v) { return Math.floor((v - 1) / 10) + 2; },
    // Points granted on reaching base level lv.
    // Classic: floor((level - 1) / 5) + 3 on reaching each base level, plus 48 at
    // creation, which comes to 1,273 points by level 99.
    START_POINTS: 48,
    pointsForLevel(lv) { return Math.floor((lv - 1) / 5) + 3; },
    // Total points a character has earned by base level lv (for resets).
    totalPoints(lv) { let s = Stats.START_POINTS; for (let l = 2; l <= lv; l++) s += Stats.pointsForLevel(l); return s; },
    oldTotalPoints(lv) { let s = 0; for (let l = 2; l <= lv; l++) s += Math.floor(l / 5) + 3; return s; },

    sources: [
      // Equipment bonuses.
      function equipment(player, out) {
        const bow = player.equipment.weapon && (G.Items.get(player.equipment.weapon.id) || {}).weaponType === 'bow';
        for (const slot in player.equipment) {
          const e = player.equipment[slot];
          if (!e || (slot === 'ammo' && !bow)) continue;   // arrows only count with a bow
          const item = G.Items.get(e.id);
          // Numbers add up; a word (like an arrow's element) is simply set.
          if (item && item.bonus) for (const k in item.bonus) { const v = item.bonus[k]; out[k] = typeof v === 'number' ? (out[k] || 0) + v : v; }
          // Refine level bonus (ATK for weapons, DEF for armour).
          if (e.refine && G.Refine) { const rb = G.Refine.bonus(e); for (const k in rb) out[k] = (out[k] || 0) + rb[k]; }
          // Cards inserted into this piece of equipment.
          for (const cid of e.cards || []) {
            const c = G.Items.get(cid);
            if (c && c.bonus) for (const k in c.bonus) out[k] = (out[k] || 0) + c.bonus[k];
          }
        }
      },
    ],

    collectBonuses(player) {
      if (!Stats._x && G.SkillsX) { Stats._x = true; Stats.sources.push((p, out) => { const b = G.SkillsX.bonuses(p); for (const k in b) out[k] = typeof b[k] === 'string' ? b[k] : (out[k] || 0) + b[k]; }); }
      const out = {};
      for (const src of Stats.sources) src(player, out);
      return out;
    },

    compute(player) {
      const b = Stats.collectBonuses(player);
      const job = G.Jobs.get(player.job) || G.Jobs.get('novice');
      const lv = player.baseLevel;
      const s = {};
      for (const k of KEYS) s[k] = player.stats[k] + (b[k] || 0);

      const weapon = player.equipment.weapon ? G.Items.get(player.equipment.weapon.id) : null;
      const wtype = G.Items.WEAPON_TYPES[weapon ? weapon.weaponType : 'none'];

      const d = { total: s, bonus: b, weaponType: weapon ? weapon.weaponType : 'none' };
      d.maxHp = Math.floor(((40 + lv * 8 + lv * lv * 0.25) * (1 + s.vit * 0.01) * job.hpMult + (b.maxHp || 0)) * (1 + (b.maxHpPct || 0) / 100));
      d.maxSp = Math.floor(((10 + lv * 3) * (1 + s.int * 0.01) * job.spMult + (b.maxSp || 0)) * (1 + (b.maxSpPct || 0) / 100));

      // Ranged weapons use DEX as the main damage stat, others use STR.
      const ranged = d.weaponType === 'bow';
      const main = ranged ? s.dex : s.str, sub = ranged ? s.str : s.dex;
      d.statusAtk = main + Math.floor(main / 10) ** 2 + Math.floor(sub / 5) + Math.floor(s.luk / 5) + Math.floor(lv / 4);
      d.weaponAtk = weapon ? (weapon.bonus.atk || 0) : 0;
      d.atkBonus = (b.atk || 0) - d.weaponAtk;
      d.matkMin = s.int + Math.floor(s.int / 7) ** 2 + (b.matk || 0);
      d.matkMax = s.int + Math.floor(s.int / 5) ** 2 + (b.matk || 0);
      d.def = b.def || 0;                                  // hard DEF: % reduction
      d.softDef = Math.floor(s.vit / 2) + Math.floor(lv / 5) + (b.softDef || 0);
      d.mdef = (b.mdef || 0);
      d.softMdef = s.int;
      d.hit = lv + s.dex + Math.floor(s.luk / 3) + (b.hit || 0);
      d.flee = lv + s.agi + Math.floor(s.luk / 5) + (b.flee || 0);
      d.crit = Math.round((1 + s.luk * 0.3 + (b.crit || 0)) * 10) / 10;
      // Weapon "consistency": DEX narrows the damage range toward the max.
      d.weaponMinFrac = Math.min(1, 0.55 + s.dex * 0.008);

      // Attack delay in seconds, and a classic-style ASPD number for display.
      const speed = (1 - s.agi * 0.004 - s.dex * 0.001) * (1 - (b.aspd || 0) / 100);
      d.attackDelay = Math.max(0.28, wtype.delay * speed);
      d.aspd = Math.round(200 - d.attackDelay * 55);
      d.attackRange = wtype.range + (d.weaponType === 'bow' ? (b.bowRange || 0) : 0);
      d.moveSpeedMult = 1 + (b.moveSpeed || 0) / 100;
      // Riding, the cart and cloaking change your pace.
      if (player.riding) d.moveSpeedMult *= 1.36;
      if (b.cart && player.job !== 'novice') { const pl = player.skills.level('pushcart'); if (pl < 10) d.moveSpeedMult *= 1 - (50 - 5 * pl) / 100; }
      if (player.skills && player.skills.buffs.cloaking) d.moveSpeedMult *= 0.6;
      d.doubleAttack = d.weaponType === 'dagger' ? (b.doubleAttack || 0) : 0;
      d.discount = b.discount || 0;
      d.weaponElement = b.weaponElement || b.forgedElement || b.arrowElement || 'neutral';
      d.extra = b;
      d.atkPct = b.atkPct || 0;
      d.block = b.block || 0;
      d.castReduce = b.castReduce || 0;
      d.tripleAttack = b.tripleAttack || 0;
      d.snatcher = b.snatcher || 0;
      d.poisonChance = b.poisonChance || 0;
      if (d.weaponType === 'katar') d.crit = Math.round(d.crit * 2 * 10) / 10;   // katars double critical rate
      d.overcharge = b.overcharge || 0;

      d.maxWeight = 2000 + s.str * 30 + (b.weightLimit || 0);
      d.hpRegen = Math.max(1, d.maxHp / 200 + s.vit / 5) * 0.6 * (1 + (b.hpRegenPct || 0) / 100);   // per second when resting
      d.spRegen = Math.max(0.3, d.maxSp / 100 + s.int / 6) * 0.25 * (1 + (b.spRegenPct || 0) / 100);
      return d;
    },
  };

  G.Stats = Stats;
})(window.G = window.G || {});
