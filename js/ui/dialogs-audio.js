/* VLC Web — Áudio → Diagnóstico de som: mostra por que o som não sai e oferece as correções */
(function (VW) {
  'use strict';
  const U = VW.util;
  const el = U.el;
  const { Win, F } = VW.ui;

  function diagnostics(app) {
    const ex = Win.get('audio-diag');
    if (ex) { ex.focus(); return; }
    const p = app.player, A = p.audio, S = app.settings;
    const w = new Win({ id: 'audio-diag', title: 'Diagnóstico de som', width: 620, icon: 'volume' });
    const table = el('table', { class: 'kv' });
    const meter = el('div', { class: 'diag-meter', title: 'Nível do sinal na saída do motor de áudio' }, el('b'));
    const advice = el('div', { class: 'f-hint' });
    const actions = el('div', { class: 'btn-row' });
    const ok = t => el('span', { class: 'diag-ok' }, t), bad = t => el('span', { class: 'diag-bad' }, t), warn = t => el('span', { class: 'diag-warn' }, t);

    const render = () => {
      const m = p.media, it = p.item;
      const attached = !!(m && A.isAttached(m));
      const rows = [];
      const problems = [];
      const ctxState = A.ctx ? A.ctx.state : 'não iniciado';
      rows.push(['Saída de áudio', p.directAudio || (it && !attached) ? 'Direta (sem efeitos)' : 'Motor de efeitos (Web Audio)']);
      if (attached || !p.directAudio) {
        const s = { running: ok('funcionando'), suspended: bad('suspenso pelo navegador'), interrupted: bad('interrompido pelo sistema'), closed: bad('fechado') }[ctxState] || warn(ctxState);
        rows.push(['Motor de áudio', s]);
        if (attached && ctxState !== 'running' && !m.paused) problems.push('O navegador bloqueou o motor de áudio até haver um clique. Clique em "Ativar som". Se não resolver, use "Usar saída direta".');
      }
      rows.push(['Áudio ativado (Preferências)', S.get('audioEnabled') ? ok('sim') : bad('não')]);
      if (!S.get('audioEnabled')) problems.push('O áudio está desligado em Preferências → Áudio → "Ativar áudio".');
      rows.push(['Faixa de áudio da mídia', p.audioTrackOff ? bad('desativada') : ok('ativada')]);
      if (p.audioTrackOff) problems.push('A faixa de áudio desta mídia foi desativada (Áudio → Faixa de áudio).');
      rows.push(['Volume', A.volume < 0.01 ? bad('0%') : Math.round(A.volume * 100) + '%']);
      rows.push(['Mudo', A.muted ? bad('sim') : ok('não')]);
      if (A.muted || A.volume < 0.01) problems.push('O som está no mudo ou com volume 0% (tecla M / roda do mouse).');
      if (A.state.stereo !== 'stereo') rows.push(['Modo estéreo', A.state.stereo]);
      if (it && it.file) {
        const tr = ((it.info && it.info.tracks) || []).filter(t => t.type === 'audio');
        const t = tr.find(x => x.default) || tr[0];
        const name = !it.playable && VW.Player.unsupportedAudioCodec(it);
        rows.push(['Codec de áudio do arquivo', t ? (t.codec || t.codecId || '—') + (name ? ' — ' : '') : (it.info ? 'sem faixa de áudio' : 'analisando…')]);
        if (name) { rows[rows.length - 1][1] = el('span', {}, (t.codec || t.codecId) + ' — ', bad('não suportado pelo navegador')); problems.push(`O áudio deste arquivo está em ${name}. O navegador não decodifica esse formato: use "Converter o áudio com FFmpeg".`); }
        if (it.playable) rows.push(['Conversão FFmpeg', ok('em uso')]);
      }
      if (m && it && !p.isImage) {
        let dec = '—';
        if (m.webkitAudioDecodedByteCount !== undefined) dec = m.webkitAudioDecodedByteCount > 0 ? ok(U.fmtBytes(m.webkitAudioDecodedByteCount) + ' decodificados') : (m.paused ? '0 B (pausado)' : bad('nada decodificado'));
        else if (m.mozHasAudio !== undefined) dec = m.mozHasAudio ? ok('sim') : bad('não');
        rows.push(['Áudio sendo decodificado', dec]);
        rows.push(['Elemento de mídia', `${m.muted ? 'mudo' : 'som ligado'}, volume ${Math.round(m.volume * 100)}%`]);
      }
      if (S.get('audioDevice') && S.get('audioDevice') !== 'default') rows.push(['Dispositivo de saída', S.get('audioDevice').slice(0, 24) + '…']);
      if (A.state.delay > 0) rows.push(['Atraso do áudio', Math.round(A.state.delay * 1000) + ' ms']);
      table.textContent = '';
      for (const [k, v] of rows) table.appendChild(el('tr', {}, el('th', {}, k), el('td', {}, v)));
      advice.textContent = '';
      if (!it) advice.append('Abra uma mídia para verificar o som dela. Os tons de teste abaixo verificam a saída do computador.');
      else if (problems.length) advice.append(el('b', {}, 'Possíveis causas: '), el('ul', {}, problems.map(t => el('li', {}, t))));
      else advice.append('Nenhum problema encontrado pelo VLC Web. Se ainda não houver som, use os tons de teste: se nenhum deles tocar, verifique o volume do sistema, o dispositivo de saída (fones/caixas) e se a aba do navegador não está silenciada.');
    };
    const tick = () => {
      const lv = A.level();
      U.$('b', meter).style.width = Math.min(100, Math.round(Math.sqrt(lv) * 220)) + '%';
    };
    render();
    const t1 = setInterval(render, 1000), t2 = setInterval(tick, 80);
    w.onDispose(() => { clearInterval(t1); clearInterval(t2); });

    const btn = (label, fn, cls) => F.button(label, async e => { const b = e.currentTarget; b.disabled = true; try { await fn(); } catch (err) { app.error(err.message || String(err)); } b.disabled = false; render(); }, 'small ' + (cls || ''));
    actions.append(
      btn('Ativar som', async () => { const r = await p.unlockAudio(); app.controls.osd(r ? 'Som ativado' : 'Usando a saída direta'); }, 'primary'),
      btn('Tom de teste (motor de efeitos)', async () => { if (!(await A.testTone(false))) app.error('O navegador não liberou o motor de áudio. Clique em "Ativar som" ou use a saída direta.'); }),
      btn('Tom de teste (saída direta)', () => A.testTone(true)),
      btn(p.directAudio ? 'Voltar ao motor de efeitos' : 'Usar saída direta (sem efeitos)', () => p.setDirectAudio(!p.directAudio)),
      btn('Converter o áudio com FFmpeg', () => { if (!p.item || !p.item.file) throw new Error('Disponível apenas para arquivos locais.'); p.playWithFFmpeg(p.item); }),
      btn('Redefinir áudio', () => {
        S.set('audioEnabled', true);
        if (p.audioTrackOff) p.setAudioTrackOff(false);
        if (A.muted) p.toggleMute();
        if (A.volume < 0.05) p.setVolume(1);
        A.setStereoMode('stereo'); A.setDelay(0);
      }));
    w.body.append(table, el('div', { style: { margin: '10px 0 4px' } }, 'Nível do sinal:'), meter, advice, actions);
    w.footer.append(F.button('Fechar', () => w.close(), 'primary'));
    w.show();
  }

  VW.dialogsAudio = { diagnostics };
})(window.VW = window.VW || {});
