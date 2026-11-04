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
  const r = await pool.query('SELECT a.id, a.username FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = $1 AND s.expires_at > now()', [sha256(token)]);
  return r.rows[0] || null;
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

async function saveCharacter(charId, accountId, d) {
  const num = (v, lo, hi, def) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const own = await client.query('SELECT id FROM characters WHERE id = $1 AND account_id = $2 FOR UPDATE', [charId, accountId]);
    if (!own.rows.length) { await client.query('ROLLBACK'); return false; }
    const extra = Object.assign({}, d.extra || {}); const cart = Array.isArray(extra.cart) ? extra.cart : []; delete extra.cart;
    const pos = d.position || {};
    await client.query(`UPDATE characters SET job=$3, base_level=$4, job_level=$5, base_exp=$6, job_exp=$7, zeny=$8, hp=$9, sp=$10,
      stats=$11, stat_points=$12, appearance=$13, map=$14, x=$15, z=$16, facing=$17, save_point=$18, skills=$19, hotbar=$20, extra=$21,
      is_new=false, updated_at=now() WHERE id=$1 AND account_id=$2`, [
      charId, accountId, String(d.job || 'novice').slice(0, 24), num(d.baseLevel, 1, 999, 1), num(d.jobLevel, 1, 999, 1),
      Math.floor(num(d.baseExp, 0, 1e15, 0)), Math.floor(num(d.jobExp, 0, 1e15, 0)), Math.floor(num(d.zeny, 0, 2147483647, 0)),
      Math.floor(num(d.hp, 0, 1e7, 1)), Math.floor(num(d.sp, 0, 1e7, 1)), JSON.stringify(d.stats || {}), Math.floor(num(d.statPoints, 0, 1e5, 0)),
      JSON.stringify((d.character && d.character.appearance) || {}), String(pos.map || 'meadow').slice(0, 24), num(pos.x, -500, 500, 0), num(pos.z, -500, 500, 0),
      num(pos.facing, -10, 10, 0), d.savePoint ? JSON.stringify(d.savePoint) : null, JSON.stringify(d.skills || {}), JSON.stringify(d.hotbar || []), JSON.stringify(extra),
    ]);
    // Items: replace the character's set in one go.
    await client.query('DELETE FROM character_items WHERE character_id = $1', [charId]);
    const rows = [];
    ((d.inventory && d.inventory.items) || []).slice(0, 400).forEach((e, i) => rows.push(['bag', null, cleanItem(e), i]));
    Object.entries(d.equipment || {}).forEach(([slot, e], i) => { if (e) rows.push(['equip', String(slot).slice(0, 16), cleanItem(e), i]); });
    cart.slice(0, 100).forEach((e, i) => rows.push(['cart', null, cleanItem(e), i]));
    for (const [loc, slot, it, sort] of rows) {
      if (!ITEM_RE.test(it.item_id)) continue;
      await client.query('INSERT INTO character_items (character_id, location, equip_slot, item_id, qty, refine, cards, forged_by, element, sort) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [charId, loc, slot, it.item_id, it.qty, it.refine, it.cards, it.forged_by, it.element, sort]);
    }
    // Account storage.
    if (Array.isArray(d.storage)) {
      await client.query('DELETE FROM storage_items WHERE account_id = $1', [accountId]);
      let i = 0;
      for (const e of d.storage.slice(0, 300)) {
        const it = cleanItem(e);
        if (!ITEM_RE.test(it.item_id)) continue;
        await client.query('INSERT INTO storage_items (account_id, item_id, qty, refine, cards, forged_by, element, sort) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
          [accountId, it.item_id, it.qty, it.refine, it.cards, it.forged_by, it.element, i++]);
      }
    }
    await client.query('COMMIT');
    return true;
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
}

/* ---------------------------------------------------------------- API routes */
async function api(req, res, url) {
  const ip = req.socket.remoteAddress || '?';
  const m = (re) => re.exec(url.pathname);
  if (url.pathname === '/api/health') return send(res, 200, { ok: true, online: online.size });
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
      return send(res, 200, { token: await newSession(r.rows[0].id), username: r.rows[0].username });
    } catch (e) { if (e.code === '23505') return send(res, 409, { error: 'That username is taken.' }); throw e; }
  }
  if (url.pathname === '/api/login' && req.method === 'POST') {
    if (limited(ip)) return send(res, 429, { error: 'Too many attempts. Wait a minute.' });
    const { username, password } = await readJson(req, 10_000);
    const r = await pool.query('SELECT id, username, pass_hash FROM accounts WHERE lower(username) = lower($1)', [String(username || '')]);
    const a = r.rows[0];
    if (!a || typeof password !== 'string' || !checkPassword(password, a.pass_hash)) return send(res, 401, { error: 'Wrong username or password.' });
    await pool.query('UPDATE accounts SET last_login = now() WHERE id = $1', [a.id]);
    return send(res, 200, { token: await newSession(a.id), username: a.username });
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
    for (const { id } of ids) { const c = await loadCharacter(id, acct.id, false); if (c) slots[c.slot] = c; }
    return send(res, 200, { username: acct.username, slots });
  }
  if (url.pathname === '/api/characters' && req.method === 'POST') {
    const { slot, name, appearance } = await readJson(req, 10_000);
    const s = Number(slot), nm = String(name || '').trim().replace(/\s+/g, ' ');
    if (!Number.isInteger(s) || s < 0 || s >= MAX_SLOTS) return send(res, 400, { error: 'Bad slot.' });
    if (!NAME_RE.test(nm)) return send(res, 400, { error: 'Use 2 to 16 letters or numbers.' });
    const app = {}; for (const k of ['hair', 'outfit', 'eyes', 'style']) if (appearance && typeof appearance[k] === 'string') app[k] = appearance[k].slice(0, 20);
    try {
      const r = await pool.query('INSERT INTO characters (account_id, slot, name, appearance) VALUES ($1, $2, $3, $4) RETURNING id', [acct.id, s, nm, JSON.stringify(app)]);
      return send(res, 200, { id: Number(r.rows[0].id) });
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
const publicState = (s) => ({ id: s.charId, name: s.name, map: s.map, x: s.x, z: s.z, facing: s.facing, moving: s.moving, look: s.look, party: s.partyName || null, guild: s.guild || null });
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
  return out;
};

/* Shared monsters: one player per map (the earliest to arrive) runs that map's
   monsters with the game's own AI and sends snapshots; the server keeps the
   latest state, relays it to everyone else, and passes their hits to the host. */
const hosts = new Map();      // map -> ws
const mobCache = new Map();   // map -> Map(id -> state)
const onMap = (map) => [...online].filter(([, s]) => s.map === map);
function electHost(map) {
  const players = onMap(map);
  const cur = hosts.get(map);
  if (!players.length) { hosts.delete(map); mobCache.delete(map); return; }
  if (cur && online.has(cur) && online.get(cur).map === map) return;
  const next = players[0][0];
  hosts.set(map, next);
  for (const [ws] of players) if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'host', map, isHost: ws === next }));
}
const cachedMobs = (map) => [...((mobCache.get(map) || new Map()).values())];
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
      for (const [other, s] of online) if (s.accountId === acct.id) { other.send(JSON.stringify({ t: 'kicked', text: 'This account logged in somewhere else.' })); other.close(); }
      me = { accountId: acct.id, charId: Number(c.id), name: c.name, map: String(msg.map || c.map), x: 0, z: 0, facing: 0, moving: false, look: cleanLook(msg.look), chatT: 0, level: Number(msg.level) || 1 };
      online.set(ws, me);
      await Social.load(me);
      Social.sendPartyTo(me); Social.sendGuildTo(me);
      if (me.partyId) Social.refreshParty(me.partyId).catch(() => {});
      if (me.guild) Social.refreshGuild(me.guild.id).catch(() => {});
      ws.send(JSON.stringify({ t: 'welcome', you: me.charId, players: [...online.values()].filter((s) => s !== me && s.map === me.map).map(publicState), online: online.size, mobs: cachedMobs(me.map) }));
      broadcast(me.map, { t: 'join', p: publicState(me) }, ws);
      electHost(me.map);
      return;
    }
    if (msg.t === 'state') {
      const map = String(msg.map || me.map).slice(0, 24);
      const num = (v, d) => (Number.isFinite(Number(v)) ? Math.max(-500, Math.min(500, Number(v))) : d);
      if (map !== me.map) {
        const old = me.map;
        broadcast(old, { t: 'leave', id: me.charId }, ws);
        me.map = map;
        if (hosts.get(old) === ws) hosts.delete(old);
        electHost(old);
        ws.send(JSON.stringify({ t: 'players', map, players: [...online.values()].filter((s) => s !== me && s.map === map).map(publicState), mobs: cachedMobs(map) }));
        Object.assign(me, { x: num(msg.x, 0), z: num(msg.z, 0) });
        broadcast(map, { t: 'join', p: publicState(me) }, ws);
        electHost(map);
        return;
      }
      Object.assign(me, { x: num(msg.x, me.x), z: num(msg.z, me.z), facing: num(msg.facing, me.facing), moving: !!msg.moving });
      if (Number.isInteger(msg.level)) me.level = Math.max(1, Math.min(999, msg.level));
      broadcast(me.map, { t: 'state', id: me.charId, x: me.x, z: me.z, facing: me.facing, moving: me.moving }, ws);
    } else if (msg.t === 'look') {
      me.look = cleanLook(msg.look);
      broadcast(me.map, { t: 'look', id: me.charId, look: me.look }, ws);
    } else if (msg.t === 'chat') {
      const now = Date.now();
      if (now - me.chatT < 400) return;   // a little flood protection
      me.chatT = now;
      const text = String(msg.text || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120);
      // "%message" goes to your party, "$message" to your guild, like the classics.
      if (text.startsWith('%') && me.partyId) Social.toParty(me.partyId, { t: 'chat', id: me.charId, from: me.name, text: text.slice(1).trim(), channel: 'party' });
      else if (text.startsWith('$') && me.guild) Social.toGuild(me.guild.id, { t: 'chat', id: me.charId, from: me.name, text: text.slice(1).trim(), channel: 'guild' });
      else if (text) broadcast(me.map, { t: 'chat', id: me.charId, from: me.name, text });
    } else if (msg.t === 'mobs') {
      // Snapshot from the map's host.
      if (hosts.get(me.map) !== ws || !Array.isArray(msg.list)) return;
      if (!mobCache.has(me.map)) mobCache.set(me.map, new Map());
      const cache = mobCache.get(me.map);
      for (const m of msg.list.slice(0, 400)) if (m && Number.isInteger(m.i)) cache.set(m.i, m);
      broadcast(me.map, { t: 'mobs', list: msg.list.slice(0, 400) }, ws);
    } else if (msg.t === 'mob') {
      const host = hosts.get(me.map);
      if (['dmg', 'status', 'knock'].includes(msg.op)) {
        // A player's hit on a monster: the host applies it.
        if (host && host !== ws && host.readyState === 1) host.send(JSON.stringify(Object.assign({}, msg, { from: me.charId })));
      } else if (host === ws && ['attack', 'hurt', 'killed'].includes(msg.op)) {
        // The host's verdicts go to whoever they concern.
        const target = wsOfChar(Number(msg.to));
        if (target && target.readyState === 1 && online.get(target).map === me.map) target.send(JSON.stringify(msg));
      }
    } else if (msg.t === 'fx') {
      // Cast bars and spell effects, for everyone else on the map to see.
      broadcast(me.map, Object.assign({}, msg, { from: me.charId }), ws);
    } else if (msg.t === 'buff') {
      // A support skill cast on another player: they apply it.
      const target = wsOfChar(Number(msg.to));
      if (target && target.readyState === 1 && online.get(target).map === me.map)
        target.send(JSON.stringify({ t: 'buff', from: me.charId, fromName: me.name, skill: String(msg.skill || '').slice(0, 40), lv: Math.max(1, Math.min(10, Number(msg.lv) || 1)) }));
    } else if (typeof msg.t === 'string' && (msg.t.startsWith('party_') || msg.t.startsWith('guild_') || msg.t === 'pexp' || msg.t === 'ploot')) {
      await Social.handle(ws, me, msg).catch((e) => { console.error(e); ws.send(JSON.stringify({ t: 'notice', text: 'That didn’t work. Try again.' })); });
    } else if (msg.t === 'action') {
      // Small visual events (attack swing, sit, emote) for others to see.
      const kind = ['attack', 'cast', 'emote'].includes(msg.kind) ? msg.kind : null;
      if (kind) broadcast(me.map, { t: 'action', id: me.charId, kind, data: typeof msg.data === 'string' ? msg.data.slice(0, 24) : null }, ws);
    }
  });
  ws.on('close', () => {
    if (me && online.get(ws) === me) {
      online.delete(ws); broadcast(me.map, { t: 'leave', id: me.charId });
      if (me.partyId) Social.refreshParty(me.partyId).catch(() => {});
      if (me.guild) Social.refreshGuild(me.guild.id).catch(() => {});
      if (hosts.get(me.map) === ws) hosts.delete(me.map);
      electHost(me.map);
    }
  });
});
setInterval(() => { for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); } }, 30_000);

