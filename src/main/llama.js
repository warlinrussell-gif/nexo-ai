// Gestor multi-instancia de llama-server: carga varios modelos a la vez repartiendo VRAM/RAM,
// descarga automática por turnos cuando no caben, capas en GPU, expertos MoE en CPU, visión.
import fs from 'node:fs';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { activeLlama } from './runtimes.js';
import { freePort, sleep, isWin, run } from './util.js';
import { planModel, recommendContext, staticBudget, GiB, MiB } from '../shared/fit.js';

class LlamaManager extends EventEmitter {
  constructor() {
    super();
    this.instances = new Map();
    this.helpCache = new Map();
    this.getHardware = async () => null;
    this.getSettings = () => ({});
    this.idleTimer = setInterval(() => this.unloadIdle(), 60e3);
  }

  list() {
    return [...this.instances.values()].map((i) => ({
      id: i.id, name: i.name, port: i.port, status: i.status, error: i.error, plan: i.plan, ctx: i.ctx,
      startedAt: i.startedAt, lastUsed: i.lastUsed, busy: i.busy, vision: !!i.mmproj, progress: i.progress, backend: i.backend
    }));
  }

  emitChange() { this.emit('change', this.list()); }

  async serverFlags(serverPath) {
    if (this.helpCache.has(serverPath)) return this.helpCache.get(serverPath);
    const r = await run(serverPath, ['--help'], { timeout: 15000, cwd: require_dirname(serverPath) });
    const txt = r.stdout + r.stderr;
    this.helpCache.set(serverPath, txt);
    return txt;
  }

  /** Presupuesto disponible teniendo en cuenta lo que ya está cargado. */
  async budget(excludeId) {
    const hw = await this.getHardware();
    const s = this.getSettings();
    const b = staticBudget(hw);
    const reserve = (s.reserveVramMB ?? 700) * MiB;
    if (b.hasGpu && !hw.unifiedMemory) b.vram = Math.max(0, b.vram + 0.7 * GiB - reserve);
    let usedG = 0, usedC = 0;
    for (const i of this.instances.values()) {
      if (i.id === excludeId || !i.plan || i.status === 'error') continue;
      usedG += i.plan.gpuBytes; usedC += i.plan.cpuBytes;
    }
    b.vram = Math.max(0, b.vram - usedG);
    const total = os.totalmem();
    const freeNow = os.freemem() - Math.min(1.2 * GiB, total * 0.1);
    b.ram = Math.max(0, Math.min(b.ram - usedC, freeNow + usedC * 0));
    b.hardRam = total * 0.95 - usedC;
    if (s.backendOverride === 'cpu') b.hasGpu = false;
    return b;
  }

  async planFor(model, opts = {}) {
    const s = this.getSettings();
    const ms = model.settings || {};
    const b = await this.budget(model.id);
    const mmSize = model.mmproj && ms.vision !== false ? safeSize(model.mmproj) : 0;
    const manual = ms.gpuLayers !== undefined && ms.gpuLayers !== 'auto' && ms.gpuLayers !== '' ? Number(ms.gpuLayers) : undefined;
    const auto = this.isAutoCtx(model) && !opts.ctx;
    const rec = auto ? recommendContext(model.meta, b, { fileSize: model.size, mmprojSize: mmSize }) : null;
    const ctx = rec ? rec.ctx : (opts.ctx || ms.ctx || s.ctx || 8192);
    const kvType = rec ? rec.kvType : (ms.kvType || s.kvType || 'f16');
    const plan = planModel(model.meta, b, { ctx, kvType, mmprojSize: mmSize, fileSize: model.size, gpuLayers: manual });
    return { ...plan, kvType, autoCtx: !!rec, reason: rec?.reason };
  }

  // Contexto automático salvo que el usuario lo haya fijado a mano para este modelo
  isAutoCtx(model) {
    const ms = model.settings || {};
    if (ms.ctxMode) return ms.ctxMode === 'auto';
    return this.getSettings().autoCtx !== false;
  }

