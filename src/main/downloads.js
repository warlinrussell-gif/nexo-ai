// Gestor de descargas: reanudable (HTTP Range), cola, pausa/reanudar/cancelar,
// varios archivos por trabajo (GGUF divididos + mmproj), velocidad y ETA.
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { uid, sleep } from './util.js';
import { dir } from './paths.js';
import { readJSON, writeJSONAtomic } from './store.js';

export class DownloadManager extends EventEmitter {
  constructor() {
    super();
    this.jobs = new Map();
    this.concurrency = 2;
    this.headersFor = () => ({});
    this.stateFile = null;
  }

  init() {
    this.stateFile = dir('config', 'downloads.json');
    const saved = readJSON(this.stateFile, []);
    for (const j of saved) {
      if (j.status === 'done') continue;
      // Los motores necesitan su paso de instalación (no persistible): se reinstalan desde la interfaz
      if (j.kind === 'runtime') { for (const f of j.files || []) { try { fs.unlinkSync(f.dest + '.part'); } catch { } } continue; }
      // El progreso guardado puede ser antiguo: recalcularlo con lo que hay realmente en disco
      for (const f of j.files || []) {
        try { f.done = fs.statSync(f.complete ? f.dest : f.dest + '.part').size; } catch { f.done = f.complete ? f.size || 0 : 0; }
      }
      j.received = this.totalReceived(j);
      // Lo que se estaba descargando al cerrar la app continúa solo; lo pausado por el usuario sigue en pausa
      j.status = j.status === 'error' ? 'error' : ['downloading', 'queued'].includes(j.status) ? 'queued' : 'paused';
      j.speed = 0; j.eta = 0;
      this.jobs.set(j.id, j);
    }
    setTimeout(() => this.pump(), 3000);
  }

  persist() {
    if (!this.stateFile) return;
    const list = [...this.jobs.values()].filter((j) => j.status !== 'done').map(({ controller, onDone, ...rest }) => rest);
    try { writeJSONAtomic(this.stateFile, list); } catch { }
  }

  list() { return [...this.jobs.values()].map(({ controller, onDone, ...rest }) => rest); }

  /** files: [{ url, dest, size? }] */
  add({ label, kind = 'model', files, meta = {}, onDone }) {
    const existing = [...this.jobs.values()].find((j) => j.files[0]?.dest === files[0]?.dest && j.status !== 'done');
    if (existing) { if (existing.status !== 'downloading') this.resume(existing.id); return existing.id; }
    const job = {
      id: uid('dl_'), label, kind, meta, status: 'queued', error: null,
      files: files.map((f) => ({ ...f, done: 0, size: f.size || 0, complete: false })),
      total: files.reduce((a, f) => a + (f.size || 0), 0), received: 0, speed: 0, eta: 0, createdAt: Date.now(), onDone
    };
    this.jobs.set(job.id, job);
    this.emitUpdate(job, true);
    this.pump();
    return job.id;
  }

  emitUpdate(job, force = false) {
    const now = Date.now();
    if (!force && job._lastEmit && now - job._lastEmit < 250) return;
    job._lastEmit = now;
    const { controller, onDone, ...rest } = job;
    this.emit('update', rest);
  }

  pump() {
    const active = [...this.jobs.values()].filter((j) => j.status === 'downloading').length;
    let slots = this.concurrency - active;
    for (const j of this.jobs.values()) {
      if (slots <= 0) break;
      if (j.status === 'queued') { slots--; this.runJob(j); }
    }
  }

  pause(id) {
    const j = this.jobs.get(id); if (!j) return;
    if (j.status === 'downloading') { j.status = 'paused'; j.controller?.abort(); }
    else if (j.status === 'queued') j.status = 'paused';
    this.emitUpdate(j, true); this.persist();
  }

  resume(id) {
    const j = this.jobs.get(id); if (!j) return;
    if (['paused', 'error'].includes(j.status)) { j.status = 'queued'; j.error = null; this.emitUpdate(j, true); this.pump(); }
  }

  cancel(id) {
    const j = this.jobs.get(id); if (!j) return;
    j.status = 'cancelled'; j.controller?.abort();
    for (const f of j.files) { try { fs.unlinkSync(f.dest + '.part'); } catch { } }
    this.emitUpdate(j, true);
    this.jobs.delete(id); this.persist(); this.pump();
  }

  clearFinished() {
    for (const [id, j] of this.jobs) if (['done', 'cancelled'].includes(j.status)) this.jobs.delete(id);
  }

