import { render } from './app.js';
import { page } from './armazon.js';
import { crearEditorBloques, renderBloques, wireBloques } from './bloques.js';
import { E } from './estado.js';
import { field, modal, relaxOptionalFields, select, textValue, toast } from './formularios.js';
import { formatDateTime } from './normalizar.js';
import { $, api, apiErrorMessage } from './nucleo.js';
import { esc, isAdmin } from './util.js';

/* ---------- Bases de conocimiento ---------- */
// Cada area arma la suya. Adentro hay secciones y articulos; quien tiene
// permiso de lectura la consulta y quien tiene permiso de edicion la escribe.
// Los permisos los da un Administrador desde la propia base.

export let kbBusqueda = '';
export let kbResultados = null;

export async function loadKbSpaces() {
  const { spaces } = await api('/knowledge/spaces');
  E.kbSpaces = spaces;
}

export async function abrirKbSpace(id) {
  const { space } = await api(`/knowledge/spaces/${id}`);
  E.kbSpace = space;
  E.kbArticle = null;
  // Se abre el primer articulo, para no dejar el panel derecho vacio.
  const primero = space.sections.flatMap((s) => s.articles)[0];
  if (primero) await abrirKbArticle(primero.id, false);
}

export async function abrirKbArticle(id, redibujar = true) {
  const { article } = await api(`/knowledge/articles/${id}`);
  E.kbArticle = article;
  if (redibujar) render();
}

/* ---------- Listado de bases ---------- */

export function kbView() {
  if (E.kbSpace) return kbSpaceView();
  const acciones = isAdmin() ? `<button class="btn btn-primary" data-nueva-base>+ Nueva base</button>` : '';
  const tarjetas = E.kbSpaces.map((s) => `<button type="button" class="kb-tarjeta" data-abrir-base="${s.id}">`
    + `<span class="kb-icono">${esc(s.icon || '📘')}</span>`
    + `<span class="kb-tarjeta-cuerpo"><strong>${esc(s.name)}</strong>`
    + `<span class="muted">${esc(s.description || 'Sin descripción')}</span>`
    + `<span class="kb-tarjeta-meta">${s.sectionCount} ${s.sectionCount === 1 ? 'sección' : 'secciones'}`
    + `${s.myLevel === 'edicion' ? ' · podés editarla' : ''}</span></span></button>`).join('');
  return page('Bases de conocimiento', 'Los instructivos, accesos y procedimientos de cada área.', acciones)
    + `<div class="list-toolbar"><input class="filter" id="kb-buscar" placeholder="Buscar en todas las bases que podés ver…" value="${esc(kbBusqueda)}" /></div>`
    + (kbResultados
      ? `<div class="panel"><div class="panel-head"><h2>Resultados (${kbResultados.length})</h2><a data-kb-limpiar>Volver a las bases</a></div>`
        + (kbResultados.length
          ? kbResultados.map((r) => `<div class="event linkable" data-resultado="${r.spaceId}:${r.id}"><strong>${esc(r.title)}</strong>`
            + `<span>${esc(r.spaceName)} · ${esc(r.sectionName)}</span></div>`).join('')
          : '<div class="empty">No se encontró nada con ese texto.</div>')
        + `</div>`
      : `<div class="kb-grilla">${tarjetas || '<div class="panel"><div class="empty">Todavía no hay bases de conocimiento'
        + (isAdmin() ? '. Tocá «+ Nueva base» para crear la primera.' : ' a las que tengas acceso.') + '</div></div>'}</div>`);
}

/* ---------- Una base abierta: arbol + articulo ---------- */

