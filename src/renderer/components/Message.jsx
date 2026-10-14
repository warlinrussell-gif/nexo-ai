import { memo, useState } from 'react';
import Icon, { TOOL_ICONS } from './Icon.jsx';
import { IconButton } from './ui.jsx';
import { renderMarkdown, onMarkdownClick } from '../lib/markdown.js';
import { fileUrl, copyText, fmtBytes, call } from '../lib/api.js';
import { useStore } from '../lib/store.js';

const TOOL_LABELS = {
  read_file: 'Leer archivo', write_file: 'Escribir archivo', edit_file: 'Editar archivo', list_directory: 'Listar carpeta', search_files: 'Buscar archivos', grep: 'Buscar en el código', glob: 'Buscar archivos', multi_edit: 'Editar archivo', tool_search: 'Cargar herramientas', move_path: 'Mover', delete_path: 'Eliminar',
  run_command: 'Terminal', open_app: 'Abrir', system_info: 'Info del sistema', list_processes: 'Procesos', kill_process: 'Terminar proceso', clipboard_read: 'Leer portapapeles', clipboard_write: 'Copiar al portapapeles', notify: 'Notificación',
  computer: 'Control del PC', web_search: 'Búsqueda web', fetch_url: 'Leer página', browser: 'Navegador', memory_save: 'Recordar', memory_forget: 'Olvidar', use_skill: 'Skill', update_plan: 'Plan', delegate_task: 'Delegar',
  process_output: 'Salida de proceso', ask_user: 'Pregunta al usuario'
};
const OC_LABELS = { bash: 'terminal', read: 'leer', write: 'escribir', edit: 'editar', multiedit: 'editar', patch: 'parche', glob: 'buscar archivos', grep: 'buscar texto', list: 'listar', webfetch: 'leer web', websearch: 'buscar en web', todowrite: 'tareas', todoread: 'tareas', task: 'subagente', skill: 'skill' };
const OC_ICONS = { bash: 'terminal', read: 'file', write: 'save', edit: 'pencil', multiedit: 'pencil', patch: 'pencil', glob: 'search', grep: 'search', list: 'folder-open', webfetch: 'globe', websearch: 'search', todowrite: 'list-checks', todoread: 'list-checks', task: 'bot' };

export function toolSummary(b) {
  const a = b.args || {};
  if (b.name?.startsWith('oc:')) {
    const n = b.name.slice(3);
    if (n === 'bash') return `$ ${a.command || ''}`;
    return a.filePath || a.path || a.pattern || a.url || a.query || a.description || b.title || (a.todos ? `${a.todos.length} tareas` : '');
  }
  switch (b.name) {
    case 'ask_user': return a.question;
    case 'process_output': return a.pid ? `PID ${a.pid}` : 'procesos en segundo plano';
    case 'run_command': return `$ ${a.command || ''}`;
    case 'read_file': case 'write_file': case 'edit_file': case 'delete_path': return a.path;
    case 'list_directory': return a.path || 'directorio de trabajo';
    case 'grep': return [`"${a.pattern}"`, a.glob, a.path && `en ${a.path}`].filter(Boolean).join(' ');
    case 'glob': return [a.pattern, a.path && `en ${a.path}`].filter(Boolean).join(' ');
    case 'multi_edit': return `${a.path} (${(a.edits || []).length} cambios)`;
    case 'tool_search': return a.query;
    case 'search_files': return [a.pattern, a.content && `"${a.content}"`, a.path && `en ${a.path}`].filter(Boolean).join(' ');
    case 'move_path': return `${a.from} → ${a.to}`;
    case 'open_app': return a.target;
    case 'web_search': return a.query;
    case 'fetch_url': return a.url;
    case 'computer': {
      const map = { screenshot: 'Captura de pantalla', click: 'Clic', double_click: 'Doble clic', triple_click: 'Triple clic', right_click: 'Clic derecho', middle_click: 'Clic central', move: 'Mover ratón', drag: 'Arrastrar', type: 'Escribir', key: 'Teclas', scroll: 'Desplazar', wait: 'Esperar', cursor_position: 'Posición del cursor' };
      const extra = a.action === 'type' ? `"${String(a.text || '').slice(0, 60)}"` : a.action === 'key' ? a.keys || a.text : a.x !== undefined ? `(${Math.round(a.x)}, ${Math.round(a.y)})` : a.direction || '';
      return `${map[a.action] || a.action} ${extra || ''}`;
    }
    case 'browser': return `${a.action}${a.url ? ' ' + a.url : ''}${a.index !== undefined ? ` [${a.index}]` : ''}${a.text ? ` "${String(a.text).slice(0, 40)}"` : ''}`;
    case 'delegate_task': return `${a.agent}: ${String(a.task || '').slice(0, 90)}`;
    case 'use_skill': return a.name;
    case 'memory_save': return a.fact;
    case 'clipboard_write': return String(a.text || '').slice(0, 60);
    case 'kill_process': return a.pid || a.name;
    default: {
      if (b.name?.startsWith('mcp__')) { const s = JSON.stringify(a); return s.length > 2 ? s.slice(0, 120) : ''; }
      return '';
    }
  }
}

