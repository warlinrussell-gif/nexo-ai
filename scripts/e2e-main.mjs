// Prueba E2E de la interfaz real (Electron headless): recorre vistas, hace capturas y chatea con un modelo local.
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.env.E2E_OUT || '/tmp/nexo-e2e/shots';
const DATA = process.env.E2E_DATA || '/tmp/nexo-test/data';
const USERDATA = '/tmp/nexo-e2e/userData';
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(USERDATA, { recursive: true });
fs.writeFileSync(path.join(USERDATA, 'nexo-location.json'), JSON.stringify({ dataDir: DATA }));
const settingsFile = path.join(DATA, 'config', 'settings.json');
try { const s = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); s.setupDone = true; s.theme = 'dark'; s.permissions = { mode: 'full' }; s.ctx = 4096; fs.writeFileSync(settingsFile, JSON.stringify(s)); } catch { fs.mkdirSync(path.dirname(settingsFile), { recursive: true }); fs.writeFileSync(settingsFile, JSON.stringify({ setupDone: true, theme: 'dark', permissions: { mode: 'full' }, ctx: 4096 })); }
app.setPath('userData', USERDATA);
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');

const errors = [];
await import('../src/main/main.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  let win;
  for (let i = 0; i < 50 && !win; i++) { win = BrowserWindow.getAllWindows()[0]; await sleep(200); }
  win.setSize(1500, 940);
  win.webContents.on('console-message', (e) => { const lvl = e.level ?? e; const msg = e.message ?? arguments[2]; if (lvl === 'error' || lvl === 3) errors.push(msg); });
  win.webContents.on('render-process-gone', (_e, d) => errors.push('RENDER GONE ' + JSON.stringify(d)));
  await sleep(4500);
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const shot = async (name) => { await sleep(600); const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG()); console.log('captura', name, img.getSize()); };
  const clickRail = (i) => js(`document.querySelectorAll('.rail .rail-btn')[${i}].click()`);
  const clickText = (sel, text) => js(`(() => { const el = [...document.querySelectorAll('${sel}')].find(e => e.textContent.includes(${JSON.stringify(text)})); if (el) { el.click(); return true } return false })()`);
  try {
    await shot('01-chat-bienvenida');
    await clickRail(1); await sleep(3500); await shot('02-modelos-descubrir');
    await js(`document.querySelector('.model-card')?.click()`); await sleep(6000); await shot('03-modelo-detalle');
    await js(`document.querySelector('.drawer-wrap')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`); await sleep(400);
    await clickText('.tabs button', 'Mis modelos'); await sleep(1500); await shot('04-mis-modelos');
    await clickText('.tabs button', 'Multi-modelo'); await sleep(800);
    await js(`document.querySelector('.card input[type=checkbox]')?.click()`); await sleep(300);
    await js(`document.querySelectorAll('.card input[type=checkbox]')[1]?.click()`); await sleep(800); await shot('05-multimodelo');
    await clickText('.tabs button', 'Motor'); await sleep(2500); await shot('06-motor');
    await clickRail(5); await sleep(3000); await shot('07-equipo');
    await clickRail(2); await sleep(1200); await shot('08-agentes');
    await clickRail(4); await sleep(1200); await shot('09-mcp');
    await js(`document.querySelectorAll('.rail .rail-btn')[document.querySelectorAll('.rail .rail-btn').length - 1].click()`); await sleep(1200); await shot('10-ajustes');
    await clickText('.settings-nav button', 'Voz'); await sleep(1500); await shot('11-ajustes-voz');
    // Chat real con el modelo local
    await clickRail(0); await sleep(500);
    const models = await js(`window.nexo.call('models.local')`);
    console.log('modelos locales:', models.map((m) => m.id));
    if (models[0]) {
      await js(`(async () => { const st = window.__nexoStore.getState(); const c = await st.newChat({ model: 'local:${models[0].id}' }); await st.updateChat(c.id, { reasoningEffort: 'none' }); await st.sendMessage(c.id, { text: 'Crea un archivo hola.txt en tu directorio de trabajo con el texto "Hola desde Nexo" y luego lista el directorio.' }); })()`);
      for (let i = 0; i < 240; i++) { await sleep(1000); const r = await js(`window.__nexoStore.getState().running.size`); if (!r && i > 3) break; if (i === 6) await shot('12-chat-generando'); }
      await sleep(1500);
      await shot('13-chat-respuesta');
      await js(`document.querySelectorAll('.tool-head').forEach(h => h.click())`); await sleep(500); await shot('14-chat-herramientas-abiertas');
    }
    await js(`window.__nexoStore.setState({ paletteOpen: true })`); await sleep(500); await shot('15-paleta');
    await js(`window.__nexoStore.setState({ paletteOpen: false })`);
    await js(`window.__nexoStore.getState().saveSettings({ theme: 'light' })`); await sleep(800); await shot('16-tema-claro');
    await js(`window.__nexoStore.getState().saveSettings({ theme: 'dark' })`);
  } catch (e) { errors.push('E2E: ' + e.stack); }
  fs.writeFileSync(path.join(OUT, 'errors.txt'), errors.join('\n'));
  console.log('ERRORES DE CONSOLA:', errors.length ? errors.join('\n') : 'ninguno');
  app.exit(0);
});
