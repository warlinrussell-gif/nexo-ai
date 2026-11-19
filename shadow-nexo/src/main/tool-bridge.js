// Puente MCP (HTTP local) que expone las herramientas de Nexo a OpenCode: OpenCode pone el modelo y
// Nexo pone las herramientas (con sus permisos, hooks y bloques en el chat). Un servidor por turno,
// solo en 127.0.0.1 y protegido con un token aleatorio.
import http from 'node:http';
import crypto from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

/**
 * listTools(): [{ name, description, parameters }]
 * callTool(name, args, id): { content: string, images?: [{data, mime}], isError?: boolean }
 */
export async function startToolBridge({ listTools, callTool }) {
  const token = crypto.randomBytes(24).toString('hex');
  const mk = () => {
    const server = new Server({ name: 'nexo-tools', version: '1.0.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: listTools().map((t) => ({ name: t.name, description: String(t.description || '').slice(0, 4000), inputSchema: t.parameters || { type: 'object', properties: {} } }))
    }));
    server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const { name, arguments: args } = req.params;
      try {
        const r = await callTool(name, args || {}, 'oc_' + crypto.randomBytes(6).toString('hex'));
        const content = [{ type: 'text', text: String(r.content ?? '') || '(sin salida)' }];
        for (const im of r.images || []) content.push({ type: 'image', data: im.data, mimeType: im.mime || 'image/png' });
        return { content, isError: !!r.isError };
      } catch (e) { return { content: [{ type: 'text', text: `Error: ${e.message || e}` }], isError: true }; }
    });
    return server;
  };
  const srv = http.createServer(async (req, res) => {
    try {
      if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end('unauthorized'); return; }
      if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }).end(); return; }
      let body = '';
      for await (const ch of req) body += ch;
      const server = mk();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => { try { transport.close(); server.close(); } catch { /* */ } });
      await server.connect(transport);
      await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined);
    } catch (e) { if (!res.headersSent) res.writeHead(500).end(String(e?.message || e)); }
  });
  await new Promise((resolve, reject) => { srv.once('error', reject); srv.listen(0, '127.0.0.1', resolve); });
  const port = srv.address().port;
  return { url: `http://127.0.0.1:${port}/mcp`, token, close: () => { try { srv.close(); srv.closeAllConnections?.(); } catch { /* */ } } };
}
