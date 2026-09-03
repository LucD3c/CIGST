import { attachmentField, formatBytes, wireAttachmentField } from './adjuntos.js';
import { render } from './app.js';
import { page } from './armazon.js';
import { E } from './estado.js';
import { field, modal, modalInfo, relaxOptionalFields, select, textValue, toast } from './formularios.js';
import { formatDateTime } from './normalizar.js';
import { $, api, apiErrorMessage } from './nucleo.js';
import { badge, esc, isAdmin } from './util.js';

/* ---------- Correo ---------- */
// La plataforma se conecta a las casillas que ya tiene la empresa. NO es un
// servidor de correo: solo hace conexiones salientes al proveedor, igual que
// Outlook. El contenido de los correos no se guarda en la base: se pide al
// proveedor lo que hace falta para la pantalla y se descarta.

export let mailCarpetaActiva = 'INBOX';
export let mailTotal = 0;
export let mailPagina = 1;
export let mailPorPagina = 25;
export let mailBusqueda = '';
export let mailCargando = false;

export async function loadMailEstado() {
  if (!E.mailEstado) E.mailEstado = await api('/mail/status');
  return E.mailEstado;
}

export async function loadMailCuentas() {
  const { accounts } = await api('/mail/accounts');
  E.mailCuentas = accounts;
  if (E.mailCuentaActiva && !accounts.some((c) => c.id === E.mailCuentaActiva)) E.mailCuentaActiva = null;
  if (!E.mailCuentaActiva && accounts.length) E.mailCuentaActiva = accounts[0].id;
}

export async function loadMailCarpetas() {
  if (!E.mailCuentaActiva) { E.mailCarpetas = []; return; }
  const { folders } = await api(`/mail/accounts/${E.mailCuentaActiva}/folders`);
  E.mailCarpetas = folders;
  if (!folders.some((f) => f.path === mailCarpetaActiva)) {
    mailCarpetaActiva = folders.find((f) => f.especial === 'entrada')?.path || folders[0]?.path || 'INBOX';
  }
}

export async function loadMailMensajes() {
  if (!E.mailCuentaActiva) { E.mailMensajes = []; mailTotal = 0; return; }
  const p = new URLSearchParams({ folder: mailCarpetaActiva, page: String(mailPagina) });
  if (mailBusqueda) p.set('q', mailBusqueda);
  const r = await api(`/mail/accounts/${E.mailCuentaActiva}/messages?${p}`);
  E.mailMensajes = r.mensajes;
  mailTotal = r.total;
  mailPorPagina = r.porPagina;
}

/* ---------- Vista ---------- */

