/* Systems behind the full skill trees: ground fields & traps, spirit spheres
   and combos, Peco riding, teleport / warp portal, the merchant cart and
   vending, crafting (forging, brewing, stones), plus the named effects and
   buffs used by data/skilltrees.js. */
(function (G) {
  'use strict';
  const C = () => G.Combat, U = G.Utils;
  const SS = G.SkillSystem, BUFFS = SS.BUFFS, FX = SS.EFFECTS;
  const near = (game, pos, r) => game.monsters.list.filter((m) => m.alive && Math.hypot(m.position.x - pos.x, m.position.z - pos.z) <= r + m.def.radius);
  const say = (game, text, kind) => game.log.add(text, kind || 'info');

  /* ---------------- items used by skills ---------------- */
  const D = G.Items.DB;
  const item = (id, o) => { D[id] = Object.assign({ id, rarity: 'common', weight: 1, price: 10, stack: o.type !== 'equip' }, o); };
  item('blue_gemstone', { name: 'Blue Gemstone', type: 'etc', icon: { shape: 'ore', color: '#4f8ae8' }, price: 600, weight: 1, desc: 'A catalyst for Warp Portal, Safety Wall, Magnetic Earth and Resurrection.' });
  item('red_gemstone', { name: 'Red Gemstone', type: 'etc', icon: { shape: 'ore', color: '#e84f5a' }, price: 600, weight: 1, desc: 'A catalyst for Stone Curse, Venom Dust and Scribble.' });
  item('yellow_gemstone', { name: 'Yellow Gemstone', type: 'etc', icon: { shape: 'ore', color: '#ffd84a' }, price: 600, weight: 1, desc: 'A catalyst for the Sage\'s zones, Dispell and Hocus-pocus.' });
  item('holy_water', { name: 'Holy Water', type: 'use', icon: { shape: 'potion', color: '#bfe8ff' }, price: 20, weight: 3, use: { sp: 10 }, desc: 'Water blessed by Aqua Benedicta. Drink for 10 SP, or use it for Aspersio.' });
  item('stone', { name: 'Stone', type: 'etc', icon: { shape: 'ore', color: '#9aa3ad' }, price: 1, weight: 3, desc: 'Just a stone. Good for throwing.' });
  item('iron_ore', { name: 'Iron Ore', type: 'etc', icon: { shape: 'ore', color: '#8a7f70' }, price: 75, weight: 15, desc: 'Raw ore. Iron Tempering turns it into Iron.' });
  item('iron', { name: 'Iron', type: 'etc', icon: { shape: 'ore', color: '#b8c0cc' }, price: 100, weight: 10, desc: 'A refined iron ingot, the base of forged weapons.' });
  item('coal', { name: 'Coal', type: 'etc', icon: { shape: 'ore', color: '#3a3a40' }, price: 200, weight: 10, desc: 'Fuel for Steel Tempering.' });
  item('steel', { name: 'Steel', type: 'etc', icon: { shape: 'ore', color: '#dfe6f0' }, price: 600, weight: 10, rarity: 'uncommon', desc: 'Hard steel for advanced forging.' });
  item('ember', { name: 'Ember', type: 'etc', icon: { shape: 'ore', color: '#ff7a3d' }, price: 30, weight: 1, desc: 'A still-warm cinder dropped by Drops.' });
  for (const [id, name, color] of [['flame_heart', 'Flame Heart', '#ff5a2a'], ['mystic_frozen', 'Mystic Frozen', '#6fc3ff'], ['rough_wind', 'Rough Wind', '#ffe066'], ['great_nature', 'Great Nature', '#8fd16a']])
    item(id, { name, type: 'etc', icon: { shape: 'ore', color }, price: 1500, weight: 5, rarity: 'uncommon', desc: 'An elemental stone. Forge it into a weapon to give the weapon its element.' });
  for (const [el, name, color] of [['fire', 'Fire', '#ff5a2a'], ['water', 'Water', '#6fc3ff'], ['wind', 'Wind', '#ffe066'], ['earth', 'Earth', '#c9a06b']])
    item(`${el}_converter`, { name: `${name} Elemental Converter`, type: 'use', icon: { shape: 'book', color }, price: 200, weight: 3, use: { fn: 'converter', element: el }, desc: `Endow your weapon with ${el} for 3 minutes.` });
  item('acid_bottle', { name: 'Acid Bottle', type: 'etc', icon: { shape: 'potion', color: '#9ee86a' }, price: 100, weight: 10, desc: 'Ammunition for Acid Terror.' });
  item('bottle_grenade', { name: 'Bottle Grenade', type: 'etc', icon: { shape: 'potion', color: '#ff7a3d' }, price: 100, weight: 10, desc: 'Ammunition for Demonstration.' });
  item('arrow', { name: 'Arrow', type: 'etc', icon: { shape: 'arrow', color: '#c9a06b' }, price: 1, weight: 0.1, desc: 'A plain arrow. (Arrows aren\'t used as ammunition yet; sell them.)' });
  const W = (id, name, wt, wlv, atk, req, jobs, price, iconShape, color, desc, extra) => item(id, Object.assign({ name, type: 'equip', slot: 'weapon', weaponType: wt, wlv, icon: { shape: iconShape, color },
    weight: 70, price, slots: wlv >= 3 ? 1 : 2, reqLevel: req, jobs, bonus: { atk }, desc }, extra || {}));
  W('claymore', 'Claymore', 'twohand', 3, 180, 33, ['swordsman'], 15000, 'sword', '#e6edf5', 'A huge two-handed sword.', { slots: 0 });
  W('slayer', 'Slayer', 'twohand', 2, 120, 18, ['swordsman'], 8000, 'sword', '#cfd8e6', 'A broad two-handed blade.');
  W('violin', 'Violin', 'instrument', 2, 60, 1, ['bard'], 3000, 'book', '#a8743c', 'A sweet-voiced fiddle that doubles as a club.');
  W('guitar', 'Guitar', 'instrument', 3, 95, 20, ['bard'], 11000, 'book', '#c0394a', 'A guitar strung with steel. Rocks hard.');
  W('rope', 'Rope', 'whip', 1, 45, 1, ['dancer'], 1500, 'knuckle', '#c9a06b', 'A braided rope whip.');
  W('chain', 'Chain', 'whip', 2, 80, 15, ['dancer'], 7000, 'knuckle', '#cfd8e6', 'A whip of iron links.');
  Object.assign(G.Items.WEAPON_TYPES, {
    twohand: { name: 'Two-handed Sword', delay: 1.1, range: 1.85, twoHanded: true },
    instrument: { name: 'Instrument', delay: 0.95, range: 1.6 },
    whip: { name: 'Whip', delay: 0.9, range: 2.0 },
  });
  for (const j of ['swordsman', 'knight', 'crusader']) { const job = G.Jobs.get(j); if (!job.weapons.includes('twohand')) job.weapons.push('twohand'); }
  G.Jobs.get('bard').weapons.push('instrument');
  G.Jobs.get('dancer').weapons.push('whip');
  G.Jobs.get('bard').gift = 'violin';
  G.Jobs.get('dancer').gift = 'rope';
  const shop = (id, ids) => { const s = G.SHOPS[id]; for (const x of ids) if (!s.stock.includes(x)) s.stock.push(x); };
  shop('tools', ['empty_bottle', 'blue_gemstone', 'red_gemstone', 'yellow_gemstone']);
  shop('forge', ['iron_ore', 'coal']);
  shop('weapons', ['slayer', 'claymore', 'violin', 'guitar', 'rope', 'chain']);
  if (!D.empty_bottle.price) D.empty_bottle.price = 3;
  const drops = { drops: [['ember', 0.4], ['flame_heart', 0.004]], rocker: [['iron_ore', 0.15], ['great_nature', 0.004]], poporing: [['iron_ore', 0.1]], familiar: [['coal', 0.08]],
    spore: [['mystic_frozen', 0.004], ['coal', 0.05]], whisper: [['rough_wind', 0.006]], king_poring: [['steel', 0.3], ['flame_heart', 0.05]] };
  for (const m in drops) for (const [id, chance] of drops[m]) G.Config.MONSTERS[m].drops.push({ id, chance });

  G.ItemUse = {
    converter(p, it) { p.skills.addBuff('converter_' + it.use.element, 1, 180); p.game.spells.aura(p, it.icon.color); return true; },
  };

  /* ---------------- buffs ---------------- */
  const buff = (id, name, bonus) => { BUFFS[id] = { name, bonus: bonus || (() => ({})) }; };
  buff('sight', 'Sight'); buff('ruwach', 'Ruwach'); buff('energy_coat', 'Energy Coat'); buff('auto_counter', 'Auto Counter'); buff('reflect_shield', 'Reflect Shield');
  buff('defender', 'Defender', () => ({ aspd: -20 })); buff('devotion', 'Devotion'); buff('providence', 'Providence', (l) => ({ mdef: 5 * l }));
  buff('spear_quicken', 'Spear Quicken', (l) => ({ aspd: 21 + l })); buff('magic_rod', 'Magic Rod'); buff('auto_spell', 'Hindsight');
  buff('endow_tsunami', 'Endow Tsunami', () => ({ weaponElement: 'water' })); buff('endow_quake', 'Endow Quake', () => ({ weaponElement: 'earth' }));
  for (const el of ['fire', 'water', 'wind', 'earth']) buff('converter_' + el, `${el[0].toUpperCase() + el.slice(1)} Converter`, () => ({ weaponElement: el }));
  buff('sight_blaster', 'Sight Blaster'); buff('mr_kim', 'Mr. Kim A Rich Man', (l) => ({ expBonus: (25 + 5 * l) / 2 }));
  buff('drum_battlefield', 'A Drum on the Battlefield', (l) => ({ atk: (25 + 25 * l) / 2, def: l + 1 }));
  buff('ring_nibelungen', 'The Ring of Nibelungen', (l) => ({ atk: (50 + 25 * l) / 2 })); buff('into_abyss', 'Into the Abyss');
  buff('siegfried', 'Invulnerable Siegfried', (l) => ({ mdef: (55 + 5 * l) / 2 })); buff('apple_of_idun', 'The Apple of Idun', (l) => ({ maxHpPct: 5 + 2 * l }));
  buff('fortunes_kiss', 'Fortune\'s Kiss', (l) => ({ crit: 10 + l })); buff('suffragium', 'Suffragium', (l) => ({ castReduce: 15 * l }));
  buff('aspersio', 'Aspersio', () => ({ weaponElement: 'holy' })); buff('bs_sacramenti', 'B.S. Sacramenti', (l) => ({ def: 5 + l }));
  buff('magnificat', 'Magnificat', () => ({ spRegenMult: 2 })); buff('steel_body', 'Mental Strength', () => ({ def: 90, mdef: 90, aspd: -25 }));
  buff('blade_stop', 'Root'); buff('fury', 'Fury', (l) => ({ crit: 7.5 + 2.5 * l, noSpRegen: 1 })); buff('ki', 'Ki Translation', () => ({ atk: 5, flee: 5 }));
  buff('cloaking', 'Cloaking'); buff('poison_react', 'Poison React'); buff('weapon_perfection', 'Weapon Perfection', () => ({ atkPct: 10 }));
  buff('maximize_power', 'Maximize Power', () => ({ atkPct: 15 })); buff('auto_berserk', 'Auto Berserk');
  for (const s of ['weapon', 'shield', 'armor', 'helm']) buff('cp_' + s, `Chemical Protection ${s[0].toUpperCase() + s.slice(1)}`, () => ({ def: 3 }));

  /* ---------------- ground fields & traps ---------------- */
  class Fields {
    constructor(game) { this.game = game; this.list = []; this.ringGeo = new THREE.RingGeometry(0.86, 1, 40).rotateX(-Math.PI / 2); }
    add(o) {
      const game = this.game;
      if (this.list.some((f) => f.kind === 'land_protector' && Math.hypot(f.x - o.x, f.z - o.z) < f.r) && o.kind !== 'land_protector') { say(game, 'Magnetic Earth blocks that here.', 'warn'); return null; }
      const y = G.Terrain.surfaceHeight(o.x, o.z) + 0.06;
      const mat = new THREE.MeshBasicMaterial({ color: o.color || '#ffffff', transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(this.ringGeo, mat);
      mesh.position.set(o.x, y, o.z); mesh.scale.set(o.r, 1, o.r);
      const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: o.color || '#ffffff', transparent: true, opacity: 0.16, depthWrite: false, toneMapped: false }));
      fill.position.copy(mesh.position); fill.scale.copy(mesh.scale);
      game.mapRoot.add(mesh, fill);
      if (o.trap) {
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.18, 0.45), new THREE.MeshStandardMaterial({ color: o.color || '#c9a06b', roughness: 0.6 }));
        box.position.set(o.x, y + 0.09, o.z); game.mapRoot.add(box); o.box = box;
      }
      Object.assign(o, { mesh, fill, t: 0, tickT: 0, armed: o.trap ? 0.4 : 0 });
      this.list.push(o);
      return o;
    }
    remove(f) {
      const i = this.list.indexOf(f);
      if (i >= 0) this.list.splice(i, 1);
      for (const m of [f.mesh, f.fill, f.box, f.extraMesh]) if (m) { m.parent && m.parent.remove(m); m.geometry !== this.ringGeo && m.geometry.dispose(); m.material.dispose(); }
    }
    clear() { for (const f of this.list.slice()) this.remove(f); }
    // Is the player standing in a protecting field of this kind?
    protecting(kind) {
      const p = this.game.player;
      return this.list.find((f) => f.kind === kind && Math.hypot(p.position.x - f.x, p.position.z - f.z) <= f.r);
    }
    playerInside(kind) { return !!this.protecting(kind); }
    update(dt) {
      for (const f of this.list.slice()) {
        f.t += dt;
        if (f.t >= f.dur) { this.remove(f); continue; }
        f.mesh.material.opacity = 0.4 + 0.2 * Math.sin(f.t * 4);
        if (f.onFrame) f.onFrame(dt, f);
        if (f.trap) {
          if ((f.armed -= dt) > 0) continue;
          const hit = near(this.game, f, f.r);
          if (hit.length) { f.trigger(hit, f); this.remove(f); }
          continue;
        }
        if (f.onTick && (f.tickT -= dt) <= 0) { f.tickT = f.tick || 0.5; f.onTick(f, near(this.game, f, f.r)); }
      }
    }
  }
  G.Fields = Fields;

  /* ---------------- named effects ---------------- */
  const after = (sys, s, fn) => sys.game.after(s, fn);
  Object.assign(FX, {
    auto_berserk(sys) { if (sys.buffs.auto_berserk) { delete sys.buffs.auto_berserk; sys.player.recalc(); say(sys.game, 'Auto Berserk off.'); } else sys.addBuff('auto_berserk', 1, 99999); },
    safety_wall(sys, lv, t) { const c = (t || sys.player).position; sys.game.fields.add({ kind: 'safety_wall', x: c.x, z: c.z, r: 1.2, dur: 5 * lv, color: '#ff9ec2', hits: lv + 1 }); },
    // Sanctuary: holy ground that heals whoever stands in it.
    sanctuary_field(sys, lv, t) {
      const c = t.position, game = sys.game;
      game.fields.add({ kind: 'sanctuary', x: c.x, z: c.z, r: 2.2, dur: 4 + lv, tick: 1, color: '#bff2c0', onTick: (f) => {
        const p = game.player;
        if (Math.hypot(p.position.x - f.x, p.position.z - f.z) <= f.r) { p.heal(20 + 15 * lv); game.spells.aura(p, '#bff2c0'); }
      } });
    },
    pneuma(sys, lv, t) {
      const game = sys.game, x = t.position.x, z = t.position.z;
      const f = game.fields.add({ kind: 'pneuma', x, z, r: 1.6, dur: 10, color: '#bfe8ff' });
      if (!f) return;
      // A translucent swirling pillar of wind.
      const geo = new THREE.CylinderGeometry(1.5, 1.6, 3.2, 24, 1, true); geo.translate(0, 1.6, 0);
      const mat = new THREE.MeshBasicMaterial({ color: '#bfe8ff', transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
      const pillar = new THREE.Mesh(geo, mat);
      pillar.position.set(x, G.Terrain.surfaceHeight(x, z), z);
      game.mapRoot.add(pillar);
      f.extraMesh = pillar;
      f.onFrame = (dt, fl) => { pillar.rotation.y += dt * 3; mat.opacity = 0.18 + 0.06 * Math.sin(fl.t * 6); if (Math.random() < 0.5) game.effects.sparks.emit(x + (Math.random() - 0.5) * 2.6, pillar.position.y + Math.random() * 3, z + (Math.random() - 0.5) * 2.6, { color: [0.75, 0.9, 1], size: 0.12, vy: 1.5, life: 0.6 }); };
    },
    fire_wall(sys, lv, t) {
      let hits = lv + 2;
      sys.game.fields.add({ kind: 'fire_wall', x: t.position.x, z: t.position.z, r: 1.6, dur: 5 + lv, tick: 0.3, color: '#ff7a3d',
        onTick: (f, ms) => { for (const m of ms) { if (hits-- <= 0) { f.t = f.dur; return; } C().magic(sys.player, m, { mult: 0.5, element: 'fire' }); m.knockback(f.x, f.z, 1.2); } sys.game.effects.sparks.burst(f.x, f.y || 0.3, f.z, 4, { color: [1, 0.5, 0.2], size: 0.4, speed: 2, up: 3, life: 0.5 }); } });
    },
    fire_pillar(sys, lv, t) {
      sys.game.fields.add({ kind: 'trap', trap: true, x: t.position.x, z: t.position.z, r: 1.4, dur: 30, color: '#ff7a3d',
        trigger: (ms, f) => { for (let i = 0; i < lv + 2; i++) after(sys, i * 0.12, () => { for (const m of near(sys.game, f, 2)) C().magic(sys.player, m, { mult: 0.5 + 0.1 * lv, element: 'fire' }); sys.game.spells.ring(f, '#ff7a3d', 2); }); } });
    },
    sightrasher(sys, lv, t, s) {
      if (!sys.buffs.sight) { say(sys.game, 'Sightrasher needs Sight to be active.', 'warn'); return; }
      delete sys.buffs.sight; sys.player.recalc(); SS.runFx(sys, s, lv, null);
    },
    ice_wall(sys, lv, t) {
      const c = t.position.clone();
      sys.game.spells.ring(c, '#bfe8ff', 2.5);
      for (const m of near(sys.game, c, 2.5)) m.addStatus('rooted', 5 + lv);
      sys.game.fields.add({ kind: 'ice', x: c.x, z: c.z, r: 2.5, dur: 5 + lv, color: '#bfe8ff' });
    },
    quagmire(sys, lv, t) {
      sys.game.fields.add({ kind: 'quagmire', x: t.position.x, z: t.position.z, r: 2.6, dur: 5 * lv, tick: 0.5, color: '#7a5a3a',
        onTick: (f, ms) => { for (const m of ms) { m.addStatus('slowed', 1); m.addStatus('quagmire', 1); } } });
    },
    sense(sys, lv, t) {
      const d = t.def;
      sys.game.dialog.open({ name: t.name, title: 'Sense' }, async (dlg) => dlg.say(`${t.name}, level ${d.level}\nHP ${Math.round(t.hp)} / ${d.hp}\nElement: ${d.element || 'neutral'}\nDEF ${d.def}, MDEF ${d.mdef || 0}, FLEE ${d.flee}\nATK ${d.atk[0]}–${d.atk[1]}`));
    },
    cast_cancel(sys, lv) {
      const c = sys.casting;
      if (!c) { say(sys.game, 'You aren\'t casting anything.'); return; }
      const s = G.Skills.get(c.id);
      sys.cancelCast('Casting cancelled.');
      sys.player.sp = Math.min(sys.player.maxSp, sys.player.sp + Math.round(s.sp(c.level) * (10 + 15 * lv) / 100));
    },
    sage_zone(sys, lv, t, s) {
      const p = sys.player, id = s.zoneId, col = { volcano: '#ff7a3d', deluge: '#6fc3ff', whirlwind: '#ffe066' }[id], c = (t || p).position;
      sys.game.fields.add({ kind: id, level: lv, x: c.x, z: c.z, r: 3.5, dur: 60 * lv, color: col, tick: 1, onTick: () => p.recalc() });
    },
    land_protector(sys, lv, t) {
      const c = (t || sys.player).position, F = sys.game.fields;
      for (const f of F.list.slice()) if (Math.hypot(f.x - c.x, f.z - c.z) < 4) F.remove(f);
      F.add({ kind: 'land_protector', x: c.x, z: c.z, r: 4, dur: 100 + 30 * lv, color: '#c9a06b' });
    },
    dispell(sys, lv, t) {
      const at = t.position.clone(); at.y += t.def.height;
      if (Math.random() * 100 < 50 + 10 * lv) { t.status = {}; t.provoked = null; sys.game.overlay.addText(at, 'Dispelled', 'debuff'); } else sys.game.overlay.addText(at, 'Resisted', 'miss');
    },
    abracadabra(sys, lv, t) {
      const pool = ['fire_bolt', 'cold_bolt', 'lightning_bolt', 'fire_ball', 'frost_diver', 'jupitel_thunder', 'meteor_storm', 'storm_gust', 'earth_spike', 'heavens_drive', 'lord_of_vermilion', 'soul_strike', 'napalm_beat', 'holy_light', 'bash'];
      const id = pool[(Math.random() * pool.length) | 0], s = G.Skills.get(id);
      if (!s) return;
      say(sys.game, `Hocus-pocus! Out comes ${s.name}!`, 'level');
      const run = FX[s.effect || id];
      if (run) run(sys, Math.ceil(lv / 2), t, s); else if (s.fx) SS.runFx(sys, s, Math.ceil(lv / 2), t);
    },
    elemental_change(sys, lv, t) { t.elementOverride = 'earth'; const at = t.position.clone(); at.y += t.def.height; sys.game.overlay.addText(at, 'Earth!', 'debuff'); },
    teleportation(sys, lv) {
      const game = sys.game, p = sys.player;
      const random = () => {
        for (let i = 0; i < 300; i++) {
          const x = U.randRange(Math.random, -95, 95), z = U.randRange(Math.random, -95, 95);
          if (game.nav.walkable(x, z) && !G.Terrain.isWater(x, z)) { game.spells.aura(p, '#c79bff'); p.teleport(x, z); return; }
        }
      };
      // Level 1 works like a Fly Wing, level 2 like a Butterfly Wing.
      if (lv < 2) { random(); return; }
      const sp = p.savePoint || { map: 'meadow', x: 0, z: -60 };
      game.spells.aura(p, '#c79bff');
      if (sp.map === game.mapId) p.teleport(sp.x, sp.z); else game.travel(sp.map, sp.x, sp.z);
    },
    warp_portal(sys, lv, t) {
      const game = sys.game, p = sys.player, memos = p.extra.memos = p.extra.memos || [];
      game.dialog.open({ name: 'Warp Portal', title: '' }, async (d) => {
        const sp = p.savePoint || { map: 'meadow', x: 0, z: -60 };
        const opts = [`Save point (${G.Maps[sp.map].name})`, ...memos.slice(0, lv - 1).map((m) => `${G.Maps[m.map].name} (${Math.round(m.x)}, ${Math.round(m.z)})`)];
        const choices = [...opts, lv > 1 ? 'Memorise this spot' : null, 'Cancel'].filter(Boolean);
        const c = await d.choose('Open a portal to…', choices);
        const label = choices[c];
        if (label === 'Cancel') return;
        if (label === 'Memorise this spot') {
          memos.unshift({ map: game.mapId, x: p.position.x, z: p.position.z }); memos.length = Math.min(memos.length, 3);
          await d.say('Memorised. (Warp Portal remembers up to 3 places.)'); return;
        }
        const dest = c === 0 ? sp : memos[c - 1];
        const at = (t && t.ground) ? t.position : p.position;
        game.fields.add({ kind: 'warp', x: at.x, z: at.z, r: 1.1, dur: 15, tick: 0.2, color: '#6fc3ff', onTick: (f) => {
          if (Math.hypot(p.position.x - f.x, p.position.z - f.z) <= f.r) { f.t = f.dur; game.travel(dest.map, dest.x, dest.z); }
        } });
        game.spells.ring(at, '#6fc3ff', 1.2);
        game.log.add('A warp portal opens. Step into it to travel.', 'info');
      });
    },
    aqua_benedicta(sys) {
      const p = sys.player, x = p.position.x, z = p.position.z;
      const wet = [[0, 0], [1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]].some(([dx, dz]) => G.Terrain.isWater(x + dx, z + dz));
      if (!wet) { say(sys.game, 'You need to stand in water (the stream or the pond).', 'warn'); return; }
      const b = p.inventory.firstOf('empty_bottle');
      if (!b) { say(sys.game, 'You need an Empty Bottle.', 'warn'); return; }
      p.inventory.remove(b.uid, 1); p.inventory.add('holy_water', 1);
      sys.game.spells.aura(p, '#bfe8ff'); say(sys.game, 'The water glows. You made Holy Water.', 'loot');
    },
    cure(sys, lv, t, s) { sys.game.spells.aura(t || sys.player, '#7dff9a'); },
    find_stone(sys) { if (sys.player.inventory.add('stone', 1).added) say(sys.game, 'You found a Stone.', 'loot'); },
    throw_stone(sys, lv, t) {
      sys.game.spells.orb(sys.player, t, '#9aa3ad', () => {
        if (!t.alive) return;
        const at = t.position.clone(); at.y += t.def.height * 0.6;
        sys.game.overlay.addText(at, '50', 'dmg'); t.takeDamage(50, sys.player);
        if (t.alive && Math.random() < 0.03) t.addStatus('stunned', 3);
      });
    },
    arrow_crafting(sys) {
      const inv = sys.player.inventory;
      const e = inv.items.find((x) => G.Items.get(x.id).type === 'etc' && !/gemstone|ore|converter|steel|iron|coal|card/.test(x.id));
      if (!e) { say(sys.game, 'You have no loot suitable for arrows.', 'warn'); return; }
      const n = 3 + ((Math.random() * 8) | 0);
      inv.remove(e.uid, 1); inv.add('arrow', n);
      say(sys.game, `Turned ${G.Items.get(e.id).name} into ${n} Arrows.`, 'loot');
    },
    riding(sys) {
      const p = sys.player;
      p.riding = !p.riding;
      p.recalc(); p.refreshSprite();
      say(sys.game, p.riding ? 'You mount your Peco Peco.' : 'You dismount.', 'info');
      sys.game.sfx('buff');
    },
    charge_attack(sys, lv, t) {
      const p = sys.player, d = p.distanceTo(t);
      const dir = { x: t.position.x - p.position.x, z: t.position.z - p.position.z }, len = Math.hypot(dir.x, dir.z) || 1;
      p.teleport(t.position.x - (dir.x / len) * 1.2, t.position.z - (dir.z / len) * 1.2);
      C().physical(p, t, { mult: Math.min(5, 1 + d / 3) });
      sys.game.spells.impact(t, '#ff7a3d', 1.4);
    },
    trap(sys, lv, t, s) {
      const game = sys.game, p = sys.player, id = s.trapId || s.id;
      const live = game.fields.list.filter((f) => f.trapOwner);
      if (live.length >= 8) { say(game, 'You can only set 8 traps at once.', 'warn'); return; }
      const mag = (m, mult, el) => C().physical(p, m, { mult, element: el, noMiss: true, ignoreDef: true });
      const T = {
        skid_trap: (ms, f) => ms.forEach((m) => m.knockback(p.position.x, p.position.z, 1 + lv)),
        land_mine: (ms, f) => near(game, f, 1.5).forEach((m) => { mag(m, 1 + 0.4 * lv, 'earth'); if (m.alive && Math.random() < 0.3) m.addStatus('stunned', 2); }),
        ankle_snare_trap: (ms) => ms.forEach((m) => m.addStatus('rooted', 4 + 2 * lv)),
        ankle_snare: (ms) => ms.forEach((m) => m.addStatus('rooted', 4 + 2 * lv)),
        shockwave_trap: (ms) => ms.forEach((m) => mag(m, 0.5 + 0.15 * lv)),
        sandman: (ms, f) => near(game, f, 2.5).forEach((m) => { if (Math.random() * 100 < 40 + 10 * lv) m.addStatus('asleep', 3 + lv); }),
        flasher: (ms, f) => near(game, f, 2.5).forEach((m) => m.addStatus('blinded', 10 + 2 * lv)),
        freezing_trap: (ms, f) => near(game, f, 2).forEach((m) => { mag(m, 1 + 0.2 * lv, 'water'); if (m.alive) m.addStatus('frozen', 3 + lv); }),
        blast_mine: (ms, f) => near(game, f, 2.5).forEach((m) => mag(m, 1.5 + 0.3 * lv, 'wind')),
        claymore_trap: (ms, f) => near(game, f, 3).forEach((m) => mag(m, 2 + 0.5 * lv, 'fire')),
        talkie_box: (ms) => { game.hud.toast(`📦 “Gotcha, ${ms[0].name}!”`); },
      };
      const color = s.icon.color;
      game.fields.add({ kind: 'trap', trap: true, trapOwner: true, trapId: id, x: t.position.x, z: t.position.z, r: 0.9, dur: 60, color,
        trigger: (ms, f) => { game.spells.ring(f, color, 2); game.sfx('slam', f); T[id](ms, f); } });
    },
    remove_trap(sys) {
      const p = sys.player, F = sys.game.fields;
      const trap = F.list.filter((f) => f.trapOwner).sort((a, b) => Math.hypot(a.x - p.position.x, a.z - p.position.z) - Math.hypot(b.x - p.position.x, b.z - p.position.z))[0];
      if (!trap || Math.hypot(trap.x - p.position.x, trap.z - p.position.z) > 8) { say(sys.game, 'No trap of yours nearby.', 'warn'); return; }
      F.remove(trap); say(sys.game, 'Trap removed.', 'info');
    },
    adaptation(sys) {
      const songs = ['poem_of_bragi', 'assassin_cross', 'whistle', 'apple_of_idun', 'humming', 'service_for_you', 'fortunes_kiss', 'mr_kim', 'drum_battlefield', 'ring_nibelungen', 'into_abyss', 'siegfried'];
      let any = false;
      for (const s of songs) if (sys.buffs[s]) { delete sys.buffs[s]; any = true; }
      sys.player.recalc(); sys.game.events.emit('buffsChanged');
      say(sys.game, any ? 'You end your performance.' : 'You aren\'t performing.');
    },
    encore(sys) {
      const last = sys.lastPerformance;
      if (!last) { say(sys.game, 'Nothing to encore yet.', 'warn'); return; }
      const s = G.Skills.get(last.id);
      sys.player.sp += Math.round(s.sp(last.level) / 2);
      if (s.fx) SS.runFx(sys, s, last.level, null);
    },
    pulse(sys, lv, t, s) {
      const P = s.pulse;
      for (let i = 0; i < P.n; i++) after(sys, i, () => {
        sys.game.spells.ring(sys.player.position, P.color, P.r);
        for (const m of near(sys.game, sys.player.position, P.r)) C().magic(sys.player, m, { mult: P.mult(lv) });
      });
    },
    turn_undead(sys, lv, t) {
      const el = t.elementOverride || t.def.element;
      sys.game.spells.beam(t, '#fff2a0', () => {
        if (!t.alive) return;
        if (/shadow|ghost|undead/.test(el || '') && !t.def.boss && Math.random() * 100 < 2 * lv + sys.player.derived.total.luk / 10 + sys.player.derived.total.int / 10) {
          const at = t.position.clone(); at.y += t.def.height; sys.game.overlay.addText(at, 'Turned!', 'crit'); t.takeDamage(t.hp, sys.player);
        } else C().magic(sys.player, t, { mult: 1 + 0.5 * lv, element: 'holy' });
      });
    },
    call_spirits(sys, lv) {
      const p = sys.player;
      if ((p.spheres || 0) >= lv) { say(sys.game, `You can hold ${lv} spirit sphere${lv > 1 ? 's' : ''}.`, 'warn'); return; }
      p.spheres = (p.spheres || 0) + 1; p.recalc();
    },
    absorb_spirits(sys) { const p = sys.player, n = p.spheres || 0; p.spheres = 0; p.sp = Math.min(p.maxSp, p.sp + 7 * n); p.recalc(); say(sys.game, `Absorbed ${n} sphere${n === 1 ? '' : 's'} (+${7 * n} SP).`); },
    // Combo skills hit the monster the combo is already on; no targeting.
    combo(sys, lv, t, s) {
      const p = sys.player, target = p.combo && p.combo.target;
      if (!target || !target.alive) { p.combo = null; return; }
      p.faceTowards(target.position.x, target.position.z);
      p.combo = { stage: s.id, until: sys.game.time + 1.3, target };
      SS.runFx(sys, s, lv, target);
    },
    throw_spheres(sys, lv, t) {
      const p = sys.player, n = Math.min(lv, p.spheres || 0);
      p.spheres -= n; p.recalc();
      for (let i = 0; i < n; i++) after(sys, i * 0.12, () => sys.game.spells.orb(p, t, '#9fd8ff', () => { if (t.alive) C().physical(p, t, { mult: 1.5 + 0.5 * lv, noMiss: true }); }));
    },
    snap(sys, lv, t) {
      const p = sys.player, game = sys.game, x = t.position.x, z = t.position.z;
      if (!game.nav.walkable(x, z)) { say(game, 'You can\'t Snap there.', 'warn'); return; }
      game.effects.sparks.burst(p.position.x, p.position.y + 1, p.position.z, 12, { color: [0.6, 0.85, 1], size: 0.3, speed: 3, life: 0.4 });
      p.teleport(x, z); game.spells.aura(p, '#9fd8ff');
    },
    steal_coin(sys, lv, t) {
      const p = sys.player, D = p.derived;
      if (t.mugged) { say(sys.game, 'Nothing left to take.', 'info'); return; }
      if (Math.random() * 100 < lv + D.total.dex / 4 + D.total.luk / 4) {
        const z = Math.round(t.def.level * (10 + Math.random() * 30)); p.zeny += z; t.mugged = true; sys.game.sfx('zeny');
        say(sys.game, `Mugged ${z} Zeny!`, 'loot');
      } else say(sys.game, 'Mug failed.', 'info');
    },
    intimidate(sys, lv, t) {
      const p = sys.player, game = sys.game;
      C().physical(p, t, { mult: 1.3 + 0.3 * lv });
      if (!t.alive || t.def.boss) return;
      for (let i = 0; i < 200; i++) {
        const x = U.randRange(Math.random, -90, 90), z = U.randRange(Math.random, -90, 90);
        if (game.nav.walkable(x, z) && !G.Terrain.isWater(x, z) && game.nav.walkable(x + 1.2, z)) { p.teleport(x, z); t.setPosition(x + 1.2, z); t.home = { x: x + 1.2, z }; return; }
      }
    },
    scribble(sys, lv, t) {
      const p = sys.player, words = ['Mira was here', 'Kilroy', '♥', 'RO forever', ':)', 'Watch out!'];
      const c = document.createElement('canvas'); c.width = 256; c.height = 64;
      const x = c.getContext('2d'); x.font = 'bold 34px sans-serif'; x.fillStyle = ['#ff6b8b', '#6fc3ff', '#ffd84a'][(Math.random() * 3) | 0]; x.textAlign = 'center'; x.fillText(words[(Math.random() * words.length) | 0].replace('Mira', p.name), 128, 44);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.75).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
      const at = (t || p).position;
      m.position.set(at.x, G.Terrain.surfaceHeight(at.x, at.z) + 0.05, at.z);
      sys.game.mapRoot.add(m);
    },
    venom_dust(sys, lv, t) {
      sys.game.fields.add({ kind: 'venom', x: t.position.x, z: t.position.z, r: 1.8, dur: 5 * lv, tick: 1, color: '#6fd06a',
        onTick: (f, ms) => ms.forEach((m) => { if (!m.status.poisoned) m.addStatus('poisoned', 10, { dps: Math.max(2, Math.round(sys.player.derived.statusAtk / 6)) }); }) });
    },
    venom_splasher(sys, lv, t) {
      if (t.hp > t.def.hp * 0.75) { say(sys.game, 'The monster must be below 75% HP.', 'warn'); return; }
      const at = t.position.clone(); at.y += t.def.height; sys.game.overlay.addText(at, '☠', 'debuff');
      after(sys, 5.5 - 0.5 * Math.min(10, lv), () => {
        const c = t.position.clone(); sys.game.spells.ring(c, '#6fd06a', 2.5);
        for (const m of near(sys.game, c, 2.5)) C().physical(sys.player, m, { mult: 5 + 0.5 * lv, noMiss: true, element: 'poison' });
      });
    },
    greed(sys) { const p = sys.player, L = sys.game.loot; for (const g of (L.ground || L.list || []).slice()) if (Math.hypot(g.x - p.position.x, g.z - p.position.z) < 4 && L.pickUp) L.pickUp(g); },
    summon_flora(sys, lv, t) {
      const game = sys.game, x = t.position.x + 1, z = t.position.z;
      const flower = new THREE.Group();
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.9, 6), new THREE.MeshStandardMaterial({ color: '#4a8a2a' })); stem.position.y = 0.45;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), new THREE.MeshStandardMaterial({ color: '#c0394a' })); head.position.y = 1.0;
      flower.add(stem, head); flower.position.set(x, G.Terrain.surfaceHeight(x, z), z); game.mapRoot.add(flower);
      game.fields.add({ kind: 'flora', x, z, r: 3, dur: 60, tick: 1, color: '#8fd16a', onTick: (f, ms) => {
        const m = ms[0]; if (!m) return;
        head.scale.setScalar(1.3); after(sys, 0.15, () => head.scale.setScalar(1));
        const dmg = 30 + 10 * lv, at = m.position.clone(); at.y += m.def.height * 0.6; game.overlay.addText(at, String(dmg), 'dmg'); m.takeDamage(dmg, sys.player);
      }, onEnd: () => game.mapRoot.remove(flower) });
      after(sys, 60, () => game.mapRoot.remove(flower));
    },
    marine_sphere(sys, lv, t) {
      const c = { x: t.position.x + 0.8, z: t.position.z };
      sys.game.fields.add({ kind: 'sphere', x: c.x, z: c.z, r: 0.6, dur: 3.05, color: '#ff7a3d' });
      after(sys, 3, () => { sys.game.spells.ring(c, '#ff7a3d', 2.5); sys.game.sfx('fire', c); for (const m of near(sys.game, c, 2.5)) { const at = m.position.clone(); at.y += m.def.height * 0.6; const dmg = 150 + 50 * lv; sys.game.overlay.addText(at, String(dmg), 'dmg'); m.takeDamage(dmg, sys.player); } });
    },
    change_cart(sys) { const p = sys.player; p.extra.cartStyle = ((p.extra.cartStyle || 0) + 1) % 4; sys.game.cart.restyle(); say(sys.game, 'Your cart has a new look.'); },
    vending(sys, lv) { sys.game.cart.openVending(lv); },
    craft(sys, lv, t, s) { sys.game.crafting.open(s.craft, s.id, lv); },
  });
  // Acid Terror and Demonstration use their bottles, like the classics.
  G.Skills.get('acid_terror').catalyst = [['acid_bottle', 1]];
  G.Skills.get('demonstration').catalyst = [['bottle_grenade', 1]];
  G.Skills.get('potion_pitcher').catalyst = [['red_potion', 1]];
  G.Skills.get('magnus_exorcismus').catalyst = [['blue_gemstone', 1]];
  G.Skills.get('sanctuary').catalyst = [['blue_gemstone', 1]];
  G.Skills.get('asura_strike').needsBuff = 'fury';
  G.Skills.get('occult_impaction').spheres = 1;
  // Performances remember themselves for Encore.
  for (const id of ['poem_of_bragi', 'assassin_cross', 'whistle', 'apple_of_idun', 'humming', 'service_for_you', 'fortunes_kiss', 'dont_forget_me']) G.Skills.get(id).performance = true;

  /* ---------------- extra requirements for skills ---------------- */
  SS.extraCheck = (sys, s) => {
    const p = sys.player;
    if (s.catalyst && !(sys.buffs.into_abyss && /gemstone/.test(s.catalyst.map((c) => c[0]).join()))) for (const [id, n] of s.catalyst) if (p.inventory.count(id) < n) return `${s.name} needs ${n > 1 ? n + ' ' : 'a '}${G.Items.get(id).name}${n > 1 ? 's' : ''}.`;
    if (s.id === 'call_spirits' && (p.spheres || 0) >= Math.min(5, sys.useLevel ? sys.useLevel(s.id) : 5)) return `You already have ${p.spheres} spirit sphere${p.spheres === 1 ? '' : 's'}, the most you can hold.`;
    if (s.spheres && (p.spheres || 0) < s.spheres) return `${s.name} needs ${s.spheres} spirit sphere${s.spheres > 1 ? 's' : ''}.`;
    if (s.needsShield && !p.equipment.shield) return `${s.name} needs a shield.`;
    if (s.needsBuff && !sys.buffs[s.needsBuff]) return `${s.name} needs ${BUFFS[s.needsBuff].name} to be active.`;
    if (s.combo && !(p.combo && p.combo.stage === s.combo && sys.game.time < p.combo.until && p.combo.target && p.combo.target.alive))
      return s.combo === 'trifecta' ? `${s.name} can only be used right after Raging Trifecta Blow triggers.` : `${s.name} can only be used right after ${G.Skills.get(s.combo).name}.`;
    if (sys.buffs.steel_body && s.id !== 'steel_body') return 'You can\'t use skills during Mental Strength.';
    if (s.id === 'brandish_spear' && !p.riding) return 'Brandish Spear needs you to ride a Peco Peco.';
    if (s.id === 'blitz_beat' && !p.skills.level('falconry_mastery')) return 'Blitz Beat needs your falcon.';
    if ((s.id === 'cart_revolution' || s.id === 'vending') && !p.skills.level('pushcart')) return `${s.name} needs a Pushcart.`;
    return null;
  };
  SS.payExtra = (sys, s, lv) => {
    const p = sys.player;
    if (s.catalyst && !(sys.buffs.into_abyss && /gemstone/.test(s.catalyst.map((c) => c[0]).join()))) for (const [id, n] of s.catalyst) { let left = n; while (left > 0) { const e = p.inventory.firstOf(id); if (!e) break; left -= p.inventory.remove(e.uid, left); } }
    if (s.spheres) { p.spheres -= s.id === 'asura_strike' ? p.spheres : s.spheres; p.recalc(); }
    if (s.id === 'asura_strike' && sys.buffs.fury) { delete sys.buffs.fury; p.recalc(); }
    if (s.performance) sys.lastPerformance = { id: s.id, level: lv };
  };

  /* ---------------- the merchant's cart & vending ---------------- */
  class Cart {
    constructor(game) {
      this.game = game; this.mesh = null;
      this.win = game.windows.create('cart', 'Cart', { width: 400, keyHint: 'Alt+W', pos: () => ({ x: window.innerWidth / 2 - 200, y: 120 }) });
      this.win.render = () => this.render();
      this.vend = null;
    }
    get has() { const p = this.game.player; return p && p.skills.level('pushcart') > 0; }
    get items() { const p = this.game.player; return (p.extra.cart = p.extra.cart || []); }
    weight() { return this.items.reduce((w, e) => w + G.Items.get(e.id).weight * e.qty, 0); }
    toggle() { if (!this.has) { say(this.game, 'You need the Pushcart skill (Merchant) to use a cart.', 'warn'); return; } this.game.windows.toggle('cart'); this.render(); }
    put(uid, qty) {
      const inv = this.game.player.inventory, e = inv.find(uid); if (!e) return;
      const it = G.Items.get(e.id); qty = Math.min(qty, e.qty);
      if (this.weight() + it.weight * qty > 8000) { say(this.game, 'The cart is too heavy (8,000 max).', 'warn'); return; }
      const have = it.stack && this.items.find((x) => x.id === e.id);
      if (!have && this.items.length >= 100) { say(this.game, 'The cart is full.', 'warn'); return; }
      inv.remove(uid, qty);
      if (have) have.qty += qty; else this.items.push({ id: e.id, qty, cards: (e.cards || []).slice(), refine: e.refine || 0 });
      this.game.save.markDirty(); this.render();
    }
    take(i, qty) {
      const s = this.items[i]; if (!s) return;
      const n = Math.min(qty, s.qty), r = this.game.player.inventory.add(s.id, n, { cards: s.cards, refine: s.refine });
      if (!r.added) { say(this.game, 'You can\'t carry that.', 'warn'); return; }
      s.qty -= r.added; if (s.qty <= 0) this.items.splice(i, 1);
      this.game.save.markDirty(); this.render();
    }
    openVending(lv) {
      if (!this.game.map.town || Math.hypot(this.game.player.position.x - G.Config.TOWN.cx, this.game.player.position.z - G.Config.TOWN.cz) > G.Config.TOWN.radius + 4) { say(this.game, 'Open your stall inside a town.', 'warn'); return; }
      this.vend = { left: 2 + lv, x: this.game.player.position.x, z: this.game.player.position.z };
      this.game.windows.open('cart'); this.render();
      say(this.game, `Your stall is open: sell up to ${2 + lv} stacks from your cart at full price. Walking away closes it.`, 'level');
    }
    render() {
      if (!this.game.windows.isOpen('cart')) return;
      const h = G.h, b = this.win.body, p = this.game.player; b.textContent = '';
      const list = h('div.shop-list');
      list.append(h('p.hint', { text: this.vend ? `Vending: ${this.vend.left} sale${this.vend.left === 1 ? '' : 's'} left (full price).` : 'Put items in from your inventory below; take them out any time.' }));
      this.items.forEach((s, i) => {
        const it = G.Items.get(s.id), full = it.price * s.qty;
        const row = h('div.shop-row', null, h('img', { src: G.Icons.url(s.id), alt: '' }), h('span.sname2', null, G.Items.displayName(s), s.qty > 1 ? h('small', { text: ` ×${s.qty}` }) : null), h('span'),
          this.vend ? h('button.btn.small', { type: 'button', onclick: () => { p.zeny += full; this.items.splice(i, 1); this.vend.left--; this.game.sfx('zeny'); say(this.game, `Sold ${it.name} ×${s.qty} for ${full.toLocaleString()} z.`, 'loot'); if (this.vend.left <= 0) { this.vend = null; say(this.game, 'Your stall sold out.'); } this.render(); } }, `Sell ${full.toLocaleString()} z`)
            : h('span'),
          h('button.btn.small.ghost', { type: 'button', onclick: () => this.take(i, s.qty) }, 'Take'));
        G.Tooltip.bind(row, () => G.itemTooltip(s, p)); list.append(row);
      });
      list.append(h('p.hint', { text: 'Your inventory:' }));
      for (const e of p.inventory.items) list.append(h('div.shop-row', null, h('img', { src: G.Icons.url(e.id), alt: '' }), h('span.sname2', null, G.Items.displayName(e), e.qty > 1 ? h('small', { text: ` ×${e.qty}` }) : null), h('span'), h('span'),
        h('button.btn.small.ghost', { type: 'button', onclick: () => this.put(e.uid, e.qty) }, 'Put in')));
      b.append(list, h('div.inv-foot.shop-foot', null, h('span.hint', { text: `${this.items.length} / 100 kinds` }), h('span.hint', { text: `Cart weight ${Math.round(this.weight())} / 8000` })));
    }
    restyle() { if (this.mesh) { this.mesh.parent && this.mesh.parent.remove(this.mesh); this.mesh = null; } }
    build() {
      this.mesh = Cart.mesh(this.game.player.extra.cartStyle || 0);
      this.game.mapRoot.add(this.mesh);
    }
    static mesh(style) {
      const cols = [['#8a5a2c', '#c9a06b'], ['#3a5aa8', '#ffd84a'], ['#c0394a', '#f2e6cc'], ['#2f7a3a', '#e6c25a']][style];
      const g = new THREE.Group(), wood = new THREE.MeshStandardMaterial({ color: cols[0], roughness: 0.8 }), trim = new THREE.MeshStandardMaterial({ color: cols[1], roughness: 0.6 });
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 1.1), wood); box.position.y = 0.55;
      const rim = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.08, 1.18), trim); rim.position.y = 0.82;
      const load = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#f2e6cc', roughness: 0.9 })); load.position.y = 0.82;
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.1, 6), trim); handle.rotation.x = Math.PI / 2.6; handle.position.set(0, 0.75, 0.85);
      for (const sx of [-0.5, 0.5]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.08, 14), trim); w.rotation.z = Math.PI / 2; w.position.set(sx, 0.3, 0); g.add(w); }
      g.add(box, rim, load, handle);
      g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      return g;
    }
    // Trail a cart behind whoever pulls it.
    static follow(m, who, dt) {
      const back = 1.5, f = who.facing, tx = who.position.x - Math.sin(f) * back, tz = who.position.z - Math.cos(f) * back, k = Math.min(1, dt * 8);
      m.position.x += (tx - m.position.x) * k; m.position.z += (tz - m.position.z) * k;
      m.position.y = G.Terrain.surfaceHeight(m.position.x, m.position.z);
      m.rotation.y = Math.atan2(who.position.x - m.position.x, who.position.z - m.position.z);
    }
    update(dt) {
      const p = this.game.player;
      if (!p) return;
      if (this.vend && Math.hypot(p.position.x - this.vend.x, p.position.z - this.vend.z) > 2) { this.vend = null; say(this.game, 'You closed your stall.'); this.render(); }
      if (!this.has) { if (this.mesh) this.restyle(); return; }
      if (!this.mesh || !this.mesh.parent) this.build();
      Cart.follow(this.mesh, p, dt);
    }
  }
  G.Cart = Cart;

  /* ---------------- crafting: forging, tempering, stones, brewing ---------------- */
  const FORGE = {
    dagger: [['knife', [['iron', 1]], 1], ['cutter', [['iron', 2]], 1]],
    sword: [['sword', [['iron', 2], ['steel', 1]], 1]],
    twohand: [['slayer', [['steel', 3]], 2], ['claymore', [['steel', 5], ['oridecon', 1]], 3]],
    axe: [['axe', [['iron', 3]], 1], ['battle_axe', [['steel', 4], ['oridecon', 1]], 3]],
    mace: [['club', [['iron', 2]], 1]],
    knuckle: [['waghnak', [['iron', 2]], 1], ['knuckle_duster', [['steel', 2]], 2]],
    spear: [['pike', [['iron', 2], ['steel', 1]], 2], ['lance', [['steel', 4], ['oridecon', 1]], 3]],
  };
  const RECIPES = {
    tempering: [{ skill: 'iron_tempering', makes: 'iron', needs: [['iron_ore', 2]], base: 40, per: 5 }, { skill: 'steel_tempering', makes: 'steel', needs: [['iron', 5], ['coal', 1]], base: 30, per: 5 }],
    stones: [['flame_heart', 'ember'], ['mystic_frozen', 'spore_cap'], ['rough_wind', 'ectoplasm'], ['great_nature', 'grasshopper_leg']].map(([m, from]) => ({ skill: 'enchanted_stone_craft', makes: m, needs: [[from, 10]], base: 10, per: 5 })),
    potion: [
      { makes: 'red_potion', needs: [['carrot', 1], ['empty_bottle', 1]], base: 55 }, { makes: 'orange_potion', needs: [['apple', 1], ['carrot', 1], ['empty_bottle', 1]], base: 45 },
      { makes: 'blue_potion', needs: [['spore_cap', 2], ['empty_bottle', 1]], base: 35 }, { makes: 'acid_bottle', needs: [['sticky_mucus', 1], ['empty_bottle', 1]], base: 50 },
      { makes: 'bottle_grenade', needs: [['ember', 1], ['empty_bottle', 1]], base: 50 },
    ].map((r) => Object.assign({ skill: 'prepare_potion', per: 2 }, r)),
    converter: [['fire_converter', 'flame_heart'], ['water_converter', 'mystic_frozen'], ['wind_converter', 'rough_wind'], ['earth_converter', 'great_nature']]
      .map(([m, s]) => ({ skill: 'create_converter', makes: m, qty: 3, needs: [[s, 1], ['blue_gemstone', 1]], base: 100, per: 0 })),
  };
  class Crafting {
    constructor(game) {
      this.game = game;
      this.win = game.windows.create('craft', 'Crafting', { width: 430, pos: () => ({ x: window.innerWidth / 2 - 215, y: 110 }) });
      this.win.render = () => this.render();
      this.element = '';
    }
    open(kind, skillId, lv) { this.kind = kind; this.skillId = skillId; this.lv = lv; this.game.windows.open('craft'); this.render(); }
    recipes() {
      if (this.kind.startsWith('forge:')) {
        const wt = this.kind.slice(6);
        return FORGE[wt].map(([makes, needs, wlv]) => ({ skill: this.skillId, makes, needs, wlv, forge: true, base: 50 - 10 * (wlv - 1), per: 10 }));
      }
      return RECIPES[this.kind] || [];
    }
    chance(r) {
      const p = this.game.player, D = p.derived, sk = p.skills;
      let c = r.base + (r.per || 0) * (sk.level(r.skill) || this.lv || 0) + D.total.dex * 0.1 + D.total.luk * 0.1 + p.jobLevel * 0.2;
      if (r.forge) { c += (D.forgeBonus || 0) + (r.wlv >= 3 ? sk.level('oridecon_research') : 0); if (this.element) c -= 20; }
      if (this.kind === 'potion') c += (D.potionBonus || 0);
      return Math.max(1, Math.min(100, Math.round(c)));
    }
    make(r) {
      const p = this.game.player, inv = p.inventory;
      const needs = r.needs.concat(r.forge && this.element ? [[this.element, 1]] : []);
      for (const [id, n] of needs) if (inv.count(id) < n) { say(this.game, `You need ${n} ${G.Items.get(id).name}.`, 'warn'); return; }
      for (const [id, n] of needs) { let left = n; while (left > 0) { const e = inv.firstOf(id); if (!e) break; left -= inv.remove(e.uid, left); } }
      if (Math.random() * 100 < this.chance(r)) {
        if (r.forge) {
          inv.add(r.makes, 1);
          const e = inv.items[inv.items.length - 1];
          e.forgedBy = p.name; e.cards = [];
          if (this.element) e.element = { flame_heart: 'fire', mystic_frozen: 'water', rough_wind: 'wind', great_nature: 'earth' }[this.element];
          inv.changed();
          say(this.game, `You forged ${G.Items.displayName(e)}!`, 'level');
        } else { inv.add(r.makes, r.qty || 1); say(this.game, `Made ${G.Items.get(r.makes).name}${(r.qty || 1) > 1 ? ' ×' + r.qty : ''}.`, 'loot'); }
        this.game.sfx('levelup'); this.game.effects.levelUp(p);
      } else { say(this.game, 'It didn\'t work out… the materials are lost.', 'warn'); this.game.sfx('miss'); }
      this.render();
    }
    render() {
      if (!this.game.windows.isOpen('craft')) return;
      const h = G.h, b = this.win.body, p = this.game.player; b.textContent = '';
      const isForge = this.kind.startsWith('forge:');
      this.win.head.firstChild.textContent = isForge ? 'Forge' : this.kind === 'potion' ? 'Prepare Potion' : 'Crafting';
      const list = h('div.shop-list');
      for (const r of this.recipes()) {
        const it = G.Items.get(r.makes), need = r.needs.map(([id, n]) => `${n} ${G.Items.get(id).name} (${p.inventory.count(id)})`).join(', ');
        const row = h('div.refine-row', null, h('img', { src: G.Icons.url(r.makes), alt: '' }),
          h('div.rinfo', null, h('span.sname2', { text: it.name + ((r.qty || 1) > 1 ? ` ×${r.qty}` : '') }), h('small', { text: need })),
          h('span.rchance' + (this.chance(r) >= 80 ? '.safe' : this.chance(r) >= 40 ? '.mid' : '.low'), { text: this.chance(r) + '%' }),
          h('button.btn.small', { type: 'button', onclick: () => this.make(r) }, isForge ? 'Forge' : 'Make'));
        G.Tooltip.bind(row, () => G.itemTooltip({ id: r.makes, qty: 1 }, p));
        list.append(row);
      }
      const extra = [];
      if (isForge) {
        const sel = h('select', { 'aria-label': 'Elemental stone', onchange: (e) => { this.element = e.target.value; this.render(); } },
          h('option', { value: '', text: 'No elemental stone' }),
          ...['flame_heart', 'mystic_frozen', 'rough_wind', 'great_nature'].map((id) => h('option', { value: id, text: `${G.Items.get(id).name} (${p.inventory.count(id)})`, selected: this.element === id })));
        extra.push(h('label.opt', null, h('span', { text: 'Add element' }), sel), h('p.hint', { text: 'Forged weapons carry your name. An elemental stone gives the weapon that element but lowers the chance by 20%.' }));
      }
      b.append(list, ...extra);
    }
  }
  G.Crafting = Crafting;

  /* ---------------- per-frame extras on the player ---------------- */
  G.SkillsX = {
    update(game, dt) {
      const p = game.player, sys = p.skills, D = p.derived;
      if (!p.alive) return;
      // Spirit spheres orbit the monk.
      game.fields.update(dt);
      game.cart.update(dt);
      if (p.spheres > 0) {
        this.orbT = (this.orbT || 0) + dt;
        if (this.orbT > 0.05) {
          this.orbT = 0;
          for (let i = 0; i < p.spheres; i++) {
            const a = game.time * 2 + (i / p.spheres) * Math.PI * 2;
            game.effects.sparks.emit(p.position.x + Math.cos(a) * 0.9, p.position.y + 1.4, p.position.z + Math.sin(a) * 0.9, { color: [0.6, 0.85, 1], size: 0.22, life: 0.12 });
          }
        }
      }
      // Moving HP recovery, Spiritual Cadence, Magnificat, Maximize Power drain, Sight Blaster.
      this.regT = (this.regT || 0) + dt;
      if (this.regT >= 1) {
        this.regT = 0;
        if (D.movingRegen && p.moving && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + Math.max(1, Math.round(p.maxHp * 0.005)));
        if (D.cadence && !p.moving && !p.target) { p.hp = Math.min(p.maxHp, p.hp + 0.4 * D.cadence); p.sp = Math.min(p.maxSp, p.sp + 0.2 * D.cadence); }
        if (D.spRegenMult > 1 && p.sp < p.maxSp) p.sp = Math.min(p.maxSp, p.sp + Math.max(1, Math.round(p.maxSp * 0.01)));
        if (sys.buffs.maximize_power) { p.sp -= 1; if (p.sp <= 0) { p.sp = 0; delete sys.buffs.maximize_power; p.recalc(); } }
      }
      // Ruwach: two holy lights circle the player and reveal hidden things nearby.
      if (sys.buffs.ruwach) {
        if (!this.ruwach) {
          const tex = game.effects.sparks.uniforms.map.value;
          this.ruwach = [0, 1].map(() => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: '#fff2a0', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })); sp.scale.set(0.7, 0.7, 1); game.scene.add(sp); return sp; });
        }
        this.ruwach.forEach((sp, i) => {
          const a = game.time * 4 + i * Math.PI;
          sp.position.set(p.position.x + Math.cos(a) * 1.3, p.position.y + 1.2 + Math.sin(game.time * 3 + i) * 0.25, p.position.z + Math.sin(a) * 1.3);
          if (Math.random() < 0.6) game.effects.sparks.emit(sp.position.x, sp.position.y, sp.position.z, { color: [1, 0.95, 0.6], size: 0.18, life: 0.35 });
        });
        for (const m of near(game, p.position, 3)) if (m.hidden) {
          m.hidden = false; if (m.sprite.setOpacity) m.sprite.setOpacity(1);
          const at = m.position.clone(); at.y += m.def.height; game.overlay.addText(at, 'Revealed!', 'debuff');
          C().magic(p, m, { mult: 1.45, element: 'holy' });
        }
      } else if (this.ruwach) { for (const sp of this.ruwach) { sp.parent && sp.parent.remove(sp); sp.material.dispose(); } this.ruwach = null; }

      if (sys.buffs.sight_blaster) {
        const m = near(game, p.position, 2.2)[0];
        if (m) { delete sys.buffs.sight_blaster; p.recalc(); C().magic(p, m, { mult: 1, element: 'fire' }); m.knockback(p.position.x, p.position.z, 3); game.spells.ring(p.position, '#ffb347', 2.2); }
      }
      // Sage zones: recalc as you step in or out.
      const inZone = ['volcano', 'deluge', 'whirlwind'].map((k) => (game.fields.playerInside(k) ? k : '')).join();
      if (inZone !== this.zoneKey) { this.zoneKey = inZone; p.recalc(); }
      if (p.combo && game.time > p.combo.until) p.combo = null;
    },
    // Stats contributed by these systems (registered as a stats source).
    bonuses(p) {
      const out = {}, game = p.game;
      if (p.spheres) out.atk = 3 * p.spheres;
      if (p.riding) out.aspd = -50 + 10 * (p.skills.level('cavalier_mastery') || p.skills.level('cr_cavalier_mastery') || 0);
      if (p.skills.buffs.auto_berserk && p.hp < p.maxHp * 0.25) out.atkPct = 32;
      if (game && game.fields) for (const f of game.fields.list) {
        if (Math.hypot(p.position.x - f.x, p.position.z - f.z) > f.r) continue;
        if (f.kind === 'volcano') out.atk = (out.atk || 0) + 5 + 5 * f.level;
        if (f.kind === 'deluge') out.maxHpPct = (out.maxHpPct || 0) + [5, 9, 12, 14, 15][f.level - 1];
        if (f.kind === 'whirlwind') out.flee = (out.flee || 0) + 3 * f.level;
      }
      const w = p.equipment.weapon;
      if (w && w.element) out.forgedElement = w.element;
      return out;
    },
  };
})(window.G = window.G || {});

