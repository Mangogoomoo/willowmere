/* Environment: everything static in the world. Repeated props are instanced,
   unique buildings are merged into a few vertex-coloured meshes, and every
   solid object registers an obstacle in the navigation grid. */
(function (G) {
  'use strict';
  const U = G.Utils, C = G.Config, TR = G.Terrain;

  const _o = new THREE.Object3D(), _c = new THREE.Color();
  const box = new THREE.BoxGeometry(1, 1, 1);

  class Environment {
    constructor(scene, nav, map) {
      this.scene = scene;
      this.nav = nav;
      this.map = map;
      this.rng = U.mulberry32(1337 + (map.seed || 0));
      this.colliders = [];        // meshes the camera must not pass through
      this.wind = { value: 0 };
      this.updaters = [];
      this.landmarks = [];

      this.propMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.88 });
      this.foliageMat = this.windMaterial(0.035);
      this.grassMat = this.windMaterial(0.16);
      this.grassMat.side = THREE.DoubleSide;
      this.plainMat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.7 });
    }

    windMaterial(strength) {
      const m = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
      const wind = this.wind;
      m.onBeforeCompile = (shader) => {
        shader.uniforms.uWind = wind;
        shader.vertexShader = 'uniform float uWind;\n' + shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec2 wp = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
          #else
            vec2 wp = vec2(0.0);
          #endif
          float sway = sin(uWind * 1.6 + wp.x * 0.31 + wp.y * 0.23) + 0.4 * sin(uWind * 3.1 + wp.x * 0.9);
          float k = ${strength.toFixed(3)} * max(position.y, 0.0);
          transformed.x += sway * k; transformed.z += sway * k * 0.55;`
        );
      };
      m.customProgramCacheKey = () => 'wind' + strength;
      return m;
    }

    instanced(geo, mat, list, opts) {
      opts = opts || {};
      if (!list.length) return null;
      const m = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((it, i) => {
        _o.position.set(it.x, it.y, it.z);
        _o.rotation.set(it.rx || 0, it.ry || 0, it.rz || 0);
        if (Array.isArray(it.s)) _o.scale.set(it.s[0], it.s[1], it.s[2]); else _o.scale.setScalar(it.s || 1);
        _o.updateMatrix();
        m.setMatrixAt(i, _o.matrix);
        // Always write an instance colour: three r149 can pick the wrong shader
        // variant when a shared material mixes instanced meshes with and without them.
        m.setColorAt(i, _c.set(it.color || '#ffffff'));
      });
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.castShadow = !!opts.cast;
      m.receiveShadow = opts.receive !== false;
      m.frustumCulled = false;
      this.scene.add(m);
      return m;
    }

    mesh(parts, opts) {
      opts = opts || {};
      const m = new THREE.Mesh(U.mergeParts(parts), opts.mat || this.propMat);
      m.castShadow = opts.cast !== false;
      m.receiveShadow = true;
      this.scene.add(m);
      if (opts.collide) this.colliders.push(m);
      return m;
    }

    build() {
      this.buildSky();
      if (this.map.cave) { this.buildCave(); return this; }
      if (this.map.town) this.buildTown();
      this.buildField();
      return this;
    }

    /* ------------------------------------------------------------ sky */
    buildSky() {
      const sky = new THREE.Mesh(
        new THREE.SphereGeometry(480, 32, 16),
        new THREE.ShaderMaterial({
          side: THREE.BackSide, depthWrite: false, fog: false,
          uniforms: {
            top: { value: U.displayColor(this.map.atmosphere ? this.map.atmosphere.sky[0] : '#4a98e6') },
            mid: { value: U.displayColor(this.map.atmosphere ? this.map.atmosphere.sky[1] : '#9fd0f4') },
            horizon: { value: U.displayColor(this.map.atmosphere ? this.map.atmosphere.sky[2] : G.Config.SKY_HORIZON) },
          },
          vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
          fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; varying vec3 vDir;
            void main(){ float h = vDir.y;
              vec3 c = mix(horizon, mid, smoothstep(0.0, 0.18, h));
              c = mix(c, top, smoothstep(0.18, 0.75, h));
              c = mix(c, horizon * 0.95, smoothstep(0.0, -0.2, h));
              gl_FragColor = vec4(c, 1.0); }`,
        })
      );
      sky.renderOrder = -10;
      sky.frustumCulled = false;
      this.scene.add(sky);
      this.sky = sky;
      if (this.map.cave) return;     // no clouds or mountains underground

      // Clouds: puffy low-poly clusters drifting slowly around the sky.
      const cloudGroup = new THREE.Group();
      const cloudMat = new THREE.MeshStandardMaterial({
        vertexColors: true, flatShading: true, roughness: 1, emissive: '#c9dbe8', emissiveIntensity: 0.55, fog: false,
      });
      const ico = new THREE.IcosahedronGeometry(1, 0);
      for (let i = 0; i < 16; i++) {
        const parts = [];
        const n = 4 + U.randInt(this.rng, 0, 3);
        for (let k = 0; k < n; k++) {
          const r = 6 + this.rng() * 6;
          parts.push({ geo: ico, color: k % 2 ? '#ffffff' : '#f4f8fb', pos: [(k - n / 2) * 7 + this.rng() * 3, this.rng() * 3, this.rng() * 6 - 3], scale: [r * 1.3, r * 0.7, r] });
        }
        const m = new THREE.Mesh(U.mergeParts(parts), cloudMat);
        const a = (i / 16) * Math.PI * 2 + this.rng() * 0.3, rad = 150 + this.rng() * 140;
        m.position.set(Math.cos(a) * rad, 70 + this.rng() * 45, Math.sin(a) * rad);
        m.rotation.y = this.rng() * Math.PI;
        cloudGroup.add(m);
      }
      this.scene.add(cloudGroup);
      this.updaters.push((dt) => { cloudGroup.rotation.y += dt * 0.004; });

      // Distant mountain ring, softened by fog.
      const mparts = [];
      const cone = new THREE.ConeGeometry(1, 1, 6, 1);
      for (let i = 0; i < 46; i++) {
        const a = (i / 46) * Math.PI * 2 + this.rng() * 0.08;
        const rad = 185 + this.rng() * 50;
        const h = 45 + this.rng() * 60, r = 30 + this.rng() * 26;
        const col = ['#6f9d82', '#7aa98a', '#86ad94', '#6a9478'][i % 4];
        mparts.push({ geo: cone, color: col, pos: [Math.cos(a) * rad, h / 2 - 8, Math.sin(a) * rad], rot: [0, this.rng() * 3, 0], scale: [r, h, r], jitter: 0.12 });
        if (h > 80) mparts.push({ geo: cone, color: '#f4f7f8', pos: [Math.cos(a) * rad, h - 8 - h * 0.1, Math.sin(a) * rad], scale: [r * 0.22, h * 0.21, r * 0.22] });
      }
      const mm = new THREE.Mesh(U.mergeParts(mparts), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
      this.scene.add(mm);
    }

    /* ------------------------------------------------------------ town */
    buildTown() {
      const T = C.TOWN, cx = T.cx, cz = T.cz;
      const buildings = [], props = [];

      // Houses ring the plaza, each facing it.
      const palettes = [
        { wall: '#f6ead2', roof: '#d9534f', trim: '#7b4a2c' },
        { wall: '#fdf3e1', roof: '#4b7bd1', trim: '#6b4428' },
        { wall: '#efe0c4', roof: '#e8893a', trim: '#6e3f22' },
        { wall: '#f8efe6', roof: '#7c5cc4', trim: '#5f3b24' },
        { wall: '#f3e4cf', roof: '#3f9e7a', trim: '#73462a' },
        { wall: '#fbf1dc', roof: '#c4486e', trim: '#6d4226' },
      ];
      let pi = 0;
      [45, 135, 225, 315].forEach((q) => {
        [[q - 17, 22.5, false], [q + 17, 22.5, false], [q, 31, true]].forEach(([deg, r, tall]) => {
          const a = deg * Math.PI / 180;
          const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
          const rot = Math.atan2(cx - x, cz - z);
          const p = palettes[pi++ % palettes.length];
          this.house(buildings, x, z, rot, Object.assign({ w: tall ? 7 : 6, d: tall ? 5.5 : 5, h: tall ? 4.8 : 3.3 }, p));
        });
        // a blossom tree between the two front houses
        const a = q * Math.PI / 180;
        this.blossomSpots = this.blossomSpots || [];
        this.blossomSpots.push([cx + Math.cos(a) * 22, cz + Math.sin(a) * 22]);
      });

      this.fountain(buildings, cx, cz);
      [70, 110, 250, 290].forEach((deg, i) => {
        const a = deg * Math.PI / 180;
        const x = cx + Math.cos(a) * 16.5, z = cz + Math.sin(a) * 16.5;
        this.stall(props, x, z, Math.atan2(cx - x, cz - z), [['#e0484e', '#fff6e8'], ['#3f7fd1', '#fff4d6'], ['#2f9e6b', '#fbf2dc'], ['#e5a02d', '#fff7e4']][i]);
      });
      for (let i = 0; i < 8; i++) {
        const a = (i + 0.5) * Math.PI / 4;
        this.lamp(props, cx + Math.cos(a) * 13.8, cz + Math.sin(a) * 13.8);
      }
      [45, 135, 225, 315].forEach((deg) => {
        const a = deg * Math.PI / 180;
        const x = cx + Math.cos(a) * 9.5, z = cz + Math.sin(a) * 9.5;
        this.bench(props, x, z, Math.atan2(cx - x, cz - z));
        const fx = cx + Math.cos(a) * 6.2, fz = cz + Math.sin(a) * 6.2;
        this.planter(props, fx, fz, Math.atan2(cx - fx, cz - fz));
      });
      // Barrels and crates by the stalls and houses.
      [[8, -56], [-8, -56], [9.5, -88], [-9.5, -88], [22, -64], [-22, -80], [5.4, -40], [-5.6, -41]].forEach(([x, z], i) => {
        if (i % 2) this.barrel(props, x, z); else this.crate(props, x, z, i * 0.7);
      });

      this.gate(buildings, props);
      this.palisade();
      this.noticeBoard(props, 6.5, -44.5);

      this.mesh(buildings, { collide: true });
      this.mesh(props);

      this.blossomSpots.forEach(([x, z]) => this.treeAt('blossom', x, z, 1.15, true));
      [[-26, -96], [26, -96], [-30, -56], [30, -56], [-14, -100], [14, -100]].forEach(([x, z]) => this.treeAt('round', x, z, 1.0, true));
      this.flushTrees();
    }

    place(parts, x, z, rot, y) {
      const m = new THREE.Matrix4().makeRotationY(rot || 0);
      m.setPosition(x, y || 0, z);
      return (p) => { p.matrix = m; parts.push(p); };
    }

    house(parts, x, z, rot, o) {
      const add = this.place(parts, x, z, rot, 0.2);
      const { w, d, h } = o;
      const top = 0.5 + h;
      add({ geo: box, color: '#a39b8f', pos: [0, 0.25, 0], scale: [w + 0.4, 0.5, d + 0.4], jitter: 0.12 });
      add({ geo: box, color: o.wall, pos: [0, 0.5 + h / 2, 0], scale: [w, h, d] });
      // timber frame
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        add({ geo: box, color: o.trim, pos: [sx * (w / 2 - 0.05), 0.5 + h / 2, sz * (d / 2 - 0.05)], scale: [0.32, h, 0.32] });
      }
      const band = 0.5 + h * (h > 4 ? 0.52 : 0.98);
      add({ geo: box, color: o.trim, pos: [0, band, d / 2 + 0.02], scale: [w + 0.1, 0.26, 0.12] });
      add({ geo: box, color: o.trim, pos: [0, band, -d / 2 - 0.02], scale: [w + 0.1, 0.26, 0.12] });
      add({ geo: box, color: o.trim, pos: [w / 2 + 0.02, band, 0], scale: [0.12, 0.26, d + 0.1] });
      add({ geo: box, color: o.trim, pos: [-w / 2 - 0.02, band, 0], scale: [0.12, 0.26, d + 0.1] });
      // roof (ridge runs left-right) with eaves
      const rh = Math.min(w, d) * 0.62;
      add({ geo: U.prismGeometry(d + 1.1, w + 0.9, rh), color: o.roof, pos: [0, top, 0], rot: [0, Math.PI / 2, 0], jitter: 0.14 });
      add({ geo: box, color: U.shade(o.roof, -0.3), pos: [0, top + rh - 0.05, 0], scale: [w + 0.95, 0.18, 0.3] });
      add({ geo: box, color: '#9b8f80', pos: [w * 0.27, top + rh * 0.55, -d * 0.18], scale: [0.62, rh * 1.15, 0.62], jitter: 0.1 });
      add({ geo: box, color: '#6f665c', pos: [w * 0.27, top + rh * 1.12, -d * 0.18], scale: [0.75, 0.15, 0.75] });
      // door + step
      add({ geo: box, color: '#5a3520', pos: [0, 0.5 + 0.95, d / 2 + 0.05], scale: [1.15, 1.9, 0.14] });
      add({ geo: box, color: o.trim, pos: [0, 0.5 + 1.95, d / 2 + 0.07], scale: [1.45, 0.18, 0.18] });
      add({ geo: box, color: '#e8c35a', pos: [0.38, 0.5 + 0.95, d / 2 + 0.14], scale: [0.1, 0.1, 0.06] });
      add({ geo: box, color: '#b3aa9c', pos: [0, 0.1, d / 2 + 0.55], scale: [1.6, 0.2, 0.7] });
      // windows with flower boxes
      const flowers = ['#ff6b8b', '#ffd84d', '#ff8f4d', '#b38cff'];
      const win = (px, py, pz, ry) => {
        const nx = Math.sin(ry), nz = Math.cos(ry); // outward normal
        const at = (o, dy) => [px + nx * o, py + (dy || 0), pz + nz * o];
        const r = [0, ry, 0];
        add({ geo: box, color: o.trim, pos: at(0.05), rot: r, scale: [1.08, 1.08, 0.1] });
        add({ geo: box, color: '#a8dcff', pos: at(0.09), rot: r, scale: [0.8, 0.8, 0.06] });
        add({ geo: box, color: '#fff8ea', pos: at(0.13), rot: r, scale: [0.07, 0.8, 0.03] });
        add({ geo: box, color: '#8a5a36', pos: at(0.22, -0.6), rot: r, scale: [1.0, 0.22, 0.3] });
        add({ geo: box, color: flowers[(this._win = (this._win || 0) + 1) % 4], pos: at(0.22, -0.44), rot: r, scale: [0.85, 0.14, 0.2] });
      };
      const wy = 0.5 + Math.min(1.9, h * 0.55);
      win(-w * 0.3, wy, d / 2, 0); win(w * 0.3, wy, d / 2, 0);
      win(w / 2, wy, 0, Math.PI / 2); win(-w / 2, wy, 0, -Math.PI / 2);
      if (h > 4) { win(-w * 0.3, wy + 2.1, d / 2, 0); win(w * 0.3, wy + 2.1, d / 2, 0); win(0, wy + 2.1, -d / 2, Math.PI); }
      this.nav.blockRect(x, z, w / 2 + 0.2, d / 2 + 0.2, rot);
    }

    fountain(parts, x, z) {
      const add = this.place(parts, x, z, 0, 0.2);
      const cyl = (rt, rb, h, s) => new THREE.CylinderGeometry(rt, rb, h, s || 10);
      add({ geo: cyl(3.4, 3.6, 0.3, 10), color: '#b9b2a6', pos: [0, 0.15, 0], jitter: 0.08 });
      add({ geo: cyl(3.2, 3.3, 0.8, 10, true), color: '#cfc8bb', pos: [0, 0.6, 0], jitter: 0.1 });
      add({ geo: cyl(0.55, 0.75, 1.9, 8), color: '#c4bdb0', pos: [0, 1.4, 0] });
      add({ geo: cyl(1.4, 0.6, 0.45, 8), color: '#d3ccbf', pos: [0, 2.45, 0], jitter: 0.08 });
      add({ geo: cyl(0.25, 0.32, 0.6, 6), color: '#c4bdb0', pos: [0, 2.9, 0] });
      add({ geo: new THREE.IcosahedronGeometry(0.32, 0), color: '#f0c75a', pos: [0, 3.35, 0] });
      const waterMat = new THREE.MeshStandardMaterial({ color: '#63c3f0', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.85 });
      const w1 = new THREE.Mesh(new THREE.CircleGeometry(2.95, 20), waterMat);
      w1.rotation.x = -Math.PI / 2; w1.position.set(x, 1.12, z);
      const w2 = new THREE.Mesh(new THREE.CircleGeometry(1.25, 12), waterMat);
      w2.rotation.x = -Math.PI / 2; w2.position.set(x, 2.66, z);
      this.scene.add(w1, w2);
      this.fountainPos = new THREE.Vector3(x, 3.2, z);
      this.nav.blockCircle(x, z, 3.5);
      this.landmarks.push({ x, z, kind: 'fountain' });
    }

    stall(parts, x, z, rot, [c1, c2]) {
      const add = this.place(parts, x, z, rot, 0.2);
      add({ geo: box, color: '#8b5a35', pos: [0, 0.48, 0.2], scale: [2.8, 0.95, 1.2], jitter: 0.12 });
      add({ geo: box, color: '#a8744a', pos: [0, 0.98, 0.25], scale: [3.0, 0.1, 1.35] });
      for (const sx of [-1.35, 1.35]) for (const sz of [-0.45, 1.0]) add({ geo: box, color: '#6d4428', pos: [sx, 1.25, sz], scale: [0.14, 2.5, 0.14] });
      for (let i = 0; i < 6; i++) {
        add({ geo: box, color: i % 2 ? c2 : c1, pos: [-1.25 + i * 0.5, 2.45, 0.35], rot: [0.32, 0, 0], scale: [0.5, 0.08, 2.0] });
      }
      const goods = ['#e2383f', '#f5a623', '#8fd14f', '#f3d34a', '#c0392b'];
      for (let i = 0; i < 7; i++) {
        add({ geo: new THREE.IcosahedronGeometry(0.16, 0), color: goods[i % goods.length], pos: [-1.1 + i * 0.36, 1.15, 0.45 + (i % 2) * 0.25] });
      }
      add({ geo: box, color: '#c9a36a', pos: [0.9, 0.25, 1.35], rot: [0, 0.4, 0], scale: [0.6, 0.5, 0.6], jitter: 0.1 });
      this.nav.blockRect(x, z, 1.5, 0.95, rot);
    }

    lamp(parts, x, z) {
      const add = this.place(parts, x, z, 0, 0.2);
      add({ geo: new THREE.CylinderGeometry(0.16, 0.22, 0.3, 6), color: '#3c414d', pos: [0, 0.15, 0] });
      add({ geo: new THREE.CylinderGeometry(0.07, 0.09, 2.7, 6), color: '#3c414d', pos: [0, 1.5, 0] });
      add({ geo: box, color: '#ffe9a8', pos: [0, 3.0, 0], scale: [0.36, 0.42, 0.36] });
      add({ geo: new THREE.ConeGeometry(0.34, 0.3, 4), color: '#30343e', pos: [0, 3.36, 0], rot: [0, Math.PI / 4, 0] });
      this.nav.blockCircle(x, z, 0.18);
    }

    bench(parts, x, z, rot) {
      const add = this.place(parts, x, z, rot, 0.2);
      add({ geo: box, color: '#a8744a', pos: [0, 0.45, 0], scale: [1.9, 0.1, 0.55], jitter: 0.1 });
      add({ geo: box, color: '#a8744a', pos: [0, 0.8, -0.25], scale: [1.9, 0.38, 0.08] });
      for (const sx of [-0.8, 0.8]) add({ geo: box, color: '#4a4f5a', pos: [sx, 0.22, 0], scale: [0.1, 0.45, 0.5] });
      this.nav.blockRect(x, z, 0.95, 0.3, rot);
    }

    planter(parts, x, z, rot) {
      const add = this.place(parts, x, z, rot, 0.2);
      add({ geo: box, color: '#b7ae9f', pos: [0, 0.3, 0], scale: [2.2, 0.6, 1.0], jitter: 0.1 });
      add({ geo: box, color: '#6b4a2f', pos: [0, 0.58, 0], scale: [2.0, 0.06, 0.8] });
      const cols = ['#ff6b8b', '#ffd84d', '#ffffff', '#b38cff', '#ff9f43'];
      for (let i = 0; i < 10; i++) {
        add({ geo: new THREE.IcosahedronGeometry(0.15, 0), color: cols[i % 5], pos: [-0.85 + (i % 5) * 0.42, 0.75, i < 5 ? -0.18 : 0.2] });
        add({ geo: new THREE.IcosahedronGeometry(0.17, 0), color: '#4f9b43', pos: [-0.75 + (i % 5) * 0.4, 0.66, i < 5 ? 0.15 : -0.2] });
      }
      this.nav.blockRect(x, z, 1.1, 0.5, rot);
    }

    barrel(parts, x, z) {
      const add = this.place(parts, x, z, 0, 0.2);
      add({ geo: new THREE.CylinderGeometry(0.42, 0.42, 1.0, 8), color: '#9a6338', pos: [0, 0.5, 0], jitter: 0.1 });
      add({ geo: new THREE.CylinderGeometry(0.45, 0.45, 0.08, 8), color: '#4d4f55', pos: [0, 0.2, 0] });
      add({ geo: new THREE.CylinderGeometry(0.45, 0.45, 0.08, 8), color: '#4d4f55', pos: [0, 0.8, 0] });
      this.nav.blockCircle(x, z, 0.45);
    }
    crate(parts, x, z, rot) {
      const add = this.place(parts, x, z, rot, 0.2);
      add({ geo: box, color: '#b98a52', pos: [0, 0.4, 0], scale: [0.8, 0.8, 0.8], jitter: 0.15 });
      add({ geo: box, color: '#8b6236', pos: [0, 0.4, 0], scale: [0.84, 0.12, 0.84] });
      this.nav.blockRect(x, z, 0.42, 0.42, rot);
    }

    noticeBoard(parts, x, z) {
      const add = this.place(parts, x, z, Math.PI, 0.2);
      for (const sx of [-0.8, 0.8]) add({ geo: box, color: '#6d4428', pos: [sx, 1.0, 0], scale: [0.14, 2.0, 0.14] });
      add({ geo: box, color: '#a8744a', pos: [0, 1.45, 0], scale: [1.9, 1.1, 0.1] });
      add({ geo: box, color: '#f3ead5', pos: [-0.4, 1.5, 0.07], rot: [0, 0, 0.06], scale: [0.55, 0.7, 0.02] });
      add({ geo: box, color: '#fde7b0', pos: [0.4, 1.4, 0.07], rot: [0, 0, -0.05], scale: [0.55, 0.6, 0.02] });
      add({ geo: new THREE.ConeGeometry(1.35, 0.4, 4), color: '#7c4a2c', pos: [0, 2.2, 0], rot: [0, Math.PI / 4, 0], scale: [1, 1, 0.3] });
      this.nav.blockRect(x, z, 1.0, 0.2, Math.PI);
    }

    gate(buildings, props) {
      const gz = C.TOWN.cz + C.TOWN.radius + 0.8;
      for (const sx of [-1, 1]) {
        const x = sx * 3.7;
        const add = this.place(buildings, x, gz, 0, 0.2);
        add({ geo: new THREE.CylinderGeometry(1.05, 1.2, 4.6, 8), color: '#c2baa9', pos: [0, 2.3, 0], jitter: 0.12 });
        add({ geo: new THREE.CylinderGeometry(1.3, 1.3, 0.35, 8), color: '#a9a090', pos: [0, 4.7, 0] });
        add({ geo: new THREE.ConeGeometry(1.45, 2.0, 8), color: '#3f6fc4', pos: [0, 5.85, 0], jitter: 0.12 });
        add({ geo: box, color: '#5a3520', pos: [0, 2.6, 1.0], rot: [0, 0, 0], scale: [0.45, 0.8, 0.12] });
        this.nav.blockCircle(x, gz, 1.2);
        // hanging banner
        const addp = this.place(props, x, gz, 0, 0.2);
        addp({ geo: box, color: '#d8434f', pos: [0, 3.2, 1.08], scale: [0.7, 1.5, 0.05] });
        addp({ geo: box, color: '#f4c84a', pos: [0, 3.25, 1.11], scale: [0.25, 0.25, 0.04] });
      }
      const add = this.place(buildings, 0, gz, 0, 0.2);
      add({ geo: box, color: '#6d4428', pos: [0, 4.2, 0], scale: [7.0, 0.45, 0.5], jitter: 0.1 });
      add({ geo: box, color: '#6d4428', pos: [0, 3.75, 0], scale: [6.4, 0.18, 0.3] });

      // Sign with the town name.
      const c = U.makeCanvas(512, 128), x = c.getContext('2d');
      x.fillStyle = '#7b4f2e'; x.fillRect(0, 0, 512, 128);
      x.strokeStyle = '#4b2e19'; x.lineWidth = 10; x.strokeRect(5, 5, 502, 118);
      x.fillStyle = '#ffe9b8'; x.font = '600 66px Fredoka, "Trebuchet MS", sans-serif';
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(C.TOWN.name, 256, 68);
      const tex = U.canvasTexture(c);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.85), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
      sign.position.set(0, 4.95, gz + 0.03);
      sign.castShadow = true;
      const back = sign.clone(); back.rotation.y = Math.PI; back.position.z = gz - 0.03;
      this.scene.add(sign, back);
      this.signRefresh = () => { x.fillStyle = '#7b4f2e'; x.fillRect(10, 10, 492, 108); x.fillStyle = '#ffe9b8'; x.fillText(C.TOWN.name, 256, 68); tex.needsUpdate = true; };
      this.landmarks.push({ x: 0, z: gz, kind: 'gate' });
    }

    palisade() {
      const T = C.TOWN, R = T.radius + 1;
      const geo = U.mergeParts([
        { geo: new THREE.CylinderGeometry(0.2, 0.24, 2.4, 6), color: '#8a5a33', pos: [0, 1.2, 0], jitter: 0.15 },
        { geo: new THREE.ConeGeometry(0.21, 0.5, 6), color: '#a77446', pos: [0, 2.65, 0] },
      ]);
      const list = [];
      const n = Math.round((Math.PI * 2 * R) / 0.5);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = T.cx + Math.cos(a) * R, z = T.cz + Math.sin(a) * R;
        if (z > T.cz && Math.abs(x) < 4.6) continue; // gate gap
        const s = 0.9 + this.rng() * 0.25;
        list.push({ x, y: 0.1, z, ry: this.rng() * 3, s: [1, s, 1], color: _c.setHSL(0.08, 0.2, 0.85 + this.rng() * 0.15).getStyle() });
        this.nav.blockCircle(x, z, 0.26);
      }
      this.instanced(geo, this.propMat, list, { cast: true });
    }

    /* ------------------------------------------------------------ trees */
    treeGeometries() {
      if (this._treeGeo) return this._treeGeo;
      const ico = (r) => new THREE.IcosahedronGeometry(r, 0);
      const trunk = new THREE.CylinderGeometry(0.2, 0.32, 2.2, 6);
      this._treeGeo = {
        round: U.mergeParts([
          { geo: trunk, color: '#8b5a33', pos: [0, 1.1, 0] },
          { geo: ico(1.45), color: '#4ea84a', pos: [0, 2.9, 0], jitter: 0.22 },
          { geo: ico(1.05), color: '#5cbd52', pos: [0.75, 2.4, 0.35], jitter: 0.22 },
          { geo: ico(1.0), color: '#67c95a', pos: [-0.55, 3.55, -0.25], jitter: 0.22 },
          { geo: ico(0.85), color: '#56b24d', pos: [-0.7, 2.3, 0.5], jitter: 0.22 },
        ]),
        blossom: U.mergeParts([
          { geo: trunk, color: '#7a4a35', pos: [0, 1.1, 0] },
          { geo: ico(1.5), color: '#f6b3cf', pos: [0, 2.95, 0], jitter: 0.18 },
          { geo: ico(1.05), color: '#fbc9dd', pos: [0.8, 2.45, 0.3], jitter: 0.18 },
          { geo: ico(1.0), color: '#f29dc1', pos: [-0.6, 3.6, -0.2], jitter: 0.18 },
          { geo: ico(0.9), color: '#fcd6e5', pos: [-0.7, 2.35, 0.5], jitter: 0.18 },
        ]),
        pine: U.mergeParts([
          { geo: new THREE.CylinderGeometry(0.18, 0.28, 1.6, 6), color: '#7a4c2c', pos: [0, 0.8, 0] },
          { geo: new THREE.ConeGeometry(1.5, 2.0, 7), color: '#3c8a52', pos: [0, 2.2, 0], jitter: 0.15 },
          { geo: new THREE.ConeGeometry(1.15, 1.8, 7), color: '#46995c', pos: [0, 3.25, 0], jitter: 0.15 },
          { geo: new THREE.ConeGeometry(0.75, 1.4, 7), color: '#52a867', pos: [0, 4.2, 0], jitter: 0.15 },
        ]),
      };
      return this._treeGeo;
    }
    treeAt(kind, x, z, s, block) {
      this._trees = this._trees || { round: [], blossom: [], pine: [] };
      const tint = _c.setHSL(0.25 + (this.rng() - 0.5) * 0.08, 0.25, 0.85 + this.rng() * 0.15).getStyle();
      this._trees[kind].push({ x, y: TR.height(x, z) - 0.05, z, ry: this.rng() * Math.PI * 2, s, color: tint });
      if (block) this.nav.blockCircle(x, z, 0.38 * s);
    }
    flushTrees() {
      const g = this.treeGeometries();
      for (const k of Object.keys(this._trees || {})) {   // none when a map's trees are editor objects
        this.instanced(g[k], this.foliageMat, this._trees[k], { cast: true });
        this._trees[k] = [];
      }
    }

    /* ------------------------------------------------------------ field */
    canPlace(x, z, opts) {
      opts = opts || {};
      const h = TR.height(x, z);
      if (h < 0.15) return false;
      if (TR.townFactor(x, z) > 0.02) return false;
      if (this.map.town && Math.hypot(x - C.TOWN.cx, z - C.TOWN.cz) < C.TOWN.radius + 4) return false;
      if (TR.pathDistance(x, z) < (opts.pathClear || 3.2)) return false;
      if (this.map.stream && Math.abs(z - TR.streamZ(x)) < (opts.streamClear || 6.5)) return false;
      if (TR.POND && Math.hypot(x - TR.POND.x, z - TR.POND.z) < TR.POND.r + 2) return false;
      for (const pt of this.map.portals || []) if (Math.hypot(x - pt.x, z - pt.z) < 5) return false;
      if (opts.spawnClear) {
        for (const s of this.map.spawns) if (Math.hypot(x - s.x, z - s.z) < s.r * opts.spawnClear) return false;
      }
      if (opts.inner && TR.boundaryRaw(x, z) > -1) return false;
      return true;
    }

    buildField() {
      // Decorations cover the map's own area (maps can be grown with the map editor).
      const FB = this.map.bounds || { minX: -104, maxX: 104, minZ: -112, maxZ: 106 };
      const areaK = Math.max(1, ((FB.maxX - FB.minX) * (FB.maxZ - FB.minZ)) / (208 * 218));
      const rng = this.rng;
      // Groves: noise-driven clusters plus scattered loners.
      let placed = 0;
      const F = this.map.forest, zMin = this.map.town ? -40 : -110;
      for (let i = 0; i < F.count * 12 && placed < F.count; i++) {
        const x = U.randRange(rng, -100, 100), z = U.randRange(rng, zMin, 104);
        const grove = U.fbm(x * 0.035 + 7, z * 0.035 - 2, 3);
        if (rng() > U.smoothstep(F.grove, F.grove + 0.24, grove) + 0.04) continue;
        if (!this.canPlace(x, z, { spawnClear: F.clearing, inner: true, pathClear: 3.6 })) continue;
        const kind = rng() < 0.38 ? 'pine' : 'round';
        this.treeAt(kind, x, z, 0.85 + rng() * 0.5, true);
        placed++;
      }
      // Trees between the town wall and the stream.
      for (let i = 0; i < (this.map.town ? 260 : 0); i++) {
        const x = U.randRange(rng, -100, 100), z = U.randRange(rng, -112, -30);
        const d = Math.hypot(x - C.TOWN.cx, z - C.TOWN.cz);
        if (d < C.TOWN.radius + 4 || Math.abs(x) < 9) continue;
        if (TR.height(x, z) < 0.15 || Math.abs(z - TR.streamZ(x)) < 5.5) continue;
        if (TR.boundaryRaw(x, z) > -1) continue;
        if (rng() < 0.55) this.treeAt(rng() < 0.5 ? 'pine' : 'round', x, z, 0.9 + rng() * 0.5, true);
      }
      // Dense forest ring along the map edge.
      for (let i = 0; i < 900 * areaK; i++) {
        const x = U.randRange(rng, -TR.HALF + 2, TR.HALF - 2), z = U.randRange(rng, -TR.HALF + 2, TR.HALF - 2);
        const b = TR.boundaryRaw(x, z);
        if (b < -5 || b > 12) continue;
        if (this.map.town && Math.hypot(x - C.TOWN.cx, z - C.TOWN.cz) < C.TOWN.radius + 3) continue;
        if (TR.height(x, z) < 0.15) continue;
        if ((this.map.portals || []).some((pt) => Math.hypot(x - pt.x, z - pt.z) < 6) || TR.pathDistance(x, z) < 3) continue;
        this.treeAt(rng() < 0.6 ? 'pine' : 'round', x, z, 1.0 + rng() * 0.7, b < 1);
      }
      this.flushTrees();

      // Rocks.
      const rockGeos = [0, 1, 2].map((k) => {
        const g = new THREE.IcosahedronGeometry(1, 0);
        const p = g.attributes.position, r = U.mulberry32(90 + k), cache = {};
        for (let i = 0; i < p.count; i++) {
          const key = [p.getX(i), p.getY(i), p.getZ(i)].map((v) => v.toFixed(3)).join();
          if (!cache[key]) cache[key] = 0.75 + r() * 0.45;
          p.setXYZ(i, p.getX(i) * cache[key], Math.max(-0.3, p.getY(i)) * cache[key] * 0.8, p.getZ(i) * cache[key]);
        }
        return U.mergeParts([{ geo: g, color: '#a3a39a', jitter: 0.2 }]);
      });
      const rocks = [[], [], []];
      for (let i = 0; i < 900 && rocks.flat().length < 110; i++) {
        const x = U.randRange(rng, FB.minX, FB.maxX), z = U.randRange(rng, FB.minZ, FB.maxZ);
        if (!this.canPlace(x, z, { pathClear: 2.6, streamClear: 4.2 })) continue;
        if (TR.boundaryAmount(x, z) > 6) continue;
        const big = rng() < 0.3;
        const s = big ? 0.9 + rng() * 0.9 : 0.25 + rng() * 0.35;
        rocks[i % 3].push({ x, y: TR.height(x, z) + s * 0.05, z, ry: rng() * 6, s: [s * (1 + rng() * 0.4), s, s], color: _c.setHSL(0.1, 0.06, 0.78 + rng() * 0.22).getStyle() });
        if (big) this.nav.blockCircle(x, z, s * 0.85);
      }
      rocks.forEach((list, k) => this.instanced(rockGeos[k], this.propMat, list, { cast: true }));

      // Bushes (decorative, walk-through).
      const ico = (r) => new THREE.IcosahedronGeometry(r, 0);
      const bushGeo = U.mergeParts([
        { geo: ico(0.7), color: '#4c9d43', pos: [0, 0.45, 0], jitter: 0.2 },
        { geo: ico(0.55), color: '#58ad4d', pos: [0.55, 0.35, 0.2], jitter: 0.2 },
        { geo: ico(0.5), color: '#5fb552', pos: [-0.5, 0.32, -0.15], jitter: 0.2 },
      ]);
      const berryGeo = U.mergeParts([
        { geo: ico(0.7), color: '#3f8f3d', pos: [0, 0.45, 0], jitter: 0.2 },
        { geo: ico(0.12), color: '#e8364a', pos: [0.4, 0.75, 0.45] },
        { geo: ico(0.12), color: '#e8364a', pos: [-0.3, 0.6, 0.55] },
        { geo: ico(0.12), color: '#e8364a', pos: [0.1, 1.0, 0.2] },
      ]);
      const bushes = [], berries = [];
      for (let i = 0; i < 1400 && bushes.length + berries.length < 240; i++) {
        const x = U.randRange(rng, FB.minX, FB.maxX), z = U.randRange(rng, FB.minZ, FB.maxZ);
        if (!this.canPlace(x, z, { pathClear: 2.2, streamClear: 4.5 })) continue;
        if (TR.boundaryAmount(x, z) > 2) continue;
        const it = { x, y: TR.height(x, z) - 0.1, z, ry: rng() * 6, s: 0.7 + rng() * 0.6, color: _c.setHSL(0.27, 0.3, 0.85 + rng() * 0.15).getStyle() };
        (rng() < 0.2 ? berries : bushes).push(it);
      }
      this.instanced(bushGeo, this.foliageMat, bushes, { cast: true });
      this.instanced(berryGeo, this.foliageMat, berries, { cast: true });

      // Grass tufts.
      const grassGeo = (() => {
        const v = [], c = [];
        const base = new THREE.Color('#4e8c3a'), tip = new THREE.Color('#b4e27a');
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI + 0.3, ox = Math.cos(a) * 0.12, oz = Math.sin(a) * 0.12;
          const lean = 0.15 * (k % 2 ? 1 : -1), h = 0.45 + (k % 3) * 0.12;
          v.push(-ox, 0, -oz, ox, 0, oz, lean * Math.cos(a + 1.57), h, lean * Math.sin(a + 1.57));
          c.push(base.r, base.g, base.b, base.r, base.g, base.b, tip.r, tip.g, tip.b);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
        g.computeVertexNormals();
        // Point normals upward so tufts take the ground's lighting.
        const n = g.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
        return g;
      })();
      const grass = [];
      for (let i = 0; i < 14000 && grass.length < 7000; i++) {
        const x = U.randRange(rng, FB.minX, FB.maxX), z = U.randRange(rng, FB.minZ, FB.maxZ);
        const h = TR.height(x, z);
        if (h < 0.08 || TR.boundaryAmount(x, z) > 3) continue;
        if (TR.pathDistance(x, z) < 1.8) continue;
        if (this.map.town && Math.hypot(x - C.TOWN.cx, z - C.TOWN.cz) < 15) continue;
        if (this.map.town && Math.abs(x) < 3 && z > -72 && z < -14) continue;
        if (TR.STREETS.some(([x1, z1, x2, z2, w]) => G.Utils.distToSegment(x, z, x1, z1, x2, z2) < w / 2 + 0.4)) continue;
        grass.push({ x, y: h - 0.02, z, ry: rng() * 6, s: 0.7 + rng() * 0.8, color: _c.setHSL(0.24 + rng() * 0.05, 0.35, 0.8 + rng() * 0.2).getStyle() });
      }
      this.instanced(grassGeo, this.grassMat, grass, { cast: false });

      // Flowers: stem + coloured head instanced separately.
      const stemGeo = new THREE.CylinderGeometry(0.02, 0.025, 0.36, 4); stemGeo.translate(0, 0.18, 0);
      const headGeo = new THREE.IcosahedronGeometry(0.1, 0); headGeo.translate(0, 0.38, 0);
      const stems = [], heads = [];
      const palette = ['#ff6b8b', '#ffd84d', '#ffffff', '#b38cff', '#ff9f43', '#7cc8ff', '#ff5e7a'];
      for (let i = 0; i < 9000 && heads.length < 2200; i++) {
        const x = U.randRange(rng, FB.minX, FB.maxX), z = U.randRange(rng, FB.minZ, FB.maxZ);
        const patch = U.noise2(x * 0.09 + 40, z * 0.09);
        if (patch < 0.6 && rng() > 0.08) continue;
        if (!this.canPlace(x, z, { pathClear: 1.8, streamClear: 4 })) {
          if (!(this.map.town && TR.townFactor(x, z) > 0.5 && Math.hypot(x - C.TOWN.cx, z - C.TOWN.cz) > 15 && rng() < 0.3 && Math.abs(x) > 3)) continue;
        }
        const h = TR.height(x, z), s = 0.8 + rng() * 0.6, ry = rng() * 6;
        const col = palette[(U.noise2(x * 0.3, z * 0.3) * palette.length) | 0];
        stems.push({ x, y: h - 0.02, z, ry, s, color: '#5aa043' });
        heads.push({ x, y: h - 0.02, z, ry, s, color: col });
      }
      const stemMat = new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 1 });
      const headMat = new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 0.6, emissive: '#222222' });
      this.instanced(stemGeo, stemMat, stems);
      this.instanced(headGeo, headMat, heads);

      // Mushrooms, fallen logs, signpost, pond details.
      const mushGeo = U.mergeParts([
        { geo: new THREE.CylinderGeometry(0.07, 0.09, 0.25, 6), color: '#f4ecd8', pos: [0, 0.12, 0] },
        { geo: new THREE.SphereGeometry(0.2, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), color: '#e0453f', pos: [0, 0.22, 0] },
        { geo: new THREE.IcosahedronGeometry(0.035, 0), color: '#ffffff', pos: [0.1, 0.36, 0.05] },
        { geo: new THREE.IcosahedronGeometry(0.03, 0), color: '#ffffff', pos: [-0.08, 0.38, -0.06] },
      ]);
      const mush = [], mushMax = this.map.forest.giants ? 220 : 70;
      for (let i = 0; i < 2400 && mush.length < mushMax; i++) {
        const x = U.randRange(rng, -100, 100), z = U.randRange(rng, this.map.town ? -30 : -108, 104);
        if (!this.canPlace(x, z, { pathClear: 2 })) continue;
        if (U.fbm(x * 0.035 + 7, z * 0.035 - 2, 3) < 0.5) continue;
        mush.push({ x, y: TR.height(x, z) - 0.02, z, ry: rng() * 6, s: 0.8 + rng() * 0.9 });
      }
      this.instanced(mushGeo, this.propMat, mush);

      const logs = [];
      for (let i = 0; i < 300 && logs.length < 8; i++) {
        const x = U.randRange(rng, -90, 90), z = U.randRange(rng, -10, 100);
        if (!this.canPlace(x, z, { pathClear: 5, spawnClear: 0.8, inner: true })) continue;
        const ry = rng() * Math.PI;
        logs.push({ x, y: TR.height(x, z) + 0.3, z, rx: 0, ry, rz: Math.PI / 2, s: 1 });
        this.nav.blockRect(x, z, 0.35, 1.5, ry);
      }
      const logGeo = U.mergeParts([
        { geo: new THREE.CylinderGeometry(0.32, 0.36, 3, 7), color: '#7d532f', jitter: 0.15 },
        { geo: new THREE.CylinderGeometry(0.26, 0.26, 0.04, 7), color: '#d3a46e', pos: [0, 1.51, 0] },
        { geo: new THREE.IcosahedronGeometry(0.2, 0), color: '#58a74a', pos: [0.25, 0.4, 0.2] },
      ]);
      const logMat = this.propMat;
      // logs are rotated so their axis lies flat; rotation order matters
      const lm = new THREE.InstancedMesh(logGeo, logMat, logs.length);
      logs.forEach((l, i) => {
        _o.position.set(l.x, l.y, l.z); _o.rotation.set(0, l.ry, Math.PI / 2, 'YXZ'); _o.scale.setScalar(1); _o.updateMatrix();
        lm.setMatrixAt(i, _o.matrix);
        lm.setColorAt(i, _c.set('#ffffff'));
      });
      lm.castShadow = true; lm.receiveShadow = true; lm.frustumCulled = false;
      this.scene.add(lm);
      _o.rotation.order = 'XYZ';

      if (this.map.forest.giants) this.giantMushrooms();
      if (!this.map.bridge) { if (TR.POND) this.pondDetails(); return; }

      // Signpost at the meadow side of the bridge.
      const sp = [], sx = 3.6, sz = TR.BRIDGE_Z + C.BRIDGE.halfLength + 2.5;
      const add = this.place(sp, sx, sz, 0.2, TR.height(sx, sz));
      add({ geo: box, color: '#7a4c2c', pos: [0, 1.1, 0], scale: [0.16, 2.2, 0.16] });
      add({ geo: box, color: '#c99a62', pos: [0.5, 1.8, 0], rot: [0, 0, 0.05], scale: [1.1, 0.32, 0.08] });
      add({ geo: new THREE.ConeGeometry(0.2, 0.3, 3), color: '#c99a62', pos: [1.18, 1.83, 0], rot: [0, 0, -Math.PI / 2], scale: [1, 1, 0.3] });
      add({ geo: box, color: '#b7884f', pos: [-0.45, 1.4, 0], rot: [0, 0, -0.06], scale: [1.0, 0.3, 0.08] });
      this.mesh(sp);
      this.nav.blockCircle(sx, sz, 0.2);

      this.pondDetails();
    }

    pondDetails() {
      const rng = this.rng;
      // Pond: lily pads and reeds.
      const P = TR.POND, pads = [], reeds = [];
      for (let i = 0; i < 24; i++) {
        const a = rng() * Math.PI * 2, r = rng() * (P.r - 3);
        pads.push({ x: P.x + Math.cos(a) * r, y: C.WATER_LEVEL + 0.03, z: P.z + Math.sin(a) * r, ry: rng() * 6, s: 0.6 + rng() * 0.6, color: i % 6 === 0 ? '#ff9ec2' : '#4f9e46' });
      }
      for (let i = 0; i < 70; i++) {
        const a = rng() * Math.PI * 2, r = P.r - 2.5 + rng() * 2.5;
        const x = P.x + Math.cos(a) * r, z = P.z + Math.sin(a) * r;
        reeds.push({ x, y: Math.max(TR.height(x, z), C.WATER_LEVEL) - 0.05, z, ry: rng() * 6, s: [1, 0.7 + rng() * 0.8, 1], color: '#ffffff' });
      }
      const padGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.04, 8, 1, false, 0.3, Math.PI * 1.8);
      this.instanced(padGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 0.6 }), pads);
      const reedGeo = U.mergeParts([
        { geo: new THREE.CylinderGeometry(0.02, 0.03, 1.4, 4), color: '#6f9f45', pos: [0, 0.7, 0] },
        { geo: new THREE.CylinderGeometry(0.06, 0.06, 0.3, 5), color: '#7a4a2a', pos: [0, 1.35, 0] },
        { geo: new THREE.CylinderGeometry(0.02, 0.03, 1.1, 4), color: '#7aac4c', pos: [0.12, 0.55, 0.05], rot: [0, 0, -0.15] },
      ]);
      this.instanced(reedGeo, this.grassMat, reeds);
      this.landmarks.push({ x: P.x, z: P.z, kind: 'pond' });
    }

    /* ------------------------------------------------------------ caves */
    buildCave() {
      const rng = this.rng, TRd = TR.caveDist;
      const cone = new THREE.ConeGeometry(1, 1, 6);
      const stal = [], props = [];
      // Stalagmites along the foot of the walls.
      for (let i = 0; i < 9000 && stal.length < 260; i++) {
        const x = U.randRange(rng, -100, 100), z = U.randRange(rng, -100, 100), d = TRd(x, z);
        if (d < 0.2 || d > 3) continue;
        const s = 0.5 + rng() * 1.4, y = TR.height(x, z);
        stal.push({ x, y: y - 0.1, z, ry: rng() * 6, s: [s * 0.6, s * (1.0 + rng() * 0.9), s * 0.6], color: _c.setHSL(0.07, 0.12, 0.55 + rng() * 0.25).getStyle() });
        if (d < 0.9) this.nav.blockCircle(x, z, s * 0.35);
      }
      this.instanced(U.mergeParts([{ geo: cone, color: '#8a7f70', pos: [0, 0.5, 0], jitter: 0.2 }]), this.propMat, stal, { cast: true });

      // Glowing crystal clusters.
      const oct = new THREE.OctahedronGeometry(1, 0);
      const cols = ['#7fe8ff', '#b98cff', '#ff9ad6'];
      const groups = cols.map(() => []);
      for (let i = 0; i < 6000 && groups.flat().length < 120; i++) {
        const x = U.randRange(rng, -100, 100), z = U.randRange(rng, -100, 100), d = TRd(x, z);
        if (d < 0 || d > 2.2) continue;
        const g = groups[(rng() * 3) | 0], y = TR.height(x, z);
        for (let k = 0; k < 3; k++) {
          const s = 0.25 + rng() * 0.45;
          g.push({ geo: oct, color: '#ffffff', pos: [x + (rng() - 0.5) * 0.9, y + s * 1.2, z + (rng() - 0.5) * 0.9], rot: [rng() * 0.6, rng() * 3, rng() * 0.6], scale: [s * 0.55, s * 1.6, s * 0.55] });
        }
      }
      // One mesh per colour so each glows in its own hue.
      groups.forEach((g, i) => {
        if (!g.length) return;
        const mat = new THREE.MeshStandardMaterial({ color: cols[i], flatShading: true, roughness: 0.25, emissive: cols[i], emissiveIntensity: 0.7 });
        this.mesh(g, { mat, cast: false });
      });

      // Torches along the corridors; a few of them cast real light.
      const flameTex = U.radialTexture(64, 0.15, 1.0);
      this.torches = [];
      let lights = 0;
      for (const path of this.map.paths) {
        for (let i = 0; i < path.length - 1; i++) {
          const [ax, az] = path[i], [bx, bz] = path[i + 1], len = Math.hypot(bx - ax, bz - az);
          for (let t = 6; t < len; t += 14) {
            const k = t / len, x0 = ax + (bx - ax) * k, z0 = az + (bz - az) * k;
            const nx = -(bz - az) / len, nz = (bx - ax) / len, side = (i + t) % 2 ? 1 : -1;
            const x = x0 + nx * side * ((this.map.corridor || 3.4) - 0.5), z = z0 + nz * side * ((this.map.corridor || 3.4) - 0.5);
            const y = TR.height(x, z);
            props.push({ geo: new THREE.CylinderGeometry(0.08, 0.12, 2.0, 6), color: '#5a3a22', pos: [x, y + 1.0, z] });
            props.push({ geo: new THREE.CylinderGeometry(0.18, 0.12, 0.25, 6), color: '#3c414d', pos: [x, y + 2.05, z] });
            const fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, color: '#ffb05a', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
            fl.position.set(x, y + 2.35, z); fl.scale.set(0.9, 1.2, 1);
            this.scene.add(fl);
            let light = null;
            if (lights < 10) { light = new THREE.PointLight('#ffb366', 1.6, 16, 2); light.position.set(x, y + 2.6, z); this.scene.add(light); lights++; }
            this.torches.push({ fl, light, phase: rng() * 10 });
            this.nav.blockCircle(x, z, 0.15);
          }
        }
      }
      // Bones, rubble and mushrooms on the floor.
      const ico = new THREE.IcosahedronGeometry(1, 0);
      for (let i = 0; i < 4000 && props.length < 600; i++) {
        const x = U.randRange(rng, -100, 100), z = U.randRange(rng, -100, 100), d = TRd(x, z);
        if (d > -0.6 || d < -6) continue;
        const y = TR.height(x, z), r = rng();
        if (r < 0.4) props.push({ geo: ico, color: '#8a8478', pos: [x, y + 0.1, z], scale: [0.25 + rng() * 0.3, 0.18, 0.25 + rng() * 0.3], jitter: 0.2 });
        else if (r < 0.6) props.push({ geo: new THREE.CylinderGeometry(0.05, 0.05, 0.7, 5), color: '#efe6d2', pos: [x, y + 0.06, z], rot: [Math.PI / 2, 0, rng() * 3] });
        else if (r < 0.8) {
          props.push({ geo: new THREE.CylinderGeometry(0.05, 0.07, 0.22, 5), color: '#f1e6cf', pos: [x, y + 0.11, z] });
          props.push({ geo: new THREE.SphereGeometry(0.16, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2), color: ['#c96a4a', '#7fe8ff', '#b98cff'][(rng() * 3) | 0], pos: [x, y + 0.2, z] });
        }
      }
      // A ring of crystals around the boss chamber.
      const boss = (this.map.rooms || []).slice(-1)[0];
      if (boss) for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2, x = boss.x + Math.cos(a) * (boss.r - 1.2), z = boss.z + Math.sin(a) * (boss.r - 1.2);
        props.push({ geo: oct, color: '#ffd84a', pos: [x, TR.height(x, z) + 0.9, z], scale: [0.35, 1.2, 0.35] });
      }
      this.mesh(props);
      this.updaters.push((dt, time) => {
        for (const t of this.torches) {
          const f = 0.85 + Math.sin(time * 11 + t.phase) * 0.08 + Math.sin(time * 23 + t.phase * 2) * 0.06;
          t.fl.scale.set(0.9 * f, 1.25 * f, 1);
          if (t.light) t.light.intensity = 1.6 * f;
        }
      });
    }

    // Whisperwood's landmark: oversized glowing mushrooms in the clearings.
    giantMushrooms() {
      const rng = this.rng, parts = [], glow = [];
      for (let i = 0; i < 900 && parts.length < 60; i++) {
        const x = U.randRange(rng, -96, 96), z = U.randRange(rng, -100, 100);
        if (!this.canPlace(x, z, { pathClear: 4, spawnClear: 0.85, inner: true })) continue;
        const s = 1.5 + rng() * 2.2, y = TR.height(x, z), caps = ['#e85a7a', '#f2a03c', '#a86ad9', '#5fb8e8'];
        const col = caps[(rng() * caps.length) | 0];
        parts.push({ geo: new THREE.CylinderGeometry(0.22 * s, 0.3 * s, 1.4 * s, 7), color: '#f1e6cf', pos: [x, y + 0.7 * s, z] });
        parts.push({ geo: new THREE.SphereGeometry(0.85 * s, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2), color: col, pos: [x, y + 1.35 * s, z], jitter: 0.1 });
        for (let k = 0; k < 4; k++) {
          const a = rng() * Math.PI * 2, r = rng() * 0.5 * s;
          parts.push({ geo: new THREE.IcosahedronGeometry(0.1 * s, 0), color: '#fff8e8', pos: [x + Math.cos(a) * r, y + 1.35 * s + 0.65 * s * Math.sqrt(1 - (r / (0.85 * s)) ** 2), z + Math.sin(a) * r] });
        }
        glow.push([x, y + 1.3 * s, z, col]);
        this.nav.blockCircle(x, z, 0.3 * s);
      }
      if (parts.length) this.mesh(parts);
      this.glowSpots = glow;
    }

    update(dt, time) {
      this.wind.value = time;
      for (const f of this.updaters) f(dt, time);
    }
  }

  G.Environment = Environment;
})(window.G = window.G || {});
