/* QuestLog: guild quests (data/quests.js). Progress is tracked as you play
   and stored in player.extra.quests so it saves with the character. */
(function (G) {
  'use strict';

  class QuestLog {
    constructor(game) {
      this.game = game;
      const ev = game.events;
      ev.on('monsterKilled', (m) => {
        const st = this.state();
        if (!st) return;
        for (const id in st.active) {
          const def = this.def(id), a = st.active[id];
          for (const o of def.objectives) if (o.type === 'kill' && o.target === m.type) {
            a.kills = a.kills || {};
            if ((a.kills[o.target] || 0) < o.count) a.kills[o.target] = (a.kills[o.target] || 0) + 1;
          }
        }
        this.check();
      });
      ev.on('mapEntered', (mapId) => {
        const st = this.state();
        if (!st) return;
        for (const id in st.active) if (this.def(id).objectives.some((o) => o.type === 'visit' && o.map === mapId)) st.active[id].visited = (st.active[id].visited || []).concat(mapId);
        this.check();
      });
      ['levelChanged', 'jobChanged', 'statsChanged'].forEach((e) => ev.on(e, () => this.check()));
    }

    state() {
      const p = this.game.player;
      if (!p) return null;
      if (!p.extra.quests) p.extra.quests = { active: {}, done: [] };
      return p.extra.quests;
    }
    def(id) { return G.QUESTS.find((q) => q.id === id); }

    available(giver) {
      const st = this.state(), p = this.game.player;
      return G.QUESTS.filter((q) => (!giver || q.giver === giver) && !st.active[q.id] && !st.done.includes(q.id)
        && p.baseLevel >= q.minLevel && q.req.every((r) => st.done.includes(r)));
    }
    active() {
      const st = this.state();
      return Object.keys(st.active).map((id) => ({ def: this.def(id), st: st.active[id] })).filter((q) => q.def);
    }
    done() { return this.state().done.map((id) => this.def(id)).filter(Boolean); }

    // Objective lines: [{ label, have, need }]
    progress(def, a) {
      const p = this.game.player;
      return def.objectives.map((o) => {
        if (o.type === 'kill') return { label: `Defeat ${G.Config.MONSTERS[o.target].name}${o.count > 1 ? 's' : ''}`, have: (a.kills && a.kills[o.target]) || 0, need: o.count };
        if (o.type === 'item') return { label: `Collect ${G.Items.get(o.id).name}`, have: Math.min(p.inventory.count(o.id), o.count), need: o.count };
        if (o.type === 'baseLevel') return { label: `Reach base level ${o.level}`, have: Math.min(p.baseLevel, o.level), need: o.level };
        if (o.type === 'jobLevel') return { label: `Reach job level ${o.level}`, have: Math.min(p.jobDef.tier > 0 ? o.level : p.jobLevel, o.level), need: o.level };
        if (o.type === 'job') return { label: 'Change to a first job', have: p.jobDef.tier >= o.tier ? 1 : 0, need: 1 };
        if (o.type === 'visit') return { label: `Visit ${G.Maps[o.map].name}`, have: (a.visited || []).includes(o.map) || this.game.mapId === o.map ? 1 : 0, need: 1 };
        return { label: '?', have: 0, need: 1 };
      });
    }
    isComplete(def, a) { return this.progress(def, a).every((l) => l.have >= l.need); }
    readyToTurnIn(giver) { return this.active().filter((q) => q.def.giver === giver && this.isComplete(q.def, q.st)); }

    rewardText(def) {
      const r = def.rewards, bits = [];
      if (r.exp) bits.push(`${Math.round(r.exp * G.Config.QUEST_EXP_RATE)} base EXP`);
      if (r.jobExp) bits.push(`${Math.round(r.jobExp * G.Config.QUEST_EXP_RATE)} job EXP`);
      if (r.zeny) bits.push(`${r.zeny} Zeny`);
      for (const [id, n] of r.items || []) bits.push(`${G.Items.get(id).name} ×${n}`);
      return bits.join(', ');
    }

    accept(id) {
      const st = this.state();
      st.active[id] = {};
      if (this.game.mapId) this.game.events.emit('mapEntered', this.game.mapId);
      this.game.log.add(`Quest accepted: ${this.def(id).name}.`, 'system');
      this.changed();
    }

    turnIn(id) {
      const st = this.state(), def = this.def(id), p = this.game.player, game = this.game;
      if (!st.active[id] || !this.isComplete(def, st.active[id])) return false;
      if (G.Ledger.blocked(game)) return false;
      // Online the server checks the quest and hands out the rewards; the same happens here at once.
      G.Ledger.op('quest', { id });
      G.Ledger.quiet(() => this.giveRewards(def));
      delete st.active[id];
      st.done.push(id);
      game.effects.levelUp(p);
      game.hud.toast(`Quest complete: ${def.name}!`);
      game.sfx('quest');
      game.log.add(`Quest complete: ${def.name}. Rewards: ${this.rewardText(def)}.`, 'level');
      this.changed();
      return true;
    }
    giveRewards(def) {
      const p = this.game.player;
      for (const o of def.objectives) if (o.type === 'item') {
        let left = o.count;
        while (left > 0) { const e = p.inventory.firstOf(o.id); if (!e) break; left -= p.inventory.remove(e.uid, left); }
      }
      const r = def.rewards;
      p.zeny += r.zeny || 0;
      for (const [iid, n] of r.items || []) p.inventory.add(iid, n, { ignoreWeight: true });
      if (r.exp || r.jobExp) p.gainExp(Math.round((r.exp || 0) * G.Config.QUEST_EXP_RATE), Math.round((r.jobExp || 0) * G.Config.QUEST_EXP_RATE));
    }

    abandon(id) { delete this.state().active[id]; this.changed(); }

    // Toast once when a quest becomes ready to turn in.
    check() {
      const st = this.state();
      if (!st) return;
      let changed = false;
      for (const q of this.active()) {
        const ready = this.isComplete(q.def, q.st);
        if (ready && !q.st.ready) {
          q.st.ready = true;
          changed = true;
          const giver = G.NPC_DEFS.find((n) => n.id === q.def.giver);
          this.game.hud.toast(`${q.def.name}: ready! Return to ${giver ? giver.name : 'the quest giver'}.`);
          this.game.log.add(`${q.def.name}: all objectives done. Return to ${giver ? giver.name : 'the quest giver'}.`, 'level');
        } else if (!ready && q.st.ready) { q.st.ready = false; changed = true; }
      }
      if (changed) this.changed(); else this.game.events.emit('questsChanged');
    }

    changed() { this.game.events.emit('questsChanged'); this.game.save.markDirty(); }
  }

  /* Storage: items kept safe in town (300 entries), opened through Hilde. */
  class Storage {
    constructor(game) {
      this.game = game;
      this.mode = 'deposit';
      this.max = 300;
      const h = G.h;
      this.win = game.windows.create('storage', 'Willowmere Storage', { width: 400, pos: () => ({ x: window.innerWidth / 2 - 200, y: 110 }) });
      this.win.render = () => this.render(h);
    }
    get items() { return this.game.player.storage; }
    open() { this.game.windows.open('storage'); this.render(); }

    deposit(uid, qty) {
      const inv = this.game.player.inventory, e = inv.find(uid);
      if (!e) return;
      const item = G.Items.get(e.id);
      if (G.Ledger.blocked(this.game)) return;
      if (item.stack) {
        const have = this.items.find((s) => s.id === e.id);
        if (!have && this.items.length >= this.max) { this.game.log.add('Storage is full.', 'warn'); return; }
        G.Ledger.op('store', { uid, qty });
        const n = G.Ledger.quiet(() => inv.remove(uid, qty));
        if (have) have.qty += n; else this.items.push({ id: e.id, qty: n, cards: [] });
      } else {
        if (this.items.length >= this.max) { this.game.log.add('Storage is full.', 'warn'); return; }
        G.Ledger.op('store', { uid, qty: 1 });
        G.Ledger.quiet(() => inv.remove(uid, 1));
        this.items.push({ id: e.id, qty: 1, cards: (e.cards || []).slice(), refine: e.refine || 0, forgedBy: e.forgedBy, element: e.element });
      }
      this.game.save.markDirty();
      this.render();
    }
    withdraw(index, qty) {
      const s = this.items[index];
      if (!s) return;
      const n = Math.min(qty, s.qty);
      if (G.Ledger.blocked(this.game)) return;
      const r = G.Ledger.quiet(() => this.game.player.inventory.add(s.id, n, { cards: s.cards, refine: s.refine, forgedBy: s.forgedBy, element: s.element }));
      if (r.added) G.Ledger.op('unstore', { i: index, id: s.id, qty: n });
      if (!r.added) { this.game.log.add(r.reason === 'weight' ? 'That would be too heavy to carry.' : 'Your inventory is full.', 'warn'); return; }
      s.qty -= n;
      if (s.qty <= 0) this.items.splice(index, 1);
      this.game.save.markDirty();
      this.render();
    }

    render() {
      if (!this.game.windows.isOpen('storage')) return;
      const p = this.game.player;
      this.win.put = (uid, qty) => this.deposit(uid, qty);
      G.itemGrid(this.game, this.win, { source: 'storage', label: 'Storage', entries: this.items,
        note: 'Drag items here from your inventory, or back again. Double-click takes a whole stack; hold Shift while dragging to choose an amount.',
        take: (i, qty) => this.withdraw(i, qty), count: `${this.items.length} / ${this.max} shelves`, weight: `Your weight ${p.inventory.weight()} / ${p.derived.maxWeight}` });
    }

    update() {
      if (!this.game.windows.isOpen('storage')) return;
      const keeper = this.game.npcs.list.find((n) => n.id === 'storage_keeper');
      if (!keeper || this.game.player.distanceTo(keeper) > 8) this.game.windows.close('storage');
    }
  }

  G.QuestLog = QuestLog;
  G.Storage = Storage;
})(window.G = window.G || {});
