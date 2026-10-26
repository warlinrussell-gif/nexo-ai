import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../lib/store.js';
import { call } from '../lib/api.js';
import Icon from '../components/Icon.jsx';
import { IconButton, Menu, Seg, Modal, Button } from '../components/ui.jsx';
import ModelPicker from '../components/ModelPicker.jsx';
import { userName } from '../components/Sidebar.jsx';
import Message from '../components/Message.jsx';
import Composer from '../components/Composer.jsx';
import BrowserPanel from '../components/BrowserPanel.jsx';
import { getSpeaker } from '../components/Voice.jsx';
import { fmtBytes } from '../lib/api.js';

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
  const { updateChat, browserOpen } = useStore();
  const [editTitle, setEditTitle] = useState(false);
  const [pipeline, setPipeline] = useState(false);
  const [menu, setMenu] = useState(null);
  const setMode = (mode) => {
    if (mode === 'pipeline' && !chat?.pipeline?.length) { setPipeline(true); return; }
    if (mode === 'compare' && (!chat.compareModels || chat.compareModels.length < 2)) updateChat(chat.id, { mode, compareModels: chat.model ? [chat.model] : [] });
    else updateChat(chat.id, { mode });
  };
  return (
    <div className="chat-header">
      {chat && (editTitle ? (
        <input className="input" style={{ width: 280, height: 30 }} autoFocus defaultValue={chat.title} onBlur={(e) => { updateChat(chat.id, { title: e.target.value || chat.title }); setEditTitle(false); }} onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }} />
      ) : <button className="title-edit" onClick={() => setEditTitle(true)} title="Renombrar">{chat.title}<Icon name="chevron-down" size={13} className="faint" /></button>)}
      <span className="grow" />
      {chat?.mode === 'compare' && <ModelPicker multiple value={chat.compareModels || []} onChange={(compareModels) => updateChat(chat.id, { compareModels: compareModels.slice(0, 4) })} placeholder="Elige 2-4 modelos" />}
      {chat?.mode === 'pipeline' && <button className="picker-btn" onClick={() => setPipeline(true)}><Icon name="workflow" size={15} />{chat.pipeline?.length || 0} etapas<Icon name="pencil" size={13} className="faint" /></button>}
      {chat && <Seg value={chat.mode || 'chat'} onChange={setMode} options={[
        { value: 'chat', label: 'Chat', icon: 'chat', title: 'Un modelo' },
        { value: 'compare', label: 'Comparar', icon: 'columns', title: 'Varios modelos a la vez' },
        { value: 'pipeline', label: 'Etapas', icon: 'workflow', title: 'Varios modelos por partes en el mismo trabajo' }
      ]} />}
      <IconButton icon="globe" active={browserOpen} title="Navegador integrado" onClick={() => useStore.setState({ browserOpen: !browserOpen })} />
      {chat && <IconButton icon="more" title="Más" onClick={(e) => setMenu(e.currentTarget)} />}
      {menu && <Menu anchor={menu} onClose={() => setMenu(null)} align="right" width={260} items={[
        { header: true, label: 'Razonamiento' },
        ...['auto', 'none', 'low', 'medium', 'high'].map((r) => ({ icon: (chat.reasoningEffort || 'auto') === r ? 'check' : 'circle', label: { auto: 'Automático', none: 'Sin razonamiento', low: 'Bajo', medium: 'Medio', high: 'Alto' }[r], onClick: () => updateChat(chat.id, { reasoningEffort: r }) })),
        '-',
        { icon: chat.pinned ? 'pin-off' : 'pin', label: chat.pinned ? 'Desfijar' : 'Fijar en la barra lateral', onClick: () => updateChat(chat.id, { pinned: !chat.pinned }) },
        { icon: 'file-down', label: 'Exportar a Markdown', onClick: () => call('chats.export', chat.id) },
        { icon: 'trash', label: 'Eliminar chat', danger: true, onClick: () => useStore.getState().deleteChat(chat.id) }
      ]} />}
      {pipeline && <PipelineEditor chat={chat} onClose={() => setPipeline(false)} />}
    </div>
  );
}

const SUGGESTIONS = [
  { icon: 'folder-open', title: 'Organizar descargas', text: 'Revisa mi carpeta de Descargas y organiza los archivos en subcarpetas por tipo. Primero muéstrame el plan.' },
  { icon: 'globe', title: 'Investigar', text: 'Investiga las novedades más importantes de IA de esta semana y hazme un resumen con fuentes.', agent: 'researcher' },
  { icon: 'code', title: 'Programar', text: 'Crea en mi Escritorio una página web moderna de una sola página para una cafetería y ábrela en el navegador.', agent: 'coder' },
  { icon: 'mouse-pointer-click', title: 'Usar el PC', text: 'Abre el Bloc de notas y escribe una lista de la compra para una paella.', agent: 'operator' },
  { icon: 'cpu', title: 'Mi equipo', text: 'Analiza mi equipo (usa system_info) y dime qué modelos locales puedo ejecutar con fluidez y para qué usaría cada uno.' },
  { icon: 'network', title: 'Equipo multi-modelo', text: 'Escribe un artículo sobre energía solar: un agente investiga, otro redacta y otro revisa.', agent: 'orchestrator' }
];

