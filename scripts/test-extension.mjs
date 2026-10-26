// Prueba de la extensión de Chrome de Nexo: carga la extensión en un Chrome de prueba, la enlaza al puente y controla páginas reales.
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { extBridge, connectBridge } from '../src/main/ext-bridge.js';
import { ExtBrowser } from '../src/main/browser-ext.js';
import { findChrome } from '../src/main/browser-chrome.js';

const CODE = 'codigo-interno-test';
const ext = path.resolve('resources/nexo-extension');
extBridge.start(CODE);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-ext-'));
const b = await puppeteer.launch({ executablePath: findChrome(), headless: false, userDataDir: prof, enableExtensions: [ext], pipe: true, args: ['--no-first-run', '--no-default-browser-check'] });
const sw = await b.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes('background.js'), { timeout: 15000 });
const worker = await sw.worker();
await worker.evaluate(() => connect());
for (let i = 0; i < 30 && !extBridge.connected(); i++) await new Promise((r) => setTimeout(r, 500));
console.log('conectada:', extBridge.connected());
const br = new ExtBrowser({ call: (op, a) => extBridge.call(op, a), connected: () => extBridge.connected() });
let ok = true; const check = (n, c) => { console.log(c ? '  ✔' : '  ✘', n); if (!c) ok = false; };
let s = await br.navigate('https://example.com');
let r = await br.read();
check('navigate+read', s.title === 'Example Domain' && /\[0\]/.test(r.elements));
await br.click(0);
s = await br.state();
check('click → ' + s.url, /iana\.org/.test(s.url));
check('find', /Resultados/.test(await br.find('domains')));
const bs = await br.back(); await new Promise((r) => setTimeout(r, 1500)); s = await br.state(); console.log('back →', bs.url, '|', s.url); check('back', /example\.com/.test(s.url));
const shot = await br.screenshot(); check('screenshot ' + shot.data.length, shot.data.length > 1000);
const html = 'data:text/html,' + encodeURIComponent('<input placeholder="n"><select><option>uno</option><option>dos</option></select><input type=checkbox><button onclick="document.title=document.querySelector(\'input\').value+document.querySelector(\'select\').value+document.querySelector(\'[type=checkbox]\').checked">ok</button>');
// data: no admite scripts de extensión: usamos una página normal para formularios
await br.navigate('https://httpbin.org/forms/post').catch(() => {});
r = await br.read();
const idx = (re) => Number((r.elements.split('\n').find((l) => re.test(l)) || '').match(/^\[(\d+)\]/)?.[1]);
const name = idx(/custname|customer name/i) ; 
console.log(r.elements.split('\n').slice(0, 6).join('\n'));
if (Number.isInteger(name)) { await br.type(name, 'Nexo'); check('type', true); }
const ctl = await connectBridge(CODE); const st = await ctl.call('state', {}); check('controlador externo (MCP) → ' + st.url, /httpbin|example/.test(st.url)); ctl.close();
await b.close(); extBridge.stop();
// controlador externo (como el MCP de OpenCode)
console.log(ok ? 'OK ✔' : 'FALLO ✘');
process.exit(ok ? 0 : 1);
