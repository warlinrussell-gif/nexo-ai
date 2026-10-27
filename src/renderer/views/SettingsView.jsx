import { useEffect, useState } from 'react';
import { useStore } from '../lib/store.js';
import { call, on, fmtBytes } from '../lib/api.js';
import Icon from '../components/Icon.jsx';
import { Button, Toggle, Seg, Setting, Field, IconButton, Modal, Confirm } from '../components/ui.jsx';
import ModelPicker from '../components/ModelPicker.jsx';
import { DownloadRow } from './ModelsView.jsx';
import { getSpeaker } from '../components/Voice.jsx';

const PALETTES = [{ id: 'nexo', label: 'Nexo', c: '#1c1927' }, { id: 'medianoche', label: 'Medianoche', c: '#131a28' }, { id: 'grafito', label: 'Grafito', c: '#1d1d1d' }, { id: 'bosque', label: 'Bosque', c: '#14201c' }, { id: 'carmesi', label: 'Carmesí', c: '#221424' }, { id: 'clasico', label: 'Clásica', c: '#30302e' }];
const BACKGROUNDS = [{ id: 'none', label: 'Ninguno' }, { id: 'aurora', label: 'Aurora' }, { id: 'fluid', label: 'Degradado fluido' }, { id: 'stars', label: 'Estrellas' }, { id: 'constellation', label: 'Constelación' }, { id: 'waves', label: 'Olas' }];
const ACCENTS = ['#7a4be0', '#d97757', '#c96442', '#8b5cf6', '#6366f1', '#3b82f6', '#06b6d4', '#14b8a6', '#22c55e', '#f59e0b', '#ef4444', '#ec4899'];

// Emparejado de la extensión de Chrome de Nexo ("Mi Chrome")
function ExtSetup() {
  const [info, setInfo] = useState(null);
  const refresh = () => call('ext.info').then(setInfo);
  useEffect(() => { refresh(); return on('ext-state', refresh); }, []);
  if (!info) return null;
  return (
    <div className="setting-block" style={{ padding: '10px 14px', margin: '6px 0 12px', border: '1px solid var(--border)', borderRadius: 10, fontSize: 13, lineHeight: 1.55 }}>
      <div><b>{info.connected ? '✔ Extensión conectada a tu Chrome' : '○ Extensión sin conectar'}</b></div>
      <ol style={{ margin: '8px 0 8px 18px', padding: 0 }}>
        <li>Abre <b>chrome://extensions</b> y activa <b>Modo de desarrollador</b>.</li>
        <li>Pulsa <b>Cargar descomprimida</b> y elige la carpeta de la extensión de Nexo.</li>
        <li>Listo: Nexo se conecta solo, sin códigos.</li>
      </ol>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Button size="sm" onClick={() => call('ext.openFolder')}>Abrir carpeta de la extensión</Button>
        <Button size="sm" onClick={() => call('ext.openChromeExtensions')}>Abrir chrome://extensions</Button>
      </div>
    </div>
  );
}

