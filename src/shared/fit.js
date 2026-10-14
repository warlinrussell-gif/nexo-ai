// Estimador de memoria y velocidad compartido (main + interfaz).
// Calcula cuánto ocupa un modelo en VRAM/RAM, cuántas capas caben en GPU,
// si conviene sacar los expertos MoE a RAM y la velocidad aproximada en tokens/s.

export const GiB = 1024 ** 3;
export const MiB = 1024 ** 2;

const KV_BYTES = { f16: 2, q8_0: 1.0625, q4_0: 0.5625 };

export const QUANT_BPW = {
  IQ1_S: 1.56, IQ1_M: 1.75, TQ1_0: 1.69, IQ2_XXS: 2.06, IQ2_XS: 2.31, IQ2_S: 2.5, IQ2_M: 2.7, Q2_K: 3.0, Q2_K_S: 2.9, Q2_K_XL: 3.1,
  IQ3_XXS: 3.06, IQ3_XS: 3.3, IQ3_S: 3.44, IQ3_M: 3.66, Q3_K_S: 3.5, Q3_K_M: 3.9, Q3_K_L: 4.27, Q3_K_XL: 4.1,
  IQ4_XS: 4.25, IQ4_NL: 4.5, Q4_0: 4.55, Q4_1: 5.0, Q4_K_S: 4.6, Q4_K_M: 4.85, Q4_K_XL: 5.0, MXFP4: 4.25, MXFP4_MOE: 4.3,
  Q5_0: 5.5, Q5_1: 6.0, Q5_K_S: 5.55, Q5_K_M: 5.7, Q5_K_XL: 5.9, Q6_K: 6.6, Q6_K_XL: 7.0, Q8_0: 8.5, Q8_K_XL: 9.0,
  BF16: 16, F16: 16, F32: 32
};

export function quantFromName(name = '') {
  const n = name.toUpperCase().replace(/\.GGUF$/, '');
  const keys = Object.keys(QUANT_BPW).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (new RegExp(`(^|[-_.])(UD-)?${k.replace(/_/g, '[_-]')}($|[-_.])`).test(n)) return k;
  }
  return null;
}

/** Descarta cuantizaciones con tamaño imposible para los parámetros (p. ej. solo cuenta un trozo de un archivo dividido). */
export function plausibleQuant(q, params) {
  if (!params || !q?.size) return true;
  const expected = params * (QUANT_BPW[q.quant] || 4.8) / 8;
  return q.size >= expected * 0.6;
}

export function quantQuality(q) {
  const bpw = QUANT_BPW[q] || 4.8;
  if (bpw >= 8) return { label: 'Máxima', score: 5 };
  if (bpw >= 6) return { label: 'Excelente', score: 4.6 };
  if (bpw >= 5.4) return { label: 'Muy alta', score: 4.3 };
  if (bpw >= 4.5) return { label: 'Alta (recomendada)', score: 4 };
  if (bpw >= 3.8) return { label: 'Buena', score: 3.4 };
  if (bpw >= 3) return { label: 'Aceptable', score: 2.7 };
  return { label: 'Baja', score: 1.8 };
}

