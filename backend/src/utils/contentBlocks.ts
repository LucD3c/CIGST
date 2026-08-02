// MOTOR DE BLOQUES — contenido con formato sin HTML de por medio.
//
// El feed y las bases de conocimiento necesitan texto con formato, tablas,
// imagenes y tarjetas. La forma habitual de resolver eso es guardar HTML que
// escribe el usuario, y ahi aparece el XSS: basta un `<img onerror=...>` en
// una celda pegada desde Excel para ejecutar codigo en la sesion de quien lo
// lea.
//
// Aca el contenido se guarda como una LISTA DE BLOQUES con estructura
// conocida: cada bloque tiene un `kind` y unos campos validados contra el
// esquema de ESE tipo. El cliente arma el HTML a partir de esos datos
// escapando cada texto. Nunca se guarda ni se renderiza marcado del usuario,
// asi que el XSS no es un riesgo a mitigar: no tiene por donde entrar.
//
// Beneficio adicional: como el formato es un dato y no marcado libre, todo se
// ve igual lo escriba quien lo escriba, y se puede buscar por texto.

import { z } from 'zod';

/* ---------- Topes ---------- */
// Acotan lo que una sola persona puede guardar de una vez: sin esto, una
// tabla pegada de una planilla enorme entraria completa a la base.
export const MAX_BLOCKS = 60;
export const MAX_TEXT = 5000;
export const MAX_TITLE = 200;
export const MAX_TABLE_ROWS = 200;
export const MAX_TABLE_COLS = 12;
export const MAX_CELL = 300;
export const MAX_LIST_ITEMS = 50;
export const MAX_CARD_FIELDS = 12;

const texto = (max: number) => z.string().trim().max(max);
const textoRequerido = (max: number) => z.string().trim().min(1).max(max);

/* ---------- Un bloque por tipo ---------- */

const tituloBlock = z.object({
  kind: z.literal('titulo'),
  data: z.object({
    texto: textoRequerido(MAX_TITLE),
    nivel: z.union([z.literal(1), z.literal(2)]).default(2),
  }),
});

const textoBlock = z.object({
  kind: z.literal('texto'),
  data: z.object({
    texto: textoRequerido(MAX_TEXT),
  }),
});

const listaBlock = z.object({
  kind: z.literal('lista'),
  data: z.object({
    items: z.array(textoRequerido(MAX_CELL)).min(1).max(MAX_LIST_ITEMS),
    numerada: z.boolean().default(false),
  }),
});

// Tabla: encabezados opcionales y filas rectangulares. Es el bloque que
// resuelve el caso real de "pegar la grilla de puestos del sabado".
const tablaBlock = z.object({
  kind: z.literal('tabla'),
  data: z
    .object({
      encabezados: z.array(texto(MAX_CELL)).max(MAX_TABLE_COLS).default([]),
      filas: z
        .array(z.array(texto(MAX_CELL)).max(MAX_TABLE_COLS))
        .min(1)
        .max(MAX_TABLE_ROWS),
    })
    .refine((d) => d.filas.every((f) => f.length === d.filas[0]!.length), {
      message: 'Todas las filas de la tabla deben tener la misma cantidad de columnas.',
    })
    .refine((d) => !d.encabezados.length || d.encabezados.length === d.filas[0]!.length, {
      message: 'Los encabezados deben tener la misma cantidad de columnas que las filas.',
    }),
});

// Imagen y archivo apuntan a un adjunto ya subido: el binario nunca viaja
// dentro del bloque.
const imagenBlock = z.object({
  kind: z.literal('imagen'),
  data: z.object({
    attachmentId: z.string().uuid(),
    pie: texto(MAX_CELL).optional().default(''),
    ancho: z.enum(['chica', 'media', 'completa']).default('media'),
  }),
});

const archivoBlock = z.object({
  kind: z.literal('archivo'),
  data: z.object({
    attachmentId: z.string().uuid(),
    descripcion: texto(MAX_CELL).optional().default(''),
  }),
});

const avisoBlock = z.object({
  kind: z.literal('aviso'),
  data: z.object({
    texto: textoRequerido(MAX_TEXT),
    tono: z.enum(['info', 'atencion', 'importante']).default('info'),
  }),
});