function General() {
  const { settings, saveSettings, agents } = useStore();
  const s = settings;
  const setTheme = async (theme) => { await saveSettings({ theme }); call('app.setTheme', theme); };
  return (
    <>
      <h2>General</h2>
      <Setting title="Tema" desc="Apariencia de la aplicación"><Seg value={s.theme} onChange={setTheme} options={[{ value: 'dark', label: 'Oscuro', icon: 'moon' }, { value: 'light', label: 'Claro', icon: 'sun' }, { value: 'system', label: 'Sistema', icon: 'monitor' }]} /></Setting>
      <Setting title="Color de acento"><div className="row" style={{ gap: 6 }}>{ACCENTS.map((c) => <span key={c} className={`color-swatch ${s.accent === c ? 'on' : ''}`} style={{ background: c }} onClick={() => saveSettings({ accent: c })} />)}<label className="color-swatch" title="Color personalizado" style={{ background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)', position: 'relative', overflow: 'hidden' }}><input type="color" value={s.accent || '#7a4be0'} onChange={(e) => saveSettings({ accent: e.target.value })} style={{ opacity: 0, position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'pointer' }} /></label></div></Setting>
      <Setting title="Paleta" desc="Colores de las superficies en modo oscuro (el de acento se elige aparte)"><div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>{PALETTES.map((p) => <button key={p.id} className={`btn ${((s.palette || 'nexo') === p.id) ? 'primary' : ''}`} onClick={() => saveSettings({ palette: p.id })} style={{ gap: 8 }}><span style={{ width: 14, height: 14, borderRadius: 5, background: p.c, border: '1px solid rgba(255,255,255,.3)' }} />{p.label}</button>)}</div></Setting>
      <Setting title="Fondo animado" desc="Movimiento suave detrás de la aplicación. Se pausa con la ventana oculta; «Ninguno» no consume nada"><div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>{BACKGROUNDS.map((b) => <button key={b.id} className={`btn ${((s.background || 'none') === b.id) ? 'primary' : ''}`} onClick={() => saveSettings({ background: b.id })}>{b.label}</button>)}</div></Setting>
      <Setting title={`Tamaño de texto: ${Math.round((s.fontScale || 1) * 100)}%`}><input type="range" className="slider" style={{ width: 200 }} min={0.85} max={1.3} step={0.05} value={s.fontScale || 1} onChange={(e) => saveSettings({ fontScale: Number(e.target.value) })} /></Setting>
      <Setting title="Enviar con Enter" desc="Si lo desactivas, envía con Ctrl+Enter"><Toggle value={s.sendOnEnter !== false} onChange={(v) => saveSettings({ sendOnEnter: v })} /></Setting>
      <Setting title="Mostrar razonamiento" desc="Muestra el proceso de pensamiento de los modelos que razonan"><Toggle value={s.showReasoning !== false} onChange={(v) => saveSettings({ showReasoning: v })} /></Setting>
      <Setting title="Modelo predeterminado" desc="Para chats nuevos"><ModelPicker value={s.defaultModel} onChange={(m) => saveSettings({ defaultModel: m })} allowDefault /></Setting>
      <Setting title="Agente predeterminado"><select className="select" style={{ width: 220 }} value={s.defaultAgent} onChange={(e) => saveSettings({ defaultAgent: e.target.value })}>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Setting>
      <Setting title="Minimizar a la bandeja al cerrar" desc="Nexo sigue disponible (JARVIS, atajos) desde el icono de la bandeja"><Toggle value={s.closeToTray} onChange={(v) => saveSettings({ closeToTray: v })} /></Setting>
      <Setting title="Iniciar con el sistema"><Toggle value={s.launchAtLogin} onChange={(v) => saveSettings({ launchAtLogin: v })} /></Setting>
      <Field label="Instrucciones personalizadas" hint="Se añaden a todos los agentes (quién eres, cómo prefieres las respuestas…)">
        <textarea className="textarea" rows={5} defaultValue={s.customInstructions} onBlur={(e) => saveSettings({ customInstructions: e.target.value })} placeholder="Ej.: Me llamo Laura, soy diseñadora. Prefiero respuestas concisas y en español de España." />
      </Field>
    </>
  );
}

function ProviderCard({ p, types }) {
  const { toast, refreshProviders } = useStore();
  const [key, setKey] = useState('');
  const [base, setBase] = useState(p.baseUrl);
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState('');
  const [del, setDel] = useState(false);
  const t = types[p.type] || {};
  async function saveKey() { await call('prov.upsert', { id: p.id, apiKey: key, baseUrl: base }); setKey(''); await test(); }
  async function test() {
    setBusy(true);
    try { const r = await call('prov.test', p.id); toast(`${p.name}: conexión correcta (${r.count} modelos)`, 'success'); } catch (e) { toast(`${p.name}: ${e.message}`, 'error', 8000); }
    setBusy(false); refreshProviders();
  }
  return (
    <div className="card provider-card">
      <div className="row">
        <span className={`status-dot ${p.models?.length ? 'green' : ''}`} />
        <strong className="grow">{p.name}</strong>
        {t.keyUrl && <Button size="xs" variant="ghost" icon="external" onClick={() => call('app.openExternal', t.keyUrl)}>Obtener clave</Button>}
        <Toggle value={p.enabled} onChange={(v) => call('prov.upsert', { id: p.id, enabled: v }).then(refreshProviders)} />
        <IconButton icon="trash" size={15} onClick={() => setDel(true)} />
      </div>
      {!t.noKey && (
        <div className="row">
          <input className="input mono" type="password" placeholder={p.hasKey ? 'Clave guardada (cifrada) — escribe para reemplazar' : 'Pega tu clave API'} value={key} onChange={(e) => setKey(e.target.value)} />
          <Button size="sm" variant="primary" disabled={!key} onClick={saveKey}>Guardar</Button>
        </div>
      )}
      {(p.type === 'custom' || t.local || p.type === 'openrouter') && (
        <div className="row"><input className="input mono" value={base} onChange={(e) => setBase(e.target.value)} placeholder="URL base" /><Button size="sm" onClick={() => call('prov.upsert', { id: p.id, baseUrl: base }).then(test)}>Aplicar</Button></div>
      )}
      <div className="row small muted">
        <span className="grow">{p.models?.length ? `${p.models.length} modelos disponibles` : 'Sin modelos cargados'}{p.customModels?.length ? ` · ${p.customModels.length} personalizados` : ''}</span>
        <Button size="xs" icon="refresh" loading={busy} onClick={test}>Probar y listar modelos</Button>
      </div>
      <div className="row">
        <input className="input" style={{ height: 30 }} placeholder="Añadir ID de modelo manualmente" value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && custom.trim()) { call('prov.upsert', { id: p.id, customModels: [...(p.customModels || []), custom.trim()] }).then(refreshProviders); setCustom(''); } }} />
      </div>
      {p.customModels?.length > 0 && <div className="row wrap" style={{ gap: 4 }}>{p.customModels.map((m) => <span key={m} className="badge">{m}<Icon name="x" size={11} style={{ cursor: 'pointer' }} onClick={() => call('prov.upsert', { id: p.id, customModels: p.customModels.filter((x) => x !== m) }).then(refreshProviders)} /></span>)}</div>}
      {del && <Confirm title="Quitar proveedor" text={`¿Quitar ${p.name}? Se borrará su clave.`} danger confirmLabel="Quitar" onConfirm={() => call('prov.remove', p.id)} onClose={() => setDel(false)} />}
    </div>
  );
}

