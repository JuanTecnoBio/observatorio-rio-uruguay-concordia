# Registro de decisiones

## D-001 — Arquitectura inicial

**Fecha:** 29/07/2026  
**Decisión:** sitio estático interactivo con archivos JSON públicos.  
**Fundamento:** rapidez, bajo costo, auditabilidad, buena operación móvil y ausencia de necesidad inmediata de almacenar datos personales.

## D-002 — Datos actuales

**Decisión:** usar PNA para altura y umbrales de Concordia; CTM para operación, aporte y pronóstico oficial.  
**Fundamento:** fuentes oficiales primarias y disponibles.

## D-003 — Probabilidades

**Decisión:** no publicar probabilidades de superar 11,00 m o 12,50 m.  
**Fundamento:** falta de calibración histórica y validación temporal por horizonte.

## D-004 — Horizonte 1–30 días

**Decisión:** mantener el selector completo, habilitar el rango oficial sólo dentro de su vigencia y mostrar incertidumbre y ausencia de habilidad cuantitativa para el resto.  
**Fundamento:** responder al objetivo sin falsa precisión.

## D-005 — Mapa

**Decisión:** mostrar referencias públicas con OpenStreetMap y no generar extensión ni profundidad de inundación.  
**Fundamento:** no se dispone todavía de transformación vertical, modelo hidráulico y capas oficiales validadas.

## D-006 — Reportes ciudadanos

**Decisión:** no habilitar envío público en la primera versión.  
**Fundamento:** requiere moderación, privacidad, protección frente a abuso y responsable institucional.

## D-007 — Riesgo

**Decisión:** clasificar el corte como vigilancia y aclarar que no es categoría oficial.  
**Fundamento:** nivel estable bajo alerta, parte CTM bajo umbral, erogación alta y señal aguas arriba en Paso de los Libres.

## D-008 — Ensamble local y probabilidades

**Fecha:** 31/07/2026

**Decisión:** reemplazar las fórmulas expertas por 60 análogos de la red CTM 2017–presente; separar entrenamiento, calibración y validación final; aplicar corrección conformal a la banda y calibración de Platt a cada probabilidad.
**Fundamento:** las cifras deben derivar de resultados históricos observados y sólo publicarse cuando demuestren habilidad fuera de muestra. Una celda requiere 80 casos semanales, 10 eventos y 10 no-eventos, BSS ≥ 0,05 y error de confiabilidad ≤ 0,12.

## D-009 — Señal GEOGLOWS

**Decisión:** mostrar y archivar el ensamble de caudal GEOGLOWS/ECMWF en m³/s, separado de la altura local.
**Fundamento:** aporta información meteorológica e hidrológica de 15 días, pero convertirla en altura de Concordia sin repronósticos y validación local generaría falsa precisión en un tramo regulado.

## D-010 — Cartografía

**Decisión:** sustituir el esquema decorativo por un mapa OpenStreetMap interactivo con puntos georreferenciados.
**Fundamento:** el esquema anterior no permitía orientarse. Se mantienen fuera las manchas de inundación hasta contar con una capa hidráulica validada.
