/* Spell and skill visuals. Short-lived meshes are created per effect and
   removed when finished; particles go through the shared pools in Effects. */
(function (G) {
  'use strict';
  const U = G.Utils;
  const COLORS = { fire: [1, 0.55, 0.2], water: [0.6, 0.9, 1], wind: [1, 0.95, 0.5], neutral: [1, 1, 1] };
  const HEX = { fire: '#ff8a3d', water: '#9fe2ff', wind: '#fff07a', neutral: '#ffffff' };

  function runeTexture(color) {
    const s = 256, c = U.makeCanvas(s, s), x = c.getContext('2d');
    x.translate(s / 2, s / 2);
    x.strokeStyle = color; x.shadowColor = color; x.shadowBlur = 12; x.lineWidth = 5;
    x.beginPath(); x.arc(0, 0, 112, 0, Math.PI * 2); x.stroke();
    x.lineWidth = 3; x.beginPath(); x.arc(0, 0, 92, 0, Math.PI * 2); x.stroke();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2, b = a + (Math.PI * 2 / 6) * 2;
      x.beginPath(); x.moveTo(Math.cos(a) * 92, Math.sin(a) * 92); x.lineTo(Math.cos(b) * 92, Math.sin(b) * 92); x.stroke();
    }
    x.font = 'bold 18px serif'; x.fillStyle = color;
    for (let i = 0; i < 12; i++) { x.save(); x.rotate((i / 12) * Math.PI * 2); x.fillText('ᚱᚢᚾᛖ'[i % 4], -5, -97); x.restore(); }
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
    return t;
  }

  class Spells {
    constructor(game) {
      this.game = game;
      this.scene = game.scene;
      this.active = [];
      this.ringGeo = new THREE.RingGeometry(0.75, 1, 40); this.ringGeo.rotateX(-Math.PI / 2);
      this.planeGeo = new THREE.PlaneGeometry(1, 1); this.planeGeo.rotateX(-Math.PI / 2);
      this.runeTex = {};
      const ag = new THREE.CylinderGeometry(0.025, 0.025, 0.9, 5); ag.rotateX(Math.PI / 2);
      const tip = new THREE.ConeGeometry(0.06, 0.18, 6); tip.rotateX(Math.PI / 2); tip.translate(0, 0, 0.5);
      this.arrowGeo = G.Utils.mergeParts([{ geo: ag, color: '#8b5a33' }, { geo: tip, color: '#d7dee8' }]);
      this.arrowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
      this.shardGeo = new THREE.ConeGeometry(0.16, 0.9, 6);
      this.castMesh = null;
    }

    add(fx) { this.active.push(fx); return fx; }
    remove(obj) { this.scene.remove(obj); if (obj.material && obj.material.dispose && !obj.userData.shared) obj.material.dispose(); }

    /* Arrow from the archer to the target; onHit runs on arrival. */
    arrow(from, target, onHit) {
      const mesh = new THREE.Mesh(this.arrowGeo, this.arrowMat);
      mesh.userData.shared = true;
      const start = new THREE.Vector3(from.position.x, from.position.y + 1.2, from.position.z);
      mesh.position.copy(start);
      this.scene.add(mesh);
      this.add({
        t: 0, update: (dt) => {
          const end = new THREE.Vector3(target.position.x, target.position.y + target.def.height * 0.5, target.position.z);
          const dist = mesh.position.distanceTo(end);
          const step = 30 * dt;
          if (dist <= step || !target.alive) { this.scene.remove(mesh); if (target.alive) onHit(); return true; }
          mesh.lookAt(end);
          mesh.position.addScaledVector(end.sub(mesh.position).normalize(), step);
          return false;
        },
      });
    }

    /* A bolt falling from the sky onto the target (fire, water or wind). */
    bolt(element, target, onHit) {
      const game = this.game, color = HEX[element];
      const p = target.position, base = new THREE.Vector3(p.x, p.y + target.def.height * 0.5, p.z);
      if (element === 'wind') {
        // Lightning: an instant jagged flash, then sparks.
        const pts = [];
        let x = 0, z = 0;
        for (let i = 0; i <= 8; i++) { pts.push(new THREE.Vector3(base.x + x, base.y + 9 - i * 1.15, base.z + z)); x = (Math.random() - 0.5) * 0.7; z = (Math.random() - 0.5) * 0.7; }
        pts[8].copy(base);
        const line = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.07, 4), new THREE.MeshBasicMaterial({ color: '#fffbd0', transparent: true, blending: THREE.AdditiveBlending, toneMapped: false }));
        this.scene.add(line);
        onHit();
        game.effects.sparks.burst(base.x, base.y, base.z, 16, { color: COLORS.wind, size: 0.28, speed: 5, life: 0.4, drag: 3 });
        this.add({ t: 0, update: (dt, fx) => { fx.t += dt; line.material.opacity = 1 - fx.t / 0.22; line.visible = Math.random() > 0.2; if (fx.t > 0.22) { this.scene.remove(line); line.geometry.dispose(); line.material.dispose(); return true; } return false; } });
        return;
      }
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, blending: element === 'fire' ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: false });
      const shard = new THREE.Mesh(this.shardGeo, mat);
      shard.rotation.x = Math.PI;
      const top = base.clone(); top.y += 7; top.x += (Math.random() - 0.5); top.z += (Math.random() - 0.5);
      shard.position.copy(top);
      this.scene.add(shard);
      this.add({
        t: 0, update: (dt, fx) => {
          fx.t += dt;
          const k = Math.min(1, fx.t / 0.2);
          shard.position.lerpVectors(top, base, k);
          if (element === 'fire') game.effects.sparks.emit(shard.position.x, shard.position.y, shard.position.z, { color: COLORS.fire, size: 0.35, life: 0.3, vy: 1 });
          else game.effects.puffs.emit(shard.position.x, shard.position.y, shard.position.z, { color: COLORS.water, size: 0.2, life: 0.35 });
          if (k >= 1) {
            this.scene.remove(shard); mat.dispose();
            if (target.alive) onHit();
            const sys = element === 'fire' ? game.effects.sparks : game.effects.puffs;
            sys.burst(base.x, base.y, base.z, 14, { color: COLORS[element], size: element === 'fire' ? 0.4 : 0.26, speed: 3.5, up: 1.5, life: 0.5, drag: 3, gravity: element === 'water' ? 8 : 0 });
            return true;
          }
          return false;
        },
      });
    }

    /* Glowing orb flying from the caster to the target (Soul Strike, Frost Diver, Fire Ball). */
    orb(from, target, color, onHit, size) {
      const c = new THREE.Color(color);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.game.effects.sparks.uniforms.map.value, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      const k = size || 0.32;
      s.scale.set(k * 2, k * 2, 1);
      s.position.set(from.position.x, from.position.y + 1.4, from.position.z);
      this.scene.add(s);
      this.add({ update: (dt) => {
        const end = new THREE.Vector3(target.position.x, target.position.y + (target.def ? target.def.height * 0.5 : 0.6), target.position.z);
        const d = s.position.distanceTo(end), step = 16 * dt;
        this.game.effects.sparks.emit(s.position.x, s.position.y, s.position.z, { color: [c.r, c.g, c.b], size: k * 0.8, life: 0.3 });
        if (d <= step || target.alive === false) {
          this.remove(s);
          if (target.alive !== false) onHit();
          this.game.effects.sparks.burst(end.x, end.y, end.z, 10, { color: [c.r, c.g, c.b], size: 0.3, speed: 3, life: 0.4, drag: 3 });
          return true;
        }
        s.position.addScaledVector(end.sub(s.position).normalize(), step);
        return false;
      } });
    }

    /* A column of light on the target (Holy Light). */
    beam(target, color, onHit) {
      const geo = new THREE.CylinderGeometry(0.35, 0.35, 8, 12, 1, true); geo.translate(0, 4, 0);
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(target.position);
      this.scene.add(m);
      onHit();
      this.impact(target, color, 1.2);
      this.add({ t: 0, update: (dt, fx) => {
        fx.t += dt; const k = fx.t / 0.4;
        m.scale.set(1 - k * 0.7, 1, 1 - k * 0.7); mat.opacity = 1 - k;
        if (k >= 1) { this.scene.remove(m); geo.dispose(); mat.dispose(); return true; } return false;
      } });
    }

    /* Expanding ground ring (Magnum Break). */
    ring(pos, color, radius) {
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
      const m = new THREE.Mesh(this.ringGeo, mat);
      m.position.set(pos.x, pos.y + 0.15, pos.z);
      this.scene.add(m);
      const c = new THREE.Color(color);
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * Math.PI * 2;
        this.game.effects.sparks.emit(pos.x + Math.cos(a) * 0.5, pos.y + 0.4, pos.z + Math.sin(a) * 0.5,
          { color: [c.r * 1.2, c.g * 1.2, c.b], size: 0.45, vx: Math.cos(a) * radius * 2.2, vy: 1.5 + Math.random() * 2, vz: Math.sin(a) * radius * 2.2, drag: 3, life: 0.55 });
      }
      this.add({ t: 0, update: (dt, fx) => {
        fx.t += dt; const k = fx.t / 0.45;
        const s = 0.3 + k * radius; m.scale.set(s, 1, s); mat.opacity = 1 - k;
        if (k >= 1) { this.remove(m); return true; } return false;
      } });
    }

    /* Rising sparkles around an entity (heals and buffs). */
    aura(ent, color) {
      const c = new THREE.Color(color), p = ent.position;
      for (let i = 0; i < 36; i++) {
        const a = Math.random() * Math.PI * 2, r = 0.5 + Math.random() * 0.4;
        this.game.effects.sparks.emit(p.x + Math.cos(a) * r, p.y + Math.random() * 0.4, p.z + Math.sin(a) * r,
          { color: [c.r, c.g, c.b], size: 0.2 + Math.random() * 0.15, vx: -Math.sin(a) * 0.8, vy: 1.6 + Math.random() * 1.6, vz: Math.cos(a) * 0.8, life: 1 + Math.random() * 0.5, drag: 0.5 });
      }
      this.ring(p, color, 1.3);
    }

    /* Big star burst on a target (Bash, Provoke, Steal). */
    impact(target, color, scale) {
      const p = target.position;
      const at = new THREE.Vector3(p.x, p.y + target.def.height * 0.55, p.z);
      this.game.effects.hit(at, true);
      const c = new THREE.Color(color);
      this.game.effects.sparks.burst(at.x, at.y, at.z, 18, { color: [c.r, c.g, c.b], size: 0.3 * (scale || 1), speed: 5, life: 0.45, drag: 3 });
    }

    coins(target) {
      const p = target.position;
      this.game.effects.puffs.burst(p.x, p.y + 1.5, p.z, 22, { color: [1, 0.82, 0.25], size: 0.22, speed: 3, up: 3, gravity: 12, life: 0.8 });
      this.impact(target, '#ffd24a', 1.2);
    }

    /* Glowing magic circle under the caster while a spell charges. */
    castCircle(ent, element) {
      this.endCastCircle();
      const color = HEX[element || 'neutral'] || '#ffffff';
      if (!this.runeTex[color]) this.runeTex[color] = runeTexture(color);
      const mat = new THREE.MeshBasicMaterial({ map: this.runeTex[color], transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false });
      const m = new THREE.Mesh(this.planeGeo, mat);
      m.renderOrder = 1;
      m.scale.set(2.6, 1, 2.6);
      this.scene.add(m);
      this.castMesh = m;
      this.castEnt = ent;
    }
    endCastCircle() {
      if (this.castMesh) { this.remove(this.castMesh); this.castMesh = null; }
    }

    update(dt, time) {
      for (let i = this.active.length - 1; i >= 0; i--) {
        const fx = this.active[i];
        if (fx.update(dt, fx)) this.active.splice(i, 1);
      }
      if (this.castMesh) {
        const p = this.castEnt.position;
        this.castMesh.position.set(p.x, p.y + 0.08, p.z);
        this.castMesh.rotation.y = time * 1.5;
        this.castMesh.material.opacity = 0.75 + Math.sin(time * 8) * 0.2;
      }
    }
  }

  G.Spells = Spells;
})(window.G = window.G || {});
