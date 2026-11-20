import { formatBytes } from './adjuntos.js';
import { render } from './app.js';
import { page } from './armazon.js';
import { E } from './estado.js';
import { closeModal, modalInfo, toast } from './formularios.js';
import { formatDateTime } from './normalizar.js';
import { $, api, apiErrorMessage, handleApiError } from './nucleo.js';
import { badge, esc, isAdmin } from './util.js';

/* ---------- Unidades de red ----------
Carpetas compartidas (Samba / Windows) que ya existen en un servidor de
archivos de la empresa, vinculadas a la plataforma. Se ven, se descargan, se
suben y se eliminan archivos sin tener que mapear la unidad en Windows.

Nada se copia a CIGST: cada carpeta se lee del servidor de archivos en el
momento en que se abre, y lo que se sube se escribe directamente ahi. Por eso
lo que se ve aca es siempre lo mismo que se ve desde el Explorador de Windows.

Las unidades las vincula y las asigna un Administrador. */

// Lo que Windows no admite en un nombre de archivo. Se controla antes de subir
// para avisar en el momento, sin esperar a que lo rechace el servidor.
const NOMBRE_INVALIDO = /[\u0000-\u001f\u007f"\\/:*?<>|]/;

let subidas = [];           // { id, nombre, tamano, enviado, estado, xhr, error }
let siguienteSubida = 1;
let filtro = '';
let orden = { col: 'nombre', dir: 1 };
let usuariosCache = null;

/* ---------- Carga ---------- */

export async function loadDrivesVista() {
  if (!E.drivesEstado) E.drivesEstado = await api('/drives/status');
  if (!E.drivesEstado.disponible) return;
  if (E.drivesModo === 'admin' && isAdmin()) {
    const { drives } = await api('/drives/admin');
    E.drivesAdmin = drives;
    return;
  }
  if (!E.drivesCargadas) {
    const { drives } = await api('/drives');
    E.drives = drives;
    E.drivesCargadas = true;
    if (E.driveActiva && !drives.some((d) => d.id === E.driveActiva)) { E.driveActiva = null; E.drivePath = ''; E.driveEntradas = null; }
    if (!E.driveActiva && drives.length) { E.driveActiva = drives[0].id; E.drivePath = ''; E.driveEntradas = null; }
  }
  if (E.driveActiva && E.driveEntradas === null && !E.driveError) {
    try {
      const r = await api(`/drives/${E.driveActiva}/items?path=${encodeURIComponent(E.drivePath)}`);
      E.driveEntradas = r.entradas;
      E.drivePath = r.path;
      E.driveError = null;
    } catch (err) {
      if (err.status === 401) throw err;
      E.driveEntradas = [];
      E.driveError = apiErrorMessage(err);
    }
  }
}

function abrirCarpeta(ruta) {
  E.drivePath = ruta;
  E.driveEntradas = null;
  E.driveError = null;
  filtro = '';
  render();
}

function recargarCarpeta() {
  E.driveEntradas = null;
  E.driveError = null;
  render();
}

/* ---------- Vista ---------- */

const SUBTITULO = 'Las carpetas compartidas de la empresa, sin tener que mapearlas en Windows.';

export function drivesView() {
  if (!E.drivesEstado?.disponible) {
    return page('Unidades de red', SUBTITULO)
      + `<div class="panel"><div class="empty">`
      + `<p><strong>Las unidades de red todavía no están habilitadas en este servidor.</strong></p>`
      + `<p class="muted">Falta la clave de cifrado con la que se guardan las contraseñas (la misma que usa el Correo). `
      + `El instalador la genera sola: ejecutá <span class="mono">./install.sh</span> (o <span class="mono">install.bat</span> en Windows) `
      + `y elegí la opción 1. El resto de la plataforma funciona igual.</p></div></div>`;
  }
  if (E.drivesModo === 'admin' && isAdmin()) return vistaAdmin();
  return vistaUso();
}

function botonModo() {
  if (!isAdmin()) return '';
  return E.drivesModo === 'admin'
    ? `<button class="btn btn-ghost" data-drv-modo="uso">← Volver a mis unidades</button>`
    : `<button class="btn btn-ghost" data-drv-modo="admin">Administrar unidades</button>`;
}

function vistaUso() {
  if (!E.drives.length) {
    return page('Unidades de red', SUBTITULO, botonModo())
      + `<div class="panel"><div class="empty">`
      + `<p><strong>No tenés ninguna unidad de red asignada.</strong></p>`
      + (isAdmin()
        ? `<p class="muted">Vinculá una carpeta compartida desde «Administrar unidades» y asignátela a vos o a quien corresponda.</p>`
        : `<p class="muted">Las unidades las asigna un Administrador. Pedile que te asigne las carpetas que necesitás.</p>`)
      + `</div></div>`;
  }

  const unidad = E.drives.find((d) => d.id === E.driveActiva);
  const selector = E.drives.length > 1
    ? `<select class="list-select" id="drv-unidad">${E.drives.map((d) => `<option value="${esc(d.id)}"${d.id === E.driveActiva ? ' selected' : ''}>${esc(d.name)}</option>`).join('')}</select>`
    : `<span class="drv-unidad-unica">${esc(unidad?.name || '')}</span>`;

  const acciones = `<input type="file" id="drv-archivos" multiple hidden />`
    + `<button class="btn btn-ghost" data-drv-recargar title="Volver a leer la carpeta desde el servidor">⟳ Actualizar</button>`
    + `<button class="btn btn-primary" data-drv-subir${E.driveError ? ' disabled' : ''}>↑ Subir archivos</button>`;

  const aviso = E.driveError
    ? `<div class="aviso-fuerte"><strong>No se pudo abrir esta carpeta.</strong><span>${esc(E.driveError)}</span></div>`
    : '';

  return page('Unidades de red', SUBTITULO, botonModo())
    + `<div class="list-toolbar">${selector}`
    + `<span class="mono drv-ruta" title="Ruta en la red">${esc(unidad?.ruta || '')}</span>`
    + `<span class="drv-acciones">${acciones}</span></div>`
    + aviso
    + panelSubidas()
    + `<div class="panel drv-panel" id="drv-zona">`
    + `<div class="drv-barra">${migas(unidad)}`
    + `<input class="filter drv-filtro" id="drv-filtro" placeholder="Filtrar en esta carpeta…" value="${esc(filtro)}" autocomplete="off" /></div>`
    + tablaEntradas()
    + `<div class="drv-soltar">Soltá los archivos para subirlos a esta carpeta</div>`
    + `</div>`;
}

function migas(unidad) {
  const partes = E.drivePath ? E.drivePath.split('/') : [];
  let acumulado = '';
  const items = [`<button type="button" class="drv-miga" data-drv-ir="">${esc(unidad?.name || 'Unidad')}</button>`];
  partes.forEach((p, i) => {
    acumulado = acumulado ? `${acumulado}/${p}` : p;
    const ultima = i === partes.length - 1;
    items.push(`<span class="drv-miga-sep">›</span>`
      + (ultima ? `<span class="drv-miga actual">${esc(p)}</span>` : `<button type="button" class="drv-miga" data-drv-ir="${esc(acumulado)}">${esc(p)}</button>`));
  });
  return `<nav class="drv-migas" aria-label="Carpeta actual">${items.join('')}</nav>`;
}

const comparador = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

function entradasOrdenadas() {
  const f = filtro.trim().toLocaleLowerCase('es');
  const lista = (E.driveEntradas || []).filter((e) => !f || e.nombre.toLocaleLowerCase('es').includes(f));
  return lista.sort((a, b) => {
    // Las carpetas siempre arriba, como en el Explorador.
    if (a.tipo !== b.tipo) return a.tipo === 'carpeta' ? -1 : 1;
    let r = 0;
    if (orden.col === 'tamano') r = a.tamano - b.tamano;
    else if (orden.col === 'modificado') r = String(a.modificado || '').localeCompare(String(b.modificado || ''));
    if (r === 0) r = comparador.compare(a.nombre, b.nombre);
    return r * orden.dir;
  });
}

function th(col, texto) {
  const activa = orden.col === col;
  return `<th class="sortable${activa ? ' sorted' : ''}" data-drv-orden="${col}">${texto}${activa ? (orden.dir === 1 ? ' ↑' : ' ↓') : ''}</th>`;
}

function tablaEntradas() {
  if (E.driveEntradas === null) return '<div class="empty">Abriendo la carpeta…</div>';
  if (E.driveError) return '<div class="empty">No se pudo leer el contenido.</div>';
  const filas = entradasOrdenadas();
  const subir = E.drivePath
    ? `<tr class="drv-fila-carpeta" data-drv-ir="${esc(E.drivePath.split('/').slice(0, -1).join('/'))}"><td colspan="4"><span class="drv-icono">↰</span> Subir un nivel</td></tr>`
    : '';
  const cuerpo = filas.map((e) => {
    const ruta = E.drivePath ? `${E.drivePath}/${e.nombre}` : e.nombre;
    if (e.tipo === 'carpeta') {
      return `<tr class="drv-fila-carpeta" data-drv-ir="${esc(ruta)}">`
        + `<td><span class="drv-icono carpeta">▰</span> <strong>${esc(e.nombre)}</strong></td>`
        + `<td class="muted">—</td><td class="muted">${esc(fecha(e.modificado))}</td><td></td></tr>`;
    }
    return `<tr class="drv-fila-archivo">`
      + `<td><span class="drv-icono">▤</span> ${esc(e.nombre)}</td>`
      + `<td class="muted drv-num">${formatBytes(e.tamano)}</td>`
      + `<td class="muted">${esc(fecha(e.modificado))}</td>`
      + `<td class="drv-acc"><button type="button" class="btn btn-ghost drv-mini" data-drv-bajar="${esc(ruta)}">Descargar</button>`
      + `<button type="button" class="btn btn-ghost drv-mini drv-peligro" data-drv-borrar="${esc(ruta)}">Eliminar</button></td></tr>`;
  }).join('');
  const vacio = filas.length ? '' : `<tr><td colspan="4" class="empty">${filtro ? 'Nada coincide con el filtro.' : 'Esta carpeta está vacía. Podés subir archivos con el botón o arrastrándolos acá.'}</td></tr>`;
  const total = (E.driveEntradas || []).length;
  return `<div class="table-wrap"><table class="data-table drv-tabla"><thead><tr>${th('nombre', 'Nombre')}${th('tamano', 'Tamaño')}${th('modificado', 'Modificado')}<th></th></tr></thead>`
    + `<tbody>${subir}${cuerpo}${vacio}</tbody></table></div>`
    + `<div class="drv-pie muted">${total} ${total === 1 ? 'elemento' : 'elementos'}</div>`;
}

function fecha(iso) {
  return iso ? formatDateTime(iso) : '—';
}

/* ---------- Subidas en curso ---------- */

function panelSubidas() {
  if (!subidas.length) return '<div id="drv-subidas"></div>';
  return `<div id="drv-subidas" class="panel drv-subidas">${subidas.map(filaSubida).join('')}</div>`;
}

function filaSubida(s) {
  const pct = s.tamano ? Math.min(100, Math.round((s.enviado / s.tamano) * 100)) : (s.estado === 'lista' ? 100 : 0);
  const estado = s.estado === 'subiendo' ? `${pct}%`
    : s.estado === 'esperando' ? 'En espera'
      : s.estado === 'lista' ? 'Subido'
        : s.estado === 'cancelada' ? 'Cancelada' : 'Error';
  return `<div class="drv-subida ${s.estado}" id="drv-subida-${s.id}">`
    + `<div class="drv-subida-txt"><span class="attach-name">${esc(s.nombre)}</span>`
    + `<span class="attach-size">${formatBytes(s.tamano)}</span>`
    + `<span class="drv-subida-estado">${esc(estado)}</span>`
    + (s.estado === 'subiendo' || s.estado === 'esperando' ? `<button type="button" class="attach-remove" data-drv-cancelar="${s.id}" title="Cancelar">×</button>` : '')
    + `</div><div class="drv-progreso"><span style="width:${pct}%"></span></div>`
    + (s.error ? `<div class="drv-subida-error">${esc(s.error)}</div>` : '')
    + `</div>`;
}

function pintarSubida(s) {
  const el = document.getElementById(`drv-subida-${s.id}`);
  if (el) { el.outerHTML = filaSubida(s); cablearCancelar(); }
}

function pintarPanelSubidas() {
  const el = document.getElementById('drv-subidas');
  if (el) { el.outerHTML = panelSubidas(); cablearCancelar(); }
}

function cablearCancelar() {
  document.querySelectorAll('[data-drv-cancelar]').forEach((b) => b.onclick = () => {
    const s = subidas.find((x) => x.id === Number(b.dataset.drvCancelar));
    if (!s) return;
    s.estado = 'cancelada';
    s.xhr?.abort();
    pintarSubida(s);
  });
}

function hayEnCurso() {
  return subidas.some((s) => s.estado === 'subiendo' || s.estado === 'esperando');
}

// Mientras haya una subida en curso, cerrar la pestaña la cortaria a la mitad.
window.addEventListener('beforeunload', (e) => {
  if (hayEnCurso()) { e.preventDefault(); e.returnValue = ''; }
});

async function subirArchivos(lista) {
  const archivos = Array.from(lista || []);
  if (!archivos.length || !E.driveActiva) return;
  const unidadId = E.driveActiva;
  const carpeta = E.drivePath;

  // Controles previos, todos juntos, para avisar de una sola vez.
  const existentes = new Set((E.driveEntradas || []).map((e) => e.nombre.toLocaleLowerCase('es')));
  const repetidos = [];
  const invalidos = [];
  const aSubir = [];
  for (const f of archivos) {
    if (NOMBRE_INVALIDO.test(f.name) || /^~cigst-/i.test(f.name)) invalidos.push(f.name);
    else if (existentes.has(f.name.toLocaleLowerCase('es'))) repetidos.push(f.name);
    else aSubir.push(f);
  }
  if (repetidos.length || invalidos.length) avisoNoSubidos(repetidos, invalidos);
  if (!aSubir.length) return;

  // Se suben de a una: con archivos grandes, en paralelo solo se pelean el
  // ancho de banda y tardan todas mas.
  const tanda = aSubir.map((f) => ({ id: siguienteSubida++, nombre: f.name, tamano: f.size, enviado: 0, estado: 'esperando', archivo: f, xhr: null, error: null }));
  subidas = [...subidas.filter((s) => s.estado === 'subiendo' || s.estado === 'esperando'), ...tanda];
  pintarPanelSubidas();

  const repetidosEnServidor = [];
  for (const s of tanda) {
    if (s.estado === 'cancelada') continue;
    s.estado = 'subiendo';
    pintarSubida(s);
    try {
      await subirUno(unidadId, carpeta, s);
      s.estado = 'lista';
      s.enviado = s.tamano;
    } catch (err) {
      if (s.estado === 'cancelada') { pintarSubida(s); continue; }
      if (err.status === 409 && /ya existe/i.test(err.message)) repetidosEnServidor.push(s.nombre);
      s.estado = 'error';
      s.error = err.message;
    }
    pintarSubida(s);
  }
  if (repetidosEnServidor.length) avisoNoSubidos(repetidosEnServidor, []);

  const ok = tanda.filter((s) => s.estado === 'lista').length;
  if (ok) toast(ok === 1 ? 'Archivo subido.' : `${ok} archivos subidos.`);
  // Las terminadas bien se quitan del panel al rato; los errores quedan a la
  // vista hasta la proxima subida, para que se puedan leer.
  setTimeout(() => {
    subidas = subidas.filter((s) => s.estado !== 'lista' && s.estado !== 'cancelada');
    pintarPanelSubidas();
  }, 4000);
  if (E.currentView === 'drives' && E.driveActiva === unidadId && E.drivePath === carpeta) recargarCarpeta();
}

function subirUno(unidadId, carpeta, s) {
  return new Promise((resolve, reject) => {
    const p = new URLSearchParams({ path: carpeta, name: s.nombre });
    const x = new XMLHttpRequest();
    s.xhr = x;
    x.open('PUT', `/api/drives/${encodeURIComponent(unidadId)}/upload?${p}`);
    x.setRequestHeader('Content-Type', 'application/octet-stream');
    let ultimo = 0;
    x.upload.onprogress = (e) => {
      s.enviado = e.loaded;
      // Repintar en cada evento traba la pagina con archivos grandes.
      const ahora = Date.now();
      if (ahora - ultimo > 250) { ultimo = ahora; pintarSubida(s); }
    };
    x.onload = () => {
      let data = null;
      try { data = JSON.parse(x.responseText); } catch { data = null; }
      if (x.status >= 200 && x.status < 300) return resolve(data);
      const err = new Error(data?.error || `Error ${x.status}`);
      err.status = x.status;
      reject(err);
    };
    x.onerror = () => reject(new Error('Se cortó la conexión durante la subida.'));
    x.onabort = () => reject(new Error('Subida cancelada.'));
    x.send(s.archivo);
  });
}

function avisoNoSubidos(repetidos, invalidos) {
  const lista = (nombres) => `<ul class="drv-lista">${nombres.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`;
  let html = '';
  if (repetidos.length) {
    html += `<p><strong>${repetidos.length === 1 ? 'Este archivo ya existe' : 'Estos archivos ya existen'} en la carpeta con el mismo nombre:</strong></p>`
      + lista(repetidos)
      + `<p class="muted">Los archivos de una unidad de red no se sobreescriben. Para subir${repetidos.length === 1 ? 'lo' : 'los'}, `
      + `eliminá el que está en la unidad o cambiale el nombre al archivo que estás intentando subir.</p>`;
  }
  if (invalidos.length) {
    html += `<p><strong>${invalidos.length === 1 ? 'Este nombre no se puede usar' : 'Estos nombres no se pueden usar'} en una unidad de red:</strong></p>`
      + lista(invalidos)
      + `<p class="muted">Un nombre de archivo no puede tener ninguno de estos caracteres: <span class="mono">\\ / : * ? " &lt; &gt; |</span>. Cambiale el nombre y volvé a subirlo.</p>`;
  }
  html += `<div class="modal-actions"><button class="btn btn-primary" type="button" data-close>Entendido</button></div>`;
  modalInfo(repetidos.length && !invalidos.length ? 'El archivo ya existe' : 'Algunos archivos no se subieron', html);
  document.querySelector('#modal-root [data-close]')?.addEventListener('click', closeModal);
}

/* ---------- Descarga ----------
La descarga va por un iframe invisible. Un enlace comun, si el servidor
contesta con un error (sin permiso, el archivo se borro), guardaria ese error
como si fuera el archivo. En el iframe, una descarga real no dispara "load";
un error si, y ahi se lee el mensaje y se muestra. */
function descargar(ruta) {
  const url = `/api/drives/${encodeURIComponent(E.driveActiva)}/download?path=${encodeURIComponent(ruta)}`;
  const marco = document.createElement('iframe');
  marco.className = 'hidden';
  marco.onload = () => {
    let mensaje = 'No se pudo descargar el archivo.';
    try { mensaje = JSON.parse(marco.contentDocument?.body?.innerText || '').error || mensaje; } catch { /* se deja el generico */ }
    toast(mensaje);
    marco.remove();
  };
  marco.src = url;
  document.body.appendChild(marco);
  toast('Descargando…');
  // El navegador ya tomo la descarga: el marco se quita despues, sin apuro.
  setTimeout(() => marco.remove(), 5 * 60 * 1000);
}

/* ---------- Eliminar (pide la contrasena de la unidad) ---------- */

function pedirEliminar(ruta) {
  const unidad = E.drives.find((d) => d.id === E.driveActiva);
  const nombre = ruta.split('/').pop();
  $('#modal-root').innerHTML = `<div class="modal-backdrop"><form class="modal" id="drv-form-borrar" autocomplete="off">`
    + `<div class="modal-head"><h2>Eliminar archivo</h2><button class="close" type="button">×</button></div>`
    + `<div class="modal-body">`
    + `<p>Vas a eliminar <strong>${esc(nombre)}</strong> de la unidad <strong>${esc(unidad?.name || '')}</strong>.</p>`
    + `<p class="muted">Se borra del servidor de archivos para todos los que usan esta unidad, también desde Windows. No se puede deshacer desde la plataforma.</p>`
    + `<div class="field"><label for="drv-clave">Contraseña de la unidad de red</label>`
    + `<input id="drv-clave" name="password" type="password" required autocomplete="off" autofocus />`
    + `<span class="field-help">Es la contraseña del usuario <span class="mono">${esc(unidad?.authUser || '')}</span> en el servidor de archivos, no la de CIGST.</span></div>`
    + `<div class="modal-actions"><button class="btn btn-ghost" type="button" data-close>Cancelar</button>`
    + `<button class="btn btn-danger" type="submit">Eliminar</button></div>`
    + `</div></form></div>`;
  $('.close').onclick = closeModal;
  $('#modal-root [data-close]').onclick = closeModal;
  const form = $('#drv-form-borrar');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const boton = form.querySelector('button[type=submit]');
    boton.disabled = true;
    try {
      await api(`/drives/${E.driveActiva}/delete`, { method: 'POST', body: { path: ruta, password: form.elements.password.value } });
      closeModal();
      toast('Archivo eliminado.');
      recargarCarpeta();
    } catch (err) {
      if (err.status === 401) { closeModal(); handleApiError(err); return; }
      toast(apiErrorMessage(err));
      form.elements.password.value = '';
      form.elements.password.focus();
      boton.disabled = false;
    }
  };
}

