import { useEffect, useState } from 'react';
import { useStore } from '../lib/store.js';
import { call } from '../lib/api.js';
import Icon from './Icon.jsx';
import { IconButton, Menu, Confirm } from './ui.jsx';

const NAV = [
  ['models', 'Modelos', 'models'], ['agents', 'Agentes', 'bot'], ['skills', 'Skills', 'skills'], ['mcp', 'MCP', 'plug'], ['hardware', 'Equipo', 'cpu']
];

function groupChats(chats) {
  const now = new Date(); const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const groups = { Fijados: [], Hoy: [], Ayer: [], 'Últimos 7 días': [], 'Últimos 30 días': [], Anteriores: [] };
  for (const c of chats) {
    if (c.pinned) groups.Fijados.push(c);
    else if (c.updatedAt >= today) groups.Hoy.push(c);
    else if (c.updatedAt >= today - 864e5) groups.Ayer.push(c);
    else if (c.updatedAt >= today - 7 * 864e5) groups['Últimos 7 días'].push(c);
    else if (c.updatedAt >= today - 30 * 864e5) groups['Últimos 30 días'].push(c);
    else groups.Anteriores.push(c);
  }
  return Object.entries(groups).filter(([, v]) => v.length);
}

export function userName(info) {
  const base = (info?.home || '').split(/[\\/]/).filter(Boolean).pop() || 'Tú';
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function Recents({ search }) {
  const { chats, currentChatId, running, view, openChat, updateChat, deleteChat } = useStore();
  const [results, setResults] = useState(null);
  const [menu, setMenu] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  useEffect(() => {
    if (!search.trim()) { setResults(null); return; }
    const t = setTimeout(() => call('chats.search', search.trim()).then(setResults), 200);
    return () => clearTimeout(t);
  }, [search]);
  const list = results || chats;
  return (
    <div className="chat-list">
      {(results ? [['Resultados', list]] : groupChats(list)).map(([g, items]) => (
        <div key={g}>
          <div className="chat-group">{g}</div>
          {items.map((c) => (
            <div key={c.id} className={`chat-item ${c.id === currentChatId && view === 'chat' ? 'active' : ''}`} onClick={() => renaming !== c.id && openChat(c.id)} onDoubleClick={() => setRenaming(c.id)}>
              {running.has(c.id) ? <span className="running" /> : c.mode === 'compare' ? <Icon name="columns" size={13} className="faint" /> : c.mode === 'pipeline' ? <Icon name="workflow" size={13} className="faint" /> : c.pinned ? <Icon name="pin" size={12} className="faint" /> : null}
              {renaming === c.id ? (
                <input className="input rename" autoFocus defaultValue={c.title} onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => { updateChat(c.id, { title: e.target.value || c.title }); setRenaming(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setRenaming(null); }} />
              ) : (
                <span className="title" title={c.match || c.title}>{c.title}{results && c.match && <div className="tiny muted ellipsis">{c.match}</div>}</span>
              )}
              <span className="actions"><IconButton icon="more" size={14} className="sm" onClick={(e) => { e.stopPropagation(); setMenu({ el: e.currentTarget, chat: c }); }} /></span>
            </div>
          ))}
        </div>
      ))}
      {!list.length && <div className="small muted" style={{ padding: 16, textAlign: 'center' }}>{results ? 'Sin resultados' : 'Aún no hay conversaciones'}</div>}
      {menu && <Menu anchor={menu.el} onClose={() => setMenu(null)} items={[
        { icon: 'pencil', label: 'Renombrar', onClick: () => setRenaming(menu.chat.id) },
        { icon: menu.chat.pinned ? 'pin-off' : 'pin', label: menu.chat.pinned ? 'Desfijar' : 'Fijar', onClick: () => updateChat(menu.chat.id, { pinned: !menu.chat.pinned }) },
        { icon: 'file-down', label: 'Exportar a Markdown', onClick: () => call('chats.export', menu.chat.id) },
        '-',
        { icon: 'trash', label: 'Eliminar', danger: true, onClick: () => setConfirmDel(menu.chat) }
      ]} />}
      {confirmDel && <Confirm title="Eliminar chat" text={`¿Eliminar "${confirmDel.title}"? No se puede deshacer.`} danger confirmLabel="Eliminar" onConfirm={() => deleteChat(confirmDel.id)} onClose={() => setConfirmDel(null)} />}
    </div>
  );
}

export default function Sidebar() {
  const { info, view, setView, settings, sidebarOpen, newChat } = useStore();
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [menu, setMenu] = useState(null);
  const toggleTheme = async () => { const n = await useStore.getState().saveSettings({ theme: settings.theme === 'light' ? 'dark' : 'light' }); call('app.setTheme', n.theme); };
  const name = userName(info);
  const open = sidebarOpen;
  const item = (key, label, icon, onClick, active) => (
    <button key={key} className={`side-item ${active ? 'active' : ''}`} onClick={onClick} title={open ? undefined : label}>
      <Icon name={icon} size={17} /><span className="side-label">{label}</span>
    </button>
  );
  return (
    <aside className={`side ${open ? '' : 'mini'}`}>
      <div className="side-top">
        {open && <div className="side-brand"><span className="logo-mark" /><span>Nexo</span></div>}
        <IconButton icon="panel-left" title={open ? 'Ocultar barra lateral (Ctrl B)' : 'Mostrar barra lateral (Ctrl B)'} onClick={() => useStore.setState({ sidebarOpen: !open })} />
      </div>
      <button className="side-new" onClick={() => newChat()} title={open ? undefined : 'Nuevo chat (Ctrl N)'}>
        <span className="plus"><Icon name="plus" size={15} strokeWidth={2.4} /></span><span className="side-label">Nuevo chat</span>
      </button>
      <nav className="side-nav">
        {item('search', 'Buscar', 'search', () => { if (!open) useStore.setState({ sidebarOpen: true }); setSearching(!searching || !open); setView('chat'); }, false)}
        {item('chats', 'Chats', 'chat', () => { useStore.getState().openChat(null); }, view === 'chat')}
        {NAV.map(([k, label, icon]) => item(k, label, icon, () => setView(k), view === k))}
      </nav>
      {open && (
        <>
          {searching && (
            <div className="sidebar-search"><Icon name="search" size={14} /><input className="input" autoFocus placeholder="Buscar en chats" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { setSearch(''); setSearching(false); } }} /></div>
          )}
          <div className="side-section">Recientes</div>
          <Recents search={search} />
        </>
      )}
      {!open && <span className="grow" />}
      <div className="side-foot">
        <button className="side-user" onClick={(e) => setMenu(e.currentTarget)} title={open ? undefined : name}>
          <span className="avatar-initial">{name.charAt(0)}</span>
          <span className="side-label grow" style={{ textAlign: 'left' }}><span className="ellipsis" style={{ display: 'block' }}>{name}</span><span className="tiny muted">Nexo AI {info?.version}</span></span>
          {open && <Icon name="chevron-up" size={14} className="faint" />}
        </button>
      </div>
      {menu && <Menu anchor={menu} onClose={() => setMenu(null)} width={240} items={[
        { icon: 'settings', label: 'Ajustes', hint: 'Ctrl ,', onClick: () => setView('settings') },
        { icon: settings?.theme === 'light' ? 'moon' : 'sun', label: settings?.theme === 'light' ? 'Tema oscuro' : 'Tema claro', onClick: toggleTheme },
        { icon: 'audio-lines', label: 'Conversación por voz', onClick: () => window.dispatchEvent(new CustomEvent('nexo-voice', { detail: 'conversation' })) },
        { icon: 'command', label: 'Paleta de comandos', hint: 'Ctrl K', onClick: () => useStore.setState({ paletteOpen: true }) }
      ]} />}
    </aside>
  );
}
