/* Willowmere game server.
   - Serves the game files (index.html, js/, css/ ...) from the folder above.
   - REST API under /api for accounts and characters, stored in Postgres (Neon).
   - WebSocket at /ws for multiplayer presence and chat.
   Configure with environment variables:
     DATABASE_URL   Neon connection string (postgresql://...?sslmode=require)   [required]
     PORT           port to listen on (default 3000)
   Run:  npm install && npm start */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const { Pool } = require('pg');
const { WebSocketServer } = require('ws');
const { World } = require('./world.js');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;
if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL to your Neon connection string.'); process.exit(1); }
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
const SESSION_DAYS = 30;
const MAX_SLOTS = 15;

/* ---------------------------------------------------------------- helpers */
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
function checkPassword(pw, stored) {
  const [kind, saltHex, keyHex] = String(stored).split('$');
  if (kind !== 'scrypt') return false;
  const key = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
  const want = Buffer.from(keyHex, 'hex');
  return want.length === key.length && crypto.timingSafeEqual(want, key);
}
const USER_RE = /^[A-Za-z0-9_]{3,24}$/;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 '\-]{1,15}$/;
const ITEM_RE = /^[a-z0-9_]{1,40}$/;

function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(data);
}
function readJson(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error('Request too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(Object.assign(new Error('Bad JSON'), { status: 400 })); } });
    req.on('error', reject);
  });
}
// Very small per-IP limiter for login/register.
const attempts = new Map();
function limited(ip) {
  const now = Date.now(), a = attempts.get(ip) || { n: 0, t: now };
  if (now - a.t > 60_000) { a.n = 0; a.t = now; }
  a.n++; attempts.set(ip, a);
  return a.n > 20;
}

/* ---------------------------------------------------------------- auth */
async function newSession(accountId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await pool.query('INSERT INTO sessions (token_hash, account_id, expires_at) VALUES ($1, $2, now() + $3::interval)', [sha256(token), accountId, `${SESSION_DAYS} days`]);
  return token;
}
async function accountFromToken(token) {
  if (!token || typeof token !== 'string' || token.length > 100) return null;
  const r = await pool.query('SELECT a.id, a.username, a.is_admin FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = $1 AND s.expires_at > now()', [sha256(token)]);
  return r.rows[0] || null;
}
// Admins: accounts marked is_admin, or listed in the ADMIN_USERS setting (comma-separated usernames).
const ADMINS = new Set(String(process.env.ADMIN_USERS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
async function requireAdmin(req, res) {
  const h = req.headers.authorization || '';
  const acct = await accountFromToken(h.startsWith('Bearer ') ? h.slice(7) : '');
  if (!acct) { send(res, 401, { error: 'Please log in again.' }); return null; }
  if (!acct.is_admin && !ADMINS.has(acct.username.toLowerCase())) { send(res, 403, { error: 'Only admins can do that.' }); return null; }
  return acct;
}
async function requireAccount(req, res) {
  const h = req.headers.authorization || '';
  const acct = await accountFromToken(h.startsWith('Bearer ') ? h.slice(7) : '');
  if (!acct) send(res, 401, { error: 'Please log in again.' });
  return acct;
}

/* ---------------------------------------------------------------- save format <-> rows */
const cleanItem = (e) => ({
  item_id: String(e.id || ''), qty: Math.max(1, Math.min(30000, Math.floor(Number(e.qty) || 1))),
  refine: Math.max(0, Math.min(10, Math.floor(Number(e.refine) || 0))),
  cards: Array.isArray(e.cards) ? e.cards.filter((c) => ITEM_RE.test(String(c))).slice(0, 4).map(String) : [],
  forged_by: e.forgedBy ? String(e.forgedBy).slice(0, 24) : null,
  element: e.element ? String(e.element).slice(0, 12) : null,
});
const itemOut = (r) => ({ id: r.item_id, qty: r.qty, refine: r.refine, cards: r.cards || [], forgedBy: r.forged_by || undefined, element: r.element || undefined });

async function loadCharacter(charId, accountId, full) {
  // An online character's live state is written first, so this read is current.
  const live = Chars.mem.get(Number(charId));
  if (live && live.accountId === accountId) { live.dirty = true; await Chars.flush(live); }
  const c = (await pool.query('SELECT * FROM characters WHERE id = $1 AND account_id = $2', [charId, accountId])).rows[0];
  if (!c) return null;
  const items = (await pool.query('SELECT * FROM character_items WHERE character_id = $1 ORDER BY sort, id', [charId])).rows;
  const equipment = {};
  for (const r of items) if (r.location === 'equip' && r.equip_slot) equipment[r.equip_slot] = itemOut(r);
  const save = {
    id: Number(c.id), slot: c.slot, version: 3, savedAt: new Date(c.updated_at).getTime(), isNew: c.is_new,
    character: { name: c.name, appearance: c.appearance },
    job: c.job, baseLevel: c.base_level, jobLevel: c.job_level, baseExp: Number(c.base_exp), jobExp: Number(c.job_exp),
    stats: c.stats, statPoints: c.stat_points, hp: c.hp, sp: c.sp, zeny: Number(c.zeny),
    equipment, skills: c.skills, position: { map: c.map, x: c.x, z: c.z, facing: c.facing },
  };
  if (!full) return save;
  const extra = Object.assign({}, c.extra);
  extra.cart = items.filter((r) => r.location === 'cart').map(itemOut);
  const storage = (await pool.query('SELECT * FROM storage_items WHERE account_id = $1 ORDER BY sort, id', [accountId])).rows.map(itemOut);
  return Object.assign(save, {
    inventory: { items: items.filter((r) => r.location === 'bag').map(itemOut), nextUid: 1 },
    hotbar: c.hotbar, storage, savePoint: c.save_point, extra,
  });
}

/* The game's own save holds only what the game still decides: where you are,
   HP/SP, skills, hotbar, quest progress and preferences. Items, Zeny, EXP,
   levels, job and stats belong to the server (see Chars) and are ignored here. */
async function saveCharacter(charId, accountId, d) {
  const num = (v, lo, hi, def) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };
  const extra = Object.assign({}, d.extra || {}); delete extra.cart; delete extra.statFix;
  const pos = d.position || {};
  const r = await pool.query(`UPDATE characters SET hp=$3, sp=$4, appearance=$5, map=$6, x=$7, z=$8, facing=$9, save_point=$10, skills=$11, hotbar=$12,
    extra = $13::jsonb || CASE WHEN extra ? 'statFix' THEN jsonb_build_object('statFix', extra->'statFix') ELSE '{}'::jsonb END, is_new=false, updated_at=now() WHERE id=$1 AND account_id=$2`, [
    charId, accountId, Math.floor(num(d.hp, 0, 1e7, 1)), Math.floor(num(d.sp, 0, 1e7, 1)),
    JSON.stringify((d.character && d.character.appearance) || {}), String(pos.map || 'meadow').slice(0, 24), num(pos.x, -500, 500, 0), num(pos.z, -500, 500, 0),
    num(pos.facing, -10, 10, 0), d.savePoint ? JSON.stringify(d.savePoint) : null, JSON.stringify(d.skills || {}), JSON.stringify(d.hotbar || []), JSON.stringify(extra),
  ]);
  // Learned skills matter to a few server checks (shop discounts, cart, vending).
  const live = Chars.mem.get(Number(charId));
  if (live && d.skills && d.skills.levels && typeof d.skills.levels === 'object') live.skills = d.skills.levels;
  return r.rowCount > 0;
}

/* ---------------------------------------------------------------- API routes */
async function api(req, res, url) {
  const ip = req.socket.remoteAddress || '?';
  const m = (re) => re.exec(url.pathname);
  if (url.pathname === '/api/health') return send(res, 200, { ok: true, online: online.size, maps: World.sims.size });
  /* ---- map editor: edited maps and uploaded 3D models ---- */
  if (url.pathname === '/api/me') {
    const acct = await requireAccount(req, res); if (!acct) return;
    return send(res, 200, { username: acct.username, isAdmin: !!acct.is_admin || ADMINS.has(acct.username.toLowerCase()) });
  }
  if (url.pathname === '/api/maps' && req.method === 'GET') {
    const rows = (await pool.query('SELECT id, data FROM custom_maps')).rows;
    return send(res, 200, { maps: Object.fromEntries(rows.map((r) => [r.id, r.data])) });
  }
  let mapM;
  if ((mapM = /^\/api\/maps\/([a-z0-9_]{1,40})$/.exec(url.pathname)) && (req.method === 'PUT' || req.method === 'DELETE')) {
    const acct = await requireAdmin(req, res); if (!acct) return;
    const id = mapM[1];
    if (req.method === 'DELETE') {
      await pool.query('DELETE FROM custom_maps WHERE id = $1', [id]);
      await Ref.syncCustomShops();
      World.mapUpdated(id, null);
      for (const [ws] of online) if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'map_updated', id, data: null }));
      return send(res, 200, { ok: true });
    }
    const body = await readJson(req, 3_000_000);
    const data = body && body.data;
    if (!data || typeof data !== 'object' || !Array.isArray(data.objects) || !Array.isArray(data.entities)) return send(res, 400, { error: 'Bad map data.' });
    if (data.objects.length > 5000 || data.entities.length > 1000) return send(res, 400, { error: 'Too many objects on one map.' });
    data.id = id;
    // Keep the version being replaced (the last 30 per map).
    await pool.query('INSERT INTO custom_map_versions (map_id, data, saved_by, saved_at) SELECT id, data, updated_by, updated_at FROM custom_maps WHERE id = $1', [id]);
    await pool.query('DELETE FROM custom_map_versions WHERE map_id = $1 AND id NOT IN (SELECT id FROM custom_map_versions WHERE map_id = $1 ORDER BY saved_at DESC LIMIT 30)', [id]);
    await pool.query('INSERT INTO custom_maps (id, data, updated_by, updated_at) VALUES ($1, $2, $3, now()) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = now()', [id, JSON.stringify(data), acct.id]);
    if (data.rules && data.rules.pvp) pvpMaps.add(id); else pvpMaps.delete(id);
    await Ref.syncCustomShops();
    World.mapUpdated(id, data);
    // Everyone online gets the new version straight away.
    for (const [ws] of online) if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'map_updated', id, data }));
    return send(res, 200, { ok: true });
  }
  let verM;
  if ((verM = /^\/api\/maps\/([a-z0-9_]{1,40})\/versions(?:\/(\d+))?$/.exec(url.pathname)) && req.method === 'GET') {
    const acct = await requireAdmin(req, res); if (!acct) return;
    if (verM[2]) {
      const r = (await pool.query('SELECT data FROM custom_map_versions WHERE map_id = $1 AND id = $2', [verM[1], Number(verM[2])])).rows[0];
      return r ? send(res, 200, { data: r.data }) : send(res, 404, { error: 'Not found.' });
    }
    const rows = (await pool.query("SELECT v.id, v.saved_at, a.username, jsonb_array_length(v.data->'objects') AS objects FROM custom_map_versions v LEFT JOIN accounts a ON a.id = v.saved_by WHERE v.map_id = $1 ORDER BY v.saved_at DESC LIMIT 30", [verM[1]])).rows;
    return send(res, 200, { versions: rows });
  }
  if (url.pathname === '/api/assets' && req.method === 'GET') {
    const rows = (await pool.query('SELECT id, name, size FROM map_assets ORDER BY created_at')).rows;
    return send(res, 200, { assets: rows });
  }
  if (url.pathname === '/api/assets' && req.method === 'POST') {
    const acct = await requireAdmin(req, res); if (!acct) return;
    const body = await readJson(req, 21_000_000);
    const name = String((body && body.name) || 'model').replace(/\.glb$/i, '').replace(/[^A-Za-z0-9 _-]/g, '').slice(0, 40) || 'model';
    const buf = Buffer.from(String((body && body.data) || ''), 'base64');
    if (buf.length < 20 || buf.length > 15_000_000 || buf.toString('ascii', 0, 4) !== 'glTF') return send(res, 400, { error: 'Upload a .glb file (binary glTF) of at most 15 MB.' });
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) + '_' + crypto.randomBytes(3).toString('hex');
    await pool.query('INSERT INTO map_assets (id, name, size, data, uploaded_by) VALUES ($1, $2, $3, $4, $5)', [id, name, buf.length, buf, acct.id]);
    return send(res, 200, { id, name, size: buf.length });
  }
  let am;
  if ((am = /^\/api\/assets\/([a-z0-9_]{1,40})$/.exec(url.pathname))) {
    if (req.method === 'DELETE') {
      const acct = await requireAdmin(req, res); if (!acct) return;
      await pool.query('DELETE FROM map_assets WHERE id = $1', [am[1]]);
      return send(res, 200, { ok: true });
    }
    const r = (await pool.query('SELECT data FROM map_assets WHERE id = $1', [am[1]])).rows[0];
    if (!r) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'model/gltf-binary', 'Cache-Control': 'public, max-age=31536000, immutable' });
    return res.end(r.data);
  }
  if (url.pathname === '/api/db') {
    const items = (await pool.query('SELECT data FROM item_defs ORDER BY id')).rows.map((r) => r.data);
    const monsters = (await pool.query('SELECT id, data FROM monster_defs ORDER BY level, id')).rows.map((r) => Object.assign({ id: r.id }, r.data));
    const spawns = (await pool.query('SELECT map, monster_id, count FROM monster_spawns')).rows;
    return send(res, 200, { items, monsters, spawns });
  }
  let em;
  if ((em = /^\/api\/guilds\/(\d+)\/emblem$/.exec(url.pathname))) {
    const r = (await pool.query('SELECT emblem FROM guilds WHERE id = $1', [Number(em[1])])).rows[0];
    if (!r || !r.emblem) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300' });
    return res.end(Buffer.from(r.emblem.split(',')[1], 'base64'));
  }

  if (url.pathname === '/api/register' && req.method === 'POST') {
    if (limited(ip)) return send(res, 429, { error: 'Too many attempts. Wait a minute.' });
    const { username, password } = await readJson(req, 10_000);
    if (!USER_RE.test(String(username || ''))) return send(res, 400, { error: 'Usernames are 3 to 24 letters, numbers or underscores.' });
    if (typeof password !== 'string' || password.length < 8 || password.length > 200) return send(res, 400, { error: 'Passwords need at least 8 characters.' });
    try {
      const r = await pool.query('INSERT INTO accounts (username, pass_hash, last_login) VALUES ($1, $2, now()) RETURNING id, username', [username, hashPassword(password)]);
      return send(res, 200, { token: await newSession(r.rows[0].id), username: r.rows[0].username, isAdmin: ADMINS.has(r.rows[0].username.toLowerCase()) });
    } catch (e) { if (e.code === '23505') return send(res, 409, { error: 'That username is taken.' }); throw e; }
  }
  if (url.pathname === '/api/login' && req.method === 'POST') {
    if (limited(ip)) return send(res, 429, { error: 'Too many attempts. Wait a minute.' });
    const { username, password } = await readJson(req, 10_000);
    const r = await pool.query('SELECT id, username, pass_hash FROM accounts WHERE lower(username) = lower($1)', [String(username || '')]);
    const a = r.rows[0];
    if (!a || typeof password !== 'string' || !checkPassword(password, a.pass_hash)) return send(res, 401, { error: 'Wrong username or password.' });
    await pool.query('UPDATE accounts SET last_login = now() WHERE id = $1', [a.id]);
    return send(res, 200, { token: await newSession(a.id), username: a.username, isAdmin: !!a.is_admin || ADMINS.has(a.username.toLowerCase()) });
  }
  if (url.pathname === '/api/logout' && req.method === 'POST') {
    const h = req.headers.authorization || '';
    if (h.startsWith('Bearer ')) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(h.slice(7))]);
    return send(res, 200, { ok: true });
  }

  const acct = await requireAccount(req, res);
  if (!acct) return;

  if (url.pathname === '/api/me') return send(res, 200, { username: acct.username });
  if (url.pathname === '/api/characters' && req.method === 'GET') {
    const ids = (await pool.query('SELECT id FROM characters WHERE account_id = $1', [acct.id])).rows;
    const slots = new Array(MAX_SLOTS).fill(null);
    for (const { id } of ids) { const c = await loadCharacter(id, acct.id, false); if (c) { c.vending = Vend.shops.has(Number(id)); slots[c.slot] = c; } }
    return send(res, 200, { username: acct.username, slots });
  }
  if (url.pathname === '/api/characters' && req.method === 'POST') {
    const { slot, name, appearance } = await readJson(req, 10_000);
    const s = Number(slot), nm = String(name || '').trim().replace(/\s+/g, ' ');
    if (!Number.isInteger(s) || s < 0 || s >= MAX_SLOTS) return send(res, 400, { error: 'Bad slot.' });
    if (!NAME_RE.test(nm)) return send(res, 400, { error: 'Use 2 to 16 letters or numbers.' });
    const app = {}; for (const k of ['hair', 'outfit', 'eyes', 'style']) if (appearance && typeof appearance[k] === 'string') app[k] = appearance[k].slice(0, 20);
    try {
      const st = { stats: { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 }, bag: [], equip: {}, cart: [], nextUid: 1 };
      Chars.giveKit(st);
      const r = await pool.query(`INSERT INTO characters (account_id, slot, name, appearance, stats, stat_points, zeny, extra) VALUES ($1, $2, $3, $4, $5, $6, $7, '{"statFix":1}') RETURNING id`,
        [acct.id, s, nm, JSON.stringify(app), JSON.stringify(st.stats), GD.Stats.START_POINTS, st.zeny]);
      const id = Number(r.rows[0].id);
      await pool.query(`INSERT INTO character_items (character_id, location, equip_slot, item_id, qty, refine, cards, forged_by, element, sort)
        SELECT $1, location, equip_slot, item_id, qty, refine, cards, forged_by, element, sort FROM jsonb_to_recordset($2::jsonb)
        AS x(location text, equip_slot text, item_id text, qty int, refine smallint, cards text[], forged_by text, element text, sort int)`, [id, JSON.stringify(Chars.rows(st))]);
      return send(res, 200, { id });
    } catch (e) {
      if (e.code === '23505') return send(res, 409, { error: /name/.test(e.constraint || '') ? `The name ${nm} is already taken.` : 'That slot is already used.' });
      throw e;
    }
  }
  let mm;
  if ((mm = m(/^\/api\/characters\/(\d+)$/))) {
    const id = Number(mm[1]);
    if (req.method === 'GET') { const c = await loadCharacter(id, acct.id, true); return c ? send(res, 200, c) : send(res, 404, { error: 'No such character.' }); }
    if (req.method === 'PUT') { const ok = await saveCharacter(id, acct.id, await readJson(req)); return ok ? send(res, 200, { ok: true }) : send(res, 404, { error: 'No such character.' }); }
    if (req.method === 'DELETE') {
      for (const s of online.values()) if (s.charId === id) return send(res, 409, { error: 'That character is online.' });
      await pool.query('DELETE FROM characters WHERE id = $1 AND account_id = $2', [id, acct.id]);
      return send(res, 200, { ok: true });
    }
  }
  send(res, 404, { error: 'Not found.' });
}

