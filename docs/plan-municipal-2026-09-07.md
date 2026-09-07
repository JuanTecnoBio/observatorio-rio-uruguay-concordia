# Evolución del observatorio hacia un servicio municipal

Fecha: 7 de septiembre de 2026. Municipio de referencia: Concordia, a confirmar
con el promotor. Estado: inicio de desarrollo y auditoría, no aceptación operativa.
Base examinada: `48402c32a31a2189123b57d0187ff85ff1f8e69a`.

## Propuesta concreta

Ofrecer un piloto y un servicio de apoyo a decisiones con mantenimiento,
trazabilidad y evaluación. Las capacidades predictivas comprometidas se deben
demostrar por horizonte y por tipo de evento. El panel es una parte del servicio:
también se necesitan conocimiento del riesgo, comunicación y capacidad de
respuesta. Esa organización coincide con los cuatro componentes de
[Early Warnings for All de la OMM](https://wmo.int/activities/early-warnings-all/wmo-and-early-warnings-all-initiative).

El alcance inicial es crecida fluvial del río Uruguay en Concordia. Inundación
pluvial urbana, arroyos y fallas de defensas requieren modelos y datos propios;
no se deducen automáticamente del nivel del puerto.

## Hallazgos verificables y primera corrección

| Hallazgo en la base examinada | Consecuencia | Trabajo en esta rama |
|---|---|---|
| Entrenamiento termina 10/10/2022 y calibración inicia 11/10/2022, pero las etiquetas abarcan 30 días; lo mismo ocurre entre calibración y evaluación | Solapamiento de información futura entre bloques | Se purgan 30 días de orígenes antes de cada frontera; siete pruebas de regresión incluyen fechas faltantes |
| El evento de superación usa `level_m`, que es mediana diaria | Puede omitir picos intradiarios | Trayectoria de máximos diarios separada de la trayectoria de medianas; rechazo de antecedentes sin máximos |
| Se muestran métricas del candidato calibrado junto a frecuencias sin esa calibración | El Brier visible no describe lo que el usuario recibe | Métricas de frecuencias publicadas y de calibración candidata separadas |
| `method.calibrated` y `method.validated` son siempre verdaderos | Metadatos contradicen las etiquetas exploratorias | Se derivan de los resultados realmente publicados |
| Orígenes cada siete días y análogos consecutivos | Varias fechas pueden describir la misma crecida | Se aclara «fechas con superación» y se agrega diagnóstico de ventanas no solapadas; no se atribuye independencia |
| Selección mediana/persistencia con el bloque final; reajuste operativo con una biblioteca distinta | Métrica retrospectiva no mide toda la selección y actualización operativa | Limitación explícita; no se otorga validación municipal automáticamente |

Las 24 probabilidades continúan visibles como exploratorias. No se crean cifras
de precisión para compensar poca evidencia. La versión candidata es
`ctm-analog-ensemble-v1.2-audit`. Los máximos son máximos **observados**: lecturas
faltantes aún pueden ocultar un pico real.

## Diagnóstico inicial con datos reales

Se conservaron los archivos públicos del corte del 07/09/2026 07:30:43 UTC−3.
La reproducción local usa el historial disponible de cinco estaciones, con 3.493
orígenes factibles; se purgan 60 y quedan 96 fechas de calibración y 100 de prueba.

| Horizonte | MAE del análogo | MAE de persistencia | Cobertura empírica de la banda objetivo 80% |
|---|---:|---:|---:|
| 1 día | 0,379 m | 0,401 m | 77% |
| 3 días | 0,582 m | 0,681 m | 90% |
| 7 días | 1,031 m | 1,118 m | 74% |
| 14 días | 1,671 m | 1,727 m | 90% |
| 21 días | 1,982 m | 1,987 m | 84% |
| 28 días | 2,207 m | 2,251 m | 77% |
| 30 días | 2,184 m | 2,369 m | 79% |

Son diagnósticos de medianas diarias, no garantías del pronóstico intradiario ni
del pico. No deben extrapolarse a crecidas extremas ni usarse como umbrales de
aceptación. A 11,50 m hay 3–6 fechas positivas según horizonte, pero sólo dos
ventanas positivas no solapadas en cada caso; tampoco esas dos ventanas prueban
dos eventos independientes. El período de prueba ha sido examinado: a partir de
ahora sirve para desarrollo, no como una nueva prueba externa intacta.

## Trabajo restante por orden de ejecución

### 1. Base de datos y continuidad del servicio

- Conservar observaciones brutas de 15 minutos y documentos originales, con
  identificador, unidad, cero de escala, hora observada, hora recibida y revisiones.
- Separar día cerrado de día parcial: el corte examinado incluye 29 muestras del
  día corriente frente a aproximadamente 96 por día completo. No son comparables
  sin una regla explícita de agregación y disponibilidad.
- Verificar con CTM qué representa el campo lluvia antes de sumarlo. Validar
  duplicados, saltos, faltantes, cambios instrumentales, cobertura y huso horario.
- Incorporar erogación, aportes y nivel del embalse a una base temporal coherente;
  inventariar restricciones y datos de operación accesibles. No anticipar una
  maniobra no anunciada como si fuera conocida.
- Archivar cada emisión original sin reescribirla al cambiar el modelo. Guardar
  código, parámetros, huellas de datos, miembros, tiempos válidos y condición de
  disponibilidad. Los informes reconstruidos deben identificarse como tales.
- Separar captura, cálculo y publicación. Incorporar monitoreo externo, detección
  de ejecuciones ausentes, reintentos, copia de respaldo, recuperación comprobada
  y un responsable de incidentes. Un cron de GitHub no constituye un SLA.
- Evaluar antigüedad contra el reloj actual, no sólo contra la hora del JSON:
  en el código auditado la etiqueta de frescura usa la segunda y puede congelarse.
  Si no se actualiza el modelo, conservar su hora original y rotularlo vencido.

Aceptación: cada dato y emisión es trazable, se ensayan fuente caída y proceso
detenido, y la interfaz distingue observación vigente, parcial, vencida y ausente.
La tolerancia temporal por fuente se acuerda según la decisión que debe apoyar.

### 2. Pronósticos separados por escala

| Producto | Datos y estrategia a evaluar | Uso previsto |
|---|---|---|
| Horas a 72 h | Observación intradiaria, partes CTM, erogación, embalse, propagación y corrección de errores | Preparación operativa de corto plazo |
| 3–15 días | Lluvia por ensamble en subcuencas, humedad/estado antecedente, aportes y escenarios explícitos de operación | Anticipación con incertidumbre |
| 15–30 días | Ensambles hidrológicos externos y antecedentes, condicionados a habilidad local demostrada | Escenarios de planificación; evitar falsa precisión diaria |
| 1–3 meses | ENOS y perspectivas climáticas oficiales con fecha y vigencia | Preparación de recursos y escenarios estacionales |

El diagnóstico [NOAA CPC del 13/08/2026](https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso_advisory/ensodisc.shtml)
informa un fortalecimiento de El Niño. Eso no determina por sí solo la altura
local ni autoriza a trasladar probabilidades ENOS a probabilidades de inundación.
Registrar cada boletín climático, contrastar perspectivas regionales y preservar
su escala temporal; no extrapolar una curva de nivel a meses.

Fuentes prioritarias verificadas para la siguiente integración:
[CTM](https://www.saltogrande.org/datos_hidrologicos.php),
[INA](https://www.ina.gov.ar/alerta/),
[SMN](https://www.argentina.gob.ar/smn) y
[ECMWF EFAS/GloFAS](https://www.ecmwf.int/en/research/projects/efas).
La existencia del producto no implica disponibilidad de API, licencia comercial,
serie histórica local ni habilidad aguas abajo de una represa: documentar cada
condición antes de incorporarlo al servicio. No sumar GEOGLOWS y GloFAS como si
fueran evidencias independientes sin estudiar forzantes compartidos.

Comparar primero persistencia, tendencia amortiguada, regresión dinámica con
retardos y análogos. Evaluar después modelos de árboles por cuantiles o híbridos
de propagación y corrección residual. Una red neuronal sólo se justifica si mejora
resultados con la misma información y prueba temporal. La literatura de
[repronósticos hidrológicos de ensamble](https://hess.copernicus.org/articles/27/1/2023/)
ofrece una referencia para evaluación probabilística y uso de archivos retrospectivos.

### 3. Evaluación independiente del procedimiento completo

- Definir emisión, tiempo de llegada, pico, duración y evento antes de ajustar.
  Separar «ya supera el umbral» de «cruzará desde abajo», porque lo primero no
  demuestra anticipación.
- Ajustar transformaciones, variables, modelo y calibración en validación interna
  temporal con purga. Evaluar el procedimiento completo en bloques externos por
  episodios/años, reproduciendo el reajuste que operaría en cada emisión.
- Identificar crecidas independientes mediante una regla hidrológica documentada;
  analizar sensibilidad a la separación elegida. Usar remuestreo por episodio para
  intervalos de métricas. Las ventanas no solapadas son sólo un diagnóstico previo.
- Medir MAE y sesgo por horizonte, error del pico y hora del pico, CRPS o interval
  score, cobertura y ancho, Brier y confiabilidad. Comparar con persistencia,
  referencia estacional y pronóstico oficial cuando exista archivo comparable.
- Medir tiempo útil de anticipación, crecidas omitidas, falsas alarmas y duración
  de alertas; evaluar el beneficio/costo de cada acción con el municipio.
- Congelar una versión para evaluación prospectiva en paralelo. Si el piloto no
  atraviesa crecidas, sólo acredita operación del servicio; no valida extremos.

Aceptación predictiva: criterios por horizonte acordados **antes** de la prueba,
con incertidumbre de las métricas y revisión hidrológica independiente. Un 3% de
mejora global o un BSS positivo aislado no son criterios suficientes.

### 4. Impactos, acciones y experiencia municipal

- Obtener cartografía local, topografía y referencia vertical compatibles con la
  escala del puerto; capas de defensas, drenajes, caminos y equipamiento crítico.
- Usar mapas hidráulicos oficiales existentes o desarrollar un modelo apropiado
  con topografía, geometría y calibración de crecidas. Un DEM global y una altura
  del puerto no bastan para delimitar inundación confiable por parcela.
- Con el municipio, relacionar rangos de nivel con exposición verificada y medidas:
  responsables, recursos, plazo de preparación, confirmación y cierre. Separar
  exposición de vulnerabilidad y de daño esperado.
- Pantalla de guardia: dato y parte vigentes, tendencia, riesgo por horizonte,
  incertidumbre, decisiones pendientes y motivo de cualquier degradación.
- Parte diario y extraordinario: qué cambió, escenarios, sectores a revisar y
  acciones acordadas. Alertas emitidas por responsables habilitados, con registro
  y acuse; no automatizar comunicaciones masivas desde un modelo exploratorio.
- Acceso restringido para domicilios, personas y recursos sensibles; publicar sólo
  capas y resúmenes apropiados para el portal abierto.

## Piloto, equipo y oferta

Propuesta de trabajo: relevamiento y base confiable, después prueba retrospectiva,
luego operación en paralelo y simulacro. El calendario depende del acceso a datos
y del alcance territorial; no fijar fecha de validación de extremos por calendario.
Definir interlocutor municipal, referente de Defensa Civil, revisión hidrológica,
GIS/topografía y mantenimiento de software. La IA puede programar y probar; la
aceptación hidrológica y la autoridad de respuesta necesitan responsables humanos.

La oferta puede separar implementación/piloto, integración cartográfica y abono
de operación/mantenimiento. Acordar cobertura horaria, tiempos de atención,
entregables, exclusiones, propiedad/portabilidad de datos y criterios de aceptación
antes de cotizar el servicio operativo. No presupuestar capacidades de predicción
todavía no demostradas como ya disponibles.

Datos que se pedirán al municipio: jurisdicción y alcance exactos, decisiones
prioritarias y anticipación mínima útil, protocolos/umbrales y quién los aprueba,
antecedentes de crecidas y afectaciones, cartografía disponible, recursos y
responsable de guardia. Este relevamiento no bloquea la auditoría de código.

## Reproducción y continuación con Codex o Claude Code

```bash
python -m unittest discover -s tests -p 'test_*.py' -v
python scripts/replay_municipal_audit.py --output docs/audit-replay-2026-09-07.json
```

El JSON conserva huellas SHA-256 de los datos y del código; no actualiza ni
reescribe `public/data`. Usar la revisión base indicada para reproducir este corte;
una fecha nueva debe producir un informe nuevo.

Primera tarea siguiente para un agente de programación: implementar archivo
inmutable de emisiones y un control de antigüedad independiente del éxito HTTP,
con reloj inyectable y pruebas de fuente caída, fuente que repite datos y modelo
sin recalcular. Trabajar en rama, conservar las probabilidades exploratorias,
separar emisión histórica de reconstrucción y no cambiar el método para mejorar
una métrica ya observada. Entregar diff, casos reproducibles y limitaciones.
Después implementar evaluación temporal por crecidas con selección interna.
No hay una sesión de Claude Code ejecutándose desde este entorno.
