/* Title screen and character creation. Resolves with
   { type: 'load', data } or { type: 'new', name, appearance }. */
(function (G) {
  'use strict';
  const h = G.h;
  const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 '\-]{1,15}$/;

  function show(slots, opts) {
    opts = opts || {};
    const online = !!opts.online;
    return new Promise((resolve) => {
      const root = document.getElementById('title');
      root.hidden = false;
      root.textContent = '';
      let raf = 0;
      const finish = (result) => { cancelAnimationFrame(raf); root.classList.add('done'); setTimeout(() => { root.hidden = true; root.classList.remove('done'); }, 600); resolve(result); };

      /* Character select: 15 slots, like the classics. */
      let selected = slots.findIndex(Boolean);
      if (selected < 0) selected = 0;
      let deleteArmed = -1;

      // A small portrait from the character's sprite sheet (facing the viewer).
      function portrait(d) {
        const eq = d.equipment || {}, w = eq.weapon && G.Items.get(eq.weapon.id);
        const look = (slot) => { const e = eq[slot], it = e && G.Items.get(e.id); return (it && it.look) || ''; };
        const sheet = G.SpriteFactory.humanoid(d.character.appearance, {
          job: d.job, weapon: w ? w.weaponType : 'dagger', unarmed: !w,
          head: { top: look('headTop'), mid: look('headMid'), low: look('headLow') },
          falcon: !!(d.skills && d.skills.levels && d.skills.levels.falconry_mastery),
        });
        const c = h('canvas.cs-portrait', { width: '120', height: '150', 'aria-hidden': 'true' });
        const cell = sheet.anims.idle.start, col = cell % sheet.cols, row = (cell / sheet.cols) | 0;
        c.getContext('2d').drawImage(sheet.canvas, col * sheet.frameW + (sheet.frameW - 120) / 2, row * sheet.frameH + sheet.frameH - 160, 120, 150, 0, 0, 120, 150);
        return c;
      }

      // Dark letters on pale badges (Priest, Crusader...).
      const light = (hex) => { if (!hex) return false; const n = parseInt(hex.slice(1), 16); return ((n >> 16) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11) > 180; };

      // Start the chosen character (online: fetch the full save from the server first).
      async function startLoad(i) {
        const d = slots[i];
        if (!online) { finish({ type: 'load', data: d, slot: i }); return; }
        try {
          const full = await G.Online.api(`/api/characters/${d.id}`);
          if (full.isNew) finish({ type: 'new', name: full.character.name, appearance: full.character.appearance, slot: i, charId: full.id });
          else finish({ type: 'load', data: full, slot: i, charId: full.id });
        } catch (e) { alert(e.message); }
      }

      function titleCard() {
        cancelAnimationFrame(raf);
        root.textContent = '';
        const grid = h('div.cs-grid', { role: 'listbox', 'aria-label': 'Characters' });
        slots.forEach((d, i) => {
          const job = d && (G.Jobs.get(d.job) || G.Jobs.get('novice'));
          const card = h('div.cs-card' + (d ? '' : '.empty') + (i === selected ? '.sel' : ''), {
            role: 'option', tabindex: '0', 'aria-selected': String(i === selected),
            'aria-label': d ? `${d.character.name}, ${job.name}, base level ${d.baseLevel}` : `Empty slot ${i + 1}: create a character`,
          },
          d ? portrait(d) : h('div.cs-plus', { text: '+' }),
          d ? h('span.cs-badge', { text: job.name[0], title: job.name, style: `background:${job.color || '#8a9bc4'};color:${light(job.color) ? '#2a3550' : '#fff'}` }) : null,
          h('div.cs-name', { text: d ? d.character.name : 'NAME' }));
          card.addEventListener('click', () => { if (!d) { creation(i); return; } selected = i; deleteArmed = -1; titleCard(); });
          card.addEventListener('dblclick', () => { if (d) startLoad(i); });
          card.addEventListener('keydown', (e) => { if (e.key === 'Enter') { if (d) startLoad(i); else creation(i); } });
          grid.append(card);
        });

        const d = slots[selected];
        const pct = (a, b) => (b ? `${Math.min(100, Math.floor((a / b) * 100))}%` : '0%');
        const rows = d ? [
          ['MAP', (G.Maps[(d.position || {}).map] || G.Maps.meadow).name],
          ['JOB', (G.Jobs.get(d.job) || G.Jobs.get('novice')).name],
          ['Lv.', `${d.baseLevel} / ${d.jobLevel}`],
          ['EXP', pct(d.baseExp, G.Config.EXP_TABLE ? G.Config.EXP_TABLE[d.baseLevel] : 0)],
          ['HP', String(Math.round(d.hp))], ['SP', String(Math.round(d.sp))],
          ...['str', 'agi', 'vit', 'int', 'dex', 'luk'].map((k) => [k.toUpperCase(), String(d.stats[k])]),
        ] : [];
        const del = h('button.btn.small.ghost.cs-del', { type: 'button', disabled: !d, onclick: () => {
          if (deleteArmed !== selected) { deleteArmed = selected; titleCard(); return; }
          const drop = () => { slots[selected] = null; deleteArmed = -1; selected = Math.max(0, slots.findIndex(Boolean)); titleCard(); };
          if (online) G.Online.api(`/api/characters/${d.id}`, 'DELETE').then(drop).catch((e) => { del.textContent = e.message; });
          else { G.SaveSystem.clearSlot(selected); drop(); }
        } }, deleteArmed === selected && d ? `Really delete ${d.character.name}?` : 'Delete character');
        const start = h('button.cs-start', { type: 'button', disabled: !d, onclick: () => d && startLoad(selected) },
          h('span', { text: 'Game start' }));

        root.append(h('div.cs', null,
          grid,
          h('div.cs-side', null,
            h('div.cs-logo', { text: 'Willowmere' }),
            h('table.cs-stats', null, h('tbody', null, ...(d ? rows : [['', 'Pick or create a character']]).map(([k, v]) => h('tr', null, h('th', { text: k }), h('td', { text: v }))))),
            del,
            start,
            h('div.cs-count', { text: `Characters ${slots.filter(Boolean).length} / ${slots.length}` }),
            online ? h('button.btn.small.ghost.cs-logout', { type: 'button', onclick: () => G.Online.logout() }, `Log out (${G.Online.username || ''})`) : null)));
        setTimeout(() => { const s2 = root.querySelector('.cs-card.sel'); if (s2) s2.focus(); }, 30);
      }

      function creation(slot) {
        root.textContent = '';
        const AP = G.SpriteFactory.APPEARANCE;
        const app = { hair: 'chestnut', outfit: 'sky', eyes: 'blue', style: 'ponytail' };
        let draw = G.SpriteFactory.noviceDraw(app);
        const painter = new G.RigPainter(2.55, 0.32);
        const canvas = h('canvas.preview', { width: '300', height: '330', 'aria-label': 'Character preview' });
        const ctx = canvas.getContext('2d');
        let theta = 0.3, spin = true, last = performance.now(), t = 0, drag = null;
        canvas.addEventListener('pointerdown', (e) => { drag = e.clientX; spin = false; canvas.setPointerCapture(e.pointerId); });
        canvas.addEventListener('pointermove', (e) => { if (drag != null) { theta -= (e.clientX - drag) * 0.02; drag = e.clientX; } });
        canvas.addEventListener('pointerup', () => { drag = null; });
        const loop = (now) => {
          const dt = Math.min(0.05, (now - last) / 1000); last = now;
          t = (t + dt * 0.9) % 1;
          if (spin) theta += dt * 0.6;
          ctx.clearRect(0, 0, 300, 330);
          ctx.fillStyle = 'rgba(40,70,40,0.25)';
          ctx.beginPath(); ctx.ellipse(150, 312, 80, 17, 0, 0, Math.PI * 2); ctx.fill();
          painter.begin(theta, 150, 312);
          draw(painter, 'idle', t);
          painter.render(ctx);
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);

        const groups = h('div.cc-groups');
        const swatchGroup = (label, key, list, isColor) => {
          const row = h('div.swatches', { role: 'radiogroup', 'aria-label': label });
          const renderRow = () => {
            row.textContent = '';
            list.forEach((o) => row.append(h('button' + (isColor ? '.sw' : '.chip') + (app[key] === o.id ? '.on' : ''), {
              type: 'button', role: 'radio', 'aria-checked': String(app[key] === o.id), 'aria-label': o.name, title: o.name,
              style: isColor ? `--c:${o.color}` : null,
              onclick: () => { app[key] = o.id; draw = G.SpriteFactory.noviceDraw(app); renderRow(); },
            }, isColor ? null : o.name)));
          };
          renderRow();
          groups.append(h('div.cc-group', null, h('span.cc-label', { text: label }), row));
        };
        swatchGroup('Hair colour', 'hair', AP.hair, true);
        swatchGroup('Hairstyle', 'style', AP.style, false);
        swatchGroup('Outfit', 'outfit', AP.outfit, true);
        swatchGroup('Eyes', 'eyes', AP.eyes, true);

        const nameIn = h('input#cc-name', { type: 'text', maxlength: '16', placeholder: 'Your name', autocomplete: 'off', spellcheck: 'false' });
        const err = h('p.cc-err', { role: 'alert' });
        const begin = h('button.btn.big', {
          type: 'button',
          onclick: () => {
            const name = nameIn.value.trim().replace(/\s+/g, ' ');
            if (!NAME_RE.test(name)) { err.textContent = 'Use 2 to 16 letters or numbers. Spaces, apostrophes and hyphens are fine after the first letter.'; nameIn.focus(); return; }
            // Names are unique across your slots (the database page finds characters by name).
            if (slots.some((x) => x && x.character.name.toLowerCase() === name.toLowerCase())) { err.textContent = `You already have a character called ${name}.`; nameIn.focus(); return; }
            if (!online) { finish({ type: 'new', name, appearance: Object.assign({}, app), slot }); return; }
            begin.disabled = true;
            G.Online.api('/api/characters', 'POST', { slot, name, appearance: app })
              .then((r) => finish({ type: 'new', name, appearance: Object.assign({}, app), slot, charId: r.id }))
              .catch((e) => { err.textContent = e.message; begin.disabled = false; });
          },
        }, h('span', { text: 'Begin your adventure' }));
        nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') begin.click(); e.stopPropagation(); });

        root.append(h('div.cc', null,
          h('div.cc-left', null, canvas, h('p.hint', { text: 'Drag to turn' })),
          h('div.cc-right', null,
            h('h2', { text: 'Create your Novice' }),
            h('label.cc-group', null, h('span.cc-label', { text: 'Name' }), nameIn),
            groups, err,
            h('div.cc-actions', null,
              slots.some(Boolean) ? h('button.btn.ghost', { type: 'button', onclick: () => { cancelAnimationFrame(raf); titleCard(); } }, 'Back') : null,
              begin))));
        setTimeout(() => nameIn.focus(), 50);
      }

      if (slots.some(Boolean)) titleCard(); else creation(0);
    });
  }

  G.Title = { show };
})(window.G = window.G || {});
