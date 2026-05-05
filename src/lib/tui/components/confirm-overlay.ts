import { type Component, type Focusable, Key, matchesKey, visibleWidth } from "@mariozechner/pi-tui";
import { theme } from "../theme.js";

export interface ConfirmOptions {
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel?: () => void;
}

/**
 * Modal yes/no confirmation. Designed to be passed into pi-tui's
 * `tui.showOverlay()`. Tracks its own focus and dismisses on Esc/n/y.
 */
export class ConfirmOverlay implements Component, Focusable {
  focused = true;
  private title: string;
  private body: string;
  private confirmLabel: string;
  private cancelLabel: string;
  private onConfirm: () => void;
  private onCancel?: () => void;

  constructor(options: ConfirmOptions) {
    this.title = options.title;
    this.body = options.body;
    this.confirmLabel = options.confirmLabel ?? "Confirm";
    this.cancelLabel = options.cancelLabel ?? "Cancel";
    this.onConfirm = options.onConfirm;
    this.onCancel = options.onCancel;
  }

  invalidate(): void {}

  handleInput(data: string): void {
    if (matchesKey(data, "y") || matchesKey(data, Key.enter)) {
      this.onConfirm();
    } else if (matchesKey(data, "n") || matchesKey(data, Key.escape)) {
      this.onCancel?.();
    }
  }

  render(width: number): string[] {
    const w = Math.min(width, 64);
    const inner = w - 4;
    const titleLine = `  ${theme.bold(theme.fg("text", this.title))}`;
    const bodyLines = wrap(this.body, inner).map((line) => `  ${theme.fg("text", line)}`);
    const buttonsLine = `  ${theme.fg("success", `[Y] ${this.confirmLabel}`)}    ${theme.fg("muted", `[N] ${this.cancelLabel}`)}`;
    const lines = [titleLine, "", ...bodyLines, "", buttonsLine];
    // Pad to width and add a top/bottom border.
    const top = theme.dim("─".repeat(w));
    const bottom = top;
    return [top, ...lines.map((l) => padToWidth(l, w)), bottom];
  }
}

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let current = "";
  for (const word of words) {
    if (visibleWidth(`${current}${current ? " " : ""}${word}`) > width) {
      if (current) out.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) out.push(current);
  return out;
}

function padToWidth(text: string, width: number): string {
  const w = visibleWidth(text);
  if (w >= width) return text;
  return `${text}${" ".repeat(width - w)}`;
}