  async ensureLoaded(model, opts = {}) {
    let inst = this.instances.get(model.id);
    if (inst?.status === 'ready') { inst.lastUsed = Date.now(); return inst; }
    if (inst?.status === 'loading') return inst.readyPromise;
    if (inst?.status === 'error') this.instances.delete(model.id);
    const s = this.getSettings();
    let plan = await this.planFor(model, opts);
    // En contexto automático, liberar la GPU de modelos inactivos para darle al nuevo su máximo
    const wantsGpu = plan.autoCtx && plan.mode !== 'gpu';
    if ((!plan.fits || wantsGpu) && s.autoSwap !== false) {
      // descargar modelos inactivos por orden de último uso hasta que quepa
      const idle = [...this.instances.values()].filter((i) => !i.busy && i.id !== model.id).sort((a, b) => a.lastUsed - b.lastUsed);
      for (const i of idle) {
        await this.stop(i.id);
        plan = await this.planFor(model, opts);
        if (plan.fits && !(plan.autoCtx && plan.mode !== 'gpu')) break;
      }
    }
    if (!plan.fits) {
      // Los pesos se mapean desde disco (mmap): si cabe en la RAM física total, se intenta igualmente
      const b = await this.budget(model.id);
      if (plan.cpuBytes <= b.hardRam && plan.gpuBytes <= b.vram + 1) {
        plan = { ...plan, fits: true, tight: true };
      } else {
        const need = (plan.cpuBytes / GiB).toFixed(1);
        throw new Error(`El modelo no cabe en la memoria disponible (necesita ~${need} GB de RAM además de la VRAM). Prueba una cuantización más pequeña, reduce el contexto o cierra otros modelos.`);
      }
    }
    return this.start(model, plan, opts);
  }

  async start(model, plan, opts = {}) {
    const rt = activeLlama();
    if (!rt) throw new Error('El motor local (llama.cpp) no está instalado. Ve a Modelos → Motor para instalarlo con un clic.');
    const s = this.getSettings();
    const ms = model.settings || {};
    const help = await this.serverFlags(rt.serverPath);
    const has = (f) => help.includes(f);
    const port = await freePort(39300 + this.instances.size * 3);
    const hw = await this.getHardware();
    const threads = s.threads || Math.max(2, (hw?.cpu?.physical || os.cpus().length / 2) - (plan.mode === 'gpu' ? 1 : 0));
    const args = ['-m', model.path, '--host', '127.0.0.1', '--port', String(port), '-c', String(plan.ctx), '-t', String(threads)];
    if (rt.backend !== 'cpu' && plan.mode !== 'cpu') args.push('-ngl', String(plan.mode === 'gpu' || plan.mode === 'moe' ? 999 : plan.gpuLayers));
    else args.push('-ngl', '0');
    if (plan.mode === 'moe' && plan.cpuMoeLayers > 0 && has('--n-cpu-moe')) args.push('--n-cpu-moe', String(plan.cpuMoeLayers));
    if (has('--jinja')) args.push('--jinja');
    if (model.mmproj && ms.vision !== false && has('--mmproj')) args.push('--mmproj', model.mmproj);
    if (has('--no-webui')) args.push('--no-webui');
    const kvType = plan.kvType || ms.kvType || s.kvType || 'f16';
    if (kvType !== 'f16' && has('--cache-type-k')) {
      args.push('--cache-type-k', kvType, '--cache-type-v', kvType);
      if (has('--flash-attn')) args.push('--flash-attn', 'on');
    }
    if (has('--parallel')) args.push('--parallel', String(s.parallel || 1));
    if (has('--metrics')) args.push('--metrics');
    if (ms.extraArgs) args.push(...String(ms.extraArgs).split(/\s+/).filter(Boolean));

    const inst = {
      id: model.id, name: model.name, port, status: 'loading', plan, ctx: plan.ctx, startedAt: Date.now(), lastUsed: Date.now(),
      busy: 0, logs: [], mmproj: model.mmproj, error: null, progress: 0, backend: rt.backend, args
    };
    this.instances.set(model.id, inst);
    this.emitChange();

    inst.readyPromise = (async () => {
      const tryStart = async (argv) => {
        const proc = spawn(rt.serverPath, argv, { cwd: require_dirname(rt.serverPath), windowsHide: true, env: { ...process.env } });
        inst.proc = proc;
        const onData = (d) => {
          const txt = d.toString();
          for (const line of txt.split(/\r?\n/)) {
            if (!line.trim()) continue;
            inst.logs.push(line); if (inst.logs.length > 400) inst.logs.shift();
            const m = /load_tensors:.*?(\d+)%/.exec(line) || /loading.*?(\d+(?:\.\d+)?)%/.exec(line);
            if (m) { inst.progress = +m[1]; this.emitChange(); }
          }
        };
        proc.stdout.on('data', onData); proc.stderr.on('data', onData);
        let exited = false, exitCode = null;
        proc.on('exit', (code) => {
          exited = true; exitCode = code;
          if (inst.status === 'ready') { inst.status = 'error'; inst.error = `El servidor se detuvo (código ${code})`; this.emitChange(); }
        });
        const deadline = Date.now() + 10 * 60e3;
        while (Date.now() < deadline) {
          if (exited) return { ok: false, code: exitCode };
          try {
            const r = await fetch(`http://127.0.0.1:${port}/health`);
            if (r.ok) return { ok: true };
          } catch { }
          await sleep(400);
        }
        return { ok: false, timeout: true };
      };
      let r = await tryStart(args);
      if (!r.ok && !r.timeout) {
        // reintento con parámetros mínimos (por si la versión del motor no admite alguna opción)
        const basic = ['-m', model.path, '--host', '127.0.0.1', '--port', String(port), '-c', String(plan.ctx), '-ngl', args[args.indexOf('-ngl') + 1] || '0'];
        const moeIdx = args.indexOf('--n-cpu-moe');
        if (moeIdx > 0) basic.push('--n-cpu-moe', args[moeIdx + 1]);
        if (model.mmproj && ms.vision !== false) basic.push('--mmproj', model.mmproj);
        if (has('--jinja')) basic.push('--jinja');
        inst.logs.push('--- Reintentando con parámetros básicos ---');
        r = await tryStart(basic);
        if (!r.ok && !r.timeout && plan.mode !== 'cpu') {
          inst.logs.push('--- Reintentando solo con CPU ---');
          r = await tryStart(['-m', model.path, '--host', '127.0.0.1', '--port', String(port), '-c', String(Math.min(plan.ctx, 4096)), '-ngl', '0']);
        }
      }
      if (!r.ok) {
        inst.status = 'error';
        const tail = inst.logs.slice(-12).join('\n');
        inst.error = r.timeout ? 'Tiempo de carga agotado' : `No se pudo iniciar el modelo.\n${tail}`;
        try { inst.proc?.kill(); } catch { }
        this.emitChange();
        throw new Error(inst.error);
      }
      inst.status = 'ready'; inst.progress = 100; inst.lastUsed = Date.now();
      this.emitChange();
      return inst;
    })();
    return inst.readyPromise;
  }

