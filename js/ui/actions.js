/* VLC Web — registro de ações e teclas de atalho configuráveis (Preferências → Teclas de atalho) */
(function (VW) {
  'use strict';
  const U = VW.util;

  const KEY_MAP = { ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', Escape: 'Esc', Delete: 'Del', ' ': 'Space', Spacebar: 'Space', MediaPlayPause: 'MediaPlayPause', MediaTrackNext: 'MediaNext', MediaTrackPrevious: 'MediaPrev', MediaStop: 'MediaStop', AudioVolumeUp: 'VolumeUp', AudioVolumeDown: 'VolumeDown', AudioVolumeMute: 'VolumeMute' };
  const KEY_LABELS = { Left: '←', Right: '→', Up: '↑', Down: '↓', Space: 'Espaço', Esc: 'Esc', Del: 'Del', PageUp: 'PgUp', PageDown: 'PgDn' };

  class Actions extends U.Emitter {
    constructor(settings) {
      super();
      this.settings = settings;
      this.map = new Map();
      this.order = [];
    }

    /** def: { label, run, keys: [...], category, global (funciona mesmo digitando) } */
    define(id, def) {
      if (!this.map.has(id)) this.order.push(id);
      this.map.set(id, Object.assign({ keys: [], category: 'Geral' }, def, { id }));
      this._index = null;
    }
    get(id) { return this.map.get(id); }
    run(id, ...args) {
      const a = this.map.get(id);
      if (!a) { console.warn('Ação desconhecida', id); return; }
      try { return a.run(...args); } catch (e) { console.error('Ação ' + id, e); VW.log && VW.log.error('ui', `Ação ${id}: ${e.message}`); }
    }
    list() { return this.order.map(id => this.map.get(id)); }

    keysFor(id) {
      const o = this.settings.get('hotkeys') || {};
      if (o[id]) return o[id];
      const a = this.map.get(id);
      return a ? a.keys : [];
    }
    setKeys(id, keys) {
      const o = Object.assign({}, this.settings.get('hotkeys'));
      o[id] = keys;
      this.settings.set('hotkeys', o);
      this._index = null;
      this.emit('keys');
    }
    resetKeys() { this.settings.set('hotkeys', {}); this._index = null; this.emit('keys'); }

    index() {
      if (this._index) return this._index;
      const idx = new Map();
      for (const id of this.order) for (const k of this.keysFor(id)) if (k && !idx.has(k)) idx.set(k, id);
      this._index = idx;
      return idx;
    }
    findByKey(combo) { return this.index().get(combo) || null; }

    static combo(e) {
      let k = KEY_MAP[e.key] || e.key;
      if (!k || ['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Dead', 'Unidentified', 'Process'].includes(k)) return null;
      let isLetter = false;
      if (e.altKey && /^Key[A-Z]$/.test(e.code)) { k = e.code.slice(3); isLetter = true; }
      else if (e.altKey && /^Digit\d$/.test(e.code)) k = e.code.slice(5);
      else if (k.length === 1) { const up = k.toUpperCase(); isLetter = up !== k.toLowerCase(); if (isLetter) k = up; }
      const mods = [];
      if (e.ctrlKey || e.metaKey) mods.push('Ctrl');
      if (e.altKey) mods.push('Alt');
      if (e.shiftKey && (isLetter || k.length > 1)) mods.push('Shift');
      return [...mods, k].join('+');
    }

    static label(combo) {
      if (!combo) return '';
      const parts = combo === '+' ? ['+'] : combo.endsWith('++') ? [...combo.slice(0, -2).split('+'), '+'] : combo.split('+');
      return parts.map(p => KEY_LABELS[p] || p).join('+');
    }

    shortcutLabel(id) { const k = this.keysFor(id)[0]; return Actions.label(k); }

    /** Trata keydown global; retorna true se consumiu. */
    handleKey(e) {
      const combo = Actions.combo(e);
      if (!combo) return false;
      const id = this.findByKey(combo);
      if (!id) return false;
      const a = this.map.get(id);
      if (U.isTyping(e) && !a.global) return false;
      e.preventDefault();
      e.stopPropagation();
      this.run(id);
      return true;
    }
  }

  VW.ui = VW.ui || {};
  VW.ui.Actions = Actions;
})(window.VW = window.VW || {});
