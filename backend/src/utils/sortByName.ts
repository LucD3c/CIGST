// Orden alfabetico "como lo espera una persona", no como lo ordena Postgres.
//
// El ORDER BY de la base compara por codigo de caracter: "ZZ" queda antes que
// "Zulema" (Z=90 < u=117) y "álvarez" cae despues de "Zulema". Con nombres
// reales, cargados a mano y con acentos, eso se ve como una lista desordenada.
// Este comparador usa la configuracion regional española: ignora mayusculas y
// acentos para el orden, y compara los numeros por valor ("Sala 2" antes que
// "Sala 10") en vez de dígito por dígito.

const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

export function compareNames(a: string | null | undefined, b: string | null | undefined): number {
  return collator.compare(a ?? '', b ?? '');
}

// Devuelve una copia ordenada; no muta el arreglo original.
export function sortByName<T>(rows: T[], key: (row: T) => string | null | undefined): T[] {
  return [...rows].sort((a, b) => compareNames(key(a), key(b)));
}
