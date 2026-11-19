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

// Los proveedores personalizados pueden elegir formato de API (openai | anthropic).
function kindOf(p) { return p.type === 'custom' && (p.format === 'anthropic' || p.format === 'openai') ? p.format : (PROVIDER_TYPES[p.type]?.kind || 'openai'); }

export function listProviders({ withKeys = false } = {}) {
  return state().list.map((p) => ({ ...p, apiKey: withKeys ? decrypt(p.apiKey) : undefined, hasKey: !!p.apiKey, kind: kindOf(p) }));
}

export function getProvider(id) {
  const p = state().list.find((x) => x.id === id);
  if (!p) return null;
  return { ...p, apiKey: decrypt(p.apiKey), kind: kindOf(p) };
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
  for (const k of ['name', 'baseUrl', 'enabled', 'customModels', 'models', 'hiddenModels', 'format', 'headers', 'ctx']) if (data[k] !== undefined) p[k] = data[k];
  if (data.apiKey !== undefined && data.apiKey !== 'â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢') p.apiKey = encrypt(data.apiKey);
  save('providers', st, true);
  return { ...p, apiKey: undefined, hasKey: !!p.apiKey };
}

export function removeProvider(id) {
  const st = state();
  st.list = st.list.filter((p) => p.id !== id);
  save('providers', st, true);
}