// Ancho de banda de memoria aproximado de GPUs conocidas (GB/s)
const GPU_BW = [
  [/5090/, 1792], [/5080/, 960], [/5070\s*ti/, 896], [/5070/, 672], [/5060\s*ti/, 448], [/5060/, 448], [/5050/, 320],
  [/4090/, 1008], [/4080\s*super/, 736], [/4080/, 717], [/4070\s*ti\s*super/, 672], [/4070\s*ti/, 504], [/4070\s*super/, 504], [/4070/, 504], [/4060\s*ti/, 288], [/4060/, 272], [/4050/, 192],
  [/3090\s*ti/, 1008], [/3090/, 936], [/3080\s*ti/, 912], [/3080/, 760], [/3070\s*ti/, 608], [/3070/, 448], [/3060\s*ti/, 448], [/3060/, 360], [/3050/, 224],
  [/2080\s*ti/, 616], [/2080/, 448], [/2070/, 448], [/2060/, 336], [/1660/, 300], [/1650/, 128], [/1080\s*ti/, 484], [/1080/, 320], [/1070/, 256], [/1060/, 192],
  [/titan\s*rtx/, 672], [/a6000/, 768], [/a5000/, 768], [/a4000/, 448], [/a100/, 1935], [/h100/, 3350], [/l40/, 864], [/rtx\s*pro\s*6000/, 1792],
  [/9070\s*xt/, 640], [/9070/, 640], [/9060\s*xt/, 320], [/7900\s*xtx/, 960], [/7900\s*xt/, 800], [/7900\s*gre/, 576], [/7800\s*xt/, 624], [/7700\s*xt/, 432], [/7600/, 288],
  [/6950/, 576], [/6900/, 512], [/6800\s*xt/, 512], [/6800/, 512], [/6750/, 432], [/6700/, 384], [/6650/, 280], [/6600/, 224], [/6500/, 144],
  [/radeon\s*vii/, 1024], [/5700\s*xt/, 448], [/580|590/, 256],
  [/b580/, 456], [/b570/, 380], [/a770/, 560], [/a750/, 512], [/a580/, 512], [/a380/, 186],
  [/m4\s*max/, 546], [/m4\s*pro/, 273], [/m4/, 120], [/m3\s*max/, 400], [/m3\s*pro/, 150], [/m3\s*ultra/, 819], [/m3/, 100], [/m2\s*ultra/, 800], [/m2\s*max/, 400], [/m2\s*pro/, 200], [/m2/, 100],
  [/m1\s*ultra/, 800], [/m1\s*max/, 400], [/m1\s*pro/, 200], [/m1/, 68], [/m5\s*max/, 610], [/m5\s*pro/, 307], [/m5/, 153]
];

export function gpuBandwidth(name = '', integrated = false) {
  const n = name.toLowerCase();
  for (const [re, bw] of GPU_BW) if (re.test(n)) return /laptop|mobile|max-q|\bm\b/.test(n) && !/apple|m\d/.test(n) ? Math.round(bw * 0.72) : bw;
  if (integrated) return 60;
  return 300;
}

/**
 * meta: salida de gguf.summarize() o metadatos del catálogo.
 * Si faltan datos se aproxima a partir de los parámetros y el tamaño de archivo.
 */
export function normalizeMeta(meta = {}, fileSize) {
  const size = fileSize || meta.fileSize || 0;
  const params = meta.params || (size ? size * 8 / 4.85 : 7e9);
  const layers = meta.layers || Math.max(16, Math.round(Math.sqrt(params / 1e9) * 11));
  const kvElems = meta.kvElemsPerLayerToken || 2048;
  const attnLayers = meta.attnLayers || layers;
  const b = meta.bytes || {};
  const origTotal = (b.tokenEmbd || 0) + (b.output || 0) + (b.layers || 0) + (b.other || 0);
  const k = origTotal > 0 && size ? size / origTotal : 1;
  const tokenEmbd = origTotal ? (b.tokenEmbd || 0) * k : size * 0.05;
  const output = origTotal ? (b.output || 0) * k : size * 0.03;
  const layerBytes = origTotal ? (b.layers || 0) * k : size - tokenEmbd - output;
  const expert = origTotal ? (b.expert || 0) * k : (meta.expertCount ? layerBytes * 0.9 : 0);
  return {
    ...meta, fileSize: size, params, layers, kvElems, attnLayers,
    swaWindow: meta.swaWindow || 0, swaLayers: meta.swaLayers || 0,
    tokenEmbd, output, layerBytes, expert,
    expertCount: meta.expertCount || 0, expertUsed: meta.expertUsed || 0,
    vocab: meta.vocab || 128000, embd: meta.embd || 4096
  };
}

export function kvCacheBytes(m, ctx, kvType = 'f16') {
  const bpe = KV_BYTES[kvType] || 2;
  const full = Math.max(0, m.attnLayers - m.swaLayers);
  const swaTokens = m.swaWindow ? Math.min(ctx, m.swaWindow + 512) : ctx;
  return (full * ctx + m.swaLayers * swaTokens) * m.kvElems * bpe;
}

export function computeBufferBytes(m, ctx) {
  const ubatch = 512;
  return ubatch * m.vocab * 4 + ubatch * m.embd * 4 * 12 + Math.min(ctx, 32768) * 1024 + 96 * MiB;
}

