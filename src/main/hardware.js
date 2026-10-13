// Análisis del equipo: CPU, RAM (tipo/velocidad/ancho de banda), GPUs y VRAM real.
import os from 'node:os';
import fs from 'node:fs';
import { isWin, isMac, isLinux, run, psJSON, which } from './util.js';
import { gpuBandwidth, GiB } from '../shared/fit.js';

let cached = null;

function vendorOf(name = '') {
  const n = name.toLowerCase();
  if (/nvidia|geforce|quadro|rtx|gtx|tesla/.test(n)) return 'nvidia';
  if (/amd|radeon|ati\b/.test(n)) return 'amd';
  if (/intel|arc\b|iris|uhd/.test(n)) return 'intel';
  if (/apple|m\d/.test(n)) return 'apple';
  return 'other';
}

function isIntegrated(name = '', vram = 0) {
  const n = name.toLowerCase();
  if (/basic display|virtual|parsec|remote|mirror|citrix|vmware|hyper-v|dummy/.test(n)) return true;
  if (/arc\s*(a|b)\d{3}/.test(n)) return false;
  if (/intel.*(uhd|iris|hd graphics|graphics)|radeon\(tm\) graphics|radeon graphics|vega \d+ graphics|\d{3}m\b/.test(n) && !/rx\s?\d/.test(n)) return true;
  return vram > 0 && vram < 1.5 * GiB;
}

async function nvidiaSmi() {
  const bin = isWin ? (fs.existsSync('C:\\Windows\\System32\\nvidia-smi.exe') ? 'C:\\Windows\\System32\\nvidia-smi.exe' : which('nvidia-smi')) : which('nvidia-smi');
  if (!bin) return [];
  const r = await run(bin, ['--query-gpu=index,name,memory.total,memory.used,memory.free,driver_version,utilization.gpu,temperature.gpu', '--format=csv,noheader,nounits'], { timeout: 8000 });
  if (!r.ok) return [];
  return r.stdout.trim().split(/\r?\n/).filter(Boolean).map((l) => {
    const [index, name, total, used, free, driver, util, temp] = l.split(',').map((s) => s.trim());
    return { index: +index, name, vram: +total * 1048576, used: +used * 1048576, free: +free * 1048576, driver, util: +util, temp: +temp, vendor: 'nvidia', source: 'nvidia-smi' };
  });
}

async function windowsGpus() {
  const [ctrl, reg] = await Promise.all([
    psJSON('Get-CimInstance Win32_VideoController | Select-Object Name, AdapterRAM, DriverVersion, PNPDeviceID, VideoProcessor'),
    psJSON("Get-ItemProperty -Path 'HKLM:\\SYSTEM\\ControlSet001\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*' -ErrorAction SilentlyContinue | Select-Object DriverDesc, @{n='qw';e={$_.'HardwareInformation.qwMemorySize'}}, @{n='ms';e={$_.'HardwareInformation.MemorySize'}}")
  ]);
  return ctrl.filter((c) => c && c.Name).map((c) => {
    const r = reg.find((x) => x && x.DriverDesc === c.Name);
    let vram = 0;
    if (r) {
      const qw = Array.isArray(r.qw) ? r.qw[0] : r.qw;
      const ms = Array.isArray(r.ms) ? r.ms[0] : r.ms;
      vram = Number(qw) || Number(ms) || 0;
    }
    if (!vram) vram = Number(c.AdapterRAM) || 0;
    if (vram < 0) vram += 2 ** 32;
    return { name: c.Name.trim(), vram, driver: c.DriverVersion, vendor: vendorOf(c.Name), source: 'wmi' };
  });
}

async function linuxGpus() {
  const out = [];
  try {
    for (const card of fs.readdirSync('/sys/class/drm')) {
      if (!/^card\d+$/.test(card)) continue;
      const base = `/sys/class/drm/${card}/device`;
      const total = fs.existsSync(`${base}/mem_info_vram_total`) ? +fs.readFileSync(`${base}/mem_info_vram_total`, 'utf8') : 0;
      const used = fs.existsSync(`${base}/mem_info_vram_used`) ? +fs.readFileSync(`${base}/mem_info_vram_used`, 'utf8') : 0;
      const vendorId = fs.existsSync(`${base}/vendor`) ? fs.readFileSync(`${base}/vendor`, 'utf8').trim() : '';
      if (vendorId === '0x1002' && total) out.push({ name: 'AMD Radeon (' + card + ')', vram: total, used, free: total - used, vendor: 'amd', source: 'sysfs' });
      if (vendorId === '0x8086') out.push({ name: 'Intel Graphics (' + card + ')', vram: 0, vendor: 'intel', source: 'sysfs' });
    }
  } catch { }
  const lspci = await run('lspci', [], { timeout: 4000 });
  if (lspci.ok) {
    const names = lspci.stdout.split('\n').filter((l) => /VGA|3D|Display/.test(l)).map((l) => l.split(': ').slice(1).join(': '));
    for (const g of out) {
      const match = names.find((n) => vendorOf(n) === g.vendor);
      if (match) g.name = match.replace(/\[|\]/g, '').replace(/Advanced Micro Devices, Inc\. AMD\/ATI/, 'AMD').trim();
    }
  }
  return out;
}

