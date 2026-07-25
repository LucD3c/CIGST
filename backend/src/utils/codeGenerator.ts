// Genera codigos legibles (EMP-001, EQ-001, TK-001...) equivalentes a los que ya
// usaba la version local del frontend, contando registros existentes (incluye
// los soft-deleted para que el numero nunca se repita tras un borrado).
export async function nextCode(prefix: string, countAll: () => Promise<number>): Promise<string> {
  const total = await countAll();
  return `${prefix}-${String(total + 1).padStart(3, '0')}`;
}
