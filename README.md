# VLC Web

Reprodutor multimídia que roda no navegador, feito em **HTML, CSS e JavaScript puros** (sem etapa de build), que leva para a web os recursos da versão para computador do VLC media player: lista de reprodução, legendas, equalizador e efeitos de áudio, filtros de vídeo, captura, gravação, conversão, transmissão e muito mais.

Todo o processamento acontece no computador do usuário: nenhum arquivo é enviado para servidores.

> Projeto independente, inspirado no VLC media player. Não é afiliado nem endossado pela VideoLAN.

## Como executar

Basta servir a pasta por HTTP(S). Qualquer servidor estático serve (GitHub Pages, Netlify, nginx, Apache…).

```bash
node tools/serve.js 8080
```

Depois abra `http://localhost:8080`. O `tools/serve.js` não tem dependências e suporta requisições de intervalo (Range), necessárias para avançar em mídias abertas por URL. O `python -m http.server` funciona, mas não suporta Range.

Abrir o `index.html` direto do disco (`file://`) funciona para o básico, mas o decodificador FFmpeg, a mudança de tom e a captura de câmera exigem HTTP(S) ou `localhost`.

## Recursos

### Mídia (abrir, converter, transmitir)
- **Abrir arquivo, múltiplos arquivos e pasta** (inclusive subpastas), arrastar e soltar arquivos, pastas e URLs, colar com `Ctrl+V`.
- **Abrir disco**: seleciona a pasta de um DVD (`VIDEO_TS`), Blu-ray (`BDMV`) ou CD copiado e encontra os títulos principais.
- **Abrir por link**: `index.html?url=…&play=1&title=…&sub=…` (veja [Abrir uma mídia por link](#abrir-uma-mídia-por-link)).
- **Abrir transmissão de rede**: HTTP(S), **HLS** (`.m3u8`, via hls.js), **MPEG‑DASH** (`.mpd`, via dash.js), rádios Icecast/Shoutcast e listas remotas.
- **Links de download** (`…/dld/<id>?token=…&filename=Filme.mkv`): o título vem do parâmetro `filename=` (ou do cabeçalho `Content-Disposition`). Quando o servidor permite CORS, as faixas do arquivo (idiomas, codecs, canais, capítulos) são lidas por pedidos parciais (*Range*), sem baixar o arquivo. Endereços colados com aspas ou espaços são limpos automaticamente.
- **Dispositivo de captura**: câmera e microfone (com escolha de dispositivo, resolução e taxa de quadros) e **captura da área de trabalho** (tela, janela ou aba).
- **Mídia recente**, retomada de onde parou (perguntar, sempre ou nunca) e teclas de mídia do sistema.
- **Decodificador FFmpeg (WebAssembly)**: arquivos que o navegador não reproduz (AVI, WMV, FLV, MPEG‑2/VOB, MKV com HEVC/AC‑3/DTS, WMA, APE…) são remultiplexados sem perdas ou convertidos localmente e reproduzidos.
- **Converter / salvar** com perfis no estilo do VLC: H.264+MP3/AAC (MP4), VP8+Vorbis e VP9+Vorbis (WebM), Theora (OGG), MPEG‑2 (TS), MPEG‑4 (AVI), GIF, MP3, AAC, Vorbis, FLAC, WAV de CD e remultiplexação sem perdas. Permite editar resolução, taxa de quadros, qualidade, taxas de bits, canais e trecho (início/fim). Há também o modo **tempo real**, que grava a reprodução com os efeitos aplicados.
- **Transmitir**: envia o vídeo processado e o áudio por WebRTC para outra aba ou janela (`receiver.html`) e para Chromecast/AirPlay (Remote Playback API).
- **Salvar lista de reprodução** em M3U, M3U8, XSPF, PLS ou HTML. Também abre M3U, PLS, XSPF, ASX, WPL e CUE.

### Reprodução
- Reproduzir/pausar, parar, anterior/próximo, repetir (desligado, tudo, um), aleatório, parar após cada item e sair ao fim da lista.
- **Velocidade** de 0,0625× a 16× (passos normais e finos), com opção de manter o tom (scaletempo).
- **Saltos** muito curto, curto, médio e longo (configuráveis), **ir para tempo específico** e **quadro a quadro**.
- **Repetição A→B**, **capítulos** (MP4, MKV, MP3/ID3, Ogg, WebVTT), **marcadores personalizados** (com extração do trecho entre dois marcadores) e **gravação** da reprodução.

### Áudio
- Volume até **200%**, mudo e normalização de volume.
- **Equalizador de 10 bandas** com as 18 predefinições do VLC, pré-amplificação, modo de 2 passagens e bandas ISO.
- **Compressor**, **espacializador** (reverberação), **alargador estéreo** e **mudança de tom** (±12 semitons).
- **Modo estéreo**: estéreo, invertido, esquerdo, direito, mono, Dolby Surround e fones de ouvido.
- **Faixas de áudio** com idioma, descrição, codec e canais (ex.: *Faixa 2 — Inglês [eng] — E‑AC‑3 5.1*), em HLS, DASH, arquivos locais e links de rede. Navegadores com a API nativa trocam na hora; nos demais, o FFmpeg separa só a faixa escolhida (ou a converte para AAC, se o navegador não a decodificar), que toca em sincronia com o vídeo. Em links de rede isso exige baixar o arquivo, sempre com confirmação: o vídeo continua tocando e o arquivo fica no armazenamento temporário do navegador (OPFS). Aceita também um **arquivo de áudio externo sincronizado**.
- **Dispositivo de saída** (nos navegadores compatíveis), atraso de áudio e **visualizações**: espectro, espectrômetro, osciloscópio, medidor VU, Goom e espectro 3D.
- **Diagnóstico de som** (*Áudio → Diagnóstico de som*, `Alt+A`): mostra por que o som não sai (motor bloqueado pelo navegador, mudo, volume 0%, faixa desativada ou codec não suportado), com medidor de sinal, tons de teste e correções com um clique.
- Áudio em formatos que o navegador não decodifica (AC‑3, E‑AC‑3, DTS, TrueHD, MP2…) é detectado ao abrir o arquivo ou o link, e só a faixa de áudio é convertida pelo FFmpeg (o vídeo não é reprocessado).
- Quando o navegador bloqueia o motor de áudio, aparece o botão **"Clique para ativar o som"**. Se o bloqueio continuar, a reprodução passa automaticamente para a **saída direta**, sem efeitos. Essa saída também pode ser escolhida em *Preferências → Áudio*.
- Exibição da **capa do álbum** e dos metadados (ID3v1/v2, FLAC, Vorbis/Opus, MP4/M4A, Matroska, WAV).

### Vídeo (filtros em WebGL)
- Tela cheia com controles flutuantes, **imagem sobre imagem** (sempre no topo), zoom (¼, ½, 1:1, 2×, ajustar), **proporção** e **corte** (16:9, 4:3, 2.35:1…), transformações (girar 90°/180°/270°, espelhar, transpor) e desentrelaçamento (descartar, mesclar, bob, linear).
- **Captura de imagem** em PNG, JPEG ou WebP, com miniatura.
- **Efeitos**: ajuste de imagem (matiz, brilho, contraste, saturação, gama), nitidez, remoção de faixas, granulação, corte por pixels, extração e limiar de cor, sépia, posterização, negativo, gradiente/bordas/cartoon, rotação livre, zoom interativo, parede, clone, **quebra-cabeça interativo**, espelho, anaglifo 3D, borrão de movimento, desfoque, ondas, ondulação, psicodélico, redução de ruído, detecção de movimento, **arte ASCII**, **logotipo** e **letreiro** com variáveis ($t, $T, %H:%M…).
- Vídeos de outros sites sem CORS tocam em modo de compatibilidade, com os filtros básicos aplicados via CSS.
- **Resolução máxima** (*Vídeo → Resolução*, `Alt+R`, ou *Preferências → Vídeo → Desempenho*) para vídeos 4K que travam:
  - **Automática** (padrão): os efeitos nunca são processados acima do tamanho da janela. Um vídeo 4K numa janela de 1280 px é processado em ~1280×720, cerca de 9× menos pixels por quadro.
  - **2160p a 360p**: limite fixo. Em fluxos **HLS/DASH**, também limita a qualidade baixada, o que reduz rede e decodificação.
  - **Exibição direta**: sem efeitos ativos, o vídeo é mostrado direto pelo navegador, sem WebGL (o caminho mais leve). Ao ativar um efeito, a troca para WebGL é automática.
  - Com efeitos, cada quadro só é processado quando há um quadro novo (24 qps em vez de 60).
  - As capturas de imagem continuam na resolução original. A barra de status mostra quando a resolução está reduzida (ex.: `4K → 720p`).
  - **Aviso de travamento**: detecta quadros descartados ou página lenta e sugere a correção (reduzir a resolução, desativar efeitos ou criar uma cópia mais leve).
  - **Criar cópia em resolução menor**: converte com o FFmpeg. Num arquivo único, o navegador sempre decodifica a resolução original; essa conversão é lenta no navegador para vídeos 4K.

### Legendas
- Formatos: **SRT, WebVTT, ASS/SSA, MicroDVD (SUB), SubViewer/SBV, MPL2, LRC (letras), SAMI e TTML/DFXP**, além das faixas embutidas (HLS e MKV/MP4 via FFmpeg).
- Carregamento automático de legendas com o mesmo nome do vídeo e detecção de codificação (UTF-8, Windows-1252 e outras 25).
- **Atraso** (G/H), velocidade, fator de duração e **sincronização assistida** (Shift+H, Shift+J, Shift+K), com exportação da legenda já sincronizada.
- Aparência configurável: fonte, tamanho, cor, opacidade, contorno, sombra, fundo e posição.
- **Buscar legendas online** (*Legenda → Buscar legendas online*, `Alt+B`) no **OpenSubtitles**, no **SubDL** e no **SubSource**, como a extensão VLsub do VLC:
  - o título, o ano, a temporada e o episódio são extraídos do nome do arquivo;
  - a busca pelo *hash* do arquivo (OpenSubtitles) encontra a legenda sincronizada com a versão exata do vídeo;
  - permite filtrar por idioma e baixa com um clique; em pacotes .zip de temporada, escolhe o episódio certo.
  - Cada site exige uma **chave de API gratuita**, criada na conta do próprio usuário (aba *Chaves de API*). Sem chave, o botão *Abrir no site* abre a busca no site. A legenda ou o .zip baixado pode ser arrastado para o reprodutor.
- **Traduzir legenda** (*Legenda → Traduzir legenda*, `Alt+T`), por exemplo do inglês para o português:
  - pelo **tradutor integrado do navegador** (Chrome/Edge 138+, roda no próprio computador e não envia a legenda para a internet);
  - pelo **MyMemory** (online e gratuito, com limite diário);
  - ou por um servidor **LibreTranslate**.
  - A faixa traduzida aparece na hora, começando pelo ponto atual do vídeo, mantém o itálico e as quebras de linha e pode ser salva como .srt.

### Temas (skins) e layouts
- **31 temas visuais**, escolhidos na galeria (*Exibir → Tema → Galeria de temas e layouts*, `Alt+K`), com miniaturas, busca e filtros por estilo:
  VLC Web escuro e claro, **Vidro (Glassmorphism)**, **Frutiger Aero**, **Dreamcore**, Vaporwave, Synthwave, Cyberpunk, Y2K cromado, Alumínio escovado, Neumorfismo, Material You, Acrílico (Fluent), Neobrutalismo, Terminal (fósforo verde), 8-bit, Cottagecore, Lo-fi café, Oceano profundo, Floresta, Pôr do sol, Sakura, Galáxia, Nórdico, Drácula, Solarizado, Alto contraste, AMOLED, Retrô 95 (Web 1.0), Liminal (Backrooms) e Steampunk.
- Vários temas têm **fundos animados**, como bolhas, nuvens, estrelas, chuva, pétalas, vaga-lumes, grade neon e linhas de varredura de CRT. As animações pausam durante a reprodução e respeitam a preferência do sistema por menos movimento.
- **9 estruturas de layout**, combináveis com qualquer tema: Clássico, Cartões flutuantes, Janela com moldura, Moldura + cartões, Compacto (barra única), Cinema (controles sobre o vídeo), Lista à esquerda, Controles centralizados e Centralizado flutuante. Cada tema sugere uma estrutura, e `Alt+L` alterna entre elas.
- Modo automático que segue o modo claro/escuro do sistema, cor de destaque personalizável e botão "Surpreenda-me".
- Os temas são definidos só com variáveis CSS em `css/skins.css`. Para criar um novo, basta adicionar um bloco `[data-skin="meu-tema"]` e registrá-lo em `js/core/skins.js`.

### Interface
- Menus completos como no VLC (Mídia, Reprodução, Áudio, Vídeo, Legenda, Ferramentas, Exibir, Ajuda) e **menu de contexto**.
- **Lista de reprodução** encaixada ou flutuante, com busca, colunas configuráveis, ordenação, arrastar para reordenar e seleção múltipla.
- **Biblioteca de mídia** (IndexedDB), **Meu computador** (pastas com acesso persistente), **Rádios da Internet** (diretório radio-browser.info) e **Podcasts** (RSS).
- **Preferências** (Interface, Áudio, Vídeo, Legendas/OSD, Entrada/Codecs) com exportação e importação.
- **Teclas de atalho** do VLC, todas reconfiguráveis.
- **Barra de ferramentas personalizável** (arrastar e soltar), **interface mínima**, tema escuro, claro ou do sistema e cor de destaque.
- **Informações da mídia** (metadados editáveis, codec e estatísticas ao vivo), **Mensagens** com nível de detalhamento e lista de **módulos** e codecs suportados pelo navegador.
- Layout responsivo para celulares e manifesto de aplicativo web, que permite abrir arquivos pelo sistema quando instalado.

## Principais atalhos

| Ação | Tecla | Ação | Tecla |
|---|---|---|---|
| Reproduzir/pausar | `Espaço` | Tela cheia | `F` / duplo clique |
| Parar | `S` | Sair da tela cheia | `Esc` |
| Anterior / próximo | `P` / `N` | Volume | `Ctrl+↑` / `Ctrl+↓`, roda do mouse |
| Mais rápido / mais lento | `+` / `-` | Mudo | `M` |
| Velocidade fina / normal | `]` `[` / `=` | Faixa de áudio / legenda | `B` / `V` |
| Saltos | `Shift`/`Alt`/`Ctrl`/`Ctrl+Alt` + `←` `→` | Atraso da legenda | `G` / `H` |
| Quadro a quadro | `E` | Atraso do áudio | `J` / `K` |
| Repetição A→B | `Shift+L` | Proporção / corte / zoom | `A` / `C` / `Z` |
| Repetir / aleatório | `L` / `R` | Capturar imagem | `Shift+S` |
| Ir para o tempo | `Ctrl+T` | Gravar | `Shift+R` |
| Abrir arquivo / pasta | `Ctrl+O` / `Ctrl+F` | Efeitos e filtros | `Ctrl+E` |
| Abrir rede | `Ctrl+N` (ou `Alt+N`) | Preferências | `Ctrl+P` |
| Lista de reprodução | `Ctrl+L` | Informações | `Ctrl+I` / `Ctrl+J` |
| Interface mínima | `Ctrl+H` | Ajuda / Sobre | `F1` / `Shift+F1` |
| Galeria de temas | `Alt+K` | Próximo tema / layout | `Ctrl+Alt+K` / `Alt+L` |
| Buscar legendas online | `Alt+B` | Traduzir legenda | `Alt+T` |

A lista completa fica em *Ajuda → Teclas de atalho* e pode ser alterada em *Preferências → Teclas de atalho*.

## Limitações dos navegadores

Algumas funções do VLC para computador dependem de acesso ao sistema que páginas web não têm:
- leitura direta de unidades de DVD/Blu-ray/CD (é preciso selecionar a pasta copiada; discos protegidos por CSS/AACS não funcionam);
- protocolos RTSP, RTP/UDP, RTMP, MMS, SMB, FTP, UPnP/DLNA e SAP;
- TV digital ou analógica, VLM e guia de programas;
- servir transmissões HTTP para outros computadores (a transmissão é feita por WebRTC para abas do mesmo navegador ou por Chromecast/AirPlay);
- papel de parede da área de trabalho e extensões em Lua (a busca de legendas do VLsub foi reimplementada em JavaScript).
- Os sites de legendas podem recusar o acesso direto pelo navegador (CORS). Nesse caso, use *Abrir no site* ou configure um proxy CORS de sua confiança.

Também é preciso considerar que:
- URLs de outros sites precisam permitir CORS para os efeitos de áudio/vídeo, a gravação, a leitura das faixas e a conversão funcionarem. Sem CORS, o vídeo toca em modo de compatibilidade e o menu *Áudio → Faixa de áudio* explica as alternativas;
- Chrome e Edge só trocam faixas de áudio de um vídeo em *streaming* com a opção `chrome://flags/#enable-experimental-web-platform-features` ativada. Sem ela, trocar a faixa de um link exige baixar o arquivo;
- o decodificador FFmpeg baixa cerca de 31 MB na primeira vez e processa o arquivo na memória do navegador, então arquivos muito grandes (mais de ~1,5 GB) podem não caber.

## Abrir uma mídia por link

O `index.html` aceita parâmetros, por exemplo para um botão "Abrir no VLC Web" de outro site:

```
index.html?url=https://exemplo.com/filme.mp4&play=1&title=Meu%20filme&sub=https://exemplo.com/filme.srt
```

| Parâmetro | O que faz |
|---|---|
| `url` (ou `mrl`) | mídia, transmissão (HLS/DASH) ou lista remota; pode repetir para abrir vários itens |
| `play=1` (ou `autoplay=1`) | começa a tocar (sem ele, o item só entra na lista) |
| `title` (ou `titulo`) | título do item |
| `sub` (ou `legenda`) | legenda carregada junto com a mídia |

Endereços relativos ao próprio site (como `/m/...`) também são aceitos.

## Navegador pelo celular (Termux-Toons)

O [Termux-Toons](https://github.com/Gustavo-HVF/Termux-Toons) tem um **navegador pelo celular**: uma página que
abre os sites pela conexão do celular. Ele baixa o VLC Web deste repositório e o serve no mesmo endereço, em
`/vlc/`, e o botão **▶ VLC** da barra dele abre no VLC Web os vídeos e músicas da página.

Servido por ele, a página recebe `window.TERMUX_TOONS` e o VLC Web passa a carregar os endereços de rede pela
conexão do celular (`U.viaPhone` em `js/core/util.js`): mídias abertas por link, listas remotas, rádios, podcasts,
busca de legendas (quando não há um proxy CORS próprio) e tradução pelo MyMemory. Como o vídeo chega pelo mesmo
endereço da página, não há bloqueio de CORS: faixas de áudio, legendas embutidas, efeitos e gravação funcionam, e
o avanço usa pedidos parciais (Range). O menu *Mídia → Voltar ao navegador pelo celular* volta à página inicial
dele. Fora do Termux-Toons nada disso muda o comportamento.

## Aplicativo Android

A pasta [`android-app/`](android-app/README.md) transforma esta versão web num **APK para Android**, com Capacitor, sem duplicar o código.
O GitHub Actions gera o APK automaticamente. Baixe a última versão em
[Releases → VLC Web para Android](https://github.com/Gustavo-HVF/VLC-WEB/releases/download/android/VLC-Web.apk).
O app funciona offline com arquivos do celular, e o botão Voltar, a tela cheia e o salvamento de arquivos foram adaptados ao Android.

## Estrutura

```
index.html              página principal
receiver.html           receptor da transmissão WebRTC local
css/app.css             estilos base (tokens de tema, responsivo)
css/skins.css           31 temas, 9 estruturas de layout e fundos animados
js/core/                utilitários, preferências, registro de mensagens e catálogo de temas
js/media/               player, motor de áudio, renderizador WebGL, legendas, metadados,
                        visualizações, lista de reprodução, biblioteca, FFmpeg e gravação
js/ui/                  janelas, menus, ações/atalhos, controles, lista e diálogos
js/app.js               inicialização e integração
assets/                 ícone do site (favicon, PWA, apple-touch) e logotipo
vendor/                 hls.js (Apache-2.0), dash.js (BSD-3), carregador do ffmpeg.wasm (MIT)
tools/serve.js          servidor local de desenvolvimento
android-app/            aplicativo Android (Capacitor) gerado a partir desta versão web
.github/workflows/      compilação automática do APK
```

## Licenças de terceiros

- [hls.js](https://github.com/video-dev/hls.js): Apache License 2.0
- [dash.js](https://github.com/Dash-Industry-Forum/dash.js): BSD 3-Clause
- [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm): MIT. O núcleo FFmpeg (LGPL/GPL) é carregado sob demanda de cdn.jsdelivr.net.
- Diretório de rádios: [radio-browser.info](https://www.radio-browser.info/)
- Alguns temas usam fontes do [Google Fonts](https://fonts.google.com/) (Quicksand, Nunito, Orbitron, Share Tech Mono, Roboto, Space Grotesk, VT323, Press Start 2P, Lora, Cinzel; licença SIL OFL/Apache). Elas são carregadas só quando o tema é escolhido; sem conexão, o tema usa fontes do sistema.
