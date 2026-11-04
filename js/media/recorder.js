/* VLC Web — captura de imagem, gravação, conversão em tempo real e transmissão (WebRTC local / Cast) */
(function (VW) {
  'use strict';
  const U = VW.util;

  const VIDEO_MIMES = {
    webm: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'],
    mp4: ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4;codecs=avc1,opus', 'video/mp4']
  };
  const AUDIO_MIMES = {
    webm: ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'],
    mp4: ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4']
  };

  function pickMime(hasVideo, pref) {
    if (!U.supports.mediaRecorder) return null;
    const set = hasVideo ? VIDEO_MIMES : AUDIO_MIMES;
    const order = pref === 'mp4' ? ['mp4', 'webm'] : pref === 'webm' ? ['webm', 'mp4'] : ['webm', 'mp4'];
    for (const k of order) for (const m of set[k]) if (MediaRecorder.isTypeSupported(m)) return m;
    return '';
  }
  const extOf = mime => mime.includes('mp4') ? (mime.startsWith('audio') ? 'm4a' : 'mp4') : mime.includes('ogg') ? 'ogg' : 'webm';

  class Recorder extends U.Emitter {
    constructor(player, settings, log) {
      super();
      this.player = player;
      this.settings = settings;
      this.log = log;
      this.mr = null;
      this.recording = false;
    }

    safeTitle() {
      const it = this.player.item;
      return (it ? (it.meta.title || it.title) : 'vlc').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
    }

    /* ---------------- Captura de imagem (Vídeo → Capturar imagem) ---------------- */
    async snapshot() {
      const fmt = this.settings.get('snapshotFormat');
      const type = 'image/' + (fmt === 'jpg' ? 'jpeg' : fmt);
      try {
        const blob = await this.player.renderer.snapshot(type, 0.95);
        const ext = fmt === 'jpeg' ? 'jpg' : fmt;
        const name = `${this.settings.get('snapshotPrefix')}${this.safeTitle()}-${U.fmtTime(this.player.currentTime, true).replace(/:/g, '-')}-${U.timestamp()}.${ext}`;
        U.download(blob, name);
        this.log.info('snapshot', 'Imagem salva: ' + name);
        this.emit('snapshot', blob, name);
        return blob;
      } catch (e) {
        this.player.emit('error', 'Não foi possível capturar a imagem: ' + e.message);
      }
    }

    /* ---------------- Gravação (Reprodução → Gravar) ---------------- */
    toggle() { return this.recording ? this.stop() : this.start(); }

    start(opts = {}) {
      if (this.recording) return;
      if (!U.supports.mediaRecorder) { this.player.emit('error', 'Este navegador não suporta gravação (MediaRecorder).'); return; }
      if (!this.player.item) { this.player.emit('error', 'Nada em reprodução para gravar.'); return; }
      const stream = this.player.getOutputStream(opts.fps || 30);
      if (!stream.getTracks().length) { this.player.emit('error', 'Não há faixas disponíveis para gravar (conteúdo de outra origem sem CORS?).'); return; }
      const hasVideo = stream.getVideoTracks().length > 0;
      const mime = opts.mime || pickMime(hasVideo, this.settings.get('recordFormat'));
      let mr;
      try {
        mr = new MediaRecorder(stream, Object.assign({ videoBitsPerSecond: opts.videoBitrate || 8e6, audioBitsPerSecond: opts.audioBitrate || 192000 }, mime ? { mimeType: mime } : {}));
      } catch (e) { this.player.emit('error', 'Falha ao iniciar a gravação: ' + e.message); return; }
      const chunks = [];
      mr.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      this.done = new Promise(resolve => {
        mr.onstop = () => {
          const type = mr.mimeType || mime || (hasVideo ? 'video/webm' : 'audio/webm');
          const blob = new Blob(chunks, { type });
          this.recording = false;
          this.mr = null;
          this.emit('state', false);
          resolve({ blob, ext: extOf(type), type });
        };
      });
      mr.start(1000);
      this.mr = mr;
      this.recording = true;
      this.startedAt = Date.now();
      this.silent = !!opts.silent;
      this.emit('state', true);
      if (!opts.silent) this.player.emit('osd', '● Gravando…');
      this.log.info('record', 'Gravação iniciada (' + (mr.mimeType || mime) + ')');
    }

    async stop() {
      if (!this.recording || !this.mr) return null;
      this.mr.stop();
      const res = await this.done;
      if (!this.silent) {
        const name = `${this.settings.get('recordPrefix')}${this.safeTitle()}-${U.timestamp()}.${res.ext}`;
        U.download(res.blob, name);
        this.player.emit('osd', 'Gravação salva: ' + name);
        this.log.info('record', 'Gravação salva: ' + name + ' (' + U.fmtBytes(res.blob.size) + ')');
      }
      return res;
    }

    get elapsed() { return this.recording ? (Date.now() - this.startedAt) / 1000 : 0; }

    /**
     * Conversão em tempo real usando o próprio reprodutor (aplica efeitos de vídeo e áudio).
     * Retorna { blob, ext }.
     */
    async realtimeConvert(item, opts = {}) {
      const p = this.player;
      const start = opts.start || 0;
      return new Promise((resolve, reject) => {
        let started = false, finished = false;
        const offs = [];
        const cleanup = () => offs.forEach(f => f());
        const finish = async () => {
          if (finished) return;
          finished = true;
          cleanup();
          p.pause();
          const res = await this.stop();
          res ? resolve(res) : reject(new Error('Nada foi gravado'));
        };
        if (opts.signal) opts.signal.addEventListener('abort', () => { finished = true; cleanup(); this.stop(); reject(new DOMException('Cancelado', 'AbortError')); });
        offs.push(p.on('state', s => {
          if (s === 'playing' && !started) {
            started = true;
            this.start({ silent: true, mime: opts.mime, videoBitrate: opts.videoBitrate, audioBitrate: opts.audioBitrate, fps: opts.fps });
            if (!this.recording) { cleanup(); reject(new Error('Falha ao iniciar a gravação')); }
          }
          if ((s === 'stopped' || s === 'ended') && started) finish();
          if (s === 'error') { cleanup(); reject(new Error('Erro de reprodução durante a conversão')); }
        }));
        offs.push(p.on('time', t => {
          const end = opts.end > 0 ? opts.end : p.duration;
          if (started && isFinite(end)) {
            opts.onProgress && opts.onProgress(U.clamp((t - start) / (end - start), 0, 1), t);
            if (opts.end > 0 && t >= opts.end) finish();
          }
        }));
        p.playItem(item, { startTime: start, autoplay: true });
      });
    }
  }

  /* ---------------- Transmissão local via WebRTC (Mídia → Transmitir) ---------------- */
  class LocalStreamServer extends U.Emitter {
    constructor(player, log) {
      super();
      this.player = player;
      this.log = log;
      this.peers = new Map();
      this.channel = null;
      this.ch = null;
    }
    get active() { return !!this.ch; }

    start(name) {
      if (!U.supports.webrtc || !U.supports.broadcast) throw new Error('WebRTC/BroadcastChannel indisponível neste navegador');
      this.stop();
      this.channel = name || Math.random().toString(36).slice(2, 8);
      this.ch = new BroadcastChannel('vlcweb-stream:' + this.channel);
      this.ch.onmessage = e => this.onMsg(e.data).catch(err => this.log.error('stream', err.message));
      this.post({ type: 'server-up' });
      this.log.info('stream', 'Transmissão local iniciada no canal ' + this.channel);
      this.emit('change');
      return this.channel;
    }
    post(m) { if (this.ch) this.ch.postMessage(Object.assign({ from: 'server', title: this.player.item ? this.player.item.title : '' }, m)); }

    async onMsg(m) {
      if (!m || m.from === 'server') return;
      if (m.type === 'join') await this.connect(m.from);
      else if (m.to === 'server' && m.type === 'answer') { const p = this.peers.get(m.from); if (p) await p.pc.setRemoteDescription(m.sdp); }
      else if (m.to === 'server' && m.type === 'ice') { const p = this.peers.get(m.from); if (p && m.candidate) await p.pc.addIceCandidate(m.candidate).catch(() => {}); }
      else if (m.type === 'leave') this.closePeer(m.from);
    }

    async connect(id) {
      this.closePeer(id);
      const pc = new RTCPeerConnection({ iceServers: [] });
      const stream = this.player.getOutputStream(30);
      for (const t of stream.getTracks()) pc.addTrack(t, stream);
      pc.onicecandidate = e => { if (e.candidate) this.post({ type: 'ice', to: id, candidate: e.candidate.toJSON() }); };
      pc.onconnectionstatechange = () => {
        if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) this.closePeer(id);
        this.emit('change');
      };
      this.peers.set(id, { pc, stream });
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.post({ type: 'offer', to: id, sdp: pc.localDescription.toJSON() });
      this.log.info('stream', 'Receptor conectado: ' + id);
      this.emit('change');
    }

    closePeer(id) {
      const p = this.peers.get(id);
      if (!p) return;
      try { p.pc.close(); } catch (e) { /* ok */ }
      this.peers.delete(id);
      this.emit('change');
    }

    stop() {
      if (!this.ch) return;
      this.post({ type: 'server-down' });
      for (const id of [...this.peers.keys()]) this.closePeer(id);
      this.ch.close();
      this.ch = null;
      this.log.info('stream', 'Transmissão encerrada');
      this.emit('change');
    }

    get receiverURL() { return new URL('receiver.html?canal=' + encodeURIComponent(this.channel), location.href).href; }
  }

  /* ---------------- Renderizador remoto (Chromecast/AirPlay) ---------------- */
  async function castPrompt(player) {
    const m = player.media;
    if (!m || !m.remote) throw new Error('Este navegador não suporta transmissão para dispositivos (Remote Playback API).');
    if (player.item && !player.item.url) throw new Error('Apenas mídias de rede (URL) podem ser enviadas a dispositivos remotos; arquivos locais não podem ser transmitidos diretamente.');
    if (player.hls || player.dash) throw new Error('Fluxos HLS/DASH reproduzidos via MSE não podem ser enviados pela Remote Playback API.');
    await m.remote.prompt();
  }

  Recorder.pickMime = pickMime;
  VW.Recorder = Recorder;
  VW.LocalStreamServer = LocalStreamServer;
  VW.castPrompt = castPrompt;
})(window.VW = window.VW || {});
