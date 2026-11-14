/* Atmosphere: the sky, the light, the time of day and the weather.

   Time of day. Outdoor maps run a shared day/night cycle taken from the
   clock, so everyone on a map sees the same sky. A map can instead be set to
   permanent day or permanent night (map editor: Map tab, Atmosphere), and
   caves, indoor rooms and maps with a special look (dusk, spooky, misty...)
   keep their own fixed light.

   Weather. Clear, cloudy, rain, storm, fog and snow, chosen from the clock
   and the map (again the same for everyone), blending smoothly from one to
   the next. A map can pin its weather too.

   This module only decides the numbers; the sky dome, the lights, the rain
   and snow, the lamps and the post-processing (postfx.js) draw them. */
(function (G) {
  'use strict';
  const U = G.Utils, C = G.Config;
  const CYCLE = 36 * 60;        // seconds for a full day and night
  const DAY_PART = 0.68;        // share of the cycle that is daytime
  const WEATHER_SLOT = 6 * 60;  // seconds each spell of weather lasts
  const WEATHER_FADE = 40;      // seconds to blend into the next one

  const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
  const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const blend3 = (a, b, c, wa, wb, wc) => [a[0] * wa + b[0] * wb + c[0] * wc, a[1] * wa + b[1] * wb + c[1] * wc, a[2] * wa + b[2] * wb + c[2] * wc];
  const blend1 = (a, b, c, wa, wb, wc) => a * wa + b * wb + c * wc;
  const lum = (c) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;

  // Looks for the three anchors of the cycle (display colours).
  const DAY = {
    top: rgb('#62a2ec'), mid: rgb('#aed3f7'), horizon: rgb('#e9eef8'), fog: rgb('#d9e3f6'), near: 34, far: 300,
    sun: rgb('#ffe6ba'), sunI: 1.22, hemiSky: rgb('#e9e6ff'), hemiGround: rgb('#a898c0'), hemiI: 0.84,
    tint: [1.03, 1.0, 0.965], sat: 1.07, sprite: [1, 1, 1], glowCol: rgb('#ffe2b0'), cloudLit: rgb('#fffaf2'), cloudDark: rgb('#c4c8ea'),
  };
  const DUSK = {
    top: rgb('#5a4f9a'), mid: rgb('#ef9a86'), horizon: rgb('#ffd9a6'), fog: rgb('#f0b9a4'), near: 20, far: 220,
    sun: rgb('#ffab6e'), sunI: 0.9, hemiSky: rgb('#e6b8d6'), hemiGround: rgb('#8a6c8e'), hemiI: 0.74,
    tint: [1.04, 0.98, 0.93], sat: 1.02, sprite: [1.0, 0.92, 0.86], glowCol: rgb('#ff9a55'), cloudLit: rgb('#ffd0a0'), cloudDark: rgb('#8a68a0'),
  };
  const NIGHT = {
    top: rgb('#0b0c2c'), mid: rgb('#1c2260'), horizon: rgb('#3a3f8a'), fog: rgb('#2a2e6c'), near: 18, far: 210,
    sun: rgb('#b4c0ff'), sunI: 0.5, hemiSky: rgb('#8088e6'), hemiGround: rgb('#3a3470'), hemiI: 0.72,
    tint: [0.92, 0.95, 1.12], sat: 0.94, sprite: [0.76, 0.8, 1.0], glowCol: rgb('#5878d0'), cloudLit: rgb('#6a6cb4'), cloudDark: rgb('#1c1c4c'),
  };
  // Weather: [clouds 0..1, rain, snow, fog, storm]
  const WEATHER = {
    clear: [0.18, 0, 0, 0, 0], cloudy: [0.62, 0, 0, 0, 0], rain: [0.92, 0.65, 0, 0.15, 0], storm: [1, 1, 0, 0.25, 1],
    fog: [0.55, 0, 0, 1, 0], snow: [0.85, 0, 0.9, 0.2, 0],
  };
  const AUTO = [['clear', 46], ['cloudy', 20], ['rain', 16], ['fog', 11], ['storm', 7]];

  function hash(n) { let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
  function strHash(s) { let h = 7; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; return h; }

  const SKY_VERT = 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  const SKY_FRAG = `
    uniform vec3 top; uniform vec3 mid; uniform vec3 horizon;
    uniform vec3 sunDir; uniform vec3 sunCol; uniform float sunSize;
    uniform vec3 moonDir; uniform float moon;
    uniform float stars; uniform float time; uniform float clouds;
    uniform vec3 cloudLit; uniform vec3 cloudDark; uniform float flash;
    varying vec3 vDir;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
    float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += noise(p) * a; p = p * 2.03 + 17.3; a *= 0.5; } return s; }
    void main(){
      vec3 d = normalize(vDir);
      float h = d.y;
      vec3 c = mix(horizon, mid, smoothstep(0.0, 0.2, h));
      c = mix(c, top, smoothstep(0.16, 0.78, h));
      c = mix(c, horizon * 0.96, smoothstep(0.0, -0.2, h));
      // Stars: one per cell of a fine grid on the dome, twinkling.
      if (stars > 0.01 && h > 0.0) {
        vec2 sp = d.xz / (d.y + 0.35) * 60.0;
        vec2 cell = floor(sp), f = fract(sp) - 0.5;
        float r = hash(cell);
        vec2 off = (vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5) * 0.7;
        float tw = 0.6 + 0.4 * sin(time * (1.5 + r * 3.0) + r * 40.0);
        float s = smoothstep(0.11 * (0.4 + r), 0.0, length(f - off)) * step(0.82, r) * tw;
        c += vec3(0.9, 0.95, 1.0) * s * stars * smoothstep(0.0, 0.25, h);
      }
      // Sun: a disc and a wide glow.
      float sd = max(dot(d, sunDir), 0.0);
      c += sunCol * (smoothstep(1.0 - sunSize, 1.0 - sunSize * 0.55, sd) * 1.2 + pow(sd, 90.0) * 0.5 + pow(sd, 9.0) * 0.28);
      // Moon: a pale disc with a soft halo.
      float md = max(dot(d, moonDir), 0.0);
      c += vec3(0.82, 0.88, 1.0) * moon * (smoothstep(0.9988, 0.9993, md) * 0.95 + pow(md, 300.0) * 0.3 + pow(md, 24.0) * 0.12);
      // Clouds: drifting noise on a flat ceiling, lit from the sun side.
      if (h > -0.02) {
        vec2 uv = d.xz / (h + 0.16) * 0.55 + vec2(time * 0.006, time * 0.0025);
        float n = fbm(uv * 1.6);
        float cov = smoothstep(1.02 - clouds * 0.82, 1.28 - clouds * 0.82, n + 0.34);
        float lit = clamp(fbm(uv * 1.6 + sunDir.xz * 0.12) - n, -0.3, 0.3) * 1.6 + 0.55;
        vec3 cc = mix(cloudDark, cloudLit, clamp(lit, 0.0, 1.0)) + sunCol * pow(sd, 12.0) * 0.35;
        c = mix(c, cc, cov * smoothstep(-0.02, 0.14, h) * 0.94);
      }
      c += flash * vec3(0.5, 0.55, 0.7);
      gl_FragColor = vec4(c, 1.0);
    }`;

  class Atmosphere {
    constructor(game) {
      this.game = game;
      this.scene = game.scene;
      this.time = 0;
      this.map = null;
      this.mode = 'cycle';
      this.override = {};           // for testing from the console: { hour, weather }
      this.w = [0.18, 0, 0, 0, 0];  // current weather mix
      this.flash = 0; this.nextFlash = 6;
      this.night = 0; this.glow = 0;
      this.lightDir = new THREE.Vector3(0.4, 0.8, 0.3).normalize();
      this.lamps = [];

      const u = this.skyU = {
        top: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, horizon: { value: new THREE.Color() },
        sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color() }, sunSize: { value: 0.0016 },
        moonDir: { value: new THREE.Vector3(0, 1, 0) }, moon: { value: 0 }, stars: { value: 0 }, time: { value: 0 }, clouds: { value: 0.2 },
        cloudLit: { value: new THREE.Color() }, cloudDark: { value: new THREE.Color() }, flash: { value: 0 },
      };
      const sky = new THREE.Mesh(new THREE.SphereGeometry(480, 40, 20), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false, uniforms: u, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG }));
      sky.renderOrder = -10; sky.frustumCulled = false;
      this.scene.add(sky);
      this.sky = sky;

      this.buildRain();
      this.buildSnow();
      this.glowTex = U.radialTexture(64, 0.05, 1.0);
      this.lampGroup = new THREE.Group();
      this.scene.add(this.lampGroup);
      this.pool = [];
    }

    /* Rain: streaks that live in a box round the player and wrap as they fall. */
    buildRain() {
      const N = 2600, seed = new Float32Array(N * 2 * 3), end = new Float32Array(N * 2), rnd = U.mulberry32(77);
      for (let i = 0; i < N; i++) {
        const x = rnd(), y = rnd(), z = rnd();
        for (let k = 0; k < 2; k++) { seed.set([x, y, z], (i * 2 + k) * 3); end[i * 2 + k] = k; }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(seed, 3));
      geo.setAttribute('end', new THREE.BufferAttribute(end, 1));
      this.rainU = { center: { value: new THREE.Vector3() }, time: { value: 0 }, amount: { value: 0 }, light: { value: new THREE.Color(1, 1, 1) } };
      const mat = new THREE.ShaderMaterial({
        uniforms: this.rainU, transparent: true, depthWrite: false,
        vertexShader: `attribute float end; uniform vec3 center; uniform float time; uniform float amount; varying float vA;
          void main(){
            vec3 box = vec3(64.0, 30.0, 64.0), fall = vec3(-5.0, -34.0, -2.0);
            vec3 p = mod(position * box + fall * time * (0.8 + position.x * 0.4), box) - box * 0.5 + center;
            p += normalize(fall) * end * (0.9 + position.z * 0.7);
            vA = (1.0 - end * 0.6) * step(position.y * 0.999, amount);
            gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
          }`,
        fragmentShader: 'uniform vec3 light; varying float vA; void main(){ if (vA < 0.01) discard; gl_FragColor = vec4(vec3(0.78, 0.85, 0.95) * light, 0.5 * vA); }',
      });
      this.rain = new THREE.LineSegments(geo, mat);
      this.rain.frustumCulled = false; this.rain.renderOrder = 6; this.rain.visible = false;
      this.scene.add(this.rain);
    }

    buildSnow() {
      const N = 2200, seed = new Float32Array(N * 3), rnd = U.mulberry32(78);
      for (let i = 0; i < N * 3; i++) seed[i] = rnd();
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(seed, 3));
      this.snowU = { center: { value: new THREE.Vector3() }, time: { value: 0 }, amount: { value: 0 }, scale: { value: 600 }, map: { value: U.radialTexture(32, 0.25, 1.0) }, light: { value: new THREE.Color(1, 1, 1) } };
      const mat = new THREE.ShaderMaterial({
        uniforms: this.snowU, transparent: true, depthWrite: false,
        vertexShader: `uniform vec3 center; uniform float time; uniform float amount; uniform float scale; varying float vA;
          void main(){
            vec3 box = vec3(56.0, 26.0, 56.0);
            vec3 q = position * box + vec3(-0.8, -2.6 - position.x * 1.4, -0.4) * time;
            q.x += sin(time * 0.9 + position.z * 30.0) * 0.6; q.z += cos(time * 0.7 + position.x * 30.0) * 0.6;
            vec3 p = mod(q, box) - box * 0.5 + center;
            vA = step(position.y * 0.999, amount);
            vec4 mv = viewMatrix * vec4(p, 1.0);
            gl_PointSize = (0.11 + position.z * 0.12) * scale / max(0.1, -mv.z);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: 'uniform sampler2D map; uniform vec3 light; varying float vA; void main(){ float a = texture2D(map, gl_PointCoord).a * vA; if (a < 0.02) discard; gl_FragColor = vec4(vec3(0.97, 0.98, 1.0) * light, a * 0.9); }',
      });
      this.snow = new THREE.Points(geo, mat);
      this.snow.frustumCulled = false; this.snow.renderOrder = 6; this.snow.visible = false;
      this.scene.add(this.snow);
    }

    /* Called when a map has been built. */
    setMap(map, env) {
      this.map = map;
      const a = map.atmosphere;
      this.mode = (map.cave || map.indoor) ? 'fixed' : (['day', 'night', 'cycle', 'fixed'].includes(map.time) ? map.time : (a ? 'fixed' : 'cycle'));
      this.outdoor = !map.cave && !map.indoor;
      this.seed = strHash(map.id || 'map');
      // The map's own daytime look, if it has one (fog and light strength from the map editor).
      this.dayLook = Object.assign({}, DAY);
      if (a && this.mode !== 'fixed') {
        if (a.fog) this.dayLook.fog = rgb(a.fog);
        if (a.near != null) this.dayLook.near = a.near;
        if (a.far != null) this.dayLook.far = a.far;
        if (a.hemi != null) this.dayLook.hemiI = a.hemi;
        if (a.sun != null) this.dayLook.sunI = a.sun;
        if (a.ground) this.dayLook.hemiGround = rgb(a.ground);
      } else if (map.fog && this.mode !== 'fixed') this.dayLook.fog = mix3(DAY.fog, rgb(map.fog), 0.7);
      if (this.mode === 'fixed') {
        const f = a || {};
        const sky = f.sky || ['#4a98e6', '#9fd0f4', C.SKY_HORIZON];
        this.fixed = {
          top: rgb(sky[0]), mid: rgb(sky[1]), horizon: rgb(sky[2]), fog: rgb(f.fog || C.SKY_HORIZON), near: f.near == null ? 90 : f.near, far: f.far == null ? 300 : f.far,
          sun: rgb('#fff0d4'), sunI: f.sun == null ? 1.28 : f.sun, hemiSky: rgb('#dff1ff'), hemiGround: rgb(f.ground || '#6b8f45'), hemiI: f.hemi == null ? 0.62 : f.hemi,
        };
        this.fixed.dark = U.clamp(1 - lum(this.fixed.mid) * 2.2, 0, 1);       // how night-like this look is
      }
      // Lamps on this map: a glow, a pool of light on the ground, and a few real lights that follow the player.
      for (const o of this.lampGroup.children.slice()) { this.lampGroup.remove(o); if (o.material) o.material.dispose(); if (o.geometry) o.geometry.dispose(); }
      this.lamps = ((env && env.lamps) || []).map((l) => {
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: '#ff9c40', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
        glow.position.set(l.x, l.y, l.z); glow.scale.setScalar(3.4);
        const poolMat = new THREE.MeshBasicMaterial({ map: this.glowTex, color: '#e0701c', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
        const pool = new THREE.Mesh(new THREE.CircleGeometry(4.6, 20), poolMat);
        pool.rotation.x = -Math.PI / 2; pool.position.set(l.x, G.Terrain.surfaceHeight(l.x, l.z) + 0.06, l.z);
        this.lampGroup.add(glow, pool);
        return { x: l.x, y: l.y, z: l.z, glow, pool };
      });
      this.poolTimer = 0;
      this.update(0, null);
    }

    // How many real lamp lights to keep (they cost shading time everywhere).
    setQuality(level) {
      const want = level === 'high' ? 4 : level === 'medium' ? 2 : 0;
      while (this.pool.length > want) this.scene.remove(this.pool.pop());
      while (this.pool.length < want) { const L = new THREE.PointLight('#ffb866', 0, 15, 1.7); L.position.set(0, -50, 0); this.scene.add(L); this.pool.push(L); }
    }

    /* Hour of the day, 0..24 (6 = sunrise, 18 = sunset). */
    hour() {
      if (this.override.hour != null) return this.override.hour;
      if (this.mode === 'day') return 12.8;
      if (this.mode === 'night') return 0.6;
      const u = ((Date.now() / 1000) % CYCLE) / CYCLE;
      return u < DAY_PART ? 6 + (u / DAY_PART) * 12 : (18 + ((u - DAY_PART) / (1 - DAY_PART)) * 12) % 24;
    }

    // The weather mix right now: this map's pinned weather, or the shared schedule.
    weatherTarget() {
      const pin = this.override.weather || (this.map && this.map.weather);
      if (!this.outdoor) return WEATHER.clear.map(() => 0);
      if (pin && WEATHER[pin]) return WEATHER[pin];
      const now = Date.now() / 1000, slot = Math.floor(now / WEATHER_SLOT), into = now - slot * WEATHER_SLOT;
      const pick = (s) => { let r = hash(s * 7919 + this.seed) * 100; for (const [name, wgt] of AUTO) { if ((r -= wgt) < 0) return WEATHER[name]; } return WEATHER.clear; };
      const cur = pick(slot);
      if (into >= WEATHER_FADE) return cur;
      const prev = pick(slot - 1), k = U.smoothstep(0, 1, into / WEATHER_FADE);
      return cur.map((v, i) => prev[i] + (v - prev[i]) * k);
    }

    update(dt, focus) {
      this.time += dt;
      const game = this.game, post = game.post, S = G.Stylize;
      const tgt = this.weatherTarget();
      const ease = dt > 0 ? 1 - Math.exp(-dt * 0.6) : 1;
      for (let i = 0; i < 5; i++) this.w[i] += (tgt[i] - this.w[i]) * ease;
      const [clouds, rain, snow, fogW, storm] = this.w;

      let L, sunDir = this.lightDir, moonAmt = 0, starAmt = 0, sunDisc = [0, 0, 0], nightW = 0, glow = 0, tw = 0, dayW = 1;
      const sunPos = new THREE.Vector3(0, 1, 0), moonPos = new THREE.Vector3(0, -1, 0);
      if (this.mode === 'fixed') {
        const F = this.fixed;
        L = Object.assign({ tint: [1, 1, 1], sat: 1.04, sprite: [1, 1, 1], glowCol: [0, 0, 0], cloudLit: mix3(F.horizon, [1, 1, 1], 0.3), cloudDark: mix3(F.top, F.mid, 0.5) }, F);
        this.lightDir.set(38, 78, 30).normalize();
        sunPos.set(0, -1, 0);
        nightW = F.dark; glow = F.dark > 0.35 ? 1 : 0;
        starAmt = this.outdoor ? U.smoothstep(0.6, 0.9, F.dark) : 0;
        dayW = 1 - F.dark;
      } else {
        const hour = this.hour(), isDay = hour >= 6 && hour < 18;
        const a = isDay ? ((hour - 6) / 12) * Math.PI : (((hour + 6) % 24) / 12) * Math.PI;      // 0..pi across the sky
        const arc = new THREE.Vector3(Math.cos(a) * 0.92, Math.sin(a) + 0.1, 0.4 - Math.sin(a) * 0.12).normalize();
        const e = isDay ? Math.sin(a) : -Math.sin(a) * 0.7;                                      // sun elevation
        if (isDay) { sunPos.copy(arc); moonPos.set(-arc.x, -arc.y, -arc.z); } else { moonPos.set(arc.x, arc.y, -arc.z).normalize(); sunPos.set(-arc.x, -arc.y * 0.4 - 0.05, arc.z).normalize(); }
        dayW = U.smoothstep(0.0, 0.42, e); nightW = U.smoothstep(0.04, -0.24, e); tw = Math.max(0, 1 - dayW - nightW);
        const D = this.dayLook;
        L = {};
        for (const k of ['top', 'mid', 'horizon', 'fog', 'sun', 'hemiSky', 'hemiGround', 'tint', 'sprite', 'glowCol', 'cloudLit', 'cloudDark']) L[k] = blend3(D[k], DUSK[k], NIGHT[k], dayW, tw, nightW);
        for (const k of ['near', 'far', 'hemiI', 'sat']) L[k] = blend1(D[k], DUSK[k], NIGHT[k], dayW, tw, nightW);
        // The light is the sun by day and the moon by night; it fades out as one sets and the other takes over.
        if (e > -0.04) { this.lightDir.copy(sunPos); if (this.lightDir.y < 0.16) this.lightDir.setY(0.16).normalize(); L.sunI = blend1(D.sunI, DUSK.sunI, 0, dayW, tw, nightW) * U.smoothstep(-0.04, 0.16, e); }
        else { this.lightDir.copy(moonPos); if (this.lightDir.y < 0.3) this.lightDir.setY(0.3).normalize(); L.sunI = NIGHT.sunI * U.smoothstep(-0.04, -0.2, e); L.sun = NIGHT.sun; }
        moonAmt = nightW; starAmt = nightW * (1 - clouds * 0.9);
        sunDisc = mix3(mix3(DUSK.sun, [1, 0.97, 0.88], dayW), [0, 0, 0], U.smoothstep(-0.02, -0.14, e));
        glow = U.smoothstep(0.3, 0.04, e);
      }

      // Weather on top of the time of day.
      const grey = lum(L.mid), over = U.smoothstep(0.3, 1, clouds);
      const greyTop = [grey * 0.62, grey * 0.66, grey * 0.74], greyHor = [grey * 0.92, grey * 0.95, grey * 1.0];
      const top = mix3(L.top, greyTop, over * 0.85), mid = mix3(L.mid, mix3(greyTop, greyHor, 0.5), over * 0.85), horizon = mix3(L.horizon, greyHor, over * 0.8);
      let fog = mix3(L.fog, greyHor, Math.max(over * 0.7, fogW * 0.6));
      const dim = 1 - over * 0.5 - storm * 0.2;
      const sunI = L.sunI * (1 - over * 0.72), hemiI = L.hemiI * (1 + over * 0.12) * (1 - storm * 0.1);
      const near = U.lerp(U.lerp(L.near, L.near * 0.55, over), 3, fogW * 0.95), far = U.lerp(U.lerp(L.far, L.far * 0.72, over), 62, fogW * 0.92);
      const wet = Math.min(1, rain * 1.3);

      // Lightning.
      if (storm > 0.5 && dt > 0) {
        this.nextFlash -= dt;
        if (this.nextFlash <= 0) { this.flash = 1; this.nextFlash = 5 + Math.random() * 11; }
      }
      this.flash = Math.max(0, this.flash - dt * 3.2);
      const fl = this.flash * this.flash * (0.6 + 0.4 * Math.sin(this.time * 70));

      // Sky.
      const su = this.skyU;
      su.top.value.setRGB(top[0], top[1], top[2]); su.mid.value.setRGB(mid[0], mid[1], mid[2]); su.horizon.value.setRGB(horizon[0], horizon[1], horizon[2]);
      su.sunDir.value.copy(sunPos); su.sunCol.value.setRGB(sunDisc[0] * (1 - over), sunDisc[1] * (1 - over), sunDisc[2] * (1 - over));
      su.moonDir.value.copy(moonPos); su.moon.value = moonAmt * (1 - over * 0.9); su.stars.value = starAmt;
      su.time.value = this.time + (Date.now() / 1000) % 10000; su.clouds.value = this.outdoor ? clouds : 0;
      const cl = mix3(L.cloudLit, greyHor, over * 0.6), cd = mix3(L.cloudDark, greyTop, over * 0.7);
      su.cloudLit.value.setRGB(cl[0], cl[1], cl[2]); su.cloudDark.value.setRGB(cd[0], cd[1], cd[2]); su.flash.value = fl;
      if (focus) this.sky.position.set(focus.x, 0, focus.z);

      // Lights.
      game.sun.color.setRGB(L.sun[0], L.sun[1], L.sun[2]).convertSRGBToLinear();
      game.sun.intensity = sunI + fl * 1.2;
      game.hemi.color.setRGB(L.hemiSky[0], L.hemiSky[1], L.hemiSky[2]).convertSRGBToLinear();
      game.hemi.groundColor.setRGB(L.hemiGround[0], L.hemiGround[1], L.hemiGround[2]).convertSRGBToLinear();
      game.hemi.intensity = hemiI + fl * 0.9;
      game.sunOffset.copy(this.lightDir).multiplyScalar(92);

      // Sprites take the ambient tint (they are painted, not lit).
      const sp = mix3(L.sprite, [L.sprite[0] * 0.86, L.sprite[1] * 0.88, L.sprite[2] * 0.93], Math.max(over, fogW * 0.5));
      G.SpriteLight.value.setRGB(Math.min(1.25, sp[0] + fl * 0.5), Math.min(1.25, sp[1] + fl * 0.5), Math.min(1.25, sp[2] + fl * 0.5));

      // World shading shared values.
      this.night = nightW; this.glow = glow;
      if (S) {
        S.style[0] = nightW; S.style[1] = snow > 0.05 ? -Math.min(1, snow * 1.1) : wet;   // rain soaks, snow settles S.style[2] = this.time; S.style[3] = this.mode === 'fixed' ? 0.5 : 0.35 + dayW * 0.65;
        const gc = new THREE.Color(1.0, 0.66, 0.3).convertSRGBToLinear();
        S.glow[0] = gc.r; S.glow[1] = gc.g; S.glow[2] = gc.b; S.glow[3] = glow * 1.7;
      }

      // Fog, mist and grade.
      if (post) {
        const pu = post.u;
        pu.fogColor.value.setRGB(fog[0], fog[1], fog[2]);
        pu.fogNear.value = near; pu.fogFar.value = Math.max(near + 5, far); pu.fogMax.value = this.mode === 'fixed' ? 1 : U.lerp(0.78, 1, Math.max(fogW, over * 0.6));
        pu.pastel.value = 1; pu.soft.value = 0.26 + tw * 0.14; pu.focus.value = this.map && (this.map.cave || this.map.indoor) ? 0.6 : 1;
        const dawn = this.mode === 'fixed' ? 0 : tw;
        pu.mist.value = this.outdoor ? 0.10 + dawn * 0.35 + nightW * 0.2 + fogW * 2.6 + rain * 0.5 : (this.map && this.map.cave ? 0.5 : 0.05);
        pu.mistTop.value = this.outdoor ? 0.4 + fogW * 3 : 0.3; pu.mistFall.value = this.outdoor ? U.lerp(0.42, 0.1, fogW) : 0.8;
        pu.sunDir.value.copy(this.lightDir);
        const sg = this.mode === 'fixed' ? [0, 0, 0] : mix3([L.sun[0] * 0.3, L.sun[1] * 0.26, L.sun[2] * 0.2], [0, 0, 0], over);
        pu.sunGlow.value.setRGB(sg[0] * (0.4 + tw), sg[1] * (0.4 + tw), sg[2] * (0.4 + tw));
        pu.time.value = this.time;
        pu.tint.value.setRGB(L.tint[0] * dim + (1 - dim) * 0.9, L.tint[1] * dim + (1 - dim) * 0.93, L.tint[2] * dim + (1 - dim) * 0.98);
        pu.saturation.value = L.sat - over * 0.16 - fogW * 0.1;
        pu.contrast.value = 0.97 - fogW * 0.05;
        pu.bloom.value = 0.42 + glow * 0.35 + tw * 0.2;
        pu.flash.value = fl * 0.35;
        pu.ao.value = 0.75;
      }

      // Rain and snow follow the player.
      const c = focus || this.rainU.center.value;
      this.rain.visible = rain > 0.02; this.snow.visible = snow > 0.02;
      const pl = [0.55 + 0.45 * lum(L.hemiSky) * hemiI * 1.4, 0, 0]; const pv = Math.min(1, pl[0]);
      if (this.rain.visible) { this.rainU.center.value.set(c.x, c.y + 9, c.z); this.rainU.time.value = this.time; this.rainU.amount.value = rain; this.rainU.light.value.setRGB(pv, pv, pv); }
      if (this.snow.visible) { this.snowU.center.value.set(c.x, c.y + 8, c.z); this.snowU.time.value = this.time; this.snowU.amount.value = snow; this.snowU.light.value.setRGB(pv, pv, pv); if (game.effects) this.snowU.scale.value = game.effects.sparks.uniforms.scale.value; }
      if (focus && dt > 0 && game.effects) {
        // Splashes where the rain lands, and fireflies on clear nights.
        const fx = game.effects, TR = G.Terrain;
        for (let i = 0; i < Math.round(rain * 5); i++) {
          const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * 20, x = focus.x + Math.cos(a) * r, z = focus.z + Math.sin(a) * r;
          fx.puffs.emit(x, TR.surfaceHeight(x, z) + 0.06, z, { color: [0.8, 0.88, 1], size: 0.05, endSize: 0.3, vy: 0.5, gravity: 2, life: 0.28, alpha: 0.45 });
        }
        if (this.outdoor && nightW > 0.5 && rain < 0.1 && Math.random() < dt * 5) {
          const a = Math.random() * 6.283, r = 3 + Math.random() * 17, x = focus.x + Math.cos(a) * r, z = focus.z + Math.sin(a) * r;
          if (!TR.isWater(x, z)) fx.sparks.emit(x, TR.surfaceHeight(x, z) + 0.4 + Math.random() * 1.2, z, { color: [0.75, 1, 0.35], size: 0.16, endSize: 0.02, vx: (Math.random() - 0.5) * 0.7, vy: 0.15 + Math.random() * 0.3, vz: (Math.random() - 0.5) * 0.7, life: 2.6, alpha: 0.9 });
        }
      }

      // Lamps.
      const flick = 0.94 + 0.06 * Math.sin(this.time * 11);
      for (const l of this.lamps) { l.glow.material.opacity = glow * 0.7 * flick; l.pool.material.opacity = glow * 0.42 * flick; l.glow.visible = l.pool.visible = glow > 0.01; }
      if (focus && this.pool.length) {
        this.poolTimer -= dt;
        if (this.poolTimer <= 0) {
          this.poolTimer = 0.5;
          const near2 = this.lamps.slice().sort((p, q) => ((p.x - focus.x) ** 2 + (p.z - focus.z) ** 2) - ((q.x - focus.x) ** 2 + (q.z - focus.z) ** 2));
          this.pool.forEach((Lt, i) => { const l = near2[i]; if (l) Lt.position.set(l.x, l.y + 0.2, l.z); else Lt.position.set(0, -50, 0); Lt.userData.on = !!l; });
        }
        for (const Lt of this.pool) Lt.intensity = Lt.userData.on ? glow * 1.7 * flick : 0;
      }
    }
  }

  Atmosphere.WEATHER = Object.keys(WEATHER);
  G.Atmosphere = Atmosphere;
})(window.G = window.G || {});