export function kbSpaceView() {
  const puedeEditar = E.kbSpace.myLevel === 'edicion';
  const arbol = E.kbSpace.sections.map((s) => `<div class="kb-seccion">`
    + `<div class="kb-seccion-head"><span>${esc(s.name)}</span>`
    + (puedeEditar
      ? `<span class="kb-seccion-acciones">`
        + `<button class="btn-icon" data-nuevo-articulo="${s.id}" title="Nuevo artículo">+</button>`
        + `<button class="btn-icon" data-borrar-seccion="${s.id}" title="Eliminar sección">×</button></span>`
      : '')
    + `</div>`
    + `<div class="kb-articulos">${s.articles.map((a) => `<button type="button" class="kb-articulo${E.kbArticle?.id === a.id ? ' activo' : ''}" data-abrir-articulo="${a.id}">${esc(a.title)}</button>`).join('')
      || '<p class="muted kb-sin-articulos">Sin artículos</p>'}</div></div>`).join('');

  const acciones = `<button class="btn btn-ghost" data-volver-bases>← Todas las bases</button>`
    + (puedeEditar ? `<button class="btn btn-ghost" data-nueva-seccion>+ Sección</button>` : '')
    + (isAdmin() ? `<button class="btn btn-ghost" data-permisos-base>Permisos</button>` : '');

  return page(`${E.kbSpace.icon || '📘'} ${esc(E.kbSpace.name)}`, esc(E.kbSpace.description || 'Base de conocimiento'), acciones)
    + `<div class="kb-layout">`
    + `<aside class="panel kb-arbol">${arbol || '<div class="empty">Todavía no hay secciones.' + (puedeEditar ? ' Creá la primera con «+ Sección».' : '') + '</div>'}</aside>`
    + `<section class="panel kb-contenido">${kbArticleView(puedeEditar)}</section>`
    + `</div>`;
}

export function kbArticleView(puedeEditar) {
  if (!E.kbArticle) {
    return `<div class="empty">Elegí un artículo de la izquierda`
      + (puedeEditar ? ', o creá uno nuevo con el «+» de una sección.' : '.') + `</div>`;
  }
  return `<div class="kb-articulo-head"><div><h2>${esc(E.kbArticle.title)}</h2>`
    + `<p class="muted">${esc(E.kbArticle.sectionName)}`
    + (E.kbArticle.updatedBy ? ` · actualizado por ${esc(E.kbArticle.updatedBy.name)} el ${esc(formatDateTime(E.kbArticle.updatedAt))}` : '')
    + `</p></div>`
    + (puedeEditar
      ? `<div class="kb-articulo-acciones">`
        + `<button class="btn btn-ghost" data-editar-articulo="${E.kbArticle.id}">Editar</button>`
        + `<button class="btn btn-ghost" data-borrar-articulo="${E.kbArticle.id}">Eliminar</button></div>`
      : '')
    + `</div><div class="kb-articulo-cuerpo">${renderBloques(E.kbArticle.blocks)}</div>`;
}

