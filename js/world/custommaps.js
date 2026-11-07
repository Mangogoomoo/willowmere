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
  function fromEnv(env, draw) {
    const fake = Object.create(env); fake.nav = noop; fake.colliders = []; fake._lib = true;
    const parts = []; draw(fake, parts);
    const geo = U.mergeParts(parts); geo.computeBoundingBox();
    geo.translate(0, -geo.boundingBox.min.y, 0);
    const m = new THREE.Mesh(geo, env.propMat); m.castShadow = true; m.receiveShadow = true;
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
  ];
  /* Original props: recorded while a map is built, so they can be turned into
     editable objects; once a map's originals are "taken over", they're skipped
     here and come back as editor objects instead. */
  const REC = { house: 'house', fountain: 'fountain', stall: 'stall_blue', lamp: 'lamp', bench: 'bench', planter: 'planter', barrel: 'barrel', crate: 'crate', noticeBoard: 'board' };
  if (G.Environment) for (const fn of [...Object.keys(REC), 'treeAt']) {
    const orig = G.Environment.prototype[fn];
    if (!orig) continue;
    G.Environment.prototype[fn] = function (...a) {
      if (this._lib || this._inRec) return orig.apply(this, a);
      (this.recorded || (this.recorded = [])).push({ fn, a: fn === 'treeAt' ? a.slice(0, 4) : a.slice(1) });
      if (this.map && this.map.takeover) return fn === 'treeAt' ? true : undefined;
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
    // A map's own NPCs once its originals are editable (they keep their shops, quests and dialog).
    { type: 'npcref', name: 'NPC (original)', icon: '🧑', color: '#c6f5a8', hidden: true, defaults: {} },
  ];

  const CustomMaps = {
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
    async fetch() {
      try {
        const r = await fetch('/api/maps', { cache: 'no-store' });
        if (r.ok) { this.data = (await r.json()).maps || {}; this.register(); }
        const a = await fetch('/api/assets', { cache: 'no-store' });
        if (a.ok) this.assets = (await a.json()).assets || [];
      } catch (e) { /* offline: no edits */ }
    },
    // Everything a built-in map came with, as editor objects and entities.
    originals(game) {
      const base = G.Maps[game.mapId], out = { objects: [], entities: [] };
      const u = () => Math.random().toString(36).slice(2, 9), r2 = (v) => Math.round(v * 100) / 100;
      for (const r of game.env.recorded || []) {
        if (r.fn === 'treeAt') {
          const [kind, x, z, sc] = r.a;
          out.objects.push({ u: u(), k: { round: 'tree', pine: 'pine', blossom: 'blossom' }[kind] || 'tree', x: r2(x), z: r2(z), y: 0, ry: 0, s: r2(sc || 1) });
          continue;
        }
        const [x, z, rot, extra] = r.a;
        const o = { u: u(), k: REC[r.fn], x: r2(x), z: r2(z), y: 0, ry: typeof rot === 'number' ? r2(rot) : 0, s: 1 };
        if (r.fn === 'house' && extra) o.opts = { w: extra.w, d: extra.d, h: extra.h, wall: extra.wall, roof: extra.roof, trim: extra.trim };
        if (r.fn === 'stall' && Array.isArray(extra)) o.opts = extra.slice(0, 2);
        out.objects.push(o);
      }
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
      const base = G.Maps[id], d = this.data[id];
      C.WORLD_SIZE = C.WORLD_SIZE_DEFAULT;
      if (!d) return base;
      const map = Object.assign({}, base);
      if (d.bounds) { map.bounds = d.bounds; map.worldSize = this.worldSizeFor(d.bounds); C.WORLD_SIZE = map.worldSize; }
      if (d.ground) map.ground = d.ground;
      map.takeover = !!d.takeover;
      map.portals = (d.takeover ? [] : base.portals || []).concat(d.entities.filter((e) => e.type === 'warp' && G.Maps[e.to]).map((e) => ({ x: e.x, z: e.z, to: e.to, tx: +e.tx || 0, tz: +e.tz || 0, label: e.label || (G.Maps[e.to] || {}).name })));
      map.spawns = (d.takeover ? [] : base.spawns || []).concat(d.entities.filter((e) => e.type === 'spawn' && C.MONSTERS[e.monster]).map((e) => ({ type: e.monster, x: e.x, z: e.z, r: Math.max(1, +e.r || 5), count: Math.max(1, Math.min(50, +e.count || 1)) })));
      const npcs = d.entities.filter((e) => e.type === 'npc');
      for (const e of npcs) {
        const nid = 'custom_' + e.u;
        G.NPC_DEFS = G.NPC_DEFS.filter((x) => x.id !== nid);
        const lines = (e.lines || []).filter(Boolean);
        G.NPC_DEFS.push({ id: nid, name: e.name || 'Villager', title: e.title || '', costume: e.costume || 'novice', x: e.x, z: e.z, facing: e.ry || 0,
          appearance: { hair: e.hair || 'chestnut', eyes: 'amber', style: e.style || 'short' },
          script: async (dlg) => { for (const l of (lines.length ? lines : ['...'])) await dlg.say(l); } });
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
      const d = this.data[game.mapId];
      if (this.group) { this.group.removeFromParent(); this.group = null; }
      this.objects = []; this.lights = [];
      if (!d) return;
      this.group = new THREE.Group(); game.mapRoot.add(this.group);
      for (const o of d.objects) this.spawnObject(game, o, true);
      for (const e of d.entities) if (e.type === 'light') this.spawnLight(game, e);
      // Anything outside the map's bounds can't be walked on.
      if (d.bounds) {
        const b = d.bounds, h = game.nav.size / 2;
        for (let x = -h; x < h; x += 1) for (let z = -h; z < h; z += 1)
          if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) game.nav.blockCircle(x + 0.5, z + 0.5, 0.75);
      }
    },
    makeObject(game, o) {
      const holder = new THREE.Group();
      if (o.k.startsWith('asset:')) {
        const id = o.k.slice(6);
        this.loadModel(id).then((m) => { holder.add(m.clone()); }).catch((e) => console.warn('Model', id, e.message));
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
    spawnObject(game, o, block) {
      const g = this.makeObject(game, o);
      g.userData.obj = o;
      this.place(g, o);
      this.group.add(g);
      this.objects.push(g);
      const def = LIB.find((l) => l.k === o.k);
      const solid = o.solid != null ? o.solid : (def ? def.solid : 0);
      if (block && solid > 0) game.nav.blockCircle(o.x, o.z, solid * (o.s || 1));
      if (def && def.light) this.spawnLight(game, Object.assign({ x: o.x, z: o.z, y: (o.y || 0) + 1.9, u: o.u + '_l', fromObject: true }, def.light));
      return g;
    },
    place(g, o) {
      const y = (o.y || 0) + G.Terrain.height(o.x, o.z);
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
  G.CustomMaps = CustomMaps;
})(window.G = window.G || {});
