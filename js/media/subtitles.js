/* VLC Web — legendas: leitores (SRT, WebVTT, ASS/SSA, MicroDVD, SubViewer, SBV, MPL2, LRC, SAMI, TTML/DFXP)
 * e renderizador próprio (permite atraso, velocidade, estilo e posição como no VLC). */
(function (VW) {
  'use strict';
  const U = VW.util;

  /* ---------------- utilitários de tempo ---------------- */
  function ts(str) {
    // aceita 00:00:01,000 | 00:01.000 | 0:00:01.00 | 01:02:03:12 (quadro ignorado)
    str = String(str).trim().replace(',', '.');
    const parts = str.split(':');
    let sec = 0;
    for (const p of parts) sec = sec * 60 + parseFloat(p || 0);
    return sec;
  }

  /* ---------------- sanitização / marcação ---------------- */
  const safeColor = c => (/^#[0-9a-f]{3,8}$/i.test(c) || /^[a-z]{3,20}$/i.test(c)) ? c : null;

  function sanitize(s) {
    let out = '', last = 0, m;
    const re = /<(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g;
    while ((m = re.exec(s))) {
      out += U.escapeHtml(s.slice(last, m.index));
      last = re.lastIndex;
      const close = !!m[1], tag = m[2].toLowerCase(), attrs = m[3] || '';
      if (tag === 'br') out += '<br>';
      else if (['i', 'b', 'u', 's', 'ruby', 'rt'].includes(tag)) out += close ? `</${tag}>` : `<${tag}>`;
      else if (tag === 'font') {
        if (close) out += '</span>';
        else {
          const cm = attrs.match(/color\s*=\s*["']?([#\w]+)/i);
          const col = cm && safeColor(cm[1]);
          out += col ? `<span style="color:${col}">` : '<span>';
        }
      } else if (tag === 'c' || tag === 'v' || tag === 'span' || tag === 'lang') {
        out += close ? '</span>' : '<span>';
      }
    }
    out += U.escapeHtml(s.slice(last));
    return out.replace(/\r?\n/g, '<br>');
  }

  function assColor(v) {
    const m = String(v).match(/&?H?([0-9A-Fa-f]{2})?([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})&?/);
    if (!m) return null;
    return '#' + m[4] + m[3] + m[2];
  }

  /** Converte o texto de um evento ASS em pseudo‑HTML e extrai alinhamento. */
  function assToHtml(text) {
    let align = null, out = '', openColor = false;
    if (/\\p[1-9]/.test(text)) return { html: '', align };
    const re = /\{([^}]*)\}/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      out += text.slice(last, m.index);
      last = re.lastIndex;
      const tags = m[1];
      const an = tags.match(/\\an([1-9])/);
      if (an) align = +an[1];
      const a = tags.match(/\\a(\d+)/);
      if (a && !an) { const v = +a[1]; align = v <= 3 ? v : v >= 9 ? v - 5 : v >= 5 ? v + 2 : 2; }
      for (const t of tags.split('\\')) {
        if (/^i1$/.test(t)) out += '<i>'; else if (/^i0$/.test(t)) out += '</i>';
        else if (/^b(1|[5-9]00)$/.test(t)) out += '<b>'; else if (/^b0$/.test(t)) out += '</b>';
        else if (/^u1$/.test(t)) out += '<u>'; else if (/^u0$/.test(t)) out += '</u>';
        else if (/^s1$/.test(t)) out += '<s>'; else if (/^s0$/.test(t)) out += '</s>';
        else if (/^1?c&?H/i.test(t)) {
          const col = assColor(t.replace(/^1?c/i, ''));
          if (openColor) out += '</font>';
          if (col) { out += `<font color="${col}">`; openColor = true; } else openColor = false;
        } else if (t === 'r') { if (openColor) { out += '</font>'; openColor = false; } }
      }
    }
    out += text.slice(last);
    if (openColor) out += '</font>';
    out = out.replace(/\\N/g, '<br>').replace(/\\n/g, '<br>').replace(/\\h/g, ' ');
    return { html: sanitize(out), align };
  }

  function srtLike(text) {
    let align = null;
    const an = text.match(/\{\\an([1-9])\}/);
    if (an) align = +an[1];
    text = text.replace(/\{\\[^}]*\}/g, '');
    return { html: sanitize(text.trim()), align };
  }

  function mkCue(start, end, text, kind) {
    const r = kind === 'ass' ? assToHtml(text) : srtLike(text);
    return { start, end, html: r.html, align: r.align };
  }

  /* ---------------- leitores ---------------- */
  function parseSRT(text) {
    const cues = [];
    const blocks = text.replace(/\r/g, '').split(/\n\s*\n/);
    for (const b of blocks) {
      const lines = b.split('\n').filter(l => l.trim() !== '' || false);
      const i = lines.findIndex(l => l.includes('-->'));
      if (i < 0) continue;
      const m = lines[i].match(/([\d:.,]+)\s*-->\s*([\d:.,]+)/);
      if (!m) continue;
      const body = lines.slice(i + 1).join('\n');
      cues.push(mkCue(ts(m[1]), ts(m[2]), body, 'srt'));
    }
    return cues;
  }

  function parseVTT(text) {
    const cues = [];
    const blocks = text.replace(/\r/g, '').split(/\n\s*\n/);
    for (const b of blocks) {
      if (/^(WEBVTT|NOTE|STYLE|REGION)/.test(b.trim())) {
        if (!b.includes('-->')) continue;
      }
      const lines = b.split('\n');
      const i = lines.findIndex(l => l.includes('-->'));
      if (i < 0) continue;
      const m = lines[i].match(/([\d:.]+)\s*-->\s*([\d:.]+)(.*)$/);
      if (!m) continue;
      const cue = mkCue(ts(m[1]), ts(m[2]), lines.slice(i + 1).join('\n'), 'vtt');
      const settings = m[3] || '';
      const line = settings.match(/line:(-?[\d.]+)(%?)/);
      const pos = settings.match(/align:(start|left|end|right|center|middle)/);
      let v = 2, h = 0;
      if (line) {
        const val = parseFloat(line[1]);
        const pct = line[2] === '%' ? val : (val >= 0 ? val * 6 : 100 + val * 6);
        v = pct < 33 ? 8 : pct < 66 ? 5 : 2;
      }
      if (pos) h = /start|left/.test(pos[1]) ? -1 : /end|right/.test(pos[1]) ? 1 : 0;
      if (line || pos) cue.align = cue.align || (v + h);
      cues.push(cue);
    }
    return cues;
  }

  function parseASS(text) {
    const cues = [];
    const styles = {};
    let section = '', fmt = null, styleFmt = null;
    for (const raw of text.replace(/\r/g, '').split('\n')) {
      const line = raw.trim();
      if (/^\[.*\]$/.test(line)) { section = line.toLowerCase(); continue; }
      if (section.includes('styles')) {
        if (line.startsWith('Format:')) styleFmt = line.slice(7).split(',').map(s => s.trim().toLowerCase());
        else if (line.startsWith('Style:') && styleFmt) {
          const f = line.slice(6).split(',').map(s => s.trim());
          const st = {};
          styleFmt.forEach((k, i) => { st[k] = f[i]; });
          let al = +st.alignment || 2;
          if (section.includes('v4 styles') && !section.includes('v4+')) al = al <= 3 ? al : al >= 9 ? al - 5 : al >= 5 ? al + 2 : 2;
          styles[st.name] = { align: al, italic: st.italic && st.italic !== '0', bold: st.bold && st.bold !== '0', color: assColor(st.primarycolour || '') };
        }
      } else if (section.includes('events')) {
        if (line.startsWith('Format:')) fmt = line.slice(7).split(',').map(s => s.trim().toLowerCase());
        else if (line.startsWith('Dialogue:') && fmt) {
          const body = line.slice(9);
          const parts = [];
          let rest = body;
          for (let i = 0; i < fmt.length - 1; i++) {
            const c = rest.indexOf(',');
            parts.push(rest.slice(0, c).trim());
            rest = rest.slice(c + 1);
          }
          parts.push(rest);
          const ev = {};
          fmt.forEach((k, i) => { ev[k] = parts[i]; });
          const cue = mkCue(ts(ev.start), ts(ev.end), ev.text || '', 'ass');
          if (!cue.html) continue;
          const st = styles[ev.style] || styles[(ev.style || '').replace(/^\*/, '')];
          if (st) {
            if (!cue.align) cue.align = st.align;
            let h = cue.html;
            if (st.italic) h = '<i>' + h + '</i>';
            if (st.bold) h = '<b>' + h + '</b>';
            if (st.color && st.color.toLowerCase() !== '#ffffff') h = `<span style="color:${st.color}">${h}</span>`;
            cue.html = h;
          }
          cue.layer = +ev.layer || 0;
          cues.push(cue);
        }
      }
    }
    return cues;
  }

  function parseMicroDVD(text, fps) {
    const lines = text.replace(/\r/g, '').split('\n');
    const cues = [];
    let rate = fps || 23.976;
    for (const l of lines) {
      const m = l.match(/^\{(\d+)\}\{(\d*)\}(.*)$/);
      if (!m) continue;
      if (+m[1] === 1 && +m[2] === 1 && /^[\d.]+$/.test(m[3].trim())) { rate = parseFloat(m[3]); continue; }
      let body = m[3];
      let italic = /\{y:i\}/i.test(body);
      body = body.replace(/\{[^}]*\}/g, '');
      body = body.split('|').map(x => x.startsWith('/') ? '<i>' + x.slice(1) + '</i>' : x).join('\n');
      if (italic) body = '<i>' + body + '</i>';
      const start = +m[1] / rate;
      const end = m[2] ? +m[2] / rate : start + 3;
      cues.push(mkCue(start, end, body, 'srt'));
    }
    return cues;
  }

  function parseSubViewer(text) {
    const cues = [];
    const lines = text.replace(/\r/g, '').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(\d+:\d+:\d+[.,]\d+)\s*,\s*(\d+:\d+:\d+[.,]\d+)\s*$/);
      if (!m) continue;
      const body = [];
      while (i + 1 < lines.length && lines[i + 1].trim() !== '') body.push(lines[++i]);
      cues.push(mkCue(ts(m[1]), ts(m[2]), body.join('\n').replace(/\[br\]/gi, '\n'), 'srt'));
    }
    return cues;
  }

  function parseMPL2(text) {
    const cues = [];
    for (const l of text.replace(/\r/g, '').split('\n')) {
      const m = l.match(/^\[(\d+)\]\[(\d*)\](.*)$/);
      if (!m) continue;
      const body = m[3].split('|').map(x => x.startsWith('/') ? '<i>' + x.slice(1) + '</i>' : x).join('\n');
      cues.push(mkCue(+m[1] / 10, m[2] ? +m[2] / 10 : +m[1] / 10 + 3, body, 'srt'));
    }
    return cues;
  }

  function parseLRC(text) {
    const entries = [];
    let offset = 0;
    for (const l of text.replace(/\r/g, '').split('\n')) {
      const off = l.match(/^\[offset:\s*([+-]?\d+)\]/i);
      if (off) { offset = +off[1] / 1000; continue; }
      const stamps = [...l.matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)];
      if (!stamps.length) continue;
      const lyric = l.replace(/\[[^\]]*\]/g, '').replace(/<\d+:\d+(?:[.:]\d+)?>/g, '').trim();
      for (const s of stamps) entries.push({ t: +s[1] * 60 + parseFloat(s[2].replace(':', '.')), text: lyric });
    }
    entries.sort((a, b) => a.t - b.t);
    return entries.map((e, i) => mkCue(Math.max(0, e.t - offset), (entries[i + 1] ? entries[i + 1].t : e.t + 6) - offset, e.text, 'srt')).filter(c => c.html);
  }

  function parseSAMI(text) {
    const cues = [];
    const re = /<sync\s+start\s*=\s*["']?(\d+)["']?[^>]*>([\s\S]*?)(?=<sync|<\/body|$)/gi;
    let m, prev = null;
    while ((m = re.exec(text))) {
      const t = +m[1] / 1000;
      if (prev) prev.end = t;
      let body = m[2].replace(/<\/?p[^>]*>/gi, '').replace(/&nbsp;/gi, ' ').trim();
      body = body.replace(/<br\s*\/?>/gi, '\n');
      if (body && body !== ' ') { prev = mkCue(t, t + 5, body, 'srt'); cues.push(prev); }
      else prev = null;
    }
    return cues;
  }

  function parseTTML(text) {
    const cues = [];
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const tt = doc.documentElement;
    const fr = parseFloat(tt.getAttribute('ttp:frameRate') || tt.getAttributeNS('http://www.w3.org/ns/ttml#parameter', 'frameRate') || '30');
    const tick = parseFloat(tt.getAttribute('ttp:tickRate') || '10000000');
    const tt2 = v => {
      if (!v) return NaN;
      let m = v.match(/^([\d.]+)(h|m|s|ms|f|t)$/);
      if (m) { const n = parseFloat(m[1]); return { h: n * 3600, m: n * 60, s: n, ms: n / 1000, f: n / fr, t: n / tick }[m[2]]; }
      m = v.match(/^(\d+):(\d+):(\d+)(?:[.:](\d+))?$/);
      if (m) return +m[1] * 3600 + +m[2] * 60 + +m[3] + (m[4] ? (v.includes('.') ? parseFloat('0.' + m[4]) : +m[4] / fr) : 0);
      return ts(v);
    };
    const ps = doc.getElementsByTagName('p');
    for (const p of Array.from(ps)) {
      const begin = tt2(p.getAttribute('begin'));
      let end = tt2(p.getAttribute('end'));
      if (!isFinite(end)) end = begin + (tt2(p.getAttribute('dur')) || 3);
      const html = Array.from(p.childNodes).map(n => n.nodeName.toLowerCase().endsWith('br') ? '\n' : n.textContent).join('');
      if (isFinite(begin)) cues.push(mkCue(begin, end, html, 'srt'));
    }
    return cues;
  }

  /** Detecta o formato e retorna lista de cues ordenada. */
  function parse(text, name, fps) {
    const ext = U.ext(name || '');
    const head = text.slice(0, 2000);
    let cues;
    if (/^﻿?WEBVTT/.test(text)) cues = parseVTT(text);
    else if (/\[Script Info\]/i.test(head) || /^\s*\[V4\+? Styles\]/im.test(head) || ext === 'ass' || ext === 'ssa') cues = parseASS(text);
    else if (/<tt[\s>]/i.test(head) || ext === 'ttml' || ext === 'dfxp') cues = parseTTML(text);
    else if (/<sami>/i.test(head) || ext === 'smi' || ext === 'sami') cues = parseSAMI(text);
    else if (/^\s*\{\d+\}\{\d*\}/m.test(head)) cues = parseMicroDVD(text, fps);
    else if (/^\s*\[\d+\]\[\d*\]/m.test(head)) cues = parseMPL2(text);
    else if (/^\[\d+:\d+(?:[.:]\d+)?\]/m.test(head) || ext === 'lrc') cues = parseLRC(text);
    else if (/^\d+:\d+:\d+[.,]\d+\s*,\s*\d+:\d+:\d+[.,]\d+/m.test(head) || ext === 'sbv') cues = parseSubViewer(text);
    else if (/-->/.test(head)) cues = /^\d+:\d+\.\d+\s*-->/m.test(head) ? parseVTT(text) : parseSRT(text);
    else cues = [];
    cues = cues.filter(c => isFinite(c.start) && isFinite(c.end) && c.html);
    cues.sort((a, b) => a.start - b.start || (a.layer || 0) - (b.layer || 0));
    return cues;
  }

  /** Serializa cues como SRT (usado ao exportar legendas sincronizadas). */
  function toSRT(cues, delay = 0) {
    const f = s => U.fmtTimeMs(Math.max(0, s)).replace('.', ',');
    return cues.map((c, i) => `${i + 1}\n${f(c.start + delay)} --> ${f(c.end + delay)}\n${c.html.replace(/<br>/g, '\n').replace(/<[^>]+>/g, '')}\n`).join('\n');
  }

  /* ---------------- Gerenciador / renderizador ---------------- */
  const SIZE_FACTORS = { smaller: 0.034, small: 0.042, normal: 0.052, large: 0.064, larger: 0.08 };
  const OUTLINE = { none: 0, thin: 0.035, normal: 0.06, thick: 0.1 };

  class SubtitleManager extends U.Emitter {
    constructor(layer, settings) {
      super();
      this.layer = layer;
      this.settings = settings;
      this.tracks = [];
      this.activeId = null;
      this.delay = 0;          // segundos (positivo = legenda mais tarde)
      this.speed = 1;          // fator de velocidade
      this.durationFactor = 1;
      this.lastKey = '';
      this.regions = {};
      for (const r of ['top', 'middle', 'bottom']) {
        this.regions[r] = U.el('div', { class: 'subs-region subs-' + r });
        layer.appendChild(this.regions[r]);
      }
      this.embeddedCache = new WeakMap();
      settings.on('change', k => { if (k.startsWith('subs')) this.applyStyle(); });
      this.applyStyle();
    }

    get active() { return this.tracks.find(t => t.id === this.activeId) || null; }

    addCues(cues, opts = {}) {
      const track = { id: U.uid('sub'), label: opts.label || 'Legenda', lang: opts.lang || '', source: opts.source || 'file', cues, file: opts.file || null, name: opts.name || '' };
      this.tracks.push(track);
      this.emit('tracks');
      return track;
    }

    async addFile(file, opts = {}) {
      const enc = opts.encoding || this.settings.get('subsEncoding');
      const buf = await file.arrayBuffer();
      const text = U.decodeText(buf, enc, this.settings.get('subsFallbackEncoding'));
      const cues = parse(text, file.name, opts.fps);
      if (!cues.length) throw new Error('Nenhuma legenda reconhecida em ' + file.name);
      const lang = langFromName(file.name, opts.mediaName);
      const label = opts.label || (lang ? `${lang} — ${file.name}` : file.name);
      const t = this.addCues(cues, { label, lang, source: 'file', file, name: file.name });
      VW.log && VW.log.info('subs', `Legenda carregada: ${file.name} (${cues.length} falas)`);
      return t;
    }

    addEmbedded(textTrack, label) {
      if (this.tracks.some(t => t.textTrack === textTrack)) return null;
      textTrack.mode = 'hidden';
      const track = { id: U.uid('sub'), label: label || textTrack.label || textTrack.language || 'Faixa embutida', lang: textTrack.language || '', source: 'embedded', textTrack, cues: null };
      this.tracks.push(track);
      this.emit('tracks');
      return track;
    }

    removeEmbedded() {
      const before = this.tracks.length;
      this.tracks = this.tracks.filter(t => t.source !== 'embedded');
      if (this.active === null) this.activeId = null;
      if (before !== this.tracks.length) this.emit('tracks');
    }

    clear() {
      this.tracks = [];
      this.activeId = null;
      this.delay = 0;
      this.speed = 1;
      this.durationFactor = 1;
      this.render([]);
      this.emit('tracks');
      this.emit('change');
    }

    setActive(id) {
      this.activeId = id;
      this.lastKey = '';
      this.render([]);
      this.emit('change');
    }

    cycle(dir = 1) {
      const ids = [null, ...this.tracks.map(t => t.id)];
      let i = ids.indexOf(this.activeId);
      i = (i + dir + ids.length) % ids.length;
      this.setActive(ids[i]);
      return this.active;
    }

    setDelay(sec) { this.delay = Math.round(sec * 1000) / 1000; this.lastKey = ''; this.emit('change'); }
    setSpeed(f) { this.speed = U.clamp(f, 0.1, 10); this.lastKey = ''; this.emit('change'); }
    setDurationFactor(f) { this.durationFactor = U.clamp(f, 0.2, 20); this.lastKey = ''; this.emit('change'); }

    cuesOf(track) {
      if (track.source !== 'embedded') return track.cues;
      const list = track.textTrack.cues;
      if (!list) return [];
      let cache = this.embeddedCache.get(track.textTrack);
      if (!cache || cache.len !== list.length) {
        const cues = [];
        for (let i = 0; i < list.length; i++) {
          const c = list[i];
          cues.push(mkCue(c.startTime, c.endTime, c.text || '', 'vtt'));
        }
        cache = { len: list.length, cues };
        this.embeddedCache.set(track.textTrack, cache);
      }
      return cache.cues;
    }

    /** Atualiza a exibição para o tempo de mídia t (segundos). */
    update(t) {
      const tr = this.active;
      if (!tr) { if (this.lastKey !== 'none') { this.render([]); this.lastKey = 'none'; } return; }
      const st = (t - this.delay) * this.speed;
      const cues = this.cuesOf(tr);
      const active = [];
      // busca binária pelo último cue com start <= st
      let lo = 0, hi = cues.length - 1, idx = -1;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (cues[mid].start <= st) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
      for (let i = idx; i >= 0 && i > idx - 60; i--) {
        const c = cues[i];
        const end = c.start + (c.end - c.start) * this.durationFactor;
        if (st < end) active.push(c);
      }
      active.reverse();
      const key = active.map(c => c.start + ':' + c.html.length).join('|');
      if (key === this.lastKey) return;
      this.lastKey = key;
      this.render(active);
    }

    render(cues) {
      for (const r in this.regions) this.regions[r].textContent = '';
      for (const c of cues) {
        const a = c.align || 2;
        const region = a >= 7 ? 'top' : a >= 4 ? 'middle' : 'bottom';
        const h = a % 3 === 1 ? 'left' : a % 3 === 0 ? 'right' : 'center';
        const div = U.el('div', { class: 'cue', style: { textAlign: h } });
        const span = U.el('span', { class: 'cue-text', html: c.html });
        div.appendChild(span);
        if (region === 'top') this.regions.top.appendChild(div); else this.regions[region].appendChild(div);
      }
    }

    /** Ajusta a camada ao retângulo do vídeo exibido (px relativos ao palco). */
    setRect(rect) {
      const s = this.layer.style;
      s.left = rect.x + 'px'; s.top = rect.y + 'px'; s.width = rect.w + 'px'; s.height = rect.h + 'px';
      this.rectH = rect.h;
      this.applyStyle();
    }

    applyStyle() {
      const g = k => this.settings.get(k);
      const h = this.rectH || this.layer.clientHeight || 480;
      const size = Math.max(10, h * (SIZE_FACTORS[g('subsSize')] || SIZE_FACTORS.normal) * (g('subsScale') / 100));
      const ow = OUTLINE[g('subsOutline')] ?? OUTLINE.normal;
      const oc = g('subsOutlineColor');
      const shadows = [];
      if (ow > 0) {
        const steps = 16;
        for (let i = 0; i < steps; i++) {
          const a = (i / steps) * Math.PI * 2;
          shadows.push(`${(Math.cos(a) * ow).toFixed(3)}em ${(Math.sin(a) * ow).toFixed(3)}em 0 ${oc}`);
        }
      }
      if (g('subsShadow')) shadows.push(`0.06em 0.08em 0.12em rgba(0,0,0,.85)`);
      const s = this.layer.style;
      s.setProperty('--sub-font', g('subsFont'));
      s.setProperty('--sub-size', size.toFixed(1) + 'px');
      s.setProperty('--sub-color', hexA(g('subsColor'), g('subsOpacity') / 100));
      s.setProperty('--sub-shadow', shadows.join(',') || 'none');
      s.setProperty('--sub-bg', g('subsBackground') ? hexA(g('subsBgColor'), g('subsBgOpacity') / 100) : 'transparent');
      s.setProperty('--sub-weight', g('subsBold') ? '700' : '400');
      s.setProperty('--sub-margin', g('subsMargin') + '%');
    }

    exportActive() {
      const t = this.active;
      if (!t) return null;
      const cues = this.cuesOf(t).map(c => ({ start: c.start / this.speed, end: (c.start + (c.end - c.start) * this.durationFactor) / this.speed, html: c.html }));
      return toSRT(cues, this.delay);
    }
  }

  function hexA(hex, a) {
    const m = String(hex).match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return hex;
    return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
  }

  /** Extrai o idioma do nome do arquivo: filme.pt-BR.srt → pt-BR */
  function langFromName(subName, mediaName) {
    const base = U.stripExt(subName);
    if (mediaName) {
      const mb = U.stripExt(mediaName);
      if (base.toLowerCase().startsWith(mb.toLowerCase()) && base.length > mb.length) {
        return base.slice(mb.length).replace(/^[\s._-]+/, '').trim();
      }
    }
    const m = base.match(/[._-]([a-z]{2,3}(?:[-_][A-Za-z]{2})?|portuguese|english|spanish|brazilian|forced)$/i);
    return m ? m[1] : '';
  }

  /** Verifica se o arquivo de legenda pertence ao arquivo de mídia (mesmo nome‑base). */
  function matchesMedia(subName, mediaName) {
    const sb = U.stripExt(subName).toLowerCase();
    const mb = U.stripExt(mediaName).toLowerCase();
    return sb === mb || sb.startsWith(mb + '.') || sb.startsWith(mb + '_') || sb.startsWith(mb + '-') || sb.startsWith(mb + ' ');
  }

  VW.subtitles = { parse, toSRT, SubtitleManager, matchesMedia, langFromName };
})(window.VW = window.VW || {});