/** Bytes leídos por token generado (determina la velocidad). */
export function activeBytes(m) {
  const base = m.fileSize - m.tokenEmbd;
  if (m.expertCount && m.expertUsed && m.expert) {
    return base - m.expert + m.expert * (m.expertUsed / m.expertCount);
  }
  return base;
}

/**
 * Plan de carga para un modelo dado el presupuesto disponible.
 * budget: { vram, ram, gpuBW, cpuBW, hasGpu }
 * opts: { ctx, kvType, mmprojSize, forceCpu, gpuLayers }
 */
export function planModel(metaIn, budget, opts = {}) {
  const m = normalizeMeta(metaIn, opts.fileSize);
  const ctx = opts.ctx || 8192;
  const kv = kvCacheBytes(m, ctx, opts.kvType);
  const kvPerLayer = kv / Math.max(1, m.attnLayers);
  const compute = computeBufferBytes(m, ctx);
  const mmproj = opts.mmprojSize || 0;
  const perLayer = m.layerBytes / Math.max(1, m.layers);
  const act = activeBytes(m);
  const vram = budget.hasGpu && !opts.forceCpu ? Math.max(0, budget.vram) : 0;
  const ram = Math.max(0, budget.ram);
  const gpuBW = (budget.gpuBW || 300) * 1e9 * 0.6;
  const cpuBW = (budget.cpuBW || 50) * 1e9 * 0.5;
  const overhead = m.layers * 0.00011 + 0.0015; // lanzamiento de kernels, sincronización, muestreo
  const totalNeed = m.fileSize + kv + compute + mmproj;

  const result = (mode, gpuLayers, gpuBytes, cpuBytes, gpuActive, cpuActive, extra = {}) => {
    const t = gpuActive / gpuBW + cpuActive / cpuBW + overhead + (mode === 'partial' || mode === 'moe' ? m.layers * 0.00005 : 0);
    const tps = t > 0 ? 1 / t : 0;
    const fits = cpuBytes <= ram && gpuBytes <= vram + 1;
    let rating;
    if (!fits) rating = 'nofit';
    else if (tps >= 18 && (mode === 'gpu' || mode === 'moe')) rating = 'fluido';
    else if (tps >= 14) rating = 'fluido';
    else if (tps >= 6) rating = 'bueno';
    else if (tps >= 2) rating = 'lento';
    else rating = 'muylento';
    return {
      mode, gpuLayers, totalLayers: m.layers, gpuBytes: Math.round(gpuBytes), cpuBytes: Math.round(cpuBytes),
      kvBytes: Math.round(kv), computeBytes: Math.round(compute), totalBytes: Math.round(totalNeed),
      tps: Math.round(tps * 10) / 10, rating, fits, ctx, ...extra
    };
  };

  // 1) Todo en GPU
  const fullGpu = m.fileSize - m.tokenEmbd + kv + compute + mmproj;
  if (vram > 0 && fullGpu <= vram) {
    return result('gpu', m.layers + 1, fullGpu, m.tokenEmbd + 200 * MiB, act, 0);
  }
  if (vram > 0 && !(opts.gpuLayers >= 0 && opts.gpuLayers !== undefined)) {
    // 2) MoE: atención + partes compartidas en GPU, expertos (parcialmente) en RAM
    if (m.expertCount && m.expert > 0) {
      const shared = m.fileSize - m.tokenEmbd - m.expert + kv + compute + mmproj;
      if (shared <= vram) {
        const expPerLayer = m.expert / m.layers;
        const expOnGpuLayers = Math.max(0, Math.min(m.layers, Math.floor((vram - shared) / expPerLayer)));
        const cpuMoeLayers = m.layers - expOnGpuLayers;
        const expCpu = cpuMoeLayers * expPerLayer;
        const frac = m.expertUsed / m.expertCount;
        const gpuActive = (m.fileSize - m.tokenEmbd - m.expert) + expOnGpuLayers * expPerLayer * frac;
        const cpuActive = expCpu * frac;
        return result('moe', m.layers + 1, shared + expOnGpuLayers * expPerLayer, expCpu + m.tokenEmbd + 300 * MiB, gpuActive, cpuActive, { cpuMoeLayers });
      }
    }
    // 3) Offload parcial por capas
    const fixed = compute + m.output + mmproj;
    const ngl = Math.max(0, Math.min(m.layers, Math.floor((vram - fixed) / (perLayer + kvPerLayer))));
    if (ngl > 0) {
      const gpuBytes = fixed + ngl * (perLayer + kvPerLayer);
      const cpuLayers = m.layers - ngl;
      const cpuBytes = cpuLayers * (perLayer + kvPerLayer) + m.tokenEmbd + 300 * MiB;
      const ratio = ngl / m.layers;
      return result('partial', ngl, gpuBytes, cpuBytes, act * ratio, act * (1 - ratio));
    }
  }
  if (opts.gpuLayers >= 0 && opts.gpuLayers !== undefined && vram > 0) {
    const ngl = Math.min(m.layers, opts.gpuLayers);
    const ratio = ngl / m.layers;
    const gpuBytes = compute + ngl * (perLayer + kvPerLayer) + mmproj;
    const cpuBytes = (m.layers - ngl) * (perLayer + kvPerLayer) + m.tokenEmbd + 300 * MiB;
    return result(ngl ? 'partial' : 'cpu', ngl, gpuBytes, cpuBytes, act * ratio, act * (1 - ratio));
  }
  // 4) Solo CPU / RAM
  return result('cpu', 0, 0, totalNeed + 200 * MiB, 0, act);
}

