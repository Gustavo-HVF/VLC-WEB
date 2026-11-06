/* VLC Web — núcleo do reprodutor
 * Coordena: elementos de mídia, motor de áudio, renderizador de vídeo, legendas, lista de reprodução,
 * HLS/DASH, captura, áudio externo sincronizado, FFmpeg, repetição A→B, marcadores, capítulos,
 * retomada de reprodução, mídia recente e integração com as teclas de mídia do sistema. */
(function (VW) {
  'use strict';
  const U = VW.util;

  const RATES = [0.0625, 0.125, 0.25, 0.33, 0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 6, 8, 12, 16];

  /* ---------- Imagens como mídia (o VLC exibe imagens por N segundos) ---------- */
  class ImageMedia extends EventTarget {
    constructor() {
      super();
      this.img = new Image();
      this.tagName = 'IMAGE-MEDIA';
      this._t = 0; this._dur = 10; this.paused = true; this.ended = false; this.playbackRate = 1;
      this.readyState = 0; this.error = null; this.buffered = { length: 0 };
      this._timer = null;
    }
    get videoWidth() { return this.img.naturalWidth || 0; }
    get videoHeight() { return this.img.naturalHeight || 0; }
    get duration() { return this._dur > 0 ? this._dur : Infinity; }
    get currentTime() { return this._t; }
    set currentTime(v) { this._t = U.clamp(v, 0, this._dur > 0 ? this._dur : 1e9); this.ended = false; this._fire('seeking'); this._fire('seeked'); this._fire('timeupdate'); }
    _fire(t) { this.dispatchEvent(new Event(t)); }
    load(url, dur) {
      this.unload();
      this._dur = dur;
      this._t = 0; this.ended = false;
      this.img.onload = () => { this.readyState = 4; this._fire('loadedmetadata'); this._fire('durationchange'); this._fire('canplay'); };
      this.img.onerror = () => { this.error = { code: 4, message: 'Imagem inválida' }; this._fire('error'); };
      this.img.src = url;
    }
    unload() { this.pause(); this.img.onload = this.img.onerror = null; this.img.removeAttribute('src'); this.readyState = 0; }
    play() {
      if (!this.paused) return Promise.resolve();
      this.paused = false; this.ended = false;
      let last = performance.now();
      this._timer = setInterval(() => {
        const now = performance.now();
        this._t += (now - last) / 1000 * this.playbackRate; last = now;
        if (this._dur > 0 && this._t >= this._dur) { this._t = this._dur; this.pause(); this.ended = true; this._fire('timeupdate'); this._fire('ended'); return; }
        this._fire('timeupdate');
      }, 100);
      this._fire('play'); this._fire('playing');
      return Promise.resolve();
    }
    pause() { if (this.paused) return; this.paused = true; clearInterval(this._timer); this._fire('pause'); }
  }

  const MEDIA_EVENTS = ['loadedmetadata', 'durationchange', 'timeupdate', 'play', 'playing', 'pause', 'waiting', 'ended', 'error', 'ratechange', 'progress', 'seeking', 'seeked', 'canplay', 'stalled', 'resize'];

  class Player extends U.Emitter {
    constructor(o) {
      super();
      this.settings = o.settings;
      this.log = o.log;
      this.ffmpeg = o.ffmpeg;
      this.library = o.library;
      this.stage = o.stage;
      this.videoMain = o.videoMain;
      this.videoRaw = o.videoRaw;
      this.imageMedia = new ImageMedia();
      this.media = this.videoMain;
      this.playlist = new VW.Playlist();
      this.audio = new VW.AudioEngine(this.settings, this.log);
      this.renderer = new VW.VideoRenderer(this.stage, o.canvas, this.log);
      this.subs = new VW.subtitles.SubtitleManager(o.subsLayer, this.settings);
      this.visualizer = new VW.Visualizer(o.visCanvas, this.audio);
      this.item = null;
      this.state = 'idle';
      this.rate = 1;
      this.ab = { a: null, b: null };
      this.chapters = [];
      this.loadToken = 0;
      this.restricted = false;
      this.objectURL = null;
      this.hls = null;
      this.dash = null;
      this.slave = null;
      this.slaveKind = null;        // 'extra' (arquivo externo) | 'track' (faixa extraída do próprio arquivo)
      this._dl = null;              // download em andamento (AbortController)
      this.streamSrc = null;
      this.videoEnabled = true;
      this.syncMarks = { audio: null, sub: null };
      this.recent = U.store.get('recent', []);
      this.resumeData = U.store.get('resume', {});
      this.bookmarksData = U.store.get('bookmarks', {});

      for (const el of [this.videoMain, this.videoRaw, this.imageMedia]) {
        for (const ev of MEDIA_EVENTS) el.addEventListener(ev, e => this.onMediaEvent(ev, e, el));
      }
      for (const v of [this.videoMain, this.videoRaw]) v.textTracks.addEventListener('addtrack', e => { if (v === this.media) this.onTextTrack(e.track); });
      this.audioTrackOff = false;
      // saída direta: o áudio sai pelo próprio elemento de mídia, sem o motor de efeitos (máxima compatibilidade)
      this.directAudio = this.settings.get('audioMode') === 'direct';
      this.settings.on('change:audioMode', v => this.switchAudioRoute(v === 'direct'));
      this.audio.on('ctxstate', () => this.checkAudioHealth());
      this.renderer.marqueeVars = () => this.marqueeVars();
      this.renderer.on('layout', r => this.subs.setRect(r));
      this.renderer.on('tainted', () => { this.restricted = true; this.emit('osd', 'Modo de compatibilidade: filtros de vídeo limitados (sem CORS)'); });
      this.settings.on('change:preservePitch', v => this.applyPitchPreference(v));
      this.settings.on('change:visualization', () => this.updateAudioView());
      this.settings.on('change:audioEnabled', () => this.applySourceGain());
      this.settings.on('change:videoEnabled', v => this.setVideoEnabled(v));
      this.settings.on('change:deinterlace', () => this.applyDeinterlace());
      // desempenho: resolução máxima e exibição direta
      this.renderer.setMaxRes(this.settings.get('maxResolution'));
      this.renderer.setDirectIdle(this.settings.get('directVideo'));
      this.settings.on('change:maxResolution', v => { this.renderer.setMaxRes(v); this.applyStreamCap(); this.emit('tracks'); });
      this.settings.on('change:directVideo', v => this.renderer.setDirectIdle(v));
      this.renderer.on('resolution', () => { if (this.settings.get('maxResolution') === 'auto') this.applyStreamCapSoon(); });
      this._perfTimer = setInterval(() => this.checkPerformance(), 2000);
      this.settings.on('change:deinterlaceMode', () => this.applyDeinterlace());
      this.playlist.on('change', () => this.scheduleProbe());
      this.applyDeinterlace();
      this._tick = this._tick.bind(this);
      requestAnimationFrame(this._tick);
      this.setupMediaSession();
      this.saveResumeThrottled = U.throttle(() => this.saveResume(), 4000);
    }

    /* ======================= estado ======================= */
    setState(s) {
      if (this.state === s) return;
      this.state = s;
      this.emit('state', s);
      if (U.supports.mediaSession) navigator.mediaSession.playbackState = s === 'playing' ? 'playing' : s === 'paused' ? 'paused' : 'none';
    }
    get isImage() { return this.media === this.imageMedia; }
    get currentTime() { return this.item ? (this.media.currentTime || 0) : 0; }
    get duration() { const d = this.item ? this.media.duration : NaN; return isFinite(d) ? d : (this.item && isFinite(this.item.duration) && !this.item.stream ? this.item.duration : NaN); }
    get isLive() { return !!(this.item && (this.item.stream || this.media.duration === Infinity)); }
    get hasVideo() { return this.renderer.hasVideo && this.videoEnabled; }
    get playing() { return this.state === 'playing' || this.state === 'buffering'; }

    /* ======================= abertura ======================= */
    /** Adiciona e (opcionalmente) reproduz. entries: dados para PlaylistItem. */
    enqueue(entries, { play = false, at } = {}) {
      if (!entries.length) return [];
      const items = this.playlist.add(entries, at);
      if (play) this.playIndex(this.playlist.items.indexOf(items[0]));
      return items;
    }

    playIndex(i, opts) {
      const it = this.playlist.items[i];
      if (!it) return;
      this.playlist.setIndex(i);
      this.open(it, opts);
    }

    playItem(item, opts) { const i = this.playlist.items.indexOf(item); if (i >= 0) this.playIndex(i, opts); }

    async open(item, opts = {}) {
      // no navegador pelo celular (Termux-Toons), os links de rede passam pela conexão do celular
      if (item.url && !item.stream && !item.viaPhone && U.needsPhone(item.url)) {
        const req = this._phoneReq = (this._phoneReq || 0) + 1;
        const url = await U.viaPhone(item.url);
        if (req !== this._phoneReq) return;   // outro item foi aberto enquanto isso
        if (url !== item.url) { item.originalUrl = item.url; item.url = url; }
        item.viaPhone = true;
      }
      this._phoneReq = (this._phoneReq || 0) + 1;
      this.unload();
      const token = ++this.loadToken;
      this.item = item;
      this.restricted = false;
      this.audioTrackOff = false;
      this._lagWarned = false; this._lagCount = 0; this._perf = null;
      this._audioBlocked = false;
      this.emit('audio-blocked', false);
      this.renderer.setTainted(false);
      this.setState('opening');
      this.emit('item', item);
      this.log.info('input', 'Abrindo: ' + item.uri);
      this.pendingStart = opts.startTime ?? (item.startTime || 0);
      this.autoplay = opts.autoplay !== undefined ? opts.autoplay : !this.settings.get('startPaused');
      this.addRecent(item);
      if (item.file && !item.info) this.readMeta(item);
      else if (item.info) this.applyChapters(item);
      else if (item.url && !item.stream) this.inspectRemote(item);

      if (item.missing) {
        this.fail(`Arquivo não encontrado: "${item.path || item.title}". Listas de reprodução não dão acesso a arquivos locais — abra o arquivo ou a pasta junto com a lista.`);
        return;
      }
      try {
        if (item.kind === 'image' && (item.file || item.url)) {
          this.media = this.imageMedia;
          const url = item.file ? (this.objectURL = URL.createObjectURL(item.file)) : item.url;
          this.imageMedia.load(url, this.settings.get('imageDuration'));
          return;
        }
        const direct = this.directAudio && !item.stream;
        const el = direct ? this.videoRaw : this.videoMain;
        this.media = el;
        if (!direct) this.audio.attach(el);
        this.applySourceGain();
        if (item.stream) {
          el.srcObject = item.stream;
          this.audio.setSourceGain(el, 0);
          if (item.stream.getAudioTracks().length) this.streamSrc = this.audio.attachStream(item.stream);
          return;
        }
        if (item.playable || item.file) {
          el.removeAttribute('crossorigin');
          this.objectURL = URL.createObjectURL(item.playable || item.file);
          el.src = this.objectURL;
          el.load();
          return;
        }
        if (item.url) {
          const url = item.url;
          if (/^(rtsp|rtmp|udp|rtp|mms|smb|ftp|sftp|dvd|vcd|cdda|bluray|dshow|v4l2|screen):/i.test(url)) {
            this.fail(`O protocolo "${url.split(':')[0]}" não pode ser acessado por navegadores. Use HTTP(S), HLS (.m3u8) ou DASH (.mpd).`);
            return;
          }
          if (/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url)) {
            this.fail('Links do YouTube não podem ser reproduzidos diretamente no navegador (bloqueio de origem/CORS). Use a URL direta do arquivo de mídia.');
            return;
          }
          if (location.protocol === 'https:' && url.startsWith('http:')) this.log.warn('input', 'URL HTTP em página HTTPS: o navegador pode bloquear o conteúdo misto.');
          const fext = U.ext(U.urlFileName(url));
          if (isHls(url) || fext === 'm3u8') return await this.loadHls(url, token);
          if (isDash(url) || fext === 'mpd') return await this.loadDash(url, token);
          el.crossOrigin = 'anonymous';
          el.src = url;
          el.load();
        }
      } catch (e) {
        if (token === this.loadToken) this.fail('Erro ao abrir: ' + e.message);
      }
    }

    async loadHls(url, token) {
      const el = this.media;
      try { await U.loadScript('vendor/hls/hls.min.js'); } catch (e) { /* sem hls.js */ }
      if (token !== this.loadToken) return;
      if (window.Hls && window.Hls.isSupported()) {
        const Hls = window.Hls;
        const hls = this.hls = new Hls({ maxBufferLength: this.settings.get('hlsMaxBuffer'), enableWorker: true });
        hls.subtitleDisplay = false;
        hls.on(Hls.Events.MANIFEST_PARSED, () => { this.log.info('hls', `HLS: ${hls.levels.length} qualidades, ${hls.audioTracks.length} faixas de áudio`); this.applyStreamCap(); this.emit('tracks'); });
        for (const ev of [Hls.Events.AUDIO_TRACKS_UPDATED, Hls.Events.AUDIO_TRACK_SWITCHED, Hls.Events.LEVEL_SWITCHED, Hls.Events.SUBTITLE_TRACKS_UPDATED]) hls.on(ev, () => this.emit('tracks'));
        let recovered = 0;
        hls.on(Hls.Events.ERROR, (ev, data) => {
          if (!data.fatal) return;
          this.log.error('hls', `${data.type}: ${data.details}`);
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR && recovered++ < 2) hls.recoverMediaError();
          else if (data.type === Hls.ErrorTypes.NETWORK_ERROR && data.details !== 'manifestLoadError' && recovered++ < 3) hls.startLoad();
          else this.fail('Falha no fluxo HLS (' + data.details + '). O servidor pode não permitir acesso pelo navegador (CORS).');
        });
        hls.loadSource(url);
        hls.attachMedia(el);
      } else if (el.canPlayType('application/vnd.apple.mpegurl')) {
        el.src = url;
        el.load();
      } else this.fail('Este navegador não suporta HLS.');
    }

    async loadDash(url, token) {
      try { await U.loadScript('vendor/dash/dash.all.min.js'); } catch (e) { this.fail('Não foi possível carregar o suporte a DASH.'); return; }
      if (token !== this.loadToken) return;
      const d = this.dash = window.dashjs.MediaPlayer().create();
      d.updateSettings({ debug: { logLevel: 1 } });
      d.on(window.dashjs.MediaPlayer.events.ERROR, e => { this.log.error('dash', JSON.stringify(e.error || e).slice(0, 200)); });
      d.on(window.dashjs.MediaPlayer.events.STREAM_INITIALIZED, () => { this.applyStreamCap(); this.emit('tracks'); });
      d.on(window.dashjs.MediaPlayer.events.QUALITY_CHANGE_RENDERED, () => this.emit('tracks'));
      d.initialize(this.media, url, false);
    }

    unload() {
      this.saveResume();
      ++this.loadToken;
      if (this.hls) { try { this.hls.destroy(); } catch (e) { /* ok */ } this.hls = null; }
      if (this.dash) { try { this.dash.reset(); } catch (e) { /* ok */ } this.dash = null; }
      for (const el of [this.videoMain, this.videoRaw]) {
        el.pause();
        if (el.srcObject) el.srcObject = null;
        if (el.hasAttribute('src')) { el.removeAttribute('src'); el.load(); }
      }
      this.imageMedia.unload();
      if (this.objectURL) { URL.revokeObjectURL(this.objectURL); this.objectURL = null; }
      if (this.streamSrc) { try { this.streamSrc.disconnect(); } catch (e) { /* ok */ } this.streamSrc = null; }
      this.stopSlave();
      this.subs.clear();
      this.renderer.setSource(null);
      this.renderer.show(false);
      this.chapters = [];
      this.ab = { a: null, b: null };
      this.emit('ab', this.ab);
      this.media = this.videoMain;
      this.fallbackTried = false;
      this.suggested = false;
    }

    /* ======================= eventos de mídia ======================= */
    onMediaEvent(type, e, el) {
      if (el !== this.media) return;
      switch (type) {
        case 'loadedmetadata': this.onLoaded(); break;
        case 'durationchange': this.emit('duration', this.duration); break;
        case 'timeupdate':
          this.emit('time', this.currentTime);
          if (this.item && this.item.stopTime && this.currentTime >= this.item.stopTime) this.onEnded();
          this.saveResumeThrottled();
          break;
        case 'play': case 'playing':
          this.setState('playing');
          clearTimeout(this._healthT);
          this._healthT = setTimeout(() => this.checkAudioHealth(), 700);
          if (this.slave) { this.slave.currentTime = this.media.currentTime; this.slave.play().catch(() => {}); }
          break;
        case 'pause': this.checkAudioHealth(); if (this.state !== 'stopped' && this.state !== 'ended' && !this.media.ended) this.setState('paused'); if (this.slave) this.slave.pause(); this.saveResume(); break;
        case 'waiting': case 'stalled': if (!this.media.paused) this.setState('buffering'); if (type === 'waiting' && this.slave) this.slave.pause(); break;
        case 'canplay': if (this.state === 'buffering' && !this.media.paused) this.setState('playing'); break;
        case 'ended': this.onEnded(); break;
        case 'error': this.onError(); break;
        case 'ratechange': this.emit('rate', this.media.playbackRate); if (this.slave) this.slave.playbackRate = this.media.playbackRate; break;
        case 'progress': this.emit('buffer'); break;
        case 'seeking': if (this.slave) this.slave.currentTime = this.media.currentTime; break;
        case 'seeked': this.emit('time', this.currentTime); this.renderer.dirty = true; this.subs.update(this.currentTime); break;
        case 'resize': this.renderer.layout(); break;
      }
    }

    onLoaded() {
      const m = this.media, item = this.item;
      if (!item) return;
      const isVid = m.videoWidth > 0;
      this.renderer.setSource(m.tagName === 'IMAGE-MEDIA' ? m.img : m);
      if (this.restricted) this.renderer.setTainted(true);
      this.renderer.show(isVid && this.videoEnabled);
      if (isFinite(m.duration) && !item.stream) item.duration = m.duration;
      try { m.playbackRate = this.rate; } catch (e) { /* ok */ }
      this.applyPitchPreference(this.settings.get('preservePitch'));
      this.setVolume(this.audio.volume, true);
      this.loadItemSubtitles(item);
      if (m.textTracks) for (const tt of Array.from(m.textTracks)) this.onTextTrack(tt);
      this.updateAudioView();
      let start = this.pendingStart || 0;
      const saved = this.resumeData[item.key];
      const mode = this.settings.get('resumePlayback');
      if (!start && saved && mode !== 'never' && !item.stream && saved.pos > 5 && (!isFinite(m.duration) || saved.pos < m.duration - 10)) {
        if (mode === 'always') { start = saved.pos; this.emit('osd', 'Continuando de ' + U.fmtTime(saved.pos)); }
        else this.emit('resume-ask', saved.pos);
      }
      if (start > 0 && isFinite(m.duration)) m.currentTime = Math.min(start, m.duration - 0.5);
      this.pendingStart = 0;
      const routeSwitch = !!this.switchingRoute;
      this.switchingRoute = false;
      this.emit('duration', this.duration);
      this.emit('loaded', item, { routeSwitch });
      this.emit('tracks');
      this.applyChapters(item);
      this.updateMediaSession();
      const trackBlob = this.selectedTrackBlob(item);
      if (trackBlob) this.startSlave(trackBlob, 'track');
      else if (item.extraAudio) this.startSlave(item.extraAudio, 'extra');
      this.log.info('input', `Mídia carregada: ${isVid ? m.videoWidth + 'x' + m.videoHeight : 'somente áudio'}${isFinite(m.duration) ? ', ' + U.fmtTime(m.duration) : ''}`);
      if (this.autoplay) this.playMedia(); else this.setState('paused');
      if (this.settings.get('fullscreenOnStart') && isVid && !routeSwitch) this.emit('request-fullscreen');
      if (!this.isImage && !routeSwitch) {
        if (!this.settings.get('audioEnabled')) this.emit('osd', 'Áudio desativado em Preferências → Áudio');
        else if (this.audio.muted) this.emit('osd', 'Som mudo — pressione M para ativar');
        else if (this.audio.volume < 0.01) this.emit('osd', 'Volume em 0%');
      }
      // Vídeo esperado mas não decodificado → oferecer o FFmpeg
      const vidExt = U.EXT.video.includes(U.ext(item.name));
      if (!isVid && vidExt && (item.file || (item.url && !this.hls && !this.dash)) && !item.playable && !this.isImage) {
        this.suggestFFmpeg(item, 'O navegador não conseguiu decodificar a imagem deste vídeo (codec não suportado, ex.: HEVC, MPEG‑2, VC‑1).');
      } else if ((item.file || item.url) && !item.playable && !this.isImage && !this.hls && !this.dash) {
        this.checkAudioCodec(item);
        setTimeout(() => this.checkAudioDecoding(item), 2500);
      }
    }

    /** Áudio em formato que o navegador não decodifica (AC‑3, DTS…): oferece converter só o áudio com o FFmpeg. */
    checkAudioCodec(item) {
      if (item !== this.item || item.playable || this.suggested || (!item.file && !item.url) || this.slaveKind === 'track') return;
      if (!(this.media.readyState >= 1) || this.state === 'error' || this.hls || this.dash) return;
      const name = unsupportedAudioCodec(item);
      if (!name) return;
      const others = this.containerAudioTracks().map((t, i) => ({ t, i })).filter(x => !trackUnsupported(x.t));
      const hint = others.length ? ` Outras faixas deste arquivo usam formatos compatíveis (menu Áudio → Faixa de áudio).` : '';
      this.suggestFFmpeg(item, `O áudio ${item.file ? 'deste arquivo' : 'deste link'} está em ${name}, formato que o navegador não consegue reproduzir — por isso o som não sai.` + hint, true, true);
    }

    /** Verificação por comportamento (para codecs não identificados pelos metadados). */
    checkAudioDecoding(item) {
      if (this.item !== item || this.media.paused || this.suggested || item.playable || this.slaveKind === 'track' || this.restricted) return;
      const m = this.media;
      const hasAudio = ((item.info && item.info.tracks) || []).some(t => t.type === 'audio');
      if (!hasAudio) return;
      const silent = m.webkitAudioDecodedByteCount === 0 || m.mozHasAudio === false || (m.audioTracks && m.audioTracks.length === 0);
      if (silent) this.suggestFFmpeg(item, 'O áudio deste arquivo não está sendo decodificado pelo navegador (formatos como AC‑3, E‑AC‑3 e DTS não são suportados) — por isso o som não sai.', true, true);
    }

    /** Ganho da fonte principal: zero se a faixa estiver desativada, o áudio desligado ou houver áudio externo. */
    applySourceGain() {
      const on = this.settings.get('audioEnabled') && !this.audioTrackOff;
      this.audio.setSourceGain(this.videoMain, on && !this.slave ? 1 : 0);
      const m = this.media;
      if (!m || m === this.imageMedia) return;
      if (this.audio.isAttached(m)) m.muted = false;
      else m.muted = !on || !!this.slave || this.audio.muted;
      const s = this.slave;
      if (s && this.audio.isAttached(s)) this.audio.setSourceGain(s, on ? 1 : 0);
      else if (s) s.muted = !on || this.audio.muted;
    }

    setAudioTrackOff(off) {
      this.audioTrackOff = off;
      this.applySourceGain();
      this.emit('tracks');
      this.emit('osd', off ? 'Faixa de áudio desativada' : 'Faixa de áudio ativada');
    }

    /** O som está bloqueado se a mídia toca pelo motor de efeitos e o navegador não liberou o contexto de áudio. */
    checkAudioHealth() {
      const m = this.media;
      const blocked = !!(this.item && m && !m.paused && !this.isImage && this.audio.isAttached(m) && this.audio.ctx && !this.audio.running);
      if (blocked !== !!this._audioBlocked) {
        this._audioBlocked = blocked;
        this.emit('audio-blocked', blocked);
        if (blocked) this.log.warn('audio', 'O navegador bloqueou o motor de áudio (' + this.audio.ctx.state + '): aguardando um clique para liberar o som');
      }
    }

    /** Escolha do usuário entre motor de efeitos e saída direta (também atualiza a preferência). */
    setDirectAudio(direct) {
      this.settings.set('audioMode', direct ? 'direct' : 'auto');
      this.switchAudioRoute(direct);
      if (!direct) this.audio.ensure();
    }

    /** Libera o som (chamado por um clique). Se o navegador recusar, passa para a saída direta. */
    async unlockAudio() {
      if (await this.audio.resume()) { this.checkAudioHealth(); this.emit('osd', 'Som ativado'); return true; }
      this.log.warn('audio', 'Não foi possível liberar o motor de áudio; usando a saída direta');
      this.switchAudioRoute(true);
      return false;
    }

    /**
     * Alterna a reprodução atual entre o motor de efeitos (Web Audio) e a saída direta do elemento.
     * (Um elemento ligado ao Web Audio não pode ser desligado; por isso a troca usa o segundo elemento.)
     */
    switchAudioRoute(direct) {
      this.directAudio = direct;
      const it = this.item, old = this.media;
      const target = direct ? this.videoRaw : this.videoMain;
      if (!it || it.stream || this.isImage || this.hls || this.dash || this.restricted || old === target) { this.applySourceGain(); this.checkAudioHealth(); return; }
      const src = old.currentSrc || old.getAttribute('src');
      if (!src) return;
      const t = old.currentTime, playing = !old.paused;
      old.pause();
      if (!direct) this.audio.attach(target);
      if (old.crossOrigin) target.crossOrigin = old.crossOrigin; else target.removeAttribute('crossorigin');
      this.media = target;
      this.pendingStart = t;
      this.autoplay = playing;
      this.switchingRoute = true;
      target.src = src;
      target.load();
      old.removeAttribute('src'); old.load();
      this.applySourceGain();
      this._audioBlocked = false;
      this.emit('audio-blocked', false);
      this.emit('osd', direct ? 'Saída de áudio direta (sem efeitos de áudio)' : 'Motor de efeitos de áudio ativado');
      this.emit('tracks');
    }

    playMedia() {
      if (this.audio.isAttached(this.media) || !this.directAudio) this.audio.ensure();
      const p = this.media.play();
      if (p && p.catch) p.catch(err => {
        if (err.name === 'NotAllowedError') { this.setState('paused'); this.emit('osd', 'Clique em reproduzir para iniciar'); }
        else if (err.name !== 'AbortError') this.log.warn('input', 'play(): ' + err.message);
      });
    }

    onError() {
      const item = this.item, m = this.media;
      if (!item) return;
      const err = m.error || {};
      const codes = { 1: 'abortado', 2: 'erro de rede', 3: 'erro de decodificação', 4: 'formato ou origem não suportados' };
      const recoverable = (item.file && !item.playable) || (item.url && !this.fallbackTried);
      this.log[recoverable ? 'warn' : 'error']('input', `Erro de mídia (${codes[err.code] || err.code}): ${err.message || ''}`);
      // URL de outra origem sem CORS → tenta modo de compatibilidade (sem Web Audio/WebGL)
      if (item.url && !this.hls && !this.dash && m !== this.imageMedia && m.crossOrigin && !this.fallbackTried) {
        this.fallbackTried = true;
        this.restricted = true;
        if (m.currentTime > 0) { this.pendingStart = m.currentTime; this.autoplay = this.autoplay || !m.paused; }
        const raw = this.videoRaw;
        if (m !== raw) { m.removeAttribute('src'); m.load(); }
        raw.removeAttribute('crossorigin');
        this.media = raw;
        raw.src = item.url;
        raw.load();
        this.log.warn('input', 'Tentando novamente sem CORS (modo de compatibilidade)');
        return;
      }
      if (item.file && !item.playable && (err.code === 3 || err.code === 4)) {
        this.suggestFFmpeg(item, 'O navegador não suporta este formato (' + (U.ext(item.name) || 'desconhecido').toUpperCase() + ').');
        return;
      }
      if (item.url && !item.file) { this.failRemote(item, err); return; }
      this.fail('Não foi possível reproduzir "' + item.title + '": ' + (codes[err.code] || 'erro desconhecido') + '.');
    }

    /** Falha definitiva de uma URL: explica a causa provável e, se possível, oferece baixar e converter. */
    async failRemote(item, err) {
      const tok = this.loadToken;
      if (this.hls || this.dash) { this.fail(`Não foi possível reproduzir "${item.title}": ${err.message || 'erro no fluxo adaptativo'}.`); return; }
      // espera a verificação do servidor (feita em paralelo) para dar uma explicação concreta
      if (!item.remote) await this.inspectRemote(item, { metaOnly: false });
      if (tok !== this.loadToken) return;
      const r = item.remote || {};
      const st = r.status;
      if (st === 401 || st === 403 || st === 410) return this.fail(`O servidor recusou o acesso a "${item.title}" (HTTP ${st}). Links de download com "token" costumam expirar ou só funcionar no site/aplicativo que os gerou — gere um link novo e tente outra vez.`);
      if (st === 404) return this.fail(`O arquivo "${item.title}" não existe mais no servidor (HTTP 404). O link pode ter expirado.`);
      if (st >= 400) return this.fail(`O servidor respondeu com erro HTTP ${st} ao abrir "${item.title}".`);
      if (r.cors && (err.code === 3 || err.code === 4)) {
        this.suggestFFmpeg(item, `O navegador não conseguiu reproduzir "${item.title}" diretamente (formato ou codec não suportado — p. ex. HEVC/H.265, MPEG‑2, AVI antigos).`);
        return;
      }
      if (err.code === 2) return this.fail(`Erro de rede ao baixar "${item.title}". Verifique a conexão e se o link ainda é válido.`);
      this.fail(`Não foi possível reproduzir "${item.title}". O servidor não permite acesso por outras páginas (CORS) e o navegador também não conseguiu reproduzir o arquivo diretamente — o link pode ter expirado, exigir login, bloquear reprodução fora do site de origem, ou usar um codec não suportado (ex.: HEVC/H.265). Tente baixar o arquivo e abri‑lo pelo menu Mídia → Abrir arquivo.`);
    }

    fail(msg) {
      this.setState('error');
      this.emit('error', msg);
      this.log.error('input', msg);
      const n = this.playlist.nextIndex(true);
      if (n >= 0 && n !== this.playlist.index && this.playlist.items.length > 1) {
        clearTimeout(this._failNext);
        const tok = this.loadToken;
        this._failNext = setTimeout(() => { if (tok === this.loadToken && this.state === 'error') this.playIndex(n); }, 2500);
      }
    }

    suggestFFmpeg(item, reason, soft, autoOk) {
      if (this.suggested) return;
      this.suggested = true;
      const mode = this.settings.get('ffmpegMode');
      if (mode === 'never') { if (!soft) this.fail(reason + ' Ative o decodificador FFmpeg em Preferências → Entrada/Codecs.'); else this.emit('osd', 'Sem som: formato de áudio não suportado pelo navegador'); return; }
      if (mode === 'always' && (!soft || autoOk) && item.file) { this.playWithFFmpeg(item, { audioOnly: soft }); return; }
      if (!item.file && item.url && item.remote && !item.remote.cors) {
        // sem CORS a página não consegue ler o arquivo: nada a converter
        if (!soft) this.fail(reason + ' Este servidor não permite que outras páginas leiam o arquivo (CORS); baixe‑o e abra‑o pelo menu Mídia → Abrir arquivo.');
        else this.emit('osd', 'Sem som: formato de áudio não suportado pelo navegador');
        return;
      }
      if (!soft) this.setState('error');
      this.emit('ffmpeg-ask', item, reason, soft);
    }

    /** Converte/remultiplexa com o FFmpeg e reproduz. */
    async playWithFFmpeg(item, opts = {}) {
      item = item || this.item;
      if (!item) return;
      if (!item.file) {
        if (!item.url || item.stream) { this.emit('error', 'O FFmpeg só pode ser usado com arquivos locais ou links de download.'); return; }
        if (!(await this.ensureLocal(item, { confirmed: opts.confirmed, reason: 'convert' }))) return;
      }
      // só o áudio é incompatível e o vídeo já toca: extrai/converte apenas a faixa de áudio (bem mais rápido)
      if (opts.audioOnly && this.item === item && !item.playable && this.state !== 'error') {
        const list = this.containerAudioTracks();
        await this.useAudioTrack(item, opts.audioIndex ?? defaultAudioIndex(list));
        return;
      }
      const resumeAt = opts.resumeAt ?? (this.item === item ? this.currentTime : 0);
      if (this.item === item) { this.media.pause(); }
      this.emit('ffmpeg-progress', { p: 0, label: 'Carregando o motor FFmpeg…' });
      try {
        await this.ffmpeg.load((p) => this.emit('ffmpeg-progress', { p, label: 'Baixando o motor FFmpeg (~31 MB, apenas na primeira vez)…' }));
        const res = await this.ffmpeg.makePlayable(item.file, {
          audioIndex: opts.audioIndex, probe: item.probe,
          extractSubs: !item.subsExtracted,
          onProgress: (p, label) => this.emit('ffmpeg-progress', { p, label })
        });
        item.playable = res.blob;
        item.probe = res.probe;
        item.audioIndex = res.audioIndex;
        item.playableAudio = res.audioIndex;
        if (!item.subsExtracted) {
          item.subsExtracted = true;
          for (const s of res.subtitles) item.subs.push(Object.assign(s.file, { _label: s.title, _lang: s.lang }));
        }
        if (isFinite(res.probe.duration)) item.duration = res.probe.duration;
        this.emit('ffmpeg-progress', null);
        this.emit('osd', 'Pronto: reproduzindo com FFmpeg');
        if (!this.item || this.item === item) this.open(item, { startTime: resumeAt, autoplay: true });
      } catch (e) {
        this.emit('ffmpeg-progress', null);
        if (/terminate/i.test(e.message || String(e))) { this.emit('osd', 'Conversão cancelada'); return; }
        this.fail('FFmpeg: ' + (e.message || e));
      }
    }

    onEnded() {
      if (!this.item) return;
      delete this.resumeData[this.item.key];
      U.store.set('resume', this.resumeData);
      if (this.ab.a !== null && this.ab.b === null) { this.seek(this.ab.a); this.playMedia(); return; }
      if (this.playlist.loop === 'one') { this.seek(this.item.startTime || 0); this.playMedia(); return; }
      if (this.settings.get('playAndStop')) { this.stop(); return; }
      const n = this.playlist.nextIndex(true);
      if (n < 0) {
        this.stop();
        this.setState('ended');
        if (this.settings.get('playAndExit')) this.emit('quit');
        return;
      }
      this.playIndex(n);
    }

    onTextTrack(tt) {
      if (!tt || tt.kind === 'metadata') return;
      if (tt.kind === 'chapters') { tt.mode = 'hidden'; setTimeout(() => this.applyChapters(this.item), 500); return; }
      const t = this.subs.addEmbedded(tt);
      if (t && !this.subs.activeId && this.preferredSubLang(t.lang)) this.subs.setActive(t.id);
    }

    preferredSubLang(lang) {
      const pref = (this.settings.get('preferredSubLang') || '').toLowerCase().split(/[,\s]+/).filter(Boolean);
      return !!lang && pref.some(p => lang.toLowerCase().startsWith(p));
    }

    async loadItemSubtitles(item) {
      for (const f of (item.subs || []).slice()) {
        if (this.subs.tracks.some(t => t.file === f)) continue;
        try {
          const t = await this.subs.addFile(f, { mediaName: item.name, label: f._label, fps: this.renderer.fps || undefined });
          if (f._lang) t.lang = f._lang;
          if (this.item !== item) return;
          if (!this.subs.activeId || this.preferredSubLang(t.lang)) this.subs.setActive(t.id);
        } catch (e) { this.log.warn('subs', e.message); this.emit('osd', e.message); }
      }
    }

    async addSubtitleFile(file) {
      if (!this.item) { this.emit('error', 'Abra uma mídia antes de adicionar a legenda.'); return; }
      try {
        const t = await this.subs.addFile(file, { mediaName: this.item.name, label: file._label, fps: this.renderer.fps || undefined });
        if (file._lang) t.lang = file._lang;
        this.item.subs.push(file);
        this.subs.setActive(t.id);
        this.emit('osd', 'Legenda adicionada: ' + (file._label || file.name));
        return t;
      } catch (e) { this.emit('error', e.message); return null; }
    }

    /* ======================= controles ======================= */
    play() {
      if (this.state === 'idle' || this.state === 'stopped' || this.state === 'ended' || this.state === 'error') {
        if (this.item && this.playlist.items.includes(this.item)) { this.open(this.item, { autoplay: true }); return true; }
        if (this.playlist.items.length) { this.playIndex(Math.max(0, this.playlist.index)); return true; }
        return false;
      }
      this.playMedia();
      return true;
    }
    pause() { if (this.item) this.media.pause(); }
    togglePause() {
      if (this.state === 'playing' || this.state === 'buffering') { this.pause(); return 'pause'; }
      return this.play() ? 'play' : false;
    }
    stop() {
      if (!this.item) return;
      this.saveResume();
      const keep = this.item;
      this.unload();
      this.item = keep;
      this.setState('stopped');
      this.emit('time', 0);
      this.emit('stopped');
    }
    next() {
      const n = this.playlist.nextIndex(false);
      if (n >= 0) this.playIndex(n); else this.emit('osd', 'Fim da lista de reprodução');
    }
    prev() {
      if (this.currentTime > 5 && !this.playlist.shuffle && this.item) { this.seek(0); return; }
      const n = this.playlist.prevIndex();
      if (n >= 0) this.playIndex(n);
    }

    seek(t, fast) {
      if (!this.item || this.isLive) return;
      const d = this.duration;
      t = U.clamp(t, 0, isFinite(d) ? Math.max(0, d - 0.05) : t);
      if (fast && this.media.fastSeek) this.media.fastSeek(t);
      else this.media.currentTime = t;
      this.emit('time', t);
    }
    seekRel(dt) {
      if (!this.item) return;
      this.seek(this.currentTime + dt);
      this.emit('osd', `${dt > 0 ? '⏩' : '⏪'} ${Math.abs(dt) >= 60 ? (Math.abs(dt) / 60) + ' min' : Math.abs(dt) + ' s'}  (${U.fmtTime(this.currentTime)} / ${U.fmtTime(this.duration)})`);
    }
    seekFraction(f) { const d = this.duration; if (isFinite(d)) this.seek(d * f); }

    frameStep() {
      if (!this.item || this.isImage) return;
      if (!this.media.paused) this.media.pause();
      const fps = this.renderer.fps || (this.item.probe && (this.item.probe.streams.find(s => s.fps) || {}).fps) || 25;
      this.seek(this.currentTime + 1 / fps);
      this.emit('osd', 'Quadro a quadro');
    }

    setRate(r, silent) {
      r = U.clamp(Math.round(r * 1000) / 1000, 0.0625, 16);
      this.rate = r;
      if (this.item) { try { this.media.playbackRate = r; } catch (e) { this.log.warn('input', 'Velocidade não suportada: ' + r); } }
      if (this.slave) this.slave.playbackRate = r;
      this.emit('rate', r);
      if (!silent) this.emit('osd', `Velocidade: ${r.toFixed(2)}x`);
    }
    faster() { this.setRate(RATES.find(x => x > this.rate + 1e-3) || 16); }
    slower() { this.setRate([...RATES].reverse().find(x => x < this.rate - 1e-3) || 0.0625); }
    fasterFine() { this.setRate(this.rate + 0.1); }
    slowerFine() { this.setRate(Math.max(0.1, this.rate - 0.1)); }
    normalRate() { this.setRate(1); }

    applyPitchPreference(v) {
      const m = this.media;
      if (!m || this.isImage) return;
      m.preservesPitch = v; m.mozPreservesPitch = v; m.webkitPreservesPitch = v;
    }

    setVolume(v, silent) {
      const max = this.settings.get('maxVolume') || 1.25;
      v = U.clamp(v, 0, Math.max(max, 1));
      const viaEngine = this.audio.ctx && this.media && this.audio.isAttached(this.media) && !this.restricted;
      if (viaEngine || !this.item) this.audio.setVolume(v);
      else { this.audio.volume = v; this.media.volume = Math.min(1, v); this.audio.emit('volume', v, this.audio.muted); if (this.settings.get('rememberVolume')) this.settings.set('volume', v); }
      if (this.slave && !this.audio.isAttached(this.slave)) this.slave.volume = Math.min(1, v);
      if (!silent) this.emit('osd', `Volume ${Math.round(v * 100)}%`);
    }
    changeVolume(delta) { if (this.audio.muted) this.toggleMute(); this.setVolume(this.audio.volume + delta); }
    toggleMute() {
      const m = !this.audio.muted;
      this.audio.setMuted(m);
      this.applySourceGain();
      this.emit('osd', m ? 'Mudo' : `Volume ${Math.round(this.audio.volume * 100)}%`);
    }

    /* ---------- repetição A→B ---------- */
    cycleAB() {
      if (!this.item) return;
      const t = this.currentTime;
      if (this.ab.a === null) { this.ab = { a: t, b: null }; this.emit('osd', 'Repetição A→B: ponto A ' + U.fmtTime(t)); }
      else if (this.ab.b === null) {
        if (t <= this.ab.a) { this.ab = { a: t, b: null }; this.emit('osd', 'Ponto A redefinido ' + U.fmtTime(t)); }
        else { this.ab.b = t; this.emit('osd', `Repetição A→B: ${U.fmtTime(this.ab.a)} → ${U.fmtTime(t)}`); this.seek(this.ab.a); }
      } else { this.ab = { a: null, b: null }; this.emit('osd', 'Repetição A→B desativada'); }
      this.emit('ab', this.ab);
    }
    setAB(a, b) { this.ab = { a, b }; this.emit('ab', this.ab); }

    /* ---------- loop / aleatório ---------- */
    cycleLoop() {
      const order = ['none', 'all', 'one'];
      this.playlist.loop = order[(order.indexOf(this.playlist.loop) + 1) % 3];
      this.emit('modes');
      this.emit('osd', { none: 'Repetição: desligada', all: 'Repetir tudo', one: 'Repetir um' }[this.playlist.loop]);
    }
    setLoop(m) { this.playlist.loop = m; this.emit('modes'); }
    toggleShuffle() {
      this.playlist.shuffle = !this.playlist.shuffle;
      this.playlist.played.clear();
      this.emit('modes');
      this.emit('osd', this.playlist.shuffle ? 'Aleatório: ligado' : 'Aleatório: desligado');
    }

    /* ---------- vídeo ---------- */
    setVideoEnabled(on) {
      this.videoEnabled = on;
      this.renderer.show(on && this.renderer.hasVideo);
      this.updateAudioView();
      this.emit('tracks');
    }
    applyDeinterlace() {
      const on = this.settings.get('deinterlace') === 'on';
      this.renderer.set('deinterlace', on ? this.settings.get('deinterlaceMode') : 'off');
    }
    updateAudioView() { this.emit('audio-view'); }

    /* ---------- faixas ---------- */
    /** Faixas de áudio do contêiner (FFmpeg, se já analisado; senão o leitor de metadados — também para URLs). */
    containerAudioTracks() {
      const it = this.item;
      if (!it) return [];
      if (it.probe) return it.probe.streams.filter(s => s.type === 'audio').map(s => ({ codec: s.codec, lang: s.lang, name: s.title, channels: s.layout, default: s.default, sampleRate: s.sampleRate }));
      return ((it.info && it.info.tracks) || []).filter(t => t.type === 'audio');
    }
    fileAudioTracks() { return this.containerAudioTracks(); }

    /** Faixa do contêiner que está tocando agora. */
    currentAudioIndex() {
      const it = this.item;
      if (!it) return 0;
      if (this.slaveKind === 'track' && it.audioIndex != null) return it.audioIndex;
      return baseAudioIndex(it, this.containerAudioTracks());
    }

    /** Blob da faixa extraída escolhida (quando ela não é a faixa que o próprio elemento toca). */
    selectedTrackBlob(item) {
      if (!item || item.audioIndex == null || !item.audioCache) return null;
      if (item.audioIndex === baseAudioIndex(item, this.containerAudioTracks())) return null;
      return item.audioCache[item.audioIndex] || null;
    }

    getAudioTracks() {
      const out = [];
      const it = this.item;
      if (!it) return out;
      const meta = this.containerAudioTracks();
      if (this.hls) this.hls.audioTracks.forEach((t, i) => out.push({ id: 'hls:' + i, label: trackLabel({ name: t.name, lang: t.lang, channels: t.attrs && t.attrs.CHANNELS }, i), lang: t.lang, active: this.hls.audioTrack === i }));
      else if (this.dash) {
        const cur = this.dash.getCurrentTrackFor && this.dash.getCurrentTrackFor('audio');
        (this.dash.getTracksFor('audio') || []).forEach((t, i) => out.push({ id: 'dash:' + i, label: trackLabel({ name: t.labels && t.labels[0] && t.labels[0].text, lang: t.lang }, i), lang: t.lang, active: cur === t, track: t }));
      } else if (this.media.audioTracks && this.media.audioTracks.length > 1 && this.slaveKind !== 'track') {
        // troca nativa (Safari; Chrome/Edge com "Experimental Web Platform features")
        const nat = this.media.audioTracks;
        for (let i = 0; i < nat.length; i++) {
          const t = nat[i], m = meta.length === nat.length ? meta[i] : {};
          out.push({ id: 'native:' + i, label: trackLabel(Object.assign({}, m, { name: t.label || m.name, lang: t.language || m.lang }), i), lang: t.language || m.lang, active: t.enabled });
        }
      } else if (meta.length) {
        const cur = this.currentAudioIndex();
        meta.forEach((t, i) => out.push({ id: 'ff:' + i, label: trackLabel(t, i) + (trackUnsupported(t) && !(it.audioCache && it.audioCache[i]) ? ' (requer conversão)' : ''), lang: t.lang, active: cur === i && this.slaveKind !== 'extra' }));
      }
      if (it.extraAudio) out.push({ id: 'extra', label: 'Áudio externo: ' + (it.extraAudio.name || 'arquivo'), active: this.slaveKind === 'extra' });
      return out;
    }

    selectAudioTrack(id) {
      if (this.audioTrackOff) this.setAudioTrackOff(false);
      const [kind, n] = String(id).split(':');
      const i = +n;
      const it = this.item;
      if (!it) return;
      if (kind === 'hls' && this.hls) this.hls.audioTrack = i;
      else if (kind === 'dash' && this.dash) { const t = this.dash.getTracksFor('audio')[i]; if (t) this.dash.setCurrentTrack(t); }
      else if (kind === 'native') { for (let k = 0; k < this.media.audioTracks.length; k++) this.media.audioTracks[k].enabled = k === i; }
      else if (kind === 'ff') {
        const list = this.containerAudioTracks();
        const base = baseAudioIndex(it, list);
        if (this.slaveKind === 'extra') this.stopSlave();
        if (i === this.currentAudioIndex() && (this.slaveKind === 'track' || i === base)) { this.emit('tracks'); return; }
        if (i === base && (it.playable || !trackUnsupported(list[i]))) {
          // volta à faixa que o próprio elemento de vídeo toca: instantâneo
          if (this.slaveKind === 'track') this.stopSlave();
          it.audioIndex = it.playable ? it.playableAudio : null;
          this.applySourceGain();
          this.emit('osd', 'Faixa de áudio: ' + trackLabel(list[i], i));
        } else if (it.audioCache && it.audioCache[i]) {
          it.audioIndex = i;
          this.startSlave(it.audioCache[i], 'track');
          this.emit('osd', 'Faixa de áudio: ' + trackLabel(list[i], i));
        } else this.switchToTrack(it, i);
      } else if (kind === 'extra') {
        if (this.slaveKind === 'extra') {
          this.stopSlave();
          const b = this.selectedTrackBlob(it);
          if (b) this.startSlave(b, 'track');
        } else this.startSlave(it.extraAudio, 'extra');
      }
      setTimeout(() => this.emit('tracks'), 50);
    }

    /** Troca para uma faixa que o navegador não oferece: extrai-a com o FFmpeg (baixando o arquivo, se for um link). */
    async switchToTrack(item, i) {
      const list = this.containerAudioTracks();
      if (!item.file) {
        if (!item.url) return;
        const ok = await this.ensureLocal(item, { reason: 'track', trackLabel: trackLabel(list[i] || {}, i) });
        if (!ok || this.item !== item) return;
      }
      await this.useAudioTrack(item, i);
    }

    /** Extrai (ou reutiliza) a faixa de áudio i e a toca em sincronia com o vídeo. */
    async useAudioTrack(item, i) {
      item.audioCache = item.audioCache || {};
      let blob = item.audioCache[i];
      if (!blob) {
        if (this.ffmpeg.busy) { this.emit('osd', 'O FFmpeg está ocupado com outra tarefa'); return false; }
        this.emit('ffmpeg-progress', { p: -1, label: 'Carregando o motor FFmpeg…' });
        try {
          await this.ffmpeg.load(p => this.emit('ffmpeg-progress', { p, label: 'Baixando o motor FFmpeg (~31 MB, apenas na primeira vez)…' }));
          if (!item.probe) {
            this.emit('ffmpeg-progress', { p: -1, label: 'Analisando as faixas…' });
            item.probe = await this.ffmpeg.probe(item.file);
          }
          const res = await this.ffmpeg.extractAudio(item.file, { audioIndex: i, probe: item.probe, onProgress: (p, label) => this.emit('ffmpeg-progress', { p, label }) });
          blob = item.audioCache[i] = res.blob;
          this.emit('ffmpeg-progress', null);
        } catch (e) {
          this.emit('ffmpeg-progress', null);
          if (/terminate|cancel/i.test(e.message || String(e))) { this.emit('osd', 'Operação cancelada'); return false; }
          this.emit('error', 'Não foi possível preparar a faixa de áudio: ' + (e.message || e));
          return false;
        }
      }
      if (this.item !== item) return false;
      item.audioIndex = i;
      this.suggested = true;   // o problema de áudio (se havia) foi resolvido
      this.startSlave(blob, 'track');
      const list = this.containerAudioTracks();
      this.emit('osd', 'Faixa de áudio: ' + trackLabel(list[i] || {}, i));
      this.emit('tracks');
      return true;
    }

    /**
     * Garante uma cópia local de um item de rede (necessária para o FFmpeg).
     * opts: { confirmed, reason: 'track'|'convert', trackLabel }
     */
    async ensureLocal(item, opts = {}) {
      if (item.file) return true;
      if (this._dl) { this.emit('osd', 'Já existe um download em andamento'); return false; }
      if (!item.remote) await this.inspectRemote(item);
      const r = item.remote || {};
      if (!r.cors || r.status >= 400) { this.emit('remote-help', item, opts); return false; }
      if (!opts.confirmed) {
        const ok = await new Promise(res => this.emit('download-ask', item, opts, res));
        if (!ok) return false;
      }
      const ctrl = new AbortController();
      this._dl = ctrl;
      const t0 = performance.now();
      const label = (l, t) => {
        const secs = (performance.now() - t0) / 1000;
        const speed = secs > 1 ? ' — ' + U.fmtBytes(l / secs) + '/s' : '';
        return `Baixando "${item.title}": ${U.fmtBytes(l)}${t > 0 ? ' de ' + U.fmtBytes(t) : ''}${speed}`;
      };
      this.emit('ffmpeg-progress', { p: -1, label: 'Iniciando o download…' });
      try {
        const file = await VW.remote.download(item.url, {
          name: item.remoteName || U.urlFileName(item.url), size: r.size, signal: ctrl.signal,
          onProgress: (l, t) => this.emit('ffmpeg-progress', { p: t > 0 ? l / t : -1, label: label(l, t) })
        });
        item.file = file;
        item.downloaded = true;
        this.emit('ffmpeg-progress', null);
        this.log.info('input', `Download concluído: ${file.name} (${U.fmtBytes(file.size)})`);
        this.emit('osd', 'Download concluído');
        this.emit('meta', item);
        return true;
      } catch (e) {
        this.emit('ffmpeg-progress', null);
        if (e.name === 'AbortError') { this.emit('osd', 'Download cancelado'); return false; }
        const quota = e.name === 'QuotaExceededError' ? ' (sem espaço no armazenamento do navegador)' : '';
        this.emit('error', 'Falha ao baixar o arquivo: ' + (e.message || e) + quota);
        return false;
      } finally { this._dl = null; }
    }

    /** Cancela download e conversão em andamento. */
    cancelTasks() {
      if (this._dl) this._dl.abort();
      this.ffmpeg.cancel();
      this.emit('ffmpeg-progress', null);
    }

    /**
     * Verifica um item de rede: CORS, Range, tamanho, nome real e — quando o servidor permite —
     * lê os metadados (faixas de áudio com idioma/codec, legendas, capítulos) por pedidos parciais.
     */
    inspectRemote(item) {
      if (!item || !item.url || item.stream) return Promise.resolve();
      if (item._remoteP) return item._remoteP;
      const url = item.url;
      if (!/^https?:/i.test(url) || isHls(url) || isDash(url) || /\.(m3u8|mpd)$/i.test(U.urlFileName(url))) return Promise.resolve();
      item._remoteP = (async () => {
        const r = await VW.remote.probe(url);
        item.remote = { cors: r.cors, range: r.range, size: r.size, type: r.type, status: r.status, error: r.error };
        // nome real do arquivo (Content-Disposition) — só quando a própria URL não traz um nome com extensão
        // (o "filename=" da URL costuma ter os acentos corretos; o cabeçalho às vezes vem só em ASCII)
        if (r.name && !U.ext(U.urlFileName(url)) && r.name !== item.remoteName) {
          item.remoteName = r.name;
          if (item.autoTitle) { item.title = U.stripExt(r.name) || item.title; this.emit('meta', item); }
        }
        this.log.info('input', `Servidor: ${r.cors ? 'permite leitura pela página (CORS)' : 'não permite leitura pela página (sem CORS) — modo de compatibilidade'}` +
          (r.cors ? `, ${r.range ? 'aceita pedidos parciais (Range)' : 'sem pedidos parciais'}` : '') + (isFinite(r.size) ? ', ' + U.fmtBytes(r.size) : '') + (r.status >= 400 ? ', HTTP ' + r.status : ''));
        if (r.cors && r.status < 400 && !item.info && !item.file) {
          try {
            const rf = new VW.remote.RemoteFile(url, Object.assign({}, r, { name: item.remoteName || U.urlFileName(url) }));
            const info = await VW.metadata.read(rf);
            if (rf.sizeKnown) item.remote.size = rf.size;
            if (info.container || info.tracks.length) this.applyInfo(item, info);
          } catch (e) { this.log.debug('input', 'Metadados remotos indisponíveis: ' + e.message); }
        }
        if (item === this.item) this.emit('tracks');
      })().catch(e => { this.log.debug('input', 'Verificação do servidor falhou: ' + e.message); });
      return item._remoteP;
    }

    cycleAudioTrack() {
      const t = this.getAudioTracks();
      if (t.length < 2) { this.emit('osd', 'Faixa de áudio: ' + (t[0] ? t[0].label : 'padrão')); return; }
      const i = t.findIndex(x => x.active);
      const nx = t[(i + 1) % t.length];
      this.selectAudioTrack(nx.id);
      this.emit('osd', 'Faixa de áudio: ' + nx.label);
    }

    getQualities() {
      if (this.hls && this.hls.levels.length > 1) {
        return [{ id: -1, label: 'Automática', active: this.hls.autoLevelEnabled }].concat(this.hls.levels.map((l, i) => ({
          id: i, label: `${l.height ? l.height + 'p' : ''} ${U.fmtBitrate(l.bitrate)}`.trim() + (this._capIndex != null && i > this._capIndex ? ' (acima do limite de resolução)' : ''), active: !this.hls.autoLevelEnabled && this.hls.currentLevel === i
        })));
      }
      if (this.dash) {
        const list = this.dash.getBitrateInfoListFor ? this.dash.getBitrateInfoListFor('video') : [];
        if (list.length > 1) {
          const auto = this.dash.getSettings().streaming.abr.autoSwitchBitrate.video;
          const cur = this.dash.getQualityFor('video');
          return [{ id: -1, label: 'Automática', active: auto }].concat(list.map((l, i) => ({ id: i, label: `${l.height}p ${U.fmtBitrate(l.bitrate)}` + (this._capIndex != null && i > this._capIndex ? ' (acima do limite de resolução)' : ''), active: !auto && cur === i })));
        }
      }
      return [];
    }
    setQuality(id) {
      if (this.hls) { this.hls.currentLevel = id; }
      else if (this.dash) {
        this.dash.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: id < 0 } } } });
        if (id >= 0) this.dash.setQualityFor('video', id, true);
      }
      setTimeout(() => this.emit('tracks'), 100);
    }

    selectSubtitle(id) {
      this.subs.setActive(id);
      const t = this.subs.active;
      if (this.hls && t && t.source === 'embedded') {
        const i = this.hls.subtitleTracks.findIndex(s => s.name === t.textTrack.label || s.lang === t.textTrack.language);
        if (i >= 0) this.hls.subtitleTrack = i;
      }
      this.emit('osd', 'Legenda: ' + (t ? t.label : 'desativada'));
    }

    /* ---------- áudio externo sincronizado ("Reproduzir outra mídia em sincronia") ---------- */
    startSlave(src, kind = 'extra') {
      this.stopSlave();
      // um elemento reaproveitado por rota: ligado ao motor de efeitos (equalizador etc.) ou saída direta
      // (um elemento ligado ao Web Audio não pode ser desligado, então não se cria um novo a cada troca)
      const direct = !!this.directAudio;
      let a = direct ? this._slaveDirect : this._slaveEngine;
      if (!a) {
        a = new Audio();
        a.preload = 'auto';
        if (direct) this._slaveDirect = a; else { this._slaveEngine = a; this.audio.attach(a); }
      }
      a.src = src instanceof Blob ? (this._slaveURL = URL.createObjectURL(src)) : src;
      this.slave = a;
      this.slaveKind = kind;
      if (direct) a.volume = Math.min(1, this.audio.volume);
      this.applySourceGain();
      a.playbackRate = this.rate;
      a.preservesPitch = this.media.preservesPitch !== false;
      const sync = () => { try { a.currentTime = this.currentTime; } catch (e) { /* ok */ } if (!this.media.paused) a.play().catch(() => {}); };
      a.addEventListener('loadedmetadata', sync, { once: true });
      sync();
      if (kind === 'extra') this.emit('osd', 'Áudio externo ativado');
      this.emit('tracks');
    }
    stopSlave() {
      if (!this.slave) return;
      this.slave.pause();
      this.slave.removeAttribute('src');
      try { this.slave.load(); } catch (e) { /* ok */ }
      this.slave = null;
      this.slaveKind = null;
      if (this._slaveURL) { URL.revokeObjectURL(this._slaveURL); this._slaveURL = null; }
      this.applySourceGain();
      this.emit('tracks');
    }

    /* ---------- capítulos ---------- */
    applyChapters(item) {
      if (!item || item !== this.item) return;
      let ch = (item.info && item.info.chapters) || [];
      if (!ch.length && this.item && !this.isImage) {
        const tt = Array.from(this.media.textTracks || []).find(t => t.kind === 'chapters' && t.cues && t.cues.length);
        if (tt) ch = Array.from(tt.cues).map(c => ({ start: c.startTime, end: c.endTime, title: c.text }));
      }
      const d = this.duration;
      this.chapters = ch.map((c, i) => ({ start: c.start, end: c.end || (ch[i + 1] ? ch[i + 1].start : d), title: c.title || 'Capítulo ' + (i + 1) }));
      this.emit('chapters', this.chapters);
    }
    currentChapter() {
      const t = this.currentTime;
      let idx = -1;
      this.chapters.forEach((c, i) => { if (t >= c.start - 0.25) idx = i; });
      return idx;
    }
    gotoChapter(i) {
      const c = this.chapters[i];
      if (!c) return;
      this.seek(c.start);
      this.emit('osd', c.title);
    }
    nextChapter() { const i = this.currentChapter(); if (i + 1 < this.chapters.length) this.gotoChapter(i + 1); else this.emit('osd', 'Último capítulo'); }
    prevChapter() {
      const i = this.currentChapter();
      if (i >= 0 && this.currentTime - this.chapters[i].start > 3) this.gotoChapter(i);
      else if (i > 0) this.gotoChapter(i - 1);
    }

    /* ---------- marcadores ---------- */
    get bookmarks() { return this.item ? (this.bookmarksData[this.item.key] || []) : []; }
    saveBookmarks(list) {
      if (!this.item) return;
      if (list.length) this.bookmarksData[this.item.key] = list; else delete this.bookmarksData[this.item.key];
      U.store.set('bookmarks', this.bookmarksData);
      this.emit('bookmarks');
    }
    addBookmark(name) {
      const list = this.bookmarks.slice();
      list.push({ name: name || 'Marcador ' + (list.length + 1), time: this.currentTime });
      list.sort((a, b) => a.time - b.time);
      this.saveBookmarks(list);
      this.emit('osd', 'Marcador criado em ' + U.fmtTime(this.currentTime));
    }

    /* ---------- sincronização de legendas (Shift+H / Shift+J / Shift+K) ---------- */
    syncMark(kind) {
      this.syncMarks[kind] = this.currentTime;
      this.emit('osd', kind === 'audio' ? 'Marcação de áudio/vídeo registrada' : 'Marcação de legenda registrada');
    }
    syncApply() {
      const { audio, sub } = this.syncMarks;
      if (audio === null || sub === null) { this.emit('osd', 'Marque primeiro o áudio (Shift+H) e a legenda (Shift+J)'); return; }
      this.subs.setDelay(this.subs.delay + (audio - sub));
      this.syncMarks = { audio: null, sub: null };
      this.emit('osd', `Atraso da legenda: ${Math.round(this.subs.delay * 1000)} ms`);
    }
    syncReset() { this.subs.setDelay(0); this.syncMarks = { audio: null, sub: null }; this.emit('osd', 'Sincronização da legenda redefinida'); }

    /* ---------- retomada e recentes ---------- */
    saveResume() {
      const it = this.item;
      if (!it || it.stream || this.isImage || !this.media) return;
      const pos = this.media.currentTime, dur = this.media.duration;
      if (!isFinite(dur) || dur < 60) return;
      if (pos > 10 && pos < dur - 10) this.resumeData[it.key] = { pos, dur, at: Date.now() };
      else delete this.resumeData[it.key];
      const keys = Object.keys(this.resumeData);
      if (keys.length > 300) keys.sort((a, b) => this.resumeData[a].at - this.resumeData[b].at).slice(0, keys.length - 300).forEach(k => delete this.resumeData[k]);
      U.store.set('resume', this.resumeData);
    }

    addRecent(item) {
      if (!this.settings.get('saveRecent') || item.stream) return;
      const rec = { key: item.key, title: item.title, url: item.url || '', name: item.file ? item.file.name : '', at: Date.now(), kind: item.kind };
      this.recent = [rec].concat(this.recent.filter(r => r.key !== rec.key)).slice(0, this.settings.get('maxRecent'));
      U.store.set('recent', this.recent);
      if (item.handle && this.library) this.library.saveHandle(item.key, item.handle);
      this.emit('recent');
    }
    clearRecent() { this.recent = []; U.store.set('recent', []); this.emit('recent'); }

    /* ---------- metadados ---------- */
    async readMeta(item) {
      if (!item.file || item.info || item._metaPending) return;
      item._metaPending = true;
      try {
        this.applyInfo(item, await VW.metadata.read(item.file));
      } finally { item._metaPending = false; }
    }

    applyInfo(item, info) {
      item.info = info;
      for (const k in info.tags) if (info.tags[k] && !item.meta[k]) item.meta[k] = info.tags[k];
      if (!isFinite(item.duration) && isFinite(info.duration)) item.duration = info.duration;
      if (info.cover && !item.coverURL) item.coverURL = URL.createObjectURL(info.cover);
      const rec = this.recent.find(r => r.key === item.key);
      if (rec && rec.title !== item.displayTitle) { rec.title = item.displayTitle; U.store.set('recent', this.recent); this.emit('recent'); }
      this.emit('meta', item);
      if (item === this.item) {
        this.applyChapters(item); this.updateMediaSession(); this.emit('tracks');
        this.checkAudioCodec(item);
      }
    }

    /** Lê duração/tags dos itens da lista em segundo plano. */
    scheduleProbe() {
      clearTimeout(this._probeT);
      this._probeT = setTimeout(() => this.probeQueue(), 400);
    }
    async probeQueue() {
      if (this._probing) return;
      this._probing = true;
      try {
        const el = this._probeEl || (this._probeEl = Object.assign(document.createElement('video'), { preload: 'metadata', muted: true }));
        for (const it of this.playlist.items.slice()) {
          if (!it.file) continue;
          if (!it.info) await this.readMeta(it);
          if (isFinite(it.duration) || it._probed || it.kind === 'image') continue;
          it._probed = true;
          const url = URL.createObjectURL(it.file);
          await new Promise(res => {
            const done = () => { el.onloadedmetadata = el.onerror = null; clearTimeout(t); res(); };
            const t = setTimeout(done, 4000);
            el.onloadedmetadata = () => { if (isFinite(el.duration)) it.duration = el.duration; done(); };
            el.onerror = done;
            el.src = url;
          });
          el.removeAttribute('src'); el.load();
          URL.revokeObjectURL(url);
          this.emit('meta', it);
        }
      } finally { this._probing = false; }
    }

    marqueeVars() {
      const it = this.item || {};
      return {
        t: it.meta && it.meta.title || it.title || '', a: it.meta && it.meta.artist || '', b: it.meta && it.meta.album || '',
        T: U.fmtTime(this.currentTime), D: U.fmtTime(this.duration), L: U.fmtTime(this.duration - this.currentTime),
        P: isFinite(this.duration) ? Math.round(this.currentTime / this.duration * 100) + '%' : '', V: Math.round(this.audio.volume * 100) + '%',
        N: this.playlist.index + 1, R: this.rate.toFixed(2) + 'x', u: it.uri || '', F: it.uri || ''
      };
    }

    /* ---------- integração com o sistema (teclas de mídia / central de controle) ---------- */
    setupMediaSession() {
      if (!U.supports.mediaSession) return;
      const ms = navigator.mediaSession;
      const h = (a, fn) => { try { ms.setActionHandler(a, fn); } catch (e) { /* não suportado */ } };
      h('play', () => this.play());
      h('pause', () => this.pause());
      h('stop', () => this.stop());
      h('previoustrack', () => this.prev());
      h('nexttrack', () => this.next());
      h('seekbackward', d => this.seekRel(-(d.seekOffset || this.settings.get('jumpShort'))));
      h('seekforward', d => this.seekRel(d.seekOffset || this.settings.get('jumpShort')));
      h('seekto', d => this.seek(d.seekTime));
    }
    updateMediaSession() {
      if (!U.supports.mediaSession || !this.item || !window.MediaMetadata) return;
      const it = this.item;
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: it.meta.title || it.title, artist: it.meta.artist || '', album: it.meta.album || '',
          artwork: it.coverURL ? [{ src: it.coverURL, sizes: '512x512' }] : []
        });
      } catch (e) { /* ignora */ }
    }

    /* ---------- laço de atualização (legendas suaves, A→B, sincronia do áudio externo) ---------- */
    _tick() {
      requestAnimationFrame(this._tick);
      if (!this.item) return;
      const t = this.media.currentTime || 0;
      this.subs.update(t);
      if (this.ab.a !== null && this.ab.b !== null && t >= this.ab.b) this.seek(this.ab.a);
      if (this.slave && !this.media.paused) this.syncSlave(t);
      if (!this.media.paused) this.emit('frame', t);
    }

    /** Mantém o áudio sincronizado colado ao vídeo: salto se a diferença for grande, ajuste fino de velocidade se pequena. */
    syncSlave(t) {
      const s = this.slave, m = this.media;
      if (s.readyState < 2) return;
      const now = performance.now();
      if (now - (this._syncT || 0) < 200) return;
      this._syncT = now;
      if (s.paused && this.state === 'playing' && m.readyState >= 3) { s.play().catch(() => {}); return; }
      const d = s.currentTime - t, base = m.playbackRate || 1;
      if (Math.abs(d) > 0.3) { s.currentTime = t; s.playbackRate = base; }
      else if (Math.abs(d) > 0.04) s.playbackRate = base * (d > 0 ? 0.97 : 1.03);
      else if (s.playbackRate !== base) s.playbackRate = base;
    }

    /* ---------- desempenho: limite de resolução e detecção de travamentos ---------- */
    /** Altura máxima desejada para fluxos adaptativos (HLS/DASH); null = sem limite. */
    streamCapHeight() {
      const v = this.settings.get('maxResolution');
      if (+v > 0) return +v;
      if (v !== 'auto') return null;
      const r = this.renderer.cssRect || this.renderer.displayRect;
      if (!r || !r.h) return null;
      return Math.max(360, Math.round(r.h * Math.min(window.devicePixelRatio || 1, 2)));
    }
    applyStreamCapSoon() { clearTimeout(this._capT); this._capT = setTimeout(() => this.applyStreamCap(), 400); }

    /** Limita a qualidade de HLS/DASH: menos dados baixados e menos trabalho para decodificar. */
    applyStreamCap() {
      const cap = this.streamCapHeight(), auto = this.settings.get('maxResolution') === 'auto';
      // escolhe a última qualidade com altura <= limite (no modo automático, a menor que cobre a tela)
      const pick = heights => {
        if (cap == null || !heights.length) return null;
        let idx = -1;
        if (auto) { idx = heights.findIndex(h => h >= cap); if (idx < 0) return null; }
        else heights.forEach((h, i) => { if (h && h <= cap) idx = i; });
        return Math.max(0, idx);
      };
      if (this.hls && this.hls.levels && this.hls.levels.length) {
        const order = this.hls.levels.map((l, i) => ({ h: l.height || 0, i })).sort((a, b) => a.h - b.h);
        const k = pick(order.map(o => o.h));
        const idx = k == null ? -1 : order[k].i;
        // o hls.js limita pelo índice: garante que níveis acima do escolhido tenham índice maior
        this.hls.autoLevelCapping = idx;
        this._capIndex = idx < 0 ? null : idx;
        if (idx >= 0 && !this.hls.autoLevelEnabled && this.hls.currentLevel > idx) this.hls.currentLevel = idx;
        if (idx >= 0) this.log.info('hls', `Limite de resolução: até ${this.hls.levels[idx].height}p`);
      } else if (this.dash && this.dash.getBitrateInfoListFor) {
        const list = this.dash.getBitrateInfoListFor('video') || [];
        const k = pick(list.map(l => l.height || 0));
        this._capIndex = k;
        const kbps = k == null ? -1 : Math.ceil(list[k].bitrate / 1000) + 1;
        try { this.dash.updateSettings({ streaming: { abr: { maxBitrate: { video: kbps } } } }); } catch (e) { /* versão antiga */ }
        if (k != null && this.dash.getQualityFor && this.dash.getQualityFor('video') > k) { try { this.dash.setQualityFor('video', k, true); } catch (e) { /* ok */ } }
      } else this._capIndex = null;
    }

    /** Detecta travamentos (quadros descartados ou página lenta) e sugere reduzir a resolução. */
    checkPerformance() {
      const m = this.media, it = this.item;
      if (!it || this.isImage || !this.hasVideo || m.paused || (this.state !== 'playing' && this.state !== 'buffering') || document.hidden) { this._perf = null; return; }
      const q = m.getVideoPlaybackQuality ? m.getVideoPlaybackQuality() : null;
      const cur = { dropped: q ? q.droppedVideoFrames : 0, total: q ? q.totalVideoFrames : 0, t: m.currentTime };
      const prev = this._perf;
      this._perf = cur;
      if (!prev || cur.t <= prev.t) return;
      const dTotal = cur.total - prev.total, dDrop = cur.dropped - prev.dropped;
      const dropRatio = dTotal > 12 ? dDrop / dTotal : 0;
      const slowPage = !this.renderer.cssMode && this.renderer.loopFps < 22;
      const bad = dropRatio > 0.15 || slowPage;
      this.perfStats = { dropRatio, loopFps: this.renderer.loopFps, slowPage, total: cur.total, dropped: cur.dropped };
      this._lagCount = bad ? (this._lagCount || 0) + 1 : Math.max(0, (this._lagCount || 0) - 1);
      if (this._lagCount >= 3 && !this._lagWarned && this.settings.get('lagHint')) {
        this._lagWarned = true;
        const r = this.renderer;
        this.log.warn('video', `Reprodução travando: ${Math.round(dropRatio * 100)}% de quadros descartados, página a ${Math.round(r.loopFps)} qps (${r.srcW}×${r.srcH})`);
        this.emit('perf-lag', { srcW: r.srcW, srcH: r.srcH, outW: r.outW, outH: r.outH, dropRatio, slowPage, effects: !r.cssMode, stream: !!(this.hls || this.dash), local: !!it.file });
      }
    }

    /** Próximo degrau de resolução abaixo do vídeo atual (para a sugestão automática). */
    suggestedResolution() {
      const R = this.renderer;
      // parte da resolução realmente processada (com efeitos) ou exibida/decodificada (sem efeitos)
      const h = (R.cssMode ? Math.min(R.srcW, R.srcH) : Math.min(R.outW, R.outH)) || 0;
      const step = [1080, 720, 480, 360].find(x => x <= h * 0.9);
      return String(step || 360);
    }

    /** Fluxo de saída (vídeo processado + áudio) para gravação/transmissão. */
    getOutputStream(fps = 30) {
      const tracks = [];
      if (this.hasVideo) {
        try { tracks.push(...this.renderer.captureStream(fps).getVideoTracks()); } catch (e) { this.log.warn('record', e.message); }
      }
      if (!this.restricted && this.audio.isAttached(this.media)) {
        const a = this.audio.getRecordStream();
        if (a) tracks.push(...a.getAudioTracks());
      } else if (this.media.captureStream) {
        try { tracks.push(...this.media.captureStream().getAudioTracks()); } catch (e) { /* bloqueado */ }
      }
      return new MediaStream(tracks);
    }
  }

  /** Retorna o nome do codec de áudio padrão do arquivo se o navegador não puder decodificá-lo. */
  function unsupportedAudioCodec(item) {
    const tracks = ((item.info && item.info.tracks) || []).filter(t => t.type === 'audio');
    if (!tracks.length) return null;
    return trackUnsupported(tracks.find(x => x.default) || tracks[0]);
  }

  /** Índice da faixa marcada como padrão (a que o navegador toca). */
  function defaultAudioIndex(list) { return Math.max(0, (list || []).findIndex(t => t.default)); }
  /** Faixa que o próprio elemento de vídeo toca (a padrão, ou a escolhida na conversão pelo FFmpeg). */
  function baseAudioIndex(item, list) { return item.playable && item.playableAudio != null ? item.playableAudio : defaultAudioIndex(list); }

  /** Nome do formato se o navegador não decodifica esta faixa; null se decodifica (ou não se sabe). */
  function trackUnsupported(t) {
    if (!t) return null;
    const id = String(t.codecId || t.fourcc || (t.codec && /^[a-z0-9_]+$/.test(t.codec) ? 'ff:' + t.codec : '') || '');
    const ff = { 'ff:ac3': 'A_AC3', 'ff:eac3': 'A_EAC3', 'ff:dts': 'A_DTS', 'ff:truehd': 'A_TRUEHD', 'ff:mp2': 'A_MPEG/L2', 'ff:alac': 'A_ALAC' };
    return codecIdUnsupported(ff[id] || (id.startsWith('ff:pcm') ? 'A_PCM' : id));
  }
  function codecIdUnsupported(id) {
    const can = mime => !!(mime && document.createElement('audio').canPlayType(mime));
    const rules = [
      [/^A_AC3|^ac-3$/i, 'Dolby Digital (AC‑3)', 'audio/mp4; codecs="ac-3"'],
      [/^A_EAC3|^ec-3$/i, 'Dolby Digital Plus (E‑AC‑3)', 'audio/mp4; codecs="ec-3"'],
      [/^A_DTS|^dts[chlxe]$/i, 'DTS', 'audio/mp4; codecs="dtsc"'],
      [/^A_TRUEHD|^mlpa$/i, 'Dolby TrueHD', null],
      [/^A_MPEG\/L[12]$/i, 'MPEG Áudio camada 1/2 (MP2)', null],
      [/^A_PCM|^(lpcm|sowt|twos|in24|in32|fl32|fl64)$/i, 'PCM sem compressão', null],
      [/^A_REAL|^A_MS\/ACM|^A_QUICKTIME|^A_TTA|^A_WAVPACK/i, 'um codec legado', null],
      [/^A_ALAC|^alac$/i, 'Apple Lossless (ALAC)', 'audio/mp4; codecs="alac"']
    ];
    for (const [re, name, mime] of rules) if (re.test(id)) return can(mime) ? null : name;
    return null;
  }

  /** "Faixa 2 — Inglês [eng] — Comentários — E‑AC‑3 5.1" */
  function trackLabel(t, i) {
    t = t || {};
    const parts = [];
    const lang = U.langName(t.lang);
    if (lang) parts.push(lang + (t.lang && lang.toLowerCase() !== String(t.lang).toLowerCase() ? ` [${t.lang}]` : ''));
    const name = String(t.name || '').trim();
    if (name && (!lang || name.toLowerCase() !== lang.toLowerCase()) && !/^(sound|audio|áudio)handler$/i.test(name)) parts.push(name);
    const tech = [U.codecName(t.codec), U.channelsLabel(t.channels)].filter(Boolean).join(' ');
    if (tech) parts.push(tech);
    if (!lang && !name) parts.unshift('idioma não informado');
    return `Faixa ${i + 1} — ` + parts.join(' — ');
  }

  function isHls(url) { return /\.m3u8(\?|#|$)/i.test(url) || /[?&](format|type)=m3u8/i.test(url) || /\/manifest\(format=m3u8/i.test(url); }
  function isDash(url) { return /\.mpd(\?|#|$)/i.test(url); }

  Player.RATES = RATES;
  Player.unsupportedAudioCodec = unsupportedAudioCodec;
  Player.isHls = isHls;
  Player.isDash = isDash;
  VW.Player = Player;
})(window.VW = window.VW || {});
