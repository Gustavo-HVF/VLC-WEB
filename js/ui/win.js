/* VLC Web — janelas flutuantes (diálogos) e componentes de formulário */
(function (VW) {
  'use strict';
  const U = VW.util;
  const el = U.el;

  const registry = new Map();
  let zTop = 100;

  class Win {
    /**
     * opts: id, title, width, height, modal, className, onClose, icon
     */
    constructor(opts) {
      this.opts = opts;
      this.id = opts.id || U.uid('win');
      this.title = el('span', { class: 'win-title-text', text: opts.title || '' });
      this.closeBtn = el('button', { class: 'win-close', type: 'button', title: 'Fechar (Esc)', 'aria-label': 'Fechar' }, U.icon('close'));
      this.header = el('header', { class: 'win-title' }, opts.icon ? U.icon(opts.icon, 'win-icon') : null, this.title, this.closeBtn);
      this.body = el('div', { class: 'win-body' });
      this.footer = el('footer', { class: 'win-footer' });
      this.el = el('section', { class: 'win ' + (opts.className || ''), role: 'dialog', 'aria-modal': opts.modal ? 'true' : 'false', 'aria-label': opts.title || '', tabindex: '-1' }, this.header, this.body, this.footer);
      if (opts.width) this.el.style.width = typeof opts.width === 'number' ? opts.width + 'px' : opts.width;
      if (opts.height) this.el.style.height = typeof opts.height === 'number' ? opts.height + 'px' : opts.height;
      this.backdrop = opts.modal ? el('div', { class: 'win-backdrop' }) : null;
      this.closeBtn.addEventListener('click', () => this.close());
      this.el.addEventListener('pointerdown', () => this.focus(), true);
      this.el.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); this.close(); }
        else if (e.key === 'Tab' && opts.modal) this.trapTab(e);
        e.stopPropagation();
      });
      this.makeDraggable();
    }

    static open(id, factory) {
      const ex = registry.get(id);
      if (ex) { ex.focus(); if (ex.onReopen) ex.onReopen(); return ex; }
      const w = factory();
      w.id = id;
      registry.set(id, w);
      w.show();
      return w;
    }
    static get(id) { return registry.get(id) || null; }
    static closeAll() { for (const w of [...registry.values()]) w.close(); }
    static topmost() { let top = null; for (const w of registry.values()) if (!top || +w.el.style.zIndex > +top.el.style.zIndex) top = w; return top; }

    setTitle(t) { this.title.textContent = t; }

    show() {
      const host = document.getElementById('windows');
      if (this.backdrop) host.appendChild(this.backdrop);
      host.appendChild(this.el);
      if (!registry.has(this.id)) registry.set(this.id, this);
      this.focus();
      requestAnimationFrame(() => {
        const r = this.el.getBoundingClientRect();
        const saved = U.store.get('winpos:' + this.id, null);
        let x = (window.innerWidth - r.width) / 2, y = Math.max(16, (window.innerHeight - r.height) / 2.4);
        if (saved && !this.opts.modal) { x = saved.x; y = saved.y; }
        this.moveTo(x, y);
        const f = this.el.querySelector('[autofocus]') || this.el.querySelector('input:not([type=hidden]),select,textarea,button:not(.win-close)');
        if (f && this.opts.modal) f.focus(); else this.el.focus({ preventScroll: true });
      });
    }

    moveTo(x, y) {
      const r = this.el.getBoundingClientRect();
      x = U.clamp(x, 0, Math.max(0, window.innerWidth - Math.min(r.width, window.innerWidth)));
      y = U.clamp(y, 0, Math.max(0, window.innerHeight - 40));
      this.el.style.left = x + 'px';
      this.el.style.top = y + 'px';
    }

    focus() {
      this.el.style.zIndex = ++zTop;
      if (this.backdrop) this.backdrop.style.zIndex = zTop - 1 + '';
    }

    close() {
      if (this.opts.onClose && this.opts.onClose(this) === false) return;
      this.el.remove();
      if (this.backdrop) this.backdrop.remove();
      registry.delete(this.id);
      if (this.cleanup) this.cleanup.forEach(f => { try { f(); } catch (e) { /* ok */ } });
      const top = Win.topmost();
      if (top) top.focus(); else document.getElementById('app').focus({ preventScroll: true });
    }

    /** Registra função de limpeza (ex.: remover listeners) */
    onDispose(fn) { (this.cleanup = this.cleanup || []).push(fn); }

    trapTab(e) {
      const f = U.$$('input,select,textarea,button,[tabindex]:not([tabindex="-1"])', this.el).filter(n => !n.disabled && n.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

    makeDraggable() {
      let d = null;
      this.header.addEventListener('pointerdown', e => {
        if (e.target.closest('button')) return;
        const r = this.el.getBoundingClientRect();
        d = { dx: e.clientX - r.left, dy: e.clientY - r.top };
        this.header.setPointerCapture(e.pointerId);
      });
      this.header.addEventListener('pointermove', e => { if (d) this.moveTo(e.clientX - d.dx, e.clientY - d.dy); });
      const end = () => {
        if (!d) return;
        d = null;
        const r = this.el.getBoundingClientRect();
        if (!this.opts.modal) U.store.set('winpos:' + this.id, { x: r.left, y: r.top });
      };
      this.header.addEventListener('pointerup', end);
      this.header.addEventListener('pointercancel', end);
    }
  }

  /* ======================= Componentes de formulário ======================= */
  const F = {};

  F.button = (label, onClick, cls, attrs) => el('button', Object.assign({ type: 'button', class: 'btn ' + (cls || ''), onclick: onClick }, attrs || {}), label);

  F.row = (label, ...controls) => el('div', { class: 'f-row' }, label ? el('span', { class: 'f-label' }, label) : null, el('div', { class: 'f-ctrl' }, controls));

  F.group = (title, ...children) => el('fieldset', { class: 'f-group' }, title ? el('legend', {}, title) : null, children);

  F.hint = (text, cls) => el('p', { class: 'f-hint ' + (cls || '') , html: text });

  F.check = (label, checked, onChange, attrs) => {
    const input = el('input', Object.assign({ type: 'checkbox' }, attrs || {}));
    input.checked = !!checked;
    input.addEventListener('change', () => onChange && onChange(input.checked));
    const node = el('label', { class: 'f-check' }, input, el('span', {}, label));
    node.input = input;
    node.set = v => { input.checked = !!v; };
    return node;
  };

  F.radio = (name, options, value, onChange) => {
    const wrap = el('div', { class: 'f-radios' });
    for (const [val, label] of options) {
      const input = el('input', { type: 'radio', name, value: val });
      input.checked = val === value;
      input.addEventListener('change', () => input.checked && onChange && onChange(val));
      wrap.appendChild(el('label', { class: 'f-check' }, input, el('span', {}, label)));
    }
    wrap.set = v => { U.$$('input', wrap).forEach(i => { i.checked = i.value === v; }); };
    return wrap;
  };

  F.select = (options, value, onChange, attrs) => {
    const s = el('select', Object.assign({ class: 'f-select' }, attrs || {}));
    F.setOptions(s, options, value);
    s.addEventListener('change', () => onChange && onChange(s.value));
    return s;
  };
  F.setOptions = (s, options, value) => {
    s.textContent = '';
    for (const o of options) {
      const [val, label] = Array.isArray(o) ? o : [o, o];
      const opt = el('option', { value: val }, label);
      if (String(val) === String(value)) opt.selected = true;
      s.appendChild(opt);
    }
  };

  F.text = (value, onChange, attrs) => {
    const i = el('input', Object.assign({ type: 'text', class: 'f-text', value: value ?? '' }, attrs || {}));
    i.value = value ?? '';
    i.addEventListener('input', () => onChange && onChange(i.value));
    return i;
  };

  F.number = (value, onChange, attrs) => {
    const i = el('input', Object.assign({ type: 'number', class: 'f-number' }, attrs || {}));
    i.value = value;
    i.addEventListener('input', () => { const v = parseFloat(i.value); if (isFinite(v)) onChange && onChange(v); });
    return i;
  };

  F.color = (value, onChange) => {
    const i = el('input', { type: 'color', class: 'f-color' });
    i.value = value;
    i.addEventListener('input', () => onChange && onChange(i.value));
    return i;
  };

  /**
   * Controle deslizante com rótulo de valor.
   * opts: min, max, step, value, format(v), onInput(v), vertical, label
   */
  F.slider = (opts) => {
    const input = el('input', { type: 'range', min: opts.min, max: opts.max, step: opts.step || 'any', class: 'f-range' + (opts.vertical ? ' vertical' : ''), 'aria-label': opts.label || '' });
    input.value = opts.value;
    const fmt = opts.format || (v => String(v));
    const out = el('output', { class: 'f-out' }, fmt(+opts.value));
    input.addEventListener('input', () => { out.textContent = fmt(+input.value); opts.onInput && opts.onInput(+input.value); });
    input.addEventListener('dblclick', () => { if (opts.reset !== undefined) { input.value = opts.reset; input.dispatchEvent(new Event('input')); } });
    const node = el('div', { class: 'f-slider' + (opts.vertical ? ' vertical' : '') }, opts.vertical ? [out, input] : [input, out]);
    if (opts.vertical && opts.label) node.appendChild(el('span', { class: 'f-slider-label' }, opts.label));
    node.input = input;
    node.set = v => { input.value = v; out.textContent = fmt(+v); };
    node.disable = d => { input.disabled = d; node.classList.toggle('disabled', d); };
    return node;
  };

  /** Abas. tabs: [{id, label, content (Node) | render() }] */
  F.tabs = (tabs, active, cls) => {
    const head = el('div', { class: 'tabs-head', role: 'tablist' });
    const body = el('div', { class: 'tabs-body' });
    const node = el('div', { class: 'tabs ' + (cls || '') }, head, body);
    const panes = {};
    const select = id => {
      for (const t of tabs) {
        const on = t.id === id;
        t.btn.classList.toggle('active', on);
        t.btn.setAttribute('aria-selected', on);
        if (on && !panes[t.id]) { panes[t.id] = el('div', { class: 'tab-pane', role: 'tabpanel' }, t.content || t.render()); body.appendChild(panes[t.id]); }
        if (panes[t.id]) panes[t.id].hidden = !on;
      }
      node.active = id;
      node.onSelect && node.onSelect(id);
    };
    for (const t of tabs) {
      t.btn = el('button', { type: 'button', class: 'tab-btn', role: 'tab', onclick: () => select(t.id) }, t.label);
      head.appendChild(t.btn);
    }
    node.select = select;
    node.panes = panes;
    select(active || tabs[0].id);
    return node;
  };

  /** Barra de progresso */
  F.progress = () => {
    const bar = el('div', { class: 'f-progress-bar' });
    const node = el('div', { class: 'f-progress' }, bar);
    node.set = p => { node.classList.toggle('indeterminate', p < 0); bar.style.width = (p < 0 ? 30 : U.clamp(p, 0, 1) * 100) + '%'; };
    node.set(0);
    return node;
  };

  /** Caixa de mensagem simples (alerta/confirmação). Retorna Promise<boolean|string> */
  F.message = (title, html, buttons = [['ok', 'OK']], opts = {}) => new Promise(resolve => {
    const w = new Win({ title, modal: true, width: opts.width || 460, className: 'msgbox ' + (opts.cls || ''), icon: opts.icon, onClose: () => { resolve(null); } });
    w.body.appendChild(el('div', { class: 'msg-text', html }));
    if (opts.extra) w.body.appendChild(opts.extra);
    buttons.forEach(([val, label, cls], i) => {
      w.footer.appendChild(F.button(label, () => { w.opts.onClose = null; w.close(); resolve(val); }, (cls || (i === 0 ? 'primary' : '')), i === 0 ? { autofocus: true } : null));
    });
    w.show();
  });

  F.prompt = (title, label, value = '', placeholder = '') => new Promise(resolve => {
    const input = F.text(value, null, { placeholder, autofocus: true });
    const w = new Win({ title, modal: true, width: 480, onClose: () => resolve(null) });
    w.body.appendChild(F.row(label, input));
    const ok = () => { w.opts.onClose = null; w.close(); resolve(input.value); };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
    w.footer.append(F.button('OK', ok, 'primary'), F.button('Cancelar', () => w.close()));
    w.show();
  });

  VW.ui = VW.ui || {};
  VW.ui.Win = Win;
  VW.ui.F = F;
})(window.VW = window.VW || {});
