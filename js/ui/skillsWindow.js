/* Skill tree window (Alt+S). One tab per job the character can learn from;
   nodes are laid out on a small grid with lines to their prerequisites.
   Click + to learn, drag an active skill onto the hotbar, double-click to use. */
(function (G) {
  'use strict';
  const h = G.h;
  const CW = 118, CH = 92;

  // atLevel: an action bar slot's level; onBar: hovering it on the action bar (no learning details there).
  function skillTooltip(s, player, atLevel, onBar) {
    const sys = player.skills, lv = sys.level(s.id);
    const lines = [`<div class="tt-name" style="color:#ffe27a">${G.esc(s.name)}</div>`];
    lines.push(`<div class="tt-type">${s.type === 'passive' ? 'Passive' : s.target === 'self' ? 'Active, self' : s.target === 'ally' ? 'Active, targets a character' : 'Active, targets an enemy'}, ${G.Jobs.get(s.job).name}${s.quest ? ', quest skill' : ''}</div>`);
    if (s.req.length && !onBar) lines.push(`<div class="tt-req">Requires: ${s.req.map(([rid, rl]) => { const ok = sys.level(rid) >= rl; return `<span class="${ok ? '' : 'bad'}">${G.esc(G.Skills.get(rid).name)} ${rl}</span>`; }).join(', ')}</div>`);
    if (s.quest) lines.push(`<div class="tt-req">Quest skill: costs no skill points, opens at job level ${s.questJob || 15}.</div>`);
    if (s.catalyst && s.catalyst.length) lines.push(`<div class="tt-req">Uses: ${s.catalyst.map(([id, n]) => `${n} ${G.esc(G.Items.get(id).name)}`).join(', ')}</div>`);
    const use = lv ? (atLevel ? Math.min(lv, atLevel) : sys.useLevel(s.id)) : 0;
    if (lv) lines.push(`<div class="tt-desc"><b>Level ${use}${use < lv ? ' (chosen, learned ' + lv + ')' : ''}:</b> ${G.esc(s.desc(use))}</div>`);
    if (lv < s.max) lines.push(`<div class="tt-desc tt-next"><b>${lv ? 'Next' : 'Level 1'}:</b> ${G.esc(s.desc(lv + 1))}</div>`);
    if (s.type !== 'passive') {
      const l = Math.max(1, use);
      const bits = [`SP ${s.sp(l)}`];
      if (s.hp) bits.push(`HP ${s.hp(l)}`);
      if (s.zeny) bits.push(`${player.skills.zenyCost(s, l)} Zeny`);
      if (s.cast(l)) {
        const mine = sys.castTime(s, l);
        bits.push(`cast ${s.cast(l).toFixed(1)} s` + (mine < s.cast(l) - 0.05 ? ` (${mine.toFixed(1)} s with your DEX)` : ''));
      } else bits.push('instant');
      if (s.cd(l) >= 1) bits.push(`cooldown ${s.cd(l)} s`);
      lines.push(`<div class="tt-foot"><span>${bits.join(', ')}</span></div>`);
    }
    if (onBar) return lines.join('');
    if (s.granted) lines.push('<div class="tt-hint">Learned automatically.</div>');
    else if (s.type !== 'passive' && lv) lines.push('<div class="tt-hint">Drag to the hotbar, or double-click to use.</div>');
    return lines.join('');
  }

  function skillsWindow(game) {
    const W = game.windows;
    let tab = null, builtKey = null;
    const plan = [];   // pending skill levels, applied by Confirm
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
      const rows = Math.max(...skills.map((s) => s.pos[0])) + 1, cols = Math.max(3, Math.max(...skills.map((s) => s.pos[1])) + 1);
      win.el.style.width = Math.min(window.innerWidth - 40, cols * CW + 44) + 'px';
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
        // + plans a level (prerequisites are planned for you); nothing changes until Confirm.
        if (plus) G.holdRepeat(plus, () => {
          const r = sys.planAdd(s.id, plan);
          if (!r.ok) { refs.note.textContent = r.reason; refs.note.classList.add('warnhint'); }
          update();
        });
        const node = h('div.snode' + (s.type === 'passive' ? '.passive' : '') + (s.quest ? '.quest' : ''), {
          ondragstart: (e) => { e.dataTransfer.setData('text/x-skill', s.id); e.dataTransfer.setData('text/x-skill-lv', String(sys.useLevel(s.id))); G.Tooltip.hide(); },
          ondblclick: () => { if (s.type !== 'passive' && sys.level(s.id)) p.skills.use(s.id); },
        }, h('img', { src: G.Icons.skillUrl(s.id), alt: '' }), h('span.sn-name', { text: s.name }), lvEl,
        s.type !== 'passive' ? useRow : null, plus);
        node.style.left = s.pos[1] * CW + 'px';
        node.style.top = s.pos[0] * CH + 'px';
        G.Tooltip.bind(node, () => skillTooltip(s, p));
        tree.append(node);
        nodes[s.id] = { node, lvEl, plus, useRow, down, up };
      }
      refs = { links, points: h('b.points'), pointsLabel: h('span'), note: h('p.hint') };
      refs.confirm = h('button.btn.small', { type: 'button', onclick: () => {
        const n = sys.commit(plan); plan.length = 0;
        if (n) { game.sfx('buff'); game.log.add(`Learned ${n} skill level${n === 1 ? '' : 's'}.`, 'level'); }
        update();
      } }, 'Confirm');
      refs.clear = h('button.btn.small.ghost', { type: 'button', onclick: () => { plan.length = 0; update(); } }, 'Clear');
      b.append(tabs, h('div.stree-wrap', null, tree),
        h('div.status-foot.skill-foot', null, h('span', null, refs.pointsLabel, ' ', refs.points), h('span.skill-btns', null, refs.clear, refs.confirm)),
        refs.note);
    }

    function update() {
      const p = game.player, sys = p.skills;
      if (builtKey !== sys.jobs().join(',') + '|' + tab) build();
      for (const id in nodes) {
        const s = G.Skills.get(id), n = nodes[id], lv = sys.level(id);
        n.node.classList.toggle('learned', lv > 0);
        n.node.draggable = s.type !== 'passive' && lv > 0;
        const pend = sys.planned(id, plan);
        n.lvEl.textContent = pend ? `${lv} (+${pend}) / ${s.max}` : `${lv} / ${s.max}`;
        n.node.classList.toggle('pending', pend > 0);
        if (n.plus) n.plus.disabled = !sys.planAdd(id, plan.slice()).ok;
        if (n.useRow) {
          const use = sys.useLevel(id);
          n.useRow.hidden = lv < 2;
          n.useRow.querySelector('.uselv').textContent = `Use ${use}`;
          n.down.disabled = use <= 1;
          n.up.disabled = use >= lv;
        }
      }
      for (const l of refs.links) l.line.setAttribute('class', sys.level(l.rid) + sys.planned(l.rid, plan) >= l.rl ? 'met' : '');
      // Each job has its own pool of points.
      const pools = p.pools(plan), chainAll = sys.jobs(), ti = chainAll.indexOf(tab);
      const later = tab === 'novice' ? [] : chainAll.slice(ti + 1).filter((j) => pools[j] > 0);
      refs.pointsLabel.textContent = `${G.Jobs.get(tab).name} skill points`;
      refs.points.textContent = String(Math.max(0, pools[tab] || 0)) + later.map((j) => ` + ${pools[j]} ${G.Jobs.get(j).name}`).join('');
      refs.confirm.disabled = !plan.length;
      refs.clear.disabled = !plan.length;
      refs.confirm.textContent = plan.length ? `Confirm (${plan.length})` : 'Confirm';
      const chain = sys.jobs(), earlier = chain.slice(0, chain.indexOf(tab)).filter((j) => j !== 'novice' || p.job === 'novice')
        .map((j) => [j, pools[j]]).find(([, n]) => n > 0);
      refs.note.classList.toggle('warnhint', !!earlier);
      refs.note.textContent = earlier ? `Spend your ${earlier[1]} ${G.Jobs.get(earlier[0]).name} skill point${earlier[1] === 1 ? '' : 's'} before learning ${G.Jobs.get(tab).name} skills.`
        : tab === 'novice' && p.job === 'novice' ? 'Reach Basic Training 9 and job level 10, then visit Master Rowan in the plaza to change jobs.'
        : 'Click + to plan points (missing prerequisites are added for you), then press Confirm. ‹ › picks a lower level to cast. Drag active skills onto the hotbar.';
    }

    win.render = () => { build(); update(); };
    const refresh = () => { if (W.isOpen('skills')) update(); };
    game.events.on('skillsChanged', refresh);
    game.events.on('statsChanged', refresh);
    game.events.on('levelChanged', refresh);
    // After a job change, open on the new job's tab.
    game.events.on('jobChanged', () => { plan.length = 0; tab = null; builtKey = null; if (W.isOpen('skills')) { build(); update(); } });
    return win;
  }

  G.Panels.skillsWindow = skillsWindow;
  G.skillTooltip = skillTooltip;
})(window.G = window.G || {});
