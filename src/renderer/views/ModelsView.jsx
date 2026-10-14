import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../lib/store.js';
import { call, fmtBytes, fmtNum, fmtParams, fmtDuration, colorFor, RATING, CAPS, timeAgo } from '../lib/api.js';
import Icon from '../components/Icon.jsx';
import { Button, IconButton, Tabs, Drawer, Seg, Toggle, Empty, Progress, Modal, Confirm, Field } from '../components/ui.jsx';
import { FitPill } from '../components/ModelPicker.jsx';
import { planModel, planMulti, staticBudget, quantQuality, plausibleQuant, QUANT_BPW, GiB } from '../../shared/fit.js';
import { TASKS, GROUPS, rankForTask, groupOf } from '../../shared/tasks.js';

// ───────── helpers ─────────
function bestQuant(model, budget, ctx) {
  if (!model.quants?.length || !budget) return null;
  const plans = model.quants.filter((q) => plausibleQuant(q, model.params) && (QUANT_BPW[q.quant] || 5) >= 3.4 && (QUANT_BPW[q.quant] || 5) <= 8.6).map((q) => ({ q, p: planModel(model.meta || { params: model.params }, budget, { ctx, fileSize: q.size }) }));
  plans.sort((a, b) => b.q.size - a.q.size);
  const rec = model.quants.find((q) => q.quant === model.recommended);
  const pick = plans.find((x) => x.p.rating === 'fluido' && (QUANT_BPW[x.q.quant] || 5) <= 6.7) || plans.find((x) => x.p.rating === 'bueno') || plans.find((x) => x.p.fits);
  if (pick) return pick;
  if (rec) return { q: rec, p: planModel(model.meta || { params: model.params }, budget, { ctx, fileSize: rec.size }) };
  const smallest = model.quants[0];
  return { q: smallest, p: planModel(model.meta || { params: model.params }, budget, { ctx, fileSize: smallest.size }) };
}

function Caps({ caps = [], max = 6 }) {
  return <>{caps.filter((c) => CAPS[c]).slice(0, max).map((c) => <span key={c} className="badge"><Icon name={CAPS[c].icon} size={11} />{CAPS[c].label}</span>)}</>;
}

function MemBar({ plan, budget }) {
  if (!plan) return null;
  const total = Math.max(plan.gpuBytes + plan.cpuBytes, 1);
  const gpuPct = (plan.gpuBytes / total) * 100;
  return (
    <div>
      <div className="mem-bar">
        {plan.gpuBytes > 0 && <span style={{ width: `${gpuPct}%`, background: 'linear-gradient(90deg, var(--accent), var(--accent-2))' }}>{gpuPct > 18 ? `GPU ${fmtBytes(plan.gpuBytes)}` : ''}</span>}
        {plan.cpuBytes > 0 && <span style={{ width: `${100 - gpuPct}%`, background: 'color-mix(in oklab, var(--amber) 70%, #333)' }}>{100 - gpuPct > 18 ? `RAM ${fmtBytes(plan.cpuBytes)}` : ''}</span>}
      </div>
      <div className="legend">
        <span><i style={{ background: 'var(--accent)' }} />VRAM: {fmtBytes(plan.gpuBytes)}{budget?.hasGpu ? ` de ${fmtBytes(budget.vram)}` : ''}</span>
        <span><i style={{ background: 'var(--amber)' }} />RAM: {fmtBytes(plan.cpuBytes)} de {fmtBytes(budget?.ram)}</span>
        <span>KV caché: {fmtBytes(plan.kvBytes)}</span>
        <span>Capas en GPU: {Math.min(plan.gpuLayers, plan.totalLayers)}/{plan.totalLayers}</span>
        {plan.mode === 'moe' && <span>Expertos MoE en CPU: {plan.cpuMoeLayers} capas</span>}
      </div>
    </div>
  );
}

const MODE_TEXT = { gpu: '100% en GPU', moe: 'MoE: atención en GPU + expertos en RAM', partial: 'Reparto GPU + RAM (offload)', cpu: 'Solo CPU/RAM' };

// ───────── Descubrir ─────────
function ModelCard({ m, budget, ctx, onOpen, localMatch, why }) {
  const best = m.meta || m.quants ? bestQuant(m, budget, ctx) : null;
  const approx = !m.quants && m.params ? planModel({ params: m.params }, budget || { vram: 0, ram: 8 * GiB }, { ctx, fileSize: m.approxSize }) : null;
  const plan = best?.p || approx;
  return (
    <div className="card hover model-card" onClick={() => onOpen(m)}>
      <div className="top">
        <div className="model-avatar" style={{ background: colorFor(m.name) }}>{m.name.replace(/^[^a-zA-Z0-9]+/, '').slice(0, 2).toUpperCase()}</div>
        <div className="grow">
          <div className="name">{m.name}</div>
          <div className="pub">{m.publisher}{m.params ? ` · ${fmtParams(m.params)}` : ''}{m.downloads ? ` · ${fmtNum(m.downloads)} descargas` : ''}</div>
        </div>
        {m.tags?.includes('nuevo') && <span className="badge green"><Icon name="sparkles" size={11} />Nuevo</span>}
        {m.tags?.includes('recomendado') && <span className="badge accent"><Icon name="star" size={11} />Top</span>}
      </div>
      {m.desc && <div className="desc">{m.desc}</div>}
      {why && <div className="small" style={{ color: 'var(--text-2, inherit)' }}><Icon name="info" size={11} /> {why}</div>}
      <div className="row wrap" style={{ gap: 5 }}><Caps caps={m.caps} />{m.ctx ? <span className="badge">{fmtNum(m.ctx)} ctx</span> : null}</div>
      <div className="foot">
        {plan && budget ? <FitPill plan={plan} /> : <span className="small muted">Calculando…</span>}
        <span className="grow" />
        {best && <span className="small muted">{best.q.quant} · {fmtBytes(best.q.size)}</span>}
        {!best && approx && <span className="small muted">~{fmtBytes(m.approxSize)}</span>}
        {localMatch && <span className="badge green"><Icon name="check" size={11} />Instalado</span>}
      </div>
    </div>
  );
}

