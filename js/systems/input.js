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
      // The skill cursor only shows over the game world (windows keep the normal pointer).
      d.addEventListener('pointerleave', () => { if (this.cursorEl) this.cursorEl.hidden = true; });
      d.addEventListener('pointerenter', () => { if (this.cursorEl && this.targeting) this.cursorEl.hidden = false; });
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
        if (this.game.windows.isOpen('storage')) { this.game.log.add('Close your storage before dropping items on the ground.', 'warn'); return; }
        if (G.CustomMaps && G.CustomMaps.rule('noDrop')) { this.game.log.add('You can’t drop items on this map.', 'warn'); return; }
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
      if (G.MapEditor && G.MapEditor.active && G.MapEditor.pointer(e)) return;   // the map editor handles clicks
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
      this.mouseX = e.clientX; this.mouseY = e.clientY;
      if (this.targeting && this.cursorEl) this.cursorEl.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
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
      if (this.capturing) return;   // the key-binding window is listening
      const g = this.game;
      if (e.key === 'Escape') {
        if (g.dialog.isOpen) { g.dialog.close(); return; }
        if (this.targeting) { this.cancelTargeting(true); return; }
        if (!g.windows.closeTop()) { if (g.player.target) g.player.clearTarget(); else g.windows.open('options'); }
        return;
      }
      const action = G.Keybinds.match(e);
      if (!action) return;
      e.preventDefault();
      const hot = /^hot(\d)$/.exec(action);
      if (hot) { g.hotbar.trigger(parseInt(hot[1], 10) - 1); return; }
      switch (action) {
        case 'status': case 'inventory': case 'equipment': case 'skills': case 'quests': case 'worldmap': case 'options': case 'party': case 'guild':
          g.windows.toggle(action); break;
        case 'autoloot': g.extras.setAutoLoot(!g.autoLoot); break;
        case 'cart': g.cart.toggle(); break;
        case 'help': g.hud.toggleHelp(); break;
        case 'debug': g.extras.setDebug(!g.extras.debug); break;
        case 'camReset': g.camera.reset(); break;
      }
    }

    startTargeting(skillId, mode, lv) {
      this.targeting = skillId;
      this.targetLv = lv || this.game.player.skills.useLevel(skillId);
      this.targetMode = mode || 'enemy';
      document.body.classList.add('cursor-target');
      // Like RO: a turning target ring at the mouse, with the skill's name and level beside it.
      const el = this.skillCursor(), s = G.Skills.get(skillId);
      el.querySelector('.sc-label').textContent = `${s.name} Lv ${this.targetLv}`;
      if (this.mouseX != null) el.style.transform = `translate(${this.mouseX}px, ${this.mouseY}px)`;
      el.hidden = this.mouseX == null;
      this.updateCursor();
      this.game.hud.toast(this.targetMode === 'ground' ? `Click the ground to place ${G.Skills.get(skillId).name}. Right-click or Esc cancels.`
        : this.targetMode === 'ally'
        ? `Click a character (yourself or another player) to cast ${G.Skills.get(skillId).name}. Right-click or Esc cancels.`
        : `Click a monster to use ${G.Skills.get(skillId).name}. Right-click or Esc cancels.`);
    }
    // Is the cursor over the player's own character?
    pickSelf(ray) {
      const p = this.game.player.position;
      const oc = new THREE.Vector3(p.x, p.y + 1.1, p.z).sub(ray.origin);
      const tca = oc.dot(ray.direction);
      return tca > 0 && oc.lengthSq() - tca * tca < 0.95 * 0.95;
    }
    // Another player under the cursor (online)?
    pickRemote(ray) {
      if (!G.Net || !G.Net.players.size) return null;
      let best = null, bd = 0.95 * 0.95;
      for (const r of G.Net.players.values()) {
        const oc = new THREE.Vector3(r.position.x, r.position.y + 1.1, r.position.z).sub(ray.origin);
        const tca = oc.dot(ray.direction), d2 = oc.lengthSq() - tca * tca;
        if (tca > 0 && d2 < bd) { bd = d2; best = r; }
      }
      return best;
    }
    skillCursor() {
      if (this.cursorEl) return this.cursorEl;
      const el = this.cursorEl = document.createElement('div');
      el.id = 'skill-cursor'; el.hidden = true; el.setAttribute('aria-hidden', 'true');
      el.innerHTML = '<svg class="sc-ring" viewBox="0 0 48 48" width="48" height="48"><circle class="sc-out" cx="24" cy="24" r="17"/><circle class="sc-seg" cx="24" cy="24" r="17"/>'
        + '<circle class="sc-in" cx="24" cy="24" r="9"/><circle class="sc-dot" cx="24" cy="24" r="1.8"/></svg><span class="sc-label"></span>';
      document.body.appendChild(el);
      return el;
    }
    cancelTargeting(msg) {
      if (!this.targeting) return;
      this.targeting = null;
      document.body.classList.remove('cursor-target');
      if (this.cursorEl) this.cursorEl.hidden = true;
      if (msg) this.game.log.add('Skill cancelled.', 'info');
    }

    click() {
      const player = this.game.player;
      if (!player.alive) return;
      const { ground, mon, npc, loot } = this.pickAt();
      if (this.targeting) {
        const id = this.targeting, lv = this.targetLv;
        if (this.targetMode === 'ground') {
          const pt = ground || (mon && mon.position);
          this.cancelTargeting(!pt);
          if (pt) player.skills.use(id, { ground: true, alive: true, position: new THREE.Vector3(pt.x, G.Terrain.surfaceHeight(pt.x, pt.z), pt.z) }, lv);
          return;
        }
        if (this.targetMode === 'ally') {
          const self = this.pickSelf(this.ray.ray), other = !self && this.pickRemote(this.ray.ray);
          this.cancelTargeting(!self && !other);
          if (self) player.skills.use(id, player, lv);
          else if (other) player.skills.use(id, other, lv);
          return;
        }
        const foe = !mon && G.CustomMaps.rule('pvp') && this.pickRemote(this.ray.ray);
        this.cancelTargeting(!mon && !foe);
        if (mon) player.skills.use(id, mon, lv); else if (foe) player.skills.use(id, foe, lv);
        return;
      }
      if (npc) {
        player.talkTo(npc);
        this.holdMove = false;
      } else if (mon) {
        player.attack(mon);
        this.holdMove = false;
      } else if (G.CustomMaps.rule('pvp') && this.pickRemote(this.ray.ray)) {
        // PvP map: clicking another player attacks them.
        player.attack(this.pickRemote(this.ray.ray));
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
      // The skill ring lights up over something it can be used on.
      if (this.cursorEl) this.cursorEl.classList.toggle('over', !!this.targeting && (this.targetMode === 'ground' || (this.targetMode === 'enemy' && !!this.hover)));
    }
  }

  G.Input = Input;
})(window.G = window.G || {});
