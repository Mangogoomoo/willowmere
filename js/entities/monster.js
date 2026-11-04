/* Monster: a sprite creature with a small state machine.
   idle -> wander -> idle ...; when hurt: chase -> attack; too far from home:
   return. Dies with an animation, fades, then respawns in its spawn area. */
(function (G) {
  'use strict';
  const C = G.Config, U = G.Utils, TR = G.Terrain;

  class Monster extends G.Entity {
    constructor(game, type, spawn, id) {
      const def = C.MONSTERS[type];
      super(game, G.SpriteFactory.get(type), { shadowSize: def.hitRadius * 1.8, radius: def.radius, scale: def.scale || 1 });
      this.id = id;
      this.type = type;
      this.def = def;
      this.name = def.name;
      this.level = def.level;
      this.spawnArea = spawn;
      this.home = { x: spawn.x, z: spawn.z };
      this.state = 'idle';
      this.idleT = Math.random() * 3;
      this.hitT = 0;
      this.attackCd = 0;
      this.swinging = false;
      this.repathT = 0;
      this.lastHurtTime = -99;
      this.respawnT = 0;
      this.corpseT = 0;
      this.corpseGone = false;
      this.fadeIn = 0;
      this.spawn(true);
    }

    pickSpawnPoint() {
      const s = this.spawnArea, nav = this.game.nav, player = this.game.player;
      for (let i = 0; i < 40; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * s.r;
        const x = s.x + Math.cos(a) * r, z = s.z + Math.sin(a) * r;
        if (!nav.walkable(x, z) || TR.isWater(x, z)) continue;
        if (player && Math.hypot(player.position.x - x, player.position.z - z) < 7 && i < 30) continue;
        return { x, z };
      }
      return { x: s.x, z: s.z };
    }

    spawn(initial) {
      const p = this.pickSpawnPoint();
      this.setPosition(p.x, p.z);
      this.home = { x: p.x, z: p.z };
      this.hp = this.def.hp;
      this.alive = true;
      this.corpseGone = false;
      this.stolen = false;
      this.provoke = null;
      this.aggro = null;
      this.status = {};
      this.sprite.tint = null;
      this.state = 'idle';
      this.idleT = 0.5 + Math.random() * 3;
      this.path = null;
      this.swinging = false;
      this.targetFacing = this.facing = Math.random() * Math.PI * 2;
      this.sprite.play('idle', { restart: true });
      this.fadeIn = initial ? 1 : 0;
      this.sprite.setOpacity(this.fadeIn);
      this.shadow.visible = true;
      if (!initial) this.game.effects.sparkle(this.position, [1, 0.95, 0.8], 10);
    }

    takeDamage(dmg, attacker) {
      if (!this.alive) return;
      // Training dummies can't be killed; they just wobble and heal up again.
      if (this.def.immortal) {
        this.hp = Math.max(1, this.hp - dmg);
        this.lastHurtTime = this.game.time;
        this.sprite.setFlash(1);
        this.sprite.play('hit', { restart: true });
        return;
      }
      // Lex Aeterna doubles the next damage; any hit wakes a sleeper.
      if (this.status.lex) { dmg *= 2; delete this.status.lex; const at = this.position.clone(); at.y += this.def.height + 0.6; this.game.overlay.addText(at, 'Lex Aeterna!', 'debuff'); }
      if (this.status.asleep) delete this.status.asleep;
      this.hp = Math.max(0, this.hp - dmg);
      this.lastHurtTime = this.game.time;
      this.sprite.setFlash(1);
      if (this.hp <= 0) { this.die(attacker); return; }
      // Flinch: a short hit-stun (no knockback; only some skills push monsters).
      this.hitT = 0.26;
      this.swinging = false;
      this.sprite.play('hit', { restart: true });
      if (this.def.noAttack) return;     // e.g. Pupa: it just wobbles
      this.faceTowards(attacker.position.x, attacker.position.z);
      this.aggro = attacker;
      if (this.state !== 'attack') { this.state = 'chase'; this.repathT = 0; }
    }

    /* Status effects: frozen (can't act), poisoned (damage over time),
       slowed (moves and attacks slower). */
    addStatus(name, seconds, data) {
      this.status[name] = Object.assign({ until: this.game.time + seconds, tick: 0 }, data || {});
      this.updateTint();
      if (name === 'frozen') { this.path = null; this.swinging = false; }
    }
    updateTint() {
      const st = this.status;
      this.sprite.tint = st.stone ? [0.7, 0.7, 0.7] : st.asleep ? [0.8, 0.85, 1.15] : st.frozen ? [0.6, 0.85, 1.25] : st.stunned ? [1.1, 1.05, 0.6] : st.poisoned ? [0.75, 1.0, 0.7]
        : st.rooted ? [0.8, 1.05, 0.7] : st.slowed ? [0.85, 0.8, 1.05] : st.disarmed ? [1.0, 0.85, 0.85] : null;
    }
    tickStatus(dt) {
      let changed = false;
      for (const k in this.status) {
        const s = this.status[k];
        if (this.game.time >= s.until) { delete this.status[k]; changed = true; continue; }
        if (k === 'poisoned') {
          s.tick += dt;
          if (s.tick >= 1) {
            s.tick -= 1;
            const at = this.position.clone(); at.y += this.def.height * 0.6;
            this.game.overlay.addText(at, String(s.dps), 'poison');
            this.hp = Math.max(0, this.hp - s.dps);
            this.lastHurtTime = this.game.time;
            if (this.hp <= 0) { this.die(this.game.player); return; }
          }
        }
      }
      if (changed) this.updateTint();
    }

    aggroOn(player) {
      if (!this.alive || this.def.noAttack) return;
      this.aggro = player;
      if (this.state !== 'attack') { this.state = 'chase'; this.repathT = 0; }
    }

    loseInterest() {
      this.aggro = null;
      this.swinging = false;
      this.state = 'return';
      this.setPath(this.game.nav.findPath(this.position.x, this.position.z, this.home.x, this.home.z, 8000));
    }

    // Shoved away from a point (Magnum Break), stopping at obstacles.
    maxHpVal() { return this.maxHp || this.def.hp; }
    knockback(fx, fz, dist) {
      if (this.def.immovable) return;
      const dx = this.position.x - fx, dz = this.position.z - fz, d = Math.hypot(dx, dz) || 1;
      const ux = dx / d, uz = dz / d, nav = this.game.nav;
      let x = this.position.x, z = this.position.z;
      for (let s = 0; s < dist; s += 0.2) {
        if (!nav.walkable(x + ux * 0.2, z + uz * 0.2)) break;
        x += ux * 0.2; z += uz * 0.2;
      }
      this.setPosition(x, z);
      this.path = null;
    }

    die(killer) {
      this.alive = false;
      this.state = 'dead';
      this.path = null;
      this.swinging = false;
      this.aggro = null;
      this.corpseT = 0;
      this.respawnT = this.def.respawn;
      this.sprite.play('die', { restart: true });
      const p = this.position;
      this.game.effects.death({ x: p.x, y: p.y, z: p.z }, this.def.deathColor);
      this.game.sfx('pop', p);
      if (killer && killer.gainExp) {
        const be = Math.round(this.def.exp * C.EXP_RATE), je = Math.round(this.def.jobExp * C.EXP_RATE);
        if (G.Social && killer === this.game.player) G.Social.awardKill(killer, be, je); else killer.gainExp(be, je);
      }
      this.game.loot.rollDrops(this);
      this.game.events.emit('monsterKilled', this);
      if (this.def.mvp) { this.game.hud.toast(`MVP! ${killer && killer.name ? killer.name : 'Someone'} defeated ${this.name}!`); this.game.log.add(`MVP: ${this.name} has fallen.`, 'level'); }
    }

    startSwing() {
      this.swinging = true;
      this.swingT = 0;
      this.impactDone = false;
      this.attackCd = this.def.attackInterval * (this.status.slowed ? 1.4 : 1);
      this.sprite.play('attack', { restart: true });
      this.swingDur = this.sprite.duration('attack');
    }

    update(dt) {
      if (this.def.immortal && this.alive && this.hp < this.maxHpVal() && this.game.time - (this.lastHurtTime || 0) > 4) this.hp = this.maxHpVal();
      const player = (this.aggro && this.aggro.isRemote && this.aggro.alive) ? this.aggro : this.game.player, def = this.def;

      if (!this.alive) {
        this.corpseT += dt;
        const dieDur = this.sprite.duration('die');
        if (this.corpseT > dieDur + 0.4) {
          const k = U.clamp(1 - (this.corpseT - dieDur - 0.4) / 0.6, 0, 1);
          this.sprite.setOpacity(k);
          this.shadow.visible = k > 0.05;
          if (k <= 0) this.corpseGone = true;
        }
        if (this.corpseGone) {
          this.respawnT -= dt;
          if (this.respawnT <= 0) this.spawn(false);
        }
        return;
      }
      if (this.fadeIn < 1) { this.fadeIn = Math.min(1, this.fadeIn + dt * 2); this.sprite.setOpacity(this.fadeIn); }

      this.tickStatus(dt);
      if (!this.alive) return;
      if (this.status.frozen || this.status.stunned || this.status.stone || this.status.asleep) { this.moving = false; this.sprite.speed = 0; return; }
      this.sprite.speed = this.status.slowed ? 0.6 : 1;

      this.attackCd -= dt;
      if (this.hitT > 0) {
        this.hitT -= dt;
        this.moving = false;
        return;
      }

      if (this.swinging) {
        this.swingT += dt;
        if (!this.impactDone && this.swingT >= def.impactTime) {
          this.impactDone = true;
          if (player.alive && this.distanceTo(player) <= def.attackRange + player.radius + 0.5) G.Combat.monsterAttack(this, player);
        }
        if (this.swingT >= this.swingDur) this.swinging = false;
      }

      const nav = this.game.nav;

      // Aggressive monsters attack anyone who wanders close (unless hidden or playing dead).
      if (def.aggressive && (this.state === 'idle' || this.state === 'wander') && player && player.alive && !player.hidden && !player.playingDead && !player.cloaked
          && !(player.derived.extra && player.derived.extra.gangster && !player.moving && !player.attacking)
          && this.distanceTo(player) < (def.aggroRange || 7)) {
        this.aggroOn(player);
        const at = this.position.clone(); at.y += def.height + 0.3;
        this.game.overlay.addText(at, '!', 'debuff');
      }

      // Boss: a telegraphed ground slam you can step out of.
      if (def.boss && (this.state === 'chase' || this.state === 'attack')) {
        const B = def.boss;
        if (this.slamTele > 0) {
          this.slamTele -= dt;
          this.moving = false;
          this.sprite.play('attack', { speed: 0.35 });
          if (this.slamTele <= 0) {
            this.game.spells.ring(this.position, '#ff7a3d', B.slamRadius);
            this.game.sfx('slam', this.position);
            this.game.effects.death({ x: this.position.x, y: this.position.y, z: this.position.z }, [1, 0.6, 0.75]);
            if (player.alive && this.distanceTo(player) <= B.slamRadius + player.radius) {
              const raw = U.randInt(Math.random, B.slamDamage[0], B.slamDamage[1]);
              const dmg = Math.max(1, Math.round(raw * (1 - Math.min(player.derived.def, 90) / 100) - player.derived.softDef));
              const at = player.position.clone(); at.y += 1.3;
              this.game.overlay.addText(at, String(dmg), 'hurt');
              player.takeDamage(dmg, this);
            } else this.game.log.add('You dodged the King Poring’s slam!', 'info');
            this.slamT = B.slamEvery;
          }
          return;
        }
        this.slamT = (this.slamT == null ? B.slamEvery : this.slamT) - dt;
        if (this.slamT <= 0 && this.distanceTo(player) < B.slamRadius + 3) {
          this.slamTele = 1.2;
          this.path = null;
          this.swinging = false;
          this.game.spells.warning(this.position, B.slamRadius, 1.2);
          this.game.sfx('warn', this.position);
          const at = this.position.clone(); at.y += def.height + 0.6;
          this.game.overlay.addText(at, 'Jelly Slam!', 'debuff');
        }
      }

      let speed = def.speed;
      const slow = this.status.slowed ? 0.55 : 1;
      switch (this.state) {
        case 'idle':
          this.idleT -= dt;
          if (this.idleT <= 0 && def.speed <= 0) { this.idleT = 3; break; }
          if (this.idleT <= 0) {
            for (let i = 0; i < 6; i++) {
              const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 5;
              let x = this.position.x + Math.cos(a) * r, z = this.position.z + Math.sin(a) * r;
              const s = this.spawnArea;
              if (Math.hypot(x - s.x, z - s.z) > s.r) { x = U.lerp(x, s.x, 0.5); z = U.lerp(z, s.z, 0.5); }
              if (nav.walkable(x, z) && nav.lineClear(this.position.x, this.position.z, x, z)) {
                this.setPath([{ x, z }]);
                this.state = 'wander';
                break;
              }
            }
            this.idleT = 1 + Math.random() * 2;
          }
          break;
        case 'wander':
          if (!this.path) { this.state = 'idle'; this.idleT = 1.5 + Math.random() * 3.5; }
          break;
        case 'chase':
        case 'attack': {
          speed = def.chaseSpeed * slow;
          const homeDist = Math.hypot(this.position.x - this.spawnArea.x, this.position.z - this.spawnArea.z);
          if (!player.alive || player.playingDead || player.hidden || player.cloaked || this.aggro !== player || homeDist > def.leash + this.spawnArea.r) {
            this.state = 'return';
            this.aggro = null;
            this.setPath(nav.findPath(this.position.x, this.position.z, this.home.x, this.home.z, 8000));
            break;
          }
          const reach = def.attackRange + player.radius;
          const d = this.distanceTo(player);
          // Each attacker has its own spot around the player (set by the
          // MonsterManager), so a crowd surrounds you instead of stacking.
          const slot = this.slot;
          const sd = slot ? Math.hypot(slot.x - this.position.x, slot.z - this.position.z) : 0;
          if (d <= reach + 0.05 && (!slot || sd < 0.5 || this.swinging || this.attackCd <= 0.12)) {
            this.state = 'attack';
            this.path = null;
            this.faceTowards(player.position.x, player.position.z);
            if (!this.swinging && this.attackCd <= 0) this.startSwing();
          } else if (!this.swinging) {
            // Walk to our spot (repositioning between swings if already in reach).
            this.state = d <= reach ? 'attack' : 'chase';
            const goal = slot || player.position;
            this.goalStop = slot ? 0.05 : reach - 0.2;
            this.repathT -= dt;
            const moved = !this.lastGoal || Math.hypot(this.lastGoal.x - goal.x, this.lastGoal.z - goal.z) > 0.3;
            if (this.repathT <= 0 || !this.path || moved) {
              this.repathT = 0.45;
              this.lastGoal = { x: goal.x, z: goal.z };
              if (nav.lineClear(this.position.x, this.position.z, goal.x, goal.z)) this.setPath([{ x: goal.x, z: goal.z }]);
              else this.setPath(nav.findPath(this.position.x, this.position.z, goal.x, goal.z, 6000));
            }
            if (d <= reach) this.faceTowards(player.position.x, player.position.z);
          }
          break;
        }
        case 'return':
          speed = def.chaseSpeed * slow;
          if (!this.path) { this.state = 'idle'; this.idleT = 1 + Math.random() * 2; }
          break;
      }

      const stop = (this.state === 'chase' || this.state === 'attack') ? (this.goalStop || 0) : 0;
      if (this.state === 'wander' || this.state === 'idle') speed *= slow;
      this.moving = !this.swinging && def.speed > 0 && !this.status.rooted && this.followPath(dt, speed, stop);

      if (this.swinging) this.sprite.play('attack');
      else if (this.moving) this.sprite.play('walk', { speed: speed / def.speed });
      else this.sprite.play('idle');
    }
  }

  G.Monster = Monster;
})(window.G = window.G || {});
