// Memoria persistente estilo Claude Code: NexoData/memory/MEMORY.md (índice que se carga en cada chat)
// + un archivo .md por recuerdo con frontmatter (name, description, type). Todo local.
import fs from 'node:fs';
import path from 'node:path';
import { dir } from './paths.js';

export const MEM_TYPES = ['user', 'feedback', 'project', 'reference'];
const INDEX_MAX_LINES = 200, INDEX_MAX_BYTES = 25 * 1024;

const root = () => { const d = dir('memory'); fs.mkdirSync(d, { recursive: true }); return d; };
const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'recuerdo';

function parse(md) {
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(md);
  if (!m) return { meta: {}, body: md };
  const meta = {};
  for (const line of m[1].split('\n')) { const kv = /^([\w-]+)\s*:\s*(.*)$/.exec(line); if (kv) meta[kv[1]] = kv[2].trim(); }
  return { meta, body: m[2].trim() };
}

export function listMem() {
  const out = [];
  for (const f of fs.readdirSync(root())) {
    if (!f.endsWith('.md') || f === 'MEMORY.md') continue;
    try {
      const full = path.join(root(), f);
      const { meta } = parse(fs.readFileSync(full, 'utf8'));
      out.push({ name: f.slice(0, -3), title: meta.title || meta.name || f.slice(0, -3), description: meta.description || '', type: MEM_TYPES.includes(meta.type) ? meta.type : 'user', updated: fs.statSync(full).mtimeMs });
    } catch { /* archivo ilegible */ }
  }
  return out.sort((a, b) => b.updated - a.updated);
}

export function readMem(name) {
  const f = path.join(root(), slug(name) + '.md');
  if (!fs.existsSync(f)) throw new Error(`No existe la memoria "${name}"`);
  const { meta, body } = parse(fs.readFileSync(f, 'utf8'));
  return { name: slug(name), title: meta.title || name, description: meta.description || '', type: meta.type || 'user', content: body };
}

export function rebuildIndex() {
  const lines = listMem().map((m) => `- [${m.title}](${m.name}.md) — ${m.type}${m.description ? ': ' + m.description : ''}`);
  fs.writeFileSync(path.join(root(), 'MEMORY.md'), `# Memoria de Nexo\n\n${lines.join('\n')}\n`);
}

/** Crea o actualiza un recuerdo. */
export function writeMem({ name, title, description = '', type = 'user', content }) {
  if (!content || !String(content).trim()) throw new Error('El contenido no puede estar vacío');
  const id = slug(name || title);
  const t = MEM_TYPES.includes(type) ? type : 'user';
  const md = `---\ntitle: ${String(title || name || id).replace(/\n/g, ' ')}\ndescription: ${String(description).replace(/\n/g, ' ')}\ntype: ${t}\n---\n\n${String(content).trim()}\n`;
  fs.writeFileSync(path.join(root(), id + '.md'), md);
  rebuildIndex();
  return id;
}

export function deleteMem(name) {
  fs.rmSync(path.join(root(), slug(name) + '.md'), { force: true });
  rebuildIndex();
}

/** Índice para el prompt de sistema (primeras 200 líneas / 25 KB, como Claude Code). */
export function indexPrompt() {
  const f = path.join(root(), 'MEMORY.md');
  if (!fs.existsSync(f)) return '';
  let t = fs.readFileSync(f, 'utf8').split('\n').slice(0, INDEX_MAX_LINES).join('\n');
  if (Buffer.byteLength(t) > INDEX_MAX_BYTES) t = t.slice(0, INDEX_MAX_BYTES);
  return /\]\(/.test(t) ? t : '';
}
