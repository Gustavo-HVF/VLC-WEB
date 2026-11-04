#!/usr/bin/env node
/* VLC Web — servidor estático local (sem dependências) com suporte a requisições de intervalo (Range),
 * necessário para avançar/retroceder em mídias abertas por URL.
 * Uso: node tools/serve.js [porta]   →   http://localhost:8080 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = +process.argv[2] || +process.env.PORT || 8080;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.ogv': 'video/ogg', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg',
  '.m3u8': 'application/vnd.apple.mpegurl', '.m3u': 'audio/x-mpegurl', '.mpd': 'application/dash+xml', '.ts': 'video/mp2t',
  '.srt': 'text/plain; charset=utf-8', '.vtt': 'text/vtt; charset=utf-8'
};

http.createServer((req, res) => {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400).end(); return; }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404'); return; }
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' };
    const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (range) {
      let start = range[1] === '' ? st.size - +range[2] : +range[1];
      let end = range[1] !== '' && range[2] !== '' ? +range[2] : st.size - 1;
      if (start < 0 || start >= st.size || end < start) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }).end(); return; }
      end = Math.min(end, st.size - 1);
      res.writeHead(206, Object.assign(headers, { 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 }));
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, Object.assign(headers, { 'Content-Length': st.size }));
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    }
  });
}).listen(PORT, () => console.log(`VLC Web disponível em http://localhost:${PORT}`));
