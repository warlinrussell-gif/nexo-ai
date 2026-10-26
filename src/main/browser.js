// Navegador integrado controlable por los agentes (y por el usuario) — panel lateral con WebContentsView.
import { WebContentsView } from 'electron';
import { EventEmitter } from 'node:events';
import { truncate, sleep } from './util.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

export const READ_SCRIPT = `(() => {
  document.querySelectorAll('[data-nexo-id]').forEach(e => e.removeAttribute('data-nexo-id'));
  const sel = 'a[href], button, input:not([type=hidden]), textarea, select, [role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], [role=option], [role=combobox], [role=searchbox], [contenteditable=""], [contenteditable=true], summary, [onclick], [tabindex]:not([tabindex="-1"])';
  const els = [...document.querySelectorAll(sel)];
  const out = []; let i = 0;
  for (const el of els) {
    const r = el.getBoundingClientRect(); const st = getComputedStyle(el);
    if (r.width < 3 || r.height < 3 || st.visibility === 'hidden' || st.display === 'none' || st.opacity === '0') continue;
    if (r.bottom < -200 || r.top > innerHeight * 2.5) continue;
    el.setAttribute('data-nexo-id', i);
    let label = (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || el.name || el.id || '').trim().replace(/\\s+/g, ' ').slice(0, 90);
    const tag = el.tagName.toLowerCase();
    let extra = '';
    if (el.type && tag === 'input') extra += ' type=' + el.type;
    if (tag === 'a') { const h = el.getAttribute('href') || ''; if (h && !h.startsWith('javascript')) extra += ' href=' + h.slice(0, 70); }
    if (tag === 'select') label += ' {' + [...el.options].slice(0, 12).map(o => o.text.trim()).join('|') + '}';
    const vis = r.top >= 0 && r.bottom <= innerHeight ? '' : ' (fuera de vista)';
    out.push('[' + i + '] <' + tag + extra + '> ' + label + vis);
    i++; if (i >= 180) break;
  }
  const text = (document.body?.innerText || '').replace(/\\n{3,}/g, '\\n\\n');
  return { url: location.href, title: document.title, text, elements: out.join('\\n'), scrollY: Math.round(scrollY), scrollHeight: document.documentElement.scrollHeight, viewport: innerHeight };
})()`;

class BrowserController extends EventEmitter {
  constructor() { super(); this.view = null; this.win = null; this.bounds = null; this.visible = false; this.logs = []; }

  attach(win) { this.win = win; }

