// Funciones reales de Obscura: fetch (con todos sus dumps), scrape por lotes y sesión de vista previa
// persistente por CDP. Todo pasa por el binario o por su WebSocket; nunca por un navegador ajeno.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { dir } from './paths.js';
import { READ_SCRIPT } from './browser-read-script.js';

const DUMP_VALIDOS = ['html', 'text', 'links', 'markdown', 'original', 'assets', 'cookies'];

export class Obscura {
  constructor(getConfig) { this.getConfig = getConfig; this.sesion = null; }

  exe() {
    const p = dir('binarios', 'obscura', 'obscura.exe');
    return fs.existsSync(p) ? p : null;
  }

  base() { return String(this.getConfig().obscuraUrl || 'http://127.0.0.1:3000').replace(/\/$/, ''); }

  async vivo() {
    try { const r = await fetch(this.base() + '/json/version', { signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; }
  }

  /** Ejecuta el binario con timeout y devuelve stdout/stderr/código. */
  bin(args, { timeout = 90 } = {}) {
    const exe = this.exe();
    if (!exe) return Promise.reject(new Error('Obscura no está instalado en NexoData/binarios/obscura.'));
    return new Promise((resolve) => {
      const child = spawn(exe, args, { cwd: path.dirname(exe), windowsHide: true });
      let out = '', err = '';
      child.stdout.on('data', (d) => { out += d.toString(); if (out.length > 8e6) out = out.slice(-4e6); });
      child.stderr.on('data', (d) => { err += d.toString(); if (err.length > 1e6) err = err.slice(-5e5); });
      const t = setTimeout(() => { try { child.kill(); } catch { } }, timeout * 1000);
      child.on('close', (code) => { clearTimeout(t); resolve({ code, out, err }); });
      child.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out, err: e.message }); });
    });
  }

  /**
   * fetch de Obscura con el dump pedido. `original` y `assets` devuelven el cuerpo tal cual.
   * `cookies` devuelve el jar completo (incluidas HttpOnly).
   */
  async fetch(url, dump = 'text', { proxy, userAgent, obeyRobots = false } = {}) {
    if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('Indica una URL http(s) válida.');
    const d = DUMP_VALIDOS.includes(dump) ? dump : 'text';
    const args = ['fetch', url, '--dump', d, '--stealth'];
    if (proxy) args.push('--proxy', proxy);
    if (userAgent) args.push('--user-agent', userAgent);
    if (obeyRobots) args.push('--obey-robots');
    const r = await this.bin(args);
    const salida = r.out.trim();
    if (r.code !== 0 && !salida) throw new Error(r.err.trim().split('\n').filter(Boolean).slice(-3).join(' ') || 'Obscura falló');
    return { dump: d, url, content: salida, bytes: Buffer.byteLength(salida) };
  }

  /** scrape: varias URLs en paralelo, con expresión JS opcional. Devuelve el JSON de Obscura. */
  async scrape(urls, { eval: expr, concurrency = 5, timeout = 60, proxy } = {}) {
    const lista = (Array.isArray(urls) ? urls : String(urls || '').split(/\s*\n\s*/)).map((u) => u.trim()).filter(Boolean);
    if (!lista.length) throw new Error('Indica al menos una URL.');
    const args = ['scrape', ...lista, '--concurrency', String(Math.max(1, Math.min(20, Number(concurrency) || 5))), '--timeout', String(Math.max(5, Number(timeout) || 60)), '--stealth'];
    if (expr) args.push('-e', expr);
    if (proxy) args.push('--proxy', proxy);
    const r = await this.bin(args, { timeout: (Number(timeout) || 60) + 30 });
    const txt = r.out.trim();
    if (!txt) throw new Error(r.err.trim() || 'Obscura no devolvió resultados');
    try { return JSON.parse(txt); } catch { return { raw: txt }; }
  }

  // ───────── Vista previa (sesión CDP persistente) ─────────
  async abrirSesion() {
    if (this.sesion) return this.sesion;
    if (!(await this.vivo())) throw new Error(`Obscura no responde en ${this.base()}.`);
    const info = await (await fetch(this.base() + '/json/version')).json().catch(() => ({}));
    const wsUrl = info.webSocketDebuggerUrl || this.base().replace(/^http/, 'ws') + '/devtools/browser';
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pend = new Map();
    let sesion = null;
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error('Obscura rechazó la conexión')), { once: true });
    });
    ws.addEventListener('message', (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      const p = m.id && pend.get(m.id);
      if (p) { pend.delete(m.id); p(m); }
    });
    ws.addEventListener('close', () => { for (const [, p] of pend) p({ error: { message: 'sesión cerrada' } }); pend.clear(); this.sesion = null; });
    const enviar = (method, params = {}, conSesion = true) => new Promise((res, rej) => {
      const i = ++id;
      const t = setTimeout(() => { pend.delete(i); rej(new Error('Sin respuesta de Obscura: ' + method)); }, 45000);
      pend.set(i, (m) => { clearTimeout(t); m.error ? rej(new Error(m.error.message || method)) : res(m.result); });
      ws.send(JSON.stringify({ id: i, method, params, ...(conSesion && sesion ? { sessionId: sesion } : {}) }));
    });
    const t = await enviar('Target.createTarget', { url: 'about:blank' }, false);
    const a = await enviar('Target.attachToTarget', { targetId: t.targetId, flatten: true }, false);
    sesion = a.sessionId;
    await enviar('Page.enable');
    await enviar('Runtime.enable');
    this.sesion = {
      enviar,
      evaluar: async (expr) => (await enviar('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.value,
      cerrar: () => { try { ws.close(); } catch { } this.sesion = null; },
      url: () => this.sesionUrl || ''
    };
    return this.sesion;
  }

  async navegar(url) {
    const s = await this.abrirSesion();
    const u = /^https?:\/\//i.test(url) ? url : 'https://' + String(url || '').replace(/^\/+/, '');
    await s.enviar('Page.navigate', { url: u });
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
      await new Promise((r) => setTimeout(r, 350));
      const st = await s.evaluar('document.readyState').catch(() => null);
      if (st === 'complete') break;
    }
    await new Promise((r) => setTimeout(r, 900));
    const info = await s.evaluar(`({ url: location.href, title: document.title, text: document.body ? document.body.innerText : '' })`);
    this.sesionUrl = info?.url || u;
    return { url: info?.url || u, title: info?.title || '', text: info?.text || '' };
  }

  async captura() {
    const s = await this.abrirSesion();
    const r = await s.enviar('Page.captureScreenshot', { format: 'png' });
    return r?.data || '';
  }

  async evaluar(expr) {
    const s = await this.abrirSesion();
    const r = await s.evaluar(String(expr || ''));
    return typeof r === 'string' ? r : JSON.stringify(r, null, 2);
  }

  async clic(x, y) {
    const s = await this.abrirSesion();
    for (const type of ['mousePressed', 'mouseReleased']) await s.enviar('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
    await new Promise((r) => setTimeout(r, 500));
    return true;
  }

  async teclear(texto) {
    const s = await this.abrirSesion();
    for (const ch of String(texto || '')) { await s.enviar('Input.dispatchKeyEvent', { type: 'char', text: ch }); await new Promise((r) => setTimeout(r, 25)); }
    return true;
  }

  async tecla(key) {
    const s = await this.abrirSesion();
    const code = key === 'Enter' ? 13 : key === 'Tab' ? 9 : 0;
    await s.enviar('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code });
    await s.enviar('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code });
    await new Promise((r) => setTimeout(r, 400));
    return true;
  }

  cerrarSesion() { if (this.sesion) { this.sesion.cerrar(); return true; } return false; }

  // ───────── Acciones de navegador (para que el modelo maneje Obscura hablando) ─────────
  /** Lee la página: texto y elementos interactivos numerados [n]. */
  async leer({ maxChars = 12000, offset = 0 } = {}) {
    const s = await this.abrirSesion();
    const r = await s.evaluar(READ_SCRIPT);
    if (!r) throw new Error('La página no devolvió contenido.');
    this.sesionUrl = r.url;
    const total = (r.text || '').length;
    const from = Math.max(0, Math.min(offset, total));
    const to = Math.min(total, from + maxChars);
    return { ...r, text: (r.text || '').slice(from, to), from, to, total, more: from > 0 || to < total };
  }

  /** Centro del elemento [n] en coordenadas de la página. */
  async centro(indice) {
    const s = await this.abrirSesion();
    const pos = await s.evaluar(`(() => { const el = document.querySelector('[data-nexo-id="${Number(indice)}"]'); if (!el) return null; el.scrollIntoView({ block: 'center', inline: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    if (!pos) throw new Error(`Elemento [${indice}] no encontrado. Usa action=read para refrescar la lista.`);
    await new Promise((r) => setTimeout(r, 120));
    return pos;
  }

  async clicElemento(indice) {
    const { x, y } = await this.centro(indice);
    await this.clic(x, y);
    await this.esperarRed(6000);
    return true;
  }

  async escribir(indice, texto, enviar = false) {
    const s = await this.abrirSesion();
    const ok = await s.evaluar(`(() => { const el = document.querySelector('[data-nexo-id="${Number(indice)}"]'); if (!el) return false; el.scrollIntoView({ block: 'center' }); el.focus(); if ('value' in el) el.select?.(); else document.execCommand('selectAll'); return true; })()`);
    if (!ok) throw new Error(`Elemento [${indice}] no encontrado. Usa action=read.`);
    await new Promise((r) => setTimeout(r, 80));
    await this.teclear(texto);
    await s.evaluar(`(() => { const el = document.activeElement; if (el) { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } })()`);
    if (enviar) { await this.tecla('Enter'); await this.esperarRed(6000); }
    return true;
  }

  async seleccionar(indice, valor) {
    const s = await this.abrirSesion();
    const r = await s.evaluar(`(() => { const el = document.querySelector('[data-nexo-id="${Number(indice)}"]'); if (!el) return { err: 'no encontrado' }; if (el.tagName !== 'SELECT') return { err: 'no es un desplegable; usa click' }; const v = ${JSON.stringify(String(valor))}.toLowerCase().trim(); const opts = [...el.options]; const o = opts.find(o => o.value.toLowerCase() === v || o.text.trim().toLowerCase() === v) || opts.find(o => o.text.toLowerCase().includes(v)); if (!o) return { err: 'opción no encontrada: ' + opts.map(o => o.text.trim()).slice(0, 20).join(' | ') }; el.value = o.value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return { ok: o.text.trim() }; })()`);
    if (r?.err) throw new Error(`[${indice}] ${r.err}`);
    return r?.ok || '';
  }

  /** Espera a que la red se calme (o a que aparezca un texto). */
  async esperarRed(max = 6000) { await new Promise((r) => setTimeout(r, Math.min(max, 1200))); }

  async esperarTexto(texto, segundos = 15) {
    const s = await this.abrirSesion();
    const t0 = Date.now();
    const limite = Math.min(60, Number(segundos) || 15) * 1000;
    while (Date.now() - t0 < limite) {
      const hay = await s.evaluar(`(document.body ? document.body.innerText : '').toLowerCase().includes(${JSON.stringify(String(texto).toLowerCase())})`).catch(() => false);
      if (hay) return `"${texto}" apareció en ${((Date.now() - t0) / 1000).toFixed(1)} s`;
      await new Promise((r) => setTimeout(r, 500));
    }
    return `"${texto}" no apareció tras ${segundos} s`;
  }

  async scroll(dir = 'down', veces = 1) {
    const s = await this.abrirSesion();
    await s.evaluar(`window.scrollBy({ top: ${dir === 'up' ? -1 : 1} * innerHeight * 0.85 * ${Math.max(1, Number(veces) || 1)}, behavior: 'instant' })`);
    await new Promise((r) => setTimeout(r, 300));
    return true;
  }

  async cookies() {
    const s = await this.abrirSesion();
    const r = await s.enviar('Network.getAllCookies', {});
    return (r?.cookies || []).map((c) => `${c.name}=${c.value} (${c.domain}, httpOnly=${c.httpOnly})`).join('\n') || 'sin cookies';
  }

  async atras() { const s = await this.abrirSesion(); await s.enviar('Page.navigate', { url: 'javascript:history.back()' }).catch(() => { }); await new Promise((r) => setTimeout(r, 800)); return true; }
}
