import { useMemo, useRef, useState } from 'react';
import { useStore } from '../lib/store.js';
import { Popover } from './ui.jsx';
import Icon from './Icon.jsx';
import { fmtBytes, RATING, colorFor } from '../lib/api.js';
import { planModel, staticBudget } from '../../shared/fit.js';

export function useModelOptions() {
  const { localModels, providers, providerTypes, hw, instances, settings } = useStore();
  return useMemo(() => {
    const groups = [];
    const budget = hw ? staticBudget(hw) : null;
    groups.push({
      id: 'local', label: 'Modelos locales', icon: 'disk',
      items: localModels.map((m) => {
        const plan = budget && m.meta && !m.meta.error ? planModel(m.meta, budget, { ctx: m.settings?.ctx || settings?.ctx || 8192, fileSize: m.size }) : null;
        const inst = instances.find((i) => i.id === m.id);
        return { ref: `local:${m.id}`, name: m.name, sub: `${m.quant || ''} · ${fmtBytes(m.size)}`, caps: m.caps, plan, loaded: inst?.status, local: true };
      })
    });
    for (const p of providers) {
      if (!p.enabled) continue;
      const ids = [...new Set([...(p.customModels || []), ...(p.models || []).map((m) => m.id)])].filter((id) => !(p.hiddenModels || []).includes(id));
      const suggested = !ids.length && p.hasKey ? (providerTypes[p.type]?.suggested || []) : [];
      groups.push({ id: p.id, label: p.name, icon: providerTypes[p.type]?.local ? 'server' : 'cloud', items: [...ids, ...suggested].map((id) => ({ ref: `${p.id}:${id}`, name: id, sub: p.name, provider: p.type })) });
    }
    return groups;
  }, [localModels, providers, providerTypes, hw, instances, settings?.ctx]);
}

export function modelNameFromRef(ref, groups) {
  if (!ref) return null;
  for (const g of groups) { const it = g.items.find((i) => i.ref === ref); if (it) return it.name; }
  return ref.split(':').slice(1).join(':').split('/').pop();
}

export function FitPill({ plan, showTps = true }) {
  if (!plan) return null;
  const r = RATING[plan.rating] || RATING.nofit;
  return <span className="fit-pill" style={{ color: r.color }}><i style={{ background: r.color }} />{r.label}{showTps && plan.fits && plan.tps ? <span className="muted" style={{ fontWeight: 500 }}>· ~{plan.tps >= 100 ? Math.round(plan.tps) : plan.tps} tok/s</span> : null}</span>;
}

export default function ModelPicker({ value, onChange, multiple, placeholder = 'Elegir modelo', allowDefault, compact, flat, width = 400 }) {
  const btn = useRef(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const groups = useModelOptions();
  const setView = useStore((s) => s.setView);
  const selected = multiple ? (value || []) : value;
  const label = multiple
    ? (selected.length ? `${selected.length} modelos` : placeholder)
    : (value ? modelNameFromRef(value, groups) : (allowDefault ? 'Modelo predeterminado' : placeholder));
  const filtered = groups.map((g) => ({ ...g, items: g.items.filter((i) => !q || (i.name + ' ' + i.sub).toLowerCase().includes(q.toLowerCase())) })).filter((g) => g.items.length);
  const pick = (ref) => {
    if (multiple) { const s = new Set(selected); if (s.has(ref)) s.delete(ref); else s.add(ref); onChange([...s]); }
    else { onChange(ref); setOpen(false); }
  };
  const currentLocal = !multiple && value?.startsWith('local:');
  return (
    <>
      <button ref={btn} className={`picker-btn ${flat ? 'flat' : ''}`} onClick={() => setOpen(!open)} title="Modelo">
        {!flat && <Icon name={multiple ? 'columns' : currentLocal ? 'disk' : value ? 'cloud' : 'models'} size={15} />}
        <span className="ellipsis" style={compact ? { maxWidth: 150 } : undefined}>{label || placeholder}</span>
        <Icon name="chevron-down" size={14} className="faint" />
      </button>
      {open && (
        <Popover anchor={btn.current} onClose={() => setOpen(false)} width={width} maxHeight={520}>
          <input autoFocus className="input" placeholder="Buscar modelo…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 6, height: 34 }} />
          {allowDefault && !multiple && <button className="menu-item" onClick={() => pick(null)}><Icon name="sparkles" size={15} /><span className="grow">Predeterminado</span>{!value && <Icon name="check" size={14} />}</button>}
          {filtered.map((g) => (
            <div key={g.id}>
              <div className="menu-label row" style={{ gap: 6 }}><Icon name={g.icon} size={12} />{g.label}</div>
              {g.items.map((it) => {
                const on = multiple ? selected.includes(it.ref) : value === it.ref;
                return (
                  <button key={it.ref} className="menu-item" onClick={() => pick(it.ref)} style={{ alignItems: 'flex-start' }}>
                    <span className="model-avatar" style={{ width: 26, height: 26, borderRadius: 8, fontSize: 11, background: colorFor(it.name) }}>{it.name.replace(/^[^a-zA-Z0-9]+/, '').slice(0, 2).toUpperCase()}</span>
                    <span className="grow" style={{ minWidth: 0 }}>
                      <div className="ellipsis" style={{ color: 'var(--text)', fontWeight: 550 }}>{it.name}</div>
                      <div className="row tiny muted" style={{ gap: 8 }}>
                        <span className="ellipsis">{it.sub}</span>
                        {it.plan && <FitPill plan={it.plan} />}
                        {it.loaded === 'ready' && <span className="badge green" style={{ height: 17 }}>cargado</span>}
                        {it.loaded === 'loading' && <span className="badge amber" style={{ height: 17 }}>cargando</span>}
                        {it.caps?.includes('vision') && <Icon name="eye" size={12} />}
                        {it.caps?.includes('tools') && <Icon name="wrench" size={12} />}
                      </div>
                    </span>
                    {on && <Icon name="check" size={15} style={{ color: 'var(--accent-2)', marginTop: 4 }} />}
                  </button>
                );
              })}
            </div>
          ))}
          {!filtered.some((g) => g.items.length) && <div className="small muted" style={{ padding: 14, textAlign: 'center' }}>No hay modelos. Descarga uno o añade un proveedor.</div>}
          <div className="menu-sep" />
          <button className="menu-item" onClick={() => { setOpen(false); setView('models', { modelsTab: 'discover' }); }}><Icon name="download" size={15} />Descargar modelos locales</button>
          <button className="menu-item" onClick={() => { setOpen(false); setView('settings', { settingsTab: 'providers' }); }}><Icon name="key" size={15} />Añadir proveedor de API</button>
        </Popover>
      )}
    </>
  );
}
