/* Global game configuration. All tunable numbers live here so later stages
   (stats, jobs, items) can override them without touching system code. */
(function (G) {
  'use strict';

  // Must run before any THREE.Color is created anywhere: hex colours are
  // authored in sRGB and converted to linear for correct lighting.
  THREE.ColorManagement.legacyMode = false;

  const expTable = [0];
  for (let lv = 1; lv < 100; lv++) expTable[lv] = Math.round(10 + 6 * lv + 2.2 * lv * lv);

  G.Config = {
    WORLD_SIZE: 240,            // world spans -120..120 on X and Z
    NAV_CELL: 0.5,              // navigation grid resolution (world units)
    AGENT_RADIUS: 0.45,         // obstacles are inflated by this for pathing
    WATER_LEVEL: -0.55,
    PX_PER_UNIT: 55,            // sprite pixels per world unit
    SKY_HORIZON: '#dceef5',
    DB_URL: 'db.html',          // monster & item database page (build script may replace this)     // shared by sky dome and fog so the horizon blends

    TOWN: { cx: 0, cz: -72, radius: 36, name: 'Willowmere' },
    FIELD_NAME: 'Willowmere Meadows',
    BRIDGE: { x: 0, halfWidth: 2.6, halfLength: 7.5 },

    PLAYER: {
      name: 'Adventurer',
      job: 'Novice',
      speed: 5.6,
      radius: 0.45,
      regenDelay: 4,              // seconds out of combat before HP/SP recover
      respawn: { x: 0, z: -60 },
    },

    CAMERA: {
      fov: 45,
      minDist: 5, maxDist: 42, defaultDist: 17,
      minPitch: 0.1, maxPitch: 1.38, defaultPitch: 0.68, defaultYaw: 0.55,
      rotSens: 0.0055, pitchSens: 0.0042, zoomSens: 0.0016,
      focusHeight: 1.25,
    },

    MONSTERS: {
      poring: {
        name: 'Poring', level: 1, hp: 52, atk: [3, 6], def: 0, softDef: 0, mdef: 0, hit: 8, flee: 2, element: 'water',
        speed: 1.9, chaseSpeed: 3.0, exp: 6, jobExp: 5,
        attackRange: 1.25, attackInterval: 1.7, impactTime: 0.3,
        respawn: 7, leash: 26, hitRadius: 0.85, height: 1.15, radius: 0.55, scale: 1.3,
        deathColor: [1.0, 0.55, 0.7],
        // Independent chance per kill (0.7 = 70%).
        drops: [
          { id: 'card_poring', chance: 0.002 },
          { id: 'jellopy', chance: 0.7 }, { id: 'empty_bottle', chance: 0.15 }, { id: 'apple', chance: 0.12 },
          { id: 'sticky_mucus', chance: 0.05 }, { id: 'red_potion', chance: 0.03 }, { id: 'knife', chance: 0.01 },
          { id: 'cotton_shirt', chance: 0.01 }, { id: 'ribbon', chance: 0.004 }, { id: 'jelly_brooch', chance: 0.003 },
        ],
        zeny: { chance: 0.5, min: 2, max: 9 },
      },
      lunatic: {
        name: 'Lunatic', level: 3, hp: 68, atk: [5, 9], def: 2, softDef: 1, mdef: 0, hit: 15, flee: 9, element: 'neutral',
        speed: 2.6, chaseSpeed: 4.0, exp: 11, jobExp: 8,
        attackRange: 1.3, attackInterval: 1.25, impactTime: 0.22,
        respawn: 9, leash: 26, hitRadius: 0.75, height: 1.6, radius: 0.55, scale: 1.12,
        deathColor: [1.0, 1.0, 1.0],
        drops: [
          { id: 'phracon', chance: 0.02 }, 
          { id: 'card_lunatic', chance: 0.002 },
          { id: 'clover', chance: 0.65 }, { id: 'fluff', chance: 0.45 }, { id: 'carrot', chance: 0.15 },
          { id: 'red_potion', chance: 0.04 }, { id: 'sandals', chance: 0.008 }, { id: 'hood', chance: 0.006 },
          { id: 'lucky_clover', chance: 0.006 }, { id: 'round_glasses', chance: 0.004 }, { id: 'clover_charm', chance: 0.004 },
          { id: 'moonbunny_ears', chance: 0.004 }, { id: 'wind_clip', chance: 0.003 },
        ],
        zeny: { chance: 0.55, min: 4, max: 14 },
      },
      drops: {
        name: 'Drops', level: 3, hp: 60, atk: [6, 10], def: 0, softDef: 0, mdef: 0, hit: 14, flee: 6, element: 'fire',
        speed: 2.0, chaseSpeed: 3.2, exp: 9, jobExp: 7,
        attackRange: 1.25, attackInterval: 1.6, impactTime: 0.3,
        respawn: 8, leash: 26, hitRadius: 0.85, height: 1.15, radius: 0.55, scale: 1.3, deathColor: [1, 0.7, 0.35],
        drops: [
          { id: 'card_drops', chance: 0.002 },
          { id: 'jellopy', chance: 0.6 }, { id: 'apple', chance: 0.12 }, { id: 'empty_bottle', chance: 0.12 },
          { id: 'orange_potion', chance: 0.02 }, { id: 'sticky_mucus', chance: 0.05 }, { id: 'jelly_brooch', chance: 0.004 },
        ],
        zeny: { chance: 0.55, min: 4, max: 12 },
      },
      fabre: {
        name: 'Fabre', level: 2, hp: 63, atk: [5, 8], def: 2, softDef: 1, mdef: 0, hit: 12, flee: 8, element: 'earth',
        speed: 1.4, chaseSpeed: 2.4, exp: 8, jobExp: 6,
        attackRange: 1.3, attackInterval: 1.6, impactTime: 0.25,
        respawn: 8, leash: 24, hitRadius: 0.8, height: 1.0, radius: 0.6, scale: 1.2, deathColor: [0.6, 0.9, 0.4],
        drops: [
          { id: 'phracon', chance: 0.03 }, 
          { id: 'card_fabre', chance: 0.002 },
          { id: 'fluff', chance: 0.5 }, { id: 'clover', chance: 0.3 }, { id: 'green_herb', chance: 0.15 },
          { id: 'fly_wing', chance: 0.03 }, { id: 'hood', chance: 0.005 },
        ],
        zeny: { chance: 0.5, min: 3, max: 10 },
      },
      pupa: {
        name: 'Pupa', level: 4, hp: 300, atk: [0, 0], def: 35, softDef: 4, mdef: 10, hit: 1, flee: 0, element: 'earth',
        speed: 0, chaseSpeed: 0, exp: 18, jobExp: 14, noAttack: true,
        attackRange: 0, attackInterval: 99, impactTime: 0,
        respawn: 10, leash: 99, hitRadius: 0.8, height: 1.5, radius: 0.6, scale: 1.2, deathColor: [0.95, 0.85, 0.55],
        drops: [
          { id: 'card_pupa', chance: 0.002 },
          { id: 'chrysalis', chance: 0.55 }, { id: 'sticky_mucus', chance: 0.1 }, { id: 'silk_robe', chance: 0.006 },
          { id: 'guard', chance: 0.006 },
        ],
        zeny: { chance: 0.4, min: 6, max: 18 },
      },
      rocker: {
        name: 'Rocker', level: 8, hp: 190, atk: [12, 17], def: 4, softDef: 3, mdef: 0, hit: 28, flee: 20, element: 'earth',
        speed: 2.6, chaseSpeed: 4.2, exp: 26, jobExp: 20,
        attackRange: 1.35, attackInterval: 1.3, impactTime: 0.25,
        respawn: 10, leash: 26, hitRadius: 0.8, height: 1.7, radius: 0.6, scale: 1.15, deathColor: [0.55, 0.85, 0.3],
        drops: [
          { id: 'elunium', chance: 0.008 }, 
          { id: 'card_rocker', chance: 0.002 },
          { id: 'grasshopper_leg', chance: 0.6 }, { id: 'green_herb', chance: 0.15 }, { id: 'red_potion', chance: 0.05 },
          { id: 'leaf_cap', chance: 0.006 }, { id: 'adventurer_suit', chance: 0.004 },
        ],
        zeny: { chance: 0.6, min: 10, max: 26 },
      },
      poporing: {
        name: 'Poporing', level: 10, hp: 250, atk: [14, 20], def: 5, softDef: 4, mdef: 10, hit: 24, flee: 14, element: 'earth',
        speed: 1.9, chaseSpeed: 3.2, exp: 34, jobExp: 26,
        attackRange: 1.3, attackInterval: 1.5, impactTime: 0.3,
        respawn: 11, leash: 26, hitRadius: 0.85, height: 1.25, radius: 0.55, scale: 1.3, deathColor: [0.6, 0.95, 0.5],
        drops: [
          { id: 'elunium', chance: 0.01 }, { id: 'phracon', chance: 0.05 }, 
          { id: 'card_poporing', chance: 0.002 },
          { id: 'sticky_mucus', chance: 0.4 }, { id: 'jellopy', chance: 0.5 }, { id: 'green_herb', chance: 0.2 },
          { id: 'orange_potion', chance: 0.04 }, { id: 'jelly_brooch', chance: 0.008 },
        ],
        zeny: { chance: 0.6, min: 12, max: 30 },
      },
      training_dummy: {
        name: 'Training Dummy', level: 1, hp: 99999999, atk: [0, 0], def: 0, softDef: 0, mdef: 0, hit: 1, flee: 0, element: 'neutral',
        speed: 0, chaseSpeed: 0, exp: 0, jobExp: 0, noAttack: true, immortal: true, immovable: true,
        attackRange: 0, attackInterval: 99, impactTime: 0,
        respawn: 5, leash: 99, hitRadius: 0.8, height: 2.0, radius: 0.6, scale: 1.25, deathColor: [0.8, 0.65, 0.4],
        drops: [], zeny: { chance: 0, min: 0, max: 0 },
      },
      familiar: {
        name: 'Familiar', level: 9, hp: 170, atk: [12, 18], def: 3, softDef: 2, mdef: 0, hit: 30, flee: 22, element: 'shadow',
        speed: 3.2, chaseSpeed: 4.6, exp: 30, jobExp: 22, aggressive: true, aggroRange: 7, flying: true,
        attackRange: 1.3, attackInterval: 1.1, impactTime: 0.2,
        respawn: 10, leash: 24, hitRadius: 0.75, height: 1.9, radius: 0.5, scale: 1.1, deathColor: [0.55, 0.45, 0.7],
        drops: [
          { id: 'elunium', chance: 0.01 }, 
          { id: 'card_familiar', chance: 0.002 }, { id: 'bat_wing', chance: 0.6 }, { id: 'red_potion', chance: 0.06 },
          { id: 'miner_lamp', chance: 0.006 },
        ],
        zeny: { chance: 0.6, min: 12, max: 28 },
      },
      spore: {
        name: 'Spore', level: 10, hp: 290, atk: [14, 20], def: 8, softDef: 4, mdef: 5, hit: 22, flee: 12, element: 'water',
        speed: 1.7, chaseSpeed: 2.8, exp: 36, jobExp: 28,
        attackRange: 1.3, attackInterval: 1.5, impactTime: 0.3,
        respawn: 11, leash: 24, hitRadius: 0.8, height: 1.5, radius: 0.6, scale: 1.2, deathColor: [0.9, 0.5, 0.4],
        drops: [
          { id: 'elunium', chance: 0.02 }, 
          { id: 'card_spore', chance: 0.002 }, { id: 'spore_cap', chance: 0.55 }, { id: 'green_herb', chance: 0.2 },
          { id: 'orange_potion', chance: 0.05 }, { id: 'leaf_cap', chance: 0.005 },
        ],
        zeny: { chance: 0.6, min: 15, max: 32 },
      },
      whisper: {
        name: 'Whisper', level: 12, hp: 230, atk: [16, 22], def: 0, softDef: 0, mdef: 20, hit: 35, flee: 45, element: 'ghost',
        speed: 2.6, chaseSpeed: 3.8, exp: 48, jobExp: 38, aggressive: true, aggroRange: 8, flying: true,
        attackRange: 1.4, attackInterval: 1.3, impactTime: 0.25,
        respawn: 12, leash: 24, hitRadius: 0.8, height: 1.9, radius: 0.55, scale: 1.15, deathColor: [0.85, 0.9, 1],
        drops: [
          { id: 'elunium', chance: 0.03 }, { id: 'oridecon', chance: 0.01 }, 
          { id: 'card_whisper', chance: 0.002 }, { id: 'ectoplasm', chance: 0.5 }, { id: 'blue_potion', chance: 0.04 },
          { id: 'hood', chance: 0.01 },
        ],
        zeny: { chance: 0.6, min: 18, max: 40 },
      },
      king_poring: {
        name: 'King Poring', level: 15, hp: 2600, atk: [26, 38], def: 10, softDef: 6, mdef: 15, hit: 40, flee: 18, element: 'water',
        speed: 1.6, chaseSpeed: 2.6, exp: 900, jobExp: 650, boss: { slamEvery: 7, slamRadius: 3.4, slamDamage: [35, 55] },
        attackRange: 2.2, attackInterval: 1.8, impactTime: 0.35,
        respawn: 120, leash: 30, hitRadius: 2.0, height: 3.2, radius: 1.5, scale: 2.7, deathColor: [1, 0.85, 0.3],
        drops: [
          { id: 'elunium', chance: 0.6, qty: 2 }, { id: 'oridecon', chance: 0.4 }, 
          { id: 'card_king_poring', chance: 0.05 }, { id: 'royal_jelly', chance: 0.8 }, { id: 'jelly_crown', chance: 0.12 },
          { id: 'jelly_brooch', chance: 0.25 }, { id: 'jellopy', chance: 1, qty: 10 }, { id: 'wand', chance: 0.1 }, { id: 'composite_bow', chance: 0.1 },
        ],
        zeny: { chance: 1, min: 400, max: 800 },
      },
    },

    SPAWNS: [
      { type: 'poring', x: -8, z: 8, r: 13, count: 6 },
      { type: 'poring', x: -38, z: 40, r: 15, count: 6 },
      { type: 'poring', x: 14, z: 62, r: 14, count: 4 },
      { type: 'lunatic', x: 40, z: 16, r: 14, count: 5 },
      { type: 'lunatic', x: 28, z: 82, r: 15, count: 4 },
      { type: 'lunatic', x: -56, z: 78, r: 13, count: 3 },
    ],

    EXP_TABLE: expTable,
    EXP_RATE: 1.8,          // multiplier on monster base/job EXP
    QUEST_EXP_RATE: 2,      // multiplier on quest EXP rewards

    // Attack element -> defending element damage multiplier (missing = 1).
    ELEMENTS: {
      fire: { water: 0.5, earth: 1.5, fire: 0.25 },
      water: { fire: 1.5, water: 0.25, wind: 0.5 },
      wind: { water: 1.75, earth: 0.5, wind: 0.25 },
      earth: { wind: 1.5, fire: 0.5, earth: 0.25 },
      ghost: { ghost: 1.25 },
      poison: { poison: 0, earth: 1.25 },
      neutral: { ghost: 0.5 },         // ordinary hits only half-connect with ghosts
      holy: { ghost: 1.5, shadow: 2 },
    },
    MAX_LEVEL: 99,
  };
})(window.G = window.G || {});
