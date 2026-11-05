/* VLC Web — "Ferramentas → Preferências" (Ctrl+P) e "Personalizar interface" */
(function (VW) {
  'use strict';
  const U = VW.util;
  const el = U.el;
  const { Win, F } = VW.ui;

  const FONTS = [['Arial, Helvetica, sans-serif', 'Arial'], ['"Segoe UI", Roboto, sans-serif', 'Segoe UI / Roboto'], ['Verdana, sans-serif', 'Verdana'], ['Tahoma, sans-serif', 'Tahoma'],
    ['"Trebuchet MS", sans-serif', 'Trebuchet MS'], ['Georgia, serif', 'Georgia'], ['"Times New Roman", serif', 'Times New Roman'], ['"Courier New", monospace', 'Courier New'],
    ['Impact, sans-serif', 'Impact'], ['"Comic Sans MS", cursive', 'Comic Sans MS'], ['system-ui, sans-serif', 'Fonte do sistema']];

  function prefs(app, section = 'interface') {
    const ex = Win.get('prefs');
    if (ex) { ex.select(section); ex.focus(); return; }
    const S = app.settings;
    const w = new Win({ id: 'prefs', title: 'Preferências', width: 820, icon: 'prefs', className: 'prefs-win', modal: true });

    const chk = (label, key, hint) => F.check(label, S.get(key), v => S.set(key, v), hint ? { title: hint } : null);
    const sel = (label, key, opts, conv) => F.row(label, F.select(opts, S.get(key), v => S.set(key, conv ? conv(v) : v)));
    const num = (label, key, min, max, step = 1, unit = '') => F.row(label, F.number(S.get(key), v => S.set(key, U.clamp(v, min, max)), { min, max, step }), unit ? el('span', { class: 'muted' }, unit) : null);
    const txt = (label, key, ph) => F.row(label, F.text(S.get(key), v => S.set(key, v), { placeholder: ph || '' }));
    const col = (label, key) => F.row(label, F.color(S.get(key), v => S.set(key, v)));
    const rng = (label, key, min, max, step, fmt) => F.row(label, F.slider({ min, max, step, value: S.get(key), format: fmt, onInput: v => S.set(key, v) }));

    const sections = {
      interface: { label: 'Interface', icon: 'prefs', build: () => [
        F.group('Aparência',
          sel('Tema (skin):', 'skin', [['auto', 'Automático (claro/escuro do sistema)']].concat(VW.skins.SKINS.map(s => [s.id, s.name]))),
          sel('Estrutura do layout:', 'layout', [['auto', 'Automático (definida pelo tema)']].concat(Object.entries(VW.skins.LAYOUTS).map(([id, l]) => [id, l.name]))),
          el('div', { class: 'btn-row' }, F.button('Abrir galeria de temas e layouts…', () => { w.close(); app.dialogs.skins('skins'); }, 'small')),
          F.row('Cor de destaque:', F.check('Personalizar', S.get('accentOverride'), v => S.set('accentOverride', v)), F.color(S.get('accent'), v => { S.set('accent', v); S.set('accentOverride', true); })),
          chk('Mostrar barra de status', 'showStatusbar'),
          chk('Mostrar controles avançados (gravar, capturar, A→B, quadro a quadro)', 'showAdvancedControls'),
          chk('Interface mínima (apenas vídeo)', 'minimalView'),
          chk('Lista de reprodução encaixada na janela principal', 'playlistDocked'),
          num('Ocultar controles em tela cheia após:', 'fsControlsTimeout', 1, 30, 1, 's'),
          el('div', { class: 'btn-row' }, F.button('Personalizar barra de ferramentas…', () => customize(app)))),
        F.group('Comportamento',
          sel('Continuar a reprodução de onde parou:', 'resumePlayback', [['ask', 'Perguntar'], ['always', 'Sempre'], ['never', 'Nunca']]),
          chk('Mostrar o título da mídia ao trocar de faixa', 'showMediaChangePopup'),
          chk('Pausar quando a aba/janela ficar oculta', 'pauseOnHidden'),
          chk('Iniciar pausado', 'startPaused'),
          chk('Parar ao final de cada item', 'playAndStop'),
          chk('Sair ao final da lista de reprodução', 'playAndExit'),
          chk('Clique único no vídeo pausa/reproduz', 'clickToPause'),
          chk('Duplo clique alterna a tela cheia', 'doubleClickFullscreen'),
          sel('Roda do mouse sobre o vídeo controla:', 'wheelAction', [['volume', 'Volume'], ['seek', 'Posição'], ['none', 'Nada']]),
          chk('Usar o seletor de arquivos do sistema com acesso persistente (quando disponível)', 'useFilePicker')),
        F.group('Privacidade',
          chk('Salvar mídia recente', 'saveRecent'),
          num('Máximo de itens recentes:', 'maxRecent', 1, 50),
          el('div', { class: 'btn-row' },
            F.button('Limpar mídia recente', () => { app.player.clearRecent(); app.controls.osd('Lista de mídia recente apagada'); }),
            F.button('Apagar posições de retomada', () => { app.player.resumeData = {}; U.store.set('resume', {}); app.controls.osd('Posições apagadas'); }),
            F.button('Apagar marcadores', () => { app.player.bookmarksData = {}; U.store.set('bookmarks', {}); app.player.emit('bookmarks'); })))
      ] },
      audio: { label: 'Áudio', icon: 'volume', build: () => {
        const devSel = F.select([['default', 'Padrão do sistema']], S.get('audioDevice'), v => app.player.audio.setSinkId(v));
        const loadDevs = async () => F.setOptions(devSel, [['default', 'Padrão do sistema']].concat((await app.player.audio.listDevices()).filter(d => d.id !== 'default').map(d => [d.id, d.label])), S.get('audioDevice'));
        loadDevs();
        return [
          F.group('Geral',
            chk('Ativar áudio', 'audioEnabled'),
            sel('Saída de áudio:', 'audioMode', [['auto', 'Motor de efeitos (equalizador, efeitos, volume até 200%)'], ['direct', 'Direta (máxima compatibilidade, sem efeitos de áudio)']]),
            el('div', { class: 'btn-row' }, F.button('Diagnóstico de som…', () => { w.close(); app.dialogs.audioDiag(); }, 'small')),
            rng('Volume padrão:', 'volume', 0, 2, 0.01, v => Math.round(v * 100) + '%'),
            chk('Lembrar o volume entre sessões', 'rememberVolume'),
            sel('Volume máximo do controle:', 'maxVolume', [['1', '100%'], ['1.25', '125%'], ['1.5', '150%'], ['2', '200%']], v => +v),
            sel('Passo de volume (teclado/roda):', 'volumeStep', [['0.01', '1%'], ['0.02', '2%'], ['0.05', '5%'], ['0.1', '10%']], v => +v),
            chk('Manter o tom ao alterar a velocidade (scaletempo)', 'preservePitch')),
          F.group('Saída',
            F.row('Dispositivo de saída:', devSel, F.button('Atualizar', loadDevs, 'small')),
            U.supports.ctxSinkId ? null : F.hint('A escolha do dispositivo de saída não é suportada por este navegador.', 'warn'),
            chk('Normalizar volume', 'normalize'),
            rng('Nível de normalização:', 'normalizeLevel', 0.5, 10, 0.1, v => v.toFixed(1)),
            sel('Visualização para arquivos de áudio:', 'visualization', Object.entries(VW.Visualizer.MODES))),
          F.group('Faixas', txt('Idioma de áudio preferido:', 'preferredAudioLang', 'ex.: por,pt,eng'), chk('Usar bandas de frequência ISO no equalizador', 'eqIsoBands'))
        ];
      } },
      video: { label: 'Vídeo', icon: 'film', build: () => [
        F.group('Geral',
          chk('Ativar vídeo', 'videoEnabled'),
          chk('Tela cheia ao iniciar a reprodução', 'fullscreenOnStart'),
          chk('Mostrar o título da mídia no vídeo ao iniciar', 'titleOnStart'),
          num('Duração do título:', 'titleTimeout', 1, 30, 1, 's'),
          sel('Desentrelaçar:', 'deinterlace', [['off', 'Desligado'], ['on', 'Ligado']]),
          sel('Modo de desentrelaçamento:', 'deinterlaceMode', [['discard', 'Descartar'], ['blend', 'Mesclar'], ['bob', 'Bob'], ['linear', 'Linear']])),
        F.group('Desempenho',
          sel('Resolução máxima:', 'maxResolution', VW.App.RESOLUTIONS),
          chk('Exibir o vídeo diretamente quando não houver efeitos (mais leve)', 'directVideo'),
          chk('Avisar quando o vídeo estiver travando', 'lagHint'),
          F.hint('Para vídeos 4K que travam: a resolução máxima limita o processamento dos efeitos de vídeo e a qualidade baixada em fluxos HLS/DASH. Em "Automática", nada é processado acima do tamanho da janela. Num arquivo único o navegador ainda decodifica a resolução original; se continuar travando, use Vídeo → Resolução → Criar cópia em resolução menor.')),
        F.group('Capturas de vídeo (imagens)',
          sel('Formato:', 'snapshotFormat', [['png', 'PNG'], ['jpeg', 'JPEG'], ['webp', 'WebP']]),
          txt('Prefixo do nome do arquivo:', 'snapshotPrefix'),
          chk('Mostrar miniatura após a captura', 'snapshotPreview'),
          F.hint('As imagens são salvas na pasta de downloads do navegador.'))
      ] },
      subs: { label: 'Legendas / OSD', icon: 'subtitle', build: () => {
        const preview = el('div', { class: 'sub-preview' }, el('div', { class: 'subs-layer static' }, el('div', { class: 'subs-region subs-bottom' }, el('div', { class: 'cue' }, el('span', { class: 'cue-text', html: 'Exemplo de legenda<br><i>com itálico</i> e acentuação: ção, ñ, ü' })))));
        const layer = preview.firstChild;
        const mgr = { layer, settings: S, rectH: 300 };
        const upd = () => VW.subtitles.SubtitleManager.prototype.applyStyle.call(mgr);
        const off = S.on('change', k => { if (k.startsWith('subs')) upd(); });
        w.onDispose(off);
        setTimeout(upd, 0);
        const fontSel = F.select(FONTS.some(f => f[0] === S.get('subsFont')) ? FONTS : FONTS.concat([[S.get('subsFont'), S.get('subsFont')]]), S.get('subsFont'), v => S.set('subsFont', v));
        return [
          F.group('Exibição na tela (OSD)', chk('Ativar mensagens na tela (OSD)', 'osdEnabled')),
          F.group('Legendas',
            chk('Detectar e carregar legendas automaticamente (mesmo nome do vídeo)', 'subsAutoload'),
            sel('Codificação de texto padrão:', 'subsEncoding', U.ENCODINGS),
            sel('Codificação alternativa (quando não for UTF-8):', 'subsFallbackEncoding', U.ENCODINGS.filter(e => e[0] !== 'auto')),
            txt('Idioma de legenda preferido:', 'preferredSubLang', 'ex.: por,pt,pt-BR'),
            num('Passo do atraso (G/H):', 'subsDelayStep', 10, 1000, 10, 'ms')),
          F.group('Aparência',
            preview,
            F.row('Fonte:', fontSel),
            sel('Tamanho:', 'subsSize', [['smaller', 'Menor'], ['small', 'Pequeno'], ['normal', 'Normal'], ['large', 'Grande'], ['larger', 'Maior']]),
            rng('Escala:', 'subsScale', 25, 300, 5, v => v + '%'),
            col('Cor do texto:', 'subsColor'),
            rng('Opacidade do texto:', 'subsOpacity', 10, 100, 1, v => v + '%'),
            chk('Negrito', 'subsBold'),
            sel('Espessura do contorno:', 'subsOutline', [['none', 'Nenhum'], ['thin', 'Fino'], ['normal', 'Normal'], ['thick', 'Grosso']]),
            col('Cor do contorno:', 'subsOutlineColor'),
            chk('Sombra', 'subsShadow'),
            chk('Fundo atrás do texto', 'subsBackground'),
            col('Cor do fundo:', 'subsBgColor'),
            rng('Opacidade do fundo:', 'subsBgOpacity', 0, 100, 1, v => v + '%'),
            rng('Margem inferior:', 'subsMargin', 0, 40, 1, v => v + '%'))
        ];
      } },
      input: { label: 'Entrada / Codecs', icon: 'codec', build: () => {
        const ffState = el('span', { class: 'muted' });
        const updState = () => { ffState.textContent = { idle: 'não carregado', loading: 'carregando…', ready: 'pronto', error: 'erro ao carregar' }[app.ffmpeg.state]; };
        updState();
        w.onDispose(app.ffmpeg.on('state', updState));
        return [
          F.group('Saltos (teclado)',
            num('Salto muito curto (Shift+←/→):', 'jumpVeryShort', 1, 600, 1, 's'),
            num('Salto curto (←/→, Alt+←/→):', 'jumpShort', 1, 600, 1, 's'),
            num('Salto médio (Ctrl+←/→):', 'jumpMedium', 1, 3600, 1, 's'),
            num('Salto longo (Ctrl+Alt+←/→):', 'jumpLong', 1, 7200, 1, 's')),
          F.group('Decodificador FFmpeg (WebAssembly)',
            F.hint('Permite abrir formatos que o navegador não reproduz (AVI, WMV, FLV, MPEG‑2/VOB, MKV com HEVC/AC‑3/DTS, WMA, APE…). Tudo é processado localmente no seu computador.'),
            sel('Quando um formato não for suportado:', 'ffmpegMode', [['ask', 'Perguntar'], ['always', 'Converter automaticamente'], ['never', 'Nunca usar o FFmpeg']]),
            txt('Endereço do núcleo FFmpeg:', 'ffmpegCoreBase'),
            el('div', { class: 'btn-row' }, el('span', {}, 'Estado: '), ffState, el('span', { class: 'grow' }), F.button('Carregar agora', () => app.preloadFFmpeg(), 'small'))),
          F.group('Gravação',
            sel('Formato da gravação:', 'recordFormat', [['auto', 'Automático'], ['webm', 'WebM (VP9/VP8 + Opus)'], ['mp4', 'MP4 (H.264 + AAC), se suportado']]),
            txt('Prefixo do arquivo gravado:', 'recordPrefix')),
          F.group('Outros',
            num('Duração da exibição de imagens:', 'imageDuration', 0, 3600, 1, 's (0 = infinito)'),
            num('Buffer de fluxos HLS:', 'hlsMaxBuffer', 5, 600, 5, 's'))
        ];
      } },
      hotkeys: { label: 'Teclas de atalho', icon: 'keyboard', build: () => [hotkeysEditor(app, w)] }
    };

    const nav = el('nav', { class: 'prefs-nav' });
    const content = el('div', { class: 'prefs-content' });
    const select = id => {
      for (const b of U.$$('button', nav)) b.classList.toggle('active', b.dataset.id === id);
      content.textContent = '';
      content.append(el('h2', {}, sections[id].label), ...sections[id].build().filter(Boolean));
      content.scrollTop = 0;
    };
    for (const [id, s] of Object.entries(sections)) {
      nav.appendChild(el('button', { type: 'button', dataset: { id }, onclick: () => select(id) }, U.icon(s.icon), el('span', {}, s.label)));
    }
    w.select = select;
    w.body.appendChild(el('div', { class: 'prefs-layout' }, nav, content));
    w.footer.append(
      F.button('Redefinir preferências', async () => {
        if (await F.message('Redefinir preferências', 'Restaurar todas as preferências para os valores padrão?', [['yes', 'Redefinir'], ['no', 'Cancelar']]) === 'yes') { S.reset(); app.actions.resetKeys(); select(w.current || 'interface'); }
      }),
      F.button('Exportar…', () => U.download(new Blob([JSON.stringify(S.all(), null, 2)], { type: 'application/json' }), 'vlcweb-preferencias.json')),
      F.button('Importar…', async () => {
        const f = await app.pickFiles({ multiple: false, accept: '.json,application/json' });
        if (!f[0]) return;
        try { const data = JSON.parse(await f[0].file.text()); S.setMany(data); select('interface'); app.controls.osd('Preferências importadas'); }
        catch (e) { app.error('Arquivo de preferências inválido.'); }
      }),
      el('span', { class: 'grow muted small' }, 'As alterações são aplicadas e salvas imediatamente.'),
      F.button('Fechar', () => w.close(), 'primary'));
    const origSelect = select;
    w.select = id => { w.current = id; origSelect(id); };
    w.show();
    w.select(section);
  }

  function hotkeysEditor(app, w) {
    const A = app.actions;
    const table = el('div', { class: 'hk-table' });
    const filter = F.text('', () => render(), { placeholder: 'Pesquisar ação ou tecla…' });
    filter.addEventListener('keydown', e => e.stopPropagation());
    let capturing = null;
    const render = () => {
      table.textContent = '';
      const q = filter.value.toLowerCase();
      let cat = '';
      for (const a of A.list()) {
        if (a.hidden) continue;
        const keys = A.keysFor(a.id);
        if (q && !(a.label.toLowerCase().includes(q) || keys.join(' ').toLowerCase().includes(q))) continue;
        if (a.category !== cat) { cat = a.category; table.appendChild(el('div', { class: 'hk-cat' }, cat)); }
        const keyCell = el('button', { type: 'button', class: 'hk-key', title: 'Clique e pressione a nova combinação de teclas' }, keys.length ? keys.map(k => el('kbd', {}, VW.ui.Actions.label(k))) : el('span', { class: 'muted' }, 'não definido'));
        keyCell.addEventListener('click', () => {
          if (capturing) capturing.classList.remove('capturing');
          capturing = keyCell;
          keyCell.classList.add('capturing');
          keyCell.textContent = 'Pressione as teclas… (Esc cancela, Backspace remove)';
          keyCell.focus();
        });
        keyCell.addEventListener('keydown', e => {
          if (capturing !== keyCell) return;
          e.preventDefault(); e.stopPropagation();
          if (e.key === 'Escape') { capturing = null; render(); return; }
          if (e.key === 'Backspace') { A.setKeys(a.id, []); capturing = null; render(); return; }
          const combo = VW.ui.Actions.combo(e);
          if (!combo) return;
          const other = A.findByKey(combo);
          if (other && other !== a.id) {
            const oa = A.get(other);
            A.setKeys(other, A.keysFor(other).filter(k => k !== combo));
            app.controls.osd(`"${VW.ui.Actions.label(combo)}" removida de "${oa.label}"`);
          }
          A.setKeys(a.id, [combo]);
          capturing = null;
          render();
        });
        keyCell.addEventListener('blur', () => { if (capturing === keyCell) { capturing = null; setTimeout(render, 0); } });
        table.appendChild(el('div', { class: 'hk-row' }, el('span', { class: 'hk-label' }, a.label), keyCell));
      }
    };
    render();
    return el('div', {},
      el('div', { class: 'btn-row' }, filter, F.button('Restaurar padrões', () => { A.resetKeys(); render(); }, 'small')),
      F.hint('Atalhos do navegador como Ctrl+N, Ctrl+T e Ctrl+W não podem ser substituídos por páginas web.'),
      table);
  }

  /* ======================= Personalizar interface ======================= */
  function customize(app) {
    const S = app.settings;
    const BUTTONS = VW.ui.Controls.BUTTONS;
    const w = Win.open('customize', () => new Win({ title: 'Editor da barra de ferramentas', width: 760, icon: 'prefs' }));
    if (w.built) return;
    w.built = true;
    const state = { toolbar: S.get('toolbar').slice(), advToolbar: S.get('advToolbar').slice() };
    const chip = (id, from, idx) => {
      const b = BUTTONS[id];
      const c = el('span', { class: 'chip', draggable: 'true', title: b.label, dataset: { id } }, b.icon ? U.icon(b.icon) : null, el('span', {}, b.icon ? '' : b.label));
      if (b.icon) c.appendChild(el('span', { class: 'chip-label' }, b.label));
      c.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', JSON.stringify({ id, from, idx })); e.dataTransfer.effectAllowed = 'move'; });
      if (from !== 'palette') c.addEventListener('dblclick', () => { state[from].splice(idx, 1); render(); });
      return c;
    };
    const zone = (key) => {
      const z = el('div', { class: 'tb-zone', dataset: { key } });
      z.addEventListener('dragover', e => { e.preventDefault(); z.classList.add('over'); });
      z.addEventListener('dragleave', () => z.classList.remove('over'));
      z.addEventListener('drop', e => {
        e.preventDefault(); z.classList.remove('over');
        let d; try { d = JSON.parse(e.dataTransfer.getData('text/plain')); } catch (err) { return; }
        const chips = U.$$('.chip', z);
        let at = chips.findIndex(c => { const r = c.getBoundingClientRect(); return e.clientX < r.left + r.width / 2 && e.clientY < r.bottom; });
        if (at < 0) at = chips.length;
        if (d.from !== 'palette') { state[d.from].splice(d.idx, 1); if (d.from === key && d.idx < at) at--; }
        state[key].splice(at, 0, d.id);
        render();
      });
      return z;
    };
    const z1 = zone('toolbar'), z2 = zone('advToolbar');
    const pal = el('div', { class: 'tb-palette' });
    pal.addEventListener('dragover', e => e.preventDefault());
    pal.addEventListener('drop', e => {
      e.preventDefault();
      let d; try { d = JSON.parse(e.dataTransfer.getData('text/plain')); } catch (err) { return; }
      if (d.from !== 'palette') { state[d.from].splice(d.idx, 1); render(); }
    });
    const render = () => {
      z1.textContent = ''; z2.textContent = ''; pal.textContent = '';
      state.toolbar.forEach((id, i) => BUTTONS[id] && z1.appendChild(chip(id, 'toolbar', i)));
      state.advToolbar.forEach((id, i) => BUTTONS[id] && z2.appendChild(chip(id, 'advToolbar', i)));
      Object.keys(BUTTONS).forEach(id => pal.appendChild(chip(id, 'palette', -1)));
    };
    render();
    w.body.append(
      F.hint('Arraste os elementos da paleta para as barras. Arraste de volta para a paleta ou dê um duplo clique para remover.'),
      F.group('Barra de ferramentas principal', z1),
      F.group('Barra de controles avançados', z2),
      F.group('Elementos disponíveis', pal));
    w.footer.append(
      F.button('Restaurar padrão', () => { state.toolbar = S.defaults.toolbar.slice(); state.advToolbar = S.defaults.advToolbar.slice(); render(); }),
      el('span', { class: 'grow' }),
      F.button('Aplicar', () => { S.set('toolbar', state.toolbar.slice()); S.set('advToolbar', state.advToolbar.slice()); }, 'primary'),
      F.button('Fechar', () => { S.set('toolbar', state.toolbar.slice()); S.set('advToolbar', state.advToolbar.slice()); w.close(); }));
  }

  VW.dialogsPrefs = { prefs, customize };
})(window.VW = window.VW || {});
