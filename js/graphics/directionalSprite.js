/* DirectionalSprite: a 2D character drawn as a camera-facing billboard.

   Look: the quad is screen-aligned and anchored at the feet, so the artwork
   keeps the same size and proportions from every camera angle and height.

   Depth: each pixel's depth is taken from an UPRIGHT plane standing at the
   feet, as if the character were a cardboard cut-out facing the camera.
   A screen-aligned plane tilts back when you look down from above, and on
   hillsides the slope behind a character would cut through it; an upright
   plane can't be swallowed by the ground behind it. The plane is also
   nudged toward the camera so the ground right at the feet can't cover a
   character that is lying down or sitting.

   Silhouette (player only): wherever a hill or building really is in front
   of the character, a soft tinted silhouette is drawn so you never lose
   sight of yourself.

   Direction: the character keeps a real facing in the world. Every frame
   the sprite shows that facing as seen from the camera, so orbiting the
   camera reveals the character's back, sides or face. */
(function (G) {
  'use strict';
  const STEP = Math.PI / 4;
  const U = G.Utils;

  function quadGeometry() {
    const buf = new THREE.InterleavedBuffer(new Float32Array([
      -0.5, -0.5, 0, 0, 0,
      0.5, -0.5, 0, 1, 0,
      0.5, 0.5, 0, 1, 1,
      -0.5, 0.5, 0, 0, 1,
    ]), 5);
    const g = new THREE.BufferGeometry();
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.setAttribute('position', new THREE.InterleavedBufferAttribute(buf, 3, 0, false));
    g.setAttribute('uv', new THREE.InterleavedBufferAttribute(buf, 2, 3, false));
    return g;
  }

  const VERT = `
    uniform vec2 center;
    uniform vec2 scale;
    uniform float bias;
    varying vec2 vUv;
    #include <fog_pars_vertex>
    void main() {
      vUv = uv;
      vec2 local = (position.xy - (center - 0.5)) * scale;     // offset from the feet, world units
      vec3 feet = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;

      // Appearance: screen-aligned quad at the feet.
      vec4 mvPosition = viewMatrix * vec4(feet, 1.0);
      mvPosition.xy += local;
      vec4 clipLook = projectionMatrix * mvPosition;

      // Depth: an upright cut-out at the feet, facing the camera, nudged toward it.
      vec3 toCam = vec3(cameraPosition.x - feet.x, 0.0, cameraPosition.z - feet.z);
      float lenH = length(toCam);
      toCam = lenH > 0.001 ? toCam / lenH : vec3(0.0, 0.0, 1.0);
      vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
      vec3 upright = feet + right * local.x + vec3(0.0, local.y, 0.0) + toCam * min(bias, lenH * 0.4);
      vec4 clipDepth = projectionMatrix * viewMatrix * vec4(upright, 1.0);

      gl_Position = clipLook;
      gl_Position.z = clamp(clipDepth.z / clipDepth.w, -1.0, 1.0) * clipLook.w;
      #include <fog_vertex>
    }`;

  const FRAG = `
    uniform sampler2D map;
    uniform vec3 color;
    uniform float opacity;
    uniform float alphaTest;
    uniform float silhouette;
    varying vec2 vUv;
    #include <fog_pars_fragment>
    void main() {
      vec4 tex = texture2D(map, vUv);
      if (tex.a < alphaTest) discard;
      vec4 c = vec4(tex.rgb * color, tex.a * opacity);
      if (silhouette > 0.5) c = vec4(color, 0.5 * opacity);
      gl_FragColor = linearToOutputTexel(c);
      #include <fog_fragment>
    }`;

  function makeMaterial(uniforms, ghost) {
    const m = new THREE.ShaderMaterial({
      uniforms, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: !ghost, fog: !ghost,
    });
    if (ghost) m.depthFunc = THREE.GreaterDepth;   // only where something is in front
    return m;
  }

  class DirectionalSprite {
    constructor(sheet, opts) {
      opts = opts || {};
      this.sheet = sheet;
      this.scaleK = opts.scale || 1;
      const shared = {
        map: { value: sheet.texture },
        center: { value: new THREE.Vector2(0.5, sheet.footOffset / sheet.worldH) },
        scale: { value: new THREE.Vector2(sheet.worldW * this.scaleK, sheet.worldH * this.scaleK) },
        bias: { value: opts.depthBias == null ? 0.6 : opts.depthBias },
        alphaTest: { value: 0.32 },
      };
      this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        color: { value: new THREE.Color(1, 1, 1) }, opacity: { value: 1 }, silhouette: { value: 0 },
      }]);
      Object.assign(this.uniforms, shared);
      this.material = makeMaterial(this.uniforms, false);
      this.material.color = this.uniforms.color.value;           // used by flash/tint code
      const geo = quadGeometry();
      this.buffer = geo.attributes.uv.data;
      this.mesh = new THREE.Mesh(geo, this.material);
      this.mesh.frustumCulled = false;
      this.mesh.renderOrder = 2;

      if (opts.silhouette) {
        const gu = Object.assign({}, shared, {
          color: { value: new THREE.Color(opts.silhouette) }, opacity: { value: 1 }, silhouette: { value: 1 },
          fogColor: this.uniforms.fogColor, fogNear: this.uniforms.fogNear, fogFar: this.uniforms.fogFar,
        });
        this.ghost = new THREE.Mesh(geo, makeMaterial(gu, true));
        this.ghost.frustumCulled = false;
        this.ghost.renderOrder = 3;
        this.ghostUniforms = gu;
      }

      this.anim = null;
      this.time = 0;
      this.speed = 1;
      this.dirIndex = 0;
      this.lastCell = -1;
      this.done = false;
      this.flash = 0;
      this.tint = null;
      this.play(opts.anim || 'idle');
    }

    get depthBias() { return this.uniforms.bias.value; }
    set depthBias(v) { this.uniforms.bias.value = v; }

    // Swap to another sprite sheet (job change, new weapon type).
    setSheet(sheet) {
      if (sheet === this.sheet) return;
      this.sheet = sheet;
      this.uniforms.map.value = sheet.texture;
      this.uniforms.scale.value.set(sheet.worldW * this.scaleK, sheet.worldH * this.scaleK);
      this.uniforms.center.value.set(0.5, sheet.footOffset / sheet.worldH);
      this.lastCell = -1;
      if (!sheet.anims[this.anim]) this.anim = 'idle';
    }

    play(name, opts) {
      opts = opts || {};
      if (this.anim === name && !opts.restart) { if (opts.speed) this.speed = opts.speed; return; }
      this.anim = name;
      this.time = 0;
      this.done = false;
      this.speed = opts.speed || 1;
      this.onEnd = opts.onEnd || null;
    }

    duration(name) {
      const a = this.sheet.anims[name];
      return a.count / a.fps;
    }

    setFlash(v) { this.flash = Math.max(this.flash, v); }

    chooseDirection(facing, camPos) {
      const p = this.mesh.position;
      const camDir = Math.atan2(camPos.x - p.x, camPos.z - p.z);
      const rel = U.wrapAngle(facing - camDir);
      const cur = U.wrapAngle(rel - this.dirIndex * STEP);
      if (Math.abs(cur) > STEP / 2 + 0.06) this.dirIndex = ((Math.round(rel / STEP) % 8) + 8) % 8;
    }

    update(dt, facing, camPos) {
      const a = this.sheet.anims[this.anim];
      this.time += dt * this.speed;
      let f = Math.floor(this.time * a.fps);
      if (a.loop) f %= a.count;
      else if (f >= a.count) {
        f = a.count - 1;
        if (!this.done) { this.done = true; if (this.onEnd) { const cb = this.onEnd; this.onEnd = null; cb(); } }
      }

      // World facing as seen from the camera: orbiting reveals back, sides or face.
      this.chooseDirection(facing, camPos);
      if (this.ghost) this.ghost.position.copy(this.mesh.position);

      const cell = this.dirIndex * this.sheet.framesPerDir + a.start + f;
      if (cell !== this.lastCell) {
        this.lastCell = cell;
        const s = this.sheet;
        const col = cell % s.cols, row = (cell / s.cols) | 0;
        const u0 = col / s.cols, u1 = (col + 1) / s.cols;
        const v1 = 1 - row / s.rows, v0 = 1 - (row + 1) / s.rows;
        const d = this.buffer.array; // [x y z u v] x 4: BL, BR, TR, TL
        d[3] = u0; d[4] = v0;
        d[8] = u1; d[9] = v0;
        d[13] = u1; d[14] = v1;
        d[18] = u0; d[19] = v1;
        this.buffer.needsUpdate = true;
      }

      // Damage flash tints the sprite red and fades out; statuses tint it too.
      const col = this.uniforms.color.value;
      if (this.flash > 0) {
        this.flash = Math.max(0, this.flash - dt * 4);
        const k = this.flash;
        col.setRGB(1, 1 - 0.55 * k, 1 - 0.55 * k);
      } else if (this.tint) {
        col.setRGB(this.tint[0], this.tint[1], this.tint[2]);
      } else if (col.r !== 1 || col.g !== 1 || col.b !== 1) {
        col.setRGB(1, 1, 1);
      }
    }

    setOpacity(o) {
      this.uniforms.opacity.value = o;
      if (this.ghostUniforms) this.ghostUniforms.opacity.value = o;
      this.mesh.visible = o > 0.01;
      if (this.ghost) this.ghost.visible = this.mesh.visible;
    }

    dispose() {
      this.mesh.geometry.dispose();
      this.material.dispose();
      if (this.ghost) this.ghost.material.dispose();
    }
  }

  G.DirectionalSprite = DirectionalSprite;
})(window.G = window.G || {});
