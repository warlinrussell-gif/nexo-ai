// Proveedores unificados: modelos locales (llama.cpp), Ollama, LM Studio y APIs
// (OpenAI, Anthropic, Gemini, OpenRouter, Groq, DeepSeek, Mistral, xAI, Together, Fireworks, Cerebras, personalizados).
import { load, save, encrypt, decrypt } from './store.js';
import { uid } from './util.js';

export const PROVIDER_TYPES = {
  openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', kind: 'openai', keyUrl: 'https://platform.openai.com/api-keys', suggested: ['gpt-5', 'gpt-5-mini', 'gpt-4.1', 'gpt-4o', 'o4-mini'] },
  anthropic: { name: 'Anthropic (Claude)', baseUrl: 'https://api.anthropic.com', kind: 'anthropic', keyUrl: 'https://console.anthropic.com/settings/keys', suggested: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'] },
  gemini: { name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', kind: 'openai', keyUrl: 'https://aistudio.google.com/apikey', suggested: ['gemini-2.5-pro', 'gemini-2.5-flash'] },
  openrouter: { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', kind: 'openai', keyUrl: 'https://openrouter.ai/keys', suggested: [] },
  groq: { name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', kind: 'openai', keyUrl: 'https://console.groq.com/keys', suggested: [] },
  deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', kind: 'openai', keyUrl: 'https://platform.deepseek.com/api_keys', suggested: ['deepseek-chat', 'deepseek-reasoner'] },
  mistral: { name: 'Mistral AI', baseUrl: 'https://api.mistral.ai/v1', kind: 'openai', keyUrl: 'https://console.mistral.ai/api-keys', suggested: [] },
  xai: { name: 'xAI (Grok)', baseUrl: 'https://api.x.ai/v1', kind: 'openai', keyUrl: 'https://console.x.ai', suggested: [] },
  together: { name: 'Together AI', baseUrl: 'https://api.together.xyz/v1', kind: 'openai', keyUrl: 'https://api.together.ai/settings/api-keys', suggested: [] },
  fireworks: { name: 'Fireworks AI', baseUrl: 'https://api.fireworks.ai/inference/v1', kind: 'openai', keyUrl: 'https://fireworks.ai/account/api-keys', suggested: [] },
  cerebras: { name: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1', kind: 'openai', keyUrl: 'https://cloud.cerebras.ai', suggested: [] },
  ollama: { name: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', kind: 'openai', noKey: true, local: true, suggested: [] },
  lmstudio: { name: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1', kind: 'openai', noKey: true, local: true, suggested: [] },
  custom: { name: 'Personalizado (compatible OpenAI)', baseUrl: 'http://127.0.0.1:8000/v1', kind: 'openai', suggested: [] }
};

function state() { return load('providers', { list: [] }); }

export function listProviders({ withKeys = false } = {}) {
  return state().list.map((p) => ({ ...p, apiKey: withKeys ? decrypt(p.apiKey) : undefined, hasKey: !!p.apiKey, kind: PROVIDER_TYPES[p.type]?.kind || 'openai' }));
}

export function getProvider(id) {
  const p = state().list.find((x) => x.id === id);
  if (!p) return null;
  return { ...p, apiKey: decrypt(p.apiKey), kind: PROVIDER_TYPES[p.type]?.kind || 'openai' };
}

export function upsertProvider(data) {
  const st = state();
  let p = data.id ? st.list.find((x) => x.id === data.id) : null;
  if (!p) {
    const t = PROVIDER_TYPES[data.type] || PROVIDER_TYPES.custom;
    p = { id: data.id || (data.type === 'custom' ? uid('prov_') : data.type), type: data.type, name: data.name || t.name, baseUrl: data.baseUrl || t.baseUrl, enabled: true, models: [], customModels: [], apiKey: '' };
    if (st.list.find((x) => x.id === p.id)) p.id = uid(p.type + '_');
    st.list.push(p);
  }
  for (const k of ['name', 'baseUrl', 'enabled', 'customModels', 'models', 'hiddenModels']) if (data[k] !== undefined) p[k] = data[k];
  if (data.apiKey !== undefined && data.apiKey !== '••••••••') p.apiKey = encrypt(data.apiKey);
  save('providers', st, true);
  return { ...p, apiKey: undefined, hasKey: !!p.apiKey };
}

export function removeProvider(id) {
  const st = state();
  st.list = st.list.filter((p) => p.id !== id);
  save('providers', st, true);
}

function authHeaders(p) {
  if (p.kind === 'anthropic') return { 'x-api-key': p.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
  const h = {};
  if (p.apiKey) h.Authorization = `Bearer ${p.apiKey}`;
  if (p.type === 'openrouter') { h['HTTP-Referer'] = 'https://nexo.ai'; h['X-Title'] = 'Nexo AI'; }
  return h;
}

export async function fetchModels(id) {
  const p = getProvider(id);
  if (!p) throw new Error('Proveedor no encontrado');
  let models = [];
  if (p.kind === 'anthropic') {
    const r = await fetch(`${p.baseUrl.replace(/\/$/, '')}/v1/models?limit=100`, { headers: authHeaders(p) });
    if (!r.ok) throw new Error(`Error ${r.status}: ${(await r.text()).slice(0, 200)}`);
    models = (await r.json()).data.map((m) => ({ id: m.id, name: m.display_name || m.id }));
  } else {
    const r = await fetch(`${p.baseUrl.replace(/\/$/, '')}/models`, { headers: authHeaders(p) });
    if (!r.ok) throw new Error(`Error ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    models = (j.data || j.models || []).map((m) => ({ id: (m.id || m.name || '').replace(/^models\//, ''), name: m.name && m.name !== m.id ? m.name : (m.id || '').replace(/^models\//, ''), ctx: m.context_length }));
    models = models.filter((m) => m.id && !/embedding|tts|whisper|dall-e|moderation|transcribe|image|audio|realtime|search-preview|davinci|babbage/i.test(m.id));
  }
  models.sort((a, b) => a.id.localeCompare(b.id));
  upsertProvider({ id, models });
  return models;
}

export async function testProvider(id) {
  const t = Date.now();
  const models = await fetchModels(id);
  return { ok: true, count: models.length, ms: Date.now() - t };
}

// ───────────────── Conversión de mensajes ─────────────────
function toOpenAIMessages(messages, { vision = true } = {}) {
  const out = [];
  let pendingImages = [];
  const flushImages = () => {
    if (!pendingImages.length) return;
    out.push({ role: 'user', content: [{ type: 'text', text: '[Imágenes devueltas por las herramientas anteriores]' }, ...pendingImages.map((im) => ({ type: 'image_url', image_url: { url: `data:${im.mime};base64,${im.data}` } }))] });
    pendingImages = [];
  };
  for (const m of messages) {
    if (m.role !== 'tool') flushImages();
    if (m.role === 'system') out.push({ role: 'system', content: m.content });
    else if (m.role === 'user') {
      if (Array.isArray(m.content)) {
        const parts = [];
        for (const c of m.content) {
          if (c.type === 'text') parts.push({ type: 'text', text: c.text });
          else if (c.type === 'image') {
            if (vision) parts.push({ type: 'image_url', image_url: { url: `data:${c.mime};base64,${c.data}` } });
            else parts.push({ type: 'text', text: '[Imagen adjunta omitida: este modelo no admite visión]' });
          }
        }
        out.push({ role: 'user', content: parts.every((p) => p.type === 'text') ? parts.map((p) => p.text).join('\n\n') : parts });
      } else out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      const msg = { role: 'assistant', content: m.content || '' };
      if (m.tool_calls?.length) {
        msg.tool_calls = m.tool_calls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments || {}) } }));
        if (!msg.content) msg.content = null;
      }
      if (m.reasoning_content) msg.reasoning_content = m.reasoning_content;
      out.push(msg);
    } else if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.tool_call_id, content: m.content || '(sin salida)' });
      if (m.images?.length) { if (vision) pendingImages.push(...m.images); }
    }
  }
  flushImages();
  return out;
}

function toAnthropic(messages) {
  let system = '';
  const out = [];
  const push = (role, blocks) => {
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else out.push({ role, content: blocks });
  };
  for (const m of messages) {
    if (m.role === 'system') system += (system ? '\n\n' : '') + m.content;
    else if (m.role === 'user') {
      const blocks = Array.isArray(m.content)
        ? m.content.map((c) => c.type === 'image' ? { type: 'image', source: { type: 'base64', media_type: c.mime, data: c.data } } : { type: 'text', text: c.text || ' ' })
        : [{ type: 'text', text: m.content || ' ' }];
      push('user', blocks);
    } else if (m.role === 'assistant') {
      const blocks = [];
      for (const th of m.thinking_blocks || []) blocks.push(th);
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const tc of m.tool_calls || []) blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: typeof tc.arguments === 'string' ? safeJSON(tc.arguments) : (tc.arguments || {}) });
      if (!blocks.length) blocks.push({ type: 'text', text: '...' });
      push('assistant', blocks);
    } else if (m.role === 'tool') {
      const content = [{ type: 'text', text: m.content || '(sin salida)' }];
      for (const im of m.images || []) content.push({ type: 'image', source: { type: 'base64', media_type: im.mime, data: im.data } });
      push('user', [{ type: 'tool_result', tool_use_id: m.tool_call_id, content, is_error: !!m.isError }]);
    }
  }
  return { system, messages: out };
}

function safeJSON(s) { try { return JSON.parse(s || '{}'); } catch { return {}; } }

async function* sseLines(res, signal) {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    if (signal?.aborted) return;
    buf += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, '');
      buf = buf.slice(idx + 1);
      yield line;
    }
  }
  if (buf) yield buf;
}

/** Separa <think>...</think> embebido en el contenido (modelos que no usan reasoning_content). */
class ThinkSplitter {
  constructor() { this.inThink = false; this.buf = ''; }
  push(text) {
    const out = [];
    this.buf += text;
    while (this.buf) {
      if (!this.inThink) {
        const i = this.buf.indexOf('<think>');
        if (i === -1) {
          const keep = partialTag(this.buf, '<think>');
          if (this.buf.length - keep > 0) out.push({ type: 'text', delta: this.buf.slice(0, this.buf.length - keep) });
          this.buf = this.buf.slice(this.buf.length - keep);
          break;
        }
        if (i > 0) out.push({ type: 'text', delta: this.buf.slice(0, i) });
        this.buf = this.buf.slice(i + 7); this.inThink = true;
      } else {
        const i = this.buf.indexOf('</think>');
        if (i === -1) {
          const keep = partialTag(this.buf, '</think>');
          if (this.buf.length - keep > 0) out.push({ type: 'reasoning', delta: this.buf.slice(0, this.buf.length - keep) });
          this.buf = this.buf.slice(this.buf.length - keep);
          break;
        }
        if (i > 0) out.push({ type: 'reasoning', delta: this.buf.slice(0, i) });
        this.buf = this.buf.slice(i + 8); this.inThink = false;
      }
    }
    return out;
  }
  flush() { const b = this.buf; this.buf = ''; return b ? [{ type: this.inThink ? 'reasoning' : 'text', delta: b }] : []; }
}
function partialTag(s, tag) { for (let k = Math.min(tag.length - 1, s.length); k > 0; k--) if (tag.startsWith(s.slice(-k))) return k; return 0; }

function toolsToOpenAI(tools) {
  return tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

async function httpError(res) {
  let body = '';
  try { body = await res.text(); } catch { }
  let msg = body;
  try { const j = JSON.parse(body); msg = j.error?.message || j.message || j.error || body; } catch { }
  const hints = { 401: 'Clave API inválida o ausente.', 403: 'Acceso denegado por el proveedor.', 404: 'Modelo o endpoint no encontrado.', 429: 'Límite de uso alcanzado; espera o revisa tu plan.', 500: 'Error interno del proveedor.' };
  return new Error(`${hints[res.status] || 'Error del proveedor'} (HTTP ${res.status}) ${typeof msg === 'string' ? msg.slice(0, 400) : JSON.stringify(msg).slice(0, 400)}`);
}

/**
 * Stream unificado. target: { kind, baseUrl, apiKey, type, model, vision }
 * Emite: text, reasoning, tool_call, usage, done
 */
export async function* streamChat(target, { messages, tools = [], signal, temperature, maxTokens, reasoningEffort, thinkingBudget }) {
  if (target.kind === 'anthropic') { yield* streamAnthropic(target, { messages, tools, signal, temperature, maxTokens, thinkingBudget }); return; }
  const body = {
    model: target.model,
    messages: toOpenAIMessages(messages, { vision: target.vision !== false }),
    stream: true
  };
  if (tools.length && target.tools !== false) body.tools = toolsToOpenAI(tools);
  if (temperature !== undefined && temperature !== null && !/^(o\d|gpt-5)/.test(target.model)) body.temperature = temperature;
  if (maxTokens) body[/^(o\d|gpt-5)/.test(target.model) && target.type === 'openai' ? 'max_completion_tokens' : 'max_tokens'] = maxTokens;
  if (['openai', 'openrouter', 'local', 'groq', 'deepseek', 'together', 'fireworks', 'cerebras', 'xai'].includes(target.type)) body.stream_options = { include_usage: true };
  if (reasoningEffort && reasoningEffort !== 'auto') {
    if (target.type === 'openrouter') body.reasoning = { effort: reasoningEffort };
    else if (['openai', 'xai', 'gemini', 'groq'].includes(target.type)) body.reasoning_effort = reasoningEffort;
    else if (target.type === 'local') body.chat_template_kwargs = { enable_thinking: reasoningEffort !== 'none', reasoning_effort: reasoningEffort };
  }
  const url = `${target.baseUrl.replace(/\/$/, '')}/chat/completions`;
  let res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(target) }, body: JSON.stringify(body), signal });
  if (!res.ok && res.status === 400 && body.stream_options) {
    delete body.stream_options;
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(target) }, body: JSON.stringify(body), signal });
  }
  if (!res.ok && res.status === 400 && body.tools) {
    const txt = await res.clone().text().catch(() => '');
    if (/tool|function/i.test(txt)) {
      // el modelo/servidor no admite herramientas nativas
      delete body.tools;
      body.messages = toOpenAIMessages(flattenToolHistory(messages), { vision: target.vision !== false });
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(target) }, body: JSON.stringify(body), signal });
      yield { type: 'notice', text: 'Este modelo no admite herramientas; respondiendo sin ellas.' };
    }
  }
  if (!res.ok) throw await httpError(res);

  const calls = new Map();
  const splitter = new ThinkSplitter();
  let finish = null, usage = null;
  for await (const line of sseLines(res, signal)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (data === '[DONE]') break;
    let j; try { j = JSON.parse(data); } catch { continue; }
    if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
    if (j.usage) usage = { input: j.usage.prompt_tokens, output: j.usage.completion_tokens };
    if (j.timings) usage = { ...(usage || {}), tps: j.timings.predicted_per_second, promptTps: j.timings.prompt_per_second };
    const ch = j.choices?.[0];
    if (!ch) continue;
    const d = ch.delta || {};
    const r = d.reasoning_content ?? d.reasoning ?? d.thinking;
    if (r) yield { type: 'reasoning', delta: typeof r === 'string' ? r : (r.text || '') };
    if (d.content) for (const ev of splitter.push(d.content)) yield ev;
    if (d.tool_calls) {
      for (const tc of d.tool_calls) {
        const idx = tc.index ?? calls.size;
        if (!calls.has(idx)) calls.set(idx, { id: tc.id || uid('call_'), name: '', args: '' });
        const c = calls.get(idx);
        if (tc.id) c.id = tc.id;
        if (tc.function?.name) c.name += tc.function.name;
        if (tc.function?.arguments) c.args += tc.function.arguments;
      }
    }
    if (ch.finish_reason) finish = ch.finish_reason;
  }
  for (const ev of splitter.flush()) yield ev;
  for (const c of calls.values()) if (c.name) yield { type: 'tool_call', id: c.id, name: c.name, arguments: safeJSON(c.args), raw: c.args };
  if (usage) yield { type: 'usage', ...usage };
  yield { type: 'done', stop: finish };
}

function flattenToolHistory(messages) {
  return messages.map((m) => {
    if (m.role === 'tool') return { role: 'user', content: `[Resultado de ${m.name || 'herramienta'}]\n${m.content}` };
    if (m.role === 'assistant' && m.tool_calls?.length) return { role: 'assistant', content: (m.content || '') + '\n' + m.tool_calls.map((t) => `[Llamada a ${t.name}(${JSON.stringify(t.arguments)})]`).join('\n') };
    return m;
  });
}

async function* streamAnthropic(target, { messages, tools, signal, temperature, maxTokens, thinkingBudget }) {
  const { system, messages: msgs } = toAnthropic(messages);
  const body = { model: target.model, max_tokens: maxTokens || 16000, messages: msgs, stream: true };
  if (system) body.system = system;
  if (tools.length) body.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  if (thinkingBudget) { body.thinking = { type: 'enabled', budget_tokens: thinkingBudget }; body.max_tokens = Math.max(body.max_tokens, thinkingBudget + 4000); }
  else if (temperature !== undefined && temperature !== null) body.temperature = Math.min(1, temperature);
  const res = await fetch(`${target.baseUrl.replace(/\/$/, '')}/v1/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(target) }, body: JSON.stringify(body), signal });
  if (!res.ok) throw await httpError(res);
  const blocks = [];
  let usage = { input: 0, output: 0 }, stop = null;
  for await (const line of sseLines(res, signal)) {
    if (!line.startsWith('data:')) continue;
    let j; try { j = JSON.parse(line.slice(5).trim()); } catch { continue; }
    switch (j.type) {
      case 'message_start': usage.input = j.message?.usage?.input_tokens || 0; break;
      case 'content_block_start': blocks[j.index] = { ...j.content_block, _json: '', _thinking: '', _sig: '' }; break;
      case 'content_block_delta': {
        const b = blocks[j.index];
        if (j.delta.type === 'text_delta') yield { type: 'text', delta: j.delta.text };
        else if (j.delta.type === 'input_json_delta') b._json += j.delta.partial_json;
        else if (j.delta.type === 'thinking_delta') { b._thinking += j.delta.thinking; yield { type: 'reasoning', delta: j.delta.thinking }; }
        else if (j.delta.type === 'signature_delta') b._sig += j.delta.signature;
        break;
      }
      case 'content_block_stop': {
        const b = blocks[j.index];
        if (b?.type === 'tool_use') yield { type: 'tool_call', id: b.id, name: b.name, arguments: safeJSON(b._json) };
        if (b?.type === 'thinking') yield { type: 'thinking_block', block: { type: 'thinking', thinking: b._thinking, signature: b._sig } };
        if (b?.type === 'redacted_thinking') yield { type: 'thinking_block', block: { type: 'redacted_thinking', data: b.data } };
        break;
      }
      case 'message_delta': if (j.usage) usage.output = j.usage.output_tokens; if (j.delta?.stop_reason) stop = j.delta.stop_reason; break;
      case 'error': throw new Error(j.error?.message || 'Error de Anthropic');
    }
  }
  yield { type: 'usage', ...usage };
  yield { type: 'done', stop };
}

/** Llamada simple sin streaming (títulos, resúmenes, etc.). */
export async function complete(target, messages, opts = {}) {
  let text = '';
  for await (const ev of streamChat(target, { messages, ...opts })) if (ev.type === 'text') text += ev.delta;
  return text.trim();
}