/**
 * Recomienda el contexto (y tipo de KV caché) para un modelo según la memoria disponible.
 * Busca el mayor contexto que deja el modelo 100% en GPU (lo más rápido), hasta `cap`.
 * Devuelve { ctx, kvType, plan, reason, options } — options = tabla para mostrar al usuario.
 */
export function recommendContext(meta, budget, opts = {}) {
  const m = normalizeMeta(meta, opts.fileSize);
  const train = meta?.ctxTrain || 32768;
  const cap = Math.min(train, opts.cap || Infinity);
  const sizes = [2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144].filter((c) => c <= Math.max(train, 4096));
  const base = { fileSize: opts.fileSize, mmprojSize: opts.mmprojSize };
  const options = sizes.map((ctx) => ({
    ctx,
    f16: planModel(meta, budget, { ...base, ctx, kvType: 'f16' }),
    q8_0: planModel(meta, budget, { ...base, ctx, kvType: 'q8_0' })
  }));
  const usable = options.filter((o) => o.ctx <= cap);
  const best = (kv, test) => usable.filter((o) => test(o[kv])).pop();
  const gpuF16 = best('f16', (p) => p.fits && p.mode === 'gpu');
  const gpuQ8 = best('q8_0', (p) => p.fits && p.mode === 'gpu');
  let pick;
  // El máximo que el modelo soporta quedándose 100% en GPU; Q8_0 solo si permite más contexto
  if (gpuQ8 && (!gpuF16 || gpuQ8.ctx > gpuF16.ctx)) pick = { ctx: gpuQ8.ctx, kvType: 'q8_0', plan: gpuQ8.q8_0, reason: `Con la caché en Q8_0 cabe entero en la GPU con ${gpuQ8.ctx.toLocaleString('es-ES')} tokens (pérdida de calidad mínima).` };
  else if (gpuF16) pick = { ctx: gpuF16.ctx, kvType: 'f16', plan: gpuF16.f16, reason: `Máximo que cabe entero en la GPU: ${gpuF16.ctx.toLocaleString('es-ES')} tokens${gpuF16.ctx >= train ? ' (el máximo del modelo)' : ''}.` };
  else {
    // No cabe entero en GPU: contexto moderado y caché comprimida para no robar capas a la GPU
    const o = usable.find((x) => x.ctx === 8192) || usable[usable.length - 1] || options[0];
    const p = o.q8_0.fits ? o.q8_0 : o.f16;
    pick = { ctx: o.ctx, kvType: p === o.q8_0 ? 'q8_0' : 'f16', plan: p, reason: p.fits ? `El modelo no cabe entero en tu GPU; con ${o.ctx.toLocaleString('es-ES')} tokens se reparte GPU+RAM (${p.gpuLayers}/${p.totalLayers} capas en GPU). Más contexto lo haría más lento.` : 'El modelo no cabe en la memoria disponible ni con contexto reducido. Usa una cuantización más pequeña.' };
  }
  return { ...pick, cap, train, options };
}

