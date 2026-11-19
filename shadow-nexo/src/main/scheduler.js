// Tareas programadas (equivalente a CronCreate de Claude Code y cronjob de Hermes):
// el modelo (o el usuario) programa un prompt para un agente y Nexo lo ejecuta a su hora en un chat nuevo.
import { load, save } from './store.js';
import { uid } from './util.js';

let runner = null;
let timer = null;
const MISSED_MS = 15 * 60 * 1000; // si Nexo estuvo cerrado y se pasó más de esto, se omite esa ejecución

export function setRunner(fn) { runner = fn; }
function st() { return load('schedule', { jobs: [] }); }
export function listJobs() { return st().jobs; }

function nextRun(job, from = Date.now()) {
  if (job.type === 'once') return job.at > from ? job.at : null;
  if (job.type === 'interval') return from + Math.max(1, Number(job.minutes) || 60) * 60000;
  if (job.type === 'daily') {
    const [h, m] = String(job.time || '09:00').split(':').map((x) => Number(x) || 0);
    for (let d = 0; d < 8; d++) {
      const t = new Date(from);
      t.setDate(t.getDate() + d);
      t.setHours(h, m, 0, 0);
      if (t.getTime() > from && (!job.days?.length || job.days.includes(t.getDay()))) return t.getTime();
    }
  }
  return null;
}

export function describe(job) {
  const when = job.type === 'once' ? `una vez, el ${new Date(job.at).toLocaleString('es-ES')}`
    : job.type === 'interval' ? `cada ${job.minutes} min`
      : `cada día a las ${job.time}${job.days?.length ? ` (días ${job.days.join(',')} · 0=domingo)` : ''}`;
  const nxt = job.enabled && job.next ? `próxima: ${new Date(job.next).toLocaleString('es-ES')}` : (job.enabled ? 'sin próxima ejecución' : 'desactivada');
  return `[${job.id}] ${job.name} · agente ${job.agentId} · ${when} · ${nxt}${job.lastRun ? ` · última: ${new Date(job.lastRun).toLocaleString('es-ES')} (${job.lastStatus || '?'})` : ''}`;
}

export function addJob({ name, agentId = 'cerebro', prompt, type, minutes, time, days, at }) {
  if (!prompt || !String(prompt).trim()) throw new Error('Falta el prompt (qué debe hacer la tarea).');
  const t = type || (at ? 'once' : minutes ? 'interval' : 'daily');
  const job = { id: uid('job_'), name: String(name || prompt).slice(0, 60), agentId, prompt: String(prompt), type: t, enabled: true, createdAt: Date.now() };
  if (t === 'once') {
    job.at = typeof at === 'number' ? at : Date.parse(at);
    if (!job.at || isNaN(job.at)) throw new Error('Fecha/hora no válida en "at" (usa formato ISO, p. ej. 2026-11-15T09:30:00).');
    if (job.at <= Date.now()) throw new Error('La fecha indicada ya pasó.');
  } else if (t === 'interval') {
    job.minutes = Number(minutes);
    if (!(job.minutes >= 1)) throw new Error('"minutes" debe ser un número ≥ 1.');
  } else if (t === 'daily') {
    if (!/^\d{1,2}:\d{2}$/.test(String(time || ''))) throw new Error('"time" debe tener formato HH:MM (24 h).');
    job.time = String(time);
    if (Array.isArray(days) && days.length) job.days = days.map(Number).filter((d) => d >= 0 && d <= 6);
  } else throw new Error('type debe ser once, interval o daily.');
  job.next = nextRun(job);
  const s = st(); s.jobs.push(job); save('schedule', s, true);
  return job;
}

export function deleteJob(id) {
  const s = st(); const n = s.jobs.length;
  s.jobs = s.jobs.filter((j) => j.id !== id);
  save('schedule', s, true);
  return s.jobs.length < n;
}

export function setEnabled(id, on) {
  const s = st(); const j = s.jobs.find((x) => x.id === id);
  if (!j) return null;
  j.enabled = !!on; j.next = on ? nextRun(j) : null;
  save('schedule', s, true);
  return j;
}

async function tick() {
  if (!runner) return;
  const now = Date.now();
  const s = st();
  const due = s.jobs.filter((j) => j.enabled && j.next && j.next <= now);
  if (!due.length) return;
  for (const j of due) {
    const late = now - j.next;
    if (late > MISSED_MS) {
      j.lastStatus = 'omitida (Nexo estaba cerrado)';
    } else {
      j.lastRun = now; j.lastStatus = 'lanzada';
      try { await runner(j); } catch (e) { j.lastStatus = 'error: ' + (e?.message || e); }
    }
    if (j.type === 'once') { j.enabled = false; j.next = null; } else j.next = nextRun(j, now);
  }
  save('schedule', s, true);
}

export function startScheduler() {
  if (timer) return;
  timer = setInterval(() => { tick().catch(() => { }); }, 20000);
  setTimeout(() => tick().catch(() => { }), 5000);
}
export function stopScheduler() { if (timer) clearInterval(timer); timer = null; }
