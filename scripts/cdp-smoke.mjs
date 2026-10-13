// Prueba de humo de la app EMPAQUETADA vía Chrome DevTools Protocol: asistente inicial completo + vistas.
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.env.OUT || '/home/.sandbox/shots-pkg';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets = [];
for (let i = 0; i < 60; i++) {
  try { targets = await (await fetch('http://127.0.0.1:9333/json')).json(); if (targets.find((t) => t.type === 'page' && !t.url.includes('#overlay'))) break; } catch { }
  await sleep(500);
}
const page = targets.find((t) => t.type === 'page' && t.url.includes('index.html'));
if (!page) { console.log('NO PAGE', targets); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const errors = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errors.push('EXC ' + JSON.stringify(m.params.exceptionDetails).slice(0, 400));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('ERR ' + m.params.args.map((a) => a.value || a.description).join(' '));
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const shot = async (name) => { await sleep(700); const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64')); console.log('captura', name); };
const click = (text, sel = 'button') => js(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.textContent.trim().includes(${JSON.stringify(text)}) && !e.disabled); if (el) { el.click(); return true } return false })()`);
await send('Runtime.enable'); await send('Page.enable');
await sleep(3500);
console.log('info:', JSON.stringify(await js(`window.nexo.call('app.info')`)));
await shot('p01-setup-carpeta');
console.log('continuar:', await click('Continuar'));
await sleep(6000); await shot('p02-setup-equipo');
console.log('omitir:', await click('Omitir'));
await sleep(3000); await shot('p03-setup-modelo');
console.log('omitir apis:', await click('Omitir (usaré APIs)'));
await sleep(1500); await shot('p04-setup-apis');
console.log('empezar:', await click('Empezar a usar Nexo'));
await sleep(4000); await shot('p05-app');
const info = await js(`window.nexo.call('app.info')`);
console.log('dataDir:', info.dataDir);
const skills = await js(`window.nexo.call('skills.list').then(l => l.map(s => s.id))`);
console.log('skills:', JSON.stringify(skills));
const cat = await js(`window.nexo.call('catalog.get').then(c => c.models.length)`);
console.log('catálogo:', cat, 'modelos');
const hw = await js(`window.nexo.call('hw.scan').then(h => h.recommendedBackend + ' ' + (h.ram.total/2**30).toFixed(1) + 'GB')`);
console.log('hw:', hw);
await js(`document.querySelectorAll('.rail .rail-btn')[1].click()`); await sleep(3000); await shot('p06-modelos');
console.log('ERRORES:', errors.length ? errors.join('\n') : 'ninguno');
ws.close();
process.exit(0);
