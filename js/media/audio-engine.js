/* VLC Web — motor de áudio (Web Audio API)
 * Cadeia: fontes → atraso → pré‑amplificação → equalizador 10 bandas → compressor → espacializador
 *        → alargador estéreo → mudança de tom → modo estéreo → normalizador → volume (até 200%) → saída
 * Inclui analisadores para as visualizações e um destino de MediaStream para gravação/transmissão. */
(function (VW) {
  'use strict';
  const U = VW.util;

  const VLC_BANDS = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];
  const ISO_BANDS = [31.25, 62.5, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

  // Predefinições do equalizador do VLC (pré‑amplificação já normalizada para 0 dB = neutro)
  const EQ_PRESETS = {
    flat: { name: 'Plano', preamp: 0, bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    classical: { name: 'Clássica', preamp: 0, bands: [0, 0, 0, 0, 0, 0, -7.2, -7.2, -7.2, -9.6] },
    club: { name: 'Clube', preamp: -6, bands: [0, 0, 8, 5.6, 5.6, 5.6, 3.2, 0, 0, 0] },
    dance: { name: 'Dança', preamp: -7, bands: [9.6, 7.2, 2.4, 0, 0, -5.6, -7.2, -7.2, 0, 0] },
    fullbass: { name: 'Graves máximos', preamp: -7, bands: [-8, 9.6, 9.6, 5.6, 1.6, -4, -8, -10.4, -11.2, -11.2] },
    fullbasstreble: { name: 'Graves e agudos máximos', preamp: -8, bands: [7.2, 5.6, 0, -7.2, -4.8, 1.6, 8, 11.2, 12, 12] },
    fulltreble: { name: 'Agudos máximos', preamp: -9, bands: [-9.6, -9.6, -9.6, -4, 2.4, 11.2, 16, 16, 16, 16.8] },
    headphones: { name: 'Fones de ouvido', preamp: -8, bands: [4.8, 11.2, 5.6, -3.2, -2.4, 1.6, 4.8, 9.6, 12.8, 14.4] },
    largehall: { name: 'Salão amplo', preamp: -7, bands: [10.4, 10.4, 5.6, 5.6, 0, -4.8, -4.8, -4.8, 0, 0] },
    live: { name: 'Ao vivo', preamp: -5, bands: [-4.8, 0, 4, 5.6, 5.6, 5.6, 4, 2.4, 2.4, 2.4] },
    party: { name: 'Festa', preamp: -6, bands: [7.2, 7.2, 0, 0, 0, 0, 0, 0, 7.2, 7.2] },
    pop: { name: 'Pop', preamp: -6, bands: [-1.6, 4.8, 7.2, 8, 5.6, 0, -2.4, -2.4, -1.6, -1.6] },
    reggae: { name: 'Reggae', preamp: -4, bands: [0, 0, 0, -5.6, 0, 6.4, 6.4, 0, 0, 0] },
    rock: { name: 'Rock', preamp: -7, bands: [8, 4.8, -5.6, -8, -3.2, 4, 8.8, 11.2, 11.2, 11.2] },
    ska: { name: 'Ska', preamp: -6, bands: [-2.4, -4.8, -4, 0, 4, 5.6, 8.8, 9.6, 11.2, 9.6] },
    soft: { name: 'Suave', preamp: -7, bands: [4.8, 1.6, 0, -2.4, 0, 4, 8, 9.6, 11.2, 12] },
    softrock: { name: 'Rock suave', preamp: -5, bands: [4, 4, 2.4, 0, -4, -5.6, -3.2, 0, 2.4, 8.8] },
    techno: { name: 'Techno', preamp: -7, bands: [8, 5.6, 0, -5.6, -4.8, 0, 8, 9.6, 9.6, 8.8] }
  };

  const STEREO_MODES = {
    stereo: { name: 'Estéreo', m: [1, 0, 0, 1] },
    reverse: { name: 'Estéreo invertido', m: [0, 1, 1, 0] },
    left: { name: 'Esquerdo', m: [1, 0, 1, 0] },
    right: { name: 'Direito', m: [0, 1, 0, 1] },
    mono: { name: 'Mono', m: [0.5, 0.5, 0.5, 0.5] },
    dolby: { name: 'Dolby Surround (decodificação matricial)', m: [1, -0.3, -0.3, 1] },
    headphones: { name: 'Fones (crossfeed)', m: [0.8, 0.2, 0.2, 0.8] }
  };

  // Processador de mudança de tom (linha de atraso com duas cabeças de leitura cruzadas)
  const PITCH_WORKLET = `
  class PitchShifter extends AudioWorkletProcessor {
    static get parameterDescriptors() { return [{ name: 'ratio', defaultValue: 1, minValue: 0.25, maxValue: 4 }]; }
    constructor() {
      super();
      this.size = 16384; this.win = 2048;
      this.buf = [new Float32Array(this.size), new Float32Array(this.size)];
      this.w = 0; this.phase = 0;
    }
    read(b, pos) {
      const n = this.size; pos = ((pos % n) + n) % n;
      const i = Math.floor(pos), f = pos - i;
      return b[i] * (1 - f) + b[(i + 1) % n] * f;
    }
    process(inputs, outputs, params) {
      const inp = inputs[0], out = outputs[0];
      if (!inp || !inp.length) return true;
      const ratio = params.ratio[0];
      const frames = inp[0].length, chs = Math.min(out.length, 2);
      if (Math.abs(ratio - 1) < 1e-4) {
        for (let c = 0; c < out.length; c++) out[c].set(inp[Math.min(c, inp.length - 1)]);
        return true;
      }
      const win = this.win, step = (1 - ratio) / win;
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < chs; c++) this.buf[c][this.w] = inp[Math.min(c, inp.length - 1)][i];
        this.phase += step; this.phase -= Math.floor(this.phase);
        const p1 = this.phase, p2 = (this.phase + 0.5) % 1;
        const g1 = 0.5 - 0.5 * Math.cos(2 * Math.PI * p1), g2 = 0.5 - 0.5 * Math.cos(2 * Math.PI * p2);
        for (let c = 0; c < chs; c++) {
          const b = this.buf[c];
          out[c][i] = this.read(b, this.w - p1 * win - 1) * g1 + this.read(b, this.w - p2 * win - 1) * g2;
        }
        this.w = (this.w + 1) % this.size;
      }
      for (let c = chs; c < out.length; c++) out[c].set(out[0]);
      return true;
    }
  }
  registerProcessor('vlcweb-pitch', PitchShifter);`;

  class AudioEngine extends U.Emitter {
    constructor(settings, log) {
      super();
      this.settings = settings;
      this.log = log;
      this.ctx = null;
      this.sources = new Map();
      this.volume = U.clamp(settings.get('rememberVolume') ? settings.get('volume') : 1, 0, 2);
      this.muted = false;
      this.state = {
        eq: { enabled: false, preamp: 0, bands: new Array(10).fill(0), preset: 'flat', twoPass: false },
        comp: { enabled: false, rms: 0.2, attack: 25, release: 100, threshold: -11, ratio: 4, knee: 5, makeup: 7 },
        spat: { enabled: false, room: 0.85, width: 1, wet: 0.4, dry: 0.5, damp: 0.5 },
        widen: { enabled: false, delay: 20, feedback: 0.3, crossfeed: 0.3, dryMix: 0.8 },
        pitch: 0,
        stereo: 'stereo',
        delay: 0,
        normalize: settings.get('normalize'),
        normalizeLevel: settings.get('normalizeLevel')
      };
      this.pitchReady = false;
      settings.on('change:normalize', v => { this.state.normalize = v; this.updateNormalize(); });
      settings.on('change:normalizeLevel', v => { this.state.normalizeLevel = v; this.updateNormalize(); });
      settings.on('change:eqIsoBands', () => this.updateEq());
    }

    get available() { return U.supports.webAudio; }

    /** true quando o motor está de fato produzindo som (contexto "running"). */
    get running() { return !!this.ctx && this.ctx.state === 'running'; }

    /** Cria o contexto e o grafo (somente após um gesto do usuário). */
    ensure() {
      if (!this.available) return null;
      if (!this.ctx) this.build();
      if (this.ctx.state !== 'running' && this.ctx.state !== 'closed') this.ctx.resume().catch(() => { /* aguardará próximo gesto */ });
      return this.ctx;
    }

    /** Tenta retomar o contexto; resolve com true se ele passou a tocar. */
    async resume() {
      if (!this.ctx) return false;
      try { await this.ctx.resume(); } catch (e) { /* bloqueado pelo navegador */ }
      return this.running;
    }

    /**
     * Navegadores só liberam o áudio depois de um gesto do usuário (clique, toque ou tecla).
     * Em vez de tentar uma única vez, tenta retomar o contexto a cada gesto enquanto ele estiver parado.
     */
    installUnlock() {
      if (this._unlockInstalled) return;
      this._unlockInstalled = true;
      const tryResume = () => { if (this.ctx && this.ctx.state !== 'running' && this.ctx.state !== 'closed') this.ctx.resume().catch(() => {}); };
      for (const ev of ['pointerup', 'click', 'touchend', 'keydown']) document.addEventListener(ev, tryResume, { capture: true, passive: true });
    }

    /** Toca um tom de teste: pelo motor de efeitos (direct=false) ou por um elemento de áudio comum. */
    async testTone(direct) {
      if (direct) {
        const rate = 44100, n = rate;
        const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
        const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
        w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
        v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
        for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(2 * Math.PI * 440 * i / rate) * 0.3 * 32767 * Math.min(1, (n - i) / 2000, i / 2000), true);
        const a = new Audio(URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })));
        await a.play();
        return true;
      }
      this.ensure();
      if (!(await this.resume())) return false;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.frequency.value = 440; g.gain.value = 0.25;
      g.gain.setTargetAtTime(0, this.ctx.currentTime + 0.8, 0.05);
      o.connect(g); g.connect(this.ctx.destination);
      o.start(); o.stop(this.ctx.currentTime + 1.1);
      return true;
    }

    /** Nível RMS atual da saída (0..1), usado no diagnóstico de som. */
    level() {
      if (!this.analyser || !this.running) return 0;
      const d = this._lvl || (this._lvl = new Float32Array(this.analyser.fftSize));
      this.analyser.getFloatTimeDomainData(d);
      let s = 0;
      for (let i = 0; i < d.length; i++) s += d[i] * d[i];
      return Math.sqrt(s / d.length);
    }

    build() {
      const AC = window.AudioContext || window.webkitAudioContext;
      // iPhone/iPad: sem isto, o Web Audio fica mudo com a chave de silencioso ligada
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* não suportado */ }
      const ctx = this.ctx = new AC({ latencyHint: 'playback' });
      ctx.addEventListener('statechange', () => { this.log.info('audio', 'Estado do motor de áudio: ' + ctx.state); this.emit('ctxstate', ctx.state); });
      this.installUnlock();
      const g = (v = 1) => { const n = ctx.createGain(); n.gain.value = v; return n; };
      this.input = g();
      this.delayNode = ctx.createDelay(10);
      this.preamp = g();
      this.eqNodes = [];
      for (let i = 0; i < 10; i++) {
        const f = ctx.createBiquadFilter();
        f.type = 'peaking'; f.Q.value = 1.2; f.gain.value = 0;
        this.eqNodes.push(f);
      }
      this.eqNodes2 = this.eqNodes.map(() => { const f = ctx.createBiquadFilter(); f.type = 'peaking'; f.Q.value = 1.2; f.gain.value = 0; return f; });
      this.eqOut = g();
      this.compressor = ctx.createDynamicsCompressor();
      this.makeup = g();
      this.compOut = g();
      // espacializador (reverberação por convolução)
      this.spatIn = g(); this.spatDry = g(); this.spatWet = g(0); this.convolver = ctx.createConvolver(); this.spatOut = g();
      // alargador estéreo
      this.widenIn = g(); this.widenOut = g();
      this.wSplit = ctx.createChannelSplitter(2); this.wMerge = ctx.createChannelMerger(2);
      this.wDryL = g(); this.wDryR = g(); this.wDelL = ctx.createDelay(0.2); this.wDelR = ctx.createDelay(0.2);
      this.wFbL = g(); this.wFbR = g(); this.wXL = g(); this.wXR = g();
      // modo estéreo
      this.stIn = g(); this.stSplit = ctx.createChannelSplitter(2); this.stMerge = ctx.createChannelMerger(2);
      this.stLL = g(); this.stLR = g(); this.stRL = g(); this.stRR = g();
      this.pitchIn = g(); this.pitchOut = g();
      this.normalizer = ctx.createDynamicsCompressor();
      this.normGain = g();
      this.normOut = g();
      this.master = g(this.muted ? 0 : this.volume);
      this.splitAn = ctx.createChannelSplitter(2);
      this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 4096; this.analyser.smoothingTimeConstant = 0.75;
      this.analyserL = ctx.createAnalyser(); this.analyserL.fftSize = 2048;
      this.analyserR = ctx.createAnalyser(); this.analyserR.fftSize = 2048;
      this.recordDest = ctx.createMediaStreamDestination ? ctx.createMediaStreamDestination() : null;
      this.anIn = g();
      // força 2 canais (mono → estéreo, 5.1 → estéreo) antes dos divisores de canal
      for (const n of [this.stIn, this.widenIn, this.anIn]) { n.channelCount = 2; n.channelCountMode = 'explicit'; n.channelInterpretation = 'speakers'; }

      // ligações fixas
      this.input.connect(this.delayNode);
      this.delayNode.connect(this.preamp);
      // EQ / compressor / espacializador / alargador são reconfigurados em rewire()
      this.stIn.connect(this.stSplit);
      this.stSplit.connect(this.stLL, 0); this.stSplit.connect(this.stLR, 1);
      this.stSplit.connect(this.stRL, 0); this.stSplit.connect(this.stRR, 1);
      this.stLL.connect(this.stMerge, 0, 0); this.stLR.connect(this.stMerge, 0, 0);
      this.stRL.connect(this.stMerge, 0, 1); this.stRR.connect(this.stMerge, 0, 1);
      this.stMerge.connect(this.pitchIn);
      this.pitchIn.connect(this.pitchOut); // substituído pelo worklet quando disponível
      this.pitchOut.connect(this.normGain);
      this.normGain.connect(this.normOut);
      this.normOut.connect(this.master);
      this.master.connect(ctx.destination);
      this.master.connect(this.analyser);
      this.master.connect(this.anIn);
      this.anIn.connect(this.splitAn);
      this.splitAn.connect(this.analyserL, 0); this.splitAn.connect(this.analyserR, 1);
      if (this.recordDest) this.master.connect(this.recordDest);

      // alargador: L' = dry*L - x*D(R), R' = dry*R - x*D(L), com realimentação
      this.widenIn.connect(this.wSplit);
      this.wSplit.connect(this.wDryL, 0); this.wSplit.connect(this.wDryR, 1);
      this.wSplit.connect(this.wDelR, 1); this.wSplit.connect(this.wDelL, 0);
      this.wDelR.connect(this.wFbR); this.wFbR.connect(this.wDelR);
      this.wDelL.connect(this.wFbL); this.wFbL.connect(this.wDelL);
      this.wDelR.connect(this.wXL); this.wDelL.connect(this.wXR);
      this.wDryL.connect(this.wMerge, 0, 0); this.wXL.connect(this.wMerge, 0, 0);
      this.wDryR.connect(this.wMerge, 0, 1); this.wXR.connect(this.wMerge, 0, 1);
      this.wMerge.connect(this.widenOut);

      // espacializador
      this.spatIn.connect(this.spatDry); this.spatIn.connect(this.convolver);
      this.convolver.connect(this.spatWet);
      this.spatDry.connect(this.spatOut); this.spatWet.connect(this.spatOut);

      for (let i = 0; i < 9; i++) { this.eqNodes[i].connect(this.eqNodes[i + 1]); this.eqNodes2[i].connect(this.eqNodes2[i + 1]); }
      this.compressor.connect(this.makeup); this.makeup.connect(this.compOut);

      this.rewire();
      this.updateEq(); this.updateComp(); this.updateSpat(true); this.updateWiden(); this.updateStereo(); this.updateDelay(); this.updateNormalize();
      this.loadPitch();
      if (this.settings.get('audioDevice') && this.settings.get('audioDevice') !== 'default') this.setSinkId(this.settings.get('audioDevice'));
      this.log.info('audio', `Contexto de áudio criado (${ctx.sampleRate} Hz)`);
      this.emit('ready');
    }

    async loadPitch() {
      if (!U.supports.audioWorklet || !this.ctx.audioWorklet) return;
      try {
        const url = URL.createObjectURL(new Blob([PITCH_WORKLET], { type: 'application/javascript' }));
        await this.ctx.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        this.pitchNode = new AudioWorkletNode(this.ctx, 'vlcweb-pitch', { outputChannelCount: [2] });
        this.pitchIn.disconnect();
        this.pitchIn.connect(this.pitchNode);
        this.pitchNode.connect(this.pitchOut);
        this.pitchReady = true;
        this.updatePitch();
      } catch (e) {
        this.log.warn('audio', 'Mudança de tom indisponível: ' + e.message);
      }
    }

    /** Liga a cadeia preamp → [EQ] → [compressor] → [espacializador] → [alargador] → modo estéreo. */
    rewire() {
      if (!this.ctx) return;
      const s = this.state;
      for (const n of [this.preamp, this.eqNodes[9], this.eqNodes2[9], this.eqOut, this.compOut, this.spatOut, this.widenOut]) { try { n.disconnect(); } catch (e) { /* ok */ } }
      let node = this.preamp;
      if (s.eq.enabled) {
        node.connect(this.eqNodes[0]);
        if (s.eq.twoPass) { this.eqNodes[9].connect(this.eqNodes2[0]); this.eqNodes2[9].connect(this.eqOut); }
        else this.eqNodes[9].connect(this.eqOut);
        node = this.eqOut;
      }
      if (s.comp.enabled) { node.connect(this.compressor); node = this.compOut; }
      if (s.spat.enabled) { node.connect(this.spatIn); node = this.spatOut; }
      if (s.widen.enabled) { node.connect(this.widenIn); node = this.widenOut; }
      node.connect(this.stIn);
    }

    /** Conecta um elemento de mídia ao grafo. */
    attach(el) {
      if (!this.ensure()) return false;
      if (this.sources.has(el)) return true;
      try {
        const src = this.ctx.createMediaElementSource(el);
        const gain = this.ctx.createGain();
        src.connect(gain); gain.connect(this.input);
        this.sources.set(el, { src, gain });
        el.volume = 1;
        return true;
      } catch (e) {
        this.log.error('audio', 'Não foi possível conectar a mídia ao motor de áudio: ' + e.message);
        return false;
      }
    }

    /** Conecta um MediaStream (captura) */
    attachStream(stream) {
      if (!this.ensure()) return null;
      const src = this.ctx.createMediaStreamSource(stream);
      src.connect(this.input);
      return src;
    }

    setSourceGain(el, v) { const s = this.sources.get(el); if (s) s.gain.gain.value = v; }
    isAttached(el) { return this.sources.has(el); }

    /* ---------- volume ---------- */
    setVolume(v) {
      this.volume = U.clamp(v, 0, 2);
      if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.015);
      if (this.settings.get('rememberVolume')) this.settings.set('volume', U.round(this.volume, 3));
      this.emit('volume', this.volume, this.muted);
    }
    setMuted(m) {
      this.muted = !!m;
      if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.015);
      this.emit('volume', this.volume, this.muted);
    }

    /* ---------- equalizador ---------- */
    get bandFreqs() { return this.settings.get('eqIsoBands') ? ISO_BANDS : VLC_BANDS; }
    setEq(patch) { Object.assign(this.state.eq, patch); this.updateEq(); if ('enabled' in patch || 'twoPass' in patch) this.rewire(); this.emit('effects'); }
    setEqBand(i, db) { this.state.eq.bands[i] = db; this.state.eq.preset = 'custom'; this.updateEq(); this.emit('effects'); }
    applyPreset(key) {
      const p = EQ_PRESETS[key];
      if (!p) return;
      this.state.eq.bands = p.bands.slice();
      this.state.eq.preamp = p.preamp;
      this.state.eq.preset = key;
      this.updateEq();
      this.emit('effects');
    }
    updateEq() {
      if (!this.ctx) return;
      const e = this.state.eq, f = this.bandFreqs;
      this.preamp.gain.value = e.enabled ? Math.pow(10, e.preamp / 20) : 1;
      this.eqNodes.forEach((n, i) => {
        n.frequency.value = f[i];
        n.gain.value = e.bands[i];
        if (i === 0) { n.type = 'lowshelf'; } else if (i === 9) { n.type = 'highshelf'; }
      });
      this.eqNodes2.forEach((n, i) => {
        n.frequency.value = f[i];
        n.gain.value = e.bands[i];
        if (i === 0) n.type = 'lowshelf'; else if (i === 9) n.type = 'highshelf';
      });
    }

    /* ---------- compressor ---------- */
    setComp(patch) { Object.assign(this.state.comp, patch); this.updateComp(); if ('enabled' in patch) this.rewire(); this.emit('effects'); }
    updateComp() {
      if (!this.ctx) return;
      const c = this.state.comp;
      this.compressor.threshold.value = c.threshold;
      this.compressor.ratio.value = c.ratio;
      this.compressor.knee.value = c.knee;
      this.compressor.attack.value = c.attack / 1000;
      this.compressor.release.value = c.release / 1000;
      this.makeup.gain.value = Math.pow(10, c.makeup / 20);
    }

    /* ---------- espacializador ---------- */
    setSpat(patch) { Object.assign(this.state.spat, patch); this.updateSpat('room' in patch || 'damp' in patch || 'width' in patch); if ('enabled' in patch) this.rewire(); this.emit('effects'); }
    updateSpat(regen) {
      if (!this.ctx) return;
      const s = this.state.spat;
      this.spatDry.gain.value = s.dry;
      this.spatWet.gain.value = s.wet;
      if (regen) this._regenIR();
    }
    _regenIR() {
      clearTimeout(this._irT);
      this._irT = setTimeout(() => {
        const s = this.state.spat, rate = this.ctx.sampleRate;
        const len = Math.floor(rate * (0.3 + s.room * 3.2));
        const ir = this.ctx.createBuffer(2, len, rate);
        const L = ir.getChannelData(0), R = ir.getChannelData(1);
        let lpL = 0, lpR = 0;
        for (let i = 0; i < len; i++) {
          const t = i / len;
          const decay = Math.pow(1 - t, 2 + (1 - s.room) * 4);
          const a = Math.min(0.97, s.damp * t * 1.2);           // amortecimento cresce no tempo
          const nL = Math.random() * 2 - 1, nIndep = Math.random() * 2 - 1;
          const nR = s.width * nIndep + (1 - s.width) * nL;
          lpL = lpL * a + nL * (1 - a); lpR = lpR * a + nR * (1 - a);
          L[i] = lpL * decay; R[i] = lpR * decay;
        }
        this.convolver.buffer = ir;
      }, 120);
    }

    /* ---------- alargador estéreo ---------- */
    setWiden(patch) { Object.assign(this.state.widen, patch); this.updateWiden(); if ('enabled' in patch) this.rewire(); this.emit('effects'); }
    updateWiden() {
      if (!this.ctx) return;
      const w = this.state.widen;
      this.wDelL.delayTime.value = this.wDelR.delayTime.value = w.delay / 1000;
      this.wFbL.gain.value = this.wFbR.gain.value = Math.min(0.9, w.feedback);
      this.wXL.gain.value = this.wXR.gain.value = -w.crossfeed;
      this.wDryL.gain.value = this.wDryR.gain.value = w.dryMix + w.crossfeed * 0.5;
    }

    /* ---------- tom ---------- */
    setPitch(semitones) { this.state.pitch = U.clamp(semitones, -12, 12); this.updatePitch(); this.emit('effects'); }
    updatePitch() {
      if (!this.pitchNode) return;
      this.pitchNode.parameters.get('ratio').value = Math.pow(2, this.state.pitch / 12);
    }

    /* ---------- modo estéreo ---------- */
    setStereoMode(mode) { if (STEREO_MODES[mode]) { this.state.stereo = mode; this.updateStereo(); this.emit('effects'); } }
    updateStereo() {
      if (!this.ctx) return;
      const m = STEREO_MODES[this.state.stereo].m;
      this.stLL.gain.value = m[0]; this.stLR.gain.value = m[1]; this.stRL.gain.value = m[2]; this.stRR.gain.value = m[3];
    }

    /* ---------- atraso do áudio ---------- */
    setDelay(sec) { this.state.delay = U.clamp(sec, 0, 10); this.updateDelay(); this.emit('effects'); }
    updateDelay() { if (this.ctx) this.delayNode.delayTime.setTargetAtTime(this.state.delay, this.ctx.currentTime, 0.02); }

    /* ---------- normalização de volume ---------- */
    updateNormalize() {
      if (!this.ctx) return;
      const on = this.state.normalize;
      const n = this.normalizer;
      try { this.pitchOut.disconnect(); this.normalizer.disconnect(); } catch (e) { /* ok */ }
      if (on) {
        n.threshold.value = -24 - (this.state.normalizeLevel - 1) * 4;
        n.ratio.value = 12; n.knee.value = 10; n.attack.value = 0.01; n.release.value = 0.4;
        this.pitchOut.connect(n); n.connect(this.normGain);
        this.normGain.gain.value = Math.pow(10, (6 + this.state.normalizeLevel * 2) / 20);
      } else {
        this.pitchOut.connect(this.normGain);
        this.normGain.gain.value = 1;
      }
    }

    /* ---------- saída ---------- */
    async listDevices() {
      try {
        const devs = await navigator.mediaDevices.enumerateDevices();
        return devs.filter(d => d.kind === 'audiooutput').map(d => ({ id: d.deviceId, label: d.label || (d.deviceId === 'default' ? 'Padrão do sistema' : 'Dispositivo ' + d.deviceId.slice(0, 6)) }));
      } catch (e) { return []; }
    }
    async setSinkId(id) {
      try {
        if (this.ctx && this.ctx.setSinkId) await this.ctx.setSinkId(id === 'default' ? '' : id);
        else throw new Error('Seleção de saída não suportada por este navegador');
        this.settings.set('audioDevice', id);
        this.emit('device', id);
        return true;
      } catch (e) {
        this.log.warn('audio', 'Falha ao trocar dispositivo de saída: ' + e.message);
        return false;
      }
    }

    getRecordStream() { this.ensure(); return this.recordDest ? this.recordDest.stream : null; }

    resetEffects() {
      this.state.eq = { enabled: false, preamp: 0, bands: new Array(10).fill(0), preset: 'flat', twoPass: false };
      this.state.comp.enabled = false; this.state.spat.enabled = false; this.state.widen.enabled = false;
      this.state.pitch = 0;
      this.updateEq(); this.updatePitch(); this.rewire(); this.emit('effects');
    }
  }

  AudioEngine.EQ_PRESETS = EQ_PRESETS;
  AudioEngine.STEREO_MODES = STEREO_MODES;
  AudioEngine.VLC_BANDS = VLC_BANDS;
  AudioEngine.ISO_BANDS = ISO_BANDS;
  VW.AudioEngine = AudioEngine;
})(window.VW = window.VW || {});