export function mailView() {
  if (!E.mailEstado?.disponible) {
    return page('Correo', 'Las casillas de la empresa, dentro de la plataforma.')
      + `<div class="panel"><div class="empty">`
      + `<p><strong>El correo todavía no está habilitado en este servidor.</strong></p>`
      + `<p class="muted">Falta la clave de cifrado con la que se guardan las contraseñas de las casillas. `
      + `El instalador la genera sola: ejecutá <span class="mono">./install.sh</span> (o <span class="mono">install.bat</span> en Windows) `
      + `y elegí la opción 1. El resto de la plataforma funciona igual.</p>`
      + `</div></div>`;
  }

  const acciones = `<button class="btn btn-ghost" data-mail-cuentas>Mis casillas</button>`
    + (isAdmin() ? `<button class="btn btn-ghost" data-mail-servidores>Servidores</button>` : '')
    + (E.mailCuentas.length ? `<button class="btn btn-primary" data-mail-redactar>+ Escribir</button>` : '');

  // Casillas cuya contrasena guardada ya no se puede descifrar. Pasa cuando se
  // restaura una copia de seguridad en una instalacion con otra clave de
  // cifrado. Sin este aviso, la persona se enteraba casilla por casilla, cada
  // vez con un error distinto y sin entender el motivo.
  const ilegibles = E.mailEstado?.casillasIlegibles || 0;
  const avisoClave = ilegibles
    ? `<div class="aviso-fuerte"><strong>${ilegibles === 1
        ? 'Una casilla necesita que vuelvas a escribir su contraseña.'
        : `${ilegibles} casillas necesitan que vuelvas a escribir su contraseña.`}</strong>`
      + ` <span>La plataforma no puede leer las contraseñas guardadas porque la clave de cifrado del servidor `
      + `cambió — algo habitual después de restaurar una copia de seguridad en una instalación nueva. `
      + `No se perdió ningún correo: los mensajes están en el servidor de correo, no acá. `
      + `Entrá a <em>Mis casillas</em> y volvé a cargar la contraseña de cada una.</span></div>`
    : '';

  if (!E.mailCuentas.length) {
    return page('Correo', 'Las casillas de la empresa, dentro de la plataforma.', acciones)
      + `<div class="panel"><div class="empty">`
      + `<p><strong>Todavía no agregaste ninguna casilla.</strong></p>`
      + `<p class="muted">Tocá «Mis casillas» y agregá tu correo. Si no aparece tu proveedor en la lista, `
      + `pedile a un Administrador que lo configure una vez desde «Servidores».</p>`
      + `</div></div>`;
  }

  const cuenta = E.mailCuentas.find((c) => c.id === E.mailCuentaActiva);
  const selector = E.mailCuentas.length > 1
    ? `<select class="list-select" id="mail-cuenta">${E.mailCuentas.map((c) =>
      `<option value="${esc(c.id)}"${c.id === E.mailCuentaActiva ? ' selected' : ''}>${esc(c.displayName)}${c.compartida ? ' · compartida' : ''}</option>`).join('')}</select>`
    : `<span class="mail-cuenta-unica">${esc(cuenta?.displayName || '')}</span>`;

  const aviso = cuenta?.lastError
    ? `<div class="blk-aviso blk-aviso-importante" style="margin:0 0 14px">${esc(cuenta.lastError)}</div>`
    : '';

  return page('Correo', 'Las casillas de la empresa, dentro de la plataforma.', acciones)
    + `<div class="list-toolbar">${selector}`
    + `<input class="filter" id="mail-buscar" placeholder="Buscar en esta carpeta…" value="${esc(mailBusqueda)}" />`
    + `<span class="list-count">${mailTotal} ${mailTotal === 1 ? 'correo' : 'correos'}</span></div>`
    + avisoClave
    + aviso
    + `<div class="mail-layout">`
    + `<aside class="panel mail-carpetas">${E.mailCarpetas.map((f) => `<button type="button" class="mail-carpeta${f.path === mailCarpetaActiva ? ' activa' : ''}" data-mail-carpeta="${esc(f.path)}">`
      + `<span>${esc(mailNombreCarpeta(f))}</span>`
      + (f.sinLeer ? `<span class="mail-badge">${f.sinLeer}</span>` : '') + `</button>`).join('')
      || '<div class="empty">Sin carpetas</div>'}</aside>`
    + `<section class="panel mail-lista">${mailListaHtml()}</section>`
    + `</div>`;
}

export const NOMBRES_CARPETA = {
  entrada: 'Recibidos', enviados: 'Enviados', borradores: 'Borradores',
  papelera: 'Papelera', spam: 'Correo no deseado', archivo: 'Archivo',
};
export const mailNombreCarpeta = (f) => NOMBRES_CARPETA[f.especial] || f.nombre;

