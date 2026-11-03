# Willowmere — Stages 1–3: Core, Character Systems and Jobs

A 2.5D browser MMORPG prototype inspired by classic Ragnarok Online:
a fully 3D low-poly world with 2D sprite characters, a free 360° camera and
click-to-move / click-to-attack combat. All art is original and generated
procedurally at startup (no external image assets).

## Run it

**Easiest:** double-click `index.html`. It runs straight from disk in Chrome,
Edge or Firefox — no server, no install, no internet needed (three.js is
included in `lib/`). The rounded "Fredoka" font loads from Google Fonts when
online and falls back to a system font offline.

**Optional local server** (if your browser blocks local files):

    python -m http.server 8000      # then open http://localhost:8000

**Single-file build:** `python tools/build_single_file.py` writes
`dist/willowmere.html` (three.js from CDN). Add `--offline` to inline it too.

## Controls

| Input | Action |
|---|---|
| Left click ground | Walk there (hold the button to keep walking toward the cursor) |
| Left click monster | Select it, walk up, auto-attack until it dies |
| Right drag | Orbit 360° and tilt the camera |
| Mouse wheel | Zoom |
| Home / middle click | Reset elevation and zoom |
| Left click item on ground | Walk over and pick it up |
| F1–F9 or 1–9 | Use hotbar slot |
| Alt+A or C | Status window (spend stat points) |
| Alt+E or I | Inventory |
| Alt+Q or Q | Equipment |
| Alt+S or K | Skills (learn skills, drag them to the hotbar) |
| Left click NPC | Walk over and talk |
| L | Toggle auto-loot |
| ` (backquote) | Show or hide the debug tools |
| O | Options (camera, auto-loot, debug tools, save, delete character) |
| Esc | Close the top window, or clear target |
| H | Show or hide the controls panel |

## What's in Stage 1

- **World:** one continuous 240×240 map. Willowmere town (plaza, fountain,
  12 houses, market stalls, palisade and gate) north of a stream; a wooden
  bridge leads south into Willowmere Meadows (hills, groves, pond, flowers,
  wind-swayed grass, forest edge). Directional sun with shadows that follow
  the player, hemisphere light, fog, sky dome, clouds, distant mountains.
- **Sprites:** Novice, Poring and Lunatic, each rendered from a small 3D rig
  into 8-direction sprite sheets (idle, walk, attack, hit, death). Sprites are
  screen-aligned billboards anchored at the feet, so they keep identical size
  and proportions from every camera angle and height. Each character has a
  real facing in the world and the sprite shows it as seen from the camera:
  orbit behind a character to see its back, in front to see its face.
- **Camera:** 360° orbit, elevation (near-ground to bird's-eye), zoom,
  smoothing. No collision with the environment: the camera keeps your chosen
  distance and passes through trees, buildings and props. It only stays above
  the terrain surface.
- **Movement:** raycast against the exact terrain surface, A* on a 0.5-unit
  navigation grid with obstacle inflation and path smoothing.
- **Combat:** targeting ring, auto-approach, swing timing (damage lands on
  the impact frame), hit/miss/critical, floating numbers, hit flash and
  knockback, monster HP bars, death animation, fade, respawn.
- **Monster AI:** wander within spawn areas, fight back when hit, chase,
  attack, give up and return when pulled too far.
- **Progression:** EXP and Base Level with a level-up effect; HP and attack
  scale with level. Out-of-combat HP regeneration; fainting returns you to town.
- **UI:** status window, target window, controls panel, zone banner.

## What's in Stage 2

- **Character creation:** name, hair colour, hairstyle, outfit and eye
  colour, with a live turntable preview. The sprite sheet is baked per look.
- **Stats:** STR, AGI, VIT, INT, DEX, LUK with the classic rising point
  cost, points gained per base level, and a stat reset. Derived ATK, MATK,
  DEF, MDEF, HIT, FLEE, CRIT, ASPD, max HP/SP and carry weight
  (`js/systems/stats.js`). Bonus sources are pluggable for cards and buffs.
- **Levels:** Base level/EXP and Job level/Job EXP (Novice caps at job 10),
  skill points banked for Stage 3.
- **Combat now uses stats:** HIT vs FLEE hit chance, critical hits, weapon
  damage variance (DEX), hard and soft DEF, attack delay from AGI/DEX and
  weapon type.
- **Loot:** per-monster drop tables with independent rolls, Zeny drops, rare
  items sparkle. Click to pick up; items vanish after two minutes.
- **Inventory:** tabs, stacking, weight limit (over 90% stops regeneration),
  sort, use, equip, drop (button or drag onto the world), tooltips.
- **Equipment:** 10 slots, level/job/weapon-type restrictions, two-handed
  weapons, instant stat changes, comparison in tooltips.
- **Hotbar:** drag items onto F1–F9.
- **Saving:** localStorage, autosaves every 30 s, after changes, and when the
  tab closes; continue from the title screen. Camera settings and window
  positions are kept separately.

## What's in Stage 3

- **Job change:** reach job level 10 and Basic Training 9, then talk to
  Master Rowan (Job Master) in the plaza. Pick one of six paths; each has its
  own trial (hunt Lunatics, bring catalysts or fletching, a pilgrimage to the
  pond, pilfer food, pay the guild fee). A tracker shows progress. Promotion
  changes your outfit, HP/SP growth and usable weapons, and gives a weapon.
- **Six first jobs:** Swordsman, Mage, Archer, Acolyte, Thief, Merchant, each
  with its own outfit drawn on the sprite and weapon restrictions. The sprite
  shows the weapon type you hold (dagger, sword, mace, rod, bow).
- **Skills:** 21 working skills across Novice and the six jobs: Bash, Magnum
  Break, Provoke, Endure; Fire/Cold/Lightning Bolt, Increase SP Recovery;
  Double Strafe, Owl's Eye, Vulture's Eye; Heal, Blessing, Increase AGI;
  Double Attack, Improve Dodge, Steal; Mammonite, Discount, Overcharge; plus
  Basic Training, First Aid and Play Dead. SP/HP/Zeny costs, cooldowns, cast
  times (shortened by DEX), buffs with timers, passives, prerequisites.
- **Elements:** fire, water, wind and earth multipliers. Porings are water
  (Lightning Bolt hits them for 175%, Fire Bolt for 50%).
- **Skill tree window** with prerequisite links; drag skills to F1–F9; the
  hotbar shows cooldown sweeps and dims skills you can't afford.
- **Targeting:** enemy skills use your current target, or ask you to click
  one; you walk into range automatically. Bows fire real arrows.
- **NPCs and dialog:** clickable townsfolk with scripted conversations.
  Pell the Tool Dealer sells potions and wings and buys your loot (pulled
  forward from Stage 4 so Discount and Overcharge work).
- **Auto-loot toggle** (L, the menu, or Options): drops from your kills fly
  straight into your bag.
- **Debug tools:** +1 Base level and +1 Job level buttons (hold to repeat),
  toggled with the backquote key or in Options.

## Added after Stage 3

- **Whisperwood Glade:** a second map through the portal at the south end of
  the meadows. Denser, hillier forest with giant mushrooms, a pond, and new
  monsters: Fabre, Pupa (never fights back), Drops (fire), Rocker and
  Poporing, with their own loot (Green Herb, Chrysalis, Grasshopper's Leg,
  Silk Robe, Leaf Cap). Maps load from `js/data/maps.js`; travel fades
  between them, saving remembers which map you're on, and wings, fainting and
  portals all cross maps.
- **Sister Lune** at the meadow pond: the Acolyte trial is now praying with
  her, and anyone can pray to restore HP and SP. The trial tracker shows a
  direction arrow and a beacon of light that fades as you arrive.
- **19 more skills (40 total):** Sword Mastery, Increase HP Recovery; Soul
  Strike, Frost Diver (freeze), Fire Ball, Thunder Storm; Arrow Shower, Arrow
  Repel, Improve Concentration; Divine Protection, Angelus, Decrease AGI
  (slow), Holy Light; Envenom (poison), Back Slide, Hiding; Cart Revolution,
  Crazy Uproar, Enlarge Weight Limit. Monsters can be frozen, poisoned and
  slowed (shown with a colour tint).
- **Blessing and Increase AGI** are targeted like the classics: use the
  skill, then click a character (yourself).
- **Cast lower levels:** ‹ › on a skill in the skill tree picks the level you
  cast at (cheaper SP); the hotbar shows the chosen level.
- **SP costs** are about 45% of classic values.
- **Hold to repeat:** hold + on a stat or a skill to keep raising it.
- The status window line reads "Class, Base Level x, Job Level x".

Not yet included: storage and save-point NPCs, weapon and armour shops, the
general quest log, cards, the dungeon, second jobs, equipment shown on the
sprite, arrows as ammunition, a minimap.

## Project layout

    index.html                 page + HUD markup, loads modules in order
    css/style.css              HUD styles (light/dark tokens)
    lib/three.min.js           three.js r149 (MIT, see THREE_LICENSE.txt)
    js/core/config.js          every tunable number: balance, spawns, camera
    js/core/utils.js           math, noise, RNG, geometry merging
    js/data/items.js           item database (consumables, loot, equipment)
    js/data/jobs.js            job definitions, trials and advancement graph
    js/data/skills.js          skill database (costs, effects text, tree)
    js/data/npcs.js            NPC placement and dialog scripts
    js/data/maps.js            map definitions (meadow, forest)
    js/world/terrain.js        height field, ground mesh, water, streets, bridge
    js/world/navgrid.js        navigation grid, A*, line-of-sight smoothing
    js/world/environment.js    town, props, vegetation, sky
    js/graphics/spriteRig.js   procedural sprite painter + sheet baker
    js/graphics/spriteFactory.js  character designs and animations
    js/graphics/directionalSprite.js  8-direction camera-aware billboards
    js/graphics/effects.js     particles, rings, hit flashes, level-up, shadows
    js/graphics/icons.js       procedural item and skill icons
    js/graphics/spells.js      bolts, arrows, rings, auras, cast circle
    js/systems/skills.js       skill learning, casting, buffs, effects
    js/systems/quests.js       job-change trials
    js/systems/stats.js        stat costs and derived combat values
    js/systems/inventory.js    inventory, equipping, item use
    js/systems/loot.js         drop rolls, ground items, pickup
    js/systems/portals.js      warp portals between maps
    js/systems/save.js         localStorage save/load, autosave
    js/entities/entity.js      shared movement/visual behaviour
    js/entities/player.js      player controller
    js/entities/monster.js     monster state machine
    js/systems/monsters.js     monster manager, picking, combat formulas
    js/systems/camera.js       orbit camera with collision
    js/systems/input.js        mouse/keyboard routing
    js/ui/overlay.js           2D overlay: numbers, nameplates, bars
    js/ui/hud.js               DOM HUD
    js/ui/windows.js           window manager, tooltips, item descriptions
    js/ui/panels.js            status, inventory, equipment, options, menu
    js/ui/hotbar.js            hotbar and message log
    js/ui/title.js             title screen and character creation
    js/ui/skillsWindow.js      skill tree window
    js/ui/npcui.js             dialog box and shop window
    js/ui/extras.js            debug tools, auto-loot, trial tracker, buffs
    js/entities/npc.js         NPC entities
    js/game.js                 renderer, lights, world assembly, main loop
    js/main.js                 boot + loading screen

Modules share one namespace (`window.G`) via plain script tags, which is why
the game runs from `file://` without a build step. Balance and spawns live in
`config.js`; combat formulas are isolated in `G.Combat` so Stage 2 stats and
equipment can replace them without touching AI or movement.

`window.game` is exposed for debugging in the browser console.
