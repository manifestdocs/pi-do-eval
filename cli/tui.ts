import { addOrUpdateProject } from "../src/lib/server/projects.js";
import { runTui } from "../src/lib/tui/app.js";
import { startUiServerForTui, type WebServerHandle } from "./web.js";

interface TuiCliOptions {
  projectPath?: string;
  webPort: number;
  web: boolean;
}

export async function runTuiCommand(args: string[]): Promise<void> {
  const options = parseTuiOptions(args);
  let web: WebServerHandle | undefined;
  if (options.web) {
    if (options.projectPath) {
      try {
        addOrUpdateProject(options.projectPath);
      } catch {
        // The TUI will render the project resolution error in the main pane.
      }
    }
    web = await startUiServerForTui(options.webPort);
  }
  runTui({ projectPath: options.projectPath, web });
}

function parseTuiOptions(values: string[]): TuiCliOptions {
  const options: TuiCliOptions = { webPort: parsePort(process.env.EVAL_PORT ?? "4242", "EVAL_PORT"), web: true };
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value === "--project") {
      const next = values[++i];
      if (!next) {
        console.error("--project requires a value");
        process.exit(1);
      }
      options.projectPath = next;
    } else if (value === "--port") {
      const next = values[++i];
      if (!next) {
        console.error("--port requires a value");
        process.exit(1);
      }
      options.webPort = parsePort(next, "--port");
    } else if (value === "--no-web") {
      options.web = false;
    } else if (value?.startsWith("--")) {
      console.error(`Unknown option: ${value}`);
      process.exit(1);
    }
  }
  return options;
}

function parsePort(value: string, label: string): number {
  if (!/^\d+$/.test(value)) {
    console.error(`${label} must be a TCP port between 1 and 65535`);
    process.exit(1);
  }
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`${label} must be a TCP port between 1 and 65535`);
    process.exit(1);
  }
  return port;
}