export const RATING_INFO = {
  fluido: { label: 'Fluido', color: 'green', rank: 0 },
  bueno: { label: 'Funciona bien', color: 'teal', rank: 1 },
  lento: { label: 'Funciona (lento)', color: 'amber', rank: 2 },
  muylento: { label: 'Muy lento', color: 'orange', rank: 3 },
  nofit: { label: 'No cabe', color: 'red', rank: 4 }
};

/** Presupuesto "estático" para recomendaciones (no depende del uso actual). */
export function staticBudget(hw) {
  const gpus = (hw?.gpus || []).filter((g) => g.usable !== false);
  const best = gpus.slice().sort((a, b) => (b.vram || 0) - (a.vram || 0))[0];
  const unified = !!hw?.unifiedMemory;
  const totalRam = hw?.ram?.total || 8 * GiB;
  const multiVram = gpus.filter((g) => !g.integrated && g.vendor === best?.vendor).reduce((a, g) => a + (g.vram || 0), 0);
  let vram = 0, hasGpu = false, gpuBW = 300;
  if (unified) { vram = totalRam * 0.72; hasGpu = true; gpuBW = gpuBandwidth(best?.name || hw?.cpu?.brand || '', true); }
  else if (best && !best.integrated && best.vram >= 2 * GiB) { vram = Math.max(0, multiVram - 0.7 * GiB); hasGpu = true; gpuBW = best.bandwidth || gpuBandwidth(best.name); }
  const osReserve = Math.min(3.5 * GiB, Math.max(0.6 * GiB, totalRam * 0.22));
  const ram = unified ? totalRam * 0.2 : Math.max(0.5 * GiB, totalRam - osReserve);
  return { vram, ram, gpuBW, cpuBW: hw?.ram?.bandwidth || 50, hasGpu };
}

/**
 * Planificador multi-modelo: decide si varios modelos caben simultáneamente
 * (reparto de VRAM por prioridad + offload a RAM) o si deben ejecutarse por turnos.
 * items: [{ id, meta, fileSize, ctx, mmprojSize }]
 */
export function planMulti(items, budget, opts = {}) {
  let vram = budget.vram, ram = budget.ram;
  const plans = [];
  // Orden: primero los que caben enteros en GPU (menores), luego el resto — maximiza modelos 100% GPU
  const order = opts.keepOrder ? items.map((_, i) => i) : items.map((it, i) => ({ i, s: (it.fileSize || it.meta?.fileSize || 0) })).sort((a, b) => a.s - b.s).map((x) => x.i);
  for (const idx of order) {
    const it = items[idx];
    const p = planModel(it.meta, { ...budget, vram, ram }, { ctx: it.ctx, kvType: it.kvType, mmprojSize: it.mmprojSize, fileSize: it.fileSize });
    plans[idx] = { id: it.id, ...p };
    if (p.fits) { vram -= p.gpuBytes; ram -= p.cpuBytes; }
  }
  const fitsAll = plans.every((p) => p.fits);
  const totalGpu = plans.reduce((a, p) => a + (p.fits ? p.gpuBytes : 0), 0);
  const totalCpu = plans.reduce((a, p) => a + (p.fits ? p.cpuBytes : 0), 0);
  // Si no caben juntos: ¿cabe cada uno por separado? => modo por turnos
  const soloPlans = items.map((it) => planModel(it.meta, budget, { ctx: it.ctx, kvType: it.kvType, mmprojSize: it.mmprojSize, fileSize: it.fileSize }));
  const sequentialOk = soloPlans.every((p) => p.fits);
  return {
    plans, fitsAll, sequentialOk, soloPlans, totalGpu, totalCpu,
    remainingVram: Math.max(0, vram), remainingRam: Math.max(0, ram),
    strategy: fitsAll ? 'concurrent' : (sequentialOk ? 'sequential' : 'impossible')
  };
}

export function fmtBytes(b, digits = 1) {
  if (!b && b !== 0) return '—';
  if (b >= GiB) return (b / GiB).toFixed(digits) + ' GB';
  if (b >= MiB) return (b / MiB).toFixed(0) + ' MB';
  return Math.round(b / 1024) + ' KB';
}

export function fmtParams(p) {
  if (!p) return '?';
  if (p >= 1e9) return (p / 1e9 >= 100 ? Math.round(p / 1e9) : (p / 1e9).toFixed(1).replace(/\.0$/, '')) + 'B';
  return Math.round(p / 1e6) + 'M';
}
