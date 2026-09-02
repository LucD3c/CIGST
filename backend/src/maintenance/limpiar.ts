// Limpieza de datos sin uso, ejecutada a mano desde el instalador
// (opcion "Liberar espacio"). La misma rutina corre sola cada 6 horas dentro de
// la plataforma; esto sirve para dispararla cuando uno quiere, y sobre todo
// para VER en pantalla exactamente que se elimino.
//
// Lo que se borra son solo datos que ya no le sirven a nadie. Nunca un ticket,
// un mensaje, una conversacion, una imagen, un PDF, una planilla, una persona,
// un equipo ni un articulo -- tampoco los que estan dados de baja.

import { prisma } from '../db/prisma';
import { limpiarDatosSinUso } from './retencion.service';

function mb(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes > 0) return `${Math.round(bytes / 1024)} KB`;
  return '0';
}

async function main() {
  const r = await limpiarDatosSinUso();

  const filas: [string, number | string][] = [
    ['Sesiones vencidas', r.sesionesVencidas],
    ['Intentos de inicio de sesion viejos', r.intentosLogin],
    ['Avisos ya leidos y antiguos', r.avisosLeidos],
    ['Avisos sin leer muy antiguos', r.avisosSinLeerAntiguos],
    ['Lecturas de publicaciones dadas de baja', r.lecturasDePublicacionesBajas],
    ['Archivos sueltos en disco', `${r.archivosHuerfanos} (${mb(r.bytesLiberados)})`],
  ];

  const total =
    r.sesionesVencidas +
    r.intentosLogin +
    r.avisosLeidos +
    r.avisosSinLeerAntiguos +
    r.lecturasDePublicacionesBajas +
    r.archivosHuerfanos;

  console.log('');
  console.log('  Se eliminaron:');
  for (const [etiqueta, valor] of filas) {
    console.log(`    ${etiqueta.padEnd(42, '.')} ${valor}`);
  }
  console.log('');

  if (total === 0) {
    console.log('  No habia nada para limpiar: la plataforma ya estaba al dia.');
  } else {
    console.log(`  Total: ${total} registros sin uso eliminados.`);
  }

  if (r.errores.length) {
    console.log('');
    console.log('  Algunas partes no se pudieron completar:');
    for (const e of r.errores) console.log(`    - ${e}`);
  }
  console.log('');

  await prisma.$disconnect();
  process.exit(r.errores.length ? 1 : 0);
}

main().catch(async (err) => {
  console.error('  No se pudo completar la limpieza:', err instanceof Error ? err.message : err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
