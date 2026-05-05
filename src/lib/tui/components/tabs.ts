import { type Component, type Focusable, isKeyRelease, Key, matchesKey, visibleWidth } from "@mariozechner/pi-tui";
import { theme } from "../theme.js";

export interface TabSpec {
  id: string;
  label: string;
}

/**
 * Horizontal tab strip with stateful active index. Routes left/right (or
 * Tab / Shift+Tab) input to switch tabs and forwards everything else to the
 * active pane via the parent screen's input router.
 *
 * The Tabs component itself only owns the strip; rendering of pane content
 * is the screen's responsibility.
 */
export class Tabs implements Component, Focusable {
  focused = false;
  private tabs: TabSpec[];
  private activeIndex = 0;
  private onChange?: (id: string, index: number) => void;

  constructor(tabs: TabSpec[], onChange?: (id: string, index: number) => void) {
    this.tabs = tabs;
    this.onChange = onChange;
  }

  getActiveId(): string | undefined {
    return this.tabs[this.activeIndex]?.id;
  }

  getActiveIndex(): number {
    return this.activeIndex;
  }

  setActive(index: number): void {
    const next = Math.max(0, Math.min(this.tabs.length - 1, index));
    if (next === this.activeIndex) return;
    this.activeIndex = next;
    const tab = this.tabs[next];
    if (tab) this.onChange?.(tab.id, next);
  }

  invalidate(): void {}

  handleInput(data: string): void {
    if (isKeyRelease(data)) return;
    if (matchesKey(data, Key.left) || matchesKey(data, Key.shift("tab"))) {
      this.setActive(this.activeIndex - 1);
    } else if (matchesKey(data, Key.right) || matchesKey(data, Key.tab)) {
      this.setActive(this.activeIndex + 1);
    }
  }

  render(_width: number): string[] {
    const parts = this.tabs.map((tab, i) => {
      const label = ` ${tab.label} `;
      if (i === this.activeIndex) {
        return theme.bg("selected", theme.fg("selected", theme.bold(label)));
      }
      return theme.fg("muted", label);
    });
    const sep = theme.dim("│");
    const line = parts.join(sep);
    return [line, theme.dim("─".repeat(visibleWidth(line)))];
  }
}