/* ---------------------------------------------------------------- parties & guilds */
const Social = {
  invites: new Map(),   // charId -> { kind, id, from }
  online(charId) { for (const [ws, s] of online) if (s.charId === charId) return [ws, s]; return null; },
  async load(me) {
    const p = (await pool.query('SELECT p.id, p.name FROM party_members m JOIN parties p ON p.id = m.party_id WHERE m.character_id = $1', [me.charId])).rows[0];
    me.partyId = p ? Number(p.id) : null; me.partyName = p ? p.name : null;
    const g = (await pool.query('SELECT g.id, g.name, g.emblem_ver FROM guild_members m JOIN guilds g ON g.id = m.guild_id WHERE m.character_id = $1', [me.charId])).rows[0];
    me.guild = g ? { id: Number(g.id), name: g.name, ev: g.emblem_ver } : null;
  },
  async partyState(id) {
    const p = (await pool.query('SELECT * FROM parties WHERE id = $1', [id])).rows[0];
    if (!p) return null;
    const mem = (await pool.query('SELECT c.id, c.name, c.job, c.base_level FROM party_members m JOIN characters c ON c.id = m.character_id WHERE m.party_id = $1 ORDER BY c.name', [id])).rows;
    return { id: Number(p.id), name: p.name, leader: Number(p.leader_id), expShare: p.exp_share, itemShare: p.item_share,
      members: mem.map((c) => { const o = Social.online(Number(c.id)); return { id: Number(c.id), name: c.name, job: c.job, level: o ? o[1].level : c.base_level, online: !!o, map: o ? o[1].map : null }; }) };
  },
  async guildState(id) {
    const g = (await pool.query('SELECT id, name, master_id, emblem_ver, skill_points, skills FROM guilds WHERE id = $1', [id])).rows[0];
    if (!g) return null;
    const mem = (await pool.query('SELECT c.id, c.name, c.job, c.base_level FROM guild_members m JOIN characters c ON c.id = m.character_id WHERE m.guild_id = $1 ORDER BY c.name', [id])).rows;
    return { id: Number(g.id), name: g.name, master: Number(g.master_id), ev: g.emblem_ver, skillPoints: g.skill_points, skills: g.skills,
      members: mem.map((c) => { const o = Social.online(Number(c.id)); return { id: Number(c.id), name: c.name, job: c.job, level: o ? o[1].level : c.base_level, online: !!o, map: o ? o[1].map : null }; }) };
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
          await pool.query('INSERT INTO guild_members (guild_id, character_id) VALUES ($1, $2)', [inv.id, me.charId]);
          const g = (await pool.query('SELECT name, emblem_ver FROM guilds WHERE id = $1', [inv.id])).rows[0];
          me.guild = { id: inv.id, name: g.name, ev: g.emblem_ver };
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
        const st = me.partyId && await Social.partyState(me.partyId);
        const base = Math.max(0, Math.min(1e8, Math.floor(Number(m.base) || 0))), job = Math.max(0, Math.min(1e8, Math.floor(Number(m.job) || 0)));
        const here = st && st.expShare === 'even' ? st.members.filter((x) => x.online && x.map === me.map) : [];
        const list = here.length ? here : [{ id: me.charId }];
        for (const x of list) { const o = Social.online(x.id); if (o) Social.sendTo(o[1], { t: 'gainexp', base: Math.floor(base / list.length), job: Math.floor(job / list.length), from: me.name, shared: list.length > 1 }); }
        return;
      }
      case 'ploot': {
        // Party Share: each drop goes to a random member on the map.
        const st = me.partyId && await Social.partyState(me.partyId);
        const item = String(m.item || ''), qty = Math.max(1, Math.min(1000, Math.floor(Number(m.qty) || 1)));
        if (!/^[a-z0-9_]{1,40}$/.test(item)) return;
        const here = st && st.itemShare === 'party' ? st.members.filter((x) => x.online && x.map === me.map) : [];
        const pick = here.length ? here[Math.floor(Math.random() * here.length)] : { id: me.charId };
        const o = Social.online(pick.id);
        if (o) Social.sendTo(o[1], { t: 'loot_gift', item, qty, from: me.name });
        return;
      }
      /* ---------- guild ---------- */
      case 'guild_create': {
        if (me.guild) return Social.notice(me, 'You are already in a guild.');
        const name = String(m.name || '').trim().replace(/\s+/g, ' ');
        if (!Social.NAME.test(name)) return Social.notice(me, 'Guild names are 2 to 24 letters or numbers.');
        try {
          const r = await pool.query('INSERT INTO guilds (name, master_id) VALUES ($1, $2) RETURNING id', [name, me.charId]);
          await pool.query('INSERT INTO guild_members (guild_id, character_id) VALUES ($1, $2)', [r.rows[0].id, me.charId]);
          me.guild = { id: Number(r.rows[0].id), name, ev: 0 };
        } catch (e) { if (e.code === '23505') return Social.notice(me, 'That guild name is taken.'); throw e; }
        Social.sendTo(me, { t: 'guild_created', name });
        await Social.refreshGuild(me.guild.id); Social.pinfo(me); return;
      }
      case 'guild_invite': {
        const st = me.guild && await Social.guildState(me.guild.id);
        if (!st) return Social.notice(me, 'You are not in a guild.');
        if (st.master !== me.charId) return Social.notice(me, 'Only the guild master can invite.');
        if (st.members.length >= 16) return Social.notice(me, 'The guild is full (16 members).');
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
        if (m.t === 'guild_expel' && st.master !== me.charId) return Social.notice(me, 'Only the guild master can expel.');
        if (who === st.master) return;
        await pool.query('DELETE FROM guild_members WHERE guild_id = $1 AND character_id = $2', [gid, who]);
        const o = Social.online(who);
        if (o) { o[1].guild = null; Social.sendTo(o[1], { t: 'guild', guild: null }); Social.pinfo(o[1]); Social.notice(o[1], m.t === 'guild_leave' ? `You left ${st.name}.` : `You were expelled from ${st.name}.`); }
        await Social.refreshGuild(gid); return;
      }
      case 'guild_skill': {
        const st = me.guild && await Social.guildState(me.guild.id);
        if (!st || st.master !== me.charId) return Social.notice(me, 'Only the guild master can learn guild skills.');
        if (m.skill !== 'emblem' || (st.skills && st.skills.emblem)) return;
        if (st.skillPoints < 1) return Social.notice(me, 'No guild skill points left.');
        await pool.query("UPDATE guilds SET skill_points = skill_points - 1, skills = skills || '{\"emblem\":1}'::jsonb WHERE id = $1", [st.id]);
        await Social.refreshGuild(st.id); return;
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

/* ---------------------------------------------------------------- start-up: schema + reference data */
function loadGameData() {
  // Run the game's own data files in a sandbox to read items, monsters and maps.
  // A do-nothing stand-in for three.js, which some data files touch while loading.
  const stub = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : stub), apply: () => stub, construct: () => stub });
  const sandbox = { window: {}, Math, console, Object, Array, JSON, THREE: stub };
  sandbox.window.G = {};
  sandbox.G = sandbox.window.G;
  vm.createContext(sandbox);
  for (const f of ['js/core/utils.js', 'js/core/config.js', 'js/data/items.js', 'js/data/maps.js', 'js/data/content.js']) {
    try { vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f }); } catch (e) { console.warn(`(reference data) skipped ${f}: ${e.message}`); }
  }
  return sandbox.window.G;
}
async function start() {
  await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  const G = loadGameData();
  const items = (G.Items && G.Items.DB) || {}, mons = (G.Config && G.Config.MONSTERS) || {};
  for (const [id, it] of Object.entries(items)) await pool.query('INSERT INTO item_defs (id, name, type, data) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type, data = EXCLUDED.data', [id, it.name, it.type, JSON.stringify(it)]);
  for (const [id, m] of Object.entries(mons)) await pool.query('INSERT INTO monster_defs (id, name, level, hp, element, data) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, level = EXCLUDED.level, hp = EXCLUDED.hp, element = EXCLUDED.element, data = EXCLUDED.data', [id, m.name, m.level, m.hp, m.element || 'neutral', JSON.stringify(m)]);
  if (G.Maps) for (const [mapId, map] of Object.entries(G.Maps)) for (const sp of map.spawns || []) await pool.query('INSERT INTO monster_spawns (map, monster_id, x, z, r, count) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING', [mapId, sp.type, sp.x, sp.z, sp.r, sp.count]);
  await pool.query('DELETE FROM sessions WHERE expires_at < now()');
  server.listen(PORT, () => console.log(`Willowmere server on http://localhost:${PORT}  (${Object.keys(items).length} items, ${Object.keys(mons).length} monsters in the database)`));
}
start().catch((e) => { console.error('Start-up failed:', e.message); process.exit(1); });
