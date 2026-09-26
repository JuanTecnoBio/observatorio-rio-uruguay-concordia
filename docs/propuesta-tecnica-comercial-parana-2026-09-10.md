# Sistema municipal de apoyo a la prevención hidrológica

## Propuesta técnica y modelo de servicio para la Municipalidad de Paraná

**Fecha de referencia:** 10 de septiembre de 2026
**Estado:** propuesta para descubrimiento y piloto; no constituye todavía un sistema operativo aceptado por la Municipalidad de Paraná.

## Resumen ejecutivo

Se propone adaptar la experiencia del Observatorio del río Uruguay a un servicio
específico para Paraná. No se traslada el modelo de Concordia: el río, la red de
estaciones, los tiempos de propagación, las referencias verticales y los impactos
urbanos son distintos. La primera tarea es construir y evaluar un modelo local con
datos disponibles al momento de cada emisión.

El producto no será solamente una página. Será un servicio de apoyo a decisiones
para Defensa Civil y las áreas municipales que integre observación, pronóstico
oficial, modelos comparados, incertidumbre, impactos, protocolos y registro de cada
emisión. El sistema no emitirá por sí solo una orden de evacuación. La autoridad y
la decisión continúan en responsables municipales identificados.

Al 10/09/2026 el INA informa para la estación Paraná 2,30 m y publica como
referencias 4,70 m de alerta y 5,00 m de evacuación. Esos valores sirven para el
relevamiento inicial y deben ser confirmados formalmente por el municipio antes de
configurar reglas operativas. El INA actualiza sus pronósticos del tramo medio los
martes y viernes. El servicio municipal debe preservarlos, compararlos con cada
observación posterior y mostrar con claridad su vigencia.

La existencia de El Niño justifica fortalecer la preparación, no permite deducir
por sí sola una altura local. El boletín NOAA CPC del 10/09/2026 indica que El Niño
se está fortaleciendo y asigna más de 90% de probabilidad a un evento muy fuerte
durante el otoño e invierno boreal 2026-27. Esa señal se utilizará para escenarios
estacionales y planificación de recursos, separada del pronóstico hidrométrico de
horas o días.

## Qué es realmente el producto después de las mejoras

La versión candidata del observatorio es un sistema experimental y auditable de
monitoreo y pronóstico probabilístico. En la ruta de cálculo no interviene un LLM.
El modelo actual de Concordia es un ensamble de análogos: encuentra estados
hidrométricos históricos similares, recupera sus trayectorias posteriores y calcula
una mediana, una banda y frecuencias ponderadas de superación de umbrales.

Las mejoras realizadas en la rama de revisión corrigen filtraciones temporales
entre entrenamiento y evaluación, usan máximos diarios para estudiar superaciones,
separan el indicador que se muestra de una calibración candidata y evitan declarar
validación cuando no existe. También agregan:

- archivo mensual de cada emisión en formato JSONL, encadenado con SHA-256 y con
  rechazo de reescritura de una emisión ya registrada;
- huella de validación, miembros, pesos, observación usada, fuentes, proyección y
  probabilidades en cada registro;
- control de antigüedad contra el reloj real del usuario, separado para observación
  y escenario;
- conservación de la hora de la última emisión si el modelo no logra recalcularse;
- diez pruebas del núcleo y de integridad, lint y dos compilaciones de producción.

El diagnóstico reproducible de Concordia muestra una mejora de error absoluto
medio frente a persistencia de 5,5% a un día, 14,5% a tres días, 7,8% a siete días
y 3,2% a catorce días. A 21 y 28 días no alcanza la mejora mínima adoptada y el
centro utiliza persistencia. La cobertura de la banda objetivo de 80% varía entre
74% y 90% según horizonte. Estos resultados son diagnósticos retrospectivos de
medianas diarias, no certifican picos ni desempeño municipal.

