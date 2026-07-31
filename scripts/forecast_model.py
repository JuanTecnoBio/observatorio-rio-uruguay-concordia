#!/usr/bin/env python3
"""Pronóstico probabilístico local basado en ensamble de análogos observados.

El modelo usa únicamente información disponible antes de cada origen. La
evaluación temporal tiene tres bloques consecutivos: entrenamiento (60 %),
calibración (20 %) y validación final (20 %). El bloque intermedio ajusta por
conformalización la banda y calibra las probabilidades con regresión logística
de Platt; el bloque final no interviene en ninguno de esos ajustes. Si una
probabilidad no supera los requisitos mínimos de casos, eventos, Brier Skill y
confiabilidad en ese último bloque, no se publica cuantitativamente.
"""

from __future__ import annotations

import json
import math
import statistics
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
HISTORY_PATH = ROOT / "public" / "data" / "hydrometric_history.json"
HORIZONS = (7, 14, 21, 28)
VALIDATION_HORIZONS = (1, 3, 7, 14, 21, 28, 30)
THRESHOLDS = (11.0, 11.25, 11.5, 11.75, 12.0, 12.25)
MAX_HORIZON = 30
ANALOG_COUNT = 60
VALIDATION_STRIDE_DAYS = 7
MIN_PROBABILITY_CASES = 80
MIN_PROBABILITY_EVENTS = 10
MIN_BRIER_SKILL = 0.05
MAX_RELIABILITY_ERROR = 0.12
MIN_POINT_SKILL = 0.03


FEATURE_WEIGHTS = {
    "local_level": 2.4,
    "local_d1": 1.8,
    "local_d3": 2.2,
    "local_d7": 1.8,
    "local_d14": 1.2,
    "local_vol7": 0.9,
    "season_sin": 0.35,
    "season_cos": 0.35,
}
for _station in ("paso_libres", "monte_caseros"):
    FEATURE_WEIGHTS.update(
        {
            f"{_station}_level": 1.2,
            f"{_station}_d1": 1.0,
            f"{_station}_d3": 1.5,
            f"{_station}_d7": 1.2,
            f"{_station}_rain3": 0.45,
            f"{_station}_rain7": 0.55,
        }
    )
for _station in ("federacion", "salto_grande"):
    FEATURE_WEIGHTS.update(
        {
            f"{_station}_level": 1.0,
            f"{_station}_d1": 0.8,
            f"{_station}_d3": 1.0,
            f"{_station}_d7": 0.8,
            f"{_station}_rain7": 0.35,
        }
    )


@dataclass
class AnalogMember:
    origin: date
    distance: float
    weight: float
    path: list[float]


def quantile(values: Iterable[float], probability: float) -> float:
    ordered = sorted(float(value) for value in values)
    if not ordered:
        raise ValueError("quantile sin valores")
    if len(ordered) == 1:
        return ordered[0]
    position = max(0.0, min(1.0, probability)) * (len(ordered) - 1)
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    fraction = position - lower
    return ordered[lower] * (1 - fraction) + ordered[upper] * fraction


def weighted_quantile(
    values: list[float], weights: list[float], probability: float
) -> float:
    ordered = sorted(zip(values, weights), key=lambda pair: pair[0])
    total = sum(weight for _, weight in ordered)
    if total <= 0:
        return quantile(values, probability)
    target = max(0.0, min(1.0, probability)) * total
    cumulative = 0.0
    for value, weight in ordered:
        cumulative += weight
        if cumulative >= target:
            return value
    return ordered[-1][0]


def mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else math.nan


def mae(errors: list[float]) -> float | None:
    return round(mean([abs(error) for error in errors]), 3) if errors else None


def brier(probabilities: list[float], outcomes: list[int]) -> float | None:
    if not probabilities:
        return None
    return mean([(probability - outcome) ** 2 for probability, outcome in zip(probabilities, outcomes)])


