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
    const fake = Object.create(env); fake.nav = noop; fake.colliders = [];
    const parts = []; draw(fake, parts);
    const geo = U.mergeParts(parts); geo.computeBoundingBox();
    geo.translate(0, -geo.boundingBox.min.y, 0);
    const m = new THREE.Mesh(geo, env.propMat); m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  const prim = (parts, mat) => { const g = U.mergeParts(parts); const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; return m; };
  const LIB = [
    // Nature
    { k: 'tree', name: 'Tree', cat: 'Nature', icon: '🌳', solid: 0.45, build: (e) => new THREE.Mesh(e.treeGeometries().round, e.foliageMat) },
    { k: 'pine', name: 'Pine', cat: 'Nature', icon: '🌲', solid: 0.4, build: (e) => new THREE.Mesh(e.treeGeometries().pine, e.foliageMat) },
    { k: 'blossom', name: 'Blossom tree', cat: 'Nature', icon: '🌸', solid: 0.45, build: (e) => new THREE.Mesh(e.treeGeometries().blossom, e.foliageMat) },
    { k: 'bush', name: 'Bush', cat: 'Nature', icon: '🌿', solid: 0, build: (e) => prim([
      { geo: new THREE.IcosahedronGeometry(0.7, 0), color: '#4e9a44', pos: [0, 0.5, 0], jitter: 0.2 },
      { geo: new THREE.IcosahedronGeometry(0.55, 0), color: '#5aab4c', pos: [0.55, 0.4, 0.2], jitter: 0.2 },
      { geo: new THREE.IcosahedronGeometry(0.5, 0), color: '#468c3e', pos: [-0.5, 0.38, -0.15], jitter: 0.2 }], e.foliageMat) },
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
    { k: 'house', name: 'House (blue roof)', cat: 'Town', icon: '🏠', solid: 2.6, build: (e) => fromEnv(e, (f, p) => f.house(p, 0, 0, 0, { w: 6, d: 5, h: 3.3, wall: '#fdf3e1', roof: '#4b7bd1', trim: '#6b4428' })) },
    { k: 'house_red', name: 'House (red roof)', cat: 'Town', icon: '🏡', solid: 2.6, build: (e) => fromEnv(e, (f, p) => f.house(p, 0, 0, 0, { w: 6, d: 5, h: 3.3, wall: '#f6ead2', roof: '#d9534f', trim: '#7b4a2c' })) },
    { k: 'house_tall', name: 'Tall house', cat: 'Town', icon: '🏘️', solid: 3, build: (e) => fromEnv(e, (f, p) => f.house(p, 0, 0, 0, { w: 7, d: 5.5, h: 4.8, wall: '#efe0c4', roof: '#e8893a', trim: '#6e3f22' })) },
    { k: 'fountain', name: 'Fountain', cat: 'Town', icon: '⛲', solid: 2.2, build: (e) => fromEnv(e, (f, p) => f.fountain(p, 0, 0)) },
    { k: 'stall_blue', name: 'Market stall (blue)', cat: 'Town', icon: '🏪', solid: 1.2, build: (e) => fromEnv(e, (f, p) => f.stall(p, 0, 0, 0, ['#4f7fc8', '#f2efe6'])) },
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
    { k: 'tombstone', name: 'Gravestone', cat: 'Props', icon: '🪦', solid: 0.35, build: (e) => prim([{ geo: new THREE.BoxGeometry(0.7, 1, 0.22), color: '#8d8a84', pos: [0, 0.5, 0], jitter: 0.15 }], e.propMat) },
  ];
  // Entities: things that do something rather than just stand there.
  const ENTITIES = [
    { type: 'warp', name: 'Warp portal', icon: '🌀', color: '#7fd3ff', defaults: { to: 'meadow', tx: 0, tz: 0, label: '' } },
    { type: 'light', name: 'Light', icon: '💡', color: '#ffd27a', defaults: { color: '#ffd9a0', intensity: 1.4, range: 12, y: 2.5 } },
    { type: 'spawn', name: 'Monster spawn', icon: '👾', color: '#ff7a7a', defaults: { monster: 'poring', count: 5, r: 6 } },
    { type: 'npc', name: 'NPC', icon: '🧑', color: '#9cff8a', defaults: { name: 'Villager', title: '', costume: 'novice', hair: 'chestnut', style: 'short', lines: ['Hello there, traveller!'] } },
    { type: 'start', name: 'Player start', icon: '🚩', color: '#ffffff', defaults: {} },
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
      map.portals = (base.portals || []).concat(d.entities.filter((e) => e.type === 'warp' && G.Maps[e.to]).map((e) => ({ x: e.x, z: e.z, to: e.to, tx: +e.tx || 0, tz: +e.tz || 0, label: e.label || (G.Maps[e.to] || {}).name })));
      map.spawns = (base.spawns || []).concat(d.entities.filter((e) => e.type === 'spawn' && C.MONSTERS[e.monster]).map((e) => ({ type: e.monster, x: e.x, z: e.z, r: Math.max(1, +e.r || 5), count: Math.max(1, Math.min(50, +e.count || 1)) })));
      const npcs = d.entities.filter((e) => e.type === 'npc');
      for (const e of npcs) {
        const nid = 'custom_' + e.u;
        G.NPC_DEFS = G.NPC_DEFS.filter((x) => x.id !== nid);
        const lines = (e.lines || []).filter(Boolean);
        G.NPC_DEFS.push({ id: nid, name: e.name || 'Villager', title: e.title || '', costume: e.costume || 'novice', x: e.x, z: e.z, facing: e.ry || 0,
          appearance: { hair: e.hair || 'chestnut', eyes: 'amber', style: e.style || 'short' },
          script: async (dlg) => { for (const l of (lines.length ? lines : ['...'])) await dlg.say(l); } });
      }
      map.npcs = (base.npcs || []).concat(npcs.map((e) => 'custom_' + e.u));
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
        const def = LIB.find((l) => l.k === o.k);
        if (def) holder.add(def.build(game.env));
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
