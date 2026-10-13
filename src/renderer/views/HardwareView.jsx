import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../lib/store.js';
import { call, fmtBytes, fmtParams, RATING } from '../lib/api.js';
import Icon from '../components/Icon.jsx';
import { Button } from '../components/ui.jsx';
import { FitPill } from '../components/ModelPicker.jsx';
import { planModel, staticBudget, QUANT_BPW } from '../../shared/fit.js';

function Spark({ data, max, color }) {
  const w = 300, h = 46;
  const pts = data.map((v, i) => `${(i / Math.max(1, data.length - 1)) * w},${h - (v / Math.max(1e-9, max)) * (h - 4) - 2}`).join(' ');
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polyline points={`0,${h} ${pts} ${w},${h}`} fill={`color-mix(in oklab, ${color} 18%, transparent)`} stroke="none" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export default function HardwareView() {
  const { hw, settings } = useStore();
  const [live, setLive] = useState(null);
  const hist = useRef({ ram: [], vram: [] });
  const [, force] = useState(0);
  const [catalog, setCatalog] = useState(null);
  const [scanning, setScanning] = useState(false);
  useEffect(() => { call('catalog.get').then(setCatalog); }, []);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const l = await call('hw.live');
        if (!alive) return;
        setLive(l);
        hist.current.ram.push(l.ram.total - l.ram.free); if (hist.current.ram.length > 60) hist.current.ram.shift();
        if (l.gpus[0]) { hist.current.vram.push(l.gpus[0].used || 0); if (hist.current.vram.length > 60) hist.current.vram.shift(); }
        force((x) => x + 1);
      } catch { }
    };
    tick();
    const t = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  const budget = hw ? staticBudget(hw) : null;
  const tiers = useMemo(() => {
    if (!catalog || !budget) return null;
    const out = { fluido: [], bueno: [], lento: [], nofit: [] };
    for (const m of catalog.models) {
      const cands = m.quants.filter((q) => (QUANT_BPW[q.quant] || 5) >= 3.4 && (QUANT_BPW[q.quant] || 5) <= 6.7).map((q) => ({ q, p: planModel(m.meta || { params: m.params }, budget, { ctx: settings?.ctx || 8192, fileSize: q.size }) })).sort((a, b) => (RANK[a.p.rating] - RANK[b.p.rating]) || (b.q.size - a.q.size));
      const best = cands[0];
      if (!best) continue;
      const k = best.p.rating === 'muylento' ? 'lento' : best.p.rating;
      out[k]?.push({ m, ...best });
    }
    for (const k of Object.keys(out)) out[k].sort((a, b) => b.m.params - a.m.params);
    return out;
  }, [catalog, budget, settings?.ctx]);

  if (!hw) return <div className="page"><div className="row"><span className="spinner" />Analizando el equipo…</div></div>;
  const gpus = hw.gpus;
  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-header">
          <div><h1>Tu equipo</h1><p>Nexo analiza tu hardware para recomendarte los modelos que funcionan con fluidez y los que funcionan aunque más lentos.</p></div>
          <div className="actions"><Button icon="refresh" loading={scanning} onClick={async () => { setScanning(true); const h = await call('hw.scan', true); useStore.setState({ hw: h }); setScanning(false); }}>Volver a analizar</Button></div>
        </div>
        <div className="grid-3" style={{ marginBottom: 18 }}>
          <div className="card hw-card">
            <div className="hw-title"><span className="ic"><Icon name="cpu" size={18} /></span><strong>Procesador</strong></div>
            <div className="small">{hw.cpu.name}</div>
            <div className="kv"><span>Núcleos</span><span>{hw.cpu.physical} físicos · {hw.cpu.logical} hilos</span><span>Arquitectura</span><span>{hw.cpu.arch}</span><span>Sistema</span><span>{hw.os.platform} {hw.os.release}</span></div>
          </div>
          <div className="card hw-card">
            <div className="hw-title"><span className="ic"><Icon name="ram" size={18} /></span><strong>Memoria RAM</strong></div>
            <div className="row"><div className="stat"><span className="v">{fmtBytes(hw.ram.total, 0)}</span><span className="k">{hw.ram.type} {hw.ram.speed ? `${hw.ram.speed} MT/s` : ''}</span></div><span className="grow" />{live && <div className="stat" style={{ textAlign: 'right' }}><span className="v" style={{ fontSize: 16 }}>{fmtBytes(live.ram.total - live.ram.free)}</span><span className="k">en uso</span></div>}</div>
            <Spark data={hist.current.ram} max={hw.ram.total} color="var(--amber)" />
            <div className="kv"><span>Ancho de banda est.</span><span>~{hw.ram.bandwidth || '?'} GB/s</span><span>Para modelos</span><span>{fmtBytes(budget.ram)} utilizables</span></div>
          </div>
          <div className="card hw-card">
            <div className="hw-title"><span className="ic"><Icon name="monitor" size={18} /></span><strong>Gráficos</strong></div>
            {gpus.length ? gpus.map((g, i) => (
              <div key={i} className="col" style={{ gap: 4 }}>
                <div className="small row">{g.name}{g.integrated && <span className="badge">integrada</span>}</div>
                <div className="kv"><span>VRAM</span><span>{g.unified ? `memoria unificada (${fmtBytes(budget.vram)} usable)` : fmtBytes(g.vram)}</span>{g.driver && <><span>Driver</span><span>{g.driver}</span></>}<span>Ancho de banda</span><span>~{g.bandwidth} GB/s</span></div>
              </div>
            )) : <div className="small muted">No se detectó GPU dedicada. Los modelos se ejecutarán en la CPU.</div>}
            {live?.gpus?.[0] && <><Spark data={hist.current.vram} max={live.gpus[0].vram} color="var(--accent)" /><div className="small muted">{fmtBytes(live.gpus[0].used)} / {fmtBytes(live.gpus[0].vram)} en uso{live.gpus[0].util !== undefined ? ` · ${live.gpus[0].util}% uso · ${live.gpus[0].temp}°C` : ''}</div></>}
          </div>
        </div>
        <div className="card row" style={{ marginBottom: 22 }}>
          <Icon name="zap" size={20} style={{ color: 'var(--accent-2)' }} />
          <div className="grow"><strong>Motor recomendado: {{ cuda12: 'NVIDIA CUDA 12', cuda13: 'NVIDIA CUDA 13', vulkan: 'Vulkan', metal: 'Apple Metal', cpu: 'CPU' }[hw.recommendedBackend]}</strong><div className="small muted">Presupuesto para modelos: {budget.hasGpu ? `${fmtBytes(budget.vram)} de VRAM + ` : ''}{fmtBytes(budget.ram)} de RAM (con offload automático por capas o expertos MoE).</div></div>
          <Button size="sm" onClick={() => useStore.getState().setView('models', { modelsTab: 'engine' })}>Gestionar motor</Button>
        </div>
        {tiers && [['fluido', 'Van fluidos en tu equipo', 'Caben en la GPU (o son MoE eficientes): respuestas rápidas.'], ['bueno', 'Funcionan bien', 'Parte del modelo en RAM; velocidad correcta para uso diario.'], ['lento', 'Funcionan, pero lentos', 'Se pueden ejecutar con offload a la RAM; útiles para tareas sin prisa.'], ['nofit', 'No caben', 'Necesitarían más memoria de la disponible.']].map(([k, title, desc]) => tiers[k].length > 0 && (
          <div key={k}>
            <div className="section-title" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span className="status-dot" style={{ background: RATING[k].color }} />{title} ({tiers[k].length})</div>
            <p className="small muted" style={{ marginTop: -4 }}>{desc}</p>
            <div className="list" style={{ marginBottom: 8 }}>
              {tiers[k].slice(0, k === 'nofit' ? 6 : 50).map(({ m, q, p }) => (
                <div key={m.id} className="list-row" style={{ padding: '10px 16px' }}>
                  <strong className="grow ellipsis">{m.name}</strong>
                  <span className="small muted">{fmtParams(m.params)} · {q.quant} · {fmtBytes(q.size)}</span>
                  <FitPill plan={p} />
                  <Button size="xs" icon="download" onClick={() => useStore.getState().setView('models', { modelsTab: 'discover' })}>Ver</Button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
const RANK = { fluido: 0, bueno: 1, lento: 2, muylento: 3, nofit: 4 };
