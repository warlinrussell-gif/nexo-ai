import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';

const marked = new Marked({ gfm: true, breaks: false });

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

marked.use({
  renderer: {
    code({ text, lang }) {
      const language = (lang || '').trim().split(/\s+/)[0];
      let html;
      try {
        html = language && hljs.getLanguage(language) ? hljs.highlight(text, { language, ignoreIllegals: true }).value : (text.length < 20000 ? hljs.highlightAuto(text).value : escapeHtml(text));
      } catch { html = escapeHtml(text); }
      const label = language || 'código';
      return `<div class="code-block"><div class="code-head"><span>${escapeHtml(label)}</span><button data-copy="1"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copiar</button></div><pre><code class="hljs">${html}</code></pre></div>`;
    },
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      return `<a href="${escapeHtml(href || '')}" target="_blank" rel="noreferrer"${title ? ` title="${escapeHtml(title)}"` : ''}>${text}</a>`;
    }
  }
});

const cache = new Map();

export function renderMarkdown(src, streaming = false) {
  if (!src) return '';
  let text = src;
  // cerrar bloque de código abierto durante el streaming
  if (streaming) {
    const fences = (text.match(/^```/gm) || []).length;
    if (fences % 2 === 1) text += '\n```';
  }
  if (!streaming && cache.has(text)) return cache.get(text);
  const html = DOMPurify.sanitize(marked.parse(text), { ADD_ATTR: ['target', 'data-copy'] });
  if (!streaming) {
    cache.set(text, html);
    if (cache.size > 400) cache.delete(cache.keys().next().value);
  }
  return html;
}

export function onMarkdownClick(e) {
  const btn = e.target.closest('[data-copy]');
  if (btn) {
    const code = btn.closest('.code-block')?.querySelector('code')?.innerText || '';
    navigator.clipboard.writeText(code);
    const old = btn.innerHTML;
    btn.textContent = 'Copiado';
    setTimeout(() => { btn.innerHTML = old; }, 1400);
    e.preventDefault();
  }
}
