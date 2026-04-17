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

// -- Budget assertions ---------------------------------------------------------

export interface BudgetConfig {
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxTotalTokens?: number;
  maxDurationMs?: number;
  maxToolCalls?: number;
  maxBlockedCalls?: number;
  maxFileWrites?: number;
}

// -- Verification --------------------------------------------------------------

export interface VerifyResult {
  passed: boolean;
  output: string;
  metrics: Record<string, number>;
}

// -- Plugin interface ----------------------------------------------------------

export interface JudgeScoreConfig {
  includeInOverall?: boolean;
  defaultWeight?: number;
  weights?: Record<string, number>;
}

export interface PluginScoreResult {
  scores: Record<string, number>;
  weights: Record<string, number>;
  findings: string[];
  judge?: JudgeScoreConfig;
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

export type JudgeOutcome =
  | { ok: true; result: JudgeResult }
  | { ok: false; reason: JudgeFailureReason; stdout?: string };

// -- Scoring -------------------------------------------------------------------

export interface EvalScores {
  deterministic: Record<string, number>;
  judge?: Record<string, number>;
  overall: number;
  issues: string[];
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
  verifyPassed: boolean;
  suite?: string;
  suiteRunId?: string;
  epoch?: number;
  totalEpochs?: number;
}

export interface EvalReport {
  meta: EvalMeta;
  scores: EvalScores;
  judgeResult?: JudgeResult;
  session: EvalSession;
  findings: string[];
}

// -- Epoch statistics ----------------------------------------------------------

export type RegressionSeverity = "hard" | "clear" | "drift";

export interface EpochStats {
  mean: number;
  stderr: number;
  min: number;
  max: number;
  n: number;
  values: number[];
}

export type StatusCounts = Partial<Record<EvalRunStatus, number>>;

export interface AggregatedSuiteEntry {
  trial: string;
  variant: string;
  epochs: number;
  runDirs: string[];
  overall: EpochStats;
  deterministic: Record<string, EpochStats>;
  judge?: Record<string, EpochStats>;
  statusCounts: StatusCounts;
  verifyPassCount: number;
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
  epochs?: number;
}

export interface SuiteReport {
  suite: string;
  suiteRunId: string;
  workerModel?: string;
  startedAt: string;
  completedAt: string;
  entries: SuiteReportEntry[];
  summary: SuiteReportSummary;
  epochs?: number;
  aggregated?: AggregatedSuiteEntry[];
  comparison?: SuiteComparison;
}

export interface SuiteIndexEntry {
  suite: string;
  suiteRunId: string;
  workerModel?: string;
  dir: string;
  startedAt: string;
  completedAt: string;
  totalRuns: number;
  hardFailureCount: number;
  averageOverall: number;
  epochs?: number;
}

export interface SuiteComparisonOptions {
  threshold?: number;
}

export interface SuiteComparisonEntry {
  trial: string;
  variant: string;
  current?: SuiteReportEntry;
  baseline?: SuiteReportEntry;
  currentAggregated?: AggregatedSuiteEntry;
  baselineAggregated?: AggregatedSuiteEntry;
  deltaOverall?: number;
  regression: boolean;
  severity?: RegressionSeverity;
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
  hardRegressionCount: number;
  clearRegressionCount: number;
  driftCount: number;
}

// -- Run Index ----------------------------------------------------------------

export interface RunIndexEntry {
  dir: string;
  trial: string;
  variant: string;
  status: string;
  overall: number;
  durationMs: number;
  startedAt: string;
  workerModel: string;
  judgeModel?: string;
  suite?: string;
  suiteRunId?: string;
  epoch?: number;
  totalEpochs?: number;
}

// -- SSE Events ---------------------------------------------------------------

interface EvalEventBase {
  timestamp: number;
}

export type EvalEvent =
  | (EvalEventBase & {
      type: "run_started";
      dir: string;
      trial: string;
      variant: string;
      suite?: string;
      suiteRunId?: string;
      workerModel?: string;
    })
  | (EvalEventBase & {
      type: "run_progress";
      dir: string;
      durationMs: number;
      toolCount: number;
      fileCount: number;
    })
  | (EvalEventBase & {
      type: "run_completed";
      dir: string;
      status: EvalRunStatus;
      overall?: number;
      durationMs: number;
    })
  | (EvalEventBase & {
      type: "index_updated";
      runs: RunIndexEntry[];
    })
  | (EvalEventBase & {
      type: "epoch_progress";
      suite: string;
      suiteRunId: string;
      trial: string;
      variant: string;
      epoch: number;
      totalEpochs: number;
    })
  | (EvalEventBase & {
      type: "suite_regression";
      suite: string;
      suiteRunId: string;
      baselineSuiteRunId: string;
      hasRegression: boolean;
      hardCount: number;
      clearCount: number;
      driftCount: number;
      findings: string[];
    });

// -- Bench (cross-model comparison) -------------------------------------------

export interface BenchEntry {
  trial: string;
  variant: string;
  overall: Record<string, number>;
  deterministic: Record<string, Record<string, number>>;
}

export interface BenchReport {
  suite: string;
  benchRunId: string;
  startedAt: string;
  completedAt: string;
  models: string[];
  suiteRunIds: Record<string, string>;
  entries: BenchEntry[];
  averages: Record<string, number>;
}

export interface BenchIndexEntry {
  suite: string;
  benchRunId: string;
  dir: string;
  completedAt: string;
  models: string[];
  averages: Record<string, number>;
}

// -- Sandbox ------------------------------------------------------------------

export interface SandboxOptions {
  extraRwPaths?: string[];
  extraRoPaths?: string[];
  lockdown?: boolean;
}

// -- Launcher -----------------------------------------------------------------

export interface LauncherTrial {
  name: string;
  description: string;
  variants: string[];
}

export interface LauncherConfig {
  trials: LauncherTrial[];
  suites: Record<string, Array<{ trial: string; variant: string }>>;
  models: Array<{ provider?: string; model?: string }>;
  defaultWorker?: { provider?: string; model?: string };
  judge?: { provider?: string; model?: string };
  timeouts?: { workerMs?: number; inactivityMs?: number; judgeMs?: number };
  epochs?: number;
  budgets?: BudgetConfig;
  regressionThreshold?: number;
}

export interface RunRequest {
  type: "trial" | "suite" | "bench";
  trial?: string;
  variant?: string;
  suite?: string;
  model?: string;
  noJudge?: boolean;
}
