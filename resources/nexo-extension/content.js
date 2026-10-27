// Acciones sobre la página (se inyecta bajo demanda). Los elementos se identifican con data-nexo-id (lo pone read.js).
(() => {
  if (window.__nexoUi) return;
  // Brillo alrededor de la página + puntero propio de Nexo (en un shadow DOM, sin interferir con la página).
  const host = document.createElement('div');
  host.id = 'nexo-overlay-host';
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:none';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>
    .glow{position:fixed;inset:0;pointer-events:none;box-shadow:inset 0 0 0 3px rgba(217,119,87,.95),inset 0 0 38px 10px rgba(217,119,87,.45);animation:p 1.8s ease-in-out infinite;opacity:0;transition:opacity .35s}
    .on .glow{opacity:1}
    @keyframes p{0%,100%{box-shadow:inset 0 0 0 3px rgba(217,119,87,.95),inset 0 0 30px 8px rgba(217,119,87,.35)}50%{box-shadow:inset 0 0 0 3px rgba(255,160,120,1),inset 0 0 55px 16px rgba(217,119,87,.6)}}
    .chip{position:fixed;top:10px;left:50%;transform:translateX(-50%);font:600 12px system-ui,sans-serif;color:#fff;background:#d97757;padding:4px 12px;border-radius:999px;box-shadow:0 2px 10px rgba(0,0,0,.35);opacity:0;transition:opacity .35s}
    .on .chip{opacity:1}
    .ptr{position:fixed;left:0;top:0;width:26px;height:26px;transition:transform .45s cubic-bezier(.3,.7,.2,1),opacity .3s;opacity:0;filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))}
    .on .ptr{opacity:1}
    .ripple{position:fixed;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;border:2px solid #d97757;animation:r .6s ease-out forwards}
    @keyframes r{to{transform:scale(4);opacity:0}}
  </style><div id="w"><div class="glow"></div><div class="chip">Nexo está trabajando en esta página</div>
  <svg class="ptr" viewBox="0 0 24 24"><path d="M3 2l7.5 19 2.7-7.8L21 10.5z" fill="#d97757" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg></div>`;
  const w = root.getElementById('w'), ptr = root.querySelector('.ptr');
  let off = null, px = innerWidth / 2, py = innerHeight / 2;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__nexoUi = {
    show() {
      if (!host.isConnected) document.documentElement.appendChild(host);
      host.style.display = 'block';
      requestAnimationFrame(() => w.classList.add('on'));
      clearTimeout(off);
      off = setTimeout(() => this.hide(), 6000);
    },
    hide() { w.classList.remove('on'); setTimeout(() => { if (!w.classList.contains('on')) host.style.display = 'none'; }, 400); },
    async moveTo(x, y) {
      this.show();
      ptr.style.transform = `translate(${x}px,${y}px)`;
      px = x; py = y;
      await sleep(480);
    },
    ripple(x, y) {
      const d = document.createElement('div'); d.className = 'ripple'; d.style.left = x + 'px'; d.style.top = y + 'px';
      w.appendChild(d); setTimeout(() => d.remove(), 700);
    }
  };
  ptr.style.transform = `translate(${px}px,${py}px)`;
})();

window.__nexo = {
  el(i) { const e = document.querySelector(`[data-nexo-id="${Number(i)}"]`); if (!e) throw new Error(`Elemento [${i}] no encontrado. Usa action=read para actualizar la lista.`); return e; },
  read() { window.__nexoUi.show(); return window.__nexoRead(); },
  async _point(e) {
    e.scrollIntoView({ block: 'center', inline: 'center' });
    await new Promise((r) => setTimeout(r, 120));
    const r = e.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
    await window.__nexoUi.moveTo(x, y);
    return { x, y };
  },
  kind(i) {
    const e = this.el(i); const t = (e.type || '').toLowerCase();
    if (e.tagName === 'SELECT') return 'select';
    if (t === 'checkbox' || t === 'radio' || e.getAttribute('role') === 'checkbox') return 'check';
    return 'text';
  },
  _fire(e, types, x, y) {
    for (const t of types) {
      const C = t.startsWith('pointer') ? PointerEvent : MouseEvent;
      e.dispatchEvent(new C(t, { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, button: 0, buttons: t.endsWith('down') ? 1 : 0, pointerType: 'mouse', isPrimary: true }));
    }
  },
  async hover(i) {
    const e = this.el(i);
    const { x, y } = await this._point(e);
    this._fire(e, ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointermove', 'mousemove'], x, y);
    return true;
  },
  async click(i) {
    const e = this.el(i);
    const { x, y } = await this._point(e);
    window.__nexoUi.ripple(x, y);
    // el clic se ejecuta tras responder: si navega, la página se descarga y la respuesta no llegaría
    setTimeout(() => {
      this._fire(e, ['pointerover', 'mouseover', 'pointermove', 'mousemove', 'pointerdown', 'mousedown'], x, y);
      if (e.focus) e.focus({ preventScroll: true });
      this._fire(e, ['pointerup', 'mouseup'], x, y);
      e.click();
    }, 30);
    return true;
  },
  async type(i, text) {
    const e = this.el(i);
    await this._point(e); e.focus();
    if ('value' in e) {
      const proto = e.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const set = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (set) set.call(e, text); else e.value = text;
    } else { document.execCommand('selectAll'); document.execCommand('insertText', false, text); }
    e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  },
  select(i, value) {
    const e = this.el(i);
    if (e.tagName !== 'SELECT') return { err: 'no es un desplegable <select>; usa click para abrirlo y click en la opción' };
    const v = String(value ?? '').toLowerCase().trim(); const opts = [...e.options];
    const o = opts.find((o) => o.value.toLowerCase() === v || o.text.trim().toLowerCase() === v) || opts.find((o) => o.text.toLowerCase().includes(v));
    if (!o) return { err: 'opción no encontrada. Opciones: ' + opts.map((o) => o.text.trim()).slice(0, 30).join(' | ') };
    e.value = o.value; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: o.text.trim() };
  },
  setChecked(i, want) {
    const e = this.el(i); const cur = e.checked ?? e.getAttribute('aria-checked') === 'true';
    if (cur !== want) { e.click(); return true; }
    return false;
  },
  scroll(dir, amount) { window.scrollBy({ top: (dir === 'up' ? -1 : 1) * Math.round(amount) * innerHeight * 0.85, behavior: 'instant' }); return true; },
  hasText(t) { return (document.body?.innerText || '').toLowerCase().includes(String(t).toLowerCase()); },
  press(key) {
    const e = document.activeElement || document.body;
    const k = key === 'Return' ? 'Enter' : key;
    const opt = { key: k, code: k.length === 1 ? 'Key' + k.toUpperCase() : k, bubbles: true, cancelable: true };
    const go = e.dispatchEvent(new KeyboardEvent('keydown', opt));
    e.dispatchEvent(new KeyboardEvent('keypress', opt));
    if (go && k === 'Enter') {
      const form = e.form || e.closest?.('form');
      if (form && e.tagName !== 'TEXTAREA') { if (form.requestSubmit) form.requestSubmit(); else form.submit(); }
      else if (e.tagName === 'BUTTON' || e.tagName === 'A') e.click();
    }
    e.dispatchEvent(new KeyboardEvent('keyup', opt));
    return true;
  }
};