function toolLabel(name, server) {
  if (name?.startsWith('oc:')) return `OpenCode · ${OC_LABELS[name.slice(3)] || name.slice(3)}`;
  if (name?.startsWith('mcp__')) { const parts = name.split('__'); return `${server || parts[1]} · ${parts.slice(2).join('__')}`; }
  return TOOL_LABELS[name] || name;
}

const Markdown = memo(function Markdown({ text, streaming }) {
  return <div className={`md ${streaming ? 'cursor-blink' : ''}`} onClick={onMarkdownClick} dangerouslySetInnerHTML={{ __html: renderMarkdown(text, streaming) }} />;
});

function Reasoning({ block, active, defaultOpen }) {
  const secs = block.startedAt && !active ? '' : '';
  return (
    <details className="think" open={defaultOpen || undefined}>
      <summary><Icon name="chevron-right" size={14} className="chev" /><Icon name="brain" size={14} />{active ? <span className="row" style={{ gap: 6 }}>Pensando<span className="typing" style={{ padding: 0 }}><span /><span /><span /></span></span> : `Razonamiento${secs}`}<span className="faint tiny">· {Math.round((block.text || '').length / 4)} tokens aprox.</span></summary>
      <div className="think-body">{block.text}</div>
    </details>
  );
}

function ToolBlock({ block }) {
  const [open, setOpen] = useState(block.status === 'awaiting');
  const setLightbox = (src) => useStore.setState({ lightbox: src });
  const status = block.status;
  const summary = toolSummary(block);
  const icon = TOOL_ICONS[block.name] || (block.name?.startsWith('oc:') ? OC_ICONS[block.name.slice(3)] || 'terminal' : block.name?.startsWith('mcp__') ? 'plug' : 'wrench');
  const dur = block.endedAt && block.startedAt ? ((block.endedAt - block.startedAt) / 1000).toFixed(1) + ' s' : '';
  return (
    <div className={`tool ${status} ${open ? 'open' : ''}`}>
      <div className="tool-head" onClick={() => setOpen(!open)}>
        <Icon name="chevron-right" size={13} className="chev" />
        <span className="tool-icon"><Icon name={icon} size={13} /></span>
        <span className="tool-name">{toolLabel(block.name, block.server)}</span>
        <span className="tool-sum mono">{summary}</span>
        {status === 'running' && <span className="spinner sm" />}
        {status === 'awaiting' && <span className="badge amber">Esperando permiso</span>}
        {status === 'denied' && <span className="badge red">Denegado</span>}
        {status === 'error' && <span className="badge red">Error</span>}
        {status === 'done' && <Icon name="check" size={14} style={{ color: 'var(--green)' }} />}
        {dur && <span className="tiny faint">{dur}</span>}
      </div>
      {block.images?.length > 0 && !open && (
        <div className="tool-body" style={{ paddingTop: 0 }}>
          <div className="tool-shots">{block.images.slice(-1).map((im, i) => <img key={i} src={fileUrl(im.file)} style={{ maxHeight: 120 }} onClick={() => setLightbox(fileUrl(im.file))} />)}</div>
        </div>
      )}
      {open && (
        <div className="tool-body">
          {block.args && Object.keys(block.args).length > 0 && <><div className="lbl">Parámetros</div><pre>{formatArgs(block.name, block.args)}</pre></>}
          {block.error && <><div className="lbl">Error</div><pre style={{ color: 'var(--red)' }}>{block.error}</pre></>}
          {block.result && <><div className="lbl">Resultado</div><pre>{block.result.length > 8000 ? block.result.slice(0, 8000) + '\n…' : block.result}</pre></>}
          {block.images?.length > 0 && <div className="tool-shots">{block.images.map((im, i) => <img key={i} src={fileUrl(im.file)} onClick={() => setLightbox(fileUrl(im.file))} />)}</div>}
        </div>
      )}
      {block.sub && (
        <div className="tool-body">
          <div className="sub-agent">
            <div className="row small muted" style={{ marginBottom: 6 }}><Icon name="bot" size={14} /><strong style={{ color: 'var(--text)' }}>{block.sub.agentName}</strong>{block.sub.modelLabel && <span>· {block.sub.modelLabel}</span>}{block.sub.status === 'running' && <span className="spinner sm" />}</div>
            <Blocks blocks={block.sub.blocks} streaming={block.sub.status === 'running'} nested />
          </div>
        </div>
      )}
    </div>
  );
}

