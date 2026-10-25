// Game settings the host can tune in the lobby (`hostSettings` in data/game.json).
// Values travel as numbers (a boolean setting is 0/1); `path` points into the game config.
import config from "../data/game.json" with { type: "json" };

export type GameConfig = typeof config;

export interface SettingDef {
  id: string;
  label: string;
  path: string;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  bool?: boolean;
  zero?: string; // label shown for 0 (e.g. "Auto")
}

export type Settings = Record<string, number>;

export const settingDefs = config.hostSettings as SettingDef[];

function read(cfg: unknown, path: string): unknown {
  return path.split(".").reduce((o, k) => (o as Record<string, unknown>)[k], cfg);
}

export function defaultSettings(): Settings {
  return Object.fromEntries(settingDefs.map((d) => [d.id, Number(read(config, d.path))]));
}

// Untrusted value from the client: unknown id or non-number = undefined, otherwise clamped and snapped to the step.
export function cleanSetting(id: string, raw: unknown): number | undefined {
  const d = settingDefs.find((s) => s.id === id);
  if (!d || typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  if (d.bool) return raw ? 1 : 0;
  const min = d.min ?? 0;
  const step = d.step ?? 1;
  const snapped = min + Math.round((raw - min) / step) * step;
  return Math.min(d.max ?? snapped, Math.max(min, snapped));
}

// A full config with the settings applied (each room has its own).
export function configWith(settings: Settings): GameConfig {
  const cfg = structuredClone(config);
  for (const d of settingDefs) {
    const keys = d.path.split(".");
    const parent = (keys.length > 1 ? read(cfg, keys.slice(0, -1).join(".")) : cfg) as Record<string, unknown>;
    parent[keys[keys.length - 1]] = d.bool ? !!settings[d.id] : settings[d.id];
  }
  return cfg;
}

export function formatSetting(d: SettingDef, v: number) {
  if (d.bool) return v ? "On" : "Off";
  if (v === 0 && d.zero) return d.zero;
  if (d.unit === "s" && v >= 60) return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
  return `${v}${d.unit ?? ""}`;
}
