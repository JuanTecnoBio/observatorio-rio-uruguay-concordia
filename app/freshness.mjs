/** Derive live freshness from the viewer's clock, not from a frozen JSON timestamp. */
export function deriveOperationalFreshness({
  nowMs,
  observedAt,
  forecastIssuedAt,
  sourceState = "fresh",
}) {
  const ageHours = (iso) => {
    const parsed = Date.parse(iso ?? "");
    return Number.isFinite(parsed) ? Math.max(0, (nowMs - parsed) / 3_600_000) : Infinity;
  };
  const stageAgeHours = ageHours(observedAt);
  const forecastAgeHours = ageHours(forecastIssuedAt);
  const state =
    sourceState === "stale" || stageAgeHours > 18 || forecastAgeHours > 24
      ? "stale"
      : sourceState === "partial" || stageAgeHours > 6 || forecastAgeHours > 6
        ? "partial"
        : "fresh";
  let message;
  if (!Number.isFinite(stageAgeHours)) message = "La altura no informa una hora de observación válida.";
  else if (stageAgeHours > 18) message = `La última altura tiene ${Math.floor(stageAgeHours)} horas de antigüedad.`;
  else if (!Number.isFinite(forecastAgeHours)) message = "El escenario no informa una hora de emisión válida.";
  else if (forecastAgeHours > 24) message = `El escenario tiene ${Math.floor(forecastAgeHours)} horas de antigüedad.`;
  else if (stageAgeHours > 6) message = `La última altura tiene ${Math.floor(stageAgeHours)} horas de antigüedad.`;
  else if (forecastAgeHours > 6) message = `El escenario tiene ${Math.floor(forecastAgeHours)} horas de antigüedad.`;
  return { state, message, stageAgeHours, forecastAgeHours };
}