  async runJob(job) {
    job.status = 'downloading';
    job.controller = new AbortController();
    this.emitUpdate(job, true);
    this.persist();
    try {
      for (const f of job.files) {
        if (f.complete || fs.existsSync(f.dest) && (!f.size || fs.statSync(f.dest).size === f.size)) { f.complete = true; f.done = f.size || fs.statSync(f.dest).size; continue; }
        await this.downloadFile(job, f);
      }
      job.received = job.files.reduce((a, f) => a + f.done, 0);
      job.speed = 0; job.eta = 0;
      if (job.onDone) {
        job.status = 'installing';
        this.emitUpdate(job, true);
        try { await job.onDone(job); } catch (e) { throw new Error('Instalación fallida: ' + (e.message || e)); }
      }
      job.status = 'done';
      this.emitUpdate(job, true);
      this.persist();
      this.emit('done', job);
    } catch (e) {
      if (job.status === 'paused' || job.status === 'cancelled') { /* intencional */ }
      else {
        job.status = 'error'; job.error = e.message || String(e);
        // si falló la instalación (extracción), borrar los archivos descargados para reintentar limpio
        if (/Instalación fallida/.test(job.error)) for (const f of job.files) { f.complete = false; f.done = 0; try { fs.unlinkSync(f.dest); } catch { } }
      }
      job.speed = 0;
      this.emitUpdate(job, true);
      this.persist();
    } finally {
      job.controller = null;
      this.pump();
    }
  }

  async downloadFile(job, f) {
    fs.mkdirSync(path.dirname(f.dest), { recursive: true });
    const part = f.dest + '.part';
    let attempt = 0;
    while (true) {
      let start = 0;
      try { start = fs.statSync(part).size; } catch { }
      try {
        const headers = { ...this.headersFor(f.url), 'User-Agent': 'NexoAI/1.0' };
        if (start > 0) headers.Range = `bytes=${start}-`;
        const res = await fetch(f.url, { headers, signal: job.controller.signal, redirect: 'follow' });
        if (res.status === 416) { /* ya completo */ break; }
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) throw new Error(`Acceso denegado (${res.status}). Este modelo puede requerir aceptar la licencia en Hugging Face y configurar tu token en Ajustes.`);
          throw new Error(`HTTP ${res.status}`);
        }
        if (start > 0 && res.status === 200) start = 0; // el servidor ignoró Range
        const len = Number(res.headers.get('content-length') || 0);
        if (!f.size && len) { f.size = start + len; job.total = job.files.reduce((a, x) => a + (x.size || 0), 0); }
        const ws = fs.createWriteStream(part, { flags: start > 0 ? 'a' : 'w' });
        f.done = start;
        let lastT = Date.now(), lastB = this.totalReceived(job);
        try {
          for await (const chunk of res.body) {
            if (!ws.write(chunk)) await new Promise((r) => ws.once('drain', r));
            f.done += chunk.length;
            const now = Date.now();
            if (now - lastT >= 500) {
              const rec = this.totalReceived(job);
              const inst = (rec - lastB) / ((now - lastT) / 1000);
              job.speed = job.speed ? job.speed * 0.7 + inst * 0.3 : inst;
              lastT = now; lastB = rec;
              job.received = rec;
              job.eta = job.speed > 0 && job.total ? Math.round((job.total - rec) / job.speed) : 0;
              this.emitUpdate(job);
              if (now - (job._lastPersist || 0) > 15000) { job._lastPersist = now; this.persist(); }
            }
          }
        } finally {
          await new Promise((r) => ws.end(r));
        }
        const got = fs.statSync(part).size;
        if (f.size && got < f.size) throw new Error('Descarga incompleta');
        break;
      } catch (e) {
        if (job.controller.signal.aborted) throw e;
        if (/Acceso denegado/.test(e.message)) throw e;
        attempt++;
        if (attempt > 6) throw e;
        await sleep(Math.min(15000, 1000 * 2 ** attempt));
      }
    }
    fs.renameSync(part, f.dest);
    f.complete = true;
    f.done = f.size || fs.statSync(f.dest).size;
  }

  totalReceived(job) { return job.files.reduce((a, f) => a + (f.done || 0), 0); }

  waitFor(id) {
    return new Promise((resolve, reject) => {
      const check = (j) => {
        if (j.id !== id) return;
        if (j.status === 'done') { this.off('update', check); resolve(j); }
        else if (j.status === 'error' || j.status === 'cancelled') { this.off('update', check); reject(new Error(j.error || 'Descarga cancelada')); }
      };
      this.on('update', check);
      const j = this.jobs.get(id);
      if (!j) { this.off('update', check); resolve(null); }
      else if (j.status === 'done') { this.off('update', check); resolve(j); }
      else if (j.status === 'error') { this.off('update', check); reject(new Error(j.error)); }
    });
  }
}

export const downloads = new DownloadManager();
