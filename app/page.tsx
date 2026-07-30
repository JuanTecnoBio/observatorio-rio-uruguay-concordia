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
import { useEffect, useMemo, useState } from "react";
import initialState from "../public/data/current_state.json";

type Uncertainty = "Moderada" | "Alta" | "Muy alta";
type Risk = "Bajo" | "Medio" | "Alto";

type ProjectionPoint = {
  day: number;
  date: string;
  min: number;
  central: number;
  max: number;
  uncertainty: Uncertainty;
  risk: Risk;
  basis: "official" | "experimental";
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
    concordia_min_m: number;
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
    description: string;
    validation: string;
  };
};

const OFFICIAL_LINKS = {
  pna: "https://contenidosweb.prefecturanaval.gob.ar/alturas/",
  ctmHourly: "https://www.saltogrande.org/datos_horarios.php",
  ctmBulletin: "https://www.saltogrande.org/docs/hidrologia/Comunicado.pdf",
  ctmRain: "https://www.saltogrande.org/docs/hidrologia/PronosticosP.pdf",
  smn: "https://www.smn.gob.ar/alertas",
  snih: "https://snih.hidricosargentina.gob.ar/",
  caru: "https://www.caru.org.uy/",
};

const FALLBACK_STATE = initialState as RiverState;

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
  ["CTM · datos horarios", "Turbinado, vertido, embalse y restitución", "Automática", OFFICIAL_LINKS.ctmHourly],
  ["CTM · comunicado", "Rango oficial de corto plazo", "Automática", OFFICIAL_LINKS.ctmBulletin],
  ["CTM · lluvia", "Pronóstico GFS por cuenca incremental", "Automática", OFFICIAL_LINKS.ctmRain],
  ["SMN", "Alertas meteorológicas", "Enlace de consulta", OFFICIAL_LINKS.smn],
  ["SNIH", "Series hidrológicas crudas", "En evaluación", OFFICIAL_LINKS.snih],
  ["CARU", "Información binacional del río Uruguay", "En evaluación", OFFICIAL_LINKS.caru],
];

function round(value: number) {
  return Math.round(value * 100) / 100;
}

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

function formatStationVariation(station: StationReading) {
  if (station.variation_m === null || station.variation_period_h === null) return "variación no informada";
  const sign = station.variation_m > 0 ? "+" : station.variation_m < 0 ? "−" : "";
  return `${sign}${formatNumber(Math.abs(station.variation_m))} m / ${station.variation_period_h} h`;
}

