import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, root), "utf8"));
}

test("publishes a traceable current level and the official thresholds", async () => {
  const state = await readJson("public/data/current_state.json");
  const concordia = state.observations.find(
    (observation) => observation.station_id === "CONCORDIA_PNA",
  );

  assert.equal(Number.isFinite(concordia.value), true);
  assert.ok(concordia.value >= -2 && concordia.value <= 20);
  assert.equal(concordia.unit, "m");
  assert.equal(concordia.is_official, true);
  assert.ok(["pna_alturas", "ctm_concordia_stage"].includes(concordia.source_id));
  assert.ok(Date.parse(concordia.observed_at_local) <= Date.parse(state.generated_at));
  assert.equal(state.thresholds.alert_m, 11);
  assert.equal(state.thresholds.evacuation_m, 12.5);
});

test("uses the temporally validated analog ensemble and coherent intervals", async () => {
  const state = await readJson("public/data/current_state.json");
  const model = state.forecast_method;

  assert.equal(model.model_id, "ctm-analog-ensemble-v1.1");
  assert.equal(model.member_count, 60);
  assert.match(model.validation.strategy, /60\/20\/20/);
  assert.ok(model.validation.calibration_origins >= 80);
  assert.ok(model.validation.validation_origins >= 80);
  assert.equal(model.validation.validation_stride_days, 7);
  assert.equal(state.projection.length, 31);

  for (const point of state.projection) {
    assert.ok(point.min <= point.central, `lower bound at day ${point.day}`);
    assert.ok(point.central <= point.max, `upper bound at day ${point.day}`);
    assert.match(point.interval, /conformalizado/);
  }

  for (const horizon of [7, 14, 21, 28, 30]) {
    const metric = model.validation.point_metrics[String(horizon)];
    assert.ok(metric.sample_size >= 80);
    assert.ok(metric.mae_m > 0);
    assert.ok(metric.persistence_mae_m > 0);
    assert.ok(metric.interval_80_coverage >= 0 && metric.interval_80_coverage <= 1);
  }
});

test("publishes probabilities only for cells that pass every validation gate", async () => {
  const state = await readJson("public/data/current_state.json");
  const archive = await readJson("public/data/risk_reports.json");
  const report = state.risk_report_bundle;
  const thresholds = [11, 11.25, 11.5, 11.75, 12, 12.25];

  assert.equal(archive.schema_version, 3);
  assert.deepEqual(archive.thresholds_m, thresholds);
  assert.deepEqual(report.thresholds.map((item) => item.threshold_m), thresholds);
  assert.equal(report.method.calibrated, true);
  assert.equal(report.method.validated, true);
  assert.equal(report.method.method_id, "ctm-analog-ensemble-v1.1");

  for (const thresholdReport of report.thresholds) {
    assert.deepEqual(
      thresholdReport.rows.map((row) => row.horizon_days),
      [7, 14, 21, 28],
    );
    for (const row of thresholdReport.rows) {
      assert.ok(row.validation);
      if (row.validation.enabled) {
        assert.ok(row.central_estimate_pct >= 0 && row.central_estimate_pct <= 100);
        assert.ok(row.plausible_interval_pct[0] <= row.central_estimate_pct);
        assert.ok(row.plausible_interval_pct[1] >= row.central_estimate_pct);
        assert.ok(row.validation.sample_size >= 80);
        assert.ok(row.validation.event_count >= 10);
        assert.ok(row.validation.non_event_count >= 10);
        assert.ok(row.validation.brier_skill_score >= 0.05);
        assert.ok(row.validation.reliability_error <= 0.12);
      } else {
        assert.equal(row.central_estimate_pct, null);
        assert.equal(row.plausible_interval_pct, null);
        assert.equal(row.classification, "NO HABILITADA");
      }
    }
  }

  for (const horizon of [7, 14, 21, 28]) {
    const published = report.thresholds
      .map((item) => item.rows.find((row) => row.horizon_days === horizon).central_estimate_pct)
      .filter((value) => value !== null);
    assert.deepEqual(published, [...published].sort((a, b) => b - a));
  }

  assert.ok(archive.reports.length >= 1);
  assert.equal(new Set(archive.reports.map((item) => item.id)).size, archive.reports.length);
});

test("archives the CTM network and keeps GEOGLOWS in discharge units", async () => {
  const state = await readJson("public/data/current_state.json");
  const history = await readJson("public/data/hydrometric_history.json");
  const flowArchive = await readJson("public/data/flow_forecast_archive.json");

  assert.deepEqual(
    Object.keys(history.stations).sort(),
    ["concordia", "federacion", "monte_caseros", "paso_libres", "salto_grande"],
  );
  assert.ok(history.stations.concordia.records[0].date <= "2017-01-01");
  assert.ok(history.stations.concordia.records.length >= 3400);

  const geoglows = state.external_forecasts.geoglows;
  assert.equal(geoglows.unit, "m3/s");
  assert.equal(geoglows.river_id, 640460565);
  assert.ok(geoglows.daily.length >= 10);
  assert.match(geoglows.quality_flag, /not_stage_calibrated/);
  assert.ok(flowArchive.forecasts.length >= 1);
});

test("keeps the official CTM forecast bounded by its stated validity", async () => {
  const state = await readJson("public/data/current_state.json");
  const forecast = state.official_forecast;

  assert.equal(Number.isFinite(forecast.concordia_max_m), true);
  assert.ok(forecast.concordia_max_m <= 15);
  if (forecast.concordia_min_m !== null) {
    assert.equal(Number.isFinite(forecast.concordia_min_m), true);
    assert.ok(forecast.concordia_min_m >= 6);
    assert.ok(forecast.concordia_min_m <= forecast.concordia_max_m);
  }
  assert.ok(Date.parse(forecast.valid_until_local) > Date.parse(forecast.issued_at_local));
  assert.match(forecast.source_reference, /^https:\/\/www\.saltogrande\.org\//);
});

test("catalogues every active observation with an official source", async () => {
  const state = await readJson("public/data/current_state.json");
  const catalog = await readJson("public/data/source_catalog.json");
  const catalogIds = new Set(catalog.sources.map((source) => source.source_id));

  for (const observation of state.observations) {
    assert.equal(observation.is_official, true);
    assert.ok(catalogIds.has(observation.source_id));
    assert.match(observation.source_reference, /^https:\/\//);
    assert.ok(observation.retrieved_at);
  }
});
