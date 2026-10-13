// Biblioteca de modelos: catálogo curado, búsqueda/tendencias en Hugging Face,
// descarga e instalación, y modelos locales (incluye carpetas externas de LM Studio, etc.).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { dir } from './paths.js';
import { load, save, readJSON, writeJSONAtomic } from './store.js';
import { downloads } from './downloads.js';
import { readLocalGGUF, readRemoteGGUF } from './gguf.js';
import { quantFromName } from '../shared/fit.js';

const require = createRequire(import.meta.url);
const HF = 'https://huggingface.co';
let catalog = null;
let hfTokenGetter = () => '';

export function setHfTokenGetter(fn) { hfTokenGetter = fn; }
function hfHeaders() { const t = hfTokenGetter(); return t ? { Authorization: `Bearer ${t}` } : {}; }

export function getCatalog() {
  if (!catalog) {
    try { catalog = require('./catalog-data.json'); } catch { catalog = { models: [] }; }
    // catálogo actualizado en caché (si existe y es más nuevo)
    try {
      const cached = readJSON(dir('cache', 'catalog-live.json'), null);
      if (cached?.models?.length && new Date(cached.generated) > new Date(catalog.generated)) catalog = cached;
    } catch { }
  }
  return catalog;
}

async function hfJSON(url) {
  const res = await fetch(url, { headers: { ...hfHeaders(), 'User-Agent': 'NexoAI/1.0' } });
  if (!res.ok) throw new Error(`Hugging Face respondió ${res.status}`);
  return res.json();
}

export function groupFiles(tree) {
  const ggufs = tree.filter((f) => f.type === 'file' && /\.gguf$/i.test(f.path));
  const mmproj = ggufs.filter((f) => /mmproj/i.test(f.path)).map((f) => ({ path: f.path, size: f.lfs?.size || f.size }));
  const groups = new Map();
  for (const f of ggufs) {
    if (/mmproj|imatrix/i.test(f.path)) continue;
    if (/(^|\/)(mtp|dflash|draft|eagle|spec|assistant)[-_]/i.test(f.path) || /(^|\/)(MTP|draft|DFlash)\//i.test(f.path)) continue;
    const base = f.path.replace(/-\d{5}-of-\d{5}\.gguf$/i, '.gguf');
    if (!groups.has(base)) groups.set(base, { name: path.basename(base), files: [], size: 0 });
    const g = groups.get(base);
    g.files.push(f.path);
    g.size += f.lfs?.size || f.size || 0;
  }
  const quants = [...groups.values()].map((g) => ({ ...g, files: g.files.sort(), quant: quantFromName(g.name) || quantFromName(g.files[0]) || g.name.replace(/\.gguf$/i, '') }));
  quants.sort((a, b) => a.size - b.size);
  return { quants, mmproj: mmproj.sort((a, b) => a.size - b.size) };
}

const repoCache = new Map();
/** Información completa de un repo (archivos + metadatos de arquitectura). */
export async function repoDetails(repo, { quant } = {}) {
  let entry = repoCache.get(repo);
  if (!entry || Date.now() - entry.t > 10 * 60e3) {
    const [info, tree] = await Promise.all([
      hfJSON(`${HF}/api/models/${repo}?expand[]=gguf&expand[]=pipeline_tag&expand[]=downloads&expand[]=likes&expand[]=lastModified&expand[]=cardData&expand[]=tags`),
      hfJSON(`${HF}/api/models/${repo}/tree/main?recursive=true`)
    ]);
    const { quants, mmproj } = groupFiles(tree);
    const cat = getCatalog().models.find((m) => m.repo === repo);
    entry = {
      t: Date.now(),
      data: {
        id: repo, repo, name: repo.split('/')[1].replace(/[-_]GGUF$/i, ''), publisher: repo.split('/')[0],
        desc: cat?.desc || '', caps: cat?.caps || [], tags: cat?.tags || [],
        params: info.gguf?.total || cat?.params || 0, arch: info.gguf?.architecture, ctx: info.gguf?.context_length,
        downloads: info.downloads, likes: info.likes, updated: info.lastModified, pipeline: info.pipeline_tag,
        license: info.cardData?.license || null, gated: !!info.gated,
        quants, mmproj, meta: cat?.meta || null, metaByQuant: {}
      }
    };
    if (mmproj.length || /image-text|any-to-any/.test(info.pipeline_tag || '')) { if (!entry.data.caps.includes('vision')) entry.data.caps = [...entry.data.caps, 'vision']; }
    repoCache.set(repo, entry);
  }
  const d = entry.data;
  const q = quant ? d.quants.find((x) => x.quant === quant || x.name === quant) : pickRecommended(d.quants);
  if (q && !d.metaByQuant[q.name]) {
    try {
      const meta = await readRemoteGGUF(`${HF}/${repo}/resolve/main/${q.files[0]}`, { headers: hfHeaders(), fileSize: q.size });
      meta.fileSize = q.size;
      d.metaByQuant[q.name] = meta;
      if (!d.meta) d.meta = meta;
      const caps = new Set(d.caps);
      if (meta.toolsInTemplate) caps.add('tools');
      if (meta.reasoningInTemplate) caps.add('reasoning');
      if (meta.expertCount) caps.add('moe');
      d.caps = [...caps];
    } catch (e) { d.metaError = e.message; }
  }
  return { ...d, recommended: pickRecommended(d.quants)?.quant, selected: q?.name };
}

export function pickRecommended(quants) {
  const pref = ['Q4_K_M', 'Q4_K_XL', 'MXFP4_MOE', 'MXFP4', 'Q4_K_S', 'IQ4_XS', 'Q4_0', 'IQ4_NL', 'Q5_K_M', 'Q8_0'];
  for (const p of pref) { const q = quants.find((x) => x.quant === p); if (q) return q; }
  return quants[Math.floor(quants.length / 2)];
}

export async function searchHF(query, { sort = 'downloads', limit = 40 } = {}) {
  const params = new URLSearchParams({ filter: 'gguf', sort, limit: String(limit) });
  if (query) params.set('search', query);
  for (const e of ['gguf', 'downloads', 'likes', 'pipeline_tag', 'lastModified']) params.append('expand[]', e);
  const list = await hfJSON(`${HF}/api/models?${params}`);
  return list
    .filter((m) => !/text-to-image|image-to-video|text-to-video|text-to-speech|image-to-image|feature-extraction|sentence-similarity|object-detection|audio|token-classification|image-text-to-video/.test(m.pipeline_tag || ''))
    .map((m) => ({
      id: m.id, repo: m.id, name: m.id.split('/')[1].replace(/[-_]GGUF$/i, ''), publisher: m.id.split('/')[0],
      params: m.gguf?.total || 0, arch: m.gguf?.architecture, ctx: m.gguf?.context_length,
      downloads: m.downloads, likes: m.likes, updated: m.lastModified, pipeline: m.pipeline_tag,
      caps: /image-text|any-to-any/.test(m.pipeline_tag || '') ? ['vision'] : [],
      approxSize: m.gguf?.total ? m.gguf.total * 4.85 / 8 : 0
    }));
}

// ───────────── Modelos locales ─────────────
function modelsState() { return load('models', { settings: {}, extraDirs: [], favorites: [] }); }
function metaCacheFile() { return dir('cache', 'gguf-meta.json'); }
let metaCache = null;
function getMetaCache() { if (!metaCache) metaCache = readJSON(metaCacheFile(), {}); return metaCache; }

function walkGGUF(root, out = [], depth = 0) {
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(root, e.name);
    if (e.isDirectory() && depth < 6) walkGGUF(p, out, depth + 1);
    else if (e.isFile() && /\.gguf$/i.test(e.name)) out.push(p);
  }
  return out;
}

