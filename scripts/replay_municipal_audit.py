#!/usr/bin/env python3
"""Re-evaluate a versioned local snapshot; never fetch or overwrite public data."""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from datetime import datetime
from pathlib import Path

from forecast_model import build_forecast, build_risk_report

ROOT = Path(__file__).resolve().parents[1]


def replay(state: dict, history: dict) -> dict:
    issued = datetime.fromisoformat(state["generated_at"])
    stage = next(x for x in state["observations"] if x["variable"] == "river_stage")
    projection, model, members = build_forecast(history, stage["value"], issued)
    report = build_risk_report(state, projection, model, members, issued)
    validation = model["validation"]
    assert validation["training_label_end"] < validation["calibration_start"]
    assert validation["calibration_label_end"] < validation["validation_start"]
    assert len(projection) == 31
    assert all(p["min"] <= p["central"] <= p["max"] for p in projection)
    assert report["method"]["validated"] is False
    assert report["method"]["calibrated"] is False
    for threshold in report["thresholds"]:
        probabilities = [r["central_estimate_pct"] for r in threshold["rows"]]
        assert probabilities == sorted(probabilities)
        for row in threshold["rows"]:
            assert row["estimate_basis"] == row["validation"]["scored_estimate_basis"]
            assert row["estimate_status"] == "exploratory"
    for h in range(4):
        probabilities = [t["rows"][h]["central_estimate_pct"] for t in report["thresholds"]]
        assert probabilities == sorted(probabilities, reverse=True)
    return {
        "snapshot_at": state["generated_at"],
        "observation": stage,
        "public_data_modified": False,
        "purpose": "diagnóstico retrospectivo; no validación operativa municipal",
        "previous_point_metrics": state["forecast_method"]["validation"]["point_metrics"],
        "previous_event_target": "superación de medianas diarias; no comparar Brier directamente con máximos",
        "model": model,
        "report": report,
        "projection": projection,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", type=Path, default=ROOT / "public/data/current_state.json")
    parser.add_argument("--history", type=Path, default=ROOT / "public/data/hydrometric_history.json")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.resolve().is_relative_to((ROOT / "public/data").resolve()):
        parser.error("El diagnóstico debe guardarse fuera de public/data")
    state_bytes, history_bytes = args.state.read_bytes(), args.history.read_bytes()
    result = replay(json.loads(state_bytes), json.loads(history_bytes))
    tracked_paths = ["scripts/forecast_model.py", "scripts/replay_municipal_audit.py"]
    result["provenance"] = {
        "repository_head_at_run": subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
        ).strip(),
        "state_sha256": hashlib.sha256(state_bytes).hexdigest(),
        "history_sha256": hashlib.sha256(history_bytes).hexdigest(),
        "code_sha256": {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in tracked_paths},
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
    print(json.dumps({"output": str(args.output), "model": result["model"]["model_id"],
                      "rows": sum(len(t["rows"]) for t in result["report"]["thresholds"]),
                      "checks": "passed; not municipal acceptance"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
