// Captura de micrófono con detección de voz (VAD), codificación WAV 16 kHz y reproducción TTS en cola.
import { call } from './api.js';

export function encodeWav16k(chunks, inputRate) {
  let len = 0;
  for (const c of chunks) len += c.length;
  const all = new Float32Array(len);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  const ratio = inputRate / 16000;
  const outLen = Math.floor(all.length / ratio);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio), end = Math.min(all.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += all[j];
    const v = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  const buf = new ArrayBuffer(44 + out.length * 2);
  const dv = new DataView(buf);
  const w = (p, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(p + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + out.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, 16000, true);
  dv.setUint32(28, 32000, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, out.length * 2, true);
  new Int16Array(buf, 44).set(out);
  return buf;
}

export function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Micrófono con VAD por energía adaptativa.
 * opts: { onLevel(0..1), onSpeechStart(), onUtterance(wavBase64, durationMs), silenceMs, threshold(0..1), vad: bool }
 */
export class Mic {
  constructor(opts = {}) { this.opts = opts; this.active = false; }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    this.ctx = new AudioContext();
    this.src = this.ctx.createMediaStreamSource(this.stream);
    this.proc = this.ctx.createScriptProcessor(2048, 1, 1);
    this.rate = this.ctx.sampleRate;
    this.noise = 0.01;
    this.speaking = false;
    this.chunks = [];
    this.preroll = [];
    this.silence = 0;
    this.speechFrames = 0;
    this.manual = [];
    this.paused = false;
    this.active = true;
    const frameMs = (2048 / this.rate) * 1000;
    this.proc.onaudioprocess = (e) => {
      if (!this.active) return;
      const data = new Float32Array(e.inputBuffer.getChannelData(0));
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      const rms = Math.sqrt(sum / data.length);
      this.opts.onLevel?.(Math.min(1, rms * 12));
      if (this.recordingManual) { this.manual.push(data); return; }
      if (!this.opts.vad || this.paused) return;
      const sens = this.opts.threshold ?? 0.5;
      const startTh = Math.max(0.012 + (1 - sens) * 0.03, this.noise * (2.2 + (1 - sens) * 2));
      const stopTh = startTh * 0.6;
      if (!this.speaking) {
        this.noise = this.noise * 0.97 + rms * 0.03;
        this.preroll.push(data);
        if (this.preroll.length > Math.ceil(350 / frameMs)) this.preroll.shift();
        if (rms > startTh) { this.speechFrames++; if (this.speechFrames >= 2) { this.speaking = true; this.chunks = [...this.preroll]; this.silence = 0; this.opts.onSpeechStart?.(); } }
        else this.speechFrames = 0;
      } else {
        this.chunks.push(data);
        if (rms < stopTh) this.silence += frameMs; else this.silence = 0;
        const dur = this.chunks.length * frameMs;
        if (this.silence >= (this.opts.silenceMs || 900) || dur > 30000) {
          this.speaking = false; this.speechFrames = 0;
          const chunks = this.chunks; this.chunks = []; this.preroll = [];
          if (dur - this.silence > 350) this.opts.onUtterance?.(toBase64(encodeWav16k(chunks, this.rate)), dur);
        }
      }
    };
    this.src.connect(this.proc);
    this.proc.connect(this.ctx.destination);
  }

  beginManual() { this.manual = []; this.recordingManual = true; }
  endManual() {
    this.recordingManual = false;
    const chunks = this.manual; this.manual = [];
    if (!chunks.length) return null;
    return toBase64(encodeWav16k(chunks, this.rate));
  }

  stop() {
    this.active = false;
    try { this.proc?.disconnect(); this.src?.disconnect(); } catch { }
    try { this.stream?.getTracks().forEach((t) => t.stop()); } catch { }
    try { this.ctx?.close(); } catch { }
  }
}

/** Reproductor de voz en cola (frases) — sistema, Piper, OpenAI o ElevenLabs. */
export class Speaker {
  constructor(getSettings) { this.getSettings = getSettings; this.queue = []; this.playing = false; this.audio = null; this.onState = null; this.gen = 0; }

