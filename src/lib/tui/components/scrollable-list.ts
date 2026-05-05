import { type Component, type Focusable, Key, matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { theme } from "../theme.js";

export interface ScrollableListOptions<T> {
  /** Render a single row's text (without selection styling). The list applies the highlight. */
  renderRow: (item: T, width: number) => string;
  /** Optional callback when Enter is pressed on the selected row. */
  onSelect?: (item: T, index: number) => void;
  /** Maximum visible rows. Defaults to 10. */
  maxRows?: number;
  /** Renders when items is empty. */
  emptyMessage?: string;
}

/**
 * Selection-preserving list that windows into a slice of `items` when the
 * list grows larger than `maxRows`. Closes the gap pi-tui's SelectList
 * leaves: a list of arbitrary length with persisted scroll state across
 * external state changes (e.g. SSE-style updates).
 */
export class ScrollableList<T> implements Component, Focusable {
  focused = false;
  private items: T[] = [];
  private selectedIndex = 0;
  private scrollOffset = 0;
  private renderRow: ScrollableListOptions<T>["renderRow"];
  private onSelect?: ScrollableListOptions<T>["onSelect"];
  private maxRows: number;
  private emptyMessage?: string;

  constructor(options: ScrollableListOptions<T>) {
    this.renderRow = options.renderRow;
    this.onSelect = options.onSelect;
    this.maxRows = options.maxRows ?? 10;
    this.emptyMessage = options.emptyMessage;
  }

  setItems(items: T[]): void {
    this.items = items;
    if (this.selectedIndex >= items.length) {
      this.selectedIndex = Math.max(0, items.length - 1);
    }
    if (this.scrollOffset > Math.max(0, items.length - this.maxRows)) {
      this.scrollOffset = Math.max(0, items.length - this.maxRows);
    }
  }

  setMaxRows(rows: number): void {
    this.maxRows = Math.max(1, rows);
    this.ensureVisible();
  }

  getSelected(): T | undefined {
    return this.items[this.selectedIndex];
  }

  getSelectedIndex(): number {
    return this.selectedIndex;
  }

  invalidate(): void {}

  handleInput(data: string): void {
    if (this.items.length === 0) return;
    if (matchesKey(data, Key.up) || matchesKey(data, "k")) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this.ensureVisible();
    } else if (matchesKey(data, Key.down) || matchesKey(data, "j")) {
      this.selectedIndex = Math.min(this.items.length - 1, this.selectedIndex + 1);
      this.ensureVisible();
    } else if (matchesKey(data, Key.home) || matchesKey(data, "g")) {
      this.selectedIndex = 0;
      this.ensureVisible();
    } else if (matchesKey(data, Key.end) || matchesKey(data, Key.shift("g"))) {
      this.selectedIndex = this.items.length - 1;
      this.ensureVisible();
    } else if (matchesKey(data, Key.enter)) {
      const item = this.items[this.selectedIndex];
      if (item !== undefined) this.onSelect?.(item, this.selectedIndex);
    }
  }

  private ensureVisible(): void {
    if (this.selectedIndex < this.scrollOffset) {
      this.scrollOffset = this.selectedIndex;
    } else if (this.selectedIndex >= this.scrollOffset + this.maxRows) {
      this.scrollOffset = this.selectedIndex - this.maxRows + 1;
    }
  }

  render(width: number): string[] {
    if (this.items.length === 0) {
      const msg = this.emptyMessage ?? "(empty)";
      return [theme.dim(`  ${msg}`)];
    }
    const lines: string[] = [];
    const end = Math.min(this.items.length, this.scrollOffset + this.maxRows);
    for (let i = this.scrollOffset; i < end; i++) {
      const item = this.items[i];
      if (item === undefined) continue;
      const isSelected = i === this.selectedIndex && this.focused;
      const indicator = isSelected ? theme.fg("accent", "▌") : " ";
      const rowText = this.renderRow(item, width - 2);
      const padded = padToWidth(rowText, width - 2);
      const styled = isSelected ? theme.bold(padded) : padded;
      lines.push(`${indicator} ${styled}`);
    }
    if (this.items.length > this.maxRows) {
      lines.push(theme.dim(`  ${this.scrollOffset + 1}–${end} of ${this.items.length}`));
    }
    return lines;
  }
}

function padToWidth(text: string, width: number): string {
  const w = visibleWidth(text);
  if (w >= width) return truncateToWidth(text, width, "…");
  return `${text}${" ".repeat(width - w)}`;
}