function Providers() {
  const { providers, providerTypes } = useStore();
  const [adding, setAdding] = useState(false);
  const missing = Object.entries(providerTypes).filter(([k]) => k === 'custom' || !providers.find((p) => p.type === k));
  return (
    <>
      <h2>Proveedores de IA (API)</h2>
      <p className="small muted" style={{ marginTop: -6 }}>Las claves se guardan cifradas con el almacén seguro de tu sistema operativo y solo se usan desde tu equipo.</p>
      <div className="col" style={{ gap: 12 }}>{providers.map((p) => <ProviderCard key={p.id} p={p} types={providerTypes} />)}</div>
      <div className="section-title">Añadir proveedor</div>
      <div className="row wrap" style={{ gap: 8 }}>
        {missing.map(([k, t]) => <Button key={k} size="sm" icon={t.local ? 'server' : 'cloud'} onClick={() => call('prov.upsert', { type: k })}>{t.name}</Button>)}
      </div>
    </>
  );
}

function LocalSettings() {
  const { settings: s, saveSettings } = useStore();
  return (
    <>
      <h2>Modelos locales</h2>
      <Setting title={`Contexto predeterminado: ${s.ctx} tokens`} desc="Más contexto permite conversaciones y documentos más largos pero usa más memoria"><select className="select" style={{ width: 150 }} value={s.ctx} onChange={(e) => saveSettings({ ctx: Number(e.target.value) })}>{[2048, 4096, 8192, 16384, 32768, 65536, 131072].map((v) => <option key={v} value={v}>{v.toLocaleString('es-ES')}</option>)}</select></Setting>
      <Setting title="KV caché" desc="Q8_0 reduce la memoria del contexto ~47% con pérdida mínima"><Seg value={s.kvType} onChange={(v) => saveSettings({ kvType: v })} options={[{ value: 'f16', label: 'F16' }, { value: 'q8_0', label: 'Q8_0' }, { value: 'q4_0', label: 'Q4_0' }]} /></Setting>
      <Setting title="Carga/descarga automática por turnos" desc="Si un modelo no cabe, descarga los inactivos para hacerle sitio (multi-modelo)"><Toggle value={s.autoSwap !== false} onChange={(v) => saveSettings({ autoSwap: v })} /></Setting>
      <Setting title="Descargar modelos inactivos tras" desc="Libera VRAM/RAM automáticamente"><select className="select" style={{ width: 150 }} value={s.autoUnloadMinutes} onChange={(e) => saveSettings({ autoUnloadMinutes: Number(e.target.value) })}><option value={0}>Nunca</option>{[5, 15, 30, 60, 180].map((v) => <option key={v} value={v}>{v} min</option>)}</select></Setting>
      <Setting title={`VRAM reservada: ${s.reserveVramMB} MB`} desc="Margen para el escritorio y otras aplicaciones"><input type="range" className="slider" style={{ width: 200 }} min={0} max={4096} step={128} value={s.reserveVramMB} onChange={(e) => saveSettings({ reserveVramMB: Number(e.target.value) })} /></Setting>
      <Setting title="Hilos de CPU" desc="0 = automático (núcleos físicos)"><input className="input" type="number" style={{ width: 100 }} min={0} max={128} value={s.threads} onChange={(e) => saveSettings({ threads: Number(e.target.value) })} /></Setting>
      <Setting title="Peticiones en paralelo por modelo" desc="Útil para agentes simultáneos; cada una reparte el contexto"><input className="input" type="number" style={{ width: 100 }} min={1} max={8} value={s.parallel} onChange={(e) => saveSettings({ parallel: Number(e.target.value) })} /></Setting>
      <Setting title="Forzar solo CPU"><Toggle value={s.backendOverride === 'cpu'} onChange={(v) => saveSettings({ backendOverride: v ? 'cpu' : '' })} /></Setting>
      <Setting title="Razonamiento predeterminado" desc="Para modelos que permiten ajustar cuánto piensan"><select className="select" style={{ width: 170 }} value={s.reasoningEffort} onChange={(e) => saveSettings({ reasoningEffort: e.target.value })}><option value="auto">Automático</option><option value="none">Sin razonamiento</option><option value="low">Bajo</option><option value="medium">Medio</option><option value="high">Alto</option></select></Setting>
    </>
  );
}

