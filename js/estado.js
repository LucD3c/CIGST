/* Estado compartido de la interfaz.

Todo lo que cambia durante la sesion y necesitan ver varios modulos vive aca
dentro, en un unico objeto. La razon es concreta: un `export let` de un modulo
ES se puede leer desde otro modulo pero NO se puede reasignar desde afuera, y en
esta interfaz hay decenas de lugares que escriben estado ajeno (el router cambia
la vista, cerrar sesion limpia el chat y el correo, el WebSocket agrega
mensajes). Un objeto se muta desde cualquier parte sin ceremonia.

Lo que NO esta aca es el estado que solo le importa a un modulo: eso se queda
como variable privada del modulo que lo usa. */
export const E = {
  store: { employees: [], equipment: [], tickets: [], logbook: [], users: [], technicians: [], sectors: [], schedules: [], categories: [], activity: [], stats: null, opcionesPersonas: [], opcionesEquipos: [] },
  currentUser: null,
  session: false,
  currentView: 'dashboard',
  currentDetailId: null,
  chatConversations: [],
  chatGroups: [],
  activeChatConversationId: null,
  activeChatGroupId: null,
  chatMessages: [],
  chatUnreadCount: 0,
  notifUnreadCount: 0,
  ticketStatusFilter: 'activos',
  feedPosts: [],
  kbSpaces: [],
  kbSpace: null,  // base abierta, con su arbol
  kbArticle: null,  // articulo abierto
  mailEstado: null,  // { disponible, presets }
  mailCuentas: [],
  mailCuentaActiva: null,
  mailCarpetas: [],
  mailMensajes: [],
  mailAbierto: null,  // mensaje que se esta leyendo
};
