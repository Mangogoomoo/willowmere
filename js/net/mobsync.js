/* Shared monsters (online). One player per map is the "host": their game runs
   the monsters with the normal AI and sends snapshots through the server.
   Everyone else shows "puppet" monsters that follow those snapshots, and
   sends their hits, statuses and knockbacks to the host. When the host
   leaves, the next player takes over from the last snapshot.
   Rewards stay personal: whoever lands the killing blow gets the EXP, the
   drops and the quest progress on their own game. */
(function (G) {
  'use strict';
  const M = G.Monster.prototype, MM = G.MonsterManager.prototype;
  const Sync = {
    isHost: false,
    online() { return !!(G.Net && G.Net.ws && G.Net.ws.readyState === 1); },
    puppet() { return this.online() && !this.isHost; },
    sentT: 0, fullT: 0, last: new Map(),
  };
  G.MobSync = Sync;
  const net = () => G.Net;

  /* ---------------- snapshots (host) ---------------- */
  function stateOf(m) {
    const st = {};
    for (const k in m.status) st[k] = Math.max(0, +(m.status[k].until - m.game.time).toFixed(1));
    return { i: m.id, x: +m.position.x.toFixed(2), z: +m.position.z.toFixed(2), f: +m.facing.toFixed(2), hp: Math.round(m.hp), a: m.alive ? 1 : 0,
      mv: m.moving ? 1 : 0, sw: m.swingSeq || 0, st, tg: m.aggro ? (m.aggro.isRemote ? m.aggro.id : (net().charId || 0)) : 0 };
  }
  function sendSnapshots(mgr, dt) {
    Sync.sentT -= dt; Sync.fullT -= dt;
    if (Sync.sentT > 0) return;
    Sync.sentT = 0.15;
    const full = Sync.fullT <= 0;
    if (full) Sync.fullT = 3;
    const list = [];
    for (const m of mgr.list) {
      const s = stateOf(m), key = JSON.stringify(s);
      if (full || Sync.last.get(m.id) !== key) { Sync.last.set(m.id, key); list.push(s); }
    }
    if (list.length) net().send({ t: 'mobs', list });
  }

  /* ---------------- puppets (everyone else) ---------------- */
  function applySnapshot(list) {
    const game = net().game;
    if (!game || !game.monsters) return;
    const byId = new Map(game.monsters.list.map((m) => [m.id, m]));
    for (const s of list) {
      const m = byId.get(s.i);
      if (!m) continue;
      m.net = s;
      m.hp = s.hp;
      // Statuses as the host sees them.
      m.status = {};
      for (const k in s.st || {}) m.status[k] = { until: game.time + s.st[k], tick: 0 };
      m.updateTint();
      if (s.sw && s.sw !== m.swingSeqSeen) { m.swingSeqSeen = s.sw; if (m.alive) { m.sprite.play('attack', { restart: true }); m.swingT2 = 0.5; } }
      if (m.alive && !s.a) puppetDie(m);
      else if (!m.alive && s.a) { m.spawnAt(s.x, s.z); }
      else if (Math.hypot(m.position.x - s.x, m.position.z - s.z) > 15) m.setPosition(s.x, s.z);
    }
  }
  function puppetDie(m) {
    m.alive = false; m.state = 'dead'; m.path = null; m.corpseT = 0; m.respawnT = 1e9;
    m.sprite.play('die', { restart: true });
    m.game.effects.death({ x: m.position.x, y: m.position.y, z: m.position.z }, m.def.deathColor);
    m.game.sfx('pop', m.position);
    if (m.game.player.target === m) m.game.player.clearTarget();
  }
  M.spawnAt = function (x, z) {
    this.spawn(false);
    this.setPosition(x, z);
    this.home = { x, z };
  };
  M.puppetUpdate = function (dt) {
    const s = this.net;
    if (!this.alive) {
      this.corpseT += dt;
      const dieDur = this.sprite.duration('die');
      if (this.corpseT > dieDur + 0.4) { const k = Math.max(0, 1 - (this.corpseT - dieDur - 0.4) / 0.6); this.sprite.setOpacity(k); this.shadow.visible = k > 0.05; }
      return;
    }
    if (this.fadeIn < 1) { this.fadeIn = Math.min(1, this.fadeIn + dt * 2); this.sprite.setOpacity(this.fadeIn); }
    if (!s) return;
    const dx = s.x - this.position.x, dz = s.z - this.position.z, d = Math.hypot(dx, dz);
    if (d > 0.02) { const k = Math.min(1, dt * 8); this.setPosition(this.position.x + dx * k, this.position.z + dz * k); if (d > 0.1) this.targetFacing = Math.atan2(dx, dz); }
    else this.targetFacing = s.f;
    this.moving = !!s.mv || d > 0.15;
    if (this.swingT2 > 0) this.swingT2 -= dt;
    else if (!this.status.frozen && !this.status.stunned && !this.status.stone && !this.status.asleep) this.sprite.play(this.moving ? 'walk' : 'idle');
    this.sprite.speed = (this.status.frozen || this.status.stone || this.status.stunned || this.status.asleep) ? 0 : 1;
  };

  /* ---------------- monster methods, online-aware ---------------- */
  const origUpdateMgr = MM.update;
  MM.update = function (dt, camPos) {
    if (Sync.puppet()) {
      for (const m of this.list) m.puppetUpdate(dt);
      for (const m of this.list) m.syncVisuals(dt, camPos);
      return;
    }
    origUpdateMgr.call(this, dt, camPos);
    if (!Sync.online()) return;
    // Aggressive monsters notice other players too.
    for (const m of this.list) {
      if (!m.alive || !m.def.aggressive || (m.state !== 'idle' && m.state !== 'wander')) continue;
      for (const r of net().players.values()) if (m.distanceTo(r) < (m.def.aggroRange || 7)) { m.aggroOn(r); break; }
    }
    sendSnapshots(this, dt);
  };

  const origStartSwing = M.startSwing;
  M.startSwing = function () { this.swingSeq = (this.swingSeq || 0) + 1; return origStartSwing.call(this); };

  const origTake = M.takeDamage;
  M.takeDamage = function (dmg, attacker) {
    if (!Sync.puppet() || !this.alive) return origTake.call(this, dmg, attacker);
    // Puppet: show the hit right away, let the host decide what it does.
    this.hp = Math.max(1, this.hp - dmg);
    this.lastHurtTime = this.game.time;
    this.sprite.setFlash(1);
    if (!this.swingT2) this.sprite.play('hit', { restart: true });
    net().send({ t: 'mob', op: 'dmg', id: this.id, dmg: Math.round(dmg) });
  };
  const origStatus = M.addStatus;
  M.addStatus = function (name, seconds, data) {
    origStatus.call(this, name, seconds, data);
    if (Sync.puppet()) net().send({ t: 'mob', op: 'status', id: this.id, name, sec: seconds, data: data || null });
  };
  const origKnock = M.knockback;
  M.knockback = function (fx, fz, dist) {
    if (Sync.puppet()) { net().send({ t: 'mob', op: 'knock', id: this.id, fx, fz, dist }); return; }
    return origKnock.call(this, fx, fz, dist);
  };
  const origDie = M.die;
  M.die = function (killer) {
    if (killer && killer.isRemote) {
      // Host: another player's kill. The monster dies here; the rewards are theirs.
      const loot = this.game.loot, roll = loot.rollDrops, ev = this.game.events, emit = ev.emit;
      loot.rollDrops = () => {};
      ev.emit = function (n, ...a) { if (n !== 'monsterKilled') return emit.call(this, n, ...a); };
      try { origDie.call(this, null); } finally { loot.rollDrops = roll; ev.emit = emit; }
      net().send({ t: 'mob', op: 'killed', id: this.id, to: killer.id });
      return;
    }
    return origDie.call(this, killer);
  };

  // Monster attacks on another player: their own game works out the hit.
  const origAttack = G.Combat.monsterAttack;
  G.Combat.monsterAttack = function (mon, target) {
    if (target && target.isRemote) { net().send({ t: 'mob', op: 'attack', id: mon.id, to: target.id }); return; }
    return origAttack.call(this, mon, target);
  };

  /* ---------------- messages ---------------- */
  Sync.handle = function (m) {
    const game = net().game;
    const mon = (id) => game.monsters && game.monsters.list.find((x) => x.id === id);
    if (m.t === 'host') {
      const was = Sync.isHost;
      Sync.isHost = !!m.isHost;
      if (Sync.isHost && !was && game.monsters) {
        // Take over from the last snapshot: monsters keep their place and health.
        for (const x of game.monsters.list) { if (x.alive) { x.state = 'idle'; x.path = null; x.aggro = null; } else { x.corpseGone = true; x.respawnT = Math.min(x.respawnT, x.def.respawn); } }
        Sync.fullT = 0; Sync.last.clear();
      }
    } else if (m.t === 'mobs') {
      if (!Sync.isHost) applySnapshot(m.list);
    } else if (m.t === 'mob') {
      const x = mon(m.id);
      if (!x) return;
      const from = m.from != null ? net().players.get(m.from) : null;
      if (m.op === 'dmg' && Sync.isHost && x.alive) origTake.call(x, Number(m.dmg) || 0, from || null);
      else if (m.op === 'status' && Sync.isHost && x.alive) origStatus.call(x, String(m.name), Number(m.sec) || 1, m.data || undefined);
      else if (m.op === 'knock' && Sync.isHost && x.alive) origKnock.call(x, Number(m.fx), Number(m.fz), Number(m.dist) || 1);
      else if (m.op === 'attack') { if (game.player.alive) origAttack.call(G.Combat, x, game.player); }
      else if (m.op === 'hurt') { if (game.player.alive) game.player.takeDamage(Math.max(1, Number(m.dmg) || 1), x); }
      else if (m.op === 'killed') {
        // Our kill, confirmed by the host: EXP, drops and quest progress are ours.
        const p = game.player, C = G.Config;
        G.Social.awardKill(p, Math.round(x.def.exp * C.EXP_RATE), Math.round(x.def.jobExp * C.EXP_RATE));
        game.loot.rollDrops(x);
        game.events.emit('monsterKilled', x);
      }
    }
  };
  Sync.applySnapshot = applySnapshot;
  Sync.reset = function () { Sync.isHost = false; Sync.last.clear(); Sync.fullT = 0; };
})(window.G = window.G || {});