function Permissions() {
  const { settings: s, saveSettings } = useStore();
  const mode = s.permissions?.mode || 'smart';
  const opts = [
    { v: 'ask', icon: 'shield', t: 'Preguntar antes de modificar', d: 'Lecturas automáticas; cualquier escritura, comando, control del ratón o MCP requiere tu aprobación.' },
    { v: 'smart', icon: 'shield-check', t: 'Inteligente (recomendado)', d: 'Lecturas, archivos, navegador y control del PC automáticos; pide permiso para comandos del sistema, borrados y MCP.' },
    { v: 'full', icon: 'shield-alert', t: 'Acceso total', d: 'Los agentes actúan sin preguntar. Máxima autonomía: úsalo con modelos de confianza.' }
  ];
  return (
    <>
      <h2>Permisos y acceso al equipo</h2>
      <div className="col" style={{ gap: 10 }}>
        {opts.map((o) => (
          <div key={o.v} className={`choice ${mode === o.v ? 'on' : ''}`} onClick={() => saveSettings({ permissions: { mode: o.v } })}>
            <Icon name={o.icon} size={22} style={{ color: o.v === 'full' ? 'var(--amber)' : 'var(--accent-2)' }} />
            <div className="grow"><div style={{ fontWeight: 600 }}>{o.t}</div><div className="small muted">{o.d}</div></div>
            {mode === o.v && <Icon name="check-circle" size={18} style={{ color: 'var(--accent-2)' }} />}
          </div>
        ))}
      </div>
      <div className="section-title">Control del PC</div>
      <Setting title="Minimizar Nexo mientras controla el equipo" desc="Muestra una píldora flotante con botón de detener (Ctrl+Alt+Q)"><Toggle value={s.computer?.hideWindow !== false} onChange={(v) => saveSettings({ computer: { hideWindow: v } })} /></Setting>
      <Setting title="Captura tras cada acción" desc="El modelo verifica el resultado de cada clic o pulsación"><Toggle value={s.computer?.screenshotAfterAction !== false} onChange={(v) => saveSettings({ computer: { screenshotAfterAction: v } })} /></Setting>
      <Setting title="Resolución de las capturas" desc="Menor = más rápido y barato; mayor = más preciso"><select className="select" style={{ width: 150 }} value={s.computer?.maxScreenshotWidth || 1366} onChange={(e) => saveSettings({ computer: { maxScreenshotWidth: Number(e.target.value) } })}>{[1024, 1280, 1366, 1600, 1920].map((v) => <option key={v} value={v}>{v}px</option>)}</select></Setting>
      <Setting title="Directorio de trabajo de los agentes" desc={s.workspace}><Button size="sm" onClick={async () => { const d = await call('app.chooseFolder', 'Directorio de trabajo', s.workspace); if (d) saveSettings({ workspace: d }); }}>Cambiar…</Button></Setting>
      <Setting title="Navegador de los agentes" desc="«Chrome real» abre un Chrome con perfil propio de Nexo; «Mi Chrome» usa tu navegador de siempre (con tus sesiones) mediante la extensión de Nexo"><select className="select" style={{ width: 150 }} value={s.browser?.engine || 'embedded'} onChange={(e) => saveSettings({ browser: { engine: e.target.value } })}><option value="embedded">Integrado</option><option value="chrome">Chrome real</option><option value="extension">Mi Chrome (extensión)</option></select></Setting>
      {s.browser?.engine === 'extension' && <ExtSetup />}
      <Setting title="Abrir el navegador integrado cuando lo use un agente"><Toggle value={s.browser?.autoOpen !== false} onChange={(v) => saveSettings({ browser: { autoOpen: v } })} /></Setting>
    </>
  );
}

