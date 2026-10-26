// Motor "Chrome real": controla el Chrome instalado (perfil propio y persistente) por CDP con puppeteer-core.
// Misma interfaz que BrowserController (browser.js), solo navegación, lectura y clics.
import fs from 'node:fs';
import path from 'node:path';
import { sleep } from './util.js';
import { READ_SCRIPT } from './browser-read-script.js';

const CANDIDATES = [
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
  process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft/Edge/Application/msedge.exe'),
  process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'),
].filter(Boolean);

export class ChromeBrowser {
  /** profileDir: carpeta del perfil de Chrome (persistente). */
  constructor({ profileDir } = {}) { this.profileDir = profileDir || process.env.NEXO_CHROME_PROFILE; this.b = null; this.page = null; this.logs = []; }

  async ensure() {
    if (this.page && !this.page.isClosed() && this.b?.connected) return this.page;
    const { default: puppeteer } = await import('puppeteer-core');
    const exe = CANDIDATES.find((p) => fs.existsSync(p));
    if (!exe) throw new Error('No encontré Chrome ni Edge instalados. Instala Chrome o cambia el motor a "Integrado" en Ajustes.');
    this.b = await puppeteer.launch({
      executablePath: exe, headless: false, defaultViewport: null,
      userDataDir: this.profileDir,
      args: ['--no-first-run', '--no-default-browser-check', '--window-size=1280,860'],
      ignoreDefaultArgs: ['--enable-automation'],
    });
    this.b.on('disconnected', () => { this.b = null; this.page = null; });
    this.page = (await this.b.pages())[0] || await this.b.newPage();
    this.hook(this.page);
    this.b.on('targetcreated', async (t) => { // las pestañas nuevas pasan a ser la activa
      if (t.type() !== 'page') return;
      const p = await t.page().catch(() => null);
      if (p) { this.page = p; this.hook(p); }
    });
    return this.page;
  }

  hook(p) {
    p.on('console', (m) => { this.logs.push(`[${m.type()}] ${m.text().slice(0, 500)}`); if (this.logs.length > 200) this.logs.shift(); });
    p.on('framenavigated', (f) => { if (f === p.mainFrame()) this.logs = []; });
  }

  async state() {
    const p = this.page;
    if (!p || p.isClosed()) return { url: '', title: '', loading: false, canGoBack: false, canGoForward: false, visible: true };
    return { url: p.url(), title: await p.title().catch(() => ''), loading: false, canGoBack: true, canGoForward: true, visible: true };
  }

  async waitIdle(max = 8000) {
    const p = this.page; if (!p) return;
    await p.waitForNetworkIdle({ idleTime: 500, timeout: max }).catch(() => {});
  }

