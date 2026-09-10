# Observatorio del Río Uruguay — Concordia

Sitio público para seguir el nivel del río, las señales de la cuenca y un
escenario experimental de 30 días. La portada combina un mapa OpenStreetMap con
puntos georreferenciados, la curva observada y una banda predictiva construida a
partir de 60 trayectorias históricas análogas (pueden compartir una crecida).

Los datos oficiales y el escenario experimental están separados. Cada
probabilidad se publica con su evidencia por nivel y horizonte. En la versión
`v1.2-audit` se mantiene como exploratoria: falta evaluación por crecidas y
reproducción operativa. No se ocultan las estimaciones ni se afirma validación municipal.

El plan de evolución y los hallazgos de septiembre están en
[`docs/plan-municipal-2026-09-07.md`](docs/plan-municipal-2026-09-07.md).

## Ejecutar

```bash
npm install
npm run dev
```

## Validar

```bash
npm run lint
npm test
npm run build:pages
python -m unittest discover -s tests -p 'test_*.py' -v
```

## Actualización automática

El workflow `.github/workflows/update-and-deploy-pages.yml` intenta ejecutarse a
los 23 minutos de cada hora y también admite ejecución manual. Consulta:

- PNA: alturas, variaciones, tendencias y umbrales.
- CTM: datos horarios de explotación.
- CTM: comunicado hidrológico de corto plazo.
- CTM: precipitación GFS publicada para la cuenca.
- CTM: histórico diario derivado de cinco estaciones de 15 minutos.
- GEOGLOWS/ECMWF: ensamble de caudal a 15 días, conservado en unidades de caudal.

El adaptador `scripts/update_data.py` conserva el último dato conocido cuando una
fuente falla, pero lo marca como copia desactualizada y publica el error. Nunca
presenta silenciosamente un valor viejo como actual.

Cada escenario recalculado se registra en un archivo mensual JSONL encadenado
con SHA-256. La interfaz calcula la antigüedad contra el reloj del usuario, por lo
que un archivo congelado deja de verse como vigente aunque su último proceso haya
terminado correctamente. Este archivo transparente es la base del piloto; una
operación municipal debe replicarlo en almacenamiento administrado.

Para probar el adaptador:

```bash
python -m pip install -r scripts/requirements-update.txt
python scripts/update_data.py
```

## GitHub Pages

1. Crear un repositorio público y subir este proyecto a la rama `main`.
2. En **Settings → Pages → Build and deployment**, elegir **GitHub Actions**.
3. Ejecutar el workflow **Actualizar datos y publicar**.

La ruta base se calcula a partir del nombre del repositorio, por lo que funciona
tanto en un proyecto `usuario.github.io` como en una página de proyecto.

## Fuentes prioritarias

- Prefectura Naval Argentina: altura, tendencia y umbrales.
- CTM Salto Grande: operación, embalse, aporte y comunicado oficial.
- CARU, SMN y SNIH: pendientes de automatización o integración completa.

## Modelo y límites

El motor `scripts/forecast_model.py` usa bloques temporales 60/20/20 para
entrenamiento, calibración y evaluación, con una purga de 30 días en las fronteras
para impedir que las etiquetas futuras invadan el siguiente bloque. La superación
se evalúa con máximos diarios, no con medianas. La banda P10–P90 se corrige por
split conformal y la línea central sólo conserva la mediana del ensamble cuando
mejora al menos 3% el MAE de persistencia. La descripción reproducible completa
está en `public/documentos/metodologia.md`.

No se calculan profundidades de inundación. No se comparan alturas entre ceros
locales. GEOGLOWS no se transforma en altura sin validación local. El sitio no
emite órdenes de evacuación.
