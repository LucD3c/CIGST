import { employee, equipment } from './util.js';

/* ---------- Notificaciones (campanita) ---------- */

/* ---------- Normalizadores (API -> forma que usa la interfaz) ---------- */
export function normalizeEmployee(e) {
  return {
    id: e.id, code: e.code, name: e.name, document: e.document || '—', email: e.email || '',
    phone: e.phone || '', extension: e.extension || '', sectorId: e.sectorId || '', sectorName: e.sector?.name || '',
    position: e.position || '', status: e.status, workShift: e.workShift || '', schedule: e.schedule || '',
    replacement: e.replacementId || '', replacementInfo: e.replacement || null, notes: e.notes || '',
    changeLog: e.changeLog || '',
    workStartTime: e.workStartTime || '', workEndTime: e.workEndTime || '',
    workingStatus: e.workingStatus || 'sin-horario',
    sectorEquipment: (e.sectorEquipment || []).map(x => ({ id: x.id, type: x.type, model: x.model, status: x.status })),
  };
}
export function normalizeEquipment(e) {
  return {
    id: e.id, code: e.code, type: e.type, model: e.model || '', status: e.status,
    sectorId: e.sectorId || '', sectorName: e.sector?.name || '', changeLog: e.changeLog || '',
  };
}
export function normalizeTicket(t) {
  return {
    id: t.id, code: t.code, title: t.title, description: t.description || '',
    employee: t.employeeId, requestedBy: t.requestedById || '',
    equipment: t.equipmentId || '', sectorId: t.sectorId || '', sectorName: t.sector?.name || '',
    scheduleId: t.scheduleId || '', scheduleInfo: t.schedule || null, category: t.category || 'General',
    technician: t.technician?.name || '', technicianId: t.technicianId || '',
    status: t.status, priority: t.priority, solution: t.solution || '',
    attachments: t.attachments || [],
    createdAt: t.createdAt, updatedAt: t.updatedAt, createdByName: t.createdBy?.name || '',
    employeeInfo: t.employee || null, requestedByInfo: t.requestedBy || null,
    sectorInfo: t.sector || null, equipmentInfo: t.equipment || null,
  };
}
export function normalizeLogbookEntry(x) {
  return {
    id: x.id, code: x.code, title: x.title, category: x.category,
    date: (x.occurredAt || x.createdAt || '').slice(0, 10), author: x.author?.name || '', detail: x.detail || '',
  };
}
export function normalizeUser(u) {
  return {
    id: u.id, name: u.name, username: u.username, role: u.role?.name || u.role, status: u.status,
    lastAccess: u.lastAccessAt ? new Date(u.lastAccessAt).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '—',
    logins: u.loginCount, employeeId: u.employeeId || '', changeLog: u.changeLog || '',
  };
}
export function normalizeSector(s) {
  return {
    id: s.id, name: s.name, status: s.status,
    people: (s.people || []).map(p => ({ id: p.id, name: p.name, status: p.status })),
    equipmentList: (s.equipment || []).map(x => ({ id: x.id, type: x.type, model: x.model, status: x.status })),
    categories: (s.categories || []).map(c => ({ id: c.id, name: c.name })),
  };
}
export function normalizeSchedule(s) {
  return { id: s.id, name: s.name, startTime: s.startTime, endTime: s.endTime, status: s.status };
}
export function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
}