def reliability_error(probabilities: list[float], outcomes: list[int]) -> float | None:
    if not probabilities:
        return None
    total = len(probabilities)
    error = 0.0
    for lower in (0.0, 0.2, 0.4, 0.6, 0.8):
        indexes = [
            index
            for index, probability in enumerate(probabilities)
            if lower <= probability < lower + 0.2
            or (lower == 0.8 and math.isclose(probability, 1.0))
        ]
        if not indexes:
            continue
        predicted = mean([probabilities[index] for index in indexes])
        observed = mean([outcomes[index] for index in indexes])
        error += len(indexes) / total * abs(predicted - observed)
    return error


def logit(probability: float) -> float:
    bounded = min(1 - 1e-4, max(1e-4, probability))
    return math.log(bounded / (1 - bounded))


def sigmoid(value: float) -> float:
    if value >= 0:
        exponential = math.exp(-value)
        return 1 / (1 + exponential)
    exponential = math.exp(value)
    return exponential / (1 + exponential)


def fit_platt(probabilities: list[float], outcomes: list[int]) -> dict[str, float] | None:
    """Calibra la frecuencia del ensamble en un bloque temporal separado."""

    if len(probabilities) < 40 or sum(outcomes) < 4 or len(outcomes) - sum(outcomes) < 4:
        return None
    x_values = [logit(probability) for probability in probabilities]
    event_rate = (sum(outcomes) + 0.5) / (len(outcomes) + 1)
    intercept = logit(event_rate)
    slope = 1.0
    ridge = 0.08
    for _ in range(40):
        fitted = [sigmoid(intercept + slope * x) for x in x_values]
        gradient_a = sum(predicted - observed for predicted, observed in zip(fitted, outcomes))
        gradient_b = sum(
            (predicted - observed) * x
            for predicted, observed, x in zip(fitted, outcomes, x_values)
        ) + ridge * (slope - 1.0)
        hessian_aa = sum(predicted * (1 - predicted) for predicted in fitted) + 1e-6
        hessian_ab = sum(
            predicted * (1 - predicted) * x
            for predicted, x in zip(fitted, x_values)
        )
        hessian_bb = sum(
            predicted * (1 - predicted) * x * x
            for predicted, x in zip(fitted, x_values)
        ) + ridge + 1e-6
        determinant = hessian_aa * hessian_bb - hessian_ab * hessian_ab
        if determinant <= 1e-9:
            break
        step_a = (gradient_a * hessian_bb - gradient_b * hessian_ab) / determinant
        step_b = (gradient_b * hessian_aa - gradient_a * hessian_ab) / determinant
        intercept -= max(-1.0, min(1.0, step_a))
        slope -= max(-0.5, min(0.5, step_b))
        slope = min(5.0, max(0.05, slope))
        if abs(step_a) + abs(step_b) < 1e-6:
            break
    return {"intercept": round(intercept, 6), "slope": round(slope, 6)}


def calibrated_probability(probability: float, parameters: dict[str, float] | None) -> float:
    if not parameters:
        return probability
    return sigmoid(parameters["intercept"] + parameters["slope"] * logit(probability))


def finite_sample_quantile(values: list[float], coverage: float) -> float:
    """Cuantil split-conformal con corrección de muestra finita."""

    if not values:
        return 0.0
    rank = min(len(values), math.ceil((len(values) + 1) * coverage))
    return sorted(values)[rank - 1]


def load_history(path: Path = HISTORY_PATH) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def build_network(history: dict[str, Any]) -> dict[str, dict[date, dict[str, float]]]:
    network: dict[str, dict[date, dict[str, float]]] = {}
    for key, station in history["stations"].items():
        network[key] = {
            date.fromisoformat(record["date"]): record
            for record in station.get("records", [])
        }
    if not network.get("concordia"):
        raise ValueError("historial de Concordia vacío")
    return network


def value(
    network: dict[str, dict[date, dict[str, float]]],
    station: str,
    day: date,
    field: str = "level_m",
) -> float | None:
    record = network.get(station, {}).get(day)
    if not record:
        return None
    result = record.get(field)
    return float(result) if result is not None else None


