"""Regression cases for municipal forecast review; no network required."""
import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from forecast_model import (  # noqa: E402
    AnalogMember, MAX_HORIZON, ensemble_probability, feasible_origins,
    nonoverlapping_window_count, purged_temporal_blocks, select_analogs,
    feature_vector, robust_scales,
)


class ForecastIntegrityTests(unittest.TestCase):
    def test_labels_never_cross_temporal_boundaries(self):
        days = [date(2010, 1, 1) + timedelta(days=i) for i in range(1400)]
        training, calibration, validation = purged_temporal_blocks(days)
        self.assertLess(training[-1] + timedelta(days=30), calibration[0])
        self.assertLess(calibration[-1] + timedelta(days=30), validation[0])
        self.assertEqual(len(set(training) & set(calibration)), 0)

    def test_purge_uses_calendar_days_with_missing_observations(self):
        days = [date(2010, 1, 1) + timedelta(days=i) for i in range(1800) if i % 5]
        training, calibration, validation = purged_temporal_blocks(days)
        self.assertLess(training[-1] + timedelta(days=30), calibration[0])
        self.assertLess(calibration[-1] + timedelta(days=30), validation[0])

    def test_detects_peak_hidden_by_daily_median(self):
        member = AnalogMember(date(2020, 1, 1), 0, 1, [10, 10, 10], [10, 12, 10])
        self.assertEqual(ensemble_probability([member], 11, 1), 1)
        self.assertEqual(ensemble_probability([member], 12.25, 2), 0)

    def test_exceedance_is_monotone_across_horizons_and_levels(self):
        members = [
            AnalogMember(date(2020, 1, 1), 0, .4, [10]*3, [10, 11, 12]),
            AnalogMember(date(2021, 1, 1), 0, .6, [10]*3, [10, 10, 11.5]),
        ]
        self.assertEqual([ensemble_probability(members, 11.5, h) for h in (1, 2)], [0, 1])
        self.assertEqual([ensemble_probability(members, t, 2) for t in (11, 11.5, 12, 12.25)], [1, 1, .4, 0])

    def test_overlapping_positive_windows_are_not_counted_as_independent(self):
        origins = [date(2020, 1, 1) + timedelta(days=i) for i in (0, 7, 14, 21, 35)]
        self.assertEqual(nonoverlapping_window_count(origins, 28), 2)

    def test_missing_maximum_makes_origin_ineligible(self):
        start = date(2020, 1, 1)
        records = {start + timedelta(days=i): {"level_m": 10, "level_max_m": 11} for i in range(60)}
        network = {"concordia": records}
        origin = start + timedelta(days=14)
        self.assertIn(origin, feasible_origins(network))
        del records[origin + timedelta(days=1)]["level_max_m"]
        self.assertNotIn(origin, feasible_origins(network))

    def test_selected_maxima_shift_from_median_and_exclude_past_day_zero_peak(self):
        start = date(2020, 1, 1)
        record = {"level_m": 10, "level_max_m": 12, "rain_mm": 0}
        network = {station: {start + timedelta(days=i): dict(record) for i in range(120)}
                   for station in ("concordia", "paso_libres", "monte_caseros", "federacion", "salto_grande")}
        origins = feasible_origins(network)
        cache = {d: feature_vector(network, d) for d in origins}
        members = select_analogs(network, cache[origins[-1]], origins, cache,
                                 robust_scales(cache, origins), current_level=9)
        self.assertTrue(all(m.maximum_path[0] == 9 for m in members))
        self.assertTrue(all(m.maximum_path[1] == 11 for m in members))
        self.assertEqual(ensemble_probability(members, 10, 0), 0)
        self.assertAlmostEqual(ensemble_probability(members, 10, MAX_HORIZON), 1)


if __name__ == "__main__":
    unittest.main()
