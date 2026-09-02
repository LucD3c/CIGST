import { prisma } from '../db/prisma';

// Cuantas veces se reintenta si el numero que toca ya esta ocupado. Solo puede
// pasar con los codigos que el usuario puede escribir a mano (equipos): si
// alguien cargo "EQ-015" manualmente, el contador salta a 016 y sigue.
const MAX_INTENTOS = 50;

// Entrega el siguiente numero de la serie de forma ATOMICA.
//
// Antes esto era `count() + 1`, que tenia una condicion de carrera real: dos
// altas simultaneas leian el mismo total, armaban el mismo codigo y la segunda
// moria contra el indice unico devolviendo un 500 generico (la persona perdia
// lo que habia escrito). Ahora el numero lo entrega Postgres con un
// UPDATE ... RETURNING dentro de la misma sentencia, que es atomico por
// definicion: dos pedidos en paralelo reciben numeros distintos siempre.
//
// `yaExiste` permite ademas convivir con codigos escritos a mano: si el numero
// que toca ya esta tomado, se pide el siguiente en vez de fallar.
export async function nextCode(prefix: string, yaExiste?: (code: string) => Promise<boolean>): Promise<string> {
  for (let intento = 0; intento < MAX_INTENTOS; intento += 1) {
    const filas = await prisma.$queryRaw<{ value: number }[]>`
      INSERT INTO counters (prefix, value) VALUES (${prefix}, 1)
      ON CONFLICT (prefix) DO UPDATE SET value = counters.value + 1
      RETURNING value
    `;
    const valor = filas[0]?.value;
    if (valor === undefined) throw new Error(`No se pudo generar el código ${prefix}.`);

    const code = `${prefix}-${String(valor).padStart(3, '0')}`;
    if (!yaExiste || !(await yaExiste(code))) return code;
  }
  throw new Error(`No se pudo generar un código ${prefix} libre después de ${MAX_INTENTOS} intentos.`);
}