def difference(
    network: dict[str, dict[date, dict[str, float]]],
    station: str,
    day: date,
    lag: int,
    *,
    override_level: float | None = None,
) -> float | None:
    current = override_level if override_level is not None else value(network, station, day)
    previous = value(network, station, day - timedelta(days=lag))
    if current is None or previous is None:
        return None
    return current - previous


def rain_sum(
    network: dict[str, dict[date, dict[str, float]]],
    station: str,
    day: date,
    days: int,
) -> float | None:
    readings = [
        value(network, station, day - timedelta(days=lag), "rain_mm")
        for lag in range(days)
    ]
    if sum(reading is not None for reading in readings) < max(1, days - 1):
        return None
    return sum(reading or 0.0 for reading in readings)


def feature_vector(
    network: dict[str, dict[date, dict[str, float]]],
    day: date,
    *,
    local_override: float | None = None,
) -> dict[str, float | None]:
    local_level = local_override if local_override is not None else value(network, "concordia", day)
    local_changes = [
        difference(network, "concordia", day - timedelta(days=lag), 1)
        for lag in range(7)
    ]
    available_changes = [change for change in local_changes if change is not None]
    result: dict[str, float | None] = {
        "local_level": local_level,
        "local_d1": difference(network, "concordia", day, 1, override_level=local_override),
        "local_d3": difference(network, "concordia", day, 3, override_level=local_override),
        "local_d7": difference(network, "concordia", day, 7, override_level=local_override),
        "local_d14": difference(network, "concordia", day, 14, override_level=local_override),
        "local_vol7": (
            statistics.pstdev(available_changes) if len(available_changes) >= 5 else None
        ),
        "season_sin": math.sin(2 * math.pi * day.timetuple().tm_yday / 365.25),
        "season_cos": math.cos(2 * math.pi * day.timetuple().tm_yday / 365.25),
    }
    for station in ("paso_libres", "monte_caseros"):
        result.update(
            {
                f"{station}_level": value(network, station, day),
                f"{station}_d1": difference(network, station, day, 1),
                f"{station}_d3": difference(network, station, day, 3),
                f"{station}_d7": difference(network, station, day, 7),
                f"{station}_rain3": rain_sum(network, station, day, 3),
                f"{station}_rain7": rain_sum(network, station, day, 7),
            }
        )
    for station in ("federacion", "salto_grande"):
        result.update(
            {
                f"{station}_level": value(network, station, day),
                f"{station}_d1": difference(network, station, day, 1),
                f"{station}_d3": difference(network, station, day, 3),
                f"{station}_d7": difference(network, station, day, 7),
                f"{station}_rain7": rain_sum(network, station, day, 7),
            }
        )
    return result


def complete_path(
    network: dict[str, dict[date, dict[str, float]]], origin: date
) -> list[float] | None:
    path = [
        value(network, "concordia", origin + timedelta(days=lead))
        for lead in range(MAX_HORIZON + 1)
    ]
    if any(point is None for point in path):
        return None
    return [float(point) for point in path if point is not None]


def feasible_origins(
    network: dict[str, dict[date, dict[str, float]]]
) -> list[date]:
    dates = sorted(network["concordia"])
    if not dates:
        return []
    return [
        day
        for day in dates
        if day - timedelta(days=14) in network["concordia"]
        and complete_path(network, day) is not None
    ]


def robust_scales(
    feature_cache: dict[date, dict[str, float | None]], origins: list[date]
) -> dict[str, float]:
    scales: dict[str, float] = {}
    for name in FEATURE_WEIGHTS:
        values = [
            float(feature_cache[origin][name])
            for origin in origins
            if feature_cache[origin].get(name) is not None
        ]
        if len(values) < 10:
            scales[name] = 1.0
            continue
        spread = quantile(values, 0.75) - quantile(values, 0.25)
        scales[name] = max(0.02, spread / 1.349)
    return scales


