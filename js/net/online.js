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
        const err = h('p.auth-err', { role: 'alert' });
        const go = h('button.auth-go', { type: 'button' }, h('span', { text: 'Log in' }));
        const swap = h('button.auth-swap', { type: 'button' }, 'Create an account');
        const row2 = h('label.auth-field', null, h('span.auth-label', { text: 'Repeat password' }), h('span.auth-input', null, pass2));
        const render = () => {
          go.firstChild.textContent = mode === 'login' ? 'Log in' : 'Create account';
          swap.textContent = mode === 'login' ? 'Create an account' : 'I already have an account';
          row2.hidden = mode === 'login';
          err.hidden = true;
          pass.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
          err.textContent = '';
        };
        const showErr = (t) => { err.textContent = t; err.hidden = !t; };
        swap.addEventListener('click', () => { mode = mode === 'login' ? 'register' : 'login'; render(); user.focus(); });
        const submit = async () => {
          const u = user.value.trim(), p = pass.value;
          if (!/^[A-Za-z0-9_]{3,24}$/.test(u)) { showErr('Usernames are 3 to 24 letters, numbers or underscores.'); return; }
          if (mode === 'register') {
            if (p.length < 8) { showErr('Passwords need at least 8 characters.'); return; }
            if (p !== pass2.value) { showErr('The passwords don’t match.'); return; }
          }
          go.disabled = true; showErr('');
          try {
            const r = await Online.api(mode === 'login' ? '/api/login' : '/api/register', 'POST', { username: u, password: p });
            Online.setToken(r.token); Online.username = r.username;
            resolve();
          } catch (e) { showErr(e.message); } finally { go.disabled = false; }
        };
        go.addEventListener('click', submit);
        for (const el of [user, pass, pass2]) el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') submit(); });
        // Show / hide the password.
        const eye = h('button.auth-eye', { type: 'button', 'aria-label': 'Show password', title: 'Show password' }, '👁');
        eye.addEventListener('click', () => {
          const show = pass.type === 'password';
          pass.type = pass2.type = show ? 'text' : 'password';
          eye.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
          eye.classList.toggle('on', show);
        });
        const field = (label, input, extra) => h('label.auth-field', null, h('span.auth-label', { text: label }), h('span.auth-input', null, input, extra || null));
        const title = h('h2.auth-title');
        const sub = h('p.auth-sub');
        const renderTitle = () => {
          title.textContent = mode === 'login' ? 'Welcome back' : 'Create your account';
          sub.textContent = mode === 'login' ? 'Log in to the online world' : 'Join the online world: pick a username and password';
        };
        swap.addEventListener('click', renderTitle);
        root.append(h('div.title-card.auth', null,
          h('h1', { text: 'Willowmere' }),
          h('div.auth-panel', null,
            title,
            sub,
            field('Username', user),
            field('Password', pass, eye),
            row2, err, go,
            h('div.auth-or', null, h('span', { text: 'or' })),
            swap)));
        renderTitle();
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
      // Enough of a "player" for monsters to chase and hit.
      this.isRemote = true;
      this.derived = { extra: {}, def: 0, softDef: 0, flee: 0 };
      this.hidden = false; this.cloaked = false; this.playingDead = false;
      this.cast = null;
      this.party = p.party || null; this.guild = p.guild || null;
      this.syncCart();
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
    setLook(l) { this.look = l; this.sprite.setSheet(RemotePlayer.sheet(l)); this.syncCart(); }
    // A monster on the host hit this player: their own game takes the damage.
    takeDamage(dmg, mon) { if (mon) Net.send({ t: 'mob', op: 'hurt', id: mon.id, to: this.id, dmg: Math.round(dmg) }); }
    // Merchant carts, seen by everyone.
    syncCart() {
      const want = this.look && Number.isInteger(this.look.cart) ? this.look.cart : null;
      if (want === this.cartStyle) return;
      if (this.cartMesh) { this.cartMesh.parent && this.cartMesh.parent.remove(this.cartMesh); this.cartMesh = null; }
      this.cartStyle = want;
      if (want != null) { this.cartMesh = G.Cart.mesh(want); this.game.mapRoot.add(this.cartMesh); this.cartMesh.position.copy(this.position); }
    }
    dispose() { if (this.cartMesh && this.cartMesh.parent) this.cartMesh.parent.remove(this.cartMesh); super.dispose(); }
    update(dt, camPos) {
      // Glide smoothly toward the last position we heard about.
      const dx = this.target.x - this.position.x, dz = this.target.z - this.position.z, d = Math.hypot(dx, dz);
      if (d > 12) { this.position.x = this.target.x; this.position.z = this.target.z; }
      else if (d > 0.02) { const k = Math.min(1, dt * 10); this.position.x += dx * k; this.position.z += dz * k; if (d > 0.15) this.targetFacing = Math.atan2(dx, dz); }
      this.position.y = G.Terrain.surfaceHeight(this.position.x, this.position.z);
      const walking = this.moving || d > 0.15;
      if (this.cast) { this.cast.t += dt; if (this.cast.t > this.cast.dur + 0.3) this.cast = null; }
      if (this.swingT > 0) this.swingT -= dt;
      else this.sprite.play(this.cast ? 'cast' : walking ? 'walk' : 'idle');
      if (this.cartMesh) {
        if (!this.cartMesh.parent) this.game.mapRoot.add(this.cartMesh);
        G.Cart.follow(this.cartMesh, this, dt);
      }
      this.syncVisuals(dt, camPos);
    }
  }

  const Net = {
    ws: null, players: new Map(), sendT: 0, last: '',
    connect(game, charId) {
      this.game = game; this.charId = charId;
      const ws = this.ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', token: Online.token, charId, map: game.mapId, look: this.myLook(), level: game.player.baseLevel }));
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
        mount: p.riding ? (p.job === 'crusader' ? 'grandpeco' : 'peco') : null, falcon: !!p.skills.level('falconry_mastery'),
        cart: p.skills.level('pushcart') ? (p.extra.cartStyle || 0) : null };
    },
    handle(m) {
      const game = this.game;
      if (m.t === 'host' || m.t === 'mobs' || m.t === 'mob') { G.MobSync.handle(m); return; }
      if (['party', 'guild', 'guild_created', 'invite', 'notice', 'pinfo', 'gainexp', 'loot_gift'].includes(m.t)) { G.Social.handle(m); return; }
      if (m.t === 'fx') { this.showFx(m); return; }
      if (m.t === 'buff') { this.receiveBuff(m); return; }
      if (m.t === 'welcome' || m.t === 'players') {
        this.clear();
        for (const p of m.players) this.add(p);
        if (m.mobs && m.mobs.length) G.MobSync.applySnapshot(m.mobs);
        if (m.t === 'welcome') game.log.add(`Connected. ${m.online} player${m.online === 1 ? '' : 's'} online.`, 'system');
      } else if (m.t === 'join') { this.add(m.p); game.log.add(`${m.p.name} arrived.`, 'info'); }
      else if (m.t === 'leave') { const r = this.players.get(m.id); if (r) { game.log.add(`${r.name} left.`, 'info'); r.dispose(); this.players.delete(m.id); } }
      else if (m.t === 'state') { const r = this.players.get(m.id); if (r) { r.target.x = m.x; r.target.z = m.z; r.moving = m.moving; if (!m.moving) r.targetFacing = m.facing; } }
      else if (m.t === 'look') { const r = this.players.get(m.id); if (r) r.setLook(m.look); }
      else if (m.t === 'action') { const r = this.players.get(m.id); if (r && m.kind === 'attack') { r.sprite.play('attack', { restart: true }); r.swingT = 0.45; } }
      else if (m.t === 'chat') {
        game.log.add(m.channel === 'party' ? `(Party) ${m.from}: ${m.text}` : m.channel === 'guild' ? `(Guild) ${m.from}: ${m.text}` : `${m.from}: ${m.text}`, m.channel || 'chat');
        if (m.channel) return;
        const who = m.id === this.charId ? game.player : this.players.get(m.id);
        if (who) who.bubble = { text: m.text, until: game.time + 5 };
      } else if (m.t === 'kicked') { this.kicked = true; game.log.add(m.text, 'warn'); game.hud.toast(m.text); }
      else if (m.t === 'error') game.log.add(m.text, 'warn');
    },
    add(p) { if (p.id === this.charId || this.players.has(p.id)) return; this.players.set(p.id, new RemotePlayer(this.game, p)); },
    clear() { for (const r of this.players.values()) r.dispose(); this.players.clear(); },
    send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); },

    /* ---------- skills seen by others ---------- */
    // Describe the target so other games can find it.
    skillFx(s, lv, target) {
      const p = this.game.player;
      let tg = null;
      if (target && target.ground) tg = { x: +target.position.x.toFixed(2), z: +target.position.z.toFixed(2) };
      else if (target && target.isRemote) tg = { p: target.id };
      else if (target === p) tg = { p: this.charId };
      else if (target && target.def) tg = { m: target.id };
      this.send({ t: 'fx', k: 'skill', s: s.id, lv, tg });
    },
    showFx(m) {
      const game = this.game, caster = this.players.get(m.from), s = G.Skills.get(m.s);
      if (!caster || !s) return;
      if (m.k === 'cast') {
        caster.cast = { id: s.id, t: 0, dur: Math.max(0.2, Number(m.dur) || 1) };
        game.spells.castCircle(caster, s.element);
        return;
      }
      caster.cast = null;
      const tg = m.tg || {};
      let target = null;
      if (tg.m != null) target = game.monsters.list.find((x) => x.id === tg.m);
      else if (tg.p != null) target = tg.p === this.charId ? game.player : this.players.get(tg.p);
      else if (tg.x != null) target = { position: new THREE.Vector3(tg.x, G.Terrain.surfaceHeight(tg.x, tg.z), tg.z), def: { height: 1 }, alive: true };
      const at = caster.position.clone(); at.y += 2.4;
      game.overlay.addText(at, s.name + '!', 'skill');
      const color = (s.icon && s.icon.color) || '#ffffff', fx = s.fx || {};
      const noop = () => {};
      if (!target || target === caster || s.target === 'self') {
        if (fx.area) game.spells.ring(caster.position, color, fx.area); else game.spells.aura(caster, color);
        return;
      }
      if (s.target === 'ally') { game.spells.aura(target, color); return; }
      const hits = Math.min(6, fx.hits ? fx.hits(lv) : 1);
      for (let i = 0; i < hits; i++) game.after(i * (fx.hitDelay || 0.12), () => {
        if (s.target === 'ground' || fx.area) game.spells.ring(target.position, color, fx.area || 2.5);
        if (fx.visual === 'orb') game.spells.orb(caster, target, color, noop);
        else if (fx.visual === 'arrow') game.spells.arrow(caster, target, noop);
        else if (fx.visual === 'beam') game.spells.beam(target, color, noop);
        else if (fx.visual === 'bolt' || fx.visual === 'meteor' || (s.element && s.element !== 'neutral' && !fx.visual)) game.spells.bolt(s.element || 'fire', target, noop);
        else if (target.def) game.spells.impact(target, color, 1);
      });
    },

    /* ---------- buffing other players ---------- */
    sendBuff(target, s, lv) {
      this.send({ t: 'buff', to: target.id, skill: s.id, lv });
      this.game.spells.aura(target, (s.icon && s.icon.color) || '#ffffff');
      this.game.log.add(`You cast ${s.name} on ${target.name}.`, 'info');
    },
    receiveBuff(m) {
      const game = this.game, p = game.player, s = G.Skills.get(m.skill);
      if (!s || s.target !== 'ally' || !p.alive) return;
      const sys = p.skills, run = G.SkillSystem.EFFECTS[s.effect || s.id];
      if (run) run(sys, m.lv, p, s); else if (s.fx) G.SkillSystem.runFx(sys, s, m.lv, p);
      game.log.add(`${m.fromName} cast ${s.name} on you.`, 'level');
    },
    update(dt) {
      const game = this.game, p = game.player;
      if (!p) return;
      if (game.mapId !== this.mapSeen) { this.mapSeen = game.mapId; G.MobSync.reset(); }
      for (const r of this.players.values()) r.update(dt, game.camera3.position);
      this.sendT -= dt;
      if (this.sendT <= 0) {
        this.sendT = 0.12;   // about 8 updates a second
        const s = { t: 'state', map: game.mapId, x: +p.position.x.toFixed(2), z: +p.position.z.toFixed(2), facing: +p.facing.toFixed(2), moving: !!p.moving, level: p.baseLevel };
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
