import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../lib/store.js';
import { call, fmtBytes } from '../lib/api.js';
import Icon from './Icon.jsx';
import { Popover } from './ui.jsx';
import { useModelOptions, FitPill } from './ModelPicker.jsx';
import { staticBudget } from '../../shared/fit.js';
import { rankForTask, taskForAgent } from '../../shared/tasks.js';

function getModelScore(m, agent) {
  const needsVision = agent.tools?.includes('computer');
  const needsTools = agent.tools?.length > 0;
  
  let caps = {};
  if (m.local) {
    caps = { vision: m.caps?.includes('vision'), tools: m.caps?.includes('tools') };
  } else {
    const n = m.name.toLowerCase();
    caps = {
      vision: n.includes('vision') || n.includes('vl') || n.includes('gpt-4o') || n.includes('gpt-4-turbo') || n.includes('claude-3') || n.includes('gemini-1.5') || n.includes('gemini-2.5'),
      tools: !n.includes('reasoner') && !n.includes('r1') && !n.includes('o1') && !n.includes('o3')
    };
  }

  let score = 0;
  let matches = true;

  if (needsVision && !caps.vision) { score -= 1000; matches = false; }
  if (needsTools && !caps.tools) { score -= 100; matches = false; }

  if (m.local && m.plan) {
    if (m.plan.fits && m.plan.tps >= 10) score += 200;
    else if (m.plan.fits && m.plan.tps >= 4) score += 100;
    else if (!m.plan.fits) score -= 2000;
  }

  if (!m.local) {
    const n = m.name.toLowerCase();
    if (n.includes('gpt-4o') || n.includes('sonnet') || n.includes('gemini-2.5-pro')) score += 150;
    else score += 50;
  }
  
  return { ...m, score, matches };
}

