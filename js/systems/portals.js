/* Portals: swirling warp gates. Walk into one to travel to another map. */
(function (G) {
  'use strict';
  const U = G.Utils;

  function swirlTexture() {
    const s = 256, c = U.makeCanvas(s, s), x = c.getContext('2d');
    x.translate(s / 2, s / 2);
    const g = x.createRadialGradient(0, 0, 10, 0, 0, 124);
    g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.35, 'rgba(140,210,255,0.75)');
    g.addColorStop(0.8, 'rgba(70,130,255,0.35)'); g.addColorStop(1, 'rgba(70,130,255,0)');
    x.fillStyle = g; x.beginPath(); x.arc(0, 0, 124, 0, Math.PI * 2); x.fill();
    x.strokeStyle = 'rgba(255,255,255,0.8)'; x.lineWidth = 6;
    for (let i = 0; i < 4; i++) {
      x.beginPath();
      for (let t = 0; t < 1; t += 0.02) { const a = i * Math.PI / 2 + t * 4, r = 20 + t * 96; x.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      x.stroke();
    }
    const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding;
    return tex;
  }
  let TEX = null;

  class Portals {
    constructor(game, list) {
      this.game = game;
      this.cooldown = 1.5;
      if (!TEX) TEX = swirlTexture();
      this.list = list.map((def) => {
        const geo = new THREE.PlaneGeometry(3.4, 3.4); geo.rotateX(-Math.PI / 2);
        const mat = new THREE.MeshBasicMaterial({ map: TEX, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
        const disc = new THREE.Mesh(geo, mat);
        const y = G.Terrain.surfaceHeight(def.x, def.z) + 0.08;
        disc.position.set(def.x, y, def.z);
        disc.renderOrder = 1;
        game.scene.add(disc);
        return { def, disc, y };
      });
    }

    dispose() {
      for (const p of this.list) { this.game.scene.remove(p.disc); p.disc.geometry.dispose(); p.disc.material.dispose(); }
      this.list = [];
    }

    update(dt, time) {
      const game = this.game, pl = game.player;
      if (this.cooldown > 0) this.cooldown -= dt;
      for (const p of this.list) {
        p.disc.rotation.y = time * 1.6;
        const k = 1 + Math.sin(time * 3) * 0.05;
        p.disc.scale.set(k, 1, k);
        if (Math.random() < dt * 30) {
          const a = Math.random() * Math.PI * 2, r = Math.random() * 1.4;
          game.effects.sparks.emit(p.def.x + Math.cos(a) * r, p.y + 0.1, p.def.z + Math.sin(a) * r,
            { color: [0.6, 0.85, 1], size: 0.18, vy: 1.2 + Math.random() * 1.5, life: 1.1, drag: 0.5 });
        }
        if (pl && pl.alive && !game.traveling && this.cooldown <= 0 && Math.hypot(pl.position.x - p.def.x, pl.position.z - p.def.z) < 1.25) {
          game.log.add(`You step through the portal to ${p.def.label}.`, 'system');
          game.travel(p.def.to, p.def.tx, p.def.tz);
        }
      }
    }
  }

  G.Portals = Portals;
})(window.G = window.G || {});
