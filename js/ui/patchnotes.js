/* Patch notes: every update so far (newest first), a window listing them,
   and a small "What's new" popup when there's a patch you haven't seen.
   Dates are approximate (when each update was delivered). */
(function (G) {
  'use strict';
  const h = G.h;

  const PATCHES = [
    { v: '0.30', date: '2026-11-08T19:00', title: 'Ground painting fixed; paths and streets editable', notes: [
      'Fixed: ground paint could show the wrong texture or turn black (most of all after a map reloaded). Textures now always show correctly, with soft edges between them.',
      'Painting a different texture over paint now replaces it straight away.',
      'Map editor: “Make paths and streets paintable” turns a map’s dirt paths, town plaza and streets into ground paint, so you can erase, move or extend them. Grass and flowers don’t grow on painted paths, stone or sand.',
    ] },
    { v: '0.29', date: '2026-11-08T15:00', title: 'Saved maps always load', notes: [
      'Fixed: maps could appear without their editor changes after starting the game (when the server was slow to wake up). The game now keeps trying to load saved maps and rebuilds the map you’re on as soon as they arrive.',
    ] },
    { v: '0.28', date: '2026-11-08T12:00', title: 'Map editor: ground painting, bridges, everything editable', notes: [
      'Ground painting: paint grass, dark grass, dirt path, cobblestone, sand, stone tiles, dead grass, graveyard soil, cursed ground, mud and snow with a brush, or erase paint to bring the original ground back.',
      'Bridges to place: wooden, stone, rope bridge and boardwalk. Players walk on them, over water too.',
      'Making a map’s originals editable now covers everything: the town gate and its sign, the wooden spike wall (as segments), the river bridge, and every rock, boulder, bush and berry bush. Original pieces can be placed again from “From this map”.',
      'NPCs show an arrow on the ground for the way they face, and turn live when you rotate them.',
    ] },
    { v: '0.27', date: '2026-11-07T18:00', title: 'Map editor: ground tools and original objects', notes: [
      'Ground tab: raise, lower, smooth and flatten the ground with a brush (adjustable size and strength). Walking follows the new shape after saving.',
      'Maps’ original houses, trees, props, monster spawns (training dummies too), warps and NPCs can now be made editable: move, rotate or delete them. NPCs keep their shops, quests and dialog.',
      'While editing, the action bar, character window and debug buttons are hidden; a bar shows the keys and live coordinates of you and your cursor.',
      '“Remember this spot” makes setting a warp’s destination easy: stand where players should arrive, remember it, then use it on the warp.',
      'Admins have a Teleport button that lists every map.',
      'More to place: autumn, golden, dark oak, birch, willow, palm, dead and frosted trees, saplings, stumps, logs, berry bushes, hedges, ferns, tall grass, tulips, sunflowers, lavender, daisies, roses, mushrooms, pebbles, pillars, hay bales, carts and tents.',
      'Easier to read: dark text in the editor’s boxes. If a map ever fails to load, the game no longer gets stuck on a faded screen.',
    ] },
    { v: '0.26', date: '2026-11-07T12:00', title: 'Map editor for admins', notes: [
      'New: a map editor for admins (F10 or the Map editor button). Place trees, houses, fountains, market stalls, lamps, fences, rocks, crystals and more, or your own uploaded 3D models (.glb).',
      'Place entities too: warps between maps, lights, monster spawns, NPCs with their own lines, and player start points.',
      'Arrow keys nudge, Page Up/Down raise and lower, Q/E rotate, +/- scale, G grabs, Delete removes, Ctrl+D copies and Ctrl+Z undoes.',
      'Maps can grow in any direction and new maps can be created. Saving updates the map live for every player on it.',
      'The minimap and the grass and flowers now follow a map’s real size.',
    ] },
    { v: '0.25', date: '2026-11-06T10:30', title: 'Patch notes and guild rank taxes', notes: [
      'New: patch notes! A “What’s new” popup appears when there has been an update since you last played, and every patch is listed under Options → Patch notes (Esc opens Options when nothing else is open) or the Patch notes button on the menu.',
      'Guilds: each rank now has its own EXP tax (0–50%), set by the Guild Leader. Add your own ranks (up to 8), for example a “TAX” rank at 50%.',
      'Guilds: the guild EXP bar now updates within a few seconds of members’ donations.',
      'Trading: closing the trade window in any way (Cancel, the ✕ or Esc) now closes it for both players.',
    ] },
    { v: '0.24', date: '2026-11-05T22:45', title: 'Inspect, emblems and trading fixes', notes: [
      'Guild emblems: pink (#FF00FF) is now transparent, like the classics, including the pinkish fringe of shrunken pictures.',
      'Inspect gear now looks just like your own Equipment window, with the player’s portrait, gear, ATK/DEF/MATK/MDEF/ASPD and their stats.',
      'Trade window is wider so all slots fit, and opens beside your inventory.',
      'Right-clicking an inventory item now puts it in the open trade, storage or cart.',
    ] },
    { v: '0.23', date: '2026-11-05T22:20', title: 'Shared loot on the ground', notes: [
      'Everyone on a map now sees the same items on the ground.',
      'Monster drops belong to the killer (and their party) for 5 seconds, then anyone can take them. Items vanish after 60 seconds.',
      'Dropped gear keeps its refine level, cards and forged name. Pickups are decided by the server: first come, first served.',
    ] },
    { v: '0.22', date: '2026-11-05T21:40', title: 'Spells for everyone, trading and guild ranks', notes: [
      'Other players now see exactly the same spell effects as the caster, and see your level-ups.',
      'Fixed: the cast “pentagram” circle could get stuck on a player and follow them across maps.',
      'Right-click another player: invite to party, invite to guild, inspect gear, or trade.',
      'Trading like the classics: offer items and Zeny, press OK to lock, then both press Trade.',
      'Balance: level 50+ monsters hit noticeably softer.',
      'Guilds: name tags show the emblem on the left with “Name [Party]” and “Guild [Rank]”; ranks Guild Leader / Officer / Member / Newbie with editable names; guild levels from EXP tax; guild skills (Guild’s Glory, Extension, Great Leadership, Glorious Wounds, Cold Heart, Sharp Gaze, Regeneration, Emergency Call).',
    ] },
    { v: '0.21', date: '2026-11-05T17:50', title: 'Health bars for everyone', notes: [
      'Everyone’s HP bar is now visible to all players; SP only to your party members.',
    ] },
    { v: '0.20', date: '2026-11-05T16:45', title: 'Monster sync fixes', notes: [
      'Fixed: monsters sometimes stood away from their spawns, or ran home when hit, after players changed maps.',
      'Every player’s game now agrees where each monster lives, messages from other maps are ignored, and monsters stop chasing players who leave.',
    ] },
    { v: '0.19', date: '2026-11-05T11:00', title: 'Quest fix', notes: [
      'Fixed: the “Into the Hollow” quest went back to 0/1 after leaving Mossy Hollow.',
    ] },
    { v: '0.18', date: '2026-11-05T10:00', title: 'Orc Dungeon, Ember Ruins, parties and guilds', notes: [
      'New maps: the Orc Dungeon (from the west of Whisperwood Glade) and the Ember Ruins (levels 50–94).',
      'New monsters from level 24 to 94, map bosses (Eclipse, Vocal, Marin) and MVPs (King Poring, Orc Lord, Dark Lord, Lord of Death).',
      'Monster levels rebalanced toward the classics; every item now lives in the server’s database, which the Database page reads.',
      'Parties (Alt+Z) with EXP and item sharing, and guilds (Alt+G) founded with an Emperium, with guild emblems.',
      'Storage and cart now look like your inventory, with drag and drop.',
    ] },
    { v: '0.17', date: '2026-11-04T22:00', title: 'Shared world', notes: [
      'Online, everyone now sees the same monsters, with the same HP and statuses.',
      'You can see other players’ cast bars and spell effects, and buff each other.',
      'Merchant carts are visible to everyone. Many skills are now ground-targeted, as in the classics.',
      'New male hairstyles, a menu hide toggle, monster buffs/debuffs under the target window, and stat points matching the classics.',
    ] },
    { v: '0.16', date: '2026-11-04T16:00', title: 'New login screen', notes: [
      'A redesigned login and register screen.',
    ] },
    { v: '0.15', date: '2026-11-04T13:30', title: 'Online multiplayer', notes: [
      'Play online: register and log in, with characters, items and storage saved in the database.',
      'See other players moving and chat with them (press Enter).',
    ] },
    { v: '0.14', date: '2026-11-04T11:00', title: 'Database page updates', notes: [
      'The Database page has its own “Give Zeny” tab and a new filter order.',
    ] },
    { v: '0.13', date: '2026-11-04T10:00', title: 'Character select', notes: [
      'Up to 15 characters per player, with a character select screen.',
    ] },
    { v: '0.12', date: '2026-11-04T09:00', title: 'Monk combos and training dummies', notes: [
      'Monk combos follow Raging Trifecta Blow; Snap is ground-targeted; you can’t summon more spirit spheres than you can hold.',
      'Training dummies in town for testing skills.',
      'Second-job points can be spent in the first-job tree; passive skills can’t go on the action bar.',
    ] },
    { v: '0.11', date: '2026-11-04T08:00', title: 'Skill points rework', notes: [
      'Skill points are kept per job (Novice, first job, second job), and earlier jobs’ points must be spent first.',
      'Plan skills and press Confirm; missing prerequisites are added for you.',
      'Ruwach, Pneuma and Teleportation now work like the classics.',
    ] },
    { v: '0.10', date: '2026-11-04T07:00', title: 'Reset NPC', notes: [
      'Elda resets stats and skills for free. You must spend all skill points before changing jobs; Basic Training stays at 9.',
    ] },
    { v: '0.9', date: '2026-11-04T06:00', title: 'Full skill trees and class looks', notes: [
      'Every class has its full classic skill tree with the original prerequisites.',
      'Every class now has its own look: capes, helmets, hoods, mounts, falcons and more.',
    ] },
    { v: '0.8', date: '2026-11-04T04:00', title: 'Database Zeny tool', notes: [
      'The Database page can send Zeny to a character.',
    ] },
    { v: '0.7', date: '2026-11-04T03:00', title: 'Second jobs and refining', notes: [
      'Second jobs for every first job, with new skills and weapon types.',
      'Refining up to +10 at Bram, card name prefixes and suffixes, rebindable keys and more EXP.',
    ] },
    { v: '0.6', date: '2026-11-04T01:00', title: 'Sound, cast times and the minimap', notes: [
      'Sound effects and music, cast bars with cast times, a minimap and world map, and “Sell all” at shops.',
    ] },
    { v: '0.5', date: '2026-11-03T23:30', title: 'Card labels', notes: [
      'Cards show which equipment slot they go into; the Database page can filter by slot.',
    ] },
    { v: '0.4', date: '2026-11-03T21:00', title: 'Cards, NPCs and Mossy Hollow', notes: [
      'Monster cards and card slots, new town NPCs, the quest log, and the Mossy Hollow dungeon with the King Poring.',
      'Shift-compare for gear, visible headgear and targeted Heal.',
    ] },
    { v: '0.3', date: '2026-11-03T17:00', title: 'Jobs and skills', notes: [
      'Job changes to the six first jobs, with their skills, and the Whisperwood Glade.',
    ] },
    { v: '0.2', date: '2026-11-03T14:00', title: 'Characters and items', notes: [
      'Character creation, stats, inventory, equipment, the hotbar, shops and saving.',
    ] },
    { v: '0.1', date: '2026-11-03T10:00', title: 'The first version', notes: [
      'The town of Willowmere and its meadows, the camera, movement and fighting Porings.',
    ] },
  ];
  const LATEST = PATCHES[0].v;
  const KEY = 'willowmere.seenPatch';
  const fmt = (iso) => new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const PatchNotes = {
    PATCHES, LATEST,
    init(game) {
      this.game = game;
      this.win = game.windows.create('patchnotes', 'Patch notes', { width: 460, pos: () => ({ x: window.innerWidth / 2 - 230, y: 70 }) });
      this.win.render = () => this.render();
    },
    open() { this.game.windows.open('patchnotes'); this.render(); },
    render() {
      const b = this.win.body;
      b.textContent = '';
      const list = h('div.pn-list');
      PATCHES.forEach((p, i) => {
        const d = h('details.pn' + (i === 0 ? '.latest' : ''), { open: i === 0 },
          h('summary', null, h('b', { text: `v${p.v}` }), h('span', { text: p.title }), h('small', { text: fmt(p.date) })),
          h('ul', null, ...p.notes.map((n) => h('li', { text: n }))));
        list.append(d);
      });
      b.append(list);
    },
    // Popup when there is a patch you haven't seen yet.
    checkNew() {
      let seen = null;
      try { seen = localStorage.getItem(KEY); } catch (e) { /* ignore */ }
      try { localStorage.setItem(KEY, LATEST); } catch (e) { /* ignore */ }
      if (seen === LATEST) return;
      const unseen = seen ? PATCHES.slice(0, Math.max(1, PATCHES.findIndex((p) => p.v === seen))) : [PATCHES[0]];
      const W = this.game.windows;
      const w = this.popup || (this.popup = W.create('patchnew', 'What’s new', { width: 380, pos: () => ({ x: window.innerWidth / 2 - 190, y: 110 }) }));
      w.body.textContent = '';
      // The notes scroll; the buttons below always stay in view.
      const scroll = h('div.pn-scroll');
      w.body.append(scroll);
      for (const p of unseen.slice(0, 3)) {
        scroll.append(h('div.pn-new', null, h('div.pn-head', null, h('b', { text: `v${p.v}: ${p.title}` }), h('small', { text: fmt(p.date) })),
          h('ul', null, ...p.notes.map((n) => h('li', { text: n })))));
      }
      if (unseen.length > 3) scroll.append(h('p.hint', { text: `…and ${unseen.length - 3} more update${unseen.length - 3 > 1 ? 's' : ''}.` }));
      w.body.append(h('div.opt-btns', null,
        h('button.btn.small', { type: 'button', onclick: () => W.close('patchnew') }, 'OK'),
        h('button.btn.small.ghost', { type: 'button', onclick: () => { W.close('patchnew'); this.open(); } }, 'All patch notes')));
      W.open('patchnew');
    },
  };
  G.PatchNotes = PatchNotes;
})(window.G = window.G || {});
