import { useEffect, useRef, useState, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon.jsx';

export function Button({ variant, size, icon, children, className = '', loading, ...rest }) {
  return (
    <button className={`btn ${variant || ''} ${size || ''} ${className}`} disabled={loading || rest.disabled} {...rest}>
      {loading ? <span className="spinner sm" /> : icon ? <Icon name={icon} size={size === 'sm' || size === 'xs' ? 14 : 16} /> : null}
      {children}
    </button>
  );
}

export function IconButton({ icon, size = 16, className = '', title, active, ...rest }) {
  return <button className={`icon-btn ${active ? 'active' : ''} ${className}`} title={title} aria-label={title} {...rest}><Icon name={icon} size={size} /></button>;
}

export function Toggle({ value, onChange, disabled }) {
  return <div role="switch" aria-checked={!!value} className={`toggle ${value ? 'on' : ''}`} style={disabled ? { opacity: .5, pointerEvents: 'none' } : undefined} onClick={() => onChange(!value)} />;
}

export function Seg({ value, onChange, options }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)} title={o.title}>
          {o.icon && <Icon name={o.icon} size={14} />}{o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs({ value, onChange, tabs }) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button key={t.value} className={value === t.value ? 'on' : ''} onClick={() => onChange(t.value)}>
          {t.icon && <Icon name={t.icon} size={15} />}{t.label}{t.count ? <span className="count">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide, icon }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return createPortal(
    <div className="backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`}>
        <div className="modal-head">{icon && <Icon name={icon} size={18} />}<h2>{title}</h2>{onClose && <IconButton icon="x" onClick={onClose} title="Cerrar" />}</div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>, document.body);
}

export function Drawer({ title, onClose, children, actions, width }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return createPortal(
    <div className="drawer-wrap" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="drawer" style={width ? { width } : undefined}>
        <div className="drawer-head"><h2 className="ellipsis">{title}</h2>{actions}<IconButton icon="x" onClick={onClose} title="Cerrar" /></div>
        <div className="drawer-body">{children}</div>
      </div>
    </div>, document.body);
}

/** Popover anclado a un elemento */
export function Popover({ anchor, onClose, children, align = 'left', width, placement = 'bottom', maxHeight = 460 }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const w = width || 280;
    let left = align === 'right' ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    if (placement === 'top') {
      // hacia arriba, pero sin salirse de la ventana; si arriba hay poco sitio y abajo más, se abre hacia abajo
      const spaceAbove = r.top - 12, spaceBelow = window.innerHeight - r.bottom - 12;
      if (spaceAbove < 220 && spaceBelow > spaceAbove) setPos({ left, top: r.bottom + 6, width: w, maxH: Math.min(maxHeight, spaceBelow) });
      else setPos({ left, bottom: window.innerHeight - r.top + 6, width: w, maxH: Math.min(maxHeight, spaceAbove) });
    }
    else {
      const spaceBelow = window.innerHeight - r.bottom - 12;
      if (spaceBelow < 260 && r.top > spaceBelow) setPos({ left, bottom: window.innerHeight - r.top + 6, width: w, maxH: Math.min(maxHeight, r.top - 20) });
      else setPos({ left, top: r.bottom + 6, width: w, maxH: Math.min(maxHeight, spaceBelow) });
    }
  }, [anchor, align, width, placement, maxHeight]);
  useEffect(() => {
    const down = (e) => { if (ref.current && !ref.current.contains(e.target) && !anchor?.contains(e.target)) onClose?.(); };
    const key = (e) => { if (e.key === 'Escape') onClose?.(); };
    setTimeout(() => window.addEventListener('mousedown', down), 0);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('mousedown', down); window.removeEventListener('keydown', key); };
  }, [anchor, onClose]);
  if (!pos) return null;
  return createPortal(
    <div ref={ref} className="popover" style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width, maxHeight: pos.maxH || maxHeight, overflowY: 'auto', position: 'fixed' }}>{children}</div>,
    document.body);
}

export function Menu({ anchor, onClose, items, width = 220, align }) {
  return (
    <Popover anchor={anchor} onClose={onClose} width={width} align={align}>
      {items.filter(Boolean).map((it, i) => it === '-' ? <div key={i} className="menu-sep" /> : it.label && it.header ? <div key={i} className="menu-label">{it.label}</div> : (
        <button key={i} className={`menu-item ${it.danger ? 'danger' : ''}`} onClick={() => { onClose(); it.onClick?.(); }}>
          {it.icon && <Icon name={it.icon} size={15} />}<span className="grow">{it.label}</span>{it.hint && <span className="tiny faint">{it.hint}</span>}
        </button>
      ))}
    </Popover>
  );
}

export function Field({ label, hint, children }) {
  return <div className="field">{label && <label>{label}</label>}{children}{hint && <div className="hint">{hint}</div>}</div>;
}

export function Setting({ title, desc, children }) {
  return <div className="setting"><div className="info"><div className="t">{title}</div>{desc && <div className="d">{desc}</div>}</div><div className="ctl">{children}</div></div>;
}

export function Empty({ icon = 'sparkles', title, children, action }) {
  return <div className="empty"><div className="empty-icon"><Icon name={icon} size={24} /></div>{title && <h3>{title}</h3>}{children && <div className="small" style={{ maxWidth: 440 }}>{children}</div>}{action}</div>;
}

export function Spinner({ size }) { return <span className={`spinner ${size || ''}`} />; }

export function Progress({ value, indeterminate }) {
  return <div className={`progress ${indeterminate ? 'indeterminate' : ''}`}><span style={{ width: `${Math.max(0, Math.min(100, value || 0))}%` }} /></div>;
}

export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const reload = async () => {
    setState((s) => ({ ...s, loading: true }));
    try { setState({ loading: false, data: await fn(), error: null }); } catch (e) { setState({ loading: false, data: null, error: e.message }); }
  };
  useEffect(() => { reload(); }, deps); // eslint-disable-line
  return { ...state, reload, setData: (data) => setState((s) => ({ ...s, data })) };
}

export function Confirm({ title, text, confirmLabel = 'Confirmar', danger, onConfirm, onClose }) {
  return (
    <Modal title={title} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant={danger ? 'danger' : 'primary'} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</Button></>}>
      <p className="muted" style={{ margin: 0 }}>{text}</p>
    </Modal>
  );
}
