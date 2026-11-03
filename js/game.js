/* Game: wires every system together and runs the main loop. */
(function (G) {
  'use strict';
  const C = G.Config, TR = G.Terrain;

  class Events {
    constructor() { this.map = {}; }
    on(name, fn) { (this.map[name] = this.map[name] || []).push(fn); }
    emit(name, data) { (this.map[name] || []).forEach((fn) => fn(data)); }
  }

  class Game {
    constructor(container, overlayCanvas) {
      this.container = container;
      this.overlayCanvas = overlayCanvas;
      this.events = new Events();
      this.time = 0;
      this.frame = 0;
      this.zoneName = null;
      if (this.player) this.events.emit('mapEntered', id);
    }

    // Build the world in steps so the loading screen can report progress.
    async init(progress) {
      const step = async (label, fn) => {
        progress(label);
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
        const t0 = performance.now();
        fn();
        (this.loadTimes = this.loadTimes || {})[label] = Math.round(performance.now() - t0);
      };

      await step('Setting up the renderer', () => this.setupRenderer());
      await step('Painting the sprites', () => {
        G.SpriteFactory.names.forEach((n) => G.SpriteFactory.get(n));
      });
      await step('Waking the monsters', () => {
        this.effects = new G.Effects(this.scene);
        this.audio = new G.Audio();
        this.spells = new G.Spells(this);
        this.timers = [];
        this.camera = new G.CameraController(this.camera3);
        this.log = new G.Log();
        this.save = new G.SaveSystem(this);
        this.loot = new G.LootSystem(this);
        this.quests = new G.Quests(this);
        this.overlay = new G.Overlay(this, this.overlayCanvas);
        G.Tooltip.init();
        this.windows = new G.WindowManager(this);
        this.hotbar = new G.Hotbar(this);
      });
      await step('Building Willowmere', () => {
        this.loadMap('meadow');
        this.onResize();
        window.addEventListener('resize', () => this.onResize());
      });
      await step('Warming up shaders', () => {
        this.renderer.compile(this.scene, this.camera3);
      });
    }

    /* ---------------- maps ---------------- */
    // Build a map: terrain, scenery, navigation, monsters, NPCs and portals.
    loadMap(id) {
      const map = G.Maps[id];
      if (this.mapRoot) this.unloadMap();
      this.map = map;
      this.mapId = id;
      this.mapRoot = new THREE.Group();
      this.scene.add(this.mapRoot);
      TR.init(map);
      this.terrain = TR.build(this.mapRoot);
      this.nav = new G.NavGrid(C.WORLD_SIZE, C.NAV_CELL);
      this.markTerrainObstacles();
      this.applyAtmosphere(map);
      this.env = new G.Environment(this.mapRoot, this.nav, map).build();
      this.monsters = new G.MonsterManager(this, map.spawns);
      this.npcs = new G.NPCManager(this, map.npcs || []);
      this.portals = new G.Portals(this, map.portals || []);
      this.zoneName = null;
    }

    // Fog, light and sky per map (caves are dim and close).
    applyAtmosphere(map) {
      const a = map.atmosphere;
      const fog = this.scene.fog;
      fog.color.copy(G.Utils.displayColor(a ? a.fog : C.SKY_HORIZON));
      fog.near = a ? a.near : 90;
      fog.far = a ? a.far : 300;
      this.hemi.intensity = a ? a.hemi : 0.62;
      this.hemi.groundColor.set(a ? a.ground : '#6b8f45');
      this.sun.intensity = a ? a.sun : 1.28;
    }

    unloadMap() {
      this.monsters.dispose();
      this.npcs.dispose();
      this.portals.dispose();
      this.loot.clear();
      this.timers = [];
      if (this.player) { this.player.clearTarget(); this.player.path = null; this.player.pendingLoot = null; this.player.approachTarget = null; }
      if (this.dialog) this.dialog.close();
      this.scene.remove(this.mapRoot);
      this.mapRoot.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
      });
      this.mapRoot = null;
    }

    /* Walk through a portal (or use a wing) to another map, with a short fade. */
    travel(id, x, z) {
      if (this.traveling) return;
      this.traveling = true;
      const fade = document.getElementById('fade');
      fade.classList.add('on');
      this.sfx('portal');
      setTimeout(() => {
        if (id !== this.mapId) this.loadMap(id);
        const p = this.player;
        const spot = this.nav.nearestWalkable(x, z, 8) || { x, z };
        p.setPosition(spot.x, spot.z);
        p.path = null;
        this.camera.snapTo(p.position);
        this.portals.cooldown = 1.5;
        this.save.markDirty();
        this.renderer.compile(this.scene, this.camera3);
        setTimeout(() => { fade.classList.remove('on'); this.traveling = false; }, 120);
      }, 320);
    }

    // Scenic view of the town behind the title screen.
    renderBackdrop() {
      this.camera.focus.set(0, 2.5, -66);
      this.camera3.position.set(-26, 13, -36);
      this.camera3.lookAt(this.camera.focus);
      this.renderer.render(this.scene, this.camera3);
    }

    /* Create or load the character, then start playing.
       choice: { type: 'new', name, appearance } | { type: 'load', data } */
    begin(choice) {
      const data = choice.type === 'load' ? choice.data : { name: choice.name, appearance: choice.appearance };
      if (choice.type === 'new') G.SaveSystem.clear();
      const startMap = (data.position && G.Maps[data.position.map]) ? data.position.map : 'meadow';
      if (startMap !== this.mapId) this.loadMap(startMap);
      this.player = new G.Player(this, data);
      const pos = data.position;
      if (pos && this.nav.walkable(pos.x, pos.z)) this.player.setPosition(pos.x, pos.z);
      else this.player.setPosition(0, -60);
      this.player.targetFacing = this.player.facing = pos ? pos.facing || 0 : 0;
      this.camera.snapTo(this.player.position);

      this.hud = new G.HUD(this);
      this.input = new G.Input(this);
      this.statusWin = G.Panels.statusWindow(this);
      this.inventoryWin = G.Panels.inventoryWindow(this);
      this.equipmentWin = G.Panels.equipmentWindow(this);
      this.optionsWin = G.Panels.optionsWindow(this);
      this.skillsWin = G.Panels.skillsWindow(this);
      this.dialog = new G.Dialog(this);
      this.shop = new G.Shop(this);
      this.storage = new G.Storage(this);
      this.questlog = new G.QuestLog(this);
      this.questsWin = G.Panels.questsWindow(this);
      this.extras = new G.Extras(this);
      this.minimap = new G.Minimap(this);
      document.getElementById('fps').hidden = !G.SaveSystem.prefs().fps;
      this.setQuality(G.SaveSystem.prefs().quality || 'high', true);
      this.menu = G.Panels.menuBar(this);
      if (choice.type === 'load') this.hotbar.load(data.hotbar);
      else this.hotbar.load([{ type: 'item', id: 'novice_potion' }, { type: 'item', id: 'red_potion' }, { type: 'skill', id: 'first_aid' }, null, null, null, null, null, { type: 'item', id: 'butterfly_wing' }]);
      this.events.on('skillsChanged', () => this.hotbar.render());
      this.events.on('jobChanged', () => { this.hotbar.render(); this.windows.refresh('equipment'); });

      this.listenForDebugGifts();

      this.player.inventory.onChange(() => {
        this.windows.refresh('inventory');
        this.windows.refresh('equipment');
        this.windows.refresh('status');
        this.hotbar.render();
        this.save.markDirty();
      });

      this.save.enabled = true;
      if (choice.type === 'new') {
        this.save.save(true);
        this.log.add(`Welcome to Willowmere, ${this.player.name}! Your progress saves automatically.`, 'system');
        this.log.add('Your starter kit is in your inventory (Alt+E). Potions are on F1 and F2.', 'system');
      } else {
        this.log.add(`Welcome back, ${this.player.name}.`, 'system');
      }
      document.body.classList.add('playing');
      this.audio.unlock();
      this.events.emit('mapEntered', this.mapId);
      this.questlog.check();
      this.start();
    }

    setupRenderer() {
      THREE.ColorManagement.legacyMode = false;
      const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      r.outputEncoding = THREE.sRGBEncoding;
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = 0.92;
      r.shadowMap.enabled = true;
      r.shadowMap.type = THREE.PCFSoftShadowMap;
      this.container.appendChild(r.domElement);
      this.renderer = r;

      const scene = new THREE.Scene();
      scene.fog = new THREE.Fog(0xffffff, 90, 300);
      scene.fog.color.copy(G.Utils.displayColor(C.SKY_HORIZON));
      this.scene = scene;
      this.camera3 = new THREE.PerspectiveCamera(C.CAMERA.fov, 1, 0.1, 900);

      const hemi = new THREE.HemisphereLight('#dff1ff', '#6b8f45', 0.62);
      scene.add(hemi);
      this.hemi = hemi;
      const sun = new THREE.DirectionalLight('#fff0d4', 1.28);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      const sc = sun.shadow.camera;
      sc.left = -36; sc.right = 36; sc.top = 36; sc.bottom = -36; sc.near = 1; sc.far = 220;
      sun.shadow.bias = -0.0006;
      sun.shadow.normalBias = 0.03;
      scene.add(sun, sun.target);
      this.sun = sun;
      this.sunOffset = new THREE.Vector3(38, 78, 30);
    }

    markTerrainObstacles() {
      const B = C.BRIDGE;
      this.nav.markAll((x, z) => {
        if (TR.boundaryRaw(x, z) > -0.5) return true;
        if (TR.onBridge(x, z)) return false;
        if (TR.isWater(x, z)) return true;
        if (this.map.cave && TR.height(x, z) > 0.85) return true;
        const e = 0.5;
        const sl = Math.hypot(TR.height(x + e, z) - TR.height(x - e, z), TR.height(x, z + e) - TR.height(x, z - e)) / (2 * e);
        return sl > 1.1;
      });
      // Bridge railings.
      if (!this.map.bridge) return;
      this.nav.blockRect(B.x - B.halfWidth + 0.12, TR.BRIDGE_Z, 0.1, B.halfLength, 0);
      this.nav.blockRect(B.x + B.halfWidth - 0.12, TR.BRIDGE_Z, 0.1, B.halfLength, 0);
    }

    onResize() {
      const w = window.innerWidth, h = window.innerHeight;
      this.renderer.setSize(w, h);
      this.camera3.aspect = w / h;
      this.camera3.updateProjectionMatrix();
      if (this.overlay) this.overlay.resize(w, h, Math.min(window.devicePixelRatio || 1, 2));
      if (this.effects) this.effects.setPixelScale(h * this.renderer.getPixelRatio(), C.CAMERA.fov);
      if (!this.player && this.camera) this.renderBackdrop();
    }

    /* Debug-only cross-tab item delivery from the database page (db.html).
       The database can reach this only while this character is online in a
       tab on the same origin, and only the character with the matching name
       accepts the item. */
    listenForDebugGifts() {
      if (!window.BroadcastChannel || this.debugGiftChannel) return;
      this.debugGiftChannel = new BroadcastChannel('willowmere-debug');
      this.debugGiftChannel.addEventListener('message', (event) => {
        const request = event.data || {};
        if (request.type !== 'give-item' || !this.player || !this.save.enabled) return;
        const reply = { type: 'give-item-result', requestId: request.requestId, ok: false };
        const requestedName = String(request.playerName || '').trim();
        const qty = Number(request.qty);
        const itemId = String(request.itemId || '');
        const item = G.Items.get(itemId);
        if (requestedName.toLowerCase() !== String(this.player.name || '').trim().toLowerCase()) return; // not this character
        if (!item || !Number.isInteger(qty) || qty < 1 || qty > 30000) {
          reply.message = 'Invalid item or quantity.';
        } else {
          const result = this.player.inventory.add(itemId, qty, { ignoreWeight: true });
          if (result.added === qty) {
            this.save.save(true);
            reply.ok = true;
            reply.characterName = this.player.name;
            this.log.add(`[DEBUG] Received ${qty} × ${item.name}.`, 'system');
          } else {
            reply.message = result.reason === 'full' ? 'Player inventory is full.' : 'Could not add that item.';
          }
        }
        this.debugGiftChannel.postMessage(reply);
      });
    }

    /* Graphics quality: shadows and render resolution. */
    setQuality(level, silent) {
      const Q = { high: { shadows: true, map: 2048, dpr: 2 }, medium: { shadows: true, map: 1024, dpr: 1.25 }, low: { shadows: false, map: 512, dpr: 1 } }[level] || {};
      this.quality = level;
      const r = this.renderer;
      if (r.shadowMap.enabled !== Q.shadows) {
        r.shadowMap.enabled = Q.shadows;
        this.scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); });
      }
      if (this.sun.shadow.mapSize.x !== Q.map) {
        this.sun.shadow.mapSize.set(Q.map, Q.map);
        if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
      }
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.dpr));
      this.onResize();
      G.SaveSystem.setPrefs({ quality: level });
      if (!silent) this.log.add(`Graphics quality: ${level}.`, 'system');
    }

    // Frame-rate meter; drops to medium quality once if High runs badly.
    trackPerformance(dt) {
      this.perf = this.perf || { t: 0, frames: 0, slow: 0 };
      const P = this.perf;
      P.t += dt; P.frames++;
      if (P.t < 1) return;
      const fps = P.frames / P.t;
      P.t = 0; P.frames = 0;
      const el = document.getElementById('fps');
      if (!el.hidden) el.textContent = `${Math.round(fps)} fps`;
      if (this.quality === 'high' && fps < 28 && !P.downgraded) {
        if (++P.slow >= 6) { P.downgraded = true; this.setQuality('medium'); this.log.add('The game switched to medium graphics to run smoother. Change it in Options (O).', 'system'); }
      } else P.slow = 0;
    }

    // Play a sound effect, optionally positioned in the world (quieter far away).
    sfx(name, at) { if (this.audio) this.audio.play(name, at ? { at } : undefined); }

    // Run fn after a delay in game time (pauses with the game, unlike setTimeout).
    after(sec, fn) { this.timers.push({ at: this.time + sec, fn }); }

    start() {
      this.clock = new THREE.Clock();
      const loop = () => {
        this.raf = requestAnimationFrame(loop);
        this.tick(Math.min(this.clock.getDelta(), 0.05));
      };
      loop();
    }

    tick(dt) {
      this.time += dt;
      this.frame++;
      for (let i = this.timers.length - 1; i >= 0; i--) {
        if (this.time >= this.timers[i].at) { const t = this.timers[i]; this.timers.splice(i, 1); t.fn(); }
      }
      this.input.update(dt);
      this.player.update(dt);
      this.audio.update(this);
      this.camera.update(dt, this.player.position);
      const camPos = this.camera3.position;
      this.player.syncVisuals(dt, camPos);
      this.monsters.update(dt, camPos);
      this.npcs.update(dt, camPos);
      this.portals.update(dt, this.time);
      this.spells.update(dt, this.time);
      this.quests.update(dt);
      this.dialog.update(dt);
      this.shop.update(dt);
      this.storage.update(dt);
      this.extras.update(dt);
      this.hotbar.update(dt);
      this.minimap.update(dt);
      this.trackPerformance(dt);

      // Keep the shadow frustum centred on the player (snapped to texels to avoid shimmer).
      const f = this.camera.focus;
      const snap = 72 / 2048;
      const fx = Math.round(f.x / snap) * snap, fz = Math.round(f.z / snap) * snap;
      this.sun.target.position.set(fx, 0, fz);
      this.sun.position.set(fx + this.sunOffset.x, this.sunOffset.y, fz + this.sunOffset.z);

      this.loot.update(dt, this.time);
      this.save.update(dt);
      this.env.update(dt, this.time);
      this.terrain.waterTex.offset.set(this.time * 0.012, this.time * 0.007);
      this.effects.ambient(dt, f, this.env.fountainPos, this.map);
      this.effects.update(dt, this.time);
      this.updateZone();

      this.renderer.render(this.scene, this.camera3);
      this.overlay.draw(dt);
      this.hud.update();
    }

    updateZone() {
      const p = this.player.position;
      const inTown = this.map.town && Math.hypot(p.x - C.TOWN.cx, p.z - C.TOWN.cz) < C.TOWN.radius + 1;
      const name = inTown ? C.TOWN.name : this.map.name;
      if (name !== this.zoneName) {
        if (this.zoneName !== null || true) this.hud.zone(name);
        this.zoneName = name;
      }
    }
  }

  G.Game = Game;
})(window.G = window.G || {});
