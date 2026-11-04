/* Title screen, 15 character slots and character creation.
   Resolves with { type:'load', data, slot } or
   { type:'new', name, appearance, slot }. */
(function (G) {
  'use strict';
  const h = G.h;
  const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 '\-]{1,15}$/;

  function addSlotStyles() {
    if (document.getElementById('willowmere-slot-styles')) return;
    const style = document.createElement('style');
    style.id = 'willowmere-slot-styles';
    style.textContent = `
      .slot-screen { width:min(980px,94vw); max-height:90vh; overflow:auto; padding:22px;
        border-radius:16px; background:var(--panel-bg); border:1px solid var(--panel-edge);
        box-shadow:var(--shadow); backdrop-filter:blur(8px); color:var(--ink); }
      .slot-screen h1 { margin:0 0 4px; text-align:center; color:#fff;
        font-size:clamp(38px,6vw,66px); -webkit-text-stroke:2px #2f5fa8;
        paint-order:stroke fill; text-shadow:0 4px 0 #2f5fa8; }
      .slot-subtitle { margin:0 0 16px; text-align:center; color:var(--ink-soft); }
      .slot-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; }
      .slot-card { min-width:0; padding:12px; border-radius:11px; border:1px solid var(--cell-edge);
        background:var(--cell-bg); display:grid; gap:7px; align-content:start; }
      .slot-card.empty { background:var(--kbd-bg); }
      .slot-heading { display:flex; justify-content:space-between; align-items:center; gap:6px; }
      .slot-heading strong { font-size:13px; }
      .slot-state { font-size:11px; color:var(--ink-soft); }
      .slot-name { font-weight:700; overflow-wrap:anywhere; }
      .slot-meta,.slot-date { font-size:11px; color:var(--ink-soft); }
      .slot-actions { display:flex; gap:6px; flex-wrap:wrap; }
      .slot-actions .btn { min-width:0; padding:6px 10px; font-size:12px; }
      .slot-actions .btn.big { min-width:0; }
      .slot-delete { color:#b33; }
      .slot-footer { display:flex; justify-content:center; margin-top:14px; }
      .slot-footer .btn { min-width:150px; }
      .slot-screen .slot-error { color:#c33; text-align:center; min-height:1.2em; }
      @media(max-width:700px) {
        .slot-screen { padding:14px; }
        .slot-grid { grid-template-columns:repeat(2,minmax(0,1fr)); gap:7px; }
        .slot-card { padding:9px; }
      }
      @media(max-width:430px) {
        .slot-grid { grid-template-columns:1fr; }
        .slot-screen { max-height:94vh; }
      }
    `;
    document.head.appendChild(style);
  }

  function show(slotState) {
    return new Promise((resolve) => {
      addSlotStyles();
      const root = document.getElementById('title');
      root.hidden = false;
      root.textContent = '';
      let raf = 0;
      let slots = slotState && Array.isArray(slotState.slots)
        ? slotState.slots : G.SaveSystem.slots();
      const finish = (result) => {
        cancelAnimationFrame(raf);
        if (result && result.slot) G.SaveSystem.setActiveSlot(result.slot);
        root.classList.add('done');
        setTimeout(() => {
          root.hidden = true;
          root.classList.remove('done');
        }, 600);
        resolve(result);
      };

      function renderSlots() {
        root.textContent = '';
        slots = G.SaveSystem.slots();
        const grid = h('div.slot-grid');
        const error = h('p.slot-error', { role: 'alert' });
        slots.forEach(({ slot, data }) => {
          const card = h('div.slot-card' + (data ? '' : '.empty'));
          const heading = h('div.slot-heading', null,
            h('strong', { text: `Character slot ${slot}` }),
            h('span.slot-state', { text: data ? 'Occupied' : 'Empty' }));
          card.append(heading);
          if (data) {
            const character = data.character || {};
            const jobName = (G.Jobs.get(data.job) || { name: 'Novice' }).name;
            const when = new Date(data.savedAt || Date.now());
            card.append(
              h('div.slot-name', { text: character.name || 'Unnamed character' }),
              h('div.slot-meta', { text: `${jobName} · Base ${data.baseLevel || 1} · Job ${data.jobLevel || 1}` }),
              h('div.slot-date', { text: `Saved ${when.toLocaleString()}` })
            );
            const actions = h('div.slot-actions');
            actions.append(
              h('button.btn.big', {
                type: 'button',
                onclick: () => finish({ type: 'load', data, slot })
              }, 'Play')
            );
            actions.append(
              h('button.btn.ghost.slot-delete', {
                type: 'button',
                onclick: () => {
                  if (!window.confirm(`Delete ${character.name || 'this character'} from slot ${slot}? This cannot be undone.`)) return;
                  G.SaveSystem.deleteSlot(slot);
                  renderSlots();
                }
              }, 'Delete')
            );
            card.append(actions);
          } else {
            card.append(
              h('div.slot-meta', { text: 'No character saved in this slot.' }),
              h('div.slot-actions', null,
                h('button.btn.big', {
                  type: 'button',
                  onclick: () => creation(slot)
                }, 'Create character'))
            );
          }
          grid.append(card);
        });

        root.append(h('div.slot-screen', null,
          h('h1', { text: 'Willowmere' }),
          h('p.slot-subtitle', { text: 'Choose a character or create a new one. Your 15 characters are saved separately.' }),
          grid,
          error,
          h('div.slot-footer', null,
            h('button.btn.ghost', {
              type: 'button',
              onclick: () => {
                const first = slots.find((s) => s.data);
                if (first) finish({ type: 'load', data: first.data, slot: first.slot });
                else error.textContent = 'Create a character in an empty slot to begin.';
              }
            }, 'Quick play first character')
          )
        ));
      }

      function creation(slot) {
        root.textContent = '';
        const AP = G.SpriteFactory.APPEARANCE;
        const app = { hair: 'chestnut', outfit: 'sky', eyes: 'blue', style: 'ponytail' };
        let draw = G.SpriteFactory.noviceDraw(app);
        const painter = new G.RigPainter(2.55, 0.32);
        const canvas = h('canvas.preview', {
          width: '300', height: '330', 'aria-label': 'Character preview'
        });
        const ctx = canvas.getContext('2d');
        let theta = 0.3, spin = true, last = performance.now(), t = 0, drag = null;
        canvas.addEventListener('pointerdown', (e) => {
          drag = e.clientX; spin = false; canvas.setPointerCapture(e.pointerId);
        });
        canvas.addEventListener('pointermove', (e) => {
          if (drag != null) { theta -= (e.clientX - drag) * 0.02; drag = e.clientX; }
        });
        canvas.addEventListener('pointerup', () => { drag = null; });
        canvas.addEventListener('pointercancel', () => { drag = null; });
        const loop = (now) => {
          const dt = Math.min(0.05, (now - last) / 1000);
          last = now;
          t = (t + dt * 0.9) % 1;
          if (spin) theta += dt * 0.6;
          ctx.clearRect(0, 0, 300, 330);
          ctx.fillStyle = 'rgba(40,70,40,0.25)';
          ctx.beginPath();
          ctx.ellipse(150, 312, 80, 17, 0, 0, Math.PI * 2);
          ctx.fill();
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
            list.forEach((o) => row.append(h(
              'button' + (isColor ? '.sw' : '.chip') + (app[key] === o.id ? '.on' : ''),
              {
                type: 'button', role: 'radio',
                'aria-checked': String(app[key] === o.id),
                'aria-label': o.name, title: o.name,
                style: isColor ? `--c:${o.color}` : null,
                onclick: () => {
                  app[key] = o.id;
                  draw = G.SpriteFactory.noviceDraw(app);
                  renderRow();
                }
              },
              isColor ? null : o.name
            )));
          };
          renderRow();
          groups.append(h('div.cc-group', null,
            h('span.cc-label', { text: label }), row));
        };

        swatchGroup('Hair colour', 'hair', AP.hair, true);
        swatchGroup('Hairstyle', 'style', AP.style, false);
        swatchGroup('Outfit', 'outfit', AP.outfit, true);
        swatchGroup('Eyes', 'eyes', AP.eyes, true);

        const nameIn = h('input#cc-name', {
          type: 'text', maxlength: '16', placeholder: 'Your name',
          autocomplete: 'off', spellcheck: 'false'
        });
        const err = h('p.cc-err', { role: 'alert' });
        const begin = h('button.btn.big', {
          type: 'button',
          onclick: () => {
            const name = nameIn.value.trim().replace(/\s+/g, ' ');
            if (!NAME_RE.test(name)) {
              err.textContent = 'Use 2 to 16 letters or numbers. Spaces, apostrophes and hyphens are fine after the first letter.';
              nameIn.focus();
              return;
            }
            if (G.SaveSystem.slots().some((s) => s.slot === slot && s.data)) {
              err.textContent = 'This slot is no longer empty. Go back and choose another slot.';
              return;
            }
            finish({ type: 'new', name, appearance: Object.assign({}, app), slot });
          }
        }, h('span', { text: 'Begin your adventure' }));

        nameIn.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') begin.click();
          e.stopPropagation();
        });

        root.append(h('div.cc', null,
          h('div.cc-left', null, canvas, h('p.hint', { text: 'Drag to turn' })),
          h('div.cc-right', null,
            h('h2', { text: `Create character · Slot ${slot}` }),
            h('label.cc-group', null, h('span.cc-label', { text: 'Name' }), nameIn),
            groups, err,
            h('div.cc-actions', null,
              h('button.btn.ghost', {
                type: 'button',
                onclick: () => { cancelAnimationFrame(raf); renderSlots(); }
              }, 'Back'),
              begin)
          )
        ));
        setTimeout(() => nameIn.focus(), 50);
      }

      renderSlots();
    });
  }

  G.Title = { show };
})(window.G = window.G || {});