function Welcome({ composer, onPick }) {
  const info = useStore((st) => st.info);
  const locals = useStore((st) => st.localModels);
  const providers = useStore((st) => st.providers);
  const noModels = !locals.length && !providers.some((p) => p.hasKey || p.type === 'ollama' || p.type === 'lmstudio');
  const hour = new Date().getHours();
  const greet = hour < 6 ? 'Buenas noches' : hour < 13 ? 'Buenos días' : hour < 21 ? 'Buenas tardes' : 'Buenas noches';
  return (
    <div className="welcome">
      <h1><span className="logo-mark lg" />{greet}, {userName(info)}</h1>
      {noModels && (
        <div className="card row welcome-note">
          <Icon name="info" size={18} style={{ color: 'var(--accent-2)' }} />
          <span className="small grow">Aún no tienes modelos. Descarga uno recomendado para tu equipo o añade una clave de API.</span>
          <Button size="sm" variant="primary" onClick={() => useStore.getState().setView('models', { modelsTab: 'discover' })}>Ver modelos</Button>
          <Button size="sm" onClick={() => useStore.getState().setView('settings', { settingsTab: 'providers' })}>API</Button>
        </div>
      )}
      <div className="welcome-composer">{composer}</div>
      <div className="suggestions">
        {SUGGESTIONS.map((x) => (
          <button key={x.title} className="suggestion" title={x.text} onClick={() => onPick(x)}>
            <Icon name={x.icon} size={15} />{x.title}
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

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && atBottom && !userScrollingRef.current) el.scrollTop = el.scrollHeight;
  }, [chat?.messages, atBottom]);
  useEffect(() => { setAtBottom(true); userScrollingRef.current = false; }, [currentChatId]);

  const onWheel = (e) => {
    if (e.deltaY < 0) {
      // El usuario sube con la rueda → pausar el desplazamiento automático
      userScrollingRef.current = true;
      setAtBottom(false);
    }
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
      setAtBottom(false);
    }
  };

  async function send(payload, agentOverride) {
    let c = chat;
    if (!c) {
      const draft = useStore.getState().draft || {};
      const data = {};
      if (agentOverride || draft.agentId) data.agentId = agentOverride || draft.agentId;
      if (draft.model) data.model = draft.model;
      if (draft.workspace) data.workspace = draft.workspace;
      if (draft.opencodeModel !== undefined) data.opencodeModel = draft.opencodeModel;
      if (draft.opencodeVariant !== undefined) data.opencodeVariant = draft.opencodeVariant;
      if (draft.reasoningEffort) data.reasoningEffort = draft.reasoningEffort;
      c = await newChat(data);
      useStore.setState({ draft: {} });
    }
    userScrollingRef.current = false;
    setAtBottom(true);
    if (useStore.getState().running.has(c.id)) { await call('chats.steer', c.id, payload); return; }
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
  const hasMessages = chat && chat.messages.length > 0;
  const composer = <Composer chat={chat} running={isRunning} onSend={(p) => send(p)} onStop={() => call('chats.stop', chat.id)} onVoice={voice} hero={!hasMessages} />;

  return (
    <div className="chat-layout">
      <div className="chat-main">
        <ChatHeader chat={chat} />
        {hasMessages ? (
          <div className="messages" ref={scroller} onScroll={onScroll} onWheel={onWheel}>
            <div className={`msg-wrap ${chat.mode === 'compare' ? 'wide' : ''}`}>
              {chat.messages.map((m, i) => (
                <Message key={m.id} msg={m} index={i} isLast={i === chat.messages.length - 1} running={isRunning} agent={agentMap[m.agentId]} onRegenerate={regenerate} onEdit={edit} onSpeak={speak} onDelete={del} />
              ))}
            </div>
          </div>
        ) : <Welcome composer={composer} onPick={(x) => send({ text: x.text }, x.agent)} />}
        {!atBottom && hasMessages && <button className="scroll-down" onClick={() => { userScrollingRef.current = false; setAtBottom(true); }}><Icon name="arrow-down" size={16} /></button>}
        {hasMessages && composer}
      </div>
      {browserOpen && <BrowserPanel />}
    </div>
  );
}
