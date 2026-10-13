import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store.js';
import { call } from '../lib/api.js';
import { IconButton } from './ui.jsx';
import Icon from './Icon.jsx';

export default function BrowserPanel() {
  const host = useRef(null);
  const { browserState, approvals, paletteOpen, lightbox, voice } = useStore();
  const [url, setUrl] = useState(browserState.url || '');
  const [width, setWidth] = useState(() => Number(localStorage.getItem('nexo.browserWidth')) || 520);
  const [dragging, setDragging] = useState(false);
  const covered = approvals.length > 0 || paletteOpen || !!lightbox || voice.mode === 'conversation' || dragging;

  useEffect(() => { if (document.activeElement?.dataset?.url !== '1') setUrl(browserState.url || ''); }, [browserState.url]);

  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const update = () => {
      if (covered) { call('browser.hide'); return; }
      const r = el.getBoundingClientRect();
      if (r.width > 10 && r.height > 10) call('browser.show', { x: r.left, y: r.top, width: r.width, height: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener('resize', update);
    return () => { ro.disconnect(); window.removeEventListener('resize', update); };
  }, [covered, width]);

  useEffect(() => () => { call('browser.hide'); }, []);

  function startDrag(e) {
    e.preventDefault();
    setDragging(true);
    const startX = e.clientX, startW = width;
    let cur = startW;
    const move = (ev) => { cur = Math.max(340, Math.min(window.innerWidth - 560, startW + (startX - ev.clientX))); setWidth(cur); };
    const up = () => { setDragging(false); window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); localStorage.setItem('nexo.browserWidth', String(cur)); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  const go = (e) => { e.preventDefault(); if (url.trim()) call('browser.navigate', url.trim()).catch((err) => useStore.getState().toast(err.message, 'error')); };

  return (
    <div className="browser-panel" style={{ width }}>
      <div className={`resizer ${dragging ? 'drag' : ''}`} onMouseDown={startDrag} />
      <div className="browser-bar">
        <IconButton icon="arrow-left" size={15} title="Atrás" disabled={!browserState.canGoBack} onClick={() => call('browser.back')} />
        <IconButton icon="arrow-right" size={15} title="Adelante" disabled={!browserState.canGoForward} onClick={() => call('browser.forward')} />
        <IconButton icon={browserState.loading ? 'x' : 'refresh'} size={15} title="Recargar" onClick={() => call('browser.reload')} />
        <form onSubmit={go} className="grow" style={{ display: 'flex' }}>
          <input className="input url" data-url="1" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Busca o escribe una dirección" onFocus={(e) => e.target.select()} />
        </form>
        {browserState.url && <IconButton icon="external" size={15} title="Abrir en el navegador del sistema" onClick={() => call('app.openExternal', browserState.url)} />}
        <IconButton icon="x" size={15} title="Cerrar navegador" onClick={() => useStore.setState({ browserOpen: false })} />
      </div>
      {browserState.loading && <div className="progress indeterminate" style={{ borderRadius: 0, height: 2 }}><span /></div>}
      <div className="browser-host" ref={host}>
        {(!browserState.url || covered) && (
          <div className="browser-empty">
            {covered ? <span className="muted small">Navegador en pausa…</span> : (
              <div className="empty">
                <div className="empty-icon"><Icon name="globe" size={24} /></div>
                <h3>Navegador integrado</h3>
                <div className="small">Los agentes pueden navegar, leer páginas, hacer clic y rellenar formularios aquí mientras lo ves. También puedes usarlo tú.</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