function VoiceSettings() {
  const { settings: s, saveSettings, toast, downloads } = useStore();
  const v = s.voice || {};
  const [rt, setRt] = useState(null);
  const [voices, setVoices] = useState([]);
  const [eleven, setEleven] = useState('');
  const reload = () => call('rt.get').then(setRt);
  const doneCount = Object.values(downloads).filter((d) => d.status === 'done').length;
  useEffect(() => { reload(); }, [doneCount]);
  useEffect(() => { const load = () => setVoices(speechSynthesis.getVoices()); load(); speechSynthesis.onvoiceschanged = load; }, []);
  const setV = (patch) => saveSettings({ voice: patch });
  const act = (p) => p.then(() => { toast('Descarga iniciada', 'success'); }).catch((e) => toast(e.message, 'error'));
  const active = Object.values(downloads).filter((d) => (d.kind === 'voice' || d.meta?.runtime === 'whisper' || d.meta?.runtime === 'piper') && d.status !== 'done');
  if (!rt) return <span className="spinner" />;
  const whisperOk = !!rt.whisper.installed;
  const piperOk = !!rt.piper.installed;
  return (
    <>
      <h2>Voz</h2>
      {active.map((d) => <DownloadRow key={d.id} d={d} />)}
      <div className="section-title">Voz a texto (escuchar)</div>
      <Setting title="Motor de transcripción"><Seg value={v.stt} onChange={(x) => setV({ stt: x })} options={[{ value: 'whisper-local', label: 'Whisper local' }, { value: 'groq', label: 'Groq (API)' }, { value: 'openai', label: 'OpenAI (API)' }]} /></Setting>
      {v.stt === 'whisper-local' && (
        <>
          <Setting title="Motor whisper.cpp" desc={whisperOk ? `Instalado (${rt.whisper.installed.tag}${rt.whisper.installed.gpu ? ', CUDA' : ''})` : 'Privado y gratuito, funciona sin internet'}>
            {!whisperOk ? <div className="row"><Button size="sm" variant="primary" onClick={() => act(call('rt.installWhisper', false))}>Instalar (CPU)</Button>{useStore.getState().hw?.recommendedBackend?.startsWith('cuda') && <Button size="sm" onClick={() => act(call('rt.installWhisper', true))}>Instalar (CUDA)</Button>}</div> : <Icon name="check-circle" size={18} style={{ color: 'var(--green)' }} />}
          </Setting>
          <Field label="Modelo de reconocimiento">
            <div className="col" style={{ gap: 6 }}>
              {rt.whisperModels.map((m) => {
                const have = rt.installedVoices.whisper.includes(m.id);
                return (
                  <div key={m.id} className={`choice ${v.whisperModel === m.id ? 'on' : ''}`} style={{ padding: '9px 12px' }} onClick={() => have && setV({ whisperModel: m.id })}>
                    <span className="grow small">{m.label}</span>
                    {have ? (v.whisperModel === m.id ? <Icon name="check-circle" size={16} style={{ color: 'var(--accent-2)' }} /> : <span className="tiny muted">clic para usar</span>) : <Button size="xs" icon="download" onClick={(e) => { e.stopPropagation(); act(call('rt.whisperModel', m.id)).then(() => setV({ whisperModel: m.id })); }}>Descargar</Button>}
                  </div>
                );
              })}
            </div>
          </Field>
        </>
      )}
      <Setting title="Idioma"><select className="select" style={{ width: 160 }} value={v.language} onChange={(e) => setV({ language: e.target.value })}><option value="es">Español</option><option value="en">Inglés</option><option value="auto">Detectar</option><option value="pt">Portugués</option><option value="fr">Francés</option><option value="de">Alemán</option><option value="it">Italiano</option></select></Setting>
      <Setting title={`Sensibilidad del micrófono: ${Math.round((v.vadThreshold ?? 0.5) * 100)}%`} desc="Más alta detecta voces más bajas (y más ruido)"><input type="range" className="slider" style={{ width: 200 }} min={0} max={1} step={0.05} value={v.vadThreshold ?? 0.5} onChange={(e) => setV({ vadThreshold: Number(e.target.value) })} /></Setting>
      <Setting title={`Pausa para enviar: ${v.silenceMs} ms`}><input type="range" className="slider" style={{ width: 200 }} min={400} max={2500} step={100} value={v.silenceMs} onChange={(e) => setV({ silenceMs: Number(e.target.value) })} /></Setting>

      <div className="section-title">Texto a voz (hablar)</div>
      <Setting title="Motor de voz"><Seg value={v.tts} onChange={(x) => setV({ tts: x })} options={[{ value: 'system', label: 'Sistema' }, { value: 'piper', label: 'Piper (neural local)' }, { value: 'openai', label: 'OpenAI' }, { value: 'elevenlabs', label: 'ElevenLabs' }]} /></Setting>
      {v.tts === 'system' && <Setting title="Voz del sistema" desc="Instala más voces en español desde la configuración de voz de Windows"><select className="select" style={{ width: 280 }} value={v.systemVoice} onChange={(e) => setV({ systemVoice: e.target.value })}><option value="">Automática ({v.language})</option>{voices.map((x) => <option key={x.name} value={x.name}>{x.name} ({x.lang})</option>)}</select></Setting>}
      {v.tts === 'piper' && (
        <>
          <Setting title="Motor Piper" desc={piperOk ? 'Instalado' : 'Voces neuronales naturales, 100% locales'}>{piperOk ? <Icon name="check-circle" size={18} style={{ color: 'var(--green)' }} /> : <Button size="sm" variant="primary" onClick={() => act(call('rt.installPiper'))}>Instalar</Button>}</Setting>
          <div className="col" style={{ gap: 6, marginBottom: 10 }}>
            {rt.piperVoices.map((p) => {
              const have = rt.installedVoices.piper.includes(p.id);
              return (
                <div key={p.id} className={`choice ${v.piperVoice === p.id ? 'on' : ''}`} style={{ padding: '9px 12px' }} onClick={() => have && setV({ piperVoice: p.id })}>
                  <span className="grow small">{p.label}</span>
                  {have ? (v.piperVoice === p.id ? <Icon name="check-circle" size={16} style={{ color: 'var(--accent-2)' }} /> : <span className="tiny muted">clic para usar</span>) : <Button size="xs" icon="download" onClick={(e) => { e.stopPropagation(); act(call('rt.piperVoice', p.id)).then(() => setV({ piperVoice: p.id })); }}>Descargar</Button>}
                </div>
              );
            })}
          </div>
        </>
      )}
      {v.tts === 'openai' && <Setting title="Voz de OpenAI" desc="Requiere clave de OpenAI en Proveedores"><select className="select" style={{ width: 180 }} value={v.openaiVoice} onChange={(e) => setV({ openaiVoice: e.target.value })}>{['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'].map((x) => <option key={x}>{x}</option>)}</select></Setting>}
      {v.tts === 'elevenlabs' && (
        <>
          <Setting title="Clave de ElevenLabs"><div className="row"><input className="input mono" type="password" style={{ width: 220 }} placeholder={s.secrets?.elevenlabs ? 'Guardada' : 'Pega la clave'} value={eleven} onChange={(e) => setEleven(e.target.value)} /><Button size="sm" onClick={() => { call('settings.setSecret', 'elevenlabs', eleven); setEleven(''); toast('Clave guardada', 'success'); }}>Guardar</Button></div></Setting>
          <Setting title="ID de voz" desc="Desde tu biblioteca de voces de ElevenLabs"><input className="input mono" style={{ width: 260 }} defaultValue={v.elevenVoice} onBlur={(e) => setV({ elevenVoice: e.target.value })} /></Setting>
        </>
      )}
      <Setting title={`Velocidad: ${v.rate}x`}><input type="range" className="slider" style={{ width: 200 }} min={0.6} max={1.8} step={0.1} value={v.rate} onChange={(e) => setV({ rate: Number(e.target.value) })} /></Setting>
      <Setting title="Probar voz"><Button size="sm" icon="volume" onClick={() => { const sp = getSpeaker(); sp.stop(); sp.speak('Hola, soy Nexo. Así sueno con la configuración actual.'); }}>Escuchar</Button></Setting>

      <div className="section-title">Modo JARVIS (manos libres)</div>
      <Setting title="Palabra de activación" desc='Di la palabra y tu orden, p. ej. "Jarvis, abre Spotify y pon música tranquila"'><input className="input" style={{ width: 180 }} defaultValue={v.wakeWord} onBlur={(e) => setV({ wakeWord: e.target.value.trim() || 'jarvis' })} /></Setting>
      <Setting title="Agente de JARVIS"><select className="select" style={{ width: 200 }} value={v.jarvisAgent} onChange={(e) => setV({ jarvisAgent: e.target.value })}>{useStore.getState().agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Setting>
      <Setting title="Modelo de JARVIS" desc="Un modelo rápido con herramientas da la mejor experiencia"><ModelPicker value={v.jarvisModel || null} onChange={(m) => { setV({ jarvisModel: m }); localStorage.removeItem('nexo.jarvisChat'); }} allowDefault /></Setting>
      <Setting title="Atajo global de voz" desc="Funciona aunque Nexo esté minimizado"><input className="input mono" style={{ width: 240 }} defaultValue={v.hotkey} onBlur={(e) => setV({ hotkey: e.target.value })} /></Setting>
      <Setting title="Activar modo JARVIS ahora"><Button size="sm" variant="primary" icon="radio" onClick={() => window.dispatchEvent(new CustomEvent('nexo-voice', { detail: 'jarvis-toggle' }))}>{useStore.getState().voice.mode === 'jarvis' ? 'Desactivar' : 'Activar'}</Button></Setting>
    </>
  );
}

function WebSettings() {
  const { settings: s, saveSettings, toast } = useStore();
  const [keys, setKeys] = useState({ brave: '', tavily: '', hfToken: '' });
  const saveKey = (k) => { call('settings.setSecret', k, keys[k]); setKeys({ ...keys, [k]: '' }); toast('Guardado', 'success'); call('settings.get').then((x) => useStore.setState({ settings: x })); };
  return (
    <>
      <h2>Web y búsquedas</h2>
      <Setting title="Motor de búsqueda de los agentes" desc="Automático no requiere claves (DuckDuckGo/Bing)"><select className="select" style={{ width: 200 }} value={s.web?.searchEngine || 'auto'} onChange={(e) => saveSettings({ web: { searchEngine: e.target.value } })}><option value="auto">Automático (sin clave)</option><option value="brave">Brave Search API</option><option value="tavily">Tavily</option><option value="searxng">SearXNG propio</option></select></Setting>
      {s.web?.searchEngine === 'brave' && <Setting title="Clave de Brave Search"><div className="row"><input className="input mono" type="password" style={{ width: 240 }} placeholder={s.secrets?.brave ? 'Guardada' : ''} value={keys.brave} onChange={(e) => setKeys({ ...keys, brave: e.target.value })} /><Button size="sm" onClick={() => saveKey('brave')}>Guardar</Button></div></Setting>}
      {s.web?.searchEngine === 'tavily' && <Setting title="Clave de Tavily"><div className="row"><input className="input mono" type="password" style={{ width: 240 }} placeholder={s.secrets?.tavily ? 'Guardada' : ''} value={keys.tavily} onChange={(e) => setKeys({ ...keys, tavily: e.target.value })} /><Button size="sm" onClick={() => saveKey('tavily')}>Guardar</Button></div></Setting>}
      {s.web?.searchEngine === 'searxng' && <Setting title="URL de SearXNG"><input className="input mono" style={{ width: 280 }} defaultValue={s.web?.searxngUrl} onBlur={(e) => saveSettings({ web: { searxngUrl: e.target.value } })} placeholder="http://localhost:8888" /></Setting>}
      <div className="section-title">Hugging Face</div>
      <Setting title="Token de Hugging Face" desc="Opcional: para modelos con licencia restringida (Llama, Gemma…) y más límite de descargas"><div className="row"><input className="input mono" type="password" style={{ width: 240 }} placeholder={s.secrets?.hfToken ? 'Guardado' : 'hf_…'} value={keys.hfToken} onChange={(e) => setKeys({ ...keys, hfToken: e.target.value })} /><Button size="sm" onClick={() => saveKey('hfToken')}>Guardar</Button></div></Setting>
    </>
  );
}

function MemorySettings() {
  const [mem, setMem] = useState(null);
  const [text, setText] = useState('');
  const reload = () => call('memory.list').then(setMem);
  useEffect(() => { reload(); }, []);
  if (!mem) return <span className="spinner" />;
  return (
    <>
      <h2>Memoria</h2>
      <p className="small muted" style={{ marginTop: -6 }}>Datos que los agentes recuerdan sobre ti entre conversaciones (se guardan solo en tu equipo).</p>
      <Setting title="Memoria activada"><Toggle value={mem.enabled} onChange={(v) => call('memory.enabled', v).then(reload)} /></Setting>
      <div className="row" style={{ margin: '12px 0' }}><input className="input" placeholder="Añadir un recuerdo (p. ej. Trabajo como arquitecto en Valencia)" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) { call('memory.add', text).then(reload); setText(''); } }} /><Button onClick={() => { if (text.trim()) { call('memory.add', text).then(reload); setText(''); } }}>Añadir</Button></div>
      <div className="list">
        {mem.items.map((m) => <div key={m.id} className="list-row"><Icon name="brain" size={15} className="faint" /><span className="grow small selectable">{m.text}</span><IconButton icon="trash" size={14} onClick={() => call('memory.delete', m.id).then(reload)} /></div>)}
        {!mem.items.length && <div className="list-row small muted">Sin recuerdos todavía. Los agentes guardarán aquí lo importante (o dile "recuerda que…").</div>}
      </div>
    </>
  );
}

