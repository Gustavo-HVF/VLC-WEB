// Copia a versão web (raiz do repositório) para android-app/www, que o Capacitor empacota no APK.
// A versão web continua sendo a fonte única: nada é duplicado no repositório.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const out = path.resolve(__dirname, '..', 'www');
const ITEMS = ['index.html', 'receiver.html', 'manifest.webmanifest', 'favicon.ico', 'assets', 'css', 'js', 'vendor'];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
let files = 0;
for (const item of ITEMS) {
  const src = path.join(root, item);
  if (!fs.existsSync(src)) { console.warn('aviso: não encontrado:', item); continue; }
  fs.cpSync(src, path.join(out, item), { recursive: true, dereference: true, filter: s => !/(^|[\\/])(\.DS_Store|Thumbs\.db)$/.test(s) });
  files++;
}
console.log(`Versão web copiada para ${path.relative(process.cwd(), out) || out} (${files} itens)`);
