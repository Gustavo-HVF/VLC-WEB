/* VLC Web — visualizações de áudio (Áudio → Visualizações)
 * Espectro, Espectrômetro, Osciloscópio, Medidor VU, Goom (psicodélico) e Espectro 3D. */
(function (VW) {
  'use strict';
  const U = VW.util;

  const MODES = {
    none: 'Desativar',
    spectrum: 'Espectro',
    spectrometer: 'Espectrômetro',
    scope: 'Osciloscópio',
    vumeter: 'Medidor VU',
    goom: 'Goom',
    spectrum3d: 'Espectro 3D'
  };

  class Visualizer {
    constructor(canvas, audio) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.audio = audio;
      this.mode = 'none';
      this.running = false;
      this.peaks = [];
      this.history = [];
      this.particles = [];
      this.hue = 0;
      this._loop = this._loop.bind(this);
      new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    }

    resize() {
      const r = this.canvas.parentElement.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.max(1, Math.round(r.width * dpr));
      this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    }

    setMode(mode) {
      this.mode = MODES[mode] ? mode : 'none';
      const on = this.mode !== 'none';
      this.canvas.style.display = on ? 'block' : 'none';
      if (on && !this.running) { this.running = true; this.resize(); requestAnimationFrame(this._loop); }
      if (!on) this.running = false;
    }

    _loop() {
      if (!this.running) return;
      requestAnimationFrame(this._loop);
      const a = this.audio;
      if (!a.analyser || this.canvas.offsetParent === null) return;
      const fn = this['draw_' + this.mode];
      if (fn) fn.call(this, this.ctx, this.canvas.width, this.canvas.height);
    }

    freq(an) {
      const d = this._f && this._f.length === an.frequencyBinCount ? this._f : (this._f = new Uint8Array(an.frequencyBinCount));
      an.getByteFrequencyData(d);
      return d;
    }
    wave(an, key) {
      const d = this[key] && this[key].length === an.fftSize ? this[key] : (this[key] = new Float32Array(an.fftSize));
      an.getFloatTimeDomainData(d);
      return d;
    }

    /** Agrupa bins de FFT em n bandas logarítmicas (0..1) */
    bands(n) {
      const an = this.audio.analyser, f = this.freq(an);
      const out = new Float32Array(n);
      const nyq = this.audio.ctx.sampleRate / 2, bins = f.length;
      for (let i = 0; i < n; i++) {
        const lo = 30 * Math.pow(18000 / 30, i / n), hi = 30 * Math.pow(18000 / 30, (i + 1) / n);
        const a = Math.max(0, Math.floor(lo / nyq * bins)), b = Math.min(bins - 1, Math.max(a + 1, Math.ceil(hi / nyq * bins)));
        let m = 0;
        for (let k = a; k < b; k++) m = Math.max(m, f[k]);
        out[i] = m / 255;
      }
      return out;
    }

    draw_spectrum(x, W, H) {
      x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
      const n = 64, b = this.bands(n), bw = W / n;
      for (let i = 0; i < n; i++) {
        const h = b[i] * H * 0.92;
        const g = x.createLinearGradient(0, H, 0, H - h);
        g.addColorStop(0, '#1b5e20'); g.addColorStop(0.5, '#f9a825'); g.addColorStop(1, '#d50000');
        x.fillStyle = g;
        x.fillRect(i * bw + 1, H - h, bw - 2, h);
      }
    }

    draw_spectrometer(x, W, H) {
      x.fillStyle = 'rgba(0,0,10,0.35)'; x.fillRect(0, 0, W, H);
      const n = 24, b = this.bands(n), bw = W / n;
      if (this.peaks.length !== n) this.peaks = new Array(n).fill(0);
      const seg = 28, sh = H * 0.9 / seg;
      for (let i = 0; i < n; i++) {
        const lit = Math.round(b[i] * seg);
        for (let s = 0; s < seg; s++) {
          const on = s < lit;
          const hue = 120 - (s / seg) * 120;
          x.fillStyle = on ? `hsl(${hue},90%,50%)` : 'rgba(255,255,255,0.04)';
          x.fillRect(i * bw + bw * 0.12, H - (s + 1) * sh, bw * 0.76, sh * 0.72);
        }
        this.peaks[i] = Math.max(this.peaks[i] - 0.006, b[i]);
        if (this.peaks[i] > 0.02) {
          x.fillStyle = '#fff';
          x.fillRect(i * bw + bw * 0.12, H - this.peaks[i] * seg * sh - 3, bw * 0.76, 3);
        }
      }
    }

    draw_scope(x, W, H) {
      x.fillStyle = 'rgba(0,0,0,0.6)'; x.fillRect(0, 0, W, H);
      const L = this.wave(this.audio.analyserL, '_wl'), R = this.wave(this.audio.analyserR, '_wr');
      const drawWave = (d, color, y0, amp) => {
        x.strokeStyle = color; x.lineWidth = Math.max(1, W / 800); x.beginPath();
        const step = d.length / W;
        for (let i = 0; i < W; i++) { const v = d[Math.floor(i * step)]; const y = y0 + v * amp; i ? x.lineTo(i, y) : x.moveTo(i, y); }
        x.stroke();
      };
      drawWave(L, '#4fc3f7', H * 0.27, H * 0.24);
      drawWave(R, '#ff8a65', H * 0.73, H * 0.24);
      x.fillStyle = 'rgba(255,255,255,.4)'; x.font = `${Math.round(H / 30)}px sans-serif`;
      x.fillText('E', 8, H * 0.06); x.fillText('D', 8, H * 0.56);
    }

    draw_vumeter(x, W, H) {
      x.fillStyle = '#111'; x.fillRect(0, 0, W, H);
      const level = d => { let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i]; return Math.sqrt(s / d.length); };
      const L = level(this.wave(this.audio.analyserL, '_wl')), R = level(this.wave(this.audio.analyserR, '_wr'));
      if (!this.vu) this.vu = { l: 0, r: 0, pl: 0, pr: 0 };
      const db = v => U.clamp((20 * Math.log10(v + 1e-9) + 48) / 48, 0, 1);
      this.vu.l = Math.max(db(L), this.vu.l * 0.92); this.vu.r = Math.max(db(R), this.vu.r * 0.92);
      this.vu.pl = Math.max(this.vu.pl - 0.004, this.vu.l); this.vu.pr = Math.max(this.vu.pr - 0.004, this.vu.r);
      const bar = (v, p, y, label) => {
        const w = W * 0.84, x0 = W * 0.1, h = H * 0.16;
        const g = x.createLinearGradient(x0, 0, x0 + w, 0);
        g.addColorStop(0, '#2e7d32'); g.addColorStop(0.7, '#fdd835'); g.addColorStop(1, '#d50000');
        x.fillStyle = '#222'; x.fillRect(x0, y, w, h);
        x.fillStyle = g; x.fillRect(x0, y, w * v, h);
        x.fillStyle = '#fff'; x.fillRect(x0 + w * p - 2, y, 3, h);
        x.font = `bold ${Math.round(h * 0.6)}px sans-serif`; x.fillText(label, W * 0.04, y + h * 0.72);
      };
      bar(this.vu.l, this.vu.pl, H * 0.25, 'E');
      bar(this.vu.r, this.vu.pr, H * 0.55, 'D');
      x.fillStyle = 'rgba(255,255,255,.5)'; x.font = `${Math.round(H / 32)}px sans-serif`;
      for (const d of [-48, -36, -24, -12, -6, 0]) x.fillText(d + ' dB', W * 0.1 + W * 0.84 * ((d + 48) / 48) - 14, H * 0.85);
    }

    draw_goom(x, W, H) {
      const b = this.bands(16);
      const bass = (b[0] + b[1] + b[2]) / 3, mid = (b[5] + b[6] + b[7]) / 3, high = (b[11] + b[12] + b[13]) / 3;
      this.hue = (this.hue + 0.6 + bass * 4) % 360;
      // rastro com zoom/rotação (efeito "túnel")
      x.save();
      x.globalAlpha = 0.92;
      x.translate(W / 2, H / 2);
      x.rotate(0.004 + mid * 0.02);
      x.scale(1.02 + bass * 0.03, 1.02 + bass * 0.03);
      x.drawImage(this.canvas, -W / 2, -H / 2, W, H);
      x.restore();
      x.fillStyle = 'rgba(0,0,0,0.08)'; x.fillRect(0, 0, W, H);
      const wave = this.wave(this.audio.analyserL, '_wl');
      x.lineWidth = 2 + bass * 6;
      x.strokeStyle = `hsl(${this.hue},100%,${50 + high * 30}%)`;
      x.beginPath();
      const r0 = Math.min(W, H) * (0.18 + bass * 0.15);
      for (let i = 0; i <= 256; i++) {
        const a = (i / 256) * Math.PI * 2;
        const v = wave[Math.floor((i % 256) / 256 * wave.length)] || 0;
        const r = r0 + v * Math.min(W, H) * 0.25;
        const px = W / 2 + Math.cos(a) * r, py = H / 2 + Math.sin(a) * r;
        i ? x.lineTo(px, py) : x.moveTo(px, py);
      }
      x.closePath(); x.stroke();
      if (bass > 0.6) for (let i = 0; i < 6; i++) this.particles.push({ x: W / 2, y: H / 2, vx: (Math.random() - 0.5) * W * 0.02, vy: (Math.random() - 0.5) * H * 0.02, life: 1, h: this.hue + Math.random() * 60 });
      this.particles = this.particles.filter(p => (p.life -= 0.015) > 0);
      for (const p of this.particles) {
        p.x += p.vx; p.y += p.vy;
        x.fillStyle = `hsla(${p.h},100%,60%,${p.life})`;
        x.beginPath(); x.arc(p.x, p.y, 2 + p.life * 4, 0, Math.PI * 2); x.fill();
      }
    }

    draw_spectrum3d(x, W, H) {
      const n = 48, b = this.bands(n);
      this.history.unshift(b);
      if (this.history.length > 40) this.history.pop();
      x.fillStyle = '#05050f'; x.fillRect(0, 0, W, H);
      for (let r = this.history.length - 1; r >= 0; r--) {
        const row = this.history[r], depth = r / 40;
        const scale = 1 - depth * 0.6, y0 = H * 0.92 - depth * H * 0.55, xw = W * 0.9 * scale, x0 = (W - xw) / 2;
        x.beginPath();
        for (let i = 0; i < n; i++) {
          const px = x0 + (i / (n - 1)) * xw, py = y0 - row[i] * H * 0.4 * scale;
          i ? x.lineTo(px, py) : x.moveTo(px, py);
        }
        x.strokeStyle = `hsla(${200 - depth * 160},90%,${60 - depth * 30}%,${1 - depth * 0.8})`;
        x.lineWidth = Math.max(1, 2.2 * scale);
        x.stroke();
      }
    }
  }

  Visualizer.MODES = MODES;
  VW.Visualizer = Visualizer;
})(window.VW = window.VW || {});
