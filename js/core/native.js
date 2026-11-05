/* VLC Web — integração com o aplicativo Android (Capacitor).
 * No navegador este arquivo não faz nada; no APK ele adapta o que o WebView não oferece:
 * - botão Voltar do Android (fecha janela/menu/tela cheia antes de sair);
 * - tela cheia de verdade (esconde as barras do sistema);
 * - tela sempre ligada durante a reprodução;
 * - salvar arquivos (capturas, conversões, legendas, listas) em Documentos/VLC Web;
 * - links externos abrem no navegador do celular. */
(function (VW) {
  'use strict';
  const C = window.Capacitor;
  const isApp = !!(C && typeof C.isNativePlatform === 'function' && C.isNativePlatform());
  VW.native = { isApp, platform: isApp ? C.getPlatform() : 'web' };
  if (!isApp) return;

  const P = C.Plugins || {};
  const U = VW.util;
  const log = (lvl, msg) => { try { VW.log && VW.log[lvl]('android', msg); } catch (e) { /* ok */ } };
  document.documentElement.classList.add('native-app', 'native-' + VW.native.platform);

  /* ---------- salvar arquivos ---------- */
  // <a download> com blob: não funciona no WebView do Android
  async function writeBlob(blob, path, directory) {
    const FS = P.Filesystem;
    const CH = 3 * 1024 * 1024;                // múltiplo de 3: cada bloco vira base64 independente
    if (!blob.size) await FS.writeFile({ path, data: '', directory, recursive: true });
    for (let i = 0; i < blob.size; i += CH) {
      const buf = new Uint8Array(await blob.slice(i, i + CH).arrayBuffer());
      let bin = '';
      for (let j = 0; j < buf.length; j += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(j, j + 0x8000));
      const data = btoa(bin);
      if (i === 0) await FS.writeFile({ path, data, directory, recursive: true });
      else await FS.appendFile({ path, data, directory });
    }
    return (await FS.getUri({ path, directory })).uri;
  }
  const share = (uri, title) => (P.Share ? P.Share.share({ title, files: [uri] }) : Promise.reject(new Error('Compartilhar indisponível'))).catch(e => { if (!/cancel/i.test(e.message || '')) log('warn', 'Compartilhar: ' + (e.message || e)); });

  async function saveFile(blob, filename) {
    const name = String(filename || 'arquivo').replace(/[\\/:*?"<>|]/g, '_');
    const app = VW.app;
    if (!P.Filesystem) { log('error', 'Plugin Filesystem ausente'); return; }
    try {
      try {
        const perm = await P.Filesystem.checkPermissions();
        if (perm && perm.publicStorage && perm.publicStorage !== 'granted') await P.Filesystem.requestPermissions();
      } catch (e) { /* Android 11+: não precisa de permissão para os próprios arquivos */ }
      const uri = await writeBlob(blob, 'VLC Web/' + name, 'DOCUMENTS');
      log('info', 'Arquivo salvo: Documentos/VLC Web/' + name);
      if (app && app.notify) app.notify(`Salvo em Documentos/VLC Web/${name}`, [['Compartilhar', () => share(uri, name)]], { timeout: 8000 });
    } catch (e) {
      // sem acesso à pasta Documentos: grava no cache do app e abre "Compartilhar" (salvar no Drive, Arquivos, enviar…)
      log('warn', 'Não foi possível salvar em Documentos (' + (e.message || e) + '); usando Compartilhar');
      try { await share(await writeBlob(blob, name, 'CACHE'), name); }
      catch (e2) { if (app) app.error('Não foi possível salvar o arquivo: ' + (e2.message || e2)); }
    }
  }
  U.download = (blob, filename) => { saveFile(blob, filename); };

  /* ---------- links externos → navegador do celular ---------- */
  const origOpen = window.open.bind(window);
  window.open = function (url, target, features) {
    try {
      const u = new URL(url, location.href);
      // o Capacitor abre no navegador do sistema qualquer navegação para fora do app
      if (/^https?:$/.test(u.protocol) && u.host !== location.host) { location.href = u.href; return null; }
    } catch (e) { /* segue */ }
    return origOpen(url, target, features);
  };

  /* ---------- integração com o player (depois que o app inicia) ---------- */
  window.addEventListener('load', () => {
    const app = VW.app;
    if (!app) return;
    const p = app.player;

    // botão Voltar: menu → janela → tela cheia → minimizar (se tocando) → sair
    if (P.App) P.App.addListener('backButton', () => {
      if (app.menu && app.menu.open && app.menu.open.length) { app.menu.closeAll(); return; }
      const w = VW.ui.Win.topmost && VW.ui.Win.topmost();
      if (w) { w.close(); return; }
      if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
      if (p.playing) { P.App.minimizeApp().catch(() => {}); return; }
      P.App.exitApp();
    });

    // tela sempre ligada durante a reprodução de vídeo
    if (P.KeepAwake) {
      let awake = false;
      const upd = () => {
        const on = p.playing && p.hasVideo;
        if (on === awake) return;
        awake = on;
        (on ? P.KeepAwake.keepAwake() : P.KeepAwake.allowSleep()).catch(() => {});
      };
      p.on('state', upd);
      p.on('loaded', upd);
    }

    // tela cheia: o WebView não esconde as barras do sistema sozinho
    if (P.SystemBars) document.addEventListener('fullscreenchange', () => {
      (document.fullscreenElement ? P.SystemBars.hide() : P.SystemBars.show()).catch(() => {});
    });

    log('info', `Aplicativo Android (Capacitor ${C.version || ''}) — plugins: ${Object.keys(P).join(', ')}`);
  });
})(window.VW = window.VW || {});