function formatArgs(name, args) {
  if (name === 'run_command') return args.command + (args.cwd ? `\n\n(cwd: ${args.cwd})` : '');
  if (name === 'write_file') return `${args.path}\n\n${String(args.content || '').slice(0, 3000)}${String(args.content || '').length > 3000 ? '\n…' : ''}`;
  return JSON.stringify(args, null, 2);
}

function PlanBlock({ block }) {
  const done = block.items.filter((i) => i.status === 'done').length;
  return (
    <div className="plan-box">
      <div className="row small" style={{ marginBottom: 6, fontWeight: 600 }}><Icon name="list-checks" size={15} />Plan <span className="muted" style={{ fontWeight: 500 }}>{done}/{block.items.length}</span></div>
      {block.items.map((it, i) => (
        <div key={i} className={`plan-item ${it.status}`}>
          {it.status === 'done' ? <Icon name="check-circle" size={15} style={{ color: 'var(--green)', marginTop: 2 }} /> : it.status === 'in_progress' ? <span className="spinner sm" style={{ marginTop: 3 }} /> : <Icon name="circle" size={15} style={{ color: 'var(--faint)', marginTop: 2 }} />}
          <span>{it.text}</span>
        </div>
      ))}
    </div>
  );
}

export function Blocks({ blocks = [], streaming, nested }) {
  const showReasoning = useStore((s) => s.settings?.showReasoning !== false);
  const lastIdx = blocks.length - 1;
  // agrupar herramientas consecutivas del mismo tipo "computer" para compactar
  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === 'text') return b.text?.trim() ? <Markdown key={i} text={b.text} streaming={streaming && i === lastIdx} /> : null;
        if (b.type === 'reasoning') return showReasoning && b.text?.trim() ? <Reasoning key={i} block={b} active={streaming && i === lastIdx} /> : null;
        if (b.type === 'tool') return <ToolBlock key={b.id || i} block={b} />;
        if (b.type === 'plan') return <PlanBlock key={i} block={b} />;
        if (b.type === 'notice') return <div key={i} className="notice">{b.text}</div>;
        if (b.type === 'stage') return <div key={i} className="stage-head"><span className="num">{b.index + 1}</span><strong style={{ color: 'var(--text)' }}>{b.label}</strong><span>· {b.agentName} · {b.modelName}</span></div>;
        return null;
      })}
    </>
  );
}

const STATUS_TEXT = { starting: 'Preparando…', 'loading-model': 'Cargando modelo en memoria…', thinking: 'Pensando…', writing: '', tools: 'Usando herramientas…', waiting: 'En espera…', compacting: 'Compactando la conversación para liberar contexto…' };

function StatusLine({ status }) {
  const t = STATUS_TEXT[status];
  if (!t) return null;
  return <div className="status-line"><span className="spinner sm" />{t}</div>;
}

function Usage({ usage, durationMs }) {
  if (!usage && !durationMs) return null;
  const parts = [];
  if (usage?.tps) parts.push(`${usage.tps} tok/s`);
  if (usage?.output) parts.push(`${usage.output} tokens`);
  if (usage?.firstToken) parts.push(`1er token ${(usage.firstToken / 1000).toFixed(1)} s`);
  if (durationMs) parts.push(`${(durationMs / 1000).toFixed(1)} s`);
  return <span className="msg-stats">{parts.join(' · ')}</span>;
}

