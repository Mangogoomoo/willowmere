/* Entity: shared behaviour for anything that walks around as a sprite. */
(function (G) {
  'use strict';
  const U = G.Utils, TR = G.Terrain;
  const _n = new THREE.Vector3(), _up = new THREE.Vector3(0, 0, 1);

  class Entity {
    constructor(game, sheet, opts) {
      opts = opts || {};
      this.game = game;
      this.position = new THREE.Vector3();
      this.facing = 0;
      this.targetFacing = 0;
      this.sprite = new G.DirectionalSprite(sheet, { scale: opts.scale || 1, depthBias: opts.depthBias, silhouette: opts.silhouette });
      game.scene.add(this.sprite.mesh);
      if (this.sprite.ghost) game.scene.add(this.sprite.ghost);
      this.shadow = game.effects.makeShadow(opts.shadowSize || 1);
      this.path = null;
      this.pathIdx = 0;
      this.alive = true;
      this.radius = opts.radius || 0.45;
      this.moving = false;
    }

    setPosition(x, z) {
      this.position.set(x, TR.surfaceHeight(x, z), z);
    }

    setPath(points) {
      this.path = points && points.length ? points : null;
      this.pathIdx = 0;
    }
    clearPath() { this.path = null; }

    faceTowards(x, z) {
      const dx = x - this.position.x, dz = z - this.position.z;
      if (dx * dx + dz * dz > 1e-6) this.targetFacing = Math.atan2(dx, dz);
    }

    /* Advance along the current path. Returns true while moving. A final
       collision check stops the entity from stepping into blocked cells. */
    followPath(dt, speed, stopDist) {
      if (!this.path) return false;
      let remaining = speed * dt;
      const nav = this.game.nav;
      while (remaining > 0 && this.path) {
        const wp = this.path[this.pathIdx];
        const last = this.pathIdx === this.path.length - 1;
        const dx = wp.x - this.position.x, dz = wp.z - this.position.z;
        const d = Math.hypot(dx, dz);
        const stop = last ? (stopDist || 0) : 0;
        if (d <= stop + 1e-3 || d < 0.02) {
          if (last) { this.path = null; break; }
          this.pathIdx++;
          continue;
        }
        const step = Math.min(remaining, d - stop);
        const nx = this.position.x + (dx / d) * step, nz = this.position.z + (dz / d) * step;
        this.targetFacing = Math.atan2(dx, dz);
        if (nav.walkable(nx, nz) || !nav.walkable(this.position.x, this.position.z)) {
          this.position.x = nx; this.position.z = nz;
        } else if (nav.walkable(nx, this.position.z)) {
          this.position.x = nx;
        } else if (nav.walkable(this.position.x, nz)) {
          this.position.z = nz;
        } else { this.path = null; break; }
        remaining -= step;
        if (step < d - stop) break;
      }
      this.position.y = TR.surfaceHeight(this.position.x, this.position.z);
      return !!this.path || remaining < speed * dt - 1e-4;
    }

    syncVisuals(dt, camPos) {
      this.facing = U.dampAngle(this.facing, this.targetFacing, 18, dt);
      const m = this.sprite.mesh;
      m.position.copy(this.position);
      // The sprite shows this world facing as seen from the camera.
      this.sprite.update(dt, this.facing, camPos, this.moving);
      const s = this.shadow;
      s.position.set(this.position.x, this.position.y + 0.04, this.position.z);
      TR.normalAt(this.position.x, this.position.z, _n);
      s.quaternion.setFromUnitVectors(_up, _n);
    }

    // Remove from the scene when its map is unloaded.
    dispose() {
      this.game.scene.remove(this.sprite.mesh);
      if (this.sprite.ghost) this.game.scene.remove(this.sprite.ghost);
      this.game.scene.remove(this.shadow);
      this.sprite.dispose();
    }

    distanceTo(other) {
      return Math.hypot(other.position.x - this.position.x, other.position.z - this.position.z);
    }
  }

  G.Entity = Entity;
})(window.G = window.G || {});
