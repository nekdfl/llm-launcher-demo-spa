import type { InferenceStatusLabel } from "../api/types";

export interface StatusPresentation {
  label: string;
  color: string;
  dotClass: string;
}

// Matches reference/dashboard/code.html status accents.
const PRESENTATION: Record<InferenceStatusLabel, StatusPresentation> = {
  running: { label: "работает", color: "#3ce36a", dotClass: "primary" },
  warming: { label: "разогрев", color: "#f1c100", dotClass: "warn" },
  unresponsive: { label: "перестал отвечать", color: "#ff5c5c", dotClass: "danger" },
  failed: { label: "упал", color: "#ff5c5c", dotClass: "danger" },
  stopped: { label: "остановлен", color: "#4a4a4a", dotClass: "off" },
};

export function presentStatus(status: InferenceStatusLabel): StatusPresentation {
  return PRESENTATION[status];
}

// A mini-sparkline only makes sense when the inference could plausibly be
// producing traffic right now — spec: "нет ложного нулевого графика" for
// warming/stopped (task 2.3, requirement "Мини-график токенов").
/** Accent classes from index.css — the left-edge line of the reference
 * mockups. Single table so every surface showing a status line (dashboard
 * tile, inference page header, GPU card list) draws the same colors. */
export type AccentClass =
  | "tactical-accent"
  | "tactical-accent-warn"
  | "tactical-accent-danger"
  | "tactical-accent-off";

const ACCENT_BY_STATUS: Record<InferenceStatusLabel, AccentClass> = {
  running: "tactical-accent",
  warming: "tactical-accent-warn",
  unresponsive: "tactical-accent-danger",
  failed: "tactical-accent-danger",
  stopped: "tactical-accent-off",
};

/** Tile accent: a stopped inference is idle, not a fault, so it stays
 * neutral there. */
export function accentClassFor(status: InferenceStatusLabel): AccentClass {
  return ACCENT_BY_STATUS[status];
}

/** The inference page's header indicator follows a deliberately coarser
 * three-color scheme (spec «Индикатор статуса в заголовке — цветная
 * линия»): green = up, yellow = intermediate, red = not serving — so a
 * stopped inference reads red here, unlike the tile accent. `transitioning`
 * covers the stop/restart in flight, a stage only the SPA knows about:
 * systemd and the plugin have no "stopping" status to report. */
export function statusLineClass(
  status: InferenceStatusLabel | null,
  options: { transitioning?: boolean } = {}
): AccentClass {
  if (options.transitioning) return "tactical-accent-warn";
  if (status === null) return "tactical-accent-off";
  if (status === "running") return "tactical-accent";
  if (status === "warming") return "tactical-accent-warn";
  return "tactical-accent-danger";
}

export function hasLikelyTraffic(status: InferenceStatusLabel): boolean {
  return status === "running" || status === "unresponsive";
}