export function textOf(blocks = []) { return blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n\n').trim(); }

export default function Message({ msg, index, isLast, running, agent, onRegenerate, onEdit, onSpeak, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(msg.content || '');
  const [copied, setCopied] = useState(false);
  const setLightbox = (src) => useStore.setState({ lightbox: src });

  if (msg.role === 'user') {
    const imgs = (msg.attachments || []).filter((a) => a.kind === 'image');
    const files = (msg.attachments || []).filter((a) => a.kind !== 'image');
    return (
      <div className="msg user">
        <div style={{ maxWidth: '78%', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          {imgs.length > 0 && <div className="attach-thumbs">{imgs.map((a, i) => { const src = a.preview || fileUrl(a.file); return <img key={i} src={src} onClick={() => setLightbox(src)} />; })}</div>}
          {files.length > 0 && <div className="attach-thumbs">{files.map((a, i) => <span key={i} className="file-chip"><Icon name="file" size={14} /><span className="ellipsis">{a.name}</span><span className="faint tiny">{a.size ? fmtBytes(a.size) : ''}</span></span>)}</div>}
          {editing ? (
            <div style={{ width: 560, maxWidth: '100%' }}>
              <textarea className="textarea" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} rows={Math.min(12, draft.split('\n').length + 1)} />
              <div className="row" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
                <button className="btn sm ghost" onClick={() => setEditing(false)}>Cancelar</button>
                <button className="btn sm primary" onClick={() => { setEditing(false); onEdit(index, draft); }}>Enviar</button>
              </div>
            </div>
          ) : msg.content ? <div className="bubble selectable">{msg.content}</div> : null}
          {!editing && !running && (
            <div className="msg-actions">
              <IconButton icon="copy" size={14} className="sm" title="Copiar" onClick={() => copyText(msg.content || '')} />
              {!msg.optimistic && <IconButton icon="pencil" size={14} className="sm" title="Editar y reenviar" onClick={() => { setDraft(msg.content || ''); setEditing(true); }} />}
            </div>
          )}
        </div>
      </div>
    );
  }

  const active = running && isLast;
  const color = agent?.color || 'var(--accent)';
  const variants = msg.variants;
  const fullText = variants ? '' : textOf(msg.blocks);
  return (
    <div className={`msg assistant ${isLast ? 'last' : ''}`}>
      <div className="content">
        {msg.strategy && <div className="meta"><span className="badge outline">{msg.strategy === 'concurrent' ? 'en paralelo' : 'por turnos'}</span></div>}
        {variants ? (
          <div className="variants" style={{ gridTemplateColumns: `repeat(${Math.min(variants.length, 3)}, minmax(0, 1fr))` }}>
            {variants.map((v, i) => (
              <div key={i} className="variant">
                <div className="variant-head"><Icon name="models" size={14} /><strong className="ellipsis">{v.modelName || v.ref?.split(':').slice(1).join(':')}</strong>{['starting', 'loading-model', 'thinking', 'tools', 'writing', 'waiting'].includes(v.status) && active && <span className="spinner sm" />}<span className="grow" /><Usage usage={v.usage} /></div>
                <Blocks blocks={v.blocks} streaming={active && v.status === 'writing'} />
                {active && <StatusLine status={v.status} />}
                {v.error && <div className="error-box">{v.error}</div>}
                {!active && <div className="row" style={{ marginTop: 6 }}><IconButton icon="copy" size={14} className="sm" title="Copiar" onClick={() => copyText(textOf(v.blocks))} /><IconButton icon="volume" size={14} className="sm" title="Leer en voz alta" onClick={() => onSpeak(textOf(v.blocks))} /></div>}
              </div>
            ))}
          </div>
        ) : (
          <>
            <Blocks blocks={msg.blocks} streaming={active && msg.status === 'writing'} />
            {active && <StatusLine status={msg.status} />}
            {active && !msg.blocks?.length && !STATUS_TEXT[msg.status] && <div className="typing"><span /><span /><span /></div>}
          </>
        )}
        {msg.error && <div className="error-box">{msg.error}</div>}
        {msg.status === 'stopped' && <div className="notice">Respuesta detenida.</div>}
        {active && <div className="msg-sign working"><span className="logo-mark sm spin" /></div>}
        {!active && (
          <div className="msg-actions">
            <span className="msg-who" title={msg.modelName || ''}><span className="agent-dot" style={{ background: color }}><Icon name={agent?.icon || 'sparkles'} size={11} /></span>{msg.agentName || 'Nexo'}{msg.modelName && <span className="faint ellipsis" style={{ maxWidth: 260 }}>· {msg.modelName}</span>}</span>
            {!variants && <IconButton icon={copied ? 'check' : 'copy'} size={14} className="sm" title="Copiar" onClick={() => { copyText(fullText); setCopied(true); setTimeout(() => setCopied(false), 1200); }} />}
            {!variants && <IconButton icon="volume" size={14} className="sm" title="Leer en voz alta" onClick={() => onSpeak(fullText)} />}
            {msg.checkpoint > 0 && <IconButton icon="history" size={14} className="sm" title={`Deshacer los cambios en archivos de esta respuesta y las siguientes (${msg.checkpoint} archivo${msg.checkpoint > 1 ? 's' : ''})`} onClick={async () => {
              if (!window.confirm('¿Restaurar los archivos tal como estaban antes de esta respuesta? Se deshacen también los cambios de las respuestas posteriores.')) return;
              try { const r = await call('chats.rewind', useStore.getState().currentChatId, msg.id); useStore.getState().toast(`Restaurados ${r.restored} archivo(s)${r.removed ? ` y eliminados ${r.removed} creado(s)` : ''}`, 'success'); } catch (e) { useStore.getState().toast(e.message, 'error'); }
            }} />}
            {msg.rewound && <span className="badge" title="Los cambios en archivos de esta respuesta se deshicieron">cambios deshechos</span>}
            <IconButton icon="regenerate" size={14} className="sm" title="Regenerar" onClick={() => onRegenerate(index)} />
            <IconButton icon="trash" size={14} className="sm" title="Eliminar mensaje" onClick={() => onDelete(index)} />
            <Usage usage={msg.usage} durationMs={msg.durationMs} />
          </div>
        )}
      </div>
    </div>
  );
}
