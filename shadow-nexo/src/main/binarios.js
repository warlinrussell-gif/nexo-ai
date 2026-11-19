// Análisis de binarios de taller: hashes, tipo real, entropía, cabeceras, strings y firmas.
// Solo lectura: nunca modifica el archivo analizado.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { dir } from './paths.js';

const MAGIC = [
  [Buffer.from('7f454c46', 'hex'), 'ELF', 'Ejecutable / firmware Linux (ELF)'],
  [Buffer.from('4d5a', 'hex'), 'PE', 'Ejecutable Windows (PE / MZ)'],
  [Buffer.from('504b0304', 'hex'), 'ZIP', 'Archivo ZIP (posible OTA / APK / payload)'],
  [Buffer.from('1f8b', 'hex'), 'GZIP', 'Archivo comprimido gzip'],
  [Buffer.from('425a68', 'hex'), 'BZIP2', 'Archivo comprimido bzip2'],
  [Buffer.from('fd377a585a00', 'hex'), 'XZ', 'Archivo comprimido xz'],
  [Buffer.from('377abcaf271c', 'hex'), '7Z', 'Archivo 7-Zip'],
  [Buffer.from('52617221', 'hex'), 'RAR', 'Archivo RAR'],
  [Buffer.from('89504e470d0a1a0a', 'hex'), 'PNG', 'Imagen PNG'],
  [Buffer.from('ffd8ff', 'hex'), 'JPEG', 'Imagen JPEG'],
  [Buffer.from('47494638', 'hex'), 'GIF', 'Imagen GIF'],
  [Buffer.from('25504446', 'hex'), 'PDF', 'Documento PDF'],
  [Buffer.from('414e44524f49445f424f4f54', 'hex'), 'ANDROID', 'Imagen de arranque Android (boot.img)'],
  [Buffer.from('444c58', 'hex'), 'DLX', 'Cabecera DLX / variante boot'],
  [Buffer.from('3a', 'hex'), 'SPARSE', 'Imagen dispersa de Android (sparse)'],
  [Buffer.from('d00dfeed', 'hex'), 'DTB', 'Device Tree Blob'],
  [Buffer.from('27051956', 'hex'), 'UIMAGE', 'Imagen u-boot'],
  [Buffer.from('cafebabe', 'hex'), 'MACHO', 'Binario Mach-O / Java class'],
  [Buffer.from('23212f', 'hex'), 'SCRIPT', 'Script con shebang'],
  [Buffer.from('4d534d', 'hex'), 'MSM', 'Posible firmware Qualcomm (MSM)'],
  [Buffer.from('514649', 'hex'), 'QFIL', 'Posible paquete QFIL'],
  [Buffer.from('3c3f786d6c', 'hex'), 'XML', 'Documento XML (rawprogram / patch)'],
  [Buffer.from('7b', 'hex'), 'JSON?', 'Posible JSON'],
  [Buffer.from('454c46', 'hex'), 'ELF?', 'Posible ELF sin cabecera válida']
];

const FIRMAS = [
  ['Qualcomm Sahara/Firehose', 'ELF con cadenas sahara o firehose'],
  ['Android boot image', 'Cabecera ANDROID'],
  ['Sparse image', 'Imagen dispersa de Android'],
  ['OTA payload', 'payload.bin / update.zip'],
  ['rawprogram/patch XML', 'XML de flasheo Qualcomm'],
  ['GPT', 'Tabla de particiones'],
  ['Firmware firmado', 'Contiene cadenas de firma / certificado'],
  ['Comprimido', 'Contenedor comprimido'],
  ['Ofuscado / cifrado', 'Entropía muy alta y sin cadenas legibles']
];

const PARTICIONES = ['boot', 'recovery', 'vbmeta', 'super', 'system', 'vendor', 'product', 'odm', 'persist', 'modem', 'modemst1', 'modemst2', 'fsg', 'xbl', 'xbl_config', 'abl', 'devcfg', 'tz', 'rpm', 'hyp', 'keymaster', 'dtbo', 'userdata', 'metadata', 'misc', 'frp', 'efs', 'param', 'lk', 'preloader', 'nvram', 'nvdata', 'proinfo', 'sparsecr'];