  baseUrl(id) { const i = this.instances.get(id); return i ? `http://127.0.0.1:${i.port}/v1` : null; }

  acquire(id) { const i = this.instances.get(id); if (i) { i.busy++; i.lastUsed = Date.now(); this.emitChange(); } }
  release(id) { const i = this.instances.get(id); if (i) { i.busy = Math.max(0, i.busy - 1); i.lastUsed = Date.now(); this.emitChange(); } }

  async stop(id) {
    const i = this.instances.get(id);
    if (!i) return;
    i.status = 'stopping'; this.emitChange();
    await killTree(i.proc);
    this.instances.delete(id);
    this.emitChange();
    await sleep(300);
  }

  async stopAll() { await Promise.all([...this.instances.keys()].map((id) => this.stop(id))); }

  unloadIdle() {
    const mins = this.getSettings().autoUnloadMinutes;
    if (!mins) return;
    for (const i of this.instances.values()) {
      if (!i.busy && i.status === 'ready' && Date.now() - i.lastUsed > mins * 60e3) this.stop(i.id);
    }
  }

  logs(id) { return this.instances.get(id)?.logs || []; }
}

function require_dirname(p) { return p.replace(/[\\/][^\\/]+$/, ''); }
function safeSize(p) { try { return fs.statSync(p).size; } catch { return 0; } }

export async function killTree(proc) {
  if (!proc || proc.exitCode !== null) return;
  if (isWin) { await run('taskkill', ['/pid', String(proc.pid), '/T', '/F']); }
  else {
    try { proc.kill('SIGTERM'); } catch { }
    await Promise.race([new Promise((r) => proc.once('exit', r)), sleep(3000)]);
    try { if (proc.exitCode === null) proc.kill('SIGKILL'); } catch { }
  }
}

export const llama = new LlamaManager();