Las probabilidades continúan visibles porque son útiles como estimación. Se rotulan
**exploratorias** cuando falta evidencia. Para el umbral de 11,50 m de Concordia,
el bloque final contenía sólo 3 a 6 fechas positivas según horizonte y dos ventanas
positivas no solapadas. Por eso el porcentaje no puede presentarse como una
frecuencia de inundaciones validada.

La IA generativa puede ayudar a desarrollar código, redactar borradores o resumir
informes bajo revisión. No debe calcular el nivel, modificar probabilidades,
autorizar alertas ni comunicarse automáticamente con la población.

## Límites actuales que la propuesta no oculta

- El modelo y las métricas actuales corresponden a Concordia y no sirven como
  validación para Paraná.
- El conjunto final ya fue examinado durante esta auditoría. Una versión posterior
  necesita prueba prospectiva congelada o un nuevo período externo.
- El histórico actual no acredita suficientes crecidas independientes para validar
  extremos raros.
- Un proceso horario de GitHub y un archivo público no constituyen un SLA ni un
  repositorio municipal con controles de acceso, respaldo y restauración.
- El mapa actual marca referencias; no es una mancha de inundación hidráulicamente
  validada.
- Las fuentes externas pueden cambiar, corregir datos o interrumpirse. El sistema
  debe mostrar esa degradación y conservar el último dato con su fecha original.

## Diseño propuesto para Paraná

### 1. Observación y fuente oficial

Integrar y conservar, con hora observada y hora recibida, la estación Paraná y las
estaciones relevantes aguas arriba y aguas abajo. La red inicial a evaluar incluye
Corrientes, Barranqueras, Goya, Reconquista, La Paz, Paraná, Santa Fe, Victoria y
Rosario, junto con caudales y operación de Yacyretá cuando sean accesibles. El INA
será referencia nacional; SMN aportará observación y pronóstico meteorológico. Los
productos ECMWF/GloFAS se incorporarán como ensamble externo sólo después de
verificar identificadores, licencia, latencia y habilidad local.

Cada captura conservará dato bruto, unidad, estación, referencia vertical, calidad,
fuente, versión y correcciones. Una fuente caída nunca se reemplazará con un valor
sin fecha ni se presentará como vigente.

### 2. Modelos por horizonte

| Horizonte | Modelos candidatos | Producto |
|---|---|---|
| 0–72 horas | persistencia, tendencia amortiguada, propagación/función de transferencia, corrección de error del pronóstico oficial | nivel y cruce de umbral con actualización frecuente |
| 3–15 días | modelo dinámico con retardos, ensamble de análogos, árboles por cuantiles y ensambles meteorológicos/hidrológicos | escenarios probabilísticos y tiempo útil |
| 15–30 días | pronóstico oficial, GloFAS y escenarios condicionados, sólo si el repronóstico demuestra habilidad | planificación con baja resolución temporal |
| 1–3 meses | perspectivas INA/SMN/NOAA y estado antecedente de la cuenca | escenarios estacionales, sin convertir ENOS directamente en metros |

No se seleccionará el modelo por prestigio o complejidad. Para cada horizonte se
comparará contra persistencia, tendencia y climatología. Se usarán validación
temporal con purga, bloques por episodio y reproducciones que sólo admitan la
información disponible en la fecha histórica de emisión. Si un método más simple
gana, ése será el que se muestre.

Las probabilidades de cruce de alerta y evacuación se evaluarán con Brier Score,
Brier Skill Score, confiabilidad y resolución; las bandas con interval score,
cobertura y ancho; la trayectoria con MAE, sesgo, error de pico y error en la hora
del pico. También se medirán falsas alarmas, crecidas omitidas y horas de
anticipación útil para cada acción municipal.

### 3. Impactos y protocolos

El nivel del puerto no describe por sí solo una calle o un barrio. Se deben acordar
con Defensa Civil los sectores, activos críticos, drenajes, defensas, caminos y
acciones que interesan. Una capa de inundación requiere cartografía, topografía,
referencias verticales compatibles y un estudio hidráulico validado. Hasta disponer
de esa evidencia, el mapa mostrará puntos y exposición verificada, no polígonos
supuestos.

