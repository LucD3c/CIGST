// Estado "en linea / fuera de horario" de una persona, calculado a partir de
// su horario laboral (HH:MM) y la hora ACTUAL DEL SERVIDOR en la zona horaria
// configurada (TZ). Se calcula en el backend a proposito: asi todos ven el
// mismo estado, sin depender del reloj ni la zona horaria de cada equipo.

const TIME_ZONE = process.env.TZ || 'America/Argentina/Buenos_Aires';

// Minutos transcurridos desde la medianoche, ahora, en la zona de la empresa.
export function minutesNow(): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
  const [h = 0, m = 0] = parts.split(':').map(Number);
  return h * 60 + m;
}

function toMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export type WorkingStatus = 'en-linea' | 'fuera-de-horario' | 'sin-horario';

// Devuelve el estado actual. Si el fin es menor que el inicio, el turno cruza
// la medianoche (22:00–06:00) y se evalua como dos tramos.
export function workingStatus(startTime: string | null | undefined, endTime: string | null | undefined): WorkingStatus {
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  if (start === null || end === null) return 'sin-horario';
  if (start === end) return 'sin-horario';

  const now = minutesNow();
  const dentro = start < end ? now >= start && now < end : now >= start || now < end;
  return dentro ? 'en-linea' : 'fuera-de-horario';
}
