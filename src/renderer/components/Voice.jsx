import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../lib/store.js';
import { call, on } from '../lib/api.js';
import { Mic, Speaker, SentenceSplitter, matchWakeWord } from '../lib/audio.js';
import { textOf } from './Message.jsx';
import Icon from './Icon.jsx';

function chime(up = true) {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(up ? 660 : 880, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(up ? 990 : 520, ctx.currentTime + 0.14);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
    o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.25);
    setTimeout(() => ctx.close(), 400);
  } catch { }
}

let speakerSingleton = null;
export function getSpeaker() {
  if (!speakerSingleton) speakerSingleton = new Speaker(() => useStore.getState().settings);
  return speakerSingleton;
}

/** Controlador de voz global: modo conversación (pantalla completa) y modo JARVIS (manos libres). */
export default function VoiceController() {
  const voice = useStore((s) => s.voice);
  const [level, setLevel] = useState(0);
  const [userText, setUserText] = useState('');
  const [aiText, setAiText] = useState('');
  const ref = useRef({ mic: null, chatId: null, msgId: null, consumed: 0, splitter: null, awaitingUntil: 0, busy: false, mode: 'off' });
  const speaker = getSpeaker();

  const setVoice = (patch) => useStore.setState((s) => ({ voice: { ...s.voice, ...patch } }));

  // seguimiento del texto en streaming para hablarlo por frases
  useEffect(() => {
    const unsub = useStore.subscribe((s) => {
      const r = ref.current;
      if (!r.chatId || r.mode === 'off' || (!r.busy && !r.msgId)) return;
      const chat = s.chatCache[r.chatId];
      if (!chat) return;
      let msg;
      if (r.msgId) msg = chat.messages.find((m) => m.id === r.msgId);
      else {
        const cand = chat.messages[chat.messages.length - 1];
        if (cand?.role === 'assistant' && chat.messages.length > r.baseCount) { msg = cand; r.msgId = cand.id; }
      }
      if (!msg) return;
      const text = textOf(msg.blocks || msg.variants?.[0]?.blocks || []);
      if (text.length > r.consumed) {
        const delta = text.slice(r.consumed);
        r.consumed = text.length;
        r.splitter?.push(delta);
        setAiText(text.length > 400 ? '…' + text.slice(-400) : text);
      }
      if (['done', 'error', 'stopped'].includes(msg.status) && r.busy) {
        r.splitter?.flush();
        r.busy = false;
        if (msg.error) { speaker.speak('Ha ocurrido un error: ' + msg.error.slice(0, 120)); }
        waitSpeakerThenListen();
      }
    });
    return unsub;
  }, []);

  function waitSpeakerThenListen() {
    const r = ref.current;
    const check = () => {
      if (r.mode === 'off') return;
      if (speaker.playing) { setTimeout(check, 250); return; }
      if (r.mic) r.mic.paused = false;
      setVoice({ status: 'listening' });
    };
    check();
  }

  speaker.onState = (playing) => {
    const r = ref.current;
    if (playing) { if (r.mic && r.mode === 'conversation') r.mic.paused = true; setVoice({ status: 'speaking' }); }
  };

  async function ensureChat(kind) {
    const st = useStore.getState();
    if (kind === 'jarvis') {
      let id = localStorage.getItem('nexo.jarvisChat');
      let chat = id ? await call('chats.get', id) : null;
      if (!chat) {
        chat = await call('chats.create', { title: 'JARVIS', agentId: st.settings?.voice?.jarvisAgent || 'jarvis', model: st.settings?.voice?.jarvisModel || st.settings?.defaultModel || null });
        localStorage.setItem('nexo.jarvisChat', chat.id);
        st.refreshChats();
      }
      useStore.setState((s) => ({ chatCache: { ...s.chatCache, [chat.id]: chat } }));
      return chat.id;
    }
    if (st.currentChatId) return st.currentChatId;
    const chat = await st.newChat();
    return chat.id;
  }

  async function handleCommand(text) {
    const r = ref.current;
    const low = text.toLowerCase();
    if (/^(para|detente|silencio|stop|cállate|basta)\b/.test(low)) { speaker.stop(); if (r.chatId) call('chats.stop', r.chatId); setVoice({ status: 'listening' }); return; }
    if (r.mode === 'conversation' && /^(adiós|terminar conversación|salir del modo voz)\b/.test(low)) { stopAll(); return; }
    r.chatId = await ensureChat(r.mode === 'jarvis' ? 'jarvis' : 'chat');
    r.baseCount = (useStore.getState().chatCache[r.chatId]?.messages.length || 0) + 1;
    r.msgId = null; r.consumed = 0; r.busy = true;
    r.splitter = new SentenceSplitter((s) => speaker.speak(s));
    setAiText('');
    setVoice({ status: 'thinking' });
    if (r.mic) r.mic.paused = r.mode === 'conversation';
    if (useStore.getState().running.has(r.chatId)) { await call('chats.stop', r.chatId); await new Promise((res) => setTimeout(res, 400)); }
    await useStore.getState().sendMessage(r.chatId, { text });
  }

  async function onUtterance(wav) {
    const r = ref.current;
    if (r.transcribing) return;
    r.transcribing = true;
    const prevStatus = useStore.getState().voice.status;
    if (r.mode === 'conversation') setVoice({ status: 'transcribing' });
    try {
      const wake = useStore.getState().settings?.voice?.wakeWord || 'jarvis';
      const text = await call('voice.transcribe', wav, r.mode === 'jarvis' ? { prompt: `${wake}.` } : {});
      if (!text || text.length < 2) { if (r.mode === 'conversation') setVoice({ status: 'listening' }); return; }
      if (r.mode === 'conversation') { setUserText(text); await handleCommand(text); return; }
      // JARVIS: palabra de activación
      const m = matchWakeWord(text, wake);
      if (m.matched) {
        if (speaker.playing) speaker.stop();
        if (!m.command || m.command.length < 2) { chime(); r.awaitingUntil = Date.now() + 9000; setVoice({ status: 'awake' }); speaker.speak('¿Sí?'); return; }
        chime(); setUserText(m.command); await handleCommand(m.command);
      } else if (Date.now() < r.awaitingUntil) {
        r.awaitingUntil = 0; setUserText(text); await handleCommand(text);
      } else if (prevStatus !== 'thinking') setVoice({ status: 'listening' });
    } catch (e) {
      useStore.getState().toast(e.message, 'error');
      if (/instalado|Descárgalo|clave/i.test(e.message)) stopAll();
      else if (r.mode === 'conversation') setVoice({ status: 'listening' });
    } finally { r.transcribing = false; }
  }

  async function start(mode) {
    const r = ref.current;
    if (r.mic) { r.mic.stop(); r.mic = null; }
    speaker.stop();
    r.mode = mode;
    setUserText(''); setAiText('');
    const s = useStore.getState().settings?.voice || {};
    try {
      r.mic = new Mic({ vad: true, threshold: s.vadThreshold ?? 0.5, silenceMs: s.silenceMs || 900, onLevel: (l) => setLevel(l), onUtterance, onSpeechStart: () => { if (r.mode === 'conversation' && speaker.playing) { /* sin interrupción por eco */ } } });
      await r.mic.start();
      setVoice({ mode, status: 'listening' });
      if (mode === 'jarvis') { chime(); useStore.getState().toast(`Modo JARVIS activo: di "${s.wakeWord || 'Jarvis'}" seguido de tu orden.`, 'success'); }
    } catch (e) {
      r.mode = 'off';
      setVoice({ mode: 'off', status: 'idle' });
      useStore.getState().toast('No se pudo acceder al micrófono: ' + e.message, 'error');
    }
  }

  function stopAll() {
    const r = ref.current;
    r.mic?.stop(); r.mic = null;
    speaker.stop();
    r.mode = 'off'; r.busy = false;
    setVoice({ mode: 'off', status: 'idle' });
  }

  useEffect(() => {
    const h = (e) => {
      const r = ref.current;
      if (e.detail === 'conversation') start('conversation');
      else if (e.detail === 'jarvis-toggle') { if (r.mode === 'jarvis') { stopAll(); chime(false); } else start('jarvis'); }
      else if (e.detail === 'stop') stopAll();
    };
    window.addEventListener('nexo-voice', h);
    const offCmd = on('command', (cmd) => {
      const r = ref.current;
      if (cmd === 'voice-hotkey') {
        if (r.mode === 'jarvis') { chime(); r.awaitingUntil = Date.now() + 9000; setVoice({ status: 'awake' }); }
        else if (r.mode === 'conversation') stopAll();
        else start('conversation');
      } else if (cmd === 'jarvis-toggle') h({ detail: 'jarvis-toggle' });
      else if (cmd === 'voice') start('conversation');
    });
    return () => { window.removeEventListener('nexo-voice', h); offCmd(); };
  }, []);

  if (voice.mode !== 'conversation') return null;
  const statusText = { listening: 'Te escucho…', transcribing: 'Transcribiendo…', thinking: 'Pensando…', speaking: 'Hablando…', awake: 'Dime…', idle: '' }[voice.status] || '';
  const scale = voice.status === 'listening' ? 1 + level * 0.35 : voice.status === 'speaking' ? 1.05 : 1;
  return createPortal(
    <div className="voice-screen">
      <div className={`voice-orb ${voice.status === 'thinking' || voice.status === 'transcribing' ? 'thinking' : ''} ${voice.status === 'idle' ? 'idle' : ''}`}>
        <div className="ring" /><div className="ring" />
        <div className="core" style={{ transform: `scale(${scale})` }} />
      </div>
      <div className="voice-status">{statusText}</div>
      <div className="voice-caption user">{userText}</div>
      <div className="voice-caption selectable">{aiText}</div>
      <div className="voice-controls">
        {voice.status === 'speaking' && <button className="round" title="Interrumpir" onClick={() => { speaker.stop(); waitSpeakerThenListen(); }}><Icon name="volume-x" size={22} /></button>}
        {voice.status === 'thinking' && <button className="round" title="Detener respuesta" onClick={() => { if (ref.current.chatId) call('chats.stop', ref.current.chatId); }}><Icon name="stop" size={20} /></button>}
        <button className="round red" title="Terminar" onClick={stopAll}><Icon name="x" size={24} /></button>
      </div>
      <div className="kbd-hint">Habla con naturalidad; se envía al hacer una pausa. Di «para» para interrumpir.</div>
    </div>, document.body);
}

export function JarvisPill() {
  const voice = useStore((s) => s.voice);
  if (voice.mode !== 'jarvis') return null;
  const t = { listening: 'JARVIS escuchando', awake: 'JARVIS: dime', thinking: 'JARVIS pensando', speaking: 'JARVIS hablando', transcribing: 'JARVIS' }[voice.status] || 'JARVIS';
  return (
    <button className="jarvis-pill no-drag" title="Modo JARVIS activo — clic para desactivar" onClick={() => window.dispatchEvent(new CustomEvent('nexo-voice', { detail: 'jarvis-toggle' }))}>
      <Icon name="radio" size={13} />{t}
      {voice.status === 'thinking' && <span className="spinner sm" />}
    </button>
  );
}
