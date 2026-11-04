/* Save system: stores up to 15 independent characters in localStorage.
   Existing single-character saves are migrated into slot 1 automatically.
   Preferences remain separate and are not removed when a character is deleted. */
(function (G) {
  'use strict';
  const LEGACY_KEY = 'willowmere.save';
  const SLOTS_KEY = 'willowmere.characters.v1';
  const ACTIVE_KEY = 'willowmere.activeCharacterSlot';
  const PREFS = 'willowmere.prefs';
  const VERSION = 3;
  const SLOT_COUNT = 15;

  function read(key) {
    try {
      const s = localStorage.getItem(key);
      return s ? JSON.parse(s) : null;
    } catch (e) { return null; }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) { return false; }
  }

  function validSave(data) {
    return !!(data && data.version && data.character && data.character.name);
  }

  function readSlots() {
    const raw = read(SLOTS_KEY);
    const slots = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    // One-time migration from the original single-character save format.
    const legacy = read(LEGACY_KEY);
    if (validSave(legacy) && !validSave(slots['1'])) {
      slots['1'] = legacy;
      if (write(SLOTS_KEY, slots)) {
        try { localStorage.removeItem(LEGACY_KEY); } catch (e) { /* ignore */ }
      }
    }
    return slots;
  }

  function activeSlot() {
    const n = Number(read(ACTIVE_KEY));
    return Number.isInteger(n) && n >= 1 && n <= SLOT_COUNT ? n : 1;
  }

  class SaveSystem {
    constructor(game) {
      this.game = game;
      this.dirtyT = -1;
      this.autoT = 0;
      this.enabled = false;
      const flush = () => { if (this.enabled) this.save(true); };
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) flush();
      });
      window.addEventListener('pagehide', flush);
      window.addEventListener('beforeunload', flush);
    }

    static get SLOT_COUNT() { return SLOT_COUNT; }

    static slots() {
      const all = readSlots();
      return Array.from({ length: SLOT_COUNT }, (_, i) => ({
        slot: i + 1,
        data: validSave(all[String(i + 1)]) ? all[String(i + 1)] : null
      }));
    }

    static peek() {
      return { slots: SaveSystem.slots(), activeSlot: activeSlot() };
    }

    static setActiveSlot(slot) {
      const n = Number(slot);
      if (!Number.isInteger(n) || n < 1 || n > SLOT_COUNT) return false;
      return write(ACTIVE_KEY, n);
    }

    static deleteSlot(slot) {
      const n = Number(slot);
      if (!Number.isInteger(n) || n < 1 || n > SLOT_COUNT) return false;
      const all = readSlots();
      delete all[String(n)];
      return write(SLOTS_KEY, all);
    }

    static prefs() { return read(PREFS) || {}; }
    static setPrefs(patch) {
      write(PREFS, Object.assign(SaveSystem.prefs(), patch));
    }

    // Called by Game.begin() when starting a new character. Only the selected
    // slot is cleared; the other fourteen characters are left untouched.
    static clear() {
      return SaveSystem.deleteSlot(activeSlot());
    }

    markDirty() {
      if (this.dirtyT < 0) this.dirtyT = 2;
    }

    serialize() {
      const p = this.game.player;
      const eq = {};
      for (const s in p.equipment) {
        if (p.equipment[s]) {
          eq[s] = {
            id: p.equipment[s].id,
            cards: p.equipment[s].cards,
            refine: p.equipment[s].refine || 0,
            forgedBy: p.equipment[s].forgedBy,
            element: p.equipment[s].element
          };
        }
      }
      return {
        version: VERSION,
        savedAt: Date.now(),
        character: { name: p.name, appearance: p.appearance },
        job: p.job,
        baseLevel: p.baseLevel, jobLevel: p.jobLevel,
        baseExp: p.baseExp, jobExp: p.jobExp,
        stats: p.stats, statPoints: p.statPoints, skillPoints: p.skillPoints,
        hp: p.hp, sp: p.sp, zeny: p.zeny,
        inventory: p.inventory.serialize(),
        equipment: eq,
        hotbar: this.game.hotbar.serialize(),
        skills: p.skills.serialize(),
        storage: p.storage,
        position: {
          map: this.game.mapId,
          x: +p.position.x.toFixed(2),
          z: +p.position.z.toFixed(2),
          facing: +p.facing.toFixed(3)
        },
        savePoint: p.savePoint,
        extra: p.extra || {}
      };
    }

    save(silent) {
      if (!this.enabled || !this.game.player) return false;
      const all = readSlots();
      all[String(activeSlot())] = this.serialize();
      const ok = write(SLOTS_KEY, all);
      this.dirtyT = -1;
      this.autoT = 0;
      if (!silent) {
        this.game.log.add(
          ok ? 'Game saved.' : 'Couldn’t save: browser storage is unavailable or full.',
          ok ? 'system' : 'warn'
        );
      }
      return ok;
    }

    update(dt) {
      if (!this.enabled) return;
      this.autoT += dt;
      if (this.dirtyT >= 0) {
        this.dirtyT -= dt;
        if (this.dirtyT < 0) this.save(true);
      }
      if (this.autoT > 30) this.save(true);
    }
  }

  G.SaveSystem = SaveSystem;
})(window.G = window.G || {});
