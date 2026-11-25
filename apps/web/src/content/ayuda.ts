/** Artículos de la ayuda. El texto se busca por título, resumen, palabras clave y contenido. */
export interface Articulo {
  id: string;
  tema: string;
  titulo: string;
  resumen: string;
  claves: string[];
  /** Párrafos; las líneas que empiezan por "- " se muestran como lista. */
  texto: string[];
  /** Enlace opcional dentro de la app. */
  accion?: { etiqueta: string; to: string };
}

export const TEMAS = ['Empezar', 'Gráficas', 'Ahorro y consejos', 'Avisos y móvil', 'Tus datos y seguridad'] as const;

export const ARTICULOS: Articulo[] = [
  {
    id: 'modos-de-uso',
    tema: 'Empezar',
    titulo: 'Dos formas de usar EConsultor: a diario o una vez al mes',
    resumen: 'Puedes anotar cada gasto en el momento o subir el extracto del banco una vez al mes. Elige la que te venga mejor.',
    claves: ['diario', 'mensual', 'extracto', 'manual', 'rutina', 'cómo empiezo', 'modo'],
    texto: [
      'No hay una forma correcta. Estas son las dos más habituales y se pueden mezclar:',
      '- Cada día (30 segundos): pulsa «Anotar», escribe el importe, elige la categoría y listo. Es lo más preciso y activa la racha. El aviso diario te lo recuerda si se te pasa.',
      '- Una vez al mes (5 minutos): descarga el extracto de tu banco (CSV o PDF) y súbelo en Ajustes › Importar. EConsultor reconoce fechas, importes y categorías, y tú revisas lo dudoso antes de guardar.',
      '- Mixto: importa el extracto cada mes y anota a mano solo los pagos en efectivo, que no aparecen en el banco.',
      'Las gráficas y los consejos mejoran cuantos más meses tengan. Con 2 o 3 meses ya se ven tus hábitos con claridad.',
    ],
    accion: { etiqueta: 'Importar un extracto', to: '/ajustes' },
  },
  {
    id: 'primer-paso',
    tema: 'Empezar',
    titulo: 'Tus primeros cinco minutos',
    resumen: 'Qué hacer nada más crear la cuenta para que la app empiece a ser útil.',
    claves: ['primeros pasos', 'empezar', 'inicio', 'nuevo', 'tutorial'],
    texto: [
      '- 1. Anota o importa tus movimientos del último mes: así las gráficas no empiezan vacías.',
      '- 2. Apunta tus ingresos fijos (nómina) y los gastos que se repiten (alquiler, seguros, suscripciones). Con eso EConsultor calcula cuánto te queda libre cada mes.',
      '- 3. Mira «Consejos»: verás las recomendaciones basadas en tus propios números.',
      '- 4. Activa el recordatorio diario en Ajustes si quieres crear el hábito.',
      'Todo lo demás es opcional y puedes volver aquí cuando quieras.',
    ],
  },
  {
    id: 'interfaz-sencilla-profesional',
    tema: 'Empezar',
    titulo: 'Interfaz sencilla o profesional',
    resumen: 'Dos niveles de detalle: lo esencial de un vistazo, o el análisis completo.',
    claves: ['modo', 'simple', 'pro', 'profesional', 'sencilla', 'interfaz', 'cambiar vista'],
    texto: [
      'Sencilla muestra tu saldo, un gráfico claro y tus categorías principales. Está pensada para mirarla en diez segundos.',
      'Profesional añade el flujo del dinero, el pulso financiero, el mapa de gasto por días, tu semana tipo y la comparación de los últimos 12 meses.',
      'Se cambia en Ajustes › Interfaz y la elección se guarda en tu cuenta, así que es la misma en el móvil y en el ordenador.',
    ],
    accion: { etiqueta: 'Ir a Ajustes', to: '/ajustes' },
  },
  {
    id: 'anotar-movimientos',
    tema: 'Empezar',
    titulo: 'Anotar, editar y borrar un movimiento',
    resumen: 'El botón «+» abre la hoja de anotar. Puedes encadenar varios seguidos.',
    claves: ['anotar', 'añadir', 'gasto', 'ingreso', 'editar', 'borrar', 'categoría', 'fecha', 'nota'],
    texto: [
      'Pulsa el botón «+» (o «Anotar» en el ordenador). Elige si es gasto o ingreso, escribe el importe, la categoría y, si quieres, una nota. La fecha es hoy, pero puedes cambiarla para anotar algo de días atrás.',
      '«Guardar y añadir otro» deja la hoja abierta para anotar varios gastos seguidos, por ejemplo al volver de hacer la compra.',
      'Para corregir algo, abre Movimientos y toca el movimiento: podrás cambiarlo o borrarlo.',
    ],
    accion: { etiqueta: 'Ver movimientos', to: '/movimientos' },
  },
  {
    id: 'importar-extracto',
    tema: 'Empezar',
    titulo: 'Importar el extracto del banco (CSV o PDF)',
    resumen: 'Sube el archivo de tu banco y EConsultor rellena tus movimientos.',
    claves: ['importar', 'extracto', 'csv', 'pdf', 'banco', 'n26', 'bbva', 'santander', 'ing', 'deutsche bank', 'sparkasse', 'subir', 'excel'],
    texto: [
      'En la web de tu banco busca «extracto», «movimientos» o «exportar» y descarga el archivo en CSV (lo más fiable) o en PDF.',
      'Después abre Ajustes › Importar (o el botón de importar en Movimientos) y elige el archivo. Verás una lista con lo que se ha entendido: fecha, concepto, importe y categoría propuesta.',
      '- Revisa lo que esté en gris o sin categoría y corrígelo.',
      '- Si el servidor tiene la IA activada, puedes dejar que ayude a categorizar y a leer PDF difíciles. Antes de enviarla se eliminan IBAN, correos y números largos.',
      '- Los movimientos que ya tienes (y los traspasos entre tus propias cuentas) aparecen desmarcados para no duplicarlos; márcalos si de verdad quieres importarlos.',
      'Si un archivo no se entiende, usa el botón de reportar fallos y cuéntanos qué banco es; no hace falta que adjuntes nada con tus datos.',
    ],
    accion: { etiqueta: 'Importar ahora', to: '/ajustes' },
  },
  {
    id: 'saldo-del-mes',
    tema: 'Gráficas',
    titulo: 'Saldo del mes',
    resumen: 'Cómo suben y bajan tus ahorros a lo largo del mes.',
    claves: ['saldo', 'gráfica', 'línea', 'balance', 'mes', 'previsión'],
    texto: [
      'Muestra el saldo acumulado del mes día a día: ingresos menos gastos. Si baja de cero, estás gastando más de lo que has ingresado hasta la fecha.',
      'Toca o pasa el ratón por la gráfica para ver el valor de cada día. En el mes actual, arriba aparece «Cierre previsto»: cuánto te quedaría a fin de mes si sigues a este ritmo.',
      'Con «Ver tabla» obtienes los mismos datos en forma de tabla.',
    ],
  },
  {
    id: 'rio-del-dinero',
    tema: 'Gráficas',
    titulo: 'El río de tu dinero',
    resumen: 'Un diagrama que une de dónde entra el dinero con a dónde se va.',
    claves: ['sankey', 'río', 'flujo', 'ingresos', 'gastos', 'profesional'],
    texto: [
      'Dibuja cómo fluye tu dinero desde los ingresos hasta las categorías de gasto y lo que te queda. Cuanto más ancha la franja, más dinero.',
      'Sirve para ver de un vistazo qué parte de la nómina se va en vivienda, comida u ocio. Disponible en la interfaz profesional.',
    ],
  },
  {
    id: 'pulso-financiero',
    tema: 'Gráficas',
    titulo: 'Tu pulso financiero (la puntuación de 0 a 100)',
    resumen: 'Una nota global y los cuatro hábitos que la componen.',
    claves: ['pulso', 'puntuación', 'nota', 'indicadores', 'tasa de ahorro', 'gastos fijos', 'estabilidad', 'constancia', 'salud financiera'],
    texto: [
      'El anillo resume tu salud económica en una nota de 0 a 100 («En construcción», «Sólida», «Excelente»…). Se compone de cuatro hábitos:',
      '- Ahorro (peso 40 %): objetivo, ahorrar el 20 % o más de lo que ingresas.',
      '- Gastos fijos (20 %): lo ideal es que no superen la mitad de tus ingresos.',
      '- Estabilidad (20 %): que tus gastos sean parecidos de un mes a otro.',
      '- Constancia (20 %): anotar al menos 20 días al mes.',
      'Cada hábito muestra su objetivo, para que sepas qué mejorar primero.',
    ],
  },
  {
    id: 'mapa-y-semana',
    tema: 'Gráficas',
    titulo: 'Mapa de gasto y «Tu semana»',
    resumen: 'Descubre qué días gastas más.',
    claves: ['mapa de calor', 'calendario', 'semana', 'fin de semana', 'días', 'heatmap'],
    texto: [
      'El mapa de gasto dibuja cada día como una casilla: cuanto más intenso el color, más gasto. Sirve para localizar picos, como el día de cobro o los fines de semana.',
      '«Tu semana» promedia el gasto por día de la semana en los últimos tres meses. Si los sábados destacan, ya sabes dónde mirar.',
    ],
  },
  {
    id: 'doce-meses',
    tema: 'Gráficas',
    titulo: 'Últimos 12 meses y cambio de mes',
    resumen: 'Compara meses y navega por tu historial.',
    claves: ['meses', 'historial', 'comparar', 'año', 'mes anterior', 'navegar'],
    texto: [
      'Las barras de los últimos 12 meses enfrentan ingresos y gastos. Toca un mes para abrirlo en el resto de gráficas.',
      'Arriba puedes cambiar de mes con las flechas. No se puede navegar al futuro: la previsión solo aparece en el mes actual.',
    ],
  },
  {
    id: 'tabla-accesible',
    tema: 'Gráficas',
    titulo: 'Ver las gráficas como tabla',
    resumen: 'Cada gráfica tiene una vista de tabla con los mismos datos.',
    claves: ['tabla', 'accesibilidad', 'daltonismo', 'lector de pantalla', 'copiar datos'],
    texto: [
      'Pulsa «Ver tabla» en cualquier gráfica. Es útil si prefieres cifras exactas, si usas un lector de pantalla o si no distingues bien algunos colores.',
    ],
  },
  {
    id: 'consejos',
    tema: 'Ahorro y consejos',
    titulo: 'Cómo se generan los consejos',
    resumen: 'Reglas sobre tus números y, si está activada, inteligencia artificial.',
    claves: ['consejos', 'ia', 'inteligencia artificial', 'claude', 'recomendaciones', 'ahorrar', 'premium'],
    texto: [
      'Los consejos salen de tus movimientos: tasa de ahorro, gastos fijos frente a variables, suscripciones, tendencia, gasto de fin de semana y regularidad de ingresos. Cada uno indica el ahorro mensual que podrías conseguir.',
      'Con suficiente historial (unos 10 movimientos) y la IA activada en el servidor, un asistente redacta consejos más personalizados. A la IA solo se envía un resumen anónimo de cifras, nunca notas, nombres ni movimientos individuales.',
      'No son asesoramiento financiero profesional: son ideas basadas en tus propios datos.',
    ],
    accion: { etiqueta: 'Ver mis consejos', to: '/consejos' },
  },
  {
    id: 'prevision-fin-de-mes',
    tema: 'Ahorro y consejos',
    titulo: 'Previsión de fin de mes',
    resumen: 'Cuánto te quedará si sigues a este ritmo.',
    claves: ['previsión', 'forecast', 'fin de mes', 'cuánto me queda', 'proyección'],
    texto: [
      'EConsultor proyecta tus ingresos y gastos hasta final de mes con tu ritmo de los últimos meses y lo que ya has anotado. Cuanto más al día lleves los datos, más fiable es.',
      'Es una estimación, no una promesa: un gasto grande e imprevisto cambia el resultado.',
    ],
  },
  {
    id: 'racha',
    tema: 'Ahorro y consejos',
    titulo: 'La racha de días',
    resumen: 'Los días seguidos en los que has anotado algo.',
    claves: ['racha', 'constancia', 'hábito', 'fuego', 'días seguidos'],
    texto: [
      'Cada día seguido en el que anotas algo suma a tu racha, que aparece en el resumen del mes. Si se corta, puedes retomarla cuando quieras.',
    ],
  },
  {
    id: 'recordatorio-diario',
    tema: 'Avisos y móvil',
    titulo: 'Recordatorio diario',
    resumen: 'Un aviso a la hora que elijas para anotar los gastos del día.',
    claves: ['recordatorio', 'aviso', 'notificación', 'push', 'hora', '9', 'mañana'],
    texto: [
      'En Ajustes › Recordatorio diario activa el aviso y elige la hora (en tu zona horaria). Solo se envía si todavía no has anotado nada ese día.',
      '- En la app de Android el aviso lo programa el propio teléfono, funciona con la app cerrada y no hace falta nada más.',
      '- En el navegador necesitas además permitir las notificaciones del dispositivo.',
      '- En iPhone: abre la web en Safari, pulsa Compartir › «Añadir a pantalla de inicio», abre EConsultor desde ahí y activa los avisos.',
    ],
    accion: { etiqueta: 'Configurar el aviso', to: '/ajustes' },
  },
  {
    id: 'app-android',
    tema: 'Avisos y móvil',
    titulo: 'Instalar la app de Android',
    resumen: 'La misma EConsultor en una app, con el aviso diario nativo.',
    claves: ['android', 'apk', 'app', 'instalar', 'móvil', 'teléfono', 'descargar'],
    texto: [
      'Descarga el archivo APK desde el enlace de Ajustes, ábrelo y, si Android lo pide, permite instalar apps de esta fuente. Después abre EConsultor e inicia sesión.',
      'La app muestra exactamente la misma cuenta que la web. Tiene aviso diario a la hora elegida, subida de extractos y funciona aunque cierres el navegador.',
      'Si no hay enlace de descarga todavía, la persona que administra el servidor puede dártelo.',
    ],
  },
  {
    id: 'instalar-como-app',
    tema: 'Avisos y móvil',
    titulo: 'Instalarla como app desde el navegador (iPhone, ordenador)',
    resumen: 'EConsultor se puede instalar sin tienda de aplicaciones.',
    claves: ['pwa', 'instalar', 'iphone', 'ios', 'pantalla de inicio', 'safari', 'chrome', 'escritorio'],
    texto: [
      '- iPhone/iPad: en Safari pulsa Compartir › «Añadir a pantalla de inicio».',
      '- Android: en Chrome, menú › «Instalar aplicación» (o usa la app de Android).',
      '- Ordenador: en Chrome o Edge, el icono de instalar en la barra de direcciones.',
    ],
  },
  {
    id: 'verificacion-dos-pasos',
    tema: 'Tus datos y seguridad',
    titulo: 'Verificación en dos pasos',
    resumen: 'Un código de tu móvil además de la contraseña.',
    claves: ['2fa', 'dos pasos', 'seguridad', 'autenticador', 'totp', 'códigos de recuperación', 'google authenticator'],
    texto: [
      'En Ajustes › Seguridad pulsa «Activar», escanea el código QR con una app autenticadora (Google Authenticator, Authy, 1Password…) y escribe el código de 6 dígitos.',
      'Guarda los códigos de recuperación en un lugar seguro: cada uno sirve una vez si pierdes el móvil, y no se vuelven a mostrar.',
    ],
    accion: { etiqueta: 'Activar ahora', to: '/ajustes' },
  },
  {
    id: 'exportar-borrar',
    tema: 'Tus datos y seguridad',
    titulo: 'Exportar o borrar tus datos',
    resumen: 'Son tuyos: te los puedes llevar o eliminar cuando quieras.',
    claves: ['exportar', 'borrar', 'eliminar cuenta', 'rgpd', 'json', 'privacidad', 'descargar datos'],
    texto: [
      'En Ajustes › Tus datos puedes exportar todo en un archivo JSON, borrar solo los movimientos (conservando la cuenta) o eliminar la cuenta de forma definitiva. Al eliminarla desaparecen también tus reportes de fallos.',
    ],
    accion: { etiqueta: 'Tus datos', to: '/ajustes' },
  },
  {
    id: 'privacidad',
    tema: 'Tus datos y seguridad',
    titulo: 'Qué se guarda y quién puede verlo',
    resumen: 'Explicado con claridad, incluido lo que ve quien administra el servidor.',
    claves: ['privacidad', 'datos', 'cifrado', 'administrador', 'perfil financiero', 'quién ve', 'ia', 'seguridad'],
    texto: [
      'Tus datos se guardan cifrados en el servidor. Las contraseñas no se almacenan, solo una huella irreversible. Las sesiones usan cookies protegidas.',
      'Quien administra el servidor dispone de un panel de control para vigilar que todo funciona. Por defecto muestra solo información técnica y recuentos (cuántas cuentas, cuántos movimientos), sin tus importes.',
      'Si la persona que administra activa la opción de perfiles financieros, el panel puede mostrar un perfil agregado de tu situación (nivel de ahorro, tendencia, categorías principales y previsión) para entender cómo se usa la app. Debe informarte de ello y puedes pedir que se desactive o borrar tu cuenta cuando quieras.',
      'Si la IA está activada, solo recibe un resumen numérico anónimo; nunca tu nombre, tu correo, tus notas ni tus movimientos individuales.',
    ],
  },
  {
    id: 'reportar-fallo',
    tema: 'Tus datos y seguridad',
    titulo: 'Reportar un fallo o proponer una idea',
    resumen: 'Hay un botón discreto en la esquina superior derecha.',
    claves: ['reportar', 'fallo', 'error', 'bug', 'sugerencia', 'idea', 'problema', 'ayuda'],
    texto: [
      'En la esquina superior derecha hay un pequeño icono de insecto, casi transparente: púlsalo, cuéntanos qué pasó y envía. Se adjuntan solo la pantalla en la que estabas y el tipo de dispositivo, nunca tus movimientos.',
      'Puedes enviar hasta 10 reportes al día. Los lee directamente la persona que administra el servidor.',
    ],
  },
];

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Búsqueda sencilla: todas las palabras deben aparecer; el título y las claves pesan más. */
export function buscar(consulta: string, lista: Articulo[] = ARTICULOS): Articulo[] {
  const palabras = sinTildes(consulta).split(/\s+/).filter((p) => p.length > 1);
  if (!palabras.length) return lista;
  const puntuados = lista
    .map((a) => {
      const titulo = sinTildes(a.titulo);
      const claves = sinTildes(a.claves.join(' '));
      const resto = sinTildes(`${a.resumen} ${a.texto.join(' ')} ${a.tema}`);
      let puntos = 0;
      for (const p of palabras) {
        const aqui = (titulo.includes(p) ? 5 : 0) + (claves.includes(p) ? 4 : 0) + (resto.includes(p) ? 1 : 0);
        if (!aqui) return { a, puntos: 0 };
        puntos += aqui;
      }
      return { a, puntos };
    })
    .filter((x) => x.puntos > 0)
    .sort((x, y) => y.puntos - x.puntos);
  return puntuados.map((x) => x.a);
}
