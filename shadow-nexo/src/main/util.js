import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';

export const isWin = process.platform === 'win32';
export const isMac = process.platform === 'darwin';
export const isLinux = process.platform === 'linux';

export function uid(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function run(cmd, args = [], opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: opts.timeout || 20000, ...opts }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err?.code ?? 0, stdout: String(stdout || ''), stderr: String(stderr || ''), error: err });
    });
  });
}

export async function powershell(script, timeout = 30000) {
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
    `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ${script}`], { timeout });
  return r;
}

export async function psJSON(script, timeout) {
  const r = await powershell(`${script} | ConvertTo-Json -Depth 5 -Compress`, timeout);
  try { const j = JSON.parse(r.stdout.trim() || 'null'); return Array.isArray(j) ? j : (j ? [j] : []); } catch { return []; }
}

export function findFile(root, predicate, depth = 6) {
  const stack = [[root, 0]];
  while (stack.length) {
    const [d, lv] = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isFile() && predicate(e.name, p)) return p;
      if (e.isDirectory() && lv < depth) stack.push([p, lv + 1]);
    }
  }
  return null;
}

export function freePort(start = 39200) {
  return new Promise((resolve) => {
    const tryPort = (p) => {
      const srv = net.createServer();
      srv.once('error', () => tryPort(p + 1));
      srv.once('listening', () => srv.close(() => resolve(p)));
      srv.listen(p, '127.0.0.1');
    };
    tryPort(start);
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function truncate(s, max = 20000) {
  if (typeof s !== 'string') s = String(s ?? '');
  if (s.length <= max) return s;
  const half = Math.floor(max / 2);
  return s.slice(0, half) + `\n\n[... ${s.length - max} caracteres omitidos ...]\n\n` + s.slice(-half);
}

export function which(cmd) {
  const exts = isWin ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const d of (process.env.PATH || '').split(path.delimiter)) {
    for (const ext of exts) {
      const p = path.join(d, cmd + ext);
      try { if (fs.statSync(p).isFile()) return p; } catch { }
    }
  }
  return null;
}

export function spawnLogged(cmd, args, opts = {}) {
  return spawn(cmd, args, { windowsHide: true, ...opts });
}

export function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch { } }

export function dirSize(p) {
  let total = 0;
  const stack = [p];
  while (stack.length) {
    const d = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) stack.push(f); else { try { total += fs.statSync(f).size; } catch { } }
    }
  }
  return total;
}
