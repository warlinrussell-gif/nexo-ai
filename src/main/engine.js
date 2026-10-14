// Motor de conversación y agentes: bucle modelo ↔ herramientas, permisos, delegación
// multi-modelo, modo comparar (varios modelos en paralelo) y pipeline (modelos por etapas).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { streamChat } from './providers.js';
import { getProvider, listProviders } from './providers.js';
import { listLocalModels } from './models.js';
import { llama } from './llama.js';
import { getChat, saveChat, saveAttachment } from './chats.js';
import { getAgent, listAgents, memoryPrompt } from './agents.js';
import { skillsPrompt } from './skills.js';
import { allTools, needsApproval, execCommand } from './tools.js';
import { dir } from './paths.js';
import { uid, truncate } from './util.js';
import * as opencode from './opencode.js';
import { planMulti, staticBudget } from '../shared/fit.js';

const MAX_IMAGES_IN_HISTORY = 3;
const INSTRUCTION_FILES = ['AGENTS.md', 'NEXO.md', 'CLAUDE.md', path.join('.nexo', 'instructions.md')];
const SUMMARY_PROMPT = `Eres el sistema de memoria de un asistente. Resume la conversación que te paso para que el asistente pueda continuar SIN perder nada importante. Incluye, con viñetas y de forma concreta:
- Objetivo del usuario y sus peticiones (cita literalmente las órdenes cortas).
- Decisiones tomadas y preferencias que expresó el usuario.
- Archivos, rutas, comandos, URLs y datos clave, con sus resultados.
- Estado actual de la tarea: qué está hecho y qué falta.
- Errores encontrados y cómo se resolvieron.
- Siguiente paso previsto.
Máximo ~600 palabras. No inventes nada. Escribe en el idioma del usuario.`;

/** Tokens aproximados de un mensaje (≈2,8 caracteres por token, prudente para español, código y números). */
const CHARS_PER_TOKEN = 2.8;
function estTokens(m) {
  let n = 0;
  if (typeof m.content === 'string') n += m.content.length;
  else if (Array.isArray(m.content)) for (const c of m.content) n += c.type === 'text' ? c.text.length : 3000;
  n += (m.images?.length || 0) * 3000;
  n += JSON.stringify(m.tool_calls || []).length;
  return n / CHARS_PER_TOKEN;
}

/** Copia de un mensaje sin campos internos de Nexo (_ci, _req…), que no deben llegar al proveedor. */
function stripPrivate(m) { const o = {}; for (const k in m) if (!k.startsWith('_')) o[k] = m[k]; return o; }

/** Firma de una llamada para detectar bucles (misma herramienta con los mismos argumentos). */
function callKey(c) { return `${c.name}:${JSON.stringify(c.arguments || {})}`; }
/** Firma "parecida": misma herramienta y mismo objetivo aunque cambie la posición (barridos línea a línea, scroll…). */
function sweepKey(c) { const { offset, limit, amount, lines, max_results, ...rest } = c.arguments || {}; return `${c.name}:${JSON.stringify(rest)}`; }

const CONTEXT_OVERFLOW = /exceed|context (size|length|window)|too (long|many tokens)|maximum context|n_ctx|prompt is too long/i;

function contentText(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter((x) => x.type === 'text').map((x) => x.text).join('\n') + (c.some((x) => x.type === 'image') ? ' [imagen]' : '');
  return '';
}

/** Antepone un texto a un mensaje de usuario (string o multimodal). */
function prependUser(text, m) {
  if (typeof m.content === 'string') return { ...m, content: `${text}\n\n${m.content}` };
  return { ...m, content: [{ type: 'text', text }, ...(m.content || [])] };
}

