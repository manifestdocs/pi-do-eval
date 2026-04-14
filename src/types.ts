// -- Session event parsing -----------------------------------------------------

export interface ToolCallRecord {
  timestamp: number;
  name: string;
  arguments: Record<string, unknown>;
  resultText: string;
  wasBlocked: boolean;
}

export interface FileWriteRecord {
  timestamp: number;
  path: string;
  tool: "write" | "edit";
  labels: string[];
}

export interface PluginEvent {
  timestamp: number;
  type: string;
  data: Record<string, unknown>;
}

export interface EvalSession {
  toolCalls: ToolCallRecord[];
  fileWrites: FileWriteRecord[];
  pluginEvents: PluginEvent[];
  rawLines: string[];
  startTime: number;
  endTime: number;
  exitCode: number | null;
  tokenUsage: { input: number; output: number };
  modelInfo?: { model: string; provider: string };
  parseWarnings: number;
}

// -- Verification --------------------------------------------------------------

export interface VerifyResult {
  passed: boolean;
  output: string;
  metrics: Record<string, number>;
}

// -- Plugin interface ----------------------------------------------------------

export interface PluginScoreResult {
  scores: Record<string, number>;
  weights: Record<string, number>;
  findings: string[];
}

export interface EvalPlugin {
  name: string;
  extensionPath: string;
  parseEvent?(toolName: string, resultText: string, timestamp: number): PluginEvent[];
  classifyFile?(filePath: string): string;
  scoreSession(session: EvalSession, verify: VerifyResult): PluginScoreResult;
  buildJudgePrompt(taskDescription: string, workDir: string): string;
  verify?(workDir: string): VerifyResult;
  formatSummary?(session: EvalSession): string[];
}

// -- Judge ---------------------------------------------------------------------

export interface JudgeResult {
  scores: Record<string, number>;
  reasons: Record<string, string>;
  findings: string[];
}

export type JudgeFailureReason = "timeout" | "crash" | "parse_error" | "empty_response";

export type JudgeOutcome = { ok: true; result: JudgeResult } | { ok: false; reason: JudgeFailureReason };

// -- Scoring -------------------------------------------------------------------

export interface EvalScores {
  deterministic: Record<string, number>;
  judge?: Record<string, number>;
  overall: number;
}

export type EvalRunStatus = "completed" | "timeout" | "crashed" | "stalled";

export interface EvalMeta {
  trial: string;
  variant: string;
  workerModel: string;
  judgeModel?: string;
  startedAt: string;
  durationMs: number;
  status: EvalRunStatus;
  suite?: string;
  suiteRunId?: string;
}

export interface EvalReport {
  meta: EvalMeta;
  scores: EvalScores;
  judgeResult?: JudgeResult;
  session: EvalSession;
  findings: string[];
}

// -- Suites --------------------------------------------------------------------

export interface SuiteReportEntry {
  trial: string;
  variant: string;
  runDir: string;
  status: EvalRunStatus;
  overall: number;
  verifyPassed: boolean;
  deterministic: Record<string, number>;
  judge?: Record<string, number>;
  findings: string[];
}

export interface SuiteReportSummary {
  totalRuns: number;
  completedRuns: number;
  verifyFailureCount: number;
  hardFailureCount: number;
  averageOverall: number;
}

export interface SuiteReport {
  suite: string;
  suiteRunId: string;
  startedAt: string;
  completedAt: string;
  entries: SuiteReportEntry[];
  summary: SuiteReportSummary;
}

export interface SuiteIndexEntry {
  suite: string;
  suiteRunId: string;
  dir: string;
  startedAt: string;
  completedAt: string;
  totalRuns: number;
  hardFailureCount: number;
  averageOverall: number;
}

export interface SuiteComparisonOptions {
  threshold?: number;
}

export interface SuiteComparisonEntry {
  trial: string;
  variant: string;
  current?: SuiteReportEntry;
  baseline?: SuiteReportEntry;
  deltaOverall?: number;
  regression: boolean;
  findings: string[];
}

export interface SuiteComparison {
  suite: string;
  currentSuiteRunId: string;
  baselineSuiteRunId: string;
  threshold: number;
  currentAverageOverall: number;
  baselineAverageOverall: number;
  averageDelta: number;
  entries: SuiteComparisonEntry[];
  findings: string[];
  hasRegression: boolean;
}

// -- Sandbox ------------------------------------------------------------------

export interface SandboxOptions {
  extraRwPaths?: string[];
  extraRoPaths?: string[];
  lockdown?: boolean;
}
