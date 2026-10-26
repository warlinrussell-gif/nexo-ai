// Nexo AI — extensión de Chrome. Se conecta por WebSocket local (127.0.0.1) con la app Nexo y ejecuta
// sus órdenes (navegar, leer, clic, escribir…) en una pestaña de TU Chrome, con tus sesiones iniciadas.
const PORT = 47615;
let ws = null, nexoTab = null;
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

async function code() { return (await chrome.storage.local.get('code')).code || ''; }

async function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const c = await code();
  if (!c) return;
  try { ws = new WebSocket(`ws://127.0.0.1:${PORT}`); } catch { return; }
  ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', role: 'ext', code: c }));
  ws.onmessage = async (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (!m.id || !m.op) return;
    try { ws.send(JSON.stringify({ id: m.id, ok: true, result: await handle(m.op, m.args || {}) })); }
    catch (e) { ws.send(JSON.stringify({ id: m.id, ok: false, error: String(e?.message || e) })); }
  };
  ws.onclose = () => { ws = null; };
  ws.onerror = () => { try { ws.close(); } catch { /* */ } };
}
chrome.alarms.create('nexo-keepalive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => connect());
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
chrome.runtime.onMessage.addListener((m, _s, reply) => {
  if (m.type === 'status') reply({ connected: !!ws && ws.readyState === WebSocket.OPEN });
  if (m.type === 'reconnect') { try { ws?.close(); } catch { /* */ } ws = null; connect().then(() => reply(true)); return true; }
});
connect();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTab(create = false, url) {
  if (nexoTab != null) { try { return await chrome.tabs.get(nexoTab); } catch { nexoTab = null; } }
  if (!create) throw new Error('Aún no hay una pestaña de Nexo: usa action=navigate primero.');
  const t = await chrome.tabs.create({ url: url || 'about:blank', active: true });
  nexoTab = t.id;
  return t;
}

async function waitLoaded(tabId, max = 30000) {
  const t0 = Date.now();
  await sleep(150);
  while (Date.now() - t0 < max) {
    const t = await chrome.tabs.get(tabId);
    if (t.status === 'complete') break;
    await sleep(150);
  }
  await sleep(500);
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

async function handle(op, a) {
  switch (op) {
    case 'ping': return { version: chrome.runtime.getManifest().version };
    case 'navigate': {
      const t = await getTab(true, a.url);
      await chrome.tabs.update(t.id, { url: a.url, active: true });
      await chrome.windows.update(t.windowId, { focused: true }).catch(() => {});
      await waitLoaded(t.id);
      return state();
    }
    case 'state': return state();
    case 'page': return page(a.name, a.args || []);
    case 'back': return go(-1);
    case 'forward': return go(1);
    case 'idle': { const t = await getTab(); await waitLoaded(t.id, a.max || 6000); return state(); }
    case 'screenshot': {
      const t = await getTab();
      await chrome.tabs.update(t.id, { active: true });
      const url = await chrome.tabs.captureVisibleTab(t.windowId, { format: 'jpeg', quality: 78 });
      return { data: url.split(',')[1], mime: 'image/jpeg' };
    }
    case 'evaluate': {
      const t = await getTab();
      const [r] = await chrome.scripting.executeScript({ target: { tabId: t.id }, world: 'MAIN', args: [a.script], func: (code) => { try { return JSON.stringify((0, eval)(code)) ?? 'undefined'; } catch (e) { return 'Error: ' + e.message + ' (la página puede bloquear eval)'; } } });
      return r?.result;
    }
    default: throw new Error('Operación desconocida: ' + op);
  }
}
