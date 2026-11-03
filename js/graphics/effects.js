/* Effects: pooled GPU particles, ground rings (target, hover, click marker),
   hit flashes, level-up pillar and soft blob shadows. Everything is pooled
   so combat creates no garbage per hit. */
(function (G) {
  'use strict';
  const U = G.Utils;

  /* ---------------- textures ---------------- */
  function ringTexture(color, glow, arrows) {
    const s = 256, c = U.makeCanvas(s, s), x = c.getContext('2d');
    x.translate(s / 2, s / 2);
    x.shadowColor = glow; x.shadowBlur = 16;
    x.strokeStyle = color; x.lineWidth = 9;
    x.beginPath(); x.arc(0, 0, 100, 0, Math.PI * 2); x.stroke();
    x.lineWidth = 3; x.globalAlpha = 0.7;
    x.beginPath(); x.arc(0, 0, 84, 0, Math.PI * 2); x.stroke();
    x.globalAlpha = 1;
    if (arrows) {
      x.fillStyle = color;
      for (let i = 0; i < 4; i++) {
        x.save(); x.rotate(i * Math.PI / 2 + Math.PI / 4);
        x.beginPath(); x.moveTo(0, -78); x.lineTo(-13, -104); x.lineTo(13, -104); x.closePath(); x.fill();
        x.restore();
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    return t;
  }
  function starTexture() {
    const s = 128, c = U.makeCanvas(s, s), x = c.getContext('2d');
    x.translate(s / 2, s / 2);
    const g = x.createRadialGradient(0, 0, 0, 0, 0, 60);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,245,200,0.9)'); g.addColorStop(1, 'rgba(255,220,120,0)');
    x.fillStyle = g;
    x.beginPath();
    for (let i = 0; i < 16; i++) {
      const r = i % 2 ? 14 : 62, a = (i / 16) * Math.PI * 2;
      x.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    x.closePath(); x.fill();
    const t = new THREE.CanvasTexture(c);
    return t;
  }
  function softDot() {
    const s = 64, c = U.makeCanvas(s, s), x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.85)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, s, s);
    return new THREE.CanvasTexture(c);
  }
  function pillarTexture() {
    const c = U.makeCanvas(4, 128), x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, 'rgba(255,240,170,0)'); g.addColorStop(0.5, 'rgba(255,230,140,0.55)'); g.addColorStop(1, 'rgba(255,250,210,0.95)');
    x.fillStyle = g; x.fillRect(0, 0, 4, 128);
    return new THREE.CanvasTexture(c);
  }

  /* ---------------- particles ---------------- */
  class Particles {
    constructor(scene, max, additive) {
      this.max = max;
      const geo = new THREE.BufferGeometry();
      this.pos = new Float32Array(max * 3);
      this.col = new Float32Array(max * 4);
      this.size = new Float32Array(max);
      geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
      this.geo = geo;
      this.uniforms = { map: { value: softDot() }, scale: { value: 600 } };
      const mat = new THREE.ShaderMaterial({
        uniforms: this.uniforms, transparent: true, depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        vertexShader: `attribute float size; attribute vec4 pcolor; varying vec4 vColor; uniform float scale;
          void main(){ vColor = pcolor; vec4 mv = modelViewMatrix * vec4(position,1.0);
            gl_PointSize = size * scale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform sampler2D map; varying vec4 vColor;
          void main(){ float a = texture2D(map, gl_PointCoord).a * vColor.a; if (a < 0.01) discard; gl_FragColor = vec4(vColor.rgb, a); }`,
      });
      this.points = new THREE.Points(geo, mat);
      this.points.frustumCulled = false;
      this.points.renderOrder = 5;
      scene.add(this.points);
      this.p = [];
      for (let i = 0; i < max; i++) this.p.push({ life: 0, max: 1, vx: 0, vy: 0, vz: 0, g: 0, drag: 0, s0: 0, s1: 0, r: 1, gr: 1, b: 1, a: 1 });
      this.cursor = 0;
      this.active = 0;
    }
    emit(x, y, z, o) {
      const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
      const p = this.p[i];
      p.life = p.max = o.life || 1;
      p.vx = o.vx || 0; p.vy = o.vy || 0; p.vz = o.vz || 0;
      p.g = o.gravity || 0; p.drag = o.drag || 0;
      p.s0 = o.size || 0.3; p.s1 = o.endSize == null ? p.s0 * 0.2 : o.endSize;
      p.r = o.color[0]; p.gr = o.color[1]; p.b = o.color[2]; p.a = o.alpha == null ? 1 : o.alpha;
      this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    }
    burst(x, y, z, n, o) {
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2, el = (Math.random() - 0.2) * (o.spread || 1.2);
        const sp = (o.speed || 3) * (0.5 + Math.random() * 0.7);
        this.emit(x, y, z, Object.assign({}, o, {
          vx: Math.cos(a) * Math.cos(el) * sp, vy: Math.sin(el) * sp + (o.up || 0), vz: Math.sin(a) * Math.cos(el) * sp,
          life: (o.life || 0.6) * (0.7 + Math.random() * 0.6),
        }));
      }
    }
    update(dt) {
      const P = this.p, pos = this.pos, col = this.col, size = this.size;
      for (let i = 0; i < this.max; i++) {
        const p = P[i];
        if (p.life <= 0) { if (size[i] !== 0) { size[i] = 0; col[i * 4 + 3] = 0; } continue; }
        p.life -= dt;
        const k = Math.max(0, p.life / p.max);
        const dr = Math.exp(-p.drag * dt);
        p.vx *= dr; p.vz *= dr; p.vy = p.vy * dr - p.g * dt;
        pos[i * 3] += p.vx * dt; pos[i * 3 + 1] += p.vy * dt; pos[i * 3 + 2] += p.vz * dt;
        size[i] = U.lerp(p.s1, p.s0, k);
        col[i * 4] = p.r; col[i * 4 + 1] = p.gr; col[i * 4 + 2] = p.b;
        col[i * 4 + 3] = p.a * Math.min(1, k * 2.5);
      }
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.pcolor.needsUpdate = true;
      this.geo.attributes.size.needsUpdate = true;
    }
  }

  /* ---------------- effects manager ---------------- */
  class Effects {
    constructor(scene) {
      this.scene = scene;
      this.sparks = new Particles(scene, 700, true);
      this.puffs = new Particles(scene, 500, false);

      const ringGeo = new THREE.PlaneGeometry(1, 1);
      ringGeo.rotateX(-Math.PI / 2);
      const ringMat = (tex, opacity) => new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, opacity, fog: false, toneMapped: false });

      this.targetRing = new THREE.Mesh(ringGeo, ringMat(ringTexture('#ff5468', 'rgba(255,60,90,0.9)', true), 0.95));
      this.targetRing.renderOrder = 1; this.targetRing.visible = false;
      this.hoverRing = new THREE.Mesh(ringGeo, ringMat(ringTexture('#ffe27a', 'rgba(255,220,90,0.8)', false), 0.75));
      this.hoverRing.renderOrder = 1; this.hoverRing.visible = false;
      scene.add(this.targetRing, this.hoverRing);

      const clickTex = ringTexture('#7ff0ff', 'rgba(80,220,255,0.9)', false);
      this.markers = [];
      for (let i = 0; i < 4; i++) {
        const m = new THREE.Mesh(ringGeo, ringMat(clickTex, 1));
        m.renderOrder = 1; m.visible = false; m.userData.t = 0;
        scene.add(m); this.markers.push(m);
      }
      this.markerIdx = 0;

      const star = starTexture();
      this.flashes = [];
      for (let i = 0; i < 8; i++) {
        // depthWrite off: an invisible, fading flash must never hide sprites drawn after it.
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: star, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, color: '#fff2c0' }));
        s.visible = false; s.renderOrder = 6; s.userData.t = 0;
        scene.add(s); this.flashes.push(s);
      }
      this.flashIdx = 0;

      const pgeo = new THREE.CylinderGeometry(0.9, 0.9, 7, 20, 1, true);
      pgeo.translate(0, 3.5, 0);
      this.pillar = new THREE.Mesh(pgeo, new THREE.MeshBasicMaterial({ map: pillarTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      this.pillar.visible = false; this.pillar.renderOrder = 4;
      scene.add(this.pillar);
      this.pillarT = 0;
      this.pillarTarget = null;

      this.shadowGeo = new THREE.PlaneGeometry(1, 1);
      this.shadowMat = new THREE.MeshBasicMaterial({ map: U.radialTexture(64, 0.2, 1.0), color: '#1d2a14', transparent: true, opacity: 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
      this.time = 0;
      this.ambientT = 0;
    }

    makeShadow(size) {
      const m = new THREE.Mesh(this.shadowGeo, this.shadowMat);
      m.scale.set(size, size * 0.8, 1);
      m.renderOrder = 0;
      this.scene.add(m);
      return m;
    }

    setPixelScale(heightPx, fov) {
      const s = heightPx / (2 * Math.tan((fov * Math.PI) / 360));
      this.sparks.uniforms.scale.value = s;
      this.puffs.uniforms.scale.value = s;
    }

    showTarget(entity) {
      const r = this.targetRing;
      if (!entity) { r.visible = false; r.userData.ent = null; return; }
      r.visible = true; r.userData.ent = entity;
    }
    showHover(entity) {
      const r = this.hoverRing;
      r.visible = !!entity; r.userData.ent = entity;
    }

    clickMarker(p) {
      const m = this.markers[this.markerIdx++ % this.markers.length];
      m.position.set(p.x, p.y + 0.05, p.z);
      m.userData.t = 0.001; m.visible = true;
    }

    hit(p, crit) {
      const s = this.flashes[this.flashIdx++ % this.flashes.length];
      s.position.copy(p); s.userData.t = 0.001; s.userData.crit = crit; s.visible = true;
      s.material.rotation = Math.random() * Math.PI;
      s.material.color.set(crit ? '#ffd24a' : '#fff4d0');
      this.sparks.burst(p.x, p.y, p.z, crit ? 16 : 8, { color: crit ? [1, 0.85, 0.3] : [1, 0.95, 0.75], size: crit ? 0.35 : 0.24, speed: crit ? 6 : 4, life: 0.35, drag: 4, gravity: 6 });
    }

    death(p, color) {
      this.puffs.burst(p.x, p.y + 0.4, p.z, 18, { color, size: 0.42, endSize: 0.1, speed: 3.2, up: 2.2, life: 0.75, drag: 3, gravity: 7 });
      this.puffs.burst(p.x, p.y + 0.3, p.z, 8, { color: [0.95, 0.95, 0.95], size: 0.9, endSize: 1.5, speed: 1, up: 0.8, life: 0.7, drag: 2, alpha: 0.6 });
      this.sparks.burst(p.x, p.y + 0.6, p.z, 10, { color: [1, 0.9, 0.6], size: 0.2, speed: 2.5, up: 2.5, life: 0.9, drag: 1.5 });
    }

    levelUp(entity) {
      this.pillarTarget = entity; this.pillarT = 0.001; this.pillar.visible = true;
      const p = entity.position;
      for (let i = 0; i < 60; i++) {
        const a = Math.random() * Math.PI * 2, r = 0.4 + Math.random() * 0.9;
        this.sparks.emit(p.x + Math.cos(a) * r, p.y + Math.random() * 0.5, p.z + Math.sin(a) * r, {
          color: [1, 0.86 + Math.random() * 0.14, 0.35 + Math.random() * 0.3], size: 0.25 + Math.random() * 0.2,
          vx: 0, vy: 2.5 + Math.random() * 3.5, vz: 0, life: 1.2 + Math.random() * 0.8, drag: 0.6,
        });
      }
    }

    // Small heal sparkle for regen ticks / respawn.
    sparkle(p, color, n) {
      this.sparks.burst(p.x, p.y + 0.8, p.z, n || 12, { color: color || [0.6, 1, 0.7], size: 0.2, speed: 1.4, up: 1.6, life: 0.9, drag: 1.5 });
    }

    // Butterflies: little flapping sprites that wander near the player (meadows).
    makeButterflies() {
      const tex = (() => {
        const c = U.makeCanvas(64, 64), x = c.getContext('2d');
        const wing = (sx, col) => { x.fillStyle = col; x.beginPath(); x.ellipse(32 + sx * 13, 24, 13, 15, sx * 0.4, 0, Math.PI * 2); x.fill(); x.beginPath(); x.ellipse(32 + sx * 10, 44, 9, 10, -sx * 0.3, 0, Math.PI * 2); x.fill(); };
        wing(-1, '#ffffff'); wing(1, '#ffffff');
        x.fillStyle = '#3a2a2a'; x.fillRect(30, 18, 4, 30);
        const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t;
      })();
      const cols = ['#ffd84a', '#ff9ec2', '#9fd8ff', '#ffffff', '#c9a6ff', '#ffb35c'];
      this.butterflies = cols.concat(cols.slice(0, 2)).map((col, i) => {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: col, transparent: true, alphaTest: 0.3, toneMapped: false }));
        s.scale.set(0.38, 0.38, 1);
        this.scene.add(s);
        return { s, x: 0, z: 0, y: 1, tx: 0, tz: 0, ph: i * 1.7, init: false };
      });
    }

    // Splashes from the town fountain, plus each map's own ambience.
    ambient(dt, focus, fountain, map) {
      const style = !map ? 'meadow' : map.cave ? 'cave' : map.id === 'forest' ? 'forest' : 'meadow';
      if (!this.butterflies) this.makeButterflies();
      for (const b of this.butterflies) {
        b.s.visible = style === 'meadow';
        if (!b.s.visible) { b.init = false; continue; }
        if (!b.init || Math.hypot(b.x - focus.x, b.z - focus.z) > 26) {
          const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 14;
          b.x = b.tx = focus.x + Math.cos(a) * r; b.z = b.tz = focus.z + Math.sin(a) * r; b.init = true;
        }
        if (Math.hypot(b.tx - b.x, b.tz - b.z) < 0.5) { b.tx = b.x + (Math.random() - 0.5) * 8; b.tz = b.z + (Math.random() - 0.5) * 8; }
        const dx = b.tx - b.x, dz = b.tz - b.z, d = Math.hypot(dx, dz) || 1;
        b.x += (dx / d) * 1.4 * dt; b.z += (dz / d) * 1.4 * dt;
        b.ph += dt * 16;
        const ground = G.Terrain.surfaceHeight(b.x, b.z);
        b.s.position.set(b.x, ground + 0.9 + Math.sin(b.ph * 0.2) * 0.35, b.z);
        b.s.scale.set(0.38 * (0.35 + 0.65 * Math.abs(Math.sin(b.ph))), 0.38, 1);
      }
      this.ambientT += dt;
      if (fountain && focus.distanceTo(fountain) < 45) {
        for (let i = 0; i < 2; i++) {
          const a = Math.random() * Math.PI * 2, sp = 0.6 + Math.random() * 0.4;
          this.puffs.emit(fountain.x, fountain.y, fountain.z, { color: [0.75, 0.92, 1], size: 0.16, endSize: 0.1, vx: Math.cos(a) * sp, vy: 2.6 + Math.random() * 0.6, vz: Math.sin(a) * sp, gravity: 6, life: 0.9, alpha: 0.8 });
        }
      }
      while (this.ambientT > 0.12) {
        this.ambientT -= 0.12;
        const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 20;
        const x = focus.x + Math.cos(a) * r, z = focus.z + Math.sin(a) * r, y = G.Terrain.surfaceHeight(x, z);
        if (style === 'cave') {
          // Slow dust motes catching the torchlight.
          this.sparks.emit(x, y + 0.5 + Math.random() * 3, z, { color: [0.75, 0.7, 0.6], size: 0.07, endSize: 0.03, vx: (Math.random() - 0.5) * 0.15, vy: -0.05, vz: (Math.random() - 0.5) * 0.15, life: 4, alpha: 0.5 });
        } else if (style === 'forest') {
          // Fireflies near the ground, and leaves drifting down from the canopy.
          this.sparks.emit(x, y + 0.4 + Math.random() * 1.6, z, { color: [0.75, 1, 0.35], size: 0.14, endSize: 0.02, vx: (Math.random() - 0.5) * 0.5, vy: 0.08, vz: (Math.random() - 0.5) * 0.5, life: 2.5 + Math.random() * 2, alpha: 0.95 });
          if (Math.random() < 0.5) this.puffs.emit(x, y + 5 + Math.random() * 3, z, { color: Math.random() < 0.6 ? [0.45, 0.75, 0.3] : [0.9, 0.6, 0.2], size: 0.16, endSize: 0.14, vx: (Math.random() - 0.5) * 0.8, vy: -0.9, vz: (Math.random() - 0.5) * 0.8, life: 5, alpha: 0.9, drag: 0.2 });
        } else {
          this.sparks.emit(x, y + 0.5 + Math.random() * 3, z, {
            color: Math.random() < 0.5 ? [1, 0.95, 0.65] : [0.85, 1, 0.75], size: 0.09 + Math.random() * 0.07, endSize: 0.02,
            vx: (Math.random() - 0.5) * 0.4, vy: 0.15 + Math.random() * 0.2, vz: (Math.random() - 0.5) * 0.4, life: 3 + Math.random() * 2, alpha: 0.75,
          });
        }
      }
    }

    update(dt, time) {
      this.time = time;
      this.sparks.update(dt);
      this.puffs.update(dt);

      for (const r of [this.targetRing, this.hoverRing]) {
        const e = r.userData.ent;
        if (!r.visible || !e) continue;
        if (!e.alive && r === this.hoverRing) { r.visible = false; continue; }
        const s = e.def ? e.def.hitRadius * 2.4 : 1.6;
        r.position.set(e.position.x, e.position.y + 0.06, e.position.z);
        const pulse = r === this.targetRing ? 1 + Math.sin(time * 6) * 0.06 : 1;
        r.scale.set(s * pulse, 1, s * pulse);
        r.rotation.y = r === this.targetRing ? time * 1.2 : 0;
      }
      for (const m of this.markers) {
        if (!m.visible) continue;
        m.userData.t += dt;
        const t = m.userData.t / 0.55;
        if (t >= 1) { m.visible = false; continue; }
        const s = 0.4 + t * 1.3;
        m.scale.set(s, 1, s);
        m.material.opacity = 1 - t;
      }
      for (const s of this.flashes) {
        if (!s.visible) continue;
        s.userData.t += dt;
        const t = s.userData.t / 0.18;
        if (t >= 1) { s.visible = false; continue; }
        const k = (s.userData.crit ? 1.9 : 1.2) * (0.5 + t);
        s.scale.set(k, k, 1);
        s.material.opacity = 1 - t * t;
      }
      if (this.pillar.visible) {
        this.pillarT += dt;
        const t = this.pillarT / 1.6;
        if (t >= 1) this.pillar.visible = false;
        else {
          const p = this.pillarTarget.position;
          this.pillar.position.set(p.x, p.y, p.z);
          const w = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85 * 0.6;
          this.pillar.scale.set(w, 0.6 + t * 0.6, w);
          this.pillar.material.opacity = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
          this.pillar.rotation.y += dt * 2;
        }
      }
    }
  }

  G.Effects = Effects;
})(window.G = window.G || {});