/* ---------------------------------------------------------------- static files */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8' };
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.resolve(ROOT, '.' + rel);
  // Never serve the server's own folder, dotfiles, or anything outside the game folder.
  if (!file.startsWith(ROOT + path.sep) || file.startsWith(path.join(ROOT, 'server')) || /\/\./.test(rel) || /node_modules|\/tools\//.test(rel)) { res.writeHead(404); return res.end('Not found'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else if (req.method === 'GET' || req.method === 'HEAD') serveStatic(req, res, url);
    else { res.writeHead(405); res.end(); }
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Server error.' });
  }
});

/* ---------------------------------------------------------------- multiplayer */
const online = new Map();   // ws -> session { accountId, charId, name, map, x, z, facing, moving, look }
const publicState = (s) => ({ id: s.charId, name: s.name, map: s.map, x: s.x, z: s.z, facing: s.facing, moving: s.moving, look: s.look, party: s.partyName || null, guild: s.guild || null, hp: s.hp, maxHp: s.maxHp, vend: Vend.title(s.charId) });
function broadcast(map, msg, except) {
  const data = JSON.stringify(msg);
  for (const [ws, s] of online) if (s.map === map && ws !== except && ws.readyState === 1) ws.send(data);
}
const cleanLook = (l) => {
  if (!l || typeof l !== 'object') return {};
  const out = {};
  for (const k of ['job', 'weapon', 'mount']) if (typeof l[k] === 'string') out[k] = l[k].slice(0, 24);
  out.falcon = !!l.falcon;
  out.cart = Number.isInteger(l.cart) && l.cart >= 0 && l.cart < 8 ? l.cart : null;
  if (l.appearance && typeof l.appearance === 'object') { out.appearance = {}; for (const k of ['hair', 'outfit', 'eyes', 'style']) if (typeof l.appearance[k] === 'string') out.appearance[k] = l.appearance[k].slice(0, 20); }
  if (l.head && typeof l.head === 'object') { out.head = {}; for (const k of ['top', 'mid', 'low']) if (typeof l.head[k] === 'string') out.head[k] = l.head[k].slice(0, 24); }
  out.perf = typeof l.perf === 'string' && /^[a-z_]{1,32}$/.test(l.perf) ? l.perf : null;   // the song a Bard or Dancer is performing
  return out;
};

/* ---------------------------------------------------------------- vending
   A merchant's shop (Vending skill): items from their cart at a price each.
   One open shop per account. The server keeps the shop, sells from it and
   moves the Zeny; the shop stays open while its owner is logged out (they can
   play another character) and closes when that character logs in again. */
const VEND_MAX_PRICE = 1000000000, VEND_SPACING = 3;
const Vend = {
  shops: new Map(),   // charId -> shop
  async load() {
    for (const r of (await pool.query('SELECT account_id, character_id, data FROM vending_shops')).rows) {
      this.shops.set(Number(r.character_id), Object.assign(r.data, { accountId: Number(r.account_id), charId: Number(r.character_id), online: false }));
    }
  },
  forAccount(accountId) { for (const s of this.shops.values()) if (s.accountId === accountId) return s; return null; },
  title(charId) { const s = this.shops.get(charId); return s ? s.title : null; },
  // How a shop whose owner is away looks to everyone else.
  pub(s) { return { id: s.charId, name: s.name, map: s.map, x: s.x, z: s.z, facing: s.facing || 0, moving: false, look: s.look, party: null, guild: null, hp: null, maxHp: null, vend: s.title }; },
  ghosts(map, except) { return [...this.shops.values()].filter((s) => !s.online && s.map === map && s.charId !== except).map((s) => this.pub(s)); },
  async save(s) {
    const data = { name: s.name, title: s.title, map: s.map, x: s.x, z: s.z, facing: s.facing, look: s.look, items: s.items, sales: s.sales };
    await pool.query(`INSERT INTO vending_shops (account_id, character_id, data) VALUES ($1, $2, $3)
      ON CONFLICT (account_id) DO UPDATE SET character_id = $2, data = $3`, [s.accountId, s.charId, JSON.stringify(data)]);
  },
  view(s) { return { t: 'vend_view', id: s.charId, name: s.name, title: s.title, items: s.items.map((it) => Object.assign({}, it)) }; },
  mine(s) { return { t: 'vend_mine', title: s.title, items: s.items, sales: s.sales }; },
  // The seller's live character (loaded if they are away and the server restarted).
  async seller(s) { return Chars.mem.get(s.charId) || Chars.load(s.charId, s.accountId, null, false); },

  async handle(ws, me, m) {
    const st = Chars.mem.get(me.charId);
    if (!st) return;
    if (m.t === 'vend_open') return this.open(ws, me, st, m);
    if (m.t === 'vend_close') { if (this.shops.has(me.charId)) await this.close(me.charId, 'You closed your shop.'); return; }
    if (m.t === 'vend_view') { const s = this.shops.get(Number(m.id)); if (s && s.map === me.map) ws.send(JSON.stringify(this.view(s))); return; }
    if (m.t === 'vend_buy') return this.buy(ws, me, st, m);
  },
  async open(ws, me, st, m) {
    const no = (text) => ws.send(JSON.stringify({ t: 'vend_fail', text }));
    const lv = st.skills.vending || 0;
    if (!lv || !(st.skills.pushcart > 0)) return no('You need the Vending skill and a Pushcart.');
    if (this.forAccount(me.accountId)) return no('One of your characters already has a shop open (one per account).');
    if (pvpMaps.has(me.map)) return no('You can’t open a shop on a PvP map.');
    if ([...this.shops.values()].some((s) => s.map === me.map && Math.hypot(s.x - me.x, s.z - me.z) < VEND_SPACING)) return no('Too close to another shop. Move a little further away.');
    const title = String(m.title || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!title) return no('Give your shop a title.');
    const want = Array.isArray(m.items) ? m.items.slice(0, 2 + lv) : [];
    const items = [], used = new Set();
    for (const w of want) {
      const i = Math.floor(Number(w.i)), e = st.cart[i], qty = Math.floor(Number(w.qty)), price = Math.floor(Number(w.price));
      if (!e || e.id !== w.id || used.has(e.uid)) return no('Your cart changed. Open Vending again.');
      if (!(qty >= 1 && qty <= e.qty)) return no(`Pick 1 to ${e.qty} for ${(Ref.item(e.id) || {}).name || e.id}.`);
      if (!(price >= 1 && price <= VEND_MAX_PRICE)) return no(`Prices are 1 to ${VEND_MAX_PRICE.toLocaleString()} Zeny each.`);
      used.add(e.uid);
      items.push({ k: items.length + 1, uid: e.uid, id: e.id, qty, price, refine: e.refine || 0, cards: e.cards || [], forgedBy: e.forgedBy, element: e.element });
    }
    if (!items.length) return no('Pick at least one item to sell.');
    const s = { accountId: me.accountId, charId: me.charId, name: me.name, title, map: me.map, x: me.x, z: me.z, facing: me.facing || 0, look: me.look, items, sales: [], online: true };
    this.shops.set(me.charId, s);
    me.hidden = true;   // monsters leave shopkeepers alone
    await this.save(s);
    ws.send(JSON.stringify(this.mine(s)));
    broadcast(me.map, { t: 'vend', id: me.charId, title }, ws);
  },
  async buy(ws, me, buyer, m) {
    const s = this.shops.get(Number(m.id)), reply = (text) => { ws.send(JSON.stringify(Object.assign(s ? this.view(s) : { t: 'vend_view', id: Number(m.id), items: [], closed: true }, { text }))); };
    if (!s) return reply('That shop has closed.');
    if (s.accountId === me.accountId) return reply('You can’t buy from your own shop.');
    if (s.map !== me.map || Math.hypot(s.x - me.x, s.z - me.z) > 12) return reply('Walk closer to the shop.');
    const it = s.items.find((x) => x.k === Number(m.k)), qty = Math.floor(Number(m.qty));
    if (!it) return reply('That item has sold out.');
    if (!(qty >= 1 && qty <= it.qty)) return reply(`Only ${it.qty} left.`);
    const cost = it.price * qty;
    if (buyer.zeny < cost) return reply('You don’t have enough Zeny.');
    const seller = await this.seller(s);
    const e = seller && this.cartEntry(s, seller, it);
    if (!e || e.qty < qty) { it.qty = e ? Math.min(it.qty, e.qty) : 0; return reply('That item isn’t available any more.'); }
    if (!Chars.add(buyer, 'bag', it.id, qty, e)) return reply('Your inventory is full.');
    Chars.take(seller, e.uid, qty, seller.cart);
    buyer.zeny -= cost; seller.zeny = Math.min(2147483647, seller.zeny + cost);
    buyer.dirty = seller.dirty = true;
    it.qty -= qty; if (it.qty <= 0) s.items.splice(s.items.indexOf(it), 1);
    s.sales.push({ id: it.id, qty, zeny: cost, buyer: me.name });
    await Chars.flush(buyer, seller);
    Chars.push(buyer);
    const name = (Ref.item(it.id) || {}).name || it.id;
    reply(`Bought ${qty} ${name} for ${cost.toLocaleString()} Zeny.`);
    const sw = wsOfChar(s.charId);
    if (sw && s.online) { Chars.push(seller); sw.send(JSON.stringify(Object.assign(this.mine(s), { text: `${me.name} bought ${qty} ${name} for ${cost.toLocaleString()} Zeny.` }))); }
    if (!s.items.length) await this.close(s.charId, 'Your shop sold out and closed.');
    else await this.save(s);
  },
  // The cart item behind a listing. Item numbers change when the server reloads a character
  // (a restart), so it is found again by what it is: the same item, refine, cards and maker.
  cartEntry(s, seller, it) {
    let e = seller.cart.find((x) => x.uid === it.uid && x.id === it.id);
    if (!e) {
      const same = (x) => x.id === it.id && (x.refine || 0) === (it.refine || 0) && JSON.stringify(x.cards || []) === JSON.stringify(it.cards || [])
        && (x.forgedBy || null) === (it.forgedBy || null) && (x.element || null) === (it.element || null);
      e = seller.cart.find((x) => same(x) && !s.items.some((o) => o !== it && o.uid === x.uid));
      if (e) it.uid = e.uid;
    }
    return e || null;
  },
  // Sales while the owner was away, in a line.
  summary(s) {
    if (!s.sales.length) return 'Nothing sold while you were away.';
    const by = {};
    for (const x of s.sales) { const k = x.id; by[k] = by[k] || { qty: 0, zeny: 0 }; by[k].qty += x.qty; by[k].zeny += x.zeny; }
    const total = s.sales.reduce((n, x) => n + x.zeny, 0);
    return `You sold ${Object.entries(by).map(([id, v]) => `${v.qty} ${(Ref.item(id) || {}).name || id}`).join(', ')} for ${total.toLocaleString()} Zeny.`;
  },
  async close(charId, text) {
    const s = this.shops.get(charId);
    if (!s) return;
    this.shops.delete(charId);
    await pool.query('DELETE FROM vending_shops WHERE account_id = $1', [s.accountId]).catch((e) => console.error(e));
    broadcast(s.map, { t: 'vend', id: charId, title: null });
    const sw = wsOfChar(charId), me = sw && online.get(sw);
    if (me) me.hidden = false;
    if (sw && s.online) sw.send(JSON.stringify({ t: 'vend_closed', text }));
    if (!s.online) {
      broadcast(s.map, { t: 'leave', id: charId });   // the shopkeeper who stayed behind goes home
      const st = Chars.mem.get(charId);
      if (st && !st.ws) await Chars.release(st, null);
    }
  },
  // The owner logs back into the character: the shop closes and they hear what sold.
  async login(charId, resume) {
    const s = this.shops.get(charId);
    if (!s) return null;
    if (resume) { s.online = true; return null; }   // the same game reconnecting: keep selling
    const text = `Your shop “${s.title}” closed when you logged in. ${this.summary(s)}`;
    // Closing it also saves the shopkeeper and lets go of them, so you start from the database
    // (storage may have changed while you played someone else).
    s.online = false;
    await this.close(charId, null);
    return text;
  },
  // The owner left (logged out, went to character selection, lost connection): the shop stays.
  away(me) { const s = this.shops.get(me.charId); if (!s) return false; s.online = false; return true; },
};

