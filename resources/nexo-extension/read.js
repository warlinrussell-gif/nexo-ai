// Generado desde src/main/browser-read-script.js — no editar a mano.
window.__nexoRead = () => {
  document.querySelectorAll('[data-nexo-id]').forEach(e => e.removeAttribute('data-nexo-id'));
  const sel = 'a[href], button, input:not([type=hidden]), textarea, select, [role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], [role=option], [role=combobox], [role=searchbox], [contenteditable=""], [contenteditable=true], summary, [onclick], [tabindex]:not([tabindex="-1"])';
  const els = [...document.querySelectorAll(sel)];
  const out = []; let i = 0;
  for (const el of els) {
    const r = el.getBoundingClientRect(); const st = getComputedStyle(el);
    if (r.width < 3 || r.height < 3 || st.visibility === 'hidden' || st.display === 'none' || st.opacity === '0') continue;
    if (r.bottom < -200 || r.top > innerHeight * 2.5) continue;
    el.setAttribute('data-nexo-id', i);
    let label = (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || el.name || el.id || '').trim().replace(/\s+/g, ' ').slice(0, 90);
    const tag = el.tagName.toLowerCase();
    let extra = '';
    if (el.type && tag === 'input') extra += ' type=' + el.type;
    if (tag === 'a') { const h = el.getAttribute('href') || ''; if (h && !h.startsWith('javascript')) extra += ' href=' + h.slice(0, 70); }
    if (tag === 'select') label += ' {' + [...el.options].slice(0, 12).map(o => o.text.trim()).join('|') + '}';
    const vis = r.top >= 0 && r.bottom <= innerHeight ? '' : ' (fuera de vista)';
    out.push('[' + i + '] <' + tag + extra + '> ' + label + vis);
    i++; if (i >= 180) break;
  }
  const text = (document.body?.innerText || '').replace(/\n{3,}/g, '\n\n');
  return { url: location.href, title: document.title, text, elements: out.join('\n'), scrollY: Math.round(scrollY), scrollHeight: document.documentElement.scrollHeight, viewport: innerHeight };
};
