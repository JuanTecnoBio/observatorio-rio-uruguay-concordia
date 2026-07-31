# Metodología, calidad y límites

## 1. Jerarquía de evidencia

1. observación oficial;
2. comunicado o pronóstico oficial;
3. pronóstico experimental propio validado;
4. escenario hipotético;
5. reporte ciudadano moderado.

La interfaz conserva estas categorías y nunca convierte silenciosamente una en otra.

## 2. Alturas y datums

Las alturas de los puertos se refieren a ceros locales. La cota del embalse, la cota de restitución, la elevación de un modelo digital y la profundidad de inundación son magnitudes distintas. En esta versión no se calcula profundidad ni extensión a partir de una resta entre altura portuaria y terreno.

## 3. Riesgo

La categoría preliminar del observatorio combina:

- distancia a alerta y evacuación;
- tendencia local;
- vigencia del parte oficial;
- erogación informada;
- señales aguas arriba;
- exposición general conocida;
- calidad y antigüedad del dato.

La categoría es propia y debe mostrarse separada del estado oficial.

## 4. Incertidumbre

- Baja: observación reciente y consistente.
- Moderada: pronóstico oficial de corto plazo con alguna antigüedad.
- Alta: existen forzantes meteorológicos, pero no traducción local validada a nivel.
- Muy alta: horizonte sin habilidad cuantitativa demostrada.

## 5. Pronóstico e informes por nivel

El escenario hidrológico no publica percentiles ni probabilidades calibradas de superación porque aún no existe un conjunto histórico integrado y una validación temporal por horizonte.

Los informes permiten evaluar 11,00; 11,25; 11,50; 11,75; 12,00 y 12,25 m. Incluyen porcentajes para comparar cortes y niveles. Son una **estimación exploratoria estructurada**, no una frecuencia estadística ni un producto oficial.

La versión `expert-anchored-multithreshold-v0.2` conserva 11,50 m como umbral de referencia. Para los demás niveles aplica una transformación monótona en escala logit: dentro de un mismo corte y horizonte, la estimación de alcanzar un nivel más bajo nunca puede ser menor que la de alcanzar uno más alto. El cálculo aplica además siempre el mismo ajuste según:

- la altura observada en Puerto Concordia;
- el límite superior del escenario para 7, 14, 21 y 28 días;
- una amplitud creciente del intervalo plausible;
- la incertidumbre asignada a cada horizonte.

Cada actualización guarda los seis niveles en un único corte temporal. La interfaz muestra el valor vigente, el archivo y la evolución por horizonte para el nivel seleccionado. La habilitación futura como pronóstico probabilístico requiere:

1. series históricas auditadas;
2. backtesting con origen móvil;
3. comparación con persistencia;
4. evaluación por 1–3, 4–7, 8–15 y 16–30 días;
5. cobertura y ancho de intervalos;
6. Brier Score y confiabilidad para umbrales;
7. prueba específica en crecidas;
8. model card y versión reproducible.

## 6. Escenarios

Los escenarios seco, base, húmedo y de erogación alta son cualitativos. No anticipan decisiones de CTM ni generan una cota hasta que exista un motor calibrado. Su función es ordenar preguntas y acciones preventivas.

## 7. Fuentes

El corte inicial usa PNA para alturas y umbrales, CTM para la estación Puerto Concordia cada 15 minutos, operación, aportes y comunicado, y enlaces de continuidad a SMN, CARU y SNIH. Las lecturas de PNA y CTM se identifican como fuentes distintas: nunca se fusionan silenciosamente. Todo valor publicado conserva fecha, hora, unidad y URL de referencia.

Cuando el comunicado diario de CTM publica solo una cota máxima para Concordia, la interfaz muestra únicamente ese máximo. No completa el parte con una mínima inferida.

## 8. Actualización

La automatización intenta consultar las fuentes cada hora. GitHub puede demorar el inicio de una ejecución programada, por lo que esa frecuencia es un objetivo de consulta y no una garantía al minuto. El sistema reintenta fallas transitorias, marca por separado las fuentes que no responden y conserva el último valor verificable con su fecha original y un indicador visible de antigüedad. Cada ejecución genera un corte del informe y mantiene hasta 240 cortes recientes. Cuando el archivo nace o se reconstruye, recupera estados reales del historial Git en lugar de inventar observaciones anteriores.
