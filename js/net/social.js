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
      // Guild EXP tax: part of each kill's base EXP goes to the guild.
      const meM = this.guild && G.Net && this.guild.members.find((x) => x.id === G.Net.charId);
      const tax = meM ? ((this.guild.rankTax || [])[meM.rank] || 0) : 0;   // your rank's EXP tax
      if (tax > 0 && this.online()) { const cut = Math.floor(base * tax / 100); if (cut > 0) { this.send({ t: 'gexp', amount: cut }); base -= cut; } }
      if (this.party && this.party.expShare === 'even' && this.online()) this.send({ t: 'pexp', base, job });
      else p.gainExp(base, job);
    },

    handle(m) {
      const game = this.game;
      if (m.t === 'party') { this.party = m.party; game.windows.refresh('party'); }
      else if (m.t === 'guild') { this.guild = m.guild; game.windows.refresh('guild'); }
      else if (m.t === 'guild_created') {
        const e = game.player.inventory.firstOf('emperium');   // the server used it up already
        if (e) G.Ledger.quiet(() => game.player.inventory.remove(e.uid, 1));
        game.save.save(true);
        game.hud.toast(`Guild founded: ${m.name}!`); game.sfx('quest');
      } else if (m.t === 'invite') this.showInvite(m);
      else if (m.t === 'notice') { game.log.add(m.text, 'system'); if (m.toast) game.hud.toast(m.text); }
      else if (m.t === 'pinfo') {
        const who = G.Net.players.get(m.id);
        if (who) { who.party = m.party; who.guild = m.guild; }
      } else if (m.t === 'guild_summon') {
        game.log.add(`Emergency Call! ${m.from} summons the guild.`, 'level'); game.hud.toast(`${m.from} summons you!`);
        if (m.map === game.mapId) game.player.teleport(m.x + 1, m.z); else game.travel(m.map, m.x + 1, m.z);
      } else if (m.t === 'gainexp') {
        G.Ledger.quiet(() => game.player.gainExp(m.base, m.job));   // the server added it already
        if (m.shared) game.log.add(`Party EXP: +${m.base} base, +${m.job} job (shared by ${m.from}).`, 'info');
      } else if (m.t === 'loot_gift') {
        const r = G.Ledger.quiet(() => game.player.inventory.add(m.item, m.qty, { ignoreWeight: true }));
        if (r.added) { game.sfx('pickup'); game.log.add(`Party loot: ${G.Items.get(m.item).name}${m.qty > 1 ? ' ×' + m.qty : ''} (from ${m.from}'s kill).`, 'loot'); }
      }
    },

    /* ---------- names over heads ---------- */
    // Magenta (#FF00FF) means "see-through" in a guild emblem, like the classics.
    // Magenta (#FF00FF) is see-through, like the classic emblems; the looser
    // test also clears the pinkish fringe left when a bigger picture is shrunk.
    isMagenta(r, g, b) { return r >= 140 && b >= 140 && r - g >= 90 && b - g >= 90 && Math.abs(r - b) <= 80; },
    keyMagenta(canvas) {
      const x = canvas.getContext('2d'), img = x.getImageData(0, 0, canvas.width, canvas.height), d = img.data;
      for (let i = 0; i < d.length; i += 4) if (this.isMagenta(d[i], d[i + 1], d[i + 2])) d[i + 3] = 0;
      x.putImageData(img, 0, 0);
      return canvas;
    },
    emblemImg(g) {
      if (!g || !g.ev) return null;
      const key = g.id + ':' + g.ev;
      if (!this.emblems.has(key)) {
        const slot = { ready: null };
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
          c.getContext('2d').drawImage(img, 0, 0);
          slot.ready = this.keyMagenta(c);
          slot.url = slot.ready.toDataURL('image/png');
        };
        img.src = `/api/guilds/${g.id}/emblem?v=${g.ev}`;
        this.emblems.set(key, slot);
      }
      return this.emblems.get(key).ready;
    },
    emblemUrl(g) { const s = g && this.emblems.get(g.id + ':' + g.ev); return s && s.url; },
    myTags() {
      const me = this.guild && G.Net && this.guild.members.find((x) => x.id === G.Net.charId);
      return { party: this.party ? this.party.name : null, guild: this.guild ? { id: this.guild.id, name: this.guild.name, ev: this.guild.ev, rank: me ? this.guild.ranks[me.rank] : '' } : null };
    },
    // Name tag: the guild emblem (24x24) on the left, "Name [Party]" on top
    // and "Guild [Rank]" underneath, like the classics.
    drawName(ov, ctx, name, tags, x, y, color, outline) {
      const top = tags && tags.party ? `${name} [${tags.party}]` : name;
      const g = tags && tags.guild;
      if (!g) { ov.outlined(ctx, top, x, y, 13, color, outline, 600); return; }
      const low = g.rank ? `${g.name} [${g.rank}]` : g.name;
      ctx.font = '600 13px Fredoka, sans-serif'; const w1 = ctx.measureText(top).width;
      ctx.font = '600 12px Fredoka, sans-serif'; const w2 = ctx.measureText(low).width;
      const img = this.emblemImg(g), ew = img ? 28 : 0, total = ew + Math.max(w1, w2), left = x - total / 2;
      if (img) {
        ctx.imageSmoothingEnabled = false; ctx.drawImage(img, left, y - 10, 24, 24); ctx.imageSmoothingEnabled = true;
      }
      const tx = left + ew;
      ov.outlined(ctx, top, tx + w1 / 2, y, 13, color, outline, 600);
      ov.outlined(ctx, low, tx + w2 / 2, y + 14, 12, '#ffe7a3', outline, 600);
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
      b.append(h('div.soc-head', null, img ? h('img.soc-emblem', { src: this.emblemUrl(g), alt: 'Guild emblem' }) : h('div.soc-emblem.empty', { text: '?' }),
        h('div', null, h('div.soc-title', { text: g.name }), h('small', { text: `${g.members.length} member${g.members.length === 1 ? '' : 's'}` }))));
      const meM = g.members.find((x) => x.id === me) || { rank: 3, tax: 0 };
      const officer = meM.rank <= 1;
      // Level and guild EXP.
      b.append(h('div.soc-level', null, h('span', { text: `Guild level ${g.level}` }), h('div.meter.small', null, h('i', { style: `width:${Math.min(100, g.exp / g.next * 100)}%` }), h('b', { text: `${g.exp} / ${g.next}` }))));
      // Members with their ranks (the Guild Leader can change them).
      b.append(h('div.soc-list', null, ...g.members.map((x) => {
        const row = this.memberRow(x, x.id === g.master, (master || (officer && x.rank > 1)) && x.id !== me && x.id !== g.master ? { kick: () => this.send({ t: 'guild_expel', id: x.id }) } : null);
        const rk = master && x.id !== g.master
          ? h('select.soc-rank', { 'aria-label': `Rank of ${x.name}`, onchange: (e) => this.send({ t: 'guild_set_rank', id: x.id, rank: Number(e.target.value) }) }, ...g.ranks.map((r, i) => i).filter((i) => i > 0).map((i) => h('option', { value: String(i), text: g.ranks[i], selected: x.rank === i })))
          : h('small.soc-rankname', { text: g.ranks[x.rank] || '' });
        row.insertBefore(rk, row.children[2]);
        return row;
      })), h('small.hint', { text: `${g.members.length} / ${g.maxMembers} members` }));
      // Ranks: name and EXP tax for each (the Guild Leader edits them).
      const taxes = g.rankTax || [];
      b.append(h('h3', { text: 'Ranks and EXP tax' }), h('div.soc-ranktable', null,
        h('div.soc-rankrow.head', null, h('span', { text: 'Rank' }), h('span', { text: 'EXP tax' })),
        ...g.ranks.map((r, i) => {
          const stop = (e) => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); };
          const name = master
            ? h('input.soc-in', { type: 'text', maxlength: '20', value: r, 'aria-label': `Rank ${i + 1} name`, onkeydown: stop, onchange: (e) => this.send({ t: 'guild_rank_name', index: i, name: e.target.value.trim() }) })
            : h('span', { text: r });
          const tax = master
            ? h('span.soc-taxin', null, h('input.soc-in', { type: 'number', min: '0', max: '50', value: String(taxes[i] || 0), 'aria-label': `EXP tax for ${r}`, onkeydown: stop,
                onchange: (e) => this.send({ t: 'guild_rank_tax', index: i, tax: Math.max(0, Math.min(50, Number(e.target.value) || 0)) }) }), h('small', { text: '%' }))
            : h('span', { text: `${taxes[i] || 0}%` });
          return h('div.soc-rankrow' + (meM.rank === i ? '.mine' : ''), null, name, tax);
        })),
        h('p.hint', { text: `Your rank: ${g.ranks[meM.rank] || ''}, paying ${taxes[meM.rank] || 0}% of your base EXP from kills to the guild. New members join as ${g.ranks[3] || 'the 4th rank'}.` }));
      if (master && g.ranks.length < 8) {
        const inp = h('input.soc-in', { type: 'text', maxlength: '20', placeholder: 'New rank name', 'aria-label': 'New rank name', onkeydown: (e) => e.stopPropagation() });
        b.append(h('div.soc-inv', null, inp, h('button.btn.small', { type: 'button', onclick: () => { this.send({ t: 'guild_rank_add', name: inp.value.trim() }); inp.value = ''; } }, 'Add rank')));
      }
      // Guild skills.
      b.append(h('h3', { text: `Guild skills (${g.skillPoints} point${g.skillPoints === 1 ? '' : 's'})` }), h('div.soc-skills', null, ...GSK.map(([id, name, max, desc]) => {
        const lv = (g.skills && g.skills[id]) || 0;
        return h('div.soc-skill', null, h('span', { text: `${name} ${lv}/${max}` }), h('small', { text: desc }),
          master && lv < max ? h('button.btn.small', { type: 'button', disabled: g.skillPoints < 1, onclick: () => this.send({ t: 'guild_skill', skill: id }) }, 'Learn') : h('span'));
      })));
      if (master && g.skills && g.skills.call) {
        const left = Math.max(0, Math.ceil(((this.callT || 0) - Date.now()) / 1000));
        b.append(h('div.opt-btns', null, h('button.btn.small', { type: 'button', disabled: left > 0, onclick: () => { this.send({ t: 'guild_call' }); this.callT = Date.now() + 300000; this.renderGuild(); } }, left > 0 ? `Emergency Call (${left}s)` : 'Emergency Call')));
      }
      if (master && g.skills && g.skills.emblem) {
        const file = h('input', { type: 'file', accept: 'image/png,image/gif,image/jpeg,image/bmp,image/webp', hidden: true });
        file.addEventListener('change', () => { const f = file.files[0]; if (f) this.uploadEmblem(f); file.value = ''; });
        b.append(file, h('div.opt-btns', null, h('button.btn.small', { type: 'button', onclick: () => file.click() }, 'Upload emblem…')),
          h('p.hint', { text: 'Any picture works: it is shrunk to a 24×24 emblem, shown beside your guild name. Pink (#FF00FF) becomes transparent, like the classics. Pure magenta (#FF00FF) becomes transparent, like the classics.' }));
      }
      if (master || officer) b.append(this.inviteRow('guild'));
      b.append(h('div.opt-btns', null, h('button.btn.small.ghost', { type: 'button', onclick: (e) => {
        if (master && !e.target.dataset.armed) { e.target.dataset.armed = '1'; e.target.textContent = 'Click again to disband the guild'; return; }
        this.send({ t: 'guild_leave' });
      } }, master ? 'Disband guild' : 'Leave guild')), h('p.hint', { text: 'Type $message in chat to talk to your guild.' }));
    },
    uploadEmblem(file) {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const s = Math.min(img.width, img.height);
        const full = document.createElement('canvas'); full.width = full.height = s;
        full.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, s, s);
        this.keyMagenta(full);
        const c = document.createElement('canvas'); c.width = c.height = 24;
        const x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
        x.drawImage(full, 0, 0, s, s, 0, 0, 24, 24);
        this.keyMagenta(c);
        URL.revokeObjectURL(url);
        this.send({ t: 'guild_emblem', data: c.toDataURL('image/png') });
      };
      img.onerror = () => this.game.log.add('That file isn\'t a picture.', 'warn');
      img.src = url;
    },
  };
  /* ---------- guild skills (classic set) ---------- */
  const GSK = [
    ['emblem', 'Guild’s Glory', 1, 'Lets the Guild Leader set a guild emblem.'],
    ['extension', 'Guild Extension', 10, 'Room for 4 more members per level (16 at the start).'],
    ['leadership', 'Great Leadership', 5, 'Members near the Guild Leader get +1 STR per level.'],
    ['wounds', 'Glorious Wounds', 5, 'Members near the Guild Leader get +1 VIT per level.'],
    ['coldheart', 'Cold Heart', 5, 'Members near the Guild Leader get +1 AGI per level.'],
    ['sharpgaze', 'Sharp Gaze', 5, 'Members near the Guild Leader get +1 DEX per level.'],
    ['regen', 'Regeneration', 3, 'Members near the Guild Leader recover extra HP and SP.'],
    ['call', 'Emergency Call', 1, 'The Guild Leader summons every online member (5 minute cooldown).'],
  ];
  Social.GSK = GSK;
  // Is our Guild Leader on this map and close by (or are we the leader)?
  Social.nearLeader = function () {
    const g = this.guild, game = this.game;
    if (!g || !G.Net) return false;
    if (g.master === G.Net.charId) return true;
    const r = G.Net.players.get(g.master);
    return !!r && Math.hypot(r.position.x - game.player.position.x, r.position.z - game.player.position.z) < 15;
  };
  G.Stats.sources.push((p, out) => {
    const S = G.Social, sk = S.guild && S.guild.skills;
    if (!sk || !S.game || p !== S.game.player || !S.nearLeader()) return;
    for (const [k, st] of [['leadership', 'str'], ['wounds', 'vit'], ['coldheart', 'agi'], ['sharpgaze', 'dex']]) if (sk[k]) out[st] = (out[st] || 0) + sk[k];
  });
  // Re-check the leader's aura and regeneration once a second.
  setInterval(() => {
    const S = Social, game = S.game;
    if (!game || !game.player || !S.guild) return;
    const near = S.nearLeader();
    if (near !== S.wasNear) { S.wasNear = near; game.player.recalc(); }
    const rg = S.guild.skills && S.guild.skills.regen;
    if (near && rg && game.player.alive && (S.regenT = (S.regenT || 0) + 1) >= 6) {
      S.regenT = 0; const p = game.player;
      p.hp = Math.min(p.maxHp, p.hp + Math.ceil(p.maxHp * 0.01 * rg)); p.sp = Math.min(p.maxSp, p.sp + Math.ceil(p.maxSp * 0.01 * rg));
    }
  }, 1000);

  G.Social = Social;
})(window.G = window.G || {});
