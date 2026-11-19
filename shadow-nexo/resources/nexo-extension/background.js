// Nexo AI — extensión de Chrome. Se conecta por WebSocket local (127.0.0.1) con la app Nexo y ejecuta
// sus órdenes (navegar, leer, clic, escribir…) en una pestaña de TU Chrome, con tus sesiones iniciadas.
const PORT = 47615;
let ws = null, nexoTab = null;
// Chrome duerme el service worker y se pierde la memoria: la pestaña y el grupo de Nexo se guardan en la sesión.
const store = chrome.storage?.session;
const save = () => { try { store?.set({ nexoTab, groupId }); } catch { /* */ } };
const restored = (async () => { try { const v = await store?.get(['nexoTab', 'groupId']); if (v) { if (nexoTab == null && v.nexoTab != null) nexoTab = v.nexoTab; if (groupId == null && v.groupId != null) groupId = v.groupId; } } catch { /* */ } })();
// Historial propio de la pestaña de Nexo: Chrome ignora al ir "atrás" las entradas creadas sin gesto del usuario (como las de un agente).
let hist = [], hp = -1, skipNext = false;
chrome.tabs.onUpdated.addListener((id, change) => {
  if (id !== nexoTab || !change.url || change.url === 'about:blank') return;
  if (skipNext) { skipNext = false; return; }
  if (hist[hp] !== change.url) { hist.splice(hp + 1); hist.push(change.url); hp = hist.length - 1; }
});
async function go(dir) {
  const t = await getTab();
  const to = hp + dir;
  if (to < 0 || to >= hist.length) return state();
  hp = to; skipNext = true;
  await chrome.tabs.update(t.id, { url: hist[hp] });
  await waitLoaded(t.id, 8000);
  return state();
}

async function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  try { ws = new WebSocket(`ws://127.0.0.1:${PORT}`); } catch { return; }
  ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', role: 'ext' }));
  ws.onmessage = async (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (!m.id || !m.op) return;
    try { ws.send(JSON.stringify({ id: m.id, ok: true, result: await handle(m.op, m.args || {}) })); }
    catch (e) { ws.send(JSON.stringify({ id: m.id, ok: false, error: String(e?.message || e) })); }
  };
  ws.onclose = () => { ws = null; setTimeout(connect, 2500); };
  ws.onerror = () => { try { ws.close(); } catch { /* */ } };
}
chrome.alarms.create('nexo-keepalive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => connect());
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
chrome.runtime.onMessage.addListener((m, _s, reply) => {
  if (m.type === 'stop') { try { ws?.send(JSON.stringify({ type: 'stop' })); } catch { /* */ } }
  if (m.type === 'status') reply({ connected: !!ws && ws.readyState === WebSocket.OPEN });
  if (m.type === 'reconnect') { try { ws?.close(); } catch { /* */ } ws = null; connect().then(() => reply(true)); return true; }
});
connect();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Latido: mantiene despierto el service worker mientras Nexo está abierto.
setInterval(() => { try { if (ws && ws.readyState === WebSocket.OPEN) ws.send('{"type":"ping"}'); else connect(); } catch { /* */ } }, 20000);

// Las pestañas de trabajo de Nexo van en un grupo propio ("Nexo AI"), como el de Claude.
var groupId = null;
async function groupTab(tabId) {
  try {
    if (groupId != null) { try { await chrome.tabGroups.get(groupId); } catch { groupId = null; } }
    groupId = await chrome.tabs.group(groupId != null ? { tabIds: tabId, groupId } : { tabIds: tabId });
    await chrome.tabGroups.update(groupId, { title: 'Nexo AI', color: 'purple', collapsed: false });
    save();
  } catch { /* tabGroups no disponible */ }
}
chrome.tabs.onCreated.addListener((t) => { if (nexoTab != null && t.openerTabId === nexoTab) groupTab(t.id); });

async function getTab(create = false, url) {
  await restored;
  if (nexoTab != null) { try { return await chrome.tabs.get(nexoTab); } catch { nexoTab = null; } }
  if (!create) throw new Error('Aún no hay una pestaña de Nexo: usa action=navigate primero.');
  // Ventana propia de Nexo, sin enfocar: tú sigues en tu pestaña y la de Nexo sigue "visible" para la página (no se duerme).
  let t;
  try {
    const w = await chrome.windows.create({ url: url || 'about:blank', focused: false, type: 'normal', width: 1180, height: 800 });
    t = w.tabs?.[0] || (await chrome.tabs.query({ windowId: w.id }))[0];
    try { await chrome.windows.update(w.id, { focused: false, drawAttention: false }); } catch { /* */ }
  } catch {
    t = await chrome.tabs.create({ url: url || 'about:blank', active: false }); // sin ventanas nuevas: pestaña en segundo plano
    await groupTab(t.id);
  }
  nexoTab = t.id; save();
  return t;
}

async function waitLoaded(tabId, max = 30000, settle = 300) {
  const t0 = Date.now();
  await sleep(120);
  let t = await chrome.tabs.get(tabId);
  if (t.status === 'complete') return; // no hay navegación en curso (p. ej. una SPA): sin esperas extra
  while (Date.now() - t0 < max) {
    await sleep(100);
    t = await chrome.tabs.get(tabId);
    if (t.status === 'complete') break;
  }
  await sleep(settle);
}

async function state() {
  const t = await getTab(false).catch(() => null);
  return t ? { url: t.url || '', title: t.title || '' } : { url: '', title: '' };
}

async function page(name, args) {
  const t = await getTab(false);
  if (/^(chrome|edge|about|chrome-extension):/.test(t.url || '') && name !== 'ping') throw new Error('Esta página del navegador no se puede controlar. Navega a una web normal.');
  await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['read.js', 'content.js'] });
  const [r] = await chrome.scripting.executeScript({ target: { tabId: t.id }, func: (n, a) => window.__nexo[n](...a), args: [name, args] });
  return r?.result;
}

