/* VLC Web — barra de menus e menus de contexto (com submenus, itens marcáveis e navegação por teclado) */
(function (VW) {
  'use strict';
  const U = VW.util;
  const el = U.el;

  class MenuSystem {
    /**
     * bar: elemento da barra de menus; defs: [{ id, label, items: () => [...] }]
     * Item: { label, action, shortcut (id de ação ou texto), checked, radio, disabled, submenu: () => [...], sep, icon, hint }
     */
    constructor(bar, defs, shortcutLabel) {
      this.bar = bar;
      this.defs = defs;
      this.shortcutLabel = shortcutLabel || (() => '');
      this.open = [];          // pilha de menus abertos
      this.activeTop = null;
      this.render();
      document.addEventListener('pointerdown', e => { if (!e.target.closest('.menu, .menubar')) this.closeAll(); }, true);
      window.addEventListener('blur', () => this.closeAll());
      window.addEventListener('resize', () => this.closeAll());
    }

    render() {
      this.bar.textContent = '';
      this.topButtons = {};
      for (const d of this.defs) {
        const b = el('button', { type: 'button', class: 'menubar-item', role: 'menuitem', 'aria-haspopup': 'true', dataset: { id: d.id } }, d.label);
        b.addEventListener('pointerdown', e => { e.preventDefault(); if (this.activeTop === d.id) this.closeAll(); else this.openTop(d.id); });
        b.addEventListener('pointerenter', () => { if (this.activeTop && this.activeTop !== d.id) this.openTop(d.id); });
        b.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); this.openTop(d.id, true); } });
        this.bar.appendChild(b);
        this.topButtons[d.id] = b;
      }
    }

    openTop(id, focusFirst) {
      this.closeAll();
      const d = this.defs.find(x => x.id === id);
      if (!d) return;
      const b = this.topButtons[id];
      const r = b.getBoundingClientRect();
      this.activeTop = id;
      b.classList.add('open');
      this.show(d.items(), r.left, r.bottom, 0, focusFirst);
    }

    /** Abre um menu de contexto na posição indicada */
    context(items, x, y) {
      this.closeAll();
      this.show(items, x, y, 0, false, true);
    }

    show(items, x, y, level, focusFirst, isContext) {
      while (this.open.length > level) this.open.pop().remove();
      const menu = el('div', { class: 'menu' + (isContext ? ' context' : ''), role: 'menu', tabindex: '-1' });
      menu.style.zIndex = 5000 + level;
      for (const it of items) {
        if (!it) continue;
        if (it.sep) { menu.appendChild(el('div', { class: 'menu-sep', role: 'separator' })); continue; }
        if (it.header) { menu.appendChild(el('div', { class: 'menu-header' }, it.header)); continue; }
        const sc = it.shortcut ? (this.shortcutLabel(it.shortcut) || (/[+A-Z]/.test(it.shortcut) && !/^[a-z-]+$/.test(it.shortcut) ? it.shortcut : '')) : '';
        const mark = it.checked !== undefined ? el('span', { class: 'menu-mark ' + (it.radio ? 'radio' : 'check') + (it.checked ? ' on' : '') }) : el('span', { class: 'menu-mark' }, it.icon ? U.icon(it.icon) : null);
        const node = el('div', {
          class: 'menu-item' + (it.disabled ? ' disabled' : '') + (it.submenu ? ' has-sub' : ''),
          role: it.checked !== undefined ? (it.radio ? 'menuitemradio' : 'menuitemcheckbox') : 'menuitem',
          'aria-checked': it.checked !== undefined ? String(!!it.checked) : null,
          'aria-disabled': it.disabled ? 'true' : null,
          tabindex: '-1', title: it.hint || null
        }, mark, el('span', { class: 'menu-label' }, it.label), el('span', { class: 'menu-shortcut' }, sc), it.submenu ? el('span', { class: 'menu-arrow' }, '▸') : null);
        node._item = it;
        node.addEventListener('pointerenter', () => {
          node.focus({ preventScroll: true });
          clearTimeout(this._subT);
          if (it.submenu && !it.disabled) this._subT = setTimeout(() => this.openSub(node, level), 120);
          else this._subT = setTimeout(() => { while (this.open.length > level + 1) this.open.pop().remove(); }, 200);
        });
        node.addEventListener('click', e => { e.stopPropagation(); this.activate(node, level); });
        menu.appendChild(node);
      }
      menu.addEventListener('keydown', e => this.onKey(e, menu, level));
      document.body.appendChild(menu);
      // posicionamento dentro da janela
      const r = menu.getBoundingClientRect();
      let px = x, py = y;
      if (px + r.width > window.innerWidth - 4) px = level > 0 ? x - r.width - (this._parentW || 0) : window.innerWidth - r.width - 4;
      if (py + r.height > window.innerHeight - 4) py = Math.max(4, window.innerHeight - r.height - 4);
      menu.style.left = Math.max(4, px) + 'px';
      menu.style.top = Math.max(4, py) + 'px';
      this.open.push(menu);
      if (focusFirst) { const f = menu.querySelector('.menu-item:not(.disabled)'); if (f) f.focus(); }
      else menu.focus({ preventScroll: true });
      return menu;
    }

    openSub(node, level) {
      const it = node._item;
      const r = node.getBoundingClientRect();
      this._parentW = r.width;
      let items = [];
      try { items = it.submenu(); } catch (e) { console.error(e); }
      if (!items.length) items = [{ label: '(vazio)', disabled: true }];
      this.show(items, r.right - 2, r.top - 4, level + 1);
      node.classList.add('sub-open');
    }

    activate(node, level) {
      const it = node._item;
      if (!it || it.disabled) return;
      if (it.submenu) { this.openSub(node, level); const m = this.open[level + 1]; const f = m && m.querySelector('.menu-item:not(.disabled)'); if (f) f.focus(); return; }
      this.closeAll();
      if (it.action) setTimeout(() => it.action(), 0);
    }

    onKey(e, menu, level) {
      const items = U.$$('.menu-item', menu).filter(n => !n.classList.contains('disabled'));
      const cur = items.indexOf(document.activeElement);
      e.stopPropagation();
      switch (e.key) {
        case 'ArrowDown': e.preventDefault(); (items[(cur + 1) % items.length] || items[0]).focus(); break;
        case 'ArrowUp': e.preventDefault(); (items[(cur - 1 + items.length) % items.length] || items[0]).focus(); break;
        case 'ArrowRight':
          e.preventDefault();
          if (cur >= 0 && items[cur]._item.submenu) this.activate(items[cur], level);
          else if (this.activeTop) this.moveTop(1);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (level > 0) { this.open.pop().remove(); const p = this.open[level - 1]; const s = p && p.querySelector('.sub-open'); if (s) { s.classList.remove('sub-open'); s.focus(); } }
          else if (this.activeTop) this.moveTop(-1);
          break;
        case 'Enter': case ' ': e.preventDefault(); if (cur >= 0) this.activate(items[cur], level); break;
        case 'Escape': e.preventDefault(); if (level > 0) { this.open.pop().remove(); } else { const t = this.activeTop; this.closeAll(); if (t) this.topButtons[t].focus(); } break;
        case 'Tab': e.preventDefault(); this.closeAll(); break;
        default:
          if (e.key.length === 1) {
            const ch = e.key.toLowerCase();
            const start = cur + 1;
            const found = items.slice(start).concat(items.slice(0, start)).find(n => n._item.label.toLowerCase().startsWith(ch));
            if (found) found.focus();
          }
      }
    }

    moveTop(dir) {
      const ids = this.defs.map(d => d.id);
      const i = ids.indexOf(this.activeTop);
      this.openTop(ids[(i + dir + ids.length) % ids.length], true);
    }

    closeAll() {
      clearTimeout(this._subT);
      while (this.open.length) this.open.pop().remove();
      if (this.activeTop && this.topButtons[this.activeTop]) this.topButtons[this.activeTop].classList.remove('open');
      this.activeTop = null;
    }

    get isOpen() { return this.open.length > 0; }
  }

  VW.ui = VW.ui || {};
  VW.ui.MenuSystem = MenuSystem;
})(window.VW = window.VW || {});
