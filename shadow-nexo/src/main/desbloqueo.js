// Desbloqueos: estado del equipo, FRP, OEM unlock, recetas por marca y ejecución guiada.
// Todo se ejecuta con adb/fastboot del sistema; nunca inventa resultados.
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { run, which, uid } from './util.js';

/** Recetas reales por marca: pasos, comandos y advertencias. */
export const RECETAS = [
  {
    id: 'frp-adb',
    marca: 'Android genérico',
    titulo: 'Quitar FRP con depuración USB activa',
    riesgo: 'bajo',
    requiere: 'Equipo encendido en el asistente y depuración USB ya autorizada',
    pasos: [
      'Conecta el equipo y comprueba que adb lo ve.',
      'Comprueba el estado de la cuenta y del FRP.',
      'Borra el paquete de ajustes de Google para forzar el asistente.',
      'Reinicia y salta el inicio de sesión.'
    ],
    comandos: [
      { cmd: 'adb devices', nota: 'Debe aparecer el número de serie, no "unauthorized".' },
      { cmd: 'adb shell getprop ro.build.version.release', nota: 'Versión de Android.' },
      { cmd: 'adb shell dumpsys account', nota: 'Cuentas configuradas.' },
      { cmd: 'adb shell pm clear com.google.android.gms', nota: 'Limpia servicios de Google.' },
      { cmd: 'adb shell settings put secure user_setup_complete 1', nota: 'Marca el asistente como completado.' },
      { cmd: 'adb shell settings put global device_provisioned 1', nota: 'Equipo provisionado.' },
      { cmd: 'adb reboot', nota: 'Reinicia para comprobar.' }
    ],
    avisos: ['Si el equipo está en el asistente sin depuración, este método no sirve: usa fastboot o EDL.']
  },
  {
    id: 'frp-fastboot',
    marca: 'Android genérico',
    titulo: 'Desbloquear bootloader y limpiar FRP por fastboot',
    riesgo: 'medio',
    requiere: 'Fastboot accesible y "OEM unlock" permitido',
    pasos: [
      'Entra en fastboot (Vol- + Power).',
      'Comprueba que fastboot detecta el equipo.',
      'Consulta si el desbloqueo está permitido.',
      'Desbloquea (borra userdata) y reinicia.'
    ],
    comandos: [
      { cmd: 'fastboot devices', nota: 'Debe listar el equipo.' },
      { cmd: 'fastboot oem device-info', nota: 'Estado del bootloader.' },
      { cmd: 'fastboot flashing get_unlock_ability', nota: '1 = se puede desbloquear.' },
      { cmd: 'fastboot flashing unlock', nota: 'Borra todo el contenido.' },
      { cmd: 'fastboot erase frp', nota: 'Borra la partición FRP si existe.' },
      { cmd: 'fastboot reboot', nota: 'Reinicia.' }
    ],
    avisos: ['Desbloquear el bootloader borra todos los datos y puede afectar a la garantía.']
  },
  {
    id: 'xiaomi',
    marca: 'Xiaomi / Redmi / POCO',
    titulo: 'Desbloqueo y FRP en Xiaomi',
    riesgo: 'medio',
    requiere: 'Cuenta Mi vinculada o EDL con programador firmado',
    pasos: [
      'Comprueba el estado del bootloader por fastboot.',
      'Si está bloqueado, solicita el desbloqueo en Mi Unlock (7 días de espera).',
      'Para FRP sin cuenta, borra frp y userdata por fastboot.',
      'Si no hay fastboot, entra en EDL por test point.'
    ],
    comandos: [
      { cmd: 'fastboot devices', nota: 'Detección.' },
      { cmd: 'fastboot oem device-info', nota: 'Estado del bootloader.' },
      { cmd: 'fastboot erase frp', nota: 'Borra FRP.' },
      { cmd: 'fastboot erase userdata', nota: 'Borra datos de usuario.' },
      { cmd: 'fastboot reboot', nota: 'Reinicia.' }
    ],
    avisos: ['Desde 2018 muchos Xiaomi exigen autorización de cuenta para EDL.', 'MIUI/HyperOS con anti-rollback: no bajes de versión sin comprobar el índice ARB.']
  },
  {
    id: 'samsung',
    marca: 'Samsung',
    titulo: 'FRP y estado en Samsung',
    riesgo: 'alto',
    requiere: 'Odin para flasheo completo; fastboot limitado',
    pasos: [
      'Comprueba el modo download (Vol- + Home + Power con USB).',
      'Lee el estado de Knox y del FRP con Odin o por IHM.',
      'Flashea el firmware completo de la misma versión o superior.',
      'Si el FRP persiste, usa la combinación de ajustes o el archivo de FRP.'
    ],
    comandos: [
      { cmd: 'adb devices', nota: 'Si arranca Android.' },
      { cmd: 'adb shell getprop ro.boot.bootloader', nota: 'Versión de bootloader.' },
      { cmd: 'adb shell getprop ro.csc.country_code', nota: 'Región del CSC.' }
    ],
    avisos: ['Knox se dispara al flashear binarios no oficiales.', 'Nunca flashees firmware de otra región sin el CSC correcto.', 'Anti-rollback: bajar de versión puede brickear.']
  },
  {
    id: 'motorola',
    marca: 'Motorola / Lenovo',
    titulo: 'Desbloqueo y recuperación en Motorola',
    riesgo: 'medio',
    requiere: 'Código de desbloqueo del sitio de Motorola o blankflash',
    pasos: [
      'Obtén el código con fastboot oem get_unlock_data en la web de Motorola.',
      'Aplica el desbloqueo.',
      'Para brick duro, usa el blankflash del modelo por EDL.'
    ],
    comandos: [
      { cmd: 'fastboot oem get_unlock_data', nota: 'Cadena para la web de Motorola.' },
      { cmd: 'fastboot oem unlock CLAVE', nota: 'Sustituye CLAVE por la recibida.' },
      { cmd: 'fastboot reboot', nota: 'Reinicia.' }
    ],
    avisos: ['El blankflash es específico del modelo: uno incorrecto deja el equipo peor.']
  },
  {
    id: 'edl-generico',
    marca: 'Qualcomm (cualquiera)',
    titulo: 'Entrar en EDL y leer el equipo',
    riesgo: 'alto',
    requiere: 'edl.py, programador (loader) del modelo y driver 9008',
    pasos: [
      'Entra en EDL por adb, fastboot o test point.',
      'Comprueba el puerto 9008 en el Administrador de dispositivos.',
      'Lee la tabla GPT antes de escribir nada.',
      'Haz copia de las particiones críticas.'
    ],
    comandos: [
      { cmd: 'adb reboot edl', nota: 'Desde Android con depuración.' },
      { cmd: 'fastboot oem edl', nota: 'Desde fastboot, si el abl lo permite.' },
      { cmd: 'edl printgpt', nota: 'Lee la tabla (no escribe).' }
    ],
    avisos: ['Sin programador firmado del modelo no se puede escribir en equipos modernos.', 'Copia siempre persist, modemst1/2 y fsg antes de tocar nada.']
  }
];

