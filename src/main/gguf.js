// Lector de cabeceras GGUF (local o remoto via HTTP Range) — extrae la arquitectura
// necesaria para estimar VRAM/RAM, KV cache, offload por capas y MoE con precisión.
import fs from 'node:fs';

const T = { U8: 0, I8: 1, U16: 2, I16: 3, U32: 4, I32: 5, F32: 6, BOOL: 7, STRING: 8, ARRAY: 9, U64: 10, I64: 11, F64: 12 };
const SCALAR_SIZE = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };
const FILE_TYPES = {
  0: 'F32', 1: 'F16', 2: 'Q4_0', 3: 'Q4_1', 7: 'Q8_0', 8: 'Q5_0', 9: 'Q5_1', 10: 'Q2_K', 11: 'Q3_K_S', 12: 'Q3_K_M',
  13: 'Q3_K_L', 14: 'Q4_K_S', 15: 'Q4_K_M', 16: 'Q5_K_S', 17: 'Q5_K_M', 18: 'Q6_K', 19: 'IQ2_XXS', 20: 'IQ2_XS',
  21: 'Q2_K_S', 22: 'IQ3_XS', 23: 'IQ3_XXS', 24: 'IQ1_S', 25: 'IQ4_NL', 26: 'IQ3_S', 27: 'IQ3_M', 28: 'IQ2_S',
  29: 'IQ2_M', 30: 'IQ4_XS', 31: 'IQ1_M', 32: 'BF16', 36: 'TQ1_0', 37: 'TQ2_0', 38: 'MXFP4'
};

class ByteSource {
  constructor(readFn, totalSize) { this.readFn = readFn; this.buf = Buffer.alloc(0); this.base = 0; this.total = totalSize; this.chunk = 1 << 20; }
  async ensure(pos, n) {
    const need = pos + n;
    if (need <= this.base + this.buf.length) return;
    let end = Math.max(need, this.base + this.buf.length + this.chunk);
    if (this.total) end = Math.min(end, this.total);
    const start = this.base + this.buf.length;
    if (end <= start) throw new Error('GGUF: fin de archivo inesperado');
    const more = await this.readFn(start, end - start);
    if (!more.length) throw new Error('GGUF: lectura vacía');
    this.buf = Buffer.concat([this.buf, more]);
    this.chunk = Math.min(this.chunk * 2, 16 << 20);
  }
}

class Reader {
  constructor(src) { this.src = src; this.pos = 0; }
  async bytes(n) { await this.src.ensure(this.pos, n); const o = this.pos - this.src.base; const b = this.src.buf.subarray(o, o + n); this.pos += n; return b; }
  async u32() { return (await this.bytes(4)).readUInt32LE(0); }
  async u64() { return Number((await this.bytes(8)).readBigUInt64LE(0)); }
  async str() { const len = await this.u64(); if (len > 1e8) throw new Error('GGUF: cadena inválida'); return (await this.bytes(len)).toString('utf8'); }
  async skip(n) { await this.src.ensure(this.pos, n); this.pos += n; }
  async scalar(type) {
    const b = await this.bytes(SCALAR_SIZE[type]);
    switch (type) {
      case T.U8: return b.readUInt8(0); case T.I8: return b.readInt8(0);
      case T.U16: return b.readUInt16LE(0); case T.I16: return b.readInt16LE(0);
      case T.U32: return b.readUInt32LE(0); case T.I32: return b.readInt32LE(0);
      case T.F32: return b.readFloatLE(0); case T.BOOL: return b.readUInt8(0) !== 0;
      case T.U64: return Number(b.readBigUInt64LE(0)); case T.I64: return Number(b.readBigInt64LE(0));
      case T.F64: return b.readDoubleLE(0);
      default: throw new Error('GGUF: tipo desconocido ' + type);
    }
  }
}

