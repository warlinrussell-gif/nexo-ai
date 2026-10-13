import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { IconButton, Menu } from './ui.jsx';
import { call, nexo, fmtBytes } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { Mic } from '../lib/audio.js';

export default function Composer({ chat, running, onSend, onStop, onVoice, placeholder, disabled }) {
  const [text, setText] = useState('');
  const [atts, setAtts] = useState([]);
  const [focus, setFocus] = useState(false);
  const [drag, setDrag] = useState(false);
  const [rec, setRec] = useState(null); // { level: [] }
  const [transcribing, setTranscribing] = useState(false);
  const [permMenu, setPermMenu] = useState(null);
  const ta = useRef(null);
  const mic = useRef(null);
  const { settings, toast, updateChat } = useStore();

  useEffect(() => { autosize(); }, [text]);
  useEffect(() => { ta.current?.focus(); }, [chat?.id]);
  useEffect(() => {
    const h = (e) => { if (e.detail?.text !== undefined) { setText((t) => (t ? t + ' ' : '') + e.detail.text); ta.current?.focus(); } };
    window.addEventListener('nexo-insert', h);
    return () => window.removeEventListener('nexo-insert', h);
  }, []);

  function autosize() {
    const el = ta.current; if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(320, el.scrollHeight) + 'px';
  }

  async function addFiles(fileList) {
    const paths = [];
    const direct = [];
    for (const f of fileList) {
      const p = nexo.pathForFile(f);
      if (p) paths.push(p);
      else if (f.type.startsWith('image/')) direct.push(f);
    }
    const out = [];
    if (paths.length) out.push(...await call('app.readDropped', paths));
    for (const f of direct) {
      const data = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(f); });
      out.push({ kind: 'image', name: f.name || 'imagen.png', mime: f.type, data, size: f.size });
    }
    const bad = out.filter((a) => a.kind === 'error');
    if (bad.length) toast(`No se pudo leer: ${bad.map((b) => b.name).join(', ')}`, 'error');
    setAtts((a) => [...a, ...out.filter((x) => x.kind !== 'error')]);
  }

  async function pick() {
    const files = await call('app.pickFiles', {});
    if (files?.length) setAtts((a) => [...a, ...files]);
  }

  function onPaste(e) {
    const items = [...(e.clipboardData?.items || [])].filter((i) => i.kind === 'file');
    if (items.length) { e.preventDefault(); addFiles(items.map((i) => i.getAsFile()).filter(Boolean)); }
  }

  function submit() {
    if (running || disabled) return;
    const t = text.trim();
    if (!t && !atts.length) return;
    onSend({ text: t, attachments: atts });
    setText(''); setAtts([]);
  }

  function onKey(e) {
    const enterSends = settings?.sendOnEnter !== false;
    if (e.key === 'Enter' && !e.nativeEvent.isComposing && ((enterSends && !e.shiftKey) || (!enterSends && (e.ctrlKey || e.metaKey)))) { e.preventDefault(); submit(); }
  }

  async function startDictation() {
    try {
      const levels = [];
      mic.current = new Mic({ onLevel: (l) => { levels.push(l); if (levels.length > 60) levels.shift(); setRec({ level: [...levels] }); } });
      await mic.current.start();
      mic.current.beginManual();
      setRec({ level: [] });
    } catch (e) { toast('No se pudo acceder al micrófono: ' + e.message, 'error'); }
  }

  async function stopDictation(cancel) {
    const m = mic.current; mic.current = null;
    const wav = m?.endManual();
    m?.stop();
    setRec(null);
    if (cancel || !wav) return;
    setTranscribing(true);
    try {
      const t = await call('voice.transcribe', wav);
      if (t) setText((x) => (x ? x.trimEnd() + ' ' : '') + t);
      else toast('No se detectó voz', 'info');
    } catch (e) { toast(e.message, 'error'); }
    setTranscribing(false);
    ta.current?.focus();
  }

  const perm = chat?.permissionMode || settings?.permissions?.mode || 'smart';
  const setPerm = (m) => chat ? updateChat(chat.id, { permissionMode: m }) : useStore.getState().saveSettings({ permissions: { mode: m } });
  const permInfo = { ask: { label: 'Preguntar', icon: 'shield' }, smart: { label: 'Inteligente', icon: 'shield-check' }, full: { label: 'Acceso total', icon: 'shield-alert' } }[perm];

  return (
    <div className="composer-wrap">
      <div className={`composer ${focus ? 'focus' : ''} ${drag ? 'drag' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles([...e.dataTransfer.files]); }}>
        {atts.length > 0 && (
          <div className="composer-attach">
            {atts.map((a, i) => (
              <div key={i} className="att">
                {a.kind === 'image' ? <img src={`data:${a.mime};base64,${a.data}`} /> : <span className="file-chip"><Icon name="file" size={14} /><span className="ellipsis">{a.name}</span><span className="tiny faint">{fmtBytes(a.size)}</span></span>}
                <button className="x" onClick={() => setAtts(atts.filter((_, j) => j !== i))}><Icon name="x" size={11} /></button>
              </div>
            ))}
          </div>
        )}
        {rec ? (
          <div className="rec-bar">
            <span className="status-dot red" style={{ animation: 'pulse 1s infinite' }} />
            <div className="rec-wave">{Array.from({ length: 60 }).map((_, i) => <span key={i} style={{ height: `${Math.max(3, (rec.level[i] || 0) * 28)}px` }} />)}</div>
            <IconButton icon="x" title="Cancelar" onClick={() => stopDictation(true)} />
            <button className="btn sm primary" onClick={() => stopDictation(false)}><Icon name="check" size={14} />Transcribir</button>
          </div>
        ) : (
          <textarea ref={ta} rows={1} value={text} placeholder={transcribing ? 'Transcribiendo…' : (placeholder || 'Escribe un mensaje, arrastra archivos o pulsa el micrófono…')}
            onChange={(e) => setText(e.target.value)} onKeyDown={onKey} onPaste={onPaste} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} disabled={transcribing} />
        )}
        <div className="composer-bar">
          <IconButton icon="paperclip" title="Adjuntar archivos o imágenes" onClick={pick} />
          <button className="chip" onClick={(e) => setPermMenu(e.currentTarget)} title="Permisos de las herramientas"><Icon name={permInfo.icon} size={14} />{permInfo.label}</button>
          <button className={`chip ${chat?.toolsOverride?.length === 0 ? '' : 'on'}`} title="Activar/desactivar herramientas en este chat" onClick={() => chat && updateChat(chat.id, { toolsOverride: chat.toolsOverride?.length === 0 ? null : [] })}>
            <Icon name="wrench" size={14} />{chat?.toolsOverride?.length === 0 ? 'Sin herramientas' : 'Herramientas'}
          </button>
          <span className="grow" />
          {transcribing && <span className="spinner sm" />}
          <IconButton icon="mic" title="Dictar (voz a texto)" onClick={startDictation} disabled={!!rec || transcribing} />
          <IconButton icon="audio-lines" title="Conversación por voz" onClick={onVoice} />
          {running
            ? <button className="send stop" onClick={onStop} title="Detener"><Icon name="stop" size={14} /></button>
            : <button className="send" onClick={submit} disabled={disabled || (!text.trim() && !atts.length)} title="Enviar (Enter)"><Icon name="arrow-up" size={17} strokeWidth={2.4} /></button>}
        </div>
      </div>
      <div className="composer-foot">La IA puede equivocarse. Revisa las acciones importantes. {permInfo.label === 'Acceso total' && <span style={{ color: 'var(--amber)' }}>Acceso total activado.</span>}</div>
      {permMenu && <Menu anchor={permMenu} onClose={() => setPermMenu(null)} width={300} items={[
        { header: true, label: chat ? 'Permisos en este chat' : 'Permisos predeterminados' },
        { icon: 'shield', label: 'Preguntar antes de modificar', onClick: () => setPerm('ask') },
        { icon: 'shield-check', label: 'Inteligente (pregunta solo lo arriesgado)', onClick: () => setPerm('smart') },
        { icon: 'shield-alert', label: 'Acceso total (sin preguntar)', onClick: () => setPerm('full') },
        chat && '-',
        chat && { icon: 'settings', label: 'Usar el predeterminado', onClick: () => updateChat(chat.id, { permissionMode: null }) }
      ]} />}
    </div>
  );
}