  async navigate(url) {
    let u = String(url || '').trim();
    if (!/^([a-z]+:\/\/|(about|data|blob|file|chrome|view-source):)/i.test(u)) u = /\s/.test(u) || !/\./.test(u) ? `https://duckduckgo.com/?q=${encodeURIComponent(u)}` : 'https://' + u;
    const p = await this.ensure();
    await p.goto(u, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((e) => { if (!/ERR_ABORTED|Timeout/.test(e.message)) throw e; });
    await this.waitIdle();
    return this.state();
  }

  async read({ maxChars = 12000, offset = 0 } = {}) {
    const p = await this.ensure();
    if (!p.url() || p.url() === 'about:blank') return { url: '', title: '', text: '(navegador vacío — usa action=navigate)', elements: '' };
    const r = await p.evaluate(READ_SCRIPT);
    const total = r.text.length;
    const from = Math.max(0, Math.min(offset, total));
    const to = Math.min(total, from + maxChars);
    return { ...r, text: r.text.slice(from, to), from, to, total, more: from > 0 || to < total };
  }

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

  async center(index) {
    const p = await this.ensure();
    const pos = await p.evaluate((i) => { const el = document.querySelector(`[data-nexo-id="${i}"]`); if (!el) return null; el.scrollIntoView({ block: 'center', inline: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, Number(index));
    if (!pos) throw new Error(`Elemento [${index}] no encontrado. Usa action=read para actualizar la lista.`);
    await sleep(100);
    return pos;
  }

  async hover(index) { const p = await this.ensure(); const { x, y } = await this.center(index); await p.mouse.move(x, y, { steps: 5 }); await sleep(400); return this.state(); }

  async click(index) {
    const p = await this.ensure();
    const { x, y } = await this.center(index);
    await p.mouse.move(x, y, { steps: 5 });
    await p.mouse.click(x, y);
    await sleep(300); await this.waitIdle(6000);
    return this.state();
  }

  async type(index, text, submit = false) {
    const p = await this.ensure();
    const ok = await p.evaluate((i) => { const el = document.querySelector(`[data-nexo-id="${i}"]`); if (!el) return false; el.scrollIntoView({ block: 'center' }); el.focus(); if ('value' in el) el.select?.(); else document.execCommand('selectAll'); return true; }, Number(index));
    if (!ok) throw new Error(`Elemento [${index}] no encontrado. Usa action=read.`);
    await sleep(80);
    await p.keyboard.sendCharacter(String(text));
    await p.evaluate(() => { const el = document.activeElement; if (el) { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } });
    if (submit) await this.press('Enter');
    return this.state();
  }

  async select(index, value) {
    const p = await this.ensure();
    const r = await p.evaluate((i, val) => {
      const el = document.querySelector(`[data-nexo-id="${i}"]`);
      if (!el) return { err: 'no encontrado' };
      if (el.tagName !== 'SELECT') return { err: 'no es un desplegable <select>; usa click para abrirlo y click en la opción' };
      const v = String(val).toLowerCase().trim(); const opts = [...el.options];
      const o = opts.find((o) => o.value.toLowerCase() === v || o.text.trim().toLowerCase() === v) || opts.find((o) => o.text.toLowerCase().includes(v));
      if (!o) return { err: 'opción no encontrada. Opciones: ' + opts.map((o) => o.text.trim()).slice(0, 30).join(' | ') };
      el.value = o.value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: o.text.trim() };
    }, Number(index), String(value ?? ''));
    if (r.err) throw new Error(`[${index}] ${r.err}`);
    return `[${index}] seleccionado: ${r.ok}`;
  }

  async fill(fields) {
    if (!Array.isArray(fields) || !fields.length) throw new Error('Indica fields: [{index, value}]');
    const p = await this.ensure(); const out = [];
    for (const f of fields) {
      const kind = await p.evaluate((i) => { const el = document.querySelector(`[data-nexo-id="${i}"]`); if (!el) return null; const t = (el.type || '').toLowerCase(); if (el.tagName === 'SELECT') return 'select'; if (t === 'checkbox' || t === 'radio' || el.getAttribute('role') === 'checkbox') return 'check'; return 'text'; }, Number(f.index));
      if (!kind) { out.push(`[${f.index}] no encontrado`); continue; }
      if (kind === 'select') { out.push(await this.select(f.index, f.value)); continue; }
      if (kind === 'check') {
        const want = !/^(false|0|no|off)$/i.test(String(f.value));
        const changed = await p.evaluate((i, w) => { const el = document.querySelector(`[data-nexo-id="${i}"]`); const cur = el.checked ?? el.getAttribute('aria-checked') === 'true'; if (cur !== w) { el.click(); return true; } return false; }, Number(f.index), want);
        out.push(`[${f.index}] ${want ? 'marcado' : 'desmarcado'}${changed ? '' : ' (ya lo estaba)'}`);
        continue;
      }
      await this.type(f.index, String(f.value ?? ''), false);
      out.push(`[${f.index}] = "${String(f.value).slice(0, 60)}"`);
    }
    return `Formulario rellenado:\n${out.join('\n')}`;
  }

  async wait({ seconds, text } = {}) {
    const p = await this.ensure();
    const max = Math.min(30, seconds || (text ? 15 : 2));
    if (text) {
      const t0 = Date.now();
      while (Date.now() - t0 < max * 1000) {
        if (await p.evaluate((t) => (document.body?.innerText || '').toLowerCase().includes(t), String(text).toLowerCase()).catch(() => false)) return `"${text}" ya aparece en la página (${((Date.now() - t0) / 1000).toFixed(1)} s)`;
        await sleep(500);
      }
      return `"${text}" no apareció tras ${max} s`;
    }
    await sleep(max * 1000); await this.waitIdle(4000);
    return `Esperado ${max} s`;
  }

  consoleLog() { return this.logs.length ? `Consola (${this.logs.length} mensajes, los más recientes al final):\n${this.logs.slice(-80).join('\n')}` : 'La consola está vacía.'; }

  async press(key) {
    const p = await this.ensure();
    await p.keyboard.press(key === 'Return' ? 'Enter' : key);
    await sleep(400); await this.waitIdle(6000);
    return this.state();
  }

  async scroll(direction = 'down', amount = 1) {
    const p = await this.ensure();
    await p.evaluate((d) => window.scrollBy({ top: d * innerHeight * 0.85, behavior: 'instant' }), (direction === 'up' ? -1 : 1) * Math.round(amount));
    await sleep(300);
    return this.state();
  }

  async back() { const p = await this.ensure(); await p.goBack({ timeout: 8000 }).catch(() => {}); return this.state(); }
  async forward() { const p = await this.ensure(); await p.goForward({ timeout: 8000 }).catch(() => {}); return this.state(); }

  async screenshot() {
    const p = await this.ensure();
    const data = await p.screenshot({ type: 'jpeg', quality: 78, encoding: 'base64' });
    return { data, mime: 'image/jpeg' };
  }

  async evaluate(script) {
    const p = await this.ensure();
    const r = await p.evaluate(String(script));
    return typeof r === 'string' ? r : JSON.stringify(r, null, 2);
  }

  async close() { try { await this.b?.close(); } catch { /* ya cerrado */ } this.b = null; this.page = null; }
}
