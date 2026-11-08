/* Server-side world (Stage 9, phase 2).
   The server runs every map that has players on it: monster spawns, wandering,
   chasing, attacking, bosses and respawns. It uses the game's own code (terrain,
   navigation grid, scenery, map-editor edits, the Monster class and its AI) in
   a sandbox without any drawing, so monsters walk exactly where they do in the
   browser. Each map gets its own sandbox because terrain and map-editor state
   are per map in the game's code.

   Players' games show "puppet" monsters that follow the server's snapshots and
   send their hits, statuses and knockbacks here. Damage and rewards are still
   worked out by the games (phases 3 and 4 move them here). */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WORLD_SCRIPTS = ['lib/three.min.js', 'js/core/config.js', 'js/core/utils.js', 'js/data/items.js', 'js/data/jobs.js', 'js/data/skills.js', 'js/data/jobs2.js',
  'js/data/skills2.js', 'js/data/skilltrees.js', 'js/data/npcs.js', 'js/data/maps.js', 'js/data/content.js', 'js/data/quests.js', 'js/world/terrain.js', 'js/world/navgrid.js',
  'js/world/environment.js', 'js/world/custommaps.js', 'js/entities/entity.js', 'js/entities/monster.js', 'js/systems/monsters.js'];
const SPRITE_SCRIPTS = ['js/graphics/spriteRig.js', 'js/graphics/spriteFactory.js', 'js/graphics/directionalSprite.js'];
const TICK = 0.1;          // seconds between simulation steps
const SNAP_EVERY = 2;      // ticks between snapshots (changes only)
const FULL_EVERY = 30;     // ticks between full snapshots
const IDLE_LIFE = 600;     // seconds a map keeps running after its last player leaves (starting one takes a moment)

/* ---------------------------------------------------------------- sandboxes */
const compiled = new Map();
const script = (f) => {
  if (!compiled.has(f)) compiled.set(f, new vm.Script(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }));
  return compiled.get(f);
};
const noop = () => {};
// A canvas that draws nothing (the scenery code paints a few textures).
const ctx2d = new Proxy({}, { get: (t, k) => {
  if (k in t) return t[k];
  if (k === 'getImageData' || k === 'createImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, (w | 0) * (h | 0)) * 4), width: w, height: h });
  if (k === 'measureText') return () => ({ width: 10 });
  return typeof k === 'string' && /^(create|add)/.test(k) ? () => ctx2d : noop;
}, set: (t, k, v) => { t[k] = v; return true; } });
function sandbox(files) {
  const document = { createElement: (t) => (t === 'canvas' ? { width: 1, height: 1, style: {}, getContext: () => ctx2d, toDataURL: () => '' } : { style: {}, appendChild: noop, setAttribute: noop, addEventListener: noop }),
    getElementById: () => null, addEventListener: noop, body: { appendChild: noop } };
  const sb = { console, Math, Date, JSON, Object, Array, Map, Set, WeakMap, Promise, Error, Symbol, Number, String, Boolean, RegExp, Uint8Array, Uint8ClampedArray, Uint16Array, Uint32Array,
    Int8Array, Int16Array, Int32Array, Float32Array, Float64Array, ArrayBuffer, DataView, setTimeout: noop, clearTimeout: noop, document, navigator: { userAgent: 'node' },
    performance: { now: () => Date.now() }, self: {}, addEventListener: noop, requestAnimationFrame: noop, devicePixelRatio: 1,
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop } };
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  for (const f of files) script(f).runInContext(sb);
  return sb;
}

// Animation lengths (attack swings and deaths wait for them), from the game's own sprite sheets.
let ANIMS = null;
function animTable() {
  if (ANIMS) return ANIMS;
  const sb = sandbox(WORLD_SCRIPTS.slice(0, 3).concat(['js/data/items.js', 'js/data/maps.js', 'js/data/content.js'], SPRITE_SCRIPTS));
  ANIMS = {};
  for (const type of Object.keys(sb.G.Config.MONSTERS)) {
    try { ANIMS[type] = sb.G.SpriteFactory.get(type).anims; } catch (e) { ANIMS[type] = {}; }
  }
  return ANIMS;
}
// A sprite that only knows its animation lengths.
class SilentSprite {
  constructor(sheet) { this.sheet = sheet; this.speed = 1; this.tint = null; this.mesh = { position: { copy: noop } }; }
  duration(name) { const a = this.sheet.anims[name]; return a ? a.count / a.fps : 0.5; }
  play() {} setOpacity() {} setFlash() {} update() {} dispose() {}
}