/* ---------- Interaccion (uso) ---------- */

export function wireDrives() {
  document.querySelectorAll('[data-drv-modo]').forEach((b) => b.onclick = () => {
    E.drivesModo = b.dataset.drvModo;
    if (E.drivesModo === 'uso') { E.drivesCargadas = false; E.driveEntradas = null; E.driveError = null; }
    render();
  });
  if (E.drivesModo === 'admin' && isAdmin()) { wireAdmin(); return; }

  const sel = document.getElementById('drv-unidad');
  if (sel) sel.onchange = () => { E.driveActiva = sel.value; abrirCarpeta(''); };

  document.querySelectorAll('[data-drv-ir]').forEach((el) => el.onclick = () => abrirCarpeta(el.dataset.drvIr));
  document.querySelectorAll('[data-drv-recargar]').forEach((b) => b.onclick = recargarCarpeta);
  document.querySelectorAll('[data-drv-bajar]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); descargar(b.dataset.drvBajar); });
  document.querySelectorAll('[data-drv-borrar]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); pedirEliminar(b.dataset.drvBorrar); });
  document.querySelectorAll('[data-drv-orden]').forEach((h) => h.onclick = () => {
    const col = h.dataset.drvOrden;
    orden = orden.col === col ? { col, dir: -orden.dir } : { col, dir: 1 };
    render();
  });

  const entrada = document.getElementById('drv-archivos');
  document.querySelectorAll('[data-drv-subir]').forEach((b) => b.onclick = () => entrada?.click());
  if (entrada) entrada.onchange = () => { const lista = entrada.files; subirArchivos(lista); entrada.value = ''; };

  const caja = document.getElementById('drv-filtro');
  if (caja) caja.oninput = () => {
    filtro = caja.value;
    const pos = caja.selectionStart;
    render();
    const nueva = document.getElementById('drv-filtro');
    if (nueva) { nueva.focus(); nueva.setSelectionRange(pos, pos); }
  };

  // Arrastrar y soltar archivos desde el Explorador sobre la carpeta abierta.
  const zona = document.getElementById('drv-zona');
  if (zona && !E.driveError) {
    zona.ondragover = (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); zona.classList.add('soltando'); } };
    zona.ondragleave = (e) => { if (!zona.contains(e.relatedTarget)) zona.classList.remove('soltando'); };
    zona.ondrop = (e) => {
      e.preventDefault();
      zona.classList.remove('soltando');
      const items = Array.from(e.dataTransfer?.items || []);
      const hayCarpetas = items.some((it) => it.webkitGetAsEntry?.()?.isDirectory);
      const archivos = items
        .filter((it) => it.kind === 'file' && !it.webkitGetAsEntry?.()?.isDirectory)
        .map((it) => it.getAsFile())
        .filter(Boolean);
      if (hayCarpetas) toast('Las carpetas no se suben enteras: abrila y arrastrá los archivos.');
      subirArchivos(archivos);
    };
  }
  cablearCancelar();
}

