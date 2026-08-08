// PRESETS DE PROVEEDORES
//
// Son solo atajos para no tener que preguntarle los puertos a Infraestructura
// en los casos habituales. NO son una lista cerrada: siempre se puede cargar
// un proveedor a mano con cualquier host y puerto, que es lo que hace falta
// para un servidor propio, un hosting con cPanel o un Roundcube de la empresa.
//
// Los valores son los que publica cada proveedor y no cambian seguido; si
// alguno cambiara, se corrige desde la pantalla de configuracion sin tocar
// codigo.

export type Preset = {
  clave: string;
  nombre: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: 'ssl' | 'starttls' | 'ninguno';
  /** Lo que hay que saber antes de intentarlo. Se muestra en la pantalla. */
  aviso?: string;
};

export const PRESETS: Preset[] = [
  {
    clave: 'cpanel',
    nombre: 'Hosting propio / cPanel / Roundcube',
    imapHost: 'mail.TU-DOMINIO.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'mail.TU-DOMINIO.com',
    smtpPort: 465,
    smtpSecurity: 'ssl',
    aviso:
      'Reemplazá TU-DOMINIO por el dominio de la empresa. Si no estás seguro del nombre del servidor, ' +
      'es el mismo que usás para entrar al webmail. Infraestructura te lo confirma en un minuto.',
  },
  {
    clave: 'gmail',
    nombre: 'Gmail / Google Workspace',
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    smtpSecurity: 'ssl',
    aviso:
      'Google no acepta la contraseña normal de la cuenta. Cada persona tiene que generar una ' +
      '«contraseña de aplicación» desde su cuenta de Google (requiere tener activada la verificación en dos pasos) ' +
      'y usar esa acá. También hay que tener el acceso IMAP habilitado en la configuración de Gmail.',
  },
  {
    clave: 'microsoft',
    nombre: 'Microsoft 365 / Outlook',
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    smtpSecurity: 'starttls',
    aviso:
      'Microsoft deshabilitó el acceso con usuario y contraseña por IMAP en la mayoría de los planes. ' +
      'Para que funcione, quien administre el tenant de Microsoft 365 tiene que habilitar la ' +
      '«autenticación básica» / SMTP AUTH para las casillas que se vayan a usar. Es un cambio del lado de ellos, ' +
      'no de la plataforma. Si no lo habilitan, la conexión va a fallar con un error de autenticación.',
  },
  {
    clave: 'zoho',
    nombre: 'Zoho Mail',
    imapHost: 'imap.zoho.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.zoho.com',
    smtpPort: 465,
    smtpSecurity: 'ssl',
  },
  {
    clave: 'yahoo',
    nombre: 'Yahoo Mail',
    imapHost: 'imap.mail.yahoo.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.mail.yahoo.com',
    smtpPort: 465,
    smtpSecurity: 'ssl',
    aviso: 'Yahoo también exige una contraseña de aplicación generada desde la cuenta.',
  },
  {
    clave: 'manual',
    nombre: 'Otro proveedor (cargar a mano)',
    imapHost: '',
    imapPort: 993,
    imapSecure: true,
    smtpHost: '',
    smtpPort: 587,
    smtpSecurity: 'starttls',
    aviso:
      'Pedile a Infraestructura estos cuatro datos: servidor y puerto de IMAP (entrada), y servidor y puerto ' +
      'de SMTP (salida). Con eso alcanza.',
  },
];
