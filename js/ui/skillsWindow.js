/* Skill tree window (Alt+S). One tab per job the character can learn from;
   nodes are laid out on a small grid with lines to their prerequisites.
   Click + to learn, drag an active skill onto the hotbar, double-click to use. */
(function (G) {
  'use strict';
  const h = G.h;
  const CW = 124, CH = 96;

  function skillTooltip(s, player) {
    const sys = player.skills, lv = sys.level(s.id);
    const lines = [`<div class="tt-name" style="color:#ffe27a">${G.esc(s.name)}</div>`];
    lines.push(`<div class="tt-type">${s.type === 'passive' ? 'Passive' : s.target === 'self' ? 'Active, self' : 'Active, targets an enemy'}, ${G.Jobs.get(s.job).name}</div>`);
    const use = lv ? sys.useLevel(s.id) : 0;
    if (lv) lines.push(`<div class="tt-desc"><b>Level ${use}${use < lv ? ' (chosen, learned ' + lv + ')' : ''}:</b> ${G.esc(s.desc(use))}</div>`);
    if (lv < s.max) lines.push(`<div class="tt-desc tt-next"><b>${lv ? 'Next' : 'Level 1'}:</b> ${G.esc(s.desc(lv + 1))}</div>`);
    if (s.type !== 'passive') {
      const l = Math.max(1, use);
      const bits = [`SP ${s.sp(l)}`];
      if (s.hp) bits.push(`HP ${s.hp(l)}`);
      if (s.zeny) bits.push(`${s.zeny(l)} Zeny`);
      if (s.cast(l)) {
        const mine = sys.castTime(s, l);
        bits.push(`cast ${s.cast(l).toFixed(1)} s` + (mine < s.cast(l) - 0.05 ? ` (${mine.toFixed(1)} s with your DEX)` : ''));
      } else bits.push('instant');
      if (s.cd(l) >= 1) bits.push(`cooldown ${s.cd(l)} s`);
      lines.push(`<div class="tt-foot"><span>${bits.join(', ')}</span></div>`);
    }
    if (s.req.length) {
      lines.push(`<div class="tt-req">Requires ${s.req.map(([id, rl]) => `<span class="${sys.level(id) >= rl ? '' : 'bad'}">${G.esc(G.Skills.get(id).name)} ${rl}</span>`).join(', ')}</div>`);
    }
    if (s.granted) lines.push('<div class="tt-hint">Learned automatically.</div>');
    else if (s.type !== 'passive' && lv) lines.push('<div class="tt-hint">Drag to the hotbar, or double-click to use.</div>');
    return lines.join('');
  }

  function skillsWindow(game) {
    const W = game.windows;
    let tab = null, builtKey = null;
    const nodes = {};
    let refs = {};
    const win = W.create('skills', 'Skills', { width: 430, keyHint: 'Alt+S', pos: { x: 290, y: 120 } });

    function build() {
      const p = game.player, sys = p.skills, b = win.body;
      const jobs = sys.jobs();
      if (!tab || !jobs.includes(tab)) tab = jobs[jobs.length - 1];
      builtKey = jobs.join(',') + '|' + tab;
      b.textContent = '';
      for (const k in nodes) delete nodes[k];
      const tabs = h('div.tabs', { role: 'tablist' }, jobs.map((j) => h('button.tab' + (tab === j ? '.on' : ''), {
        type: 'button', role: 'tab', 'aria-selected': String(tab === j), onclick: () => { tab = j; build(); update(); },
      }, G.Jobs.get(j).name)));

      const skills = G.Skills.forJob(tab).filter((sk) => G.Skills.allowed(sk.id, p.job));
      const rows = Math.max(...skills.map((s) => s.pos[0])) + 1, cols = 3;
      const tree = h('div.stree');
      tree.style.width = cols * CW + 'px';
      tree.style.height = rows * CH + 'px';
      const svgNS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('width', cols * CW); svg.setAttribute('height', rows * CH);
      svg.classList.add('slinks');
      const links = [];
      for (const s of skills) for (const [rid, rl] of s.req) {
        const r = G.Skills.get(rid);
        if (r.job !== s.job) continue;
        const line = document.createElementNS(svgNS, 'line');
        line.setAttribute('x1', r.pos[1] * CW + CW / 2); line.setAttribute('y1', r.pos[0] * CH + 58);
        line.setAttribute('x2', s.pos[1] * CW + CW / 2); line.setAttribute('y2', s.pos[0] * CH + 8);
        svg.append(line);
        links.push({ line, rid, rl });
      }
      tree.append(svg);

      for (const s of skills) {
        const lvEl = h('span.sn-lv');
        const down = h('button.lvbtn', { type: 'button', 'aria-label': `Cast ${s.name} at a lower level`, title: 'Use a lower level',
          onclick: (e) => { e.stopPropagation(); sys.setUseLevel(s.id, sys.useLevel(s.id) - 1); } }, '‹');
        const up = h('button.lvbtn', { type: 'button', 'aria-label': `Cast ${s.name} at a higher level`, title: 'Use a higher level',
          onclick: (e) => { e.stopPropagation(); sys.setUseLevel(s.id, sys.useLevel(s.id) + 1); } }, '›');
        const useRow = h('span.sn-use', null, down, h('span.uselv'), up);
        const plus = s.granted ? null : h('button.plus', { type: 'button', 'aria-label': `Learn ${s.name}` }, '+');
        if (plus) G.holdRepeat(plus, () => { if (sys.canLearn(s.id).ok) sys.learn(s.id); });
        const node = h('div.snode' + (s.type === 'passive' ? '.passive' : ''), {
          ondragstart: (e) => { e.dataTransfer.setData('text/x-skill', s.id); G.Tooltip.hide(); },
          ondblclick: () => { if (s.type !== 'passive' && sys.level(s.id)) p.skills.use(s.id); },
        }, h('img', { src: G.Icons.skillUrl(s.id), alt: '' }), h('span.sn-name', { text: s.name }), lvEl,
        s.type !== 'passive' ? useRow : null, plus);
        node.style.left = s.pos[1] * CW + 'px';
        node.style.top = s.pos[0] * CH + 'px';
        G.Tooltip.bind(node, () => skillTooltip(s, p));
        tree.append(node);
        nodes[s.id] = { node, lvEl, plus, useRow, down, up };
      }
      refs = { links, points: h('b.points'), note: h('p.hint') };
      b.append(tabs, h('div.stree-wrap', null, tree),
        h('div.status-foot', null, h('span', null, 'Skill points ', refs.points)),
        refs.note);
    }

    function update() {
      const p = game.player, sys = p.skills;
      if (builtKey !== sys.jobs().join(',') + '|' + tab) build();
      for (const id in nodes) {
        const s = G.Skills.get(id), n = nodes[id], lv = sys.level(id);
        n.node.classList.toggle('learned', lv > 0);
        n.node.draggable = s.type !== 'passive' && lv > 0;
        n.lvEl.textContent = `${lv} / ${s.max}`;
        if (n.plus) n.plus.disabled = !sys.canLearn(id).ok;
        if (n.useRow) {
          const use = sys.useLevel(id);
          n.useRow.hidden = lv < 2;
          n.useRow.querySelector('.uselv').textContent = `Use ${use}`;
          n.down.disabled = use <= 1;
          n.up.disabled = use >= lv;
        }
      }
      for (const l of refs.links) l.line.setAttribute('class', sys.level(l.rid) >= l.rl ? 'met' : '');
      refs.points.textContent = String(p.skillPoints);
      refs.note.textContent = tab === 'novice' && p.job === 'novice'
        ? 'Reach Basic Training 9 and job level 10, then visit Master Rowan in the plaza to change jobs.'
        : 'Hold + to keep learning. ‹ › picks a lower level to cast (cheaper). Drag active skills onto the hotbar.';
    }

    win.render = () => { build(); update(); };
    const refresh = () => { if (W.isOpen('skills')) update(); };
    game.events.on('skillsChanged', refresh);
    game.events.on('statsChanged', refresh);
    game.events.on('levelChanged', refresh);
    // After a job change, open on the new job's tab.
    game.events.on('jobChanged', () => { tab = null; builtKey = null; if (W.isOpen('skills')) { build(); update(); } });
    return win;
  }

  G.Panels.skillsWindow = skillsWindow;
  G.skillTooltip = skillTooltip;
})(window.G = window.G || {});