function Storage() {
  const { info, toast } = useStore();
  const [st, setSt] = useState(null);
  const [move, setMove] = useState(null);
  useEffect(() => { call('app.storage').then(setSt); }, []);
  async function change() {
    const d = await call('app.chooseFolder', 'Nueva carpeta de datos de Nexo', info.dataDir);
    if (d && d !== info.dataDir) setMove(d);
  }
  return (
    <>
      <h2>Almacenamiento</h2>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row"><Icon name="disk" size={18} /><div className="grow"><div style={{ fontWeight: 600 }}>Carpeta de datos</div><div className="mono small muted">{info.dataDir}</div></div><Button size="sm" icon="folder-open" onClick={() => call('app.openPath', info.dataDir)}>Abrir</Button><Button size="sm" onClick={change}>Cambiar…</Button></div>
        {st && <div className="kv" style={{ marginTop: 14 }}><span>Modelos</span><span>{fmtBytes(st.models)}</span><span>Motores</span><span>{fmtBytes(st.runtimes)}</span><span>Voz</span><span>{fmtBytes(st.voice)}</span><span>Chats y adjuntos</span><span>{fmtBytes(st.chats)}</span>{st.disk && <><span>Espacio libre en el disco</span><span>{fmtBytes(st.disk.free)} de {fmtBytes(st.disk.total)}</span></>}</div>}
      </div>
      <p className="small muted">Todo lo que descarga Nexo (modelos, motores y voces) se guarda en esta carpeta. Puedes moverla a otro disco con más espacio.</p>
      {move && (
        <Modal title="Cambiar carpeta de datos" onClose={() => setMove(null)} footer={<>
          <Button variant="ghost" onClick={() => setMove(null)}>Cancelar</Button>
          <Button onClick={() => call('app.setDataDir', move, { move: false }).catch((e) => toast(e.message, 'error'))}>Usar vacía</Button>
          <Button variant="primary" onClick={() => { toast('Copiando datos… Nexo se reiniciará', 'info', 10000); call('app.setDataDir', move, { move: true }).catch((e) => toast(e.message, 'error')); }}>Copiar mis datos y reiniciar</Button>
        </>}>
          <p className="small" style={{ marginTop: 0 }}>Nueva ubicación: <span className="mono">{move}</span></p>
          <p className="small muted">"Copiar" traslada modelos, chats y ajustes (puede tardar si tienes modelos grandes). La carpeta antigua no se borra.</p>
        </Modal>
      )}
    </>
  );
}

