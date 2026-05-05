import type { Component, Focusable } from "@mariozechner/pi-tui";
import type { EvalEvent } from "$eval/types.js";

/**
 * A screen is a Component that owns the body region of the TUI for a given
 * mode (Projects / Runs / RunDetail / Suites / Trials / etc.). The app's
 * screen stack pushes/pops screens; the topmost screen is focused and
 * receives input.
 *
 * Screens reach back into the app via the controller for navigation,
 * status-bar updates, and re-render requests.
 */
export interface Screen extends Component, Focusable {
  /** Stable id used for telemetry / status hints. */
  readonly id: string;
  /** Called when the screen becomes the active screen. */
  enter?(): void;
  /** Called just before the screen is removed. */
  exit?(): void;
}

export interface ScreenController {
  push(screen: Screen): void;
  pop(): void;
  replace(screen: Screen): void;
  setStatusLeft(text: string): void;
  setStatusCenter(text: string): void;
  setStatusRight(text: string): void;
  setProject(name: string, path: string): void;
  clearProject(): void;
  requestRender(): void;
  /** Maximum height available to the screen body. Recomputed on resize. */
  bodyMaxRows(): number;
  /** Project-aware paths (only valid after a project is set). */
  getEvalDir(): string | null;
  /** The TUI currently tracks one active run at a time. */
  hasActiveRun(): boolean;
  /** Subscribe to live `EvalEvent`s. Returns an unsubscribe function. */
  onEvent(listener: (event: EvalEvent) => void): () => void;
  /** Get the typed callback to pass into `runProject*Command({ emit })`. */
  emitter(): (event: EvalEvent) => void;
}