  get engine() { return this.getSettings()?.voice?.tts || 'system'; }

  speak(text) {
    const clean = sanitizeForSpeech(text);
    if (!clean) return;
    this.queue.push(clean);
    if (!this.playing) this.next();
  }

  async next() {
    const gen = this.gen;
    const text = this.queue.shift();
    if (!text) { this.playing = false; this.onState?.(false); return; }
    this.playing = true; this.onState?.(true);
    try {
      if (this.engine === 'system') await this.speakSystem(text);
      else {
        const r = await call('voice.synthesize', text);
        if (gen !== this.gen) return;
        await new Promise((resolve) => {
          this.audio = new Audio(`data:${r.mime};base64,${r.data}`);
          this.audio.playbackRate = r.mime === 'audio/wav' ? 1 : (this.getSettings()?.voice?.rate || 1) > 1.3 ? 1.1 : 1;
          this.audio.onended = resolve; this.audio.onerror = resolve;
          this.audio.play().catch(resolve);
        });
      }
    } catch (e) {
      console.error('TTS', e);
      if (this.engine !== 'system') { try { await this.speakSystem(text); } catch { } }
    }
    if (gen === this.gen) this.next();
  }

  speakSystem(text) {
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      const s = this.getSettings()?.voice || {};
      const voices = speechSynthesis.getVoices();
      const v = voices.find((x) => x.name === s.systemVoice) || voices.find((x) => x.lang?.startsWith(s.language || 'es')) || voices[0];
      if (v) { u.voice = v; u.lang = v.lang; }
      u.rate = s.rate || 1;
      u.onend = resolve; u.onerror = resolve;
      speechSynthesis.speak(u);
    });
  }

  stop() {
    this.gen++;
    this.queue = [];
    try { speechSynthesis.cancel(); } catch { }
    if (this.audio) { try { this.audio.pause(); } catch { } this.audio = null; }
    this.playing = false; this.onState?.(false);
  }
}

export function sanitizeForSpeech(t) {
  return String(t || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/[*_~>|#]/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Divide texto en streaming en frases completas para hablar mientras se genera. */
export class SentenceSplitter {
  constructor(onSentence) { this.buf = ''; this.onSentence = onSentence; this.inCode = false; }
  push(delta) {
    this.buf += delta;
    let m;
    while ((m = /([\s\S]*?[.!?¡¿…:;](?:\s|$)|[\s\S]*?\n\n)/.exec(this.buf)) && m[0].length > 0) {
      const s = m[0];
      if (s.trim().length < 2) { this.buf = this.buf.slice(s.length); continue; }
      const fences = (s.match(/```/g) || []).length;
      if (fences % 2 === 1) this.inCode = !this.inCode;
      this.buf = this.buf.slice(s.length);
      if (!this.inCode) this.onSentence(s.trim());
      if (this.buf.length === 0) break;
    }
  }
  flush() { if (this.buf.trim() && !this.inCode) this.onSentence(this.buf.trim()); this.buf = ''; this.inCode = false; }
}

export function normalizeWake(s) { return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim(); }

export function matchWakeWord(transcript, wake = 'jarvis') {
  const w = normalizeWake(wake);
  const variants = new Set([w]);
  if (w === 'jarvis') ['yarvis', 'jarbis', 'harvis', 'jarvi', 'yarbis', 'charvis', 'jervis', 'garvis', 'harbis', 'jarves', 'jarviz'].forEach((v) => variants.add(v));
  if (w === 'nexo') ['nexus', 'nesso', 'nekso', 'next'].forEach((v) => variants.add(v));
  const words = String(transcript).split(/\s+/).filter(Boolean);
  const wl = w.split(' ').length;
  for (let i = 0; i < words.length; i++) {
    const cand = normalizeWake(words.slice(i, i + wl).join(' '));
    if (variants.has(cand) || [...variants].some((v) => cand.startsWith(v) && cand.length <= v.length + 2)) {
      const command = words.slice(i + wl).join(' ').replace(/^[\s,.:;!¡?¿-]+/, '').trim();
      return { matched: true, command, raw: transcript };
    }
  }
  return { matched: false };
}
