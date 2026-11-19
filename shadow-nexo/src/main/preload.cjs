const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Shadow no tiene el código fuente del renderer (React), así que este filtro se aplica aquí, en el
// preload: así los datos ya llegan limpios a la app, sin pelear con el ciclo de renderizado de React.
// Oculta llamadas a herramientas que el modelo escribió como texto (el backend ya las intenta ejecutar
// de verdad vía parseTextToolCalls en providers.js; esto es solo para que no se vean en pantalla).
function hideToolJson(text) {
  let t = String(text || '');
  t = t.replace(/```(?:json)?\s*\{\s*"name"\s*:[\s\S]*?```/g, '');
  t = t.replace(/\{\s*"name"\s*:\s*"[A-Za-z0-9_]+"\s*,\s*"(?:arguments|parameters|input)"\s*:[\s\S]*?\}\s*\}/g, '');
  t = t.replace(/\[\s*(?:Llamada a\s+)?[A-Za-z0-9_]+\s*\(\{[\s\S]*?\}\)\]/g, '');
  return t.replace(/\n{3,}/g, '\n\n').trim();
}
function cleanBlocks(blocks) {
  if (!Array.isArray(blocks)) return blocks;
  return blocks.map((b) => (b && b.type === 'text' && typeof b.text === 'string') ? { ...b, text: hideToolJson(b.text) } : b);
}

const listeners = new Map();
ipcRenderer.on('nexo:event', (_e, channel, payload) => {
  // El canal 'message' trae { chatId, message } con message.blocks[]: ahí es donde puede venir el JSON crudo.
  if (channel === 'message' && payload && payload.message && Array.isArray(payload.message.blocks)) {
    payload = { ...payload, message: { ...payload.message, blocks: cleanBlocks(payload.message.blocks) } };
  }
  const set = listeners.get(channel);
  if (set) for (const fn of set) { try { fn(payload); } catch (err) { console.error(err); } }
});

contextBridge.exposeInMainWorld('nexo', {
  call: async (method, ...args) => {
    const r = await ipcRenderer.invoke('nexo:call', method, ...args);
    // Historial de un chat (al abrirlo o refrescarlo): limpiar también cada mensaje guardado, no solo los nuevos.
    if (method === 'chats.get' && r && Array.isArray(r.messages)) {
      return { ...r, messages: r.messages.map((m) => (m && Array.isArray(m.blocks)) ? { ...m, blocks: cleanBlocks(m.blocks) } : m) };
    }
    if (method === 'chats.list' && Array.isArray(r)) {
      return r.map((c) => (c && Array.isArray(c.messages)) ? { ...c, messages: c.messages.map((m) => (m && Array.isArray(m.blocks)) ? { ...m, blocks: cleanBlocks(m.blocks) } : m) } : c);
    }
    return r;
  },
  on: (channel, fn) => {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel).add(fn);
    return () => listeners.get(channel)?.delete(fn);
  },
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
  platform: process.platform
});
