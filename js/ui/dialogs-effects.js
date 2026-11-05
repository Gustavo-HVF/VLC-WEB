/* VLC Web — "Ferramentas → Efeitos e filtros" (Ctrl+E): efeitos de áudio, efeitos de vídeo e sincronização */
(function (VW) {
  'use strict';
  const U = VW.util;
  const el = U.el;
  const { Win, F } = VW.ui;

  const fmtDb = v => (v > 0 ? '+' : '') + v.toFixed(1) + ' dB';
  const fmtHz = f => f >= 1000 ? (f / 1000).toFixed(f % 1000 ? 1 : 0) + ' kHz' : Math.round(f) + ' Hz';

  function effects(app, tab = 'audio') {
    const ex = Win.get('effects');
    if (ex) { ex.tabs.select(tab); ex.focus(); return; }
    const p = app.player, A = p.audio, R = p.renderer;
    A.ensure();
    const w = new Win({ id: 'effects', title: 'Ajustes e efeitos', width: 760, icon: 'sliders', className: 'effects-win' });
    const tabs = w.tabs = F.tabs([
      { id: 'audio', label: 'Efeitos de áudio', render: () => audioTab(app) },
      { id: 'video', label: 'Efeitos de vídeo', render: () => videoTab(app) },
      { id: 'sync', label: 'Sincronização', render: () => syncTab(app, w) }
    ], tab);
    w.body.appendChild(tabs);
    w.footer.append(
      F.button('Salvar como padrão', () => { app.saveEffects(); app.controls.osd('Efeitos salvos como padrão'); }, '', { title: 'Restaura estes efeitos ao abrir o VLC Web' }),
      F.button('Redefinir tudo', () => {
        A.resetEffects(); R.reset(); p.subs.setDelay(0); A.setDelay(0); p.subs.setSpeed(1); p.subs.setDurationFactor(1);
        w.close(); effects(app, tabs.active); app.controls.osd('Efeitos redefinidos');
      }),
      el('span', { class: 'grow' }),
      F.button('Fechar', () => w.close(), 'primary'));
    if (p.directAudio) w.body.prepend(el('div', { class: 'f-hint warn' }, '⚠ A saída de áudio direta está ativa: os efeitos de áudio não se aplicam. ',
      F.button('Ativar o motor de efeitos', () => { p.setDirectAudio(false); w.close(); effects(app, 'audio'); }, 'small')));
    if (R.tainted) w.body.prepend(F.hint('⚠ A mídia atual está em modo de compatibilidade (outra origem sem CORS): apenas alguns efeitos de vídeo estão disponíveis e os efeitos de áudio não se aplicam.', 'warn'));
    w.show();
  }

  /* ======================= Áudio ======================= */
  function audioTab(app) {
    const A = app.player.audio;
    const s = A.state;
    /* Equalizador */
    const bands = [];
    const freqs = A.bandFreqs;
    const preamp = F.slider({ min: -20, max: 20, step: 0.1, value: s.eq.preamp, vertical: true, label: 'Pré-amp', format: fmtDb, reset: 0, onInput: v => A.setEq({ preamp: v }) });
    const bandRow = el('div', { class: 'eq-bands' }, preamp, el('span', { class: 'eq-sep' }));
    freqs.forEach((f, i) => {
      const sl = F.slider({ min: -20, max: 20, step: 0.1, value: s.eq.bands[i], vertical: true, label: fmtHz(f), format: v => v.toFixed(1), reset: 0, onInput: v => { A.setEqBand(i, v); presetSel.value = 'custom'; } });
      bands.push(sl);
      bandRow.appendChild(sl);
    });
    const presetSel = F.select([['custom', 'Personalizado']].concat(Object.entries(VW.AudioEngine.EQ_PRESETS).map(([k, v]) => [k, v.name])), s.eq.preset, v => {
      if (v === 'custom') return;
      A.applyPreset(v);
      if (!A.state.eq.enabled) { A.setEq({ enabled: true }); eqOn.set(true); }
      bands.forEach((b, i) => b.set(A.state.eq.bands[i]));
      preamp.set(A.state.eq.preamp);
    });
    const eqOn = F.check('Ativar', s.eq.enabled, v => A.setEq({ enabled: v }));
    const eq = el('div', { class: 'eq' },
      el('div', { class: 'btn-row' }, eqOn, F.check('2 passagens', s.eq.twoPass, v => A.setEq({ twoPass: v }), { title: 'Aplica o filtro duas vezes (efeito mais intenso)' }),
        el('span', { class: 'grow' }), el('span', {}, 'Predefinição:'), presetSel),
      bandRow,
      el('div', { class: 'btn-row' }, F.check('Usar bandas de frequência ISO padrão', app.settings.get('eqIsoBands'), v => {
        app.settings.set('eqIsoBands', v);
        const nf = A.bandFreqs;
        bands.forEach((b, i) => { const l = b.querySelector('.f-slider-label'); if (l) l.textContent = fmtHz(nf[i]); });
      }), el('span', { class: 'grow' }), F.button('Zerar', () => { A.applyPreset('flat'); bands.forEach(b => b.set(0)); preamp.set(0); presetSel.value = 'flat'; }, 'small')));

    /* Compressor */
    const c = s.comp;
    const cs = (label, key, min, max, step, fmt) => F.slider({ min, max, step, value: c[key], format: fmt, vertical: true, label, onInput: v => A.setComp({ [key]: v }) });
    const comp = el('div', {},
      F.check('Ativar', c.enabled, v => A.setComp({ enabled: v })),
      el('div', { class: 'eq-bands' },
        cs('RMS/pico', 'rms', 0, 1, 0.01, v => v.toFixed(2)),
        cs('Ataque', 'attack', 1.5, 400, 0.5, v => v.toFixed(1) + ' ms'),
        cs('Liberação', 'release', 2, 800, 1, v => Math.round(v) + ' ms'),
        cs('Limiar', 'threshold', -30, 0, 0.1, v => v.toFixed(1) + ' dB'),
        cs('Proporção', 'ratio', 1, 20, 0.1, v => v.toFixed(1) + ':1'),
        cs('Joelho', 'knee', 1, 10, 0.1, v => v.toFixed(1) + ' dB'),
        cs('Ganho de compensação', 'makeup', 0, 24, 0.1, v => v.toFixed(1) + ' dB')),
      F.hint('Reduz a diferença entre sons altos e baixos — útil para filmes com diálogos baixos e explosões altas.'));

    /* Espacializador */
    const sp = s.spat;
    const ss = (label, key, min, max) => F.slider({ min, max, step: 0.01, value: sp[key], format: v => v.toFixed(2), vertical: true, label, onInput: v => A.setSpat({ [key]: v }) });
    const spat = el('div', {}, F.check('Ativar', sp.enabled, v => A.setSpat({ enabled: v })),
      el('div', { class: 'eq-bands' }, ss('Tamanho', 'room', 0, 1.1), ss('Largura', 'width', 0, 1), ss('Úmido', 'wet', 0, 1), ss('Seco', 'dry', 0, 1), ss('Amortecimento', 'damp', 0, 1)),
      F.hint('Simula a acústica de uma sala (reverberação).'));

    /* Alargador estéreo */
    const wd = s.widen;
    const ws = (label, key, min, max, step, fmt) => F.slider({ min, max, step, value: wd[key], format: fmt, vertical: true, label, onInput: v => A.setWiden({ [key]: v }) });
    const widen = el('div', {}, F.check('Ativar', wd.enabled, v => A.setWiden({ enabled: v })),
      el('div', { class: 'eq-bands' }, ws('Atraso', 'delay', 1, 100, 1, v => v + ' ms'), ws('Realimentação', 'feedback', 0, 0.9, 0.01, v => v.toFixed(2)), ws('Cruzamento', 'crossfeed', 0, 0.8, 0.01, v => v.toFixed(2)), ws('Mistura seca', 'dryMix', 0, 1, 0.01, v => v.toFixed(2))),
      F.hint('Aumenta a sensação de largura do palco estéreo.'));

    /* Avançado */
    const adv = el('div', {},
      F.group('Mudança de tom',
        F.row('Tom (semitons):', F.slider({ min: -12, max: 12, step: 0.1, value: s.pitch, reset: 0, format: v => (v > 0 ? '+' : '') + v.toFixed(1), onInput: v => A.setPitch(v) })),
        A.pitchReady || !A.ctx ? null : F.hint('A mudança de tom requer AudioWorklet (página servida via HTTPS ou localhost).', 'warn'),
        F.check('Manter o tom ao alterar a velocidade (scaletempo)', app.settings.get('preservePitch'), v => app.settings.set('preservePitch', v))),
      F.group('Saída',
        F.row('Modo estéreo:', F.select(Object.entries(VW.AudioEngine.STEREO_MODES).map(([k, v]) => [k, v.name]), s.stereo, v => A.setStereoMode(v))),
        F.row('Visualização:', F.select(Object.entries(VW.Visualizer.MODES), app.settings.get('visualization'), v => app.settings.set('visualization', v))),
        F.check('Normalizar volume', app.settings.get('normalize'), v => app.settings.set('normalize', v)),
        F.row('Nível de normalização:', F.slider({ min: 0.5, max: 10, step: 0.1, value: app.settings.get('normalizeLevel'), format: v => v.toFixed(1), onInput: v => app.settings.set('normalizeLevel', v) }))));

    return F.tabs([
      { id: 'eq', label: 'Equalizador', content: eq },
      { id: 'comp', label: 'Compressor', content: comp },
      { id: 'spat', label: 'Espacializador', content: spat },
      { id: 'widen', label: 'Alargador estéreo', content: widen },
      { id: 'adv', label: 'Avançado', content: adv }
    ], 'eq', 'sub');
  }

  /* ======================= Vídeo ======================= */
  function videoTab(app) {
    const R = app.player.renderer;
    const P = R.p;
    const fx = (title, key, ...children) => {
      const chk = F.check(title, P[key], v => R.set(key, v));
      const g = el('div', { class: 'fx' }, chk, children.length ? el('div', { class: 'fx-params' }, children) : null);
      R.on('params', (k, v) => { if (k === key || k === '*') chk.set(R.p[key]); });
      return g;
    };
    const sl = (label, key, min, max, step, fmt, reset) => F.row(label, F.slider({ min, max, step, value: P[key], format: fmt || (v => (+v).toFixed(step < 1 ? 2 : 0)), reset, onInput: v => R.set(key, v) }));
    const sel = (label, key, opts) => F.row(label, F.select(opts, P[key], v => R.set(key, v)));
    const col = (label, key) => F.row(label, F.color(P[key], v => R.set(key, v)));
    const num = (label, key, min, max) => F.row(label, F.number(P[key], v => R.set(key, U.clamp(v, min, max)), { min, max, step: 1 }));

    const essential = el('div', { class: 'fx-grid' },
      fx('Ajuste de imagem', 'adjust',
        sl('Matiz', 'hue', -180, 180, 1, v => v + '°', 0), sl('Brilho', 'brightness', 0, 2, 0.01, null, 1), sl('Contraste', 'contrast', 0, 2, 0.01, null, 1),
        sl('Saturação', 'saturation', 0, 3, 0.01, null, 1), sl('Gama', 'gamma', 0.01, 10, 0.01, null, 1)),
      el('div', {},
        fx('Nitidez', 'sharpen', sl('Sigma', 'sharpenSigma', 0, 2, 0.01)),
        fx('Remoção de faixas (banding)', 'deband', sl('Força', 'debandStrength', 0, 1, 0.01)),
        fx('Granulação de filme', 'grain', sl('Variância', 'grainVariance', 0, 10, 0.1))));

    const cropInputs = {};
    const cropRow = (label, key, pair) => {
      const n = F.number(P[key], v => { R.set(key, Math.max(0, v | 0)); if (syncChk[pair] && syncChk[pair].input.checked) { const other = pairOf[key]; R.set(other, Math.max(0, v | 0)); cropInputs[other].value = v | 0; } }, { min: 0, max: 4000, step: 2 });
      cropInputs[key] = n;
      return F.row(label, n, el('span', { class: 'muted' }, 'px'));
    };
    const pairOf = { cropTop: 'cropBottom', cropBottom: 'cropTop', cropLeft: 'cropRight', cropRight: 'cropLeft' };
    const syncChk = { tb: F.check('Sincronizar superior e inferior', false), lr: F.check('Sincronizar esquerda e direita', false) };
    const crop = el('div', {},
      F.group('Cortar (pixels da imagem de origem)', el('div', { class: 'crop-grid' },
        el('div', { class: 'c-top' }, cropRow('Superior', 'cropTop', 'tb')),
        el('div', { class: 'c-left' }, cropRow('Esquerda', 'cropLeft', 'lr')),
        el('div', { class: 'c-mid' }, U.icon('aspect', 'big muted')),
        el('div', { class: 'c-right' }, cropRow('Direita', 'cropRight', 'lr')),
        el('div', { class: 'c-bottom' }, cropRow('Inferior', 'cropBottom', 'tb'))),
        el('div', { class: 'btn-row' }, syncChk.tb, syncChk.lr, el('span', { class: 'grow' }), F.button('Zerar', () => { for (const k in cropInputs) { cropInputs[k].value = 0; R.set(k, 0); } }, 'small'))),
      F.hint('Para cortar por proporção (16:9, 4:3, 2.35:1…), use o menu Vídeo → Cortar ou a tecla C.'));

    const colors = el('div', { class: 'fx-grid' },
      el('div', {},
        fx('Extração de cor', 'extract', col('Cor', 'extractColor')),
        fx('Limiar de cor', 'threshold', col('Cor', 'thresholdColor'), sl('Saturação', 'thresholdSat', 0, 255, 1), sl('Similaridade', 'thresholdSim', 0, 255, 1)),
        fx('Sépia', 'sepia', sl('Intensidade', 'sepiaIntensity', 0, 255, 1))),
      el('div', {},
        fx('Posterizar', 'posterize', sl('Níveis', 'posterizeLevels', 2, 64, 1)),
        fx('Inverter cores (negativo)', 'negate'),
        fx('Gradiente / detecção de bordas', 'gradient', sel('Modo', 'gradientMode', [['gradient', 'Gradiente'], ['edge', 'Bordas']]), F.check('Cartoon', P.cartoon, v => R.set('cartoon', v)))));

    const geometry = el('div', { class: 'fx-grid' },
      el('div', {},
        fx('Transformar', 'transform', sel('Tipo', 'transformType', [['90', 'Girar 90 graus'], ['180', 'Girar 180 graus'], ['270', 'Girar 270 graus'], ['hflip', 'Inverter horizontalmente'], ['vflip', 'Inverter verticalmente'], ['transpose', 'Transpor'], ['antitranspose', 'Antitranspor']])),
        fx('Zoom interativo', 'izoom', F.hint('Use a roda do mouse sobre o vídeo para ampliar e arraste para mover.')),
        fx('Girar', 'rotate', sl('Ângulo', 'rotateAngle', 0, 359, 1, v => v + '°', 0)),
        fx('Espelho', 'mirror', sel('Modo', 'mirrorMode', [['vertical-lr', 'Vertical (esquerda → direita)'], ['vertical-rl', 'Vertical (direita → esquerda)'], ['horizontal-tb', 'Horizontal (cima → baixo)'], ['horizontal-bt', 'Horizontal (baixo → cima)']]))),
      el('div', {},
        fx('Parede', 'wall', num('Colunas', 'wallCols', 1, 16), num('Linhas', 'wallRows', 1, 16)),
        fx('Quebra-cabeça interativo', 'puzzle', num('Colunas', 'puzzleCols', 2, 16), num('Linhas', 'puzzleRows', 2, 16),
          el('div', { class: 'btn-row' }, F.button('Embaralhar', () => R.shufflePuzzle(), 'small')), F.hint('Clique em duas peças para trocá-las de lugar.')),
        fx('Clonar', 'clone', num('Número de clones', 'cloneCount', 1, 16))));

    let logoName = el('span', { class: 'muted' }, R.logoImg ? 'imagem carregada' : 'nenhuma imagem');
    const posOpts = [['top-left', 'Superior esquerdo'], ['top', 'Superior'], ['top-right', 'Superior direito'], ['left', 'Esquerda'], ['center', 'Centro'], ['right', 'Direita'], ['bottom-left', 'Inferior esquerdo'], ['bottom', 'Inferior'], ['bottom-right', 'Inferior direito']];
    const mtext = el('textarea', { class: 'f-text', rows: '2' });
    mtext.value = P.marqueeText;
    mtext.addEventListener('input', () => R.set('marqueeText', mtext.value));
    mtext.addEventListener('keydown', e => e.stopPropagation());
    const overlay = el('div', { class: 'fx-grid' },
      fx('Adicionar logotipo', 'logo',
        el('div', { class: 'btn-row' }, F.button('Escolher imagem…', async () => {
          const f = await app.pickFiles({ multiple: false, types: 'image' });
          if (!f[0]) return;
          const img = new Image();
          img.onload = () => { R.setLogo(img); R.set('logo', true); logoName.textContent = f[0].file.name; };
          img.src = URL.createObjectURL(f[0].file);
        }, 'small'), logoName),
        sel('Posição', 'logoPos', posOpts), sl('Opacidade', 'logoOpacity', 0, 255, 1), sl('Escala', 'logoScale', 10, 400, 1, v => v + '%', 100),
        sl('X (%; -1 = auto)', 'logoX', -1, 100, 1, null, -1), sl('Y (%; -1 = auto)', 'logoY', -1, 100, 1, null, -1)),
      fx('Adicionar texto (letreiro)', 'marquee',
        F.row('Texto', mtext),
        F.hint('Variáveis: $t título, $a artista, $b álbum, $T tempo, $D duração, $L restante, $P posição, $V volume, $N número na lista, $R velocidade; %H:%M:%S hora atual, %d/%m/%Y data.'),
        sel('Posição', 'marqueePos', posOpts), col('Cor', 'marqueeColor'), sl('Tamanho (0 = auto)', 'marqueeSize', 0, 200, 1), sl('Opacidade', 'marqueeOpacity', 0, 255, 1),
        sl('Tempo limite (ms, 0 = sempre)', 'marqueeTimeout', 0, 60000, 500)));

    const advanced = el('div', { class: 'fx-grid' },
      el('div', {},
        fx('Anaglifo 3D (lado a lado)', 'anaglyph', sel('Esquema', 'anaglyphScheme', [['red-cyan', 'Vermelho/ciano'], ['red-green', 'Vermelho/verde'], ['red-blue', 'Vermelho/azul'], ['trioscopic', 'Trioscópico (verde/magenta)'], ['magenta-cyan', 'Magenta/ciano']])),
        fx('Borrão de movimento', 'motionBlur', sl('Fator', 'motionBlurFactor', 1, 127, 1)),
        fx('Desfoque espacial', 'spatialBlur', sl('Sigma', 'blurSigma', 0.5, 10, 0.1)),
        fx('Redução de ruído (denoiser)', 'denoise', sl('Força', 'denoiseStrength', 0, 1, 0.01)),
        fx('Detecção de movimento', 'motionDetect')),
      el('div', {},
        fx('Ondas', 'waves'),
        fx('Ondulação (água)', 'ripple'),
        fx('Psicodélico', 'psychedelic'),
        fx('Arte ASCII (saída de texto colorido)', 'ascii', sl('Colunas', 'asciiCols', 40, 300, 1)),
        F.group('Desentrelaçamento',
          F.row('Desentrelaçar', F.select([['off', 'Desligado'], ['on', 'Ligado']], app.settings.get('deinterlace'), v => app.settings.set('deinterlace', v))),
          F.row('Modo', F.select([['discard', 'Descartar'], ['blend', 'Mesclar'], ['bob', 'Bob'], ['linear', 'Linear']], app.settings.get('deinterlaceMode'), v => app.settings.set('deinterlaceMode', v))))));

    return F.tabs([
      { id: 'essential', label: 'Essencial', content: essential },
      { id: 'crop', label: 'Cortar', content: crop },
      { id: 'colors', label: 'Cores', content: colors },
      { id: 'geometry', label: 'Geometria', content: geometry },
      { id: 'overlay', label: 'Sobreposição', content: overlay },
      { id: 'advanced', label: 'Avançado', content: advanced }
    ], 'essential', 'sub');
  }

  /* ======================= Sincronização ======================= */
  function syncTab(app, w) {
    const p = app.player, A = p.audio, S = p.subs;
    const spin = (value, min, max, step, onChange, unit) => {
      const n = F.number(value, onChange, { min, max, step });
      return el('span', { class: 'spin' }, n, el('span', { class: 'muted' }, unit || ' s'));
    };
    const aDelay = spin(A.state.delay.toFixed(3), 0, 10, 0.05, v => A.setDelay(v));
    const sDelay = spin(S.delay.toFixed(3), -600, 600, 0.05, v => S.setDelay(v));
    const sSpeed = spin(S.speed.toFixed(3), 0.1, 10, 0.01, v => S.setSpeed(v), ' ×');
    const sDur = spin(S.durationFactor.toFixed(3), 0.2, 20, 0.05, v => S.setDurationFactor(v), ' ×');
    const refresh = () => {
      const set = (sp, v) => { const i = sp.querySelector('input'); if (document.activeElement !== i) i.value = v; };
      set(aDelay, A.state.delay.toFixed(3)); set(sDelay, S.delay.toFixed(3)); set(sSpeed, S.speed.toFixed(3)); set(sDur, S.durationFactor.toFixed(3));
    };
    const off1 = S.on('change', refresh), off2 = A.on('effects', refresh);
    w.onDispose(off1); w.onDispose(off2);
    return el('div', {},
      F.group('Sincronização de áudio/vídeo',
        F.row('Atraso da faixa de áudio:', aDelay),
        F.hint('Valores positivos atrasam o áudio em relação ao vídeo. Teclas: J (−50 ms) / K (+50 ms).')),
      F.group('Sincronização de legendas/vídeo',
        F.row('Atraso da faixa de legenda:', sDelay),
        F.row('Velocidade da legenda:', sSpeed),
        F.row('Fator de duração da legenda:', sDur),
        F.hint('Teclas: G (−50 ms) / H (+50 ms). Sincronização assistida: pressione <b>Shift+H</b> quando ouvir uma fala, <b>Shift+J</b> quando a legenda correspondente aparecer e <b>Shift+K</b> para aplicar. <b>Ctrl+Shift+K</b> redefine.'),
        el('div', { class: 'btn-row' },
          F.button('Marcar áudio (Shift+H)', () => p.syncMark('audio'), 'small'),
          F.button('Marcar legenda (Shift+J)', () => p.syncMark('sub'), 'small'),
          F.button('Sincronizar (Shift+K)', () => p.syncApply(), 'small'),
          F.button('Exportar legenda sincronizada (.srt)', () => {
            const t = S.exportActive();
            if (!t) { app.error('Nenhuma legenda ativa.'); return; }
            U.download(new Blob([t], { type: 'text/plain;charset=utf-8' }), (p.item ? U.stripExt(p.item.name) : 'legenda') + '.sincronizada.srt');
          }, 'small'))),
      el('div', { class: 'btn-row' }, el('span', { class: 'grow' }), F.button('Redefinir sincronização', () => { A.setDelay(0); S.setDelay(0); S.setSpeed(1); S.setDurationFactor(1); refresh(); })));
  }

  VW.dialogsEffects = { effects };
})(window.VW = window.VW || {});
