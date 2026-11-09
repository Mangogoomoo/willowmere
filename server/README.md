# Willowmere server (multiplayer + Neon)

This small Node.js server runs the online version of Willowmere:

- serves the game itself (open `https://your-server/` in a browser),
- keeps accounts, characters, inventories, equipment, carts and account
  storage in your **Neon** Postgres database (plus monster/item reference
  tables filled from the game's data on every start),
- relays live player movement, looks, attack swings and chat over WebSockets.

**Who decides what (Stage 9).** While a character is online the server holds
its items, equipment, cart, storage, Zeny, EXP, levels, job and stats in
memory. The game sends actions (`{ t: 'op', k: 'buy' | 'sell' | 'equip' |
'refine' | 'store' | ... }`), the server checks each one against the reference
tables and sends back the corrected character (`{ t: 'char' }`). Characters are
written to the tables every 15 seconds, on logout, right after a trade and when
the server is stopped. The game's own save (`PUT /api/characters/:id`) now only
stores position, HP/SP, skills, hotbar, quest progress and preferences.

**Monsters (Stage 9, phase 2).** `world.js` runs the monsters of every map that
has players on it. It loads the game's own files (terrain, navigation grid,
scenery, map-editor edits, the `Monster` class and its AI) into a sandbox with
nothing drawn, one sandbox per map, so monsters walk exactly where they do in
the browser. Every 0.1 s it moves them; every 0.2 s it sends the changes to the
map's players (`{ t: 'mobs' }`). Players' hits arrive as `{ t: 'mob', op:
'dmg' | 'status' | 'knock' }`; the server tells a player when a monster swings
at them (`op: 'attack'`) or when their blow killed it (`op: 'killed'`). The town is
started with the server; other maps start when someone arrives and stop ten
minutes after the last player leaves. A map is rebuilt when an admin saves it
in the map editor. One map costs about 8 MB of memory and a fraction of a
millisecond per step (`/api/health` shows how many maps are running).

**Vending.** Open shops live in `vending_shops` (one per account) so they
survive restarts. The server sells from the seller's cart and moves the Zeny,
also while the seller is logged out (their character stays loaded until the
shop closes).

Reference tables filled on every start: `item_defs`, `monster_defs`,
`monster_spawns`, `monster_drops`, `job_defs`, `skill_defs`, `shops` and
`shop_items` (shop NPCs from the map editor are added when a map is saved),
`quest_defs` and `quest_rewards`. Finished quests are in `character_quests`.

The database password never reaches the browser: only this server knows
`DATABASE_URL`.

## 1. Create the Neon database

1. Sign in at <https://neon.com> and create a project (the free plan is fine).
2. On the project dashboard, click **Connect** and copy the connection string.
   It looks like
   `postgresql://USER:PASSWORD@ep-xxxx.REGION.aws.neon.tech/neondb?sslmode=require`
3. That's all: the server creates its tables itself on first start
   (see `schema.sql`).

## 2. Run it on your computer (to try it)

Needs Node.js 18 or newer.

```bash
cd server
npm install
DATABASE_URL="postgresql://...your Neon string..." npm start
```

On Windows PowerShell: `$env:DATABASE_URL="postgresql://..."; npm start`

Open <http://localhost:3000>, create an account, and play. Open a second
browser (or a private window) with another account to see each other.

## 3. Put it online (so friends can join)

Any host that runs a Node.js web service with WebSockets works. With
**Render** (render.com) for example:

1. Push the whole `willowmere/` folder to a GitHub repository.
2. New → Web Service → pick the repository.
3. Root directory: `server` · Build command: `npm install` · Start command: `npm start`
4. Add an environment variable `DATABASE_URL` = your Neon connection string.
5. Deploy. Render gives you an `https://…onrender.com` address with
   HTTPS/WSS already set up; share it with your friends.

Railway, Fly.io or a small VPS work the same way: run `npm start` in
`server/` with `DATABASE_URL` set and the folder above it next to it.

## Tables

| table | holds |
| --- | --- |
| `accounts` | username, scrypt password hash |
| `sessions` | login sessions (only a hash of each token is stored) |
| `characters` | 15 slots per account: job, levels, stats, position, skills, hotbar, quests… |
| `character_items` | bag, equipped and cart items (refine, cards, forged by, element) |
| `storage_items` | account-wide storage, shared by all characters (like the classics) |
| `item_defs`, `monster_defs`, `monster_spawns` | reference data from the game files |

## What's next

This first online version trusts the game client for what happens in play
(damage, loot, EXP), and each player still fights their own copy of the
monsters. The next step is to run monsters and combat on the server so
everyone shares the same world and nobody can cheat their save.
