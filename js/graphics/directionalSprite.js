/* DirectionalSprite: a 2D character drawn as a screen-aligned billboard.

   Rendering: a THREE.Sprite anchored at the feet. It always faces the camera
   squarely, so the artwork keeps the same size, proportions and shape from
   every camera angle and height - never stretched, squashed or skewed. The
   whole quad sits at the feet's depth, so ground behind the character can't
   cut through it.

   Direction: the character keeps a real facing in the world. Every frame the
   sprite shows that facing as seen from the camera, so orbiting the camera
   reveals the character's back, sides or face like a figure standing in the
   world. Camera rotation never changes where the character actually faces. */
(function (G) {
  'use strict';
  const STEP = Math.PI / 4;
  const U = G.Utils;

  function quadGeometry() {
    // Same layout as three's built-in sprite quad, but owned per sprite so
    // each one can show its own frame of the shared atlas.
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

  class DirectionalSprite {
    constructor(sheet, opts) {
      opts = opts || {};
      this.sheet = sheet;
      this.material = new THREE.SpriteMaterial({
        map: sheet.texture, transparent: true, alphaTest: 0.32, depthWrite: true, toneMapped: false,
      });
      const sprite = new THREE.Sprite(this.material);
      sprite.geometry = quadGeometry();
      this.buffer = sprite.geometry.attributes.uv.data;
      const s = opts.scale || 1;
      this.scaleK = s;
      sprite.scale.set(sheet.worldW * s, sheet.worldH * s, 1);
      // Anchor the quad at the character's feet, not its centre.
      sprite.center.set(0.5, sheet.footOffset / sheet.worldH);
      sprite.renderOrder = 2;
      this.mesh = sprite;

      this.anim = null;
      this.time = 0;
      this.speed = 1;
      this.dirIndex = 0;
      this.shownFacing = null;  // facing angle the current direction was chosen for
      this.lastCell = -1;
      this.done = false;
      this.flash = 0;
      this.play(opts.anim || 'idle');
    }

    // Swap to another sprite sheet (job change, new weapon type).
    setSheet(sheet) {
      if (sheet === this.sheet) return;
      this.sheet = sheet;
      this.material.map = sheet.texture;
      this.mesh.scale.set(sheet.worldW * this.scaleK, sheet.worldH * this.scaleK, 1);
      this.mesh.center.set(0.5, sheet.footOffset / sheet.worldH);
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

    /* Choose the direction frame from the character's facing as seen from the
       camera, with hysteresis so it doesn't flicker at boundaries. */
    chooseDirection(facing, camPos) {
      const p = this.mesh.position;
      const camDir = Math.atan2(camPos.x - p.x, camPos.z - p.z);
      const rel = U.wrapAngle(facing - camDir);
      const cur = U.wrapAngle(rel - this.dirIndex * STEP);
      if (this.shownFacing === null || Math.abs(cur) > STEP / 2 + 0.06) {
        this.dirIndex = ((Math.round(rel / STEP) % 8) + 8) % 8;
      }
      this.shownFacing = facing;
    }

    /* facing: the entity's world facing angle.
       acting: true while the entity is walking (its movement is intentional). */
    update(dt, facing, camPos, acting) {
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

      // Damage flash tints the sprite red and fades out.
      if (this.flash > 0) {
        this.flash = Math.max(0, this.flash - dt * 4);
        const k = this.flash;
        this.material.color.setRGB(1, 1 - 0.55 * k, 1 - 0.55 * k);
      } else if (this.tint) {
        this.material.color.setRGB(this.tint[0], this.tint[1], this.tint[2]);
      } else if (this.material.color.g !== 1 || this.material.color.r !== 1) {
        this.material.color.setRGB(1, 1, 1);
      }
    }

    setOpacity(o) {
      this.material.opacity = o;
      this.mesh.visible = o > 0.01;
    }

    dispose() {
      this.mesh.geometry.dispose();
      this.material.dispose();
    }
  }

  G.DirectionalSprite = DirectionalSprite;
})(window.G = window.G || {});
