/* Input: routes mouse and keyboard to the game.
   Left click  - target a monster, or walk to the clicked ground.
   Left hold   - keep walking toward the cursor.
   Right drag  - orbit the camera (never moves or targets).
   Wheel       - zoom.  Middle click / Home - reset camera.            */
(function (G) {
  'use strict';
  const TR = G.Terrain;

  class Input {
    constructor(game) {
      this.game = game;
      this.dom = game.renderer.domElement;
      this.ndc = new THREE.Vector2();
      this.ray = new THREE.Raycaster();
      this.rotating = false;
      this.leftDown = false;
      this.holdMove = false;
      this.holdT = 0;
      this.hover = null;
      this.hasPointer = false;
      this.dragDist = 0;

      const d = this.dom;
      d.addEventListener('contextmenu', (e) => e.preventDefault());
      d.addEventListener('pointerdown', (e) => this.onDown(e));
      d.addEventListener('pointermove', (e) => this.onMove(e));
      window.addEventListener('pointerup', (e) => this.onUp(e));
      d.addEventListener('wheel', (e) => { e.preventDefault(); this.game.camera.zoom(e.deltaY * (e.deltaMode === 1 ? 16 : 1)); }, { passive: false });
      window.addEventListener('blur', () => { this.rotating = false; this.leftDown = false; this.holdMove = false; this.updateCursor(); });
      window.addEventListener('keydown', (e) => this.onKey(e));
      // Dragging an inventory item onto the world drops it on the ground.
      d.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/x-item')) e.preventDefault(); });
      d.addEventListener('drop', (e) => {
        const data = e.dataTransfer.getData('text/x-item');
        if (!data) return;
        e.preventDefault();
        const { uid } = JSON.parse(data);
        const entry = this.game.player.inventory.find(uid);
        if (entry) this.game.inventoryWin.dropSelected(uid, entry.qty);
      });
    }

    setNdc(e) {
      const r = this.dom.getBoundingClientRect();
      this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.hasPointer = true;
    }

    castRay() {
      this.ray.setFromCamera(this.ndc, this.game.camera3);
      return this.ray.ray;
    }

    pickAt() {
      const ray = this.castRay();
      const ground = TR.raycast(ray, 400);
      const limit = ground ? ground.t + 1.2 : Infinity;
      const mon = this.game.monsters.pick(ray, limit);
      const npc = mon ? null : this.game.npcs.pick(ray, limit);
      const loot = mon || npc ? null : this.game.loot.pick(ray, limit);
      return { ground, mon, npc, loot };
    }

    onDown(e) {
      this.setNdc(e);
      if (e.button === 2 && this.targeting) this.cancelTargeting(true);
      if (e.button === 2) {
        this.rotating = true;
        this.lastX = e.clientX; this.lastY = e.clientY;
        try { this.dom.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      } else if (e.button === 0) {
        this.leftDown = true;
        this.click();
      } else if (e.button === 1) {
        e.preventDefault();
        this.game.camera.reset();
      }
      this.updateCursor();
    }

    onMove(e) {
      this.setNdc(e);
      if (this.rotating) {
        const dx = e.clientX - this.lastX, dy = e.clientY - this.lastY;
        this.lastX = e.clientX; this.lastY = e.clientY;
        this.game.camera.rotate(dx, dy);
      }
    }

    onUp(e) {
      if (e.button === 2) this.rotating = false;
      if (e.button === 0) { this.leftDown = false; this.holdMove = false; }
      this.updateCursor();
    }

    onKey(e) {
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      const g = this.game, k = e.key, code = e.code;
      // Window shortcuts (Alt combos like the classics, plus single keys).
      if (k === 'Escape') {
        if (g.dialog.isOpen) { g.dialog.close(); return; }
        if (this.targeting) { this.cancelTargeting(true); return; }
      }
      if (!e.altKey && !e.ctrlKey && k.toLowerCase() === 'l') { g.extras.setAutoLoot(!g.autoLoot); return; }
      if (code === 'Backquote') { g.extras.setDebug(!g.extras.debug); return; }
      if ((e.altKey && code === 'KeyS') || (!e.altKey && !e.ctrlKey && k.toLowerCase() === 'k')) { e.preventDefault(); g.windows.toggle('skills'); return; }
      const win = (e.altKey && code === 'KeyA') || (!e.altKey && !e.ctrlKey && k.toLowerCase() === 'c') ? 'status'
        : (e.altKey && code === 'KeyE') || (!e.altKey && !e.ctrlKey && k.toLowerCase() === 'i') ? 'inventory'
        : (e.altKey && code === 'KeyQ') || (!e.altKey && !e.ctrlKey && k.toLowerCase() === 'q') ? 'equipment'
        : (!e.altKey && !e.ctrlKey && k.toLowerCase() === 'o') ? 'options' : null;
      if (win) { e.preventDefault(); g.windows.toggle(win); return; }
      // Hotbar: F1-F9 or 1-9.
      const fk = /^F([1-9])$/.exec(k);
      const nk = !e.altKey && !e.ctrlKey && /^Digit([1-9])$/.exec(code);
      if (fk || nk) { e.preventDefault(); g.hotbar.trigger(parseInt((fk || nk)[1], 10) - 1); return; }
      if (k === 'Home') { g.camera.reset(); e.preventDefault(); }
      else if (k === 'Escape') { if (!g.windows.closeTop()) g.player.clearTarget(); }
      else if (k === 'h' || k === 'H') g.hud.toggleHelp();
    }

    startTargeting(skillId, mode) {
      this.targeting = skillId;
      this.targetMode = mode || 'enemy';
      document.body.classList.add('cursor-target');
      this.game.hud.toast(this.targetMode === 'ally'
        ? `Click a character (yourself) to cast ${G.Skills.get(skillId).name}. Right-click or Esc cancels.`
        : `Click a monster to use ${G.Skills.get(skillId).name}. Right-click or Esc cancels.`);
    }
    // Is the cursor over the player's own character?
    pickSelf(ray) {
      const p = this.game.player.position;
      const oc = new THREE.Vector3(p.x, p.y + 1.1, p.z).sub(ray.origin);
      const tca = oc.dot(ray.direction);
      return tca > 0 && oc.lengthSq() - tca * tca < 0.95 * 0.95;
    }
    cancelTargeting(msg) {
      if (!this.targeting) return;
      this.targeting = null;
      document.body.classList.remove('cursor-target');
      if (msg) this.game.log.add('Skill cancelled.', 'info');
    }

    click() {
      const player = this.game.player;
      if (!player.alive) return;
      const { ground, mon, npc, loot } = this.pickAt();
      if (this.targeting) {
        const id = this.targeting;
        if (this.targetMode === 'ally') {
          const self = this.pickSelf(this.ray.ray);
          this.cancelTargeting(!self);
          if (self) player.skills.use(id, player);
          return;
        }
        this.cancelTargeting(!mon);
        if (mon) player.skills.use(id, mon);
        return;
      }
      if (npc) {
        player.talkTo(npc);
        this.holdMove = false;
      } else if (mon) {
        player.attack(mon);
        this.holdMove = false;
      } else if (loot) {
        player.pickUp(loot);
        this.holdMove = false;
      } else if (ground) {
        player.moveTo(ground);
        this.holdMove = true;
        this.holdT = 0;
      }
    }

    update(dt) {
      if (!this.hasPointer) return;
      // Hover highlight (only when not dragging the camera).
      if (!this.rotating) {
        const { ground, mon, npc, loot } = this.pickAt();
        if (loot !== this.hoverLoot) { this.hoverLoot = loot; this.updateCursor(); }
        if (npc !== this.hoverNpc) { this.hoverNpc = npc; this.updateCursor(); }
        if (mon !== this.hover) {
          this.hover = mon;
          this.game.effects.showHover(mon && mon !== this.game.player.target ? mon : null);
          this.updateCursor();
        } else if (mon && mon === this.game.player.target) {
          this.game.effects.showHover(null);
        }
        // Hold left button to keep walking toward the cursor.
        if (this.leftDown && this.holdMove && ground) {
          this.holdT += dt;
          if (this.holdT > 0.12) {
            this.holdT = 0;
            this.game.player.moveTo(ground, true);
          }
        }
      }
    }

    updateCursor() {
      const b = document.body.classList;
      b.toggle('cursor-rotate', this.rotating);
      b.toggle('cursor-attack', !this.rotating && !!this.hover);
      b.toggle('cursor-pickup', !this.rotating && !this.hover && !!this.hoverLoot);
      b.toggle('cursor-talk', !this.rotating && !this.hover && !!this.hoverNpc);
    }
  }

  G.Input = Input;
})(window.G = window.G || {});
