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
  /* Ground edits from the map editor: height changes on a 1-unit grid,
     stored sparsely as {"x,z": delta} and blended between grid points. */
  let groundGeo = null;
  function groundDelta(x, z) {
    const d = M && M.ground && M.ground.d;
    if (!d) return 0;
    const x0 = Math.floor(x), z0 = Math.floor(z), fx = x - x0, fz = z - z0;
    const g = (a, b) => d[a + ',' + b] || 0;
    return (g(x0, z0) * (1 - fx) + g(x0 + 1, z0) * fx) * (1 - fz) + (g(x0, z0 + 1) * (1 - fx) + g(x0 + 1, z0 + 1) * fx) * fz;
  }
  // Re-bake the heights and the visible ground inside a square (after sculpting).
  function refreshGround(cx, cz, r) {
    const i0 = Math.max(0, Math.floor((cx - r + HALF) / STEP)), i1 = Math.min(N - 1, Math.ceil((cx + r + HALF) / STEP));
    const j0 = Math.max(0, Math.floor((cz - r + HALF) / STEP)), j1 = Math.min(N - 1, Math.ceil((cz + r + HALF) / STEP));
    for (let iz = j0; iz <= j1; iz++) for (let ix = i0; ix <= i1; ix++) {
      const x = -HALF + ix * STEP, z = -HALF + iz * STEP;
      heights[iz * N + ix] = rawHeight(x, z) + groundDelta(x, z);
    }
    if (!groundGeo) return;
    const pos = groundGeo.attributes.position;
    for (let iz = j0; iz <= j1; iz++) for (let ix = i0; ix <= i1; ix++) pos.setY(iz * N + ix, heights[iz * N + ix]);
    pos.needsUpdate = true; groundGeo.computeVertexNormals();
  }
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
    const d = deckAt(x, z);
    return d ? Math.max(h, deckHeight(d)) : h;
  }
  function isWater(x, z) {
    return height(x, z) < C.WATER_LEVEL + 0.12 && !onBridge(x, z) && !deckAt(x, z);
  }
  /* Bridges placed with the map editor: walkable rectangles (decks). */
  function deckAt(x, z) {
    const list = M && M.decks; if (!list) return null;
    for (const d of list) {
      const dx = x - d.x, dz = z - d.z, c = Math.cos(d.ry), sn = Math.sin(d.ry);
      const lx = dx * c - dz * sn, lz = dx * sn + dz * c;
      if (Math.abs(lx) <= d.hw && Math.abs(lz) <= d.hl) return d;
    }
    return null;
  }
  function deckBase(d) {
    // The deck rests on the higher of its two ends.
    const ex = Math.sin(d.ry) * d.hl, ez = Math.cos(d.ry) * d.hl;
    return Math.max(height(d.x + ex, d.z + ez), height(d.x - ex, d.z - ez), C.WATER_LEVEL + 0.2) + (d.y || 0);
  }
  function deckHeight(d) { if (d.h == null) d.h = deckBase(d) + d.top; return d.h; }

  /* Ground painting: a texture layer over the ground, one cell per world unit.
     Layers 1..11 come from a texture atlas (4 x 3 tiles). */
  const PAINT = [
    { id: 1, name: 'Grass' }, { id: 2, name: 'Dark grass' }, { id: 3, name: 'Dirt path' }, { id: 4, name: 'Cobblestone' },
    { id: 5, name: 'Sand' }, { id: 6, name: 'Stone tiles' }, { id: 7, name: 'Dead grass' }, { id: 8, name: 'Graveyard soil' },
    { id: 9, name: 'Cursed ground' }, { id: 10, name: 'Mud' }, { id: 11, name: 'Snow' },
  ];
  let paintAtlas = null, paintIdxTex = null, paintCovTex = null, paintData = null, paintSize = 0;
  function buildPaintAtlas() {
    if (paintAtlas) return paintAtlas;
    const T = 256, c = U.makeCanvas(T * 4, T * 3), x = c.getContext('2d'), rng = U.mulberry32(99);
    const tile = (i, draw) => { x.save(); x.translate((i % 4) * T, Math.floor(i / 4) * T); x.beginPath(); x.rect(0, 0, T, T); x.clip(); draw(); x.restore(); };
    const speckle = (base, cols, n, rmin, rmax) => { x.fillStyle = base; x.fillRect(0, 0, T, T); for (let k = 0; k < n; k++) { x.fillStyle = cols[k % cols.length]; const r = rmin + rng() * (rmax - rmin); x.beginPath(); x.ellipse(rng() * T, rng() * T, r, r * (0.5 + rng() * 0.5), rng() * 3, 0, 7); x.fill(); } };
    const blades = (cols, n) => { for (let k = 0; k < n; k++) { x.strokeStyle = cols[k % cols.length]; x.lineWidth = 1.5; const px = rng() * T, py = rng() * T; x.beginPath(); x.moveTo(px, py); x.lineTo(px + (rng() - 0.5) * 4, py - 4 - rng() * 6); x.stroke(); } };
    tile(0, () => { speckle('#79b452', ['#6aa548', '#8cc45e', '#5f9a43'], 260, 4, 14); blades(['#9ad06a', '#5a9440'], 500); });
    tile(1, () => { speckle('#4f7a3a', ['#456d33', '#5b8842', '#3d6230'], 260, 4, 14); blades(['#679a4a', '#36572a'], 500); });
    tile(2, () => { speckle('#c49a66', ['#b58b58', '#d1a874', '#a98050'], 320, 2, 9); for (let k = 0; k < 40; k++) { x.fillStyle = '#9a8a76'; x.beginPath(); x.arc(rng() * T, rng() * T, 1 + rng() * 2.5, 0, 7); x.fill(); } });
    tile(3, () => { x.fillStyle = '#857a6a'; x.fillRect(0, 0, T, T); const n = 6, cell = T / n; for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const off = (j % 2) * cell / 2, v = 170 + rng() * 40 | 0; x.fillStyle = `rgb(${v + 6},${v},${v - 12})`; for (const ox of [0, -T]) { x.beginPath(); if (x.roundRect) x.roundRect(i * cell + off + ox + 3, j * cell + 3, cell - 6, cell - 6, 8); else x.rect(i * cell + off + ox + 3, j * cell + 3, cell - 6, cell - 6); x.fill(); } } });
    tile(4, () => { speckle('#e2cf98', ['#d8c48c', '#ecdcab', '#cfba80'], 400, 1, 5); });
    tile(5, () => { x.fillStyle = '#6f6b66'; x.fillRect(0, 0, T, T); const n = 4, cell = T / n; for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const v = 140 + rng() * 30 | 0; x.fillStyle = `rgb(${v},${v - 3},${v - 8})`; x.fillRect(i * cell + 3, j * cell + 3, cell - 6, cell - 6); x.strokeStyle = 'rgba(40,36,32,0.35)'; x.beginPath(); x.moveTo(i * cell + 3 + rng() * cell * 0.6, j * cell + 3); x.lineTo(i * cell + 3 + rng() * cell * 0.8, j * cell + cell - 3); x.stroke(); } });
    tile(6, () => { speckle('#a99a62', ['#9c8c55', '#b8aa72', '#8f8050'], 260, 4, 12); blades(['#c2b077', '#857a48'], 450); });
    tile(7, () => { speckle('#4d4640', ['#433d38', '#58504a', '#3b3632', '#5c544c'], 420, 2, 9); for (let k = 0; k < 26; k++) { x.fillStyle = rng() < 0.3 ? '#cfc8b8' : '#77706a'; x.beginPath(); x.ellipse(rng() * T, rng() * T, 1.5 + rng() * 3, 1 + rng() * 2, rng() * 3, 0, 7); x.fill(); } });
    tile(8, () => { speckle('#2c2433', ['#251f2c', '#352b3e', '#1f1a25'], 380, 3, 11); x.strokeStyle = 'rgba(150,90,200,0.35)'; x.lineWidth = 1.2; for (let k = 0; k < 14; k++) { let px = rng() * T, py = rng() * T; x.beginPath(); x.moveTo(px, py); for (let q = 0; q < 4; q++) { px += (rng() - 0.5) * 40; py += (rng() - 0.5) * 40; x.lineTo(px, py); } x.stroke(); } });
    tile(9, () => { speckle('#5a4632', ['#4f3d2b', '#64503a', '#45362a'], 320, 4, 14); for (let k = 0; k < 18; k++) { x.fillStyle = 'rgba(120,140,150,0.25)'; x.beginPath(); x.ellipse(rng() * T, rng() * T, 6 + rng() * 14, 3 + rng() * 6, rng() * 3, 0, 7); x.fill(); } });
    tile(10, () => { speckle('#eef3f6', ['#e2e9ee', '#f8fbfc', '#d8e2e8'], 300, 3, 12); });
    paintAtlas = c;
    return c;
  }
  function setupPaint(mat) {
    paintSize = Math.round(SIZE);
    paintData = new Uint8Array(paintSize * paintSize * 4);
    const make = (filter) => { const t = new THREE.DataTexture(paintData, paintSize, paintSize, THREE.RGBAFormat); t.magFilter = t.minFilter = filter; t.needsUpdate = true; return t; };
    paintIdxTex = make(THREE.NearestFilter); paintCovTex = make(THREE.LinearFilter);
    const d = M && M.paint && M.paint.d;
    if (d) for (const [k, v] of Object.entries(d)) { const [px, pz] = k.split(',').map(Number); writePaint(px, pz, v[0], v[1], true); }
    const atlas = new THREE.CanvasTexture(buildPaintAtlas()); atlas.minFilter = THREE.LinearFilter; atlas.generateMipmaps = false;
    const uniforms = { uPaintIdx: { value: paintIdxTex }, uPaintCov: { value: paintCovTex }, uAtlas: { value: atlas }, uHalf: { value: HALF }, uSize: { value: paintSize } };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vPaintPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPaintPos = (modelMatrix * vec4(transformed, 1.0)).xz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vPaintPos;\nuniform sampler2D uPaintIdx;\nuniform sampler2D uPaintCov;\nuniform sampler2D uAtlas;\nuniform float uHalf;\nuniform float uSize;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            vec2 pg = (vPaintPos + uHalf) / uSize;
            float idx = floor(texture2D(uPaintIdx, pg).r * 255.0 + 0.5);
            float cov = texture2D(uPaintCov, pg).g;
            if (idx > 0.5 && cov > 0.01) {
              float i = idx - 1.0;
              vec2 tile = vec2(mod(i, 4.0), floor(i / 4.0));
              vec2 tuv = fract(vPaintPos / 4.0) * (252.0 / 256.0) + 2.0 / 256.0;
              vec3 pc = texture2D(uAtlas, (tile + tuv) / vec2(4.0, 3.0)).rgb;
              diffuseColor.rgb = mix(diffuseColor.rgb, pow(pc, vec3(2.2)), cov);
            }
          }`);
    };
    mat.customProgramCacheKey = () => 'terrain-paint';
  }
  function writePaint(px, pz, idx, cov, quiet) {
    const i = px + Math.floor(HALF), j = pz + Math.floor(HALF);
    if (!paintData || i < 0 || j < 0 || i >= paintSize || j >= paintSize) return;
    const o = (j * paintSize + i) * 4;
    paintData[o] = idx; paintData[o + 1] = cov;
    if (!quiet) { paintIdxTex.needsUpdate = true; paintCovTex.needsUpdate = true; }
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
      heights[iz * N + ix] = rawHeight(-HALF + ix * STEP, -HALF + iz * STEP) + groundDelta(-HALF + ix * STEP, -HALF + iz * STEP);
    }
  }

  function build(scene) {
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    groundGeo = geo;
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
    setupPaint(mat);
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
    get FIELD_PATHS() { return FIELD_PATHS; }, get map() { return M; }, get HALF() { return HALF; }, get SIZE() { return SIZE; }, groundDelta, refreshGround, writePaint, PAINT, buildPaintAtlas, deckAt, deckBase,
  };
})(window.G = window.G || {});
