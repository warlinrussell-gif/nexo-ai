import { useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { Menu } from './ui.jsx';

// Niveles de pensamiento: los de Nexo para sus agentes y los propios de cada modelo de OpenCode (variants).
export const NEXO_LEVELS = ['auto', 'none', 'low', 'medium', 'high'];
const LABELS = { auto: 'Automático', none: 'Sin razonamiento', minimal: 'Mínimo', low: 'Bajo', medium: 'Medio', high: 'Alto', xhigh: 'Muy alto', max: 'Máximo', thinking: 'Pensando' };
const HINTS = { auto: 'El modelo decide', none: 'Responde directo, más rápido', minimal: 'Casi sin pensar', low: 'Piensa poco', medium: 'Equilibrado', high: 'Piensa más, más lento', xhigh: 'Muy detallado', max: 'Todo el pensamiento posible' };
export const levelLabel = (v) => LABELS[v] || v;

export default function ThinkingPicker({ value = 'auto', onChange, levels = NEXO_LEVELS, autoLabel }) {
  const btn = useRef(null);
  const [open, setOpen] = useState(false);
  const label = value === 'auto' ? (autoLabel || LABELS.auto) : levelLabel(value);
  return (
    <>
      <button ref={btn} className={`tool-btn ${value !== 'auto' ? 'on' : ''}`} title={`Nivel de pensamiento: ${label}`} onClick={() => setOpen(!open)}>
        <Icon name="brain" size={15} /><span className="tool-btn-label ellipsis" style={{ maxWidth: 170 }}>{value === 'auto' && !autoLabel ? 'Pensamiento' : label}</span>
      </button>
      {open && <Menu anchor={btn.current} onClose={() => setOpen(false)} width={270} items={[
        { header: true, label: 'Nivel de pensamiento' },
        ...levels.map((v) => ({ icon: value === v ? 'check' : 'circle', label: `${v === 'auto' ? (autoLabel || LABELS.auto) : levelLabel(v)}${HINTS[v] && v !== 'auto' ? ` · ${HINTS[v]}` : ''}`, onClick: () => onChange(v) }))
      ]} />}
    </>
  );
}
