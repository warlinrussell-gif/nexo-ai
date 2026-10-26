// Motor "Mi Chrome": controla TU Chrome (con tus sesiones) a través de la extensión de Nexo.
// Misma interfaz que BrowserController/ChromeBrowser. `bridge` = { call(op, args), connected?() } y `launch()` abre Chrome si hace falta.
import { sleep } from './util.js';

export class ExtBrowser {
  constructor({ call, connected, launch }) { this._call = call; this._connected = connected || (() => true); this.launch = launch; }

  async call(op, args) {
    await this.ensureConnected();
    return this._call(op, args);
  }

  async ensureConnected() {
    if (this._connected()) return;
    if (this.launch) { try { this.launch(); } catch { /* sin Chrome */ } }
    for (let i = 0; i < 40; i++) { if (this._connected()) return; await sleep(500); }
    throw new Error('Tu Chrome no está conectado con Nexo. Abre Chrome y comprueba que la extensión "Nexo AI" está instalada y enlazada (Nexo → Ajustes → Navegador de los agentes).');
  }

  page(name, ...args) { return this.call('page', { name, args }); }

  async state() { const s = await this.call('state', {}); return { ...s, loading: false, canGoBack: true, canGoForward: true, visible: true }; }

  async navigate(url) {
    let u = String(url || '').trim();
    if (!/^([a-z]+:\/\/|(about|data|blob|file|chrome|view-source):)/i.test(u)) u = /\s/.test(u) || !/\./.test(u) ? `https://duckduckgo.com/?q=${encodeURIComponent(u)}` : 'https://' + u;
    const s = await this.call('navigate', { url: u });
    return { ...s, loading: false, visible: true };
  }

  async read({ maxChars = 12000, offset = 0 } = {}) {
    const st = await this.call('state', {});
    if (!st.url || st.url === 'about:blank') return { url: '', title: '', text: '(navegador vacío — usa action=navigate)', elements: '' };
    const r = await this.page('read');
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

  async hover(index) { await this.page('hover', index); await sleep(400); return this.state(); }

  async click(index) {
    await this.page('click', index);
    await sleep(300);
    await this.call('idle', { max: 6000 });
    return this.state();
  }

  async type(index, text, submit = false) {
    await this.page('type', index, String(text));
    if (submit) await this.press('Enter');
    return this.state();
  }

  async select(index, value) {
    const r = await this.page('select', index, String(value ?? ''));
    if (r.err) throw new Error(`[${index}] ${r.err}`);
    return `[${index}] seleccionado: ${r.ok}`;
  }

  async fill(fields) {
    if (!Array.isArray(fields) || !fields.length) throw new Error('Indica fields: [{index, value}]');
    const out = [];
    for (const f of fields) {
      let kind; try { kind = await this.page('kind', f.index); } catch { out.push(`[${f.index}] no encontrado`); continue; }
      if (kind === 'select') { out.push(await this.select(f.index, f.value)); continue; }
      if (kind === 'check') {
        const want = !/^(false|0|no|off)$/i.test(String(f.value));
        const changed = await this.page('setChecked', f.index, want);
        out.push(`[${f.index}] ${want ? 'marcado' : 'desmarcado'}${changed ? '' : ' (ya lo estaba)'}`);
        continue;
      }
      await this.page('type', f.index, String(f.value ?? ''));
      out.push(`[${f.index}] = "${String(f.value).slice(0, 60)}"`);
    }
    return `Formulario rellenado:\n${out.join('\n')}`;
  }

  async wait({ seconds, text } = {}) {
    const max = Math.min(30, seconds || (text ? 15 : 2));
    if (text) {
      const t0 = Date.now();
      while (Date.now() - t0 < max * 1000) {
        if (await this.page('hasText', text).catch(() => false)) return `"${text}" ya aparece en la página (${((Date.now() - t0) / 1000).toFixed(1)} s)`;
        await sleep(500);
      }
      return `"${text}" no apareció tras ${max} s`;
    }
    await sleep(max * 1000);
    return `Esperado ${max} s`;
  }

  consoleLog() { return 'La consola de la página no está disponible con "Mi Chrome". Usa action=evaluate para inspeccionar la página.'; }

  async press(key) {
    await this.page('press', key === 'Return' ? 'Enter' : key);
    await sleep(400);
    await this.call('idle', { max: 6000 });
    return this.state();
  }

  async scroll(direction = 'down', amount = 1) { await this.page('scroll', direction, amount); await sleep(300); return this.state(); }
  async back() { const s = await this.call('back', {}); return { ...s, visible: true }; }
  async forward() { const s = await this.call('forward', {}); return { ...s, visible: true }; }
  async screenshot() { return this.call('screenshot', {}); }

  async evaluate(script) {
    const r = await this.call('evaluate', { script: String(script) });
    return typeof r === 'string' ? r : JSON.stringify(r, null, 2);
  }

  async close() { /* tu Chrome sigue abierto */ }
}
