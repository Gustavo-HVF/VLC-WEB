/* VLC Web — temas visuais (skins) e modelos de estrutura de layout
 * Os estilos de cada tema ficam em css/skins.css (seletor [data-skin="id"]).
 * As estruturas de layout são classes aplicadas ao elemento <html> (lay-*). */
(function (VW) {
  'use strict';
  const U = VW.util;

  /* Etiquetas usadas como filtros na galeria */
  const TAGS = {
    dark: 'Escuros', light: 'Claros', glass: 'Vidro e transparência', retro: 'Retrô e nostalgia',
    aesthetic: 'Estéticas', neon: 'Neon', nature: 'Natureza', minimal: 'Minimalistas', a11y: 'Acessibilidade'
  };

  /* fonts: famílias do Google Fonts carregadas somente quando o tema é usado */
  const SKINS = [
    { id: 'default', name: 'VLC Web escuro', desc: 'O visual padrão: escuro, sóbrio e com destaque laranja.', base: 'dark', layout: 'classic', tags: ['dark', 'minimal'], color: '#17181b' },
    { id: 'light', name: 'VLC Web claro', desc: 'A versão clara do tema padrão, ideal para ambientes iluminados.', base: 'light', layout: 'classic', tags: ['light', 'minimal'], color: '#eceef1' },
    { id: 'glass', name: 'Vidro (Glassmorphism)', desc: 'Painéis de vidro fosco translúcido sobre manchas de cor animadas.', base: 'dark', layout: 'floating', tags: ['glass', 'dark', 'aesthetic'], color: '#1d1b4b' },
    { id: 'aero', name: 'Frutiger Aero', desc: 'Céu azul, grama verde, bolhas e botões brilhantes estilo anos 2000.', base: 'light', layout: 'framed-floating', tags: ['glass', 'light', 'retro', 'aesthetic', 'nature'], color: '#2f9fe6', fonts: 'Nunito:wght@400;600;700' },
    { id: 'dreamcore', name: 'Dreamcore', desc: 'Céu pastel, nuvens flutuando e brilhos — nostálgico e onírico.', base: 'light', layout: 'floating', tags: ['light', 'aesthetic'], color: '#ffd1f0', fonts: 'Quicksand:wght@400;500;600;700' },
    { id: 'vaporwave', name: 'Vaporwave', desc: 'Pôr do sol listrado, grade em perspectiva e janelas rosa e ciano.', base: 'dark', layout: 'framed', tags: ['dark', 'retro', 'aesthetic', 'neon'], color: '#4b1d6e' },
    { id: 'synthwave', name: 'Synthwave (Outrun)', desc: 'Noite neon dos anos 80 com brilho magenta e grade digital.', base: 'dark', layout: 'floating', tags: ['dark', 'neon', 'retro'], color: '#120022', fonts: 'Orbitron:wght@500;700' },
    { id: 'cyberpunk', name: 'Cyberpunk', desc: 'Preto e amarelo, cantos cortados, faixas de alerta e falhas digitais.', base: 'dark', layout: 'compact', tags: ['dark', 'neon'], color: '#0b0b0f', fonts: 'Share+Tech+Mono' },
    { id: 'y2k', name: 'Y2K cromado', desc: 'Prata metálico, holográfico e bolhas — o futuro visto do ano 2000.', base: 'light', layout: 'framed', tags: ['light', 'retro', 'aesthetic'], color: '#dfe3ea' },
    { id: 'aluminum', name: 'Alumínio escovado', desc: 'Skeuomorfismo clássico: metal escovado e visor de cristal líquido.', base: 'light', layout: 'classic', tags: ['light', 'retro'], color: '#c9ccd1' },
    { id: 'neumorphism', name: 'Neumorfismo', desc: 'Interface suave em relevo, com sombras claras e escuras.', base: 'light', layout: 'centered-floating', tags: ['light', 'minimal'], color: '#e0e5ec' },
    { id: 'material', name: 'Material You', desc: 'Cores tonais, cantos bem arredondados e botões em pílula.', base: 'light', layout: 'centered-floating', tags: ['light', 'minimal'], color: '#fdf8fd', fonts: 'Roboto:wght@400;500;700' },
    { id: 'acrylic', name: 'Acrílico (Fluent)', desc: 'Material acrílico desfocado com luz azul e roxa ao fundo.', base: 'dark', layout: 'framed', tags: ['glass', 'dark', 'minimal'], color: '#101418' },
    { id: 'brutalism', name: 'Neobrutalismo', desc: 'Bordas grossas, sombras duras e cores chapadas sem medo.', base: 'light', layout: 'framed', tags: ['light', 'aesthetic'], color: '#fff6dc', fonts: 'Space+Grotesk:wght@400;500;700' },
    { id: 'terminal', name: 'Terminal (fósforo verde)', desc: 'Monitor CRT verde com linhas de varredura e fonte de terminal.', base: 'dark', layout: 'sidebar-left', tags: ['dark', 'retro', 'neon'], color: '#000000', fonts: 'VT323' },
    { id: 'pixel', name: '8-bit (pixel art)', desc: 'Fonte pixelada, bordas em blocos e paleta de console antigo.', base: 'dark', layout: 'classic', tags: ['dark', 'retro'], color: '#1b1b3a', fonts: 'Press+Start+2P' },
    { id: 'cottagecore', name: 'Cottagecore', desc: 'Creme, verde-sálvia e flores — aconchegante como uma casa de campo.', base: 'light', layout: 'sidebar-left', tags: ['light', 'nature', 'aesthetic'], color: '#f6efe2', fonts: 'Lora:wght@400;600;700' },
    { id: 'cafe', name: 'Lo-fi café', desc: 'Tons de café, luz quente e chuva na janela para relaxar.', base: 'dark', layout: 'floating', tags: ['dark', 'aesthetic'], color: '#241914', fonts: 'Nunito:wght@400;600;700' },
    { id: 'ocean', name: 'Oceano profundo', desc: 'Azul abissal, raios de luz e bolhas subindo.', base: 'dark', layout: 'floating', tags: ['dark', 'nature', 'glass'], color: '#021526' },
    { id: 'forest', name: 'Floresta', desc: 'Verde musgo noturno com vaga-lumes piscando.', base: 'dark', layout: 'classic', tags: ['dark', 'nature'], color: '#0d1b14' },
    { id: 'sunset', name: 'Pôr do sol', desc: 'Degradê de roxo a dourado com painéis de vidro.', base: 'dark', layout: 'floating', tags: ['dark', 'glass', 'nature'], color: '#7b2ff7' },
    { id: 'sakura', name: 'Sakura', desc: 'Rosa suave com pétalas de cerejeira caindo.', base: 'light', layout: 'centered', tags: ['light', 'nature', 'aesthetic'], color: '#fff0f5', fonts: 'Nunito:wght@400;600;700' },
    { id: 'galaxy', name: 'Galáxia', desc: 'Nebulosas, estrelas cintilantes e vidro escuro.', base: 'dark', layout: 'floating', tags: ['dark', 'glass', 'aesthetic'], color: '#05030f' },
    { id: 'nord', name: 'Nórdico (Nord)', desc: 'Paleta ártica fria e equilibrada, ótima para longas sessões.', base: 'dark', layout: 'classic', tags: ['dark', 'minimal'], color: '#2e3440' },
    { id: 'dracula', name: 'Drácula', desc: 'O famoso tema escuro roxo e rosa dos editores de código.', base: 'dark', layout: 'classic', tags: ['dark', 'minimal'], color: '#282a36' },
    { id: 'solarized', name: 'Solarizado claro', desc: 'Paleta Solarized: creme com azuis precisos e baixo contraste.', base: 'light', layout: 'compact', tags: ['light', 'minimal'], color: '#fdf6e3' },
    { id: 'contrast', name: 'Alto contraste', desc: 'Preto, branco e amarelo com bordas grossas — máxima legibilidade.', base: 'dark', layout: 'classic', tags: ['dark', 'a11y'], color: '#000000' },
    { id: 'amoled', name: 'AMOLED (preto puro)', desc: 'Preto absoluto para telas OLED, com controles sobre o vídeo.', base: 'dark', layout: 'cinema', tags: ['dark', 'minimal'], color: '#000000' },
    { id: 'web1', name: 'Retrô 95 (Web 1.0)', desc: 'Janelas cinza em relevo, barras de título azuis e área de trabalho verde-azulada.', base: 'light', layout: 'framed', tags: ['light', 'retro'], color: '#008080' },
    { id: 'liminal', name: 'Liminal (Backrooms)', desc: 'Amarelo monótono, carpete e luz fluorescente piscando. Estranhamente familiar.', base: 'light', layout: 'classic', tags: ['light', 'aesthetic'], color: '#cdbd73' },
    { id: 'steampunk', name: 'Steampunk', desc: 'Latão, cobre, madeira escura e rebites vitorianos.', base: 'dark', layout: 'framed', tags: ['dark', 'retro', 'aesthetic'], color: '#2a1d14', fonts: 'Cinzel:wght@500;700' }
  ];

  const LAYOUTS = {
    classic: { name: 'Clássico', desc: 'Menus, vídeo e controles encaixados, como no VLC para computador.', cls: [] },
    floating: { name: 'Cartões flutuantes', desc: 'Vídeo, lista e controles em cartões separados sobre o papel de parede.', cls: ['lay-floating'] },
    framed: { name: 'Janela com moldura', desc: 'O reprodutor fica numa janela arredondada sobre o papel de parede.', cls: ['lay-framed'] },
    'framed-floating': { name: 'Moldura + cartões', desc: 'Janela com moldura e cartões flutuantes dentro dela.', cls: ['lay-framed', 'lay-floating'] },
    compact: { name: 'Compacto', desc: 'Uma única barra de controles com a linha do tempo ao lado, sem barra de status.', cls: ['lay-compact'] },
    cinema: { name: 'Cinema', desc: 'O vídeo ocupa toda a área e os controles flutuam sobre ele, sumindo durante a reprodução.', cls: ['lay-cinema'] },
    'sidebar-left': { name: 'Lista à esquerda', desc: 'A lista de reprodução fica do lado esquerdo do vídeo.', cls: ['lay-left'] },
    centered: { name: 'Controles centralizados', desc: 'Botões de reprodução centralizados abaixo do vídeo.', cls: ['lay-center'] },
    'centered-floating': { name: 'Centralizado flutuante', desc: 'Controles centralizados em cartões flutuantes.', cls: ['lay-center', 'lay-floating'] }
  };
  const ALL_LAYOUT_CLASSES = ['lay-floating', 'lay-framed', 'lay-compact', 'lay-cinema', 'lay-left', 'lay-center'];

  const loadedFonts = new Set();
  function loadFonts(families) {
    const list = families.filter(f => f && !loadedFonts.has(f));
    if (!list.length) return;
    list.forEach(f => loadedFonts.add(f));
    const href = 'https://fonts.googleapis.com/css2?' + list.map(f => 'family=' + f).join('&') + '&display=swap';
    document.head.appendChild(U.el('link', { rel: 'stylesheet', href, 'data-skin-fonts': '' }));
  }

  function get(id) { return SKINS.find(s => s.id === id) || SKINS[0]; }

  /** Resolve o tema efetivo ("auto" segue o esquema de cores do sistema). */
  function resolve(id) {
    if (id === 'auto') return get(window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'default');
    return get(id);
  }

  function layoutOf(settings, skin) {
    const l = settings.get('layout');
    return LAYOUTS[l] ? l : (LAYOUTS[skin.layout] ? skin.layout : 'classic');
  }

  /** Aplica tema, estrutura de layout, fontes e cor de destaque personalizada ao documento. */
  function apply(settings, doc = document) {
    const skin = resolve(settings.get('skin'));
    const root = doc.documentElement;
    root.dataset.skin = skin.id;
    root.dataset.theme = skin.base;
    const layout = layoutOf(settings, skin);
    root.classList.remove(...ALL_LAYOUT_CLASSES);
    root.classList.add(...LAYOUTS[layout].cls);
    root.dataset.layout = layout;
    if (skin.fonts && doc === document) loadFonts([skin.fonts]);
    if (settings.get('accentOverride') && settings.get('accent')) root.style.setProperty('--accent', settings.get('accent'));
    else root.style.removeProperty('--accent');
    const meta = doc.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = skin.color;
    return { skin, layout };
  }

  function loadAllFonts() { loadFonts(SKINS.map(s => s.fonts).filter(Boolean)); }

  /** Miniatura de visualização de um tema/layout (usada na galeria). */
  function mock(skinId, layoutId) {
    const skin = get(skinId);
    const lay = LAYOUTS[layoutId || skin.layout] || LAYOUTS.classic;
    const i = n => Array.from({ length: n }, () => U.el('i'));
    return U.el('div', { class: 'mock', 'data-skin': skin.id, 'data-theme': skin.base, 'aria-hidden': 'true' },
      U.el('div', { class: 'mk-app ' + lay.cls.map(c => 'mk-' + c).join(' ') },
        U.el('div', { class: 'mk-menu' }, i(5)),
        U.el('div', { class: 'mk-main' },
          U.el('div', { class: 'mk-stage' }, U.el('span', { class: 'mk-logo' }), U.el('span', { class: 'mk-title' }), U.el('span', { class: 'mk-btns' }, i(3))),
          U.el('div', { class: 'mk-pl' }, i(5))),
        U.el('div', { class: 'mk-ctrl' },
          U.el('div', { class: 'mk-seek' }, U.el('b')),
          U.el('div', { class: 'mk-bar' }, U.el('span', { class: 'mk-play' }), i(4), U.el('em'), U.el('span', { class: 'mk-vol' }))),
        U.el('div', { class: 'mk-status' })));
  }

  VW.skins = { SKINS, LAYOUTS, TAGS, get, resolve, apply, layoutOf, loadFonts, loadAllFonts, mock };
})(window.VW = window.VW || {});
