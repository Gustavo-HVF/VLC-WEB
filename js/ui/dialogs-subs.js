/* VLC Web — Legenda → Buscar legendas online (OpenSubtitles, SubDL, SubSource) e Legenda → Traduzir legenda */
(function (VW) {
  'use strict';
  const U = VW.util;
  const el = U.el;
  const { Win, F } = VW.ui;

  /* ======================= Buscar legendas online ======================= */
  function search(app, tab = 'search') {
    const ex = Win.get('sub-search');
    if (ex) { ex.tabs.select(tab); ex.focus(); return; }
    const p = app.player, S = app.settings, SS = app.subSearch, K = VW.subsearch;
    const it = p.item;
    const g = K.guessFromName(it ? (it.file ? it.file.name : it.url || it.title) : '');
    const st = {
      title: g.title || (it ? (it.meta.title || it.title) : ''), year: g.year || '', season: g.season || '', episode: g.episode || '',
      langs: (S.get('subsSearchLangs') || ['pt-BR', 'en']).slice(), providers: (S.get('subsProviders') || Object.keys(K.PROVIDERS)).slice(), useHash: true
    };
    const w = new Win({ id: 'sub-search', title: 'Buscar legendas online', width: 900, icon: 'subtitle', className: 'subsearch-win' });

    /* ---------- formulário ---------- */
    const stop = e => e.stopPropagation();
    const titleIn = F.text(st.title, v => { st.title = v; }, { placeholder: 'Nome do filme ou série' });
    const num = (key, ph) => { const i = F.number(st[key], v => { st[key] = v; }, { min: 0, max: key === 'year' ? 2100 : 999, placeholder: ph }); i.value = st[key] || ''; i.addEventListener('input', () => { st[key] = +i.value || ''; }); return i; };
    const yearIn = num('year', 'Ano'), seasonIn = num('season', 'T'), episodeIn = num('episode', 'E');
    for (const i of [titleIn, yearIn, seasonIn, episodeIn]) { i.addEventListener('keydown', stop); i.addEventListener('keydown', e => { if (e.key === 'Enter') run(); }); }
    const langChips = el('div', { class: 'chips' });
    const renderLangs = () => {
      langChips.textContent = '';
      for (const l of K.LANGS) {
        const on = st.langs.includes(l.id);
        langChips.appendChild(el('button', { type: 'button', class: 'chip-btn' + (on ? ' active' : ''), 'aria-pressed': String(on), onclick: () => {
          st.langs = on ? st.langs.filter(x => x !== l.id) : st.langs.concat(l.id);
          if (!st.langs.length) st.langs = [l.id];
          S.set('subsSearchLangs', st.langs.slice());
          renderLangs();
        } }, l.label));
      }
    };
    renderLangs();
    const provBox = el('div', { class: 'sub-providers' });
    const renderProviders = () => {
      provBox.textContent = '';
      for (const [id, pr] of Object.entries(K.PROVIDERS)) {
        const has = SS.hasKey(id);
        const chk = F.check(pr.name, st.providers.includes(id), v => {
          st.providers = v ? st.providers.concat(id) : st.providers.filter(x => x !== id);
          S.set('subsProviders', st.providers.slice());
        });
        provBox.appendChild(el('div', { class: 'sub-prov' }, chk,
          has ? el('span', { class: 'diag-ok small' }, 'chave ✓') : el('button', { type: 'button', class: 'link small', onclick: () => w.tabs.select('keys') }, 'configurar chave'),
          el('button', { type: 'button', class: 'btn small', title: 'Abre a busca no site em uma nova aba (não precisa de chave). Depois de baixar, arraste a legenda ou o .zip para o reprodutor.', onclick: () => window.open(SS.siteURL(id, st.title, st.langs[0]), '_blank', 'noopener') }, 'Abrir no site ↗')));
      }
    };
    renderProviders();
    const hashChk = it && it.file ? F.check('Buscar também pelo código (hash) do arquivo — encontra a legenda sincronizada com esta versão exata (OpenSubtitles)', true, v => { st.useHash = v; }) : null;
    const results = el('div', { class: 'sub-results', role: 'list' });
    const status = el('div', { class: 'sub-status' });
    const searchBtn = F.button('Buscar', () => run(), 'primary');

    const run = async () => {
      if (!st.title.trim() && !(it && it.file)) { app.error('Informe o nome do filme ou da série.'); return; }
      const providers = st.providers.filter(x => K.PROVIDERS[x]);
      if (!providers.length) { app.error('Escolha pelo menos um site.'); return; }
      const missing = providers.filter(x => !SS.hasKey(x));
      searchBtn.disabled = true;
      results.textContent = '';
      status.textContent = '';
      status.append(el('span', { class: 'spinner' }), ' Buscando…');
      let hash = null;
      if (st.useHash && it && it.file && providers.includes('opensubtitles') && SS.hasKey('opensubtitles')) { try { hash = await K.osHash(it.file); } catch (e) { /* ignora */ } }
      const { results: list, errors } = await SS.search({ title: st.title.trim(), year: +st.year || 0, season: +st.season || 0, episode: +st.episode || 0, langs: st.langs, providers: providers.filter(x => SS.hasKey(x)), hash });
      searchBtn.disabled = false;
      status.textContent = '';
      if (missing.length) status.appendChild(el('div', { class: 'f-hint warn' }, `Sem chave de API: ${missing.map(x => K.PROVIDERS[x].name).join(', ')}. Configure na aba "Chaves de API" ou use "Abrir no site".`));
      for (const e of errors) status.appendChild(el('div', { class: 'f-hint warn' }, e));
      status.appendChild(el('div', { class: 'muted small' }, list.length ? `${list.length} legenda(s) encontrada(s).` : (providers.some(x => SS.hasKey(x)) ? 'Nenhuma legenda encontrada. Tente outro nome, remova o ano ou use "Abrir no site".' : '')));
      for (const r of list.slice(0, 200)) results.appendChild(row(r));
    };

    const row = r => {
      const info = [r.lang, r.hashMatch ? 'sincronizada com o arquivo ✓' : '', r.downloads ? r.downloads.toLocaleString('pt-BR') + ' downloads' : '', r.hi ? 'para deficientes auditivos' : '',
        r.ai ? 'tradução automática' : '', r.season ? `T${r.season}${r.episode ? 'E' + r.episode : ''}` : '', r.uploader ? 'por ' + r.uploader : ''].filter(Boolean).join(' · ');
      const use = F.button('Usar', async e => {
        const b = e.currentTarget;
        if (!p.item) { app.error('Abra um vídeo antes de carregar a legenda.'); return; }
        b.disabled = true; b.textContent = 'Baixando…';
        try {
          const { file, others } = await SS.download(r, { season: +st.season, episode: +st.episode });
          file._label = `${r.lang} — ${K.PROVIDERS[r.provider].name}`;
          file._lang = r.langId || '';
          await p.addSubtitleFile(file);
          b.textContent = 'Em uso ✓';
          b.classList.add('done');
          if (others.length) app.log.info('subsearch', `O pacote tinha ${others.length + 1} legendas; usada: ${file.name}`);
          const tgt = S.get('translateTarget');
          if (r.langId && VW.SubtitleTranslator.normLang(r.langId).split('-')[0] !== tgt.split('-')[0]) {
            status.prepend(el('div', { class: 'f-hint' }, `Legenda em ${r.lang} carregada. `, F.button(`Traduzir para ${VW.SubtitleTranslator.nameOf(tgt)}…`, () => translate(app), 'small')));
          }
        } catch (err) { b.disabled = false; b.textContent = 'Usar'; app.error(err.message); }
      }, 'small primary');
      return el('div', { class: 'sub-row', role: 'listitem' },
        el('span', { class: 'sub-badge prov-' + r.provider }, K.PROVIDERS[r.provider].name),
        el('div', { class: 'sub-main' }, el('div', { class: 'sub-rel', title: r.release }, r.release || r.fileName || r.title || '(sem nome)'), el('div', { class: 'sub-info' }, info), r.comment ? el('div', { class: 'sub-info muted' }, String(r.comment).slice(0, 160)) : null),
        use);
    };

    const searchTab = el('div', {},
      el('div', { class: 'sub-form' },
        F.row('Título:', titleIn), el('div', { class: 'sub-nums' }, el('label', {}, 'Ano', yearIn), el('label', {}, 'Temporada', seasonIn), el('label', {}, 'Episódio', episodeIn))),
      F.row('Idiomas:', langChips),
      F.row('Sites:', provBox),
      hashChk,
      el('div', { class: 'btn-row' }, searchBtn, el('span', { class: 'muted small' }, 'Dica: arraste para o reprodutor uma legenda ou um .zip baixado manualmente dos sites.')),
      status, results);

    /* ---------- chaves de API ---------- */
    const key = (setting, ph) => { const i = F.text(S.get(setting) || '', v => { S.set(setting, v.trim()); renderProviders(); }, { placeholder: ph, autocomplete: 'off', spellcheck: 'false' }); i.addEventListener('keydown', stop); return i; };
    const osUser = F.text('', null, { placeholder: 'usuário', autocomplete: 'username' });
    const osPass = el('input', { type: 'password', class: 'f-text', placeholder: 'senha', autocomplete: 'current-password' });
    for (const i of [osUser, osPass]) i.addEventListener('keydown', stop);
    const osLoginBox = el('div', { class: 'btn-row' });
    const renderLogin = () => {
      osLoginBox.textContent = '';
      if (S.get('osToken')) osLoginBox.append(el('span', { class: 'diag-ok' }, 'Conectado como ' + (S.get('osUser') || 'usuário')), F.button('Sair', () => { SS.osLogout(); renderLogin(); }, 'small'));
      else osLoginBox.append(osUser, osPass, F.button('Entrar', async e => {
        const b = e.currentTarget; b.disabled = true;
        try { await SS.osLogin(osUser.value.trim(), osPass.value); osPass.value = ''; renderLogin(); app.controls.osd('OpenSubtitles: conectado'); }
        catch (err) { app.error(err.message); }
        b.disabled = false;
      }, 'small'));
    };
    renderLogin();
    const link = (url, text) => `<a href="${url}" target="_blank" rel="noopener">${text}</a>`;
    const keysTab = el('div', {},
      F.hint('Os três sites oferecem acesso gratuito à busca, mas cada usuário precisa criar a própria <b>chave de API</b> na sua conta (o VLC Web não pode embutir chaves). As chaves ficam salvas apenas neste navegador.'),
      F.group('OpenSubtitles',
        F.hint(`Crie uma conta e gere a chave em ${link('https://www.opensubtitles.com/consumers', 'opensubtitles.com/consumers')}. O OpenSubtitles.org e o .com compartilham o mesmo acervo. Sem login há um limite pequeno de downloads por dia; entrar com sua conta aumenta o limite (a senha não é salva).`),
        F.row('Chave de API:', key('osApiKey', 'Api-Key')), F.row('Conta (opcional):', osLoginBox)),
      F.group('SubDL',
        F.hint(`Gere a chave gratuita no painel da sua conta SubDL (${link('https://subdl.com/api-doc', 'documentação da API')}).`),
        F.row('Chave de API:', key('subdlApiKey', 'api_key'))),
      F.group('SubSource',
        F.hint(`Crie a chave na aba "API" do painel da sua conta SubSource (${link('https://subsource.net/api-docs', 'documentação da API')}).`),
        F.row('Chave de API:', key('subsourceApiKey', 'X-API-Key'))),
      F.group('Acesso pelo navegador (CORS)',
        F.hint('Se algum site recusar o acesso direto pelo navegador, informe um proxy CORS <b>de sua confiança</b> (as chaves de API passam por ele). Use <code>{url}</code> onde o endereço deve entrar; sem <code>{url}</code>, ele é adicionado ao final.'),
        F.row('Proxy CORS (opcional):', key('subsCorsProxy', 'https://meu-proxy.exemplo/?url={url}'))));

    w.tabs = F.tabs([{ id: 'search', label: 'Buscar', content: searchTab }, { id: 'keys', label: 'Chaves de API', content: keysTab }], tab);
    w.body.appendChild(w.tabs);
    w.footer.append(F.button('Traduzir uma legenda carregada…', () => translate(app), 'small'), el('span', { class: 'grow' }), F.button('Fechar', () => w.close(), 'primary'));
    w.show();
    if (tab === 'search' && st.title && st.providers.some(x => SS.hasKey(x))) setTimeout(run, 100);
  }

  /* ======================= Traduzir legenda ======================= */
  function translate(app) {
    const p = app.player, S = app.settings, T = app.translator, TL = VW.SubtitleTranslator;
    const tracks = p.subs.tracks.filter(t => t.source !== 'translating');
    if (!p.item || !tracks.length) { app.error('Carregue uma legenda primeiro (Legenda → Adicionar arquivo de legenda ou Buscar legendas online).'); return; }
    Win.get('sub-translate') && Win.get('sub-translate').close();
    const w = new Win({ id: 'sub-translate', title: 'Traduzir legenda', width: 600, icon: 'subtitle', modal: true });
    const active = p.subs.active && tracks.includes(p.subs.active) ? p.subs.active : tracks[0];
    const o = { track: active.id, src: TL.normLang(active.lang) || 'auto', tgt: S.get('translateTarget') || 'pt-BR', engine: S.get('translateEngine') || 'auto' };
    if (o.engine === 'auto') o.engine = T.builtinSupported ? 'builtin' : 'mymemory';
    const langOpts = TL.LANGS.map(([c, n]) => [c, n]);
    const engineStatus = el('div', { class: 'f-hint' });
    const optsBox = el('div', {});
    const keyIn = (setting, ph, type) => { const i = el('input', { type: type || 'text', class: 'f-text', placeholder: ph, autocomplete: 'off' }); i.value = S.get(setting) || ''; i.addEventListener('input', () => S.set(setting, i.value.trim())); i.addEventListener('keydown', e => e.stopPropagation()); return i; };
    const renderOpts = async () => {
      optsBox.textContent = '';
      engineStatus.textContent = '';
      if (o.engine === 'builtin') {
        if (!T.builtinSupported) { engineStatus.className = 'f-hint warn'; engineStatus.textContent = 'Este navegador não tem tradutor integrado. Ele existe no Chrome e no Edge para computador (versão 138 ou superior). Escolha outro mecanismo.'; return; }
        const stt = o.src === 'auto' ? 'available' : await T.builtinStatus(o.src, o.tgt);
        engineStatus.className = 'f-hint' + (stt === 'unavailable' ? ' warn' : '');
        engineStatus.textContent = { available: 'Pronto: a tradução acontece no seu computador, sem enviar a legenda para a internet.', downloadable: 'O navegador vai baixar o modelo de tradução para este par de idiomas na primeira vez (uma única vez).', downloading: 'O navegador está baixando o modelo de tradução…', timeout: 'O tradutor do navegador não respondeu. Se a tradução não começar, escolha outro mecanismo.', unavailable: `O tradutor do navegador não oferece ${TL.nameOf(o.src)} → ${TL.nameOf(o.tgt)}. Escolha outro mecanismo.` }[stt] || '';
      } else if (o.engine === 'mymemory') {
        engineStatus.className = 'f-hint';
        engineStatus.innerHTML = 'Serviço online gratuito. O texto da legenda é enviado para <b>mymemory.translated.net</b>. Sem e-mail o limite é de cerca de 5.000 caracteres por dia (um filme tem ~40.000); com um e-mail válido sobe para ~50.000.';
        optsBox.append(F.row('E-mail (opcional):', keyIn('mymemoryEmail', 'seu@email.com', 'email')));
      } else if (o.engine === 'libre') {
        engineStatus.className = 'f-hint';
        engineStatus.innerHTML = 'Use um servidor LibreTranslate próprio (gratuito, código aberto) ou um público com chave. O texto da legenda é enviado para esse servidor.';
        optsBox.append(F.row('Endereço do servidor:', keyIn('libreUrl', 'https://libretranslate.com')), F.row('Chave de API (se exigida):', keyIn('libreKey', 'api_key')));
      }
    };
    w.body.append(
      F.row('Legenda de origem:', F.select(tracks.map(t => [t.id, t.label]), o.track, v => { o.track = v; const t = tracks.find(x => x.id === v); const l = TL.normLang(t && t.lang); if (l) { o.src = l; srcSel.value = l; } })),
      F.row('Idioma da legenda:', (srcSel = F.select([['auto', 'Detectar automaticamente']].concat(langOpts), o.src, v => { o.src = v; renderOpts(); }))),
      F.row('Traduzir para:', F.select(langOpts, o.tgt, v => { o.tgt = v; S.set('translateTarget', v); renderOpts(); })),
      F.row('Mecanismo:', F.select(Object.entries(TL.ENGINES).map(([k, n]) => [k, n + (k === 'builtin' && !T.builtinSupported ? ' — indisponível aqui' : '')]), o.engine, v => { o.engine = v; S.set('translateEngine', v); renderOpts(); })),
      engineStatus, optsBox,
      F.hint('A legenda traduzida aparece como uma nova faixa e já é exibida enquanto a tradução avança, a partir do ponto atual do vídeo. Ao terminar, você pode salvá-la como .srt.'));
    var srcSel;
    renderOpts();
    w.footer.append(F.button('Traduzir', () => { w.opts.onClose = null; w.close(); run(o); }, 'primary'), F.button('Cancelar', () => w.close()));
    w.show();

    const run = async (o) => {
      const track = p.subs.tracks.find(t => t.id === o.track);
      if (!track) return;
      const cues = p.subs.cuesOf(track).slice();
      if (!cues.length) { app.error('A legenda escolhida está vazia.'); return; }
      const pw = new Win({ id: 'sub-translate-progress', title: 'Traduzindo legenda', width: 460, icon: 'subtitle' });
      const bar = F.progress(), label = el('div', { class: 'small' }, 'Preparando…'), result = el('div', { class: 'btn-row' });
      const ctrl = new AbortController();
      const cancelBtn = F.button('Cancelar', () => ctrl.abort());
      pw.body.append(label, bar, result);
      pw.footer.append(cancelBtn);
      pw.opts.onClose = () => ctrl.abort();
      pw.show();
      bar.set(-1);
      try {
        let src = o.src;
        if (src === 'auto') {
          label.textContent = 'Detectando o idioma…';
          src = (await T.detect(cues.map(c => TL.cueToText(c.html)))) || TL.normLang(track.lang) || 'en';
        }
        // mesmo idioma não faz sentido (exceto Português de Portugal ↔ do Brasil)
        if (src === o.tgt || (src.split('-')[0] === o.tgt.split('-')[0] && !src.startsWith('pt'))) throw new Error(`A legenda já está em ${TL.nameOf(src)}.`);
        label.textContent = `Iniciando (${TL.ENGINES[o.engine]})…`;
        const engine = await T.engine(o.engine, src, o.tgt, s => { label.textContent = s; });
        const copies = cues.map(c => ({ start: c.start, end: c.end, html: c.html, align: c.align, layer: c.layer }));
        const nt = p.subs.addCues(copies, { label: `${TL.nameOf(o.tgt)} (traduzida de ${TL.nameOf(src)})`, lang: o.tgt, source: 'translated', name: track.name });
        p.subs.setActive(nt.id);
        const t0 = p.currentTime;
        const startIndex = Math.max(0, copies.findIndex(c => c.end >= t0));
        const started = Date.now();
        const res = await T.translateCues(cues, copies, {
          engine, signal: ctrl.signal, startIndex,
          onProgress: (d, n) => {
            bar.set(d / n);
            const eta = d > 5 ? Math.round((Date.now() - started) / d * (n - d) / 1000) : 0;
            label.textContent = `${d} de ${n} falas traduzidas${eta ? ` — cerca de ${U.fmtTime(eta)} restantes` : ''}`;
            p.subs.lastKey = '';
          }
        });
        p.subs.lastKey = '';
        if (ctrl.signal.aborted) { label.textContent = `Tradução interrompida: ${res.done} de ${copies.length} falas traduzidas (o restante continua no idioma original).`; }
        else { label.textContent = `Pronto: ${copies.length - res.failed} falas traduzidas para ${TL.nameOf(o.tgt)}.`; bar.set(1); app.controls.osd('Tradução da legenda concluída'); }
        app.log.info('translate', `${TL.ENGINES[o.engine]}: ${res.done} falas (${src} → ${o.tgt})`);
        cancelBtn.remove();
        result.append(F.button('Salvar legenda traduzida (.srt)', () => {
          const prev = p.subs.activeId;
          p.subs.activeId = nt.id;
          const text = p.subs.exportActive();
          p.subs.activeId = prev;
          U.download(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${U.stripExt(p.item ? p.item.name : 'legenda')}.${o.tgt}.srt`);
        }, 'small primary'));
        pw.footer.appendChild(F.button('Fechar', () => pw.close()));
        pw.opts.onClose = null;
      } catch (e) {
        p.subs.lastKey = '';
        label.textContent = 'Erro: ' + e.message + (e.partial ? ` (${e.partial} falas já traduzidas foram mantidas)` : '');
        bar.set(0);
        cancelBtn.remove();
        pw.footer.appendChild(F.button('Fechar', () => pw.close()));
        pw.opts.onClose = null;
        app.error('Tradução: ' + e.message);
      }
    };
  }

  VW.dialogsSubs = { search, translate };
})(window.VW = window.VW || {});
