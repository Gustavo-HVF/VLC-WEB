/* VLC Web — Informações da mídia / codec / estatísticas (Ctrl+I, Ctrl+J), Mensagens e módulos (Ctrl+M),
 * Marcadores (Ctrl+B), Converter/Salvar (Ctrl+R), Transmitir (Ctrl+S), Ajuda (F1) e Sobre (Shift+F1). */
(function (VW) {
  'use strict';
  const U = VW.util;
  const el = U.el;
  const { Win, F } = VW.ui;

  const LANGS = { por: 'Português', pt: 'Português', 'pt-br': 'Português (Brasil)', eng: 'Inglês', en: 'Inglês', spa: 'Espanhol', es: 'Espanhol', fre: 'Francês', fra: 'Francês', fr: 'Francês', ger: 'Alemão', deu: 'Alemão', de: 'Alemão', ita: 'Italiano', it: 'Italiano', jpn: 'Japonês', ja: 'Japonês', kor: 'Coreano', ko: 'Coreano', chi: 'Chinês', zho: 'Chinês', zh: 'Chinês', rus: 'Russo', ru: 'Russo', ara: 'Árabe', ar: 'Árabe', hin: 'Hindi', dut: 'Holandês', nld: 'Holandês', pol: 'Polonês', tur: 'Turco', swe: 'Sueco', nor: 'Norueguês', dan: 'Dinamarquês', fin: 'Finlandês', gre: 'Grego', ell: 'Grego', heb: 'Hebraico', tha: 'Tailandês', vie: 'Vietnamita', ukr: 'Ucraniano', cze: 'Tcheco', ces: 'Tcheco', hun: 'Húngaro', rum: 'Romeno', ron: 'Romeno' };
  const langName = l => { const n = U.langName(l); return n && n.toLowerCase() !== String(l).toLowerCase() ? `${n} [${l}]` : (LANGS[String(l || '').toLowerCase()] || l || ''); };

  /* ======================= Informações da mídia ======================= */
  function mediaInfo(app, tab = 'general', item) {
    const p = app.player;
    item = item || p.item;
    Win.get('media-info') && Win.get('media-info').close();
    if (!item) { app.error('Nenhuma mídia selecionada.'); return; }
    const w = new Win({ id: 'media-info', title: tab === 'codec' ? 'Informações do codec' : 'Informações da mídia', width: 680, icon: 'info', className: 'info-win' });
    if (item.file && !item.info) p.readMeta(item).then(() => { if (Win.get('media-info') === w) { w.close(); mediaInfo(app, w.tabs.active, item); } });
    else if (item.url && !item.file && !item.remote) p.inspectRemote(item).then(() => { if (Win.get('media-info') === w && (item.info || item.remote)) { w.close(); mediaInfo(app, w.tabs.active, item); } });

    /* Geral (editável) */
    const fields = [['title', 'Título'], ['artist', 'Artista'], ['album', 'Álbum'], ['albumArtist', 'Artista do álbum'], ['genre', 'Gênero'], ['track', 'Faixa nº'], ['date', 'Data'],
      ['composer', 'Compositor'], ['publisher', 'Editora'], ['copyright', 'Direitos autorais'], ['encodedBy', 'Codificado por'], ['language', 'Idioma'], ['url', 'URL']];
    const inputs = {};
    const meta = Object.assign({ title: item.title }, item.meta);
    const grid = el('div', { class: 'meta-grid' });
    for (const [k, label] of fields) { inputs[k] = F.text(meta[k] || '', null); inputs[k].addEventListener('keydown', e => e.stopPropagation()); grid.append(el('label', {}, label), inputs[k]); }
    const desc = el('textarea', { class: 'f-text', rows: '3' }); desc.value = meta.comment || meta.description || '';
    const lyrics = el('textarea', { class: 'f-text', rows: '4' }); lyrics.value = meta.lyrics || '';
    for (const t of [desc, lyrics]) t.addEventListener('keydown', e => e.stopPropagation());
    const art = el('div', { class: 'meta-art' }, item.coverURL ? el('img', { src: item.coverURL, alt: 'Capa' }) : U.icon(item.kind === 'audio' ? 'music' : 'film', 'big'));
    const general = el('div', {},
      el('div', { class: 'meta-top' }, art, grid),
      F.row('Descrição / comentários:', desc),
      lyrics.value ? F.row('Letra:', lyrics) : null,
      el('div', { class: 'btn-row' },
        item.coverURL ? F.button('Salvar capa…', () => fetch(item.coverURL).then(r => r.blob()).then(b => U.download(b, U.stripExt(item.name) + '-capa.' + (b.type.split('/')[1] || 'jpg'))), 'small') : null,
        el('span', { class: 'grow' }),
        F.button('Salvar metadados', () => {
          for (const k in inputs) item.meta[k] = inputs[k].value.trim();
          item.meta.comment = desc.value.trim();
          if (lyrics.value) item.meta.lyrics = lyrics.value;
          if (item.meta.title) item.title = item.meta.title;
          p.playlist.emit('change');
          p.emit('meta', item);
          app.controls.osd('Metadados atualizados');
        }, 'primary small')),
      F.hint('Os metadados são atualizados na lista de reprodução (navegadores não podem gravar diretamente no arquivo original).'));

    /* Metadados extras */
    const extra = el('table', { class: 'kv' });
    const addKV = (k, v) => extra.appendChild(el('tr', {}, el('th', {}, k), el('td', {}, String(v))));
    if (item.info) { addKV('Formato', item.info.container || '—'); for (const [k, v] of Object.entries(item.info.extra)) addKV(k, v); }
    if (item.probe) for (const [k, v] of Object.entries(item.probe.metadata || {})) addKV(k, v);
    if (item.file) { addKV('Arquivo', item.file.name); addKV('Tamanho', U.fmtBytes(item.file.size) + ` (${item.file.size.toLocaleString('pt-BR')} bytes)`); addKV('Modificado em', new Date(item.file.lastModified).toLocaleString('pt-BR')); addKV('Tipo MIME', item.file.type || '—'); }
    if (item.url && item.remote) {
      const r = item.remote;
      if (item.remoteName) addKV('Nome do arquivo (servidor)', item.remoteName);
      if (isFinite(r.size)) addKV('Tamanho', U.fmtBytes(r.size) + ` (${r.size.toLocaleString('pt-BR')} bytes)`);
      if (r.type) addKV('Tipo MIME (servidor)', r.type);
      addKV('Acesso pela página (CORS)', r.cors ? 'permitido' : 'bloqueado — reprodução em modo de compatibilidade');
      if (r.cors) addKV('Leitura parcial (Range)', r.range ? 'sim' : 'não');
      if (r.status >= 400) addKV('Resposta do servidor', 'HTTP ' + r.status);
      if (item.downloaded) addKV('Cópia local', 'baixada nesta sessão');
    }
    if (!extra.children.length) addKV('—', 'Nenhum metadado extra');

    /* Codec */
    const codec = el('div', { class: 'codec-tree' });
    const renderCodec = () => {
      codec.textContent = '';
      const m = p.item === item ? p.media : null;
      const list = [];
      if (item.probe) {
        list.push(['Formato do contêiner', item.probe.format + (item.probe.bitrate ? ' — ' + U.fmtBitrate(item.probe.bitrate) : '')]);
        item.probe.streams.forEach(s => {
          const rows = [['Tipo', { video: 'Vídeo', audio: 'Áudio', subtitle: 'Legenda', data: 'Dados', attachment: 'Anexo' }[s.type] || s.type], ['Codec', s.codec + (s.profile ? ` (${s.profile})` : '')]];
          if (s.lang) rows.push(['Idioma', langName(s.lang)]);
          if (s.title) rows.push(['Descrição', s.title]);
          if (s.width) rows.push(['Resolução de vídeo', `${s.width}x${s.height}`]);
          if (s.fps) rows.push(['Taxa de quadros', s.fps]);
          if (s.pixFmt) rows.push(['Formato decodificado', s.pixFmt]);
          if (s.layout) rows.push(['Canais', s.layout]);
          if (s.sampleRate) rows.push(['Taxa de amostragem', s.sampleRate + ' Hz']);
          if (s.bitrate) rows.push(['Taxa de bits', U.fmtBitrate(s.bitrate)]);
          if (s.default) rows.push(['Padrão', 'sim']);
          codec.appendChild(streamBox(`Fluxo ${s.index}`, rows));
        });
      } else if (item.info && item.info.tracks.length) {
        list.push(['Formato do contêiner', item.info.container]);
        item.info.tracks.forEach((t, i) => {
          const rows = [['Tipo', { video: 'Vídeo', audio: 'Áudio', subtitle: 'Legenda' }[t.type]], ['Codec', t.codec || '—']];
          if (t.lang) rows.push(['Idioma', langName(t.lang)]);
          if (t.name) rows.push(['Descrição', t.name]);
          if (t.width) rows.push(['Resolução de vídeo', `${t.width}x${t.height}`]);
          if (t.channels) rows.push(['Canais', typeof t.channels === 'number' ? `${t.channels} (${U.channelsLabel(t.channels)})` : t.channels]);
          if (t.sampleRate) rows.push(['Taxa de amostragem', t.sampleRate + ' Hz']);
          if (t.bits) rows.push(['Bits por amostra', t.bits]);
          if (t.default !== undefined && t.type !== 'video') rows.push(['Padrão', t.default ? 'sim' : 'não']);
          codec.appendChild(streamBox(`Fluxo ${i}`, rows));
        });
      }
      if (m && m.videoWidth) {
        const rows = [['Resolução decodificada', `${m.videoWidth}x${m.videoHeight}`], ['Resolução de saída', `${p.renderer.outW}x${p.renderer.outH}`]];
        if (p.renderer.fps) rows.push(['Taxa de quadros medida', p.renderer.fps.toFixed(3)]);
        const R = p.renderer;
        rows.push(['Saída de vídeo', R.tainted ? 'Elemento de vídeo (modo de compatibilidade)' : R.direct ? 'Elemento de vídeo (exibição direta, sem efeitos)' : 'WebGL']);
        if (!R.cssMode && R.outW < R.natW - 1) rows.push(['Resolução de processamento', `${R.outW}x${R.outH} (limite: ${resLabel(app.settings.get('maxResolution'))})`]);
        if (p.perfStats && p.perfStats.total) rows.push(['Quadros descartados', `${p.perfStats.dropped} de ${p.perfStats.total}`]);
        codec.appendChild(streamBox('Decodificação no navegador', rows));
      }
      if (p.hls && p.item === item) {
        const lv = p.hls.levels[p.hls.currentLevel];
        if (lv) codec.appendChild(streamBox('HLS', [['Qualidade atual', `${lv.width}x${lv.height}`], ['Codecs', [lv.videoCodec, lv.audioCodec].filter(Boolean).join(', ')], ['Taxa de bits', U.fmtBitrate(lv.bitrate)]]));
      }
      if (list.length) codec.prepend(streamBox('Geral', list));
      if (!codec.children.length) codec.appendChild(el('p', { class: 'muted' }, 'Sem informações de codec. ' + (item.file ? 'Use a análise detalhada abaixo.' : '')));
    };
    renderCodec();
    const codecTab = el('div', {}, codec, item.file ? el('div', { class: 'btn-row' }, F.button('Análise detalhada com FFmpeg', async (e) => {
      const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Analisando…';
      try { item.probe = await app.ffmpeg.probe(item.file); renderCodec(); } catch (err) { app.error('Falha na análise: ' + err.message); }
      btn.disabled = false; btn.textContent = 'Análise detalhada com FFmpeg';
    }, 'small'), item.probe ? F.button('Copiar relatório', () => navigator.clipboard && navigator.clipboard.writeText(item.probe.raw), 'small') : null) : null);

    /* Estatísticas */
    const stats = el('div', { class: 'codec-tree' });
    const renderStats = () => {
      stats.textContent = '';
      const m = p.media;
      if (p.item !== item || !m) { stats.appendChild(el('p', { class: 'muted' }, 'Estatísticas disponíveis apenas para a mídia em reprodução.')); return; }
      const dur = p.duration;
      const input = [];
      if (item.file) { input.push(['Tamanho', U.fmtBytes(item.file.size)]); if (isFinite(dur) && dur > 0) input.push(['Taxa de bits média', U.fmtBitrate(item.file.size * 8 / dur)]); }
      let buf = 0; if (m.buffered) for (let i = 0; i < m.buffered.length; i++) buf += m.buffered.end(i) - m.buffered.start(i);
      input.push(['Conteúdo em buffer', U.fmtTime(buf)]);
      input.push(['Estado da rede', ['vazio', 'ocioso', 'carregando', 'sem fonte'][m.networkState] || '—']);
      if (p.hls) { input.push(['Largura de banda estimada', U.fmtBitrate(p.hls.bandwidthEstimate)]); }
      stats.appendChild(streamBox('Entrada / leitura', input));
      if (m.getVideoPlaybackQuality) {
        const q = m.getVideoPlaybackQuality();
        stats.appendChild(streamBox('Vídeo', [['Quadros decodificados', q.totalVideoFrames], ['Quadros exibidos', q.totalVideoFrames - q.droppedVideoFrames], ['Quadros perdidos', q.droppedVideoFrames], ['Quadros corrompidos', q.corruptedVideoFrames ?? '—'], ['Taxa de quadros', p.renderer.fps ? p.renderer.fps.toFixed(2) + ' q/s' : '—']]));
      }
      const a = [];
      if (p.audio.ctx) { a.push(['Taxa de amostragem da saída', p.audio.ctx.sampleRate + ' Hz'], ['Latência', Math.round(((p.audio.ctx.baseLatency || 0) + (p.audio.ctx.outputLatency || 0)) * 1000) + ' ms']); }
      if (m.webkitAudioDecodedByteCount !== undefined) a.push(['Dados de áudio decodificados', U.fmtBytes(m.webkitAudioDecodedByteCount)]);
      if (m.webkitVideoDecodedByteCount !== undefined) a.push(['Dados de vídeo decodificados', U.fmtBytes(m.webkitVideoDecodedByteCount)]);
      a.push(['Velocidade', p.rate.toFixed(2) + 'x']);
      stats.appendChild(streamBox('Áudio / decodificação', a));
    };
    renderStats();
    const timer = setInterval(() => { if (w.tabs.active === 'stats') renderStats(); }, 1000);
    w.onDispose(() => clearInterval(timer));

    w.tabs = F.tabs([
      { id: 'general', label: 'Geral', content: general },
      { id: 'meta', label: 'Metadados extras', content: el('div', { class: 'scroll' }, extra) },
      { id: 'codec', label: 'Codec', content: codecTab },
      { id: 'stats', label: 'Estatísticas', content: stats }
    ], tab);
    w.tabs.onSelect = id => { w.setTitle(id === 'codec' ? 'Informações do codec' : 'Informações da mídia'); if (id === 'stats') renderStats(); };
    w.body.append(w.tabs, F.row('Localização:', F.text(item.uri, null, { readonly: true })));
    w.footer.append(F.button('Fechar', () => w.close(), 'primary'));
    w.show();
  }

  function streamBox(title, rows) {
    return el('details', { class: 'stream-box', open: true }, el('summary', {}, title), el('table', { class: 'kv' }, rows.map(([k, v]) => el('tr', {}, el('th', {}, k), el('td', {}, String(v))))));
  }

  /* ======================= Mensagens / módulos ======================= */
  function messages(app) {
    const ex = Win.get('messages');
    if (ex) { ex.focus(); return; }
    const log = app.log;
    const w = new Win({ id: 'messages', title: 'Mensagens', width: 760, icon: 'log', className: 'messages-win' });
    let level = 'info';
    const list = el('div', { class: 'log-list', tabindex: '0' });
    const q = F.text('', () => render(), { placeholder: 'Filtrar…' });
    q.addEventListener('keydown', e => e.stopPropagation());
    const line = e => el('div', { class: 'log-line ' + e.level }, el('span', { class: 'log-time' }, e.time.toLocaleTimeString('pt-BR')), el('span', { class: 'log-mod' }, e.module), el('span', { class: 'log-lvl' }, { error: 'erro', warn: 'aviso', info: 'info', debug: 'depuração' }[e.level]), el('span', { class: 'log-msg' }, e.msg));
    const ok = e => VW.Logger.LEVELS[e.level] <= VW.Logger.LEVELS[level] && (!q.value || (e.module + ' ' + e.msg).toLowerCase().includes(q.value.toLowerCase()));
    const render = () => { list.textContent = ''; const f = document.createDocumentFragment(); for (const e of log.items) if (ok(e)) f.appendChild(line(e)); list.appendChild(f); list.scrollTop = list.scrollHeight; };
    const off = log.on('message', e => { if (!ok(e)) return; const atEnd = list.scrollTop + list.clientHeight >= list.scrollHeight - 30; list.appendChild(line(e)); if (atEnd) list.scrollTop = list.scrollHeight; });
    const off2 = log.on('clear', render);
    w.onDispose(off); w.onDispose(off2);
    const msgTab = el('div', {},
      el('div', { class: 'btn-row' }, el('span', {}, 'Nível de detalhamento:'), F.select([['error', '0 (somente erros)'], ['warn', '1 (avisos)'], ['info', '2 (informações)'], ['debug', '3 (depuração)']], level, v => { level = v; render(); }), q),
      list,
      el('div', { class: 'btn-row' }, F.button('Limpar', () => log.clear(), 'small'), F.button('Salvar como…', () => U.download(new Blob([log.toText(level)], { type: 'text/plain;charset=utf-8' }), 'vlcweb-mensagens.txt'), 'small')));
    w.body.appendChild(F.tabs([{ id: 'msg', label: 'Mensagens', content: msgTab }, { id: 'mod', label: 'Módulos', render: () => modules(app) }], 'msg'));
    w.footer.append(F.button('Fechar', () => w.close(), 'primary'));
    w.show();
    render();
  }

  function modules(app) {
    const S = U.supports;
    const yes = v => v ? '✔ disponível' : '✘ indisponível';
    const v = document.createElement('video');
    const can = t => { const r = v.canPlayType(t); return r === 'probably' ? '✔ sim' : r === 'maybe' ? '≈ provavelmente' : '✘ não (usa FFmpeg)'; };
    const caps = [
      ['Saída de vídeo WebGL (filtros de vídeo)', yes(S.webgl)], ['Web Audio (equalizador e efeitos)', yes(S.webAudio)], ['AudioWorklet (mudança de tom)', yes(S.audioWorklet)],
      ['MediaRecorder (gravação)', yes(S.mediaRecorder)], ['Media Source Extensions (HLS/DASH)', yes(S.mse)], ['Picture‑in‑Picture', yes(S.pip)], ['Document Picture‑in‑Picture', yes(S.docPip)],
      ['Acesso a arquivos persistente', yes(S.fsAccess)], ['Acesso a pastas persistente', yes(S.dirPicker)], ['Captura de tela', yes(S.displayMedia)], ['Câmera/microfone', yes(S.userMedia)],
      ['Remote Playback (Chromecast/AirPlay)', yes(S.remotePlayback)], ['Seleção de saída de áudio', yes(S.ctxSinkId)], ['WebRTC (transmissão)', yes(S.webrtc)], ['Teclas de mídia do sistema', yes(S.mediaSession)],
      ['Motor FFmpeg (WebAssembly)', S.worker ? 'disponível (' + ({ idle: 'não carregado', loading: 'carregando', ready: 'carregado', error: 'erro' }[app.ffmpeg.state]) + ')' : '✘ requer HTTP(S)'],
      ['hls.js (HLS)', 'disponível (sob demanda)'], ['dash.js (MPEG‑DASH)', 'disponível (sob demanda)']
    ];
    const codecs = [
      ['H.264 / AVC', 'video/mp4; codecs="avc1.640028"'], ['H.265 / HEVC', 'video/mp4; codecs="hvc1.1.6.L93.B0"'], ['VP8', 'video/webm; codecs="vp8"'], ['VP9', 'video/webm; codecs="vp9"'],
      ['AV1', 'video/mp4; codecs="av01.0.05M.08"'], ['Theora', 'video/ogg; codecs="theora"'], ['MPEG‑2 Vídeo', 'video/mpeg'], ['AAC', 'audio/mp4; codecs="mp4a.40.2"'], ['MP3', 'audio/mpeg'],
      ['Opus', 'audio/webm; codecs="opus"'], ['Vorbis', 'audio/ogg; codecs="vorbis"'], ['FLAC', 'audio/flac'], ['WAV/PCM', 'audio/wav'], ['AC‑3', 'audio/mp4; codecs="ac-3"'], ['E‑AC‑3', 'audio/mp4; codecs="ec-3"'],
      ['Matroska (MKV)', 'video/x-matroska'], ['MPEG‑TS', 'video/mp2t'], ['HLS nativo', 'application/vnd.apple.mpegurl']
    ];
    return el('div', { class: 'scroll' },
      F.group('Recursos do navegador', el('table', { class: 'kv' }, caps.map(([k, val]) => el('tr', {}, el('th', {}, k), el('td', {}, val))))),
      F.group('Decodificação nativa', el('table', { class: 'kv' }, codecs.map(([k, t]) => el('tr', {}, el('th', {}, k), el('td', {}, can(t)))))));
  }

  /* ======================= Marcadores ======================= */
  function bookmarks(app) {
    const ex = Win.get('bookmarks');
    if (ex) { ex.focus(); return; }
    const p = app.player;
    const w = new Win({ id: 'bookmarks', title: 'Editar marcadores', width: 520, icon: 'bookmark' });
    const table = el('div', { class: 'bm-table' });
    let selected = -1;
    const render = () => {
      table.textContent = '';
      table.appendChild(el('div', { class: 'bm-row head' }, el('span', {}, 'Nome'), el('span', {}, 'Tempo')));
      const list = p.bookmarks;
      if (!p.item) table.appendChild(el('p', { class: 'muted' }, 'Nenhuma mídia em reprodução.'));
      list.forEach((b, i) => {
        const name = F.text(b.name, v => { const l = p.bookmarks.slice(); l[i] = Object.assign({}, l[i], { name: v }); p.saveBookmarks(l); });
        name.addEventListener('keydown', e => e.stopPropagation());
        const row = el('div', { class: 'bm-row' + (i === selected ? ' selected' : '') }, name, el('button', { type: 'button', class: 'link', onclick: () => p.seek(b.time) }, U.fmtTimeMs(b.time)));
        row.addEventListener('click', () => { selected = i; U.$$('.bm-row', table).forEach((r, k) => r.classList.toggle('selected', k - 1 === i)); });
        row.addEventListener('dblclick', () => p.seek(b.time));
        table.appendChild(row);
      });
    };
    const off = p.on('bookmarks', render), off2 = p.on('item', () => { selected = -1; render(); });
    w.onDispose(off); w.onDispose(off2);
    render();
    w.body.append(table);
    w.footer.append(
      F.button('Criar', () => p.addBookmark()),
      F.button('Excluir', () => { if (selected < 0) return; const l = p.bookmarks.slice(); l.splice(selected, 1); selected = -1; p.saveBookmarks(l); }),
      F.button('Limpar', () => { selected = -1; p.saveBookmarks([]); }),
      F.button('Extrair trecho…', () => {
        const l = p.bookmarks;
        if (l.length < 2 || !p.item) { app.error('Crie pelo menos dois marcadores para extrair o trecho entre eles.'); return; }
        const a = selected >= 0 && selected < l.length - 1 ? selected : 0;
        convert(app, [p.item], { start: l[a].time, end: l[a + 1].time });
      }),
      el('span', { class: 'grow' }),
      F.button('Fechar', () => w.close(), 'primary'));
    w.show();
  }

  /* ======================= Converter / Salvar ======================= */
  const PROFILES = [
    { id: 'h264-mp3', name: 'Vídeo — H.264 + MP3 (MP4)', ext: 'mp4', mime: 'video/mp4', v: ['libx264', '-preset', 'veryfast'], vq: 'crf', a: ['libmp3lame'], rt: 'mp4' },
    { id: 'h264-aac', name: 'Vídeo — H.264 + AAC (MP4)', ext: 'mp4', mime: 'video/mp4', v: ['libx264', '-preset', 'veryfast'], vq: 'crf', a: ['aac'], rt: 'mp4' },
    { id: 'vp8-vorbis', name: 'Vídeo — VP80 + Vorbis (WebM)', ext: 'webm', mime: 'video/webm', v: ['libvpx', '-deadline', 'good', '-cpu-used', '4'], vq: 'bitrate', a: ['libvorbis'], rt: 'webm' },
    { id: 'vp9-vorbis', name: 'Vídeo — VP9 + Vorbis (WebM)', ext: 'webm', mime: 'video/webm', v: ['libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-b:v', '0'], vq: 'crf', a: ['libvorbis'], rt: 'webm' },
    { id: 'theora', name: 'Vídeo — Theora + Vorbis (OGG)', ext: 'ogv', mime: 'video/ogg', v: ['libtheora'], vq: 'qv', a: ['libvorbis'] },
    { id: 'mpeg2-ts', name: 'Vídeo — MPEG-2 + MPGA (TS)', ext: 'ts', mime: 'video/mp2t', v: ['mpeg2video'], vq: 'bitrate', a: ['mp2'] },
    { id: 'mpeg4-avi', name: 'Vídeo — MPEG-4 + MP3 (AVI)', ext: 'avi', mime: 'video/x-msvideo', v: ['mpeg4'], vq: 'bitrate', a: ['libmp3lame'] },
    { id: 'gif', name: 'Vídeo — GIF animado', ext: 'gif', mime: 'image/gif', gif: true },
    { id: 'mp3', name: 'Áudio — MP3', ext: 'mp3', mime: 'audio/mpeg', a: ['libmp3lame'], audioOnly: true },
    { id: 'aac', name: 'Áudio — AAC (M4A)', ext: 'm4a', mime: 'audio/mp4', a: ['aac'], audioOnly: true, rt: 'mp4' },
    { id: 'vorbis', name: 'Áudio — Vorbis (OGG)', ext: 'ogg', mime: 'audio/ogg', a: ['libvorbis'], audioOnly: true },
    { id: 'flac', name: 'Áudio — FLAC', ext: 'flac', mime: 'audio/flac', a: ['flac'], audioOnly: true, lossless: true },
    { id: 'wav', name: 'Áudio — CD (WAV 44,1 kHz, 16 bits)', ext: 'wav', mime: 'audio/wav', a: ['pcm_s16le', '-ar', '44100', '-ac', '2'], audioOnly: true, lossless: true },
    { id: 'copy-mp4', name: 'Remultiplexar — copiar fluxos para MP4 (sem perdas)', ext: 'mp4', mime: 'video/mp4', copy: true },
    { id: 'copy-mkv', name: 'Remultiplexar — copiar fluxos para MKV (sem perdas)', ext: 'mkv', mime: 'video/x-matroska', copy: true }
  ];

  function buildArgs(pr, o) {
    if (pr.copy) return ['-map', '0', '-c', 'copy'].concat(pr.ext === 'mp4' ? ['-movflags', '+faststart'] : []);
    if (pr.gif) {
      const h = o.height > 0 ? o.height : 360;
      return ['-vf', `fps=${o.fps > 0 ? Math.min(o.fps, 25) : 12},scale=-2:${h}:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`, '-an'];
    }
    const args = [];
    if (pr.audioOnly || o.noVideo) args.push('-vn');
    else {
      args.push('-c:v', ...pr.v);
      if (pr.vq === 'crf') args.push('-crf', String(o.crf));
      else if (pr.vq === 'qv') args.push('-q:v', String(Math.round(10 - o.crf / 6)));
      else args.push('-b:v', o.vbitrate + 'k');
      const vf = [];
      if (o.height > 0) vf.push(`scale=-2:${o.height}`);
      if (o.fps > 0) vf.push(`fps=${o.fps}`);
      if (vf.length) args.push('-vf', vf.join(','));
      args.push('-pix_fmt', 'yuv420p');
      if (pr.ext === 'mp4') args.push('-movflags', '+faststart');
    }
    if (o.noAudio) args.push('-an');
    else {
      args.push('-c:a', ...pr.a);
      if (!pr.lossless) args.push('-b:a', o.abitrate + 'k');
      if (o.samplerate > 0 && !pr.a.includes('-ar')) args.push('-ar', String(pr.a[0] === 'libopus' ? 48000 : o.samplerate));
      if (o.channels > 0 && !pr.a.includes('-ac')) args.push('-ac', String(o.channels));
    }
    args.push('-sn');
    return args;
  }

  const resLabel = v => ({ auto: 'automática', original: 'original' }[v] || v + 'p');

  function convert(app, items, preset = {}) {
    const p = app.player;
    items = (items && items.length ? items : (p.item ? [p.item] : [])).filter(i => !i.stream);
    const w = new Win({ id: 'convert-' + Date.now(), title: 'Converter', width: 660, icon: 'convert', modal: true });
    const o = { profile: 'h264-mp3', engine: 'ffmpeg', crf: 23, vbitrate: 2500, abitrate: 192, samplerate: 0, channels: 0, height: 0, fps: 0, noAudio: false, noVideo: false, start: preset.start || 0, end: preset.end || 0 };
    if (preset.height) o.height = +preset.height;
    const srcList = el('div', { class: 'file-list small' });
    const renderSrc = () => {
      srcList.textContent = '';
      if (!items.length) srcList.appendChild(el('div', { class: 'muted' }, 'Nenhuma origem. Adicione arquivos.'));
      items.forEach(it => srcList.appendChild(el('div', { class: 'file-row' }, U.icon(it.kind === 'audio' ? 'music' : it.url ? 'network' : 'film'), el('span', { class: 'grow' }, it.uri))));
    };
    renderSrc();
    const profSel = F.select(PROFILES.map(x => [x.id, x.name]), o.profile, v => { o.profile = v; updateDest(); updateVis(); });
    const dest = F.text('', null);
    const updateDest = () => {
      const pr = PROFILES.find(x => x.id === o.profile);
      dest.value = items.length === 1 ? `${U.stripExt(items[0].name) || 'convertido'}${o.engine === 'realtime' ? '-gravado' : ''}.${o.engine === 'realtime' ? (pr.rt === 'mp4' ? (pr.audioOnly ? 'm4a' : 'mp4') : 'webm') : pr.ext}` : `(nome original).${pr.ext}`;
      dest.disabled = items.length !== 1;
    };
    const vBox = el('div', { class: 'grid2' },
      F.row('Resolução:', F.select([['0', 'Original'], ['2160', '2160p (4K)'], ['1080', '1080p'], ['720', '720p'], ['480', '480p'], ['360', '360p'], ['240', '240p']], String(o.height || 0), v => { o.height = +v; })),
      F.row('Taxa de quadros:', F.select([['0', 'Original'], ['60', '60'], ['30', '30'], ['25', '25'], ['24', '24'], ['15', '15'], ['10', '10']], '0', v => { o.fps = +v; })),
      F.row('Qualidade (CRF; menor = melhor):', F.slider({ min: 15, max: 40, step: 1, value: o.crf, onInput: v => { o.crf = v; } })),
      F.row('Taxa de bits de vídeo:', F.number(o.vbitrate, v => { o.vbitrate = v; }, { min: 100, max: 50000, step: 100 }), el('span', { class: 'muted' }, 'kb/s')),
      F.check('Sem vídeo', false, v => { o.noVideo = v; }));
    const aBox = el('div', { class: 'grid2' },
      F.row('Taxa de bits de áudio:', F.select(['64', '96', '128', '160', '192', '256', '320'].map(x => [x, x + ' kb/s']), '192', v => { o.abitrate = +v; })),
      F.row('Taxa de amostragem:', F.select([['0', 'Original'], ['22050', '22050 Hz'], ['44100', '44100 Hz'], ['48000', '48000 Hz']], '0', v => { o.samplerate = +v; })),
      F.row('Canais:', F.select([['0', 'Original'], ['1', 'Mono'], ['2', 'Estéreo']], '0', v => { o.channels = +v; })),
      F.check('Sem áudio', false, v => { o.noAudio = v; }));
    const profEdit = el('div', { class: 'profile-edit', hidden: !preset.height }, F.group('Codec de vídeo', vBox), F.group('Codec de áudio', aBox));
    const updateVis = () => { const pr = PROFILES.find(x => x.id === o.profile); vBox.hidden = !!(pr.audioOnly || pr.copy); aBox.hidden = !!(pr.copy || pr.gif); };
    updateVis();
    const engineRadio = F.radio('engine-' + w.id, [['ffmpeg', 'FFmpeg (rápido, converte o arquivo original)'], ['realtime', 'Tempo real (grava a reprodução com os efeitos de áudio e vídeo aplicados)']], o.engine, v => { o.engine = v; updateDest(); });
    const prog = F.progress();
    const progLabel = el('div', { class: 'muted small' }, '');
    const progBox = el('div', { class: 'conv-progress', hidden: true }, progLabel, prog);
    w.body.append(
      F.group('Origem', srcList, el('div', { class: 'btn-row' }, F.button('Adicionar arquivos…', async () => {
        const f = await app.pickFiles({ multiple: true });
        items = items.concat(f.map(x => new VW.PlaylistItem({ file: x.file, handle: x.handle })));
        renderSrc(); updateDest();
      }, 'small'))),
      F.group('Configurações', engineRadio,
        el('div', { class: 'btn-row' }, el('span', {}, 'Perfil:'), profSel, F.button('Editar perfil', () => { profEdit.hidden = !profEdit.hidden; }, 'small')),
        profEdit,
        preset.height ? F.hint('Cria uma cópia mais leve do vídeo (menos trabalho para decodificar). A conversão roda no navegador, sem aceleração de hardware: para vídeos 4K ela é lenta e pode levar mais tempo que a duração do vídeo. Prefira usar em trechos (início/fim) ou deixar convertendo.', 'warn') : null,
        el('div', { class: 'grid2' },
          F.row('Início:', F.text(o.start ? U.fmtTimeMs(o.start) : '', v => { o.start = U.parseTime(v) || 0; }, { placeholder: '00:00:00' })),
          F.row('Fim:', F.text(o.end ? U.fmtTimeMs(o.end) : '', v => { o.end = U.parseTime(v) || 0; }, { placeholder: '(até o final)' })))),
      F.group('Destino', F.row('Arquivo de destino:', dest), F.hint('O arquivo convertido é salvo na pasta de downloads do navegador.')),
      progBox);
    updateDest();
    let ctrl = null;
    const startBtn = F.button('Iniciar', async () => {
      if (!items.length) { app.error('Nenhuma origem para converter.'); return; }
      startBtn.disabled = true; progBox.hidden = false;
      ctrl = new AbortController();
      const pr = PROFILES.find(x => x.id === o.profile);
      let i = 0;
      try {
        for (const it of items) {
          i++;
          const prefix = items.length > 1 ? `[${i}/${items.length}] ` : '';
          const outName = items.length === 1 ? dest.value : `${U.stripExt(it.name)}.${pr.ext}`;
          if (o.engine === 'realtime') {
            progLabel.textContent = prefix + 'Gravando em tempo real: ' + it.title;
            const mime = VW.Recorder.pickMime(!pr.audioOnly && !o.noVideo, pr.rt || 'webm');
            const res = await app.recorder.realtimeConvert(it, { start: o.start, end: o.end, mime, signal: ctrl.signal, audioBitrate: o.abitrate * 1000, onProgress: x => prog.set(x) });
            U.download(res.blob, U.stripExt(outName) + '.' + res.ext);
          } else {
            let src = it.playable && pr.copy ? it.playable : it.file;
            if (!src && it.url) {
              progLabel.textContent = prefix + 'Baixando ' + it.url;
              src = await fetchBlob(it.url, x => prog.set(x), ctrl.signal);
              src = new File([src], U.baseName(it.url) || 'entrada', { type: src.type });
            }
            if (!src) throw new Error('Origem não suportada para conversão: ' + it.title);
            progLabel.textContent = prefix + 'Carregando FFmpeg…';
            await app.ffmpeg.load(x => { progLabel.textContent = prefix + 'Baixando o motor FFmpeg (~31 MB)…'; prog.set(x); });
            progLabel.textContent = prefix + 'Convertendo: ' + it.title;
            ctrl.signal.addEventListener('abort', () => app.ffmpeg.cancel(), { once: true });
            const blob = await app.ffmpeg.convert(src, { args: buildArgs(pr, o), ext: pr.ext, mime: pr.mime, start: o.start, end: o.end, duration: it.duration, onProgress: x => { prog.set(x); progLabel.textContent = `${prefix}Convertendo: ${it.title} — ${Math.round(x * 100)}%`; } });
            U.download(blob, outName);
            app.log.info('convert', `Convertido: ${outName} (${U.fmtBytes(blob.size)})`);
          }
        }
        progLabel.textContent = 'Concluído!'; prog.set(1);
        app.controls.osd('Conversão concluída');
        startBtn.disabled = false;
      } catch (e) {
        startBtn.disabled = false;
        if (e.name === 'AbortError' || /terminate|cancel/i.test(e.message || e)) { progLabel.textContent = 'Cancelado.'; return; }
        progLabel.textContent = 'Erro: ' + (e.message || e);
        app.error('Falha na conversão: ' + (e.message || e));
      } finally { ctrl = null; }
    }, 'primary');
    w.footer.append(startBtn, F.button('Cancelar', () => { if (ctrl) ctrl.abort(); else w.close(); }));
    w.opts.onClose = () => { if (ctrl) ctrl.abort(); };
    w.show();
  }

  async function fetchBlob(url, onProgress, signal) {
    let res;
    try { res = await fetch(url, { signal }); } catch (e) { throw new Error('O servidor não permite download pelo navegador (CORS) ou está inacessível.'); }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const total = +res.headers.get('content-length') || 0;
    const reader = res.body.getReader();
    const chunks = []; let got = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; onProgress(total ? got / total : -1); }
    return new Blob(chunks, { type: res.headers.get('content-type') || '' });
  }

  /* ======================= Transmitir ======================= */
  function stream(app) {
    const ex = Win.get('stream');
    if (ex) { ex.focus(); return; }
    const p = app.player, srv = app.streamServer;
    const w = new Win({ id: 'stream', title: 'Transmitir', width: 600, icon: 'stream' });
    const status = el('div', { class: 'stream-status' });
    const render = () => {
      status.textContent = '';
      if (!srv.active) { status.appendChild(el('p', { class: 'muted' }, 'Transmissão local parada.')); return; }
      const link = srv.receiverURL;
      status.append(
        el('p', {}, el('b', {}, '● Transmitindo'), ` no canal "${srv.channel}" — ${srv.peers.size} receptor(es) conectado(s).`),
        F.row('Endereço do receptor:', F.text(link, null, { readonly: true })),
        el('div', { class: 'btn-row' },
          F.button('Abrir receptor', () => window.open(link, '_blank', 'noopener,width=960,height=560'), 'small'),
          F.button('Copiar endereço', () => navigator.clipboard && navigator.clipboard.writeText(link).then(() => app.controls.osd('Endereço copiado')), 'small'),
          F.button('Parar transmissão', () => srv.stop(), 'small danger')));
    };
    const off = srv.on('change', render);
    w.onDispose(off);
    render();
    w.body.append(
      F.group('Origem', el('p', {}, p.item ? p.item.displayTitle : 'Nenhuma mídia em reprodução — abra uma mídia primeiro.')),
      F.group('Destino: outra aba ou janela deste navegador (WebRTC)',
        F.hint('Envia o vídeo processado (com efeitos) e o áudio em tempo real para receptores abertos neste mesmo navegador/computador — por exemplo, numa segunda tela ou projetor.'),
        el('div', { class: 'btn-row' }, F.button('Iniciar transmissão', () => {
          if (!p.item) { app.error('Abra uma mídia antes de transmitir.'); return; }
          try { srv.start(); window.open(srv.receiverURL, '_blank', 'noopener,width=960,height=560'); } catch (e) { app.error(e.message); }
        }, 'primary small')),
        status),
      F.group('Destino: Chromecast / AirPlay / TV (Remote Playback)',
        F.hint('Disponível para mídias de rede (URL direta) em navegadores compatíveis. Arquivos locais não podem ser enviados.'),
        el('div', { class: 'btn-row' }, F.button('Procurar dispositivos…', () => VW.castPrompt(p).catch(e => app.error(e.message)), 'small'))),
      F.group('Destino: arquivo',
        el('div', { class: 'btn-row' }, F.button('Gravar a reprodução', () => app.actions.run('record'), 'small'), F.button('Converter / salvar…', () => convert(app), 'small'))));
    w.footer.append(F.button('Fechar', () => w.close(), 'primary'));
    w.show();
  }

  /* ======================= Ajuda e Sobre ======================= */
  function help(app) {
    const ex = Win.get('help');
    if (ex) { ex.focus(); return; }
    const w = new Win({ id: 'help', title: 'Ajuda', width: 720, icon: 'help', className: 'help-win' });
    const groups = {};
    for (const a of app.actions.list()) { if (a.hidden) continue; (groups[a.category] = groups[a.category] || []).push(a); }
    const keys = el('div', { class: 'help-keys' }, Object.entries(groups).map(([cat, list]) => el('section', {}, el('h3', {}, cat),
      el('table', { class: 'kv' }, list.filter(a => app.actions.keysFor(a.id).length).map(a => el('tr', {}, el('th', {}, a.label), el('td', {}, app.actions.keysFor(a.id).map(k => el('kbd', {}, VW.ui.Actions.label(k))))))))));
    const intro = el('div', { class: 'help-intro', html: `
      <h2>Bem-vindo ao VLC Web</h2>
      <p>Um reprodutor multimídia completo que funciona no navegador, inspirado nos recursos do VLC para computador. Tudo é processado localmente: seus arquivos não são enviados para nenhum servidor.</p>
      <h3>Primeiros passos</h3>
      <ul>
        <li><b>Abrir mídia:</b> arraste arquivos ou pastas para a janela, use <kbd>Ctrl+O</kbd> ou o menu <i>Mídia</i>. Também é possível colar uma URL com <kbd>Ctrl+V</kbd>.</li>
        <li><b>Legendas:</b> arquivos de legenda com o mesmo nome do vídeo são carregados automaticamente. Use <i>Legenda → Adicionar arquivo de legenda</i> ou arraste o arquivo sobre o vídeo.</li>
        <li><b>Efeitos:</b> <kbd>Ctrl+E</kbd> abre o equalizador, compressor, espacializador, filtros de vídeo e sincronização.</li>
        <li><b>Formatos não suportados</b> pelo navegador (AVI, WMV, FLV, MPEG‑2, VOB, AC‑3, DTS…) são convertidos localmente pelo decodificador FFmpeg (WebAssembly).</li>
        <li><b>Menu de contexto:</b> clique com o botão direito sobre o vídeo para acessar todas as funções.</li>
        <li><b>Roda do mouse</b> sobre o vídeo ajusta o volume; sobre a barra de tempo, avança/retrocede.</li>
      </ul>
      <h3>Limitações do navegador</h3>
      <ul>
        <li>Leitura direta de DVD/Blu-ray/CD, TV, RTSP/UDP/RTMP e servidores SMB/FTP/UPnP não está disponível em páginas web.</li>
        <li>URLs de outros sites precisam permitir acesso de outras origens (CORS) para os efeitos de áudio e vídeo funcionarem.</li>
      </ul>` });
    w.body.appendChild(F.tabs([{ id: 'intro', label: 'Ajuda', content: intro }, { id: 'keys', label: 'Teclas de atalho', content: keys }], 'intro'));
    w.footer.append(F.button('Fechar', () => w.close(), 'primary'));
    w.show();
  }

  function about(app) {
    const ex = Win.get('about');
    if (ex) { ex.focus(); return; }
    const w = new Win({ id: 'about', title: 'Sobre', width: 560, icon: 'info', className: 'about-win', modal: true });
    w.body.appendChild(el('div', { class: 'about', html: `
      <img src="assets/logo.png" alt="VLC Web" class="about-logo" width="104" height="104">
      <h2>VLC Web <small>${VW.VERSION}</small></h2>
      <p>Reprodutor multimídia para o navegador escrito em HTML, CSS e JavaScript, que reproduz os recursos da versão para computador do VLC media player: lista de reprodução, legendas, equalizador e efeitos de áudio, filtros de vídeo, captura, gravação, conversão, transmissão e muito mais.</p>
      <p class="muted small">Projeto independente, inspirado no VLC media player. Não é afiliado, patrocinado nem endossado pela VideoLAN. "VLC" é uma marca da VideoLAN.</p>
      <h3>Componentes de terceiros</h3>
      <ul class="small">
        <li><b>hls.js</b> — Apache License 2.0</li>
        <li><b>dash.js</b> — BSD 3-Clause (DASH Industry Forum)</li>
        <li><b>ffmpeg.wasm</b> — MIT; núcleo <b>FFmpeg</b> — LGPL/GPL (carregado sob demanda de cdn.jsdelivr.net)</li>
        <li>Diretório de rádios: <b>radio-browser.info</b></li>
        <li>Fontes de alguns temas: <b>Google Fonts</b> — SIL Open Font License / Apache 2.0 (carregadas sob demanda)</li>
      </ul>` }));
    w.footer.append(F.button('Mensagens / módulos', () => { w.close(); messages(app); }), el('span', { class: 'grow' }), F.button('Fechar', () => w.close(), 'primary'));
    w.show();
  }

  VW.dialogsInfo = { mediaInfo, messages, bookmarks, convert, stream, help, about, PROFILES, buildArgs };
})(window.VW = window.VW || {});
