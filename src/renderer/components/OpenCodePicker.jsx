import { useEffect, useMemo, useRef, useState } from 'react';
import { call } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import Icon from './Icon.jsx';
import { Popover } from './ui.jsx';

// Modelos de OpenCode (con sus niveles de pensamiento) y su estado (último modelo y nivel usados en OpenCode),
// compartidos entre el selector de modelo y el de pensamiento.
let loading = null;
export function useOpenCodeInfo(active) {
  const info = useStore((s) => s.opencodeInfo);
  useEffect(() => {
    if (!active || info?.models || loading) return;
    loading = Promise.all([call('opencode.models').catch((e) => ({ error: e.message })), call('opencode.state').catch(() => null)])
      .then(([models, state]) => useStore.setState({ opencodeInfo: Array.isArray(models) ? { models, state } : { error: models.error, state } }))
      .finally(() => { loading = null; });
  }, [active, !!info?.models]);
  return info || {};
}
export async function refreshOpenCodeInfo() {
  const [models, state] = await Promise.all([call('opencode.models', true), call('opencode.state')]);
  useStore.setState({ opencodeInfo: { models, state } });
}

// Selector de modelo para el agente OpenCode: todos los modelos de OpenCode (nube y proveedores por API).
// Los modelos locales se usan con los agentes de Nexo.
export default function OpenCodePicker({ value, onChange, chatId }) {
  const btn = useRef(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [prov, setProvState] = useState(() => { try { return localStorage.getItem('oc.provider') || ''; } catch { return ''; } });
  const setProv = (p) => { setProvState(p); try { localStorage.setItem('oc.provider', p); } catch { } };
  const [onlyFree, setOnlyFree] = useState(false);
  const [folded, setFolded] = useState({});
  const info = useOpenCodeInfo(true);
  const models = info.models;
  const providers = useMemo(() => { const c = new Map(); for (const m of models || []) c.set(m.provider, (c.get(m.provider) || 0) + 1); return [...c]; }, [models]);
  const byId = useMemo(() => new Map((models || []).map((m) => [m.id, m])), [models]);
  const last = info.state?.last;
  const nameOf = (id) => byId.get(id)?.label || id?.split('/').slice(1).join('/') || id;
  const groups = useMemo(() => {
    const ql = q.toLowerCase();
    const match = (m) => (!prov || m.provider === prov) && (!onlyFree || m.free) && (!ql || m.id.toLowerCase().includes(ql) || m.label.toLowerCase().includes(ql));
    const out = [];
    const recent = (info.state?.recent || []).map((id) => byId.get(id)).filter((m) => m && match(m));
    if (recent.length && !prov) out.push(['Recientes en OpenCode', recent]);
    const byProv = new Map();
    for (const m of models || []) { if (!match(m)) continue; if (!byProv.has(m.provider)) byProv.set(m.provider, []); byProv.get(m.provider).push(m); }
    for (const [p, l] of byProv) out.push([p, l]);
    return out;
  }, [models, q, info.state, byId, prov, onlyFree]);
  const custom = value && value !== 'nexo:local';
  const label = custom ? nameOf(value) : `Como en OpenCode${last ? ` · ${nameOf(last)}` : ''}`;
  const pick = (v) => { onChange(v); setOpen(false); };
  const Row = ({ m }) => (
    <button className="menu-item" onClick={() => pick(m.id)} title={m.id}>
      <span className="grow" style={{ minWidth: 0 }}>
        <div className="ellipsis small" style={{ color: 'var(--text)' }}>{m.label}</div>
        <div className="tiny muted ellipsis">{m.id}{m.free ? ' · gratis' : ''}{m.variants.length ? ` · ${m.variants.length} niveles de pensamiento` : ''}</div>
      </span>
      {value === m.id && <Icon name="check" size={14} />}
    </button>
  );
  return (
    <>
      <button ref={btn} className="picker-btn flat" onClick={() => setOpen(!open)} title="Modelo que usará OpenCode">
        <Icon name="terminal" size={13} /><span className="ellipsis" style={{ maxWidth: 240 }}>{label}</span><Icon name="chevron-down" size={14} className="faint" />
      </button>
      {open && (
        <Popover anchor={btn.current} onClose={() => setOpen(false)} width={380} maxHeight={540} align="right" placement="top">
          <div className="popover-search" style={{ padding: 8 }}><input className="input" autoFocus placeholder="Buscar modelo de OpenCode…" value={q} onChange={(e) => setQ(e.target.value)} style={{ height: 32 }} /></div>
          <button className="menu-item" onClick={() => pick('')}>
            <Icon name="terminal" size={14} />
            <span className="grow">Como en OpenCode<div className="tiny muted">{last ? `Tu último modelo en OpenCode: ${nameOf(last)}${info.state?.variants?.[last] ? ` (${info.state.variants[last]})` : ''}` : 'El predeterminado de OpenCode'}</div></span>
            {!custom && <Icon name="check" size={14} />}
          </button>
          {providers.length > 0 && (
            <div className="row" style={{ flexWrap: 'wrap', gap: 4, padding: '4px 8px 6px' }}>
              <button className={`chip${!prov ? ' on' : ''}`} style={{ height: 24 }} onClick={() => setProv('')}>Todos</button>
              {providers.map(([p, n]) => <button key={p} className={`chip${prov === p ? ' on' : ''}`} style={{ height: 24 }} onClick={() => setProv(prov === p ? '' : p)}>{p} <span className="faint">{n}</span></button>)}
              <button className={`chip${onlyFree ? ' on' : ''}`} style={{ height: 24 }} onClick={() => setOnlyFree(!onlyFree)}>Gratis</button>
            </div>
          )}
          <div className="menu-sep" />
          {info.error && <div className="small" style={{ padding: '6px 12px', color: 'var(--red)' }}>{info.error}</div>}
          {!models && !info.error && <div className="row small muted" style={{ padding: '8px 12px' }}><span className="spinner sm" />Consultando los modelos de OpenCode…</div>}
          {groups.map(([g, list]) => (
            <div key={g}>
              <button className="menu-label row" style={{ width: '100%', background: 'none', border: 0, cursor: 'pointer', gap: 4 }} onClick={() => setFolded((f) => ({ ...f, [g]: !f[g] }))}>
                <Icon name="chevron-down" size={12} style={{ transform: folded[g] ? 'rotate(-90deg)' : 'none' }} />{g} · {list.length}
              </button>
              {!folded[g] && list.slice(0, q || prov ? 400 : 60).map((m) => <Row key={g + m.id} m={m} />)}
              {!folded[g] && !q && !prov && list.length > 60 && <div className="tiny muted" style={{ padding: '2px 12px 6px' }}>…y {list.length - 60} más (elige el proveedor arriba o usa el buscador)</div>}
            </div>
          ))}
          <div className="menu-sep" />
          <div className="row" style={{ padding: '6px 8px', gap: 6 }}>
            <button className="btn sm ghost" disabled={busy} onClick={async () => { setBusy(true); try { await refreshOpenCodeInfo(); } catch (e) { useStore.getState().toast(e.message, 'error'); } setBusy(false); }}><Icon name="refresh" size={13} />{busy ? 'Actualizando…' : 'Actualizar lista'}</button>
            {chatId && <button className="btn sm ghost" onClick={async () => { await call('opencode.newSession', chatId); useStore.getState().toast('La próxima orden empezará una sesión nueva de OpenCode', 'success'); setOpen(false); }}><Icon name="plus" size={13} />Sesión nueva</button>}
          </div>
        </Popover>
      )}
    </>
  );
}