def feature_distance(
    current: dict[str, float | None],
    candidate: dict[str, float | None],
    scales: dict[str, float],
) -> float | None:
    total_weight = sum(FEATURE_WEIGHTS.values())
    used_weight = 0.0
    squared = 0.0
    for name, weight in FEATURE_WEIGHTS.items():
        left, right = current.get(name), candidate.get(name)
        if left is None or right is None:
            continue
        used_weight += weight
        squared += weight * ((float(left) - float(right)) / scales[name]) ** 2
    if used_weight < total_weight * 0.65:
        return None
    return math.sqrt(squared / used_weight) * math.sqrt(total_weight / used_weight)


def select_analogs(
    network: dict[str, dict[date, dict[str, float]]],
    target_features: dict[str, float | None],
    candidate_origins: list[date],
    feature_cache: dict[date, dict[str, float | None]],
    scales: dict[str, float],
    *,
    current_level: float,
    count: int = ANALOG_COUNT,
) -> list[AnalogMember]:
    candidates: list[tuple[float, date, list[float]]] = []
    for origin in candidate_origins:
        distance = feature_distance(target_features, feature_cache[origin], scales)
        if distance is None:
            continue
        path = complete_path(network, origin)
        if path is None:
            continue
        shifted = [round(current_level + point - path[0], 4) for point in path]
        candidates.append((distance, origin, shifted))
    candidates.sort(key=lambda item: item[0])
    selected = candidates[: min(count, len(candidates))]
    if len(selected) < 15:
        raise ValueError("menos de 15 análogos completos")
    distance_scale = max(0.05, statistics.median(item[0] for item in selected))
    raw_weights = [math.exp(-0.5 * (item[0] / distance_scale) ** 2) for item in selected]
    total = sum(raw_weights)
    return [
        AnalogMember(
            origin=origin,
            distance=distance,
            weight=raw_weight / total,
            path=path,
        )
        for (distance, origin, path), raw_weight in zip(selected, raw_weights)
    ]


def ensemble_probability(members: list[AnalogMember], threshold: float, horizon: int) -> float:
    return sum(
        member.weight
        for member in members
        if max(member.path[: horizon + 1]) >= threshold
    )


def effective_member_count(members: list[AnalogMember]) -> float:
    denominator = sum(member.weight**2 for member in members)
    return 1 / denominator if denominator else 0.0


def wilson_interval(probability: float, sample_size: float, z: float = 1.96) -> list[int]:
    if sample_size <= 0:
        return [0, 100]
    denominator = 1 + z * z / sample_size
    centre = (probability + z * z / (2 * sample_size)) / denominator
    margin = z * math.sqrt(
        probability * (1 - probability) / sample_size
        + z * z / (4 * sample_size * sample_size)
    ) / denominator
    return [
        max(0, round(100 * (centre - margin))),
        min(100, round(100 * (centre + margin))),
    ]


def classification(probability_pct: int | None) -> str:
    if probability_pct is None:
        return "NO HABILITADA"
    if probability_pct < 20:
        return "BAJO"
    if probability_pct < 45:
        return "MEDIO"
    return "ALTO"


