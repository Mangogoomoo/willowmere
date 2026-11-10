/* HUD: the minimal Stage 1 interface - status window (name, job, level, HP,
   EXP), target window, controls help, zone/level toasts and death notice.
   DOM writes only happen when a displayed value actually changes. */
(function (G) {
  'use strict';
  const $ = (id) => document.getElementById(id);

  class HUD {
    constructor(game) {
      this.game = game;
      this.el = {
        name: $('st-name'), job: $('st-job'), level: $('st-level'),
        hpFill: $('st-hp-fill'), hpText: $('st-hp-text'), hpBar: $('st-hp'),
        spFill: $('st-sp-fill'), spText: $('st-sp-text'),
        expFill: $('st-exp-fill'), expText: $('st-exp-text'),
        jexpFill: $('st-jexp-fill'), jexpText: $('st-jexp-text'),
        zeny: $('st-zeny'), weight: $('st-weight'),
        target: $('target'), tStatus: $('tg-status'), tName: $('tg-name'), tLevel: $('tg-level'), tFill: $('tg-hp-fill'), tText: $('tg-hp-text'),
        help: $('help'), helpBtn: $('help-close'), helpOpen: $('help-open'),
        toast: $('toast'), zone: $('zone'), death: $('death'),
      };
      this.cache = {};
      this.el.helpBtn.addEventListener('click', () => this.toggleHelp(false));
      window.addEventListener('resize', () => this.placeHelp());
      requestAnimationFrame(() => this.placeHelp());
      if (this.el.helpOpen) this.el.helpOpen.addEventListener('click', () => this.toggleHelp(true));
      this.toastTimer = null;
      this.zoneTimer = null;
      // Fold the controls away once the player has shown they know the basics.
      let kills = 0;
      game.events.on('monsterKilled', () => {
        if (++kills === 1 && !this.el.help.hidden) {
          this.toggleHelp(false);
          this.toast('Press H any time to see the controls again.');
        }
      });
    }

    set(key, value, fn) {
      if (this.cache[key] === value) return;
      this.cache[key] = value;
      fn(value);
    }

    toggleHelp(force) {
      const open = force == null ? this.el.help.hidden : force;
      this.el.help.hidden = !open;
      if (open) this.placeHelp();
      if (this.el.helpOpen) this.el.helpOpen.hidden = open;
      if (this.helpMenuBtn) this.helpMenuBtn.setAttribute('aria-pressed', String(open));
    }

    // The Controls panel sits just left of the bottom-right menu.
    placeHelp() {
      const m = document.getElementById('menubar'), hp = this.el.help;
      if (!m || hp.hidden) return;
      const r = m.getBoundingClientRect();
      Object.assign(hp.style, { left: 'auto', right: Math.round(window.innerWidth - r.left + 10) + 'px', bottom: Math.max(14, Math.round(window.innerHeight - r.bottom)) + 'px' });
    }

    toast(msg) {
      const t = this.el.toast;
      t.textContent = msg;
      t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
    }

    zone(name) {
      const z = this.el.zone;
      z.textContent = name;
      z.classList.remove('show'); void z.offsetWidth; z.classList.add('show');
      clearTimeout(this.zoneTimer);
      this.zoneTimer = setTimeout(() => z.classList.remove('show'), 2600);
    }

    showDeath(on) { this.el.death.hidden = !on; }

    update() {
      const p = this.game.player, e = this.el;
      this.set('name', p.name, (v) => { e.name.textContent = v; });
      this.set('job', p.job + p.jobLevel + ':' + p.baseLevel, () => { e.job.textContent = `${p.jobDef.name}, Base Level ${p.baseLevel}, Job Level ${p.jobLevel}`; });
      this.set('level', p.baseLevel, () => { e.level.textContent = ''; });
      this.set('hp', p.hp + '/' + p.maxHp, () => {
        const f = p.hp / p.maxHp;
        e.hpFill.style.transform = `scaleX(${f})`;
        e.hpText.textContent = `${p.hp} / ${p.maxHp}`;
        e.hpBar.classList.toggle('low', f < 0.3);
      });
      this.set('sp', p.sp + '/' + p.maxSp, () => {
        e.spFill.style.transform = `scaleX(${p.sp / p.maxSp})`;
        e.spText.textContent = `${p.sp} / ${p.maxSp}`;
      });
      const pct = (cur, need) => (need === Infinity ? 100 : (cur / need) * 100);
      const bp = pct(p.baseExp, p.expToNext), jp = pct(p.jobExp, p.jobExpToNext);
      this.set('exp', bp.toFixed(1), (v) => { e.expFill.style.transform = `scaleX(${bp / 100})`; e.expText.textContent = v + '%'; });
      this.set('jexp', jp.toFixed(1) + (p.jobExpToNext === Infinity), (v) => {
        e.jexpFill.style.transform = `scaleX(${jp / 100})`;
        e.jexpText.textContent = p.jobExpToNext === Infinity ? 'Mastered' : jp.toFixed(1) + '%';
      });
      this.set('zeny', p.zeny, (v) => { e.zeny.textContent = v.toLocaleString() + ' z'; });
      const wp = p.inventory.weightPct();
      this.set('weight', wp >= 0.9, (heavy) => { e.weight.hidden = !heavy; });

      const t = p.target;
      const show = !!(t && (t.alive || !t.corpseGone));
      this.set('tshow', show, (v) => { e.target.hidden = !v; });
      if (show) {
        this.renderTargetStatus(t);
        this.set('tname', t.id, () => {
          e.tName.textContent = t.name;
          const el = t.def.element || 'neutral';
          e.tLevel.textContent = `Lv ${t.level}, ${el[0].toUpperCase() + el.slice(1)}${t.def.boss ? ', boss' : ''}`;
        });
        this.set('thp', t.id + ':' + t.hp, () => {
          e.tFill.style.transform = `scaleX(${t.hp / t.def.hp})`;
          e.tText.textContent = t.alive ? `${t.hp} / ${t.def.hp}` : 'Defeated';
        });
      }
    }
  }

  // Effects on the target monster, drawn like the player's buff bar.
  const STATUS_ICON = { frozen: 'frost_diver', stunned: 'hammer_fall', poisoned: 'envenom', slowed: 'decrease_agi', rooted: 'ankle_snare', stone: 'stone_curse',
    asleep: 'sandman', blinded: 'flasher', signum: 'signum_crucis', disarmed: 'strip_weapon', strip_helm: 'strip_helm', strip_shield: 'strip_shield',
    strip_armor: 'strip_armor', lex: 'lex_aeterna', quagmire: 'quagmire' };
  const STATUS_NAME = { frozen: 'Frozen', stunned: 'Stunned', poisoned: 'Poisoned', slowed: 'Slowed', rooted: 'Snared', stone: 'Stone curse', asleep: 'Asleep',
    blinded: 'Blinded', signum: 'Signum Crucis', disarmed: 'Disarmed', strip_helm: 'Helm stripped', strip_shield: 'Shield stripped', strip_armor: 'Armour stripped',
    lex: 'Lex Aeterna', quagmire: 'Quagmire', provoked: 'Provoked' };
  HUD.prototype.renderTargetStatus = function (t) {
    const el = this.el.tStatus; if (!el) return;
    const st = Object.assign({}, t.status || {});
    if (t.provoke) st.provoked = { until: t.provoke.until || 0 };
    const key = t.id + ':' + Object.keys(st).sort().join(',');
    const now = this.game.time;
    if (key !== this.tsKey) {
      this.tsKey = key; el.textContent = '';
      for (const k in st) {
        const icon = G.Skills.get(STATUS_ICON[k] || 'provoke') ? G.Icons.skillUrl(STATUS_ICON[k] || 'provoke') : null;
        const b = G.h('div.buff', { 'data-st': k, title: STATUS_NAME[k] || k }, icon ? G.h('img', { src: icon, alt: '' }) : null, G.h('span'));
        el.append(b);
      }
    }
    el.querySelectorAll('[data-st]').forEach((n) => { const s2 = st[n.dataset.st]; n.lastChild.textContent = s2 && s2.until ? Math.max(0, Math.ceil(s2.until - now)) + 's' : ''; });
  };

  G.HUD = HUD;
})(window.G = window.G || {});
