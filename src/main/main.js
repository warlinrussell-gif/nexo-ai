// Nexo AI — proceso principal de Electron
import { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, globalShortcut, nativeImage, protocol, net, session, nativeTheme, screen } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inspect } from 'node:util';

import * as paths from './paths.js';
import { load, save, encrypt, decrypt, flushAll, resetCache } from './store.js';
import { scanHardware, liveStats } from './hardware.js';
import { downloads } from './downloads.js';
import * as runtimes from './runtimes.js';
import * as models from './models.js';
import { llama } from './llama.js';
import * as providers from './providers.js';
import { mcp, MCP_PRESETS } from './mcp.js';
import * as skills from './skills.js';
import * as agents from './agents.js';
import * as chats from './chats.js';
import { Engine } from './engine.js';
import * as opencode from './opencode.js';
import { browser } from './browser.js';
import * as voice from './voice.js';
import { shutdownInput } from './computer.js';
import { planModel, planMulti, staticBudget, recommendContext } from '../shared/fit.js';
import { uid, isWin, isMac, dirSize } from './util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.join(__dirname, '..', '..');
const RENDERER = path.join(APP_ROOT, 'dist', 'renderer', 'index.html');
const ICON = path.join(APP_ROOT, 'resources', isWin ? 'icon.ico' : 'icon.png');

app.setName('Nexo AI');
if (isWin) app.setAppUserModelId('ai.nexo.studio');
fixPath();

/** Añade al PATH las ubicaciones habituales de Node, Python, uv, etc. (las apps de escritorio no siempre heredan el PATH del shell). */
function fixPath() {
  const home = os.homedir();
  const extra = isWin
    ? [path.join(process.env.APPDATA || '', 'npm'), path.join(home, '.local', 'bin'), path.join(home, '.cargo', 'bin'), path.join(home, '.bun', 'bin'), path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python313'), path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312'), path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps'), 'C:\\Program Files\\nodejs', 'C:\\Program Files\\Git\\cmd']
    : ['/usr/local/bin', '/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/bin', '/bin', '/usr/sbin', '/sbin', path.join(home, '.local', 'bin'), path.join(home, '.cargo', 'bin'), path.join(home, '.bun', 'bin'), path.join(home, '.volta', 'bin'), path.join(home, '.deno', 'bin')];
  try {
    const nvm = path.join(home, '.nvm', 'versions', 'node');
    if (fs.existsSync(nvm)) for (const v of fs.readdirSync(nvm).sort().reverse().slice(0, 1)) extra.push(path.join(nvm, v, 'bin'));
  } catch { }
  const key = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  const parts = (process.env[key] || '').split(path.delimiter).filter(Boolean);
  for (const d of extra) if (d && !parts.includes(d) && fs.existsSync(d)) parts.push(d);
  process.env[key] = parts.join(path.delimiter);
}
protocol.registerSchemesAsPrivileged([{ scheme: 'nexo', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } }]);

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

let win = null, overlay = null, tray = null, quitting = false, initialized = false, engine = null;
const pendingApprovals = new Map();
const pendingQuestions = new Map();

const DEFAULT_SETTINGS = {
  theme: 'dark', accent: '#d97757', fontScale: 1, sendOnEnter: true, showReasoning: true, compact: false,
  defaultModel: null, defaultAgent: 'assistant', customInstructions: '', workspace: '',
  permissions: { mode: 'smart' }, toolsEnabled: true, reasoningEffort: 'auto',
  ctx: 8192, autoCtx: true, autoCompact: true, hooks: [], opencode: { path: '', model: '', autoApprove: false }, kvType: 'f16', threads: 0, parallel: 1, autoUnloadMinutes: 30, reserveVramMB: 700, autoSwap: true, backendOverride: '',
  voice: { stt: 'whisper-local', whisperModel: 'small-q5_1', language: 'es', tts: 'system', systemVoice: '', piperVoice: 'es_ES-davefx-medium', openaiVoice: 'alloy', elevenVoice: '', rate: 1, autoSpeak: false, wakeWord: 'jarvis', jarvisAgent: 'jarvis', jarvisModel: '', hotkey: 'CommandOrControl+Shift+Space', vadThreshold: 0.5, silenceMs: 900 },
  web: { searchEngine: 'auto', searxngUrl: '' },
  computer: { hideWindow: true, maxScreenshotWidth: 1366, screenshotAfterAction: true },
  browser: { autoOpen: true },
  closeToTray: true, launchAtLogin: false, setupDone: false,
  secrets: { hfToken: '', brave: '', tavily: '', elevenlabs: '' }
};

