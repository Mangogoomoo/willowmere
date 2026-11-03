/* NPCs: townsfolk drawn with the same sprite system as players. Click one
   to walk over and talk; their behaviour lives in a dialog script
   (data/npcs.js). */
(function (G) {
  'use strict';
  const U = G.Utils;
  const _oc = new THREE.Vector3();

  class NPC extends G.Entity {
    constructor(game, d) {
      super(game, G.SpriteFactory.humanoid(d.appearance, { job: d.costume, weapon: 'none', unarmed: true }), { shadowSize: 1.15, radius: 0.5 });
      this.id = d.id;
      this.name = d.name;
      this.title = d.title || '';
      this.script = d.script;
      this.def = { radius: 0.55, height: 2.4, hitRadius: 0.7 };
      this.homeFacing = d.facing || 0;
      this.targetFacing = this.facing = this.homeFacing;
      this.setPosition(d.x, d.z);
      game.nav.blockCircle(d.x, d.z, 0.3);
      this.talking = false;
    }

    update(dt) {
      const p = this.game.player;
      if (this.talking && p) this.faceTowards(p.position.x, p.position.z);
      else this.targetFacing = this.homeFacing;
      this.sprite.play('idle');
    }
  }

  class NPCManager {
    constructor(game, ids) {
      this.game = game;
      this.list = G.NPC_DEFS.filter((d) => ids.includes(d.id)).map((d) => new NPC(game, d));
    }
    dispose() { for (const n of this.list) n.dispose(); this.list = []; }
    update(dt, camPos) {
      for (const n of this.list) { n.update(dt); n.syncVisuals(dt, camPos); }
    }
    pick(ray, maxT) {
      let best = null, bestT = maxT == null ? Infinity : maxT;
      for (const n of this.list) {
        _oc.set(n.position.x, n.position.y + 1.1, n.position.z).sub(ray.origin);
        const tca = _oc.dot(ray.direction);
        if (tca < 0) continue;
        const d2 = _oc.lengthSq() - tca * tca, r = 0.85;
        if (d2 > r * r) continue;
        const t = tca - Math.sqrt(r * r - d2);
        if (t < bestT) { bestT = t; best = n; }
      }
      return best;
    }
  }

  G.NPC = NPC;
  G.NPCManager = NPCManager;
})(window.G = window.G || {});
