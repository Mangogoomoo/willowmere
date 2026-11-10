/* Edited and custom maps (made with the admin map editor).
   Every map can carry edits: extra objects (built-in props or uploaded .glb
   models) and entities (warps, lights, monster spawns, NPCs, start points),
   plus its size (bounds). Built-in maps keep their own design and get the
   edits on top; brand-new maps start as open grassland.

   Map data: { id, name, base: 'builtin' | 'blank', bounds: {minX,maxX,minZ,maxZ},
               objects: [{u, k, x, y, z, ry, s, solid}], entities: [{u, type, x, y, z, ...}] } */
(function (G) {
  'use strict';
  const C = G.Config, U = G.Utils;
  // The playable edges of the original maps.
  const DEFAULT_BOUNDS = { minX: -100, maxX: 100, minZ: -112, maxZ: 102 };

  /* ------------------------------------------------------------ .glb reader
     Reads binary glTF 2.0 (static models: meshes, materials, embedded
     textures, node hierarchy). No skinning/animation or Draco compression. */
  async function parseGLB(buf) {
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('Not a .glb file');
    let off = 12, json = null, bin = null;
    while (off < buf.byteLength) {
      const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
      if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, off + 8, len)));
      else if (type === 0x004e4942) bin = buf.slice(off + 8, off + 8 + len);
      off += 8 + len;
    }
    if (!json) throw new Error('The .glb has no scene data');
    if ((json.extensionsRequired || []).length) throw new Error(`This model needs ${json.extensionsRequired.join(', ')} (try exporting without compression)`);
    const views = json.bufferViews || [];
    const viewBytes = (i) => { const v = views[i]; return new Uint8Array(bin, v.byteOffset || 0, v.byteLength); };
    const SIZES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
    const TYPES = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
    const accessor = (i) => {
      const a = json.accessors[i], n = SIZES[a.type], T = TYPES[a.componentType], v = views[a.bufferView];
      const stride = v.byteStride || n * T.BYTES_PER_ELEMENT, base = (v.byteOffset || 0) + (a.byteOffset || 0);
      const out = new T(a.count * n);
      if (stride === n * T.BYTES_PER_ELEMENT) out.set(new T(bin, base, a.count * n));
      else { const src = new DataView(bin); const get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType];
        for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = src[get](base + k * stride + c * T.BYTES_PER_ELEMENT, true); }
      return { array: out, size: n, normalized: !!a.normalized };
    };
    // Textures
    const images = await Promise.all((json.images || []).map(async (im) => {
      if (im.bufferView == null) return null;
      const blob = new Blob([viewBytes(im.bufferView)], { type: im.mimeType || 'image/png' });
      try { return await createImageBitmap(blob, { imageOrientation: 'none' }); } catch (e) { return null; }
    }));
    const texCache = {};
    const texture = (ti) => {
      if (ti == null || !json.textures || !json.textures[ti]) return null;
      if (texCache[ti]) return texCache[ti];
      const img = images[json.textures[ti].source]; if (!img) return null;
      const t = new THREE.Texture(img); t.flipY = false; t.encoding = THREE.sRGBEncoding; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true;
      return (texCache[ti] = t);
    };
    const materials = (json.materials || []).map((m) => {
      const pbr = m.pbrMetallicRoughness || {}, f = pbr.baseColorFactor || [1, 1, 1, 1];
      const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(f[0], f[1], f[2]), opacity: f[3], roughness: pbr.roughnessFactor ?? 0.9, metalness: pbr.metallicFactor ?? 0,
        map: pbr.baseColorTexture ? texture(pbr.baseColorTexture.index) : null, side: m.doubleSided ? THREE.DoubleSide : THREE.FrontSide });
      if (m.alphaMode === 'MASK') mat.alphaTest = m.alphaCutoff ?? 0.5;
      if (m.alphaMode === 'BLEND') { mat.transparent = true; mat.depthWrite = false; }
      if (m.emissiveFactor) mat.emissive = new THREE.Color(...m.emissiveFactor);
      return mat;
    });
    const fallback = new THREE.MeshStandardMaterial({ color: '#cccccc', roughness: 0.9 });
    const meshes = (json.meshes || []).map((me) => {
      const g = new THREE.Group();
      for (const pr of me.primitives) {
        if (pr.mode != null && pr.mode !== 4) continue;
        const geo = new THREE.BufferGeometry(), at = pr.attributes;
        const put = (name, ai) => { const a = accessor(ai); geo.setAttribute(name, new THREE.BufferAttribute(a.array, a.size, a.normalized)); };
        put('position', at.POSITION);
        if (at.NORMAL != null) put('normal', at.NORMAL);
        if (at.TEXCOORD_0 != null) put('uv', at.TEXCOORD_0);
        if (at.COLOR_0 != null) put('color', at.COLOR_0);
        if (pr.indices != null) geo.setIndex(new THREE.BufferAttribute(accessor(pr.indices).array, 1));
        if (at.NORMAL == null) geo.computeVertexNormals();
        let mat = pr.material != null ? materials[pr.material] : fallback;
        if (at.COLOR_0 != null) { mat = mat.clone(); mat.vertexColors = true; }
        const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true; mesh.receiveShadow = true;
        g.add(mesh);
      }
      return g;
    });
    const node = (i) => {
      const n = json.nodes[i], o = n.mesh != null ? meshes[n.mesh].clone() : new THREE.Group();
      if (n.matrix) { o.matrix.fromArray(n.matrix); o.matrix.decompose(o.position, o.quaternion, o.scale); }
      else { if (n.translation) o.position.fromArray(n.translation); if (n.rotation) o.quaternion.fromArray(n.rotation); if (n.scale) o.scale.fromArray(n.scale); }
      for (const c of n.children || []) o.add(node(c));
      return o;
    };
    const root = new THREE.Group();
    const scene = (json.scenes || [])[json.scene || 0];
    for (const i of (scene ? scene.nodes : (json.nodes || []).map((_, k) => k))) root.add(node(i));
    return root;
  }

  /* ------------------------------------------------------------ object library */
  const noop = new Proxy({}, { get: () => () => {} });
  // Build one of the game's own props by itself (at the origin, base on the ground).
  function fromEnv(env, draw, center) {
    const fake = Object.create(env); fake.nav = noop; fake.colliders = []; fake._lib = true;
    fake.scene = new THREE.Group(); fake.landmarks = [];
    const parts = []; draw(fake, parts);
    const g = new THREE.Group();
    if (parts.length) { const m = new THREE.Mesh(U.mergeParts(parts), env.propMat); m.castShadow = true; m.receiveShadow = true; g.add(m); }
    for (const c of [...fake.scene.children]) g.add(c);
    const box = new THREE.Box3().setFromObject(g), c = box.getCenter(new THREE.Vector3());
    for (const ch of g.children) { ch.position.y -= box.min.y; if (center) { ch.position.x -= c.x; ch.position.z -= c.z; } }
    return g;
  }
  let waterMat = null;
  function waterMesh(geo) {
    if (!waterMat) waterMat = new THREE.MeshStandardMaterial({ color: '#2f6f9e', roughness: 0.12, metalness: 0.15, transparent: true, opacity: 0.86, depthWrite: false });
    geo.rotateX(-Math.PI / 2); geo.translate(0, 0.06, 0);
    const m = new THREE.Mesh(geo, waterMat); m.receiveShadow = true; m.renderOrder = 2;
    return m;
  }
  const wrap = (m) => { const g = new THREE.Group(); g.add(m); return g; };
  const tintMats = {};
  function tinted(env, kind, color) {
    const key = kind + color;
    if (!tintMats[key]) { tintMats[key] = env.foliageMat.clone(); tintMats[key].color = new THREE.Color(color); if (env.foliageMat.onBeforeCompile) tintMats[key].onBeforeCompile = env.foliageMat.onBeforeCompile; }
    return new THREE.Mesh(env.treeGeometries()[kind], tintMats[key]);
  }
  function flowers(env, colors, h, r) {
    const parts = [];
    [[0, 0], [0.4, 0.2], [-0.35, 0.3], [0.1, -0.4], [-0.3, -0.25], [0.45, -0.3], [0.2, 0.45], [-0.5, 0.05]].forEach(([x, z], i) => {
      parts.push({ geo: new THREE.CylinderGeometry(0.02, 0.025, h, 4), color: '#4f8a3c', pos: [x, h / 2, z] });
      parts.push({ geo: new THREE.IcosahedronGeometry(r, 0), color: colors[i % colors.length], pos: [x, h + r * 0.5, z] });
    });
    return prim(parts, env.propMat);
  }
  const prim = (parts, mat) => { const g = U.mergeParts(parts); const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; return m; };
  // An original decoration as an editor object: its spot, turn, size, stretch, tilt, height above the
  // ground, own colour and how much it blocks walking (all as the scenery placed it).
  function capLook(it) {
    const TR = G.Terrain, r2 = (v) => Math.round(v * 100) / 100, r3 = (v) => Math.round(v * 1000) / 1000;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(it.rx || 0, it.ry || 0, it.rz || 0, 'XYZ'));
    const e = new THREE.Euler().setFromQuaternion(q, 'YXZ'), s = it.s[1] || 1, ground = TR.height(it.x, it.z);
    const o = { x: r2(it.x), z: r2(it.z), y: r2((it.y != null ? it.y : ground) - ground), ry: r3(e.y), s: r3(s) };
    if (Math.abs(e.x) > 1e-3 || Math.abs(e.z) > 1e-3) o.tilt = [r3(e.x), r3(e.z)];
    const ax = it.s[0] / s, az = it.s[2] / s;
    if (Math.abs(ax - 1) > 0.005 || Math.abs(az - 1) > 0.005) o.st = [r3(ax), r3(az)];
    o.c = '#' + new THREE.Color(it.color || '#ffffff').getHexString();
    o.solid = r3((it.block || 0) / s);
    if (it.rect) o.rect = [r3(it.rect[0] / s), r3(it.rect[1] / s)];
    return o;
  }
  // Drawn as a one-piece batch with its own colour, the way the scenery draws it. (Batches always get
  // a colour: three r149 reuses a shader between batches with and without colours, reading black.)
  function capMesh(geo, mat, o, cast) {
    const m = new THREE.InstancedMesh(geo, mat, 1);
    m.setMatrixAt(0, new THREE.Matrix4()); m.setColorAt(0, new THREE.Color(o.c || '#ffffff'));
    m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true;
    if (o.st) m.scale.set(o.st[0], 1, o.st[1]);
    if (o.tilt) m.rotation.set(o.tilt[0], 0, o.tilt[1]);
    m.castShadow = !!cast; m.receiveShadow = true; m.userData.cap = true;
    return m;
  }
  const col = (o, def) => (o && o.opts && o.opts.col) || def;
  // A wooden sign with your own words painted on both sides of the board (wrapped and sized to fit).
  const SIGN_TEXT = 'Your text here';
  function signTexture(text) {
    const W = 512, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.fillStyle = '#e8d3a8'; x.fillRect(0, 0, W, H);
    x.strokeStyle = '#a8743c'; x.lineWidth = 10; x.strokeRect(5, 5, W - 10, H - 10);
    x.fillStyle = '#3a2410'; x.textAlign = 'center'; x.textBaseline = 'middle';
    const words = String(text || '').split(/\s+/).filter(Boolean);
    let size = 64, lines = [];
    for (; size >= 20; size -= 4) {
      x.font = `bold ${size}px sans-serif`;
      lines = []; let line = '';
      for (const w of words) { const t = line ? line + ' ' + w : w; if (x.measureText(t).width > W - 48 && line) { lines.push(line); line = w; } else line = t; }
      if (line) lines.push(line);
      if (lines.length * size * 1.15 <= H - 36 && lines.every((l) => x.measureText(l).width <= W - 48)) break;
    }
    lines.forEach((l, i) => x.fillText(l, W / 2, H / 2 + (i - (lines.length - 1) / 2) * size * 1.15));
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    return tex;
  }
  function signMesh(e, text) {
    const g = new THREE.Group();
    g.add(prim([{ geo: new THREE.BoxGeometry(0.14, 1.7, 0.14), color: '#7a4c2c', pos: [0, 0.85, 0] },
      { geo: new THREE.BoxGeometry(1.95, 1.05, 0.1), color: '#a8743c', pos: [0, 1.75, 0] }], e.propMat));
    const mat = new THREE.MeshStandardMaterial({ map: signTexture(text), roughness: 1 });
    for (const side of [1, -1]) {
      const face = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.9), mat);
      face.position.set(0, 1.75, 0.056 * side); if (side < 0) face.rotation.y = Math.PI;
      face.receiveShadow = true; g.add(face);
    }
    return g;
  }
  const LIB = [
    // Nature
    { k: 'tree', name: 'Tree', cat: 'Nature', icon: '🌳', solid: 0.45, build: (e) => new THREE.Mesh(e.treeGeometries().round, e.foliageMat) },
    { k: 'pine', name: 'Pine', cat: 'Nature', icon: '🌲', solid: 0.4, build: (e) => new THREE.Mesh(e.treeGeometries().pine, e.foliageMat) },
    { k: 'blossom', name: 'Blossom tree', cat: 'Nature', icon: '🌸', solid: 0.45, build: (e) => new THREE.Mesh(e.treeGeometries().blossom, e.foliageMat) },
    { k: 'tree_autumn', name: 'Autumn tree', cat: 'Trees', icon: '🍂', solid: 0.45, build: (e) => tinted(e, 'round', '#f0a35a') },
    { k: 'tree_golden', name: 'Golden tree', cat: 'Trees', icon: '🌕', solid: 0.45, build: (e) => tinted(e, 'round', '#ffe08a') },
    { k: 'tree_dark', name: 'Dark oak', cat: 'Trees', icon: '🌳', solid: 0.5, build: (e) => { const m = tinted(e, 'round', '#7fa070'); m.scale.set(1.35, 1.45, 1.35); return wrap(m); } },
    { k: 'sapling', name: 'Sapling', cat: 'Trees', icon: '🌱', solid: 0.2, build: (e) => { const m = new THREE.Mesh(e.treeGeometries().round, e.foliageMat); m.scale.setScalar(0.5); return wrap(m); } },
    { k: 'pine_snow', name: 'Frosted pine', cat: 'Trees', icon: '❄️', solid: 0.4, build: (e) => tinted(e, 'pine', '#d9e8ee') },
    { k: 'birch', name: 'Birch', cat: 'Trees', icon: '🪵', solid: 0.3, build: (e) => prim([
      { geo: new THREE.CylinderGeometry(0.12, 0.17, 3.4, 7), color: '#ece8df', pos: [0, 1.7, 0] },
      ...[[0, 3.6, 0, 1.0], [0.5, 3.1, 0.2, 0.75], [-0.45, 3.2, -0.25, 0.7], [0.1, 4.2, -0.2, 0.65]].map(([x, y, z, r]) => ({ geo: new THREE.IcosahedronGeometry(r, 1), color: '#9cc25a', pos: [x, y, z], jitter: 0.2 }))], e.foliageMat) },
    { k: 'willow', name: 'Willow', cat: 'Trees', icon: '🌾', solid: 0.5, build: (e) => prim([
      { geo: new THREE.CylinderGeometry(0.25, 0.4, 2.8, 8), color: '#6d5640', pos: [0, 1.4, 0] },
      { geo: new THREE.SphereGeometry(1.7, 10, 8), color: '#7fa858', pos: [0, 3.3, 0], scale: [1, 0.6, 1] },
      ...Array.from({ length: 10 }, (_, i) => { const a = i / 10 * Math.PI * 2; return { geo: new THREE.ConeGeometry(0.45, 2.4, 6), color: i % 2 ? '#8cb562' : '#6f9a4c', pos: [Math.cos(a) * 1.35, 2.3, Math.sin(a) * 1.35], rot: [Math.PI, 0, 0] }; })], e.foliageMat) },
    { k: 'dead_tree', name: 'Dead tree', cat: 'Trees', icon: '🪾', solid: 0.3, build: (e) => prim([
      { geo: new THREE.CylinderGeometry(0.16, 0.3, 3, 6), color: '#5d4a3a', pos: [0, 1.5, 0] },
      { geo: new THREE.CylinderGeometry(0.06, 0.1, 1.4, 5), color: '#5d4a3a', pos: [0.45, 2.6, 0], rot: [0, 0, -0.8] },
      { geo: new THREE.CylinderGeometry(0.05, 0.09, 1.2, 5), color: '#5d4a3a', pos: [-0.4, 2.9, 0.1], rot: [0.2, 0, 0.9] },
      { geo: new THREE.CylinderGeometry(0.04, 0.07, 0.9, 5), color: '#5d4a3a', pos: [0.1, 3.4, -0.3], rot: [-0.6, 0, 0.2] }], e.propMat) },
    { k: 'palm', name: 'Palm', cat: 'Trees', icon: '🌴', solid: 0.3, build: (e) => prim([
      ...Array.from({ length: 6 }, (_, i) => ({ geo: new THREE.CylinderGeometry(0.17 - i * 0.012, 0.2 - i * 0.012, 0.75, 7), color: i % 2 ? '#a07a52' : '#8f6b46', pos: [i * 0.07, 0.37 + i * 0.72, 0] })),
      ...Array.from({ length: 7 }, (_, i) => { const a = i / 7 * Math.PI * 2; return { geo: new THREE.BoxGeometry(2.2, 0.06, 0.5), color: i % 2 ? '#5f9a44' : '#4f8a3a', pos: [0.4 + Math.cos(a) * 1, 4.3, Math.sin(a) * 1], rot: [0, -a, -0.35] }; })], e.foliageMat) },
    { k: 'stump', name: 'Tree stump', cat: 'Trees', icon: '🪵', solid: 0.45, build: (e) => prim([
      { geo: new THREE.CylinderGeometry(0.45, 0.6, 0.6, 9), color: '#7a5a3e', pos: [0, 0.3, 0] }, { geo: new THREE.CylinderGeometry(0.42, 0.42, 0.04, 9), color: '#c9a777', pos: [0, 0.61, 0] }], e.propMat) },
    { k: 'log', name: 'Fallen log', cat: 'Trees', icon: '🪵', solid: 0.6, build: (e) => prim([{ geo: new THREE.CylinderGeometry(0.35, 0.4, 3.2, 9), color: '#6f5238', pos: [0, 0.35, 0], rot: [0, 0, Math.PI / 2] }], e.propMat) },
    { k: 'bush', name: 'Bush', cat: 'Nature', icon: '🌿', solid: 0, build: (e) => prim([
      { geo: new THREE.IcosahedronGeometry(0.7, 0), color: '#4e9a44', pos: [0, 0.5, 0], jitter: 0.2 },
      { geo: new THREE.IcosahedronGeometry(0.55, 0), color: '#5aab4c', pos: [0.55, 0.4, 0.2], jitter: 0.2 },
      { geo: new THREE.IcosahedronGeometry(0.5, 0), color: '#468c3e', pos: [-0.5, 0.38, -0.15], jitter: 0.2 }], e.foliageMat) },
    { k: 'berry_bush', name: 'Berry bush', cat: 'Nature', icon: '🫐', solid: 0, build: (e) => prim([
      { geo: new THREE.IcosahedronGeometry(0.7, 1), color: '#4a8a40', pos: [0, 0.55, 0], jitter: 0.2 }, { geo: new THREE.IcosahedronGeometry(0.5, 1), color: '#558f45', pos: [0.5, 0.42, 0.2], jitter: 0.2 },
      ...[[0.35, 0.95, 0.4], [-0.3, 0.8, 0.5], [0.6, 0.6, -0.2], [-0.5, 0.65, -0.3], [0.1, 1.1, -0.35]].map((p2) => ({ geo: new THREE.IcosahedronGeometry(0.09, 0), color: '#c8344a', pos: p2 }))], e.foliageMat) },
    { k: 'hedge', name: 'Hedge', cat: 'Nature', icon: '🟩', solid: 0.6, build: (e) => prim([{ geo: new THREE.BoxGeometry(3, 1.1, 0.9, 3, 2, 2), color: '#4e8a42', pos: [0, 0.55, 0], jitter: 0.08 }], e.foliageMat) },
    { k: 'fern', name: 'Fern', cat: 'Nature', icon: '🌿', solid: 0, build: (e) => prim(Array.from({ length: 7 }, (_, i) => { const a = i / 7 * Math.PI * 2; return { geo: new THREE.ConeGeometry(0.16, 1.1, 4), color: i % 2 ? '#3f7d3a' : '#4f8f44', pos: [Math.cos(a) * 0.35, 0.4, Math.sin(a) * 0.35], rot: [Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9] }; }), e.foliageMat) },
    { k: 'tall_grass', name: 'Tall grass', cat: 'Nature', icon: '🌾', solid: 0, build: (e) => prim(Array.from({ length: 12 }, (_, i) => ({ geo: new THREE.ConeGeometry(0.05, 0.9 + (i % 3) * 0.25, 3), color: i % 2 ? '#8ea85a' : '#a3b86a', pos: [Math.cos(i * 2.4) * 0.35 * (i % 4) / 3, 0.45, Math.sin(i * 2.4) * 0.35 * (i % 4) / 3], rot: [(i % 3 - 1) * 0.15, 0, (i % 2 - 0.5) * 0.3] })), e.foliageMat) },
    { k: 'tulips', name: 'Tulips', cat: 'Flowers', icon: '🌷', solid: 0, build: (e) => flowers(e, ['#e0484f', '#f07a8a', '#e0484f'], 0.42, 0.11) },
    { k: 'sunflowers', name: 'Sunflowers', cat: 'Flowers', icon: '🌻', solid: 0, build: (e) => flowers(e, ['#f2c230', '#f5cf47'], 1.2, 0.2) },
    { k: 'lavender', name: 'Lavender', cat: 'Flowers', icon: '💜', solid: 0, build: (e) => flowers(e, ['#9b7ad0', '#b195e0', '#8a68c0'], 0.55, 0.08) },
    { k: 'daisies', name: 'Daisies', cat: 'Flowers', icon: '🌼', solid: 0, build: (e) => flowers(e, ['#ffffff', '#fff6d0'], 0.3, 0.09) },
    { k: 'roses', name: 'Rose bush', cat: 'Flowers', icon: '🌹', solid: 0, build: (e) => prim([{ geo: new THREE.IcosahedronGeometry(0.55, 1), color: '#3f7a3a', pos: [0, 0.45, 0], jitter: 0.2 },
      ...[[0.3, 0.8, 0.3], [-0.3, 0.75, 0.25], [0.35, 0.6, -0.3], [-0.2, 0.9, -0.2], [0, 0.95, 0.1]].map((p2) => ({ geo: new THREE.IcosahedronGeometry(0.11, 0), color: '#c8304a', pos: p2 }))], e.foliageMat) },
    { k: 'mushrooms', name: 'Mushroom cluster', cat: 'Flowers', icon: '🍄', solid: 0, build: (e) => prim([[0, 0, 0.32], [0.3, 0.15, 0.22], [-0.25, 0.2, 0.18], [0.1, -0.3, 0.15]].flatMap(([x, z, r]) => [
      { geo: new THREE.CylinderGeometry(r * 0.3, r * 0.35, r * 1.4, 6), color: '#efe6d2', pos: [x, r * 0.7, z] },
      { geo: new THREE.SphereGeometry(r, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), color: '#c0473a', pos: [x, r * 1.35, z] }]), e.propMat) },
    { k: 'rock', name: 'Rock', cat: 'Nature', icon: '🪨', solid: 0.5, build: (e) => prim([{ geo: new THREE.DodecahedronGeometry(0.6, 0), color: '#9a958c', pos: [0, 0.35, 0], scale: [1.2, 0.75, 1], jitter: 0.25 }], e.propMat) },
    { k: 'boulder', name: 'Boulder', cat: 'Nature', icon: '⛰️', solid: 1.4, build: (e) => prim([
      { geo: new THREE.DodecahedronGeometry(1.4, 0), color: '#8f8a80', pos: [0, 1.0, 0], scale: [1.2, 0.85, 1], jitter: 0.25 },
      { geo: new THREE.DodecahedronGeometry(0.8, 0), color: '#a19b90', pos: [1.2, 0.5, 0.5], jitter: 0.25 }], e.propMat) },
    { k: 'flowers', name: 'Flower patch', cat: 'Nature', icon: '🌼', solid: 0, build: (e) => prim([
      ...[[0, 0], [0.4, 0.2], [-0.35, 0.3], [0.1, -0.4], [-0.3, -0.25], [0.45, -0.3]].flatMap(([x, z], i) => [
        { geo: new THREE.CylinderGeometry(0.02, 0.02, 0.35, 4), color: '#4f8a3c', pos: [x, 0.17, z] },
        { geo: new THREE.IcosahedronGeometry(0.09, 0), color: ['#f4d35e', '#f08aa8', '#ffffff', '#b48cf0'][i % 4], pos: [x, 0.38, z] }])], e.propMat) },
    { k: 'mushroom', name: 'Giant mushroom', cat: 'Nature', icon: '🍄', solid: 0.5, build: (e) => prim([
      { geo: new THREE.CylinderGeometry(0.35, 0.45, 1.8, 8), color: '#efe6d2', pos: [0, 0.9, 0] },
      { geo: new THREE.SphereGeometry(1.3, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), color: '#c0473a', pos: [0, 1.7, 0], scale: [1, 0.7, 1] }], e.propMat) },
    // Town
    { k: 'house', name: 'House (blue roof)', cat: 'Town', icon: '🏠', solid: 2.6, build: (e, o) => fromEnv(e, (f, p) => f.house(p, 0, 0, 0, (o && o.opts) || { w: 6, d: 5, h: 3.3, wall: '#fdf3e1', roof: '#4b7bd1', trim: '#6b4428' })) },
    { k: 'house_red', name: 'House (red roof)', cat: 'Town', icon: '🏡', solid: 2.6, build: (e) => fromEnv(e, (f, p) => f.house(p, 0, 0, 0, { w: 6, d: 5, h: 3.3, wall: '#f6ead2', roof: '#d9534f', trim: '#7b4a2c' })) },
    { k: 'house_tall', name: 'Tall house', cat: 'Town', icon: '🏘️', solid: 3, build: (e) => fromEnv(e, (f, p) => f.house(p, 0, 0, 0, { w: 7, d: 5.5, h: 4.8, wall: '#efe0c4', roof: '#e8893a', trim: '#6e3f22' })) },
    { k: 'fountain', name: 'Fountain', cat: 'Town', icon: '⛲', solid: 2.2, build: (e) => fromEnv(e, (f, p) => f.fountain(p, 0, 0)) },
    { k: 'stall_blue', name: 'Market stall (blue)', cat: 'Town', icon: '🏪', solid: 1.2, build: (e, o) => fromEnv(e, (f, p) => f.stall(p, 0, 0, 0, (o && o.opts) || ['#4f7fc8', '#f2efe6'])) },
    { k: 'stall_red', name: 'Market stall (red)', cat: 'Town', icon: '🎪', solid: 1.2, build: (e) => fromEnv(e, (f, p) => f.stall(p, 0, 0, 0, ['#c8483f', '#f2efe6'])) },
    { k: 'lamp', name: 'Lamp post', cat: 'Town', icon: '🏮', solid: 0.2, build: (e) => fromEnv(e, (f, p) => f.lamp(p, 0, 0)) },
    { k: 'bench', name: 'Bench', cat: 'Town', icon: '🪑', solid: 0.6, build: (e) => fromEnv(e, (f, p) => f.bench(p, 0, 0, 0)) },
    { k: 'planter', name: 'Flower planter', cat: 'Town', icon: '🌷', solid: 0.6, build: (e) => fromEnv(e, (f, p) => f.planter(p, 0, 0, 0)) },
    { k: 'board', name: 'Notice board', cat: 'Town', icon: '📋', solid: 0.6, build: (e) => fromEnv(e, (f, p) => f.noticeBoard(p, 0, 0)) },
    { k: 'fence', name: 'Fence', cat: 'Town', icon: '🚧', solid: 0, build: (e) => prim([
      { geo: new THREE.BoxGeometry(0.16, 1.1, 0.16), color: '#8b6440', pos: [-1.4, 0.55, 0] }, { geo: new THREE.BoxGeometry(0.16, 1.1, 0.16), color: '#8b6440', pos: [1.4, 0.55, 0] },
      { geo: new THREE.BoxGeometry(3, 0.12, 0.08), color: '#9a7350', pos: [0, 0.75, 0] }, { geo: new THREE.BoxGeometry(3, 0.12, 0.08), color: '#9a7350', pos: [0, 0.4, 0] }], e.propMat) },
    { k: 'signpost', name: 'Signpost', cat: 'Town', icon: '🪧', solid: 0.2, build: (e) => prim([
      { geo: new THREE.CylinderGeometry(0.08, 0.1, 2, 6), color: '#7a5a3e', pos: [0, 1, 0] },
      { geo: new THREE.BoxGeometry(1.1, 0.32, 0.08), color: '#c9a46a', pos: [0.4, 1.6, 0] }, { geo: new THREE.BoxGeometry(1, 0.3, 0.08), color: '#b8925a', pos: [-0.35, 1.2, 0], rot: [0, 0.2, 0] }], e.propMat) },
    { k: 'well', name: 'Well', cat: 'Town', icon: '🪣', solid: 1, build: (e) => prim([
      { geo: new THREE.CylinderGeometry(0.9, 0.95, 0.8, 12), color: '#9c958a', pos: [0, 0.4, 0], jitter: 0.15 },
      { geo: new THREE.BoxGeometry(0.12, 1.6, 0.12), color: '#7a5a3e', pos: [-0.8, 1.2, 0] }, { geo: new THREE.BoxGeometry(0.12, 1.6, 0.12), color: '#7a5a3e', pos: [0.8, 1.2, 0] },
      { geo: new THREE.ConeGeometry(1.2, 0.6, 4), color: '#a4553e', pos: [0, 2.2, 0], rot: [0, Math.PI / 4, 0] }], e.propMat) },
    { k: 'gate', name: 'Town gate', cat: 'Town', icon: '🏰', solid: 0, blocks: [[-3.7, 0, 1.2], [3.7, 0, 1.2]], build: (e) => fromEnv(e, (f, p) => f.gate(p, p), true) },
    { k: 'spike_wall', name: 'Spike wall', cat: 'Town', icon: '🪵', solid: 0, rect: (o) => [((o.opts && o.opts.n) || 8) * 0.25, 0.3], build: (e, o) => {
      const n = (o && o.opts && o.opts.n) || 8, parts = [], r = U.mulberry32(n * 7 + 3);
      for (let i = 0; i < n; i++) { const x = (i - (n - 1) / 2) * 0.5, sc = 0.9 + r() * 0.25;
        parts.push({ geo: new THREE.CylinderGeometry(0.2, 0.24, 2.4, 6), color: '#8a5a33', pos: [x, 1.2 * sc, 0], scale: [1, sc, 1], jitter: 0.15 }, { geo: new THREE.ConeGeometry(0.21, 0.5, 6), color: '#a77446', pos: [x, 2.4 * sc + 0.25, 0] }); }
      return prim(parts, e.propMat); } },
    // Bridges (walkable: players walk on the deck, over water too)
    { k: 'bridge_wood', name: 'Wooden bridge', cat: 'Bridges', icon: '🌉', solid: 0, deck: { hw: 2.6, hl: 7.5, top: 0.35 }, rails: true, build: (e) => prim([
      { geo: new THREE.BoxGeometry(5.2, 0.25, 15), color: '#9a7350', pos: [0, 0.22, 0] },
      ...Array.from({ length: 14 }, (_, i) => ({ geo: new THREE.BoxGeometry(5.3, 0.06, 0.9), color: i % 2 ? '#a77c55' : '#8f6a46', pos: [0, 0.37, -6.5 + i * 1.0] })),
      ...[-1, 1].flatMap((sx) => [{ geo: new THREE.BoxGeometry(0.14, 0.14, 15), color: '#7a5636', pos: [sx * 2.5, 1.25, 0] },
        ...Array.from({ length: 6 }, (_, i) => ({ geo: new THREE.BoxGeometry(0.18, 1.1, 0.18), color: '#6e4c30', pos: [sx * 2.5, 0.85, -7.2 + i * 2.88] }))]),
      ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({ geo: new THREE.CylinderGeometry(0.22, 0.26, 2.4, 7), color: '#6a4a2e', pos: [sx * 2.4, -0.9, sz * 6.8] })))], e.propMat) },
    { k: 'bridge_stone', name: 'Stone bridge', cat: 'Bridges', icon: '🌁', solid: 0, deck: { hw: 2.4, hl: 7, top: 0.6 }, rails: true, build: (e) => prim([
      { geo: new THREE.BoxGeometry(4.8, 0.5, 14), color: '#b3aca0', pos: [0, 0.35, 0], jitter: 0.06 },
      { geo: new THREE.CylinderGeometry(3.2, 3.2, 4.6, 16, 1, false, 0, Math.PI), color: '#a39c90', pos: [0, -2.6, 0], rot: [0, Math.PI / 2, Math.PI / 2], scale: [1, 1, 1] },
      ...[-1, 1].map((sx) => ({ geo: new THREE.BoxGeometry(0.35, 0.7, 14), color: '#c2bbae', pos: [sx * 2.3, 0.95, 0], jitter: 0.05 }))], e.propMat) },
    { k: 'bridge_rope', name: 'Rope bridge', cat: 'Bridges', icon: '🪢', solid: 0, deck: { hw: 1.1, hl: 6, top: 0.25 }, rails: true, build: (e) => prim([
      ...Array.from({ length: 16 }, (_, i) => ({ geo: new THREE.BoxGeometry(2.2, 0.08, 0.55), color: i % 2 ? '#a77c55' : '#8f6a46', pos: [0, 0.2, -5.6 + i * 0.75], rot: [0, (i % 3 - 1) * 0.04, 0] })),
      ...[-1, 1].flatMap((sx) => [{ geo: new THREE.CylinderGeometry(0.04, 0.04, 12, 4), color: '#c9b48a', pos: [sx * 1.05, 1.0, 0], rot: [Math.PI / 2, 0, 0] },
        ...[-1, 1].map((sz) => ({ geo: new THREE.CylinderGeometry(0.1, 0.12, 1.6, 6), color: '#6e4c30', pos: [sx * 1.05, 0.6, sz * 5.9] }))])], e.propMat) },
    { k: 'boardwalk', name: 'Boardwalk / dock', cat: 'Bridges', icon: '🛶', solid: 0, deck: { hw: 1.6, hl: 4, top: 0.4 }, rails: false, build: (e) => prim([
      ...Array.from({ length: 10 }, (_, i) => ({ geo: new THREE.BoxGeometry(3.2, 0.1, 0.75), color: i % 2 ? '#a77c55' : '#94704b', pos: [0, 0.35, -3.6 + i * 0.8] })),
      ...[-1, 1].flatMap((sx) => [-1, 0, 1].map((sz) => ({ geo: new THREE.CylinderGeometry(0.13, 0.15, 2, 6), color: '#6e4c30', pos: [sx * 1.45, -0.6, sz * 3.6] })))], e.propMat) },
    { k: 'water_pond', name: 'Pond (water)', cat: 'Water', icon: '💧', solid: 3.7, build: () => waterMesh(new THREE.CircleGeometry(4, 40)) },
    { k: 'water_pool', name: 'Pool (water)', cat: 'Water', icon: '🟦', solid: 0, rect: [4, 4], build: () => waterMesh(new THREE.PlaneGeometry(8, 8)) },
    { k: 'water_stream', name: 'Stream piece', cat: 'Water', icon: '〰️', solid: 0, rect: [1.6, 4], build: () => waterMesh(new THREE.PlaneGeometry(3.2, 8)) },
    { k: 'door', name: 'Door', cat: 'Indoor', icon: '🚪', solid: 0, build: (e) => prim([
      { geo: new THREE.BoxGeometry(1.5, 2.4, 0.12), color: '#7a5236', pos: [0, 1.2, 0] }, { geo: new THREE.BoxGeometry(1.9, 0.22, 0.3), color: '#5a3c26', pos: [0, 2.5, 0] },
      { geo: new THREE.BoxGeometry(0.2, 2.6, 0.3), color: '#5a3c26', pos: [-0.85, 1.3, 0] }, { geo: new THREE.BoxGeometry(0.2, 2.6, 0.3), color: '#5a3c26', pos: [0.85, 1.3, 0] },
      { geo: new THREE.SphereGeometry(0.07, 6, 4), color: '#d9b45a', pos: [0.5, 1.15, 0.1] }], e.propMat) },
    { k: 'wall_wood', name: 'Wooden wall', cat: 'Indoor', icon: '🧱', solid: 0, rect: [2, 0.2], build: (e) => prim([
      { geo: new THREE.BoxGeometry(4, 3, 0.25), color: '#c9a87a', pos: [0, 1.5, 0] }, { geo: new THREE.BoxGeometry(4, 0.3, 0.32), color: '#7a5236', pos: [0, 0.15, 0] },
      { geo: new THREE.BoxGeometry(0.25, 3.1, 0.34), color: '#7a5236', pos: [-1.9, 1.55, 0] }], e.propMat) },
    { k: 'wall_stone', name: 'Stone wall', cat: 'Indoor', icon: '🧱', solid: 0, rect: [2, 0.3], build: (e) => prim([{ geo: new THREE.BoxGeometry(4, 3.2, 0.5, 4, 3, 1), color: '#9c958a', pos: [0, 1.6, 0], jitter: 0.08 }], e.propMat) },
    { k: 'table', name: 'Table', cat: 'Indoor', icon: '🪵', solid: 0.7, build: (e) => prim([{ geo: new THREE.BoxGeometry(1.8, 0.12, 1), color: '#9a7350', pos: [0, 0.8, 0] },
      ...[[-0.8, -0.4], [0.8, -0.4], [-0.8, 0.4], [0.8, 0.4]].map(([x, z]) => ({ geo: new THREE.BoxGeometry(0.1, 0.8, 0.1), color: '#7a5236', pos: [x, 0.4, z] }))], e.propMat) },
    { k: 'shelf', name: 'Shelf', cat: 'Indoor', icon: '📚', solid: 0.5, build: (e) => prim([{ geo: new THREE.BoxGeometry(1.6, 2, 0.45), color: '#7a5236', pos: [0, 1, 0] },
      ...[0.5, 1.1, 1.6].map((y, i) => ({ geo: new THREE.BoxGeometry(1.3, 0.3, 0.3), color: ['#a8444a', '#4a6aa8', '#5a8a4a'][i], pos: [0, y, 0.06] }))], e.propMat) },
    { k: 'bed', name: 'Bed', cat: 'Indoor', icon: '🛏️', solid: 0.9, build: (e) => prim([{ geo: new THREE.BoxGeometry(1.2, 0.5, 2.2), color: '#7a5236', pos: [0, 0.25, 0] },
      { geo: new THREE.BoxGeometry(1.1, 0.2, 2), color: '#e8e2d6', pos: [0, 0.6, 0] }, { geo: new THREE.BoxGeometry(1.1, 0.22, 1.2), color: '#6a8ac8', pos: [0, 0.68, 0.35] }], e.propMat) },
    { k: 'stalagmite', name: 'Stalagmite', cat: 'Props', icon: '🗻', solid: 0.5, build: (e) => prim([{ geo: new THREE.ConeGeometry(0.6, 2.4, 7), color: '#8a7f70', pos: [0, 1.2, 0], jitter: 0.2 }], e.propMat) },
    // Props
    { k: 'barrel', name: 'Barrel', cat: 'Props', icon: '🛢️', solid: 0.4, build: (e) => fromEnv(e, (f, p) => f.barrel(p, 0, 0)) },
    { k: 'crate', name: 'Crate', cat: 'Props', icon: '📦', solid: 0.45, build: (e) => fromEnv(e, (f, p) => f.crate(p, 0, 0, 0)) },
    { k: 'torch', name: 'Torch stand', cat: 'Props', icon: '🔥', solid: 0.15, light: { color: '#ffb35a', intensity: 1.2, range: 9 }, build: (e) => prim([
      { geo: new THREE.CylinderGeometry(0.06, 0.08, 1.6, 6), color: '#5a4030', pos: [0, 0.8, 0] }, { geo: new THREE.ConeGeometry(0.18, 0.3, 6), color: '#3a2a20', pos: [0, 1.7, 0], rot: [Math.PI, 0, 0] },
      { geo: new THREE.IcosahedronGeometry(0.16, 0), color: '#ffb347', pos: [0, 1.88, 0] }], e.propMat) },
    { k: 'crystal', name: 'Crystal', cat: 'Props', icon: '💎', solid: 0.4, build: (e) => prim([
      { geo: new THREE.OctahedronGeometry(0.5, 0), color: '#9fd8ff', pos: [0, 0.8, 0], scale: [0.6, 1.6, 0.6] },
      { geo: new THREE.OctahedronGeometry(0.3, 0), color: '#c3b2ff', pos: [0.4, 0.45, 0.1], scale: [0.6, 1.4, 0.6], rot: [0, 0, 0.4] }], e.propMat) },
    { k: 'pebbles', name: 'Pebbles', cat: 'Props', icon: '⚪', solid: 0, build: (e) => prim([[0, 0, 0.18], [0.35, 0.2, 0.13], [-0.3, 0.25, 0.15], [0.15, -0.35, 0.11], [-0.2, -0.25, 0.1]].map(([x, z, r]) => ({ geo: new THREE.DodecahedronGeometry(r, 0), color: '#a59f94', pos: [x, r * 0.6, z], scale: [1.2, 0.7, 1] })), e.propMat) },
    { k: 'pillar', name: 'Stone pillar', cat: 'Props', icon: '🏛️', solid: 0.5, build: (e) => prim([
      { geo: new THREE.BoxGeometry(0.9, 0.3, 0.9), color: '#b9b2a4', pos: [0, 0.15, 0] }, { geo: new THREE.CylinderGeometry(0.32, 0.36, 3.2, 10), color: '#cfc8b8', pos: [0, 1.9, 0] },
      { geo: new THREE.BoxGeometry(0.9, 0.3, 0.9), color: '#b9b2a4', pos: [0, 3.65, 0] }], e.propMat) },
    { k: 'hay', name: 'Hay bale', cat: 'Props', icon: '🌾', solid: 0.6, build: (e) => prim([{ geo: new THREE.CylinderGeometry(0.6, 0.6, 1.1, 12), color: '#d8b863', pos: [0, 0.6, 0], rot: [0, 0, Math.PI / 2] }], e.propMat) },
    { k: 'cart', name: 'Hand cart', cat: 'Props', icon: '🛒', solid: 0.9, build: (e) => prim([
      { geo: new THREE.BoxGeometry(1.6, 0.5, 1), color: '#9a7350', pos: [0, 0.75, 0] },
      { geo: new THREE.CylinderGeometry(0.4, 0.4, 0.1, 12), color: '#5a4030', pos: [0, 0.4, 0.58], rot: [Math.PI / 2, 0, 0] }, { geo: new THREE.CylinderGeometry(0.4, 0.4, 0.1, 12), color: '#5a4030', pos: [0, 0.4, -0.58], rot: [Math.PI / 2, 0, 0] },
      { geo: new THREE.BoxGeometry(1.4, 0.08, 0.08), color: '#7a5a3e', pos: [1.4, 0.75, 0.3] }, { geo: new THREE.BoxGeometry(1.4, 0.08, 0.08), color: '#7a5a3e', pos: [1.4, 0.75, -0.3] }], e.propMat) },
    { k: 'tent', name: 'Tent', cat: 'Props', icon: '⛺', solid: 1.4, build: (e) => prim([{ geo: new THREE.ConeGeometry(1.8, 2.2, 4), color: '#d9c8a0', pos: [0, 1.1, 0], rot: [0, Math.PI / 4, 0] }, { geo: new THREE.BoxGeometry(0.6, 1, 0.05), color: '#5a4030', pos: [0, 0.5, 1.15] }], e.propMat) },
    { k: 'tombstone', name: 'Gravestone', cat: 'Props', icon: '🪦', solid: 0.35, build: (e) => prim([{ geo: new THREE.BoxGeometry(0.7, 1, 0.22), color: '#8d8a84', pos: [0, 0.5, 0], jitter: 0.15 }], e.propMat) },
    // The scenery's own pieces (v0.37): the same shapes the maps are built from.
    { k: 'grass_tuft', name: 'Grass tuft', cat: 'Nature', icon: '🌱', solid: 0, build: (e) => { const m = new THREE.Mesh(e.coverGeos().grass, e.grassMat); m.receiveShadow = true; return wrap(m); } },
    { k: 'wildflower', name: 'Wildflower', cat: 'Flowers', icon: '🌸', solid: 0, colors: [['#ff6b8b', 'Pink'], ['#ffd84d', 'Yellow'], ['#ffffff', 'White'], ['#b38cff', 'Purple'], ['#ff9f43', 'Orange'], ['#7cc8ff', 'Blue'], ['#ff5e7a', 'Red']],
      build: (e, o) => { const g = e.coverGeos(); return prim([{ geo: g.stem.clone(), color: '#5aa043' }, { geo: g.head.clone(), color: col(o, '#ff6b8b') }], e.propMat); } },
    { k: 'lily_pad', name: 'Lily pad', cat: 'Water', icon: '🪷', solid: 0, colors: [['#4f9e46', 'Green'], ['#ff9ec2', 'Pink']],
      build: (e, o) => prim([{ geo: e.pondGeos().pad.clone(), color: col(o, '#4f9e46'), pos: [0, 0.02, 0] }], e.propMat) },
    { k: 'reeds', name: 'Reeds', cat: 'Water', icon: '🌾', solid: 0, build: (e) => { const m = new THREE.Mesh(e.pondGeos().reeds, e.grassMat); m.castShadow = true; m.receiveShadow = true; return wrap(m); } },
    { k: 'signpost_arrows', name: 'Signpost (arrows)', cat: 'Town', icon: '🪧', solid: 0.2, build: (e) => fromEnv(e, (f, p) => f.signpost(p, 0, 0, 0)) },
    { k: 'sign', name: 'Sign (your text)', cat: 'Town', icon: '📜', solid: 0.2, text: true, build: (e, o) => signMesh(e, (o && o.opts && o.opts.text) || SIGN_TEXT) },
    { k: 'cave_torch', name: 'Cave torch', cat: 'Props', icon: '🔥', solid: 0.15, light: { color: '#ffb366', intensity: 1.6, range: 16, y: 2.6 }, lightIf: (o) => !o.opts || o.opts.light !== false,
      build: (e) => fromEnv(e, (f, p) => f.caveTorch(p, 0, 0, 0, {})) },
    { k: 'glow_crystal', name: 'Glowing crystal', cat: 'Props', icon: '🔮', solid: 0, colors: [['#7fe8ff', 'Cyan'], ['#b98cff', 'Violet'], ['#ff9ad6', 'Pink'], ['#ffd84a', 'Gold']],
      build: (e, o) => { const m = new THREE.Mesh(U.mergeParts([[0, 0.35, 0, 0.1, 0.4, 0.05, 0.3], [0.32, 0.25, 0.15, 0.4, 2.1, 0.3, 0.22], [-0.25, 0.22, -0.2, 0.3, 4, 0.5, 0.2]].map(([x, y, z, rx, ry, rz, s]) =>
        ({ geo: new THREE.OctahedronGeometry(1, 0), color: '#ffffff', pos: [x, y + s * 1.2, z], rot: [rx, ry, rz], scale: [s * 0.55, s * 1.6, s * 0.55] }))), G.Environment.glowMaterial(col(o, '#7fe8ff'))); return wrap(m); } },
    { k: 'bone', name: 'Bone', cat: 'Props', icon: '🦴', solid: 0, build: (e) => prim([{ geo: new THREE.CylinderGeometry(0.05, 0.05, 0.7, 5), color: '#efe6d2', pos: [0, 0.06, 0], rot: [Math.PI / 2, 0, 0.4] }], e.propMat) },
  ];
  /* Original props: recorded while a map is built, so they can be turned into
     editable objects; once a map's originals are "taken over", they're skipped
     here and come back as editor objects instead. */
  const REC = { house: 'house', fountain: 'fountain', stall: 'stall_blue', lamp: 'lamp', bench: 'bench', planter: 'planter', barrel: 'barrel', crate: 'crate', noticeBoard: 'board', gate: 'gate', palisade: 'spike_wall',
    signpost: 'signpost_arrows', caveTorch: 'cave_torch' };
  // Which take-over step makes each recorded kind editable: 1 houses, trees and props; 2 the gate and
  // spike wall; 'more' the bridge signpost and cave torches (added in v0.37).
  const REC_STEP = { gate: 2, palisade: 2, signpost: 'more', caveTorch: 'more' };
  // Batched decorations (rocks, bushes, mushrooms, stalagmites, logs, pond plants, giant mushrooms,
  // cave crystals and floor bits) are captured item by item while these builders run. Grass tufts and
  // small flowers stay ground cover (thousands per map), edited with the map editor's grass brush.
  const CAPTURE = ['buildField', 'buildCave', 'giantMushrooms', 'pondDetails'];
  if (G.Environment) {
    const P = G.Environment.prototype, inst = P.instanced;
    P.instanced = function (geo, mat, list, opts) {
      opts = opts || {};
      // The first kinds were numbered in build order; kinds added later have their own names (opts.key).
      const named = !!opts.key, old = !named && (mat === this.propMat || mat === this.foliageMat) && list.length <= 800;
      if (this._capCtx && !this._lib && list.length && (named || old)) {
        const key = named ? this._capCtx + ':' + opts.key : this._capCtx + '#' + (this._capN = (this._capN || 0) + 1);
        (this.captured || (this.captured = {}))[key] = { geo, mat, n: geo.attributes.position.count, name: opts.name, cast: !!opts.cast };
        (this.capturedItems || (this.capturedItems = [])).push(...list.map((it) => ({ key, x: it.x, y: it.y, z: it.z, rx: it.rx || 0, ry: it.ry || 0, rz: it.rz || 0,
          s: Array.isArray(it.s) ? it.s : [it.s || 1, it.s || 1, it.s || 1], color: it.color, block: it.block || 0, rect: it.rect })));
        if (this.map && this.taken(named ? 'more' : 'legacy')) return null;
      }
      return inst.call(this, geo, mat, list, opts);
    };
    // Trees are recorded one by one already; their batch isn't captured.
    const flush = P.flushTrees;
    if (flush) P.flushTrees = function (...a) { const prev = this._capCtx; this._capCtx = null; try { return flush.apply(this, a); } finally { this._capCtx = prev; } };
    for (const fn of CAPTURE) {
      const orig = P[fn]; if (!orig) continue;
      P[fn] = function (...a) { const prev = this._capCtx; this._capCtx = fn; this._capN = 0; try { return orig.apply(this, a); } finally { this._capCtx = prev; } };
    }
  }
  if (G.Environment) for (const fn of [...Object.keys(REC), 'treeAt']) {
    const orig = G.Environment.prototype[fn];
    if (!orig) continue;
    G.Environment.prototype[fn] = function (...a) {
      if (this._lib || this._inRec) return orig.apply(this, a);
      (this.recorded || (this.recorded = [])).push({ fn, a: fn === 'treeAt' ? a.slice(0, 4) : a.slice(1) });
      const step = REC_STEP[fn] || 1, map = this.map;
      if (map && (step === 'more' ? map.takeMore : map.takeover >= step)) return fn === 'treeAt' ? true : undefined;
      this._inRec = true;
      try { return orig.apply(this, a); } finally { this._inRec = false; }
    };
  }

  // Entities: things that do something rather than just stand there.
  const ENTITIES = [
    { type: 'warp', name: 'Warp portal', icon: '🌀', color: '#7fd3ff', defaults: { to: 'meadow', tx: 0, tz: 0, label: '' } },
    { type: 'light', name: 'Light', icon: '💡', color: '#ffd27a', defaults: { color: '#ffd9a0', intensity: 1.4, range: 12, y: 2.5 } },
    { type: 'spawn', name: 'Monster spawn', icon: '👾', color: '#ff7a7a', defaults: { monster: 'poring', count: 5, r: 6 } },
    { type: 'npc', name: 'NPC', icon: '🧑', color: '#9cff8a', defaults: { name: 'Villager', title: '', costume: 'novice', hair: 'chestnut', style: 'short', lines: ['Hello there, traveller!'] } },
    { type: 'start', name: 'Player start', icon: '🚩', color: '#ffffff', defaults: {} },
    { type: 'fx', name: 'Effect / sound', icon: '✨', color: '#ff9de2', defaults: { effect: 'fire', size: 1, y: 0 } },
    // A map's own NPCs once its originals are editable (they keep their shops, quests and dialog).
    { type: 'npcref', name: 'NPC (original)', icon: '🧑', color: '#c6f5a8', hidden: true, defaults: {} },
  ];

  // Looks for a map: sky (top, middle, horizon), fog, light.
  const ATMOS = {
    day: null,
    dusk: { sky: ['#3b2f5c', '#c96b4a', '#f2b27a'], fog: '#d9a07a', near: 40, far: 200, hemi: 0.45, sun: 0.85, ground: '#5a4a3a' },
    night: { sky: ['#05070f', '#0d1530', '#1b2648'], fog: '#141c33', near: 25, far: 140, hemi: 0.3, sun: 0.32, ground: '#1c2430' },
    spooky: { sky: ['#0b0a10', '#221d2e', '#3a3346'], fog: '#2a2533', near: 8, far: 70, hemi: 0.3, sun: 0.35, ground: '#2a2a2a' },
    misty: { sky: ['#8fa6b8', '#c9d6dd', '#e4ebee'], fog: '#d8e1e4', near: 12, far: 110, hemi: 0.6, sun: 0.9, ground: '#6b8f45' },
    indoor: { sky: ['#1a120c', '#2a1d14', '#3a2a1e'], fog: '#2a2018', near: 22, far: 70, hemi: 0.95, sun: 0.75, ground: '#8a6a4a' },
    cave: { sky: ['#020203', '#08080a', '#101014'], fog: '#0c0c10', near: 12, far: 60, hemi: 0.25, sun: 0.2, ground: '#202020' },
  };
  const DAY = { sky: ['#4a98e6', '#9fd0f4', '#dceef5'], fog: '#dceef5', near: 90, far: 300, hemi: 0.62, sun: 1.28, ground: '#6b8f45' };
  const FX = ['fire', 'smoke', 'fireflies', 'sparkles', 'leaves', 'fog', 'snow', 'sound_water', 'sound_wind', 'sound_fire', 'sound_birds'];

  /* Effects: small particle systems (and ambient sounds) for 'fx' entities. */
  const glowTex = (() => { let t = null; return () => { if (t) return t; const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64); t = new THREE.CanvasTexture(c); return t; }; })();
  const FXDEF = {
    fire: { n: 40, color: '#ff8a2a', size: 0.55, add: true, life: [0.5, 1.1], vel: [0, 1.6, 0], spread: 0.35, light: '#ff9a4a' },
    smoke: { n: 30, color: '#8a8580', size: 1.4, add: false, life: [2, 3.5], vel: [0, 0.9, 0], spread: 0.5, opacity: 0.35 },
    fireflies: { n: 26, color: '#d9ff7a', size: 0.25, add: true, life: [3, 6], vel: [0, 0.1, 0], spread: 5, wander: 0.8, blink: true },
    sparkles: { n: 30, color: '#ffffff', size: 0.22, add: true, life: [0.6, 1.5], vel: [0, 0.3, 0], spread: 1.6, blink: true },
    leaves: { n: 24, color: '#d99a3a', size: 0.3, add: false, life: [4, 7], vel: [0.2, -0.6, 0.1], spread: 4, height: 5, wander: 0.6 },
    fog: { n: 18, color: '#e8eef2', size: 4, add: false, life: [6, 10], vel: [0.25, 0, 0.1], spread: 6, opacity: 0.22, height: 0.6 },
    snow: { n: 60, color: '#ffffff', size: 0.18, add: false, life: [5, 8], vel: [0.1, -0.7, 0.05], spread: 6, height: 8, wander: 0.3 },
  };
  function makeFx(e, group) {
    const d = FXDEF[e.effect]; if (!d) return null;
    const sz = +e.size || 1, n = d.n, pos = new Float32Array(n * 3), geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: d.color, size: d.size * sz, map: glowTex(), transparent: true, depthWrite: false, opacity: d.opacity || 0.9,
      blending: d.add ? THREE.AdditiveBlending : THREE.NormalBlending, sizeAttenuation: true });
    const pts = new THREE.Points(geo, mat); pts.frustumCulled = false;
    const base = new THREE.Vector3(e.x, G.Terrain.surfaceHeight(e.x, e.z) + (+e.y || 0), e.z);
    pts.position.copy(base); group.add(pts);
    const ps = Array.from({ length: n }, () => ({ age: Math.random() * d.life[1], life: d.life[0], x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }));
    const fx = { e, d, sz, pts, ps, pos };
    if (d.light) { fx.light = new THREE.PointLight(d.light, 1.3 * sz, 9 * sz, 1.8); fx.light.position.copy(base).add(new THREE.Vector3(0, 0.8, 0)); group.add(fx.light); }
    return fx;
  }
  function stepFx(fx, dt, t) {
    const { d, sz, ps, pos } = fx;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i]; p.age += dt;
      if (p.age > p.life) {
        p.age = 0; p.life = d.life[0] + Math.random() * (d.life[1] - d.life[0]);
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * d.spread * sz;
        p.x = Math.cos(a) * r; p.z = Math.sin(a) * r; p.y = (d.height || 0) * Math.random() * sz;
        p.vx = d.vel[0] * (0.5 + Math.random()); p.vy = d.vel[1] * (0.6 + Math.random() * 0.8) * sz; p.vz = d.vel[2] * (0.5 + Math.random());
      }
      if (d.wander) { p.vx += (Math.random() - 0.5) * d.wander * dt * 4; p.vz += (Math.random() - 0.5) * d.wander * dt * 4; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (d.height && p.y < 0) p.age = p.life + 1;
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
    }
    fx.pts.geometry.attributes.position.needsUpdate = true;
    if (d.blink) fx.pts.material.opacity = 0.6 + 0.35 * Math.sin(t * 6 + fx.e.x);
    if (fx.light) fx.light.intensity = (1.1 + Math.sin(t * 13) * 0.15 + Math.sin(t * 7.3) * 0.12) * sz;
  }
  /* Ambient sounds: soft filtered noise (water, wind, fire) or birdsong, louder as you get close. */
  function makeSound(e, game) {
    const A = game.audio, ctx = A && A.ctx; if (!ctx) return null;
    const kind = e.effect.slice(6), out = ctx.createGain(); out.gain.value = 0; out.connect(A.sfxGain || A.master || ctx.destination);
    const s = { e, out, kind, range: 14 * (+e.size || 1) };
    if (kind === 'birds') { s.next = 0; return s; }
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), ch = buf.getChannelData(0);
    let last = 0; for (let i = 0; i < ch.length; i++) { const w = Math.random() * 2 - 1; last = kind === 'water' ? (last + 0.02 * w) / 1.02 : w; ch[i] = kind === 'water' ? last * 3.5 : w; }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = kind === 'wind' ? 'bandpass' : 'lowpass'; f.frequency.value = kind === 'water' ? 900 : kind === 'wind' ? 500 : 2200; f.Q.value = kind === 'wind' ? 0.8 : 0.5;
    src.connect(f); f.connect(out); src.start(); s.src = src; s.filter = f;
    return s;
  }
  function stepSound(s, game, t) {
    const A = game.audio, ctx = A.ctx, p = game.player.position;
    const dist = Math.hypot(p.x - s.e.x, p.z - s.e.z), vol = Math.max(0, 1 - dist / s.range);
    const k = { water: 0.35, wind: 0.25, fire: 0.18, birds: 0.18 }[s.kind] || 0.2;
    s.out.gain.setTargetAtTime(vol * k, ctx.currentTime, 0.3);
    if (s.kind === 'wind' && s.filter) s.filter.frequency.setTargetAtTime(400 + 250 * Math.sin(t * 0.4), ctx.currentTime, 0.5);
    if (s.kind === 'fire' && s.filter && Math.random() < 0.08) s.out.gain.setValueAtTime(vol * k * 2.2, ctx.currentTime);
    if (s.kind === 'birds' && vol > 0 && t > s.next) {
      s.next = t + 1.2 + Math.random() * 3;
      const o = ctx.createOscillator(), g = ctx.createGain(), f0 = 2200 + Math.random() * 1500, t0 = ctx.currentTime;
      o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(f0 * 1.4, t0 + 0.08); o.frequency.exponentialRampToValueAtTime(f0 * 0.9, t0 + 0.16);
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol * k, t0 + 0.02); g.gain.linearRampToValueAtTime(0, t0 + 0.18);
      o.connect(g); g.connect(s.out); s.out.gain.value = 1; o.start(t0); o.stop(t0 + 0.2);
    }
  }

  const CustomMaps = {
    ATMOS, DAY, FX,
    rule(name) { const g = this.game, d = g && this.data[g.mapId]; return !!(d && d.rules && d.rules[name]); },
    // Effects and sounds tick every frame.
    update(dt, t, game) {
      this.game = game;
      // Every couple of seconds: is this map missing its saved edits? (e.g. it was built for the title screen)
      const now = performance.now();
      if (now - (this.healAt || 0) > 2000) { this.healAt = now; this.healCurrent(); }
      for (const fx of this.fx || []) stepFx(fx, dt, t);
      if (game && game.player) for (const s of this.sounds || []) stepSound(s, game, t);
    },
    clearFx() { for (const s of this.sounds || []) { try { if (s.src) s.src.stop(); s.out.disconnect(); } catch (e) { /* ignore */ } } this.fx = []; this.sounds = []; },
    spawnFx(game, e) {
      if (e.effect && e.effect.startsWith('sound_')) { const s = makeSound(e, game); if (s) this.sounds.push(s); return; }
      const fx = makeFx(e, this.group); if (fx) this.fx.push(fx);
    },
    // Painted walkability: 1 = blocked, 2 = walkable (applied on top of everything else).
    applyWalk(game, d) {
      const w = d && d.walk && d.walk.d; if (!w) return;
      const nav = game.nav;
      for (const [k, v] of Object.entries(w)) { const [x, z] = k.split(',').map(Number); this.setWalkCell(nav, x, z, v); }
    },
    setWalkCell(nav, x, z, v) {
      const c0 = nav.toCell(x), c1 = nav.toCell(x + 0.999), r0 = nav.toCell(z), r1 = nav.toCell(z + 0.999);
      for (let cz = r0; cz <= r1; cz++) for (let cx = c0; cx <= c1; cx++) if (nav.inBounds(cx, cz)) nav.blocked[nav.idx(cx, cz)] = v === 1 ? 1 : 0;
    },
    LIB, ENTITIES, DEFAULT_BOUNDS, parseGLB,
    data: {},              // map id -> map data
    assets: [],            // uploaded models [{id, name, size}]
    modelCache: new Map(), // asset id -> Promise<Object3D>
    get(id) { return this.data[id] || null; },
    set(id, d) { if (d) this.data[id] = d; else delete this.data[id]; this.register(); },
    // Brand-new maps become real maps the game can travel to.
    register() {
      for (const [id, d] of Object.entries(this.data)) if (d.base === 'blank' && !G.Maps[id]) {
        const f = G.Maps.forest;
        G.Maps[id] = Object.assign({}, f, { id, name: d.name || id, custom: true, paths: [], spawns: [], npcs: [], portals: [], stream: false, bridge: false, pond: null,
          forest: { count: 0, grove: 1, clearing: 1 }, seed: [...id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0 });
      } else if (G.Maps[id] && G.Maps[id].custom && d.name) G.Maps[id].name = d.name;
    },
    async fetch(tries = 30, attempt = 1) {
      try {
        const r = await fetch('/api/maps', { cache: 'no-store' });
        if (!r.ok) throw new Error('maps ' + r.status);
        this.data = (await r.json()).maps || {}; this.register();
        const a = await fetch('/api/assets', { cache: 'no-store' });
        if (a.ok) this.assets = (await a.json()).assets || [];
        this.healCurrent();
      } catch (e) {
        // The server may still be waking up: try again shortly.
        if (tries > 1) setTimeout(() => this.fetch(tries - 1, attempt + 1), Math.min(15000, 2500 * attempt));
      }
    },
    // If the map we're on was built before its saved edits arrived, rebuild it with them.
    healCurrent() {
      const g = this.game;
      if (!g || !g.mapId || !g.player || g.traveling) return;
      if ((this.used || {})[g.mapId] === (this.data[g.mapId] || null)) return;
      if (G.MapEditor && G.MapEditor.dirty) return;
      const p = g.player.position;
      g.travel(g.mapId, p.x, p.z, true);
    },
    // Everything a built-in map came with, as editor objects and entities.
    originals(game) {
      const base = G.Maps[game.mapId], map = game.map || {}, out = { objects: [], entities: [] };
      const done = (step) => (step === 'more' ? !!map.takeMore : (map.takeover || 0) >= step);
      const u = () => Math.random().toString(36).slice(2, 9), r2 = (v) => Math.round(v * 100) / 100;
      for (const r of game.env.recorded || []) {
        if (done(REC_STEP[r.fn] || 1)) continue;
        if (r.fn === 'treeAt') {
          const [kind, x, z, sc] = r.a;
          out.objects.push({ u: u(), k: { round: 'tree', pine: 'pine', blossom: 'blossom' }[kind] || 'tree', x: r2(x), z: r2(z), y: 0, ry: 0, s: r2(sc || 1) });
          continue;
        }
        if (r.fn === 'gate') { out.objects.push({ u: u(), k: 'gate', x: 0, z: r2(C.TOWN.cz + C.TOWN.radius + 0.8), y: 0, ry: 0, s: 1 }); continue; }
        if (r.fn === 'palisade') {
          // The ring of spikes, as straight wall segments of about 8 spikes each.
          const T = C.TOWN, R = T.radius + 1, n = Math.round((Math.PI * 2 * R) / 0.5);
          let run = [];
          const flush = () => {
            if (!run.length) return;
            const a0 = run[0], a1 = run[run.length - 1], am = (a0 + a1) / 2, ch = Math.cos((a1 - a0) / 2);
            out.objects.push({ u: u(), k: 'spike_wall', x: r2(T.cx + Math.cos(am) * R * ch), z: r2(T.cz + Math.sin(am) * R * ch), y: 0, ry: r2(-am - Math.PI / 2), s: 1, opts: { n: run.length } });
            run = [];
          };
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2, x = T.cx + Math.cos(a) * R, z = T.cz + Math.sin(a) * R;
            if (z > T.cz && Math.abs(x) < 4.6) { flush(); continue; }
            run.push(a); if (run.length === 8) flush();
          }
          flush();
          continue;
        }
        const [x, z, rot, extra] = r.a;
        const o = { u: u(), k: REC[r.fn], x: r2(x), z: r2(z), y: 0, ry: typeof rot === 'number' ? r2(rot) : 0, s: 1 };
        if (r.fn === 'house' && extra) o.opts = { w: extra.w, d: extra.d, h: extra.h, wall: extra.wall, roof: extra.roof, trim: extra.trim };
        if (r.fn === 'stall' && Array.isArray(extra)) o.opts = extra.slice(0, 2);
        if (r.fn === 'caveTorch' && extra) o.opts = { light: !!extra.light };
        out.objects.push(o);
      }
      for (const it of game.env.capturedItems || []) if (!done(it.key.includes(':') ? 'more' : 2)) out.objects.push(Object.assign({ u: u(), k: 'cap:' + it.key }, capLook(it)));
      if (!done(2) && base.bridge && G.Terrain.BRIDGE_Z > -9000) out.objects.push({ u: u(), k: 'bridge_wood', x: C.BRIDGE.x, z: r2(G.Terrain.BRIDGE_Z), y: 0, ry: 0, s: 1 });
      if (map.takeover) return out;   // spawns, warps and NPCs were taken over the first time
      for (const sp of base.spawns || []) out.entities.push({ u: u(), type: 'spawn', monster: sp.type, x: sp.x, z: sp.z, y: 0, ry: 0, r: sp.r || 0.5, count: sp.count || 1 });
      for (const pt of base.portals || []) out.entities.push({ u: u(), type: 'warp', to: pt.to, tx: pt.tx, tz: pt.tz, label: pt.label || '', x: pt.x, z: pt.z, y: 0, ry: 0 });
      for (const id of base.npcs || []) {
        const d = G.NPC_DEFS.find((n) => n.id === id);
        if (d) out.entities.push({ u: u(), type: 'npcref', ref: id, name: d.name, x: r2(d.x), z: r2(d.z), y: 0, ry: r2(d.facing || 0) });
      }
      return out;
    },
    worldSizeFor(b) {
      const m = Math.max(Math.abs(b.minX), Math.abs(b.maxX), Math.abs(b.minZ), Math.abs(b.maxZ));
      return Math.max(C.WORLD_SIZE_DEFAULT || 240, Math.ceil((2 * m + 30) / 20) * 20);
    },
    // The map definition the game should load (built-in design + edits).
    prepare(id) {
      if (!C.WORLD_SIZE_DEFAULT) C.WORLD_SIZE_DEFAULT = C.WORLD_SIZE;
      (this.used || (this.used = {}))[id] = this.data[id] || null;   // which saved version this map was built with
      const base = G.Maps[id], d = this.data[id];
      C.WORLD_SIZE = C.WORLD_SIZE_DEFAULT;
      if (!d) return base;
      const map = Object.assign({}, base);
      if (d.bounds) { map.bounds = d.bounds; map.worldSize = this.worldSizeFor(d.bounds); C.WORLD_SIZE = map.worldSize; }
      if (d.ground) map.ground = d.ground;
      if (d.paint) map.paint = d.paint;
      if (d.atmo) map.atmosphere = Object.assign({}, ATMOS[d.atmo.preset] || base.atmosphere || DAY, d.atmo.custom || {});
      if (d.music) map.music = d.music;
      // Take-over 1: houses, trees and props; 2: also the gate, spike wall, bridge, rocks and bushes.
      map.takeover = d.takeover === true ? 1 : (d.takeover || 0);
      if (map.takeover >= 2) map.bridge = false;   // the bridge is an editor object now
      if (map.takeover >= 3) map.noPaths = true;   // paths, plaza and streets are paint now
      map.takeMore = !!d.more;                     // logs, pond plants, signpost, giant mushrooms, cave pieces (v0.37)
      map.hadBridge = !!base.bridge;               // its signpost stays even when the bridge is an editor object
      if (d.cover && d.cover.length) map.cover = d.cover;   // grass brush strokes
      map.decks = d.objects.map((o) => { const def = LIB.find((l) => l.k === o.k); if (!def || !def.deck) return null;
        const sc = o.s || 1; return { x: o.x, z: o.z, ry: o.ry || 0, hw: def.deck.hw * sc, hl: def.deck.hl * sc, top: def.deck.top * sc, y: o.y || 0 }; }).filter(Boolean);
      map.portals = (d.takeover ? [] : base.portals || []).concat(d.entities.filter((e) => e.type === 'warp' && G.Maps[e.to]).map((e) => ({ x: e.x, z: e.z, to: e.to, tx: +e.tx || 0, tz: +e.tz || 0, label: e.label || (G.Maps[e.to] || {}).name, invisible: e.style === 'door' })));
      if (d.flat) { map.hills = 0; map.indoor = true; }
      map.spawns = (d.takeover ? [] : base.spawns || []).concat(d.entities.filter((e) => e.type === 'spawn' && C.MONSTERS[e.monster]).map((e) => ({ type: e.monster, x: e.x, z: e.z, r: Math.max(0.5, +e.r || 5), count: Math.max(1, Math.min(50, +e.count || 1)),
        respawn: +e.respawn > 0 ? +e.respawn : undefined, announce: !!e.announce })));
      const npcs = d.entities.filter((e) => e.type === 'npc');
      for (const e of npcs) {
        const nid = 'custom_' + e.u;
        G.NPC_DEFS = G.NPC_DEFS.filter((x) => x.id !== nid);
        const lines = (e.lines || []).filter(Boolean), role = e.role || 'talk';
        if (role === 'shop') G.SHOPS[nid] = { name: e.shopName || `${e.name || 'Villager'}’s shop`, npc: nid, stock: (e.stock || []).filter((id) => G.Items.get(id)) };
        G.NPC_DEFS.push({ id: nid, name: e.name || 'Villager', title: e.title || '', costume: e.costume || 'novice', x: e.x, z: e.z, facing: e.ry || 0,
          appearance: { hair: e.hair || 'chestnut', eyes: 'amber', style: e.style || 'short' },
          script: async (dlg, game) => {
            const p = game.player, hello = lines[0] || 'Hello there!';
            if (role === 'shop') { const c = await dlg.choose(hello, ['Buy', 'Sell', 'Leave']); if (c === 0) game.shop.open('buy', nid); else if (c === 1) game.shop.open('sell', nid); return; }
            if (role === 'kafra') {
              const dests = (e.dests || []).filter((x) => G.Maps[x.map]);
              if (!dests.length) { await dlg.say(hello); return; }
              const c = await dlg.choose(hello, [...dests.map((x) => `${x.label || G.Maps[x.map].name}${+x.cost ? ` — ${(+x.cost).toLocaleString()} z` : ''}`), 'Cancel']);
              const dst = dests[c]; if (!dst) return;
              if (p.zeny < (+dst.cost || 0)) { await dlg.say('Sorry, you don’t have enough Zeny for that.'); return; }
              p.zeny -= +dst.cost || 0; game.save.markDirty();
              if (dst.map === game.mapId) p.teleport(+dst.x || 0, +dst.z || 0); else game.travel(dst.map, +dst.x || 0, +dst.z || 0);
              return;
            }
            if (role === 'save') {
              const c = await dlg.choose(hello, ['Save my position here', 'Leave']);
              if (c === 0) { p.savePoint = { map: game.mapId, x: p.position.x, z: p.position.z }; game.save.save(true); await dlg.say('Your position has been saved.'); }
              return;
            }
            if (role === 'heal') { p.hp = p.maxHp; p.sp = p.maxSp; game.sfx('heal'); await dlg.say(hello === 'Hello there!' ? 'There you go, all patched up!' : hello); return; }
            for (const l of (lines.length ? lines : ['...'])) await dlg.say(l);
          } });
      }
      // Original NPCs: where the editor put them (or gone, if deleted there).
      let own = base.npcs || [];
      if (d.takeover) {
        own = [];
        for (const e of d.entities.filter((x) => x.type === 'npcref')) {
          const def = G.NPC_DEFS.find((n) => n.id === e.ref);
          if (def) { def.x = e.x; def.z = e.z; def.facing = e.ry || 0; own.push(e.ref); }
        }
      }
      map.npcs = own.concat(npcs.map((e) => 'custom_' + e.u));
      return map;
    },
    // Objects, lights and the map's edges, after the map itself is built.
    build(game) {
      this.game = game;
      this.installRules();
      const d = this.data[game.mapId];
      this.batches = [];
      if (this.group) { this.group.removeFromParent(); this.group = null; }
      this.clearFx();
      this.objects = []; this.lights = [];
      if (!d) return;
      this.repairCaps(game, d);
      this.group = new THREE.Group(); game.mapRoot.add(this.group);
      for (const o of d.objects) this.spawnObject(game, o, true);
      for (const e of d.entities) if (e.type === 'light') this.spawnLight(game, e);
      this.clearFx();
      for (const e of d.entities) if (e.type === 'fx') this.spawnFx(game, e);
      setTimeout(() => this.batch(), 0);
      // Anything outside the map's bounds can't be walked on.
      if (d.bounds) {
        const b = d.bounds, h = game.nav.size / 2;
        for (let x = -h; x < h; x += 1) for (let z = -h; z < h; z += 1)
          if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) game.nav.blockCircle(x + 0.5, z + 0.5, 0.75);
      }
      this.applyWalk(game, d);
      if (d.rules && d.rules.pvp) setTimeout(() => game.hud.toast('⚔ PvP area: other players can attack you here.'), 600);
    },
    // While playing, identical objects are drawn together (much faster); split up again for editing.
    batch() {
      this.unbatch();
      if (!this.group || (G.MapEditor && G.MapEditor.active)) return;
      this.group.updateMatrixWorld(true);
      const groups = new Map();
      for (const g of this.objects || []) {
        // Only plain one-mesh objects (a torch's flame sprite would be hidden with it).
        const ms = []; let other = false;
        g.traverse((o) => { if (o.isMesh && (!o.isInstancedMesh || o.userData.cap)) ms.push(o); else if (o.isSprite || o.isPoints || o.isLine) other = true; });
        if (ms.length !== 1 || other) continue;
        const m = ms[0], key = m.geometry.uuid + '|' + (Array.isArray(m.material) ? 'multi' : m.material.uuid);
        if (Array.isArray(m.material)) continue;
        if (!groups.has(key)) groups.set(key, { m, list: [] });
        groups.get(key).list.push({ g, m });
      }
      this.batches = [];
      for (const { m, list } of groups.values()) {
        if (list.length < 4) continue;
        const im = new THREE.InstancedMesh(m.geometry, m.material, list.length), col = new THREE.Color();
        list.forEach(({ g, m: mm }, i) => {
          im.setMatrixAt(i, mm.matrixWorld); g.visible = false;
          if (mm.isInstancedMesh && mm.instanceColor) mm.getColorAt(0, col); else col.set('#ffffff');
          im.setColorAt(i, col);
        });
        im.castShadow = m.castShadow; im.receiveShadow = true; im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true;
        this.group.add(im); this.batches.push({ im, list });
      }
    },
    unbatch() {
      for (const b of this.batches || []) { b.im.removeFromParent(); b.im.dispose(); for (const { g } of b.list) g.visible = true; }
      this.batches = [];
    },
    makeObject(game, o) {
      const holder = new THREE.Group();
      if (o.k.startsWith('asset:')) {
        const id = o.k.slice(6);
        this.loadModel(id).then((m) => { holder.add(m.clone()); }).catch((e) => console.warn('Model', id, e.message));
      } else if (o.k.startsWith('cap:')) {
        const c = game.env.captured && game.env.captured[o.k.slice(4)];
        if (c) holder.add(capMesh(c.geo, c.mat, o, c.cast));
      } else {
        // Each kind of object is built once per map and shared by all its copies.
        const key = o.k + (o.opts ? JSON.stringify(o.opts) : '');
        if (!this.protos || this.protoMap !== game.mapRoot) { this.protos = new Map(); this.protoMap = game.mapRoot; }
        let proto = this.protos.get(key);
        if (!proto) { const def = LIB.find((l) => l.k === o.k); if (def) { proto = def.build(game.env, o); this.protos.set(key, proto); } }
        if (proto) holder.add(proto.clone());
      }
      return holder;
    },
    // Pieces converted before v0.37 lost their colour and shape (which made rocks look dark). Give each
    // one the colour, stretch and blocking of an original piece of the same kind and a similar size.
    repairCaps(game, d) {
      const items = game.env.capturedItems || [];
      for (const o of d.objects) {
        if (!o.k.startsWith('cap:') || o.c) continue;
        const key = o.k.slice(4), size = o.s || 1;
        const near = items.filter((x) => x.key === key).sort((a, b) => Math.abs(a.s[1] - size) - Math.abs(b.s[1] - size)).slice(0, 5);
        const hash = [...String(o.u)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
        const it = near[hash % (near.length || 1)];
        const look = it ? capLook(it) : { c: '#ffffff', solid: o.solid != null ? o.solid : 0.4 };
        for (const k of ['c', 'st', 'tilt', 'solid', 'rect']) if (look[k] != null && o[k] == null) o[k] = look[k];
      }
    },
    spawnObject(game, o, block) {
      const g = this.makeObject(game, o);
      g.userData.obj = o;
      this.place(g, o);
      this.group.add(g);
      this.objects.push(g);
      const def = LIB.find((l) => l.k === o.k);
      const solid = o.solid != null ? o.solid : (def ? def.solid : (o.k.startsWith('cap:') ? 0.4 : 0));
      if (block && solid > 0) game.nav.blockCircle(o.x, o.z, solid * (o.s || 1));
      if (block && o.rect) game.nav.blockRect(o.x, o.z, o.rect[0] * (o.s || 1), o.rect[1] * (o.s || 1), o.ry || 0);
      if (block && def && def.rect) { const [hw, hd] = typeof def.rect === 'function' ? def.rect(o) : def.rect; game.nav.blockRect(o.x, o.z, hw * (o.s || 1), hd * (o.s || 1), o.ry || 0); }
      // Several solid spots (the gate's two towers, with the road open between them).
      if (block && def && def.blocks) for (const [dx, dz, r] of def.blocks) {
        const s = o.s || 1, c = Math.cos(o.ry || 0), sn = Math.sin(o.ry || 0);
        game.nav.blockCircle(o.x + (dx * c + dz * sn) * s, o.z + (-dx * sn + dz * c) * s, r * s);
      }
      if (block && def && def.deck && def.rails) {
        // Railings along both sides of a bridge.
        const sc = o.s || 1, hw = def.deck.hw * sc, hl = def.deck.hl * sc, c = Math.cos(o.ry || 0), sn = Math.sin(o.ry || 0);
        for (const sx of [-1, 1]) { const px = sx * hw * c, pz = -sx * hw * sn, ax = hl * sn, az = hl * c;
          game.nav.blockSegment(o.x + px - ax, o.z + pz - az, o.x + px + ax, o.z + pz + az, 0.25); }
      }
      if (def && def.light && (!def.lightIf || def.lightIf(o))) this.spawnLight(game, Object.assign({ x: o.x, z: o.z, y: (o.y || 0) + 1.9, u: o.u + '_l', fromObject: true }, def.light));
      return g;
    },
    place(g, o) {
      const def = LIB.find((l) => l.k === o.k);
      const y = def && def.deck
        ? G.Terrain.deckBase({ x: o.x, z: o.z, ry: o.ry || 0, hl: def.deck.hl * (o.s || 1), y: o.y || 0 })
        : (o.y || 0) + G.Terrain.height(o.x, o.z);
      g.position.set(o.x, y, o.z); g.rotation.set(0, o.ry || 0, 0); g.scale.setScalar(o.s || 1);
    },
    spawnLight(game, e) {
      const L = new THREE.PointLight(e.color || '#ffd9a0', +e.intensity || 1.2, +e.range || 12, 1.6);
      L.position.set(e.x, G.Terrain.height(e.x, e.z) + (+e.y || 2.5), e.z);
      L.userData.ent = e;
      this.group.add(L); this.lights.push(L);
      return L;
    },
    loadModel(id) {
      if (!this.modelCache.has(id)) this.modelCache.set(id, fetch(`/api/assets/${id}`).then((r) => { if (!r.ok) throw new Error('missing'); return r.arrayBuffer(); }).then(parseGLB));
      return this.modelCache.get(id);
    },
  };
  // Map rule: no teleporting (Fly Wings too). Attached once the inventory exists.
  CustomMaps.installRules = function () {
    if (this.rulesOn || !G.Inventory || !G.Inventory.prototype.use) return;
    this.rulesOn = true;
    const use = G.Inventory.prototype.use;
    G.Inventory.prototype.use = function (uid, ...a) {
      const e = this.find && this.find(uid);
      if (e && e.id === 'fly_wing' && CustomMaps.rule('noTeleport')) { if (CustomMaps.game) CustomMaps.game.log.add('You can’t teleport on this map.', 'warn'); return false; }
      return use.call(this, uid, ...a);
    };
  };
  G.CustomMaps = CustomMaps;
})(window.G = window.G || {});