export function lmStudioDirs() {
  const home = os.homedir();
  return [path.join(home, '.lmstudio', 'models'), path.join(home, '.cache', 'lm-studio', 'models')].filter((d) => fs.existsSync(d));
}

export async function listLocalModels() {
  const st = modelsState();
  const roots = [dir('models'), ...st.extraDirs.filter((d) => fs.existsSync(d))];
  const files = [];
  for (const r of roots) for (const f of walkGGUF(r)) files.push({ root: r, file: f });
  const cache = getMetaCache();
  const out = [];
  let dirty = false;
  for (const { root, file } of files) {
    const name = path.basename(file);
    if (/mmproj/i.test(name)) continue;
    const split = /-(\d{5})-of-(\d{5})\.gguf$/i.exec(name);
    if (split && split[1] !== '00001') continue;
    if (/(^|[-_])(mtp|dflash|draft)[-_]/i.test(name)) continue;
    let stat; try { stat = fs.statSync(file); } catch { continue; }
    const key = `${file}|${stat.size}|${stat.mtimeMs}`;
    let meta = cache[key];
    if (!meta) {
      try { meta = await readLocalGGUF(file); cache[key] = meta; dirty = true; } catch (e) { meta = { error: e.message }; }
    }
    if (meta?.isMmproj) continue;
    const folder = path.dirname(file);
    const mmprojs = fs.readdirSync(folder).filter((f) => /mmproj.*\.gguf$/i.test(f)).map((f) => path.join(folder, f));
    const rel = path.relative(root, file);
    const parts = rel.split(path.sep);
    const repo = parts.length >= 3 ? `${parts[0]}/${parts[1]}` : (parts.length === 2 ? parts[0] : '');
    const id = root === dir('models') ? rel.split(path.sep).join('/') : file;
    const catalogEntry = getCatalog().models.find((m) => m.repo === repo);
    out.push({
      id, path: file, name: name.replace(/(-\d{5}-of-\d{5})?\.gguf$/i, ''), repo, quant: meta.fileType || quantFromName(name),
      size: meta.fileSize || stat.size, meta, mmproj: mmprojs[0] || null,
      caps: [...new Set([...(catalogEntry?.caps || []), ...(mmprojs.length ? ['vision'] : []), ...(meta.toolsInTemplate ? ['tools'] : []), ...(meta.reasoningInTemplate ? ['reasoning'] : []), ...(meta.expertCount ? ['moe'] : [])])],
      external: root !== dir('models'), settings: st.settings[id] || {}, favorite: st.favorites.includes(id),
      addedAt: stat.mtimeMs
    });
  }
  if (dirty) { try { writeJSONAtomic(metaCacheFile(), cache); } catch { } }
  return out.sort((a, b) => b.addedAt - a.addedAt);
}