/* ---------------------------------------------------------------- one map */
class MapSim {
  constructor(mapId, customMaps, out) {
    this.mapId = mapId; this.out = out;   // out: { broadcast(map, msg), send(charId, msg) }
    const sb = this.sb = sandbox(WORLD_SCRIPTS), G = this.G = sb.G, THREE = sb.THREE, C = G.Config, TR = G.Terrain;
    const anims = animTable();
    G.SpriteFactory = { get: (type) => ({ anims: anims[type] || {} }) };
    G.DirectionalSprite = SilentSprite;
    for (const [id, d] of Object.entries(customMaps || {})) G.CustomMaps.set(id, d);
    if (!G.Maps[mapId]) throw new Error(`No such map: ${mapId}`);
    // Nobody stands here: monsters only ever chase the players listed below.
    const nobody = { alive: false, hidden: true, position: new THREE.Vector3(1e5, 0, 1e5), radius: 0.45, derived: { extra: {}, def: 0, softDef: 0 } };
    const sim = this;
    const game = this.game = {
      mapId, time: 0, frame: 0, player: nobody, fields: null,
      scene: { add: noop, remove: noop }, mapRoot: new THREE.Group(),
      effects: { makeShadow: () => new THREE.Object3D(), death: noop, sparkle: noop, levelUp: noop },
      overlay: { addText: noop }, sfx: noop, loot: { rollDrops: noop }, events: { emit: noop },
      // Boss warnings and rings are shown to everyone on the map.
      spells: { ring: (...a) => sim.fx('ring', a), warning: (...a) => sim.fx('warning', a) },
      hud: { toast: (text) => out.broadcast(mapId, { t: 'notice', text, toast: true }) },
      log: { add: (text) => { const p = sim.focus; if (p && p.isRemote) out.send(p.id, { t: 'notice', text }); } },
    };
    // Build the map like the game does: terrain, obstacles, scenery, map-editor edits.
    const map = this.map = game.map = G.CustomMaps.prepare(mapId);
    TR.init(map); TR.build(game.mapRoot);
    const nav = game.nav = new G.NavGrid(C.WORLD_SIZE, C.NAV_CELL);
    const B = C.BRIDGE;
    nav.markAll((x, z) => {
      if (TR.boundaryRaw(x, z) > -0.5) return true;
      if (TR.onBridge(x, z)) return false;
      if (TR.isWater(x, z)) return true;
      if (map.cave && TR.height(x, z) > 0.85) return true;
      const e = 0.5, sl = Math.hypot(TR.height(x + e, z) - TR.height(x - e, z), TR.height(x, z + e) - TR.height(x, z - e)) / (2 * e);
      return sl > 1.1;
    });
    if (map.bridge) { nav.blockRect(B.x - B.halfWidth + 0.12, TR.BRIDGE_Z, 0.1, B.halfLength, 0); nav.blockRect(B.x + B.halfWidth - 0.12, TR.BRIDGE_Z, 0.1, B.halfLength, 0); }
    game.env = new G.Environment(game.mapRoot, nav, map).build();
    // Same order as the game's loadMap: monsters spawn, then NPCs and map-editor objects block their spots.
    this.monsters = new G.MonsterManager(game, map.spawns || []);
    for (const d of G.NPC_DEFS) if ((map.npcs || []).includes(d.id)) nav.blockCircle(d.x, d.z, 0.3);
    G.CustomMaps.build(game);
    game.mapRoot = null;   // the scenery's meshes aren't needed any more
    this.players = new Map();   // charId -> stand-in the monsters can see and chase
    this.lastSent = new Map();
    this.ticks = 0; this.emptyFor = 0;
    this.patch();
  }

  // Server versions of the few monster actions that reach a player's game.
  patch() {
    const G = this.G, sim = this, M = G.Monster.prototype;
    const startSwing = M.startSwing, die = M.die;
    M.startSwing = function () { this.swingSeq = (this.swingSeq || 0) + 1; return startSwing.call(this); };
    M.die = function (killer) {
      // Poison and other kills without a hand behind them count for the last player who hit it.
      if (!(killer && killer.isRemote) && this.lastHitBy && sim.players.get(this.lastHitBy)) killer = sim.players.get(this.lastHitBy);
      die.call(this, killer);   // a stand-in player has no gainExp: nothing is rewarded here
      if (killer && killer.isRemote) sim.out.send(killer.id, { t: 'mob', op: 'killed', map: sim.mapId, id: this.id, to: killer.id });
    };
    // A swing that connects: the player's own game works out the hit (until phase 3).
    G.Combat.monsterAttack = (mon, target) => { if (target && target.isRemote) sim.out.send(target.id, { t: 'mob', op: 'attack', map: sim.mapId, id: mon.id, to: target.id }); };
  }

