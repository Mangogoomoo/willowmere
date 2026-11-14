/* PostFX: the scene is drawn into an off-screen target (colour + depth), then
   finished in a few full-screen passes:

     1. bloom       bright areas (sky near the sun, lamps, spell effects) glow softly
     2. composite   distance fog, ground mist that pools in low places, light
                    scattered round the sun, soft contact shading (ambient
                    occlusion from the depth buffer), the colour grade for the
                    time of day and weather, a gentle vignette, lightning flashes

   Quality levels: high = 4x anti-aliasing + bloom + contact shading,
   medium = bloom at lower resolution, low = fog and grade only. */
(function (G) {
  'use strict';

  const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

  const BRIGHT = `
    uniform sampler2D tex; uniform vec2 texel; uniform float threshold; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tex, vUv + texel * vec2(-0.5, -0.5)).rgb + texture2D(tex, vUv + texel * vec2(0.5, -0.5)).rgb
             + texture2D(tex, vUv + texel * vec2(-0.5, 0.5)).rgb + texture2D(tex, vUv + texel * vec2(0.5, 0.5)).rgb;
      c *= 0.25;
      float l = max(c.r, max(c.g, c.b));
      // Only what is brighter than the threshold blooms (so sunlit ground doesn't wash out).
      float k = max(l - threshold, 0.0) / max(l, 1e-4);
      gl_FragColor = vec4(c * k * 2.2, 1.0);
    }`;
  const DOWN = `
    uniform sampler2D tex; uniform vec2 texel; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tex, vUv).rgb * 4.0;
      c += texture2D(tex, vUv + texel * vec2(-1.0, -1.0)).rgb + texture2D(tex, vUv + texel * vec2(1.0, -1.0)).rgb
         + texture2D(tex, vUv + texel * vec2(-1.0, 1.0)).rgb + texture2D(tex, vUv + texel * vec2(1.0, 1.0)).rgb;
      gl_FragColor = vec4(c / 8.0, 1.0);
    }`;
  const UP = `
    uniform sampler2D tex; uniform sampler2D add; uniform vec2 texel; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tex, vUv + texel * vec2(-1.0, 0.0)).rgb + texture2D(tex, vUv + texel * vec2(1.0, 0.0)).rgb
             + texture2D(tex, vUv + texel * vec2(0.0, -1.0)).rgb + texture2D(tex, vUv + texel * vec2(0.0, 1.0)).rgb;
      c = c * 2.0 + texture2D(tex, vUv + texel * vec2(-1.0, -1.0)).rgb + texture2D(tex, vUv + texel * vec2(1.0, -1.0)).rgb
        + texture2D(tex, vUv + texel * vec2(-1.0, 1.0)).rgb + texture2D(tex, vUv + texel * vec2(1.0, 1.0)).rgb;
      gl_FragColor = vec4(mix(texture2D(add, vUv).rgb, c / 12.0, 0.62), 1.0);
    }`;

  const FINAL = `
    uniform sampler2D tColor; uniform sampler2D tDepth; uniform sampler2D tBloom;
    uniform vec2 texel; uniform float near; uniform float far;
    uniform mat4 invProj; uniform mat4 camWorld; uniform vec3 camPos;
    uniform vec3 fogColor; uniform float fogNear; uniform float fogFar; uniform float fogMax;
    uniform float mist; uniform float mistTop; uniform float mistFall;
    uniform vec3 sunDir; uniform vec3 sunGlow; uniform float time;
    uniform float bloom; uniform float ao;
    uniform vec3 tint; uniform float saturation; uniform float contrast; uniform float vignette; uniform float flash;
    varying vec2 vUv;

    float viewZ(vec2 uv) { float d = texture2D(tDepth, uv).x; return (near * far) / ((far - near) * d - far); }   // negative in front of the camera
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }

    void main(){
      vec3 col = texture2D(tColor, vUv).rgb;
      float d = texture2D(tDepth, vUv).x;
      float z = (near * far) / ((far - near) * d - far);
      // The view ray through this pixel, and where it meets the scene.
      vec4 vr = invProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
      vec3 viewRay = vr.xyz / vr.w;
      vec3 vp = viewRay * (z / viewRay.z);
      vec3 wdir = normalize((camWorld * vec4(viewRay, 0.0)).xyz);
      vec3 wp = (camWorld * vec4(vp, 1.0)).xyz;
      float dist = length(vp);
      bool sky = d > 0.99999;

      #ifdef USE_AO
      if (!sky && ao > 0.0) {
        // Contact shading: how much nearby geometry rises above this surface.
        vec3 nrm = normalize(cross(dFdx(vp), dFdy(vp)));
        float occ = 0.0, rad = clamp(0.9 / -z, 0.003, 0.05);
        float a0 = hash(gl_FragCoord.xy) * 6.283;
        for (int i = 0; i < 8; i++) {
          float a = a0 + float(i) * 2.399, r = rad * (0.25 + 0.75 * float(i + 1) / 8.0);
          vec2 suv = vUv + vec2(cos(a), sin(a) * (texel.y / texel.x)) * r;
          vec4 sr = invProj * vec4(suv * 2.0 - 1.0, 1.0, 1.0);
          vec3 ray = sr.xyz / sr.w;
          vec3 sp = ray * (viewZ(suv) / ray.z);
          vec3 v = sp - vp;
          float dl = length(v);
          occ += max(dot(nrm, v / max(dl, 1e-4)) - 0.12, 0.0) * (1.0 - smoothstep(0.6, 1.8, dl));
        }
        occ = clamp(occ / 8.0 * 2.6, 0.0, 1.0);
        col *= mix(vec3(1.0), vec3(0.62, 0.60, 0.74), occ * ao);
      }
      #endif

      if (!sky) {
        // Distance fog, plus mist that gathers below mistTop and drifts.
        float f = smoothstep(fogNear, fogFar, dist) * fogMax;
        float drift = 0.65 + 0.7 * noise(wp.xz * 0.045 + vec2(time * 0.05, time * 0.021)) * noise(wp.xz * 0.013 - vec2(time * 0.017, 0.0)) * 2.0;
        float low = exp(-max(wp.y - mistTop, 0.0) * mistFall);
        float m = (1.0 - exp(-dist * 0.022 * mist * drift)) * low;
        f = 1.0 - (1.0 - f) * (1.0 - clamp(m, 0.0, 0.95));
        // Fog lit by the sun (or moon) glows toward it.
        float toSun = pow(max(dot(wdir, sunDir), 0.0), 6.0);
        vec3 fc = fogColor + sunGlow * toSun;
        col = mix(col, fc, f);
      }

      col += texture2D(tBloom, vUv).rgb * bloom;

      // Grade: tint, saturation, contrast.
      col *= tint;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, saturation);
      col = (col - 0.5) * contrast + 0.5;
      col += flash * vec3(0.75, 0.8, 1.0);
      vec2 q = vUv - 0.5;
      col *= 1.0 - vignette * smoothstep(0.25, 0.95, dot(q, q) * 2.2);
      // A whisper of grain hides banding in fog and night gradients.
      col += (hash(gl_FragCoord.xy + fract(time) * 61.0) - 0.5) / 255.0 * 1.5;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`;

  class PostFX {
    constructor(renderer) {
      this.renderer = renderer;
      this.scene = new THREE.Scene();
      this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
      this.quad.frustumCulled = false;
      this.scene.add(this.quad);
      const mat = (frag, uniforms, defines) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, defines: defines || {}, depthTest: false, depthWrite: false, extensions: { derivatives: true } });
      this.bright = mat(BRIGHT, { tex: { value: null }, texel: { value: new THREE.Vector2() }, threshold: { value: 0.86 } });
      this.down = mat(DOWN, { tex: { value: null }, texel: { value: new THREE.Vector2() } });
      this.up = mat(UP, { tex: { value: null }, add: { value: null }, texel: { value: new THREE.Vector2() } });
      this.u = {
        tColor: { value: null }, tDepth: { value: null }, tBloom: { value: null }, texel: { value: new THREE.Vector2() },
        near: { value: 0.1 }, far: { value: 900 }, invProj: { value: new THREE.Matrix4() }, camWorld: { value: new THREE.Matrix4() }, camPos: { value: new THREE.Vector3() },
        fogColor: { value: new THREE.Color(0.86, 0.93, 0.96) }, fogNear: { value: 90 }, fogFar: { value: 300 }, fogMax: { value: 1 },
        mist: { value: 0.12 }, mistTop: { value: 0.5 }, mistFall: { value: 0.35 },
        sunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) }, sunGlow: { value: new THREE.Color(0, 0, 0) }, time: { value: 0 },
        bloom: { value: 0.55 }, ao: { value: 0.7 },
        tint: { value: new THREE.Color(1, 1, 1) }, saturation: { value: 1.06 }, contrast: { value: 1.04 }, vignette: { value: 0.22 }, flash: { value: 0 },
      };
      this.final = mat(FINAL, this.u, {});
      this.black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); this.black.needsUpdate = true;
      this.level = 'high';
      this.w = 0; this.h = 0;
    }

    setQuality(level) {
      if (this.level === level && this.target) return;
      this.level = level;
      this.final.defines = level === 'high' ? { USE_AO: '' } : {};
      this.final.needsUpdate = true;
      this.build();
    }

    setSize(w, h, dpr) {
      w = Math.max(2, Math.round(w * dpr)); h = Math.max(2, Math.round(h * dpr));
      if (w === this.w && h === this.h && this.target) return;
      this.w = w; this.h = h;
      this.build();
    }

    build() {
      if (!this.w) return;
      const r = this.renderer, gl2 = r.capabilities.isWebGL2;
      for (const t of this.targets || []) t.dispose();
      if (this.target) { this.target.depthTexture.dispose(); this.target.dispose(); }
      const samples = this.level === 'high' && gl2 ? Math.min(4, r.capabilities.maxSamples || 0) : 0;
      const depth = new THREE.DepthTexture(this.w, this.h);
      depth.type = gl2 ? THREE.UnsignedIntType : THREE.UnsignedShortType;
      depth.minFilter = depth.magFilter = THREE.NearestFilter;
      this.target = new THREE.WebGLRenderTarget(this.w, this.h, { depthTexture: depth, depthBuffer: true, samples, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
      // Bloom chain: half, quarter, eighth, sixteenth resolution.
      this.targets = [];
      this.bloomOn = this.level !== 'low';
      if (this.bloomOn) {
        const base = this.level === 'high' ? 2 : 4;
        for (let i = 0; i < 4; i++) {
          const k = base << i, tw = Math.max(2, Math.round(this.w / k)), th = Math.max(2, Math.round(this.h / k));
          const mk = () => new THREE.WebGLRenderTarget(tw, th, { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
          this.targets.push(mk(), mk());                      // [down, up] per level
        }
      }
    }

    pass(material, target) {
      this.quad.material = material;
      this.renderer.setRenderTarget(target || null);
      this.renderer.render(this.scene, this.cam);
    }

    /* Draw the scene with everything applied. */
    render(scene, camera) {
      const r = this.renderer;
      if (!this.target) { r.setRenderTarget(null); r.render(scene, camera); return; }
      r.setRenderTarget(this.target);
      r.render(scene, camera);

      const u = this.u;
      if (this.bloomOn) {
        const T = this.targets, n = T.length / 2;
        this.bright.uniforms.tex.value = this.target.texture;
        this.bright.uniforms.texel.value.set(1 / this.w, 1 / this.h);
        this.pass(this.bright, T[0]);
        for (let i = 1; i < n; i++) {
          this.down.uniforms.tex.value = T[(i - 1) * 2].texture;
          this.down.uniforms.texel.value.set(1 / T[(i - 1) * 2].width, 1 / T[(i - 1) * 2].height);
          this.pass(this.down, T[i * 2]);
        }
        // Back up the chain, adding each level's detail.
        let prev = T[(n - 1) * 2];
        for (let i = n - 2; i >= 0; i--) {
          this.up.uniforms.tex.value = prev.texture;
          this.up.uniforms.add.value = T[i * 2].texture;
          this.up.uniforms.texel.value.set(1 / prev.width, 1 / prev.height);
          this.pass(this.up, T[i * 2 + 1]);
          prev = T[i * 2 + 1];
        }
        u.tBloom.value = prev.texture;
      } else u.tBloom.value = this.black;

      u.tColor.value = this.target.texture;
      u.tDepth.value = this.target.depthTexture;
      u.texel.value.set(1 / this.w, 1 / this.h);
      u.near.value = camera.near; u.far.value = camera.far;
      u.invProj.value.copy(camera.projectionMatrixInverse);
      u.camWorld.value.copy(camera.matrixWorld);
      u.camPos.value.setFromMatrixPosition(camera.matrixWorld);
      this.pass(this.final, null);
    }
  }

  G.PostFX = PostFX;
})(window.G = window.G || {});
