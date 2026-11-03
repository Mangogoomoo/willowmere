/* CameraController: a free-orbit third-person camera. Full 360-degree yaw,
   elevation from near-ground to bird's-eye, smooth zoom and smooth follow.

   There is deliberately NO collision with the environment: the camera keeps
   the distance you chose and passes straight through trees, rocks, houses,
   fences and props. The only rule is that it never goes below the ground. */
(function (G) {
  'use strict';
  const U = G.Utils, TR = G.Terrain;
  const _dir = new THREE.Vector3();

  class CameraController {
    constructor(camera) {
      const c = G.Config.CAMERA;
      this.cfg = c;
      this.camera = camera;
      this.yaw = this.yawT = c.defaultYaw;
      this.pitch = this.pitchT = c.defaultPitch;
      this.dist = this.distT = c.defaultDist;
      this.focus = new THREE.Vector3();
      this.settings = Object.assign({ rotSens: 1, pitchSens: 1, zoomSens: 1, invertY: false }, G.SaveSystem.prefs().camera || {});
    }

    rotate(dx, dy) {
      const s = this.settings;
      this.yawT -= dx * this.cfg.rotSens * s.rotSens;
      this.pitchT = U.clamp(this.pitchT + dy * this.cfg.pitchSens * s.pitchSens * (s.invertY ? -1 : 1), this.cfg.minPitch, this.cfg.maxPitch);
    }

    zoom(deltaY) {
      this.distT = U.clamp(this.distT * Math.exp(deltaY * this.cfg.zoomSens * this.settings.zoomSens), this.cfg.minDist, this.cfg.maxDist);
    }

    reset() {
      // Keep the current heading but restore the default elevation and zoom.
      this.pitchT = this.cfg.defaultPitch;
      this.distT = this.cfg.defaultDist;
    }

    saveSettings() { G.SaveSystem.setPrefs({ camera: this.settings }); }

    snapTo(p) {
      this.focus.set(p.x, p.y + this.cfg.focusHeight, p.z);
    }

    // Actual camera distance (always the chosen zoom - nothing shortens it).
    get effDist() { return this.dist; }

    update(dt, target) {
      const c = this.cfg;
      this.yaw = U.dampAngle(this.yaw, this.yawT, 18, dt);
      this.pitch = U.damp(this.pitch, this.pitchT, 18, dt);
      this.dist = U.damp(this.dist, this.distT, 10, dt);

      this.focus.x = U.damp(this.focus.x, target.x, 10, dt);
      this.focus.z = U.damp(this.focus.z, target.z, 10, dt);
      this.focus.y = U.damp(this.focus.y, target.y + c.focusHeight, 8, dt);

      const cp = Math.cos(this.pitch);
      _dir.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);

      const cam = this.camera;
      cam.position.copy(this.focus).addScaledVector(_dir, this.dist);
      // Ground floor only: keep the lens above the terrain surface.
      const floor = TR.surfaceHeight(cam.position.x, cam.position.z) + 0.4;
      if (cam.position.y < floor) cam.position.y = floor;
      cam.lookAt(this.focus);
    }
  }

  G.CameraController = CameraController;
})(window.G = window.G || {});