function createProjection(state: RiverState): ProjectionPoint[] {
  const current =
    state.observations.find((item) => item.station_id === "CONCORDIA_PNA")?.value ?? 10;
  const start = new Date(state.generated_at);
  const official = state.official_forecast;
  const officialIsCurrent =
    Date.parse(official.valid_until_local) >= Date.parse(state.generated_at);

  return Array.from({ length: 31 }, (_, day) => {
    const date = new Date(start);
    date.setDate(start.getDate() + day);

    if (day === 0) {
      return {
        day,
        date: date.toISOString(),
        min: current,
        central: current,
        max: current,
        uncertainty: "Moderada" as const,
        risk: "Bajo" as const,
        basis: "official" as const,
      };
    }

    if (day === 1 && officialIsCurrent) {
      return {
        day,
        date: date.toISOString(),
        min: official.concordia_min_m,
        central: round((official.concordia_min_m + official.concordia_max_m) / 2),
        max: official.concordia_max_m,
        uncertainty: "Moderada" as const,
        risk: official.concordia_max_m >= state.thresholds.alert_m ? "Medio" : "Bajo",
        basis: "official" as const,
      };
    }

    const upstreamPulse = 0.24 * Math.exp(-Math.pow((day - 7) / 5.5, 2));
    const persistence = 0.1 * (1 - Math.exp(-day / 14));
    const central = round(current + upstreamPulse + persistence);
    const lowerWidth = 0.18 + 0.035 * day + 0.0007 * day * day;
    const upperWidth = 0.22 + 0.043 * day + 0.0009 * day * day;
    const min = round(Math.max(7.5, central - lowerWidth));
    const max = round(central + upperWidth);
    const risk: Risk =
      max >= state.thresholds.evacuation_m
        ? "Alto"
        : max >= state.thresholds.alert_m
          ? "Medio"
          : "Bajo";
    const uncertainty: Uncertainty =
      day <= 3 ? "Moderada" : day <= 7 ? "Alta" : "Muy alta";

    return {
      day,
      date: date.toISOString(),
      min,
      central,
      max,
      uncertainty,
      risk,
      basis: "experimental",
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

function uncertaintyClass(value: Uncertainty) {
  if (value === "Moderada") return "uncertainty-moderate";
  if (value === "Alta") return "uncertainty-high";
  return "uncertainty-very-high";
}

function riskClass(value: Risk) {
  if (value === "Bajo") return "risk-low";
  if (value === "Medio") return "risk-medium";
  return "risk-high";
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
  const minY = 7.5;
  const maxY = 13.5;
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
  const yTicks = [8, 9, 10, 11, 12, 13];
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
          La serie oficial observada llega hasta hoy. Desde hoy se abre una banda con
          límites inferior y superior; su ancho muestra incertidumbre creciente y no
          probabilidades.
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
          escenario experimental · incertidumbre creciente
        </text>
        <text x={x(26)} y={y(projection[26].max) - 12} className="bound-label">
          máximo estimado
        </text>
        <text x={x(26)} y={y(projection[26].min) + 22} className="bound-label">
          mínimo estimado
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

function TerritoryMap() {
  const contours = Array.from({ length: 12 }, (_, index) => index);
  return (
    <div className="territory-map">
      <svg viewBox="0 0 470 720" role="img" aria-labelledby="map-title map-desc">
        <title id="map-title">Corredor del río Uruguay junto a Concordia</title>
        <desc id="map-desc">
          Esquema territorial con Salto Grande, Puerto Concordia, Costanera, Club
          Comunicaciones, Defensa Sur y dirección del flujo. Las ubicaciones son
          aproximadas.
        </desc>
        <rect width="470" height="720" className="map-paper" />
        {contours.map((index) => (
          <path
            key={index}
            d={`M ${-70 + index * 28} 0 C ${60 + index * 19} 145, ${-35 + index * 33} 280, ${
              65 + index * 27
            } 420 S ${10 + index * 38} 640, ${145 + index * 28} 720`}
            className="contour-line"
          />
        ))}

        <path
          d="M 238 -20 C 197 70 258 120 222 190 C 194 246 234 291 202 350 C 176 400 210 454 184 520 C 164 575 205 640 177 748"
          className="river-bank river-bank-left"
        />
        <path
          d="M 302 -20 C 263 78 323 126 286 196 C 258 254 302 301 266 361 C 239 411 273 466 246 532 C 224 590 270 648 239 748"
          className="river-bank river-bank-right"
        />
        <path
          d="M 270 -20 C 230 75 291 123 254 193 C 226 249 268 296 234 356 C 207 405 242 460 216 526 C 194 582 237 644 208 748"
          className="river-center"
        />

        <path d="M 160 333 C 177 342 188 350 202 357" className="creek-line" />
        <path d="M 142 480 C 162 490 175 503 190 520" className="creek-line" />
        <path d="M 118 577 C 142 570 160 560 177 548" className="defense-line" />

        <text x="50" y="315" className="country-label">ARGENTINA</text>
        <text x="329" y="315" className="country-label">URUGUAY</text>
        <text x="73" y="350" className="micro-label">Arroyo Manzores</text>
        <text x="57" y="502" className="micro-label">Arroyo Concordia</text>
        <text x="43" y="604" className="micro-label">Defensa Sur</text>

        <g transform="translate(220 80)">
          <path d="M 0 0 L 82 0 M 7 -7 L 7 9 M 18 -7 L 18 9 M 29 -7 L 29 9 M 40 -7 L 40 9 M 51 -7 L 51 9 M 62 -7 L 62 9 M 73 -7 L 73 9" className="dam-symbol" />
          <circle cx="42" cy="3" r="8" className="map-point dam-point" />
          <text x="97" y="8" className="place-label">Salto Grande</text>
        </g>

        <g transform="translate(214 355)">
          <circle cx="20" cy="0" r="11" className="map-point selected-point" />
          <line x1="31" x2="107" y1="0" y2="0" className="leader-line" />
          <text x="113" y="6" className="place-label">Puerto Concordia</text>
        </g>

        <g transform="translate(197 443)">
          <circle cx="20" cy="0" r="7" className="map-point coast-point" />
          <line x1="28" x2="95" y1="0" y2="0" className="leader-line" />
          <text x="101" y="6" className="place-label">Costanera</text>
        </g>

        <g transform="translate(184 538)">
          <circle cx="20" cy="0" r="7" className="map-point club-point" />
          <line x1="27" x2="78" y1="0" y2="0" className="leader-line" />
          <text x="84" y="-2" className="place-label">Club</text>
          <text x="84" y="16" className="place-label">Comunicaciones</text>
        </g>

        <g transform="translate(45 70)">
          <text x="0" y="0" className="north-label">N</text>
          <path d="M 8 16 L -2 55 L 8 47 L 18 55 Z" className="north-arrow" />
        </g>

        <g transform="translate(355 92)">
          <path d="M 0 55 L 0 0 M -8 12 L 0 0 L 8 12" className="flow-arrow" />
          <text x="-18" y="76" className="micro-label">aguas arriba</text>
        </g>
        <g transform="translate(350 602)">
          <path d="M 0 0 L 0 55 M -8 43 L 0 55 L 8 43" className="flow-arrow" />
          <text x="-18" y="-10" className="micro-label">aguas abajo</text>
        </g>

        <g transform="translate(48 672)">
          <line x1="0" x2="105" y1="0" y2="0" className="scale-line" />
          <line x1="0" x2="0" y1="-5" y2="5" className="scale-line" />
          <line x1="105" x2="105" y1="-5" y2="5" className="scale-line" />
          <text x="52" y="-10" textAnchor="middle" className="micro-label">2 km</text>
        </g>
      </svg>
      <p className="map-caption">
        Esquema de referencia. Los puntos ayudan a leer el corredor y no sustituyen
        cartografía operativa.
      </p>
    </div>
  );
}

export default function Home() {
  const [state, setState] = useState<RiverState>(FALLBACK_STATE);
  const [horizon, setHorizon] = useState(7);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    fetch(`${basePath}/data/current_state.json`, { cache: "no-store" })
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
            <a href="#cuenca" onClick={() => setMenuOpen(false)}>Cuenca</a>
            <a href="#territorio" onClick={() => setMenuOpen(false)}>Lugares</a>
            <a href="#preparacion" onClick={() => setMenuOpen(false)}>Preparación</a>
            <a href="#fuentes" onClick={() => setMenuOpen(false)}>Fuentes</a>
          </nav>

          <div className="header-meta">
            <span>Actualizado {generated}</span>
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
              PNA ·{" "}
              {concordiaObservation
                ? formatDate(concordiaObservation.observed_at_local, {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "último corte incluido"}
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
              {formatNumber(state.official_forecast.concordia_min_m)}–
              {formatNumber(state.official_forecast.concordia_max_m)} <small>m</small>
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
          <aside className="map-column">
            <TerritoryMap />
          </aside>

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
                {state.update_status?.state === "fresh" ? "Fuentes al día" : "Revisar actualización"}
              </div>
            </div>

            <p className="forecast-intro">
              La línea azul muestra mediciones oficiales. La banda se abre desde hoy:
              durante las primeras 24 horas reproduce el rango informado por CTM; después
              representa un escenario experimental cuyo margen crece con el horizonte.
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
                <span>Rango del escenario</span>
                <strong>{formatNumber(selected.min)}–{formatNumber(selected.max)} m</strong>
              </div>
              <div>
                <span>Riesgo de alcanzar umbrales</span>
                <strong className={riskClass(selected.risk)}>{selected.risk}</strong>
              </div>
              <div>
                <span>Incertidumbre</span>
                <strong className={uncertaintyClass(selected.uncertainty)}>
                  {selected.uncertainty}
                </strong>
              </div>
            </div>

            <div className="interpretation-note">
              <Info size={17} />
              <p>
                <strong>{selected.basis === "official" ? "Cobertura oficial." : "Estimación experimental."}</strong>{" "}
                “Mínimo” y “máximo” son límites del escenario bajo los supuestos actuales,
                no extremos físicamente posibles ni probabilidades. La incertidumbre es
                {` ${selected.uncertainty.toLowerCase()}`}.
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
        </div>
      </section>

      <section id="territorio" className="content-section territory-section">
        <div className="page-width territory-layout">
          <div className="section-title">
            <span>CONCORDIA Y SU COSTA</span>
            <h2>Lugares que requieren seguimiento</h2>
            <p>
              El mapa prioriza puntos conocidos y sistemas de protección. No dibuja
              áreas inundadas cuando no existe una capa validada para el escenario.
            </p>
          </div>
          <div className="places-list">
            <div><b>01</b><span><strong>Puerto Concordia</strong><small>Referencia hidrométrica oficial</small></span></div>
            <div><b>02</b><span><strong>Costanera</strong><small>Usos públicos y equipamiento expuesto</small></span></div>
            <div><b>03</b><span><strong>Club Comunicaciones</strong><small>Instalaciones deportivas junto al río</small></span></div>
            <div><b>04</b><span><strong>Defensa Sur</strong><small>Terraplén, compuertas y estaciones de bombeo</small></span></div>
            <div><b>05</b><span><strong>Arroyos Concordia y Manzores</strong><small>Drenaje urbano condicionado por el río</small></span></div>
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
              <span><strong>Medición</strong><small>La serie observada proviene de PNA y conserva fecha, unidad y estación.</small></span>
            </div>
            <div>
              <b>2</b>
              <span><strong>Primeras 24 horas</strong><small>La banda reproduce el mínimo y máximo del comunicado diario de CTM.</small></span>
            </div>
            <div>
              <b>3</b>
              <span><strong>Días 2 a 30</strong><small>Un escenario de persistencia incorpora descarga, señal aguas arriba y lluvia publicada.</small></span>
            </div>
            <div>
              <b>4</b>
              <span><strong>Incertidumbre</strong><small>El rango se ensancha con el horizonte porque el método todavía no está calibrado.</small></span>
            </div>
          </div>
          <div className="method-warning">
            <Info size={18} />
            <p>
              Este es un primer modelo experimental y auditable. No tiene todavía
              backtesting suficiente para informar probabilidades. Su función es hacer
              visible el abanico de escenarios, no reemplazar los partes oficiales.
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
              <a href={`${publicBasePath}/data/current_state.json`} download><Database size={15} /> Datos JSON</a>
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
