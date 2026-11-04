/* Key bindings: every rebindable action with a primary and a secondary key.
   Keys are stored as combos like "Alt+A", "F1", "K" in the preferences.
   Esc (close / cancel) and Shift (compare gear) are fixed. */
(function (G) {
  'use strict';

  const ACTIONS = [];
  for (let i = 1; i <= 9; i++) ACTIONS.push({ id: 'hot' + i, label: `Hotbar slot ${i}`, def: ['F' + i, String(i)] });
  ACTIONS.push(
    { id: 'status', label: 'Status window', def: ['Alt+A', 'C'] },
    { id: 'inventory', label: 'Inventory', def: ['Alt+E', 'I'] },
    { id: 'equipment', label: 'Equipment', def: ['Alt+Q', 'Q'] },
    { id: 'skills', label: 'Skills', def: ['Alt+S', 'K'] },
    { id: 'quests', label: 'Quest log', def: ['Alt+U', 'U'] },
    { id: 'worldmap', label: 'World map', def: ['Alt+M', 'M'] },
    { id: 'options', label: 'Options', def: ['O', ''] },
    { id: 'cart', label: 'Cart (merchant classes)', def: ['Alt+W', ''] },
    { id: 'autoloot', label: 'Toggle auto-loot', def: ['L', ''] },
    { id: 'help', label: 'Show / hide controls', def: ['H', ''] },
    { id: 'debug', label: 'Show / hide debug tools', def: ['`', ''] },
    { id: 'camReset', label: 'Reset camera', def: ['Home', ''] },
  );

  const CODE_NAMES = { Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Space: 'Space' };

  // Physical key -> name (uses e.code so Alt combos work on every layout).
  function keyName(e) {
    const c = e.code || '';
    if (/^Key[A-Z]$/.test(c)) return c.slice(3);
    if (/^Digit[0-9]$/.test(c)) return c.slice(5);
    if (/^Numpad[0-9]$/.test(c)) return 'Num' + c.slice(6);
    if (/^F[0-9]{1,2}$/.test(c)) return c;
    if (CODE_NAMES[c]) return CODE_NAMES[c];
    if (['Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete', 'Tab', 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(c)) return c;
    return null;
  }
  function comboFromEvent(e) {
    const k = keyName(e);
    if (!k) return null;
    return (e.ctrlKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + k;
  }

  const Keybinds = {
    ACTIONS,
    map: {},
    load() {
      const saved = G.SaveSystem.prefs().keys || {};
      for (const a of ACTIONS) Keybinds.map[a.id] = (saved[a.id] || a.def).slice(0, 2);
    },
    save() { G.SaveSystem.setPrefs({ keys: Keybinds.map }); },
    reset() { for (const a of ACTIONS) Keybinds.map[a.id] = a.def.slice(); Keybinds.save(); },
    comboFromEvent,
    // Bind a combo to an action slot; clears it from anything else first.
    set(actionId, slot, combo) {
      let stolen = null;
      if (combo) for (const id in Keybinds.map) Keybinds.map[id] = Keybinds.map[id].map((k) => { if (k === combo && !(id === actionId)) { stolen = id; return ''; } return k; });
      Keybinds.map[actionId][slot] = combo || '';
      Keybinds.save();
      return stolen;
    },
    match(e) {
      const combo = comboFromEvent(e);
      if (!combo) return null;
      for (const id in Keybinds.map) if (Keybinds.map[id].includes(combo)) return id;
      return null;
    },
    label(actionId) { return Keybinds.map[actionId].filter(Boolean).join(' or ') || 'unbound'; },
    primary(actionId) { return Keybinds.map[actionId].find(Boolean) || ''; },
    actionLabel(id) { return ACTIONS.find((a) => a.id === id).label; },
  };
  Keybinds.load();
  G.Keybinds = Keybinds;
})(window.G = window.G || {});
