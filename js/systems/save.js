/* Save system: stores the character in localStorage.
   - Autosaves every 30 s, shortly after anything important changes, and when
     the tab is hidden or closed.
   - Each save carries a version number so later stages can migrate old saves.
   - Preferences (camera settings, window positions) are stored separately so
     deleting a character keeps your settings. */
(function (G) {
  'use strict';
  const KEY = 'willowmere.save';          // the old single-character save
  const SLOTS = 15;
  const slotKey = (i) => `willowmere.slot.${i}`;
  const PREFS = 'willowmere.prefs';
  const VERSION = 3;

  function read(key) {
    try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }

  class SaveSystem {
    constructor(game) {
      this.game = game;
      this.dirtyT = -1;
      this.autoT = 0;
      this.enabled = false;
      const flush = () => { if (this.enabled) this.save(true, true); };
      document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
      window.addEventListener('pagehide', flush);
      window.addEventListener('beforeunload', flush);
    }

    static peek() {
      const d = read(KEY);
      return d && d.version && d.character ? d : null;
    }
    /* Character slots (15). The old single save moves into slot 1 the first time. */
    static get SLOTS() { return SLOTS; }
    static listSlots() {
      const old = SaveSystem.peek();
      if (old && !read(slotKey(0))) { write(slotKey(0), old); try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } }
      const out = [];
      for (let i = 0; i < SLOTS; i++) { const d = read(slotKey(i)); out.push(d && d.version && d.character ? d : null); }
      return out;
    }
    static clearSlot(i) { try { localStorage.removeItem(slotKey(i)); } catch (e) { /* ignore */ } }
    static prefs() { return read(PREFS) || {}; }
    static setPrefs(patch) { write(PREFS, Object.assign(SaveSystem.prefs(), patch)); }
    static clear() { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } }

    markDirty() { if (this.dirtyT < 0) this.dirtyT = 2; }

    serialize() {
      const p = this.game.player;
      const eq = {};
      for (const s in p.equipment) if (p.equipment[s]) eq[s] = { id: p.equipment[s].id, cards: p.equipment[s].cards, refine: p.equipment[s].refine || 0, forgedBy: p.equipment[s].forgedBy, element: p.equipment[s].element };
      return {
        version: VERSION,
        savedAt: Date.now(),
        character: { name: p.name, appearance: p.appearance },
        job: p.job,
        baseLevel: p.baseLevel, jobLevel: p.jobLevel, baseExp: p.baseExp, jobExp: p.jobExp,
        stats: p.stats, statPoints: p.statPoints, skillPoints: p.skillPoints,
        hp: p.hp, sp: p.sp, zeny: p.zeny,
        inventory: p.inventory.serialize(),
        equipment: eq,
        hotbar: this.game.hotbar.serialize(),
        skills: p.skills.serialize(),
        storage: p.storage,
        position: { map: this.game.mapId, x: +p.position.x.toFixed(2), z: +p.position.z.toFixed(2), facing: +p.facing.toFixed(3) },
        savePoint: p.savePoint,
        extra: p.extra || {},   // reserved for later stages (skills, quests, storage)
      };
    }

    // Online, the server owns items, Zeny, EXP, levels, job and stats: only the rest is uploaded.
    soft() {
      const d = this.serialize();
      for (const k of ['job', 'baseLevel', 'jobLevel', 'baseExp', 'jobExp', 'stats', 'statPoints', 'zeny', 'inventory', 'equipment', 'storage']) delete d[k];
      d.extra = Object.assign({}, d.extra); delete d.extra.cart;
      return d;
    }

    save(silent, closing) {
      if (!this.enabled || !this.game.player) return false;
      // Online: the character lives in the server's database.
      if (G.Online && G.Online.enabled && this.charId) {
        this.dirtyT = -1; this.autoT = 0;
        // The request is returned so callers can wait for it (Character Selection, opening a shop).
        return fetch(`/api/characters/${this.charId}`, { method: 'PUT', keepalive: !!closing, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + G.Online.token }, body: JSON.stringify(this.soft()) })
          .then((r) => { if (!silent) this.game.log.add(r.ok ? 'Game saved to the server.' : 'Couldn’t save to the server.', r.ok ? 'system' : 'warn'); return r.ok; })
          .catch(() => { this.game.log.add('Couldn’t reach the server to save. Retrying soon.', 'warn'); return false; });
      }
      const ok = write(slotKey(this.slot || 0), this.serialize());
      this.dirtyT = -1;
      this.autoT = 0;
      if (!silent) this.game.log.add(ok ? 'Game saved.' : 'Couldn’t save: browser storage is unavailable or full.', ok ? 'system' : 'warn');
      return ok;
    }

    update(dt) {
      if (!this.enabled) return;
      this.autoT += dt;
      if (this.dirtyT >= 0) { this.dirtyT -= dt; if (this.dirtyT < 0) this.save(true); }
      if (this.autoT > 30) this.save(true);
    }
  }

  G.SaveSystem = SaveSystem;
})(window.G = window.G || {});
