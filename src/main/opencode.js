// Puente con OpenCode (agente de terminal): Nexo envía la orden, OpenCode la ejecuta con sus
// herramientas y sus modelos (nube o el local de Nexo) y los eventos se muestran en el chat.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isWin, run } from './util.js';
import * as paths from './paths.js';

let cachedBin = null;
let modelsCache = { t: 0, list: [] };

/** Ruta del ejecutable de OpenCode (sin pasar por cmd para no romper comillas). */
export function findOpenCode(custom) {
  if (custom && fs.existsSync(custom)) return custom;
  if (cachedBin && fs.existsSync(cachedBin)) return cachedBin;
  const exe = isWin ? 'opencode.exe' : 'opencode';
  const cands = [
    process.env.APPDATA && path.join(process.env.APPDATA, 'npm', 'node_modules', 'opencode-ai', 'bin', exe),
    path.join(os.homedir(), '.opencode', 'bin', exe),
    path.join(os.homedir(), '.bun', 'bin', exe),
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'opencode', exe),
    '/usr/local/bin/opencode', '/opt/homebrew/bin/opencode', path.join(os.homedir(), '.local', 'bin', 'opencode')
  ].filter(Boolean);
  for (const p of (process.env.PATH || '').split(path.delimiter)) if (p) cands.push(path.join(p, exe));
  cachedBin = cands.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
  return cachedBin;
}

function exec(bin, args, { cwd, env, timeout = 60000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd, env: { ...process.env, ...env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const t = setTimeout(() => { try { child.kill(); } catch { } }, timeout);
    child.on('close', (code) => { clearTimeout(t); resolve({ code, out, err }); });
    child.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out, err: e.message }); });
  });
}

/** Estado: si está instalado y su versión. */
export async function status(custom) {
  const bin = findOpenCode(custom);
  if (!bin) return { installed: false };
  const r = await exec(bin, ['--version'], { timeout: 20000 });
  return { installed: r.code === 0, path: bin, version: r.out.trim() };
}

/** Estado de OpenCode (último modelo usado y nivel de pensamiento elegido para cada modelo en su interfaz). */
function stateFile() { return path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'opencode', 'model.json'); }
export function readState() {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch { }
  const r = s.recent?.[0];
  const variants = Object.fromEntries(Object.entries(s.variant || {}).filter(([, v]) => v && v !== 'default'));
  return { last: r ? `${r.providerID}/${r.modelID}` : null, recent: (s.recent || []).map((x) => `${x.providerID}/${x.modelID}`), favorite: (s.favorite || []).map((x) => `${x.providerID}/${x.modelID}`), variants };
}

/** Todos los modelos que OpenCode puede usar (nube y proveedores por API), con sus niveles de pensamiento. */
export async function listModels({ custom, force = false } = {}) {
  if (!force && Date.now() - modelsCache.t < 10 * 60e3 && modelsCache.list.length) return modelsCache.list;
  const bin = findOpenCode(custom);
  if (!bin) throw new Error('OpenCode no está instalado. Instálalo con: npm i -g opencode-ai');
  const r = await exec(bin, ['models', '--verbose'], { timeout: 120000 });
  if (r.code !== 0) throw new Error(r.err.trim().split('\n').pop() || 'No se pudo listar los modelos de OpenCode');
  // Formato: una línea "proveedor/modelo" seguida de su JSON (hasta una línea "}")
  const list = [];
  let id = null, buf = [];
  for (const line of r.out.split(/\r?\n/)) {
    if (!id) { if (/^[\w.@-]+\/\S+$/.test(line.trim()) && !line.startsWith(' ')) { id = line.trim(); buf = []; } continue; }
    buf.push(line);
    if (line === '}') {
      let j = {};
      try { j = JSON.parse(buf.join('\n')); } catch { }
      list.push({
        id, provider: id.split('/')[0], name: id.split('/').slice(1).join('/'), label: j.name || id.split('/').slice(1).join('/'),
        variants: Object.keys(j.variants || {}), reasoning: !!j.capabilities?.reasoning, context: j.limit?.context || 0,
        free: j.cost ? !(j.cost.input || j.cost.output) : false
      });
      id = null;
    }
  }
  modelsCache = { t: Date.now(), list };
  return list;
}

