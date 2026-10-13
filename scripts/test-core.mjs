// Prueba de integración del backend (sin interfaz): motor, descargas, modelos, agentes, herramientas, web y MCP.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const stub = pathToFileURL(path.resolve('scripts/electron-stub.mjs')).href;
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, n) { if (s === 'electron') return { url: ${JSON.stringify(stub)}, shortCircuit: true }; return n(s, c); }`));

const TEST_DIR = process.env.NEXO_TEST_DIR || '/tmp/nexo-test';
process.env.NEXO_TEST_DIR = TEST_DIR;
const only = process.argv[2] || 'all';
const log = (...a) => console.log('\x1b[36m[test]\x1b[0m', ...a);
const ok = (m) => console.log('\x1b[32m  ✔\x1b[0m', m);
const fail = (m) => { console.log('\x1b[31m  ✘\x1b[0m', m); process.exitCode = 1; };

const paths = await import('../src/main/paths.js');
paths.setDataDir(path.join(TEST_DIR, 'data'));
const { downloads } = await import('../src/main/downloads.js');
downloads.init();
const { scanHardware } = await import('../src/main/hardware.js');
const runtimes = await import('../src/main/runtimes.js');
const models = await import('../src/main/models.js');
const { llama } = await import('../src/main/llama.js');
const skills = await import('../src/main/skills.js');
const chats = await import('../src/main/chats.js');
const { Engine } = await import('../src/main/engine.js');
const { load, save } = await import('../src/main/store.js');

const settings = load('settings', { permissions: { mode: 'full' }, ctx: 4096, kvType: 'f16', autoSwap: true, reserveVramMB: 700, workspace: path.join(TEST_DIR, 'data', 'workspace'), web: {}, computer: {} });
settings.permissions = { mode: 'full' }; settings.ctx = 4096;
const getSettings = () => settings;

log('Hardware');
const hw = await scanHardware();
ok(`${hw.cpu.name} · ${hw.cpu.physical} núcleos · ${(hw.ram.total / 2 ** 30).toFixed(1)} GB · GPUs: ${hw.gpus.length} · backend ${hw.recommendedBackend}`);

skills.seedSkills();
const sk = skills.listSkills();
sk.length >= 5 ? ok(`Skills sembradas: ${sk.map((s) => s.id).join(', ')}`) : fail('skills no sembradas');

if (only === 'all' || only === 'web') {
  log('Web');
  const { webSearch, fetchUrl, htmlToText } = await import('../src/main/web.js');
  try { const r = await webSearch('llama.cpp github', { max: 5 }); r.length ? ok(`Búsqueda: ${r.length} resultados · ${r[0].title} → ${r[0].url}`) : fail('búsqueda vacía'); } catch (e) { fail('búsqueda: ' + e.message); }
  try { const r = await fetchUrl('https://example.com'); r.text.includes('Example Domain') ? ok(`fetch_url: "${r.title}" ${r.text.length} chars`) : fail('fetch_url sin contenido'); } catch (e) { fail('fetch: ' + e.message); }
  const t = htmlToText('<html><head><title>T</title></head><body><nav>menu</nav><h1>Hola</h1><p>Texto <a href="/x">enlace</a></p><script>x</script></body></html>', 'https://a.com');
  t.text.includes('# Hola') && t.text.includes('[enlace](https://a.com/x)') ? ok('htmlToText') : fail('htmlToText ' + JSON.stringify(t));
}

if (only === 'all' || only === 'mcp') {
  log('MCP (servidor "everything" vía npx)');
  const { mcp } = await import('../src/main/mcp.js');
  mcp.upsert({ name: 'everything', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-everything'] });
  const t0 = Date.now();
  while (Date.now() - t0 < 120000) { const s = mcp.list()[0]; if (s.status === 'connected' || s.status === 'error') break; await new Promise((r) => setTimeout(r, 500)); }
  const s = mcp.list()[0];
  if (s.status === 'connected') {
    ok(`MCP conectado: ${s.tools.length} herramientas (${s.tools.slice(0, 5).map((t) => t.name).join(', ')}…)`);
    const tools = mcp.tools();
    const echo = tools.find((t) => /echo/.test(t.name));
    if (echo) { const r = await echo.run({ message: 'hola nexo' }); r.text.includes('hola nexo') ? ok(`MCP tool ${echo.name}: ${r.text}`) : fail('echo MCP: ' + r.text); }
  } else fail('MCP: ' + s.status + ' ' + s.error);
  await mcp.disconnectAll();
}

if (only === 'all' || only === 'llm') {
  log('Motor llama.cpp (CPU)');
  let rt = runtimes.activeLlama();
  if (!rt) {
    const id = await runtimes.installLlama('cpu');
    await downloads.waitFor(id);
    await new Promise((r) => setTimeout(r, 500));
    rt = runtimes.activeLlama();
  }
  rt ? ok(`llama-server: ${rt.tag} → ${rt.serverPath}`) : fail('motor no instalado');

  log('Descarga de modelo pequeño');
  const repo = process.env.TEST_REPO || 'unsloth/Qwen3.5-0.8B-GGUF';
  let local = (await models.listLocalModels()).find((m) => m.repo === repo);
  if (!local) {
    const det = await models.repoDetails(repo);
    ok(`repo: ${det.quants.length} cuantizaciones, recomendada ${det.recommended}, meta L${det.meta?.layers}`);
    const id = await models.downloadModel({ repo, quant: 'Q4_K_M', withVision: false });
    let last = 0;
    downloads.on('update', (j) => { if (j.id === id && Date.now() - last > 5000) { last = Date.now(); console.log(`     ${(j.received / 1e6).toFixed(0)} / ${(j.total / 1e6).toFixed(0)} MB · ${(j.speed / 1e6).toFixed(1)} MB/s`); } });
    await downloads.waitFor(id);
    local = (await models.listLocalModels()).find((m) => m.repo === repo);
  }
  local ? ok(`modelo local: ${local.name} ${local.quant} ${(local.size / 1e6).toFixed(0)} MB · arch ${local.meta.arch} · capas ${local.meta.layers} · caps ${local.caps.join(',')}`) : fail('modelo no encontrado');

  llama.getHardware = async () => hw;
  llama.getSettings = getSettings;
  log('Carga del modelo');
  const t0 = Date.now();
  try {
    const inst = await llama.ensureLoaded(local);
    ok(`cargado en ${((Date.now() - t0) / 1000).toFixed(1)} s · puerto ${inst.port} · plan ${inst.plan.mode} · args ${inst.args.slice(4).join(' ')}`);
  } catch (e) { fail('carga: ' + e.message); console.log(llama.logs(local.id).slice(-20).join('\n')); }

  log('Agente con herramientas');
  const approvals = [];
  const engine = new Engine({ getSettings, getHardware: async () => hw, requestApproval: async (r) => { approvals.push(r); return 'allow'; }, webKeys: () => ({}) });
  const chat = chats.createChat({ agentId: 'assistant', model: `local:${local.id}` });
  chats.updateChat(chat.id, { toolsOverride: ['files', 'system'], reasoningEffort: 'none' });
  fs.writeFileSync(path.join(settings.workspace, 'nota.txt'), 'La contraseña del wifi es PERRO-AZUL-42');
  const t1 = Date.now();
  const msg = await engine.send(chat.id, { text: 'Lee el archivo nota.txt de tu directorio de trabajo con la herramienta read_file y dime qué contraseña contiene.' });
  const tools = (msg.blocks || []).filter((b) => b.type === 'tool');
  const text = (msg.blocks || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  console.log(`     estado=${msg.status} ${msg.error || ''} · herramientas=${tools.map((t) => `${t.name}(${t.status})`).join(', ')} · ${((Date.now() - t1) / 1000).toFixed(1)} s · ${msg.usage?.tps || '?'} tok/s`);
  console.log('     respuesta:', text.slice(0, 300).replace(/\n/g, ' '));
  tools.length && tools[0].status === 'done' ? ok('llamada a herramienta ejecutada') : fail('el modelo no llamó a la herramienta');
  /PERRO-AZUL-42/i.test(text) ? ok('respuesta usa el resultado de la herramienta') : fail('respuesta sin el dato');

  log('Compare mode (mismo modelo x2) + pipeline');
  const c2 = chats.createChat({ agentId: 'assistant', mode: 'compare', compareModels: [`local:${local.id}`, `local:${local.id}`] });
  chats.updateChat(c2.id, { toolsOverride: [], reasoningEffort: 'none' });
  const m2 = await engine.send(c2.id, { text: 'Di solo la palabra: hola' });
  m2.variants?.length === 2 && m2.variants.every((v) => v.status === 'done') ? ok(`comparar: ${m2.variants.map((v) => JSON.stringify((v.blocks.find((b) => b.type === 'text')?.text || '').trim().slice(0, 30))).join(' | ')} (${m2.strategy})`) : fail('comparar: ' + JSON.stringify(m2.variants?.map((v) => v.status + ' ' + (v.error || ''))));
  const c3 = chats.createChat({ agentId: 'assistant', mode: 'pipeline', pipeline: [{ label: 'Borrador', model: `local:${local.id}`, instruction: 'Escribe una frase sobre el mar.' }, { label: 'Mejorar', model: `local:${local.id}`, instruction: 'Traduce la frase anterior al inglés.' }] });
  chats.updateChat(c3.id, { toolsOverride: [], reasoningEffort: 'none' });
  const m3 = await engine.send(c3.id, { text: 'Adelante' });
  const stages = (m3.blocks || []).filter((b) => b.type === 'stage');
  stages.length === 2 && m3.status === 'done' ? ok(`pipeline: 2 etapas · ${(m3.blocks.filter((b) => b.type === 'text').map((b) => b.text.trim().slice(0, 60)).join(' → ')).replace(/\n/g, ' ')}`) : fail('pipeline: ' + m3.status + ' ' + m3.error);

  await llama.stopAll();
  ok('modelos detenidos');
}
chats.flushChats();
log(process.exitCode ? 'CON FALLOS' : 'TODO OK');
process.exit(process.exitCode || 0);
