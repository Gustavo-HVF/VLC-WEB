/* VLC Web — galeria de temas (skins) e estruturas de layout (Exibir → Tema → Galeria; Alt+K) */
(function (VW) {
  'use strict';
  const U = VW.util;
  const el = U.el;
  const { Win, F } = VW.ui;

  function gallery(app, tab = 'skins') {
    const ex = Win.get('skins');
    if (ex) { ex.tabs.select(tab); ex.focus(); return; }
    const S = app.settings, K = VW.skins;
    K.loadAllFonts();
    const w = new Win({ id: 'skins', title: 'Temas e layouts', width: 1020, icon: 'palette', className: 'skins-win' });

    /* ---------- Temas ---------- */
    let filter = 'all', query = '';
    const grid = el('div', { class: 'skin-grid', role: 'listbox', 'aria-label': 'Temas disponíveis' });
    const chips = el('div', { class: 'chips', role: 'toolbar', 'aria-label': 'Filtrar temas' });
    const renderChips = () => {
      chips.textContent = '';
      for (const [id, label] of [['all', 'Todos'], ...Object.entries(K.TAGS)]) {
        const n = id === 'all' ? K.SKINS.length : K.SKINS.filter(s => s.tags.includes(id)).length;
        chips.appendChild(el('button', { type: 'button', class: 'chip-btn' + (filter === id ? ' active' : ''), 'aria-pressed': String(filter === id), onclick: () => { filter = id; renderChips(); renderGrid(); } }, `${label} (${n})`));
      }
    };
    const search = F.text('', v => { query = v.trim().toLowerCase(); renderGrid(); }, { placeholder: 'Pesquisar tema…', type: 'search', 'aria-label': 'Pesquisar tema' });
    const autoChk = F.check('Automático: seguir o modo claro/escuro do sistema', S.get('skin') === 'auto', v => S.set('skin', v ? 'auto' : K.resolve('auto').id));

    const card = (mock, title, desc, tags, active, onPick) => {
      const c = el('button', { type: 'button', class: 'skin-card' + (active ? ' active' : ''), role: 'option', 'aria-selected': String(active), title: desc },
        mock,
        el('span', { class: 'skin-card-name' }, title, active ? el('span', { class: 'check', 'aria-hidden': 'true' }, '✓') : null),
        el('span', { class: 'skin-card-desc' }, desc),
        tags && tags.length ? el('span', { class: 'skin-card-tags' }, tags.map(t => el('span', {}, t))) : null);
      c.addEventListener('click', onPick);
      return c;
    };

    const renderGrid = () => {
      grid.textContent = '';
      const cur = S.get('skin');
      const effective = K.resolve(cur).id;
      for (const s of K.SKINS) {
        if (filter !== 'all' && !s.tags.includes(filter)) continue;
        if (query && !(s.name + ' ' + s.desc + ' ' + s.tags.map(t => K.TAGS[t]).join(' ')).toLowerCase().includes(query)) continue;
        const active = cur === 'auto' ? s.id === effective : cur === s.id;
        grid.appendChild(card(K.mock(s.id), s.name, s.desc, ['Layout: ' + K.LAYOUTS[s.layout].name].concat(s.tags.map(t => K.TAGS[t])), active, () => S.set('skin', s.id)));
      }
      if (!grid.children.length) grid.appendChild(el('p', { class: 'muted' }, 'Nenhum tema encontrado.'));
    };

    /* ---------- Estruturas de layout ---------- */
    const lgrid = el('div', { class: 'skin-grid layout-grid', role: 'listbox', 'aria-label': 'Estruturas de layout' });
    const renderLayouts = () => {
      lgrid.textContent = '';
      const skin = K.resolve(S.get('skin'));
      const cur = S.get('layout');
      const entries = [['auto', { name: 'Automático', desc: `Usa a estrutura sugerida pelo tema atual: ${K.LAYOUTS[skin.layout].name}.` }]].concat(Object.entries(K.LAYOUTS));
      for (const [id, l] of entries) {
        lgrid.appendChild(card(K.mock(skin.id, id === 'auto' ? skin.layout : id), l.name, l.desc, null, cur === id, () => S.set('layout', id)));
      }
    };

    const off = S.on('change', k => {
      if (!['skin', 'layout', 'accent', 'accentOverride'].includes(k)) return;
      renderGrid(); renderLayouts();
      autoChk.set(S.get('skin') === 'auto');
    });
    w.onDispose(off);
    renderChips(); renderGrid(); renderLayouts();

    const skinsTab = el('div', {}, el('div', { class: 'skins-toolbar' }, search, autoChk), chips, el('div', { style: { height: '10px' } }), grid);
    const layoutTab = el('div', {},
      F.hint('A estrutura define como os elementos ficam dispostos (menus, vídeo, lista de reprodução e controles) e pode ser combinada com qualquer tema. Atalho: <kbd>Alt+L</kbd> alterna entre as estruturas.'),
      lgrid);
    w.tabs = F.tabs([
      { id: 'skins', label: `Temas (${K.SKINS.length})`, content: skinsTab },
      { id: 'layouts', label: `Estruturas de layout (${Object.keys(K.LAYOUTS).length})`, content: layoutTab }
    ], tab);
    w.body.appendChild(w.tabs);

    const accentChk = F.check('Cor de destaque personalizada', S.get('accentOverride'), v => S.set('accentOverride', v));
    const accentCol = F.color(S.get('accent'), v => { S.set('accent', v); S.set('accentOverride', true); accentChk.set(true); });
    w.footer.append(
      el('div', { class: 'skins-accent' }, accentChk, accentCol),
      F.button('Surpreenda-me', () => {
        const cur = K.resolve(S.get('skin')).id;
        const pool = K.SKINS.filter(s => s.id !== cur);
        const s = pool[Math.floor(Math.random() * pool.length)];
        S.set('skin', s.id);
        app.controls.osd('Tema: ' + s.name);
      }, '', { title: 'Escolhe um tema aleatório' }),
      el('span', { class: 'grow' }),
      F.button('Restaurar padrão', () => { S.set('skin', 'default'); S.set('layout', 'auto'); S.set('accentOverride', false); }),
      F.button('Fechar', () => w.close(), 'primary'));
    w.show();
  }

  VW.dialogsSkins = { gallery };
})(window.VW = window.VW || {});
