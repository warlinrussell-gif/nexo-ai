// Acciones sobre la página (se inyecta bajo demanda). Los elementos se identifican con data-nexo-id (lo pone read.js).
window.__nexo = {
  el(i) { const e = document.querySelector(`[data-nexo-id="${Number(i)}"]`); if (!e) throw new Error(`Elemento [${i}] no encontrado. Usa action=read para actualizar la lista.`); return e; },
  read() { return window.__nexoRead(); },
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
  hover(i) {
    const e = this.el(i); e.scrollIntoView({ block: 'center', inline: 'center' });
    const r = e.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
    this._fire(e, ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointermove', 'mousemove'], x, y);
    return true;
  },
  click(i) {
    const e = this.el(i); e.scrollIntoView({ block: 'center', inline: 'center' });
    const r = e.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
    this._fire(e, ['pointerover', 'mouseover', 'pointermove', 'mousemove', 'pointerdown', 'mousedown'], x, y);
    if (e.focus) e.focus({ preventScroll: true });
    this._fire(e, ['pointerup', 'mouseup'], x, y);
    e.click();
    return true;
  },
  type(i, text) {
    const e = this.el(i); e.scrollIntoView({ block: 'center' }); e.focus();
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