export function mailListaHtml() {
  if (mailCargando) return '<div class="empty">Cargando…</div>';
  if (E.mailAbierto) return mailMensajeHtml(E.mailAbierto);
  if (!E.mailMensajes.length) {
    return `<div class="empty">${mailBusqueda ? 'No se encontró nada con ese texto.' : 'No hay correos en esta carpeta.'}</div>`;
  }
  const filas = E.mailMensajes.map((m) => `<button type="button" class="mail-fila${m.leido ? '' : ' sin-leer'}" data-mail-abrir="${m.uid}">`
    + `<span class="mail-de">${esc(m.deNombre || m.de)}</span>`
    + `<span class="mail-asunto">${esc(m.asunto)}${m.tieneAdjuntos ? ' <span class="mail-clip">⎙</span>' : ''}</span>`
    + `<span class="mail-fecha">${esc(mailFecha(m.fecha))}</span></button>`).join('');
  const paginas = Math.max(1, Math.ceil(mailTotal / mailPorPagina));
  const paginacion = paginas > 1
    ? `<div class="mail-paginacion">`
      + `<button class="btn btn-ghost" data-mail-pagina="${mailPagina - 1}"${mailPagina <= 1 ? ' disabled' : ''}>← Anteriores</button>`
      + `<span class="muted">Página ${mailPagina} de ${paginas}</span>`
      + `<button class="btn btn-ghost" data-mail-pagina="${mailPagina + 1}"${mailPagina >= paginas ? ' disabled' : ''}>Siguientes →</button>`
      + `</div>`
    : '';
  return `<div class="mail-filas">${filas}</div>${paginacion}`;
}

