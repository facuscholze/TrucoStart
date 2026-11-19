import type { LegalDocumentSlug } from '@truco/shared';

/**
 * Contenido de los documentos legales.
 *
 * REGLAS DE REDACCIÓN (obligatorias mientras esto sea un borrador):
 *  - Nada se afirma como asesoramiento legal ni como obligación definitiva.
 *  - Los datos personales enumerados salen de la base real (`apps/api/drizzle`),
 *    no de una plantilla genérica.
 *  - Toda afirmación sobre el producto debe ser verificable en el código.
 */

export interface LegalSection {
  readonly heading: string;
  readonly paragraphs: readonly string[];
  readonly bullets?: readonly string[];
}

export interface LegalDocument {
  readonly slug: LegalDocumentSlug;
  readonly title: string;
  readonly summary: string;
  readonly sections: readonly LegalSection[];
}

export const legalDocuments: Readonly<Record<LegalDocumentSlug, LegalDocument>> = {
  terminos: {
    slug: 'terminos',
    title: 'Términos y Condiciones',
    summary:
      'Reglas básicas de uso de la plataforma. Este texto es un borrador de trabajo y no constituye asesoramiento legal.',
    sections: [
      {
        heading: '1. Qué es este servicio',
        paragraphs: [
          'La plataforma permite jugar al truco argentino por internet contra otras personas o contra bots de práctica. El juego se resuelve en un servidor autoritativo: la partida no se decide en el navegador.',
          'El servicio es recreativo. No se juega por dinero, no se apuesta y no existe ninguna forma de ganar, retirar o transferir valor real.',
        ],
        bullets: [
          'No hay depósitos ni pagos dentro del juego.',
          'No hay retiros, cobros ni conversión de puntos a dinero.',
          'No existe transferencia de puntos, monedas ni objetos entre jugadores: los puntos de progreso son personales y no se pueden intercambiar.',
        ],
      },
      {
        heading: '2. Cuenta y edad mínima',
        paragraphs: [
          'Para crear una cuenta hay que declarar una dirección de correo, una contraseña y un apodo, y aceptar explícitamente estos Términos y la Política de Privacidad.',
          'La edad mínima para registrarse se configura en la plataforma y se muestra al momento del alta. Si no cumplís ese mínimo, no debés crear una cuenta.',
          'Los datos de la cuenta son personales. Sos responsable de mantener la contraseña en reserva y de la actividad que ocurra con tu sesión.',
        ],
      },
      {
        heading: '3. Conducta en la mesa',
        paragraphs: [
          'La convivencia es parte del juego. Las Reglas de conducta detallan qué se considera un uso indebido y qué medidas puede tomar la moderación.',
          'Se puede reportar a otro jugador desde la mesa. Los reportes quedan registrados con su estado y son revisados por moderación.',
        ],
      },
      {
        heading: '4. Disponibilidad y cambios',
        paragraphs: [
          'El servicio puede interrumpirse por mantenimiento, fallas técnicas o causas ajenas. Las partidas en curso intentan recuperarse por reconexión, pero no se garantiza que toda partida pueda completarse.',
          'Estos Términos pueden actualizarse. Si un cambio es sustancial, la versión nueva se identifica con un número distinto y se vuelve a pedir la aceptación cuando corresponda.',
        ],
      },
      {
        heading: '5. Límite de responsabilidad',
        paragraphs: [
          'Este borrador no define aún el régimen de responsabilidad. Ese punto queda expresamente para revisión legal antes de la publicación.',
        ],
      },
      {
        heading: '6. Contacto',
        paragraphs: [
          'El canal de contacto para consultas sobre estos Términos debe definirse antes de publicar. Figura como pendiente en la lista de verificación legal.',
        ],
      },
    ],
  },

  privacidad: {
    slug: 'privacidad',
    title: 'Política de Privacidad',
    summary:
      'Qué datos guarda la plataforma hoy, para qué, y cómo se pueden ejercer los derechos sobre ellos. Borrador sujeto a revisión legal.',
    sections: [
      {
        heading: '1. Qué datos se guardan',
        paragraphs: [
          'Esta lista refleja la base de datos real del sistema en el momento de escribir este borrador. Si el esquema cambia, esta lista debe actualizarse: es parte de la lista de verificación legal.',
        ],
        bullets: [
          'Correo electrónico y su estado de verificación. Sólo para cuentas registradas: los invitados no tienen correo.',
          'Contraseña almacenada únicamente como hash criptográfico (Argon2id). Nunca se guarda la contraseña en texto plano.',
          'Apodo y su versión normalizada, que es pública porque se muestra en la mesa.',
          'Identificador de Google (sub) si se elige ingresar con Google.',
          'Perfil de juego: avatar, nivel, experiencia, biografía y preferencias de sonido, animaciones y confirmaciones.',
          'Sesiones activas: nombre del dispositivo, user agent e IP, con fecha de uso y vencimiento. Sirven para poder cerrar sesiones y detectar reutilización de tokens.',
          'Tokens de verificación de correo y de recuperación de contraseña, guardados como hash.',
          'Historial de partidas: participantes, asientos, puntajes, eventos de la partida, semilla de barajado revelada y reglas aplicadas.',
          'Reportes y sanciones: motivo, estado, resolución y fechas.',
          'Registro de auditoría de acciones administrativas y de seguridad, con actor, acción e IP.',
          'Progreso del tutorial.',
          'Constancia de aceptación legal: versión aceptada de los Términos y de la Política, fecha de aceptación y edad mínima vigente en ese momento.',
        ],
      },
      {
        heading: '2. Qué NO se guarda',
        paragraphs: [
          'No se guarda la edad declarada: sólo se usa en el momento del alta para verificar el mínimo y se descarta.',
          'No se guardan datos sensibles en el sentido del artículo 7 de la Ley 25.326 (origen racial o étnico, opiniones políticas, convicciones religiosas o filosóficas, afiliación sindical, datos de salud o de vida sexual).',
          'No se guardan datos de tarjetas, cuentas bancarias ni billeteras virtuales, porque el producto no procesa pagos.',
        ],
      },
      {
        heading: '3. Para qué se usan',
        paragraphs: [
          'Los datos se usan para operar la cuenta, sostener las partidas, prevenir abuso (límites de intentos, bloqueos, sesiones), responder reportes y cumplir con la seguridad del servicio.',
          'No hay publicidad de terceros ni venta de datos. Si eso cambiara, esta política y la aceptación tendrían que actualizarse.',
        ],
      },
      {
        heading: '4. Cookies y almacenamiento local',
        paragraphs: [
          'La sesión se mantiene con cookies propias marcadas HttpOnly y SameSite. El detalle está en la Política de Cookies.',
        ],
      },
      {
        heading: '5. Derechos sobre los datos',
        paragraphs: [
          'La Ley 25.326 reconoce el derecho a acceder, rectificar, actualizar y suprimir los datos personales, con las excepciones que la propia ley prevé.',
          'La plataforma todavía no ofrece un procedimiento publicado para ejercer esos derechos. Definirlo es una tarea pendiente de la lista de verificación legal: hasta entonces, este borrador no debe publicarse como definitivo.',
        ],
      },
      {
        heading: '6. Conservación y borrado',
        paragraphs: [
          'Las cuentas y los datos asociados se conservan mientras la cuenta exista. La eliminación de cuenta está prevista en el diseño y debe documentarse con plazos concretos antes de publicar.',
          'Los registros de seguridad y auditoría pueden conservarse por más tiempo por razones de prevención de abuso. El plazo exacto queda pendiente de definición legal.',
        ],
      },
    ],
  },

  cookies: {
    slug: 'cookies',
    title: 'Política de Cookies',
    summary:
      'Qué guarda el navegador. Sólo se usan cookies técnicas de sesión y almacenamiento local de preferencias. Borrador sujeto a revisión legal.',
    sections: [
      {
        heading: '1. Cookies de sesión',
        paragraphs: [
          'Al iniciar sesión o entrar como invitado, el servidor entrega cookies propias para mantener la sesión. Están marcadas HttpOnly (no accesibles desde JavaScript) y SameSite, y en producción viajan sólo por HTTPS.',
          'Sin estas cookies no es posible mantener la sesión: son estrictamente necesarias para prestar el servicio.',
        ],
      },
      {
        heading: '2. Almacenamiento local del navegador',
        paragraphs: [
          'El navegador guarda preferencias de interfaz: sonido, animaciones reducidas, confirmación de cantos y si ya se mostró la bienvenida. No son datos de identificación personal y se pueden borrar vaciando los datos del sitio.',
        ],
      },
      {
        heading: '3. Qué no se usa',
        paragraphs: [
          'No se usan cookies publicitarias ni de seguimiento de terceros, ni píxeles de redes sociales.',
        ],
      },
    ],
  },

  'reglas-de-conducta': {
    slug: 'reglas-de-conducta',
    title: 'Reglas de Conducta de la Mesa',
    summary:
      'Pautas de convivencia y consecuencias de no respetarlas. Borrador sujeto a revisión legal y de moderación.',
    sections: [
      {
        heading: '1. Respeto en la mesa',
        paragraphs: [
          'No se toleran insultos, discurso de odio, acoso ni discriminación. El apodo y el chat rápido pasan por un filtro de términos bloqueados que la moderación puede ampliar.',
        ],
      },
      {
        heading: '2. Juego limpio',
        paragraphs: [
          'Se prohíbe acordar resultados con otras personas, usar herramientas externas para calcular jugadas, o abusar de la reconexión para obtener ventaja.',
          'El servidor es autoritativo y cada partida deja un registro auditable con la semilla revelada al final: eso permite revisar reclamos de juego limpio.',
        ],
      },
      {
        heading: '3. Reportes',
        paragraphs: [
          'Cualquier jugador puede reportar desde la mesa. El reporte queda registrado con motivo, estado y resolución, y sólo es visible para moderación.',
          'El uso abusivo de reportes también puede ser sancionado.',
        ],
      },
      {
        heading: '4. Medidas',
        paragraphs: [
          'La moderación puede advertir, silenciar temporalmente el chat, suspender la cuenta por un plazo o bloquearla definitivamente. Toda sanción queda registrada en el historial de la cuenta.',
          'La escala exacta de sanciones queda pendiente de definición junto con el área legal.',
        ],
      },
    ],
  },
};

export const legalDocumentOrder: readonly LegalDocumentSlug[] = [
  'terminos',
  'privacidad',
  'cookies',
  'reglas-de-conducta',
];
