/* VLC Web — acesso a arquivos de mídia na rede
 * - probe(): descobre se o servidor permite leitura pelo navegador (CORS), se aceita pedidos parciais
 *   (Range), o tamanho e o nome real do arquivo;
 * - RemoteFile: imita um File (slice → arrayBuffer) lendo só os trechos pedidos, para que o leitor de
 *   metadados identifique as faixas (idiomas, codecs, capítulos) sem baixar o arquivo inteiro;
 * - download(): baixa o arquivo inteiro para o armazenamento do navegador (OPFS) ou, se indisponível,
 *   para a memória — necessário para o FFmpeg (trocar faixa de áudio, converter áudio AC‑3/DTS…). */
(function (VW) {
  'use strict';
  const U = VW.util;
  const MIN_READ = 256 * 1024;      // leitura mínima por pedido (agrupa leituras pequenas do analisador)
  const HEAD_FALLBACK = 2 * 1024 * 1024;
  const OPFS_DIR = 'vw-downloads';

  const fetchOpts = (extra) => Object.assign({ referrerPolicy: 'no-referrer', credentials: 'omit', cache: 'no-store' }, extra);

  function totalFromRange(h) {
    const m = /\/\s*(\d+)\s*$/.exec(h || '');
    return m ? +m[1] : NaN;
  }

  /** Lê no máximo "max" bytes do corpo e encerra o download. */
  async function readBody(res, max, ctrl) {
    if (!res.body) { const b = new Uint8Array(await res.arrayBuffer()); return b.subarray(0, max); }
    const reader = res.body.getReader();
    const parts = [];
    let got = 0;
    try {
      while (got < max) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        got += value.length;
      }
    } finally {
      if (got >= max) { try { reader.cancel(); } catch (e) { /* ok */ } if (ctrl) ctrl.abort(); }
    }
    const out = new Uint8Array(Math.min(got, max));
    let p = 0;
    for (const v of parts) { const n = Math.min(v.length, out.length - p); out.set(v.subarray(0, n), p); p += n; if (p >= out.length) break; }
    return out;
  }

  /**
   * Verifica o acesso a uma URL. Nunca lança exceção.
   * Retorna { cors, range, size, type, name, status, error }.
   */
  async function probe(url, { signal } = {}) {
    const info = { url, cors: false, range: false, size: NaN, type: '', name: '', status: 0, error: '', head: null };
    const attempt = async (headers) => {
      const ctrl = new AbortController();
      const onAbort = () => ctrl.abort();
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => ctrl.abort(), 15000);
      try {
        const res = await fetch(url, fetchOpts({ headers, signal: ctrl.signal }));
        return { res, ctrl };
      } finally { clearTimeout(timer); if (signal) signal.removeEventListener('abort', onAbort); }
    };
    let r;
    try {
      r = await attempt({ Range: 'bytes=0-' + (HEAD_FALLBACK - 1) });
    } catch (e) {
      if (signal && signal.aborted) { info.error = 'abort'; return info; }
      // o cabeçalho Range pode exigir "preflight" (OPTIONS) em alguns navegadores; tenta um GET simples
      try { r = await attempt(undefined); } catch (e2) { info.error = (signal && signal.aborted) ? 'abort' : 'cors'; return info; }
    }
    const { res, ctrl } = r;
    info.cors = true;
    info.status = res.status;
    info.type = (res.headers.get('content-type') || '').split(';')[0].trim();
    info.name = U.dispositionName(res.headers.get('content-disposition'));
    if (!res.ok) { info.error = 'http'; try { ctrl.abort(); } catch (e) { /* ok */ } return info; }
    const len = +res.headers.get('content-length');
    if (res.status === 206) {
      info.range = true;
      info.size = totalFromRange(res.headers.get('content-range'));   // só visível com Access-Control-Expose-Headers
    } else if (len > 0) info.size = len;
    // guarda o início do arquivo (serve para o leitor de metadados, mesmo sem suporte a Range)
    try { info.head = await readBody(res, HEAD_FALLBACK, ctrl); } catch (e) { info.head = null; }
    return info;
  }

  /** Objeto semelhante a File que lê trechos de uma URL sob demanda (pedidos Range). */
  class RemoteFile {
    constructor(url, info = {}) {
      this.url = url;
      this.name = info.name || U.urlFileName(url);
      this.type = info.type || '';
      this.size = isFinite(info.size) && info.size > 0 ? info.size : Number.MAX_SAFE_INTEGER;
      this.sizeKnown = isFinite(info.size) && info.size > 0;
      this.range = !!info.range;
      this.blocks = [];          // [{ start, data }]
      this.requests = 0;
      this.maxRequests = 40;     // limite de segurança
      if (info.head && info.head.length) this.blocks.push({ start: 0, data: info.head });
    }
    slice(a = 0, b = this.size) {
      a = Math.max(0, a); b = Math.min(b, this.size);
      return { size: Math.max(0, b - a), arrayBuffer: () => this.read(a, b).then(u => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength)) };
    }
    cached(a, b) {
      for (const bl of this.blocks) {
        const end = bl.start + bl.data.length;
        if (a >= bl.start && (b <= end || (end >= this.size))) return bl.data.subarray(a - bl.start, Math.min(b, end) - bl.start);
      }
      return null;
    }
    async read(a, b) {
      if (b <= a) return new Uint8Array(0);
      const hit = this.cached(a, b);
      if (hit) return hit;
      if (!this.range) throw new Error('o servidor não aceita leitura parcial (Range)');
      if (++this.requests > this.maxRequests) throw new Error('muitas leituras remotas');
      const end = Math.min(this.size, Math.max(b, a + MIN_READ));
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      try {
        const res = await fetch(this.url, fetchOpts({ headers: { Range: `bytes=${a}-${end - 1}` }, signal: ctrl.signal }));
        if (res.status === 200) { ctrl.abort(); this.range = false; throw new Error('o servidor ignorou o pedido parcial'); }
        if (res.status !== 206) { ctrl.abort(); throw new Error('HTTP ' + res.status); }
        const total = totalFromRange(res.headers.get('content-range'));
        if (isFinite(total) && total > 0) { this.size = total; this.sizeKnown = true; }
        const data = await readBody(res, end - a, ctrl);
        this.blocks.push({ start: a, data });
        if (this.blocks.length > 24) this.blocks.splice(1, 1);   // mantém o início do arquivo
        return data.subarray(0, Math.min(b, a + data.length) - a);
      } finally { clearTimeout(timer); }
    }
  }

  /* ---------- download completo ---------- */
  async function opfsDir() {
    if (!navigator.storage || !navigator.storage.getDirectory) return null;
    try {
      const root = await navigator.storage.getDirectory();
      return await root.getDirectoryHandle(OPFS_DIR, { create: true });
    } catch (e) { return null; }
  }

  /** Remove downloads temporários antigos (mais de 12 h; outra aba pode estar usando os recentes). */
  async function cleanup(maxAgeMs = 12 * 3600 * 1000) {
    try {
      if (!navigator.storage || !navigator.storage.getDirectory) return;
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle(OPFS_DIR, { create: false });
      for await (const [n] of dir.entries()) {
        const t = parseInt(n.split('-')[0], 36);
        if (!(t > 0) || Date.now() - t > maxAgeMs) { try { await dir.removeEntry(n); } catch (e) { /* em uso */ } }
      }
    } catch (e) { /* nada a limpar */ }
  }

  async function freeSpace() {
    try { const e = await navigator.storage.estimate(); return Math.max(0, (e.quota || 0) - (e.usage || 0)); } catch (e) { return NaN; }
  }

  /**
   * Baixa a URL inteira. opts: { name, size, signal, onProgress(loaded, total) }.
   * Retorna um File (no disco do navegador quando possível).
   */
  async function download(url, opts = {}) {
    const name = (opts.name || U.urlFileName(url) || 'midia').replace(/[\\/:*?"<>|]/g, '_');
    const res = await fetch(url, fetchOpts({ signal: opts.signal }));
    if (!res.ok) throw new Error('o servidor respondeu HTTP ' + res.status + (res.status === 403 || res.status === 410 ? ' (link expirado ou sem permissão)' : ''));
    const total = +res.headers.get('content-length') || opts.size || NaN;
    const type = (res.headers.get('content-type') || '').split(';')[0] || '';
    const reader = res.body.getReader();
    let loaded = 0, last = 0;
    const report = () => { const now = performance.now(); if (now - last > 200) { last = now; opts.onProgress && opts.onProgress(loaded, total); } };
    // OPFS com escrita em fluxo (Safari e alguns WebViews não têm createWritable na página)
    const dir = (typeof FileSystemFileHandle !== 'undefined' && 'createWritable' in FileSystemFileHandle.prototype) ? await opfsDir() : null;
    if (dir) {
      // nome interno simples: alguns nomes reais ("…", acentos, nomes longos) são recusados pelo OPFS
      const fname = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + (U.ext(name) ? '.' + U.ext(name).replace(/[^a-z0-9]/gi, '').slice(0, 8) : '');
      const fh = await dir.getFileHandle(fname, { create: true });
      const w = await fh.createWritable();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          await w.write(value);
          loaded += value.length;
          report();
        }
        await w.close();
      } catch (e) {
        try { await w.abort(); } catch (e2) { /* ok */ }
        try { await dir.removeEntry(fname); } catch (e2) { /* ok */ }
        throw e;
      }
      const f = await fh.getFile();
      opts.onProgress && opts.onProgress(loaded, loaded);
      return new File([f], name, { type: type || f.type, lastModified: Date.now() });
    }
    // sem OPFS: agrupa em blocos (o navegador pode guardar Blobs grandes em disco)
    const blobs = [];
    let parts = [], partBytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value); partBytes += value.length; loaded += value.length;
      if (partBytes > 32 * 1024 * 1024) { blobs.push(new Blob(parts)); parts = []; partBytes = 0; }
      report();
    }
    if (parts.length) blobs.push(new Blob(parts));
    opts.onProgress && opts.onProgress(loaded, loaded);
    return new File(blobs, name, { type, lastModified: Date.now() });
  }

  VW.remote = { probe, RemoteFile, download, cleanup, freeSpace };
})(window.VW = window.VW || {});