async function parse(src, totalSize) {
  const r = new Reader(src);
  const magic = (await r.bytes(4)).toString('ascii');
  if (magic !== 'GGUF') throw new Error('No es un archivo GGUF');
  const version = await r.u32();
  if (version < 2) throw new Error('GGUF v1 no soportado');
  const tensorCount = await r.u64();
  const kvCount = await r.u64();
  const kv = {};
  for (let i = 0; i < kvCount; i++) {
    const key = await r.str();
    const type = await r.u32();
    if (type === T.ARRAY) {
      const et = await r.u32();
      const count = await r.u64();
      if (et === T.STRING) {
        const keep = count <= 64;
        const vals = [];
        for (let j = 0; j < count; j++) { const s = await r.str(); if (keep) vals.push(s); }
        kv[key] = keep ? vals : { arrayCount: count };
      } else if (SCALAR_SIZE[et]) {
        if (count <= 512) { const vals = []; for (let j = 0; j < count; j++) vals.push(await r.scalar(et)); kv[key] = vals; }
        else { await r.skip(count * SCALAR_SIZE[et]); kv[key] = { arrayCount: count }; }
      } else throw new Error('GGUF: array anidado no soportado');
    } else if (type === T.STRING) {
      const s = await r.str();
      kv[key] = key === 'tokenizer.chat_template' ? s.slice(0, 20000) : s;
    } else kv[key] = await r.scalar(type);
  }
  const tensors = [];
  for (let i = 0; i < tensorCount; i++) {
    const name = await r.str();
    const nd = await r.u32();
    const dims = [];
    for (let d = 0; d < nd; d++) dims.push(await r.u64());
    const ttype = await r.u32();
    const offset = await r.u64();
    tensors.push({ name, dims, type: ttype, offset });
  }
  const align = kv['general.alignment'] || 32;
  const dataStart = Math.ceil(r.pos / align) * align;
  return { version, kv, tensors, dataStart, totalSize };
}

export function summarize({ kv, tensors, dataStart, totalSize }, extra = {}) {
  const arch = kv['general.architecture'] || 'unknown';
  const g = (k) => kv[`${arch}.${k}`];
  const num = (v) => Array.isArray(v) ? v : (typeof v === 'number' ? v : undefined);
  const layers = g('block_count') || 0;
  const embd = g('embedding_length') || 0;
  const nHeadsRaw = num(g('attention.head_count'));
  const nKvRaw = num(g('attention.head_count_kv'));
  const nHeads = Array.isArray(nHeadsRaw) ? Math.max(...nHeadsRaw) : (nHeadsRaw || 0);
  let nKvHeads = Array.isArray(nKvRaw) ? Math.max(...nKvRaw) : (nKvRaw || nHeads);
  const headDim = nHeads ? Math.round(embd / nHeads) : 128;
  let keyLength = g('attention.key_length') || headDim;
  let valueLength = g('attention.value_length') || headDim;
  const kvLoraRank = g('attention.kv_lora_rank');
  const ropeDim = g('rope.dimension_count') || 64;

  // tamaños reales por tensor a partir de offsets
  const sorted = [...tensors].sort((a, b) => a.offset - b.offset);
  const firstFileDataSize = (extra.firstFileSize || totalSize || 0) - dataStart;
  let tokenEmbd = 0, output = 0, expert = 0, layerTotal = 0, other = 0, paramCount = 0;
  const attnLayerSet = new Set(); const ssmLayerSet = new Set(); const layerSet = new Set();
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i];
    const next = sorted[i + 1];
    const size = next ? next.offset - t.offset : Math.max(0, firstFileDataSize - t.offset);
    paramCount += t.dims.reduce((a, b) => a * b, 1);
    const m = /^blk\.(\d+)\./.exec(t.name);
    if (m) {
      layerSet.add(+m[1]);
      layerTotal += size;
      if (/_exps\b|_exps\./.test(t.name) || /ffn_(gate|up|down|gate_up)_exps/.test(t.name)) expert += size;
      if (/\.attn_(k|qkv|k_b|kv_a_mqa)\./.test(t.name)) attnLayerSet.add(+m[1]);
      if (/\.(ssm_|time_mix_|shortconv)/.test(t.name)) ssmLayerSet.add(+m[1]);
    } else if (t.name.startsWith('token_embd')) tokenEmbd += size;
    else if (t.name.startsWith('output')) output += size;
    else other += size;
  }
  for (const l of ssmLayerSet) attnLayerSet.delete(l);
  let attnLayers = attnLayerSet.size || layers;
  if (layers && layerSet.size && layerSet.size < layers && attnLayerSet.size) {
    attnLayers = Math.round(attnLayerSet.size * layers / layerSet.size); // GGUF dividido: solo vimos el primer fragmento
  }
  if (Array.isArray(nKvRaw)) attnLayers = nKvRaw.filter((x) => x > 0).length || attnLayers;
  const fai = g('full_attention_interval');
  if (fai && attnLayerSet.size === 0) attnLayers = Math.ceil(layers / fai);

  // sliding window
  const swaWindow = g('attention.sliding_window') || 0;
  let swaLayers = 0;
  const swaPattern = g('attention.sliding_window_pattern');
  if (swaWindow) {
    if (Array.isArray(swaPattern)) swaLayers = swaPattern.filter(Boolean).length;
    else if (/gemma/.test(arch)) swaLayers = Math.round(attnLayers * 5 / 6);
    else if (/gpt-?oss/.test(arch)) swaLayers = Math.round(attnLayers / 2);
    else swaLayers = Math.round(attnLayers / 2);
  }

  // MLA (DeepSeek/Kimi/GLM-moe): la caché guarda el vector latente comprimido
  let kvElemsPerLayerToken = nKvHeads * (keyLength + valueLength);
  if (kvLoraRank) kvElemsPerLayerToken = kvLoraRank + ropeDim;

  const vocabArr = kv['tokenizer.ggml.tokens'];
  const vocab = vocabArr ? (Array.isArray(vocabArr) ? vocabArr.length : vocabArr.arrayCount) : (g('vocab_size') || 32000);
  const expertCount = g('expert_count') || 0;
  const expertUsed = g('expert_used_count') || 0;
  const fileSize = extra.fileSize || totalSize || 0;
  const splitCount = kv['split.count'] || 1;
  const scale = splitCount > 1 && firstFileDataSize > 0 ? (fileSize - dataStart) / Math.max(1, tokenEmbd + output + layerTotal + other) : 1;

  return {
    arch,
    name: kv['general.name'] || '',
    params: kv['general.parameter_count'] || paramCount,
    ctxTrain: g('context_length') || 4096,
    layers: layers || layerSet.size,
    embd, nHeads, nKvHeads, keyLength, valueLength,
    kvElemsPerLayerToken, attnLayers, swaWindow, swaLayers,
    expertCount, expertUsed, vocab,
    fileSize,
    fileType: FILE_TYPES[kv['general.file_type']] || null,
    bytes: {
      tokenEmbd: Math.round(tokenEmbd * scale), output: Math.round(output * scale),
      expert: Math.round(expert * scale), layers: Math.round(layerTotal * scale), other: Math.round(other * scale)
    },
    hasChatTemplate: !!kv['tokenizer.chat_template'],
    toolsInTemplate: /tool/i.test(kv['tokenizer.chat_template'] || ''),
    reasoningInTemplate: /think|reasoning/i.test(kv['tokenizer.chat_template'] || ''),
    splitCount,
    isMmproj: arch === 'clip' || !!kv['clip.has_vision_encoder']
  };
}

