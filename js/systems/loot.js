/* Loot: rolls a monster's drop table when it dies, throws the items onto the
   ground with a little arc, and lets the player click to walk over and pick
   them up. Items lie for two minutes before vanishing. */
(function (G) {
  'use strict';
  const TR = G.Terrain, U = G.Utils;
  const LIFETIME = 120;
  const _oc = new THREE.Vector3();

  class LootSystem {
    constructor(game) {
      this.game = game;
      this.items = [];
      this.mats = {};
    }

    material(id) {
      if (!this.mats[id]) {
        this.mats[id] = new THREE.SpriteMaterial({ map: G.Icons.texture(id), transparent: true, alphaTest: 0.2, toneMapped: false, depthWrite: true });
      }
      return this.mats[id];
    }

    /* Independent roll per entry, like classic drop tables. Chances are
       fractions (0.7 = 70%). Rare items get a sparkle so they stand out. */
    rollDrops(monster) {
      const d = monster.def, p = monster.position, auto = !!this.game.autoLoot;
      for (const drop of d.drops || []) {
        if (Math.random() < drop.chance) this.spawn(drop.id, drop.qty || 1, p.x, p.z, auto);
      }
      if (d.zeny && Math.random() < d.zeny.chance) {
        this.spawn('zeny', U.randInt(Math.random, d.zeny.min, d.zeny.max), p.x, p.z, auto);
      }
    }

    spawn(id, qty, x, z, auto) {
      // Find a walkable landing spot near the corpse.
      let tx = x, tz = z;
      for (let i = 0; i < 8; i++) {
        const a = Math.random() * Math.PI * 2, r = 0.5 + Math.random() * 1.1;
        const nx = x + Math.cos(a) * r, nz = z + Math.sin(a) * r;
        if (this.game.nav.walkable(nx, nz)) { tx = nx; tz = nz; break; }
      }
      const sprite = new THREE.Sprite(this.material(id));
      sprite.center.set(0.5, 0.1);
      sprite.scale.set(0.62, 0.62, 1);
      sprite.renderOrder = 2;
      this.game.scene.add(sprite);
      const shadow = this.game.effects.makeShadow(0.5);
      const item = id === 'zeny' ? null : G.Items.get(id);
      const rare = item && (item.rarity === 'rare' || item.rarity === 'epic');
      const loot = {
        id, qty, sprite, shadow, rare, item,
        from: { x, y: TR.surfaceHeight(x, z) + 0.8, z },
        x: tx, z: tz, y: TR.surfaceHeight(tx, tz),
        t: 0, age: 0, phase: Math.random() * 6, auto: !!auto, fly: 0,
        name: id === 'zeny' ? `${qty} Zeny` : (qty > 1 ? `${item.name} ×${qty}` : item.name),
      };
      this.items.push(loot);
      return loot;
    }

    remove(loot) {
      const i = this.items.indexOf(loot);
      if (i >= 0) this.items.splice(i, 1);
      this.game.scene.remove(loot.sprite);
      this.game.scene.remove(loot.shadow);
      if (this.game.player.pendingLoot === loot) this.game.player.pendingLoot = null;
    }

    clear() { for (const l of this.items.slice()) this.remove(l); }

    /* Returns true if the loot was taken. */
    pickUp(loot) {
      const player = this.game.player, log = this.game.log;
      if (loot.id === 'zeny') {
        player.zeny += loot.qty;
        log.add(`Picked up ${loot.qty} Zeny.`, 'loot');
        this.game.overlay.addText(player.position, `+${loot.qty} z`, 'zeny');
      } else {
        const r = player.inventory.add(loot.id, loot.qty);
        if (!r.added) {
          log.add(r.reason === 'weight' ? 'You’re carrying too much to pick that up.' : 'Your inventory is full.', 'warn');
          return false;
        }
        log.add(`Picked up ${loot.name}.`, loot.rare ? 'rare' : 'loot');
      }
      this.game.effects.sparkle({ x: loot.x, y: loot.y - 0.4, z: loot.z }, [1, 0.95, 0.6], 8);
      this.remove(loot);
      this.game.save.markDirty();
      return true;
    }

    pick(ray, maxT) {
      let best = null, bestT = maxT == null ? Infinity : maxT;
      for (const l of this.items) {
        if (l.t < 1) continue;
        _oc.set(l.x, l.y + 0.3, l.z).sub(ray.origin);
        const tca = _oc.dot(ray.direction);
        if (tca < 0) continue;
        const d2 = _oc.lengthSq() - tca * tca, r = 0.55;
        if (d2 > r * r) continue;
        const t = tca - Math.sqrt(r * r - d2);
        if (t < bestT) { bestT = t; best = l; }
      }
      return best;
    }

    update(dt, time) {
      for (let i = this.items.length - 1; i >= 0; i--) {
        const l = this.items[i];
        l.age += dt;
        if (l.age > LIFETIME) { this.remove(l); continue; }
        let x = l.x, y = l.y, z = l.z;
        // Auto-loot: once it lands, the item flies to the player.
        if (l.auto && l.t >= 1 && l.age > 0.55) {
          const pl = this.game.player;
          l.fly = Math.min(1, l.fly + dt / 0.28);
          const k = l.fly * l.fly;
          x = U.lerp(l.x, pl.position.x, k); z = U.lerp(l.z, pl.position.z, k);
          y = U.lerp(l.y, pl.position.y + 1, k) + Math.sin(l.fly * Math.PI) * 0.8;
          l.sprite.position.set(x, y, z);
          if (l.fly >= 1 && !this.pickUp(l)) { l.auto = false; l.fly = 0; }
          continue;
        }
        if (l.t < 1) {
          // Thrown out of the monster in a short arc.
          l.t = Math.min(1, l.t + dt / 0.45);
          const k = l.t;
          x = U.lerp(l.from.x, l.x, k); z = U.lerp(l.from.z, l.z, k);
          y = U.lerp(l.from.y, l.y, k) + Math.sin(k * Math.PI) * 1.2;
        } else {
          y += 0.06 + Math.sin(time * 3 + l.phase) * 0.05;
        }
        l.sprite.position.set(x, y, z);
        l.shadow.position.set(l.x, l.y + 0.03, l.z);
        l.shadow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), TR.normalAt(l.x, l.z));
        // Fade out during the last few seconds.
        const fade = U.clamp((LIFETIME - l.age) / 4, 0, 1);
        l.sprite.visible = fade > 0.02 && (fade > 0.5 || Math.sin(time * 18) > 0);
        if (l.rare && l.t >= 1 && Math.random() < dt * 6) {
          this.game.effects.sparks.emit(l.x + (Math.random() - 0.5) * 0.5, l.y + 0.2 + Math.random() * 0.5, l.z + (Math.random() - 0.5) * 0.5,
            { color: [0.6, 0.85, 1], size: 0.14, vy: 0.6, life: 0.8 });
        }
      }
    }
  }

  G.LootSystem = LootSystem;
})(window.G = window.G || {});