// Eventos reales (de confianza) vía el depurador de Chrome: muchas webs (Flow, Gmail…) ignoran los clics simulados.
const attached = new Set();
async function dbg(method, params) {
  const t = await getTab();
  if (!attached.has(t.id)) {
    // Tras dormirse el service worker el depurador puede seguir enganchado: no es un error.
    try { await chrome.debugger.attach({ tabId: t.id }, '1.3'); } catch (e) { if (!/already attached/i.test(String(e?.message || e))) throw e; }
    attached.add(t.id);
    // La página cree que tiene el foco aunque el usuario esté en otra ventana/pestaña (sigue renderizando y respondiendo).
    try { await chrome.debugger.sendCommand({ tabId: t.id }, 'Emulation.setFocusEmulationEnabled', { enabled: true }); } catch { /* */ }
  }
  return chrome.debugger.sendCommand({ tabId: t.id }, method, params);
}
chrome.debugger.onDetach.addListener((src) => attached.delete(src.tabId));
const KEYS = { Enter: [13, 'Enter', '\r'], Tab: [9, 'Tab'], Escape: [27, 'Escape'], Backspace: [8, 'Backspace'], Delete: [46, 'Delete'], ArrowDown: [40, 'ArrowDown'], ArrowUp: [38, 'ArrowUp'], ArrowLeft: [37, 'ArrowLeft'], ArrowRight: [39, 'ArrowRight'], Home: [36, 'Home'], End: [35, 'End'], PageDown: [34, 'PageDown'], PageUp: [33, 'PageUp'], ' ': [32, 'Space', ' '] };

