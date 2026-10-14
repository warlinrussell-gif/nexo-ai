// Control del ordenador: capturas de pantalla, ratón y teclado.
// Windows: API Win32 (SendInput) mediante un proceso PowerShell persistente con C# compilado al vuelo.
// Linux: xdotool. macOS: cliclick/osascript.
import { spawn } from 'node:child_process';
import { desktopCapturer, screen } from 'electron';
import { isWin, isMac, which, run, sleep } from './util.js';

const CS = String.raw`
using System; using System.Runtime.InteropServices; using System.Threading; using System.Collections.Generic;
public static class NexoInput {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern short VkKeyScan(char ch);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public InputUnion U; }
  [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  static void Mouse(uint flags, uint data) { var i = new INPUT(); i.type = 0; i.U.mi.dwFlags = flags; i.U.mi.mouseData = data; SendInput(1, new INPUT[]{ i }, Marshal.SizeOf(typeof(INPUT))); }
  static void Key(ushort vk, ushort scan, uint flags) { var i = new INPUT(); i.type = 1; i.U.ki.wVk = vk; i.U.ki.wScan = scan; i.U.ki.dwFlags = flags; SendInput(1, new INPUT[]{ i }, Marshal.SizeOf(typeof(INPUT))); }
  static bool IsExt(ushort vk) { return (vk>=0x21 && vk<=0x2E) || vk==0x5B || vk==0x5C || vk==0xA3 || vk==0xA5 || vk==0x6F || vk==0x90; }
  public static void Init() { try { SetProcessDPIAware(); } catch {} }
  public static string Pos() { POINT p; GetCursorPos(out p); return p.X + "," + p.Y; }
  public static void Move(int x, int y) { SetCursorPos(x, y); }
  public static void Click(int x, int y, string button, int count) {
    SetCursorPos(x, y); Thread.Sleep(40);
    uint d = 0x2, u = 0x4; if (button == "right") { d = 0x8; u = 0x10; } else if (button == "middle") { d = 0x20; u = 0x40; }
    for (int c = 0; c < count; c++) { Mouse(d, 0); Thread.Sleep(25); Mouse(u, 0); Thread.Sleep(60); }
  }
  public static void Drag(int x1, int y1, int x2, int y2) {
    SetCursorPos(x1, y1); Thread.Sleep(60); Mouse(0x2, 0); Thread.Sleep(80);
    for (int s = 1; s <= 20; s++) { SetCursorPos(x1 + (x2 - x1) * s / 20, y1 + (y2 - y1) * s / 20); Thread.Sleep(12); }
    Thread.Sleep(60); Mouse(0x4, 0);
  }
  public static void Scroll(int x, int y, int amount, bool horizontal) { SetCursorPos(x, y); Thread.Sleep(30); Mouse(horizontal ? 0x1000u : 0x800u, (uint)(amount * 120)); }
  public static void Type(string text) {
    foreach (char ch in text) {
      if (ch == '\n') { Key(0x0D, 0, 0); Key(0x0D, 0, 2); }
      else if (ch == '\t') { Key(0x09, 0, 0); Key(0x09, 0, 2); }
      else if (ch == '\r') { continue; }
      else { Key(0, (ushort)ch, 4); Key(0, (ushort)ch, 4 | 2); }
      Thread.Sleep(4);
    }
  }
  public static void Keys(string vks) {
    var list = new List<ushort>();
    foreach (var s in vks.Split(',')) if (s.Length > 0) list.Add(Convert.ToUInt16(s, 16));
    foreach (var vk in list) { Key(vk, 0, IsExt(vk) ? 1u : 0u); Thread.Sleep(20); }
    for (int k = list.Count - 1; k >= 0; k--) { Key(list[k], 0, (IsExt(list[k]) ? 1u : 0u) | 2u); Thread.Sleep(15); }
  }
  public static int VkFor(char c) { return VkKeyScan(c) & 0xFF; }
}`;

const VK = {
  ctrl: 0x11, control: 0x11, shift: 0x10, alt: 0x12, option: 0x12, win: 0x5b, windows: 0x5b, super: 0x5b, meta: 0x5b, cmd: 0x5b, command: 0x5b,
  enter: 0x0d, return: 0x0d, tab: 0x09, esc: 0x1b, escape: 0x1b, space: 0x20, backspace: 0x08, delete: 0x2e, del: 0x2e, insert: 0x2d, ins: 0x2d,
  home: 0x24, end: 0x23, pageup: 0x21, pgup: 0x21, pagedown: 0x22, pgdn: 0x22, left: 0x25, up: 0x26, right: 0x27, down: 0x28,
  capslock: 0x14, printscreen: 0x2c, prtsc: 0x2c, menu: 0x5d, apps: 0x5d, numlock: 0x90, scrolllock: 0x91, pause: 0x13,
  volumeup: 0xaf, volumedown: 0xae, volumemute: 0xad, mute: 0xad, medianext: 0xb0, mediaprev: 0xb1, mediaplay: 0xb3, playpause: 0xb3, mediastop: 0xb2,
  plus: 0xbb, minus: 0xbd, comma: 0xbc, period: 0xbe
};
for (let i = 1; i <= 24; i++) VK['f' + i] = 0x6f + i;

