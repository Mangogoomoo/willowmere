/* Terrain: generates the height field, the coloured ground mesh, water, the
   cobbled town streets and the bridge. Height queries match the rendered
   triangles exactly, so sprites never float or sink. */
(function (G) {
  'use strict';
  const U = G.Utils, C = G.Config;

  // The world's size can differ per map (the map editor can grow a map in any direction).
  let SIZE = C.WORLD_SIZE, HALF = SIZE / 2;
  let SEG = 160, STEP = SIZE / SEG;
  const T = C.TOWN;

  // Cobbled town streets: [x1,z1,x2,z2,width]
  const TOWN_STREETS = [
    [0, -59, 0, -29.5, 4.4],
    [13, -72, 34, -72, 4],
    [-13, -72, -34, -72, 4],
    [0, -85, 0, -106, 4],
  ];
  const streamZ = (x) => -23 + 3.2 * Math.sin(x * 0.045) + 1.6 * Math.sin(x * 0.11 + 1.0);

  // The current map (see data/maps.js). Set by init(map).
  let M = null, FIELD_PATHS = [], STREETS = [], POND = null, BRIDGE_Z = -9999, SEED = 0;

  function setMap(map) {
    M = map;
    FIELD_PATHS = map.paths || [];
    STREETS = map.town ? TOWN_STREETS : [];
    POND = map.pond || null;
    BRIDGE_Z = map.bridge ? streamZ(C.BRIDGE.x) : -9999;
    SEED = map.seed || 0;
    setPalette(map.palette || {});
  }

  function townFactor(x, z) {
    if (!M.town) return 0;
    const d = Math.hypot(x - T.cx, z - T.cz);
    return 1 - U.smoothstep(T.radius + 1, T.radius + 11, d);
  }
  function pathDistance(x, z) {
    let best = Infinity;
    for (const p of FIELD_PATHS) best = Math.min(best, U.distToPolyline(x, z, p));
    return best;
  }
  // Signed distance past the playable edge (negative = inside the map).
  function boundaryRaw(x, z) {
    // A map edited with the map editor has its own edges; hills rise beyond them.
    const b = M && M.bounds;
    if (b) return Math.max(b.minX - x, x - b.maxX, b.minZ - z, z - b.maxZ);
    return Math.max(Math.abs(x) - 100, z - 102, -z - 112);
  }
  function boundaryAmount(x, z) { return Math.max(0, boundaryRaw(x, z)); }

  // Caves: distance to the nearest open floor (negative inside a corridor/room).
  function caveDist(x, z) {
    let d = Infinity;
    for (const p of FIELD_PATHS) d = Math.min(d, U.distToPolyline(x, z, p) - (M.corridor || 3.4));
    for (const r of M.rooms || []) d = Math.min(d, Math.hypot(x - r.x, z - r.z) - r.r);
    return d;
  }

  // The analytic shape of the land (only used to bake the grid).
  function rawHeight(x, z) {
    if (M.cave) {
      const d = caveDist(x, z) + (U.noise2(x * 0.25 + SEED, z * 0.25) - 0.5) * 1.6;
      let h = 0.2 + (U.noise2(x * 0.35, z * 0.35) - 0.5) * 0.12;
      h += U.smoothstep(-0.2, 2.2, d) * (3.25 + U.fbm(x * 0.08 + SEED, z * 0.08, 3) * 1.75);
      return h;
    }
    let h = 0.25;
    const hills = U.fbm(x * 0.022 + 3.1 + SEED, z * 0.022 - 5.3 + SEED * 0.7, 4);
    h += Math.max(0, hills - 0.43) * (M.hills || 10);
    h += (U.noise2(x * 0.16 + SEED, z * 0.16) - 0.5) * 0.35;

    const pd = pathDistance(x, z);
    const pf = 1 - U.smoothstep(1.8, 7, pd);
    h = U.lerp(h, 0.22, pf * 0.9);

    const tf = townFactor(x, z);
    h = U.lerp(h, 0.2, tf);

    // stream
    if (M.stream) {
      const sd = Math.abs(z - streamZ(x));
      h -= (1 - U.smoothstep(2.4, 5.6, sd)) * 1.7;
    }
    // pond (flattened first so it sits in a level hollow)
    if (POND) {
      const po = Math.hypot(x - POND.x, z - POND.z);
      h = U.lerp(h, 0.25, 1 - U.smoothstep(POND.r + 1, POND.r + 7, po));
      h -= (1 - U.smoothstep(POND.r - 4, POND.r + 1.5, po)) * 2.1;
    }

    // surrounding hills form the edge of the playable map
    const b = boundaryAmount(x, z);
    if (b > 0) h += b * b * 0.11 + b * 0.5 + U.fbm(x * 0.06, z * 0.06, 3) * b * 0.5;
    return h;
  }

  let N = SEG + 1;
  let heights = new Float32Array(N * N);

  // Exact height on the rendered triangle mesh (PlaneGeometry triangulation).
  function height(x, z) {
    let gx = (x + HALF) / STEP, gz = (z + HALF) / STEP;
    gx = U.clamp(gx, 0, SEG - 0.0001); gz = U.clamp(gz, 0, SEG - 0.0001);
    const ix = gx | 0, iz = gz | 0, u = gx - ix, v = gz - iz;
    const ha = heights[iz * N + ix], hb = heights[(iz + 1) * N + ix];
    const hc = heights[(iz + 1) * N + ix + 1], hd = heights[iz * N + ix + 1];
    if (u + v <= 1) return ha + (hd - ha) * u + (hb - ha) * v;
    return hc + (hb - hc) * (1 - u) + (hd - hc) * (1 - v);
  }

  function onBridge(x, z) {
    if (!M.bridge) return false;
    return Math.abs(x - C.BRIDGE.x) <= C.BRIDGE.halfWidth && Math.abs(z - BRIDGE_Z) <= C.BRIDGE.halfLength;
  }
  function bridgeDeck(z) {
    const t = (z - BRIDGE_Z) / C.BRIDGE.halfLength;
    return 0.3 + 0.8 * (1 - t * t);
  }
  // Height of whatever you would stand on.
  function surfaceHeight(x, z) {
    const h = height(x, z);
    if (onBridge(x, z)) return Math.max(h, bridgeDeck(z));
    return h;
  }
  function isWater(x, z) {
    return height(x, z) < C.WATER_LEVEL + 0.12 && !onBridge(x, z);
  }
  const _n = new THREE.Vector3();
  function normalAt(x, z, out) {
    const e = 0.4;
    const hx = surfaceHeight(x + e, z) - surfaceHeight(x - e, z);
    const hz = surfaceHeight(x, z + e) - surfaceHeight(x, z - e);
    return (out || _n).set(-hx, 2 * e, -hz).normalize();
  }

  // March a ray against the surface. Returns a Vector3 or null.
  function raycast(ray, maxDist) {
    maxDist = maxDist || 500;
    const o = ray.origin, d = ray.direction;
    let prevT = 0, step = 0.35;
    for (let t = 0.5; t < maxDist; t += step) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (Math.abs(x) > HALF || Math.abs(z) > HALF) { if (t > 60) break; prevT = t; continue; }
      if (y <= surfaceHeight(x, z)) {
        let a = prevT, b = t;
        for (let i = 0; i < 10; i++) {
          const m = (a + b) / 2;
          const mx = o.x + d.x * m, my = o.y + d.y * m, mz = o.z + d.z * m;
          if (my <= surfaceHeight(mx, mz)) b = m; else a = m;
        }
        const p = new THREE.Vector3(o.x + d.x * b, 0, o.z + d.z * b);
        p.y = surfaceHeight(p.x, p.z);
        p.t = b;
        return p;
      }
      prevT = t;
      step = Math.min(1.2, 0.35 + t * 0.01);
    }
    return null;
  }

  /* ---------- textures ---------- */
  function grassDetailTexture() {
    const s = 256, c = U.makeCanvas(s, s), x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, s, s);
    const rng = U.mulberry32(11);
    for (let i = 0; i < 2600; i++) {
      const v = 205 + rng() * 50 | 0;
      x.strokeStyle = `rgb(${v},${v},${v})`;
      x.lineWidth = 1 + rng() * 1.5;
      const px = rng() * s, py = rng() * s;
      x.beginPath(); x.moveTo(px, py); x.lineTo(px + (rng() - 0.5) * 4, py - 3 - rng() * 5); x.stroke();
    }
    return U.canvasTexture(c, { repeat: [60, 60], anisotropy: 4 });
  }
  function cobbleTexture() {
    const s = 256, c = U.makeCanvas(s, s), x = c.getContext('2d');
    x.fillStyle = '#7d7366'; x.fillRect(0, 0, s, s);
    const rng = U.mulberry32(5), n = 7, cell = s / n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const off = (j % 2) * cell * 0.5;
      const w = cell * (0.8 + rng() * 0.12), h = cell * (0.78 + rng() * 0.12);
      const px = i * cell + off + (cell - w) / 2, py = j * cell + (cell - h) / 2;
      const tint = 168 + rng() * 40 | 0;
      const draw = (ox) => {
        x.fillStyle = `rgb(${tint + 8},${tint + 2},${tint - 12})`;
        x.beginPath();
        if (x.roundRect) x.roundRect(px + ox, py, w, h, 9); else x.rect(px + ox, py, w, h);
        x.fill();
        x.fillStyle = 'rgba(255,255,255,0.18)';
        x.fillRect(px + ox + 5, py + 4, w * 0.5, 3);
      };
      draw(0); if (px + w > s) draw(-s);
    }
    return U.canvasTexture(c, { anisotropy: 4 });
  }
  function plankTexture() {
    const c = U.makeCanvas(128, 256), x = c.getContext('2d');
    const rng = U.mulberry32(3);
    for (let i = 0; i < 16; i++) {
      const v = rng();
      x.fillStyle = `rgb(${150 + v * 30 | 0},${104 + v * 22 | 0},${64 + v * 15 | 0})`;
      x.fillRect(0, i * 16, 128, 15);
      x.fillStyle = 'rgba(60,35,20,0.5)'; x.fillRect(0, i * 16 + 15, 128, 1);
      x.fillStyle = 'rgba(70,40,20,0.6)';
      x.fillRect(10, i * 16 + 7, 3, 3); x.fillRect(114, i * 16 + 7, 3, 3);
    }
    return U.canvasTexture(c, { anisotropy: 4 });
  }
  function waterTexture() {
    const s = 256, c = U.makeCanvas(s, s), x = c.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, s, s);
    const rng = U.mulberry32(21);
    x.strokeStyle = 'rgba(140,200,235,0.55)';
    for (let i = 0; i < 70; i++) {
      x.lineWidth = 1 + rng() * 2;
      const px = rng() * s, py = rng() * s, w = 10 + rng() * 26;
      x.beginPath(); x.moveTo(px, py);
      x.quadraticCurveTo(px + w / 2, py - 3, px + w, py); x.stroke();
    }
    return U.canvasTexture(c, { repeat: [24, 24] });
  }

  /* ---------- colours ---------- */
  const DEFAULT_PALETTE = {
    grassA: '#79c257', grassB: '#9ad566', grassDark: '#5e9e44', meadow: '#bcd86a',
    town: '#8fcf68', dirt: '#c9a06b', dirtDark: '#b08754', sand: '#e0cd93',
    bed: '#6d8a63', cliff: '#8f9c78', cliffHi: '#6f8a5a',
    floor: '#7d7366', floorDark: '#625a50', wall: '#4b4540', moss: '#5f7a4a',
  };
  const COL = {};
  function setPalette(p) {
    for (const k in DEFAULT_PALETTE) COL[k] = new THREE.Color(p[k] || DEFAULT_PALETTE[k]);
  }
  const _c = new THREE.Color(), _t = new THREE.Color();
  function caveColor(x, z, h) {
    _c.copy(COL.floor).lerp(COL.floorDark, U.fbm(x * 0.12, z * 0.12, 3));
    const wall = U.smoothstep(0.5, 3.5, h);
    if (wall > 0) _c.lerp(COL.wall, wall);
    // Moss creeping along the foot of the walls.
    const foot = U.smoothstep(0.25, 0.9, h) * (1 - U.smoothstep(1.2, 3, h));
    if (foot > 0 && U.noise2(x * 0.4, z * 0.4) > 0.45) _c.lerp(COL.moss, foot * 0.8);
    return _c;
  }

  function groundColor(x, z, h) {
    if (M.cave) return caveColor(x, z, h);
    const n1 = U.fbm(x * 0.045, z * 0.045, 3);
    _c.copy(COL.grassA).lerp(COL.grassB, U.smoothstep(0.35, 0.7, n1));
    const patch = U.noise2(x * 0.09 + 40, z * 0.09);
    if (patch > 0.72) _c.lerp(COL.meadow, U.smoothstep(0.72, 0.85, patch) * 0.7);
    if (h > 1.2) _c.lerp(COL.grassDark, U.smoothstep(1.2, 4.5, h) * 0.6);
    const tf = townFactor(x, z);
    if (tf > 0) _c.lerp(COL.town, tf * 0.8);
    const pd = pathDistance(x, z);
    const pf = 1 - U.smoothstep(1.2, 3.0, pd + (U.noise2(x * 0.6, z * 0.6) - 0.5) * 1.2);
    if (pf > 0) { _t.copy(COL.dirt).lerp(COL.dirtDark, U.noise2(x * 0.4, z * 0.4)); _c.lerp(_t, pf); }
    if (h < 0.1) _c.lerp(COL.sand, U.smoothstep(0.1, -0.3, h));
    if (h < C.WATER_LEVEL) _c.lerp(COL.bed, U.smoothstep(C.WATER_LEVEL, C.WATER_LEVEL - 0.6, h));
    const b = boundaryAmount(x, z);
    if (b > 0) _c.lerp(COL.cliffHi, U.smoothstep(0, 6, b) * 0.6).lerp(COL.cliff, U.smoothstep(6, 18, b) * 0.7);
    return _c;
  }

  /* ---------- build ---------- */
  function init(map) {
    SIZE = (map && map.worldSize) || C.WORLD_SIZE; HALF = SIZE / 2;
    SEG = Math.min(320, Math.max(160, Math.round(SIZE / 1.5))); STEP = SIZE / SEG;
    if (N !== SEG + 1) { N = SEG + 1; heights = new Float32Array(N * N); }
    setMap(map);
    for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) {
      heights[iz * N + ix] = rawHeight(-HALF + ix * STEP, -HALF + iz * STEP);
    }
  }

  function build(scene) {
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const ix = Math.round((x + HALF) / STEP), iz = Math.round((z + HALF) / STEP);
      const h = heights[iz * N + ix];
      pos.setY(i, h);
      const c = groundColor(x, z, h);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, map: grassDetailTexture(), roughness: 1, metalness: 0, flatShading: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    scene.add(mesh);

    // Water: one plane; the terrain hides it everywhere except carved basins.
    const wtex = waterTexture();
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(SIZE - 20, SIZE - 20),
      new THREE.MeshStandardMaterial({
        color: '#4fb0e3', map: wtex, transparent: true, opacity: 0.82,
        roughness: 0.08, metalness: 0.1, depthWrite: false,
      })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = C.WATER_LEVEL;
    water.receiveShadow = true;
    scene.add(water);

    let bridge = null;
    if (M.town) {
    // Cobbled plaza and streets.
    const ctex = cobbleTexture();
    const plazaTex = ctex.clone(); plazaTex.needsUpdate = true;
    plazaTex.wrapS = plazaTex.wrapT = THREE.RepeatWrapping; plazaTex.repeat.set(5, 5);
    const plaza = new THREE.Mesh(new THREE.CircleGeometry(13, 48),
      new THREE.MeshStandardMaterial({ map: plazaTex, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.set(T.cx, 0.215, T.cz);
    plaza.receiveShadow = true;
    scene.add(plaza);

    STREETS.forEach(([x1, z1, x2, z2, w]) => {
      const len = Math.hypot(x2 - x1, z2 - z1);
      const t = ctex.clone(); t.needsUpdate = true;
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(w / 2.6, len / 2.6);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, len),
        new THREE.MeshStandardMaterial({ map: t, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
      m.rotation.order = 'YXZ';
      m.rotation.x = -Math.PI / 2;
      m.rotation.y = Math.atan2(x2 - x1, z2 - z1);
      m.position.set((x1 + x2) / 2, 0.21, (z1 + z2) / 2);
      m.receiveShadow = true;
      scene.add(m);
    });

    }
    if (M.bridge) { bridge = buildBridge(); scene.add(bridge); }

    return { mesh, water, waterTex: wtex, bridge };
  }

  function buildBridge() {
    const B = C.BRIDGE, group = new THREE.Group();
    const L = B.halfLength * 2, W = B.halfWidth * 2;
    const deckGeo = new THREE.PlaneGeometry(W, L, 1, 28);
    deckGeo.rotateX(-Math.PI / 2);
    const p = deckGeo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, bridgeDeck(BRIDGE_Z + p.getZ(i)) + 0.02);
    deckGeo.computeVertexNormals();
    const tex = plankTexture(); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(1, 3.5);
    const deck = new THREE.Mesh(deckGeo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
    deck.position.set(B.x, 0, BRIDGE_Z);
    deck.receiveShadow = true; deck.castShadow = true;
    group.add(deck);

    const parts = [];
    const wood = '#7a5232', woodDark = '#5d3c22', stone = '#a8a196';
    const box = new THREE.BoxGeometry(1, 1, 1);
    const posts = 9;
    for (const side of [-1, 1]) {
      const x = B.x + side * (B.halfWidth - 0.12);
      let prev = null;
      for (let i = 0; i <= posts; i++) {
        const z = BRIDGE_Z - B.halfLength + 0.3 + (L - 0.6) * (i / posts);
        const y = bridgeDeck(z);
        const end = i === 0 || i === posts;
        parts.push({ geo: box, color: end ? stone : wood, pos: [x, y + (end ? 0.6 : 0.45), z], scale: end ? [0.5, 1.2, 0.5] : [0.18, 0.9, 0.18], jitter: 0.1 });
        if (end) parts.push({ geo: box, color: '#c9c2b5', pos: [x, y + 1.25, z], scale: [0.62, 0.14, 0.62] });
        const top = new THREE.Vector3(x, y + 0.82, z);
        if (prev) {
          const mid = top.clone().add(prev).multiplyScalar(0.5);
          const len = top.distanceTo(prev);
          const ang = Math.atan2(top.y - prev.y, top.z - prev.z);
          parts.push({ geo: box, color: woodDark, pos: [mid.x, mid.y, mid.z], rot: [-ang, 0, 0], scale: [0.14, 0.12, len + 0.05] });
          parts.push({ geo: box, color: woodDark, pos: [mid.x, mid.y - 0.38, mid.z], rot: [-ang, 0, 0], scale: [0.08, 0.08, len] });
        }
        prev = top;
      }
      // side skirt beam beneath the deck
      for (let i = 0; i < 14; i++) {
        const z0 = BRIDGE_Z - B.halfLength + (L / 14) * i, z1 = z0 + L / 14;
        const y0 = bridgeDeck(z0), y1 = bridgeDeck(z1);
        const ang = Math.atan2(y1 - y0, z1 - z0);
        parts.push({ geo: box, color: woodDark, pos: [B.x + side * (B.halfWidth - 0.02), (y0 + y1) / 2 - 0.22, (z0 + z1) / 2], rot: [-ang, 0, 0], scale: [0.16, 0.42, L / 14 + 0.05] });
      }
    }
    // stone abutments
    for (const end of [-1, 1]) {
      parts.push({ geo: box, color: stone, pos: [B.x, -0.2, BRIDGE_Z + end * (B.halfLength - 1.2)], scale: [W + 0.8, 1.2, 2.4], jitter: 0.15 });
    }
    const m = new THREE.Mesh(U.mergeParts(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }));
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
    group.userData.collider = m;
    return group;
  }

  // Ground colour at a point, as display RGB 0..255 (for the minimap).
  const _mc = new THREE.Color();
  function mapColor(x, z) {
    const h = height(x, z);
    if (h < C.WATER_LEVEL && !onBridge(x, z)) return [79, 176, 227];
    _mc.copy(groundColor(x, z, h)).convertLinearToSRGB();
    return [_mc.r * 255, _mc.g * 255, _mc.b * 255];
  }

  G.Terrain = {
    mapColor,
    init, build, height, surfaceHeight, normalAt, raycast, isWater, onBridge, bridgeDeck,
    townFactor, pathDistance, boundaryAmount, boundaryRaw, streamZ, caveDist,
    get BRIDGE_Z() { return BRIDGE_Z; }, get POND() { return POND; }, get STREETS() { return STREETS; },
    get FIELD_PATHS() { return FIELD_PATHS; }, get map() { return M; }, get HALF() { return HALF; }, get SIZE() { return SIZE; },
  };
})(window.G = window.G || {});