function ModelDetail({ model, onClose }) {
  const { hw, localModels, toast, settings } = useStore();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [ctx, setCtx] = useState(settings?.ctx || 8192);
  const [sel, setSel] = useState(null);
  const [vision, setVision] = useState(true);
  const [busy, setBusy] = useState(null);
  const budget = hw ? staticBudget(hw) : null;
  useEffect(() => { call('catalog.repo', model.repo).then((x) => { setD(x); setSel(x.selected || x.recommended); }).catch((e) => setErr(e.message)); }, [model.repo]);
  const meta = d ? (d.metaByQuant?.[sel] || d.meta || { params: d.params }) : null;
  const rows = useMemo(() => d && budget ? d.quants.map((q) => ({ q, p: planModel(meta, budget, { ctx, fileSize: q.size, mmprojSize: vision && d.mmproj[0] ? d.mmproj[0].size : 0 }) })) : [], [d, ctx, vision, meta, budget]);
  const selRow = rows.find((r) => r.q.name === sel || r.q.quant === sel);
  const installed = (q) => localModels.find((l) => l.repo === model.repo && (l.quant === q.quant || l.name + '.gguf' === q.name || q.name.startsWith(l.name)));
  async function download(q) {
    setBusy(q.name);
    try { await call('models.download', { repo: model.repo, quant: q.name, withVision: vision }); toast(`Descargando ${d.name} ${q.quant}`, 'success'); }
    catch (e) { toast(e.message, 'error'); }
    setBusy(null);
  }
  return (
    <Drawer title={model.name} onClose={onClose} width={760} actions={<Button size="sm" icon="external" onClick={() => call('app.openExternal', `https://huggingface.co/${model.repo}`)}>Hugging Face</Button>}>
      {err && <div className="error-box">{err}</div>}
      {!d && !err && <div className="row"><span className="spinner" />Leyendo la arquitectura del modelo desde Hugging Face…</div>}
      {d && (
        <>
          <div className="row wrap" style={{ gap: 6, marginBottom: 12 }}>
            <span className="badge outline">{d.publisher}</span>
            {d.params ? <span className="badge">{fmtParams(d.params)} parámetros</span> : null}
            {d.arch && <span className="badge">{d.arch}</span>}
            {d.ctx ? <span className="badge">{fmtNum(d.ctx)} contexto</span> : null}
            <Caps caps={d.caps} max={8} />
            {d.license && <span className="badge">{d.license}</span>}
            {d.gated && <span className="badge amber"><Icon name="lock" size={11} />Requiere aceptar licencia</span>}
          </div>
          {d.desc && <p style={{ marginTop: 0, color: 'var(--text-2)' }}>{d.desc}</p>}
          {meta?.expertCount ? <p className="small muted">Mixture of Experts: {meta.expertCount} expertos, {meta.expertUsed} activos por token — solo se lee una fracción de los pesos, por lo que funciona rápido incluso con parte del modelo en la RAM.</p> : null}
          {selRow && (
            <div className="card" style={{ marginBottom: 18 }}>
              <div className="row" style={{ marginBottom: 12 }}>
                <strong>{selRow.q.quant}</strong><span className="muted small">{fmtBytes(selRow.q.size)} · {quantQuality(selRow.q.quant).label}</span>
                <span className="grow" /><FitPill plan={selRow.p} />
              </div>
              <MemBar plan={selRow.p} budget={budget} />
              <div className="small muted" style={{ marginTop: 10 }}>{MODE_TEXT[selRow.p.mode]} · memoria total ~{fmtBytes(selRow.p.totalBytes)}</div>
              <div className="row" style={{ marginTop: 14, gap: 14 }}>
                <span className="small nowrap">Contexto: <strong>{fmtNum(ctx)}</strong></span>
                <input type="range" className="slider" min={11} max={17} step={1} value={Math.log2(ctx)} onChange={(e) => setCtx(2 ** Number(e.target.value))} />
                {d.mmproj.length > 0 && <label className="row small nowrap" style={{ gap: 8 }}><Toggle value={vision} onChange={setVision} />Visión</label>}
              </div>
            </div>
          )}
          <table className="quant-table">
            <thead><tr><th>Cuantización</th><th>Tamaño</th><th>Calidad</th><th>En tu equipo</th><th /></tr></thead>
            <tbody>
              {rows.map(({ q, p }) => {
                const inst = installed(q);
                const dlActive = Object.values(useStore.getState().downloads).find((x) => x.meta?.repo === model.repo && x.meta?.quant === q.quant && x.status !== 'done');
                return (
                  <tr key={q.name} className={q.quant === d.recommended ? 'rec' : ''} onClick={() => setSel(q.name)} style={{ cursor: 'pointer' }}>
                    <td><strong>{q.quant}</strong>{q.quant === d.recommended && <span className="badge accent" style={{ marginLeft: 6 }}>recomendada</span>}{q.files.length > 1 && <span className="tiny faint"> · {q.files.length} partes</span>}</td>
                    <td className="nowrap">{fmtBytes(q.size)}</td>
                    <td className="small muted">{quantQuality(q.quant).label}</td>
                    <td><FitPill plan={p} /></td>
                    <td style={{ textAlign: 'right' }}>
                      {inst ? <span className="badge green"><Icon name="check" size={11} />Instalado</span>
                        : dlActive ? <span className="badge blue">{Math.round((dlActive.received / Math.max(1, dlActive.total)) * 100)}%</span>
                          : <Button size="xs" variant={p.rating === 'fluido' || p.rating === 'bueno' ? 'primary' : ''} icon="download" loading={busy === q.name} onClick={(e) => { e.stopPropagation(); download(q); }}>Descargar</Button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {d.metaError && <p className="tiny faint">No se pudo leer la cabecera exacta ({d.metaError}); las estimaciones son aproximadas.</p>}
        </>
      )}
    </Drawer>
  );
}

function Discover() {
  const { hw, localModels, settings } = useStore();
  const [source, setSource] = useState('curated');
  const [catalog, setCatalog] = useState(null);
  const [remote, setRemote] = useState(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [open, setOpen] = useState(null);
  const ctx = settings?.ctx || 8192;
  const budget = hw ? staticBudget(hw) : null;
  const catalogVersion = useStore((st) => st.catalogVersion);
  const [discovering, setDiscovering] = useState(false);
  const [lastDisc, setLastDisc] = useState(null);
  useEffect(() => { call('catalog.get').then(setCatalog); call('catalog.lastDiscover').then(setLastDisc).catch(() => { }); }, [catalogVersion]);
  async function discover() {
    setDiscovering(true);
    try {
      const r = await call('catalog.discover');
      useStore.getState().toast(r.added.length ? `Añadidos ${r.added.length} modelos nuevos: ${r.added.join(', ')}` : 'No hay modelos nuevos desde la última vez', r.added.length ? 'success' : 'info', 8000);
    } catch (e) { useStore.getState().toast(e.message, 'error'); }
    setDiscovering(false);
  }
  useEffect(() => {
    const onSearch = (e) => {
      setQ(e.detail);
      setSource('search');
    };
    window.addEventListener('search-model', onSearch);
    return () => window.removeEventListener('search-model', onSearch);
  }, []);
  useEffect(() => {
    if (source === 'curated') return;
    if (source === 'search' && !q.trim()) { setRemote([]); return; }
    setLoading(true);
    call('catalog.search', source === 'search' ? q.trim() : '', source === 'trending' ? 'trendingScore' : 'downloads').then((r) => { setRemote(r); setLoading(false); }).catch(() => setLoading(false));
  }, [source]);
  const doSearch = (e) => { e.preventDefault(); if (!q.trim()) return; setSource('search'); setLoading(true); call('catalog.search', q.trim(), 'downloads').then((r) => { setRemote(r); setLoading(false); }).catch(() => setLoading(false)); };

  const list = source === 'curated' ? (catalog?.models || []) : (remote || []);
  const enriched = useMemo(() => list.map((m) => {
    const best = budget && m.quants ? bestQuant(m, budget, ctx) : null;
    const plan = best?.p || (budget && m.params ? planModel({ params: m.params }, budget, { ctx, fileSize: m.approxSize }) : null);
    return { m, plan };
  }), [list, budget, ctx]);
  const taskRanks = useMemo(() => {
    if (!budget || !catalog?.models) return {};
    return Object.fromEntries(Object.keys(TASKS).map((t) => [t, rankForTask(catalog.models, t, budget, ctx)]));
  }, [catalog, budget, ctx]);
  const isTask = filter.startsWith('task:');
  const taskEntries = isTask ? (taskRanks[filter.slice(5)] || []) : null;
  const taskOrder = isTask ? taskEntries.map((r) => r.m.id) : null;
  const filtered = enriched.filter(({ m, plan }) => {
    if (source === 'curated' && q.trim() && !(m.name + ' ' + m.publisher + ' ' + (m.desc || '')).toLowerCase().includes(q.toLowerCase())) return false;
    if (isTask) return taskOrder.includes(m.id);
    switch (filter) {
      case 'fluido': return plan?.rating === 'fluido';
      case 'runs': return plan && plan.fits;
      case 'vision': return m.caps?.includes('vision');
      case 'code': return m.caps?.includes('code');
      case 'computer': return m.caps?.includes('computer');
      case 'moe': return m.caps?.includes('moe');
      case 'light': return m.params && m.params < 5e9;
      default: return true;
    }
  });
  if (isTask) filtered.sort((a, b) => taskOrder.indexOf(a.m.id) - taskOrder.indexOf(b.m.id));
  else if (source === 'curated') filtered.sort((a, b) => (RATING_RANK[a.plan?.rating] ?? 5) - (RATING_RANK[b.plan?.rating] ?? 5) || (b.m.tags?.includes('recomendado') - a.m.tags?.includes('recomendado')) || (b.m.params - a.m.params));
  const counts = { fluido: enriched.filter((x) => x.plan?.rating === 'fluido').length, runs: enriched.filter((x) => x.plan?.fits).length };
  const gpu = hw?.gpus?.filter((g) => g.usable).sort((a, b) => b.vram - a.vram)[0];
  const top = enriched.filter((x) => x.plan?.rating === 'fluido' && x.m.tags?.includes('recomendado')).sort((a, b) => b.m.params - a.m.params)[0];

  return (
    <>
      <div className="hw-banner">
        <div className="hw-icon"><Icon name="cpu" size={22} /></div>
        <div className="grow">
          {hw ? <>
            <div style={{ fontWeight: 620 }}>{gpu ? `${gpu.name} · ${fmtBytes(gpu.vram)} VRAM` : 'Sin GPU dedicada (se usará la CPU)'} · {fmtBytes(hw.ram.total, 0)} RAM {hw.ram.type}</div>
            <div className="small muted">{counts.fluido} modelos del catálogo van fluidos en tu equipo y {counts.runs} pueden ejecutarse (algunos con offload a RAM).{top ? ` Recomendación destacada: ${top.m.name}.` : ''}</div>
          </> : <div className="row"><span className="spinner" />Analizando tu equipo…</div>}
        </div>
        <div className="col" style={{ gap: 4, alignItems: 'flex-end' }}>
          <div className="row" style={{ gap: 6 }}>
            <Button size="sm" icon="refresh" loading={discovering} onClick={discover}>Buscar novedades</Button>
            <Button size="sm" icon="gauge" onClick={() => useStore.getState().setView('hardware')}>Detalles</Button>
          </div>
          <span className="tiny muted">{lastDisc ? `Última revisión: ${timeAgo(new Date(lastDisc).getTime())} · se revisa sola cada día` : 'Se revisa sola cada día'}</span>
        </div>
      </div>
      <div className="row wrap" style={{ marginBottom: 14, gap: 10 }}>
        <Seg value={source} onChange={setSource} options={[{ value: 'curated', label: 'Recomendados', icon: 'star' }, { value: 'trending', label: 'Tendencias', icon: 'flame' }, { value: 'downloads', label: 'Más descargados', icon: 'trending' }, { value: 'search', label: 'Buscar', icon: 'search' }]} />
        <form onSubmit={doSearch} className="grow" style={{ display: 'flex', gap: 8, maxWidth: 480 }}>
          <input className="input" placeholder={source === 'curated' ? 'Filtrar o buscar en Hugging Face (Enter)…' : 'Buscar modelos GGUF en Hugging Face…'} value={q} onChange={(e) => setQ(e.target.value)} style={{ height: 34 }} />
          <Button type="submit" icon="search" size="sm" style={{ height: 34 }}>Buscar</Button>
        </form>
      </div>
      {source === 'curated' && !q.trim() && budget && <TaskPicks ranks={taskRanks} onOpen={setOpen} onTask={(t) => setFilter(`task:${t}`)} localModels={localModels} />}
      <div className="filters">
        {Object.entries(TASKS).map(([k, t]) => (
          <button key={k} className={`chip ${filter === `task:${k}` ? 'on' : ''}`} onClick={() => setFilter(`task:${k}`)}><Icon name={t.icon} size={12} />{t.label}</button>
        ))}
      </div>
      <div className="filters">
        {[['all', 'Todos'], ['fluido', `Fluidos (${counts.fluido})`], ['runs', `Se pueden ejecutar (${counts.runs})`], ['vision', 'Visión'], ['code', 'Código'], ['computer', 'Control del PC'], ['moe', 'MoE rápidos'], ['light', 'Ligeros']].map(([k, l]) => (
          <button key={k} className={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{l}</button>
        ))}
        <span className="grow" />
        <span className="small muted">Estimaciones con contexto de {fmtNum(ctx)} tokens</span>
      </div>
      {loading ? <div className="row" style={{ padding: 30, justifyContent: 'center' }}><span className="spinner" />Consultando Hugging Face…</div> : (
        filtered.length ? <GroupedCards items={filtered.map(({ m, plan }) => { const e = isTask ? taskEntries.find((r) => r.m.id === m.id) : null; return { m, group: e ? e.group : (plan ? groupOf(plan) : 'sin'), why: e?.why }; })} render={({ m, why }) => <ModelCard key={m.id} m={m} budget={budget} ctx={ctx} onOpen={setOpen} why={why} localMatch={localModels.some((l) => l.repo === m.repo)} />} />
          : <Empty icon="search" title="Sin resultados">Prueba otro filtro o busca por nombre (p. ej. «qwen», «gemma», «llama», «coder»).</Empty>
      )}
      {open && <ModelDetail model={open} onClose={() => setOpen(null)} />}
    </>
  );
}
const RATING_RANK = { fluido: 0, bueno: 1, lento: 2, muylento: 3, nofit: 4 };

const GROUP_DOT = { fluido: 'var(--green, #3a9d5d)', lento: 'var(--amber, #d4a017)', noapto: 'var(--red, #d64545)', sin: 'var(--text-3, #888)' };
// Lista de modelos agrupada: fluidos, lentos, no aptos
function GroupedCards({ items, render }) {
  const groups = [...Object.keys(GROUPS), 'sin'].map((g) => [g, items.filter((x) => x.group === g)]).filter(([, l]) => l.length);
  return groups.map(([g, l]) => (
    <div key={g} style={{ marginBottom: 18 }}>
      <div className="row" style={{ gap: 8, margin: '4px 0 10px' }}>
        <span style={{ width: 10, height: 10, borderRadius: 5, background: GROUP_DOT[g] }} />
        <strong>{GROUPS[g]?.label || 'Sin estimación'}</strong><span className="badge">{l.length}</span>
        {g === 'noapto' && <span className="small muted">no caben en tu equipo o no tienen lo que la tarea necesita</span>}
      </div>
      <div className="cards" style={g === 'noapto' ? { opacity: 0.75 } : undefined}>{l.map(render)}</div>
    </div>
  ));
}

// Mejor modelo de cada tarea para el equipo del usuario
function TaskPicks({ ranks, onOpen, onTask, localModels }) {
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="row" style={{ marginBottom: 10 }}><Icon name="sparkles" size={16} style={{ color: 'var(--accent)' }} /><strong>El mejor para cada tarea en tu equipo</strong><span className="grow" /><span className="small muted">Pulsa un modelo para descargarlo · "Ver más" para alternativas</span></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 10 }}>
        {Object.entries(TASKS).map(([k, t]) => {
          const list = (ranks[k] || []).filter((r) => r.group !== 'noapto');
          return (
            <div key={k} className="col" style={{ gap: 6, padding: 10, borderRadius: 10, background: 'var(--surface-2)' }}>
              <div className="row" style={{ gap: 6 }}><Icon name={t.icon} size={14} /><strong className="small">{t.label}</strong></div>
              <div className="tiny muted">{t.desc}</div>
              {list.length ? list.slice(0, 2).map((r, i) => (
                <button key={r.m.id} className="chip" style={{ justifyContent: 'flex-start', textAlign: 'left', height: 'auto', padding: '6px 8px', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }} onClick={() => onOpen(r.m)}>
                  <span className="small" style={{ fontWeight: 600, color: 'var(--text)' }}>{i === 0 ? '★ ' : ''}{r.m.name}{localModels.some((l) => l.repo === r.m.repo) ? ' ✓' : ''}</span>
                  <span className="tiny muted">{r.q.quant} · {fmtBytes(r.q.size)} · {r.why}</span>
                </button>
              )) : <div className="tiny muted">Ningún modelo del catálogo cabe en tu equipo para esto.</div>}
              {list.length > 2 && <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => onTask(k)}>Ver más ({list.length})</button>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ───────── Mis modelos ─────────
const RATE_COLOR = { fluido: 'var(--green, #3a9d5d)', bueno: 'var(--teal, #2a9d8f)', lento: 'var(--amber, #d4a017)', muylento: 'var(--orange, #e07a2f)', nofit: 'var(--red, #d64545)' };
function ContextAnalysis({ rec, current, kv, onPick }) {
  const rows = rec.options.filter((o) => o.ctx >= 4096);
  const cell = (o, k) => {
    const p = o[k];
    const on = o.ctx === current && kv === k;
    return (
      <td key={k} onClick={() => p.fits && onPick(o.ctx, k)} title={p.fits ? 'Usar este contexto' : 'No cabe'} style={{ padding: '4px 6px', cursor: p.fits ? 'pointer' : 'default', borderRadius: 6, outline: on ? '2px solid var(--accent, #d97757)' : 'none', opacity: p.fits ? 1 : 0.5 }}>
        <span style={{ color: RATE_COLOR[p.rating] }}>●</span> {p.fits ? `${fmtBytes(p.gpuBytes)}${p.cpuBytes > 1.5 * GiB ? ` + ${fmtBytes(p.cpuBytes)} RAM` : ''} · ~${p.tps} t/s` : 'No cabe'}
      </td>
    );
  };
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="row" style={{ marginBottom: 6 }}><strong>Análisis de contexto</strong><span className="grow" /><span className="badge">Recomendado: {fmtNum(rec.ctx)} · {rec.kvType.toUpperCase()}</span></div>
      <div className="small muted" style={{ marginBottom: 8 }}>{rec.reason}</div>
      <table className="small" style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 2 }}>
        <thead><tr><th style={{ textAlign: 'left' }}>Tokens</th><th style={{ textAlign: 'left' }}>Caché F16</th><th style={{ textAlign: 'left' }}>Caché Q8_0</th></tr></thead>
        <tbody>{rows.map((o) => <tr key={o.ctx}><td className="mono">{fmtNum(o.ctx)}{o.ctx === rec.ctx ? ' ★' : ''}</td>{cell(o, 'f16')}{cell(o, 'q8_0')}</tr>)}</tbody>
      </table>
      <div className="small muted" style={{ marginTop: 6 }}>Pulsa una celda para fijar ese contexto a mano. Verde = todo en GPU; ámbar/naranja = parte en RAM (más lento).</div>
    </div>
  );
}

function ModelSettings({ model, onClose }) {
  const { settings, toast } = useStore();
  const [s, setS] = useState({ ctxMode: model.settings?.ctxMode || (settings?.autoCtx === false ? 'manual' : 'auto'), ctx: model.settings?.ctx || settings?.ctx || 8192, gpuLayers: model.settings?.gpuLayers ?? 'auto', kvType: model.settings?.kvType || settings?.kvType || 'f16', vision: model.settings?.vision !== false, extraArgs: model.settings?.extraArgs || '' });
  const [plan, setPlan] = useState(null);
  useEffect(() => { const t = setTimeout(() => { call('models.settings', model.id, s).then(() => call('models.plan', model.id, s.ctxMode === 'auto' ? {} : { ctx: s.ctx })).then(setPlan).catch(() => { }); }, 250); return () => clearTimeout(t); }, [s]);
  const hw = useStore((st) => st.hw);
  const budget = hw ? staticBudget(hw) : null;
  return (
    <Drawer title={`Ajustes · ${model.name}`} onClose={onClose}>
      <Field label="Contexto" hint="Automático analiza tu GPU/RAM y elige el mayor contexto que deja el modelo rápido.">
        <Seg value={s.ctxMode} onChange={(v) => setS({ ...s, ctxMode: v, ...(v === 'manual' && plan?.rec ? { ctx: plan.rec.ctx, kvType: plan.rec.kvType } : {}) })} options={[{ value: 'auto', label: 'Automático (recomendado)' }, { value: 'manual', label: 'Manual' }]} />
      </Field>
      {plan?.rec && <ContextAnalysis rec={plan.rec} current={s.ctxMode === 'auto' ? plan.rec.ctx : s.ctx} kv={s.ctxMode === 'auto' ? plan.rec.kvType : s.kvType} onPick={(ctx, kvType) => setS({ ...s, ctxMode: 'manual', ctx, kvType })} />}
      {s.ctxMode === 'manual' && <Field label={`Longitud de contexto: ${fmtNum(s.ctx)} tokens`} hint={`Máximo del modelo: ${fmtNum(model.meta?.ctxTrain || 0)}. Más contexto = más memoria (KV caché).`}>
        <input type="range" className="slider" min={11} max={Math.max(12, Math.floor(Math.log2(model.meta?.ctxTrain || 131072)))} value={Math.log2(s.ctx)} onChange={(e) => setS({ ...s, ctx: 2 ** Number(e.target.value) })} />
      </Field>}
      <Field label="Capas en GPU" hint={`Automático reparte según tu VRAM. El modelo tiene ${model.meta?.layers || '?'} capas.`}>
        <div className="row">
          <Seg value={s.gpuLayers === 'auto' ? 'auto' : 'manual'} onChange={(v) => setS({ ...s, gpuLayers: v === 'auto' ? 'auto' : (plan?.live?.gpuLayers ?? 0) })} options={[{ value: 'auto', label: 'Automático' }, { value: 'manual', label: 'Manual' }]} />
          {s.gpuLayers !== 'auto' && <><input type="range" className="slider" min={0} max={model.meta?.layers || 99} value={s.gpuLayers} onChange={(e) => setS({ ...s, gpuLayers: Number(e.target.value) })} /><span className="mono small">{s.gpuLayers}</span></>}
        </div>
      </Field>
      {s.ctxMode === 'manual' && <Field label="Tipo de KV caché" hint="q8_0 reduce la memoria del contexto casi a la mitad con pérdida mínima; q4_0 aún más.">
        <Seg value={s.kvType} onChange={(v) => setS({ ...s, kvType: v })} options={[{ value: 'f16', label: 'F16 (máxima calidad)' }, { value: 'q8_0', label: 'Q8_0' }, { value: 'q4_0', label: 'Q4_0' }]} />
      </Field>}
      {model.mmproj && <Field label="Visión (imágenes)" hint="Carga el proyector de visión (mmproj). Desactívalo para ahorrar memoria."><Toggle value={s.vision} onChange={(v) => setS({ ...s, vision: v })} /></Field>}
      <Field label="Argumentos extra de llama-server" hint="Avanzado. Ej.: --top-k 40 --rope-scaling yarn"><input className="input mono" value={s.extraArgs} onChange={(e) => setS({ ...s, extraArgs: e.target.value })} /></Field>
      {plan && <div className="card"><div className="row" style={{ marginBottom: 10 }}><strong>Previsión de carga</strong><span className="grow" /><FitPill plan={plan.live} /></div><MemBar plan={plan.live} budget={budget} /><div className="small muted" style={{ marginTop: 8 }}>{MODE_TEXT[plan.live.mode]}. Los cambios se aplican la próxima vez que cargues el modelo.</div></div>}
      <div className="row" style={{ marginTop: 16 }}><Button onClick={() => { toast('Ajustes guardados', 'success'); onClose(); }} variant="primary">Listo</Button></div>
    </Drawer>
  );
}

function LocalModels() {
  const { localModels, instances, hw, toast, newChat, settings } = useStore();
  const [edit, setEdit] = useState(null);
  const [del, setDel] = useState(null);
  const [dirs, setDirs] = useState({ dirs: [], lmstudio: [] });
  const [loadingId, setLoadingId] = useState(null);
  const budget = hw ? staticBudget(hw) : null;
  useEffect(() => { call('models.extraDirs').then(setDirs); }, [localModels.length]);
  async function load(m) {
    setLoadingId(m.id);
    try {
      const list = await call('llama.load', m.id);
      const i = (list || []).find((x) => x.id === m.id);
      toast(i?.plan?.autoCtx ? `${m.name} cargado · contexto ${fmtNum(i.ctx)} (${i.plan.kvType}). ${i.plan.reason}` : `${m.name} cargado`, 'success', 8000);
    } catch (e) { toast(e.message, 'error', 9000); }
    setLoadingId(null);
  }
  const total = localModels.filter((m) => !m.external).reduce((a, m) => a + m.size, 0);
  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <span className="muted small">{localModels.length} {localModels.length === 1 ? 'modelo' : 'modelos'} · {fmtBytes(total)} en tu carpeta de modelos</span>
        <span className="grow" />
        <Button size="sm" icon="upload" onClick={() => call('models.import')}>Importar GGUF</Button>
        <Button size="sm" icon="folder" onClick={() => call('models.addDir')}>Añadir carpeta</Button>
        <Button size="sm" icon="refresh" onClick={() => useStore.getState().refreshLocal()}>Actualizar</Button>
      </div>
      {dirs.lmstudio.filter((d) => !dirs.dirs.includes(d)).map((d) => (
        <div key={d} className="card row" style={{ marginBottom: 12 }}><Icon name="info" size={16} /><span className="small grow">Se detectaron modelos de LM Studio en <span className="mono">{d}</span>. ¿Usarlos sin duplicarlos?</span><Button size="sm" variant="primary" onClick={() => call('models.addDir', d)}>Usar</Button></div>
      ))}
      {!localModels.length ? <Empty icon="disk" title="Aún no hay modelos locales" action={<Button variant="primary" icon="download" onClick={() => useStore.setState({ modelsTab: 'discover' })}>Descubrir modelos</Button>}>Descarga modelos recomendados para tu equipo o importa archivos GGUF que ya tengas.</Empty> : (
        <div className="list">
          {localModels.map((m) => {
            const inst = instances.find((i) => i.id === m.id);
            const plan = budget && m.meta && !m.meta.error ? planModel(m.meta, budget, { ctx: m.settings?.ctx || settings?.ctx || 8192, fileSize: m.size }) : null;
            return (
              <div key={m.id} className="list-row">
                <div className="model-avatar" style={{ background: colorFor(m.name), width: 36, height: 36, fontSize: 13 }}>{m.name.replace(/^[^a-zA-Z0-9]+/, '').slice(0, 2).toUpperCase()}</div>
                <div className="grow">
                  <div className="row" style={{ gap: 8 }}><strong className="ellipsis">{m.name}</strong>{m.external && <span className="badge outline">externo</span>}</div>
                  <div className="row wrap small muted" style={{ gap: 8, marginTop: 3 }}>
                    <span>{m.quant}</span><span>{fmtBytes(m.size)}</span>{m.meta?.params ? <span>{fmtParams(m.meta.params)}</span> : null}{m.meta?.arch && <span>{m.meta.arch}</span>}
                    <Caps caps={m.caps} max={4} />
                    {m.meta?.error && <span className="badge red">GGUF ilegible</span>}
                  </div>
                </div>
                {plan && <FitPill plan={plan} />}
                {inst?.status === 'ready' && <span className="badge green">Cargado · {fmtBytes(inst.plan?.gpuBytes)} GPU</span>}
                {inst?.status === 'loading' && <span className="badge amber"><span className="spinner sm" />Cargando {inst.progress ? Math.round(inst.progress) + '%' : ''}</span>}
                {inst?.status === 'error' && <span className="badge red" title={inst.error}>Error</span>}
                {inst?.status === 'ready' ? <Button size="sm" icon="power" onClick={() => call('llama.unload', m.id)}>Expulsar</Button>
                  : <Button size="sm" icon="play" loading={loadingId === m.id || inst?.status === 'loading'} onClick={() => load(m)}>Cargar</Button>}
                <Button size="sm" variant="primary" icon="chat" onClick={() => newChat({ model: `local:${m.id}` })}>Chatear</Button>
                <IconButton icon="sliders" title="Ajustes del modelo" onClick={() => setEdit(m)} />
                <IconButton icon="folder-open" title="Mostrar en carpeta" onClick={() => call('app.showItem', m.path)} />
                {!m.external && <IconButton icon="trash" title="Eliminar" onClick={() => setDel(m)} />}
              </div>
            );
          })}
        </div>
      )}
      {dirs.dirs.length > 0 && (
        <>
          <div className="section-title">Carpetas externas</div>
          <div className="list">{dirs.dirs.map((d) => <div key={d} className="list-row"><Icon name="folder" size={16} /><span className="mono small grow">{d}</span><IconButton icon="x" title="Quitar" onClick={() => call('models.removeDir', d).then(() => call('models.extraDirs').then(setDirs))} /></div>)}</div>
        </>
      )}
      {edit && <ModelSettings model={edit} onClose={() => { setEdit(null); useStore.getState().refreshLocal(); }} />}
      {del && <Confirm title="Eliminar modelo" text={`¿Eliminar ${del.name} (${fmtBytes(del.size)}) del disco?`} danger confirmLabel="Eliminar" onConfirm={() => call('models.delete', del.id).catch((e) => toast(e.message, 'error'))} onClose={() => setDel(null)} />}
    </>
  );
}

// ───────── En ejecución ─────────
function Running() {
  const { instances, hw, localModels } = useStore();
  const [logs, setLogs] = useState(null);
  const budget = hw ? staticBudget(hw) : null;
  const colors = ['#8b5cf6', '#06b6d4', '#22c55e', '#f59e0b', '#ec4899', '#3b82f6'];
  const usedG = instances.reduce((a, i) => a + (i.plan?.gpuBytes || 0), 0);
  const usedC = instances.reduce((a, i) => a + (i.plan?.cpuBytes || 0), 0);
  return (
    <>
      {budget && (
        <div className="grid-2" style={{ marginBottom: 20 }}>
          {[['VRAM (GPU)', budget.vram, 'gpuBytes', usedG], ['RAM', budget.ram, 'cpuBytes', usedC]].map(([label, total, key, used]) => (
            <div key={label} className="card">
              <div className="row" style={{ marginBottom: 10 }}><strong>{label}</strong><span className="grow" /><span className="small muted">{fmtBytes(used)} de {fmtBytes(total)} usados por modelos</span></div>
              <div className="meter lg">{instances.map((i, k) => <span key={i.id} title={i.name} style={{ width: `${Math.min(100, ((i.plan?.[key] || 0) / Math.max(1, total)) * 100)}%`, background: colors[k % colors.length] }} />)}</div>
            </div>
          ))}
        </div>
      )}
      {!instances.length ? <Empty icon="zap" title="No hay modelos cargados">Los modelos se cargan automáticamente al usarlos en un chat, o puedes cargarlos desde "Mis modelos". Varios modelos pueden estar cargados a la vez si caben.</Empty> : (
        <div className="list">
          {instances.map((i, k) => (
            <div key={i.id} className="list-row">
              <span style={{ width: 10, height: 10, borderRadius: 3, background: colors[k % colors.length], flex: 'none' }} />
              <div className="grow">
                <div className="row" style={{ gap: 8 }}><strong>{i.name}</strong><span className={`status-dot ${i.status === 'ready' ? 'green' : i.status === 'error' ? 'red' : 'amber'}`} /><span className="small muted">{i.status === 'ready' ? (i.busy ? 'generando' : 'listo') : i.status}</span>{i.vision && <span className="badge"><Icon name="eye" size={11} />visión</span>}</div>
                <div className="small muted" style={{ marginTop: 3 }}>{MODE_TEXT[i.plan?.mode]} · GPU {fmtBytes(i.plan?.gpuBytes)} · RAM {fmtBytes(i.plan?.cpuBytes)} · contexto {fmtNum(i.ctx)} · motor {i.backend} · puerto {i.port} · activo desde {timeAgo(i.startedAt)}</div>
                {i.status === 'loading' && <div style={{ marginTop: 6, maxWidth: 360 }}><Progress value={i.progress} indeterminate={!i.progress} /></div>}
                {i.error && <div className="error-box" style={{ marginTop: 6 }}>{i.error}</div>}
              </div>
              <Button size="sm" icon="terminal" onClick={async () => setLogs({ name: i.name, lines: await call('llama.logs', i.id) })}>Registro</Button>
              <Button size="sm" icon="power" onClick={() => call('llama.unload', i.id)}>Expulsar</Button>
            </div>
          ))}
        </div>
      )}
      {instances.length > 1 && <div className="row" style={{ marginTop: 12 }}><Button size="sm" icon="power" onClick={() => call('llama.unloadAll')}>Expulsar todos</Button></div>}
      {logs && <Modal title={`Registro · ${logs.name}`} wide onClose={() => setLogs(null)}><div className="logs">{logs.lines.join('\n') || '(vacío)'}</div></Modal>}
    </>
  );
}

// ───────── Planificador multi-modelo ─────────
function MultiPlanner() {
  const { localModels, hw, toast, newChat } = useStore();
  const [sel, setSel] = useState([]);
  const [ctx, setCtx] = useState(8192);
  const [busy, setBusy] = useState(false);
  const budget = hw ? staticBudget(hw) : null;
  const items = sel.map((id) => localModels.find((m) => m.id === id)).filter(Boolean).map((m) => ({ id: m.id, meta: m.meta, fileSize: m.size, ctx, name: m.name }));
  const plan = budget && items.length ? planMulti(items, budget) : null;
  const colors = ['#8b5cf6', '#06b6d4', '#22c55e', '#f59e0b', '#ec4899', '#3b82f6'];
  async function loadAll() {
    setBusy(true);
    for (const it of items) { try { await call('llama.load', it.id, { ctx }); } catch (e) { toast(`${it.name}: ${e.message}`, 'error', 8000); break; } }
    setBusy(false);
  }
  return (
    <div className="grid-2" style={{ gridTemplateColumns: '360px 1fr', alignItems: 'start' }}>
      <div className="card">
        <h3 style={{ marginBottom: 4 }}>Elige modelos</h3>
        <p className="small muted" style={{ marginTop: 0 }}>Nexo calcula si caben a la vez en VRAM + RAM (con offload) o si deben ejecutarse por turnos.</p>
        {!localModels.length && <p className="small muted">No hay modelos locales todavía.</p>}
        <div className="col" style={{ gap: 4 }}>
          {localModels.map((m) => (
            <label key={m.id} className="menu-item" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={sel.includes(m.id)} onChange={() => setSel(sel.includes(m.id) ? sel.filter((x) => x !== m.id) : [...sel, m.id])} />
              <span className="grow ellipsis">{m.name}</span><span className="tiny muted">{fmtBytes(m.size)}</span>
            </label>
          ))}
        </div>
        <div className="field" style={{ marginTop: 14 }}><label>Contexto por modelo: {fmtNum(ctx)}</label><input type="range" className="slider" min={11} max={17} value={Math.log2(ctx)} onChange={(e) => setCtx(2 ** Number(e.target.value))} /></div>
      </div>
      <div className="col" style={{ gap: 14 }}>
        {!plan ? <div className="card"><Empty icon="columns" title="Planificador multi-modelo">Selecciona dos o más modelos para ver cómo se reparten la memoria y si pueden trabajar a la vez en el mismo trabajo (modo Comparar o Etapas).</Empty></div> : (
          <>
            <div className="card" style={{ borderColor: plan.strategy === 'concurrent' ? 'color-mix(in oklab, var(--green) 45%, transparent)' : plan.strategy === 'sequential' ? 'color-mix(in oklab, var(--amber) 45%, transparent)' : 'color-mix(in oklab, var(--red) 45%, transparent)' }}>
              <div className="row" style={{ marginBottom: 6 }}>
                <Icon name={plan.strategy === 'concurrent' ? 'check-circle' : plan.strategy === 'sequential' ? 'history' : 'alert'} size={20} style={{ color: plan.strategy === 'concurrent' ? 'var(--green)' : plan.strategy === 'sequential' ? 'var(--amber)' : 'var(--red)' }} />
                <strong style={{ fontSize: 15 }}>{plan.strategy === 'concurrent' ? (items.length === 1 ? 'Cabe en tu equipo' : `Caben los ${items.length} a la vez`) : plan.strategy === 'sequential' ? 'No caben a la vez: se ejecutarán por turnos' : 'Algún modelo no cabe en tu equipo'}</strong>
              </div>
              <div className="small muted">{plan.strategy === 'concurrent' ? `Uso total: ${fmtBytes(plan.totalGpu)} de VRAM y ${fmtBytes(plan.totalCpu)} de RAM. Quedan libres ${fmtBytes(plan.remainingVram)} VRAM y ${fmtBytes(plan.remainingRam)} RAM.` : plan.strategy === 'sequential' ? 'Cada modelo cabe por separado; Nexo cargará y descargará automáticamente según haga falta (algo más lento al cambiar).' : 'Elige cuantizaciones más pequeñas o reduce el contexto.'}</div>
            </div>
            {[['VRAM', 'gpuBytes', budget.vram], ['RAM', 'cpuBytes', budget.ram]].map(([label, key, total]) => (
              <div key={label} className="card">
                <div className="row" style={{ marginBottom: 8 }}><strong>{label}</strong><span className="grow" /><span className="small muted">{fmtBytes(total)} disponibles</span></div>
                <div className="meter lg">{plan.plans.map((p, k) => p.fits && <span key={p.id} title={items[k].name} style={{ width: `${Math.min(100, (p[key] / Math.max(1, total)) * 100)}%`, background: colors[k % colors.length] }} />)}</div>
              </div>
            ))}
            <div className="list">
              {plan.plans.map((p, k) => (
                <div key={p.id} className="list-row">
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: colors[k % colors.length] }} />
                  <strong className="grow ellipsis">{items[k].name}</strong>
                  <span className="small muted">{p.fits ? MODE_TEXT[p.mode] : 'no cabe junto a los demás'}</span>
                  <span className="small mono">GPU {fmtBytes(p.gpuBytes)} · RAM {fmtBytes(p.cpuBytes)}</span>
                  <FitPill plan={p.fits ? p : plan.soloPlans[k]} />
                </div>
              ))}
            </div>
            <div className="row">
              <Button variant="primary" icon="play" loading={busy} disabled={plan.strategy !== 'concurrent'} onClick={loadAll}>Cargar todos</Button>
              <Button icon="columns" onClick={() => newChat({ mode: 'compare', compareModels: sel.slice(0, 4).map((id) => `local:${id}`) })}>Chat comparativo</Button>
              <Button icon="workflow" onClick={() => newChat({ mode: 'pipeline', pipeline: sel.map((id, i) => ({ label: `Etapa ${i + 1}`, model: `local:${id}`, instruction: i === 0 ? 'Resuelve la tarea.' : 'Revisa y mejora el resultado anterior.' })) })}>Flujo por etapas</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ───────── Motor ─────────
function Engine() {
  const { hw, toast, providers } = useStore();
  const [rt, setRt] = useState(null);
  const [update, setUpdate] = useState(null);
  const reload = () => call('rt.get').then(setRt);
  const downloads = useStore((s) => s.downloads);
  useEffect(() => { reload(); call('rt.checkUpdate').then(setUpdate).catch(() => { }); }, [Object.values(downloads).filter((d) => d.kind === 'runtime' && d.status === 'done').length]);
  if (!rt) return <span className="spinner" />;
  const rec = hw?.recommendedBackend;
  const platform = useStore.getState().info?.platform;
  const available = platform === 'darwin' ? ['metal'] : platform === 'win32' ? ['cuda12', 'cuda13', 'vulkan', 'rocm', 'sycl', 'cpu'] : ['cuda12', 'cuda13', 'vulkan', 'rocm', 'cpu'];
  const install = async (b) => { try { await call('rt.installLlama', b); toast('Descargando motor…', 'success'); } catch (e) { toast(e.message, 'error'); } };
  const dl = Object.values(downloads).filter((d) => d.kind === 'runtime' && !['done'].includes(d.status));
  return (
    <>
      <div className="card row" style={{ marginBottom: 18 }}>
        <div className="hw-icon" style={{ width: 42, height: 42, borderRadius: 12, display: 'grid', placeItems: 'center', background: rt.active ? 'var(--green)' : 'var(--surface-3)', color: '#fff' }}><Icon name="zap" size={20} /></div>
        <div className="grow">
          <strong>{rt.active ? `Motor activo: llama.cpp ${rt.active.tag}` : 'Motor local no instalado'}</strong>
          <div className="small muted">{rt.active ? `${rt.backends[rt.active.backend]?.label || rt.active.backend} · ${rt.active.serverPath}` : `Recomendado para tu equipo: ${rt.backends[rec]?.label || rec}. Se descarga una sola vez.`}</div>
        </div>
        {update && <span className="badge blue">Nueva versión {update}</span>}
        {!rt.active && rec && <Button variant="primary" icon="download" onClick={() => install(rec)}>Instalar recomendado</Button>}
        {rt.active && update && <Button icon="refresh" onClick={() => install(rt.active.backend)}>Actualizar</Button>}
      </div>
      {dl.map((d) => <DownloadRow key={d.id} d={d} />)}
      <div className="section-title">Backends disponibles</div>
      <div className="cards">
        {available.map((b) => {
          const inst = rt.llama.installed.filter((x) => x.backend === b);
          return (
            <div key={b} className="card col" style={{ gap: 8 }}>
              <div className="row"><strong>{rt.backends[b]?.label}</strong>{b === rec && <span className="badge accent">recomendado</span>}</div>
              {inst.map((x) => (
                <div key={x.id} className="row small">
                  <span className={`status-dot ${rt.llama.active === x.id ? 'green' : ''}`} /><span className="grow">{x.tag}</span>
                  {rt.llama.active !== x.id && <Button size="xs" onClick={() => call('rt.setActive', x.id).then(reload)}>Activar</Button>}
                  <IconButton icon="trash" size={14} className="sm" onClick={() => call('rt.remove', x.id).then(reload)} />
                </div>
              ))}
              {!inst.length && <Button size="sm" icon="download" onClick={() => install(b)}>Instalar</Button>}
            </div>
          );
        })}
      </div>
      <div className="section-title">Avanzado</div>
      <div className="card">
        <div className="setting"><div className="info"><div className="t">llama-server personalizado</div><div className="d">{rt.llama.customPath || 'Usa tu propio binario compilado (tiene prioridad sobre los instalados).'}</div></div><div className="ctl" style={{ gap: 8 }}><Button size="sm" onClick={() => call('rt.setCustom').then(reload)}>Elegir…</Button>{rt.llama.customPath && <Button size="sm" onClick={() => call('rt.setCustom', '').then(reload)}>Quitar</Button>}</div></div>
        <div className="setting"><div className="info"><div className="t">Ollama y LM Studio</div><div className="d">{providers.filter((p) => p.type === 'ollama' || p.type === 'lmstudio').map((p) => p.name).join(', ') || 'No detectados'}. Si los tienes abiertos, sus modelos aparecen en el selector.</div></div><div className="ctl"><Button size="sm" icon="refresh" onClick={() => call('prov.detect').then(() => toast('Detección completada'))}>Detectar</Button></div></div>
      </div>
    </>
  );
}

function DownloadRow({ d }) {
  const pct = d.total ? (d.received / d.total) * 100 : 0;
  return (
    <div className="dl-item">
      <div className="row">
        <Icon name={d.kind === 'runtime' ? 'zap' : d.kind === 'voice' ? 'audio-lines' : 'models'} size={16} />
        <strong className="grow ellipsis">{d.label}</strong>
        <span className="small muted">{fmtBytes(d.received)} / {fmtBytes(d.total)}</span>
        {d.status === 'downloading' && <span className="small muted nowrap">{fmtBytes(d.speed)}/s · {fmtDuration(d.eta)}</span>}
        {d.status === 'downloading' && <IconButton icon="pause" size={14} className="sm" title="Pausar" onClick={() => call('dl.pause', d.id)} />}
        {['paused', 'error'].includes(d.status) && <IconButton icon="play" size={14} className="sm" title="Reanudar" onClick={() => call('dl.resume', d.id)} />}
        {d.status !== 'done' && <IconButton icon="x" size={14} className="sm" title="Cancelar" onClick={() => call('dl.cancel', d.id)} />}
        {d.status === 'done' && <Icon name="check-circle" size={16} style={{ color: 'var(--green)' }} />}
      </div>
      {d.status !== 'done' && <Progress value={pct} indeterminate={(d.status === 'downloading' && !d.total) || d.status === 'installing'} />}
      {d.status === 'installing' && <span className="tiny muted">Instalando…</span>}
      {d.status === 'paused' && <span className="tiny muted">En pausa</span>}
      {d.status === 'queued' && <span className="tiny muted">En cola</span>}
      {d.error && <span className="tiny" style={{ color: 'var(--red)' }}>{d.error}</span>}
    </div>
  );
}

function Downloads() {
  const downloads = useStore((s) => s.downloads);
  const list = Object.values(downloads).sort((a, b) => b.createdAt - a.createdAt);
  return list.length ? <div className="list">{list.map((d) => <DownloadRow key={d.id} d={d} />)}</div> : <Empty icon="download" title="Sin descargas">Las descargas se pueden pausar y reanudar, incluso tras cerrar la aplicación.</Empty>;
}

export default function ModelsView() {
  const { modelsTab, localModels, instances, downloads } = useStore();
  const setTab = (t) => useStore.setState({ modelsTab: t });
  const activeDl = Object.values(downloads).filter((d) => !['done'].includes(d.status)).length;
  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-header"><div><h1>Modelos</h1><p>Descarga, instala y ejecuta modelos locales optimizados para tu equipo.</p></div></div>
        <Tabs value={modelsTab} onChange={setTab} tabs={[
          { value: 'discover', label: 'Descubrir', icon: 'sparkles' },
          { value: 'local', label: 'Mis modelos', icon: 'disk', count: localModels.length },
          { value: 'running', label: 'En ejecución', icon: 'zap', count: instances.length },
          { value: 'multi', label: 'Multi-modelo', icon: 'columns' },
          { value: 'engine', label: 'Motor', icon: 'cpu' },
          { value: 'downloads', label: 'Descargas', icon: 'download', count: activeDl }
        ]} />
        {modelsTab === 'discover' && <Discover />}
        {modelsTab === 'local' && <LocalModels />}
        {modelsTab === 'running' && <Running />}
        {modelsTab === 'multi' && <MultiPlanner />}
        {modelsTab === 'engine' && <Engine />}
        {modelsTab === 'downloads' && <Downloads />}
      </div>
    </div>
  );
}

export { DownloadRow };
