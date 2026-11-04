/* Entry point: shows loading progress, builds the game, starts the loop. */
(function (G) {
  'use strict';

  function webglAvailable() {
    try {
      const c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
    } catch (e) { return false; }
  }

  async function boot() {
    const loading = document.getElementById('loading');
    const stepEl = document.getElementById('load-step');
    if (typeof THREE === 'undefined') {
      stepEl.textContent = 'Three.js did not load. Check that lib/three.min.js is next to index.html, then reload.';
      return;
    }
    if (!webglAvailable()) {
      stepEl.textContent = 'This browser has WebGL turned off. Enable hardware acceleration and reload.';
      return;
    }
    try {
      if (document.fonts && document.fonts.load) {
        await Promise.race([document.fonts.load('600 20px Fredoka'), new Promise((r) => setTimeout(r, 1500))]);
      }
      const game = new G.Game(document.getElementById('game'), document.getElementById('overlay'));
      window.game = game; // handy for debugging from the console
      await game.init((label) => { stepEl.textContent = label + '…'; });
      game.renderBackdrop();
      loading.classList.add('done');
      setTimeout(() => loading.remove(), 900);
      let choice;
      if (await G.Online.detect()) {
        // Online: log in, then pick a character stored on the server.
        let slots = null;
        while (!slots) {
          if (!G.Online.token) await G.Auth.show();
          try { const r = await G.Online.api('/api/characters'); G.Online.username = r.username; slots = r.slots; }
          catch (e) { if (e.status === 401) G.Online.setToken(null); else throw e; }
        }
        choice = await G.Title.show(slots, { online: true });
      } else choice = await G.Title.show(G.SaveSystem.listSlots());
      game.begin(choice);
    } catch (err) {
      console.error(err);
      stepEl.textContent = 'The world failed to load (' + err.message + '). Reload the page to try again.';
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.G = window.G || {});
