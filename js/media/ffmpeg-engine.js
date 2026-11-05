/* VLC Web — motor FFmpeg (WebAssembly)
 * Dá ao navegador a capacidade de "reproduzir quase tudo" como o VLC: arquivos que o navegador
 * não decodifica (AVI, WMV, FLV, MPEG‑2, VOB, AC‑3, DTS, WMA, APE, MKV com faixas especiais...)
 * são remultiplexados ou convertidos localmente, sem enviar nada para servidores.
 * Também é usado por Mídia → Converter/Salvar, troca de faixa de áudio e extração de legendas. */
(function (VW) {
  'use strict';
  const U = VW.util;

  const TEXT_SUBS = ['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text', 'text', 'microdvd', 'subviewer', 'subviewer1', 'sami', 'realtext', 'stl', 'ttml', 'mpl2', 'jacosub', 'vplayer', 'pjs'];

  class FFmpegEngine extends U.Emitter {
    constructor(settings, log) {
      super();
      this.settings = settings;
      this.log = log;
      this.ff = null;
      this.state = 'idle';
      this.loading = null;
      this.seq = 0;
      this.busy = false;
    }

    get supported() { return U.supports.worker && typeof WebAssembly === 'object'; }

    async fetchWithProgress(url, mime, onProgress) {
      const res = await fetch(url, { mode: 'cors', cache: 'force-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar ${url}`);
      const total = +res.headers.get('content-length') || 0;
      if (!res.body || !res.body.getReader) {
        const b = await res.blob();
        return URL.createObjectURL(new Blob([b], { type: mime }));
      }
      const reader = res.body.getReader();
      const chunks = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
        onProgress && onProgress(total && got <= total ? got / total : -1, got);
      }
      return URL.createObjectURL(new Blob(chunks, { type: mime }));
    }

    /** Carrega o FFmpeg (≈ 31 MB na primeira vez; depois vem do cache do navegador). */
    load(onProgress) {
      if (this.state === 'ready') return Promise.resolve(this.ff);
      if (this.loading) return this.loading;
      this.loading = (async () => {
        if (!this.supported) throw new Error('O motor FFmpeg precisa que a página seja aberta por HTTP(S) (não funciona em file://).');
        this.state = 'loading';
        this.emit('state', this.state);
        this.log.info('ffmpeg', 'Carregando o motor FFmpeg (WebAssembly)…');
        await U.loadScript('vendor/ffmpeg/ffmpeg.js');
        const base = new URL(this.settings.get('ffmpegCoreBase').replace(/\/?$/, '/'), location.href).href;
        const wasmURL = await this.fetchWithProgress(base + 'ffmpeg-core.wasm', 'application/wasm', p => {
          onProgress && onProgress(p, 'download');
          this.emit('load-progress', p);
        });
        const ff = new window.FFmpegWASM.FFmpeg();
        ff.on('log', ({ message }) => { this.emit('log', message); if (this.capture) this.capture.push(message); });
        ff.on('progress', e => this.emit('progress', e));
        await ff.load({ coreURL: base + 'ffmpeg-core.js', wasmURL });
        this.ff = ff;
        this.state = 'ready';
        this.emit('state', this.state);
        this.log.info('ffmpeg', 'Motor FFmpeg pronto');
        return ff;
      })().catch(e => {
        this.state = 'error';
        this.loading = null;
        this.emit('state', this.state);
        this.log.error('ffmpeg', 'Falha ao carregar o FFmpeg: ' + e.message);
        throw e;
      });
      return this.loading;
    }

    cancel() {
      if (this.ff) {
        try { this.ff.terminate(); } catch (e) { /* ok */ }
        this.ff = null;
        this.state = 'idle';
        this.loading = null;
        this.busy = false;
        this.emit('state', this.state);
        this.log.warn('ffmpeg', 'Operação do FFmpeg cancelada');
      }
    }

    async withInput(file, fn) {
      const ff = await this.load();
      const dir = '/in' + (++this.seq);
      await ff.createDir(dir);
      const name = (file.name || 'entrada').replace(/[\\/]/g, '_') || 'entrada';
      const f = file instanceof File ? file : new File([file], name, { type: file.type });
      let path, mounted = false;
      try {
        await ff.mount('WORKERFS', { files: [f] }, dir);
        mounted = true;
        path = `${dir}/${f.name}`;
      } catch (e) {
        path = `${dir}/input.${U.ext(name) || 'bin'}`;
        await ff.writeFile(path, new Uint8Array(await f.arrayBuffer()));
      }
      try { return await fn(path, ff); }
      finally {
        try { if (mounted) await ff.unmount(dir); else await ff.deleteFile(path); await ff.deleteDir(dir); } catch (e) { /* ignora */ }
      }
    }

    async execCapture(args) {
      const ff = await this.load();
      this.capture = [];
      let code;
      try { code = await ff.exec(args); }
      finally { var logs = this.capture; this.capture = null; }
      return { code, logs };
    }

    /** Analisa o arquivo e retorna os fluxos (equivalente ao "ffprobe"). */
    async probe(file) {
      return this.withInput(file, async (path) => {
        const { logs } = await this.execCapture(['-hide_banner', '-i', path]);
        return parseProbe(logs);
      });
    }

    /**
     * Executa uma conversão genérica.
     * opts: { args: [...opções de saída], ext, mime, start, end, duration, onProgress }
     */
    async convert(file, opts) {
      if (this.busy) throw new Error('O FFmpeg já está ocupado com outra tarefa');
      this.busy = true;
      try {
        return await this.withInput(file, async (path, ff) => {
          const out = `/out${this.seq}.${opts.ext}`;
          const pre = [];
          if (opts.start > 0) pre.push('-ss', String(opts.start));
          const post = [];
          if (opts.end > 0) post.push('-t', String(Math.max(0.1, opts.end - (opts.start || 0))));
          const dur = opts.end > 0 ? opts.end - (opts.start || 0) : opts.duration;
          const onProg = e => {
            const t = (e.time || 0) / 1e6;
            const p = dur > 0 && t > 0 ? U.clamp(t / dur, 0, 1) : U.clamp(e.progress || 0, 0, 1);
            opts.onProgress && opts.onProgress(p, t);
          };
          ff.on('progress', onProg);
          let res;
          try {
            res = await this.execCapture(['-hide_banner', '-y', ...pre, '-i', path, ...post, ...opts.args, out]);
          } finally { ff.off('progress', onProg); }
          if (res.code !== 0) {
            const err = res.logs.filter(l => /error|invalid|unknown|not|fail/i.test(l)).slice(-4).join(' | ');
            throw new Error('FFmpeg falhou (código ' + res.code + ')' + (err ? ': ' + err : ''));
          }
          const data = await ff.readFile(out);
          await ff.deleteFile(out).catch(() => {});
          return new Blob([data.buffer], { type: opts.mime || 'application/octet-stream' });
        });
      } finally { this.busy = false; }
    }

    /**
     * Torna um arquivo reproduzível no navegador: remultiplexa (rápido) quando os codecs são
     * suportados, ou converte apenas o necessário. Também extrai legendas de texto embutidas.
     */
    async makePlayable(file, opts = {}) {
      const onProgress = opts.onProgress || (() => {});
      onProgress(0, 'Analisando…');
      const probe = opts.probe || await this.probe(file);
      const v = probe.streams.find(s => s.type === 'video' && !s.attachedPic);
      const audios = probe.streams.filter(s => s.type === 'audio');
      const ai = U.clamp(opts.audioIndex ?? Math.max(0, audios.findIndex(s => s.default)), 0, Math.max(0, audios.length - 1));
      const a = audios[ai];
      const test = document.createElement('video');
      const can = t => !!test.canPlayType(t);
      const canH264 = can('video/mp4; codecs="avc1.42E01E"');
      const vPlay = { h264: canH264, hevc: can('video/mp4; codecs="hvc1.1.6.L93.B0"'), vp8: can('video/webm; codecs="vp8"'), vp9: can('video/webm; codecs="vp9"'), av1: can('video/mp4; codecs="av01.0.05M.08"') };
      const aPlay = { aac: can('audio/mp4; codecs="mp4a.40.2"'), mp3: can('audio/mpeg'), opus: can('audio/webm; codecs="opus"'), vorbis: can('audio/webm; codecs="vorbis"'), flac: can('audio/flac') };
      const vOK = !v || !!vPlay[v.codec];
      const aOK = !a || !!aPlay[a.codec];
      let container;
      const webmV = !v || ['vp8', 'vp9', 'av1'].includes(v.codec);
      const webmA = !a || ['opus', 'vorbis'].includes(a.codec);
      if (vOK && aOK && webmV && webmA && (v || a)) container = 'webm';
      else if (vOK && v && ['vp8'].includes(v.codec)) container = 'webm';
      else container = (vOK || canH264) ? 'mp4' : 'webm';
      const vArgs = [], aArgs = [];
      let what = [];
      if (v) {
        if (vOK && !(container === 'webm' && !['vp8', 'vp9', 'av1'].includes(v.codec))) {
          vArgs.push('-c:v', 'copy');
          if (v.codec === 'hevc') vArgs.push('-tag:v', 'hvc1');
        } else if (container === 'mp4') {
          vArgs.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', '-vf', 'scale=-2:min(ih\\,1080)');
          what.push('vídeo → H.264');
        } else {
          vArgs.push('-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '2500k', '-pix_fmt', 'yuv420p', '-vf', 'scale=-2:min(ih\\,720)');
          what.push('vídeo → VP8');
        }
      }
      if (a) {
        const okInContainer = container === 'webm' ? ['opus', 'vorbis'].includes(a.codec) : ['aac', 'mp3', 'opus', 'flac'].includes(a.codec);
        if (aOK && okInContainer) aArgs.push('-c:a', 'copy');
        else if (container === 'mp4') { aArgs.push('-c:a', 'aac', '-b:a', '192k', '-ac', '2'); what.push('áudio → AAC'); }
        // (o codificador Opus do ffmpeg.wasm 0.12 derruba a aba do navegador; por isso WebM usa Vorbis)
        else { aArgs.push('-c:a', 'libvorbis', '-q:a', '5', '-ac', '2'); what.push('áudio → Vorbis'); }
      }
      const mime = (v ? 'video/' : 'audio/') + container;
      const label = what.length ? 'Convertendo (' + what.join(', ') + ')…' : 'Remultiplexando (sem perdas)…';
      this.log.info('ffmpeg', `${file.name}: ${label} [${v ? v.codec : '-'} / ${a ? a.codec : '-'} → ${container}]`);
      onProgress(0, label);
      const args = [];
      if (v) args.push('-map', `0:${v.index}`); else args.push('-vn');
      if (a) args.push('-map', `0:${a.index}`); else args.push('-an');
      args.push('-sn', '-dn', ...vArgs, ...aArgs);
      if (container === 'mp4') args.push('-movflags', '+faststart');
      const blob = await this.convert(file, { args, ext: container, mime, duration: probe.duration, onProgress: p => onProgress(p, label) });
      let subtitles = [];
      if (opts.extractSubs !== false) {
        try { subtitles = await this.extractSubtitles(file, probe); } catch (e) { this.log.warn('ffmpeg', 'Falha ao extrair legendas: ' + e.message); }
      }
      return { blob, mime, probe, audioIndex: ai, subtitles };
    }

    /**
     * Extrai uma única faixa de áudio (para tocar em sincronia com o vídeo original).
     * Copia sem perdas quando o navegador decodifica o codec; senão converte para AAC estéreo.
     * Bem mais leve que remultiplexar o vídeo inteiro (a saída tem só o áudio).
     */
    async extractAudio(file, opts = {}) {
      const onProgress = opts.onProgress || (() => {});
      onProgress(0, 'Analisando…');
      const probe = opts.probe || await this.probe(file);
      const audios = probe.streams.filter(s => s.type === 'audio');
      if (!audios.length) throw new Error('o arquivo não tem faixas de áudio');
      const ai = U.clamp(opts.audioIndex ?? Math.max(0, audios.findIndex(s => s.default)), 0, audios.length - 1);
      const a = audios[ai];
      const test = document.createElement('audio');
      const can = t => !!test.canPlayType(t);
      let ext, mime, aArgs, what;
      if (a.codec === 'aac' && can('audio/mp4; codecs="mp4a.40.2"')) { ext = 'm4a'; mime = 'audio/mp4'; aArgs = ['-c:a', 'copy']; }
      else if (a.codec === 'mp3' && can('audio/mpeg')) { ext = 'mp3'; mime = 'audio/mpeg'; aArgs = ['-c:a', 'copy']; }
      else if (a.codec === 'flac' && can('audio/flac')) { ext = 'flac'; mime = 'audio/flac'; aArgs = ['-c:a', 'copy']; }
      else if ((a.codec === 'opus' || a.codec === 'vorbis') && can(`audio/webm; codecs="${a.codec}"`)) { ext = 'webm'; mime = 'audio/webm'; aArgs = ['-c:a', 'copy']; }
      else { ext = 'm4a'; mime = 'audio/mp4'; aArgs = ['-c:a', 'aac', '-b:a', '192k', '-ac', '2']; what = a.codec.toUpperCase() + ' → AAC'; }
      const label = what ? `Convertendo a faixa de áudio ${ai + 1} (${what})…` : `Extraindo a faixa de áudio ${ai + 1} (sem perdas)…`;
      this.log.info('ffmpeg', `${file.name}: ${label}`);
      onProgress(0, label);
      const args = ['-map', `0:${a.index}`, '-vn', '-sn', '-dn', ...aArgs];
      if (ext === 'm4a') args.push('-movflags', '+faststart');
      const blob = await this.convert(file, { args, ext, mime, duration: probe.duration, onProgress: p => onProgress(p, label) });
      return { blob, mime, probe, audioIndex: ai, stream: a, converted: !!what };
    }

    /** Extrai faixas de legenda de texto embutidas (MKV/MP4) como arquivos SRT/ASS. */
    async extractSubtitles(file, probe) {
      probe = probe || await this.probe(file);
      const subs = probe.streams.filter(s => s.type === 'subtitle' && TEXT_SUBS.includes(s.codec));
      if (!subs.length) return [];
      return this.withInput(file, async (path, ff) => {
        const args = ['-hide_banner', '-y', '-i', path];
        const outs = subs.map((s, i) => {
          const ext = (s.codec === 'ass' || s.codec === 'ssa') ? 'ass' : 'srt';
          const out = `/sub${this.seq}_${i}.${ext}`;
          args.push('-map', `0:${s.index}`, '-c:s', ext === 'ass' ? 'copy' : 'srt', out);
          return { out, s, ext };
        });
        const res = await this.execCapture(args);
        const result = [];
        for (const o of outs) {
          try {
            const data = await ff.readFile(o.out);
            await ff.deleteFile(o.out).catch(() => {});
            const label = [o.s.title, o.s.lang].filter(Boolean).join(' — ') || ('Faixa ' + (result.length + 1));
            result.push({ file: new File([data.buffer], `${label}.${o.ext}`, { type: 'text/plain' }), lang: o.s.lang, title: label, forced: o.s.forced });
          } catch (e) { /* faixa vazia */ }
        }
        if (res.code !== 0 && !result.length) throw new Error('nenhuma legenda pôde ser extraída');
        return result;
      });
    }
  }

  function parseProbe(lines) {
    const info = { format: '', duration: NaN, bitrate: 0, streams: [], metadata: {}, raw: lines.join('\n') };
    let cur = null, inGlobalMeta = false;
    const counters = { video: 0, audio: 0, subtitle: 0, data: 0, attachment: 0 };
    for (const l of lines) {
      let m;
      if ((m = l.match(/^Input #\d+, ([^,]+(?:,[^,]+)*?), from/))) { info.format = m[1]; inGlobalMeta = false; continue; }
      if ((m = l.match(/Duration: (\d+):(\d+):([\d.]+)/))) {
        info.duration = +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]);
        const b = l.match(/bitrate: (\d+) kb\/s/); if (b) info.bitrate = +b[1] * 1000;
        inGlobalMeta = false; cur = null; continue;
      }
      if (/^\s*Metadata:/.test(l) && !cur) { inGlobalMeta = true; continue; }
      if ((m = l.match(/Stream #\d+:(\d+)(?:\[0x[0-9a-f]+\])?(?:\(([a-z]{2,3})\))?.*?: (Video|Audio|Subtitle|Data|Attachment): ([\w-]+)(.*)$/i))) {
        const type = m[3].toLowerCase();
        cur = { index: +m[1], typeIndex: counters[type]++, type, codec: m[4].toLowerCase(), lang: m[2] && m[2] !== 'und' ? m[2] : '', title: '', raw: l.trim(), default: /\(default\)/.test(l), forced: /\(forced\)/.test(l) };
        const rest = m[5];
        if (type === 'video') {
          const r = rest.match(/, (\d{2,5})x(\d{2,5})/); if (r) { cur.width = +r[1]; cur.height = +r[2]; }
          const f = rest.match(/([\d.]+) fps/); if (f) cur.fps = parseFloat(f[1]);
          cur.attachedPic = /attached pic/.test(rest);
          const pf = rest.match(/, (yuv\w+|rgb\w+|nv12|gray\w*|pal8)/); if (pf) cur.pixFmt = pf[1];
        } else if (type === 'audio') {
          const r = rest.match(/(\d+) Hz/); if (r) cur.sampleRate = +r[1];
          const c = rest.match(/Hz, ([^,]+)/); if (c) cur.layout = c[1].trim();
        }
        const br = rest.match(/(\d+) kb\/s/); if (br) cur.bitrate = +br[1] * 1000;
        const prof = rest.match(/^\s*\(([^)]+)\)/); if (prof) cur.profile = prof[1];
        info.streams.push(cur);
        inGlobalMeta = false;
        continue;
      }
      if ((m = l.match(/^\s{4,}(\w[\w ]*?)\s*:\s(.*)$/))) {
        const k = m[1].trim().toLowerCase(), v = m[2].trim();
        if (cur) { if (k === 'title' || k === 'handler_name' && !cur.title) cur.title = k === 'title' ? v : (/handler/i.test(v) ? cur.title : v); }
        else if (inGlobalMeta) info.metadata[k] = v;
      }
    }
    return info;
  }

  FFmpegEngine.parseProbe = parseProbe;
  FFmpegEngine.TEXT_SUBS = TEXT_SUBS;
  VW.FFmpegEngine = FFmpegEngine;
})(window.VW = window.VW || {});
