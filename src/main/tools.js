// Herramientas integradas que los modelos pueden usar + sistema de permisos.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { app, shell, clipboard, Notification, screen } from 'electron';
import { isWin, isMac, truncate, run, uid } from './util.js';
import { dir } from './paths.js';
import * as computer from './computer.js';
import { webSearch, fetchUrl } from './web.js';
import { browser } from './browser.js';
import { addMemory, deleteMemory, listMemory } from './agents.js';
import { getSkill, listSkills } from './skills.js';
import { mcp } from './mcp.js';

const IMG_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp' };

function expand(p, cwd) {
  if (!p) return cwd || os.homedir();
  let s = String(p).trim().replace(/^~(?=$|[\\/])/, os.homedir());
  if (isWin) s = s.replace(/%([^%]+)%/g, (_, v) => process.env[v] || _);
  return path.resolve(cwd || os.homedir(), s);
}

const bgProcs = new Map();

function shellCmd(command) {
  if (isWin) return ['powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'; ${command}`]];
  return [process.env.SHELL || '/bin/bash', ['-lc', command]];
}

export function execCommand(command, { cwd, timeout = 120, signal, env }) {
  return new Promise((resolve) => {
    const [bin, args] = shellCmd(command);
    const child = spawn(bin, args, { cwd, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8', ...env } });
    let out = '', err = '', killed = false;
    child.stdout.on('data', (d) => { out += d.toString(); if (out.length > 2e6) out = out.slice(-1e6); });
    child.stderr.on('data', (d) => { err += d.toString(); if (err.length > 1e6) err = err.slice(-5e5); });
    const kill = () => { killed = true; if (isWin) run('taskkill', ['/pid', String(child.pid), '/T', '/F']); else try { child.kill('SIGKILL'); } catch { } };
    const t = setTimeout(kill, timeout * 1000);
    signal?.addEventListener('abort', kill, { once: true });
    child.on('close', (code) => {
      clearTimeout(t);
      resolve({ code, out, err, killed });
    });
    child.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out, err: e.message, killed }); });
  });
}

async function walk(root, { pattern, content, max = 200, depth = 8 }) {
  const results = [];
  const nameRe = pattern ? new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i') : null;
  const contentRe = content ? new RegExp(content, 'i') : null;
  const skip = new Set(['node_modules', '.git', '$Recycle.Bin', 'AppData', '__pycache__', '.venv', 'venv', 'System Volume Information', 'Windows']);
  const stack = [[root, 0]];
  while (stack.length && results.length < max) {
    const [d, lv] = stack.pop();
    let entries;
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!skip.has(e.name) && lv < depth) stack.push([p, lv + 1]); if (nameRe && !contentRe && nameRe.test(e.name)) results.push(p + path.sep); continue; }
      if (nameRe && !nameRe.test(e.name)) continue;
      if (contentRe) {
        try {
          const st = await fsp.stat(p);
          if (st.size > 3e6) continue;
          const txt = await fsp.readFile(p, 'utf8');
          const lines = txt.split('\n');
          for (let i = 0; i < lines.length; i++) if (contentRe.test(lines[i])) { results.push(`${p}:${i + 1}: ${lines[i].trim().slice(0, 200)}`); if (results.length >= max) break; }
        } catch { }
      } else results.push(p);
      if (results.length >= max) break;
    }
  }
  return results;
}

// Convierte un patrón glob (src/**/*.js, *.{ts,tsx}) en regex sobre la ruta relativa con "/"
function globRe(glob) {
  let g = String(glob).replace(/\\/g, '/').replace(/^\.\//, '');
  if (!g.includes('/')) g = '**/' + g;
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const ch = g[i];
    if (ch === '*') { if (g[i + 1] === '*') { i++; if (g[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*'; } else re += '[^/]*'; }
    else if (ch === '?') re += '[^/]';
    else if (ch === '{') { const j = g.indexOf('}', i); if (j > i) { re += '(?:' + g.slice(i + 1, j).split(',').map((x) => x.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('|') + ')'; i = j; } else re += '\\{'; }
    else re += ch.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$', 'i');
}

const SKIP_DIRS = new Set(['node_modules', '.git', '$Recycle.Bin', '__pycache__', '.venv', 'venv', 'System Volume Information', 'dist', 'release', '.next', 'target', '.cache']);

// Recorre archivos bajo root; devuelve rutas relativas con "/" (sin carpetas ignoradas)
async function listFiles(root, { re, max = 20000 }) {
  const out = [];
  const stack = [''];
  while (stack.length && out.length < max) {
    const rel = stack.pop();
    let entries;
    try { entries = await fsp.readdir(path.join(root, rel), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) stack.push(r); continue; }
      if (!re || re.test(r)) out.push(r);
    }
  }
  return out;
}

let rgPath;
async function ripgrep() {
  if (rgPath !== undefined) return rgPath;
  const r = await execCommand(isWin ? '(Get-Command rg -ErrorAction SilentlyContinue).Source' : 'command -v rg', { timeout: 10 });
  rgPath = r.out.trim().split(/\r?\n/)[0] || null;
  return rgPath;
}

function rgRun(bin, args, cwd, signal) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd, windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); if (out.length > 4e6) child.kill(); });
    child.stderr.on('data', () => { });
    signal?.addEventListener('abort', () => child.kill(), { once: true });
    child.on('close', (code) => resolve({ code, out }));
    child.on('error', () => resolve({ code: -1, out: null }));
  });
}

function fmtSize(n) { return n > 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : n > 1e3 ? (n / 1e3).toFixed(0) + ' KB' : n + ' B'; }

/** Construye la lista de herramientas integradas. ctx: { settings, workspace, delegate, emitPlan, agents } */
export function builtinTools(ctx) {
  const cwdDefault = () => ctx.workspace || os.homedir();
  const T = [];
  const readStamps = ctx.readStamps || (ctx.readStamps = new Map());
  // Si el archivo cambió fuera (usuario/otro proceso) desde la última lectura, el modelo trabajaría sobre texto viejo
  const assertFresh = async (p) => {
    const t = readStamps.get(p);
    if (t === undefined) return;
    const st = await fsp.stat(p).catch(() => null);
    if (st && st.mtimeMs > t + 1) throw new Error('El archivo cambió desde que lo leíste (lo modificó el usuario u otro proceso). Vuelve a leerlo con read_file antes de editarlo.');
  };
  const stamp = async (p) => { const st = await fsp.stat(p).catch(() => null); if (st) readStamps.set(p, st.mtimeMs); };
  const add = (group, risk, name, description, properties, required, runFn) => T.push({ group, risk, name, description, parameters: { type: 'object', properties, required }, run: runFn });

  // ─── Archivos ───
  add('files', 'read', 'read_file', 'Lee un archivo de texto (con números de línea) o una imagen (la verás). Usa offset/limit para archivos grandes.', {
    path: { type: 'string', description: 'Ruta absoluta o relativa al directorio de trabajo' }, offset: { type: 'integer', description: 'Línea inicial (1 = primera)' }, limit: { type: 'integer', description: 'Máximo de líneas (por defecto 400)' }
  }, ['path'], async (a, c) => {
    const p = expand(a.path, cwdDefault());
    const st = await fsp.stat(p);
    if (st.isDirectory()) throw new Error('Es una carpeta; usa list_directory');
    const ext = path.extname(p).toLowerCase();
    if (IMG_EXT[ext]) { const data = (await fsp.readFile(p)).toString('base64'); return { text: `Imagen ${path.basename(p)} (${fmtSize(st.size)})`, images: [{ data, mime: IMG_EXT[ext] }] }; }
    if (st.size > 20e6) throw new Error('Archivo demasiado grande para leerlo entero (' + fmtSize(st.size) + '). Usa run_command para procesarlo.');
    const buf = await fsp.readFile(p);
    readStamps.set(p, st.mtimeMs);
    if (buf.subarray(0, 8000).includes(0)) return `Archivo binario (${fmtSize(st.size)}). No se puede mostrar como texto.`;
    const lines = buf.toString('utf8').split('\n');
    const off = Math.max(1, a.offset || 1), lim = Math.min(2000, a.limit || 400);
    const budget = Math.max(2000, (c?.maxChars || 1e9) - 300);
    const out = [];
    let used = 0;
    for (let i = off - 1; i < Math.min(lines.length, off - 1 + lim); i++) {
      const l = `${String(i + 1).padStart(5)}| ${lines[i].length > 2000 ? lines[i].slice(0, 2000) + '…' : lines[i]}`;
      if (used + l.length + 1 > budget && out.length) break; // no cabe más en el contexto del modelo
      out.push(l); used += l.length + 1;
    }
    const cut = out.length < Math.min(lim, lines.length - off + 1);
    const lim2 = out.length;
    const slice = out.join('\n');
    // Si el modelo pidió un rango concreto no se le invita a seguir leyendo (los modelos pequeños entran en bucle)
    const shown = `líneas ${off}-${off - 1 + lim2} de ${lines.length} en total`;
    const more = cut ? `\n\n[${shown}. El resto no cabe en el contexto del modelo: pide otro rango con offset=${off + lim2} o busca el dato con search_files]`
      : lines.length > off - 1 + lim2 ? (a.limit || a.offset ? `\n\n[${shown}]` : `\n\n[${shown}; si necesitas más, continúa con offset=${off + lim2}]`)
      : (off > 1 ? `\n\n[${shown}]` : `\n\n[archivo completo: ${lines.length} líneas]`);
    return slice + more;
  });
  add('files', 'write', 'write_file', 'Crea o sobrescribe un archivo con el contenido indicado (crea carpetas si hace falta). Usa append=true para añadir al final.', {
    path: { type: 'string' }, content: { type: 'string' }, append: { type: 'boolean' }
  }, ['path', 'content'], async (a, c) => {
    const p = expand(a.path, cwdDefault());
    await c.checkpoint?.(p);
    await fsp.mkdir(path.dirname(p), { recursive: true });
    if (a.append) await fsp.appendFile(p, a.content); else await fsp.writeFile(p, a.content);
    await stamp(p);
    return `Archivo ${a.append ? 'actualizado' : 'guardado'}: ${p} (${fmtSize(Buffer.byteLength(a.content))})`;
  });
  add('files', 'write', 'edit_file', 'Edita un archivo reemplazando un fragmento exacto de texto por otro. old_text debe ser único salvo que replace_all=true.', {
    path: { type: 'string' }, old_text: { type: 'string' }, new_text: { type: 'string' }, replace_all: { type: 'boolean' }
  }, ['path', 'old_text', 'new_text'], async (a, c) => {
    const p = expand(a.path, cwdDefault());
    await assertFresh(p);
    const txt = await fsp.readFile(p, 'utf8');
    // tolerar finales de línea CRLF cuando el modelo envía LF
    let oldT = a.old_text, newT = a.new_text;
    if (!txt.includes(oldT) && txt.includes('\r\n') && oldT.includes('\n')) { oldT = oldT.replace(/\r?\n/g, '\r\n'); newT = newT.replace(/\r?\n/g, '\r\n'); }
    const count = txt.split(oldT).length - 1;
    if (!count) throw new Error('old_text no se encontró en el archivo (revisa espacios y saltos de línea exactos; usa read_file para copiar el texto actual)');
    if (count > 1 && !a.replace_all) throw new Error(`old_text aparece ${count} veces; añade más contexto o usa replace_all`);
    await c.checkpoint?.(p);
    const out = a.replace_all ? txt.split(oldT).join(newT) : txt.replace(oldT, () => newT);
    await fsp.writeFile(p, out);
    await stamp(p);
    // fragmento resultante con números de línea para que el modelo verifique el cambio
    const at = out.indexOf(newT);
    const startLine = at >= 0 ? out.slice(0, at).split('\n').length : 1;
    const lines = out.split('\n');
    const from = Math.max(1, startLine - 3), to = Math.min(lines.length, startLine + newT.split('\n').length + 2);
    const snippet = lines.slice(from - 1, to).map((l, i) => `${String(from + i).padStart(5)}| ${l.replace(/\r$/, '')}`).join('\n');
    return `Editado ${p} (${a.replace_all ? count : 1} reemplazo/s). Resultado:\n${snippet}`;
  });
  add('files', 'write', 'multi_edit', 'Aplica varias ediciones a UN archivo de una sola vez (todas o ninguna). Cada edición reemplaza old_text exacto por new_text, en orden, sobre el resultado de la anterior. Úsalo en lugar de varias llamadas a edit_file.', {
    path: { type: 'string' },
    edits: { type: 'array', items: { type: 'object', properties: { old_text: { type: 'string' }, new_text: { type: 'string' }, replace_all: { type: 'boolean' } }, required: ['old_text', 'new_text'] } }
  }, ['path', 'edits'], async (a, c) => {
    const p = expand(a.path, cwdDefault());
    await assertFresh(p);
    let txt = await fsp.readFile(p, 'utf8');
    const crlf = txt.includes('\r\n');
    let n = 0;
    (a.edits || []).forEach((e, i) => {
      let oldT = e.old_text, newT = e.new_text;
      if (oldT && !txt.includes(oldT) && crlf && oldT.includes('\n')) { oldT = oldT.replace(/\r?\n/g, '\r\n'); newT = newT.replace(/\r?\n/g, '\r\n'); }
      const count = oldT ? txt.split(oldT).length - 1 : 0;
      if (!count) throw new Error(`Edición ${i + 1}: old_text no se encontró (no se aplicó ningún cambio). Relee el archivo y copia el texto exacto.`);
      if (count > 1 && !e.replace_all) throw new Error(`Edición ${i + 1}: old_text aparece ${count} veces; añade contexto o usa replace_all (no se aplicó ningún cambio).`);
      txt = e.replace_all ? txt.split(oldT).join(newT) : txt.replace(oldT, () => newT);
      n += e.replace_all ? count : 1;
    });
    await c.checkpoint?.(p);
    await fsp.writeFile(p, txt);
    await stamp(p);
    return `Editado ${p}: ${(a.edits || []).length} ediciones (${n} reemplazos). Usa read_file si necesitas comprobar el resultado.`;
  });
  add('files', 'read', 'glob', 'Encuentra archivos por patrón glob (p. ej. "**/*.tsx", "src/**/test_*.py", "*.{js,ts}") dentro de una carpeta. Rápido; ignora node_modules, .git, dist… Devuelve rutas ordenadas por fecha de modificación (más recientes primero).', {
    pattern: { type: 'string' }, path: { type: 'string', description: 'Carpeta raíz (por defecto: directorio de trabajo)' }
  }, ['pattern'], async (a) => {
    const root = expand(a.path, cwdDefault());
    const files = await listFiles(root, { re: globRe(a.pattern) });
    const withT = await Promise.all(files.slice(0, 5000).map(async (f) => [f, (await fsp.stat(path.join(root, f)).catch(() => null))?.mtimeMs || 0]));
    withT.sort((x, y) => y[1] - x[1]);
    if (!withT.length) return `Sin coincidencias para ${a.pattern} en ${root}`;
    return `${root}\n${withT.slice(0, 300).map((x) => x[0]).join('\n')}${withT.length > 300 ? `\n[… ${withT.length - 300} más; afina el patrón]` : ''}`;
  });
  add('files', 'read', 'grep', 'Busca texto con expresiones regulares dentro de los archivos (como ripgrep). output_mode: "files" (solo rutas, por defecto), "content" (líneas con número; admite context), "count". Filtra con glob (p. ej. "*.js") o type (js, py, ts…). La herramienta preferida para encontrar código.', {
    pattern: { type: 'string', description: 'Regex' }, path: { type: 'string', description: 'Carpeta o archivo (por defecto: directorio de trabajo)' },
    glob: { type: 'string' }, type: { type: 'string' }, output_mode: { type: 'string', enum: ['files', 'content', 'count'] },
    context: { type: 'integer', description: 'Líneas de contexto antes y después (modo content)' }, ignore_case: { type: 'boolean' }, max_results: { type: 'integer' }
  }, ['pattern'], async (a, c) => {
    const target = expand(a.path, cwdDefault());
    const mode = a.output_mode || 'files';
    const max = Math.min(1000, a.max_results || (mode === 'content' ? 200 : 300));
    const ctxN = Math.min(10, Math.max(0, a.context || 0));
    const rg = await ripgrep();
    if (rg) {
      const args = ['--no-heading', '--color', 'never', '--max-columns', '400'];
      if (a.ignore_case) args.push('-i');
      if (a.glob) args.push('-g', a.glob);
      if (a.type) args.push('-t', a.type);
      if (mode === 'files') args.push('-l'); else if (mode === 'count') args.push('-c'); else { args.push('-n'); if (ctxN) args.push('-C', String(ctxN)); }
      args.push('-e', a.pattern, target);
      const r = await rgRun(rg, args, cwdDefault(), c?.signal);
      if (r.out !== null && r.code !== 2) {
        const lines = r.out.split(/\r?\n/).filter(Boolean);
        if (!lines.length) return 'Sin resultados';
        return lines.slice(0, max).join('\n') + (lines.length > max ? `\n[… ${lines.length - max} más; afina la búsqueda]` : '');
      }
    }
    // Sin ripgrep: búsqueda propia
    let re;
    try { re = new RegExp(a.pattern, a.ignore_case ? 'i' : ''); } catch (e) { throw new Error('Regex no válida: ' + e.message); }
    const TYPES = { js: 'js,mjs,cjs,jsx', ts: 'ts,tsx', py: 'py', java: 'java', cs: 'cs', go: 'go', rust: 'rs', cpp: 'cpp,cc,h,hpp,c', html: 'html,htm', css: 'css,scss', json: 'json', md: 'md' };
    const fre = a.glob ? globRe(a.glob) : a.type ? globRe(`*.{${TYPES[a.type] || a.type}}`) : null;
    const st0 = await fsp.stat(target);
    const files = st0.isFile() ? [''] : await listFiles(target, { re: fre });
    const out = [];
    for (const f of files) {
      if (out.length >= max || c?.signal?.aborted) break;
      const fp = f ? path.join(target, f) : target;
      let txt;
      try { const st = await fsp.stat(fp); if (st.size > 3e6) continue; const b = await fsp.readFile(fp); if (b.subarray(0, 4000).includes(0)) continue; txt = b.toString('utf8'); } catch { continue; }
      const lines = txt.split(/\r?\n/);
      const hits = [];
      for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) hits.push(i);
      if (!hits.length) continue;
      if (mode === 'files') out.push(fp);
      else if (mode === 'count') out.push(`${fp}:${hits.length}`);
      else {
        const shown = new Set();
        for (const h of hits) for (let k = Math.max(0, h - ctxN); k <= Math.min(lines.length - 1, h + ctxN); k++) {
          if (shown.has(k)) continue; shown.add(k);
          out.push(`${fp}:${k + 1}${k === h ? ':' : '-'} ${lines[k].slice(0, 400)}`);
          if (out.length >= max) break;
        }
      }
    }
    return out.length ? out.join('\n') + (out.length >= max ? '\n[límite alcanzado; afina la búsqueda]' : '') : 'Sin resultados';
  });
  add('files', 'read', 'list_directory', 'Lista el contenido de una carpeta (nombre, tipo, tamaño, fecha). depth>1 para ver subcarpetas.', {
    path: { type: 'string', description: 'Carpeta (por defecto: directorio de trabajo). Admite ~ y %VARIABLES%' }, depth: { type: 'integer' }
  }, [], async (a) => {
    const root = expand(a.path, cwdDefault());
    const depth = Math.min(4, a.depth || 1);
    const lines = [];
    const rec = async (d, lv, prefix) => {
      let entries = await fsp.readdir(d, { withFileTypes: true });
      entries = entries.sort((x, y) => (y.isDirectory() - x.isDirectory()) || x.name.localeCompare(y.name));
      for (const e of entries.slice(0, 300)) {
        const p = path.join(d, e.name);
        let info = '';
        try { const st = await fsp.stat(p); info = e.isDirectory() ? '' : ` (${fmtSize(st.size)}, ${st.mtime.toISOString().slice(0, 10)})`; } catch { }
        lines.push(`${prefix}${e.name}${e.isDirectory() ? '/' : ''}${info}`);
        if (e.isDirectory() && lv < depth && !['node_modules', '.git'].includes(e.name)) await rec(p, lv + 1, prefix + '  ');
        if (lines.length > 1500) return;
      }
    };
    await rec(root, 1, '');
    return `${root}\n${lines.join('\n') || '(vacía)'}`;
  });
  add('files', 'read', 'search_files', 'Busca archivos por nombre (comodines * ?) y/o por contenido (regex) dentro de una carpeta, recursivamente.', {
    path: { type: 'string' }, pattern: { type: 'string', description: 'Patrón de nombre, p. ej. *.pdf o informe*' }, content: { type: 'string', description: 'Regex a buscar dentro de los archivos' }, max_results: { type: 'integer' }
  }, [], async (a) => {
    const r = await walk(expand(a.path, cwdDefault()), { pattern: a.pattern, content: a.content, max: Math.min(500, a.max_results || 150) });
    return r.length ? r.join('\n') : 'Sin resultados';
  });
  add('files', 'write', 'move_path', 'Mueve o renombra un archivo o carpeta. Con copy=true copia en vez de mover.', {
    from: { type: 'string' }, to: { type: 'string' }, copy: { type: 'boolean' }
  }, ['from', 'to'], async (a, c) => {
    const f = expand(a.from, cwdDefault()), t = expand(a.to, cwdDefault());
    if (!a.copy) await c.checkpoint?.(f);
    await c.checkpoint?.(t);
    await fsp.mkdir(path.dirname(t), { recursive: true });
    if (a.copy) await fsp.cp(f, t, { recursive: true }); else await fsp.rename(f, t).catch(async () => { await fsp.cp(f, t, { recursive: true }); await fsp.rm(f, { recursive: true, force: true }); });
    return `${a.copy ? 'Copiado' : 'Movido'}: ${f} → ${t}`;
  });
  add('files', 'exec', 'delete_path', 'Elimina un archivo o carpeta (a la papelera por defecto).', {
    path: { type: 'string' }, permanent: { type: 'boolean', description: 'true = borrar definitivamente sin papelera' }
  }, ['path'], async (a, c) => {
    const p = expand(a.path, cwdDefault());
    await c.checkpoint?.(p);
    if (a.permanent) await fsp.rm(p, { recursive: true, force: true }); else await shell.trashItem(p);
    return `Eliminado ${a.permanent ? 'definitivamente' : '(a la papelera)'}: ${p}`;
  });

  // ─── Sistema ───
  add('system', 'exec', 'run_command', `Ejecuta un comando en ${isWin ? 'PowerShell' : 'la terminal (bash)'} y devuelve la salida. Útil para instalar, compilar, gestionar el sistema, scripts, git, python, etc. Usa background=true para procesos que no terminan (servidores).`, {
    command: { type: 'string' }, cwd: { type: 'string', description: 'Directorio de trabajo' }, timeout_seconds: { type: 'integer', description: 'Por defecto 120, máx. 1800' }, background: { type: 'boolean' }
  }, ['command'], async (a, c) => {
    const cwd = expand(a.cwd, cwdDefault());
    if (a.background) {
      const [bin, args] = shellCmd(a.command);
      const log = path.join(dir('logs'), `bg-${uid()}.log`);
      const fd = fs.openSync(log, 'a');
      const child = spawn(bin, args, { cwd, detached: !isWin, windowsHide: true, stdio: ['ignore', fd, fd] });
      const info = { command: a.command, log, running: true };
      bgProcs.set(child.pid, info);
      child.on('exit', (code) => { info.running = false; info.code = code; });
      child.unref();
      return `Proceso en segundo plano iniciado (PID ${child.pid}). Lee su salida con process_output(pid=${child.pid}).`;
    }
    const r = await execCommand(a.command, { cwd, timeout: Math.min(1800, a.timeout_seconds || 120), signal: c.signal });
    let out = '';
    if (r.out.trim()) out += truncate(r.out.trim(), 30000);
    if (r.err.trim()) out += (out ? '\n\n' : '') + '[stderr]\n' + truncate(r.err.trim(), 10000);
    return `${out || '(sin salida)'}\n\n[código de salida: ${r.code}${r.killed ? ', detenido por tiempo/cancelación' : ''}]`;
  });
  add('system', 'write', 'open_app', 'Abre un programa, archivo, carpeta o URL con la aplicación predeterminada del sistema (p. ej. "notepad", "calc", "C:\\\\ruta\\\\doc.pdf", "https://..."; en Windows también nombres del menú Inicio como "spotify").', {
    target: { type: 'string' }, args: { type: 'string', description: 'Argumentos opcionales para el programa' }
  }, ['target'], async (a) => {
    const t = String(a.target).trim();
    if (/^[a-z]+:\/\//i.test(t) || /^mailto:/i.test(t)) { await shell.openExternal(t); return `Abierto ${t}`; }
    const p = expand(t);
    if (fs.existsSync(p) && !a.args) { const e = await shell.openPath(p); if (e) throw new Error(e); return `Abierto ${p}`; }
    if (isWin) {
      const cmd = `$n=${JSON.stringify(t)}; $a=${JSON.stringify(a.args || '')}; try { if ($a) { Start-Process -FilePath $n -ArgumentList $a } else { Start-Process -FilePath $n } ; 'ok' } catch { $app = Get-StartApps | Where-Object { $_.Name -like "*$n*" } | Select-Object -First 1; if ($app) { Start-Process ("shell:AppsFolder\\" + $app.AppID); 'ok:' + $app.Name } else { throw "No se encontró la aplicación '$n'" } }`;
      const r = await execCommand(cmd, { timeout: 30 });
      if (r.code !== 0 || /No se encontró/.test(r.err)) throw new Error(r.err.trim().split('\n')[0] || 'No se pudo abrir');
      return `Abierto ${t}${r.out.includes('ok:') ? ` (${r.out.split('ok:')[1].trim()})` : ''}`;
    }
    const r = await execCommand(isMac ? `open -a ${JSON.stringify(t)} ${a.args || ''}` : `nohup ${t} ${a.args || ''} >/dev/null 2>&1 &`, { timeout: 15 });
    if (r.code) throw new Error(r.err || 'No se pudo abrir');
    return `Abierto ${t}`;
  });
  add('system', 'read', 'system_info', 'Información del equipo: sistema operativo, usuario, carpetas, pantalla, discos, fecha/hora, CPU, RAM y GPU.', {}, [], async () => {
    const d = screen.getPrimaryDisplay();
    let disks = '';
    if (isWin) { const r = await execCommand("Get-PSDrive -PSProvider FileSystem | ForEach-Object { '{0}: libre {1:N1} GB de {2:N1} GB' -f $_.Name, ($_.Free/1GB), (($_.Used+$_.Free)/1GB) }", { timeout: 15 }); disks = r.out.trim(); }
    else { const r = await execCommand('df -h / /home 2>/dev/null | tail -n +2', { timeout: 10 }); disks = r.out.trim(); }
    const hw = ctx.hardware ? await ctx.hardware() : null;
    return [
      `Sistema: ${os.type()} ${os.release()} (${process.arch}) · Equipo: ${os.hostname()} · Usuario: ${os.userInfo().username}`,
      `Fecha y hora: ${new Date().toLocaleString('es-ES')} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`,
      `Carpeta personal: ${os.homedir()} · Escritorio: ${app.getPath('desktop')} · Descargas: ${app.getPath('downloads')} · Documentos: ${app.getPath('documents')}`,
      `Directorio de trabajo de Nexo: ${cwdDefault()}`,
      `Pantalla principal: ${Math.round(d.size.width * d.scaleFactor)}x${Math.round(d.size.height * d.scaleFactor)} (escala ${d.scaleFactor * 100}%) · Pantallas: ${screen.getAllDisplays().length}`,
      hw ? `CPU: ${hw.cpu.name} (${hw.cpu.physical} núcleos) · RAM: ${(hw.ram.total / 2 ** 30).toFixed(0)} GB (libre ${(os.freemem() / 2 ** 30).toFixed(1)} GB) · GPU: ${hw.gpus.map((g) => `${g.name} ${(g.vram / 2 ** 30).toFixed(0)}GB`).join(', ') || 'ninguna'}` : '',
      `Discos:\n${disks}`
    ].filter(Boolean).join('\n');
  });
  add('system', 'read', 'list_processes', 'Lista procesos en ejecución (filtro opcional por nombre), con PID, memoria y CPU.', { filter: { type: 'string' } }, [], async (a) => {
    const f = a.filter ? String(a.filter).replace(/["'`$]/g, '') : '';
    const cmd = isWin
      ? `Get-Process ${f ? `-Name "*${f}*" -ErrorAction SilentlyContinue` : ''} | Sort-Object WorkingSet64 -Descending | Select-Object -First 60 | ForEach-Object { '{0,-8} {1,-32} {2,8:N0} MB  {3}' -f $_.Id, $_.ProcessName, ($_.WorkingSet64/1MB), $_.MainWindowTitle }`
      : `ps aux --sort=-%mem | ${f ? `grep -i ${JSON.stringify(f)} | ` : ''}head -60`;
    const r = await execCommand(cmd, { timeout: 20 });
    return r.out.trim() || 'Sin procesos coincidentes';
  });
  add('system', 'exec', 'kill_process', 'Termina un proceso por PID o nombre.', { pid: { type: 'integer' }, name: { type: 'string' } }, [], async (a) => {
    if (!a.pid && !a.name) throw new Error('Indica pid o name');
    const cmd = isWin ? (a.pid ? `Stop-Process -Id ${Number(a.pid)} -Force` : `Stop-Process -Name ${JSON.stringify(String(a.name).replace(/\.exe$/i, ''))} -Force`) : (a.pid ? `kill -9 ${Number(a.pid)}` : `pkill -f ${JSON.stringify(a.name)}`);
    const r = await execCommand(cmd, { timeout: 15 });
    if (r.code) throw new Error(r.err || 'No se pudo terminar');
    return 'Proceso terminado';
  });
  add('system', 'read', 'process_output', 'Lee la salida (últimas líneas) de un proceso lanzado con run_command background=true. Sin pid, lista los procesos en segundo plano.', {
    pid: { type: 'integer' }, lines: { type: 'integer', description: 'Últimas N líneas (por defecto 80)' }
  }, [], async (a) => {
    if (!a.pid) return bgProcs.size ? [...bgProcs.entries()].map(([pid, p]) => `PID ${pid} · ${p.running === false ? 'terminado' : 'en marcha'} · ${p.command}`).join('\n') : 'No hay procesos en segundo plano lanzados en esta sesión';
    const p = bgProcs.get(Number(a.pid));
    if (!p) throw new Error('No hay un proceso en segundo plano con ese PID (usa process_output sin pid para verlos)');
    let txt = '';
    try { txt = await fsp.readFile(p.log, 'utf8'); } catch { }
    const lines = txt.split(/\r?\n/);
    return `${p.running === false ? `Terminado (código ${p.code})` : 'En ejecución'} · ${p.command}\n\n${lines.slice(-Math.min(1000, a.lines || 80)).join('\n') || '(sin salida todavía)'}`;
  });
  add('system', 'read', 'clipboard_read', 'Lee el texto del portapapeles (o la imagen, si hay).', {}, [], async () => {
    const img = clipboard.readImage();
    if (!img.isEmpty()) return { text: 'Imagen del portapapeles', images: [{ data: img.toJPEG(85).toString('base64'), mime: 'image/jpeg' }] };
    return clipboard.readText() || '(portapapeles vacío)';
  });
  add('system', 'write', 'clipboard_write', 'Copia texto al portapapeles.', { text: { type: 'string' } }, ['text'], async (a) => { clipboard.writeText(a.text); return 'Copiado al portapapeles'; });
  add('system', 'read', 'notify', 'Muestra una notificación del sistema al usuario.', { title: { type: 'string' }, body: { type: 'string' } }, ['title'], async (a) => { new Notification({ title: a.title, body: a.body || '' }).show(); return 'Notificación mostrada'; });

  // ─── Control del ordenador ───
  add('computer', 'computer', 'computer', 'Controla el ordenador. Acciones: screenshot (ver pantalla), zoom (x,y → x2,y2: amplía esa zona de la última captura a resolución real para leer textos pequeños), click, double_click, triple_click, right_click, middle_click, move (x,y), drag (x,y → x2,y2), type (text), key (keys, p. ej. "ctrl+c", "enter", "win+r", "alt+tab"), scroll (direction up/down/left/right, amount, x,y opcionales), wait (seconds), cursor_position. Las coordenadas son píxeles de la ÚLTIMA captura. Tras acciones visuales se devuelve una nueva captura automáticamente.', {
    action: { type: 'string', enum: ['screenshot', 'zoom', 'click', 'double_click', 'triple_click', 'right_click', 'middle_click', 'move', 'drag', 'type', 'key', 'scroll', 'wait', 'cursor_position'] },
    x: { type: 'number' }, y: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' }, text: { type: 'string' }, keys: { type: 'string' },
    direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] }, amount: { type: 'integer' }, seconds: { type: 'number' }
  }, ['action'], async (a, c) => {
    const cfg = ctx.settings().computer || {};
    c.onComputerUse?.();
    if (a.action === 'screenshot') {
      await new Promise((r) => setTimeout(r, 250));
      const s = await computer.screenshot({ maxWidth: cfg.maxScreenshotWidth || 1366 });
      return { text: `Captura ${s.width}x${s.height} (pantalla real ${s.screenW}x${s.screenH}). Usa coordenadas de esta imagen.`, images: [{ data: s.data, mime: s.mime }] };
    }
    if (a.action === 'zoom') {
      const z = await computer.zoom({ x: a.x, y: a.y, x2: a.x2, y2: a.y2 });
      return { text: `Zoom de la zona (${Math.round(a.x)},${Math.round(a.y)})–(${Math.round(a.x2)},${Math.round(a.y2)}) a ${z.width}x${z.height}. Para hacer clic usa las coordenadas de la última captura completa, no las de este zoom.`, images: [{ data: z.data, mime: z.mime }] };
    }
    const msg = await computer.perform(a.action, a);
    if (cfg.screenshotAfterAction !== false && !['wait', 'cursor_position'].includes(a.action)) {
      await new Promise((r) => setTimeout(r, a.action === 'type' || a.action === 'key' ? 600 : 800));
      const s = await computer.screenshot({ maxWidth: cfg.maxScreenshotWidth || 1366 });
      return { text: `${msg}. Nueva captura ${s.width}x${s.height}:`, images: [{ data: s.data, mime: s.mime }] };
    }
    return msg;
  });

  // ─── Web ───
  add('web', 'read', 'web_search', 'Busca en internet y devuelve títulos, enlaces y fragmentos. Luego usa fetch_url para leer las páginas relevantes.', {
    query: { type: 'string' }, max_results: { type: 'integer' }
  }, ['query'], async (a) => {
    const s = ctx.settings().web || {};
    const r = await webSearch(a.query, { max: Math.min(15, a.max_results || 8), engine: s.searchEngine || 'auto', keys: ctx.webKeys?.() || {}, searxngUrl: s.searxngUrl });
    if (!r.length) return 'Sin resultados (prueba otra formulación)';
    return r.map((x, i) => `${i + 1}. ${x.title}\n   ${x.url}\n   ${x.snippet}`).join('\n\n');
  });
  add('web', 'read', 'fetch_url', 'Descarga una página web y devuelve su texto legible (renderiza JavaScript si hace falta).', {
    url: { type: 'string' }, max_chars: { type: 'integer' }
  }, ['url'], async (a) => {
    const r = await fetchUrl(a.url, { maxChars: Math.min(60000, a.max_chars || 20000) });
    return `# ${r.title || r.url}\nURL: ${r.url}\n\n${r.text}`;
  });

  // ─── Navegador ───
  add('browser', 'browser', 'browser', 'Controla el navegador de Nexo (visible para el usuario, con sesión persistente; según Ajustes es el panel integrado o una ventana de Chrome real). Acciones: navigate (url o búsqueda), read (texto de la página + elementos interactivos numerados [n]; offset para seguir leyendo páginas largas), find (text: localiza texto y elementos que lo contienen), click (index), hover (index), type (index, text, submit), fill (fields: [{index, value}] rellena varios campos de un formulario de una vez; checkboxes con value "true"/"false"), select (index, value: elige una opción de un desplegable), press (key: Enter/Tab/Escape/ArrowDown...), scroll (direction, amount), wait (seconds, o text para esperar a que aparezca), back, forward, screenshot (ver la página), console (mensajes y errores de la consola JS), evaluate (script JS). Tras navigate/click usa read para ver el resultado.', {
    action: { type: 'string', enum: ['navigate', 'read', 'find', 'click', 'hover', 'type', 'fill', 'select', 'press', 'scroll', 'wait', 'back', 'forward', 'screenshot', 'console', 'evaluate'] },
    url: { type: 'string' }, index: { type: 'integer' }, text: { type: 'string' }, submit: { type: 'boolean' }, key: { type: 'string' }, direction: { type: 'string', enum: ['up', 'down'] }, amount: { type: 'number' }, script: { type: 'string' },
    value: { type: 'string' }, fields: { type: 'array', items: { type: 'object', properties: { index: { type: 'integer' }, value: { type: 'string' } }, required: ['index', 'value'] } }, offset: { type: 'integer', description: 'Carácter desde el que seguir leyendo (read)' }, seconds: { type: 'number' }
  }, ['action'], async (a) => {
    const summary = (s) => `Página: ${s.title || '(sin título)'}\nURL: ${s.url}`;
    switch (a.action) {
      case 'navigate': { const s = await browser.navigate(a.url || a.text); const r = await browser.read({ maxChars: 6000 }); return `${summary(s)}\n\n## Contenido\n${r.text}\n\n## Elementos interactivos\n${r.elements}`; }
      case 'read': { const r = await browser.read({ maxChars: 14000, offset: a.offset || 0 }); return `Página: ${r.title}\nURL: ${r.url}\nScroll: ${r.scrollY}/${r.scrollHeight}px${r.more ? `\nTexto mostrado: caracteres ${r.from}-${r.to} de ${r.total} (continúa con offset=${r.to})` : ''}\n\n## Contenido\n${r.text}\n\n## Elementos interactivos\n${r.elements}`; }
      case 'find': return await browser.find(a.text || a.value || '');
      case 'hover': { await browser.hover(a.index); return `Ratón sobre [${a.index}]`; }
      case 'fill': return await browser.fill(a.fields || []);
      case 'select': return await browser.select(a.index, a.value ?? a.text ?? '');
      case 'wait': return await browser.wait({ seconds: a.seconds, text: a.text });
      case 'console': return browser.consoleLog();
      case 'click': { const s = await browser.click(a.index); const r = await browser.read({ maxChars: 5000 }); return `Clic en [${a.index}]. ${summary(s)}\n\n## Contenido\n${r.text}\n\n## Elementos interactivos\n${r.elements}`; }
      case 'type': { const s = await browser.type(a.index, a.text || '', a.submit); if (a.submit) { const r = await browser.read({ maxChars: 5000 }); return `Escrito y enviado. ${summary(s)}\n\n## Contenido\n${r.text}\n\n## Elementos interactivos\n${r.elements}`; } return `Texto escrito en [${a.index}]`; }
      case 'press': { const s = await browser.press(a.key || 'Enter'); return `Tecla ${a.key || 'Enter'} pulsada. ${summary(s)}`; }
      case 'scroll': { await browser.scroll(a.direction || 'down', a.amount || 1); const r = await browser.read({ maxChars: 6000 }); return `Desplazado. Scroll ${r.scrollY}/${r.scrollHeight}\n\n${r.text}\n\n## Elementos\n${r.elements}`; }
      case 'back': return summary(await browser.back());
      case 'forward': return summary(await browser.forward());
      case 'screenshot': { const img = await browser.screenshot(); return { text: 'Captura del navegador', images: [img] }; }
      case 'evaluate': return truncate(await browser.evaluate(a.script || ''), 20000);
      default: throw new Error('Acción desconocida');
    }
  });

  // ─── Memoria ───
  add('memory', 'read', 'memory_save', 'Guarda un dato duradero sobre el usuario (preferencias, nombre, proyectos, etc.) para recordarlo en futuros chats. No guardes datos temporales ni secretos.', { fact: { type: 'string' } }, ['fact'], async (a) => { addMemory(a.fact); return 'Recordado: ' + a.fact; });
  add('memory', 'read', 'memory_forget', 'Olvida un recuerdo por su texto (coincidencia parcial).', { text: { type: 'string' } }, ['text'], async (a) => {
    const m = listMemory().items.filter((x) => x.text.toLowerCase().includes(String(a.text).toLowerCase()));
    m.forEach((x) => deleteMemory(x.id));
    return m.length ? `Olvidados ${m.length} recuerdos` : 'No se encontró ese recuerdo';
  });

  // ─── Skills ───
  add('skills', 'read', 'use_skill', 'Carga las instrucciones completas de una skill por su id. Hazlo antes de realizar una tarea que encaje con la skill.', { name: { type: 'string' } }, ['name'], async (a) => {
    const s = getSkill(a.name);
    if (!s) return `Skill no encontrada. Disponibles: ${listSkills().filter((x) => x.enabled).map((x) => x.id).join(', ')}`;
    return `# Skill: ${s.name}\nCarpeta: ${s.path}\nArchivos de apoyo: ${s.files.join(', ') || 'ninguno'} (léelos con read_file si los necesitas)\n\n${s.content}`;
  });

  // ─── Plan (siempre disponible) ───
  add('core', 'read', 'update_plan', 'Muestra/actualiza la lista de pasos de la tarea actual para que el usuario vea el progreso. Úsalo en tareas de 3+ pasos.', {
    items: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, status: { type: 'string', enum: ['pending', 'in_progress', 'done'] } }, required: ['text', 'status'] } }
  }, ['items'], async (a, c) => { c.emitPlan?.(a.items || []); return 'Plan actualizado'; });

  // ─── Preguntar al usuario ───
  if (ctx.askUser) {
    add('core', 'read', 'ask_user', 'Hace una pregunta al usuario y espera su respuesta. Úsala cuando haya una decisión que solo él puede tomar o la petición sea ambigua (no para pedir permiso de herramientas). Ofrece 2-4 opciones concretas si puedes; el usuario también puede escribir otra respuesta.', {
      question: { type: 'string' }, options: { type: 'array', items: { type: 'string' }, description: 'Opciones sugeridas (2-4)' }
    }, ['question'], async (a, c) => {
      const answer = await ctx.askUser({ question: a.question, options: (a.options || []).slice(0, 6) }, c.signal);
      return answer ? `El usuario respondió: ${answer}` : 'El usuario no respondió (pregunta cancelada). Continúa con la opción más razonable y explícalo.';
    });
  }

  // ─── Equipo de agentes ───
  if (ctx.delegate) {
    const agentsList = ctx.agents?.() || [];
    add('agents', 'read', 'delegate_task', `Delega una subtarea autocontenida en otro agente especializado, que trabajará con sus propias herramientas y (opcionalmente) otro modelo, y devolverá su resultado. Agentes: ${agentsList.map((x) => `${x.id} (${x.name}: ${x.description})`).join('; ')}. Puedes llamar a varios en paralelo.`, {
      agent: { type: 'string', description: 'id del agente' }, task: { type: 'string', description: 'Instrucciones completas y contexto necesario' }, model: { type: 'string', description: 'Opcional: referencia de modelo (p. ej. "local:..." o "openai:gpt-5")' }
    }, ['agent', 'task'], async (a, c) => ctx.delegate(a, c));
  }
  return T;
}

