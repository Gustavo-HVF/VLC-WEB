/* VLC Web — busca e download de legendas online: OpenSubtitles, SubDL e SubSource
 * (equivalente à extensão VLsub do VLC). Cada serviço exige uma chave de API gratuita do próprio usuário. */
(function (VW) {
  'use strict';
  const U = VW.util;

  /* Idiomas: código interno, rótulo e o código usado por cada serviço */
  const LANGS = [
    { id: 'pt-BR', label: 'Português (Brasil)', os: 'pt-br', subdl: 'BR_PT', ss: 'brazilian_portuguese', osorg: 'pob' },
    { id: 'pt-PT', label: 'Português (Portugal)', os: 'pt-pt', subdl: 'PT', ss: 'portuguese', osorg: 'por' },
    { id: 'en', label: 'Inglês', os: 'en', subdl: 'EN', ss: 'english', osorg: 'eng' },
    { id: 'es', label: 'Espanhol', os: 'es', subdl: 'ES', ss: 'spanish', osorg: 'spa' },
    { id: 'fr', label: 'Francês', os: 'fr', subdl: 'FR', ss: 'french', osorg: 'fre' },
    { id: 'it', label: 'Italiano', os: 'it', subdl: 'IT', ss: 'italian', osorg: 'ita' },
    { id: 'de', label: 'Alemão', os: 'de', subdl: 'DE', ss: 'german', osorg: 'ger' },
    { id: 'ja', label: 'Japonês', os: 'ja', subdl: 'JA', ss: 'japanese', osorg: 'jpn' },
    { id: 'ko', label: 'Coreano', os: 'ko', subdl: 'KO', ss: 'korean', osorg: 'kor' },
    { id: 'ru', label: 'Russo', os: 'ru', subdl: 'RU', ss: 'russian', osorg: 'rus' },
    { id: 'ar', label: 'Árabe', os: 'ar', subdl: 'AR', ss: 'arabic', osorg: 'ara' }
  ];
  const langById = id => LANGS.find(l => l.id === id);
  /** Converte o idioma devolvido por um serviço ("pt-br", "BR_PT", "Brazilian_portuguese", "English"…) em rótulo legível. */
  function langLabel(v) {
    const s = String(v || '').toLowerCase().replace(/[_\s]/g, '-');
    const l = LANGS.find(x => [x.id.toLowerCase(), x.os, x.subdl.toLowerCase().replace('_', '-'), x.ss.replace(/_/g, '-'), x.label.toLowerCase()].includes(s)) ||
      (s === 'portuguese' ? langById('pt-PT') : s.includes('brazil') ? langById('pt-BR') : null);
    return l ? l.label : (v || '—');
  }

  const PROVIDERS = {
    opensubtitles: { name: 'OpenSubtitles', site: 'https://www.opensubtitles.org/pb', keyUrl: 'https://www.opensubtitles.com/consumers', keySetting: 'osApiKey' },
    subdl: { name: 'SubDL', site: 'https://subdl.com', keyUrl: 'https://subdl.com/api-doc', keySetting: 'subdlApiKey' },
    subsource: { name: 'SubSource', site: 'https://subsource.net', keyUrl: 'https://subsource.net/api-docs', keySetting: 'subsourceApiKey' }
  };

  /** Extrai título, ano, temporada e episódio do nome do arquivo. */
  function guessFromName(name) {
    const base = U.stripExt(U.baseName(name || ''));
    let season = 0, episode = 0, year = 0, cut = base.length;
    const se = base.match(/[sS](\d{1,2})[ ._-]?[eE](\d{1,3})/) || base.match(/(?:^|[ ._-])(\d{1,2})x(\d{2,3})(?:[ ._-]|$)/);
    if (se) { season = +se[1]; episode = +se[2]; cut = Math.min(cut, se.index); }
    const y = base.match(/[[(. _-]((?:19|20)\d{2})(?:[\]). _-]|$)/);
    if (y && y.index > 0) { year = +y[1]; cut = Math.min(cut, y.index); }
    const tag = base.search(/[ ._-](2160p|1080p|720p|480p|4k|uhd|web[ ._-]?dl|webrip|blu-?ray|brrip|bdrip|hdtv|dvdrip|hdrip|x26[45]|h\.?26[45]|hevc|aac|ddp?5|dual|dublado|legendado|remux|proper|repack|extended|unrated|nf|amzn)(?:[ ._-]|$)/i);
    if (tag > 0) cut = Math.min(cut, tag);
    let title = base.slice(0, cut).replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/[._]+/g, ' ').replace(/\s+-\s*$/, '').replace(/\s+/g, ' ').trim();
    if (!title) title = base.replace(/[._]+/g, ' ').trim();
    return { title, year, season, episode };
  }

  /** Hash de arquivo da OpenSubtitles (tamanho + soma dos primeiros e últimos 64 KB em palavras de 64 bits). */
  async function osHash(file) {
    const CH = 65536;
    if (!file || file.size < CH || typeof BigInt === 'undefined') return null;
    const head = new DataView(await file.slice(0, CH).arrayBuffer());
    const tail = new DataView(await file.slice(Math.max(0, file.size - CH)).arrayBuffer());
    let h = BigInt(file.size);
    for (const dv of [head, tail]) for (let i = 0; i + 8 <= dv.byteLength; i += 8) h += dv.getBigUint64(i, true);
    h &= (BigInt(1) << BigInt(64)) - BigInt(1);
    return h.toString(16).padStart(16, '0');
  }

  class SubSearch {
    constructor(settings, log) {
      this.settings = settings;
      this.log = log;
    }

    hasKey(p) { return !!(this.settings.get(PROVIDERS[p].keySetting) || '').trim(); }

    proxied(url) {
      const p = (this.settings.get('subsCorsProxy') || '').trim();
      if (!p) return url;
      return p.includes('{url}') ? p.replace('{url}', encodeURIComponent(url)) : p + encodeURIComponent(url);
    }

    async request(provider, url, opts = {}) {
      let res;
      // sem proxy CORS próprio, no navegador pelo celular (Termux-Toons) o pedido passa pelo celular
      const viaPhone = U.phone && !(this.settings.get('subsCorsProxy') || '').trim();
      try { res = viaPhone ? await U.phoneFetch(url, opts) : await fetch(this.proxied(url), opts); }
      catch (e) {
        throw new Error(`${PROVIDERS[provider].name}: o navegador não conseguiu acessar o serviço (bloqueio de origem/CORS ou sem conexão). Use "Abrir no site" ou configure um proxy CORS na aba "Chaves de API".`);
      }
      if (!res.ok) {
        let detail = '';
        try { const j = await res.clone().json(); detail = j.message || j.error || j.errors && j.errors.join(', ') || ''; } catch (e) { /* sem JSON */ }
        const known = { 401: 'chave de API inválida ou ausente', 403: 'acesso negado (verifique a chave de API)', 406: 'limite de downloads do dia atingido', 429: 'muitas requisições — aguarde um pouco' }[res.status];
        throw new Error(`${PROVIDERS[provider].name}: ${known || 'erro HTTP ' + res.status}${detail ? ' — ' + detail : ''}`);
      }
      return res;
    }

    /**
     * Busca em todos os serviços escolhidos. q: { title, year, season, episode, langs: [ids], providers: [...], file }
     * Retorna { results, errors }.
     */
    async search(q) {
      const tasks = q.providers.map(p => this['search_' + p](q).then(r => ({ p, r })).catch(e => ({ p, e })));
      const out = await Promise.all(tasks);
      const results = [], errors = [];
      for (const o of out) {
        if (o.e) { errors.push(o.e.message); this.log.warn('subsearch', o.e.message); }
        else results.push(...o.r);
      }
      const order = q.langs;
      results.sort((a, b) => (b.hashMatch ? 1 : 0) - (a.hashMatch ? 1 : 0) || order.indexOf(a.langId) - order.indexOf(b.langId) || (b.downloads || 0) - (a.downloads || 0));
      return { results, errors };
    }

    /* ---------------- OpenSubtitles (api.opensubtitles.com) ---------------- */
    osHeaders(json) {
      const h = { 'Api-Key': this.settings.get('osApiKey').trim(), Accept: 'application/json' };
      if (json) h['Content-Type'] = 'application/json';
      const tok = this.settings.get('osToken');
      if (tok) h.Authorization = 'Bearer ' + tok;
      return h;
    }
    osBase() { const b = this.settings.get('osBaseUrl'); return b ? 'https://' + b.replace(/^https?:\/\//, '').replace(/\/+$/, '') + '/api/v1' : 'https://api.opensubtitles.com/api/v1'; }

    async osLogin(username, password) {
      const res = await this.request('opensubtitles', this.osBase() + '/login', { method: 'POST', headers: this.osHeaders(true), body: JSON.stringify({ username, password }) });
      const j = await res.json();
      if (!j.token) throw new Error('OpenSubtitles: login recusado');
      this.settings.set('osToken', j.token);
      this.settings.set('osUser', username);
      if (j.base_url) this.settings.set('osBaseUrl', j.base_url);
      return j;
    }
    osLogout() { this.settings.set('osToken', ''); this.settings.set('osUser', ''); this.settings.set('osBaseUrl', ''); }

    async search_opensubtitles(q) {
      if (!this.hasKey('opensubtitles')) throw new Error('OpenSubtitles: informe a chave de API (aba "Chaves de API")');
      const langs = q.langs.map(langById).filter(Boolean).map(l => l.os).sort().join(',');
      const runs = [];
      const base = { languages: langs };
      if (q.season) base.season_number = String(q.season);
      if (q.episode) base.episode_number = String(q.episode);
      if (q.hash) runs.push(Object.assign({ moviehash: q.hash }, base));
      if (q.title) runs.push(Object.assign({ query: q.title.toLowerCase() }, q.year && !q.season ? { year: String(q.year) } : {}, base));
      const seen = new Set(), items = [];
      for (const params of runs) {
        // a API pede parâmetros em ordem alfabética e em minúsculas (do contrário redireciona)
        const qs = Object.keys(params).sort().map(k => encodeURIComponent(k) + '=' + encodeURIComponent(String(params[k]).toLowerCase())).join('&');
        const res = await this.request('opensubtitles', `${this.osBase()}/subtitles?${qs}`, { headers: this.osHeaders() });
        const j = await res.json();
        for (const d of j.data || []) {
          const a = d.attributes || {}, f = (a.files || [])[0];
          if (!f || seen.has(f.file_id)) continue;
          seen.add(f.file_id);
          const fd = a.feature_details || {};
          items.push({
            provider: 'opensubtitles', id: f.file_id, fileName: f.file_name || '', release: a.release || fd.movie_name || fd.title || '',
            title: fd.movie_name || fd.title || '', lang: langLabel(a.language), langId: (LANGS.find(l => l.os === String(a.language).toLowerCase()) || {}).id,
            downloads: a.download_count || 0, rating: a.ratings || 0, hi: !!a.hearing_impaired, ai: !!(a.ai_translated || a.machine_translated),
            hashMatch: a.moviehash_match !== undefined ? !!a.moviehash_match : !!params.moviehash, season: fd.season_number, episode: fd.episode_number, uploader: (a.uploader || {}).name || '', page: a.url || ''
          });
        }
      }
      return items;
    }

    async download_opensubtitles(item) {
      const res = await this.request('opensubtitles', this.osBase() + '/download', { method: 'POST', headers: this.osHeaders(true), body: JSON.stringify({ file_id: item.id, sub_format: 'srt' }) });
      const j = await res.json();
      if (!j.link) throw new Error('OpenSubtitles: ' + (j.message || 'download não autorizado'));
      if (typeof j.remaining === 'number') this.log.info('subsearch', `OpenSubtitles: ${j.remaining} downloads restantes hoje`);
      const r2 = await this.request('opensubtitles', j.link);
      return { blob: await r2.blob(), name: j.file_name || item.fileName || (item.release || 'legenda') + '.srt', remaining: j.remaining };
    }

    /* ---------------- SubDL (api.subdl.com) ---------------- */
    async search_subdl(q) {
      if (!this.hasKey('subdl')) throw new Error('SubDL: informe a chave de API (aba "Chaves de API")');
      const p = new URLSearchParams({
        api_key: this.settings.get('subdlApiKey').trim(), film_name: q.title,
        languages: q.langs.map(langById).filter(Boolean).map(l => l.subdl).join(','),
        type: q.season ? 'tv' : 'movie', subs_per_page: '30', releases: '1', hi: '1', comment: '1'
      });
      if (q.season) p.set('season_number', String(q.season));
      if (q.episode) p.set('episode_number', String(q.episode));
      if (q.year && !q.season) p.set('year', String(q.year));
      const res = await this.request('subdl', 'https://api.subdl.com/api/v1/subtitles?' + p.toString());
      const j = await res.json();
      if (j.status === false) throw new Error('SubDL: ' + (j.error || 'nenhum resultado'));
      const film = (j.results || [])[0] || {};
      return (j.subtitles || []).filter(s => s.url).map(s => ({
        provider: 'subdl', id: s.url, release: s.release_name || s.name || (s.releases || [])[0] || '', title: film.name || '',
        lang: langLabel(s.language || s.lang), langId: (LANGS.find(l => l.subdl === String(s.language || s.lang || '').toUpperCase()) || {}).id,
        hi: !!s.hi, season: s.season, episode: s.episode, uploader: s.author || '', comment: s.comment || '',
        url: s.url.startsWith('http') ? s.url : 'https://dl.subdl.com' + s.url
      }));
    }

    async download_subdl(item) {
      const res = await this.request('subdl', item.url);
      return { blob: await res.blob(), name: (item.release || 'legenda') + '.zip' };
    }

    /* ---------------- SubSource (api.subsource.net) ---------------- */
    ssURL(path, params) {
      const p = new URLSearchParams(params || {});
      p.set('api_key', this.settings.get('subsourceApiKey').trim()); // parâmetro de consulta evita a pré-verificação CORS do cabeçalho X-API-Key
      return 'https://api.subsource.net/api/v1' + path + '?' + p.toString();
    }

    async search_subsource(q) {
      if (!this.hasKey('subsource')) throw new Error('SubSource: informe a chave de API (aba "Chaves de API")');
      const sp = { searchType: 'text', q: q.title.toLowerCase() };
      if (q.season) sp.season = String(q.season);
      const res = await this.request('subsource', this.ssURL('/movies/search', sp));
      const movies = ((await res.json()).data || []);
      if (!movies.length) return [];
      const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const want = norm(q.title);
      const score = m => (norm(m.title) === want || norm(m.alternateTitle) === want ? 2 : 0) + (q.year && +m.releaseYear === q.year ? 1 : 0);
      const movie = movies.slice().sort((a, b) => score(b) - score(a))[0];
      const items = [];
      for (const l of q.langs.map(langById).filter(x => x && x.ss)) {
        const params = { movieId: String(movie.movieId), language: l.ss, limit: '100' };
        if (q.season) params.seasonNumber = String(q.season);
        if (q.episode) params.episodeNumber = String(q.episode);
        const r = await this.request('subsource', this.ssURL('/subtitles', params));
        for (const s of ((await r.json()).data || [])) {
          items.push({
            provider: 'subsource', id: s.subtitleId, release: (s.releaseInfo || []).join(' / ') || movie.title || '', title: movie.title || '',
            lang: langLabel(s.language), langId: l.id, hi: !!s.hearingImpaired, comment: s.commentary || '',
            uploader: ((s.contributors || [])[0] || {}).displayname || ''
          });
        }
      }
      return items;
    }

    async download_subsource(item) {
      const res = await this.request('subsource', this.ssURL('/subtitles/' + encodeURIComponent(item.id) + '/download'));
      return { blob: await res.blob(), name: (item.release || 'legenda') + '.zip' };
    }

    /* ---------------- download + extração ---------------- */
    /** Baixa a legenda e devolve um File pronto para o reprodutor (escolhe o episódio certo em pacotes). */
    async download(item, hint = {}) {
      const r = await this['download_' + item.provider](item);
      return extractSubtitle(r.blob, r.name, hint);
    }

    /** Endereço de busca no site (funciona sem chave de API). */
    siteURL(provider, title, langId) {
      const q = encodeURIComponent(title || '');
      const l = langById(langId) || LANGS[0];
      switch (provider) {
        case 'opensubtitles': return `https://www.opensubtitles.org/pb/search2/sublanguageid-${l.osorg}/moviename-${q}`;
        case 'subdl': return `https://subdl.com/search/${q}`;
        case 'subsource': return `https://subsource.net/search/${q}`;
      }
      return '';
    }
  }

  const SUB_RE = /\.(srt|ass|ssa|vtt|sub|sbv|smi|ttml|dfxp|lrc|txt)$/i;

  /** Recebe o arquivo baixado (legenda solta ou ZIP) e devolve a legenda mais adequada como File. */
  async function extractSubtitle(blob, name, hint = {}) {
    const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
    if (U.isRar(head) || U.is7z(head)) throw new Error('A legenda veio compactada em RAR/7z, formato que o navegador não abre. Use "Abrir no site", extraia o arquivo e arraste a legenda para o reprodutor.');
    if (!U.isZip(head)) {
      const n = SUB_RE.test(name) ? name : U.stripExt(name) + '.srt';
      return { file: new File([blob], n, { type: 'text/plain' }), others: [] };
    }
    const entries = (await U.unzip(blob)).filter(e => SUB_RE.test(e.name) && !/__MACOSX/i.test(e.name));
    if (!entries.length) throw new Error('O arquivo baixado não contém legendas reconhecíveis');
    const ep = hint.season && hint.episode ? new RegExp(`(s0*${hint.season}[ ._-]?e0*${hint.episode}(?!\\d))|(\\b0*${hint.season}x0*${hint.episode}(?!\\d))`, 'i') : null;
    const rank = e => (ep && ep.test(e.name) ? 100 : 0) + (/\.srt$/i.test(e.name) ? 10 : /\.(ass|ssa|vtt)$/i.test(e.name) ? 5 : 0) + Math.min(5, e.size / 20000);
    entries.sort((a, b) => rank(b) - rank(a));
    const best = entries[0];
    const data = await best.data();
    return { file: new File([data], U.baseName(best.name), { type: 'text/plain' }), others: entries.slice(1).map(e => e.name) };
  }

  /** Extrai todas as legendas de um ZIP (usado ao arrastar um .zip para o reprodutor). */
  async function extractAllSubtitles(file) {
    const entries = (await U.unzip(file)).filter(e => SUB_RE.test(e.name) && !/__MACOSX/i.test(e.name));
    const out = [];
    for (const e of entries) out.push(new File([await e.data()], U.baseName(e.name), { type: 'text/plain' }));
    return out;
  }

  VW.SubSearch = SubSearch;
  VW.subsearch = { LANGS, PROVIDERS, guessFromName, osHash, extractSubtitle, extractAllSubtitles, langLabel, langById };
})(window.VW = window.VW || {});