/* ---------- Administracion (solo Administrador) ---------- */

function vistaAdmin() {
  const filas = E.drivesAdmin.map((d) => {
    const asignada = d.access.length
      ? d.access.map((a) => `<span class="member-sector">${a.sector ? `Sector · ${esc(a.sector.name)}` : esc(a.user?.name || '?')}</span>`).join(' ')
      : '<span class="muted">Sin asignar</span>';
    const estado = !d.credencialLegible
      ? '<span class="badge b-red">Recargar contraseña</span>'
      : d.lastError ? '<span class="badge b-red">Con error</span>' : badge(d.status);
    return `<tr>`
      + `<td><strong>${esc(d.name)}</strong><br><span class="mono">${esc(d.ruta)}</span>`
      + (d.lastError ? `<div class="drv-error-linea">${esc(d.lastError)}</div>` : '') + `</td>`
      + `<td class="mono">${esc(d.domain ? `${d.domain}\\${d.authUser}` : d.authUser)}</td>`
      + `<td><div class="drv-asignada">${asignada}</div></td>`
      + `<td>${estado}</td>`
      + `<td class="drv-acc">`
      + `<button type="button" class="btn btn-ghost drv-mini" data-drv-acceso="${esc(d.id)}">Asignar</button>`
      + `<button type="button" class="btn btn-ghost drv-mini" data-drv-probar="${esc(d.id)}">Probar</button>`
      + `<button type="button" class="btn btn-ghost drv-mini" data-drv-editar="${esc(d.id)}">Editar</button>`
      + `<button type="button" class="btn btn-ghost drv-mini" data-drv-actividad="${esc(d.id)}">Actividad</button>`
      + `<button type="button" class="btn btn-ghost drv-mini drv-peligro" data-drv-quitar="${esc(d.id)}">Desvincular</button>`
      + `</td></tr>`;
  }).join('');

  return page('Unidades de red · Administración', 'Vinculá carpetas compartidas que ya existen en un servidor de archivos y asignalas a personas o sectores.',
    `${botonModo()}<button class="btn btn-primary" data-drv-nueva>+ Vincular unidad</button>`)
    + `<p class="blk-ayuda drv-ayuda">La plataforma <strong>no crea</strong> carpetas ni recursos compartidos: solo se conecta a los que ya existen, `
    + `como lo haría Windows al mapear una unidad. Desvincular una unidad no borra nada del servidor de archivos.</p>`
    + `<div class="panel"><div class="table-wrap"><table class="data-table drv-tabla-admin"><thead><tr>`
    + `<th>Unidad</th><th>Usuario de la unidad</th><th>Asignada a</th><th>Estado</th><th></th></tr></thead>`
    + `<tbody>${filas || '<tr><td colspan="5" class="empty">Todavía no hay unidades vinculadas.</td></tr>'}</tbody></table></div></div>`;
}

