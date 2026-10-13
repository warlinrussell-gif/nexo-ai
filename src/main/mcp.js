// Cliente MCP (Model Context Protocol): servidores stdio, Streamable HTTP y SSE.
// Compatible con el formato de configuración de Claude Desktop / Cursor.
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { load, save } from './store.js';
import { uid, isWin, truncate } from './util.js';

export const MCP_PRESETS = [
  { id: 'filesystem', name: 'Sistema de archivos', desc: 'Leer/escribir archivos en carpetas permitidas.', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '{HOME}'], needs: 'Node.js' },
  { id: 'memory', name: 'Memoria (grafo)', desc: 'Memoria persistente basada en grafo de conocimiento.', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'], needs: 'Node.js' },
  { id: 'sequential-thinking', name: 'Pensamiento secuencial', desc: 'Razonamiento paso a paso estructurado.', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'], needs: 'Node.js' },
  { id: 'fetch', name: 'Fetch', desc: 'Descarga páginas web como markdown.', command: 'uvx', args: ['mcp-server-fetch'], needs: 'uv (Python)' },
  { id: 'time', name: 'Hora y zonas horarias', desc: 'Conversión de horas y zonas.', command: 'uvx', args: ['mcp-server-time'], needs: 'uv (Python)' },
  { id: 'git', name: 'Git', desc: 'Operaciones git sobre repositorios.', command: 'uvx', args: ['mcp-server-git'], needs: 'uv (Python)' },
  { id: 'playwright', name: 'Playwright (navegador)', desc: 'Automatización avanzada de navegador.', command: 'npx', args: ['-y', '@playwright/mcp@latest'], needs: 'Node.js' },
  { id: 'github', name: 'GitHub', desc: 'Repos, issues y PRs (requiere token).', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' }, needs: 'Node.js' },
  { id: 'brave-search', name: 'Brave Search', desc: 'Búsqueda web con API de Brave.', command: 'npx', args: ['-y', '@modelcontextprotocol/server-brave-search'], env: { BRAVE_API_KEY: '' }, needs: 'Node.js' },
  { id: 'sqlite', name: 'SQLite', desc: 'Consultar bases de datos SQLite.', command: 'uvx', args: ['mcp-server-sqlite', '--db-path', '{HOME}/nexo.db'], needs: 'uv (Python)' },
  { id: 'context7', name: 'Context7 (documentación)', desc: 'Documentación actualizada de librerías.', url: 'https://mcp.context7.com/mcp', transport: 'http' },
  { id: 'everything', name: 'Everything (pruebas)', desc: 'Servidor de ejemplo con todas las capacidades.', command: 'npx', args: ['-y', '@modelcontextprotocol/server-everything'], needs: 'Node.js' }
];

function st() { return load('mcp', { servers: [] }); }

export const sanitize = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);

class McpManager extends EventEmitter {
  constructor() { super(); this.conns = new Map(); }

  list() {
    return st().servers.map((s) => {
      const c = this.conns.get(s.id);
      return { ...s, status: c?.status || (s.enabled ? 'disconnected' : 'disabled'), error: c?.error, tools: c?.tools?.map((t) => ({ name: t.name, description: t.description })) || [], resources: c?.resources?.length || 0, prompts: c?.prompts?.length || 0, stderr: c?.stderr?.slice(-30) || [] };
    });
  }

  emitChange() { this.emit('change', this.list()); }

  upsert(server) {
    const s = st();
    let cur = server.id ? s.servers.find((x) => x.id === server.id) : null;
    if (!cur) { cur = { id: uid('mcp_'), enabled: true, transport: 'stdio', args: [], env: {}, trusted: false }; s.servers.push(cur); }
    Object.assign(cur, server, { id: cur.id });
    save('mcp', s, true);
    this.restart(cur.id);
    return cur;
  }

  remove(id) { this.disconnect(id); const s = st(); s.servers = s.servers.filter((x) => x.id !== id); save('mcp', s, true); this.emitChange(); }

  addPreset(presetId) {
    const p = MCP_PRESETS.find((x) => x.id === presetId);
    if (!p) throw new Error('Preset desconocido');
    const home = os.homedir().replace(/\\/g, '/');
    return this.upsert({ name: p.name, transport: p.transport || (p.url ? 'http' : 'stdio'), command: p.command, url: p.url, args: (p.args || []).map((a) => a.replace('{HOME}', home)), env: p.env || {} });
  }

  /** Importa el formato { mcpServers: { name: { command, args, env, url } } } */
  importConfig(json) {
    const obj = typeof json === 'string' ? JSON.parse(json) : json;
    const servers = obj.mcpServers || obj.servers || obj;
    let n = 0;
    for (const [name, cfg] of Object.entries(servers)) {
      if (!cfg || typeof cfg !== 'object') continue;
      const exists = st().servers.find((x) => x.name === name);
      this.upsert({ id: exists?.id, name, transport: cfg.url ? (cfg.type === 'sse' || /\/sse\b/.test(cfg.url) ? 'sse' : 'http') : 'stdio', command: cfg.command, args: cfg.args || [], env: cfg.env || {}, url: cfg.url, headers: cfg.headers || {} });
      n++;
    }
    return n;
  }

  claudeDesktopConfigPath() {
    const p = isWin ? path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json') : process.platform === 'darwin' ? path.join(os.homedir(), 'Library/Application Support/Claude/claude_desktop_config.json') : path.join(os.homedir(), '.config/Claude/claude_desktop_config.json');
    return fs.existsSync(p) ? p : null;
  }

  exportConfig() {
    const mcpServers = {};
    for (const s of st().servers) mcpServers[s.name] = s.transport === 'stdio' ? { command: s.command, args: s.args, env: s.env } : { url: s.url, type: s.transport, headers: s.headers };
    return { mcpServers };
  }

  async connectAll() { await Promise.allSettled(st().servers.filter((s) => s.enabled).map((s) => this.connect(s.id))); }

  async restart(id) { await this.disconnect(id); const s = st().servers.find((x) => x.id === id); if (s?.enabled) this.connect(id); else this.emitChange(); }

  async connect(id) {
    const cfg = st().servers.find((x) => x.id === id);
    if (!cfg) return;
    const conn = { status: 'connecting', error: null, tools: [], stderr: [], client: null };
    this.conns.set(id, conn);
    this.emitChange();
    try {
      let transport;
      if (cfg.transport === 'stdio') {
        let command = cfg.command;
        let args = cfg.args || [];
        if (isWin && !/\.(exe|com)$/i.test(command) && !/[\\/]/.test(command)) { args = ['/c', command, ...args]; command = 'cmd.exe'; }
        transport = new StdioClientTransport({ command, args, env: { ...process.env, ...(cfg.env || {}) }, stderr: 'pipe', cwd: cfg.cwd || os.homedir() });
        transport.stderr?.on('data', (d) => { conn.stderr.push(...d.toString().split(/\r?\n/).filter(Boolean)); if (conn.stderr.length > 100) conn.stderr.splice(0, conn.stderr.length - 100); });
      } else if (cfg.transport === 'sse') {
        transport = new SSEClientTransport(new URL(cfg.url), { requestInit: { headers: cfg.headers || {} } });
      } else {
        transport = new StreamableHTTPClientTransport(new URL(cfg.url), { requestInit: { headers: cfg.headers || {} } });
      }
      const client = new Client({ name: 'nexo-ai', version: '1.0.0' }, { capabilities: {} });
      await Promise.race([client.connect(transport), new Promise((_, rej) => setTimeout(() => rej(new Error('Tiempo de conexión agotado (60s)')), 60000))]);
      conn.client = client;
      const caps = client.getServerCapabilities() || {};
      conn.tools = caps.tools ? (await client.listTools()).tools : [];
      try { conn.resources = caps.resources ? (await client.listResources()).resources : []; } catch { conn.resources = []; }
      try { conn.prompts = caps.prompts ? (await client.listPrompts()).prompts : []; } catch { conn.prompts = []; }
      conn.status = 'connected';
      client.onclose = () => { conn.status = 'disconnected'; this.emitChange(); };
    } catch (e) {
      conn.status = 'error';
      conn.error = e.message + (conn.stderr.length ? '\n' + conn.stderr.slice(-5).join('\n') : '');
    }
    this.emitChange();
  }

  async disconnect(id) {
    const c = this.conns.get(id);
    if (c?.client) { try { await c.client.close(); } catch { } }
    this.conns.delete(id);
  }

  async disconnectAll() { await Promise.allSettled([...this.conns.keys()].map((id) => this.disconnect(id))); }

  /** Herramientas MCP en formato de herramienta de Nexo */
  tools(filterServerIds) {
    const out = [];
    for (const s of st().servers) {
      if (!s.enabled) continue;
      if (filterServerIds && !filterServerIds.includes(s.id)) continue;
      const c = this.conns.get(s.id);
      if (c?.status !== 'connected') continue;
      for (const t of c.tools) {
        const name = `mcp__${sanitize(s.name)}__${sanitize(t.name)}`.slice(0, 64);
        out.push({
          name, group: 'mcp', risk: s.trusted ? 'read' : 'exec', server: s.name,
          description: `[MCP · ${s.name}] ${t.description || t.name}`.slice(0, 1024),
          parameters: t.inputSchema && t.inputSchema.type ? t.inputSchema : { type: 'object', properties: {} },
          run: async (args) => this.callTool(s.id, t.name, args)
        });
      }
    }
    return out;
  }

  async callTool(serverId, toolName, args) {
    const c = this.conns.get(serverId);
    if (!c?.client) throw new Error('Servidor MCP desconectado');
    const r = await c.client.callTool({ name: toolName, arguments: args || {} }, undefined, { timeout: 300000 });
    const texts = [], images = [];
    for (const part of r.content || []) {
      if (part.type === 'text') texts.push(part.text);
      else if (part.type === 'image') images.push({ data: part.data, mime: part.mimeType || 'image/png' });
      else if (part.type === 'resource') texts.push(part.resource?.text || JSON.stringify(part.resource).slice(0, 4000));
      else texts.push(JSON.stringify(part).slice(0, 4000));
    }
    if (r.structuredContent && !texts.length) texts.push(JSON.stringify(r.structuredContent, null, 2));
    return { text: truncate(texts.join('\n\n') || '(sin salida)', 40000), images, isError: !!r.isError };
  }
}

export const mcp = new McpManager();