  /* ---- players ---- */
  join(me) {
    const THREE = this.sb.THREE, sim = this;
    const p = { isRemote: true, id: me.charId, name: me.name, position: new THREE.Vector3(me.x, 0, me.z), radius: 0.45, alive: true, hidden: false, playingDead: false,
      cloaked: false, moving: false, attacking: false, derived: { extra: {}, def: 0, softDef: 0 },
      // The boss slam hits whoever it is chasing: their game applies the damage.
      takeDamage(dmg, src) { sim.out.send(this.id, { t: 'mob', op: 'hurt', map: sim.mapId, id: src ? src.id : -1, to: this.id, dmg: Math.round(dmg) }); },
      addStatus: noop };
    this.players.set(me.charId, p);
    this.move(me);
    this.emptyFor = 0;
  }
  move(me) {
    const p = this.players.get(me.charId);
    if (!p) return;
    p.position.set(me.x, this.G.Terrain.surfaceHeight(me.x, me.z), me.z);
    p.moving = !!me.moving;
    p.alive = me.hp == null || me.hp > 0;
    p.hidden = !!me.hidden;
  }
  leave(charId) {
    const p = this.players.get(charId);
    if (!p) return;
    this.players.delete(charId);
    p.alive = false;
    for (const m of this.monsters.list) if (m.aggro === p) m.loseInterest();
  }

  /* ---- hits from players ---- */
  hit(me, msg) {
    const m = this.monsters.list.find((x) => x.id === Number(msg.id)), from = this.players.get(me.charId);
    if (!m || !m.alive || !from) return;
    this.focus = from;
    if (msg.op === 'dmg') {
      m.lastHitBy = me.charId;
      m.takeDamage(Math.max(0, Math.min(1e7, Math.round(Number(msg.dmg) || 0))), from);
    } else if (msg.op === 'status') {
      const name = String(msg.name || '').slice(0, 24), data = msg.data && typeof msg.data === 'object' ? msg.data : undefined;
      if (/^[a-z_]+$/.test(name)) m.addStatus(name, Math.max(0.1, Math.min(60, Number(msg.sec) || 1)), data && { dps: Math.max(0, Math.min(1e5, Number(data.dps) || 0)) });
      if (name === 'poisoned') m.lastHitBy = me.charId;
    } else if (msg.op === 'knock') {
      m.knockback(Number(msg.fx) || 0, Number(msg.fz) || 0, Math.max(0, Math.min(10, Number(msg.dist) || 1)));
    }
  }

  /* ---- the simulation step ---- */
  step(dt) {
    const game = this.game, list = this.monsters.list, players = [...this.players.values()];
    game.time += dt; game.frame++;
    const peaceful = this.G.CustomMaps.rule('peaceful');
    for (const m of list) {
      // Idle monsters far from every player think less often to save CPU.
      const near = players.some((p) => Math.hypot(m.position.x - p.position.x, m.position.z - p.position.z) < 70);
      this.focus = m.aggro;
      if (near || m.state !== 'idle' || (game.frame + m.id) % 4 === 0) m.update(!near && m.state === 'idle' ? dt * 4 : dt);
    }
    // Aggressive monsters attack anyone who wanders close.
    if (!peaceful) for (const m of list) {
      if (!m.alive || !m.def.aggressive || (m.state !== 'idle' && m.state !== 'wander')) continue;
      for (const p of players) if (p.alive && !p.hidden && m.distanceTo(p) < (m.def.aggroRange || 7)) { m.aggroOn(p); break; }
    }
    // Every fighting player gets their own ring of attackers.
    for (const m of list) m.slot = null;
    const assign = this.G.MonsterManager.prototype.assignSlots;
    for (const p of players) {
      const mine = list.filter((m) => m.aggro === p);
      if (mine.length) assign.call({ game: { player: p, nav: game.nav }, list: mine });
    }
    this.ticks++;
    if (this.ticks % SNAP_EVERY === 0) this.sendSnapshot(this.ticks % FULL_EVERY === 0);
  }

