import { useEffect, useRef } from 'react';
import { useStore } from '../lib/store.js';

// Fondos animados detrás de la aplicación. Ligeros: 30 fps en canvas, se pausan si la ventana está oculta.
function useCanvas(draw, deps) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext('2d');
    let raf = 0, last = 0, w = 0, h = 0, st = {};
    const size = () => { const d = Math.min(window.devicePixelRatio || 1, 1.5); w = cv.clientWidth; h = cv.clientHeight; cv.width = w * d; cv.height = h * d; ctx.setTransform(d, 0, 0, d, 0, 0); st = {}; };
    size();
    const ro = new ResizeObserver(size); ro.observe(cv);
    const acc = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#7a4be0';
    const loop = (t) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden || t - last < 33) return;
      last = t; draw(ctx, w, h, t / 1000, st, acc());
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, deps);
  return ref;
}

function Stars() {
  const ref = useCanvas((ctx, w, h, t, st, col) => {
    if (!st.s) st.s = Array.from({ length: Math.round((w * h) / 5200) }, () => ({ x: Math.random() * w, y: Math.random() * h, z: 0.2 + Math.random() * 0.8, p: Math.random() * 6.28 }));
    ctx.clearRect(0, 0, w, h);
    for (const s of st.s) {
      s.y += s.z * 0.12; s.x += s.z * 0.04; if (s.y > h) { s.y = 0; s.x = Math.random() * w; } if (s.x > w) s.x = 0;
      const a = 0.35 + 0.65 * Math.abs(Math.sin(t * s.z + s.p));
      ctx.fillStyle = s.z > 0.85 ? col : '#fff'; ctx.globalAlpha = a * s.z * 0.9;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.z * 1.5, 0, 6.28); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }, []);
  return <canvas ref={ref} className="fx-canvas" />;
}

function Constellation() {
  const ref = useCanvas((ctx, w, h, t, st, col) => {
    if (!st.p) st.p = Array.from({ length: Math.min(90, Math.round((w * h) / 16000)) }, () => ({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 0.35, vy: (Math.random() - 0.5) * 0.35 }));
    ctx.clearRect(0, 0, w, h);
    const P = st.p;
    for (const p of P) { p.x += p.vx; p.y += p.vy; if (p.x < 0 || p.x > w) p.vx *= -1; if (p.y < 0 || p.y > h) p.vy *= -1; }
    ctx.strokeStyle = col; ctx.fillStyle = col;
    for (let i = 0; i < P.length; i++) {
      for (let j = i + 1; j < P.length; j++) {
        const dx = P[i].x - P[j].x, dy = P[i].y - P[j].y, d = dx * dx + dy * dy;
        if (d < 19000) { ctx.globalAlpha = (1 - d / 19000) * 0.28; ctx.beginPath(); ctx.moveTo(P[i].x, P[i].y); ctx.lineTo(P[j].x, P[j].y); ctx.stroke(); }
      }
      ctx.globalAlpha = 0.65; ctx.beginPath(); ctx.arc(P[i].x, P[i].y, 1.6, 0, 6.28); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }, []);
  return <canvas ref={ref} className="fx-canvas" />;
}

function Waves() {
  const ref = useCanvas((ctx, w, h, t, st, col) => {
    ctx.clearRect(0, 0, w, h);
    for (let k = 0; k < 4; k++) {
      ctx.beginPath(); ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += 12) ctx.lineTo(x, h * (0.62 + k * 0.08) + Math.sin(x / (160 + k * 60) + t * (0.35 + k * 0.12) + k) * (26 + k * 9));
      ctx.lineTo(w, h); ctx.closePath();
      ctx.fillStyle = col; ctx.globalAlpha = 0.07 + k * 0.035; ctx.fill();
    }
    ctx.globalAlpha = 1;
  }, []);
  return <canvas ref={ref} className="fx-canvas" />;
}

export default function BackgroundFX() {
  const kind = useStore((s) => s.settings?.background || 'none');
  if (kind === 'none') return null;
  return (
    <div className={`fx fx-${kind}`} aria-hidden="true">
      {kind === 'aurora' && <><i /><i /><i /><i /></>}
      {kind === 'stars' && <Stars />}
      {kind === 'constellation' && <Constellation />}
      {kind === 'waves' && <Waves />}
    </div>
  );
}
