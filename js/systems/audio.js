/* Audio: every sound is synthesised with the Web Audio API, so the game needs
   no audio files. Sound effects are short synth "recipes"; music is a small
   generative sequencer with one theme per area, crossfading as you travel.
   Audio starts on the first click (browsers require a user gesture). */
(function (G) {
  'use strict';

  const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);   // MIDI note -> Hz

  /* Themes: tempo, scale (MIDI notes), chord roots, instrument choices. */
  const THEMES = {
    town:    { bpm: 100, root: 60, scale: [0, 2, 4, 7, 9, 12, 14, 16], chords: [0, 7, 9, 5], lead: 'triangle', bass: 'sine', pad: 0.05, density: 0.7, echo: 0.18 },
    meadow:  { bpm: 92, root: 62, scale: [0, 2, 4, 7, 9, 12, 14, 16], chords: [0, 5, 7, 5], lead: 'triangle', bass: 'sine', pad: 0.045, density: 0.55, echo: 0.22 },
    forest:  { bpm: 78, root: 57, scale: [0, 2, 3, 5, 7, 9, 10, 12, 14], chords: [0, 3, 5, 3], lead: 'sine', bass: 'triangle', pad: 0.05, density: 0.42, echo: 0.32, vibrato: true },
    dungeon: { bpm: 60, root: 45, scale: [0, 2, 3, 7, 8, 12, 14, 15], chords: [0, 0, 8, 7], lead: 'sine', bass: 'sawtooth', pad: 0.06, density: 0.3, echo: 0.45, bell: true },
  };

  // Bard and Dancer songs: tempo, instrument and a short looping tune each.
  const SONGS = {
    poem_of_bragi: { bpm: 84, inst: 'triangle', root: 60, notes: [0, null, 4, 7, 12, null, 7, 4, 5, null, 9, 12, 7, null, 4, 2], bass: [0, 5, 7, 0] },
    assassin_cross: { bpm: 132, inst: 'square', root: 57, vol: 0.05, notes: [0, 3, 7, 3, 0, 3, 8, 7, 0, 3, 7, 10, 12, 10, 7, 3], bass: [0, 0, -2, -4] },
    whistle: { bpm: 112, inst: 'sine', root: 72, vol: 0.08, notes: [0, 2, 4, null, 7, null, 4, 2, 0, null, 2, 4, 2, null, 0, null] },
    apple_of_idun: { bpm: 92, inst: 'triangle', root: 64, notes: [0, 4, 7, 11, 12, null, 11, 7, 9, null, 7, 4, 5, null, 4, null], bass: [0, 5, 0, 7] },
    humming: { bpm: 76, inst: 'sine', root: 60, vol: 0.1, len: 2.4, notes: [0, null, 2, null, 4, null, 2, null, 0, null, -3, null, 0, null, null, null] },
    service_for_you: { bpm: 120, inst: 'triangle', root: 67, notes: [0, 4, 7, 4, 9, 7, 4, 0, 2, 5, 9, 5, 7, null, 4, null], bass: [0, 2, 5, 7] },
    fortunes_kiss: { bpm: 104, inst: 'sine', root: 69, vol: 0.09, notes: [0, 7, 12, 7, 0, 5, 9, 5, 0, 4, 7, 12, 11, null, 7, null], bass: [0, -3, -7, -5] },
    dont_forget_me: { bpm: 70, inst: 'sawtooth', root: 55, vol: 0.035, len: 2.2, notes: [0, null, 1, null, 3, null, 1, null, 0, null, -2, null, -4, null, null, null], bass: [0, -2] },
    mr_kim: { bpm: 126, inst: 'square', root: 64, vol: 0.045, notes: [0, 0, 7, 7, 9, 9, 7, null, 5, 5, 4, 4, 2, 2, 0, null] },
    drum_battlefield: { bpm: 140, inst: 'square', root: 52, vol: 0.05, notes: [0, null, 0, 0, 7, null, 0, null, 0, null, 0, 0, 5, null, 7, null], bass: [0, 0, 5, 7] },
    _: { bpm: 100, inst: 'triangle', root: 62, notes: [0, 4, 7, 4, 2, 5, 9, 5, 0, 4, 7, 12, 7, null, 4, null], bass: [0, 5] },
  };
  class Audio {
    constructor() {
      const p = G.SaveSystem.prefs().audio || {};
      this.settings = Object.assign({ master: 0.8, music: 0.45, sfx: 0.8, muted: false }, p);
      this.ctx = null;
      this.last = {};
      this.theme = null;
      this.tracks = {};
    }

    unlock() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = this.ctx = new AC();
      this.master = ctx.createGain();
      this.sfxBus = ctx.createGain();
      this.musicBus = ctx.createGain();
      // Gentle compression keeps busy fights from clipping.
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 4;
      this.sfxBus.connect(this.master); this.musicBus.connect(this.master);
      this.master.connect(comp); comp.connect(ctx.destination);
      // Shared echo for music.
      this.echo = ctx.createDelay(1.5); this.echo.delayTime.value = 0.36;
      this.echoGain = ctx.createGain(); this.echoGain.gain.value = 0.25;
      this.echo.connect(this.echoGain); this.echoGain.connect(this.echo); this.echoGain.connect(this.musicBus);
      // White noise buffer for percussive sounds.
      const len = ctx.sampleRate;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.applyVolumes();
      this.timer = setInterval(() => this.schedule(), 90);
      if (this.pendingTheme) this.setTheme(this.pendingTheme);
    }

    applyVolumes() {
      if (!this.ctx) return;
      const s = this.settings, t = this.ctx.currentTime;
      this.master.gain.setTargetAtTime(s.muted ? 0 : s.master, t, 0.05);
      this.sfxBus.gain.setTargetAtTime(s.sfx, t, 0.05);
      this.musicBus.gain.setTargetAtTime(s.music, t, 0.05);
    }
    saveSettings() { this.applyVolumes(); G.SaveSystem.setPrefs({ audio: this.settings }); }

    /* ---------------- building blocks ---------------- */
    tone(freq, dur, opts) {
      opts = opts || {};
      const ctx = this.ctx, t = (opts.at || ctx.currentTime) + (opts.delay || 0);
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = opts.type || 'sine';
      osc.frequency.setValueAtTime(freq, t);
      if (opts.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t + dur);
      const vol = (opts.vol == null ? 0.3 : opts.vol);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + (opts.attack || 0.005));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g); g.connect(opts.out || this.sfxBus);
      osc.start(t); osc.stop(t + dur + 0.05);
      return { osc, g };
    }
    burst(dur, opts) {
      opts = opts || {};
      const ctx = this.ctx, t = ctx.currentTime + (opts.delay || 0);
      const src = ctx.createBufferSource(); src.buffer = this.noise;
      const f = ctx.createBiquadFilter(); f.type = opts.filter || 'lowpass';
      f.frequency.setValueAtTime(opts.freq || 1200, t);
      if (opts.to) f.frequency.exponentialRampToValueAtTime(opts.to, t + dur);
      f.Q.value = opts.q || 1;
      const g = ctx.createGain();
      g.gain.setValueAtTime(opts.vol == null ? 0.3 : opts.vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(opts.out || this.sfxBus);
      src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
    }

    /* ---------------- sound effects ---------------- */
    play(name, opts) {
      if (!this.ctx || this.settings.muted) return;
      const now = this.ctx.currentTime;
      if (this.last[name] && now - this.last[name] < 0.035) return;   // no machine-gunning
      this.last[name] = now;
      opts = opts || {};
      let k = 1;
      if (opts.at && this.listener) {
        const d = Math.hypot(opts.at.x - this.listener.x, opts.at.z - this.listener.z);
        k = Math.max(0, 1 - d / 34);
        if (k <= 0.02) return;
      }
      const v = (x) => x * k;
      const R = Math.random;
      switch (name) {
        case 'swing': this.burst(0.12, { filter: 'bandpass', freq: 900, to: 2600, q: 1.4, vol: v(0.16) }); break;
        case 'hit': this.tone(150, 0.12, { to: 60, type: 'sine', vol: v(0.45) }); this.burst(0.06, { freq: 2400, vol: v(0.22) }); break;
        case 'crit': this.tone(170, 0.16, { to: 50, vol: v(0.5) }); this.burst(0.08, { freq: 3500, vol: v(0.3) }); this.tone(1320, 0.18, { type: 'triangle', vol: v(0.12), delay: 0.02 }); break;
        case 'miss': this.burst(0.14, { filter: 'highpass', freq: 1800, to: 4000, vol: v(0.08) }); break;
        case 'hurt': this.tone(110, 0.18, { to: 55, type: 'triangle', vol: v(0.45) }); this.burst(0.1, { freq: 700, vol: v(0.25) }); break;
        case 'pop': this.tone(520 + R() * 80, 0.16, { to: 120, vol: v(0.3) }); this.burst(0.12, { freq: 900, to: 300, vol: v(0.18) }); break;
        case 'pickup': this.tone(880, 0.07, { type: 'triangle', vol: 0.16 }); this.tone(1320, 0.1, { type: 'triangle', vol: 0.14, delay: 0.06 }); break;
        case 'zeny': this.tone(1760, 0.12, { type: 'sine', vol: 0.12 }); this.tone(2640, 0.16, { type: 'sine', vol: 0.09, delay: 0.05 }); break;
        case 'card': [0, 4, 7, 12, 16].forEach((n, i) => this.tone(NOTE(76 + n), 0.5, { type: 'triangle', vol: 0.12, delay: i * 0.07 })); this.tone(NOTE(100), 0.9, { vol: 0.06, delay: 0.35 }); break;
        case 'levelup': [0, 4, 7, 12].forEach((n, i) => this.tone(NOTE(72 + n), 0.45, { type: 'square', vol: 0.07, delay: i * 0.09 })); [0, 4, 7, 12].forEach((n, i) => this.tone(NOTE(84 + n), 0.6, { type: 'triangle', vol: 0.08, delay: 0.36 + i * 0.05 })); break;
        case 'quest': [0, 7, 12, 16, 19].forEach((n, i) => this.tone(NOTE(67 + n), 0.4, { type: 'triangle', vol: 0.12, delay: i * 0.1 })); break;
        case 'cast': this.tone(440, 0.5, { to: 880, type: 'sine', vol: 0.06, attack: 0.08 }); this.burst(0.4, { filter: 'bandpass', freq: 3000, q: 4, vol: 0.04 }); break;
        case 'fire': this.burst(0.35, { freq: 1400, to: 200, vol: v(0.35) }); this.tone(90, 0.3, { to: 40, vol: v(0.3) }); break;
        case 'ice': this.tone(1800, 0.25, { to: 2400, type: 'triangle', vol: v(0.12) }); this.tone(2700, 0.3, { type: 'sine', vol: v(0.08), delay: 0.03 }); this.burst(0.1, { filter: 'highpass', freq: 5000, vol: v(0.15) }); break;
        case 'zap': this.tone(1600, 0.18, { to: 120, type: 'sawtooth', vol: v(0.12) }); this.burst(0.2, { filter: 'highpass', freq: 2500, vol: v(0.25) }); break;
        case 'holy': [0, 7, 12].forEach((n, i) => this.tone(NOTE(84 + n), 0.5, { type: 'sine', vol: v(0.1), delay: i * 0.04 })); break;
        case 'heal': [0, 4, 7].forEach((n, i) => this.tone(NOTE(79 + n), 0.45, { type: 'sine', vol: 0.12, delay: i * 0.06 })); break;
        case 'buff': this.tone(NOTE(72), 0.5, { to: NOTE(84), type: 'triangle', vol: 0.12 }); this.tone(NOTE(88), 0.5, { type: 'sine', vol: 0.06, delay: 0.15 }); break;
        case 'slam': this.tone(70, 0.6, { to: 30, type: 'sine', vol: v(0.7) }); this.burst(0.5, { freq: 500, to: 80, vol: v(0.5) }); break;
        case 'warn': this.tone(330, 0.3, { to: 300, type: 'square', vol: v(0.06) }); this.tone(330, 0.3, { type: 'square', vol: v(0.06), delay: 0.35 }); break;
        case 'portal': this.tone(220, 0.7, { to: 880, type: 'sine', vol: 0.15, attack: 0.1 }); this.burst(0.7, { filter: 'bandpass', freq: 400, to: 3000, q: 2, vol: 0.12 }); break;
        case 'click': this.tone(1200, 0.04, { type: 'square', vol: 0.04 }); break;
        case 'talk': this.tone(660, 0.06, { type: 'triangle', vol: 0.06 }); this.tone(880, 0.06, { type: 'triangle', vol: 0.05, delay: 0.05 }); break;
        case 'faint': [7, 4, 0, -5].forEach((n, i) => this.tone(NOTE(64 + n), 0.5, { type: 'triangle', vol: 0.1, delay: i * 0.18 })); break;
      }
    }

    /* ---------------- music ---------------- */
    setTheme(name) {
      if (!this.ctx) { this.pendingTheme = name; return; }
      if (name === this.theme) return;
      const t = this.ctx.currentTime;
      if (this.theme && this.tracks[this.theme]) this.tracks[this.theme].gain.gain.setTargetAtTime(0, t, 0.8);
      this.theme = name;
      if (!this.tracks[name]) {
        const g = this.ctx.createGain(); g.gain.value = 0; g.connect(this.musicBus);
        const send = this.ctx.createGain(); send.gain.value = THEMES[name].echo; g.connect(send); send.connect(this.echo);
        this.tracks[name] = { gain: g, next: t + 0.1, step: 0, rng: G.Utils.mulberry32(name.length * 977), melody: null };
      }
      const tr = this.tracks[name];
      tr.next = Math.max(tr.next, t + 0.1);
      tr.gain.gain.setTargetAtTime(1, t, 1.2);
    }

    /* ---------------- Bard and Dancer songs ----------------
       While you perform, a short melody loops on its own instrument and the map's music
       steps back. One tune per song (notes are semitones above the root; null is a rest). */
    playSong(id) {
      const key = String(id).replace(/^dc_/, ''), tune = SONGS[key] || SONGS._;
      if (this.songId === id) return;
      this.songId = id;
      if (!this.ctx) return;
      if (!this.songBus) { this.songBus = this.ctx.createGain(); this.songBus.connect(this.musicBus); const send = this.ctx.createGain(); send.gain.value = 0.3; this.songBus.connect(send); send.connect(this.echo); }
      this.song = { tune, next: this.ctx.currentTime + 0.05, step: 0 };
      this.songBus.gain.setTargetAtTime(1.6, this.ctx.currentTime, 0.2);
      if (this.theme && this.tracks[this.theme]) this.tracks[this.theme].gain.gain.setTargetAtTime(0.3, this.ctx.currentTime, 0.4);
    }
    stopSong() {
      if (!this.songId) return;
      this.songId = null; this.song = null;
      if (!this.ctx) return;
      if (this.songBus) this.songBus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
      if (this.theme && this.tracks[this.theme]) this.tracks[this.theme].gain.gain.setTargetAtTime(1, this.ctx.currentTime, 0.8);
    }
    scheduleSong() {
      const sg = this.song, ctx = this.ctx;
      if (!sg) return;
      const tn = sg.tune, beat = 60 / tn.bpm / 2;
      while (sg.next < ctx.currentTime + 0.35) {
        const n = tn.notes[sg.step % tn.notes.length];
        if (n != null) this.tone(NOTE(tn.root + n), beat * (tn.len || 1.6), { type: tn.inst, vol: tn.vol || 0.09, attack: tn.attack || 0.01, at: sg.next, out: this.songBus });
        if (tn.bass && sg.step % 8 === 0) this.tone(NOTE(tn.root - 12 + tn.bass[(sg.step / 8) % tn.bass.length | 0]), beat * 7, { type: 'triangle', vol: 0.07, attack: 0.05, at: sg.next, out: this.songBus });
        sg.next += beat; sg.step++;
      }
    }

    // Look-ahead scheduler: queue notes slightly ahead of the audio clock.
    schedule() {
      if (this.ctx && this.song) this.scheduleSong();
      if (!this.ctx || !this.theme) return;
      const tr = this.tracks[this.theme], th = THEMES[this.theme], ctx = this.ctx;
      const beat = 60 / th.bpm / 2;          // eighth notes
      if (!tr.melody) {
        // A fixed 64-step melody per theme, generated once so it repeats musically.
        tr.melody = [];
        let idx = 3;
        for (let i = 0; i < 64; i++) {
          if (tr.rng() > th.density) { tr.melody.push(null); continue; }
          idx = Math.max(0, Math.min(th.scale.length - 1, idx + Math.round((tr.rng() - 0.5) * 3)));
          tr.melody.push(th.scale[idx]);
        }
      }
      while (tr.next < ctx.currentTime + 0.35) {
        const t = tr.next, s = tr.step % 64, bar = Math.floor(s / 16), chord = th.chords[bar];
        const root = th.root + chord;
        const out = tr.gain;
        if (s % 16 === 0) {
          // Pad: soft chord for the whole bar.
          for (const n of [0, 4, 7]) this.tone(NOTE(root + (th.scale.includes(3) && n === 4 ? 3 : n)), beat * 16, { type: 'triangle', vol: th.pad, attack: 0.4, at: t, out });
        }
        if (s % 4 === 0) this.tone(NOTE(root - 12), beat * 3.5, { type: th.bass, vol: th.bass === 'sawtooth' ? 0.04 : 0.11, attack: 0.02, at: t, out });
        const m = tr.melody[s];
        if (m != null) {
          const o = this.tone(NOTE(th.root + 12 + m), beat * 1.8, { type: th.lead, vol: 0.075, attack: 0.02, at: t, out });
          if (th.vibrato) { const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 5; lg.gain.value = 4; lfo.connect(lg); lg.connect(o.osc.frequency); lfo.start(t); lfo.stop(t + beat * 2); }
        }
        if (th.bell && s % 8 === 4 && tr.rng() < 0.6) this.tone(NOTE(th.root + 24 + th.scale[(tr.rng() * th.scale.length) | 0]), 1.6, { type: 'sine', vol: 0.05, at: t, out });
        tr.next += beat;
        tr.step++;
      }
    }

    // Called each frame: listener position and the area's theme.
    update(game) {
      if (!game.player) return;
      this.listener = game.player.position;
      const p = game.player.position, C = G.Config;
      // A map can choose its own music in the map editor.
      const theme = (game.map.music && THEMES[game.map.music]) ? game.map.music : game.map.cave ? 'dungeon' : game.mapId === 'forest' ? 'forest'
        : (game.map.town && Math.hypot(p.x - C.TOWN.cx, p.z - C.TOWN.cz) < C.TOWN.radius + 4) ? 'town' : 'meadow';
      this.setTheme(theme);
    }
  }

  G.Audio = Audio;
})(window.G = window.G || {});
