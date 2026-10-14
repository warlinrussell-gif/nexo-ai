// Pruebas de las herramientas de archivos (grep, glob, multi_edit, protección de archivos cambiados) y tool_search.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
const stub = pathToFileURL(path.resolve('scripts/electron-stub.mjs')).href;
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, n) { if (s === 'electron') return { url: ${JSON.stringify(stub)}, shortCircuit: true }; return n(s, c); }`));
const { builtinTools } = await import('../src/main/tools.js');
const { mcp } = await import('../src/main/mcp.js');
const { allTools } = await import('../src/main/tools.js');

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-tools-'));
fs.mkdirSync(path.join(ws, 'src/sub'), { recursive: true });
fs.mkdirSync(path.join(ws, 'node_modules/x'), { recursive: true });
fs.writeFileSync(path.join(ws, 'src/a.js'), 'const alpha = 1;\nfunction hola() {\n  return alpha;\n}\n');
fs.writeFileSync(path.join(ws, 'src/sub/b.ts'), 'export const beta = "hola";\r\nexport const gamma = 2;\r\n');
fs.writeFileSync(path.join(ws, 'node_modules/x/c.js'), 'hola ignorado');
const ctx = { settings: () => ({}), workspace: ws };
const T = Object.fromEntries(builtinTools(ctx).map((t) => [t.name, t]));
const c = {};
let fail = 0;
const ok = (cond, name, extra = '') => { console.log(`${cond ? 'OK  ' : 'FALLA'} ${name}${cond ? '' : ' → ' + extra}`); if (!cond) fail++; };

let r = await T.glob.run({ pattern: '**/*.js' }, c); ok(r.includes('src/a.js') && !r.includes('node_modules'), 'glob **/*.js', r);
r = await T.glob.run({ pattern: '*.{ts,tsx}' }, c); ok(r.includes('src/sub/b.ts') && !r.includes('a.js'), 'glob llaves', r);
r = await T.grep.run({ pattern: 'hola' }, c); ok(r.includes('a.js') && r.includes('b.ts') && !r.includes('node_modules'), 'grep files', r);
r = await T.grep.run({ pattern: 'alpha', output_mode: 'content', context: 1 }, c); ok(/a\.js:1:/.test(r) && /a\.js:3:/.test(r), 'grep content', r);
r = await T.grep.run({ pattern: 'HOLA', ignore_case: true, glob: '*.ts', output_mode: 'count' }, c); ok(/b\.ts:1/.test(r) && !r.includes('a.js'), 'grep count+glob+i', r);
r = await T.multi_edit.run({ path: 'src/sub/b.ts', edits: [{ old_text: 'beta = "hola";\nexport', new_text: 'beta = "adios";\nexport' }, { old_text: 'gamma = 2', new_text: 'gamma = 3' }] }, c);
const b = fs.readFileSync(path.join(ws, 'src/sub/b.ts'), 'utf8'); ok(b.includes('"adios"') && b.includes('gamma = 3') && b.includes('\r\n'), 'multi_edit CRLF', b);
const before = fs.readFileSync(path.join(ws, 'src/a.js'), 'utf8');
try { await T.multi_edit.run({ path: 'src/a.js', edits: [{ old_text: 'alpha = 1', new_text: 'alpha = 5' }, { old_text: 'NO EXISTE', new_text: 'x' }] }, c); ok(false, 'multi_edit atómico'); } catch { ok(fs.readFileSync(path.join(ws, 'src/a.js'), 'utf8') === before, 'multi_edit atómico'); }
await T.read_file.run({ path: 'src/a.js' }, c);
await new Promise((res) => setTimeout(res, 30));
fs.writeFileSync(path.join(ws, 'src/a.js'), before + '// cambio externo\n');
try { await T.edit_file.run({ path: 'src/a.js', old_text: 'alpha = 1', new_text: 'alpha = 9' }, c); ok(false, 'detecta archivo cambiado'); } catch (e) { ok(/cambió/.test(e.message), 'detecta archivo cambiado', e.message); }
await T.read_file.run({ path: 'src/a.js' }, c);
r = await T.edit_file.run({ path: 'src/a.js', old_text: 'alpha = 1', new_text: 'alpha = 9' }, c); ok(r.includes('alpha = 9'), 'edit tras releer');

// tool_search con un MCP falso de muchas herramientas
mcp.tools = () => Array.from({ length: 60 }, (_, i) => ({ name: `mcp__rea__tool_${i}`, server: 'rea', group: 'mcp', risk: 'read', description: `[MCP · rea] Herramienta número ${i} ` + 'x'.repeat(200), parameters: { type: 'object', properties: { a: { type: 'string' } } }, run: async () => 'ejecutada ' + i }));
const list = allTools(ctx, ['files', 'mcp'], 'all');
ok(!list.some((t) => t.name.startsWith('mcp__')) && list.some((t) => t.name === 'tool_search'), 'MCP diferidas');
r = await list.find((t) => t.name === 'tool_search').run({ query: 'select:tool_7,mcp__rea__tool_9' });
ok(list.some((t) => t.name === 'mcp__rea__tool_7') && list.some((t) => t.name === 'mcp__rea__tool_9'), 'tool_search carga', r);
fs.rmSync(ws, { recursive: true, force: true });
console.log(fail ? `\n${fail} pruebas fallidas` : '\nTodas las pruebas pasaron');
process.exit(fail ? 1 : 0);
