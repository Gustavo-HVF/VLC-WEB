/* VLC Web — lista de reprodução (modelo) e formatos M3U/M3U8, PLS, XSPF, ASX, WPL, CUE e HTML */
(function (VW) {
  'use strict';
  const U = VW.util;

  let counter = 0;

  class PlaylistItem {
    constructor(o) {
      this.id = 'it' + (++counter) + '-' + Date.now().toString(36);
      this.title = o.title || '';
      this.file = o.file || null;          // File local
      this.handle = o.handle || null;      // FileSystemFileHandle (persistível)
      this.url = o.url || '';              // URL de rede
      this.stream = o.stream || null;      // MediaStream (captura)
      this.streamLabel = o.streamLabel || '';
      this.kind = o.kind || (this.stream ? 'stream' : U.kindOf(o.file ? o.file.name : o.url, o.file && o.file.type) || (o.url ? U.kindOf(U.urlFileName(o.url)) : null) || 'video');
      this.duration = isFinite(o.duration) ? o.duration : NaN;
      this.meta = o.meta || {};            // tags (title, artist, album...)
      this.subs = o.subs || [];            // Files de legenda associados
      this.extraAudio = o.extraAudio || null;
      this.startTime = o.startTime || 0;
      this.stopTime = o.stopTime || 0;
      this.missing = !!o.missing;          // item de playlist sem arquivo disponível
      this.path = o.path || '';
      this.playable = null;                // Blob convertido pelo FFmpeg
      this.info = null;                    // resultado de VW.metadata.read
      this.probe = null;                   // resultado do FFmpeg
      this.audioIndex = null;
      this.autoTitle = !this.title;        // título derivado do nome do arquivo/URL (pode ser refinado)
      if (!this.title) this.title = this.defaultTitle();
    }
    defaultTitle() {
      if (this.stream) return this.streamLabel || 'Dispositivo de captura';
      if (this.file) return U.stripExt(this.file.name);
      if (this.url) {
        try {
          const u = new URL(this.url);
          const b = U.urlFileName(this.url);
          return (b && U.stripExt(b)) || b || u.host;
        } catch (e) { return this.url; }
      }
      return 'Sem título';
    }
    get name() { return this.file ? this.file.name : this.url ? (this.remoteName || U.urlFileName(this.url) || this.url) : this.title; }
    get uri() { return this.url || (this.file ? (this.path || this.file.name) : this.stream ? 'capture://' + (this.streamLabel || 'device') : ''); }
    get key() {
      if (this.url) return 'u:' + this.url;
      if (this.file) return `f:${this.file.name}:${this.file.size}:${this.file.lastModified}`;
      return 'x:' + this.id;
    }
    get displayTitle() {
      const m = this.meta;
      return m.title ? (m.artist ? `${m.artist} - ${m.title}` : m.title) : this.title;
    }
  }

  class Playlist extends U.Emitter {
    constructor() {
      super();
      this.items = [];
      this.index = -1;
      this.shuffle = false;
      this.loop = 'none';           // none | all | one
      this.history = [];
      this.played = new Set();
    }

    get current() { return this.items[this.index] || null; }
    indexOf(id) { return this.items.findIndex(i => i.id === id); }
    get(id) { return this.items.find(i => i.id === id) || null; }

    add(list, at) {
      const items = list.map(o => o instanceof PlaylistItem ? o : new PlaylistItem(o));
      if (at === undefined || at < 0 || at > this.items.length) at = this.items.length;
      this.items.splice(at, 0, ...items);
      if (this.index >= at && this.index >= 0 && at <= this.index) this.index += items.length;
      this.emit('change');
      return items;
    }

    remove(ids) {
      const set = new Set(ids);
      const cur = this.current;
      this.items = this.items.filter(i => !set.has(i.id));
      this.index = cur ? this.items.indexOf(cur) : -1;
      for (const id of set) this.played.delete(id);
      this.emit('change');
      return cur && set.has(cur.id);
    }

    clear() {
      this.items = [];
      this.index = -1;
      this.history = [];
      this.played.clear();
      this.emit('change');
    }

    move(ids, toIndex) {
      const set = new Set(ids);
      const cur = this.current;
      const moving = this.items.filter(i => set.has(i.id));
      const before = this.items.slice(0, toIndex).filter(i => !set.has(i.id)).length;
      const rest = this.items.filter(i => !set.has(i.id));
      rest.splice(before, 0, ...moving);
      this.items = rest;
      this.index = cur ? this.items.indexOf(cur) : -1;
      this.emit('change');
    }

    sort(field, dir = 1) {
      const cur = this.current;
      const val = i => {
        switch (field) {
          case 'title': return i.displayTitle.toLowerCase();
          case 'duration': return isFinite(i.duration) ? i.duration : Infinity;
          case 'artist': return (i.meta.artist || '').toLowerCase();
          case 'album': return (i.meta.album || '').toLowerCase();
          case 'genre': return (i.meta.genre || '').toLowerCase();
          case 'track': return parseInt(i.meta.track) || 0;
          case 'date': return i.meta.date || '';
          case 'uri': return i.uri.toLowerCase();
          case 'random': return Math.random();
          default: return i.title;
        }
      };
      this.items.sort((a, b) => {
        const x = val(a), y = val(b);
        return (typeof x === 'number' && typeof y === 'number' ? x - y : U.naturalCompare(x, y)) * dir;
      });
      this.index = cur ? this.items.indexOf(cur) : -1;
      this.emit('change');
    }

    setIndex(i) {
      if (this.index >= 0 && this.index !== i) this.history.push(this.index);
      if (this.history.length > 500) this.history.shift();
      this.index = i;
      const c = this.current;
      if (c) this.played.add(c.id);
      this.emit('current', c);
    }

    /** Próximo índice. auto=true quando chamado ao fim da mídia. */
    nextIndex(auto) {
      const n = this.items.length;
      if (!n) return -1;
      if (auto && this.loop === 'one' && this.index >= 0) return this.index;
      if (this.shuffle) {
        let pool = this.items.map((it, i) => i).filter(i => !this.played.has(this.items[i].id) && i !== this.index);
        if (!pool.length) {
          if (this.loop === 'none' && auto) return -1;
          this.played.clear();
          pool = this.items.map((it, i) => i).filter(i => i !== this.index);
          if (!pool.length) pool = [this.index];
        }
        return pool[Math.floor(Math.random() * pool.length)];
      }
      if (this.index + 1 < n) return this.index + 1;
      return this.loop === 'all' || (!auto && this.loop === 'one') ? 0 : -1;
    }

    prevIndex() {
      if (this.shuffle && this.history.length) return this.history.pop();
      if (this.index > 0) return this.index - 1;
      return this.loop === 'all' ? this.items.length - 1 : 0;
    }

    totalDuration() { return this.items.reduce((a, i) => a + (isFinite(i.duration) ? i.duration : 0), 0); }
  }

  /* ======================= Formatos ======================= */
  function parseM3U(text) {
    const out = [];
    let pending = {};
    for (let line of text.replace(/\r/g, '').split('\n')) {
      line = line.trim();
      if (!line) continue;
      if (line.startsWith('#EXTINF:')) {
        const m = line.match(/^#EXTINF:\s*(-?[\d.]+)[^,]*,(.*)$/);
        if (m) { pending.duration = +m[1] > 0 ? +m[1] : NaN; pending.title = m[2].trim(); }
        const logo = line.match(/tvg-logo="([^"]+)"/); if (logo) pending.logo = logo[1];
        continue;
      }
      if (line.startsWith('#EXTVLCOPT:')) {
        const o = line.slice(11);
        let m;
        if ((m = o.match(/^start-time=([\d.]+)/))) pending.startTime = +m[1];
        if ((m = o.match(/^stop-time=([\d.]+)/))) pending.stopTime = +m[1];
        continue;
      }
      if (line.startsWith('#')) continue;
      out.push(Object.assign({ location: line }, pending));
      pending = {};
    }
    return out;
  }

  function parsePLS(text) {
    const map = {};
    for (const l of text.replace(/\r/g, '').split('\n')) {
      const m = l.match(/^(File|Title|Length)(\d+)\s*=\s*(.*)$/i);
      if (m) { const i = +m[2]; (map[i] = map[i] || {})[m[1].toLowerCase()] = m[3].trim(); }
    }
    return Object.keys(map).sort((a, b) => a - b).map(k => ({ location: map[k].file, title: map[k].title, duration: +map[k].length > 0 ? +map[k].length : NaN })).filter(e => e.location);
  }

  function parseXML(text, kind) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const out = [];
    const q = (el, tag) => { const n = el.getElementsByTagName(tag)[0]; return n ? n.textContent.trim() : ''; };
    if (kind === 'xspf') {
      for (const t of Array.from(doc.getElementsByTagName('track'))) {
        const loc = q(t, 'location');
        if (!loc) continue;
        const dur = +q(t, 'duration');
        out.push({ location: loc, title: q(t, 'title'), duration: dur > 0 ? dur / 1000 : NaN, meta: { artist: q(t, 'creator'), album: q(t, 'album'), track: q(t, 'trackNum'), description: q(t, 'annotation') } });
      }
    } else if (kind === 'asx') {
      for (const e of Array.from(doc.getElementsByTagName('*')).filter(n => n.nodeName.toLowerCase() === 'entry')) {
        const ref = Array.from(e.getElementsByTagName('*')).find(n => n.nodeName.toLowerCase() === 'ref');
        const href = ref && (ref.getAttribute('href') || ref.getAttribute('HREF'));
        const title = Array.from(e.getElementsByTagName('*')).find(n => n.nodeName.toLowerCase() === 'title');
        if (href) out.push({ location: href, title: title ? title.textContent.trim() : '' });
      }
    } else if (kind === 'wpl') {
      for (const m of Array.from(doc.getElementsByTagName('media'))) { const s = m.getAttribute('src'); if (s) out.push({ location: s }); }
    }
    return out;
  }

  function parseCUE(text) {
    const out = [];
    let file = '', cur = null, performer = '', album = '';
    for (const raw of text.replace(/\r/g, '').split('\n')) {
      const l = raw.trim();
      let m;
      if ((m = l.match(/^FILE\s+"?(.+?)"?\s+\w+$/i))) file = m[1];
      else if ((m = l.match(/^TRACK\s+(\d+)/i))) { cur = { location: file, track: +m[1], meta: { album, artist: performer, track: m[1] } }; out.push(cur); }
      else if ((m = l.match(/^TITLE\s+"?(.*?)"?$/i))) { if (cur) cur.title = m[1]; else album = m[1]; }
      else if ((m = l.match(/^PERFORMER\s+"?(.*?)"?$/i))) { if (cur) cur.meta.artist = m[1]; else performer = m[1]; }
      else if ((m = l.match(/^INDEX\s+01\s+(\d+):(\d+):(\d+)/i)) && cur) cur.startTime = +m[1] * 60 + +m[2] + +m[3] / 75;
    }
    for (let i = 0; i < out.length; i++) {
      if (out[i + 1] && out[i + 1].location === out[i].location) out[i].stopTime = out[i + 1].startTime;
      out[i].meta.album = out[i].meta.album || album;
    }
    return out;
  }

  /** Detecta o formato e retorna entradas { location, title, duration, ... } */
  function parse(text, name) {
    const ext = U.ext(name);
    const head = text.slice(0, 500).toLowerCase();
    if (ext === 'pls' || head.includes('[playlist]')) return parsePLS(text);
    if (ext === 'xspf' || head.includes('<playlist') && head.includes('xspf')) return parseXML(text, 'xspf');
    if (ext === 'asx' || head.includes('<asx')) return parseXML(text, 'asx');
    if (ext === 'wpl' || head.includes('<smil')) return parseXML(text, 'wpl');
    if (ext === 'cue' || /^\s*(rem|performer|title|file)\s/im.test(head) && /track\s+\d+\s+audio/i.test(text)) return parseCUE(text);
    return parseM3U(text);
  }

  function isHlsManifest(text) { return /#EXT-X-(TARGETDURATION|STREAM-INF|MEDIA-SEQUENCE)/.test(text); }

  const xmlEsc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function serialize(items, format, title = 'Lista de reprodução') {
    const loc = i => i.url || (i.path || i.name);
    switch (format) {
      case 'xspf':
        return `<?xml version="1.0" encoding="UTF-8"?>\n<playlist xmlns="http://xspf.org/ns/0/" xmlns:vlc="http://www.videolan.org/vlc/playlist/ns/0/" version="1">\n\t<title>${xmlEsc(title)}</title>\n\t<trackList>\n` +
          items.map((i, n) => `\t\t<track>\n\t\t\t<location>${xmlEsc(i.url || encodeURI(loc(i)))}</location>\n\t\t\t<title>${xmlEsc(i.meta.title || i.title)}</title>\n` +
            (i.meta.artist ? `\t\t\t<creator>${xmlEsc(i.meta.artist)}</creator>\n` : '') + (i.meta.album ? `\t\t\t<album>${xmlEsc(i.meta.album)}</album>\n` : '') +
            (isFinite(i.duration) ? `\t\t\t<duration>${Math.round(i.duration * 1000)}</duration>\n` : '') +
            `\t\t\t<extension application="http://www.videolan.org/vlc/playlist/0">\n\t\t\t\t<vlc:id>${n}</vlc:id>\n\t\t\t</extension>\n\t\t</track>\n`).join('') +
          `\t</trackList>\n</playlist>\n`;
      case 'pls':
        return '[playlist]\n' + items.map((i, n) => `File${n + 1}=${loc(i)}\nTitle${n + 1}=${i.displayTitle}\nLength${n + 1}=${isFinite(i.duration) ? Math.round(i.duration) : -1}`).join('\n') + `\nNumberOfEntries=${items.length}\nVersion=2\n`;
      case 'html':
        return `<!DOCTYPE html>\n<html lang="pt-BR"><head><meta charset="utf-8"><title>${xmlEsc(title)}</title><style>body{font-family:system-ui,sans-serif;margin:2rem}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:.4rem;text-align:left}th{background:#ff8800;color:#fff}</style></head><body>\n<h1>${xmlEsc(title)}</h1>\n<table><thead><tr><th>#</th><th>Título</th><th>Artista</th><th>Duração</th></tr></thead><tbody>\n` +
          items.map((i, n) => `<tr><td>${n + 1}</td><td>${xmlEsc(i.meta.title || i.title)}</td><td>${xmlEsc(i.meta.artist || '')}</td><td>${U.fmtTime(i.duration)}</td></tr>`).join('\n') +
          `\n</tbody></table>\n<p>${items.length} itens — ${U.fmtTime(items.reduce((a, i) => a + (isFinite(i.duration) ? i.duration : 0), 0))}</p>\n</body></html>\n`;
      default:
        return '#EXTM3U\n' + items.map(i => `#EXTINF:${isFinite(i.duration) ? Math.round(i.duration) : -1},${i.displayTitle}\n` +
          (i.startTime ? `#EXTVLCOPT:start-time=${i.startTime}\n` : '') + (i.stopTime ? `#EXTVLCOPT:stop-time=${i.stopTime}\n` : '') + loc(i)).join('\n') + '\n';
    }
  }

  VW.PlaylistItem = PlaylistItem;
  VW.Playlist = Playlist;
  VW.playlistFormats = { parse, serialize, isHlsManifest };
})(window.VW = window.VW || {});
