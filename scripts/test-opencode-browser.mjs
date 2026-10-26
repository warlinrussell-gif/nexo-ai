// Prueba: OpenCode (modelo en la nube, sin GPU) usa el navegador de Nexo vía MCP y admite instrucciones a mitad de tarea.
// Uso: [STEER="..." STEER_MS=9000] OC_MODEL=opencode/deepseek-v4.1-flash-free node scripts/test-opencode-browser.mjs
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const stub = pathToFileURL(path.resolve('scripts/electron-stub.mjs')).href;
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, n) { if (s === 'electron') return { url: ${JSON.stringify(stub)}, shortCircuit: true }; return n(s, c); }`));
const TEST_DIR = path.join(os.tmpdir(), 'nexo-oc-browser');
process.env.NEXO_TEST_DIR = TEST_DIR;
fs.rmSync(TEST_DIR, { recursive: true, force: true });
const paths = await import('../src/main/paths.js');
paths.setDataDir(path.join(TEST_DIR, 'data'));
const chats = await import('../src/main/chats.js');
const { Engine } = await import('../src/main/engine.js');
const settings = { permissions: { mode: 'full' }, workspace: path.join(TEST_DIR, 'data', 'workspace'), web: {}, computer: {}, opencode: { path: '', model: process.env.OC_MODEL || 'opencode/deepseek-v4.1-flash-free', autoApprove: true }, browser: { engine: 'chrome' } };
const engine = new Engine({ getSettings: () => settings, getHardware: async () => ({}), requestApproval: async () => 'allow', webKeys: () => ({}) });
const chat = chats.createChat({ agentId: 'opencode' });
chats.updateChat(chat.id, { opencodeModel: settings.opencode.model });
if (process.env.STEER) setTimeout(() => engine.steer(chat.id, { text: process.env.STEER }), Number(process.env.STEER_MS || 9000));
const t0 = Date.now();
const msg = await engine.send(chat.id, { text: process.env.PROMPT || 'Usa la herramienta MCP del navegador de Nexo (nexo-browser) para abrir https://example.com, hacer clic en el único enlace y decirme el título de la página a la que llegaste. No uses la terminal.' });
const tools = (msg.blocks || []).filter((b) => b.type === 'tool');
console.log(`estado=${msg.status} ${msg.error || ''} · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log('herramientas:', tools.map((t) => `${t.name}:${t.status}`).join(' → '));
console.log('usuario:', (msg.blocks || []).filter((b) => b.type === 'user').map((b) => b.text).join(' | '));
console.log('respuesta:', (msg.blocks || []).filter((b) => b.type === 'text').map((b) => b.text).join('').slice(0, 500).replace(/\n/g, ' '));
process.exit(0);
