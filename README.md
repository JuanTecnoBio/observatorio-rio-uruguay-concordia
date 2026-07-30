# Observatorio del Río Uruguay — Concordia

Sitio público para seguir el nivel del río, las señales de la cuenca y un
escenario experimental de 30 días. La portada combina un mapa del corredor local,
la curva observada y una banda mínima–máxima que explicita cómo aumenta la
incertidumbre.

Los datos oficiales y el escenario experimental están separados. El sitio no
publica probabilidades hasta contar con calibración y validación suficientes.

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
```

## Actualización automática

El workflow `.github/workflows/update-and-deploy-pages.yml` se ejecuta cada tres
horas y también admite ejecución manual. Consulta:

- PNA: alturas, variaciones, tendencias y umbrales.
- CTM: datos horarios de explotación.
- CTM: comunicado hidrológico de corto plazo.
- CTM: precipitación GFS publicada para la cuenca.

El adaptador `scripts/update_data.py` conserva el último dato conocido cuando una
fuente falla, pero lo marca como copia desactualizada y publica el error. Nunca
presenta silenciosamente un valor viejo como actual.

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

## Límites del escenario

No se calculan profundidades de inundación. No se comparan alturas entre ceros locales. No se publican probabilidades ni cuantiles sin calibración. El sitio no emite órdenes de evacuación.
