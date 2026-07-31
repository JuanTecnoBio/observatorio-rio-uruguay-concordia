#!/usr/bin/env python3
"""Actualiza el corte público con fuentes oficiales y deja fallas explícitas.

El script está pensado para GitHub Actions. Cada adaptador modifica únicamente
los datos de su propia fuente cuando puede verificarlos; si falla, conserva el
último valor publicado, marca la copia como desactualizada y registra el error.
"""

from __future__ import annotations

import io
import json
import math
import re
import subprocess
import unicodedata
from copy import deepcopy
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup
from pypdf import PdfReader
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from backfill_ctm_history import STATIONS as CTM_NETWORK_STATIONS
from backfill_ctm_history import daily_records as aggregate_ctm_daily
from forecast_model import build_forecast, build_risk_report, quantile


ROOT = Path(__file__).resolve().parents[1]
STATE_PATH = ROOT / "public" / "data" / "current_state.json"
REPORT_HISTORY_PATH = ROOT / "public" / "data" / "risk_reports.json"
HYDROMETRIC_HISTORY_PATH = ROOT / "public" / "data" / "hydrometric_history.json"
FLOW_FORECAST_ARCHIVE_PATH = ROOT / "public" / "data" / "flow_forecast_archive.json"
TZ = ZoneInfo("America/Argentina/Cordoba")
HTTP_TIMEOUT = (15, 35)
REPORT_HISTORY_LIMIT = 240
REPORT_ANCHOR_THRESHOLD_M = 11.5
REPORT_THRESHOLDS_M = (11.0, 11.25, 11.5, 11.75, 12.0, 12.25)
REPORT_LOGIT_SLOPE_PER_M = 3.0
REPORT_HORIZONS = (7, 14, 21, 28)
REPORT_BASELINES = {
    7: {"probability": 25, "max": 10.85, "lower": 13, "upper": 15},
    14: {"probability": 35, "max": 11.11, "lower": 17, "upper": 20},
    21: {"probability": 40, "max": 11.60, "lower": 22, "upper": 25},
    28: {"probability": 45, "max": 12.22, "lower": 25, "upper": 25},
}
REPORT_UNCERTAINTY = {
    7: "Moderada",
    14: "Moderada-alta",
    21: "Alta",
    28: "Muy alta",
}

PNA_PDF = "https://contenidosweb.prefecturanaval.gob.ar/alturas/pdf.php"
PNA_PAGE = "https://contenidosweb.prefecturanaval.gob.ar/alturas/"
CTM_CONCORDIA = "https://www.saltogrande.org/datos_estacion.php"
CTM_STATION_CSV = "https://www.saltogrande.org/datos_estacion_csv.php"
CTM_CONCORDIA_ID = "A50012EE"
CTM_HOURLY = "https://www.saltogrande.org/datos_horarios.php"
CTM_BULLETIN = "https://www.saltogrande.org/docs/hidrologia/Comunicado.pdf"
CTM_RAIN = "https://www.saltogrande.org/docs/hidrologia/PronosticosP.pdf"
GEOGLOWS_RIVER_ID = 640460565
GEOGLOWS_FORECAST = (
    f"https://geoglows.ecmwf.int/api/v2/forecastensemble/{GEOGLOWS_RIVER_ID}"
)

SESSION = requests.Session()
SESSION.mount(
    "https://",
    HTTPAdapter(
        max_retries=Retry(
            total=2,
            connect=2,
            read=2,
            status=2,
            backoff_factor=1.5,
            status_forcelist=(429, 500, 502, 503, 504),
            allowed_methods=frozenset({"GET"}),
        )
    ),
)
SESSION.headers.update(
    {
        # CTM aplica una regla anti-bot que rechaza agentes de usuario
        # personalizados aunque los documentos sean públicos. Usamos
        # encabezados de navegador, sin cookies ni credenciales.
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/137.0 Safari/537.36"
        ),
        "Accept": (
            "text/html,application/xhtml+xml,application/xml;q=0.9,"
            "application/pdf;q=0.8,*/*;q=0.7"
        ),
        "Accept-Language": "es-AR,es;q=0.9,en;q=0.7",
    }
)


@dataclass
class AdapterResult:
    source_id: str
    ok: bool
    message: str
    retrieved_at: str


def now_local() -> datetime:
    return datetime.now(TZ).replace(microsecond=0)


def iso_local(value: datetime) -> str:
    return value.astimezone(TZ).isoformat()


def normalize(value: str) -> str:
    value = unicodedata.normalize("NFKD", value)
    value = "".join(char for char in value if not unicodedata.combining(char))
    return re.sub(r"\s+", " ", value).strip()


def number(value: str) -> float:
    cleaned = value.replace(" ", "")
    if "," in cleaned and "." in cleaned:
        if cleaned.rfind(",") > cleaned.rfind("."):
            cleaned = cleaned.replace(".", "").replace(",", ".")
        else:
            cleaned = cleaned.replace(",", "")
    elif "," in cleaned:
        cleaned = cleaned.replace(".", "").replace(",", ".")
    elif cleaned.count(".") == 1:
        head, tail = cleaned.split(".")
        if len(tail) == 3:
            cleaned = head + tail
    return float(cleaned)


def fetch(url: str, params: dict[str, str] | None = None) -> requests.Response:
    response = SESSION.get(url, params=params, timeout=HTTP_TIMEOUT)
    response.raise_for_status()
    return response


