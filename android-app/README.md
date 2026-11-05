# VLC Web para Android (APK)

Esta pasta gera um **aplicativo Android** a partir da versão web, que continua na raiz do repositório.
O app é feito com [Capacitor](https://capacitorjs.com/) e usa os mesmos arquivos HTML, CSS e JavaScript do site.
Eles são copiados para dentro do APK, então o app abre e toca arquivos do celular mesmo sem internet.

## Baixar e instalar
1. No celular, abra **Releases → "VLC Web para Android"** do repositório e baixe **`VLC-Web.apk`**.
   O link fixo é `https://github.com/Gustavo-HVF/VLC-WEB/releases/download/android/VLC-Web.apk`.
   O APK é publicado ali a cada atualização da branch `main`. Os APKs de outras branches ficam em
   *Actions → APK Android → execução → Artifacts*.
2. Abra o arquivo baixado e, se o Android pedir, permita **instalar apps desta fonte**.
3. As versões novas instalam por cima da anterior, sem perder as configurações.

Requer Android 7.0 ou mais recente. O WebView do sistema (Chrome) deve estar atualizado pela Play Store.

## O que muda em relação ao site
- **Botão Voltar:** fecha menus e janelas. Durante a reprodução, minimiza o app; parado, sai.
- **Tela cheia:** esconde as barras do Android. A tela fica ligada enquanto um vídeo toca.
- **Arquivos salvos** (capturas, conversões, legendas, listas) vão para **Documentos/VLC Web**, com opção de compartilhar.
- **Links externos** (sites de legendas etc.) abrem no navegador do celular.
- **Conteúdo HTTP** (sem "s") é aceito dentro do app.
- O resto é igual ao site: todas as funções, temas e efeitos.

Limitações: o Android não permite escolher uma *pasta* inteira pelo seletor de arquivos; escolha os arquivos.
Servidores sem CORS têm as mesmas restrições do site.

## Gerar o APK no computador (opcional)
Precisa do Node.js 22+, JDK 21 e Android SDK (ou Android Studio).
```bash
cd android-app
npm ci
npm run apk          # copia a versão web, sincroniza e compila
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```
`npm run open` abre o projeto no Android Studio.

## Como funciona
- `scripts/copy-web.js` copia `index.html`, `css/`, `js/`, `assets/`, `vendor/`… da raiz para `www/` (ignorado pelo git).
- `npx cap sync android` coloca `www/` dentro do projeto Android (`android/`).
- `js/core/native.js` (na versão web) só age dentro do app: Voltar, tela cheia, tela ligada e salvar arquivos.
- O GitHub Actions (`.github/workflows/android.yml`) faz tudo isso e compila o APK a cada mudança.

## Assinatura
O APK é assinado com a chave **de teste** `android/app/vlcweb-debug.keystore`, que é pública.
Ela serve para instalar e atualizar no próprio celular. Para distribuir o app (por exemplo, na Play Store), crie sua própria chave:
```bash
keytool -genkeypair -keystore minha.keystore -alias vlcweb -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 minha.keystore
```
Depois, em *Settings → Secrets and variables → Actions*, cadastre `ANDROID_KEYSTORE_BASE64` (a saída do `base64`),
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` e `ANDROID_KEY_PASSWORD`.
Quem instalou o APK com a chave de teste precisará desinstalá-lo uma vez.
