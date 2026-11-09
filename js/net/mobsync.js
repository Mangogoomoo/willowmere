/* Shared monsters (online). The server runs every map's monsters (Stage 9:
   server/world.js) and sends snapshots; your game shows "puppet" monsters
   that follow them, and sends your hits, statuses and knockbacks to the
   server. When a monster attacks you, the server says so and your game works
   out the hit; when your blow kills one, the server tells you, and the EXP,
   drops and quest progress are yours. Offline, monsters run in your game. */
(function (G) {
  'use strict';
  const M = G.Monster.prototype, MM = G.MonsterManager.prototype;
  const Sync = {
    online() { return !!(G.Net && G.Net.ws && G.Net.ws.readyState === 1); },
    puppet() { return this.online(); },
  };
  G.MobSync = Sync;
  const net = () => G.Net;

  /* ---------------- puppets ---------------- */
  function applySnapshot(list, map) {
    const game = net().game;
    if (!game || !game.monsters) return;
    if (map && map !== game.mapId) return;   // left over from the map we just left
    const byId = new Map(game.monsters.list.map((m) => [m.id, m]));
    for (const s of list) {
      const m = byId.get(s.i);
      if (!m) continue;
      m.net = s;
      m.hp = s.hp;
      if (s.hx != null) m.home = { x: s.hx, z: s.hz };   // the server's idea of home is the real one
      // Statuses as the server sees them.
      m.status = {};
      for (const k in s.st || {}) m.status[k] = { until: game.time + s.st[k], tick: 0 };
      m.updateTint();
      if (s.sw && s.sw !== m.swingSeqSeen) { m.swingSeqSeen = s.sw; if (m.alive) { m.sprite.play('attack', { restart: true }); m.swingT2 = 0.5; } }
      if (m.alive && !s.a) puppetDie(m);
      else if (!m.alive && s.a) { m.spawnAt(s.x, s.z); if (s.hx != null) m.home = { x: s.hx, z: s.hz }; }
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
    if (!Sync.puppet()) { origUpdateMgr.call(this, dt, camPos); return; }
    for (const m of this.list) m.puppetUpdate(dt);
    for (const m of this.list) m.syncVisuals(dt, camPos);
  };

  const origTake = M.takeDamage;
  M.takeDamage = function (dmg, attacker) {
    if (!Sync.puppet() || !this.alive) return origTake.call(this, dmg, attacker);
    // Show the hit right away; the server's monster takes it for real.
    this.hp = Math.max(1, this.hp - dmg);
    this.lastHurtTime = this.game.time;
    this.sprite.setFlash(1);
    if (!this.swingT2) this.sprite.play('hit', { restart: true });
    // The number's style (normal, critical, skill, magic) goes along so others see the same.
    net().send({ t: 'mob', op: 'dmg', map: this.game.mapId, id: this.id, dmg: Math.round(dmg), k: this.hitKind || 'dmg' });
    this.hitKind = null;
  };
  G.Combat.shown = (mon, text) => { if (Sync.puppet() && mon.alive) net().send({ t: 'mob', op: 'miss', map: mon.game.mapId, id: mon.id, text }); };
  const origStatus = M.addStatus;
  M.addStatus = function (name, seconds, data) {
    origStatus.call(this, name, seconds, data);
    if (Sync.puppet()) net().send({ t: 'mob', op: 'status', map: this.game.mapId, id: this.id, name, sec: seconds, data: data || null });
  };
  const origKnock = M.knockback;
  M.knockback = function (fx, fz, dist) {
    if (Sync.puppet()) { net().send({ t: 'mob', op: 'knock', map: this.game.mapId, id: this.id, fx, fz, dist }); return; }
    return origKnock.call(this, fx, fz, dist);
  };
  const origAttack = G.Combat.monsterAttack;

  /* ---------------- messages ---------------- */
  Sync.handle = function (m) {
    const game = net().game;
    const mon = (id) => game.monsters && game.monsters.list.find((x) => x.id === id);
    if (m.t === 'mobs') applySnapshot(m.list, m.map);
    else if (m.t === 'mob') {
      if (m.map && m.map !== game.mapId) return;   // meant for another map
      const x = mon(m.id);
      if (!x) return;
      if (m.op === 'attack') { if (game.player.alive) origAttack.call(G.Combat, x, game.player); }
      else if (m.op === 'hit') {
        // Another player's hit or miss on this monster.
        const at = x.position.clone(); at.y += x.def.height * 0.55;
        if (m.miss) game.overlay.addText(at, String(m.miss).slice(0, 12), 'miss');
        else { game.overlay.addText(at, String(Math.round(Number(m.dmg) || 0)), ['crit', 'skilldmg', 'magic'].includes(m.k) ? m.k : 'dmg'); if (x.alive) x.sprite.setFlash(1); }
      }
      else if (m.op === 'hurt') { if (game.player.alive) game.player.takeDamage(Math.max(1, Number(m.dmg) || 1), x); }
      else if (m.op === 'killed') {
        // Our kill, confirmed by the server: EXP, drops and quest progress are ours.
        const p = game.player, C = G.Config;
        G.Social.awardKill(p, Math.round(x.def.exp * C.EXP_RATE), Math.round(x.def.jobExp * C.EXP_RATE));
        game.loot.rollDrops(x);
        game.events.emit('monsterKilled', x);
      }
    }
  };
  Sync.applySnapshot = applySnapshot;
  Sync.reset = function () {};
})(window.G = window.G || {});