function About() {
  const info = useStore((s) => s.info);
  return (
    <>
      <h2>Acerca de Nexo AI</h2>
      <div className="card row"><div className="logo-mark" style={{ width: 44, height: 44, borderRadius: 13 }} /><div><div style={{ fontWeight: 650, fontSize: 16 }}>Nexo AI {info.version}</div><div className="small muted">Electron {info.electron} · {info.platform} {info.arch}</div></div></div>
      <p className="small muted">Motores de código abierto: llama.cpp, whisper.cpp y Piper. Modelos de Hugging Face bajo sus respectivas licencias. Protocolo MCP de Anthropic.</p>
      <h3 style={{ marginTop: 20 }}>Atajos de teclado</h3>
      <div className="kv small" style={{ marginTop: 8 }}>
        <span><kbd>Ctrl K</kbd></span><span>Paleta de comandos / búsqueda</span>
        <span><kbd>Ctrl N</kbd></span><span>Nuevo chat</span>
        <span><kbd>Ctrl B</kbd></span><span>Mostrar/ocultar historial</span>
        <span><kbd>Ctrl ,</kbd></span><span>Ajustes</span>
        <span><kbd>Ctrl Shift Espacio</kbd></span><span>Voz (global)</span>
        <span><kbd>Ctrl Alt Q</kbd></span><span>Detener el control del PC</span>
        <span><kbd>Esc</kbd></span><span>Detener la respuesta</span>
      </div>
    </>
  );
}

