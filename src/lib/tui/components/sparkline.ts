import { theme } from "../theme.js";

const BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;
const MID = BLOCKS[3];

/**
 * Renders an array of numbers as a single-line block-character sparkline.
 * Returns a string (not a Component) — callers compose it inline into rows.
 */
export function sparkline(values: number[], options: { min?: number; max?: number } = {}): string {
  if (values.length === 0) return theme.dim("—");
  const min = options.min ?? Math.min(...values);
  const max = options.max ?? Math.max(...values);
  const range = max - min;
  if (range === 0) {
    // All same value — render mid-height.
    return theme.fg("muted", MID.repeat(values.length));
  }
  const chars: string[] = [];
  for (const v of values) {
    const idx = Math.min(BLOCKS.length - 1, Math.max(0, Math.round(((v - min) / range) * (BLOCKS.length - 1))));
    chars.push(BLOCKS[idx] ?? MID);
  }
  return theme.fg("accent", chars.join(""));
}
