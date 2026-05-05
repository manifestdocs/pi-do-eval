import { EventEmitter } from "node:events";
import type { EvalEvent } from "$eval/types.js";

/**
 * Event bus that bridges `runEval`'s `live.emit` callback into the TUI.
 *
 * Phase 1 stub — wired up in Phase 3 once `runProject*Command` accepts an
 * `emit` parameter and threads it through to `runEval`. For now, the bus
 * exists so the rest of the TUI can subscribe to a stable interface.
 */
export class EvalEventBus {
  private emitter = new EventEmitter();

  emit(event: EvalEvent): void {
    this.emitter.emit("event", event);
  }

  subscribe(listener: (event: EvalEvent) => void): () => void {
    this.emitter.on("event", listener);
    return () => {
      this.emitter.off("event", listener);
    };
  }
}
