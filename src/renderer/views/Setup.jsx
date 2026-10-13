import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../lib/store.js';
import { call, fmtBytes, fmtParams } from '../lib/api.js';
import Icon from '../components/Icon.jsx';
import { Button, Progress } from '../components/ui.jsx';
import { FitPill } from '../components/ModelPicker.jsx';
import { planModel, staticBudget, QUANT_BPW } from '../../shared/fit.js';

function pickStarters(catalog, hw) {
  if (!catalog || !hw) return [];
  const budget = staticBudget(hw);
  const all = catalog.models.map((m) => {
    const cands = m.quants.filter((q) => ['Q4_K_M', 'Q4_K_XL', 'MXFP4', 'MXFP4_MOE', 'Q5_K_M', 'Q6_K', 'Q8_0'].includes(q.quant)).map((q) => ({ q, p: planModel(m.meta || { params: m.params }, budget, { ctx: 8192, fileSize: q.size }) }));
    const best = cands.filter((c) => c.p.rating === 'fluido' && (QUANT_BPW[c.q.quant] || 5) <= 6.7).sort((a, b) => b.q.size - a.q.size)[0] || cands.filter((c) => c.p.fits).sort((a, b) => b.p.tps - a.p.tps)[0];
    return best ? { m, ...best } : null;
  }).filter(Boolean);
  const scored = all.filter((x) => x.m.tags?.includes('recomendado') || x.m.caps?.includes('computer'));
  const fluid = scored.filter((x) => x.p.rating === 'fluido').sort((a, b) => b.m.params - a.m.params);
  const out = [];
  if (fluid[0]) out.push({ ...fluid[0], label: 'El más potente que va fluido', icon: 'rocket' });
  const balanced = fluid.find((x) => x.m.params < (fluid[0]?.m.params || 0) * 0.6 && x.m.caps?.includes('tools'));
  if (balanced) out.push({ ...balanced, label: 'Equilibrado y rápido', icon: 'zap' });
  const pc = scored.filter((x) => x.m.caps?.includes('computer') && x.p.fits).sort((a, b) => (a.p.rating === 'fluido' ? -1 : 1) - (b.p.rating === 'fluido' ? -1 : 1) || b.m.params - a.m.params)[0];
  if (pc && !out.find((o) => o.m.id === pc.m.id)) out.push({ ...pc, label: 'Especialista en controlar el PC', icon: 'mouse-pointer-click' });
  if (!out.length) {
    const light = all.filter((x) => x.p.fits).sort((a, b) => (RANKS[a.p.rating] - RANKS[b.p.rating]) || (b.m.params - a.m.params));
    if (light[0]) out.push({ ...light[0], label: 'El mejor que cabe en tu equipo', icon: 'zap' });
    const fastest = all.filter((x) => x.p.fits && x.m.id !== light[0]?.m.id).sort((a, b) => b.p.tps - a.p.tps)[0];
    if (fastest) out.push({ ...fastest, label: 'El más ligero y rápido', icon: 'rocket' });
  }
  return out.slice(0, 3);
}
const RANKS = { fluido: 0, bueno: 1, lento: 2, muylento: 3, nofit: 4 };

