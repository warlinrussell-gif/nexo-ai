// Almacenamiento de conversaciones (índice + un archivo por chat) y adjuntos.
import fs from 'node:fs';
import path from 'node:path';
import { dir } from './paths.js';
import { readJSON, writeJSONAtomic } from './store.js';
import { uid } from './util.js';

let index = null;
const chats = new Map();
const saveTimers = new Map();

function indexFile() { return dir('chats', 'index.json'); }
function chatFile(id) { return dir('chats', `${id}.json`); }

function getIndex() {
  if (!index) index = readJSON(indexFile(), []);
  return index;
}
function saveIndex() { writeJSONAtomic(indexFile(), getIndex()); }

export function listChats() {
  return getIndex().slice().sort((a, b) => (b.pinned - a.pinned) || (b.updatedAt - a.updatedAt));
}

export function getChat(id) {
  if (chats.has(id)) return chats.get(id);
  const c = readJSON(chatFile(id), null);
  if (c) chats.set(id, c);
  return c;
}

export function createChat(data = {}) {
  const chat = {
    id: uid('c_'), title: data.title || 'Nuevo chat', createdAt: Date.now(), updatedAt: Date.now(),
    agentId: data.agentId || 'assistant', model: data.model || null, mode: data.mode || 'chat',
    compareModels: data.compareModels || [], pipeline: data.pipeline || [], pinned: false,
    toolsOverride: null, permissionMode: null, messages: [], folder: data.folder || null,
    workspace: data.workspace || null, opencodeModel: data.opencodeModel ?? null, opencodeVariant: data.opencodeVariant ?? null, reasoningEffort: data.reasoningEffort || null
  };
  chats.set(chat.id, chat);
  getIndex().push(meta(chat));
  saveChat(chat, true);
  saveIndex();
  return chat;
}

function meta(c) {
  const lastUser = [...c.messages].reverse().find((m) => m.role === 'user');
  return { id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt, agentId: c.agentId, model: c.model, mode: c.mode, pinned: !!c.pinned, preview: (lastUser?.content || '').slice(0, 90), count: c.messages.length };
}

export function saveChat(chat, immediate = false) {
  chat.updatedAt = Date.now();
  chats.set(chat.id, chat);
  const idx = getIndex();
  const i = idx.findIndex((x) => x.id === chat.id);
  if (i >= 0) idx[i] = meta(chat); else idx.push(meta(chat));
  clearTimeout(saveTimers.get(chat.id));
  const write = () => { try { writeJSONAtomic(chatFile(chat.id), chat); saveIndex(); } catch (e) { console.error('saveChat', e); } };
  if (immediate) write(); else saveTimers.set(chat.id, setTimeout(write, 400));
}

export function updateChat(id, patch) {
  const c = getChat(id);
  if (!c) return null;
  const allowed = ['title', 'agentId', 'model', 'mode', 'compareModels', 'pipeline', 'pinned', 'toolsOverride', 'permissionMode', 'folder', 'reasoningEffort', 'temperature', 'workspace', 'opencodeModel', 'opencodeSession', 'opencodeVariant'];
  for (const k of allowed) if (patch[k] !== undefined) c[k] = patch[k];
  saveChat(c, true);
  return c;
}

export function deleteChat(id) {
  chats.delete(id);
  index = getIndex().filter((x) => x.id !== id);
  saveIndex();
  try { fs.unlinkSync(chatFile(id)); } catch { }
  try { fs.rmSync(dir('attachments', id), { recursive: true, force: true }); } catch { }
}

export function searchChats(q) {
  const s = q.toLowerCase();
  const out = [];
  for (const m of getIndex()) {
    if (m.title.toLowerCase().includes(s)) { out.push({ ...m, match: m.title }); continue; }
    const c = getChat(m.id);
    const hit = c?.messages.find((x) => (typeof x.content === 'string' && x.content.toLowerCase().includes(s)) || (x.blocks || []).some((b) => b.type === 'text' && b.text?.toLowerCase().includes(s)));
    if (hit) {
      const txt = typeof hit.content === 'string' && hit.content ? hit.content : (hit.blocks || []).filter((b) => b.type === 'text').map((b) => b.text).join(' ');
      const i = txt.toLowerCase().indexOf(s);
      out.push({ ...m, match: txt.slice(Math.max(0, i - 40), i + 80) });
    }
  }
  return out.slice(0, 50);
}

export function saveAttachment(chatId, { name, data, mime }) {
  const d = dir('attachments', chatId);
  fs.mkdirSync(d, { recursive: true });
  const ext = path.extname(name || '') || (mime?.includes('png') ? '.png' : mime?.includes('jpeg') ? '.jpg' : '.bin');
  const file = path.join(d, uid('a_') + ext);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  return file;
}

export function exportMarkdown(id) {
  const c = getChat(id);
  if (!c) return '';
  let md = `# ${c.title}\n\n`;
  for (const m of c.messages) {
    if (m.role === 'user') md += `## Tú\n\n${m.content}\n\n`;
    else {
      const blocks = m.variants ? m.variants[0]?.blocks || [] : m.blocks || [];
      md += `## ${m.agentName || 'Nexo'}${m.modelName ? ` (${m.modelName})` : ''}\n\n`;
      for (const b of blocks) {
        if (b.type === 'text') md += b.text + '\n\n';
        else if (b.type === 'tool') md += `> Herramienta **${b.name}**: ${String(b.summary || '').slice(0, 200)}\n\n`;
        else if (b.type === 'stage') md += `### ${b.label}\n\n`;
      }
    }
  }
  return md;
}

export function flushChats() {
  for (const [id, t] of saveTimers) { clearTimeout(t); const c = chats.get(id); if (c) { try { writeJSONAtomic(chatFile(id), c); } catch { } } }
  try { saveIndex(); } catch { }
}
