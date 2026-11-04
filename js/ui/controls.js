/* VLC Web — controles principais: barra de busca, barra de ferramentas personalizável, volume,
 * barra de status, OSD, tela cheia com controles flutuantes, área de capa/arte e boas‑vindas. */
(function (VW) {
  'use strict';
  const U = VW.util;
  const el = U.el;

  /* Botões disponíveis para a barra de ferramentas (Ferramentas → Personalizar interface) */
  const BUTTONS = {
    play: { icon: 'play', label: 'Reproduzir/Pausar', action: 'play-pause', big: true },
    stop: { icon: 'stop', label: 'Parar', action: 'stop' },
    prev: { icon: 'prev', label: 'Anterior / Voltar', action: 'prev' },
    next: { icon: 'next', label: 'Próximo / Avançar', action: 'next' },
    slower: { icon: 'slower', label: 'Mais lento', action: 'slower' },
    faster: { icon: 'faster', label: 'Mais rápido', action: 'faster' },
    back: { icon: 'jump-back', label: 'Saltar para trás', action: 'jump-short-back' },
    fwd: { icon: 'jump-fwd', label: 'Saltar para frente', action: 'jump-short-fwd' },
    fullscreen: { icon: 'fullscreen', label: 'Tela cheia', action: 'fullscreen' },
    effects: { icon: 'sliders', label: 'Configurações estendidas (efeitos e filtros)', action: 'effects' },
    playlist: { icon: 'playlist', label: 'Mostrar/ocultar lista de reprodução', action: 'playlist' },
    loop: { icon: 'loop', label: 'Repetir (desligado / tudo / um)', action: 'loop-cycle' },
    shuffle: { icon: 'shuffle', label: 'Aleatório', action: 'random' },
    record: { icon: 'record', label: 'Gravar', action: 'record' },
    snapshot: { icon: 'camera', label: 'Capturar imagem', action: 'snapshot' },
    abloop: { icon: 'abloop', label: 'Repetição de A até B', action: 'ab-loop' },
    frame: { icon: 'frame', label: 'Quadro a quadro', action: 'frame-next' },
    open: { icon: 'eject', label: 'Abrir mídia', action: 'open-file' },
    info: { icon: 'info', label: 'Informações da mídia', action: 'media-info' },
    pip: { icon: 'pip', label: 'Imagem sobre imagem (sempre no topo)', action: 'pip' },
    aspect: { icon: 'aspect', label: 'Proporção', action: 'aspect-cycle' },
    subtitle: { icon: 'subtitle', label: 'Faixa de legenda', action: 'sub-track-cycle' },
    minimal: { icon: 'minimal', label: 'Interface mínima', action: 'minimal' },
    library: { icon: 'library', label: 'Biblioteca de mídia', action: 'library' },
    skins: { icon: 'palette', label: 'Galeria de temas e layouts', action: 'skin-gallery' },
    layout: { icon: 'layout', label: 'Próxima estrutura de layout', action: 'layout-cycle' },
    sep: { sep: true, label: '— Separador —' },
    spacer: { spacer: true, label: '⟷ Espaço expansível' },
    volume: { volume: true, label: 'Controle de volume' },
    time: { time: true, label: 'Tempo' }
  };

  class Controls {
    constructor(app) {
      this.app = app;
      this.p = app.player;
      this.settings = app.settings;
      this.actions = app.actions;
      this.root = U.$('#app');
      this.stage = U.$('#stage');
      this.osdText = U.$('#osd-text');
      this.osdTime = U.$('#osd-time');
      this.showRemaining = U.store.get('showRemaining', false);
      this.buildSeekbar();
      this.buildToolbars();
      this.bindPlayerEvents();
      this.bindStage();
      this.bindFullscreen();
      this.updateAll();
    }

    /* ======================= barra de busca ======================= */
    buildSeekbar() {
      const sb = this.seek = U.$('#seekbar');
      this.seekFill = U.$('.seek-fill', sb);
      this.seekBuf = U.$('.seek-buffer', sb);
      this.seekHandle = U.$('.seek-handle', sb);
      this.seekMarks = U.$('.seek-marks', sb);
      this.seekTip = U.$('#seek-tip');
      this.tElapsed = U.$('#time-elapsed');
      this.tTotal = U.$('#time-total');
      const frac = e => { const r = sb.getBoundingClientRect(); return U.clamp((e.clientX - r.left) / r.width, 0, 1); };
      let dragging = false;
      sb.addEventListener('pointerdown', e => {
        if (e.button !== 0 || !isFinite(this.p.duration)) return;
        dragging = true; sb.setPointerCapture(e.pointerId); sb.classList.add('dragging');
        this.p.seekFraction(frac(e));
      });
      sb.addEventListener('pointermove', e => {
        const d = this.p.duration;
        if (!isFinite(d)) { this.seekTip.hidden = true; return; }
        const f = frac(e);
        if (dragging) { this.p.seek(d * f, true); this.renderTime(d * f); }
        const t = d * f;
        const ch = this.p.chapters.slice().reverse().find(c => t >= c.start);
        this.seekTip.textContent = U.fmtTime(t) + (ch ? ' — ' + ch.title : '');
        this.seekTip.hidden = false;
        const r = sb.getBoundingClientRect(), tr = this.seekTip.getBoundingClientRect();
        this.seekTip.style.left = U.clamp(e.clientX - r.left - tr.width / 2, -r.left + 4, r.width - tr.width) + 'px';
      });
      const end = e => { if (!dragging) return; dragging = false; sb.classList.remove('dragging'); this.p.seek(this.p.duration * frac(e)); };
      sb.addEventListener('pointerup', end);
      sb.addEventListener('pointercancel', () => { dragging = false; sb.classList.remove('dragging'); });
      sb.addEventListener('pointerleave', () => { this.seekTip.hidden = true; });
      sb.addEventListener('wheel', e => { e.preventDefault(); this.p.seekRel(e.deltaY < 0 ? this.settings.get('jumpVeryShort') : -this.settings.get('jumpVeryShort')); }, { passive: false });
      sb.addEventListener('keydown', e => {
        if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); this.p.seekRel(-this.settings.get('jumpVeryShort')); }
        if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); this.p.seekRel(this.settings.get('jumpVeryShort')); }
        if (e.key === 'Home') { e.preventDefault(); this.p.seek(0); }
        if (e.key === 'End') { e.preventDefault(); this.p.seekFraction(0.999); }
      });
      this.tTotal.addEventListener('click', () => { this.showRemaining = !this.showRemaining; U.store.set('showRemaining', this.showRemaining); this.renderTime(); });
      this.tElapsed.addEventListener('click', () => this.actions.run('goto-time'));
    }

    renderTime(override) {
      const t = override ?? this.p.currentTime, d = this.p.duration;
      const live = this.p.isLive;
      const f = isFinite(d) && d > 0 ? U.clamp(t / d, 0, 1) : 0;
      this.seekFill.style.width = (f * 100) + '%';
      this.seekHandle.style.left = (f * 100) + '%';
      this.seek.setAttribute('aria-valuenow', Math.round(t));
      this.seek.setAttribute('aria-valuetext', U.fmtTime(t) + ' de ' + U.fmtTime(d));
      const hours = isFinite(d) && d >= 3600;
      this.tElapsed.textContent = this.p.item ? U.fmtTime(t, hours) : '--:--';
      this.tTotal.textContent = !this.p.item ? '--:--' : live ? 'AO VIVO' : this.showRemaining && isFinite(d) ? U.fmtTime(-(d - t), hours) : U.fmtTime(d, hours);
      if (this.statusTime) this.statusTime.textContent = this.p.item ? `${U.fmtTime(t, hours)} / ${live ? 'ao vivo' : U.fmtTime(d, hours)}` : '';
      if (this.fsTime) this.fsTime.textContent = this.tElapsed.textContent + ' / ' + this.tTotal.textContent;
    }

    renderBuffer() {
      const m = this.p.media, d = this.p.duration;
      if (!m || !m.buffered || !m.buffered.length || !isFinite(d)) { this.seekBuf.style.width = '0'; return; }
      const t = this.p.currentTime;
      let end = 0;
      for (let i = 0; i < m.buffered.length; i++) if (m.buffered.start(i) <= t + 0.5) end = Math.max(end, m.buffered.end(i));
      this.seekBuf.style.width = U.clamp(end / d, 0, 1) * 100 + '%';
    }

    renderMarks() {
      const d = this.p.duration;
      this.seekMarks.textContent = '';
      if (!isFinite(d) || d <= 0) return;
      for (const c of this.p.chapters) if (c.start > 0.5) this.seekMarks.appendChild(el('span', { class: 'mark chapter', style: { left: (c.start / d * 100) + '%' }, title: c.title }));
      for (const b of this.p.bookmarks) this.seekMarks.appendChild(el('span', { class: 'mark bookmark', style: { left: (b.time / d * 100) + '%' }, title: b.name }));
      const ab = this.p.ab;
      if (ab.a !== null) this.seekMarks.appendChild(el('span', { class: 'mark ab', style: { left: (ab.a / d * 100) + '%' } }, 'A'));
      if (ab.b !== null) {
        this.seekMarks.appendChild(el('span', { class: 'mark ab', style: { left: (ab.b / d * 100) + '%' } }, 'B'));
        this.seekMarks.appendChild(el('span', { class: 'ab-range', style: { left: (ab.a / d * 100) + '%', width: ((ab.b - ab.a) / d * 100) + '%' } }));
      }
    }

    /* ======================= barras de ferramentas ======================= */
    buildToolbars() {
      this.toolbar = U.$('#toolbar');
      this.advbar = U.$('#advbar');
      this.statusbar = U.$('#statusbar');
      this.statusText = U.$('#status-text');
      this.statusRate = U.$('#status-rate');
      this.statusTime = U.$('#status-time');
      this.renderToolbars();
      this.settings.on('change:toolbar', () => this.renderToolbars());
      this.settings.on('change:advToolbar', () => this.renderToolbars());
      this.statusRate.addEventListener('click', e => {
        const items = Player_RATES().map(r => ({ label: r.toFixed(2).replace(/\.?0+$/, '') + 'x', checked: Math.abs(this.p.rate - r) < 1e-3, radio: true, action: () => this.p.setRate(r) }));
        this.app.menu.context(items, e.clientX, e.clientY - 10);
      });
    }

    renderToolbars() {
      const make = (bar, ids) => {
        bar.textContent = '';
        for (const id of ids) {
          const b = BUTTONS[id];
          if (!b) continue;
          if (b.sep) { bar.appendChild(el('span', { class: 'tb-sep' })); continue; }
          if (b.spacer) { bar.appendChild(el('span', { class: 'tb-spacer' })); continue; }
          if (b.volume) { bar.appendChild(this.buildVolume()); continue; }
          if (b.time) { bar.appendChild(el('span', { class: 'tb-time', id: 'tb-time' })); continue; }
          const btn = el('button', { type: 'button', class: 'tb-btn' + (b.big ? ' big' : ''), 'data-btn': id, title: b.label + this.scLabel(b.action), 'aria-label': b.label }, U.icon(b.icon));
          btn.addEventListener('click', () => this.actions.run(b.action));
          bar.appendChild(btn);
        }
      };
      make(this.toolbar, this.settings.get('toolbar'));
      make(this.advbar, this.settings.get('advToolbar'));
      this.advbar.hidden = !this.settings.get('showAdvancedControls');
      this.updateButtons();
      this.renderVolume();
    }

    scLabel(action) { const s = this.actions.shortcutLabel(action); return s ? ` (${s})` : ''; }

    buildVolume() {
      const wrap = el('div', { class: 'vol' });
      const mute = el('button', { type: 'button', class: 'tb-btn vol-mute', title: 'Mudo' + this.scLabel('mute'), 'aria-label': 'Mudo' }, U.icon('volume'));
      const track = el('div', { class: 'vol-track', role: 'slider', tabindex: '0', 'aria-label': 'Volume', 'aria-valuemin': '0' },
        el('div', { class: 'vol-fill' }), el('div', { class: 'vol-100' }));
      const pct = el('span', { class: 'vol-pct' });
      mute.addEventListener('click', () => this.p.toggleMute());
      const max = () => Math.max(1, this.settings.get('maxVolume'));
      const set = e => { const r = track.getBoundingClientRect(); this.p.setVolume(U.clamp((e.clientX - r.left) / r.width, 0, 1) * max(), true); };
      let drag = false;
      track.addEventListener('pointerdown', e => { drag = true; track.setPointerCapture(e.pointerId); if (this.p.audio.muted) this.p.toggleMute(); set(e); });
      track.addEventListener('pointermove', e => { if (drag) set(e); });
      track.addEventListener('pointerup', () => { drag = false; });
      track.addEventListener('wheel', e => { e.preventDefault(); this.p.changeVolume(e.deltaY < 0 ? this.settings.get('volumeStep') : -this.settings.get('volumeStep')); }, { passive: false });
      track.addEventListener('keydown', e => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); this.p.changeVolume(this.settings.get('volumeStep')); }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); this.p.changeVolume(-this.settings.get('volumeStep')); }
      });
      wrap.append(mute, track, pct);
      return wrap;
    }

    renderVolume() {
      const v = this.p.audio.volume, m = this.p.audio.muted;
      const max = Math.max(1, this.settings.get('maxVolume'));
      for (const w of U.$$('.vol')) {
        U.$('.vol-fill', w).style.width = (U.clamp(v / max, 0, 1) * 100) + '%';
        U.$('.vol-fill', w).classList.toggle('over', v > 1.001);
        U.$('.vol-100', w).style.left = (100 / max) + '%';
        U.$('.vol-100', w).hidden = max <= 1;
        U.$('.vol-pct', w).textContent = Math.round(v * 100) + '%';
        const t = U.$('.vol-track', w);
        t.setAttribute('aria-valuenow', Math.round(v * 100));
        t.setAttribute('aria-valuemax', Math.round(max * 100));
        w.classList.toggle('muted', m);
        U.$('.vol-mute use', w).setAttribute('href', '#i-' + (m || v === 0 ? 'mute' : v < 0.5 ? 'volume-low' : 'volume'));
      }
    }

    updateButtons() {
      const p = this.p;
      const playing = p.playing;
      for (const b of U.$$('[data-btn="play"]')) {
        U.$('use', b).setAttribute('href', playing ? '#i-pause' : '#i-play');
        b.title = (playing ? 'Pausar' : 'Reproduzir') + this.scLabel('play-pause');
      }
      const loop = p.playlist.loop;
      for (const b of U.$$('[data-btn="loop"]')) {
        b.classList.toggle('on', loop !== 'none');
        U.$('use', b).setAttribute('href', loop === 'one' ? '#i-loop-one' : '#i-loop');
        b.title = { none: 'Repetição desligada', all: 'Repetir tudo', one: 'Repetir um' }[loop] + this.scLabel('loop-cycle');
      }
      for (const b of U.$$('[data-btn="shuffle"]')) b.classList.toggle('on', p.playlist.shuffle);
      for (const b of U.$$('[data-btn="playlist"]')) b.classList.toggle('on', this.settings.get('playlistVisible'));
      for (const b of U.$$('[data-btn="record"]')) b.classList.toggle('rec', !!(this.app.recorder && this.app.recorder.recording));
      for (const b of U.$$('[data-btn="abloop"]')) { b.classList.toggle('on', p.ab.a !== null); b.classList.toggle('half', p.ab.a !== null && p.ab.b === null); }
      for (const b of U.$$('[data-btn="fullscreen"]')) U.$('use', b).setAttribute('href', document.fullscreenElement ? '#i-fullscreen-exit' : '#i-fullscreen');
      this.statusRate.textContent = p.rate.toFixed(2).replace(/0$/, '') + 'x';
      this.statusRate.classList.toggle('changed', Math.abs(p.rate - 1) > 1e-3);
      const st = { idle: 'Pronto', opening: 'Abrindo…', buffering: 'Carregando buffer…', playing: 'Reproduzindo', paused: 'Pausado', stopped: 'Parado', ended: 'Fim', error: 'Erro' }[p.state] || '';
      this.statusText.textContent = p.item ? `${st} — ${p.item.displayTitle}` : st;
      this.root.classList.toggle('is-playing', playing);
      this.root.classList.toggle('has-media', !!p.item && p.state !== 'stopped' && p.state !== 'ended');
    }

    updateAll() { this.updateButtons(); this.renderVolume(); this.renderTime(); this.renderMarks(); this.updateStageView(); }

    /* ======================= eventos do player ======================= */
    bindPlayerEvents() {
      const p = this.p;
      p.on('frame', U.throttle(() => this.renderTime(), 100));
      p.on('time', () => this.renderTime());
      p.on('duration', () => { this.renderTime(); this.renderMarks(); });
      p.on('state', s => {
        if (this.wake) setTimeout(this.wake, 0);
        this.updateButtons();
        this.updateStageView();
        if (s === 'playing') this.flashCenter('play'); else if (s === 'paused') this.flashCenter('pause');
      });
      p.on('item', it => { this.updateButtons(); this.renderTime(); this.renderMarks(); document.title = it.displayTitle + ' — VLC Web'; });
      p.on('loaded', (it, info) => {
        this.updateStageView();
        if (info && info.routeSwitch) return;
        if (this.settings.get('titleOnStart') && this.settings.get('showMediaChangePopup')) this.osd(it.displayTitle, this.settings.get('titleTimeout') * 1000, 'title');
      });
      p.on('meta', it => {
        if (it !== p.item) return;
        this.updateStageView(); this.updateButtons();
        document.title = it.displayTitle + ' — VLC Web';
        const t = U.$('#osd-title');
        if (t.classList.contains('show')) t.textContent = it.displayTitle;
      });
      p.on('stopped', () => { this.updateStageView(); document.title = 'VLC Web — reprodutor de mídia'; });
      p.on('rate', () => this.updateButtons());
      p.on('modes', () => this.updateButtons());
      p.on('ab', () => { this.updateButtons(); this.renderMarks(); });
      p.on('chapters', () => this.renderMarks());
      p.on('bookmarks', () => this.renderMarks());
      p.on('buffer', U.throttle(() => this.renderBuffer(), 500));
      p.on('osd', msg => this.osd(msg));
      p.on('audio-view', () => this.updateStageView());
      p.audio.on('volume', () => this.renderVolume());
      this.settings.on('change:maxVolume', () => this.renderVolume());
      this.settings.on('change:playlistVisible', () => this.updateButtons());
      this.settings.on('change:showAdvancedControls', v => { this.advbar.hidden = !v; });
      this.settings.on('change:showStatusbar', v => { this.statusbar.hidden = !v; });
      this.statusbar.hidden = !this.settings.get('showStatusbar');
      p.renderer.on('puzzle-solved', () => this.osd('🧩 Quebra-cabeça resolvido!', 4000));
    }

    /* ======================= palco: arte, boas‑vindas, cliques ======================= */
    updateStageView() {
      const p = this.p;
      const active = !!p.item && !['stopped', 'ended', 'idle'].includes(p.state);
      const audioOnly = active && !p.hasVideo && p.state !== 'opening' && p.state !== 'error';
      const vis = this.settings.get('visualization');
      U.$('#welcome').hidden = active;
      const art = U.$('#art-view');
      art.hidden = !(audioOnly && vis === 'none');
      p.visualizer.setMode(audioOnly ? vis : 'none');
      if (audioOnly && vis === 'none') {
        const it = p.item;
        const img = U.$('#art-img');
        if (it.coverURL) { img.src = it.coverURL; img.hidden = false; U.$('#art-placeholder').hidden = true; }
        else { img.hidden = true; img.removeAttribute('src'); U.$('#art-placeholder').hidden = false; }
        U.$('#art-title').textContent = it.meta.title || it.title;
        U.$('#art-sub').textContent = [it.meta.artist, it.meta.album, it.meta.date].filter(Boolean).join(' — ');
      }
      this.stage.classList.toggle('audio-only', audioOnly);
      this.renderRecent();
    }

    renderRecent() {
      const box = U.$('#welcome-recent');
      if (!box) return;
      box.textContent = '';
      const list = this.p.recent.slice(0, 6);
      if (!list.length) { box.hidden = true; return; }
      box.hidden = false;
      box.appendChild(el('h3', {}, 'Mídia recente'));
      for (const r of list) {
        const b = el('button', { type: 'button', class: 'recent-item', title: r.url || r.name }, U.icon(r.kind === 'audio' ? 'music' : r.url ? 'network' : 'file'), el('span', {}, r.title));
        b.addEventListener('click', () => this.app.openRecent(r));
        box.appendChild(b);
      }
    }

    bindStage() {
      const st = this.stage;
      let clickT = null;
      st.addEventListener('click', e => {
        if (e.target.closest('button, a, input, .resume-bar, #welcome, .osd-snap')) return;
        if (this.p.renderer._suppressClick) return;
        if (!this.settings.get('clickToPause') || !this.p.item) return;
        clearTimeout(clickT);
        clickT = setTimeout(() => this.actions.run('play-pause'), 220);
      });
      st.addEventListener('dblclick', e => {
        if (e.target.closest('button, a, input, #welcome, .resume-bar')) return;
        clearTimeout(clickT);
        if (this.settings.get('doubleClickFullscreen')) this.actions.run('fullscreen');
      });
      st.addEventListener('wheel', e => {
        if (e.target.closest('.win') || (this.p.renderer.p.izoom && e.target === this.p.renderer.canvas)) return;
        const mode = this.settings.get('wheelAction');
        if (mode === 'none') return;
        e.preventDefault();
        const up = e.deltaY < 0;
        if (mode === 'seek') this.p.seekRel(up ? this.settings.get('jumpVeryShort') : -this.settings.get('jumpVeryShort'));
        else this.p.changeVolume(up ? this.settings.get('volumeStep') : -this.settings.get('volumeStep'));
      }, { passive: false });
      st.addEventListener('contextmenu', e => { e.preventDefault(); this.app.menu.context(this.app.contextMenuItems(), e.clientX, e.clientY); });
      U.$('#controls').addEventListener('contextmenu', e => { e.preventDefault(); this.app.menu.context([{ label: 'Personalizar interface…', action: () => this.actions.run('customize') }, { label: 'Controles avançados', checked: this.settings.get('showAdvancedControls'), action: () => this.actions.run('advanced-controls') }, { label: 'Barra de status', checked: this.settings.get('showStatusbar'), action: () => this.actions.run('statusbar') }], e.clientX, e.clientY); });
    }

    /* ======================= OSD ======================= */
    osd(msg, ms = 1600, kind) {
      if (!this.settings.get('osdEnabled') || !msg) return;
      const box = kind === 'title' ? U.$('#osd-title') : this.osdText;
      box.textContent = msg;
      box.classList.add('show');
      clearTimeout(box._t);
      box._t = setTimeout(() => box.classList.remove('show'), ms);
    }
    showTime() {
      const p = this.p;
      if (!p.item) return;
      this.osd(`${U.fmtTime(p.currentTime, true)} / ${p.isLive ? 'ao vivo' : U.fmtTime(p.duration, true)}`, 2500);
    }
    flashCenter(icon) {
      const c = U.$('#osd-center');
      U.$('use', c).setAttribute('href', '#i-' + icon);
      c.classList.remove('show');
      void c.offsetWidth;
      c.classList.add('show');
    }
    showSnapshot(blob) {
      if (!this.settings.get('snapshotPreview')) return;
      const box = U.$('#osd-snap');
      const url = URL.createObjectURL(blob);
      box.textContent = '';
      box.appendChild(el('img', { src: url, alt: 'Captura' }));
      box.classList.add('show');
      clearTimeout(box._t);
      box._t = setTimeout(() => { box.classList.remove('show'); URL.revokeObjectURL(url); }, 3000);
    }

    /* ======================= tela cheia ======================= */
    bindFullscreen() {
      const app = this.root;
      let t = null;
      this.fsTime = null;
      const wake = () => {
        app.classList.remove('idle');
        clearTimeout(t);
        // no layout "cinema" os controles somem apenas durante a reprodução
        const cinema = () => document.documentElement.classList.contains('lay-cinema') && app.classList.contains('is-playing');
        if (document.fullscreenElement || app.classList.contains('minimal') || cinema()) {
          t = setTimeout(() => {
            const still = document.fullscreenElement || app.classList.contains('minimal') || cinema();
            if (still && !U.$('#controls').matches(':hover') && !this.app.menu.isOpen) app.classList.add('idle');
          }, this.settings.get('fsControlsTimeout') * 1000);
        }
      };
      this.wake = wake;
      document.addEventListener('pointermove', wake);
      document.addEventListener('keydown', wake);
      document.addEventListener('fullscreenchange', () => {
        const fs = !!document.fullscreenElement;
        app.classList.toggle('fullscreen', fs);
        this.updateButtons();
        wake();
        if (!fs) app.classList.remove('idle');
      });
    }
  }

  function Player_RATES() { return [0.25, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 3, 4, 8]; }

  Controls.BUTTONS = BUTTONS;
  VW.ui = VW.ui || {};
  VW.ui.Controls = Controls;
})(window.VW = window.VW || {});
