# Diseño

## Principios

1. **El dato es lo único que grita.** El resto es silencio: superficies sobrias, líneas finas, color solo donde significa algo.
2. **Una sola sorpresa por pantalla.** En el Resumen es el número del mes, enorme, sin caja alrededor, que cuenta hasta su valor; y el «río» de dinero.
3. **Móvil primero, escritorio de verdad.** Barra inferior con botón de anotar en móvil; carril lateral en escritorio.
4. **Nada depende solo del color ni del *hover*.** Cada gráfica tiene vista en tabla, foco de teclado y etiquetas accesibles; los estados llevan icono y texto.

## Tipografía

- **Bricolage Grotesque** (variable, eje de anchura) para titulares y cifras: carácter propio, cifras grandes y compactas.
- **DM Sans** para texto y etiquetas.
- Autohospedadas (`@fontsource`): sin peticiones a terceros.

## Color

Claro y oscuro son **dos selecciones propias** de la misma paleta, no una inversión automática (`styles/tokens.css`).

- **Paleta categórica** de 8 tonos en orden fijo, validada para daltonismo (ΔE adyacente ≥ 8 en visión CVD simulada). Nunca se genera un noveno color.
- **El color sigue a la entidad, no a su ranking.** Cada categoría pertenece a una *familia* con un hueco fijo (`lib/categories.ts`): Hogar = azul, Comida = naranja, Movilidad = aguamarina, Suscripciones = amarillo, Ocio y viajes = magenta, Compras = verde, Salud y formación = violeta, Otros = gris.
- Ingresos = aguamarina, gastos = naranja, saldo = azul. Estados (bien/atención/serio) con paleta propia y siempre con icono.
- Mapa de calor: **un solo matiz** (azul) en 5 pasos; en oscuro, lo claro significa «más».
- Texto nunca lleva el color de la serie; la identidad la da la marca de color junto al texto.

## Especificación de marcas

| Marca | Regla |
| --- | --- |
| Columnas | ≤ 14 px, extremo superior redondeado 4 px, base recta |
| Líneas | 2 px, extremos redondos |
| Puntos | ≥ 10 px con anillo de 2 px del color de la superficie |
| Áreas | tono de la serie al ~10–28 % (lavado) |
| Rejillas | 1 px, sólidas, un paso por encima de la superficie |
| Separación entre segmentos | 2 px de superficie, nunca un borde |

## Movimiento

- Un único momento orquestado al cargar: el número cuenta, la línea se dibuja, los ribbons aparecen, las columnas crecen.
- Movimiento que responde a una acción (abrir la hoja de anotar) con muelle corto.
- `prefers-reduced-motion` lo reduce a cero.

## Gráficas

| Gráfica | Pregunta que responde | Forma |
| --- | --- | --- |
| Saldo del mes | ¿Cómo voy y cómo acabaré? | Línea + lavado; previsión punteada; cursor con tooltip y flechas de teclado |
| El río de tu dinero | ¿De dónde viene y a dónde va? | Sankey (ingresos → hub → familias de gasto + «te sobra»/«déficit») |
| En qué se va | ¿Qué pesa más y qué ha cambiado? | Barra segmentada + ranking con variación mensual |
| Últimos 12 meses | ¿Tendencia? | Columnas agrupadas; tocar un mes lo abre |
| Mapa de gasto | ¿Qué días gasto más? | Calendario de calor de 17 semanas |
| Tu semana | ¿Qué día gasto más? | 7 columnas, la mayor resaltada |
| Pulso financiero | ¿Qué tal estoy? | Anillo + 4 medidores (ahorro, fijos, estabilidad, constancia) |
