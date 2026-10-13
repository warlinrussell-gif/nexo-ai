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
import { allTools, needsApproval } from './tools.js';
import { dir } from './paths.js';
import { uid, truncate } from './util.js';
import { planMulti, staticBudget } from '../shared/fit.js';

const MAX_IMAGES_IN_HISTORY = 3;

export class Engine extends EventEmitter {
  constructor({ getSettings, getHardware, requestApproval, webKeys }) {
    super();
    this.getSettings = getSettings;
    this.getHardware = getHardware;
    this.requestApproval = requestApproval;
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

  systemPrompt(agent, { toolsOn, stage } = {}) {
    const s = this.getSettings();
    const now = new Date();
    let sp = agent.systemPrompt || '';
    sp += `\n\n## Entorno\n- Fecha y hora: ${now.toLocaleString('es-ES', { dateStyle: 'full', timeStyle: 'short' })} (${Intl.DateTimeFormat().resolvedOptions().timeZone})\n- Sistema: ${os.type()} ${os.release()} · Usuario: ${os.userInfo().username} · Carpeta personal: ${os.homedir()}\n- Directorio de trabajo por defecto: ${s.workspace || dir('workspace')}\n- Idioma: responde en el idioma del usuario (por defecto, español).`;
    if (toolsOn) sp += `\n\n## Uso de herramientas\n- Tienes herramientas REALES que actúan sobre el ordenador del usuario. Úsalas directamente en lugar de explicar cómo hacerlo, salvo que te pidan solo explicación.\n- Encadena varias herramientas si hace falta; si una falla, lee el error y prueba otra vía.\n- Para tareas de 3 o más pasos, muestra un plan con update_plan y actualízalo.\n- No inventes resultados: básate en lo que devuelven las herramientas.`;
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
    const list = uptoIndex !== undefined ? chat.messages.slice(0, uptoIndex) : chat.messages;
    for (const m of list) {
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
          const text = bs.filter((b) => b.type === 'text').map((b) => b.text).join('');
          const tools = bs.filter((b) => b.type === 'tool');
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
    const est = (m) => {
      let n = 0;
      if (typeof m.content === 'string') n += m.content.length;
      else if (Array.isArray(m.content)) for (const c of m.content) n += c.type === 'text' ? c.text.length : 3000;
      n += (m.images?.length || 0) * 3000;
      n += JSON.stringify(m.tool_calls || []).length;
      return n / 3.2;
    };
    const budget = Math.max(2048, ctx * 0.8 - toolsSize / 3.2 - 1024);
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
    if (out[1]?.role === 'assistant') out.splice(1, 0, { role: 'user', content: '(conversación anterior resumida por límite de contexto)' });
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
      settings: this.getSettings, workspace: s.workspace || dir('workspace'), hardware: this.getHardware, webKeys: this.webKeys,
      agents: () => listAgents().filter((a) => a.id !== agent.id),
      delegate: depth < 2 && groups.includes('agents') ? (args, c) => this.delegate(args, { chatId, parentRef: ref, sink: c.sink, signal, depth, chat }) : null
    };
    const tools = s.toolsEnabled === false ? [] : allTools(toolCtx, groups, agent.mcpServers);
    const resolved = await this.resolveTarget(ref, (st) => { sink.status('loading-model'); });
    sink.setModel(resolved);
    const sys = { role: 'system', content: this.systemPrompt(agent, { toolsOn: tools.length > 0, stage }) };
    let convo = [sys, ...messages];
    const mode = chat?.permissionMode || s.permissions?.mode || 'smart';
    const allowAlways = chat?.allowAlways || {};
    const maxSteps = agent.maxSteps || 30;
    const toolsSize = JSON.stringify(tools.map((t) => [t.name, t.description, t.parameters])).length;
    let finalText = '';
    let step = sink.nextStep();
    if (resolved.localId) llama.acquire(resolved.localId);
    try {
      for (let iter = 0; iter < maxSteps; iter++) {
        if (signal.aborted) break;
        sink.status('thinking');
        const trimmed = this.trimToContext(convo, resolved.ctx || 8192, toolsSize);
        const calls = [];
        let text = '';
        let reasoning = '';
        const thinkingBlocks = [];
        const t0 = Date.now();
        let firstToken = 0;
        for await (const ev of streamChat(resolved.target, {
          messages: trimmed, tools, signal,
          temperature: chat?.temperature ?? agent.temperature,
          reasoningEffort: chat?.reasoningEffort || s.reasoningEffort,
          thinkingBudget: resolved.target.kind === 'anthropic' && (chat?.reasoningEffort || s.reasoningEffort) && !['none', 'auto', undefined].includes(chat?.reasoningEffort || s.reasoningEffort) ? { low: 2048, medium: 8000, high: 24000 }[chat?.reasoningEffort || s.reasoningEffort] : undefined
        })) {
          if (ev.type === 'text') { if (!firstToken) firstToken = Date.now(); text += ev.delta; sink.text(ev.delta, step); sink.status('writing'); }
          else if (ev.type === 'reasoning') { if (!firstToken) firstToken = Date.now(); reasoning += ev.delta; sink.reasoning(ev.delta, step); }
          else if (ev.type === 'tool_call') calls.push(ev);
          else if (ev.type === 'thinking_block') { thinkingBlocks.push(ev.block); sink.raw({ type: 'thinking_block', block: ev.block, step }); }
          else if (ev.type === 'usage') sink.usage(ev, { ms: Date.now() - t0, firstToken: firstToken ? firstToken - t0 : 0 });
          else if (ev.type === 'notice') sink.notice(ev.text);
        }
        finalText = text || finalText;
        if (!calls.length || signal.aborted) break;
        convo.push({ role: 'assistant', content: text, tool_calls: calls.map((c) => ({ id: c.id, name: c.name, arguments: c.arguments })), thinking_blocks: thinkingBlocks, reasoning_content: reasoning || undefined });
        sink.status('tools');
        const results = await this.runToolCalls({ calls, tools, sink, step, signal, mode, allowAlways, chatId, chat });
        convo.push(...results);
        step = sink.nextStep();
      }
    } finally {
      if (resolved.localId) llama.release(resolved.localId);
    }
    return { text: finalText, label: resolved.label, ref: resolved.ref };
  }

  async runToolCalls({ calls, tools, sink, step, signal, mode, allowAlways, chatId, chat }) {
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
      try {
        const res = await tool.run(call.arguments || {}, { signal, sink: block, emitPlan: (items) => sink.plan(items), onComputerUse: () => this.emit('computer-use', { chatId }) });
        const text = typeof res === 'string' ? res : (res?.text ?? JSON.stringify(res));
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
      if (chat.mode === 'compare' && chat.compareModels?.length > 1) await this.runCompare({ chat, agent, message, history, controller });
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
