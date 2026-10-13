// Voz: transcripción (whisper.cpp local, OpenAI, Groq) y síntesis (Piper local, OpenAI, ElevenLabs).
// La voz del sistema (SAPI/Web Speech) se gestiona en la interfaz.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { getRuntimes, whisperModelPath, piperVoicePath } from './runtimes.js';
import { getProvider, listProviders } from './providers.js';
import { freePort, sleep, uid } from './util.js';
import { dir } from './paths.js';
import { killTree } from './llama.js';

let whisper = null; // { proc, port, model }

async function ensureWhisper(modelId, threads) {
  const rt = getRuntimes().whisper.installed;
  if (!rt) throw new Error('El motor de voz local (whisper.cpp) no está instalado. Instálalo en Ajustes → Voz.');
  const m = whisperModelPath(modelId);
  if (!fs.existsSync(m.path)) throw new Error(`Falta el modelo de voz ${m.id}. Descárgalo en Ajustes → Voz.`);
  if (whisper && whisper.model === m.path && whisper.proc.exitCode === null) return whisper;
  if (whisper) { await killTree(whisper.proc); whisper = null; }
  const port = await freePort(39150);
  const args = ['-m', m.path, '--host', '127.0.0.1', '--port', String(port), '-t', String(threads || 4)];
  const proc = spawn(rt.serverPath, args, { cwd: path.dirname(rt.serverPath), windowsHide: true });
  const logs = [];
  proc.stderr.on('data', (d) => { logs.push(d.toString()); if (logs.length > 50) logs.shift(); });
  proc.stdout.on('data', (d) => { logs.push(d.toString()); if (logs.length > 50) logs.shift(); });
  const t = Date.now();
  while (Date.now() - t < 60000) {
    if (proc.exitCode !== null) throw new Error('whisper-server se cerró: ' + logs.slice(-3).join(' '));
    try { const r = await fetch(`http://127.0.0.1:${port}/`); if (r.status < 500) break; } catch { }
    await sleep(300);
  }
  whisper = { proc, port, model: m.path };
  return whisper;
}

export async function stopWhisper() { if (whisper) { await killTree(whisper.proc); whisper = null; } }

function findKey(type) {
  const p = listProviders({ withKeys: true }).find((x) => x.type === type && x.apiKey);
  return p ? getProvider(p.id) : null;
}

/** wav: Buffer (WAV PCM 16 kHz mono) */
export async function transcribe(wav, { engine = 'whisper-local', model = 'small-q5_1', language = 'es', threads, prompt } = {}) {
  const blob = new Blob([wav], { type: 'audio/wav' });
  if (engine === 'whisper-local') {
    const w = await ensureWhisper(model, threads);
    const fd = new FormData();
    fd.append('file', blob, 'audio.wav');
    fd.append('response_format', 'json');
    fd.append('temperature', '0.0');
    if (language && language !== 'auto') fd.append('language', language);
    if (prompt) fd.append('prompt', prompt);
    const r = await fetch(`http://127.0.0.1:${w.port}/inference`, { method: 'POST', body: fd });
    if (!r.ok) throw new Error('Error de transcripción local: ' + r.status);
    const j = await r.json();
    return cleanTranscript(j.text || '');
  }
  const cfg = engine === 'groq'
    ? { p: findKey('groq'), url: 'https://api.groq.com/openai/v1/audio/transcriptions', model: 'whisper-large-v3-turbo' }
    : { p: findKey('openai'), url: 'https://api.openai.com/v1/audio/transcriptions', model: 'gpt-4o-mini-transcribe' };
  if (!cfg.p) throw new Error(`Configura una clave de ${engine === 'groq' ? 'Groq' : 'OpenAI'} en Ajustes → Proveedores para usar esta transcripción.`);
  const fd = new FormData();
  fd.append('file', blob, 'audio.wav');
  fd.append('model', cfg.model);
  if (language && language !== 'auto') fd.append('language', language);
  const r = await fetch(cfg.url, { method: 'POST', headers: { Authorization: `Bearer ${cfg.p.apiKey}` }, body: fd });
  if (!r.ok) throw new Error(`Error de transcripción (${r.status}): ${(await r.text()).slice(0, 200)}`);
  return cleanTranscript((await r.json()).text || '');
}

function cleanTranscript(t) {
  return t.replace(/\[(BLANK_AUDIO|MÚSICA|Música|música|MUSIC|Music|silencio|SILENCIO)\]/g, '').replace(/\(\s*(música|music|silencio)\s*\)/gi, '').replace(/\s+/g, ' ').trim();
}

/** Devuelve { data: base64, mime } */
export async function synthesize(text, { engine = 'piper', voice, speed = 1, openaiVoice = 'alloy', elevenVoice } = {}) {
  const clean = String(text).replace(/```[\s\S]*?```/g, ' (código omitido) ').replace(/[*_#>`~|]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/https?:\/\/\S+/g, 'enlace').trim();
  if (!clean) throw new Error('Texto vacío');
  if (engine === 'piper') {
    const rt = getRuntimes().piper.installed;
    if (!rt) throw new Error('Piper no está instalado (Ajustes → Voz).');
    const v = piperVoicePath(voice || 'es_ES-davefx-medium');
    if (!fs.existsSync(v.onnx)) throw new Error('Voz Piper no descargada: ' + voice);
    const out = path.join(dir('tmp'), `tts-${uid()}.wav`);
    await new Promise((resolve, reject) => {
      const p = spawn(rt.bin, ['--model', v.onnx, '--config', v.json, '--output_file', out, '--length_scale', String(1 / (speed || 1))], { cwd: path.dirname(rt.bin), windowsHide: true });
      let err = '';
      p.stderr.on('data', (d) => { err += d.toString(); });
      p.on('close', (code) => code === 0 ? resolve() : reject(new Error('Piper falló: ' + err.slice(-300))));
      p.on('error', reject);
      p.stdin.write(clean.replace(/\n+/g, ' ') + '\n');
      p.stdin.end();
    });
    const data = fs.readFileSync(out).toString('base64');
    fs.unlink(out, () => { });
    return { data, mime: 'audio/wav' };
  }
  if (engine === 'openai') {
    const p = findKey('openai');
    if (!p) throw new Error('Configura tu clave de OpenAI para usar su voz.');
    const r = await fetch('https://api.openai.com/v1/audio/speech', { method: 'POST', headers: { Authorization: `Bearer ${p.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: openaiVoice, input: clean, speed, response_format: 'mp3' }) });
    if (!r.ok) throw new Error(`TTS OpenAI ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return { data: Buffer.from(await r.arrayBuffer()).toString('base64'), mime: 'audio/mpeg' };
  }
  if (engine === 'elevenlabs') {
    const key = elevenKey;
    if (!key) throw new Error('Configura tu clave de ElevenLabs en Ajustes → Voz.');
    const vid = elevenVoice || 'JBFqnCBsd6RMkjVDRZzb';
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vid}?output_format=mp3_44100_128`, { method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: clean, model_id: 'eleven_multilingual_v2' }) });
    if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return { data: Buffer.from(await r.arrayBuffer()).toString('base64'), mime: 'audio/mpeg' };
  }
  throw new Error('Motor de voz desconocido: ' + engine);
}

let elevenKey = '';
export function setElevenKey(k) { elevenKey = k || ''; }
