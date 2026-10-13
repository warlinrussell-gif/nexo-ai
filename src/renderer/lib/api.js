// Puente con el proceso principal + utilidades de formato
export const nexo = window.nexo || {
  call: async () => { throw new Error('API no disponible'); },
  on: () => () => { },
  pathForFile: () => '',
  platform: 'web'
};

export const call = (method, ...args) => nexo.call(method, ...args);
export const on = (channel, fn) => nexo.on(channel, fn);

export function fileUrl(p) { return p ? 'nexo://file/' + encodeURIComponent(p) : ''; }

export function fmtBytes(b, d = 1) {
  if (b === undefined || b === null || isNaN(b)) return '—';
  const G = 1024 ** 3, M = 1024 ** 2;
  if (b >= G * 1000) return (b / G / 1024).toFixed(d) + ' TB';
  if (b >= G) return (b / G).toFixed(d) + ' GB';
  if (b >= M) return (b / M).toFixed(0) + ' MB';
  return Math.round(b / 1024) + ' KB';
}

export function fmtNum(n) {
  if (!n && n !== 0) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}

export function fmtParams(p) {
  if (!p) return '';
  if (p >= 1e9) return (p / 1e9 >= 100 ? Math.round(p / 1e9) : (p / 1e9).toFixed(1).replace(/\.0$/, '')) + 'B';
  return Math.round(p / 1e6) + 'M';
}

export function fmtDuration(s) {
  if (!s || s < 0 || !isFinite(s)) return '';
  if (s < 60) return Math.round(s) + ' s';
  if (s < 3600) return Math.floor(s / 60) + ' min ' + Math.round(s % 60) + ' s';
  return Math.floor(s / 3600) + ' h ' + Math.round((s % 3600) / 60) + ' min';
}

export function timeAgo(t) {
  const d = (Date.now() - t) / 1000;
  if (d < 60) return 'ahora';
  if (d < 3600) return Math.floor(d / 60) + ' min';
  if (d < 86400) return Math.floor(d / 3600) + ' h';
  if (d < 86400 * 30) return Math.floor(d / 86400) + ' d';
  return new Date(t).toLocaleDateString('es-ES');
}

export function colorFor(str = '') {
  const colors = ['#8b5cf6', '#06b6d4', '#22c55e', '#f59e0b', '#ec4899', '#3b82f6', '#ef4444', '#14b8a6', '#a855f7', '#f97316'];
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return colors[h % colors.length];
}

export const RATING = {
  fluido: { label: 'Fluido', color: 'var(--green)', badge: 'green' },
  bueno: { label: 'Funciona bien', color: 'var(--teal)', badge: 'teal' },
  lento: { label: 'Funciona (lento)', color: 'var(--amber)', badge: 'amber' },
  muylento: { label: 'Muy lento', color: 'var(--orange)', badge: 'orange' },
  nofit: { label: 'No cabe', color: 'var(--red)', badge: 'red' }
};

export const CAPS = {
  vision: { label: 'Visión', icon: 'eye' },
  tools: { label: 'Herramientas', icon: 'wrench' },
  reasoning: { label: 'Razonamiento', icon: 'brain' },
  code: { label: 'Código', icon: 'code' },
  computer: { label: 'Control PC', icon: 'mouse-pointer-click' },
  moe: { label: 'MoE', icon: 'layers' }
};

export function copyText(t) { return navigator.clipboard.writeText(t); }
