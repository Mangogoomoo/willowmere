/* SkillSystem: one per player. Learning (points + prerequisites), using
   skills (target selection, walking into range, cast time, costs,
   cooldowns), timed buffs, passive bonuses, and the effect of every skill. */
(function (G) {
  'use strict';
  const U = G.Utils;

  const BUFFS = {
    endure: { name: 'Endure', icon: 'endure', bonus: (l) => ({ softDef: l, mdef: l }) },
    increase_agi: { name: 'Increase AGI', icon: 'increase_agi', bonus: (l) => ({ agi: 2 + l, moveSpeed: 25 }) },
    blessing: { name: 'Blessing', icon: 'blessing', bonus: (l) => ({ str: l, dex: l, int: l }) },
    improve_concentration: { name: 'Improve Concentration', icon: 'improve_concentration', bonus: (l) => ({ agi: 1 + Math.ceil(l / 2), dex: 1 + Math.ceil(l / 2) }) },
    angelus: { name: 'Angelus', icon: 'angelus', bonus: (l) => ({ softDef: 3 * l }) },
    crazy_uproar: { name: 'Crazy Uproar', icon: 'crazy_uproar', bonus: () => ({ str: 4, atk: 30 }) },
    // Second-job buffs
    two_hand_quicken: { name: 'Two-Hand Quicken', bonus: () => ({ aspd: 30 }) },
    auto_guard: { name: 'Auto Guard', bonus: (l) => ({ block: 5 + 3 * l }) },
    endow_blaze: { name: 'Endow Blaze', bonus: () => ({ weaponElement: 'fire' }) },
    endow_tornado: { name: 'Endow Tornado', bonus: () => ({ weaponElement: 'wind' }) },
    poem_of_bragi: { name: 'A Poem of Bragi', bonus: (l) => ({ castReduce: 3 * l }) },
    assassin_cross: { name: 'Assassin Cross of Sunset', bonus: (l) => ({ aspd: 10 + 2 * l }) },
    whistle: { name: 'Whistle', bonus: (l) => ({ flee: 2 * l, luk: l }) },
    service_for_you: { name: 'Service for You', bonus: (l) => ({ maxSpPct: 15 + l }) },
    humming: { name: 'Humming', bonus: (l) => ({ hit: 2 * l }) },
    sanctuary: { name: 'Sanctuary', bonus: () => ({}) },
    kyrie_eleison: { name: 'Kyrie Eleison', bonus: () => ({}) },
    impositio_manus: { name: 'Impositio Manus', bonus: (l) => ({ atk: 5 * l }) },
    gloria: { name: 'Gloria', bonus: () => ({ luk: 30 }) },
    enchant_poison: { name: 'Enchant Poison', bonus: (l) => ({ weaponElement: 'poison', poisonChance: 2.5 + 0.5 * l }) },
    adrenaline_rush: { name: 'Adrenaline Rush', bonus: () => ({ aspd: 30 }) },
    power_thrust: { name: 'Power Thrust', bonus: (l) => ({ atkPct: 5 * l }) },
  };
  const addBonus = (out, b) => { for (const k in b) out[k] = typeof b[k] === 'string' ? b[k] : (out[k] || 0) + b[k]; };

  class SkillSystem {
    constructor(player, data) {
      this.player = player;
      this.game = player.game;
      this.levels = Object.assign({}, (data && data.levels) || {});
      this.selected = Object.assign({}, (data && data.selected) || {});   // chosen cast level (if lower than learned)
      for (const s of Object.values(G.Skills.DB)) if (s.granted && !this.levels[s.id] && G.Skills.allowed(s.id, player.job)) this.levels[s.id] = 1;
      this.prune();
      this.cooldowns = {};
      this.buffs = {};          // id -> { level, until, total }
      this.casting = null;      // { id, level, target, t, dur }
      this.queued = null;       // waiting to get in range: { id, target }
      this.delay = 0;           // short after-cast delay shared by all skills
      this.motion = 0;          // seconds the character stands still while a skill goes off
    }

    level(id) { return this.levels[id] || 0; }

    // Drop skills this job can't have (Play Dead after leaving Novice).
    prune() {
      for (const id in this.levels) if (!G.Skills.allowed(id, this.player.job)) { delete this.levels[id]; delete this.selected[id]; }
      // Basic Training is always kept at 9 once you leave the Novice life.
      if (this.player.job !== 'novice') this.levels.basic_training = 9;
    }

    /* Level a skill is cast at: the learned level unless the player picked a lower one. */
    useLevel(id) {
      const lv = this.level(id);
      return Math.max(1, Math.min(lv, this.selected[id] || lv));
    }
    setUseLevel(id, lv) {
      const max = this.level(id);
      lv = Math.max(1, Math.min(max, lv));
      if (lv >= max) delete this.selected[id]; else this.selected[id] = lv;
      this.game.events.emit('skillsChanged');
      this.game.save.markDirty();
    }

    // Jobs whose skills this character may learn: the whole line (Novice, first job, second job).
    jobs() {
      const chain = [];
      for (let j = this.player.job; j; j = j === 'novice' ? null : (G.Jobs.get(j).from || 'novice')) chain.unshift(j);
      return chain;
    }

    // Planned (not yet confirmed) levels for the skill tree's Confirm button.
    planned(id, plan) { let n = 0; if (plan) for (const x of plan) if (x === id) n++; return n; }
    plannedCost(job, plan) { let n = 0; if (plan) for (const x of plan) { const s = G.Skills.get(x); if (s.job === job && !s.quest) n++; } return n; }

    canLearn(id, plan) {
      const s = G.Skills.get(id), p = this.player;
      const lvl = (x) => this.level(x) + this.planned(x, plan);
      if (!s) return { ok: false, reason: 'Unknown skill.' };
      if (s.granted) return { ok: false, reason: 'Learned automatically.' };
      if (!this.jobs().includes(s.job)) return { ok: false, reason: `Only a ${G.Jobs.get(s.job).name} can learn this.` };
      if (lvl(id) >= s.max) return { ok: false, reason: 'Already mastered.' };
      if (s.job === 'novice' && p.job !== 'novice') return { ok: false, reason: 'Novice skills are fixed after a job change.' };
      for (const [rid, rl] of s.req) if (lvl(rid) < rl) return { ok: false, reason: `Needs ${G.Skills.get(rid).name} level ${rl}.` };
      // Quest skills: free, once you reach job level 15 in that job (or have moved past it).
      if (s.quest) {
        if (p.job === s.job && p.jobLevel < 15) return { ok: false, reason: `${s.name} is a quest skill: it opens at job level 15.` };
        return { ok: true, free: true };
      }
      // Earlier jobs' points must be used up first (Novice, then the first job).
      const chain = this.jobs(), pools = p.pools(plan), idx = chain.indexOf(s.job);
      for (const j of chain.slice(0, idx)) {
        if (j === 'novice' && p.job !== 'novice') continue;
        if (pools[j] > 0) return { ok: false, reason: `Spend your ${pools[j]} ${G.Jobs.get(j).name} skill point${pools[j] === 1 ? '' : 's'} first.` };
      }
      // This job's points, or any later job's (never an earlier job's).
      const usable = s.job === 'novice' ? pools.novice : chain.slice(idx).reduce((n, j) => n + Math.max(0, pools[j]), 0);
      if (usable <= 0) return { ok: false, reason: `No skill points left for ${G.Jobs.get(s.job).name} skills.` };
      return { ok: true };
    }

    /* Skill reset: refund every point spent. Quest and granted skills stay, and
       once you've changed jobs your Novice skills (Basic Training) stay too. */
    reset() {
      const p = this.player;
      let refund = 0;
      for (const id in this.levels) {
        const s = G.Skills.get(id);
        // Basic Training is never reset; neither are quest/granted skills or Novice skills after a job change.
        if (!s || id === 'basic_training' || s.granted || s.quest || (s.job === 'novice' && p.job !== 'novice')) continue;
        refund += this.levels[id];
        delete this.levels[id];
        delete this.selected[id];
      }
      this.buffs = {};
      this.casting = null;
      p.spheres = 0;
      if (p.riding) { p.riding = false; p.refreshSprite(); }
      const hb = this.game.hotbar;
      if (hb) hb.slots.forEach((sl, i) => { if (sl && sl.type === 'skill' && !this.level(sl.id)) hb.set(i, null); });
      p.recalc();
      this.game.events.emit('skillsChanged');
      this.game.events.emit('buffsChanged');
      this.game.save.markDirty();
      return refund;
    }

    /* Add one level of a skill to a plan, adding any missing prerequisites
       first (recursively). Returns { ok, reason }; the plan is untouched on failure. */
    planAdd(id, plan) {
      const start = plan.length, seen = new Set();
      const ensure = (sid, want) => {
        if (seen.has(sid + ':' + want)) return null;
        seen.add(sid + ':' + want);
        const s = G.Skills.get(sid);
        while (this.level(sid) + this.planned(sid, plan) < want) {
          for (const [rid, rl] of s.req) { const e = ensure(rid, rl); if (e) return e; }
          const c = this.canLearn(sid, plan);
          if (!c.ok) return c.reason;
          plan.push(sid);
        }
        return null;
      };
      const err = ensure(id, this.level(id) + this.planned(id, plan) + 1);
      if (err) { plan.length = start; return { ok: false, reason: err }; }
      return { ok: true };
    }
    // Apply a confirmed plan in order.
    commit(plan) {
      let n = 0;
      for (const id of plan) { if (this.canLearn(id).ok) { this.learnQuiet(id); n++; } }
      this.player.recalc();
      this.game.events.emit('skillsChanged');
      this.game.save.markDirty();
      return n;
    }
    learnQuiet(id) {
      this.levels[id] = this.level(id) + 1;
      if (this.selected[id] && this.selected[id] >= this.levels[id] - 1) delete this.selected[id];
    }

    learn(id) {
      const c = this.canLearn(id);
      if (!c.ok) { this.game.log.add(c.reason, 'warn'); return false; }
      this.levels[id] = this.level(id) + 1;   // points are counted from the pools, nothing to subtract
      // Keep casting at max if that's what the player was doing.
      if (this.selected[id] && this.selected[id] >= this.levels[id] - 1) delete this.selected[id];
      this.player.recalc();
      this.game.events.emit('skillsChanged');
      this.game.save.markDirty();
      return true;
    }

    /* Stat bonuses from passives and active buffs (wired into G.Stats). */
    bonuses(out) {
      for (const id in this.levels) {
        const s = G.Skills.get(id);
        if (s && s.type === 'passive' && s.bonus) {
          addBonus(out, s.bonus(this.levels[id], this.player));
        }
      }
      for (const id in this.buffs) addBonus(out, BUFFS[id].bonus(this.buffs[id].level));
    }

    cooldownLeft(id) { return Math.max(this.cooldowns[id] || 0, this.delay); }

    /* ---------------- using skills ---------------- */
    // lvWant: the level to use (an action bar slot's own level); otherwise the one picked in the skills window.
    use(id, target, lvWant) {
      const s = G.Skills.get(id), p = this.player, game = this.game;
      if (!s || !this.level(id)) return false;
      if (p.vending) { if (id === 'vending') G.Vending.openSetup(this.level(id)); else game.log.add('Close your shop first.', 'info'); return false; }
      const lv = lvWant ? Math.max(1, Math.min(this.level(id), lvWant)) : this.useLevel(id);
      if (s.type === 'passive') { game.log.add(`${s.name} is passive. It’s always working.`, 'info'); return false; }
      if (!p.alive) return false;
      if (id !== 'play_dead' && p.playingDead) { this.execute(G.Skills.get('play_dead'), 1, null); }
      if (id !== 'hiding' && p.hidden) p.unhide();
      if (this.casting && id !== 'cast_cancel') return false;   // Cast Cancel is the one skill used mid-cast
      const fail = this.checkCosts(s, lv);
      if (fail) { game.log.add(fail, 'warn'); return false; }
      if (this.cooldownLeft(id) > 0) {
        // Still cooling down: it can go on the mouse (pick a target), but it only fires once ready.
        const mode = s.target === 'ground' ? 'ground' : s.target === 'ally' ? 'ally' : s.target === 'self' ? null : 'enemy';
        const picked = mode === 'ground' ? target && target.ground : mode === 'ally' ? !!target : target && target.alive;
        if (mode && !picked) { game.input.startTargeting(id, mode, lv); return false; }
        if (mode) game.log.add(`${s.name} isn’t ready yet.`, 'info');
        return false;
      }

      if (s.target === 'self') { this.begin(s, lv, null); return true; }
      if (s.target === 'ground') {
        if (!target || !target.ground) { game.input.startTargeting(id, 'ground', lv); return false; }
        if (p.position.distanceTo(target.position) <= this.range(s, lv) + 0.5) this.begin(s, lv, target);
        else { this.queued = { id, target, lv }; p.approach(target, this.range(s, lv)); }
        return true;
      }
      if (s.target === 'ally') {
        // Like the classics: pick a character to bless (yourself for now).
        if (target && target === p) { this.begin(s, lv, p); return true; }
        // Another player: walk into range first if needed.
        if (target && target.isRemote) {
          if (p.distanceTo(target) <= this.range(s, lv) + 0.5) this.begin(s, lv, target);
          else { this.queued = { id, target, lv }; p.approach(target, this.range(s, lv)); }
          return true;
        }
        game.input.startTargeting(id, 'ally', lv);
        return false;
      }

      // Enemy-targeted: always pick the target with a click (never auto-cast on
      // whatever you happen to be auto-attacking). A target is only passed in
      // by that click.
      const t = target && target.alive ? target : null;
      if (!t) { game.input.startTargeting(id, 'enemy', lv); return false; }
      if (this.inRange(s, t, lv)) this.begin(s, lv, t);
      else { this.queued = { id, target: t, lv }; p.approach(t, this.range(s, lv)); }
      return true;
    }

    range(s, lv) {
      return s.range === 'weapon' ? this.player.attackRange : s.range(lv || this.useLevel(s.id));
    }
    inRange(s, t, lv) { return t === this.player || this.player.distanceTo(t) <= this.range(s, lv) + (t.def ? t.def.radius : 0.5) + 0.1; }

    checkCosts(s, lv) {
      const p = this.player;
      const sp = s.sp(lv), hp = s.hp ? s.hp(lv) : 0, zeny = s.zeny ? s.zeny(lv) : 0;
      if (p.sp < sp) return `Not enough SP for ${s.name} (${sp} needed).`;
      if (hp && p.hp <= hp) return `Not enough HP for ${s.name}.`;
      if (zeny && p.zeny < zeny) return `${s.name} needs ${zeny} Zeny.`;
      if (s.needs && p.derived.weaponType !== s.needs) return `${s.name} needs a ${G.Items.WEAPON_TYPES[s.needs].name.toLowerCase()}.`;
      if (s.needs === 'bow' && !p.equipment.ammo) return `${s.name} needs arrows (Equipment window, Arrows slot).`;
      if (G.SkillSystem.extraCheck) { const x = G.SkillSystem.extraCheck(this, s, lv); if (x) return x; }
      return null;
    }

    begin(s, lv, target) {
      const p = this.player;
      this.queued = null;
      const base = s.cast(lv);
      if (base > 0) {
        // DEX shortens cast time (150 DEX would make it instant).
        const dur = this.castTime(s, lv);
        if (this.buffs.suffragium) { delete this.buffs.suffragium; this.player.recalc(); }
        this.casting = { id: s.id, level: lv, target, t: 0, dur, element: s.element };
        p.path = null;
        p.attacking = false;
        if (target && target !== p) p.faceTowards(target.position.x, target.position.z);
        this.game.spells.castCircle(p, s.element);
        this.game.sfx('cast');
        if (G.Net && G.Net.ws) G.Net.send({ t: 'fx', k: 'cast', s: s.id, lv, dur: +dur.toFixed(2) });
        return;
      }
      this.execute(s, lv, target);
    }

    // Cast time after DEX (150 DEX would make spells instant).
    castTime(s, lv) {
      const D = this.player.derived;
      return s.cast(lv) * Math.max(0, 1 - D.total.dex / 150) * Math.max(0.3, 1 - (D.castReduce || 0) / 100);
    }

    cancelCast(reason) {
      if (!this.casting) return;
      this.casting = null;
      this.game.spells.endCastCircle();
      if (reason) this.game.log.add(reason, 'info');
    }

    execute(s, lv, target) {
      const p = this.player, game = this.game;
      const fail = this.checkCosts(s, lv);
      if (fail) { game.log.add(fail, 'warn'); return; }
      if (target && !target.alive) return;
      p.sp -= s.sp(lv);
      if (s.hp) p.hp -= s.hp(lv);
      if (s.zeny) p.zeny -= s.zeny(lv);
      this.cooldowns[s.id] = s.cd(lv);
      this.delay = 0.25;
      if (s.needs === 'bow') p.inventory.useAmmo(1);   // a bow skill uses one arrow
      // Like RO: using a skill stops you where you stand for one attack motion (based on ASPD).
      p.path = null; p.approachTarget = null; p.pendingLoot = null;
      const motion = p.sprite.duration('attack');
      this.motion = Math.min(motion, p.derived.attackDelay * 0.92);
      this.motionAnim = s.target === 'self' || s.target === 'ally' ? 'cast' : 'attack';
      p.sprite.play(this.motionAnim, { restart: true, speed: this.motionAnim === 'attack' ? motion / this.motion : 1 });
      if (target && target !== p) p.faceTowards(target.position.x, target.position.z);
      if (G.SkillSystem.payExtra) G.SkillSystem.payExtra(this, s, lv);
      if (G.Net && G.Net.ws) G.Net.skillFx(s, lv, target);
      // Buffing another player: they apply it on their side.
      if (target && target.isRemote) { if (G.Net) G.Net.sendBuff(target, s, lv); return; }
      const eff = EFFECTS[s.effect || s.id];
      if (eff) eff(this, lv, target, s);
      else if (s.fx) runFx(this, s, lv, target);
      if (s.id !== 'play_dead') game.overlay.addText(p.position, s.name + '!', 'skill');
      game.save.markDirty();
    }

    addBuff(id, level, seconds) {
      this.game.sfx('buff');
      if (id === 'kyrie_eleison') this.player.shieldHp = Math.round(this.player.maxHp * (10 + 2 * level) / 100);
      this.buffs[id] = { level, until: this.game.time + seconds, total: seconds };
      this.player.recalc();
      this.game.events.emit('buffsChanged');
    }

    update(dt) {
      const p = this.player;
      for (const id in this.cooldowns) { this.cooldowns[id] -= dt; if (this.cooldowns[id] <= 0) delete this.cooldowns[id]; }
      if (this.delay > 0) this.delay -= dt;
      if (this.motion > 0) this.motion -= dt;
      let changed = false;
      for (const id in this.buffs) if (this.game.time >= this.buffs[id].until) {
        delete this.buffs[id]; changed = true;
        this.game.log.add(`${BUFFS[id].name} wore off.`, 'info');
      }
      if (changed) { p.recalc(); this.game.events.emit('buffsChanged'); }
      if (!this.buffs.kyrie_eleison) p.shieldHp = 0;
      // Sanctuary: heal every second while it lasts.
      if (this.buffs.sanctuary) {
        this.sanctT = (this.sanctT || 0) + dt;
        if (this.sanctT >= 1) { this.sanctT -= 1; p.heal(20 + 15 * this.buffs.sanctuary.level); this.game.spells.aura(p, '#bff2c0'); }
      } else this.sanctT = 0;

      if (p.hidden) {
        this.hideDrain = (this.hideDrain || 0) + dt;
        const every = 4 + this.level('hiding');
        if (this.hideDrain >= every) {
          this.hideDrain -= every;
          if (p.sp <= 0) { p.unhide(); this.game.log.add('Out of SP. You reappear.', 'info'); }
          else p.sp -= 1;
        }
      }

      if (this.casting) {
        const c = this.casting;
        if (c.target && !c.target.alive) { this.cancelCast(); return; }
        c.t += dt;
        if (c.t >= c.dur) {
          this.casting = null;
          this.game.spells.endCastCircle();
          this.execute(G.Skills.get(c.id), c.level, c.target);
        }
      }
      // Walked into range of a queued skill.
      if (this.queued) {
        const q = this.queued, s = G.Skills.get(q.id);
        if (!q.target.alive) this.queued = null;
        else if (this.inRange(s, q.target, q.lv)) { p.path = null; this.begin(s, q.lv || this.useLevel(q.id), q.target); }
      }
    }

    serialize() { return { levels: this.levels, selected: this.selected }; }
  }

  /* ---------------- effects ---------------- */
  const C = () => G.Combat;
  const EFFECTS = {
    first_aid(sys) {
      const p = sys.player, amt = 8 + p.baseLevel;
      p.heal(amt);
    },
    play_dead(sys) {
      const p = sys.player, game = sys.game;
      p.playingDead = !p.playingDead;
      p.path = null; p.attacking = false;
      if (p.playingDead) {
        for (const m of game.monsters.list) if (m.aggro === p) m.loseInterest();
        game.log.add('You play dead. Monsters lose interest.', 'info');
      } else game.log.add('You get back up.', 'info');
    },
    bash(sys, lv, t) {
      sys.game.spells.impact(t, '#ffb347', 1.6);
      C().physical(sys.player, t, { mult: 1 + 0.3 * lv, hitBonus: 5 * lv });
    },
    magnum_break(sys, lv) {
      const p = sys.player, game = sys.game;
      game.spells.ring(p.position, '#ff7a3d', 2.8);
      for (const m of game.monsters.list) {
        if (!m.alive || p.distanceTo(m) > 2.8 + m.def.radius) continue;
        C().physical(p, m, { mult: 1 + 0.2 * lv, hitBonus: 10 * lv, element: 'fire' });
        if (m.alive) m.knockback(p.position.x, p.position.z, 1.6);
      }
    },
    provoke(sys, lv, t) {
      const game = sys.game, at = t.position.clone(); at.y += t.def.height + 0.3;
      if (Math.random() * 100 < 50 + 3 * lv) {
        t.provoke = { until: game.time + 30, defDown: (5 + 5 * lv) / 100, atkUp: (2 + 3 * lv) / 100 };
        t.aggroOn(sys.player);
        game.overlay.addText(at, 'Provoked!', 'debuff');
        game.spells.impact(t, '#ff5468', 1.2);
      } else game.overlay.addText(at, 'Resisted', 'miss');
    },
    endure(sys, lv) {
      sys.addBuff('endure', lv, 7 + 3 * lv);
      sys.game.spells.aura(sys.player, '#7fb8ff');
    },
    fire_bolt: (sys, lv, t) => boltVolley(sys, lv, t, 'fire'),
    cold_bolt: (sys, lv, t) => boltVolley(sys, lv, t, 'water'),
    lightning_bolt: (sys, lv, t) => boltVolley(sys, lv, t, 'wind'),
    double_strafe(sys, lv, t) {
      const p = sys.player;
      for (let i = 0; i < 2; i++) {
        sys.game.after(i * 0.11, () => {
          if (!t.alive) return;
          sys.game.spells.arrow(p, t, () => C().physical(p, t, { mult: 1 + 0.1 * lv, ranged: true }));
        });
      }
    },
    heal(sys, lv) {
      const p = sys.player;
      p.heal(SkillSystem.healAmount(p, lv));
      sys.game.spells.aura(p, '#7dff9a');
    },
    increase_agi(sys, lv) {
      sys.addBuff('increase_agi', lv, 40 + 20 * lv);
      sys.game.spells.aura(sys.player, '#8fe0d0');
    },
    blessing(sys, lv) {
      sys.addBuff('blessing', lv, 40 + 20 * lv);
      sys.game.spells.aura(sys.player, '#ffe27a');
    },
    angelus(sys, lv) {
      sys.addBuff('angelus', lv, 30 * lv);
      sys.game.spells.aura(sys.player, '#ffd0f0');
    },
    decrease_agi(sys, lv, t) {
      const game = sys.game, at = t.position.clone(); at.y += t.def.height + 0.3;
      if (Math.random() * 100 < 40 + 2 * lv) {
        t.addStatus('slowed', 20 + 5 * lv);
        game.overlay.addText(at, 'Slowed', 'debuff');
        game.spells.impact(t, '#b07fd6', 1.0);
      } else game.overlay.addText(at, 'Resisted', 'miss');
    },
    holy_light(sys, lv, t) {
      sys.game.spells.beam(t, '#fff2a0', () => C().magic(sys.player, t, { mult: 1.25, element: 'holy' }));
    },
    soul_strike(sys, lv, t) {
      const p = sys.player;
      for (let i = 0; i < Math.ceil(lv / 2); i++) {
        sys.game.after(i * 0.12, () => { if (t.alive) sys.game.spells.orb(p, t, '#b9a4ff', () => C().magic(p, t, { mult: 1, element: 'ghost' })); });
      }
    },
    frost_diver(sys, lv, t) {
      const p = sys.player, game = sys.game;
      game.spells.orb(p, t, '#9fe2ff', () => {
        C().magic(p, t, { mult: 1 + 0.1 * lv, element: 'water' });
        if (t.alive && Math.random() * 100 < 35 + 3 * lv) {
          t.addStatus('frozen', 3 * lv);
          const at = t.position.clone(); at.y += t.def.height + 0.3;
          game.overlay.addText(at, 'Frozen', 'debuff');
        }
      });
    },
    fire_ball(sys, lv, t) {
      const p = sys.player, game = sys.game;
      game.spells.orb(p, t, '#ff7a3d', () => {
        game.spells.ring(t.position, '#ff7a3d', 2.5);
        for (const m of enemiesNear(game, t.position, 2.5)) C().magic(p, m, { mult: 0.7 + 0.1 * lv, element: 'fire' });
      }, 0.45);
    },
    thunderstorm(sys, lv, t) {
      const p = sys.player, game = sys.game, c = t.position.clone();
      for (let i = 0; i < lv; i++) {
        game.after(i * 0.22, () => {
          const at = { position: new THREE.Vector3(c.x + (Math.random() - 0.5) * 3, c.y, c.z + (Math.random() - 0.5) * 3), def: { height: 1 }, alive: true };
          game.spells.bolt('wind', at, () => {});
          for (const m of enemiesNear(game, c, 3)) C().magic(p, m, { mult: 0.8, element: 'wind' });
        });
      }
    },
    sword_mastery() {}, hp_recovery() {},
    arrow_shower(sys, lv, t) {
      const p = sys.player, game = sys.game, c = t.position.clone();
      for (let i = 0; i < 9; i++) {
        const fake = { position: new THREE.Vector3(c.x + (Math.random() - 0.5) * 3.5, c.y, c.z + (Math.random() - 0.5) * 3.5), def: { height: 0.4 }, alive: true };
        game.after(i * 0.03, () => game.spells.arrow(p, fake, () => {}));
      }
      game.after(0.3, () => {
        for (const m of enemiesNear(game, c, 2.2)) {
          C().physical(p, m, { mult: 0.75 + 0.05 * lv, ranged: true });
          if (m.alive) m.knockback(p.position.x, p.position.z, 1.2);
        }
      });
    },
    arrow_repel(sys, lv, t) {
      const p = sys.player;
      sys.game.spells.arrow(p, t, () => {
        C().physical(p, t, { mult: 1.5, ranged: true });
        if (t.alive) t.knockback(p.position.x, p.position.z, 4);
      });
    },
    improve_concentration(sys, lv) {
      sys.addBuff('improve_concentration', lv, 40 + 20 * lv);
      sys.game.spells.aura(sys.player, '#ffb347');
    },
    envenom(sys, lv, t) {
      const game = sys.game;
      game.spells.impact(t, '#6fd06a', 1.0);
      C().physical(sys.player, t, { mult: 1, flat: 15 * lv });
      if (t.alive && Math.random() * 100 < 10 + 4 * lv) {
        t.addStatus('poisoned', 12, { dps: Math.max(1, Math.round(2 + lv * 0.8)) });
        const at = t.position.clone(); at.y += t.def.height + 0.3;
        game.overlay.addText(at, 'Poisoned', 'debuff');
      }
    },
    back_slide(sys) {
      const p = sys.player, nav = sys.game.nav;
      const dx = -Math.sin(p.facing), dz = -Math.cos(p.facing);
      let x = p.position.x, z = p.position.z;
      for (let d = 0; d < 5; d += 0.25) { if (!nav.walkable(x + dx * 0.25, z + dz * 0.25)) break; x += dx * 0.25; z += dz * 0.25; }
      sys.game.effects.sparkle(p.position, [0.7, 0.85, 1], 10);
      p.path = null; p.attacking = false;
      p.setPosition(x, z);
    },
    hiding(sys) {
      const p = sys.player;
      if (p.hidden) { p.unhide(); return; }
      p.hidden = true; p.path = null; p.attacking = false;
      sys.hideDrain = 0;
      for (const m of sys.game.monsters.list) if (m.aggro === p) m.loseInterest();
      sys.game.log.add('You slip out of sight.', 'info');
    },
    cart_revolution(sys, lv, t) {
      const p = sys.player, game = sys.game;
      game.spells.ring(t.position, '#d98a4a', 2.2);
      for (const m of enemiesNear(game, t.position, 2.2)) {
        C().physical(p, m, { mult: 1.5 });
        if (m.alive) m.knockback(p.position.x, p.position.z, 2);
      }
    },
    // Monk finisher: pours all SP into one enormous blow.
    asura_strike(sys, lv, t) {
      const p = sys.player, game = sys.game, sp = p.sp + G.Skills.get('asura_strike').sp(lv);
      p.sp = 0;
      const D = p.derived, atk = D.statusAtk + D.weaponAtk + D.atkBonus;
      const dmg = Math.round(atk * (8 + sp / 10) + 250 + 150 * lv);
      game.spells.impact(t, '#ff3b3b', 2.5);
      game.spells.ring(t.position, '#ff5468', 2.5);
      game.sfx('slam', t.position);
      const at = t.position.clone(); at.y += t.def.height * 0.6;
      game.overlay.addText(at, String(dmg), 'crit');
      t.takeDamage(dmg, p);
    },
    // Alchemist fire bomb: burning ground that ticks for a few seconds.
    demonstration(sys, lv, t) {
      const p = sys.player, game = sys.game, c = t.position.clone(), ticks = (4 + lv) * 2;
      for (let i = 0; i < ticks; i++) {
        game.after(i * 0.5, () => {
          if (i % 2 === 0) game.spells.ring(c, '#ff7a3d', 2.5);
          game.effects.sparks.burst(c.x, c.y + 0.3, c.z, 6, { color: [1, 0.55, 0.2], size: 0.35, speed: 2, up: 2, life: 0.5 });
          for (const m of enemiesNear(game, c, 2.5)) C().magic(p, m, { mult: 0.6 + 0.1 * lv, element: 'fire' });
        });
      }
    },
    crazy_uproar(sys) {
      sys.addBuff('crazy_uproar', 1, 300);
      sys.game.spells.aura(sys.player, '#ff9f43');
    },
    steal(sys, lv, t) {
      const p = sys.player, game = sys.game, at = t.position.clone(); at.y += t.def.height + 0.3;
      if (t.stolen) { game.overlay.addText(at, 'Nothing left', 'miss'); return; }
      const chance = 4 + 6 * lv + (p.derived.total.dex - t.def.level) * 0.5;
      if (Math.random() * 100 >= chance) { game.overlay.addText(at, 'Failed', 'miss'); return; }
      // Pick one entry from the drop table, weighted by its drop chance.
      const table = t.def.drops || [];
      let total = 0; for (const d of table) total += d.chance;
      let r = Math.random() * total, pick = table[0];
      for (const d of table) { r -= d.chance; if (r <= 0) { pick = d; break; } }
      const res = p.inventory.add(pick.id, 1);
      if (!res.added) { game.log.add('No room to hold what you stole.', 'warn'); return; }
      t.stolen = true;
      game.overlay.addText(at, 'Stolen!', 'skill');
      game.log.add(`You stole ${G.Items.get(pick.id).name}.`, 'loot');
      game.spells.impact(t, '#c79bff', 1.0);
    },
    mammonite(sys, lv, t) {
      sys.game.spells.coins(t);
      C().physical(sys.player, t, { mult: 1 + 0.5 * lv });
    },
  };

  /* Generic effect engine for data-described skills (see data/skills2.js). */
  function runFx(sys, s, lv, target) {
    const fx = s.fx, p = sys.player, game = sys.game;
    if (fx.kind === 'buff') { sys.addBuff(fx.id, lv, fx.dur(lv)); game.spells.aura(p, fx.color || '#ffffff'); return; }
    if (fx.kind === 'heal') { p.heal(fx.amount(lv)); game.spells.aura(p, fx.color || '#7dff9a'); return; }
    const center = fx.at === 'self' || !target ? p.position.clone() : target.position.clone();
    const victims = () => (fx.area ? enemiesNear(game, center, fx.area) : (target && target.alive ? [target] : []));
    if (fx.area && fx.visual === 'ring') game.spells.ring(center, fx.color || '#ffffff', fx.area);
    const hits = fx.hits ? fx.hits(lv) : 1;
    const apply = (m) => {
      if (!m.alive) return;
      if (fx.kind === 'magic') C().magic(p, m, { mult: fx.mult(lv), element: fx.element });
      else if (fx.kind === 'phys') C().physical(p, m, { mult: fx.mult(lv), element: fx.element, noMiss: fx.noMiss, ignoreDef: fx.ignoreDef, ranged: fx.ranged, hitBonus: fx.hitBonus || 0, skill: s.id });
      if (fx.status && m.alive) {
        const at = m.position.clone(); at.y += m.def.height + 0.3;
        if (Math.random() * 100 < fx.status.chance(lv)) {
          m.addStatus(fx.status.id, fx.status.dur(lv));
          game.overlay.addText(at, { frozen: 'Frozen', stunned: 'Stunned', rooted: 'Snared', slowed: 'Slowed', disarmed: 'Disarmed', poisoned: 'Poisoned' }[fx.status.id] || fx.status.id, 'debuff');
        } else if (fx.kind === 'status') game.overlay.addText(at, 'Resisted', 'miss');
      }
      if (fx.knock && m.alive) m.knockback(p.position.x, p.position.z, fx.knock);
    };
    for (let i = 0; i < hits; i++) {
      game.after(i * (fx.hitDelay || 0.12), () => {
        for (const m of victims()) {
          const v = fx.visual;
          if (fx.kind === 'phys' && !fx._tagged) fx.skill = s.id;
          if (v === 'bolt' || v === 'meteor') game.spells.bolt(fx.element || 'fire', m, () => apply(m));
          else if (v === 'orb') game.spells.orb(p, m, fx.color || '#ffffff', () => apply(m));
          else if (v === 'arrow') game.spells.arrow(p, m, () => apply(m));
          else if (v === 'beam') game.spells.beam(m, fx.color || '#fff2a0', () => apply(m));
          else { if (v === 'impact') game.spells.impact(m, fx.color || '#ffffff', 1); apply(m); }
        }
        if (fx.visual === 'meteor') game.spells.ring(center, '#ff7a3d', fx.area || 2);
      });
    }
  }

  function enemiesNear(game, pos, r) {
    return game.monsters.list.filter((m) => m.alive && Math.hypot(m.position.x - pos.x, m.position.z - pos.z) <= r + m.def.radius);
  }

  function boltVolley(sys, lv, t, element) {
    const p = sys.player;
    for (let i = 0; i < lv; i++) {
      sys.game.after(i * 0.14, () => {
        if (!t.alive) return;
        sys.game.spells.bolt(element, t, () => C().magic(p, t, { mult: 1, element }));
      });
    }
  }

  G.SkillSystem = SkillSystem;
  G.SkillSystem.BUFFS = BUFFS;
  G.SkillSystem.EFFECTS = EFFECTS;
  G.SkillSystem.runFx = runFx;
  // Heal: (base level + INT) / 8 x (4 + 8 x level), raised by heal-power gear and cards.
  SkillSystem.healAmount = (p, lv) => Math.round(Math.max(1, Math.floor((p.baseLevel + p.derived.total.int) / 8)) * (4 + 8 * lv) * (1 + ((p.derived.extra || {}).healPct || 0) / 100));

  // Passive skills and buffs feed the stat calculation.
  G.Stats.sources.push(function skills(player, out) { if (player.skills) player.skills.bonuses(out); });
})(window.G = window.G || {});
