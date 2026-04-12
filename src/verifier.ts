import type { VerifyResult } from "./types.js";

/** Default verification -- returns passed with no metrics. Plugins override via verify(). */
export function defaultVerify(): VerifyResult {
  return { passed: true, output: "", metrics: {} };
}
