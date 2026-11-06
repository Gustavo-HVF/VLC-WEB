/* VLC Web — biblioteca de mídia (IndexedDB), pastas do computador, rádios da Internet e podcasts */
(function (VW) {
  'use strict';
  const U = VW.util;

  const DB_NAME = 'vlcweb', DB_VER = 1;
  const STORES = ['library', 'folders', 'podcasts', 'handles'];

  function openDB() {
    return new Promise((resolve, reject) => {
      if (!U.supports.indexedDB) return reject(new Error('IndexedDB indisponível'));
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  class Store {
    constructor() { this.dbp = null; }
    db() { return this.dbp || (this.dbp = openDB()); }
    async tx(store, mode, fn) {
      const db = await this.db();
      return new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const s = t.objectStore(store);
        let result;
        Promise.resolve(fn(s)).then(r => { result = r; });
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      });
    }
    all(store) { return this.tx(store, 'readonly', s => new Promise(r => { const q = s.getAll(); q.onsuccess = () => r(q.result || []); })); }
    get(store, id) { return this.tx(store, 'readonly', s => new Promise(r => { const q = s.get(id); q.onsuccess = () => r(q.result || null); })); }
    put(store, obj) { return this.tx(store, 'readwrite', s => { s.put(obj); }); }
    del(store, id) { return this.tx(store, 'readwrite', s => { s.delete(id); }); }
    clear(store) { return this.tx(store, 'readwrite', s => { s.clear(); }); }
  }

  class Library extends U.Emitter {
    constructor(log) {
      super();
      this.log = log;
      this.store = new Store();
      this.items = [];
      this.folders = [];
      this.podcasts = [];
    }

    async init() {
      try {
        this.items = await this.store.all('library');
        this.folders = await this.store.all('folders');
        this.podcasts = await this.store.all('podcasts');
      } catch (e) {
        this.log.warn('library', 'Biblioteca indisponível: ' + e.message);
      }
      this.emit('change');
    }

    /** Adiciona itens da lista de reprodução à biblioteca (URLs e arquivos com handle persistente). */
    async addItems(items) {
      let n = 0;
      for (const it of items) {
        if (it.stream) continue;
        const rec = {
          id: it.url ? 'u:' + it.url : it.key,
          title: it.displayTitle || it.title, url: it.url || '', kind: it.kind, duration: it.duration,
          meta: Object.assign({}, it.meta), name: it.file ? it.file.name : '', size: it.file ? it.file.size : 0,
          handle: it.handle || null, addedAt: Date.now()
        };
        if (!rec.url && !rec.handle) rec.unavailable = true;
        try { await this.store.put('library', rec); n++; } catch (e) {
          // alguns navegadores não serializam handles
          delete rec.handle; rec.unavailable = !rec.url;
          await this.store.put('library', rec).catch(() => {}); n++;
        }
      }
      this.items = await this.store.all('library');
      this.emit('change');
      return n;
    }

    async remove(ids) {
      for (const id of ids) await this.store.del('library', id);
      this.items = await this.store.all('library');
      this.emit('change');
    }

    async clear() { await this.store.clear('library'); this.items = []; this.emit('change'); }

    /** Converte registro da biblioteca em dados de item de lista (pede permissão para handles). */
    async resolve(rec) {
      if (rec.url) return { url: rec.url, title: rec.title, meta: rec.meta, duration: rec.duration };
      if (rec.handle) {
        const ok = await verifyPermission(rec.handle);
        if (!ok) throw new Error('Permissão negada para ' + rec.name);
        const file = await rec.handle.getFile();
        return { file, handle: rec.handle, title: rec.title, meta: rec.meta, duration: rec.duration };
      }
      throw new Error(`"${rec.name || rec.title}" é um arquivo local sem acesso persistente. Abra-o novamente.`);
    }

    /* ---------- pastas (Meu computador) ---------- */
    async addFolder() {
      if (!U.supports.dirPicker) throw new Error('Este navegador não permite acesso persistente a pastas. Use Mídia → Abrir pasta.');
      const handle = await window.showDirectoryPicker({ id: 'vlcweb-folder', mode: 'read' });
      const rec = { id: 'd:' + handle.name + ':' + Date.now(), name: handle.name, handle };
      await this.store.put('folders', rec);
      this.folders = await this.store.all('folders');
      this.emit('change');
      return rec;
    }
    async removeFolder(id) { await this.store.del('folders', id); this.folders = await this.store.all('folders'); this.emit('change'); }
    async listFolder(rec, sub) {
      const dir = sub || rec.handle;
      if (!(await verifyPermission(rec.handle))) throw new Error('Permissão negada');
      const dirs = [], files = [];
      for await (const e of dir.values()) {
        if (e.kind === 'directory') dirs.push(e);
        else if (U.isMediaFile(e.name) || U.kindOf(e.name) === 'playlist') files.push(e);
      }
      dirs.sort((a, b) => U.naturalCompare(a.name, b.name));
      files.sort((a, b) => U.naturalCompare(a.name, b.name));
      return { dirs, files };
    }

    /* ---------- Rádios da Internet (diretório radio-browser.info) ---------- */
    async radioSearch(query, opts = {}) {
      const hosts = ['https://de1.api.radio-browser.info', 'https://fi1.api.radio-browser.info', 'https://nl1.api.radio-browser.info', 'https://at1.api.radio-browser.info'];
      const params = new URLSearchParams({ limit: String(opts.limit || 80), hidebroken: 'true', order: 'clickcount', reverse: 'true' });
      if (query) params.set('name', query);
      if (opts.country) params.set('countrycode', opts.country);
      if (opts.tag) params.set('tag', opts.tag);
      let lastErr;
      for (const h of hosts) {
        try {
          const res = await U.phoneFetch(`${h}/json/stations/search?${params}`, { headers: { Accept: 'application/json' } });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const list = await res.json();
          return list.map(s => ({
            id: s.stationuuid, title: s.name.trim(), url: s.url_resolved || s.url, codec: s.codec, bitrate: s.bitrate,
            country: s.country, tags: s.tags, favicon: s.favicon, homepage: s.homepage, https: (s.url_resolved || s.url).startsWith('https:')
          }));
        } catch (e) { lastErr = e; }
      }
      throw new Error('Não foi possível acessar o diretório de rádios: ' + (lastErr && lastErr.message));
    }

    /* ---------- Podcasts (RSS) ---------- */
    async addPodcast(url) {
      const feed = await this.fetchFeed(url);
      const rec = { id: 'p:' + url, url, title: feed.title, image: feed.image };
      await this.store.put('podcasts', rec);
      this.podcasts = await this.store.all('podcasts');
      this.emit('change');
      return feed;
    }
    async removePodcast(id) { await this.store.del('podcasts', id); this.podcasts = await this.store.all('podcasts'); this.emit('change'); }
    async fetchFeed(url) {
      let res;
      try { res = await U.phoneFetch(url); } catch (e) { throw new Error('O servidor do feed não permite acesso direto pelo navegador (CORS).'); }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      const doc = new DOMParser().parseFromString(text, 'application/xml');
      if (doc.querySelector('parsererror')) throw new Error('Feed RSS inválido');
      const ch = doc.querySelector('channel') || doc.documentElement;
      const txt = (el, sel) => { const n = el.querySelector(sel); return n ? n.textContent.trim() : ''; };
      const img = doc.querySelector('channel > image > url');
      const itunesImg = Array.from(ch.children).find(n => n.localName === 'image' && n.getAttribute('href'));
      const episodes = Array.from(doc.querySelectorAll('item')).map(it => {
        const enc = it.querySelector('enclosure');
        const dur = Array.from(it.children).find(n => n.localName === 'duration');
        return {
          title: txt(it, 'title'), url: enc ? enc.getAttribute('url') : '', type: enc ? enc.getAttribute('type') : '',
          date: txt(it, 'pubDate'), duration: dur ? U.parseTime(dur.textContent) : NaN, description: txt(it, 'description').replace(/<[^>]+>/g, '').slice(0, 300)
        };
      }).filter(e => e.url);
      return { title: txt(ch, 'title') || url, image: img ? img.textContent : itunesImg ? itunesImg.getAttribute('href') : '', episodes };
    }

    /* ---------- Handles de arquivos recentes ---------- */
    async saveHandle(key, handle) { try { await this.store.put('handles', { id: key, handle, at: Date.now() }); } catch (e) { /* ignora */ } }
    async getHandle(key) { try { const r = await this.store.get('handles', key); return r && r.handle; } catch (e) { return null; } }
  }

  async function verifyPermission(handle) {
    if (!handle.queryPermission) return true;
    const opts = { mode: 'read' };
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    return (await handle.requestPermission(opts)) === 'granted';
  }

  Library.verifyPermission = verifyPermission;
  VW.Library = Library;
})(window.VW = window.VW || {});