class WinInput {
  constructor() { this.proc = null; this.queue = Promise.resolve(); this.buf = ''; this.waiter = null; }
  async ensure() {
    if (this.proc && this.proc.exitCode === null) return;
    this.proc = spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'], { windowsHide: true });
    this.proc.stdout.on('data', (d) => {
      this.buf += d.toString();
      const idx = this.buf.indexOf('__NEXO_OK__');
      if (idx >= 0 && this.waiter) { const out = this.buf.slice(0, idx).trim(); this.buf = this.buf.slice(idx + 11); const w = this.waiter; this.waiter = null; w(out); }
    });
    this.proc.stderr.on('data', (d) => { this.lastErr = d.toString(); });
    const b64 = Buffer.from(CS, 'utf8').toString('base64');
    await this.exec(`$src=[System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')); Add-Type -TypeDefinition $src -Language CSharp; [NexoInput]::Init()`, 60000);
  }
  exec(cmd, timeout = 20000) {
    const p = this.queue.then(() => new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.waiter = null; reject(new Error('Tiempo agotado en control de entrada: ' + (this.lastErr || ''))); }, timeout);
      this.waiter = (out) => { clearTimeout(t); resolve(out); };
      this.proc.stdin.write(`${cmd}; Write-Output '__NEXO_OK__'\n`);
    }));
    this.queue = p.catch(() => { });
    return p;
  }
  async call(cmd) { await this.ensure(); return this.exec(cmd); }
  kill() { try { this.proc?.kill(); } catch { } this.proc = null; }
}

const win = isWin ? new WinInput() : null;
const psStr = (s) => "'" + String(s).replace(/'/g, "''") + "'";

function keysToVk(combo) {
  const parts = String(combo).toLowerCase().replace(/\s+/g, '').split(/\+|-(?=.)/).filter(Boolean);
  return parts.map((k) => {
    if (VK[k] !== undefined) return VK[k];
    if (/^[a-z]$/.test(k)) return k.toUpperCase().charCodeAt(0);
    if (/^[0-9]$/.test(k)) return k.charCodeAt(0);
    return null;
  });
}

// ───────── Pantalla / escalado ─────────
let lastShot = null; // { imgW, imgH, physW, physH, originX, originY }

function displayInfo(displayId) {
  const displays = screen.getAllDisplays();
  const d = displays.find((x) => String(x.id) === String(displayId)) || screen.getPrimaryDisplay();
  const sf = d.scaleFactor || 1;
  return { d, sf, physW: Math.round(d.size.width * sf), physH: Math.round(d.size.height * sf), originX: Math.round(d.bounds.x * sf), originY: Math.round(d.bounds.y * sf) };
}

export async function screenshot({ maxWidth = 1366, displayId, quality = 80 } = {}) {
  const info = displayInfo(displayId);
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: info.physW, height: info.physH } });
  const src = sources.find((s) => String(s.display_id) === String(info.d.id)) || sources[0];
  if (!src) throw new Error('No se pudo capturar la pantalla (permiso denegado)');
  let img = src.thumbnail;
  const size = img.getSize();
  const scale = Math.min(1, maxWidth / size.width);
  if (scale < 1) img = img.resize({ width: Math.round(size.width * scale), quality: 'good' });
  const s2 = img.getSize();
  lastShot = { imgW: s2.width, imgH: s2.height, physW: info.physW, physH: info.physH, originX: info.originX, originY: info.originY };
  const jpeg = img.toJPEG(quality);
  return { data: jpeg.toString('base64'), mime: 'image/jpeg', width: s2.width, height: s2.height, screenW: info.physW, screenH: info.physH };
}