// ───────── Permisos ─────────
export function needsApproval(tool, mode, allowAlways = {}) {
  if (mode === 'full') return false;
  if (allowAlways[tool.name]) return false;
  if (tool.risk === 'read') return false;
  if (mode === 'smart') return tool.risk === 'exec';
  return true; // 'ask': todo lo que no sea lectura
}

// Herramientas MCP "bajo demanda": si son muchas, el modelo solo ve sus nombres y carga
// los esquemas con tool_search cuando las necesita (como Claude Code). Ahorra decenas de miles de tokens.
const DEFER_CHARS = 12000;

export function allTools(ctx, groups, mcpServers) {
  const list = builtinTools(ctx).filter((t) => t.group === 'core' || groups.includes(t.group));
  if (!groups.includes('mcp')) return list;
  const mcpTools = mcp.tools(mcpServers === 'all' || !mcpServers ? undefined : mcpServers);
  const size = JSON.stringify(mcpTools.map((t) => [t.name, t.description, t.parameters])).length;
  const pref = ctx.settings?.().mcpDeferred ?? 'auto';
  if (!mcpTools.length || pref === false || (pref === 'auto' && size < DEFER_CHARS)) { list.push(...mcpTools); return list; }
  const loaded = new Set();
  const byServer = {};
  for (const t of mcpTools) (byServer[t.server] ||= []).push(t.name.split('__').pop());
  const catalog = Object.entries(byServer).map(([srv, names]) => `${srv}: ${names.join(', ')}`).join('\n');
  list.push({
    group: 'core', risk: 'read', name: 'tool_search',
    description: `Carga herramientas MCP para poder usarlas. Hay ${mcpTools.length} disponibles sin cargar (así se ahorra contexto). Pasa query="select:nombre1,nombre2" con nombres exactos, o palabras clave para buscar. Una vez cargadas, llámalas con su nombre completo mcp__servidor__herramienta.\nDisponibles por servidor:\n${catalog}`.slice(0, 6000),
    parameters: { type: 'object', properties: { query: { type: 'string' }, max_results: { type: 'integer' } }, required: ['query'] },
    run: async (a) => {
      const q = String(a.query || '').trim();
      let found;
      if (q.startsWith('select:')) {
        const want = q.slice(7).split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
        found = mcpTools.filter((t) => want.some((w) => t.name.toLowerCase() === w || t.name.toLowerCase().endsWith('__' + w)));
      } else {
        const words = q.toLowerCase().split(/\s+/).filter(Boolean);
        found = mcpTools.map((t) => { const h = (t.name + ' ' + t.description).toLowerCase(); return [t, words.reduce((n, w) => n + (h.includes(w) ? (t.name.toLowerCase().includes(w) ? 3 : 1) : 0), 0)]; })
          .filter((x) => x[1] > 0).sort((x, y) => y[1] - x[1]).slice(0, Math.min(15, a.max_results || 6)).map((x) => x[0]);
      }
      if (!found.length) return 'Ninguna herramienta coincide. Revisa la lista de la descripción de tool_search.';
      for (const t of found) if (!loaded.has(t.name)) { loaded.add(t.name); list.push(t); }
      return `Cargadas ${found.length} herramientas (ya puedes llamarlas):\n${found.map((t) => `- ${t.name}: ${t.description.slice(0, 200)}`).join('\n')}`;
    }
  });
  return list;
}