def pdf_text(url: str) -> str:
    response = fetch(url)
    reader = PdfReader(io.BytesIO(response.content))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def parse_source_datetime(text: str, fallback: datetime) -> datetime:
    date_match = re.search(r"\b(\d{1,2})/(\d{1,2})/(\d{2,4})\b", text)
    time_match = re.search(r"\b([01]?\d|2[0-3]):([0-5]\d)\b", text)
    if not date_match:
        return fallback
    day, month, year = map(int, date_match.groups())
    if year < 100:
        year += 2000
    hour, minute = (map(int, time_match.groups()) if time_match else (0, 0))
    return datetime(year, month, day, hour, minute, tzinfo=TZ)


def extract_station(text: str, name: str, group: str) -> dict[str, Any] | None:
    lines = [normalize(line) for line in text.splitlines() if line.strip()]
    target = normalize(name).lower()
    for index, line in enumerate(lines):
        if target not in line.lower():
            continue
        block = " ".join(lines[index : index + 3])
        tail = block.lower().split(target, 1)[1]
        values = re.findall(r"(?<!\d)[+-]?\d{1,3}(?:[.,]\d{1,3})?(?!\d)", tail)
        values = [
            token
            for token in values
            if not re.fullmatch(r"\d{1,2}", token)
            or any(separator in token for separator in ".,")
        ]
        if not values:
            continue
        try:
            level = number(values[0])
            variation = number(values[1]) if len(values) > 1 else None
        except ValueError:
            continue
        if not -2 <= level <= 20:
            continue

        observed = parse_source_datetime(block, now_local())
        interval = re.search(r"\b(\d{1,2})\s*(?:h|hs|horas)\b", tail, re.I)
        lower = block.lower()
        trend = (
            "crece"
            if "crec" in lower or "sube" in lower
            else "baja"
            if "baj" in lower
            else "estable"
            if "estable" in lower
            else "sin tendencia informada"
        )
        status = (
            "Evacuación"
            if "evacuacion" in lower
            else "Alerta"
            if "alerta" in lower
            else "Seguimiento"
        )
        return {
            "name": name,
            "group": group,
            "value_m": round(level, 2),
            "variation_m": round(variation, 2) if variation is not None else None,
            "variation_period_h": int(interval.group(1)) if interval else None,
            "trend": trend,
            "status": status,
            "observed_at_local": iso_local(observed),
            "source": "PNA",
        }
    return None


def observation_index(state: dict[str, Any], variable: str) -> int | None:
    for index, observation in enumerate(state["observations"]):
        if observation.get("variable") == variable:
            return index
    return None


def update_observation(
    state: dict[str, Any],
    variable: str,
    value: float,
    observed_at: datetime,
    retrieved_at: str,
) -> None:
    index = observation_index(state, variable)
    if index is None:
        raise KeyError(f"No existe la observación base {variable}")
    observation = state["observations"][index]
    observation.update(
        {
            "observed_at_local": iso_local(observed_at),
            "observed_at_utc": observed_at.astimezone(timezone.utc)
            .replace(microsecond=0)
            .isoformat()
            .replace("+00:00", "Z"),
            "retrieved_at": retrieved_at,
            "value": value,
            "quality_flag": (
                "official_unvalidated_by_observatory"
                if observation["source_id"] == "pna_alturas"
                else "official_preliminary"
            ),
        }
    )


def update_river_stage(
    state: dict[str, Any],
    value: float,
    observed_at: datetime,
    retrieved_at: str,
    *,
    source_id: str,
    source_name: str,
    source_reference: str,
    quality_flag: str,
) -> None:
    update_observation(
        state,
        "river_stage",
        round(value, 2),
        observed_at,
        retrieved_at,
    )
    index = observation_index(state, "river_stage")
    if index is None:
        raise KeyError("No existe la observación base river_stage")
    state["observations"][index].update(
        {
            "source_id": source_id,
            "source_name": source_name,
            "source_reference": source_reference,
            "quality_flag": quality_flag,
        }
    )

    history = state.get("history", [])
    day_key = observed_at.date().isoformat()
    history = [item for item in history if item.get("date") != day_key]
    history.append(
        {
            "date": day_key,
            "label": observed_at.strftime("%d %b").lower(),
            "value": round(value, 2),
            "source": source_name,
        }
    )
    state["history"] = sorted(history, key=lambda item: item["date"])[-30:]


