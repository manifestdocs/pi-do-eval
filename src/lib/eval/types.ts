import type { AgentRuntimeConfig } from "./harnesses/types.js";

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

export interface TrialVariant {
  /**
   * Human-readable label for this variant. Used by the launcher UI as the
   * display name; falls back to the variant key when omitted. Reserved by
   * the framework — plugins should not use `label` as a domain field.
   */
  label?: string;
  [key: string]: unknown;
}

export interface TrialManifest {
  description: string;
  taskFile?: string;
  plugin?: string;
  taskCount?: number;
  scaffoldDir?: string;
  features?: string[];
  enabled?: boolean;
  tags?: string[];
  variants: Record<string, TrialVariant>;
}

export interface ModelConfig {
  provider?: string;
  model?: string;
  thinking?: string;
}

export interface BenchConfig {
  profiles: string[];
  baseline?: string;
  epochs?: number;
  reuseBaseline?: boolean;
  requireJudge?: boolean;
  requiredDeterministicScores?: Record<string, number>;
}

export type WorkspaceProviderKind = "local-fs" | "agentfs-fuse";

export interface WorkspaceConfig {
  provider: WorkspaceProviderKind;
  root?: string;
  agentfsCommand?: string;
  mountTimeoutMs?: number;
}

export interface ProjectEvalConfig {
  worker?: ModelConfig;
  judge?: ModelConfig;
  models?: ModelConfig[];
  timeouts?: {
    workerMs?: number;
    inactivityMs?: number;
    judgeMs?: number;
  };
  epochs?: number;
  budgets?: BudgetConfig;
  profiles?: Record<string, ExecutionProfile>;
  benches?: Record<string, BenchConfig>;
  regressions?: {
    threshold?: number;
  };
  defaultLaunchType?: "suite" | "trial" | "bench";
  defaultProfile?: string;
  defaultPlugin?: string;
  runsDir?: string;
  workspace?: WorkspaceConfig;
}

export interface EvalPluginBuildPromptContext<TVariant extends TrialVariant = TrialVariant> {
  evalDir: string;
  trialDir: string;
  trialName: string;
  variantName: string;
  taskFile: string;
  taskDescription: string;
  manifest: TrialManifest;
  variant: TVariant;
  profile?: ExecutionProfile;
}

export interface EvalPluginAfterRunContext<TVariant extends TrialVariant = TrialVariant> {
  evalDir: string;
  runDir: string;
  workDir: string;
  trialName: string;
  variantName: string;
  manifest: TrialManifest;
  variant: TVariant;
  session: EvalSession;
}

export interface EvalPluginConfigureContext<TVariant extends TrialVariant = TrialVariant> {
  manifest: TrialManifest;
  variantName: string;
  variant: TVariant;
  taskCount?: number;
  isMonorepo: boolean;
}

export interface EvalPlugin<TVariant extends TrialVariant = TrialVariant> {
  name: string;
  extensionPath: string;
  parseEvent?(toolName: string, resultText: string, timestamp: number): PluginEvent[];
  classifyFile?(filePath: string): string;
  scoreSession(session: EvalSession, verify: VerifyResult): PluginScoreResult;
  buildPrompt?(context: EvalPluginBuildPromptContext<TVariant>): string;
  buildJudgePrompt(taskDescription: string, workDir: string): string;
  verify?(workDir: string): VerifyResult;
  afterRun?(context: EvalPluginAfterRunContext<TVariant>): void | Promise<void>;
  configure?(context: EvalPluginConfigureContext<TVariant>): void;
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
  | { ok: true; result: JudgeResult; stdout: string }
  | { ok: false; reason: JudgeFailureReason; stdout?: string };

// -- Scoring -------------------------------------------------------------------

export interface EvalScores {
  deterministic: Record<string, number>;
  judge?: Record<string, number>;
  overall: number;
  issues: string[];
}

export type EvalRunStatus = "completed" | "timeout" | "crashed" | "stalled";

export interface AgentSnapshot {
  worker?: { provider?: string; model?: string; thinking?: string };
  judge?: { provider?: string; model?: string; thinking?: string };
  timeouts?: { workerMs?: number; inactivityMs?: number; judgeMs?: number };
  budgets?: BudgetConfig;
  epochs?: number;
  regressionThreshold?: number;
}

export interface RunEnvironment {
  nodeVersion: string;
  platform: string;
  runtime?: string;
  piVersion?: string;
}

export interface EvalMeta {
  runId?: string;
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
  agentSnapshot?: AgentSnapshot;
  environment?: RunEnvironment;
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
  cacheKey?: string;
  startedAt: string;
  completedAt: string;
  entries: SuiteReportEntry[];
  summary: SuiteReportSummary;
  epochs?: number;
  aggregated?: AggregatedSuiteEntry[];
  comparison?: SuiteComparison;
}

export type RegressionStatus = "improved" | "stable" | "regressed" | "baseline";

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
  regressionStatus?: RegressionStatus;
  regressionDelta?: number;
  comparedToSuiteRunId?: string;
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
  runId?: string;
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
  agentSnapshot?: AgentSnapshot;
  environment?: RunEnvironment;
}