/* Combat reactions for defensive skills (hooks called from G.Combat.monsterAttack). */
(function (G) {
  'use strict';
  const Combat = G.Combat, SS = G.SkillSystem;
  Combat.preHit = (player, mon) => {
    const sys = player.skills, game = player.game;
    // Ranged monster attacks can't reach a player inside Pneuma.
    if (mon.def.ranged && game.fields.protecting('pneuma')) return 'Pneuma';
    const wall = game.fields.protecting('safety_wall');
    if (wall) { if (--wall.hits <= 0) game.fields.remove(wall); return 'Safety Wall'; }
    if (sys.buffs.auto_counter) {
      delete sys.buffs.auto_counter; player.recalc();
      Combat.physical(player, mon, { mult: 2, noMiss: true, hitBonus: 100 });
      return 'Counter!';
    }
    if (sys.buffs.blade_stop) {
      delete sys.buffs.blade_stop; player.recalc();
      mon.addStatus('rooted', 3); mon.addStatus('stunned', 2);
      return 'Caught!';
    }
    return null;
  };
  Combat.modHit = (player, mon, dmg) => {
    const sys = player.skills;
    if (sys.buffs.energy_coat && player.sp > 0) {
      const k = 0.06 + 0.24 * (player.sp / player.maxSp);
      player.sp = Math.max(0, player.sp - Math.max(1, Math.round(player.maxSp * 0.01)));
      dmg = Math.max(1, Math.round(dmg * (1 - k)));
    }
    return dmg;
  };
  Combat.postHit = (player, mon, dmg) => {
    const sys = player.skills;
    if (sys.buffs.reflect_shield && mon.alive) {
      const r = Math.max(1, Math.round(dmg * (10 + 3 * sys.buffs.reflect_shield.level) / 100));
      const at = mon.position.clone(); at.y += mon.def.height * 0.6;
      player.game.overlay.addText(at, String(r), 'dmg'); mon.takeDamage(r, player);
    }
    if (sys.buffs.poison_react && mon.alive && Math.random() < 0.5) {
      Combat.physical(player, mon, { mult: 1 + 0.3 * sys.buffs.poison_react.level, element: 'poison' });
      if (mon.alive && !mon.status.poisoned) mon.addStatus('poisoned', 10, { dps: Math.max(2, Math.round(player.derived.statusAtk / 6)) });
    }
  };
  // Fatal Blow: Bash level 6+ can stun.
  const bash = SS.EFFECTS.bash;
  SS.EFFECTS.bash = (sys, lv, t, s) => {
    bash(sys, lv, t, s);
    if (t.alive && lv > 5 && sys.player.derived.extra.fatalBlow && Math.random() < (lv - 5) * 0.05) { t.addStatus('stunned', 3); const at = t.position.clone(); at.y += t.def.height; sys.game.overlay.addText(at, 'Stunned', 'debuff'); }
  };
  // A Trifecta proc opens the combo window for Raging Quadruple Blow.
  const pa = Combat.playerAttack;
  Combat.playerAttack = (player, mon) => {
    const before = player.game.overlay.texts ? player.game.overlay.texts.length : 0;
    const r = Math.random;
    let proc = false;
    Math.random = () => { const v = r(); return v; };
    const D = player.derived;
    if (D.tripleAttack) {
      const orig = player.game.overlay.addText.bind(player.game.overlay);
      player.game.overlay.addText = (a, txt, k) => { if (txt === 'Trifecta!') proc = true; return orig(a, txt, k); };
      pa(player, mon);
      player.game.overlay.addText = orig;
    } else pa(player, mon);
    Math.random = r;
    if (proc) player.combo = { stage: 'trifecta', until: player.game.time + 1.3, target: mon };
    // Hindsight: a chance to cast a free bolt.
    const as = player.skills.buffs.auto_spell;
    if (as && mon.alive && Math.random() * 100 < Math.min(14, 5 + as.level)) {
      const id = ['fire_bolt', 'cold_bolt', 'lightning_bolt'][(Math.random() * 3) | 0];
      const s = G.Skills.get(id); if (SS.EFFECTS[id]) SS.EFFECTS[id](player.skills, Math.ceil(as.level / 2), mon, s);
    }
    return before;
  };
})(window.G = window.G || {});
