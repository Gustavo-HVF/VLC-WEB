/* VLC Web — utilitários compartilhados */
(function (VW) {
  'use strict';

  const U = {};

  U.$ = (sel, root) => (root || document).querySelector(sel);
  U.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /**
   * Cria um elemento DOM.
   * attrs: class, style (string|objeto), dataset, html, text, on* (handlers) e demais atributos.
   */
  U.el = function (tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'text') node.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
        else if (v === true) node.setAttribute(k, '');
        else node.setAttribute(k, v);
      }
    }
    U.append(node, children);
    return node;
  };

  U.append = function (node, children) {
    for (const c of children.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  };

  U.icon = function (name, cls) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'ico' + (cls ? ' ' + cls : ''));
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(ns, 'use');
    use.setAttribute('href', '#i-' + name);
    svg.appendChild(use);
    return svg;
  };

  U.clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  U.round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

  /** Formata segundos como [h:]mm:ss */
  U.fmtTime = function (sec, forceHours) {
    if (!isFinite(sec)) return '--:--';
    const neg = sec < 0;
    sec = Math.floor(Math.abs(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0');
    const out = (h > 0 || forceHours) ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
    return (neg ? '-' : '') + out;
  };

  /** Formata com milissegundos: hh:mm:ss.mmm */
  U.fmtTimeMs = function (sec) {
    if (!isFinite(sec)) return '00:00:00.000';
    const neg = sec < 0;
    sec = Math.abs(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
    const ms = Math.round((sec - Math.floor(sec)) * 1000);
    return (neg ? '-' : '') + `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  };

  /** Converte "1:02:03.5", "90", "1h2m3s" em segundos (NaN se inválido) */
  U.parseTime = function (str) {
    if (typeof str === 'number') return str;
    str = String(str || '').trim().replace(',', '.');
    if (!str) return NaN;
    let m = str.match(/^(?:(\d+)h)?\s*(?:(\d+)m(?!s))?\s*(?:([\d.]+)s)?$/i);
    if (m && (m[1] || m[2] || m[3])) return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
    const parts = str.split(':');
    if (parts.some(p => p === '' || isNaN(+p))) return NaN;
    return parts.reduce((acc, p) => acc * 60 + parseFloat(p), 0);
  };

  U.fmtBytes = function (b) {
    if (!isFinite(b)) return '—';
    const u = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    let i = 0;
    while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return (i ? b.toFixed(b < 10 ? 2 : 1) : b) + ' ' + u[i];
  };

  U.fmtBitrate = function (bps) {
    if (!isFinite(bps) || bps <= 0) return '—';
    if (bps >= 1e6) return (bps / 1e6).toFixed(2) + ' Mb/s';
    return Math.round(bps / 1e3) + ' kb/s';
  };

  U.debounce = function (fn, ms) {
    let t;
    return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
  };

  U.throttle = function (fn, ms) {
    let last = 0, t;
    return function (...a) {
      const now = Date.now();
      clearTimeout(t);
      if (now - last >= ms) { last = now; fn.apply(this, a); }
      else t = setTimeout(() => { last = Date.now(); fn.apply(this, a); }, ms - (now - last));
    };
  };

  U.sleep = ms => new Promise(r => setTimeout(r, ms));

  U.uid = (() => { let n = 0; return (p = 'id') => p + '-' + Date.now().toString(36) + '-' + (n++).toString(36); })();

  U.escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  U.ext = function (name) {
    name = String(name || '').split(/[?#]/)[0];
    const i = name.lastIndexOf('.');
    const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
    return i > slash ? name.slice(i + 1).toLowerCase() : '';
  };

  U.baseName = function (name) {
    name = String(name || '').split(/[?#]/)[0];
    name = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
    try { name = decodeURIComponent(name); } catch (e) { /* mantém */ }
    return name;
  };

  U.stripExt = function (name) {
    const b = U.baseName(name);
    const i = b.lastIndexOf('.');
    return i > 0 ? b.slice(0, i) : b;
  };

  U.download = function (blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = U.el('a', { href: url, download: filename, style: 'display:none' });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
  };

  U.timestamp = function (d = new Date()) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}h${p(d.getMinutes())}m${p(d.getSeconds())}s`;
  };

  U.isTyping = function (e) {
    const t = e && e.target;
    if (!t || !t.tagName) return false;
    if (t.isContentEditable) return true;
    if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
    if (t.tagName === 'INPUT') {
      const type = (t.type || 'text').toLowerCase();
      return !['checkbox', 'radio', 'range', 'button', 'submit', 'color', 'file'].includes(type);
    }
    return false;
  };

  /* ---------- Tipos de mídia por extensão ---------- */
  U.EXT = {
    video: ['mp4', 'm4v', 'webm', 'mkv', 'mov', 'ogv', 'avi', 'wmv', 'asf', 'flv', 'f4v', 'mpg', 'mpeg', 'mpe', 'm1v', 'm2v', 'ts', 'm2ts', 'mts', 'tp', 'trp', '3gp', '3g2', 'vob', 'divx', 'xvid', 'rm', 'rmvb', 'ogm', 'dv', 'mxf', 'nut', 'h264', 'h265', 'hevc', 'y4m', 'qt'],
    audio: ['mp3', 'm4a', 'm4b', 'aac', 'wav', 'wave', 'flac', 'ogg', 'oga', 'opus', 'wma', 'aiff', 'aif', 'aifc', 'ape', 'mka', 'weba', 'amr', 'ac3', 'eac3', 'dts', 'mp2', 'mpa', 'au', 'snd', 'caf', 'wv', 'tta', 'mpc', 'spx', 'mid', 'midi', 'gsm', 'voc', 'w64', 'alac'],
    image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'svg', 'ico', 'apng'],
    sub: ['srt', 'vtt', 'webvtt', 'ass', 'ssa', 'sub', 'sbv', 'mpl', 'lrc', 'smi', 'sami', 'ttml', 'dfxp', 'xml', 'txt', 'usf', 'jss', 'psb', 'rt', 'stl', 'idx'],
    playlist: ['m3u', 'm3u8', 'pls', 'xspf', 'asx', 'wpl', 'cue']
  };

  U.kindOf = function (name, mime) {
    const e = U.ext(name);
    if (mime) {
      if (mime.startsWith('video/')) return 'video';
      if (mime.startsWith('audio/')) return 'audio';
      if (mime.startsWith('image/')) return 'image';
    }
    for (const k of ['video', 'audio', 'image', 'playlist']) if (U.EXT[k].includes(e)) return k;
    if (U.EXT.sub.includes(e) && e !== 'xml' && e !== 'txt') return 'sub';
    return null;
  };

  U.isSubtitleFile = name => {
    const e = U.ext(name);
    return U.EXT.sub.includes(e) && e !== 'idx';
  };

  U.isMediaFile = name => ['video', 'audio', 'image'].includes(U.kindOf(name));

  /** Ordenação natural (ep2 < ep10) */
  U.naturalCompare = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });

  /* ---------- Texto e codificação ---------- */
  U.ENCODINGS = [
    ['auto', 'Automático'], ['utf-8', 'Universal (UTF-8)'], ['utf-16le', 'Universal (UTF-16 LE)'], ['utf-16be', 'Universal (UTF-16 BE)'],
    ['windows-1252', 'Europa Ocidental (Windows-1252)'], ['iso-8859-1', 'Europa Ocidental (ISO-8859-1)'], ['iso-8859-15', 'Europa Ocidental (ISO-8859-15 com Euro)'],
    ['windows-1250', 'Europa Oriental (Windows-1250)'], ['iso-8859-2', 'Europa Oriental (ISO-8859-2)'],
    ['windows-1251', 'Cirílico (Windows-1251)'], ['koi8-r', 'Russo (KOI8-R)'], ['koi8-u', 'Ucraniano (KOI8-U)'],
    ['iso-8859-7', 'Grego (ISO-8859-7)'], ['windows-1253', 'Grego (Windows-1253)'], ['windows-1254', 'Turco (Windows-1254)'],
    ['windows-1255', 'Hebraico (Windows-1255)'], ['windows-1256', 'Árabe (Windows-1256)'], ['windows-1257', 'Báltico (Windows-1257)'],
    ['windows-1258', 'Vietnamita (Windows-1258)'], ['windows-874', 'Tailandês (Windows-874)'],
    ['shift_jis', 'Japonês (Shift JIS)'], ['euc-jp', 'Japonês (EUC-JP)'], ['gbk', 'Chinês simplificado (GBK)'], ['gb18030', 'Chinês unificado (GB18030)'],
    ['big5', 'Chinês tradicional (Big5)'], ['euc-kr', 'Coreano (EUC-KR)']
  ];

  /** Decodifica bytes de texto detectando BOM / UTF-8 válido; caso contrário usa o fallback. */
  U.decodeText = function (buf, encoding, fallback = 'windows-1252') {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (encoding && encoding !== 'auto') {
      try { return new TextDecoder(encoding).decode(bytes); } catch (e) { /* cai para auto */ }
    }
    if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return new TextDecoder('utf-8').decode(bytes.subarray(3));
    if (bytes[0] === 0xFF && bytes[1] === 0xFE) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    if (bytes[0] === 0xFE && bytes[1] === 0xFF) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { /* não é UTF-8 */ }
    try { return new TextDecoder(fallback).decode(bytes); } catch (e) { return new TextDecoder('windows-1252').decode(bytes); }
  };

  U.readFileText = async function (file, encoding) {
    const buf = await file.arrayBuffer();
    return U.decodeText(buf, encoding);
  };

  /* ---------- Carregamento de scripts sob demanda ---------- */
  const scriptCache = {};
  U.loadScript = function (src) {
    if (!scriptCache[src]) {
      scriptCache[src] = new Promise((resolve, reject) => {
        const s = U.el('script', { src });
        s.onload = () => resolve();
        s.onerror = () => { delete scriptCache[src]; reject(new Error('Falha ao carregar ' + src)); };
        document.head.appendChild(s);
      });
    }
    return scriptCache[src];
  };

  /* ---------- Armazenamento local seguro ---------- */
  U.store = {
    get(key, def) {
      try {
        const v = localStorage.getItem('vlcweb:' + key);
        return v === null ? def : JSON.parse(v);
      } catch (e) { return def; }
    },
    set(key, value) {
      try { localStorage.setItem('vlcweb:' + key, JSON.stringify(value)); return true; } catch (e) { return false; }
    },
    remove(key) { try { localStorage.removeItem('vlcweb:' + key); } catch (e) { /* ignora */ } }
  };

  /* ---------- Emissor de eventos simples ---------- */
  class Emitter {
    constructor() { this._ev = Object.create(null); }
    on(name, fn) { (this._ev[name] || (this._ev[name] = [])).push(fn); return () => this.off(name, fn); }
    off(name, fn) { const l = this._ev[name]; if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } }
    once(name, fn) { const off = this.on(name, (...a) => { off(); fn(...a); }); return off; }
    emit(name, ...args) {
      const l = this._ev[name];
      if (!l) return;
      for (const fn of l.slice()) {
        try { fn(...args); } catch (e) { console.error('[evento ' + name + ']', e); }
      }
    }
  }
  U.Emitter = Emitter;

  /** Lê o conteúdo de uma pasta (FileSystemDirectoryHandle) recursivamente. */
  U.walkDirectoryHandle = async function (dir, path = '', out = [], depth = 0) {
    if (depth > 12) return out;
    for await (const entry of dir.values()) {
      if (entry.kind === 'file') {
        try {
          const file = await entry.getFile();
          out.push({ file, handle: entry, path: path + entry.name });
        } catch (e) { /* sem permissão */ }
      } else if (entry.kind === 'directory') {
        await U.walkDirectoryHandle(entry, path + entry.name + '/', out, depth + 1);
      }
    }
    return out;
  };

  /** Lê entradas arrastadas (DataTransferItem.webkitGetAsEntry) recursivamente. */
  U.readDropEntries = async function (dataTransfer) {
    const out = [];
    const items = Array.from(dataTransfer.items || []);
    const entries = items.map(i => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean);
    if (!entries.length) {
      return Array.from(dataTransfer.files || []).map(f => ({ file: f, path: f.name }));
    }
    const readEntry = (entry, path) => new Promise(resolve => {
      if (entry.isFile) {
        entry.file(f => { out.push({ file: f, path: path + f.name }); resolve(); }, () => resolve());
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        const all = [];
        const readBatch = () => reader.readEntries(async batch => {
          if (!batch.length) {
            for (const e of all) await readEntry(e, path + entry.name + '/');
            resolve();
          } else { all.push(...batch); readBatch(); }
        }, () => resolve());
        readBatch();
      } else resolve();
    });
    for (const e of entries) await readEntry(e, '');
    return out;
  };

  /** Verifica suporte a recursos do navegador */
  U.supports = {
    webgl: (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl') || c.getContext('experimental-webgl')); } catch (e) { return false; } })(),
    webAudio: !!(window.AudioContext || window.webkitAudioContext),
    audioWorklet: !!(window.AudioWorkletNode && window.isSecureContext),
    mediaRecorder: !!window.MediaRecorder,
    mse: !!(window.MediaSource || window.ManagedMediaSource),
    pip: !!document.pictureInPictureEnabled,
    docPip: 'documentPictureInPicture' in window,
    fsAccess: 'showOpenFilePicker' in window,
    dirPicker: 'showDirectoryPicker' in window,
    displayMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia),
    userMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
    remotePlayback: 'remote' in HTMLMediaElement.prototype,
    rvfc: 'requestVideoFrameCallback' in HTMLVideoElement.prototype,
    sinkId: 'setSinkId' in HTMLMediaElement.prototype,
    ctxSinkId: !!(window.AudioContext && 'setSinkId' in AudioContext.prototype),
    webrtc: !!window.RTCPeerConnection,
    broadcast: !!window.BroadcastChannel,
    clipboardRead: !!(navigator.clipboard && navigator.clipboard.readText),
    indexedDB: !!window.indexedDB,
    mediaSession: 'mediaSession' in navigator,
    worker: !!window.Worker && location.protocol !== 'file:'
  };

  VW.util = U;
})(window.VW = window.VW || {});