export async function readLocalGGUF(filePath) {
  const st = fs.statSync(filePath);
  const fd = fs.openSync(filePath, 'r');
  try {
    const src = new ByteSource(async (start, len) => {
      const b = Buffer.alloc(len); const n = fs.readSync(fd, b, 0, len, start); return b.subarray(0, n);
    }, st.size);
    const parsed = await parse(src, st.size);
    let fileSize = st.size;
    const split = /-(\d{5})-of-(\d{5})\.gguf$/i.exec(filePath);
    if (split) {
      fileSize = 0;
      const total = +split[2];
      for (let i = 1; i <= total; i++) {
        const p = filePath.replace(/-(\d{5})-of-(\d{5})\.gguf$/i, `-${String(i).padStart(5, '0')}-of-${split[2]}.gguf`);
        try { fileSize += fs.statSync(p).size; } catch { }
      }
    }
    return summarize(parsed, { fileSize, firstFileSize: st.size });
  } finally { fs.closeSync(fd); }
}

export async function readRemoteGGUF(url, { headers = {}, fileSize, signal } = {}) {
  let total = 0;
  const src = new ByteSource(async (start, len) => {
    const res = await fetch(url, { headers: { ...headers, Range: `bytes=${start}-${start + len - 1}` }, redirect: 'follow', signal });
    if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status} leyendo cabecera GGUF`);
    const cr = res.headers.get('content-range');
    if (cr && !total) { const m = /\/(\d+)$/.exec(cr); if (m) { total = +m[1]; src.total = total; } }
    const ab = await res.arrayBuffer();
    if (res.status === 200) return Buffer.from(ab).subarray(start, start + len);
    return Buffer.from(ab);
  }, 0);
  src.chunk = 2 << 20;
  const parsed = await parse(src, 0);
  parsed.totalSize = total;
  return summarize(parsed, { fileSize: fileSize || total, firstFileSize: total });
}
