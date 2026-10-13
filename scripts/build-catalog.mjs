// Genera src/main/catalog-data.json con metadatos reales leídos de Hugging Face.
import fs from 'node:fs';
import path from 'node:path';
import { readRemoteGGUF } from '../src/main/gguf.js';
import { quantFromName } from '../src/shared/fit.js';

const C = (repo, desc, extra = {}) => ({ repo, desc, ...extra });
const CURATED = [
  // ── Ligeros (portátiles, poca VRAM) ──
  C('unsloth/Qwen3.5-0.8B-GGUF', 'Ultraligero y sorprendentemente capaz. Ideal para equipos modestos, tareas rápidas y como ayudante en flujos multi-modelo.', { tags: ['rapido'] }),
  C('unsloth/Qwen3.5-2B-GGUF', 'Modelo pequeño multilingüe con razonamiento. Muy rápido incluso solo con CPU.', { tags: ['rapido'] }),
  C('unsloth/Qwen3.5-4B-GGUF', 'El mejor equilibrio en tamaño pequeño: razonamiento, herramientas y buen español. Excelente como agente ligero.', { tags: ['recomendado'] }),
  C('unsloth/gemma-4-E2B-it-GGUF', 'Gemma 4 edición "efectiva 2B" de Google, pensada para dispositivos. Multimodal y muy eficiente.'),
  C('unsloth/gemma-4-E4B-it-GGUF', 'Gemma 4 E4B: calidad de modelo mayor con coste de uno pequeño. Multimodal y gran español.', { tags: ['recomendado'] }),
  C('LiquidAI/LFM2.5-2.6B-GGUF', 'LFM2.5 de Liquid AI: arquitectura híbrida muy rápida, pensada para ejecutarse en local con poca memoria.', { tags: ['rapido'] }),
  C('lmstudio-community/LFM2.5-1.2B-Instruct-GGUF', 'Versión mini de LFM2.5. Respuestas instantáneas en casi cualquier equipo.', { tags: ['rapido'] }),
  C('openbmb/MiniCPM5-2B-GGUF', 'MiniCPM5 2B: modelo compacto de alto rendimiento para uso local.'),
  C('unsloth/Llama-3.2-3B-Instruct-GGUF', 'Llama 3.2 3B de Meta: clásico fiable y ligero para chat general.'),
  C('unsloth/Phi-4-mini-instruct-GGUF', 'Phi-4 mini de Microsoft: fuerte en razonamiento y matemáticas para su tamaño.'),
  C('lmstudio-community/Ministral-3-3B-Instruct-2512-GGUF', 'Ministral 3 3B de Mistral AI: rápido, multilingüe y con llamadas a herramientas.'),
  C('janhq/Jan-v3.5-4B-gguf', 'Jan v3.5 4B: afinado para tareas agénticas, búsqueda y uso de herramientas.', { tags: ['agente'] }),
  C('bartowski/Fara1.5-4B-GGUF', 'Fara 1.5 4B de Microsoft: agente especializado en manejar el ordenador y el navegador a partir de capturas de pantalla.', { caps: ['computer'], tags: ['control-pc'] }),
  C('lmstudio-community/NVIDIA-Nemotron-3-Nano-4B-GGUF', 'Nemotron 3 Nano 4B de NVIDIA: híbrido muy eficiente para agentes y razonamiento.'),
  // ── Medianos (8-16 GB VRAM) ──
  C('unsloth/Qwen3.5-9B-GGUF', 'Qwen3.5 9B: potente todoterreno con visión, herramientas y razonamiento. Muy recomendado para GPUs de 8-12 GB.', { tags: ['recomendado'] }),
  C('bartowski/Fara1.5-9B-GGUF', 'Fara 1.5 9B de Microsoft: agente de uso del ordenador (clics, escritura, navegación) con visión.', { caps: ['computer'], tags: ['control-pc', 'recomendado'] }),
  C('bartowski/tencent_UI-Mate-9B-GGUF', 'UI-Mate 9B de Tencent: especialista en entender interfaces gráficas y operar aplicaciones.', { caps: ['computer'], tags: ['control-pc'] }),
  C('unsloth/gemma-4-12b-it-GGUF', 'Gemma 4 12B de Google: excelente calidad de escritura, visión y gran contexto.', { tags: ['recomendado'] }),
  C('LiquidAI/LFM2.5-8B-A1B-GGUF', 'LFM2.5 MoE 8B con solo 1B activo: velocidad extrema con calidad de modelo mediano.', { tags: ['rapido'] }),
  C('lmstudio-community/Ministral-3-14B-Reasoning-2512-GGUF', 'Ministral 3 14B Reasoning: razonamiento paso a paso con buen español.'),
  C('unsloth/Qwen3-VL-8B-Instruct-GGUF', 'Qwen3-VL 8B: visión avanzada (documentos, capturas, interfaces).'),
  C('lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF', 'Llama 3.1 8B: estándar clásico, compatible con todo.'),
  C('ornith-ai/Ornith-1.5-9B-GGUF', 'Ornith 1.5 9B: afinado muy popular basado en Qwen3.5, orientado a chat y creatividad.'),
  C('bartowski/NousResearch_Hermes-4-14B-GGUF', 'Hermes 4 14B de Nous Research: gran seguidor de instrucciones y rol, con herramientas.'),
  // ── Grandes (16-32 GB VRAM o GPU + RAM) ──
  C('unsloth/Qwen3.8-27B-GGUF', 'Qwen3.8 27B: el modelo denso local más potente del momento en su tamaño. Visión, herramientas y razonamiento de primer nivel.', { tags: ['recomendado', 'top'] }),
  C('unsloth/Qwen3.6-27B-GGUF', 'Qwen3.6 27B denso: muy sólido en código, agentes y razonamiento.'),
  C('unsloth/Qwen3.6-35B-A3B-GGUF', 'Qwen3.6 35B-A3B (MoE, 3B activos): calidad de modelo grande a velocidad de modelo pequeño. Funciona genial con offload a RAM.', { tags: ['recomendado', 'moe'] }),
  C('unsloth/Qwen3.5-35B-A3B-GGUF', 'Qwen3.5 35B-A3B MoE: rápido y capaz, ideal para GPU de 8-16 GB + RAM.', { tags: ['moe'] }),
  C('unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF', 'Qwen3-Coder 30B-A3B: especialista en programación y agentes de código. Muy rápido gracias a MoE.', { caps: ['code'], tags: ['codigo'] }),
  C('unsloth/gpt-oss-20b-GGUF', 'gpt-oss 20B de OpenAI: razonamiento configurable y excelente uso de herramientas. Cabe en 16 GB.', { tags: ['recomendado'] }),
  C('unsloth/gemma-4-26B-A4B-it-GGUF', 'Gemma 4 26B-A4B MoE: calidad alta con 4B activos, multimodal.', { tags: ['moe'] }),
  C('unsloth/gemma-4-31B-it-GGUF', 'Gemma 4 31B denso: el Gemma más capaz para uso local.'),
  C('lmstudio-community/Devstral-Small-2-24B-Instruct-2512-GGUF', 'Devstral Small 2 24B de Mistral: agente de ingeniería de software.', { caps: ['code'], tags: ['codigo'] }),
  C('ggml-org/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-GGUF', 'Nemotron 3.5 Lightning 30B-A3B de NVIDIA: híbrido MoE ultrarrápido con contexto gigante.', { tags: ['moe'] }),
  C('unsloth/GLM-4.7-Flash-GGUF', 'GLM-4.7 Flash de Zhipu: rápido, bueno en código y agentes.'),
  C('bartowski/Fara1.5-27B-GGUF', 'Fara 1.5 27B: el agente de control del ordenador más preciso de la familia Fara.', { caps: ['computer'], tags: ['control-pc'] }),
  C('ornith-ai/Ornith-1.5-35B-A3B-GGUF', 'Ornith 1.5 35B-A3B: versión MoE del popular Ornith.', { tags: ['moe'] }),
  C('unsloth/Qwen-AgentWorld-35B-A3B-GGUF', 'Qwen AgentWorld 35B-A3B: afinado para tareas agénticas largas y uso de herramientas.', { tags: ['agente', 'moe'] }),
  C('meta-models/Muse-Glimmer-30B-GGUF', 'Muse Glimmer 30B: modelo multimodal de propósito general.'),
  // ── Muy grandes (estaciones de trabajo / mucha RAM) ──
  C('unsloth/Qwen3-Coder-Next-GGUF', 'Qwen3-Coder-Next 80B MoE: programación de nivel frontera en local (requiere mucha RAM).', { caps: ['code'], tags: ['codigo', 'moe'] }),
  C('ggml-org/gpt-oss-120b-GGUF', 'gpt-oss 120B de OpenAI: razonamiento de alto nivel; funciona con GPU + 64 GB de RAM gracias a MoE.', { tags: ['moe'] }),
  C('unsloth/Qwen3.5-122B-A10B-GGUF', 'Qwen3.5 122B-A10B MoE: calidad cercana a modelos de nube.', { tags: ['moe'] }),
  C('lmstudio-community/Llama-3.3-70B-Instruct-GGUF', 'Llama 3.3 70B de Meta: gran modelo denso clásico.'),
  C('unsloth/Qwen3.8-Flash-Next-GGUF', 'Qwen3.8 Flash-Next: modelo frontera MoE de Qwen para equipos con mucha memoria.', { tags: ['moe'] }),
  C('unsloth/Step-3.7-Flash-GGUF', 'Step 3.7 Flash de StepFun: MoE multimodal de gran escala.', { tags: ['moe'] }),
  C('unsloth/DeepSeek-V4-Flash-0731-GGUF', 'DeepSeek V4 Flash: modelo frontera de DeepSeek (estaciones de trabajo con 256 GB+).', { tags: ['moe'] }),
  C('unsloth/GLM-5.3-Flash-GGUF', 'GLM-5.3 Flash de Zhipu: MoE frontera para servidores domésticos potentes.', { tags: ['moe'] })
];

