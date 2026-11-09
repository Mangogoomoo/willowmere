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
  cast at (cheaper SP). Dragging the skill to the action bar keeps that level
  in the slot, so the same skill can sit there at several levels (a slot
  dragged at the highest level follows your highest level).
- **SP costs** are about 45% of classic values.
- **Hold to repeat:** hold + on a stat or a skill to keep raising it.
- The status window line reads "Class, Base Level x, Job Level x".

## Database page (db.html)

`db.html` is the monster and item encyclopedia: every monster with its
portrait (rendered from the game's own sprites), element, maps it spawns on,
stats and full drop table, plus every item with its icon, stats, sources and
drop rates. It reads the same data files as the game, so it is always in sync.
Open it from the in-game **Database** button, or directly.

**Debug item delivery:** in an item's details, enter a character name and a
quantity and press give. A game tab with that character playing on the same
site receives the item instantly (via `BroadcastChannel`). Run the project
from a local server (`python -m http.server`) for this; it needs the game and
the database on the same origin.

## Fixes before Stage 4

- Characters are never hidden by the ground: sprites keep their screen-aligned
  look but take their depth from an upright cut-out at the feet, so slopes and
  lying poses (Play Dead) no longer clip. When a hill or building really is in
  front of you, your character shows as a soft blue silhouette.
- Play Dead is Novice-only: it is removed from your skills and hotbar when you
  change jobs (older saves are cleaned up on load).
- Monsters no longer push each other. Attackers take their own spots around
  you (a fan on the side they came from, or a full ring when there are many),
  so they never stack on one point and spread out when you stop.
- Hit flashes no longer write to the depth buffer (they could hide sprites).

## Stage 4: advanced systems

- **Cards:** every monster carries a rare card (0.2%, 5% for the boss). A card
  drop gets a light pillar and a banner. Double-click a card to insert it into
  slotted equipment of the right kind (weapon, armour, shield, garment, shoes,
  headgear, accessory); cards are permanent and their bonuses apply at once.
  Tooltips list inserted cards.
- **Shift to compare:** hold Shift over any gear to see what you're wearing in
  that slot on the left and the hovered item on the right.
- **Headgear shows on your character:** Ribbon, Moonbunny Ears, Leaf Cap,
  Jelly Crown, Round Glasses, Miner's Lamp, Clover Pipe (an upper headgear
  replaces the job hat).