/* Monsters live on the server (server/world.js): it runs every map that has
   players, sends everyone the same snapshots, and takes their hits. */
const wsOfChar = (id) => { for (const [ws, s] of online) if (s.charId === id) return ws; return null; };

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
wss.on('connection', (ws) => {
  let me = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', async (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch (e) { return; }
    if (!me) {
      if (msg.t !== 'hello') return;
      const acct = await accountFromToken(msg.token).catch(() => null);
      const charId = Number(msg.charId);
      const c = acct && (await pool.query('SELECT id, name, map FROM characters WHERE id = $1 AND account_id = $2', [charId, acct.id])).rows[0];
      if (!c) { ws.send(JSON.stringify({ t: 'error', text: 'Not allowed.' })); return ws.close(); }
      // One character per account online at a time: the newer login wins.
      for (const [other, s] of online) if (s.accountId === acct.id) {
        s.gone = true;   // ignore anything else it sends
        const old = Chars.mem.get(s.charId); if (old && old.ws === other && s.charId !== Number(c.id)) Chars.flush(old);
        other.send(JSON.stringify({ t: 'kicked', text: 'This account logged in somewhere else.' })); other.close();
      }
      // Back on a character whose shop was open: it closes (unless this is the same game reconnecting).
      const vendNote = await Vend.login(Number(c.id), !!msg.vendResume).catch((e) => { console.error(e); return null; });
      // The server holds the character's items, Zeny, EXP, levels and stats from here on.
      const st = await Chars.load(Number(c.id), acct.id, ws, !!acct.is_admin || ADMINS.has(acct.username.toLowerCase())).catch((e) => { console.error(e); return null; });
      if (!st || ws.readyState !== 1) { if (ws.readyState === 1) { ws.send(JSON.stringify({ t: 'error', text: 'Couldn’t load your character. Try again.' })); ws.close(); } return; }
      me = { accountId: acct.id, charId: Number(c.id), name: c.name, map: String(msg.map || c.map), x: 0, z: 0, facing: 0, moving: false, look: cleanLook(msg.look), chatT: 0, level: Number(msg.level) || 1 };
      online.set(ws, me);
      await Social.load(me);
      Social.sendPartyTo(me); Social.sendGuildTo(me);
      if (me.partyId) Social.refreshParty(me.partyId).catch(() => {});
      if (me.guild) Social.refreshGuild(me.guild.id).catch(() => {});
      const ts = Trade.sessions.get(me.charId); if (ts) Trade.close(ts, `${me.name} left.`);
      ws.send(JSON.stringify({ t: 'welcome', map: me.map, you: me.charId, players: [...online.values()].filter((s) => s !== me && s.map === me.map).map(publicState).concat(Vend.ghosts(me.map, me.charId)), online: online.size, mobs: World.snapshot(me.map), ground: Ground.list(me.map) }));
      if (vendNote) ws.send(JSON.stringify({ t: 'notice', text: vendNote, toast: true }));
      if (Vend.shops.has(me.charId)) { me.hidden = true; ws.send(JSON.stringify(Vend.mine(Vend.shops.get(me.charId)))); }
      Chars.push(st);
      broadcast(me.map, { t: 'join', p: publicState(me) }, ws);
      return;
    }
    if (me.gone) return;
    if (msg.t === 'op') { Chars.op(me, msg); return; }
    if (msg.t === 'state') {
      const map = String(msg.map || me.map).slice(0, 24);
      const num = (v, d) => (Number.isFinite(Number(v)) ? Math.max(-500, Math.min(500, Number(v))) : d);
      if (map !== me.map) {
        const old = me.map;
        const ts = Trade.sessions.get(me.charId); if (ts) Trade.close(ts, 'The trade ended: a player left the map.');
        broadcast(old, { t: 'leave', id: me.charId }, ws);
        World.leave(me, old);
        me.map = map;
        ws.send(JSON.stringify({ t: 'players', map, players: [...online.values()].filter((s) => s !== me && s.map === map).map(publicState).concat(Vend.ghosts(map, me.charId)), mobs: World.snapshot(map), ground: Ground.list(map) }));
        Object.assign(me, { x: num(msg.x, 0), z: num(msg.z, 0) });
        broadcast(map, { t: 'join', p: publicState(me) }, ws);
        World.join(me);
        return;
      }
      Object.assign(me, { x: num(msg.x, me.x), z: num(msg.z, me.z), facing: num(msg.facing, me.facing), moving: !!msg.moving });
      if (Number.isInteger(msg.level)) me.level = Math.max(1, Math.min(999, msg.level));
      const int = (v, hi) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(hi, Math.round(Number(v)))) : null);
      me.hp = int(msg.hp, 1e7); me.maxHp = int(msg.maxHp, 1e7);
      me.sp = int(msg.sp, 1e7); me.maxSp = int(msg.maxSp, 1e7);
      // The server's monsters see where you are (you join them on your first update).
      if (!me.placed) { me.placed = true; World.join(me); } else World.move(me);
      // HP goes to everyone on the map; SP only to members of the same party.
      const base = { t: 'state', map: me.map, id: me.charId, x: me.x, z: me.z, facing: me.facing, moving: me.moving, hp: me.hp, maxHp: me.maxHp };
      const plain = JSON.stringify(base), withSp = JSON.stringify(Object.assign({}, base, { sp: me.sp, maxSp: me.maxSp }));
      for (const [other, s] of online) {
        if (other === ws || s.map !== me.map || other.readyState !== 1) continue;
        other.send(me.partyId && s.partyId === me.partyId && me.sp != null ? withSp : plain);
      }
    } else if (msg.t === 'look') {
      me.look = cleanLook(msg.look);
      broadcast(me.map, { t: 'look', map: me.map, id: me.charId, look: me.look }, ws);
    } else if (msg.t === 'chat') {
      const now = Date.now();
      if (now - me.chatT < 400) return;   // a little flood protection
      me.chatT = now;
      const text = String(msg.text || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120);
      // "%message" goes to your party, "$message" to your guild, like the classics.
      if (text.startsWith('%') && me.partyId) Social.toParty(me.partyId, { t: 'chat', id: me.charId, from: me.name, text: text.slice(1).trim(), channel: 'party' });
      else if (text.startsWith('$') && me.guild) Social.toGuild(me.guild.id, { t: 'chat', id: me.charId, from: me.name, text: text.slice(1).trim(), channel: 'guild' });
      else if (text) broadcast(me.map, { t: 'chat', id: me.charId, from: me.name, text });
    } else if (typeof msg.t === 'string' && msg.t.startsWith('vend_')) {
      await Vend.handle(ws, me, msg).catch((e) => console.error(e));
    } else if (msg.t === 'mob') {
      // A player's hit, status or knockback on a monster: the server's monster takes it.
      if (['dmg', 'status', 'knock', 'miss'].includes(msg.op)) World.hit(me, msg, ws);
    } else if (msg.t === 'fx') {
      // Cast bars and spell effects, for everyone else on the map to see.
      broadcast(me.map, Object.assign({}, msg, { from: me.charId, map: me.map }), ws);
    } else if (msg.t === 'buff') {
      // A support skill cast on another player: they apply it.
      const target = wsOfChar(Number(msg.to));
      if (target && target.readyState === 1 && online.get(target).map === me.map)
        target.send(JSON.stringify({ t: 'buff', from: me.charId, fromName: me.name, skill: String(msg.skill || '').slice(0, 40), lv: Math.max(1, Math.min(10, Number(msg.lv) || 1)),
          amt: msg.amt != null ? Math.max(0, Math.min(30000, Math.round(Number(msg.amt) || 0))) : undefined,
          song: !!msg.song, dur: msg.song ? Math.max(1, Math.min(30, Math.round(Number(msg.dur) || 20))) : undefined }));
    } else if (msg.t === 'pvp_hit') {
      // Only on PvP maps, only to someone on the same map, and not too fast.
      if (!pvpMaps.has(me.map) || msg.map !== me.map) return;
      const now = Date.now(); me.pvpT = (me.pvpT || []).filter((t) => now - t < 1000); if (me.pvpT.length >= 15) return; me.pvpT.push(now);
      const o = Social.online(Number(msg.to));
      if (!o || o[1].map !== me.map || o[1] === me) return;
      o[0].send(JSON.stringify({ t: 'pvp_hit', from: me.charId, name: me.name, dmg: Math.max(0, Math.min(1e6, Math.round(Number(msg.dmg) || 0))) }));
    } else if (msg.t === 'pvp_kill') {
      if (!pvpMaps.has(me.map)) return;
      const k = Social.online(Number(msg.by));
      if (k && k[1].map === me.map) broadcast(me.map, { t: 'notice', text: `⚔ ${k[1].name} defeated ${me.name}!` });
    } else if (msg.t === 'drop_spawn' || msg.t === 'pickup') {
      Ground.handle(ws, me, msg);
    } else if (typeof msg.t === 'string' && (msg.t.startsWith('trade_') || msg.t.startsWith('inspect_'))) {
      await Trade.handle(ws, me, msg).catch((e) => console.error(e));
    } else if (typeof msg.t === 'string' && (msg.t.startsWith('party_') || msg.t.startsWith('guild_') || msg.t === 'pexp' || msg.t === 'ploot' || msg.t === 'gexp')) {
      await Social.handle(ws, me, msg).catch((e) => { console.error(e); ws.send(JSON.stringify({ t: 'notice', text: 'That didn’t work. Try again.' })); });
    } else if (msg.t === 'action') {
      // Small visual events (attack swing, sit, emote) for others to see.
      const kind = ['attack', 'cast', 'emote'].includes(msg.kind) ? msg.kind : null;
      if (kind) broadcast(me.map, { t: 'action', map: me.map, id: me.charId, kind, data: typeof msg.data === 'string' ? msg.data.slice(0, 24) : null }, ws);
    }
  });
  ws.on('close', () => {
    if (me && online.get(ws) === me) {
      // A shopkeeper who leaves stays sitting at their shop for everyone else.
      online.delete(ws); if (!Vend.away(me)) broadcast(me.map, { t: 'leave', id: me.charId });
      if (me.partyId) Social.refreshParty(me.partyId).catch(() => {});
      if (me.guild) Social.refreshGuild(me.guild.id).catch(() => {});
      World.leave(me);
    }
    const st = me && Chars.mem.get(me.charId);
    if (st && st.ws === ws) Chars.release(st, ws).catch((e) => console.error(e));
  });
});
setInterval(() => { for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); } }, 30_000);

