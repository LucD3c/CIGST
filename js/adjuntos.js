import { field, toast } from './formularios.js';
import { $, api } from './nucleo.js';
import { esc } from './util.js';

/* ---------- Adjuntos (tickets y chat) ---------- */
export const ATTACH_ACCEPT = '.png,.jpg,.jpeg,.gif,.webp,.pdf,.xlsx,.xls,.csv';
export const ATTACH_MAX_FILES = 5;
export const ATTACH_MAX_BYTES = 10 * 1024 * 1024;
export const isImageMime = m => ['image/png','image/jpeg','image/gif','image/webp'].includes(m);
export function formatBytes(bytes){
  if(bytes<1024)return `${bytes} B`;
  if(bytes<1024*1024)return `${Math.round(bytes/1024)} KB`;
  return `${(bytes/(1024*1024)).toFixed(1)} MB`;
}
// Sube los archivos elegidos y devuelve los adjuntos ya registrados en el
// servidor (todavia sin vincular: se vinculan al crear el ticket/mensaje).
/* ---------- Compresion de imagenes antes de subirlas ---------- */
// Una foto de un celular moderno pesa entre 3 y 6 MB, y para ver una impresora
// rota o una pantalla con un error no hace falta ni la decima parte de eso.
// Sin esto, unas pocas fotos por ticket llenan el disco del servidor en meses.
//
// La compresion se hace EN EL NAVEGADOR, no en el servidor. El navegador ya
// tiene la imagen decodificada para mostrar la vista previa, asi que
// reescalarla no le cuesta nada; y de este lado sobra CPU, mientras que del
// lado del servidor -que puede ser una PC de escritorio comun atendiendo a
// toda la empresa- no. Ademas viaja menos por la red y la subida es mas rapida.
//
// Efecto lateral bueno: al reencodear se pierden los metadatos EXIF, que en
// una foto de celular incluyen la ubicacion GPS de donde se saco.

// Lado mayor al que se reduce la imagen. 1600 px alcanza de sobra para leer un
// cartel de error en pantalla completa y para imprimir en A4.
export const IMG_MAX_LADO = 1600;
// Calidad del reencodeado. 0.82 es el punto donde el ojo deja de notar la
// diferencia y el archivo ya bajo un orden de magnitud.
export const IMG_CALIDAD = 0.82;
// Debajo de este peso Y dentro del lado maximo no hay nada que ganar.
export const IMG_MIN_BYTES = 200 * 1024;
// Tipos que se reencodean. El GIF queda afuera a proposito: puede estar
// animado y el canvas se quedaria solo con el primer cuadro.
export const IMG_COMPRIMIBLES = new Set(['image/png', 'image/jpeg', 'image/webp']);

// WebP comprime bastante mejor que JPEG y lo entienden todos los navegadores
// actuales; si alguno no pudiera, se cae a JPEG solo.
export let formatoSalida = null;
export function detectarFormatoSalida(){
  if(formatoSalida)return formatoSalida;
  try{
    const c=document.createElement('canvas');c.width=c.height=1;
    formatoSalida=c.toDataURL('image/webp').startsWith('data:image/webp')?'image/webp':'image/jpeg';
  }catch{formatoSalida='image/jpeg';}
  return formatoSalida;
}

export function cambiarExtension(nombre,mime){
  const ext=mime==='image/webp'?'.webp':'.jpg';
  const base=nombre.replace(/\.[^.]+$/,'') || 'imagen';
  return base+ext;
}

/**
 * Devuelve una version mas liviana de la imagen, o el archivo original si no
 * se puede o si comprimirlo no lo mejora. Nunca falla: ante cualquier
 * problema devuelve lo que le dieron.
 */
export async function comprimirImagen(file){
  if(!IMG_COMPRIMIBLES.has(file.type))return file;
  try{
    const bitmap=await createImageBitmap(file);
    const ladoMayor=Math.max(bitmap.width,bitmap.height);
    // Se reencodea si pesa mucho O si es mas grande de lo que se va a mostrar.
    // Las dos condiciones importan: una captura de colores planos puede pesar
    // poco y medir 4000 px de ancho igual, y esos pixeles ocupan memoria del
    // navegador de quien la abre aunque el archivo sea chico.
    if(file.size<IMG_MIN_BYTES&&ladoMayor<=IMG_MAX_LADO){bitmap.close?.();return file;}
    const escala=Math.min(1,IMG_MAX_LADO/ladoMayor);
    const ancho=Math.max(1,Math.round(bitmap.width*escala));
    const alto=Math.max(1,Math.round(bitmap.height*escala));
    const canvas=document.createElement('canvas');
    canvas.width=ancho;canvas.height=alto;
    const ctx=canvas.getContext('2d');
    // Fondo blanco: un PNG con transparencia pasado a JPEG dejaria el fondo
    // negro, que es justo lo que arruina una captura de pantalla.
    const salida=detectarFormatoSalida();
    if(salida==='image/jpeg'){ctx.fillStyle='#fff';ctx.fillRect(0,0,ancho,alto);}
    ctx.drawImage(bitmap,0,0,ancho,alto);
    bitmap.close?.();
    const blob=await new Promise(r=>canvas.toBlob(r,salida,IMG_CALIDAD));
    if(!blob||blob.size>=file.size)return file;   // no mejoro: se deja el original
    return new File([blob],cambiarExtension(file.name,salida),{type:salida});
  }catch{
    return file;   // navegador viejo, imagen rara, memoria: se sube tal cual
  }
}