function authHeaders(p) {
  let h;
  if (p.kind === 'anthropic') h = { 'x-api-key': p.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
  else {
    h = {};
    if (p.apiKey) h.Authorization = `Bearer ${p.apiKey}`;
    if (p.type === 'openrouter') { h['HTTP-Referer'] = 'https://nexo.ai'; h['X-Title'] = 'Nexo AI'; }
  }
  // Cabeceras extra definidas por el usuario (p. ej. api-key de Azure, o sin Bearer)
  if (p.headers && typeof p.headers === 'object') for (const [k, v] of Object.entries(p.headers)) { if (k && v !== undefined && v !== '') h[k] = String(v); }
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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ ConversiÃ³n de mensajes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function toOpenAIMessages(messages, { vision = true } = {}) {
  const out = [];
  let pendingImages = [];
  const flushImages = () => {
    if (!pendingImages.length) return;
    out.push({ role: 'user', content: [{ type: 'text', text: '[ImÃ¡genes devueltas por las herramientas anteriores]' }, ...pendingImages.map((im) => ({ type: 'image_url', image_url: { url: `data:${im.mime};base64,${im.data}` } }))] });
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
            else parts.push({ type: 'text', text: '[Imagen adjunta omitida: este modelo no admite visiÃ³n]' });
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
  const hints = { 401: 'Clave API invÃ¡lida o ausente.', 403: 'Acceso denegado por el proveedor.', 404: 'Modelo o endpoint no encontrado.', 429: 'LÃ­mite de uso alcanzado; espera o revisa tu plan.', 500: 'Error interno del proveedor.' };
  return new Error(`${hints[res.status] || 'Error del proveedor'} (HTTP ${res.status}) ${typeof msg === 'string' ? msg.slice(0, 400) : JSON.stringify(msg).slice(0, 400)}`);
}

// Modelos (p. ej. fine-tunes "uncensored") que SÃ pueden llamar herramientas, pero cuyo servidor
// rechaza (400) el historial estructurado de tool_calls/tool-results. Para ellos aplanamos ese
// historial a texto plano y mantenemos las herramientas activas. Se aprende en caliente y se
// recuerda por id de modelo para no repetir el error en cada mensaje.
const FLAT_TOOL_HISTORY = new Set();
// Modelos que rechazan imÃ¡genes (solo texto): se les quita el historial de imÃ¡genes automÃ¡ticamente.
const TEXT_ONLY_MODELS = new Set();
const hasToolHistory = (messages) => messages.some((m) => m.role === 'tool' || m.tool_calls?.length);

/**
 * Stream unificado. target: { kind, baseUrl, apiKey, type, model, vision }
 * Emite: text, reasoning, tool_call, usage, done
 */
export async function* streamChat(target, { messages, tools = [], signal, temperature, maxTokens, reasoningEffort, thinkingBudget }) {
  if (target.kind === 'anthropic') { yield* streamAnthropic(target, { messages, tools, signal, temperature, maxTokens, thinkingBudget }); return; }
  let flatHist = FLAT_TOOL_HISTORY.has(target.model);
  let noVision = TEXT_ONLY_MODELS.has(target.model);
  const buildMsgs = (forceFlat) => toOpenAIMessages((flatHist || forceFlat) ? flattenToolHistory(messages) : messages, { vision: target.vision !== false && !noVision });
  const body = {
    model: target.model,
    messages: buildMsgs(),
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
      // Nivel 1: si hay historial de herramientas y aÃºn no lo habÃ­amos aplanado, aplÃ¡nalo a texto
      // pero MANTÃ‰N las herramientas. Muchos modelos (fine-tunes) saben llamar herramientas pero no
      // digieren el historial estructurado de tool_calls; asÃ­ siguen pudiendo usarlas en adelante.
      if (!flatHist && hasToolHistory(messages)) {
        FLAT_TOOL_HISTORY.add(target.model);
        flatHist = true;
        body.messages = buildMsgs();
        res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(target) }, body: JSON.stringify(body), signal });
        if (res.ok) yield { type: 'notice', text: 'AjustÃ© el formato del historial para este modelo; las herramientas siguen activas.' };
      }
      // Nivel 2: si ni asÃ­, el modelo realmente no admite herramientas; responde sin ellas.
      if (!res.ok) {
        delete body.tools;
        body.messages = buildMsgs(true);
        res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(target) }, body: JSON.stringify(body), signal });
        yield { type: 'notice', text: 'Este modelo no admite herramientas; respondiendo sin ellas.' };
      }
    }
  }
  // El modelo es solo texto pero el historial lleva imÃ¡genes (capturas pegadas o resultados de herramientas):
  // quitar las imÃ¡genes y reintentar; se recuerda para los siguientes mensajes.
  if (!res.ok && res.status === 400 && !noVision) {
    const txt = await res.clone().text().catch(() => '');
    if (/image|vision|multimodal|text[\s-]?only|accepts? (only )?text|solo texto/i.test(txt)) {
      TEXT_ONLY_MODELS.add(target.model);
      noVision = true;
      body.messages = buildMsgs();
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(target) }, body: JSON.stringify(body), signal });
      if (res.ok) yield { type: 'notice', text: 'Este modelo es solo texto; quitÃ© las imÃ¡genes del historial y continuÃ© sin ellas.' };
    }
  }
  if (!res.ok) throw await httpError(res);

  const calls = new Map();
  const splitter = new ThinkSplitter();
  const toolNames = new Set(tools.map((t) => t.name));
  let textBuf = '';
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
    if (d.content) for (const ev of splitter.push(d.content)) { if (ev.type === 'text') textBuf += ev.delta; yield ev; }
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
  for (const ev of splitter.flush()) { if (ev.type === 'text') textBuf += ev.delta; yield ev; }
  for (const c of calls.values()) if (c.name) yield { type: 'tool_call', id: c.id, name: c.name, arguments: safeJSON(c.args), raw: c.args };
  // Respaldo: algunos modelos (fine-tunes, gateways "uncensored") no emiten tool_calls nativas y escriben
  // la llamada como texto con el formato del historial: [Llamada a nombre({...})]. Si no hubo tool_calls
  // nativas, las parseamos del texto y las ejecutamos; si no, el agente se queda en bucle sin feedback.
  if (!calls.size) {
    for (const c of parseTextToolCalls(textBuf, toolNames)) yield { type: 'tool_call', id: uid('call_'), name: c.name, arguments: c.arguments, raw: JSON.stringify(c.arguments) };
  }
  if (usage) yield { type: 'usage', ...usage };
  yield { type: 'done', stop: finish };
}

/**
 * Extrae llamadas a herramientas escritas como texto por modelos que no usan tool_calls nativas.
 * Formato reconocido (el mismo que Nexo pone en el historial): [Llamada a nombre({...json...})].
 * Solo acepta nombres de herramientas reales (toolNames) y descarta llamadas duplicadas idÃ©nticas.
 */
