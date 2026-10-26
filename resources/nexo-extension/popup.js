const $ = (id) => document.getElementById(id);
async function refresh() {
  const st = await chrome.runtime.sendMessage({ type: 'status' }).catch(() => null);
  $('s').textContent = st?.connected ? '✔ Conectado con Nexo' : '○ Nexo no está abierto (se conectará solo al abrirlo)';
}
$('r').onclick = async () => { await chrome.runtime.sendMessage({ type: 'reconnect' }); setTimeout(refresh, 800); };
refresh();