def validate(
    network: dict[str, dict[date, dict[str, float]]],
    origins: list[date],
    feature_cache: dict[date, dict[str, float | None]],
) -> dict[str, Any]:
    if len(origins) < 1_000:
        raise ValueError("se requieren al menos 1.000 orígenes históricos completos")

    training_end = int(len(origins) * 0.60)
    calibration_end = int(len(origins) * 0.80)
    training = origins[:training_end]
    calibration_all = origins[training_end:calibration_end]
    validation_all = origins[calibration_end:]
    calibration_origins = calibration_all[::VALIDATION_STRIDE_DAYS]
    validation_origins = validation_all[::VALIDATION_STRIDE_DAYS]
    scales = robust_scales(feature_cache, training)

    def empty_cases() -> dict[tuple[float, int], dict[str, list[Any]]]:
        return {
            (threshold, horizon): {"probabilities": [], "outcomes": []}
            for threshold in THRESHOLDS
            for horizon in HORIZONS
        }

    def evaluate_block(block: list[date]) -> dict[str, Any]:
        point: dict[int, dict[str, list[float]]] = {
            horizon: {
                "errors": [],
                "persistence_errors": [],
                "lower": [],
                "upper": [],
                "actual": [],
            }
            for horizon in VALIDATION_HORIZONS
        }
        probability_cases = empty_cases()
        usable: list[str] = []
        for origin in block:
            current_level = value(network, "concordia", origin)
            actual_path = complete_path(network, origin)
            if current_level is None or actual_path is None:
                continue
            try:
                members = select_analogs(
                    network,
                    feature_cache[origin],
                    training,
                    feature_cache,
                    scales,
                    current_level=current_level,
                )
            except ValueError:
                continue
            usable.append(origin.isoformat())
            weights = [member.weight for member in members]
            for horizon in VALIDATION_HORIZONS:
                values = [member.path[horizon] for member in members]
                lower = weighted_quantile(values, weights, 0.10)
                centre = weighted_quantile(values, weights, 0.50)
                upper = weighted_quantile(values, weights, 0.90)
                point[horizon]["errors"].append(centre - actual_path[horizon])
                point[horizon]["persistence_errors"].append(
                    current_level - actual_path[horizon]
                )
                point[horizon]["lower"].append(lower)
                point[horizon]["upper"].append(upper)
                point[horizon]["actual"].append(actual_path[horizon])
            for threshold in THRESHOLDS:
                for horizon in HORIZONS:
                    case = probability_cases[(threshold, horizon)]
                    case["probabilities"].append(
                        ensemble_probability(members, threshold, horizon)
                    )
                    case["outcomes"].append(
                        int(max(actual_path[: horizon + 1]) >= threshold)
                    )
        return {"point": point, "probabilities": probability_cases, "usable": usable}

    calibration = evaluate_block(calibration_origins)
    validation = evaluate_block(validation_origins)

    conformal_corrections: dict[str, float] = {}
    point_metrics: dict[str, Any] = {}
    for horizon in VALIDATION_HORIZONS:
        calibration_point = calibration["point"][horizon]
        scores = [
            max(0.0, lower - actual, actual - upper)
            for lower, upper, actual in zip(
                calibration_point["lower"],
                calibration_point["upper"],
                calibration_point["actual"],
            )
        ]
        correction = finite_sample_quantile(scores, 0.80)
        conformal_corrections[str(horizon)] = round(correction, 4)

        evaluated = validation["point"][horizon]
        model_mae = mae(evaluated["errors"])
        persistence_mae = mae(evaluated["persistence_errors"])
        skill = (
            1 - model_mae / persistence_mae
            if model_mae is not None and persistence_mae not in (None, 0)
            else None
        )
        adjusted_lower = [value - correction for value in evaluated["lower"]]
        adjusted_upper = [value + correction for value in evaluated["upper"]]
        coverage = [
            int(lower <= actual <= upper)
            for lower, upper, actual in zip(
                adjusted_lower, adjusted_upper, evaluated["actual"]
            )
        ]
        widths = [
            upper - lower for lower, upper in zip(adjusted_lower, adjusted_upper)
        ]
        point_metrics[str(horizon)] = {
            "sample_size": len(evaluated["errors"]),
            "mae_m": model_mae,
            "persistence_mae_m": persistence_mae,
            "mae_skill_vs_persistence": round(skill, 3) if skill is not None else None,
            "interval_80_coverage": round(mean(coverage), 3) if coverage else None,
            "median_interval_width_m": round(statistics.median(widths), 3)
            if widths
            else None,
            "conformal_correction_m": round(correction, 3),
            "preferred_central": (
                "analog_median"
                if skill is not None and skill >= MIN_POINT_SKILL
                else "persistence"
            ),
        }

    probability_metrics: dict[str, Any] = {}
    for threshold in THRESHOLDS:
        for horizon in HORIZONS:
            key = (threshold, horizon)
            calibration_case = calibration["probabilities"][key]
            validation_case = validation["probabilities"][key]
            parameters = fit_platt(
                calibration_case["probabilities"], calibration_case["outcomes"]
            )
            probabilities = [
                calibrated_probability(probability, parameters)
                for probability in validation_case["probabilities"]
            ]
            outcomes = validation_case["outcomes"]
            calibration_rate = (
                (sum(calibration_case["outcomes"]) + 0.5)
                / (len(calibration_case["outcomes"]) + 1)
                if calibration_case["outcomes"]
                else 0.5
            )
            references = [calibration_rate] * len(outcomes)
            model_brier = brier(probabilities, outcomes)
            reference_brier = brier(references, outcomes)
            brier_skill = (
                1 - model_brier / reference_brier
                if model_brier is not None and reference_brier not in (None, 0)
                else None
            )
            reliability = reliability_error(probabilities, outcomes)
            event_count = sum(outcomes)
            sample_size = len(outcomes)
            enabled = bool(
                parameters
                and sample_size >= MIN_PROBABILITY_CASES
                and event_count >= MIN_PROBABILITY_EVENTS
                and sample_size - event_count >= MIN_PROBABILITY_EVENTS
                and brier_skill is not None
                and brier_skill >= MIN_BRIER_SKILL
                and reliability is not None
                and reliability <= MAX_RELIABILITY_ERROR
            )
            probability_metrics[f"{threshold:.2f}:{horizon}"] = {
                "sample_size": sample_size,
                "event_count": event_count,
                "non_event_count": sample_size - event_count,
                "calibration_sample_size": len(calibration_case["outcomes"]),
                "calibration_event_count": sum(calibration_case["outcomes"]),
                "calibration_parameters": parameters,
                "reference": "frecuencia del evento en el bloque de calibración",
                "reference_probability": round(calibration_rate, 4),
                "brier_score": round(model_brier, 4) if model_brier is not None else None,
                "reference_brier_score": (
                    round(reference_brier, 4) if reference_brier is not None else None
                ),
                "brier_skill_score": round(brier_skill, 3)
                if brier_skill is not None
                else None,
                "reliability_error": round(reliability, 3)
                if reliability is not None
                else None,
                "enabled": enabled,
                "reason": (
                    "calibración y validación temporal aprobadas"
                    if enabled
                    else (
                        "no supera simultáneamente casos, eventos, BSS ≥ 0,05 "
                        "y error de confiabilidad ≤ 0,12"
                    )
                ),
            }

    return {
        "strategy": (
            "bloques temporales 60/20/20: entrenamiento, calibración y validación final"
        ),
        "training_start": training[0].isoformat(),
        "training_end": training[-1].isoformat(),
        "calibration_start": calibration_all[0].isoformat(),
        "calibration_end": calibration_all[-1].isoformat(),
        "validation_start": validation_all[0].isoformat(),
        "validation_end": validation_all[-1].isoformat(),
        "calibration_origins": len(calibration["usable"]),
        "validation_origins": len(validation["usable"]),
        "validation_stride_days": VALIDATION_STRIDE_DAYS,
        "interval_target_coverage": 0.80,
        "conformal_corrections_m": conformal_corrections,
        "probability_gate": {
            "minimum_cases": MIN_PROBABILITY_CASES,
            "minimum_events_and_non_events": MIN_PROBABILITY_EVENTS,
            "minimum_brier_skill_score": MIN_BRIER_SKILL,
            "maximum_reliability_error": MAX_RELIABILITY_ERROR,
        },
        "minimum_point_mae_skill": MIN_POINT_SKILL,
        "point_metrics": point_metrics,
        "probability_metrics": probability_metrics,
    }


