// Compila el instalador de Windows: 1) electron-builder genera win-unpacked (con icono vía resedit)
// 2) makensis crea el instalador NSIS propio (funciona en Windows, Linux y macOS sin Wine).
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const skipPack = process.argv.includes('--skip-pack');

if (!skipPack) {
  console.log('» Empaquetando la aplicación (win-unpacked)…');
  execSync('npx electron-builder --win dir --x64 --publish never', { cwd: root, stdio: 'inherit' });
}

function findNsis() {
  const caches = [
    path.join(os.homedir(), '.cache', 'electron-builder'),
    path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache'),
    path.join(os.homedir(), 'Library', 'Caches', 'electron-builder'),
    process.env.ELECTRON_BUILDER_CACHE || ''
  ].filter(Boolean);
  for (const c of caches) {
    const base = path.join(c, 'nsis-3.0.4.1');
    if (!fs.existsSync(base)) continue;
    for (const d of fs.readdirSync(base)) {
      const dir = path.join(base, d);
      const bin = process.platform === 'win32' ? path.join(dir, 'makensis.exe') : path.join(dir, process.platform === 'darwin' ? 'mac' : 'linux', 'makensis');
      if (fs.existsSync(bin)) return { dir, bin };
    }
  }
  return null;
}

let nsis = findNsis();
if (!nsis) {
  console.log('» Descargando NSIS (una sola vez)…');
  // Forzar a electron-builder a descargar el paquete NSIS
  spawnSync('npx', ['electron-builder', '--win', 'nsis', '--x64', '--publish', 'never', '--prepackaged', path.join(root, 'release', 'win-unpacked')], { cwd: root, stdio: 'ignore', shell: true });
  nsis = findNsis();
}
if (!nsis) { console.error('No se encontró makensis. Instala NSIS 3 y vuelve a intentarlo.'); process.exit(1); }
if (process.platform !== 'win32') { try { fs.chmodSync(nsis.bin, 0o755); } catch { } }

const out = path.join(root, 'release', `NexoAI-Setup-${version}.exe`);
const src = path.join(root, 'release', 'win-unpacked');
console.log('» Compilando instalador con', nsis.bin);
const r = spawnSync(nsis.bin, [`-DVERSION=${version}`, `-DSRC=${src}`, `-DOUTFILE=${out}`, '-INPUTCHARSET', 'UTF8', '-V2', path.join(root, 'build', 'nexo-installer.nsi')], {
  cwd: path.join(root, 'build'), stdio: 'inherit', env: { ...process.env, NSISDIR: nsis.dir }
});
if (r.status !== 0) { console.error('makensis falló'); process.exit(r.status || 1); }
const size = fs.statSync(out).size;
console.log(`✔ Instalador listo: ${out} (${(size / 1048576).toFixed(1)} MB)`);