/**
 * Imagenes que trae un pegado (Ctrl+V). La herramienta de Recortes de Windows,
 * la tecla ImprPant y "copiar imagen" del navegador dejan la imagen en el
 * portapapeles como un archivo sin nombre; aca se le pone uno legible para que
 * no aparezca como "image.png" en todos lados.
 */
export function imagenesDelPegado(ev){
  const items=[...(ev.clipboardData?.items||[])];
  const imagenes=[];
  for(const item of items){
    if(item.kind!=='file'||!item.type.startsWith('image/'))continue;
    const file=item.getAsFile();
    if(!file)continue;
    const ext=(file.type.split('/')[1]||'png').replace('jpeg','jpg');
    const sello=new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
    imagenes.push(new File([file],`captura-${sello}.${ext}`,{type:file.type}));
  }
  return imagenes;
}

export async function uploadFiles(fileList){
  let files=[...fileList];
  if(!files.length)return [];
  if(files.length>ATTACH_MAX_FILES)throw new Error(`Se pueden adjuntar hasta ${ATTACH_MAX_FILES} archivos por vez.`);

  // Se comprime ANTES de mirar el tamano: una foto de 12 MB que despues de
  // comprimir queda en 400 KB tiene que poder subirse, no ser rechazada.
  const antes=files.reduce((n,f)=>n+f.size,0);
  files=await Promise.all(files.map(comprimirImagen));
  const despues=files.reduce((n,f)=>n+f.size,0);
  if(antes-despues>512*1024){
    toast(`Imágenes optimizadas: ${formatBytes(antes)} → ${formatBytes(despues)}`);
  }

  const tooBig=files.find(f=>f.size>ATTACH_MAX_BYTES);
  if(tooBig)throw new Error(`"${tooBig.name}" supera los 10 MB permitidos.`);
  const form=new FormData();
  files.forEach(f=>form.append('files',f));
  const res=await fetch('/api/attachments',{method:'POST',body:form,credentials:'same-origin'});
  const text=await res.text();
  let data=null;
  if(text){try{data=JSON.parse(text);}catch{data=null;}}
  if(!res.ok)throw new Error(data?.error||'No se pudieron subir los archivos.');
  return data.attachments;
}
// Campo reutilizable: input de archivo + lista de lo ya adjuntado. Guarda los
// ids en un array que el formulario lee al enviar.
export function attachmentField(id,label='Archivos adjuntos'){
  return `<div class="field form-span"><label>${label} <span class="muted" style="font-weight:400">· imágenes, PDF o planillas · hasta 10 MB c/u</span></label>`
    +`<input type="file" id="${id}-input" class="file-input" multiple accept="${ATTACH_ACCEPT}" />`
    +`<div class="attach-list" id="${id}-list"></div></div>`;
}
// Devuelve un objeto con .ids() para leer los adjuntos confirmados.
export function wireAttachmentField(id){
  const input=document.getElementById(`${id}-input`);
  const list=document.getElementById(`${id}-list`);
  const state=[];
  if(!input||!list)return {ids:()=>[]};
  const paint=()=>{
    list.innerHTML=state.map(a=>`<div class="attach-item"><span class="attach-name">${esc(a.originalName)}</span><span class="attach-size">${formatBytes(a.size)}</span><button type="button" class="attach-remove" data-remove-attach="${a.id}" title="Quitar">×</button></div>`).join('');
    list.querySelectorAll('[data-remove-attach]').forEach(btn=>btn.onclick=()=>{
      const idx=state.findIndex(a=>a.id===btn.dataset.removeAttach);
      if(idx>=0)state.splice(idx,1);
      paint();
    });
  };
  input.onchange=async()=>{
    if(!input.files?.length)return;
    input.disabled=true;
    try{
      const uploaded=await uploadFiles(input.files);
      uploaded.forEach(a=>{ if(state.length<ATTACH_MAX_FILES)state.push(a); });
      paint();
    }catch(err){toast(err.message||'No se pudieron subir los archivos.');}
    finally{input.disabled=false;input.value='';}
  };
  return {ids:()=>state.map(a=>a.id)};
}
// Render de adjuntos ya guardados: las imagenes se ven, el resto se descarga.
export function attachmentsHtml(list,compact=false){
  if(!list||!list.length)return '';
  return `<div class="attach-view ${compact?'compact':''}">`+list.map(a=>{
    const url=`/api/attachments/${encodeURIComponent(a.id)}`;
    if(isImageMime(a.mimeType)){
      return `<a class="attach-image" href="${url}" target="_blank" rel="noopener" title="${esc(a.originalName)}"><img src="${url}" alt="${esc(a.originalName)}" loading="lazy" /></a>`;
    }
    return `<a class="attach-file" href="${url}" target="_blank" rel="noopener"><span class="attach-file-icon">▤</span><span class="attach-name">${esc(a.originalName)}</span><span class="attach-size">${formatBytes(a.size)}</span></a>`;
  }).join('')+`</div>`;
}
