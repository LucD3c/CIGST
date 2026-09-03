import { imagenesDelPegado, uploadFiles } from './adjuntos.js';
import { select, toast } from './formularios.js';
import { $, api } from './nucleo.js';
import { esc } from './util.js';

/* ---------- Bloques de contenido: renderizado y edicion ---------- */
// Lo comparten el Feed y las Bases de conocimiento. El contenido NUNCA es
// HTML del usuario: son datos con estructura conocida y aca se arma el
// marcado escapando cada texto con esc(). Por eso no hay forma de inyectar
// nada desde el contenido, ni escribiendolo a mano ni pegandolo desde Excel.

export const BLOQUE_ETIQUETAS = {
  titulo: 'Título',
  texto: 'Texto',
  lista: 'Lista',
  tabla: 'Tabla',
  imagen: 'Imagen',
  archivo: 'Archivo',
  aviso: 'Aviso',
  enlace: 'Enlace',
  tarjeta: 'Tarjeta de datos',
};
export const BLOQUE_ICONOS = {
  titulo: 'T', texto: '¶', lista: '•', tabla: '▦', imagen: '▣',
  archivo: '⎙', aviso: '!', enlace: '↗', tarjeta: '▤',
};

export function bloqueVacio(kind) {
  switch (kind) {
    case 'titulo': return { kind, data: { texto: '', nivel: 2 } };
    case 'texto': return { kind, data: { texto: '' } };
    case 'lista': return { kind, data: { items: [''], numerada: false } };
    case 'tabla': return { kind, data: { encabezados: ['', ''], filas: [['', ''], ['', '']] } };
    case 'imagen': return { kind, data: { attachmentId: '', pie: '', ancho: 'media' } };
    case 'archivo': return { kind, data: { attachmentId: '', descripcion: '' } };
    case 'aviso': return { kind, data: { texto: '', tono: 'info' } };
    case 'enlace': return { kind, data: { titulo: '', url: '', descripcion: '' } };
    case 'tarjeta': return { kind, data: { titulo: '', imagenAttachmentId: null, campos: [{ etiqueta: '', valor: '', oculto: false }], nota: '' } };
    default: return { kind: 'texto', data: { texto: '' } };
  }
}

/* ---------- Renderizado (solo lectura) ---------- */

export const urlAdjunto = (id) => `/api/attachments/${encodeURIComponent(id)}`;

