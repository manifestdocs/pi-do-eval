export interface AgentRuntimeConfig {
  harness?: string;
  provider?: string;
  model?: string;
  thinking?: string;
  env?: Record<string, string | undefined>;
  args?: string[];
  options?: Record<string, unknown>;
  pi?: {
    extensionPath?: string;
    extraArgs?: string[];
    env?: Record<string, string | undefined>;
  };
  codex?: {
    home?: string;
    isolateHome?: boolean;
    authHome?: string;
    ignoreUserConfig?: boolean;
    pluginMarketplaces?: string[];
    profile?: string;
    extraArgs?: string[];
    env?: Record<string, string | undefined>;
  };
}

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

export interface BudgetConfig {
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxTotalTokens?: number;
  maxDurationMs?: number;
  maxToolCalls?: number;
  maxBlockedCalls?: number;
  maxFileWrites?: number;
}

export interface VerifyResult {
  passed: boolean;
  output: string;
  metrics: Record<string, number>;
}

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
  regressions?: { threshold?: number };
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

export interface SuiteDefinition {
  name: string;
  description?: string;
  trials: Array<{ trial: string; variant: string }>;
  regressionThreshold?: number;
}

export interface ProjectCommandOptions {
  projectPath?: string;
  profile?: string;
  variant?: string;
  noJudge?: boolean;
  provider?: string;
  model?: string;
}

export interface ProjectRunResult {
  report: EvalReport;
  runDir: string;
}

export function loadFileSuites(evalDir: string): SuiteDefinition[];
export function writeFileSuite(evalDir: string, suite: SuiteDefinition): string;
export function deleteFileSuite(evalDir: string, name: string): void;
export function validateSuiteName(name: string): void;
export function validateSuiteDefinition(suite: SuiteDefinition): void;
export function getSuiteDefsDir(evalDir: string): string;

export function validateName(value: string, kind?: string): void;
/** @deprecated Use `validateName(value, "trial")` instead. */
export function validateTrialName(name: string): void;
export function listTrialNames(evalDir: string): string[];
export function loadTrialManifest(evalDir: string, name: string): TrialManifest | null;
export function readTrialManifest(evalDir: string, name: string): TrialManifest;
export function writeTrialManifest(evalDir: string, name: string, manifest: TrialManifest): string;
export function parseTrialManifestYaml(raw: string, filePath?: string): TrialManifest;

export function runProjectList(options?: ProjectCommandOptions): Promise<void>;
export function runProjectTrialCommand(trialName: string, options?: ProjectCommandOptions): Promise<void>;
export function runProjectRegressionCommand(suiteName: string, options?: ProjectCommandOptions): Promise<void>;
export function runProjectBenchCommand(suiteName: string, options?: ProjectCommandOptions): Promise<void>;
export function runProjectModelBenchCommand(suiteName: string, options?: ProjectCommandOptions): Promise<void>;