def build_forecast(
    history: dict[str, Any], current_level: float, generated: datetime
) -> tuple[list[dict[str, Any]], dict[str, Any], list[AnalogMember]]:
    network = build_network(history)
    origins = feasible_origins(network)
    feature_cache = {origin: feature_vector(network, origin) for origin in origins}
    validation = validate(network, origins, feature_cache)

    latest_day = max(network["concordia"])
    operational_candidates = [
        origin for origin in origins if origin <= latest_day - timedelta(days=31)
    ]
    operational_features = feature_vector(
        network, latest_day, local_override=current_level
    )
    scales = robust_scales(feature_cache, operational_candidates)
    members = select_analogs(
        network,
        operational_features,
        operational_candidates,
        feature_cache,
        scales,
        current_level=current_level,
    )
    weights = [member.weight for member in members]
    raw_summaries: dict[int, tuple[float, float, float]] = {0: (current_level,) * 3}
    for lead in range(1, MAX_HORIZON + 1):
        values = [member.path[lead] for member in members]
        raw_summaries[lead] = (
            weighted_quantile(values, weights, 0.10),
            weighted_quantile(values, weights, 0.50),
            weighted_quantile(values, weights, 0.90),
        )

    def interpolate(values: dict[int, float], lead: int) -> float:
        anchors = sorted(values)
        lower = max((anchor for anchor in anchors if anchor <= lead), default=anchors[0])
        upper = min((anchor for anchor in anchors if anchor >= lead), default=anchors[-1])
        if lower == upper:
            return values[lower]
        fraction = (lead - lower) / (upper - lower)
        return values[lower] * (1 - fraction) + values[upper] * fraction

    central_anchors = {0: current_level}
    for anchor in VALIDATION_HORIZONS:
        metric = validation["point_metrics"][str(anchor)]
        central_anchors[anchor] = (
            raw_summaries[anchor][1]
            if metric["preferred_central"] == "analog_median"
            else current_level
        )
    correction_anchors = {
        int(horizon): correction
        for horizon, correction in validation["conformal_corrections_m"].items()
    }
    correction_anchors[0] = 0.0

    projection: list[dict[str, Any]] = []
    for lead in range(MAX_HORIZON + 1):
        p10, _, p90 = raw_summaries[lead]
        correction = interpolate(correction_anchors, lead)
        p10 -= correction
        p90 += correction
        p50 = interpolate(central_anchors, lead)
        validation_metric = validation["point_metrics"].get(str(lead))
        uncertainty = "Moderada" if lead <= 3 else "Alta" if lead <= 7 else "Muy alta"
        projection.append(
            {
                "day": lead,
                "date": (generated + timedelta(days=lead)).isoformat(),
                "min": round(p10, 2),
                "central": round(p50, 2),
                "max": round(p90, 2),
                "interval": "P10–P90 conformalizado",
                "uncertainty": uncertainty,
                "risk": "Alto" if p90 >= 12.5 else "Medio" if p90 >= 11 else "Bajo",
                "basis": "ctm_analog_ensemble",
                "validation": validation_metric,
            }
        )

    model = {
        "model_id": "ctm-analog-ensemble-v1.1",
        "label": "Ensamble local de análogos hidrométricos",
        "status": "validated_with_limits",
        "generated_at": generated.isoformat(),
        "training_source": "CTM Salto Grande · red de estaciones de 15 minutos agregada por día",
        "training_start": min(network["concordia"]).isoformat(),
        "training_end": latest_day.isoformat(),
        "member_count": len(members),
        "effective_member_count": round(effective_member_count(members), 1),
        "predictors": list(FEATURE_WEIGHTS),
        "interval_definition": (
            "percentiles ponderados 10 y 90, ampliados mediante split conformal "
            "en un bloque temporal separado con cobertura objetivo del 80 %"
        ),
        "central_definition": (
            "mediana del ensamble cuando supera persistencia en validación; "
            "persistencia en los horizontes sin habilidad positiva"
        ),
        "validation": validation,
        "limitations": [
            "No anticipa decisiones futuras de operación de la represa.",
            "La probabilidad se calibra en un bloque temporal y se deshabilita cuando el bloque final no demuestra habilidad suficiente.",
            "GEOGLOWS se conserva como señal de caudal separada hasta acumular re-pronósticos locales para validarla.",
        ],
    }
    return projection, model, members