function ventana(titulo, cuerpo, textoBoton, alEnviar, clase = 'btn-primary') {
  $('#modal-root').innerHTML = `<div class="modal-backdrop"><form class="modal" id="drv-form" autocomplete="off">`
    + `<div class="modal-head"><h2>${esc(titulo)}</h2><button class="close" type="button">×</button></div>`
    + `<div class="modal-body"><div class="form-grid">${cuerpo}</div>`
    + `<div class="modal-actions"><button class="btn btn-ghost" type="button" data-close>Cancelar</button>`
    + `<button class="btn ${clase}" type="submit">${esc(textoBoton)}</button></div></div></form></div>`;
  $('.close').onclick = closeModal;
  $('#modal-root [data-close]').onclick = closeModal;
  const form = $('#drv-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const boton = form.querySelector('button[type=submit]');
    const texto = boton.textContent;
    boton.disabled = true;
    boton.textContent = 'Conectando…';
    try {
      await alEnviar(new FormData(form));
    } catch (err) {
      if (err.status === 401) { closeModal(); handleApiError(err); return; }
      toast(apiErrorMessage(err));
      boton.disabled = false;
      boton.textContent = texto;
    }
  };
  return form;
}

const campo = (name, label, { value = '', type = 'text', placeholder = '', ayuda = '', span = false, required = false } = {}) =>
  `<div class="field${span ? ' form-span' : ''}"><label>${label}</label>`
  + `<input name="${name}" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}"${required ? ' required' : ''} autocomplete="${type === 'password' ? 'new-password' : 'off'}" />`
  + (ayuda ? `<span class="field-help">${ayuda}</span>` : '') + `</div>`;

