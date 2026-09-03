import { render } from './app.js';
import { nav, page } from './armazon.js';
import { crearEditorBloques, renderBloques, wireBloques } from './bloques.js';
import { E } from './estado.js';
import { field, modal, modalInfo, select, textValue, toast } from './formularios.js';
import { formatDateTime } from './normalizar.js';
import { $, api, apiErrorMessage } from './nucleo.js';
import { badge, esc, isAdmin, isStaff } from './util.js';

/* ---------- Feed de novedades ---------- */
// Tablero de la empresa: novedades, avisos y grillas de puestos. Lo escriben
// Administradores y Supervisores; lo lee todo el personal segun a quien este
// dirigida cada publicacion.

export let feedHasMore = false;
export let feedFiltro = '';
export let feedUnseen = 0;
export const feedComentarios = new Map(); // postId -> comentarios ya cargados
export const feedAbiertos = new Set();    // publicaciones con los comentarios a la vista

export const puedePublicar = () => isStaff();

export async function loadFeed(reset = true) {
  const params = new URLSearchParams();
  if (feedFiltro) params.set('q', feedFiltro);
  if (!reset && E.feedPosts.length) params.set('before', E.feedPosts[E.feedPosts.length - 1].id);
  const { posts, hasMore } = await api(`/feed${params.toString() ? `?${params}` : ''}`);
  E.feedPosts = reset ? posts : [...E.feedPosts, ...posts];
  feedHasMore = hasMore;
}

export function feedView() {
  const acciones = puedePublicar()
    ? `<button class="btn btn-primary" data-nueva-publicacion>+ Nueva publicación</button>`
    : '';
  return page('Novedades', 'Lo que pasa en la empresa: avisos, novedades y horarios.', acciones)
    + `<div class="list-toolbar"><input class="filter" id="feed-filtro" placeholder="Buscar en las novedades…" value="${esc(feedFiltro)}" /></div>`
    + `<div id="feed-lista">${E.feedPosts.map(feedCard).join('') || '<div class="panel"><div class="empty">Todavía no hay publicaciones.' + (puedePublicar() ? ' Tocá «+ Nueva publicación» para escribir la primera.' : '') + '</div></div>'}</div>`
    + (feedHasMore ? `<div style="text-align:center;margin-top:16px"><button class="btn btn-ghost" id="feed-mas">Ver más</button></div>` : '');
}

export function feedCard(p) {
  const destinatarios = p.audience === 'todos'
    ? 'Para todos'
    : `Para ${p.sectors.map((s) => esc(s.name)).join(', ') || 'nadie'}`;
  const puedeEditar = isAdmin() || (isStaff() && p.author?.id === E.currentUser.id);
  return `<article class="panel feed-card${p.pinned ? ' feed-pinned' : ''}" data-post="${p.id}">`
    + `<header class="feed-head">`
    + `<div class="feed-autor"><span class="feed-avatar">${esc((p.author?.name || '?').slice(0, 1))}</span>`
    + `<div><strong>${esc(p.author?.name || 'Sistema')}</strong>`
    + `<span class="feed-meta">${esc(destinatarios)} · ${esc(formatDateTime(p.createdAt))}</span></div></div>`
    + `<div class="feed-head-acciones">`
    + (p.pinned ? '<span class="feed-pin-tag">Fijada</span>' : '')
    + (puedeEditar
      ? `<button class="btn-icon" data-fijar="${p.id}" title="${p.pinned ? 'Dejar de fijar' : 'Fijar arriba'}">${p.pinned ? '★' : '☆'}</button>`
        + `<button class="btn-icon" data-editar-post="${p.id}" title="Editar">✎</button>`
        + `<button class="btn-icon" data-borrar-post="${p.id}" title="Eliminar">×</button>`
      : '')
    + `</div></header>`
    + `<h2 class="feed-titulo">${esc(p.title)}</h2>`
    + `<div class="feed-cuerpo">${renderBloques(p.blocks)}</div>`
    + `<footer class="feed-pie">`
    + `<button class="feed-accion${p.reacted ? ' activa' : ''}" data-reaccion="${p.id}">👍 Me gusta${p.reactionCount ? ` · ${p.reactionCount}` : ''}</button>`
    + `<button class="feed-accion" data-comentarios="${p.id}">💬 Comentar${p.commentCount ? ` · ${p.commentCount}` : ''}</button>`
    + `<span class="feed-vistas" data-vistas="${p.id}" title="Quiénes la vieron">👁 ${p.viewCount}</span>`
    + `</footer>`
    + `<div class="feed-comentarios" id="feed-com-${p.id}">${feedAbiertos.has(p.id) ? feedComentariosHtml(p.id) : ''}</div>`
    + `</article>`;
}