export function wireKb() {
  const buscar = document.getElementById('kb-buscar');
  if (buscar) buscar.oninput = () => {
    clearTimeout(window.__kbDebounce);
    window.__kbDebounce = setTimeout(async () => {
      kbBusqueda = buscar.value.trim();
      if (kbBusqueda.length < 2) { kbResultados = null; render(); return; }
      try {
        const { results } = await api(`/knowledge/search?q=${encodeURIComponent(kbBusqueda)}`);
        kbResultados = results;
        render();
      } catch (err) { toast(apiErrorMessage(err)); }
    }, 350);
  };

  document.querySelectorAll('[data-kb-limpiar]').forEach((el) => el.onclick = () => {
    kbBusqueda = ''; kbResultados = null; render();
  });
  document.querySelectorAll('[data-resultado]').forEach((el) => el.onclick = async () => {
    const [spaceId, articleId] = el.dataset.resultado.split(':');
    try {
      kbResultados = null; kbBusqueda = '';
      await abrirKbSpace(spaceId);
      await abrirKbArticle(articleId, false);
      render();
    } catch (err) { toast(apiErrorMessage(err)); }
  });

  document.querySelectorAll('[data-abrir-base]').forEach((el) => el.onclick = async () => {
    try { await abrirKbSpace(el.dataset.abrirBase); render(); } catch (err) { toast(apiErrorMessage(err)); }
  });
  document.querySelectorAll('[data-volver-bases]').forEach((el) => el.onclick = async () => {
    E.kbSpace = null; E.kbArticle = null;
    try { await loadKbSpaces(); render(); } catch (err) { toast(apiErrorMessage(err)); }
  });
  document.querySelectorAll('[data-abrir-articulo]').forEach((el) => el.onclick = async () => {
    try { await abrirKbArticle(el.dataset.abrirArticulo); } catch (err) { toast(apiErrorMessage(err)); }
  });

  document.querySelectorAll('[data-nueva-base]').forEach((el) => el.onclick = () => {
    modal('Nueva base de conocimiento',
      field('name', 'Nombre del área o tema', 'text', 'form-span')
      + `<div class="field"><label>Ícono</label><input name="icon" value="📘" maxlength="4" /></div>`
      + `<div class="field"><label>Descripción</label><input name="description" placeholder="Para qué sirve" /></div>`,
      async (f) => {
        const { space } = await api('/knowledge/spaces', {
          method: 'POST',
          body: { name: f.get('name'), icon: f.get('icon') || '📘', description: f.get('description') || '' },
        });
        await loadKbSpaces();
        await abrirKbSpace(space.id);
      });
    relaxOptionalFields();
  });

  document.querySelectorAll('[data-nueva-seccion]').forEach((el) => el.onclick = () => {
    modal('Nueva sección', field('name', 'Nombre de la sección', 'text', 'form-span'), async (f) => {
      await api(`/knowledge/spaces/${E.kbSpace.id}/sections`, { method: 'POST', body: { name: f.get('name') } });
      await abrirKbSpace(E.kbSpace.id);
    });
  });

  document.querySelectorAll('[data-borrar-seccion]').forEach((el) => el.onclick = async () => {
    if (!window.confirm('¿Eliminar esta sección?')) return;
    try {
      await api(`/knowledge/sections/${el.dataset.borrarSeccion}`, { method: 'DELETE' });
      toast('Sección eliminada.');
      await abrirKbSpace(E.kbSpace.id);
      render();
    } catch (err) { toast(apiErrorMessage(err)); }
  });

  document.querySelectorAll('[data-nuevo-articulo]').forEach((el) => el.onclick = () => openArticleEditor(null, el.dataset.nuevoArticulo));
  document.querySelectorAll('[data-editar-articulo]').forEach((el) => el.onclick = () => openArticleEditor(E.kbArticle, E.kbArticle.sectionId));

  document.querySelectorAll('[data-borrar-articulo]').forEach((el) => el.onclick = async () => {
    if (!window.confirm(`¿Eliminar el artículo "${E.kbArticle.title}"?`)) return;
    try {
      await api(`/knowledge/articles/${el.dataset.borrarArticulo}`, { method: 'DELETE' });
      toast('Artículo eliminado.');
      const id = E.kbSpace.id;
      E.kbArticle = null;
      await abrirKbSpace(id);
      render();
    } catch (err) { toast(apiErrorMessage(err)); }
  });

  document.querySelectorAll('[data-permisos-base]').forEach((el) => el.onclick = () => openKbPermisos());

  wireBloques();
}

export function openArticleEditor(article, sectionId) {
  const secciones = E.kbSpace.sections;
  const campos = textValue('title', 'Título del artículo', article?.title || '', 'form-span')
    + `<div class="field form-span"><label>Sección</label><select name="sectionId">`
    + secciones.map((s) => `<option value="${esc(s.id)}"${(article?.sectionId || sectionId) === s.id ? ' selected' : ''}>${esc(s.name)}</option>`).join('')
    + `</select></div>`
    + `<div class="field form-span"><label>Contenido</label><div id="kb-bloques" class="blk-editor"></div></div>`;

  modal(article ? 'Editar artículo' : 'Nuevo artículo', campos, async (f) => {
    const bloques = editor.valor();
    const body = { title: f.get('title'), sectionId: f.get('sectionId'), blocks: bloques };
    if (article) await api(`/knowledge/articles/${article.id}`, { method: 'PATCH', body });
    else {
      const { article: creado } = await api('/knowledge/articles', { method: 'POST', body });
      E.kbArticle = creado;
    }
    const id = E.kbSpace.id;
    await abrirKbSpace(id);
    if (article) await abrirKbArticle(article.id, false);
  });

  const editor = crearEditorBloques('kb-bloques', article?.blocks || []);
}

