// Recomendación de modelos locales por tarea (programar, navegar, controlar el PC...).
// Combina lo que sabe hacer el modelo (caps/tags/familia) con lo bien que va en el equipo (planModel).

import { planModel, plausibleQuant, QUANT_BPW } from './fit.js';

export const TASKS = {
  codigo: {
    label: 'Programar', icon: 'code', agent: 'coder',
    desc: 'Escribir, depurar y ejecutar código en tus proyectos',
    need: ['tools'], caps: { code: 45, reasoning: 12, tools: 5 }, tags: { codigo: 30 },
    names: [[/coder|devstral|codestral/i, 35], [/qwen3\.[5-8]|gpt-oss|glm-4\.7/i, 10]]
  },
  navegar: {
    label: 'Navegar e investigar', icon: 'globe', agent: 'researcher',
    desc: 'Buscar en la web, leer páginas y resumir fuentes',
    need: ['tools'], caps: { reasoning: 15, tools: 10, vision: 10 }, tags: { agente: 20 },
    names: [[/agentworld|jan-v|ornith/i, 20], [/qwen3\.[5-8]|gpt-oss|gemma-4/i, 10]]
  },
  pc: {
    label: 'Controlar el PC (pantalla)', icon: 'mouse-pointer-click', agent: 'operator',
    desc: 'Ver la pantalla, mover el ratón y escribir como una persona',
    need: ['vision', 'tools'], caps: { computer: 60, vision: 15, reasoning: 5 }, tags: { 'control-pc': 25 },
    names: [[/fara|ui-mate|ui-tars/i, 25]]
  },
  sistema: {
    label: 'Tareas y optimización del PC', icon: 'terminal', agent: 'assistant',
    desc: 'Comandos, archivos, limpieza, ajustes y diagnósticos',
    need: ['tools'], caps: { reasoning: 20, tools: 15 }, tags: { agente: 25 },
    names: [[/agentworld|jan-v|nemotron|gpt-oss/i, 15], [/qwen3\.[5-8]/i, 10]]
  },
  chat: {
    label: 'Chat general', icon: 'chat', agent: null,
    desc: 'Conversar, redactar, traducir y explicar',
    need: [], caps: { reasoning: 10 }, tags: { recomendado: 15 }, names: []
  }
};

/** Tarea más adecuada para un agente según sus herramientas. */
export function taskForAgent(agent = {}) {
  const byId = Object.entries(TASKS).find(([, t]) => t.agent === agent.id);
  if (byId) return byId[0];
  const tools = agent.tools || [];
  if (tools.includes('computer')) return 'pc';
  if (/c[oó]digo|program|dev|code/i.test(`${agent.name} ${agent.description}`)) return 'codigo';
  if (tools.includes('system')) return 'sistema';
  if (tools.includes('browser') || tools.includes('web')) return 'navegar';
  return 'chat';
}

const SPEED = { fluido: 30, bueno: 15, lento: -10, muylento: -40 };
const SPEED_TXT = { fluido: 'va fluido', bueno: 'va bien', lento: 'va lento', muylento: 'muy lento' };

/** Mejor cuantización que funciona en el equipo (prefiere fluida y de buena calidad). */
function bestPlan(m, budget, ctx) {
  const meta = m.meta || { params: m.params };
  const plans = (m.quants || [])
    .filter((q) => plausibleQuant(q, m.params) && (QUANT_BPW[q.quant] || 5) >= 3.4 && (QUANT_BPW[q.quant] || 5) <= 6.7)
    .map((q) => ({ q, p: planModel(meta, budget, { ctx, fileSize: q.size }) }))
    .filter((x) => x.p.fits)
    .sort((a, b) => b.q.size - a.q.size);
  // Dejar margen de RAM para el sistema y otros programas (≤70% del presupuesto) y no pasar de ~Q5 si va a RAM
  const roomy = (x) => x.p.cpuBytes <= budget.ram * 0.7 && (x.p.mode === 'gpu' || (QUANT_BPW[x.q.quant] || 5) <= 5.7);
  return plans.find((x) => x.p.rating === 'fluido' && roomy(x)) || plans.find((x) => x.p.rating === 'bueno' && roomy(x))
    || plans.find((x) => x.p.rating === 'fluido') || plans.find((x) => x.p.rating === 'bueno') || plans[0] || null;
}

