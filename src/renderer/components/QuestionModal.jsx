import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../lib/store.js';
import { call } from '../lib/api.js';
import Icon from './Icon.jsx';

// Pregunta del agente al usuario (herramienta ask_user): opciones sugeridas + respuesta libre.
export default function QuestionModal() {
  const questions = useStore((s) => s.questions);
  const approvals = useStore((s) => s.approvals);
  const q = questions[0];
  const [text, setText] = useState('');
  useEffect(() => { setText(''); }, [q?.id]);
  if (!q || approvals.length) return null;
  function respond(answer) {
    call('question.respond', q.id, answer);
    useStore.setState((s) => ({ questions: s.questions.filter((x) => x.id !== q.id) }));
  }
  return createPortal(
    <div className="backdrop">
      <div className="modal" style={{ width: 560 }}>
        <div className="modal-head">
          <span style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'color-mix(in oklab, var(--accent) 16%, transparent)', color: 'var(--accent)' }}><Icon name="info" size={18} /></span>
          <h2>Nexo te pregunta</h2>
          {questions.length > 1 && <span className="badge">{questions.length} pendientes</span>}
        </div>
        <div className="modal-body">
          <div style={{ whiteSpace: 'pre-wrap', marginBottom: 14, color: 'var(--text)' }}>{q.question}</div>
          {q.options?.length > 0 && (
            <div className="col" style={{ gap: 6, marginBottom: 12 }}>
              {q.options.map((o, i) => (
                <button key={i} className="btn" style={{ justifyContent: 'flex-start', textAlign: 'left', height: 'auto', padding: '8px 12px' }} onClick={() => respond(o)}>
                  <span className="badge" style={{ marginRight: 8 }}>{i + 1}</span>{o}
                </button>
              ))}
            </div>
          )}
          <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) respond(text.trim()); }} className="row" style={{ gap: 8 }}>
            <input className="input grow" autoFocus placeholder={q.options?.length ? 'U otra respuesta…' : 'Tu respuesta…'} value={text} onChange={(e) => setText(e.target.value)} />
            <button className="btn primary" type="submit" disabled={!text.trim()}>Responder</button>
          </form>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={() => respond(null)}>Omitir (que decida el agente)</button>
        </div>
      </div>
    </div>, document.body);
}
