/* VLC Web — preferências persistentes (equivalente a Ferramentas → Preferências) */
(function (VW) {
  'use strict';
  const U = VW.util;

  const DEFAULTS = {
    /* Interface */
    theme: 'dark',                 // (legado) dark | light | system — substituído por "skin"
    skin: 'default',               // tema visual (ver js/core/skins.js) ou "auto"
    layout: 'auto',                // estrutura do layout: auto (do tema) | classic | floating | framed | ...
    accent: '#ff8800',
    accentOverride: false,         // true = usa "accent" no lugar da cor do tema
    minimalView: false,
    showStatusbar: true,
    showAdvancedControls: false,
    playlistVisible: false,
    playlistDocked: true,
    playlistWidth: 380,
    playlistColumns: ['title', 'duration', 'artist'],
    fsControlsTimeout: 3,          // segundos para esconder os controles em tela cheia
    pauseOnHidden: false,          // pausar quando a aba fica oculta (≈ "pausar ao minimizar")
    resumePlayback: 'ask',         // ask | always | never
    showMediaChangePopup: true,    // mostra o título ao trocar de mídia
    saveRecent: true,
    maxRecent: 15,
    startPaused: false,
    playAndStop: false,            // parar após cada item
    playAndExit: false,            // sair ao final da lista
    clickToPause: false,
    doubleClickFullscreen: true,
    wheelAction: 'volume',         // volume | seek | none
    toolbar: ['play', 'sep', 'prev', 'stop', 'next', 'sep', 'fullscreen', 'effects', 'playlist', 'loop', 'shuffle', 'spacer', 'volume'],
    advToolbar: ['record', 'snapshot', 'abloop', 'frame'],
    useFilePicker: true,           // usa File System Access API quando disponível

    /* Áudio */
    audioEnabled: true,
    audioMode: 'auto',             // auto (motor de efeitos, com saída direta como alternativa) | direct
    volume: 1,
    maxVolume: 1.25,               // 125% como no VLC (pode ir até 200%)
    rememberVolume: true,
    volumeStep: 0.05,
    normalize: false,
    normalizeLevel: 2.0,
    preservePitch: true,           // "scaletempo"
    visualization: 'none',         // none | spectrum | spectrometer | scope | vumeter | goom | spectrum3d
    audioDevice: 'default',
    preferredAudioLang: 'por,pt',
    eqIsoBands: false,

    /* Vídeo */
    videoEnabled: true,
    fullscreenOnStart: false,
    snapshotFormat: 'png',         // png | jpeg | webp
    snapshotPrefix: 'vlcsnap-',
    snapshotPreview: true,
    maxResolution: 'auto',         // auto (tamanho da tela) | original | 2160 | 1440 | 1080 | 720 | 480 | 360
    directVideo: true,             // exibe o vídeo direto (sem WebGL) quando não há efeitos — mais leve
    lagHint: true,                 // avisa quando o vídeo trava e sugere reduzir a resolução
    deinterlace: 'off',            // off | on
    deinterlaceMode: 'blend',      // discard | blend | bob | linear
    titleOnStart: true,
    titleTimeout: 5,

    /* Legendas / OSD */
    osdEnabled: true,
    subsAutoload: true,
    subsEncoding: 'auto',
    subsFallbackEncoding: 'windows-1252',
    subsFont: 'Arial, Helvetica, sans-serif',
    subsSize: 'normal',            // smaller | small | normal | large | larger
    subsScale: 100,
    subsColor: '#ffffff',
    subsOpacity: 100,
    subsOutline: 'normal',         // none | thin | normal | thick
    subsOutlineColor: '#000000',
    subsBackground: false,
    subsBgColor: '#000000',
    subsBgOpacity: 50,
    subsShadow: true,
    subsBold: false,
    subsMargin: 5,                 // % a partir da borda inferior
    preferredSubLang: 'por,pt',
    subsDelayStep: 50,             // ms

    /* Legendas online e tradução */
    subsSearchLangs: ['pt-BR', 'en'],
    subsProviders: ['opensubtitles', 'subdl', 'subsource'],
    osApiKey: '', osToken: '', osUser: '', osBaseUrl: '',
    subdlApiKey: '',
    subsourceApiKey: '',
    subsCorsProxy: '',
    translateEngine: 'auto',       // auto | builtin | mymemory | libre
    translateTarget: 'pt-BR',
    mymemoryEmail: '',
    libreUrl: 'https://libretranslate.com',
    libreKey: '',

    /* Entrada / Codecs */
    imageDuration: 10,             // segundos (0 = infinito)
    jumpVeryShort: 3,
    jumpShort: 10,
    jumpMedium: 60,
    jumpLong: 300,
    ffmpegMode: 'ask',             // ask | always | never — para formatos não suportados
    ffmpegCoreBase: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/',
    recordFormat: 'auto',          // auto | webm | mp4
    recordPrefix: 'vlc-record-',
    hlsMaxBuffer: 30,              // segundos de buffer em fluxos HLS

    /* Teclas de atalho (sobrescritas do usuário: { acao: ['Ctrl+X'] }) */
    hotkeys: {}
  };

  class Settings extends U.Emitter {
    constructor() {
      super();
      this.defaults = DEFAULTS;
      const stored = U.store.get('settings', {});
      // migração: a preferência antiga "theme" vira o tema visual equivalente
      if (stored && !stored.skin && stored.theme) stored.skin = stored.theme === 'light' ? 'light' : stored.theme === 'system' ? 'auto' : 'default';
      // migração: o item "Áudio → Faixa de áudio → Desativar" desligava o áudio de forma permanente; religa uma vez
      if (stored && !stored._audioFix1) { stored.audioEnabled = true; stored._audioFix1 = true; }
      this.data = Object.assign({}, DEFAULTS, stored);
    }
    get(key) { return this.data[key]; }
    set(key, value) {
      const old = this.data[key];
      if (JSON.stringify(old) === JSON.stringify(value)) return;
      this.data[key] = value;
      this.save();
      this.emit('change', key, value, old);
      this.emit('change:' + key, value, old);
    }
    setMany(obj) { for (const k in obj) this.set(k, obj[k]); }
    all() { return Object.assign({}, this.data); }
    save() { U.store.set('settings', this.data); }
    reset() {
      const old = this.data;
      this.data = Object.assign({}, DEFAULTS);
      this.save();
      for (const k in DEFAULTS) {
        if (JSON.stringify(old[k]) !== JSON.stringify(DEFAULTS[k])) {
          this.emit('change', k, DEFAULTS[k], old[k]);
          this.emit('change:' + k, DEFAULTS[k], old[k]);
        }
      }
    }
  }

  VW.Settings = Settings;
})(window.VW = window.VW || {});