function AgentSettings() {
  const { settings: s, saveSettings, toast } = useStore();
  const oc = s.opencode || {};
  const [st, setSt] = useState(null);
  const [hooksText, setHooksText] = useState(JSON.stringify(s.hooks || [], null, 2));
  const [hooksErr, setHooksErr] = useState(null);
  useEffect(() => { call('opencode.status').then(setSt).catch(() => setSt({ installed: false })); }, [oc.path]);
  const saveHooks = () => {
    try {
      const v = JSON.parse(hooksText || '[]');
      if (!Array.isArray(v)) throw new Error('Debe ser una lista [...]');
      for (const h of v) if (!['before_tool', 'after_tool', 'stop'].includes(h.event) || !h.command) throw new Error('Cada hook necesita event (before_tool, after_tool o stop) y command');
      saveSettings({ hooks: v }); setHooksErr(null); toast('Hooks guardados', 'success');
    } catch (e) { setHooksErr(e.message); }
  };
  return (
    <>
      <h2>Agentes</h2>
      <Setting title="Compactar automáticamente las conversaciones largas" desc="Cuando el contexto se llena, el modelo resume la parte antigua y sigue trabajando sin perder el hilo (como Claude Code)"><Toggle value={s.autoCompact !== false} onChange={(v) => saveSettings({ autoCompact: v })} /></Setting>
      <div className="small muted" style={{ margin: '4px 0 14px' }}>Instrucciones de proyecto: si la carpeta de trabajo del chat (o una superior) tiene un archivo <code>AGENTS.md</code>, <code>NEXO.md</code> o <code>CLAUDE.md</code>, los agentes lo leen y lo siguen siempre. Elige la carpeta del proyecto con el icono de carpeta del compositor.</div>
      <div className="section-title">OpenCode</div>
      <div className="card row" style={{ marginBottom: 12 }}>
        <Icon name="terminal" size={20} style={{ color: st?.installed ? 'var(--green)' : 'var(--amber)' }} />
        <div className="grow">{st === null ? 'Comprobando…' : st.installed ? <><strong>OpenCode {st.version}</strong><div className="tiny muted mono">{st.path}</div></> : <><strong>OpenCode no encontrado</strong><div className="small muted">Instálalo con <code>npm i -g opencode-ai</code> o indica la ruta del ejecutable.</div></>}</div>
      </div>
      <Setting title="Ruta de OpenCode (opcional)" desc="Déjala vacía para detectarla automáticamente"><input className="input mono" style={{ width: 320 }} placeholder="Automático" defaultValue={oc.path || ''} onBlur={(e) => saveSettings({ opencode: { path: e.target.value.trim() } })} /></Setting>
      <Setting title="Modelo predeterminado para OpenCode" desc="Modelo de la nube o por API, formato proveedor/modelo (p. ej. opencode/big-pickle). Vacío = el predeterminado de OpenCode. También se puede elegir en cada chat."><input className="input mono" style={{ width: 320 }} placeholder="Predeterminado de OpenCode" defaultValue={oc.model || ''} onBlur={(e) => saveSettings({ opencode: { model: e.target.value.trim() } })} /></Setting>
      <Setting title="Aprobar automáticamente los permisos de OpenCode" desc="Con «Acceso total» siempre se aprueban. Actívalo para que OpenCode no se detenga en otros modos."><Toggle value={!!oc.autoApprove} onChange={(v) => saveSettings({ opencode: { autoApprove: v } })} /></Setting>
      <Setting title="Usar REA (ingeniería inversa) en OpenCode" desc="Añade las ~170 herramientas de REA. Ojo: ocupan unos 70.000 tokens por mensaje (modo compact); úsalo con modelos de contexto grande. Los que no lo aceptan se reintentan sin REA."><Toggle value={oc.rea === true} onChange={(v) => saveSettings({ opencode: { rea: v } })} /></Setting>
      <div className="section-title">Hooks</div>
      <div className="small muted" style={{ marginBottom: 8 }}>Comandos de {navigator.platform.startsWith('Win') ? 'PowerShell' : 'shell'} que se ejecutan automáticamente. <code>before_tool</code>: antes de cada herramienta (si termina con código 2, la bloquea y el motivo se le pasa al modelo). <code>after_tool</code>: después (su salida se añade al resultado). <code>stop</code>: al terminar cada respuesta. Variables: NEXO_TOOL, NEXO_ARGS, NEXO_RESULT, NEXO_CHAT_ID, NEXO_WORKSPACE. <code>match</code> es una expresión regular sobre el nombre de la herramienta.</div>
      <textarea className="textarea mono small" rows={8} value={hooksText} onChange={(e) => setHooksText(e.target.value)} placeholder={'[\n  { "event": "after_tool", "match": "write_file|edit_file", "command": "npx prettier --write $env:NEXO_WORKSPACE" }\n]'} />
      {hooksErr && <div className="small" style={{ color: 'var(--red)', marginTop: 6 }}>{hooksErr}</div>}
      <div className="row" style={{ marginTop: 8 }}><Button size="sm" variant="primary" onClick={saveHooks}>Guardar hooks</Button></div>
    </>
  );
}

const SECTIONS = [
  ['general', 'General', 'settings'], ['providers', 'Proveedores API', 'key'], ['local', 'Modelos locales', 'disk'], ['agents', 'Agentes y OpenCode', 'bot'], ['permissions', 'Permisos y PC', 'shield-check'],
  ['voice', 'Voz y JARVIS', 'audio-lines'], ['web', 'Web y tokens', 'globe'], ['memory', 'Memoria', 'brain'], ['storage', 'Almacenamiento', 'folder'], ['about', 'Acerca de', 'info']
];

export default function SettingsView() {
  const { settingsTab, settings } = useStore();
  const tab = settingsTab || 'general';
  if (!settings) return null;
  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-header"><div><h1>Ajustes</h1></div></div>
        <div className="settings-layout">
          <nav className="settings-nav">{SECTIONS.map(([k, l, i]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => useStore.setState({ settingsTab: k })}><Icon name={i} size={16} />{l}</button>)}</nav>
          <div className="settings-content">
            {tab === 'general' && <General />}
            {tab === 'providers' && <Providers />}
            {tab === 'local' && <LocalSettings />}
            {tab === 'agents' && <AgentSettings />}
            {tab === 'permissions' && <Permissions />}
            {tab === 'voice' && <VoiceSettings />}
            {tab === 'web' && <WebSettings />}
            {tab === 'memory' && <MemorySettings />}
            {tab === 'storage' && <Storage />}
            {tab === 'about' && <About />}
          </div>
        </div>
      </div>
    </div>
  );
}
