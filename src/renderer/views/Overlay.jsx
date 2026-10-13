import { useEffect, useState } from 'react';
import { call, on } from '../lib/api.js';

// Píldora flotante mostrada mientras un agente controla el ordenador (excluida de las capturas).
export default function Overlay() {
  const [last, setLast] = useState('Preparando…');
  const [approval, setApproval] = useState(null);
  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    const off1 = on('message', ({ message }) => {
      const blocks = message.blocks || [];
      const tools = [];
      const walk = (bs) => { for (const b of bs) { if (b.type === 'tool') { tools.push(b); if (b.sub) walk(b.sub.blocks || []); } } };
      walk(blocks);
      const t = tools[tools.length - 1];
      if (t) {
        const a = t.args || {};
        const txt = t.name === 'computer' ? `${{ screenshot: 'Mirando la pantalla', click: 'Clic', double_click: 'Doble clic', right_click: 'Clic derecho', type: 'Escribiendo', key: 'Pulsando teclas', scroll: 'Desplazando', move: 'Moviendo el ratón', drag: 'Arrastrando', wait: 'Esperando' }[a.action] || a.action}${a.action === 'type' ? ` "${String(a.text || '').slice(0, 24)}"` : a.action === 'key' ? ` ${a.keys || ''}` : ''}` : `${t.name}`;
        setLast(txt);
      } else if (message.status === 'writing') setLast('Escribiendo respuesta…');
      else if (message.status === 'thinking') setLast('Pensando…');
    });
    const off2 = on('approval', (a) => setApproval(a));
    const off3 = on('approval-done', ({ id }) => setApproval((cur) => (cur?.id === id ? null : cur)));
    return () => { off1(); off2(); off3(); };
  }, []);
  const respond = (d) => { if (approval) { call('approval.respond', approval.id, d); setApproval(null); } };
  return (
    <div className="overlay-root">
      <div className="overlay-pill">
        <span className="status-dot blue" />
        {approval ? (
          <>
            <span style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>¿Permitir {approval.tool}?</span>
            <button className="btn xs" onClick={() => respond('deny')}>No</button>
            <button className="btn xs primary" onClick={() => respond('allow')}>Sí</button>
          </>
        ) : (
          <span style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><strong>Nexo</strong> · {last}</span>
        )}
        <button className="btn xs" style={{ background: '#ef4444', color: '#fff', borderColor: 'transparent' }} onClick={() => call('overlay.stop')} title="Detener (Ctrl+Alt+Q)">Detener</button>
      </div>
    </div>
  );
}