export function mailFecha(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const hoy = new Date();
  const mismoDia = d.toDateString() === hoy.toDateString();
  return mismoDia
    ? d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function mailMensajeHtml(m) {
  const adjuntos = m.adjuntos.length
    ? `<div class="mail-adjuntos">${m.adjuntos.map((a) => `<a class="attach-file" href="/api/mail/accounts/${esc(E.mailCuentaActiva)}/messages/${m.uid}/attachments/${a.indice}?folder=${encodeURIComponent(m.folder)}" target="_blank" rel="noopener">`
      + `<span class="attach-file-icon">⎙</span><span class="attach-name">${esc(a.nombre)}</span>`
      + `<span class="attach-size">${formatBytes(a.tamano)}</span></a>`).join('')}</div>`
    : '';

  const avisoImagenes = m.imagenesBloqueadas
    ? `<div class="mail-imagenes-bloqueadas">Se bloquearon ${m.imagenesBloqueadas} ${m.imagenesBloqueadas === 1 ? 'imagen remota' : 'imágenes remotas'}: `
      + `avisan a quien envió el correo que lo abriste. <button type="button" class="btn btn-ghost blk-mini-btn" data-mail-imagenes="${m.uid}">Mostrar igual</button></div>`
    : '';

  // El cuerpo HTML va dentro de un iframe con sandbox y SIN allow-scripts: es
  // el navegador el que garantiza que ahi adentro no corre nada. Un correo lo
  // escribio cualquiera, desde afuera.
  const cuerpo = m.html
    ? `<iframe class="mail-cuerpo-html" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" srcdoc="${esc(mailDocumentoHtml(m.html))}"></iframe>`
    : `<pre class="mail-cuerpo-texto">${esc(m.texto || '(sin contenido)')}</pre>`;

  return `<div class="mail-mensaje">`
    + `<div class="mail-mensaje-head">`
    + `<button class="btn btn-ghost" data-mail-volver>← Volver</button>`
    + `<div class="mail-mensaje-acciones">`
    + `<button class="btn btn-ghost" data-mail-responder="${m.uid}">Responder</button>`
    + `<button class="btn btn-ghost" data-mail-borrar="${m.uid}">Eliminar</button>`
    + `</div></div>`
    + `<h2 class="mail-asunto-grande">${esc(m.asunto)}</h2>`
    + `<div class="mail-cabecera">`
    + `<div><strong>${esc(m.de.nombre || m.de.texto)}</strong> <span class="muted">${esc(m.de.texto)}</span></div>`
    + `<div class="muted">Para: ${esc(m.para)}${m.cc ? ` · CC: ${esc(m.cc)}` : ''}</div>`
    + `<div class="muted">${esc(m.fecha ? formatDateTime(m.fecha) : '')}</div>`
    + `</div>`
    + avisoImagenes
    + cuerpo
    + adjuntos
    + `</div>`;
}

// Documento completo para el iframe, con su propia CSP restrictiva. Doble
// candado: el sandbox ya impide ejecutar, y la CSP impide traer nada de afuera.
export function mailDocumentoHtml(html) {
  return `<!doctype html><html><head><meta charset="utf-8">`
    + `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src http: https: data:; style-src 'unsafe-inline'; font-src data:;">`
    + `<style>body{font:14px system-ui,sans-serif;color:#1a1a1a;background:#fff;margin:12px;word-break:break-word}`
    + `img{max-width:100%;height:auto}table{max-width:100%}a{color:#1a5fa8}</style></head>`
    + `<body>${html}</body></html>`;
}

/* ---------- Interacción ---------- */

export function wireMail() {
  const sel = document.getElementById('mail-cuenta');
  if (sel) sel.onchange = async () => {
    E.mailCuentaActiva = sel.value;
    mailCarpetaActiva = 'INBOX'; mailPagina = 1; E.mailAbierto = null; mailBusqueda = '';
    await mailRecargar();
  };

  const buscar = document.getElementById('mail-buscar');
  if (buscar) buscar.oninput = () => {
    clearTimeout(window.__mailDebounce);
    window.__mailDebounce = setTimeout(async () => {
      mailBusqueda = buscar.value.trim();
      mailPagina = 1; E.mailAbierto = null;
      await mailRecargar({ soloMensajes: true });
    }, 450);
  };

  document.querySelectorAll('[data-mail-carpeta]').forEach((b) => b.onclick = async () => {
    mailCarpetaActiva = b.dataset.mailCarpeta;
    mailPagina = 1; E.mailAbierto = null; mailBusqueda = '';
    await mailRecargar({ soloMensajes: true });
  });

  document.querySelectorAll('[data-mail-pagina]').forEach((b) => b.onclick = async () => {
    mailPagina = Number(b.dataset.mailPagina);
    await mailRecargar({ soloMensajes: true });
  });

  document.querySelectorAll('[data-mail-abrir]').forEach((b) => b.onclick = () => mailAbrirMensaje(Number(b.dataset.mailAbrir)));
  document.querySelectorAll('[data-mail-volver]').forEach((b) => b.onclick = async () => {
    E.mailAbierto = null;
    await mailRecargar({ soloMensajes: true });
  });
  document.querySelectorAll('[data-mail-imagenes]').forEach((b) => b.onclick = () => mailAbrirMensaje(Number(b.dataset.mailImagenes), true));

  document.querySelectorAll('[data-mail-borrar]').forEach((b) => b.onclick = async () => {
    if (!window.confirm('¿Eliminar este correo? Se mueve a la papelera de la casilla.')) return;
    try {
      await api(`/mail/accounts/${E.mailCuentaActiva}/messages/${b.dataset.mailBorrar}?folder=${encodeURIComponent(mailCarpetaActiva)}`, { method: 'DELETE' });
      toast('Correo eliminado.');
      E.mailAbierto = null;
      await mailRecargar();
    } catch (err) { toast(apiErrorMessage(err)); }
  });

  document.querySelectorAll('[data-mail-responder]').forEach((b) => b.onclick = () => mailRedactar(E.mailAbierto));
  document.querySelectorAll('[data-mail-redactar]').forEach((b) => b.onclick = () => mailRedactar(null));
  document.querySelectorAll('[data-mail-cuentas]').forEach((b) => b.onclick = () => mailPanelCuentas());
  document.querySelectorAll('[data-mail-servidores]').forEach((b) => b.onclick = () => mailPanelServidores());
}

export async function mailRecargar(opciones = {}) {
  mailCargando = true;
  render();
  try {
    if (!opciones.soloMensajes) { await loadMailCuentas(); await loadMailCarpetas(); }
    await loadMailMensajes();
  } catch (err) {
    mailCargando = false;
    toast(apiErrorMessage(err));
    render();
    return;
  }
  mailCargando = false;
  render();
}

export async function mailAbrirMensaje(uid, conImagenes = false) {
  mailCargando = true; render();
  try {
    const p = new URLSearchParams({ folder: mailCarpetaActiva });
    if (conImagenes) p.set('imagenes', '1');
    const { message } = await api(`/mail/accounts/${E.mailCuentaActiva}/messages/${uid}?${p}`);
    E.mailAbierto = message;
    // Al abrirlo queda leido en el servidor: se refleja en la lista.
    const enLista = E.mailMensajes.find((m) => m.uid === uid);
    if (enLista) enLista.leido = true;
  } catch (err) { toast(apiErrorMessage(err)); }
  mailCargando = false;
  render();
}

/* ---------- Redactar ---------- */

export function mailRedactar(responderA) {
  const esRespuesta = Boolean(responderA);
  const asunto = esRespuesta
    ? (responderA.asunto.startsWith('Re:') ? responderA.asunto : `Re: ${responderA.asunto}`)
    : '';
  const cita = esRespuesta
    ? `\n\n\n--- El ${formatDateTime(responderA.fecha)}, ${responderA.de.nombre || responderA.de.texto} escribió: ---\n`
      + (responderA.texto || '').split('\n').map((l) => `> ${l}`).join('\n')
    : '';

  const campos = textValue('to', 'Para', esRespuesta ? responderA.de.texto : '', 'form-span')
    + `<div class="field"><label>CC</label><input name="cc" placeholder="Opcional" /></div>`
    + `<div class="field"><label>CCO</label><input name="bcc" placeholder="Opcional" /></div>`
    + textValue('subject', 'Asunto', asunto, 'form-span')
    + `<div class="field form-span"><label>Mensaje</label><textarea name="body" rows="12" style="min-height:220px">${esc(cita)}</textarea></div>`
    + attachmentField('mail-attach', 'Adjuntar archivos');

  modal(esRespuesta ? 'Responder' : 'Escribir correo', campos, async (f) => {
    const to = f.get('to').trim();
    if (!to) throw new Error('Falta el destinatario.');
    await api(`/mail/accounts/${E.mailCuentaActiva}/send`, {
      method: 'POST',
      body: {
        to, cc: f.get('cc') || '', bcc: f.get('bcc') || '',
        subject: f.get('subject') || '', body: f.get('body') || '',
        attachmentIds: adjuntos.ids(),
        inReplyTo: esRespuesta ? responderA.messageId || undefined : undefined,
        references: esRespuesta ? responderA.references || responderA.messageId || undefined : undefined,
      },
    });
    toast('Correo enviado.');
  });
  const adjuntos = wireAttachmentField('mail-attach');
  relaxOptionalFields();
}

/* ---------- Mis casillas ---------- */

export async function mailPanelCuentas() {
  let proveedores;
  try { ({ providers: proveedores } = await api('/mail/providers/available')); }
  catch (err) { toast(apiErrorMessage(err)); return; }

  const filas = E.mailCuentas.map((c) => `<div class="cat-item"><span>${esc(c.displayName)} `
    + `<span class="muted">${esc(c.provider.name)}${c.compartida ? ' · compartida' : ''}</span></span>`
    + (c.compartida && !isAdmin() ? '' : `<button type="button" class="cat-remove" data-quitar-casilla="${esc(c.id)}" title="Quitar">×</button>`)
    + `</div>`).join('');

  if (!proveedores.length) {
    modalInfo('Mis casillas',
      `<p class="muted">Todavía no hay ningún proveedor de correo configurado en la plataforma.</p>`
      + (isAdmin()
        ? `<p class="muted">Como Administrador, podés configurarlo desde el botón «Servidores».</p>`
        : `<p class="muted">Pedile a un Administrador que configure el proveedor una sola vez, y después vas a poder agregar tu casilla.</p>`));
    return;
  }

  const contenido = `<div class="field form-span"><label>Casillas que estás usando</label>`
    + `<div class="cat-list">${filas || '<p class="muted">Todavía no agregaste ninguna.</p>'}</div></div>`
    + `<div class="field form-span"><label>Agregar una casilla</label></div>`
    + `<div class="field"><label>Proveedor</label><select name="providerId">`
    + proveedores.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')
    + `</select></div>`
    + `<div class="field"><label>Dirección de correo</label><input name="email" placeholder="vos@empresa.local" /></div>`
    + `<div class="field"><label>Nombre para mostrar</label><input name="displayName" placeholder="Opcional" /></div>`
    + `<div class="field"><label>Usuario de acceso</label><input name="authUser" placeholder="Solo si no es la dirección completa" /></div>`
    + `<div class="field form-span"><label>Contraseña de la casilla</label>`
    + `<input name="password" type="password" autocomplete="new-password" /></div>`
    + (isAdmin()
      ? `<label class="blk-check form-span"><input type="checkbox" name="shared" /> Es una casilla compartida del sector (recepción, turnos…)</label>`
      : '')
    + `<p class="blk-ayuda form-span">Se prueba la conexión antes de guardar: si la contraseña está mal, te avisa en el momento.</p>`;

  modal('Mis casillas', contenido, async (f) => {
    const email = f.get('email').trim();
    if (!email) throw new Error('Escribí la dirección de correo.');
    if (!f.get('password')) throw new Error('Falta la contraseña de la casilla.');
    await api('/mail/accounts', {
      method: 'POST',
      body: {
        providerId: f.get('providerId'),
        email,
        displayName: f.get('displayName') || '',
        authUser: f.get('authUser') || '',
        password: f.get('password'),
        shared: f.get('shared') === 'on',
      },
    });
    await mailRecargar();
  });
  relaxOptionalFields();

  document.querySelectorAll('[data-quitar-casilla]').forEach((b) => b.onclick = async () => {
    if (!window.confirm('¿Quitar esta casilla de la plataforma? No se borra ningún correo del servidor.')) return;
    try {
      await api(`/mail/accounts/${b.dataset.quitarCasilla}`, { method: 'DELETE' });
      b.closest('.cat-item').remove();
      toast('Casilla quitada.');
      E.mailCuentaActiva = null;
      await loadMailCuentas();
    } catch (err) { toast(apiErrorMessage(err)); }
  });
}

/* ---------- Servidores (solo Administrador) ---------- */

// Al marcar la casilla de red interna se pide una confirmacion explicita: es
// la unica opcion del formulario que amplia lo que la plataforma puede alcanzar
// dentro de la red, y merece un momento de atencion.
export function wireAvisoRedInterna(){
  const casilla=document.getElementById('permitir-interna');
  if(!casilla)return;
  casilla.onchange=()=>{
    if(!casilla.checked)return;
    const sigue=window.confirm(
      'Vas a permitir que este proveedor de correo se conecte a direcciones de la red interna.\n\n'
      +'Marcá esta opción SOLO si el servidor de correo de la empresa está dentro de la red '
      +'(por ejemplo un Zimbra o Roundcube propio).\n\n'
      +'Si usás Gmail, Outlook u otro proveedor de internet, dejala SIN marcar.\n\n'
      +'¿Continuar?'
    );
    if(!sigue)casilla.checked=false;
  };
}

export async function mailPanelServidores() {
  let proveedores;
  try { ({ providers: proveedores } = await api('/mail/providers')); }
  catch (err) { toast(apiErrorMessage(err)); return; }

  const presets = E.mailEstado?.presets || [];
  // El distintivo de "red interna" se muestra siempre: es la unica opcion que
  // amplia lo que la plataforma puede alcanzar dentro de la red de la empresa,
  // y conviene que se vea de un vistazo cuales la tienen activada y no haya que
  // abrir cada uno para enterarse.
  const filas = proveedores.map((p) => `<div class="cat-item"><span>${esc(p.name)} `
    + (p.allowInternal ? `<span class="etiqueta-interna" title="Este proveedor puede conectarse a direcciones de la red interna">red interna</span> ` : '')
    + `<span class="muted mono">${esc(p.imapHost)}:${p.imapPort} · ${esc(p.smtpHost)}:${p.smtpPort}</span>`
    + (p.accountCount ? ` <span class="muted">· ${p.accountCount} ${p.accountCount === 1 ? 'casilla' : 'casillas'}</span>` : '')
    + `</span><button type="button" class="cat-remove" data-quitar-proveedor="${esc(p.id)}" title="Eliminar">×</button></div>`).join('');

  const contenido = `<div class="field form-span"><label>Proveedores configurados</label>`
    + `<div class="cat-list">${filas || '<p class="muted">Todavía no hay ninguno.</p>'}</div></div>`
    + `<div class="field form-span"><label>Agregar un proveedor</label>`
    + `<select name="preset" id="mail-preset">${presets.map((p) => `<option value="${esc(p.clave)}">${esc(p.nombre)}</option>`).join('')}</select></div>`
    + `<div class="field form-span" id="mail-preset-aviso"></div>`
    + `<div class="field form-span"><label>Nombre para reconocerlo</label><input name="name" placeholder="Correo de la empresa" /></div>`
    + `<div class="field"><label>Servidor de entrada (IMAP)</label><input name="imapHost" /></div>`
    + `<div class="field"><label>Puerto IMAP</label><input name="imapPort" value="993" /></div>`
    + `<div class="field"><label>Servidor de salida (SMTP)</label><input name="smtpHost" /></div>`
    + `<div class="field"><label>Puerto SMTP</label><input name="smtpPort" value="465" /></div>`
    + `<div class="field form-span"><label>Cifrado de salida</label><select name="smtpSecurity">`
    + `<option value="ssl">SSL/TLS (puerto 465)</option><option value="starttls">STARTTLS (puerto 587)</option>`
    + `<option value="ninguno">Sin cifrado (no recomendado)</option></select></div>`
    + `<label class="blk-check form-span"><input type="checkbox" name="allowInternal" id="permitir-interna" /> El servidor de correo está dentro de la red de la empresa</label>`
    + `<p class="blk-ayuda form-span aviso-riesgo"><strong>Dejala sin marcar salvo que sea imprescindible.</strong> `
    + `Sin marcar, la plataforma solo se conecta a servidores de correo de internet, y no puede alcanzar ninguna dirección de la red interna. `
    + `Al marcarla habilitás a <em>este proveedor</em> a conectarse también a direcciones internas: es necesario si el correo corre en un servidor propio de la empresa `
    + `(por ejemplo un Zimbra o un Roundcube instalado en la oficina), pero abre una vía que no conviene abrir "por las dudas". `
    + `Los puertos siguen limitados a los de correo en cualquier caso.</p>`;

  modal('Servidores de correo', contenido, async (f) => {
    await api('/mail/providers', {
      method: 'POST',
      body: {
        name: f.get('name'),
        imapHost: f.get('imapHost'), imapPort: Number(f.get('imapPort')), imapSecure: true,
        smtpHost: f.get('smtpHost'), smtpPort: Number(f.get('smtpPort')),
        smtpSecurity: f.get('smtpSecurity'),
        allowInternal: f.get('allowInternal') === 'on',
      },
    });
    toast('Proveedor configurado.');
  });
  relaxOptionalFields();
  wireAvisoRedInterna();

  // Al elegir un preset se completan los campos y se muestra su advertencia.
  const sel = document.getElementById('mail-preset');
  const caja = document.getElementById('mail-preset-aviso');
  const form = document.getElementById('entry-form');
  const aplicar = () => {
    const p = presets.find((x) => x.clave === sel.value);
    if (!p) return;
    // El nombre sigue al proveedor elegido, salvo que la persona haya escrito
    // uno propio: si el actual es el de algun preset, todavia no lo tocó.
    const actual = form.elements.name.value.trim();
    if (!actual || presets.some((x) => x.nombre === actual)) form.elements.name.value = p.nombre;
    form.elements.imapHost.value = p.imapHost;
    form.elements.imapPort.value = String(p.imapPort);
    form.elements.smtpHost.value = p.smtpHost;
    form.elements.smtpPort.value = String(p.smtpPort);
    form.elements.smtpSecurity.value = p.smtpSecurity;
    caja.innerHTML = p.aviso ? `<div class="blk-aviso blk-aviso-atencion">${esc(p.aviso)}</div>` : '';
  };
  sel.onchange = aplicar;
  aplicar();

  document.querySelectorAll('[data-quitar-proveedor]').forEach((b) => b.onclick = async () => {
    if (!window.confirm('¿Eliminar este proveedor?')) return;
    try {
      await api(`/mail/providers/${b.dataset.quitarProveedor}`, { method: 'DELETE' });
      b.closest('.cat-item').remove();
      toast('Proveedor eliminado.');
    } catch (err) { toast(apiErrorMessage(err)); }
  });
}
