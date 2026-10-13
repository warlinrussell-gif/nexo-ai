const { contextBridge, ipcRenderer, webUtils } = require('electron');

const listeners = new Map();
ipcRenderer.on('nexo:event', (_e, channel, payload) => {
  const set = listeners.get(channel);
  if (set) for (const fn of set) { try { fn(payload); } catch (err) { console.error(err); } }
});

contextBridge.exposeInMainWorld('nexo', {
  call: (method, ...args) => ipcRenderer.invoke('nexo:call', method, ...args),
  on: (channel, fn) => {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel).add(fn);
    return () => listeners.get(channel)?.delete(fn);
  },
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
  platform: process.platform
});