async function handle(op, a) {
  switch (op) {
    case 'ping': return { version: chrome.runtime.getManifest().version };
    case 'reload': setTimeout(() => chrome.runtime.reload(), 250); return true; // Nexo copió una versión nueva a la carpeta de la extensión
    case 'navigate': {
      const t = await getTab(true, a.url);
      // Sin traer la pestaña ni la ventana al frente: el usuario puede seguir trabajando en otra.
      await chrome.tabs.update(t.id, { url: a.url });
      await waitLoaded(t.id);
      return state();
    }
    case 'state': return state();
    case 'cdpClick': {
      const button = a.button === 'right' || a.button === 'middle' ? a.button : 'left', n = Math.max(1, Math.min(3, a.count | 0 || 1));
      const mask = button === 'right' ? 2 : button === 'middle' ? 4 : 1;
      await dbg('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x, y: a.y });
      for (let i = 1; i <= n; i++) {
        await dbg('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button, buttons: mask, clickCount: i });
        await dbg('Input.dispatchMouseEvent', { type: 'mouseReleased', x: a.x, y: a.y, button, buttons: 0, clickCount: i });
      }
      return true;
    }
    case 'cdpType': await dbg('Input.insertText', { text: String(a.text) }); return true;
    case 'cdpKey': {
      // Admite combinaciones: "Control+a", "Shift+Tab", "Control+Shift+k"
      const parts = String(a.key).split('+').map((p) => p.trim()).filter(Boolean);
      const key0 = String(a.key) === '+' ? '+' : parts.pop() || String(a.key);
      const MOD = { alt: 1, option: 1, control: 2, ctrl: 2, meta: 4, cmd: 4, command: 4, win: 4, shift: 8 };
      let modifiers = 0; for (const p of parts) modifiers |= MOD[p.toLowerCase()] || 0;
      const alias = { enter: 'Enter', return: 'Enter', esc: 'Escape', escape: 'Escape', tab: 'Tab', backspace: 'Backspace', delete: 'Delete', del: 'Delete', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', space: ' ', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown' };
      const key = alias[key0.toLowerCase()] || key0;
      const k = KEYS[key] || [key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0, key.length === 1 ? 'Key' + key.toUpperCase() : key, key.length === 1 ? key : undefined];
      const text = modifiers & 7 ? undefined : k[2]; // con Ctrl/Alt/Meta es un atajo, no texto
      const base = { key, code: k[1], windowsVirtualKeyCode: k[0], nativeVirtualKeyCode: k[0], modifiers };
      await dbg('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, text });
      if (text) await dbg('Input.dispatchKeyEvent', { type: 'char', ...base, text });
      await dbg('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
      return true;
    }
    case 'page': return page(a.name, a.args || []);
    case 'back': return go(-1);
    case 'forward': return go(1);
    case 'idle': { const t = await getTab(); await waitLoaded(t.id, a.max || 6000); return state(); }
    case 'screenshot': {
      const t = await getTab();
      // Por el depurador se captura sin traer la pestaña al frente (aunque esté en segundo plano)
      try { const r = await dbg('Page.captureScreenshot', { format: 'jpeg', quality: 78 }); if (r?.data) return { data: r.data, mime: 'image/jpeg' }; } catch { /* captura normal */ }
      // Respaldo: solo si la pestaña ya es la visible de su ventana (la de Nexo lo es); no se roba el foco al usuario
      const url = await chrome.tabs.captureVisibleTab(t.windowId, { format: 'jpeg', quality: 78 });
      return { data: url.split(',')[1], mime: 'image/jpeg' };
    }
    case 'evaluate': {
      const t = await getTab();
      const [r] = await chrome.scripting.executeScript({ target: { tabId: t.id }, world: 'MAIN', args: [a.script], func: (code) => { try { return JSON.stringify((0, eval)(code)) ?? 'undefined'; } catch (e) { return 'Error: ' + e.message + ' (la página puede bloquear eval)'; } } });
      // Si la página bloquea eval (CSP), se evalúa por el depurador de Chrome, que no depende de ella
      if (typeof r?.result === 'string' && /^Error: .*(unsafe-eval|Content Security Policy|EvalError|Refused to evaluate)/i.test(r.result)) {
        try {
          const v = await dbg('Runtime.evaluate', { expression: String(a.script), returnByValue: true, awaitPromise: true, userGesture: true });
          if (v?.exceptionDetails) return 'Error: ' + (v.exceptionDetails.exception?.description || v.exceptionDetails.text || 'excepción');
          return JSON.stringify(v?.result?.value) ?? 'undefined';
        } catch { /* se devuelve el error original */ }
      }
      return r?.result;
    }
    default: throw new Error('Operación desconocida: ' + op);
  }
}
