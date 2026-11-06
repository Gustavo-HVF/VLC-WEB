/* VLC Web — aplicação: liga o núcleo à interface (ações, menus, atalhos, abertura de mídia, arrastar e soltar,
 * tela cheia, imagem sobre imagem, interface mínima, tema e inicialização). */
(function (VW) {
  'use strict';
  const U = VW.util;
  const el = U.el;
  VW.VERSION = '1.0.0';

  class App {
    constructor() {
      VW.app = this;
      this.settings = new VW.Settings();
      this.log = VW.log = new VW.Logger();
      this.ffmpeg = new VW.FFmpegEngine(this.settings, this.log);
      this.library = new VW.Library(this.log);
      this.player = new VW.Player({
        settings: this.settings, log: this.log, ffmpeg: this.ffmpeg, library: this.library,
        stage: U.$('#stage'), videoMain: U.$('#video-main'), videoRaw: U.$('#video-raw'),
        canvas: U.$('#gl-canvas'), subsLayer: U.$('#subs-layer'), visCanvas: U.$('#vis-canvas')
      });
      this.recorder = new VW.Recorder(this.player, this.settings, this.log);
      this.streamServer = new VW.LocalStreamServer(this.player, this.log);
      this.subSearch = new VW.SubSearch(this.settings, this.log);
      this.translator = new VW.SubtitleTranslator(this.settings, this.log);
      this.actions = new VW.ui.Actions(this.settings);
      this.dialogs = {
        open: tab => VW.dialogsOpen.openMedia(this, tab),
        gotoTime: () => VW.dialogsOpen.gotoTime(this),
        savePlaylist: () => VW.dialogsOpen.savePlaylist(this),
        effects: tab => VW.dialogsEffects.effects(this, tab),
        prefs: s => VW.dialogsPrefs.prefs(this, s),
        customize: () => VW.dialogsPrefs.customize(this),
        mediaInfo: (tab, item) => VW.dialogsInfo.mediaInfo(this, tab, item),
        messages: () => VW.dialogsInfo.messages(this),
        bookmarks: () => VW.dialogsInfo.bookmarks(this),
        convert: (items, preset) => VW.dialogsInfo.convert(this, items, preset),
        stream: () => VW.dialogsInfo.stream(this),
        help: () => VW.dialogsInfo.help(this),
        about: () => VW.dialogsInfo.about(this),
        skins: tab => VW.dialogsSkins.gallery(this, tab),
        audioDiag: () => VW.dialogsAudio.diagnostics(this),
        subSearch: tab => VW.dialogsSubs.search(this, tab),
        subTranslate: () => VW.dialogsSubs.translate(this)
      };
      this.defineActions();
      this.menu = new VW.ui.MenuSystem(U.$('#menubar'), this.menuDefs(), id => this.actions.shortcutLabel(id));
      this.controls = new VW.ui.Controls(this);
      this.playlistView = new VW.ui.PlaylistView(this);
      this.player.renderer.miniMap = U.$('#zoom-map');
      this.bindGlobal();
      this.bindPlayer();
      this.applyTheme();
      this.applyMinimal();
      this.loadEffects();
      this.library.init();
      this.player.setVolume(this.settings.get('rememberVolume') ? this.settings.get('volume') : 1, true);
      this.log.info('main', `VLC Web ${VW.VERSION} iniciado — ${navigator.userAgent}`);
      this.handleLaunchQueue();
      this.handleUrlParams();
      VW.remote.cleanup();
    }

    /* ======================= Ações ======================= */
    defineActions() {
      const A = this.actions, p = this.player, S = this.settings;
      const def = (id, label, run, keys = [], category = 'Reprodução', extra = {}) => A.define(id, Object.assign({ label, run, keys, category }, extra));
      const jump = (k, dir) => () => p.seekRel(dir * S.get(k));

      // Mídia
      def('open-file', 'Abrir arquivo…', () => this.quickOpenFiles(), ['Ctrl+O'], 'Mídia');
      def('open-multi', 'Abrir múltiplos arquivos…', () => this.dialogs.open('file'), ['Ctrl+Shift+O'], 'Mídia');
      def('open-folder', 'Abrir pasta…', () => this.quickOpenFolder(), ['Ctrl+F'], 'Mídia');
      def('open-disc', 'Abrir disco…', () => this.dialogs.open('disc'), ['Ctrl+D'], 'Mídia');
      def('open-network', 'Abrir transmissão de rede…', () => this.dialogs.open('network'), ['Ctrl+N', 'Alt+N'], 'Mídia');
      def('open-capture', 'Abrir dispositivo de captura…', () => this.dialogs.open('capture'), ['Ctrl+C'], 'Mídia');
      def('open-clipboard', 'Abrir local da área de transferência', () => this.openClipboard(), ['Ctrl+V'], 'Mídia');
      def('add-file', 'Adicionar arquivo à lista…', () => this.quickOpenFiles(false), [], 'Mídia');
      def('add-folder', 'Adicionar pasta à lista…', () => this.quickOpenFolder(false), [], 'Mídia');
      def('save-playlist', 'Salvar lista de reprodução no arquivo…', () => this.dialogs.savePlaylist(), ['Ctrl+Y'], 'Mídia');
      def('convert', 'Converter / salvar…', () => this.dialogs.convert(), ['Ctrl+R'], 'Mídia');
      def('resolution-cycle', 'Alternar a resolução máxima do vídeo', () => this.cycleMaxResolution(), ['Alt+R'], 'Vídeo');
      def('stream', 'Transmitir…', () => this.dialogs.stream(), ['Ctrl+S'], 'Mídia');
      def('quit', 'Sair', () => this.quit(), ['Ctrl+Q'], 'Mídia');

      // Reprodução
      def('play-pause', 'Reproduzir / pausar', () => { if (p.togglePause() === false) this.dialogs.open('file'); }, ['Space', 'MediaPlayPause']);
      def('play', 'Reproduzir', () => { if (!p.play()) this.dialogs.open('file'); }, []);
      def('pause', 'Pausar', () => p.pause(), []);
      def('stop', 'Parar', () => p.stop(), ['S', 'MediaStop']);
      def('next', 'Próximo', () => p.next(), ['N', 'MediaNext']);
      def('prev', 'Anterior', () => p.prev(), ['P', 'MediaPrev']);
      def('faster', 'Mais rápido', () => p.faster(), ['+']);
      def('slower', 'Mais lento', () => p.slower(), ['-']);
      def('faster-fine', 'Mais rápido (fino)', () => p.fasterFine(), [']']);
      def('slower-fine', 'Mais lento (fino)', () => p.slowerFine(), ['[']);
      def('normal-rate', 'Velocidade normal', () => p.normalRate(), ['=']);
      def('jump-vshort-back', 'Salto muito curto para trás', jump('jumpVeryShort', -1), ['Shift+Left']);
      def('jump-vshort-fwd', 'Salto muito curto para frente', jump('jumpVeryShort', 1), ['Shift+Right']);
      def('jump-short-back', 'Salto curto para trás', jump('jumpShort', -1), ['Left', 'Alt+Left']);
      def('jump-short-fwd', 'Salto curto para frente', jump('jumpShort', 1), ['Right', 'Alt+Right']);
      def('jump-medium-back', 'Salto médio para trás', jump('jumpMedium', -1), ['Ctrl+Left']);
      def('jump-medium-fwd', 'Salto médio para frente', jump('jumpMedium', 1), ['Ctrl+Right']);
      def('jump-long-back', 'Salto longo para trás', jump('jumpLong', -1), ['Ctrl+Alt+Left']);
      def('jump-long-fwd', 'Salto longo para frente', jump('jumpLong', 1), ['Ctrl+Alt+Right']);
      def('goto-time', 'Ir para tempo específico…', () => this.dialogs.gotoTime(), ['Ctrl+T']);
      def('frame-next', 'Próximo quadro (quadro a quadro)', () => p.frameStep(), ['E']);
      def('ab-loop', 'Repetição de A até B', () => p.cycleAB(), ['Shift+L']);
      def('loop-cycle', 'Repetir: desligado / tudo / um', () => p.cycleLoop(), ['L']);
      def('random', 'Aleatório', () => p.toggleShuffle(), ['R']);
      def('record', 'Gravar', () => this.recorder.toggle(), ['Shift+R']);
      def('chapter-next', 'Próximo capítulo', () => p.nextChapter(), ['Shift+N']);
      def('chapter-prev', 'Capítulo anterior', () => p.prevChapter(), ['Shift+P']);
      def('bookmarks', 'Gerenciar marcadores…', () => this.dialogs.bookmarks(), ['Ctrl+B']);
      def('bookmark-add', 'Criar marcador', () => p.addBookmark(), ['Ctrl+Shift+B']);
      def('time', 'Mostrar o tempo', () => this.controls.showTime(), ['T']);
      def('jump-percent', 'Ir para porcentagem', () => {}, [], 'Reprodução', { hidden: true });

      // Áudio
      def('vol-up', 'Aumentar volume', () => p.changeVolume(S.get('volumeStep')), ['Ctrl+Up', 'Up', 'VolumeUp'], 'Áudio');
      def('vol-down', 'Diminuir volume', () => p.changeVolume(-S.get('volumeStep')), ['Ctrl+Down', 'Down', 'VolumeDown'], 'Áudio');
      def('mute', 'Mudo', () => p.toggleMute(), ['M', 'VolumeMute'], 'Áudio');
      def('audio-track-cycle', 'Alternar faixa de áudio', () => p.cycleAudioTrack(), ['B'], 'Áudio');
      def('audio-device-cycle', 'Alternar dispositivo de áudio', () => this.cycleAudioDevice(), ['Shift+A'], 'Áudio');
      def('audio-diagnostics', 'Diagnóstico de som…', () => this.dialogs.audioDiag(), ['Alt+A'], 'Áudio');
      def('audio-delay-down', 'Diminuir atraso do áudio', () => { p.audio.setDelay(p.audio.state.delay - 0.05); this.controls.osd(`Atraso do áudio: ${Math.round(p.audio.state.delay * 1000)} ms`); }, ['J'], 'Áudio');
      def('audio-delay-up', 'Aumentar atraso do áudio', () => { p.audio.setDelay(p.audio.state.delay + 0.05); this.controls.osd(`Atraso do áudio: ${Math.round(p.audio.state.delay * 1000)} ms`); }, ['K'], 'Áudio');
      def('visualization-cycle', 'Alternar visualização', () => {
        const modes = Object.keys(VW.Visualizer.MODES);
        const n = modes[(modes.indexOf(S.get('visualization')) + 1) % modes.length];
        S.set('visualization', n);
        this.controls.osd('Visualização: ' + VW.Visualizer.MODES[n]);
      }, ['Shift+V'], 'Áudio', { hidden: false });

      // Vídeo
      def('fullscreen', 'Tela cheia', () => this.toggleFullscreen(), ['F', 'F11'], 'Vídeo');
      def('leave-fullscreen', 'Sair da tela cheia', () => { if (document.fullscreenElement) document.exitFullscreen(); else if (S.get('minimalView')) S.set('minimalView', false); }, ['Esc'], 'Vídeo');
      def('snapshot', 'Capturar imagem', () => this.recorder.snapshot(), ['Shift+S'], 'Vídeo');
      def('pip', 'Sempre no topo (imagem sobre imagem)', () => this.togglePiP(), ['Alt+P'], 'Vídeo');
      def('aspect-cycle', 'Alternar proporção', () => this.cycleView('aspect'), ['A'], 'Vídeo');
      def('crop-cycle', 'Alternar corte', () => this.cycleView('crop'), ['C'], 'Vídeo');
      def('zoom-cycle', 'Alternar zoom', () => this.cycleView('zoom'), ['Z'], 'Vídeo');
      def('deinterlace-toggle', 'Alternar desentrelaçamento', () => { S.set('deinterlace', S.get('deinterlace') === 'on' ? 'off' : 'on'); this.controls.osd('Desentrelaçar: ' + (S.get('deinterlace') === 'on' ? 'ligado' : 'desligado')); }, ['D'], 'Vídeo');
      def('deinterlace-mode', 'Alternar modo de desentrelaçamento', () => {
        const m = ['discard', 'blend', 'bob', 'linear'];
        S.set('deinterlaceMode', m[(m.indexOf(S.get('deinterlaceMode')) + 1) % m.length]);
        S.set('deinterlace', 'on');
        this.controls.osd('Desentrelaçamento: ' + ({ discard: 'Descartar', blend: 'Mesclar', bob: 'Bob', linear: 'Linear' })[S.get('deinterlaceMode')]);
      }, ['Shift+D'], 'Vídeo');
      def('video-track-toggle', 'Ativar/desativar faixa de vídeo', () => p.setVideoEnabled(!p.videoEnabled), [], 'Vídeo');

      // Legendas
      def('add-subtitle', 'Adicionar arquivo de legenda…', () => this.pickSubtitle(), ['Ctrl+Shift+S'], 'Legendas');
      def('sub-search', 'Buscar legendas online…', () => this.dialogs.subSearch('search'), ['Alt+B'], 'Legendas');
      def('sub-translate', 'Traduzir legenda…', () => this.dialogs.subTranslate(), ['Alt+T'], 'Legendas');
      def('sub-track-cycle', 'Alternar faixa de legenda', () => { const t = p.subs.cycle(1); this.controls.osd('Legenda: ' + (t ? t.label : 'desativada')); }, ['V'], 'Legendas');
      def('sub-track-cycle-rev', 'Alternar faixa de legenda (inverso)', () => { const t = p.subs.cycle(-1); this.controls.osd('Legenda: ' + (t ? t.label : 'desativada')); }, ['Alt+V'], 'Legendas');
      def('sub-toggle', 'Ativar/desativar legendas', () => this.toggleSubs(), ['Ctrl+Alt+V'], 'Legendas');
      def('sub-delay-down', 'Diminuir atraso da legenda', () => { p.subs.setDelay(p.subs.delay - S.get('subsDelayStep') / 1000); this.controls.osd(`Atraso da legenda: ${Math.round(p.subs.delay * 1000)} ms`); }, ['G'], 'Legendas');
      def('sub-delay-up', 'Aumentar atraso da legenda', () => { p.subs.setDelay(p.subs.delay + S.get('subsDelayStep') / 1000); this.controls.osd(`Atraso da legenda: ${Math.round(p.subs.delay * 1000)} ms`); }, ['H'], 'Legendas');
      def('sub-sync-audio', 'Sincronizar: marcar áudio/vídeo', () => p.syncMark('audio'), ['Shift+H'], 'Legendas');
      def('sub-sync-sub', 'Sincronizar: marcar legenda', () => p.syncMark('sub'), ['Shift+J'], 'Legendas');
      def('sub-sync-apply', 'Sincronizar legenda (aplicar)', () => p.syncApply(), ['Shift+K'], 'Legendas');
      def('sub-sync-reset', 'Redefinir sincronização da legenda', () => p.syncReset(), ['Ctrl+Shift+K'], 'Legendas');
      def('sub-size-up', 'Aumentar legenda', () => { S.set('subsScale', Math.min(300, S.get('subsScale') + 10)); this.controls.osd('Tamanho da legenda: ' + S.get('subsScale') + '%'); }, ['Ctrl+Shift+Up'], 'Legendas');
      def('sub-size-down', 'Diminuir legenda', () => { S.set('subsScale', Math.max(25, S.get('subsScale') - 10)); this.controls.osd('Tamanho da legenda: ' + S.get('subsScale') + '%'); }, ['Ctrl+Shift+Down'], 'Legendas');
      def('sub-pos-up', 'Mover legenda para cima', () => { S.set('subsMargin', Math.min(40, S.get('subsMargin') + 1)); }, ['Alt+Up'], 'Legendas');
      def('sub-pos-down', 'Mover legenda para baixo', () => { S.set('subsMargin', Math.max(0, S.get('subsMargin') - 1)); }, ['Alt+Down'], 'Legendas');

      // Ferramentas / Exibir
      def('effects', 'Efeitos e filtros…', () => this.dialogs.effects(), ['Ctrl+E'], 'Ferramentas');
      def('track-sync', 'Sincronização de faixas…', () => this.dialogs.effects('sync'), [], 'Ferramentas');
      def('media-info', 'Informações da mídia…', () => this.dialogs.mediaInfo('general'), ['Ctrl+I'], 'Ferramentas');
      def('codec-info', 'Informações do codec…', () => this.dialogs.mediaInfo('codec'), ['Ctrl+J'], 'Ferramentas');
      def('messages', 'Mensagens…', () => this.dialogs.messages(), ['Ctrl+M'], 'Ferramentas');
      def('prefs', 'Preferências…', () => this.dialogs.prefs(), ['Ctrl+P'], 'Ferramentas');
      def('customize', 'Personalizar interface…', () => this.dialogs.customize(), [], 'Ferramentas');
      def('playlist', 'Lista de reprodução', () => S.set('playlistVisible', !S.get('playlistVisible')), ['Ctrl+L'], 'Exibir');
      def('library', 'Biblioteca de mídia', () => { S.set('playlistVisible', true); this.playlistView.setView('library'); }, [], 'Exibir');
      def('minimal', 'Interface mínima', () => S.set('minimalView', !S.get('minimalView')), ['Ctrl+H'], 'Exibir');
      def('advanced-controls', 'Controles avançados', () => S.set('showAdvancedControls', !S.get('showAdvancedControls')), [], 'Exibir');
      def('statusbar', 'Barra de status', () => S.set('showStatusbar', !S.get('showStatusbar')), [], 'Exibir');
      def('skin-gallery', 'Galeria de temas e layouts…', () => this.dialogs.skins('skins'), ['Alt+K'], 'Exibir');
      def('skin-next', 'Próximo tema', () => this.cycleSkin(1), ['Ctrl+Alt+K'], 'Exibir');
      def('skin-prev', 'Tema anterior', () => this.cycleSkin(-1), ['Ctrl+Alt+Shift+K'], 'Exibir');
      def('layout-cycle', 'Próxima estrutura de layout', () => {
        const ids = Object.keys(VW.skins.LAYOUTS);
        const cur = VW.skins.layoutOf(S, VW.skins.resolve(S.get('skin')));
        const n = ids[(ids.indexOf(cur) + 1) % ids.length];
        S.set('layout', n);
        this.controls.osd('Layout: ' + VW.skins.LAYOUTS[n].name);
      }, ['Alt+L'], 'Exibir');
      def('help', 'Ajuda', () => this.dialogs.help(), ['F1'], 'Ajuda');
      def('about', 'Sobre', () => this.dialogs.about(), ['Shift+F1'], 'Ajuda');
    }

    /* ======================= Menus ======================= */
    menuDefs() {
      const A = id => () => this.actions.run(id);
      const p = this.player, S = this.settings, R = p.renderer;
      const item = (label, id, extra) => Object.assign({ label, action: A(id), shortcut: id }, extra || {});
      const has = () => !!p.item && !['stopped', 'idle', 'ended'].includes(p.state);
      const RATIO = (list, key) => list.map(([v, l]) => ({ label: l, radio: true, checked: R.view[key] === v, action: () => { R.setView({ [key]: v }); this.controls.osd(viewLabel(key) + ': ' + l); } }));
      const ASPECTS = [['default', 'Padrão'], ['16:9', '16:9'], ['4:3', '4:3'], ['1:1', '1:1'], ['16:10', '16:10'], ['2.21:1', '2.21:1'], ['2.35:1', '2.35:1'], ['2.39:1', '2.39:1'], ['5:4', '5:4']];
      const CROPS = [['default', 'Padrão'], ['16:10', '16:10'], ['16:9', '16:9'], ['4:3', '4:3'], ['1.85:1', '1.85:1'], ['2.21:1', '2.21:1'], ['2.35:1', '2.35:1'], ['2.39:1', '2.39:1'], ['5:3', '5:3'], ['5:4', '5:4'], ['1:1', '1:1']];
      const ZOOMS = [['fit', 'Ajustar à janela'], ['0.25', '1:4 Um quarto'], ['0.5', '1:2 Metade'], ['1', '1:1 Original'], ['2', '2:1 Dobro']];
      this.VIEW_LISTS = { aspect: ASPECTS, crop: CROPS, zoom: ZOOMS };

      const recentMenu = () => {
        const list = p.recent.map((r, i) => ({ label: `${i + 1}. ${r.title}`, hint: r.url || r.name, action: () => this.openRecent(r) }));
        return list.length ? list.concat([{ sep: true }, { label: 'Limpar', action: () => p.clearRecent() }]) : [{ label: '(vazio)', disabled: true }];
      };
      const speedMenu = () => [
        item('Mais rápido', 'faster'), item('Mais rápido (fino)', 'faster-fine'), item('Velocidade normal', 'normal-rate'), item('Mais lento (fino)', 'slower-fine'), item('Mais lento', 'slower'),
        { sep: true }, ...[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3, 4].map(r => ({ label: r + 'x', radio: true, checked: Math.abs(p.rate - r) < 1e-3, action: () => p.setRate(r) }))
      ];
      const chapterMenu = () => p.chapters.length ? [item('Próximo capítulo', 'chapter-next'), item('Capítulo anterior', 'chapter-prev'), { sep: true }].concat(p.chapters.map((c, i) => ({ label: `${c.title} (${U.fmtTime(c.start)})`, radio: true, checked: p.currentChapter() === i, action: () => p.gotoChapter(i) }))) : [{ label: 'Nenhum capítulo', disabled: true }];
      const bookmarkMenu = () => [item('Gerenciar…', 'bookmarks'), item('Criar marcador', 'bookmark-add'), { sep: true }].concat(p.bookmarks.map(b => ({ label: `${b.name} (${U.fmtTime(b.time)})`, action: () => p.seek(b.time) })));
      const audioTracks = () => {
        const t = p.getAudioTracks();
        // "Desativar" vale só para a mídia atual (como no VLC), não é mais uma preferência permanente
        const list = [{ label: 'Desativar', radio: true, checked: p.audioTrackOff, action: () => p.setAudioTrackOff(true) }];
        if (!t.length && has()) list.push({ label: 'Faixa 1', radio: true, checked: !p.audioTrackOff, action: () => p.setAudioTrackOff(false) });
        // link sem CORS: a página não consegue ler as faixas do arquivo — explica as alternativas
        const it = p.item;
        if (!t.length && has() && it && it.url && !it.file && it.remote && !it.remote.cors) list.push({ sep: true }, { label: 'Outras faixas: indisponíveis neste link (servidor sem CORS)…', action: () => this.showRemoteHelp(it, { reason: 'track' }) });
        if (!S.get('audioEnabled')) list.push({ sep: true }, { label: 'Ativar o áudio (desligado nas Preferências)', action: () => S.set('audioEnabled', true) });
        return list.concat(t.map(x => ({ label: x.label, radio: true, checked: x.active && !p.audioTrackOff, action: () => p.selectAudioTrack(x.id) })));
      };
      const audioDevices = async () => (await p.audio.listDevices());
      let devCache = [];
      audioDevices().then(d => { devCache = d; });
      const deviceMenu = () => {
        audioDevices().then(d => { devCache = d; });
        const cur = S.get('audioDevice');
        const list = [{ label: 'Padrão do sistema', radio: true, checked: cur === 'default', action: () => p.audio.setSinkId('default') }]
          .concat(devCache.filter(d => d.id !== 'default').map(d => ({ label: d.label, radio: true, checked: cur === d.id, action: () => p.audio.setSinkId(d.id) })));
        if (!U.supports.ctxSinkId) list.push({ label: '(seleção não suportada pelo navegador)', disabled: true });
        return list;
      };
      const stereoMenu = () => Object.entries(VW.AudioEngine.STEREO_MODES).map(([k, v]) => ({ label: v.name, radio: true, checked: p.audio.state.stereo === k, action: () => { p.audio.ensure(); p.audio.setStereoMode(k); this.controls.osd('Modo estéreo: ' + v.name); } }));
      const visMenu = () => Object.entries(VW.Visualizer.MODES).map(([k, v]) => ({ label: v, radio: true, checked: S.get('visualization') === k, action: () => S.set('visualization', k) }));
      const resMenu = () => {
        const cur = S.get('maxResolution'), R = p.renderer, it = p.item;
        const list = [{ header: 'Resolução máxima' + (R.hasVideo ? ` (vídeo: ${R.srcW}×${R.srcH})` : '') }]
          .concat(VW.App.RESOLUTIONS.map(([v, l]) => ({ label: l, radio: true, checked: cur === v, action: () => this.setMaxResolution(v) })));
        list.push({ sep: true },
          { label: 'Exibição direta quando não há efeitos (mais leve)', checked: S.get('directVideo'), action: () => S.set('directVideo', !S.get('directVideo')) },
          { label: 'Criar cópia em resolução menor (FFmpeg)…', disabled: !(it && (it.file || it.url) && p.hasVideo), action: () => this.dialogs.convert([it], { height: +p.suggestedResolution() }) });
        return list;
      };
      this.resMenu = resMenu;
      const videoTracks = () => {
        const q = p.getQualities();
        const list = [{ label: 'Desativar', radio: true, checked: !p.videoEnabled, action: () => p.setVideoEnabled(false) }, { label: 'Faixa 1', radio: true, checked: p.videoEnabled, disabled: !p.renderer.hasVideo, action: () => p.setVideoEnabled(true) }];
        if (q.length) list.push({ sep: true }, { header: 'Qualidade' }, ...q.map(x => ({ label: x.label, radio: true, checked: x.active, action: () => p.setQuality(x.id) })));
        return list;
      };
      const subTracks = () => [{ label: 'Desativar', radio: true, checked: !p.subs.activeId, action: () => p.selectSubtitle(null) }]
        .concat(p.subs.tracks.map(t => ({ label: t.label, radio: true, checked: p.subs.activeId === t.id, action: () => p.selectSubtitle(t.id) })));
      const deintMenu = () => [['off', 'Desligado'], ['on', 'Ligado']].map(([v, l]) => ({ label: l, radio: true, checked: S.get('deinterlace') === v, action: () => S.set('deinterlace', v) }));
      const deintModeMenu = () => [['discard', 'Descartar'], ['blend', 'Mesclar'], ['bob', 'Bob'], ['linear', 'Linear']].map(([v, l]) => ({ label: l, radio: true, checked: S.get('deinterlaceMode') === v, action: () => { S.set('deinterlaceMode', v); S.set('deinterlace', 'on'); } }));
      const transformMenu = () => [['none', 'Nenhuma'], ['90', 'Girar 90°'], ['180', 'Girar 180°'], ['270', 'Girar 270°'], ['hflip', 'Inverter horizontalmente'], ['vflip', 'Inverter verticalmente'], ['transpose', 'Transpor'], ['antitranspose', 'Antitranspor']]
        .map(([v, l]) => ({ label: l, radio: true, checked: v === 'none' ? !R.p.transform : R.p.transform && R.p.transformType === v, action: () => { if (v === 'none') R.set('transform', false); else { R.set('transformType', v); R.set('transform', true); } } }));
      const themeMenu = () => [
        { label: 'Galeria de temas e layouts…', icon: 'palette', shortcut: 'skin-gallery', action: () => this.dialogs.skins('skins') },
        { label: 'Próximo tema', shortcut: 'skin-next', action: () => this.cycleSkin(1) },
        { sep: true },
        { label: 'Automático (claro/escuro do sistema)', radio: true, checked: S.get('skin') === 'auto', action: () => S.set('skin', 'auto') }
      ].concat(VW.skins.SKINS.map(s => ({ label: s.name, hint: s.desc, radio: true, checked: S.get('skin') === s.id, action: () => S.set('skin', s.id) })));
      const layoutMenu = () => {
        const cur = S.get('layout');
        const skin = VW.skins.resolve(S.get('skin'));
        return [{ label: `Automático (do tema: ${VW.skins.LAYOUTS[skin.layout].name})`, radio: true, checked: cur === 'auto', action: () => S.set('layout', 'auto') }, { sep: true }]
          .concat(Object.entries(VW.skins.LAYOUTS).map(([id, l]) => ({ label: l.name, hint: l.desc, radio: true, checked: cur === id, action: () => S.set('layout', id) })));
      };

      this.menus = {
        media: () => [
          item('Abrir arquivo…', 'open-file', { icon: 'file' }), item('Abrir múltiplos arquivos…', 'open-multi'), item('Abrir pasta…', 'open-folder', { icon: 'folder' }),
          item('Abrir disco…', 'open-disc', { icon: 'disc' }), item('Abrir transmissão de rede…', 'open-network', { icon: 'network' }), item('Abrir dispositivo de captura…', 'open-capture', { icon: 'capture' }),
          item('Abrir local da área de transferência', 'open-clipboard'), { label: 'Abrir mídia recente', submenu: recentMenu },
          ...(U.phone ? [{ label: 'Voltar ao navegador pelo celular', icon: 'network', hint: 'Termux-Toons', action: () => { location.href = U.phone.inicio || '/'; } }] : []),
          { sep: true },
          item('Salvar lista de reprodução no arquivo…', 'save-playlist', { icon: 'save' }), item('Converter / salvar…', 'convert', { icon: 'convert' }), item('Transmitir…', 'stream', { icon: 'stream' }),
          { label: 'Reproduzir com o decodificador FFmpeg', icon: 'codec', disabled: !(p.item && p.item.file), action: () => p.playWithFFmpeg(p.item) },
          { sep: true },
          { label: 'Sair ao fim da lista de reprodução', checked: S.get('playAndExit'), action: () => S.set('playAndExit', !S.get('playAndExit')) },
          item('Sair', 'quit', { icon: 'quit' })
        ],
        playback: () => [
          { label: 'Título', submenu: () => [{ label: 'Nenhum título (somente DVD/Blu-ray)', disabled: true }], disabled: !has() },
          { label: 'Capítulo', submenu: chapterMenu, disabled: !has() },
          { label: 'Programa', submenu: () => [{ label: 'Programa único', radio: true, checked: true, disabled: true }], disabled: !has() },
          { label: 'Renderizador', submenu: () => [{ label: 'Local', radio: true, checked: true, action: () => {} }, { label: 'Procurar dispositivos (Chromecast/AirPlay)…', action: () => VW.castPrompt(p).catch(e => this.error(e.message)) }] },
          { sep: true },
          { label: 'Velocidade', submenu: speedMenu },
          { sep: true },
          item('Saltar para frente', 'jump-short-fwd', { icon: 'jump-fwd' }), item('Saltar para trás', 'jump-short-back', { icon: 'jump-back' }), item('Ir para tempo específico…', 'goto-time'),
          { sep: true },
          { label: p.playing ? 'Pausar' : 'Reproduzir', icon: p.playing ? 'pause' : 'play', shortcut: 'play-pause', action: A('play-pause') },
          item('Parar', 'stop', { icon: 'stop' }), item('Anterior', 'prev', { icon: 'prev' }), item('Próximo', 'next', { icon: 'next' }),
          { label: 'Gravar', icon: 'record', shortcut: 'record', checked: this.recorder.recording, action: A('record'), disabled: !has() },
          { sep: true },
          item('Repetição de A até B', 'ab-loop', { icon: 'abloop', disabled: !has() }), item('Quadro a quadro', 'frame-next', { icon: 'frame', disabled: !has() }),
          { label: 'Repetir', submenu: () => [['none', 'Desligado'], ['all', 'Repetir tudo'], ['one', 'Repetir um']].map(([v, l]) => ({ label: l, radio: true, checked: p.playlist.loop === v, action: () => p.setLoop(v) })) },
          { label: 'Aleatório', checked: p.playlist.shuffle, shortcut: 'random', action: A('random') },
          { sep: true },
          { label: 'Marcadores personalizados', submenu: bookmarkMenu, disabled: !has() }
        ],
        audio: () => [
          { label: 'Faixa de áudio', submenu: audioTracks },
          { label: 'Dispositivo de áudio', submenu: deviceMenu },
          { label: 'Modo estéreo', submenu: stereoMenu },
          { label: 'Visualizações', submenu: visMenu },
          { sep: true },
          item('Aumentar volume', 'vol-up', { icon: 'volume' }), item('Diminuir volume', 'vol-down', { icon: 'volume-low' }),
          { label: 'Mudo', icon: 'mute', shortcut: 'mute', checked: p.audio.muted, action: A('mute') },
          { sep: true },
          item('Equalizador e efeitos…', 'effects', { icon: 'sliders' }),
          { sep: true },
          { label: 'Saída direta (sem efeitos, máxima compatibilidade)', checked: p.directAudio, action: () => p.setDirectAudio(!p.directAudio) },
          item('Diagnóstico de som…', 'audio-diagnostics', { icon: 'help' })
        ],
        video: () => [
          { label: 'Faixa de vídeo', submenu: videoTracks },
          { label: 'Resolução', submenu: resMenu },
          { sep: true },
          { label: 'Tela cheia', icon: 'fullscreen', shortcut: 'fullscreen', checked: !!document.fullscreenElement, action: A('fullscreen') },
          { label: 'Sempre ajustar à janela', checked: R.view.zoom === 'fit', action: () => R.setView({ zoom: R.view.zoom === 'fit' ? '1' : 'fit' }) },
          { label: 'Sempre no topo (imagem sobre imagem)', icon: 'pip', shortcut: 'pip', action: A('pip'), disabled: !has() },
          { label: 'Definir como papel de parede', disabled: true, hint: 'Indisponível em navegadores' },
          { sep: true },
          { label: 'Zoom', submenu: () => RATIO(ZOOMS, 'zoom') },
          { label: 'Proporção', submenu: () => RATIO(ASPECTS, 'aspect') },
          { label: 'Cortar', submenu: () => RATIO(CROPS, 'crop') },
          { label: 'Transformar', submenu: transformMenu },
          { sep: true },
          { label: 'Desentrelaçar', submenu: deintMenu },
          { label: 'Modo de desentrelaçamento', submenu: deintModeMenu },
          { label: 'Saída', submenu: () => [{ label: 'Normal (WebGL)', radio: true, checked: !R.p.ascii, action: () => R.set('ascii', false) }, { label: 'Arte ASCII colorida', radio: true, checked: R.p.ascii, action: () => R.set('ascii', true) }] },
          { sep: true },
          item('Capturar imagem', 'snapshot', { icon: 'camera', disabled: !p.hasVideo }),
          item('Filtros de vídeo…', 'effects', { icon: 'sliders', action: () => this.dialogs.effects('video') })
        ],
        subtitle: () => [
          item('Adicionar arquivo de legenda…', 'add-subtitle', { icon: 'subtitle', disabled: !p.item }),
          item('Buscar legendas online (OpenSubtitles, SubDL, SubSource)…', 'sub-search', { icon: 'network' }),
          item('Traduzir legenda (ex.: inglês → português)…', 'sub-translate', { icon: 'convert', disabled: !p.subs.tracks.length }),
          { label: 'Faixa de legenda', submenu: subTracks },
          { label: 'Extrair legendas embutidas (MKV/MP4) com FFmpeg', icon: 'codec', disabled: !(p.item && p.item.file), action: () => this.extractSubs() },
          { sep: true },
          item('Aumentar atraso (+50 ms)', 'sub-delay-up'), item('Diminuir atraso (−50 ms)', 'sub-delay-down'),
          item('Sincronização…', 'track-sync'),
          item('Aumentar tamanho', 'sub-size-up'), item('Diminuir tamanho', 'sub-size-down'),
          { label: 'Salvar legenda sincronizada (.srt)…', disabled: !p.subs.active, action: () => { const t = p.subs.exportActive(); if (t) U.download(new Blob([t], { type: 'text/plain;charset=utf-8' }), U.stripExt(p.item.name) + '.srt'); } },
          { sep: true },
          { label: 'Aparência das legendas…', icon: 'prefs', action: () => this.dialogs.prefs('subs') }
        ],
        tools: () => [
          item('Efeitos e filtros', 'effects', { icon: 'sliders' }), item('Sincronização de faixas', 'track-sync'),
          item('Informações da mídia', 'media-info', { icon: 'info' }), item('Informações do codec', 'codec-info', { icon: 'codec' }),
          { label: 'Configuração VLM', disabled: true, hint: 'Gerenciador de transmissões do VLC — indisponível no navegador' },
          { label: 'Guia de programas', disabled: true, hint: 'Requer sintonizador de TV digital' },
          item('Mensagens', 'messages', { icon: 'log' }),
          item('Diagnóstico de som', 'audio-diagnostics', { icon: 'volume' }),
          { label: 'Plugins e extensões', action: () => this.dialogs.messages() },
          { sep: true },
          item('Personalizar interface…', 'customize'), item('Preferências', 'prefs', { icon: 'prefs' })
        ],
        view: () => [
          { label: 'Lista de reprodução', icon: 'playlist', shortcut: 'playlist', checked: S.get('playlistVisible'), action: A('playlist') },
          { label: 'Lista de reprodução encaixada', checked: S.get('playlistDocked'), action: () => S.set('playlistDocked', !S.get('playlistDocked')) },
          item('Biblioteca de mídia', 'library', { icon: 'library' }),
          { label: 'Barra de status', checked: S.get('showStatusbar'), action: A('statusbar') },
          { sep: true },
          { label: 'Sempre no topo', shortcut: 'pip', action: A('pip'), disabled: !has() },
          { label: 'Interface mínima', checked: S.get('minimalView'), shortcut: 'minimal', action: A('minimal') },
          { label: 'Interface em tela cheia', checked: !!document.fullscreenElement, shortcut: 'fullscreen', action: A('fullscreen') },
          { label: 'Controles avançados', checked: S.get('showAdvancedControls'), action: A('advanced-controls') },
          { sep: true },
          { label: 'Tema (skin)', icon: 'palette', submenu: themeMenu },
          { label: 'Estrutura do layout', icon: 'layout', submenu: layoutMenu },
          item('Personalizar interface…', 'customize')
        ],
        help: () => [
          item('Ajuda', 'help', { icon: 'help' }),
          { label: 'Teclas de atalho', icon: 'keyboard', action: () => { this.dialogs.help(); setTimeout(() => { const w = VW.ui.Win.get('help'); const t = w && w.el.querySelector('.tab-btn:nth-child(2)'); if (t) t.click(); }, 50); } },
          { label: 'Verificar atualizações…', action: () => VW.ui.F.message('Atualizações', `Você está usando a versão ${VW.VERSION}. Aplicações web são atualizadas automaticamente ao recarregar a página.`) },
          { sep: true },
          item('Sobre', 'about', { icon: 'info' })
        ]
      };
      return [
        { id: 'media', label: 'Mídia', items: this.menus.media },
        { id: 'playback', label: 'Reprodução', items: this.menus.playback },
        { id: 'audio', label: 'Áudio', items: this.menus.audio },
        { id: 'video', label: 'Vídeo', items: this.menus.video },
        { id: 'subtitle', label: 'Legenda', items: this.menus.subtitle },
        { id: 'tools', label: 'Ferramentas', items: this.menus.tools },
        { id: 'view', label: 'Exibir', items: this.menus.view },
        { id: 'help', label: 'Ajuda', items: this.menus.help }
      ];
    }

    contextMenuItems() {
      const p = this.player, A = id => () => this.actions.run(id);
      const has = !!p.item && !['stopped', 'idle', 'ended'].includes(p.state);
      return [
        { label: p.playing ? 'Pausar' : 'Reproduzir', icon: p.playing ? 'pause' : 'play', shortcut: 'play-pause', action: A('play-pause') },
        { label: 'Parar', icon: 'stop', shortcut: 'stop', action: A('stop'), disabled: !has },
        { label: 'Anterior', icon: 'prev', shortcut: 'prev', action: A('prev') },
        { label: 'Próximo', icon: 'next', shortcut: 'next', action: A('next') },
        { label: 'Gravar', icon: 'record', shortcut: 'record', checked: this.recorder.recording, action: A('record'), disabled: !has },
        { sep: true },
        { label: 'Reprodução', submenu: this.menus.playback },
        { label: 'Áudio', submenu: this.menus.audio },
        { label: 'Vídeo', submenu: this.menus.video },
        { label: 'Legenda', submenu: this.menus.subtitle },
        { label: 'Ferramentas', submenu: this.menus.tools },
        { label: 'Exibir', submenu: this.menus.view },
        { sep: true },
        { label: 'Lista de reprodução', icon: 'playlist', shortcut: 'playlist', action: A('playlist') },
        { label: 'Abrir mídia', icon: 'eject', submenu: this.menus.media },
        { sep: true },
        { label: 'Sair', icon: 'quit', shortcut: 'quit', action: A('quit') }
      ];
    }

    cycleView(key) {
      const R = this.player.renderer;
      const list = this.VIEW_LISTS[key];
      const i = list.findIndex(([v]) => v === R.view[key]);
      const [v, l] = list[(i + 1) % list.length];
      R.setView({ [key]: v });
      this.controls.osd(viewLabel(key) + ': ' + l);
    }

    toggleSubs() {
      const s = this.player.subs;
      if (s.activeId) { this._lastSub = s.activeId; this.player.selectSubtitle(null); }
      else if (s.tracks.length) this.player.selectSubtitle(s.tracks.some(t => t.id === this._lastSub) ? this._lastSub : s.tracks[0].id);
      else this.controls.osd('Nenhuma legenda disponível');
    }

    async cycleAudioDevice() {
      const devs = await this.player.audio.listDevices();
      if (devs.length < 2) { this.controls.osd('Dispositivo de áudio: padrão'); return; }
      const cur = this.settings.get('audioDevice');
      const i = devs.findIndex(d => d.id === cur);
      const n = devs[(i + 1) % devs.length];
      if (await this.player.audio.setSinkId(n.id)) this.controls.osd('Dispositivo de áudio: ' + n.label);
    }

    async extractSubs() {
      const p = this.player, it = p.item;
      if (!it || !it.file) return;
      this.showFFProgress({ p: -1, label: 'Extraindo legendas embutidas…' });
      try {
        await this.ffmpeg.load(x => this.showFFProgress({ p: x, label: 'Baixando o motor FFmpeg…' }));
        const subs = await this.ffmpeg.extractSubtitles(it.file, it.probe);
        this.showFFProgress(null);
        if (!subs.length) { this.controls.osd('Nenhuma legenda de texto embutida encontrada'); return; }
        for (const s of subs) { const f = Object.assign(s.file, { _label: s.title, _lang: s.lang }); await p.addSubtitleFile(f); }
        this.controls.osd(subs.length + ' legenda(s) extraída(s)');
      } catch (e) { this.showFFProgress(null); this.error('Falha ao extrair legendas: ' + e.message); }
    }

    /* ======================= Abertura de mídia ======================= */
    /** Seleciona arquivos (File System Access quando disponível). Retorna [{file, handle}] */
    async pickFiles({ multiple = true, accept = '', types = '' } = {}) {
      if (U.supports.fsAccess && this.settings.get('useFilePicker') && !accept.includes('json')) {
        try {
          const exts = types === 'sub' ? U.EXT.sub : types === 'image' ? U.EXT.image : types === 'audio' ? U.EXT.audio : null;
          const opts = { multiple, id: 'vlcweb-open' };
          if (exts) opts.types = [{ description: types === 'sub' ? 'Legendas' : types === 'image' ? 'Imagens' : 'Áudio', accept: { 'application/octet-stream': exts.map(e => '.' + e) } }];
          const handles = await window.showOpenFilePicker(opts);
          return Promise.all(handles.map(async h => ({ file: await h.getFile(), handle: h })));
        } catch (e) {
          if (e.name === 'AbortError') return [];
          this.log.debug('ui', 'showOpenFilePicker indisponível: ' + e.message);
        }
      }
      return new Promise(resolve => {
        const input = el('input', { type: 'file', style: 'display:none' });
        input.multiple = multiple;
        if (accept) input.accept = accept;
        else if (types === 'sub') input.accept = U.EXT.sub.map(e => '.' + e).join(',');
        else if (types === 'image') input.accept = 'image/*';
        else if (types === 'audio') input.accept = 'audio/*,' + U.EXT.audio.map(e => '.' + e).join(',');
        input.addEventListener('change', () => { resolve(Array.from(input.files).map(f => ({ file: f }))); input.remove(); });
        input.addEventListener('cancel', () => { resolve([]); input.remove(); });
        document.body.appendChild(input);
        input.click();
      });
    }

    async pickFolder() {
      if (U.supports.dirPicker && this.settings.get('useFilePicker')) {
        try {
          const dir = await window.showDirectoryPicker({ id: 'vlcweb-folder' });
          this.controls.osd('Lendo pasta…');
          return await U.walkDirectoryHandle(dir);
        } catch (e) {
          if (e.name === 'AbortError') return [];
        }
      }
      return new Promise(resolve => {
        const input = el('input', { type: 'file', style: 'display:none' });
        input.webkitdirectory = true;
        input.multiple = true;
        input.addEventListener('change', () => { resolve(Array.from(input.files).map(f => ({ file: f, path: f.webkitRelativePath || f.name }))); input.remove(); });
        input.addEventListener('cancel', () => { resolve([]); input.remove(); });
        document.body.appendChild(input);
        input.click();
      });
    }

    async quickOpenFiles(play = true) {
      const files = await this.pickFiles({ multiple: true });
      if (files.length) this.openFiles(files, { play });
    }
    async quickOpenFolder(play = true) {
      const files = await this.pickFolder();
      if (files.length) this.openFiles(files, { play });
      else if (files) this.controls.osd('Nenhum arquivo encontrado');
    }

    /**
     * Abre arquivos locais: separa mídias, legendas e listas de reprodução; associa legendas
     * com o mesmo nome do vídeo; expande listas M3U/PLS/XSPF/CUE.
     * files: [{ file, handle?, path? }]
     */
    openFiles(files, opts = {}) {
      const p = this.player;
      // .zip baixado de sites de legendas: extrai as legendas e trata como arquivos soltos
      const zips = files.filter(f => U.ext(f.file.name) === 'zip');
      if (zips.length) {
        const rest = files.filter(f => !zips.includes(f));
        Promise.all(zips.map(z => VW.subsearch.extractAllSubtitles(z.file).catch(e => { this.error(z.file.name + ': ' + e.message); return []; })))
          .then(lists => {
            const subs = lists.flat().map(file => ({ file }));
            if (!subs.length) this.error('Nenhuma legenda encontrada no arquivo .zip.');
            if (subs.length || rest.length) this.openFiles(rest.concat(subs), opts); // legendas e vídeos juntos são pareados pelo nome
          });
        return [];
      }
      const media = [], subs = [], lists = [];
      for (const f of files) {
        const k = U.kindOf(f.file.name, f.file.type);
        if (k === 'sub' || U.isSubtitleFile(f.file.name) && !['video', 'audio'].includes(k)) subs.push(f);
        else if (k === 'playlist') lists.push(f);
        else if (k) media.push(f);
        else if (/^(video|audio)\//.test(f.file.type)) media.push(f);
        else this.log.debug('input', 'Ignorado (tipo desconhecido): ' + f.file.name);
      }
      // apenas legendas soltas sobre um vídeo em reprodução
      if (!media.length && !lists.length && subs.length) {
        if (p.item) subs.forEach(s => p.addSubtitleFile(s.file));
        else this.error('Abra um vídeo antes de adicionar legendas.');
        return [];
      }
      media.sort((a, b) => U.naturalCompare(a.path || a.file.name, b.path || b.file.name));
      const entries = media.map(f => {
        const mySubs = this.settings.get('subsAutoload') ? subs.filter(s => VW.subtitles.matchesMedia(s.file.name, f.file.name)).map(s => s.file) : [];
        return { file: f.file, handle: f.handle, path: f.path, subs: mySubs };
      });
      if (entries.length === 1) {
        if (opts.subsFile) entries[0].subs.push(opts.subsFile);
        if (opts.extraAudio) entries[0].extraAudio = opts.extraAudio;
        if (opts.startTime) entries[0].startTime = opts.startTime;
        if (opts.stopTime) entries[0].stopTime = opts.stopTime;
      } else if (opts.subsFile && entries[0]) entries[0].subs.push(opts.subsFile);
      // subtítulos sem par: se só houver um vídeo, associa todos
      if (entries.length === 1 && this.settings.get('subsAutoload')) {
        for (const s of subs) if (!entries[0].subs.includes(s.file)) entries[0].subs.push(s.file);
      }
      let items = p.enqueue(entries, { play: opts.play && !lists.length, at: opts.at });
      for (const l of lists) this.loadPlaylistFile(l.file, media, opts.play && !items.length).then(n => { if (n && opts.play && !items.length) items = n; });
      if (items.length) this.log.info('input', `${items.length} item(ns) adicionado(s) à lista`);
      if (opts.play && items.length && !this.settings.get('playlistVisible') && items.length > 1) this.controls.osd(`${items.length} itens adicionados à lista`);
      return items;
    }

    async loadPlaylistFile(file, siblings = [], play = false) {
      const text = await U.readFileText(file);
      if (VW.playlistFormats.isHlsManifest(text)) { this.error('Este .m3u8 é um manifesto HLS local; abra-o pela URL do servidor (Mídia → Abrir transmissão de rede).'); return []; }
      const entries = VW.playlistFormats.parse(text, file.name);
      const byName = new Map(siblings.map(f => [f.file.name.toLowerCase(), f]));
      const data = entries.map(e => {
        const loc = e.location.trim();
        if (/^[a-z][a-z0-9+.-]+:\/\//i.test(loc) && !/^file:/i.test(loc)) return { url: loc, title: e.title, duration: e.duration, meta: e.meta || {}, startTime: e.startTime, stopTime: e.stopTime };
        const name = U.baseName(loc.replace(/^file:\/+/i, '/')).toLowerCase();
        const f = byName.get(name);
        if (f) return { file: f.file, handle: f.handle, title: e.title, meta: e.meta || {}, startTime: e.startTime, stopTime: e.stopTime };
        return { title: e.title || U.baseName(loc), path: loc, missing: true, kind: U.kindOf(loc) || 'video', duration: e.duration, meta: e.meta || {} };
      });
      // remove itens da lista que vieram como arquivos soltos (evita duplicatas)
      const used = new Set(data.filter(d => d.file).map(d => d.file));
      const dup = this.player.playlist.items.filter(i => i.file && used.has(i.file)).map(i => i.id);
      if (dup.length) this.player.playlist.remove(dup);
      const items = this.player.enqueue(data, { play });
      const missing = data.filter(d => d.missing).length;
      this.controls.osd(`Lista "${file.name}": ${items.length} itens${missing ? ` (${missing} arquivos locais indisponíveis)` : ''}`, 3500);
      return items;
    }

    async openURL(url, opts = {}) {
      url = U.cleanUrl(url);
      if (!url) return [];
      if (/^\.{0,2}\//.test(url)) url = new URL(url, location.href).href;   // caminho do próprio site (ex.: /m/... do Termux-Toons)
      else if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url;
      // listas de reprodução remotas
      if (/\.(m3u|pls|xspf|asx)(\?|$)/i.test(url) || (/\.m3u8(\?|$)/i.test(url) && false)) {
        try {
          const listUrl = await U.viaPhone(url);
          const res = await fetch(listUrl);
          const text = await res.text();
          if (!VW.playlistFormats.isHlsManifest(text)) {
            const entries = VW.playlistFormats.parse(text, listUrl).map(e => ({ url: new URL(e.location, listUrl).href, title: e.title, duration: e.duration, meta: e.meta || {} }));
            if (entries.length) return this.player.enqueue(entries, { play: opts.play });
          }
        } catch (e) { this.log.warn('input', 'Não foi possível ler a lista remota: ' + e.message); }
      }
      const entry = { url, startTime: opts.startTime, stopTime: opts.stopTime };
      if (opts.title) entry.title = opts.title;
      if (opts.subsFile) entry.subs = [opts.subsFile];
      if (opts.extraAudio) entry.extraAudio = opts.extraAudio;
      return this.player.enqueue([entry], { play: opts.play !== false });
    }

    async openCapture(cfg, opts = {}) {
      try {
        let stream, label;
        if (cfg.mode === 'desktop') {
          if (!U.supports.displayMedia) throw new Error('Captura de tela não suportada por este navegador.');
          stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: +cfg.fps || 30 }, audio: !!cfg.deskAudio });
          label = 'Área de trabalho';
        } else {
          if (!U.supports.userMedia) throw new Error('Câmera/microfone indisponíveis (a página precisa de HTTPS).');
          const v = {};
          if (cfg.video) v.deviceId = { exact: cfg.video };
          if (cfg.res) { const [w, h] = cfg.res.split('x'); v.width = { ideal: +w }; v.height = { ideal: +h }; }
          if (cfg.fps) v.frameRate = { ideal: +cfg.fps };
          const a = cfg.audio === 'none' ? false : cfg.audio ? { deviceId: { exact: cfg.audio } } : true;
          stream = await navigator.mediaDevices.getUserMedia({ video: Object.keys(v).length ? v : true, audio: a });
          label = (stream.getVideoTracks()[0] && stream.getVideoTracks()[0].label) || 'Câmera';
        }
        const [item] = this.player.enqueue([{ stream, streamLabel: label, title: label, kind: 'stream' }], { play: opts.play !== false });
        stream.getVideoTracks().forEach(t => t.addEventListener('ended', () => { if (this.player.item === item) this.player.stop(); }));
        return item;
      } catch (e) {
        this.error('Não foi possível abrir o dispositivo de captura: ' + (e.name === 'NotAllowedError' ? 'permissão negada.' : e.message));
        return null;
      }
    }

    async openClipboard() {
      try {
        const text = (await navigator.clipboard.readText()).trim();
        if (!text) { this.controls.osd('Área de transferência vazia'); return; }
        this.openURL(text, { play: true });
      } catch (e) {
        this.dialogs.open('network');
      }
    }

    async openRecent(r) {
      if (r.url) { this.openURL(r.url, { play: true }); return; }
      const h = await this.library.getHandle(r.key);
      if (h) {
        try {
          if (await VW.Library.verifyPermission(h)) { const file = await h.getFile(); this.openFiles([{ file, handle: h }], { play: true }); return; }
        } catch (e) { /* cai para o aviso */ }
      }
      const existing = this.player.playlist.items.find(i => i.key === r.key);
      if (existing) { this.player.playItem(existing); return; }
      const ans = await VW.ui.F.message('Mídia recente', `O navegador não mantém acesso ao arquivo local <b>${U.escapeHtml(r.name || r.title)}</b>. Deseja selecioná-lo novamente?`, [['pick', 'Selecionar arquivo…'], ['no', 'Cancelar']]);
      if (ans === 'pick') this.quickOpenFiles();
    }

    async pickSubtitle() {
      if (!this.player.item) { this.error('Abra uma mídia antes de adicionar legendas.'); return; }
      const f = await this.pickFiles({ multiple: true, types: 'sub' });
      for (const x of f) await this.player.addSubtitleFile(x.file);
    }

    /* ======================= Tela cheia, PiP, interface mínima, tema ======================= */
    toggleFullscreen() {
      if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
      const root = U.$('#app');
      const req = root.requestFullscreen || root.webkitRequestFullscreen;
      if (req) Promise.resolve(req.call(root, { navigationUI: 'hide' })).catch(e => this.error('Tela cheia indisponível: ' + e.message));
      else { const v = this.player.media; if (v && v.webkitEnterFullscreen) v.webkitEnterFullscreen(); }
    }

    async togglePiP() {
      const p = this.player;
      if (!p.item) return;
      // 1) Document PiP: move o palco inteiro (efeitos + legendas)
      if (U.supports.docPip) {
        if (this.pipWin) { this.pipWin.close(); return; }
        try {
          const stage = U.$('#stage');
          const pw = await window.documentPictureInPicture.requestWindow({ width: Math.min(640, stage.clientWidth), height: Math.min(360, stage.clientHeight) });
          this.pipWin = pw;
          for (const s of document.styleSheets) {
            try { const css = [...s.cssRules].map(r => r.cssText).join(''); const st = pw.document.createElement('style'); st.textContent = css; pw.document.head.appendChild(st); }
            catch (e) { if (s.href) { const l = pw.document.createElement('link'); l.rel = 'stylesheet'; l.href = s.href; pw.document.head.appendChild(l); } }
          }
          pw.document.body.className = 'pip-body';
          VW.skins.apply(this.settings, pw.document);
          const svg = U.$('#icons');
          if (svg) pw.document.body.appendChild(svg.cloneNode(true));
          const placeholder = el('div', { id: 'stage-placeholder', class: 'stage-placeholder' }, U.icon('pip', 'big'), el('span', {}, 'Reproduzindo na janela de imagem sobre imagem'));
          stage.replaceWith(placeholder);
          pw.document.body.appendChild(stage);
          pw.addEventListener('keydown', e => this.actions.handleKey(e));
          pw.addEventListener('pagehide', () => {
            placeholder.replaceWith(stage);
            this.pipWin = null;
            setTimeout(() => p.renderer.layout(), 50);
          });
          return;
        } catch (e) { this.log.warn('ui', 'Document PiP falhou: ' + e.message); }
      }
      // 2) PiP de vídeo (com o fluxo processado do canvas quando possível)
      if (!U.supports.pip) { this.error('Imagem sobre imagem não é suportada por este navegador.'); return; }
      if (document.pictureInPictureElement) { document.exitPictureInPicture(); return; }
      try {
        if (p.hasVideo && !p.renderer.cssMode) {
          const v = this.pipVideo || (this.pipVideo = el('video', { muted: true, playsinline: true, class: 'pip-proxy' }));
          v.muted = true;
          v.srcObject = p.renderer.captureStream(30);
          document.body.appendChild(v);
          await v.play();
          await v.requestPictureInPicture();
          v.addEventListener('leavepictureinpicture', () => { v.srcObject = null; v.remove(); }, { once: true });
        } else await p.media.requestPictureInPicture();
      } catch (e) { this.error('Não foi possível abrir a imagem sobre imagem: ' + e.message); }
    }

    /** Aplica o tema visual (skin) e a estrutura de layout; reage a mudanças nas preferências. */
    applyTheme() {
      const S = this.settings;
      let lastLayout = null;
      const set = () => {
        const { layout } = VW.skins.apply(S);
        if (this.pipWin) VW.skins.apply(S, this.pipWin.document);
        // a estrutura muda o tamanho do palco: reposiciona o vídeo e as legendas
        if (layout !== lastLayout) { lastLayout = layout; setTimeout(() => this.player.renderer.layout(), 30); }
      };
      set();
      for (const k of ['skin', 'layout', 'accent', 'accentOverride']) S.on('change:' + k, set);
      window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (S.get('skin') === 'auto') set(); });
    }

    /** Alterna para o tema seguinte/anterior da lista. */
    cycleSkin(dir = 1) {
      const list = VW.skins.SKINS;
      const cur = VW.skins.resolve(this.settings.get('skin')).id;
      const next = list[(list.findIndex(s => s.id === cur) + dir + list.length) % list.length];
      this.settings.set('skin', next.id);
      this.controls.osd('Tema: ' + next.name);
    }

    applyMinimal() {
      const set = () => {
        const m = this.settings.get('minimalView');
        U.$('#app').classList.toggle('minimal', m);
        if (!m && !document.fullscreenElement) U.$('#app').classList.remove('idle');
        if (m) this.controls.osd('Interface mínima — pressione Ctrl+H para restaurar', 3000);
        setTimeout(() => this.player.renderer.layout(), 0);
      };
      this.settings.on('change:minimalView', set);
      if (this.settings.get('minimalView')) set();
    }

    /* ======================= Eventos globais ======================= */
    bindGlobal() {
      const app = U.$('#app');
      U.$$('[data-action]').forEach(b => b.addEventListener('click', () => this.actions.run(b.dataset.action)));
      document.addEventListener('keydown', e => {
        if (this.menu.isOpen) return;
        // Ctrl+V é tratado pelo evento "paste" (não exige permissão de área de transferência)
        if (VW.ui.Actions.combo(e) === 'Ctrl+V' && this.actions.findByKey('Ctrl+V') === 'open-clipboard') return;
        if (e.target.closest && e.target.closest('.win')) {
          if (U.isTyping(e) || e.key === 'Escape') return;
        }
        if (e.key === 'Alt' || (e.altKey && !e.ctrlKey && e.key === 'F10')) return;
        this.actions.handleKey(e);
      });
      // Alt pressionado sozinho foca a barra de menus (como em aplicativos de desktop)
      let altAlone = false;
      document.addEventListener('keydown', e => { altAlone = e.key === 'Alt'; });
      document.addEventListener('keyup', e => {
        if (e.key === 'Alt' && altAlone && !U.isTyping(e)) { e.preventDefault(); const b = U.$('.menubar-item'); if (b) b.focus(); }
        altAlone = false;
      });
      document.addEventListener('paste', e => {
        if (U.isTyping(e)) return;
        const files = Array.from(e.clipboardData.files || []);
        if (files.length) { e.preventDefault(); this.openFiles(files.map(f => ({ file: f })), { play: true }); return; }
        const text = U.cleanUrl(e.clipboardData.getData('text'));
        if (text && /^(https?|ftp|rtsp|blob):|^www\./i.test(text)) { e.preventDefault(); this.openURL(text, { play: true }); }
      });
      // arrastar e soltar em toda a janela
      let dragDepth = 0;
      const dropOverlay = U.$('#drop-overlay');
      const isFileDrag = e => e.dataTransfer && Array.from(e.dataTransfer.types || []).some(t => t === 'Files' || t === 'text/uri-list');
      window.addEventListener('dragenter', e => { if (!isFileDrag(e) || this.playlistView.dragIds) return; dragDepth++; dropOverlay.hidden = false; });
      window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dropOverlay.hidden = true; });
      window.addEventListener('dragover', e => { if (isFileDrag(e)) e.preventDefault(); });
      window.addEventListener('drop', async e => {
        dragDepth = 0; dropOverlay.hidden = true;
        if (!isFileDrag(e)) return;
        e.preventDefault();
        const files = await U.readDropEntries(e.dataTransfer);
        if (files.length) {
          // legenda solta sobre o vídeo em reprodução
          if (files.every(f => U.kindOf(f.file.name) === 'sub' || U.isSubtitleFile(f.file.name)) && this.player.item) { files.forEach(f => this.player.addSubtitleFile(f.file)); return; }
          this.openFiles(files, { play: true });
        } else {
          const url = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '').split('\n')[0].trim();
          if (url) this.openURL(url, { play: true });
        }
      });
      document.addEventListener('visibilitychange', () => {
        if (document.hidden && this.settings.get('pauseOnHidden') && this.player.playing && !this.pipWin && !document.pictureInPictureElement) { this.player.pause(); this._pausedByHide = true; }
        else if (!document.hidden && this._pausedByHide) { this._pausedByHide = false; this.player.play(); }
      });
      window.addEventListener('beforeunload', () => this.player.saveResume());
      app.addEventListener('pointerdown', () => { if (!this.player.directAudio) this.player.audio.ensure(); }, { once: true });
    }

    bindPlayer() {
      const p = this.player;
      p.on('error', msg => this.error(msg));
      p.on('quit', () => this.quit());
      p.on('request-fullscreen', () => { if (!document.fullscreenElement) this.toggleFullscreen(); });
      p.on('ffmpeg-progress', s => this.showFFProgress(s));
      p.on('ffmpeg-ask', (item, reason, soft) => this.askFFmpeg(item, reason, soft));
      p.on('download-ask', (item, opts, done) => this.askDownload(item, opts).then(done, () => done(false)));
      p.on('remote-help', (item, opts) => this.showRemoteHelp(item, opts));
      p.on('perf-lag', info => this.showLagHint(info));
      // indicador de resolução reduzida na barra de status
      const S = this.settings;
      const resBadge = U.$('#status-res');
      const updateRes = () => {
        const R = p.renderer, i = R.resolutionInfo(), cur = S.get('maxResolution');
        let txt = '';
        if (p.item && R.hasVideo) {
          if (i.capped) txt = `${short(i.srcW, i.srcH)} → ${short(i.outW, i.outH)}`;
          else if ((p.hls || p.dash) && p._capIndex != null && cur !== 'auto' && cur !== 'original') txt = `≤ ${cur}p`;
        }
        resBadge.hidden = !txt;
        resBadge.textContent = txt;
        resBadge.title = 'Resolução reduzida para aliviar a reprodução (Vídeo → Resolução). Clique para alterar.';
      };
      const short = (w, h) => { const s = Math.min(w, h); return s >= 2000 ? '4K' : s + 'p'; };
      p.renderer.on('resolution', updateRes);
      p.on('tracks', updateRes);
      p.on('item', () => setTimeout(updateRes, 0));
      S.on('change:maxResolution', updateRes);
      resBadge.addEventListener('click', e => this.menu.context(this.resMenu(), e.clientX, e.clientY - 10));
      p.on('resume-ask', pos => this.showResume(pos));
      // o navegador bloqueou o motor de áudio: mostra o botão "Clique para ativar o som"
      const unlock = U.$('#audio-unlock');
      p.on('audio-blocked', b => { unlock.hidden = !b; });
      unlock.addEventListener('click', e => { e.stopPropagation(); p.unlockAudio(); });
      p.on('item', () => this.hideResume());
      this.recorder.on('state', () => this.controls.updateButtons());
      this.recorder.on('snapshot', blob => this.controls.showSnapshot(blob));
      let recT = null;
      this.recorder.on('state', on => {
        clearInterval(recT);
        U.$('#rec-indicator').hidden = !on || this.recorder.silent;
        if (on) recT = setInterval(() => { U.$('#rec-time').textContent = U.fmtTime(this.recorder.elapsed); }, 500);
      });
      this.ffmpeg.on('state', s => { if (s === 'error') this.showFFProgress(null); });
    }

    showResume(pos) {
      const bar = U.$('#resume-bar');
      U.$('#resume-text').textContent = `Continuar assistindo de onde você parou (${U.fmtTime(pos)})?`;
      bar.hidden = false;
      U.$('#resume-yes').onclick = () => { this.player.seek(pos); this.hideResume(); };
      U.$('#resume-no').onclick = () => this.hideResume();
      clearTimeout(this._resumeT);
      this._resumeT = setTimeout(() => this.hideResume(), 9000);
    }
    hideResume() { U.$('#resume-bar').hidden = true; clearTimeout(this._resumeT); }

    async askFFmpeg(item, reason, soft) {
      const remote = !item.file && !!item.url;
      if (remote) {
        // link de rede: o FFmpeg precisa do arquivo inteiro → explica e pede para baixar
        const size = item.remote && isFinite(item.remote.size) ? ' (' + U.fmtBytes(item.remote.size) + ')' : '';
        const what = soft ? 'converter só o áudio (o vídeo continua tocando enquanto isso)' : 'converter o arquivo';
        const ans = await VW.ui.F.message('Formato não suportado pelo navegador',
          `<p>${U.escapeHtml(reason)}</p><p>Para ${what}, o VLC Web precisa primeiro <b>baixar o arquivo${size}</b> para o armazenamento temporário do navegador e depois usar o <b>decodificador FFmpeg</b> (WebAssembly, ~31 MB na primeira vez).</p>`,
          [['yes', 'Baixar e converter'], ['no', soft ? 'Continuar assim' : 'Cancelar']], { icon: 'codec', width: 560 });
        if (ans === 'yes') this.player.playWithFFmpeg(item, { audioOnly: soft, confirmed: true });
        return;
      }
      const remember = VW.ui.F.check('Sempre converter automaticamente (não perguntar novamente)', false);
      const ans = await VW.ui.F.message('Formato não suportado pelo navegador',
        `<p>${U.escapeHtml(reason)}</p><p>O VLC Web pode usar o <b>decodificador FFmpeg</b> (WebAssembly) para ${soft ? 'converter apenas o áudio de' : 'remultiplexar ou converter'} <b>${U.escapeHtml(item.name)}</b> localmente e reproduzi-lo. Na primeira vez são baixados cerca de 31 MB; o processo pode levar alguns instantes, dependendo do tamanho do arquivo.</p>`,
        [['yes', soft ? 'Converter o áudio' : 'Converter e reproduzir'], ['no', soft ? 'Continuar assim' : 'Cancelar']], { extra: remember, icon: 'codec', width: 540 });
      if (remember.input.checked && ans === 'yes') this.settings.set('ffmpegMode', 'always');
      if (ans === 'yes') this.player.playWithFFmpeg(item, { audioOnly: soft });
    }

    /* ======================= Resolução / desempenho ======================= */
    static get RESOLUTIONS() {
      return [['auto', 'Automática (tamanho da janela)'], ['original', 'Original (sem limite)'], ['2160', '2160p (4K)'], ['1440', '1440p'], ['1080', '1080p (Full HD)'], ['720', '720p (HD)'], ['480', '480p'], ['360', '360p']];
    }
    setMaxResolution(v) {
      const p = this.player, R = p.renderer;
      this.settings.set('maxResolution', v);
      const label = (VW.App.RESOLUTIONS.find(x => x[0] === v) || [v, v])[1];
      this.controls.osd('Resolução máxima: ' + label);
      // arquivo único já exibido no modo mais leve: o limite não reduz a decodificação — explica
      const cap = +v;
      if (cap > 0 && p.item && R.hasVideo && Math.min(R.srcW, R.srcH) > cap && R.direct && !p.hls && !p.dash && !this._resExplained) {
        this._resExplained = true;
        this.notify(`Este vídeo (${R.srcW}×${R.srcH}) já está sendo exibido do jeito mais leve possível, sem efeitos. O limite de ${cap}p reduz o processamento quando há efeitos de vídeo e a qualidade baixada em fluxos HLS/DASH, mas num arquivo único o navegador continua decodificando em ${Math.min(R.srcW, R.srcH)}p. Se ainda travar, crie uma cópia mais leve.`,
          [['Criar cópia em ' + cap + 'p…', () => this.dialogs.convert([p.item], { height: cap })]], { timeout: 16000 });
      }
    }
    cycleMaxResolution() {
      const order = ['auto', '1080', '720', '480', 'original'];
      const cur = this.settings.get('maxResolution');
      this.setMaxResolution(order[(order.indexOf(cur) + 1) % order.length]);
    }

    /** O vídeo está travando: explica a causa provável e oferece a correção. */
    showLagHint(info) {
      const p = this.player, S = this.settings;
      const next = p.suggestedResolution();
      const size = `${info.srcW}×${info.srcH}`;
      const acts = [];
      let msg;
      if (info.stream) {
        msg = `O vídeo está travando (${size}). Limitar a qualidade do fluxo reduz os dados baixados e o trabalho de decodificação.`;
        acts.push([`Limitar a ${next}p`, () => this.setMaxResolution(next)]);
      } else if (info.effects) {
        msg = `O vídeo está travando: os efeitos de vídeo estão sendo aplicados a cada quadro (vídeo ${size}, processado em ${info.outW}×${info.outH}). Reduzir a resolução de processamento ou desativar os efeitos alivia a placa de vídeo.`;
        acts.push([`Reduzir para ${next}p`, () => this.setMaxResolution(next)]);
        acts.push(['Desativar efeitos', () => { p.renderer.reset(); this.controls.osd('Efeitos de vídeo desativados'); }]);
      } else {
        msg = `O computador não está conseguindo decodificar este vídeo de ${size} a tempo. Como é um arquivo único, a solução é usar uma cópia em resolução menor.`;
        if (p.item && (p.item.file || p.item.url)) acts.push([`Criar cópia em ${next}p…`, () => this.dialogs.convert([p.item], { height: +next })]);
      }
      acts.push(['Não avisar mais', () => S.set('lagHint', false)]);
      this.notify(msg, acts, { timeout: 20000, icon: 'warning' });
    }

    /** Aviso com botões de ação (canto da tela). actions: [[rótulo, função], …] */
    notify(msg, actions = [], opts = {}) {
      const box = U.$('#toasts');
      const close = () => { t.classList.add('hide'); setTimeout(() => t.remove(), 500); };
      const btns = actions.map(([label, fn]) => el('button', { type: 'button', class: 'btn small', onclick: () => { close(); fn(); } }, label));
      const t = el('div', { class: 'toast info', role: 'status' }, U.icon(opts.icon || 'info'),
        el('div', { class: 'toast-body' }, el('span', {}, msg), btns.length ? el('div', { class: 'toast-actions' }, ...btns) : null),
        el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Fechar', onclick: close }, U.icon('close')));
      box.appendChild(t);
      setTimeout(close, opts.timeout || 9000);
      return t;
    }

    /** Pede confirmação para baixar um item de rede (trocar faixa de áudio / converter). */
    async askDownload(item, opts = {}) {
      const r = item.remote || {};
      const size = isFinite(r.size) ? U.fmtBytes(r.size) : 'tamanho desconhecido';
      const free = await VW.remote.freeSpace();
      const low = isFinite(free) && isFinite(r.size) && r.size > free * 0.9;
      const why = opts.reason === 'track'
        ? `<p>O navegador só reproduz a faixa de áudio padrão de um vídeo em <i>streaming</i>. Para ouvir <b>${U.escapeHtml(opts.trackLabel || 'outra faixa')}</b>, o VLC Web baixa o arquivo e separa essa faixa com o FFmpeg. O vídeo continua tocando durante o download; depois a troca entre faixas é imediata.</p>`
        : `<p>Para converter este link, o VLC Web precisa do arquivo completo.</p>`;
      const ans = await VW.ui.F.message('Baixar o arquivo?',
        why + `<p>Arquivo: <b>${U.escapeHtml(item.remoteName || item.name)}</b> — <b>${size}</b>.<br>Ele fica no armazenamento temporário do navegador (apagado automaticamente depois).</p>` +
        (low ? `<p class="f-hint warn">Atenção: o espaço livre informado pelo navegador (${U.fmtBytes(free)}) pode não ser suficiente.</p>` : '') +
        (opts.reason === 'track' ? `<p class="f-hint">Sem baixar: no Chrome ou Edge, ative <code>chrome://flags/#enable-experimental-web-platform-features</code> (no Edge, <code>edge://flags/…</code>) e reinicie o navegador — a troca de faixas de áudio passa a funcionar direto no streaming.</p>` : ''),
        [['yes', 'Baixar'], ['no', 'Cancelar']], { icon: 'network', width: 580 });
      return ans === 'yes';
    }

    /** O servidor não deixa a página ler o arquivo (CORS): explica as alternativas. */
    showRemoteHelp(item, opts = {}) {
      const r = item.remote || {};
      const blocked = r.status >= 400
        ? `<p>O servidor respondeu <b>HTTP ${r.status}</b> ao pedido da página — o link pode ter expirado ou exigir login.</p>`
        : `<p>O servidor deste link não permite que outras páginas leiam o arquivo (falta o cabeçalho <b>CORS</b>). O navegador ainda consegue <i>reproduzi‑lo</i>, mas o VLC Web não consegue ler o conteúdo para ${opts.reason === 'track' ? 'separar outra faixa de áudio' : 'convertê‑lo'}.</p>`;
      const tips = `<ul>` +
        (opts.reason === 'track' ? `<li><b>Trocar a faixa sem baixar:</b> no Chrome ou Edge, ative <code>chrome://flags/#enable-experimental-web-platform-features</code> e reinicie o navegador. As faixas passam a aparecer no menu Áudio → Faixa de áudio.</li>` : '') +
        `<li><b>Baixar pelo navegador</b> e abrir o arquivo em Mídia → Abrir arquivo — tudo passa a funcionar (faixas, legendas embutidas, conversão).</li></ul>`;
      VW.ui.F.message(r.status >= 400 ? 'Acesso recusado pelo servidor' : 'O servidor bloqueia a leitura do arquivo', blocked + tips,
        [['dl', 'Baixar pelo navegador'], ['ok', 'Fechar']], { icon: 'warning', width: 580 })
        .then(ans => { if (ans === 'dl') window.open(item.url, '_blank', 'noopener,noreferrer'); });
    }

    showFFProgress(s) {
      const box = U.$('#ff-toast');
      if (!s) { box.hidden = true; return; }
      box.hidden = false;
      U.$('#ff-label').textContent = s.label || '';
      const bar = U.$('#ff-bar');
      bar.parentElement.classList.toggle('indeterminate', !(s.p >= 0));
      bar.style.width = (s.p >= 0 ? Math.round(s.p * 100) : 30) + '%';
      U.$('#ff-pct').textContent = s.p >= 0 ? Math.round(s.p * 100) + '%' : '';
    }

    preloadFFmpeg() {
      this.showFFProgress({ p: -1, label: 'Carregando o motor FFmpeg…' });
      this.ffmpeg.load(x => this.showFFProgress({ p: x, label: 'Baixando o motor FFmpeg (~31 MB)…' }))
        .then(() => { this.showFFProgress(null); this.controls.osd('Motor FFmpeg pronto'); })
        .catch(e => { this.showFFProgress(null); this.error(e.message); });
    }

    error(msg) {
      this.log.warn('ui', msg);
      const box = U.$('#toasts');
      const t = el('div', { class: 'toast error', role: 'alert' }, U.icon('warning'), el('span', {}, msg), el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Fechar', onclick: () => t.remove() }, U.icon('close')));
      box.appendChild(t);
      setTimeout(() => t.classList.add('hide'), 7000);
      setTimeout(() => t.remove(), 7600);
    }

    quit() {
      this.player.stop();
      this.streamServer.stop();
      if (this.recorder.recording) this.recorder.stop();
      VW.ui.Win.closeAll();
      this.player.item = null;
      this.player.setState('idle');
      this.player.playlist.clear();
      this.controls.updateAll();
      window.close();
      this.controls.osd('Reprodução encerrada');
    }

    /* ======================= Efeitos salvos ======================= */
    saveEffects() {
      const a = this.player.audio.state, r = Object.assign({}, this.player.renderer.p);
      U.store.set('effects', { audio: JSON.parse(JSON.stringify(a)), video: r });
    }
    loadEffects() {
      const s = U.store.get('effects', null);
      if (!s) return;
      const A = this.player.audio;
      if (s.audio) {
        Object.assign(A.state.eq, s.audio.eq || {}); Object.assign(A.state.comp, s.audio.comp || {}); Object.assign(A.state.spat, s.audio.spat || {}); Object.assign(A.state.widen, s.audio.widen || {});
        A.state.pitch = s.audio.pitch || 0; A.state.stereo = s.audio.stereo || 'stereo'; A.state.delay = s.audio.delay || 0;
      }
      if (s.video) { const v = Object.assign({}, s.video); delete v.logo; delete v.deinterlace; this.player.renderer.setMany(v); }
    }

    /* ======================= Inicialização por URL / sistema ======================= */
    /**
     * index.html?url=<mídia>[&url=<outra>][&play=1][&title=<título>][&sub=<legenda>]
     * (aceita também mrl=, autoplay=, titulo= e legenda=). Usado, por exemplo, pelo botão
     * "▶ VLC" do navegador pelo celular do Termux-Toons.
     */
    handleUrlParams() {
      const q = new URLSearchParams(location.search);
      const urls = q.getAll('url').concat(q.getAll('mrl')).map(u => u.trim()).filter(Boolean);
      if (!urls.length) return;
      const play = /^(1|true|sim|yes)$/i.test(q.get('play') || q.get('autoplay') || '');
      const title = (q.get('title') || q.get('titulo') || '').trim();
      const sub = (q.get('sub') || q.get('legenda') || '').trim();
      (async () => {
        let subsFile = null;
        if (sub) {
          try {
            const res = await U.phoneFetch(new URL(sub, location.href).href);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            subsFile = new File([await res.blob()], U.urlFileName(sub) || 'legenda.srt');
          } catch (e) { this.log.warn('input', 'Não foi possível baixar a legenda: ' + e.message); }
        }
        for (let i = 0; i < urls.length; i++) {
          await this.openURL(urls[i], { play: play && i === 0, title: urls.length === 1 ? title : '', subsFile: i === 0 ? subsFile : null });
        }
      })();
      if (U.phone) this.log.info('input', 'Rede pelo celular (Termux-Toons): os links de rede são carregados pela conexão do celular.');
    }
    handleLaunchQueue() {
      if ('launchQueue' in window) {
        window.launchQueue.setConsumer(async params => {
          if (!params.files || !params.files.length) return;
          const files = await Promise.all(params.files.map(async h => ({ file: await h.getFile(), handle: h })));
          this.openFiles(files, { play: true });
        });
      }
    }
  }

  function viewLabel(k) { return { aspect: 'Proporção', crop: 'Corte', zoom: 'Zoom' }[k] || k; }
  VW.App = App;

  window.addEventListener('DOMContentLoaded', () => {
    try { new App(); }
    catch (e) {
      console.error(e);
      document.body.insertAdjacentHTML('beforeend', `<div class="fatal">Erro ao iniciar o VLC Web: ${U.escapeHtml(e.message)}</div>`);
    }
  });
})(window.VW = window.VW || {});
