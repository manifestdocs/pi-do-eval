/** Template functions for `do-eval init`. Each returns the file content as a string. */

export function packageJson(extensionName: string, doEvalRef: string): string {
  return JSON.stringify(
    {
      name: `${extensionName}-eval`,
      version: "0.1.0",
      description: `Eval suite for ${extensionName}`,
      type: "module",
      scripts: {
        bench: "do-eval bench small --project .",
        regression: "do-eval regression small --project .",
        trial: "do-eval trial --project .",
        list: "do-eval list --project .",
        test: "vitest run",
        view: "do-eval ui --project .",
      },
      dependencies: {
        "do-eval": doEvalRef,
      },
      devDependencies: {
        "@types/node": "^25.6.0",
        typescript: "^5.7.0",
        vitest: "^3.2.1",
      },
    },
    null,
    2,
  );
}

export function tsconfig(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        lib: ["ES2022"],
        module: "Node16",
        moduleResolution: "Node16",
        strict: true,
        noUncheckedIndexedAccess: true,
        noEmit: true,
        skipLibCheck: true,
      },
      include: ["eval.config.ts", "plugins", "trials", "test"],
    },
    null,
    2,
  );
}

export function gitignore(): string {
  return `node_modules/
runs/
index.html
`;
}

export function suiteSmall(): string {
  return `name: small
description: Example suite
trials:
  - example
`;
}

export function evalConfig(): string {
  return `import type { ProjectEvalConfig } from "do-eval";

const config: ProjectEvalConfig = {
  worker: {
    // Omit to use Pi's default settings from ~/.pi/agent/settings.json
  },
  judge: {
    // Provider/model for the LLM judge
  },
  // models: [
  //   { provider: "anthropic", model: "claude-sonnet-4-5" },
  //   { provider: "openai", model: "gpt-4o" },
  // ],
  // profiles: {
  //   codexBaseline: {
  //     id: "codexBaseline",
  //     label: "Codex baseline",
  //     agent: { harness: "codex", provider: "openai", model: "gpt-5.4", codex: { isolateHome: true } },
  //     factors: { harness: "codex", provider: "openai", model: "gpt-5.4", layers: [] },
  //   },
  //   codexWithSkills: {
  //     id: "codexWithSkills",
  //     label: "Codex + skills",
  //     agent: { harness: "codex", provider: "openai", model: "gpt-5.4", codex: { isolateHome: true } },
  //     factors: {
  //       harness: "codex",
  //       provider: "openai",
  //       model: "gpt-5.4",
  //       layers: [{ id: "engineering-skills", kind: "skill-library", runtime: "codex" }],
  //     },
  //     setup: {
  //       layers: [
  //         {
  //           id: "engineering-skills",
  //           kind: "skill-library",
  //           runtime: "codex",
  //           source: "../path/to/skills",
  //           mode: "copy",
  //         },
  //       ],
  //     },
  //   },
  //   codexWithPlugin: {
  //     id: "codexWithPlugin",
  //     label: "Codex + plugin",
  //     agent: { harness: "codex", provider: "openai", model: "gpt-5.4", codex: { isolateHome: true } },
  //     factors: {
  //       harness: "codex",
  //       provider: "openai",
  //       model: "gpt-5.4",
  //       layers: [{ id: "engineering-plugin", kind: "plugin", runtime: "codex" }],
  //     },
  //     setup: {
  //       layers: [
  //         {
  //           id: "engineering-plugin",
  //           kind: "plugin",
  //           runtime: "codex",
  //           source: "../path/to/plugin-marketplace",
  //           mode: "install",
  //         },
  //       ],
  //     },
  //   },
  // },
  // benches: {
  //   small: {
  //     profiles: ["codexBaseline", "codexWithSkills"],
  //     baseline: "codexBaseline",
  //   },
  // },
  timeouts: {
    workerMs: 15 * 60 * 1000,
    inactivityMs: 2 * 60 * 1000,
    judgeMs: 2 * 60 * 1000,
  },
  // epochs: 3,  // Run each trial N times to measure stability on the same task
  // budgets: {
  //   maxTotalTokens: 100_000,
  //   maxDurationMs: 5 * 60 * 1000,
  //   maxToolCalls: 200,
  //   maxBlockedCalls: 0,
  // },
  regressions: {
    threshold: 3,
  },
};

export default config;
`;
}

export function pluginSkeleton(extensionName: string, extensionPath: string): string {
  return `import * as path from "node:path";
import type { EvalPlugin, EvalSession, TrialVariant, VerifyResult } from "do-eval";

// extensionPath is stored relative to eval/, so resolve from the plugin file back through eval/.
const EXTENSION_PATH = path.resolve(import.meta.dirname, "..", "${extensionPath}");

// Declare the shape of fields you read from \`trial.yaml\` variant entries.
// Doing this lets configure(), buildPrompt(), and afterRun() read variant
// fields without casts. Leave it empty if your trials don't carry per-variant
// data beyond the variant name itself.
interface Variant extends TrialVariant {
  // example: stacks?: { language: string; testFramework: string }[];
}

const plugin: EvalPlugin<Variant> = {
  name: "${extensionName}",
  extensionPath: EXTENSION_PATH,

  classifyFile(filePath) {
    if (filePath.includes(".test.") || filePath.includes("_test.")) return "test";
    if (/package\\.json$|tsconfig|\\.gitignore$/.test(filePath)) return "config";
    return "source";
  },

  parseEvent(_toolName, _resultText, _timestamp) {
    // Extract domain-specific events from tool call results.
    // Return PluginEvent[] for events your extension emits.
    return [];
  },

  verify(_workDir) {
    // Run independent verification (e.g. execute tests, lint check).
    // Return { passed, output, metrics }.
    return { passed: true, output: "Verification not implemented", metrics: {} };
  },

  scoreSession(session, verify) {
    const scores: Record<string, number> = {};
    const weights: Record<string, number> = {};
    const findings: string[] = [];

    scores.correctness = verify.passed ? 100 : 0;
    weights.correctness = 0.5;

    const fileCount = session.fileWrites.length;
    scores.productivity = Math.min(100, fileCount * 10);
    weights.productivity = 0.2;

    return { scores, weights, findings };
  },

  buildJudgePrompt(taskDescription, workDir) {
    return [
      "Evaluate the implementation quality. Respond with ONLY a JSON object.",
      "",
      "## Task",
      taskDescription,
      "",
      "## Evaluation Criteria",
      "Score each dimension 0-100:",
      '- "quality": Overall implementation quality',
      '- "quality_reason": Brief explanation',
      '- "findings": Notable observations (string array)',
      "",
      "Respond with ONLY the JSON object.",
    ].join("\\n");
  },
};

export default plugin;
`;
}

export function trialManifest(pluginName: string): string {
  return `description: Example trial, replace with a real task
taskFile: task.md
plugin: ${pluginName}
variants:
  default:
    stacks:
      language: TypeScript
      testFramework: vitest
`;
}

export function taskMd(): string {
  return `# Example Task

Replace this with a real task description for your extension.

## User Stories

### US-1: First feature
- Description of what the agent should build
- Acceptance criteria

### US-2: Second feature
- Description of what the agent should build
- Acceptance criteria

### US-3: Third feature
- Description of what the agent should build
- Acceptance criteria
`;
}