const CAP_TXT = { vision: 'visión', tools: 'uso de herramientas', computer: 'control del PC', code: 'código' };
export const GROUPS = {
  fluido: { label: 'Fluidos en tu equipo', color: 'green' },
  lento: { label: 'Funcionan, pero lentos', color: 'amber' },
  noapto: { label: 'No aptos', color: 'red' }
};

/** Grupo de un plan: fluido (fluido/bien), lento o no apto. */
export function groupOf(plan) {
  if (!plan || !plan.fits) return 'noapto';
  return plan.rating === 'fluido' || plan.rating === 'bueno' ? 'fluido' : 'lento';
}

/** Puntúa un modelo del catálogo para una tarea. Siempre devuelve entrada con group + why. */
export function scoreForTask(m, taskId, budget, ctx = 8192) {
  const t = TASKS[taskId];
  const caps = m.caps || [];
  const missing = t.need.filter((c) => !caps.includes(c));
  const best = budget ? bestPlan(m, budget, ctx) : null;
  if (missing.length || !best) {
    const q = (m.quants || []).filter((x) => plausibleQuant(x, m.params)).sort((a, b) => a.size - b.size)[0];
    const plan = budget && q ? planModel(m.meta || { params: m.params }, budget, { ctx, fileSize: q.size }) : null;
    const why = missing.length ? `No sirve para esto: le falta ${missing.map((c) => CAP_TXT[c] || c).join(' y ')}` : `No cabe en tu GPU+RAM (ni en ${q?.quant || 'la versión más pequeña'})`;
    return { m, q, plan, score: -1e6 + (m.params || 0) / 1e9, group: 'noapto', why };
  }
  let skill = 0;
  for (const [c, w] of Object.entries(t.caps)) if (caps.includes(c)) skill += w;
  for (const [g, w] of Object.entries(t.tags)) if (m.tags?.includes(g)) skill += w;
  for (const [re, w] of t.names) if (re.test(m.name)) { skill += w; break; }
  if (taskId !== 'codigo' && /coder|devstral|codestral/i.test(m.name)) skill -= 25; // especialistas en código: peores fuera de su terreno
  if (taskId !== 'pc' && caps.includes('computer')) skill -= 10;
  const size = Math.max(0, Math.log2((m.params || 1e9) / 1e9)) * 9; // más parámetros ≈ más listo
  const fresh = m.updated && Date.now() - new Date(m.updated).getTime() < 365 * 864e5 ? 8 : 0;
  const score = skill + size + fresh + (m.tags?.includes('recomendado') ? 6 : 0) + (SPEED[best.p.rating] || 0);
  const why = [];
  if (taskId === 'codigo' && caps.includes('code')) why.push('especializado en código');
  if (taskId === 'pc' && caps.includes('computer')) why.push('entrenado para usar el PC');
  if (taskId !== 'codigo' && taskId !== 'pc' && m.tags?.includes('agente')) why.push('entrenado para agentes');
  if (caps.includes('reasoning')) why.push('razona');
  why.push(best.p.mode === 'gpu' ? '100% en tu GPU' : best.p.mode === 'moe' ? 'MoE GPU+RAM' : 'parte en RAM');
  why.push(`${SPEED_TXT[best.p.rating] || ''} (~${best.p.tps} t/s)`);
  return { m, q: best.q, plan: best.p, score, group: groupOf(best.p), why: why.join(' · ') };
}

const GROUP_ORDER = { fluido: 0, lento: 1, noapto: 2 };

/** Ranking de modelos del catálogo para una tarea: fluidos, luego lentos, luego no aptos. */
export function rankForTask(models = [], taskId, budget, ctx = 8192) {
  return models.map((m) => scoreForTask(m, taskId, budget, ctx)).sort((a, b) => (GROUP_ORDER[a.group] - GROUP_ORDER[b.group]) || (b.score - a.score));
}