  // Same snapshot format the map hosts used to send.
  stateOf(m) {
    const st = {}, t = this.game.time;
    for (const k in m.status) st[k] = Math.max(0, +(m.status[k].until - t).toFixed(1));
    return { i: m.id, x: +m.position.x.toFixed(2), z: +m.position.z.toFixed(2), hx: +m.home.x.toFixed(2), hz: +m.home.z.toFixed(2), f: +m.targetFacing.toFixed(2), hp: Math.round(m.hp),
      a: m.alive ? 1 : 0, mv: m.moving ? 1 : 0, sw: m.swingSeq || 0, st, tg: m.aggro && m.aggro.isRemote ? m.aggro.id : 0 };
  }
  snapshot() { return this.monsters.list.map((m) => this.stateOf(m)); }
  sendSnapshot(full) {
    const list = [];
    for (const m of this.monsters.list) {
      const s = this.stateOf(m), key = JSON.stringify(s);
      if (full || this.lastSent.get(m.id) !== key) { this.lastSent.set(m.id, key); list.push(s); }
    }
    if (list.length) this.out.broadcast(this.mapId, { t: 'mobs', map: this.mapId, list });
  }
  fx(fn, args) {
    const ref = (v) => (v && typeof v === 'object' && typeof v.x === 'number' ? { v: [+v.x.toFixed(2), +(v.y || 0).toFixed(2), +v.z.toFixed(2)] } : typeof v === 'object' ? null : v);
    this.out.broadcast(this.mapId, { t: 'fx', k: 'v', ns: 'spells', fn, a: args.slice(0, 5).map(ref), from: 0, map: this.mapId });
  }
}

/* ---------------------------------------------------------------- all maps */
const World = {
  sims: new Map(), customMaps: {}, out: null, cpu: { ms: 0, ticks: 0 },
  init(out, customMaps) {
    this.out = out; this.customMaps = customMaps || {};
    animTable();
    let last = Date.now();
    setInterval(() => {
      const now = Date.now(), dt = Math.min(0.3, (now - last) / 1000); last = now;
      const t0 = process.hrtime.bigint();
      for (const [id, sim] of this.sims) {
        if (!sim.players.size) { sim.emptyFor += dt; if (sim.emptyFor > IDLE_LIFE) { this.sims.delete(id); continue; } }
        try { sim.step(dt); } catch (e) { console.error(`World ${id}:`, e); this.sims.delete(id); }
      }
      this.cpu.ms += Number(process.hrtime.bigint() - t0) / 1e6; this.cpu.ticks++;
    }, TICK * 1000).unref();
    // The starting town is ready before anyone arrives.
    setImmediate(() => this.sim('meadow'));
  },
  // The map's simulation, started when the first player arrives.
  sim(map) {
    let s = this.sims.get(map);
    if (s) return s;
    try {
      const t0 = Date.now();
      s = new MapSim(map, this.customMaps, this.out);
      console.log(`World: started ${map} (${s.monsters.list.length} monsters, ${Date.now() - t0} ms)`);
    } catch (e) { console.error(`World: couldn't start ${map}: ${e.message}`); return null; }
    this.sims.set(map, s);
    return s;
  },
  join(me) { const s = this.sim(me.map); if (s) s.join(me); },
  move(me) { const s = this.sims.get(me.map); if (s) s.move(me); },
  leave(me, map) { const s = this.sims.get(map || me.map); if (s) s.leave(me.charId); },
  hit(me, msg) { const s = this.sims.get(me.map); if (s && msg.map === me.map) s.hit(me, msg); },
  snapshot(map) { const s = this.sims.get(map); return s ? s.snapshot() : []; },
  // A map was edited: rebuild it (its players reload it too).
  mapUpdated(id, data) {
    if (data) this.customMaps[id] = data; else delete this.customMaps[id];
    const old = this.sims.get(id);
    if (!old) return;
    this.sims.delete(id);
    const s = this.sim(id);
    if (s) for (const p of old.players.values()) s.players.set(p.id, Object.assign(p, { position: new s.sb.THREE.Vector3(p.position.x, p.position.y, p.position.z) }));
  },
  // Average time one simulation step takes (for the health check).
  load() { const c = this.cpu, r = c.ticks ? c.ms / c.ticks : 0; c.ms = 0; c.ticks = 0; return +r.toFixed(2); },
};

module.exports = { World, MapSim };
