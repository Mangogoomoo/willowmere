/* Quests: Stage 3 uses this for the job-change trials. A trial is stored in
   player.extra.trial so it saves with the character. Kinds:
     kill   defeat N monsters of a type
     items  bring items (taken when you turn in)
     visit  reach a place
     pay    pay Zeny (and bring items)
   Stage 4 builds the general quest log on the same foundation. */
(function (G) {
  'use strict';

  class Quests {
    constructor(game) {
      this.game = game;
      game.events.on('monsterKilled', (m) => {
        const t = this.trial;
        if (!t) return;
        const def = G.Jobs.get(t.job).trial;
        if (def.kind === 'kill' && m.type === def.target && t.progress < def.count) {
          t.progress++;
          game.log.add(`Trial: ${m.name} ${t.progress}/${def.count}.`, t.progress >= def.count ? 'level' : 'info');
          if (t.progress >= def.count) game.hud.toast('Trial complete! Return to Master Rowan in Willowmere.');
          this.changed();
        }
      });
    }

    get trial() { const p = this.game.player; return p && p.extra.trial || null; }

    start(jobId) {
      this.game.player.extra.trial = { job: jobId, progress: 0 };
      this.game.log.add(`Trial accepted: ${G.Jobs.get(jobId).trial.text}`, 'system');
      this.changed();
    }
    abandon() { delete this.game.player.extra.trial; this.changed(); }

    /* { complete, progress (text), lines [{label, have, need}], done (text) } */
    status() {
      const t = this.trial, p = this.game.player;
      if (!t) return null;
      const def = G.Jobs.get(t.job).trial;
      const lines = [];
      if (def.kind === 'kill') lines.push({ label: `Defeat ${G.Config.MONSTERS[def.target].name}s`, have: t.progress, need: def.count });
      if (def.kind === 'visit') lines.push({ label: `Pray at ${def.place}`, have: t.progress ? 1 : 0, need: 1 });
      if (def.kind === 'pray') lines.push({ label: 'Pray with Sister Lune', have: t.progress ? 1 : 0, need: 1 });
      if (def.zeny) lines.push({ label: 'Zeny for the guild fee', have: Math.min(p.zeny, def.zeny), need: def.zeny });
      for (const [id, n] of def.items || []) lines.push({ label: G.Items.get(id).name, have: Math.min(p.inventory.count(id), n), need: n });
      const complete = lines.every((l) => l.have >= l.need);
      return {
        complete, lines,
        progress: lines.map((l) => `${l.label}: ${l.have} of ${l.need}`).join('\n'),
        done: def.kind === 'kill' ? `The ${G.Config.MONSTERS[def.target].name}s will speak of your courage.` : (def.kind === 'visit' || def.kind === 'pray') ? 'I can feel the pond’s blessing on you.' : 'Everything is here, just as I asked.',
      };
    }

    complete() {
      const t = this.trial, p = this.game.player;
      const def = G.Jobs.get(t.job).trial;
      if (def.zeny) p.zeny -= def.zeny;
      for (const [id, n] of def.items || []) {
        let left = n;
        while (left > 0) { const e = p.inventory.firstOf(id); if (!e) break; left -= p.inventory.remove(e.uid, left); }
      }
      delete p.extra.trial;
      this.changed();
    }

    changed() { this.game.events.emit('questsChanged'); this.game.save.markDirty(); }

    // Where the current objective is, for the tracker arrow (or null).
    target() {
      const t = this.trial;
      if (!t || t.progress) return null;
      const def = G.Jobs.get(t.job).trial;
      if (def.kind === 'visit') return { x: def.x, z: def.z, map: 'meadow' };
      if (def.kind === 'pray') {
        const d = G.NPC_DEFS.find((n) => n.id === def.npc);
        return { x: d.x, z: d.z, map: def.map };
      }
      return null;
    }

    // Called by Sister Lune when the pilgrim prays with her.
    prayed() {
      const t = this.trial;
      if (!t || t.progress) return;
      t.progress = 1;
      this.game.effects.levelUp(this.game.player);
      this.game.log.add('You kneel beside Sister Lune and pray. The trial is complete.', 'level');
      this.game.hud.toast('Trial complete! Return to Master Rowan in Willowmere.');
      this.changed();
    }

    // A tall pillar of light marking a pilgrimage destination.
    beacon(target) {
      if (!target) { if (this.beaconMesh) { this.beaconMesh.visible = false; } return; }
      if (!this.beaconMesh) {
        const c = G.Utils.makeCanvas(4, 128), x = c.getContext('2d');
        const g = x.createLinearGradient(0, 0, 0, 128);
        g.addColorStop(0, 'rgba(255,240,170,0)'); g.addColorStop(0.6, 'rgba(255,236,150,0.45)'); g.addColorStop(1, 'rgba(255,250,215,0.9)');
        x.fillStyle = g; x.fillRect(0, 0, 4, 128);
        const geo = new THREE.CylinderGeometry(1.1, 1.6, 40, 16, 1, true); geo.translate(0, 20, 0);
        this.beaconMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: false }));
        this.beaconMesh.renderOrder = 4;
        this.game.scene.add(this.beaconMesh);
      }
      this.beaconMesh.visible = true;
      this.beaconMesh.position.set(target.x, G.Config.WATER_LEVEL, target.z);
    }

    update(dt) {
      const tgt0 = this.target();
      const tgt = tgt0 && (!tgt0.map || tgt0.map === this.game.mapId) ? tgt0 : null;
      this.beacon(tgt);
      if (this.beaconMesh && this.beaconMesh.visible) {
        this.beaconMesh.rotation.y += dt * 0.6;
        // Bright from afar, fades away as you arrive so it never hides the NPC.
        const p = this.game.player.position;
        const d = Math.hypot(p.x - tgt.x, p.z - tgt.z);
        const k = G.Utils.clamp((d - 9) / 22, 0, 1);
        this.beaconMesh.material.opacity = k;
        this.beaconMesh.visible = k > 0.02;
      }
      const t = this.trial;
      if (!t || t.progress) return;
      const def = G.Jobs.get(t.job).trial;
      if (def.kind !== 'visit') return;
      const p = this.game.player.position;
      if (Math.hypot(p.x - def.x, p.z - def.z) < def.r) {
        t.progress = 1;
        this.game.effects.levelUp(this.game.player);
        this.game.log.add(`You kneel at ${def.place} and pray. The trial is complete.`, 'level');
        this.game.hud.toast('Trial complete! Return to Master Rowan in Willowmere.');
        this.changed();
      }
    }
  }

  G.Quests = Quests;
})(window.G = window.G || {});
