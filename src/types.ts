// -- Project configuration -----------------------------------------------------

export interface ProjectConfig {
  name: string;
  description: string;
  prdFile: string;
  taskCount: number;
  scaffoldDir?: string;
  plugin: string;
  features: string[];
  variants: Record<string, VariantConfig>;
}

export interface VariantConfig {
  language: string;
  prdSuffix?: string;
}

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
  buildJudgePrompt(prd: string, workDir: string): string;
  verify?(workDir: string): VerifyResult;
  formatSummary?(session: EvalSession): string[];
}

// -- Judge ---------------------------------------------------------------------

export interface JudgeResult {
  scores: Record<string, number>;
  reasons: Record<string, string>;
  findings: string[];
}

// -- Scoring -------------------------------------------------------------------

export interface EvalScores {
  deterministic: Record<string, number>;
  judge?: Record<string, number>;
  overall: number;
}

export interface EvalReport {
  meta: {
    project: string;
    variant: string;
    language: string;
    workerModel: string;
    judgeModel?: string;
    startedAt: string;
    durationMs: number;
    status: "completed" | "timeout" | "crashed" | "stalled";
  };
  scores: EvalScores;
  judgeResult?: JudgeResult;
  session: EvalSession;
  findings: string[];
}