export function renderBloque(b) {
  const d = b.data || {};
  switch (b.kind) {
    case 'titulo':
      return `<h${d.nivel === 1 ? 3 : 4} class="blk-titulo${d.nivel === 1 ? ' blk-titulo-1' : ''}">${esc(d.texto)}</h${d.nivel === 1 ? 3 : 4}>`;
    case 'texto':
      // Los saltos de linea se respetan por CSS (white-space), no metiendo <br>.
      return `<p class="blk-texto">${esc(d.texto)}</p>`;
    case 'lista': {
      const tag = d.numerada ? 'ol' : 'ul';
      return `<${tag} class="blk-lista">${(d.items || []).map((i) => `<li>${esc(i)}</li>`).join('')}</${tag}>`;
    }
    case 'tabla': {
      const enc = (d.encabezados || []).length
        ? `<thead><tr>${d.encabezados.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>`
        : '';
      const filas = (d.filas || []).map((f) => `<tr>${f.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
      return `<div class="blk-tabla-wrap"><table class="blk-tabla">${enc}<tbody>${filas}</tbody></table></div>`;
    }
    case 'imagen':
      if (!d.attachmentId) return '';
      return `<figure class="blk-imagen blk-imagen-${esc(d.ancho || 'media')}">`
        + `<img src="${urlAdjunto(d.attachmentId)}" alt="${esc(d.pie || 'Imagen')}" loading="lazy" />`
        + (d.pie ? `<figcaption>${esc(d.pie)}</figcaption>` : '')
        + `</figure>`;
    case 'archivo':
      if (!d.attachmentId) return '';
      return `<a class="attach-file blk-archivo" href="${urlAdjunto(d.attachmentId)}" target="_blank" rel="noopener">`
        + `<span class="attach-file-icon">⎙</span><span class="attach-name">${esc(d.descripcion || 'Descargar archivo')}</span></a>`;
    case 'aviso':
      return `<div class="blk-aviso blk-aviso-${esc(d.tono || 'info')}">${esc(d.texto)}</div>`;
    case 'enlace':
      // El href se valido en el servidor (solo http/https), pero se vuelve a
      // comprobar aca: nunca confiar en que el dato ya vino limpio.
      if (!/^https?:\/\//i.test(d.url || '')) return `<p class="blk-texto">${esc(d.titulo)}</p>`;
      return `<a class="blk-enlace" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">`
        + `<span class="blk-enlace-icono">↗</span><span><strong>${esc(d.titulo)}</strong>`
        + (d.descripcion ? `<span class="muted">${esc(d.descripcion)}</span>` : '') + `</span></a>`;
    case 'tarjeta': {
      const logo = d.imagenAttachmentId
        ? `<div class="blk-tarjeta-logo"><img src="${urlAdjunto(d.imagenAttachmentId)}" alt="" loading="lazy" /></div>`
        : '';
      const campos = (d.campos || []).map((c) => {
        // Los valores marcados como ocultos se muestran tapados y se revelan
        // con un clic: usuarios y claves compartidas no quedan a la vista de
        // cualquiera que pase por detras de la pantalla.
        const valor = c.oculto
          ? `<button type="button" class="blk-oculto" data-revelar="${esc(c.valor)}">Mostrar</button>`
          : `<span>${esc(c.valor)}</span>`;
        return `<div class="blk-campo"><label>${esc(c.etiqueta)}</label>${valor}</div>`;
      }).join('');
      return `<div class="blk-tarjeta">${logo}<div class="blk-tarjeta-cuerpo"><h4>${esc(d.titulo)}</h4>${campos}`
        + (d.nota ? `<p class="blk-tarjeta-nota">${esc(d.nota)}</p>` : '') + `</div></div>`;
    }
    default:
      return '';
  }
}

// Las tarjetas seguidas se agrupan en una grilla, como en la captura de
// referencia: una fila de tarjetas por obra social en vez de una debajo de otra.
export function renderBloques(bloques) {
  if (!bloques?.length) return '<p class="muted">Sin contenido todavía.</p>';
  const salida = [];
  let grupo = [];
  const cerrarGrupo = () => {
    if (!grupo.length) return;
    salida.push(`<div class="blk-grilla">${grupo.join('')}</div>`);
    grupo = [];
  };
  for (const b of bloques) {
    if (b.kind === 'tarjeta') { grupo.push(renderBloque(b)); continue; }
    cerrarGrupo();
    salida.push(renderBloque(b));
  }
  cerrarGrupo();
  return salida.join('');
}

// Botones "Mostrar" de los campos ocultos.
export function wireBloques(root = document) {
  root.querySelectorAll('[data-revelar]').forEach((btn) => {
    btn.onclick = () => {
      const span = document.createElement('span');
      span.textContent = btn.dataset.revelar;
      span.className = 'blk-revelado';
      btn.replaceWith(span);
    };
  });
}

/* ---------- Editor ---------- */
// El editor trabaja sobre un arreglo en memoria y se vuelve a dibujar entero
// en cada cambio. A la escala de un articulo (decenas de bloques) es
// instantaneo y evita toda una clase de errores de sincronizacion entre lo
// que se ve y lo que se va a guardar.

export function crearEditorBloques(contenedorId, bloquesIniciales) {
  const estado = { bloques: JSON.parse(JSON.stringify(bloquesIniciales || [])) };

  const campoTexto = (i, campo, valor, placeholder, filas) =>
    filas
      ? `<textarea class="blk-in" rows="${filas}" data-i="${i}" data-campo="${campo}" placeholder="${esc(placeholder)}">${esc(valor)}</textarea>`
      : `<input class="blk-in" data-i="${i}" data-campo="${campo}" value="${esc(valor)}" placeholder="${esc(placeholder)}" />`;

  function editorDe(b, i) {
    const d = b.data;
    switch (b.kind) {
      case 'titulo':
        return campoTexto(i, 'texto', d.texto, 'Título de la sección')
          + `<label class="blk-check"><input type="checkbox" data-i="${i}" data-campo="nivel"${d.nivel === 1 ? ' checked' : ''}/> Título grande</label>`;
      case 'texto':
        return campoTexto(i, 'texto', d.texto, 'Escribí el texto…', 4);
      case 'aviso':
        return campoTexto(i, 'texto', d.texto, 'Texto del aviso…', 3)
          + `<select class="blk-in" data-i="${i}" data-campo="tono">`
          + ['info', 'atencion', 'importante'].map((t) => `<option value="${t}"${d.tono === t ? ' selected' : ''}>${t === 'info' ? 'Informativo' : t === 'atencion' ? 'Atención' : 'Importante'}</option>`).join('')
          + `</select>`;
      case 'lista':
        return `<label class="blk-check"><input type="checkbox" data-i="${i}" data-campo="numerada"${d.numerada ? ' checked' : ''}/> Numerada</label>`
          + d.items.map((it, k) => `<div class="blk-fila-item"><input class="blk-in" data-i="${i}" data-item="${k}" value="${esc(it)}" placeholder="Elemento ${k + 1}" />`
            + `<button type="button" class="blk-mini" data-quitar-item="${i}:${k}" title="Quitar">×</button></div>`).join('')
          + `<button type="button" class="btn btn-ghost blk-mini-btn" data-agregar-item="${i}">+ Agregar elemento</button>`;
      case 'tabla': {
        const cols = d.filas[0]?.length || 0;
        const enc = `<div class="blk-tabla-edit-fila">${d.encabezados.map((h, c) => `<input class="blk-in blk-celda blk-celda-enc" data-i="${i}" data-enc="${c}" value="${esc(h)}" placeholder="Columna ${c + 1}" />`).join('')}<span class="blk-mini-espacio"></span></div>`;
        const filas = d.filas.map((f, r) => `<div class="blk-tabla-edit-fila">${f.map((c, ci) => `<input class="blk-in blk-celda" data-i="${i}" data-fila="${r}" data-col="${ci}" value="${esc(c)}" />`).join('')}`
          + `<button type="button" class="blk-mini" data-quitar-fila="${i}:${r}" title="Quitar fila">×</button></div>`).join('');
        return `<p class="blk-ayuda">Podés <strong>pegar una tabla desde Excel</strong> en cualquier celda y se completa sola.</p>`
          + `<div class="blk-tabla-edit" data-tabla="${i}">${enc}${filas}</div>`
          + `<div class="blk-acciones-tabla">`
          + `<button type="button" class="btn btn-ghost blk-mini-btn" data-agregar-fila="${i}">+ Fila</button>`
          + `<button type="button" class="btn btn-ghost blk-mini-btn" data-agregar-col="${i}">+ Columna</button>`
          + `<button type="button" class="btn btn-ghost blk-mini-btn" data-quitar-col="${i}"${cols <= 1 ? ' disabled' : ''}>− Columna</button>`
          + `</div>`;
      }
      case 'imagen':
        return (d.attachmentId
          ? `<img class="blk-preview" src="${urlAdjunto(d.attachmentId)}" alt="" />`
          : `<p class="blk-ayuda">Todavía no elegiste una imagen.</p>`)
          + `<input type="file" class="file-input" accept="image/*" data-subir-imagen="${i}" />`
          + campoTexto(i, 'pie', d.pie || '', 'Pie de imagen (opcional)')
          + `<select class="blk-in" data-i="${i}" data-campo="ancho">`
          + [['chica', 'Chica'], ['media', 'Mediana'], ['completa', 'Ancho completo']].map(([v, t]) => `<option value="${v}"${d.ancho === v ? ' selected' : ''}>${t}</option>`).join('')
          + `</select>`;
      case 'archivo':
        return (d.attachmentId ? `<p class="blk-ayuda">Archivo cargado.</p>` : `<p class="blk-ayuda">Todavía no elegiste un archivo.</p>`)
          + `<input type="file" class="file-input" data-subir-archivo="${i}" />`
          + campoTexto(i, 'descripcion', d.descripcion || '', 'Cómo se llama el archivo');
      case 'enlace':
        return campoTexto(i, 'titulo', d.titulo, 'Nombre del enlace')
          + campoTexto(i, 'url', d.url, 'https://…')
          + campoTexto(i, 'descripcion', d.descripcion || '', 'Descripción (opcional)');
      case 'tarjeta':
        return campoTexto(i, 'titulo', d.titulo, 'Nombre (por ejemplo, la obra social)')
          + (d.imagenAttachmentId ? `<img class="blk-preview blk-preview-logo" src="${urlAdjunto(d.imagenAttachmentId)}" alt="" />` : '')
          + `<input type="file" class="file-input" accept="image/*" data-subir-logo="${i}" />`
          + d.campos.map((c, k) => `<div class="blk-fila-item">`
            + `<input class="blk-in blk-in-corto" data-i="${i}" data-campo-etiqueta="${k}" value="${esc(c.etiqueta)}" placeholder="Dato" />`
            + `<input class="blk-in" data-i="${i}" data-campo-valor="${k}" value="${esc(c.valor)}" placeholder="Valor" />`
            + `<label class="blk-check blk-check-inline" title="Se muestra tapado hasta que alguien toque Mostrar"><input type="checkbox" data-i="${i}" data-campo-oculto="${k}"${c.oculto ? ' checked' : ''}/> Ocultar</label>`
            + `<button type="button" class="blk-mini" data-quitar-campo="${i}:${k}" title="Quitar">×</button></div>`).join('')
          + `<button type="button" class="btn btn-ghost blk-mini-btn" data-agregar-campo="${i}">+ Agregar dato</button>`
          + campoTexto(i, 'nota', d.nota || '', 'Nota al pie (opcional)', 2);
      default:
        return '';
    }
  }

  function pintar() {
    const cont = document.getElementById(contenedorId);
    if (!cont) return;
    const bloques = estado.bloques.map((b, i) => `<div class="blk-edit" data-bloque="${i}">`
      + `<div class="blk-edit-head"><span class="blk-edit-tipo">${BLOQUE_ICONOS[b.kind] || '•'} ${esc(BLOQUE_ETIQUETAS[b.kind] || b.kind)}</span>`
      + `<span class="blk-edit-acciones">`
      + `<button type="button" class="blk-mini" data-subir="${i}"${i === 0 ? ' disabled' : ''} title="Subir">↑</button>`
      + `<button type="button" class="blk-mini" data-bajar="${i}"${i === estado.bloques.length - 1 ? ' disabled' : ''} title="Bajar">↓</button>`
      + `<button type="button" class="blk-mini blk-mini-danger" data-eliminar="${i}" title="Eliminar bloque">×</button>`
      + `</span></div><div class="blk-edit-body">${editorDe(b, i)}</div></div>`).join('');
    const agregar = `<div class="blk-agregar"><span class="muted">Agregar:</span>`
      + Object.keys(BLOQUE_ETIQUETAS).map((k) => `<button type="button" class="btn btn-ghost blk-mini-btn" data-nuevo="${k}">${BLOQUE_ICONOS[k]} ${esc(BLOQUE_ETIQUETAS[k])}</button>`).join('')
      + `</div>`;
    cont.innerHTML = (bloques || '<p class="muted blk-vacio">Todavía no agregaste contenido. Elegí un bloque abajo para empezar.</p>') + agregar;
    conectar(cont);
  }

  function conectar(cont) {
    const b = (i) => estado.bloques[i];

    cont.querySelectorAll('[data-nuevo]').forEach((el) => el.onclick = () => {
      estado.bloques.push(bloqueVacio(el.dataset.nuevo));
      pintar();
    });
    cont.querySelectorAll('[data-eliminar]').forEach((el) => el.onclick = () => {
      estado.bloques.splice(Number(el.dataset.eliminar), 1); pintar();
    });
    cont.querySelectorAll('[data-subir]').forEach((el) => el.onclick = () => {
      const i = Number(el.dataset.subir);
      [estado.bloques[i - 1], estado.bloques[i]] = [estado.bloques[i], estado.bloques[i - 1]];
      pintar();
    });
    cont.querySelectorAll('[data-bajar]').forEach((el) => el.onclick = () => {
      const i = Number(el.dataset.bajar);
      [estado.bloques[i + 1], estado.bloques[i]] = [estado.bloques[i], estado.bloques[i + 1]];
      pintar();
    });

    // Campos simples: se escriben en el estado sin volver a pintar, para no
    // perder el foco mientras se tipea.
    cont.querySelectorAll('[data-campo]').forEach((el) => el.oninput = () => {
      const i = Number(el.dataset.i);
      const campo = el.dataset.campo;
      if (campo === 'nivel') b(i).data.nivel = el.checked ? 1 : 2;
      else if (campo === 'numerada') b(i).data.numerada = el.checked;
      else b(i).data[campo] = el.value;
    });
    cont.querySelectorAll('[data-campo]').forEach((el) => { if (el.type === 'checkbox') el.onchange = el.oninput; });

    // Lista
    cont.querySelectorAll('[data-item]').forEach((el) => el.oninput = () => {
      b(Number(el.dataset.i)).data.items[Number(el.dataset.item)] = el.value;
    });
    cont.querySelectorAll('[data-agregar-item]').forEach((el) => el.onclick = () => {
      b(Number(el.dataset.agregarItem)).data.items.push(''); pintar();
    });
    cont.querySelectorAll('[data-quitar-item]').forEach((el) => el.onclick = () => {
      const [i, k] = el.dataset.quitarItem.split(':').map(Number);
      const items = b(i).data.items;
      if (items.length > 1) items.splice(k, 1);
      pintar();
    });

    // Tabla
    cont.querySelectorAll('[data-enc]').forEach((el) => el.oninput = () => {
      b(Number(el.dataset.i)).data.encabezados[Number(el.dataset.enc)] = el.value;
    });
    cont.querySelectorAll('[data-fila]').forEach((el) => el.oninput = () => {
      b(Number(el.dataset.i)).data.filas[Number(el.dataset.fila)][Number(el.dataset.col)] = el.value;
    });
    cont.querySelectorAll('[data-agregar-fila]').forEach((el) => el.onclick = () => {
      const d = b(Number(el.dataset.agregarFila)).data;
      d.filas.push(new Array(d.filas[0]?.length || 1).fill(''));
      pintar();
    });
    cont.querySelectorAll('[data-quitar-fila]').forEach((el) => el.onclick = () => {
      const [i, r] = el.dataset.quitarFila.split(':').map(Number);
      const d = b(i).data;
      if (d.filas.length > 1) d.filas.splice(r, 1);
      pintar();
    });
    cont.querySelectorAll('[data-agregar-col]').forEach((el) => el.onclick = () => {
      const d = b(Number(el.dataset.agregarCol)).data;
      d.encabezados.push('');
      d.filas.forEach((f) => f.push(''));
      pintar();
    });
    cont.querySelectorAll('[data-quitar-col]').forEach((el) => el.onclick = () => {
      const d = b(Number(el.dataset.quitarCol)).data;
      if ((d.filas[0]?.length || 0) <= 1) return;
      d.encabezados.pop();
      d.filas.forEach((f) => f.pop());
      pintar();
    });

    // Pegar desde Excel: se lee la tabla del portapapeles y se reemplaza el
    // contenido del bloque. Del HTML que pega Excel se toman UNICAMENTE las
    // filas y las celdas: todo lo demas (estilos, scripts, imagenes) se
    // descarta, no se guarda y nunca se renderiza.
    cont.querySelectorAll('[data-tabla] input').forEach((el) => el.onpaste = (ev) => {
      const html = ev.clipboardData?.getData('text/html');
      const plano = ev.clipboardData?.getData('text/plain') || '';
      const grilla = html ? tablaDesdeHtml(html) : tablaDesdeTexto(plano);
      if (!grilla || grilla.length < 2) return; // pegado normal de una celda
      ev.preventDefault();
      const i = Number(el.closest('[data-tabla]').dataset.tabla);
      const d = b(i).data;
      d.encabezados = grilla[0];
      d.filas = grilla.slice(1);
      pintar();
      toast(`Tabla pegada: ${d.filas.length} filas y ${d.encabezados.length} columnas.`);
    });

    // Tarjeta
    cont.querySelectorAll('[data-campo-etiqueta]').forEach((el) => el.oninput = () => {
      b(Number(el.dataset.i)).data.campos[Number(el.dataset.campoEtiqueta)].etiqueta = el.value;
    });
    cont.querySelectorAll('[data-campo-valor]').forEach((el) => el.oninput = () => {
      b(Number(el.dataset.i)).data.campos[Number(el.dataset.campoValor)].valor = el.value;
    });
    cont.querySelectorAll('[data-campo-oculto]').forEach((el) => el.onchange = () => {
      b(Number(el.dataset.i)).data.campos[Number(el.dataset.campoOculto)].oculto = el.checked;
    });
    cont.querySelectorAll('[data-agregar-campo]').forEach((el) => el.onclick = () => {
      b(Number(el.dataset.agregarCampo)).data.campos.push({ etiqueta: '', valor: '', oculto: false });
      pintar();
    });
    cont.querySelectorAll('[data-quitar-campo]').forEach((el) => el.onclick = () => {
      const [i, k] = el.dataset.quitarCampo.split(':').map(Number);
      b(i).data.campos.splice(k, 1);
      pintar();
    });

    // Pegar una imagen en cualquier parte del editor crea un bloque de imagen
    // al final. Mismo gesto que en el chat, mismo resultado esperable.
    cont.onpaste = async (ev) => {
      const imagenes = imagenesDelPegado(ev);
      if (!imagenes.length) return;
      ev.preventDefault();
      if (estado.bloques.length >= 60) { toast('Ya hay demasiados bloques en este contenido.'); return; }
      try {
        const subidas = await uploadFiles(imagenes.slice(0, 5));
        for (const a of subidas) {
          estado.bloques.push({ kind: 'imagen', data: { attachmentId: a.id, pie: '', ancho: 'media' } });
        }
        pintar();
        toast(subidas.length === 1 ? 'Imagen agregada al contenido.' : `${subidas.length} imágenes agregadas.`);
      } catch (err) { toast(err.message || 'No se pudo pegar la imagen.'); }
    };

    // Subidas
    const subir = async (el, aplicar) => {
      if (!el.files?.length) return;
      el.disabled = true;
      try {
        const [subido] = await uploadFiles(el.files);
        if (subido) { aplicar(subido); pintar(); }
      } catch (err) { toast(err.message || 'No se pudo subir el archivo.'); }
      finally { el.disabled = false; el.value = ''; }
    };
    cont.querySelectorAll('[data-subir-imagen]').forEach((el) => el.onchange = () =>
      subir(el, (a) => { b(Number(el.dataset.subirImagen)).data.attachmentId = a.id; }));
    cont.querySelectorAll('[data-subir-archivo]').forEach((el) => el.onchange = () =>
      subir(el, (a) => { const d = b(Number(el.dataset.subirArchivo)).data; d.attachmentId = a.id; if (!d.descripcion) d.descripcion = a.originalName; }));
    cont.querySelectorAll('[data-subir-logo]').forEach((el) => el.onchange = () =>
      subir(el, (a) => { b(Number(el.dataset.subirLogo)).data.imagenAttachmentId = a.id; }));
  }

  pintar();

  return {
    // Devuelve los bloques listos para mandar, sacando los que quedaron vacios
    // (un bloque de texto sin texto, una imagen sin imagen) para no guardar
    // basura ni chocar con la validacion del servidor.
    valor() {
      return estado.bloques
        .map((b) => {
          const d = b.data;
          if (b.kind === 'lista') return { ...b, data: { ...d, items: d.items.map((x) => x.trim()).filter(Boolean) } };
          if (b.kind === 'tabla') {
            const filas = d.filas.filter((f) => f.some((c) => String(c).trim()));
            return { ...b, data: { ...d, filas } };
          }
          if (b.kind === 'tarjeta') {
            return { ...b, data: { ...d, campos: d.campos.filter((c) => c.etiqueta.trim()) } };
          }
          return b;
        })
        .filter((b) => {
          const d = b.data;
          switch (b.kind) {
            case 'titulo': case 'texto': case 'aviso': return Boolean(String(d.texto || '').trim());
            case 'lista': return d.items.length > 0;
            case 'tabla': return d.filas.length > 0;
            case 'imagen': case 'archivo': return Boolean(d.attachmentId);
            case 'enlace': return Boolean(d.titulo.trim() && d.url.trim());
            case 'tarjeta': return Boolean(d.titulo.trim());
            default: return false;
          }
        });
    },
    vacio() { return this.valor().length === 0; },
  };
}

// De un HTML pegado se extraen SOLO filas y celdas. Se usa DOMParser, que
// construye un documento inerte: los scripts que venga trayendo el pegado no
// se ejecutan, y de todos modos solo se lee `textContent` de cada celda.
export function tablaDesdeHtml(html) {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const tabla = doc.querySelector('table');
    if (!tabla) return null;
    const filas = [...tabla.querySelectorAll('tr')]
      .map((tr) => [...tr.querySelectorAll('th,td')].map((td) => td.textContent.replace(/\s+/g, ' ').trim()))
      .filter((f) => f.length && f.some((c) => c));
    if (!filas.length) return null;
    const cols = Math.max(...filas.map((f) => f.length));
    return filas.map((f) => [...f, ...new Array(Math.max(0, cols - f.length)).fill('')].slice(0, 12)).slice(0, 200);
  } catch { return null; }
}

// Alternativa cuando el portapapeles solo trae texto: columnas separadas por
// tabulaciones, que es como copia una planilla en texto plano.
export function tablaDesdeTexto(texto) {
  const lineas = texto.split(/\r?\n/).filter((l) => l.trim());
  if (lineas.length < 2 || !lineas[0].includes('\t')) return null;
  const filas = lineas.map((l) => l.split('\t').map((c) => c.trim()));
  const cols = Math.max(...filas.map((f) => f.length));
  return filas.map((f) => [...f, ...new Array(Math.max(0, cols - f.length)).fill('')].slice(0, 12)).slice(0, 200);
}
