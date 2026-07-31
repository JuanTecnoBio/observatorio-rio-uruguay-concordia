"use client";

import {
  AlertTriangle,
  ArrowDown,
  ChevronDown,
  Clock3,
  Database,
  Download,
  ExternalLink,
  FileText,
  Info,
  Menu,
  Phone,
  RefreshCw,
  ShieldAlert,
  Users,
  Waves,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CircleMarker, Map as LeafletMap } from "leaflet";
import initialState from "../public/data/current_state.json";
import initialReportArchive from "../public/data/risk_reports.json";

type Uncertainty = "Moderada" | "Alta" | "Muy alta";
type Risk = "Bajo" | "Medio" | "Alto";

type MonitoringPlace = {
  id: string;
  index: string;
  name: string;
  detail: string;
  locations: Array<{
    name: string;
    lat: number;
    lon: number;
    kind: "reference" | "exposure" | "protection" | "waterway";
  }>;
};

const MONITORING_PLACES: MonitoringPlace[] = [
  {
    id: "puerto",
    index: "01",
    name: "Puerto Concordia",
    detail: "Referencia hidrométrica oficial",
    locations: [{ name: "Puerto Concordia", lat: -31.4017995, lon: -58.0038176, kind: "reference" }],
  },
  {
    id: "costanera",
    index: "02",
    name: "Costanera",
    detail: "Usos públicos y equipamiento expuesto",
    locations: [{ name: "Costanera", lat: -31.4070568, lon: -58.0124236, kind: "exposure" }],
  },
  {
    id: "club",
    index: "03",
    name: "Club Comunicaciones",
    detail: "Instalaciones deportivas junto al río",
    locations: [{ name: "Club Comunicaciones", lat: -31.407312, lon: -58.0137452, kind: "exposure" }],
  },
  {
    id: "defensa",
    index: "04",
    name: "Defensa Sur",
    detail: "Terraplén, compuertas y estaciones de bombeo",
    locations: [{ name: "Defensa Sur", lat: -31.4082906, lon: -58.0197024, kind: "protection" }],
  },
  {
    id: "arroyos",
    index: "05",
    name: "Arroyos Concordia y Manzores",
    detail: "Drenaje urbano condicionado por el río",
    locations: [
      { name: "Arroyo Concordia", lat: -31.4056226, lon: -58.0310753, kind: "waterway" },
      { name: "Arroyo Manzores", lat: -31.3968611, lon: -58.0035936, kind: "waterway" },
    ],
  },
];

type ProjectionPoint = {
  day: number;
  date: string;
  min: number;
  central: number;
  max: number;
  uncertainty: Uncertainty;
  risk: Risk;
  basis: string;
  interval?: string;
  validation?: {
    sample_size: number;
    mae_m: number | null;
    persistence_mae_m: number | null;
    mae_skill_vs_persistence: number | null;
    interval_80_coverage: number | null;
    median_interval_width_m: number | null;
    preferred_central: string;
  } | null;
};

type StationReading = {
  name: string;
  group: "upstream" | "downstream";
  value_m: number;
  variation_m: number | null;
  variation_period_h: number | null;
  trend: string;
  status: string;
  observed_at_local: string;
  source: string;
};

type RiskReportRow = {
  horizon_days: number;
  classification: string;
  central_estimate_pct: number | null;
  raw_ensemble_probability_pct?: number;
  plausible_interval_pct: [number, number] | null;
  classification_uncertainty: string;
  scenario_min_m: number;
  scenario_central_m: number;
  scenario_max_m: number;
  validation?: {
    sample_size: number;
    event_count: number;
    non_event_count?: number;
    calibration_sample_size?: number;
    calibration_event_count?: number;
    brier_score: number | null;
    brier_skill_score: number | null;
    reliability_error: number | null;
    enabled: boolean;
    reason: string;
  };
};

type RiskReportMethod = {
  method_id: string;
  calibrated: boolean;
  validated?: boolean;
  label: string;
  note: string;
};

type ThresholdRiskReport = {
  threshold_m: number;
  condition: string;
  rows: RiskReportRow[];
};

type RiskReportCut = {
  id: string;
  generated_at: string;
  station: string;
  method: RiskReportMethod;
  data_status: "fresh" | "partial" | "stale";
  snapshot: {
    concordia_m: number;
    released_flow_m3s: number | null;
    rainfall_7d_mm: number | null;
  };
  thresholds: ThresholdRiskReport[];
};

type RiskReportArchive = {
  schema_version: number;
  updated_at: string;
  station: string;
  thresholds_m: number[];
  method: RiskReportMethod;
  retention: {
    maximum_reports: number;
    cadence: string;
  };
  reports: RiskReportCut[];
};

type RiverState = {
  generated_at: string;
  timezone: string;
  update_status?: {
    state: "fresh" | "partial" | "stale";
    message: string;
  };
  observations: Array<{
    source_id: string;
    source_name: string;
    variable: string;
    station_id: string;
    station_name: string;
    observed_at_local: string;
    retrieved_at: string;
    value: number;
    unit: string;
    quality_flag: string;
    source_reference: string;
  }>;
  thresholds: {
    alert_m: number;
    evacuation_m: number;
    source: string;
    source_reference: string;
  };
  official_forecast: {
    source: string;
    issued_at_local: string;
    valid_until_local: string;
    concordia_min_m: number | null;
    concordia_max_m: number;
    trend: string;
    mean_daily_released_flow_min_m3s: number;
    mean_daily_released_flow_max_m3s: number;
    source_reference: string;
  };
  history?: Array<{
    date: string;
    label: string;
    value: number;
    source: string;
  }>;
  projection?: ProjectionPoint[];
  stations?: StationReading[];
  signals?: {
    upstream: string;
    rainfall_7d_mm: number | null;
    released_flow_m3s: number | null;
  };
  forecast_method?: {
    model_id: string;
    status: string;
    label?: string;
    description?: string;
    validation: string | {
      strategy: string;
      calibration_start: string;
      calibration_end: string;
      validation_start: string;
      validation_end: string;
      validation_origins: number;
      calibration_origins?: number;
      interval_target_coverage?: number;
      point_metrics: Record<string, unknown>;
      probability_metrics: Record<string, unknown>;
    };
    training_start?: string;
    training_end?: string;
    member_count?: number;
    effective_member_count?: number;
    interval_definition?: string;
  };
  external_forecasts?: {
    geoglows?: {
      generated_at: string;
      valid_until: string;
      unit: string;
      note: string;
      daily: Array<{
        date: string;
        p10_m3s: number;
        median_m3s: number;
        p90_m3s: number;
      }>;
    };
  };
  risk_report_bundle?: RiskReportCut;
};

const OFFICIAL_LINKS = {
  pna: "https://contenidosweb.prefecturanaval.gob.ar/alturas/",
  ctmConcordia: "https://www.saltogrande.org/datos_estacion.php?estacion=A50012EE",
  ctmHourly: "https://www.saltogrande.org/datos_horarios.php",
  ctmBulletin: "https://www.saltogrande.org/docs/hidrologia/Comunicado.pdf",
  ctmRain: "https://www.saltogrande.org/docs/hidrologia/PronosticosP.pdf",
  smn: "https://www.smn.gob.ar/alertas",
  snih: "https://snih.hidricosargentina.gob.ar/",
  caru: "https://www.caru.org.uy/",
  geoglows: "https://geoglows.ecmwf.int/",
};

const LIVE_DATA_BASE =
  "https://juantecnobio.github.io/observatorio-rio-uruguay-concordia/data";

const FALLBACK_STATE = initialState as unknown as RiverState;
const FALLBACK_REPORT_ARCHIVE =
  initialReportArchive as unknown as RiskReportArchive;

