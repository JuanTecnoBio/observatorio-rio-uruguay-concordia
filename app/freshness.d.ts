export function deriveOperationalFreshness(input: {
  nowMs: number;
  observedAt?: string;
  forecastIssuedAt?: string;
  sourceState?: "fresh" | "partial" | "stale";
}): {
  state: "fresh" | "partial" | "stale";
  message?: string;
  stageAgeHours: number;
  forecastAgeHours: number;
};
