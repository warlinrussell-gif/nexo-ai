// Qualcomm / EDL: detección de equipos en modo 9008, herramientas del banco y ejecución de edl.py.
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { isWin, run, psJSON, which, uid } from './util.js';
import { dir, resourcesDir } from './paths.js';

const VID = '05C6';
const EDL_PIDS = ['9008', '900E', '9006', '9091', '901D', 'F000'];

export class Qualcomm extends EventEmitter {
  constructor() {
    super();
    this.jobs = new Map();
    this.toolDir = null;
  }

  /** Carpeta de trabajo del banco: NexoData/qualcomm (se crea al vuelo). */
  workDir() {
    const d = dir('qualcomm');
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  backupsDir() {
    const d = path.join(this.workDir(), 'backups');
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  /** Localiza edl.py: primero en la carpeta de trabajo, luego en el workspace del usuario. */
  findEdl() {
    const candidates = [
      path.join(this.workDir(), 'edl_tool', 'edl.py'),
      path.join(dir('workspace'), 'edl_tool', 'edl.py')
    ];
    for (const c of candidates) if (fs.existsSync(c)) return c;
    return null;
  }

  findPython() {
    for (const c of ['python', 'python3', 'py']) {
      const p = which(c);
      if (p) return p;
    }
    return null;
  }

  tools() {
    const edl = this.findEdl();
    const python = this.findPython();
    const adb = which('adb');
    const fastboot = which('fastboot');
    const loaders = edl ? path.join(path.dirname(edl), 'Loaders') : null;
    return {
      edl, python, adb, fastboot,
      edlDir: edl ? path.dirname(edl) : null,
      loaders,
      loaderCount: loaders && fs.existsSync(loaders) ? fs.readdirSync(loaders).filter((f) => /\.(bin|elf|mbn)$/i.test(f)).length : 0,
      ready: !!(edl && python)
    };
  }

  /** Equipos Qualcomm conectados, con su estado en el Administrador de dispositivos. */
  async devices() {
    if (!isWin) {
      const r = await run('lsusb', []);
      return r.stdout.split(/\r?\n/).filter((l) => l.toLowerCase().includes(VID.toLowerCase())).map((l) => {
        const m = /ID\s+([0-9a-f]{4}):([0-9a-f]{4})\s*(.*)/i.exec(l);
        return { vid: m?.[1], pid: m?.[2]?.toUpperCase(), name: m?.[3]?.trim() || 'Qualcomm', status: 'OK', port: null, edl: EDL_PIDS.includes(m?.[2]?.toUpperCase()) };
      });
    }
    const rows = await psJSON(`Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -like "*VID_${VID}*" } | Select-Object Status, Class, FriendlyName, InstanceId`);
    return rows.filter(Boolean).map((d) => {
      const pid = (new RegExp(`PID_([0-9A-Fa-f]{4})`, 'i').exec(d.InstanceId || '') || [])[1]?.toUpperCase() || '';
      const port = (/\(COM(\d+)\)/i.exec(d.FriendlyName || '') || [])[1] || null;
      return {
        pid, port: port ? `COM${port}` : null,
        name: (d.FriendlyName || 'Dispositivo Qualcomm').trim(),
        status: d.Status || 'Unknown',
        class: d.Class || '',
        edl: EDL_PIDS.includes(pid),
        driverOk: d.Status === 'OK' && !/QHUSB_BULK/i.test(d.FriendlyName || '')
      };
    });
  }

  /** Estado de adb/fastboot: sirve para entrar en EDL desde un equipo que aún arranca. */
  async androidState() {
    const out = { adb: [], fastboot: [] };
    const t = this.tools();
    if (t.adb) {
      const r = await run(t.adb, ['devices'], { timeout: 8000 });
      out.adb = r.stdout.split(/\r?\n/).slice(1).filter((l) => l.trim() && !/offline/i.test(l)).map((l) => l.split(/\s+/)[0]);
    }
    if (t.fastboot) {
      const r = await run(t.fastboot, ['devices'], { timeout: 8000 });
      out.fastboot = r.stdout.split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split(/\s+/)[0]);
    }
    return out;
  }

  async status() {
    const [devices, android] = await Promise.all([this.devices(), this.androidState()]);
    return { tools: this.tools(), devices, android, workDir: this.workDir(), backups: this.backupsDir() };
  }

  /** Ejecuta un comando de edl.py y va emitiendo la salida línea a línea. */
  runEdl(args, opts = {}) {
    const t = this.tools();
    if (!t.edl) throw new Error('No se encontró edl.py. Copia la carpeta edl_tool en NexoData/qualcomm o en el workspace.');
    if (!t.python) throw new Error('No se encontró Python en el PATH.');
    const id = uid('qc');
    const full = [t.edl, ...args];
    if (opts.loader) full.push('--loader', opts.loader);
    if (opts.port) full.push('--portname', opts.port);
    if (opts.debug) full.push('--debugmode');
    const child = spawn(t.python, full, { cwd: t.edlDir, windowsHide: true });
    const job = { id, cmd: `edl.py ${args.join(' ')}`, startedAt: Date.now(), child, lines: [], code: null };
    this.jobs.set(id, job);
    const push = (stream, chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (!line.trim()) continue;
        job.lines.push({ stream, line });
        if (job.lines.length > 4000) job.lines.shift();
        this.emit('log', { id, stream, line });
      }
    };
    child.stdout.on('data', (c) => push('out', c));
    child.stderr.on('data', (c) => push('err', c));
    child.on('close', (code) => {
      job.code = code;
      this.emit('done', { id, code, cmd: job.cmd });
      setTimeout(() => this.jobs.delete(id), 60000);
    });
    child.on('error', (e) => {
      job.code = -1;
      this.emit('log', { id, stream: 'err', line: e.message });
      this.emit('done', { id, code: -1, cmd: job.cmd });
    });
    return { id, cmd: job.cmd };
  }

