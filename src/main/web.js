// Búsqueda web (sin clave: DuckDuckGo/Bing; opcional Brave, Tavily, SearXNG) y lectura de páginas.
import { BrowserWindow } from 'electron';
import { truncate } from './util.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'", '#x2F': '/', hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»', iexcl: '¡', iquest: '¿', ntilde: 'ñ', Ntilde: 'Ñ', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', uuml: 'ü', copy: '©', reg: '®', euro: '€' };
export function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
    if (ENTITIES[e] !== undefined) return ENTITIES[e];
    if (e[0] === '#') { const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(code) ? String.fromCodePoint(code) : m; }
    return m;
  });
}

const stripTags = (s) => decodeEntities(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

export function htmlToText(html, baseUrl = '') {
  let h = html;
  const title = stripTags((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(h) || [])[1] || '');
  h = h.replace(/<(script|style|noscript|svg|iframe|template|canvas)[\s\S]*?<\/\1>/gi, ' ');
  h = h.replace(/<!--[\s\S]*?-->/g, ' ');
  const main = /<(main|article)[^>]*>([\s\S]*?)<\/\1>/i.exec(h);
  if (main && main[2].length > 1500) h = main[2];
  else h = h.replace(/<(nav|footer|header|aside|form)[\s\S]*?<\/\1>/gi, ' ');
  h = h.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, t) => `\n\n${'#'.repeat(+n)} ${stripTags(t)}\n\n`);
  h = h.replace(/<li[^>]*>/gi, '\n- ');
  h = h.replace(/<a [^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, t) => {
    const text = stripTags(t);
    if (!text) return ' ';
    let url = href;
    try { url = new URL(href, baseUrl).href; } catch { }
    return /^https?:/.test(url) && text.length < 120 ? `[${text}](${url})` : text;
  });
  h = h.replace(/<(br|hr)\s*\/?>/gi, '\n');
  h = h.replace(/<\/(p|div|section|tr|table|blockquote|pre|ul|ol|dl)>/gi, '\n\n');
  h = h.replace(/<t[dh][^>]*>/gi, ' | ');
  h = h.replace(/<[^>]+>/g, ' ');
  h = decodeEntities(h);
  h = h.split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { title, text: h };
}

async function ddg(query, max) {
  const res = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', 'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8' },
    body: new URLSearchParams({ q: query, kl: 'es-es' })
  });
  if (!res.ok) throw new Error('DuckDuckGo ' + res.status);
  const html = await res.text();
  const results = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/g;
  let m;
  while ((m = re.exec(html)) && results.length < max) {
    let url = decodeEntities(m[1]);
    const u = /[?&]uddg=([^&]+)/.exec(url);
    if (u) url = decodeURIComponent(u[1]);
    if (url.startsWith('//')) url = 'https:' + url;
    if (/duckduckgo\.com\/y\.js|ad_domain/.test(url)) continue;
    results.push({ title: stripTags(m[2]), url, snippet: stripTags(m[3] || '') });
  }
  return results;
}

async function bing(query, max) {
  const res = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=es&count=${max}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'es-ES,es;q=0.9' } });
  const html = await res.text();
  const results = [];
  const re = /<li class="b_algo"[\s\S]*?<h2[^>]*><a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>([\s\S]*?)<\/li>/g;
  let m;
  while ((m = re.exec(html)) && results.length < max) {
    const snip = (/<p[^>]*>([\s\S]*?)<\/p>/.exec(m[3]) || [])[1] || '';
    let url = decodeEntities(m[1]);
    const u = /[?&]u=a1([^&]+)/.exec(url);
    if (u) { try { url = Buffer.from(u[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch { } }
    results.push({ title: stripTags(m[2]), url, snippet: stripTags(snip) });
  }
  return results;
}

export async function webSearch(query, { max = 8, engine = 'auto', keys = {}, searxngUrl } = {}) {
  if (engine === 'brave' && keys.brave) {
    const r = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${max}`, { headers: { 'X-Subscription-Token': keys.brave, Accept: 'application/json' } });
    const j = await r.json();
    return (j.web?.results || []).map((x) => ({ title: x.title, url: x.url, snippet: stripTags(x.description || '') }));
  }
  if (engine === 'tavily' && keys.tavily) {
    const r = await fetch('https://api.tavily.com/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: keys.tavily, query, max_results: max, include_answer: false }) });
    const j = await r.json();
    return (j.results || []).map((x) => ({ title: x.title, url: x.url, snippet: (x.content || '').slice(0, 400) }));
  }
  if (engine === 'searxng' && searxngUrl) {
    const r = await fetch(`${searxngUrl.replace(/\/$/, '')}/search?q=${encodeURIComponent(query)}&format=json`);
    const j = await r.json();
    return (j.results || []).slice(0, max).map((x) => ({ title: x.title, url: x.url, snippet: x.content || '' }));
  }
  let results = [];
  try { results = await ddg(query, max); } catch { }
  if (results.length < 2) { try { results = await bing(query, max); } catch { } }
  if (results.length < 2) results = await renderedSearch(query, max);
  return results;
}

async function renderedSearch(query, max) {
  const html = await renderPage(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&ia=web`, 'document.documentElement.outerHTML', 2500);
  const results = [];
  const re = /<a[^>]+data-testid="result-title-a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) && results.length < max) results.push({ title: stripTags(m[2]), url: decodeEntities(m[1]), snippet: '' });
  return results;
}

export async function renderPage(url, script = 'document.body.innerText', waitMs = 1500) {
  const win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { offscreen: true, sandbox: true, javascript: true, images: false } });
  try {
    win.webContents.setUserAgent(UA);
    win.webContents.setAudioMuted(true);
    await Promise.race([win.loadURL(url), new Promise((_, rej) => setTimeout(() => rej(new Error('Tiempo de carga agotado')), 25000))]);
    await new Promise((r) => setTimeout(r, waitMs));
    return await win.webContents.executeJavaScript(script, true);
  } finally { win.destroy(); }
}

export async function fetchUrl(url, { maxChars = 20000 } = {}) {
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8', Accept: 'text/html,application/xhtml+xml,application/json,text/plain,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
  } catch (e) { res = null; }
  const ct = res?.headers.get('content-type') || '';
  if (res && res.ok && /json|text\/plain|xml|csv|markdown/.test(ct) && !/html/.test(ct)) {
    return { url: res.url, title: '', text: truncate(await res.text(), maxChars) };
  }
  if (res && res.ok && /pdf/.test(ct)) return { url: res.url, title: 'PDF', text: 'El enlace es un PDF. Descárgalo con run_command o ábrelo en el navegador integrado para leerlo.' };
  let parsed = { title: '', text: '' };
  if (res && res.ok) parsed = htmlToText(await res.text(), res.url);
  if (!res || !res.ok || parsed.text.length < 400) {
    // página con JavaScript o protegida: renderizar con Chromium
    try {
      const r = await renderPage(url, '({ title: document.title, text: document.body.innerText, url: location.href })', 2000);
      if (r?.text && r.text.length > parsed.text.length) parsed = { title: r.title, text: r.text.replace(/\n{3,}/g, '\n\n') };
    } catch (e) { if (!parsed.text) throw new Error(`No se pudo abrir ${url}: ${e.message}`); }
  }
  return { url: res?.url || url, title: parsed.title, text: truncate(parsed.text, maxChars) };
}