function formularioUnidad(d = null) {
  return campo('name', 'Nombre para reconocerla', { value: d?.name || '', placeholder: 'Contabilidad', span: true, required: true })
    + campo('ruta', 'Ruta de la carpeta compartida', {
      value: d?.ruta || '', placeholder: '\\\\192.168.1.10\\Contabilidad', span: true, required: true,
      ayuda: 'Tal como se escribe en el Explorador de Windows. Conviene usar la <strong>dirección IP</strong> del servidor: '
        + 'los nombres tipo \\\\SERVIDOR solo funcionan si el DNS de la red los conoce. Puede apuntar a una subcarpeta '
        + '(\\\\192.168.1.10\\Compartido\\Contabilidad) y solo se verá esa parte.',
    })
    + campo('authUser', 'Usuario de la unidad', { value: d?.authUser || '', placeholder: 'juan', required: true, ayuda: 'El usuario del servidor de archivos, no el de CIGST.' })
    + campo('domain', 'Dominio o grupo de trabajo', { value: d?.domain || '', placeholder: 'Opcional', ayuda: 'Dejalo vacío si no corresponde.' })
    + campo('password', d ? 'Nueva contraseña' : 'Contraseña de la unidad', {
      type: 'password', span: true, required: !d,
      placeholder: d ? 'Dejala vacía para mantener la actual' : '',
      ayuda: d ? '' : 'Se guarda cifrada. Es también la que se va a pedir para eliminar archivos de esta unidad.',
    })
    + (d ? `<div class="field form-span"><label>Estado</label><select name="status">`
      + `<option value="Activo"${d.status === 'Activo' ? ' selected' : ''}>Activa</option>`
      + `<option value="Inactivo"${d.status !== 'Activo' ? ' selected' : ''}>Desactivada (nadie la ve, pero no se pierde la configuración)</option></select></div>` : '')
    + `<p class="blk-ayuda form-span">Antes de guardar se prueba la conexión: si la ruta, el usuario o la contraseña están mal, te avisa en el momento.</p>`;
}