def build_risk_report(
    state: dict[str, Any],
    projection: list[dict[str, Any]],
    model: dict[str, Any],
    members: list[AnalogMember],
    generated: datetime,
) -> dict[str, Any]:
    effective_n = effective_member_count(members)
    reports: list[dict[str, Any]] = []
    for threshold in THRESHOLDS:
        rows: list[dict[str, Any]] = []
        for horizon in HORIZONS:
            raw_probability = ensemble_probability(members, threshold, horizon)
            validation = model["validation"]["probability_metrics"][
                f"{threshold:.2f}:{horizon}"
            ]
            enabled = bool(validation["enabled"])
            parameters = validation.get("calibration_parameters")
            probability = calibrated_probability(raw_probability, parameters)
            probability_pct = round(probability * 100) if enabled else None
            raw_interval = wilson_interval(raw_probability, effective_n)
            calibrated_interval = [
                round(
                    calibrated_probability(bound / 100, parameters) * 100
                )
                for bound in raw_interval
            ]
            rows.append(
                {
                    "horizon_days": horizon,
                    "classification": classification(probability_pct),
                    "central_estimate_pct": probability_pct,
                    "raw_ensemble_probability_pct": round(raw_probability * 100),
                    "plausible_interval_pct": (
                        calibrated_interval if enabled else None
                    ),
                    "classification_uncertainty": (
                        "Moderada" if horizon == 7 else "Alta" if horizon == 14 else "Muy alta"
                    ),
                    "scenario_min_m": projection[horizon]["min"],
                    "scenario_central_m": projection[horizon]["central"],
                    "scenario_max_m": projection[horizon]["max"],
                    "validation": validation,
                }
            )
        reports.append(
            {
                "threshold_m": threshold,
                "condition": (
                    f"alcanzar o superar {threshold:.2f} m al menos una vez "
                    "dentro de cada período"
                ).replace(".", ","),
                "rows": rows,
            }
        )

    # Las calibraciones se estiman por celda. Este ajuste conservador final
    # preserva una propiedad física básica: para un mismo horizonte, la
    # probabilidad publicada no puede crecer al aumentar el nivel objetivo.
    for horizon in HORIZONS:
        previous_probability = 100
        for report in reports:
            row = next(item for item in report["rows"] if item["horizon_days"] == horizon)
            if row["central_estimate_pct"] is None:
                continue
            row["central_estimate_pct"] = min(
                previous_probability, row["central_estimate_pct"]
            )
            if row["plausible_interval_pct"]:
                lower, upper = row["plausible_interval_pct"]
                row["plausible_interval_pct"] = [
                    min(lower, row["central_estimate_pct"]),
                    max(upper, row["central_estimate_pct"]),
                ]
            row["classification"] = classification(row["central_estimate_pct"])
            previous_probability = row["central_estimate_pct"]

    current = next(
        observation["value"]
        for observation in state["observations"]
        if observation["variable"] == "river_stage"
    )
    return {
        "id": generated.isoformat(),
        "generated_at": generated.isoformat(),
        "station": "Puerto Concordia",
        "method": {
            "method_id": model["model_id"],
            "calibrated": True,
            "validated": True,
            "label": model["label"],
            "note": (
                "La frecuencia ponderada de superación en 60 trayectorias análogas se "
                "calibra en un bloque temporal separado. Cada celda se publica sólo si "
                "en el bloque final obtiene BSS ≥ 0,05 frente a la climatología del bloque "
                "de calibración y cumple los controles de confiabilidad y cantidad de eventos."
            ),
        },
        "data_status": state.get("update_status", {}).get("state", "stale"),
        "snapshot": {
            "concordia_m": current,
            "released_flow_m3s": state.get("signals", {}).get("released_flow_m3s"),
            "rainfall_7d_mm": state.get("signals", {}).get("rainfall_7d_mm"),
        },
        "thresholds": reports,
    }


if __name__ == "__main__":
    history = load_history()
    network = build_network(history)
    latest_day = max(network["concordia"])
    current = value(network, "concordia", latest_day)
    if current is None:
        raise SystemExit("sin altura actual")
    projection, model, members = build_forecast(
        history, current, datetime.now().astimezone()
    )
    print(
        json.dumps(
            {
                "latest_day": latest_day.isoformat(),
                "current": current,
                "members": len(members),
                "projection": [
                    projection[index] for index in (0, 7, 14, 21, 28, 30)
                ],
                "validation": model["validation"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