  stop(id) {
    const job = this.jobs.get(id);
    if (!job) return false;
    try { job.child.kill(); } catch { }
    return true;
  }

  /** Lee la tabla GPT del equipo conectado (sin escribir nada). */
  async gpt(port) {
    const t = this.tools();
    if (!t.edl) throw new Error('Falta edl.py');
    const r = await run(t.python, [t.edl, 'printgpt', ...(port ? ['--portname', port] : [])], { cwd: t.edlDir, timeout: 120000 });
    const text = r.stdout + r.stderr;
    const parts = [];
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*(?:GPT|Partition)\s*[:#]?\s*(\S+)/i.exec(line) || /^\s*(\d+)\s+(\S+)\s+(\S+)\s+(\S+)/.exec(line);
      if (m) parts.push({ raw: line.trim() });
    }
    return { ok: r.ok, text, parts };
  }

  /** Copia de seguridad de una partición a NexoData/qualcomm/backups. */
  async backup(partition, port) {
    const t = this.tools();
    if (!t.edl) throw new Error('Falta edl.py');
    const safe = String(partition).replace(/[^\w.-]/g, '_');
    const file = path.join(this.backupsDir(), `${safe}-${Date.now()}.bin`);
    const r = await run(t.python, [t.edl, 'r', partition, file, ...(port ? ['--portname', port] : [])], { cwd: t.edlDir, timeout: 1800000 });
    return { ok: r.ok, file, size: fs.existsSync(file) ? fs.statSync(file).size : 0, log: (r.stdout + r.stderr).slice(-4000) };
  }

  listBackups() {
    const d = this.backupsDir();
    return fs.readdirSync(d).map((f) => {
      const p = path.join(d, f);
      const s = fs.statSync(p);
      return { name: f, path: p, size: s.size, at: s.mtimeMs };
    }).sort((a, b) => b.at - a.at);
  }

  /** Documentación técnica incluida con la app. */
  doc() {
    const base = path.dirname(path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))));
    const candidates = [
      path.join(resourcesDir(), 'qualcomm', 'EDL_Qualcomm.md'),
      path.join(base, 'resources', 'qualcomm', 'EDL_Qualcomm.md'),
      path.join(this.workDir(), 'EDL_Qualcomm.md')
    ];
    for (const c of candidates) {
      try { return fs.readFileSync(c, 'utf8'); } catch { }
    }
    return '';
  }
}

export const qualcomm = new Qualcomm();