// MCP que Nexo activa en OpenCode por orden (desactivados en la config global porque algunos
// modelos, p. ej. Muse Spark, rechazan sus esquemas por tener más de 10 niveles de anidación).
const EXTRA_MCP = ['rea'];
const noMcpFile = path.join(os.homedir(), '.local', 'state', 'opencode', 'nexo-sin-mcp.json');
function loadNoMcp() { try { return new Set(JSON.parse(fs.readFileSync(noMcpFile, 'utf8'))); } catch { return new Set(); } }
function saveNoMcp(set) { try { fs.mkdirSync(path.dirname(noMcpFile), { recursive: true }); fs.writeFileSync(noMcpFile, JSON.stringify([...set])); } catch { } }
const SCHEMA_RE = /schema.*(nesting|depth)|nesting depth/i;

/** Configuración en línea: modelo local de Nexo y MCP extra activados o no. */
function buildConfig(local, mcpOn) {
  const c = { mcp: Object.fromEntries(EXTRA_MCP.map((n) => [n, { enabled: !!mcpOn }])) };
  // Navegador de Nexo (Chrome real) como herramienta MCP: OpenCode puede navegar y hacer clic sin pasar por la terminal.
  try {
    const script = fileURLToPath(new URL('./browser-mcp.mjs', import.meta.url));
    c.mcp['nexo-browser'] = { type: 'local', command: [process.execPath, script], enabled: true, timeout: 60000, environment: { ELECTRON_RUN_AS_NODE: '1', NEXO_CHROME_PROFILE: paths.dir('cache', 'chrome-profile') } };
  } catch { /* sin carpeta de datos configurada */ }
  const p = nexoProviderConfig(local);
  if (p) Object.assign(c, p);
  return JSON.stringify(c);
}

/** Proveedor para que OpenCode pueda usar el modelo local cargado en Nexo. */
function nexoProviderConfig(local) {
  if (!local) return null;
  return ({
    provider: {
      nexo: {
        npm: '@ai-sdk/openai-compatible', name: 'Nexo AI (local)',
        options: { baseURL: local.baseUrl },
        models: { [local.model]: { name: local.label || local.model, tool_call: true, limit: { context: local.ctx || 8192, output: Math.min(8192, Math.floor((local.ctx || 8192) / 2)) } } }
      }
    }
  });
}

const THINK_RE = /<think>[\s\S]*?<\/think>/g;
function cleanText(t = '') {
  let s = t.replace(THINK_RE, '');
  const end = s.lastIndexOf('</think>');
  if (end >= 0) s = s.slice(end + 8); // algunos modelos filtran el razonamiento sin la etiqueta de apertura
  return s.replace(/^\s+/, '');
}

/**
 * Ejecuta una orden en OpenCode y va emitiendo eventos:
 * onEvent({ type: 'session'|'text'|'reasoning'|'tool'|'usage'|'error', ... })
 */
export async function runPrompt(opts) {
  const key = opts.model || '(predeterminado)';
  const noMcp = loadNoMcp();
  // REA anuncia ~170 herramientas (~72k tokens en modo compact): solo si se activa a mano en Ajustes
  if (!opts.rea || noMcp.has(key)) return runOnce({ ...opts, mcpOn: false });
  try { return await runOnce({ ...opts, mcpOn: true }); }
  catch (e) {
    if (!SCHEMA_RE.test(e.message) || opts.signal?.aborted) throw e;
    noMcp.add(key); saveNoMcp(noMcp);
    opts.onEvent({ type: 'text', delta: `_Este modelo no acepta las herramientas de ${EXTRA_MCP.join(', ')}; repito sin ellas (queda recordado)._

` });
    return runOnce({ ...opts, mcpOn: false });
  }
}