const PREFERRED = ['Q4_K_M', 'Q4_K_XL', 'MXFP4_MOE', 'MXFP4', 'Q4_K_S', 'IQ4_XS', 'Q4_0', 'Q5_K_M', 'Q8_0'];

async function j(url) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url);
    if (r.ok) return r.json();
    if (r.status === 404) throw new Error('404 ' + url);
    await new Promise((s) => setTimeout(s, 1500 * (i + 1)));
  }
  throw new Error('fallo ' + url);
}

export function groupFiles(tree) {
  const ggufs = tree.filter((f) => f.type === 'file' && /\.gguf$/i.test(f.path));
  const mmproj = ggufs.filter((f) => /mmproj/i.test(f.path)).map((f) => ({ path: f.path, size: f.lfs?.size || f.size }));
  const groups = new Map();
  for (const f of ggufs) {
    if (/mmproj|imatrix/i.test(f.path)) continue;
    if (/(^|\/)(mtp|dflash|draft|eagle|spec|assistant)[-_]/i.test(f.path) || /(^|\/)(MTP|draft|DFlash)\//i.test(f.path)) continue;
    const base = f.path.replace(/-\d{5}-of-\d{5}\.gguf$/i, '.gguf');
    const key = base;
    if (!groups.has(key)) groups.set(key, { name: path.basename(base), files: [], size: 0 });
    const g = groups.get(key);
    g.files.push(f.path);
    g.size += f.lfs?.size || f.size || 0;
  }
  const quants = [...groups.values()].map((g) => ({ ...g, files: g.files.sort(), quant: quantFromName(g.name) || quantFromName(g.files[0]) || g.name.replace(/\.gguf$/i, '') }));
  quants.sort((a, b) => a.size - b.size);
  return { quants, mmproj: mmproj.sort((a, b) => a.size - b.size) };
}

async function build() {
  const out = [];
  for (const c of CURATED) {
    try {
      const info = await j(`https://huggingface.co/api/models/${c.repo}?expand[]=gguf&expand[]=pipeline_tag&expand[]=downloads&expand[]=likes&expand[]=lastModified&expand[]=cardData&expand[]=tags`);
      const tree = await j(`https://huggingface.co/api/models/${c.repo}/tree/main?recursive=true`);
      const { quants, mmproj } = groupFiles(tree);
      if (!quants.length) { console.log('SIN GGUF', c.repo); continue; }
      let rep = null;
      for (const p of PREFERRED) { rep = quants.find((q) => q.quant === p); if (rep) break; }
      rep = rep || quants[Math.floor(quants.length / 2)];
      let meta = null;
      try {
        meta = await readRemoteGGUF(`https://huggingface.co/${c.repo}/resolve/main/${rep.files[0]}`, { fileSize: rep.size });
        meta.fileSize = rep.size;
      } catch (e) { console.log('  meta falló', c.repo, e.message); }
      const params = info.gguf?.total || meta?.params || 0;
      const caps = new Set(c.caps || []);
      if (mmproj.length || /image-text|any-to-any/.test(info.pipeline_tag || '')) caps.add('vision');
      if (meta?.toolsInTemplate) caps.add('tools');
      if (meta?.reasoningInTemplate) caps.add('reasoning');
      if (/coder|devstral|code/i.test(c.repo)) caps.add('code');
      if (meta?.expertCount) caps.add('moe');
      const owner = c.repo.split('/')[0];
      const nm = c.repo.split('/')[1].replace(/[-_]GGUF$/i, '').replace(/^(Qwen_|google_|microsoft_|NousResearch_|tencent_)/, '');
      out.push({
        id: c.repo, repo: c.repo, name: nm.replace(/-gguf$/i, ''), publisher: owner, desc: c.desc,
        tags: c.tags || [], caps: [...caps], params, arch: info.gguf?.architecture || meta?.arch,
        ctx: info.gguf?.context_length || meta?.ctxTrain, downloads: info.downloads, likes: info.likes,
        updated: info.lastModified, license: info.cardData?.license || null,
        recommended: rep.quant, quants: quants.map((q) => ({ quant: q.quant, name: q.name, files: q.files, size: q.size })),
        mmproj, meta: meta ? { ...meta, fileSize: rep.size } : null
      });
      console.log('OK', c.repo, (params / 1e9).toFixed(1) + 'B', quants.length, 'quants', meta ? `L${meta.layers} attn${meta.attnLayers} kv${meta.kvElemsPerLayerToken} exp${meta.expertCount}` : '');
    } catch (e) { console.log('ERROR', c.repo, e.message); }
  }
  const file = path.resolve('src/main/catalog-data.json');
  fs.writeFileSync(file, JSON.stringify({ generated: new Date().toISOString(), models: out }));
  console.log('Escrito', file, out.length, 'modelos', (fs.statSync(file).size / 1024).toFixed(0) + ' KB');
}

if (process.argv[1] && process.argv[1].endsWith('build-catalog.mjs')) build();
