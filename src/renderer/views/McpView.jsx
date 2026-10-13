import { useEffect, useState } from 'react';
import { useStore } from '../lib/store.js';
import { call } from '../lib/api.js';
import Icon from '../components/Icon.jsx';
import { Button, Drawer, Field, Toggle, Empty, Seg, Modal, IconButton, Confirm } from '../components/ui.jsx';

function ServerEditor({ server, onClose }) {
  const [s, setS] = useState({ transport: 'stdio', args: [], env: {}, headers: {}, enabled: true, ...server });
  const [argsText, setArgsText] = useState((server.args || []).join('\n'));
  const [envText, setEnvText] = useState(Object.entries(server.env || {}).map(([k, v]) => `${k}=${v}`).join('\n'));
  const [hdrText, setHdrText] = useState(Object.entries(server.headers || {}).map(([k, v]) => `${k}: ${v}`).join('\n'));
  const toast = useStore((st) => st.toast);
  async function save() {
    if (!s.name?.trim()) { toast('Pon un nombre', 'error'); return; }
    const env = Object.fromEntries(envText.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }).filter(([k]) => k));
    const headers = Object.fromEntries(hdrText.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }).filter(([k]) => k));
    await call('mcp.upsert', { ...s, args: argsText.split('\n').map((x) => x.trim()).filter(Boolean), env, headers });
    toast('Servidor guardado; conectando…', 'success');
    onClose();
  }
  return (
    <Drawer title={server.id ? `Editar · ${server.name}` : 'Nuevo servidor MCP'} onClose={onClose} actions={<Button size="sm" variant="primary" icon="save" onClick={save}>Guardar</Button>}>
      <Field label="Nombre"><input className="input" value={s.name || ''} onChange={(e) => setS({ ...s, name: e.target.value })} placeholder="p. ej. github" /></Field>
      <Field label="Transporte"><Seg value={s.transport} onChange={(v) => setS({ ...s, transport: v })} options={[{ value: 'stdio', label: 'Local (stdio)' }, { value: 'http', label: 'HTTP (Streamable)' }, { value: 'sse', label: 'SSE' }]} /></Field>
      {s.transport === 'stdio' ? (
        <>
          <Field label="Comando" hint="p. ej. npx, uvx, node, python o la ruta a un ejecutable"><input className="input mono" value={s.command || ''} onChange={(e) => setS({ ...s, command: e.target.value })} /></Field>
          <Field label="Argumentos (uno por línea)"><textarea className="textarea mono" rows={4} value={argsText} onChange={(e) => setArgsText(e.target.value)} /></Field>
          <Field label="Variables de entorno (CLAVE=valor, una por línea)"><textarea className="textarea mono" rows={3} value={envText} onChange={(e) => setEnvText(e.target.value)} /></Field>
        </>
      ) : (
        <>
          <Field label="URL"><input className="input mono" value={s.url || ''} onChange={(e) => setS({ ...s, url: e.target.value })} placeholder="https://servidor/mcp" /></Field>
          <Field label="Cabeceras (Nombre: valor, una por línea)" hint="p. ej. Authorization: Bearer …"><textarea className="textarea mono" rows={3} value={hdrText} onChange={(e) => setHdrText(e.target.value)} /></Field>
        </>
      )}
      <div className="setting"><div className="info"><div className="t">Servidor de confianza</div><div className="d">Sus herramientas se ejecutan sin pedir permiso.</div></div><div className="ctl"><Toggle value={s.trusted} onChange={(v) => setS({ ...s, trusted: v })} /></div></div>
      <div className="setting"><div className="info"><div className="t">Activado</div></div><div className="ctl"><Toggle value={s.enabled} onChange={(v) => setS({ ...s, enabled: v })} /></div></div>
    </Drawer>
  );
}

