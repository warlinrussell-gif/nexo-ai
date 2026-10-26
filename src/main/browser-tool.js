// Definición y ejecución de la herramienta "browser", compartida por los agentes de Nexo y el servidor MCP para OpenCode.
import { truncate } from './util.js';

export const BROWSER_DESCRIPTION = 'Controla el navegador de Nexo (visible para el usuario, con sesión persistente; según Ajustes es el panel integrado o una ventana de Chrome real). Acciones: navigate (url o búsqueda), read (texto de la página + elementos interactivos numerados [n]; offset para seguir leyendo páginas largas), find (text: localiza texto y elementos que lo contienen), click (index), hover (index), type (index, text, submit), fill (fields: [{index, value}] rellena varios campos de un formulario de una vez; checkboxes con value "true"/"false"), select (index, value: elige una opción de un desplegable), press (key: Enter/Tab/Escape/ArrowDown...), scroll (direction, amount), wait (seconds, o text para esperar a que aparezca), back, forward, screenshot (ver la página), console (mensajes y errores de la consola JS), evaluate (script JS). Tras navigate/click usa read para ver el resultado.';

export const BROWSER_PROPERTIES = {
    action: { type: 'string', enum: ['navigate', 'read', 'find', 'click', 'hover', 'type', 'fill', 'select', 'press', 'scroll', 'wait', 'back', 'forward', 'screenshot', 'console', 'evaluate'] },
    url: { type: 'string' }, index: { type: 'integer' }, text: { type: 'string' }, submit: { type: 'boolean' }, key: { type: 'string' }, direction: { type: 'string', enum: ['up', 'down'] }, amount: { type: 'number' }, script: { type: 'string' },
    value: { type: 'string' }, fields: { type: 'array', items: { type: 'object', properties: { index: { type: 'integer' }, value: { type: 'string' } }, required: ['index', 'value'] } }, offset: { type: 'integer', description: 'Carácter desde el que seguir leyendo (read)' }, seconds: { type: 'number' }
};

/** Ejecuta una acción sobre un controlador de navegador (integrado o Chrome real). */
export async function runBrowserAction(b, a) {
    const summary = (s) => `Página: ${s.title || '(sin título)'}\nURL: ${s.url}`;
    switch (a.action) {
      case 'navigate': { const s = await b.navigate(a.url || a.text); const r = await b.read({ maxChars: 6000 }); return `${summary(s)}\n\n## Contenido\n${r.text}\n\n## Elementos interactivos\n${r.elements}`; }
      case 'read': { const r = await b.read({ maxChars: 14000, offset: a.offset || 0 }); return `Página: ${r.title}\nURL: ${r.url}\nScroll: ${r.scrollY}/${r.scrollHeight}px${r.more ? `\nTexto mostrado: caracteres ${r.from}-${r.to} de ${r.total} (continúa con offset=${r.to})` : ''}\n\n## Contenido\n${r.text}\n\n## Elementos interactivos\n${r.elements}`; }
      case 'find': return await b.find(a.text || a.value || '');
      case 'hover': { await b.hover(a.index); return `Ratón sobre [${a.index}]`; }
      case 'fill': return await b.fill(a.fields || []);
      case 'select': return await b.select(a.index, a.value ?? a.text ?? '');
      case 'wait': return await b.wait({ seconds: a.seconds, text: a.text });
      case 'console': return b.consoleLog();
      case 'click': { const s = await b.click(a.index); const r = await b.read({ maxChars: 5000 }); return `Clic en [${a.index}]. ${summary(s)}\n\n## Contenido\n${r.text}\n\n## Elementos interactivos\n${r.elements}`; }
      case 'type': { const s = await b.type(a.index, a.text || '', a.submit); if (a.submit) { const r = await b.read({ maxChars: 5000 }); return `Escrito y enviado. ${summary(s)}\n\n## Contenido\n${r.text}\n\n## Elementos interactivos\n${r.elements}`; } return `Texto escrito en [${a.index}]`; }
      case 'press': { const s = await b.press(a.key || 'Enter'); return `Tecla ${a.key || 'Enter'} pulsada. ${summary(s)}`; }
      case 'scroll': { await b.scroll(a.direction || 'down', a.amount || 1); const r = await b.read({ maxChars: 6000 }); return `Desplazado. Scroll ${r.scrollY}/${r.scrollHeight}\n\n${r.text}\n\n## Elementos\n${r.elements}`; }
      case 'back': return summary(await b.back());
      case 'forward': return summary(await b.forward());
      case 'screenshot': { const img = await b.screenshot(); return { text: 'Captura del navegador', images: [img] }; }
      case 'evaluate': return truncate(await b.evaluate(a.script || ''), 20000);
      default: throw new Error('Acción desconocida');
    }
}