export class Desbloqueo extends EventEmitter {
  tools() {
    return { adb: which('adb'), fastboot: which('fastboot') };
  }

  /** Estado del equipo: qué se ve por adb y por fastboot, sin tocar nada. */
  async estado() {
    const t = this.tools();
    const out = { adb: [], fastboot: [], props: {}, bootloader: null, unlockAbility: null };
    if (t.adb) {
      const d = await run(t.adb, ['devices'], { timeout: 8000 });
      out.adb = d.stdout.split(/\r?\n/).slice(1).filter((l) => l.trim()).map((l) => {
        const [serial, state] = l.split(/\s+/);
        return { serial, state };
      });
      const serial = out.adb.find((x) => x.state === 'device')?.serial;
      if (serial) {
        const p = await run(t.adb, ['-s', serial, 'shell', 'getprop'], { timeout: 8000 });
        for (const line of p.stdout.split(/\r?\n/)) {
          const m = /^\[([^\]]+)\]: \[([^\]]*)\]/.exec(line.trim());
          if (m && /^(ro\.product\.model|ro\.product\.brand|ro\.build\.version\.release|ro\.build\.fingerprint|ro\.boot\.bootloader|ro\.csc\.country_code|ro\.miui\.region|ro\.oem_unlock_supported|ro\.boot\.verifiedbootstate|ro\.boot\.flash\.locked)$/.test(m[1])) out.props[m[1]] = m[2];
        }
      }
    }
    if (t.fastboot) {
      const f = await run(t.fastboot, ['devices'], { timeout: 8000 });
      out.fastboot = f.stdout.split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split(/\s+/)[0]);
      if (out.fastboot.length) {
        const info = await run(t.fastboot, ['oem', 'device-info'], { timeout: 8000 });
        out.bootloader = (info.stdout + info.stderr).trim() || null;
        const ua = await run(t.fastboot, ['flashing', 'get_unlock_ability'], { timeout: 8000 });
        out.unlockAbility = (ua.stdout + ua.stderr).trim() || null;
      }
    }
    return out;
  }

  /** Ejecuta un comando de la receta, sustituyendo CLAVE si se aporta. */
  ejecutar(cmd, opts = {}) {
    const t = this.tools();
    const parts = String(cmd).trim().split(/\s+/);
    const bin = parts.shift();
    const exe = bin === 'adb' ? t.adb : bin === 'fastboot' ? t.fastboot : which(bin);
    if (!exe) throw new Error(`No se encontró ${bin} en el PATH.`);
    const args = parts.map((p) => (p === 'CLAVE' ? (opts.clave || p) : p));
    const id = uid('ul');
    const child = spawn(exe, args, { windowsHide: true });
    const job = { id, cmd: `${bin} ${args.join(' ')}`, child, lines: [], code: null };
    const push = (stream, c) => {
      for (const line of String(c).split(/\r?\n/)) {
        if (!line.trim()) continue;
        job.lines.push({ stream, line });
        this.emit('log', { id, stream, line });
      }
    };
    child.stdout.on('data', (c) => push('out', c));
    child.stderr.on('data', (c) => push('err', c));
    child.on('close', (code) => { job.code = code; this.emit('done', { id, code, cmd: job.cmd }); });
    child.on('error', (e) => { this.emit('log', { id, stream: 'err', line: e.message }); this.emit('done', { id, code: -1, cmd: job.cmd }); });
    return { id, cmd: job.cmd };
  }
}

export const desbloqueo = new Desbloqueo();
