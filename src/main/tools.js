// Herramientas integradas que los modelos pueden usar + sistema de permisos.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { shell, clipboard, Notification, screen } from 'electron';
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

function execCommand(command, { cwd, timeout = 120, signal }) {
  return new Promise((resolve) => {
    const [bin, args] = shellCmd(command);
    const child = spawn(bin, args, { cwd, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
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

function fmtSize(n) { return n > 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : n > 1e3 ? (n / 1e3).toFixed(0) + ' KB' : n + ' B'; }

/** Construye la lista de herramientas integradas. ctx: { settings, workspace, delegate, emitPlan, agents } */
export function builtinTools(ctx) {
  const cwdDefault = () => ctx.workspace || os.homedir();
  const T = [];
  const add = (group, risk, name, description, properties, required, runFn) => T.push({ group, risk, name, description, parameters: { type: 'object', properties, required }, run: runFn });

  // ─── Archivos ───
  add('files', 'read', 'read_file', 'Lee un archivo de texto (con números de línea) o una imagen (la verás). Usa offset/limit para archivos grandes.', {
    path: { type: 'string', description: 'Ruta absoluta o relativa al directorio de trabajo' }, offset: { type: 'integer', description: 'Línea inicial (1 = primera)' }, limit: { type: 'integer', description: 'Máximo de líneas (por defecto 400)' }
  }, ['path'], async (a) => {
    const p = expand(a.path, cwdDefault());
    const st = await fsp.stat(p);
    if (st.isDirectory()) throw new Error('Es una carpeta; usa list_directory');
    const ext = path.extname(p).toLowerCase();
    if (IMG_EXT[ext]) { const data = (await fsp.readFile(p)).toString('base64'); return { text: `Imagen ${path.basename(p)} (${fmtSize(st.size)})`, images: [{ data, mime: IMG_EXT[ext] }] }; }
    if (st.size > 20e6) throw new Error('Archivo demasiado grande para leerlo entero (' + fmtSize(st.size) + '). Usa run_command para procesarlo.');
    const buf = await fsp.readFile(p);
    if (buf.subarray(0, 8000).includes(0)) return `Archivo binario (${fmtSize(st.size)}). No se puede mostrar como texto.`;
    const lines = buf.toString('utf8').split('\n');
    const off = Math.max(1, a.offset || 1), lim = Math.min(2000, a.limit || 400);
    const slice = lines.slice(off - 1, off - 1 + lim).map((l, i) => `${String(off + i).padStart(5)}| ${l.length > 2000 ? l.slice(0, 2000) + '…' : l}`).join('\n');
    const more = lines.length > off - 1 + lim ? `\n\n[${lines.length} líneas en total; continúa con offset=${off + lim}]` : '';
    return slice + more;
  });
  add('files', 'write', 'write_file', 'Crea o sobrescribe un archivo con el contenido indicado (crea carpetas si hace falta). Usa append=true para añadir al final.', {
    path: { type: 'string' }, content: { type: 'string' }, append: { type: 'boolean' }
  }, ['path', 'content'], async (a) => {
    const p = expand(a.path, cwdDefault());
    await fsp.mkdir(path.dirname(p), { recursive: true });
    if (a.append) await fsp.appendFile(p, a.content); else await fsp.writeFile(p, a.content);
    return `Archivo ${a.append ? 'actualizado' : 'guardado'}: ${p} (${fmtSize(Buffer.byteLength(a.content))})`;
  });
  add('files', 'write', 'edit_file', 'Edita un archivo reemplazando un fragmento exacto de texto por otro. old_text debe ser único salvo que replace_all=true.', {
    path: { type: 'string' }, old_text: { type: 'string' }, new_text: { type: 'string' }, replace_all: { type: 'boolean' }
  }, ['path', 'old_text', 'new_text'], async (a) => {
    const p = expand(a.path, cwdDefault());
    const txt = await fsp.readFile(p, 'utf8');
    const count = txt.split(a.old_text).length - 1;
    if (!count) throw new Error('old_text no se encontró en el archivo (revisa espacios y saltos de línea exactos)');
    if (count > 1 && !a.replace_all) throw new Error(`old_text aparece ${count} veces; añade más contexto o usa replace_all`);
    await fsp.writeFile(p, a.replace_all ? txt.split(a.old_text).join(a.new_text) : txt.replace(a.old_text, () => a.new_text));
    return `Editado ${p} (${a.replace_all ? count : 1} reemplazo/s)`;
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
  }, ['from', 'to'], async (a) => {
    const f = expand(a.from, cwdDefault()), t = expand(a.to, cwdDefault());
    await fsp.mkdir(path.dirname(t), { recursive: true });
    if (a.copy) await fsp.cp(f, t, { recursive: true }); else await fsp.rename(f, t).catch(async () => { await fsp.cp(f, t, { recursive: true }); await fsp.rm(f, { recursive: true, force: true }); });
    return `${a.copy ? 'Copiado' : 'Movido'}: ${f} → ${t}`;
  });
  add('files', 'exec', 'delete_path', 'Elimina un archivo o carpeta (a la papelera por defecto).', {
    path: { type: 'string' }, permanent: { type: 'boolean', description: 'true = borrar definitivamente sin papelera' }
  }, ['path'], async (a) => {
    const p = expand(a.path, cwdDefault());
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
      bgProcs.set(child.pid, { command: a.command, log });
      child.unref();
      return `Proceso en segundo plano iniciado (PID ${child.pid}). Registro: ${log}`;
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
      `Carpeta personal: ${os.homedir()} · Escritorio: ${path.join(os.homedir(), 'Desktop')} · Descargas: ${path.join(os.homedir(), 'Downloads')} · Documentos: ${path.join(os.homedir(), 'Documents')}`,
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
  add('system', 'read', 'clipboard_read', 'Lee el texto del portapapeles (o la imagen, si hay).', {}, [], async () => {
    const img = clipboard.readImage();
    if (!img.isEmpty()) return { text: 'Imagen del portapapeles', images: [{ data: img.toJPEG(85).toString('base64'), mime: 'image/jpeg' }] };
    return clipboard.readText() || '(portapapeles vacío)';
  });
  add('system', 'write', 'clipboard_write', 'Copia texto al portapapeles.', { text: { type: 'string' } }, ['text'], async (a) => { clipboard.writeText(a.text); return 'Copiado al portapapeles'; });
  add('system', 'read', 'notify', 'Muestra una notificación del sistema al usuario.', { title: { type: 'string' }, body: { type: 'string' } }, ['title'], async (a) => { new Notification({ title: a.title, body: a.body || '' }).show(); return 'Notificación mostrada'; });

  // ─── Control del ordenador ───
  add('computer', 'computer', 'computer', 'Controla el ordenador. Acciones: screenshot (ver pantalla), click, double_click, triple_click, right_click, middle_click, move (x,y), drag (x,y → x2,y2), type (text), key (keys, p. ej. "ctrl+c", "enter", "win+r", "alt+tab"), scroll (direction up/down/left/right, amount, x,y opcionales), wait (seconds), cursor_position. Las coordenadas son píxeles de la ÚLTIMA captura. Tras acciones visuales se devuelve una nueva captura automáticamente.', {
    action: { type: 'string', enum: ['screenshot', 'click', 'double_click', 'triple_click', 'right_click', 'middle_click', 'move', 'drag', 'type', 'key', 'scroll', 'wait', 'cursor_position'] },
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
  add('browser', 'browser', 'browser', 'Controla el navegador integrado de Nexo (visible para el usuario, con sesión persistente). Acciones: navigate (url o búsqueda), read (texto de la página + lista de elementos interactivos numerados [n]), click (index), type (index, text, submit), press (key: Enter/Tab/Escape/ArrowDown...), scroll (direction, amount), back, forward, screenshot (ver la página), evaluate (script JS). Tras navigate/click usa read para ver el resultado.', {
    action: { type: 'string', enum: ['navigate', 'read', 'click', 'type', 'press', 'scroll', 'back', 'forward', 'screenshot', 'evaluate'] },
    url: { type: 'string' }, index: { type: 'integer' }, text: { type: 'string' }, submit: { type: 'boolean' }, key: { type: 'string' }, direction: { type: 'string', enum: ['up', 'down'] }, amount: { type: 'number' }, script: { type: 'string' }
  }, ['action'], async (a) => {
    const summary = (s) => `Página: ${s.title || '(sin título)'}\nURL: ${s.url}`;
    switch (a.action) {
      case 'navigate': { const s = await browser.navigate(a.url || a.text); const r = await browser.read({ maxChars: 6000 }); return `${summary(s)}\n\n## Contenido\n${r.text}\n\n## Elementos interactivos\n${r.elements}`; }
      case 'read': { const r = await browser.read({ maxChars: 14000 }); return `Página: ${r.title}\nURL: ${r.url}\nScroll: ${r.scrollY}/${r.scrollHeight}px\n\n## Contenido\n${r.text}\n\n## Elementos interactivos\n${r.elements}`; }
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

export function allTools(ctx, groups, mcpServers) {
  const list = builtinTools(ctx).filter((t) => t.group === 'core' || groups.includes(t.group));
  if (groups.includes('mcp')) list.push(...mcp.tools(mcpServers === 'all' || !mcpServers ? undefined : mcpServers));
  return list;
}
