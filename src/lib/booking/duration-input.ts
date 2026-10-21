import { PRICING_STEP_MINUTES } from "./pricing";

/** Shortest walk-in session; the POS service enforces this same constant. */
export const WALK_IN_MIN_MINUTES = 15;
/** Longest fixed session; mirrors MAX_DURATION_MINUTES in the booking service. */
export const MAX_FIXED_MINUTES = 12 * 60;

/** Parses what a cashier typed, accepting Arabic-Indic digits and an Arabic or comma decimal point. */
export function parseDigits(text: string): number {
  const ascii = text
    .trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٫,]/g, ".");
  return ascii === "" || !/^\d*\.?\d*$/.test(ascii) ? NaN : Number(ascii);
}

/** Integer within [min, max]; null when the input isn't a number. */
export function clampInt(value: number, min: number, max: number): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export interface DurationChoice {
  /** Minutes on the server's 5-minute grid, or null when nothing usable is chosen. */
  minutes: number | null;
  /** The typed value was rounded to the grid. */
  rounded: boolean;
  error: "SHORT" | "LONG" | null;
}

/**
 * The fixed-session length: a typed custom value (minutes or hours) wins over the preset.
 * A preset that no longer fits falls back to the longest that does.
 */
export function resolveDuration({
  preset,
  custom,
  unit,
  maxFixed,
  presets = DURATION_PRESETS,
}: {
  preset: number;
  custom: string;
  unit: "MIN" | "HOUR";
  maxFixed: number;
  presets?: readonly number[];
}): DurationChoice {
  if (custom.trim() === "") {
    const fits = preset <= maxFixed ? preset : (presets.filter((m) => m <= maxFixed).at(-1) ?? null);
    return { minutes: fits, rounded: false, error: fits === null ? "SHORT" : null };
  }
  const value = parseDigits(custom);
  if (!Number.isFinite(value) || value <= 0) return { minutes: null, rounded: false, error: "SHORT" };
  const raw = unit === "HOUR" ? value * 60 : value;
  const minutes = Math.round(raw / PRICING_STEP_MINUTES) * PRICING_STEP_MINUTES;
  const error = minutes < WALK_IN_MIN_MINUTES ? "SHORT" : minutes > maxFixed ? "LONG" : null;
  return { minutes, rounded: minutes !== raw, error };
}

/** Quick picks on the start-session screen. */
export const DURATION_PRESETS = [30, 60, 120, 180] as const;