function runOnce({ prompt, sessionId, model, variant, local, dir, auto, files = [], signal, onEvent, custom, mcpOn }) {
  return new Promise((resolve, reject) => {
    const bin = findOpenCode(custom);
    if (!bin) return reject(new Error('OpenCode no está instalado. Instálalo con: npm i -g opencode-ai (o indica la ruta en Ajustes → OpenCode).'));
    const args = ['run', '--format', 'json', '--thinking'];
    if (sessionId) args.push('--session', sessionId);
    if (model) args.push('--model', model);
    if (variant) args.push('--variant', variant);
    if (dir) args.push('--dir', dir);
    if (auto) args.push('--auto');
    for (const f of files) args.push('--file', f);
    args.push('--', prompt);
    const env = { ...process.env };
    env.OPENCODE_CONFIG_CONTENT = buildConfig(local, mcpOn);
    // stdin cerrado: con una tubería abierta OpenCode espera texto por la entrada estándar y no arranca
    const child = spawn(bin, args, { cwd: dir && fs.existsSync(dir) ? dir : os.homedir(), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '', err = '', session = sessionId || null, finalText = '', failed = null;
    const texts = new Map(); // partID → texto ya emitido
    const handle = (ev) => {
      if (ev.sessionID && ev.sessionID !== session) { session = ev.sessionID; onEvent({ type: 'session', id: session }); }
      const p = ev.part || {};
      switch (ev.type) {
        case 'text': {
          const clean = cleanText(p.text || '');
          const prev = texts.get(p.id) || '';
          if (clean.startsWith(prev)) { const d = clean.slice(prev.length); if (d) onEvent({ type: 'text', delta: d, step: p.messageID }); }
          else onEvent({ type: 'text', delta: clean, step: p.messageID });
          texts.set(p.id, clean);
          finalText = clean || finalText;
          break;
        }
        case 'reasoning': {
          const full = p.text || '';
          const prev = texts.get(p.id) || '';
          const d = full.startsWith(prev) ? full.slice(prev.length) : full;
          texts.set(p.id, full);
          if (d) onEvent({ type: 'reasoning', delta: d, id: p.id, step: p.messageID });
          break;
        }
        case 'tool_use': {
          const st = p.state || {};
          onEvent({ type: 'tool', id: p.callID || p.id, step: p.messageID, name: p.tool, input: st.input, output: st.output ?? st.metadata?.output, title: st.title, status: st.status, error: st.error, time: st.time });
          break;
        }
        case 'step_finish': if (p.tokens) onEvent({ type: 'usage', input: p.tokens.input, output: p.tokens.output, cost: p.cost }); break;
        case 'error': failed = ev.error?.data?.message || ev.error?.message || JSON.stringify(ev.error || ev); onEvent({ type: 'error', message: failed }); break;
      }
    };
    child.stdout.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('{')) continue;
        try { handle(JSON.parse(line)); } catch { }
      }
    });
    child.stderr.on('data', (d) => { err += d.toString(); if (err.length > 20000) err = err.slice(-10000); });
    const kill = () => { if (isWin) run('taskkill', ['/pid', String(child.pid), '/T', '/F']); else try { child.kill('SIGTERM'); } catch { } };
    signal?.addEventListener('abort', kill, { once: true });
    child.on('error', (e) => reject(e));
    child.on('close', (code) => {
      if (buf.trim().startsWith('{')) { try { handle(JSON.parse(buf.trim())); } catch { } }
      if (signal?.aborted) return resolve({ text: finalText, session, stopped: true });
      if (failed) return reject(new Error(`OpenCode: ${failed}`));
      if (code !== 0 && !finalText) return reject(new Error(`OpenCode terminó con código ${code}${err.trim() ? ': ' + err.trim().split('\n').slice(-3).join(' ') : ''}`));
      resolve({ text: finalText, session });
    });
  });
}