/** Amplía una zona de la última captura a resolución real (no cambia el sistema de coordenadas de los clics). */
export async function zoom({ x, y, x2, y2, maxWidth = 1366 } = {}) {
  if (!lastShot) throw new Error('Haz primero una captura (screenshot) para saber qué zona ampliar');
  if ([x, y, x2, y2].some((v) => typeof v !== 'number' || Number.isNaN(v))) throw new Error('Indica la zona con x, y, x2, y2 (coordenadas de la última captura)');
  const info = displayInfo();
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: info.physW, height: info.physH } });
  const src = sources.find((s) => String(s.display_id) === String(info.d.id)) || sources[0];
  if (!src) throw new Error('No se pudo capturar la pantalla');
  const full = src.thumbnail;
  const fsz = full.getSize();
  const kx = fsz.width / lastShot.imgW, ky = fsz.height / lastShot.imgH;
  const rx = Math.max(0, Math.round(Math.min(x, x2) * kx)), ry = Math.max(0, Math.round(Math.min(y, y2) * ky));
  const rw = Math.min(fsz.width - rx, Math.round(Math.abs(x2 - x) * kx)), rh = Math.min(fsz.height - ry, Math.round(Math.abs(y2 - y) * ky));
  if (rw < 8 || rh < 8) throw new Error('La zona es demasiado pequeña');
  let img = full.crop({ x: rx, y: ry, width: rw, height: rh });
  // zonas pequeñas se amplían para que el texto sea legible; las grandes se limitan
  if (rw < 700) img = img.resize({ width: Math.min(1200, rw * 2), quality: 'best' });
  else if (rw > maxWidth) img = img.resize({ width: maxWidth, quality: 'best' });
  const s = img.getSize();
  return { data: img.toJPEG(90).toString('base64'), mime: 'image/jpeg', width: s.width, height: s.height };
}

function toPhys(x, y) {
  if (!lastShot) { const i = displayInfo(); lastShot = { imgW: i.physW, imgH: i.physH, physW: i.physW, physH: i.physH, originX: i.originX, originY: i.originY }; }
  const px = Math.round(lastShot.originX + (Number(x) * lastShot.physW) / lastShot.imgW);
  const py = Math.round(lastShot.originY + (Number(y) * lastShot.physH) / lastShot.imgH);
  return [px, py];
}

async function xdo(args) {
  if (!which('xdotool')) throw new Error('Instala xdotool para controlar el ratón y teclado (sudo apt install xdotool)');
  const r = await run('xdotool', args);
  if (!r.ok) throw new Error(r.stderr || 'xdotool falló');
  return r.stdout.trim();
}

async function mac(args) {
  if (!which('cliclick')) throw new Error('Instala cliclick para controlar el ratón (brew install cliclick) y concede permisos de Accesibilidad.');
  const r = await run('cliclick', args);
  if (!r.ok) throw new Error(r.stderr || 'cliclick falló');
  return r.stdout.trim();
}

