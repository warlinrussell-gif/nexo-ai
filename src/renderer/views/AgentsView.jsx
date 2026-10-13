import { useEffect, useState } from 'react';
import { useStore } from '../lib/store.js';
import { call } from '../lib/api.js';
import Icon from '../components/Icon.jsx';
import { Button, Drawer, Field, Toggle, Confirm } from '../components/ui.jsx';
import ModelPicker from '../components/ModelPicker.jsx';

const ICONS = ['sparkles', 'bot', 'brain', 'code', 'globe', 'mouse-pointer-click', 'network', 'audio-lines', 'terminal', 'file', 'palette', 'rocket', 'wand', 'shield', 'database', 'languages', 'headphones', 'library'];
const COLORS = ['#8b5cf6', '#06b6d4', '#22c55e', '#f59e0b', '#ec4899', '#3b82f6', '#ef4444', '#14b8a6', '#a855f7', '#f97316', '#64748b'];

function AgentEditor({ agent, onClose }) {
  const [a, setA] = useState(agent);
  const [groups, setGroups] = useState({});
  const [skills, setSkills] = useState([]);
  const mcp = useStore((s) => s.mcp);
  const { refreshAgents, toast, newChat } = useStore();
  useEffect(() => { call('agents.groups').then(setGroups); call('skills.list').then(setSkills); }, []);
  const set = (patch) => setA({ ...a, ...patch });
  const toggleTool = (g) => set({ tools: a.tools?.includes(g) ? a.tools.filter((x) => x !== g) : [...(a.tools || []), g] });
  async function save() {
    if (!a.name?.trim()) { toast('Pon un nombre al agente', 'error'); return; }
    await call('agents.save', a); await refreshAgents(); toast('Agente guardado', 'success'); onClose();
  }
  return (
    <Drawer title={agent.id ? `Editar · ${agent.name}` : 'Nuevo agente'} onClose={onClose} width={720} actions={<Button variant="primary" icon="save" size="sm" onClick={save}>Guardar</Button>}>
      <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
        <div className="agent-icon" style={{ width: 56, height: 56, borderRadius: 16, background: a.color, display: 'grid', placeItems: 'center', color: '#fff', flex: 'none' }}><Icon name={a.icon || 'bot'} size={26} /></div>
        <div className="grow">
          <Field label="Nombre"><input className="input" value={a.name || ''} onChange={(e) => set({ name: e.target.value })} disabled={a.builtin && false} /></Field>
          <Field label="Descripción (la ven otros agentes al delegar)"><input className="input" value={a.description || ''} onChange={(e) => set({ description: e.target.value })} /></Field>
        </div>
      </div>
      <div className="row wrap" style={{ gap: 6, marginBottom: 10 }}>{ICONS.map((i) => <button key={i} className={`icon-btn ${a.icon === i ? 'active' : ''}`} onClick={() => set({ icon: i })}><Icon name={i} size={16} /></button>)}</div>
      <div className="row wrap" style={{ gap: 6, marginBottom: 18 }}>{COLORS.map((c) => <span key={c} className={`color-swatch ${a.color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => set({ color: c })} />)}</div>
      <Field label="Modelo" hint="Si eliges uno, el agente lo usará siempre (útil para equipos multi-modelo). Si no, usa el del chat."><div><ModelPicker value={a.model || null} onChange={(m) => set({ model: m })} allowDefault /></div></Field>
      <Field label="Instrucciones del sistema (personalidad, método de trabajo, reglas)"><textarea className="textarea" rows={10} value={a.systemPrompt || ''} onChange={(e) => set({ systemPrompt: e.target.value })} /></Field>
      <div className="section-title">Herramientas</div>
      <div className="grid-2" style={{ gap: 8 }}>
        {Object.entries(groups).map(([k, g]) => (
          <label key={k} className="choice" style={{ padding: '10px 12px' }} onClick={(e) => { e.preventDefault(); toggleTool(k); }}>
            <Toggle value={a.tools?.includes(k)} onChange={() => { }} />
            <span className="grow"><div style={{ fontWeight: 580, fontSize: 13 }}>{g.label}</div><div className="tiny muted">{g.desc}</div></span>
          </label>
        ))}
      </div>
      {a.tools?.includes('skills') && (
        <>
          <div className="section-title">Skills</div>
          <div className="row wrap" style={{ gap: 6 }}>
            <button className={`chip ${a.skills === 'all' || !a.skills ? 'on' : ''}`} onClick={() => set({ skills: 'all' })}>Todas</button>
            {skills.map((s) => { const on = Array.isArray(a.skills) && a.skills.includes(s.id); return <button key={s.id} className={`chip ${on ? 'on' : ''}`} onClick={() => set({ skills: on ? a.skills.filter((x) => x !== s.id) : [...(Array.isArray(a.skills) ? a.skills : []), s.id] })}>{s.name}</button>; })}
          </div>
        </>
      )}
      {a.tools?.includes('mcp') && (
        <>
          <div className="section-title">Servidores MCP</div>
          <div className="row wrap" style={{ gap: 6 }}>
            <button className={`chip ${a.mcpServers === 'all' || !a.mcpServers ? 'on' : ''}`} onClick={() => set({ mcpServers: 'all' })}>Todos</button>
            {mcp.map((s) => { const on = Array.isArray(a.mcpServers) && a.mcpServers.includes(s.id); return <button key={s.id} className={`chip ${on ? 'on' : ''}`} onClick={() => set({ mcpServers: on ? a.mcpServers.filter((x) => x !== s.id) : [...(Array.isArray(a.mcpServers) ? a.mcpServers : []), s.id] })}>{s.name}</button>; })}
            {!mcp.length && <span className="small muted">No hay servidores MCP configurados.</span>}
          </div>
        </>
      )}
      <div className="section-title">Parámetros</div>
      <div className="grid-2">
        <Field label={`Temperatura: ${a.temperature ?? 0.6}`} hint="Baja = precisa; alta = creativa"><input type="range" className="slider" min={0} max={1.5} step={0.05} value={a.temperature ?? 0.6} onChange={(e) => set({ temperature: Number(e.target.value) })} /></Field>
        <Field label={`Pasos máximos: ${a.maxSteps || 30}`} hint="Llamadas a herramientas por respuesta"><input type="range" className="slider" min={5} max={150} step={5} value={a.maxSteps || 30} onChange={(e) => set({ maxSteps: Number(e.target.value) })} /></Field>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <Button variant="primary" icon="save" onClick={save}>Guardar</Button>
        {a.id && <Button icon="chat" onClick={async () => { await save(); newChat({ agentId: a.id }); }}>Guardar y chatear</Button>}
      </div>
    </Drawer>
  );
}

export default function AgentsView() {
  const { agents, refreshAgents, newChat } = useStore();
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-header">
          <div><h1>Agentes</h1><p>Asistentes especializados con sus propias instrucciones, herramientas, skills, servidores MCP y modelo.</p></div>
          <div className="actions"><Button variant="primary" icon="plus" onClick={() => setEdit({ name: '', description: '', icon: 'bot', color: '#8b5cf6', systemPrompt: '', tools: ['web', 'files', 'memory', 'skills'], skills: 'all', mcpServers: 'all', temperature: 0.6, maxSteps: 30 })}>Nuevo agente</Button></div>
        </div>
        <div className="cards">
          {agents.map((a) => (
            <div key={a.id} className="card agent-card col" style={{ gap: 10 }}>
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <div className="agent-icon" style={{ background: a.color }}><Icon name={a.icon || 'bot'} size={20} /></div>
                <div className="grow"><h3>{a.name}</h3><div className="tiny muted">{a.builtin ? 'Integrado' : 'Personalizado'}{a.model ? ' · modelo propio' : ''}</div></div>
              </div>
              <div className="small" style={{ color: 'var(--text-2)', minHeight: 40 }}>{a.description}</div>
              <div className="row wrap" style={{ gap: 4 }}>{(a.tools || []).map((t) => <span key={t} className="badge">{t}</span>)}</div>
              <div className="row" style={{ marginTop: 'auto' }}>
                <Button size="sm" variant="primary" icon="chat" onClick={() => newChat({ agentId: a.id })}>Chatear</Button>
                <Button size="sm" icon="pencil" onClick={() => setEdit(a)}>Editar</Button>
                <span className="grow" />
                {a.builtin ? <Button size="sm" variant="ghost" onClick={() => call('agents.reset', a.id).then(refreshAgents)}>Restablecer</Button> : <Button size="sm" variant="ghost" className="danger" icon="trash" onClick={() => setDel(a)} />}
              </div>
            </div>
          ))}
        </div>
      </div>
      {edit && <AgentEditor agent={edit} onClose={() => setEdit(null)} />}
      {del && <Confirm title="Eliminar agente" text={`¿Eliminar el agente ${del.name}?`} danger confirmLabel="Eliminar" onConfirm={() => call('agents.delete', del.id).then(refreshAgents)} onClose={() => setDel(null)} />}
    </div>
  );
}