export function setModelSettings(id, settings) {
  const st = modelsState();
  st.settings[id] = { ...(st.settings[id] || {}), ...settings };
  save('models', st);
  return st.settings[id];
}

export function toggleFavorite(id) {
  const st = modelsState();
  st.favorites = st.favorites.includes(id) ? st.favorites.filter((x) => x !== id) : [...st.favorites, id];
  save('models', st);
}

export function addExtraDir(d) { const st = modelsState(); if (!st.extraDirs.includes(d)) st.extraDirs.push(d); save('models', st); }
export function removeExtraDir(d) { const st = modelsState(); st.extraDirs = st.extraDirs.filter((x) => x !== d); save('models', st); }
export function getExtraDirs() { return modelsState().extraDirs; }

export function deleteLocalModel(model) {
  if (model.external) throw new Error('Este modelo está en una carpeta externa; elimínalo desde su ubicación original.');
  const folder = path.dirname(model.path);
  const base = path.basename(model.path).replace(/-00001-of-(\d{5})\.gguf$/i, '');
  for (const f of fs.readdirSync(folder)) {
    if (f === path.basename(model.path) || (base && f.startsWith(base) && /-\d{5}-of-\d{5}\.gguf$/i.test(f))) fs.unlinkSync(path.join(folder, f));
  }
  const rest = fs.readdirSync(folder).filter((f) => /\.gguf$/i.test(f) && !/mmproj/i.test(f));
  if (!rest.length) fs.rmSync(folder, { recursive: true, force: true });
}

/** Descarga un modelo (todas las partes + mmproj opcional). */
export async function downloadModel({ repo, quant, withVision = true }) {
  const details = await repoDetails(repo, { quant });
  const q = details.quants.find((x) => x.quant === quant || x.name === quant) || pickRecommended(details.quants);
  if (!q) throw new Error('No hay archivos GGUF en este repositorio');
  const [owner, name] = repo.split('/');
  const destDir = dir('models', owner, name);
  const files = q.files.map((f) => ({ url: `${HF}/${repo}/resolve/main/${f}`, dest: path.join(destDir, path.basename(f)), size: 0 }));
  // tamaños por archivo
  const tree = await hfJSON(`${HF}/api/models/${repo}/tree/main?recursive=true`).catch(() => []);
  for (const f of files) {
    const t = tree.find((x) => path.basename(x.path) === path.basename(f.dest));
    if (t) f.size = t.lfs?.size || t.size || 0;
  }
  if (withVision && details.mmproj.length) {
    const mm = details.mmproj.find((m) => /f16/i.test(m.path)) || details.mmproj.find((m) => /q8/i.test(m.path)) || details.mmproj[0];
    files.push({ url: `${HF}/${repo}/resolve/main/${mm.path}`, dest: path.join(destDir, path.basename(mm.path)), size: mm.size });
  }
  return downloads.add({ label: `${details.name} · ${q.quant}`, kind: 'model', files, meta: { repo, quant: q.quant, params: details.params } });
}

export async function importGGUF(filePath) {
  const meta = await readLocalGGUF(filePath);
  if (meta.isMmproj) throw new Error('Ese archivo es un proyector de visión (mmproj), no un modelo.');
  addExtraDir(path.dirname(filePath));
  return meta;
}

export async function refreshCatalogLive() {
  // Actualiza tamaños/cuantizaciones del catálogo curado desde HF (en segundo plano)
  const cat = getCatalog();
  const models = [];
  for (const m of cat.models) {
    try {
      const tree = await hfJSON(`${HF}/api/models/${m.repo}/tree/main?recursive=true`);
      const { quants, mmproj } = groupFiles(tree);
      models.push({ ...m, quants: quants.length ? quants : m.quants, mmproj });
    } catch { models.push(m); }
  }
  catalog = { generated: new Date().toISOString(), models };
  try { writeJSONAtomic(dir('cache', 'catalog-live.json'), catalog); } catch { }
  return catalog;
}
