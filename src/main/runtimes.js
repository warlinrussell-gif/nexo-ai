// Motores locales: llama.cpp (LLM), whisper.cpp (voz a texto) y Piper (texto a voz).
// Se descargan automáticamente la versión y el backend adecuados al hardware.
import fs from 'node:fs';
import path from 'node:path';
import extractZip from 'extract-zip';
import * as tar from 'tar';
import { dir } from './paths.js';
import { load, save } from './store.js';
import { downloads } from './downloads.js';
import { isWin, isMac, findFile, rmrf } from './util.js';

const GH = 'https://api.github.com/repos';
const EXE = isWin ? '.exe' : '';

export const LLAMA_BACKENDS = {
  cuda13: { label: 'NVIDIA CUDA 13 (drivers 580+)', gpu: 'nvidia' },
  cuda12: { label: 'NVIDIA CUDA 12 (máxima compatibilidad)', gpu: 'nvidia' },
  vulkan: { label: 'Vulkan (AMD, Intel, NVIDIA)', gpu: 'any' },
  rocm: { label: 'AMD ROCm/HIP', gpu: 'amd' },
  sycl: { label: 'Intel SYCL (Arc)', gpu: 'intel' },
  metal: { label: 'Apple Metal', gpu: 'apple' },
  cpu: { label: 'Solo CPU', gpu: 'none' }
};

function assetPatterns(backend) {
  if (isWin) {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    return {
      cpu: [new RegExp(`^llama-b\\d+-bin-win-cpu-${arch}\\.zip$`)],
      cuda12: [/^llama-b\d+-bin-win-cuda-12\.[\d.]+-x64\.zip$/, /^cudart-llama-bin-win-cuda-12\.[\d.]+-x64\.zip$/],
      cuda13: [/^llama-b\d+-bin-win-cuda-13\.[\d.]+-x64\.zip$/, /^cudart-llama-bin-win-cuda-13\.[\d.]+-x64\.zip$/],
      vulkan: [/^llama-b\d+-bin-win-vulkan-x64\.zip$/],
      rocm: [/^llama-b\d+-bin-win-(rocm|hip)[-\w.]*-x64\.zip$/],
      sycl: [/^llama-b\d+-bin-win-sycl-x64\.zip$/]
    }[backend];
  }
  if (isMac) return [process.arch === 'arm64' ? /^llama-b\d+-bin-macos-arm64\.(tar\.gz|zip)$/ : /^llama-b\d+-bin-macos-x64\.(tar\.gz|zip)$/];
  return {
    cpu: [/^llama-b\d+-bin-ubuntu-x64\.(tar\.gz|zip)$/],
    vulkan: [/^llama-b\d+-bin-ubuntu-vulkan-x64\.(tar\.gz|zip)$/],
    cuda12: [/^llama-b\d+-bin-ubuntu-cuda-12\.[\d.]+-x64\.(tar\.gz|zip)$/, /^cudart-llama-b\d+-bin-ubuntu-cuda-12\.[\d.]+-x64\.(tar\.gz|zip)$/],
    cuda13: [/^llama-b\d+-bin-ubuntu-cuda-13\.[\d.]+-x64\.(tar\.gz|zip)$/, /^cudart-llama-b\d+-bin-ubuntu-cuda-13\.[\d.]+-x64\.(tar\.gz|zip)$/],
    rocm: [/^llama-b\d+-bin-ubuntu-rocm[-\w.]*-x64\.(tar\.gz|zip)$/],
    sycl: [/^llama-b\d+-bin-ubuntu-sycl-fp16-x64\.(tar\.gz|zip)$/]
  }[backend];
}

