// Interfaz del agente autónomo, inyectada en la ventana (el renderer de Shadow es un bundle compilado).
// Añade "Agente" a la barra lateral y abre un panel propio con estado, ajustes, mapa de Craft Anything,
// instrucción, registro en vivo y el código generado. Todo va por window.nexo.call('ag.*').
export const AGENTE_UI = `(function () {
  if (window.__nexoAgente) return; window.__nexoAgente = true;
  if (!window.nexo || !window.nexo.call) return;
  var call = window.nexo.call, on = window.nexo.on || function () { return function () {}; };
  var panel = null, logBox = null, busy = false;

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function line(level, text) {
    if (!logBox) return;
    var l = el('div', 'mono tiny');
    l.style.padding = '2px 0';
    l.style.color = level === 'error' ? 'var(--red)' : level === 'warn' ? 'var(--amber)' : level === 'ok' ? 'var(--green)' : level === 'head' ? 'var(--accent)' : 'var(--text-2)';
    l.textContent = new Date().toLocaleTimeString('es-ES') + '  ' + text;
    logBox.appendChild(l);
    logBox.scrollTop = logBox.scrollHeight;
  }

  // ── Botón en la barra lateral ──
  function navButton() {
    if (!document.body) return;
    var nav = document.querySelector('.side-nav');
    if (!nav || nav.querySelector('[data-agente-nav]')) return;
    var mini = !!document.querySelector('.side.mini');
    var b = el('button', 'side-item');
    b.setAttribute('data-agente-nav', '1');
    if (mini) b.title = 'Agente';
    b.innerHTML = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 3 7l9 5 9-5-9-5Z"/><path d="M3 17l9 5 9-5"/><path d="M3 12l9 5 9-5"/></svg>';
    var lbl = el('span', 'side-label', 'Agente');
    b.appendChild(lbl);
    b.onclick = function () { if (panel) close(); else open(); };
    var notes = nav.querySelector('.side-item:last-child');
    if (notes) nav.insertBefore(b, notes); else nav.appendChild(b);
  }
  new MutationObserver(function () { navButton(); }).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(navButton, 1500);
  navButton();

  var ultimo = null; // { ok, path, code, error }

  function pintarResultado(card) {
    card.textContent = '';
    if (!ultimo) { card.style.display = 'none'; return; }
    card.style.display = '';
    card.style.borderColor = ultimo.ok ? 'var(--green)' : 'var(--red)';
    card.appendChild(el('div', 'section-title', ultimo.ok ? 'Código generado' : 'Error'));
    if (ultimo.ok) {
      var ruta = el('div', 'mono tiny selectable', ultimo.path);
      ruta.style.cssText = 'margin-top:6px;word-break:break-all';
      card.appendChild(ruta);
      var row = el('div', 'row'); row.style.marginTop = '8px';
      var abrir = el('button', 'btn sm primary', 'Abrir archivo');
      abrir.onclick = function () { call('ag.openFile', ultimo.path); };
      var carpeta = el('button', 'btn sm', 'Mostrar en carpeta');
      carpeta.onclick = function () { call('ag.showFile', ultimo.path); };
      row.appendChild(abrir); row.appendChild(carpeta);
      card.appendChild(row);
      var pre = el('pre', 'mono tiny');
      pre.style.cssText = 'margin-top:10px;max-height:320px;overflow:auto;background:var(--bg-2);border:1px solid var(--border);border-radius:8px;padding:10px;white-space:pre-wrap;word-break:break-word';
      pre.textContent = ultimo.code || '';
      card.appendChild(pre);
    } else {
      card.appendChild(el('div', 'small', ultimo.error || ''));
    }
  }

  function mostrarResultado(r) {
    ultimo = r;
    var card = panel && panel.querySelector('[data-resultado]');
    if (card) pintarResultado(card);
  }

  // ── Panel ──
  function close() {
    if (panel) { panel.remove(); panel = null; }
    var back = document.querySelector('[data-agente-back]');
    if (back) back.remove();
    document.removeEventListener('keydown', onKey);
    var nav = document.querySelector('.side-nav');
    if (nav) nav.removeEventListener('click', onNavClick);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }
  function onNavClick(e) {
    var b = e.target && e.target.closest ? e.target.closest('.side-item') : null;
    if (b && !b.hasAttribute('data-agente-nav')) close();
  }

  function open() {
    if (panel) { panel.remove(); panel = null; }
    // Panel lateral (drawer): la app sigue viéndose detrás, así no parece que se cerró.
    var back = el('div');
    back.setAttribute('data-agente-back', '1');
    back.style.cssText = 'position:fixed;inset:0;z-index:179;background:#00000059';
    back.onclick = close;
    document.body.appendChild(back);
    panel = el('div');
    panel.style.cssText = 'position:fixed;top:0;right:0;bottom:0;width:min(640px,100vw);z-index:180;background:var(--bg);border-left:1px solid var(--border);box-shadow:-20px 0 50px #00000066;display:flex;flex-direction:column;overflow:hidden';
    var head = el('div', 'page-header');
    head.style.cssText = 'padding:16px 18px 10px;margin:0;border-bottom:1px solid var(--border);align-items:center';
    var ttl = el('div', 'grow');
    var h1 = el('h1', null, 'Agente autónomo'); h1.style.margin = '0';
    var sub = el('p', 'small muted', 'Craft Anything + Obscura + IA sin censura: lee el mapa, escanea el objetivo, genera el código y lo guarda en el workspace.');
    sub.style.margin = '4px 0 0';
    ttl.appendChild(h1); ttl.appendChild(sub);
    var closeBtn = el('button', 'btn ghost', 'Cerrar');
    closeBtn.onclick = close;
    head.appendChild(ttl); head.appendChild(closeBtn);

    var body = el('div');
    body.style.cssText = 'flex:1;overflow-y:auto;padding:16px 18px 40px';
    var inner = el('div'); inner.style.maxWidth = '1080px'; inner.style.margin = '0 auto';
    body.appendChild(inner);

    // Estado
    var estado = el('div', 'card'); estado.setAttribute('data-estado', '1'); estado.style.padding = '12px 14px';
    var estadoTxt = el('div', 'small muted', 'Comprobando Obscura…');
    estado.appendChild(estadoTxt);
    inner.appendChild(estado);

    // Ajustes
    var cfgCard = el('div', 'card'); cfgCard.style.cssText = 'padding:14px;margin-top:12px';
    cfgCard.appendChild(el('div', 'section-title', 'Conexiones'));
    var grid = el('div'); grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px';
    function field(label, key, ph, full) {
      var w = el('div'); if (full) w.style.gridColumn = '1 / -1';
      w.appendChild(el('div', 'tiny muted', label));
      var i = el('input', 'input'); i.placeholder = ph || ''; i.setAttribute('data-cfg', key);
      i.style.marginTop = '4px';
      w.appendChild(i); grid.appendChild(w); return i;
    }
    var fObscura = field('Obscura (CDP)', 'obscuraUrl', 'http://127.0.0.1:3000');
    var fLlm = field('LLM local (opcional)', 'llmUrl', 'vacío = usa el modelo elegido en Nexo');
    var fModel = field('Modelo del LLM local', 'llmModel', 'p. ej. qwen2.5-coder-14b');
    var fChars = field('Caracteres de la captura', 'maxChars', '3000');
    var fOut = field('Archivo de salida', 'outName', 'servicio_clonado_autonomo.js', true);
    cfgCard.appendChild(grid);
    var saveRow = el('div', 'row'); saveRow.style.marginTop = '10px';
    var saveBtn = el('button', 'btn sm', 'Guardar conexiones');
    saveBtn.onclick = function () {
      call('ag.setConfig', {
        obscuraUrl: fObscura.value.trim(), llmUrl: fLlm.value.trim(), llmModel: fModel.value.trim(),
        maxChars: Number(fChars.value) || 3000, outName: fOut.value.trim()
      }).then(function () { line('ok', 'Conexiones guardadas.'); refresh(); }).catch(function (e) { line('error', e.message); });
    };
    var openCraft = el('button', 'btn sm ghost', 'Abrir craft_analysis');
    openCraft.onclick = function () { call('ag.openCraft'); };
    var openWs = el('button', 'btn sm ghost', 'Abrir workspace');
    openWs.onclick = function () { call('ag.openWorkspace'); };
    saveRow.appendChild(saveBtn); saveRow.appendChild(openCraft); saveRow.appendChild(openWs);
    cfgCard.appendChild(saveRow);
    inner.appendChild(cfgCard);

    // Mapas de Craft Anything
    var craftCard = el('div', 'card'); craftCard.style.cssText = 'padding:14px;margin-top:12px';
    craftCard.appendChild(el('div', 'section-title', 'Mapa de ingeniería inversa'));
    var craftSel = el('select', 'input'); craftSel.style.marginTop = '8px';
    craftCard.appendChild(craftSel);
    var craftInfo = el('div', 'tiny muted', 'Deja tus extracciones de Craft Anything en craft_analysis (endpoint_mapping.json).');
    craftInfo.style.marginTop = '6px';
    craftCard.appendChild(craftInfo);
    inner.appendChild(craftCard);

    // Vista previa de Obscura (dentro del panel: no se sale de la app)
    var prevCard = el('div', 'card'); prevCard.style.cssText = 'padding:14px;margin-top:12px';
    var prevHead = el('div', 'row');
    prevHead.appendChild(el('div', 'section-title grow', 'Vista previa con Obscura'));
    var prevCerrar = el('button', 'btn xs ghost', 'Cerrar sesión');
    prevCerrar.onclick = function () { call('ag.previewClose'); prevImg.removeAttribute('src'); prevUrl.textContent = ''; line('warn', 'Sesión de vista previa cerrada.'); };
    prevHead.appendChild(prevCerrar);
    prevCard.appendChild(prevHead);

    var prevBar = el('div', 'row'); prevBar.style.marginTop = '8px';
    var prevInput = el('input', 'input grow'); prevInput.placeholder = 'https://sitio-a-probar…';
    var prevGo = el('button', 'btn sm primary', 'Abrir');
    prevBar.appendChild(prevInput); prevBar.appendChild(prevGo);
    prevCard.appendChild(prevBar);

    var prevDump = el('div', 'row wrap'); prevDump.style.marginTop = '8px';
    ['text', 'markdown', 'links', 'html', 'cookies', 'assets'].forEach(function (d) {
      var b = el('button', 'btn xs', d);
      b.onclick = function () {
        var u = prevInput.value.trim(); if (!u) { line('warn', 'Escribe una URL.'); return; }
        line('step', 'fetch ' + d + ' → ' + u);
        call('ag.fetch', u, d).then(function (r) { prevOut.textContent = r.content || '(vacío)'; prevOut.style.display = ''; line('ok', d + ': ' + r.bytes + ' bytes'); })
          .catch(function (e) { line('error', e.message); });
      };
      prevDump.appendChild(b);
    });
    prevCard.appendChild(prevDump);

    var prevUrl = el('div', 'tiny muted'); prevUrl.style.marginTop = '8px';
    prevCard.appendChild(prevUrl);
    var prevImg = el('img');
    prevImg.style.cssText = 'margin-top:8px;width:100%;border:1px solid var(--border);border-radius:8px;display:block;cursor:crosshair';
    prevImg.onclick = function (ev) {
      var r = prevImg.getBoundingClientRect();
      var x = Math.round((ev.clientX - r.left) * (prevImg.naturalWidth / r.width));
      var y = Math.round((ev.clientY - r.top) * (prevImg.naturalHeight / r.height));
      call('ag.previewClick', x, y).then(function () { setTimeout(function () { shot(); }, 700); }).catch(function (e) { line('error', e.message); });
    };
    prevCard.appendChild(prevImg);

    var prevOut = el('pre', 'mono tiny');
    prevOut.style.cssText = 'margin-top:8px;max-height:260px;overflow:auto;background:var(--bg-2);border:1px solid var(--border);border-radius:8px;padding:10px;white-space:pre-wrap;word-break:break-word;display:none';
    prevCard.appendChild(prevOut);

    var prevKeys = el('div', 'row wrap'); prevKeys.style.marginTop = '8px';
    var prevTxt = el('input', 'input'); prevTxt.placeholder = 'texto a escribir en la página';
    var prevType = el('button', 'btn xs', 'Escribir');
    prevType.onclick = function () { if (!prevTxt.value) return; call('ag.previewType', prevTxt.value).then(function () { prevTxt.value = ''; setTimeout(shot, 500); }).catch(function (e) { line('error', e.message); }); };
    var prevEnter = el('button', 'btn xs', 'Enter');
    prevEnter.onclick = function () { call('ag.previewKey', 'Enter').then(function () { setTimeout(shot, 900); }).catch(function (e) { line('error', e.message); }); };
    prevKeys.appendChild(prevTxt); prevKeys.appendChild(prevType); prevKeys.appendChild(prevEnter);
    prevCard.appendChild(prevKeys);

    function shot() {
      call('ag.previewShot').then(function (b64) { if (b64) prevImg.src = 'data:image/png;base64,' + b64; }).catch(function (e) { line('error', e.message); });
    }
    prevGo.onclick = function () {
      var u = prevInput.value.trim(); if (!u) { line('warn', 'Escribe una URL.'); return; }
      line('step', 'Navegando con Obscura → ' + u);
      call('ag.preview', u).then(function (r) {
        prevUrl.textContent = (r.title ? r.title + ' · ' : '') + r.url;
        line('ok', 'Cargada: ' + r.url);
        shot();
      }).catch(function (e) { line('error', e.message); });
    };
    inner.appendChild(prevCard);

    // Orden
    var runCard = el('div', 'card'); runCard.style.cssText = 'padding:14px;margin-top:12px';
    runCard.appendChild(el('div', 'section-title', 'Orden'));
    var instr = el('textarea', 'input'); instr.rows = 4; instr.placeholder = 'Qué hay que clonar o automatizar, con detalle…';
    instr.style.cssText = 'width:100%;margin-top:8px;resize:vertical;font-family:var(--mono);font-size:12.5px';
    runCard.appendChild(instr);
    var urlIn = el('input', 'input'); urlIn.placeholder = 'URL del objetivo para Obscura (opcional)';
    urlIn.style.marginTop = '8px';
    runCard.appendChild(urlIn);
    var runRow = el('div', 'row'); runRow.style.marginTop = '10px';
    var runBtn = el('button', 'btn primary', 'Ejecutar agente');
    var stopBtn = el('button', 'btn', 'Detener'); stopBtn.disabled = true;
    runBtn.onclick = function () {
      var orden = instr.value.trim();
      if (!orden) { line('warn', 'Escribe primero la orden.'); return; }
      logBox.textContent = '';
      runBtn.disabled = true; stopBtn.disabled = false;
      line('step', 'Preparando modelo y lanzando la operación…');
      call('ag.run', { instruccion: orden, url: urlIn.value.trim(), craft: craftSel.value || 'endpoint_mapping.json', salida: fOut.value.trim() })
        .catch(function (e) { line('error', e.message); runBtn.disabled = false; stopBtn.disabled = true; });
    };
    stopBtn.onclick = function () { call('ag.stop'); };
    runRow.appendChild(runBtn); runRow.appendChild(stopBtn);
    runCard.appendChild(runRow);
    inner.appendChild(runCard);

    // Registro
    var logCard = el('div', 'card'); logCard.style.cssText = 'padding:14px;margin-top:12px';
    logCard.appendChild(el('div', 'section-title', 'Registro'));
    logBox = el('div'); logBox.style.cssText = 'margin-top:8px;max-height:260px;overflow-y:auto;background:var(--bg-2);border:1px solid var(--border);border-radius:8px;padding:8px';
    logCard.appendChild(logBox);
    inner.appendChild(logCard);

    // Resultado (persiste al cerrar y abrir el panel)
    var resCard = el('div', 'card'); resCard.setAttribute('data-resultado', '1');
    resCard.style.cssText = 'padding:14px;margin-top:12px;display:none';
    inner.appendChild(resCard);
    pintarResultado(resCard);

    panel.appendChild(head); panel.appendChild(body);
    document.body.appendChild(panel);
    document.addEventListener('keydown', onKey);
    var nav = document.querySelector('.side-nav');
    if (nav) nav.addEventListener('click', onNavClick);
    refresh();
  }

  /** Avisa si el modelo elegido no cabe en la VRAM (irá lento y puede hacer caer el servidor). */
  function avisoModelo() {
    call('settings.get').then(function (s) {
      var ref = s.defaultModel || '';
      if (ref.indexOf('local:') !== 0) return;
      var id = ref.slice(6);
      Promise.all([call('models.local'), call('hw.scan')]).then(function (r) {
        var m = (r[0] || []).find(function (x) { return x.id === id; });
        var g = (r[1] && r[1].gpus && r[1].gpus[0]) || null;
        if (!m || !g || !g.vram) return;
        var libre = g.free || 0;
        if (m.size > libre * 0.9) {
          var gb = function (n) { return (n / 1073741824).toFixed(1) + ' GB'; };
          line('warn', 'El modelo ' + m.name + ' (' + gb(m.size) + ') no cabe en la VRAM libre (' + gb(libre) + '): irá muy lento y su servidor puede caerse. Usa uno más pequeño o cierra programas que usen la GPU.');
        }
      }).catch(function () { });
    }).catch(function () { });
  }

  function refresh() {
    call('ag.estado').then(function (e) {
      if (!panel) return;
      var c = e.config || {};
      document.querySelectorAll('[data-cfg]').forEach(function (i) { i.value = c[i.getAttribute('data-cfg')] ?? ''; });
      var est = panel.querySelector('[data-estado]');
      est.textContent = '';
      var dot = el('span', 'status-dot');
      dot.style.background = e.obscura ? 'var(--green)' : 'var(--red)';
      dot.style.marginRight = '8px';
      var txt = el('span', 'small');
      txt.textContent = e.obscura ? 'Obscura responde en ' + c.obscuraUrl + ' · listo' : (e.exe ? 'Obscura instalada pero parada' : 'Obscura no instalada');
      est.appendChild(dot); est.appendChild(txt);
      if (!e.obscura && e.exe) {
        var sb = el('button', 'btn sm', 'Arrancar Obscura');
        sb.style.marginLeft = '10px';
        sb.onclick = function () { sb.disabled = true; sb.textContent = 'Arrancando…'; call('ag.startObscura').then(function () { refresh(); }).catch(function (err) { line('error', err.message); sb.disabled = false; sb.textContent = 'Arrancar Obscura'; }); };
        est.appendChild(sb);
      } else if (e.obscura) {
        var pb = el('button', 'btn sm ghost', 'Parar');
        pb.style.marginLeft = '10px';
        pb.onclick = function () { call('ag.stopObscura'); setTimeout(refresh, 1200); };
        est.appendChild(pb);
      }
      if (e.corriendo) { txt.textContent += ' · operación en marcha'; }
      avisoModelo();
      var sel = panel.querySelector('select');
      var prev = sel.value;
      sel.textContent = '';
      var files = e.craft || [];
      if (!files.length) { var o = el('option', null, '(sin mapas todavía)'); o.value = ''; sel.appendChild(o); }
      files.forEach(function (f) { var o = el('option', null, f.name + ' · ' + Math.round(f.size / 1024) + ' KB'); o.value = f.name; sel.appendChild(o); });
      if (prev && files.some(function (f) { return f.name === prev; })) sel.value = prev;
    }).catch(function () { });
  }

  on('agente-log', function (e) {
    if (!panel) { if (e.level === 'head' || e.level === 'error') open(); }
    line(e.level, e.text);
    if (e.level === 'head') { busy = true; var b = panel && panel.querySelector('.btn.primary'); if (b) b.disabled = true; }
  });
  on('agente-done', function (e) {
    busy = false;
    if (panel) { var b = panel.querySelector('.btn.primary'); if (b) b.disabled = false; }
    line(e.ok ? 'ok' : 'error', e.ok ? 'Operación finalizada. Código en ' + e.path : 'Falló: ' + e.error);
    mostrarResultado(e);
  });
})()`;