/** Instrucciones de proyecto (AGENTS.md / NEXO.md / CLAUDE.md) en la carpeta de trabajo y sus 3 carpetas superiores. */
export function projectInstructions(workspace) {
  const found = [];
  let d = workspace;
  for (let i = 0; i < 4 && d; i++) {
    for (const f of INSTRUCTION_FILES) {
      const p = path.join(d, f);
      try {
        const st = fs.statSync(p);
        if (st.isFile() && st.size < 300e3) { found.push({ path: p, text: truncate(fs.readFileSync(p, 'utf8'), 20000) }); break; }
      } catch { }
    }
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return found.reverse(); // de la carpeta más general a la más concreta
}

export class Engine extends EventEmitter {
  constructor({ getSettings, getHardware, requestApproval, askUser, webKeys }) {
    super();
    this.getSettings = getSettings;
    this.getHardware = getHardware;
    this.requestApproval = requestApproval;
    this.askUser = askUser;
    this.webKeys = webKeys;
    this.runs = new Map();
    this.localCache = { t: 0, list: [] };
  }

  async localModels(force = false) {
    if (force || Date.now() - this.localCache.t > 8000) this.localCache = { t: Date.now(), list: await listLocalModels() };
    return this.localCache.list;
  }

  async defaultModelRef() {
    const s = this.getSettings();
    if (s.defaultModel) return s.defaultModel;
    const locals = await this.localModels();
    if (locals[0]) return `local:${locals[0].id}`;
    for (const p of listProviders()) {
      if (!p.enabled) continue;
      const m = p.customModels?.[0] || p.models?.[0]?.id;
      if (m) return `${p.id}:${m}`;
    }
    return null;
  }

  async modelLabel(ref) {
    if (!ref) return 'Sin modelo';
    const [pid, ...rest] = ref.split(':');
    const id = rest.join(':');
    if (pid === 'local') { const m = (await this.localModels()).find((x) => x.id === id); return m ? `${m.name}` : id.split('/').pop(); }
    const p = getProvider(pid);
    return `${id}${p ? ` · ${p.name}` : ''}`;
  }

  /** Resuelve una referencia de modelo a un destino de API (cargando el modelo local si hace falta). */
  async resolveTarget(ref, onStatus) {
    if (!ref) ref = await this.defaultModelRef();
    if (!ref) throw new Error('No hay ningún modelo disponible. Descarga uno en "Modelos" o añade una clave API en Ajustes → Proveedores.');
    const [pid, ...rest] = ref.split(':');
    const id = rest.join(':');
    if (pid === 'local') {
      const model = (await this.localModels()).find((m) => m.id === id) || (await this.localModels(true)).find((m) => m.id === id);
      if (!model) throw new Error('El modelo local ya no existe: ' + id);
      onStatus?.('loading');
      const inst = await llama.ensureLoaded(model);
      return { ref, localId: model.id, label: model.name, ctx: inst.ctx, target: { kind: 'openai', type: 'local', baseUrl: `http://127.0.0.1:${inst.port}/v1`, apiKey: '', model: model.name, vision: !!inst.mmproj } };
    }
    const p = getProvider(pid);
    if (!p) throw new Error(`Proveedor "${pid}" no configurado`);
    if (!p.enabled) throw new Error(`El proveedor ${p.name} está desactivado`);
    return { ref, label: id, ctx: 128000, target: { kind: p.kind, type: p.type, baseUrl: p.baseUrl, apiKey: p.apiKey, model: id, vision: true } };
  }

  workspaceFor(chat) {
    const s = this.getSettings();
    return chat?.workspace || s.workspace || dir('workspace');
  }

  systemPrompt(agent, { toolsOn, stage, chat } = {}) {
    const s = this.getSettings();
    const now = new Date();
    const ws = this.workspaceFor(chat);
    let sp = agent.systemPrompt || '';
    sp += `\n\n## Entorno\n- Fecha y hora: ${now.toLocaleString('es-ES', { dateStyle: 'full', timeStyle: 'short' })} (${Intl.DateTimeFormat().resolvedOptions().timeZone})\n- Sistema: ${os.type()} ${os.release()} · Usuario: ${os.userInfo().username} · Carpeta personal: ${os.homedir()}\n- Directorio de trabajo${chat?.workspace ? ' de este chat (proyecto)' : ' por defecto'}: ${ws}\n- Idioma: responde en el idioma del usuario (por defecto, español).`;
    if (toolsOn) sp += `\n\n## Uso de herramientas\n- Tienes herramientas REALES que actúan sobre el ordenador del usuario. Úsalas directamente en lugar de explicar cómo hacerlo, salvo que te pidan solo explicación.\n- Encadena varias herramientas si hace falta; si una falla, lee el error y prueba otra vía.\n- Para tareas de 3 o más pasos, muestra un plan con update_plan y actualízalo.\n- Antes de editar un archivo, léelo (read_file) y copia el texto exacto en edit_file. Tras cambiar código, verifica (compilar, tests o ejecutar).\n- Para buscar en archivos usa search_files/list_directory en lugar de comandos. Los procesos largos (servidores) van con background=true y su salida se lee con process_output.\n- Si la petición es ambigua o hay una decisión que solo el usuario puede tomar, usa ask_user en vez de adivinar.\n- No inventes resultados: básate en lo que devuelven las herramientas.`;
    const instr = projectInstructions(ws);
    if (instr.length) sp += `\n\n## Instrucciones del proyecto\nEl usuario ha dejado estas instrucciones en archivos del proyecto. Síguelas siempre:\n${instr.map((f) => `\n### ${f.path}\n${f.text}`).join('\n')}`;
    sp += `\n- Formatea con Markdown cuando ayude (títulos, listas, tablas, bloques de código con lenguaje).`;
    if (s.customInstructions) sp += `\n\n## Instrucciones personalizadas del usuario\n${s.customInstructions}`;
    sp += memoryPrompt();
    if (agent.tools?.includes('skills')) sp += skillsPrompt(agent.skills);
    if (stage) sp += `\n\n## Flujo de trabajo por etapas\nEstás en la etapa ${stage.index + 1} de ${stage.total}: **${stage.label}**.\nTu cometido en esta etapa: ${stage.instruction || 'continuar el trabajo'}\nEntrega el resultado de tu etapa de forma completa para que la siguiente etapa pueda usarlo.`;
    return sp;
  }

  /** Convierte el historial guardado en mensajes para el modelo. */
  historyToMessages(chat, { variant = 0, uptoIndex } = {}) {
    const msgs = [];
    const end = uptoIndex !== undefined ? uptoIndex : chat.messages.length;
    // Si la conversación ya se compactó, se empieza en el resumen en vez de en los mensajes antiguos
    const sum = chat.summary && chat.summary.upto <= end ? chat.summary : null;
    const start = sum ? sum.upto : 0;
    const list = chat.messages.slice(start, end);
    for (let li = 0; li < list.length; li++) {
      const m = list[li];
      const ci = start + li;
      const at = msgs.length;
      if (m.role === 'user') {
        const parts = [];
        let text = m.content || '';
        for (const a of m.attachments || []) {
          if (a.kind === 'image' && a.file && fs.existsSync(a.file)) parts.push({ type: 'image', mime: a.mime, data: fs.readFileSync(a.file).toString('base64') });
          else if (a.kind === 'text') text += `\n\n--- Archivo adjunto: ${a.name} ---\n${truncate(a.text || '', 60000)}\n--- fin de ${a.name} ---`;
          else if (a.path) text += `\n\n[Archivo adjunto en el disco: ${a.path}]`;
        }
        msgs.push(parts.length ? { role: 'user', content: [{ type: 'text', text }, ...parts] } : { role: 'user', content: text });
      } else if (m.role === 'assistant') {
        const blocks = m.variants ? (m.variants[variant] || m.variants[0])?.blocks || [] : m.blocks || [];
        const steps = new Map();
        for (const b of blocks) {
          if (!['text', 'tool'].includes(b.type) && b.type !== 'thinking_block') continue;
          const k = b.step || 0;
          if (!steps.has(k)) steps.set(k, []);
          steps.get(k).push(b);
        }
        for (const [, bs] of [...steps.entries()].sort((a, b) => a[0] - b[0])) {
          const ocNotes = bs.filter((b) => b.type === 'tool' && b.name?.startsWith('oc:')).map((b) => `[OpenCode · ${b.name.slice(3)} ${truncate(JSON.stringify(b.args || {}), 200)} → ${truncate(b.result || b.error || '', 300)}]`);
          const text = bs.filter((b) => b.type === 'text').map((b) => b.text).join('') + (ocNotes.length ? `\n${ocNotes.join('\n')}` : '');
          const tools = bs.filter((b) => b.type === 'tool' && !b.name?.startsWith('oc:'));
          const thinking = bs.filter((b) => b.type === 'thinking_block').map((b) => b.block);
          if (!text && !tools.length) continue;
          msgs.push({ role: 'assistant', content: text, tool_calls: tools.map((t) => ({ id: t.id, name: t.name, arguments: t.args })), thinking_blocks: thinking });
          for (const t of tools) {
            msgs.push({
              role: 'tool', tool_call_id: t.id, name: t.name, isError: t.status === 'error',
              content: t.status === 'denied' ? 'El usuario denegó esta acción.' : (t.result || (t.status === 'error' ? `Error: ${t.error}` : '(sin salida)')),
              imageFiles: (t.images || []).map((im) => im.file)
            });
          }
        }
      }
      for (let k = at; k < msgs.length; k++) msgs[k]._ci = ci;
    }
    if (sum) {
      const text = `[Resumen de la conversación anterior (compactada para ahorrar contexto)]\n${sum.text}\n[Fin del resumen]`;
      if (msgs[0]?.role === 'user') msgs[0] = prependUser(text, msgs[0]);
      else msgs.unshift({ role: 'user', content: text, _ci: start - 1 });
    }
    // imágenes de herramientas: solo las más recientes (ahorro de contexto)
    let budget = MAX_IMAGES_IN_HISTORY;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.role !== 'tool' || !m.imageFiles?.length) continue;
      if (budget > 0) {
        m.images = m.imageFiles.filter((f) => fs.existsSync(f)).map((f) => ({ data: fs.readFileSync(f).toString('base64'), mime: f.endsWith('.png') ? 'image/png' : 'image/jpeg' }));
        budget -= m.images.length;
      } else m.content += '\n[captura antigua omitida]';
      delete m.imageFiles;
    }
    for (const m of msgs) delete m.imageFiles;
    return msgs;
  }

  trimToContext(messages, ctx, toolsSize = 0) {
    const est = estTokens;
    const budget = Math.max(2048, ctx * 0.8 - toolsSize / CHARS_PER_TOKEN - 1024);
    let total = messages.reduce((a, m) => a + est(m), 0);
    if (total <= budget) return messages;
    const out = [...messages];
    // primero recortar resultados de herramientas antiguos
    for (let i = 1; i < out.length - 4 && total > budget; i++) {
      const m = out[i];
      if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > 1500) {
        const before = est(m);
        out[i] = { ...m, content: truncate(m.content, 1200), images: undefined };
        total -= before - est(out[i]);
      }
    }
    // después eliminar turnos antiguos completos (manteniendo el sistema)
    while (total > budget && out.length > 3) {
      const idx = 1;
      const removed = out.splice(idx, 1)[0];
      total -= est(removed);
      while (out[idx] && out[idx].role === 'tool') total -= est(out.splice(idx, 1)[0]);
    }
    if (out[1]?.role === 'assistant') out.splice(1, 0, { role: 'user', content: '(se omitieron mensajes antiguos por límite de contexto)' });
    return out;
  }

  /** Resume mensajes con el propio modelo (sin herramientas). */
  async summarize(resolved, msgs, signal) {
    const lines = msgs.map((m) => {
      if (m.role === 'user') return `USUARIO: ${contentText(m.content)}`;
      if (m.role === 'assistant') return `ASISTENTE: ${m.content || ''}${m.tool_calls?.length ? '\n' + m.tool_calls.map((t) => `→ ${t.name}(${truncate(JSON.stringify(t.arguments || {}), 300)})`).join('\n') : ''}`;
      if (m.role === 'tool') return `RESULTADO de ${m.name}: ${truncate(String(m.content || ''), 1200)}`;
      return '';
    }).filter(Boolean);
    let transcript = lines.join('\n\n');
    const maxChars = Math.max(6000, Math.floor((resolved.ctx || 8192) * 0.5 * CHARS_PER_TOKEN));
    if (transcript.length > maxChars) transcript = transcript.slice(0, Math.floor(maxChars * 0.3)) + '\n\n[… parte intermedia omitida …]\n\n' + transcript.slice(-Math.floor(maxChars * 0.7));
    let text = '';
    for await (const ev of streamChat(resolved.target, { messages: [{ role: 'system', content: SUMMARY_PROMPT }, { role: 'user', content: `Conversación a resumir:\n\n${transcript}\n\nEscribe ahora el resumen.` }], tools: [], signal, temperature: 0.2 })) {
      if (ev.type === 'text') text += ev.delta;
    }
    return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  }

  /**
   * Compactación automática (como Claude Code): cuando la conversación se acerca al límite de contexto,
   * resume la parte antigua con el propio modelo y sigue trabajando con el resumen + lo reciente.
   */
  async compactIfNeeded({ convo, resolved, toolsSize, signal, sink, chat, force = false }) {
    if (this.getSettings().autoCompact === false && !force) return false;
    const ctx = resolved.ctx || 8192;
    const budget = Math.max(2048, ctx * 0.8 - toolsSize / CHARS_PER_TOKEN - 1024);
    const total = convo.reduce((a, m) => a + estTokens(m), 0);
    if ((!force && total <= budget * 0.85) || convo.length < 4) return false;
    const reqIdx = convo.findLastIndex((m) => m._req);
    // Fase 1 (sin coste): acortar los resultados antiguos de herramientas del turno actual (se conservan los 2 últimos)
    const turnTools = convo.map((m, i) => (m.role === 'tool' && i > reqIdx ? i : -1)).filter((i) => i >= 0).slice(0, -2);
    let shortened = 0;
    for (const i of turnTools) {
      const m = convo[i];
      if (typeof m.content === 'string' && m.content.length > 900) { convo[i] = { ...m, content: `${truncate(m.content, 800)}\n[resultado antiguo acortado para ahorrar contexto]`, images: undefined }; shortened++; }
    }
    if (shortened && !force && convo.reduce((a, m) => a + estTokens(m), 0) <= budget * 0.85) return true;
    if (!force && convo.compactedLen && convo.length < convo.compactedLen + 4) return false;
    // Fase 2: resumir con el modelo lo anterior a la petición actual (la petición en curso nunca se resume)
    let keep = 0, cut = convo.length;
    while (cut > 2 && keep + estTokens(convo[cut - 1]) < budget * 0.35) { cut--; keep += estTokens(convo[cut]); }
    while (cut > 1 && convo[cut]?.role === 'tool') cut--; // no separar una llamada de su resultado
    if (reqIdx > 0) cut = Math.min(cut, reqIdx);
    if (cut <= 2) return shortened > 0;
    const head = convo.slice(1, cut);
    sink.status('compacting');
    let summary = '';
    try { summary = await this.summarize(resolved, head, signal); } catch (e) { if (signal.aborted) throw e; }
    if (!summary) return false;
    const text = `[Resumen automático de la conversación anterior (compactada para liberar contexto)]\n${summary}\n[Fin del resumen. Continúa la tarea desde aquí.]`;
    let tail = convo.slice(cut);
    if (tail[0]?.role === 'user') tail[0] = prependUser(text, tail[0]);
    else tail = [{ role: 'user', content: text }, ...tail];
    convo.splice(1, convo.length - 1, ...tail);
    convo.compactedLen = convo.length;
    // Persistir para los siguientes mensajes: el resumen cubre los mensajes del chat que quedaron enteros en la parte resumida
    if (chat) {
      const headCi = head.map((m) => m._ci).filter((x) => x !== undefined && x >= 0);
      const tailCi = tail.map((m) => m._ci).filter((x) => x !== undefined && x >= 0);
      if (headCi.length) {
        const upto = (tailCi.length ? Math.min(Math.max(...headCi) + 1, Math.min(...tailCi)) : Math.max(...headCi) + 1);
        if (upto > (chat.summary?.upto || 0)) chat.summary = { text: summary, upto, at: Date.now() };
      }
    }
    sink.notice(`Contexto compactado: resumí ${head.length} mensajes antiguos para seguir trabajando sin perder el hilo.`);
    return true;
  }

  // ───────── Puntos de restauración de archivos (deshacer cambios del agente) ─────────
  checkpointFile(chatId, messageId) { return path.join(dir('checkpoints'), chatId, `${messageId}.json`); }

  async checkpoint(chatId, messageId, filePath) {
    if (!chatId || !messageId || !filePath) return;
    const manPath = this.checkpointFile(chatId, messageId);
    let man = { files: [] };
    try { man = JSON.parse(fs.readFileSync(manPath, 'utf8')); } catch { }
    if (man.files.some((f) => f.path === filePath)) return;
    let existed = false, backup = null, isDir = false;
    try {
      const st = fs.statSync(filePath);
      existed = true;
      isDir = st.isDirectory();
      if (!isDir && st.size < 60e6) {
        backup = path.join(path.dirname(manPath), `${messageId}-${man.files.length}.bak`);
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        fs.copyFileSync(filePath, backup);
      }
    } catch { }
    if (isDir) return; // las carpetas no se guardan (las borradas van a la papelera)
    man.files.push({ path: filePath, existed, backup, at: Date.now() });
    fs.mkdirSync(path.dirname(manPath), { recursive: true });
    fs.writeFileSync(manPath, JSON.stringify(man));
    const run = this.runs.get(chatId);
    if (run?.message?.id === messageId) { run.message.checkpoint = man.files.length; this.emitMessage(chatId, run.message); }
  }

  /** Restaura los archivos tal como estaban antes de la respuesta indicada (y de todas las posteriores). */
  rewind(chatId, messageId) {
    const chat = getChat(chatId);
    if (!chat) throw new Error('Chat no encontrado');
    const idx = chat.messages.findIndex((m) => m.id === messageId);
    if (idx < 0) throw new Error('Mensaje no encontrado');
    const later = chat.messages.slice(idx).filter((m) => m.role === 'assistant');
    let restored = 0, removed = 0;
    for (const m of later.reverse()) {
      const manPath = this.checkpointFile(chatId, m.id);
      let man;
      try { man = JSON.parse(fs.readFileSync(manPath, 'utf8')); } catch { continue; }
      for (const f of man.files.slice().reverse()) {
        try {
          if (f.backup && fs.existsSync(f.backup)) { fs.mkdirSync(path.dirname(f.path), { recursive: true }); fs.copyFileSync(f.backup, f.path); restored++; }
          else if (!f.existed && fs.existsSync(f.path)) { fs.rmSync(f.path, { force: true }); removed++; }
        } catch { }
      }
      m.rewound = true;
      m.checkpoint = 0;
      try { fs.rmSync(manPath, { force: true }); } catch { }
    }
    saveChat(chat, true);
    for (const m of later) this.emitMessage(chatId, m, true);
    return { restored, removed };
  }

  // ───────── Hooks (comandos del usuario antes/después de las herramientas y al terminar) ─────────
  async runHooks(event, { tool, args, result, chat }) {
    const hooks = (this.getSettings().hooks || []).filter((h) => h && h.enabled !== false && h.event === event && h.command);
    const out = [];
    for (const h of hooks) {
      if (tool && h.match) { try { if (!new RegExp(h.match, 'i').test(tool)) continue; } catch { continue; } }
      const r = await execCommand(h.command, {
        cwd: this.workspaceFor(chat), timeout: Math.min(300, h.timeout || 30),
        env: { NEXO_EVENT: event, NEXO_TOOL: tool || '', NEXO_ARGS: JSON.stringify(args || {}).slice(0, 30000), NEXO_RESULT: String(result || '').slice(0, 30000), NEXO_CHAT_ID: chat?.id || '', NEXO_WORKSPACE: this.workspaceFor(chat) }
      });
      out.push({ hook: h, ...r });
    }
    return out;
  }

  emitMessage(chatId, message, force = false) {
    const now = Date.now();
    if (!force && message._lastEmit && now - message._lastEmit < 45) {
      if (!message._pending) { message._pending = setTimeout(() => { message._pending = null; this.emitMessage(chatId, message, true); }, 50); }
      return;
    }
    message._lastEmit = now;
    const { _lastEmit, _pending, ...clean } = message;
    this.emit('message', { chatId, message: clean });
  }

  isRunning(chatId) { return this.runs.has(chatId); }

  stop(chatId) {
    const r = this.runs.get(chatId);
    if (r) r.controller.abort();
  }

  /**
   * Bucle agente: modelo → herramientas → modelo... escribiendo en `sink.blocks`.
   */
  async agentLoop({ chatId, agent, ref, messages, sink, signal, depth = 0, stage, chat }) {
    const s = this.getSettings();
    const groups = chat?.toolsOverride || agent.tools || [];
    const toolCtx = {
      settings: this.getSettings, workspace: this.workspaceFor(chat), hardware: this.getHardware, webKeys: this.webKeys,
      askUser: this.askUser ? (q, sig) => this.askUser({ chatId, ...q }, sig) : null,
      agents: () => listAgents().filter((a) => a.id !== agent.id),
      delegate: depth < 2 && groups.includes('agents') ? (args, c) => this.delegate(args, { chatId, parentRef: ref, sink: c.sink, signal, depth, chat }) : null
    };
    const tools = s.toolsEnabled === false ? [] : allTools(toolCtx, groups, agent.mcpServers);
    const resolved = await this.resolveTarget(ref, (st) => { sink.status('loading-model'); });
    sink.setModel(resolved);
    const sys = { role: 'system', content: this.systemPrompt(agent, { toolsOn: tools.length > 0, stage, chat }) };
    let convo = [sys, ...messages];
    const reqAt = convo.findLastIndex((m) => m.role === 'user');
    if (reqAt > 0) convo[reqAt] = { ...convo[reqAt], _req: true };
    const mode = chat?.permissionMode || s.permissions?.mode || 'smart';
    const allowAlways = chat?.allowAlways || {};
    const maxSteps = agent.maxSteps || 30;
    const toolsSize = JSON.stringify(tools.map((t) => [t.name, t.description, t.parameters])).length;
    let finalText = '';
    let step = sink.nextStep();
    const repeats = new Map();
    let sweep = 0, lastSweep = null;
    let finished = false;
    if (resolved.localId) llama.acquire(resolved.localId);
    try {
      for (let iter = 0; iter < maxSteps; iter++) {
        if (signal.aborted) break;
        await this.compactIfNeeded({ convo, resolved, toolsSize, signal, sink, chat: depth === 0 ? chat : null });
        sink.status('thinking');
        let trimmed = this.trimToContext(convo, resolved.ctx || 8192, toolsSize).map(stripPrivate);
        const calls = [];
        let text = '';
        let reasoning = '';
        const thinkingBlocks = [];
        const t0 = Date.now();
        let firstToken = 0;
        const stream = () => streamChat(resolved.target, {
          messages: trimmed, tools, signal,
          temperature: chat?.temperature ?? agent.temperature,
          reasoningEffort: chat?.reasoningEffort || s.reasoningEffort,
          thinkingBudget: resolved.target.kind === 'anthropic' && (chat?.reasoningEffort || s.reasoningEffort) && !['none', 'auto', undefined].includes(chat?.reasoningEffort || s.reasoningEffort) ? { low: 2048, medium: 8000, high: 24000 }[chat?.reasoningEffort || s.reasoningEffort] : undefined
        });
        for (let attempt = 0; ; attempt++) {
          try {
            for await (const ev of stream()) {
              if (ev.type === 'text') { if (!firstToken) firstToken = Date.now(); text += ev.delta; sink.text(ev.delta, step); sink.status('writing'); }
              else if (ev.type === 'reasoning') { if (!firstToken) firstToken = Date.now(); reasoning += ev.delta; sink.reasoning(ev.delta, step); }
              else if (ev.type === 'tool_call') calls.push(ev);
              else if (ev.type === 'thinking_block') { thinkingBlocks.push(ev.block); sink.raw({ type: 'thinking_block', block: ev.block, step }); }
              else if (ev.type === 'usage') sink.usage(ev, { ms: Date.now() - t0, firstToken: firstToken ? firstToken - t0 : 0 });
              else if (ev.type === 'notice') sink.notice(ev.text);
            }
            break;
          } catch (e) {
            // Modelos sin visión (p. ej. algunos de OpenRouter) rechazan la petición entera si lleva imágenes:
            // se repite una vez sin imágenes en lugar de fallar.
            const noVision = /image input|support(s)? images?|vision|image_url|multimodal/i.test(e.message || '');
            if (attempt === 0 && noVision && resolved.target.vision !== false && !text && !calls.length && !signal.aborted) {
              resolved.target.vision = false;
              sink.notice('Este modelo no admite imágenes; continúo sin enviarle capturas ni imágenes.');
              continue;
            }
            // Contexto desbordado (la estimación se quedó corta): compactar a la fuerza y reintentar una vez
            if (attempt === 0 && CONTEXT_OVERFLOW.test(e.message || '') && !text && !calls.length && !signal.aborted) {
              sink.notice('La conversación no cabía en el contexto del modelo; la compacto y reintento.');
              const compacted = await this.compactIfNeeded({ convo, resolved, toolsSize, signal, sink, chat: depth === 0 ? chat : null, force: true });
              if (!compacted) for (const m of convo) if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > 2000) m.content = truncate(m.content, 2000);
              trimmed = this.trimToContext(convo, Math.floor((resolved.ctx || 8192) * 0.75), toolsSize).map(stripPrivate);
              sink.status('thinking');
              continue;
            }
            throw e;
          }
        }
        finalText = text || finalText;
        if (!calls.length || signal.aborted) { finished = true; break; }
        convo.push({ role: 'assistant', content: text, tool_calls: calls.map((c) => ({ id: c.id, name: c.name, arguments: c.arguments })), thinking_blocks: thinkingBlocks, reasoning_content: reasoning || undefined });
        sink.status('tools');
        const budgetTok = Math.max(2048, (resolved.ctx || 8192) * 0.8 - toolsSize / CHARS_PER_TOKEN - 1024);
        const results = await this.runToolCalls({ calls, tools, sink, step, signal, mode, allowAlways, chatId, chat, resultCap: Math.max(3000, Math.floor(budgetTok * 0.3 * CHARS_PER_TOKEN)) });
        // Detector de bucles: la misma llamada con los mismos argumentos una y otra vez (típico de modelos locales)
        let loopy = 0;
        for (const c of calls) { const k = callKey(c); const n = (repeats.get(k) || 0) + 1; repeats.set(k, n); loopy = Math.max(loopy, n); }
        // Barridos: la misma herramienta sobre el mismo objetivo en pasos seguidos, cambiando solo la posición
        const sk = calls.length === 1 ? sweepKey(calls[0]) : null;
        sweep = sk && sk === lastSweep ? sweep + 1 : 1; lastSweep = sk;
        if (sweep >= 8 && loopy < 3) {
          const lastRes = results[results.length - 1];
          if (lastRes) lastRes.content += `\n\n[Aviso de Nexo: llevas ${sweep} pasos seguidos con ${calls[0].name} sobre lo mismo cambiando solo la posición. Pide de una vez el rango que necesitas (o usa search_files para encontrar el dato) y responde al usuario.]`;
          if (sweep >= 14) { convo.push(...results); sink.notice('Detuve un barrido repetitivo: el modelo avanzaba de poco en poco sin terminar.'); step = sink.nextStep(); finished = await this.finalAnswer({ convo, resolved, sink, signal, step, agent, chat }); break; }
        }
        if (loopy >= 3) {
          const last = results[results.length - 1];
          if (last) last.content += `\n\n[Aviso de Nexo: ya has hecho esta misma llamada ${loopy} veces con los mismos argumentos y el resultado no cambia. No la repitas: usa la información que ya tienes, cambia de estrategia (p. ej. offset/limit o search_files) o responde al usuario.]`;
          if (loopy >= 5) { convo.push(...results); sink.notice('Detuve un bucle: el modelo repetía la misma acción sin avanzar.'); step = sink.nextStep(); finished = await this.finalAnswer({ convo, resolved, sink, signal, step, agent, chat }); break; }
        }
        convo.push(...results);
        step = sink.nextStep();
      }
      if (!finished && !signal.aborted) {
        sink.notice(`Se alcanzó el límite de ${maxSteps} pasos de este agente; resumo lo hecho hasta ahora.`);
        step = sink.nextStep();
        await this.finalAnswer({ convo, resolved, sink, signal, step, agent, chat });
      }
    } finally {
      if (resolved.localId) llama.release(resolved.localId);
    }
    finalText = finalText || sink.blocks.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    if (depth === 0 && !signal.aborted) {
      const hk = await this.runHooks('stop', { chat, result: finalText }).catch(() => []);
      for (const h of hk) if ((h.out || h.err).trim()) sink.notice(`Hook al terminar: ${truncate((h.out || h.err).trim(), 400)}`);
    }
    return { text: finalText, label: resolved.label, ref: resolved.ref };
  }

  /** Pide al modelo una respuesta final sin herramientas (resumen de lo hecho y lo que falta). */
  async finalAnswer({ convo, resolved, sink, signal, step, agent, chat }) {
    const msgs = this.trimToContext([...convo, { role: 'user', content: '[Nexo] No uses más herramientas. Responde ya al usuario: qué has hecho, qué resultados tienes y qué falta (si falta algo).' }], resolved.ctx || 8192, 0).map(stripPrivate);
    try {
      for await (const ev of streamChat(resolved.target, { messages: msgs, tools: [], signal, temperature: chat?.temperature ?? agent.temperature })) {
        if (ev.type === 'text') { sink.text(ev.delta, step); sink.status('writing'); }
      }
      return true;
    } catch (e) { if (!signal.aborted) sink.notice(`No se pudo obtener la respuesta final: ${e.message}`); return false; }
  }

  async runToolCalls({ calls, tools, sink, step, signal, mode, allowAlways, chatId, chat, resultCap = 20000 }) {
    const exec = async (call) => {
      const tool = tools.find((t) => t.name === call.name);
      const block = sink.tool({ id: call.id, name: call.name, args: call.arguments, status: 'running', step, risk: tool?.risk, group: tool?.group, server: tool?.server, startedAt: Date.now() });
      if (!tool) { block.status = 'error'; block.error = `Herramienta desconocida: ${call.name}`; sink.update(); return { role: 'tool', tool_call_id: call.id, name: call.name, content: block.error, isError: true }; }
      if (needsApproval(tool, mode, allowAlways)) {
        block.status = 'awaiting'; sink.update();
        const decision = await this.requestApproval({ chatId, tool: tool.name, group: tool.group, risk: tool.risk, args: call.arguments, description: tool.description, server: tool.server });
        if (decision === 'always') { allowAlways[tool.name] = true; if (chat) { chat.allowAlways = allowAlways; } }
        if (decision === 'deny' || signal.aborted) {
          block.status = 'denied'; sink.update();
          return { role: 'tool', tool_call_id: call.id, name: call.name, content: 'El usuario denegó esta acción. No la repitas; pregunta o propone una alternativa.' };
        }
        block.status = 'running'; sink.update();
      }
      // hook "antes de herramienta": salir con código 2 bloquea la acción y el motivo se le pasa al modelo
      const pre = await this.runHooks('before_tool', { tool: tool.name, args: call.arguments, chat }).catch(() => []);
      const blocked = pre.find((h) => h.code === 2);
      if (blocked) {
        const why = (blocked.err || blocked.out || 'sin motivo').trim();
        block.status = 'denied'; block.error = `Bloqueado por un hook: ${why}`; block.endedAt = Date.now(); sink.update();
        return { role: 'tool', tool_call_id: call.id, name: call.name, content: `Acción bloqueada por un hook del usuario: ${why}`, isError: true };
      }
      const messageId = this.runs.get(chatId)?.message?.id;
      try {
        const res = await tool.run(call.arguments || {}, { signal, sink: block, maxChars: resultCap, emitPlan: (items) => sink.plan(items), onComputerUse: () => this.emit('computer-use', { chatId }), checkpoint: (p) => this.checkpoint(chatId, messageId, p) });
        let text = typeof res === 'string' ? res : (res?.text ?? JSON.stringify(res));
        const post = await this.runHooks('after_tool', { tool: tool.name, args: call.arguments, result: text, chat }).catch(() => []);
        for (const h of post) if (h.out.trim()) text += `\n\n[hook] ${truncate(h.out.trim(), 4000)}`;
        // Un solo resultado no puede comerse el contexto: máx. ~30% del espacio libre del modelo
        const cap = resultCap;
        if (text.length > cap) {
          const tail = Math.min(800, Math.floor(cap * 0.2));
          text = `${text.slice(0, cap - tail)}\n\n[… ${text.length - cap} caracteres omitidos porque no caben en el contexto del modelo. Pide la parte que necesites (read_file con offset/limit, search_files con un patrón, o filtra la salida del comando) …]\n\n${text.slice(-tail)}`;
        }
        const images = typeof res === 'object' && res?.images ? res.images : [];
        block.result = truncate(text, 60000);
        block.status = res?.isError ? 'error' : 'done';
        if (res?.isError) block.error = truncate(text, 500);
        block.images = images.map((im) => ({ file: saveAttachment(chatId, { name: `tool.${im.mime.includes('png') ? 'png' : 'jpg'}`, data: im.data, mime: im.mime }), mime: im.mime }));
        block.endedAt = Date.now();
        sink.update();
        return { role: 'tool', tool_call_id: call.id, name: call.name, content: block.result, images, isError: !!res?.isError };
      } catch (e) {
        block.status = 'error'; block.error = e.message || String(e); block.endedAt = Date.now();
        sink.update();
        return { role: 'tool', tool_call_id: call.id, name: call.name, content: `Error: ${block.error}`, isError: true };
      }
    };
    // Las delegaciones pueden ejecutarse en paralelo si los modelos caben a la vez
    const delegations = calls.filter((c) => c.name === 'delegate_task');
    const others = calls.filter((c) => c.name !== 'delegate_task');
    const results = [];
    for (const c of others) { if (signal.aborted) break; results.push(await exec(c)); }
    if (delegations.length) {
      const parallel = delegations.length > 1 && await this.canRunConcurrently(delegations.map((d) => d.arguments?.model || getAgent(d.arguments?.agent)?.model || null));
      if (parallel) results.push(...await Promise.all(delegations.map(exec)));
      else for (const c of delegations) { if (signal.aborted) break; results.push(await exec(c)); }
    }
    // mantener el orden original de llamadas
    return calls.map((c) => results.find((r) => r.tool_call_id === c.id)).filter(Boolean);
  }

  async canRunConcurrently(refs) {
    const locals = await this.localModels();
    const items = [];
    for (const r of refs) {
      if (!r || !r.startsWith('local:')) continue;
      const m = locals.find((x) => `local:${x.id}` === r);
      if (m && !items.find((i) => i.id === m.id)) items.push({ id: m.id, meta: m.meta, fileSize: m.size, ctx: m.settings?.ctx || this.getSettings().ctx || 8192 });
    }
    if (items.length <= 1) return true;
    const hw = await this.getHardware();
    return planMulti(items, staticBudget(hw)).fitsAll;
  }

  async delegate({ agent: agentId, task, model }, { chatId, parentRef, sink, signal, depth, chat }) {
    const agent = getAgent(agentId);
    const ref = model || agent.model || parentRef;
    const sub = { agentId: agent.id, agentName: agent.name, ref, task, blocks: [], status: 'running' };
    sink.sub = sub;
    const subSink = this.makeSink(sub.blocks, () => this.emitCurrent(chatId), { onModel: (r) => { sub.modelLabel = r.label; } });
    try {
      if (agent.runner === 'opencode') {
        const text = await this.openCodeTurn({ chat, prompt: task, sink: subSink, signal, useSession: false, modelOverride: model && !model.includes(':') ? model : undefined });
        sub.status = 'done';
        return `Resultado de OpenCode:\n\n${text || '(sin texto)'}`;
      }
      const r = await this.agentLoop({ chatId, agent, ref, messages: [{ role: 'user', content: task }], sink: subSink, signal, depth: depth + 1, chat });
      sub.status = 'done';
      return `Resultado de ${agent.name} (${r.label}):\n\n${r.text || '(sin texto)'}`;
    } catch (e) {
      sub.status = 'error'; sub.error = e.message;
      throw e;
    } finally { this.emitCurrent(chatId); }
  }

  emitCurrent(chatId) {
    const r = this.runs.get(chatId);
    if (r?.message) this.emitMessage(chatId, r.message);
  }

  makeSink(blocks, onChange, { onModel, onUsage, onStatus } = {}) {
    let step = -1;
    const last = () => blocks[blocks.length - 1];
    const sink = {
      blocks,
      nextStep: () => ++step,
      text: (d, st) => { const b = last(); if (b && b.type === 'text' && b.step === st) b.text += d; else blocks.push({ type: 'text', text: d, step: st }); onChange(); },
      reasoning: (d, st) => { const b = last(); if (b && b.type === 'reasoning' && b.step === st) b.text += d; else blocks.push({ type: 'reasoning', text: d, step: st, startedAt: Date.now() }); onChange(); },
      tool: (b) => { blocks.push({ type: 'tool', ...b }); onChange(); return blocks[blocks.length - 1]; },
      raw: (b) => { blocks.push(b); },
      plan: (items) => { const p = blocks.find((b) => b.type === 'plan'); if (p) p.items = items; else blocks.push({ type: 'plan', items }); onChange(); },
      notice: (text) => { blocks.push({ type: 'notice', text }); onChange(); },
      stage: (label, extra) => { blocks.push({ type: 'stage', label, ...extra }); onChange(); },
      update: () => onChange(),
      status: (s) => { onStatus?.(s); onChange(); },
      setModel: (r) => { onModel?.(r); onChange(); },
      usage: (u, t) => { onUsage?.(u, t); }
    };
    return sink;
  }

  /** Envía un mensaje del usuario y genera la respuesta según el modo del chat. */
  async send(chatId, { text, attachments = [], regenerateFrom } = {}) {
    const chat = getChat(chatId);
    if (!chat) throw new Error('Chat no encontrado');
    if (this.runs.has(chatId)) throw new Error('Ya hay una respuesta en curso en este chat');
    if (regenerateFrom !== undefined) {
      chat.messages = chat.messages.slice(0, regenerateFrom);
      if (chat.summary && chat.summary.upto > chat.messages.length - 1) delete chat.summary;
    } else {
      const saved = attachments.map((a) => {
        if (a.kind === 'image' && a.data) return { kind: 'image', name: a.name, mime: a.mime, file: saveAttachment(chatId, a) };
        if (a.kind === 'text') return { kind: 'text', name: a.name, text: a.text, size: a.size };
        return { kind: 'file', name: a.name, path: a.path, size: a.size };
      });
      chat.messages.push({ id: uid('m_'), role: 'user', content: text || '', attachments: saved, createdAt: Date.now() });
      if (chat.title === 'Nuevo chat' && text) chat.title = text.replace(/\s+/g, ' ').trim().slice(0, 60) + (text.length > 60 ? '…' : '');
    }
    const agent = getAgent(chat.agentId);
    const message = { id: uid('m_'), role: 'assistant', agentId: agent.id, agentName: agent.name, createdAt: Date.now(), status: 'starting' };
    chat.messages.push(message);
    saveChat(chat);
    this.emit('chat-meta', { chatId, title: chat.title });
    const controller = new AbortController();
    this.runs.set(chatId, { controller, message });
    this.emitMessage(chatId, message, true);
    const t0 = Date.now();
    try {
      const history = this.historyToMessages(chat, { uptoIndex: chat.messages.length - 1 });
      if (agent.runner === 'opencode') await this.runOpenCode({ chat, agent, message, controller });
      else if (chat.mode === 'compare' && chat.compareModels?.length > 1) await this.runCompare({ chat, agent, message, history, controller });
      else if (chat.mode === 'pipeline' && chat.pipeline?.length) await this.runPipeline({ chat, agent, message, history, controller });
      else await this.runSingle({ chat, agent, message, history, controller });
      message.status = controller.signal.aborted ? 'stopped' : 'done';
    } catch (e) {
      if (controller.signal.aborted || e.name === 'AbortError') message.status = 'stopped';
      else { message.status = 'error'; message.error = e.message || String(e); }
    } finally {
      message.durationMs = Date.now() - t0;
      this.runs.delete(chatId);
      if (message._pending) { clearTimeout(message._pending); message._pending = null; }
      delete message._lastEmit;
      saveChat(chat, true);
      this.emitMessage(chatId, message, true);
      this.emit('run-end', { chatId, message });
    }
    return message;
  }

  async runSingle({ chat, agent, message, history, controller }) {
    message.blocks = [];
    const ref = chat.model || agent.model || null;
    const sink = this.makeSink(message.blocks, () => this.emitMessage(chat.id, message), {
      onModel: (r) => { message.model = r.ref; message.modelName = r.label; },
      onUsage: (u, t) => { message.usage = accumulateUsage(message.usage, u, t); },
      onStatus: (s) => { message.status = s; }
    });
    await this.agentLoop({ chatId: chat.id, agent, ref, messages: history, sink, signal: controller.signal, chat });
  }

  /** Envía el mensaje del usuario a OpenCode (terminal) y muestra sus pasos en el chat. */
  async runOpenCode({ chat, message, controller }) {
    message.blocks = [];
    const sink = this.makeSink(message.blocks, () => this.emitMessage(chat.id, message), {
      onModel: (r) => { message.model = r.ref; message.modelName = r.label; },
      onUsage: (u) => { message.usage = accumulateUsage(message.usage, u, { ms: 0 }); }, onStatus: (st) => { message.status = st; }
    });
    const user = chat.messages[chat.messages.length - 2];
    let prompt = user?.content || '';
    const files = [];
    for (const a of user?.attachments || []) {
      if (a.kind === 'image' && a.file) files.push(a.file);
      else if (a.kind === 'text') prompt += `\n\n--- ${a.name} ---\n${truncate(a.text || '', 60000)}`;
      else if (a.path) files.push(a.path);
    }
    await this.openCodeTurn({ chat, prompt, files, sink, signal: controller.signal, useSession: true });
  }

  /**
   * Un turno de OpenCode. Modelo: cualquiera de OpenCode (nube o proveedores propios), el elegido en
   * Ajustes, o el modelo LOCAL de Nexo ("nexo:local", que se le pasa como proveedor compatible con OpenAI).
   */
  async openCodeTurn({ chat, prompt, files = [], sink, signal, useSession = true, modelOverride }) {
    const s = this.getSettings();
    const oc = s.opencode || {};
    const choice = modelOverride ?? chat?.opencodeModel ?? oc.model ?? '';
    let model = choice || undefined, local = null, localId = null;
    if (choice === 'nexo:local') {
      const ref = chat?.model || s.defaultModel || await this.defaultModelRef();
      if (!ref?.startsWith('local:')) throw new Error('Para usar el modelo de Nexo con OpenCode elige un modelo LOCAL en el selector de modelos del chat.');
      sink.status('loading-model');
      const r = await this.resolveTarget(ref);
      local = { baseUrl: r.target.baseUrl, model: 'local', label: r.label, ctx: r.ctx };
      model = 'nexo/local';
      localId = r.localId;
      llama.acquire(localId);
    }
    // "Predeterminado" = lo mismo que tienes elegido en OpenCode (último modelo usado y su nivel de pensamiento)
    const ocState = opencode.readState();
    if (!model && ocState.last) model = ocState.last;
    const chosen = chat?.opencodeVariant;
    const variant = choice === 'nexo:local' ? null : (chosen && chosen !== 'auto' ? chosen : (model ? ocState.variants[model] || null : null));
    sink.setModel({ ref: `opencode:${model || 'predeterminado'}`, label: `OpenCode · ${choice === 'nexo:local' ? `${local.label} (local de Nexo)` : (model || 'modelo predeterminado de OpenCode')}${variant ? ` · ${variant}` : ''}` });
    sink.status('thinking');
    const mode = chat?.permissionMode || s.permissions?.mode || 'smart';
    const steps = new Map();
    const stepOf = (id) => { const k = id || '_'; if (!steps.has(k)) steps.set(k, sink.nextStep()); return steps.get(k); };
    const toolBlocks = new Map();
    try {
      const r = await opencode.runPrompt({
        prompt, files, model, variant, local, custom: oc.path, rea: oc.rea === true,
        sessionId: useSession ? chat?.opencodeSession || undefined : undefined,
        dir: this.workspaceFor(chat),
        auto: mode === 'full' || oc.autoApprove === true,
        signal,
        onEvent: (ev) => {
          if (ev.type === 'session') { if (useSession && chat) chat.opencodeSession = ev.id; }
          else if (ev.type === 'text') { sink.text(ev.delta, stepOf(ev.step)); sink.status('writing'); }
          else if (ev.type === 'reasoning') sink.reasoning(ev.delta, stepOf(ev.step));
          else if (ev.type === 'tool') {
            const status = ev.status === 'completed' ? 'done' : ev.status === 'error' ? 'error' : 'running';
            const result = typeof ev.output === 'string' ? ev.output : ev.output ? JSON.stringify(ev.output, null, 2) : '';
            let b = toolBlocks.get(ev.id);
            if (!b) { b = sink.tool({ id: ev.id, name: `oc:${ev.name}`, args: ev.input || {}, status, step: stepOf(ev.step), group: 'opencode', startedAt: ev.time?.start || Date.now() }); toolBlocks.set(ev.id, b); }
            Object.assign(b, { status, args: ev.input || b.args, result: truncate(result, 60000), error: ev.error ? String(ev.error) : undefined, title: ev.title, endedAt: ev.time?.end });
            sink.status('tools');
            sink.update();
          } else if (ev.type === 'usage') sink.usage({ input: ev.input, output: ev.output }, { ms: 0 });
        }
      });
      if (useSession && chat && r.session) chat.opencodeSession = r.session;
      return r.text;
    } finally {
      if (localId) llama.release(localId);
    }
  }

  async runCompare({ chat, agent, message, history, controller }) {
    message.variants = chat.compareModels.map((ref) => ({ ref, blocks: [], status: 'waiting' }));
    const runOne = async (v, i) => {
      v.status = 'starting';
      const sink = this.makeSink(v.blocks, () => this.emitMessage(chat.id, message), {
        onModel: (r) => { v.modelName = r.label; }, onUsage: (u, t) => { v.usage = accumulateUsage(v.usage, u, t); }, onStatus: (s) => { v.status = s; }
      });
      try {
        await this.agentLoop({ chatId: chat.id, agent, ref: v.ref, messages: this.historyToMessages(chat, { variant: i, uptoIndex: chat.messages.length - 1 }), sink, signal: controller.signal, chat });
        v.status = 'done';
      } catch (e) { v.status = 'error'; v.error = e.message; }
      this.emitMessage(chat.id, message);
    };
    const concurrent = await this.canRunConcurrently(chat.compareModels);
    message.strategy = concurrent ? 'concurrent' : 'sequential';
    if (concurrent) await Promise.all(message.variants.map(runOne));
    else for (let i = 0; i < message.variants.length; i++) { if (controller.signal.aborted) break; await runOne(message.variants[i], i); }
  }

  async runPipeline({ chat, agent, message, history, controller }) {
    message.blocks = [];
    const stages = chat.pipeline;
    const sink = this.makeSink(message.blocks, () => this.emitMessage(chat.id, message), {
      onUsage: (u, t) => { message.usage = accumulateUsage(message.usage, u, t); }, onStatus: (s) => { message.status = s; }
    });
    let previous = '';
    const userTask = history[history.length - 1];
    for (let i = 0; i < stages.length; i++) {
      if (controller.signal.aborted) break;
      const st = stages[i];
      const stAgent = st.agentId ? getAgent(st.agentId) : agent;
      const ref = st.model || chat.model || stAgent.model;
      sink.stage(st.label || `Etapa ${i + 1}`, { index: i, total: stages.length, ref, modelName: await this.modelLabel(ref), agentName: stAgent.name });
      const msgs = [...history.slice(0, -1)];
      const taskText = typeof userTask.content === 'string' ? userTask.content : userTask.content.find((c) => c.type === 'text')?.text || '';
      const content = i === 0 ? userTask.content : `Tarea original del usuario:\n${taskText}\n\nResultado de la etapa anterior:\n${previous}`;
      msgs.push({ role: 'user', content });
      const r = await this.agentLoop({ chatId: chat.id, agent: stAgent, ref, messages: msgs, sink, signal: controller.signal, stage: { index: i, total: stages.length, label: st.label || `Etapa ${i + 1}`, instruction: st.instruction }, chat });
      previous = r.text;
      message.modelName = stages.length + ' modelos';
    }
  }
}

function accumulateUsage(prev = {}, u, t) {
  const raw = u.tps || (u.output && t.ms ? u.output / ((t.ms - (t.firstToken || 0)) / 1000) : prev.tps);
  return {
    input: (prev.input || 0) + (u.input || 0),
    output: (prev.output || 0) + (u.output || 0),
    tps: raw ? Math.round(raw * 10) / 10 : undefined,
    firstToken: prev.firstToken || t.firstToken
  };
}
