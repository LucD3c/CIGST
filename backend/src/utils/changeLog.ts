// Historial de cambios administrativos (Personas, Equipos, Usuarios): el
// service compara el estado anterior con el nuevo y antepone una linea
// "26/07/2026 21:14 — Sector: «A» → «B» · Estado: «Activo» → «Inactivo»"
// al campo changeLog de la entidad. Lo escribe solo el backend: el cliente
// nunca manda changeLog en el body.

const TIME_ZONE = process.env.TZ || 'America/Argentina/Buenos_Aires';

export function nowStamp() {
  // Node trae ICU completo: Intl resuelve la zona horaria sin tzdata del SO.
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short', timeZone: TIME_ZONE }).format(
    new Date(),
  );
}

export type FieldDiff = {
  label: string;
  before: string | null | undefined;
  after: string | null | undefined;
};

// Devuelve la linea de log para los campos que realmente cambiaron, o null
// si no cambio nada (en ese caso no se agrega ruido al historial).
export function buildChangeLine(diffs: FieldDiff[]): string | null {
  const parts = diffs
    .filter((d) => (d.before ?? '') !== (d.after ?? ''))
    .map((d) => `${d.label}: «${d.before || '—'}» → «${d.after || '—'}»`);
  if (!parts.length) return null;
  return `${nowStamp()} — ${parts.join(' · ')}`;
}

export function prependLog(existing: string | null | undefined, line: string): string {
  return existing ? `${line}\n${existing}` : line;
}
