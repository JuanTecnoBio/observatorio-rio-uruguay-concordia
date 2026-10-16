import assert from "node:assert/strict";
import test from "node:test";
import { deriveOperationalFreshness } from "../app/freshness.mjs";

const now = Date.parse("2026-09-10T12:00:00-03:00");

test("uses the live clock and degrades an otherwise fresh frozen payload", () => {
  const result = deriveOperationalFreshness({
    nowMs: now,
    observedAt: "2026-09-09T12:00:00-03:00",
    forecastIssuedAt: "2026-09-10T10:00:00-03:00",
    sourceState: "fresh",
  });
  assert.equal(result.state, "stale");
  assert.match(result.message, /24 horas/);
});

test("marks a delayed forecast even when the observation is current", () => {
  const result = deriveOperationalFreshness({
    nowMs: now,
    observedAt: "2026-09-10T11:30:00-03:00",
    forecastIssuedAt: "2026-09-10T04:00:00-03:00",
    sourceState: "fresh",
  });
  assert.equal(result.state, "partial");
  assert.match(result.message, /escenario.*8 horas/i);
});

test("never upgrades a failed source status", () => {
  const result = deriveOperationalFreshness({
    nowMs: now,
    observedAt: "2026-09-10T11:30:00-03:00",
    forecastIssuedAt: "2026-09-10T11:30:00-03:00",
    sourceState: "stale",
  });
  assert.equal(result.state, "stale");
});
