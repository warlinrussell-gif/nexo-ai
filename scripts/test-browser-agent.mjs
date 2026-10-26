// Prueba real: un agente local navega y hace clic con el motor "Chrome real".
// Uso: NEXO_MODELS=<carpeta con GGUF> NEXO_RUNTIMES_JSON=<runtimes.json instalado> [TEST_MODEL=gemma] node scripts/test-browser-agent.mjs
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const stub = pathToFileURL(path.resolve('scripts/electron-stub.mjs')).href;
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, n) { if (s === 'electron') return { url: ${JSON.stringify(stub)}, shortCircuit: true }; return n(s, c); }`));
const TEST_DIR = process.env.NEXO_TEST_DIR || path.join(os.tmpdir(), 'nexo-browser-agent');
process.env.NEXO_TEST_DIR = TEST_DIR;
fs.rmSync(TEST_DIR, { recursive: true, force: true });

const paths = await import('../src/main/paths.js');
paths.setDataDir(path.join(TEST_DIR, 'data'));
fs.copyFileSync(process.env.NEXO_RUNTIMES_JSON, path.join(TEST_DIR, 'data', 'config', 'runtimes.json'));
const { scanHardware } = await import('../src/main/hardware.js');
const models = await import('../src/main/models.js');
const { llama } = await import('../src/main/llama.js');
const chats = await import('../src/main/chats.js');
const { Engine } = await import('../src/main/engine.js');
const { setBrowserEngine } = await import('../src/main/browser.js');

const settings = { permissions: { mode: 'full' }, ctx: 8192, kvType: 'q8_0', autoSwap: true, reserveVramMB: 700, workspace: path.join(TEST_DIR, 'data', 'workspace'), web: {}, computer: {}, browser: { engine: 'chrome' } };
const getSettings = () => settings;
const hw = await scanHardware();
models.addExtraDir(process.env.NEXO_MODELS);
const want = (process.env.TEST_MODEL || 'gemma').toLowerCase();
const local = (await models.listLocalModels()).find((m) => `${m.repo}${m.name}`.toLowerCase().includes(want));
if (!local) { console.log('modelo no encontrado'); process.exit(1); }
console.log('modelo:', local.name, local.quant);
llama.getHardware = async () => hw;
llama.getSettings = getSettings;
await llama.ensureLoaded(local);
setBrowserEngine('chrome');

const engine = new Engine({ getSettings, getHardware: async () => hw, requestApproval: async () => 'allow', webKeys: () => ({}) });
const chat = chats.createChat({ agentId: 'assistant', model: `local:${local.id}` });
chats.updateChat(chat.id, { toolsOverride: ['browser'], reasoningEffort: 'none' });
const t0 = Date.now();
const msg = await engine.send(chat.id, { text: 'Con la herramienta browser abre https://example.com, haz clic en el enlace "Learn more" (o el único enlace de la página) y dime el título de la página a la que llegaste.' });
const tools = (msg.blocks || []).filter((b) => b.type === 'tool');
const text = (msg.blocks || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
console.log(`estado=${msg.status} ${msg.error || ''} · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log('herramientas:', tools.map((t) => `${t.name}(${t.args?.action || ''}:${t.status})`).join(' → '));
console.log('respuesta:', text.slice(0, 400).replace(/\n/g, ' '));
console.log(/example domains/i.test(text) && tools.some((t) => t.args?.action === 'click') ? 'OK ✔' : 'FALLO ✘');
setBrowserEngine('embedded');
await llama.stopAll();
process.exit(0);
