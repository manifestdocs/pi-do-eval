import { type Component, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { theme } from "../theme.js";

export interface TableColumn<T> {
  /** Header text. */
  header: string;
  /** Cell renderer. May return ANSI-styled text. */
  render: (item: T) => string;
  /**
   * Width allocation. Number = fixed columns. `"flex"` = take remaining width
   * (multiple flex columns share evenly). Defaults to "flex".
   */
  width?: number | "flex";
  /** Right-align cell content. Default left. */
  align?: "left" | "right";
}

/**
 * Multi-column row renderer. Allocates fixed widths first, distributes
 * remaining space across `flex` columns, truncates each cell to its slot.
 */
export class Table<T> implements Component {
  private columns: TableColumn<T>[];
  private rows: T[] = [];
  private showHeader: boolean;

  constructor(columns: TableColumn<T>[], options: { showHeader?: boolean } = {}) {
    this.columns = columns;
    this.showHeader = options.showHeader ?? true;
  }

  setRows(rows: T[]): void {
    this.rows = rows;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const widths = this.allocateWidths(width);
    const lines: string[] = [];
    if (this.showHeader) {
      lines.push(
        this.renderRow(
          widths,
          this.columns.map((c) => theme.dim(c.header.toUpperCase())),
          this.columns,
        ),
      );
      lines.push(theme.dim("─".repeat(width)));
    }
    for (const row of this.rows) {
      lines.push(
        this.renderRow(
          widths,
          this.columns.map((c) => c.render(row)),
          this.columns,
        ),
      );
    }
    return lines;
  }

  private allocateWidths(total: number): number[] {
    const gap = 1;
    const gapTotal = gap * (this.columns.length - 1);
    let remaining = Math.max(0, total - gapTotal);
    const widths: number[] = new Array(this.columns.length).fill(0);
    let flexCount = 0;
    for (let i = 0; i < this.columns.length; i++) {
      const w = this.columns[i]?.width;
      if (typeof w === "number") {
        const allocated = Math.min(w, remaining);
        widths[i] = allocated;
        remaining -= allocated;
      } else {
        flexCount++;
      }
    }
    if (flexCount > 0) {
      const each = Math.floor(remaining / flexCount);
      let leftover = remaining - each * flexCount;
      for (let i = 0; i < this.columns.length; i++) {
        if (this.columns[i]?.width === undefined || this.columns[i]?.width === "flex") {
          widths[i] = each + (leftover > 0 ? 1 : 0);
          if (leftover > 0) leftover--;
        }
      }
    }
    return widths;
  }

  private renderRow(widths: number[], cells: string[], columns: TableColumn<T>[]): string {
    const parts: string[] = [];
    for (let i = 0; i < cells.length; i++) {
      const w = widths[i] ?? 0;
      const align = columns[i]?.align ?? "left";
      const cell = cells[i] ?? "";
      const cw = visibleWidth(cell);
      let formatted: string;
      if (cw > w) {
        formatted = truncateToWidth(cell, w, "…");
      } else if (align === "right") {
        formatted = `${" ".repeat(w - cw)}${cell}`;
      } else {
        formatted = `${cell}${" ".repeat(w - cw)}`;
      }
      parts.push(formatted);
    }
    return parts.join(" ");
  }
}