export default function Setup() {
  const { info, boot, downloads } = useStore();
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(info.defaultDataDir);
  const [disk, setDisk] = useState(null);
  const [err, setErr] = useState(null);
  const [hw, setHw] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [picked, setPicked] = useState(null);
  const [engineStarted, setEngineStarted] = useState(false);
  const [keys, setKeys] = useState({ openai: '', anthropic: '', gemini: '', openrouter: '', groq: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { call('app.disk', dir).then(setDisk).catch(() => setDisk(null)); }, [dir]);
  const starters = useMemo(() => pickStarters(catalog, hw), [catalog, hw]);
  useEffect(() => { if (starters[0] && !picked) setPicked(starters[0].m.id); }, [starters]);

  async function confirmDir() {
    setBusy(true); setErr(null);
    try {
      await call('app.setDataDir', dir);
      await boot();
      setStep(1);
      call('hw.scan', true).then((h) => { setHw(h); useStore.setState({ hw: h }); });
      call('catalog.get').then(setCatalog);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }
  async function installEngine() {
    try { await call('rt.installLlama', hw.recommendedBackend); setEngineStarted(true); } catch (e) { setErr(e.message); }
  }
  async function downloadStarter() {
    const s = starters.find((x) => x.m.id === picked);
    if (s) { try { await call('models.download', { repo: s.m.repo, quant: s.q.name, withVision: true }); } catch (e) { setErr(e.message); return; } }
    setStep(3);
  }
  async function finish() {
    setBusy(true);
    for (const [type, apiKey] of Object.entries(keys)) if (apiKey.trim()) { try { const p = await call('prov.upsert', { type, apiKey: apiKey.trim() }); call('prov.models', p.id).catch(() => { }); } catch { } }
    await useStore.getState().saveSettings({ setupDone: true });
    await useStore.getState().loadAll();
    useStore.setState({ info: await call('app.info'), view: 'chat', setupActive: false });
    setBusy(false);
  }
  const dls = Object.values(downloads);
  const gpu = hw?.gpus?.filter((g) => g.usable).sort((a, b) => b.vram - a.vram)[0];

  return (
    <div className="setup">
      <div className="setup-card">
        <div className="steps">{[0, 1, 2, 3].map((i) => <span key={i} className={i <= step ? 'on' : ''} />)}</div>
        {step === 0 && (
          <>
            <div className="orb" style={{ width: 54, height: 54, marginTop: 18 }} />
            <h1>Bienvenido a Nexo AI</h1>
            <p className="muted">Tu estudio de IA: modelos locales y en la nube, agentes que usan tu ordenador, MCP, skills, navegador y voz. Primero, elige dónde guardar los modelos y datos (pueden ocupar bastante: elige un disco con espacio).</p>
            <div className="card row" style={{ margin: '18px 0' }}>
              <Icon name="disk" size={22} style={{ color: 'var(--accent-2)' }} />
              <div className="grow"><div className="mono small" style={{ wordBreak: 'break-all' }}>{dir}</div>{disk && <div className="tiny muted">Espacio libre en este disco: {fmtBytes(disk.free)} de {fmtBytes(disk.total)}</div>}</div>
              <Button icon="folder-open" onClick={async () => { const d = await call('app.chooseFolder', 'Carpeta para modelos y datos de Nexo', dir); if (d) setDir(d.endsWith('Nexo') || d.includes('Nexo') ? d : d.replace(/[\\/]$/, '') + (info.platform === 'win32' ? '\\' : '/') + 'NexoData'); }}>Cambiar</Button>
            </div>
            {disk && disk.free < 20 * 1024 ** 3 && <div className="notice">Hay menos de 20 GB libres en este disco; considera otro para los modelos.</div>}
            {err && <div className="error-box">{err}</div>}
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}><Button variant="primary" size="lg" loading={busy} onClick={confirmDir}>Continuar<Icon name="arrow-right" size={16} /></Button></div>
          </>
        )}
        {step === 1 && (
          <>
            <h1>Tu equipo</h1>
            {!hw ? <div className="row" style={{ padding: 20 }}><span className="spinner" />Analizando CPU, RAM y GPU…</div> : (
              <>
                <div className="grid-3" style={{ margin: '14px 0' }}>
                  <div className="card"><div className="tiny muted">Procesador</div><div className="small" style={{ fontWeight: 600 }}>{hw.cpu.name}</div><div className="tiny muted">{hw.cpu.physical} núcleos</div></div>
                  <div className="card"><div className="tiny muted">Memoria</div><div style={{ fontWeight: 650, fontSize: 18 }}>{fmtBytes(hw.ram.total, 0)}</div><div className="tiny muted">{hw.ram.type}</div></div>
                  <div className="card"><div className="tiny muted">Gráfica</div><div className="small" style={{ fontWeight: 600 }}>{gpu?.name || 'Sin GPU dedicada'}</div><div className="tiny muted">{gpu ? fmtBytes(gpu.vram) + ' VRAM' : 'Se usará la CPU'}</div></div>
                </div>
                <div className="card row">
                  <Icon name="zap" size={20} style={{ color: 'var(--accent-2)' }} />
                  <div className="grow"><div style={{ fontWeight: 600 }}>Motor local recomendado: {{ cuda12: 'NVIDIA CUDA 12', cuda13: 'NVIDIA CUDA 13', vulkan: 'Vulkan', metal: 'Apple Metal', cpu: 'CPU' }[hw.recommendedBackend]}</div><div className="small muted">llama.cpp optimizado para tu hardware. Necesario para ejecutar modelos locales.</div></div>
                  {!engineStarted ? <Button variant="primary" icon="download" onClick={installEngine}>Instalar</Button> : <span className="badge green">Descargando</span>}
                </div>
                {dls.filter((d) => d.kind === 'runtime').map((d) => <div key={d.id} style={{ marginTop: 10 }}><div className="small row"><span className="grow">{d.label}</span>{d.status === 'done' ? <Icon name="check-circle" size={15} style={{ color: 'var(--green)' }} /> : <span className="muted">{fmtBytes(d.received)} / {fmtBytes(d.total)}</span>}</div>{d.status !== 'done' && <Progress value={(d.received / Math.max(1, d.total)) * 100} />}{d.error && <div className="tiny" style={{ color: 'var(--red)' }}>{d.error}</div>}</div>)}
              </>
            )}
            {err && <div className="error-box">{err}</div>}
            <div className="row" style={{ justifyContent: 'space-between', marginTop: 20 }}><Button variant="ghost" onClick={() => setStep(2)}>Omitir</Button><Button variant="primary" size="lg" disabled={!hw} onClick={() => setStep(2)}>Continuar<Icon name="arrow-right" size={16} /></Button></div>
          </>
        )}
        {step === 2 && (
          <>
            <h1>Elige tu primer modelo</h1>
            <p className="muted">Seleccionados según tu equipo. Puedes descargar más en cualquier momento desde "Modelos".</p>
            <div className="col" style={{ gap: 10, margin: '16px 0' }}>
              {starters.map((s) => (
                <div key={s.m.id} className={`choice ${picked === s.m.id ? 'on' : ''}`} onClick={() => setPicked(s.m.id)}>
                  <Icon name={s.icon} size={20} style={{ color: 'var(--accent-2)' }} />
                  <div className="grow"><div className="tiny muted">{s.label}</div><div style={{ fontWeight: 620 }}>{s.m.name} <span className="muted small">· {fmtParams(s.m.params)} · {s.q.quant} · {fmtBytes(s.q.size)}</span></div><div className="small muted">{s.m.desc}</div></div>
                  <FitPill plan={s.p} />
                </div>
              ))}
              {!starters.length && (!catalog || !hw) && <div className="row"><span className="spinner" />Calculando recomendaciones…</div>}
              {!starters.length && catalog && hw && <div className="notice">Tu equipo tiene poca memoria libre para modelos locales. Te recomendamos usar modelos por API (siguiente paso) o probar los más pequeños desde "Modelos".</div>}
            </div>
            {err && <div className="error-box">{err}</div>}
            <div className="row" style={{ justifyContent: 'space-between' }}><Button variant="ghost" onClick={() => setStep(3)}>Omitir (usaré APIs)</Button><Button variant="primary" size="lg" disabled={!picked} onClick={downloadStarter}>Descargar y continuar<Icon name="arrow-right" size={16} /></Button></div>
          </>
        )}
        {step === 3 && (
          <>
            <h1>Modelos en la nube (opcional)</h1>
            <p className="muted">Añade claves de API para usar modelos como GPT, Claude o Gemini junto a los locales. Se guardan cifradas en tu equipo.</p>
            <div className="col" style={{ gap: 10, margin: '16px 0' }}>
              {[['openai', 'OpenAI'], ['anthropic', 'Anthropic (Claude)'], ['gemini', 'Google Gemini'], ['openrouter', 'OpenRouter (cientos de modelos)'], ['groq', 'Groq (ultrarrápido)']].map(([k, l]) => (
                <div key={k} className="row"><span className="small" style={{ width: 220 }}>{l}</span><input className="input mono" type="password" placeholder="Clave API (opcional)" value={keys[k]} onChange={(e) => setKeys({ ...keys, [k]: e.target.value })} /></div>
              ))}
            </div>
            <p className="small muted">Si usas Ollama o LM Studio, Nexo los detecta automáticamente.</p>
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}><Button variant="primary" size="lg" loading={busy} onClick={finish}>Empezar a usar Nexo<Icon name="sparkles" size={16} /></Button></div>
          </>
        )}
      </div>
    </div>
  );
}
