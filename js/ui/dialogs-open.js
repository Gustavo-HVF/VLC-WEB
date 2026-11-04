/* VLC Web — diálogo "Abrir mídia" (Arquivo, Disco, Rede, Dispositivo de captura), "Ir para o tempo"
 * e "Salvar lista de reprodução". */
(function (VW) {
  'use strict';
  const U = VW.util;
  const el = U.el;
  const { Win, F } = VW.ui;

  function openMedia(app, tab = 'file') {
    const existing = Win.get('open-media');
    if (existing) { existing.tabs.select(tab); existing.focus(); return existing; }
    const st = { files: [], sub: null, extra: null, start: '', stop: '', url: '', showMore: false };
    const w = new Win({ id: 'open-media', title: 'Abrir mídia', width: 640, modal: true, icon: 'eject', className: 'open-media' });

    /* ---------- Arquivo ---------- */
    const fileList = el('div', { class: 'file-list', tabindex: '0' });
    const renderFiles = () => {
      fileList.textContent = '';
      if (!st.files.length) fileList.appendChild(el('div', { class: 'muted' }, 'Nenhum arquivo selecionado. Clique em "Adicionar…" ou arraste arquivos para esta área.'));
      st.files.forEach((f, i) => {
        const row = el('div', { class: 'file-row' }, U.icon(U.kindOf(f.file.name) === 'audio' ? 'music' : 'film'), el('span', { class: 'grow' }, f.path || f.file.name), el('span', { class: 'muted' }, U.fmtBytes(f.file.size)),
          el('button', { type: 'button', class: 'icon-btn', title: 'Remover', onclick: () => { st.files.splice(i, 1); renderFiles(); } }, U.icon('close')));
        fileList.appendChild(row);
      });
    };
    fileList.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); fileList.classList.add('drag'); });
    fileList.addEventListener('dragleave', () => fileList.classList.remove('drag'));
    fileList.addEventListener('drop', async e => { e.preventDefault(); e.stopPropagation(); fileList.classList.remove('drag'); st.files.push(...(await U.readDropEntries(e.dataTransfer))); renderFiles(); });
    renderFiles();
    const subName = el('span', { class: 'muted grow' }, 'nenhum');
    const subCheck = F.check('Usar um arquivo de legenda', false, v => { subBtn.disabled = !v; if (!v) { st.sub = null; subName.textContent = 'nenhum'; } });
    const subBtn = F.button('Procurar…', async () => {
      const f = await app.pickFiles({ multiple: false, accept: U.EXT.sub.map(e => '.' + e).join(','), types: 'sub' });
      if (f[0]) { st.sub = f[0].file; subName.textContent = st.sub.name; }
    });
    subBtn.disabled = true;
    const fileTab = el('div', { class: 'tab-file' },
      F.group('Seleção de arquivos',
        F.hint('Você pode selecionar arquivos locais com a lista e os botões abaixo. Legendas com o mesmo nome do vídeo são carregadas automaticamente.'),
        fileList,
        el('div', { class: 'btn-row' },
          F.button('Adicionar…', async () => { st.files.push(...await app.pickFiles({ multiple: true })); renderFiles(); }),
          F.button('Adicionar pasta…', async () => { st.files.push(...await app.pickFolder()); renderFiles(); }),
          F.button('Limpar', () => { st.files = []; renderFiles(); }))),
      F.group('Legenda', el('div', { class: 'btn-row' }, subCheck, subName, subBtn)));

    /* ---------- Disco ---------- */
    const discType = F.radio('disc-type', [['dvd', 'DVD'], ['bluray', 'Blu-ray'], ['cd', 'CD de áudio'], ['vcd', 'SVCD/VCD']], 'dvd');
    const discTab = el('div', {},
      F.group('Seleção de disco', discType, F.check('Sem menus de disco', true, null)),
      F.group('Dispositivo do disco',
        F.hint('Navegadores não têm acesso direto a unidades ópticas. Copie o disco para o computador ou selecione a pasta da unidade: o VLC Web encontra os títulos <b>VIDEO_TS/*.VOB</b> (DVD), <b>BDMV/STREAM/*.m2ts</b> (Blu-ray) ou as faixas de áudio, e os reproduz usando o decodificador FFmpeg. Discos com proteção (CSS/AACS) não são suportados.'),
        el('div', { class: 'btn-row' }, F.button('Selecionar pasta do disco…', async () => {
          const files = await app.pickFolder();
          const disc = pickDiscTitles(files, discType.querySelector('input:checked').value);
          if (!disc.length) { app.error('Nenhum título de disco reconhecido nesta pasta.'); return; }
          st.files = disc; renderFiles(); w.tabs.select('file');
          app.controls.osd(disc.length + ' arquivo(s) de disco encontrados');
        }))));

    /* ---------- Rede ---------- */
    const recentUrls = app.player.recent.filter(r => r.url).map(r => r.url);
    const dl = el('datalist', { id: 'url-history' }, recentUrls.map(u => el('option', { value: u })));
    const urlIn = F.text('', v => { st.url = v; }, { placeholder: 'https://… (arquivo, .m3u8, .mpd, rádio Icecast/Shoutcast)', list: 'url-history', autofocus: tab === 'network' });
    urlIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go('play'); } });
    const netTab = el('div', {},
      F.group('Protocolo de rede', F.row('Insira uma URL de rede:', urlIn), dl,
        el('ul', { class: 'examples' },
          el('li', {}, 'https://www.exemplo.com/filme.mp4'),
          el('li', {}, 'https://www.exemplo.com/ao-vivo/playlist.m3u8 (HLS)'),
          el('li', {}, 'https://www.exemplo.com/manifest.mpd (MPEG-DASH)'),
          el('li', {}, 'https://radio.exemplo.com:8000/stream (Icecast / Shoutcast)'),
          el('li', {}, 'https://www.exemplo.com/lista.m3u / .pls / .xspf (listas de reprodução)')),
        F.hint('Os protocolos RTSP, RTMP, UDP, MMS, SMB e FTP não estão disponíveis em navegadores. O servidor precisa permitir acesso de outras origens (CORS) para efeitos de áudio/vídeo; caso contrário a mídia toca em modo de compatibilidade.')));

    /* ---------- Captura ---------- */
    const cap = { mode: 'camera', video: '', audio: '', res: '', fps: '', deskAudio: true };
    const vSel = F.select([['', 'Padrão']], '', v => { cap.video = v; });
    const aSel = F.select([['', 'Padrão'], ['none', 'Nenhum']], '', v => { cap.audio = v; });
    const resSel = F.select([['', 'Padrão'], ['640x480', '640×480'], ['1280x720', '1280×720 (HD)'], ['1920x1080', '1920×1080 (Full HD)'], ['3840x2160', '3840×2160 (4K)']], '', v => { cap.res = v; });
    const fpsSel = F.select([['', 'Padrão'], ['15', '15'], ['24', '24'], ['30', '30'], ['60', '60']], '', v => { cap.fps = v; });
    const camBox = el('div', {}, F.row('Nome do dispositivo de vídeo:', vSel), F.row('Nome do dispositivo de áudio:', aSel), F.row('Resolução:', resSel), F.row('Taxa de quadros:', fpsSel));
    const deskBox = el('div', { hidden: true }, F.row('Taxa de quadros desejada:', F.select([['30', '30 q/s'], ['15', '15 q/s'], ['60', '60 q/s'], ['5', '5 q/s']], '30', v => { cap.fps = v; })),
      F.check('Capturar também o áudio (quando o navegador permitir)', true, v => { cap.deskAudio = v; }),
      F.hint('Você poderá escolher a tela inteira, uma janela ou uma aba do navegador.'));
    const modeSel = F.select([['camera', 'Câmera / microfone (DirectShow, V4L2, AVFoundation)'], ['desktop', 'Área de trabalho (tela, janela ou aba)']], 'camera', v => { cap.mode = v; camBox.hidden = v !== 'camera'; deskBox.hidden = v !== 'desktop'; });
    const loadDevices = async () => {
      if (!U.supports.userMedia) return;
      try {
        let devs = await navigator.mediaDevices.enumerateDevices();
        if (!devs.some(d => d.label)) { const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }).catch(() => null); if (s) { s.getTracks().forEach(t => t.stop()); devs = await navigator.mediaDevices.enumerateDevices(); } }
        F.setOptions(vSel, [['', 'Padrão']].concat(devs.filter(d => d.kind === 'videoinput').map((d, i) => [d.deviceId, d.label || 'Câmera ' + (i + 1)])), cap.video);
        F.setOptions(aSel, [['', 'Padrão'], ['none', 'Nenhum']].concat(devs.filter(d => d.kind === 'audioinput').map((d, i) => [d.deviceId, d.label || 'Microfone ' + (i + 1)])), cap.audio);
      } catch (e) { /* sem permissão */ }
    };
    const capTab = el('div', {},
      F.group('Seleção do dispositivo', F.row('Modo de captura:', modeSel), camBox, deskBox,
        el('div', { class: 'btn-row' }, F.button('Atualizar lista de dispositivos', loadDevices))),
      F.hint('TV digital/analógica e placas de captura sem driver de webcam não estão disponíveis no navegador.'));

    /* ---------- Mais opções ---------- */
    const extraName = el('span', { class: 'muted grow' }, 'nenhum');
    const more = el('div', { class: 'more-opts', hidden: true },
      el('div', { class: 'grid2' },
        F.row('Tempo inicial:', F.text('', v => { st.start = v; }, { placeholder: '00:00:00' })),
        F.row('Tempo final:', F.text('', v => { st.stop = v; }, { placeholder: '00:00:00' }))),
      el('div', { class: 'btn-row' }, el('span', {}, 'Reproduzir outra mídia em sincronia (arquivo de áudio extra):'), extraName,
        F.button('Procurar…', async () => { const f = await app.pickFiles({ multiple: false, types: 'audio' }); if (f[0]) { st.extra = f[0].file; extraName.textContent = st.extra.name; } })));
    const moreChk = F.check('Mostrar mais opções', false, v => { more.hidden = !v; });

    const tabs = w.tabs = F.tabs([
      { id: 'file', label: 'Arquivo', content: fileTab },
      { id: 'disc', label: 'Disco', content: discTab },
      { id: 'network', label: 'Rede', content: netTab },
      { id: 'capture', label: 'Dispositivo de captura', content: capTab }
    ], tab);
    tabs.onSelect = id => { if (id === 'capture') loadDevices(); if (id === 'network') setTimeout(() => urlIn.focus(), 0); };
    if (tab === 'capture') loadDevices();
    w.body.append(tabs, moreChk, more);

    const go = async (mode) => {
      const opts = { play: mode !== 'enqueue', subsFile: st.sub, extraAudio: st.extra, startTime: U.parseTime(st.start) || 0, stopTime: U.parseTime(st.stop) || 0 };
      const t = tabs.active;
      if (t === 'network') {
        if (!st.url.trim()) { app.error('Informe uma URL.'); return; }
        w.close();
        const items = await app.openURL(st.url.trim(), Object.assign({}, opts, { play: mode === 'play' || mode === 'stream' }));
        after(mode, items);
      } else if (t === 'capture') {
        w.close();
        const item = await app.openCapture(cap, { play: mode !== 'enqueue' });
        if (item) after(mode, [item]);
      } else {
        if (!st.files.length) { app.error('Adicione pelo menos um arquivo.'); return; }
        w.close();
        const items = app.openFiles(st.files, Object.assign({}, opts, { play: mode === 'play' || mode === 'stream' }));
        after(mode, items);
      }
    };
    const after = (mode, items) => {
      if (!items || !items.length) return;
      if (mode === 'convert') app.dialogs.convert(items);
      if (mode === 'stream') setTimeout(() => app.dialogs.stream(), 300);
    };
    const playBtn = F.button('Reproduzir', () => go('play'), 'primary');
    const dd = F.button('▾', e => app.menu.context([
      { label: 'Enfileirar', shortcut: 'Alt+E', action: () => go('enqueue') },
      { label: 'Reproduzir', shortcut: 'Alt+P', action: () => go('play') },
      { label: 'Transmitir', shortcut: 'Alt+S', action: () => go('stream') },
      { label: 'Converter', shortcut: 'Alt+O', action: () => go('convert') }
    ], e.clientX, e.clientY), 'primary split', { title: 'Mais ações', 'aria-label': 'Mais ações' });
    w.el.addEventListener('keydown', e => {
      if (!e.altKey) return;
      const k = e.key.toLowerCase();
      const m = { e: 'enqueue', p: 'play', s: 'stream', o: 'convert' }[k];
      if (m) { e.preventDefault(); go(m); }
    }, true);
    w.footer.append(el('div', { class: 'split-btn' }, playBtn, dd), F.button('Cancelar', () => w.close()));
    w.show();
    return w;
  }

  /** Escolhe os títulos principais de uma pasta de DVD/Blu-ray/CD. */
  function pickDiscTitles(files, type) {
    const vob = files.filter(f => /VTS_\d+_[1-9]\.VOB$/i.test(f.file.name));
    if ((type === 'dvd' || !type) && vob.length) {
      const groups = {};
      for (const f of vob) { const k = f.file.name.match(/VTS_(\d+)_/i)[1]; (groups[k] = groups[k] || []).push(f); }
      const best = Object.values(groups).sort((a, b) => b.reduce((s, f) => s + f.file.size, 0) - a.reduce((s, f) => s + f.file.size, 0));
      return best.flat().sort((a, b) => U.naturalCompare(a.file.name, b.file.name));
    }
    const m2ts = files.filter(f => /\.(m2ts|mts)$/i.test(f.file.name)).sort((a, b) => b.file.size - a.file.size);
    if (m2ts.length) return m2ts.slice(0, 10);
    const dat = files.filter(f => /\.(dat|mpg)$/i.test(f.file.name) && /MPEGAV|MPEG2/i.test(f.path || ''));
    if (dat.length) return dat;
    return files.filter(f => U.kindOf(f.file.name) === 'audio').sort((a, b) => U.naturalCompare(a.path, b.path));
  }

  /* ======================= Ir para o tempo (Ctrl+T) ======================= */
  function gotoTime(app) {
    const p = app.player;
    if (!p.item || p.isLive) { app.error('Nenhuma mídia com duração definida em reprodução.'); return; }
    const w = new Win({ id: 'goto', title: 'Ir para o tempo', width: 360, modal: true });
    const input = F.text(U.fmtTimeMs(p.currentTime), null, { autofocus: true, class: 'f-text time-input' });
    const go = () => {
      const t = U.parseTime(input.value);
      if (!isFinite(t)) { input.classList.add('invalid'); return; }
      p.seek(t);
      w.close();
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    w.body.append(F.row('Ir para o tempo:', input), F.hint(`Duração: ${U.fmtTimeMs(p.duration)} — formatos aceitos: hh:mm:ss.mmm, mm:ss, segundos ou 1h2m3s`));
    w.footer.append(F.button('Ir', go, 'primary'), F.button('Cancelar', () => w.close()));
    w.show();
    setTimeout(() => input.select(), 50);
  }

  /* ======================= Salvar lista (Ctrl+Y) ======================= */
  function savePlaylist(app) {
    const items = app.player.playlist.items;
    if (!items.length) { app.error('A lista de reprodução está vazia.'); return; }
    const w = new Win({ id: 'save-playlist', title: 'Salvar lista de reprodução no arquivo', width: 460, modal: true, icon: 'save' });
    let fmt = 'm3u8';
    const name = F.text('lista-de-reproducao', null);
    w.body.append(
      F.row('Nome do arquivo:', name),
      F.row('Formato:', F.select([['m3u8', 'Lista M3U8 (*.m3u8)'], ['m3u', 'Lista M3U (*.m3u)'], ['xspf', 'Lista XSPF (*.xspf)'], ['pls', 'Lista PLS (*.pls)'], ['html', 'Lista HTML (*.html)']], fmt, v => { fmt = v; })),
      F.hint('Arquivos locais são gravados apenas com o nome (navegadores não expõem o caminho completo). URLs de rede são gravadas integralmente.'));
    w.footer.append(F.button('Salvar', () => {
      const text = VW.playlistFormats.serialize(items, fmt === 'm3u' ? 'm3u' : fmt, name.value);
      const mime = { xspf: 'application/xspf+xml', pls: 'audio/x-scpls', html: 'text/html', m3u: 'audio/x-mpegurl', m3u8: 'application/vnd.apple.mpegurl' }[fmt];
      U.download(new Blob([text], { type: mime + ';charset=utf-8' }), (name.value || 'lista') + '.' + fmt);
      w.close();
    }, 'primary'), F.button('Cancelar', () => w.close()));
    w.show();
  }

  VW.dialogsOpen = { openMedia, gotoTime, savePlaylist, pickDiscTitles };
})(window.VW = window.VW || {});
