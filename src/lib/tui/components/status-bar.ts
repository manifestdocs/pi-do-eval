import { type Component, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { theme } from "../theme.js";

export interface StatusBarRegions {
  /** Left region: mode hint, e.g. "Runs · Regression". */
  left?: string;
  /** Center region: active run summary, e.g. "▷ stack-calc/typescript-vitest · 42s · 17 tools". */
  center?: string;
  /** Right region: key hints, e.g. "n new · q quit". */
  right?: string;
}

/**
 * Single-line status bar at the bottom of the screen. Three regions distributed
 * across the row; if total width is exceeded, center > right > left in priority
 * order are truncated.
 */
export class StatusBar implements Component {
  private regions: StatusBarRegions = {};

  set(regions: StatusBarRegions): void {
    this.regions = { ...this.regions, ...regions };
  }

  invalidate(): void {}

  render(width: number): string[] {
    const left = this.regions.left ?? "";
    const center = this.regions.center ?? "";
    const right = this.regions.right ?? "";

    const styledLeft = left ? theme.fg("muted", left) : "";
    const styledCenter = center ? theme.fg("accent", center) : "";
    const styledRight = right ? theme.dim(right) : "";

    const lw = visibleWidth(styledLeft);
    const cw = visibleWidth(styledCenter);
    const rw = visibleWidth(styledRight);

    // Try to render all three with padding between.
    if (lw + cw + rw + 4 <= width) {
      const leftPart = styledLeft;
      const rightPart = styledRight;
      const totalSidesW = lw + rw;
      const centerStart = Math.max(lw + 2, Math.floor((width - cw) / 2));
      const leftPad = " ".repeat(centerStart - lw);
      const middlePad = " ".repeat(width - (centerStart + cw) - rw);
      const line = `${leftPart}${leftPad}${styledCenter}${middlePad}${rightPart}`;
      void totalSidesW;
      return [theme.bg("footer", line)];
    }

    // Fallback: drop center, keep left/right.
    if (lw + rw + 2 <= width) {
      const pad = " ".repeat(width - lw - rw);
      return [theme.bg("footer", `${styledLeft}${pad}${styledRight}`)];
    }

    // Last resort: truncate to width.
    return [theme.bg("footer", truncateToWidth(`${styledLeft} ${styledRight}`, width, "…", true))];
  }
}
