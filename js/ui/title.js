/* Title screen and character creation. Resolves with
   { type: 'load', data } or { type: 'new', name, appearance }. */
(function (G) {
  'use strict';
  const h = G.h;
  const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 '\-]{1,15}$/;

  function show(save) {
    return new Promise((resolve) => {
      const root = document.getElementById('title');
      root.hidden = false;
      root.textContent = '';
      let raf = 0;
      const finish = (result) => { cancelAnimationFrame(raf); root.classList.add('done'); setTimeout(() => { root.hidden = true; root.classList.remove('done'); }, 600); resolve(result); };

      function titleCard() {
        root.textContent = '';
        const c = save.character, jobName = (G.Jobs.get(save.job) || { name: 'Novice' }).name;
        const when = new Date(save.savedAt || Date.now());
        root.append(h('div.title-card', null,
          h('h1', { text: 'Willowmere' }),
          h('button.btn.big', { type: 'button', autofocus: true, onclick: () => finish({ type: 'load', data: save }) },
            h('span', { text: `Continue as ${c.name}` }),
            h('small', { text: `${jobName}, base level ${save.baseLevel}, job level ${save.jobLevel}` })),
          h('p.saved', { text: `Last saved ${when.toLocaleString()}` }),
          h('button.btn.ghost', { type: 'button', onclick: () => creation() }, 'Create a new character')));
      }

      function creation() {
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
        let confirmT = 0;
        const begin = h('button.btn.big', {
          type: 'button',
          onclick: () => {
            const name = nameIn.value.trim().replace(/\s+/g, ' ');
            if (!NAME_RE.test(name)) { err.textContent = 'Use 2 to 16 letters or numbers. Spaces, apostrophes and hyphens are fine after the first letter.'; nameIn.focus(); return; }
            if (save && Date.now() - confirmT > 5000) {
              confirmT = Date.now();
              err.textContent = `This replaces ${save.character.name} for good. Click again to confirm.`;
              begin.firstChild.textContent = 'Replace and begin';
              return;
            }
            finish({ type: 'new', name, appearance: Object.assign({}, app) });
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
              save ? h('button.btn.ghost', { type: 'button', onclick: () => { cancelAnimationFrame(raf); titleCard(); } }, 'Back') : null,
              begin))));
        setTimeout(() => nameIn.focus(), 50);
      }

      if (save) titleCard(); else creation();
    });
  }

  G.Title = { show };
})(window.G = window.G || {});
