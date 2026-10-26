const $ = (id) => document.getElementById(id);
async function refresh() {
  const { code } = await chrome.storage.local.get('code');
  if (code) $('code').value = code;
  const st = await chrome.runtime.sendMessage({ type: 'status' }).catch(() => null);
  $('s').textContent = st?.connected ? '✔ Conectado con Nexo' : '○ Sin conexión (¿está abierto Nexo?)';
}
$('save').onclick = async () => {
  await chrome.storage.local.set({ code: $('code').value.trim() });
  await chrome.runtime.sendMessage({ type: 'reconnect' });
  setTimeout(refresh, 800);
};
refresh();