// -- SSE Events ---------------------------------------------------------------

interface EvalEventBase {
  timestamp: number;
}

export type EvalEvent =
  | (EvalEventBase & {
      type: "run_started";
      dir: string;
      runsDir?: string;
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

// -- Bench (cross-profile comparison) -----------------------------------------

export interface ProfileLayer {
  id: string;
  kind: "plugin" | "skill-library" | "mcp" | "hook" | "config" | "rules" | string;
  runtime?: "pi" | "codex" | "claude" | string;
  version?: string;
  capabilities?: string[];
}

export interface ProfileSetupLayer extends ProfileLayer {
  source?: string;
  mode?: "copy" | "symlink" | "install" | string;
  target?: string;
}

export interface ProfileSetup {
  layers?: ProfileSetupLayer[];
}

export interface ExecutionProfileFactors {
  harness?: string;
  provider?: string;
  model?: string;
  layers: ProfileLayer[];
  [key: string]: unknown;
}

export interface ExecutionProfile {
  id: string;
  label: string;
  agent: AgentRuntimeConfig;
  factors: ExecutionProfileFactors;
  setup?: ProfileSetup;
}

export interface ExecutionProfileSnapshot {
  id: string;
  label: string;
  factors: ExecutionProfileFactors;
}

export interface BenchEntry {
  trial: string;
  variant: string;
  overall: Record<string, number>;
  deterministic: Record<string, Record<string, number>>;
  deltas?: Record<string, number>;
}

export interface BenchReport {
  suite: string;
  benchRunId: string;
  startedAt: string;
  completedAt: string;
  profiles?: ExecutionProfileSnapshot[];
  baselineProfileId?: string;
  models: string[];
  suiteRunIds: Record<string, string>;
  entries: BenchEntry[];
  averages: Record<string, number>;
  averageDeltas?: Record<string, number>;
}

export interface BenchIndexEntry {
  suite: string;
  benchRunId: string;
  dir: string;
  completedAt: string;
  profiles?: ExecutionProfileSnapshot[];
  baselineProfileId?: string;
  models: string[];
  averages: Record<string, number>;
  averageDeltas?: Record<string, number>;
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
  /** Optional human-readable label per variant key; falls back to the key when missing. */
  variantLabels?: Record<string, string>;
  tags?: string[];
  enabled?: boolean;
}

export type SuiteSource = "file";

export interface LauncherSuiteDef {
  name: string;
  description?: string;
  trials: Array<{ trial: string; variant: string }>;
  regressionThreshold?: number;
  source: SuiteSource;
}

export interface LauncherBenchDef {
  name: string;
  description?: string;
  profiles: string[];
  baseline?: string;
  epochs?: number;
  trialCount?: number;
}

export type LaunchType = "suite" | "trial" | "bench";

export interface LauncherConfig {
  trials: LauncherTrial[];
  suites: Record<string, Array<{ trial: string; variant: string }>>;
  suiteDefs?: LauncherSuiteDef[];
  benchDefs?: LauncherBenchDef[];
  models: Array<{ provider?: string; model?: string }>;
  defaultWorker?: { provider?: string; model?: string };
  judge?: { provider?: string; model?: string };
  timeouts?: { workerMs?: number; inactivityMs?: number; judgeMs?: number };
  epochs?: number;
  budgets?: BudgetConfig;
  regressionThreshold?: number;
  // Which launcher tab the project lands on (suite | trial | bench).
  // Lets project authors signal the workflow that matters most for their eval
  // — e.g. a comparison-driven project sets "bench" so users see the
  // baseline-vs-treatment delta first.
  defaultLaunchType?: LaunchType;
}

export type RunRequest =
  | { type: "trial"; trial: string; variant: string; model?: string; noJudge?: boolean }
  | { type: "suite"; suite: string; model?: string; noJudge?: boolean }
  | { type: "bench"; suite: string; model?: string; noJudge?: boolean };
