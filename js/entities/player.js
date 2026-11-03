/* Player: the Novice. Handles click-to-move, chasing and auto-attacking a
   selected monster, taking damage, regeneration, levelling and respawning. */
(function (G) {
  'use strict';
  const C = G.Config, P = C.PLAYER, U = G.Utils;

  const START_KIT = {
    equip: ['knife', 'cotton_shirt'],
    items: [['novice_potion', 15], ['red_potion', 3], ['butterfly_wing', 1], ['fly_wing', 2]],
    zeny: 500,
  };

  class Player extends G.Entity {
    /* data: a save object, or { name, appearance } for a new character. */
    constructor(game, data) {
      const appearance = (data.character ? data.character.appearance : data.appearance) || {};
      super(game, G.SpriteFactory.humanoid(appearance, { job: data.job || 'novice', weapon: 'dagger' }), { shadowSize: 1.15, radius: P.radius });
      this.appearance = appearance;
      this.name = data.character ? data.character.name : data.name;
      this.job = data.job || 'novice';
      this.baseLevel = data.baseLevel || 1;
      this.jobLevel = data.jobLevel || 1;
      this.baseExp = data.baseExp || 0;
      this.jobExp = data.jobExp || 0;
      this.stats = Object.assign({ str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 }, data.stats || {});
      this.statPoints = data.statPoints || 0;
      this.skillPoints = data.skillPoints || 0;
      this.zeny = data.zeny == null ? START_KIT.zeny : data.zeny;
      this.savePoint = Object.assign({ map: 'meadow', x: P.respawn.x, z: P.respawn.z }, data.savePoint || {});
      this.extra = data.extra || {};
      this.equipment = {};
      for (const s of G.Items.EQUIP_SLOTS) this.equipment[s.id] = null;
      this.inventory = new G.Inventory(this);
      this.skills = new G.SkillSystem(this, data.skills);
      this.playingDead = false;
      this.approachTarget = null;
      this.derived = G.Stats.compute(this);

      if (data.version) {
        // Loading an existing character.
        this.inventory.load(data.inventory);
        for (const slot in data.equipment || {}) {
          const e = data.equipment[slot];
          if (e && G.Items.get(e.id) && slot in this.equipment) this.equipment[slot] = { uid: this.inventory.nextUid++, id: e.id, qty: 1, cards: e.cards || [] };
        }
      } else {
        // Fresh Novice with the starter kit.
        for (const id of START_KIT.equip) this.equipment[G.Items.get(id).slot] = { uid: this.inventory.nextUid++, id, qty: 1, cards: [] };
        for (const [id, n] of START_KIT.items) this.inventory.add(id, n, { ignoreWeight: true });
      }
      this.recalc();
      this.hp = data.hp == null ? this.maxHp : Math.min(data.hp, this.maxHp);
      this.sp = data.sp == null ? this.maxSp : Math.min(data.sp, this.maxSp);
      if (this.hp <= 0) this.hp = Math.ceil(this.maxHp / 2);

      this.target = null;        // currently selected monster
      this.attacking = false;    // whether we intend to keep hitting it
      this.pendingLoot = null;   // loot we are walking over to pick up
      this.attackCd = 0;
      this.swinging = false;
      this.swingT = 0;
      this.impactDone = false;
      this.hurtT = 0;
      this.repathT = 0;
      this.lastGoal = null;
      this.lastDamageTime = -99;
      this.deadT = 0;
      this.regenAcc = 0;
      this.spRegenAcc = 0;
    }

    /* ---------- derived values ---------- */
    recalc() {
      this.derived = G.Stats.compute(this);
      this.refreshSprite();
      if (this.hp != null) { this.hp = Math.min(this.hp, this.maxHp); this.sp = Math.min(this.sp, this.maxSp); }
      if (this.game.events) this.game.events.emit('statsChanged', this);
    }
    get maxHp() { return this.derived.maxHp; }
    get maxSp() { return this.derived.maxSp; }
    get level() { return this.baseLevel; }
    get jobDef() { return G.Jobs.get(this.job); }
    get expToNext() { return C.EXP_TABLE[this.baseLevel] || Infinity; }
    get jobExpToNext() {
      const j = this.jobDef;
      return this.jobLevel >= j.maxJobLevel ? Infinity : (j.jobExp[this.jobLevel] || Infinity);
    }
    get attackRange() { return this.derived.attackRange; }
    get moveSpeed() { return P.speed * this.derived.moveSpeedMult; }

    // The sprite shows the job outfit and the weapon type in hand.
    lookKey() { return this.job + ':' + this.derived.weaponType; }
    refreshSprite() {
      if (!this.sprite) return;
      const key = this.lookKey();
      if (key === this._look) return;
      this._look = key;
      this.sprite.setSheet(G.SpriteFactory.humanoid(this.appearance, { job: this.job, weapon: this.derived.weaponType }));
    }

    heal(amount) {
      const before = this.hp;
      this.hp = Math.min(this.maxHp, this.hp + amount);
      this.game.overlay.addText(this.position, `+${this.hp - before}`, 'heal');
      this.game.effects.sparkle(this.position, [0.55, 1, 0.6], 14);
    }

    // Walk toward something until within range (for skills and NPCs).
    approach(target, range, onArrive) {
      this.attacking = false;
      this.pendingLoot = null;
      this.approachTarget = { target, range, onArrive, repath: 0 };
    }
    talkTo(npc) {
      if (!this.alive) return;
      this.standUp();
      this.skills.cancelCast();
      this.skills.queued = null;
      this.approach(npc, 2.2, () => this.game.dialog.open(npc));
    }
    standUp() {
      if (this.playingDead) { this.playingDead = false; this.game.log.add('You get back up.', 'info'); }
      this.unhide();
    }
    unhide() {
      if (!this.hidden) return;
      this.hidden = false;
      this.sprite.setOpacity(1);
      this.game.log.add('You reappear.', 'info');
    }
    // Weapon type straight from equipment (safe to call while stats are computed).
    equippedWeaponType() {
      const w = this.equipment.weapon && G.Items.get(this.equipment.weapon.id);
      return w ? w.weaponType : 'none';
    }

    /* Promote to a first job. */
    changeJob(id) {
      const job = G.Jobs.get(id), game = this.game;
      this.job = id;
      this.jobLevel = 1;
      this.jobExp = 0;
      this.recalc();
      this.hp = this.maxHp; this.sp = this.maxSp;
      if (job.gift) {
        const r = this.inventory.add(job.gift, 1, { ignoreWeight: true });
        if (r.added) game.log.add(`The Job Master gives you a ${G.Items.get(job.gift).name}.`, 'loot');
      }
      game.effects.levelUp(this);
      game.overlay.levelUp(this, `${job.name}!`);
      game.hud.toast(`You are now a ${job.name}! New skills await in the Skills window (Alt+S).`);
      game.log.add(`Congratulations! You became a ${job.name}.`, 'level');
      game.events.emit('jobChanged', this);
      game.events.emit('skillsChanged');
      game.save.save(true);
    }

    /* ---------- stats ---------- */
    raiseStat(key) {
      const v = this.stats[key];
      if (v >= G.Stats.MAX_STAT) return false;
      const cost = G.Stats.cost(v);
      if (this.statPoints < cost) return false;
      this.statPoints -= cost;
      this.stats[key]++;
      this.recalc();
      this.game.save.markDirty();
      return true;
    }
    resetStats() {
      for (const k of G.Stats.KEYS) this.stats[k] = 1;
      this.statPoints = G.Stats.totalPoints(this.baseLevel);
      this.recalc();
      this.game.events.emit('levelChanged');
      this.game.log.add('Your stats have been reset. All points are back to spend.', 'system');
      this.game.save.markDirty();
    }

    /* ---------- items ---------- */
    applyItem(item) {
      const u = item.use, game = this.game;
      if (u.heal) {
        if (this.hp >= this.maxHp) { game.log.add('Your HP is already full.', 'info'); return false; }
        const amount = Math.floor(u.heal * (1 + this.derived.total.vit * 0.02));
        this.hp = Math.min(this.maxHp, this.hp + amount);
        game.overlay.addText(this.position, `+${amount}`, 'heal');
        game.effects.sparkle(this.position, [0.55, 1, 0.6], 14);
      }
      if (u.sp) {
        if (this.sp >= this.maxSp && !u.heal) { game.log.add('Your SP is already full.', 'info'); return false; }
        const amount = Math.floor(u.sp * (1 + this.derived.total.int * 0.02));
        this.sp = Math.min(this.maxSp, this.sp + amount);
        game.overlay.addText(this.position, `+${amount} SP`, 'spheal');
        game.effects.sparkle(this.position, [0.5, 0.7, 1], 14);
      }
      if (u.recall) {
        const sp = this.savePoint;
        if (sp.map !== game.mapId) { this.clearTarget(); game.travel(sp.map, sp.x, sp.z); }
        else this.teleport(sp.x, sp.z);
        game.log.add('The wing carries you home to Willowmere.', 'system');
      }
      if (u.teleport) {
        // Anywhere open on this map, but never inside town.
        for (let i = 0; i < 120; i++) {
          const x = U.randRange(Math.random, -95, 95), z = U.randRange(Math.random, -105, 100);
          if (G.Terrain.boundaryRaw(x, z) > -4 || G.Terrain.townFactor(x, z) > 0 || (game.map.stream && z < -10)) continue;
          if (game.nav.walkable(x, z) && !G.Terrain.isWater(x, z)) { this.teleport(x, z); break; }
        }
      }
      game.save.markDirty();
      return true;
    }

    teleport(x, z) {
      this.game.effects.sparkle(this.position, [0.8, 0.9, 1], 20);
      this.clearTarget();
      this.path = null;
      this.pendingLoot = null;
      this.setPosition(x, z);
      this.game.camera.snapTo(this.position);
      this.game.effects.sparkle(this.position, [0.8, 0.9, 1], 24);
    }

    pickUp(loot) {
      if (!this.alive) return;
      if (Math.hypot(loot.x - this.position.x, loot.z - this.position.z) < 1.3) { this.game.loot.pickUp(loot); return; }
      this.moveTo({ x: loot.x, z: loot.z }, true);
      this.pendingLoot = loot;
    }

    /* ---------- commands ---------- */
    moveTo(point, silent) {
      if (!this.alive) return false;
      this.attacking = false;
      this.pendingLoot = null;
      this.approachTarget = null;
      this.standUp();
      if (this.skills.casting) this.skills.cancelCast('Casting interrupted.');
      this.skills.queued = null;
      if (this.swinging && this.impactDone) this.swinging = false; // allow cancelling the recovery
      const path = this.game.nav.findPath(this.position.x, this.position.z, point.x, point.z);
      if (!path) return false;
      this.setPath(path);
      if (!silent) {
        const end = path[path.length - 1];
        this.game.effects.clickMarker({ x: end.x, y: G.Terrain.surfaceHeight(end.x, end.z), z: end.z });
      }
      return true;
    }

    attack(monster) {
      if (!this.alive || !monster || !monster.alive) return;
      this.standUp();
      this.skills.queued = null;
      this.approachTarget = null;
      this.target = monster;
      this.attacking = true;
      this.pendingLoot = null;
      this.repathT = 0;
      this.lastGoal = null;
      this.game.effects.showTarget(monster);
    }

    clearTarget() {
      this.target = null;
      this.attacking = false;
      this.game.effects.showTarget(null);
    }

    /* ---------- combat ---------- */
    startSwing() {
      this.swinging = true;
      this.swingT = 0;
      this.impactDone = false;
      const delay = this.derived.attackDelay;
      this.attackCd = delay;
      const dur = this.sprite.duration('attack');
      this.swingDur = Math.min(dur, delay * 0.92);
      this.sprite.play('attack', { restart: true, speed: dur / this.swingDur });
    }

    takeDamage(dmg, source) {
      if (!this.alive) return;
      this.hp = Math.max(0, this.hp - dmg);
      this.lastDamageTime = this.game.time;
      this.sprite.setFlash(1);
      if (!this.swinging && !this.skills.buffs.endure && !this.playingDead) this.hurtT = 0.22;
      if (this.hp <= 0) this.die();
      // Being hit while idle makes the Novice fight back, like auto-counter.
      else if (!this.target && !this.path && !this.playingDead && !this.skills.casting && source && source.alive) this.attack(source);
    }

    die() {
      this.alive = false;
      this.playingDead = false;
      if (this.hidden) { this.hidden = false; this.sprite.setOpacity(1); }
      this.skills.cancelCast();
      this.skills.queued = null;
      this.approachTarget = null;
      this.swinging = false;
      this.path = null;
      this.deadT = 0;
      this.clearTarget();
      this.sprite.play('dead', { restart: true });
      this.game.hud.showDeath(true);
    }

    respawn() {
      const R = this.savePoint;
      if (R.map && R.map !== this.game.mapId) this.game.loadMap(R.map);
      this.setPosition(R.x, R.z);
      this.alive = true;
      this.hp = this.maxHp;
      this.sp = Math.max(this.sp, Math.floor(this.maxSp / 2));
      this.sprite.play('idle', { restart: true });
      this.game.hud.showDeath(false);
      this.game.effects.sparkle(this.position, [0.7, 0.95, 1], 24);
      this.game.camera.snapTo(this.position);
    }

    gainExp(base, job) {
      const game = this.game;
      if (this.baseLevel < C.MAX_LEVEL) {
        this.baseExp += base;
        while (this.baseExp >= this.expToNext && this.baseLevel < C.MAX_LEVEL) {
          this.baseExp -= this.expToNext;
          this.baseLevel++;
          const pts = G.Stats.pointsForLevel(this.baseLevel);
          this.statPoints += pts;
          this.recalc();
          this.hp = this.maxHp; this.sp = this.maxSp;
          game.effects.levelUp(this);
          game.overlay.levelUp(this, 'Level up!');
          game.hud.toast(`Base level ${this.baseLevel}! You gained ${pts} stat points.`);
          game.log.add(`Base level ${this.baseLevel}. +${pts} stat points (open Status with Alt+A).`, 'level');
          game.events.emit('levelChanged');
        }
      }
      if (job) {
        this.jobExp += job;
        while (this.jobExp >= this.jobExpToNext) {
          this.jobExp -= this.jobExpToNext;
          this.jobLevel++;
          this.skillPoints++;
          game.effects.levelUp(this);
          game.overlay.levelUp(this, 'Job level up!');
          game.log.add(`Job level ${this.jobLevel}. +1 skill point.`, 'level');
          game.events.emit('levelChanged');
          if (this.jobLevel >= this.jobDef.maxJobLevel) {
            this.jobExp = 0;
            game.log.add(`You’ve mastered the ${this.jobDef.name} job. A job change will open in a later update.`, 'level');
          }
        }
      }
      game.overlay.addText(this.position, `+${base} / ${job || 0} exp`, 'exp');
      game.save.markDirty();
    }

    /* ---------- update ---------- */
    update(dt) {
      const game = this.game;
      if (!this.alive) {
        this.deadT += dt;
        if (this.deadT > 4) this.respawn();
        return;
      }
      this.attackCd -= dt;
      if (this.hurtT > 0) this.hurtT -= dt;
      this.skills.update(dt);
      this.inventory.update(dt);

      // Lying still (Play Dead), hidden, or channelling a spell: no moving or attacking.
      if (this.hidden) this.sprite.setOpacity(0.35);
      if (this.playingDead || this.hidden || this.skills.casting) {
        this.moving = false;
        if (this.playingDead) this.sprite.play('dead');
        else if (this.hidden) this.sprite.play('sit');
        else this.sprite.play('cast');
        this.regen(dt);
        return;
      }

      // Walking up to an NPC or into skill range.
      const A = this.approachTarget;
      if (A) {
        const tgt = A.target;
        const reach = A.range + (tgt.def ? tgt.def.radius : 0);
        if ((tgt.alive === false) || !this.skills && !A.onArrive) this.approachTarget = null;
        else if (this.distanceTo(tgt) <= reach) {
          this.path = null;
          this.approachTarget = null;
          this.faceTowards(tgt.position.x, tgt.position.z);
          if (A.onArrive) A.onArrive();
        } else {
          A.repath -= dt;
          if (!this.path || A.repath <= 0) {
            A.repath = 0.4;
            this.setPath(game.nav.findPath(this.position.x, this.position.z, tgt.position.x, tgt.position.z, 12000));
            if (!this.path) this.approachTarget = null;
          }
        }
      }

      // Swing timing: damage lands at the impact frame, not on click.
      if (this.swinging) {
        this.swingT += dt;
        if (!this.impactDone && this.swingT >= this.swingDur * 0.44) {
          this.impactDone = true;
          const t = this.target;
          if (t && t.alive && this.distanceTo(t) <= this.attackRange + t.def.radius + 0.6) {
            if (this.derived.weaponType === 'bow') game.spells.arrow(this, t, () => { if (t.alive) G.Combat.playerAttack(this, t); });
            else G.Combat.playerAttack(this, t);
          }
        }
        if (this.swingT >= this.swingDur) this.swinging = false;
      }

      const t = this.target;
      if (t && !t.alive) {
        this.attacking = false;
        if (t.corpseGone) this.clearTarget();
      }
      if (this.attacking && t && t.alive) {
        const reach = this.attackRange + t.def.radius;
        const d = this.distanceTo(t);
        if (d <= reach) {
          this.path = null;
          this.faceTowards(t.position.x, t.position.z);
          if (!this.swinging && this.attackCd <= 0) this.startSwing();
        } else if (!this.swinging) {
          this.repathT -= dt;
          const moved = !this.lastGoal || Math.hypot(this.lastGoal.x - t.position.x, this.lastGoal.z - t.position.z) > 0.8;
          if (!this.path || this.repathT <= 0 || moved) {
            const path = game.nav.findPath(this.position.x, this.position.z, t.position.x, t.position.z, 12000);
            this.setPath(path);
            this.repathT = 0.4;
            this.lastGoal = { x: t.position.x, z: t.position.z };
            if (!path) this.attacking = false;
          }
        }
      }

      const stopDist = this.attacking && t ? this.attackRange + t.def.radius - 0.15
        : this.approachTarget ? Math.max(0, this.approachTarget.range - 0.2) : 0;
      this.moving = !this.swinging && this.followPath(dt, this.moveSpeed, stopDist);

      if (this.swinging) this.sprite.play('attack');
      else if (this.moving) this.sprite.play('walk');
      else if (this.hurtT > 0) this.sprite.play('hit');
      else this.sprite.play('idle');

      // Walked up to a clicked item: pick it up.
      const L = this.pendingLoot;
      if (L) {
        if (!game.loot.items.includes(L)) this.pendingLoot = null;
        else if (Math.hypot(L.x - this.position.x, L.z - this.position.z) < 1.3) { this.pendingLoot = null; game.loot.pickUp(L); this.path = null; }
      }

      this.regen(dt);
    }

    // Natural regeneration out of combat (stops when carrying over 90%).
    regen(dt) {
      const game = this.game;
      const resting = game.time - this.lastDamageTime > P.regenDelay && !this.swinging;
      if (resting && this.inventory.weightPct() < 0.9) {
        const k = this.moving ? 0.5 : 1;
        if (this.hp < this.maxHp) {
          this.regenAcc += this.derived.hpRegen * k * dt;
          if (this.regenAcc >= 1) { const n = Math.floor(this.regenAcc); this.regenAcc -= n; this.hp = Math.min(this.maxHp, this.hp + n); }
        }
        if (this.sp < this.maxSp) {
          this.spRegenAcc += this.derived.spRegen * k * dt;
          if (this.spRegenAcc >= 1) { const n = Math.floor(this.spRegenAcc); this.spRegenAcc -= n; this.sp = Math.min(this.maxSp, this.sp + n); }
        }
      }
    }
  }

  G.Player = Player;
})(window.G = window.G || {});
