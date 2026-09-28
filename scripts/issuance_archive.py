#!/usr/bin/env python3
"""Append-only, hash-chained archive for forecasts actually issued.

The public JSONL files are a transparent pilot implementation. A municipal
deployment should replicate them to managed object storage with retention and
access controls, while preserving the same record hashes.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DIRECTORY = ROOT / "public" / "data"
INDEX_NAME = "forecast_issuance_index.json"
ARCHIVE_DIRECTORY = "forecast_issuances"


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def record_hash(record: dict[str, Any]) -> str:
    unhashed = {key: value for key, value in record.items() if key != "record_hash"}
    return hashlib.sha256(canonical_bytes(unhashed)).hexdigest()


def _atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(content, encoding="utf-8")
    temporary.replace(path)


def _load_index(directory: Path) -> dict[str, Any]:
    path = directory / INDEX_NAME
    if not path.exists():
        return {
            "schema_version": 1,
            "chain_algorithm": "sha256",
            "record_count": 0,
            "first_issued_at": None,
            "last_issued_at": None,
            "head_hash": None,
            "files": {},
        }
    index = json.loads(path.read_text(encoding="utf-8"))
    if index.get("schema_version") != 1 or index.get("chain_algorithm") != "sha256":
        raise ValueError("índice de emisiones incompatible")
    return index


def _load_records(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def verify_records(records: Iterable[dict[str, Any]], initial_hash: str | None = None) -> str | None:
    previous = initial_hash
    for record in records:
        if record.get("previous_hash") != previous:
            raise ValueError(f"cadena rota antes de {record.get('issued_at')}")
        calculated = record_hash(record)
        if record.get("record_hash") != calculated:
            raise ValueError(f"huella inválida en {record.get('issued_at')}")
        previous = calculated
    return previous


def build_issuance_record(
    state: dict[str, Any], report: dict[str, Any], projection: list[dict[str, Any]],
    model: dict[str, Any], members: Iterable[Any], previous_hash: str | None,
) -> dict[str, Any]:
    stage = next(item for item in state["observations"] if item["variable"] == "river_stage")
    compact_thresholds = []
    for threshold in report["thresholds"]:
        compact_thresholds.append({
            "threshold_m": threshold["threshold_m"],
            "rows": [{
                key: row.get(key) for key in (
                    "horizon_days", "central_estimate_pct", "plausible_interval_pct",
                    "raw_ensemble_probability_pct", "estimate_basis", "estimate_status",
                    "evidence_confidence", "scenario_min_m", "scenario_central_m",
                    "scenario_max_m",
                )
            } for row in threshold["rows"]],
        })
    record = {
        "schema_version": 1,
        "issued_at": report["generated_at"],
        "station": report["station"],
        "observation": {
            key: stage.get(key) for key in (
                "source_id", "station_id", "observed_at_local", "retrieved_at",
                "value", "unit", "quality_flag", "source_reference",
            )
        },
        "data_status": report["data_status"],
        "source_status": state.get("source_status", {}),
        "model": {
            "model_id": model["model_id"],
            "status": model["status"],
            "training_start": model.get("training_start"),
            "training_end": model.get("training_end"),
            "member_count": model.get("member_count"),
            "effective_member_count": model.get("effective_member_count"),
            "validation_sha256": hashlib.sha256(
                canonical_bytes(model.get("validation", {}))
            ).hexdigest(),
            "members": [{
                "origin": member.origin.isoformat(),
                "distance": round(float(member.distance), 6),
                "weight": round(float(member.weight), 9),
            } for member in members],
        },
        "external_forecasts": {
            key: {
                field: value.get(field) for field in (
                    "generated_at", "valid_until", "river_id", "unit", "quality_flag"
                ) if field in value
            }
            for key, value in state.get("external_forecasts", {}).items()
        },
        "projection": [{
            key: point.get(key) for key in (
                "day", "date", "min", "central", "max", "interval", "basis"
            )
        } for point in projection],
        "thresholds": compact_thresholds,
        "previous_hash": previous_hash,
    }
    record["record_hash"] = record_hash(record)
    return record


def append_forecast_issuance(
    state: dict[str, Any], report: dict[str, Any], projection: list[dict[str, Any]],
    model: dict[str, Any], members: Iterable[Any], directory: Path = DEFAULT_DIRECTORY,
) -> dict[str, Any]:
    issued = datetime.fromisoformat(report["generated_at"])
    relative = f"{ARCHIVE_DIRECTORY}/{issued:%Y-%m}.jsonl"
    archive_path = directory / relative
    index_path = directory / INDEX_NAME
    index = _load_index(directory)
    records = _load_records(archive_path)

    file_meta = index.get("files", {}).get(relative)
    initial_hash = file_meta.get("previous_file_hash") if file_meta else index.get("head_hash")
    verified_head = verify_records(records, initial_hash)
    if records and verified_head != index.get("head_hash"):
        raise ValueError("la cabecera del índice no coincide con el archivo mensual")

    existing = next((item for item in records if item.get("issued_at") == report["generated_at"]), None)
    if existing:
        candidate = build_issuance_record(
            state, report, projection, model, members, existing.get("previous_hash")
        )
        if candidate != existing:
            raise ValueError("una emisión existente no puede reescribirse")
        return {"appended": False, "record_hash": existing["record_hash"], "path": relative}

    previous_hash = index.get("head_hash")
    record = build_issuance_record(state, report, projection, model, members, previous_hash)
    records.append(record)
    _atomic_write(archive_path, "".join(
        json.dumps(item, ensure_ascii=False, sort_keys=True, allow_nan=False) + "\n"
        for item in records
    ))

    meta = index.setdefault("files", {}).setdefault(relative, {
        "previous_file_hash": previous_hash,
        "record_count": 0,
        "first_issued_at": record["issued_at"],
    })
    meta["record_count"] = len(records)
    meta["last_issued_at"] = record["issued_at"]
    meta["head_hash"] = record["record_hash"]
    index["record_count"] = int(index.get("record_count", 0)) + 1
    index["first_issued_at"] = index.get("first_issued_at") or record["issued_at"]
    index["last_issued_at"] = record["issued_at"]
    index["head_hash"] = record["record_hash"]
    _atomic_write(index_path, json.dumps(index, ensure_ascii=False, indent=2) + "\n")
    return {"appended": True, "record_hash": record["record_hash"], "path": relative}
