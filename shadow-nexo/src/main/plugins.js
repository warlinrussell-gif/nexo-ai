// Plugins de Nexo (como los de Claude Code / DeepSeek Harness): una carpeta con plugin.json que agrupa
// skills, agentes, hooks y servidores MCP en un solo paquete instalable.
//
//   mi-plugin/
//     plugin.json   { "id": "mi-plugin", "name": "...", "version": "1.0.0", "description": "...",
//                     "agents": [ { "id": "revisor", "name": "Revisor", "systemPrompt": "..." } ],
//                     "hooks": [ { "event": "post_tool", "match": "write_file", "command": "npm run lint" } ],
//                     "mcpServers": { "nombre": { "command": "npx", "args": ["-y", "paquete"] } } }
//     skills/<nombre>/SKILL.md
import fs from 'node:fs';
import path from 'node:path';
import { dir } from './paths.js';
import { load, save } from './store.js';
import { saveAgent, deleteAgent, listAgents } from './agents.js';
import { mcp } from './mcp.js';

const state = () => load('plugins', { disabled: [] });
const root = () => { const d = dir('plugins'); fs.mkdirSync(d, { recursive: true }); return d; };
const readManifest = (folder) => {
  const j = JSON.parse(fs.readFileSync(path.join(folder, 'plugin.json'), 'utf8'));
  if (!j.id || !/^[a-z0-9][a-z0-9-]*$/.test(j.id)) throw new Error('plugin.json necesita un "id" en minúsculas y guiones');
  return j;
};

export function listPlugins() {
  const out = [];
  const off = state().disabled;
  for (const name of fs.readdirSync(root())) {
    const folder = path.join(root(), name);
    try {
      const m = readManifest(folder);
      const skillsDir = path.join(folder, 'skills');
      const skills = fs.existsSync(skillsDir) ? fs.readdirSync(skillsDir).filter((s) => fs.existsSync(path.join(skillsDir, s, 'SKILL.md'))) : [];
      out.push({ id: m.id, name: m.name || m.id, version: m.version || '', description: m.description || '', enabled: !off.includes(m.id), folder, skills, agents: (m.agents || []).map((a) => a.name || a.id), hooks: (m.hooks || []).length, mcp: Object.keys(m.mcpServers || {}) });
    } catch (e) { out.push({ id: name, name, error: e.message, enabled: false, folder, skills: [], agents: [], hooks: 0, mcp: [] }); }
  }
  return out;
}

/** Hooks de los plugins activos (el motor los suma a los del usuario). */
export function pluginHooks() {
  const hooks = [];
  for (const p of listPlugins()) {
    if (!p.enabled || p.error) continue;
    try { for (const h of readManifest(p.folder).hooks || []) hooks.push({ enabled: true, ...h, plugin: p.id }); } catch { /* manifiesto roto */ }
  }
  return hooks;
}

/** Aplica los plugins: copia skills, registra agentes y servidores MCP; retira lo de los desactivados. */
export function syncPlugins() {
  const skillsRoot = dir('skills');
  fs.mkdirSync(skillsRoot, { recursive: true });
  for (const p of listPlugins()) {
    const prefix = `${p.id}--`;
    // limpiar lo anterior de este plugin y volver a crear si está activo
    for (const f of fs.readdirSync(skillsRoot)) if (f.startsWith(prefix)) fs.rmSync(path.join(skillsRoot, f), { recursive: true, force: true });
    for (const a of listAgents()) if (a.id.startsWith(prefix)) deleteAgent(a.id);
    if (!p.enabled || p.error) continue;
    for (const s of p.skills) fs.cpSync(path.join(p.folder, 'skills', s), path.join(skillsRoot, prefix + s), { recursive: true });
    const m = readManifest(p.folder);
    for (const a of m.agents || []) saveAgent({ ...a, id: prefix + a.id, name: a.name || a.id, plugin: p.id });
    if (m.mcpServers && Object.keys(m.mcpServers).length) { try { mcp.importConfig(JSON.stringify({ mcpServers: m.mcpServers })); } catch { /* servidor ya añadido */ } }
  }
}

export function installPlugin(folder) {
  const m = readManifest(folder);
  fs.cpSync(folder, path.join(root(), m.id), { recursive: true });
  const s = state(); s.disabled = s.disabled.filter((x) => x !== m.id); save('plugins', s, true);
  syncPlugins();
  return m.id;
}

export function removePlugin(id) {
  fs.rmSync(path.join(root(), id), { recursive: true, force: true });
  syncPlugins();
}

export function togglePlugin(id, enabled) {
  const s = state();
  s.disabled = enabled ? s.disabled.filter((x) => x !== id) : [...new Set([...s.disabled, id])];
  save('plugins', s, true);
  syncPlugins();
}

export const pluginsFolder = root;