function nuevaUnidad() {
  ventana('Vincular unidad de red', formularioUnidad(), 'Probar y guardar', async (f) => {
    const { drive } = await api('/drives/admin', {
      method: 'POST',
      body: { name: f.get('name'), ruta: f.get('ruta'), authUser: f.get('authUser'), domain: f.get('domain') || '', password: f.get('password') },
    });
    closeModal();
    toast('Unidad vinculada. Ahora asignala a quien la tenga que usar.');
    E.drivesAdmin = [...E.drivesAdmin, drive];
    render();
    abrirAccesos(drive.id);
  });
}

function editarUnidad(id) {
  const d = E.drivesAdmin.find((x) => x.id === id);
  if (!d) return;
  ventana(`Editar «${d.name}»`, formularioUnidad(d), 'Guardar', async (f) => {
    const body = { name: f.get('name'), status: f.get('status') };
    // Solo se manda lo que cambio de la conexion: asi no se vuelve a probar sin necesidad.
    if (f.get('ruta') !== d.ruta) body.ruta = f.get('ruta');
    if (f.get('authUser') !== d.authUser) body.authUser = f.get('authUser');
    if ((f.get('domain') || '') !== (d.domain || '')) body.domain = f.get('domain') || '';
    if (f.get('password')) body.password = f.get('password');
    const { drive } = await api(`/drives/admin/${id}`, { method: 'PATCH', body });
    closeModal();
    toast('Unidad actualizada.');
    E.drivesAdmin = E.drivesAdmin.map((x) => (x.id === id ? drive : x));
    E.drivesCargadas = false;
    render();
  });
}

