// Servidor MCP (stdio) que da a OpenCode el mismo navegador que usan los agentes de Nexo: Chrome real vía puppeteer-core.
// Lo lanza opencode.js con ELECTRON_RUN_AS_NODE=1 y NEXO_CHROME_PROFILE=<perfil>.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ChromeBrowser } from './browser-chrome.js';
import { BROWSER_DESCRIPTION, BROWSER_PROPERTIES, runBrowserAction } from './browser-tool.js';

const chrome = new ChromeBrowser();
const server = new Server({ name: 'nexo-browser', version: '1.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: 'browser', description: BROWSER_DESCRIPTION.replace(/según Ajustes.*?real\)/, 'ventana de Chrome real'), inputSchema: { type: 'object', properties: BROWSER_PROPERTIES, required: ['action'] } }]
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  try {
    const r = await runBrowserAction(chrome, req.params.arguments || {});
    if (typeof r === 'string') return { content: [{ type: 'text', text: r }] };
    return { content: [{ type: 'text', text: r.text || '' }, ...(r.images || []).map((i) => ({ type: 'image', data: i.data, mimeType: i.mime }))] };
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: 'Error: ' + e.message }] };
  }
});

const bye = async () => { await chrome.close(); process.exit(0); };
process.on('SIGTERM', bye); process.on('SIGINT', bye);
process.stdin.on('end', bye);
await server.connect(new StdioServerTransport());
