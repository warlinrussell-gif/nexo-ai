import { useEffect, useState } from 'react';
import { useStore } from '../lib/store.js';
import { call } from '../lib/api.js';
import Icon from '../components/Icon.jsx';
import { Button, Drawer, Field, Toggle, Empty, Confirm, IconButton } from '../components/ui.jsx';

const TEMPLATE = `## Cuándo usar esta skill
Describe aquí las situaciones en las que el agente debe aplicarla.

## Instrucciones
1. Paso uno…
2. Paso dos…

## Buenas prácticas
- …
`;

function SkillEditor({ skill, onClose, onSaved }) {
  const [name, setName] = useState(skill?.name || '');
  const [description, setDescription] = useState(skill?.description || '');
  const [body, setBody] = useState(skill?.body ?? TEMPLATE);
  const [raw, setRaw] = useState(skill?.content || '');
  const toast = useStore((s) => s.toast);
  const isNew = !skill?.id;
  async function save() {
    try {
      if (isNew) { if (!name.trim() || !description.trim()) { toast('Nombre y descripción son obligatorios', 'error'); return; } await call('skills.save', { name, description, body }); }
      else await call('skills.saveRaw', skill.id, raw);
      toast('Skill guardada', 'success'); onSaved(); onClose();
    } catch (e) { toast(e.message, 'error'); }
  }
  return (
    <Drawer title={isNew ? 'Nueva skill' : skill.name} onClose={onClose} width={780} actions={<Button size="sm" variant="primary" icon="save" onClick={save}>Guardar</Button>}>
      {isNew ? (
        <>
          <Field label="Nombre"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="p. ej. Informes financieros" /></Field>
          <Field label="Descripción" hint="Los agentes deciden cuándo cargar la skill leyendo esta descripción: sé concreto."><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Crea informes financieros con tablas y conclusiones a partir de CSV o Excel" /></Field>
          <Field label="Instrucciones (Markdown)"><textarea className="textarea mono" rows={22} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
        </>
      ) : (
        <>
          <p className="small muted" style={{ marginTop: 0 }}>Carpeta: <span className="mono">{skill.path}</span>{skill.files?.length ? ` · archivos de apoyo: ${skill.files.join(', ')}` : ''}</p>
          <textarea className="textarea mono" rows={30} value={raw} onChange={(e) => setRaw(e.target.value)} />
        </>
      )}
    </Drawer>
  );
}

export default function SkillsView() {
  const [skills, setSkills] = useState([]);
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  const toast = useStore((s) => s.toast);
  const reload = () => call('skills.list').then(setSkills);
  useEffect(() => { reload(); }, []);
  async function open(s) { const full = await call('skills.get', s.id); setEdit(full); }
  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-header">
          <div><h1>Skills</h1><p>Paquetes de instrucciones y recursos (formato SKILL.md, compatible con Agent Skills) que los agentes cargan solo cuando los necesitan.</p></div>
          <div className="actions">
            <Button icon="folder-open" onClick={() => call('skills.openFolder')}>Abrir carpeta</Button>
            <Button icon="upload" onClick={() => call('skills.import').then((r) => { if (r) { toast('Skill importada', 'success'); reload(); } }).catch((e) => toast(e.message, 'error'))}>Importar</Button>
            <Button variant="primary" icon="plus" onClick={() => setEdit({})}>Nueva skill</Button>
          </div>
        </div>
        {!skills.length ? <Empty icon="skills" title="Sin skills">Crea una skill o importa una carpeta que contenga un SKILL.md.</Empty> : (
          <div className="cards">
            {skills.map((s) => (
              <div key={s.id} className="card col" style={{ gap: 8, opacity: s.enabled ? 1 : 0.6 }}>
                <div className="row"><Icon name="skills" size={18} style={{ color: 'var(--accent-2)' }} /><h3 className="grow ellipsis">{s.name}</h3><Toggle value={s.enabled} onChange={(v) => call('skills.toggle', s.id, v).then(reload)} /></div>
                <div className="small" style={{ color: 'var(--text-2)', minHeight: 40 }}>{s.description}</div>
                <div className="row"><span className="tiny muted mono">{s.id}</span>{s.files.length > 0 && <span className="badge">{s.files.length} archivos</span>}<span className="grow" /><IconButton icon="pencil" size={15} onClick={() => open(s)} title="Editar" /><IconButton icon="trash" size={15} onClick={() => setDel(s)} title="Eliminar" /></div>
              </div>
            ))}
          </div>
        )}
      </div>
      {edit && <SkillEditor skill={edit.id ? edit : null} onClose={() => setEdit(null)} onSaved={reload} />}
      {del && <Confirm title="Eliminar skill" text={`¿Eliminar la skill ${del.name} y su carpeta?`} danger confirmLabel="Eliminar" onConfirm={() => call('skills.delete', del.id).then(reload)} onClose={() => setDel(null)} />}
    </div>
  );
}
