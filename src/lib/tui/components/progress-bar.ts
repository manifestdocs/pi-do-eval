import { type Component, visibleWidth } from "@mariozechner/pi-tui";
import { theme } from "../theme.js";

const FULL = "█";
const EMPTY = "░";

export interface ProgressBarOptions {
  total: number;
  done?: number;
  label?: string;
  width?: number;
}

/**
 * Block-character progress bar. Renders inline; takes the configured `width`
 * (defaults to 24 cells). The label sits to the left, the bar to the right
 * of the label.
 */
export class ProgressBar implements Component {
  private total: number;
  private done: number;
  private label: string;
  private barWidth: number;

  constructor(options: ProgressBarOptions) {
    this.total = Math.max(1, options.total);
    this.done = Math.max(0, Math.min(options.done ?? 0, this.total));
    this.label = options.label ?? "";
    this.barWidth = options.width ?? 24;
  }

  set(done: number, total?: number): void {
    if (total !== undefined) this.total = Math.max(1, total);
    this.done = Math.max(0, Math.min(done, this.total));
  }

  invalidate(): void {}

  render(_width: number): string[] {
    const filled = Math.floor((this.done / this.total) * this.barWidth);
    const filledStr = theme.fg("accent", FULL.repeat(filled));
    const emptyStr = theme.dim(EMPTY.repeat(this.barWidth - filled));
    const count = theme.dim(` ${this.done}/${this.total}`);
    const labelPart = this.label ? `${theme.fg("muted", this.label)} ` : "";
    const line = `${labelPart}${filledStr}${emptyStr}${count}`;
    void visibleWidth;
    return [line];
  }
}
