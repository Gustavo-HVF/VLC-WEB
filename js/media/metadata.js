/* VLC Web — leitura de metadados (ID3v1/v2, FLAC, Ogg, MP4/M4A, Matroska/WebM, WAV)
 * Extrai tags, capa do álbum, capítulos e lista de faixas sem decodificar a mídia. */
(function (VW) {
  'use strict';
  const U = VW.util;

  const GENRES = ['Blues', 'Classic Rock', 'Country', 'Dance', 'Disco', 'Funk', 'Grunge', 'Hip-Hop', 'Jazz', 'Metal', 'New Age', 'Oldies', 'Other', 'Pop', 'R&B', 'Rap', 'Reggae', 'Rock', 'Techno', 'Industrial', 'Alternative', 'Ska', 'Death Metal', 'Pranks', 'Soundtrack', 'Euro-Techno', 'Ambient', 'Trip-Hop', 'Vocal', 'Jazz+Funk', 'Fusion', 'Trance', 'Classical', 'Instrumental', 'Acid', 'House', 'Game', 'Sound Clip', 'Gospel', 'Noise', 'AlternRock', 'Bass', 'Soul', 'Punk', 'Space', 'Meditative', 'Instrumental Pop', 'Instrumental Rock', 'Ethnic', 'Gothic', 'Darkwave', 'Techno-Industrial', 'Electronic', 'Pop-Folk', 'Eurodance', 'Dream', 'Southern Rock', 'Comedy', 'Cult', 'Gangsta', 'Top 40', 'Christian Rap', 'Pop/Funk', 'Jungle', 'Native American', 'Cabaret', 'New Wave', 'Psychadelic', 'Rave', 'Showtunes', 'Trailer', 'Lo-Fi', 'Tribal', 'Acid Punk', 'Acid Jazz', 'Polka', 'Retro', 'Musical', 'Rock & Roll', 'Hard Rock'];

  const latin1 = new TextDecoder('iso-8859-1');
  const utf8 = new TextDecoder('utf-8');

  async function readSlice(file, start, end) {
    return new Uint8Array(await file.slice(start, end).arrayBuffer());
  }
  const str4 = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  const u32be = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
  const u32le = (b, o) => b[o] + (b[o + 1] << 8) + (b[o + 2] << 16) + ((b[o + 3] << 24) >>> 0);
  const u16be = (b, o) => (b[o] << 8) + b[o + 1];
  const u24be = (b, o) => (b[o] << 16) + (b[o + 1] << 8) + b[o + 2];
  const syncsafe = (b, o) => (b[o] << 21) | (b[o + 1] << 14) | (b[o + 2] << 7) | b[o + 3];

  function newResult(container) {
    return { container, tags: {}, extra: {}, cover: null, chapters: [], tracks: [], duration: NaN };
  }

  /* ======================= ID3v2 ======================= */
  function id3Text(bytes, enc) {
    if (!bytes.length) return '';
    let s;
    switch (enc) {
      case 0: s = latin1.decode(bytes); break;
      case 1: s = new TextDecoder(bytes[0] === 0xFE ? 'utf-16be' : 'utf-16le').decode(bytes[0] === 0xFF || bytes[0] === 0xFE ? bytes.subarray(2) : bytes); break;
      case 2: s = new TextDecoder('utf-16be').decode(bytes); break;
      default: s = utf8.decode(bytes);
    }
    return s.replace(/\0+$/, '').replace(/\0/g, ' / ');
  }
  function findNull(b, start, enc) {
    if (enc === 1 || enc === 2) {
      for (let i = start; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return i;
      return b.length;
    }
    for (let i = start; i < b.length; i++) if (b[i] === 0) return i;
    return b.length;
  }
  function unsync(b) {
    const out = [];
    for (let i = 0; i < b.length; i++) {
      out.push(b[i]);
      if (b[i] === 0xFF && b[i + 1] === 0x00) i++;
    }
    return new Uint8Array(out);
  }

  const ID3_MAP = {
    TIT2: 'title', TT2: 'title', TPE1: 'artist', TP1: 'artist', TALB: 'album', TAL: 'album', TPE2: 'albumArtist', TP2: 'albumArtist',
    TYER: 'date', TYE: 'date', TDRC: 'date', TCON: 'genre', TCO: 'genre', TRCK: 'track', TRK: 'track', TCOM: 'composer', TCM: 'composer',
    TCOP: 'copyright', TCR: 'copyright', TENC: 'encodedBy', TEN: 'encodedBy', TSSE: 'encoder', TPUB: 'publisher', TPB: 'publisher',
    TLAN: 'language', TLA: 'language', TIT3: 'description', TPOS: 'disc', TBPM: 'bpm', TIT1: 'grouping'
  };

  function parseId3Frames(data, ver, res, isSub) {
    let p = 0;
    const idLen = ver === 2 ? 3 : 4, hdrLen = ver === 2 ? 6 : 10;
    while (p + hdrLen <= data.length) {
      const id = latin1.decode(data.subarray(p, p + idLen));
      if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
      let size = ver === 2 ? u24be(data, p + 3) : ver === 4 ? syncsafe(data, p + 4) : u32be(data, p + 4);
      const flags = ver === 2 ? 0 : u16be(data, p + 8);
      let f = data.subarray(p + hdrLen, p + hdrLen + size);
      p += hdrLen + size;
      if (size <= 0) continue;
      if (ver === 4) {
        if (flags & 0x0001) f = f.subarray(4);           // data length indicator
        if (flags & 0x0002) f = unsync(f);               // unsincronização por frame
      }
      if (ver === 3 && (flags & 0x00C0)) continue;       // compressão/criptografia não suportadas
      try {
        if (id[0] === 'T' && id !== 'TXXX' && id !== 'TXX') {
          const v = id3Text(f.subarray(1), f[0]);
          const key = ID3_MAP[id];
          if (key) {
            let val = v;
            if (key === 'genre') {
              val = val.replace(/^\((\d+)\)/, (m, n) => GENRES[+n] || m).replace(/^(\d+)$/, (m, n) => GENRES[+n] || m);
            }
            if (isSub) res.title = val; else res.tags[key] = val;
          } else if (!isSub) res.extra[id] = v;
        } else if (id === 'TXXX' || id === 'TXX') {
          const enc = f[0], e = findNull(f, 1, enc);
          const desc = id3Text(f.subarray(1, e), enc);
          const val = id3Text(f.subarray(e + (enc === 1 || enc === 2 ? 2 : 1)), enc);
          res.extra[desc || id] = val;
        } else if (id === 'COMM' || id === 'COM' || id === 'USLT' || id === 'ULT') {
          const enc = f[0], e = findNull(f, 4, enc);
          const text = id3Text(f.subarray(e + (enc === 1 || enc === 2 ? 2 : 1)), enc);
          if (id === 'COMM' || id === 'COM') { if (!res.tags.comment) res.tags.comment = text; }
          else res.tags.lyrics = text;
        } else if ((id === 'APIC' || id === 'PIC') && !res.cover) {
          const enc = f[0];
          let mime, q;
          if (id === 'PIC') { mime = 'image/' + latin1.decode(f.subarray(1, 4)).toLowerCase().replace('jpg', 'jpeg'); q = 4; }
          else { const e = findNull(f, 1, 0); mime = latin1.decode(f.subarray(1, e)) || 'image/jpeg'; q = e + 1; }
          q += 1; // tipo de imagem
          const e2 = findNull(f, q, enc);
          q = e2 + (enc === 1 || enc === 2 ? 2 : 1);
          if (!mime.includes('/')) mime = 'image/' + mime.toLowerCase();
          res.cover = new Blob([f.slice(q)], { type: mime });
        } else if (id === 'WXXX' || id === 'WOAR' || id === 'WOAF') {
          res.tags.url = latin1.decode(f.subarray(id === 'WXXX' ? findNull(f, 1, f[0]) + 1 : 0)).replace(/\0/g, '');
        } else if (id === 'CHAP' && !isSub) {
          const e = findNull(f, 0, 0);
          const start = u32be(f, e + 1) / 1000, end = u32be(f, e + 5) / 1000;
          const sub = { title: '' };
          parseId3Frames(f.subarray(e + 17), ver, sub, true);
          res.chapters.push({ start, end, title: sub.title || ('Capítulo ' + (res.chapters.length + 1)) });
        }
      } catch (err) { /* frame corrompido: ignora */ }
    }
  }

  async function parseId3v2(file, res) {
    const h = await readSlice(file, 0, 10);
    if (h[0] !== 0x49 || h[1] !== 0x44 || h[2] !== 0x33) return 0;
    const ver = h[3], flags = h[5], size = syncsafe(h, 6);
    if (size > 64 * 1024 * 1024) return 0;
    let data = await readSlice(file, 10, 10 + size);
    if ((flags & 0x80) && ver < 4) data = unsync(data);
    let start = 0;
    if (flags & 0x40) start = ver === 4 ? syncsafe(data, 0) : u32be(data, 0) + 4;
    parseId3Frames(data.subarray(start), ver, res);
    res.chapters.sort((a, b) => a.start - b.start);
    return 10 + size;
  }

  async function parseId3v1(file, res) {
    if (file.size < 128) return;
    const b = await readSlice(file, file.size - 128, file.size);
    if (b[0] !== 0x54 || b[1] !== 0x41 || b[2] !== 0x47) return;
    const t = (s, e) => latin1.decode(b.subarray(s, e)).replace(/\0.*$/, '').trim();
    const set = (k, v) => { if (v && !res.tags[k]) res.tags[k] = v; };
    set('title', t(3, 33)); set('artist', t(33, 63)); set('album', t(63, 93)); set('date', t(93, 97));
    set('comment', t(97, b[125] === 0 && b[126] ? 125 : 127));
    if (b[125] === 0 && b[126]) set('track', String(b[126]));
    if (GENRES[b[127]]) set('genre', GENRES[b[127]]);
  }

  /* ======================= Vorbis comments (FLAC/Ogg) ======================= */
  const VC_MAP = {
    TITLE: 'title', ARTIST: 'artist', ALBUM: 'album', ALBUMARTIST: 'albumArtist', 'ALBUM ARTIST': 'albumArtist', DATE: 'date', YEAR: 'date',
    GENRE: 'genre', TRACKNUMBER: 'track', COMMENT: 'comment', DESCRIPTION: 'description', COMPOSER: 'composer', COPYRIGHT: 'copyright',
    'ENCODED-BY': 'encodedBy', ENCODEDBY: 'encodedBy', ENCODER: 'encoder', LYRICS: 'lyrics', UNSYNCEDLYRICS: 'lyrics', LANGUAGE: 'language',
    PUBLISHER: 'publisher', ORGANIZATION: 'publisher', LABEL: 'publisher', DISCNUMBER: 'disc', CONTACT: 'url', URL: 'url'
  };

  function parseFlacPicture(b) {
    let p = 4;
    const mimeLen = u32be(b, p); p += 4;
    const mime = latin1.decode(b.subarray(p, p + mimeLen)); p += mimeLen;
    const descLen = u32be(b, p); p += 4 + descLen;
    p += 16;
    const len = u32be(b, p); p += 4;
    return new Blob([b.slice(p, p + len)], { type: mime || 'image/jpeg' });
  }

  function parseVorbisComment(b, res) {
    let p = 0;
    const vlen = u32le(b, p); p += 4;
    const vendor = utf8.decode(b.subarray(p, p + vlen)); p += vlen;
    if (vendor) res.extra.Codificador = vendor;
    const n = u32le(b, p); p += 4;
    const chap = {};
    for (let i = 0; i < n && p < b.length; i++) {
      const len = u32le(b, p); p += 4;
      const s = utf8.decode(b.subarray(p, p + len)); p += len;
      const eq = s.indexOf('=');
      if (eq < 0) continue;
      const key = s.slice(0, eq).toUpperCase(), val = s.slice(eq + 1);
      if (key === 'METADATA_BLOCK_PICTURE') {
        try { const bin = Uint8Array.from(atob(val), c => c.charCodeAt(0)); if (!res.cover) res.cover = parseFlacPicture(bin); } catch (e) { /* ignora */ }
      } else if (/^CHAPTER\d+$/.test(key)) { (chap[key] = chap[key] || {}).start = U.parseTime(val); }
      else if (/^CHAPTER\d+NAME$/.test(key)) { (chap[key.slice(0, -4)] = chap[key.slice(0, -4)] || {}).title = val; }
      else if (VC_MAP[key]) { if (!res.tags[VC_MAP[key]]) res.tags[VC_MAP[key]] = val; }
      else res.extra[key] = val;
    }
    for (const k of Object.keys(chap).sort()) if (isFinite(chap[k].start)) res.chapters.push({ start: chap[k].start, title: chap[k].title || k });
  }

  async function parseFlac(file, res, offset) {
    const h = await readSlice(file, offset, offset + 4);
    if (str4(h, 0) !== 'fLaC') return false;
    let p = offset + 4;
    for (let i = 0; i < 64; i++) {
      const bh = await readSlice(file, p, p + 4);
      if (bh.length < 4) break;
      const last = bh[0] & 0x80, type = bh[0] & 0x7F, len = u24be(bh, 1);
      p += 4;
      if (type === 0 || type === 4 || (type === 6 && !res.cover)) {
        const b = await readSlice(file, p, p + len);
        if (type === 0) {
          const sr = (b[10] << 12) | (b[11] << 4) | (b[12] >> 4);
          const ch = ((b[12] >> 1) & 7) + 1;
          const bps = (((b[12] & 1) << 4) | (b[13] >> 4)) + 1;
          const total = (b[13] & 0x0F) * 2 ** 32 + u32be(b, 14);
          res.tracks.push({ type: 'audio', codec: 'FLAC', sampleRate: sr, channels: ch, bits: bps });
          if (sr) res.duration = total / sr;
        } else if (type === 4) parseVorbisComment(b, res);
        else res.cover = parseFlacPicture(b);
      }
      p += len;
      if (last) break;
    }
    return true;
  }

  async function parseOgg(file, res) {
    const b = await readSlice(file, 0, Math.min(file.size, 4 * 1024 * 1024));
    let p = 0, packets = [], cur = [], serial = null;
    while (p + 27 <= b.length && packets.length < 2) {
      if (str4(b, p) !== 'OggS') break;
      const s = u32le(b, p + 14);
      const nseg = b[p + 26];
      const table = b.subarray(p + 27, p + 27 + nseg);
      let q = p + 27 + nseg;
      if (serial === null) serial = s;
      for (let i = 0; i < nseg; i++) {
        const len = table[i];
        if (s === serial) cur.push(b.subarray(q, q + len));
        q += len;
        if (len < 255 && s === serial) {
          const total = cur.reduce((a, c) => a + c.length, 0);
          const pk = new Uint8Array(total);
          let o = 0; for (const c of cur) { pk.set(c, o); o += c.length; }
          packets.push(pk); cur = [];
          if (packets.length >= 2) break;
        }
      }
      p = q;
    }
    if (!packets.length) return false;
    const id = packets[0];
    const head = latin1.decode(id.subarray(0, 8));
    if (head.startsWith('\x01vorbis')) {
      res.tracks.push({ type: 'audio', codec: 'Vorbis', channels: id[11], sampleRate: u32le(id, 12) });
      if (packets[1]) parseVorbisComment(packets[1].subarray(7), res);
    } else if (head === 'OpusHead') {
      res.tracks.push({ type: 'audio', codec: 'Opus', channels: id[9], sampleRate: u32le(id, 12) || 48000 });
      if (packets[1]) parseVorbisComment(packets[1].subarray(8), res);
    } else if (head.startsWith('\x80theora')) {
      res.tracks.push({ type: 'video', codec: 'Theora' });
    } else if (head.startsWith('\x7FFLAC')) {
      res.tracks.push({ type: 'audio', codec: 'FLAC' });
      if (packets[1]) parseVorbisComment(packets[1].subarray(4), res);
    }
    return true;
  }

  /* ======================= MP4 / M4A / MOV ======================= */
  const MP4_MAP = {
    '©nam': 'title', '©ART': 'artist', '©alb': 'album', aART: 'albumArtist', '©day': 'date', '©gen': 'genre', '©wrt': 'composer',
    cprt: 'copyright', '©too': 'encoder', '©enc': 'encodedBy', '©cmt': 'comment', desc: 'description', '©lyr': 'lyrics', '©pub': 'publisher', ldes: 'description'
  };
  const FOURCC = {
    avc1: 'H.264 (AVC)', avc3: 'H.264 (AVC)', hvc1: 'H.265 (HEVC)', hev1: 'H.265 (HEVC)', vp08: 'VP8', vp09: 'VP9', av01: 'AV1', mp4v: 'MPEG-4 Visual',
    s263: 'H.263', mjpa: 'Motion JPEG', jpeg: 'Motion JPEG', apch: 'ProRes 422 HQ', apcn: 'ProRes 422', dvh1: 'Dolby Vision', dvhe: 'Dolby Vision',
    mp4a: 'AAC / MPEG Audio', 'ac-3': 'Dolby Digital (AC-3)', 'ec-3': 'Dolby Digital Plus (E-AC-3)', Opus: 'Opus', fLaC: 'FLAC', alac: 'ALAC',
    '.mp3': 'MP3', samr: 'AMR-NB', sawb: 'AMR-WB', lpcm: 'PCM', sowt: 'PCM', twos: 'PCM', 'dtsc': 'DTS', tx3g: 'Texto 3GPP (mov_text)', wvtt: 'WebVTT', stpp: 'TTML', c608: 'CEA-608'
  };

  function mp4Children(b, start, end, cb) {
    let p = start;
    while (p + 8 <= end) {
      let size = u32be(b, p);
      const type = latin1.decode(b.subarray(p + 4, p + 8));
      let hdr = 8;
      if (size === 1) { size = u32be(b, p + 8) * 2 ** 32 + u32be(b, p + 12); hdr = 16; }
      else if (size === 0) size = end - p;
      if (size < hdr || p + size > end) break;
      if (cb(type, p + hdr, p + size) === false) break;
      p += size;
    }
  }

  function mp4Lang(code) {
    if (!code || code === 0x7FFF) return '';
    const s = String.fromCharCode(((code >> 10) & 31) + 0x60, ((code >> 5) & 31) + 0x60, (code & 31) + 0x60);
    return s === 'und' ? '' : s;
  }

  async function parseMp4(file, res) {
    let p = 0, moov = null;
    for (let i = 0; i < 64 && p < file.size; i++) {
      const h = await readSlice(file, p, p + 16);
      if (h.length < 8) break;
      let size = u32be(h, 0);
      const type = latin1.decode(h.subarray(4, 8));
      if (i === 0 && !['ftyp', 'moov', 'mdat', 'free', 'wide', 'skip', 'pnot', 'uuid'].includes(type)) return false;
      if (size === 1) size = u32be(h, 8) * 2 ** 32 + u32be(h, 12);
      else if (size === 0) size = file.size - p;
      if (type === 'ftyp') res.extra['Marca (ftyp)'] = latin1.decode(h.subarray(8, 12)).trim();
      if (type === 'moov') { if (size < 64 * 1024 * 1024) moov = await readSlice(file, p, p + size); break; }
      if (size < 8) break;
      p += size;
    }
    if (!moov) return true;
    const b = moov;
    mp4Children(b, 8, b.length, (type, s, e) => {
      if (type === 'mvhd') {
        const v = b[s];
        const ts = v === 1 ? u32be(b, s + 20) : u32be(b, s + 12);
        const dur = v === 1 ? u32be(b, s + 24) * 2 ** 32 + u32be(b, s + 28) : u32be(b, s + 16);
        if (ts) res.duration = dur / ts;
      } else if (type === 'trak') {
        const tr = { type: 'other', codec: '', lang: '', name: '' };
        let tkW = 0, tkH = 0;
        mp4Children(b, s, e, (t2, s2, e2) => {
          if (t2 === 'tkhd') { tkW = u32be(b, e2 - 8) / 65536; tkH = u32be(b, e2 - 4) / 65536; tr.default = !!(b[s2 + 3] & 1); }
          if (t2 === 'mdia') {
            mp4Children(b, s2, e2, (t3, s3, e3) => {
              if (t3 === 'mdhd') { const v = b[s3]; tr.lang = mp4Lang(u16be(b, s3 + (v === 1 ? 32 : 20))); }
              if (t3 === 'hdlr') {
                const h = latin1.decode(b.subarray(s3 + 8, s3 + 12));
                tr.type = h === 'vide' ? 'video' : h === 'soun' ? 'audio' : (h === 'text' || h === 'sbtl' || h === 'subt' || h === 'clcp') ? 'subtitle' : 'other';
                const nm = utf8.decode(b.subarray(s3 + 24, e3)).replace(/\0/g, '').trim();
                if (nm && !/Handler$/i.test(nm)) tr.name = nm;
              }
              if (t3 === 'minf') mp4Children(b, s3, e3, (t4, s4, e4) => {
                if (t4 === 'stbl') mp4Children(b, s4, e4, (t5, s5) => {
                  if (t5 === 'stsd') {
                    const es = s5 + 8;
                    const fourcc = latin1.decode(b.subarray(es + 4, es + 8));
                    tr.fourcc = fourcc;
                    tr.codec = FOURCC[fourcc] || fourcc;
                    if (tr.type === 'audio') { tr.channels = u16be(b, es + 24); tr.sampleRate = u16be(b, es + 32); }
                    if (tr.type === 'video') { tr.width = u16be(b, es + 32); tr.height = u16be(b, es + 34); }
                  }
                });
              });
            });
          }
          if (t2 === 'udta') mp4Children(b, s2, e2, (t3, s3, e3) => { if (t3 === 'name') tr.name = utf8.decode(b.subarray(s3, e3)).replace(/\0/g, ''); });
        });
        if (tr.type === 'video' && !tr.width) { tr.width = tkW; tr.height = tkH; }
        if (tr.type !== 'other') res.tracks.push(tr);
      } else if (type === 'udta') {
        mp4Children(b, s, e, (t2, s2, e2) => {
          if (t2 === 'chpl') {
            const ver = b[s2];
            let q = s2 + 4 + (ver ? 4 : 0);
            const n = b[q]; q += 1;
            for (let i = 0; i < n && q < e2; i++) {
              const start = (u32be(b, q) * 2 ** 32 + u32be(b, q + 4)) / 1e7;
              const len = b[q + 8];
              const title = utf8.decode(b.subarray(q + 9, q + 9 + len));
              res.chapters.push({ start, title });
              q += 9 + len;
            }
          }
          if (t2 === 'meta') {
            mp4Children(b, s2 + 4, e2, (t3, s3, e3) => {
              if (t3 !== 'ilst') return;
              mp4Children(b, s3, e3, (key, s4, e4) => {
                mp4Children(b, s4, e4, (t5, s5, e5) => {
                  if (t5 !== 'data') return;
                  const kind = u32be(b, s5) & 0xFFFFFF;
                  const val = b.subarray(s5 + 8, e5);
                  if (key === 'covr') { if (!res.cover) res.cover = new Blob([val.slice()], { type: kind === 14 ? 'image/png' : 'image/jpeg' }); }
                  else if (key === 'trkn' || key === 'disk') {
                    const n = u16be(val, 2), tot = u16be(val, 4);
                    res.tags[key === 'trkn' ? 'track' : 'disc'] = tot ? `${n}/${tot}` : String(n);
                  } else if (key === 'gnre') { res.tags.genre = GENRES[u16be(val, 0) - 1] || ''; }
                  else if (kind === 1) {
                    const sv = utf8.decode(val);
                    if (MP4_MAP[key]) res.tags[MP4_MAP[key]] = sv; else res.extra[key.replace('©', '')] = sv;
                  }
                });
              });
            });
          }
        });
      }
    });
    return true;
  }

  /* ======================= Matroska / WebM (EBML) ======================= */
  const EBML_IDS = {
    SEGMENT: 0x18538067, SEEKHEAD: 0x114D9B74, SEEK: 0x4DBB, SEEKID: 0x53AB, SEEKPOS: 0x53AC,
    INFO: 0x1549A966, TIMESCALE: 0x2AD7B1, DURATION: 0x4489, TITLE: 0x7BA9, MUXAPP: 0x4D80, WRITEAPP: 0x5741,
    TRACKS: 0x1654AE6B, TRACKENTRY: 0xAE, TRACKNUM: 0xD7, TRACKTYPE: 0x83, CODECID: 0x86, LANG: 0x22B59C, LANGBCP: 0x22B59D,
    NAME: 0x536E, FLAGDEFAULT: 0x88, FLAGFORCED: 0x55AA, VIDEO: 0xE0, PIXW: 0xB0, PIXH: 0xBA, AUDIO: 0xE1, SFREQ: 0xB5, CHANNELS: 0x9F,
    CHAPTERS: 0x1043A770, EDITION: 0x45B9, ATOM: 0xB6, CHSTART: 0x91, CHDISPLAY: 0x80, CHSTRING: 0x85, CLUSTER: 0x1F43B675,
    TAGS: 0x1254C367, TAG: 0x7373, SIMPLETAG: 0x67C8, TAGNAME: 0x45A3, TAGSTRING: 0x4487, TARGETS: 0x63C0, TARGETTYPEVAL: 0x68CA
  };
  const MKV_CODECS = {
    V_MPEG4_ISO_AVC: 'H.264 (AVC)', V_MPEGH_ISO_HEVC: 'H.265 (HEVC)', V_VP8: 'VP8', V_VP9: 'VP9', V_AV1: 'AV1', V_MPEG2: 'MPEG-2 Vídeo',
    V_MPEG4_ISO_ASP: 'MPEG-4 Part 2 (DivX/Xvid)', V_MS_VFW_FOURCC: 'Vídeo VFW (AVI)', V_THEORA: 'Theora', V_REAL_RV40: 'RealVideo 4',
    A_AAC: 'AAC', 'A_AAC/MPEG4/LC': 'AAC', A_MPEG_L3: 'MP3', A_MPEG_L2: 'MP2', A_AC3: 'Dolby Digital (AC-3)', A_EAC3: 'Dolby Digital Plus (E-AC-3)',
    A_DTS: 'DTS', A_TRUEHD: 'Dolby TrueHD', A_FLAC: 'FLAC', A_OPUS: 'Opus', A_VORBIS: 'Vorbis', A_PCM_INT_LIT: 'PCM', A_ALAC: 'ALAC',
    S_TEXT_UTF8: 'SubRip (SRT)', S_TEXT_ASS: 'ASS', S_TEXT_SSA: 'SSA', S_ASS: 'ASS', S_SSA: 'SSA', S_TEXT_WEBVTT: 'WebVTT', S_HDMV_PGS: 'PGS (imagem)',
    S_VOBSUB: 'VobSub (imagem)', S_DVBSUB: 'DVB (imagem)', D_WEBVTT_SUBTITLES: 'WebVTT'
  };
  /** Os IDs reais usam "/" (V_MPEG4/ISO/AVC, A_MPEG/L3, A_AAC/MPEG2/LC/SBR…) */
  function mkvCodecName(id) {
    const k = String(id || '').replace(/\//g, '_');
    if (MKV_CODECS[id] || MKV_CODECS[k]) return MKV_CODECS[id] || MKV_CODECS[k];
    const pre = Object.keys(MKV_CODECS).filter(x => k.startsWith(x + '_')).sort((a, b) => b.length - a.length)[0];
    return pre ? MKV_CODECS[pre] : id;
  }

  function vint(b, p, isId) {
    const first = b[p];
    if (first === undefined) return null;
    let len = 1, mask = 0x80;
    while (len <= 8 && !(first & mask)) { len++; mask >>= 1; }
    if (len > 8) return null;
    let val = isId ? first : first & (mask - 1);
    let allOnes = (first & (mask - 1)) === mask - 1;
    for (let i = 1; i < len; i++) {
      if (p + i >= b.length) return null;
      val = val * 256 + b[p + i];
      if (b[p + i] !== 0xFF) allOnes = false;
    }
    return { value: val, len, unknown: !isId && allOnes };
  }
  function ebmlUint(b, s, e) { let v = 0; for (let i = s; i < e; i++) v = v * 256 + b[i]; return v; }
  function ebmlFloat(b, s, e) {
    const dv = new DataView(b.buffer, b.byteOffset + s, e - s);
    return e - s === 4 ? dv.getFloat32(0) : e - s === 8 ? dv.getFloat64(0) : 0;
  }
  function ebmlEach(b, s, e, cb) {
    let p = s;
    while (p < e) {
      const id = vint(b, p, true); if (!id) break;
      const sz = vint(b, p + id.len, false); if (!sz) break;
      const ds = p + id.len + sz.len;
      const de = sz.unknown ? e : Math.min(e, ds + sz.value);
      if (cb(id.value, ds, de, sz.unknown) === false) break;
      if (ds + sz.value > e && !sz.unknown) break;
      p = sz.unknown ? de : ds + sz.value;
    }
  }

  async function parseMatroska(file, res) {
    const head = await readSlice(file, 0, Math.min(file.size, 2 * 1024 * 1024));
    if (u32be(head, 0) !== 0x1A45DFA3) return false;
    let segStart = -1;
    ebmlEach(head, 0, head.length, (id, s) => {
      if (id === EBML_IDS.SEGMENT) { segStart = s; return false; }
    });
    if (segStart < 0) return true;
    let timescale = 1000000;
    const seeks = {};
    const handleInfo = (b, s, e) => ebmlEach(b, s, e, (id, ds, de) => {
      if (id === EBML_IDS.TIMESCALE) timescale = ebmlUint(b, ds, de);
      else if (id === EBML_IDS.DURATION) res._rawDuration = ebmlFloat(b, ds, de);
      else if (id === EBML_IDS.TITLE) res.tags.title = utf8.decode(b.subarray(ds, de));
      else if (id === EBML_IDS.MUXAPP) res.extra['Aplicativo de multiplexação'] = utf8.decode(b.subarray(ds, de));
      else if (id === EBML_IDS.WRITEAPP) res.extra['Aplicativo de escrita'] = utf8.decode(b.subarray(ds, de));
    });
    const handleTracks = (b, s, e) => ebmlEach(b, s, e, (id, ds, de) => {
      if (id !== EBML_IDS.TRACKENTRY) return;
      const tr = { type: 'other', codec: '', lang: '', name: '', default: true };
      ebmlEach(b, ds, de, (tid, ts, te) => {
        if (tid === EBML_IDS.TRACKNUM) tr.number = ebmlUint(b, ts, te);
        else if (tid === EBML_IDS.TRACKTYPE) { const t = ebmlUint(b, ts, te); tr.type = t === 1 ? 'video' : t === 2 ? 'audio' : t === 17 ? 'subtitle' : 'other'; }
        else if (tid === EBML_IDS.CODECID) { tr.codecId = latin1.decode(b.subarray(ts, te)).replace(/\0/g, ''); tr.codec = mkvCodecName(tr.codecId); }
        else if (tid === EBML_IDS.LANG) { const l = latin1.decode(b.subarray(ts, te)).replace(/\0/g, ''); if (!tr.lang && l !== 'und') tr.lang = l; }
        else if (tid === EBML_IDS.LANGBCP) { const l = latin1.decode(b.subarray(ts, te)).replace(/\0/g, ''); if (l !== 'und') tr.lang = l; }
        else if (tid === EBML_IDS.NAME) tr.name = utf8.decode(b.subarray(ts, te));
        else if (tid === EBML_IDS.FLAGDEFAULT) tr.default = !!ebmlUint(b, ts, te);
        else if (tid === EBML_IDS.FLAGFORCED) tr.forced = !!ebmlUint(b, ts, te);
        else if (tid === EBML_IDS.VIDEO) ebmlEach(b, ts, te, (vid, vs, ve) => {
          if (vid === EBML_IDS.PIXW) tr.width = ebmlUint(b, vs, ve);
          if (vid === EBML_IDS.PIXH) tr.height = ebmlUint(b, vs, ve);
        });
        else if (tid === EBML_IDS.AUDIO) ebmlEach(b, ts, te, (aid, as, ae) => {
          if (aid === EBML_IDS.SFREQ) tr.sampleRate = Math.round(ebmlFloat(b, as, ae));
          if (aid === EBML_IDS.CHANNELS) tr.channels = ebmlUint(b, as, ae);
        });
      });
      if (tr.type !== 'other') res.tracks.push(tr);
    });
    const handleChapters = (b, s, e) => ebmlEach(b, s, e, (id, ds, de) => {
      if (id !== EBML_IDS.EDITION || res.chapters.length) return;
      ebmlEach(b, ds, de, (aid, as, ae) => {
        if (aid !== EBML_IDS.ATOM) return;
        const ch = { start: 0, title: '' };
        ebmlEach(b, as, ae, (cid, cs, ce) => {
          if (cid === EBML_IDS.CHSTART) ch.start = ebmlUint(b, cs, ce) / 1e9;
          if (cid === EBML_IDS.CHDISPLAY) ebmlEach(b, cs, ce, (did, dsx, dex) => { if (did === EBML_IDS.CHSTRING && !ch.title) ch.title = utf8.decode(b.subarray(dsx, dex)); });
        });
        res.chapters.push(ch);
      });
    });

    let found = { info: false, tracks: false, chapters: false };
    ebmlEach(head, segStart, head.length, (id, ds, de) => {
      if (id === EBML_IDS.SEEKHEAD) ebmlEach(head, ds, de, (sid, ss, se) => {
        if (sid !== EBML_IDS.SEEK) return;
        let target = 0, pos = 0;
        ebmlEach(head, ss, se, (k, ks, ke) => { if (k === EBML_IDS.SEEKID) target = ebmlUint(head, ks, ke); if (k === EBML_IDS.SEEKPOS) pos = ebmlUint(head, ks, ke); });
        seeks[target] = segStart + pos;
      });
      else if (id === EBML_IDS.INFO && de <= head.length) { handleInfo(head, ds, de); found.info = true; }
      else if (id === EBML_IDS.TRACKS && de <= head.length) { handleTracks(head, ds, de); found.tracks = true; }
      else if (id === EBML_IDS.CHAPTERS && de <= head.length) { handleChapters(head, ds, de); found.chapters = true; }
      else if (id === EBML_IDS.CLUSTER) return false;
    });
    const readElement = async (pos) => {
      const h = await readSlice(file, pos, pos + 16);
      const id = vint(h, 0, true), sz = vint(h, id.len, false);
      if (!id || !sz || sz.unknown || sz.value > 16 * 1024 * 1024) return null;
      const start = pos + id.len + sz.len;
      return { id: id.value, data: await readSlice(file, start, start + sz.value) };
    };
    try {
      if (!found.tracks && seeks[EBML_IDS.TRACKS]) { const el = await readElement(seeks[EBML_IDS.TRACKS]); if (el) handleTracks(el.data, 0, el.data.length); }
      if (!found.info && seeks[EBML_IDS.INFO]) { const el = await readElement(seeks[EBML_IDS.INFO]); if (el) handleInfo(el.data, 0, el.data.length); }
      if (!found.chapters && seeks[EBML_IDS.CHAPTERS]) { const el = await readElement(seeks[EBML_IDS.CHAPTERS]); if (el) handleChapters(el.data, 0, el.data.length); }
    } catch (e) { /* elementos opcionais */ }
    if (res._rawDuration) res.duration = res._rawDuration * timescale / 1e9;
    delete res._rawDuration;
    res.chapters.sort((a, b) => a.start - b.start);
    return true;
  }

  /* ======================= WAV (RIFF) ======================= */
  async function parseWav(file, res) {
    const h = await readSlice(file, 0, 12);
    if (str4(h, 0) !== 'RIFF' || str4(h, 8) !== 'WAVE') return false;
    let p = 12;
    const INFO = { INAM: 'title', IART: 'artist', IPRD: 'album', ICRD: 'date', IGNR: 'genre', ICMT: 'comment', ITRK: 'track', ICOP: 'copyright', ISFT: 'encoder', IENG: 'encodedBy' };
    for (let i = 0; i < 64 && p + 8 <= file.size; i++) {
      const ch = await readSlice(file, p, p + 8);
      const id = str4(ch, 0), size = u32le(ch, 4);
      if (id === 'fmt ') {
        const f = await readSlice(file, p + 8, p + 8 + Math.min(size, 40));
        const fmt = f[0] | (f[1] << 8);
        res.tracks.push({ type: 'audio', codec: fmt === 1 ? 'PCM' : fmt === 3 ? 'PCM float' : fmt === 0xFFFE ? 'PCM (extensível)' : fmt === 0x55 ? 'MP3' : 'Formato 0x' + fmt.toString(16), channels: f[2] | (f[3] << 8), sampleRate: u32le(f, 4), bits: f[14] | (f[15] << 8) });
      } else if (id === 'LIST' && size < 1024 * 1024) {
        const l = await readSlice(file, p + 8, p + 8 + size);
        if (str4(l, 0) === 'INFO') {
          let q = 4;
          while (q + 8 <= l.length) {
            const k = str4(l, q), s = u32le(l, q + 4);
            const v = U.decodeText(l.subarray(q + 8, q + 8 + s)).replace(/\0+$/, '');
            if (INFO[k]) res.tags[INFO[k]] = v; else res.extra[k] = v;
            q += 8 + s + (s & 1);
          }
        }
      } else if ((id === 'id3 ' || id === 'ID3 ') && size < 32 * 1024 * 1024) {
        const blob = file.slice(p + 8, p + 8 + size);
        await parseId3v2(blob, res);
      }
      p += 8 + size + (size & 1);
    }
    return true;
  }

  /**
   * Lê metadados de um File/Blob. Nunca lança exceção: retorna o que conseguir.
   */
  async function read(file) {
    const name = file.name || '';
    const ext = U.ext(name);
    const res = newResult('');
    try {
      const h = await readSlice(file, 0, 12);
      const magic = str4(h, 0);
      if (magic.startsWith('ID3') || ext === 'mp3' || ext === 'mp2' || ext === 'aac') {
        res.container = ext === 'aac' ? 'AAC (ADTS)' : 'MPEG Áudio';
        const off = await parseId3v2(file, res);
        if (await parseFlac(file, res, off)) res.container = 'FLAC';
        else {
          await parseId3v1(file, res);
          if (!res.tracks.length) res.tracks.push({ type: 'audio', codec: ext === 'aac' ? 'AAC' : 'MPEG Áudio (MP3)' });
        }
      } else if (magic === 'fLaC') { res.container = 'FLAC'; await parseFlac(file, res, 0); }
      else if (magic === 'OggS') { res.container = 'Ogg'; await parseOgg(file, res); }
      else if (magic === 'RIFF' && str4(h, 8) === 'WAVE') { res.container = 'WAV (RIFF)'; await parseWav(file, res); }
      else if (magic === 'RIFF' && str4(h, 8) === 'AVI ') { res.container = 'AVI'; }
      else if (u32be(h, 0) === 0x1A45DFA3) { res.container = ext === 'webm' ? 'WebM' : 'Matroska'; await parseMatroska(file, res); }
      else if (str4(h, 4) === 'ftyp' || str4(h, 4) === 'moov' || str4(h, 4) === 'mdat' || str4(h, 4) === 'free' || str4(h, 4) === 'wide') {
        res.container = ['m4a', 'm4b'].includes(ext) ? 'MPEG-4 Áudio' : ext === 'mov' ? 'QuickTime' : ext === '3gp' ? '3GPP' : 'MPEG-4';
        await parseMp4(file, res);
      } else if (h[0] === 0x47 && (ext === 'ts' || ext === 'm2ts' || ext === 'mts')) res.container = 'MPEG-TS';
      else if (u32be(h, 0) === 0x000001BA) res.container = 'MPEG-PS';
      else if (u32be(h, 0) === 0x3026B275) res.container = 'ASF / Windows Media';
      else if (magic.startsWith('FLV')) res.container = 'Flash Video';
      else if (magic === '.RMF') res.container = 'RealMedia';
    } catch (e) {
      VW.log && VW.log.debug('metadata', 'Falha ao ler metadados de ' + name + ': ' + e.message);
    }
    return res;
  }

  VW.metadata = { read, GENRES };
})(window.VW = window.VW || {});