Cada rango de riesgo se vinculará con una matriz de acción: responsable, plazo,
recursos, condición de inicio, confirmación y cierre. El panel de guardia mostrará
qué cambió, cuál es la incertidumbre, qué fuente está demorada y qué decisión está
pendiente. Las alertas externas tendrán aprobación humana, registro y acuse.

### 4. Operación y auditoría

La versión municipal separará captura, cálculo, publicación y notificación. Tendrá
monitoreo externo, alertas por ejecución ausente, reintentos, almacenamiento
administrado, respaldo, restauración ensayada y bitácora de incidentes. Cada
pronóstico conservará código, parámetros, huellas de datos, miembros y resultado
tal como se emitió. Los informes reconstruidos se marcarán como reconstrucciones.

## Relación con el software que Paraná ya posee

El 4/08/2026 se informó públicamente que Paraná incorporó software para monitorear
tormentas e inundaciones en tiempo real. Antes de diseñar pantallas o notificaciones
se debe relevar su nombre, proveedor, datos, API, cobertura, alertas, licencias y
responsable operativo.

La propuesta se vende como integración y capacidad faltante: archivo de pronósticos
fluviales, comparación sistemática con INA, modelos locales evaluados, traducción a
acciones, auditoría y mantenimiento. Si el sistema municipal ya resuelve alguno de
estos puntos, se integra y se elimina la duplicación del alcance.

## Plan de implantación y aceptación

| Etapa | Duración estimada | Entregables | Puerta de aceptación |
|---|---:|---|---|
| 0. Descubrimiento | 3 semanas | inventario de sistema actual, fuentes, decisiones, estaciones, umbrales, cartografía y protocolo; arquitectura y matriz de riesgos | acta de alcance y responsables; umbrales confirmados |
| 1. Base e integración | 5 semanas | almacén histórico, conectores, calidad, panel de observación, estado de fuentes y archivo de emisiones | trazabilidad de extremo a extremo; pruebas de caída y recuperación |
| 2. Modelos y evaluación | 6 semanas | referencias, modelos candidatos, repronóstico, métricas por horizonte y protocolo de versión | revisión hidrológica; criterios predictivos acordados antes de la prueba |
| 3. Piloto paralelo | 12 semanas | emisiones regulares, partes de guardia, tablero de verificación, simulacro y reporte final | continuidad, simulacro y decisión documentada de pase a operación |

Si durante el piloto no ocurre una crecida relevante, se podrá aceptar continuidad,
trazabilidad y preparación operativa, pero no declarar validado el desempeño en
extremos. El contrato no debe incentivar ocultar esta diferencia.

### Indicadores contractuales sugeridos

- 100% de las emisiones efectuadas conservadas con huella verificable.
- Observación y pronóstico siempre acompañados por fuente, vigencia y antigüedad.
- Detección de una ejecución ausente dentro de 15 minutos de la tolerancia acordada.
- Disponibilidad mensual de la plataforma de 99,0% en el plan base y 99,5% en el
  plan ampliado, excluyendo indisponibilidad declarada de fuentes externas.
- RTO de cuatro horas y RPO de una hora para el plan base; valores menores se
  cotizan con infraestructura y guardia acordes.
- Simulacro de fuente caída, dato congelado, modelo fallido y restauración.
- Reporte mensual de exactitud, falsas alarmas, omisiones y anticipación; comparación
  con referencias y pronóstico oficial donde exista archivo comparable.

## Modelo de negocio recomendado

El producto debe ofrecerse como **implantación más servicio anual**, no como venta
aislada de una página. El valor recurrente está en mantener fuentes, modelos,
protocolos, evaluación y operación.

### Oferta de entrada

**Programa municipal de implantación y piloto de seis meses: USD 27.500** como referencia comercial, facturable
en pesos al tipo de cambio vendedor del Banco Nación de la fecha de factura, más
impuestos aplicables.