export default function McpView() {
  const { mcp, toast } = useStore();
  const [presets, setPresets] = useState([]);
  const [edit, setEdit] = useState(null);
  const [importing, setImporting] = useState(false);
  const [json, setJson] = useState('');
  const [open, setOpen] = useState({});
  const [del, setDel] = useState(null);
  useEffect(() => { call('mcp.presets').then(setPresets); }, []);
  const statusColor = { connected: 'green', connecting: 'amber', error: 'red', disconnected: '', disabled: '' };
  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-header">
          <div><h1>Servidores MCP</h1><p>Conecta herramientas externas mediante Model Context Protocol. Compatible con la configuración de Claude Desktop y Cursor.</p></div>
          <div className="actions">
            <Button icon="upload" onClick={() => setImporting(true)}>Importar JSON</Button>
            <Button icon="download" onClick={() => call('mcp.importClaude').then((n) => toast(`${n} servidores importados de Claude Desktop`, 'success')).catch((e) => toast(e.message, 'error'))}>Desde Claude Desktop</Button>
            <Button variant="primary" icon="plus" onClick={() => setEdit({})}>Añadir servidor</Button>
          </div>
        </div>
        {!mcp.length ? <Empty icon="plug" title="Sin servidores MCP">Añade uno de la galería de abajo o importa tu configuración existente.</Empty> : (
          <div className="list" style={{ marginBottom: 20 }}>
            {mcp.map((s) => (
              <div key={s.id}>
                <div className="list-row">
                  <span className={`status-dot ${statusColor[s.status]}`} />
                  <div className="grow">
                    <div className="row" style={{ gap: 8 }}><strong>{s.name}</strong><span className="badge">{s.transport}</span>{s.trusted && <span className="badge green">confianza</span>}</div>
                    <div className="small muted mono ellipsis" style={{ marginTop: 2 }}>{s.transport === 'stdio' ? `${s.command} ${(s.args || []).join(' ')}` : s.url}</div>
                  </div>
                  <span className="small muted">{s.status === 'connected' ? `${s.tools.length} herramientas` : s.status === 'connecting' ? 'Conectando…' : s.status === 'error' ? 'Error' : s.status === 'disabled' ? 'Desactivado' : 'Desconectado'}</span>
                  <Toggle value={s.enabled} onChange={(v) => call('mcp.upsert', { id: s.id, enabled: v })} />
                  <IconButton icon={open[s.id] ? 'chevron-up' : 'chevron-down'} onClick={() => setOpen({ ...open, [s.id]: !open[s.id] })} />
                  <IconButton icon="refresh" title="Reconectar" onClick={() => call('mcp.restart', s.id)} />
                  <IconButton icon="pencil" title="Editar" onClick={() => setEdit(s)} />
                  <IconButton icon="trash" title="Eliminar" onClick={() => setDel(s)} />
                </div>
                {(open[s.id] || s.status === 'error') && (
                  <div style={{ padding: '0 16px 14px 38px' }}>
                    {s.error && <div className="error-box">{s.error}</div>}
                    {s.tools.map((t) => <div key={t.name} className="small" style={{ padding: '3px 0' }}><span className="mono" style={{ color: 'var(--text)' }}>{t.name}</span> <span className="muted">— {t.description?.slice(0, 160)}</span></div>)}
                    {s.stderr?.length > 0 && open[s.id] && <div className="logs" style={{ marginTop: 8 }}>{s.stderr.join('\n')}</div>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="section-title">Galería de servidores</div>
        <div className="cards">
          {presets.map((p) => (
            <div key={p.id} className="card col" style={{ gap: 8 }}>
              <div className="row"><Icon name="plug" size={17} style={{ color: 'var(--accent-2)' }} /><h3 className="grow">{p.name}</h3>{p.needs && <span className="badge outline">{p.needs}</span>}</div>
              <div className="small muted" style={{ minHeight: 36 }}>{p.desc}</div>
              <div className="row"><span className="tiny faint mono ellipsis grow">{p.url || `${p.command} ${p.args.join(' ')}`}</span><Button size="sm" icon="plus" onClick={() => call('mcp.addPreset', p.id).then(() => toast(`${p.name} añadido`, 'success'))}>Añadir</Button></div>
            </div>
          ))}
        </div>
        <p className="small muted" style={{ marginTop: 16 }}>Los servidores con "npx" requieren Node.js y los de "uvx" requieren uv (Python). Puedes pedirle a un agente que los instale por ti.</p>
      </div>
      {edit && <ServerEditor server={edit} onClose={() => setEdit(null)} />}
      {del && <Confirm title="Eliminar servidor" text={`¿Eliminar ${del.name}?`} danger confirmLabel="Eliminar" onConfirm={() => call('mcp.remove', del.id)} onClose={() => setDel(null)} />}
      {importing && (
        <Modal title="Importar configuración MCP" wide onClose={() => setImporting(false)} footer={<><Button variant="ghost" onClick={() => setImporting(false)}>Cancelar</Button><Button variant="primary" onClick={() => call('mcp.import', json).then((n) => { toast(`${n} servidores importados`, 'success'); setImporting(false); }).catch((e) => toast('JSON inválido: ' + e.message, 'error'))}>Importar</Button></>}>
          <p className="small muted" style={{ marginTop: 0 }}>Pega un JSON con el formato {'{ "mcpServers": { "nombre": { "command": "...", "args": [...] } } }'}</p>
          <textarea className="textarea mono" rows={14} value={json} onChange={(e) => setJson(e.target.value)} placeholder={'{\n  "mcpServers": {\n    "filesystem": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:/Users/tu_usuario"]\n    }\n  }\n}'} />
        </Modal>
      )}
    </div>
  );
}