const FALLBACK_STATIONS: StationReading[] = [
  { name: "Paso de los Libres", group: "upstream", value_m: 8.62, variation_m: 0.03, variation_period_h: 3, trend: "crece", status: "Evacuación", observed_at_local: "2026-07-29T09:00:00-03:00", source: "PNA" },
  { name: "Alvear", group: "upstream", value_m: 9.68, variation_m: -0.02, variation_period_h: 6, trend: "baja", status: "Alerta", observed_at_local: "2026-07-29T06:00:00-03:00", source: "PNA" },
  { name: "Monte Caseros", group: "upstream", value_m: 6.11, variation_m: 0.11, variation_period_h: 12, trend: "crece", status: "Seguimiento", observed_at_local: "2026-07-29T00:00:00-03:00", source: "PNA" },
  { name: "Mocoretá", group: "upstream", value_m: 7.58, variation_m: 0, variation_period_h: 12, trend: "estable", status: "Seguimiento", observed_at_local: "2026-07-29T00:00:00-03:00", source: "PNA" },
  { name: "Concordia", group: "downstream", value_m: 10, variation_m: 0, variation_period_h: 12, trend: "estable", status: "Seguimiento", observed_at_local: "2026-07-29T00:00:00-03:00", source: "PNA" },
  { name: "Yeruá", group: "downstream", value_m: 9.7, variation_m: 0.02, variation_period_h: 24, trend: "crece", status: "Seguimiento", observed_at_local: "2026-07-29T00:00:00-03:00", source: "PNA" },
  { name: "Colón", group: "downstream", value_m: 6.05, variation_m: 0.05, variation_period_h: 12, trend: "crece", status: "Seguimiento", observed_at_local: "2026-07-29T00:00:00-03:00", source: "PNA" },
  { name: "Concepción del Uruguay", group: "downstream", value_m: 4.7, variation_m: 0.06, variation_period_h: 12, trend: "crece", status: "Seguimiento", observed_at_local: "2026-07-29T00:00:00-03:00", source: "PNA" },
];

const preparations = [
  {
    who: "Clubes y entidades costeras",
    what: "Inventariar equipamiento, documentación y materiales que requieran traslado.",
    trigger: "Resolver durante vigilancia",
  },
  {
    who: "Infraestructura",
    what: "Probar bombas, tableros, grupos electrógenos y accesos seguros.",
    trigger: "Revisar antes de alerta",
  },
  {
    who: "Salud y cuidados",
    what: "Asegurar medicamentos, cadena de frío, traslados y rutas alternativas.",
    trigger: "Coordinar con autoridad competente",
  },
  {
    who: "Red comunitaria",
    what: "Actualizar apoyos para personas con movilidad reducida sin publicar datos personales.",
    trigger: "Mantener bajo custodia oficial",
  },
];

const sourceRows = [
  ["PNA", "Altura, variación y umbrales por puerto", "Automática", OFFICIAL_LINKS.pna],
  ["CTM · Puerto Concordia", "Altura cada 15 minutos", "Automática", OFFICIAL_LINKS.ctmConcordia],
  ["CTM · datos horarios", "Turbinado, vertido, embalse y restitución", "Automática", OFFICIAL_LINKS.ctmHourly],
  ["CTM · comunicado", "Rango oficial de corto plazo", "Automática", OFFICIAL_LINKS.ctmBulletin],
  ["CTM · lluvia", "Pronóstico GFS por cuenca incremental", "Automática", OFFICIAL_LINKS.ctmRain],
  ["GEOGLOWS/ECMWF", "Ensamble de caudal de 51 miembros, 15 días", "Automática · señal separada", OFFICIAL_LINKS.geoglows],
  ["SMN", "Alertas meteorológicas", "Enlace de consulta", OFFICIAL_LINKS.smn],
  ["SNIH", "Series hidrológicas crudas", "En evaluación", OFFICIAL_LINKS.snih],
  ["CARU", "Información binacional del río Uruguay", "En evaluación", OFFICIAL_LINKS.caru],
];

function formatNumber(value: number, decimals = 2) {
  return new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

function formatDate(iso: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Cordoba",
    ...options,
  })
    .format(new Date(iso))
    .replace(/[\u00a0\u202f]/g, " ");
}

function formatReportDateTime(
  iso: string,
  options: { weekday?: boolean; year?: boolean } = {},
) {
  const parts = new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Cordoba",
    weekday: options.weekday ? "long" : undefined,
    day: "2-digit",
    month: "short",
    year: options.year ? "numeric" : undefined,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const weekday = options.weekday ? `${value("weekday")}, ` : "";
  const year = options.year ? ` ${value("year")}` : "";
  return `${weekday}${value("day")} ${value("month")}${year} · ${value("hour")}:${value("minute")}`;
}

function formatStationVariation(station: StationReading) {
  if (station.variation_m === null || station.variation_period_h === null) return "variación no informada";
  const sign = station.variation_m > 0 ? "+" : station.variation_m < 0 ? "−" : "";
  return `${sign}${formatNumber(Math.abs(station.variation_m))} m / ${station.variation_period_h} h`;
}

function createProjection(state: RiverState): ProjectionPoint[] {
  const current =
    state.observations.find((item) => item.station_id === "CONCORDIA_PNA")?.value ?? 10;
  const start = new Date(state.generated_at);
  return Array.from({ length: 31 }, (_, day) => {
    const date = new Date(start);
    date.setDate(start.getDate() + day);

    return {
      day,
      date: date.toISOString(),
      min: current,
      central: current,
      max: current,
      uncertainty: day <= 3 ? "Moderada" : day <= 7 ? "Alta" : "Muy alta",
      risk: "Bajo",
      basis: day === 0 ? "official" : "unavailable",
    };
  });
}

function normalizeState(incoming: RiverState): RiverState {
  return {
    ...FALLBACK_STATE,
    ...incoming,
    update_status: incoming.update_status ?? FALLBACK_STATE.update_status,
    history: incoming.history?.length ? incoming.history : FALLBACK_STATE.history,
    signals: incoming.signals ?? FALLBACK_STATE.signals,
    forecast_method: incoming.forecast_method ?? FALLBACK_STATE.forecast_method,
  };
}

function riskClass(value: Risk) {
  if (value === "Bajo") return "risk-low";
  if (value === "Medio") return "risk-medium";
  return "risk-high";
}

function reportUncertaintyClass(value: string) {
  if (value === "Moderada") return "report-uncertainty-moderate";
  if (value === "Moderada-alta") return "report-uncertainty-moderate-high";
  if (value === "Alta") return "report-uncertainty-high";
  return "report-uncertainty-very-high";
}

