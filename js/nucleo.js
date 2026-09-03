import { loginView } from './armazon.js';
import { E } from './estado.js';
import { toast } from './formularios.js';
import { disconnectRealtime } from './tiemporeal.js';

/* CIGST: interfaz operativa conectada al backend real (sin localStorage). */
export const $ = (selector, root = document) => root.querySelector(selector);
export const app = $('#app');

/* ---------- Cliente API ---------- */
export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    const err = new Error('No se pudo conectar con el servidor.');
    err.status = 0;
    throw err;
  }
  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = null; } }
  if (!res.ok) {
    const err = new Error(data?.error || `Error ${res.status}`);
    err.status = res.status;
    err.details = data?.details;
    throw err;
  }
  return data;
}
export function apiErrorMessage(err) {
  const fieldErrors = err?.details?.fieldErrors;
  if (fieldErrors) {
    const first = Object.values(fieldErrors).find(list => Array.isArray(list) && list.length);
    if (first) return first[0];
  }
  return err?.message || 'Ocurrió un error inesperado.';
}
export function handleApiError(err) {
  if (err?.status === 401) {
    E.session = false; E.currentUser = null;
    disconnectRealtime();
    loginView();
    toast('Tu sesión expiró. Iniciá sesión nuevamente.');
    return;
  }
  toast(apiErrorMessage(err));
}
