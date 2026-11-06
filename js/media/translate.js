/* VLC Web — tradução de legendas
 * Mecanismos: tradutor integrado do navegador (Translator API do Chrome/Edge, roda no próprio computador),
 * MyMemory (serviço online gratuito, com limite diário) e LibreTranslate (servidor configurável). */
(function (VW) {
  'use strict';
  const U = VW.util;

  const LANGS = [
    ['pt-BR', 'Português (Brasil)'], ['pt-PT', 'Português (Portugal)'], ['en', 'Inglês'], ['es', 'Espanhol'], ['fr', 'Francês'],
    ['it', 'Italiano'], ['de', 'Alemão'], ['ja', 'Japonês'], ['ko', 'Coreano'], ['zh', 'Chinês'], ['ru', 'Russo'], ['ar', 'Árabe'],
    ['nl', 'Holandês'], ['pl', 'Polonês'], ['tr', 'Turco'], ['hi', 'Hindi']
  ];
  const ENGINES = {
    builtin: 'Tradutor do navegador (no próprio computador)',
    mymemory: 'MyMemory (online, gratuito, limite diário)',
    libre: 'LibreTranslate (servidor configurável)'
  };
  const base = code => String(code || '').split('-')[0].toLowerCase();
  const nameOf = code => (LANGS.find(l => l[0] === code) || LANGS.find(l => base(l[0]) === base(code)) || [code, code])[1];

  /** Normaliza códigos de idioma vindos de nomes de arquivo/faixas ("eng", "pt-BR", "English", "por") */
  function normLang(v) {
    const s = String(v || '').toLowerCase().trim();
    const map = { eng: 'en', english: 'en', inglês: 'en', ingles: 'en', por: 'pt-PT', portuguese: 'pt-PT', pob: 'pt-BR', 'pt-br': 'pt-BR', 'pt_br': 'pt-BR', brazilian: 'pt-BR', 'pt-pt': 'pt-PT', pt: 'pt-PT',
      spa: 'es', spanish: 'es', fre: 'fr', fra: 'fr', french: 'fr', ita: 'it', italian: 'it', ger: 'de', deu: 'de', german: 'de', jpn: 'ja', japanese: 'ja', kor: 'ko', korean: 'ko',
      chi: 'zh', zho: 'zh', chinese: 'zh', rus: 'ru', russian: 'ru', ara: 'ar', arabic: 'ar', dut: 'nl', nld: 'nl', pol: 'pl', tur: 'tr', hin: 'hi' };
    if (map[s]) return map[s];
    const two = s.match(/^([a-z]{2})(?:[-_]|$)/);
    return two ? (LANGS.find(l => base(l[0]) === two[1]) || [two[1]])[0] : '';
  }

  /** Converte o HTML de uma fala em texto simples (preservando quebras de linha) e de volta. */
  function cueToText(html) {
    const d = document.createElement('div');
    d.innerHTML = String(html).replace(/<br\s*\/?>/gi, '\n');
    return d.textContent;
  }
  function textToCue(text, italic) {
    const h = U.escapeHtml(text).replace(/\r?\n/g, '<br>');
    return italic ? '<i>' + h + '</i>' : h;
  }

  class SubtitleTranslator {
    constructor(settings, log) { this.settings = settings; this.log = log; }

    get builtinSupported() { return typeof window.Translator !== 'undefined' && typeof window.Translator.create === 'function'; }

    /** "available" | "downloadable" | "downloading" | "unavailable" | "unsupported" | "timeout" */
    async builtinStatus(src, tgt) {
      if (!this.builtinSupported) return 'unsupported';
      try {
        // em alguns ambientes a API existe mas não responde; não deixa a interface presa
        return await Promise.race([
          window.Translator.availability({ sourceLanguage: base(src), targetLanguage: base(tgt) }),
          new Promise(res => setTimeout(() => res('timeout'), 5000))
        ]);
      } catch (e) { return 'unavailable'; }
    }

    /** Detecta o idioma de um conjunto de falas (API LanguageDetector do navegador, quando existir). */
    async detect(texts) {
      const sample = texts.slice(0, 40).join('\n').slice(0, 2000);
      if (typeof window.LanguageDetector !== 'undefined') {
        try {
          const d = await window.LanguageDetector.create();
          const r = await d.detect(sample);
          if (r && r[0] && r[0].confidence > 0.5) return normLang(r[0].detectedLanguage);
        } catch (e) { /* indisponível */ }
      }
      // heurística simples por palavras frequentes
      const words = sample.toLowerCase().match(/[a-zà-ÿ']+/g) || [];
      const score = { en: ['the', 'you', 'and', 'what', 'is', 'to', 'it', "i'm", 'this', 'that'], es: ['que', 'el', 'la', 'es', 'por', 'qué', 'no', 'los', 'está', 'eso'],
        'pt-BR': ['você', 'não', 'que', 'é', 'está', 'isso', 'eu', 'uma', 'com', 'pra'], fr: ['le', 'la', 'les', 'est', 'vous', 'pas', 'je', 'que', 'une', "c'est"],
        it: ['che', 'non', 'il', 'è', 'per', 'sono', 'una', 'questo', 'cosa', 'mi'], de: ['der', 'die', 'und', 'ist', 'nicht', 'ich', 'das', 'sie', 'du', 'ein'] };
      let best = '', bestN = 0;
      for (const [l, list] of Object.entries(score)) { const n = words.filter(w => list.includes(w)).length; if (n > bestN) { best = l; bestN = n; } }
      return bestN >= 3 ? best : '';
    }

    /**
     * Cria uma função de tradução para o mecanismo escolhido.
     * Retorna { batch, concurrency, run(texts[]) → Promise<string[]> }.
     */
    async engine(kind, src, tgt, onStatus) {
      const S = this.settings;
      if (kind === 'builtin') {
        if (!this.builtinSupported) throw new Error('Este navegador não tem tradutor integrado (disponível no Chrome e no Edge para computador, versão 138 ou superior).');
        const st = await this.builtinStatus(src, tgt);
        if (st === 'unavailable') throw new Error(`O tradutor do navegador não oferece ${nameOf(src)} → ${nameOf(tgt)}.`);
        if (st === 'timeout') throw new Error('O tradutor do navegador não respondeu. Escolha outro mecanismo (MyMemory ou LibreTranslate).');
        const t = await window.Translator.create({
          sourceLanguage: base(src), targetLanguage: base(tgt),
          monitor(m) { m.addEventListener('downloadprogress', e => onStatus && onStatus('Baixando o modelo de tradução… ' + Math.round((e.loaded || 0) * 100) + '%')); }
        });
        return { batch: 1, concurrency: 3, run: async texts => [await t.translate(texts[0])] };
      }
      if (kind === 'mymemory') {
        const email = (S.get('mymemoryEmail') || '').trim();
        const pair = (src === 'auto' ? 'autodetect' : src) + '|' + tgt;
        return {
          batch: 1, concurrency: 3,
          run: async texts => {
            const text = texts[0];
            const parts = text.length > 480 ? text.split('\n') : [text];
            const out = [];
            for (const part of parts) {
              const url = 'https://api.mymemory.translated.net/get?' + new URLSearchParams(Object.assign({ q: part, langpair: pair }, email ? { de: email } : {}));
              let res;
              try { res = await U.phoneFetch(url); } catch (e) { throw new Error('MyMemory inacessível (sem conexão ou bloqueado).'); }
              const j = await res.json().catch(() => ({}));
              const tr = j.responseData && j.responseData.translatedText;
              if (j.quotaFinished || /MYMEMORY WARNING/i.test(tr || '') || res.status === 429 || j.responseStatus === 429) {
                throw new Error('O limite diário gratuito do MyMemory acabou. Informe um e-mail nas opções (o limite aumenta) ou use outro mecanismo.');
              }
              if (!tr || (j.responseStatus && +j.responseStatus !== 200)) throw new Error('MyMemory: ' + (j.responseDetails || 'erro ' + (j.responseStatus || res.status)));
              out.push(tr);
            }
            return [out.join('\n')];
          }
        };
      }
      if (kind === 'libre') {
        const url = (S.get('libreUrl') || '').trim().replace(/\/+$/, '');
        if (!url) throw new Error('Informe o endereço do servidor LibreTranslate nas opções.');
        const key = (S.get('libreKey') || '').trim();
        return {
          batch: 25, concurrency: 2,
          run: async texts => {
            let res;
            try {
              res = await fetch(url + '/translate', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(Object.assign({ q: texts, source: src === 'auto' ? 'auto' : base(src), target: base(tgt), format: 'text' }, key ? { api_key: key } : {}))
              });
            } catch (e) { throw new Error('Servidor LibreTranslate inacessível (endereço errado, sem conexão ou bloqueio CORS).'); }
            const j = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error('LibreTranslate: ' + (j.error || 'erro HTTP ' + res.status));
            const t = j.translatedText;
            return Array.isArray(t) ? t : [t];
          }
        };
      }
      throw new Error('Mecanismo de tradução desconhecido');
    }

    /**
     * Traduz uma lista de falas. cues: [{ html }]. Atualiza cada fala em "target" assim que traduzida
     * (começando pela posição "startIndex"), para que a legenda possa ser assistida durante a tradução.
     */
    async translateCues(cues, target, opts) {
      const { engine, signal, onProgress, startIndex = 0 } = opts;
      const order = cues.map((c, i) => i);
      const s = U.clamp(startIndex, 0, Math.max(0, cues.length - 1));
      const seq = order.slice(s).concat(order.slice(0, s));
      const cache = new Map();
      let done = 0, failed = 0;
      const jobs = [];
      for (let i = 0; i < seq.length; i += engine.batch) jobs.push(seq.slice(i, i + engine.batch));
      let next = 0, fatal = null;
      const worker = async () => {
        while (next < jobs.length && !fatal) {
          if (signal && signal.aborted) return;
          const job = jobs[next++];
          const texts = job.map(i => { const t = cueToText(cues[i].html).trim(); return t; });
          const todo = texts.map((t, k) => (cache.has(t) || !t ? null : k)).filter(k => k !== null);
          try {
            if (todo.length) {
              const res = await engine.run(todo.map(k => texts[k]));
              todo.forEach((k, n) => { if (res[n] != null) cache.set(texts[k], String(res[n])); });
            }
          } catch (e) { fatal = e; return; }
          job.forEach((i, k) => {
            const tr = texts[k] ? cache.get(texts[k]) : '';
            if (tr === undefined) { failed++; return; }
            target[i].html = textToCue(tr, /^\s*<i>[\s\S]*<\/i>\s*$/i.test(cues[i].html));
          });
          done += job.length;
          onProgress && onProgress(done, cues.length);
        }
      };
      await Promise.all(Array.from({ length: engine.concurrency }, worker));
      if (fatal) { fatal.partial = done; throw fatal; }
      return { done, failed };
    }
  }

  SubtitleTranslator.LANGS = LANGS;
  SubtitleTranslator.ENGINES = ENGINES;
  SubtitleTranslator.normLang = normLang;
  SubtitleTranslator.nameOf = nameOf;
  SubtitleTranslator.cueToText = cueToText;
  VW.SubtitleTranslator = SubtitleTranslator;
})(window.VW = window.VW || {});