export function feedComentariosHtml(postId) {
  const lista = feedComentarios.get(postId) || [];
  return `<div class="feed-com-lista">${lista.map((c) => `<div class="feed-com" data-comentario="${c.id}">`
    + `<span class="feed-avatar chico">${esc((c.author?.name || '?').slice(0, 1))}</span>`
    + `<div class="feed-com-cuerpo"><strong>${esc(c.author?.name || 'Alguien')}</strong>`
    + `<span class="feed-com-fecha">${esc(formatDateTime(c.createdAt))}</span>`
    + `<p>${esc(c.body)}</p></div>`
    + ((c.mine || isAdmin()) ? `<button class="btn-icon" data-borrar-comentario="${postId}:${c.id}" title="Borrar">×</button>` : '')
    + `</div>`).join('') || '<p class="muted feed-com-vacio">Todavía nadie comentó.</p>'}</div>`
    + `<form class="feed-com-form" data-com-form="${postId}">`
    + `<input class="blk-in" name="body" placeholder="Escribí un comentario…" maxlength="1500" autocomplete="off" />`
    + `<button class="btn btn-primary" type="submit">Enviar</button></form>`;
}

export function wireFeed() {
  const filtro = document.getElementById('feed-filtro');
  if (filtro) {
    filtro.oninput = () => {
      clearTimeout(window.__feedDebounce);
      window.__feedDebounce = setTimeout(async () => {
        feedFiltro = filtro.value.trim();
        try { await loadFeed(true); render(); } catch (err) { toast(apiErrorMessage(err)); }
      }, 300);
    };
  }
  const mas = document.getElementById('feed-mas');
  if (mas) mas.onclick = async () => {
    try { await loadFeed(false); render(); } catch (err) { toast(apiErrorMessage(err)); }
  };

  document.querySelectorAll('[data-nueva-publicacion]').forEach((b) => b.onclick = () => openPostEditor(null));
  document.querySelectorAll('[data-editar-post]').forEach((b) => b.onclick = () => openPostEditor(b.dataset.editarPost));

  document.querySelectorAll('[data-borrar-post]').forEach((b) => b.onclick = async () => {
    if (!window.confirm('¿Eliminar esta publicación? Se van también sus comentarios.')) return;
    try {
      await api(`/feed/${b.dataset.borrarPost}`, { method: 'DELETE' });
      E.feedPosts = E.feedPosts.filter((p) => p.id !== b.dataset.borrarPost);
      toast('Publicación eliminada.');
      render();
    } catch (err) { toast(apiErrorMessage(err)); }
  });

  document.querySelectorAll('[data-fijar]').forEach((b) => b.onclick = async () => {
    const post = E.feedPosts.find((p) => p.id === b.dataset.fijar);
    if (!post) return;
    try {
      await api(`/feed/${post.id}`, { method: 'PATCH', body: { pinned: !post.pinned } });
      await loadFeed(true);
      render();
    } catch (err) { toast(apiErrorMessage(err)); }
  });

  document.querySelectorAll('[data-reaccion]').forEach((b) => b.onclick = async () => {
    const id = b.dataset.reaccion;
    try {
      const { reacted, count } = await api(`/feed/${id}/reaction`, { method: 'POST' });
      const post = E.feedPosts.find((p) => p.id === id);
      if (post) { post.reacted = reacted; post.reactionCount = count; }
      render();
    } catch (err) { toast(apiErrorMessage(err)); }
  });

  document.querySelectorAll('[data-comentarios]').forEach((b) => b.onclick = async () => {
    const id = b.dataset.comentarios;
    if (feedAbiertos.has(id)) { feedAbiertos.delete(id); render(); return; }
    try {
      const { comments } = await api(`/feed/${id}/comments`);
      feedComentarios.set(id, comments);
      feedAbiertos.add(id);
      render();
    } catch (err) { toast(apiErrorMessage(err)); }
  });

  document.querySelectorAll('[data-com-form]').forEach((form) => form.onsubmit = async (e) => {
    e.preventDefault();
    const id = form.dataset.comForm;
    const input = form.querySelector('input[name=body]');
    const body = input.value.trim();
    if (!body) return;
    input.disabled = true;
    try {
      const { comment } = await api(`/feed/${id}/comments`, { method: 'POST', body: { body } });
      feedComentarios.set(id, [...(feedComentarios.get(id) || []), comment]);
      const post = E.feedPosts.find((p) => p.id === id);
      if (post) post.commentCount += 1;
      input.value = '';
      render();
    } catch (err) { toast(apiErrorMessage(err)); }
    finally { input.disabled = false; }
  });

  document.querySelectorAll('[data-borrar-comentario]').forEach((b) => b.onclick = async () => {
    const [postId, commentId] = b.dataset.borrarComentario.split(':');
    try {
      await api(`/feed/${postId}/comments/${commentId}`, { method: 'DELETE' });
      feedComentarios.set(postId, (feedComentarios.get(postId) || []).filter((c) => c.id !== commentId));
      const post = E.feedPosts.find((p) => p.id === postId);
      if (post) post.commentCount = Math.max(0, post.commentCount - 1);
      render();
    } catch (err) { toast(apiErrorMessage(err)); }
  });

  document.querySelectorAll('[data-vistas]').forEach((el) => el.onclick = async () => {
    try {
      const { viewers } = await api(`/feed/${el.dataset.vistas}/viewers`);
      modalInfo('Quiénes vieron esta publicación',
        viewers.length
          ? `<div class="visto-lista">${viewers.map((v) => `<div class="visto-item"><strong>${esc(v.name)}</strong><span class="muted">${esc(formatDateTime(v.viewedAt))}</span></div>`).join('')}</div>`
          : '<p class="muted">Todavía no la vio nadie.</p>');
    } catch (err) { toast(apiErrorMessage(err)); }
  });

  wireBloques();
  marcarPublicacionesVistas();
}

