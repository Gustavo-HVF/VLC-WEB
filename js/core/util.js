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

  /* ---------- Idiomas e canais (rótulos de faixas) ---------- */
  const LANG3 = { por: 'pt', pob: 'pt-BR', eng: 'en', spa: 'es', fre: 'fr', fra: 'fr', ger: 'de', deu: 'de', ita: 'it', jpn: 'ja', kor: 'ko', chi: 'zh', zho: 'zh',
    rus: 'ru', ara: 'ar', hin: 'hi', dut: 'nl', nld: 'nl', pol: 'pl', tur: 'tr', swe: 'sv', nor: 'no', nob: 'nb', dan: 'da', fin: 'fi', gre: 'el', ell: 'el',
    heb: 'he', hun: 'hu', cze: 'cs', ces: 'cs', rum: 'ro', ron: 'ro', tha: 'th', vie: 'vi', ind: 'id', ukr: 'uk', cat: 'ca', may: 'ms', msa: 'ms',
    per: 'fa', fas: 'fa', hrv: 'hr', srp: 'sr', slo: 'sk', slk: 'sk', slv: 'sl', bul: 'bg', lit: 'lt', lav: 'lv', est: 'et', ice: 'is', isl: 'is',
    tam: 'ta', tel: 'te', ben: 'bn', urd: 'ur', fil: 'fil', tgl: 'tl', glg: 'gl', baq: 'eu', eus: 'eu', lat: 'la' };
  let langNames = null;
  /** "por" / "pt-BR" / "eng" → "Português" / "Português (Brasil)" / "Inglês" ('' se indefinido) */
  U.langName = function (code) {
    const c = String(code || '').trim().replace('_', '-');
    const low = c.toLowerCase();
    if (!c || ['und', 'mul', 'zxx', 'mis', 'unk', 'unknown'].includes(low)) return '';
    const tag = LANG3[low] || c;
    try {
      langNames = langNames || new Intl.DisplayNames(['pt-BR'], { type: 'language' });
      const n = langNames.of(tag);
      if (n && n.toLowerCase() !== tag.toLowerCase()) return n.charAt(0).toUpperCase() + n.slice(1);
    } catch (e) { /* código inválido */ }
    return c;
  };
  /** 2 → "estéreo", 6 → "5.1", "5.1(side)" → "5.1" */
  U.channelsLabel = function (ch) {
    if (ch == null || ch === '') return '';
    if (typeof ch === 'string') {
      const s = ch.toLowerCase();
      if (s === 'stereo') return 'estéreo';
      if (s === 'mono') return 'mono';
      const m = s.match(/^(\d+\.\d)/); if (m) return m[1];
      const n = s.match(/^(\d+) channels?/); if (n) return U.channelsLabel(+n[1]);
      return ch;
    }
    return ({ 1: 'mono', 2: 'estéreo', 3: '2.1', 6: '5.1', 7: '6.1', 8: '7.1' })[ch] || (ch + ' canais');
  };
  const CODEC_NAMES = { aac: 'AAC', eac3: 'E‑AC‑3', ac3: 'AC‑3', dts: 'DTS', truehd: 'TrueHD', mp3: 'MP3', mp2: 'MP2', opus: 'Opus', vorbis: 'Vorbis', flac: 'FLAC', alac: 'ALAC', pcm_s16le: 'PCM', pcm_s24le: 'PCM' };
  U.codecName = c => CODEC_NAMES[String(c || '').toLowerCase()] || String(c || '').replace(/^Dolby Digital Plus \((E-AC-3)\)$/, 'E‑AC‑3').replace(/^Dolby Digital \((AC-3)\)$/, 'AC‑3');

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

  /** Limpa um endereço colado (espaços, aspas, <>, quebras de linha) */
  U.cleanUrl = function (s) {
    s = String(s || '').trim().split(/\r?\n/)[0].trim();
    for (let i = 0; i < 3; i++) {
      const m = s.match(/^["'“”‘’«<\[(](.*)["'“”‘’»>\])]$/);
      if (!m) break;
      s = m[1].trim();
    }
    return s.replace(/^["'“”‘’<]+|["'“”‘’>]+$/g, '').replace(/ /g, '%20');
  };

  /* ---------- Rede pelo celular (Termux-Toons) ----------
   * Quando o VLC Web é servido pelo "navegador pelo celular" do Termux-Toons, a página recebe
   * window.TERMUX_TOONS. Os endereços de rede (vídeos, rádios, podcasts, legendas) passam então a ser
   * carregados pela conexão do celular, por links /m/<assinatura>/<esquema>/<site>/... do mesmo endereço
   * da página: sem bloqueio de CORS, com avanço por Range e com todos os efeitos.
   * A assinatura vale por site, então um pedido ao servidor basta para todos os links daquele site. */
  U.phone = (typeof window !== 'undefined' && window.TERMUX_TOONS && typeof window.TERMUX_TOONS.assinar === 'string') ? window.TERMUX_TOONS : null;
  const phonePrefixes = new Map();   // "https://site" → "http://celular:8101/m/<assinatura>/https/site"
  U.needsPhone = function (url) {
    if (!U.phone || !url) return false;
    try {
      const u = new URL(url, location.href);
      return /^https?:$/.test(u.protocol) && u.origin !== location.origin;
    } catch (e) { return false; }
  };
  U.viaPhone = async function (url) {
    if (!U.needsPhone(url)) return url;
    const u = new URL(url, location.href);
    const rest = u.pathname + u.search + u.hash;
    const known = phonePrefixes.get(u.origin);
    if (known) return known + rest;
    try {
      const res = await fetch(U.phone.assinar + encodeURIComponent(u.href), { credentials: 'same-origin', cache: 'no-store' });
      const j = await res.json();
      if (!j.url) return url;
      const m = /^(.*\/m\/[0-9a-f]+\/https?\/[^/]+)/.exec(j.url);
      if (m) phonePrefixes.set(u.origin, m[1]);
      return j.url;
    } catch (e) { return url; }
  };
  U.phoneFetch = async function (url, opts) { return fetch(await U.viaPhone(url), opts); };

  /** Nome do arquivo de um "filename" de Content-Disposition */
  U.dispositionName = function (h) {
    if (!h) return '';
    let m = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(h);
    if (m) { try { return decodeURIComponent(m[2].trim().replace(/^"|"$/g, '')); } catch (e) { /* segue */ } }
    m = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(h);
    if (!m) return '';
    const v = (m[2] ?? m[1]).trim();
    try { return decodeURIComponent(escape(v)); } catch (e) { return v; }
  };

  /**
   * Nome do arquivo de uma URL. Links de download costumam trazer o nome real em parâmetros
   * (?filename=…, ?file=…, response-content-disposition=…) e um identificador no caminho.
   */
  U.urlFileName = function (url) {
    let u;
    try { u = new URL(url, location.href); } catch (e) { return U.baseName(url); }
    const q = u.searchParams;
    const disp = q.get('response-content-disposition') || q.get('rscd');
    if (disp) { const n = U.dispositionName(disp); if (n) return U.baseName(n); }
    for (const k of ['filename', 'file_name', 'fileName', 'file', 'name', 'fn', 'title', 'dl', 'download']) {
      const v = q.get(k);
      if (v && v.length < 300 && /[^\s]/.test(v) && !/^(1|0|true|false)$/i.test(v)) {
        const n = U.baseName(v);
        if (n && (U.ext(n) || k !== 'dl' && k !== 'download')) return n;
      }
    }
    return U.baseName(u.pathname) || u.host;
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

  /* ---------- Arquivos compactados ---------- */
  U.isZip = b => b && b[0] === 0x50 && b[1] === 0x4B && (b[2] === 0x03 || b[2] === 0x05);
  U.isRar = b => b && b[0] === 0x52 && b[1] === 0x61 && b[2] === 0x72 && b[3] === 0x21;
  U.is7z = b => b && b[0] === 0x37 && b[1] === 0x7A && b[2] === 0xBC && b[3] === 0xAF;

  /**
   * Leitor de ZIP mínimo (armazenado ou "deflate"), usado para legendas baixadas compactadas.
   * Retorna [{ name, size, data(): Promise<Uint8Array> }].
   */
  U.unzip = async function (blob) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Arquivo ZIP inválido ou corrompido');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = [];
    for (let i = 0; i < count && p + 46 <= buf.length; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = U.decodeText(buf.subarray(p + 46, p + 46 + nlen), (flags & 0x800) ? 'utf-8' : 'auto');
      p += 46 + nlen + xlen + clen;
      if (name.endsWith('/')) continue;
      entries.push({
        name, size: usize, encrypted: !!(flags & 1),
        async data() {
          if (flags & 1) throw new Error('ZIP protegido por senha');
          const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
          const raw = buf.subarray(start, start + csize);
          if (method === 0) return raw;
          if (method !== 8) throw new Error('Método de compressão ZIP não suportado (' + method + ')');
          if (!window.DecompressionStream) throw new Error('Este navegador não consegue descompactar ZIP');
          const out = await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
          return new Uint8Array(out);
        }
      });
    }
    return entries;
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