function AgentItem({ agent, isSelected, onChange, close, catalog }) {
  const [expanded, setExpanded] = useState(false);
  const options = useModelOptions();
  
  const recommended = useMemo(() => {
    if (!expanded) return [];
    const all = options.flatMap(g => g.items);
    let scored = all.map(m => getModelScore(m, agent));
    scored = scored.filter(m => m.score > -1000);
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 3);
  }, [expanded, options, agent]);

  const installable = useMemo(() => {
    if (!expanded || !catalog?.models) return [];
    const hw = useStore.getState().hw;
    const budget = hw ? staticBudget(hw) : null;
    if (!budget) return [];
    // Ranking por la tarea del agente (programar, navegar, controlar el PC...)
    const localNames = useStore.getState().localModels.map(l => l.repo);
    return rankForTask(catalog.models, taskForAgent(agent), budget)
      .filter(r => !localNames.includes(r.m.repo))
      .slice(0, 2)
      .map(r => ({ ...r.m, plan: r.plan, matches: true, why: r.why }));
  }, [expanded, catalog, agent]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', borderBottom: '1px solid var(--border)' }}>
      <div className="row" style={{ gap: 0, alignItems: 'flex-start' }}>
        <button className="menu-item" style={{ alignItems: 'flex-start', borderBottom: 'none' }} onClick={() => { onChange(agent.id, null); close(); }}>
          <span className="agent-dot" style={{ background: agent.color, width: 26, height: 26, borderRadius: 8, display: 'grid', placeItems: 'center', color: '#fff', flex: 'none' }}><Icon name={agent.icon || 'bot'} size={14} /></span>
          <span className="grow"><div style={{ color: 'var(--text)', fontWeight: 560 }}>{agent.name}</div><div className="tiny muted">{agent.description}</div></span>
          {isSelected && <Icon name="check" size={15} style={{ marginTop: 6, color: 'var(--accent-2)' }} />}
        </button>
        <button className="icon-btn sm" style={{ marginTop: 6 }} title="Modelos recomendados para este agente" onClick={() => setExpanded(!expanded)}><Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={14} /></button>
      </div>
      
      {expanded && (
        <div style={{ padding: '0 10px 10px 42px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="tiny muted" style={{ textTransform: 'uppercase', fontWeight: 600 }}>Disponibles (ya configurados)</div>
          {recommended.length > 0 ? recommended.map(m => (
            <button key={m.ref} className="chip" style={{ justifyContent: 'flex-start', textAlign: 'left', height: 'auto', padding: '6px 10px' }} onClick={() => { onChange(agent.id, m.ref); close(); }}>
              <Icon name={m.local ? 'disk' : 'cloud'} size={12} className="muted" />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="ellipsis" style={{ fontSize: 12, fontWeight: 550, color: 'var(--text)' }}>{m.name}</div>
                <div className="row tiny muted" style={{ gap: 6 }}>
                  {m.local && m.plan ? <FitPill plan={m.plan} showTps={false} /> : <span className="ellipsis">{m.sub}</span>}
                  {m.matches && m.local && <Icon name="zap" size={10} style={{ color: 'var(--amber)' }} title="Compatible con requisitos del agente" />}
                </div>
              </div>
            </button>
          )) : <div className="tiny muted" style={{ marginBottom: 4 }}>No hay modelos instalados compatibles con las capacidades que requiere este agente.</div>}
          
          {installable.length > 0 && (
            <>
              <div className="tiny muted" style={{ textTransform: 'uppercase', fontWeight: 600, marginTop: 4 }}>Recomendados para descargar</div>
              {installable.map(m => (
                <button key={m.id} className="chip" style={{ justifyContent: 'flex-start', textAlign: 'left', height: 'auto', padding: '6px 10px', background: 'var(--surface-3)' }} onClick={() => { close(); useStore.getState().setView('models', { modelsTab: 'discover' }); setTimeout(() => window.dispatchEvent(new CustomEvent('search-model', { detail: m.repo })), 100); }}>
                  <Icon name="download" size={12} className="muted" />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="ellipsis" style={{ fontSize: 12, fontWeight: 550, color: 'var(--text)' }}>{m.name}</div>
                    <div className="row tiny muted" style={{ gap: 6 }}>
                      {m.plan ? <FitPill plan={m.plan} showTps={false} /> : <span className="ellipsis">{fmtBytes(m.approxSize)}</span>}
                      {m.matches && <Icon name="zap" size={10} style={{ color: 'var(--amber)' }} title="Compatible con requisitos del agente" />}
                    </div>
                    {m.why && <div className="tiny muted" style={{ whiteSpace: 'normal' }}>{m.why}</div>}
                  </div>
                </button>
              ))}
            </>
          )}

          <button className="btn sm ghost" style={{ marginTop: 4, alignSelf: 'flex-start' }} onClick={() => { onChange(agent.id, null); close(); }}>Usar agente con modelo actual</button>
        </div>
      )}
    </div>
  );
}

export default function AgentPicker({ value, onChange, compact }) {
  const agents = useStore((s) => s.agents);
  const btn = useRef(null);
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState(null);
  const a = agents.find((x) => x.id === value) || agents[0];
  
  useEffect(() => {
    if (open && !catalog) call('catalog.get').then(setCatalog).catch(() => {});
  }, [open]);

  return (
    <>
      <button ref={btn} className={`picker-btn ${compact ? 'flat' : ''}`} onClick={() => setOpen(!open)} title="Agente">
        <span className="agent-dot" style={{ background: a?.color }}><Icon name={a?.icon || 'bot'} size={12} /></span>
        <span className="ellipsis">{a?.name || 'Agente'}</span><Icon name="chevron-down" size={14} className="faint" />
      </button>
      {open && (
        <Popover anchor={btn.current} onClose={() => setOpen(false)} width={380} maxHeight={560}>
          <div className="menu-label">Agentes</div>
          {agents.map((x) => (
            <AgentItem key={x.id} agent={x} isSelected={x.id === value} onChange={onChange} close={() => setOpen(false)} catalog={catalog} />
          ))}
          <div className="menu-sep" />
          <button className="menu-item" onClick={() => { setOpen(false); useStore.getState().setView('agents'); }}><Icon name="plus" size={15} />Crear o editar agentes</button>
        </Popover>
      )}
    </>
  );
}
