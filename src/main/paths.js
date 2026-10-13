// Ubicación de datos elegida por el usuario (modelos, motores, voces, chats...).
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const SUBDIRS = ['models', 'runtimes', 'voice', 'skills', 'chats', 'config', 'cache', 'logs', 'tmp', 'workspace', 'attachments'];
let dataDir = null;

function locationFile() { return path.join(app.getPath('userData'), 'nexo-location.json'); }

export function isWritable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.nexo-probe-${process.pid}`);
    fs.writeFileSync(probe, 'ok'); fs.unlinkSync(probe);
    return true;
  } catch { return false; }
}

export function defaultDataDir() {
  if (app.isPackaged) {
    // Junto a la instalación (el instalador permite elegir disco/carpeta)
    const nearExe = path.join(path.dirname(process.execPath), 'NexoData');
    if (isWritable(nearExe)) return nearExe;
  }
  return path.join(app.getPath('documents'), 'Nexo AI');
}

export function loadLocation() {
  try {
    const j = JSON.parse(fs.readFileSync(locationFile(), 'utf8'));
    if (j.dataDir && isWritable(j.dataDir)) { dataDir = j.dataDir; ensureDirs(); return dataDir; }
  } catch { }
  return null;
}

export function isConfigured() { return !!dataDir; }

export function setDataDir(dir) {
  const abs = path.resolve(dir);
  if (!isWritable(abs)) throw new Error('No se puede escribir en esa carpeta. Elige otra o ejecuta con permisos.');
  dataDir = abs;
  ensureDirs();
  fs.mkdirSync(path.dirname(locationFile()), { recursive: true });
  fs.writeFileSync(locationFile(), JSON.stringify({ dataDir: abs }, null, 2));
  return abs;
}

export function ensureDirs() { for (const d of SUBDIRS) fs.mkdirSync(path.join(dataDir, d), { recursive: true }); }

export function getDataDir() { return dataDir; }
export function dir(name, ...rest) {
  if (!dataDir) throw new Error('Carpeta de datos no configurada');
  return path.join(dataDir, name, ...rest);
}

export function resourcesDir() {
  // resources/ se desempaqueta del asar para poder ejecutar/leer archivos
  const base = app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked') : app.getAppPath();
  return path.join(base, 'resources');
}

export function diskFree(p) {
  try { const s = fs.statfsSync(p); return { free: s.bavail * s.bsize, total: s.blocks * s.bsize }; } catch { return null; }
}
