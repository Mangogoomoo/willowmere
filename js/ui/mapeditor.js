/* Map editor (admins only). Toggle with F10 or the "Map editor" button.
   Place built-in objects or your own uploaded .glb models, and entities
   (warps, lights, monster spawns, NPCs, start points); change a map's size
   in any direction; create new maps. Saving updates the map live for every
   player on it.

   Controls: click an item in the panel, then click the ground to place it
   (Shift+click keeps placing). Click something to select it.
   Arrows nudge (Shift fine, Ctrl coarse) · Page Up/Down raise/lower ·
   Q/E rotate · +/- scale · G grab and move with the mouse · Delete remove ·
   Ctrl+D duplicate · Ctrl+Z undo · WASD move around · Esc cancel/deselect. */
(function (G) {
  'use strict';
  const h = G.h, CM = () => G.CustomMaps;
  const uid = () => Math.random().toString(36).slice(2, 9);
  const r2 = (v) => Math.round(v * 100) / 100;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();

  const Ed = {
    active: false, tab: 'place', sel: null, placing: null, grab: false, dirty: false, undoStack: [],
    brush: { tool: 'raise', size: 4, strength: 5, tex: 3 }, cursor: null, remembered: null,
    init(game) {
      if (this.game) return;
      this.game = game;
      this.win = game.windows.create('mapeditor', 'Map editor', { width: 340, pos: () => ({ x: 12, y: 60 }) });
      this.win.render = () => this.render();
      this.markers = new THREE.Group();
      window.addEventListener('keydown', (e) => this.onKey(e), true);
      const canvas = game.renderer.domElement;
      canvas.addEventListener('pointermove', (e) => this.onMove(e));
      canvas.addEventListener('pointerup', () => this.endStroke());
      window.addEventListener('pointerup', () => this.endStroke());
      // Buttons for admins: the editor, and teleporting to any map.
      this.btn = h('button.ed-toggle', { type: 'button', hidden: true, title: 'Map editor (F10)', onclick: () => this.toggle() }, '🛠 Map editor');
      this.tpBtn = h('button.ed-toggle.ed-tp', { type: 'button', hidden: true, title: 'Teleport to any map (admins)', onclick: () => this.openTeleport() }, '🗺 Teleport');
      // While editing: key hints and coordinates where the action bar normally is.
      this.keybar = h('div#ed-keys', { hidden: true, 'aria-live': 'off' });
      document.body.append(this.btn, this.tpBtn, this.keybar);
      this.tpWin = game.windows.create('teleport', 'Teleport to map', { width: 300, pos: () => ({ x: window.innerWidth / 2 - 150, y: 90 }) });
      setInterval(() => this.updateKeybar(), 250);
      this.refreshAdmin();
    },
    // The button shows for admins while the editor is closed (the panel has its own ✕).
    refreshAdmin() {
      const admin = !!(G.Online && G.Online.isAdmin);
      if (this.btn) this.btn.hidden = !admin || this.active;
      if (this.tpBtn) this.tpBtn.hidden = !admin || this.active;   // the editor's Map tab has its own
    },
    // Where to arrive on a map: its start point, else a known safe spot.
    arrival(id) {
      const d = CM().get(id), st = d && d.entities.find((e) => e.type === 'start');
      if (st) return [st.x, st.z];
      return ({ meadow: [0, -60], forest: [0, -90], dungeon: [0, -86], orc_dungeon: [0, -86], ember_ruins: [0, -86] })[id] || [0, 0];
    },
    openTeleport() {
      if (!(G.Online && G.Online.isAdmin)) return;
      const w = this.tpWin, b = w.body;
      b.textContent = '';
      const ids = Object.keys(G.Maps);
      const group = (title, list) => { if (!list.length) return; b.append(h('h4.tp-head', { text: title }), h('div.tp-list', null, ...list.map((id) => h('button.tp-item' + (id === this.game.mapId ? '.here' : ''), { type: 'button', onclick: () => {
        if (this.dirty && !confirm('Leave without saving your map changes?')) return;
        this.dirty = false; const [x, z] = this.arrival(id); this.game.windows.close('teleport'); this.game.travel(id, x, z);
      } }, h('b', { text: G.Maps[id].name || id }), h('small', { text: id === this.game.mapId ? 'you are here' : id }))))); };
      group('Maps', ids.filter((id) => !G.Maps[id].custom));
      group('Maps made in the editor', ids.filter((id) => G.Maps[id].custom));
      this.game.windows.open('teleport');
    },
    updateKeybar() {
      if (!this.active || !this.keybar) return;
      const p = this.game.player.position, c = this.cursor;
      const keys = this.tab === 'ground' ? 'Hold left mouse and drag to sculpt · [ ] brush size · Ctrl+Z undo · WASD move'
        : 'Click select · Arrows nudge (Shift fine, Ctrl big) · PgUp/PgDn height · Q/E rotate · +/- size · G grab · Del remove · Ctrl+D copy · Ctrl+Z undo · WASD move · Esc cancel';
      this.keybar.textContent = '';
      this.keybar.append(h('div.kb-keys', { text: keys }), h('div.kb-coords', null,
        h('span', { text: `Map: ${(G.Maps[this.game.mapId] || {}).name || this.game.mapId} (${this.game.mapId})` }),
        h('span', { text: `You: X ${p.x.toFixed(1)}  Z ${p.z.toFixed(1)}` }),
        h('span', { text: c ? `Cursor: X ${c.x.toFixed(1)}  Z ${c.z.toFixed(1)}  height ${G.Terrain.height(c.x, c.z).toFixed(2)}` : 'Cursor: –' })));
    },
    toggle() {
      if (!(G.Online && G.Online.isAdmin)) { this.game.log.add('The map editor is for admins only.', 'warn'); return; }
      this.active ? this.close() : this.open();
    },
    open() {
      this.active = true; this.game.editing = true;
      document.body.classList.add('editing'); this.keybar.hidden = false;
      this.ensureData();
      this.game.scene.add(this.markers); this.rebuildMarkers();
      this.game.windows.open('mapeditor'); this.render(); this.refreshAdmin();
      this.game.log.add('Map editor on. Changes are only saved when you press Save.', 'system');
    },
    close() {
      if (this.dirty && !confirm('You have unsaved map changes. Close the editor anyway? (They stay until you leave this map.)')) return;
      this.active = false; this.game.editing = false;
      document.body.classList.remove('editing'); this.keybar.hidden = true; this.brushRing && this.brushRing.removeFromParent();
      this.cancelPlacing(); this.select(null);
      this.markers.removeFromParent();
      this.game.windows.close('mapeditor'); this.refreshAdmin();
    },
    // The map data being edited (created on first edit of a map).
    ensureData() {
      const id = this.game.mapId;
      let d = CM().get(id);
      if (!d) {
        d = { id, name: (G.Maps[id] || {}).name || id, base: G.Maps[id] && G.Maps[id].custom ? 'blank' : 'builtin',
          bounds: Object.assign({}, CM().DEFAULT_BOUNDS), objects: [], entities: [] };
        CM().data[id] = d;
      }
      if (!CM().group) { CM().group = new THREE.Group(); this.game.mapRoot.add(CM().group); CM().objects = CM().objects || []; CM().lights = CM().lights || []; }
      this.data = d;
      return d;
    },
    onMapLoaded() {
      if (!this.active) return;
      this.dirty = false; this.undoStack = []; this.cancelPlacing(); this.select(null);
      this.ensureData();
      this.game.scene.add(this.markers); this.rebuildMarkers(); this.render();
    },
    changed() { this.dirty = true; this.render(); },
    snapshot() { this.undoStack.push(JSON.stringify(this.data)); if (this.undoStack.length > 60) this.undoStack.shift(); },
    undo() {
      const s = this.undoStack.pop(); if (!s) return;
      const d = JSON.parse(s); Object.assign(this.data, d);
      CM().data[this.game.mapId] = this.data;
      this.sel = null; G.Terrain.refreshGround(0, 0, G.Terrain.HALF + 2);
      CM().build(this.game); this.ensureData(); this.rebuildMarkers(); this.changed();
    },

    /* ---------- picking ---------- */
    rayFrom(e) {
      const rect = this.game.renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, this.game.camera3);
      return ray;
    },
    groundAt(e) {
      const r = this.rayFrom(e).ray; let y = 0, p = null;
      for (let i = 0; i < 5; i++) {
        if (Math.abs(r.direction.y) < 1e-4) return null;
        const t = (y - r.origin.y) / r.direction.y; if (t < 0) return null;
        p = r.origin.clone().addScaledVector(r.direction, t);
        y = G.Terrain.height(p.x, p.z);
      }
      return p;
    },
    pickThing(e) {
      const r = this.rayFrom(e);
      const targets = [...(CM().objects || []), ...this.markers.children];
      const hit = r.intersectObjects(targets, true)[0];
      if (!hit) return null;
      let o = hit.object;
      while (o && !o.userData.obj && !o.userData.ent) o = o.parent;
      if (!o) return null;
      return o.userData.obj ? { kind: 'object', item: o.userData.obj } : { kind: 'entity', item: o.userData.ent };
    },
    // Called by the game's input before it handles a click.
    pointer(e) {
      if (!this.active || e.button !== 0) return false;
      if (this.tab === 'ground') {
        const p = this.groundAt(e); if (!p) return true;
        this.snapshot(); this.sculpting = true; this.flatY = null; this.sculptAt(p); this.lastSculpt = Date.now();
        return true;
      }
      if (this.grab) { this.grab = false; this.render(); return true; }
      if (this.placing) {
        const p = this.groundAt(e); if (!p) return true;
        this.placeAt(p.x, p.z);
        if (!e.shiftKey) this.cancelPlacing();
        return true;
      }
      this.select(this.pickThing(e));
      return true;
    },
    onMove(e) {
      if (!this.active) return;
      const p = this.groundAt(e); if (!p) return;
      this.cursor = p;
      if (this.tab === 'ground') {
        this.showBrush(p);
        if (this.sculpting && Date.now() - this.lastSculpt > 35) { this.lastSculpt = Date.now(); this.sculptAt(p); }
        return;
      }
      if (!(this.placing || this.grab)) return;
      if (this.placing && this.ghost) { this.ghost.position.set(p.x, G.Terrain.height(p.x, p.z), p.z); }
      if (this.grab && this.sel) { this.sel.item.x = r2(p.x); this.sel.item.z = r2(p.z); this.applySel(); }
    },

    /* ---------- ground ---------- */
    showBrush(p) {
      if (!this.brushRing) {
        this.brushRing = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false }));
        this.brushRing.rotation.x = -Math.PI / 2; this.brushRing.renderOrder = 20;
      }
      if (!this.brushRing.parent) this.game.scene.add(this.brushRing);
      this.brushRing.scale.setScalar(this.brush.size);
      this.brushRing.position.set(p.x, G.Terrain.height(p.x, p.z) + 0.15, p.z);
    },
    paintAt(p) {
      const d = this.data, TR = G.Terrain;
      d.paint = d.paint || { d: {} };
      if (TR.map) TR.map.paint = d.paint;
      const g = d.paint.d, R = this.brush.size, st = this.brush.strength / 5, erase = this.brush.tool === 'erase', want = this.brush.tex;
      let last = null;
      for (let x = Math.floor(p.x - R); x <= Math.ceil(p.x + R); x++) for (let z = Math.floor(p.z - R); z <= Math.ceil(p.z + R); z++) {
        const dist = Math.hypot(x + 0.5 - p.x, z + 0.5 - p.z); if (dist > R) continue;
        let f = 1 - dist / R; f = f * f * (3 - 2 * f);
        const key = x + ',' + z, add = 90 * st * f;
        let [i, c] = g[key] || [0, 0];
        if (erase) c -= add;
        else if (i === want) c = Math.min(255, c + add);
        else { c -= add; if (c <= 0) { i = want; c = Math.min(255, -c + add * 0.5); } }
        c = Math.round(c);
        if (c <= 0) { delete g[key]; i = 0; c = 0; } else g[key] = [i, c];
        TR.writePaint(x, z, i, c, true); last = [x, z, i, c];
      }
      if (last) TR.writePaint(last[0], last[1], last[2], last[3], false);
      this.dirty = true;
    },
    sculptAt(p) {
      if (this.brush.tool === 'paint' || this.brush.tool === 'erase') return this.paintAt(p);
      const d = this.data, TR = G.Terrain;
      d.ground = d.ground || { d: {} };
      if (TR.map) TR.map.ground = d.ground;   // the terrain reads the same edits live
      const g = d.ground.d, R = this.brush.size, st = this.brush.strength / 5, tool = this.brush.tool;
      if (tool === 'flatten' && this.flatY == null) this.flatY = TR.height(p.x, p.z);
      const upd = {};
      for (let x = Math.floor(p.x - R); x <= Math.ceil(p.x + R); x++) for (let z = Math.floor(p.z - R); z <= Math.ceil(p.z + R); z++) {
        const dist = Math.hypot(x - p.x, z - p.z); if (dist > R) continue;
        let f = 1 - dist / R; f = f * f * (3 - 2 * f);
        const key = x + ',' + z, cur = g[key] || 0, hh = TR.height(x, z);
        let nd = cur;
        if (tool === 'raise') nd += 0.12 * st * f;
        else if (tool === 'lower') nd -= 0.12 * st * f;
        else if (tool === 'flatten') nd += (this.flatY - hh) * 0.3 * Math.min(1, st) * f;
        else { const avg = (TR.height(x + 1, z) + TR.height(x - 1, z) + TR.height(x, z + 1) + TR.height(x, z - 1)) / 4; nd += (avg - hh) * 0.45 * Math.min(1, st) * f; }
        upd[key] = Math.max(-30, Math.min(30, Math.round(nd * 1000) / 1000));
      }
      for (const [k, v] of Object.entries(upd)) { if (Math.abs(v) < 0.004) delete g[k]; else g[k] = v; }
      TR.refreshGround(p.x, p.z, R + 1.5);
      this.dirty = true;
    },
    endStroke() {
      if (!this.sculpting) return;
      this.sculpting = false;
      // Objects and markers settle onto the new ground.
      for (const gObj of CM().objects || []) CM().place(gObj, gObj.userData.obj);
      for (const L of CM().lights || []) { const e = L.userData.ent; L.position.y = G.Terrain.height(e.x, e.z) + (+e.y || 2.5); }
      this.rebuildMarkers(); this.render();
    },
    renderGround(body) {
      const tools = [['raise', '⬆️', 'Raise'], ['lower', '⬇️', 'Lower'], ['smooth', '〰️', 'Smooth'], ['flatten', '▭', 'Flatten'], ['paint', '🖌️', 'Paint'], ['erase', '🧽', 'Erase paint']];
      body.append(h('h4', { text: 'Shape and paint' }), h('div.ed-grid', null, ...tools.map(([id, ic, name]) => this.paletteBtn(name, ic, this.brush.tool === id, () => { this.brush.tool = id; this.render(); }))));
      if (this.brush.tool === 'paint') {
        const atlas = G.Terrain.buildPaintAtlas();
        if (!this.swatches) this.swatches = G.Terrain.PAINT.map((t) => { const c = document.createElement('canvas'); c.width = c.height = 64; c.getContext('2d').drawImage(atlas, ((t.id - 1) % 4) * 256, Math.floor((t.id - 1) / 4) * 256, 256, 256, 0, 0, 64, 64); return c.toDataURL(); });
        body.append(h('h4', { text: 'Texture' }), h('div.ed-swatches', null, ...G.Terrain.PAINT.map((t, i) => h('button.ed-swatch' + (this.brush.tex === t.id ? '.on' : ''), { type: 'button', title: t.name, onclick: () => { this.brush.tex = t.id; this.render(); } },
          h('img', { src: this.swatches[i], alt: '' }), h('span', { text: t.name })))));
      }
      const slider = (label, key, min, max) => {
        const out = h('b', { text: String(this.brush[key]) });
        const inp = h('input', { type: 'range', min: String(min), max: String(max), value: String(this.brush[key]), 'aria-label': label, oninput: (e) => { this.brush[key] = Number(e.target.value); out.textContent = e.target.value; } });
        return h('label.ed-slider', null, h('span', { text: label }), inp, out);
      };
      body.append(slider('Brush size', 'size', 1, 20), slider('Strength', 'strength', 1, 10),
        h('p.hint', { text: 'Hold the left mouse button and drag over the ground. Flatten levels everything to the height where you start; Paint layers a texture (paint again to make it stronger), Erase paint brings the original ground back. Walking follows a new shape after saving.' }));
    },

    /* ---------- placing ---------- */
    startPlacing(spec) {
      this.cancelPlacing(); this.select(null);
      this.placing = spec;
      if (spec.kind === 'object') { this.ghost = CM().makeObject(this.game, { k: spec.k }); this.game.scene.add(this.ghost); }
      this.render();
    },
    cancelPlacing() { if (this.ghost) { this.ghost.removeFromParent(); this.ghost = null; } this.placing = null; },
    placeAt(x, z) {
      this.snapshot();
      const sp = this.placing, base = { u: uid(), x: r2(x), z: r2(z), y: 0, ry: this.ghost ? r2(this.ghost.rotation.y) : 0 };
      if (sp.kind === 'object') {
        const o = Object.assign(base, { k: sp.k, s: 1 });
        this.data.objects.push(o); CM().spawnObject(this.game, o, false);
        this.select({ kind: 'object', item: o }, true);
      } else {
        const def = CM().ENTITIES.find((d) => d.type === sp.type);
        const e = Object.assign(base, { type: sp.type }, JSON.parse(JSON.stringify(def.defaults)));
        if (sp.type === 'start') this.data.entities = this.data.entities.filter((x) => x.type !== 'start');
        this.data.entities.push(e);
        if (e.type === 'light') CM().spawnLight(this.game, e);
        this.rebuildMarkers(); this.select({ kind: 'entity', item: e }, true);
      }
      this.changed();
    },

    /* ---------- selection ---------- */
    select(s, keepTab) {
      this.sel = s;
      if (this.box) { this.box.removeFromParent(); this.box = null; }
      if (s) {
        const obj = this.objFor(s);
        if (obj) { this.box = new THREE.BoxHelper(obj, 0xffd84a); this.game.scene.add(this.box); }
        this.tab = 'selected';
      }
      this.render();
    },
    objFor(s) {
      if (!s) return null;
      if (s.kind === 'object') return (CM().objects || []).find((g) => g.userData.obj === s.item);
      return this.markers.children.find((m) => m.userData.ent === s.item);
    },
    // Move the selected thing's visuals to match its data.
    applySel() {
      const s = this.sel; if (!s) return;
      if (s.kind === 'object') { const g = this.objFor(s); if (g) CM().place(g, s.item); }
      else {
        if (s.item.type === 'npcref' || s.item.type === 'npc') {
          const id = s.item.type === 'npcref' ? s.item.ref : 'custom_' + s.item.u;
          const n = (this.game.npcs.list || []).find((x) => x.id === id || (x.def && x.def.id === id));
          if (n) { n.setPosition(s.item.x, s.item.z); n.facing = s.item.ry || 0; if (n.def) { n.def.x = s.item.x; n.def.z = s.item.z; n.def.facing = s.item.ry || 0; } }
        }
        const L = (CM().lights || []).find((l) => l.userData.ent === s.item);
        if (L) { L.position.set(s.item.x, G.Terrain.height(s.item.x, s.item.z) + (+s.item.y || 2.5), s.item.z); L.color.set(s.item.color || '#ffffff'); L.intensity = +s.item.intensity || 1; L.distance = +s.item.range || 10; }
        this.rebuildMarkers();
      }
      if (this.box) { const obj = this.objFor(s); if (obj) { this.box.setFromObject(obj); } }
      this.dirty = true;
      this.updateFields();
    },
    removeSel() {
      const s = this.sel; if (!s) return;
      this.snapshot();
      if (s.kind === 'object') {
        const g = this.objFor(s); if (g) { g.removeFromParent(); CM().objects.splice(CM().objects.indexOf(g), 1); }
        this.data.objects.splice(this.data.objects.indexOf(s.item), 1);
      } else {
        const L = (CM().lights || []).find((l) => l.userData.ent === s.item); if (L) L.removeFromParent();
        this.data.entities.splice(this.data.entities.indexOf(s.item), 1);
        this.rebuildMarkers();
      }
      this.select(null); this.changed();
    },
    duplicateSel() {
      const s = this.sel; if (!s) return;
      this.snapshot();
      const c = Object.assign(JSON.parse(JSON.stringify(s.item)), { u: uid(), x: r2(s.item.x + 1.5), z: r2(s.item.z + 1.5) });
      if (s.kind === 'object') { this.data.objects.push(c); CM().spawnObject(this.game, c, false); }
      else { if (c.type === 'start') return; this.data.entities.push(c); if (c.type === 'light') CM().spawnLight(this.game, c); this.rebuildMarkers(); }
      this.select({ kind: s.kind, item: c }); this.changed();
    },

    /* ---------- keys ---------- */
    onKey(e) {
      if (e.key === 'F10') { e.preventDefault(); this.toggle(); return; }
      if (!this.active) return;
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      const k = e.key, s = this.sel, cam = this.game.camera;
      const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };
      // Camera-relative directions: "up" pushes away from the camera.
      const yaw = cam.yaw || 0, fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
      const step = e.shiftKey ? 0.1 : e.ctrlKey ? 2 : 0.5;
      if (k === 'Escape') { stop(); if (this.placing) this.cancelPlacing(); else if (this.grab) this.grab = false; else this.select(null); this.render(); return; }
      if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z') { stop(); this.undo(); return; }
      if (this.tab === 'ground' && (k === '[' || k === ']')) { stop(); this.brush.size = Math.max(1, Math.min(20, this.brush.size + (k === ']' ? 1 : -1))); this.render(); if (this.cursor) this.showBrush(this.cursor); return; }
      if (/^[wasd]$/i.test(k) && !e.ctrlKey) {
        stop();
        const p = this.game.player, d = e.shiftKey ? 4 : 1.5, dir = k.toLowerCase();
        const mx = dir === 'w' ? fx : dir === 's' ? -fx : dir === 'd' ? rx : -rx, mz = dir === 'w' ? fz : dir === 's' ? -fz : dir === 'd' ? rz : -rz;
        p.teleport(p.position.x + mx * d, p.position.z + mz * d); return;
      }
      if (!s) { if (this.placing && this.ghost && /^[qe]$/i.test(k)) { stop(); this.ghost.rotation.y += (k.toLowerCase() === 'q' ? 1 : -1) * Math.PI / 12; } return; }
      const it = s.item;
      const nudge = (dx, dz) => { this.snapOnce(); it.x = r2(it.x + dx * step); it.z = r2(it.z + dz * step); this.applySel(); };
      if (k === 'ArrowUp') { stop(); nudge(fx, fz); }
      else if (k === 'ArrowDown') { stop(); nudge(-fx, -fz); }
      else if (k === 'ArrowLeft') { stop(); nudge(-rx, -rz); }
      else if (k === 'ArrowRight') { stop(); nudge(rx, rz); }
      else if (k === 'PageUp' || k === 'PageDown') { stop(); this.snapOnce(); it.y = r2((+it.y || 0) + (k === 'PageUp' ? 1 : -1) * (e.shiftKey ? 0.05 : 0.25)); this.applySel(); }
      else if (/^[qe]$/i.test(k)) { stop(); this.snapOnce(); it.ry = r2((it.ry || 0) + (k.toLowerCase() === 'q' ? 1 : -1) * (e.shiftKey ? Math.PI / 36 : Math.PI / 12)); this.applySel(); }
      else if (k === '+' || k === '=' || k === '-' || k === '_') { stop(); if (s.kind !== 'object') return; this.snapOnce(); it.s = r2(Math.max(0.1, Math.min(20, (it.s || 1) * (k === '-' || k === '_' ? 1 / 1.1 : 1.1)))); this.applySel(); }
      else if (k === 'Delete' || k === 'Backspace') { stop(); this.removeSel(); }
      else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'd') { stop(); this.duplicateSel(); }
      else if (k.toLowerCase() === 'g') { stop(); this.snapOnce(); this.grab = !this.grab; this.render(); }
    },
    // One undo step per burst of key presses.
    snapOnce() { const now = Date.now(); if (!this.lastSnap || now - this.lastSnap > 700) this.snapshot(); this.lastSnap = now; },

    /* ---------- markers for entities ---------- */
    label(text, color) {
      const c = document.createElement('canvas'), x = c.getContext('2d'); c.width = 256; c.height = 48;
      x.font = 'bold 22px sans-serif'; x.textAlign = 'center'; x.lineWidth = 5; x.strokeStyle = 'rgba(20,20,30,0.9)'; x.strokeText(text, 128, 32); x.fillStyle = color; x.fillText(text, 128, 32);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
      sp.scale.set(4, 0.75, 1); sp.renderOrder = 10; return sp;
    },
    rebuildMarkers() {
      for (const m of [...this.markers.children]) { m.removeFromParent(); m.traverse((o) => { if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } }); }
      if (!this.data) return;
      for (const e of this.data.entities) {
        const def = CM().ENTITIES.find((d) => d.type === e.type) || { color: '#fff', name: e.type };
        const g = new THREE.Group(); g.userData.ent = e;
        const y = G.Terrain.height(e.x, e.z);
        const ring = new THREE.Mesh(new THREE.RingGeometry(e.type === 'spawn' ? Math.max(0.5, +e.r || 5) - 0.12 : 0.55, e.type === 'spawn' ? Math.max(0.5, +e.r || 5) : 0.8, 40),
          new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; g.add(ring);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.2, 6), new THREE.MeshBasicMaterial({ color: def.color }));
        pole.position.y = 1.1; g.add(pole);
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), new THREE.MeshBasicMaterial({ color: e.type === 'light' ? (e.color || def.color) : def.color }));
        bulb.position.y = e.type === 'light' ? (+e.y || 2.5) : 2.3; g.add(bulb);
        const text = e.type === 'warp' ? `Warp → ${(G.Maps[e.to] || {}).name || e.to}` : e.type === 'spawn' ? `${(G.Config.MONSTERS[e.monster] || {}).name || e.monster} ×${e.count}` : (e.type === 'npc' || e.type === 'npcref') ? e.name : def.name;
        const lab = this.label(text, def.color); lab.position.y = 3.1; g.add(lab);
        if (e.type === 'npc' || e.type === 'npcref') {
          // An arrow on the ground pointing where the NPC looks.
          const shape = new THREE.Shape(); shape.moveTo(0, 2.2); shape.lineTo(0.55, 1.1); shape.lineTo(0.18, 1.1); shape.lineTo(0.18, 0.4); shape.lineTo(-0.18, 0.4); shape.lineTo(-0.18, 1.1); shape.lineTo(-0.55, 1.1); shape.closePath();
          const arrow = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: '#ffd84a', side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.95 }));
          arrow.rotation.x = -Math.PI / 2; arrow.renderOrder = 12;
          const turn = new THREE.Group(); turn.rotation.y = e.ry || 0; turn.position.y = 0.12; turn.add(arrow); arrow.rotation.z = Math.PI; arrow.rotation.x = Math.PI / 2;
          g.add(turn);
        }
        g.position.set(e.x, y, e.z);
        this.markers.add(g);
      }
      // The map's edges.
      const b = this.data.bounds;
      if (b) {
        const pts = [];
        const edge = (x0, z0, x1, z1) => { const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 4)); for (let i = 0; i < n; i++) { const t = i / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t; pts.push(new THREE.Vector3(x, G.Terrain.height(x, z) + 0.3, z)); } };
        edge(b.minX, b.minZ, b.maxX, b.minZ); edge(b.maxX, b.minZ, b.maxX, b.maxZ); edge(b.maxX, b.maxZ, b.minX, b.maxZ); edge(b.minX, b.maxZ, b.minX, b.minZ);
        pts.push(pts[0].clone());
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xff5a5a }));
        this.markers.add(line);
      }
    },

    /* ---------- saving ---------- */
    async save() {
      try {
        this.saving = true;
        await G.Online.api(`/api/maps/${this.game.mapId}`, 'PUT', { data: this.data });
        this.dirty = false; this.render();
        this.game.log.add('Map saved. Everyone on this map gets the update now.', 'level');
      } catch (e) { this.game.log.add('Saving failed: ' + e.message, 'warn'); }
      this.saving = false;
    },
    revert() {
      if (this.dirty && !confirm('Throw away your unsaved changes on this map?')) return;
      this.dirty = false;
      CM().fetch().then(() => { const p = this.game.player.position; this.game.travel(this.game.mapId, p.x, p.z, true); });
    },
    async upload(file) {
      if (!/\.glb$/i.test(file.name)) { this.game.log.add('Upload a .glb file (binary glTF).', 'warn'); return; }
      if (file.size > 15e6) { this.game.log.add('That model is over 15 MB.', 'warn'); return; }
      this.game.log.add(`Uploading ${file.name}…`, 'system');
      const data = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(file); });
      try {
        await CM().parseGLB(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)).buffer);   // check it opens before uploading
        const r = await G.Online.api('/api/assets', 'POST', { name: file.name, data });
        CM().assets.push(r); this.render();
        this.game.log.add(`Model “${r.name}” added to your library.`, 'level');
      } catch (e) { this.game.log.add('Upload failed: ' + e.message, 'warn'); }
    },
    async takeOver(onlyNew) {
      if (!confirm(onlyNew ? 'Make the gate, spike wall, bridge, rocks and bushes editable? The map will be saved and reloaded.' : 'Make all of this map’s original objects, spawns, warps and NPCs editable? The map will be saved and reloaded.')) return;
      const o = CM().originals(this.game, onlyNew), d = this.data;
      d.objects = o.objects.concat(d.objects);
      if (onlyNew) { d.takeover = 2; this.game.log.add(`Converted ${o.objects.length} more objects. Saving…`, 'system'); await this.save(); return; }
      d.entities = o.entities.concat(d.entities.filter((e) => !(e.type === 'warp' && o.entities.some((x) => x.type === 'warp' && x.x === e.x && x.z === e.z))));
      d.takeover = 2;
      this.game.log.add(`Converted ${o.objects.length} objects and ${o.entities.length} entities. Saving…`, 'system');
      await this.save();
    },
    async newMap(id, name) {
      id = String(id || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 40);
      if (!id || G.Maps[id]) { this.game.log.add('Pick a new, unused map id (letters, numbers, _).', 'warn'); return; }
      const d = { id, name: name || id, base: 'blank', bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 }, objects: [], entities: [{ u: uid(), type: 'start', x: 0, z: 0, y: 0 }] };
      try {
        await G.Online.api(`/api/maps/${id}`, 'PUT', { data: d });
        CM().set(id, d);
        this.game.travel(id, 0, 0);
      } catch (e) { this.game.log.add('Could not create the map: ' + e.message, 'warn'); }
    },

    /* ---------- panel ---------- */
    render() {
      const b = this.win && this.win.body; if (!b || !this.active) return;
      b.textContent = '';
      const d = this.data, mapName = (G.Maps[this.game.mapId] || {}).name || this.game.mapId;
      b.append(h('div.ed-status', null, h('b', { text: mapName }), h('span', { text: `${d.objects.length} objects · ${d.entities.length} entities` }),
        h('span.ed-dirty' + (this.dirty ? '.on' : ''), { text: this.dirty ? '● Unsaved' : 'Saved' })));
      const tabs = [['place', 'Objects'], ['entities', 'Entities'], ['ground', 'Ground'], ['selected', 'Selected'], ['map', 'Map']];
      if (this.tab !== 'ground' && this.brushRing) this.brushRing.removeFromParent();
      b.append(h('div.ed-tabs', { role: 'tablist' }, ...tabs.map(([id, t]) => h('button.ed-tab' + (this.tab === id ? '.on' : ''), { type: 'button', role: 'tab', 'aria-selected': String(this.tab === id), onclick: () => { this.tab = id; this.render(); } }, t))));
      const body = h('div.ed-body'); b.append(body);
      if (this.tab === 'place') this.renderPlace(body);
      else if (this.tab === 'entities') this.renderEntities(body);
      else if (this.tab === 'selected') this.renderSelected(body);
      else if (this.tab === 'ground') this.renderGround(body);
      else this.renderMap(body);
      b.append(h('div.ed-foot', null,
        h('button.btn.small', { type: 'button', disabled: !this.dirty, onclick: () => this.save() }, 'Save map'),
        h('button.btn.small.ghost', { type: 'button', onclick: () => this.undo(), disabled: !this.undoStack.length }, 'Undo'),
        h('button.btn.small.ghost', { type: 'button', onclick: () => this.revert() }, 'Revert')),
        h('div.opt-btns', null, h('button.btn.small.ghost', { type: 'button', title: 'Remember where you stand, to use as a warp destination', onclick: () => {
          const p = this.game.player.position; this.remembered = { map: this.game.mapId, x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10 };
          this.game.log.add(`Remembered: ${(G.Maps[this.remembered.map] || {}).name} at X ${this.remembered.x}, Z ${this.remembered.z}.`, 'system'); this.render();
        } }, '📍 Remember this spot'), this.remembered ? h('small.ed-mem', { text: `${(G.Maps[this.remembered.map] || {}).name} ${this.remembered.x}, ${this.remembered.z}` }) : null),
        h('p.ed-help', { text: this.grab ? 'Moving with the mouse: click to drop it.' : this.placing ? 'Click the ground to place (Shift+click to keep placing, Q/E rotate, Esc stops).' : 'Click to select · arrows nudge · PgUp/PgDn height · Q/E rotate · +/- size · G grab · Del remove · Ctrl+D copy · Ctrl+Z undo · WASD move' }));
    },
    paletteBtn(label, icon, on, onclick, title) {
      return h('button.ed-item' + (on ? '.on' : ''), { type: 'button', title: title || label, onclick }, h('span.ed-ico', { text: icon }), h('span', { text: label }));
    },
    capName(k) {
      const c = this.game.env.captured && this.game.env.captured[k.slice(4)];
      const kind = !c ? 'Decoration' : c.mat === this.game.env.foliageMat ? 'Plant' : 'Rock / prop';
      const n = Object.keys(this.game.env.captured || {}).indexOf(k.slice(4)) + 1;
      return `${kind} (from this map, #${n})`;
    },
    renderPlace(body) {
      const cats = [...new Set(CM().LIB.map((l) => l.cat))];
      for (const c of cats) {
        body.append(h('h4', { text: c }), h('div.ed-grid', null, ...CM().LIB.filter((l) => l.cat === c).map((l) =>
          this.paletteBtn(l.name, l.icon, this.placing && this.placing.k === l.k, () => this.startPlacing({ kind: 'object', k: l.k })))));
      }
      const caps = Object.keys(this.game.env.captured || {});
      if (caps.length) body.append(h('h4', { text: 'From this map' }), h('div.ed-grid', null, ...caps.map((key) => {
        const k = 'cap:' + key, c = this.game.env.captured[key];
        return this.paletteBtn(this.capName(k).replace(' (from this map', ' (').replace('#', ''), c.mat === this.game.env.foliageMat ? '🌿' : '🪨', this.placing && this.placing.k === k, () => this.startPlacing({ kind: 'object', k }));
      })));
      const file = h('input', { type: 'file', accept: '.glb', hidden: true });
      file.addEventListener('change', () => { if (file.files[0]) this.upload(file.files[0]); file.value = ''; });
      body.append(h('h4', { text: 'My models' }), h('div.ed-grid', null, ...CM().assets.map((a) =>
        this.paletteBtn(a.name, '📦', this.placing && this.placing.k === 'asset:' + a.id, () => this.startPlacing({ kind: 'object', k: 'asset:' + a.id }), `${a.name} (${Math.round(a.size / 1024)} KB)`))),
      file, h('button.btn.small', { type: 'button', onclick: () => file.click() }, 'Upload .glb model…'),
      h('p.hint', { text: 'Binary glTF (.glb), up to 15 MB. 1 unit ≈ 1 metre; a character is about 1.8 units tall.' }));
    },
    renderEntities(body) {
      body.append(h('div.ed-grid', null, ...CM().ENTITIES.filter((d) => !d.hidden).map((d) => this.paletteBtn(d.name, d.icon, this.placing && this.placing.type === d.type, () => this.startPlacing({ kind: 'entity', type: d.type })))),
        h('p.hint', { text: 'Warps, spawns and NPCs take effect when you save (the map reloads for everyone). Lights and objects show right away.' }));
    },
    field(label, value, onchange, opts) {
      opts = opts || {};
      let inp;
      if (opts.options) inp = h('select', { onchange: (e) => onchange(e.target.value) }, ...opts.options.map(([v, t]) => h('option', { value: v, text: t, selected: String(v) === String(value) })));
      else if (opts.area) inp = h('textarea', { rows: '3', onchange: (e) => onchange(e.target.value) }, String(value || ''));
      else inp = h('input', { type: opts.type || 'text', value: value == null ? '' : String(value), step: opts.step || 'any', onchange: (e) => onchange(opts.type === 'number' ? Number(e.target.value) : e.target.value) });
      inp.addEventListener('keydown', (e) => e.stopPropagation());
      if (opts.key) inp.dataset.key = opts.key;
      return h('label.ed-field', null, h('span', { text: label }), inp);
    },
    updateFields() {
      // Keep the number boxes in step with keyboard nudges.
      if (!this.sel || this.tab !== 'selected' || !this.win.body) return;
      for (const inp of this.win.body.querySelectorAll('[data-key]')) {
        const k = inp.dataset.key, v = k === 'ry' ? Math.round((this.sel.item.ry || 0) * 180 / Math.PI) : this.sel.item[k];
        if (document.activeElement !== inp) inp.value = v == null ? '' : String(v);
      }
    },
    renderSelected(body) {
      const s = this.sel;
      if (!s) { body.append(h('p.hint', { text: 'Click an object or entity in the world to select it.' })); return; }
      const it = s.item, set = (k, num) => (v) => { this.snapshot(); it[k] = num ? Number(v) : v; this.applySel(); this.render(); };
      const name = s.kind === 'object' && it.k.startsWith('cap:') ? this.capName(it.k) : s.kind === 'object' ? (it.k.startsWith('asset:') ? ((CM().assets.find((a) => 'asset:' + a.id === it.k) || {}).name || 'Model') : (CM().LIB.find((l) => l.k === it.k) || {}).name) : (CM().ENTITIES.find((d) => d.type === it.type) || {}).name;
      body.append(h('h4', { text: name || 'Selected' }),
        h('div.ed-xyz', null, this.field('X', it.x, set('x', 1), { type: 'number', key: 'x' }), this.field('Z', it.z, set('z', 1), { type: 'number', key: 'z' }), this.field('Height', it.y || 0, set('y', 1), { type: 'number', key: 'y' })),
        h('div.ed-xyz', null, this.field('Rotation °', Math.round((it.ry || 0) * 180 / Math.PI), (v) => { this.snapshot(); it.ry = r2(Number(v) * Math.PI / 180); this.applySel(); }, { type: 'number', key: 'ry' }),
          s.kind === 'object' ? this.field('Scale', it.s || 1, set('s', 1), { type: 'number', key: 's', step: '0.1' }) : h('span')));
      if (s.kind === 'object') {
        const def = CM().LIB.find((l) => l.k === it.k);
        body.append(this.field('Blocks walking (radius)', it.solid != null ? it.solid : (def ? def.solid : 0), set('solid', 1), { type: 'number', step: '0.1' }));
      } else if (it.type === 'warp') {
        const maps = Object.keys(G.Maps).map((id) => [id, G.Maps[id].name || id]);
        const mem = this.remembered;
        if (mem) body.append(h('button.btn.small', { type: 'button', onclick: () => { this.snapshot(); it.to = mem.map; it.tx = mem.x; it.tz = mem.z; this.applySel(); this.render(); } },
          `Use remembered spot: ${(G.Maps[mem.map] || {}).name} (${mem.x}, ${mem.z})`));
        body.append(this.field('Goes to map', it.to, set('to'), { options: maps }), h('div.ed-xyz', null, this.field('Arrive at X', it.tx, set('tx', 1), { type: 'number' }), this.field('Arrive at Z', it.tz, set('tz', 1), { type: 'number' })),
          this.field('Label', it.label, set('label')));
      } else if (it.type === 'light') {
        body.append(this.field('Colour', it.color, set('color'), { type: 'color' }), h('div.ed-xyz', null, this.field('Brightness', it.intensity, set('intensity', 1), { type: 'number', step: '0.1' }), this.field('Reach', it.range, set('range', 1), { type: 'number' })));
      } else if (it.type === 'spawn') {
        const mons = Object.entries(G.Config.MONSTERS).sort((a, b) => a[1].level - b[1].level).map(([id, m]) => [id, `${m.name} (lv ${m.level})`]);
        body.append(this.field('Monster', it.monster, set('monster'), { options: mons }), h('div.ed-xyz', null, this.field('How many', it.count, set('count', 1), { type: 'number' }), this.field('Area radius', it.r, set('r', 1), { type: 'number' })));
      } else if (it.type === 'npcref') {
        body.append(h('p.hint', { text: `${it.name} is one of the map’s own NPCs: move, turn or delete them here; their shop, quests and dialog stay the same.` }));
      } else if (it.type === 'npc') {
        const jobs = G.Jobs.ALL ? Object.keys(G.Jobs.ALL) : ['novice'];
        body.append(this.field('Name', it.name, set('name')), this.field('Title', it.title, set('title')),
          h('div.ed-xyz', null, this.field('Outfit', it.costume, set('costume'), { options: jobs.map((j) => [j, (G.Jobs.get(j) || {}).name || j]) }),
            this.field('Hair', it.style, set('style'), { options: ['short', 'spiky', 'swept', 'messy', 'slick', 'buzz', 'ponytail', 'twintails'].map((x) => [x, x]) })),
          this.field('Says (one line per message)', (it.lines || []).join('\n'), (v) => { this.snapshot(); it.lines = String(v).split('\n').map((l) => l.trim()).filter(Boolean); this.changed(); }, { area: true }));
      }
      body.append(h('div.opt-btns', null, h('button.btn.small.ghost', { type: 'button', onclick: () => this.duplicateSel() }, 'Duplicate'), h('button.btn.small.ghost', { type: 'button', onclick: () => this.removeSel() }, 'Delete')));
    },
    renderMap(body) {
      const d = this.data, b = d.bounds;
      const setB = (k) => (v) => { this.snapshot(); b[k] = Math.round(Number(v)); this.rebuildMarkers(); this.changed(); };
      const grow = (k, by) => { this.snapshot(); b[k] += by; this.rebuildMarkers(); this.changed(); };
      body.append(this.field('Map name', d.name, (v) => { this.snapshot(); d.name = v; this.changed(); }),
        h('h4', { text: `Size: ${b.maxX - b.minX} × ${b.maxZ - b.minZ} units` }),
        h('div.ed-xyz', null, this.field('West edge (X)', b.minX, setB('minX'), { type: 'number' }), this.field('East edge (X)', b.maxX, setB('maxX'), { type: 'number' })),
        h('div.ed-xyz', null, this.field('North edge (Z)', b.minZ, setB('minZ'), { type: 'number' }), this.field('South edge (Z)', b.maxZ, setB('maxZ'), { type: 'number' })),
        h('div.ed-grow', null, h('span', { text: 'Grow by 20:' }),
          h('button.btn.small.ghost', { type: 'button', onclick: () => grow('minZ', -20) }, 'North'), h('button.btn.small.ghost', { type: 'button', onclick: () => grow('maxZ', 20) }, 'South'),
          h('button.btn.small.ghost', { type: 'button', onclick: () => grow('minX', -20) }, 'West'), h('button.btn.small.ghost', { type: 'button', onclick: () => grow('maxX', 20) }, 'East')),
        h('p.hint', { text: 'The red line shows the edges. New ground appears after saving (the map reloads).' }));
      if (G.Maps[this.game.mapId] && !G.Maps[this.game.mapId].custom && !d.takeover) {
        body.append(h('h4', { text: 'Original objects' }), h('p.hint', { text: 'Turn this map’s own houses, trees, props, monster spawns (training dummies too), warps and NPCs into editor objects you can move or delete. This saves and reloads the map.' }),
          h('button.btn.small', { type: 'button', onclick: () => this.takeOver() }, 'Make original objects editable'));
      } else if (d.takeover === true || d.takeover === 1) {
        body.append(h('h4', { text: 'Original objects' }), h('p.hint', { text: 'Houses, trees and props are editable. Make the rest editable too: the town gate, the spike wall, the bridge, rocks and bushes. This saves and reloads the map.' }),
          h('button.btn.small', { type: 'button', onclick: () => this.takeOver(true) }, 'Make remaining originals editable'));
      } else if (d.takeover) body.append(h('p.hint', { text: 'All of this map’s original objects are editable.' }));
      body.append(h('h4', { text: 'Go to map' }), h('button.btn.small', { type: 'button', onclick: () => this.openTeleport() }, '🗺 Choose a map…'));
      const nid = h('input.soc-in', { type: 'text', placeholder: 'map_id', maxlength: '40' }), nname = h('input.soc-in', { type: 'text', placeholder: 'Map name', maxlength: '40' });
      for (const i of [nid, nname]) i.addEventListener('keydown', (e) => e.stopPropagation());
      body.append(h('h4', { text: 'New map' }), h('div.soc-inv', null, nid, nname), h('button.btn.small', { type: 'button', onclick: () => this.newMap(nid.value, nname.value.trim()) }, 'Create and go there'));
    },
  };
  G.MapEditor = Ed;
})(window.G = window.G || {});
