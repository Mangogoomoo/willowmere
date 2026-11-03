/* Save system: stores the character in localStorage.
   - Autosaves every 30 s, shortly after anything important changes, and when
     the tab is hidden or closed.
   - Each save carries a version number so later stages can migrate old saves.
   - Preferences (camera settings, window positions) are stored separately so
     deleting a character keeps your settings. */
(function (G) {
  'use strict';
  const KEY = 'willowmere.save';
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
      const flush = () => { if (this.enabled) this.save(true); };
      document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
      window.addEventListener('pagehide', flush);
      window.addEventListener('beforeunload', flush);
    }

    static peek() {
      const d = read(KEY);
      return d && d.version && d.character ? d : null;
    }
    static prefs() { return read(PREFS) || {}; }
    static setPrefs(patch) { write(PREFS, Object.assign(SaveSystem.prefs(), patch)); }
    static clear() { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } }

    markDirty() { if (this.dirtyT < 0) this.dirtyT = 2; }

    serialize() {
      const p = this.game.player;
      const eq = {};
      for (const s in p.equipment) if (p.equipment[s]) eq[s] = { id: p.equipment[s].id, cards: p.equipment[s].cards };
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

    save(silent) {
      if (!this.enabled || !this.game.player) return false;
      const ok = write(KEY, this.serialize());
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
