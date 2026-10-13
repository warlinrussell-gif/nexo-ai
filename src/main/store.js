// Persistencia JSON con escritura atómica y cifrado de secretos (safeStorage del SO).
import fs from 'node:fs';
import path from 'node:path';
import { safeStorage } from 'electron';
import { dir } from './paths.js';

const cache = new Map();
const timers = new Map();

function file(name) { return dir('config', `${name}.json`); }

export function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

export function writeJSONAtomic(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, p);
}

export function load(name, defaults) {
  if (cache.has(name)) return cache.get(name);
  const data = readJSON(file(name), undefined);
  const value = data === undefined ? structuredClone(defaults) : mergeDefaults(data, defaults);
  cache.set(name, value);
  return value;
}

function mergeDefaults(data, defaults) {
  if (Array.isArray(defaults) || typeof defaults !== 'object' || defaults === null) return data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return data;
  const out = { ...data };
  for (const [k, v] of Object.entries(defaults)) {
    if (!(k in out)) out[k] = structuredClone(v);
    else if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = mergeDefaults(out[k], v);
  }
  return out;
}

export function save(name, value, immediate = false) {
  cache.set(name, value);
  clearTimeout(timers.get(name));
  const doWrite = () => { try { writeJSONAtomic(file(name), value); } catch (e) { console.error('save', name, e); } };
  if (immediate) doWrite(); else timers.set(name, setTimeout(doWrite, 300));
}

export function flushAll() {
  for (const [name, t] of timers) { clearTimeout(t); try { writeJSONAtomic(file(name), cache.get(name)); } catch { } }
  timers.clear();
}

export function resetCache() { cache.clear(); }

export function encrypt(text) {
  if (!text) return '';
  try { if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(text).toString('base64'); } catch { }
  return 'b64:' + Buffer.from(text, 'utf8').toString('base64');
}

export function decrypt(v) {
  if (!v) return '';
  try {
    if (v.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64'));
    if (v.startsWith('b64:')) return Buffer.from(v.slice(4), 'base64').toString('utf8');
  } catch { return ''; }
  return v;
}
