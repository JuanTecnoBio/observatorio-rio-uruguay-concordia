import json
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from forecast_model import AnalogMember  # noqa: E402
from issuance_archive import append_forecast_issuance, verify_records  # noqa: E402


def fixture(issued_at: str, value: float = 7.5):
    state = {
        "observations": [{"variable": "river_stage", "source_id": "official", "station_id": "P",
                          "observed_at_local": issued_at, "retrieved_at": issued_at, "value": value,
                          "unit": "m", "quality_flag": "official", "source_reference": "https://example.test"}],
        "source_status": {"official": {"ok": True}}, "external_forecasts": {},
    }
    rows = [{"horizon_days": 7, "central_estimate_pct": 10, "plausible_interval_pct": [2, 30],
             "raw_ensemble_probability_pct": 10, "estimate_basis": "raw_analog_frequency",
             "estimate_status": "exploratory", "evidence_confidence": "Baja",
             "scenario_min_m": 6, "scenario_central_m": 7, "scenario_max_m": 9}]
    report = {"generated_at": issued_at, "station": "Puerto", "data_status": "fresh",
              "thresholds": [{"threshold_m": 11, "rows": rows}]}
    projection = [{"day": 0, "date": issued_at, "min": value, "central": value, "max": value,
                   "interval": "observed", "basis": "official"}]
    model = {"model_id": "test-v1", "status": "experimental", "training_start": "2017-01-01",
             "training_end": "2026-01-01", "member_count": 1, "effective_member_count": 1,
             "validation": {"kind": "test"}}
    members = [AnalogMember(date(2020, 1, 1), 0.2, 1, [value], [value])]
    return state, report, projection, model, members


class IssuanceArchiveTests(unittest.TestCase):
    def test_append_is_hash_chained_and_idempotent(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            first = fixture("2026-09-10T10:00:00-03:00")
            second = fixture("2026-09-10T11:00:00-03:00", 7.6)
            one = append_forecast_issuance(*first, directory=directory)
            again = append_forecast_issuance(*first, directory=directory)
            two = append_forecast_issuance(*second, directory=directory)
            self.assertTrue(one["appended"])
            self.assertFalse(again["appended"])
            self.assertTrue(two["appended"])
            records = [json.loads(line) for line in
                       (directory / "forecast_issuances/2026-09.jsonl").read_text().splitlines()]
            self.assertEqual(verify_records(records), two["record_hash"])
            index = json.loads((directory / "forecast_issuance_index.json").read_text())
            self.assertEqual(index["record_count"], 2)
            self.assertEqual(index["head_hash"], two["record_hash"])

    def test_existing_issuance_cannot_be_rewritten(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            original = fixture("2026-09-10T10:00:00-03:00")
            append_forecast_issuance(*original, directory=directory)
            with self.assertRaisesRegex(ValueError, "no puede reescribirse"):
                append_forecast_issuance(*fixture("2026-09-10T10:00:00-03:00", 9), directory=directory)

    def test_tampering_breaks_verification(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            append_forecast_issuance(*fixture("2026-09-10T10:00:00-03:00"), directory=directory)
            path = directory / "forecast_issuances/2026-09.jsonl"
            record = json.loads(path.read_text())
            record["observation"]["value"] = 99
            with self.assertRaisesRegex(ValueError, "huella inválida"):
                verify_records([record])


if __name__ == "__main__":
    unittest.main()
