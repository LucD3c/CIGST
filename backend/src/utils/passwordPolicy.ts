// ---------------------------------------------------------------------------
// Politica de contrasenas.
//
// Antes el unico requisito era "al menos 8 caracteres", con lo cual "12345678"
// era una contrasena valida para un administrador. El criterio de aca busca el
// punto justo para una empresa real: lo bastante exigente para que no entre
// nadie adivinando, y lo bastante razonable para que una recepcionista pueda
// cumplirlo sin llamar a soporte.
//
// Los mensajes dicen QUE FALTA, no solo que esta mal: una persona que no puede
// arreglar su contrasena termina eligiendo la mas facil que el sistema le
// acepte, y eso es peor que no tener politica.
// ---------------------------------------------------------------------------

export const LARGO_MINIMO = 10;
export const LARGO_MAXIMO = 200;

// Contrasenas que aparecen en cualquier diccionario de ataque. La comparacion
// es sobre la version en minusculas y sin espacios, asi "Password1 " tampoco
// pasa. No pretende ser exhaustiva: frena lo que de verdad se prueba primero.
const COMUNES = new Set([
  '1234567890',
  '12345678',
  '123456789',
  'contrasena',
  'contraseña',
  'contrasena1',
  'password',
  'password1',
  'password123',
  'passw0rd',
  'qwertyuiop',
  'qwerty123',
  'administrador',
  'administrador1',
  'admin12345',
  'administrator',
  'bienvenido',
  'bienvenido1',
  'iloveyou',
  'welcome123',
  'abcd1234',
  'abcdefghij',
  'cambiar-esta-contrasena',
  'cambiar-esta-contraseña',
  'letmein123',
  'sistemas123',
  'soporte123',
  'recepcion123',
  'clave12345',
  'secreto123',
]);

function tieneSecuenciaLarga(valor: string): boolean {
  const v = valor.toLowerCase();
  // Cuatro caracteres consecutivos ascendentes o descendentes (abcd, 4321).
  for (let i = 0; i + 3 < v.length; i += 1) {
    const c = [0, 1, 2, 3].map((k) => v.charCodeAt(i + k));
    const subeDeAUno = c.every((x, k) => k === 0 || x === c[k - 1]! + 1);
    const bajaDeAUno = c.every((x, k) => k === 0 || x === c[k - 1]! - 1);
    if (subeDeAUno || bajaDeAUno) return true;
  }
  return false;
}

function tieneRepeticionLarga(valor: string): boolean {
  return /(.)\1{3,}/.test(valor);
}

/**
 * Devuelve el motivo por el que la contrasena no sirve, o null si esta bien.
 * `username` es opcional: cuando se conoce, se impide usarlo como contrasena.
 */
export function motivoRechazo(password: string, username?: string): string | null {
  if (password.length < LARGO_MINIMO) {
    return `La contraseña tiene que tener al menos ${LARGO_MINIMO} caracteres.`;
  }
  if (password.length > LARGO_MAXIMO) {
    return `La contraseña no puede superar los ${LARGO_MAXIMO} caracteres.`;
  }

  const normalizada = password.toLowerCase().trim();

  if (COMUNES.has(normalizada)) {
    return 'Esa contraseña es de las más usadas del mundo y es lo primero que se prueba. Elegí otra.';
  }

  if (username && username.trim().length >= 3 && normalizada.includes(username.toLowerCase().trim())) {
    return 'La contraseña no puede contener el nombre de usuario.';
  }

  // Se piden 3 de las 4 familias: da margen para armar algo memorable
  // (por ejemplo tres palabras y un numero) sin obligar a un simbolo raro.
  const familias = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (familias < 3) {
    return 'La contraseña tiene que combinar al menos tres de estos cuatro tipos: minúsculas, mayúsculas, números y símbolos.';
  }

  if (tieneRepeticionLarga(password)) {
    return 'La contraseña no puede tener el mismo carácter repetido cuatro veces seguidas.';
  }

  if (tieneSecuenciaLarga(password)) {
    return 'La contraseña no puede tener secuencias como "1234" o "abcd". Cambiá esa parte.';
  }

  return null;
}

export function esValida(password: string, username?: string): boolean {
  return motivoRechazo(password, username) === null;
}

// Texto que se le muestra a la persona al crear o cambiar una contrasena.
export const AYUDA_CONTRASENA =
  `Mínimo ${LARGO_MINIMO} caracteres, combinando al menos tres de: minúsculas, mayúsculas, números y símbolos. ` +
  'Sin secuencias tipo "1234" ni caracteres repetidos. Una frase con números y un símbolo funciona muy bien.';