function entropy(buf) {
  if (!buf.length) return 0;
  const freq = new Array(256).fill(0);
  for (const b of buf) freq[b]++;
  let h = 0;
  for (const f of freq) {
    if (!f) continue;
    const p = f / buf.length;
    h -= p * Math.log2(p);
  }
  return h;
}

function detectMagic(buf) {
  for (const [sig, id, desc] of MAGIC) {
    if (buf.length >= sig.length && buf.subarray(0, sig.length).equals(sig)) return { id, desc };
  }
  return { id: 'DESCONOCIDO', desc: 'Sin firma conocida' };
}

/** Analiza un archivo y devuelve un informe estructurado. Solo lectura. */
export async function analyze(file) {
  const st = fs.statSync(file);
  const head = Buffer.alloc(Math.min(st.size, 65536));
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, head, 0, head.length, 0); } finally { fs.closeSync(fd); }

  const magic = detectMagic(head);
  const ent = entropy(head);
  const ext = path.extname(file).toLowerCase();

  const hash = (alg) => new Promise((resolve) => {
    const h = crypto.createHash(alg);
    const s = fs.createReadStream(file);
    s.on('data', (c) => h.update(c));
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', () => resolve(''));
  });
  const [sha256, md5] = await Promise.all([hash('sha256'), hash('md5')]);

  // Cadenas ASCII/UTF-16 útiles
  const text = head.toString('latin1');
  const strings = [...new Set((text.match(/[\x20-\x7e]{5,}/g) || []).map((s) => s.trim()))].slice(0, 120);
  const lower = text.toLowerCase();
  const found = [];
  for (const p of PARTICIONES) if (lower.includes(p)) found.push(p);

  const firmas = [];
  if (/sahara|firehose/.test(lower) || /\.elf$/i.test(file)) firmas.push('Qualcomm Sahara/Firehose');
  if (head.subarray(0, 8).toString('latin1') === 'ANDROID!') firmas.push('Android boot image');
  if (head[0] === 0x3a && head[1] === 0x00) firmas.push('Sparse image');
  if (/payload\.bin|update\.zip/i.test(file)) firmas.push('OTA payload');
  if (/rawprogram|patch/i.test(file) && /xml/i.test(magic.id)) firmas.push('rawprogram/patch XML');
  if (lower.includes('efi part')) firmas.push('GPT');
  if (/signature|certificate|pkcs7|rsa/i.test(lower)) firmas.push('Firmware firmado');
  if (['ZIP', 'GZIP', 'BZIP2', 'XZ', '7Z', 'RAR'].includes(magic.id)) firmas.push('Comprimido');
  if (ent > 7.5 && strings.length < 20) firmas.push('Ofuscado / cifrado');

  const avisos = [];
  if (st.size === 0) avisos.push('Archivo vacío.');
  if (ent > 7.9) avisos.push('Entropía casi máxima: cifrado o comprimido; las cadenas no dirán mucho.');
  if (magic.id === 'DESCONOCIDO' && st.size > 1024) avisos.push('Firma desconocida: podría ser un volcado crudo de partición.');
  if (ext && magic.id !== 'DESCONOCIDO' && !['.bin', '.img', '.elf', '.mbn'].includes(ext)) avisos.push(`La extensión ${ext} no coincide con el contenido (${magic.id}).`);
  if (found.length) avisos.push(`Nombres de partición en la cabecera: ${found.slice(0, 12).join(', ')}.`);

  return {
    file, name: path.basename(file), dir: path.dirname(file), size: st.size, at: st.mtimeMs,
    magic, entropy: Number(ent.toFixed(3)), sha256, md5,
    strings, particiones: found, firmas, avisos,
    tipoProbable: avisos.length ? 'Revisar' : 'Normal'
  };
}

/** Guarda una copia del archivo en NexoData/binarios para conservar la evidencia. */
export function keep(file) {
  const d = dir('binarios');
  fs.mkdirSync(d, { recursive: true });
  const dest = path.join(d, `${Date.now()}-${path.basename(file)}`);
  fs.copyFileSync(file, dest);
  return dest;
}

export function listKept() {
  const d = dir('binarios');
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).map((f) => {
    const p = path.join(d, f);
    const s = fs.statSync(p);
    return { name: f, path: p, size: s.size, at: s.mtimeMs };
  }).sort((a, b) => b.at - a.at);
}