// Marca como vistas las publicaciones que quedaron en pantalla. Se hace una
// sola vez por publicacion: el servidor no vuelve a contar la misma persona.
export function marcarPublicacionesVistas() {
  const pendientes = E.feedPosts.filter((p) => !p.seen);
  if (!pendientes.length) return;
  pendientes.forEach((p) => { p.seen = true; });
  Promise.all(pendientes.map((p) => api(`/feed/${p.id}/view`, { method: 'POST' }).catch(() => {})))
    .then(() => refreshFeedBadge());
}

/* ---------- Alta y edicion de publicaciones ---------- */

export function openPostEditor(postId) {
  const post = postId ? E.feedPosts.find((p) => p.id === postId) : null;
  const sectoresOrdenados = [...E.store.sectors].sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
  const elegidos = new Set((post?.sectors || []).map((s) => s.id));

  const campos = textValue('title', 'Título', post?.title || '', 'form-span')
    + `<div class="field form-span"><label>¿Para quién es?</label>`
    + `<select name="audience" id="post-audiencia">`
    + `<option value="todos"${!post || post.audience === 'todos' ? ' selected' : ''}>Toda la empresa</option>`
    + `<option value="sectores"${post?.audience === 'sectores' ? ' selected' : ''}>Solo algunos sectores</option>`
    + `</select></div>`
    + `<div class="field form-span${post?.audience === 'sectores' ? '' : ' hidden'}" id="post-sectores">`
    + `<label>Sectores que la reciben</label><div class="member-list">`
    + sectoresOrdenados.map((s) => `<label class="member-item"><input type="checkbox" name="sectorIds" value="${esc(s.id)}"${elegidos.has(s.id) ? ' checked' : ''}/>`
      + `<span class="member-name">${esc(s.name)}</span></label>`).join('')
    + `</div></div>`
    + `<div class="field form-span"><label>Contenido</label><div id="post-bloques" class="blk-editor"></div></div>`;

  modal(post ? 'Editar publicación' : 'Nueva publicación', campos, async (f) => {
    const bloques = editor.valor();
    if (!bloques.length) throw new Error('Agregá al menos un bloque de contenido.');
    const audience = f.get('audience');
    const sectorIds = f.getAll('sectorIds');
    if (audience === 'sectores' && !sectorIds.length) throw new Error('Elegí al menos un sector, o publicá para todos.');
    const body = { title: f.get('title'), audience, sectorIds, blocks: bloques };
    if (post) await api(`/feed/${post.id}`, { method: 'PATCH', body });
    else await api('/feed', { method: 'POST', body: { ...body, pinned: false } });
    await loadFeed(true);
  });

  const editor = crearEditorBloques('post-bloques', post?.blocks || [{ kind: 'texto', data: { texto: '' } }]);
  const sel = document.getElementById('post-audiencia');
  const caja = document.getElementById('post-sectores');
  if (sel && caja) sel.onchange = () => caja.classList.toggle('hidden', sel.value !== 'sectores');
}

/* ---------- Badge de novedades sin ver ---------- */

export async function refreshFeedBadge() {
  try {
    const { count } = await api('/feed/unseen-count');
    applyFeedBadge(count);
  } catch { /* si falla, el proximo evento lo corrige */ }
}

export function applyFeedBadge(count) {
  feedUnseen = count;
  document.querySelectorAll('.nav-item[data-view="feed"]').forEach((el) => {
    const existente = el.querySelector('.nav-badge');
    if (count > 0) {
      const texto = count > 99 ? '99+' : String(count);
      if (existente) existente.textContent = texto;
      else el.insertAdjacentHTML('beforeend', `<span class="nav-badge">${texto}</span>`);
    } else if (existente) existente.remove();
  });
}
