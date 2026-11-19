// Skills (formato SKILL.md con frontmatter name/description, compatible con Agent Skills):
// carpetas con instrucciones y archivos de apoyo que los agentes cargan bajo demanda.
import fs from 'node:fs';
import path from 'node:path';
import { dir, resourcesDir } from './paths.js';
import { load, save } from './store.js';

function parseFrontmatter(md) {
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(md);
  if (!m) return { meta: {}, body: md };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([\w-]+)\s*:\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
  }
  return { meta, body: m[2] };
}

function stState() { return load('skills', { disabled: [], seeded: false }); }

export function seedSkills() {
  const s = stState();
  const src = path.join(resourcesDir(), 'skills');
  if (!fs.existsSync(src)) return;
  for (const name of fs.readdirSync(src)) {
    const dest = dir('skills', name);
    if (!fs.existsSync(dest)) fs.cpSync(path.join(src, name), dest, { recursive: true });
  }
  s.seeded = true; save('skills', s);
}

export function listSkills() {
  const root = dir('skills');
  const disabled = stState().disabled;
  const out = [];
  for (const name of fs.readdirSync(root)) {
    const f = path.join(root, name, 'SKILL.md');
    if (!fs.existsSync(f)) continue;
    const md = fs.readFileSync(f, 'utf8');
    const { meta, body } = parseFrontmatter(md);
    const files = fs.readdirSync(path.join(root, name)).filter((x) => x !== 'SKILL.md');
    out.push({ id: name, name: meta.name || name, description: meta.description || body.split('\n').find((l) => l.trim())?.slice(0, 200) || '', enabled: !disabled.includes(name), path: path.join(root, name), files, size: md.length });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function getSkill(idOrName) {
  const s = listSkills().find((x) => x.id === idOrName || x.name.toLowerCase() === String(idOrName).toLowerCase());
  if (!s) return null;
  return { ...s, content: fs.readFileSync(path.join(s.path, 'SKILL.md'), 'utf8') };
}

export function saveSkill({ id, name, description, body }) {
  const slug = (id || name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'skill';
  const d = dir('skills', slug);
  fs.mkdirSync(d, { recursive: true });
  const content = `---\nname: ${name}\ndescription: ${String(description).replace(/\n/g, ' ')}\n---\n\n${body.trim()}\n`;
  fs.writeFileSync(path.join(d, 'SKILL.md'), content);
  return slug;
}

export function saveSkillRaw(id, content) { fs.writeFileSync(dir('skills', id, 'SKILL.md'), content); }

export function deleteSkill(id) { fs.rmSync(dir('skills', id), { recursive: true, force: true }); }

export function toggleSkill(id, enabled) {
  const s = stState();
  s.disabled = enabled ? s.disabled.filter((x) => x !== id) : [...new Set([...s.disabled, id])];
  save('skills', s);
}

export function importSkillFolder(folder) {
  const f = path.join(folder, 'SKILL.md');
  if (!fs.existsSync(f)) throw new Error('La carpeta no contiene SKILL.md');
  const name = path.basename(folder);
  fs.cpSync(folder, dir('skills', name), { recursive: true });
  return name;
}

export function skillsPrompt(allowed) {
  const list = listSkills().filter((s) => s.enabled && (!allowed || allowed === 'all' || allowed.includes(s.id)));
  if (!list.length) return '';
  return `\n\n## Skills disponibles\nTienes acceso a estas skills (paquetes de instrucciones especializadas). Cuando una tarea encaje con una, cárgala PRIMERO con la herramienta use_skill y sigue sus instrucciones:\n${list.map((s) => `- **${s.id}**: ${s.description}`).join('\n')}`;
}
