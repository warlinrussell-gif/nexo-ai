import { useEffect, useState } from 'react';
import { useStore } from './lib/store.js';
import { call, on, fmtBytes, nexo } from './lib/api.js';
import Icon from './components/Icon.jsx';
import { IconButton, Popover } from './components/ui.jsx';
import ChatView from './views/ChatView.jsx';
import ModelsView, { DownloadRow } from './views/ModelsView.jsx';
import AgentsView from './views/AgentsView.jsx';
import SkillsView from './views/SkillsView.jsx';
import McpView from './views/McpView.jsx';
import HardwareView from './views/HardwareView.jsx';
import SettingsView from './views/SettingsView.jsx';
import Setup from './views/Setup.jsx';
import Sidebar from './components/Sidebar.jsx';
import ApprovalModal from './components/ApprovalModal.jsx';
import QuestionModal from './components/QuestionModal.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import VoiceController, { JarvisPill } from './components/Voice.jsx';
import { staticBudget } from '../shared/fit.js';

function Meters() {
  const { instances, hw } = useStore();
  const [live, setLive] = useState(null);
  useEffect(() => {
    let alive = true;
    const tick = () => call('hw.live').then((l) => alive && setLive(l)).catch(() => { });
    tick();
    const t = setInterval(tick, 4000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  if (!live) return null;
  const ramUsed = live.ram.total - live.ram.free;
  const g = live.gpus?.[0];
  const budget = hw ? staticBudget(hw) : null;
  const modelVram = instances.reduce((a, i) => a + (i.plan?.gpuBytes || 0), 0);
  const vramUsed = g ? g.used : modelVram;
  const vramTotal = g ? g.vram : (budget?.hasGpu ? budget.vram : 0);
  const color = (p) => (p > 0.9 ? 'var(--red)' : p > 0.75 ? 'var(--amber)' : 'var(--accent)');
  return (
    <div className="titlebar-meters no-drag" title={`${instances.length} modelos cargados`}>
      {vramTotal > 0 && <div className="m"><span>VRAM</span><div className="meter sm"><span style={{ width: `${(vramUsed / vramTotal) * 100}%`, background: color(vramUsed / vramTotal) }} /></div><span>{fmtBytes(vramUsed)}</span></div>}
      <div className="m"><span>RAM</span><div className="meter sm"><span style={{ width: `${(ramUsed / live.ram.total) * 100}%`, background: color(ramUsed / live.ram.total) }} /></div><span>{fmtBytes(ramUsed)}</span></div>
    </div>
  );
}

function DownloadsButton() {
  const downloads = useStore((s) => s.downloads);
  const [anchor, setAnchor] = useState(null);
  const active = Object.values(downloads).filter((d) => ['downloading', 'queued', 'paused', 'error', 'installing'].includes(d.status));
  if (!active.length) return null;
  const total = active.reduce((a, d) => a + (d.total || 0), 0);
  const rec = active.reduce((a, d) => a + (d.received || 0), 0);
  const pct = total ? rec / total : 0;
  return (
    <>
      <button className="icon-btn no-drag dl-indicator" title="Descargas" onClick={(e) => setAnchor(e.currentTarget)} style={{ position: 'relative' }}>
        <svg width="26" height="26" viewBox="0 0 36 36" style={{ position: 'absolute' }}><circle cx="18" cy="18" r="15" fill="none" stroke="var(--surface-3)" strokeWidth="3" /><circle cx="18" cy="18" r="15" fill="none" stroke="var(--accent)" strokeWidth="3" strokeDasharray={`${pct * 94.2} 94.2`} transform="rotate(-90 18 18)" strokeLinecap="round" /></svg>
        <Icon name="download" size={13} />
      </button>
      {anchor && <Popover anchor={anchor} onClose={() => setAnchor(null)} align="right" width={420}><div className="menu-label">Descargas</div>{active.map((d) => <DownloadRow key={d.id} d={d} />)}</Popover>}
    </>
  );
}

function Lightbox() {
  const src = useStore((s) => s.lightbox);
  if (!src) return null;
  return <div className="lightbox" onClick={() => useStore.setState({ lightbox: null })}><img src={src} /></div>;
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.type}`}>
          <Icon name={t.type === 'error' ? 'alert' : t.type === 'success' ? 'check-circle' : 'info'} size={16} style={{ color: t.type === 'error' ? 'var(--red)' : t.type === 'success' ? 'var(--green)' : 'var(--accent-2)', marginTop: 1, flex: 'none' }} />
          <span className="selectable" style={{ whiteSpace: 'pre-wrap' }}>{t.text}</span>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const { info, view, setView, settings, setupActive, sidebarOpen } = useStore();
  const isMac = nexo.platform === 'darwin';

  useEffect(() => {
    const k = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); useStore.setState((s) => ({ paletteOpen: !s.paletteOpen })); }
      else if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); useStore.getState().newChat(); }
      else if (mod && e.key === ',') { e.preventDefault(); setView('settings'); }
      else if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); useStore.setState((s) => ({ sidebarOpen: !s.sidebarOpen })); }
      else if (e.key === 'Escape') {
        const st = useStore.getState();
        if (st.currentChatId && st.running.has(st.currentChatId) && !st.approvals.length && !st.paletteOpen && st.voice.mode !== 'conversation' && !document.querySelector('.backdrop, .drawer-wrap, .popover')) call('chats.stop', st.currentChatId);
      }
    };
    window.addEventListener('keydown', k);
    const off = on('command', (cmd) => { if (cmd === 'new-chat') useStore.getState().newChat(); });
    return () => { window.removeEventListener('keydown', k); off(); };
  }, []);

  if (!info) return <div className="setup"><div className="orb" /></div>;
  const titlebar = (
    <div className={`titlebar ${isMac ? 'mac' : ''}`}>
      {(!info.configured || setupActive) && <div className="brand"><div className="logo-mark" />Nexo AI</div>}
      <span className="spacer" />
      {info.configured && !setupActive && <button className="search-trigger no-drag" onClick={() => useStore.setState({ paletteOpen: true })}><Icon name="search" size={14} />Buscar o ejecutar…<kbd>Ctrl K</kbd></button>}
      <span className="spacer" />
      <JarvisPill />
      {info.configured && !setupActive && <Meters />}
      <DownloadsButton />
      {!isMac && <div className="win-controls-space" />}
    </div>
  );
  if (setupActive || !info.configured) return <div className="app">{titlebar}<Setup /><Toasts /></div>;
  if (!settings) return <div className="app">{titlebar}<div className="setup"><div className="orb" /></div></div>;

  return (
    <div className={`app ${sidebarOpen ? '' : 'side-mini'}`}>
      {titlebar}
      <div className="body">
        <Sidebar />
        <main className="main">
          <div className="view" style={{ display: view === 'chat' ? 'flex' : 'none' }}><ChatView /></div>
          {view === 'models' && <div className="view"><ModelsView /></div>}
          {view === 'agents' && <div className="view"><AgentsView /></div>}
          {view === 'skills' && <div className="view"><SkillsView /></div>}
          {view === 'mcp' && <div className="view"><McpView /></div>}
          {view === 'hardware' && <div className="view"><HardwareView /></div>}
          {view === 'settings' && <div className="view"><SettingsView /></div>}
        </main>
      </div>
      <ApprovalModal />
      <QuestionModal />
      <CommandPalette />
      <VoiceController />
      <Lightbox />
      <Toasts />
    </div>
  );
}