function parseTextToolCalls(text, toolNames) {
  if (!text) return [];
  const out = [];
  // Forma 2: el modelo escribe la llamada como JSON, p. ej. ```json {"name":"read_file","arguments":{...}} ```
  // Solo se acepta si el nombre es una herramienta real de este turno.
  if (text.includes('"name"')) {
    const jre = /\{\s*"name"\s*:\s*"([A-Za-z0-9_]+)"\s*,\s*"(?:arguments|parameters|input)"\s*:\s*/g;
    let jm;
    while ((jm = jre.exec(text))) {
      const name = jm[1];
      if (toolNames && toolNames.size && !toolNames.has(name)) continue;
      let i = jre.lastIndex;
      if (text[i] !== '{') continue;
      let depth = 0, inStr = false, esc = false, j = i;
      for (; j < text.length; j++) {
        const ch = text[j];
        if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
        if (ch === '"') inStr = true;
        else if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) { j++; break; } }
      }
      const args = safeJSON(text.slice(i, j));
      if (args && typeof args === 'object') out.push({ name, arguments: args });
      jre.lastIndex = j;
    }
  }
  if (text.includes('Llamada a')) {
    const re = /\[\s*Llamada a\s+([A-Za-z0-9_]+)\s*\(/g;
    let m;
    while ((m = re.exec(text))) {
      const name = m[1];
      if (toolNames && toolNames.size && !toolNames.has(name)) continue;
      let i = re.lastIndex, depth = 1, inStr = false, esc = false;
      const start = i;
      for (; i < text.length && depth > 0; i++) {
        const ch = text[i];
        if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; }
        else if (ch === '"') inStr = true;
        else if (ch === '(' || ch === '{' || ch === '[') depth++;
        else if (ch === ')' || ch === '}' || ch === ']') depth--;
      }
      const argStr = text.slice(start, i - 1).trim();
      const args = safeJSON(argStr);
      if (args && typeof args === 'object') out.push({ name, arguments: args });
      re.lastIndex = i;
    }
  }
  // Forma 3: el modelo escribe [nombre_herramienta({...})] sin ningún prefijo (p. ej. "[run_command({...})]").
  // Solo se acepta si el nombre es una herramienta real de este turno (evita falsos positivos con enlaces [texto](url)
  // o cualquier otro uso de corchetes: un enlace Markdown tiene "]" entre el texto y el "(", así que nunca coincide aquí).
  {
    const re2 = /\[\s*([A-Za-z0-9_]+)\s*\(/g;
    let m2;
    while ((m2 = re2.exec(text))) {
      const name = m2[1];
      if (!toolNames || !toolNames.size || !toolNames.has(name)) continue;
      let i = re2.lastIndex, depth = 1, inStr = false, esc = false;
      const start = i;
      for (; i < text.length && depth > 0; i++) {
        const ch = text[i];
        if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; }
        else if (ch === '"') inStr = true;
        else if (ch === '(' || ch === '{' || ch === '[') depth++;
        else if (ch === ')' || ch === '}' || ch === ']') depth--;
      }
      if (text[i] !== ']') continue; // debe cerrar con ")]" para distinguirlo de otros usos de paréntesis tras el nombre
      const argStr = text.slice(start, i - 1).trim();
      const args = safeJSON(argStr);
      if (args && typeof args === 'object') out.push({ name, arguments: args });
      re2.lastIndex = i + 1;
    }
  }
  return dedupeCalls(out);
}

function dedupeCalls(list) {
  const seen = new Set(), uniq = [];
  for (const c of list) { const k = c.name + JSON.stringify(c.arguments); if (!seen.has(k)) { seen.add(k); uniq.push(c); } }
  return uniq;
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

/** Llamada simple sin streaming (tÃ­tulos, resÃºmenes, etc.). */
export async function complete(target, messages, opts = {}) {
  let text = '';
  for await (const ev of streamChat(target, { messages, ...opts })) if (ev.type === 'text') text += ev.delta;
  return text.trim();
}