export async function openKbPermisos() {
  let permisos;
  try { ({ permissions: permisos } = await api(`/knowledge/spaces/${E.kbSpace.id}/permissions`)); }
  catch (err) { toast(apiErrorMessage(err)); return; }

  const sectoresOrdenados = [...E.store.sectors].sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
  const usuariosOrdenados = [...E.store.users].sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));

  const filas = permisos.map((p) => {
    const quien = p.sector ? `Sector · ${esc(p.sector.name)}` : p.role ? `Rango · ${esc(p.role)}` : `Persona · ${esc(p.user?.name || '?')}`;
    return `<div class="cat-item"><span>${quien} — <strong>${esc(p.level)}</strong></span>`
      + `<button type="button" class="cat-remove" data-quitar-permiso="${p.id}" title="Quitar">×</button></div>`;
  }).join('');

  const contenido = `<div class="field form-span"><label>Quiénes tienen acceso</label>`
    + `<div class="cat-list" id="kb-permisos-lista">${filas || '<p class="muted">Todavía nadie, además del Administrador y de quien la creó.</p>'}</div></div>`
    + `<div class="field"><label>Dar acceso a</label><select name="tipo" id="kb-perm-tipo">`
    + `<option value="sectorId">Un sector</option><option value="role">Un rango</option><option value="userId">Una persona</option></select></div>`
    + `<div class="field"><label>Nivel</label><select name="level"><option value="lectura">Solo lectura</option><option value="edicion">Lectura y edición</option></select></div>`
    + `<div class="field form-span" id="kb-perm-destino"></div>`;

  modal(`Permisos de «${E.kbSpace.name}»`, contenido, async (f) => {
    const tipo = f.get('tipo');
    const destino = f.get('destino');
    if (!destino) throw new Error('Elegí a quién le vas a dar acceso.');
    await api(`/knowledge/spaces/${E.kbSpace.id}/permissions`, {
      method: 'POST',
      body: { level: f.get('level'), [tipo]: destino },
    });
    await abrirKbSpace(E.kbSpace.id);
  });

  const tipoSel = document.getElementById('kb-perm-tipo');
  const destinoCaja = document.getElementById('kb-perm-destino');
  const pintarDestino = () => {
    const opciones = tipoSel.value === 'sectorId'
      ? sectoresOrdenados.map((s) => [s.id, s.name])
      : tipoSel.value === 'role'
        ? [['Administrador', 'Administrador'], ['Supervisor', 'Supervisor'], ['User', 'User']]
        : usuariosOrdenados.map((u) => [u.id, u.name]);
    destinoCaja.innerHTML = `<label>${tipoSel.value === 'sectorId' ? 'Sector' : tipoSel.value === 'role' ? 'Rango' : 'Persona'}</label>`
      + `<select name="destino">${opciones.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('')}</select>`;
  };
  tipoSel.onchange = pintarDestino;
  pintarDestino();

  document.querySelectorAll('[data-quitar-permiso]').forEach((b) => b.onclick = async () => {
    try {
      await api(`/knowledge/spaces/${E.kbSpace.id}/permissions/${b.dataset.quitarPermiso}`, { method: 'DELETE' });
      b.closest('.cat-item').remove();
      toast('Permiso quitado.');
    } catch (err) { toast(apiErrorMessage(err)); }
  });
}
