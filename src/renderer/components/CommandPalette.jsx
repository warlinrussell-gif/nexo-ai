import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../lib/store.js';
import { call } from '../lib/api.js';
import Icon from './Icon.jsx';

export default function CommandPalette() {
  const { paletteOpen, chats, agents, localModels } = useStore();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [found, setFound] = useState([]);
  const st = useStore.getState;
  const close = () => { useStore.setState({ paletteOpen: false }); setQ(''); setSel(0); };

  useEffect(() => {
    if (!q || q.length < 2) { setFound([]); return; }
    const t = setTimeout(() => call('chats.search', q).then(setFound).catch(() => { }), 180);
    return () => clearTimeout(t);
  }, [q]);

  const items = useMemo(() => {
    const cmds = [
      { icon: 'message-plus', label: 'Nuevo chat', hint: 'Ctrl+N', run: () => st().newChat() },
      { icon: 'audio-lines', label: 'Conversación por voz', run: () => window.dispatchEvent(new CustomEvent('nexo-voice', { detail: 'conversation' })) },
      { icon: 'radio', label: 'Activar/desactivar modo JARVIS', run: () => window.dispatchEvent(new CustomEvent('nexo-voice', { detail: 'jarvis-toggle' })) },
      { icon: 'globe', label: 'Abrir/cerrar navegador', run: () => useStore.setState((s) => ({ browserOpen: !s.browserOpen, view: 'chat' })) },
      { icon: 'download', label: 'Descubrir y descargar modelos', run: () => st().setView('models', { modelsTab: 'discover' }) },
      { icon: 'disk', label: 'Mis modelos', run: () => st().setView('models', { modelsTab: 'local' }) },
      { icon: 'columns', label: 'Planificador multi-modelo', run: () => st().setView('models', { modelsTab: 'multi' }) },
      { icon: 'cpu', label: 'Análisis del equipo', run: () => st().setView('hardware') },
      { icon: 'bot', label: 'Agentes', run: () => st().setView('agents') },
      { icon: 'skills', label: 'Skills', run: () => st().setView('skills') },
      { icon: 'plug', label: 'Servidores MCP', run: () => st().setView('mcp') },
      { icon: 'key', label: 'Proveedores de API', run: () => st().setView('settings', { settingsTab: 'providers' }) },
      { icon: 'settings', label: 'Ajustes', hint: 'Ctrl+,', run: () => st().setView('settings') },
      { icon: 'sun', label: 'Cambiar tema claro/oscuro', run: () => { const s = st().settings; st().saveSettings({ theme: s.theme === 'light' ? 'dark' : 'light' }).then((n) => call('app.setTheme', n.theme)); } },
      { icon: 'power', label: 'Descargar todos los modelos de la memoria', run: () => call('llama.unloadAll') }
    ];
    for (const a of agents) cmds.push({ icon: a.icon || 'bot', label: `Chat nuevo con ${a.name}`, sub: a.description, run: () => st().newChat({ agentId: a.id }) });
    for (const m of localModels) cmds.push({ icon: 'disk', label: `Chat nuevo con ${m.name}`, sub: `${m.quant} · modelo local`, run: () => st().newChat({ model: `local:${m.id}` }) });
    const ql = q.toLowerCase();
    const list = [];
    const chatHits = q ? (found.length ? found : chats.filter((c) => c.title.toLowerCase().includes(ql))) : chats.slice(0, 6);
    for (const c of chatHits.slice(0, 8)) list.push({ icon: 'chat', label: c.title.length > 90 ? c.title.slice(0, 90) + '…' : c.title, sub: c.match || c.preview, run: () => st().openChat(c.id), group: 'Chats' });
    for (const c of cmds.filter((c) => !q || (c.label + ' ' + (c.sub || '')).toLowerCase().includes(ql)).slice(0, 14)) list.push({ ...c, group: 'Acciones' });
    return list;
  }, [q, chats, agents, localModels, found]);

  useEffect(() => { setSel(0); }, [q]);
  if (!paletteOpen) return null;
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); const it = items[sel]; if (it) { close(); it.run(); } }
    else if (e.key === 'Escape') close();
  };
  let lastGroup = null;
  return createPortal(
    <div className="backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="palette">
        <input autoFocus placeholder="Busca chats, modelos, agentes o acciones…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} />
        <div className="results">
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? <div className="menu-label" key={'g' + i}>{it.group}</div> : null;
            lastGroup = it.group;
            return [header, (
              <button key={i} className={`menu-item ${i === sel ? 'focus' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => { close(); it.run(); }}>
                <Icon name={it.icon} size={16} />
                <span className="grow" style={{ minWidth: 0 }}><div className="ellipsis" style={{ color: 'var(--text)' }}>{it.label}</div>{it.sub && <div className="tiny muted ellipsis">{it.sub}</div>}</span>
                {it.hint && <kbd>{it.hint}</kbd>}
              </button>
            )];
          })}
          {!items.length && <div className="muted small" style={{ padding: 16, textAlign: 'center' }}>Sin resultados</div>}
        </div>
      </div>
    </div>, document.body);
}
