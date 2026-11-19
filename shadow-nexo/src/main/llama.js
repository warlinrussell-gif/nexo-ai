// Gestor multi-instancia de llama-server: carga varios modelos a la vez repartiendo VRAM/RAM,
// descarga automática por turnos cuando no caben, capas en GPU, expertos MoE en CPU, visión.
import fs from 'node:fs';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { activeLlama } from './runtimes.js';
import { freePort, sleep, isWin, run } from './util.js';
import { planModel, recommendContext, staticBudget, GiB, MiB } from '../shared/fit.js';
import { liveStats } from './hardware.js';

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
    // VRAM LIBRE REAL ahora mismo: Windows, el navegador, overlays, etc. ya ocupan memoria de la GPU (p. ej. ~2 GB).
    // Si el plan usa toda la VRAM nominal, CUDA se queda sin memoria al cargar y el servidor se cae (y caía a CPU/4096).
    try {
      if (b.hasGpu && !hw?.unifiedMemory) {
        const g = (await liveStats())?.gpus?.[0];
        if (g && g.vram && g.free != null) {
          // Si se está re-planificando un modelo que YA está cargado (cambiar contexto, ver el análisis), su propia VRAM cuenta como libre.
          const own = excludeId ? this.instances.get(excludeId) : null;
          const ownGpu = own && own.plan && own.status !== 'error' ? own.plan.gpuBytes : 0;
          const freeNow = Math.max(0, g.free + ownGpu - 350 * MiB); // margen para fluctuaciones del escritorio
          b.vramNominal = b.vram;
          b.vram = Math.min(b.vram, freeNow);
        }
      }
    } catch { }
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
    // Al cargar un modelo, se descargan los otros que estén inactivos: así el nuevo tiene toda la VRAM (y su contexto real).
    if (s.autoSwap !== false) {
      for (const i of [...this.instances.values()].filter((x) => !x.busy && x.id !== model.id)) await this.stop(i.id);
    }
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
    // Aviso de margen: si queda poca VRAM/RAM libre tras cargar este modelo junto a los demás, avisar antes de que el PC se congele.
    try {
      const bw = await this.budget(model.id);
      const vramLeft = bw.hasGpu ? bw.vram - plan.gpuBytes : Infinity;
      const ramLeft = bw.ram - plan.cpuBytes;
      const others = [...this.instances.values()].filter((i) => i.id !== model.id && i.status !== 'error').length;
      const name = String(model.name || model.id).split(/[\\/]/).pop().replace(/\.gguf$/i, '');
      const msgs = [];
      if (vramLeft < 1.2 * GiB) msgs.push(`queda poca VRAM libre (${Math.max(0, vramLeft / GiB).toFixed(1)} GB de margen)`);
      if (ramLeft < 4 * GiB) msgs.push(`queda poca RAM libre (${Math.max(0, ramLeft / GiB).toFixed(1)} GB de margen)`);
      if (msgs.length) this.emit('warn', `«${name}»${others ? ' junto a los otros modelos cargados' : ''}: ${msgs.join(' y ')}. El PC puede ir lento o congelarse. Cambia a un modelo más pequeño, baja el contexto o descarga otro modelo para tener margen.`);
    } catch { }
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
    // Flash-attention SIEMPRE que el motor lo admita (antes solo con KV comprimido): acelera la atención
    // y reduce la memoria del KV y del búfer de cómputo, dejando más VRAM para capas. Clave en offload.
    if (has('--flash-attn')) {
      const faLine = (help.match(/--flash-attn[^\n]*/) || [''])[0];
      args.push('--flash-attn', /auto/i.test(faLine) ? 'auto' : 'on');
    }
    if (kvType !== 'f16' && has('--cache-type-k')) args.push('--cache-type-k', kvType, '--cache-type-v', kvType);
    // (Medido con llama-bench en el 27B IQ4_XS con 34 capas en GPU: flash-attn +14% generación; reducir ubatch a 256
    // bajaba el prefill un 40% sin ganar nada, así que se deja el ubatch por defecto.)
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
      // ¿El fallo parece falta de memoria de la GPU? (CUDA out of memory, cudaMalloc, alloc fallida…)
      const oomRe = /out of memory|cudaMalloc|failed to allocate|unable to allocate|CUDA error|ErrorOutOfDeviceMemory|not enough memory|cudaMemcpy|alloc.{0,20}fail/i;
      const looksOom = () => oomRe.test(inst.logs.slice(-80).join('\n'));
      let r = await tryStart(args);
      // 1) Sin VRAM suficiente (otras apps usan la GPU): bajar capas en GPU y mantener el MISMO contexto, antes de caer a CPU.
      if (!r.ok && !r.timeout && plan.mode !== 'cpu' && rt.backend !== 'cpu' && looksOom()) {
        const nglIdx = args.indexOf('-ngl');
        const full = (plan.mode === 'gpu' || plan.mode === 'moe') ? (plan.totalLayers || 64) : (plan.gpuLayers || 0);
        for (const f of [0.8, 0.65, 0.5, 0.35, 0.2]) {
          const n = Math.max(1, Math.floor(full * f));
          if (nglIdx < 0 || n >= full) continue;
          const a = args.slice(); a[nglIdx + 1] = String(n);
          inst.logs.push(`--- Sin VRAM suficiente: reintentando con ${n} de ${full} capas en GPU ---`);
          r = await tryStart(a);
          if (r.ok) {
            const ratio = n / full; const gpuBytes = Math.round((plan.gpuBytes || 0) * ratio);
            inst.plan = { ...plan, mode: 'partial', gpuLayers: n, gpuBytes, cpuBytes: (plan.cpuBytes || 0) + ((plan.gpuBytes || 0) - gpuBytes), reducedForVram: true };
            inst.args = a;
            break;
          }
          if (r.timeout || !looksOom()) break;
        }
      }
      // 2) Parámetros mínimos (por si la versión del motor no admite alguna opción) — solo si NO fue un problema de memoria
      if (!r.ok && !r.timeout && !looksOom()) {
        const basic = ['-m', model.path, '--host', '127.0.0.1', '--port', String(port), '-c', String(plan.ctx), '-ngl', args[args.indexOf('-ngl') + 1] || '0'];
        const moeIdx = args.indexOf('--n-cpu-moe');
        if (moeIdx > 0) basic.push('--n-cpu-moe', args[moeIdx + 1]);
        if (model.mmproj && ms.vision !== false) basic.push('--mmproj', model.mmproj);
        if (has('--jinja')) basic.push('--jinja');
        inst.logs.push('--- Reintentando con parámetros básicos ---');
        r = await tryStart(basic);
      }
      // 3) Último recurso: solo CPU. Se conserva el contexto (hasta 16k) y se ACTUALIZA el estado para que el motor de chat lo sepa
      //    (antes quedaba en 4096 mientras Nexo creía tener más, y las peticiones reventaban con "exceeds the available context size").
      if (!r.ok && !r.timeout && plan.mode !== 'cpu') {
        const cpuCtx = Math.min(plan.ctx, 16384);
        inst.logs.push(`--- Reintentando solo con CPU (contexto ${cpuCtx}) ---`);
        const cpuArgs = ['-m', model.path, '--host', '127.0.0.1', '--port', String(port), '-c', String(cpuCtx), '-ngl', '0'];
        if (has('--jinja')) cpuArgs.push('--jinja');
        if (model.mmproj && ms.vision !== false && has('--mmproj')) cpuArgs.push('--mmproj', model.mmproj);
        r = await tryStart(cpuArgs);
        if (r.ok) { inst.ctx = cpuCtx; inst.plan = { ...plan, mode: 'cpu', gpuLayers: 0, gpuBytes: 0, cpuBytes: (plan.cpuBytes || 0) + (plan.gpuBytes || 0), ctx: cpuCtx, reducedForVram: true }; }
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
