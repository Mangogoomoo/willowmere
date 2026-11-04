/* Online play. When the game is served by the Willowmere server (server/),
   it logs in, keeps characters in the database, and shows other players.
   Opened any other way (a file, the published page), it stays single-player
   with browser saves, exactly as before. */
(function (G) {
  'use strict';
  const h = G.h;
  const TOKEN = 'willowmere.token';

  /* ---------------------------------------------------------------- API */
  const Online = {
    enabled: false,
    token: (() => { try { return localStorage.getItem(TOKEN); } catch (e) { return null; } })(),
    username: null,
    async detect() {
      if (!/^https?:$/.test(location.protocol)) return false;
      try {
        const r = await fetch('/api/health', { cache: 'no-store' });
        this.enabled = r.ok && !!(await r.json()).ok;
      } catch (e) { this.enabled = false; }
      return this.enabled;
    },
    async api(path, method, body) {
      const r = await fetch(path, {
        method: method || 'GET',
        headers: Object.assign({ 'Content-Type': 'application/json' }, this.token ? { Authorization: 'Bearer ' + this.token } : {}),
        body: body ? JSON.stringify(body) : undefined,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(j.error || `Server error (${r.status})`), { status: r.status });
      return j;
    },
    setToken(t) { this.token = t; try { if (t) localStorage.setItem(TOKEN, t); else localStorage.removeItem(TOKEN); } catch (e) { /* ignore */ } },
    async logout() { try { await this.api('/api/logout', 'POST'); } catch (e) { /* ignore */ } this.setToken(null); location.reload(); },
  };

  /* ---------------------------------------------------------------- login / register */
  const Auth = {
    show() {
      return new Promise((resolve) => {
        const root = document.getElementById('title');
        root.hidden = false; root.textContent = '';
        let mode = 'login';
        const user = h('input#auth-user', { type: 'text', maxlength: '24', autocomplete: 'username', spellcheck: 'false', placeholder: 'Username' });
        const pass = h('input#auth-pass', { type: 'password', maxlength: '200', autocomplete: 'current-password', placeholder: 'Password' });
        const pass2 = h('input#auth-pass2', { type: 'password', maxlength: '200', autocomplete: 'new-password', placeholder: 'Repeat password' });
        const err = h('p.err', { role: 'alert' });
        const go = h('button.btn.big', { type: 'button' }, h('span', { text: 'Log in' }));
        const swap = h('button.btn.ghost', { type: 'button' }, 'Create an account');
        const row2 = h('label.cc-group', null, h('span.cc-label', { text: 'Repeat password' }), pass2);
        const render = () => {
          go.firstChild.textContent = mode === 'login' ? 'Log in' : 'Create account';
          swap.textContent = mode === 'login' ? 'Create an account' : 'I already have an account';
          row2.hidden = mode === 'login';
          pass.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
          err.textContent = '';
        };
        swap.addEventListener('click', () => { mode = mode === 'login' ? 'register' : 'login'; render(); user.focus(); });
        const submit = async () => {
          const u = user.value.trim(), p = pass.value;
          if (!/^[A-Za-z0-9_]{3,24}$/.test(u)) { err.textContent = 'Usernames are 3 to 24 letters, numbers or underscores.'; return; }
          if (mode === 'register') {
            if (p.length < 8) { err.textContent = 'Passwords need at least 8 characters.'; return; }
            if (p !== pass2.value) { err.textContent = 'The passwords don’t match.'; return; }
          }
          go.disabled = true; err.textContent = '';
          try {
            const r = await Online.api(mode === 'login' ? '/api/login' : '/api/register', 'POST', { username: u, password: p });
            Online.setToken(r.token); Online.username = r.username;
            resolve();
          } catch (e) { err.textContent = e.message; } finally { go.disabled = false; }
        };
        go.addEventListener('click', submit);
        for (const el of [user, pass, pass2]) el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') submit(); });
        root.append(h('div.title-card.auth', null,
          h('h1', { text: 'Willowmere' }),
          h('p.hint', { text: 'Online world' }),
          h('label.cc-group', null, h('span.cc-label', { text: 'Username' }), user),
          h('label.cc-group', null, h('span.cc-label', { text: 'Password' }), pass),
          row2, err, go, swap));
        render();
        setTimeout(() => user.focus(), 50);
      });
    },
  };

  /* ---------------------------------------------------------------- other players */
  class RemotePlayer extends G.Entity {
    constructor(game, p) {
      super(game, RemotePlayer.sheet(p.look), { shadowSize: 1.15, radius: 0.45 });
      this.id = p.id; this.name = p.name; this.look = p.look;
      this.target = { x: p.x, z: p.z };
      this.position.set(p.x, G.Terrain.surfaceHeight(p.x, p.z), p.z);
      this.facing = this.targetFacing = p.facing || 0;
      this.moving = !!p.moving;
      this.bubble = null;
    }
    static sheet(l) {
      l = l || {};
      return G.SpriteFactory.humanoid(l.appearance || {}, { job: l.job || 'novice', weapon: l.weapon || 'dagger', unarmed: !l.weapon || l.weapon === 'none', head: l.head || {}, mount: l.mount || null, falcon: !!l.falcon });
    }
    setLook(l) { this.look = l; this.sprite.setSheet(RemotePlayer.sheet(l)); }
    update(dt, camPos) {
      // Glide smoothly toward the last position we heard about.
      const dx = this.target.x - this.position.x, dz = this.target.z - this.position.z, d = Math.hypot(dx, dz);
      if (d > 12) { this.position.x = this.target.x; this.position.z = this.target.z; }
      else if (d > 0.02) { const k = Math.min(1, dt * 10); this.position.x += dx * k; this.position.z += dz * k; if (d > 0.15) this.targetFacing = Math.atan2(dx, dz); }
      this.position.y = G.Terrain.surfaceHeight(this.position.x, this.position.z);
      const walking = this.moving || d > 0.15;
      if (this.swingT > 0) this.swingT -= dt;
      else this.sprite.play(walking ? 'walk' : 'idle');
      this.syncVisuals(dt, camPos);
    }
  }

  const Net = {
    ws: null, players: new Map(), sendT: 0, last: '',
    connect(game, charId) {
      this.game = game; this.charId = charId;
      const ws = this.ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', token: Online.token, charId, map: game.mapId, look: this.myLook() }));
      ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } this.handle(m); };
      ws.onclose = () => {
        this.clear();
        if (this.kicked) return;
        game.log.add('Disconnected from the server. Reconnecting…', 'warn');
        setTimeout(() => { if (this.ws === ws) this.connect(game, charId); }, 3000);
      };
      this.setupChat();
    },
    myLook() {
      const p = this.game.player;
      return { job: p.job, weapon: p.derived.weaponType || 'none', head: p.headLooks(), appearance: p.appearance,
        mount: p.riding ? (p.job === 'crusader' ? 'grandpeco' : 'peco') : null, falcon: !!p.skills.level('falconry_mastery') };
    },
    handle(m) {
      const game = this.game;
      if (m.t === 'welcome' || m.t === 'players') {
        this.clear();
        for (const p of m.players) this.add(p);
        if (m.t === 'welcome') game.log.add(`Connected. ${m.online} player${m.online === 1 ? '' : 's'} online.`, 'system');
      } else if (m.t === 'join') { this.add(m.p); game.log.add(`${m.p.name} arrived.`, 'info'); }
      else if (m.t === 'leave') { const r = this.players.get(m.id); if (r) { game.log.add(`${r.name} left.`, 'info'); r.dispose(); this.players.delete(m.id); } }
      else if (m.t === 'state') { const r = this.players.get(m.id); if (r) { r.target.x = m.x; r.target.z = m.z; r.moving = m.moving; if (!m.moving) r.targetFacing = m.facing; } }
      else if (m.t === 'look') { const r = this.players.get(m.id); if (r) r.setLook(m.look); }
      else if (m.t === 'action') { const r = this.players.get(m.id); if (r && m.kind === 'attack') { r.sprite.play('attack', { restart: true }); r.swingT = 0.45; } }
      else if (m.t === 'chat') {
        game.log.add(`${m.from}: ${m.text}`, 'chat');
        const who = m.id === this.charId ? game.player : this.players.get(m.id);
        if (who) who.bubble = { text: m.text, until: game.time + 5 };
      } else if (m.t === 'kicked') { this.kicked = true; game.log.add(m.text, 'warn'); game.hud.toast(m.text); }
      else if (m.t === 'error') game.log.add(m.text, 'warn');
    },
    add(p) { if (p.id === this.charId || this.players.has(p.id)) return; this.players.set(p.id, new RemotePlayer(this.game, p)); },
    clear() { for (const r of this.players.values()) r.dispose(); this.players.clear(); },
    send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); },
    update(dt) {
      const game = this.game, p = game.player;
      if (!p) return;
      for (const r of this.players.values()) r.update(dt, game.camera3.position);
      this.sendT -= dt;
      if (this.sendT <= 0) {
        this.sendT = 0.12;   // about 8 updates a second
        const s = { t: 'state', map: game.mapId, x: +p.position.x.toFixed(2), z: +p.position.z.toFixed(2), facing: +p.facing.toFixed(2), moving: !!p.moving };
        const key = JSON.stringify(s);
        if (key !== this.last) { this.last = key; this.send(s); }
        const look = JSON.stringify(this.myLook());
        if (look !== this.lastLook) { this.lastLook = look; this.send({ t: 'look', look: JSON.parse(look) }); }
      }
    },
    // A chat line under the message log: Enter to type, Enter to send, Esc to leave.
    setupChat() {
      if (this.chatEl) return;
      const input = h('input#chat-input', { type: 'text', maxlength: '120', placeholder: 'Press Enter to chat', autocomplete: 'off', 'aria-label': 'Chat message' });
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { const text = input.value.trim(); if (text) this.send({ t: 'chat', text }); input.value = ''; input.blur(); }
        else if (e.key === 'Escape') input.blur();
      });
      document.getElementById('log').append(input);
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && document.activeElement !== input && !/input|textarea|select/i.test((e.target && e.target.tagName) || '') && !this.game.dialog.isOpen) { e.preventDefault(); input.focus(); }
      });
      this.chatEl = input;
    },
  };

  G.Online = Online;
  G.Auth = Auth;
  G.Net = Net;
})(window.G = window.G || {});