/* ---------------------------------------------------------------- parties & guilds */
const Social = {
  expShown: new Map(),   // guild id -> when its EXP was last pushed to members
  invites: new Map(),   // charId -> { kind, id, from }
  online(charId) { for (const [ws, s] of online) if (s.charId === charId) return [ws, s]; return null; },
  async load(me) {
    const p = (await pool.query('SELECT p.id, p.name FROM party_members m JOIN parties p ON p.id = m.party_id WHERE m.character_id = $1', [me.charId])).rows[0];
    me.partyId = p ? Number(p.id) : null; me.partyName = p ? p.name : null;
    const g = (await pool.query('SELECT g.id, g.name, g.emblem_ver, g.ranks, m.rank FROM guild_members m JOIN guilds g ON g.id = m.guild_id WHERE m.character_id = $1', [me.charId])).rows[0];
    me.guild = g ? { id: Number(g.id), name: g.name, ev: g.emblem_ver, rank: (g.ranks || [])[g.rank] || '', rankNo: g.rank } : null;
  },
  async partyState(id) {
    const p = (await pool.query('SELECT * FROM parties WHERE id = $1', [id])).rows[0];
    if (!p) return null;
    const mem = (await pool.query('SELECT c.id, c.name, c.job, c.base_level FROM party_members m JOIN characters c ON c.id = m.character_id WHERE m.party_id = $1 ORDER BY c.name', [id])).rows;
    return { id: Number(p.id), name: p.name, leader: Number(p.leader_id), expShare: p.exp_share, itemShare: p.item_share,
      members: mem.map((c) => { const o = Social.online(Number(c.id)); return { id: Number(c.id), name: c.name, job: c.job, level: o ? o[1].level : c.base_level, online: !!o, map: o ? o[1].map : null }; }) };
  },
  async guildState(id) {
    const g = (await pool.query('SELECT id, name, master_id, emblem_ver, skill_points, skills, ranks, rank_tax, level, exp FROM guilds WHERE id = $1', [id])).rows[0];
    if (!g) return null;
    const mem = (await pool.query('SELECT c.id, c.name, c.job, c.base_level, m.rank, m.tax FROM guild_members m JOIN characters c ON c.id = m.character_id WHERE m.guild_id = $1 ORDER BY m.rank, c.name', [id])).rows;
    // Each rank has its own EXP tax; a member pays their rank's rate.
    const rankTax = g.ranks.map((_, i) => Number((g.rank_tax || [])[i]) || 0);
    return { id: Number(g.id), name: g.name, master: Number(g.master_id), ev: g.emblem_ver, skillPoints: g.skill_points, skills: g.skills, ranks: g.ranks, rankTax,
      level: g.level, exp: Number(g.exp), next: Social.guildNext(g.level), maxMembers: Social.maxMembers(g.skills),
      members: mem.map((c) => { const o = Social.online(Number(c.id)); return { id: Number(c.id), name: c.name, job: c.job, level: o ? o[1].level : c.base_level, online: !!o, map: o ? o[1].map : null, rank: c.rank, tax: rankTax[c.rank] || 0 }; }) };
  },
  sendTo(me, msg) { const o = Social.online(me.charId); if (o && o[0].readyState === 1) o[0].send(JSON.stringify(msg)); },
  async sendPartyTo(me) { Social.sendTo(me, { t: 'party', party: me.partyId ? await Social.partyState(me.partyId) : null }); },
  async sendGuildTo(me) { Social.sendTo(me, { t: 'guild', guild: me.guild ? await Social.guildState(me.guild.id) : null }); },
  async toParty(id, msg) { for (const [ws, s] of online) if (s.partyId === id && ws.readyState === 1) ws.send(JSON.stringify(msg)); },
  async toGuild(id, msg) { for (const [ws, s] of online) if (s.guild && s.guild.id === id && ws.readyState === 1) ws.send(JSON.stringify(msg)); },
  // Tell everyone on the map what to show next to this player's name.
  pinfo(s) { broadcast(s.map, { t: 'pinfo', id: s.charId, party: s.partyName || null, guild: s.guild || null }); },
  async refreshParty(id) { const st = await Social.partyState(id); for (const [, s] of online) if (s.partyId === id) Social.sendTo(s, { t: 'party', party: st }); },
  async refreshGuild(id) { const st = await Social.guildState(id); for (const [, s] of online) if (s.guild && s.guild.id === id) { Social.sendTo(s, { t: 'guild', guild: st }); } },
  notice(me, text) { Social.sendTo(me, { t: 'notice', text }); },
  findByName(name) { const n = String(name || '').trim().toLowerCase(); for (const [ws, s] of online) if (s.name.toLowerCase() === n) return [ws, s]; return null; },
  NAME: /^[A-Za-z0-9][A-Za-z0-9 '\-]{1,23}$/,
  // Guild skills (classic set) and their max levels.
  GSKILLS: { emblem: 1, extension: 10, leadership: 5, wounds: 5, coldheart: 5, sharpgaze: 5, regen: 3, call: 1 },
  guildNext: (lv) => 1500 * lv,
  maxMembers: (sk) => 16 + 4 * ((sk && sk.extension) || 0),
  // Re-read a member's guild tag (rank names may have changed) and tell their map.
  async retag(gid) {
    for (const [, s] of online) if (s.guild && s.guild.id === gid) { await Social.load(s); Social.pinfo(s); }
  },
  async rankOf(gid, charId) { const r = (await pool.query('SELECT rank FROM guild_members WHERE guild_id = $1 AND character_id = $2', [gid, charId])).rows[0]; return r ? r.rank : 9; },

  async handle(ws, me, m) {
    switch (m.t) {
      /* ---------- party ---------- */
      case 'party_create': {
        if (me.partyId) return Social.notice(me, 'You are already in a party.');
        const name = String(m.name || '').trim().replace(/\s+/g, ' ');
        if (!Social.NAME.test(name)) return Social.notice(me, 'Party names are 2 to 24 letters or numbers.');
        try {
          const r = await pool.query('INSERT INTO parties (name, leader_id) VALUES ($1, $2) RETURNING id', [name, me.charId]);
          await pool.query('INSERT INTO party_members (party_id, character_id) VALUES ($1, $2)', [r.rows[0].id, me.charId]);
          me.partyId = Number(r.rows[0].id); me.partyName = name;
        } catch (e) { if (e.code === '23505') return Social.notice(me, 'That party name is taken.'); throw e; }
        await Social.refreshParty(me.partyId); Social.pinfo(me); return;
      }
      case 'party_invite': {
        const st = me.partyId && await Social.partyState(me.partyId);
        if (!st) return Social.notice(me, 'Create a party first.');
        if (st.leader !== me.charId) return Social.notice(me, 'Only the party leader can invite.');
        if (st.members.length >= 12) return Social.notice(me, 'The party is full (12 members).');
        const t = Social.findByName(m.name);
        if (!t) return Social.notice(me, `${m.name} isn't online.`);
        if (t[1].partyId) return Social.notice(me, `${t[1].name} is already in a party.`);
        Social.invites.set(t[1].charId, { kind: 'party', id: me.partyId, from: me.name });
        t[0].send(JSON.stringify({ t: 'invite', kind: 'party', name: st.name, from: me.name }));
        return Social.notice(me, `Invited ${t[1].name} to ${st.name}.`);
      }
      case 'party_reply': case 'guild_reply': {
        const inv = Social.invites.get(me.charId);
        const kind = m.t === 'party_reply' ? 'party' : 'guild';
        if (!inv || inv.kind !== kind) return;
        Social.invites.delete(me.charId);
        const from = Social.findByName(inv.from);
        if (!m.accept) { if (from) Social.notice(from[1], `${me.name} declined.`); return; }
        if (kind === 'party') {
          if (me.partyId) return Social.notice(me, 'You are already in a party.');
          await pool.query('INSERT INTO party_members (party_id, character_id) VALUES ($1, $2)', [inv.id, me.charId]);
          const p = (await pool.query('SELECT name FROM parties WHERE id = $1', [inv.id])).rows[0];
          me.partyId = inv.id; me.partyName = p ? p.name : null;
          await Social.refreshParty(inv.id); Social.pinfo(me);
          Social.toParty(inv.id, { t: 'notice', text: `${me.name} joined the party.` });
        } else {
          if (me.guild) return Social.notice(me, 'You are already in a guild.');
          await pool.query('INSERT INTO guild_members (guild_id, character_id, rank) VALUES ($1, $2, 3)', [inv.id, me.charId]);
          await Social.load(me);
          await Social.refreshGuild(inv.id); Social.pinfo(me);
          Social.toGuild(inv.id, { t: 'notice', text: `${me.name} joined the guild.` });
        }
        return;
      }
      case 'party_leave': case 'party_kick': {
        if (!me.partyId) return;
        const pid = me.partyId, st = await Social.partyState(pid);
        const who = m.t === 'party_leave' ? me.charId : Number(m.id);
        if (m.t === 'party_kick' && st.leader !== me.charId) return Social.notice(me, 'Only the leader can remove members.');
        await pool.query('DELETE FROM party_members WHERE party_id = $1 AND character_id = $2', [pid, who]);
        const left = st.members.filter((x) => x.id !== who);
        if (!left.length) await pool.query('DELETE FROM parties WHERE id = $1', [pid]);
        else if (st.leader === who) await pool.query('UPDATE parties SET leader_id = $2 WHERE id = $1', [pid, (left.find((x) => x.online) || left[0]).id]);
        const o = Social.online(who);
        if (o) { o[1].partyId = null; o[1].partyName = null; Social.sendTo(o[1], { t: 'party', party: null }); Social.pinfo(o[1]); Social.notice(o[1], m.t === 'party_leave' ? 'You left the party.' : 'You were removed from the party.'); }
        if (left.length) { await Social.refreshParty(pid); Social.toParty(pid, { t: 'notice', text: `${(st.members.find((x) => x.id === who) || {}).name} left the party.` }); }
        return;
      }
      case 'party_settings': {
        const st = me.partyId && await Social.partyState(me.partyId);
        if (!st || st.leader !== me.charId) return Social.notice(me, 'Only the leader can change party settings.');
        const expShare = m.expShare === 'even' ? 'even' : 'each', itemShare = m.itemShare === 'party' ? 'party' : 'each';
        if (expShare === 'even') {
          const lv = st.members.filter((x) => x.online).map((x) => x.level);
          if (lv.length && Math.max(...lv) - Math.min(...lv) > 15) return Social.notice(me, 'Even Share needs every online member within 15 base levels of each other.');
        }
        await pool.query('UPDATE parties SET exp_share = $2, item_share = $3 WHERE id = $1', [me.partyId, expShare, itemShare]);
        await Social.refreshParty(me.partyId); return;
      }
      case 'pexp': {
        // Even Share: split a kill's EXP among party members on the same map.
        const st = me.partyId && await Social.partyState(me.partyId), mine = Chars.mem.get(me.charId);
        const base = Math.max(0, Math.min(1e8, Math.floor(Number(m.base) || 0))), job = Math.max(0, Math.min(1e8, Math.floor(Number(m.job) || 0)));
        // One kill's EXP, within reason (rewards move to the server in a later phase).
        if (!mine || (!mine.admin && (base > Ref.cap.base || job > Ref.cap.job || !Chars.allow(mine, 'exp', 60, 10000)))) return;
        const here = st && st.expShare === 'even' ? st.members.filter((x) => x.online && x.map === me.map) : [];
        const list = here.length ? here : [{ id: me.charId }];
        for (const x of list) {
          const o = Social.online(x.id), cs = Chars.mem.get(x.id); if (!o || !cs) continue;
          const b = Math.floor(base / list.length), j = Math.floor(job / list.length);
          Chars.addExp(cs, b, j);
          Social.sendTo(o[1], { t: 'gainexp', base: b, job: j, from: me.name, shared: list.length > 1 });
        }
        return;
      }
      case 'ploot': {
        // Party Share: each drop goes to a random member on the map.
        const st = me.partyId && await Social.partyState(me.partyId);
        const item = String(m.item || ''), qty = Math.max(1, Math.min(1000, Math.floor(Number(m.qty) || 1)));
        const mine = Chars.mem.get(me.charId);
        if (!Ref.item(item) || !mine || !Chars.allow(mine, 'gain', 40, 10000)) return;
        const here = st && st.itemShare === 'party' ? st.members.filter((x) => x.online && x.map === me.map) : [];
        const pick = here.length ? here[Math.floor(Math.random() * here.length)] : { id: me.charId };
        const o = Social.online(pick.id), cs = Chars.mem.get(pick.id);
        if (o && cs && Chars.add(cs, 'bag', item, qty)) { cs.dirty = true; Chars.push(cs, null, true); Social.sendTo(o[1], { t: 'loot_gift', item, qty, from: me.name }); }
        return;
      }
      /* ---------- guild ---------- */
      case 'guild_create': {
        if (me.guild) return Social.notice(me, 'You are already in a guild.');
        const name = String(m.name || '').trim().replace(/\s+/g, ' ');
        if (!Social.NAME.test(name)) return Social.notice(me, 'Guild names are 2 to 24 letters or numbers.');
        const cs = Chars.mem.get(me.charId);
        if (!cs || !Chars.count(cs, 'emperium')) return Social.notice(me, 'Founding a guild needs an Emperium.');
        try {
          const r = await pool.query('INSERT INTO guilds (name, master_id) VALUES ($1, $2) RETURNING id', [name, me.charId]);
          Chars.takeId(cs, 'emperium', 1); cs.dirty = true;
          await pool.query('INSERT INTO guild_members (guild_id, character_id, rank) VALUES ($1, $2, 0)', [r.rows[0].id, me.charId]);
          await Social.load(me);
        } catch (e) { if (e.code === '23505') return Social.notice(me, 'That guild name is taken.'); throw e; }
        Social.sendTo(me, { t: 'guild_created', name });
        await Social.refreshGuild(me.guild.id); Social.pinfo(me); return;
      }
      case 'guild_invite': {
        const st = me.guild && await Social.guildState(me.guild.id);
        if (!st) return Social.notice(me, 'You are not in a guild.');
        if ((await Social.rankOf(st.id, me.charId)) > 1) return Social.notice(me, 'Only the Guild Leader and Officers can invite.');
        if (st.members.length >= st.maxMembers) return Social.notice(me, `The guild is full (${st.maxMembers} members). Guild Extension raises the limit.`);
        const t = Social.findByName(m.name);
        if (!t) return Social.notice(me, `${m.name} isn't online.`);
        if (t[1].guild) return Social.notice(me, `${t[1].name} is already in a guild.`);
        Social.invites.set(t[1].charId, { kind: 'guild', id: st.id, from: me.name });
        t[0].send(JSON.stringify({ t: 'invite', kind: 'guild', name: st.name, from: me.name }));
        return Social.notice(me, `Invited ${t[1].name} to ${st.name}.`);
      }
      case 'guild_leave': case 'guild_expel': {
        if (!me.guild) return;
        const gid = me.guild.id, st = await Social.guildState(gid);
        if (m.t === 'guild_leave' && st.master === me.charId) {
          // The master breaking the guild disbands it, like the classics.
          await pool.query('DELETE FROM guilds WHERE id = $1', [gid]);
          for (const [, s] of online) if (s.guild && s.guild.id === gid) { s.guild = null; Social.sendTo(s, { t: 'guild', guild: null }); Social.pinfo(s); Social.notice(s, `${st.name} was disbanded.`); }
          return;
        }
        const who = m.t === 'guild_leave' ? me.charId : Number(m.id);
        if (m.t === 'guild_expel' && ((await Social.rankOf(gid, me.charId)) > 1 || (await Social.rankOf(gid, who)) <= 1 && st.master !== me.charId))
          return Social.notice(me, 'Only the Guild Leader (or an Officer, for Members and Newbies) can expel.');
        if (who === st.master) return;
        await pool.query('DELETE FROM guild_members WHERE guild_id = $1 AND character_id = $2', [gid, who]);
        const o = Social.online(who);
        if (o) { o[1].guild = null; Social.sendTo(o[1], { t: 'guild', guild: null }); Social.pinfo(o[1]); Social.notice(o[1], m.t === 'guild_leave' ? `You left ${st.name}.` : `You were expelled from ${st.name}.`); }
        await Social.refreshGuild(gid); return;
      }
      case 'guild_skill': {
        const st = me.guild && await Social.guildState(me.guild.id);
        if (!st || st.master !== me.charId) return Social.notice(me, 'Only the guild master can learn guild skills.');
        const max = Social.GSKILLS[m.skill], cur = (st.skills && st.skills[m.skill]) || 0;
        if (!max || cur >= max) return;
        if (st.skillPoints < 1) return Social.notice(me, 'No guild skill points left. The guild earns one each level.');
        await pool.query('UPDATE guilds SET skill_points = skill_points - 1, skills = skills || jsonb_build_object($2::text, $3::int) WHERE id = $1', [st.id, m.skill, cur + 1]);
        await Social.refreshGuild(st.id); return;
      }
      case 'guild_rank_name': {
        const st = me.guild && await Social.guildState(me.guild.id);
        if (!st || st.master !== me.charId) return Social.notice(me, 'Only the Guild Leader can rename ranks.');
        const i = Number(m.index), name = String(m.name || '').trim().slice(0, 20);
        if (!(i >= 0 && i < st.ranks.length) || !/^[A-Za-z0-9][A-Za-z0-9 '\-]{0,19}$/.test(name)) return Social.notice(me, 'Rank names are 1 to 20 letters or numbers.');
        await pool.query('UPDATE guilds SET ranks = jsonb_set(ranks, ARRAY[$2::text], to_jsonb($3::text)) WHERE id = $1', [st.id, i, name]);
        await Social.retag(st.id); await Social.refreshGuild(st.id); return;
      }
      case 'guild_set_rank': {
        const st = me.guild && await Social.guildState(me.guild.id);
        if (!st || st.master !== me.charId) return Social.notice(me, 'Only the Guild Leader can change ranks.');
        const who = Number(m.id), rank = Number(m.rank);
        if (who === st.master || !(rank >= 1 && rank < st.ranks.length)) return;
        await pool.query('UPDATE guild_members SET rank = $3 WHERE guild_id = $1 AND character_id = $2', [st.id, who, rank]);
        await Social.retag(st.id); await Social.refreshGuild(st.id); return;
      }
      case 'guild_rank_tax': {
        // The Guild Leader sets the EXP tax of one rank (0-50%).
        const st = me.guild && await Social.guildState(me.guild.id);
        if (!st || st.master !== me.charId) return Social.notice(me, 'Only the Guild Leader can set rank taxes.');
        const i = Number(m.index);
        if (!(i >= 0 && i < st.ranks.length)) return;
        const tax = Math.max(0, Math.min(50, Math.floor(Number(m.tax) || 0)));
        // One atomic update, so quick changes to several ranks can't overwrite each other.
        await pool.query(`UPDATE guilds SET rank_tax = jsonb_set(
            (SELECT COALESCE(jsonb_agg(COALESCE(rank_tax -> n, '0'::jsonb) ORDER BY n), '[]'::jsonb) FROM generate_series(0, jsonb_array_length(ranks) - 1) AS n),
            ARRAY[$2::text], to_jsonb($3::int)) WHERE id = $1`, [st.id, i, tax]);
        await Social.refreshGuild(st.id); return;
      }
      case 'guild_rank_add': {
        // Up to 8 ranks (the leader's rank and 7 more).
        const st = me.guild && await Social.guildState(me.guild.id);
        if (!st || st.master !== me.charId) return Social.notice(me, 'Only the Guild Leader can add ranks.');
        if (st.ranks.length >= 8) return Social.notice(me, 'A guild can have up to 8 ranks.');
        const name = String(m.name || '').trim().slice(0, 20) || `Rank ${st.ranks.length + 1}`;
        if (!/^[A-Za-z0-9][A-Za-z0-9 '\-]{0,19}$/.test(name)) return Social.notice(me, 'Rank names are 1 to 20 letters or numbers.');
        // Atomic append (and the 8-rank limit checked in the same statement).
        const r = await pool.query(`UPDATE guilds SET ranks = ranks || to_jsonb($2::text),
            rank_tax = (SELECT COALESCE(jsonb_agg(COALESCE(rank_tax -> n, '0'::jsonb) ORDER BY n), '[]'::jsonb) FROM generate_series(0, jsonb_array_length(ranks) - 1) AS n) || '[0]'::jsonb
            WHERE id = $1 AND jsonb_array_length(ranks) < 8 RETURNING id`, [st.id, name]);
        if (!r.rowCount) return Social.notice(me, 'A guild can have up to 8 ranks.');
        await Social.refreshGuild(st.id); return;
      }
      case 'gexp': {
        // EXP a member pays into the guild; the guild levels up and earns skill points.
        if (!me.guild) return;
        const amt = Math.max(0, Math.min(1e7, Math.floor(Number(m.amount) || 0)));
        if (!amt) return;
        const g = (await pool.query('UPDATE guilds SET exp = exp + $2 WHERE id = $1 RETURNING level, exp', [me.guild.id, amt])).rows[0];
        let { level } = g, exp = Number(g.exp), ups = 0;
        while (level < 50 && exp >= Social.guildNext(level)) { exp -= Social.guildNext(level); level++; ups++; }
        if (ups) {
          await pool.query('UPDATE guilds SET level = $2, exp = $3, skill_points = skill_points + $4 WHERE id = $1', [me.guild.id, level, exp, ups]);
          Social.toGuild(me.guild.id, { t: 'notice', text: `Your guild reached level ${level}! (+${ups} guild skill point${ups > 1 ? 's' : ''})` });
          await Social.refreshGuild(me.guild.id);
        } else {
          // Keep everyone's guild EXP bar current (at most every few seconds).
          const now = Date.now(), last = Social.expShown.get(me.guild.id) || 0;
          if (now - last > 3000) { Social.expShown.set(me.guild.id, now); await Social.refreshGuild(me.guild.id); }
        }
        return;
      }
      case 'guild_call': {
        // Emergency Call: the Guild Leader summons every online member.
        const st = me.guild && await Social.guildState(me.guild.id);
        if (!st || st.master !== me.charId || !(st.skills && st.skills.call)) return;
        for (const [ws2, s] of online) if (s.guild && s.guild.id === st.id && s !== me && ws2.readyState === 1)
          ws2.send(JSON.stringify({ t: 'guild_summon', map: me.map, x: me.x, z: me.z, from: me.name }));
        return Social.notice(me, 'Emergency Call: your guild is on its way.');
      }
      case 'guild_emblem': {
        const st = me.guild && await Social.guildState(me.guild.id);
        if (!st || st.master !== me.charId) return Social.notice(me, 'Only the guild master can change the emblem.');
        if (!st.skills || !st.skills.emblem) return Social.notice(me, 'Learn the Guild Emblem skill first.');
        const data = String(m.data || '');
        if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data) || data.length > 20000) return Social.notice(me, 'The emblem must be a small PNG image.');
        const buf = Buffer.from(data.split(',')[1], 'base64');
        if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(16) > 64 || buf.readUInt32BE(20) > 64) return Social.notice(me, 'The emblem must be a PNG of at most 64×64 pixels.');
        const r = await pool.query('UPDATE guilds SET emblem = $2, emblem_ver = emblem_ver + 1 WHERE id = $1 RETURNING emblem_ver', [st.id, data]);
        for (const [, s] of online) if (s.guild && s.guild.id === st.id) { s.guild.ev = r.rows[0].emblem_ver; Social.pinfo(s); }
        await Social.refreshGuild(st.id); return;
      }
    }
  },
};

/* ---------------------------------------------------------------- items on the ground
   Shared by everyone on a map, like the classics: monster drops belong to the
   killer (and their party) for a few seconds, then anyone may take them;
   everything vanishes after a minute. The server decides who gets each item. */
// Maps where players can fight each other (the map editor's PvP rule).
const pvpMaps = new Set();
const Ground = {
  maps: new Map(), next: 1, LIFE: 60000, PRIORITY: 5000,
  on(map) { if (!this.maps.has(map)) this.maps.set(map, new Map()); return this.maps.get(map); },
  pub(it, now) { return { gid: it.gid, id: it.id, qty: it.qty, refine: it.refine, cards: it.cards, forgedBy: it.forgedBy, element: it.element, x: it.x, z: it.z, fx: it.fx, fz: it.fz,
    owner: it.owner, party: it.party, ownerName: it.ownerName, priority: Math.max(0, it.until - now), age: (now - it.born) / 1000, kill: it.kill }; },
  list(map) { const now = Date.now(); return [...(this.maps.get(map) || new Map()).values()].map((it) => this.pub(it, now)); },
  handle(ws, me, m) {
    const num = (v) => Math.max(-500, Math.min(500, Number(v) || 0)), now = Date.now();
    if (m.t === 'drop_spawn') {
      if (m.map !== me.map) return;
      const id = String(m.id || '');
      if (!(id === 'zeny' || /^[a-z0-9_]{1,40}$/.test(id))) return;
      const items = this.on(me.map);
      if (items.size >= 400) return;
      let it = { gid: this.next++, id, qty: Math.max(1, Math.min(id === 'zeny' ? 1e7 : 30000, Math.floor(Number(m.qty) || 1))),
        refine: Math.max(0, Math.min(10, Math.floor(Number(m.refine) || 0))), cards: Array.isArray(m.cards) ? m.cards.slice(0, 4).map(String) : [],
        forgedBy: m.forgedBy ? String(m.forgedBy).slice(0, 24) : undefined, element: m.element ? String(m.element).slice(0, 12) : undefined };
      if (!m.kill) {
        // A player dropping something from their bag: it must really be there, and it leaves the bag here.
        const st = Chars.mem.get(me.charId), e = st && Chars.find(st, Number(m.uid));
        if (!e || e.id !== id) { if (st) Chars.push(st, 'That item isn’t in your bag any more.'); return; }
        const got = Chars.take(st, e.uid, it.qty); st.dirty = true;
        it = { gid: it.gid, id, qty: got.qty, refine: got.refine || 0, cards: got.cards || [], forgedBy: got.forgedBy, element: got.element };
      } else if (id !== 'zeny' && !Ref.item(id)) return;   // monster drops: checked properly once rewards move to the server
      Object.assign(it, { x: num(m.x), z: num(m.z), fx: num(m.fx), fz: num(m.fz), born: now,
        kill: !!m.kill, owner: m.kill ? me.charId : null, ownerName: me.name, party: m.kill ? me.partyId || null : null, until: m.kill ? now + this.PRIORITY : 0 });
      items.set(it.gid, it);
      broadcast(me.map, { t: 'ground_add', map: me.map, item: this.pub(it, now) });
    } else if (m.t === 'pickup') {
      const items = this.maps.get(me.map), it = items && items.get(Number(m.gid));
      const deny = (text) => ws.send(JSON.stringify({ t: 'ground_deny', gid: Number(m.gid), text }));
      if (!it) return deny('Someone else got there first.');
      const mine = it.owner === me.charId || (it.party && it.party === me.partyId);
      // Auto-loot flies your own drops to you; otherwise you must be close.
      if (!(mine && m.auto) && Math.hypot(me.x - it.x, me.z - it.z) > 4.5) return deny('You need to be closer to pick that up.');
      if (now < it.until && !mine) return deny(`That belongs to ${it.ownerName} for a moment longer.`);
      // The item goes straight into the server's copy of your character.
      const st = Chars.mem.get(me.charId);
      if (!st) return deny('Please wait a moment.');
      if (it.id === 'zeny') st.zeny = Math.min(2147483647, st.zeny + it.qty);
      else if (!Chars.add(st, 'bag', it.id, it.qty, it)) return deny('Your inventory is full.');
      st.dirty = true; Chars.push(st, null, true);
      items.delete(it.gid);
      ws.send(JSON.stringify({ t: 'ground_take', gid: it.gid, item: this.pub(it, now) }));
      broadcast(me.map, { t: 'ground_remove', map: me.map, gid: it.gid }, ws);
    }
  },
};
setInterval(() => {
  const now = Date.now();
  for (const [map, items] of Ground.maps) for (const it of items.values()) if (now - it.born > Ground.LIFE) { items.delete(it.gid); broadcast(map, { t: 'ground_remove', map, gid: it.gid }); }
}, 3000);

/* ---------------------------------------------------------------- trading & inspecting */
const Trade = {
  sessions: new Map(),   // charId -> session
  asks: new Map(),       // target charId -> asking charId
  other(sess, id) { return sess.a === id ? sess.b : sess.a; },
  push(sess) {
    for (const id of [sess.a, sess.b]) {
      const o = Social.online(id); if (!o) continue;
      const mine = sess.off[id], theirs = sess.off[Trade.other(sess, id)];
      o[0].send(JSON.stringify({ t: 'trade_state', mine, theirs }));
    }
  },
  close(sess, text) {
    for (const id of [sess.a, sess.b]) { Trade.sessions.delete(id); const o = Social.online(id); if (o) o[0].send(JSON.stringify({ t: 'trade_closed', text })); }
  },
  cleanItem(it) {
    if (!it || !/^[a-z0-9_]{1,40}$/.test(String(it.id))) return null;
    return { uid: Number(it.uid) || 0, id: String(it.id), qty: Math.max(1, Math.min(30000, Math.floor(Number(it.qty) || 1))),
      refine: Math.max(0, Math.min(10, Math.floor(Number(it.refine) || 0))), cards: Array.isArray(it.cards) ? it.cards.slice(0, 4).map(String) : [],
      forgedBy: it.forgedBy ? String(it.forgedBy).slice(0, 24) : undefined, element: it.element ? String(it.element).slice(0, 12) : undefined };
  },
  async handle(ws, me, m) {
    const sess = Trade.sessions.get(me.charId);
    switch (m.t) {
      case 'inspect_req': {
        const o = Social.online(Number(m.to));
        if (o && o[1].map === me.map) o[0].send(JSON.stringify({ t: 'inspect_req', from: me.charId }));
        return;
      }
      case 'inspect_res': {
        const o = Social.online(Number(m.to));
        const small = (v) => (v && typeof v === 'object' && JSON.stringify(v).length < 3000 ? v : null);
        if (o) o[0].send(JSON.stringify({ t: 'inspect_res', from: me.charId, name: me.name, job: m.job, level: m.level, equip: Array.isArray(m.equip) ? m.equip.slice(0, 12) : [], stats: small(m.stats), look: small(m.look) }));
        return;
      }
      case 'trade_request': {
        const o = Social.online(Number(m.to));
        if (!o || o[1].map !== me.map) return Social.notice(me, 'That player is too far away.');
        if (sess || Trade.sessions.has(o[1].charId)) return Social.notice(me, `${o[1].name} is busy trading.`);
        Trade.asks.set(o[1].charId, me.charId);
        o[0].send(JSON.stringify({ t: 'trade_ask', from: me.name }));
        return Social.notice(me, `Asked ${o[1].name} to trade.`);
      }
      case 'trade_reply': {
        const askId = Trade.asks.get(me.charId); Trade.asks.delete(me.charId);
        const o = askId && Social.online(askId);
        if (!o) return;
        if (!m.accept) return Social.notice(o[1], `${me.name} declined to trade.`);
        if (Trade.sessions.has(askId) || sess) return;
        const blank = () => ({ items: [], zeny: 0, locked: false, ok: false });
        const s2 = { a: askId, b: me.charId, off: { [askId]: blank(), [me.charId]: blank() } };
        Trade.sessions.set(askId, s2); Trade.sessions.set(me.charId, s2);
        o[0].send(JSON.stringify({ t: 'trade_open', with: me.name }));
        ws.send(JSON.stringify({ t: 'trade_open', with: o[1].name }));
        return Trade.push(s2);
      }
      case 'trade_add': case 'trade_remove': case 'trade_zeny': case 'trade_lock': {
        if (!sess) return;
        const off = sess.off[me.charId];
        if (off.locked) return;
        const st = Chars.mem.get(me.charId);
        if (!st) return;
        if (m.t === 'trade_add') {
          // Only items really in your bag, as the server knows them.
          const want = Trade.cleanItem(m.item), e = want && Chars.find(st, want.uid);
          if (!e || e.id !== want.id) { Chars.push(st); return Social.notice(me, 'That item isn’t in your bag any more.'); }
          if (off.items.length >= 10 || off.items.some((x) => x.uid === e.uid)) return;
          off.items.push(Object.assign(Chars.out(e), { qty: Math.min(want.qty, e.qty) }));
        } else if (m.t === 'trade_remove') off.items = off.items.filter((x) => x.uid !== Number(m.uid));   // taken back before locking
        else if (m.t === 'trade_zeny') off.zeny = Math.max(0, Math.min(st.zeny, Math.floor(Number(m.amount) || 0)));
        else off.locked = true;
        return Trade.push(sess);
      }
      case 'trade_ok': {
        if (!sess) return;
        const mine = sess.off[me.charId], theirs = sess.off[Trade.other(sess, me.charId)];
        if (!mine.locked || !theirs.locked) return;
        mine.ok = true;
        if (!theirs.ok) return Trade.push(sess);
        // Both sides pressed Trade: the server checks both offers again and swaps the goods.
        const A = Chars.mem.get(sess.a), B = Chars.mem.get(sess.b);
        if (!A || !B) return Trade.close(sess, 'The trade failed: a player left.');
        const ok = (st, off, other) => off.zeny <= st.zeny && off.items.every((it) => { const e = Chars.find(st, it.uid); return e && e.id === it.id && e.qty >= it.qty; })
          && other.bag.length + sess.off[st.id].items.length <= BAG_MAX + 10;
        if (!ok(A, sess.off[sess.a], B) || !ok(B, sess.off[sess.b], A)) return Trade.close(sess, 'The trade failed: an offer changed.');
        const moved = {};
        for (const [from, to] of [[A, B], [B, A]]) {
          const off = sess.off[from.id];
          moved[from.id] = off.items.map((it) => Chars.take(from, it.uid, it.qty));
          from.zeny -= off.zeny;
        }
        for (const [from, to] of [[A, B], [B, A]]) {
          for (const it of moved[from.id]) {
            // Trades always fit (like the game, weight is not checked); a full bag still takes the items.
            if (!Chars.add(to, 'bag', it.id, it.qty, it)) to.bag.push(Object.assign({}, it, { uid: to.nextUid++ }));
          }
          to.zeny = Math.min(2147483647, to.zeny + sess.off[from.id].zeny);
        }
        A.dirty = B.dirty = true;
        for (const id of [sess.a, sess.b]) Trade.sessions.delete(id);
        await Chars.flush(A, B);
        for (const [st, id] of [[A, sess.a], [B, sess.b]]) {
          const o = Social.online(id); if (!o) continue;
          Chars.push(st);
          o[0].send(JSON.stringify({ t: 'trade_done', give: sess.off[id], get: sess.off[Trade.other(sess, id)] }));
        }
        return;
      }
      case 'trade_cancel': if (sess) Trade.close(sess, `${me.name} cancelled the trade.`); return;
    }
  },
};

/* ---------------------------------------------------------------- reference data (SQL)
   The game's data files fill these tables on every start (see start()); the
   server's own rules then read items, jobs, shops and quests from them. */
let GD = {};   // the game's shared JS, for formulas (stat costs, refine rates, EXP table)
const Ref = {
  items: new Map(), jobs: new Map(), shops: new Map(), quests: new Map(), cap: { base: 0, job: 0 },
  item(id) { return this.items.get(id) || null; },
  async load() {
    this.items = new Map((await pool.query('SELECT id, data FROM item_defs')).rows.map((r) => [r.id, r.data]));
    this.jobs = new Map((await pool.query('SELECT * FROM job_defs')).rows.map((r) => [r.id, r]));
    const q = (await pool.query('SELECT * FROM quest_defs')).rows, rw = (await pool.query('SELECT * FROM quest_rewards')).rows;
    this.quests = new Map(q.map((r) => [r.id, Object.assign(r, { rewards: rw.filter((x) => x.quest_id === r.id) })]));
    // The most EXP one kill can give, doubled to allow for EXP-bonus gear.
    const m = (await pool.query("SELECT max((data->>'exp')::float) AS b, max((data->>'jobExp')::float) AS j FROM monster_defs")).rows[0] || {};
    const rate = (GD.Config && GD.Config.EXP_RATE) || 1;
    this.cap = { base: Math.ceil((m.b || 0) * rate * 2) + 10, job: Math.ceil((m.j || 0) * rate * 2) + 10 };
    await this.loadShops();
  },
  async loadShops() {
    const rows = (await pool.query('SELECT shop_id, item_id, price FROM shop_items')).rows;
    this.shops = new Map();
    for (const r of rows) { if (!this.shops.has(r.shop_id)) this.shops.set(r.shop_id, new Map()); this.shops.get(r.shop_id).set(r.item_id, r.price); }
  },
  // Shop NPCs placed with the map editor sell what the editor gave them.
  async syncCustomShops() {
    const shops = [], items = [];
    for (const r of (await pool.query('SELECT data FROM custom_maps')).rows) {
      for (const e of (r.data && r.data.entities) || []) {
        if (e.type !== 'npc' || (e.role || 'talk') !== 'shop' || e.u == null) continue;
        const id = 'custom_' + e.u;
        if (shops.some((s) => s.id === id)) continue;
        shops.push({ id, name: String(e.shopName || `${e.name || 'Villager'}’s shop`).slice(0, 60), npc: id });
        (e.stock || []).forEach((it, i) => { const d = this.item(it); if (d && !items.some((x) => x.shop_id === id && x.item_id === it)) items.push({ shop_id: id, item_id: it, price: Math.max(1, Math.round(d.price || 1)), sort: i }); });
      }
    }
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('DELETE FROM shops WHERE custom');
      await c.query('INSERT INTO shops (id, name, npc, custom) SELECT id, name, npc, true FROM jsonb_to_recordset($1::jsonb) AS x(id text, name text, npc text) ON CONFLICT (id) DO NOTHING', [JSON.stringify(shops)]);
      await c.query('INSERT INTO shop_items (shop_id, item_id, price, sort) SELECT shop_id, item_id, price, sort FROM jsonb_to_recordset($1::jsonb) AS x(shop_id text, item_id text, price int, sort int) ON CONFLICT DO NOTHING', [JSON.stringify(items)]);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
    await this.loadShops();
  },
  // Can this job use gear made for 'jobs'? (Second jobs inherit their first job's gear.)
  canUse(jobs, jobId) {
    if (!jobs || jobs === 'all') return true;
    for (let j = jobId; j && j !== 'novice'; j = (this.jobs.get(j) || {}).from_job) if (jobs.includes(j)) return true;
    return jobId === 'novice' && jobs.includes('novice');
  },
};

/* ---------------------------------------------------------------- character state
   While a character is online the server holds its bag, equipment, cart,
   storage, Zeny, EXP, levels, job and stats here. They change only through the
   operations below (buy, sell, use, equip, refine, trade, drop, pick up...),
   each checked against the reference data, and are written to the tables in a
   transaction every few seconds, on logout and straight after a trade. The
   game sends what it wants to do and gets the corrected character back. */
const BAG_MAX = 100, CART_MAX = 100, STORAGE_MAX = 300;
const Chars = {
  mem: new Map(),        // charId -> state
  flushing: new Map(),   // accountId -> promise of the last write
  out: (e) => ({ uid: e.uid, id: e.id, qty: e.qty, refine: e.refine || 0, cards: e.cards || [], forgedBy: e.forgedBy || undefined, element: e.element || undefined }),
  row: (r, uid) => ({ uid, id: r.item_id, qty: r.qty, refine: r.refine || 0, cards: r.cards || [], forgedBy: r.forged_by || undefined, element: r.element || undefined }),

  async load(charId, accountId, ws, admin) {
    let st = this.mem.get(charId);
    if (st) { st.ws = ws; st.admin = admin; return st; }   // a reconnect takes over the live state
    await this.flushing.get(accountId);
    const c = (await pool.query('SELECT * FROM characters WHERE id = $1 AND account_id = $2', [charId, accountId])).rows[0];
    if (!c) return null;
    const items = (await pool.query('SELECT * FROM character_items WHERE character_id = $1 ORDER BY sort, id', [charId])).rows;
    const store = (await pool.query('SELECT * FROM storage_items WHERE account_id = $1 ORDER BY sort, id', [accountId])).rows;
    const quests = (await pool.query('SELECT quest_id FROM character_quests WHERE character_id = $1', [charId])).rows.map((r) => r.quest_id);
    let uid = 1;
    st = { id: Number(c.id), accountId, name: c.name, ws, admin, job: c.job, baseLevel: c.base_level, jobLevel: c.job_level, baseExp: Number(c.base_exp), jobExp: Number(c.job_exp),
      zeny: Number(c.zeny), stats: c.stats || {}, statPoints: c.stat_points, skills: (c.skills && c.skills.levels) || {}, bag: [], equip: {}, cart: [], storage: [],
      quests: new Set(quests), newQuests: [], seq: 0, dirty: false, rl: {} };
    for (const r of items) {
      const e = this.row(r, 0);
      if (r.location === 'equip' && r.equip_slot) st.equip[r.equip_slot] = e; else (r.location === 'cart' ? st.cart : st.bag).push(e);
    }
    // Same numbering as the game's own load: bag first, then equipment.
    for (const e of st.bag) e.uid = uid++;
    for (const k in st.equip) st.equip[k].uid = uid++;
    for (const e of st.cart) e.uid = uid++;
    st.storage = store.map((r) => this.row(r, uid++));
    st.nextUid = Math.max(uid, 100);
    const S = GD.Stats;
    if (!c.stats || !Object.keys(c.stats).length) {
      // Never played: the starting stats (and kit, for characters made before the server gave it).
      st.stats = { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 }; st.statPoints = S.START_POINTS; st.dirty = true;
      if (!items.length) this.giveKit(st);
    } else if (!(c.extra && c.extra.statFix)) { st.statPoints += Math.max(0, S.totalPoints(st.baseLevel) - S.oldTotalPoints(st.baseLevel)); st.dirty = true; }
    // Quests finished before the server kept track of them.
    const old = (c.extra && c.extra.quests && Array.isArray(c.extra.quests.done) ? c.extra.quests.done : []).filter((q) => Ref.quests.has(q) && !st.quests.has(q));
    for (const q of old) { st.quests.add(q); st.newQuests.push(q); st.dirty = true; }
    this.mem.set(charId, st);
    return st;
  },
  giveKit(st) {
    const kit = GD.Config.START_KIT;
    for (const id of kit.equip) { const d = Ref.item(id); if (d) st.equip[d.slot] = { uid: st.nextUid++, id, qty: 1, refine: 0, cards: [] }; }
    for (const [id, n] of kit.items) this.add(st, 'bag', id, n);
    st.zeny = kit.zeny;
  },

  /* ---- writing to the database ---- */
  rows(st) {
    const rows = [];
    const push = (loc, slot, e, i) => rows.push({ location: loc, equip_slot: slot, item_id: e.id, qty: e.qty, refine: e.refine || 0, cards: e.cards || [], forged_by: e.forgedBy || null, element: e.element || null, sort: i });
    st.bag.forEach((e, i) => push('bag', null, e, i));
    Object.entries(st.equip).forEach(([s, e], i) => { if (e) push('equip', s, e, i); });
    st.cart.forEach((e, i) => push('cart', null, e, i));
    return rows;
  },
  async write(client, st) {
    const items = JSON.stringify(this.rows(st));
    const storage = JSON.stringify(st.storage.map((e, i) => ({ item_id: e.id, qty: e.qty, refine: e.refine || 0, cards: e.cards || [], forged_by: e.forgedBy || null, element: e.element || null, sort: i })));
    const quests = st.newQuests.splice(0);
    await client.query(`UPDATE characters SET job=$2, base_level=$3, job_level=$4, base_exp=$5, job_exp=$6, zeny=$7, stats=$8, stat_points=$9,
      extra = extra || '{"statFix":1}'::jsonb, updated_at=now() WHERE id=$1`, [st.id, st.job, st.baseLevel, st.jobLevel, st.baseExp, st.jobExp, st.zeny, JSON.stringify(st.stats), st.statPoints]);
    await client.query('DELETE FROM character_items WHERE character_id = $1', [st.id]);
    await client.query(`INSERT INTO character_items (character_id, location, equip_slot, item_id, qty, refine, cards, forged_by, element, sort)
      SELECT $1, location, equip_slot, item_id, qty, refine, cards, forged_by, element, sort FROM jsonb_to_recordset($2::jsonb)
      AS x(location text, equip_slot text, item_id text, qty int, refine smallint, cards text[], forged_by text, element text, sort int)`, [st.id, items]);
    // Storage is shared by the account: only the character that changed it writes it (a vendor
    // left logged out keeps an old copy while you play someone else).
    if (st.storageDirty) {
      st.storageDirty = false;
      await client.query('DELETE FROM storage_items WHERE account_id = $1', [st.accountId]);
      await client.query(`INSERT INTO storage_items (account_id, item_id, qty, refine, cards, forged_by, element, sort)
        SELECT $1, item_id, qty, refine, cards, forged_by, element, sort FROM jsonb_to_recordset($2::jsonb)
        AS x(item_id text, qty int, refine smallint, cards text[], forged_by text, element text, sort int)`, [st.accountId, storage]);
    }
    if (quests.length) await client.query('INSERT INTO character_quests (character_id, quest_id) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING', [st.id, quests]);
  },
  // Write one or more characters in a single transaction (a trade writes both sides together).
  flush(...list) {
    list = list.filter((st) => st && st.dirty);
    if (!list.length) return Promise.resolve();
    const prev = Promise.all(list.map((st) => this.flushing.get(st.accountId)));
    const job = prev.then(async () => {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        for (const st of list) { st.dirty = false; await this.write(c, st); }
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK').catch(() => {}); for (const st of list) st.dirty = true; console.error('Saving characters failed:', e.message); }
      finally { c.release(); }
    });
    for (const st of list) this.flushing.set(st.accountId, job);
    return job;
  },
  // The player left: save, then forget the live state (unless they came straight back).
  async release(st, ws) {
    await this.flush(st);
    if (Vend.shops.has(st.id)) { if (st.ws === ws) st.ws = null; return; }   // a shop left open keeps its owner here
    if (st.ws === ws && this.mem.get(st.id) === st && ![...online.values()].some((s) => s.charId === st.id)) this.mem.delete(st.id);
  },

  /* ---- what the game is told ---- */
  view(st, withStorage) {
    const v = { seq: st.seq, job: st.job, baseLevel: st.baseLevel, jobLevel: st.jobLevel, baseExp: st.baseExp, jobExp: st.jobExp, zeny: st.zeny,
      stats: st.stats, statPoints: st.statPoints, bag: st.bag.map(this.out), equip: {}, cart: st.cart.map(this.out) };
    for (const k in st.equip) if (st.equip[k]) v.equip[k] = this.out(st.equip[k]);
    if (withStorage) v.storage = st.storage.map(this.out);
    return v;
  },
  // Send the character now (corrections) or shortly (after new items appear).
  push(st, text, soon) {
    if (soon) { if (!st.pushT) st.pushT = setTimeout(() => { st.pushT = null; this.push(st); }, 200); return; }
    if (st.pushT) { clearTimeout(st.pushT); st.pushT = null; }
    if (st.ws && st.ws.readyState === 1) st.ws.send(JSON.stringify({ t: 'char', s: this.view(st, true), text: text || undefined }));
  },

  /* ---- item helpers ---- */
  find(st, uid) { return st.bag.find((e) => e.uid === uid) || null; },
  // Back into the bag: a stack joins the same item already there.
  stash(st, e) {
    const d = Ref.item(e.id), same = d && d.stack && this.firstOf(st.bag, e.id);
    if (same) same.qty = Math.min(30000, same.qty + e.qty); else st.bag.push(e);
  },
  firstOf(list, id) { return list.find((e) => e.id === id) || null; },
  count(st, id) { return st.bag.reduce((n, e) => n + (e.id === id ? e.qty : 0), 0); },
  // Put items into a list the way the game does: stackables join one stack, gear comes one per entry.
  add(st, where, id, qty, attrs) {
    const d = Ref.item(id), list = st[where];
    if (!d || !(qty > 0)) return false;
    const max = where === 'bag' ? BAG_MAX : where === 'cart' ? CART_MAX : STORAGE_MAX;
    attrs = attrs || {};
    if (d.stack) {
      const e = this.firstOf(list, id);
      if (e) { e.qty = Math.min(30000, e.qty + qty); return true; }
      if (list.length >= max) return false;
      list.push({ uid: st.nextUid++, id, qty: Math.min(30000, qty), refine: 0, cards: [] });
      return true;
    }
    const n = where === 'bag' ? qty : 1;
    if (list.length + n > max) return false;
    for (let i = 0; i < n; i++) list.push({ uid: st.nextUid++, id, qty: where === 'bag' ? 1 : qty, refine: attrs.refine || 0, cards: (attrs.cards || []).slice(0, 4), forgedBy: attrs.forgedBy, element: attrs.element });
    return true;
  },
  // Take qty from one bag entry; returns a copy of what was taken (or null).
  take(st, uid, qty, list) {
    list = list || st.bag;
    const e = list.find((x) => x.uid === uid);
    if (!e || !(qty > 0)) return null;
    const n = Math.min(Math.floor(qty), e.qty);
    e.qty -= n;
    if (e.qty <= 0) list.splice(list.indexOf(e), 1);
    return Object.assign({}, e, { qty: n });
  },
  takeId(st, id, qty) {
    if (this.count(st, id) < qty) return false;
    let left = qty;
    while (left > 0) { const e = this.firstOf(st.bag, id); left -= this.take(st, e.uid, left).qty; }
    return true;
  },
  // Classic leveling: base levels give stat points, job levels stop at the job's maximum.
  addExp(st, base, job) {
    const C = GD.Config, jd = Ref.jobs.get(st.job);
    if (base > 0 && st.baseLevel < C.MAX_LEVEL) {
      st.baseExp += base;
      while (st.baseLevel < C.MAX_LEVEL && st.baseExp >= (C.EXP_TABLE[st.baseLevel] || Infinity)) {
        st.baseExp -= C.EXP_TABLE[st.baseLevel]; st.baseLevel++; st.statPoints += GD.Stats.pointsForLevel(st.baseLevel);
      }
    }
    if (job > 0 && jd) {
      st.jobExp += job;
      const next = () => (st.jobLevel >= jd.max_job_level ? Infinity : (jd.job_exp[st.jobLevel] || Infinity));
      while (st.jobExp >= next()) { st.jobExp -= next(); st.jobLevel++; if (st.jobLevel >= jd.max_job_level) st.jobExp = 0; }
    }
    st.dirty = true;
  },
  // Shop price modifiers from the character's learned skills (Discount, Overcharge, Haggle).
  perk(st, key) {
    let n = 0;
    for (const [id, lv] of Object.entries(st.skills || {})) {
      const s = GD.Skills && GD.Skills.get(id);
      if (s && s.bonus && lv > 0) { try { n += Number((s.bonus(lv, {}) || {})[key]) || 0; } catch (e) { /* needs a live player: not a shop perk */ } }
    }
    return n;
  },
  // Simple per-action limits for things the server can't check yet (until combat and rewards move here).
  allow(st, key, n, ms) {
    if (st.admin) return true;
    const now = Date.now(), list = (st.rl[key] = (st.rl[key] || []).filter((t) => now - t < ms));
    if (list.length >= n) return false;
    list.push(now); return true;
  },
  canEquip(st, d) {
    if (!d || d.type !== 'equip') return 'That can’t be equipped.';
    if (st.baseLevel < (d.reqLevel || 1)) return `Requires base level ${d.reqLevel}.`;
    if (!Ref.canUse(d.jobs, st.job)) return `Your job can’t equip ${d.name}.`;
    const jd = Ref.jobs.get(st.job);
    if (d.slot === 'weapon' && jd && !jd.weapons.includes(d.weaponType)) return `Your job can’t use ${d.name}.`;
    if (d.slot === 'shield') { const w = st.equip.weapon && Ref.item(st.equip.weapon.id); if (w && GD.Items.WEAPON_TYPES[w.weaponType] && GD.Items.WEAPON_TYPES[w.weaponType].twoHanded) return 'Your weapon needs both hands.'; }
    return null;
  },

  /* ---- operations from the game ---- */
  op(me, m) {
    const st = this.mem.get(me.charId);
    if (!st) return;
    const res = this.run(st, m);
    if (Number.isInteger(m.seq)) st.seq = m.seq;
    if (res && res.reply && st.ws.readyState === 1) {
      // Answers (like a refine roll) come after the corrected character.
      this.push(st);
      st.ws.send(JSON.stringify(Object.assign({ t: 'op_res', k: m.k, seq: m.seq }, res.reply)));
      return;
    }
    if (res && res.no) return this.push(st, res.no === true ? null : res.no);   // refused: correct the game
    if (res === 'sync' || (res && res.sync)) return this.push(st);
    if (res && res.soon) this.push(st, null, true);
  },
  run(st, m) {
    const num = (v, lo, hi) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo; };
    const NO = (text) => ({ no: text || true });
    if (m.why === 'debug' && !st.admin) return NO('Only admins can use the debug tools online.');
    switch (m.k) {
      case 'sync': return 'sync';
      /* Things the game decides for now (kills, crafting, skills): checked for sense and rate. */
      case 'gain': {
        const d = Ref.item(String(m.id || '')), qty = num(m.qty, 0, 30000);
        if (!d || !qty) return NO();
        if (!st.admin && (qty > (d.stack ? 500 : 10) || !this.allow(st, 'gain', 40, 10000))) return NO();
        const attrs = { refine: num(m.refine, 0, 10), cards: Array.isArray(m.cards) ? m.cards.filter((c) => Ref.item(String(c))).map(String) : [],
          forgedBy: m.forgedBy === st.name ? st.name : undefined, element: ['fire', 'water', 'wind', 'earth'].includes(m.element) ? m.element : undefined };
        if (!st.admin) { attrs.refine = 0; attrs.cards = []; }
        if (!this.add(st, 'bag', String(m.id), qty, attrs)) return NO('Your inventory is full.');
        st.dirty = true; return { soon: true };
      }
      case 'take': {
        if (!this.take(st, num(m.uid, 0, 1e9), num(m.qty, 1, 30000))) return NO();
        st.dirty = true; return null;
      }
      case 'zeny': {
        const d = num(m.d, -2147483647, 2147483647);
        if (d < 0) { if (st.zeny + d < 0) return NO(); }
        else if (!st.admin && (d > 100000 || !this.allow(st, 'zeny', 30, 10000))) return NO();
        st.zeny = Math.min(2147483647, st.zeny + d); st.dirty = true; return null;
      }
      case 'exp': {
        const b = num(m.base, 0, 1e9), j = num(m.job, 0, 1e9);
        if (!st.admin && (b > Ref.cap.base || j > Ref.cap.job || !this.allow(st, 'exp', 60, 10000))) return NO();
        this.addExp(st, b, j); return null;
      }
      case 'order': {
        if (!Array.isArray(m.uids)) return null;
        const pos = new Map(m.uids.slice(0, 200).map((u, i) => [Number(u), i]));
        st.bag.sort((a, b) => (pos.has(a.uid) ? pos.get(a.uid) : 1e6) - (pos.has(b.uid) ? pos.get(b.uid) : 1e6));
        st.dirty = true; return null;
      }
      /* Equipment and cards. */
      case 'equip': {
        const e = this.find(st, num(m.uid, 0, 1e9)), d = e && Ref.item(e.id);
        if (!e) return NO();
        const why = this.canEquip(st, d); if (why) return NO(why);
        const slot = d.slot !== 'acc' ? d.slot : !st.equip.acc1 ? 'acc1' : !st.equip.acc2 ? 'acc2' : 'acc1';
        st.bag.splice(st.bag.indexOf(e), 1);
        // More of the same arrows join the equipped stack; anything swapped out goes back to the bag.
        if (st.equip[slot] && d.stack && st.equip[slot].id === e.id) { st.equip[slot].qty = Math.min(30000, st.equip[slot].qty + e.qty); st.dirty = true; return null; }
        if (st.equip[slot]) this.stash(st, st.equip[slot]);
        const wt = d.weaponType && GD.Items.WEAPON_TYPES[d.weaponType];
        if (wt && wt.twoHanded && st.equip.shield) { st.bag.push(st.equip.shield); st.equip.shield = null; }
        st.equip[slot] = e; st.dirty = true; return null;
      }
      case 'unequip': {
        const slot = String(m.slot || ''), e = st.equip[slot];
        if (!e) return NO();
        if (st.bag.length >= BAG_MAX) return NO('Your inventory is full.');
        st.equip[slot] = null; this.stash(st, e); st.dirty = true; return null;
      }
      case 'arrows': {
        // Arrow Crafting: the recipe and the skill are checked here.
        const r = (GD.ARROW_RECIPES || []).find((x) => x[0] === m.mat), n = num(m.n, 1, 30000);
        if (!r || !(st.skills.arrow_crafting > 0)) return NO();
        if (this.count(st, r[0]) < n) return NO('Not enough materials.');
        if (!this.add(st, 'bag', r[1], Math.min(30000, r[2] * n))) return NO('Your inventory is full.');
        this.takeId(st, r[0], n); st.dirty = true; return { sync: true };
      }
      case 'ammo': {
        // Arrows used by bow shots and skills (the game counts them until combat moves here).
        const a = st.equip.ammo, n = num(m.n, 1, 10);
        if (!a) return NO();
        a.qty -= n; if (a.qty <= 0) st.equip.ammo = null;
        st.dirty = true; return null;
      }
      case 'card': {
        const c = this.find(st, num(m.card, 0, 1e9)), cd = c && Ref.item(c.id);
        const uid = num(m.target, 0, 1e9), t = this.find(st, uid) || Object.values(st.equip).find((e) => e && e.uid === uid), td = t && Ref.item(t.id);
        if (!cd || cd.type !== 'card' || !td || td.type !== 'equip') return NO();
        const fits = (GD.Items.CARD_SLOTS[cd.cardSlot] || { slots: [] }).slots.includes(td.slot) && (td.slots || 0) > (t.cards || []).length;
        if (!fits) return NO('That card doesn’t fit there.');
        this.take(st, c.uid, 1); (t.cards = t.cards || []).push(cd.id); st.dirty = true; return null;
      }
      /* Stats and jobs. */
      case 'stat': {
        const key = String(m.key || ''), v = st.stats[key];
        if (!GD.Stats.KEYS.includes(key) || !(v < GD.Stats.MAX_STAT)) return NO();
        const cost = GD.Stats.cost(v);
        if (st.statPoints < cost) return NO();
        st.statPoints -= cost; st.stats = Object.assign({}, st.stats, { [key]: v + 1 }); st.dirty = true; return null;
      }
      case 'stat_reset': {
        st.stats = { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 }; st.statPoints = GD.Stats.totalPoints(st.baseLevel); st.dirty = true; return null;
      }
      case 'job': {
        const jd = Ref.jobs.get(String(m.job || ''));
        if (!jd || jd.from_job !== st.job) return NO('You can’t change to that job.');
        if (st.jobLevel < jd.req_job_level) return NO(`You need job level ${jd.req_job_level} first.`);
        // Trials that cost items or Zeny are paid here; the other trials are still checked by the game.
        const tr = jd.trial || {};
        if (tr.zeny && st.zeny < tr.zeny) return NO(`The trial needs ${tr.zeny} Zeny.`);
        for (const [id, n] of tr.items || []) if (this.count(st, id) < n) return NO('The trial items are missing.');
        if (tr.zeny) st.zeny -= tr.zeny;
        for (const [id, n] of tr.items || []) this.takeId(st, id, n);
        st.job = jd.id; st.jobLevel = 1; st.jobExp = 0;
        if (jd.gift) this.add(st, 'bag', jd.gift, 1);
        st.dirty = true; return { sync: true };
      }
      /* Shops, refining, quests. */
      case 'buy': {
        const shop = Ref.shops.get(String(m.shop || '')), id = String(m.id || ''), d = Ref.item(id), qty = num(m.qty, 0, 30000);
        if (!shop || !shop.has(id) || !d || !qty) return NO('That shop doesn’t sell that.');
        const cost = Math.max(1, Math.ceil(shop.get(id) * (1 - this.perk(st, 'discount') / 100))) * qty;
        if (st.zeny < cost) return NO('You don’t have enough Zeny.');
        if (!this.add(st, 'bag', id, qty)) return NO('Your inventory is full.');
        st.zeny -= cost; st.dirty = true; return { sync: true };
      }
      case 'sell': {
        const e = this.find(st, num(m.uid, 0, 1e9)), d = e && Ref.item(e.id);
        if (!d) return NO();
        const got = this.take(st, e.uid, num(m.qty, 1, 30000));
        st.zeny = Math.min(2147483647, st.zeny + Math.round(d.price / 2 * (1 + this.perk(st, 'overcharge') / 100)) * got.qty);
        st.dirty = true; return { sync: true };
      }
      case 'refine': {
        const uid = num(m.uid, 0, 1e9), slot = Object.keys(st.equip).find((k) => st.equip[k] && st.equip[k].uid === uid);
        const e = slot ? st.equip[slot] : this.find(st, uid), d = e && GD.Items.get(e.id), t = d && GD.Refine.table(d);
        if (!e) return { reply: { result: 'That item is no longer there. Try again.' } };
        if (!t) return { reply: { result: 'That item can’t be refined.' } };
        const r = e.refine || 0;
        if (r >= GD.Refine.MAX) return { reply: { result: `It is already at +${GD.Refine.MAX}.` } };
        if (!this.firstOf(st.bag, t.mat)) return { reply: { result: `You need a ${(Ref.item(t.mat) || {}).name || t.mat}.` } };
        if (st.zeny < t.zeny) return { reply: { result: `You need ${t.zeny.toLocaleString()} Zeny.` } };
        this.takeId(st, t.mat, 1); st.zeny -= t.zeny; st.dirty = true;
        // The server rolls the dice.
        if (crypto.randomInt(10000) < t.rates[r] * 100) { e.refine = r + 1; return { reply: { result: 'success', item: this.out(e) } }; }
        if (slot) st.equip[slot] = null; else st.bag.splice(st.bag.indexOf(e), 1);
        return { reply: { result: 'broke', item: this.out(e) } };
      }
      case 'quest': {
        const q = Ref.quests.get(String(m.id || ''));
        if (!q || st.quests.has(q.id)) return NO('That quest is already done.');
        if (st.baseLevel < q.min_level || !q.req.every((r) => st.quests.has(r))) return NO('That quest isn’t open to you yet.');
        // Objectives the server can see; kill and visit counts are still kept by the game.
        for (const o of q.objectives) {
          if (o.type === 'item' && this.count(st, o.id) < o.count) return NO('Some quest items are missing.');
          if (o.type === 'baseLevel' && st.baseLevel < o.level) return NO();
          if (o.type === 'jobLevel' && st.jobLevel < o.level) return NO();
          if (o.type === 'job' && ((Ref.jobs.get(st.job) || {}).tier || 0) < o.tier) return NO();
        }
        for (const o of q.objectives) if (o.type === 'item') this.takeId(st, o.id, o.count);
        const rate = GD.Config.QUEST_EXP_RATE || 1;
        let b = 0, j = 0;
        for (const r of q.rewards) {
          if (r.kind === 'zeny') st.zeny = Math.min(2147483647, st.zeny + Number(r.qty));
          else if (r.kind === 'item') this.add(st, 'bag', r.item_id, Number(r.qty));
          else if (r.kind === 'exp') b += Math.round(Number(r.qty) * rate);
          else if (r.kind === 'job_exp') j += Math.round(Number(r.qty) * rate);
        }
        this.addExp(st, b, j);
        st.quests.add(q.id); st.newQuests.push(q.id); st.dirty = true; return { sync: true };
      }
      /* Storage (shared by the account) and the merchant's cart. */
      case 'store': case 'cart_in': {
        const to = m.k === 'store' ? 'storage' : 'cart', e = this.find(st, num(m.uid, 0, 1e9)), d = e && Ref.item(e.id);
        if (!d) return NO();
        if (to === 'cart' && !(st.skills.pushcart > 0)) return NO('You need a Pushcart.');
        const n = d.stack ? Math.min(num(m.qty, 1, 30000), e.qty) : 1;
        if (to === 'cart' && st.cart.reduce((w, x) => w + ((Ref.item(x.id) || {}).weight || 0) * x.qty, 0) + (d.weight || 0) * n > 8000) return NO('The cart is too heavy (8,000 max).');
        if (to === 'cart' && Vend.shops.has(st.id)) return NO('Close your shop before changing your cart.');
        if (!this.add(st, to, e.id, n, e)) return NO(to === 'storage' ? 'Storage is full.' : 'The cart is full.');
        this.take(st, e.uid, n); if (to === 'storage') st.storageDirty = true;
        st.dirty = true; return { sync: true };
      }
      case 'unstore': case 'cart_out': {
        const from = m.k === 'unstore' ? st.storage : st.cart, i = num(m.i, 0, 1000), s = from[i];
        if (!s || s.id !== m.id) return NO();
        if (m.k === 'cart_out' && Vend.shops.has(st.id)) return NO('Close your shop before changing your cart.');
        if (m.k === 'unstore') st.storageDirty = true;
        const n = Math.min(num(m.qty, 1, 30000), s.qty);
        if (!this.add(st, 'bag', s.id, n, s)) return NO('Your inventory is full.');
        s.qty -= n; if (s.qty <= 0) from.splice(i, 1);
        st.dirty = true; return { sync: true };
      }
    }
    return null;
  },
};
setInterval(() => { for (const st of Chars.mem.values()) if (st.dirty) Chars.flush(st); }, 15000);

/* ---------------------------------------------------------------- start-up: schema + reference data */
function loadGameData() {
  // Run the game's own data files in a sandbox to read items, monsters and maps.
  // A do-nothing stand-in for three.js, which some data files touch while loading.
  const stub = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : stub), apply: () => stub, construct: () => stub });
  const sandbox = { window: {}, Math, console, Object, Array, JSON, THREE: stub };
  sandbox.window.G = {};
  sandbox.G = sandbox.window.G;
  vm.createContext(sandbox);
  for (const f of ['js/core/utils.js', 'js/core/config.js', 'js/data/items.js', 'js/data/jobs.js', 'js/data/jobs2.js', 'js/data/skills.js', 'js/data/skills2.js',
    'js/data/skilltrees.js', 'js/data/npcs.js', 'js/data/quests.js', 'js/data/maps.js', 'js/data/content.js', 'js/systems/stats.js', 'js/systems/refine.js']) {
    try { vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f }); } catch (e) { console.warn(`(reference data) skipped ${f}: ${e.message}`); }
  }
  return sandbox.window.G;
}
// Bulk-replace one reference table's rows (all in one statement).
async function seedTable(client, table, cols, rows, where) {
  await client.query(`DELETE FROM ${table}${where ? ' WHERE ' + where : ''}`);
  if (!rows.length) return;
  const names = cols.map((c) => c.split(' ')[0]);
  await client.query(`INSERT INTO ${table} (${names.join(', ')}) SELECT ${names.join(', ')} FROM jsonb_to_recordset($1::jsonb) AS x(${cols.join(', ')}) ON CONFLICT DO NOTHING`, [JSON.stringify(rows)]);
}
// Drops, jobs, skills, shops and quests from the game's data files.
async function seedGameData(G) {
  const perLevel = (fn, max, round) => { const out = []; for (let l = 1; l <= max; l++) { let v = null; try { v = typeof fn === 'function' ? Number(fn(l)) : fn == null ? null : Number(fn); } catch (e) { v = null; } out.push(Number.isFinite(v) ? (round ? Math.round(v) : +v.toFixed(3)) : 0); } return out; };
  const drops = [], jobs = [], skills = [], shops = [], shopItems = [], quests = [], rewards = [];
  for (const [id, m] of Object.entries((G.Config && G.Config.MONSTERS) || {})) (m.drops || []).forEach((d, i) => drops.push({ monster_id: id, sort: i, item_id: d.id, chance: d.chance }));
  for (const j of Object.values((G.Jobs && G.Jobs.DB) || {})) {
    // From the Job Master's rules: first jobs need Novice job level 10, second jobs job level 40.
    const from = j.tier === 1 ? 'novice' : j.from || null;
    jobs.push({ id: j.id, name: j.name, tier: j.tier, from_job: from, req_job_level: j.tier === 1 ? 10 : j.tier >= 2 ? 40 : 0, max_job_level: j.maxJobLevel,
      weapons: j.weapons || [], gift: j.gift || null, trial: j.trial || null, job_exp: j.jobExp || [] });
  }
  for (const sk of Object.values((G.Skills && G.Skills.DB) || {})) {
    const fx = sk.fx || {}, max = sk.max || 1;
    const data = JSON.parse(JSON.stringify({ target: sk.target, range: sk.range, element: sk.element, req: sk.req, granted: sk.granted, quest: sk.quest, catalyst: sk.catalyst, needs: sk.needs, spheres: sk.spheres, effect: sk.effect, fx: fx.kind ? { kind: fx.kind, area: fx.area, knock: fx.knock } : undefined,
      hp: sk.hp ? perLevel(sk.hp, max, true) : undefined, zeny: sk.zeny ? perLevel(sk.zeny, max, true) : undefined }));
    skills.push({ id: sk.id, name: sk.name, job: sk.job || null, type: sk.type, max_level: max, sp: perLevel(sk.sp, max, true), cast_time: perLevel(sk.cast, max), cooldown: perLevel(sk.cd, max),
      damage: fx.mult ? perLevel(fx.mult, max) : null, hits: fx.hits ? perLevel(fx.hits, max, true) : null, data });
  }
  for (const [id, sh] of Object.entries(G.SHOPS || {})) {
    shops.push({ id, name: sh.name, npc: sh.npc || null });
    (sh.stock || []).forEach((it, i) => { const d = G.Items.get(it); if (d) shopItems.push({ shop_id: id, item_id: it, price: Math.max(1, Math.round(d.price || 1)), sort: i }); });
  }
  (G.QUESTS || []).forEach((q, i) => {
    quests.push({ id: q.id, name: q.name, giver: q.giver || null, min_level: q.minLevel || 1, req: q.req || [], objectives: q.objectives || [], sort: i });
    const r = q.rewards || {};
    if (r.exp) rewards.push({ quest_id: q.id, kind: 'exp', item_id: null, qty: r.exp });
    if (r.jobExp) rewards.push({ quest_id: q.id, kind: 'job_exp', item_id: null, qty: r.jobExp });
    if (r.zeny) rewards.push({ quest_id: q.id, kind: 'zeny', item_id: null, qty: r.zeny });
    for (const [it, n] of r.items || []) rewards.push({ quest_id: q.id, kind: 'item', item_id: it, qty: n });
  });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await seedTable(c, 'monster_drops', ['monster_id text', 'sort int', 'item_id text', 'chance real'], drops);
    await seedTable(c, 'job_defs', ['id text', 'name text', 'tier int', 'from_job text', 'req_job_level int', 'max_job_level int', 'weapons text[]', 'gift text', 'trial jsonb', 'job_exp jsonb'], jobs);
    await seedTable(c, 'skill_defs', ['id text', 'name text', 'job text', 'type text', 'max_level int', 'sp int[]', 'cast_time real[]', 'cooldown real[]', 'damage real[]', 'hits int[]', 'data jsonb'], skills);
    await seedTable(c, 'shops', ['id text', 'name text', 'npc text'], shops, 'NOT custom');
    await seedTable(c, 'shop_items', ['shop_id text', 'item_id text', 'price int', 'sort int'], shopItems, 'shop_id IN (SELECT id FROM shops WHERE NOT custom)');
    await seedTable(c, 'quest_defs', ['id text', 'name text', 'giver text', 'min_level int', 'req text[]', 'objectives jsonb', 'sort int'], quests);
    await seedTable(c, 'quest_rewards', ['quest_id text', 'kind text', 'item_id text', 'qty bigint'], rewards);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  return { drops: drops.length, jobs: jobs.length, skills: skills.length, shops: shops.length, quests: quests.length };
}
async function start() {
  await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  const G = GD = loadGameData();
  const items = (G.Items && G.Items.DB) || {}, mons = (G.Config && G.Config.MONSTERS) || {};
  for (const [id, it] of Object.entries(items)) await pool.query('INSERT INTO item_defs (id, name, type, data) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type, data = EXCLUDED.data', [id, it.name, it.type, JSON.stringify(it)]);
  for (const [id, m] of Object.entries(mons)) await pool.query('INSERT INTO monster_defs (id, name, level, hp, element, data) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, level = EXCLUDED.level, hp = EXCLUDED.hp, element = EXCLUDED.element, data = EXCLUDED.data', [id, m.name, m.level, m.hp, m.element || 'neutral', JSON.stringify(m)]);
  if (G.Maps) for (const [mapId, map] of Object.entries(G.Maps)) for (const sp of map.spawns || []) await pool.query('INSERT INTO monster_spawns (map, monster_id, x, z, r, count) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING', [mapId, sp.type, sp.x, sp.z, sp.r, sp.count]);
  await pool.query('DELETE FROM sessions WHERE expires_at < now()');
  if (ADMINS.size) await pool.query('UPDATE accounts SET is_admin = true WHERE lower(username) = ANY($1)', [[...ADMINS]]);
  for (const r of (await pool.query("SELECT id FROM custom_maps WHERE data->'rules'->>'pvp' = 'true'")).rows) pvpMaps.add(r.id);
  const n = await seedGameData(G);
  await Vend.load();   // shops left open survive restarts
  // The server's world: monsters on every map that has players.
  World.init({ broadcast, send: (charId, msg) => { const w = wsOfChar(charId); if (w && w.readyState === 1) w.send(JSON.stringify(msg)); } },
    Object.fromEntries((await pool.query('SELECT id, data FROM custom_maps')).rows.map((r) => [r.id, r.data])));
  await Ref.load();
  await Ref.syncCustomShops();
  server.listen(PORT, () => console.log(`Willowmere server on http://localhost:${PORT}  (${Object.keys(items).length} items, ${Object.keys(mons).length} monsters, ${n.drops} drops, ${n.jobs} jobs, ${n.skills} skills, ${n.shops} shops, ${n.quests} quests in the database)`));
}
// Render stops the server with SIGTERM when it redeploys: save everyone first.
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => {
  console.log('Saving characters before shutting down…');
  Chars.flush(...Chars.mem.values()).finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 8000).unref();
});
start().catch((e) => { console.error('Start-up failed:', e.message); process.exit(1); });