async function ramInfo() {
  const total = os.totalmem();
  let speed = 0, type = '', modules = 0;
  if (isWin) {
    const mem = await psJSON('Get-CimInstance Win32_PhysicalMemory | Select-Object Speed, ConfiguredClockSpeed, SMBIOSMemoryType, Capacity');
    modules = mem.length;
    speed = Math.max(0, ...mem.map((m) => Number(m.ConfiguredClockSpeed) || Number(m.Speed) || 0));
    const t = mem[0]?.SMBIOSMemoryType;
    type = { 20: 'DDR', 21: 'DDR2', 24: 'DDR3', 26: 'DDR4', 34: 'DDR5', 35: 'LPDDR5' }[t] || '';
  } else if (isLinux) {
    const r = await run('dmidecode', ['-t', '17'], { timeout: 3000 });
    if (r.ok) {
      const sp = [...r.stdout.matchAll(/Configured Memory Speed:\s*(\d+)/g)].map((m) => +m[1]);
      speed = Math.max(0, ...sp);
      type = (/Type:\s*(DDR\d|LPDDR\d)/.exec(r.stdout) || [])[1] || '';
      modules = sp.length;
    }
  }
  if (!type && speed) type = speed >= 4400 ? 'DDR5' : 'DDR4';
  const channels = isMac ? 0 : Math.max(1, Math.min(2, modules || 2));
  let bandwidth = speed ? (channels * speed * 8) / 1000 * 0.8 : (type === 'DDR5' ? 64 : 42);
  if (isMac) bandwidth = 0; // se calcula con la GPU (memoria unificada)
  return { total, free: os.freemem(), speed, type, modules, channels, bandwidth: Math.round(bandwidth) };
}

async function cpuInfo() {
  const cpus = os.cpus();
  let physical = 0, name = cpus[0]?.model?.trim() || 'CPU';
  if (isWin) {
    const p = await psJSON('Get-CimInstance Win32_Processor | Select-Object Name, NumberOfCores, NumberOfLogicalProcessors');
    if (p[0]) { physical = p.reduce((a, x) => a + (+x.NumberOfCores || 0), 0); name = p[0].Name?.trim() || name; }
  } else if (isMac) {
    const r = await run('sysctl', ['-n', 'hw.physicalcpu', 'machdep.cpu.brand_string']);
    const [pc, brand] = r.stdout.trim().split('\n');
    physical = +pc || 0; if (brand) name = brand.trim();
  } else {
    try {
      const info = fs.readFileSync('/proc/cpuinfo', 'utf8');
      const ids = new Set([...info.matchAll(/physical id\s*:\s*(\d+)[\s\S]*?core id\s*:\s*(\d+)/g)].map((m) => m[1] + ':' + m[2]));
      physical = ids.size;
      if (!name || /^unknown$/i.test(name) || name === 'CPU') { const mn = /model name\s*:\s*(.+)/.exec(info); if (mn) name = mn[1].trim(); }
    } catch { }
  }
  return { name, logical: cpus.length, physical: physical || Math.max(1, Math.floor(cpus.length / 2)), arch: process.arch };
}

export async function scanHardware(force = false) {
  if (cached && !force) return cached;
  const [cpu, ram] = await Promise.all([cpuInfo(), ramInfo()]);
  let gpus = [];
  const nv = await nvidiaSmi();
  if (isWin) {
    const wmi = await windowsGpus();
    gpus = wmi.map((g) => {
      const n = nv.find((x) => g.name.includes(x.name) || x.name.includes(g.name));
      return n ? { ...g, ...n, name: g.name } : g;
    });
    for (const n of nv) if (!gpus.find((g) => g.name.includes(n.name) || n.name.includes(g.name))) gpus.push(n);
  } else if (isLinux) {
    gpus = [...nv, ...(await linuxGpus())];
  }
  let unifiedMemory = false;
  if (isMac) {
    const brand = cpu.name;
    unifiedMemory = process.arch === 'arm64';
    gpus = [{ name: unifiedMemory ? brand.replace(/Apple\s*/i, 'Apple ') + ' GPU' : 'GPU integrada', vram: unifiedMemory ? ram.total : 0, vendor: 'apple', unified: unifiedMemory }];
    if (unifiedMemory) ram.bandwidth = gpuBandwidth(brand, true);
  }
  gpus = gpus.map((g) => {
    const integrated = !g.unified && isIntegrated(g.name, g.vram);
    return { ...g, integrated, usable: !integrated || g.unified, bandwidth: gpuBandwidth(g.name, integrated) };
  });
  const main = gpus.filter((g) => g.usable).sort((a, b) => (b.vram || 0) - (a.vram || 0))[0];
  let backend = 'cpu';
  if (isMac) backend = 'metal';
  else if (main?.vendor === 'nvidia') {
    const drv = parseFloat(main.driver || '0');
    backend = drv >= 580 ? 'cuda13' : 'cuda12';
  } else if (main && ['amd', 'intel'].includes(main.vendor)) backend = 'vulkan';
  cached = {
    os: { platform: process.platform, release: os.release(), hostname: os.hostname(), arch: process.arch },
    cpu, ram, gpus, unifiedMemory, recommendedBackend: backend,
    scannedAt: Date.now()
  };
  return cached;
}

export async function liveStats() {
  const ram = { total: os.totalmem(), free: os.freemem() };
  let gpus = [];
  const nv = await nvidiaSmi();
  if (nv.length) gpus = nv.map((g) => ({ name: g.name, vram: g.vram, used: g.used, free: g.free, util: g.util, temp: g.temp }));
  else if (isLinux) gpus = (await linuxGpus()).filter((g) => g.vram).map((g) => ({ name: g.name, vram: g.vram, used: g.used, free: g.free }));
  const load = os.loadavg()[0];
  return { ram, gpus, cpuLoad: load, cpus: os.cpus().length, t: Date.now() };
}

export function summaryText(hw) {
  const g = hw.gpus.filter((x) => x.usable).map((x) => `${x.name} (${(x.vram / GiB).toFixed(1)} GB)`).join(', ') || 'sin GPU dedicada';
  return `${hw.cpu.name} · ${(hw.ram.total / GiB).toFixed(0)} GB RAM ${hw.ram.type || ''} · ${g}`;
}