- **Town NPCs:** Garrick (weapons), Sabine (armour and hats), Pell (tools),
  Hilde (storage, 300 shelves, keeps cards in gear), Elda (free stat and skill reset), Odo (innkeeper: save
  point and rest), Pip (tutor), Captain Brin (Adventurers' Guild quests).
- **Quest log (U):** nine guild quests from "Pest Control" to "Long Live the
  King?", tracking kills, items, levels, job change and visited maps, with a
  ready notification, turn-in rewards (EXP, Job EXP, Zeny, items), and active
  quests shown in the top-right tracker.
- **Mossy Hollow:** the beginner dungeon, entered through the portal at the
  east end of Whisperwood Glade. Dim cave with torches and glowing crystals.
  Familiars and Whispers attack on sight; Whispers are ghosts (ordinary hits
  only half-connect, Holy Light hits hard). The King Poring waits in the
  deepest chamber with a telegraphed Jelly Slam: step out of the red zone.
- **Targeting:** Heal is cast by clicking a character, like Blessing and
  Increase AGI. Enemy skills always ask you to click a target, even while you
  are auto-attacking.

## Stage 5: polish

- **Sound and music,** all synthesised in the browser (Web Audio, no files):
  hits, crits, misses, swings, monster pops, loot and Zeny pickups, card
  jingle, level-up and quest fanfares, spell sounds per element, heals, buffs,
  the boss warning and slam, portals and dialogs. Each area has its own
  generative theme (town, meadows, forest, dungeon) that crossfades as you
  travel. Volume sliders and mute are in Options.
- **Casting like the classics:** most spells now have a cast time (Holy Light
  2 s, Fire Ball 1.5 s, bolts 0.7 s per level, Heal 0.4 s, Increase AGI 1 s,
  Arrow Repel 1.5 s...). DEX shortens it (150 DEX = instant), the tooltip
  shows your own cast time, a green cast bar fills above your head, and
  taking damage interrupts the cast unless Endure is active. You stand still
  while casting (Free Cast excepted) and for one attack motion after any skill.
- **Sell all** button on every row of the NPC sell list.
- **Minimap** (top-right, north-up, zoomable) and **world map** (M): terrain,
  obstacles, NPCs, monsters, the boss, portals, your trial objective, your
  heading and the camera's view.
- **Ambience:** butterflies in the meadows, fireflies and falling leaves in
  the forest, dust motes in the cave, dust puffs at your feet as you walk;
  idle blinking for characters, Porings and Lunatics. The target window shows
  the monster's element.
- **Graphics quality** (High/Medium/Low: shadows and render resolution) with
  an optional FPS counter; the game drops to Medium once if High runs below
  about 28 fps.

## Stage 6: second jobs, refining and quality of life

- **Second jobs for every first job** (job level 40 + a trial from Master
  Rowan): Knight and Crusader (Swordsman), Wizard and Sage (Mage), Hunter,
  Bard and Dancer (Archer), Priest and Monk (Acolyte), Assassin and Rogue
  (Thief), Blacksmith and Alchemist (Merchant). Each has its own outfit, HP/SP
  growth, weapon list, gift and 4-5 skills (57 in total), from Storm Gust,
  Meteor Storm and Magnus Exorcismus to Sonic Blow, Asura Strike, Kyrie
  Eleison, Endow Blaze, Ankle Snare and Strip Weapon. The skill window shows
  Novice, first-job and second-job tabs; second jobs keep first-job gear.
- **New weapon types:** spears, katars (double crit), knuckles, axes and
  books, ten new weapons at Garrick's.
- **Refining (Bram, east street), classic rules:** weapons level 1-4 and
  armour each have a safe limit (+7/+6/+5/+4, armour +4) and the classic
  success table above it; a failed refine destroys the item and its cards.
  Max +10. Phracon and Emveretarcon are sold by Bram; Elunium and Oridecon
  drop from monsters (mostly Mossy Hollow). Weapons gain ATK (plus an
  over-refine bonus), armour gains DEF.
- **Card names:** equipment is named after its cards ("+7 Double Lucky Silk
  Robe of the King") and gear with cards shows in a warm orange.
- **Action bar:** drag a slot onto another to move or swap it, or drag it off
  the bar to remove it. A hidden + at its right end adds rows (up to four;
  rows 2–4 get their own keys), and Options can lock the bar so moving needs
  Shift.
- **Key bindings** (Options > Key bindings…): every hotbar slot, window and
  toggle can be rebound (primary and secondary key, Alt/Ctrl combos).
- **Balance:** monsters give 1.8× EXP, quests 2× EXP; normal attacks no
  longer push monsters back (knockback skills still do); dungeon walls are
  half as tall.

## Stage 8: shared world, social systems, more content

- **Shared monsters online:** one player per map hosts the monsters; everyone
  sees the same positions, HP, statuses and deaths; hits, kills and rewards
  are routed to the right player; hosting moves on when the host leaves.
- **Parties (Alt+Z):** classic settings (EXP Each Take / Even Share within 15
  levels, Item Each Take / Party Share), invites, kick, leave, %party chat,
  and "Name [Party]" over heads.
- **Guilds (Alt+G):** founded with an Emperium (dropped by Orc Dungeon orcs
  and the Orc Lord), invites, expel, disband, $guild chat, the Guild Emblem
  guild skill and 24x24 emblems shown beside the guild name under players.
- **Orc Dungeon** (west of Whisperwood Glade) and **Ember Ruins** (from the
  Orc Dungeon's far end): monsters from level 24 to 94 (Orc Zombie, Orc
  Skeleton, Zenorc, Drainliar, Wind Ghost, Raydric, Wraith, Evil Druid,
  Khalitzburg, Abysmal Knight, Bloody Knight) and MVPs Orc Lord, Dark Lord and
  Lord of Death; map bosses Eclipse, Vocal and Marin outdoors. Levels, HP,
  ATK, DEF and elements follow the classic database; EXP fits our curve.
- **Every item in the SQL database;** db.html reads items and monsters from
  the server when it's online (falls back to the built-in list otherwise).
- Inventory-style **storage and cart** windows with drag and drop; no ground
  drops while storage is open.
- Other players' cast bars and effects, buffing other players, visible carts,
  ground-targeted skills, more male hairstyles, menu hide toggle, buffs and
  debuffs under the target frame, classic stat points (1,273 at level 99).

## Online multiplayer (Neon)

Run the game through the server in `server/` to play online: register/login,
characters, items, carts and account storage live in a Neon Postgres
database, and you see other players move, change gear and chat (press
Enter). See `server/README.md` for setup. Opened any other way (a file or
the published page), Willowmere stays single-player with browser saves.

## Vending (v0.45)

- **Vending (online):** a merchant sets out cart items at a price each; a shop
  sign over their head opens the shop for everyone on the map. One shop per
  account; it stays open while you play another character (Character
  Selection) and closes when you log back in on that character.

## Arrows and signs (v0.43)

- **Arrows:** bows need arrows in the Arrows slot (Equipment window). Each bow
  shot and bow skill uses one; elemental arrows set your bow attacks' element.
  Arrow Crafting opens a window of every arrow your materials can make.
- **Signs:** the map editor's Sign object shows any text you type for it.

## Sunpetal Plains and build gear (v0.40)

- **Sunpetal Plains:** east of Willowmere Meadows (Lv 26–56). Giearths and
  Metalings near the way in; Geographers (Lv 56, man-eating sunflowers) rooted
  over the hills, biting only what comes within reach and healing each other.
- **Gear for every build:** magic, healing (heal power %), ranged, melee and
  tank sets, with weapons for every class, dropping around their level.
- **Kiting:** monsters give up once you are far from them
  (`MONSTER_LOSE_RANGE` in `js/core/config.js`), not when they leave home.
- **Skill levels from the mouse:** with a skill on the mouse, the wheel picks
  one level lower or higher.

## Stage 9: trustworthy server (in progress)

- **Phase 1 – the server keeps your character:** online, items, equipment,
  cart, storage, Zeny, EXP, levels, job and stats change only through actions
  the server checks (buy, sell, equip, refine, trade, drop, pick up...). Game
  data (drops, jobs, skills, shops, quests) is in database tables too.
- **Phase 2 – monsters live on the server:** the server runs every map that has
  players (spawns, wandering, chasing, attacking, bosses, respawns) with the
  game's own monster code and navigation, so map hosts are gone and everyone
  sees the same monsters. Damage and rewards are still worked out by each
  player's game until phases 3 and 4. Offline, monsters run in your game.

## Stage 7: full pre-renewal skill trees and class looks

- **Every class has its classic skill tree**, with the original max levels and
  prerequisites (including cross-job ones, e.g. Bowling Bash needs Bash 10,
  Magnum Break 3, Two-Handed Sword Mastery 5, Two-Hand Quicken 10 and Auto
  Counter 5). 290+ skills across Novice, the six first jobs and the thirteen
  second jobs. Quest skills (Holy Light, Back Slide, Charge Arrow, Fatal Blow,
  Energy Coat, Ki Explosion, Greed...) cost no points and open at job level 15.
- **New systems behind them:** ground fields and traps (Fire Wall, Safety
  Wall, Pneuma, Ice Wall, Quagmire, Volcano/Deluge/Whirlwind, Magnetic Earth,
  Venom Dust, Hunter traps), gemstone catalysts, Teleport and Warp Portal with
  memo points, Aqua Benedicta at the pond or stream, spirit spheres and the
  Monk combo chain, Peco Peco riding, the merchant Pushcart (Alt+W, with a
  cart that follows you) and Vending, forging (named and elemental weapons),
  tempering, elemental stones, potion brewing and converters, Lex Aeterna,
  Signum Crucis, stripping, Hindsight, Hocus-pocus, and more.
- **Distinct class looks:** capes, mantles, helmets, hoods, mitres, berets,
  feathered hats, masks, waist cloths, prayer beads, goggles, lab coats, a
  falcon on the Hunter's shoulder, Peco Pecos for Knights and Crusaders.
- **New weapon types:** two-handed swords, instruments (Bard) and whips
  (Dancer).
- **Separate skill point pools:** Novice, first-job and second-job points are
  kept apart. First-job points must all be spent on the first-job tree before
  any second-job skill can be learned (also after a skill reset). Second-job
  points may also be spent in the first-job tree, never the reverse.
- Passive skills can't be placed on the action bar. Basic
  Training stays at 9 for good once you change jobs.
- **Plan, then Confirm:** in the skill window, + plans a level (missing
  prerequisites are added automatically); nothing is learned until you press
  Confirm (Clear discards the plan).
- **Ruwach** circles you with holy light for 10 s and reveals hidden things;
  **Pneuma** is ground-targeted and blocks ranged physical attacks on anyone
  inside it; **Teleportation** 1 is a Fly Wing, level 2 a Butterfly Wing.
- **Training dummies:** three dummies inside the south gate of Willowmere.
  They can't be killed (HP never drops below 1 and refills after 4 s), never
  move, attack or get knocked back, and take every skill like a monster.
- Summon Spirit Sphere is refused (no SP spent) when you already hold the
  maximum; Snap is ground-targeted.
- **Character select with 15 slots:** portraits in each character's job
  outfit, job badge, a stats panel (map, job, levels, EXP, HP/SP, stats),
  delete (two clicks) and Game Start; empty slots create a new character.
  Each slot saves separately; names are unique across slots. Options >
  Character select returns to it. An older single save becomes slot 1.
- Skills that depend on systems Willowmere doesn't have yet (parties,
  homunculi, dual wielding, monster skills, ammunition) are in their trees as
  prerequisites and say so in their descriptions.

Possible next steps: party play, monster skills, ammunition, more dungeons.


## Project layout

    index.html                 page + HUD markup, loads modules in order
    css/style.css              HUD styles (light/dark tokens)
    lib/three.min.js           three.js r149 (MIT, see THREE_LICENSE.txt)
    js/core/config.js          every tunable number: balance, spawns, camera
    js/core/utils.js           math, noise, RNG, geometry merging
    js/data/items.js           item database (consumables, loot, equipment)
    js/data/jobs.js            job definitions, trials and advancement graph
    js/data/jobs2.js           second jobs
    js/data/skills2.js         second-job skills (data-driven effects)
    js/data/skills.js          skill database (costs, effects text, tree)
    js/data/npcs.js            NPC placement and dialog scripts
    js/data/maps.js            map definitions (meadow, forest, dungeon)
    js/data/quests.js          guild quest definitions
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
    js/systems/questlog.js     guild quest log and storage
    js/systems/stats.js        stat costs and derived combat values
    js/systems/refine.js       refining rules and tables
    js/systems/keybinds.js     rebindable keys
    js/systems/inventory.js    inventory, equipping, item use
    js/systems/loot.js         drop rolls, ground items, pickup
    js/systems/portals.js      warp portals between maps
    js/systems/audio.js        synthesised sound effects and music
    db.html                    monster & item database (+ debug item delivery)
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
    js/ui/minimap.js           minimap and world map
    js/net/online.js           online mode: API, login/register, other players, chat
    server/                    Node.js game server (Neon Postgres + WebSockets);
                               server/world.js runs the monsters online
    js/entities/npc.js         NPC entities
    js/game.js                 renderer, lights, world assembly, main loop
    js/main.js                 boot + loading screen

Modules share one namespace (`window.G`) via plain script tags, which is why
the game runs from `file://` without a build step. Balance and spawns live in
`config.js`; combat formulas are isolated in `G.Combat` so Stage 2 stats and
equipment can replace them without touching AI or movement.

`window.game` is exposed for debugging in the browser console.
