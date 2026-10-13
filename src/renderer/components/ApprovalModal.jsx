import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../lib/store.js';
import { call } from '../lib/api.js';
import Icon from './Icon.jsx';
import { toolSummary } from './Message.jsx';

const RISK = {
  exec: { label: 'Ejecuta acciones en el sistema', color: 'var(--red)', icon: 'shield-alert' },
  write: { label: 'Modifica archivos o el sistema', color: 'var(--amber)', icon: 'shield' },
  computer: { label: 'Controla el ratón y el teclado', color: 'var(--amber)', icon: 'mouse-pointer-click' },
  browser: { label: 'Interactúa con páginas web', color: 'var(--blue)', icon: 'globe' },
  read: { label: 'Solo lectura', color: 'var(--green)', icon: 'eye' }
};

export default function ApprovalModal() {
  const approvals = useStore((s) => s.approvals);
  const a = approvals[0];
  useEffect(() => {
    if (!a) return;
    const k = (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) respond('allow');
      if (e.key === 'Escape') respond('deny');
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [a?.id]);
  if (!a) return null;
  function respond(decision) {
    call('approval.respond', a.id, decision);
    useStore.setState((s) => ({ approvals: s.approvals.filter((x) => x.id !== a.id) }));
  }
  const risk = RISK[a.risk] || RISK.exec;
  const summary = toolSummary({ name: a.tool, args: a.args });
  return createPortal(
    <div className="backdrop">
      <div className="modal" style={{ width: 580 }}>
        <div className="modal-head">
          <span style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', background: `color-mix(in oklab, ${risk.color} 16%, transparent)`, color: risk.color }}><Icon name={risk.icon} size={18} /></span>
          <h2>¿Permitir esta acción?</h2>
          {approvals.length > 1 && <span className="badge">{approvals.length} pendientes</span>}
        </div>
        <div className="modal-body">
          <div className="row" style={{ marginBottom: 10, gap: 8 }}>
            <span className="badge accent"><Icon name="wrench" size={12} />{a.server ? `MCP · ${a.server}` : a.tool}</span>
            <span className="risk" style={{ background: `color-mix(in oklab, ${risk.color} 12%, transparent)`, color: risk.color }}>{risk.label}</span>
          </div>
          {summary && <div className="mono small" style={{ marginBottom: 10, color: 'var(--text)', wordBreak: 'break-word' }}>{summary}</div>}
          <div className="approval-args">{a.tool === 'run_command' ? a.args?.command : JSON.stringify(a.args, null, 2)}</div>
          <p className="small muted" style={{ marginBottom: 0 }}>Puedes cambiar el nivel de permisos desde el botón de escudo del compositor o en Ajustes → Permisos.</p>
        </div>
        <div className="modal-foot">
          <button className="btn ghost danger" onClick={() => respond('deny')}>Denegar <kbd>Esc</kbd></button>
          <span className="grow" />
          <button className="btn" onClick={() => respond('always')}>Permitir siempre en este chat</button>
          <button className="btn primary" autoFocus onClick={() => respond('allow')}>Permitir <kbd style={{ background: 'rgba(255,255,255,0.18)', color: '#fff', borderColor: 'transparent' }}>Ctrl+Enter</kbd></button>
        </div>
      </div>
    </div>, document.body);
}