function ReportTable({
  report,
  previous,
}: {
  report: ThresholdRiskReport;
  previous?: ThresholdRiskReport;
}) {
  const previousByHorizon = new Map(
    previous?.rows.map((row) => [row.horizon_days, row.central_estimate_pct]) ?? [],
  );

  return (
    <div className="report-table-wrap">
      <table className="risk-report-table">
        <thead>
          <tr>
            <th>Horizonte desde el corte</th>
            <th>Clasificación</th>
            <th>Probabilidad publicada</th>
            <th>Intervalo muestral</th>
            <th>Incertidumbre</th>
            <th>Cambio</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row) => {
            const previousValue = previousByHorizon.get(row.horizon_days);
            const delta =
              previousValue === undefined || previousValue === null || row.central_estimate_pct === null
                ? null
                : row.central_estimate_pct - previousValue;
            return (
              <tr key={row.horizon_days}>
                <td><strong>{row.horizon_days} días</strong></td>
                <td>{row.classification}</td>
                <td className="report-probability">
                  {row.central_estimate_pct === null ? "—" : `${row.central_estimate_pct}%`}
                </td>
                <td>
                  {row.plausible_interval_pct
                    ? `${row.plausible_interval_pct[0]}–${row.plausible_interval_pct[1]}%`
                    : "No publicado"}
                </td>
                <td>
                  <span className={`report-uncertainty ${reportUncertaintyClass(row.classification_uncertainty)}`}>
                    {row.classification_uncertainty}
                  </span>
                  {row.validation && (
                    <small className="validation-note">
                      n={row.validation.sample_size} · eventos={row.validation.event_count}
                      {row.validation.brier_skill_score === null
                        ? " · BSS no calculable"
                        : ` · BSS ${row.validation.brier_skill_score.toFixed(2)}`}
                    </small>
                  )}
                </td>
                <td>
                  {delta === null ? (
                    <span className="report-delta report-delta-neutral">—</span>
                  ) : (
                    <span
                      className={`report-delta ${
                        delta > 0
                          ? "report-delta-up"
                          : delta < 0
                            ? "report-delta-down"
                            : "report-delta-neutral"
                      }`}
                    >
                      {delta > 0 ? "+" : ""}{delta} pt
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function thresholdReport(
  report: RiskReportCut | undefined,
  threshold: number,
) {
  return report?.thresholds.find(
    (item) => Math.abs(item.threshold_m - threshold) < 0.001,
  );
}

function ReportTrend({
  reports,
  threshold,
}: {
  reports: RiskReportCut[];
  threshold: number;
}) {
  const ordered = [...reports]
    .sort((a, b) => Date.parse(a.generated_at) - Date.parse(b.generated_at))
    .slice(-24)
    .map((cut) => ({ cut, report: thresholdReport(cut, threshold) }))
    .filter(
      (
        item,
      ): item is {
        cut: RiskReportCut;
        report: ThresholdRiskReport;
      } => Boolean(item.report),
    );
  const horizons = [7, 14, 21, 28];
  const colors: Record<number, string> = {
    7: "#1d7f65",
    14: "#1250ad",
    21: "#d07b15",
    28: "#b53427",
  };
  const width = 940;
  const height = 330;
  const pad = { left: 54, right: 24, top: 28, bottom: 58 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const values = ordered.flatMap(({ report }) =>
    report.rows.flatMap((row) =>
      row.central_estimate_pct === null ? [] : [row.central_estimate_pct],
    ),
  );
  const minValue = Math.max(0, Math.floor((Math.min(...values, 0) - 10) / 10) * 10);
  const maxValue = Math.min(100, Math.ceil((Math.max(...values, 50) + 10) / 10) * 10);
  const x = (index: number) =>
    pad.left + (ordered.length <= 1 ? plotW / 2 : (index / (ordered.length - 1)) * plotW);
  const y = (value: number) =>
    pad.top + ((maxValue - value) / Math.max(1, maxValue - minValue)) * plotH;
  const ticks = Array.from(
    { length: Math.floor((maxValue - minValue) / 10) + 1 },
    (_, index) => minValue + index * 10,
  );

  return (
    <div className="report-trend">
      <div className="report-trend-legend" aria-label="Horizontes representados">
        {horizons.map((horizon) => (
          <span key={horizon}>
            <i style={{ background: colors[horizon] }} />
            {horizon} días
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="report-trend-title report-trend-desc">
        <title id="report-trend-title">Evolución de la probabilidad publicada</title>
        <desc id="report-trend-desc">
          Cambios entre los últimos cortes para el nivel de{" "}
          {formatNumber(threshold)} metros y horizontes de 7, 14, 21 y 28 días.
        </desc>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} className="report-grid-line" />
            <text x={pad.left - 12} y={y(tick) + 4} textAnchor="end" className="report-axis-label">{tick}%</text>
          </g>
        ))}
        {horizons.map((horizon) => {
          const points = ordered.flatMap(({ report, cut }, index) => {
            const value = report.rows.find(
              (row) => row.horizon_days === horizon,
            )?.central_estimate_pct;
            return value === null || value === undefined
              ? []
              : [{ x: x(index), y: y(value), value, id: cut.id }];
          });
          const path = points
            .map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`)
            .join(" ");
          return (
            <g key={horizon}>
              <path d={path} fill="none" stroke={colors[horizon]} strokeWidth="3" />
              {points.map((point, index) => (
                <circle
                  key={`${horizon}-${point.id}-${index}`}
                  cx={point.x}
                  cy={point.y}
                  r="4.5"
                  fill={colors[horizon]}
                  stroke="#f4f1e8"
                  strokeWidth="2"
                />
              ))}
            </g>
          );
        })}
        {ordered.map(({ cut }, index) => {
          const show = ordered.length <= 6 || index === 0 || index === ordered.length - 1 || index % 4 === 0;
          return show ? (
            <text
              key={cut.id}
              x={x(index)}
              y={height - 22}
              textAnchor="middle"
              className="report-axis-label"
            >
              {formatReportDateTime(cut.generated_at)}
            </text>
          ) : null;
        })}
      </svg>
    </div>
  );
}

function RiskReportSection({
  archive,
  currentReport,
}: {
  archive: RiskReportArchive;
  currentReport?: RiskReportCut;
}) {
  const allReports = useMemo(() => {
    const byId = new Map(archive.reports.map((report) => [report.id, report]));
    if (currentReport) byId.set(currentReport.id, currentReport);
    return [...byId.values()].sort(
      (a, b) => Date.parse(b.generated_at) - Date.parse(a.generated_at),
    );
  }, [archive, currentReport]);
  const [view, setView] = useState<"current" | "archive" | "trend">("current");
  const [selectedThreshold, setSelectedThreshold] = useState(11.5);
  const [selectedId, setSelectedId] = useState(allReports[0]?.id ?? "");
  const selectedCut =
    allReports.find((report) => report.id === selectedId) ?? allReports[0];
  const selectedIndex = allReports.findIndex((report) => report.id === selectedCut?.id);
  const previousCut =
    selectedIndex >= 0 && selectedIndex < allReports.length - 1
      ? allReports[selectedIndex + 1]
      : undefined;
  const current = allReports[0];
  const previous = allReports[1];
  const currentThresholdReport = thresholdReport(current, selectedThreshold);
  const previousThresholdReport = thresholdReport(previous, selectedThreshold);
  const selectedThresholdReport = thresholdReport(selectedCut, selectedThreshold);
  const previousSelectedThresholdReport = thresholdReport(
    previousCut,
    selectedThreshold,
  );
  const availableThresholds =
    archive.thresholds_m?.length
      ? archive.thresholds_m
      : current?.thresholds.map((report) => report.threshold_m) ?? [];
  const thresholdLabel = `${formatNumber(selectedThreshold)} m`;

  if (!current || !currentThresholdReport) return null;

  return (
    <section id="informes" className="content-section report-section">
      <div className="page-width">
        <div className="section-title report-title">
          <div>
            <span>INFORMES · PUERTO CONCORDIA</span>
            <h2>Superación de niveles por horizonte</h2>
            <p>
              El evento evaluado es que el puerto de Concordia alcance o supere
              {" "}{thresholdLabel} al menos una vez dentro de cada período. Un
              porcentaje sólo aparece si esa celda aprueba la validación temporal;
              en caso contrario se informa “no habilitada”.
            </p>
          </div>
          <div className="report-cut">
            <span>ÚLTIMO CORTE</span>
            <strong>
              {formatReportDateTime(current.generated_at)}
            </strong>
            <small>{allReports.length} cortes guardados</small>
          </div>
        </div>

        <div className="report-threshold-selector">
          <div>
            <span>NIVEL EVALUADO</span>
            <strong>{thresholdLabel}</strong>
          </div>
          <div
            className="report-threshold-options"
            role="group"
            aria-label="Seleccionar nivel del río"
          >
            {availableThresholds.map((threshold) => (
              <button
                type="button"
                key={threshold}
                aria-pressed={selectedThreshold === threshold}
                className={selectedThreshold === threshold ? "active" : ""}
                onClick={() => setSelectedThreshold(threshold)}
              >
                {formatNumber(threshold)} m
              </button>
            ))}
          </div>
        </div>

        <div className="report-tabs" role="tablist" aria-label="Vistas del informe">
          <button
            type="button"
            role="tab"
            aria-selected={view === "current"}
            className={view === "current" ? "active" : ""}
            onClick={() => setView("current")}
          >
            Último informe
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "archive"}
            className={view === "archive" ? "active" : ""}
            onClick={() => setView("archive")}
          >
            Informes anteriores
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "trend"}
            className={view === "trend" ? "active" : ""}
            onClick={() => setView("trend")}
          >
            Cambios en el tiempo
          </button>
        </div>

        {view === "current" && (
          <div className="report-panel" role="tabpanel">
            <div className="report-panel-heading">
              <div>
                <span>INFORME VIGENTE</span>
                <strong>Probabilidad validada por horizonte</strong>
              </div>
              {previous && (
                <p>
                  La columna “Cambio” compara este corte con el de{" "}
                  {formatReportDateTime(previous.generated_at)}.
                </p>
              )}
            </div>
            <ReportTable
              report={currentThresholdReport}
              previous={previousThresholdReport}
            />
          </div>
        )}

        {view === "archive" && (
          <div className="report-archive" role="tabpanel">
            <div className="report-list" aria-label="Cortes anteriores">
              {allReports.map((report, index) => (
                <button
                  type="button"
                  key={report.id}
                  className={report.id === selectedCut?.id ? "active" : ""}
                  onClick={() => setSelectedId(report.id)}
                >
                  <span>{index === 0 ? "Vigente" : "Anterior"}</span>
                  <strong>
                    {formatReportDateTime(report.generated_at)}
                  </strong>
                  <small>Concordia {formatNumber(report.snapshot.concordia_m)} m</small>
                </button>
              ))}
            </div>
            {selectedCut && selectedThresholdReport && (
              <div className="report-panel report-panel-archive">
                <div className="report-panel-heading">
                  <div>
                    <span>CORTE SELECCIONADO</span>
                    <strong>
                      {formatReportDateTime(selectedCut.generated_at, {
                        weekday: true,
                        year: true,
                      })}
                    </strong>
                  </div>
                </div>
                <ReportTable
                  report={selectedThresholdReport}
                  previous={previousSelectedThresholdReport}
                />
              </div>
            )}
          </div>
        )}

        {view === "trend" && (
          <div className="report-panel" role="tabpanel">
            <div className="report-panel-heading">
              <div>
                <span>EVOLUCIÓN ENTRE CORTES</span>
                <strong>Probabilidad publicada por horizonte</strong>
              </div>
              <p>Se muestran hasta 24 actualizaciones, en orden cronológico.</p>
            </div>
            <ReportTrend reports={allReports} threshold={selectedThreshold} />
          </div>
        )}

        <div className="report-method-note">
          <Info size={18} />
          <p>
            <strong>{current.method.label}.</strong> {current.method.note} Sirve para
            comparar cómo cambia el escenario entre cortes; no reemplaza un pronóstico
            probabilístico oficial.
          </p>
        </div>
      </div>
    </section>
  );
}

function Hydrograph({
  state,
  horizon,
  onHorizon,
}: {
  state: RiverState;
  horizon: number;
  onHorizon: (value: number) => void;
}) {
  const history = state.history ?? FALLBACK_STATE.history!;
  const projection = state.projection?.length ? state.projection : createProjection(state);
  const selected = projection.find((point) => point.day === horizon) ?? projection[horizon];

  const width = 960;
  const height = 560;
  const pad = { left: 62, right: 24, top: 44, bottom: 110 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const historyDays = Math.max(4, history.length - 1);
  const minX = -historyDays;
  const maxX = 30;
  const plottedValues = [
    ...history.map((point) => point.value),
    ...projection.flatMap((point) => [point.min, point.central, point.max]),
    state.thresholds.alert_m,
    state.thresholds.evacuation_m,
  ].filter(Number.isFinite);
  const rawMinY = Math.min(...plottedValues);
  const rawMaxY = Math.max(...plottedValues);
  const roughStep = Math.max(0.1, (rawMaxY - rawMinY) / 5);
  const tickStep = roughStep <= 0.5 ? 0.5 : roughStep <= 1 ? 1 : roughStep <= 2 ? 2 : 5;
  const minY = Math.floor((rawMinY - tickStep * 0.25) / tickStep) * tickStep;
  const maxY = Math.ceil((rawMaxY + tickStep * 0.25) / tickStep) * tickStep;
  const x = (day: number) => pad.left + ((day - minX) / (maxX - minX)) * plotW;
  const y = (value: number) => pad.top + ((maxY - value) / (maxY - minY)) * plotH;

  const historyPath = history
    .map((point, index) => `${index ? "L" : "M"} ${x(index - historyDays)} ${y(point.value)}`)
    .join(" ");
  const upper = projection.map((point) => `${x(point.day)},${y(point.max)}`).join(" ");
  const lower = [...projection]
    .reverse()
    .map((point) => `${x(point.day)},${y(point.min)}`)
    .join(" ");
  const centralPath = projection
    .map((point, index) => `${index ? "L" : "M"} ${x(point.day)} ${y(point.central)}`)
    .join(" ");
  const selectedX = x(horizon);
  const selectedY = y(selected.central);
  const yTicks = Array.from(
    { length: Math.round((maxY - minY) / tickStep) + 1 },
    (_, index) => minY + index * tickStep,
  );
  const xTicks = [-historyDays, 0, 7, 14, 21, 30];

  return (
    <div className="chart-wrap">
      <svg
        className="hydrograph"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby="hydro-title hydro-description"
      >
        <title id="hydro-title">Nivel observado y escenario a treinta días</title>
        <desc id="hydro-description">
          La serie oficial observada llega hasta hoy. La banda posterior contiene los
          percentiles 10 y 90 del ensamble de trayectorias históricas análogas,
          ampliados con una corrección conformal. La línea punteada representa la
          mediana sólo donde supera a persistencia; en los demás horizontes converge
          hacia la altura actual.
        </desc>

        <defs>
          <linearGradient id="forecast-band" x1="0" x2="1">
            <stop offset="0%" stopColor="#1250ad" stopOpacity=".12" />
            <stop offset="100%" stopColor="#1250ad" stopOpacity=".28" />
          </linearGradient>
          <linearGradient id="uncertainty-wedge" x1="0" x2="1">
            <stop offset="0%" stopColor="#1250ad" stopOpacity=".18" />
            <stop offset="100%" stopColor="#1250ad" stopOpacity=".95" />
          </linearGradient>
        </defs>

        {yTicks.map((tick) => (
          <g key={tick}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={y(tick)}
              y2={y(tick)}
              className="grid-line"
            />
            <text x={pad.left - 13} y={y(tick) + 5} textAnchor="end" className="axis-label">
              {formatNumber(tick, 1)}
            </text>
          </g>
        ))}

        <line
          x1={pad.left}
          x2={width - pad.right}
          y1={y(state.thresholds.alert_m)}
          y2={y(state.thresholds.alert_m)}
          className="threshold-line alert-line"
        />
        <text
          x={pad.left + 8}
          y={y(state.thresholds.alert_m) - 9}
          className="threshold-label alert-text"
        >
          ALERTA {formatNumber(state.thresholds.alert_m)} m
        </text>
        <line
          x1={pad.left}
          x2={width - pad.right}
          y1={y(state.thresholds.evacuation_m)}
          y2={y(state.thresholds.evacuation_m)}
          className="threshold-line evacuation-line"
        />
        <text
          x={pad.left + 8}
          y={y(state.thresholds.evacuation_m) - 9}
          className="threshold-label evacuation-text"
        >
          EVACUACIÓN {formatNumber(state.thresholds.evacuation_m)} m
        </text>

        <polygon points={`${upper} ${lower}`} fill="url(#forecast-band)" />
        <path d={historyPath} className="history-line" />
        <path d={centralPath} className="central-line" />
        <path
          d={`M ${x(0)} ${y(projection[0].max)} ${projection
            .map((point) => `L ${x(point.day)} ${y(point.max)}`)
            .join(" ")}`}
          className="bound-line"
        />
        <path
          d={`M ${x(0)} ${y(projection[0].min)} ${projection
            .map((point) => `L ${x(point.day)} ${y(point.min)}`)
            .join(" ")}`}
          className="bound-line"
        />

        <line x1={x(0)} x2={x(0)} y1={pad.top} y2={height - pad.bottom} className="today-line" />
        <line
          x1={selectedX}
          x2={selectedX}
          y1={pad.top}
          y2={height - pad.bottom}
          className="selection-line"
        />
        <circle cx={selectedX} cy={selectedY} r="7" className="selection-dot" />

        <g transform={`translate(${Math.min(selectedX + 10, width - 180)},${Math.max(selectedY - 80, 10)})`}>
          <rect width="174" height="66" className="chart-tooltip" />
          <text x="12" y="20" className="tooltip-date">
            Día {selected.day} · {formatDate(selected.date, { day: "2-digit", month: "short" })}
          </text>
          <text x="12" y="40" className="tooltip-value">
            {formatNumber(selected.min)}–{formatNumber(selected.max)} m
          </text>
          <text x="12" y="57" className="tooltip-uncertainty">
            Incertidumbre: {selected.uncertainty}
          </text>
        </g>

        <text x={x(0) - 10} y={pad.top + 18} textAnchor="end" className="plot-caption">
          observado
        </text>
        <text x={x(0) + 12} y={pad.top + 18} className="plot-caption plot-caption-blue">
          ensamble local · P10–P90 corregido
        </text>
        <text x={x(26)} y={y(projection[26].max) - 12} className="bound-label">
          límite superior
        </text>
        <text x={x(26)} y={y(projection[26].min) + 22} className="bound-label">
          límite inferior
        </text>

        {xTicks.map((tick) => {
          const label =
            tick < 0
              ? history[0]?.label ?? "observado"
              : tick === 0
                ? "hoy"
                : `+${tick} días`;
          return (
            <g key={tick}>
              <line
                x1={x(tick)}
                x2={x(tick)}
                y1={height - pad.bottom}
                y2={height - pad.bottom + 7}
                className="axis-tick"
              />
              <text
                x={x(tick)}
                y={height - pad.bottom + 27}
                textAnchor="middle"
                className="axis-label"
              >
                {label}
              </text>
            </g>
          );
        })}

        <text x={pad.left - 2} y={pad.top - 18} className="axis-title">
          nivel (m)
        </text>
        <polygon
          points={`${x(0)},${height - 35} ${x(30)},${height - 50} ${x(30)},${height - 20}`}
          fill="url(#uncertainty-wedge)"
        />
        <text x={x(0)} y={height - 48} className="uncertainty-label">
          incertidumbre
        </text>
        <text x={x(30)} y={height - 57} textAnchor="end" className="uncertainty-label">
          crece con el horizonte
        </text>
      </svg>

      <div className="horizon-controls" aria-label="Seleccionar horizonte">
        <input
          type="range"
          min="1"
          max="30"
          value={horizon}
          onChange={(event) => onHorizon(Number(event.target.value))}
          aria-label="Días desde hoy"
        />
        <div className="quick-days">
          {[1, 7, 14, 21, 30].map((day) => (
            <button
              key={day}
              type="button"
              className={horizon === day ? "active" : ""}
              onClick={() => onHorizon(day)}
            >
              {day === 1 ? "24 h" : `${day} días`}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function InteractiveTerritoryMap({
  selectedId,
  onSelect,
}: {
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef<Record<string, CircleMarker[]>>({});

  useEffect(() => {
    let disposed = false;
    let map: LeafletMap | null = null;

    void import("leaflet").then((L) => {
      if (disposed || !containerRef.current || mapRef.current) return;
      map = L.map(containerRef.current, {
        zoomControl: true,
        scrollWheelZoom: false,
      });
      mapRef.current = map;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      const colors = {
        reference: "#f2cf00",
        exposure: "#d87525",
        protection: "#bb1f1f",
        waterway: "#1250ad",
      };
      const bounds: Array<[number, number]> = [];
      const markerGroups: Record<string, CircleMarker[]> = {};

      for (const place of MONITORING_PLACES) {
        markerGroups[place.id] = place.locations.map((location) => {
          bounds.push([location.lat, location.lon]);
          const marker = L.circleMarker([location.lat, location.lon], {
            radius: location.kind === "reference" ? 9 : 7,
            color: "#fffdf7",
            weight: 3,
            fillColor: colors[location.kind],
            fillOpacity: 1,
          })
            .addTo(map as LeafletMap)
            .bindPopup(
              `<strong>${location.name}</strong><br><span>${place.detail}</span>`,
            );
          marker.on("click", () => onSelect(place.id));
          return marker;
        });
      }
      markersRef.current = markerGroups;

      L.circleMarker([-31.2749759, -57.9385132], {
        radius: 7,
        color: "#fffdf7",
        weight: 3,
        fillColor: "#113b76",
        fillOpacity: 1,
      })
        .addTo(map)
        .bindPopup("<strong>Represa de Salto Grande</strong><br><span>Referencia aguas arriba</span>");
      bounds.push([-31.2749759, -57.9385132]);
      map.fitBounds(bounds, { padding: [36, 36] });
      window.setTimeout(() => map?.invalidateSize(), 50);
    });

    return () => {
      disposed = true;
      markersRef.current = {};
      map?.remove();
      mapRef.current = null;
    };
  }, [onSelect]);

  useEffect(() => {
    const map = mapRef.current;
    const place = MONITORING_PLACES.find((item) => item.id === selectedId);
    if (!map || !place) return;
    const points = place.locations.map(
      (location) => [location.lat, location.lon] as [number, number],
    );
    if (points.length === 1) {
      map.flyTo(points[0], 15, { duration: 0.6 });
      markersRef.current[selectedId]?.[0]?.openPopup();
    } else {
      void import("leaflet").then((L) => {
        map.fitBounds(L.latLngBounds(points), { padding: [55, 55], maxZoom: 14 });
      });
    }
  }, [selectedId]);

  return (
    <div className="interactive-map-shell">
      <div
        ref={containerRef}
        className="interactive-map"
        role="application"
        aria-label="Mapa interactivo de puntos bajo seguimiento en Concordia"
      />
      <div className="map-legend" aria-label="Referencias del mapa">
        <span><i className="legend-reference" /> Nivel oficial</span>
        <span><i className="legend-exposure" /> Exposición</span>
        <span><i className="legend-protection" /> Protección</span>
        <span><i className="legend-waterway" /> Cursos de agua</span>
      </div>
      <p className="map-caption">
        Cartografía OpenStreetMap y ubicaciones georreferenciadas. No representa
        extensión ni profundidad de inundación.
      </p>
    </div>
  );
}

function GeoglowsSignal({
  forecast,
}: {
  forecast: NonNullable<RiverState["external_forecasts"]>["geoglows"];
}) {
  if (!forecast?.daily?.length) return null;
  const daily = forecast.daily;
  const width = 720;
  const height = 190;
  const pad = { left: 58, right: 18, top: 20, bottom: 38 };
  const values = daily.flatMap((point) => [point.p10_m3s, point.median_m3s, point.p90_m3s]);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const margin = Math.max(100, (maximum - minimum) * 0.12);
  const minY = Math.max(0, minimum - margin);
  const maxY = maximum + margin;
  const x = (index: number) =>
    pad.left + (index / Math.max(1, daily.length - 1)) * (width - pad.left - pad.right);
  const y = (value: number) =>
    pad.top + ((maxY - value) / Math.max(1, maxY - minY)) * (height - pad.top - pad.bottom);
  const upper = daily.map((point, index) => `${x(index)},${y(point.p90_m3s)}`).join(" ");
  const lower = [...daily]
    .reverse()
    .map((point, reverseIndex) => {
      const index = daily.length - 1 - reverseIndex;
      return `${x(index)},${y(point.p10_m3s)}`;
    })
    .join(" ");
  const median = daily
    .map((point, index) => `${index ? "L" : "M"} ${x(index)} ${y(point.median_m3s)}`)
    .join(" ");
  const first = daily[0].median_m3s;
  const last = daily[daily.length - 1].median_m3s;
  const change = first ? (last - first) / first : 0;
  const tendency = change > 0.08 ? "ascendente" : change < -0.08 ? "descendente" : "sin cambio marcado";

  return (
    <article className="flow-signal">
      <div className="flow-signal-copy">
        <span>SEÑAL EXTERNA · 15 DÍAS</span>
        <h3>Caudal previsto aguas arriba de Concordia</h3>
        <p>
          Ensamble GEOGLOWS/ECMWF para el tramo fluvial más cercano. La mediana termina
          en <strong>{new Intl.NumberFormat("es-AR").format(Math.round(last))} m³/s</strong>,
          con tendencia {tendency}. Se mantiene en caudal: no se transforma en altura
          local porque esa relación todavía no fue validada para este punto regulado.
        </p>
        <small>
          Emitido {formatReportDateTime(forecast.generated_at)} · 51 miembros · banda P10–P90
        </small>
      </div>
      <div className="flow-signal-chart">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Pronóstico de caudal GEOGLOWS con mediana e intervalo P10 a P90">
          <polygon points={`${upper} ${lower}`} className="flow-band" />
          <path d={median} className="flow-median" />
          <line x1={pad.left} x2={width - pad.right} y1={height - pad.bottom} y2={height - pad.bottom} className="flow-axis" />
          <text x={pad.left} y={height - 12} className="flow-label">hoy</text>
          <text x={width - pad.right} y={height - 12} textAnchor="end" className="flow-label">+{daily.length - 1} días</text>
          <text x={pad.left - 8} y={y(maximum) + 4} textAnchor="end" className="flow-label">
            {new Intl.NumberFormat("es-AR", { notation: "compact" }).format(Math.round(maximum))}
          </text>
          <text x={pad.left - 8} y={y(minimum) + 4} textAnchor="end" className="flow-label">
            {new Intl.NumberFormat("es-AR", { notation: "compact" }).format(Math.round(minimum))}
          </text>
        </svg>
      </div>
    </article>
  );
}

export default function Home() {
  const [state, setState] = useState<RiverState>(FALLBACK_STATE);
  const [reportArchive, setReportArchive] = useState<RiskReportArchive>(
    FALLBACK_REPORT_ARCHIVE,
  );
  const [horizon, setHorizon] = useState(7);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState("puerto");

  useEffect(() => {
    const cacheBuster = Date.now();
    const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    const dataBase =
      window.location.hostname === "terminal.local"
        ? `${basePath}/data`
        : LIVE_DATA_BASE;
    fetch(`${dataBase}/current_state.json?v=${cacheBuster}`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("data unavailable");
        return response.json();
      })
      .then((incoming: RiverState) => setState(normalizeState(incoming)))
      .catch(() => {
        setState((current) => ({
          ...current,
          update_status: {
            state: "stale",
            message:
              "No se pudo leer el archivo actualizado. Se muestra el último corte incluido en la publicación.",
          },
        }));
      });
    fetch(`${dataBase}/risk_reports.json?v=${cacheBuster}`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("report archive unavailable");
        return response.json();
      })
      .then((incoming: RiskReportArchive) => setReportArchive(incoming))
      .catch(() => setReportArchive(FALLBACK_REPORT_ARCHIVE));
  }, []);

  const projection = useMemo(
    () => (state.projection?.length ? state.projection : createProjection(state)),
    [state],
  );
  const stations = state.stations?.length ? state.stations : FALLBACK_STATIONS;
  const upstream = stations.filter((station) => station.group === "upstream");
  const downstream = stations.filter((station) => station.group === "downstream");
  const selected = projection.find((point) => point.day === horizon) ?? projection[horizon];
  const concordiaObservation =
    state.observations.find((item) => item.station_id === "CONCORDIA_PNA");
  const concordia = concordiaObservation?.value ?? 10;
  const turbinated =
    state.observations.find((item) => item.variable === "turbined_discharge")?.value ?? 8316;
  const spilled =
    state.observations.find((item) => item.variable === "spilled_discharge")?.value ?? 6365;
  const reservoir =
    state.observations.find((item) => item.variable === "reservoir_level")?.value ?? 33.17;
  const totalRelease = state.signals?.released_flow_m3s ?? turbinated + spilled;
  const officialForecastIsCurrent =
    Date.parse(state.official_forecast.valid_until_local) >= Date.parse(state.generated_at);
  const officialForecastHasRange = state.official_forecast.concordia_min_m !== null;
  const modelReady = state.forecast_method?.model_id === "ctm-analog-ensemble-v1.1";
  const stageAgeHours = concordiaObservation
    ? Math.max(
        0,
        (Date.parse(state.generated_at) -
          Date.parse(concordiaObservation.observed_at_local)) /
          3_600_000,
      )
    : Number.POSITIVE_INFINITY;
  const stageFreshness =
    concordiaObservation?.quality_flag === "official_stale_copy" || stageAgeHours > 18
      ? { label: "Dato viejo", className: "stage-stale" }
      : stageAgeHours > 6
        ? { label: "Con demora", className: "stage-delayed" }
        : { label: "Dato vigente", className: "stage-current" };
  const concordiaSource =
    concordiaObservation?.source_id === "ctm_concordia_stage" ? "CTM" : "PNA";
  const publicBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

  const generated = formatDate(state.generated_at, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <main id="inicio">
      <a className="skip-link" href="#nivel">
        Ir al nivel y escenario
      </a>

      <div className="public-service-bar">
        <div className="page-width service-inner">
          <span>Información pública para Concordia y la costa del río Uruguay</span>
          <div>
            <a href="tel:103"><Phone size={13} /> Defensa Civil 103</a>
            <a href="tel:107">Salud 107</a>
          </div>
        </div>
      </div>

      <header className="atlas-header">
        <div className="page-width header-row">
          <a href="#inicio" className="atlas-brand" aria-label="Inicio">
            <span className="wave-mark" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span>
              <strong>Observatorio del río Uruguay</strong>
              <small>Concordia</small>
            </span>
          </a>

          <nav className={menuOpen ? "atlas-nav open" : "atlas-nav"} aria-label="Navegación">
            <a href="#nivel" onClick={() => setMenuOpen(false)}>Ahora</a>
            <a href="#informes" onClick={() => setMenuOpen(false)}>Informes</a>
            <a href="#cuenca" onClick={() => setMenuOpen(false)}>Cuenca</a>
            <a href="#territorio" onClick={() => setMenuOpen(false)}>Lugares</a>
            <a href="#preparacion" onClick={() => setMenuOpen(false)}>Preparación</a>
            <a href="#fuentes" onClick={() => setMenuOpen(false)}>Fuentes</a>
          </nav>

          <div className="header-meta">
            <span>Consulta automática {generated}</span>
            <a href="#metodo">Fuentes y criterios <ExternalLink size={14} /></a>
          </div>
          <button
            type="button"
            className="menu-toggle"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"}
          >
            {menuOpen ? <X /> : <Menu />}
          </button>
        </div>
      </header>

      <section className="reading-strip" aria-label="Cifras principales">
        <div className="page-width readings-grid">
          <div className="reading reading-current">
            <span>Puerto Concordia</span>
            <strong>{formatNumber(concordia)} <small>m</small></strong>
            <em>
              {concordiaSource} ·{" "}
              {concordiaObservation
                ? formatDate(concordiaObservation.observed_at_local, {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "último corte incluido"}
              {" · "}
              <b className={`stage-freshness ${stageFreshness.className}`}>
                {stageFreshness.label}
              </b>
            </em>
          </div>
          <div className="reading reading-alert">
            <span>Alerta</span>
            <strong>{formatNumber(state.thresholds.alert_m)} <small>m</small></strong>
            <em>Umbral PNA</em>
          </div>
          <div className="reading reading-evacuation">
            <span>Evacuación</span>
            <strong>{formatNumber(state.thresholds.evacuation_m)} <small>m</small></strong>
            <em>Umbral PNA</em>
          </div>
          <div className="reading reading-ctm">
            <span>Parte de Salto Grande</span>
            <strong>
              {officialForecastHasRange && state.official_forecast.concordia_min_m !== null
                ? `${formatNumber(state.official_forecast.concordia_min_m)}–${formatNumber(state.official_forecast.concordia_max_m)}`
                : `máx. ${formatNumber(state.official_forecast.concordia_max_m)}`} {" "}
              <small>m</small>
            </strong>
            <em>
              {officialForecastIsCurrent ? "Vigente hasta " : "Vigencia vencida · hasta "}
              {formatDate(state.official_forecast.valid_until_local, {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
              {" · "}tendencia {state.official_forecast.trend}
            </em>
          </div>
        </div>
      </section>

      <section id="nivel" className="atlas-stage">
        <div className="page-width stage-grid">
          <div className="forecast-column">
            <div className="forecast-heading">
              <div>
                <span className="section-label">PUERTO DE CONCORDIA</span>
                <h1>Nivel del río y escenario a 30 días</h1>
              </div>
              <div
                className={`update-state update-${state.update_status?.state ?? "fresh"}`}
                title={state.update_status?.message}
              >
                <RefreshCw size={14} />
                {state.update_status?.state === "fresh"
                  ? "Fuentes al día"
                  : state.update_status?.state === "partial"
                    ? "Corte parcial"
                    : "Datos con demora"}
              </div>
            </div>

            <p className="forecast-intro">
              La línea continua muestra mediciones oficiales. {modelReady
                ? "Desde hoy, la banda parte de 60 trayectorias históricas análogas de la red CTM y se ensancha con una corrección conformal calculada en un período separado; la línea punteada usa la mediana sólo donde mejora al menos 3% a la persistencia."
                : "El pronóstico cuantitativo no está disponible en este corte; se conserva únicamente la altura observada."}
              {officialForecastIsCurrent
                ? " El parte oficial de corto plazo permanece separado y se informa en la franja superior."
                : " El último parte de corto plazo está vencido."}
            </p>
            {state.update_status?.state !== "fresh" && (
              <p className="source-warning" role="status">
                <AlertTriangle size={15} />
                {state.update_status?.message}
              </p>
            )}

            <Hydrograph state={state} horizon={horizon} onHorizon={setHorizon} />

            <div className="selected-day">
              <div>
                <span>Horizonte elegido</span>
                <strong>
                  Día {selected.day} ·{" "}
                  {formatDate(selected.date, { weekday: "short", day: "2-digit", month: "short" })}
                </strong>
              </div>
              <div>
                <span>Banda predictiva corregida</span>
                <strong>{formatNumber(selected.min)}–{formatNumber(selected.max)} m</strong>
              </div>
              <div>
                <span>Lectura del percentil 90</span>
                <strong className={riskClass(selected.risk)}>{selected.risk}</strong>
              </div>
              <div>
                <span>Validación del horizonte</span>
                <strong>
                  {selected.validation?.mae_m !== null && selected.validation?.mae_m !== undefined
                    ? `MAE ${formatNumber(selected.validation.mae_m)} m`
                    : selected.uncertainty}
                </strong>
              </div>
            </div>

            <div className="interpretation-note">
              <Info size={17} />
              <p>
                <strong>{modelReady ? "Ensamble local validado con límites." : "Sin pronóstico habilitado."}</strong>{" "}
                Los límites parten de P10 y P90 y luego incorporan la corrección
                conformal; no son máximos ni mínimos físicamente posibles.
                {selected.validation
                  ? ` En el holdout temporal este horizonte tuvo una cobertura de ${Math.round((selected.validation.interval_80_coverage ?? 0) * 100)}% y habilidad MAE frente a persistencia de ${selected.validation.mae_skill_vs_persistence === null ? "no calculable" : `${Math.round(selected.validation.mae_skill_vs_persistence * 100)}%`}.`
                  : " La probabilidad de superar cada nivel se evalúa aparte y sólo se publica si supera los controles de validación."}
              </p>
            </div>
          </div>
        </div>

        <div className="page-width lower-rail">
          <div>
            <span>Caudal evacuado</span>
            <strong>{new Intl.NumberFormat("es-AR").format(totalRelease)} m³/s</strong>
            <small>CTM · 09:00</small>
          </div>
          <div>
            <span>Embalse</span>
            <strong>{formatNumber(reservoir)} m</strong>
            <small>CTM · promedio horario</small>
          </div>
          <div>
            <span>Señal aguas arriba</span>
            <strong>Paso de los Libres</strong>
            <small>{state.signals?.upstream ?? "Sin dato actualizado"}</small>
          </div>
          <div>
            <span>Lluvia prevista en cuenca</span>
            <strong>
              {state.signals?.rainfall_7d_mm === null ||
              state.signals?.rainfall_7d_mm === undefined
                ? "No disponible"
                : `${state.signals.rainfall_7d_mm} mm`}
            </strong>
            <small>Salto Grande · total 7 días GFS</small>
          </div>
        </div>
      </section>

      <RiskReportSection
        archive={reportArchive}
        currentReport={state.risk_report_bundle}
      />

      <section id="cuenca" className="content-section">
        <div className="page-width">
          <div className="section-title">
            <span>CUENCA MEDIA Y BAJA</span>
            <h2>Qué está pasando antes y después de Concordia</h2>
            <p>
              Las alturas pertenecen al cero local de cada puerto: sirven para seguir
              tendencias, no para comparar cotas entre estaciones.
            </p>
          </div>

          <div className="stations-layout">
            <div className="station-table">
              <div className="table-heading">
                <span>AGUAS ARRIBA</span>
                <ArrowDown size={16} />
              </div>
              {upstream.map((station) => (
                <div className="station-line" key={station.name}>
                  <div>
                    <strong>{station.name}</strong>
                    <small>
                      {formatDate(station.observed_at_local, {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </small>
                  </div>
                  <div>
                    <b>{formatNumber(station.value_m)} m</b>
                    <small>{formatStationVariation(station)}</small>
                  </div>
                  <em>{station.status} · {station.trend}</em>
                </div>
              ))}
            </div>

            <div className="station-table">
              <div className="table-heading">
                <span>AGUAS ABAJO</span>
                <ArrowDown size={16} />
              </div>
              {downstream.map((station) => (
                <div className="station-line" key={station.name}>
                  <div>
                    <strong>{station.name}</strong>
                    <small>
                      {formatDate(station.observed_at_local, {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </small>
                  </div>
                  <div>
                    <b>{formatNumber(station.value_m)} m</b>
                    <small>{formatStationVariation(station)}</small>
                  </div>
                  <em>{station.status} · {station.trend}</em>
                </div>
              ))}
            </div>
          </div>

          <div className="basin-note">
            <AlertTriangle size={19} />
            <p>
              {state.signals?.upstream ?? "No hay una señal aguas arriba actualizada."}
              {" "}Es una señal de cuenca y no permite trasladar directamente esa altura
              ni un tiempo de llegada a Concordia.
            </p>
          </div>
          <GeoglowsSignal forecast={state.external_forecasts?.geoglows} />
        </div>
      </section>

      <section id="territorio" className="content-section territory-section">
        <div className="page-width">
          <div className="section-title">
            <span>CONCORDIA Y SU COSTA</span>
            <h2>Puntos bajo seguimiento</h2>
            <p>
              Ubicaciones verificables para leer el corredor costero. El mapa no
              dibuja áreas inundadas porque todavía no existe una capa local validada
              para cada altura.
            </p>
          </div>
          <div className="territory-layout">
            <InteractiveTerritoryMap selectedId={selectedPlace} onSelect={setSelectedPlace} />
            <div className="places-list" aria-label="Seleccionar un punto del mapa">
              {MONITORING_PLACES.map((place) => (
                <button
                  type="button"
                  key={place.id}
                  className={selectedPlace === place.id ? "active" : ""}
                  onClick={() => setSelectedPlace(place.id)}
                  aria-pressed={selectedPlace === place.id}
                >
                  <b>{place.index}</b>
                  <span><strong>{place.name}</strong><small>{place.detail}</small></span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="preparacion" className="content-section">
        <div className="page-width">
          <div className="section-title">
            <span>ANTES DE UNA ALERTA</span>
            <h2>Preparativos que conviene resolver ahora</h2>
            <p>
              Son propuestas preventivas para responsables de instalaciones y equipos
              habilitados. Las decisiones operativas corresponden a las autoridades.
            </p>
          </div>
          <div className="preparation-list">
            {preparations.map((item, index) => (
              <article key={item.who}>
                <b>{String(index + 1).padStart(2, "0")}</b>
                <div>
                  <span>{item.who}</span>
                  <h3>{item.what}</h3>
                </div>
                <em>{item.trigger}</em>
              </article>
            ))}
          </div>
          <div className="emergency-callout">
            <ShieldAlert size={27} />
            <div>
              <span>En una emergencia</span>
              <strong>Defensa Civil 103 · Salud 107 · Prefectura 0345 421-2404</strong>
            </div>
          </div>
        </div>
      </section>

      <section id="metodo" className="content-section method-section">
        <div className="page-width method-grid">
          <div className="section-title">
            <span>CÓMO SE CONSTRUYE</span>
            <h2>De dónde sale cada línea del gráfico</h2>
          </div>
          <div className="method-steps">
            <div>
              <b>1</b>
              <span><strong>Red observada</strong><small>Niveles y lluvia de Concordia, Paso de los Libres, Monte Caseros, Federación y Salto Grande, agregados desde las mediciones CTM de 15 minutos.</small></span>
            </div>
            <div>
              <b>2</b>
              <span><strong>Sesenta análogos</strong><small>Se buscan estados históricos similares usando nivel local, cambios de 1–14 días, estaciones aguas arriba, embalse, lluvia y época del año.</small></span>
            </div>
            <div>
              <b>3</b>
              <span><strong>Trayectorias y banda</strong><small>Cada análogo aporta sus 30 días posteriores. P10–P90 se amplía por calibración conformal; el centro usa mediana sólo con una mejora MAE mínima de 3%.</small></span>
            </div>
            <div>
              <b>4</b>
              <span><strong>Probabilidad condicionada</strong><small>La frecuencia ponderada de superación se calibra en un bloque separado. Sólo se publica con suficientes eventos, BSS ≥ 0,05 y error de confiabilidad ≤ 0,12 en el bloque final.</small></span>
            </div>
          </div>
          <div className="method-warning">
            <Info size={18} />
            <p>
              <strong>Validación temporal, no promesa de certeza.</strong> El tramo final
              del historial queda fuera del entrenamiento. GEOGLOWS/ECMWF y el parte de
              CTM se muestran separados: no se convierten silenciosamente en altura ni
              se usan como si fueran observaciones locales. El modelo no anticipa
              decisiones futuras de operación de la represa.
            </p>
          </div>
        </div>
      </section>

      <section id="fuentes" className="content-section sources-section">
        <div className="page-width">
          <div className="section-title title-row">
            <div>
              <span>DATOS Y RESPALDO</span>
              <h2>Fuentes consultadas</h2>
            </div>
            <div className="download-links">
              <a href={`${LIVE_DATA_BASE}/current_state.json`} download><Database size={15} /> Datos JSON</a>
              <a href={`${LIVE_DATA_BASE}/risk_reports.json`} download><Clock3 size={15} /> Historial de informes</a>
              <a href={`${publicBasePath}/boletines/2026-07-29.md`} download><Download size={15} /> Boletín</a>
            </div>
          </div>

          <div className="sources-table" role="table" aria-label="Fuentes de datos">
            {sourceRows.map(([name, variable, status, href]) => (
              <a href={href} target="_blank" rel="noreferrer" className="source-row" key={name}>
                <strong>{name}</strong>
                <span>{variable}</span>
                <em>{status}</em>
                <ExternalLink size={14} />
              </a>
            ))}
          </div>

          <div className="documents-row">
            <a href={`${publicBasePath}/documentos/metodologia.md`}><FileText size={16} /> Metodología</a>
            <a href={`${publicBasePath}/documentos/registro-decisiones.md`}><Clock3 size={16} /> Registro de decisiones</a>
            <a href={`${publicBasePath}/documentos/gobernanza.md`}><Users size={16} /> Equipo y gobernanza</a>
          </div>
        </div>
      </section>

      <section className="content-section team-section">
        <div className="page-width team-layout">
          <div className="section-title">
            <span>EQUIPO PROPUESTO</span>
            <h2>Quién debería sostener esta información</h2>
          </div>
          <div className="team-copy">
            <p>
              Un núcleo pequeño: coordinación, hidrología, datos, territorio,
              infraestructura y comunicación. Cada actualización debe quedar registrada
              y revisada antes de publicarse.
            </p>
            <a href={`${publicBasePath}/documentos/gobernanza.md`}>Ver organización propuesta <ExternalLink size={14} /></a>
          </div>
        </div>
      </section>

      <footer>
        <div className="page-width footer-grid">
          <div className="footer-brand">
            <Waves />
            <span><strong>Observatorio del río Uruguay</strong><small>Concordia</small></span>
          </div>
          <p>
            Herramienta pública experimental. No emite órdenes de evacuación ni
            sustituye a CTM, PNA, CARU, SMN, Defensa Civil o el COE.
          </p>
          <a href="#inicio">Volver arriba <ChevronDown size={14} /></a>
        </div>
      </footer>
    </main>
  );
}