async function cargarUsuarios() {
  if (usuariosCache) return usuariosCache;
  // El panel administrador entrega de a 200 como maximo: se piden todas las paginas.
  const todos = [];
  for (let pagina = 1; pagina <= 50; pagina++) {
    const r = await api(`/users?page=${pagina}&pageSize=200`);
    const lista = r.users || r.items || [];
    todos.push(...lista);
    const totalPaginas = r.totalPaginas || r.pagination?.totalPaginas || 1;
    if (pagina >= totalPaginas || !lista.length) break;
  }
  usuariosCache = todos
    .filter((u) => (u.status || 'Activo') === 'Activo')
    .map((u) => ({ id: u.id, name: u.name }))
    .sort((a, b) => comparador.compare(a.name, b.name));
  return usuariosCache;
}

async function abrirAccesos(id) {
  let usuarios;
  try { usuarios = await cargarUsuarios(); }
  catch (err) { handleApiError(err); return; }
  const d = E.drivesAdmin.find((x) => x.id === id);
  if (!d) return;
  const sectores = [...E.store.sectors].sort((a, b) => comparador.compare(a.name, b.name));

  const actuales = d.access.map((a) => `<div class="cat-item"><span>${a.sector ? `Sector · ${esc(a.sector.name)}` : `Persona · ${esc(a.user?.name || '?')}`}</span>`
    + `<button type="button" class="cat-remove" data-drv-revocar="${esc(a.id)}" title="Quitar">×</button></div>`).join('');

  const form = ventana(`Quiénes usan «${d.name}»`,
    `<div class="field form-span"><label>Asignada a</label><div class="cat-list">${actuales || '<p class="muted">Todavía a nadie.</p>'}</div>`
    + `<span class="field-help">Si se asigna a <strong>una sola persona</strong> es su unidad personal. Si se asigna a varias personas o a un sector, es compartida: `
    + `todos entran con el mismo usuario de la unidad (${esc(d.domain ? `${d.domain}\\${d.authUser}` : d.authUser)}).</span></div>`
    + `<div class="field"><label>Asignar a</label><select name="tipo" id="drv-acc-tipo"><option value="userId">Una persona</option><option value="sectorId">Un sector</option></select></div>`
    + `<div class="field" id="drv-acc-destino"></div>`,
    'Asignar', async (f) => {
      const destino = f.get('destino');
      if (!destino) throw new Error('Elegí a quién asignársela.');
      const { drive } = await api(`/drives/admin/${id}/access`, { method: 'POST', body: { [f.get('tipo')]: destino } });
      E.drivesAdmin = E.drivesAdmin.map((x) => (x.id === id ? drive : x));
      toast('Unidad asignada.');
      abrirAccesos(id);
    });

  const tipo = form.querySelector('#drv-acc-tipo');
  const caja = form.querySelector('#drv-acc-destino');
  const pintar = () => {
    const opciones = tipo.value === 'sectorId' ? sectores.map((s) => [s.id, s.name]) : usuarios.map((u) => [u.id, u.name]);
    caja.innerHTML = `<label>${tipo.value === 'sectorId' ? 'Sector' : 'Persona'}</label>`
      + `<select name="destino">${opciones.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('')}</select>`;
  };
  tipo.onchange = pintar;
  pintar();
  // Al cerrar, la tabla de atras se actualiza con los cambios.
  form.querySelectorAll('.close,[data-close]').forEach((b) => b.onclick = () => { closeModal(); render(); });

  form.querySelectorAll('[data-drv-revocar]').forEach((b) => b.onclick = async () => {
    try {
      const { drive } = await api(`/drives/admin/${id}/access/${b.dataset.drvRevocar}`, { method: 'DELETE' });
      E.drivesAdmin = E.drivesAdmin.map((x) => (x.id === id ? drive : x));
      toast('Acceso quitado.');
      abrirAccesos(id);
    } catch (err) { handleApiError(err); }
  });
}

