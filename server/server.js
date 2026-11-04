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
const publicState = (s) => ({ id: s.charId, name: s.name, map: s.map, x: s.x, z: s.z, facing: s.facing, moving: s.moving, look: s.look });
function broadcast(map, msg, except) {
  const data = JSON.stringify(msg);
  for (const [ws, s] of online) if (s.map === map && ws !== except && ws.readyState === 1) ws.send(data);
}
const cleanLook = (l) => {
  if (!l || typeof l !== 'object') return {};
  const out = {};
  for (const k of ['job', 'weapon', 'mount']) if (typeof l[k] === 'string') out[k] = l[k].slice(0, 24);
  out.falcon = !!l.falcon;
  if (l.appearance && typeof l.appearance === 'object') { out.appearance = {}; for (const k of ['hair', 'outfit', 'eyes', 'style']) if (typeof l.appearance[k] === 'string') out.appearance[k] = l.appearance[k].slice(0, 20); }
  if (l.head && typeof l.head === 'object') { out.head = {}; for (const k of ['top', 'mid', 'low']) if (typeof l.head[k] === 'string') out.head[k] = l.head[k].slice(0, 24); }
  return out;
};

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
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
      me = { accountId: acct.id, charId: Number(c.id), name: c.name, map: String(msg.map || c.map), x: 0, z: 0, facing: 0, moving: false, look: cleanLook(msg.look), chatT: 0 };
      online.set(ws, me);
      ws.send(JSON.stringify({ t: 'welcome', you: me.charId, players: [...online.values()].filter((s) => s !== me && s.map === me.map).map(publicState), online: online.size }));
      broadcast(me.map, { t: 'join', p: publicState(me) }, ws);
      return;
    }
    if (msg.t === 'state') {
      const map = String(msg.map || me.map).slice(0, 24);
      const num = (v, d) => (Number.isFinite(Number(v)) ? Math.max(-500, Math.min(500, Number(v))) : d);
      if (map !== me.map) {
        broadcast(me.map, { t: 'leave', id: me.charId }, ws);
        me.map = map;
        ws.send(JSON.stringify({ t: 'players', players: [...online.values()].filter((s) => s !== me && s.map === map).map(publicState) }));
        Object.assign(me, { x: num(msg.x, 0), z: num(msg.z, 0) });
        broadcast(map, { t: 'join', p: publicState(me) }, ws);
        return;
      }
      Object.assign(me, { x: num(msg.x, me.x), z: num(msg.z, me.z), facing: num(msg.facing, me.facing), moving: !!msg.moving });
      broadcast(me.map, { t: 'state', id: me.charId, x: me.x, z: me.z, facing: me.facing, moving: me.moving }, ws);
    } else if (msg.t === 'look') {
      me.look = cleanLook(msg.look);
      broadcast(me.map, { t: 'look', id: me.charId, look: me.look }, ws);
    } else if (msg.t === 'chat') {
      const now = Date.now();
      if (now - me.chatT < 400) return;   // a little flood protection
      me.chatT = now;
      const text = String(msg.text || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120);
      if (text) broadcast(me.map, { t: 'chat', id: me.charId, from: me.name, text });
    } else if (msg.t === 'action') {
      // Small visual events (attack swing, sit, emote) for others to see.
      const kind = ['attack', 'cast', 'emote'].includes(msg.kind) ? msg.kind : null;
      if (kind) broadcast(me.map, { t: 'action', id: me.charId, kind, data: typeof msg.data === 'string' ? msg.data.slice(0, 24) : null }, ws);
    }
  });
  ws.on('close', () => {
    if (me && online.get(ws) === me) { online.delete(ws); broadcast(me.map, { t: 'leave', id: me.charId }); }
  });
});
setInterval(() => { for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); } }, 30_000);

/* ---------------------------------------------------------------- start-up: schema + reference data */
function loadGameData() {
  // Run the game's own data files in a sandbox to read items, monsters and maps.
  // A do-nothing stand-in for three.js, which some data files touch while loading.
  const stub = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : stub), apply: () => stub, construct: () => stub });
  const sandbox = { window: {}, Math, console, Object, Array, JSON, THREE: stub };
  sandbox.window.G = {};
  sandbox.G = sandbox.window.G;
  vm.createContext(sandbox);
  for (const f of ['js/core/utils.js', 'js/core/config.js', 'js/data/items.js', 'js/data/maps.js']) {
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