export async function perform(action, a = {}) {
  const needXY = ['click', 'double_click', 'right_click', 'middle_click', 'move', 'triple_click'];
  if (needXY.includes(action) && (a.x === undefined || a.y === undefined)) throw new Error('Faltan coordenadas x, y');
  const [x, y] = a.x !== undefined ? toPhys(a.x, a.y) : [0, 0];
  switch (action) {
    case 'click': case 'double_click': case 'right_click': case 'middle_click': case 'triple_click': {
      const button = action === 'right_click' ? 'right' : action === 'middle_click' ? 'middle' : 'left';
      const count = action === 'double_click' ? 2 : action === 'triple_click' ? 3 : 1;
      if (isWin) await win.call(`[NexoInput]::Click(${x}, ${y}, '${button}', ${count})`);
      else if (isMac) await mac([`${button === 'right' ? 'rc' : count === 2 ? 'dc' : count === 3 ? 'tc' : 'c'}:${x},${y}`]);
      else await xdo(['mousemove', String(x), String(y), 'click', '--repeat', String(count), button === 'right' ? '3' : button === 'middle' ? '2' : '1']);
      return `Clic ${button}${count > 1 ? ` x${count}` : ''} en (${a.x}, ${a.y})`;
    }
    case 'move':
      if (isWin) await win.call(`[NexoInput]::Move(${x}, ${y})`);
      else if (isMac) await mac([`m:${x},${y}`]);
      else await xdo(['mousemove', String(x), String(y)]);
      return `Ratón movido a (${a.x}, ${a.y})`;
    case 'drag': {
      const [x2, y2] = toPhys(a.x2, a.y2);
      if (isWin) await win.call(`[NexoInput]::Drag(${x}, ${y}, ${x2}, ${y2})`);
      else if (isMac) await mac([`dd:${x},${y}`, `du:${x2},${y2}`]);
      else await xdo(['mousemove', String(x), String(y), 'mousedown', '1', 'mousemove', String(x2), String(y2), 'mouseup', '1']);
      return `Arrastrado de (${a.x}, ${a.y}) a (${a.x2}, ${a.y2})`;
    }
    case 'type': {
      const text = String(a.text ?? '');
      if (isWin) await win.call(`[NexoInput]::Type(${psStr(text)})`);
      else if (isMac) await run('osascript', ['-e', `tell application "System Events" to keystroke ${JSON.stringify(text)}`]);
      else await xdo(['type', '--delay', '8', '--', text]);
      return `Texto escrito (${text.length} caracteres)`;
    }
    case 'key': {
      const combo = String(a.keys || a.text || '');
      if (isWin) {
        let vks = keysToVk(combo);
        if (vks.some((v) => v === null)) {
          const parts = combo.split('+');
          vks = [];
          for (const p of parts) {
            const k = keysToVk(p)[0];
            if (k !== null && k !== undefined) vks.push(k);
            else if (p.length === 1) vks.push(Number(await win.call(`[NexoInput]::VkFor(${psStr(p)})`)));
            else throw new Error('Tecla desconocida: ' + p);
          }
        }
        await win.call(`[NexoInput]::Keys('${vks.map((v) => v.toString(16)).join(',')}')`);
      } else if (isMac) {
        const parts = combo.toLowerCase().split('+');
        const key = parts.pop();
        const mods = parts.map((m) => ({ ctrl: 'control down', control: 'control down', shift: 'shift down', alt: 'option down', option: 'option down', cmd: 'command down', command: 'command down', win: 'command down', meta: 'command down' })[m]).filter(Boolean);
        const codes = { enter: 36, return: 36, tab: 48, space: 49, backspace: 51, delete: 51, esc: 53, escape: 53, left: 123, right: 124, down: 125, up: 126, home: 115, end: 119, pageup: 116, pagedown: 121 };
        const stmt = codes[key] !== undefined ? `key code ${codes[key]}` : `keystroke ${JSON.stringify(key)}`;
        await run('osascript', ['-e', `tell application "System Events" to ${stmt}${mods.length ? ` using {${mods.join(', ')}}` : ''}`]);
      } else {
        const map = { win: 'super', windows: 'super', cmd: 'super', meta: 'super', enter: 'Return', return: 'Return', esc: 'Escape', escape: 'Escape', backspace: 'BackSpace', del: 'Delete', delete: 'Delete', pageup: 'Page_Up', pagedown: 'Page_Down', space: 'space', tab: 'Tab', up: 'Up', down: 'Down', left: 'Left', right: 'Right', home: 'Home', end: 'End' };
        const x11 = combo.split('+').map((k) => map[k.toLowerCase()] || k).join('+');
        await xdo(['key', '--clearmodifiers', x11]);
      }
      return `Teclas pulsadas: ${combo}`;
    }
    case 'scroll': {
      const amount = Math.max(1, Math.min(30, Number(a.amount) || 5));
      const dir = a.direction || 'down';
      const [sx, sy] = a.x !== undefined ? [x, y] : toPhys((lastShot?.imgW || 1000) / 2, (lastShot?.imgH || 800) / 2);
      if (isWin) await win.call(`[NexoInput]::Scroll(${sx}, ${sy}, ${dir === 'up' || dir === 'left' ? amount : -amount}, ${dir === 'left' || dir === 'right' ? '$true' : '$false'})`);
      else if (isMac) await run('osascript', ['-e', `tell application "System Events" to key code ${dir === 'up' ? 116 : 121}`]);
      else await xdo(['mousemove', String(sx), String(sy), 'click', '--repeat', String(amount), { up: '4', down: '5', left: '6', right: '7' }[dir] || '5']);
      return `Desplazado ${dir} (${amount})`;
    }
    case 'cursor_position': {
      let raw;
      if (isWin) raw = await win.call('[NexoInput]::Pos()');
      else if (isMac) raw = await mac(['p']);
      else { const o = await xdo(['getmouselocation']); const m = /x:(\d+) y:(\d+)/.exec(o); raw = m ? `${m[1]},${m[2]}` : '0,0'; }
      const [px, py] = raw.split(',').map(Number);
      if (lastShot) return `Cursor en (${Math.round((px - lastShot.originX) * lastShot.imgW / lastShot.physW)}, ${Math.round((py - lastShot.originY) * lastShot.imgH / lastShot.physH)}) en coordenadas de la captura`;
      return `Cursor en (${px}, ${py}) píxeles físicos`;
    }
    case 'wait': await sleep(Math.min(30, Number(a.seconds) || 1) * 1000); return `Esperado ${a.seconds || 1}s`;
    default: throw new Error('Acción desconocida: ' + action);
  }
}

export function shutdownInput() { win?.kill(); }
