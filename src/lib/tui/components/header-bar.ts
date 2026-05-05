import { type Component, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { theme } from "../theme.js";

export interface HeaderBarOptions {
  /** Brand label rendered on the left, e.g. "do-eval". */
  brand?: string;
  /** Project name. Bold. */
  projectName?: string;
  /** Project path. Dim. */
  projectPath?: string;
}

/**
 * Single-line header bar. Renders three regions left-to-right:
 *   <brand> · <projectName>  ·  <projectPath>
 * Right-side path truncates to fit available width.
 */
export class HeaderBar implements Component {
  private brand: string;
  private projectName: string;
  private projectPath: string;

  constructor(options: HeaderBarOptions = {}) {
    this.brand = options.brand ?? "do-eval";
    this.projectName = options.projectName ?? "";
    this.projectPath = options.projectPath ?? "";
  }

  setProject(name: string, path: string): void {
    this.projectName = name;
    this.projectPath = path;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const sep = theme.dim(" · ");
    const brand = theme.fg("headerBrand", theme.bold(this.brand));
    const segments: string[] = [brand];
    if (this.projectName) segments.push(theme.bold(this.projectName));
    if (this.projectPath) segments.push(theme.fg("muted", this.projectPath));

    let line = segments.join(sep);
    const lineWidth = visibleWidth(line);
    if (lineWidth > width) {
      // Last segment (path) is the most expendable — truncate the whole line.
      line = truncateToWidth(line, width, "…");
    } else {
      // Pad to full width so the bg color spans correctly.
      line = `${line}${" ".repeat(width - lineWidth)}`;
    }
    return [theme.bg("header", line)];
  }
}