async function verActividad(id) {
  const d = E.drivesAdmin.find((x) => x.id === id);
  let eventos;
  try { ({ events: eventos } = await api(`/drives/admin/${id}/events`)); }
  catch (err) { handleApiError(err); return; }
  const nombres = { subida: 'Subió', eliminacion: 'Eliminó', eliminacion_rechazada: 'Intentó eliminar (contraseña incorrecta)' };
  const filas = eventos.map((e) => `<tr><td class="muted">${esc(formatDateTime(e.createdAt))}</td>`
    + `<td>${esc(e.user?.name || 'Usuario eliminado')}</td>`
    + `<td>${e.action === 'eliminacion_rechazada' ? '<span class="badge b-red">' : e.action === 'eliminacion' ? '<span class="badge b-yellow">' : '<span class="badge b-green">'}${esc(nombres[e.action] || e.action)}</span></td>`
    + `<td class="mono">${esc(e.path)}${e.size !== null ? ` <span class="muted">(${formatBytes(e.size)})</span>` : ''}</td></tr>`).join('');
  modalInfo(`Actividad de «${d?.name || ''}»`,
    `<p class="muted">Lo que se subió y se eliminó desde la plataforma (los últimos 200 movimientos). Lo que se hace directamente desde Windows no aparece acá.</p>`
    + `<div class="table-wrap"><table class="data-table drv-tabla-actividad"><thead><tr><th>Cuándo</th><th>Quién</th><th>Qué</th><th>Archivo</th></tr></thead>`
    + `<tbody>${filas || '<tr><td colspan="4" class="empty">Todavía no hubo movimientos.</td></tr>'}</tbody></table></div>`);
  document.querySelector('#modal-root .modal')?.classList.add('modal-ancho');
}

function wireAdmin() {
  document.querySelectorAll('[data-drv-nueva]').forEach((b) => b.onclick = nuevaUnidad);
  document.querySelectorAll('[data-drv-editar]').forEach((b) => b.onclick = () => editarUnidad(b.dataset.drvEditar));
  document.querySelectorAll('[data-drv-acceso]').forEach((b) => b.onclick = () => abrirAccesos(b.dataset.drvAcceso));
  document.querySelectorAll('[data-drv-actividad]').forEach((b) => b.onclick = () => verActividad(b.dataset.drvActividad));
  document.querySelectorAll('[data-drv-probar]').forEach((b) => b.onclick = async () => {
    b.disabled = true;
    const texto = b.textContent;
    b.textContent = 'Probando…';
    try {
      const r = await api(`/drives/admin/${b.dataset.drvProbar}/test`, { method: 'POST' });
      toast(`Conexión correcta: ${r.elementos} ${r.elementos === 1 ? 'elemento' : 'elementos'} en la carpeta.`);
    } catch (err) {
      handleApiError(err);
    }
    // Se relee la lista: la prueba actualiza el estado de la unidad.
    try { const { drives } = await api('/drives/admin'); E.drivesAdmin = drives; } catch { /* queda la anterior */ }
    b.textContent = texto;
    render();
  });
  document.querySelectorAll('[data-drv-quitar]').forEach((b) => b.onclick = async () => {
    const d = E.drivesAdmin.find((x) => x.id === b.dataset.drvQuitar);
    if (!window.confirm(`¿Desvincular «${d?.name}» de la plataforma?\n\nLas personas asignadas dejan de verla en CIGST. `
      + 'No se borra NADA del servidor de archivos: las carpetas y los archivos siguen exactamente donde están.')) return;
    try {
      await api(`/drives/admin/${b.dataset.drvQuitar}`, { method: 'DELETE' });
      E.drivesAdmin = E.drivesAdmin.filter((x) => x.id !== b.dataset.drvQuitar);
      E.drivesCargadas = false;
      toast('Unidad desvinculada.');
      render();
    } catch (err) { handleApiError(err); }
  });
}