const getSettings = () => load('settings', DEFAULT_SETTINGS);
const secret = (k) => decrypt(getSettings().secrets?.[k] || '');

function send(channel, payload) {
  for (const w of [win, overlay]) if (w && !w.isDestroyed()) w.webContents.send('nexo:event', channel, payload);
}

// ───────────────── Registro de errores en NexoData/logs/main.log ─────────────────
let fileLogInstalled = false;
function installFileLog() {
  if (fileLogInstalled) return;
  let file;
  try { file = path.join(paths.dir('logs'), 'main.log'); } catch { return; }
  fileLogInstalled = true;
  try { if (fs.existsSync(file) && fs.statSync(file).size > 5e6) fs.renameSync(file, file + '.old'); } catch { }
  const fmt = (a) => (typeof a === 'string' ? a : inspect(a, { depth: 4, breakLength: 160 }));
  const write = (lvl, args) => { try { fs.appendFileSync(file, `[${new Date().toISOString()}] ${lvl} ${args.map(fmt).join(' ')}\n`); } catch { } };
  for (const lvl of ['error', 'warn']) {
    const orig = console[lvl].bind(console);
    console[lvl] = (...a) => { orig(...a); write(lvl.toUpperCase(), a); };
  }
  write('INFO', [`Nexo AI ${app.getVersion()} iniciado (Electron ${process.versions.electron}, ${process.platform})`]);
}

// ───────────────── Inicialización tras elegir carpeta de datos ─────────────────
async function initCore() {
  if (initialized) return;
  initialized = true;
  paths.ensureDirs();
  installFileLog();
  const s = getSettings();
  if (!s.workspace) { s.workspace = paths.dir('workspace'); save('settings', s); }
  // Interfaz 1.2: el morado anterior era el acento por defecto; si nunca se cambió, pasa al nuevo tono cálido
  if ((s.uiVersion || 1) < 2) { if (!s.accent || s.accent === '#8b5cf6') s.accent = '#d97757'; s.uiVersion = 2; save('settings', s, true); }
  downloads.init();
  downloads.headersFor = (url) => (/huggingface\.co/.test(url) && secret('hfToken') ? { Authorization: `Bearer ${secret('hfToken')}` } : {});
  downloads.on('update', (j) => send('downloads', j));
  downloads.on('done', () => send('models-changed', {}));
  models.setHfTokenGetter(() => secret('hfToken'));
  voice.setElevenKey(secret('elevenlabs'));
  llama.getHardware = () => scanHardware();
  llama.getSettings = () => getSettings();
  llama.on('change', (list) => send('llama', list));
  mcp.on('change', (list) => send('mcp', list));
  browser.on('state', (st) => send('browser-state', st));
  browser.on('request-open', () => { if (getSettings().browser?.autoOpen !== false) send('browser-open', {}); });
  try { skills.seedSkills(); } catch (e) { console.error('skills', e); }
  engine = new Engine({ getSettings, getHardware: () => scanHardware(), requestApproval, askUser, webKeys: () => ({ brave: secret('brave'), tavily: secret('tavily') }) });
  engine.on('message', (p) => send('message', p));
  engine.on('chat-meta', (p) => send('chat-meta', p));
  engine.on('run-end', (p) => { send('run-end', p); endComputerUse(); });
  engine.on('computer-use', () => startComputerUse());
  scanHardware().catch(() => { });
  mcp.connectAll().catch(() => { });
  autoDetectLocalServers().catch(() => { });
}

async function autoDetectLocalServers() {
  const list = providers.listProviders();
  for (const [type, url] of [['ollama', 'http://127.0.0.1:11434/v1/models'], ['lmstudio', 'http://127.0.0.1:1234/v1/models']]) {
    if (list.find((p) => p.type === type)) continue;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (r.ok) { const p = providers.upsertProvider({ type }); await providers.fetchModels(p.id).catch(() => { }); send('providers-changed', {}); }
    } catch { }
  }
}