  ensure() {
    if (this.view && !this.view.webContents.isDestroyed()) return this.view;
    this.view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, partition: 'persist:nexo-browser' } });
    const wc = this.view.webContents;
    wc.setUserAgent(UA);
    wc.setWindowOpenHandler(({ url }) => { wc.loadURL(url); return { action: 'deny' }; });
    const upd = () => this.emitState();
    wc.on('did-navigate', upd); wc.on('did-navigate-in-page', upd); wc.on('page-title-updated', upd);
    wc.on('did-start-loading', upd); wc.on('did-stop-loading', upd);
    wc.on('did-fail-load', (_e, code, desc, url) => { if (code !== -3) this.emit('state', { ...this.state(), error: `${desc} (${url})` }); });
    wc.on('console-message', (e, level, message, line, source) => {
      const lv = e?.level ?? level; const msg = e?.message ?? message;
      const name = typeof lv === 'string' ? lv : ['debug', 'info', 'warning', 'error'][lv] || 'log';
      this.logs.push(`[${name}] ${String(msg).slice(0, 500)}${(e?.sourceId ?? source) ? ` (${String(e?.sourceId ?? source).split('/').pop()}:${e?.lineNumber ?? line})` : ''}`);
      if (this.logs.length > 200) this.logs.splice(0, this.logs.length - 200);
    });
    wc.on('did-navigate', () => { this.logs = []; });
    this.view.setBackgroundColor('#ffffff');
    if (this.visible && this.bounds) this.show(this.bounds);
    return this.view;
  }

  state() {
    const wc = this.view?.webContents;
    if (!wc || wc.isDestroyed()) return { url: '', title: '', loading: false, canGoBack: false, canGoForward: false, visible: this.visible };
    return { url: wc.getURL(), title: wc.getTitle(), loading: wc.isLoading(), canGoBack: wc.navigationHistory.canGoBack(), canGoForward: wc.navigationHistory.canGoForward(), visible: this.visible };
  }
  emitState() { this.emit('state', this.state()); }

  show(bounds) {
    this.bounds = bounds; this.visible = true;
    const v = this.ensure();
    if (this.win && !this.win.contentView.children.includes(v)) this.win.contentView.addChildView(v);
    v.setBounds({ x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.max(1, Math.round(bounds.width)), height: Math.max(1, Math.round(bounds.height)) });
    this.emitState();
  }

  hide() {
    this.visible = false;
    if (this.view && this.win && this.win.contentView.children.includes(this.view)) this.win.contentView.removeChildView(this.view);
    this.emitState();
  }

  async navigate(url) {
    let u = String(url || '').trim();
    if (!/^[a-z]+:\/\//i.test(u)) u = /\s/.test(u) || !/\./.test(u) ? `https://duckduckgo.com/?q=${encodeURIComponent(u)}` : 'https://' + u;
    const wc = this.ensure().webContents;
    this.emit('request-open');
    try { await Promise.race([wc.loadURL(u), sleep(30000)]); } catch (e) { if (!/ERR_ABORTED/.test(e.message)) throw e; }
    await this.waitIdle();
    return this.state();
  }

  async waitIdle(max = 8000) {
    const wc = this.view?.webContents; if (!wc) return;
    const t = Date.now();
    while (wc.isLoading() && Date.now() - t < max) await sleep(150);
    await sleep(500);
  }

  async read({ maxChars = 12000, offset = 0 } = {}) {
    const wc = this.ensure().webContents;
    if (!wc.getURL()) return { url: '', title: '', text: '(navegador vacío — usa action=navigate)', elements: '' };
    const r = await wc.executeJavaScript(READ_SCRIPT, true);
    const total = r.text.length;
    const from = Math.max(0, Math.min(offset, total));
    const to = Math.min(total, from + maxChars);
    return { ...r, text: r.text.slice(from, to), from, to, total, more: from > 0 || to < total };
  }

  /** Busca un texto en la página: fragmentos donde aparece y elementos interactivos que lo contienen. */
  async find(query) {
    const q = String(query || '').trim();
    if (!q) throw new Error('Indica text con lo que buscar');
    const r = await this.read({ maxChars: 1e9 });
    const low = r.text.toLowerCase(), ql = q.toLowerCase();
    const hits = [];
    for (let i = low.indexOf(ql); i >= 0 && hits.length < 15; i = low.indexOf(ql, i + ql.length)) hits.push(`…${r.text.slice(Math.max(0, i - 80), i + ql.length + 80).replace(/\s+/g, ' ')}… (offset ${Math.max(0, i - 200)})`);
    const els = r.elements.split('\n').filter((l) => l.toLowerCase().includes(ql)).slice(0, 25);
    if (!hits.length && !els.length) return `"${q}" no aparece en la página (${r.url}).`;
    return `Resultados para "${q}" en ${r.url}:\n\n## En el texto (${hits.length})\n${hits.join('\n') || '—'}\n\n## Elementos interactivos\n${els.join('\n') || '—'}`;
  }

  async hover(index) {
    const wc = this.ensure().webContents;
    const pos = await this.elementCenter(index);
    wc.sendInputEvent({ type: 'mouseMove', x: pos.x, y: pos.y });
    await sleep(400);
    return this.state();
  }

  async elementCenter(index) {
    const wc = this.ensure().webContents;
    const pos = await wc.executeJavaScript(`(() => { const el = document.querySelector('[data-nexo-id="${Number(index)}"]'); if (!el) return null; el.scrollIntoView({block:'center', inline:'center'}); const r = el.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 }; })()`, true);
    if (!pos) throw new Error(`Elemento [${index}] no encontrado. Usa action=read para actualizar la lista.`);
    await sleep(100);
    return { x: Math.round(pos.x), y: Math.round(pos.y) };
  }

  /** Rellena varios campos de un formulario: [{ index, value }]. */
  async fill(fields) {
    if (!Array.isArray(fields) || !fields.length) throw new Error('Indica fields: [{index, value}]');
    const wc = this.ensure().webContents;
    const out = [];
    for (const f of fields) {
      const kind = await wc.executeJavaScript(`(() => { const el = document.querySelector('[data-nexo-id="${Number(f.index)}"]'); if (!el) return null; const t = (el.type || '').toLowerCase(); if (el.tagName === 'SELECT') return 'select'; if (t === 'checkbox' || t === 'radio' || el.getAttribute('role') === 'checkbox') return 'check'; return 'text'; })()`, true);
      if (!kind) { out.push(`[${f.index}] no encontrado`); continue; }
      if (kind === 'select') { out.push(await this.select(f.index, f.value)); continue; }
      if (kind === 'check') {
        const want = !/^(false|0|no|off)$/i.test(String(f.value));
        const changed = await wc.executeJavaScript(`(() => { const el = document.querySelector('[data-nexo-id="${Number(f.index)}"]'); const cur = el.checked ?? el.getAttribute('aria-checked') === 'true'; if (cur !== ${want}) { el.click(); return true; } return false; })()`, true);
        out.push(`[${f.index}] ${want ? 'marcado' : 'desmarcado'}${changed ? '' : ' (ya lo estaba)'}`);
        continue;
      }
      await this.type(f.index, String(f.value ?? ''), false);
      out.push(`[${f.index}] = "${String(f.value).slice(0, 60)}"`);
    }
    return `Formulario rellenado:\n${out.join('\n')}`;
  }

  /** Elige una opción de un <select> por texto o valor. */
  async select(index, value) {
    const wc = this.ensure().webContents;
    const r = await wc.executeJavaScript(`(() => {
      const el = document.querySelector('[data-nexo-id="${Number(index)}"]');
      if (!el) return { err: 'no encontrado' };
      if (el.tagName !== 'SELECT') return { err: 'no es un desplegable <select>; usa click para abrirlo y click en la opción' };
      const v = ${JSON.stringify(String(value ?? ''))}.toLowerCase().trim();
      const opts = [...el.options];
      const o = opts.find(o => o.value.toLowerCase() === v || o.text.trim().toLowerCase() === v) || opts.find(o => o.text.toLowerCase().includes(v));
      if (!o) return { err: 'opción no encontrada. Opciones: ' + opts.map(o => o.text.trim()).slice(0, 30).join(' | ') };
      el.value = o.value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: o.text.trim() };
    })()`, true);
    if (r.err) throw new Error(`[${index}] ${r.err}`);
    return `[${index}] seleccionado: ${r.ok}`;
  }

  /** Espera unos segundos o hasta que aparezca un texto en la página (máx. 30 s). */
  async wait({ seconds, text } = {}) {
    const wc = this.ensure().webContents;
    if (text) {
      const t0 = Date.now();
      while (Date.now() - t0 < Math.min(30, seconds || 15) * 1000) {
        const found = await wc.executeJavaScript(`(document.body?.innerText || '').toLowerCase().includes(${JSON.stringify(String(text).toLowerCase())})`, true).catch(() => false);
        if (found) return `"${text}" ya aparece en la página (${((Date.now() - t0) / 1000).toFixed(1)} s)`;
        await sleep(500);
      }
      return `"${text}" no apareció tras ${Math.min(30, seconds || 15)} s`;
    }
    await sleep(Math.min(30, seconds || 2) * 1000);
    await this.waitIdle(4000);
    return `Esperado ${Math.min(30, seconds || 2)} s`;
  }

  consoleLog() {
    return this.logs.length ? `Consola (${this.logs.length} mensajes, los más recientes al final):\n${this.logs.slice(-80).join('\n')}` : 'La consola está vacía.';
  }

  async click(index) {
    const wc = this.ensure().webContents;
    const { x, y } = await this.elementCenter(index);
    wc.sendInputEvent({ type: 'mouseMove', x, y });
    wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    await sleep(300);
    await this.waitIdle(6000);
    return this.state();
  }

  async type(index, text, submit = false) {
    const wc = this.ensure().webContents;
    const ok = await wc.executeJavaScript(`(() => { const el = document.querySelector('[data-nexo-id="${Number(index)}"]'); if (!el) return false; el.scrollIntoView({block:'center'}); el.focus(); if ('value' in el) { el.select?.(); } else { document.execCommand('selectAll'); } return true; })()`, true);
    if (!ok) throw new Error(`Elemento [${index}] no encontrado. Usa action=read.`);
    await sleep(80);
    await wc.insertText(String(text));
    await wc.executeJavaScript(`(() => { const el = document.activeElement; if (el) { el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); } })()`, true);
    if (submit) { await this.press('Enter'); }
    return this.state();
  }

  async press(key) {
    const wc = this.ensure().webContents;
    const k = key === 'Enter' ? 'Return' : key;
    wc.sendInputEvent({ type: 'keyDown', keyCode: k });
    if (k === 'Return') wc.sendInputEvent({ type: 'char', keyCode: '\r' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: k });
    await sleep(400); await this.waitIdle(6000);
    return this.state();
  }

  async scroll(direction = 'down', amount = 1) {
    const wc = this.ensure().webContents;
    const dy = (direction === 'up' ? -1 : 1) * Math.round(amount) ;
    await wc.executeJavaScript(`window.scrollBy({ top: ${dy} * innerHeight * 0.85, behavior: 'instant' })`, true);
    await sleep(300);
    return this.state();
  }

  async back() { const wc = this.ensure().webContents; if (wc.navigationHistory.canGoBack()) { wc.navigationHistory.goBack(); await this.waitIdle(); } return this.state(); }
  async forward() { const wc = this.ensure().webContents; if (wc.navigationHistory.canGoForward()) { wc.navigationHistory.goForward(); await this.waitIdle(); } return this.state(); }
  reload() { this.view?.webContents.reload(); }
  stop() { this.view?.webContents.stop(); }

  async screenshot(maxWidth = 1280) {
    const wc = this.ensure().webContents;
    let img = await wc.capturePage();
    const s = img.getSize();
    if (!s.width) throw new Error('El navegador no es visible; ábrelo para capturar.');
    if (s.width > maxWidth) img = img.resize({ width: maxWidth });
    return { data: img.toJPEG(78).toString('base64'), mime: 'image/jpeg' };
  }

  async evaluate(script) {
    const wc = this.ensure().webContents;
    const r = await wc.executeJavaScript(String(script), true);
    return typeof r === 'string' ? r : JSON.stringify(r, null, 2);
  }
}

const embedded = new BrowserController();

// Motor activo: 'embedded' (panel lateral) o 'chrome' (Chrome real vía browser-chrome.js).
let engine = 'embedded';
let chrome = null;
export function setBrowserEngine(e) { engine = e === 'chrome' ? 'chrome' : 'embedded'; if (engine === 'embedded' && chrome) { chrome.close(); chrome = null; } }
export async function closeBrowserEngine() { if (chrome) { await chrome.close(); chrome = null; } }
const ROUTED = new Set(['navigate', 'read', 'find', 'hover', 'fill', 'select', 'wait', 'consoleLog', 'click', 'type', 'press', 'scroll', 'back', 'forward', 'screenshot', 'evaluate']);

export const browser = new Proxy(embedded, {
  get(target, prop) {
    if (engine === 'chrome' && ROUTED.has(prop)) {
      return async (...args) => {
        if (!chrome) { const { ChromeBrowser } = await import('./browser-chrome.js'); chrome = new ChromeBrowser(); }
        return chrome[prop](...args);
      };
    }
    const v = target[prop];
    return typeof v === 'function' ? v.bind(target) : v;
  },
});