def update_pna(state: dict[str, Any], attempt: datetime) -> AdapterResult:
    retrieved = iso_local(attempt)
    try:
        try:
            text = pdf_text(PNA_PDF)
        except requests.RequestException:
            # La tabla HTML es un respaldo oficial útil cuando falla el
            # generador de PDF de Prefectura.
            page = BeautifulSoup(fetch(PNA_PAGE).text, "html.parser")
            text = page.get_text("\n", strip=True)
        station_specs = [
            ("Paso de los Libres", "upstream"),
            ("Alvear", "upstream"),
            ("Monte Caseros", "upstream"),
            ("Mocoretá", "upstream"),
            ("Concordia", "downstream"),
            ("Yeruá", "downstream"),
            ("Colón", "downstream"),
            ("Concepción del Uruguay", "downstream"),
        ]
        readings = [
            reading
            for name, group in station_specs
            if (reading := extract_station(text, name, group)) is not None
        ]
        concordia = next(
            (reading for reading in readings if reading["name"] == "Concordia"),
            None,
        )
        if concordia is None:
            raise ValueError("no se pudo identificar la fila de Concordia")

        state["stations"] = readings
        observed = datetime.fromisoformat(concordia["observed_at_local"])
        update_river_stage(
            state,
            concordia["value_m"],
            observed,
            retrieved,
            source_id="pna_alturas",
            source_name="Prefectura Naval Argentina",
            source_reference=PNA_PAGE,
            quality_flag="official_unvalidated_by_observatory",
        )
        state["thresholds"]["retrieved_at"] = retrieved

        paso = next(
            (reading for reading in readings if reading["name"] == "Paso de los Libres"),
            None,
        )
        if paso:
            state.setdefault("signals", {})["upstream"] = (
                f"{paso['value_m']:.2f} m · {paso['status'].lower()} · {paso['trend']} "
                f"· {observed.strftime('%d/%m %H:%M')}"
            )
        return AdapterResult("pna_alturas", True, "PNA actualizada", retrieved)
    except Exception as error:  # noqa: BLE001 - el error queda publicado
        index = observation_index(state, "river_stage")
        if index is not None:
            state["observations"][index]["quality_flag"] = "official_stale_copy"
        return AdapterResult(
            "pna_alturas",
            False,
            f"PNA no disponible: {type(error).__name__}: {error}",
            retrieved,
        )


def update_ctm_concordia(state: dict[str, Any], attempt: datetime) -> AdapterResult:
    """Actualiza la altura con la estación oficial de CTM de quince minutos."""

    retrieved = iso_local(attempt)
    params = {
        "estacion": CTM_CONCORDIA_ID,
        "desde": (attempt - timedelta(days=1)).strftime("%d/%m/%Y"),
        "hasta": attempt.strftime("%d/%m/%Y"),
    }
    try:
        response = fetch(CTM_CONCORDIA, params=params)
        points = [
            (
                datetime.strptime(timestamp, "%Y-%m-%d %H:%M:%S").replace(
                    tzinfo=TZ
                ),
                float(value),
            )
            for timestamp, value in re.findall(
                r'\["(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})",\s*'
                r"(-?\d+(?:\.\d+)?)\]",
                response.text,
            )
        ]
        points = [point for point in points if -2 <= point[1] <= 20]
        if not points:
            raise ValueError("no se encontraron niveles en Puerto Concordia")

        observed, level = max(points, key=lambda point: point[0])
        comparison_target = observed - timedelta(hours=12)
        previous_candidates = [
            point for point in points if point[0] <= comparison_target
        ]
        previous = (
            max(previous_candidates, key=lambda point: point[0])
            if previous_candidates
            else min(points, key=lambda point: point[0])
        )
        elapsed_hours = max(
            1, round((observed - previous[0]).total_seconds() / 3600)
        )
        variation = round(level - previous[1], 2)
        trend = "crece" if variation > 0.02 else "baja" if variation < -0.02 else "estable"
        status = (
            "Evacuación"
            if level >= state["thresholds"]["evacuation_m"]
            else "Alerta"
            if level >= state["thresholds"]["alert_m"]
            else "Seguimiento"
        )

        update_river_stage(
            state,
            level,
            observed,
            retrieved,
            source_id="ctm_concordia_stage",
            source_name="CTM Salto Grande",
            source_reference=response.url,
            quality_flag="official_preliminary",
        )

        concordia_station = {
            "name": "Concordia",
            "group": "downstream",
            "value_m": round(level, 2),
            "variation_m": variation,
            "variation_period_h": elapsed_hours,
            "trend": trend,
            "status": status,
            "observed_at_local": iso_local(observed),
            "source": "CTM",
        }
        stations = [
            station
            for station in state.get("stations", [])
            if station.get("name") != "Concordia"
        ]
        stations.append(concordia_station)
        state["stations"] = stations
        return AdapterResult(
            "ctm_concordia_stage",
            True,
            "CTM Puerto Concordia actualizada",
            retrieved,
        )
    except Exception as error:  # noqa: BLE001
        return AdapterResult(
            "ctm_concordia_stage",
            False,
            f"CTM Puerto Concordia no disponible: {type(error).__name__}: {error}",
            retrieved,
        )


