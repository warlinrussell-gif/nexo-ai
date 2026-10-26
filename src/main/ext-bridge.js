// Puente local entre Nexo y su extensión de Chrome: servidor WebSocket en 127.0.0.1 con código de enlace.
// Roles: "ext" (la extensión, que ejecuta las órdenes en tu Chrome) y "ctl" (otros procesos de Nexo, p. ej. el MCP de OpenCode).
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';

export const BRIDGE_PORT = 47615;
const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

class ExtBridge extends EventEmitter {
  constructor() { super(); this.wss = null; this.ext = null; this.code = ''; this.pending = new Map(); this.n = 0; }

  connected() { return !!this.ext && this.ext.readyState === 1; }

  start(code) {
    this.code = code;
    if (this.wss) return;
    this.wss = new WebSocketServer({ host: '127.0.0.1', port: BRIDGE_PORT, verifyClient: ({ origin }) => !origin || origin.startsWith('chrome-extension://') });
    this.wss.on('error', (e) => this.emit('error', e));
    this.wss.on('connection', (ws) => {
      let role = null;
      const timer = setTimeout(() => { if (!role) ws.close(); }, 5000);
      ws.on('message', async (raw) => {
        let m; try { m = JSON.parse(String(raw)); } catch { return; }
        if (!role) {
          if (m.type !== 'hello' || !eq(m.code, this.code)) { ws.close(); return; }
          role = m.role === 'ext' ? 'ext' : 'ctl'; clearTimeout(timer);
          if (role === 'ext') { try { this.ext?.close(); } catch { /* */ } this.ext = ws; this.emit('state', true); }
          ws.send(JSON.stringify({ type: 'ready' }));
          return;
        }
        if (role === 'ext') {
          const p = this.pending.get(m.id);
          if (p) { this.pending.delete(m.id); clearTimeout(p.t); m.ok ? p.resolve(m.result) : p.reject(new Error(m.error || 'error de la extensión')); }
        } else if (m.id && m.op) {
          try { ws.send(JSON.stringify({ id: m.id, ok: true, result: await this.call(m.op, m.args) })); }
          catch (e) { ws.send(JSON.stringify({ id: m.id, ok: false, error: e.message })); }
        }
      });
      ws.on('close', () => { clearTimeout(timer); if (ws === this.ext) { this.ext = null; this.emit('state', false); for (const [id, p] of this.pending) { clearTimeout(p.t); p.reject(new Error('La extensión se desconectó')); this.pending.delete(id); } } });
    });
  }

  setCode(code) { this.code = code; try { this.ext?.close(); } catch { /* */ } }

  call(op, args = {}, timeout = 60000) {
    if (!this.connected()) return Promise.reject(new Error('La extensión de Nexo no está conectada a Chrome.'));
    const id = 'r' + (++this.n);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error(`Tiempo agotado esperando a Chrome (${op})`)); }, timeout);
      this.pending.set(id, { resolve, reject, t });
      this.ext.send(JSON.stringify({ id, op, args }));
    });
  }

  stop() { try { this.wss?.close(); } catch { /* */ } this.wss = null; this.ext = null; }
}

export const extBridge = new ExtBridge();

/** Cliente para procesos externos a la app (MCP de OpenCode): devuelve call(op, args). */
export async function connectBridge(code) {
  const { default: WebSocket } = await import('ws');
  const ws = new WebSocket(`ws://127.0.0.1:${BRIDGE_PORT}`);
  const pending = new Map(); let n = 0;
  await new Promise((resolve, reject) => {
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', role: 'ctl', code })));
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      if (m.type === 'ready') return resolve();
      const p = pending.get(m.id); if (p) { pending.delete(m.id); m.ok ? p.resolve(m.result) : p.reject(new Error(m.error)); }
    });
    ws.on('error', () => reject(new Error('Nexo no está abierto (no responde el puente de la extensión).')));
    ws.on('close', () => reject(new Error('Nexo rechazó la conexión (¿código de enlace incorrecto?).')));
  });
  return {
    call: (op, args) => new Promise((resolve, reject) => { const id = 'c' + (++n); pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, op, args })); }),
    close: () => ws.close()
  };
}