async function ghReleases(repo) {
  const res = await fetch(`${GH}/${repo}/releases?per_page=12`, { headers: { 'User-Agent': 'NexoAI', Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub respondió ${res.status}${res.status === 403 ? ' (límite de peticiones, reintenta en unos minutos)' : ''}`);
  return res.json();
}

async function findRelease(repo, patterns) {
  const rels = await ghReleases(repo);
  for (const r of rels) {
    const assets = patterns.map((p) => r.assets.find((a) => p.test(a.name)));
    if (assets[0]) return { tag: r.tag_name, assets: assets.filter(Boolean) };
  }
  throw new Error('No se encontró una versión compatible para tu sistema');
}

export async function extractArchive(file, dest) {
  fs.mkdirSync(dest, { recursive: true });
  if (/\.zip$/i.test(file)) await extractZip(file, { dir: path.resolve(dest) });
  else await tar.x({ file, cwd: dest });
  if (!isWin) {
    // asegurar permisos de ejecución
    const stack = [dest];
    while (stack.length) {
      const d = stack.pop();
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) stack.push(p);
        else if (!/\.(json|txt|md|onnx|bin|gguf)$/i.test(e.name)) { try { fs.chmodSync(p, 0o755); } catch { } }
      }
    }
  }
}

function state() { return load('runtimes', { llama: { active: null, installed: [], customPath: '' }, whisper: { installed: null }, piper: { installed: null } }); }
function persist() { save('runtimes', state(), true); }

export function getRuntimes() {
  const s = state();
  // limpiar entradas cuyos archivos ya no existen
  s.llama.installed = s.llama.installed.filter((r) => fs.existsSync(r.serverPath));
  if (s.llama.active && !s.llama.installed.find((r) => r.id === s.llama.active)) s.llama.active = s.llama.installed[0]?.id || null;
  if (s.whisper.installed && !fs.existsSync(s.whisper.installed.serverPath)) s.whisper.installed = null;
  if (s.piper.installed && !fs.existsSync(s.piper.installed.bin)) s.piper.installed = null;
  return s;
}

export function activeLlama() {
  const s = getRuntimes();
  if (s.llama.customPath && fs.existsSync(s.llama.customPath)) return { id: 'custom', backend: 'custom', serverPath: s.llama.customPath, tag: 'personalizado' };
  return s.llama.installed.find((r) => r.id === s.llama.active) || null;
}

export function setActiveLlama(id) { const s = getRuntimes(); s.llama.active = id; persist(); }
export function setCustomLlama(p) { const s = getRuntimes(); s.llama.customPath = p || ''; persist(); }

export function removeLlama(id) {
  const s = getRuntimes();
  const r = s.llama.installed.find((x) => x.id === id);
  if (r) rmrf(r.dir);
  s.llama.installed = s.llama.installed.filter((x) => x.id !== id);
  if (s.llama.active === id) s.llama.active = s.llama.installed[0]?.id || null;
  persist();
}

export async function installLlama(backend) {
  if (isMac) backend = 'metal';
  const patterns = isMac ? assetPatterns() : assetPatterns(backend);
  if (!patterns) throw new Error('Backend no disponible en este sistema: ' + backend);
  const rel = await findRelease('ggml-org/llama.cpp', patterns);
  const id = `${backend}-${rel.tag}`;
  const target = dir('runtimes', 'llama', id);
  const tmpDir = dir('tmp');
  const files = rel.assets.map((a) => ({ url: a.browser_download_url, dest: path.join(tmpDir, a.name), size: a.size }));
  return downloads.add({
    label: `Motor llama.cpp ${rel.tag} · ${LLAMA_BACKENDS[backend]?.label || backend}`,
    kind: 'runtime', files, meta: { runtime: 'llama', backend, tag: rel.tag },
    onDone: async () => {
      rmrf(target);
      for (const f of files) { await extractArchive(f.dest, target); try { fs.unlinkSync(f.dest); } catch { } }
      const serverPath = findFile(target, (n) => n === `llama-server${EXE}`);
      if (!serverPath) throw new Error('llama-server no encontrado en el paquete');
      // En Windows las DLL de CUDA deben estar junto al ejecutable
      if (isWin && /cuda/.test(backend)) {
        const exeDir = path.dirname(serverPath);
        const stack = [target];
        while (stack.length) {
          const d = stack.pop();
          for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) stack.push(p);
            else if (/\.dll$/i.test(e.name) && path.dirname(p) !== exeDir) { try { fs.copyFileSync(p, path.join(exeDir, e.name)); } catch { } }
          }
        }
      }
      const s = getRuntimes();
      s.llama.installed = s.llama.installed.filter((x) => x.id !== id);
      s.llama.installed.push({ id, backend, tag: rel.tag, dir: target, serverPath, installedAt: Date.now() });
      s.llama.active = id;
      persist();
    }
  });
}

export async function checkLlamaUpdate() {
  const a = activeLlama();
  if (!a || a.id === 'custom') return null;
  const patterns = isMac ? assetPatterns() : assetPatterns(a.backend);
  try { const rel = await findRelease('ggml-org/llama.cpp', patterns); return rel.tag !== a.tag ? rel.tag : null; } catch { return null; }
}

// ───────────── whisper.cpp ─────────────
export const WHISPER_MODELS = [
  { id: 'tiny-q5_1', file: 'ggml-tiny-q5_1.bin', size: 32e6, label: 'Tiny (32 MB) · instantáneo, precisión básica' },
  { id: 'base-q5_1', file: 'ggml-base-q5_1.bin', size: 60e6, label: 'Base (60 MB) · muy rápido' },
  { id: 'small-q5_1', file: 'ggml-small-q5_1.bin', size: 190e6, label: 'Small (190 MB) · recomendado en CPU' },
  { id: 'medium-q5_0', file: 'ggml-medium-q5_0.bin', size: 539e6, label: 'Medium (539 MB) · muy preciso' },
  { id: 'large-v3-turbo-q5_0', file: 'ggml-large-v3-turbo-q5_0.bin', size: 574e6, label: 'Large v3 Turbo (574 MB) · el mejor (ideal con GPU)' }
];

export async function installWhisper(gpu = false) {
  let patterns;
  if (isWin) patterns = [gpu ? /^whisper-cublas-12[\d.]*-bin-x64\.zip$/ : /^whisper-bin-x64\.zip$/];
  else if (isMac) throw new Error('En macOS instala whisper.cpp con "brew install whisper-cpp" o usa la transcripción por API.');
  else patterns = [/^whisper-bin-ubuntu-x64\.(tar\.gz|zip)$/];
  const rel = await findRelease('ggml-org/whisper.cpp', patterns);
  const target = dir('runtimes', 'whisper', rel.tag + (gpu ? '-cuda' : ''));
  const a = rel.assets[0];
  const tmp = path.join(dir('tmp'), a.name);
  return downloads.add({
    label: `Motor de voz whisper.cpp ${rel.tag}${gpu ? ' (CUDA)' : ''}`, kind: 'runtime',
    files: [{ url: a.browser_download_url, dest: tmp, size: a.size }], meta: { runtime: 'whisper' },
    onDone: async () => {
      rmrf(target);
      await extractArchive(tmp, target); try { fs.unlinkSync(tmp); } catch { }
      const serverPath = findFile(target, (n) => n === `whisper-server${EXE}`);
      if (!serverPath) throw new Error('whisper-server no encontrado');
      const s = getRuntimes(); s.whisper.installed = { tag: rel.tag, dir: target, serverPath, gpu }; persist();
    }
  });
}

export function whisperModelPath(id) {
  const m = WHISPER_MODELS.find((x) => x.id === id) || WHISPER_MODELS[2];
  return { ...m, path: dir('voice', 'whisper', m.file) };
}

export function downloadWhisperModel(id) {
  const m = whisperModelPath(id);
  if (fs.existsSync(m.path)) return null;
  return downloads.add({
    label: `Modelo de voz Whisper ${m.id}`, kind: 'voice',
    files: [{ url: `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${m.file}`, dest: m.path }], meta: { voice: 'whisper', id }
  });
}

// ───────────── Piper TTS ─────────────
export const PIPER_VOICES = [
  { id: 'es_ES-davefx-medium', label: 'Español (España) · Dave · masculina' },
  { id: 'es_ES-sharvard-medium', label: 'Español (España) · Sharvard · 2 voces' },
  { id: 'es_MX-claude-high', label: 'Español (México) · Claude · alta calidad' },
  { id: 'es_MX-ald-medium', label: 'Español (México) · Ald · masculina' },
  { id: 'es_AR-daniela-high', label: 'Español (Argentina) · Daniela · femenina' },
  { id: 'en_GB-alan-medium', label: 'Inglés británico · Alan (estilo JARVIS)' },
  { id: 'en_US-ryan-high', label: 'Inglés (EE. UU.) · Ryan · alta calidad' },
  { id: 'en_US-lessac-medium', label: 'Inglés (EE. UU.) · Lessac' }
];

export async function installPiper() {
  const name = isWin ? 'piper_windows_amd64.zip' : isMac ? (process.arch === 'arm64' ? 'piper_macos_aarch64.tar.gz' : 'piper_macos_x64.tar.gz') : 'piper_linux_x86_64.tar.gz';
  const url = `https://github.com/rhasspy/piper/releases/download/2023.11.14-2/${name}`;
  const tmp = path.join(dir('tmp'), name);
  const target = dir('runtimes', 'piper');
  return downloads.add({
    label: 'Motor de voz Piper (texto a voz neural)', kind: 'runtime',
    files: [{ url, dest: tmp }], meta: { runtime: 'piper' },
    onDone: async () => {
      rmrf(target);
      await extractArchive(tmp, target); try { fs.unlinkSync(tmp); } catch { }
      const bin = findFile(target, (n) => n === `piper${EXE}`);
      if (!bin) throw new Error('piper no encontrado');
      const s = getRuntimes(); s.piper.installed = { dir: target, bin }; persist();
    }
  });
}

export function piperVoicePath(id) {
  return { onnx: dir('voice', 'piper', `${id}.onnx`), json: dir('voice', 'piper', `${id}.onnx.json`) };
}

export function downloadPiperVoice(id) {
  const [lang_region, name, quality] = id.split('-');
  const lang = lang_region.split('_')[0];
  const base = `https://huggingface.co/rhasspy/piper-voices/resolve/main/${lang}/${lang_region}/${name}/${quality}/${id}`;
  const p = piperVoicePath(id);
  if (fs.existsSync(p.onnx) && fs.existsSync(p.json)) return null;
  return downloads.add({
    label: `Voz Piper ${id}`, kind: 'voice',
    files: [{ url: `${base}.onnx`, dest: p.onnx }, { url: `${base}.onnx.json`, dest: p.json }], meta: { voice: 'piper', id }
  });
}

export function installedVoices() {
  const out = { whisper: [], piper: [] };
  for (const m of WHISPER_MODELS) if (fs.existsSync(whisperModelPath(m.id).path)) out.whisper.push(m.id);
  for (const v of PIPER_VOICES) { const p = piperVoicePath(v.id); if (fs.existsSync(p.onnx) && fs.existsSync(p.json)) out.piper.push(v.id); }
  return out;
}
