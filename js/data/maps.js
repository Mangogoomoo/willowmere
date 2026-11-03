/* Map definitions. The terrain, scenery, monsters, NPCs and portals of each
   map are generated from these settings when you travel there.

   paths     dirt roads (polylines); also flattened and kept clear of trees
   town      true if the Willowmere town sits on this map
   stream    the stream with its bridge (meadow only)
   pond      { x, z, r } or null
   hills     height of the rolling hills;  seed shifts the noise
   forest    tree placement: { count, grove } (grove = how clumped)
   palette   ground colours
   spawns    monster spawn areas
   portals   walk-in gates to other maps: { x, z, to, tx, tz, label } */
(function (G) {
  'use strict';

  G.Maps = {
    meadow: {
      id: 'meadow', name: 'Willowmere Meadows', town: true, stream: true, bridge: true,
      paths: [
        [[0, -30], [0, -14], [-3, -4], [-6, 10], [-4, 28], [6, 46], [8, 66], [0, 88], [-4, 106]],
        [[-4, 28], [16, 26], [36, 22], [58, 26], [80, 34], [96, 40]],
        [[-6, 10], [-26, 16], [-44, 30], [-54, 52], [-58, 74], [-66, 96]],
      ],
      pond: { x: 46, z: 56, r: 9 },
      hills: 10, seed: 0,
      forest: { count: 230, grove: 0.42, clearing: 0.55 },
      palette: {},
      spawns: [
        { type: 'poring', x: -8, z: 8, r: 13, count: 6 },
        { type: 'poring', x: -38, z: 40, r: 15, count: 6 },
        { type: 'poring', x: 14, z: 62, r: 14, count: 4 },
        { type: 'lunatic', x: 40, z: 16, r: 14, count: 5 },
        { type: 'lunatic', x: 28, z: 82, r: 15, count: 4 },
        { type: 'lunatic', x: -56, z: 78, r: 13, count: 3 },
      ],
      npcs: ['job_master', 'tool_dealer', 'weapon_dealer', 'armor_dealer', 'storage_keeper', 'innkeeper', 'tutor', 'quest_giver', 'pond_priestess'],
      portals: [{ x: -4, z: 99, to: 'forest', tx: 0, tz: -97, label: 'Whisperwood Glade' }],
    },

    forest: {
      id: 'forest', name: 'Whisperwood Glade', town: false, stream: false, bridge: false,
      paths: [
        [[0, -108], [2, -82], [-8, -58], [-20, -32], [-10, -6], [8, 20], [24, 46], [18, 72], [0, 96]],
        [[-10, -6], [-38, 0], [-60, 16], [-70, 44]],
        [[8, 20], [40, 10], [64, -12], [82, -40]],
        [[24, 46], [50, 58], [76, 70]],
      ],
      pond: { x: -46, z: 42, r: 8 },
      hills: 13, seed: 517,
      forest: { count: 1100, grove: 0.3, clearing: 0.8, giants: true },
      palette: {
        grassA: '#5ea84a', grassB: '#79bd57', grassDark: '#3f7f3a', meadow: '#a4c860',
        town: '#5ea84a', dirt: '#a07c54', dirtDark: '#80623f', cliff: '#7d8c66', cliffHi: '#4f7a45',
      },
      fog: '#d3e9dc',
      spawns: [
        { type: 'fabre', x: -10, z: -64, r: 13, count: 6 },
        { type: 'pupa', x: 18, z: -38, r: 11, count: 5 },
        { type: 'drops', x: -32, z: -18, r: 12, count: 5 },
        { type: 'fabre', x: 22, z: 26, r: 13, count: 5 },
        { type: 'rocker', x: -50, z: 14, r: 13, count: 5 },
        { type: 'poporing', x: 44, z: 62, r: 14, count: 5 },
        { type: 'rocker', x: 62, z: -18, r: 13, count: 4 },
        { type: 'pupa', x: -18, z: 70, r: 11, count: 4 },
      ],
      npcs: [],
      portals: [
        { x: 0, z: -104, to: 'meadow', tx: -4, tz: 94, label: 'Willowmere Meadows' },
        { x: 84, z: -42, to: 'dungeon', tx: 0, tz: -86, label: 'Mossy Hollow' },
      ],
    },

    // The beginner dungeon: corridors and rooms carved out of solid rock.
    dungeon: {
      id: 'dungeon', name: 'Mossy Hollow', cave: true, town: false, stream: false, bridge: false,
      paths: [
        [[0, -96], [0, -72], [-20, -56], [-40, -40], [-46, -16], [-30, 5], [0, 10], [25, 0], [45, -20], [60, -44]],
        [[0, 10], [6, 34], [0, 58], [0, 80]],
        [[-30, 5], [-55, 25], [-62, 48]],
      ],
      corridor: 3.4,
      rooms: [
        { x: 0, z: -90, r: 9 }, { x: -40, z: -40, r: 10 }, { x: 25, z: 0, r: 8 }, { x: 52, z: -34, r: 10 },
        { x: -62, z: 48, r: 10 }, { x: 0, z: 86, r: 16 },
      ],
      pond: null, hills: 0, seed: 911,
      forest: { count: 0, grove: 1, clearing: 1 },
      palette: { floor: '#7d7366', floorDark: '#625a50', wall: '#4b4540', moss: '#5f7a4a' },
      atmosphere: { fog: '#15131c', near: 18, far: 95, hemi: 0.42, sun: 0.38, sky: ['#05040a', '#0d0b14', '#15131c'], ground: '#2a2420' },
      spawns: [
        { type: 'familiar', x: -20, z: -56, r: 6, count: 3 },
        { type: 'familiar', x: -40, z: -40, r: 8, count: 4 },
        { type: 'spore', x: -46, z: -16, r: 5, count: 3 },
        { type: 'spore', x: 25, z: 0, r: 6, count: 4 },
        { type: 'familiar', x: 52, z: -34, r: 8, count: 3 },
        { type: 'whisper', x: 52, z: -34, r: 8, count: 2 },
        { type: 'whisper', x: -62, z: 48, r: 8, count: 4 },
        { type: 'spore', x: 4, z: 40, r: 4, count: 3 },
        { type: 'king_poring', x: 0, z: 90, r: 5, count: 1 },
      ],
      npcs: [],
      portals: [{ x: 0, z: -97, to: 'forest', tx: 80, tz: -38, label: 'Whisperwood Glade' }],
    },
  };
})(window.G = window.G || {});
