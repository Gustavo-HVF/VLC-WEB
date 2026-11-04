# ffmpeg.wasm (carregador)

Arquivos `ffmpeg.js` e `814.ffmpeg.js` do pacote [`@ffmpeg/ffmpeg` 0.12.15](https://github.com/ffmpegwasm/ffmpeg.wasm) — licença **MIT**.

O núcleo (`ffmpeg-core.js` + `ffmpeg-core.wasm`, ~31 MB, pacote `@ffmpeg/core` 0.12.10) **não** está incluído no repositório:
ele é baixado sob demanda de `https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/` na primeira vez em que o
decodificador é necessário. O endereço pode ser alterado em *Ferramentas → Preferências → Entrada / Codecs* (por exemplo,
para hospedar o núcleo no seu próprio servidor). O FFmpeg é distribuído sob LGPL/GPL.
