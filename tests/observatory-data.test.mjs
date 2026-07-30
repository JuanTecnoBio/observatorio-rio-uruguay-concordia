import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, root), "utf8"));
}

test("publishes Concordia observations without invented probabilities", async () => {
  const state = await readJson("public/data/current_state.json");
  const concordia = state.observations.find(
    (observation) => observation.station_id === "CONCORDIA_PNA",
  );

  assert.equal(Number.isFinite(concordia.value), true);
  assert.ok(concordia.value >= -2 && concordia.value <= 20);
  assert.equal(concordia.unit, "m");
  assert.equal(concordia.is_official, true);
  assert.equal(state.thresholds.alert_m, 11);
  assert.equal(state.thresholds.evacuation_m, 12.5);
  assert.equal(state.probabilities.alert_exceedance, null);
  assert.equal(state.probabilities.evacuation_exceedance, null);
  assert.match(state.probabilities.reason, /calibrado y validado/i);
});

test("archives six ordered exploratory thresholds without presenting them as calibrated", async () => {
  const state = await readJson("public/data/current_state.json");
  const archive = await readJson("public/data/risk_reports.json");
  const report = state.risk_report_bundle;
  const thresholds = [11, 11.25, 11.5, 11.75, 12, 12.25];

  assert.equal(archive.schema_version, 2);
  assert.deepEqual(archive.thresholds_m, thresholds);
  assert.deepEqual(
    report.thresholds.map((item) => item.threshold_m),
    thresholds,
  );
  assert.equal(report.method.calibrated, false);
  assert.match(report.method.note, /no es una probabilidad estadística calibrada/i);

  for (const thresholdReport of report.thresholds) {
    assert.deepEqual(
      thresholdReport.rows.map((row) => row.horizon_days),
      [7, 14, 21, 28],
    );
    for (const row of thresholdReport.rows) {
      assert.ok(row.central_estimate_pct >= 0 && row.central_estimate_pct <= 100);
      assert.ok(row.plausible_interval_pct[0] <= row.central_estimate_pct);
      assert.ok(row.plausible_interval_pct[1] >= row.central_estimate_pct);
    }
  }

  for (const horizon of [7, 14, 21, 28]) {
    const estimates = report.thresholds.map(
      (item) =>
        item.rows.find((row) => row.horizon_days === horizon)
          .central_estimate_pct,
    );
    assert.deepEqual(estimates, [...estimates].sort((a, b) => b - a));
  }

  assert.ok(archive.reports.length >= 1);
  assert.equal(new Set(archive.reports.map((item) => item.id)).size, archive.reports.length);
  assert.equal(archive.method.calibrated, false);
});

test("keeps the official CTM forecast bounded by its stated validity", async () => {
  const state = await readJson("public/data/current_state.json");
  const forecast = state.official_forecast;

  assert.equal(Number.isFinite(forecast.concordia_min_m), true);
  assert.equal(Number.isFinite(forecast.concordia_max_m), true);
  assert.ok(forecast.concordia_min_m >= 6);
  assert.ok(forecast.concordia_max_m <= 15);
  assert.ok(forecast.concordia_min_m <= forecast.concordia_max_m);
  assert.ok(
    Date.parse(forecast.valid_until_local) > Date.parse(forecast.issued_at_local),
  );
  assert.match(forecast.source_reference, /^https:\/\/www\.saltogrande\.org\//);
});

test("catalogues every active datum with an official source", async () => {
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

test("discloses that the observatory category is not official", async () => {
  const state = await readJson("public/data/current_state.json");
  const bulletin = await readFile(
    new URL("public/boletines/2026-07-29.md", root),
    "utf8",
  );

  assert.equal(state.status.observatory_risk_is_official, false);
  assert.match(bulletin, /No es una categoría oficial/i);
  assert.match(bulletin, /no emite órdenes de evacuación/i);
});
