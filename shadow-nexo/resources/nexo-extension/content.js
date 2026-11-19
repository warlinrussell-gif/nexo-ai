// Acciones sobre la página (se inyecta bajo demanda). Los elementos se identifican con data-nexo-id (lo pone read.js).
(() => {
  if (window.__nexoUi) return;
  // Brillo alrededor de la página + puntero propio de Nexo (en un shadow DOM, sin interferir con la página).
  const host = document.createElement('div');
  host.id = 'nexo-overlay-host';
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:none';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>
    .glow{position:fixed;inset:0;pointer-events:none;box-shadow:inset 0 0 0 3px rgba(122,75,224,.95),inset 0 0 38px 10px rgba(122,75,224,.45);animation:p 1.8s ease-in-out infinite;opacity:0;transition:opacity .35s}
    .on .glow{opacity:1}
    @keyframes p{0%,100%{box-shadow:inset 0 0 0 3px rgba(122,75,224,.95),inset 0 0 30px 8px rgba(122,75,224,.35)}50%{box-shadow:inset 0 0 0 3px rgba(168,130,255,1),inset 0 0 55px 16px rgba(122,75,224,.6)}}
    .chip{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:10px;font:600 13px system-ui,sans-serif;color:#fff;background:rgba(28,24,44,.94);border:1px solid rgba(168,130,255,.6);padding:7px 8px 7px 14px;border-radius:999px;box-shadow:0 6px 24px rgba(0,0,0,.45),0 0 18px rgba(122,75,224,.5);opacity:0;transition:opacity .35s;pointer-events:none}
    .on .chip{opacity:1;pointer-events:auto}
    .dot{width:8px;height:8px;border-radius:50%;background:#a882ff;animation:b 1.2s ease-in-out infinite}@keyframes b{50%{opacity:.25}}
    .stop{all:unset;cursor:pointer;font:600 12px system-ui,sans-serif;background:#7a4be0;color:#fff;padding:5px 12px;border-radius:999px}.stop:hover{background:#8f66ee}
    .ptr{position:fixed;left:0;top:0;width:28px;height:28px;transition:transform .22s cubic-bezier(.3,.7,.2,1),opacity .3s;opacity:0;overflow:visible;filter:drop-shadow(0 0 4px #c4a8ff) drop-shadow(0 0 10px #7a4be0) drop-shadow(0 0 20px rgba(122,75,224,.9));animation:pg 1.3s ease-in-out infinite}
    @keyframes pg{50%{filter:drop-shadow(0 0 6px #e0d0ff) drop-shadow(0 0 16px #8f66ee) drop-shadow(0 0 32px rgba(143,102,238,1))}}
    .on .ptr{opacity:1}
    .ripple{position:fixed;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;border:2px solid #7a4be0;animation:r .6s ease-out forwards}
    @keyframes r{to{transform:scale(4);opacity:0}}
  </style><div id="w"><div class="glow"></div><div class="chip"><span class="dot"></span>Nexo está trabajando en esta página<button class="stop" id="stop">Detener</button></div>
  <svg class="ptr" viewBox="0 0 24 24"><circle cx="3" cy="2" r="9" fill="url(#hg)" opacity=".55"/><defs><radialGradient id="hg"><stop offset="0" stop-color="#c4a8ff"/><stop offset="1" stop-color="#7a4be0" stop-opacity="0"/></radialGradient></defs><path d="M3 2l7.5 19 2.7-7.8L21 10.5z" fill="#7a4be0" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg></div>`;
  const w = root.getElementById('w'), ptr = root.querySelector('.ptr');
  root.getElementById('stop').addEventListener('click', () => { try { chrome.runtime.sendMessage({ type: 'stop' }); } catch { /* */ } w.classList.remove('on'); });
  let off = null, px = innerWidth / 2, py = innerHeight / 2;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__nexoUi = {
    show() {
      if (!host.isConnected) document.documentElement.appendChild(host);
      host.style.display = 'block';
      requestAnimationFrame(() => w.classList.add('on'));
      clearTimeout(off);
      off = setTimeout(() => this.hide(), 8000);
    },
    hide() { w.classList.remove('on'); setTimeout(() => { if (!w.classList.contains('on')) host.style.display = 'none'; }, 400); },
    async moveTo(x, y) {
      this.show();
      ptr.style.transform = `translate(${x}px,${y}px)`;
      px = x; py = y;
      await sleep(240);
    },
    ripple(x, y) {
      const d = document.createElement('div'); d.className = 'ripple'; d.style.left = x + 'px'; d.style.top = y + 'px';
      w.appendChild(d); setTimeout(() => d.remove(), 700);
    }
  };
  ptr.style.transform = `translate(${px}px,${py}px)`;
})();

window.__nexo = {
  el(i) { const m = window.__nexoEls && window.__nexoEls[Number(i)]; const e = (m && m.isConnected ? m : null) || document.querySelector(`[data-nexo-id="${Number(i)}"]`); if (!e) throw new Error(`Elemento [${i}] no encontrado. Usa action=read para actualizar la lista.`); return e; },
  read() { window.__nexoUi.show(); return window.__nexoRead(); },
  async _point(e) {
    e.scrollIntoView({ block: 'center', inline: 'center' });
    await new Promise((r) => setTimeout(r, 60));
    const r = e.getBoundingClientRect(); let x = r.left + r.width / 2, y = r.top + r.height / 2;
    // Si el centro está tapado (cabecera fija, aviso de cookies…), se busca otro punto del elemento que sí reciba el clic
    const hit = (px, py) => { let t = document.elementFromPoint(px, py); while (t && t.shadowRoot) { const n = t.shadowRoot.elementFromPoint(px, py); if (!n || n === t) break; t = n; } return !!t && (t === e || e.contains(t) || t.contains(e)); };
    if (r.width > 0 && r.height > 0 && !hit(x, y)) {
      for (const [fx, fy] of [[0.25, 0.5], [0.75, 0.5], [0.5, 0.25], [0.5, 0.75], [0.1, 0.5], [0.9, 0.5], [0.15, 0.2], [0.85, 0.8]]) {
        const px = r.left + r.width * fx, py = r.top + r.height * fy;
        if (px >= 0 && py >= 0 && px < innerWidth && py < innerHeight && hit(px, py)) { x = px; y = py; break; }
      }
    }
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
  // Preparan el clic/escritura "de confianza" (la extensión los ejecuta con eventos reales de Chrome)
  async prepClick(i) {
    const e = this.el(i);
    const { x, y } = await this._point(e);
    window.__nexoUi.ripple(x, y);
    return { x, y };
  },
  async prepType(i) {
    const e = this.el(i);
    await this._point(e); e.focus();
    if ('value' in e && e.select) e.select();
    else { const r = document.createRange(); r.selectNodeContents(e); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }
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
  scroll(dir, amount) {
    // Muchas webs (Gmail, paneles, chats) desplazan un contenedor interior, no la ventana
    const horiz = dir === 'left' || dir === 'right', sign = dir === 'up' || dir === 'left' ? -1 : 1, n = Math.max(1, Math.round(amount) || 1);
    const can = (el) => { if (!el || el === document.body || el === document.documentElement) return false; const st = getComputedStyle(el); const ov = horiz ? st.overflowX : st.overflowY; return /(auto|scroll|overlay)/.test(ov) && (horiz ? el.scrollWidth > el.clientWidth + 8 : el.scrollHeight > el.clientHeight + 8); };
    const root = document.scrollingElement || document.documentElement;
    const winCan = horiz ? root.scrollWidth > innerWidth + 8 : root.scrollHeight > innerHeight + 8;
    let target = null;
    if (!winCan) { let el = document.elementFromPoint(innerWidth / 2, innerHeight / 2); while (el && !can(el)) el = el.parentElement || el.getRootNode()?.host || null; target = el; }
    const step = sign * n * 0.85;
    if (target) target.scrollBy({ [horiz ? 'left' : 'top']: step * (horiz ? target.clientWidth : target.clientHeight), behavior: 'instant' });
    else window.scrollBy({ [horiz ? 'left' : 'top']: step * (horiz ? innerWidth : innerHeight), behavior: 'instant' });
    return true;
  },
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
