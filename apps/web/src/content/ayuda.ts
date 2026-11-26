import type { Lang } from '@econsultor/shared';
import { getLang } from '../lib/i18n';
import { AYUDA_DE } from './ayuda.de';
import { AYUDA_EN } from './ayuda.en';
import { AYUDA_IT } from './ayuda.it';

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

/** Los temas se traducen al mostrarlos (`t(tema)`); el español es la clave. */
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
    accion: { etiqueta: 'Importar un extracto', to: '/ajustes/datos' },
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
      'Profesional añade el flujo del dinero, el pulso financiero, tu semana tipo y la comparación de los últimos 12 meses.',
      'Se cambia en Ajustes › Interfaz, idioma y perfil y la elección se guarda en tu cuenta, así que es la misma en el móvil y en el ordenador.',
    ],
    accion: { etiqueta: 'Ir a Ajustes', to: '/ajustes/general' },
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
    titulo: 'Importar el extracto del banco (CSV, Excel o PDF)',
    resumen: 'Sube el archivo de tu banco y EConsultor rellena tus movimientos.',
    claves: ['importar', 'extracto', 'csv', 'pdf', 'banco', 'excel', 'xlsx', 'ods', 'nexi', 'italia', 'tarjeta de crédito', 'gastos como ingresos', 'invertir', 'n26', 'bbva', 'santander', 'ing', 'deutsche bank', 'sparkasse', 'subir', 'excel'],
    texto: [
      'En la web de tu banco busca «extracto», «movimientos» o «exportar» y descarga el archivo en CSV o Excel (.xlsx, lo más fiable) o en PDF. También se leen las hojas de LibreOffice (.ods). Un Excel antiguo (.xls) hay que guardarlo antes como .xlsx o CSV.',
      'Después abre Ajustes › Importar (o el botón de importar en Movimientos) y elige el archivo. Verás una lista con lo que se ha entendido: fecha, concepto, importe y categoría propuesta.',
      '- Revisa lo que esté en gris o sin categoría y corrígelo.',
      '- Si el servidor tiene la IA activada, puedes dejar que ayude a categorizar y a leer PDF difíciles. Antes de enviarla se eliminan IBAN, correos y números largos.',
      '- PDF que son una imagen (extractos escaneados o capturas): se leen con OCR. Es menos exacto que un PDF con texto o un CSV, así que revisa fechas, importes y signos antes de guardar.',
      '- Extractos de tarjeta (Nexi, Visa, Mastercard…): muchos bancos ponen ahí los gastos en positivo. EConsultor lo detecta y cuenta esas líneas como gastos; las devoluciones y el pago de la tarjeta se tratan aparte. Si aun así sale todo al revés, pulsa «Invertir gastos e ingresos» sobre la lista.',
      '- Entiende fechas y números de España, Alemania e Italia (05/11/2026, 5 nov 2026, 1.234,56).',
      '- Aprende de ti: si ya categorizaste un comercio, lo repite con los siguientes. Lo que no se puede saber (una persona, una referencia numérica) queda en «Otros» para que lo revises.',
      '- Los movimientos que ya tienes (y los traspasos entre tus propias cuentas) aparecen desmarcados para no duplicarlos; márcalos si de verdad quieres importarlos.',
      '- Funciona con cualquier banco: si las columnas no se llaman como esperamos, se deducen por su contenido y se te avisa para que lo compruebes.',
      '- Varias cuentas: antes de importar eliges a qué cuenta pertenece el extracto. Si parece un extracto que ya subiste (coinciden muchas fechas, importes y comercios con otra cuenta), te avisa por si te has equivocado de archivo.',
      'Si un archivo no se entiende, usa el botón de reportar fallos y cuéntanos qué banco es; no hace falta que adjuntes nada con tus datos.',
    ],
    accion: { etiqueta: 'Importar ahora', to: '/ajustes/datos' },
  },
  {
    id: 'varias-cuentas',
    tema: 'Empezar',
    titulo: 'Varias cuentas bancarias',
    resumen: 'Importa los extractos de todas tus cuentas sin que se mezclen ni se dupliquen.',
    claves: ['cuentas', 'varias cuentas', 'tarjeta', 'duplicados', 'repetido', 'extracto repetido', 'traspaso', 'cuenta compartida'],
    texto: [
      'Si tienes más de una cuenta o tarjeta, al importar un extracto escribe o elige el nombre de la cuenta (por ejemplo «N26», «Tarjeta Nexi»). Cada movimiento queda asociado a su cuenta y puedes filtrar Movimientos por cuenta.',
      'EConsultor compara lo que subes con lo que ya tienes: si casi todas las fechas, importes y comercios coinciden con otra cuenta, te avisa de que quizá has subido dos veces el mismo extracto y deja esos movimientos desmarcados.',
      'Los traspasos entre tus propias cuentas no cuentan como gasto ni como ingreso, para que tus gráficas no se inflen.',
    ],
  },
  {
    id: 'gastos-periodicos',
    tema: 'Empezar',
    titulo: 'Gastos e ingresos periódicos: el alquiler, el transporte, Netflix…',
    resumen: 'Lo que se repite cada mes se anota solo el día que elijas.',
    claves: ['periódico', 'periodico', 'recurrente', 'alquiler', 'suscripción', 'netflix', 'cada mes', 'nómina', 'automático', 'cuota'],
    texto: [
      'Para lo que pagas o cobras todos los meses (alquiler, abono de transporte, Netflix, la nómina…) no hace falta anotarlo cada vez: créalo una vez y la app lo apunta sola.',
      '- Ajustes › Gastos periódicos › Añadir periódico: pon el nombre, el importe, la categoría y el día del mes del cargo o del cobro.',
      '- También puedes activar «Repetir cada mes» al anotar un movimiento: se repetirá el mismo día a partir del mes siguiente.',
      '- Si un mes tiene menos días (por ejemplo, el día 31 en febrero), se anota el último día del mes.',
      '- «Empezar»: este mes o el mes que viene. Si eliges este mes y el día ya pasó, se anota ahora con la fecha de ese día.',
      '- «Último mes» es opcional: sirve para cuotas o contratos que terminan.',
      'Puedes ponerlos en pausa (al reanudarlos no se anotan los meses parados), cambiarlos o eliminarlos. Los cambios solo afectan a lo que viene: lo que ya se anotó se queda como está, y si borras a mano un movimiento generado, no vuelve a aparecer.',
      'Los cargos se anotan aunque no abras la app ese día: el servidor lo hace solo y en cuanto entras ya están. Los periódicos también mejoran la previsión de fin de mes.',
    ],
    accion: { etiqueta: 'Crear un periódico', to: '/ajustes/periodicos' },
  },
  {
    id: 'categorias-propias',
    tema: 'Empezar',
    titulo: 'Crear y cambiar categorías',
    resumen: 'Añade las tuyas, cambia el nombre de las que hay u oculta las que no usas.',
    claves: ['categoría', 'categorias', 'crear', 'nombre', 'renombrar', 'ocultar', 'color', 'fijo', 'variable', 'mascotas'],
    texto: [
      'En Ajustes › Categorías puedes adaptar las categorías de gastos y de ingresos a tu vida.',
      '- Nueva categoría: ponle nombre y, si es un gasto, elige el color con el que sale en las gráficas y si es fijo, variable o discrecional.',
      '- Editar: puedes cambiar el nombre de cualquiera, también de las que trae la app. Si quieres volver al original, escribe de nuevo su nombre.',
      '- Ocultar: las categorías que no usas dejan de salir al añadir un movimiento. Los movimientos que ya tienen esa categoría no cambian.',
      '- Eliminar una categoría tuya: sus movimientos pasan a «Otros gastos» u «Otros ingresos».',
      '«Fijo» y «discrecional» no son un adorno: los consejos y la previsión los usan para separar lo que puedes recortar de lo que tienes que pagar sí o sí.',
      'Un consejo: usa pocas categorías y claras. Con menos de 15 se ve mejor a dónde va el dinero.',
    ],
    accion: { etiqueta: 'Abrir categorías', to: '/ajustes/categorias' },
  },
  {
    id: 'idioma',
    tema: 'Empezar',
    titulo: 'Cambiar el idioma de la app',
    resumen: 'Inglés, español, italiano o alemán.',
    claves: ['idioma', 'lengua', 'inglés', 'español', 'italiano', 'alemán', 'english', 'deutsch', 'italiano', 'language'],
    texto: [
      'Por defecto la app está en inglés. Cámbialo en Ajustes › Idioma, o en la propia pantalla de entrada. La elección se guarda en tu cuenta, así que es la misma en el móvil y en el ordenador.',
      'Cambia todo: menús, gráficas, consejos, avisos y mensajes de error. Los nombres de categoría y de comercio de tus movimientos no se traducen.',
    ],
  },
  {
    id: 'novedades',
    tema: 'Empezar',
    titulo: 'Qué hay de nuevo',
    resumen: 'Un aviso te cuenta las mejoras cada vez que la app se actualiza.',
    claves: ['novedades', 'actualización', 'versión', 'cambios', 'qué hay de nuevo', 'update'],
    texto: [
      'Cuando se publica una versión nueva, al abrir la app aparece una ventana con las funciones añadidas, las secciones nuevas y los fallos corregidos. Puedes volver a verla en Ajustes › Novedades.',
      'Si la app detecta una versión más reciente mientras la tienes abierta, te lo indica con un aviso para recargarla.',
    ],
  },
  {
    id: 'en-que-se-va',
    tema: 'Gráficas',
    titulo: 'En qué se va: barras o tarta',
    resumen: 'El reparto de tus gastos del mes, por familias y por categorías.',
    claves: ['en qué se va', 'tarta', 'circular', 'barras', 'reparto', 'categorías', 'familias', 'gasto'],
    texto: [
      'Muestra cómo se reparte el gasto del mes. Arriba a la derecha eliges cómo verlo: «Barras» (una sola barra dividida) o «Tarta» (un gráfico circular). La app recuerda tu elección en ese dispositivo.',
      'Cada color es una familia de categorías (Hogar, Comida, Movilidad…) y siempre es el mismo color. Debajo ves el ranking de categorías con cuánto ha subido o bajado cada una respecto al mes anterior.',
      'Toca una parte del gráfico, de la leyenda o una categoría del ranking para ver en Movimientos solo esos gastos.',
    ],
    accion: { etiqueta: 'Ver el resumen', to: '/' },
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
    titulo: '«Tu semana»',
    resumen: 'Descubre qué días de la semana gastas más.',
    claves: ['semana', 'fin de semana', 'días', 'día de la semana'],
    texto: [
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
    resumen: 'Dos pestañas: generales y a fondo. Reglas sobre tus números y, si quieres, inteligencia artificial.',
    claves: ['consejos', 'ia', 'inteligencia artificial', 'claude', 'recomendaciones', 'ahorrar', 'premium', 'a fondo', 'detallados', 'específicos', 'comercios', 'suscripciones'],
    texto: [
      'Los consejos salen de tus movimientos: tasa de ahorro, gastos fijos frente a variables, suscripciones, tendencia, gasto de fin de semana y regularidad de ingresos. Cada uno indica el ahorro mensual que podrías conseguir.',
      'Con suficiente historial (unos 10 movimientos) y la IA activada en el servidor, un asistente redacta consejos más personalizados. A la IA solo se envía un resumen anónimo de cifras, nunca notas, nombres ni movimientos individuales.',
      'La pestaña «A fondo» mira tus últimos 3 meses comercio por comercio: qué cargos se repiten cada mes, en qué gastos pequeños se te va el dinero, qué categorías suben, cuánto gastas en fin de semana y cuánto queda sin clasificar. Cada consejo trae un apartado «Qué hacer». Es un análisis local; la IA solo interviene si pulsas «Mejorar con IA» y aceptas el aviso (se envía un resumen sin fechas ni notas). Hacen falta unos 15 movimientos.',
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
    accion: { etiqueta: 'Configurar el aviso', to: '/ajustes/avisos' },
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
    accion: { etiqueta: 'Activar ahora', to: '/ajustes/seguridad' },
  },
  {
    id: 'huella-y-sesion',
    tema: 'Tus datos y seguridad',
    titulo: 'Entrar con huella y cierre por inactividad',
    resumen: 'Acceso con la huella del móvil y sesión que se cierra sola a los 10 minutos.',
    claves: ['huella', 'biometría', 'passkey', 'face id', 'inactividad', 'mantener conectado', 'cerrar sesión', '10 minutos', 'sesión'],
    texto: [
      'Por seguridad, si no tocas la app durante 10 minutos la sesión se cierra y tendrás que volver a entrar. Si prefieres no hacerlo, activa «Mantener conectado» en Ajustes › Seguridad (en un dispositivo compartido, mejor déjalo apagado).',
      'En Ajustes › Seguridad puedes activar «Entrar con huella»: el móvil guarda una clave que solo se desbloquea con tu huella, cara o PIN. Tu huella nunca sale del dispositivo ni llega al servidor. Puedes registrar hasta 5 dispositivos y quitarlos cuando quieras.',
      'En la app de Android la huella usa el lector del teléfono (también la cara o el PIN del sistema): inicia sesión con tu contraseña, actívala en Ajustes › Seguridad y la próxima vez te la pedirá al entrar. En el navegador necesitas abrir la app desde su dirección segura (https) y tener huella o PIN configurado en el móvil.',
      'Si pierdes el móvil, entra con tu contraseña y quita ese dispositivo.',
    ],
    accion: { etiqueta: 'Ir a Seguridad', to: '/ajustes/seguridad' },
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
    accion: { etiqueta: 'Tus datos', to: '/ajustes/datos' },
  },
  {
    id: 'informe-mensual',
    tema: 'Tus datos y seguridad',
    titulo: 'Informe mensual en PDF',
    resumen: 'Un PDF con el análisis escrito del mes y todos tus gastos.',
    claves: ['informe', 'pdf', 'mensual', 'reporte', 'descargar', 'resumen', 'análisis'],
    texto: [
      'En Ajustes › Informe mensual eliges el mes y pulsas «Descargar PDF».',
      '- Al principio hay un resumen escrito: cuánto ingresaste y gastaste, qué ha cambiado respecto al mes anterior, dónde se fue el dinero y qué hacer el mes siguiente.',
      '- Después van los datos: cifras clave, gasto por categorías, evolución de los últimos meses, gasto día a día, mayores gastos, ingresos y tus gastos periódicos.',
      'El informe se hace en tu idioma y con los nombres de categoría que hayas puesto. En la app de Android se guarda en Descargas (si no se guarda, actualiza la app). Es una ayuda para entender tus cifras, no asesoramiento financiero.',
    ],
    accion: { etiqueta: 'Descargar un informe', to: '/ajustes/informe' },
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
/** Traducción de un artículo (el español es el original; lo que falte se muestra en español). */
export interface Traduccion { titulo: string; resumen: string; claves: string[]; texto: string[]; accion?: string }
const TRADUCCIONES: Record<Exclude<Lang, 'es'>, Record<string, Traduccion>> = { en: AYUDA_EN, it: AYUDA_IT, de: AYUDA_DE };

/** Artículos en el idioma pedido (por defecto, el de la app). La búsqueda trabaja sobre este texto. */
export function articulosEn(lang: Lang = getLang()): Articulo[] {
  if (lang === 'es') return ARTICULOS;
  const tr = TRADUCCIONES[lang];
  return ARTICULOS.map((a) => {
    const x = tr[a.id];
    if (!x) return a;
    return { ...a, titulo: x.titulo, resumen: x.resumen, claves: [...x.claves, ...a.claves], texto: x.texto, accion: a.accion ? { ...a.accion, etiqueta: x.accion ?? a.accion.etiqueta } : undefined };
  });
}

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
