/* VLC Web — painel da lista de reprodução e navegador de mídia
 * (Lista de reprodução, Biblioteca de mídia, Meu computador, Rádios da Internet e Podcasts) */
(function (VW) {
  'use strict';
  const U = VW.util;
  const el = U.el;

  const COLUMNS = {
    title: { label: 'Título', get: i => i.displayTitle },
    duration: { label: 'Duração', get: i => U.fmtTime(i.duration), cls: 'num' },
    artist: { label: 'Artista', get: i => i.meta.artist || '' },
    album: { label: 'Álbum', get: i => i.meta.album || '' },
    genre: { label: 'Gênero', get: i => i.meta.genre || '' },
    track: { label: 'Faixa', get: i => i.meta.track || '', cls: 'num' },
    date: { label: 'Data', get: i => i.meta.date || '' },
    uri: { label: 'URI', get: i => i.uri }
  };

  const VIEWS = [
    { id: 'playlist', label: 'Lista', icon: 'playlist', title: 'Lista de reprodução' },
    { id: 'library', label: 'Biblioteca', icon: 'library', title: 'Biblioteca de mídia' },
    { id: 'computer', label: 'Computador', icon: 'folder', title: 'Meu computador (pastas)' },
    { id: 'radio', label: 'Rádios', icon: 'radio', title: 'Rádios da Internet' },
    { id: 'podcasts', label: 'Podcasts', icon: 'podcast', title: 'Podcasts' }
  ];

  class PlaylistView {
    constructor(app) {
      this.app = app;
      this.p = app.player;
      this.pl = this.p.playlist;
      this.settings = app.settings;
      this.panel = U.$('#playlist-panel');
      this.list = U.$('#pl-list');
      this.search = U.$('#pl-search');
      this.foot = U.$('#pl-foot');
      this.tabs = U.$('#pl-tabs');
      this.view = 'playlist';
      this.sel = new Set();
      this.anchor = null;
      this.sortState = {};
      this.computerPath = [];
      this.radioCache = null;
      this.buildTabs();
      this.bind();
      this.applyVisibility();
      this.render();
    }

    buildTabs() {
      for (const v of VIEWS) {
        const b = el('button', { type: 'button', class: 'pl-tab', title: v.title, dataset: { view: v.id } }, U.icon(v.icon), el('span', {}, v.label));
        b.addEventListener('click', () => this.setView(v.id));
        this.tabs.appendChild(b);
      }
    }

    setView(id) {
      this.view = id;
      this.sel.clear();
      this.search.value = '';
      this.search.placeholder = id === 'radio' ? 'Buscar rádios (nome)…' : id === 'playlist' ? 'Pesquisar na lista…' : 'Filtrar…';
      for (const b of U.$$('.pl-tab', this.tabs)) b.classList.toggle('active', b.dataset.view === id);
      if (id === 'radio' && !this.radioCache) this.loadRadios('');
      this.render();
    }

    bind() {
      this.pl.on('change', () => { if (this.view === 'playlist') this.render(); });
      this.pl.on('current', () => this.highlight());
      this.p.on('item', () => this.highlight());
      this.p.on('meta', U.throttle(() => { if (this.view === 'playlist') this.render(); }, 500));
      this.p.on('modes', () => this.renderFoot());
      this.app.library.on('change', () => { if (this.view !== 'playlist') this.render(); });
      this.settings.on('change:playlistVisible', () => this.applyVisibility());
      this.settings.on('change:playlistDocked', () => this.applyVisibility());
      this.settings.on('change:playlistColumns', () => this.render());
      this.search.addEventListener('input', U.debounce(() => {
        if (this.view === 'radio') this.loadRadios(this.search.value.trim());
        else this.render();
      }, 250));
      this.search.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { this.search.value = ''; this.render(); } });
      this.list.addEventListener('keydown', e => this.onKey(e));
      // soltar arquivos do sistema na lista
      this.list.addEventListener('dragover', e => {
        if (this.view !== 'playlist') return;
        e.preventDefault();
        const row = e.target.closest('.pl-row');
        U.$$('.drop-before', this.list).forEach(r => r.classList.remove('drop-before'));
        if (row) row.classList.add('drop-before');
        e.dataTransfer.dropEffect = this.dragIds ? 'move' : 'copy';
      });
      this.list.addEventListener('dragleave', e => { if (!this.list.contains(e.relatedTarget)) U.$$('.drop-before', this.list).forEach(r => r.classList.remove('drop-before')); });
      this.list.addEventListener('drop', async e => {
        if (this.view !== 'playlist') return;
        e.preventDefault(); e.stopPropagation();
        U.$$('.drop-before', this.list).forEach(r => r.classList.remove('drop-before'));
        const row = e.target.closest('.pl-row');
        const at = row ? this.pl.indexOf(row.dataset.id) : this.pl.items.length;
        if (this.dragIds) { this.pl.move(this.dragIds, at); this.dragIds = null; return; }
        const files = await U.readDropEntries(e.dataTransfer);
        if (files.length) this.app.openFiles(files, { play: false, at });
        else { const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain'); if (url) this.app.openURL(url.trim(), { play: false }); }
      });
      // redimensionamento
      const rz = U.$('#pl-resizer');
      let start = null;
      rz.addEventListener('pointerdown', e => { start = { x: e.clientX, w: this.panel.getBoundingClientRect().width }; rz.setPointerCapture(e.pointerId); document.body.classList.add('resizing'); });
      rz.addEventListener('pointermove', e => {
        if (!start) return;
        const dir = document.documentElement.classList.contains('lay-left') ? -1 : 1; // lista à esquerda: arrasta para a direita
        const w = U.clamp(start.w - dir * (e.clientX - start.x), 240, window.innerWidth * 0.8);
        this.panel.style.width = w + 'px';
      });
      rz.addEventListener('pointerup', () => { if (!start) return; start = null; document.body.classList.remove('resizing'); this.settings.set('playlistWidth', Math.round(this.panel.getBoundingClientRect().width)); this.updateWidthVar(); this.p.renderer.layout(); });
      // janela flutuante (lista desencaixada)
      const head = U.$('#pl-head');
      let drag = null;
      head.addEventListener('pointerdown', e => {
        if (this.settings.get('playlistDocked') || e.target.closest('button, input')) return;
        const r = this.panel.getBoundingClientRect();
        drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
        head.setPointerCapture(e.pointerId);
      });
      head.addEventListener('pointermove', e => { if (drag) { this.panel.style.left = (e.clientX - drag.dx) + 'px'; this.panel.style.top = (e.clientY - drag.dy) + 'px'; } });
      head.addEventListener('pointerup', () => { drag = null; });
      U.$('#pl-close').addEventListener('click', () => this.settings.set('playlistVisible', false));
      U.$('#pl-dock').addEventListener('click', () => this.settings.set('playlistDocked', !this.settings.get('playlistDocked')));
    }

    applyVisibility() {
      const vis = this.settings.get('playlistVisible'), docked = this.settings.get('playlistDocked');
      this.panel.hidden = !vis;
      this.panel.classList.toggle('floating', !docked);
      this.panel.style.width = this.settings.get('playlistWidth') + 'px';
      if (docked) { this.panel.style.left = ''; this.panel.style.top = ''; }
      U.$('#pl-dock').title = docked ? 'Desencaixar (janela flutuante)' : 'Encaixar na janela principal';
      this.updateWidthVar();
      setTimeout(() => this.p.renderer.layout(), 0);
      if (vis) setTimeout(() => this.scrollToCurrent(), 30);
    }

    /** Largura ocupada pela lista encaixada (usada para centralizar os controles no layout "Cinema"). */
    updateWidthVar() {
      const on = this.settings.get('playlistVisible') && this.settings.get('playlistDocked');
      U.$('#app').style.setProperty('--pl-w', on ? this.settings.get('playlistWidth') + 'px' : '0px');
    }

    /* ======================= renderização ======================= */
    render() {
      for (const b of U.$$('.pl-tab', this.tabs)) b.classList.toggle('active', b.dataset.view === this.view);
      this.list.textContent = '';
      this.list.className = 'pl-list view-' + this.view;
      switch (this.view) {
        case 'playlist': this.renderPlaylist(); break;
        case 'library': this.renderLibrary(); break;
        case 'computer': this.renderComputer(); break;
        case 'radio': this.renderRadios(); break;
        case 'podcasts': this.renderPodcasts(); break;
      }
      this.renderFoot();
    }

    filterText() { return this.search.value.trim().toLowerCase(); }

    renderPlaylist() {
      const cols = this.settings.get('playlistColumns').filter(c => COLUMNS[c]);
      this.list.style.setProperty('--cols', cols.map(c => c === 'title' ? 'minmax(120px,3fr)' : c === 'duration' || c === 'track' ? '64px' : 'minmax(60px,1.4fr)').join(' '));
      const head = el('div', { class: 'pl-row pl-header', role: 'row' });
      for (const c of cols) {
        const h = el('span', { class: 'pl-cell ' + (COLUMNS[c].cls || ''), role: 'columnheader', title: 'Ordenar por ' + COLUMNS[c].label.toLowerCase() }, COLUMNS[c].label, this.sortState[c] ? (this.sortState[c] > 0 ? ' ▲' : ' ▼') : '');
        h.addEventListener('click', () => { const d = this.sortState[c] === 1 ? -1 : 1; this.sortState = { [c]: d }; this.pl.sort(c, d); });
        head.appendChild(h);
      }
      head.addEventListener('contextmenu', e => {
        e.preventDefault(); e.stopPropagation();
        this.app.menu.context(Object.keys(COLUMNS).map(c => ({
          label: COLUMNS[c].label, checked: cols.includes(c), disabled: c === 'title',
          action: () => { const cur = this.settings.get('playlistColumns'); this.settings.set('playlistColumns', cur.includes(c) ? cur.filter(x => x !== c) : Object.keys(COLUMNS).filter(x => cur.includes(x) || x === c)); }
        })), e.clientX, e.clientY);
      });
      this.list.appendChild(head);
      const q = this.filterText();
      const frag = document.createDocumentFragment();
      const cur = this.pl.current;
      this.pl.items.forEach((it, i) => {
        if (q && !(`${it.displayTitle} ${it.meta.artist || ''} ${it.meta.album || ''} ${it.uri}`.toLowerCase().includes(q))) return;
        const row = el('div', { class: 'pl-row' + (it === cur ? ' current' : '') + (this.sel.has(it.id) ? ' selected' : '') + (it.missing ? ' missing' : ''), role: 'row', draggable: 'true', dataset: { id: it.id }, title: it.uri });
        cols.forEach((c, k) => {
          const cell = el('span', { class: 'pl-cell ' + (COLUMNS[c].cls || '') }, k === 0 ? el('span', { class: 'pl-ico' }, U.icon(it === cur ? 'play' : it.stream ? 'capture' : it.kind === 'audio' ? 'music' : it.kind === 'image' ? 'image' : it.url ? 'network' : 'film')) : null, COLUMNS[c].get(it));
          row.appendChild(cell);
        });
        frag.appendChild(row);
      });
      this.list.appendChild(frag);
      if (!this.pl.items.length) this.list.appendChild(this.empty('A lista de reprodução está vazia.', 'Arraste arquivos ou pastas para cá, ou use os botões abaixo.'));
      this.bindRows();
    }

    empty(title, sub) { return el('div', { class: 'pl-empty' }, U.icon('playlist', 'big'), el('strong', {}, title), el('span', {}, sub)); }

    bindRows() {
      for (const row of U.$$('.pl-row:not(.pl-header)', this.list)) {
        row.addEventListener('click', e => this.select(row.dataset.id, e));
        row.addEventListener('dblclick', () => this.activate(row.dataset.id));
        row.addEventListener('contextmenu', e => { e.preventDefault(); if (!this.sel.has(row.dataset.id)) this.select(row.dataset.id, {}); this.rowMenu(e); });
        row.addEventListener('dragstart', e => {
          if (this.view !== 'playlist') { e.preventDefault(); return; }
          if (!this.sel.has(row.dataset.id)) this.select(row.dataset.id, {});
          this.dragIds = [...this.sel];
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', 'vlcweb-items');
        });
        row.addEventListener('dragend', () => { this.dragIds = null; });
      }
    }

    select(id, e) {
      const rows = U.$$('.pl-row:not(.pl-header)', this.list).map(r => r.dataset.id);
      if (e.shiftKey && this.anchor && rows.includes(this.anchor)) {
        const a = rows.indexOf(this.anchor), b = rows.indexOf(id);
        if (!e.ctrlKey && !e.metaKey) this.sel.clear();
        rows.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(x => this.sel.add(x));
      } else if (e.ctrlKey || e.metaKey) {
        if (this.sel.has(id)) this.sel.delete(id); else this.sel.add(id);
        this.anchor = id;
      } else { this.sel.clear(); this.sel.add(id); this.anchor = id; }
      for (const r of U.$$('.pl-row:not(.pl-header)', this.list)) r.classList.toggle('selected', this.sel.has(r.dataset.id));
      this.list.focus({ preventScroll: true });
    }

    highlight() {
      if (this.view !== 'playlist') return;
      const cur = this.pl.current;
      for (const r of U.$$('.pl-row:not(.pl-header)', this.list)) {
        const on = cur && r.dataset.id === cur.id;
        r.classList.toggle('current', !!on);
        const use = U.$('.pl-ico use', r);
        const it = this.pl.get(r.dataset.id);
        if (use && it) use.setAttribute('href', '#i-' + (on ? 'play' : it.stream ? 'capture' : it.kind === 'audio' ? 'music' : it.kind === 'image' ? 'image' : it.url ? 'network' : 'film'));
      }
      this.scrollToCurrent();
    }
    scrollToCurrent() { const r = U.$('.pl-row.current', this.list); if (r) r.scrollIntoView({ block: 'nearest' }); }

    activate(id) {
      if (this.view === 'playlist') { const i = this.pl.indexOf(id); if (i >= 0) this.p.playIndex(i); return; }
      const h = this.rowHandlers && this.rowHandlers[id];
      if (h) h.play();
    }

    onKey(e) {
      const rows = U.$$('.pl-row:not(.pl-header)', this.list);
      if (!rows.length) return;
      const ids = rows.map(r => r.dataset.id);
      let i = ids.indexOf(this.anchor);
      const key = e.key;
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation();
        i = U.clamp(i + (key === 'ArrowDown' ? 1 : -1), 0, ids.length - 1);
        this.select(ids[i], { shiftKey: e.shiftKey });
        if (!e.shiftKey) this.anchor = ids[i];
        rows[i].scrollIntoView({ block: 'nearest' });
      } else if (key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (this.anchor) this.activate(this.anchor); }
      else if (key === 'Delete' && this.view === 'playlist') { e.preventDefault(); e.stopPropagation(); this.removeSelected(); }
      else if ((key === 'a' || key === 'A') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); ids.forEach(x => this.sel.add(x)); rows.forEach(r => r.classList.add('selected')); }
    }

    selectedItems() { return this.pl.items.filter(i => this.sel.has(i.id)); }

    removeSelected() {
      const ids = [...this.sel];
      if (!ids.length) return;
      const wasCurrent = this.pl.remove(ids);
      this.sel.clear();
      if (wasCurrent) this.p.stop();
    }

    rowMenu(e) {
      if (this.view !== 'playlist') { const h = this.rowHandlers && this.rowHandlers[[...this.sel][0]]; if (h && h.menu) this.app.menu.context(h.menu(), e.clientX, e.clientY); return; }
      const items = this.selectedItems();
      const one = items[0];
      const A = this.app.actions;
      this.app.menu.context([
        { label: 'Reproduzir', icon: 'play', action: () => this.activate(one.id) },
        { label: 'Transmitir…', action: () => { this.activate(one.id); A.run('stream'); } },
        { label: 'Salvar / Converter…', action: () => this.app.dialogs.convert(items) },
        { sep: true },
        { label: 'Informações…', icon: 'info', action: () => this.app.dialogs.mediaInfo('general', one) },
        { label: 'Adicionar à biblioteca de mídia', icon: 'library', action: async () => { const n = await this.app.library.addItems(items); this.app.controls.osd(n + ' item(ns) adicionado(s) à biblioteca'); } },
        { label: 'Reproduzir com FFmpeg (formato não suportado)', disabled: !one.file, action: () => { this.p.stop(); this.pl.setIndex(this.pl.indexOf(one.id)); this.p.item = one; this.p.playWithFFmpeg(one); } },
        { sep: true },
        { label: 'Remover selecionados', icon: 'minus', shortcut: 'Del', action: () => this.removeSelected() },
        { label: 'Ordenar por', submenu: () => this.sortMenu() },
        { sep: true },
        { label: 'Adicionar arquivo…', action: () => A.run('add-file') },
        { label: 'Adicionar pasta…', action: () => A.run('add-folder') },
        { label: 'Adicionar URL…', action: () => A.run('open-network') },
        { sep: true },
        { label: 'Salvar lista de reprodução…', action: () => A.run('save-playlist') },
        { label: 'Limpar lista de reprodução', icon: 'trash', action: () => this.clear() }
      ], e.clientX, e.clientY);
    }

    sortMenu() {
      return [['title', 'Título'], ['duration', 'Duração'], ['artist', 'Artista'], ['album', 'Álbum'], ['genre', 'Gênero'], ['track', 'Número da faixa'], ['uri', 'URI'], ['random', 'Aleatório']]
        .flatMap(([k, l]) => k === 'random' ? [{ sep: true }, { label: l, action: () => this.pl.sort(k) }] : [
          { label: l + ' (crescente)', action: () => { this.sortState = { [k]: 1 }; this.pl.sort(k, 1); } },
          { label: l + ' (decrescente)', action: () => { this.sortState = { [k]: -1 }; this.pl.sort(k, -1); } }
        ]);
    }

    async clear() {
      if (!this.pl.items.length) return;
      this.p.stop();
      this.p.item = null;
      this.p.setState('idle');
      this.pl.clear();
      this.app.controls.updateAll();
    }

    renderFoot() {
      const f = this.foot;
      f.textContent = '';
      const A = this.app.actions;
      const btn = (icon, title, fn, cls) => { const b = el('button', { type: 'button', class: 'tb-btn small ' + (cls || ''), title, 'aria-label': title }, U.icon(icon)); b.addEventListener('click', fn); return b; };
      if (this.view === 'playlist') {
        const add = btn('plus', 'Adicionar…', e => this.app.menu.context([
          { label: 'Adicionar arquivo…', action: () => A.run('add-file') },
          { label: 'Adicionar pasta…', action: () => A.run('add-folder') },
          { label: 'Adicionar URL / transmissão de rede…', action: () => A.run('open-network') },
          { label: 'Adicionar dispositivo de captura…', action: () => A.run('open-capture') }
        ], e.clientX, e.clientY - 120));
        f.append(add,
          btn('minus', 'Remover selecionados (Del)', () => this.removeSelected()),
          btn('trash', 'Limpar a lista', () => this.clear()),
          btn('sort', 'Ordenar…', e => this.app.menu.context(this.sortMenu(), e.clientX, e.clientY - 300)),
          btn('shuffle', 'Aleatório', () => this.p.toggleShuffle(), this.pl.shuffle ? 'on' : ''),
          btn(this.pl.loop === 'one' ? 'loop-one' : 'loop', 'Repetir', () => this.p.cycleLoop(), this.pl.loop !== 'none' ? 'on' : ''),
          btn('save', 'Salvar lista de reprodução…', () => A.run('save-playlist')),
          btn('locate', 'Mostrar item atual', () => this.scrollToCurrent()),
          el('span', { class: 'pl-count' }, `${this.pl.items.length} ${this.pl.items.length === 1 ? 'item' : 'itens'} — ${U.fmtTime(this.pl.totalDuration(), true)}`));
      } else if (this.view === 'library') {
        f.append(btn('plus', 'Adicionar itens da lista atual à biblioteca', async () => { const n = await this.app.library.addItems(this.pl.items); this.app.controls.osd(n + ' item(ns) adicionado(s)'); }),
          btn('trash', 'Limpar biblioteca', async () => { if (await VW.ui.F.message('Biblioteca de mídia', 'Remover todos os itens da biblioteca?', [['yes', 'Remover'], ['no', 'Cancelar']]) === 'yes') this.app.library.clear(); }),
          el('span', { class: 'pl-count' }, this.app.library.items.length + ' itens'));
      } else if (this.view === 'computer') {
        f.append(btn('folder-plus', 'Adicionar pasta do computador', () => this.app.library.addFolder().then(() => this.render()).catch(e => this.app.error(e.message))),
          el('span', { class: 'pl-count' }, this.app.library.folders.length + ' pastas'));
      } else if (this.view === 'radio') {
        f.append(el('span', { class: 'pl-count' }, 'Diretório: radio-browser.info'));
      } else if (this.view === 'podcasts') {
        f.append(btn('plus', 'Inscrever-se em um podcast (URL do feed RSS)', () => this.addPodcast()), el('span', { class: 'pl-count' }, this.app.library.podcasts.length + ' podcasts'));
      }
    }

    /* ======================= Biblioteca ======================= */
    simpleList(entries, emptyMsg) {
      this.rowHandlers = {};
      const q = this.filterText();
      const frag = document.createDocumentFragment();
      for (const en of entries) {
        if (q && !(en.title + ' ' + (en.sub || '')).toLowerCase().includes(q)) continue;
        const row = el('div', { class: 'pl-row simple' + (en.disabled ? ' missing' : ''), dataset: { id: en.id }, title: en.tip || '' },
          el('span', { class: 'pl-ico' }, en.img ? el('img', { src: en.img, alt: '', loading: 'lazy', onerror: function () { this.remove(); } }) : U.icon(en.icon || 'film')),
          el('span', { class: 'pl-main' }, el('span', { class: 'pl-t' }, en.title), en.sub ? el('span', { class: 'pl-s' }, en.sub) : null),
          en.right ? el('span', { class: 'pl-r' }, en.right) : null);
        this.rowHandlers[en.id] = en;
        frag.appendChild(row);
      }
      this.list.appendChild(frag);
      if (!entries.length) this.list.appendChild(this.empty(emptyMsg[0], emptyMsg[1]));
      this.bindRows();
    }

    renderLibrary() {
      const lib = this.app.library;
      const entries = lib.items.slice().sort((a, b) => U.naturalCompare(a.title, b.title)).map(r => ({
        id: r.id, title: r.title, sub: [r.meta && r.meta.artist, r.url || r.name].filter(Boolean).join(' — '), right: U.fmtTime(r.duration),
        icon: r.kind === 'audio' ? 'music' : r.url ? 'network' : 'film', disabled: r.unavailable,
        tip: r.unavailable ? 'Arquivo local sem acesso persistente — abra-o novamente' : r.url || r.name,
        play: () => this.playRecord(r, true),
        menu: () => [
          { label: 'Reproduzir', action: () => this.playRecord(r, true) },
          { label: 'Adicionar à lista de reprodução', action: () => this.playRecord(r, false) },
          { sep: true },
          { label: 'Remover da biblioteca', action: () => lib.remove([...this.sel]) }
        ]
      }));
      this.simpleList(entries, ['A biblioteca está vazia.', 'Clique com o botão direito em itens da lista → "Adicionar à biblioteca de mídia".']);
    }

    async playRecord(r, play) {
      try {
        const data = await this.app.library.resolve(r);
        this.p.enqueue([data], { play });
      } catch (e) { this.app.error(e.message); }
    }

    /* ======================= Meu computador ======================= */
    async renderComputer() {
      const lib = this.app.library;
      if (!U.supports.dirPicker) {
        this.list.appendChild(this.empty('Recurso indisponível neste navegador', 'O acesso persistente a pastas exige um navegador baseado em Chromium. Use Mídia → Abrir pasta.'));
        return;
      }
      if (!this.computerPath.length) {
        const entries = lib.folders.map(f => ({
          id: f.id, title: f.name, icon: 'folder', sub: 'Pasta',
          play: () => { this.computerPath = [{ rec: f, handle: f.handle, name: f.name }]; this.render(); },
          menu: () => [{ label: 'Abrir', action: () => { this.computerPath = [{ rec: f, handle: f.handle, name: f.name }]; this.render(); } }, { label: 'Reproduzir tudo', action: () => this.playFolder(f, f.handle) }, { sep: true }, { label: 'Remover da lista de pastas', action: () => lib.removeFolder(f.id) }]
        }));
        this.simpleList(entries, ['Nenhuma pasta adicionada.', 'Clique em "+" abaixo para escolher pastas de vídeos, músicas ou imagens.']);
        return;
      }
      const cur = this.computerPath[this.computerPath.length - 1];
      const crumbs = el('div', { class: 'pl-crumbs' }, el('button', { type: 'button', class: 'link', onclick: () => { this.computerPath = []; this.render(); } }, 'Pastas'),
        this.computerPath.map((c, i) => [' › ', el('button', { type: 'button', class: 'link', onclick: () => { this.computerPath = this.computerPath.slice(0, i + 1); this.render(); } }, c.name)]),
        el('button', { type: 'button', class: 'btn small', style: { marginLeft: 'auto' }, onclick: () => this.playFolder(cur.rec, cur.handle) }, 'Reproduzir tudo'));
      this.list.appendChild(crumbs);
      try {
        const { dirs, files } = await lib.listFolder(cur.rec, cur.handle);
        if (this.view !== 'computer') return;
        const entries = dirs.map(d => ({ id: 'dir:' + d.name, title: d.name, icon: 'folder', play: () => { this.computerPath.push({ rec: cur.rec, handle: d, name: d.name }); this.render(); } }))
          .concat(files.map(f => ({
            id: 'file:' + f.name, title: f.name, icon: U.kindOf(f.name) === 'audio' ? 'music' : U.kindOf(f.name) === 'image' ? 'image' : 'film',
            play: async () => { const file = await f.getFile(); this.app.openFiles([{ file, handle: f }], { play: true }); },
            menu: () => [{ label: 'Reproduzir', action: async () => this.app.openFiles([{ file: await f.getFile(), handle: f }], { play: true }) }, { label: 'Adicionar à lista', action: async () => this.app.openFiles([{ file: await f.getFile(), handle: f }], { play: false }) }]
          })));
        this.simpleList(entries, ['Pasta vazia', 'Nenhuma mídia encontrada nesta pasta.']);
      } catch (e) { this.list.appendChild(this.empty('Sem acesso à pasta', e.message)); }
    }

    async playFolder(rec, handle) {
      try {
        if (!(await VW.Library.verifyPermission(rec.handle))) return;
        this.app.controls.osd('Lendo pasta…');
        const files = await U.walkDirectoryHandle(handle);
        this.app.openFiles(files, { play: true });
      } catch (e) { this.app.error(e.message); }
    }

    /* ======================= Rádios ======================= */
    async loadRadios(q) {
      this.radioLoading = true;
      this.radioError = null;
      if (this.view === 'radio') this.render();
      try { this.radioCache = await this.app.library.radioSearch(q, { limit: 100 }); }
      catch (e) { this.radioError = e.message; this.radioCache = this.radioCache || []; }
      this.radioLoading = false;
      if (this.view === 'radio') this.render();
    }

    renderRadios() {
      if (this.radioLoading) { this.list.appendChild(el('div', { class: 'pl-empty' }, el('span', { class: 'spinner' }), 'Carregando estações…')); return; }
      if (this.radioError) this.list.appendChild(el('div', { class: 'pl-error' }, this.radioError));
      const st = (this.radioCache || []).map(s => ({
        id: 'r:' + s.id, title: s.title, sub: [s.country, s.tags && s.tags.split(',').slice(0, 3).join(', ')].filter(Boolean).join(' — '),
        right: [s.codec, s.bitrate ? s.bitrate + 'k' : ''].filter(Boolean).join(' '), img: s.favicon || null, icon: 'radio',
        tip: s.url + (s.https ? '' : '\n(HTTP: pode ser bloqueado em páginas HTTPS)'),
        play: () => this.p.enqueue([{ url: s.url, title: s.title, kind: 'audio', meta: { title: s.title, genre: s.tags, url: s.homepage } }], { play: true }),
        menu: () => [
          { label: 'Reproduzir', action: () => this.p.enqueue([{ url: s.url, title: s.title, kind: 'audio' }], { play: true }) },
          { label: 'Adicionar à lista de reprodução', action: () => this.p.enqueue([{ url: s.url, title: s.title, kind: 'audio' }]) },
          { label: 'Adicionar à biblioteca', action: () => this.app.library.addItems([new VW.PlaylistItem({ url: s.url, title: s.title, kind: 'audio' })]) },
          { label: 'Abrir site da rádio', disabled: !s.homepage, action: () => window.open(s.homepage, '_blank', 'noopener') }
        ]
      }));
      if (!this.radioError || st.length) this.simpleList(st, ['Nenhuma estação encontrada', 'Tente outro termo de busca.']);
    }

    /* ======================= Podcasts ======================= */
    async addPodcast() {
      const url = await VW.ui.F.prompt('Inscrever-se em podcast', 'URL do feed RSS:', '', 'https://exemplo.com/feed.xml');
      if (!url) return;
      try { await this.app.library.addPodcast(url.trim()); this.render(); }
      catch (e) { this.app.error('Não foi possível carregar o feed: ' + e.message); }
    }

    async renderPodcasts() {
      const lib = this.app.library;
      if (this.podcastOpen) {
        const pod = this.podcastOpen;
        this.list.appendChild(el('div', { class: 'pl-crumbs' }, el('button', { type: 'button', class: 'link', onclick: () => { this.podcastOpen = null; this.render(); } }, 'Podcasts'), ' › ', pod.title));
        try {
          const feed = pod.feed || (pod.feed = await lib.fetchFeed(pod.url));
          if (this.view !== 'podcasts') return;
          this.simpleList(feed.episodes.map((ep, i) => ({
            id: 'ep:' + i, title: ep.title, sub: ep.date, right: U.fmtTime(ep.duration), icon: 'podcast', tip: ep.description,
            play: () => this.p.enqueue([{ url: ep.url, title: ep.title, kind: (ep.type || '').startsWith('video') ? 'video' : 'audio', meta: { album: feed.title, description: ep.description } }], { play: true }),
            menu: () => [{ label: 'Reproduzir', action: () => this.p.enqueue([{ url: ep.url, title: ep.title }], { play: true }) }, { label: 'Adicionar à lista', action: () => this.p.enqueue([{ url: ep.url, title: ep.title }]) }, { label: 'Baixar episódio', action: () => window.open(ep.url, '_blank', 'noopener') }]
          })), ['Sem episódios', '']);
        } catch (e) { this.list.appendChild(this.empty('Falha ao carregar o feed', e.message)); }
        return;
      }
      this.simpleList(lib.podcasts.map(p => ({
        id: p.id, title: p.title, sub: p.url, icon: 'podcast', img: p.image || null,
        play: () => { this.podcastOpen = p; this.render(); },
        menu: () => [{ label: 'Abrir', action: () => { this.podcastOpen = p; this.render(); } }, { label: 'Cancelar inscrição', action: () => lib.removePodcast(p.id) }]
      })), ['Nenhum podcast', 'Clique em "+" e informe a URL de um feed RSS (o servidor precisa permitir CORS).']);
    }
  }

  PlaylistView.COLUMNS = COLUMNS;
  VW.ui = VW.ui || {};
  VW.ui.PlaylistView = PlaylistView;
})(window.VW = window.VW || {});