| Hito | Pago | Contenido |
|---|---:|---|
| Inicio y acta de alcance | 30% | descubrimiento, responsables, acceso y arquitectura |
| Base integrada y primer repronóstico | 40% | datos, tablero, archivo, modelos y evaluación preliminar |
| Piloto, simulacro e informe final | 30% | operación paralela, capacitación y recomendación de continuidad |

El precio incluye desarrollo, integración de fuentes públicas accesibles, tablero,
archivo de emisiones, evaluación retrospectiva, 90 días de operación paralela,
dos talleres y un simulacro. No incluye sensores y telemetría de campo, vuelos,
levantamiento topográfico, modelación hidráulica 2D, mensajería masiva paga,
licencias de terceros ni guardia humana 24×7.

### Servicio posterior

| Plan | Precio de referencia | Cobertura |
|---|---:|---|
| Operación base | USD 24.000/año | plataforma 99,0%, mantenimiento de conectores/modelos, soporte hábil, reporte mensual y dos simulacros anuales |
| Operación ampliada | USD 42.000/año | plataforma 99,5%, guardia técnica 24×7 para incidentes críticos, escalamiento, reportes por evento y cuatro simulacros anuales |

La autoridad municipal conserva los datos operativos y sus decisiones. La oferta
recomendada concede una licencia no exclusiva de uso del software durante el
contrato, exportación completa de datos y documentación. Una transferencia total
del código, despliegue en infraestructura municipal o depósito de fuente se cotiza
como modalidad adicional porque cambia soporte, seguridad y responsabilidad.

### Estructura económica y expansión

El objetivo es mantener costo directo total por debajo de 65–70% del ingreso:
ingeniería y datos 35–40%, revisión hidrológica y GIS 15–20%, operación e
infraestructura 5–10% y gestión/capacitación 10–15%. El margen restante financia
continuidad, garantías y evolución.

Después de validar el núcleo en Paraná, conectores, archivo, observabilidad y marco
de evaluación pueden reutilizarse en otros municipios. Cada localidad requiere su
propia configuración, datos, validación e impactos; no se comercializa la misma
probabilidad cambiando el nombre de la estación.

## Responsabilidades

**Proveedor:** ingeniería de datos y software, operación acordada, evaluación,
documentación, trazabilidad, seguridad del servicio y comunicación de incidentes.

**Especialista hidrológico independiente:** revisión de series, episodios, método,
resultados y limitaciones. Su conformidad es condición de la etiqueta operativa.

**Municipalidad:** designar propietario del proceso, facilitar el sistema existente,
confirmar umbrales y protocolos, aportar cartografía y antecedentes, autorizar
comunicaciones y participar en simulacros.

**Organismos oficiales:** continúan siendo autores de sus observaciones, pronósticos
y avisos. El producto los integra y preserva; no los sustituye.

## Fuentes consultadas

1. INA, *Reporte hidrometeorológico diario de la Cuenca del Plata*, actualización
   10/09/2026: https://alerta.ina.gob.ar/a5/diario/reporte_diario
2. Instituto Nacional del Agua, servicios institucionales:
   https://www.argentina.gob.ar/ina
3. NOAA Climate Prediction Center, *ENSO Diagnostic Discussion*, 10/09/2026:
   https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso_advisory/ensodisc.shtml
4. OMM, *Early Warnings for All*:
   https://wmo.int/activities/early-warnings-all/wmo-and-early-warnings-all-initiative
5. ECMWF, EFAS y GloFAS: https://www.ecmwf.int/en/research/projects/efas
6. Harrigan et al., repronósticos diarios de caudal GloFAS, HESS 27 (2023):
   https://hess.copernicus.org/articles/27/1/2023/
7. Elonce, *Paraná incorporó un software para monitorear tormentas e inundaciones
   en tiempo real*, 4/08/2026:
   https://www.elonce.com/videos/1153708-parana-incorporo-un-software-para-monitorear-tormentas-e-inundaciones-en-tiempo-real.htm