// Enlace interno de la red (una intranet, un sistema del proveedor). Se
// restringe el esquema a proposito: `javascript:` en un href es la otra via
// clasica de ejecutar codigo con un clic.
const enlaceBlock = z.object({
  kind: z.literal('enlace'),
  data: z.object({
    titulo: textoRequerido(MAX_CELL),
    url: z
      .string()
      .trim()
      .max(2000)
      .refine((u) => /^https?:\/\//i.test(u), { message: 'El enlace debe empezar con http:// o https://' }),
    descripcion: texto(MAX_CELL).optional().default(''),
  }),
});

// Tarjeta: titulo + campos etiquetados, con logo opcional. Es lo que arma la
// grilla de "una tarjeta por obra social" de una base de conocimiento.
// Un campo marcado como `oculto` se muestra tapado y se revela con un clic:
// sirve para usuarios y claves compartidas que hoy estan a la vista de
// cualquiera que pase por atras.
const tarjetaBlock = z.object({
  kind: z.literal('tarjeta'),
  data: z.object({
    titulo: textoRequerido(MAX_CELL),
    imagenAttachmentId: z.string().uuid().nullable().optional(),
    campos: z
      .array(
        z.object({
          etiqueta: textoRequerido(MAX_CELL),
          valor: texto(MAX_CELL),
          oculto: z.boolean().default(false),
        }),
      )
      .max(MAX_CARD_FIELDS)
      .default([]),
    nota: texto(MAX_TEXT).optional().default(''),
  }),
});

export const blockSchema = z.discriminatedUnion('kind', [
  tituloBlock,
  textoBlock,
  listaBlock,
  tablaBlock,
  imagenBlock,
  archivoBlock,
  avisoBlock,
  enlaceBlock,
  tarjetaBlock,
]);

export const blocksSchema = z.array(blockSchema).max(MAX_BLOCKS);

export type ContentBlock = z.infer<typeof blockSchema>;

export const BLOCK_KINDS = [
  'titulo',
  'texto',
  'lista',
  'tabla',
  'imagen',
  'archivo',
  'aviso',
  'enlace',
  'tarjeta',
] as const;

/**
 * Ids de adjunto referenciados por los bloques. Se usa para vincular esos
 * adjuntos al post/articulo al guardarlo, y para saber cuales siguen en uso.
 */
export function attachmentIdsOf(blocks: ContentBlock[]): string[] {
  const ids: string[] = [];
  for (const b of blocks) {
    if (b.kind === 'imagen' || b.kind === 'archivo') ids.push(b.data.attachmentId);
    if (b.kind === 'tarjeta' && b.data.imagenAttachmentId) ids.push(b.data.imagenAttachmentId);
  }
  return [...new Set(ids)];
}

/**
 * Texto plano de los bloques, para poder buscar dentro del contenido sin
 * tener que recorrer el JSON en cada consulta.
 */
export function plainTextOf(blocks: ContentBlock[]): string {
  const partes: string[] = [];
  for (const b of blocks) {
    switch (b.kind) {
      case 'titulo':
      case 'texto':
      case 'aviso':
        partes.push(b.data.texto);
        break;
      case 'lista':
        partes.push(b.data.items.join(' '));
        break;
      case 'tabla':
        partes.push(b.data.encabezados.join(' '), ...b.data.filas.map((f) => f.join(' ')));
        break;
      case 'imagen':
        partes.push(b.data.pie ?? '');
        break;
      case 'archivo':
        partes.push(b.data.descripcion ?? '');
        break;
      case 'enlace':
        partes.push(b.data.titulo, b.data.descripcion ?? '');
        break;
      case 'tarjeta':
        // Los valores marcados como ocultos NO entran en el texto de
        // busqueda: no tendria sentido taparlos en pantalla y despues
        // devolverlos en un resultado de busqueda.
        partes.push(
          b.data.titulo,
          b.data.nota ?? '',
          ...b.data.campos.filter((c) => !c.oculto).map((c) => `${c.etiqueta} ${c.valor}`),
        );
        break;
    }
  }
  return partes.filter(Boolean).join(' ').slice(0, 20000);
}

/** Da un resumen corto del contenido, para la lista y las notificaciones. */
export function summaryOf(blocks: ContentBlock[], max = 180): string {
  const texto = plainTextOf(blocks).replace(/\s+/g, ' ').trim();
  return texto.length > max ? `${texto.slice(0, max - 1)}…` : texto;
}

/** Formato con el que se guardan y se devuelven los bloques. */
export type StoredBlock = { kind: string; position: number; data: unknown };

export function toStored(blocks: ContentBlock[]): StoredBlock[] {
  return blocks.map((b, position) => ({ kind: b.kind, position, data: b.data }));
}
