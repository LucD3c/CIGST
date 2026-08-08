// LIMPIEZA DEL HTML DE LOS CORREOS
//
// Este es el punto mas expuesto de toda la plataforma. Todo lo demas que se
// muestra lo escribio alguien de la empresa; un correo lo escribio cualquiera,
// desde afuera, y puede venir con HTML hecho a proposito para hacer dano.
//
// La defensa es de dos capas, y la importante es la segunda:
//
//   1. Aca se saca lo obviamente peligroso (scripts, iframes, manejadores de
//      eventos, enlaces javascript:) y se desactivan las imagenes remotas.
//   2. En el cliente, el resultado se muestra dentro de un <iframe sandbox>
//      SIN "allow-scripts". Eso no es una limpieza que pueda tener un agujero:
//      es el navegador el que garantiza que ahi adentro no corre JavaScript,
//      no hay formularios que se envien y no se puede tocar la pagina de
//      afuera. Aunque esta limpieza se me escapara algo, no habria ejecucion.
//
// Las imagenes remotas se bloquean por defecto porque no son solo imagenes:
// un pixel de seguimiento le avisa a quien mando el correo que se abrio,
// desde que IP y a que hora. En una red interna eso filtra informacion sin
// que nadie toque nada.

const ETIQUETAS_FUERA = [
  'script', 'iframe', 'object', 'embed', 'applet', 'form', 'input', 'button',
  'select', 'textarea', 'link', 'meta', 'base', 'frame', 'frameset', 'svg', 'math',
];

export type ResultadoLimpieza = {
  html: string;
  /** Cuantas imagenes remotas se desactivaron, para poder ofrecer mostrarlas. */
  imagenesBloqueadas: number;
};

export function limpiarHtmlDeCorreo(entrada: string, opciones: { mostrarImagenes?: boolean } = {}): ResultadoLimpieza {
  let html = entrada;
  let imagenesBloqueadas = 0;

  // Comentarios: pueden esconder marcado que algunos navegadores reinterpretan.
  html = html.replace(/<!--[\s\S]*?-->/g, '');

  // Etiquetas peligrosas, con su contenido.
  for (const etiqueta of ETIQUETAS_FUERA) {
    html = html.replace(new RegExp(`<${etiqueta}\\b[\\s\\S]*?<\\/${etiqueta}\\s*>`, 'gi'), '');
    html = html.replace(new RegExp(`<${etiqueta}\\b[^>]*\\/?>`, 'gi'), '');
  }

  // Manejadores de eventos: onload, onerror, onclick y todos sus primos.
  html = html.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '');
  html = html.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '');
  html = html.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '');

  // Esquemas de URL que ejecutan codigo.
  html = html.replace(/(href|src|action|formaction|xlink:href)\s*=\s*("|')\s*(javascript|vbscript|data:text\/html)[^"']*\2/gi, '$1="#"');

  // Imagenes remotas: se guarda la direccion original en un atributo propio
  // para poder mostrarlas si la persona lo pide.
  html = html.replace(/<img\b([^>]*?)\ssrc\s*=\s*("|')(https?:\/\/[^"']*)\2([^>]*)>/gi, (_m, antes, comilla, url, despues) => {
    if (opciones.mostrarImagenes) return `<img${antes} src=${comilla}${url}${comilla}${despues}>`;
    imagenesBloqueadas += 1;
    return `<img${antes} data-remota=${comilla}${url}${comilla} alt="[imagen bloqueada]" style="display:none"${despues}>`;
  });
  // Fondos remotos por CSS: misma via de seguimiento.
  if (!opciones.mostrarImagenes) {
    html = html.replace(/url\(\s*['"]?https?:\/\/[^)]*\)/gi, 'none');
  }

  // Todos los enlaces se abren afuera y sin pasarle informacion de referencia
  // al destino.
  html = html.replace(/<a\b([^>]*)>/gi, (m, attrs) => {
    if (/target\s*=/i.test(attrs)) return m;
    return `<a${attrs} target="_blank" rel="noopener noreferrer nofollow">`;
  });

  return { html, imagenesBloqueadas };
}

/**
 * Cuando el correo no trae parte de texto plano, se arma una a partir del
 * HTML. Se usa para la vista previa de la lista, donde no hace falta formato.
 */
export function htmlATexto(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
