import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../lib/store.js';
import { call } from '../lib/api.js';
import Icon from '../components/Icon.jsx';
import { IconButton, Menu, Popover, Seg, Modal, Button, Confirm } from '../components/ui.jsx';
import ModelPicker, { useModelOptions, modelNameFromRef, FitPill } from '../components/ModelPicker.jsx';
import { planModel, staticBudget } from '../../shared/fit.js';
import Message from '../components/Message.jsx';
import Composer from '../components/Composer.jsx';
import BrowserPanel from '../components/BrowserPanel.jsx';
import { getSpeaker } from '../components/Voice.jsx';
import { fmtBytes } from '../lib/api.js';

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

function ChatSidebar() {
  const { chats, currentChatId, running, sidebarOpen, openChat, newChat, updateChat, deleteChat } = useStore();
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [menu, setMenu] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  useEffect(() => {
    if (!q.trim()) { setResults(null); return; }
    const t = setTimeout(() => call('chats.search', q.trim()).then(setResults), 200);
    return () => clearTimeout(t);
  }, [q]);
  const list = results || chats;
  return (
    <aside className={`sidebar ${sidebarOpen ? '' : 'collapsed'}`}>
      <div className="sidebar-top">
        <button className="btn new-chat" onClick={() => newChat()}><Icon name="message-plus" size={16} />Nuevo chat<span className="grow" /><kbd>Ctrl N</kbd></button>
        <div className="sidebar-search"><Icon name="search" size={14} /><input className="input" placeholder="Buscar en chats" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      <div className="chat-list">
        {(results ? [['Resultados', list]] : groupChats(list)).map(([g, items]) => (
          <div key={g}>
            <div className="chat-group">{g}</div>
            {items.map((c) => (
              <div key={c.id} className={`chat-item ${c.id === currentChatId ? 'active' : ''}`} onClick={() => renaming !== c.id && openChat(c.id)} onDoubleClick={() => setRenaming(c.id)}>
                {running.has(c.id) ? <span className="running" /> : c.mode === 'compare' ? <Icon name="columns" size={14} className="faint" /> : c.mode === 'pipeline' ? <Icon name="workflow" size={14} className="faint" /> : c.pinned ? <Icon name="pin" size={13} className="faint" /> : null}
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
      </div>
      {menu && <Menu anchor={menu.el} onClose={() => setMenu(null)} items={[
        { icon: 'pencil', label: 'Renombrar', onClick: () => setRenaming(menu.chat.id) },
        { icon: menu.chat.pinned ? 'pin-off' : 'pin', label: menu.chat.pinned ? 'Desfijar' : 'Fijar', onClick: () => updateChat(menu.chat.id, { pinned: !menu.chat.pinned }) },
        { icon: 'file-down', label: 'Exportar a Markdown', onClick: () => call('chats.export', menu.chat.id) },
        '-',
        { icon: 'trash', label: 'Eliminar', danger: true, onClick: () => setConfirmDel(menu.chat) }
      ]} />}
      {confirmDel && <Confirm title="Eliminar chat" text={`¿Eliminar "${confirmDel.title}"? No se puede deshacer.`} danger confirmLabel="Eliminar" onConfirm={() => deleteChat(confirmDel.id)} onClose={() => setConfirmDel(null)} />}
    </aside>
  );
}

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
    const needsVision = agent.tools?.includes('computer');
    const needsTools = agent.tools?.length > 0;
    
    let opts = catalog.models.map(m => {
      let score = 0;
      let matches = true;
      if (needsVision && !m.caps?.includes('vision')) { score -= 1000; matches = false; }
      if (needsTools && !m.caps?.includes('tools')) { score -= 100; matches = false; }
      
      let bestPlan = null;
      let bestTps = 0;
      if (budget && m.meta) {
         for (const q of m.quants) {
             const plan = planModel(m.meta, budget, { ctx: 8192, fileSize: q.size });
             if (plan.fits && plan.tps > bestTps) {
                 bestTps = plan.tps;
                 bestPlan = plan;
             }
         }
      }
      if (bestPlan && bestTps >= 10) score += 200;
      else if (bestPlan && bestTps >= 4) score += 100;
      else if (!bestPlan) score -= 2000;
      
      score += (m.downloads || 0) / 10000;
      return { ...m, score, matches, plan: bestPlan };
    });
    
    const localNames = useStore.getState().localModels.map(l => l.repo);
    opts = opts.filter(m => m.score > -1000 && !localNames.includes(m.repo));
    opts.sort((a, b) => b.score - a.score);
    return opts.slice(0, 2);
  }, [expanded, catalog, agent]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', borderBottom: '1px solid var(--border)' }}>
      <button className="menu-item" style={{ alignItems: 'flex-start', borderBottom: 'none' }} onClick={() => setExpanded(!expanded)}>
        <span className="agent-dot" style={{ background: agent.color, width: 26, height: 26, borderRadius: 8, display: 'grid', placeItems: 'center', color: '#fff', flex: 'none' }}><Icon name={agent.icon || 'bot'} size={14} /></span>
        <span className="grow"><div style={{ color: 'var(--text)', fontWeight: 560 }}>{agent.name}</div><div className="tiny muted">{agent.description}</div></span>
        {isSelected && <Icon name="check" size={15} style={{ marginTop: 6 }} />}
        <Icon name={expanded ? "chevron-up" : "chevron-down"} size={14} className="faint" style={{ marginTop: 6, marginLeft: 8 }} />
      </button>
      
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

function AgentPicker({ value, onChange }) {
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
      <button ref={btn} className="picker-btn" onClick={() => setOpen(!open)} title="Agente">
        <span className="agent-dot" style={{ background: a?.color }}><Icon name={a?.icon || 'bot'} size={12} /></span>
        <span className="ellipsis">{a?.name || 'Agente'}</span><Icon name="chevron-down" size={14} className="faint" />
      </button>
      {open && (
        <Popover anchor={btn.current} onClose={() => setOpen(false)} width={380}>
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

const PIPELINE_PRESETS = [
  { name: 'Planificar → Ejecutar → Revisar', stages: [{ label: 'Planificar', instruction: 'Analiza la tarea y crea un plan detallado paso a paso, sin ejecutarlo.' }, { label: 'Ejecutar', instruction: 'Sigue el plan de la etapa anterior y realiza la tarea completa.' }, { label: 'Revisar', instruction: 'Revisa críticamente el resultado anterior, corrige errores y entrega la versión final mejorada.' }] },
  { name: 'Borrador → Mejorar', stages: [{ label: 'Borrador rápido', instruction: 'Escribe un primer borrador completo.' }, { label: 'Mejorar', instruction: 'Mejora el borrador: precisión, estructura, estilo y detalle. Entrega solo la versión final.' }] },
  { name: 'Investigar → Redactar', stages: [{ label: 'Investigar', instruction: 'Investiga en la web y recopila datos, cifras y fuentes relevantes.', agentId: 'researcher' }, { label: 'Redactar', instruction: 'Con la investigación anterior, redacta un informe claro, bien estructurado y con fuentes.' }] },
  { name: 'Programar → Probar', stages: [{ label: 'Programar', instruction: 'Implementa la solución completa.', agentId: 'coder' }, { label: 'Probar y corregir', instruction: 'Ejecuta y prueba lo implementado; corrige cualquier error encontrado.', agentId: 'coder' }] }
];

function MultiPlanInfo({ refs }) {
  const [plan, setPlan] = useState(null);
  const localRefs = refs.filter((r) => r?.startsWith('local:'));
  useEffect(() => { if (localRefs.length > 1) call('models.planMulti', localRefs).then(setPlan).catch(() => setPlan(null)); else setPlan(null); }, [localRefs.join('|')]);
  if (!plan) return null;
  const s = plan.strategy;
  return (
    <div className="small" style={{ padding: '8px 10px', borderRadius: 10, background: s === 'concurrent' ? 'color-mix(in oklab, var(--green) 10%, transparent)' : s === 'sequential' ? 'color-mix(in oklab, var(--amber) 10%, transparent)' : 'color-mix(in oklab, var(--red) 10%, transparent)', marginTop: 10 }}>
      <Icon name={s === 'concurrent' ? 'check-circle' : 'info'} size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
      {s === 'concurrent' && <>Los {localRefs.length} modelos locales caben a la vez (GPU {fmtBytes(plan.totalGpu)} · RAM {fmtBytes(plan.totalCpu)}). Se ejecutarán en paralelo.</>}
      {s === 'sequential' && <>No caben todos a la vez; Nexo los cargará y descargará por turnos automáticamente.</>}
      {s === 'impossible' && <>Algún modelo no cabe ni siquiera solo en tu memoria. Elige una cuantización menor.</>}
    </div>
  );
}

function PipelineEditor({ chat, onClose }) {
  const [stages, setStages] = useState(chat.pipeline?.length ? chat.pipeline : PIPELINE_PRESETS[0].stages.map((s) => ({ ...s, model: chat.model })));
  const agents = useStore((s) => s.agents);
  const upd = (i, patch) => setStages(stages.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <Modal title="Flujo multi-modelo por etapas" icon="workflow" wide onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={() => { useStore.getState().updateChat(chat.id, { pipeline: stages, mode: 'pipeline' }); onClose(); }}>Guardar flujo</Button></>}>
      <p className="small muted" style={{ marginTop: 0 }}>Cada etapa usa su propio modelo y agente; el resultado de una etapa se pasa a la siguiente. Ideal para combinar un modelo rápido con uno potente, o local con nube.</p>
      <div className="row wrap" style={{ marginBottom: 14 }}>
        <span className="small muted">Plantillas:</span>
        {PIPELINE_PRESETS.map((p) => <button key={p.name} className="chip" onClick={() => setStages(p.stages.map((s) => ({ ...s, model: chat.model })))}>{p.name}</button>)}
      </div>
      <div className="col" style={{ gap: 12 }}>
        {stages.map((s, i) => (
          <div key={i} className="card" style={{ padding: 14 }}>
            <div className="row" style={{ marginBottom: 10 }}>
              <span className="badge accent">Etapa {i + 1}</span>
              <input className="input" style={{ height: 32, maxWidth: 240 }} value={s.label} onChange={(e) => upd(i, { label: e.target.value })} />
              <ModelPicker value={s.model} onChange={(m) => upd(i, { model: m })} compact />
              <select className="select" style={{ height: 32, width: 170 }} value={s.agentId || ''} onChange={(e) => upd(i, { agentId: e.target.value || undefined })}>
                <option value="">Agente del chat</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <span className="grow" />
              <IconButton icon="chevron-up" disabled={i === 0} onClick={() => { const n = [...stages]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; setStages(n); }} />
              <IconButton icon="trash" onClick={() => setStages(stages.filter((_, j) => j !== i))} />
            </div>
            <textarea className="textarea" rows={2} style={{ minHeight: 56 }} value={s.instruction} placeholder="Instrucción de esta etapa" onChange={(e) => upd(i, { instruction: e.target.value })} />
          </div>
        ))}
      </div>
      <Button icon="plus" style={{ marginTop: 12 }} onClick={() => setStages([...stages, { label: `Etapa ${stages.length + 1}`, instruction: '', model: chat.model }])}>Añadir etapa</Button>
      <MultiPlanInfo refs={stages.map((s) => s.model)} />
    </Modal>
  );
}

function ChatHeader({ chat }) {
  const { agents, updateChat, sidebarOpen, browserOpen } = useStore();
  const [editTitle, setEditTitle] = useState(false);
  const [pipeline, setPipeline] = useState(false);
  const [menu, setMenu] = useState(null);
  const setMode = (mode) => {
    if (mode === 'pipeline' && !chat.pipeline?.length) { setPipeline(true); return; }
    if (mode === 'compare' && (!chat.compareModels || chat.compareModels.length < 2)) updateChat(chat.id, { mode, compareModels: chat.model ? [chat.model] : [] });
    else updateChat(chat.id, { mode });
  };
  return (
    <div className="chat-header">
      <IconButton icon="panel-left" title="Mostrar/ocultar historial" onClick={() => useStore.setState({ sidebarOpen: !sidebarOpen })} />
      {editTitle ? (
        <input className="input" style={{ width: 240, height: 30 }} autoFocus defaultValue={chat.title} onBlur={(e) => { updateChat(chat.id, { title: e.target.value || chat.title }); setEditTitle(false); }} onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }} />
      ) : <span className="title-edit" onClick={() => setEditTitle(true)} title="Renombrar">{chat.title}</span>}
      <span className="grow" />
      <AgentPicker value={chat.agentId} onChange={(agentId, modelRef) => updateChat(chat.id, modelRef ? { agentId, model: modelRef } : { agentId })} />
      {chat.mode === 'compare'
        ? <ModelPicker multiple value={chat.compareModels || []} onChange={(compareModels) => updateChat(chat.id, { compareModels: compareModels.slice(0, 4) })} placeholder="Elige 2-4 modelos" />
        : chat.mode === 'pipeline'
          ? <button className="picker-btn" onClick={() => setPipeline(true)}><Icon name="workflow" size={15} />{chat.pipeline?.length || 0} etapas<Icon name="pencil" size={13} className="faint" /></button>
          : <ModelPicker value={chat.model} onChange={(model) => updateChat(chat.id, { model })} allowDefault />}
      <Seg value={chat.mode || 'chat'} onChange={setMode} options={[
        { value: 'chat', label: 'Chat', icon: 'chat', title: 'Un modelo' },
        { value: 'compare', label: 'Comparar', icon: 'columns', title: 'Varios modelos a la vez' },
        { value: 'pipeline', label: 'Etapas', icon: 'workflow', title: 'Varios modelos por partes en el mismo trabajo' }
      ]} />
      <IconButton icon="globe" active={browserOpen} title="Navegador integrado" onClick={() => useStore.setState({ browserOpen: !browserOpen })} />
      <IconButton icon="more" title="Más" onClick={(e) => setMenu(e.currentTarget)} />
      {menu && <Menu anchor={menu} onClose={() => setMenu(null)} align="right" width={260} items={[
        { header: true, label: 'Razonamiento' },
        ...['auto', 'none', 'low', 'medium', 'high'].map((r) => ({ icon: (chat.reasoningEffort || 'auto') === r ? 'check' : 'circle', label: { auto: 'Automático', none: 'Sin razonamiento', low: 'Bajo', medium: 'Medio', high: 'Alto' }[r], onClick: () => updateChat(chat.id, { reasoningEffort: r }) })),
        '-',
        { icon: 'file-down', label: 'Exportar a Markdown', onClick: () => call('chats.export', chat.id) },
        { icon: 'trash', label: 'Eliminar chat', danger: true, onClick: () => useStore.getState().deleteChat(chat.id) }
      ]} />}
      {pipeline && <PipelineEditor chat={chat} onClose={() => setPipeline(false)} />}
    </div>
  );
}

const SUGGESTIONS = [
  { icon: 'folder-open', title: 'Organiza mis descargas', text: 'Revisa mi carpeta de Descargas y organiza los archivos en subcarpetas por tipo. Primero muéstrame el plan.' },
  { icon: 'globe', title: 'Investiga un tema', text: 'Investiga las novedades más importantes de IA de esta semana y hazme un resumen con fuentes.', agent: 'researcher' },
  { icon: 'mouse-pointer-click', title: 'Controla el PC', text: 'Abre el Bloc de notas y escribe una lista de la compra para una paella.', agent: 'operator' },
  { icon: 'code', title: 'Crea una web', text: 'Crea en mi Escritorio una página web moderna de una sola página para una cafetería y ábrela en el navegador.', agent: 'coder' },
  { icon: 'cpu', title: '¿Qué modelos me van bien?', text: 'Analiza mi equipo (usa system_info) y dime qué modelos locales puedo ejecutar con fluidez y para qué usaría cada uno.' },
  { icon: 'network', title: 'Equipo multi-modelo', text: 'Escribe un artículo sobre energía solar: un agente investiga, otro redacta y otro revisa.', agent: 'orchestrator' }
];

function Welcome({ onPick }) {
  const s = useStore((st) => st.settings);
  const locals = useStore((st) => st.localModels);
  const providers = useStore((st) => st.providers);
  const noModels = !locals.length && !providers.some((p) => p.hasKey || p.type === 'ollama' || p.type === 'lmstudio');
  const hour = new Date().getHours();
  const greet = hour < 6 ? 'Buenas noches' : hour < 13 ? 'Buenos días' : hour < 21 ? 'Buenas tardes' : 'Buenas noches';
  return (
    <div className="welcome">
      <div className="orb" />
      <h1>{greet}. ¿En qué te ayudo?</h1>
      <p>Modelos locales y en la nube, agentes con acceso a tu equipo, navegador y voz.</p>
      {noModels && (
        <div className="card row" style={{ marginBottom: 16, maxWidth: 610, borderColor: 'color-mix(in oklab, var(--accent) 40%, transparent)' }}>
          <Icon name="info" size={18} style={{ color: 'var(--accent-2)' }} />
          <span className="small grow">Aún no tienes modelos. Descarga uno recomendado para tu equipo o añade una clave de API.</span>
          <Button size="sm" variant="primary" onClick={() => useStore.getState().setView('models', { modelsTab: 'discover' })}>Ver modelos</Button>
          <Button size="sm" onClick={() => useStore.getState().setView('settings', { settingsTab: 'providers' })}>API</Button>
        </div>
      )}
      <div className="suggestions">
        {SUGGESTIONS.map((x) => (
          <button key={x.title} className="suggestion" onClick={() => onPick(x)}>
            <Icon name={x.icon} size={18} style={{ marginTop: 2, color: 'var(--accent-2)' }} />
            <span><strong>{x.title}</strong><span className="sugg-text">{x.text}</span></span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ChatView() {
  const { currentChatId, chatCache, running, browserOpen, agents, newChat, sendMessage } = useStore();
  const chat = currentChatId ? chatCache[currentChatId] : null;
  const scroller = useRef(null);
  const [atBottom, setAtBottom] = useState(true);
  const userScrollingRef = useRef(false);
  const wheelTimerRef = useRef(null);
  const isRunning = chat && running.has(chat.id);
  const agentMap = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a])), [agents]);
  const lastMsg = chat?.messages?.[chat.messages.length - 1];

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && atBottom && !userScrollingRef.current) el.scrollTop = el.scrollHeight;
  }, [chat?.messages, atBottom]);
  useEffect(() => { setAtBottom(true); userScrollingRef.current = false; }, [currentChatId]);

  const onWheel = (e) => {
    if (e.deltaY < 0) {
      // User is scrolling UP with the mouse wheel → pause auto-scroll
      userScrollingRef.current = true;
      setAtBottom(false);
    }
    // Clear any existing timer and set a new one to re-check position after scrolling stops
    clearTimeout(wheelTimerRef.current);
    wheelTimerRef.current = setTimeout(() => {
      const el = scroller.current;
      if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) {
        userScrollingRef.current = false;
        setAtBottom(true);
      }
    }, 150);
  };

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (isNearBottom) {
      userScrollingRef.current = false;
      setAtBottom(true);
    } else if (!userScrollingRef.current) {
      // Only set atBottom=false from generic scroll if not already handled by wheel
      setAtBottom(false);
    }
  };

  async function send(payload, agentOverride) {
    let c = chat;
    if (!c) c = await newChat(agentOverride ? { agentId: agentOverride } : {});
    userScrollingRef.current = false;
    setAtBottom(true);
    await sendMessage(c.id, payload);
  }

  const regenerate = (index) => {
    useStore.setState((s) => ({ chatCache: { ...s.chatCache, [chat.id]: { ...chat, messages: chat.messages.slice(0, index) } }, running: new Set([...s.running, chat.id]) }));
    call('chats.regenerate', chat.id, index);
  };
  const edit = (index, text) => {
    const msgs = chat.messages.slice(0, index + 1);
    msgs[index] = { ...msgs[index], content: text };
    useStore.setState((s) => ({ chatCache: { ...s.chatCache, [chat.id]: { ...chat, messages: msgs } }, running: new Set([...s.running, chat.id]) }));
    call('chats.editResend', chat.id, index, text);
  };
  const del = async (index) => { const c = await call('chats.deleteMessage', chat.id, index); useStore.setState((s) => ({ chatCache: { ...s.chatCache, [chat.id]: c } })); };
  const speak = (text) => { const sp = getSpeaker(); sp.stop(); sp.speak(text); };
  const voice = () => window.dispatchEvent(new CustomEvent('nexo-voice', { detail: 'conversation' }));

  return (
    <div className="chat-layout">
      <ChatSidebar />
      <div className="chat-main">
        {chat ? <ChatHeader chat={chat} /> : (
          <div className="chat-header"><IconButton icon="panel-left" title="Historial" onClick={() => useStore.setState((s) => ({ sidebarOpen: !s.sidebarOpen }))} /><span className="grow" /><IconButton icon="globe" active={browserOpen} title="Navegador" onClick={() => useStore.setState({ browserOpen: !browserOpen })} /></div>
        )}
        {chat && chat.messages.length ? (
          <div className="messages" ref={scroller} onScroll={onScroll} onWheel={onWheel}>
            <div className={`msg-wrap ${chat.mode === 'compare' ? 'wide' : ''}`}>
              {chat.messages.map((m, i) => (
                <Message key={m.id} msg={m} index={i} isLast={i === chat.messages.length - 1} running={isRunning} agent={agentMap[m.agentId]} onRegenerate={regenerate} onEdit={edit} onSpeak={speak} onDelete={del} />
              ))}
            </div>
          </div>
        ) : <Welcome onPick={(x) => send({ text: x.text }, x.agent)} />}
        {!atBottom && chat?.messages.length > 0 && <button className="scroll-down" onClick={() => { userScrollingRef.current = false; setAtBottom(true); }}><Icon name="arrow-down" size={16} /></button>}
        <Composer chat={chat} running={isRunning} onSend={(p) => send(p)} onStop={() => call('chats.stop', chat.id)} onVoice={voice} />
      </div>
      {browserOpen && <BrowserPanel />}
    </div>
  );
}
