# Cómo se calculan los escenarios y sus límites

## Qué es cada producto

La página mantiene separados tres tipos de información:

1. **observación oficial:** altura y variables operativas medidas por PNA o CTM;
2. **pronóstico oficial:** comunicado de corto plazo de CTM Salto Grande;
3. **modelo experimental local:** ensamble de análogos, identificado con versión, período de entrenamiento y métricas fuera de muestra.

El tercer producto no reemplaza al parte oficial. La interfaz muestra la estimación calculada y separa explícitamente dos cuestiones: su valor numérico y la fuerza de la evidencia histórica que permite considerarla **validada** o solamente **exploratoria**.

## Datos usados por el modelo local

El proceso conserva la serie de 15 minutos de la [Comisión Técnica Mixta de Salto Grande](https://www.saltogrande.org/datos_estacion.php) y la agrega por día. Usa cinco estaciones:

- Puerto Concordia;
- Paso de los Libres;
- Monte Caseros;
- Federación;
- Salto Grande.

Para cada fecha se calculan mediana, mínimo y máximo diarios del nivel, lluvia diaria acumulada y cantidad de lecturas. La reconstrucción reproducible comienza en 2017, primer año completo disponible en estas estaciones. Cada actualización reemplaza los últimos 30 días para incorporar correcciones de la fuente.

Las alturas tienen ceros locales diferentes. No se restan entre sí ni se interpretan como elevaciones del terreno. En el modelo funcionan como estado y tendencia de cada estación.

## Cómo se forma el ensamble de 60 trayectorias

Para el día actual se construye un vector con:

- altura de Concordia;
- cambios locales de 1, 3, 7 y 14 días;
- variabilidad de los cambios diarios en la última semana;
- altura y cambios de Paso de los Libres y Monte Caseros;
- lluvia de 3 y 7 días en esas estaciones;
- altura, cambios y lluvia de 7 días en Federación y Salto Grande;
- componente estacional del día del año.

Las variables se normalizan con una escala robusta basada en el rango intercuartílico. La distancia es euclídea ponderada y exige al menos 65% de los predictores disponibles. Se seleccionan los 60 estados históricos más próximos y se les asigna un peso decreciente con la distancia.

Cada análogo aporta la trayectoria que realmente se observó en los 30 días posteriores. Esa trayectoria se traslada para que comience exactamente en la altura actual. El traslado conserva el cambio observado del episodio histórico y evita confundir los ceros locales.

## Línea central y banda

La banda comienza en los percentiles ponderados 10 y 90 de las 60 trayectorias. Después se aplica una corrección *split-conformal* estimada exclusivamente en el bloque temporal de calibración. El objetivo es una cobertura marginal de 80%; la cobertura realmente obtenida en el bloque final se publica por horizonte y puede diferir por cambio de régimen o dependencia temporal.

La línea punteada usa la mediana del ensamble en los horizontes donde reduce el error absoluto medio (MAE) al menos 3% frente a mantener constante la última altura observada. Si no alcanza esa mejora, usa persistencia. Entre los horizontes evaluados se interpola para evitar saltos artificiales.

Los límites no significan “máximo y mínimo posible”. Son una banda predictiva empírica. No incluyen todas las decisiones futuras posibles de operación de la represa ni eventos sin precedente en la serie.

## Probabilidad de superar un nivel

Para 11,00; 11,25; 11,50; 11,75; 12,00 y 12,25 m se evalúa el evento “alcanzar o superar el nivel al menos una vez dentro de 7, 14, 21 o 28 días”.

La frecuencia inicial es la suma de los pesos de los análogos cuyo máximo dentro del horizonte supera el nivel. El intervalo mostrado es un intervalo muestral de Wilson aplicado al tamaño efectivo del ensamble; no representa toda la incertidumbre del modelo.

Cuando una celda supera los controles de validación, la frecuencia y su intervalo se transforman mediante una regresión logística de Platt ajustada en un período separado. Cuando no los supera, se muestra la frecuencia ponderada original como **estimación exploratoria**: no se aplica una calibración que todavía no cuenta con evidencia suficiente. Esta decisión conserva el orden lógico entre niveles y horizontes y evita presentar como mejora una corrección inestable.

Una celda se considera **validada** si el bloque final contiene:

- al menos 80 orígenes semanales;
- al menos 10 eventos y 10 no-eventos;
- Brier Skill Score de 0,05 o más frente a la frecuencia del evento en el bloque de calibración;
- error de confiabilidad de 0,12 o menos.

Si falla cualquiera de estas condiciones, el porcentaje igualmente se muestra, pero se identifica de forma visible como **estimación exploratoria** y con confianza baja o muy baja. La tabla informa el tamaño de muestra, la cantidad de eventos y el Brier Skill Score. Mostrar el valor no implica afirmar que esté validado: permite seguir su evolución sin ocultar la limitación estadística.

## Validación temporal

Los orígenes históricos completos se dividen, sin mezclarlos aleatoriamente, en tres bloques consecutivos:

- 60% inicial: entrenamiento y biblioteca fija de análogos;
- 20% siguiente: calibración de probabilidades y corrección conformal;
- 20% final: evaluación fuera de muestra.

La evaluación usa un origen cada siete días para reducir la repetición de ventanas fuertemente solapadas. Se publican tamaño de muestra, MAE, MAE de persistencia, habilidad relativa, cobertura, ancho de banda, cantidad de eventos, Brier Score, Brier Skill Score y error de confiabilidad.

Esta es una validación empírica local, no una validación hidrodinámica. La serie aún es corta para demostrar desempeño en todos los niveles altos y no permite anticipar operaciones no anunciadas de Salto Grande.

## GEOGLOWS/ECMWF

Se descarga por separado el pronóstico de caudal de 51 miembros de [GEOGLOWS/ECMWF](https://geoglows.ecmwf.int/documentation) para el tramo fluvial identificado cerca de Concordia. Se muestran P10, mediana y P90 diarios hasta 15 días, siempre en m³/s.

No se convierte ese caudal en altura de Puerto Concordia: el punto está influido por la operación de la represa y todavía no existe un archivo local suficiente de repronósticos para validar una curva de transformación. El sistema guarda cada emisión para poder evaluar esa relación en el futuro.

## Mapa

El mapa usa cartografía de [OpenStreetMap](https://www.openstreetmap.org/copyright) y puntos georreferenciados de referencia, exposición, protección y cursos de agua. No dibuja áreas ni profundidades de inundación porque no se dispone todavía de una capa hidráulica local validada para cada altura.

## Actualización y archivo

GitHub Actions intenta consultar las fuentes cada hora. GitHub puede demorar una ejecución programada, por lo que la frecuencia es un objetivo y no una garantía al minuto. Cada corte conserva hora de observación, hora de recuperación, estado de la fuente, versión del modelo y métricas usadas para habilitar o rechazar cada probabilidad.

Los informes sólo comparan cortes producidos por la misma versión metodológica. No se mezclan en la tendencia los porcentajes exploratorios de versiones anteriores.