// ───────────────── Aprobaciones de herramientas ─────────────────
function requestApproval(req) {
  return new Promise((resolve) => {
    const id = uid('ap_');
    pendingApprovals.set(id, resolve);
    send('approval', { id, ...req });
    if (win && !win.isVisible() && !overlay) { win.show(); }
    if (win && !win.isFocused() && !overlay) win.flashFrame(true);
  });
}

// ───────────────── Preguntas del agente al usuario (ask_user) ─────────────────
function askUser(req, signal) {
  return new Promise((resolve) => {
    const id = uid('q_');
    const done = (answer) => { if (!pendingQuestions.has(id)) return; pendingQuestions.delete(id); send('question-done', { id }); resolve(answer); };
    pendingQuestions.set(id, done);
    signal?.addEventListener('abort', () => done(null), { once: true });
    send('question', { id, ...req });
    if (win && !win.isVisible() && !overlay) win.show();
    if (win && !win.isFocused() && !overlay) win.flashFrame(true);
  });
}

// ───────────────── Control del PC: superposición de seguridad ─────────────────
let computerActive = false, wasMinimized = false;
function startComputerUse() {
  if (computerActive) return;
  computerActive = true;
  const s = getSettings();
  if (s.computer?.hideWindow !== false && win && !win.isMinimized()) { wasMinimized = true; win.minimize(); }
  const d = screen.getPrimaryDisplay();
  overlay = new BrowserWindow({
    width: 460, height: 64, x: Math.round(d.workArea.x + d.workArea.width / 2 - 230), y: d.workArea.y + 12,
    frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, resizable: false, focusable: true, hasShadow: false, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, backgroundThrottling: false }
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  try { overlay.setContentProtection(true); } catch { }
  overlay.loadFile(RENDERER, { hash: 'overlay' });
  overlay.once('ready-to-show', () => overlay?.showInactive());
  overlay.on('closed', () => { overlay = null; });
  try { globalShortcut.register('CommandOrControl+Alt+Q', () => { for (const id of engine.runs.keys()) engine.stop(id); }); } catch { }
}
function endComputerUse() {
  if (!computerActive) return;
  if (engine && engine.runs.size) return;
  computerActive = false;
  try { globalShortcut.unregister('CommandOrControl+Alt+Q'); } catch { }
  if (overlay && !overlay.isDestroyed()) overlay.close();
  overlay = null;
  if (wasMinimized && win) { win.restore(); win.focus(); }
  wasMinimized = false;
}

// ───────────────── Utilidades de archivos adjuntos ─────────────────
const TEXT_EXT = /\.(txt|md|markdown|json|jsonl|csv|tsv|xml|html?|css|scss|js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|c|h|cpp|hpp|cs|php|sh|bat|ps1|yml|yaml|toml|ini|cfg|conf|log|sql|swift|lua|r|m|vue|svelte|tex|srt|vtt|env|gitignore|dockerfile)$/i;
const IMG_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp' };
function fileToAttachment(p) {
  const st = fs.statSync(p);
  const ext = path.extname(p).toLowerCase();
  const name = path.basename(p);
  if (IMG_MIME[ext] && st.size < 20e6) return { kind: 'image', name, mime: IMG_MIME[ext], data: fs.readFileSync(p).toString('base64'), size: st.size };
  if ((TEXT_EXT.test(name) || st.size < 2e5) && st.size < 5e6) {
    const buf = fs.readFileSync(p);
    if (!buf.subarray(0, 4000).includes(0)) return { kind: 'text', name, text: buf.toString('utf8'), size: st.size, path: p };
  }
  return { kind: 'file', name, path: p, size: st.size };
}

// ───────────────── API expuesta a la interfaz ─────────────────
const api = {
  // App
  'app.info': () => ({ version: app.getVersion(), platform: process.platform, arch: process.arch, configured: paths.isConfigured(), dataDir: paths.getDataDir(), defaultDataDir: paths.defaultDataDir(), isPackaged: app.isPackaged, home: os.homedir(), electron: process.versions.electron }),
  'app.chooseFolder': async (title, defaultPath) => { const r = await dialog.showOpenDialog(win, { title: title || 'Elegir carpeta', defaultPath, properties: ['openDirectory', 'createDirectory'] }); return r.canceled ? null : r.filePaths[0]; },
  'app.setDataDir': async (d, { move } = {}) => {
    const old = paths.getDataDir();
    if (move && old && old !== d) {
      await llama.stopAll(); await voice.stopWhisper();
      flushAll(); chats.flushChats();
      fs.cpSync(old, d, { recursive: true, force: false, errorOnExist: false });
    }
    paths.setDataDir(d);
    if (initialized && old !== d) { resetCache(); app.relaunch(); app.exit(0); return d; }
    await initCore();
    return d;
  },
  'app.disk': (p) => paths.diskFree(p || paths.getDataDir() || os.homedir()),
  'app.storage': () => ({ models: dirSize(paths.dir('models')), runtimes: dirSize(paths.dir('runtimes')), voice: dirSize(paths.dir('voice')), chats: dirSize(paths.dir('chats')) + dirSize(paths.dir('attachments')), disk: paths.diskFree(paths.getDataDir()) }),
  'app.openPath': (p) => shell.openPath(p),
  'app.openExternal': (u) => shell.openExternal(u),
  'app.showItem': (p) => shell.showItemInFolder(p),
  'app.pickFiles': async (opts = {}) => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', ...(opts.multi === false ? [] : ['multiSelections'])], filters: opts.filters });
    if (r.canceled) return [];
    return opts.raw ? r.filePaths : r.filePaths.map(fileToAttachment);
  },
  'app.readDropped': (list) => list.map((p) => { try { return fileToAttachment(p); } catch (e) { return { kind: 'error', name: path.basename(p), error: e.message }; } }),
  'app.relaunch': () => { app.relaunch(); app.exit(0); },
  'app.setTheme': (theme) => { nativeTheme.themeSource = theme === 'light' ? 'light' : theme === 'system' ? 'system' : 'dark'; updateOverlayColors(); },
  'app.setLoginItem': (v) => { app.setLoginItemSettings({ openAtLogin: !!v, args: ['--hidden'], name: 'Nexo AI' }); },

  // Ajustes
  'settings.get': () => { const s = getSettings(); return { ...s, secrets: Object.fromEntries(Object.entries(s.secrets || {}).map(([k, v]) => [k, v ? '••••••••' : ''])) }; },
  'settings.set': (patch) => {
    const s = getSettings();
    const { secrets: sec, ...rest } = patch;
    for (const [k, v] of Object.entries(rest)) s[k] = v && typeof v === 'object' && !Array.isArray(v) && s[k] && typeof s[k] === 'object' ? { ...s[k], ...v } : v;
    save('settings', s, true);
    if (patch.voice?.hotkey !== undefined) registerHotkey();
    if (patch.launchAtLogin !== undefined) app.setLoginItemSettings({ openAtLogin: !!patch.launchAtLogin, args: ['--hidden'], name: 'Nexo AI' });
    return api['settings.get']();
  },
  'settings.setSecret': (name, value) => { const s = getSettings(); s.secrets = s.secrets || {}; s.secrets[name] = value ? encrypt(value) : ''; save('settings', s, true); if (name === 'elevenlabs') voice.setElevenKey(value); return true; },

  // Hardware
  'hw.scan': (force) => scanHardware(force),
  'hw.live': () => liveStats(),

  // Catálogo y modelos
  'catalog.get': () => models.getCatalog(),
  'catalog.refresh': () => models.refreshCatalogLive(),
  'catalog.discover': async () => { const r = await models.discoverNewModels(); send('catalog-changed', r); return r; },
  'catalog.lastDiscover': () => models.lastDiscover(),
  'catalog.repo': (repo, quant) => models.repoDetails(repo, { quant }),
  'catalog.search': (q, sort) => models.searchHF(q, { sort }),
  'models.local': async () => { const l = await models.listLocalModels(); if (engine) engine.localCache = { t: Date.now(), list: l }; return l; },
  'models.download': (opts) => models.downloadModel(opts),
  'models.delete': async (id) => { const l = await models.listLocalModels(); const m = l.find((x) => x.id === id); if (!m) return; await llama.stop(id); models.deleteLocalModel(m); send('models-changed', {}); },
  'models.settings': (id, s) => models.setModelSettings(id, s),
  'models.favorite': (id) => models.toggleFavorite(id),
  'models.addDir': async (d) => { const dirp = d || await api['app.chooseFolder']('Carpeta con modelos GGUF'); if (dirp) models.addExtraDir(dirp); send('models-changed', {}); return dirp; },
  'models.removeDir': (d) => { models.removeExtraDir(d); send('models-changed', {}); },
  'models.extraDirs': () => ({ dirs: models.getExtraDirs(), lmstudio: models.lmStudioDirs() }),
  'models.import': async () => { const files = await api['app.pickFiles']({ raw: true, filters: [{ name: 'Modelos GGUF', extensions: ['gguf'] }] }); for (const f of files) await models.importGGUF(f); send('models-changed', {}); return files.length; },
  'models.plan': async (id, opts = {}) => {
    const m = (await models.listLocalModels()).find((x) => x.id === id);
    if (!m) throw new Error('Modelo no encontrado');
    const live = await llama.planFor(m, opts);
    const hw = await scanHardware();
    const statik = planModel(m.meta, staticBudget(hw), { ctx: live.ctx, kvType: live.kvType, fileSize: m.size });
    const b = await llama.budget(m.id);
    const mm = m.mmproj && m.settings?.vision !== false ? fs.statSync(m.mmproj).size : 0;
    const rec = recommendContext(m.meta, b, { fileSize: m.size, mmprojSize: mm });
    return { live, static: statik, rec };
  },
  'models.planMulti': async (refs, ctx) => {
    const l = await models.listLocalModels();
    const items = refs.map((r) => l.find((x) => `local:${x.id}` === r || x.id === r)).filter(Boolean).map((m) => ({ id: m.id, meta: m.meta, fileSize: m.size, ctx: ctx || m.settings?.ctx || getSettings().ctx || 8192, mmprojSize: m.mmproj ? fs.statSync(m.mmproj).size : 0 }));
    const hw = await scanHardware();
    return { ...planMulti(items, staticBudget(hw)), names: Object.fromEntries(items.map((i) => [i.id, l.find((x) => x.id === i.id)?.name])) };
  },

  // Instancias locales
  'llama.list': () => llama.list(),
  'llama.load': async (id, opts) => { const m = (await models.listLocalModels()).find((x) => x.id === id); if (!m) throw new Error('Modelo no encontrado'); await llama.ensureLoaded(m, opts); return llama.list(); },
  'llama.unload': (id) => llama.stop(id),
  'llama.unloadAll': () => llama.stopAll(),
  'llama.logs': (id) => llama.logs(id),

  // Motores
  'rt.get': () => ({ ...runtimes.getRuntimes(), backends: runtimes.LLAMA_BACKENDS, whisperModels: runtimes.WHISPER_MODELS, piperVoices: runtimes.PIPER_VOICES, installedVoices: runtimes.installedVoices(), active: runtimes.activeLlama() }),
  'rt.installLlama': (backend) => runtimes.installLlama(backend),
  'rt.setActive': (id) => { runtimes.setActiveLlama(id); llama.helpCache.clear(); },
  'rt.remove': (id) => runtimes.removeLlama(id),
  'rt.setCustom': async (p) => { const f = p === undefined ? (await api['app.pickFiles']({ raw: true, multi: false }))[0] : p; runtimes.setCustomLlama(f || ''); return f; },
  'rt.checkUpdate': () => runtimes.checkLlamaUpdate(),
  'rt.installWhisper': (gpu) => runtimes.installWhisper(gpu),
  'rt.whisperModel': (id) => runtimes.downloadWhisperModel(id),
  'rt.installPiper': () => runtimes.installPiper(),
  'rt.piperVoice': (id) => runtimes.downloadPiperVoice(id),

  // Descargas
  'dl.list': () => downloads.list(),
  'dl.pause': (id) => downloads.pause(id),
  'dl.resume': (id) => downloads.resume(id),
  'dl.cancel': (id) => downloads.cancel(id),
  'dl.clear': () => downloads.clearFinished(),

  // Proveedores
  'prov.types': () => providers.PROVIDER_TYPES,
  'prov.list': () => providers.listProviders(),
  'prov.upsert': (p) => { const r = providers.upsertProvider(p); send('providers-changed', {}); return r; },
  'prov.remove': (id) => { providers.removeProvider(id); send('providers-changed', {}); },
  'prov.models': async (id) => { const r = await providers.fetchModels(id); send('providers-changed', {}); return r; },
  'prov.test': (id) => providers.testProvider(id),
  'prov.detect': () => autoDetectLocalServers(),

  // Chats
  'chats.list': () => chats.listChats(),
  // copia sin campos internos (_pending es un temporizador del motor y no se puede enviar por IPC si el chat está respondiendo)
  'chats.get': (id) => { const c = chats.getChat(id); return c ? JSON.parse(JSON.stringify(c, (k, v) => (k.startsWith('_') ? undefined : v))) : c; },
  'chats.create': (d) => chats.createChat({ agentId: getSettings().defaultAgent, model: getSettings().defaultModel, ...d }),
  'chats.update': (id, patch) => chats.updateChat(id, patch),
  'chats.delete': (id) => { engine?.stop(id); chats.deleteChat(id); },
  'chats.search': (q) => chats.searchChats(q),
  'chats.export': async (id) => {
    const md = chats.exportMarkdown(id);
    const c = chats.getChat(id);
    const r = await dialog.showSaveDialog(win, { defaultPath: `${(c?.title || 'chat').replace(/[\\/:*?"<>|]/g, '_')}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (!r.canceled) fs.writeFileSync(r.filePath, md);
    return !r.canceled;
  },
  'chats.send': (id, payload) => { engine.send(id, payload).catch((e) => send('toast', { type: 'error', text: e.message })); return true; },
  'chats.stop': (id) => engine.stop(id),
  'chats.running': () => [...(engine?.runs.keys() || [])],
  'chats.regenerate': (id, index) => { engine.send(id, { regenerateFrom: index }).catch((e) => send('toast', { type: 'error', text: e.message })); return true; },
  'chats.editResend': (id, index, text) => {
    const c = chats.getChat(id);
    const m = c.messages[index];
    if (!m || m.role !== 'user') throw new Error('Mensaje no editable');
    m.content = text;
    c.messages = c.messages.slice(0, index + 1);
    chats.saveChat(c, true);
    engine.send(id, { regenerateFrom: index + 1 }).catch((e) => send('toast', { type: 'error', text: e.message }));
    return true;
  },
  'chats.deleteMessage': (id, index) => { const c = chats.getChat(id); c.messages.splice(index, 1); chats.saveChat(c, true); return c; },
  'chats.modelLabel': (ref) => engine.modelLabel(ref),

  // Agentes, skills, memoria
  'agents.list': () => agents.listAgents(),
  'agents.save': (a) => agents.saveAgent(a),
  'agents.delete': (id) => agents.deleteAgent(id),
  'agents.reset': (id) => agents.resetAgent(id),
  'agents.groups': () => agents.TOOL_GROUPS,
  'skills.list': () => skills.listSkills(),
  'skills.get': (id) => skills.getSkill(id),
  'skills.save': (s) => skills.saveSkill(s),
  'skills.saveRaw': (id, c) => skills.saveSkillRaw(id, c),
  'skills.delete': (id) => skills.deleteSkill(id),
  'skills.toggle': (id, v) => skills.toggleSkill(id, v),
  'skills.import': async () => { const d = await api['app.chooseFolder']('Carpeta de la skill (con SKILL.md)'); return d ? skills.importSkillFolder(d) : null; },
  'skills.openFolder': () => shell.openPath(paths.dir('skills')),
  'memory.list': () => agents.listMemory(),
  'memory.add': (t) => agents.addMemory(t),
  'memory.delete': (id) => agents.deleteMemory(id),
  'memory.update': (id, t) => agents.updateMemory(id, t),
  'memory.enabled': (v) => agents.setMemoryEnabled(v),

  // MCP
  'mcp.list': () => mcp.list(),
  'mcp.presets': () => MCP_PRESETS,
  'mcp.upsert': (s) => mcp.upsert(s),
  'mcp.remove': (id) => mcp.remove(id),
  'mcp.addPreset': (id) => mcp.addPreset(id),
  'mcp.import': (json) => mcp.importConfig(json),
  'mcp.importClaude': () => { const p = mcp.claudeDesktopConfigPath(); if (!p) throw new Error('No se encontró la configuración de Claude Desktop'); return mcp.importConfig(fs.readFileSync(p, 'utf8')); },
  'mcp.export': () => mcp.exportConfig(),
  'mcp.restart': (id) => mcp.restart(id),

  // Navegador
  'browser.show': (b) => browser.show(b),
  'browser.hide': () => browser.hide(),
  'browser.navigate': (u) => browser.navigate(u),
  'browser.back': () => browser.back(),
  'browser.forward': () => browser.forward(),
  'browser.reload': () => browser.reload(),
  'browser.state': () => browser.state(),

  // Voz
  'voice.transcribe': (b64, opts) => { const s = getSettings().voice; return voice.transcribe(Buffer.from(b64, 'base64'), { engine: s.stt, model: s.whisperModel, language: s.language, ...opts }); },
  'voice.synthesize': (text, opts) => { const s = getSettings().voice; return voice.synthesize(text, { engine: s.tts, voice: s.piperVoice, speed: s.rate, openaiVoice: s.openaiVoice, elevenVoice: s.elevenVoice, ...opts }); },
  'voice.stop': () => voice.stopWhisper(),

  // Aprobaciones
  'question.respond': (id, answer) => { pendingQuestions.get(id)?.(answer || null); },
  'chats.rewind': (id, messageId) => engine.rewind(id, messageId),
  'chats.clearSummary': (id) => { const c = chats.getChat(id); if (c) { delete c.summary; chats.saveChat(c, true); } return true; },
  'opencode.status': () => opencode.status(getSettings().opencode?.path),
  'opencode.models': (force) => opencode.listModels({ custom: getSettings().opencode?.path, force }),
  'opencode.state': () => opencode.readState(),
  'opencode.newSession': (id) => { const c = chats.getChat(id); if (c) { delete c.opencodeSession; chats.saveChat(c, true); } return true; },
  'approval.respond': (id, decision) => { const r = pendingApprovals.get(id); if (r) { pendingApprovals.delete(id); r(decision); send('approval-done', { id }); } },
  'overlay.stop': () => { for (const id of engine.runs.keys()) engine.stop(id); },

  // Ventana
  'win.show': () => { win?.show(); win?.focus(); },
  'win.hide': () => win?.hide()
};

ipcMain.handle('nexo:call', async (_e, method, ...args) => {
  const fn = api[method];
  if (!fn) throw new Error('Método desconocido: ' + method);
  try { return await fn(...args); } catch (e) { throw new Error(e?.message || String(e)); }
});

// ───────────────── Ventana ─────────────────
function overlayColors() {
  const dark = getSafeTheme() !== 'light';
  return { color: '#00000000', symbolColor: dark ? '#d4d4d8' : '#3f3f46', height: 44 };
}
function getSafeTheme() { try { return paths.isConfigured() ? getSettings().theme : 'dark'; } catch { return 'dark'; } }
function updateOverlayColors() { try { if (win && !isMac) win.setTitleBarOverlay(overlayColors()); } catch { } }

function createWindow() {
  const theme = getSafeTheme();
  nativeTheme.themeSource = theme === 'light' ? 'light' : theme === 'system' ? 'system' : 'dark';
  win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 980, minHeight: 640, show: false,
    backgroundColor: theme === 'light' ? '#faf9f5' : '#262624',
    title: 'Nexo AI', icon: fs.existsSync(ICON) ? ICON : undefined,
    titleBarStyle: 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 16, y: 15 } } : { titleBarOverlay: overlayColors() }),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: true }
  });
  browser.attach(win);
  win.loadFile(RENDERER);
  win.once('ready-to-show', () => { if (!process.argv.includes('--hidden')) win.show(); });
  win.on('close', (e) => {
    if (!quitting && getSafeCloseToTray()) { e.preventDefault(); win.hide(); }
  });
  win.webContents.on('console-message', (e) => { if (e.level === 'error') console.error('[interfaz]', e.message, e.sourceId ? `(${e.sourceId}:${e.lineNumber})` : ''); });
  win.webContents.on('render-process-gone', (_e, d) => console.error('[interfaz] proceso de renderizado terminado:', d));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); shell.openExternal(url); } });
}
function getSafeCloseToTray() { try { return paths.isConfigured() && getSettings().closeToTray && !!tray; } catch { return false; } }

function createTray() {
  const iconPath = path.join(APP_ROOT, 'resources', 'tray.png');
  const img = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  tray = new Tray(img.isEmpty() ? nativeImage.createFromPath(path.join(APP_ROOT, 'resources', 'icon.png')).resize({ width: 16 }) : img);
  tray.setToolTip('Nexo AI');
  const menu = Menu.buildFromTemplate([
    { label: 'Abrir Nexo AI', click: () => { win.show(); win.focus(); } },
    { label: 'Nuevo chat', click: () => { win.show(); send('command', 'new-chat'); } },
    { label: 'Hablar (modo voz)', click: () => { win.show(); send('command', 'voice'); } },
    { label: 'Modo JARVIS (manos libres)', click: () => send('command', 'jarvis-toggle') },
    { type: 'separator' },
    { label: 'Salir', click: () => { quitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => { if (win.isVisible() && win.isFocused()) win.hide(); else { win.show(); win.focus(); } });
}

function registerHotkey() {
  try { globalShortcut.unregisterAll(); } catch { }
  if (!paths.isConfigured()) return;
  const hk = getSettings().voice?.hotkey;
  if (hk) {
    try { globalShortcut.register(hk, () => { send('command', 'voice-hotkey'); }); } catch (e) { console.error('hotkey', e); }
  }
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });

/** Acceso directo del menú Inicio con AppUserModelID (necesario para las notificaciones de Windows). */
function ensureWindowsShortcut() {
  try {
    const lnk = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Nexo AI.lnk');
    const opts = { target: process.execPath, cwd: path.dirname(process.execPath), appUserModelId: 'ai.nexo.studio', description: 'Nexo AI', icon: process.execPath, iconIndex: 0 };
    let needs = true;
    if (fs.existsSync(lnk)) { try { const cur = shell.readShortcutLink(lnk); needs = cur.target !== process.execPath || cur.appUserModelId !== 'ai.nexo.studio'; } catch { } }
    if (needs) shell.writeShortcutLink(lnk, fs.existsSync(lnk) ? 'replace' : 'create', opts);
  } catch (e) { console.error('shortcut', e); }
}

app.whenReady().then(async () => {
  if (isWin && app.isPackaged) ensureWindowsShortcut();
  protocol.handle('nexo', (req) => {
    const u = new URL(req.url);
    const p = decodeURIComponent(u.pathname.replace(/^\//, ''));
    const full = path.resolve(isWin ? p : '/' + p.replace(/^\/+/, ''));
    const root = paths.getDataDir();
    if (!root || !full.startsWith(path.resolve(root))) return new Response('Prohibido', { status: 403 });
    return net.fetch(pathToFileURL(full).toString());
  });
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(['media', 'clipboard-read', 'clipboard-sanitized-write', 'notifications', 'fullscreen'].includes(permission)));
  session.defaultSession.setPermissionCheckHandler((wc, permission) => ['media', 'clipboard-read', 'clipboard-sanitized-write', 'notifications'].includes(permission));
  if (paths.loadLocation()) await initCore();
  createWindow();
  try { createTray(); } catch (e) { console.error('tray', e); }
  registerHotkey();
  if (isMac) app.dock?.setIcon?.(path.join(APP_ROOT, 'resources', 'icon.png'));
  scheduleCatalogDiscovery();
});

// Busca modelos recién lanzados al arrancar (si hace más de 24 h) y cada 6 h mientras Nexo esté abierto
function scheduleCatalogDiscovery() {
  const check = async () => {
    if (!paths.getDataDir() || getSettings().autoDiscoverModels === false) return;
    const last = models.lastDiscover();
    if (last && Date.now() - new Date(last).getTime() < 24 * 3600e3) return;
    try {
      const r = await models.discoverNewModels();
      send('catalog-changed', r);
      if (r.added.length) send('toast', { text: `Nuevos modelos en el catálogo: ${r.added.slice(0, 4).join(', ')}${r.added.length > 4 ? ` y ${r.added.length - 4} más` : ''}`, type: 'info' });
    } catch (e) { console.error('catalog discover', e); }
  };
  setTimeout(check, 30e3);
  setInterval(check, 6 * 3600e3);
}

app.on('before-quit', () => { quitting = true; });
app.on('will-quit', async (e) => {
  globalShortcut.unregisterAll();
  if (app._nexoCleaned) return;
  e.preventDefault();
  app._nexoCleaned = true;
  try { flushAll(); chats.flushChats(); } catch { }
  shutdownInput();
  await Promise.race([Promise.allSettled([llama.stopAll(), voice.stopWhisper(), mcp.disconnectAll()]), new Promise((r) => setTimeout(r, 4000))]);
  app.quit();
});
app.on('window-all-closed', () => { if (!isMac && !tray) app.quit(); });
app.on('activate', () => { if (win) win.show(); });
process.on('uncaughtException', (e) => console.error('uncaught', e));
process.on('unhandledRejection', (e) => console.error('unhandled', e));
