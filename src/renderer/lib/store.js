import { create } from 'zustand';
import { call, on } from './api.js';

let toastId = 0;

export const useStore = create((set, get) => ({
  info: null,
  settings: null,
  view: 'chat',
  hw: null,
  live: null,
  chats: [],
  currentChatId: null,
  chatCache: {},
  running: new Set(),
  localModels: [],
  instances: [],
  downloads: {},
  providers: [],
  providerTypes: {},
  agents: [],
  mcp: [],
  approvals: [],
  questions: [],
  toasts: [],
  browserOpen: false,
  browserState: { url: '', title: '' },
  sidebarOpen: true,
  paletteOpen: false,
  voice: { mode: 'off', status: 'idle' },
  lightbox: null,
  draft: {},
  modelsTab: 'discover',
  settingsTab: 'general',

  setView: (view, extra = {}) => set({ view, ...extra }),
  toast: (text, type = 'info', ms = 4200) => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, text, type }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms);
  },

  async boot() {
    const info = await call('app.info');
    set({ info });
    if (!info.configured) { set({ setupActive: true }); return; }
    await get().loadAll();
    if (!get().settings?.setupDone) set({ setupActive: true });
  },

  async loadAll() {
    const [settings, chats, localModels, instances, dls, providers, providerTypes, agents, mcp] = await Promise.all([
      call('settings.get'), call('chats.list'), call('models.local').catch(() => []), call('llama.list'), call('dl.list'), call('prov.list'), call('prov.types'), call('agents.list'), call('mcp.list')
    ]);
    const downloads = {};
    for (const d of dls) downloads[d.id] = d;
    set({ settings, chats, localModels, instances, downloads, providers, providerTypes, agents, mcp });
    applyTheme(settings);
    call('hw.scan').then((hw) => set({ hw })).catch(() => { });
    const running = await call('chats.running');
    set({ running: new Set(running) });
  },

  async saveSettings(patch) {
    const settings = await call('settings.set', patch);
    set({ settings });
    applyTheme(settings);
    return settings;
  },

  async refreshChats() { set({ chats: await call('chats.list') }); },
  async refreshLocal() { set({ localModels: await call('models.local') }); },
  async refreshProviders() { set({ providers: await call('prov.list') }); },
  async refreshAgents() { set({ agents: await call('agents.list') }); },

  async openChat(id) {
    if (!id) { set({ currentChatId: null, view: 'chat' }); return; }
    const chat = await call('chats.get', id);
    if (!chat) return;
    set((s) => ({ currentChatId: id, view: 'chat', chatCache: { ...s.chatCache, [id]: chat } }));
  },

  async newChat(data = {}) {
    const chat = await call('chats.create', data);
    set((s) => ({ currentChatId: chat.id, view: 'chat', chatCache: { ...s.chatCache, [chat.id]: chat } }));
    get().refreshChats();
    return chat;
  },

  async updateChat(id, patch) {
    const chat = await call('chats.update', id, patch);
    set((s) => ({ chatCache: { ...s.chatCache, [id]: { ...s.chatCache[id], ...chat } } }));
    get().refreshChats();
    return chat;
  },

  async deleteChat(id) {
    await call('chats.delete', id);
    set((s) => { const c = { ...s.chatCache }; delete c[id]; return { chatCache: c, currentChatId: s.currentChatId === id ? null : s.currentChatId }; });
    get().refreshChats();
  },

  async sendMessage(chatId, payload) {
    set((s) => ({ running: new Set([...s.running, chatId]) }));
    // mensaje optimista del usuario
    if (payload.text !== undefined || payload.attachments?.length) {
      set((s) => {
        const c = s.chatCache[chatId];
        if (!c) return {};
        const atts = (payload.attachments || []).map((a) => ({ ...a, preview: a.kind === 'image' ? `data:${a.mime};base64,${a.data}` : undefined }));
        return { chatCache: { ...s.chatCache, [chatId]: { ...c, messages: [...c.messages, { id: 'tmp_' + Date.now(), role: 'user', content: payload.text, attachments: atts, createdAt: Date.now(), optimistic: true }] } } };
      });
    }
    await call('chats.send', chatId, payload);
  },

  applyMessage(chatId, message) {
    set((s) => {
      const c = s.chatCache[chatId];
      if (!c) return {};
      let msgs = c.messages;
      const i = msgs.findIndex((m) => m.id === message.id);
      if (i >= 0) { msgs = [...msgs]; msgs[i] = message; }
      else msgs = [...msgs, message];
      return { chatCache: { ...s.chatCache, [chatId]: { ...c, messages: msgs } } };
    });
  }
}));

export function applyTheme(settings) {
  if (!settings) return;
  const root = document.documentElement;
  let theme = settings.theme || 'dark';
  if (theme === 'system') theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  root.dataset.theme = theme;
  root.style.setProperty('--accent', settings.accent || '#d97757');
  root.style.setProperty('--fs', `${Math.round(14 * (settings.fontScale || 1) * 10) / 10}px`);
}

// ───── Eventos del proceso principal ─────
export function wireEvents() {
  const st = useStore;
  on('message', ({ chatId, message }) => st.getState().applyMessage(chatId, message));
  on('chat-meta', ({ chatId, title }) => {
    st.setState((s) => ({ chatCache: s.chatCache[chatId] ? { ...s.chatCache, [chatId]: { ...s.chatCache[chatId], title } } : s.chatCache }));
    st.getState().refreshChats();
  });
  on('run-end', async ({ chatId }) => {
    st.setState((s) => { const r = new Set(s.running); r.delete(chatId); return { running: r }; });
    const chat = await call('chats.get', chatId);
    if (chat) st.setState((s) => ({ chatCache: { ...s.chatCache, [chatId]: chat } }));
    st.getState().refreshChats();
  });
  on('downloads', (d) => st.setState((s) => {
    const downloads = { ...s.downloads };
    if (d.status === 'cancelled') delete downloads[d.id]; else downloads[d.id] = d;
    return { downloads };
  }));
  on('llama', (instances) => st.setState({ instances }));
  on('mcp', (mcp) => st.setState({ mcp }));
  on('models-changed', () => st.getState().refreshLocal());
  on('catalog-changed', () => st.setState((s) => ({ catalogVersion: (s.catalogVersion || 0) + 1 })));
  on('providers-changed', () => st.getState().refreshProviders());
  on('approval', (a) => st.setState((s) => ({ approvals: [...s.approvals, a] })));
  on('question', (q) => st.setState((s) => ({ questions: [...s.questions, q] })));
  on('question-done', ({ id }) => st.setState((s) => ({ questions: s.questions.filter((q) => q.id !== id) })));
  on('approval-done', ({ id }) => st.setState((s) => ({ approvals: s.approvals.filter((a) => a.id !== id) })));
  on('browser-state', (browserState) => st.setState({ browserState }));
  on('browser-open', () => st.setState({ browserOpen: true }));
  on('toast', ({ text, type }) => st.getState().toast(text, type));
}
