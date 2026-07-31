#!/usr/bin/env python3
"""Reconstruye el historial diario reproducible de la red hidrométrica CTM.

La descarga se hace por meses porque el servicio CSV público limita el rango de
consulta. El archivo resultante conserva únicamente agregados diarios y evita
publicar las decenas de miles de observaciones de quince minutos.
"""

from __future__ import annotations

import argparse
import calendar
import csv
import io
import json
import statistics
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public" / "data" / "hydrometric_history.json"
CTM_CSV = "https://www.saltogrande.org/datos_estacion_csv.php"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0 Safari/537.36"
)
STATIONS = {
    "concordia": {
        "id": "A50012EE",
        "name": "Puerto Concordia",
        "role": "target",
    },
    "paso_libres": {
        "id": "A5004292",
        "name": "Paso de los Libres",
        "role": "upstream",
    },
    "monte_caseros": {
        "id": "A50C9566",
        "name": "Monte Caseros",
        "role": "upstream",
    },
    "federacion": {
        "id": "A5004C40",
        "name": "Federación",
        "role": "reservoir_margin",
    },
    "salto_grande": {
        "id": "A5002774",
        "name": "Salto Grande",
        "role": "reservoir",
    },
}


def month_sequence(start_year: int, end: date) -> list[tuple[int, int]]:
    result: list[tuple[int, int]] = []
    year, month = start_year, 1
    while (year, month) <= (end.year, end.month):
        result.append((year, month))
        month += 1
        if month == 13:
            month = 1
            year += 1
    return result


def fetch_month(station_key: str, year: int, month: int) -> tuple[str, int, int, str]:
    station = STATIONS[station_key]
    last_day = calendar.monthrange(year, month)[1]
    query = urlencode(
        {
            "estacion": station["id"],
            "desde": f"01/{month:02d}/{year}",
            "hasta": f"{last_day:02d}/{month:02d}/{year}",
        }
    )
    request = Request(f"{CTM_CSV}?{query}", headers={"User-Agent": USER_AGENT})
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            with urlopen(request, timeout=45) as response:  # noqa: S310 - fuente fija
                payload = response.read().decode("utf-8-sig", errors="replace")
            if "Fecha;Nivel;Lluvia" not in payload:
                raise ValueError("respuesta CSV sin encabezado esperado")
            return station_key, year, month, payload
        except Exception as error:  # noqa: BLE001
            last_error = error
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(
        f"{station_key} {year}-{month:02d}: {type(last_error).__name__}: {last_error}"
    )


def daily_records(payloads: list[str]) -> list[dict[str, Any]]:
    buckets: dict[str, dict[str, list[float]]] = defaultdict(
        lambda: {"level": [], "rain": []}
    )
    for payload in payloads:
        reader = csv.DictReader(io.StringIO(payload), delimiter=";")
        for row in reader:
            try:
                observed = datetime.strptime(row["Fecha"], "%d/%m/%Y %H:%M")
                level = float(row["Nivel"].replace(",", "."))
                rain = float(row["Lluvia"].replace(",", "."))
            except (KeyError, TypeError, ValueError):
                continue
            if not -2 <= level <= 40 or not 0 <= rain <= 500:
                continue
            key = observed.date().isoformat()
            buckets[key]["level"].append(level)
            buckets[key]["rain"].append(rain)

    records: list[dict[str, Any]] = []
    for day, values in sorted(buckets.items()):
        levels = values["level"]
        if len(levels) < 24:
            continue
        daily_rain = sum(values["rain"])
        records.append(
            {
                "date": day,
                "level_m": round(statistics.median(levels), 3),
                "level_min_m": round(min(levels), 3),
                "level_max_m": round(max(levels), 3),
                "rain_mm": round(daily_rain, 1) if daily_rain <= 500 else None,
                "samples": len(levels),
            }
        )
    return records


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--start-year", type=int, default=2017)
    parser.add_argument("--end-year", type=int)
    parser.add_argument(
        "--merge-existing",
        action="store_true",
        help="combina el período descargado con el archivo existente por fecha",
    )
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()

    today = date.today()
    end = (
        date(args.end_year, 12, 31)
        if args.end_year and args.end_year < today.year
        else today
    )
    months = month_sequence(args.start_year, end)
    payloads: dict[str, list[str]] = {key: [] for key in STATIONS}
    failures: list[str] = []

    jobs = [
        (station_key, year, month)
        for station_key in STATIONS
        for year, month in months
    ]
    with ThreadPoolExecutor(max_workers=max(1, min(args.workers, 10))) as pool:
        futures = {
            pool.submit(fetch_month, station_key, year, month): (
                station_key,
                year,
                month,
            )
            for station_key, year, month in jobs
        }
        completed = 0
        for future in as_completed(futures):
            station_key, year, month = futures[future]
            try:
                _, _, _, payload = future.result()
                payloads[station_key].append(payload)
            except Exception as error:  # noqa: BLE001
                failures.append(f"{station_key} {year}-{month:02d}: {error}")
            completed += 1
            if completed % 25 == 0 or completed == len(jobs):
                print(
                    f"descargas {completed}/{len(jobs)} · fallas {len(failures)}",
                    flush=True,
                )

    existing: dict[str, Any] = {"stations": {}}
    if args.merge_existing and OUTPUT.exists():
        existing = json.loads(OUTPUT.read_text(encoding="utf-8"))

    stations: dict[str, Any] = {}
    for key, metadata in STATIONS.items():
        by_date = {
            record["date"]: record
            for record in existing.get("stations", {}).get(key, {}).get("records", [])
        }
        by_date.update(
            {record["date"]: record for record in daily_records(payloads[key])}
        )
        stations[key] = {
            **metadata,
            "records": sorted(by_date.values(), key=lambda record: record["date"]),
        }

    output = {
        "schema_version": 1,
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "source": {
            "name": "Comisión Técnica Mixta de Salto Grande",
            "url": CTM_CSV,
            "aggregation": (
                "mediana, mínimo y máximo diarios del nivel de 15 minutos; "
                "suma diaria del campo lluvia"
            ),
        },
        "stations": stations,
        "download_failures": [
            *existing.get("download_failures", []),
            *failures,
        ],
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        json.dumps(output, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    for key, station in output["stations"].items():
        records = station["records"]
        print(
            f"{key}: {len(records)} días · "
            f"{records[0]['date'] if records else 'sin datos'} → "
            f"{records[-1]['date'] if records else 'sin datos'}"
        )
    print(f"OUTPUT={OUTPUT}")


if __name__ == "__main__":
    main()