def update_ctm_network_history(attempt: datetime) -> AdapterResult:
    """Actualiza los últimos treinta días de la base usada por el ensamble.

    El histórico inicial se reconstruye con ``backfill_ctm_history.py``. Cada
    ejecución automática reemplaza el tramo reciente para incorporar
    correcciones de la fuente y mantener disponibles los predictores aguas
    arriba sin descargar nuevamente todos los años.
    """

    retrieved = iso_local(attempt)
    try:
        history = json.loads(HYDROMETRIC_HISTORY_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        return AdapterResult(
            "ctm_historical_network",
            False,
            f"Histórico CTM no disponible: {type(error).__name__}: {error}",
            retrieved,
        )

    refreshed: list[str] = []
    failures: list[str] = []
    start = (attempt - timedelta(days=29)).strftime("%d/%m/%Y")
    end = attempt.strftime("%d/%m/%Y")
    for key, metadata in CTM_NETWORK_STATIONS.items():
        try:
            response = fetch(
                CTM_STATION_CSV,
                params={"estacion": metadata["id"], "desde": start, "hasta": end},
            )
            recent = aggregate_ctm_daily([response.text])
            if not recent:
                raise ValueError("CSV sin días completos")
            station = history.setdefault("stations", {}).setdefault(
                key, {**metadata, "records": []}
            )
            by_date = {
                record["date"]: record for record in station.get("records", [])
            }
            by_date.update({record["date"]: record for record in recent})
            station["records"] = sorted(by_date.values(), key=lambda record: record["date"])
            refreshed.append(key)
        except Exception as error:  # noqa: BLE001
            failures.append(f"{metadata['name']}: {type(error).__name__}")

    history["generated_at"] = retrieved
    history["recent_refresh"] = {
        "start": start,
        "end": end,
        "stations_ok": refreshed,
        "failures": failures,
    }
    HYDROMETRIC_HISTORY_PATH.write_text(
        json.dumps(history, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    if "concordia" not in refreshed or len(refreshed) < 3:
        return AdapterResult(
            "ctm_historical_network",
            False,
            "Red histórica CTM incompleta: " + ", ".join(failures),
            retrieved,
        )
    message = f"Red histórica CTM actualizada ({len(refreshed)}/5 estaciones)"
    if failures:
        message += "; faltan " + ", ".join(failures)
    return AdapterResult("ctm_historical_network", True, message, retrieved)


def labelled_value(text: str, patterns: list[str]) -> float:
    numeric = (
        r"(-?\d{1,3}(?:[.\s]\d{3})+(?:,\d+)?|"
        r"-?\d+(?:[.,]\d+)?)"
    )
    for pattern in patterns:
        match = re.search(
            rf"{pattern}.{{0,100}}?{numeric}",
            text,
            re.I,
        )
        if match:
            return number(match.group(1))
    raise ValueError(f"no se encontró {' / '.join(patterns)}")


def update_ctm_hourly(state: dict[str, Any], attempt: datetime) -> AdapterResult:
    retrieved = iso_local(attempt)
    try:
        soup = BeautifulSoup(fetch(CTM_HOURLY).text, "html.parser")
        text = normalize(soup.get_text(" ", strip=True))
        turbinated = labelled_value(text, [r"caudal\s+turbinado", r"turbinado"])
        spilled = labelled_value(text, [r"caudal\s+vertido", r"vertido"])
        reservoir = labelled_value(
            text, [r"cota\s+(?:del\s+)?embalse", r"nivel\s+(?:del\s+)?embalse"]
        )
        if not 100 <= turbinated <= 100_000 or not 0 <= spilled <= 100_000 or not 20 <= reservoir <= 40:
            raise ValueError("valores horarios fuera de rango físico de control")
        observed = parse_source_datetime(text, attempt.replace(minute=0, second=0))
        update_observation(state, "turbined_discharge", round(turbinated), observed, retrieved)
        update_observation(state, "spilled_discharge", round(spilled), observed, retrieved)
        update_observation(state, "reservoir_level", round(reservoir, 2), observed, retrieved)
        state.setdefault("signals", {})["released_flow_m3s"] = round(
            turbinated + spilled
        )
        return AdapterResult("ctm_hourly", True, "CTM horaria actualizada", retrieved)
    except Exception as error:  # noqa: BLE001
        for variable in (
            "turbined_discharge",
            "spilled_discharge",
            "reservoir_level",
        ):
            index = observation_index(state, variable)
            if index is not None:
                state["observations"][index]["quality_flag"] = "official_stale_copy"
        return AdapterResult(
            "ctm_hourly",
            False,
            f"CTM horaria no disponible: {type(error).__name__}: {error}",
            retrieved,
        )


def update_ctm_bulletin(state: dict[str, Any], attempt: datetime) -> AdapterResult:
    retrieved = iso_local(attempt)
    try:
        text = normalize(pdf_text(CTM_BULLETIN))
        concordia_match = re.search(
            r"cotas\s+(maxima|minima)\s+y\s+(minima|maxima)"
            r".{0,120}?Concordia.{0,40}?(\d{1,2}[,.]\d{1,2})"
            r".{0,40}?(\d{1,2}[,.]\d{1,2})",
            text,
            re.I,
        )
        if concordia_match:
            first_label, _, first_value, second_value = concordia_match.groups()
            first, second = number(first_value), number(second_value)
            if normalize(first_label).lower() == "maxima":
                maximum, minimum = first, second
            else:
                minimum, maximum = first, second
        else:
            maximum_match = re.search(
                r"cotas\s+maximas.{0,100}?puertos\s+de\s+Concordia\s+y\s+Salto"
                r".{0,120}?valores\s+de\s+(\d{1,2}[,.]\d{1,2})",
                text,
                re.I,
            )
            if not maximum_match:
                raise ValueError("no se encontró la previsión de Concordia")
            minimum = None
            maximum = number(maximum_match.group(1))

        if not 6 <= maximum <= 15 or (
            minimum is not None and (minimum > maximum or minimum < 6)
        ):
            raise ValueError("rango de Concordia fuera de control")

        issued = parse_source_datetime(text, attempt)
        valid_match = re.search(
            r"(?:hasta|vigencia).{0,100}?\b([01]?\d|2[0-3]):([0-5]\d)\b",
            text,
            re.I,
        )
        valid = issued.replace(hour=15, minute=0)
        if valid_match:
            valid = valid.replace(
                hour=int(valid_match.group(1)), minute=int(valid_match.group(2))
            )
        if re.search(r"\b(?:manana|mañana)\b", text, re.I) or valid <= issued:
            valid += timedelta(days=1)

        lower = text.lower()
        trend = (
            "creciente"
            if "creciente" in lower
            else "decreciente"
            if "decreciente" in lower
            else "no informada"
        )
        forecast = state["official_forecast"]
        forecast.update(
            {
                "issued_at_local": iso_local(issued),
                "valid_until_local": iso_local(valid),
                "concordia_min_m": round(minimum, 2) if minimum is not None else None,
                "concordia_max_m": round(maximum, 2),
                "trend": trend,
                "retrieved_at": retrieved,
                "quality_flag": "official_preliminary",
            }
        )

        flow_match = re.search(
            r"caudal\s+(?:medio\s+diario\s+)?(?:evacuado|erogado).{0,180}?"
            r"(\d{2}[.\s]?\d{3}|\d{4,5}).{0,80}?(\d{2}[.\s]?\d{3}|\d{4,5})",
            text,
            re.I,
        )
        if flow_match:
            flow_min, flow_max = sorted(map(number, flow_match.groups()))
            forecast["mean_daily_released_flow_min_m3s"] = round(flow_min)
            forecast["mean_daily_released_flow_max_m3s"] = round(flow_max)
        return AdapterResult("ctm_communicado", True, "Comunicado CTM actualizado", retrieved)
    except Exception as error:  # noqa: BLE001
        state["official_forecast"]["quality_flag"] = "official_stale_copy"
        return AdapterResult(
            "ctm_communicado",
            False,
            f"Comunicado CTM no disponible: {type(error).__name__}: {error}",
            retrieved,
        )


def update_ctm_rain(state: dict[str, Any], attempt: datetime) -> AdapterResult:
    retrieved = iso_local(attempt)
    try:
        text = pdf_text(CTM_RAIN)
        lines = [normalize(line) for line in text.splitlines() if line.strip()]
        candidates: list[float] = []
        for index, line in enumerate(lines):
            if "salto grande" not in line.lower():
                continue
            block = " ".join(lines[index : index + 3])
            candidates = [
                number(token)
                for token in re.findall(r"(?<!\d)\d{1,3}(?:[,.]\d+)?(?!\d)", block)
            ]
            if candidates:
                break
        plausible = [value for value in candidates if 0 <= value <= 1000]
        if not plausible:
            raise ValueError("no se encontró el total de lluvia de Salto Grande")
        state.setdefault("signals", {})["rainfall_7d_mm"] = round(plausible[-1])
        return AdapterResult("ctm_precip_forecast", True, "Lluvia CTM actualizada", retrieved)
    except Exception as error:  # noqa: BLE001
        state.setdefault("signals", {})["rainfall_7d_mm"] = None
        return AdapterResult(
            "ctm_precip_forecast",
            False,
            f"Pronóstico de lluvia no disponible: {type(error).__name__}: {error}",
            retrieved,
        )


def update_geoglows(state: dict[str, Any], attempt: datetime) -> AdapterResult:
    """Guarda el ensamble de caudal GEOGLOWS sin convertirlo a altura local."""

    retrieved = iso_local(attempt)
    try:
        payload = fetch(GEOGLOWS_FORECAST, params={"format": "json"}).json()
        timestamps = [datetime.fromisoformat(item) for item in payload["datetime"]]
        member_keys = sorted(
            (key for key in payload if key.startswith("ensemble_")),
            key=lambda key: int(key.split("_")[1]),
        )[:51]
        if len(member_keys) < 50 or not timestamps:
            raise ValueError("ensamble incompleto")

        daily_members: dict[str, dict[str, list[float]]] = {}
        for member_key in member_keys:
            values = payload[member_key]
            by_day: dict[str, list[float]] = {}
            for timestamp, raw_value in zip(timestamps, values):
                if raw_value in (None, ""):
                    continue
                try:
                    numeric_value = float(raw_value)
                except (TypeError, ValueError):
                    continue
                if not math.isfinite(numeric_value) or not 0 <= numeric_value <= 1_000_000:
                    continue
                day = timestamp.astimezone(TZ).date().isoformat()
                by_day.setdefault(day, []).append(numeric_value)
            for day, readings in by_day.items():
                daily_members.setdefault(day, {})[member_key] = readings

        daily: list[dict[str, Any]] = []
        for day, members in sorted(daily_members.items()):
            if date.fromisoformat(day) < attempt.date():
                continue
            member_means = [sum(values) / len(values) for values in members.values()]
            if len(member_means) < 45:
                continue
            daily.append(
                {
                    "date": day,
                    "p10_m3s": round(quantile(member_means, 0.10)),
                    "median_m3s": round(quantile(member_means, 0.50)),
                    "p90_m3s": round(quantile(member_means, 0.90)),
                    "member_count": len(member_means),
                }
            )
        if len(daily) < 10:
            raise ValueError("menos de diez días de pronóstico")

        forecast = {
            "source_id": "geoglows_ecmwf",
            "source_name": "GEOGLOWS ECMWF Streamflow Service",
            "river_id": GEOGLOWS_RIVER_ID,
            "generated_at": payload.get("metadata", {}).get("gen_date"),
            "retrieved_at": retrieved,
            "valid_until": daily[-1]["date"],
            "unit": "m3/s",
            "daily": daily,
            "quality_flag": "external_ensemble_not_stage_calibrated",
            "source_reference": GEOGLOWS_FORECAST,
            "note": (
                "Ensamble de caudal de 51 miembros. Se muestra como señal externa y "
                "no se convierte a altura de Concordia hasta contar con validación local."
            ),
        }
        state.setdefault("external_forecasts", {})["geoglows"] = forecast

        archive = {"schema_version": 1, "forecasts": []}
        if FLOW_FORECAST_ARCHIVE_PATH.exists():
            try:
                archive = json.loads(
                    FLOW_FORECAST_ARCHIVE_PATH.read_text(encoding="utf-8")
                )
            except (OSError, json.JSONDecodeError):
                pass
        by_generation = {
            item.get("generated_at"): item
            for item in [*archive.get("forecasts", []), forecast]
            if item.get("generated_at")
            and item.get("river_id") == GEOGLOWS_RIVER_ID
        }
        archive["updated_at"] = retrieved
        archive["forecasts"] = sorted(
            by_generation.values(), key=lambda item: item["generated_at"]
        )[-120:]
        FLOW_FORECAST_ARCHIVE_PATH.write_text(
            json.dumps(archive, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return AdapterResult(
            "geoglows_ecmwf",
            True,
            "GEOGLOWS actualizado; ensamble de caudal archivado",
            retrieved,
        )
    except Exception as error:  # noqa: BLE001
        return AdapterResult(
            "geoglows_ecmwf",
            False,
            f"GEOGLOWS no disponible: {type(error).__name__}: {error}",
            retrieved,
        )


def make_projection(state: dict[str, Any], generated: datetime) -> list[dict[str, Any]]:
    current = next(
        item["value"]
        for item in state["observations"]
        if item["station_id"] == "CONCORDIA_PNA"
    )
    forecast = state["official_forecast"]
    official_current = (
        datetime.fromisoformat(forecast["valid_until_local"]) >= generated
        and forecast.get("quality_flag") != "official_stale_copy"
        and forecast.get("concordia_min_m") is not None
    )
    alert = state["thresholds"]["alert_m"]
    evacuation = state["thresholds"]["evacuation_m"]
    projection: list[dict[str, Any]] = []

    for day in range(31):
        date = generated + timedelta(days=day)
        if day == 0:
            minimum = central = maximum = current
            basis = "official"
            uncertainty = "Moderada"
        elif day == 1 and official_current:
            minimum = forecast["concordia_min_m"]
            maximum = forecast["concordia_max_m"]
            central = round((minimum + maximum) / 2, 2)
            basis = "official"
            uncertainty = "Moderada"
        else:
            upstream_pulse = 0.24 * math.exp(-((day - 7) / 5.5) ** 2)
            persistence = 0.1 * (1 - math.exp(-day / 14))
            central = round(current + upstream_pulse + persistence, 2)
            lower_width = 0.18 + 0.035 * day + 0.0007 * day * day
            upper_width = 0.22 + 0.043 * day + 0.0009 * day * day
            minimum = round(max(7.5, central - lower_width), 2)
            maximum = round(central + upper_width, 2)
            basis = "experimental"
            uncertainty = "Moderada" if day <= 3 else "Alta" if day <= 7 else "Muy alta"
        risk = "Alto" if maximum >= evacuation else "Medio" if maximum >= alert else "Bajo"
        projection.append(
            {
                "day": day,
                "date": iso_local(date),
                "min": minimum,
                "central": central,
                "max": maximum,
                "uncertainty": uncertainty,
                "risk": risk,
                "basis": basis,
            }
        )
    return projection


def report_classification(probability: int) -> str:
    if probability < 20:
        return "BAJO"
    if probability < 30:
        return "MEDIO, franja baja"
    if probability < 45:
        return "MEDIO"
    if probability < 50:
        return "MEDIO, cerca del límite alto"
    return "ALTO"


def risk_report_method() -> dict[str, Any]:
    return {
        "method_id": "expert-anchored-multithreshold-v0.2",
        "calibrated": False,
        "label": "Estimación exploratoria estructurada",
        "note": (
            "No es una probabilidad estadística calibrada. El corte de 11,50 m "
            "funciona como referencia y los demás niveles se derivan con una "
            "transformación monótona explícita, además del ajuste reproducible "
            "por nivel observado y envolvente del escenario experimental."
        ),
    }


def threshold_text(threshold_m: float) -> str:
    return f"{threshold_m:.2f}".replace(".", ",")


def shift_probability(
    probability_pct: int | float,
    threshold_m: float,
    *,
    round_to_five: bool,
) -> int:
    """Traslada una estimación entre umbrales sin romper su orden lógico."""

    if math.isclose(threshold_m, REPORT_ANCHOR_THRESHOLD_M):
        return int(probability_pct)

    probability = max(0.005, min(0.995, float(probability_pct) / 100))
    logit = math.log(probability / (1 - probability))
    shifted_logit = (
        logit
        + REPORT_LOGIT_SLOPE_PER_M
        * (REPORT_ANCHOR_THRESHOLD_M - threshold_m)
    )
    shifted = 100 / (1 + math.exp(-shifted_logit))
    if round_to_five:
        return int(max(1, min(99, math.floor(shifted / 5 + 0.5) * 5)))
    return int(max(0, min(100, round(shifted))))


def make_threshold_report(
    anchor_rows: list[dict[str, Any]], threshold_m: float
) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    for anchor_row in anchor_rows:
        probability = shift_probability(
            anchor_row["central_estimate_pct"],
            threshold_m,
            round_to_five=True,
        )
        lower = shift_probability(
            anchor_row["plausible_interval_pct"][0],
            threshold_m,
            round_to_five=False,
        )
        upper = shift_probability(
            anchor_row["plausible_interval_pct"][1],
            threshold_m,
            round_to_five=False,
        )
        rows.append(
            {
                **anchor_row,
                "classification": report_classification(probability),
                "central_estimate_pct": probability,
                "plausible_interval_pct": [
                    min(lower, probability),
                    max(upper, probability),
                ],
            }
        )

    threshold_label = threshold_text(threshold_m)
    return {
        "threshold_m": threshold_m,
        "condition": (
            f"alcanzar o superar {threshold_label} m al menos una vez "
            "dentro de cada período"
        ),
        "rows": rows,
    }


def make_risk_report_cut(
    state: dict[str, Any], generated: datetime
) -> dict[str, Any]:
    """Construye una señal comparativa, no una probabilidad calibrada.

    El corte aportado por el usuario funciona como referencia inicial. Los
    cambios posteriores son reproducibles: responden al nivel de Concordia y
    al máximo de la envolvente publicada para cada horizonte.
    """

    current = next(
        item["value"]
        for item in state["observations"]
        if item["station_id"] == "CONCORDIA_PNA"
    )
    projection = {
        point["day"]: point
        for point in state.get("projection", make_projection(state, generated))
    }
    anchor_rows: list[dict[str, Any]] = []

    for horizon in REPORT_HORIZONS:
        point = projection[horizon]
        baseline = REPORT_BASELINES[horizon]
        raw_probability = (
            baseline["probability"]
            + (current - 10.0) * 18
            + (point["max"] - baseline["max"]) * 8
        )
        probability = int(max(5, min(90, round(raw_probability / 5) * 5)))
        lower = int(max(0, probability - baseline["lower"]))
        upper = int(min(100, probability + baseline["upper"]))
        anchor_rows.append(
            {
                "horizon_days": horizon,
                "classification": report_classification(probability),
                "central_estimate_pct": probability,
                "plausible_interval_pct": [lower, upper],
                "classification_uncertainty": REPORT_UNCERTAINTY[horizon],
                "scenario_min_m": point["min"],
                "scenario_central_m": point["central"],
                "scenario_max_m": point["max"],
            }
        )

    return {
        "id": generated.isoformat(),
        "generated_at": iso_local(generated),
        "station": "Puerto Concordia",
        "method": risk_report_method(),
        "data_status": state.get("update_status", {}).get("state", "stale"),
        "snapshot": {
            "concordia_m": current,
            "released_flow_m3s": state.get("signals", {}).get("released_flow_m3s"),
            "rainfall_7d_mm": state.get("signals", {}).get("rainfall_7d_mm"),
        },
        "thresholds": [
            make_threshold_report(anchor_rows, threshold_m)
            for threshold_m in REPORT_THRESHOLDS_M
        ],
    }


def legacy_report_from_cut(report_cut: dict[str, Any]) -> dict[str, Any]:
    """Mantiene el campo anterior de 11,50 m para consumidores existentes."""

    anchor = next(
        report
        for report in report_cut["thresholds"]
        if math.isclose(report["threshold_m"], REPORT_ANCHOR_THRESHOLD_M)
    )
    return {
        "id": report_cut["id"],
        "generated_at": report_cut["generated_at"],
        "event": {
            "station": report_cut["station"],
            "threshold_m": anchor["threshold_m"],
            "condition": anchor["condition"],
        },
        "method": report_cut["method"],
        "data_status": report_cut["data_status"],
        "snapshot": report_cut["snapshot"],
        "rows": anchor["rows"],
    }


def upgrade_saved_report(report: dict[str, Any]) -> dict[str, Any]:
    if report.get("thresholds"):
        return report

    anchor_rows = report.get("rows")
    if not anchor_rows:
        return report
    return {
        "id": report["id"],
        "generated_at": report["generated_at"],
        "station": report.get("event", {}).get("station", "Puerto Concordia"),
        "method": risk_report_method(),
        "data_status": report.get("data_status", "stale"),
        "snapshot": report.get("snapshot", {}),
        "thresholds": [
            make_threshold_report(anchor_rows, threshold_m)
            for threshold_m in REPORT_THRESHOLDS_M
        ],
    }


def reports_from_git_history() -> list[dict[str, Any]]:
    """Recupera cortes reales previos para que el archivo no empiece vacío."""

    try:
        log = subprocess.run(
            [
                "git",
                "log",
                f"-n{REPORT_HISTORY_LIMIT}",
                "--format=%H",
                "--",
                "public/data/current_state.json",
            ],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return []

    reports: list[dict[str, Any]] = []
    for revision in log.stdout.splitlines():
        try:
            stored = subprocess.run(
                [
                    "git",
                    "show",
                    f"{revision}:public/data/current_state.json",
                ],
                cwd=ROOT,
                check=True,
                capture_output=True,
                text=True,
            )
            historical_state = json.loads(stored.stdout)
            generated = datetime.fromisoformat(
                historical_state["generated_at"].replace("Z", "+00:00")
            )
            if not historical_state.get("projection"):
                historical_state["projection"] = make_projection(
                    historical_state, generated
                )
            reports.append(make_risk_report_cut(historical_state, generated))
        except (KeyError, ValueError, json.JSONDecodeError, subprocess.CalledProcessError):
            continue
    return reports


def save_report_history(current_report: dict[str, Any]) -> None:
    existing: list[dict[str, Any]] = []
    if REPORT_HISTORY_PATH.exists():
        try:
            existing = json.loads(
                REPORT_HISTORY_PATH.read_text(encoding="utf-8")
            ).get("reports", [])
        except (OSError, json.JSONDecodeError):
            existing = []

    current_method = current_report.get("method", {}).get("method_id")
    comparable_existing = [
        report
        for report in existing
        if report.get("method", {}).get("method_id") == current_method
        and report.get("thresholds")
    ]
    by_id = {
        report["id"]: report
        for report in [
            *comparable_existing,
            current_report,
        ]
        if report.get("id") and report.get("thresholds")
    }
    reports = sorted(by_id.values(), key=lambda report: report["generated_at"])[
        -REPORT_HISTORY_LIMIT:
    ]
    archive = {
        "schema_version": 3,
        "updated_at": current_report["generated_at"],
        "station": current_report["station"],
        "thresholds_m": list(REPORT_THRESHOLDS_M),
        "method": current_report["method"],
        "retention": {
            "maximum_reports": REPORT_HISTORY_LIMIT,
            "cadence": "cada actualización automática con un corte nuevo",
        },
        "reports": reports,
    }
    REPORT_HISTORY_PATH.write_text(
        json.dumps(archive, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    attempt = now_local()
    previous = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    state = deepcopy(previous)
    results = [
        update_pna(state, attempt),
        update_ctm_concordia(state, attempt),
        update_ctm_network_history(attempt),
        update_ctm_hourly(state, attempt),
        update_ctm_bulletin(state, attempt),
        update_ctm_rain(state, attempt),
        update_geoglows(state, attempt),
    ]
    successful = [result for result in results if result.ok]
    failed = [result for result in results if not result.ok]

    if not failed:
        update_state = "fresh"
        message = "Las consultas oficiales y la red histórica respondieron correctamente."
    elif successful:
        update_state = "partial"
        labels = {
            "pna_alturas": "PNA",
            "ctm_concordia_stage": "la estación Puerto Concordia de CTM",
            "ctm_historical_network": "la red histórica de estaciones CTM",
            "ctm_hourly": "los datos horarios de CTM",
            "ctm_communicado": "el comunicado de CTM",
            "ctm_precip_forecast": "el pronóstico de lluvia de CTM",
            "geoglows_ecmwf": "el ensamble de caudal GEOGLOWS/ECMWF",
        }
        unavailable = ", ".join(labels[result.source_id] for result in failed)
        stage = next(
            observation
            for observation in state["observations"]
            if observation["variable"] == "river_stage"
        )
        message = (
            f"Corte parcial: no respondieron {unavailable}. La altura publicada "
            f"corresponde a {stage['source_name']} y conserva su hora de observación."
        )
    else:
        update_state = "stale"
        message = (
            "Ninguna fuente respondió en este intento. Los valores conservados se "
            "muestran con su fecha original y no deben leerse como actuales."
        )

    state["generated_at"] = iso_local(attempt)
    state["update_status"] = {"state": update_state, "message": message}
    state["source_status"] = {
        result.source_id: {
            "ok": result.ok,
            "message": result.message,
            "attempted_at": result.retrieved_at,
        }
        for result in results
    }
    try:
        history = json.loads(HYDROMETRIC_HISTORY_PATH.read_text(encoding="utf-8"))
        current_level = next(
            observation["value"]
            for observation in state["observations"]
            if observation["variable"] == "river_stage"
        )
        projection, model, members = build_forecast(history, current_level, attempt)
        current_report = build_risk_report(
            state, projection, model, members, attempt
        )
        state["projection"] = projection
        state["forecast_method"] = model
        state["source_status"]["local_forecast_model"] = {
            "ok": True,
            "message": "Ensamble local recalculado y validación temporal disponible",
            "attempted_at": iso_local(attempt),
        }
    except Exception as error:  # noqa: BLE001
        current_report = state.get("risk_report_bundle")
        state["source_status"]["local_forecast_model"] = {
            "ok": False,
            "message": f"Modelo local no recalculado: {type(error).__name__}: {error}",
            "attempted_at": iso_local(attempt),
        }
        state["update_status"] = {
            "state": "partial",
            "message": (
                f"{message} El pronóstico conserva el último corte validado porque "
                "el modelo local no pudo recalcularse."
            ),
        }
        if not current_report:
            raise
    state["risk_report_bundle"] = current_report
    state["risk_report"] = legacy_report_from_cut(current_report)
    state["probabilities"] = {
        "alert_exceedance": next(
            (
                report["rows"][0]["central_estimate_pct"]
                for report in current_report["thresholds"]
                if math.isclose(report["threshold_m"], state["thresholds"]["alert_m"])
            ),
            None,
        ),
        "evacuation_exceedance": next(
            (
                report["rows"][0]["central_estimate_pct"]
                for report in current_report["thresholds"]
                if math.isclose(report["threshold_m"], state["thresholds"]["evacuation_m"])
            ),
            None,
        ),
        "reason": (
            "Sólo se publica una probabilidad cuando esa combinación de nivel y horizonte "
            "aprueba el bloque temporal final, el tamaño mínimo de eventos, Brier Skill "
            "Score ≥ 0,05 y el control de confiabilidad."
        ),
    }

    STATE_PATH.write_text(
        json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    save_report_history(current_report)
    print(
        json.dumps(
            {
                "state": update_state,
                "successful": [result.source_id for result in successful],
                "failed": [result.source_id for result in failed],
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
