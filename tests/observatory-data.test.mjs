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

  assert.equal(concordia.value, 10);
  assert.equal(concordia.unit, "m");
  assert.equal(concordia.is_official, true);
  assert.equal(state.thresholds.alert_m, 11);
  assert.equal(state.thresholds.evacuation_m, 12.5);
  assert.equal(state.probabilities.alert_exceedance, null);
  assert.equal(state.probabilities.evacuation_exceedance, null);
  assert.match(state.probabilities.reason, /calibrado y validado/i);
});

test("keeps the official CTM forecast bounded by its stated validity", async () => {
  const state = await readJson("public/data/current_state.json");
  const forecast = state.official_forecast;

  assert.equal(forecast.concordia_min_m, 9.7);
  assert.equal(forecast.concordia_max_m, 10.2);
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
