/* Parties and guilds (online), like the classics:
   - Party (Alt+Z): create, invite (leader), leave, kick; EXP Each Take / Even
     Share and Item Each Take / Party Share. "%text" chats to the party.
   - Guild (Alt+G): found with an Emperium, invite (master), leave / expel,
     disband; the "Guild Emblem" guild skill lets the master upload an emblem.
     "$text" chats to the guild.
   Names show as  Name [Party]  with the emblem and guild name underneath. */
(function (G) {
  'use strict';
  const h = G.h;
  const Social = {
    party: null, guild: null, emblems: new Map(),
    online() { return !!(G.Net && G.Net.ws && G.Net.ws.readyState === 1); },
    send(o) { if (G.Net) G.Net.send(o); },

    init(game) {
      if (this.game) return;
      this.game = game;
      const W = game.windows;
      this.partyWin = W.create('party', 'Party', { width: 330, keyHint: 'Alt+Z', pos: () => ({ x: 20, y: 230 }) });
      this.partyWin.render = () => this.renderParty();
      this.guildWin = W.create('guild', 'Guild', { width: 350, keyHint: 'Alt+G', pos: () => ({ x: 360, y: 200 }) });
      this.guildWin.render = () => this.renderGuild();
      // Party Share: drops go to a random member on the map.
      const loot = game.loot, spawn = loot.spawn.bind(loot), roll = loot.rollDrops.bind(loot);
      loot.rollDrops = (mon) => { this.rolling = true; try { return roll(mon); } finally { this.rolling = false; } };
      loot.spawn = (id, qty, x, z, auto) => {
        if (this.rolling && id !== 'zeny' && this.party && this.party.itemShare === 'party' && this.online()) { this.send({ t: 'ploot', item: id, qty }); return null; }
        return spawn(id, qty, x, z, auto);
      };
    },
    // EXP from a kill: shared over the server with Even Share, or kept.
    awardKill(p, base, job) {
      if (this.party && this.party.expShare === 'even' && this.online()) this.send({ t: 'pexp', base, job });
      else p.gainExp(base, job);
    },

    handle(m) {
      const game = this.game;
      if (m.t === 'party') { this.party = m.party; game.windows.refresh('party'); }
      else if (m.t === 'guild') { this.guild = m.guild; game.windows.refresh('guild'); }
      else if (m.t === 'guild_created') {
        const e = game.player.inventory.firstOf('emperium');
        if (e) game.player.inventory.remove(e.uid, 1);
        game.save.save(true);
        game.hud.toast(`Guild founded: ${m.name}!`); game.sfx('quest');
      } else if (m.t === 'invite') this.showInvite(m);
      else if (m.t === 'notice') game.log.add(m.text, 'system');
      else if (m.t === 'pinfo') {
        const who = G.Net.players.get(m.id);
        if (who) { who.party = m.party; who.guild = m.guild; }
      } else if (m.t === 'gainexp') {
        game.player.gainExp(m.base, m.job);
        if (m.shared) game.log.add(`Party EXP: +${m.base} base, +${m.job} job (shared by ${m.from}).`, 'info');
      } else if (m.t === 'loot_gift') {
        const r = game.player.inventory.add(m.item, m.qty);
        if (r.added) { game.sfx('pickup'); game.log.add(`Party loot: ${G.Items.get(m.item).name}${m.qty > 1 ? ' ×' + m.qty : ''} (from ${m.from}'s kill).`, 'loot'); }
      }
    },

    /* ---------- names over heads ---------- */
    emblemImg(g) {
      if (!g || !g.ev) return null;
      const key = g.id + ':' + g.ev;
      if (!this.emblems.has(key)) { const img = new Image(); img.src = `/api/guilds/${g.id}/emblem?v=${g.ev}`; this.emblems.set(key, img); }
      const img = this.emblems.get(key);
      return img.complete && img.naturalWidth ? img : null;
    },
    myTags() {
      return { party: this.party ? this.party.name : null, guild: this.guild ? { id: this.guild.id, name: this.guild.name, ev: this.guild.ev } : null };
    },
    // Draw "Name [Party]" and, below it, the emblem and guild name.
    drawName(ov, ctx, name, tags, x, y, color, outline) {
      ov.outlined(ctx, tags && tags.party ? `${name} [${tags.party}]` : name, x, y, 13, color, outline, 600);
      const g = tags && tags.guild;
      if (!g) return;
      ctx.font = '600 12px Fredoka, sans-serif';
      const w = ctx.measureText(g.name).width, img = this.emblemImg(g), ew = img ? 16 : 0;
      const left = x - (w + ew + (img ? 4 : 0)) / 2;
      if (img) { ctx.imageSmoothingEnabled = false; ctx.drawImage(img, left, y + 6, 16, 16); ctx.imageSmoothingEnabled = true; }
      ov.outlined(ctx, g.name, left + ew + (img ? 4 : 0) + w / 2, y + 15, 12, '#ffe7a3', outline, 600);
    },

    /* ---------- invites ---------- */
    showInvite(m) {
      const game = this.game, W = game.windows;
      const w = this.inviteWin || (this.inviteWin = W.create('invite', 'Invitation', { width: 300, pos: () => ({ x: window.innerWidth / 2 - 150, y: 160 }) }));
      const answer = (yes) => { this.send({ t: m.kind === 'party' ? 'party_reply' : 'guild_reply', accept: yes }); W.close('invite'); };
      w.render = () => {
        w.body.textContent = '';
        w.body.append(h('p', { text: `${m.from} invites you to join the ${m.kind} “${m.name}”.` }),
          h('div.opt-btns', null, h('button.btn.small', { type: 'button', onclick: () => answer(true) }, 'Accept'), h('button.btn.small.ghost', { type: 'button', onclick: () => answer(false) }, 'Decline')));
      };
      W.open('invite'); w.render(); game.sfx('talk');
    },

    /* ---------- windows ---------- */
    offlineNote(b) { b.append(h('p.hint', { text: 'Parties and guilds work when you play online (through the Willowmere server).' })); },
    memberRow(x, lead, opts) {
      return h('div.soc-row' + (x.online ? '' : '.off'), null,
        h('span.soc-dot', { title: x.online ? 'Online' : 'Offline' }),
        h('span.soc-name', null, (lead ? '👑 ' : '') + x.name, h('small', { text: ` ${G.Jobs.get(x.job) ? G.Jobs.get(x.job).name : x.job} ${x.level}` })),
        h('small.soc-map', { text: x.online ? (G.Maps[x.map] ? G.Maps[x.map].name : '') : 'offline' }),
        opts && opts.kick ? h('button.btn.small.ghost', { type: 'button', title: 'Remove', onclick: opts.kick }, '✕') : h('span'));
    },
    inviteRow(kind) {
      const inp = h('input.soc-in', { type: 'text', maxlength: '24', placeholder: 'Character name', 'aria-label': `Invite to ${kind}` });
      inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') go(); });
      const go = () => { const n = inp.value.trim(); if (n) { this.send({ t: `${kind}_invite`, name: n }); inp.value = ''; } };
      return h('div.soc-inv', null, inp, h('button.btn.small', { type: 'button', onclick: go }, 'Invite'));
    },
    renderParty() {
      const b = this.partyWin.body, me = G.Net && G.Net.charId;
      b.textContent = '';
      if (!this.online()) return this.offlineNote(b);
      const P = this.party;
      if (!P) {
        const inp = h('input.soc-in', { type: 'text', maxlength: '24', placeholder: 'Party name', 'aria-label': 'Party name' });
        inp.addEventListener('keydown', (e) => e.stopPropagation());
        b.append(h('p.hint', { text: 'You are not in a party. Create one, or ask a party leader to invite you.' }),
          h('div.soc-inv', null, inp, h('button.btn.small', { type: 'button', onclick: () => this.send({ t: 'party_create', name: inp.value.trim() }) }, 'Create party')));
        return;
      }
      const lead = P.leader === me;
      b.append(h('div.soc-title', { text: P.name }), h('div.soc-list', null, ...P.members.map((x) => this.memberRow(x, x.id === P.leader, lead && x.id !== me ? { kick: () => this.send({ t: 'party_kick', id: x.id }) } : null))));
      const sel = (label, key, opts) => {
        const s = h('select', { disabled: !lead, 'aria-label': label, onchange: () => this.send({ t: 'party_settings', expShare: key === 'expShare' ? s.value : P.expShare, itemShare: key === 'itemShare' ? s.value : P.itemShare }) },
          ...opts.map(([v, t]) => h('option', { value: v, text: t, selected: P[key] === v })));
        return h('label.opt', null, h('span', { text: label }), s);
      };
      b.append(h('h3', { text: 'Party settings' }), sel('EXP', 'expShare', [['each', 'Each Take'], ['even', 'Even Share']]), sel('Items', 'itemShare', [['each', 'Each Take'], ['party', 'Party Share']]));
      if (lead) b.append(this.inviteRow('party'));
      b.append(h('div.opt-btns', null, h('button.btn.small.ghost', { type: 'button', onclick: () => this.send({ t: 'party_leave' }) }, 'Leave party')),
        h('p.hint', { text: 'Type %message in chat to talk to your party. Even Share splits EXP between members on the same map (all within 15 levels).' }));
    },
    renderGuild() {
      const b = this.guildWin.body, me = G.Net && G.Net.charId, game = this.game;
      b.textContent = '';
      if (!this.online()) return this.offlineNote(b);
      const g = this.guild;
      if (!g) {
        const has = game.player.inventory.count('emperium') > 0;
        const inp = h('input.soc-in', { type: 'text', maxlength: '24', placeholder: 'Guild name', 'aria-label': 'Guild name' });
        inp.addEventListener('keydown', (e) => e.stopPropagation());
        b.append(h('p.hint', { text: has ? 'You carry an Emperium: you can found a guild. It is used up when the guild is created.' : 'Founding a guild needs an Emperium. Orcs in the Orc Dungeon guard them; the Orc Lord almost always has one.' }),
          h('div.soc-inv', null, inp, h('button.btn.small', { type: 'button', disabled: !has, onclick: () => this.send({ t: 'guild_create', name: inp.value.trim() }) }, 'Found guild')));
        return;
      }
      const master = g.master === me, img = this.emblemImg(g);
      b.append(h('div.soc-head', null, img ? h('img.soc-emblem', { src: img.src, alt: 'Guild emblem' }) : h('div.soc-emblem.empty', { text: '?' }),
        h('div', null, h('div.soc-title', { text: g.name }), h('small', { text: `${g.members.length} member${g.members.length === 1 ? '' : 's'}` }))));
      b.append(h('div.soc-list', null, ...g.members.map((x) => this.memberRow(x, x.id === g.master, master && x.id !== me ? { kick: () => this.send({ t: 'guild_expel', id: x.id }) } : null))));
      // Guild skills: one point to start, for the Guild Emblem skill.
      b.append(h('h3', { text: `Guild skills (${g.skillPoints} point${g.skillPoints === 1 ? '' : 's'})` }),
        h('div.soc-skill', null, h('span', { text: 'Guild Emblem' }), h('small', { text: g.skills && g.skills.emblem ? 'Learned' : 'Lets the master set an emblem.' }),
          master && !(g.skills && g.skills.emblem) ? h('button.btn.small', { type: 'button', disabled: g.skillPoints < 1, onclick: () => this.send({ t: 'guild_skill', skill: 'emblem' }) }, 'Learn') : h('span')));
      if (master && g.skills && g.skills.emblem) {
        const file = h('input', { type: 'file', accept: 'image/png,image/gif,image/jpeg,image/bmp,image/webp', hidden: true });
        file.addEventListener('change', () => { const f = file.files[0]; if (f) this.uploadEmblem(f); file.value = ''; });
        b.append(file, h('div.opt-btns', null, h('button.btn.small', { type: 'button', onclick: () => file.click() }, 'Upload emblem…')),
          h('p.hint', { text: 'Any picture works: it is shrunk to a 24×24 emblem, shown beside your guild name.' }));
      }
      if (master) b.append(this.inviteRow('guild'));
      b.append(h('div.opt-btns', null, h('button.btn.small.ghost', { type: 'button', onclick: (e) => {
        if (master && !e.target.dataset.armed) { e.target.dataset.armed = '1'; e.target.textContent = 'Click again to disband the guild'; return; }
        this.send({ t: 'guild_leave' });
      } }, master ? 'Disband guild' : 'Leave guild')), h('p.hint', { text: 'Type $message in chat to talk to your guild.' }));
    },
    uploadEmblem(file) {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const c = document.createElement('canvas'); c.width = c.height = 24;
        const x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
        const s = Math.min(img.width, img.height); x.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 24, 24);
        URL.revokeObjectURL(url);
        this.send({ t: 'guild_emblem', data: c.toDataURL('image/png') });
      };
      img.onerror = () => this.game.log.add('That file isn\'t a picture.', 'warn');
      img.src = url;
    },
  };
  G.Social = Social;
})(window.G = window.G || {});
