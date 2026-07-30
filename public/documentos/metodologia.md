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

## 5. Pronóstico

El sistema no publica percentiles ni probabilidades de superación porque aún no existe un conjunto histórico integrado y una validación temporal por horizonte. La habilitación requiere:

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

El corte inicial usa PNA para alturas y umbrales, CTM para operación, aportes y comunicado, y enlaces de continuidad a SMN, CARU y SNIH. Todo valor publicado conserva fecha, hora, unidad y URL de referencia.

## 8. Actualización

La versión inicial es un corte verificable. No mantiene valores viejos como si fueran actuales. La automatización posterior deberá marcar datos vencidos, conservar el original cuando la licencia lo permita y registrar hash, ejecución y cambios de plantilla.
